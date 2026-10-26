import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CATALOG, MATERIALS } from './catalog.js';
import { objectMaterial, gridMaterial } from '../render/materials.js';
import { MannequinVisual, createRagdoll, PARTS } from '../player/mannequin.js';
import { eulerDegToQuat, toV3 } from '../util.js';

const _c = new THREE.Color();

/** Build one merged geometry with vertex colors from a list of parts. */
export function buildPartsGeometry(parts, mainColor) {
  const geos = parts.map((p) => {
    let g;
    if (p.kind === 'box') g = new THREE.BoxGeometry(p.size[0], p.size[1], p.size[2]);
    else if (p.kind === 'ball') g = new THREE.SphereGeometry(p.size[0], 22, 14);
    else g = new THREE.CylinderGeometry(p.size[0], p.size[0], p.size[1], 22);
    if (p.rot) g.applyQuaternion(eulerDegToQuat(p.rot));
    g.translate(p.offset[0], p.offset[1], p.offset[2]);
    _c.set(p.c === 'main' || !p.c ? mainColor : p.c);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  });
  const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
  if (geos.length > 1) geos.forEach((g) => g.dispose());
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

function colliderForPart(R, p) {
  let cd;
  if (p.kind === 'box') cd = R.ColliderDesc.cuboid(Math.max(p.size[0] / 2, 0.005), Math.max(p.size[1] / 2, 0.005), Math.max(p.size[2] / 2, 0.005));
  else if (p.kind === 'ball') cd = R.ColliderDesc.ball(Math.max(p.size[0], 0.01));
  else cd = R.ColliderDesc.cylinder(Math.max(p.size[1] / 2, 0.005), Math.max(p.size[0], 0.01));
  cd.setTranslation(p.offset[0], p.offset[1], p.offset[2]);
  if (p.rot) { const q = eulerDegToQuat(p.rot); cd.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }); }
  return cd;
}

export function effectiveDensity(type, part, matName, massMul = 1) {
  const t = CATALOG[type];
  const mat = MATERIALS[matName] || MATERIALS.wood;
  let d;
  if (part.density) d = part.density;
  else if (t?.hollow) d = t.hollow * (mat.density / (MATERIALS[t.material]?.density || mat.density));
  else d = mat.density;
  return d * massMul;
}

/**
 * Wraps a Rapier world, the static map and dynamic objects.
 * mirror=true: objects are kinematic copies driven by network snapshots (client side).
 */
export class PhysicsWorld {
  constructor(R, scene, { mirror = false } = {}) {
    this.R = R;
    this.scene = scene;
    this.mirror = mirror;
    this.world = new R.World({ x: 0, y: 0, z: 0 });
    this.world.timestep = 1 / 120;
    this.objects = new Map();
    this.colliderRef = new Map(); // collider handle -> { obj, part } | { static } | { bound } | { player }
    this.nextId = 1;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.staticMeshes = [];
    this.bounds = { min: [-50, -5, -50], max: [50, 40, 50] };
  }

  dispose() {
    for (const o of [...this.objects.values()]) this.removeObject(o.id);
    this.root.removeFromParent();
    this.root.traverse((o) => o.geometry?.dispose());
    this.world.free();
  }

  // ---------- static map ----------
  buildStatic(map) {
    const R = this.R;
    this.bounds = map.bounds;
    const fixed = this.world.createRigidBody(R.RigidBodyDesc.fixed());
    this.fixedBody = fixed;
    const parts = [];
    for (const s of map.statics) {
      const q = eulerDegToQuat(s.rot || [0, 0, 0]);
      const cd = R.ColliderDesc.cuboid(s.size[0] / 2, s.size[1] / 2, s.size[2] / 2)
        .setTranslation(s.pos[0], s.pos[1], s.pos[2]).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        .setFriction(0.8).setRestitution(0.1);
      const col = this.world.createCollider(cd, fixed);
      this.colliderRef.set(col.handle, { static: true });
      if (!s.invisible) {
        const g = new THREE.BoxGeometry(s.size[0], s.size[1], s.size[2]);
        g.applyQuaternion(q);
        g.translate(s.pos[0], s.pos[1], s.pos[2]);
        _c.set(s.color || '#d0d5db');
        const n = g.attributes.position.count;
        const col3 = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { col3[i * 3] = _c.r; col3[i * 3 + 1] = _c.g; col3[i * 3 + 2] = _c.b; }
        g.setAttribute('color', new THREE.BufferAttribute(col3, 3));
        parts.push(g);
      }
    }
    // merge statics in chunks (fewer draw calls)
    for (let i = 0; i < parts.length; i += 200) {
      const merged = mergeGeometries(parts.slice(i, i + 200), false);
      const mesh = new THREE.Mesh(merged, gridMaterial({ vertexColors: true, cell: 1, strength: 0.18 }));
      mesh.receiveShadow = true; mesh.castShadow = true;
      this.root.add(mesh);
      this.staticMeshes.push(mesh);
    }
    parts.forEach((g) => g.dispose());
    // Invisible boundary walls + ceiling (stop infinite flight when gravity flips)
    const b = map.bounds, T = 2;
    const cx = (b.min[0] + b.max[0]) / 2, cy = (b.min[1] + b.max[1]) / 2, cz = (b.min[2] + b.max[2]) / 2;
    const sx = (b.max[0] - b.min[0]) / 2 + T * 2, sy = (b.max[1] - b.min[1]) / 2 + T * 2, sz = (b.max[2] - b.min[2]) / 2 + T * 2;
    const walls = [
      [cx, b.max[1] + T, cz, sx, T, sz], [cx, b.min[1] - T, cz, sx, T, sz],
      [b.max[0] + T, cy, cz, T, sy, sz], [b.min[0] - T, cy, cz, T, sy, sz],
      [cx, cy, b.max[2] + T, sx, sy, T], [cx, cy, b.min[2] - T, sx, sy, T],
    ];
    for (const w of walls) {
      const col = this.world.createCollider(R.ColliderDesc.cuboid(w[3], w[4], w[5]).setTranslation(w[0], w[1], w[2]).setFriction(0.6), fixed);
      this.colliderRef.set(col.handle, { bound: true, static: true });
    }
  }

