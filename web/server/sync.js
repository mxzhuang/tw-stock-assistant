// Server side of cloud sync, used by the Cloudflare Pages Functions in
// functions/api. One site has one owner: everything personal sits behind a
// single password (the SYNC_PASSWORD secret) and lives in the owner's own
// Workers KV namespace (bound as SYNC).
//
// Keys:  profile  -> { holdings, watch, updated_at }
//        push     -> { vapid: { pub, priv }, subs: [subscription, ...] }
//        briefing -> written by the scheduled job, read here

const SYMBOL = /^(\d{4,6}[A-Z]?\.(TW|TWO)|[A-Z]{2,6})$/;
const MAX_HOLDINGS = 50;
const MAX_WATCH = 40;
const MAX_SUBS = 6;
const MAX_BODY = 20000;
const MAX_FAILS = 10; // wrong passwords per address ...
const FAIL_WINDOW = 900; // ... within this many seconds

export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

export const enabled = (env) => Boolean(env && env.SYNC && env.SYNC_PASSWORD);

async function digest(text) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

/** Compare via fixed-length digests so timing does not leak the password. */
async function samePassword(given, expected) {
  const [a, b] = await Promise.all([digest(given), digest(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * The unit that wrong passwords are counted against: an IPv4 address, or the
 * /64 an IPv6 address belongs to. One subscriber usually holds a whole /64, so
 * counting single IPv6 addresses would let them keep guessing from fresh ones.
 */
export function clientBucket(ip) {
  const text = String(ip ?? '').trim().toLowerCase();
  if (!text.includes(':')) return text || 'unknown';
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  if (mapped) return mapped[1];
  const [head, tail = ''] = text.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = text.includes('::') ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right] : left;
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return 'unknown';
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

/**
 * Returns null when the request carries the right password, otherwise the
 * Response to send back. Repeated failures from one address are locked out.
 */
export async function authorize(request, env) {
  if (!enabled(env)) return json({ error: 'sync is not set up on this site' }, 404);
  const failKey = `fail:${clientBucket(request.headers.get('cf-connecting-ip'))}`;
  const fails = Number((await env.SYNC.get(failKey)) ?? 0);
  if (fails >= MAX_FAILS) return json({ error: 'too many attempts; try again in 15 minutes' }, 429);

  const header = request.headers.get('authorization') ?? '';
  const given = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (given && (await samePassword(given, env.SYNC_PASSWORD))) return null;

  await env.SYNC.put(failKey, String(fails + 1), { expirationTtl: FAIL_WINDOW });
  return json({ error: 'wrong password' }, 401);
}

async function read(env, key, fallback) {
  try {
    const value = await env.SYNC.get(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

async function readBody(request) {
  const text = await request.text();
  if (text.length > MAX_BODY) throw new Error('too large');
  return JSON.parse(text);
}

export function cleanProfile(input) {
  const holdings = [];
  const seen = new Set();
  for (const h of Array.isArray(input?.holdings) ? input.holdings : []) {
    const code = String(h?.code ?? '');
    const shares = Number(h?.shares);
    const cost = Number(h?.cost);
    if (!SYMBOL.test(code) || seen.has(code)) continue;
    if (!Number.isInteger(shares) || shares <= 0 || shares > 1e9 || !(cost > 0) || cost > 1e7) continue;
    seen.add(code);
    holdings.push({ code, shares, cost });
  }
  const watch = [...new Set((Array.isArray(input?.watch) ? input.watch : []).filter((c) => typeof c === 'string' && SYMBOL.test(c)))];
  return { holdings: holdings.slice(0, MAX_HOLDINGS), watch: watch.slice(0, MAX_WATCH) };
}

function b64(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The site's push identity, created the first time it is needed. */
async function pushState(env) {
  const state = await read(env, 'push', null);
  if (state?.vapid?.pub && state?.vapid?.priv) return { vapid: state.vapid, subs: Array.isArray(state.subs) ? state.subs : [] };
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pub = b64(await crypto.subtle.exportKey('raw', pair.publicKey));
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const fresh = { vapid: { pub, priv: jwk.d }, subs: [] };
  await env.SYNC.put('push', JSON.stringify(fresh));
  return fresh;
}

function cleanSubscription(input) {
  const endpoint = String(input?.endpoint ?? '');
  const p256dh = String(input?.keys?.p256dh ?? '');
  const auth = String(input?.keys?.auth ?? '');
  if (!endpoint.startsWith('https://') || endpoint.length > 1000 || !p256dh || !auth || p256dh.length > 200 || auth.length > 100) return null;
  return { endpoint, keys: { p256dh, auth } };
}

/** GET /api/status — public: tells the app whether sync exists on this site. */
export function status(env) {
  return json({ sync: enabled(env) });
}

/** GET /api/me — everything personal, for a signed-in device. */
export async function getMe(request, env) {
  const denied = await authorize(request, env);
  if (denied) return denied;
  const [profile, briefing, push] = await Promise.all([read(env, 'profile', null), read(env, 'briefing', null), pushState(env)]);
  return json({ profile, briefing, vapid_public: push.vapid.pub, devices: push.subs.length });
}

/** PUT /api/me — replace holdings and the tracking list. */
export async function putMe(request, env) {
  const denied = await authorize(request, env);
  if (denied) return denied;
  let body;
  try {
    body = await readBody(request);
  } catch {
    return json({ error: 'invalid body' }, 400);
  }
  const profile = { ...cleanProfile(body), updated_at: new Date().toISOString() };
  await env.SYNC.put('profile', JSON.stringify(profile));
  return json({ profile });
}

/** POST /api/push adds this device; DELETE /api/push removes it. */
export async function changePush(request, env) {
  const denied = await authorize(request, env);
  if (denied) return denied;
  let sub;
  try {
    sub = cleanSubscription((await readBody(request)).subscription);
  } catch {
    sub = null;
  }
  if (!sub) return json({ error: 'invalid subscription' }, 400);
  const state = await pushState(env);
  const others = state.subs.filter((s) => s.endpoint !== sub.endpoint);
  const subs = request.method === 'DELETE' ? others : [...others, sub].slice(-MAX_SUBS);
  await env.SYNC.put('push', JSON.stringify({ vapid: state.vapid, subs }));
  return json({ devices: subs.length });
}
