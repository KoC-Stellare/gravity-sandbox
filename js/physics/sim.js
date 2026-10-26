import * as THREE from 'three';
import { PhysicsWorld } from './world.js';
import { Emitter, toV3, clamp } from '../util.js';
import { G_EARTH, TK_LIMIT_KG, MAX_BUBBLES, MAX_LINKS, MAX_G, PLAYER } from '../config.js';
import { TORSO } from '../player/mannequin.js';

const _g = new THREE.Vector3();
const _p = new THREE.Vector3();
const _v = new THREE.Vector3();
const _f = new THREE.Vector3();
const STEP = 1 / 120;

/**
 * Gravity field: world gravity, bubbles and per-object overrides.
 * Shared by the authoritative simulation and by clients (for their own player).
 */
export class GravityField {
  constructor() {
    this.world = { dir: [0, -1, 0], s: G_EARTH };
    this.bubbles = [];
  }
  /** Gravity acceleration (m/s²) at a point. override = {dir, s} or null */
  at(pos, out = new THREE.Vector3(), override = null) {
    if (override) return out.set(...override.dir).normalize().multiplyScalar(override.s);
    const b = this.bubbleAt(pos);
    if (b) return this.bubbleG(b, pos, out);
    return out.set(...this.world.dir).normalize().multiplyScalar(this.world.s);
  }
  bubbleAt(pos) {
    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const b = this.bubbles[i];
      if (b.pos.distanceToSquared(pos) <= b.r * b.r) return b;
    }
    return null;
  }
  bubbleG(b, pos, out) {
    if (b.mode === 'in' || b.mode === 'out') {
      out.copy(b.pos).sub(pos);
      const d = out.length();
      if (d < 0.05) return out.set(0, 0, 0);
      out.multiplyScalar((b.mode === 'in' ? 1 : -1) * b.s / d);
      return out;
    }
    if (b.mode === 'zero' || b.s === 0) return out.set(0, 0, 0);
    return out.set(...b.dir).normalize().multiplyScalar(b.s);
  }
  serializeBubbles() {
    return this.bubbles.map((b) => ({ id: b.id, pos: [b.pos.x, b.pos.y, b.pos.z], r: b.r, mode: b.mode, dir: b.dir, s: b.s, owner: b.owner }));
  }
  loadBubbles(list) {
    const byId = new Map(this.bubbles.map((b) => [b.id, b]));
    this.bubbles = list.map((d) => {
      const b = byId.get(d.id) || { id: d.id, pos: toV3(d.pos), vel: new THREE.Vector3(), inside: new Set(), mass: 20 };
      Object.assign(b, { r: d.r, mode: d.mode, dir: d.dir, s: d.s, owner: d.owner });
      if (!byId.has(d.id)) b.pos.set(...d.pos);
      return b;
    });
  }
}

/**
 * Authoritative simulation (singleplayer or multiplayer host).
 * Every change of the world goes through command(slot, cmd) so clients and the host behave the same.
 */
export class Sim extends Emitter {
  constructor(R, scene, map) {
    super();
    this.R = R;
    this.map = map;
    this.pw = new PhysicsWorld(R, scene);
    this.pw.buildStatic(map);
    this.field = new GravityField();
    if (map.gravity) this.field.world = { dir: map.gravity.dir.slice(), s: map.gravity.s };
    this.links = [];
    this.holds = new Map();        // slot -> hold
    this.players = new Map();      // slot -> proxy {slot, collider, body, vel, ragdollId, name, color, local}
    this.nextBubble = 1;
    this.nextLink = 1;
    this.metaDirty = true;
    this.acc = 0;
    this.time = 0;
    for (const o of map.objects) this.pw.addObject(o);
    this.extra = new Map();
    this.tooHeavy = new Map();
  }

  dispose() { this.pw.dispose(); }

  markMeta() { this.metaDirty = true; }

