// Default maps and empty-map templates. Built in code so they ship with the game and
// work offline. A map is plain JSON: statics (never move) + up to 100 dynamic objects.
import { mulberry } from '../render/renderer.js';

const W = 0.5; // wall thickness

function base(name, env, bounds, extra = {}) {
  return { version: 1, name, env, bounds, gravity: { dir: [0, -1, 0], s: 9.81 }, spawns: [[0, 0.1, 0]], statics: [], objects: [], ...extra };
}
const S = (m, pos, size, color, rot) => m.statics.push({ pos, size, color, ...(rot ? { rot } : {}) });
const O = (m, type, pos, extra = {}) => m.objects.push({ type, pos, ...extra });

/** Closed box room: interior from (x0,y0,z0) to (x1,y1,z1). */
function room(m, x0, y0, z0, x1, y1, z1, c = {}) {
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, cy = (y0 + y1) / 2;
  const w = x1 - x0, h = y1 - y0, d = z1 - z0;
  S(m, [cx, y0 - W / 2, cz], [w + 2 * W, W, d + 2 * W], c.floor || '#cfd5dc');
  S(m, [cx, y1 + W / 2, cz], [w + 2 * W, W, d + 2 * W], c.ceiling || '#d8dde3');
  S(m, [x0 - W / 2, cy, cz], [W, h, d], c.wall || '#e4e8ec');
  S(m, [x1 + W / 2, cy, cz], [W, h, d], c.wall || '#e4e8ec');
  S(m, [cx, cy, z0 - W / 2], [w, h, W], c.wall2 || c.wall || '#e4e8ec');
  S(m, [cx, cy, z1 + W / 2], [w, h, W], c.wall2 || c.wall || '#e4e8ec');
}

