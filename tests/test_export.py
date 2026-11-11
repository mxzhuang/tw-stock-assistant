import json
from pathlib import Path

from pipeline.__main__ import run
from pipeline.catalog import CATALOG
from pipeline.demo import DemoFetcher


class FlakyFetcher(DemoFetcher):
    def daily_bars(self, code, trading_days):
        if code.startswith("2317"):
            raise RuntimeError("upstream timeout")
        return super().daily_bars(code, trading_days)


def write_watchlist(tmp_path: Path) -> Path:
    path = tmp_path / "watchlist.yaml"
    path.write_text(
        'stocks:\n  - {code: "0050.TW", name: "元大台灣50"}\n  - {code: "2317.TW", name: "鴻海"}\nhistory_days: 120\n',
        encoding="utf-8",
    )
    return path


def test_run_writes_index_catalog_and_stock_files(tmp_path):
    out = tmp_path / "data"
    (out / "stocks").mkdir(parents=True)
    (out / "stocks" / "9999.TW.json").write_text("{}")  # stale file from an old watchlist

    assert run(write_watchlist(tmp_path), out, fetcher=FlakyFetcher()) == 0

    index = json.loads((out / "index.json").read_text(encoding="utf-8"))
    by_code = {s["code"]: s for s in index["stocks"]}
    assert by_code["2317.TW"]["error"] == "upstream timeout"
    assert by_code["0050.TW"]["last_close"] > 0

    stock = json.loads((out / "stocks" / "0050.TW.json").read_text(encoding="utf-8"))
    assert len(stock["candles"]) == 120
    assert stock["schema"] == 3 and stock["role"] == "watch" and stock["kind"] == "stock"
    assert stock["levels"]["trail_stop"] < stock["levels"]["high60"]
    assert set(stock["signals"]["headline"]) == {"risk", "opportunity"}
    times = [c["time"] for c in stock["candles"]]
    assert times == sorted(times) and len(set(times)) == len(times)
    for window, values in stock["ma"].items():
        assert len(values) == 120, window
    first = times[0]
    assert all(p["start"] >= first and p["key"] in CATALOG for p in stock["patterns"])

    catalog = json.loads((out / "catalog.json").read_text(encoding="utf-8"))
    assert set(catalog["patterns"]) == set(CATALOG)
    assert catalog["signals"]["horizon"] == 20
    assert index["defaults"] == ["0050.TW"]
    assert len(by_code["0050.TW"]["spark"]) == 40
    model = json.loads((out / "model.json").read_text(encoding="utf-8"))
    assert model["available"] is index["forecast"]["available"]

    assert not (out / "stocks" / "9999.TW.json").exists()
    assert not (out / "stocks" / "2317.TW.json").exists()


def test_run_fails_when_every_symbol_fails(tmp_path):
    class Broken:
        def daily_bars(self, code, trading_days):
            raise RuntimeError("down")

    assert run(write_watchlist(tmp_path), tmp_path / "data", fetcher=Broken()) == 1


def test_wrong_board_suffix_is_recovered(tmp_path):
    class OtcOnly(DemoFetcher):
        def daily_bars(self, code, trading_days):
            if code.endswith(".TW"):
                raise RuntimeError("not found")
            return super().daily_bars(code, trading_days)

    out = tmp_path / "data"
    path = tmp_path / "watchlist.yaml"
    path.write_text('stocks:\n  - {code: "6488.TW", name: "環球晶"}\nhistory_days: 120\n', encoding="utf-8")
    assert run(path, out, fetcher=OtcOnly()) == 0
    index = json.loads((out / "index.json").read_text(encoding="utf-8"))
    assert [s["code"] for s in index["stocks"]] == ["6488.TWO"]
    assert (out / "stocks" / "6488.TWO.json").exists()


def test_recently_listed_stock_gets_a_chart_without_a_forecast(tmp_path):
    class Short(DemoFetcher):
        def daily_bars(self, code, trading_days):
            bars = super().daily_bars(code, trading_days)
            return bars.tail(100).reset_index(drop=True) if code.startswith("6999") else bars

    out = tmp_path / "data"
    path = tmp_path / "watchlist.yaml"
    path.write_text(
        'stocks:\n  - {code: "6999.TWO", name: "新上櫃"}\n  - {code: "0050.TW", name: "元大台灣50"}\n'
        '  - {code: "2330.TW", name: "台積電"}\n  - {code: "2317.TW", name: "鴻海"}\nhistory_days: 120\n',
        encoding="utf-8",
    )
    assert run(path, out, fetcher=Short()) == 0
    new = json.loads((out / "stocks" / "6999.TWO.json").read_text(encoding="utf-8"))
    assert len(new["candles"]) == 100 and new["forecast"] is None and new["prob"] is None
    old = json.loads((out / "stocks" / "0050.TW.json").read_text(encoding="utf-8"))
    assert old["forecast"] is not None


def test_change_is_withheld_when_the_previous_bar_is_missing():
    from pipeline.export import summarize

    def payload(dates):
        return {
            "code": "0050.TW", "name": "x", "market": "TWSE", "role": "watch", "kind": "etf", "themes": [],
            "candles": [{"time": d, "close": c} for d, c in dates],
            "patterns": [], "forecast": None, "avg_volume_lots": 1, "levels": {"trail_stop": None},
            "signals": {"active": []},
        }

    session = ("2026-11-11", "2026-11-10")
    complete = payload([("2026-11-09", 97.45), ("2026-11-10", 99.7), ("2026-11-11", 103.2)])
    gappy = payload([("2026-11-07", 96.0), ("2026-11-09", 97.45), ("2026-11-11", 103.2)])
    assert summarize(complete, session)["change_pct"] == 3.51
    assert summarize(gappy, session)["change_pct"] is None  # 97.45 -> 103.2 spans two sessions
    assert summarize(gappy)["change_pct"] == 5.9  # without the calendar there is no way to tell
    behind = payload([("2026-11-07", 96.0), ("2026-11-09", 97.45)])
    assert summarize(behind, session)["change_pct"] == 1.51  # an older bar is still a true one-day change
