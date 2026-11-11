import { useEffect, useMemo, useState } from 'react';
import { ForecastBar } from '../components/ForecastBar';
import { priceOf, stockHref, useApp } from '../ctx';
import { baseCode, edge, formatChange, formatPct, formatPrice, searchStocks, tone } from '../lib';
import type { StockSummary } from '../types';

type SortKey = 'edge' | 'up' | 'upGap' | 'down' | 'change' | 'month' | 'volume';
type KindFilter = 'all' | 'stock' | 'etf';

const SORTS: { value: SortKey; label: string }[] = [
  { value: 'edge', label: '漲多於跌（先漲 − 先跌）' },
  { value: 'up', label: '先漲機率最高' },
  { value: 'upGap', label: '先漲機率比平常高最多' },
  { value: 'down', label: '先跌機率最高' },
  { value: 'change', label: '今天漲幅' },
  { value: 'month', label: '近一個月漲幅' },
  { value: 'volume', label: '成交量' },
];

const PAGE = 40;
const MIN_LOTS = 1000;

function sortValue(s: StockSummary, key: SortKey): number {
  const f = s.forecast;
  switch (key) {
    case 'edge':
      return edge(f);
    case 'up':
      return f?.up ?? -1;
    case 'upGap':
      return f && f.base_up != null ? f.up - f.base_up : -1;
    case 'down':
      return f?.down ?? -1;
    case 'change':
      return s.change_pct ?? -Infinity;
    case 'month':
      return s.month_pct ?? -Infinity;
    case 'volume':
      return s.avg_volume_lots ?? -1;
  }
}

interface Props {
  theme: string | null;
  onTheme: (key: string | null) => void;
}

export function ScreenView({ theme, onTheme }: Props) {
  const { index, watch, toggleWatch, quotes } = useApp();
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<KindFilter>('all');
  const [sort, setSort] = useState<SortKey>('edge');
  const [liquid, setLiquid] = useState(true);
  const [shown, setShown] = useState(PAGE);

  const themeName = useMemo(() => new Map(index.themes.map((t) => [t.key, t.name])), [index]);
  const all = useMemo(() => index.stocks.filter((s) => s.kind !== 'index' && !s.error), [index]);

  const rows = useMemo(() => {
    let list = query.trim() ? searchStocks(all, query, 500) : all;
    if (theme) list = list.filter((s) => s.themes.includes(theme));
    if (kind !== 'all') list = list.filter((s) => s.kind === kind);
    if (liquid && !query.trim()) list = list.filter((s) => (s.avg_volume_lots ?? 0) >= MIN_LOTS);
    return [...list].sort((a, b) => sortValue(b, sort) - sortValue(a, sort));
  }, [all, query, theme, kind, liquid, sort]);

  useEffect(() => setShown(PAGE), [query, theme, kind, liquid, sort]);

  const themes = index.themes.filter((t) => kind === 'all' || t.kind === kind);

  return (
    <main className="view">
      <header className="view-head">
        <h1>選股</h1>
        <p>
          從 {all.length} 檔常見的股票和 ETF 裡找。可以搜尋、依題材篩選，或照模型估的機率排序。排在前面不代表一定會漲，點進去看線圖和理由再決定。
        </p>
      </header>

      <div className="filters">
        <input
          type="search"
          className="filter-search"
          placeholder="搜尋代號或名稱，例如 2330、台積電"
          aria-label="搜尋股票"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="seg" role="group" aria-label="類型">
          {(['all', 'stock', 'etf'] as const).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={kind === k}
              onClick={() => {
                setKind(k);
                onTheme(null);
              }}
            >
              {k === 'all' ? '全部' : k === 'stock' ? '個股' : 'ETF'}
            </button>
          ))}
        </div>
        <label className="filter-sort">
          排序
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={liquid} onChange={(e) => setLiquid(e.target.checked)} />
          只看日均量 {MIN_LOTS.toLocaleString('zh-TW')} 張以上
        </label>
      </div>

      <div className="chips" role="group" aria-label="題材">
        <button type="button" aria-pressed={theme === null} onClick={() => onTheme(null)}>
          全部題材
        </button>
        {themes.map((t) => (
          <button key={t.key} type="button" aria-pressed={theme === t.key} onClick={() => onTheme(theme === t.key ? null : t.key)}>
            {t.name}
          </button>
        ))}
      </div>

      <p className="count" aria-live="polite">
        符合條件的有 {rows.length} 檔
      </p>

      {rows.length === 0 ? (
        <p className="quiet">沒有符合的股票。試試取消成交量限制，或換一個題材。</p>
      ) : (
        <div className="table-wrap">
          <table className="screen">
            <thead>
              <tr>
                <th scope="col">名稱</th>
                <th scope="col" className="num">
                  價格
                </th>
                <th scope="col" className="num">
                  今天
                </th>
                <th scope="col" className="num hide-s">
                  近一月
                </th>
                <th scope="col">
                  <span className="fhead">
                    <span className="down">先跌</span>
                    <span>未來一個月</span>
                    <span className="up">先漲</span>
                  </span>
                </th>
                <th scope="col" className="hide-m">
                  題材
                </th>
                <th scope="col">
                  <span className="sr">追蹤</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, shown).map((s) => {
                const { price, change } = priceOf(s, quotes);
                const chg = formatChange(change);
                const on = watch.includes(s.code);
                return (
                  <tr key={s.code}>
                    <th scope="row">
                      <a href={stockHref(s.code)}>
                        <span className="row-title">{s.name}</span>
                        <span className="row-code">
                          {baseCode(s.code)}
                          {s.kind === 'etf' ? ' ETF' : ''}
                        </span>
                      </a>
                    </th>
                    <td className="num">{formatPrice(price)}</td>
                    <td className={`num ${chg.tone}`}>{chg.text}</td>
                    <td className={`num hide-s ${tone(s.month_pct)}`}>{formatPct(s.month_pct)}</td>
                    <td>
                      <ForecastBar forecast={s.forecast} />
                    </td>
                    <td className="hide-m themes-cell">
                      {s.themes.map((t) => (
                        <button key={t} type="button" className="tag" onClick={() => onTheme(t)}>
                          {themeName.get(t) ?? t}
                        </button>
                      ))}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="star"
                        aria-pressed={on}
                        aria-label={on ? `取消追蹤 ${s.name}` : `追蹤 ${s.name}`}
                        onClick={() => toggleWatch(s.code)}
                      >
                        {on ? '★' : '☆'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > shown && (
        <button type="button" className="more" onClick={() => setShown((n) => n + PAGE)}>
          再顯示 {Math.min(PAGE, rows.length - shown)} 檔
        </button>
      )}
    </main>
  );
}