// ---------------------------------------------------------------- THE LAB
export function theLab() {
  const m = base('The Lab', 'indoor', { min: [-20, 0, -20], max: [20, 20, 20] });
  room(m, -20, 0, -20, 20, 20, 20, { floor: '#c7ced6', wall: '#e2e6ea', wall2: '#d9dee4', ceiling: '#d2d8de' });
  m.spawns = [[0, 0.1, 12], [3, 0.1, 12], [-3, 0.1, 12], [6, 0.1, 12], [-6, 0.1, 12]];
  // orange accent stripes at the base of the walls
  S(m, [0, 0.15, -19.95], [40, 0.3, 0.1], '#f28c28');
  S(m, [0, 0.15, 19.95], [40, 0.3, 0.1], '#f28c28');
  S(m, [-19.95, 0.15, 0], [0.1, 0.3, 40], '#f28c28');
  S(m, [19.95, 0.15, 0], [0.1, 0.3, 40], '#f28c28');
  // ceiling light panels
  for (const x of [-10, 0, 10]) for (const z of [-10, 0, 10]) S(m, [x, 19.95, z], [4, 0.1, 1.2], '#ffffff');
  // raised platform + ramp
  S(m, [13, 1, -13], [12, 2, 12], '#3c4554');
  S(m, [13, 2.02, -13], [11.6, 0.04, 11.6], '#4fc3d9');
  S(m, [4.8, 1, -13], [5, 0.3, 4], '#f28c28', [0, 0, 23]);
  // test pillars
  for (const [x, z] of [[-8, -8], [-8, 0], [0, -8]]) S(m, [x, 10, z], [1, 20, 1], '#3c4554');
  // steps
  for (let i = 0; i < 10; i++) { const h = 0.4 * (i + 1); S(m, [-14, h / 2, 8 - i * 0.6], [8, h, 0.6], i % 2 ? '#9aa5b3' : '#a9b3bf'); }
  S(m, [-14, 2, -0.7], [8, 4, 6], '#9aa5b3');
  // wall shelf
  S(m, [0, 3, 19.5], [16, 0.2, 1], '#3c4554');
  S(m, [0, 6, 19.5], [16, 0.2, 1], '#3c4554');

  // objects
  const rnd = mulberry(7);
  const palette = ['#d9a066', '#4fc3d9', '#f28c28', '#e8e3d9', '#9b7cf2', '#5cc46a'];
  for (let i = 0; i < 16; i++) {
    const s = 0.5 + rnd() * 0.8;
    O(m, 'box', [-4 + (i % 4) * 1.6, s / 2 + 0.01, -2 + Math.floor(i / 4) * 1.6], { size: [s, s, s], color: palette[i % palette.length], rot: [0, rnd() * 90, 0] });
  }
  // a stack (pyramid)
  for (let row = 0; row < 4; row++) for (let k = 0; k <= 3 - row; k++) O(m, 'crate', [6 + k * 1.25 + row * 0.62, 0.6 + row * 1.2, 4], { size: [1.2, 1.2, 1.2] });
  for (let i = 0; i < 6; i++) O(m, 'ball', [-10 + i * 1.2, 0.31, 6], { color: ['#ef5b4f', '#4fa3d9', '#f2d23c'][i % 3] });
  O(m, 'bowling', [-2, 0.26, 8]); O(m, 'bowling', [-1, 0.26, 8]);
  for (let i = 0; i < 4; i++) O(m, 'beachball', [10 + i * 1.1, 0.41, 10]);
  for (let i = 0; i < 6; i++) O(m, 'plank', [-6, 0.05 + i * 0.09, 12], { rot: [0, 0, 0] });
  for (let i = 0; i < 4; i++) O(m, 'cylinder', [4 + i, 0.5, 12]);
  for (let i = 0; i < 4; i++) O(m, 'barrel', [12 + (i % 2) * 0.7, 0.45, 14 + Math.floor(i / 2) * 0.7]);
  O(m, 'steelblock', [0, 0.5, -14]);
  O(m, 'concrete', [-3, 0.5, -14]);
  O(m, 'concrete', [3, 0.5, -14]);
  for (let i = 0; i < 4; i++) O(m, 'foam', [-12 + i * 1.3, 0.5, -14], { color: ['#f29fbf', '#9fd4f2', '#c6f29f', '#f2e29f'][i] });
  O(m, 'beam', [13, 2.2, -10]);
  O(m, 'beam', [13, 2.6, -11]);
  for (let i = 0; i < 6; i++) O(m, 'box', [10 + (i % 3) * 1.2, 2.5, -16 + Math.floor(i / 3) * 1.2], { size: [0.8, 0.8, 0.8], color: '#4fc3d9' });
  for (let i = 0; i < 8; i++) O(m, 'book', [-6 + i * 0.4, 3.22, 19.5], { color: ['#a83b3b', '#3b5ba8', '#3ba85b', '#d6a73b'][i % 4] });
  O(m, 'mannequin', [2, 0.02, 6], { rot: [0, 200, 0] });
  O(m, 'mannequin', [-10, 0.02, -4], { rot: [0, 30, 0], color: '#cfc4b4' });
  O(m, 'mannequin', [13, 2.06, -14], { rot: [0, 180, 0], color: '#bfb3a3' });
  return m;
}

