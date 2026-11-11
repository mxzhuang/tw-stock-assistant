from pathlib import Path

import pytest

from pipeline.config import load_watchlist

ROOT = Path(__file__).resolve().parent.parent


def write(tmp_path: Path, text: str) -> Path:
    path = tmp_path / "watchlist.yaml"
    path.write_text(text, encoding="utf-8")
    return path


def test_default_watchlist_is_valid():
    wl = load_watchlist(ROOT / "config" / "watchlist.yaml")
    assert wl.stocks
    assert all(s.code.endswith((".TW", ".TWO")) for s in wl.stocks)


def test_market_from_suffix(tmp_path):
    wl = load_watchlist(write(tmp_path, 'stocks:\n  - {code: "6488.two", name: x}\n  - {code: "00878.TW"}\n'))
    assert [s.code for s in wl.stocks] == ["6488.TWO", "00878.TW"]
    assert wl.stocks[0].market == "TPEx"
    assert wl.stocks[1].market == "TWSE"
    assert wl.stocks[1].name == "00878.TW"


@pytest.mark.parametrize("code", ["2330", "2330.T", "AAPL", "../etc", "2330.TW; rm"])
def test_rejects_bad_symbols(tmp_path, code):
    with pytest.raises(ValueError):
        load_watchlist(write(tmp_path, f'stocks:\n  - code: "{code}"\n'))


def test_rejects_duplicates_and_empty(tmp_path):
    with pytest.raises(ValueError):
        load_watchlist(write(tmp_path, 'stocks:\n  - code: "2330.TW"\n  - code: "2330.tw"\n'))
    with pytest.raises(ValueError):
        load_watchlist(write(tmp_path, "stocks: []\n"))


def test_universe_is_merged_without_duplicates(tmp_path):
    watch = write(tmp_path, 'stocks:\n  - {code: "2330.TW", name: "我的台積電"}\n')
    pool = tmp_path / "universe.yaml"
    pool.write_text('stocks:\n  - {code: "2330.TW", name: "台積電"}\n  - {code: "0050.TW"}\n', encoding="utf-8")
    wl = load_watchlist(watch, pool)
    assert [(s.code, s.name, s.role) for s in wl.stocks] == [
        ("2330.TW", "我的台積電", "watch"),
        ("0050.TW", "0050.TW", "pool"),
    ]


def test_default_universe_is_valid():
    wl = load_watchlist(ROOT / "config" / "watchlist.yaml", ROOT / "config" / "universe.yaml")
    assert len(wl.stocks) >= 250
    assert len({s.code for s in wl.stocks}) == len(wl.stocks)
    kinds = {s.kind for s in wl.stocks}
    assert kinds == {"stock", "etf", "index"}
    theme_keys = {t.key for t in wl.themes}
    assert all(set(s.themes) <= theme_keys for s in wl.stocks)
    watched = [s for s in wl.stocks if s.role == "watch"]
    assert watched and all(s.themes for s in watched)


def test_themes_merge_and_indices(tmp_path):
    watch = write(tmp_path, 'stocks:\n  - {code: "2308.TW", name: "台達電"}\n')
    pool = tmp_path / "universe.yaml"
    pool.write_text(
        "indices:\n  - {code: TWII, yahoo: '^TWII', name: 加權指數}\n"
        "themes:\n"
        "  - {key: ai, name: AI, stocks: {2308.TW: 台達電, 2317.TW: 鴻海}}\n"
        "  - {key: robot, name: 機器人, stocks: {2308.TW: 台達電}}\n"
        "  - {key: etf_a, name: ETF, kind: etf, stocks: {0050.TW: 元大台灣50}}\n",
        encoding="utf-8",
    )
    wl = load_watchlist(watch, pool)
    by_code = {s.code: s for s in wl.stocks}
    assert by_code["TWII"].kind == "index" and by_code["TWII"].symbol == "^TWII"
    assert by_code["2308.TW"].themes == ("ai", "robot") and by_code["2308.TW"].role == "watch"
    assert by_code["0050.TW"].kind == "etf"
    assert by_code["2317.TW"].with_other_suffix().code == "2317.TWO"
    assert by_code["TWII"].with_other_suffix() is None


def test_rejects_bad_theme_and_index(tmp_path):
    watch = write(tmp_path, 'stocks:\n  - {code: "2330.TW"}\n')
    pool = tmp_path / "universe.yaml"
    pool.write_text("themes:\n  - {key: 'Bad Key', stocks: {2330.TW: x}}\n", encoding="utf-8")
    with pytest.raises(ValueError):
        load_watchlist(watch, pool)
    pool.write_text("indices:\n  - {code: '^TWII'}\n", encoding="utf-8")
    with pytest.raises(ValueError):
        load_watchlist(watch, pool)
