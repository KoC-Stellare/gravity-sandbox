// Shared help content: the How to play screen, first-time tips and the tutorial all read from here.
import { settings, keyLabel } from '../core/settings.js';
import { TK_LIMIT_KG } from '../config.js';

export const k = (action) => keyLabel(settings.get('bindings')[action]);
export const kbd = (action) => `<kbd>${k(action)}</kbd>`;

// Small diagrams, drawn with the HUD colours (cyan = gravity, coral = telekinesis).
const C = '#35d0e6', T = '#ff7a5c', N = '#3c4554', P = '#c9cfd6';
const arrow = (x1, y1, x2, y2, c = C) => {
  const a = Math.atan2(y2 - y1, x2 - x1), h = 7;
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c}" stroke-width="3" stroke-linecap="round"/>` +
    `<path d="M${x2} ${y2} L${x2 - h * Math.cos(a - 0.5)} ${y2 - h * Math.sin(a - 0.5)} L${x2 - h * Math.cos(a + 0.5)} ${y2 - h * Math.sin(a + 0.5)}Z" fill="${c}"/>`;
};
const svg = (inner) => `<svg viewBox="0 0 160 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${inner}</svg>`;
const floor = `<rect x="0" y="84" width="160" height="16" fill="${P}"/>`;
const box = (x, y, s = 22, c = '#d9a066') => `<rect x="${x}" y="${y}" width="${s}" height="${s}" rx="3" fill="${c}" stroke="${N}" stroke-width="1.5"/>`;
const person = (x, y, rot = 0) => `<g transform="translate(${x} ${y}) rotate(${rot})"><circle cx="0" cy="-30" r="6" fill="${N}"/><rect x="-5" y="-23" width="10" height="16" rx="3" fill="${N}"/><rect x="-5" y="-8" width="4" height="12" fill="${N}"/><rect x="1" y="-8" width="4" height="12" fill="${N}"/></g>`;

export const ART = {
  object: svg(`${floor}${box(30, 62)}${box(100, 22, 22, '#4fc3d9')}${arrow(111, 60, 111, 30)}<text x="118" y="60" font-size="10" fill="${N}" font-family="sans-serif">0.3 g ↑</text>`),
  scan: svg(`${floor}<circle cx="80" cy="60" r="36" fill="${C}" fill-opacity=".15" stroke="${C}" stroke-width="2" stroke-dasharray="4 3"/>${box(56, 62, 18)}${box(78, 50, 18, '#4fc3d9')}${box(92, 66, 16, '#9b7cf2')}${box(8, 62, 18)}`),
  world: svg(`<rect x="0" y="0" width="160" height="12" fill="${P}"/>${floor}${box(30, 13)}${box(110, 13, 22, '#4fc3d9')}${arrow(80, 70, 80, 22)}<text x="88" y="50" font-size="10" fill="${N}" font-family="sans-serif">flip</text>`),
  body: svg(`${floor}<rect x="140" y="0" width="20" height="84" fill="${P}"/>${person(126, 50, -90)}${arrow(100, 50, 132, 50)}`),
  bubble: svg(`${floor}<circle cx="80" cy="46" r="32" fill="${C}" fill-opacity=".18" stroke="${C}" stroke-width="2"/>${box(70, 30, 18)}${box(20, 62)}<text x="62" y="92" font-size="9" fill="${N}" font-family="sans-serif">zero-g inside</text>`),
  attract: svg(`${floor}<circle cx="35" cy="66" r="16" fill="#ef5b4f"/><circle cx="125" cy="62" r="20" fill="${N}"/>${arrow(55, 64, 76, 64)}${arrow(104, 64, 84, 64)}`),
  tk: svg(`${floor}${person(24, 82)}<path d="M34 56 Q70 30 100 40" stroke="${T}" stroke-width="2" fill="none" stroke-dasharray="4 3"/>${box(100, 28, 22, '#d9a066')}<rect x="98" y="26" width="26" height="26" rx="4" fill="none" stroke="${T}" stroke-width="2"/>${arrow(126, 39, 150, 30, T)}`),
};

