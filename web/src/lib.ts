import type { BusinessDay, Time } from 'lightweight-charts';
import type { PatternHit } from './types';

const priceFmt = new Intl.NumberFormat('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const intFmt = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 });

export function formatPrice(value: number | null | undefined): string {
  return value == null ? '—' : priceFmt.format(value);
}

/** Taiwan apps show volume in lots (張) of 1,000 shares. */
export function formatLots(shares: number): string {
  return intFmt.format(Math.round(shares / 1000));
}

export function formatChange(pct: number | null | undefined): { text: string; tone: 'up' | 'down' | 'flat' } {
  if (pct == null) return { text: '—', tone: 'flat' };
  if (pct > 0) return { text: `▲ ${pct.toFixed(2)}%`, tone: 'up' };
  if (pct < 0) return { text: `▼ ${Math.abs(pct).toFixed(2)}%`, tone: 'down' };
  return { text: '0.00%', tone: 'flat' };
}

/** "2026-10-28" -> "10/28"; adds the year when it differs from `refYear`. */
export function shortDate(date: string, refYear?: string): string {
  const [y, m, d] = date.split('-');
  const md = `${Number(m)}/${Number(d)}`;
  return refYear && y !== refYear ? `${y}/${md}` : md;
}

export function dateSpan(p: Pick<PatternHit, 'start' | 'end'>, refYear?: string): string {
  return p.start === p.end
    ? shortDate(p.end, refYear)
    : `${shortDate(p.start, refYear)}–${shortDate(p.end, refYear)}`;
}

/** Normalise a lightweight-charts Time back to YYYY-MM-DD. */
export function toDateStr(time: Time): string {
  if (typeof time === 'string') return time;
  if (typeof time === 'number') return new Date(time * 1000).toISOString().slice(0, 10);
  const bd = time as BusinessDay;
  return `${bd.year}-${String(bd.month).padStart(2, '0')}-${String(bd.day).padStart(2, '0')}`;
}

export function patternId(p: Pick<PatternHit, 'key' | 'end'>): string {
  return `${p.key}@${p.end}`;
}

/** Patterns that overlap [from, to], newest first. */
export function patternsInRange<T extends PatternHit>(patterns: T[], from: string, to: string): T[] {
  return patterns
    .filter((p) => p.end >= from && p.start <= to)
    .sort((a, b) => (a.end === b.end ? a.key.localeCompare(b.key) : b.end.localeCompare(a.end)));
}

/** Pick the pattern under a clicked date; when several overlap, the one that started latest. */
export function patternAt<T extends { start: string; end: string }>(patterns: T[], date: string): T | undefined {
  return patterns.filter((p) => p.start <= date && date <= p.end).sort((a, b) => b.start.localeCompare(a.start))[0];
}

/** Patterns that lie entirely inside [from, to], newest first. */
export function patternsWithin<T extends PatternHit>(patterns: T[], from: string, to: string): T[] {
  return patternsInRange(patterns, from, to).filter((p) => p.start >= from && p.end <= to);
}

/** 0.5208 -> "52%" */
export function formatRate(rate: number | null | undefined): string {
  return rate == null ? '—' : `${Math.round(rate * 100)}%`;
}

export function formatLift(lift: number | null | undefined): string {
  return lift == null ? '—' : `${lift.toFixed(1)} 倍`;
}

const moneyFmt = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 });

export function formatMoney(value: number): string {
  const sign = value < 0 ? '−' : '';
  return `${sign}${moneyFmt.format(Math.abs(value))}`;
}

/**
 * Share of past days from which the close rose by at least `needed` (e.g. 0.25 = 25%)
 * at some point within the next `horizon` bars. Returns null when there is too little history.
 */
export function recoveryOdds(closes: number[], needed: number, horizon = 60): { rate: number; samples: number } | null {
  const samples = closes.length - horizon;
  if (samples < 60) return null;
  let hits = 0;
  for (let t = 0; t < samples; t++) {
    const target = closes[t] * (1 + needed);
    for (let j = t + 1; j <= t + horizon; j++) {
      if (closes[j] >= target) {
        hits++;
        break;
      }
    }
  }
  return { rate: hits / samples, samples };
}

export function formatPct(pct: number | null | undefined, digits = 1): string {
  if (pct == null) return '—';
  return `${pct > 0 ? '+' : pct < 0 ? '−' : ''}${Math.abs(pct).toFixed(digits)}%`;
}

export function tone(value: number | null | undefined): 'up' | 'down' | 'flat' {
  if (value == null || value === 0) return 'flat';
  return value > 0 ? 'up' : 'down';
}

/** "2330.TW" -> "2330" */
export function baseCode(code: string): string {
  return code.replace(/\.(TW|TWO)$/, '');
}

interface Searchable {
  code: string;
  name: string;
  error?: string;
}

/** Match by code prefix or by any part of the name; exact and prefix matches first. */
export function searchStocks<T extends Searchable>(stocks: T[], query: string, limit = 8): T[] {
  const q = query.trim().toUpperCase();
  if (!q) return [];
  const scored: { s: T; rank: number }[] = [];
  for (const s of stocks) {
    if (s.error) continue;
    const code = baseCode(s.code).toUpperCase();
    const name = s.name.toUpperCase();
    let rank = -1;
    if (code === q || name === q) rank = 0;
    else if (code.startsWith(q)) rank = 1;
    else if (name.startsWith(q)) rank = 2;
    else if (name.includes(q)) rank = 3;
    if (rank >= 0) scored.push({ s, rank });
  }
  return scored
    .sort((a, b) => a.rank - b.rank || a.s.code.localeCompare(b.s.code))
    .slice(0, limit)
    .map((x) => x.s);
}

interface HasForecast {
  up: number;
  down: number;
  base_up: number | null;
  base_down: number | null;
}

const NOTABLE_GAP = 0.08;

/** Is today's chance clearly above what is normal for this stock? */
export function notable(f: HasForecast | null | undefined): 'up' | 'down' | null {
  if (!f) return null;
  const upGap = f.base_up == null ? 0 : f.up - f.base_up;
  const downGap = f.base_down == null ? 0 : f.down - f.base_down;
  if (downGap >= NOTABLE_GAP && f.down >= 0.3 && f.down > f.up) return 'down';
  if (upGap >= NOTABLE_GAP && f.up >= 0.3 && f.up > f.down) return 'up';
  return null;
}

/** Chance of rising first minus chance of falling first. */
export function edge(f: HasForecast | null | undefined): number {
  return f ? f.up - f.down : -Infinity;
}
