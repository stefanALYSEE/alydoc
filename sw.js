// alysee DMS Service Worker
const CACHE = 'alysee-dms-v1';
const OFFLINE_URL = '/alysee-dms.html';

// Assets die beim Install gecacht werden
const PRECACHE = [
  '/alysee-dms.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png'
];

// Install: Core-Assets cachen
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => {
      return cache.addAll(PRECACHE);
    }).then(() => self.skipWaiting())
  );
});

// Activate: Alten Cache aufräumen
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch: Network-first für API-Calls, Cache-first für App-Shell
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Google APIs, Anthropic API, CDN-Ressourcen → immer Network
  if (
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('google.com') ||
    url.hostname.includes('anthropic.com') ||
    url.hostname.includes('unpkg.com') ||
    url.hostname.includes('cdnjs.cloudflare.com') ||
    url.hostname.includes('gstatic.com') ||
    url.hostname.includes('accounts.google.com')
  ) {
    return; // Kein Cache-Intercept
  }

  // App-Shell (HTML, Manifest, Icons) → Cache-first, Fallback Network
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        // Erfolgreiche Responses cachen
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // Offline-Fallback: App-Shell zurückgeben
        if (event.request.mode === 'navigate') {
          return caches.match(OFFLINE_URL);
        }
      });
    })
  );
});
