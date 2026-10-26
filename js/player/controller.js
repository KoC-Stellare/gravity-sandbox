import * as THREE from 'three';
import { PLAYER, G_EARTH } from '../config.js';
import { clamp } from '../util.js';

const Y = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);
const _g = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _qy = new THREE.Quaternion();
const _qp = new THREE.Quaternion();
const _qv = new THREE.Quaternion();

/**
 * First-person character controller with its own "down" direction (walls & ceilings).
 * Works in the authoritative world and in the client mirror world.
 */
export class PlayerController {
  constructor(R, pw, field) {
    this.R = R;
    this.pw = pw;
    this.field = field;
    const H = PLAYER.height, r = PLAYER.radius;
    this.halfH = H / 2;
    this.body = pw.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased());
    this.collider = pw.world.createCollider(R.ColliderDesc.capsule(H / 2 - r, r).setMass(PLAYER.mass), this.body);
    pw.colliderRef.set(this.collider.handle, { player: 'local' });
    this.cc = pw.world.createCharacterController(0.03);
    this.cc.setApplyImpulsesToDynamicBodies(true);
    this.cc.setCharacterMass(PLAYER.mass);
    this.cc.enableAutostep(0.45, 0.25, false);
    this.cc.enableSnapToGround(0.35);
    this.cc.setMaxSlopeClimbAngle(50 * Math.PI / 180);
    this.cc.setMinSlopeSlideAngle(55 * Math.PI / 180);
    this.center = new THREE.Vector3();
    this.frame = new THREE.Quaternion();   // orientation of the player's "up" frame
    this.yaw = 0; this.pitch = 0;
    this.vel = new THREE.Vector3();
    this.grounded = false;
    this.personalG = null;                 // { dir, s } body-gravity power
    this.crouch = 0;
    this.ragdolled = false;
    this.excluded = new Set();             // collider handles to ignore (held object, own ragdoll)
    this.walkPhase = 0;
    this.gravity = new THREE.Vector3(0, -G_EARTH, 0);
    this.noclip = false;
  }

  dispose() {
    this.pw.colliderRef.delete(this.collider.handle);
    this.pw.world.removeCharacterController(this.cc);
    this.pw.world.removeRigidBody(this.body);
  }

  get up() { return _a.copy(Y).applyQuaternion(this.frame); }
  getUp(out = new THREE.Vector3()) { return out.copy(Y).applyQuaternion(this.frame); }
  getFeet(out = new THREE.Vector3()) { return out.copy(this.center).addScaledVector(this.getUp(_b), -this.halfH); }
  /** Body orientation (frame + yaw) */
  getQuat(out = new THREE.Quaternion()) { return out.copy(this.frame).multiply(_qy.setFromAxisAngle(Y, this.yaw)); }
  getViewQuat(out = new THREE.Quaternion()) {
    return out.copy(this.frame).multiply(_qy.setFromAxisAngle(Y, this.yaw)).multiply(_qp.setFromAxisAngle(X, this.pitch));
  }
  getEye(out = new THREE.Vector3()) {
    return out.copy(this.center).addScaledVector(this.getUp(_b), this.halfH - 0.16 - this.crouch * 0.55);
  }
  getLookDir(out = new THREE.Vector3()) { return out.set(0, 0, -1).applyQuaternion(this.getViewQuat(_qv)); }

  teleport(feet, up = null, keepVel = false) {
    if (up) {
      const cur = this.getUp(_b);
      this.frame.premultiply(rotBetween(cur, up.clone().normalize(), this.frameRight()));
    }
    this.center.copy(feet).addScaledVector(this.getUp(_b), this.halfH);
    if (!keepVel) this.vel.set(0, 0, 0);
    this.body.setTranslation({ x: this.center.x, y: this.center.y, z: this.center.z }, true);
    this.body.setNextKinematicTranslation({ x: this.center.x, y: this.center.y, z: this.center.z });
  }

  frameRight() { return new THREE.Vector3(1, 0, 0).applyQuaternion(this.getQuat(_q)); }

  look(dx, dy) {
    this.yaw -= dx;
    this.pitch = clamp(this.pitch - dy, -1.55, 1.55);
  }

  /** Current gravity on the player (m/s²) */
  computeGravity(out = this.gravity) {
    if (this.personalG) return out.set(...this.personalG.dir).normalize().multiplyScalar(this.personalG.s);
    return this.field.at(this.center, out, null);
  }

  depenetrate(up) {
    const R = this.R;
    const ray = new R.Ray({ x: this.center.x, y: this.center.y, z: this.center.z }, { x: -up.x, y: -up.y, z: -up.z });
    const hit = this.pw.world.castRay(ray, this.halfH, false, R.QueryFilterFlags.EXCLUDE_DYNAMIC | R.QueryFilterFlags.EXCLUDE_SENSORS, undefined, this.collider, undefined,
      (col) => !this.excluded.has(col.handle));
    if (!hit) return;
    const d = hit.timeOfImpact ?? hit.toi;
    const pen = this.halfH - d;
    if (d > 0.05 && pen > 0.01) {
      this.center.addScaledVector(up, Math.min(pen, 0.5));
      this.body.setTranslation({ x: this.center.x, y: this.center.y, z: this.center.z }, true);
      const into = this.vel.dot(up);
      if (into < 0) this.vel.addScaledVector(up, -into);
    }
  }

  /**
   * @param {number} dt
   * @param {{x:number,z:number,jump:boolean,sprint:boolean,crouch:boolean,up:number}} inp
   */
  update(dt, inp) {
    if (this.ragdolled) return;
    dt = Math.min(dt, 0.05);
    const g = this.computeGravity();
    const gLen = g.length();
    const up = this.getUp(new THREE.Vector3());

    // 1) rotate the body toward the new "up" — speed scales with gravity strength
    if (gLen > 0.05) {
      const target = _g.copy(g).multiplyScalar(-1 / gLen);
      const angle = up.angleTo(target);
      if (angle > 0.0005) {
        const rate = (150 * Math.PI / 180) * Math.pow(clamp(gLen / G_EARTH, 0.08, 8), 0.6);
        const t = Math.min(1, (rate * dt) / angle);
        const full = rotBetween(up, target, this.frameRight());
        const part = _q.identity().slerp(full, t);
        this.frame.premultiply(part).normalize();
        this.getUp(up);
      }
    }
    // keep the feet out of the floor after turning (the capsule rotates around its center)
    if (gLen > 0.05) this.depenetrate(up);
    this.crouch = THREE.MathUtils.damp(this.crouch, inp.crouch && gLen > 0.05 ? 1 : 0, 12, dt);

    // 2) movement basis in the body frame
    const bodyQ = this.getQuat(new THREE.Quaternion());
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(bodyQ);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(bodyQ);

    if (gLen > 0.05) {
      const speed = inp.crouch ? PLAYER.crouch : inp.sprint ? PLAYER.sprint : PLAYER.walk;
      const wish = new THREE.Vector3().addScaledVector(fwd, inp.z).addScaledVector(right, inp.x);
      if (wish.lengthSq() > 1) wish.normalize();
      wish.multiplyScalar(speed);
      const vUp = up.clone().multiplyScalar(this.vel.dot(up));
      const vH = this.vel.clone().sub(vUp);
      const accel = this.grounded ? 55 : 9;
      const diff = wish.sub(vH);
      const maxDv = accel * dt;
      if (diff.length() > maxDv) diff.setLength(maxDv);
      vH.add(diff);
      this.vel.copy(vH).add(vUp);
      this.vel.addScaledVector(g, dt);
      if (this.grounded && inp.jump) {
        const into = this.vel.dot(up);
        if (into < 0) this.vel.addScaledVector(up, -into);
        this.vel.addScaledVector(up, PLAYER.jump);
        this.grounded = false;
      }
      const vh = vH.length();
      this.walkPhase += this.grounded ? vh * dt * 2.2 : 0;
      this.moveAmount = this.grounded ? clamp(vh / PLAYER.walk, 0, 1.3) : 0.2;
    } else {
      // zero gravity: float and drift, gentle thrusters
      const view = this.getViewQuat(new THREE.Quaternion());
      const f3 = new THREE.Vector3(0, 0, -1).applyQuaternion(view);
      const wish = new THREE.Vector3().addScaledVector(f3, inp.z).addScaledVector(right, inp.x).addScaledVector(up, inp.up);
      if (wish.lengthSq() > 1) wish.normalize();
      this.vel.addScaledVector(wish, 4 * dt);
      if (this.vel.length() > 8) this.vel.setLength(8);
      this.moveAmount = 0;
      this.grounded = false;
    }

    // 3) collide & slide
    const desired = this.vel.clone().multiplyScalar(dt);
    this.cc.setUp({ x: up.x, y: up.y, z: up.z });
    const R = this.R;
    this.cc.computeColliderMovement(this.collider, { x: desired.x, y: desired.y, z: desired.z },
      R.QueryFilterFlags.EXCLUDE_SENSORS, undefined, (col) => !this.excluded.has(col.handle));
    const m = this.cc.computedMovement();
    const moved = new THREE.Vector3(m.x, m.y, m.z);
    const blocked = desired.sub(moved);
    if (blocked.lengthSq() > 1e-10) this.vel.addScaledVector(blocked, -1 / dt);
    this.grounded = gLen > 0.05 && this.cc.computedGrounded();
    if (this.grounded) {
      const into = this.vel.dot(up);
      if (into < 0) this.vel.addScaledVector(up, -into);
    }
    this.center.add(moved);
    this.body.setNextKinematicTranslation({ x: this.center.x, y: this.center.y, z: this.center.z });
    this.body.setNextKinematicRotation({ x: this.frame.x, y: this.frame.y, z: this.frame.z, w: this.frame.w });
  }
}

/** Shortest rotation from a to b; for opposite vectors rotate around `axis` (a smooth flip). */
export function rotBetween(a, b, axis) {
  const d = a.dot(b);
  if (d < -0.9995) {
    const ax = axis.clone().sub(a.clone().multiplyScalar(axis.dot(a)));
    if (ax.lengthSq() < 1e-6) ax.set(1, 0, 0).sub(a.clone().multiplyScalar(a.x));
    return new THREE.Quaternion().setFromAxisAngle(ax.normalize(), Math.PI);
  }
  return new THREE.Quaternion().setFromUnitVectors(a, b);
}
