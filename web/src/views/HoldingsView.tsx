import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { loadStock } from '../api';
import { ForecastBar } from '../components/ForecastBar';
import { SignIn } from '../components/SignIn';
import { priceOf, stockHref, useApp } from '../ctx';
import { upsertHolding } from '../holdings';
import { baseCode, formatMoney, formatPct, formatPrice, formatRate, recoveryOdds, tone } from '../lib';
import type { StockSummary } from '../types';

const RECOVERY_HORIZON = 60;

function resolveCode(input: string, stocks: StockSummary[]): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const upper = raw.toUpperCase();
  const hit = stocks.find((s) => s.kind !== 'index' && !s.error && (s.code === upper || baseCode(s.code) === upper || s.name === raw));
  return hit?.code ?? null;
}

export function HoldingsView() {
  const { index, byCode, holdings, setHoldings, quotes, storageOk, sync } = useApp();
  const [form, setForm] = useState({ code: '', shares: '', cost: '' });
  const [error, setError] = useState<string | null>(null);
  const [closes, setCloses] = useState<Record<string, number[]>>({});

  useEffect(() => {
    for (const h of holdings) {
      const s = byCode.get(h.code);
      if (closes[h.code] || !s || s.error) continue;
      loadStock(h.code)
        .then((d) => setCloses((prev) => ({ ...prev, [h.code]: d.candles.map((c) => c.close) })))
        .catch(() => undefined);
    }
  }, [holdings, byCode, closes]);

  const update = (field: keyof typeof form, value: string) => {
    setForm((f) => ({ ...f, [field]: value }));
    setError(null);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const code = resolveCode(form.code, index.stocks);
    const shares = Number(form.shares);
    const cost = Number(form.cost);
    if (!code) return setError('找不到這檔股票。請輸入收錄清單裡的代號或完整名稱，例如 2330 或 台積電。');
    if (!Number.isInteger(shares) || shares <= 0) return setError('股數要是大於 0 的整數。零股就填實際股數，一張填 1000。');
    if (!(cost > 0)) return setError('平均成本要是大於 0 的數字，例如 612.5。');
    setHoldings(upsertHolding(holdings, { code, shares, cost }));
    setForm({ code: '', shares: '', cost: '' });
  };

  const rows = useMemo(
    () =>
      holdings.map((h) => {
        const s = byCode.get(h.code);
        const { price } = priceOf(s, quotes);
        const costTotal = h.shares * h.cost;
        const value = price == null ? null : h.shares * price;
        const needed = price != null && price < h.cost ? h.cost / price - 1 : null;
        const odds = needed != null && closes[h.code] ? recoveryOdds(closes[h.code], needed, RECOVERY_HORIZON) : null;
        return { h, s, price, costTotal, value, pnl: value == null ? null : value - costTotal, needed, odds };
      }),
    [holdings, byCode, quotes, closes],
  );

  const totalCost = rows.reduce((a, r) => a + r.costTotal, 0);
  const totalValue = rows.reduce((a, r) => a + (r.value ?? r.costTotal), 0);
  const totalPnl = totalValue - totalCost;

  return (
    <main className="view">
      <header className="view-head">
        <h1>持股</h1>
        <p>
          {sync.signedIn
            ? '持股會同步到你登入過的每一台裝置。'
            : sync.available
              ? '登入後，持股會在你的裝置之間同步。沒登入時只存在這台裝置。'
              : '持股只存在這台裝置的瀏覽器裡。換手機或清除瀏覽資料後要重新輸入。'}
        </p>
      </header>

      <SignIn why="輸入同步密碼，就能看到你在其他裝置輸入的持股。" />
      {sync.signedIn && sync.error && <p className="form-error">{sync.error}</p>}

      {rows.length > 0 && (
        <dl className="totals">
          <div>
            <dt>投入成本</dt>
            <dd>{formatMoney(totalCost)}</dd>
          </div>
          <div>
            <dt>目前市值</dt>
            <dd>{formatMoney(totalValue)}</dd>
          </div>
          <div>
            <dt>未實現損益</dt>
            <dd className={tone(totalPnl)}>
              {totalPnl >= 0 ? '+' : ''}
              {formatMoney(totalPnl)}
              <small>{formatPct(totalCost ? (totalPnl / totalCost) * 100 : 0, 2)}</small>
            </dd>
          </div>
        </dl>
      )}

      {rows.length === 0 ? (
        <p className="quiet">還沒有持股。用下面的表單加入第一檔，就會看到損益、回本需要漲多少，以及停損參考價。</p>
      ) : (
        <ul className="holdings">
          {rows.map(({ h, s, price, pnl, needed, odds }) => {
            const gain = price == null ? null : (price / h.cost - 1) * 100;
            const stop = s?.trail_stop ?? null;
            const broken = price != null && stop != null && price < stop;
            return (
              <li key={h.code} className="holding">
                <div className="holding-head">
                  <a className="holding-name" href={stockHref(h.code)}>
                    {s?.name ?? h.code}
                  </a>
                  <span className="row-code">
                    {h.shares.toLocaleString('zh-TW')} 股，成本 {formatPrice(h.cost)}
                  </span>
                  <button type="button" className="remove" onClick={() => setHoldings(holdings.filter((x) => x.code !== h.code))}>
                    刪除
                  </button>
                </div>

                {price == null ? (
                  <p className="quiet">這檔今天沒有更新到資料。</p>
                ) : (
                  <>
                    <dl className="figures">
                      <div>
                        <dt>現價</dt>
                        <dd>{formatPrice(price)}</dd>
                      </div>
                      <div>
                        <dt>損益</dt>
                        <dd className={tone(pnl)}>
                          {pnl! >= 0 ? '+' : ''}
                          {formatMoney(pnl!)}
                          <small>{formatPct(gain, 2)}</small>
                        </dd>
                      </div>
                      <div>
                        <dt>{needed != null ? '回本需要漲' : '距離成本'}</dt>
                        <dd>{needed != null ? `${(needed * 100).toFixed(1)}%` : '已經賺錢'}</dd>
                      </div>
                      <div>
                        <dt>移動停損參考</dt>
                        <dd className={broken ? 'down' : undefined}>
                          {formatPrice(stop)}
                          {stop != null && <small>{broken ? '已跌破' : `還有 ${formatPct((stop / price - 1) * 100)}`}</small>}
                        </dd>
                      </div>
                    </dl>
                    <div className="holding-forecast">
                      <span className="down">先跌 5%</span>
                      <ForecastBar forecast={s?.forecast} size="lg" />
                      <span className="up">先漲 5%</span>
                    </div>
                    <p className="fine">
                      {broken
                        ? '收盤已經低於移動停損參考價，代表這段走勢轉弱。要不要出場由你決定，但建議先想好「再跌到哪裡一定賣」。'
                        : '移動停損參考價會隨著股價創高往上移。收盤跌破它，是常見的停損或停利出場點。'}
                      {needed != null &&
                        (odds
                          ? ` 過去兩年裡，這檔從任一天起算 ${RECOVERY_HORIZON} 個交易日（約三個月）內漲超過 ${(needed * 100).toFixed(1)}% 的比例是 ${formatRate(odds.rate)}，可以拿來估計要等多久，不代表一定會回本。`
                          : '')}
                    </p>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <form className="panel form" onSubmit={onSubmit} noValidate>
        <h2>新增或更新持股</h2>
        <p className="fine">同一檔再輸入一次會覆蓋原本的股數和成本。成本不含手續費和稅。</p>
        <div className="form-row">
          <label>
            股票
            <input list="stock-options" value={form.code} onChange={(e) => update('code', e.target.value)} placeholder="2330 或 台積電" autoComplete="off" />
          </label>
          <label>
            股數
            <input inputMode="numeric" value={form.shares} onChange={(e) => update('shares', e.target.value)} placeholder="1000" />
          </label>
          <label>
            平均成本
            <input inputMode="decimal" value={form.cost} onChange={(e) => update('cost', e.target.value)} placeholder="612.5" />
          </label>
          <button type="submit" className="primary">
            儲存持股
          </button>
        </div>
        <datalist id="stock-options">
          {index.stocks
            .filter((s) => !s.error && s.kind !== 'index')
            .map((s) => (
              <option key={s.code} value={baseCode(s.code)}>
                {s.name}
              </option>
            ))}
        </datalist>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {!storageOk && (
          <p className="form-error" role="alert">
            這個瀏覽器不允許儲存資料（可能是無痕模式），關掉頁面後持股會消失。
          </p>
        )}
      </form>
    </main>
  );
}
