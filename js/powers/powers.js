import * as THREE from 'three';
import { COLORS, G_EARTH, TK_LIMIT_KG } from '../config.js';
import { snapAxis, clamp, fmtKg, fmtG } from '../util.js';

export const POWERS = [
  { id: 'object', key: 'power1', name: 'Object gravity', short: 'Object', icon: '◆', hint: 'LMB apply · RMB reset · Q settings' },
  { id: 'scan', key: 'power2', name: 'Area scan', short: 'Scan', icon: '◎', hint: 'Hold LMB grow · release apply · RMB reset last' },
  { id: 'world', key: 'power3', name: 'World gravity', short: 'World', icon: '⊕', hint: 'LMB set down = look · RMB Earth 1 g' },
  { id: 'body', key: 'power4', name: 'Body gravity', short: 'Body', icon: '⇩', hint: 'LMB walk on aimed surface · RMB return' },
  { id: 'bubble', key: 'power5', name: 'Bubble', short: 'Bubble', icon: '◯', hint: 'Hold LMB size · release place · RMB delete · F edit' },
  { id: 'attract', key: 'power6', name: 'Attraction', short: 'Attract', icon: '⟷', hint: 'LMB pick A, then B or a point · RMB remove links' },
  { id: 'tk', key: 'power7', name: 'Telekinesis', short: 'Mind', icon: '✋', hint: 'LMB grab/drop · RMB throw/push · ⇧RMB pull · R rotate · wheel distance' },
];

export const DIR_MODES = [
  { id: 'look', label: 'Where I look' }, { id: 'down', label: 'Down' }, { id: 'up', label: 'Up' }, { id: 'zero', label: 'Zero-g' },
];
export const BUBBLE_MODES = [...DIR_MODES, { id: 'in', label: 'Toward center' }, { id: 'out', label: 'Away from center' }];

const _v = new THREE.Vector3();

export class Powers {
  /** @param {import('../game.js').Game} game */
  constructor(game) {
    this.game = game;
    this.index = 0;
    this.cfg = {
      object: { mode: 'look', snap: true, g: 1, mass: 1 },
      world: { snap: true, g: 1 },
      body: { g: 1, useWorld: true },
      bubble: { mode: 'zero', snap: true, g: 1 },
      attract: { G: 0.25 },
      tk: { dist: 4 },
    };
    try { Object.assign(this.cfg, JSON.parse(localStorage.getItem('gs_powers') || '{}')); } catch { /* ignore */ }
    this.scan = null;           // { center, r }
    this.lastScan = [];
    this.bubbleDraft = null;    // { center, r }
    this.attractA = null;
    this.hold = null;           // { id, dist }
    this.aim = null;
    this.aimBubble = null;
    this.resetHold = 0;
    this.highlighted = new Set();
    this.toast = null;
    this.tkAimTimer = 0;
  }

  get power() { return POWERS[this.index]; }
  saveCfg() { try { localStorage.setItem('gs_powers', JSON.stringify(this.cfg)); } catch { /* ignore */ } }
  select(i) {
    if (i === this.index) return;
    this.cancelTransient();
    this.index = (i + POWERS.length) % POWERS.length;
    this.game.hud.flash(this.power.name);
    this.game.maybeTip(this.power.id);
  }
  cancelTransient() { this.scan = null; this.bubbleDraft = null; this.attractA = null; }

  dirFromMode(mode, snap) {
    const g = this.game;
    if (mode === 'down') return [0, -1, 0];
    if (mode === 'up') return [0, 1, 0];
    if (mode === 'zero' || mode === 'in' || mode === 'out') return [0, -1, 0];
    const d = g.player.getLookDir(new THREE.Vector3());
    const v = snap ? snapAxis(d) : d.normalize();
    return [v.x, v.y, v.z];
  }

