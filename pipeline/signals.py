"""Risk and opportunity signals with per-stock historical odds.

For each signal we look back over the stock's own history and ask: after this
signal fired, how often did the price fall (risk) or rise (opportunity) by at
least MOVE within HORIZON trading days? That conditional rate is compared with
the base rate over all days, so a signal is only interesting when it beats
"any random day".

These are descriptive statistics on past data, not forecasts.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
import talib

from .patterns import Detection, moving_average

HORIZON = 20  # trading days, about one month
MOVE = 0.05  # 5% move
COOLDOWN = 5  # ignore repeats of the same signal within this many days
ACTIVE_BARS = 3  # a signal counts as "current" if it fired in the last N bars
MIN_SAMPLES_SHOW = 10  # below this, do not show a percentage
MIN_SAMPLES_STRONG = 20
STRONG_LIFT = 1.5

RISK = "risk"
OPPORTUNITY = "opportunity"


@dataclass(frozen=True)
class SignalInfo:
    key: str
    kind: str  # risk | opportunity
    name: str
    rule: str  # plain-language definition

    def to_json(self) -> dict:
        return {"key": self.key, "kind": self.kind, "name": self.name, "rule": self.rule}


SIGNALS: dict[str, SignalInfo] = {
    s.key: s
    for s in [
        SignalInfo("break_ma60", RISK, "放量跌破季線", "收盤從季線（60 日均線）上方跌到下方，而且成交量超過前 20 日平均的 1.2 倍。"),
        SignalInfo("death_cross", RISK, "均線死亡交叉", "5 日均線由上往下穿過 20 日均線。"),
        SignalInfo(
            "top_reversal",
            RISK,
            "高檔反轉K線",
            "在離 60 日高點 5% 以內的位置，出現空頭吞噬、夜星、烏雲罩頂或流星線。",
        ),
        SignalInfo(
            "climax_drop",
            RISK,
            "高檔爆量長黑",
            "在離 60 日高點 10% 以內的位置，收出跌超過 3% 的綠K，成交量是前 20 日平均的 2 倍以上。",
        ),
        SignalInfo(
            "pullback_ma20",
            OPPORTUNITY,
            "多頭回檔到月線",
            "季線向上、股價在季線之上，當天最低價碰到月線（20 日均線）但收盤站回月線之上。",
        ),
        SignalInfo(
            "golden_cross_uptrend",
            OPPORTUNITY,
            "多頭中的黃金交叉",
            "股價在季線之上時，5 日均線由下往上穿過 20 日均線。",
        ),
        SignalInfo("breakout", OPPORTUNITY, "放量突破", "收盤創 60 日新高，而且成交量超過前 20 日平均的 1.5 倍。"),
        SignalInfo("oversold_rebound", OPPORTUNITY, "超跌反彈", "14 日 RSI 從 30 以下回升到 30 以上。"),
        SignalInfo(
            "bottom_reversal",
            OPPORTUNITY,
            "低檔反轉K線",
            "在離 60 日低點 5% 以內的位置，出現多頭吞噬、晨星、貫穿線或錘子線。",
        ),
    ]
}

_TOP_REVERSAL_KEYS = {"bearish_engulfing", "evening_star", "dark_cloud_cover", "shooting_star"}
_BOTTOM_REVERSAL_KEYS = {"bullish_engulfing", "morning_star", "piercing", "hammer"}


def _cross_up(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    out = np.zeros(len(a), dtype=bool)
    out[1:] = (a[:-1] <= b[:-1]) & (a[1:] > b[1:])
    return out


def _shift(x: np.ndarray, n: int = 1) -> np.ndarray:
    out = np.full(len(x), np.nan)
    out[n:] = x[:-n]
    return out


def signal_masks(bars: pd.DataFrame, detections: list[Detection]) -> dict[str, np.ndarray]:
    """Boolean array per signal: True on bars where the signal fires."""
    o = bars["open"].to_numpy(float)
    h = bars["high"].to_numpy(float)
    lo = bars["low"].to_numpy(float)
    c = bars["close"].to_numpy(float)
    v = bars["volume"].to_numpy(float)
    close = bars["close"].astype(float)

    ma5 = moving_average(close, 5).to_numpy()
    ma20 = moving_average(close, 20).to_numpy()
    ma60 = moving_average(close, 60).to_numpy()
    vol20_prev = _shift(pd.Series(v).rolling(20, min_periods=20).mean().to_numpy())
    hi60 = pd.Series(h).rolling(60, min_periods=60).max().to_numpy()
    hi60_prev = _shift(pd.Series(c).rolling(60, min_periods=60).max().to_numpy())
    lo60 = pd.Series(lo).rolling(60, min_periods=60).min().to_numpy()
    ma60_20ago = _shift(ma60, 20)
    rsi = talib.RSI(c, timeperiod=14)

    with np.errstate(invalid="ignore"):
        date_index = {d: i for i, d in enumerate(bars["date"])}
        top_rev = np.zeros(len(c), dtype=bool)
        bottom_rev = np.zeros(len(c), dtype=bool)
        for d in detections:
            i = date_index.get(d.end)
            if i is None:
                continue
            if d.key in _TOP_REVERSAL_KEYS:
                top_rev[i] = True
            elif d.key in _BOTTOM_REVERSAL_KEYS:
                bottom_rev[i] = True

        prev_c = _shift(c)
        prev_ma60 = _shift(ma60)
        masks = {
            "break_ma60": (prev_c >= prev_ma60) & (c < ma60) & (v > 1.2 * vol20_prev),
            "death_cross": _cross_up(ma20, ma5),
            "top_reversal": top_rev & (c >= 0.95 * hi60),
            "climax_drop": (v > 2 * vol20_prev) & ((c - o) / o <= -0.03) & (c >= 0.9 * hi60),
            "pullback_ma20": (ma60 > ma60_20ago) & (c > ma60) & (lo <= ma20) & (c > ma20),
            "golden_cross_uptrend": _cross_up(ma5, ma20) & (c > ma60),
            "breakout": (c > hi60_prev) & (v > 1.5 * vol20_prev),
            "oversold_rebound": _cross_up(rsi, np.full(len(c), 30.0)),
            "bottom_reversal": bottom_rev & (c <= 1.05 * lo60),
        }
    return {k: np.nan_to_num(m, nan=0).astype(bool) for k, m in masks.items()}


def outcomes(close: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """For each bar: did price fall/rise by MOVE within HORIZON bars? And is the outcome known?"""
    n = len(close)
    fell = np.zeros(n, dtype=bool)
    rose = np.zeros(n, dtype=bool)
    known = np.zeros(n, dtype=bool)
    for t in range(n - HORIZON):
        window = close[t + 1 : t + 1 + HORIZON]
        fell[t] = window.min() <= close[t] * (1 - MOVE)
        rose[t] = window.max() >= close[t] * (1 + MOVE)
        known[t] = True
    return fell, rose, known


def _thin(mask: np.ndarray) -> np.ndarray:
    """Keep the first firing of each cluster so one episode is counted once."""
    out = np.zeros_like(mask)
    last = -COOLDOWN - 1
    for i in np.flatnonzero(mask):
        if i - last > COOLDOWN:
            out[i] = True
            last = i
    return out


def evaluate(bars: pd.DataFrame, detections: list[Detection]) -> dict:
    """Per-signal odds for one stock plus the signals active on the latest bars."""
    close = bars["close"].to_numpy(float)
    dates = bars["date"].tolist()
    fell, rose, known = outcomes(close)
    base = {
        RISK: float(fell[known].mean()) if known.any() else None,
        OPPORTUNITY: float(rose[known].mean()) if known.any() else None,
    }

    stats: dict[str, dict] = {}
    active: list[dict] = []
    masks = signal_masks(bars, detections)
    last = len(bars) - 1

    for key, mask in masks.items():
        info = SIGNALS[key]
        events = _thin(mask)
        hit_arr = fell if info.kind == RISK else rose
        sample = events & known
        n = int(sample.sum())
        k = int((hit_arr & sample).sum())
        p = k / n if n else None
        b = base[info.kind]
        lift = (p / b) if (p is not None and b) else None
        stats[key] = {
            "n": n,
            "k": k,
            "p": _r(p),
            "base": _r(b),
            "lift": _r(lift),
            "show": n >= MIN_SAMPLES_SHOW,
            "strong": bool(n >= MIN_SAMPLES_STRONG and lift is not None and lift >= STRONG_LIFT),
        }

        recent = np.flatnonzero(mask[max(0, last - ACTIVE_BARS + 1) :])
        if len(recent):
            fired = max(0, last - ACTIVE_BARS + 1) + int(recent[-1])
            active.append({"key": key, "kind": info.kind, "date": dates[fired], **stats[key]})

    active.sort(key=lambda a: (a["kind"], -(a["p"] or 0) if a["show"] else 1))
    return {
        "horizon": HORIZON,
        "move": MOVE,
        "history_from": dates[0],
        "base": {k: _r(v) for k, v in base.items()},
        "stats": stats,
        "active": active,
        "headline": {kind: _headline(active, kind) for kind in (RISK, OPPORTUNITY)},
    }


def _headline(active: list[dict], kind: str) -> dict | None:
    """The most telling current signal of a kind.

    Only signals with enough samples that historically beat the base rate (lift > 1)
    qualify; a buy signal that rose less often than a random day is not a buy signal
    for this stock.
    """
    candidates = [
        a
        for a in active
        if a["kind"] == kind and a["show"] and a["p"] is not None and (a["lift"] or 0) > 1
    ]
    if not candidates:
        return None
    best = max(candidates, key=lambda a: (a["p"], a["n"]))
    return {"key": best["key"], "p": best["p"], "lift": best["lift"], "n": best["n"], "strong": best["strong"]}


def _r(x: float | None) -> float | None:
    return None if x is None else round(float(x), 4)


def signals_catalog() -> dict:
    return {
        "horizon": HORIZON,
        "move": MOVE,
        "min_samples_show": MIN_SAMPLES_SHOW,
        "min_samples_strong": MIN_SAMPLES_STRONG,
        "strong_lift": STRONG_LIFT,
        "signals": {k: v.to_json() for k, v in SIGNALS.items()},
    }
