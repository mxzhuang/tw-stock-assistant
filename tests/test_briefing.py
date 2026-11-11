import json
from datetime import datetime

from pipeline import briefing
from pipeline.fetch import TAIPEI

PROFILE = {
    "holdings": [{"code": "0050.TW", "shares": 1000, "cost": 98.76}, {"code": "bad", "shares": 1, "cost": 1}, {"shares": 1}],
    "watch": ["2330.TW", "not a code"],
}


def profile_file(tmp_path, data=PROFILE):
    path = tmp_path / "profile.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    return path


def loaded(tmp_path):
    return briefing.read_profile(profile_file(tmp_path))

def stock(code, name, close, kind="stock", up=0.4, down=0.3, base_up=0.35, base_down=0.3, **extra):
    return {
        "code": code,
        "name": name,
        "kind": kind,
        "themes": [],
        "last_date": "2026-11-10",
        "last_close": close,
        "change_pct": 1.2,
        "month_pct": 4.0,
        "avg_volume_lots": 5000,
        "forecast": {"up": up, "down": down, "base_up": base_up, "base_down": base_down},
        "trail_stop": close * 0.95,
        "active": [],
        **extra,
    }


INDEX = {
    "demo": False,
    "themes": [],
    "defaults": ["2330.TW"],
    "stocks": [
        stock("TWII", "加權指數", 23000.0, kind="index"),
        stock("0050.TW", "元大台灣50", 97.45, down=0.45, up=0.25, trail_stop=99.0),
        stock("2330.TW", "台積電", 1000.0),
        stock("2317.TW", "鴻海", 200.0, up=0.55, down=0.2),
        {"code": "9999.TW", "name": "壞掉", "kind": "stock", "themes": [], "error": "x"},
    ],
}


def test_profile_is_validated_and_bad_input_is_ignored(tmp_path):
    p = loaded(tmp_path)
    assert [h["code"] for h in p["holdings"]] == ["0050.TW"] and p["watch"] == ["2330.TW"]
    assert briefing.read_profile(None) is None
    assert briefing.read_profile(tmp_path / "missing.json") is None
    (tmp_path / "junk.json").write_text("Value not found", encoding="utf-8")
    assert briefing.read_profile(tmp_path / "junk.json") is None


def test_push_devices_are_validated(tmp_path):
    path = tmp_path / "push.json"
    path.write_text(
        json.dumps({"vapid": {"pub": "p", "priv": "secret"}, "subs": [{"endpoint": "https://a", "keys": {}}, {"endpoint": "http://insecure", "keys": {}}, "x"]}),
        encoding="utf-8",
    )
    push = briefing.read_push(path)
    assert [s["endpoint"] for s in push["subs"]] == ["https://a"] and push["vapid_private"] == "secret"
    assert briefing.read_push(None) == {"subs": [], "vapid_private": None}


def test_slot_follows_taipei_time():
    assert briefing.slot_for(datetime(2026, 11, 11, 8, 40, tzinfo=TAIPEI)) == "pre"
    assert briefing.slot_for(datetime(2026, 11, 11, 14, 50, tzinfo=TAIPEI)) == "post"


def test_rule_based_briefing_covers_holdings_market_and_picks(tmp_path):
    facts = briefing.gather(INDEX, loaded(tmp_path))
    assert facts["holdings"][0]["gain_pct"] == -1.33 and facts["holdings"][0]["below_stop"]
    assert [p["code"] for p in facts["picks"]] == ["2317.TW"]  # held stocks are not suggested again
    body = briefing.rule_based(facts, "post")
    assert body["holdings"][0]["tone"] == "down" and "停損" in body["holdings"][0]["text"]
    assert body["market"][0]["code"] == "TWII" and body["picks"][0]["code"] == "2317.TW"
    assert "元大台灣50" in body["advice"][0]["text"] and body["headline"].startswith("收盤")


