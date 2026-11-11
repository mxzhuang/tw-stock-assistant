"""Probability forecast: which comes first in the next month, a 5% rise or a 5% fall?

Every trading day of every stock in the universe becomes one training row:

* the features describe that day using only data known at its close (trend,
  distance from moving averages, volatility, volume, the rule-based signals and
  the state of the broad market);
* the label says what happened next: within HORIZON trading days the close first
  rose MOVE above that day's close ("up"), first fell MOVE below it ("down"), or
  did neither ("flat").

One multinomial logistic regression is fitted on all stocks together. It is
validated walk-forward: each calendar year is predicted by a model that only saw
earlier years, and those out-of-sample predictions are what the reported
accuracy and the on-chart history are built from.

This is a statistical summary of how similar past situations resolved. It is not
a promise about any single stock.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date, timedelta

import numpy as np
import pandas as pd
import talib
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score

from .signals import HORIZON, MOVE, SIGNALS

log = logging.getLogger("pipeline.forecast")

FLAT, UP, DOWN = 0, 1, 2
SIGNAL_WINDOW = 3  # a rule-based signal counts for this many bars after it fires
TRAIN_STRIDE = 3  # neighbouring days share most of their label window
MIN_TRAIN_YEARS = 3
MIN_TRAIN_ROWS = 1000
REGULARISATION = 0.3
MAX_REASONS = 3
MIN_REASON_EFFECT = 0.03
MIN_CALIBRATION_ROWS = 5000

# feature -> (what a high value means, what a low value means)
FEATURE_TEXT: dict[str, tuple[str | None, str | None]] = {
    "ret5": ("最近一週漲得多", "最近一週跌得多"),
    "ret20": ("最近一個月漲得多", "最近一個月跌得多"),
    "ret60": ("最近一季漲得多", "最近一季跌得多"),
    "dist_ma20": ("股價離月線很遠（在上方）", "股價跌到月線下方很遠"),
    "dist_ma60": ("股價遠高於季線", "股價遠低於季線"),
    "dist_ma120": ("股價遠高於半年線", "股價遠低於半年線"),
    "slope_ma60": ("季線往上走", "季線往下走"),
    "vol20": ("最近一個月波動大", "最近一個月波動小"),
    "vol_ratio": ("波動比前一季放大", "波動比前一季收斂"),
    "atr": ("每天的振幅大", "每天的振幅小"),
    "rsi": ("RSI 偏高", "RSI 偏低"),
    "pos52": ("接近一年來的高點", "接近一年來的低點"),
    "volume_ratio": ("成交量比平常大", "成交量比平常小"),
    "macd": ("MACD 柱狀體在零軸上方", "MACD 柱狀體在零軸下方"),
    "boll": ("貼近布林通道上緣", "貼近布林通道下緣"),
    "mkt_ret20": ("大盤最近一個月上漲", "大盤最近一個月下跌"),
    "mkt_dist_ma60": ("大盤站在季線之上", "大盤跌破季線"),
    "mkt_vol20": ("大盤波動大", "大盤波動小"),
}
for _key, _info in SIGNALS.items():
    FEATURE_TEXT[f"sig_{_key}"] = (f"出現「{_info.name}」訊號", None)

FEATURES = list(FEATURE_TEXT)
MARKET_FEATURES = ["mkt_ret20", "mkt_dist_ma60", "mkt_vol20"]


def barrier_labels(close: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Label each bar UP / DOWN / FLAT by which barrier the close reaches first."""
    n = len(close)
    y = np.zeros(n, dtype=np.int8)
    known = np.zeros(n, dtype=bool)
    m = n - HORIZON
    if m <= 0:
        return y, known
    ahead = np.arange(m)[:, None] + np.arange(1, HORIZON + 1)[None, :]
    change = close[ahead] / close[:m, None] - 1
    up = change >= MOVE
    down = change <= -MOVE
    first_up = np.where(up.any(axis=1), up.argmax(axis=1), HORIZON + 1)
    first_down = np.where(down.any(axis=1), down.argmax(axis=1), HORIZON + 1)
    y[:m] = np.where(first_up < first_down, UP, np.where(first_down < first_up, DOWN, FLAT))
    known[:m] = True
    return y, known