// ---------------------------------------------------------------- THE APARTMENT
export function theApartment() {
  const m = base('The Apartment', 'indoor', { min: [-10, 0, -7], max: [10, 6.8, 7] });
  const wall = '#ece6dc', floorWood = '#b98f66', floorTile = '#d7d9d6';
  m.spawns = [[-3, 0.1, 3], [-2, 0.1, 2], [-4, 0.1, 2], [-3, 0.1, 1], [-1, 0.1, 3]];
  // shell
  S(m, [0, -0.25, 0], [21, 0.5, 15], floorWood);
  S(m, [0, 7.05, 0], [21, 0.5, 15], '#e9e9e6');
  S(m, [-10.25, 3.4, 0], [0.5, 6.8, 14], wall);
  S(m, [10.25, 3.4, 0], [0.5, 6.8, 14], wall);
  S(m, [0, 3.4, -7.25], [20, 6.8, 0.5], '#e4ddd1');
  S(m, [0, 3.4, 7.25], [20, 6.8, 0.5], '#e4ddd1');
  // kitchen tiles
  S(m, [6, 0.005, 1.2], [8, 0.01, 11.6], floorTile);
  // upper slab (with stair opening at x 3..10, z -7..-4.6)
  S(m, [-3.5, 3.3, 0], [13, 0.2, 14], floorWood);
  S(m, [6.5, 3.3, 1.2], [7, 0.2, 11.6], floorWood);
  // railing at the opening
  S(m, [6.75, 3.9, -4.65], [6.5, 1.0, 0.08], '#3c4554');
  // stairs: from x=9.5 (ground) going -x up to the slab at x=3
  for (let i = 0; i < 12; i++) {
    const h = (i + 1) * (3.4 / 12);
    S(m, [9.25 - i * 0.55, h / 2, -5.8], [0.55, h, 2.2], i % 2 ? '#a07a52' : '#b08a62');
  }
  // interior walls
  S(m, [2, 1.6, 4], [0.2, 3.2, 6], wall);             // living | kitchen (door gap z<1)
  S(m, [0, 5.0, -4], [0.2, 3.2, 6], wall);            // bedroom | study (door gap)
  S(m, [0, 5.0, 4.25], [0.2, 3.2, 5.5], wall);
  // kitchen counter + TV unit (static)
  S(m, [6.25, 0.45, 6.65], [6.5, 0.9, 0.7], '#f4f4f2');
  S(m, [6.25, 0.92, 6.65], [6.6, 0.04, 0.74], '#3c4554');
  S(m, [-6, 0.25, 0.5], [2.4, 0.5, 0.5], '#3c4554');
  // ceiling lights
  for (const [x, z] of [[-6, 2], [6, 2]]) S(m, [x, 3.17, z], [1.2, 0.04, 1.2], '#ffffff');
  for (const [x, z] of [[-5, 2], [5, 2]]) S(m, [x, 6.77, z], [1.2, 0.04, 1.2], '#ffffff');
  // rug
  S(m, [-6, 0.006, 3], [3.4, 0.012, 2.4], '#5d7fa3');

  // ---- ground floor: living room
  O(m, 'sofa', [-6, 0.45, 4.6], { rot: [0, 180, 0] });
  O(m, 'coffeetable', [-6, 0.21, 2.8]);
  O(m, 'tv', [-6, 0.85, 0.55]);
  O(m, 'lamp', [-9.3, 0.8, 5.9]);
  O(m, 'bookshelf', [-9.75, 0.95, -2], { rot: [0, 90, 0] });
  for (let i = 0; i < 8; i++) O(m, 'book', [-9.7, 0.62 + Math.floor(i / 4) * 0.47, -2.35 + (i % 4) * 0.2], { rot: [0, 90, 0], color: ['#a83b3b', '#3b5ba8', '#3ba85b', '#d6a73b', '#6b4fa8'][i % 5] });
  O(m, 'plant', [-1, 0.45, 6.4]);
  O(m, 'plant', [-9.4, 0.45, -6.4]);
  O(m, 'ball', [-3, 0.31, 1], { color: '#ef5b4f', size: [0.25, 0.25, 0.25] });
  // ---- kitchen
  O(m, 'table', [6, 0.38, 2]);
  O(m, 'chair', [5.4, 0.46, 2.85], { rot: [0, 180, 0] });
  O(m, 'chair', [6.6, 0.46, 2.85], { rot: [0, 180, 0] });
  O(m, 'chair', [5.4, 0.46, 1.15]);
  O(m, 'chair', [6.6, 0.46, 1.15]);
  O(m, 'fridge', [9.55, 0.9, 4.5], { rot: [0, -90, 0] });
  for (let i = 0; i < 3; i++) O(m, 'cylinder', [4 + i * 0.4, 1.06, 6.6], { size: [0.12, 0.25, 0.12], material: 'glass', color: '#bfe3ef' });
  O(m, 'box', [8, 1.09, 6.6], { size: [0.4, 0.3, 0.3], color: '#c0392b' });
  // ---- upper floor: bedroom
  const F = 3.4;
  O(m, 'bed', [-8.95, F + 0.475, 3.6]);
  O(m, 'nightstand', [-9.7, F + 0.275, 1.9], { rot: [0, 90, 0] });
  O(m, 'lamp', [-9.7, F + 0.8, 6.5]);
  O(m, 'wardrobe', [-5.5, F + 1.0, -6.65]);
  O(m, 'box', [-2, F + 0.3, -6], { size: [0.6, 0.6, 0.6], color: '#d9a066' });
  O(m, 'box', [-2.1, F + 0.85, -6], { size: [0.5, 0.5, 0.5], color: '#c08a4d' });
  O(m, 'ball', [-3, F + 0.31, 2], { color: '#4fa3d9' });
  // study
  O(m, 'desk', [5, F + 0.375, 6.5], { rot: [0, 180, 0] });
  O(m, 'chair', [5, F + 0.46, 5.6], { rot: [0, 180, 0] });
  O(m, 'bookshelf', [9.75, F + 0.95, 2], { rot: [0, -90, 0] });
  for (let i = 0; i < 6; i++) O(m, 'book', [4.4 + i * 0.22, F + 0.88, 6.6], { color: ['#a83b3b', '#3b5ba8', '#3ba85b'][i % 3] });
  O(m, 'tv', [5, F + 1.1, 6.75], { size: [0.6, 0.38, 0.05] });
  O(m, 'plant', [1, F + 0.45, 6.4]);
  // mannequins
  O(m, 'mannequin', [-3.5, 0.02, 2.5], { rot: [0, 150, 0] });
  O(m, 'mannequin', [7.5, 0.02, -0.5], { rot: [0, 90, 0], color: '#cfc4b4' });
  O(m, 'mannequin', [-3, F + 0.02, 4.5], { rot: [0, 220, 0], color: '#bfb3a3' });
  return m;
}

