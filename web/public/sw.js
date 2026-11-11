// Service worker: shows briefing notifications. It does not cache anything,
// so the app always loads fresh data.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  event.waitUntil(
    self.registration.showNotification(String(data.title || '台股投資助手'), {
      body: String(data.body || ''),
      icon: './icon-512.png',
      tag: 'briefing',
      data: { url: typeof data.url === 'string' ? data.url : './' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  let target = new URL('./', self.registration.scope);
  try {
    const wanted = new URL(event.notification.data?.url ?? './', self.registration.scope);
    if (wanted.origin === target.origin) target = wanted; // never open another site
  } catch {
    // keep the default
  }
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => 'focus' in w);
      if (open) {
        open.navigate?.(target.href);
        return open.focus();
      }
      return self.clients.openWindow(target.href);
    }),
  );
});