  // ---------- dynamic objects ----------
  /**
   * def: { type, pos, rot(deg) | quat, size?, material?, color?, scale?, massMul?, grav? }
   */
  addObject(def, id = null, extra = {}) {
    const R = this.R;
    const t = CATALOG[def.type];
    if (!t) return null;
    id = id ?? this.nextId++;
    this.nextId = Math.max(this.nextId, id + 1);
    const obj = {
      id, type: def.type, label: t.label,
      size: (def.size || t.size).slice(),
      material: def.material || t.material,
      color: def.color || t.color,
      scale: def.scale ?? 1,
      massMul: def.massMul ?? 1,
      grav: def.grav || null,              // { dir:[x,y,z], s: m/s² }
      spawn: { pos: def.pos.slice(), rot: def.rot ? def.rot.slice() : null, quat: def.quat || null },
      bodies: [], colliders: [], mesh: null, visual: null,
      ragdoll: !!t.ragdoll, owner: extra.owner ?? null, playerSlot: extra.playerSlot ?? null,
      lastF: [],
    };
    const q = def.quat ? new THREE.Quaternion(...def.quat) : eulerDegToQuat(def.rot || [0, 0, 0]);
    const pos = toV3(def.pos);
    if (obj.ragdoll) {
      const rd = createRagdoll(R, this.world, pos, q, extra.vel, MATERIALS[obj.material], extra.playerSlot == null && !this.mirror);
      obj.bodies = rd.bodies; obj.colliders = rd.colliders; obj.joints = rd.joints;
      if (this.mirror) obj.bodies.forEach((b) => b.setBodyType(R.RigidBodyType.KinematicPositionBased, true));
      obj.colliders.forEach((c, i) => this.colliderRef.set(c.handle, { obj, part: i }));
      obj.visual = new MannequinVisual(obj.color);
      this.root.add(obj.visual.group);
      if (extra.hidden) obj.visual.setLayer(1);
    } else {
      const bd = (this.mirror ? R.RigidBodyDesc.kinematicPositionBased() : R.RigidBodyDesc.dynamic())
        .setTranslation(pos.x, pos.y, pos.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        .setCcdEnabled(true).setCanSleep(true);
      if (extra.vel) bd.setLinvel(extra.vel.x, extra.vel.y, extra.vel.z);
      const body = this.world.createRigidBody(bd);
      obj.bodies = [body];
      this.buildShape(obj);
    }
    this.objects.set(id, obj);
    return obj;
  }

  buildShape(obj) {
    const R = this.R;
    const t = CATALOG[obj.type];
    const body = obj.bodies[0];
    for (const c of obj.colliders) { this.colliderRef.delete(c.handle); this.world.removeCollider(c, true); }
    obj.colliders = [];
    const eff = obj.size.map((v) => v * obj.scale);
    const parts = t.parts(eff);
    const mat = MATERIALS[obj.material] || MATERIALS.wood;
    for (const p of parts) {
      const cd = colliderForPart(R, p)
        .setDensity(effectiveDensity(obj.type, p, obj.material, obj.massMul))
        .setFriction(mat.friction).setRestitution(mat.restitution);
      const col = this.world.createCollider(cd, body);
      this.colliderRef.set(col.handle, { obj, part: 0 });
      obj.colliders.push(col);
    }
    // air drag: light objects with large area slow down more
    const mass = body.mass();
    const area = eff[0] * eff[1] * 0.5 + eff[1] * eff[2] * 0.5;
    body.setLinearDamping(Math.min(2, Math.max(0.01, 0.4 * area / Math.max(mass, 0.01))));
    body.setAngularDamping(0.15);
    if (obj.mesh) { obj.mesh.geometry.dispose(); obj.mesh.removeFromParent(); obj.edges?.geometry.dispose(); }
    const geo = buildPartsGeometry(parts, obj.color);
    obj.mesh = new THREE.Mesh(geo, objectMaterial(0, obj.material));
    obj.mesh.castShadow = true; obj.mesh.receiveShadow = true;
    obj.mesh.userData.objId = obj.id;
    obj.edges = null;
    this.root.add(obj.mesh);
    obj.lastF = [];
    this.syncObject(obj);
  }

  removeObject(id) {
    const obj = this.objects.get(id);
    if (!obj) return;
    for (const c of obj.colliders) this.colliderRef.delete(c.handle);
    for (const j of obj.joints || []) this.world.removeImpulseJoint(j, true);
    for (const b of obj.bodies) this.world.removeRigidBody(b);
    if (obj.mesh) { obj.mesh.geometry.dispose(); obj.mesh.removeFromParent(); }
    obj.edges?.removeFromParent(); obj.edges?.geometry.dispose();
    obj.visual?.dispose();
    this.objects.delete(id);
  }

  /** Change scale / mass / material / color; keeps position and velocity. */
  updateObject(obj, changes) {
    Object.assign(obj, changes);
    if (obj.ragdoll) { if (changes.color) obj.visual.setColor(obj.color); return; }
    this.buildShape(obj);
    obj.bodies[0].wakeUp();
  }

  setHighlight(obj, color) {
    if (!obj) return;
    if (obj.ragdoll) { obj.visual.setHighlight(color || 0); return; }
    obj.mesh.material = objectMaterial(0, obj.material, color || 0);
    if (color) {
      if (!obj.edges) {
        obj.edges = new THREE.LineSegments(new THREE.EdgesGeometry(obj.mesh.geometry, 25), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95, depthTest: true }));
        obj.mesh.add(obj.edges);
      }
      obj.edges.material.color.set(color);
      obj.edges.visible = true;
    } else if (obj.edges) obj.edges.visible = false;
  }

  mainBody(obj) { return obj.ragdoll ? obj.bodies[1] : obj.bodies[0]; }
  totalMass(obj) { return obj.bodies.reduce((m, b) => m + b.mass(), 0); }
  objPos(obj, out = new THREE.Vector3()) { const t = this.mainBody(obj).translation(); return out.set(t.x, t.y, t.z); }

  syncObject(obj) {
    if (obj.ragdoll) { obj.visual.setFromBodies(obj.bodies); return; }
    const b = obj.bodies[0];
    const t = b.translation(), r = b.rotation();
    obj.mesh.position.set(t.x, t.y, t.z);
    obj.mesh.quaternion.set(r.x, r.y, r.z, r.w);
  }
  syncAll() { for (const o of this.objects.values()) this.syncObject(o); }

  /** Raycast. exclude: Set of collider handles. Returns {ref, obj, point, normal, dist, collider} */
  raycast(origin, dir, maxDist = 200, exclude = null, includeBounds = false) {
    const R = this.R;
    const ray = new R.Ray({ x: origin.x, y: origin.y, z: origin.z }, { x: dir.x, y: dir.y, z: dir.z });
    const hit = this.world.castRayAndGetNormal(ray, maxDist, true, undefined, undefined, undefined, undefined, (col) => {
      if (exclude && exclude.has(col.handle)) return false;
      if (col.isSensor && col.isSensor()) return false;
      const ref = this.colliderRef.get(col.handle);
      if (ref?.bound && !includeBounds) return false;
      return true;
    });
    if (!hit) return null;
    const toi = hit.timeOfImpact ?? hit.toi;
    const ref = this.colliderRef.get(hit.collider.handle) || {};
    return {
      ref, obj: ref.obj || null, part: ref.part ?? 0, collider: hit.collider, dist: toi,
      point: new THREE.Vector3(origin.x + dir.x * toi, origin.y + dir.y * toi, origin.z + dir.z * toi),
      normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z),
    };
  }

  /** Is position outside the map by a margin? */
  outside(p, margin = 25) {
    const b = this.bounds;
    return p.x < b.min[0] - margin || p.x > b.max[0] + margin || p.y < b.min[1] - margin || p.y > b.max[1] + margin || p.z < b.min[2] - margin || p.z > b.max[2] + margin;
  }

  countDynamic() { let n = 0; for (const o of this.objects.values()) if (o.playerSlot == null) n++; return n; }
}

export { PARTS };
