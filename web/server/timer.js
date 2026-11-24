// Starts the daily workflow on time. GitHub's own schedule often begins hours
// late, so a Cloudflare Worker with Cron Triggers asks GitHub to run the
// workflow instead (workflow_dispatch). The scheduled runs stay as a fallback
// and stand down when this one has already run (see the gate job).

const API = 'https://api.github.com';
const WAIT_MS = 20_000;

export function dispatchRequest(env) {
  if (!env.REPO || !/^[\w-][\w.-]*\/[\w-][\w.-]*$/.test(env.REPO)) throw new Error('REPO must look like owner/name');
  if (!env.GH_DISPATCH_TOKEN) throw new Error('GH_DISPATCH_TOKEN is not set');
  return new Request(`${API}/repos/${env.REPO}/actions/workflows/daily.yml/dispatches`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.GH_DISPATCH_TOKEN}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'tw-stock-assistant-timer',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ ref: env.BRANCH || 'main', inputs: { briefing: 'true' } }),
  });
}

// Tries three times. GitHub's 5xx answers and network errors are usually brief;
// a 4xx (bad or expired token, wrong repository) will not fix itself.
export async function dispatch(env, fetcher = fetch, wait = (ms) => new Promise((r) => setTimeout(r, ms))) {
  let last;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const res = await fetcher(dispatchRequest(env));
      if (res.ok) return res.status;
      const detail = (await res.text()).slice(0, 200);
      last = new Error(`GitHub answered ${res.status}: ${detail}`);
      if (res.status < 500) break;
    } catch (err) {
      if (/must look like|is not set/.test(err.message)) throw err;
      last = err;
    }
    if (attempt < 3) await wait(WAIT_MS * attempt);
  }
  throw last;
}
