import * as THREE from 'three';

export const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const toV3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
export const arr3 = (v) => [round(v.x), round(v.y), round(v.z)];
export const arr4 = (q) => [q.x, q.y, q.z, q.w];
export const round = (n, d = 4) => Math.round(n * 10 ** d) / 10 ** d;
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const rv = (o) => ({ x: o.x, y: o.y, z: o.z }); // Rapier vector
export const DEG = Math.PI / 180;

export function eulerDegToQuat(rot = [0, 0, 0]) {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0] * DEG, rot[1] * DEG, rot[2] * DEG, 'YXZ'));
}
export function quatToEulerDeg(q) {
  const e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
  return [round(e.x / DEG, 2), round(e.y / DEG, 2), round(e.z / DEG, 2)];
}

/** Snap a direction to the nearest world axis. */
export function snapAxis(v) {
  const a = [Math.abs(v.x), Math.abs(v.y), Math.abs(v.z)];
  const i = a.indexOf(Math.max(...a));
  const out = v3();
  out.setComponent(i, Math.sign(v.getComponent(i)) || 1);
  return out;
}

export function randomCode(len = 6) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  const buf = crypto.getRandomValues(new Uint32Array(len));
  for (let i = 0; i < len; i++) s += chars[buf[i] % chars.length];
  return s;
}

export function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** Tiny event emitter */
export class Emitter {
  constructor() { this._h = {}; }
  on(e, f) { (this._h[e] ||= []).push(f); return () => this.off(e, f); }
  off(e, f) { this._h[e] = (this._h[e] || []).filter((x) => x !== f); }
  emit(e, ...a) { (this._h[e] || []).slice().forEach((f) => f(...a)); }
}

export function fmtG(ms2) {
  const g = ms2 / 9.81;
  return (g < 0.095 && g > 0) ? g.toFixed(2) + ' g' : g.toFixed(g < 10 ? 2 : 1).replace(/\.?0+$/, '') + ' g';
}
export function fmtKg(kg) {
  if (kg >= 1000) return (kg / 1000).toFixed(kg >= 10000 ? 0 : 1) + ' t';
  if (kg >= 10) return kg.toFixed(0) + ' kg';
  return kg.toFixed(kg >= 1 ? 1 : 2) + ' kg';
}
export function dirName(d) {
  if (!d) return '';
  const ax = [['+X', 'right'], ['-X', 'left']];
  const v = toV3(d).normalize();
  if (v.y < -0.98) return '↓';
  if (v.y > 0.98) return '↑';
  if (Math.abs(v.y) < 0.02) return '→';
  return v.y < 0 ? '↘' : '↗';
}
