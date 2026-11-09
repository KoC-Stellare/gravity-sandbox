// Offline cache (service worker) check. The game only registers it on https, so it is registered by hand here.
// usage: node tests/offline.mjs [gamePath=/] [siteRoot=repository]
import { serve, launch, ROOT } from './lib.mjs';
import fs from 'node:fs';
const gp = process.argv[2] || '/', root = process.argv[3] || ROOT;
const srv = await serve(root, 8851);
const b = await launch();
const ctx = await b.newContext();
const stub = fs.readFileSync(new URL('./supabase-stub.js', import.meta.url), 'utf8');
let cdn = 0;
await ctx.route(/cdn\.jsdelivr\.net\/npm\/@supabase/, (r) => { cdn++; r.fulfill({ contentType: 'text/javascript', body: stub, headers: { 'access-control-allow-origin': '*' } }); });
await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ contentType: 'text/css', body: '', headers: { 'access-control-allow-origin': '*' } }));
const page = await ctx.newPage();
const log = [];
page.on('console', (m) => { if (m.type() === 'error') log.push(m.text()); });
page.on('pageerror', (e) => log.push('pageerror ' + e.message));
const ready = () => page.waitForFunction(() => window.__gs?.menu && !document.querySelector('#loading.show'), null, { timeout: 60000 });
await page.goto('http://localhost:8851' + gp); await ready();
await page.evaluate(async () => { await navigator.serviceWorker.register('/sw.js'); await navigator.serviceWorker.ready; });
await page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 20000 });
await page.reload(); await ready();
const first = await page.evaluate(async () => {
  const keys = await caches.keys(); const c = await caches.open(keys[0]);
  const paths = (await c.keys()).map((r) => new URL(r.url).pathname);
  const online = (await import('/js/net/supa.js')).online;
  const extra = await fetch('/docs/screenshot-wall.webp').then((r) => r.status).catch(() => 'no file');
  const ranged = await fetch('/lib/BufferGeometryUtils.js', { headers: { range: 'bytes=0-9' } }).then((r) => r.status);
  const after = (await c.keys()).map((r) => new URL(r.url).pathname);
  return { cache: keys, n: paths.length, online, extra, ranged, docCached: after.some((p) => p.startsWith('/docs/')), controlled: !!navigator.serviceWorker.controller };
});
console.log('online, controlled:', JSON.stringify(first));
// now cut the network: the game must still start from the cache
srv.close(); await new Promise((r) => setTimeout(r, 300));
await page.reload().catch((e) => log.push('reload failed ' + e.message));
let offline = false;
try { await ready(); offline = await page.evaluate(async () => { const { getDefaultMap } = await import('/js/maps/defaults.js'); __gs.playSolo(getDefaultMap('lab')); return __gs.game.mode === 'play'; }); } catch (e) { log.push(String(e.message).split('\n')[0]); }
console.log('starts and plays with the server down:', offline);
const errors = log.filter((l) => !/GPU stall|swiftshader|GL Driver|ERR_CONNECTION_REFUSED|Failed to load resource/i.test(l));
console.log('errors:', errors);
await b.close();
const pass = first.controlled && first.online && !first.docCached && offline && !errors.length;
console.log(pass ? 'PASS' : 'FAIL');
process.exit(pass ? 0 : 1);
