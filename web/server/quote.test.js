import { describe, expect, it } from 'vitest';
import { getQuotes, misChannel } from './quote.js';

const req = (codes) => new Request(`https://site.test/api/quote?codes=${codes}`);
const reply = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers });

const MIS_ROWS = {
  msgArray: [
    { ex: 'tse', c: '2330', z: '2372.5', y: '2285', d: '20261111', t: '13:01:05' },
    { ex: 'otc', c: '6488', z: '-', b: '150.0_149.5_', a: '151.0_151.5_', y: '140', d: '20261111', t: '13:01:02' },
    { ex: 'tse', c: 't00', z: '43929.16', y: '42711.92', d: '20261111', t: '13:01:00' },
  ],
};
const yahoo = (price, prev) => reply({ chart: { result: [{ meta: { regularMarketPrice: price, chartPreviousClose: prev, regularMarketTime: 1794373200 } }] } });

describe('intraday quotes', () => {
  it('maps symbols to exchange channels', () => {
    expect(misChannel('2330.TW')).toBe('tse_2330.tw');
    expect(misChannel('6488.TWO')).toBe('otc_6488.tw');
    expect(misChannel('TWII')).toBe('tse_t00.tw');
    expect(misChannel('SOX')).toBeNull();
    expect(misChannel('../etc')).toBeNull();
  });

  it('uses the exchange for everything it returns, with the session cookie', async () => {
    const seen = [];
    const fetcher = async (url, init) => {
      seen.push([String(url), init?.headers?.cookie]);
      if (String(url).includes('index.jsp')) return new Response('', { headers: { 'set-cookie': 'JSESSIONID=abc; Path=/' } });
      return reply(MIS_ROWS);
    };
    const body = await (await getQuotes(req('2330.TW,6488.TWO,TWII'), fetcher)).json();
    expect(body.quotes['2330.TW']).toMatchObject({ price: 2372.5, change_pct: 3.83, time: '13:01', date: '2026-11-11', delayed: false });
    expect(body.quotes['6488.TWO'].price).toBe(150.5); // no trade yet: midpoint of bid and ask
    expect(body.quotes.TWII.price).toBe(43929.16);
    expect(body.sources).toEqual({ twse: 'ok, 3 of 3' });
    expect(seen[1][1]).toBe('JSESSIONID=abc');
    expect(seen[1][0]).toContain('tse_2330.tw%7Cotc_6488.tw%7Ctse_t00.tw');
  });

  it('falls back to Yahoo for what the exchange did not return and marks it delayed', async () => {
    const fetcher = async (url) => {
      const u = String(url);
      if (u.includes('index.jsp')) return new Response('');
      if (u.includes('getStockInfo')) return reply({ msgArray: [MIS_ROWS.msgArray[0]] });
      if (u.includes('%5ETWII')) return yahoo(43900, 42711.92);
      return reply({}, 404);
    };
    const body = await (await getQuotes(req('2330.TW,TWII,2317.TW'), fetcher)).json();
    expect(body.quotes['2330.TW'].delayed).toBe(false);
    expect(body.quotes.TWII).toMatchObject({ price: 43900, delayed: true, date: '2026-11-11' });
    expect(body.quotes['2317.TW']).toBeUndefined();
    expect(body.sources.twse).toBe('ok, 1 of 3');
    expect(body.sources.yahoo).toBe('1 of 2, e.g. HTTP 404');
  });

  it('reports why nothing came back instead of failing', async () => {
    const fetcher = async (url) => (String(url).includes('yahoo') ? reply({}, 429) : reply({}, 403));
    const res = await getQuotes(req('2330.TW'), fetcher);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toMatchObject({ quotes: {}, sources: { twse: 'failed: HTTP 403', yahoo: '0 of 1, e.g. HTTP 429' } });
    expect((await (await getQuotes(req('nonsense'), fetcher)).json()).note).toBe('no valid symbols');
  });
});