def market_features(bars: pd.DataFrame) -> pd.DataFrame:
    """Broad-market state per date, joined onto every stock."""
    close = bars["close"].astype(float)
    log_ret = np.log(close).diff()
    return pd.DataFrame(
        {
            "date": bars["date"],
            "mkt_ret20": np.log(close / close.shift(20)),
            "mkt_dist_ma60": close / close.rolling(60).mean() - 1,
            "mkt_vol20": log_ret.rolling(20).std(),
        }
    )


def build_features(
    bars: pd.DataFrame, masks: dict[str, np.ndarray], market: pd.DataFrame | None
) -> pd.DataFrame:
    """One row per bar; NaN where there is not enough history yet."""
    close = bars["close"].astype(float)
    high = bars["high"].astype(float)
    low = bars["low"].astype(float)
    volume = bars["volume"].astype(float)
    log_ret = np.log(close).diff()

    ma20 = close.rolling(20).mean()
    ma60 = close.rolling(60).mean()
    ma120 = close.rolling(120).mean()
    std20 = close.rolling(20).std()
    vol20 = log_ret.rolling(20).std()
    vol60 = log_ret.rolling(60).std()
    hi250 = high.rolling(250, min_periods=120).max()
    lo250 = low.rolling(250, min_periods=120).min()
    _, _, macd_hist = talib.MACD(close.to_numpy(), 12, 26, 9)

    with np.errstate(divide="ignore", invalid="ignore"):
        vol5 = volume.rolling(5).mean()
        vol60_avg = volume.rolling(60).mean()
        volume_ratio = np.log(vol5 / vol60_avg).replace([np.inf, -np.inf], np.nan).fillna(0.0)
        out = pd.DataFrame(
            {
                "date": bars["date"],
                "ret5": np.log(close / close.shift(5)),
                "ret20": np.log(close / close.shift(20)),
                "ret60": np.log(close / close.shift(60)),
                "dist_ma20": close / ma20 - 1,
                "dist_ma60": close / ma60 - 1,
                "dist_ma120": close / ma120 - 1,
                "slope_ma60": ma60 / ma60.shift(20) - 1,
                "vol20": vol20,
                "vol_ratio": np.log(vol20 / vol60),
                "atr": talib.ATR(high.to_numpy(), low.to_numpy(), close.to_numpy(), 14) / close,
                "rsi": talib.RSI(close.to_numpy(), 14) / 100,
                "pos52": (close - lo250) / (hi250 - lo250),
                "volume_ratio": volume_ratio,
                "macd": macd_hist / close,
                "boll": (close - ma20) / (2 * std20),
            }
        )

    if market is not None:
        joined = out[["date"]].merge(market, on="date", how="left").ffill()
        for col in MARKET_FEATURES:
            out[col] = joined[col].to_numpy()
    else:
        for col in MARKET_FEATURES:
            out[col] = 0.0

    for key in SIGNALS:
        fired = pd.Series(masks[key].astype(float))
        out[f"sig_{key}"] = fired.rolling(SIGNAL_WINDOW, min_periods=1).max().to_numpy()

    return out.replace([np.inf, -np.inf], np.nan)


@dataclass
class Series:
    """Everything the model needs about one symbol."""

    code: str
    trainable: bool  # indices are predicted but not trained on
    bars: pd.DataFrame
    masks: dict[str, np.ndarray]


@dataclass
class _Fitted:
    lo: np.ndarray
    hi: np.ndarray
    mean: np.ndarray
    std: np.ndarray
    model: LogisticRegression

    def scale(self, x: np.ndarray) -> np.ndarray:
        return (np.clip(x, self.lo, self.hi) - self.mean) / self.std

    def proba(self, x: np.ndarray) -> np.ndarray:
        return self.model.predict_proba(self.scale(x))


def _fit(x: np.ndarray, y: np.ndarray) -> _Fitted | None:
    if len(y) < MIN_TRAIN_ROWS or len(np.unique(y)) < 3:
        return None
    lo, hi = np.percentile(x, [0.5, 99.5], axis=0)
    clipped = np.clip(x, lo, hi)
    mean = clipped.mean(axis=0)
    std = clipped.std(axis=0)
    std[std == 0] = 1.0
    model = LogisticRegression(C=REGULARISATION, max_iter=300)
    model.fit((clipped - mean) / std, y)
    return _Fitted(lo, hi, mean, std, model)


