import * as THREE from 'three';

// Procedural grid materials (no texture files). The grid helps players judge distance and
// orientation — especially when walking on walls and ceilings.
const cache = new Map();

function patch(material, { local, cell, strength }) {
  material.userData.gridCell = { value: cell };
  material.userData.gridStrength = { value: strength };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.gridCell = material.userData.gridCell;
    shader.uniforms.gridStrength = material.userData.gridStrength;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGridPos;\nvarying vec3 vGridNormal;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef GRID_LOCAL
          vGridPos = transformed;
          vGridNormal = objectNormal;
        #else
          vec4 gwp = modelMatrix * vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            gwp = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
          #endif
          vGridPos = gwp.xyz;
          vGridNormal = normalize(mat3(modelMatrix) * objectNormal);
        #endif`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vGridPos;
        varying vec3 vGridNormal;
        uniform float gridCell;
        uniform float gridStrength;
        float gridLine(vec2 p, float w) {
          vec2 f = abs(fract(p - 0.5) - 0.5);
          vec2 aa = fwidth(p) * 1.2;
          vec2 l = 1.0 - smoothstep(vec2(w), vec2(w) + aa, f);
          return max(l.x, l.y);
        }`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec3 an = abs(normalize(vGridNormal));
          vec2 guv = (an.x > an.y && an.x > an.z) ? vGridPos.zy : ((an.y > an.z) ? vGridPos.xz : vGridPos.xy);
          float g1 = gridLine(guv / gridCell, 0.018);
          float g2 = gridLine(guv / (gridCell * 4.0), 0.008);
          float fade = clamp(1.0 - length(fwidth(guv / gridCell)) * 0.6, 0.0, 1.0);
          diffuseColor.rgb *= 1.0 - max(g1 * gridStrength * fade, g2 * gridStrength * 1.7);
        }`
      );
  };
  material.customProgramCacheKey = () => (local ? 'gridL' : 'gridW');
  if (local) material.defines = { GRID_LOCAL: '' };
}

/**
 * Grid material.
 * @param {object} o
 * @param {number|string} [o.color]
 * @param {boolean} [o.vertexColors]
 * @param {boolean} [o.local] grid follows the object (dynamic objects) instead of the world
 */
export function gridMaterial(o = {}) {
  const key = JSON.stringify(o);
  if (cache.has(key)) return cache.get(key);
  const m = new THREE.MeshStandardMaterial({
    color: o.vertexColors ? 0xffffff : new THREE.Color(o.color ?? 0xdddddd),
    vertexColors: !!o.vertexColors,
    roughness: o.roughness ?? 0.82,
    metalness: o.metalness ?? 0.0,
    emissive: new THREE.Color(o.emissive ?? 0x000000),
    emissiveIntensity: o.emissiveIntensity ?? 1,
    flatShading: !!o.flat,
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
  });
  patch(m, { local: !!o.local, cell: o.cell ?? 1, strength: o.strength ?? 0.2 });
  cache.set(key, m);
  return m;
}

/** Material by physical material name (affects roughness/metalness) */
export function objectMaterial(colorHex, matName, highlight = 0) {
  const metal = matName === 'steel';
  const glass = matName === 'glass';
  return gridMaterial({
    color: colorHex, local: true, cell: 0.5, strength: metal ? 0.12 : 0.16,
    roughness: metal ? 0.45 : glass ? 0.15 : matName === 'rubber' ? 0.95 : 0.78,
    metalness: metal ? 0.55 : 0,
    vertexColors: true,
    emissive: highlight || 0x000000, emissiveIntensity: highlight ? 0.28 : 1,
  });
}

export const basic = (color, opts = {}) => new THREE.MeshBasicMaterial({ color, ...opts });
