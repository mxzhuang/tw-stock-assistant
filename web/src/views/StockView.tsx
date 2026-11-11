import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadStock } from '../api';
import { PriceChart } from '../chart/PriceChart';
import { ForecastBar } from '../components/ForecastBar';
import { PatternList, type Filter } from '../components/PatternList';
import { priceOf, stockHref, useApp } from '../ctx';
import { baseCode, formatChange, formatLift, formatPct, formatPrice, formatRate, notable, patternId, patternsWithin, shortDate } from '../lib';
import type { Holding, StockData, StockSummary } from '../types';

type Group = 'index' | 'held' | 'watch';
const GROUPS: { value: Group; label: string }[] = [
  { value: 'index', label: '大盤' },
  { value: 'held', label: '持股' },
  { value: 'watch', label: '追蹤' },
];

function GroupStrip({ code }: { code: string }) {
  const { index, byCode, watch, holdings, quotes } = useApp();
  const lists = useMemo(() => {
    const pick = (codes: string[]) => codes.map((c) => byCode.get(c)).filter((s): s is StockSummary => !!s && !s.error);
    return {
      index: index.stocks.filter((s) => s.kind === 'index' && !s.error),
      held: pick(holdings.map((h) => h.code)),
      watch: pick(watch),
    };
  }, [index, byCode, watch, holdings]);

  const home = (): Group => {
    if (lists.index.some((s) => s.code === code)) return 'index';
    if (lists.held.some((s) => s.code === code)) return 'held';
    return 'watch';
  };
  const [group, setGroup] = useState<Group>(home);
  useEffect(() => setGroup(home()), [code]); // eslint-disable-line react-hooks/exhaustive-deps

  const items = lists[group];
  return (
    <div className="strip">
      <div className="seg" role="group" aria-label="清單">
        {GROUPS.map((g) => (
          <button key={g.value} type="button" aria-pressed={group === g.value} onClick={() => setGroup(g.value)}>
            {g.label}
          </button>
        ))}
      </div>
      <nav className="strip-items" aria-label={GROUPS.find((g) => g.value === group)?.label}>
        {items.length === 0 ? (
          <a className="strip-empty" href={group === 'held' ? '#/holdings' : '#/'}>
            {group === 'held' ? '還沒有持股，點這裡新增' : '追蹤清單是空的，到總覽加入'}
          </a>
        ) : (
          items.map((s) => {
            const { change } = priceOf(s, quotes);
            const chg = formatChange(change);
            return (
              <a key={s.code} href={stockHref(s.code)} aria-current={s.code === code ? 'page' : undefined}>
                <span>{s.name}</span>
                <span className={chg.tone}>{chg.text}</span>
              </a>
            );
          })
        )}
      </nav>
    </div>
  );
}

function ForecastPanel({ data }: { data: StockData }) {
  const f = data.forecast;
  const horizon = data.signals.horizon;
  const move = Math.round(data.signals.move * 100);
  if (!f) {
    return (
      <section className="panel forecast">
        <h2>未來一個月的機率</h2>
        <p className="quiet">這檔的歷史資料還不夠長，暫時估不出機率。上市滿一年左右就會有。</p>
      </section>
    );
  }
  const lean = notable(f);
  const flat = Math.max(0, 1 - f.up - f.down);
  return (
    <section className="panel forecast">
      <h2>
        未來 {horizon} 個交易日，先漲 {move}% 還是先跌 {move}%？
      </h2>
      <div className="forecast-ends">
        <div className="forecast-end down">
          <span>先跌 {move}%</span>
          <b>{formatRate(f.down)}</b>
          <small>這檔平常 {formatRate(f.base_down)}</small>
        </div>
        <div className="forecast-mid">
          <ForecastBar forecast={f} size="lg" />
          <small>兩邊都沒碰到 {formatRate(flat)}。深色細線是這檔平常的位置。</small>
        </div>
        <div className="forecast-end up">
          <span>先漲 {move}%</span>
          <b>{formatRate(f.up)}</b>
          <small>這檔平常 {formatRate(f.base_up)}</small>
        </div>
      </div>
      <p className={`verdict ${lean ?? ''}`}>
        {lean === 'down' && '先跌的機率明顯比平常高。手上有這檔的話，留意下面的停損參考價。'}
        {lean === 'up' && '先漲的機率明顯比平常高。想買的話，先看下面的價位表決定跌到哪裡要認錯。'}
        {lean === null && '跟這檔平常的狀況差不多，沒有明顯偏向哪一邊。'}
      </p>
      <div className="reasons">
        <div>
          <h3 className="down">目前偏向先跌的因素</h3>
          {f.why_down.length ? (
            <ul>
              {f.why_down.map((r) => (
                <li key={r.key}>{r.text}</li>
              ))}
            </ul>
          ) : (
            <p className="quiet">目前沒有特別的因素。</p>
          )}
        </div>
        <div>
          <h3 className="up">目前偏向先漲的因素</h3>
          {f.why_up.length ? (
            <ul>
              {f.why_up.map((r) => (
                <li key={r.key}>{r.text}</li>
              ))}
            </ul>
          ) : (
            <p className="quiet">目前沒有特別的因素。</p>
          )}
        </div>
      </div>
      <p className="fine">
        機率是用約 300 檔台股過去十年的走勢統計出來的，不是保證。<a href="#/model">這個數字有多準</a>
      </p>
    </section>
  );
}

