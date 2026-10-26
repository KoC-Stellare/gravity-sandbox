import { h, $, clear, toast, modal, confirmDialog, promptDialog } from './dom.js';
import { DEFAULT_MAPS, TEMPLATES, getDefaultMap } from '../maps/defaults.js';
import { account } from '../net/supa.js';
import { social } from '../net/social.js';
import { settings, BINDING_LABELS, DEFAULT_BINDINGS, keyLabel } from '../core/settings.js';
import { PLAYER_COLORS, GAME_NAME, VERSION, MAX_PLAYERS } from '../config.js';
import { powerHelp, controlsHelp, ART, resetTips } from './help.js';


const NAV = [
  ['play', 'Play'], ['howto', 'How to play'], ['build', 'Build Map'], ['multiplayer', 'Multiplayer'], ['friends', 'Friends'], ['settings', 'Settings'], ['account', 'Account'],
];

/** Main menu and all its screens. */
export class Menu {
  constructor(app) {
    this.app = app;
    this.root = $('#menu');
    this.screen = 'play';
    account.on('change', () => this.render());
    social.on('change', () => { if (['friends', 'multiplayer'].includes(this.screen)) this.render(); this.refreshFriendModal?.(); });
  }

  show(screen = this.screen) {
    this.screen = screen;
    this.root.classList.remove('hidden');
    this.render();
  }
  hide() { this.root.classList.add('hidden'); }

  render() {
    if (this.root.classList.contains('hidden')) return;
    const nav = h('nav.menu-nav',
      h('div.logo', h('span.l1', 'GRAVITY'), h('span.l2', 'SANDBOX')),
      NAV.map(([id, label]) => h('button.nav-btn' + (this.screen === id ? '.on' : ''), { onclick: () => this.show(id) }, label,
        id === 'friends' && this.pendingCount ? h('em.badge', this.pendingCount) : null)),
      h('div.nav-foot',
        account.loggedIn ? h('div.me', h('i', { style: { background: account.color } }), account.name) : h('div.me.guest', 'Playing as guest'),
        h('small', `v${VERSION}`)));
    const content = h('section.menu-content');
    clear(this.root).append(h('div.menu-shell', nav, content));
    const fn = this['screen_' + this.screen];
    if (fn) fn.call(this, content);
  }

  // ------------------------------------------------------------- PLAY
  screen_play(el) {
    el.append(h('h2', 'Play'), h('p.lead', 'Pick a map. Everything is a sandbox: bend gravity, walk on walls, throw things with your mind.'));
    let tutDone = false; try { tutDone = localStorage.getItem('gs_tut_done') === '1'; } catch { /* ignore */ }
    el.append(h('div.tut-banner' + (tutDone ? '.done' : ''),
      h('div', h('b', tutDone ? 'Tutorial' : 'New here?'), h('span', tutDone ? 'Replay the guided tour of all 7 powers in The Lab.' : 'Take the guided tutorial: 17 short tasks in The Lab, about 5 minutes.')),
      h('div.card-btns', h('button.btn' + (tutDone ? '' : '.accent'), { onclick: () => this.app.startTutorial() }, tutDone ? 'Replay tutorial' : 'Start tutorial'),
        h('button.btn', { onclick: () => this.show('howto') }, 'How to play'))));
    const grid = h('div.map-grid');
    for (const m of DEFAULT_MAPS) {
      grid.append(h('div.map-card', { style: { '--accent': m.accent } },
        h('div.map-thumb', h('span', m.name.replace('The ', ''))),
        h('h3', m.name), h('p', m.desc),
        h('div.card-btns',
          h('button.btn.primary', { onclick: () => this.app.playSolo(getDefaultMap(m.id)) }, 'Play solo'),
          h('button.btn', { onclick: () => this.app.hostRoom(getDefaultMap(m.id)) }, 'Host room'))));
    }
    el.append(grid);
    if (account.loggedIn) {
      const mine = h('div.map-list', h('p.small', 'Loading…'));
      const shared = h('div.map-list', h('p.small', 'Loading…'));
      el.append(h('h3.sub', 'My maps'), mine, h('h3.sub', 'Shared with me'), shared);
      this.fillMyMaps(mine, 'play');
      account.sharedMaps().then((list) => {
        clear(shared);
        if (!list.length) shared.append(h('p.small', 'Nothing shared with you yet.'));
        for (const m of list) shared.append(this.mapRow(m, [
          ['Play', () => this.loadAndPlay(m.id)], ['Host', () => this.loadAndPlay(m.id, true)],
        ], `by ${m.ownerName || 'a friend'}`));
      }).catch((e) => { clear(shared).append(h('p.small', 'Could not load: ' + e.message)); });
    } else {
      el.append(h('div.note', 'Log in to save your own maps, play with friends and get maps shared with you. ', h('button.link', { onclick: () => this.show('account') }, 'Log in or sign up')));
    }
  }