// ---------------------------------------------------------------- THE YARD
export function theYard() {
  const m = base('The Yard', 'outdoor', { min: [-60, -2, -60], max: [60, 60, 60] });
  m.spawns = [[0, 0.1, 30], [3, 0.1, 30], [-3, 0.1, 30], [6, 0.1, 30], [-6, 0.1, 30]];
  S(m, [0, -1, 0], [120, 2, 120], '#9aa4b0');
  // painted lanes
  S(m, [0, 0.005, 0], [6, 0.01, 110], '#3c4554');
  S(m, [0, 0.008, 0], [0.25, 0.01, 110], '#f28c28');
  // distant blocks / towers (inside the bounds)
  const navy = '#3c4554';
  for (const [x, z, w, h, d] of [[-50, -50, 10, 34, 10], [50, -50, 8, 26, 12], [-50, 48, 12, 20, 8], [48, 48, 10, 40, 10], [-54, 0, 6, 16, 20], [54, 6, 6, 22, 16]]) {
    S(m, [x, h / 2, z], [w, h, d], x > 0 ? '#bcc6d1' : navy);
  }
  // gantry crane frame (orange)
  const orange = '#f28c28';
  for (const x of [-9, 9]) for (const z of [-24, -12]) S(m, [x, 8, z], [1, 16, 1], orange);
  S(m, [-9, 16.5, -18], [1, 1, 13], orange); S(m, [9, 16.5, -18], [1, 1, 13], orange);
  S(m, [0, 17.2, -24], [19, 0.8, 1], orange); S(m, [0, 17.2, -12], [19, 0.8, 1], orange);
  S(m, [0, 17.9, -18], [3, 1.2, 3], navy);
  // loading dock + ramp
  S(m, [-26, 0.6, -10], [16, 1.2, 22], navy);
  S(m, [-16.5, 0.6, -10], [4, 0.3, 6], '#9aa5b3', [0, 0, -17]);
  // static container stacks (bottom rows)
  const cols = ['#c8553d', '#2f74c0', '#5cc46a', '#e8e3d9', '#9b7cf2'];
  for (let i = 0; i < 4; i++) S(m, [28, 1.3, -30 + i * 3], [6.1, 2.6, 2.44], cols[i % 5]);
  for (let i = 0; i < 3; i++) S(m, [28, 3.9, -28.5 + i * 3], [6.1, 2.6, 2.44], cols[(i + 2) % 5]);
  // concrete jersey barriers
  for (let i = 0; i < 6; i++) S(m, [-30 + i * 4.5, 0.45, 22], [4, 0.9, 0.6], '#d0d3d6');
  // ramps
  S(m, [20, 1.2, 20], [6, 0.4, 10], orange, [14, 0, 0]);
  S(m, [20, 1.2, 13], [6, 2.4, 4], navy);
  // lamp posts
  for (const [x, z] of [[-14, 14], [14, 14], [-14, -32], [14, -32]]) { S(m, [x, 5, z], [0.4, 10, 0.4], navy); S(m, [x, 10, z + 0.6], [0.6, 0.3, 1.6], navy); }

  // dynamic
  O(m, 'container', [-26, 2.5, -14], { color: '#c8553d' });
  O(m, 'container', [-26, 2.5, -6], { color: '#2f74c0' });
  O(m, 'container', [0, 1.3, -18], { color: '#5cc46a' });
  O(m, 'container', [0, 3.9, -18], { color: '#e8e3d9' });
  O(m, 'container', [28, 6.5, -27], { color: '#9b7cf2' });
  O(m, 'container', [10, 1.3, 2], { color: '#c8553d', rot: [0, 90, 0] });
  for (let i = 0; i < 16; i++) O(m, 'crate', [-8 + (i % 4) * 1.3, 0.61 + Math.floor(i / 8) * 1.22, 6 + Math.floor((i % 8) / 4) * 1.3]);
  for (let i = 0; i < 10; i++) O(m, 'barrel', [-20 + (i % 5) * 0.7, 0.46, 10 + Math.floor(i / 5) * 0.7], { color: ['#2f74c0', '#c8553d', '#f2d23c'][i % 3] });
  for (let i = 0; i < 4; i++) O(m, 'pipe', [14, 0.26 + i * 0.5, -2], { rot: [90, 0, 0] });
  for (let i = 0; i < 4; i++) O(m, 'beam', [-26, 1.36 + i * 0.31, -24], { rot: [0, 90, 0] });
  for (let i = 0; i < 6; i++) O(m, 'concrete', [-4 + i * 1.2, 0.5, -4]);
  for (let i = 0; i < 4; i++) O(m, 'ball', [4 + i, 0.31, 20], { color: '#ef5b4f' });
  O(m, 'steelblock', [6, 0.5, -6]);
  for (let i = 0; i < 6; i++) O(m, 'plank', [-14, 0.05 + i * 0.09, 2]);
  O(m, 'mannequin', [2, 0.02, 24], { rot: [0, 180, 0] });
  O(m, 'mannequin', [-24, 1.22, -18], { rot: [0, 90, 0], color: '#cfc4b4' });
  return m;
}

