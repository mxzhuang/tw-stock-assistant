import { createContext, useContext } from 'react';
import type { BriefingFile, Catalog, Holding, IndexData, Quote, StockSummary } from './types';

export interface SyncState {
  /** null while checking; false on sites deployed without sync. */
  available: boolean | null;
  signedIn: boolean;
  busy: boolean;
  error: string | null;
  password: string | null;
  vapidPublic: string | null;
  signIn: (password: string) => Promise<void>;
  signOut: () => void;
}

export interface AppState {
  index: IndexData;
  catalog: Catalog;
  byCode: Map<string, StockSummary>;
  watch: string[];
  holdings: Holding[];
  quotes: Record<string, Quote>;
  storageOk: boolean;
  toggleWatch: (code: string) => void;
  setWatch: (codes: string[]) => void;
  setHoldings: (next: Holding[]) => void;
  refreshQuotes: () => void;
  quoteState: 'idle' | 'loading' | 'live' | 'off';
  sync: SyncState;
  /** The owner's own briefing once signed in. */
  briefing: BriefingFile | null;
}

export const AppCtx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const ctx = useContext(AppCtx);
  if (!ctx) throw new Error('AppCtx missing');
  return ctx;
}

/** Latest price for a row: the intraday quote when there is one, else the daily close. */
export function priceOf(s: StockSummary | undefined, quotes: Record<string, Quote>) {
  const q = s ? quotes[s.code] : undefined;
  if (q) return { price: q.price, change: q.change_pct, live: true, time: q.time };
  return { price: s?.last_close ?? null, change: s?.change_pct ?? null, live: false, time: null };
}

export const stockHref = (code: string) => `#/stock/${code}`;
