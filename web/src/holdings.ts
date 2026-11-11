import { isSymbol } from './api';
import type { Holding } from './types';

const HOLDINGS_KEY = 'holdings:v1';
const WATCH_KEY = 'watchlist:v1';
export const MAX_WATCH = 40;

function valid(h: unknown): h is Holding {
  if (!h || typeof h !== 'object') return false;
  const x = h as Record<string, unknown>;
  return (
    typeof x.code === 'string' &&
    isSymbol(x.code) &&
    typeof x.shares === 'number' &&
    Number.isInteger(x.shares) &&
    x.shares > 0 &&
    typeof x.cost === 'number' &&
    x.cost > 0
  );
}

function read(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** Keep only well-formed holdings from untrusted input. */
export const cleanHoldings = (list: unknown[]): Holding[] => list.filter(valid);

/** Holdings stay in this browser only (localStorage); nothing is uploaded. */
export function loadHoldings(): Holding[] {
  const raw = read(HOLDINGS_KEY);
  return Array.isArray(raw) ? raw.filter(valid) : [];
}

export const saveHoldings = (list: Holding[]) => write(HOLDINGS_KEY, list);

export function upsertHolding(list: Holding[], next: Holding): Holding[] {
  const rest = list.filter((h) => h.code !== next.code);
  return [...rest, next].sort((a, b) => a.code.localeCompare(b.code));
}

/** The user's own tracking list, or null when they have not changed the default yet. */
export function loadWatch(): string[] | null {
  const raw = read(WATCH_KEY);
  if (!Array.isArray(raw)) return null;
  return [...new Set(raw.filter((c): c is string => typeof c === 'string' && isSymbol(c)))].slice(0, MAX_WATCH);
}

export const saveWatch = (codes: string[]) => write(WATCH_KEY, codes.slice(0, MAX_WATCH));
