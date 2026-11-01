// Minimal zero-storage Service Worker for offline shell caching
const CACHE_NAME = 'gutar-gu-shell-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/static/style.css',
  '/static/crypto.js',
  '/static/app.js',
  '/static/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Only serve shell assets, NEVER intercept or cache websocket or room dynamic calls
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/ws') || url.pathname.startsWith('/api') || url.pathname.startsWith('/metrics')) {
    return;
  }

  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});

