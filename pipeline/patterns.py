"""Detect candlestick patterns, moving-average crosses and price gaps.

Candlestick shapes come from TA-Lib. TA-Lib checks shape only, so bullish
reversal patterns are kept only after a decline and bearish ones only after a
rise (see ``catalog.PatternInfo.context``).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
import talib

from .catalog import CATALOG, DOWNTREND, UPTREND

# TA-Lib function -> pattern key for a positive / negative output.
# Some functions (the doji variants) only ever return +100.
_TALIB_PATTERNS: list[tuple[str, str | None, str | None]] = [
    ("CDLENGULFING", "bullish_engulfing", "bearish_engulfing"),
    ("CDLHAMMER", "hammer", None),
    ("CDLHANGINGMAN", None, "hanging_man"),
    ("CDLINVERTEDHAMMER", "inverted_hammer", None),
    ("CDLSHOOTINGSTAR", None, "shooting_star"),
    ("CDLMORNINGSTAR", "morning_star", None),
    ("CDLEVENINGSTAR", None, "evening_star"),
    ("CDLHARAMI", "bullish_harami", "bearish_harami"),
    ("CDLPIERCING", "piercing", None),
    ("CDLDARKCLOUDCOVER", None, "dark_cloud_cover"),
    ("CDL3WHITESOLDIERS", "three_white_soldiers", None),
    ("CDL3BLACKCROWS", None, "three_black_crows"),
    ("CDLDRAGONFLYDOJI", "dragonfly_doji", None),
    ("CDLGRAVESTONEDOJI", "gravestone_doji", None),
]

# Ignore gaps smaller than this fraction of the previous close.
MIN_GAP_RATIO = 0.005

TREND_MA = 20


@dataclass(frozen=True)
class Detection:
    key: str
    start: str  # first bar date, YYYY-MM-DD
    end: str  # last bar date, YYYY-MM-DD
    top: float  # highest high across the pattern bars
    bottom: float  # lowest low across the pattern bars

    def to_json(self) -> dict:
        return {
            "key": self.key,
            "start": self.start,
            "end": self.end,
            "top": round(self.top, 2),
            "bottom": round(self.bottom, 2),
        }


def moving_average(close: pd.Series, window: int) -> pd.Series:
    return close.rolling(window=window, min_periods=window).mean()


def _trend_ok(context: str | None, prior: int, close: np.ndarray, ma: np.ndarray) -> bool:
    if context is None:
        return True
    if prior < 0 or np.isnan(ma[prior]):
        return False
    if context == DOWNTREND:
        return close[prior] < ma[prior]
    if context == UPTREND:
        return close[prior] > ma[prior]
    raise ValueError(f"unknown context {context!r}")


def _make(key: str, end: int, dates: list[str], high: np.ndarray, low: np.ndarray) -> Detection:
    start = end - CATALOG[key].bars + 1
    return Detection(
        key=key,
        start=dates[start],
        end=dates[end],
        top=float(high[start : end + 1].max()),
        bottom=float(low[start : end + 1].min()),
    )


def detect(bars: pd.DataFrame) -> list[Detection]:
    """Return detections sorted by end date, oldest first.

    ``bars`` must have date/open/high/low/close columns sorted ascending.
    """
    if len(bars) < 3:
        return []

    dates = bars["date"].tolist()
    o = bars["open"].to_numpy(dtype=float)
    h = bars["high"].to_numpy(dtype=float)
    lo = bars["low"].to_numpy(dtype=float)
    c = bars["close"].to_numpy(dtype=float)
    trend_ma = moving_average(bars["close"].astype(float), TREND_MA).to_numpy()

    found: list[Detection] = []

    for func_name, bull_key, bear_key in _TALIB_PATTERNS:
        signal = getattr(talib, func_name)(o, h, lo, c)
        for i in np.flatnonzero(signal):
            key = bull_key if signal[i] > 0 else bear_key
            if key is None:
                continue
            info = CATALOG[key]
            prior = i - info.bars
            if _trend_ok(info.context, prior, c, trend_ma):
                found.append(_make(key, int(i), dates, h, lo))

    ma5 = moving_average(bars["close"].astype(float), 5).to_numpy()
    ma20 = trend_ma
    for i in range(1, len(bars)):
        if not (np.isnan(ma5[i - 1]) or np.isnan(ma20[i - 1])):
            if ma5[i - 1] <= ma20[i - 1] and ma5[i] > ma20[i]:
                found.append(_make("golden_cross", i, dates, h, lo))
            elif ma5[i - 1] >= ma20[i - 1] and ma5[i] < ma20[i]:
                found.append(_make("death_cross", i, dates, h, lo))

        prev_close = c[i - 1]
        if lo[i] > h[i - 1] and (lo[i] - h[i - 1]) / prev_close >= MIN_GAP_RATIO:
            found.append(_make("gap_up", i, dates, h, lo))
        elif h[i] < lo[i - 1] and (lo[i - 1] - h[i]) / prev_close >= MIN_GAP_RATIO:
            found.append(_make("gap_down", i, dates, h, lo))

    found.sort(key=lambda d: (d.end, d.key))
    return found
