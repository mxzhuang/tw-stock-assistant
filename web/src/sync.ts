/**
 * Cloud sync: holdings, the tracking list and the personal briefing live in the
 * site owner's own storage behind one password. Sites deployed without it keep
 * everything in the browser, as before.
 */
import type { BriefingFile, Holding } from './types';

const PASSWORD = 'sync:password';

export interface Me {
  profile: { holdings: Holding[]; watch: string[]; updated_at: string } | null;
  briefing: BriefingFile | null;
  vapid_public: string;
  devices: number;
}

export async function syncAvailable(): Promise<boolean> {
  try {
    const res = await fetch('./api/status', { cache: 'no-store' });
    if (!res.ok || !res.headers.get('content-type')?.includes('json')) return false;
    return Boolean(((await res.json()) as { sync?: boolean }).sync);
  } catch {
    return false;
  }
}

export const savedPassword = (): string | null => {
  try {
    return localStorage.getItem(PASSWORD);
  } catch {
    return null;
  }
};

export function rememberPassword(password: string | null): void {
  try {
    if (password) localStorage.setItem(PASSWORD, password);
    else localStorage.removeItem(PASSWORD);
  } catch {
    // private browsing: stay signed in for this visit only
  }
}

async function call<T>(password: string, path: string, method = 'GET', body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      cache: 'no-store',
      headers: { authorization: `Bearer ${password}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('連不上同步服務，請檢查網路後再試。');
  }
  if (res.status === 401) throw new Error('密碼不對。');
  if (res.status === 429) throw new Error('密碼錯太多次，請 15 分鐘後再試。');
  if (!res.ok) throw new Error(`同步失敗（HTTP ${res.status}）。`);
  return (await res.json()) as T;
}

export const fetchMe = (password: string) => call<Me>(password, './api/me');

export const saveProfile = (password: string, holdings: Holding[], watch: string[]) =>
  call<unknown>(password, './api/me', 'PUT', { holdings, watch });

export const addDevice = (password: string, subscription: PushSubscriptionJSON) =>
  call<{ devices: number }>(password, './api/push', 'POST', { subscription });

export const removeDevice = (password: string, subscription: PushSubscriptionJSON) =>
  call<{ devices: number }>(password, './api/push', 'DELETE', { subscription });

/** The generic briefing every visitor can read (no holdings in it). */
export async function loadPublicBriefing(): Promise<BriefingFile | null> {
  try {
    const res = await fetch('./data/briefing.json', { cache: 'no-cache' });
    if (!res.ok || !res.headers.get('content-type')?.includes('json')) return null;
    const file = (await res.json()) as BriefingFile;
    return file.schema === 2 && file.body ? file : null;
  } catch {
    return null;
  }
}

export interface Setup {
  sync: boolean;
  claude: boolean;
}

/** Which optional features the site owner has switched on (written at deploy time). */
export async function loadSetup(): Promise<Setup | null> {
  try {
    const res = await fetch('./data/setup.json', { cache: 'no-cache' });
    if (!res.ok || !res.headers.get('content-type')?.includes('json')) return null;
    const data = (await res.json()) as Partial<Setup>;
    return { sync: data.sync === true, claude: data.claude === true };
  } catch {
    return null;
  }
}