  /** Called every frame while playing (pointer locked). */
  update(dt, input, look) {
    const g = this.game;
    const player = g.player;
    const eye = player.getEye(new THREE.Vector3());
    const dir = player.getLookDir(new THREE.Vector3());

    // power selection
    for (let i = 0; i < POWERS.length; i++) if (input.hit(POWERS[i].key)) this.select(i);
    const wheel = input.consumeWheel();
    if (wheel) {
      if (this.hold) this.cfg.tk.dist = clamp(this.cfg.tk.dist - wheel * 0.6, 1.5, 25);
      else if (this.bubbleDraft) this.bubbleDraft.r = clamp(this.bubbleDraft.r - wheel * 0.5, 0.5, 15);
      else this.select(this.index + wheel);
    }

    // aim
    const exclude = g.ownColliders();
    const range = this.power.id === 'tk' ? 30 : 120;
    this.aim = g.pw.raycast(eye, dir, range, exclude);
    this.aimBubble = this.rayBubble(eye, dir);

    const p = this.power.id;
    const L = input.mousePressed[0], Lup = input.mouseReleased[0], Ldown = input.mouseDown[0];
    const Rc = input.mousePressed[2];
    const target = this.aimTarget();
    if (L || Rc) this.game.maybeTip(p);

    switch (p) {
      case 'object':
        if (L && target?.obj) this.applyObj([target.obj.id]);
        if (Rc && target?.obj) g.send({ c: 'objReset', ids: [target.obj.id] });
        break;
      case 'scan': {
        if (L) this.scan = { center: this.aimPoint(eye, dir, 10), r: 0.5 };
        if (this.scan && Ldown) { this.scan.center = this.aimPoint(eye, dir, 10); this.scan.r = Math.min(14, this.scan.r + dt * 5); }
        if (this.scan && (Lup || !Ldown)) {
          const ids = [];
          for (const o of g.pw.objects.values()) {
            if (o.playerSlot != null) continue;
            if (g.pw.objPos(o, _v).distanceTo(this.scan.center) <= this.scan.r) ids.push(o.id);
          }
          if (ids.length) { this.applyObj(ids); this.lastScan = ids; this.game.hud.flash(`${ids.length} object${ids.length > 1 ? 's' : ''} changed`); }
          else this.game.hud.flash('Nothing in range');
          this.scan = null;
        }
        if (Rc && this.lastScan.length) { g.send({ c: 'objReset', ids: this.lastScan }); this.game.hud.flash('Scan reset'); this.lastScan = []; }
        break;
      }
      case 'world':
        if (L) {
          const c = this.cfg.world;
          const d = this.dirFromMode('look', c.snap);
          g.send({ c: 'worldGrav', dir: d, s: c.g * G_EARTH });
          g.hud.flash(`World gravity ${fmtG(c.g * G_EARTH)}`);
        }
        if (Rc) { g.send({ c: 'worldGrav', dir: [0, -1, 0], s: G_EARTH }); g.hud.flash('World gravity: Earth 1 g'); }
        break;
      case 'body':
        if (L && this.aim && !this.aim.obj && this.aim.ref?.player == null) {
          const n = this.aim.normal;
          const s = this.cfg.body.useWorld ? Math.max(g.field.world.s, 0.5) : this.cfg.body.g * G_EARTH;
          player.personalG = { dir: [-n.x, -n.y, -n.z], s };
          g.hud.flash('Walking on surface');
        } else if (L && this.aim?.obj) {
          const n = this.aim.normal;
          player.personalG = { dir: [-n.x, -n.y, -n.z], s: this.cfg.body.useWorld ? Math.max(g.field.world.s, 0.5) : this.cfg.body.g * G_EARTH };
        }
        if (Rc) { player.personalG = null; g.hud.flash('Back to world gravity'); }
        break;
      case 'bubble':
        if (L) this.bubbleDraft = { center: this.aimPoint(eye, dir, 8), r: 1 };
        if (this.bubbleDraft && Ldown) { this.bubbleDraft.center = this.aimPoint(eye, dir, 8); this.bubbleDraft.r = Math.min(15, this.bubbleDraft.r + dt * 3.5); }
        if (this.bubbleDraft && (Lup || !Ldown)) {
          const c = this.cfg.bubble;
          const b = this.bubbleDraft;
          g.send({ c: 'bubbleAdd', pos: [b.center.x, b.center.y, b.center.z], r: b.r, mode: c.mode === 'zero' ? 'zero' : (c.mode === 'in' || c.mode === 'out') ? c.mode : 'dir',
            dir: this.dirFromMode(c.mode, c.snap), s: c.mode === 'zero' ? 0 : c.g * G_EARTH });
          this.bubbleDraft = null;
        }
        if (Rc && this.aimBubble) g.send({ c: 'bubbleDel', id: this.aimBubble.id });
        break;
      case 'attract':
        if (L) {
          if (!this.attractA) {
            if (target?.obj) { this.attractA = target.obj.id; g.hud.flash('Now pick object B or a point'); }
          } else {
            if (target?.obj && target.obj.id !== this.attractA) g.send({ c: 'linkAdd', a: this.attractA, b: target.obj.id, G: this.cfg.attract.G });
            else if (this.aim) g.send({ c: 'linkAdd', a: this.attractA, point: [this.aim.point.x, this.aim.point.y, this.aim.point.z], G: this.cfg.attract.G });
            this.attractA = null;
          }
        }
        if (Rc) {
          if (this.attractA) this.attractA = null;
          else if (target?.obj) { g.send({ c: 'linkClear', id: target.obj.id }); g.hud.flash('Links removed'); }
        }
        break;
      case 'tk':
        if (L) {
          if (this.hold) this.release();
          else if (target) this.grab(target);
        }
        if (Rc) {
          if (this.hold) { g.send({ c: 'tkThrow', dir: [dir.x, dir.y, dir.z] }); this.hold = null; }
          else if (target) {
            const s = input.is('sprint') ? -1 : 1;
            g.send({ c: 'tkPush', id: target.obj?.id, player: target.player, dir: [dir.x * s, dir.y * s, dir.z * s] });
          }
        }
        break;
    }

    // telekinesis hold update (works in any power slot once grabbed)
    if (this.hold) {
      const meta = g.holdOf(g.slot);
      if (meta == null && this.hold.confirmed) this.hold = null;
      else {
        if (meta != null) { this.hold.confirmed = true; this.hold.id = meta; }
        const t = eye.clone().addScaledVector(dir, this.cfg.tk.dist);
        let rot = null;
        if (input.is('rotate')) {
          const q = player.getViewQuat(new THREE.Quaternion());
          const upA = new THREE.Vector3(0, 1, 0).applyQuaternion(q), rightA = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
          const w = upA.multiplyScalar(look.dx * 60).add(rightA.multiplyScalar(look.dy * 60));
          rot = [w.x, w.y, w.z];
        }
        this.tkAimTimer -= dt;
        if (g.isHostOrSolo || this.tkAimTimer <= 0 || rot) {
          g.send({ c: 'tkAim', target: [t.x, t.y, t.z], rot });
          this.tkAimTimer = 0.05;
        }
      }
    }

    // crush / expand
    const rs = input.hit('crush') ? 0.8 : input.hit('expand') ? 1.25 : 0;
    if (rs) {
      const id = this.hold?.id ?? target?.obj?.id;
      if (id != null) g.send({ c: 'tkResize', id, f: rs });
    }
    // edit aimed (F)
    if (input.hit('editTarget')) {
      if (this.aimBubble) {
        const c = this.cfg.bubble;
        g.send({ c: 'bubbleEdit', id: this.aimBubble.id, mode: c.mode === 'zero' ? 'zero' : (c.mode === 'in' || c.mode === 'out') ? c.mode : 'dir', dir: this.dirFromMode(c.mode, c.snap), s: c.mode === 'zero' ? 0 : c.g * G_EARTH });
        g.hud.flash('Bubble updated');
      } else if (target?.obj) this.applyObj([target.obj.id]);
    }
    // reset everything (hold)
    if (input.is('resetAll')) {
      this.resetHold += dt;
      if (this.resetHold > 1 && this.resetHold - dt <= 1) { g.send({ c: 'resetAll' }); player.personalG = null; g.hud.flash('All gravity reset'); }
    } else this.resetHold = 0;

    this.updateHighlights(target);
  }

