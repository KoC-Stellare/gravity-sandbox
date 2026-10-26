import * as THREE from 'three';
import { Sim, GravityField } from './physics/sim.js';
import { PhysicsWorld } from './physics/world.js';
import { PlayerController } from './player/controller.js';
import { MannequinVisual, HEAD, TORSO } from './player/mannequin.js';
import { Powers } from './powers/powers.js';
import { GravityVisuals } from './powers/visuals.js';
import { Hud } from './ui/hud.js';
import { PowerPanel } from './ui/powerpanel.js';
import { Chat } from './ui/chat.js';
import { settings } from './core/settings.js';
import { toV3, Emitter, clamp } from './util.js';
import { G_EARTH, NET_HZ, INTERP_DELAY, TK_LIMIT_KG, PLAYER } from './config.js';
import { getDefaultMap, sanitizeMap } from './maps/defaults.js';
import { account } from './net/supa.js';
import { social } from './net/social.js';
import { $ } from './ui/dom.js';
import { Tutorial } from './ui/tutorial.js';
import { tipFor, tipSeen, markTip } from './ui/help.js';

const SNAP_DT = 1 / NET_HZ;

/**
 * The play session: singleplayer, multiplayer host (authoritative) or multiplayer client (mirror).
 */
export class Game extends Emitter {
  constructor(R, renderer, input) {
    super();
    this.R = R;
    this.renderer = renderer;
    this.input = input;
    this.mode = 'none';           // 'menu' | 'play' | 'none'
    this.role = null;             // 'solo' | 'host' | 'client'
    this.hud = new Hud($('#hud'));
    this.hud.show(false);
    this.panel = new PowerPanel($('#power-panel'), this);
    this.chat = new Chat($('#chat'), this);
    this.visuals = new GravityVisuals(renderer.scene);
    this.remote = new Map();      // slot -> { visual, name, color, pose... }
    this.slot = 0;
    this.net = null;
    this.paused = false;
    this.ragdollRest = 0;
    this.showcaseT = 0;
    this.tutorial = null;
  }

  get isHostOrSolo() { return this.role !== 'client'; }
  get pw() { return this.sim ? this.sim.pw : this.mirror; }
  get field() { return this.sim ? this.sim.field : this.mirrorField; }

  // ------------------------------------------------------------ lifecycle
  async showcase() {
    this.teardown();
    this.mode = 'menu';
    const map = getDefaultMap('lab');
    this.sim = new Sim(this.R, this.renderer.scene, map);
    this.renderer.setEnvironment({ outdoor: false, bounds: map.bounds });
    this.showcaseT = 0;
  }

  /** Start playing a map. role: 'solo' | 'host' */
  start(map, role = 'solo', room = null) {
    this.teardown();
    map = sanitizeMap(map);
    this.map = map;
    this.role = role;
    this.mode = 'play';
    this.slot = 0;
    this.sim = new Sim(this.R, this.renderer.scene, map);
    this.sim.on('ragdoll', (slot) => this.onRagdoll(slot));
    this.sim.on('recover', (slot, res) => this.onRecover(slot, res));
    this.renderer.setEnvironment({ outdoor: map.env === 'outdoor', bounds: map.bounds });
    this.createPlayer(this.sim.pw, this.sim.field);
    this.sim.addPlayerProxy(0, { collider: this.player.collider, name: account.name, color: account.color, local: true,
      getFeet: () => this.player.getFeet(), getQuat: () => this.player.getQuat() });
    if (room) this.attachHost(room);
    this.enterPlay();
  }

  /** Multiplayer client: build a mirror world from the host's welcome message. */
  startClient(room, welcome) {
    this.teardown(true);
    const map = sanitizeMap(welcome.map);
    this.map = map;
    this.role = 'client';
    this.mode = 'play';
    this.slot = welcome.slot;
    this.net = room;
    this.mirror = new PhysicsWorld(this.R, this.renderer.scene, { mirror: true });
    this.mirror.buildStatic(map);
    this.mirrorField = new GravityField();
    this.meta = { holds: {}, ragdolls: {}, links: [], objects: [] };
    this.samples = new Map();
    this.timeOffset = null;
    this.renderer.setEnvironment({ outdoor: map.env === 'outdoor', bounds: map.bounds });
    this.createPlayer(this.mirror, this.mirrorField);
    this.applyMeta(welcome.meta);
    this.setPlayers(welcome.players);
    this.chat.reset(welcome.chat || []);
    room.on('message', (peer, msg) => { if (this.net === room && this.mirror) this.onClientMessage(msg); });
    room.on('closed', (reason) => this.netClosed(reason));
    this.poseTimer = 0;
    this.enterPlay();
  }

