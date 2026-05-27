/**
 * PWA: precache per offline + rete prima per HTML/JS/CSS così ogni deploy
 * si vede subito (fallback su cache se offline).
 * Bump CACHE quando vuoi uno svuotamento duro su tutti i client.
 */
const CACHE = 'dodge-v68';
const PRECACHE = [
  '/',
  '/index.html',
  '/auth.html',
  '/privacy.html',
  '/terms.html',
  '/contact.html',
  '/manifest.json',
  '/css/style.css',
  '/css/consent.css',
  '/js/consent.js',
  '/js/legal-page.js',
  '/js/firebase-init.js',
  '/js/auth.js',
  '/js/profile.js',
  '/js/leaderboard.js',
  '/js/constants.js',
  '/js/missions-config.json',
  '/js/game-engine.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isFirebaseOrCdn(url) {
  return (
    url.hostname.includes('firebase') ||
    url.hostname.includes('google') ||
    url.hostname.includes('gstatic')
  );
}

/** Stessa origine: pagine, bundle e config — sempre rete prima (poi cache). */
function isNetworkFirstAsset(url) {
  if (url.origin !== self.location.origin) return false;
  const p = url.pathname;
  if (p === '/' || p.endsWith('.html') || p.startsWith('/admin') || p.startsWith('/profile')) return true;
  return /\.(js|css|json)$/i.test(p);
}

function isLeaderboardApi(url) {
  return url.origin === self.location.origin && url.pathname.startsWith('/api/leaderboard/');
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (isFirebaseOrCdn(url) || e.request.method !== 'GET') {
    e.respondWith(fetch(e.request));
    return;
  }

  if (isNetworkFirstAsset(url)) {
    e.respondWith(
      fetch(e.request, { cache: 'no-store' })
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return res;
        })
        .catch(() => caches.match(e.request).then((hit) => hit || Promise.reject(new Error('offline'))))
    );
    return;
  }

  if (isLeaderboardApi(url)) {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(e.request);
      const networkPromise = fetch(e.request, { cache: 'no-store' })
        .then((res) => {
          if (res && res.ok) cache.put(e.request, res.clone());
          return res;
        })
        .catch(() => null);
      if (cached) {
        networkPromise.catch(() => {});
        return cached;
      }
      const networkRes = await networkPromise;
      if (networkRes) return networkRes;
      throw new Error('offline');
    })());
    return;
  }

  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request))
  );
});