  mapRow(m, actions, sub = '') {
    return h('div.map-row', h('div.mr-name', h('b', m.name), h('small', `${m.object_count ?? 0} objects · ${new Date(m.updated_at).toLocaleDateString()} ${sub}`)),
      h('div.mr-btns', actions.map(([label, fn, cls]) => h('button.btn.small' + (cls ? '.' + cls : ''), { onclick: fn }, label))));
  }

  async fillMyMaps(el, mode) {
    try {
      const list = await account.myMaps();
      clear(el);
      if (!list.length) el.append(h('p.small', 'No maps yet. Make one in Build Map.'));
      for (const m of list) {
        const acts = mode === 'play'
          ? [['Play', () => this.loadAndPlay(m.id)], ['Host', () => this.loadAndPlay(m.id, true)], ['Share', () => this.shareDialog(m)]]
          : [['Edit', () => this.loadAndEdit(m.id)], ['Rename', () => this.rename(m)], ['Share', () => this.shareDialog(m)], ['Delete', () => this.del(m), 'danger']];
        el.append(this.mapRow(m, acts));
      }
    } catch (e) { clear(el).append(h('p.small', 'Could not load maps: ' + e.message)); }
  }

  async loadAndPlay(id, host = false) {
    try {
      const row = await account.getMap(id);
      host ? this.app.hostRoom(row.data) : this.app.playSolo(row.data);
    } catch (e) { toast('Could not open map: ' + e.message, 'warn'); }
  }
  async loadAndEdit(id) {
    try { const row = await account.getMap(id); this.app.openEditor(row.data, row.id); } catch (e) { toast('Could not open map: ' + e.message, 'warn'); }
  }
  async rename(m) {
    const n = await promptDialog('Rename map', 'Name', m.name);
    if (!n) return;
    try {
      await account.renameMap(m.id, n);
      const row = await account.getMap(m.id);
      row.data.name = n;
      await account.saveMap({ id: m.id, name: n, data: row.data });
      this.render();
    } catch (e) { toast(e.message, 'warn'); }
  }
  async del(m) {
    if (!(await confirmDialog('Delete map', `Delete "${m.name}" permanently?`, 'Delete'))) return;
    try { await account.deleteMap(m.id); toast('Map deleted'); this.render(); } catch (e) { toast(e.message, 'warn'); }
  }

  async shareDialog(m) {
    const linkBox = h('div.share-link');
    const friendsBox = h('div.share-friends', h('p.small', 'Loading friends…'));
    const renderLink = (token) => {
      clear(linkBox);
      const url = token ? `${location.origin}/map/${token}` : '';
      linkBox.append(
        h('label.pp-check', h('input', { type: 'checkbox', checked: !!token, onchange: async (e) => {
          try { renderLink(await account.setLink(m.id, e.target.checked)); } catch (err) { toast(err.message, 'warn'); }
        } }), 'Anyone with the link can play this map'),
        token ? h('div.copy-row', h('input.input', { value: url, readOnly: true }), h('button.btn.small', { onclick: () => { navigator.clipboard?.writeText(url); toast('Link copied'); } }, 'Copy')) : null,
        token ? h('p.small', 'Turning the link off makes the old link stop working.') : null);
    };
    modal(`Share "${m.name}"`, h('div', h('h4', 'Share by link'), linkBox, h('h4', 'Share with friends'), friendsBox));
    try {
      renderLink(await account.getLink(m.id));
      const [fr, shared] = await Promise.all([account.friendships(), account.mapShares(m.id)]);
      const friends = fr.filter((f) => f.status === 'accepted');
      clear(friendsBox);
      if (!friends.length) friendsBox.append(h('p.small', 'Add friends first (Friends screen).'));
      for (const f of friends) {
        friendsBox.append(h('label.pp-check', h('input', { type: 'checkbox', checked: shared.has(f.user.id), onchange: async (e) => {
          try { await account.share(m.id, f.user.id, e.target.checked); toast(e.target.checked ? `Shared with ${f.user.username}` : 'Unshared'); } catch (err) { toast(err.message, 'warn'); e.target.checked = !e.target.checked; }
        } }), h('i.dot', { style: { background: f.user.color } }), f.user.username));
      }
    } catch (e) { toast(e.message, 'warn'); }
  }