export function powerHelp() {
  return [
    { id: 'object', key: 'power1', name: 'Object gravity', what: 'Change the gravity of one object: its direction, its strength (0 to 10 g) and its mass.',
      how: `Aim and left click to apply. Right click resets it. Press ${kbd('powerWheel')} to pick direction, strength and mass.`,
      tip: 'Set a box to 0.3 g pointing up and it will slowly float to the ceiling.' },
    { id: 'scan', key: 'power2', name: 'Area scan', what: 'The same as object gravity, but for every object inside a sphere.',
      how: 'Hold left click to grow the sphere, release to apply. Right click resets the last scan.',
      tip: 'Scan a pile of boxes with zero-g and push one: they all drift apart.' },
    { id: 'world', key: 'power3', name: 'World gravity', what: 'Change the gravity of the whole map: direction and strength.',
      how: `Left click makes "down" the direction you look at. Right click returns to Earth (1 g). ${kbd('powerWheel')} has presets: 0 g, Moon, Mars, Earth, 3 g, 10 g.`,
      tip: 'Look at the ceiling and click: everything, you included, falls up.' },
    { id: 'body', key: 'power4', name: 'Body gravity', what: 'Your own gravity points into a wall or ceiling, so you can walk on it.',
      how: 'Aim at a surface and left click. Right click returns you to the world gravity.',
      tip: 'You turn fast in strong gravity and slowly in weak gravity.' },
    { id: 'bubble', key: 'power5', name: 'Bubble', what: 'A sphere with its own gravity inside: zero-g, a direction, or pulling toward / pushing away from its center.',
      how: `Hold left click to grow it, release to place it. Right click deletes the bubble you aim at. ${kbd('editTarget')} applies new settings to it.`,
      tip: 'Bubbles have no gravity of their own, but objects that hit them push them around.' },
    { id: 'attract', key: 'power6', name: 'Attraction', what: 'Two objects pull each other like planets: the heavier and closer, the stronger.',
      how: 'Left click object A, then object B (or any point). Right click removes the links of the aimed object.',
      tip: 'Link a small ball to a heavy block and watch it orbit or crash into it.' },
    { id: 'tk', key: 'power7', name: 'Telekinesis', what: `Move things with your mind. You can lift up to ${TK_LIMIT_KG} kg of weight (mass × gravity).`,
      how: `Left click grabs and drops. Right click throws. Right click on a free object pushes it, Shift + right click pulls it. Hold ${kbd('rotate')} and move the mouse to rotate. Mouse wheel changes the distance. ${kbd('crush')} crushes and ${kbd('expand')} expands.`,
      tip: 'Too heavy? Lower its gravity or mass with Object gravity first, then lift it.' },
  ];
}

export function controlsHelp() {
  return [
    [`${k('forward')} ${k('left')} ${k('back')} ${k('right')}`, 'Move'], ['Mouse', 'Look'],
    [k('jump'), 'Jump (zero-g: go up)'], [k('crouch'), 'Crouch (zero-g: go down)'], [k('sprint'), 'Sprint'],
    ['1 – 7 / wheel', 'Choose a power'], ['Left click', 'Use the power'], ['Right click', 'Undo / alternate action'],
    [k('powerWheel'), 'Power settings'], [k('ragdoll'), 'Go limp / stand up'], [`${k('resetAll')} (hold)`, 'Reset all gravity'],
    [`${k('players')} (hold)`, 'Players and room code'], [k('chat'), 'Chat (multiplayer)'], ['Esc', 'Pause menu'],
  ];
}

// ---------------------------------------------------------------- first-time tips
const TIPS_KEY = 'gs_tips_seen';
function seen() { try { return new Set(JSON.parse(localStorage.getItem(TIPS_KEY) || '[]')); } catch { return new Set(); } }
export function markTip(id) { const s = seen(); s.add(id); try { localStorage.setItem(TIPS_KEY, JSON.stringify([...s])); } catch { /* ignore */ } }
export function tipSeen(id) { return seen().has(id); }
export function resetTips() { try { localStorage.removeItem(TIPS_KEY); } catch { /* ignore */ } }

export function tipFor(id) {
  if (id === 'start') {
    return { title: 'Welcome to Gravity SandBox', text: `${kbd('forward')}${kbd('left')}${kbd('back')}${kbd('right')} move · mouse look · ${kbd('jump')} jump.<br>Keys <kbd>1</kbd>–<kbd>7</kbd> choose a power, left click uses it. ${kbd('powerWheel')} opens power settings, Esc pauses.` };
  }
  const p = powerHelp().find((x) => x.id === id);
  return p ? { title: p.name, text: `${p.how}<br><em>${p.tip}</em>` } : null;
}
