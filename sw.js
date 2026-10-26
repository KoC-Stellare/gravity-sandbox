// Gravity SandBox service worker: makes the game installable and caches the app + libraries.
const VERSION = 'gs-v1.2.0';
const SHELL = [
  '/play', '/play.html', '/css/style.css', '/lib/three.module.js', '/lib/BufferGeometryUtils.js', '/lib/rapier.js', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png',
  '/js/main.js', '/js/config.js', '/js/util.js', '/js/game.js',
  '/js/core/input.js', '/js/core/settings.js',
  '/js/render/renderer.js', '/js/render/materials.js',
  '/js/physics/catalog.js', '/js/physics/world.js', '/js/physics/sim.js',
  '/js/player/controller.js', '/js/player/mannequin.js',
  '/js/powers/powers.js', '/js/powers/visuals.js',
  '/js/maps/defaults.js', '/js/editor/editor.js',
  '/js/net/supa.js', '/js/net/room.js', '/js/net/social.js',
  '/js/ui/dom.js', '/js/ui/hud.js', '/js/ui/menu.js', '/js/ui/chat.js', '/js/ui/powerpanel.js', '/js/ui/help.js', '/js/ui/tutorial.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // never cache Supabase (auth, data, realtime)
  if (url.hostname.endsWith('supabase.co') || url.protocol === 'ws:' || url.protocol === 'wss:') return;
  // pinned CDN libraries & fonts: cache first
  if (url.hostname === 'cdn.jsdelivr.net' || url.hostname.endsWith('gstatic.com') || url.hostname === 'fonts.googleapis.com') {
    e.respondWith(caches.open(VERSION).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') c.put(req, res.clone());
      return res;
    }));
    return;
  }
  if (url.origin !== location.origin) return;
  // pages: network first (so updates arrive), fall back to cache
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(async () => (await caches.match(req)) || caches.match('/play.html')));
    return;
  }
  // app files: stale-while-revalidate
  e.respondWith(caches.open(VERSION).then(async (c) => {
    const hit = await c.match(req);
    const net = fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => hit);
    return hit || net;
  }));
});
