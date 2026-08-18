/**
 * Runtime caching only — no precache manifest.
 *
 * Vite renames every asset on each build, so a precache list would have to be
 * generated at build time (that is the one thing vite-plugin-pwa buys). Caching
 * what the app actually requests gets the same offline reload for none of that.
 *
 * ponytail: runtime cache only. Add vite-plugin-pwa if true offline-first
 * (installable before first visit to a route) is ever needed.
 */
const CACHE = 'esystm-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', event => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  // Same-origin GETs only. Supabase is cross-origin: a cached /rest/v1 row or
  // /auth/v1 token would serve stale data and stale sessions.
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  // The document is network-first: routing is hash-based, so every navigation
  // is "/", and serving that from cache would pin users to an old build.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          void caches.open(CACHE).then(cache => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then(hit => hit || caches.match('/'))),
    );
    return;
  }

  // Hashed assets never change under a URL, so cache-first is safe and is what
  // makes a second load instant.
  event.respondWith(
    caches.match(request).then(hit => hit || fetch(request).then(response => {
      if (response.ok && response.type === 'basic') {
        const copy = response.clone();
        void caches.open(CACHE).then(cache => cache.put(request, copy));
      }
      return response;
    })),
  );
});
