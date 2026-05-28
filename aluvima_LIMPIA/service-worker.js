/**
 * service-worker.js — Aluvima Mérida
 * ────────────────────────────────────────────────────────
 * Cache básico para que el sitio funcione offline o con
 * conexión lenta. Esencial para que sea instalable como PWA.
 *
 * Estrategia:
 *  • App shell (HTML/CSS/JS): network-first, fallback cache
 *  • Imágenes: cache-first con LRU (máx 80 entradas / 30 días)
 *  • Otros (fuentes, CDNs): stale-while-revalidate con LRU (40 / 14 días)
 * ──────────────────────────────────────────────────────── */

// ⚠️ Cada vez que cambien archivos en APP_SHELL_URLS, sube este número.
// El SW desinstala las versiones viejas en el evento `activate`.
const VERSION  = 'aluvima-v3';
const SHELL    = `${VERSION}-shell`;
const IMAGES   = `${VERSION}-img`;
const RUNTIME  = `${VERSION}-runtime`;

const APP_SHELL_URLS = [
  '/',
  '/index.html',
  '/css/styles.css',
  '/js/config.js',
  '/js/products.js',
  '/js/products.json',   // catálogo lazy-load (1.2 MB · ~150 KB con gzip)
  '/js/customers.js',
  '/js/cart.js',
  '/js/checkout.js',
  '/js/main.js',
  '/manifest.webmanifest',
];

// Límites del LRU (antes el código no implementaba la promesa del comentario)
const IMAGES_MAX_ENTRIES  = 80;
const IMAGES_MAX_AGE_MS   = 30 * 24 * 3600 * 1000;   // 30 días
const RUNTIME_MAX_ENTRIES = 40;
const RUNTIME_MAX_AGE_MS  = 14 * 24 * 3600 * 1000;   // 14 días

// ─── INSTALL ──────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL)
      .then(cache => cache.addAll(APP_SHELL_URLS))
      .then(() => self.skipWaiting())
  );
});

// ─── ACTIVATE ─────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => !k.startsWith(VERSION)).map(k => caches.delete(k))
      ))
      .then(() => Promise.all([
        trimCache(IMAGES,  IMAGES_MAX_ENTRIES,  IMAGES_MAX_AGE_MS),
        trimCache(RUNTIME, RUNTIME_MAX_ENTRIES, RUNTIME_MAX_AGE_MS),
      ]))
      .then(() => self.clients.claim())
  );
});

// ─── FETCH ────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  if (req.destination === 'image') {
    event.respondWith(cacheFirst(req, IMAGES));
    return;
  }
  if (url.origin === location.origin) {
    event.respondWith(networkFirst(req, SHELL));
    return;
  }
  event.respondWith(staleWhileRevalidate(req, RUNTIME));
});

// ─── ESTRATEGIAS ─────────────────────────────────────
async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const fresh = await fetch(req);
    if (fresh.ok) {
      await cachePut(cache, req, fresh);
      maybeTrim(cacheName);
    }
    return fresh;
  } catch (e) {
    return new Response('', { status: 504 });
  }
}

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const fresh = await fetch(req);
    if (fresh.ok) await cachePut(cache, req, fresh);
    return fresh;
  } catch (e) {
    const cached = await cache.match(req);
    if (cached) return cached;
    return cache.match('/index.html') || new Response('Sin conexión', { status: 503 });
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const fetchPromise = fetch(req).then(async res => {
    if (res.ok) {
      await cachePut(cache, req, res.clone());
      maybeTrim(cacheName);
    }
    return res;
  }).catch(() => cached);
  return cached || fetchPromise;
}

// ─── LRU helpers ─────────────────────────────────────
async function cachePut(cache, req, res) {
  const headers = new Headers(res.headers);
  headers.set('sw-cache-time', String(Date.now()));
  const stamped = new Response(await res.clone().blob(), {
    status: res.status, statusText: res.statusText, headers,
  });
  await cache.put(req, stamped);
}

async function trimCache(cacheName, maxEntries, maxAgeMs) {
  try {
    const cache = await caches.open(cacheName);
    const keys  = await cache.keys();
    const now   = Date.now();
    const aged  = await Promise.all(keys.map(async req => {
      const res = await cache.match(req);
      const ts  = parseInt(res && res.headers.get('sw-cache-time') || '0', 10);
      return { req, ts: ts || now };
    }));
    const expired = aged.filter(e => now - e.ts > maxAgeMs);
    await Promise.all(expired.map(e => cache.delete(e.req)));
    const remaining = aged.filter(e => now - e.ts <= maxAgeMs)
                          .sort((a, b) => a.ts - b.ts);
    const excess = remaining.length - maxEntries;
    if (excess > 0) {
      await Promise.all(remaining.slice(0, excess).map(e => cache.delete(e.req)));
    }
  } catch (e) {
    console.warn('[SW] trimCache fallo:', cacheName, e);
  }
}

// Trim oportunista: 10 % de inserciones disparan limpieza (amortizado)
function maybeTrim(cacheName) {
  if (Math.random() > 0.1) return;
  if (cacheName === IMAGES)  trimCache(IMAGES,  IMAGES_MAX_ENTRIES,  IMAGES_MAX_AGE_MS);
  if (cacheName === RUNTIME) trimCache(RUNTIME, RUNTIME_MAX_ENTRIES, RUNTIME_MAX_AGE_MS);
}
