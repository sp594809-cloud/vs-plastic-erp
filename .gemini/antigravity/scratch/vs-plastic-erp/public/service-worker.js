const CACHE_NAME = 'vs-plastic-cache-v3';

const ASSETS_TO_CACHE = [
  '/login',
  '/css/custom-adminlte.css',
  '/manifest.json',
  '/images/icon-192.png',
  '/images/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS_TO_CACHE).catch(() => undefined))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.map((n) => (n !== CACHE_NAME ? caches.delete(n) : undefined)))
    ).then(() => self.clients.claim())
  );
});

function isCacheableRequest(request) {
  try {
    const url = new URL(request.url);
    // Only http(s). Skip chrome-extension, data:, blob:, etc.
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    // Don't cache non-GET
    if (request.method !== 'GET') return false;
    return true;
  } catch {
    return false;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (!isCacheableRequest(request)) return;

  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;

  // App pages / API: network first, then cache
  if (sameOrigin) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok && response.type === 'basic') {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              try { cache.put(request, clone); } catch (_) {}
            }).catch(() => {});
          }
          return response;
        })
        .catch(() =>
          caches.match(request).then((cached) => {
            if (cached) return cached;
            if (request.mode === 'navigate') return caches.match('/login');
            return new Response('Offline', { status: 503, statusText: 'Offline' });
          })
        )
    );
    return;
  }

  // CDN / external: cache first, never throw
  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              try { cache.put(request, clone); } catch (_) {}
            }).catch(() => {});
          }
          return response;
        })
        .catch(() => cached || new Response('', { status: 504, statusText: 'CDN offline' }));

      return cached || networkFetch;
    }).catch(() => new Response('', { status: 504, statusText: 'CDN offline' }))
  );
});
