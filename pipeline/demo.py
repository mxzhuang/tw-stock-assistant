"""Synthetic daily bars for offline development and screenshots.

Used by ``python -m pipeline --demo`` when no market data source is reachable.
The output is clearly marked as demo data in the exported JSON.
"""

from __future__ import annotations

import zlib

import numpy as np
import pandas as pd


class DemoFetcher:
    def daily_bars(self, code: str, trading_days: int) -> pd.DataFrame:
        rng = np.random.default_rng(zlib.crc32(code.encode()))
        n = trading_days + 120
        dates = pd.bdate_range(end=pd.Timestamp.today().normalize(), periods=n)

        start = float(rng.uniform(40, 900))
        drift = rng.normal(0.0003, 0.0004)
        vol = rng.uniform(0.010, 0.022)
        # Regime-switching returns so trends, reversals and gaps all appear.
        regime = np.repeat(rng.choice([-1.5, 0.0, 1.5], size=n // 40 + 1), 40)[:n]
        returns = drift + regime * vol * 0.25 + rng.normal(0, vol, n)
        close = start * np.exp(np.cumsum(returns))

        prev_close = np.concatenate([[start], close[:-1]])
        gap = rng.normal(0, vol * 0.6, n)
        gap[rng.random(n) < 0.03] *= 4  # occasional larger opening gaps
        open_ = prev_close * (1 + gap)
        body_hi = np.maximum(open_, close)
        body_lo = np.minimum(open_, close)
        high = body_hi * (1 + np.abs(rng.normal(0, vol * 0.5, n)))
        low = body_lo * (1 - np.abs(rng.normal(0, vol * 0.5, n)))
        volume = rng.lognormal(mean=16, sigma=0.5, size=n).round()

        return pd.DataFrame(
            {
                "date": dates.strftime("%Y-%m-%d"),
                "open": open_.round(2),
                "high": high.round(2),
                "low": low.round(2),
                "close": close.round(2),
                "volume": volume,
            }
        )