def _calibrator(p: np.ndarray, hit: np.ndarray) -> IsotonicRegression | None:
    """Map raw model output to how often the event really followed it."""
    if len(p) < MIN_CALIBRATION_ROWS:
        return None
    return IsotonicRegression(y_min=0.0, y_max=1.0, out_of_bounds="clip").fit(p, hit)


def _calibrate(proba: np.ndarray, calibrators: dict[int, IsotonicRegression | None]) -> np.ndarray:
    """Apply per-direction calibration, keeping the three chances summing to one."""
    out = proba.copy()
    for klass, cal in calibrators.items():
        if cal is not None:
            out[:, klass] = cal.predict(proba[:, klass])
    both = out[:, UP] + out[:, DOWN]
    over = both > 0.98
    out[over, UP] *= 0.98 / both[over]
    out[over, DOWN] *= 0.98 / both[over]
    out[:, FLAT] = 1 - out[:, UP] - out[:, DOWN]
    return out


def _cutoff(year: int) -> str:
    """Last training date for a test year: far enough back that labels are closed."""
    return (date(year, 1, 1) - timedelta(days=int(HORIZON * 1.6))).isoformat()


def _reasons(fitted: _Fitted, row: np.ndarray, klass: int) -> list[dict]:
    """What tilts today's odds towards `klass` rather than the opposite direction.

    Using the difference between the two directions keeps out factors such as
    high volatility that raise both chances at once.
    """
    other = DOWN if klass == UP else UP
    z = fitted.scale(row[None, :])[0]
    effect = (fitted.model.coef_[klass] - fitted.model.coef_[other]) * z
    reasons = []
    for i in np.argsort(-effect):
        if effect[i] < MIN_REASON_EFFECT or len(reasons) == MAX_REASONS:
            break
        hi_text, lo_text = FEATURE_TEXT[FEATURES[i]]
        text = hi_text if z[i] > 0 else lo_text
        if text:
            reasons.append({"key": FEATURES[i], "text": text})
    return reasons


def _calibration(p: np.ndarray, hit: np.ndarray) -> list[dict]:
    rows = []
    for lo in np.arange(0, 1, 0.1):
        sel = (p >= lo) & (p < lo + 0.1)
        if sel.sum() >= 200:
            rows.append(
                {
                    "from": round(float(lo), 1),
                    "to": round(float(lo + 0.1), 1),
                    "n": int(sel.sum()),
                    "predicted": round(float(p[sel].mean()), 4),
                    "actual": round(float(hit[sel].mean()), 4),
                }
            )
    return rows


def _score(p: np.ndarray, hit: np.ndarray) -> dict:
    base = float(hit.mean())
    brier = float(np.mean((p - hit) ** 2))
    brier_ref = base * (1 - base)
    top = p >= np.quantile(p, 0.9)
    bottom = p <= np.quantile(p, 0.1)
    return {
        "n": int(len(hit)),
        "base": round(base, 4),
        "auc": round(float(roc_auc_score(hit, p)), 4) if 0 < base < 1 else None,
        "skill": round(1 - brier / brier_ref, 4) if brier_ref else None,
        "top_decile": round(float(hit[top].mean()), 4),
        "bottom_decile": round(float(hit[bottom].mean()), 4),
        "calibration": _calibration(p, hit),
    }


