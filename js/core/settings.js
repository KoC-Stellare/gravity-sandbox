import { Emitter } from '../util.js';

export const DEFAULT_BINDINGS = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD',
  jump: 'Space', sprint: 'ShiftLeft', crouch: 'KeyC', ragdoll: 'KeyG',
  players: 'Tab', powerWheel: 'KeyQ', rotate: 'KeyR', crush: 'KeyZ', expand: 'KeyX',
  editTarget: 'KeyF', resetAll: 'Backspace', chat: 'Enter', fly: 'KeyV',
  power1: 'Digit1', power2: 'Digit2', power3: 'Digit3', power4: 'Digit4', power5: 'Digit5', power6: 'Digit6', power7: 'Digit7',
  spawnMenu: 'KeyB', testMap: 'KeyP', snap: 'KeyN',
};

export const BINDING_LABELS = {
  forward: 'Move forward', back: 'Move back', left: 'Move left', right: 'Move right',
  jump: 'Jump / up (zero-g)', sprint: 'Sprint', crouch: 'Crouch / down (zero-g)', ragdoll: 'Go limp / stand up',
  players: 'Player list (hold)', powerWheel: 'Power settings', rotate: 'Rotate held object (hold)',
  crush: 'Crush (shrink)', expand: 'Expand (grow)', editTarget: 'Edit aimed bubble/object gravity',
  resetAll: 'Reset all gravity (hold)', chat: 'Chat', fly: 'Toggle fly (Build Map)',
  power1: 'Object gravity', power2: 'Area scan', power3: 'World gravity', power4: 'Body gravity',
  power5: 'Bubble', power6: 'Attraction', power7: 'Telekinesis',
  spawnMenu: 'Spawn menu (Build Map)', testMap: 'Test map (Build Map)', snap: 'Grid snap (Build Map)',
};

const DEFAULTS = {
  sensitivity: 1.0, invertY: false, fov: 78, quality: 'medium', showFps: false, showTips: true,
  bindings: { ...DEFAULT_BINDINGS },
};

class Settings extends Emitter {
  constructor() {
    super();
    this.data = structuredClone(DEFAULTS);
    try {
      const s = JSON.parse(localStorage.getItem('gs_settings') || 'null');
      if (s) this.merge(s);
    } catch { /* ignore */ }
  }
  merge(s) {
    if (!s || typeof s !== 'object') return;
    const b = { ...DEFAULT_BINDINGS, ...(s.bindings || {}) };
    this.data = { ...DEFAULTS, ...s, bindings: b };
  }
  get(k) { return this.data[k]; }
  set(k, v) { this.data[k] = v; this.save(); this.emit('change', k, v); }
  bind(action, code) { this.data.bindings[action] = code; this.save(); this.emit('change', 'bindings'); }
  resetBindings() { this.data.bindings = { ...DEFAULT_BINDINGS }; this.save(); this.emit('change', 'bindings'); }
  save() {
    try { localStorage.setItem('gs_settings', JSON.stringify(this.data)); } catch { /* ignore */ }
    this.emit('saved', this.data);
  }
}

export const settings = new Settings();

export function keyLabel(code) {
  if (!code) return '—';
  return code.replace(/^Key/, '').replace(/^Digit/, '').replace('ShiftLeft', 'Shift').replace('ShiftRight', 'R-Shift')
    .replace('ControlLeft', 'Ctrl').replace('AltLeft', 'Alt').replace('Backspace', '⌫').replace('Space', 'Space');
}