// ---------------------------------------------------------------- THE ATRIUM
export function theAtrium() {
  const m = base('The Atrium', 'outdoor', { min: [-40, -2, -40], max: [40, 50, 40] });
  m.spawns = [[0, 0.1, 25], [3, 0.1, 25], [-3, 0.1, 25], [6, 0.1, 25], [-6, 0.1, 25]];
  S(m, [0, -1, 0], [80, 2, 80], '#c4cbd3');
  S(m, [0, 0.005, 0], [20, 0.01, 20], '#4fc3d9');
  const navy = '#3c4554', pale = '#e3e7ec', orange = '#f28c28';
  // four towers
  for (const [x, z] of [[-14, -14], [14, -14], [-14, 14], [14, 14]]) S(m, [x, 20, z], [6, 40, 6], navy);
  // balconies around the towers at 3 levels + bridges between them
  for (const y of [8, 16, 24]) {
    for (const [x, z] of [[-14, -14], [14, -14], [-14, 14], [14, 14]]) S(m, [x, y, z], [10, 0.4, 10], pale);
    S(m, [0, y, -14], [18, 0.3, 3], y === 16 ? orange : pale);
    S(m, [0, y, 14], [18, 0.3, 3], y === 16 ? orange : pale);
    S(m, [-14, y, 0], [3, 0.3, 18], pale);
    S(m, [14, y, 0], [3, 0.3, 18], pale);
  }
  // railings on bridges
  for (const y of [16, 24]) {
    S(m, [0, y + 0.6, -15.4], [18, 0.9, 0.1], navy); S(m, [0, y + 0.6, 15.4], [18, 0.9, 0.1], navy);
  }
  // ramp from ground to first balcony
  S(m, [0, 4, 30], [4, 0.4, 20.6], orange, [23, 0, 0]);
  S(m, [0, 7.9, 20.6], [4, 0.2, 2], orange);
  S(m, [0, 7.9, 17.3], [4, 0.2, 4.6], pale);
  // floating platforms
  const plats = [[-24, 12, 0, 6], [24, 18, 4, 5], [0, 32, 0, 8], [-8, 28, 22, 4], [10, 36, -22, 4], [26, 6, -26, 6], [-26, 22, -26, 5]];
  for (const [x, y, z, s] of plats) S(m, [x, y, z], [s, 0.5, s], x % 2 ? orange : pale);
  // outer low ring wall
  for (const [x, z, w, d] of [[0, -39.7, 80, 0.6], [0, 39.7, 80, 0.6], [-39.7, 0, 0.6, 80], [39.7, 0, 0.6, 80]]) S(m, [x, 1, z], [w, 2, d], navy);
  // columns
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; S(m, [Math.cos(a) * 30, 6, Math.sin(a) * 30], [1.2, 12, 1.2], pale); }

  // dynamic (light props)
  for (let i = 0; i < 16; i++) O(m, 'beachball', [-6 + (i % 4) * 1.2, 0.41, -6 + Math.floor(i / 4) * 1.2], { color: ['#f2d23c', '#ef5b7a', '#4fc3d9', '#ffffff'][i % 4] });
  for (let i = 0; i < 12; i++) O(m, 'foam', [6 + (i % 3) * 1.2, 0.5 + Math.floor(i / 3) * 1.0, 6], { color: ['#f29fbf', '#9fd4f2', '#c6f29f'][i % 3] });
  for (let i = 0; i < 8; i++) O(m, 'box', [-14 + (i % 4) * 1.1, 8.7, -14 + Math.floor(i / 4) * 1.1], { size: [0.9, 0.9, 0.9], color: '#d9a066' });
  for (let i = 0; i < 6; i++) O(m, 'plank', [14, 16.25 + i * 0.09, 14]);
  for (let i = 0; i < 6; i++) O(m, 'ball', [-14 + i * 0.7, 24.5, 14], { color: '#ef5b4f' });
  for (let i = 0; i < 4; i++) O(m, 'crate', [0, 32.85 + i * 1.21, 0]);
  O(m, 'concrete', [0, 0.5, -10]);
  O(m, 'cylinder', [-24, 12.75, 0]);
  O(m, 'barrel', [24, 18.7, 4]);
  O(m, 'mannequin', [0, 0.02, 12], { rot: [0, 180, 0] });
  O(m, 'mannequin', [14, 8.22, -14], { rot: [0, 45, 0], color: '#cfc4b4' });
  O(m, 'mannequin', [-14, 16.22, 14], { rot: [0, 225, 0], color: '#bfb3a3' });
  O(m, 'mannequin', [0, 16.17, -14], { color: '#e6dccf' });
  return m;
}