def run_forecast(series: list[Series], market_bars: pd.DataFrame | None) -> tuple[dict[str, dict], dict]:
    """Fit, validate and predict. Returns per-code forecasts and a model summary."""
    market = market_features(market_bars) if market_bars is not None else None

    frames = []
    for s in series:
        feats = build_features(s.bars, s.masks, market)
        y, known = barrier_labels(s.bars["close"].to_numpy(float))
        feats["code"] = s.code
        feats["trainable"] = s.trainable
        feats["y"] = y
        feats["known"] = known
        feats["pos"] = np.arange(len(feats))
        frames.append(feats)
    if not frames:
        return {}, {"available": False}
    data = pd.concat(frames, ignore_index=True)

    x_all = data[FEATURES].to_numpy(float)
    usable = np.isfinite(x_all).all(axis=1)
    y_all = data["y"].to_numpy()
    known = data["known"].to_numpy()
    dates = data["date"].to_numpy()
    train_ok = usable & known & data["trainable"].to_numpy() & (data["pos"].to_numpy() % TRAIN_STRIDE == 0)

    years = sorted({int(d[:4]) for d in dates[usable]})
    year_of = np.array([int(d[:4]) for d in dates])
    trainable = data["trainable"].to_numpy()
    raw = np.full((len(data), 3), np.nan)  # walk-forward output before calibration
    oos = np.full((len(data), 3), np.nan)
    folds = []

    def calibrators(before: str | None) -> dict[int, IsotonicRegression | None]:
        """Fit on walk-forward predictions whose outcome was known by `before`."""
        seen = known & trainable & np.isfinite(raw[:, 0])
        if before is not None:
            seen &= dates <= before
        return {k: _calibrator(raw[seen, k], (y_all[seen] == k).astype(float)) for k in (UP, DOWN)}

    for year in years[MIN_TRAIN_YEARS:]:
        train = train_ok & (dates <= _cutoff(year))
        test = usable & (year_of == year)
        fitted = _fit(x_all[train], y_all[train])
        if fitted is None or not test.any():
            continue
        raw[test] = fitted.proba(x_all[test])
        # Calibrate this year with what earlier years' predictions taught us.
        oos[test] = _calibrate(raw[test], calibrators(_cutoff(year)))
        folds.append({"year": year, "train_rows": int(train.sum())})

    final = _fit(x_all[train_ok], y_all[train_ok])
    if final is None:
        log.warning("not enough history to fit the forecast model")
        return {}, {"available": False}

    # History uses out-of-sample predictions; the newest bar uses the model
    # trained on everything, so today's number benefits from the latest data.
    live = np.full((len(data), 3), np.nan)
    live[usable] = _calibrate(final.proba(x_all[usable]), calibrators(None))

    forecasts: dict[str, dict] = {}
    for code, group in data.groupby("code", sort=False):
        idx = group.index.to_numpy()
        last = idx[-1]
        if not usable[last]:
            continue
        k = known[idx] & usable[idx]
        hist = oos[idx].copy()
        hist[-1] = live[last]
        forecasts[code] = {
            "up": round(float(live[last, UP]), 4),
            "down": round(float(live[last, DOWN]), 4),
            "base_up": round(float((y_all[idx][k] == UP).mean()), 4) if k.any() else None,
            "base_down": round(float((y_all[idx][k] == DOWN).mean()), 4) if k.any() else None,
            "why_up": _reasons(final, x_all[last], UP),
            "why_down": _reasons(final, x_all[last], DOWN),
            "series_up": hist[:, UP],
            "series_down": hist[:, DOWN],
        }

    scored = known & data["trainable"].to_numpy() & np.isfinite(oos[:, 0])
    summary: dict = {
        "available": True,
        "horizon": HORIZON,
        "move": MOVE,
        "train_rows": int(train_ok.sum()),
        "symbols": int(data.loc[data["trainable"], "code"].nunique()),
        "from": str(dates[usable].min()),
        "to": str(dates[usable].max()),
        "folds": folds,
        "validated": bool(scored.sum() >= 1000),
        "features": [
            {
                "key": f,
                "text": FEATURE_TEXT[f][0],
                "up": round(float(final.model.coef_[UP][i]), 4),
                "down": round(float(final.model.coef_[DOWN][i]), 4),
            }
            for i, f in enumerate(FEATURES)
        ],
    }
    if summary["validated"]:
        summary["up"] = _score(oos[scored, UP], (y_all[scored] == UP).astype(float))
        summary["down"] = _score(oos[scored, DOWN], (y_all[scored] == DOWN).astype(float))
        log.info(
            "forecast OOS (%d rows, %d folds): up AUC %.3f skill %.3f top10%% %.1f%% vs base %.1f%% | "
            "down AUC %.3f skill %.3f top10%% %.1f%% vs base %.1f%%",
            int(scored.sum()),
            len(folds),
            summary["up"]["auc"] or 0,
            summary["up"]["skill"] or 0,
            summary["up"]["top_decile"] * 100,
            summary["up"]["base"] * 100,
            summary["down"]["auc"] or 0,
            summary["down"]["skill"] or 0,
            summary["down"]["top_decile"] * 100,
            summary["down"]["base"] * 100,
        )
        for side in ("up", "down"):
            for row in summary[side]["calibration"]:
                log.info("  %s %.0f-%.0f%%: predicted %.1f%% actual %.1f%% (n=%d)", side, row["from"] * 100, row["to"] * 100, row["predicted"] * 100, row["actual"] * 100, row["n"])
    return forecasts, summary