def test_model_reply_is_sanitised(tmp_path):
    facts = briefing.gather(INDEX, loaded(tmp_path))
    reply = "好的，以下是摘要：\n" + json.dumps(
        {
            "headline": "台股收紅，0050 接近停損價",
            "holdings": [{"code": "0050.TW", "title": "元大台灣50", "action": "續抱", "text": "先不用動。" + "很長" * 300, "tone": "weird"}],
            "events": [{"title": "11/13", "text": "台積電法說會。"}, {"title": "x"}],
            "market": [{"title": "美股", "text": "費半上漲。", "tone": "up"}],
            "picks": [
                {"code": "2317.TW", "title": "鴻海", "text": "機率高於平常。", "tone": "up"},
                {"code": "1234.TW", "title": "沒給過的股票", "text": "買爆", "tone": "up"},
            ],
            "advice": [{"text": "先決定停損價。"}, "not a dict"],
        },
        ensure_ascii=False,
    )
    body = briefing.parse_reply(reply, facts)
    assert body["holdings"][0]["tone"] == "info" and len(body["holdings"][0]["text"]) <= briefing.MAX_TEXT
    assert [p["code"] for p in body["picks"]] == ["2317.TW"]
    assert body["advice"] == [{"text": "先決定停損價。"}]
    assert body["holdings"][0]["action"] == "續抱"
    assert body["events"] == [{"text": "台積電法說會。", "title": "11/13"}]
    bad = json.dumps({"headline": "h", "holdings": [{"code": "0050.TW", "title": "t", "text": "x", "action": "加碼到滿"}], "market": []})
    assert "action" not in briefing.parse_reply(bad, facts)["holdings"][0]
    assert briefing.parse_reply("no json here", facts) is None
    assert briefing.parse_reply('{"headline": "", "holdings": []}', facts) is None


def test_public_briefing_never_contains_holdings(tmp_path, monkeypatch):
    monkeypatch.delenv(briefing.TOKEN_ENV, raising=False)
    (tmp_path / "index.json").write_text(json.dumps(INDEX), encoding="utf-8")
    private = tmp_path / "private.json"
    assert briefing.run(tmp_path, "pre", profile_file(tmp_path), None, private) == 0

    public_text = (tmp_path / "briefing.json").read_text(encoding="utf-8")
    assert "98.76" not in public_text and "損益" not in public_text
    public = json.loads(public_text)
    assert public["schema"] == 2 and public["personal"] is False and public["body"]["holdings"] == []

    mine = json.loads(private.read_text(encoding="utf-8"))
    assert mine["personal"] is True and mine["body"]["holdings"][0]["code"] == "0050.TW"
    assert mine["body"]["notify"] == ["stop:0050.TW"]


def test_without_sync_only_the_general_briefing_is_written(tmp_path, monkeypatch):
    monkeypatch.delenv(briefing.TOKEN_ENV, raising=False)
    (tmp_path / "index.json").write_text(json.dumps(INDEX), encoding="utf-8")
    private = tmp_path / "private.json"
    assert briefing.run(tmp_path, "post", tmp_path / "missing.json", None, private) == 0
    assert json.loads((tmp_path / "briefing.json").read_text(encoding="utf-8"))["body"]["market"]
    assert not private.exists()


def test_demo_data_gets_no_briefing(tmp_path):
    (tmp_path / "index.json").write_text(json.dumps({**INDEX, "demo": True}), encoding="utf-8")
    assert briefing.run(tmp_path, "pre") == 0
    assert not (tmp_path / "briefing.json").exists()


def test_alerts_only_for_raised_risk_or_strong_picks(tmp_path):
    quiet = {**INDEX, "stocks": [stock("TWII", "加權指數", 23000.0, kind="index"), stock("0050.TW", "元大台灣50", 105.0, trail_stop=99.0)]}
    assert briefing.find_alerts(briefing.gather(quiet, loaded(tmp_path))) == []

    busy = {
        **INDEX,
        "stocks": [
            stock("TWII", "加權指數", 23000.0, kind="index", down=0.45, up=0.2),
            stock("0050.TW", "元大台灣50", 97.45, trail_stop=99.0),
            stock("2330.TW", "台積電", 1000.0, up=0.55, down=0.2),  # tracked
            stock("2317.TW", "鴻海", 200.0, up=0.5, down=0.2),  # leaning up, but not exceptional
            stock("2454.TW", "聯發科", 1500.0, up=0.66, down=0.15, base_up=0.4),
        ],
    }
    keys = [a["key"] for a in briefing.find_alerts(briefing.gather(busy, loaded(tmp_path)))]
    assert keys == ["stop:0050.TW", "risk:TWII", "pick:2330.TW", "pick:2454.TW"]


