// My Bookshelf — offline service worker
// Bump CACHE_VERSION any time you edit my-bookshelf.html so returning
// users get the fresh copy instead of a stale cached one.
const CACHE_VERSION = 'v5';
const SHELL_CACHE  = `bookshelf-shell-${CACHE_VERSION}`;
const COVER_CACHE  = 'bookshelf-covers-v1';   // covers rarely change once fetched, keep across shell versions
const FONT_CACHE   = 'bookshelf-fonts-v1';    // same for fonts

const SHELL_URLS = ['./', './index.html'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // Try each shell URL independently — don't let a 404 on one (e.g. if
    // the file is still named my-bookshelf.html locally) block install.
    await Promise.all(SHELL_URLS.map(async (url) => {
      try { await cache.add(url); } catch (e) { /* ignore */ }
    }));
  })());
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  const keep = new Set([SHELL_CACHE, COVER_CACHE, FONT_CACHE]);
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => !keep.has(k)).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Cache-first: good for things that rarely change once fetched (covers, fonts).
async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    // Cross-origin <img>/font requests often come back "opaque" (status 0,
    // can't be inspected) — still cacheable and servable, so accept those too.
    if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
    return res;
  } catch (e) {
    return cached || Response.error();
  }
}

// Network-first: good for the app shell so edits show up right away when
// online, while still falling back to the last cached copy when offline.
async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    const cached = await cache.match(req) || await cache.match('./');
    if (cached) return cached;
    return new Response(
      '<h1>Offline</h1><p>No cached copy of My Bookshelf yet — open it once while online first.</p>',
      { status: 503, headers: { 'Content-Type': 'text/html' } }
    );
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }

  // App shell (the HTML page itself)
  if (req.mode === 'navigate' || req.destination === 'document') {
    event.respondWith(networkFirst(req, SHELL_CACHE));
    return;
  }

  // Book cover images from Open Library
  if (url.hostname === 'covers.openlibrary.org') {
    event.respondWith(cacheFirst(req, COVER_CACHE));
    return;
  }

  // Google Fonts (stylesheet + font files)
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(req, FONT_CACHE));
    return;
  }

  // Everything else same-origin (icons, future assets): network first, cache fallback
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(req, SHELL_CACHE));
  }
});
