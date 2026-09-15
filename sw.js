const CACHE_NAME = 'fakkakha-shell-v3';
const SHELL_FILES = ['/', '/index.html', '/style.css', '/app.js', '/lib/i18n.js', '/push.js', '/manifest.json', '/icon-192.png', '/icon-512.png', '/policy.css'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.pathname.startsWith('/api/') || url.hostname.includes('supabase.co')) return;

  // Network-first for app code so a deployment is reflected immediately;
  // fall back to the cached shell when the user is offline.
  event.respondWith((async () => {
    try {
      const fresh = await fetch(event.request);
      if (fresh.ok && url.origin === self.location.origin) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(event.request, fresh.clone());
      }
      return fresh;
    } catch (_) {
      return (await caches.match(event.request)) || (await caches.match('/'));
    }
  })());
});
