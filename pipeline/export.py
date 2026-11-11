"""Build the JSON files the web app reads."""

from __future__ import annotations

import json
import math
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd
import talib

from .catalog import CATALOG
from .config import INDEX, Stock, Theme
from .patterns import Detection, detect, moving_average
from .signals import evaluate, signals_catalog

TAIPEI = ZoneInfo("Asia/Taipei")
MA_WINDOWS = (5, 20, 60)
RECENT_PATTERN_BARS = 5
SCHEMA_VERSION = 3
LIQUIDITY_BARS = 20
SPARK_BARS = 40
TRAIL_BARS = 22
TRAIL_ATR = 3.0


def now_taipei() -> str:
    return datetime.now(TAIPEI).isoformat(timespec="seconds")


def _num(value: float, digits: int = 2) -> float | None:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    return round(float(value), digits)


def key_levels(bars: pd.DataFrame) -> dict:
    """Reference prices for stops: moving averages, recent range and an ATR trailing stop."""
    close = bars["close"].astype(float)
    high = bars["high"].astype(float)
    low = bars["low"].astype(float)
    atr = talib.ATR(high.to_numpy(), low.to_numpy(), close.to_numpy(), TRAIL_BARS)[-1]
    recent_high = float(high.tail(TRAIL_BARS).max())
    return {
        "ma20": _num(close.tail(20).mean()),
        "ma60": _num(close.tail(60).mean()),
        "high60": _num(high.tail(60).max()),
        "low60": _num(low.tail(60).min()),
        "low20": _num(low.tail(20).min()),
        "atr": _num(atr),
        "atr_pct": _num(atr / float(close.iloc[-1]) * 100) if atr == atr else None,
        # Chandelier exit: the recent high minus a few days of normal movement.
        "trail_stop": _num(recent_high - TRAIL_ATR * atr) if atr == atr else None,
        "trail_bars": TRAIL_BARS,
        "trail_atr": TRAIL_ATR,
    }


def _prob_list(values, count: int) -> list[float | None]:
    return [_num(v, 3) for v in list(values)[-count:]]


def build_stock_payload(
    stock: Stock,
    bars: pd.DataFrame,
    history_days: int,
    detections: list[Detection] | None = None,
    forecast: dict | None = None,
) -> dict:
    """Compute indicators and patterns on the full history, then trim for display."""
    close = bars["close"].astype(float)
    mas = {w: moving_average(close, w) for w in MA_WINDOWS}
    if detections is None:
        detections = detect(bars)

    shown = bars.tail(history_days)
    first_index = shown.index[0]
    first_date = shown["date"].iloc[0]

    candles = [
        {
            "time": row.date,
            "open": _num(row.open),
            "high": _num(row.high),
            "low": _num(row.low),
            "close": _num(row.close),
            "volume": int(row.volume),
        }
        for row in shown.itertuples(index=False)
    ]
    ma = {
        str(w): [_num(v) for v in series.loc[first_index:].tolist()]
        for w, series in mas.items()
    }
    patterns = [d.to_json() for d in detections if d.start >= first_date]
    is_index = stock.kind == INDEX
    avg_lots = None if is_index else round(float(bars["volume"].tail(LIQUIDITY_BARS).mean()) / 1000)

    prob = None
    head = None
    if forecast:
        prob = {
            "up": _prob_list(forecast["series_up"], len(candles)),
            "down": _prob_list(forecast["series_down"], len(candles)),
        }
        head = {k: forecast[k] for k in ("up", "down", "base_up", "base_down", "why_up", "why_down")}

    return {
        "schema": SCHEMA_VERSION,
        "code": stock.code,
        "name": stock.name,
        "market": stock.market,
        "role": stock.role,
        "kind": stock.kind,
        "themes": list(stock.themes),
        "currency": "TWD",
        "price_adjusted": not is_index,
        "updated_at": now_taipei(),
        "candles": candles,
        "ma": ma,
        "patterns": patterns,
        "forecast": head,
        "prob": prob,
        "levels": key_levels(bars),
        # Odds use the full fetched history, not just the bars on the chart.
        "signals": evaluate(bars, detections),
        "avg_volume_lots": avg_lots,
    }


def _pct(new: float | None, old: float | None) -> float | None:
    if not new or not old:
        return None
    return round((new - old) / old * 100, 2)


def summarize(payload: dict, session: tuple[str, str] | None = None) -> dict:
    """One row for the index file.

    `session` is the market's latest and previous trading dates. When this
    symbol has the latest bar but the source skipped the one before it, the
    change from its previous bar spans two days, so it is not reported as
    today's change.
    """
    candles = payload["candles"]
    last = candles[-1]
    prev = candles[-2] if len(candles) > 1 else None
    if session and prev and last["time"] == session[0] and prev["time"] < session[1]:
        prev = None
    month_ago = candles[-21] if len(candles) > 20 else None

    recent_dates = {c["time"] for c in candles[-RECENT_PATTERN_BARS:]}
    recent = [p["key"] for p in payload["patterns"] if p["end"] in recent_dates]
    forecast = payload["forecast"]

    return {
        "code": payload["code"],
        "name": payload["name"],
        "market": payload["market"],
        "role": payload["role"],
        "kind": payload["kind"],
        "themes": payload["themes"],
        "last_date": last["time"],
        "last_close": last["close"],
        "change_pct": _pct(last["close"], prev["close"] if prev else None),
        "month_pct": _pct(last["close"], month_ago["close"] if month_ago else None),
        "spark": [c["close"] for c in candles[-SPARK_BARS:]],
        "recent_patterns": recent,
        "avg_volume_lots": payload["avg_volume_lots"],
        "forecast": (
            {k: forecast[k] for k in ("up", "down", "base_up", "base_down")} if forecast else None
        ),
        "trail_stop": payload["levels"]["trail_stop"],
        "active": [{"key": a["key"], "kind": a["kind"], "date": a["date"]} for a in payload["signals"]["active"]],
    }


def themes_payload(themes: tuple[Theme, ...]) -> list[dict]:
    return [{"key": t.key, "name": t.name, "kind": t.kind} for t in themes]


def catalog_payload() -> dict:
    return {
        "schema": SCHEMA_VERSION,
        "patterns": {k: v.to_json() for k, v in CATALOG.items()},
        "signals": signals_catalog(),
    }


def write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    tmp.replace(path)


def stock_filename(code: str) -> str:
    return f"{code}.json"


__all__ = [
    "Detection",
    "build_stock_payload",
    "catalog_payload",
    "now_taipei",
    "stock_filename",
    "summarize",
    "themes_payload",
    "write_json",
]