  createPlayer(pw, field) {
    this.player = new PlayerController(this.R, pw, field);
    const sp = this.map.spawns[this.slot % this.map.spawns.length] || [0, 1, 0];
    this.player.teleport(new THREE.Vector3(sp[0], sp[1] + 0.05, sp[2]));
    this.powers = new Powers(this);
    this.ownBody = new MannequinVisual(account.color);
    this.ownBody.setLayer(1);
    this.renderer.scene.add(this.ownBody.group);
  }

  enterPlay() {
    this.hud.show(true);
    this.renderer.setFov(settings.get('fov'));
    $('#menu').classList.add('hidden');
    this.chat.show(!!this.net);
    this.paused = false;
    this.input.lock();
    this.showPause(false);
    if (!this.input.locked) this.showPause(true);
    if (!this.tutorial) this.maybeTip('start');
  }

  startTutorial() {
    this.tutorial?.destroy();
    this.tutorial = new Tutorial(this);
    this.hud.hideTip();
  }

  /** First-time tip for the game start or a power (once each, can be turned off in Settings). */
  maybeTip(id) {
    if (this.tutorial || !settings.get('showTips') || tipSeen(id)) return;
    const t = tipFor(id);
    if (!t) return;
    markTip(id);
    this.hud.showTip(t, id === 'start' ? 14 : 10);
  }

  teardown(keepNet = false) {
    this.panel.toggle(false);
    this.showPause(false);
    this.tutorial?.destroy(); this.tutorial = null;
    this.hud.hideTip();
    this.visuals.clear();
    for (const r of this.remote.values()) r.visual.dispose();
    this.remote.clear();
    if (this.player) { this.player.dispose?.(); this.player = null; }
    this.ownBody?.dispose(); this.ownBody = null;
    if (this.sim) { this.sim.dispose(); this.sim = null; }
    if (this.mirror) { this.mirror.dispose(); this.mirror = null; }
    if (!keepNet && this.net) { if (this.role === 'host') this.net.broadcast({ t: 'closing' }); const n = this.net; this.net = null; setTimeout(() => n.close('left'), 150); social.setRoom(null); }
    this.powers = null;
    this.role = null;
    this.mode = 'none';
    this.hud.show(false);
    this.chat.show(false);
  }

  leave() {
    this.input.unlock();
    this.teardown();
    this.emit('left');
  }

  // ------------------------------------------------------------ commands
  send(cmd) {
    this.emit('cmd', cmd);
    if (this.role === 'client') this.net.toHost({ t: 'cmd', cmd });
    else if (this.sim) this.sim.command(this.slot, cmd);
  }
  holdOf(slot) {
    if (this.sim) return this.sim.holds.get(slot)?.objId ?? null;
    return this.meta?.holds?.[slot] ?? null;
  }
  links() { return this.sim ? this.sim.links : (this.meta?.links || []); }
  tooHeavy() {
    if (this.sim) return !!this.sim.tooHeavy.get(this.slot);
    const id = this.holdOf(this.slot);
    const o = id != null && this.pw.objects.get(id);
    if (!o) return false;
    const m = this.meta.objects.find((x) => x.id === id)?.mass || 0;
    return m * this.field.at(this.pw.objPos(o, new THREE.Vector3()), new THREE.Vector3(), o.grav).length() > TK_LIMIT_KG * G_EARTH;
  }
  ownColliders() {
    const s = new Set([this.player.collider.handle]);
    const rid = this.ragdollId();
    const o = rid != null && this.pw.objects.get(rid);
    if (o) o.colliders.forEach((c) => s.add(c.handle));
    return s;
  }
  ragdollId() {
    if (this.sim) return this.sim.players.get(this.slot)?.ragdollId ?? null;
    return this.meta?.ragdolls?.[this.slot] ?? null;
  }
  playerName(slot) {
    if (slot === this.slot) return account.name;
    return this.remote.get(slot)?.name || 'Player';
  }
  playerList() {
    const list = [{ slot: this.slot, name: account.name, color: account.color, host: this.role === 'host', me: true }];
    for (const [slot, r] of this.remote) list.push({ slot, name: r.name, color: r.color, host: slot === 0 });
    return list.sort((a, b) => a.slot - b.slot);
  }