  // ------------------------------------------------------------- HOW TO PLAY
  screen_howto(el) {
    el.append(h('h2', 'How to play'),
      h('p.lead', 'You have 7 powers. Pick one with the number keys or the mouse wheel, aim with the crosshair, and use it with the mouse buttons. All of them can be combined.'),
      h('div.card-btns', h('button.btn.accent', { onclick: () => this.app.startTutorial() }, 'Start the guided tutorial')));
    el.append(h('h3.sub', 'The 7 powers'));
    const grid = h('div.howto-grid');
    powerHelp().forEach((p, i) => grid.append(h('article.howto-card',
      h('div.howto-art', { html: ART[p.id] }),
      h('div.howto-text',
        h('div.howto-title', h('kbd', i + 1), h('h4', p.name)),
        h('p', p.what),
        h('p.how', { html: p.how }),
        h('p.tip', p.tip)))));
    el.append(grid);
    el.append(h('h3.sub', 'Controls'), h('div.controls-grid', controlsHelp().map(([key, what]) => h('div.ctrl-row', h('kbd', key), h('span', what)))),
      h('p.small', 'Every key can be changed in Settings → Key bindings.'));
    el.append(h('h3.sub', 'Good to know'), h('ul.howto-list',
      h('li', 'The crosshair turns cyan when a gravity power can affect what you aim at, and coral for telekinesis. The object gets a glowing outline.'),
      h('li', 'The compass at the top right shows two arrows: white is the world gravity, cyan is your own.'),
      h('li', 'Gravity is measured in g: 1 g is Earth, 0.17 g is the Moon, 0 g is floating. Objects have real masses, from foam to steel.'),
      h('li', 'Telekinesis lifts up to 350 kg of weight. Lower an object\'s gravity or mass to lift heavier things.'),
      h('li', 'Hold Backspace for one second to reset all gravity if things get out of hand.'),
      h('li', 'In Build Map, right mouse + drag looks around, B opens the spawn menu and P tests your map.')));
  }

  // ------------------------------------------------------------- BUILD
  screen_build(el) {
    el.append(h('h2', 'Build Map'), h('p.lead', 'Spawn, delete, move, rotate and scale. Test it instantly, then save it to your account.'));
    const draft = (() => { try { return JSON.parse(localStorage.getItem('gs_draft') || 'null'); } catch { return null; } })();
    const grid = h('div.map-grid.small');
    for (const t of TEMPLATES) grid.append(h('div.map-card', { style: { '--accent': '#4fc3d9' } },
      h('div.map-thumb', h('span', t.name)), h('h3', `New: ${t.name}`), h('p', t.desc),
      h('div.card-btns', h('button.btn.primary', { onclick: () => this.app.openEditor(t.build(), null) }, 'Create'))));
    if (draft?.map) grid.append(h('div.map-card', { style: { '--accent': '#f28c28' } },
      h('div.map-thumb', h('span', 'Draft')), h('h3', `Continue: ${draft.map.name}`), h('p', `Unsaved draft from ${new Date(draft.t).toLocaleString()}`),
      h('div.card-btns', h('button.btn.primary', { onclick: () => this.app.openEditor(draft.map, draft.id) }, 'Continue'))));
    el.append(grid);
    if (account.loggedIn) {
      const mine = h('div.map-list', h('p.small', 'Loading…'));
      el.append(h('h3.sub', 'My maps'), mine);
      this.fillMyMaps(mine, 'build');
    } else el.append(h('div.note', 'You can build as a guest (a local draft is kept), but you need an account to save. ', h('button.link', { onclick: () => this.show('account') }, 'Log in')));
  }

