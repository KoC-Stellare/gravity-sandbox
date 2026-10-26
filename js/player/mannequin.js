import * as THREE from 'three';
import { gridMaterial } from '../render/materials.js';

// Mannequin layout, standing with feet at origin, facing +Z. Units: meters.
export const PARTS = [
  { name: 'pelvis', kind: 'box', size: [0.32, 0.2, 0.2], pos: [0, 0.98, 0] },
  { name: 'torso', kind: 'box', size: [0.36, 0.42, 0.22], pos: [0, 1.31, 0] },
  { name: 'head', kind: 'ball', r: 0.12, pos: [0, 1.66, 0] },
  { name: 'uArmL', kind: 'cap', hh: 0.12, r: 0.05, pos: [-0.245, 1.33, 0] },
  { name: 'lArmL', kind: 'cap', hh: 0.12, r: 0.045, pos: [-0.245, 1.03, 0] },
  { name: 'uArmR', kind: 'cap', hh: 0.12, r: 0.05, pos: [0.245, 1.33, 0] },
  { name: 'lArmR', kind: 'cap', hh: 0.12, r: 0.045, pos: [0.245, 1.03, 0] },
  { name: 'uLegL', kind: 'cap', hh: 0.16, r: 0.07, pos: [-0.1, 0.66, 0] },
  { name: 'lLegL', kind: 'cap', hh: 0.15, r: 0.06, pos: [-0.1, 0.24, 0] },
  { name: 'uLegR', kind: 'cap', hh: 0.16, r: 0.07, pos: [0.1, 0.66, 0] },
  { name: 'lLegR', kind: 'cap', hh: 0.15, r: 0.06, pos: [0.1, 0.24, 0] },
];
// joints: [partA, partB, worldAnchor, type, limits]
export const JOINTS = [
  [0, 1, [0, 1.09, 0], 'sph'],
  [1, 2, [0, 1.54, 0], 'sph'],
  [1, 3, [-0.245, 1.48, 0], 'sph'],
  [3, 4, [-0.245, 1.18, 0], 'rev', [-2.5, 0]],
  [1, 5, [0.245, 1.48, 0], 'sph'],
  [5, 6, [0.245, 1.18, 0], 'rev', [-2.5, 0]],
  [0, 7, [-0.1, 0.87, 0], 'sph'],
  [7, 8, [-0.1, 0.45, 0], 'rev', [0, 2.5]],
  [0, 9, [0.1, 0.87, 0], 'sph'],
  [9, 10, [0.1, 0.45, 0], 'rev', [0, 2.5]],
];
export const TORSO = 1;
export const HEAD = 2;
const DENSITY = 860; // ≈ 75 kg total

const geoCache = {};
function partGeometry(p) {
  const key = p.name;
  if (geoCache[key]) return geoCache[key];
  let g;
  if (p.kind === 'box') g = new THREE.BoxGeometry(...p.size);
  else if (p.kind === 'ball') g = new THREE.SphereGeometry(p.r, 18, 12);
  else g = new THREE.CapsuleGeometry(p.r, p.hh * 2, 4, 10);
  return (geoCache[key] = g);
}

/** Visual mannequin (meshes only). */
export class MannequinVisual {
  constructor(color = '#e6dccf') {
    this.group = new THREE.Group();
    this.meshes = PARTS.map((p) => {
      const m = new THREE.Mesh(partGeometry(p), gridMaterial({ color, local: true, cell: 0.5, strength: 0.08, roughness: 0.6 }));
      m.castShadow = true; m.receiveShadow = true;
      m.userData.part = p;
      this.group.add(m);
      return m;
    });
    // joint dots
    this.color = color;
    this._q = new THREE.Quaternion();
  }
  setColor(color) {
    if (color === this.color) return;
    this.color = color;
    for (const m of this.meshes) m.material = gridMaterial({ color, local: true, cell: 0.5, strength: 0.08, roughness: 0.6 });
  }
  setLayer(layer) { this.group.traverse((o) => o.layers.set(layer)); }
  setHighlight(on) {
    for (const m of this.meshes) {
      m.material = gridMaterial({ color: this.color, local: true, cell: 0.5, strength: 0.08, roughness: 0.6, emissive: on ? on : 0, emissiveIntensity: on ? 0.35 : 1 });
    }
  }

  /** Physics driven: transforms of each part body (world space). */
  setFromBodies(bodies) {
    this.group.position.set(0, 0, 0); this.group.quaternion.identity();
    bodies.forEach((b, i) => {
      const t = b.translation(), r = b.rotation();
      this.meshes[i].position.set(t.x, t.y, t.z);
      this.meshes[i].quaternion.set(r.x, r.y, r.z, r.w);
    });
  }
  /** Network driven: arrays of [x,y,z,qx,qy,qz,qw] per part. */
  setFromArrays(arrs) {
    this.group.position.set(0, 0, 0); this.group.quaternion.identity();
    arrs.forEach((a, i) => {
      if (!a) return;
      this.meshes[i].position.set(a[0], a[1], a[2]);
      this.meshes[i].quaternion.set(a[3], a[4], a[5], a[6]);
    });
  }