  // ---------- main loop ----------
  update(dt) {
    this.acc += Math.min(dt, 0.1);
    let steps = 0;
    while (this.acc >= STEP && steps < 6) {
      this.fixedStep(STEP);
      this.acc -= STEP;
      steps++;
    }
    if (steps === 6) this.acc = 0;
    this.pw.syncAll();
  }

  fixedStep(h) {
    this.time += h;
    const pw = this.pw;
    // Bubbles drift (they have no gravity themselves, only momentum from hits)
    const b = pw.bounds;
    for (const bub of this.field.bubbles) {
      if (bub.vel.lengthSq() > 1e-6) {
        bub.pos.addScaledVector(bub.vel, h);
        bub.vel.multiplyScalar(Math.exp(-0.35 * h));
        for (let i = 0; i < 3; i++) {
          const c = 'xyz'[i];
          if (bub.pos[c] < b.min[i]) { bub.pos[c] = b.min[i]; bub.vel[c] = Math.abs(bub.vel[c]) * 0.5; }
          if (bub.pos[c] > b.max[i]) { bub.pos[c] = b.max[i]; bub.vel[c] = -Math.abs(bub.vel[c]) * 0.5; }
        }
      }
    }
    // Extra forces: attraction + telekinesis
    const extra = this.extra;
    extra.clear();
    this.applyLinks(extra);
    this.applyHolds(extra, h);

    for (const obj of pw.objects.values()) {
      for (let i = 0; i < obj.bodies.length; i++) {
        const body = obj.bodies[i];
        const t = body.translation();
        _p.set(t.x, t.y, t.z);
        // bubble enter push
        if (i === (obj.ragdoll ? TORSO : 0)) this.bubbleContact(obj, body, _p);
        const ex = extra.get(body.handle);
        this.field.at(_p, _g, obj.grav);
        const m = body.mass();
        _f.copy(_g).multiplyScalar(m);
        if (ex) _f.add(ex);
        const last = obj.lastF[i];
        if (!last || Math.abs(last[0] - _f.x) + Math.abs(last[1] - _f.y) + Math.abs(last[2] - _f.z) > 1e-4 * (1 + m)) {
          body.resetForces(false);
          body.addForce({ x: _f.x, y: _f.y, z: _f.z }, false); // keeps resting things asleep until something disturbs them
          obj.lastF[i] = [_f.x, _f.y, _f.z];
        }
      }
    }
    this.gravityChanged = false;
    pw.world.step();
    this.checkKnockdowns();
    // respawn lost objects
    if (Math.floor(this.time * 2) !== Math.floor((this.time - h) * 2)) {
      for (const obj of pw.objects.values()) {
        const body = pw.mainBody(obj);
        const t = body.translation();
        if (pw.outside(_p.set(t.x, t.y, t.z))) {
          if (obj.playerSlot != null) continue;
          const s = obj.spawn;
          body.setTranslation({ x: s.pos[0], y: s.pos[1], z: s.pos[2] }, true);
          body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        }
      }
    }
  }

  bubbleContact(obj, body, pos) {
    for (const bub of this.field.bubbles) {
      const inside = bub.pos.distanceToSquared(pos) <= bub.r * bub.r;
      const was = bub.inside.has(obj.id);
      if (inside && !was) {
        bub.inside.add(obj.id);
        const v = body.linvel();
        const m = this.pw.totalMass(obj);
        const k = (m / (m + bub.mass)) * 0.35;
        bub.vel.x += v.x * k; bub.vel.y += v.y * k; bub.vel.z += v.z * k;
        if (bub.vel.length() > 6) bub.vel.setLength(6);
      } else if (!inside && was) bub.inside.delete(obj.id);
    }
  }

