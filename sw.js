// alysee DMS Service Worker
const CACHE = 'alydoc-v3';
const OFFLINE_URL = '/index.html';

// Assets die beim Install gecacht werden
const PRECACHE = [
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png'
];

// Install: Core-Assets cachen, sofort aktivieren
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

// Fetch: Network-first fuer HTML, Cache-first fuer statische Assets
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Externe APIs → kein Cache-Intercept
  if (
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('google.com') ||
    url.hostname.includes('anthropic.com') ||
    url.hostname.includes('unpkg.com') ||
    url.hostname.includes('cdnjs.cloudflare.com') ||
    url.hostname.includes('gstatic.com') ||
    url.hostname.includes('accounts.google.com')
  ) {
    return;
  }

  // HTML-Dateien → IMMER Network-first (damit Updates sofort ankommen)
  if (event.request.mode === 'navigate' || url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(event.request).then(response => {
        // Erfolgreiche Response cachen fuer Offline
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // Offline-Fallback
        return caches.match(event.request).then(cached => cached || caches.match(OFFLINE_URL));
      })
    );
    return;
  }

  // Statische Assets (Icons, Manifest) → Cache-first
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
