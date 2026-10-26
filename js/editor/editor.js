import * as THREE from 'three';
import { CATALOG, CATALOG_GROUPS, STATIC_TYPES, MATERIALS } from '../physics/catalog.js';
import { buildPartsGeometry } from '../physics/world.js';
import { gridMaterial, objectMaterial } from '../render/materials.js';
import { MannequinVisual } from '../player/mannequin.js';
import { eulerDegToQuat, quatToEulerDeg, clamp, round, Emitter } from '../util.js';
import { MAX_OBJECTS, MAX_STATICS, COLORS } from '../config.js';
import { h, $, clear, toast, modal, promptDialog } from '../ui/dom.js';
import { settings, keyLabel } from '../core/settings.js';
import { account } from '../net/supa.js';
import { sanitizeMap } from '../maps/defaults.js';

const TOOLS = [
  { id: 'spawn', label: 'Spawn', icon: '＋' }, { id: 'delete', label: 'Delete', icon: '✕' },
  { id: 'move', label: 'Move', icon: '✥' }, { id: 'rotate', label: 'Rotate', icon: '⟳' }, { id: 'scale', label: 'Scale', icon: '⤡' },
];
const CONVERTIBLE = ['box', 'plank', 'beam', 'crate', 'concrete', 'steelblock', 'foam'];

/** Build Map: singleplayer editor with spawn / delete / move / rotate / scale. */
export class Editor extends Emitter {
  constructor(renderer, input, game) {
    super();
    this.renderer = renderer;
    this.input = input;
    this.game = game;
    this.active = false;
    this.root = $('#editor');
    this.group = new THREE.Group();
    this.raycaster = new THREE.Raycaster();
  }

  open(map, { id = null } = {}) {
    this.map = sanitizeMap(structuredClone(map));
    this.mapId = id;
    this.active = true;
    this.dirty = false;
    this.tool = 'spawn';
    this.spawnType = { kind: 'object', type: 'box' };
    this.snap = true;
    this.selected = null;
    this.renderer.scene.add(this.group);
    this.renderer.setEnvironment({ outdoor: this.map.env === 'outdoor', bounds: this.map.bounds });
    this.renderer.setFov(settings.get('fov'));
    const sp = this.map.spawns[0] || [0, 1, 0];
    this.cam = { pos: new THREE.Vector3(sp[0], sp[1] + 6, sp[2] + 8), yaw: 0, pitch: -0.45 };
    this.rebuildAll();
    this.root.classList.remove('hidden');
    $('#menu').classList.add('hidden');
    this.renderUI();
    this.saveDraft();
  }

  close() {
    this.active = false;
    this.clearItems();
    this.group.removeFromParent();
    this.root.classList.add('hidden');
    this.input.unlock();
  }

