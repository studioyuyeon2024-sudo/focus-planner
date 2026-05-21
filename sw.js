// Focus Planner — service worker
// Strategy:
//   - App shell (HTML/CSS/JS/icons) → stale-while-revalidate
//   - esm.sh modules → cache-first (immutable URLs)
//   - Supabase API → network-only (always fresh, requires auth)
//   - Everything else (Google Fonts, etc) → stale-while-revalidate

const CACHE = 'fp-v3';
const SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/supabase.js',
  './js/auth.js',
  './js/state.js',
  './js/repo.js',
  './js/ui.js',
  './js/pomodoro.js',
  './js/planner.js',
  './js/calendar.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/maskable.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(SHELL);
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Skip Supabase API — always network
  if (url.hostname.endsWith('.supabase.co')) return;

  // Cache-first for esm.sh (immutable hashed URLs)
  if (url.hostname === 'esm.sh') {
    e.respondWith((async () => {
      const c = await caches.open(CACHE);
      const hit = await c.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok) c.put(req, res.clone());
        return res;
      } catch {
        return hit || new Response('offline', { status: 503 });
      }
    })());
    return;
  }

  // Stale-while-revalidate for same-origin and Google Fonts
  if (url.origin === self.location.origin || url.hostname.endsWith('googleapis.com') || url.hostname.endsWith('gstatic.com')) {
    e.respondWith((async () => {
      const c = await caches.open(CACHE);
      const hit = await c.match(req);
      const fetchPromise = fetch(req).then((res) => {
        if (res.ok) c.put(req, res.clone());
        return res;
      }).catch(() => hit);
      return hit || fetchPromise;
    })());
  }
});
