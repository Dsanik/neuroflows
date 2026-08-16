const CACHE_NAME = 'neuroflow-v2';
const urlsToCache = [
  './',
  './index.html',
  './app.js',
  'https://esm.sh/preact@10.22.0',
  'https://esm.sh/preact@10.22.0/hooks',
  'https://esm.sh/htm@3.1.1/preact?external=preact',
  'https://telegram.org/js/telegram-web-app.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache)));
});

self.addEventListener('fetch', e => {
  e.respondWith(caches.match(e.request).then(response => response || fetch(e.request)));
});