  // ------------------------------------------------------------- MULTIPLAYER
  screen_multiplayer(el) {
    el.append(h('h2', 'Multiplayer'), h('p.lead', `Up to ${MAX_PLAYERS} players per room. The host's computer runs the physics, so the host needs a decent PC and connection.`));
    if (!account.loggedIn) { el.append(h('div.note', 'Multiplayer needs an account. ', h('button.link', { onclick: () => this.show('account') }, 'Log in or sign up'))); return; }
    const code = h('input.input.code-input', { placeholder: 'ROOM CODE', maxLength: 6, onkeydown: (e) => { if (e.key === 'Enter') go(); } });
    const go = () => { const c = code.value.trim().toUpperCase(); if (c.length === 6) this.app.joinRoom(c); else toast('Room codes have 6 characters'); };
    el.append(
      h('div.mp-row',
        h('div.mp-card', h('h3', 'Join a room'), h('p', 'Type the code your friend gave you, or open their invite link.'), h('div.copy-row', code, h('button.btn.primary', { onclick: go }, 'Join'))),
        h('div.mp-card', h('h3', 'Host a room'), h('p', 'Pick any map in Play and press "Host room" (or "Host" on your maps). Share the code or invite friends.'),
          h('button.btn', { onclick: () => this.show('play') }, 'Choose a map'))));
    const inRooms = [...social.online.entries()].filter(([id, o]) => o.room && id !== account.id);
    el.append(h('h3.sub', 'Friends playing now'));
    this.friendCache().then((fr) => {
      const ids = new Set(fr.filter((f) => f.status === 'accepted').map((f) => f.user.id));
      const list = inRooms.filter(([id]) => ids.has(id));
      const box = h('div.map-list');
      if (!list.length) box.append(h('p.small', 'No friends in a room right now.'));
      for (const [, o] of list) box.append(h('div.map-row', h('div.mr-name', h('b', o.name), h('small', `Room ${o.room}`)), h('div.mr-btns', h('button.btn.small.primary', { onclick: () => this.app.joinRoom(o.room) }, 'Join'))));
      el.append(box);
    });
  }

  async friendCache() { try { this._fr = await account.friendships(); } catch { this._fr = this._fr || []; } this.pendingCount = this._fr.filter((f) => f.status === 'pending' && !f.outgoing).length; return this._fr; }

  // ------------------------------------------------------------- FRIENDS
  screen_friends(el) {
    el.append(h('h2', 'Friends'));
    if (!account.loggedIn) { el.append(h('div.note', 'Friends need an account. ', h('button.link', { onclick: () => this.show('account') }, 'Log in or sign up'))); return; }
    const box = h('div');
    el.append(box);
    this.renderFriends(box);
  }

  async renderFriends(box) {
    const input = h('input.input', { placeholder: 'Friend\'s username', maxLength: 20 });
    const add = async () => {
      try { const p = await account.friendRequest(input.value); toast(`Request sent to ${p.username}`); input.value = ''; this.renderFriends(box); } catch (e) { toast(e.message, 'warn'); }
    };
    input.addEventListener('keydown', (e) => e.key === 'Enter' && add());
    clear(box).append(h('div.copy-row', input, h('button.btn.primary', { onclick: add }, 'Add friend')), h('p.small', 'Loading…'));
    const fr = await this.friendCache();
    box.lastChild.remove();
    const incoming = fr.filter((f) => f.status === 'pending' && !f.outgoing);
    const outgoing = fr.filter((f) => f.status === 'pending' && f.outgoing);
    const friends = fr.filter((f) => f.status === 'accepted');
    const game = this.app.game;
    const hosting = game.net && game.role === 'host';
    const act = (fn) => async () => { try { await fn(); this.renderFriends(box); } catch (e) { toast(e.message, 'warn'); } };
    if (incoming.length) {
      box.append(h('h3.sub', 'Requests'));
      for (const f of incoming) box.append(h('div.map-row', h('div.mr-name', h('i.dot', { style: { background: f.user.color } }), h('b', f.user.username)),
        h('div.mr-btns', h('button.btn.small.primary', { onclick: act(() => account.acceptFriend(f.id)) }, 'Accept'), h('button.btn.small', { onclick: act(() => account.removeFriend(f.id)) }, 'Decline'))));
    }
    box.append(h('h3.sub', `Friends (${friends.length})`));
    if (!friends.length) box.append(h('p.small', 'No friends yet — add someone by username.'));
    for (const f of friends) {
      const on = social.online.get(f.user.id);
      box.append(h('div.map-row', h('div.mr-name', h('i.dot' + (on ? '.online' : ''), { style: { background: f.user.color } }), h('b', f.user.username),
        h('small', on ? (on.room ? `online · in room ${on.room}` : 'online') : 'offline')),
      h('div.mr-btns',
        on?.room && on.room !== game.net?.code ? h('button.btn.small.primary', { onclick: () => { this.closeFriendModal?.(); this.app.joinRoom(on.room); } }, 'Join') : null,
        hosting && on ? h('button.btn.small.accent', { onclick: () => { social.invite(f.user.id, game.net.code); toast(`Invite sent to ${f.user.username}`); } }, 'Invite') : null,
        h('button.btn.small', { onclick: act(async () => { if (await confirmDialog('Remove friend', `Remove ${f.user.username}?`, 'Remove')) await account.removeFriend(f.id); }) }, 'Remove'))));
    }
    if (outgoing.length) {
      box.append(h('h3.sub', 'Sent requests'));
      for (const f of outgoing) box.append(h('div.map-row', h('div.mr-name', h('b', f.user.username), h('small', 'pending')),
        h('div.mr-btns', h('button.btn.small', { onclick: act(() => account.removeFriend(f.id)) }, 'Cancel'))));
    }
  }

