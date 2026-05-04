const CACHE = 'dodge-v2';
const PRECACHE = [
  '/',
  '/index.html',
  '/auth.html',
  '/manifest.json',
  '/css/style.css',
  '/js/firebase-init.js',
  '/js/auth.js',
  '/js/profile.js',
  '/js/leaderboard.js',
  '/js/constants.js',
  '/js/game-engine.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Firebase e CDN: sempre rete
  if (
    url.hostname.includes('firebase') ||
    url.hostname.includes('google') ||
    url.hostname.includes('gstatic') ||
    e.request.method !== 'GET'
  ) {
    e.respondWith(fetch(e.request));
    return;
  }

  // Assets locali: cache-first, poi rete
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