  applyLinks(extra) {
    const pw = this.pw;
    for (const l of this.links) {
      const A = pw.objects.get(l.a);
      const B = l.b != null ? pw.objects.get(l.b) : null;
      if (!A || (l.b != null && !B)) continue;
      const ba = pw.mainBody(A);
      const pa = ba.translation();
      let pb, mb;
      if (B) { const bb = pw.mainBody(B); pb = bb.translation(); mb = pw.totalMass(B); }
      else { pb = { x: l.point[0], y: l.point[1], z: l.point[2] }; mb = 1000; }
      const ma = pw.totalMass(A);
      _v.set(pb.x - pa.x, pb.y - pa.y, pb.z - pa.z);
      const d2 = Math.max(_v.lengthSq(), 0.36);
      let F = (l.G * ma * mb) / d2;
      F = Math.min(F, 40 * Math.min(ma, B ? mb : ma) * G_EARTH);
      _v.normalize().multiplyScalar(F);
      addExtra(extra, ba.handle, _v);
      if (B) addExtra(extra, pw.mainBody(B).handle, _v.clone().negate());
    }
  }

  applyHolds(extra, h) {
    const pw = this.pw;
    const cap = TK_LIMIT_KG * G_EARTH * 1.02;
    for (const [slot, hold] of this.holds) {
      const obj = pw.objects.get(hold.objId);
      if (!obj) { this.holds.delete(slot); this.markMeta(); continue; }
      const body = pw.mainBody(obj);
      const t = body.translation();
      const v = body.linvel();
      const m = pw.totalMass(obj);
      _p.set(t.x, t.y, t.z);
      this.field.at(_p, _g, obj.grav);
      const K = 55, C = 13;
      _f.set((hold.target.x - t.x) * K - v.x * C, (hold.target.y - t.y) * K - v.y * C, (hold.target.z - t.z) * K - v.z * C);
      _f.sub(_g).multiplyScalar(m);
      if (_f.length() > cap) _f.setLength(cap);
      addExtra(extra, body.handle, _f);
      this.tooHeavy.set(slot, m * _g.length() > TK_LIMIT_KG * G_EARTH);
      // rotation: user rotates, otherwise damp spin
      const av = body.angvel();
      if (hold.rot && (hold.rot[0] || hold.rot[1] || hold.rot[2])) {
        const w = Math.min(1, 40 / Math.max(m, 1)) * 2 + 0.5;
        body.setAngvel({ x: hold.rot[0] * w, y: hold.rot[1] * w, z: hold.rot[2] * w }, true);
      } else if (m * _g.length() < cap) {
        body.setAngvel({ x: av.x * 0.94, y: av.y * 0.94, z: av.z * 0.94 }, true);
      }
    }
  }

