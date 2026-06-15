// alysee DMS Service Worker
const CACHE = 'alydoc-v8';

// Install: sofort aktivieren
self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

// Activate: alle alten Caches loeschen, Clients uebernehmen
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Fetch: NUR Navigation (HTML-Seitenaufrufe) abfangen – IMMER frisch aus dem Netz holen
// (cache:'reload' umgeht den HTTP-Cache des Browsers → kein veralteter index.html-Stand)
self.addEventListener('fetch', event => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(
    fetch(event.request, { cache: 'reload' }).catch(() => fetch(event.request))
  );
});