interface Rung {
  label: string;
  price: number;
  note: string;
  kind: 'level' | 'now' | 'cost' | 'stop';
}

function Ladder({ data, price, holding }: { data: StockData; price: number; holding: Holding | undefined }) {
  const lv = data.levels;
  const rungs: Rung[] = [{ label: '現價', price, note: '', kind: 'now' }];
  const add = (label: string, value: number | null, note: string, kind: Rung['kind'] = 'level') => {
    if (value != null) rungs.push({ label, price: value, note, kind });
  };
  add('近 60 日最高', lv.high60, '前波高點，漲到這附近容易遇到賣壓。');
  add('月線（20 日均線）', lv.ma20, '短期趨勢。站在上面代表最近一個月買的人平均是賺的。');
  add('季線（60 日均線）', lv.ma60, '中期趨勢的分界，很多人用跌破季線當作轉弱的訊號。');
  add(
    '移動停損參考',
    lv.trail_stop,
    `近 ${lv.trail_bars} 日最高價減 ${lv.trail_atr} 倍的每日平均振幅。收盤跌破，代表這段走勢已經不是正常的震盪，是常見的出場點；股價創高時它會跟著往上移，所以也能用來停利。`,
    'stop',
  );
  add('近 60 日最低', lv.low60, '前波低點，跌破代表創新低。');
  if (holding) add('你的成本', holding.cost, `${holding.shares.toLocaleString('zh-TW')} 股。`, 'cost');
  rungs.sort((a, b) => b.price - a.price);

  return (
    <section className="panel ladder">
      <h2>價位表：什麼價位該注意</h2>
      <ol>
        {rungs.map((r) => {
          const gap = (r.price / price - 1) * 100;
          return (
            <li key={r.label} className={`rung ${r.kind}`}>
              <span className="rung-label">{r.label}</span>
              <b className="rung-price">{formatPrice(r.price)}</b>
              <span className="rung-gap">{r.kind === 'now' ? '' : formatPct(gap)}</span>
              {r.note && <span className="rung-note">{r.note}</span>}
            </li>
          );
        })}
      </ol>
      {lv.atr_pct != null && (
        <p className="fine">
          這檔最近平均每天上下振幅約 {lv.atr_pct.toFixed(1)}%。停損設得比這個還近，很容易被正常的波動洗出場。
        </p>
      )}
    </section>
  );
}