  // ---------- players ----------
  /** Register a kinematic capsule (local or remote player proxy) for knockdowns and telekinesis. */
  addPlayerProxy(slot, info) {
    this.players.set(slot, { slot, vel: new THREE.Vector3(), ragdollId: null, ...info });
    this.markMeta();
  }
  removePlayerProxy(slot) {
    const p = this.players.get(slot);
    if (!p) return;
    if (p.ragdollId != null) this.pw.removeObject(p.ragdollId);
    if (p.remote && p.body) { this.pw.colliderRef.delete(p.collider.handle); this.pw.world.removeRigidBody(p.body); }
    this.holds.delete(slot);
    for (const [s, h] of this.holds) if (h.objId === p.ragdollId) this.holds.delete(s);
    this.players.delete(slot);
    this.markMeta();
  }
  /** Create kinematic capsule for a remote player. */
  addRemotePlayer(slot, info) {
    const R = this.R;
    const body = this.pw.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -100, 0));
    const hh = PLAYER.height / 2 - PLAYER.radius;
    const collider = this.pw.world.createCollider(R.ColliderDesc.capsule(hh, PLAYER.radius).setMass(PLAYER.mass), body);
    this.pw.colliderRef.set(collider.handle, { player: slot });
    this.addPlayerProxy(slot, { ...info, body, collider, remote: true, pos: new THREE.Vector3(), quat: new THREE.Quaternion() });
  }
  setRemotePose(slot, pos, quat, vel) {
    const p = this.players.get(slot);
    if (!p || !p.remote) return;
    p.pos.copy(pos); p.quat.copy(quat); p.vel.copy(vel);
    if (p.ragdollId != null) return;
    // capsule center = feet + up * height/2
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(quat);
    const c = pos.clone().addScaledVector(up, PLAYER.height / 2);
    p.body.setNextKinematicTranslation({ x: c.x, y: c.y, z: c.z });
    p.body.setNextKinematicRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w });
  }

  /** Turn a player into a ragdoll. feet/quat: current pose. */
  ragdollPlayer(slot, vel = new THREE.Vector3(), feet = null, quat = null) {
    const p = this.players.get(slot);
    if (!p || p.ragdollId != null) return null;
    const f = feet || p.getFeet?.() || p.pos;
    const q = quat || p.getQuat?.() || p.quat;
    const obj = this.pw.addObject({ type: 'mannequin', pos: [f.x, f.y, f.z], quat: [q.x, q.y, q.z, q.w], color: p.color }, null,
      { playerSlot: slot, vel, hidden: !!p.local });
    p.ragdollId = obj.id;
    p.collider.setEnabled(false);
    p.ragdollAt = this.time;
    this.emit('ragdoll', slot, obj.id);
    this.markMeta();
    return obj;
  }
  /** Stand back up; returns { feet, up } for the controller. */
  recoverPlayer(slot) {
    const p = this.players.get(slot);
    if (!p || p.ragdollId == null) return null;
    const obj = this.pw.objects.get(p.ragdollId);
    let res = null;
    if (obj) {
      const t = obj.bodies[TORSO].translation();
      const torso = new THREE.Vector3(t.x, t.y, t.z);
      this.field.at(torso, _g, null);
      const up = _g.lengthSq() > 0.01 ? _g.clone().normalize().negate() : new THREE.Vector3(0, 1, 0);
      // find the floor under the torso along gravity
      const hit = this.pw.raycast(torso, up.clone().negate(), 3, new Set(obj.colliders.map((c) => c.handle)));
      const feet = hit ? hit.point.clone().addScaledVector(up, 0.05) : torso.clone().addScaledVector(up, -0.9);
      res = { feet, up };
      for (const [s, h] of this.holds) if (h.objId === obj.id) this.holds.delete(s);
      this.pw.removeObject(obj.id);
    }
    p.ragdollId = null;
    p.collider.setEnabled(true);
    this.emit('recover', slot, res);
    this.markMeta();
    return res;
  }

  checkKnockdowns() {
    const pw = this.pw;
    for (const p of this.players.values()) {
      if (p.ragdollId != null || !p.collider || p.noKnock) continue;
      if (this.time - (p.recoveredAt || 0) < 1.5) continue;
      pw.world.contactPairsWith(p.collider, (other) => {
        if (p.ragdollId != null) return;
        const ref = pw.colliderRef.get(other.handle);
        if (!ref?.obj || ref.obj.playerSlot === p.slot) return;
        const body = other.parent();
        if (!body || !body.isDynamic()) return;
        const v = body.linvel();
        const rel = _v.set(v.x - p.vel.x, v.y - p.vel.y, v.z - p.vel.z);
        const m = body.mass();
        const impulse = rel.length() * m; // kg·m/s
        if (rel.length() > 6 && impulse > 260) {
          this.ragdollPlayer(p.slot, rel.clone().multiplyScalar(Math.min(0.6, m / 150)).add(p.vel));
        }
      });
    }
  }

  // ---------- commands ----------
  command(slot, cmd) {
    const pw = this.pw;
    const objs = (ids) => (ids || []).map((id) => pw.objects.get(id)).filter(Boolean);
    switch (cmd.c) {
      case 'objGrav': {
        for (const o of objs(cmd.ids)) {
          o.grav = cmd.inherit ? null : { dir: cmd.dir, s: clamp(cmd.s, 0, MAX_G * G_EARTH) };
          const mm = clamp(cmd.massMul ?? o.massMul, 0.1, 100);
          if (Math.abs(mm - o.massMul) > 1e-6 && !o.ragdoll) pw.updateObject(o, { massMul: mm });
          o.lastF = [];
          o.bodies.forEach((b) => b.wakeUp());
        }
        this.markMeta();
        break;
      }
      case 'objReset': {
        for (const o of objs(cmd.ids)) {
          o.grav = null;
          if (o.massMul !== 1 && !o.ragdoll) pw.updateObject(o, { massMul: 1 });
          o.lastF = []; o.bodies.forEach((b) => b.wakeUp());
        }
        this.markMeta();
        break;
      }
      case 'worldGrav':
        this.field.world = { dir: cmd.dir, s: clamp(cmd.s, 0, MAX_G * G_EARTH) };
        this.wakeAll();
        this.markMeta();
        break;
      case 'bubbleAdd': {
        if (this.field.bubbles.length >= MAX_BUBBLES) this.field.bubbles.shift();
        this.field.bubbles.push({ id: this.nextBubble++, pos: toV3(cmd.pos), vel: new THREE.Vector3(), inside: new Set(), mass: 20,
          r: clamp(cmd.r, 0.5, 15), mode: cmd.mode, dir: cmd.dir, s: clamp(cmd.s, 0, MAX_G * G_EARTH), owner: slot });
        this.wakeAll();
        this.markMeta();
        break;
      }
      case 'bubbleDel':
        this.field.bubbles = this.field.bubbles.filter((b) => b.id !== cmd.id);
        this.wakeAll(); this.markMeta();
        break;
      case 'bubbleEdit': {
        const b = this.field.bubbles.find((x) => x.id === cmd.id);
        if (b) { Object.assign(b, { mode: cmd.mode ?? b.mode, dir: cmd.dir ?? b.dir, s: clamp(cmd.s ?? b.s, 0, MAX_G * G_EARTH) }); this.wakeAll(); this.markMeta(); }
        break;
      }
      case 'linkAdd': {
        if (!pw.objects.get(cmd.a)) break;
        if (this.links.length >= MAX_LINKS) this.links.shift();
        this.links.push({ id: this.nextLink++, a: cmd.a, b: cmd.b ?? null, point: cmd.point || null, G: clamp(cmd.G, 0.001, 50) });
        objs([cmd.a, cmd.b]).forEach((o) => o.bodies.forEach((b) => b.wakeUp()));
        this.markMeta();
        break;
      }
      case 'linkClear':
        this.links = this.links.filter((l) => l.a !== cmd.id && l.b !== cmd.id);
        this.markMeta();
        break;
      case 'tkGrab': {
        let o = pw.objects.get(cmd.id);
        if (cmd.player != null) {
          const pl = this.players.get(cmd.player);
          if (!pl || cmd.player === slot) break;
          o = pl.ragdollId != null ? pw.objects.get(pl.ragdollId) : this.ragdollPlayer(cmd.player, new THREE.Vector3());
        }
        if (!o) break;
        for (const [s, h] of this.holds) if (h.objId === o.id && s !== slot) this.holds.delete(s);
        const t = pw.mainBody(o).translation();
        this.holds.set(slot, { objId: o.id, target: cmd.target ? toV3(cmd.target) : new THREE.Vector3(t.x, t.y, t.z), rot: null });
        o.bodies.forEach((b) => b.wakeUp());
        this.markMeta();
        break;
      }
      case 'tkAim': {
        const h = this.holds.get(slot);
        if (h) { h.target.set(...cmd.target); h.rot = cmd.rot || null; }
        break;
      }
      case 'tkRelease':
        if (this.holds.delete(slot)) this.markMeta();
        break;
      case 'tkThrow': {
        const h = this.holds.get(slot);
        if (!h) break;
        const o = pw.objects.get(h.objId);
        this.holds.delete(slot);
        if (o) this.impulseObj(o, toV3(cmd.dir), 22, TK_LIMIT_KG * G_EARTH * 0.35);
        this.markMeta();
        break;
      }
      case 'tkPush': {
        let o = pw.objects.get(cmd.id);
        if (cmd.player != null) {
          const pl = this.players.get(cmd.player);
          if (!pl || cmd.player === slot) break;
          o = pl.ragdollId != null ? pw.objects.get(pl.ragdollId) : this.ragdollPlayer(cmd.player, new THREE.Vector3());
        }
        if (o) this.impulseObj(o, toV3(cmd.dir), 6, TK_LIMIT_KG * G_EARTH * 0.1);
        break;
      }
      case 'tkResize': {
        const o = pw.objects.get(cmd.id);
        if (!o || o.ragdoll) break;
        const s = clamp(o.scale * cmd.f, 0.1, 5);
        if (Math.abs(s - o.scale) < 1e-4) break;
        pw.updateObject(o, { scale: s });
        this.markMeta();
        break;
      }
      case 'resetAll':
        this.field.world = { dir: (this.map.gravity?.dir || [0, -1, 0]).slice(), s: this.map.gravity?.s ?? G_EARTH };
        this.field.bubbles = [];
        this.links = [];
        for (const o of pw.objects.values()) { o.grav = null; if (o.massMul !== 1 && !o.ragdoll) pw.updateObject(o, { massMul: 1 }); }
        this.wakeAll(); this.markMeta();
        break;
      case 'ragdoll': {
        const p = this.players.get(slot);
        if (p && p.ragdollId == null) this.ragdollPlayer(slot, cmd.vel ? toV3(cmd.vel) : new THREE.Vector3(), cmd.feet ? toV3(cmd.feet) : null, cmd.quat ? new THREE.Quaternion(...cmd.quat) : null);
        break;
      }
      case 'recover': {
        const p = this.players.get(slot);
        if (p && p.ragdollId != null && this.time - p.ragdollAt > 0.8) { this.recoverPlayer(slot); p.recoveredAt = this.time; }
        break;
      }
    }
  }

  impulseObj(o, dir, maxSpeed, maxImpulse) {
    const m = this.pw.totalMass(o);
    const J = Math.min(m * maxSpeed, maxImpulse);
    dir.normalize();
    if (o.ragdoll) {
      for (const b of o.bodies) b.applyImpulse({ x: dir.x * J * b.mass() / m, y: dir.y * J * b.mass() / m, z: dir.z * J * b.mass() / m }, true);
    } else {
      this.pw.mainBody(o).applyImpulse({ x: dir.x * J, y: dir.y * J, z: dir.z * J }, true);
    }
  }

  wakeAll() {
    this.gravityChanged = true;
    for (const o of this.pw.objects.values()) { o.lastF = []; o.bodies.forEach((b) => b.wakeUp()); }
  }

  /** Everything except transforms — sent reliably to clients when it changes. */
  getMeta() {
    const objects = [];
    for (const o of this.pw.objects.values()) {
      objects.push({ id: o.id, type: o.type, size: o.size, material: o.material, color: o.color, scale: o.scale, massMul: o.massMul,
        grav: o.grav, playerSlot: o.playerSlot, mass: Math.round(this.pw.totalMass(o) * 100) / 100 });
    }
    const holds = {};
    for (const [s, h] of this.holds) holds[s] = h.objId;
    const ragdolls = {};
    for (const p of this.players.values()) if (p.ragdollId != null) ragdolls[p.slot] = p.ragdollId;
    return { world: this.field.world, bubbles: this.field.serializeBubbles(), links: this.links.map((l) => ({ ...l })), objects, holds, ragdolls };
  }

  /** Current transforms of all moving bodies, for a snapshot. */
  snapshotBodies(all = false) {
    const out = [];
    for (const o of this.pw.objects.values()) {
      o.bodies.forEach((b, i) => {
        if (!all && b.isSleeping() && o.sentSleep?.[i]) return;
        (o.sentSleep ||= [])[i] = b.isSleeping();
        const t = b.translation(), r = b.rotation();
        out.push(o.id * 16 + i, t.x, t.y, t.z, r.x, r.y, r.z, r.w);
      });
    }
    return out;
  }
}

function addExtra(map, handle, v) {
  const e = map.get(handle);
  if (e) e.add(v); else map.set(handle, v.clone());
}
