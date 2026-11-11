import type { Catalog, IndexData, ModelData, Quote, StockData } from './types';

const SCHEMA = 3;
const SYMBOL_RE = /^(\d{4,6}[A-Z]?\.(TW|TWO)|[A-Z]{2,6})$/;

async function getJson<T extends { schema: number }>(path: string): Promise<T> {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`讀取資料失敗（HTTP ${res.status}）`);
  const data = (await res.json()) as T;
  if (data.schema !== SCHEMA) throw new Error('資料格式版本不符，請重新整理頁面');
  return data;
}

export const loadIndex = () => getJson<IndexData>('./data/index.json');
export const loadCatalog = () => getJson<Catalog>('./data/catalog.json');
export const loadModel = () => getJson<ModelData>('./data/model.json');

export function loadStock(code: string): Promise<StockData> {
  if (!SYMBOL_RE.test(code)) return Promise.reject(new Error('股票代號格式不正確'));
  return getJson<StockData>(`./data/stocks/${encodeURIComponent(code)}.json`);
}

export function isSymbol(value: string): boolean {
  return SYMBOL_RE.test(value);
}

export interface QuoteResult {
  quotes: Record<string, Quote>;
  /** Why nothing came back, in plain words; null when there is something to show. */
  problem: string | null;
}

/**
 * Intraday quotes, fetched only when the page asks. Never throws: when the
 * quote function is missing or the sources do not answer, `problem` says why
 * and the app keeps showing the last daily close.
 */
export async function loadQuotes(codes: string[]): Promise<QuoteResult> {
  const wanted = codes.filter(isSymbol).slice(0, 60);
  if (!wanted.length) return { quotes: {}, problem: null };
  try {
    const res = await fetch(`./api/quote?codes=${encodeURIComponent(wanted.join(','))}`, { cache: 'no-store' });
    if (!res.ok) return { quotes: {}, problem: `報價服務回應 HTTP ${res.status}` };
    if (!res.headers.get('content-type')?.includes('json')) return { quotes: {}, problem: '這個網站沒有部署報價服務' };
    const body = (await res.json()) as { quotes?: Record<string, Quote>; sources?: Record<string, string> };
    const quotes = body.quotes ?? {};
    if (Object.keys(quotes).length) return { quotes, problem: null };
    const detail = Object.entries(body.sources ?? {})
      .map(([name, text]) => `${name === 'twse' ? '證交所' : 'Yahoo'}：${text}`)
      .join('；');
    return { quotes, problem: `來源沒有回傳報價${detail ? `（${detail}）` : ''}` };
  } catch {
    return { quotes: {}, problem: '連不上報價服務，請檢查網路' };
  }
}
