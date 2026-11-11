// Intraday quotes, fetched only when a visitor opens or refreshes the page.
// Nothing is stored.
//
// Source 1: the Taiwan Stock Exchange's public market information system (MIS),
//           real time, one request for all symbols.
// Source 2: Yahoo Finance's chart endpoint, one request per symbol, used for
//           whatever MIS did not return. Its Taiwan prices can lag by several
//           minutes, so those quotes are marked as delayed.
//
// The response always says what happened (`sources`, `note`) so the app can
// tell the visitor why a price is missing instead of failing silently.

const SYMBOL = /^(\d{4,6}[A-Z]?)\.(TW|TWO)$/;
const INDEX = { TWII: { mis: 'tse_t00.tw', yahoo: '^TWII' } };
const MAX_CODES = 60;
const MAX_FALLBACK = 40; // stays under the per-request subrequest limit
const MIS_HOME = 'https://mis.twse.com.tw/stock/index.jsp';
const MIS_API = 'https://mis.twse.com.tw/stock/api/getStockInfo.jsp';
const YAHOO = 'https://query1.finance.yahoo.com/v8/finance/chart/';
const AGENT = 'Mozilla/5.0 (compatible; tw-stock-assistant)';

export function misChannel(code) {
  if (INDEX[code]) return INDEX[code].mis;
  const m = SYMBOL.exec(code);
  return m ? `${m[2] === 'TW' ? 'tse' : 'otc'}_${m[1]}.tw` : null;
}

function number(value) {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Last trade if there is one, otherwise the midpoint of the best bid and ask. */
function lastPrice(row) {
  const traded = number(row.z);
  if (traded) return traded;
  const bid = number(String(row.b ?? '').split('_')[0]);
  const ask = number(String(row.a ?? '').split('_')[0]);
  if (bid && ask) return (bid + ask) / 2;
  return bid ?? ask ?? null;
}

const round2 = (n) => Math.round(n * 100) / 100;

function quote(price, prev, date, time, delayed) {
  return { price: round2(price), prev, change_pct: round2((price / prev - 1) * 100), time, date, delayed };
}

async function fromMis(codes, fetcher) {
  const byChannel = new Map(codes.map((c) => [misChannel(c), c]));
  // The exchange hands out a session cookie on its home page and may return
  // nothing to requests that do not carry one.
  let cookie = '';
  try {
    const home = await fetcher(MIS_HOME, { headers: { 'user-agent': AGENT }, signal: AbortSignal.timeout(4000) });
    const set = home.headers.getSetCookie?.() ?? [];
    cookie = set.map((c) => c.split(';')[0]).join('; ');
  } catch {
    // carry on without it
  }
  const url = `${MIS_API}?ex_ch=${encodeURIComponent([...byChannel.keys()].join('|'))}&json=1&delay=0&_=${Date.now()}`;
  const res = await fetcher(url, {
    headers: { accept: 'application/json', referer: MIS_HOME, 'user-agent': AGENT, ...(cookie ? { cookie } : {}) },
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const quotes = {};
  for (const row of data.msgArray ?? []) {
    const code = byChannel.get(`${row.ex}_${row.c}.tw`) ?? byChannel.get(`${row.ex}_${row.ch}`);
    const price = lastPrice(row);
    const prev = number(row.y);
    const d = String(row.d ?? '');
    if (!code || !price || !prev || d.length !== 8) continue;
    quotes[code] = quote(price, prev, `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, String(row.t ?? '').slice(0, 5), false);
  }
  return quotes;
}

async function fromYahoo(code, fetcher) {
  const symbol = INDEX[code]?.yahoo ?? code;
  const res = await fetcher(`${YAHOO}${encodeURIComponent(symbol)}?interval=1d&range=1d`, {
    headers: { accept: 'application/json', 'user-agent': AGENT },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const meta = (await res.json())?.chart?.result?.[0]?.meta;
  const price = number(meta?.regularMarketPrice);
  const prev = number(meta?.chartPreviousClose ?? meta?.previousClose);
  const at = Number(meta?.regularMarketTime);
  if (!price || !prev || !Number.isFinite(at)) throw new Error('no price');
  // Taipei is UTC+8 all year.
  const local = new Date((at + 8 * 3600) * 1000).toISOString();
  return quote(price, prev, local.slice(0, 10), local.slice(11, 16), true);
}

function json(body) {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  });
}

export async function getQuotes(request, fetcher = fetch) {
  const asked = (new URL(request.url).searchParams.get('codes') ?? '').split(',');
  const codes = [...new Set(asked.filter((c) => misChannel(c)))].slice(0, MAX_CODES);
  if (codes.length === 0) return json({ quotes: {}, sources: {}, note: 'no valid symbols' });

  const quotes = {};
  const sources = {};
  try {
    Object.assign(quotes, await fromMis(codes, fetcher));
    sources.twse = `ok, ${Object.keys(quotes).length} of ${codes.length}`;
  } catch (err) {
    sources.twse = `failed: ${String(err?.message ?? err).slice(0, 80)}`;
  }

  const missing = codes.filter((c) => !quotes[c]).slice(0, MAX_FALLBACK);
  if (missing.length) {
    const results = await Promise.allSettled(missing.map((c) => fromYahoo(c, fetcher)));
    let ok = 0;
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        quotes[missing[i]] = r.value;
        ok += 1;
      }
    });
    const firstError = results.find((r) => r.status === 'rejected');
    sources.yahoo = `${ok} of ${missing.length}${firstError ? `, e.g. ${String(firstError.reason?.message ?? firstError.reason).slice(0, 60)}` : ''}`;
  }

  return json({ quotes, sources, colo: request.cf?.colo ?? null });
}
