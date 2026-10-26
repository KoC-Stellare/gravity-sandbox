import * as THREE from 'three';

const SKY_TOP = new THREE.Color('#4f8fd0');
const SKY_HORIZON = new THREE.Color('#d6e6f2');
const INDOOR_BG = new THREE.Color('#c9d2db');

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(78, 1, 0.05, 1500);
    this.camera.layers.enable(0);
    this.scene.add(this.camera);

    // Lights
    this.hemi = new THREE.HemisphereLight(0xdbeaff, 0x8a8f96, 1.15);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff4e2, 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.camera.layers.enable(1); // layer 1 = own body, casts shadow only
    this.scene.add(this.sun, this.sun.target);
    // soft light from below so ceilings and undersides stay readable when walking upside down
    this.fill = new THREE.DirectionalLight(0xe8eef5, 0.5);
    this.fill.position.set(-0.3, -1, 0.4);
    this.scene.add(this.fill);

    // Sky dome
    const skyGeo = new THREE.SphereGeometry(900, 32, 16);
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: SKY_TOP.clone() }, horizon: { value: SKY_HORIZON.clone() } },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }`,
      fragmentShader: `uniform vec3 top; uniform vec3 horizon; varying vec3 vDir;
        void main(){ float h = clamp(vDir.y, -0.2, 1.0); float t = pow(clamp(h,0.0,1.0), 0.55);
        vec3 c = mix(horizon, top, t); if (h < 0.0) c = mix(horizon, horizon*0.92, -h*5.0);
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
        }`,
    });
    this.sky = new THREE.Mesh(skyGeo, this.skyMat);
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);

    this.clouds = new THREE.Group();
    this.scene.add(this.clouds);

    this.quality = 'medium';
    this.bounds = { min: [-50, 0, -50], max: [50, 40, 50] };
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  setEnvironment({ outdoor, bounds }) {
    this.outdoor = outdoor;
    this.bounds = bounds;
    const size = Math.max(bounds.max[0] - bounds.min[0], bounds.max[2] - bounds.min[2]);
    const cx = (bounds.max[0] + bounds.min[0]) / 2;
    const cz = (bounds.max[2] + bounds.min[2]) / 2;
    const cy = (bounds.max[1] + bounds.min[1]) / 2;
    this.sky.visible = outdoor;
    this.clouds.visible = outdoor;
    if (outdoor) {
      this.scene.background = SKY_HORIZON.clone();
      this.scene.fog = new THREE.Fog(SKY_HORIZON.clone(), size * 0.7, size * 3.2 + 150);
      this.hemi.intensity = 1.15;
      this.hemi.groundColor.set(0x9aa1a9);
      this.fill.intensity = 0.35;
      this.sun.intensity = 2.4;
      this.sun.position.set(cx + size * 0.45, bounds.max[1] + size * 0.8, cz + size * 0.3);
    } else {
      this.scene.background = INDOOR_BG.clone();
      this.scene.fog = new THREE.Fog(INDOOR_BG.clone(), size * 1.5, size * 4);
      this.hemi.intensity = 1.6;
      this.hemi.groundColor.set(0xc3c9d0);
      this.fill.intensity = 0.9;
      this.sun.intensity = 1.6;
      this.sun.position.set(cx + size * 0.2, cy + size * 1.2, cz + size * 0.35);
    }
    this.sun.target.position.set(cx, cy * 0.5, cz);
    const sc = this.sun.shadow.camera;
    const half = size * 0.75;
    sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half;
    sc.near = 1; sc.far = size * 4 + 200;
    sc.updateProjectionMatrix();
    this.buildClouds(outdoor ? bounds : null);
    this.applyQuality();
  }

  buildClouds(bounds) {
    this.clouds.clear();
    if (!bounds) return;
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true, fog: false, transparent: true, opacity: 0.92 });
    const rand = mulberry(42);
    const size = Math.max(bounds.max[0] - bounds.min[0], bounds.max[2] - bounds.min[2]);
    for (let i = 0; i < 14; i++) {
      const c = new THREE.Group();
      const n = 3 + Math.floor(rand() * 4);
      for (let k = 0; k < n; k++) {
        const r = 6 + rand() * 9;
        const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), mat);
        m.position.set(k * r * 1.1 - n * 5, rand() * 4, (rand() - 0.5) * 10);
        m.scale.y = 0.55;
        c.add(m);
      }
      const ang = rand() * Math.PI * 2;
      const dist = size * 0.9 + rand() * 300;
      c.position.set(Math.cos(ang) * dist, bounds.max[1] + 60 + rand() * 80, Math.sin(ang) * dist);
      c.userData.speed = 0.6 + rand();
      this.clouds.add(c);
    }
  }

  setQuality(q) { this.quality = q; this.applyQuality(); }
  applyQuality() {
    const dpr = window.devicePixelRatio || 1;
    const q = this.quality;
    this.renderer.setPixelRatio(q === 'low' ? Math.min(dpr, 1) * 0.75 : q === 'medium' ? Math.min(dpr, 1.25) : Math.min(dpr, 2));
    this.renderer.shadowMap.enabled = q !== 'low';
    this.sun.castShadow = q !== 'low';
    const ms = q === 'high' ? 4096 : 2048;
    if (this.sun.shadow.mapSize.x !== ms) {
      this.sun.shadow.mapSize.set(ms, ms);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setFov(f) { this.camera.fov = f; this.camera.updateProjectionMatrix(); }

  render(dt) {
    this.sky.position.copy(this.camera.position);
    for (const c of this.clouds.children) {
      c.position.x += c.userData.speed * dt;
      if (c.position.x > 900) c.position.x = -900;
    }
    this.renderer.render(this.scene, this.camera);
  }
}

export function mulberry(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
