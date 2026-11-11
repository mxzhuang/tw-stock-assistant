import numpy as np
import pandas as pd

from pipeline.demo import DemoFetcher
from pipeline.patterns import detect
from pipeline.signals import HORIZON, SIGNALS, _thin, evaluate, outcomes, signal_masks


def test_outcomes_use_the_next_horizon_bars_only():
    close = np.full(HORIZON + 5, 100.0)
    close[3] = 94.0  # 6% below the start -> a fall for bars 0..2
    fell, rose, known = outcomes(close)
    assert fell[0] and fell[2]
    assert not fell[3]  # the drop day itself is not in its own future window
    assert np.flatnonzero(rose).tolist() == [3]  # 94 -> 100 is a 6.4% rise
    assert known[:5].all() and not known[-HORIZON:].any()


def test_thin_keeps_first_firing_of_each_cluster():
    mask = np.zeros(30, dtype=bool)
    mask[[2, 3, 4, 20, 22]] = True
    assert np.flatnonzero(_thin(mask)).tolist() == [2, 20]


def test_breakout_fires_on_volume_backed_new_high():
    n = 120
    close = np.full(n, 100.0)
    close[-1] = 110.0
    vol = np.full(n, 1_000_000.0)
    vol[-1] = 3_000_000.0
    bars = pd.DataFrame(
        {
            "date": pd.bdate_range("2026-01-01", periods=n).strftime("%Y-%m-%d"),
            "open": close - 0.5,
            "high": close + 0.5,
            "low": close - 1,
            "close": close,
            "volume": vol,
        }
    )
    masks = signal_masks(bars, [])
    assert masks["breakout"][-1]
    assert not masks["breakout"][:-1].any()


def test_evaluate_reports_consistent_odds():
    bars = DemoFetcher().daily_bars("2330.TW", 2000)
    result = evaluate(bars, detect(bars))
    assert set(result["stats"]) == set(SIGNALS)
    for key, s in result["stats"].items():
        assert 0 <= s["k"] <= s["n"], key
        if s["n"]:
            assert abs(s["p"] - s["k"] / s["n"]) < 1e-3
            base = result["base"][SIGNALS[key].kind]
            assert abs(s["lift"] - s["p"] / base) < 1e-2
    for a in result["active"]:
        assert a["date"] in set(bars["date"].tail(3))


def test_headline_ignores_signals_that_do_not_beat_the_base_rate():
    from pipeline.signals import _headline

    weak = {"key": "a", "kind": "opportunity", "p": 0.3, "lift": 0.8, "n": 40, "show": True, "strong": False}
    good = {"key": "b", "kind": "opportunity", "p": 0.2, "lift": 1.3, "n": 40, "show": True, "strong": False}
    assert _headline([weak], "opportunity") is None
    assert _headline([weak, good], "opportunity")["key"] == "b"
