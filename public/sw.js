'use strict';

const CACHE_NAME = 'arise-v1';
const STATIC_ASSETS = ['/', '/index.html'];

// Install — cache static shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

// Activate — clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch — network first, fall back to cache for navigation
self.addEventListener('fetch', (event) => {
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('/index.html'))
    );
  }
});

// Push — show system notification
self.addEventListener('push', (event) => {
  let data = { title: 'ARISE', body: 'The Architect has a message for you.', url: '/' };
  try { data = { ...data, ...event.data?.json() }; } catch (_) {}

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/arise-icon.svg',
      badge: '/arise-icon.svg',
      tag: 'arise-notification',
      renotify: true,
      data: { url: data.url },
      vibrate: [200, 100, 200],
    })
  );
});

// Notification click — focus or open app
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url ?? '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if ('focus' in client) return client.focus();
      }
      return clients.openWindow(targetUrl);
    })
  );
});
