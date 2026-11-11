/** Web push on this device. The subscription is registered with the sync service. */

function fromB64(text: string): Uint8Array<ArrayBuffer> {
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export type PushState = 'unsupported' | 'off' | 'blocked' | 'on';

async function subscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  return (await subscription()) && Notification.permission === 'granted' ? 'on' : 'off';
}

/** Ask for permission and subscribe this device. Must be called from a tap. */
export async function enablePush(vapidPublic: string): Promise<PushSubscriptionJSON> {
  if (!pushSupported()) throw new Error('這個瀏覽器不支援推播。iPhone 要先把網站加入主畫面，再從主畫面打開。');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('通知沒有被允許。請到系統設定裡打開這個 App 的通知。');
  await navigator.serviceWorker.register('./sw.js');
  const reg = await navigator.serviceWorker.ready;
  const options = { userVisibleOnly: true, applicationServerKey: fromB64(vapidPublic) };
  try {
    return (await reg.pushManager.subscribe(options)).toJSON();
  } catch {
    // A subscription made for an older key blocks a new one.
    await (await reg.pushManager.getSubscription())?.unsubscribe();
    return (await reg.pushManager.subscribe(options)).toJSON();
  }
}

/** Unsubscribe this device; returns what to remove from the sync service. */
export async function disablePush(): Promise<PushSubscriptionJSON | null> {
  const sub = await subscription();
  if (!sub) return null;
  const json = sub.toJSON();
  await sub.unsubscribe();
  return json;
}

export async function showTestNotification(): Promise<void> {
  const reg = await navigator.serviceWorker.ready;
  await reg.showNotification('台股投資助手', { body: '這台裝置可以顯示通知。', icon: './icon-512.png', tag: 'test' });
}
