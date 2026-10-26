import * as THREE from 'three';
import { COLORS } from '../config.js';

const sphereGeo = new THREE.SphereGeometry(1, 40, 20);

function fieldMaterial(color, opacity = 0.16) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { color: { value: new THREE.Color(color) }, opacity: { value: opacity }, time: { value: 0 } },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){ vec4 wp = modelMatrix * vec4(position,1.0); vP = position; vN = normalize(mat3(modelMatrix)*normal);
      vV = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: `uniform vec3 color; uniform float opacity; uniform float time; varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){ float f = 1.0 - abs(dot(normalize(vN), normalize(vV))); f = pow(f, 2.2);
      float bands = 0.5 + 0.5 * sin(vP.y * 14.0 - time * 2.0);
      float a = opacity * (0.25 + f * 2.2) + bands * 0.025;
      gl_FragColor = vec4(color * (0.8 + f), clamp(a, 0.0, 0.85)); }`,
  });
}

/** Draws bubbles, attraction links, scan sphere and bubble preview. */
export class GravityVisuals {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.bubbles = new Map();
    this.links = new Map();
    this.scanMesh = new THREE.Mesh(sphereGeo, fieldMaterial(COLORS.gravity, 0.12));
    this.draftMesh = new THREE.Mesh(sphereGeo, fieldMaterial(COLORS.gravity, 0.2));
    this.group.add(this.scanMesh, this.draftMesh);
    this.time = 0;
  }

  update(dt, field, links, pw, powers) {
    this.time += dt;
    // bubbles
    const seen = new Set();
    for (const b of field.bubbles) {
      seen.add(b.id);
      let v = this.bubbles.get(b.id);
      if (!v) {
        const mesh = new THREE.Mesh(sphereGeo, fieldMaterial(COLORS.gravity));
        const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, -1, 0), new THREE.Vector3(), 1, COLORS.gravity, 0.35, 0.22);
        const g = new THREE.Group(); g.add(mesh, arrow);
        this.group.add(g);
        v = { g, mesh, arrow };
        this.bubbles.set(b.id, v);
      }
      v.g.position.copy(b.pos);
      v.mesh.scale.setScalar(b.r);
      v.mesh.material.uniforms.time.value = this.time;
      const aim = powers?.aimBubble === b;
      v.mesh.material.uniforms.opacity.value = aim ? 0.3 : 0.15;
      if (b.mode === 'dir' && b.s > 0) {
        v.arrow.visible = true;
        v.arrow.setDirection(new THREE.Vector3(...b.dir).normalize());
        const len = Math.min(b.r * 0.8, 0.6 + b.s / 9.81 * 0.5);
        v.arrow.setLength(len, Math.min(0.4, len * 0.4), Math.min(0.25, len * 0.25));
      } else v.arrow.visible = false;
      v.mesh.material.uniforms.color.value.set(b.mode === 'zero' || b.s === 0 ? 0x9fe8ff : b.mode === 'out' ? 0xb48cff : COLORS.gravity);
    }
    for (const [id, v] of this.bubbles) if (!seen.has(id)) { v.g.removeFromParent(); v.mesh.material.dispose(); this.bubbles.delete(id); }

    // links
    const lseen = new Set();
    for (const l of links) {
      const A = pw.objects.get(l.a);
      const B = l.b != null ? pw.objects.get(l.b) : null;
      if (!A) continue;
      lseen.add(l.id);
      let v = this.links.get(l.id);
      if (!v) {
        const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
        const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: COLORS.gravity, transparent: true, opacity: 0.8 }));
        line.frustumCulled = false;
        this.group.add(line);
        v = { line };
        this.links.set(l.id, v);
      }
      const pa = pw.objPos(A, new THREE.Vector3());
      const pb = B ? pw.objPos(B, new THREE.Vector3()) : new THREE.Vector3(...l.point);
      const pos = v.line.geometry.attributes.position;
      pos.setXYZ(0, pa.x, pa.y, pa.z); pos.setXYZ(1, pb.x, pb.y, pb.z); pos.needsUpdate = true;
      v.line.material.opacity = 0.45 + 0.4 * Math.sin(this.time * 6 + l.id);
    }
    for (const [id, v] of this.links) if (!lseen.has(id)) { v.line.removeFromParent(); v.line.geometry.dispose(); this.links.delete(id); }

    // scan & draft
    const s = powers?.scan;
    this.scanMesh.visible = !!s;
    if (s) { this.scanMesh.position.copy(s.center); this.scanMesh.scale.setScalar(s.r); this.scanMesh.material.uniforms.time.value = this.time; }
    const d = powers?.bubbleDraft;
    this.draftMesh.visible = !!d;
    if (d) { this.draftMesh.position.copy(d.center); this.draftMesh.scale.setScalar(d.r); this.draftMesh.material.uniforms.time.value = this.time; }
  }

  clear() {
    for (const v of this.bubbles.values()) v.g.removeFromParent();
    for (const v of this.links.values()) v.line.removeFromParent();
    this.bubbles.clear(); this.links.clear();
  }
  dispose() { this.clear(); this.group.removeFromParent(); }
}
