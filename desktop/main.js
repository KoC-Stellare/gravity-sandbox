// Gravity SandBox desktop app (Electron). The game is the same website: its files are served
// from the private address app://gravity/ so absolute paths (/js/…, /lib/…) and the import map
// work unchanged. CDN imports (Supabase JS, Google Fonts) are swapped for bundled copies.
const { app, BrowserWindow, Menu, dialog, net, protocol, session, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const ORIGIN = 'app://gravity';
const WEB_ROOT = app.isPackaged ? path.join(process.resourcesPath, 'web') : path.join(__dirname, '..');
const VENDOR_ROOT = app.isPackaged ? path.join(WEB_ROOT, 'vendor') : path.join(__dirname, 'vendor');
const STATE_FILE = path.join(app.getPath('userData'), 'window.json');
const ALLOWED_PERMISSIONS = new Set(['pointerLock', 'clipboard-sanitized-write', 'fullscreen']);
const RELEASES_API = 'https://api.github.com/repos/KoC-Stellare/gravity-sandbox/releases/latest';
const RELEASES_PAGE = 'https://github.com/KoC-Stellare/gravity-sandbox/releases/latest';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.wasm': 'application/wasm',
};

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true } },
]);

// Dual-GPU laptops: run on the dedicated graphics card.
app.commandLine.appendSwitch('force_high_performance_gpu');

// A second copy hands over to the first one and stops here (nothing below may run for it).
const firstInstance = app.requestSingleInstanceLock();
if (!firstInstance) app.quit();

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return {}; }
}
function writeState(state) {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(state)); } catch { /* not important */ }
}

/** Maps a request path to a file inside the game folder (never outside it). */
function resolveFile(pathname) {
  const vendor = pathname.startsWith('/vendor/');
  const base = vendor ? VENDOR_ROOT : WEB_ROOT;
  const file = path.normalize(path.join(base, vendor ? pathname.slice('/vendor'.length) : pathname));
  return file.startsWith(base + path.sep) ? file : null;
}

function gameHtml() {
  return fs.readFileSync(path.join(WEB_ROOT, 'play.html'), 'utf8')
    .replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@[^"]+/, '/vendor/supabase.js')
    .replace(/\s*<link rel="preconnect"[^>]*>/g, '')
    .replace(/<link href="https:\/\/fonts\.googleapis\.com[^>]*>/, '<link rel="stylesheet" href="/vendor/fonts.css" />');
}

async function serve(request) {
  const { pathname } = new URL(request.url);
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return new Response('Bad request', { status: 400 }); }
  const file = resolveFile(decoded);
  // The app has no website pages: /, /play, /join/CODE and /map/TOKEN all open the game.
  if (!path.extname(pathname) || file === path.join(WEB_ROOT, 'play.html')) {
    return new Response(gameHtml(), { headers: { 'content-type': MIME['.html'] } });
  }
  if (!file) return new Response('Not found', { status: 404 });
  try {
    const body = await fs.promises.readFile(file);
    return new Response(body, { headers: { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' } });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}

function openExternal(url) {
  if (/^https?:\/\//.test(url)) shell.openExternal(url);
}

/** true when version string a (e.g. "1.10.0") is newer than b */
function isNewer(a, b) {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

/** The app has no auto-update: tell the player once per version when a newer release exists. */
async function checkForUpdate(win) {
  try {
    const res = await net.fetch(RELEASES_API, { headers: { accept: 'application/vnd.github+json' } });
    if (!res.ok) return;
    const latest = String((await res.json()).tag_name || '').replace(/^v/, '');
    const state = readState();
    if (!/^\d+\.\d+\.\d+$/.test(latest) || !isNewer(latest, app.getVersion()) || state.skipVersion === latest) return;
    const { response } = await dialog.showMessageBox(win, {
      type: 'info', buttons: ['Download', 'Later', 'Skip this version'], defaultId: 0, cancelId: 1,
      title: 'Update available', message: `Gravity SandBox ${latest} is available`,
      detail: `You have version ${app.getVersion()}. Download the new version and install it over this one; your settings and account stay.`,
    });
    if (response === 0) shell.openExternal(RELEASES_PAGE);
    if (response === 2) writeState({ ...state, skipVersion: latest });
  } catch { /* offline or GitHub unreachable: try again next start */ }
}

function createWindow() {
  const state = readState();
  const win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 960, minHeight: 600,
    show: false, backgroundColor: '#c9d2db', title: 'Gravity SandBox',
    icon: path.join(WEB_ROOT, 'icons', 'icon-512.png'),
    fullscreen: !!state.fullscreen,
    webPreferences: {
      contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false,
      // keep a hosted room's physics and network running while the window is minimized
      backgroundThrottling: false,
    },
  });
  if (state.maximized && !state.fullscreen) win.maximize();
  win.once('ready-to-show', () => win.show());

  const saveState = () => writeState({ ...readState(), fullscreen: win.isFullScreen(), maximized: win.isMaximized() });
  win.on('enter-full-screen', saveState);
  win.on('leave-full-screen', saveState);
  win.on('maximize', saveState);
  win.on('unmaximize', saveState);

  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const fullscreenKey = input.key === 'F11' || (input.key === 'Enter' && input.alt);
    if (fullscreenKey) { event.preventDefault(); win.setFullScreen(!win.isFullScreen()); }
    if (!app.isPackaged && input.key === 'F12') win.webContents.toggleDevTools();
  });
  win.webContents.on('did-finish-load', () => win.webContents.setVisualZoomLevelLimits(1, 1));

  // Links to websites open in the normal browser; the game window never leaves the game.
  win.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith(ORIGIN + '/')) return;
    event.preventDefault();
    openExternal(url);
  });

  win.loadURL(ORIGIN + '/');
  return win;
}

app.whenReady().then(() => {
  if (!firstInstance) return;
  Menu.setApplicationMenu(null);
  protocol.handle('app', serve);
  session.defaultSession.setPermissionRequestHandler((wc, permission, done) => done(ALLOWED_PERMISSIONS.has(permission)));
  session.defaultSession.setPermissionCheckHandler((wc, permission) => ALLOWED_PERMISSIONS.has(permission));

  const win = createWindow();
  if (app.isPackaged) win.webContents.once('did-finish-load', () => setTimeout(() => checkForUpdate(win), 4000));
  app.on('second-instance', () => {
    if (win.isMinimized()) win.restore();
    win.focus();
  });
});

app.on('window-all-closed', () => app.quit());