function SignalHistory({ data }: { data: StockData }) {
  const { catalog } = useApp();
  const info = catalog.signals.signals;
  const s = data.signals;
  const move = Math.round(s.move * 100);
  return (
    <details className="panel history">
      <summary>這檔過去出現各種訊號之後的結果</summary>
      <div className="table-wrap">
        <table className="plain">
          <caption>
            {s.history_from.slice(0, 4)} 年以來，訊號出現後 {s.horizon} 個交易日內漲或跌超過 {move}% 的比例。5 天內重複出現只算一次。
          </caption>
          <thead>
            <tr>
              <th scope="col">訊號</th>
              <th scope="col" className="num">
                次數
              </th>
              <th scope="col" className="num">
                事後比例
              </th>
              <th scope="col" className="num">
                平常
              </th>
              <th scope="col" className="num">
                倍數
              </th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(s.stats).map(([key, st]) => {
              const meta = info[key];
              if (!meta) return null;
              const active = s.active.find((a) => a.key === key);
              return (
                <tr key={key}>
                  <th scope="row">
                    <span className={meta.kind === 'risk' ? 'down' : 'up'}>{meta.kind === 'risk' ? '跌' : '漲'}</span> {meta.name}
                    {active && <span className="tag is-on">{shortDate(active.date)} 出現</span>}
                    <span className="rule">{meta.rule}</span>
                  </th>
                  <td className="num">{st.n}</td>
                  <td className="num">{st.show ? formatRate(st.p) : '樣本少'}</td>
                  <td className="num">{formatRate(st.base)}</td>
                  <td className="num">{st.show ? formatLift(st.lift) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </details>
  );
}

export function StockView({ code }: { code: string }) {
  const { index, catalog, byCode, watch, holdings, quotes, toggleWatch } = useApp();
  const [stock, setStock] = useState<StockData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusToken, setFocusToken] = useState(0);
  const cache = useRef(new Map<string, StockData>());

  useEffect(() => {
    setSelectedId(null);
    setError(null);
    const cached = cache.current.get(code);
    if (cached) {
      setStock(cached);
      return;
    }
    let cancelled = false;
    loadStock(code)
      .then((d) => {
        cache.current.set(code, d);
        if (!cancelled) setStock(d);
      })
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [code]);

  const visible = useMemo(() => {
    if (!stock || !range) return [];
    const inView = patternsWithin(stock.patterns, range.from, range.to);
    return filter === 'all' ? inView : inView.filter((p) => catalog.patterns[p.key]?.direction === filter);
  }, [stock, catalog, range, filter]);

  const numbers = useMemo(() => {
    const ordered = [...visible].sort((a, b) => a.end.localeCompare(b.end) || a.key.localeCompare(b.key));
    return new Map(ordered.map((p, i) => [patternId(p), i + 1]));
  }, [visible]);

  const marks = useMemo(
    () =>
      visible.map((p) => {
        const id = patternId(p);
        const info = catalog.patterns[p.key];
        return {
          id,
          num: numbers.get(id) ?? 0,
          bullish: info?.direction === 'bull',
          start: p.start,
          end: p.end,
          top: p.top,
          bottom: p.bottom,
          label: info?.name ?? p.key,
          selected: id === selectedId,
        };
      }),
    [visible, numbers, catalog, selectedId],
  );

  const onVisibleRange = useCallback((from: string, to: string) => {
    setRange((prev) => (prev && prev.from === from && prev.to === to ? prev : { from, to }));
  }, []);
  const selectFromList = useCallback((id: string | null) => {
    setSelectedId(id);
    if (id) setFocusToken((t) => t + 1);
  }, []);

  const summary = byCode.get(code);
  const ready = stock && stock.code === code;
  const themeName = new Map(index.themes.map((t) => [t.key, t.name]));

  if (!summary || summary.error) {
    return (
      <main className="view">
        <GroupStrip code={code} />
        <p className="state" role="alert">
          {summary?.error ? `${summary.name} 今天沒有更新到資料。` : `找不到 ${code}。`}用上面的搜尋框找其他股票。
        </p>
      </main>
    );
  }

  const { price, change, live, time } = priceOf(summary, quotes);
  const chg = formatChange(change);
  const watched = watch.includes(code);
  const holding = holdings.find((h) => h.code === code);
  const isIndex = summary.kind === 'index';

  return (
    <main className="view">
      <GroupStrip code={code} />

      <header className="stock-head">
        <div>
          <h1>{summary.name}</h1>
          <p className="stock-meta">
            {isIndex ? '指數' : `${baseCode(code)} ${summary.market === 'TPEx' ? '上櫃' : '上市'}${summary.kind === 'etf' ? ' ETF' : ''}`}
            {summary.themes.map((t) => (
              <a key={t} className="tag" href={`#/screen?theme=${t}`}>
                {themeName.get(t) ?? t}
              </a>
            ))}
          </p>
        </div>
        <div className="stock-quote">
          <b className={`stock-price ${chg.tone}`}>{formatPrice(price)}</b>
          <span className={chg.tone}>{chg.text}</span>
          <small>{live ? `即時 ${time}${quotes[code]?.delayed ? '（可能慢幾分鐘）' : ''}` : `${shortDate(summary.last_date ?? '')} 收盤`}</small>
        </div>
        {!isIndex && (
          <button type="button" className="follow" aria-pressed={watched} onClick={() => toggleWatch(code)}>
            {watched ? '★ 追蹤中' : '☆ 加入追蹤'}
          </button>
        )}
      </header>

      {error && (
        <p className="state" role="alert">
          這檔股票的資料讀取失敗：{error}
        </p>
      )}
      {!ready && !error && <p className="state">讀取中…</p>}

      {ready && (
        <>
          <div className="duo">
            <ForecastPanel data={stock} />
            {price != null && <Ladder data={stock} price={price} holding={holding} />}
          </div>

          <div className="workspace">
            <PriceChart
              data={stock}
              marks={marks}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onVisibleRange={onVisibleRange}
              focusToken={focusToken}
            />
            <PatternList
              patterns={visible}
              numbers={numbers}
              catalog={catalog}
              filter={filter}
              onFilter={setFilter}
              selectedId={selectedId}
              onSelect={selectFromList}
              refYear={stock.candles.at(-1)?.time.slice(0, 4) ?? ''}
              range={range}
            />
          </div>

          <SignalHistory data={stock} />
          {stock.price_adjusted && <p className="fine">K 線價格已還原除權息，較早的價位會和券商 App 顯示的不同。</p>}
        </>
      )}
    </main>
  );
}
