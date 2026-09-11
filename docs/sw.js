/*
 * The service worker for the hosted page: what lets the installed app open with
 * no connection (spec §12, local-first).
 *
 * The whole game is one HTML file — engine, screens, styles and the solved
 * tables are all inside it — so keeping that file, the manifest and the icons is
 * enough for both games to play offline.
 *
 * What it never does is stand in for the shared table. Requests to the table go
 * straight to the network and are never cached, so offline they fail, and the
 * page says it is offline instead of showing an old leaderboard as if it were
 * live.
 *
 * The cache name below carries a build token that the build replaces with the
 * build's commit and time, so each deploy gets a cache of its own and the
 * previous one is removed once this version takes over.
 */

const CACHE = 'ev-trainer-0ac097b7d81d-20260911223812';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png', './icons/apple-touch-icon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('ev-trainer-') && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

/** The shared table, and anything else that is someone else's live data. */
const isLiveData = (url) => url.hostname.endsWith('supabase.co') || url.pathname.includes('/rest/v1/');

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (isLiveData(url)) return; // straight to the network, never cached, never faked

  // The page itself: the network first, so a new deploy arrives as soon as it
  // is reachable; the kept copy when it is not.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put('./index.html', copy));
          return response;
        })
        .catch(() => caches.match('./index.html').then((kept) => kept || caches.match('./'))),
    );
    return;
  }

  // Everything else on this site, and the web fonts: the kept copy first, and
  // fetched into the cache the first time it is seen. Offline, a font that was
  // never fetched falls back to the system font the stylesheet already names.
  const sameSite = url.origin === self.location.origin;
  const font = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (!sameSite && !font) return;
  event.respondWith(
    caches.match(request).then(
      (kept) =>
        kept ||
        fetch(request).then((response) => {
          if (response.ok || response.type === 'opaque') {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