def test_an_alert_is_new_only_once(tmp_path, monkeypatch):
    monkeypatch.delenv(briefing.TOKEN_ENV, raising=False)
    (tmp_path / "index.json").write_text(json.dumps(INDEX), encoding="utf-8")
    first, second = tmp_path / "first.json", tmp_path / "second.json"
    briefing.run(tmp_path, "pre", profile_file(tmp_path), None, first)
    briefing.run(tmp_path, "post", profile_file(tmp_path), first, second)
    assert json.loads(first.read_text(encoding="utf-8"))["body"]["notify"] == ["stop:0050.TW"]
    assert json.loads(second.read_text(encoding="utf-8"))["body"]["notify"] == []


def test_push_goes_to_every_device_and_only_for_new_alerts(monkeypatch):
    import pywebpush

    calls = []
    monkeypatch.setattr(pywebpush, "webpush", lambda **kw: calls.append(kw["subscription_info"]["endpoint"]))
    push = {"subs": [{"endpoint": "https://a", "keys": {}}, {"endpoint": "https://b", "keys": {}}], "vapid_private": "k"}
    alert = {"key": "stop:0050.TW", "kind": "risk", "text": "t"}
    assert briefing.send_push(push, {"alerts": [alert], "notify": []}, "https://example.test") == 0
    assert briefing.send_push({"subs": [], "vapid_private": "k"}, {"alerts": [alert], "notify": ["stop:0050.TW"]}, "https://example.test") == 0
    assert calls == []
    assert briefing.send_push(push, {"alerts": [alert], "notify": ["stop:0050.TW"]}, "https://example.test") == 2
    assert calls == ["https://a", "https://b"]


def test_prompt_follows_the_published_skills(tmp_path):
    text, names = briefing.load_skills()
    assert names == ["morning-note", "thesis-tracker", "market-news-analyst"]
    assert "Top Call" in text and "Thesis Scorecard" in text
    # Only the chosen sections of the long skill are included, without front matter.
    assert "Impact Magnitude Assessment" in text and "Common Pitfalls to Avoid" in text
    assert "News Collection via WebSearch" not in text and "description:" not in text

    prompt, used = briefing.build_prompt(briefing.gather(INDEX, loaded(tmp_path)), "pre")
    assert used == names and '<skill name="morning-note">' in prompt
    assert "元大台灣50" in prompt and "開盤前" in prompt and "{" + "skills" + "}" not in prompt

    missing, none = briefing.load_skills(tmp_path)
    assert missing == "" and none == []


def test_sections_stop_at_the_next_heading_of_the_same_level():
    doc = "# T\n## A\na1\n### A.1\na2\n## B\nb1\n## C\nc1"
    assert briefing._sections(doc, ("## A",)) == "## A\na1\n### A.1\na2"
    assert briefing._sections(doc, ("## C", "## Nope")) == "## C\nc1"


def test_chosen_model_is_tried_first_then_the_default(tmp_path, monkeypatch):
    facts = briefing.gather(INDEX, loaded(tmp_path))
    good = {"headline": "h", "holdings": [], "market": [{"title": "t", "text": "x", "tone": "info"}], "events": [], "picks": [], "advice": []}
    calls = []

    def fake(cli, prompt, model, f):
        calls.append(model)
        return (None, "") if model == "opus" else (dict(good), "claude-sonnet-x")

    monkeypatch.setenv(briefing.TOKEN_ENV, "t")
    monkeypatch.setenv(briefing.MODEL_ENV, "opus")
    monkeypatch.setattr(briefing.shutil, "which", lambda name: "/usr/bin/claude")
    monkeypatch.setattr(briefing, "_run_claude", fake)
    body = briefing.ask_claude(facts, "pre")
    assert calls == ["opus", ""] and body["model"] == "claude-sonnet-x" and body["skills"]

    calls.clear()
    monkeypatch.setenv(briefing.MODEL_ENV, "opus; rm -rf /")
    briefing.ask_claude(facts, "pre")
    assert calls == [""]  # a malformed value never reaches the command line


def test_helper_models_are_not_reported_as_the_author():
    usage = {"claude-haiku-5-5": {"outputTokens": 9000}, "claude-opus-5-5": {"outputTokens": 1200}}
    assert briefing._answering_model(usage, "opus") == "claude-opus-5-5"
    assert briefing._answering_model({"claude-haiku-5-5": {}}, "opus") == ""  # requested model not seen
    assert briefing._answering_model(usage, "") == ""  # ambiguous without a request
    assert briefing._answering_model({"claude-sonnet-5-5": {}}, "") == "claude-sonnet-5-5"
    assert briefing._answering_model(None, "opus") == ""
