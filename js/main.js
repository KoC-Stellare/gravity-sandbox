import RAPIER from 'rapier';
import { Renderer } from './render/renderer.js';
import { Input } from './core/input.js';
import { settings } from './core/settings.js';
import { Game } from './game.js';
import { Editor } from './editor/editor.js';
import { Menu, showInvite } from './ui/menu.js';
import { $, toast } from './ui/dom.js';
import { account } from './net/supa.js';
import { social } from './net/social.js';
import { Room } from './net/room.js';
import { sanitizeMap, getDefaultMap } from './maps/defaults.js';

function setLoading(text) {
  const el = $('#loading');
  el.classList.toggle('show', !!text);
  if (text) $('#loading-text').textContent = text;
}

class App {
  async init() {
    setLoading('Loading physics engine…');
    await RAPIER.init();
    this.R = RAPIER;
    this.renderer = new Renderer($('#c'));
    this.renderer.setQuality(settings.get('quality'));
    this.input = new Input($('#c'));
    this.game = new Game(RAPIER, this.renderer, this.input);
    this.editor = new Editor(this.renderer, this.input, this.game);
    this.menu = new Menu(this);

    this.input.onLockChange = (locked) => this.game.onPointerLock(locked);
    $('#c').addEventListener('click', () => {
      const g = this.game;
      if (g.mode === 'play' && !g.panel.open && !g.chat.typing) g.resume();
    });
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Escape') return;
      if (this.game.panel.open) { this.game.closePanel(); return; }
      if (this.game.paused && this.game.mode === 'play') this.game.resume();
    });
    this.wirePause();

    this.game.on('left', (reason) => {
      if (this.testing) { this.testing = false; this.game.testing = false; this.reopenEditor(); return; }
      if (reason && reason !== 'left') toast(reason, 'warn');
      this.backToMenu();
    });
    this.editor.on('test', (map) => {
      this.editorState = { map, id: this.editor.mapId, cam: { ...this.editor.cam, pos: this.editor.cam.pos.clone() }, dirty: this.editor.dirty };
      this.editor.close();
      this.testing = true;
      this.game.testing = true;
      this.game.start(map, 'solo');
      toast('Testing — press P (or Esc → Back to editor) to return');
    });
    this.editor.on('exit', () => this.backToMenu());
    this.editor.on('need-login', () => {});

    settings.on('saved', (data) => {
      if (!account.loggedIn) return;
      clearTimeout(this._setT);
      this._setT = setTimeout(() => account.updateProfile({ settings: data }).catch(() => {}), 1500);
    });
    social.on('invite', (p) => showInvite(this, p));
    account.on('change', () => this.afterLogin(true));

    setLoading('Connecting…');
    await account.init();
    if (account.loggedIn) this.afterLogin(true);
    setLoading('');
    await this.game.showcase();
    this.menu.show('play');
    this.route();
    this.loop();
    window.addEventListener('beforeunload', () => this.game.net?.close('left'));
  }

  afterLogin(silent = false) {
    if (account.loggedIn) {
      if (account.profile?.settings && Object.keys(account.profile.settings).length && !this._mergedSettings) {
        this._mergedSettings = true;
        settings.merge(account.profile.settings);
        this.renderer.setQuality(settings.get('quality'));
      }
      social.start();
      this.menu.friendCache().then(() => this.menu.render());
      if (this.pendingJoin) { const c = this.pendingJoin; this.pendingJoin = null; this.joinRoom(c); }
    } else {
      this._mergedSettings = false;
      social.stop();
    }
    if (!silent) this.menu.show('play');
  }

  wirePause() {
    $('#pause-resume').onclick = () => this.game.resume();
    $('#pause-powers').onclick = () => { this.game.showPause(false); this.game.openPanel(); };
    $('#pause-settings').onclick = () => this.menu.settingsModal();
    $('#pause-friends').onclick = () => this.menu.friendsModal();
    $('#pause-invite').onclick = () => {
      const url = `${location.origin}/join/${this.game.net.code}`;
      navigator.clipboard?.writeText(url);
      toast('Invite link copied: ' + url);
    };
    $('#pause-leave').onclick = () => this.game.leave();
    $('#pause-editor').onclick = () => this.game.leave();
    $('#pause-skip').onclick = () => { this.game.tutorial?.skip(); this.game.resume(); };
    $('#pause-exit-tut').onclick = () => { this.game.tutorial?.destroy(); this.game.resume(); };
  }

  route() {
    const m = location.pathname.match(/^\/(join|map)\/([A-Za-z0-9]+)/);
    if (!m) return;
    history.replaceState(null, '', '/');
    if (m[1] === 'join') {
      if (!account.loggedIn) { this.pendingJoin = m[2].toUpperCase(); this.menu.show('account'); toast('Log in or sign up to join the room'); return; }
      this.joinRoom(m[2]);
    } else this.openSharedLink(m[2]);
  }

  async openSharedLink(token) {
    try {
      setLoading('Opening shared map…');
      const row = await account.mapByToken(token);
      setLoading('');
      if (!row) { toast('This map link is not valid anymore', 'warn'); return; }
      const { modal } = await import('./ui/dom.js');
      modal(`${row.name}`, `Shared by ${row.owner_name}`, [
        { label: 'Play solo', primary: true, onClick: (c) => { c(); this.playSolo(row.data); } },
        { label: 'Host room', onClick: (c) => { c(); this.hostRoom(row.data); } },
        ...(account.loggedIn ? [{ label: 'Copy to My Maps', onClick: async (c) => { c(); try { await account.saveMap({ name: row.name.slice(0, 34) + ' copy', data: row.data }); toast('Copied to your maps'); } catch (e) { toast(e.message, 'warn'); } } }] : []),
      ]);
    } catch (e) { setLoading(''); toast('Could not open link: ' + e.message, 'warn'); }
  }

  // ------------------------------------------------------------ navigation
  playSolo(map) {
    try {
      this.menu.hide();
      this.game.start(sanitizeMap(map), 'solo');
    } catch (e) { console.error(e); toast('Could not start: ' + e.message, 'warn'); this.backToMenu(); }
  }

  startTutorial() {
    try {
      document.querySelectorAll('.modal-wrap').forEach((m) => m.remove());
      if (this.editor.active) this.editor.close();
      this.menu.hide();
      this.game.start(getDefaultMap('lab'), 'solo');
      this.game.startTutorial();
    } catch (e) { console.error(e); toast('Could not start: ' + e.message, 'warn'); this.backToMenu(); }
  }

  async hostRoom(map) {
    if (!account.loggedIn) { toast('Log in to host a room', 'warn'); this.menu.show('account'); return; }
    setLoading('Creating room…');
    try {
      const room = await Room.create({ name: account.name, color: account.color, userId: account.id });
      setLoading('');
      this.menu.hide();
      this.game.start(sanitizeMap(map), 'host', room);
      toast(`Room ${room.code} is open — share the code or invite friends (Esc menu)`);
    } catch (e) { setLoading(''); toast(e.message, 'warn'); }
  }

  async joinRoom(code) {
    if (!account.loggedIn) { this.pendingJoin = code; toast('Log in to join', 'warn'); this.menu.show('account'); return; }
    if (this.game.net?.code === code.toUpperCase()) return;
    if (this.game.mode === 'play') this.game.leave();
    this.editor.active && this.editor.close();
    setLoading(`Joining room ${code.toUpperCase()}…`);
    let room;
    try {
      room = await Room.join(code, { name: account.name, color: account.color, userId: account.id });
      const welcome = await new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error('The host did not answer')), 15000);
        const off = room.on('message', (peer, msg) => { if (msg?.t === 'welcome') { clearTimeout(t); off(); res(msg); } });
        room.on('closed', (r) => { clearTimeout(t); rej(new Error(r)); });
      });
      setLoading('');
      this.menu.hide();
      this.game.startClient(room, welcome);
      social.setRoom(room.code);
      toast(`Joined room ${room.code}`);
    } catch (e) {
      setLoading('');
      room?.close('failed');
      toast(e.message, 'warn');
      this.backToMenu();
    }
  }

  openEditor(map, id) {
    if (this.game.mode === 'play') { this.game.input.unlock(); this.game.teardown(); }
    this.game.teardown();
    this.menu.hide();
    this.editor.open(map, { id });
  }

  reopenEditor() {
    const s = this.editorState;
    this.game.teardown();
    this.editor.open(s.map, { id: s.id });
    this.editor.cam = s.cam;
    this.editor.dirty = s.dirty;
    this.editor.renderCounts();
  }

  backToMenu() {
    if (this.editor.active) this.editor.close();
    this.game.teardown();
    this.game.showcase();
    this.menu.show();
  }

  loop() {
    let last = performance.now();
    const step = (now, draw) => {
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
      last = now;
      try {
        if (this.editor.active) this.editor.update(dt);
        else {
          if (this.testing && this.game.mode === 'play' && this.input.locked && this.input.hit('testMap')) this.game.leave();
          this.game.update(dt);
        }
        if (draw) this.renderer.render(dt);
      } catch (e) { console.error(e); }
      this.input.endFrame();
    };
    const frame = (now) => { step(now, true); requestAnimationFrame(frame); };
    requestAnimationFrame(frame);
    // Browsers pause animation frames in hidden tabs. A worker timer keeps a hosted room's
    // physics and network running when the host switches tab or minimizes the window.
    try {
      const src = 'let t=null;onmessage=(e)=>{clearInterval(t);if(e.data)t=setInterval(()=>postMessage(0),1000/60)}';
      const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      w.onmessage = () => { if (document.hidden && this.game.mode === 'play' && this.game.role === 'host') step(performance.now(), false); };
      document.addEventListener('visibilitychange', () => w.postMessage(document.hidden));
    } catch { /* no workers: hosting pauses while hidden */ }
  }
}

const app = new App();
window.__gs = app;
app.init().catch((e) => {
  console.error(e);
  setLoading('');
  document.body.insertAdjacentHTML('beforeend', `<div class="fatal"><h2>Gravity SandBox could not start</h2><p>${String(e.message || e)}</p><p>Use a recent Chrome, Edge or Firefox on a desktop computer with WebGL 2.</p></div>`);
});

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
