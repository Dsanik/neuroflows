// NeuroFlow service worker
// IMPORTANT: app.js and index.html use network-first, NOT cache-first.
// A prior version of this file cached app.js aggressively, which caused fixes
// to silently not appear on testers' devices even after re-deploying — do not
// change this back to cache-first for those two files.

const CACHE_NAME = 'neuroflow-v2';
const STABLE_ASSETS = [
  'https://esm.sh/preact@10.22.0',
  'https://esm.sh/preact@10.22.0/hooks',
  'https://esm.sh/htm@3.1.1/preact?external=preact',
  'https://telegram.org/js/telegram-web-app.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(STABLE_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = e.request.url;
  const isAppCode = url.includes('/app.js') || url.includes('/index.html') || e.request.mode === 'navigate';

  if (isAppCode) {
    // Network-first: always try to get the latest app code; fall back to cache only if offline.
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request))
    );
    return;
  }

  // Cache-first for stable third-party libraries that rarely change.
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
