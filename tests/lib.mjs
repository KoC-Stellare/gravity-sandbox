import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const HERE = path.dirname(new URL(import.meta.url).pathname);
/** The site folder: the repository root. */
export const ROOT = path.join(HERE, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.mp4': 'video/mp4', '.svg': 'image/svg+xml' };

/** Static server that applies _redirects (200 rewrites) and _headers like Netlify. */
export function serve(root, port) {
  const rules = fs.readFileSync(path.join(root, '_redirects'), 'utf8').trim().split('\n').map((l) => l.trim().split(/\s+/)).filter((r) => r.length >= 2);
  const headers = [];
  let cur = null;
  for (const line of fs.readFileSync(path.join(root, '_headers'), 'utf8').split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) { cur = { pat: line.trim(), h: {} }; headers.push(cur); } else if (cur) { const i = line.indexOf(':'); cur.h[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim(); }
  }
  const srv = http.createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let p = url;
    if (!fs.existsSync(path.join(root, p)) || p === '/') {
      for (const [from, to] of rules) { const re = new RegExp('^' + from.replace('*', '.*') + '$'); if (re.test(p)) { p = to; break; } }
    }
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(root, p);
    fs.readFile(f, (err, data) => {
      if (err) { res.writeHead(404); res.end('404'); return; }
      const h = { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' };
      for (const r of headers) { const re = new RegExp('^' + r.pat.replace(/\*/g, '.*') + '$'); if (re.test(url) || re.test(p)) Object.assign(h, r.h); }
      res.writeHead(200, h); res.end(data);
    });
  });
  return new Promise((r) => srv.listen(port, () => r(srv)));
}

export async function launch() {
  return chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
}

/** New page with the Supabase import replaced by the stub. user = {id,name,color} or null (guest). */
export async function openPage(ctx, base, { user = null, path: p = '/', log = [] } = {}) {
  const page = await ctx.newPage();
  await page.route(/cdn\.jsdelivr\.net\/npm\/@supabase/, (r) => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(HERE, 'supabase-stub.js'), 'utf8') }));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ contentType: 'text/css', body: '' }));
  await page.addInitScript((u) => { if (u) localStorage.setItem('__stubUser', JSON.stringify(u)); else localStorage.removeItem('__stubUser'); try { localStorage.setItem('gs_settings', JSON.stringify({ showTips: false, quality: 'low' })); } catch {} }, user);
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') log.push(`[${user?.name || 'guest'}] ${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => log.push(`[${user?.name || 'guest'}] pageerror: ${e.message}`));
  await page.goto(base + p);
  await page.waitForFunction(() => window.__gs?.menu && !document.querySelector('#loading.show'), null, { timeout: 60000 });
  return page;
}

export function checker() {
  const results = [];
  const ok = (name, cond, extra = '') => { results.push({ name, pass: !!cond }); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); };
  const done = () => { const f = results.filter((r) => !r.pass).length; console.log(`\n${results.length - f}/${results.length} passed`); return f; };
  return { ok, done };
}
