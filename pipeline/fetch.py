"""Daily bars through the daily_stock_analysis data layer.

The vendored project is imported as-is from ``vendor/daily_stock_analysis``; this
module only adapts its output to the columns the pipeline needs.
"""

from __future__ import annotations

import sys
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd

TAIPEI = ZoneInfo("Asia/Taipei")

VENDOR_DIR = Path(__file__).resolve().parent.parent / "vendor" / "daily_stock_analysis"

OHLCV = ["date", "open", "high", "low", "close", "volume"]


def _ensure_vendor_on_path() -> None:
    if not (VENDOR_DIR / "data_provider").is_dir():
        raise RuntimeError(
            f"{VENDOR_DIR} is missing; run 'git submodule update --init' first"
        )
    vendor = str(VENDOR_DIR)
    if vendor not in sys.path:
        sys.path.insert(0, vendor)


class DailyBarFetcher:
    """Thin wrapper around daily_stock_analysis' YfinanceFetcher."""

    def __init__(self) -> None:
        _ensure_vendor_on_path()
        from data_provider.yfinance_fetcher import YfinanceFetcher  # noqa: PLC0415

        self._fetcher = YfinanceFetcher()

    def daily_bars(self, code: str, trading_days: int) -> pd.DataFrame:
        start, end = fetch_window(trading_days)
        if code.startswith("^"):
            return normalize_bars(_index_bars(code, start, end))
        df = self._fetcher.get_daily_data(code, start_date=start, end_date=end)
        return drop_unfinished_bar(normalize_bars(df))


def _index_bars(symbol: str, start: str, end: str) -> pd.DataFrame:
    """Index history straight from yfinance.

    The vendored fetcher rewrites symbols for stocks; index symbols such as
    ``^TWII`` must reach Yahoo unchanged, so they skip that step.
    """
    import yfinance as yf  # noqa: PLC0415

    df = yf.download(
        tickers=symbol, start=start, end=end, progress=False, auto_adjust=True, multi_level_index=False
    )
    if df is None or df.empty:
        raise ValueError(f"no data for {symbol}")
    df = df.reset_index().rename(columns=str.lower)
    return df


def fetch_window(trading_days: int, today: date | None = None) -> tuple[str, str]:
    """Calendar window that covers `trading_days` bars plus lookback for long MAs.

    Yahoo Finance treats the end date as exclusive, and GitHub runners use UTC,
    so the end is tomorrow in Taipei time; otherwise today's bar is dropped.
    """
    today = today or datetime.now(TAIPEI).date()
    calendar_days = int((trading_days + 120) * 1.5)
    start = today - timedelta(days=calendar_days)
    end = today + timedelta(days=1)
    return start.isoformat(), end.isoformat()


MARKET_CLOSE = (13, 45)  # Taipei; the close auction ends at 13:30


def drop_unfinished_bar(bars: pd.DataFrame, now: datetime | None = None) -> pd.DataFrame:
    """Remove today's bar while the Taiwan market is still trading.

    Yahoo serves a partial bar during the session. Treating it as a daily close
    would feed half a day into the indicators and the forecast; live prices are
    the quote function's job.
    """
    now = now or datetime.now(TAIPEI)
    if bars.empty or (now.hour, now.minute) >= MARKET_CLOSE:
        return bars
    if bars["date"].iloc[-1] == now.date().isoformat():
        return bars.iloc[:-1].reset_index(drop=True)
    return bars


def normalize_bars(df: pd.DataFrame) -> pd.DataFrame:
    """Keep OHLCV columns, drop bad rows, sort by date ascending."""
    missing = [c for c in OHLCV if c not in df.columns]
    if missing:
        raise ValueError(f"daily bars are missing columns: {missing}")

    out = df[OHLCV].copy()
    out["date"] = pd.to_datetime(out["date"]).dt.strftime("%Y-%m-%d")
    for col in ("open", "high", "low", "close", "volume"):
        out[col] = pd.to_numeric(out[col], errors="coerce")
    out = out.dropna(subset=["open", "high", "low", "close"])
    out = out[(out["high"] >= out["low"]) & (out["close"] > 0)]
    out["volume"] = out["volume"].fillna(0)
    out = out.drop_duplicates(subset="date", keep="last").sort_values("date")
    return out.reset_index(drop=True)
