"""Pattern catalog: what each pattern looks like and how to read it.

Text is written for a beginner in Traditional Chinese (Taiwan). Colors follow the
Taiwan convention: 紅K = close above open, 綠K = close below open.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

BULL = "bull"
BEAR = "bear"

UPTREND = "up"
DOWNTREND = "down"

CONTEXT_TEXT = {
    DOWNTREND: "這個工具只在前一天收盤低於 20 日均線（也就是剛經過一段下跌）時才標出這個型態。",
    UPTREND: "這個工具只在前一天收盤高於 20 日均線（也就是剛經過一段上漲）時才標出這個型態。",
}


@dataclass(frozen=True)
class PatternInfo:
    key: str
    name: str
    direction: str  # bull | bear
    bars: int
    shape: str  # 長什麼樣子
    meaning: str  # 通常代表什麼
    caveat: str  # 要注意什麼
    context: str | None = None  # required trend before the pattern, if any

    def to_json(self) -> dict:
        data = asdict(self)
        data["context_text"] = CONTEXT_TEXT.get(self.context) if self.context else None
        return data


CATALOG: dict[str, PatternInfo] = {
    p.key: p
    for p in [
        PatternInfo(
            key="bullish_engulfing",
            name="多頭吞噬",
            direction=BULL,
            bars=2,
            shape="前一天是綠K，隔天收出一根紅K，紅K的實體把前一天的實體完全包住。",
            meaning="前一天還是賣方佔上風，隔天買盤把整段跌幅吃回來，常被視為止跌的訊號。",
            caveat="出現在一段下跌之後才有意義；當天成交量放大會更可靠。",
            context=DOWNTREND,
        ),
        PatternInfo(
            key="bearish_engulfing",
            name="空頭吞噬",
            direction=BEAR,
            bars=2,
            shape="前一天是紅K，隔天收出一根綠K，綠K的實體把前一天的實體完全包住。",
            meaning="前一天的漲幅一天內被賣光，常被視為漲勢轉弱的訊號。",
            caveat="出現在一段上漲之後才有意義；當天成交量放大會更可靠。",
            context=UPTREND,
        ),
        PatternInfo(
            key="hammer",
            name="錘子線",
            direction=BULL,
            bars=1,
            shape="實體很小、位在K棒上端，下影線很長（約實體兩倍以上），幾乎沒有上影線。",
            meaning="盤中一度跌很深，但收盤前被買盤拉回來，代表低檔有人願意承接。",
            caveat="單獨一根可靠度有限，隔天收紅K確認會比較有參考價值。",
            context=DOWNTREND,
        ),
        PatternInfo(
            key="hanging_man",
            name="吊人線",
            direction=BEAR,
            bars=1,
            shape="形狀跟錘子線一樣：小實體在上端、長下影線，但出現在上漲之後。",
            meaning="漲了一段後盤中突然大跌，表示高檔開始有人倒貨，要留意漲勢鬆動。",
            caveat="需要隔天收綠K確認，單獨出現時常常是假訊號。",
            context=UPTREND,
        ),
        PatternInfo(
            key="inverted_hammer",
            name="倒錘線",
            direction=BULL,
            bars=1,
            shape="實體很小、位在K棒下端，上影線很長，幾乎沒有下影線。",
            meaning="下跌一段後，買方開始嘗試往上攻，雖然被壓回來，但代表有人進場試探。",
            caveat="力道比錘子線弱，一定要看隔天有沒有收紅K接續。",
            context=DOWNTREND,
        ),
        PatternInfo(
            key="shooting_star",
            name="流星線",
            direction=BEAR,
            bars=1,
            shape="實體很小、位在K棒下端，上影線很長，出現在上漲之後。",
            meaning="盤中衝高後被賣壓一路打回來，代表高檔賣壓沉重。",
            caveat="隔天如果繼續收綠K，轉弱的意味會更明確。",
            context=UPTREND,
        ),
        PatternInfo(
            key="morning_star",
            name="晨星",
            direction=BULL,
            bars=3,
            shape="三根K棒：先一根長綠K，接著一根實體很小的K棒（星線），最後一根長紅K收進第一根實體的一半以上。",
            meaning="跌勢 → 猶豫 → 買方反攻，是經典的底部反轉組合。",
            caveat="第三根紅K越長、成交量越大，訊號越強。",
            context=DOWNTREND,
        ),
        PatternInfo(
            key="evening_star",
            name="夜星",
            direction=BEAR,
            bars=3,
            shape="三根K棒：先一根長紅K，接著一根實體很小的K棒（星線），最後一根長綠K跌進第一根實體的一半以下。",
            meaning="漲勢 → 猶豫 → 賣方反撲，是經典的頭部反轉組合。",
            caveat="第三根綠K越長、成交量越大，訊號越強。",
            context=UPTREND,
        ),
        PatternInfo(
            key="bullish_harami",
            name="多頭母子線",
            direction=BULL,
            bars=2,
            shape="前一天是長綠K，隔天是小紅K，小紅K的實體完全落在前一天的實體裡面。",
            meaning="跌勢的力道明顯縮小，市場開始猶豫，可能醞釀轉折。",
            caveat="只代表「可能」轉折，力道比多頭吞噬弱，通常要等後續K棒確認。",
            context=DOWNTREND,
        ),
        PatternInfo(
            key="bearish_harami",
            name="空頭母子線",
            direction=BEAR,
            bars=2,
            shape="前一天是長紅K，隔天是小綠K，小綠K的實體完全落在前一天的實體裡面。",
            meaning="漲勢的力道明顯縮小，市場開始猶豫，可能醞釀轉折。",
            caveat="只代表「可能」轉折，力道比空頭吞噬弱，通常要等後續K棒確認。",
            context=UPTREND,
        ),
        PatternInfo(
            key="piercing",
            name="貫穿線",
            direction=BULL,
            bars=2,
            shape="前一天是長綠K，隔天開得更低，卻收出紅K，收盤超過前一天實體的一半。",
            meaning="開低之後買盤強力反攻，收復了前一天大半的跌幅。",
            caveat="收盤收得越高越好；如果沒有超過一半，就不算這個型態。",
            context=DOWNTREND,
        ),
        PatternInfo(
            key="dark_cloud_cover",
            name="烏雲罩頂",
            direction=BEAR,
            bars=2,
            shape="前一天是長紅K，隔天開得更高，卻收出綠K，收盤跌到前一天實體的一半以下。",
            meaning="開高之後賣壓湧出，吃掉前一天大半的漲幅。",
            caveat="收盤跌得越深越明確；如果沒有跌破一半，就不算這個型態。",
            context=UPTREND,
        ),
        PatternInfo(
            key="three_white_soldiers",
            name="紅三兵",
            direction=BULL,
            bars=3,
            shape="連續三根紅K，每根收盤都比前一根高，而且開盤落在前一根的實體裡。",
            meaning="買盤連續三天穩定推升，常見於跌深後轉強的位置。",
            caveat="如果之前已經漲很多，或第三根特別長，反而可能是短線過熱。",
            context=DOWNTREND,
        ),
        PatternInfo(
            key="three_black_crows",
            name="黑三鴉",
            direction=BEAR,
            bars=3,
            shape="連續三根綠K，每根收盤都比前一根低，而且開盤落在前一根的實體裡。",
            meaning="賣壓連續三天穩定出籠，常見於漲多後轉弱的位置。",
            caveat="如果之前已經跌很多，可能只是短線超跌，不一定會續跌。",
            context=UPTREND,
        ),
        PatternInfo(
            key="dragonfly_doji",
            name="蜻蜓十字",
            direction=BULL,
            bars=1,
            shape="開盤價、收盤價和最高價幾乎一樣，下影線很長，看起來像英文字母 T。",
            meaning="盤中殺低後一路被買回到開盤價，代表低檔承接力道強。",
            caveat="十字線代表多空拉鋸，方向要看隔天怎麼走。",
            context=DOWNTREND,
        ),
        PatternInfo(
            key="gravestone_doji",
            name="墓碑十字",
            direction=BEAR,
            bars=1,
            shape="開盤價、收盤價和最低價幾乎一樣，上影線很長，看起來像倒過來的 T。",
            meaning="盤中衝高後一路被賣回到開盤價，代表高檔賣壓重。",
            caveat="十字線代表多空拉鋸，方向要看隔天怎麼走。",
            context=UPTREND,
        ),
        PatternInfo(
            key="golden_cross",
            name="黃金交叉",
            direction=BULL,
            bars=1,
            shape="5 日均線由下往上穿過 20 日均線。",
            meaning="最近一週的平均成交價，開始高於最近一個月的平均成交價，短線轉強。",
            caveat="盤整時均線會反覆交叉，假訊號很多；在明確趨勢中比較有用。",
        ),
        PatternInfo(
            key="death_cross",
            name="死亡交叉",
            direction=BEAR,
            bars=1,
            shape="5 日均線由上往下穿過 20 日均線。",
            meaning="最近一週的平均成交價，開始低於最近一個月的平均成交價，短線轉弱。",
            caveat="盤整時均線會反覆交叉，假訊號很多；在明確趨勢中比較有用。",
        ),
        PatternInfo(
            key="gap_up",
            name="向上跳空缺口",
            direction=BULL,
            bars=2,
            shape="今天的最低價比昨天的最高價還高，兩天中間留下一段沒有成交的價格空白。",
            meaning="買方非常急，開盤就直接跳過一段價格成交。很多人會把這個缺口當成之後的支撐。",
            caveat="缺口有時很快被回補；除息造成的跳空不算（本工具的價格已還原除權息）。",
        ),
        PatternInfo(
            key="gap_down",
            name="向下跳空缺口",
            direction=BEAR,
            bars=2,
            shape="今天的最高價比昨天的最低價還低，兩天中間留下一段沒有成交的價格空白。",
            meaning="賣方非常急，開盤就直接跳過一段價格成交。很多人會把這個缺口當成之後的壓力。",
            caveat="缺口有時很快被回補；除息造成的跳空不算（本工具的價格已還原除權息）。",
        ),
    ]
}
