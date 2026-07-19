const CACHE_NAME = 'se2026-ppu-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/css/style.css',
  '/logo-mark.png',
  '/logo-horizontal.png'
];

// Install Event
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

// Activate Event
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Safe cache put helper — silently swallows storage errors
async function safeCachePut(request, response) {
  // Do not cache opaque responses (cross-origin, type 'opaque') —
  // they can trigger quota errors and have hidden error status codes
  if (!response || response.status !== 200 || response.type === 'opaque') return;
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response);
  } catch (err) {
    // Silently ignore cache storage errors (quota exceeded, internal errors, etc.)
    console.warn('[SW] cache.put failed (ignored):', err.message);
  }
}

// Fetch Event (Network First Fallback to Cache)
self.addEventListener('fetch', (event) => {
  // Only intercept GET requests, avoid API / dynamic pages
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // Cache static assets (CSS, JS, images, fonts)
  if (
    url.pathname.includes('/css/') ||
    url.pathname.includes('/js/') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.woff2')
  ) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) return cachedResponse;

        return fetch(event.request).then((networkResponse) => {
          // Clone before consuming — safeCachePut uses the clone
          safeCachePut(event.request, networkResponse.clone());
          return networkResponse;
        }).catch(() => caches.match('/'));
      })
    );
    return;
  }

  // For normal page navigation: Network First, fall back to cache when offline
  const isHtml = event.request.headers.get('accept') && event.request.headers.get('accept').includes('text/html');
  if (!isHtml) return; // Bypass API, AJAX, JSON, and other formats

  event.respondWith(
    fetch(event.request).catch(() => {
      return caches.match(event.request).then((response) => {
        if (response) return response;
        // Offline fallback for HTML pages: serve root cache
        return caches.match('/');
      });
    })
  );
});