  friendsModal() {
    if (!account.loggedIn) return toast('Log in to use friends', 'warn');
    const box = h('div.friends-modal');
    const m = modal('Friends', box);
    this.closeFriendModal = () => m.close();
    this.refreshFriendModal = () => { if (document.body.contains(box)) this.renderFriends(box); };
    this.renderFriends(box);
  }

  // ------------------------------------------------------------- SETTINGS
  screen_settings(el) { el.append(h('h2', 'Settings')); this.renderSettings(el); }

  renderSettings(el) {
    const row = (label, input, out) => h('label.pp-row', h('span', label), input, out || '');
    const sens = h('b', settings.get('sensitivity').toFixed(2));
    const fov = h('b', settings.get('fov') + '°');
    el.append(
      h('div.settings-grid',
        h('div.set-card', h('h4', 'Controls'),
          row('Mouse sensitivity', h('input', { type: 'range', min: 0.1, max: 3, step: 0.05, value: settings.get('sensitivity'), oninput: (e) => { settings.set('sensitivity', +e.target.value); sens.textContent = (+e.target.value).toFixed(2); } }), sens),
          h('label.pp-check', h('input', { type: 'checkbox', checked: settings.get('invertY'), onchange: (e) => settings.set('invertY', e.target.checked) }), 'Invert mouse Y')),
        h('div.set-card', h('h4', 'Graphics'),
          row('Quality', h('select', { onchange: (e) => { settings.set('quality', e.target.value); this.app.renderer.setQuality(e.target.value); } },
            ['low', 'medium', 'high'].map((q) => h('option', { value: q, selected: settings.get('quality') === q }, q[0].toUpperCase() + q.slice(1))))),
          row('Field of view', h('input', { type: 'range', min: 60, max: 110, step: 1, value: settings.get('fov'), oninput: (e) => { settings.set('fov', +e.target.value); fov.textContent = e.target.value + '°'; this.app.renderer.setFov(+e.target.value); } }), fov),
          h('label.pp-check', h('input', { type: 'checkbox', checked: settings.get('showFps'), onchange: (e) => settings.set('showFps', e.target.checked) }), 'Show FPS')),
        h('div.set-card', h('h4', 'Help'),
          h('label.pp-check', h('input', { type: 'checkbox', checked: settings.get('showTips'), onchange: (e) => settings.set('showTips', e.target.checked) }), 'Show first-time tips'),
          h('div.row-btns', h('button.btn.small', { onclick: () => { resetTips(); toast('Tips will show again'); } }, 'Show all tips again'),
            h('button.btn.small', { onclick: () => this.app.startTutorial() }, 'Start tutorial')))),
      h('div.set-card', h('h4', 'Key bindings'), h('p.small', 'Click a key, then press the new key. Esc cancels.'),
        h('div.bindings', Object.keys(DEFAULT_BINDINGS).map((a) => {
          const b = h('button.key-btn', { onclick: () => {
            b.textContent = 'press a key…'; b.classList.add('wait');
            this.app.input.captureNext = (code) => {
              if (code !== 'Escape') settings.bind(a, code);
              b.textContent = keyLabel(settings.get('bindings')[a]); b.classList.remove('wait');
            };
          } }, keyLabel(settings.get('bindings')[a]));
          return h('div.bind-row', h('span', BINDING_LABELS[a] || a), b);
        })),
        h('button.btn.small', { onclick: () => { settings.resetBindings(); clear(el); el.append(h('h2', 'Settings')); this.renderSettings(el); } }, 'Reset to defaults')),
      h('div.set-card', h('h4', 'Mouse buttons'), h('p.small', 'Left click: use power · Right click: undo / alternate · Wheel: switch power (or move held object)')),
    );
  }

  settingsModal() { const box = h('div'); modal('Settings', box); this.renderSettings(box); }

