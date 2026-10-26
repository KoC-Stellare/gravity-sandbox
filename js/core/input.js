import { settings } from './settings.js';

/** Keyboard + mouse state with rebindable actions. */
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.down = new Set();
    this.pressed = new Set();
    this.released = new Set();
    this.mouseDown = [false, false, false];
    this.mousePressed = [false, false, false];
    this.mouseReleased = [false, false, false];
    this.dx = 0; this.dy = 0; this.wheel = 0;
    this.mx = 0; this.my = 0;
    this.locked = false;
    this.lockTime = 0;
    this.enabled = true;
    this.onLockChange = null;
    this.captureNext = null; // for rebinding

    window.addEventListener('keydown', (e) => {
      if (this.captureNext) { e.preventDefault(); const f = this.captureNext; this.captureNext = null; f(e.code); return; }
      if (isTyping(e)) return;
      if (['Tab', 'Space', 'Backspace'].includes(e.code) || (this.locked && e.code.startsWith('Digit'))) e.preventDefault();
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
      this.released.add(e.code);
    });
    window.addEventListener('blur', () => { this.down.clear(); this.mouseDown = [false, false, false]; });
    canvas.addEventListener('mousedown', (e) => {
      this.mouseDown[e.button] = true; this.mousePressed[e.button] = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (this.mouseDown[e.button]) this.mouseReleased[e.button] = true;
      this.mouseDown[e.button] = false;
    });
    window.addEventListener('mousemove', (e) => {
      this.mx = e.clientX; this.my = e.clientY;
      // ignore the spurious jump some browsers emit right after pointer lock, and absurd spikes
      if (performance.now() - this.lockTime < 150) return;
      if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
      if (this.locked || this.freeLook) { this.dx += e.movementX; this.dy += e.movementY; }
    });
    canvas.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      this.lockTime = performance.now();
      this.dx = 0; this.dy = 0;
      if (!this.locked) { this.down.clear(); this.mouseDown = [false, false, false]; }
      this.onLockChange?.(this.locked);
    });
  }

  lock() {
    if (this.locked) return;
    const quiet = (p) => { if (p?.catch) p.catch(() => {}); };
    try {
      const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
      if (p?.catch) p.catch((e) => { if (e?.name === 'NotSupportedError') { try { quiet(this.canvas.requestPointerLock()); } catch { /* ignore */ } } });
    } catch { try { quiet(this.canvas.requestPointerLock()); } catch { /* ignore */ } }
  }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

  code(action) { return settings.get('bindings')[action]; }
  is(action) { const c = this.code(action); return this.down.has(c) || (action === 'sprint' && this.down.has('ShiftRight')); }
  hit(action) { return this.pressed.has(this.code(action)); }
  up(action) { return this.released.has(this.code(action)); }

  consumeMouse() {
    const s = settings.get('sensitivity') * 0.0022;
    const r = { dx: this.dx * s, dy: this.dy * s * (settings.get('invertY') ? -1 : 1) };
    this.dx = 0; this.dy = 0;
    return r;
  }
  consumeWheel() { const w = this.wheel; this.wheel = 0; return w; }

  endFrame() {
    this.pressed.clear(); this.released.clear();
    this.mousePressed = [false, false, false];
    this.mouseReleased = [false, false, false];
  }
}

export function isTyping(e) {
  const t = e.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}