  // ---------------------------------------------------------- items
  clearItems() {
    for (const it of this.items || []) { it.mesh.removeFromParent(); if (it.mesh.geometry && !it.shared) it.mesh.geometry.dispose(); }
    this.items = [];
  }
  rebuildAll() {
    this.clearItems();
    this.boundsBox?.removeFromParent();
    const b = this.map.bounds;
    const box = new THREE.Box3(new THREE.Vector3(...b.min), new THREE.Vector3(...b.max));
    this.boundsBox = new THREE.Box3Helper(box, 0x35d0e6);
    this.boundsBox.material.transparent = true; this.boundsBox.material.opacity = 0.35;
    this.group.add(this.boundsBox);
    this.map.statics.forEach((s) => this.makeItem('static', s));
    this.map.objects.forEach((o) => this.makeItem('object', o));
    this.spawnMarker?.removeFromParent();
    this.spawnMarker = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.9, 12), new THREE.MeshBasicMaterial({ color: COLORS.accent }));
    this.spawnMarker.rotation.x = Math.PI;
    this.group.add(this.spawnMarker);
    this.updateSpawnMarker();
  }
  updateSpawnMarker() { const s = this.map.spawns[0]; this.spawnMarker.position.set(s[0], s[1] + 0.6, s[2]); }

  makeItem(kind, data) {
    let mesh;
    if (kind === 'static') {
      mesh = new THREE.Mesh(new THREE.BoxGeometry(...data.size), gridMaterial({ color: data.color || '#cccccc', cell: 1, strength: 0.18 }));
      mesh.position.set(...data.pos);
      mesh.quaternion.copy(eulerDegToQuat(data.rot));
      if (data.invisible) { mesh.material = new THREE.MeshBasicMaterial({ color: 0x35d0e6, wireframe: true, transparent: true, opacity: 0.3 }); }
    } else if (data.type === 'mannequin') {
      const v = new MannequinVisual(data.color || CATALOG.mannequin.color);
      v.setStanding(new THREE.Vector3(...data.pos), eulerDegToQuat(data.rot));
      mesh = v.group;
      mesh.userData.visual = v;
    } else {
      const t = CATALOG[data.type];
      const size = (data.size || t.size).map((x) => x * (data.scale || 1));
      mesh = new THREE.Mesh(buildPartsGeometry(t.parts(size), data.color || t.color), objectMaterial(0, data.material || t.material));
      mesh.position.set(...data.pos);
      mesh.quaternion.copy(eulerDegToQuat(data.rot));
    }
    mesh.traverse((m) => { m.castShadow = true; m.receiveShadow = true; });
    const item = { kind, data, mesh };
    mesh.traverse((m) => (m.userData.item = item));
    this.group.add(mesh);
    this.items.push(item);
    return item;
  }

  refreshItem(item) {
    const idx = this.items.indexOf(item);
    item.mesh.removeFromParent();
    this.items.splice(idx, 1);
    const n = this.makeItem(item.kind, item.data);
    if (this.selected === item) this.select(n);
    return n;
  }

  removeItem(item) {
    const arr = item.kind === 'static' ? this.map.statics : this.map.objects;
    const i = arr.indexOf(item.data);
    if (i >= 0) arr.splice(i, 1);
    item.mesh.removeFromParent();
    this.items = this.items.filter((x) => x !== item);
    if (this.selected === item) this.select(null);
    this.changed();
  }

  select(item) {
    if (this.selHelper) { this.selHelper.removeFromParent(); this.selHelper = null; }
    this.selected = item;
    if (item) {
      this.selHelper = new THREE.BoxHelper(item.mesh, COLORS.gravity);
      this.group.add(this.selHelper);
    }
    this.renderSelection();
  }

  changed() {
    this.dirty = true;
    clearTimeout(this._draftT);
    this._draftT = setTimeout(() => this.saveDraft(), 800);
    this.renderCounts();
  }
  saveDraft() {
    try { localStorage.setItem('gs_draft', JSON.stringify({ id: this.mapId, map: this.map, t: Date.now() })); } catch { /* ignore */ }
  }

  // ---------------------------------------------------------- placement helpers
  halfExtentAlong(item, n) {
    if (item.kind === 'object' && item.data.type === 'mannequin') return n.y > 0.5 ? 0 : 0.3;
    const size = item.kind === 'static' ? item.data.size : (item.data.size || CATALOG[item.data.type].size).map((x) => x * (item.data.scale || 1));
    const q = eulerDegToQuat(item.data.rot);
    const ax = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)].map((v) => v.applyQuaternion(q));
    return 0.5 * (Math.abs(ax[0].dot(n)) * size[0] + Math.abs(ax[1].dot(n)) * size[1] + Math.abs(ax[2].dot(n)) * size[2]);
  }
  snapV(v, step = 0.5) { if (!this.snap) return v; return v.set(Math.round(v.x / step) * step, Math.round(v.y / step) * step, Math.round(v.z / step) * step); }

  mouseRay() {
    const r = this.renderer.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((this.input.mx - r.left) / r.width) * 2 - 1, -((this.input.my - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.renderer.camera);
    return this.raycaster;
  }
  pick(exclude = null) {
    const rc = this.mouseRay();
    const meshes = this.items.filter((i) => i !== exclude).map((i) => i.mesh);
    const hits = rc.intersectObjects(meshes, true);
    if (hits.length) {
      const hit = hits[0];
      const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
      return { item: hit.object.userData.item, point: hit.point, normal: n };
    }
    // ground plane fallback
    const pt = new THREE.Vector3();
    if (rc.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), pt)) return { item: null, point: pt, normal: new THREE.Vector3(0, 1, 0) };
    return null;
  }

  spawnAt(hit) {
    const st = this.spawnType;
    if (st.kind === 'object') {
      if (this.map.objects.length >= MAX_OBJECTS) { toast(`Limit reached: ${MAX_OBJECTS} dynamic objects`, 'warn'); return; }
      const t = CATALOG[st.type];
      const data = { type: st.type, pos: [0, 0, 0], rot: [0, round(this.cam.yaw * 180 / Math.PI, 1), 0], material: t.material, color: t.color };
      if (st.type !== 'mannequin') data.size = t.size.slice();
      const item = { kind: 'object', data };
      const p = hit.point.clone().addScaledVector(hit.normal, this.halfExtentAlong(item, hit.normal) + 0.01);
      if (st.type === 'mannequin') p.copy(hit.point).addScaledVector(hit.normal, 0.02);
      this.snapXZ(p);
      data.pos = [round(p.x, 3), round(p.y, 3), round(p.z, 3)];
      this.map.objects.push(data);
      this.select(this.makeItem('object', data));
    } else {
      if (this.map.statics.length >= MAX_STATICS) { toast(`Limit reached: ${MAX_STATICS} static pieces`, 'warn'); return; }
      const t = STATIC_TYPES[st.type];
      const data = { pos: [0, 0, 0], size: t.size.slice(), rot: (t.rot || [0, 0, 0]).slice(), color: t.color };
      data.rot[1] = this.snap ? Math.round(this.cam.yaw * 180 / Math.PI / 90) * 90 : round(this.cam.yaw * 180 / Math.PI, 1);
      const item = { kind: 'static', data };
      const p = hit.point.clone().addScaledVector(hit.normal, this.halfExtentAlong(item, hit.normal));
      this.snapXZ(p);
      data.pos = [round(p.x, 3), round(p.y, 3), round(p.z, 3)];
      this.map.statics.push(data);
      this.select(this.makeItem('static', data));
    }
    this.changed();
  }
  snapXZ(p) { if (this.snap) { p.x = Math.round(p.x * 2) / 2; p.z = Math.round(p.z * 2) / 2; } return p; }

  // ---------------------------------------------------------- frame
  update(dt) {
    if (!this.active) return;
    const inp = this.input;
    const typing = document.activeElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName);
    // look with right mouse (pointer lock while held)
    if (inp.mousePressed[2]) inp.lock();
    if (inp.mouseReleased[2]) inp.unlock();
    const look = inp.consumeMouse();
    if (inp.locked) {
      this.cam.yaw -= look.dx; this.cam.pitch = clamp(this.cam.pitch - look.dy, -1.55, 1.55);
    }
    // fly
    if (!typing) {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.cam.pitch, this.cam.yaw, 0, 'YXZ'));
      const f = new THREE.Vector3(0, 0, -1).applyQuaternion(q), r = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
      const sp = (inp.is('sprint') ? 24 : 9) * dt;
      const mv = new THREE.Vector3();
      if (inp.is('forward')) mv.add(f); if (inp.is('back')) mv.sub(f);
      if (inp.is('right')) mv.add(r); if (inp.is('left')) mv.sub(r);
      if (inp.is('jump')) mv.y += 1; if (inp.is('crouch')) mv.y -= 1;
      this.cam.pos.addScaledVector(mv, sp);
      // keys
      TOOLS.forEach((t, i) => { if (inp.hit('power' + (i + 1))) this.setTool(t.id); });
      if (inp.hit('spawnMenu')) this.openSpawnMenu();
      if (inp.hit('snap')) { this.snap = !this.snap; toast(`Grid snap ${this.snap ? 'on' : 'off'}`); this.renderUI(); }
      if (inp.hit('testMap')) this.test();
      if (inp.pressed.has('Delete') && this.selected) this.removeItem(this.selected);
    }
    const cam = this.renderer.camera;
    cam.position.copy(this.cam.pos);
    cam.quaternion.setFromEuler(new THREE.Euler(this.cam.pitch, this.cam.yaw, 0, 'YXZ'));

    // tools (left mouse, cursor free)
    const overCanvas = document.elementFromPoint(inp.mx, inp.my) === this.renderer.renderer.domElement;
    if (inp.mousePressed[0] && overCanvas && !inp.locked) this.toolDown();
    if (this.drag && inp.mouseDown[0]) this.toolDrag();
    if (this.drag && !inp.mouseDown[0]) { this.drag = null; this.renderSelection(); }
    this.selHelper?.update();
    // hover hint
    inp.consumeWheel();
  }

  toolDown() {
    const hit = this.pick();
    if (!hit) return;
    switch (this.tool) {
      case 'spawn': this.spawnAt(hit); break;
      case 'delete': if (hit.item) this.removeItem(hit.item); break;
      default:
        if (hit.item) {
          this.select(hit.item);
          this.drag = { item: hit.item, startX: this.input.mx, startY: this.input.my, rot0: hit.item.data.rot ? hit.item.data.rot.slice() : [0, 0, 0],
            size0: (hit.item.kind === 'static' ? hit.item.data.size : (hit.item.data.size || CATALOG[hit.item.data.type].size)).slice(),
            pos0: hit.item.data.pos.slice(), scale0: hit.item.data.scale || 1 };
        } else this.select(null);
    }
  }

  toolDrag() {
    const d = this.drag, it = d.item, data = it.data;
    const dx = this.input.mx - d.startX, dy = this.input.my - d.startY;
    if (this.tool === 'move') {
      if (this.input.is('sprint')) {
        const y = d.pos0[1] - dy * 0.03;
        data.pos[1] = round(this.snap ? Math.round(y * 2) / 2 : y, 3);
      } else {
        const hit = this.pick(it);
        if (!hit) return;
        const p = hit.point.clone().addScaledVector(hit.normal, this.halfExtentAlong(it, hit.normal) + (it.kind === 'object' ? 0.01 : 0));
        this.snapXZ(p);
        data.pos = [round(p.x, 3), round(p.y, 3), round(p.z, 3)];
      }
    } else if (this.tool === 'rotate') {
      const axis = this.input.is('sprint') ? 0 : 1;
      let a = d.rot0[axis] + dx * 0.6;
      if (this.snap) a = Math.round(a / 15) * 15;
      data.rot = d.rot0.slice(); data.rot[axis] = round(((a + 180) % 360 + 360) % 360 - 180, 2);
    } else if (this.tool === 'scale') {
      if (it.kind === 'object' && data.type === 'mannequin') return;
      const f = Math.exp(-dy * 0.01);
      let size = d.size0.map((x) => x * f);
      if (this.input.is('sprint')) size = [d.size0[0], d.size0[1] * f, d.size0[2]];
      if (this.snap) size = size.map((x) => Math.max(0.05, Math.round(x * 10) / 10));
      size = size.map((x) => clamp(round(x, 3), 0.02, it.kind === 'static' ? 400 : 30));
      data.size = size;
    }
    const n = this.refreshItem(it);
    d.item = n;
    this.changed();
  }

  setTool(t) { this.tool = t; this.renderUI(); }

  // ---------------------------------------------------------- actions
  async save() {
    if (!account.loggedIn) { toast('Log in to save maps to your account (a local draft is kept)', 'warn'); this.emit('need-login'); return false; }
    let name = this.map.name;
    if (!this.mapId) {
      name = await promptDialog('Save map', 'Map name', name === 'Flat Plain' || name === 'Closed Room' ? 'My map' : name);
      if (!name) return false;
      this.map.name = name;
    }
    try {
      this.mapId = await account.saveMap({ id: this.mapId, name: this.map.name, data: this.map });
      this.dirty = false;
      this.saveDraft();
      toast('Map saved to your account');
      this.renderUI();
      return true;
    } catch (e) { toast('Save failed: ' + e.message, 'warn'); return false; }
  }

  test() {
    this.emit('test', structuredClone(this.map));
  }

  exit() {
    if (this.dirty && !confirm('Leave without saving? A local draft is kept.')) return;
    this.close();
    this.emit('exit');
  }

  // ---------------------------------------------------------- UI
  renderUI() {
    const b = settings.get('bindings');
    clear(this.root).append(
      h('div.ed-top',
        h('div.ed-title', h('b', 'Build Map'), h('input.ed-name', { value: this.map.name, maxLength: 40, onchange: (e) => { this.map.name = e.target.value || 'Untitled'; this.changed(); } })),
        h('div.ed-tools', TOOLS.map((t, i) => h('button' + (this.tool === t.id ? '.on' : ''), { onclick: () => this.setTool(t.id), title: `${t.label} (${keyLabel(b['power' + (i + 1)])})` },
          h('span', t.icon), t.label, h('kbd', keyLabel(b['power' + (i + 1)]))))),
        h('div.ed-actions',
          h('button.btn', { onclick: () => this.openSpawnMenu() }, `Spawn menu (${keyLabel(b.spawnMenu)})`),
          h('button.btn' + (this.snap ? '.on' : ''), { onclick: () => { this.snap = !this.snap; this.renderUI(); } }, `Snap ${this.snap ? 'on' : 'off'} (${keyLabel(b.snap)})`),
          h('button.btn.accent', { onclick: () => this.test() }, `▶ Test (${keyLabel(b.testMap)})`),
          h('button.btn.primary', { onclick: () => this.save() }, 'Save'),
          h('button.btn', { onclick: () => this.exit() }, 'Exit'))),
      h('div.ed-side',
        h('div.ed-card#ed-sel'),
        h('div.ed-card',
          h('h4', 'Map'),
          h('div.ed-counts#ed-counts'),
          h('label.pp-row', h('span', 'Default gravity'), h('input', { type: 'range', min: 0, max: 3, step: 0.01, value: this.map.gravity.s / 9.81,
            oninput: (e) => { this.map.gravity.s = round(+e.target.value * 9.81, 3); e.target.nextSibling.textContent = (+e.target.value).toFixed(2) + ' g'; this.changed(); } }), h('b', (this.map.gravity.s / 9.81).toFixed(2) + ' g')),
          h('button.btn.small', { onclick: () => { const p = this.cam.pos; const hit = this.downHit(p); this.map.spawns[0] = [round(hit.x, 2), round(hit.y, 2), round(hit.z, 2)]; this.updateSpawnMarker(); this.changed(); toast('Spawn point set'); } }, 'Set spawn point below camera'),
          h('p.small', `Env: ${this.map.env === 'outdoor' ? 'open sky with invisible ceiling' : 'closed room'}`)),
        h('div.ed-card.help',
          h('h4', 'Controls'),
          h('p', 'Right mouse + drag: look · WASD fly · Space/C up/down · Shift faster'),
          h('p', 'Left click: use tool · Move: drag (Shift = up/down) · Rotate: drag (Shift = tilt) · Scale: drag up/down (Shift = height only)'),
          h('p', 'Delete key: delete selected'))),
    );
    this.renderSelection();
    this.renderCounts();
    const fit = () => { const top = this.root.querySelector('.ed-top'), side = this.root.querySelector('.ed-side'); if (top && side) side.style.top = (top.offsetTop + top.offsetHeight + 10) + 'px'; };
    requestAnimationFrame(fit);
    if (!this._fitBound) { this._fitBound = true; window.addEventListener('resize', () => this.active && fit()); }
  }

  downHit(p) {
    this.raycaster.set(p, new THREE.Vector3(0, -1, 0));
    const hits = this.raycaster.intersectObjects(this.items.filter((i) => i.kind === 'static').map((i) => i.mesh), true);
    return hits[0]?.point || new THREE.Vector3(p.x, 0, p.z);
  }

  renderCounts() {
    const c = $('#ed-counts');
    if (c) c.innerHTML = `<span>Dynamic objects <b>${this.map.objects.length}/${MAX_OBJECTS}</b></span><span>Static pieces <b>${this.map.statics.length}/${MAX_STATICS}</b></span>${this.dirty ? '<em>unsaved changes</em>' : ''}`;
  }

  renderSelection() {
    const el = $('#ed-sel');
    if (!el) return;
    clear(el);
    const it = this.selected;
    if (!it) {
      const st = this.spawnType;
      el.append(h('h4', 'Spawning'), h('p', st.kind === 'object' ? CATALOG[st.type].label : STATIC_TYPES[st.type].label + ' (static)'),
        h('p.small', 'Click an item with Move / Rotate / Scale to select it.'));
      return;
    }
    const d = it.data;
    const isObj = it.kind === 'object';
    const label = isObj ? CATALOG[d.type].label : 'Static piece';
    const vecInputs = (key, step, onSet) => h('div.vec3', [0, 1, 2].map((i) => h('input', { type: 'number', step, value: (d[key] || [0, 0, 0])[i],
      onchange: (e) => { const v = (d[key] || [0, 0, 0]).slice(); v[i] = +e.target.value; onSet(v); } })));
    const apply = () => { this.selected = this.refreshItem(it); this.changed(); };
    el.append(
      h('h4', label),
      h('label.field', h('span', 'Position'), vecInputs('pos', 0.1, (v) => { d.pos = v; apply(); })),
      h('label.field', h('span', 'Rotation (°)'), vecInputs('rot', 5, (v) => { d.rot = v; apply(); })),
      !(isObj && d.type === 'mannequin') ? h('label.field', h('span', 'Size (m)'), h('div.vec3', [0, 1, 2].map((i) => h('input', { type: 'number', step: 0.1, min: 0.02,
        value: (d.size || CATALOG[d.type]?.size)[i], onchange: (e) => { const v = (d.size || CATALOG[d.type].size).slice(); v[i] = clamp(+e.target.value, 0.02, isObj ? 30 : 400); d.size = v; apply(); } })))) : null,
      isObj && d.type !== 'mannequin' ? h('label.field', h('span', 'Material'), h('select', { onchange: (e) => { d.material = e.target.value; apply(); } },
        Object.entries(MATERIALS).map(([k, m]) => h('option', { value: k, selected: (d.material || CATALOG[d.type].material) === k }, `${m.label} (${m.density} kg/m³)`)))) : null,
      h('label.field', h('span', 'Color'), h('input', { type: 'color', value: d.color || (isObj ? CATALOG[d.type].color : '#cccccc'), oninput: (e) => { d.color = e.target.value; apply(); } })),
      (isObj ? CONVERTIBLE.includes(d.type) : true) ? h('label.pp-check', h('input', { type: 'checkbox', checked: !isObj, onchange: () => this.toggleStatic(it) }),
        'Static (part of the map, never falls)') : h('p.small', 'Dynamic physics object'),
      h('div.row-btns',
        h('button.btn.small', { onclick: () => this.duplicate(it) }, 'Duplicate'),
        h('button.btn.small.danger', { onclick: () => this.removeItem(it) }, 'Delete')),
    );
  }

  toggleStatic(it) {
    const d = it.data;
    if (it.kind === 'object') {
      if (this.map.statics.length >= MAX_STATICS) return toast('Static limit reached', 'warn');
      const size = (d.size || CATALOG[d.type].size).map((x) => x * (d.scale || 1));
      const s = { pos: d.pos.slice(), size, rot: (d.rot || [0, 0, 0]).slice(), color: d.color || CATALOG[d.type].color };
      this.removeItem(it);
      this.map.statics.push(s);
      this.select(this.makeItem('static', s));
    } else {
      if (this.map.objects.length >= MAX_OBJECTS) return toast(`Limit reached: ${MAX_OBJECTS} dynamic objects`, 'warn');
      const o = { type: 'box', pos: d.pos.slice(), size: d.size.slice(), rot: (d.rot || [0, 0, 0]).slice(), color: d.color, material: 'wood' };
      this.removeItem(it);
      this.map.objects.push(o);
      this.select(this.makeItem('object', o));
    }
    this.changed();
  }

  duplicate(it) {
    const d = structuredClone(it.data);
    d.pos[0] += 0.5; d.pos[2] += 0.5;
    if (it.kind === 'object') {
      if (this.map.objects.length >= MAX_OBJECTS) return toast(`Limit reached: ${MAX_OBJECTS} dynamic objects`, 'warn');
      this.map.objects.push(d);
    } else {
      if (this.map.statics.length >= MAX_STATICS) return toast('Static limit reached', 'warn');
      this.map.statics.push(d);
    }
    this.select(this.makeItem(it.kind, d));
    this.changed();
  }

  openSpawnMenu() {
    this.input.unlock();
    const pick = (st) => { this.spawnType = st; this.setTool('spawn'); m.close(); };
    const body = h('div.spawn-menu',
      CATALOG_GROUPS.map((g) => h('div', h('h4', g), h('div.spawn-grid',
        Object.entries(CATALOG).filter(([, t]) => t.group === g).map(([k, t]) =>
          h('button.spawn-item' + (this.spawnType.type === k ? '.on' : ''), { onclick: () => pick({ kind: 'object', type: k }) },
            h('i', { style: { background: t.color } }), t.label))))),
      h('div', h('h4', 'Static pieces (map structure)'), h('div.spawn-grid',
        Object.entries(STATIC_TYPES).map(([k, t]) => h('button.spawn-item' + (this.spawnType.type === k ? '.on' : ''), { onclick: () => pick({ kind: 'static', type: k }) },
          h('i', { style: { background: t.color } }), t.label)))));
    const m = modal('Spawn menu', body);
  }
}