  aimTarget() {
    if (!this.aim) return null;
    if (this.aim.obj) {
      const o = this.aim.obj;
      if (o.playerSlot != null) return { player: o.playerSlot, obj: null };
      return { obj: o };
    }
    if (this.aim.ref?.player != null && this.aim.ref.player !== 'local') return { player: this.aim.ref.player, obj: null };
    return null;
  }

  aimPoint(eye, dir, fallback) {
    if (this.aim && this.aim.dist < 60) return this.aim.point.clone().addScaledVector(this.aim.normal, 0.2);
    return eye.clone().addScaledVector(dir, fallback);
  }

  rayBubble(eye, dir) {
    let best = null, bestT = Infinity;
    for (const b of this.game.field.bubbles) {
      const oc = _v.copy(eye).sub(b.pos);
      const bq = oc.dot(dir);
      const c = oc.lengthSq() - b.r * b.r;
      const disc = bq * bq - c;
      if (disc < 0) continue;
      const s = Math.sqrt(disc);
      let t = -bq - s;
      if (t < 0) t = -bq + s;
      if (t < 0) continue;
      if (t < bestT) { bestT = t; best = b; }
    }
    if (best && this.aim && this.aim.dist < bestT - best.r * 2) return null;
    return best;
  }

  applyObj(ids) {
    const c = this.cfg.object;
    this.game.send({ c: 'objGrav', ids, dir: this.dirFromMode(c.mode, c.snap), s: c.mode === 'zero' ? 0 : c.g * G_EARTH, massMul: c.mass });
    if (ids.length === 1) this.game.hud.flash(c.mode === 'zero' ? 'Object: zero-g' : `Object: ${fmtG(c.g * G_EARTH)} · mass ×${c.mass}`);
  }

