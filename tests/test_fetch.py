"""Integration with the vendored daily_stock_analysis fetcher (Yahoo is mocked)."""

from datetime import date
from unittest import mock

import numpy as np
import pandas as pd
import pytest

from pipeline.fetch import VENDOR_DIR, fetch_window, normalize_bars


def test_fetch_window_ends_tomorrow_and_covers_lookback():
    start, end = fetch_window(500, today=date(2026, 11, 10))
    assert end == "2026-11-11"
    assert start == "2024-04-24"  # (500 + 120) * 1.5 = 930 calendar days back

pytestmark = pytest.mark.skipif(
    not (VENDOR_DIR / "data_provider").is_dir(), reason="submodule not checked out"
)


def fake_yahoo_download(ticker: str, n: int = 260) -> pd.DataFrame:
    idx = pd.bdate_range("2025-06-02", periods=n, name="Date")
    cols = pd.MultiIndex.from_product(
        [["Close", "High", "Low", "Open", "Volume"], [ticker]], names=["Price", "Ticker"]
    )
    close = 100 + np.cumsum(np.random.default_rng(1).normal(0, 1, n))
    data = np.c_[close, close + 1, close - 1, close - 0.2, np.full(n, 2_000_000)]
    return pd.DataFrame(data, index=idx, columns=cols)


def test_vendor_fetcher_returns_normalized_bars():
    from pipeline.fetch import DailyBarFetcher

    with mock.patch("yfinance.download", return_value=fake_yahoo_download("2330.TW")) as dl:
        bars = DailyBarFetcher().daily_bars("2330.TW", 120)

    assert dl.call_args.kwargs["tickers"] == "2330.TW"
    # Yahoo's end date is exclusive: it must be after today, or today's bar is lost.
    assert dl.call_args.kwargs["end"] > date.today().isoformat()
    assert list(bars.columns) == ["date", "open", "high", "low", "close", "volume"]
    assert bars["date"].is_monotonic_increasing
    assert len(bars) > 120


def test_normalize_drops_bad_rows_and_duplicates():
    raw = pd.DataFrame(
        {
            "date": ["2026-01-06", "2026-01-05", "2026-01-06", "2026-01-07"],
            "open": [10, 9, 10.5, None],
            "high": [11, 10, 11, 12],
            "low": [9, 8, 10, 11],
            "close": [10.5, 9.5, 10.8, 11.5],
            "volume": [100, None, 120, 90],
            "amount": [0, 0, 0, 0],
        }
    )
    out = normalize_bars(raw)
    assert out["date"].tolist() == ["2026-01-05", "2026-01-06"]
    assert out.loc[1, "close"] == 10.8  # last duplicate wins
    assert out.loc[0, "volume"] == 0


def test_unfinished_bar_is_dropped_only_during_the_session():
    from datetime import datetime

    import pandas as pd

    from pipeline.fetch import TAIPEI, drop_unfinished_bar

    bars = pd.DataFrame({"date": ["2026-11-10", "2026-11-11"], "close": [1.0, 2.0]})
    midday = datetime(2026, 11, 11, 12, 15, tzinfo=TAIPEI)
    after_close = datetime(2026, 11, 11, 14, 40, tzinfo=TAIPEI)
    next_morning = datetime(2026, 11, 12, 8, 0, tzinfo=TAIPEI)
    assert drop_unfinished_bar(bars, midday)["date"].tolist() == ["2026-11-10"]
    assert len(drop_unfinished_bar(bars, after_close)) == 2
    assert len(drop_unfinished_bar(bars, next_morning)) == 2
