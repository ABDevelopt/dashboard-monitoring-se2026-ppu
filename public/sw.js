const CACHE_NAME = 'se2026-ppu-v2';
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
  // Do not cache opaque responses or non-200 responses
  if (!response || response.status !== 200 || response.type === 'opaque') return;
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response);
  } catch (err) {
    console.warn('[SW] cache.put failed (ignored):', err.message);
  }
}

// Fetch Event (Network First Fallback to Cache)
self.addEventListener('fetch', (event) => {
  // Only intercept GET requests
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // IMPORTANT: Only intercept same-origin requests!
  // Never intercept external CDNs, map tiles (Carto, OpenStreetMap, Esri, Google), or external APIs.
  if (url.origin !== self.location.origin) return;

  // Cache same-origin static assets (CSS, JS, images, fonts)
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
          safeCachePut(event.request, networkResponse.clone());
          return networkResponse;
        }).catch(() => new Response('', { status: 404, statusText: 'Not Found' }));
      })
    );
    return;
  }

  // For normal HTML page navigation: Network First, fall back to cache when offline
  const isHtml = event.request.headers.get('accept') && event.request.headers.get('accept').includes('text/html');
  if (!isHtml) return;

  event.respondWith(
    fetch(event.request).catch(() => {
      return caches.match(event.request).then((response) => {
        if (response) return response;
        return caches.match('/');
      });
    })
  );
});