  // ------------------------------------------------------------ ragdoll
  onRagdoll(slot) {
    if (slot === this.slot && this.role !== 'client') this.setLocalRagdoll(true);
  }
  onRecover(slot, res) {
    if (slot === this.slot && this.role !== 'client') { this.setLocalRagdoll(false, res); return; }
    if (this.role === 'host') {
      const peer = [...this.net.peers.values()].find((p) => p.slot === slot);
      if (peer && res) this.net.sendTo(peer, { t: 'recovered', feet: res.feet.toArray(), up: res.up.toArray() });
    }
  }
  setLocalRagdoll(on, res) {
    const p = this.player;
    if (on && !p.ragdolled) {
      p.ragdolled = true;
      p.collider.setEnabled(false);
      this.ragdollRest = 0;
      this.ragdollTime = 0;
      if (this.powers.hold) this.powers.release();
      this.hud.setCenter(`You're limp — press <kbd>G</kbd> to stand up`);
    } else if (!on && p.ragdolled) {
      p.ragdolled = false;
      p.collider.setEnabled(true);
      if (res) p.teleport(res.feet, res.up);
      this.hud.setCenter('');
    }
  }

  // ------------------------------------------------------------ multiplayer: host
  attachHost(room) {
    this.net = room;
    this.snapTimer = 0;
    this.chatLog = [];
    room.on('peer-join', (peer) => {
      if (this.net !== room || !this.sim) return;
      this.sim.addRemotePlayer(peer.slot, { name: peer.name, color: peer.color });
      this.addRemote(peer.slot, peer.name, peer.color);
      this.net.sendTo(peer, { t: 'welcome', slot: peer.slot, map: this.map, meta: this.sim.getMeta(), players: this.playersMsg(), chat: this.chatLog.slice(-20) });
      this.sendFullSnapshot(peer);
      this.net.broadcast({ t: 'players', list: this.playersMsg() }, true, peer);
      this.systemChat(`${peer.name} joined`);
    });
    room.on('peer-leave', (peer) => {
      if (this.net !== room || !this.sim) return;
      this.sim.removePlayerProxy(peer.slot);
      this.removeRemote(peer.slot);
      this.net.broadcast({ t: 'players', list: this.playersMsg() });
      this.systemChat(`${peer.name} left`);
    });
    room.on('message', (peer, msg) => { if (this.net === room && this.sim) this.onHostMessage(peer, msg); });
    room.on('closed', (reason) => this.netClosed(reason));
    social.setRoom(room.code);
    this.chat.reset([]);
  }

  playersMsg() {
    const list = [{ slot: 0, name: account.name, color: account.color }];
    for (const p of this.net.peers.values()) if (p.open) list.push({ slot: p.slot, name: p.name, color: p.color });
    return list;
  }

