import numpy as np
import pandas as pd

from pipeline.demo import DemoFetcher
from pipeline.forecast import DOWN, FEATURES, FLAT, UP, Series, barrier_labels, build_features, run_forecast
from pipeline.patterns import detect
from pipeline.signals import HORIZON, signal_masks


def test_barrier_labels_use_whichever_comes_first():
    flat = [100.0] * (HORIZON + 1)
    up_then_down = [100, 101, 106, 90] + [100.0] * HORIZON
    down_then_up = [100, 94, 110] + [100.0] * HORIZON
    for prices, expected in [(flat, FLAT), (up_then_down, UP), (down_then_up, DOWN)]:
        y, known = barrier_labels(np.array(prices, dtype=float))
        assert known[0] and y[0] == expected
    y, known = barrier_labels(np.array(flat))
    assert not known[-HORIZON:].any()


def test_features_do_not_look_ahead():
    bars = DemoFetcher().daily_bars("2330.TW", 400)
    masks = signal_masks(bars, detect(bars))
    full = build_features(bars, masks, None)
    cut = 300
    short_bars = bars.iloc[:cut].reset_index(drop=True)
    short = build_features(short_bars, signal_masks(short_bars, detect(short_bars)), None)
    a = full[FEATURES].iloc[cut - 1].to_numpy(float)
    b = short[FEATURES].iloc[-1].to_numpy(float)
    assert np.allclose(a, b, equal_nan=True)


def test_forecast_gives_probabilities_and_walk_forward_history():
    fetcher = DemoFetcher()
    series = []
    for code in ["0050.TW", "2330.TW", "2317.TW", "2454.TW"]:
        bars = fetcher.daily_bars(code, 1500)
        series.append(Series(code, True, bars, signal_masks(bars, detect(bars))))
    index_bars = fetcher.daily_bars("TWII", 1500)
    series.append(Series("TWII", False, index_bars, signal_masks(index_bars, detect(index_bars))))

    forecasts, model = run_forecast(series, index_bars)
    assert model["available"] and model["symbols"] == 4
    assert set(forecasts) == {"0050.TW", "2330.TW", "2317.TW", "2454.TW", "TWII"}
    f = forecasts["2330.TW"]
    assert 0 < f["up"] < 1 and 0 < f["down"] < 1 and f["up"] + f["down"] < 1
    history = pd.Series(f["series_up"])
    # The first years have no out-of-sample prediction; later ones do.
    assert history.iloc[:250].isna().all() and history.iloc[-250:].notna().all()
    assert model["folds"] and all(row["train_rows"] > 0 for row in model["folds"])


def test_forecast_declines_without_enough_history():
    bars = DemoFetcher().daily_bars("2330.TW", 200)
    forecasts, model = run_forecast([Series("2330.TW", True, bars, signal_masks(bars, detect(bars)))], None)
    assert forecasts == {} and model == {"available": False}