  grab(target) {
    const g = this.game;
    if (target.obj) {
      const o = target.obj;
      const m = g.pw.totalMass(o);
      const gv = g.field.at(g.pw.objPos(o, new THREE.Vector3()), new THREE.Vector3(), o.grav).length();
      if (m * gv > TK_LIMIT_KG * G_EARTH) {
        g.hud.flash(`Too heavy: ${fmtKg(m * gv / G_EARTH)} (limit ${TK_LIMIT_KG} kg) — lower its gravity first`, 'warn');
        return;
      }
      const d = g.player.getEye(new THREE.Vector3()).distanceTo(g.pw.objPos(o, _v));
      this.cfg.tk.dist = clamp(d, 1.8, 20);
      this.hold = { id: o.id, confirmed: false };
      g.send({ c: 'tkGrab', id: o.id, target: null });
    } else if (target.player != null) {
      this.cfg.tk.dist = 3;
      this.hold = { id: null, confirmed: false, player: target.player };
      g.send({ c: 'tkGrab', player: target.player });
    }
  }
  release() {
    this.game.send({ c: 'tkRelease' });
    this.hold = null;
  }

  updateHighlights(target) {
    const g = this.game;
    const want = new Map();
    const tkColor = COLORS.tk, gColor = COLORS.gravity;
    const p = this.power.id;
    if (this.hold?.id != null) want.set(this.hold.id, tkColor);
    if (target?.obj && ['object', 'scan', 'attract', 'tk'].includes(p)) want.set(target.obj.id, p === 'tk' ? tkColor : gColor);
    if (this.attractA != null) want.set(this.attractA, gColor);
    if (this.scan) {
      for (const o of g.pw.objects.values()) if (o.playerSlot == null && g.pw.objPos(o, _v).distanceTo(this.scan.center) <= this.scan.r) want.set(o.id, gColor);
    }
    for (const id of this.highlighted) if (!want.has(id)) { const o = g.pw.objects.get(id); if (o) g.pw.setHighlight(o, 0); }
    for (const [id, col] of want) {
      const o = g.pw.objects.get(id);
      if (o && o._hl !== col) { g.pw.setHighlight(o, col); o._hl = col; }
    }
    for (const id of this.highlighted) if (!want.has(id)) { const o = g.pw.objects.get(id); if (o) o._hl = 0; }
    this.highlighted = new Set(want.keys());
  }

  /** info about what is under the crosshair, for the HUD */
  targetInfo() {
    const t = this.aimTarget();
    const g = this.game;
    if (this.aimBubble && this.power.id === 'bubble') {
      const b = this.aimBubble;
      return { name: 'Bubble', lines: [b.mode === 'zero' ? 'zero-g' : b.mode === 'in' ? `pulls in ${fmtG(b.s)}` : b.mode === 'out' ? `pushes out ${fmtG(b.s)}` : fmtG(b.s), `radius ${b.r.toFixed(1)} m`] };
    }
    if (!t) {
      if (this.aim && ['body', 'world'].includes(this.power.id)) return { name: 'Surface', lines: [`${this.aim.dist.toFixed(1)} m away`] };
      return null;
    }
    if (t.player != null) return { name: g.playerName(t.player), lines: ['player'] };
    const o = t.obj;
    const m = g.pw.totalMass(o);
    const pos = g.pw.objPos(o, new THREE.Vector3());
    const gv = g.field.at(pos, new THREE.Vector3(), o.grav);
    const lv = g.pw.mainBody(o).linvel?.() || { x: 0, y: 0, z: 0 };
    const speed = Math.hypot(lv.x, lv.y, lv.z);
    const lines = [fmtKg(m) + ` · ${o.material}`, `gravity ${fmtG(gv.length())}${o.grav ? ' (custom)' : ''}`];
    if (speed > 0.2) lines.push(`${speed.toFixed(1)} m/s`);
    if (o.scale !== 1) lines.push(`size ×${o.scale.toFixed(2)}`);
    const heavy = m * gv.length() > TK_LIMIT_KG * G_EARTH;
    return { name: o.label, lines, heavy, held: this.hold?.id === o.id };
  }
}