// ---------------------------------------------------------------- TEMPLATES
export function flatPlain() {
  const m = base('Flat Plain', 'outdoor', { min: [-50, -2, -50], max: [50, 50, 50] }, { template: 'plain' });
  S(m, [0, -1, 0], [100, 2, 100], '#c4cbd3');
  m.spawns = [[0, 0.1, 10]];
  return m;
}
export function closedRoom() {
  const m = base('Closed Room', 'indoor', { min: [-20, 0, -20], max: [20, 20, 20] }, { template: 'room' });
  room(m, -20, 0, -20, 20, 20, 20);
  m.spawns = [[0, 0.1, 10]];
  return m;
}

export const DEFAULT_MAPS = [
  { id: 'lab', name: 'The Lab', desc: 'Indoor test chamber · learn every power', build: theLab, accent: '#4fc3d9' },
  { id: 'apartment', name: 'The Apartment', desc: 'Furnished two-floor home · household chaos', build: theApartment, accent: '#d9a066' },
  { id: 'yard', name: 'The Yard', desc: 'Outdoor industrial yard · heavy objects', build: theYard, accent: '#f28c28' },
  { id: 'atrium', name: 'The Atrium', desc: 'Open-air towers & balconies · zero-g & bubbles', build: theAtrium, accent: '#9b7cf2' },
];
export const TEMPLATES = [
  { id: 'plain', name: 'Flat Plain', desc: 'Open ground under the sky', build: flatPlain },
  { id: 'room', name: 'Closed Room', desc: 'Large box room, great for wall walking', build: closedRoom },
];