  onHostMessage(peer, msg) {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case 'pose': {
        const r = this.remote.get(peer.slot);
        if (!r) return;
        r.target = msg;
        if (Array.isArray(msg.p) && Array.isArray(msg.q)) this.sim.setRemotePose(peer.slot, toV3(msg.p), new THREE.Quaternion(...msg.q), toV3(msg.v || [0, 0, 0]));
        break;
      }
      case 'cmd':
        if (msg.cmd && typeof msg.cmd.c === 'string') this.sim.command(peer.slot, msg.cmd);
        break;
      case 'chat': {
        const text = String(msg.text || '').slice(0, 200);
        if (!text.trim()) return;
        const m = { name: peer.name, color: peer.color, text };
        this.chatLog.push(m);
        this.chat.add(m);
        this.net.broadcast({ t: 'chat', ...m });
        break;
      }
    }
  }

  systemChat(text) {
    const m = { system: true, text };
    this.chatLog?.push(m);
    this.chat.add(m);
    if (this.role === 'host') this.net.broadcast({ t: 'chat', ...m });
  }

  sendChat(text) {
    text = text.trim().slice(0, 200);
    if (!text || !this.net) return;
    if (this.role === 'client') { this.net.toHost({ t: 'chat', text }); return; }
    const m = { name: account.name, color: account.color, text };
    this.chatLog.push(m);
    this.chat.add(m);
    this.net.broadcast({ t: 'chat', ...m });
  }

  sendFullSnapshot(peer) {
    const arr = this.sim.snapshotBodies(true);
    const f = new Float32Array(2 + arr.length);
    f[0] = 1; f[1] = this.sim.time; f.set(arr, 2);
    this.net.sendTo(peer, f.buffer, true);
  }

  hostNetTick(dt) {
    if (this.sim.metaDirty) {
      this.sim.metaDirty = false;
      this.net.broadcast({ t: 'meta', meta: this.sim.getMeta() });
    }
    this.snapTimer += dt;
    if (this.snapTimer < SNAP_DT) return;
    this.snapTimer %= SNAP_DT;
    if (!this.net.peers.size) return;
    const arr = this.sim.snapshotBodies(false);
    const f = new Float32Array(2 + arr.length);
    f[0] = 1; f[1] = this.sim.time; f.set(arr, 2);
    this.net.broadcast(f.buffer, false);
    // poses of all players + bubble positions
    const l = [this.localPose(0)];
    for (const [slot, r] of this.remote) if (r.target) l.push({ ...r.target, s: slot });
    this.net.broadcast({ t: 'poses', l, b: this.sim.field.bubbles.map((b) => [b.id, b.pos.x, b.pos.y, b.pos.z]), ht: this.sim.time }, false);
  }

  localPose(slot) {
    const p = this.player;
    const f = p.getFeet(), q = p.getQuat();
    return { t: 'pose', s: slot, p: f.toArray(), q: [q.x, q.y, q.z, q.w], v: p.vel.toArray(), c: +p.crouch.toFixed(2), w: +p.walkPhase.toFixed(2), m: +(p.moveAmount || 0).toFixed(2) };
  }

  // ------------------------------------------------------------ multiplayer: client
  onClientMessage(msg) {
    if (msg instanceof ArrayBuffer) { this.onSnapshot(msg); return; }
    switch (msg.t) {
      case 'meta': this.applyMeta(msg.meta); break;
      case 'players': this.setPlayers(msg.list); break;
      case 'poses': {
        if (msg.ht != null) this.syncClock(msg.ht);
        for (const ps of msg.l || []) {
          if (ps.s === this.slot) continue;
          const r = this.remote.get(ps.s);
          if (r) r.target = ps;
        }
        for (const [id, x, y, z] of msg.b || []) {
          const b = this.mirrorField.bubbles.find((bb) => bb.id === id);
          if (b) b.pos.set(x, y, z);
        }
        break;
      }
      case 'chat': this.chat.add(msg); break;
      case 'closing': this.netClosed('The host closed the room'); break;
      case 'recovered':
        this.setLocalRagdoll(false, { feet: toV3(msg.feet), up: toV3(msg.up) });
        break;
    }
  }

  syncClock(ht) {
    const off = ht - performance.now() / 1000;
    if (this.timeOffset == null || off > this.timeOffset || Math.abs(off - this.timeOffset) > 1) this.timeOffset = off;
    else this.timeOffset += (off - this.timeOffset) * 0.02;
  }

  onSnapshot(buf) {
    const f = new Float32Array(buf);
    if (f[0] !== 1) return;
    const ht = f[1];
    this.syncClock(ht);
    for (let i = 2; i + 7 < f.length; i += 8) {
      const key = f[i];
      let s = this.samples.get(key);
      if (!s) { s = []; this.samples.set(key, s); }
      s.push({ t: ht, d: [f[i + 1], f[i + 2], f[i + 3], f[i + 4], f[i + 5], f[i + 6], f[i + 7]] });
      if (s.length > 4) s.shift();
    }
  }

  applySnapshots() {
    if (this.timeOffset == null) return;
    const rt = performance.now() / 1000 + this.timeOffset - INTERP_DELAY;
    const qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
    for (const [key, s] of this.samples) {
      const obj = this.mirror.objects.get(Math.floor(key / 16));
      if (!obj) continue;
      const body = obj.bodies[key % 16];
      if (!body) continue;
      let a = s[s.length - 1], b = null;
      for (let i = s.length - 1; i > 0; i--) if (s[i - 1].t <= rt) { a = s[i - 1]; b = s[i]; break; }
      let p, q;
      if (b && b.t > a.t && rt <= b.t) {
        const t = clamp((rt - a.t) / (b.t - a.t), 0, 1);
        p = { x: a.d[0] + (b.d[0] - a.d[0]) * t, y: a.d[1] + (b.d[1] - a.d[1]) * t, z: a.d[2] + (b.d[2] - a.d[2]) * t };
        qa.set(a.d[3], a.d[4], a.d[5], a.d[6]); qb.set(b.d[3], b.d[4], b.d[5], b.d[6]); qa.slerp(qb, t);
        q = { x: qa.x, y: qa.y, z: qa.z, w: qa.w };
      } else {
        const d = (b && rt > b.t) ? b.d : s[s.length - 1].d;
        p = { x: d[0], y: d[1], z: d[2] }; q = { x: d[3], y: d[4], z: d[5], w: d[6] };
      }
      if (obj._first == null) { body.setTranslation(p, false); body.setRotation(q, false); }
      obj._first = 1;
      body.setNextKinematicTranslation(p);
      body.setNextKinematicRotation(q);
    }
  }

  applyMeta(meta) {
    const pw = this.mirror;
    const prevRag = this.meta.ragdolls?.[this.slot];
    this.meta = meta;
    this.mirrorField.world = meta.world;
    this.mirrorField.loadBubbles(meta.bubbles);
    const ids = new Set();
    for (const o of meta.objects) {
      ids.add(o.id);
      const cur = pw.objects.get(o.id);
      if (!cur) {
        const pos = this.samples.get(o.id * 16 + (o.type === 'mannequin' ? 1 : 0))?.at(-1)?.d || [0, -500, 0];
        const n = pw.addObject({ ...o, pos: [pos[0], pos[1], pos[2]] }, o.id, { playerSlot: o.playerSlot, hidden: o.playerSlot === this.slot });
        if (n) n.grav = o.grav;
      } else {
        cur.grav = o.grav;
        if (cur.scale !== o.scale || cur.material !== o.material || cur.color !== o.color || cur.massMul !== o.massMul) {
          pw.updateObject(cur, { scale: o.scale, material: o.material, color: o.color, massMul: o.massMul });
        }
      }
    }
    for (const id of [...pw.objects.keys()]) if (!ids.has(id)) { pw.removeObject(id); for (let i = 0; i < 16; i++) this.samples.delete(id * 16 + i); }
    // own ragdoll state
    const rag = meta.ragdolls?.[this.slot];
    if (rag != null && prevRag == null) this.setLocalRagdoll(true);
    if (this.powers?.hold && meta.holds?.[this.slot] == null && this.powers.hold.confirmed) this.powers.hold = null;
  }

  setPlayers(list) {
    const slots = new Set();
    for (const p of list) {
      if (p.slot === this.slot) continue;
      slots.add(p.slot);
      if (!this.remote.has(p.slot)) this.addRemote(p.slot, p.name, p.color);
    }
    for (const s of [...this.remote.keys()]) if (!slots.has(s)) this.removeRemote(s);
  }

  addRemote(slot, name, color) {
    const visual = new MannequinVisual(color);
    this.renderer.scene.add(visual.group);
    const label = makeLabel(name, color);
    visual.group.add(label);
    this.remote.set(slot, { visual, name, color, target: null, pos: new THREE.Vector3(), quat: new THREE.Quaternion(), label });
  }
  removeRemote(slot) {
    const r = this.remote.get(slot);
    if (r) { r.visual.dispose(); this.remote.delete(slot); }
  }

  updateRemoteVisuals(dt) {
    const rags = this.sim ? Object.fromEntries([...this.sim.players.values()].filter((p) => p.ragdollId != null).map((p) => [p.slot, p.ragdollId])) : (this.meta?.ragdolls || {});
    for (const [slot, r] of this.remote) {
      const t = r.target;
      const hidden = rags[slot] != null || !t;
      r.visual.group.visible = !hidden;
      if (hidden) continue;
      const tp = toV3(t.p), tq = new THREE.Quaternion(...t.q);
      if (r.pos.lengthSq() === 0 || r.pos.distanceTo(tp) > 5) { r.pos.copy(tp); r.quat.copy(tq); }
      const k = 1 - Math.exp(-dt * 14);
      r.pos.lerp(tp, k); r.quat.slerp(tq, k);
      r.visual.setStanding(r.pos, r.quat, t.w || 0, t.m || 0, t.c || 0);
    }
  }

  netClosed(reason) {
    if (!this.net) return;
    const n = this.net;
    this.net = null;
    if (!n.closed) n.close('left');
    social.setRoom(null);
    if (reason === 'left') return;
    this.input.unlock();
    this.teardown(true);
    this.emit('left', reason);
  }

  // ------------------------------------------------------------ pause / panel
  showPause(show) {
    const el = $('#pause');
    el.classList.toggle('show', !!show);
    if (show) {
      $('#pause-room').textContent = this.net ? `Room code: ${this.net.code}` : '';
      $('#pause-invite').style.display = this.net ? '' : 'none';
      $('#pause-editor').style.display = this.testing ? '' : 'none';
      $('#pause-leave').style.display = this.testing ? 'none' : '';
      $('#pause-skip').style.display = this.tutorial && !this.tutorial.done ? '' : 'none';
      $('#pause-exit-tut').style.display = this.tutorial ? '' : 'none';
    }
    this.paused = !!show;
  }
  resume() {
    // the pause screen stays until the browser confirms pointer lock (see onPointerLock)
    if (this.input.locked) { this.showPause(false); return; }
    this.input.lock();
    clearTimeout(this._lockT);
    this._lockT = setTimeout(() => { if (this.mode === 'play' && !this.input.locked && !this.panel.open && !this.chat.typing) this.showPause(true); }, 600);
  }
  openPanel() { this.panel.toggle(true); this.input.unlock(); }
  closePanel() {
    this.panel.toggle(false);
    this.input.lock();
    clearTimeout(this._lockT);
    this._lockT = setTimeout(() => { if (this.mode === 'play' && !this.input.locked && !this.panel.open) this.showPause(true); }, 600);
  }

  onPointerLock(locked) {
    if (this.mode !== 'play') return;
    if (locked) { this.showPause(false); return; }
    if (this.panel.open || this.chat.typing || $('#menu').classList.contains('hidden') === false) return;
    this.showPause(true);
  }

  // ------------------------------------------------------------ frame
  update(dt) {
    const input = this.input;
    if (this.mode === 'menu') { this.updateShowcase(dt); return; }
    if (this.mode !== 'play' || !this.player) return;

    const active = input.locked && !this.chat.typing;
    const look = active ? input.consumeMouse() : (input.consumeMouse(), { dx: 0, dy: 0 });
    if (!active) input.consumeWheel();
    const rotating = this.powers.hold && input.is('rotate');
    if (!rotating) this.player.look(look.dx, look.dy);

    // keys while playing
    if (active) {
      if (input.hit('powerWheel')) { this.openPanel(); }
      if (input.hit('chat') && this.net) this.chat.focus();
      if (input.hit('ragdoll')) {
        if (this.player.ragdolled) this.send({ c: 'recover' });
        else { const q = this.player.getQuat(); this.send({ c: 'ragdoll', vel: this.player.vel.toArray(), feet: this.player.getFeet().toArray(), quat: [q.x, q.y, q.z, q.w] }); }
      }
    } else if (this.panel.open && (input.hit('powerWheel'))) this.closePanel();
    this.hud.showPlayers(active && input.is('players'), this);

    const move = active ? {
      x: (input.is('right') ? 1 : 0) - (input.is('left') ? 1 : 0),
      z: (input.is('forward') ? 1 : 0) - (input.is('back') ? 1 : 0),
      jump: input.is('jump') || input.hit('jump'), sprint: input.is('sprint'), crouch: input.is('crouch'),
      up: (input.is('jump') ? 1 : 0) - (input.is('crouch') ? 1 : 0),
    } : { x: 0, z: 0, jump: false, sprint: false, crouch: false, up: 0 };

    // exclude held object & own ragdoll from the controller
    const ex = this.player.excluded; ex.clear();
    const hid = this.holdOf(this.slot);
    const ho = hid != null && this.pw.objects.get(hid);
    if (ho) ho.colliders.forEach((c) => ex.add(c.handle));

    this.player.update(dt, move);
    if (active && !this.player.ragdolled) this.powers.update(dt, input, look);
    else if (active && this.player.ragdolled) { input.consumeWheel(); }

    if (this.role === 'client') {
      this.applySnapshots();
      this.mirror.world.step();
      this.mirror.syncAll();
      this.poseTimer += dt;
      if (this.poseTimer >= SNAP_DT) { this.poseTimer %= SNAP_DT; this.net.toHost(this.localPose(this.slot), false); }
    } else {
      this.sim.update(dt);
      if (this.role === 'host') this.hostNetTick(dt);
    }

    // respawn if out of the map
    if (!this.player.ragdolled && this.pw.outside(this.player.center, 8)) {
      const sp = this.map.spawns[this.slot % this.map.spawns.length];
      this.player.personalG = null;
      this.player.teleport(new THREE.Vector3(sp[0], sp[1] + 0.05, sp[2]), new THREE.Vector3(0, 1, 0));
      this.hud.flash('Respawned');
    }

    this.updateCamera(dt);
    this.updateRemoteVisuals(dt);
    this.visuals.update(dt, this.field, this.links(), this.pw, this.powers);
    this.hud.update(dt, this);
    this.tutorial?.update(dt);
  }

  updateCamera(dt) {
    const cam = this.renderer.camera;
    const p = this.player;
    if (p.ragdolled) {
      const id = this.ragdollId();
      const o = id != null && this.pw.objects.get(id);
      if (o) {
        const h = o.bodies[HEAD].translation();
        cam.position.set(h.x, h.y, h.z);
        const t = o.bodies[TORSO].linvel ? o.bodies[TORSO] : null;
        // auto stand up after resting
        this.ragdollTime += dt;
        const v = t && !this.mirror ? t.linvel() : null;
        const speed = v ? Math.hypot(v.x, v.y, v.z) : (o._lastH ? new THREE.Vector3(h.x, h.y, h.z).distanceTo(o._lastH) / Math.max(dt, 1e-3) : 1);
        o._lastH = new THREE.Vector3(h.x, h.y, h.z);
        const held = Object.values(this.sim ? Object.fromEntries([...this.sim.holds].map(([s, x]) => [s, x.objId])) : this.meta.holds || {}).includes(id);
        this.ragdollRest = speed < 0.35 && !held ? this.ragdollRest + dt : 0;
        if (this.ragdollRest > 2.5 && this.ragdollTime > 1) { this.ragdollRest = -10; this.send({ c: 'recover' }); }
      }
      cam.quaternion.copy(p.getViewQuat());
    } else {
      p.getEye(cam.position);
      cam.quaternion.copy(p.getViewQuat());
    }
    // own body (shadow only)
    if (this.ownBody) {
      this.ownBody.group.visible = !p.ragdolled;
      this.ownBody.setColor(account.color);
      this.ownBody.setStanding(p.getFeet(), p.getQuat(), p.walkPhase, p.moveAmount || 0, p.crouch);
    }
  }

  updateShowcase(dt) {
    const sim = this.sim;
    if (!sim) return;
    this.showcaseT += dt;
    const t = this.showcaseT;
    // every few seconds toggle zero-g to show off the physics
    const phase = Math.floor(t / 7) % 3;
    if (phase !== this.showPhase) {
      this.showPhase = phase;
      if (phase === 1) sim.command(0, { c: 'worldGrav', dir: [0, -1, 0], s: 0 });
      else if (phase === 2) sim.command(0, { c: 'worldGrav', dir: [0, 1, 0], s: 2 });
      else sim.command(0, { c: 'worldGrav', dir: [0, -1, 0], s: 9.81 });
      if (phase === 1) for (const o of sim.pw.objects.values()) sim.pw.mainBody(o).applyImpulse({ x: (Math.random() - 0.5) * 2, y: 3 * sim.pw.totalMass(o) * 0.1, z: (Math.random() - 0.5) * 2 }, true);
    }
    sim.update(dt);
    const cam = this.renderer.camera;
    const a = t * 0.06;
    cam.position.set(Math.cos(a) * 16, 6 + Math.sin(t * 0.1) * 1.5, Math.sin(a) * 16);
    cam.lookAt(0, 4, 0);
    this.visuals.update(dt, sim.field, sim.links, sim.pw, null);
  }
}

function makeLabel(name, color) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(20,28,40,0.7)';
  const w = Math.min(250, 30 + ctx.measureText(name).width * 2.2);
  ctx.font = '600 28px "Space Grotesk", sans-serif';
  const tw = ctx.measureText(name).width + 36;
  roundRect(ctx, 128 - tw / 2, 10, tw, 44, 12); ctx.fill();
  ctx.fillStyle = color; ctx.beginPath(); ctx.arc(128 - tw / 2 + 18, 32, 6, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.fillText(name, 128 - tw / 2 + 30, 33);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: true, transparent: true }));
  s.scale.set(1.2, 0.3, 1);
  s.position.set(0, 2.1, 0);
  void w;
  return s;
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
