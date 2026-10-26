// Object catalog: every spawnable thing, its parts (for both mesh and colliders),
// real-world materials and densities.

export const MATERIALS = {
  wood:     { density: 600,  friction: 0.6,  restitution: 0.25, label: 'Wood' },
  steel:    { density: 7850, friction: 0.45, restitution: 0.2,  label: 'Steel' },
  plastic:  { density: 950,  friction: 0.45, restitution: 0.35, label: 'Plastic' },
  rubber:   { density: 1100, friction: 0.9,  restitution: 0.75, label: 'Rubber' },
  foam:     { density: 30,   friction: 0.8,  restitution: 0.15, label: 'Foam' },
  concrete: { density: 2400, friction: 0.75, restitution: 0.1,  label: 'Concrete' },
  glass:    { density: 2500, friction: 0.35, restitution: 0.2,  label: 'Glass' },
  fabric:   { density: 120,  friction: 0.85, restitution: 0.1,  label: 'Fabric' },
  paper:    { density: 700,  friction: 0.6,  restitution: 0.1,  label: 'Paper' },
};

const DARK = '#3a4250';
const WOODC = '#b98a5a';
const box = (size, offset = [0, 0, 0], c = 'main', density) => ({ kind: 'box', size, offset, c, density });
const cyl = (r, h, offset = [0, 0, 0], c = 'main', density, rot) => ({ kind: 'cyl', size: [r, h], offset, c, density, rot });
const ball = (r, offset = [0, 0, 0], c = 'main', density) => ({ kind: 'ball', size: [r], offset, c, density });

/**
 * Each type: label, group, default size [x,y,z] (bounding box in meters), material, color,
 * optional `hollow` effective density (kg/m³) for hollow things (barrels, containers…),
 * parts(size) => parts relative to the object's center.
 */
