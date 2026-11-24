import { describe, expect, it } from 'vitest';
import { dispatch, dispatchRequest } from './timer.js';

const env = { REPO: 'someone/some-site', GH_DISPATCH_TOKEN: 'test-token' };
const noWait = async () => {};

describe('on-time timer', () => {
  it('asks GitHub to run the daily workflow with a new briefing', async () => {
    const req = dispatchRequest(env);
    expect(req.method).toBe('POST');
    expect(req.url).toBe('https://api.github.com/repos/someone/some-site/actions/workflows/daily.yml/dispatches');
    expect(req.headers.get('authorization')).toBe('Bearer test-token');
    expect(req.headers.get('user-agent')).toBeTruthy();
    expect(await req.json()).toEqual({ ref: 'main', inputs: { briefing: 'true' } });
  });

  it('refuses a missing token or a malformed repository', () => {
    expect(() => dispatchRequest({ REPO: 'someone/some-site' })).toThrow(/GH_DISPATCH_TOKEN/);
    expect(() => dispatchRequest({ ...env, REPO: '../x' })).toThrow(/owner\/name/);
  });

  it('retries a server error, then succeeds', async () => {
    let calls = 0;
    const fetcher = async () => (++calls < 2 ? new Response('busy', { status: 502 }) : new Response(null, { status: 204 }));
    expect(await dispatch(env, fetcher, noWait)).toBe(204);
    expect(calls).toBe(2);
  });

  it('does not retry a rejected token', async () => {
    let calls = 0;
    const fetcher = async () => { calls += 1; return new Response('Bad credentials', { status: 401 }); };
    await expect(dispatch(env, fetcher, noWait)).rejects.toThrow(/401: Bad credentials/);
    expect(calls).toBe(1);
  });

  it('gives up after three network errors', async () => {
    let calls = 0;
    const fetcher = async () => { calls += 1; throw new TypeError('network down'); };
    await expect(dispatch(env, fetcher, noWait)).rejects.toThrow(/network down/);
    expect(calls).toBe(3);
  });
});
