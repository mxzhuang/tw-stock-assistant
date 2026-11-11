import { useEffect, useMemo, useState } from 'react';
import { ForecastBar } from '../components/ForecastBar';
import { SearchBox } from '../components/SearchBox';
import { Spark } from '../components/Spark';
import { RowHead, StockRow } from '../components/StockRow';
import { priceOf, stockHref, useApp } from '../ctx';
import { MAX_WATCH } from '../holdings';
import { edge, formatChange, formatMoney, formatPct, formatPrice, formatRate, notable, tone } from '../lib';
import { SignIn } from '../components/SignIn';
import { loadPublicBriefing } from '../sync';
import type { Briefing, BriefingFile, BriefingItem, StockSummary } from '../types';

const MIN_LOTS = 1000;

interface Note {
  code: string;
  tone: 'up' | 'down';
  text: string;
}

function briefLabel(file: BriefingFile): string {
  const at = new Date(file.generated_at);
  const day = at.toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' });
  const time = at.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${file.slot === 'pre' ? '開盤前' : '收盤後'}摘要，${day} ${time}，${file.source === 'claude' ? 'Claude 整理' : '規則整理'}`;
}

const LEFT = ['holdings', 'advice'] as const;
const RIGHT = ['market', 'events', 'picks'] as const;
const GROUP_LABEL: Record<(typeof LEFT)[number] | (typeof RIGHT)[number], string> = {
  holdings: '你的持股',
  advice: '建議',
  market: '大盤與時事',
  events: '接下來要注意',
  picks: '值得關注',
};

function BriefingItemRow({ item }: { item: BriefingItem }) {
  const action = item.action;
  return (
    <li className={`brief-item ${item.tone ?? 'info'}`}>
      {item.title && (
        <div className="brief-item-head">
          {item.code ? (
            <a className="brief-title" href={stockHref(item.code)}>
              {item.title}
            </a>
          ) : (
            <b className="brief-title">{item.title}</b>
          )}
          {action && <span className={`tag action is-${action === '續抱' ? 'hold' : action === '觀察' ? 'watch' : 'cut'}`}>{action}</span>}
        </div>
      )}
      <p>{item.text}</p>
    </li>
  );
}

function BriefingBlock({ body }: { body: Briefing }) {
  const column = (keys: readonly ((typeof LEFT)[number] | (typeof RIGHT)[number])[]) =>
    keys.map((key) => {
      const items = body[key] ?? [];
      if (items.length === 0) return null;
      return (
        <div key={key} className="brief-group">
          <h3>{GROUP_LABEL[key]}</h3>
          <ul className="brief-items">
            {items.map((item, i) => (
              <BriefingItemRow key={i} item={item} />
            ))}
          </ul>
        </div>
      );
    });

  return (
    <div className="brief">
      <p className="brief-head">{body.headline}</p>
      {body.alerts && body.alerts.length > 0 && (
        <ul className="alerts">
          {body.alerts.map((a) => (
            <li key={a.key} className={a.kind}>
              <b>{a.kind === 'risk' ? '風險提醒' : '機會提醒'}</b>
              <span>{a.text}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="brief-cols">
        <div>{column(LEFT)}</div>
        <div>{column(RIGHT)}</div>
      </div>
      {body.skills && body.skills.length > 0 && (
        <p className="fine brief-method">
          由 Claude{body.model && body.model !== 'default' ? `（${body.model}）` : ''} 依這幾份公開的分析方法（Agent Skill）撰寫：{body.skills.join('、')}。內容可能有錯，請當作參考。
        </p>
      )}
    </div>
  );
}

export function HomeView() {
  const { index, byCode, watch, holdings, quotes, toggleWatch, briefing, sync } = useApp();
  const [editing, setEditing] = useState(false);
  const [general, setGeneral] = useState<BriefingFile | null>(null);

  useEffect(() => {
    void loadPublicBriefing().then(setGeneral);
  }, []);
  // Signed in: the owner's own briefing. Otherwise the one anyone can read.
  const brief = briefing ?? general;

  const indices = index.stocks.filter((s) => s.kind === 'index' && !s.error);
  const watched = watch.map((c) => byCode.get(c)).filter((s): s is StockSummary => !!s && !s.error);
  const held = holdings
    .map((h) => ({ h, s: byCode.get(h.code) }))
    .filter((x): x is { h: (typeof holdings)[number]; s: StockSummary } => !!x.s && !x.s.error);

  const notes = useMemo(() => {
    const out: Note[] = [];
    const heldCodes = new Set(held.map((x) => x.s.code));
    const mine = [...held.map((x) => x.s), ...watched.filter((s) => !heldCodes.has(s.code))];
    for (const s of [...indices.slice(0, 1), ...mine]) {
      const f = s.forecast;
      const kind = notable(f);
      const tag = heldCodes.has(s.code) ? '（持股）' : '';
      if (kind === 'down' && f) {
        out.push({ code: s.code, tone: 'down', text: `${s.name}${tag}先跌 5% 的機率 ${formatRate(f.down)}，平常是 ${formatRate(f.base_down)}。` });
      } else if (kind === 'up' && f) {
        out.push({ code: s.code, tone: 'up', text: `${s.name}${tag}先漲 5% 的機率 ${formatRate(f.up)}，平常是 ${formatRate(f.base_up)}。` });
      }
    }
    for (const { s } of held) {
      const { price } = priceOf(s, quotes);
      if (price != null && s.trail_stop != null && price < s.trail_stop) {
        out.push({ code: s.code, tone: 'down', text: `${s.name}（持股）現價 ${formatPrice(price)}，已經低於移動停損參考價 ${formatPrice(s.trail_stop)}。` });
      }
    }
    return out.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === 'down' ? -1 : 1)).slice(0, 6);
  }, [held, watched, indices, quotes]);

  const totals = held.reduce(
    (acc, { h, s }) => {
      const { price } = priceOf(s, quotes);
      acc.cost += h.shares * h.cost;
      acc.value += h.shares * (price ?? h.cost);
      return acc;
    },
    { cost: 0, value: 0 },
  );
  const pnl = totals.value - totals.cost;

  const picks = useMemo(
    () =>
      index.stocks
        .filter((s) => s.kind !== 'index' && !s.error && s.forecast && (s.avg_volume_lots ?? 0) >= MIN_LOTS && notable(s.forecast) === 'up')
        .sort((a, b) => edge(b.forecast) - edge(a.forecast))
        .slice(0, 5),
    [index],
  );

  return (
    <main className="view">
      <section className="market" aria-label="大盤">
        {indices.map((s) => {
          const chg = formatChange(s.change_pct);
          return (
            <a key={s.code} className="tile" href={stockHref(s.code)}>
              <span className="tile-name">{s.name}</span>
              <b className="tile-price">{formatPrice(s.last_close)}</b>
              <span className={`tile-chg ${chg.tone}`}>{chg.text}</span>
              <Spark values={s.spark} />
              <ForecastBar forecast={s.forecast} />
            </a>
          );
        })}
      </section>

      <p className="key">
        <span className="key-swatch down" />
        綠色是未來一個月先跌 5% 的機率
        <span className="key-swatch up" />
        紅色是先漲 5% 的機率
        <span className="key-swatch base" />
        深色細線是平常的水準
      </p>

      <section className="block">
        <div className="block-head">
          <h2>今天先看這幾件事</h2>
          {brief && <span className="block-sum">{briefLabel(brief)}</span>}
          <a className="link" href="#/notify">
            同步與通知
          </a>
        </div>
        <SignIn why="輸入同步密碼，這台裝置就會顯示你的持股和個人化的摘要。" />
        {brief && <BriefingBlock body={brief.body} />}
        {sync.signedIn && sync.error && <p className="form-error">{sync.error}</p>}
        {(!brief || !brief.personal) &&
          (notes.length === 0 ? (
            <p className="quiet">大盤、持股和追蹤清單今天都跟平常差不多，沒有明顯偏向漲或跌。</p>
          ) : (
            <ul className="notes-list">
              {notes.map((n, i) => (
                <li key={i} className={n.tone}>
                  <a href={stockHref(n.code)}>{n.text}</a>
                </li>
              ))}
            </ul>
          ))}
      </section>

      <section className="block">
        <div className="block-head">
          <h2>持股</h2>
          {held.length > 0 && (
            <p className="block-sum">
              市值 <b>{formatMoney(totals.value)}</b>
              <span className={tone(pnl)}>
                {pnl >= 0 ? '+' : ''}
                {formatMoney(pnl)}（{formatPct(totals.cost ? (pnl / totals.cost) * 100 : 0, 2)}）
              </span>
            </p>
          )}
          <a className="link" href="#/holdings">
            {held.length ? '管理持股' : '新增持股'}
          </a>
        </div>
        {held.length === 0 ? (
          <p className="quiet">輸入你買的股票、股數和成本，就能在這裡看到損益和停損參考價。資料只存在這台裝置。</p>
        ) : (
          <ul className="rows">
            <RowHead extra="損益" />
            {held.map(({ h, s }) => {
              const { price } = priceOf(s, quotes);
              const gain = price == null ? null : (price / h.cost - 1) * 100;
              return (
                <StockRow
                  key={s.code}
                  stock={s}
                  sub={`${h.shares.toLocaleString('zh-TW')} 股，成本 ${formatPrice(h.cost)}`}
                  extra={<b className={`gain ${tone(gain)}`}>{formatPct(gain, 2)}</b>}
                />
              );
            })}
          </ul>
        )}
      </section>

      <section className="block">
        <div className="block-head">
          <h2>追蹤</h2>
          <SearchBox
            stocks={index.stocks.filter((s) => s.kind !== 'index')}
            exclude={watch}
            onPick={toggleWatch}
            placeholder="加入代號或名稱"
            label="加入追蹤"
          />
          {watched.length > 0 && (
            <button type="button" className="link" aria-pressed={editing} onClick={() => setEditing((v) => !v)}>
              {editing ? '完成' : '編輯'}
            </button>
          )}
        </div>
        {watched.length === 0 ? (
          <p className="quiet">追蹤清單是空的。在上面的搜尋框輸入代號或名稱加入，最多 {MAX_WATCH} 檔。</p>
        ) : (
          <ul className="rows">
            <RowHead extra="近 40 日" action={editing} />
            {watched.map((s) => (
              <StockRow
                key={s.code}
                stock={s}
                action={
                  editing ? (
                    <button type="button" className="remove" onClick={() => toggleWatch(s.code)} aria-label={`取消追蹤 ${s.name}`}>
                      移除
                    </button>
                  ) : undefined
                }
              />
            ))}
          </ul>
        )}
      </section>

      <section className="block">
        <div className="block-head">
          <h2>先漲機率比平常高的</h2>
          <a className="link" href="#/screen">
            到選股看全部
          </a>
        </div>
        {picks.length === 0 ? (
          <p className="quiet">今天沒有哪一檔的先漲機率明顯高於它自己的平常水準。</p>
        ) : (
          <ul className="rows">
            <RowHead extra="近 40 日" />
            {picks.map((s) => (
              <StockRow key={s.code} stock={s} />
            ))}
          </ul>
        )}
        <p className="fine">
          只列日均成交超過 {MIN_LOTS.toLocaleString('zh-TW')} 張的股票。機率來自歷史統計模型，<a href="#/model">準確度在這裡</a>。
        </p>
      </section>
    </main>
  );
}