export const CATALOG = {
  box:      { label: 'Box', group: 'Shapes', size: [1, 1, 1], material: 'wood', color: '#d9a066', parts: (s) => [box(s)] },
  crate:    { label: 'Crate', group: 'Shapes', size: [1.2, 1.2, 1.2], material: 'wood', color: '#c08a4d', hollow: 110,
              parts: (s) => [box(s), box([s[0] * 1.02, s[1] * 0.12, s[2] * 1.02], [0, s[1] * 0.38, 0], '#8e6234'), box([s[0] * 1.02, s[1] * 0.12, s[2] * 1.02], [0, -s[1] * 0.38, 0], '#8e6234')] },
  plank:    { label: 'Plank', group: 'Shapes', size: [2.4, 0.08, 0.3], material: 'wood', color: '#d6b083', parts: (s) => [box(s)] },
  beam:     { label: 'Steel beam', group: 'Shapes', size: [4, 0.3, 0.3], material: 'steel', color: '#5d6878', hollow: 1500, parts: (s) => [box(s)] },
  ball:     { label: 'Ball', group: 'Shapes', size: [0.6, 0.6, 0.6], material: 'rubber', color: '#ef5b4f', hollow: 90, round: true, parts: (s) => [ball(s[0] / 2)] },
  bowling:  { label: 'Heavy ball', group: 'Shapes', size: [0.5, 0.5, 0.5], material: 'steel', color: '#2e3440', hollow: 1200, round: true, parts: (s) => [ball(s[0] / 2)] },
  beachball:{ label: 'Light ball', group: 'Shapes', size: [0.8, 0.8, 0.8], material: 'plastic', color: '#f2d23c', hollow: 4, round: true, parts: (s) => [ball(s[0] / 2)] },
  cylinder: { label: 'Cylinder', group: 'Shapes', size: [0.6, 1, 0.6], material: 'plastic', color: '#4fa3d9', parts: (s) => [cyl(s[0] / 2, s[1])] },
  barrel:   { label: 'Barrel', group: 'Shapes', size: [0.6, 0.9, 0.6], material: 'steel', color: '#2f74c0', hollow: 80,
              parts: (s) => [cyl(s[0] / 2, s[1]), cyl(s[0] / 2 * 1.04, s[1] * 0.05, [0, s[1] * 0.3, 0], DARK), cyl(s[0] / 2 * 1.04, s[1] * 0.05, [0, -s[1] * 0.3, 0], DARK)] },
  pipe:     { label: 'Pipe', group: 'Shapes', size: [0.5, 4, 0.5], material: 'steel', color: '#8a96a6', hollow: 900, parts: (s) => [cyl(s[0] / 2, s[1])] },
  foam:     { label: 'Foam cube', group: 'Shapes', size: [1, 1, 1], material: 'foam', color: '#f29fbf', parts: (s) => [box(s)] },
  concrete: { label: 'Concrete block', group: 'Shapes', size: [1, 1, 1], material: 'concrete', color: '#a7a9a8', parts: (s) => [box(s)] },
  steelblock:{ label: 'Steel block', group: 'Shapes', size: [1, 1, 1], material: 'steel', color: '#6c7684', parts: (s) => [box(s)] },
  container:{ label: 'Shipping container', group: 'Industrial', size: [6.1, 2.6, 2.44], material: 'steel', color: '#c8553d', hollow: 60,
              parts: (s) => [box(s), box([s[0] * 0.02, s[1] * 0.96, s[2] * 1.01], [s[0] * 0.49, 0, 0], DARK), box([s[0] * 0.02, s[1] * 0.96, s[2] * 1.01], [-s[0] * 0.49, 0, 0], DARK)] },

  sofa:     { label: 'Sofa', group: 'Furniture', size: [2.2, 0.9, 0.95], material: 'fabric', color: '#5d7fa3',
              parts: (s) => [box([s[0], s[1] * 0.48, s[2]], [0, -s[1] * 0.26, 0]), box([s[0], s[1] * 0.52, s[2] * 0.25], [0, s[1] * 0.24, -s[2] * 0.375]),
                box([s[0] * 0.1, s[1] * 0.3, s[2]], [s[0] * 0.45, s[1] * 0.12, 0]), box([s[0] * 0.1, s[1] * 0.3, s[2]], [-s[0] * 0.45, s[1] * 0.12, 0])] },
  table:    { label: 'Table', group: 'Furniture', size: [1.6, 0.76, 0.9], material: 'wood', color: WOODC, parts: (s) => tableParts(s, 0.045) },
  desk:     { label: 'Desk', group: 'Furniture', size: [1.4, 0.75, 0.7], material: 'wood', color: '#e2e2de', parts: (s) => tableParts(s, 0.035) },
  coffeetable: { label: 'Coffee table', group: 'Furniture', size: [1.1, 0.42, 0.6], material: 'wood', color: '#7a5537', parts: (s) => tableParts(s, 0.05) },
  chair:    { label: 'Chair', group: 'Furniture', size: [0.46, 0.92, 0.46], material: 'wood', color: WOODC,
              parts: (s) => { const leg = 0.04, sh = s[1] * 0.5; return [box([s[0], 0.04, s[2]], [0, -s[1] / 2 + sh, 0]), box([s[0], s[1] - sh - 0.02, 0.04], [0, sh / 2, -s[2] / 2 + 0.02]),
                ...[[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([a, b]) => box([leg, sh, leg], [a * (s[0] / 2 - leg / 2), -s[1] / 2 + sh / 2, b * (s[2] / 2 - leg / 2)], DARK))]; } },
  bed:      { label: 'Bed', group: 'Furniture', size: [2.05, 0.95, 1.6], material: 'wood', color: '#efeae0',
              parts: (s) => [box([s[0], s[1] * 0.3, s[2]], [0, -s[1] * 0.35, 0], '#8b6b4a'), box([s[0] * 0.96, s[1] * 0.22, s[2] * 0.96], [0, -s[1] * 0.09, 0], 'main', 80),
                box([0.08, s[1], s[2]], [-s[0] / 2 + 0.04, 0, 0], '#8b6b4a'), box([s[0] * 0.18, s[1] * 0.1, s[2] * 0.7], [-s[0] * 0.36, s[1] * 0.07, 0], '#ffffff', 40)] },
  bookshelf:{ label: 'Bookshelf', group: 'Furniture', size: [1.0, 1.9, 0.35], material: 'wood', color: '#9a7350',
              parts: (s) => { const t = 0.03; const p = [box([t, s[1], s[2]], [-s[0] / 2 + t / 2, 0, 0]), box([t, s[1], s[2]], [s[0] / 2 - t / 2, 0, 0]), box([s[0], s[1], 0.01], [0, 0, -s[2] / 2 + 0.005], DARK)];
                for (let i = 0; i < 5; i++) p.push(box([s[0] - 2 * t, t, s[2]], [0, -s[1] / 2 + t / 2 + i * (s[1] - t) / 4, 0])); return p; } },
  wardrobe: { label: 'Wardrobe', group: 'Furniture', size: [1.2, 2.0, 0.6], material: 'wood', color: '#d7cfc2', hollow: 70,
              parts: (s) => [box(s), box([0.02, s[1] * 0.9, 0.02], [0, 0, s[2] / 2 + 0.01], DARK)] },
  nightstand:{ label: 'Nightstand', group: 'Furniture', size: [0.5, 0.55, 0.4], material: 'wood', color: '#9a7350', hollow: 160, parts: (s) => [box(s), box([s[0] * 0.3, 0.02, 0.02], [0, s[1] * 0.2, s[2] / 2 + 0.01], DARK)] },
  fridge:   { label: 'Fridge', group: 'Furniture', size: [0.7, 1.8, 0.7], material: 'steel', color: '#e9ecef', hollow: 95,
              parts: (s) => [box(s), box([0.03, s[1] * 0.25, 0.03], [s[0] * 0.38, s[1] * 0.22, s[2] / 2 + 0.015], DARK), box([s[0], 0.01, 0.01], [0, s[1] * 0.05, s[2] / 2 + 0.005], DARK)] },
  tv:       { label: 'TV', group: 'Furniture', size: [1.2, 0.7, 0.08], material: 'plastic', color: '#1d222b', hollow: 220, parts: (s) => [box(s), box([s[0] * 0.94, s[1] * 0.9, 0.01], [0, 0, s[2] / 2], '#2b3a4f')] },
  lamp:     { label: 'Floor lamp', group: 'Furniture', size: [0.4, 1.6, 0.4], material: 'steel', color: '#f2e6c9',
              parts: (s) => [cyl(s[0] / 2 * 0.7, 0.04, [0, -s[1] / 2 + 0.02, 0], DARK), cyl(0.015, s[1] * 0.8, [0, -s[1] * 0.08, 0], DARK), cyl(s[0] / 2, s[1] * 0.2, [0, s[1] * 0.4, 0], 'main', 60)] },
  book:     { label: 'Book', group: 'Furniture', size: [0.16, 0.24, 0.04], material: 'paper', color: '#a83b3b', parts: (s) => [box(s)] },
  plant:    { label: 'Plant pot', group: 'Furniture', size: [0.4, 0.9, 0.4], material: 'concrete', color: '#c97b54', hollow: 500,
              parts: (s) => [cyl(s[0] / 2, s[1] * 0.4, [0, -s[1] * 0.3, 0]), ball(s[0] * 0.65, [0, s[1] * 0.2, 0], '#4f9d58', 60)] },

  mannequin:{ label: 'Mannequin', group: 'Characters', size: [0.6, 1.8, 0.3], material: 'plastic', color: '#e6dccf', ragdoll: true, parts: () => [] },
};

function tableParts(s, top) {
  const leg = 0.06;
  return [box([s[0], top, s[2]], [0, s[1] / 2 - top / 2, 0]),
    ...[[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([a, b]) => box([leg, s[1] - top, leg], [a * (s[0] / 2 - leg), -top / 2, b * (s[2] / 2 - leg)], 'main'))];
}

export const CATALOG_GROUPS = ['Shapes', 'Industrial', 'Furniture', 'Characters'];

/** Static (editor) pieces: always boxes, ramps are rotated boxes. */
export const STATIC_TYPES = {
  floor: { label: 'Floor slab', size: [8, 0.3, 8], color: '#c9cfd6' },
  wall:  { label: 'Wall', size: [8, 4, 0.3], color: '#dfe3e8' },
  block: { label: 'Block', size: [2, 2, 2], color: '#8892a0' },
  pillar:{ label: 'Pillar', size: [0.8, 6, 0.8], color: '#3c4554' },
  ramp:  { label: 'Ramp', size: [4, 0.3, 6], color: '#f28c28', rot: [-20, 0, 0] },
  platform: { label: 'Platform', size: [4, 0.3, 4], color: '#4fc3d9' },
};

/** Effective density for a part. */
export function partDensity(type, part, matName) {
  if (part.density) return part.density;
  const t = CATALOG[type];
  if (t?.hollow) return t.hollow;
  return MATERIALS[matName]?.density ?? 600;
}