  // ------------------------------------------------------------- ACCOUNT
  screen_account(el) {
    el.append(h('h2', 'Account'));
    if (!account.loggedIn) { el.append(this.authForm()); return; }
    const p = account.profile || {};
    const name = h('input.input', { value: p.username || '', maxLength: 20 });
    let color = p.color || PLAYER_COLORS[0];
    const preview = h('i.big-dot', { style: { background: color } });
    const sw = h('div.swatches', PLAYER_COLORS.map((c) => h('button.swatch', { style: { background: c }, onclick: () => { color = c; preview.style.background = c; } })),
      h('input', { type: 'color', value: color, oninput: (e) => { color = e.target.value; preview.style.background = color; } }));
    el.append(h('div.set-card.narrow',
      h('div.acc-head', preview, h('div', h('b', account.name), h('small', account.user.email))),
      h('label.field', h('span', 'Username'), name),
      h('label.field', h('span', 'Mannequin color'), sw),
      h('div.row-btns',
        h('button.btn.primary', { onclick: async () => { try { await account.updateProfile({ username: name.value.trim(), color }); toast('Profile saved'); } catch (e) { toast(e.message, 'warn'); } } }, 'Save'),
        h('button.btn', { onclick: async () => { await account.signOut(); toast('Logged out'); } }, 'Log out'))));
  }

  authForm() {
    let mode = 'login';
    const wrap = h('div.set-card.narrow');
    const draw = () => {
      const email = h('input.input', { type: 'email', placeholder: 'email@example.com', autocomplete: 'email' });
      const pass = h('input.input', { type: 'password', placeholder: mode === 'signup' ? 'at least 6 characters' : 'password', autocomplete: mode === 'signup' ? 'new-password' : 'current-password' });
      const user = h('input.input', { placeholder: 'username (3–20, letters/numbers/_)', maxLength: 20 });
      let color = PLAYER_COLORS[Math.floor(Math.random() * PLAYER_COLORS.length)];
      const err = h('p.err');
      const submit = async () => {
        err.textContent = '';
        try {
          if (mode === 'login') { await account.signIn(email.value.trim(), pass.value); toast(`Welcome back, ${account.name}`); this.app.afterLogin(); }
          else {
            const r = await account.signUp(email.value.trim(), pass.value, user.value.trim(), color);
            if (r.needsConfirm) { err.textContent = 'Check your email to confirm your account, then log in.'; err.classList.add('ok'); }
            else { toast(`Welcome, ${account.name}!`); this.app.afterLogin(); }
          }
        } catch (e) { err.textContent = e.message; }
      };
      [email, pass, user].forEach((i) => i.addEventListener('keydown', (e) => e.key === 'Enter' && submit()));
      clear(wrap).append(
        h('div.tabs', h('button' + (mode === 'login' ? '.on' : ''), { onclick: () => { mode = 'login'; draw(); } }, 'Log in'),
          h('button' + (mode === 'signup' ? '.on' : ''), { onclick: () => { mode = 'signup'; draw(); } }, 'Sign up')),
        h('label.field', h('span', 'Email'), email),
        h('label.field', h('span', 'Password'), pass),
        mode === 'signup' ? h('label.field', h('span', 'Username'), user) : null,
        mode === 'signup' ? h('label.field', h('span', 'Mannequin color'), h('div.swatches', PLAYER_COLORS.map((c) => h('button.swatch', { style: { background: c }, onclick: (e) => { color = c; wrap.querySelectorAll('.swatch').forEach((s) => s.classList.remove('on')); e.target.classList.add('on'); } })))) : null,
        err,
        h('div.row-btns', h('button.btn.primary', { onclick: submit }, mode === 'login' ? 'Log in' : 'Create account'),
          mode === 'login' ? h('button.link', { onclick: async () => { if (!email.value) { err.textContent = 'Type your email first'; return; } try { await account.resetPassword(email.value.trim()); err.textContent = 'Password reset email sent'; } catch (e) { err.textContent = e.message; } } }, 'Forgot password?') : null),
        h('p.small', 'Your account stores your username, mannequin color, settings, friends and maps.'));
    };
    draw();
    return wrap;
  }
}

export function showInvite(app, payload) {
  const el = h('div.invite',
    h('div', h('b', String(payload.from || 'A friend')), ' invited you to room ', h('code', payload.code)),
    h('div.row-btns',
      h('button.btn.small.primary', { onclick: () => { el.remove(); app.joinRoom(payload.code); } }, 'Join'),
      h('button.btn.small', { onclick: () => el.remove() }, 'Dismiss')));
  $('#invites').append(el);
  setTimeout(() => el.remove(), 30000);
}
