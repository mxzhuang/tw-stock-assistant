import pandas as pd

from pipeline.catalog import CATALOG
from pipeline.patterns import detect


def frame(rows):
    """rows: list of (open, high, low, close)."""
    dates = pd.bdate_range("2026-01-05", periods=len(rows)).strftime("%Y-%m-%d")
    return pd.DataFrame(
        [{"date": d, "open": o, "high": h, "low": lo, "close": c, "volume": 1000} for d, (o, h, lo, c) in zip(dates, rows)]
    )


def falling(n, start=120.0):
    # Down candles of mixed size, so TA-Lib has a realistic average body length.
    rows = []
    price = start
    for i in range(n):
        body = 0.6 + (i % 3) * 0.3
        o, c = price, price - body
        rows.append((o, o + 0.3, c - 0.3, c))
        price = c - 0.2
    return rows


def keys(detections):
    return [d.key for d in detections]


def test_bullish_engulfing_after_decline():
    rows = falling(30)
    last_close = rows[-1][3]
    rows.append((last_close, last_close + 0.2, last_close - 1.6, last_close - 1.5))  # long-ish down day
    o2 = last_close - 1.8
    rows.append((o2, last_close + 0.6, o2 - 0.1, last_close + 0.5))  # up day engulfing it
    found = detect(frame(rows))
    hits = [d for d in found if d.key == "bullish_engulfing"]
    assert hits, keys(found)
    last = hits[-1]
    assert last.end == frame(rows)["date"].iloc[-1]
    assert last.start == frame(rows)["date"].iloc[-2]
    assert last.top >= last.bottom


def test_bullish_patterns_need_a_prior_decline():
    # Same two candles, but after a rise: the bullish engulfing must be filtered out.
    rising = [(100 + i, 101.3 + i, 99.7 + i, 101 + i) for i in range(30)]
    base = rising[-1][3]
    rising.append((base, base + 0.2, base - 1.6, base - 1.5))
    rising.append((base - 1.8, base + 0.6, base - 1.9, base + 0.5))
    assert "bullish_engulfing" not in keys(detect(frame(rising)))


def test_golden_and_death_cross():
    down = [(100 - i, 100.5 - i, 98.5 - i, 99 - i) for i in range(25)]
    up = [(75 + 2 * i, 77.5 + 2 * i, 74.5 + 2 * i, 77 + 2 * i) for i in range(15)]
    down2 = [(105 - 3 * i, 105.5 - 3 * i, 101.5 - 3 * i, 102 - 3 * i) for i in range(15)]
    found = keys(detect(frame(down + up + down2)))
    assert "golden_cross" in found
    assert "death_cross" in found
    assert found.index("golden_cross") < found.index("death_cross")


def test_gap_up_and_minimum_size():
    rows = [(100, 101, 99, 100.5)] * 5
    rows += [(103, 104, 102.5, 103.5)]  # low 102.5 > prior high 101 -> gap of ~1.5%
    rows += [(103.5, 104.2, 104.05, 104.1)]  # low 104.05 vs high 104 -> too small to count
    found = detect(frame(rows))
    gaps = [d for d in found if d.key == "gap_up"]
    assert len(gaps) == 1
    assert gaps[0].end == frame(rows)["date"].iloc[5]


def test_every_detection_is_in_catalog_and_bars_match():
    from pipeline.demo import DemoFetcher

    bars = DemoFetcher().daily_bars("2330.TW", 400)
    found = detect(bars)
    assert found, "demo data should contain at least some patterns"
    date_index = {d: i for i, d in enumerate(bars["date"])}
    for d in found:
        info = CATALOG[d.key]
        assert date_index[d.end] - date_index[d.start] + 1 == info.bars
        assert d.start <= d.end


def test_short_input_returns_nothing():
    assert detect(frame([(1, 2, 0.5, 1.5)] * 2)) == []
