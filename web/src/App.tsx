import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isSymbol, loadCatalog, loadIndex, loadQuotes } from './api';
import { SearchBox } from './components/SearchBox';
import { AppCtx, type AppState } from './ctx';
import { MAX_WATCH, loadHoldings, loadWatch, saveHoldings, saveWatch } from './holdings';
import { fetchMe, rememberPassword, saveProfile, savedPassword, syncAvailable } from './sync';
import type { BriefingFile, Catalog, Holding, IndexData, Quote } from './types';
import { HoldingsView } from './views/HoldingsView';
import { HomeView } from './views/HomeView';
import { ModelView } from './views/ModelView';
import { NotifyView } from './views/NotifyView';
import { ScreenView } from './views/ScreenView';
import { StockView } from './views/StockView';

type View = 'home' | 'stock' | 'screen' | 'holdings' | 'model' | 'notify';

interface Route {
  view: View;
  code: string | null;
  theme: string | null;
}

const NAV: { view: View; label: string; href: string }[] = [
  { view: 'home', label: '總覽', href: '#/' },
  { view: 'screen', label: '選股', href: '#/screen' },
  { view: 'holdings', label: '持股', href: '#/holdings' },
  { view: 'model', label: '模型', href: '#/model' },
];

/** Taiwan regular session: weekdays 09:00 to 13:30, Taipei time (UTC+8, no daylight saving). */
function marketOpen(now = new Date()): boolean {
  const taipei = new Date(now.getTime() + 8 * 3600 * 1000);
  const day = taipei.getUTCDay();
  const minutes = taipei.getUTCHours() * 60 + taipei.getUTCMinutes();
  return day >= 1 && day <= 5 && minutes >= 9 * 60 && minutes <= 13 * 60 + 35;
}

