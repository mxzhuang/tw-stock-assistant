import { describe, expect, it } from 'vitest';
import { changePush, cleanProfile, getMe, putMe, status } from './sync.js';

function fakeEnv(password = 'correct horse') {
  const store = new Map();
  return {
    SYNC_PASSWORD: password,
    SYNC: {
      get: async (k) => store.get(k) ?? null,
      put: async (k, v) => void store.set(k, v),
    },
    store,
  };
}

const req = (method, password, body, ip = '1.2.3.4') =>
  new Request('https://site.test/api/me', {
    method,
    headers: { ...(password ? { authorization: `Bearer ${password}` } : {}), 'cf-connecting-ip': ip },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe('cloud sync', () => {
  it('reports whether sync is set up', async () => {
    expect(await status(fakeEnv()).json()).toEqual({ sync: true });
    expect(await status({}).json()).toEqual({ sync: false });
  });

  it('refuses a missing or wrong password and locks out repeated guesses', async () => {
    const env = fakeEnv();
    expect((await getMe(req('GET', null), env)).status).toBe(401);
    for (let i = 0; i < 9; i++) expect((await getMe(req('GET', 'nope'), env)).status).toBe(401);
    expect((await getMe(req('GET', 'correct horse'), env)).status).toBe(429); // even the right one, until the window passes
    expect((await getMe(req('GET', 'correct horse', undefined, '9.9.9.9'), env)).status).toBe(200);
  });

  it('is absent when the site has no sync storage', async () => {
    expect((await getMe(req('GET', 'x'), { SYNC_PASSWORD: 'x' })).status).toBe(404);
  });

  it('stores a cleaned profile and returns it to another device', async () => {
    const env = fakeEnv();
    const put = await putMe(
      req('PUT', 'correct horse', {
        holdings: [
          { code: '0050.TW', shares: 1000, cost: 98.76 },
          { code: '0050.TW', shares: 1, cost: 1 },
          { code: 'DROP TABLE', shares: 1, cost: 1 },
          { code: '2330.TW', shares: -5, cost: 10 },
        ],
        watch: ['2330.TW', '2330.TW', '<script>'],
      }),
      env,
    );
    expect(put.status).toBe(200);
    const me = await (await getMe(req('GET', 'correct horse'), env)).json();
    expect(me.profile.holdings).toEqual([{ code: '0050.TW', shares: 1000, cost: 98.76 }]);
    expect(me.profile.watch).toEqual(['2330.TW']);
    expect(me.vapid_public.length).toBeGreaterThan(80);
    expect(me.briefing).toBeNull();
  });

  it('rejects malformed bodies', async () => {
    const env = fakeEnv();
    const bad = new Request('https://site.test/api/me', { method: 'PUT', headers: { authorization: 'Bearer correct horse' }, body: '{not json' });
    expect((await putMe(bad, env)).status).toBe(400);
    expect(cleanProfile(null)).toEqual({ holdings: [], watch: [] });
  });

  it('adds and removes push devices and keeps one push identity', async () => {
    const env = fakeEnv();
    const sub = { endpoint: 'https://web.push.apple.com/abc', keys: { p256dh: 'p', auth: 'a' } };
    expect(await (await changePush(req('POST', 'correct horse', { subscription: sub }), env)).json()).toEqual({ devices: 1 });
    expect(await (await changePush(req('POST', 'correct horse', { subscription: sub }), env)).json()).toEqual({ devices: 1 });
    const key = JSON.parse(env.store.get('push')).vapid.pub;
    expect((await changePush(req('POST', 'correct horse', { subscription: { endpoint: 'http://x' } }), env)).status).toBe(400);
    expect(await (await changePush(req('DELETE', 'correct horse', { subscription: sub }), env)).json()).toEqual({ devices: 0 });
    expect(JSON.parse(env.store.get('push')).vapid.pub).toBe(key);
  });
});