  /** Procedural standing / walking pose. feet = world position of feet, quat = body orientation. */
  setStanding(feet, quat, phase = 0, amount = 0, crouch = 0) {
    this.group.position.copy(feet);
    this.group.quaternion.copy(quat);
    const swing = Math.sin(phase) * 0.6 * amount;
    const dip = crouch * 0.35;
    PARTS.forEach((p, i) => {
      const m = this.meshes[i];
      m.position.set(p.pos[0], p.pos[1] - (p.pos[1] > 0.9 ? dip : 0), p.pos[2]);
      m.quaternion.identity();
    });
    const rot = (i, pivotY, angle) => {
      const m = this.meshes[i];
      const p = PARTS[i];
      const q = this._q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), angle);
      const off = new THREE.Vector3(0, p.pos[1] - pivotY, 0).applyQuaternion(q);
      m.position.set(p.pos[0], pivotY + off.y, off.z);
      m.quaternion.copy(q);
    };
    rot(7, 0.87, swing - crouch * 0.8); rot(9, 0.87, -swing - crouch * 0.8);
    // lower legs follow
    const legFollow = (iu, il, s) => {
      const up = this.meshes[iu];
      const knee = new THREE.Vector3(0, -0.21, 0).applyQuaternion(up.quaternion).add(up.position);
      const bend = Math.max(0, -s) * 0.9 + crouch * 1.4;
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), bend).premultiply(up.quaternion);
      const off = new THREE.Vector3(0, -0.21, 0).applyQuaternion(q);
      this.meshes[il].position.copy(knee).add(off);
      this.meshes[il].quaternion.copy(q);
    };
    legFollow(7, 8, swing); legFollow(9, 10, -swing);
    rot(3, 1.48, -swing * 0.8); rot(5, 1.48, swing * 0.8);
    const armFollow = (iu, il) => {
      const up = this.meshes[iu];
      const elbow = new THREE.Vector3(0, -0.15, 0).applyQuaternion(up.quaternion).add(up.position);
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.25 - amount * 0.3).premultiply(up.quaternion);
      this.meshes[il].position.copy(elbow).add(new THREE.Vector3(0, -0.15, 0).applyQuaternion(q));
      this.meshes[il].quaternion.copy(q);
    };
    armFollow(3, 4); armFollow(5, 6);
    // apply group transform to children so all parts are in world space (keeps one code path for outlines)
  }

  dispose() { this.group.removeFromParent(); }
}

/**
 * Create a physics ragdoll in a Rapier world.
 * @returns {{bodies, colliders, joints}}
 */
export function createRagdoll(R, world, feet, quat, vel, material = { friction: 0.7, restitution: 0.1 }, sleeping = false) {
  const bodies = [], colliders = [], joints = [];
  const tmp = new THREE.Vector3();
  PARTS.forEach((p) => {
    tmp.set(...p.pos).applyQuaternion(quat).add(feet);
    const bd = R.RigidBodyDesc.dynamic().setTranslation(tmp.x, tmp.y, tmp.z)
      .setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w })
      .setLinearDamping(0.05).setAngularDamping(1.6).setCcdEnabled(true).setSleeping(sleeping);
    if (vel) bd.setLinvel(vel.x, vel.y, vel.z);
    const body = world.createRigidBody(bd);
    let cd;
    if (p.kind === 'box') cd = R.ColliderDesc.cuboid(p.size[0] / 2, p.size[1] / 2, p.size[2] / 2);
    else if (p.kind === 'ball') cd = R.ColliderDesc.ball(p.r);
    else cd = R.ColliderDesc.capsule(p.hh, p.r);
    cd.setDensity(DENSITY).setFriction(material.friction).setRestitution(material.restitution);
    colliders.push(world.createCollider(cd, body));
    bodies.push(body);
  });
  for (const [a, b, anchor, type, lim] of JOINTS) {
    const pa = PARTS[a].pos, pb = PARTS[b].pos;
    const a1 = { x: anchor[0] - pa[0], y: anchor[1] - pa[1], z: anchor[2] - pa[2] };
    const a2 = { x: anchor[0] - pb[0], y: anchor[1] - pb[1], z: anchor[2] - pb[2] };
    let data;
    if (type === 'rev') {
      data = R.JointData.revolute(a1, a2, { x: 1, y: 0, z: 0 });
      data.limitsEnabled = true;
      data.limits = lim;
    } else {
      data = R.JointData.spherical(a1, a2);
    }
    const j = world.createImpulseJoint(data, bodies[a], bodies[b], true);
    j.setContactsEnabled?.(false);
    joints.push(j);
  }
  return { bodies, colliders, joints };
}
