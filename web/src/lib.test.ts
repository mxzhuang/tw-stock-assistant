import { describe, expect, it } from 'vitest';
import { dateSpan, formatChange, formatLots, patternAt, patternsInRange, shortDate, toDateStr } from './lib';

const p = (key: string, start: string, end: string) => ({ key, start, end, top: 1, bottom: 0 });

describe('formatting', () => {
  it('shows Taiwan-style change arrows', () => {
    expect(formatChange(1.234)).toEqual({ text: '▲ 1.23%', tone: 'up' });
    expect(formatChange(-0.5)).toEqual({ text: '▼ 0.50%', tone: 'down' });
    expect(formatChange(null).tone).toBe('flat');
  });

  it('converts shares to lots', () => {
    expect(formatLots(23_456_789)).toBe('23,457');
  });

  it('shortens dates and adds the year only when it differs', () => {
    expect(shortDate('2026-03-05')).toBe('3/5');
    expect(shortDate('2025-12-31', '2026')).toBe('2025/12/31');
    expect(dateSpan(p('a', '2026-10-27', '2026-10-28'), '2026')).toBe('10/27–10/28');
  });

  it('normalises chart time values', () => {
    expect(toDateStr('2026-01-02')).toBe('2026-01-02');
    expect(toDateStr({ year: 2026, month: 1, day: 2 })).toBe('2026-01-02');
  });
});

describe('pattern lookup', () => {
  const list = [p('a', '2026-01-05', '2026-01-06'), p('b', '2026-01-06', '2026-01-08'), p('c', '2026-02-01', '2026-02-01')];

  it('keeps overlapping patterns, newest first', () => {
    expect(patternsInRange(list, '2026-01-06', '2026-01-31').map((x) => x.key)).toEqual(['b', 'a']);
  });

  it('picks the latest-starting pattern under a date', () => {
    expect(patternAt(list, '2026-01-06')?.key).toBe('b');
    expect(patternAt(list, '2026-01-20')).toBeUndefined();
  });
});

describe('visible-window helpers', () => {
  it('keeps only patterns fully inside the window', async () => {
    const { patternsWithin } = await import('./lib');
    const list = [p('a', '2026-01-02', '2026-01-05'), p('b', '2026-01-06', '2026-01-07')];
    expect(patternsWithin(list, '2026-01-05', '2026-01-31').map((x) => x.key)).toEqual(['b']);
  });

  it('measures how often price recovered by the needed amount', async () => {
    const { recoveryOdds } = await import('./lib');
    // Flat at 100 for 100 days, then one day at 130: only days within reach of it count.
    const closes = [...Array(100).fill(100), 130, ...Array(80).fill(100)];
    const odds = recoveryOdds(closes, 0.25, 60)!;
    expect(odds.samples).toBe(121);
    expect(odds.rate).toBeCloseTo(60 / 121, 5);
    expect(recoveryOdds([1, 2, 3], 0.1)).toBeNull();
  });
});

describe('search and forecast helpers', () => {
  const stocks = [
    { code: '2330.TW', name: '台積電' },
    { code: '2337.TW', name: '旺宏' },
    { code: '00878.TW', name: '國泰永續高股息' },
    { code: '9999.TW', name: '壞掉', error: 'x' },
  ];

  it('finds by code prefix or part of the name, best match first', async () => {
    const { searchStocks } = await import('./lib');
    expect(searchStocks(stocks, '233').map((s) => s.code)).toEqual(['2330.TW', '2337.TW']);
    expect(searchStocks(stocks, '高股息').map((s) => s.code)).toEqual(['00878.TW']);
    expect(searchStocks(stocks, '2337')[0].code).toBe('2337.TW');
    expect(searchStocks(stocks, '壞掉')).toEqual([]);
    expect(searchStocks(stocks, '  ')).toEqual([]);
  });

  it('flags a forecast only when it clearly beats the usual level', async () => {
    const { notable, edge } = await import('./lib');
    expect(notable({ up: 0.5, down: 0.2, base_up: 0.35, base_down: 0.3 })).toBe('up');
    expect(notable({ up: 0.2, down: 0.5, base_up: 0.3, base_down: 0.35 })).toBe('down');
    expect(notable({ up: 0.38, down: 0.3, base_up: 0.35, base_down: 0.3 })).toBeNull();
    expect(notable(null)).toBeNull();
    expect(edge({ up: 0.5, down: 0.2, base_up: null, base_down: null })).toBeCloseTo(0.3);
  });
});