function parseHash(): Route {
  const raw = decodeURIComponent(window.location.hash.replace(/^#\/?/, ''));
  const [path, queryString] = raw.split('?');
  const base: Route = { view: 'home', code: null, theme: null };
  if (path === 'screen') {
    const theme = new URLSearchParams(queryString ?? '').get('theme');
    return { ...base, view: 'screen', theme: theme && /^[a-z][a-z0-9_]{1,23}$/.test(theme) ? theme : null };
  }
  if (path === 'holdings' || path === 'model' || path === 'notify') return { ...base, view: path };
  const code = path.startsWith('stock/') ? path.slice(6) : path; // "#2330.TW" is the old link format
  if (isSymbol(code)) return { ...base, view: 'stock', code };
  return base;
}

export function App() {
  const [index, setIndex] = useState<IndexData | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [route, setRoute] = useState<Route>(parseHash);
  const [watchOwn, setWatchOwn] = useState<string[] | null>(loadWatch);
  const [holdings, setHoldingsState] = useState<Holding[]>(loadHoldings);
  const [storageOk, setStorageOk] = useState(true);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [quoteState, setQuoteState] = useState<AppState['quoteState']>('idle');
  const [quoteInfo, setQuoteInfo] = useState<{ count: number; latest: string | null; delayed: boolean; problem: string | null } | null>(null);

  useEffect(() => {
    const onHash = () => {
      setRoute(parseHash());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    Promise.all([loadIndex(), loadCatalog()])
      .then(([idx, cat]) => {
        setIndex(idx);
        setCatalog(cat);
      })
      .catch((err: Error) => setFatal(err.message));
  }, []);

  const byCode = useMemo(() => new Map((index?.stocks ?? []).map((s) => [s.code, s])), [index]);
  const watch = useMemo(() => watchOwn ?? index?.defaults ?? [], [watchOwn, index]);

  // Cloud sync. `live` mirrors the latest lists so a save always sends both.
  const [available, setAvailable] = useState<boolean | null>(null);
  const [password, setPassword] = useState<string | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [vapidPublic, setVapidPublic] = useState<string | null>(null);
  const [briefing, setBriefing] = useState<BriefingFile | null>(null);
  const live = useRef({ holdings, watch, password });
  live.current = { holdings, watch, password };

  const push = useCallback((nextHoldings: Holding[], nextWatch: string[]) => {
    const pw = live.current.password;
    if (!pw) return;
    saveProfile(pw, nextHoldings, nextWatch)
      .then(() => setSyncError(null))
      .catch((e: Error) => setSyncError(`${e.message}這次的變更只存在這台裝置。`));
  }, []);

  const applyWatch = useCallback(
    (next: string[]) => {
      setWatchOwn(next);
      setStorageOk(saveWatch(next));
      push(live.current.holdings, next);
    },
    [push],
  );

  const toggleWatch = useCallback(
    (code: string) => {
      const now = live.current.watch;
      applyWatch(now.includes(code) ? now.filter((c) => c !== code) : [...now, code].slice(-MAX_WATCH));
    },
    [applyWatch],
  );

  const setWatch = useCallback(
    (codes: string[]) => applyWatch([...new Set(codes.filter(isSymbol))].slice(0, MAX_WATCH)),
    [applyWatch],
  );

  const setHoldings = useCallback(
    (next: Holding[]) => {
      setHoldingsState(next);
      setStorageOk(saveHoldings(next));
      push(next, live.current.watch);
    },
    [push],
  );

  const signIn = useCallback(async (pw: string) => {
    setSyncBusy(true);
    setSyncError(null);
    try {
      const me = await fetchMe(pw);
      rememberPassword(pw);
      setPassword(pw);
      setVapidPublic(me.vapid_public);
      setBriefing(me.briefing?.body ? me.briefing : null);
      if (me.profile) {
        // The cloud copy wins: this is what the other devices see.
        setHoldingsState(me.profile.holdings);
        saveHoldings(me.profile.holdings);
        setWatchOwn(me.profile.watch);
        saveWatch(me.profile.watch);
      } else {
        // First device: upload what is already here.
        await saveProfile(pw, live.current.holdings, live.current.watch);
      }
    } catch (e) {
      const message = (e as Error).message;
      if (message.startsWith('密碼不對')) rememberPassword(null);
      setSyncError(message);
    }
    setSyncBusy(false);
  }, []);

  const signOut = useCallback(() => {
    rememberPassword(null);
    setPassword(null);
    setBriefing(null);
    setVapidPublic(null);
  }, []);

  useEffect(() => {
    void syncAvailable().then((ok) => {
      setAvailable(ok);
      const saved = savedPassword();
      if (ok && saved) void signIn(saved);
    });
  }, [signIn]);

  // Intraday prices are fetched only for what is on screen, and only on demand.
  const wanted = useMemo(() => {
    const codes = new Set<string>(['TWII', ...watch, ...holdings.map((h) => h.code)]);
    if (route.code) codes.add(route.code);
    return [...codes].sort();
  }, [watch, holdings, route.code]);
  const wantedKey = wanted.join(',');

  const refreshQuotes = useCallback(() => {
    if (!index || index.demo) return;
    setQuoteState('loading');
    void loadQuotes(wantedKey.split(',')).then(({ quotes: got, problem }) => {
      // A quote older than the daily bar already on the page adds nothing.
      const fresh = Object.fromEntries(Object.entries(got).filter(([code, v]) => v.date >= (byCode.get(code)?.last_date ?? '')));
      setQuotes((prev) => ({ ...prev, ...fresh }));
      const times = Object.values(fresh).map((v) => v.time).sort();
      setQuoteInfo({
        count: Object.keys(fresh).length,
        latest: times.at(-1) ?? null,
        delayed: Object.values(fresh).some((v) => v.delayed),
        problem,
      });
      setQuoteState(Object.keys(got).length ? 'live' : 'off');
    });
  }, [index, wantedKey, byCode]);

  useEffect(() => {
    refreshQuotes();
  }, [refreshQuotes]);

  if (fatal) {
    return (
      <main className="view">
        <h1>還沒有資料</h1>
        <p className="state">{fatal}。資料每個交易日收盤後更新，請稍後再試。</p>
      </main>
    );
  }
  if (!index || !catalog) return <p className="state">讀取中…</p>;

  const state: AppState = {
    index,
    catalog,
    byCode,
    watch,
    holdings,
    quotes,
    storageOk,
    toggleWatch,
    setWatch,
    setHoldings,
    refreshQuotes,
    quoteState,
    briefing,
    sync: { available, signedIn: password !== null, busy: syncBusy, error: syncError, password, vapidPublic, signIn, signOut },
  };
  const current = route.view === 'stock' ? 'home' : route.view;
  const updated = new Date(index.generated_at);

  return (
    <AppCtx.Provider value={state}>
      <header className="bar">
        <div className="bar-in">
          <a className="brand" href="#/">
            台股投資助手
          </a>
          <nav className="nav" aria-label="主要功能">
            {NAV.map((n) => (
              <a key={n.view} href={n.href} aria-current={current === n.view && route.view !== 'stock' ? 'page' : undefined}>
                {n.label}
              </a>
            ))}
          </nav>
          <SearchBox
            stocks={index.stocks}
            onPick={(code) => {
              window.location.hash = `#/stock/${code}`;
            }}
            placeholder="搜尋代號或名稱"
            label="搜尋股票"
          />
        </div>
      </header>

      {index.demo && <p className="banner">目前顯示的是示範資料，不是真實股價。</p>}

      <div className="status">
        <span>
          日線資料到 {updated.toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' })}{' '}
          {updated.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false })}
        </span>
        {quoteState === 'live' && quoteInfo && (
          <span className="status-live">
            {quoteInfo.count > 0
              ? `${marketOpen() ? '即時報價' : '已收盤，這是今天的收盤報價'}，最後成交 ${quoteInfo.latest ?? ''}（${quoteInfo.count} 檔）${quoteInfo.delayed ? '，部分來自 Yahoo，可能慢幾分鐘' : ''}`
              : '報價和頁面上的收盤價是同一天，沒有更新的了'}
          </span>
        )}
        {quoteState === 'off' && <span className="status-problem">抓不到即時報價：{quoteInfo?.problem ?? '原因不明'}。目前顯示最近一次收盤。</span>}
        {!index.demo && (
          <button type="button" className="link" onClick={refreshQuotes} disabled={quoteState === 'loading'}>
            {quoteState === 'loading' ? '更新中…' : '更新報價'}
          </button>
        )}
      </div>

      {route.view === 'home' && <HomeView />}
      {route.view === 'stock' && route.code && <StockView code={route.code} />}
      {route.view === 'screen' && (
        <ScreenView
          theme={route.theme}
          onTheme={(key) => {
            window.location.hash = key ? `#/screen?theme=${key}` : '#/screen';
          }}
        />
      )}
      {route.view === 'holdings' && <HoldingsView />}
      {route.view === 'model' && <ModelView />}
      {route.view === 'notify' && <NotifyView />}

      <footer className="foot">
        <p>
          這個網站的機率、訊號和摘要都只能當參考，不構成投資建議。<a href="#/notify">同步與通知</a>
        </p>
      </footer>

      <nav className="tabbar" aria-label="主要功能">
        {NAV.map((n) => (
          <a key={n.view} href={n.href} aria-current={current === n.view && route.view !== 'stock' ? 'page' : undefined}>
            {n.label}
          </a>
        ))}
      </nav>
    </AppCtx.Provider>
  );
}