export function getDefaultMap(id) {
  const d = DEFAULT_MAPS.find((x) => x.id === id) || TEMPLATES.find((x) => x.id === id);
  return d ? d.build() : null;
}

/** Validate & sanitize a map coming from the network or the database. */
export function sanitizeMap(m) {
  if (!m || typeof m !== 'object') throw new Error('Invalid map');
  const num = (x, d = 0) => (Number.isFinite(+x) ? +x : d);
  const v3 = (a, d = [0, 0, 0]) => (Array.isArray(a) && a.length === 3 ? a.map((x) => num(x)) : d);
  const out = {
    version: 1, name: String(m.name || 'Untitled').slice(0, 40), env: m.env === 'outdoor' ? 'outdoor' : 'indoor',
    template: m.template || null,
    bounds: { min: v3(m.bounds?.min, [-50, -2, -50]), max: v3(m.bounds?.max, [50, 50, 50]) },
    gravity: { dir: v3(m.gravity?.dir, [0, -1, 0]), s: Math.max(0, Math.min(98.1, num(m.gravity?.s, 9.81))) },
    spawns: (m.spawns || [[0, 1, 0]]).slice(0, 8).map((s) => v3(s)),
    statics: (m.statics || []).slice(0, 600).map((s) => ({ pos: v3(s.pos), size: v3(s.size, [1, 1, 1]).map((x) => Math.max(0.01, Math.min(400, x))), rot: v3(s.rot), color: /^#[0-9a-f]{6}$/i.test(s.color) ? s.color : '#cccccc', ...(s.invisible ? { invisible: true } : {}) })),
    objects: (m.objects || []).slice(0, 100).map((o) => ({ ...o, pos: v3(o.pos), ...(o.rot ? { rot: v3(o.rot) } : {}), ...(o.size ? { size: v3(o.size, [1, 1, 1]).map((x) => Math.max(0.02, Math.min(30, x))) } : {}) })),
  };
  return out;
}
