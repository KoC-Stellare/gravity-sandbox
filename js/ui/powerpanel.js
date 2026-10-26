import { h, clear } from './dom.js';
import { POWERS, DIR_MODES, BUBBLE_MODES } from '../powers/powers.js';
import { G_EARTH, TK_LIMIT_KG, MAX_G } from '../config.js';

const PRESETS = [[0, '0 g'], [0.17, 'Moon'], [0.38, 'Mars'], [1, 'Earth'], [3, '3 g'], [10, '10 g']];

/** Settings panel for the powers (opened with Q). */
export class PowerPanel {
  constructor(root, game) {
    this.root = root;
    this.game = game;
    this.open = false;
  }

  toggle(force) {
    this.open = force ?? !this.open;
    this.root.classList.toggle('show', this.open);
    if (this.open) this.render();
  }

  render() {
    const pw = this.game.powers;
    const c = pw.cfg;
    const save = () => { pw.saveCfg(); };
    const tabs = h('div.pp-tabs', POWERS.map((p, i) => h('button' + (i === pw.index ? '.on' : ''), { onclick: () => { pw.select(i); this.render(); } }, h('span', p.icon), p.short)));
    const body = h('div.pp-body');
    const id = pw.power.id;

    const slider = (label, min, max, step, val, fmt, onInput) => {
      const out = h('b', fmt(val));
      const inp = h('input', { type: 'range', min, max, step, value: val, oninput: (e) => { const v = +e.target.value; out.textContent = fmt(v); onInput(v); save(); } });
      return h('label.pp-row', h('span', label), inp, out);
    };
    const gSlider = (obj) => h('div',
      slider('Strength', 0, MAX_G, 0.01, obj.g, (v) => `${v.toFixed(2)} g · ${(v * G_EARTH).toFixed(1)} m/s²`, (v) => (obj.g = v)),
      h('div.pp-presets', PRESETS.map(([v, l]) => h('button', { onclick: () => { obj.g = v; save(); this.render(); } }, l))));
    const select = (label, options, val, onChange) => h('label.pp-row', h('span', label),
      h('select', { onchange: (e) => { onChange(e.target.value); save(); this.render(); } }, options.map((o) => h('option', { value: o.id, selected: o.id === val }, o.label))));
    const check = (label, val, onChange) => h('label.pp-check', h('input', { type: 'checkbox', checked: val, onchange: (e) => { onChange(e.target.checked); save(); this.render(); } }), label);
    const logSlider = (label, min, max, val, fmt, onInput) => slider(label, Math.log10(min), Math.log10(max), 0.01, Math.log10(val), (v) => fmt(10 ** v), (v) => onInput(+(10 ** v).toPrecision(3)));

    if (id === 'object' || id === 'scan') {
      body.append(
        h('p', id === 'scan' ? 'Area scan applies these settings to every object inside the scan sphere.' : 'Applied to the object you click.'),
        select('Direction', DIR_MODES, c.object.mode, (v) => (c.object.mode = v)),
        c.object.mode === 'look' ? check('Snap direction to nearest axis', c.object.snap, (v) => (c.object.snap = v)) : null,
        c.object.mode !== 'zero' ? gSlider(c.object) : null,
        logSlider('Mass', 0.1, 100, c.object.mass, (v) => `×${v.toPrecision(2)}`, (v) => (c.object.mass = v)),
      );
    } else if (id === 'world') {
      const w = this.game.field.world;
      body.append(
        h('p', 'Left click sets the whole map\'s "down" to where you look. Use the buttons to apply instantly.'),
        check('Snap direction to nearest axis', c.world.snap, (v) => (c.world.snap = v)),
        gSlider(c.world),
        h('div.pp-presets',
          h('button.primary', { onclick: () => this.game.send({ c: 'worldGrav', dir: [0, -1, 0], s: c.world.g * G_EARTH }) }, `Apply ↓ ${c.world.g} g`),
          h('button', { onclick: () => this.game.send({ c: 'worldGrav', dir: [0, 1, 0], s: c.world.g * G_EARTH }) }, 'Apply ↑ (flip)'),
          h('button', { onclick: () => this.game.send({ c: 'worldGrav', dir: w.dir, s: 0 }) }, 'Zero-g now'),
          h('button', { onclick: () => this.game.send({ c: 'worldGrav', dir: [0, -1, 0], s: G_EARTH }) }, 'Reset Earth')),
      );
    } else if (id === 'body') {
      body.append(
        h('p', 'Aim at a wall or ceiling and left click: your personal gravity points into it. Turning speed follows the gravity strength.'),
        check('Use world gravity strength', c.body.useWorld, (v) => (c.body.useWorld = v)),
        !c.body.useWorld ? gSlider(c.body) : null,
      );
    } else if (id === 'bubble') {
      body.append(
        h('p', 'Hold left click to grow a bubble, release to place it. Inside, its gravity replaces the world\'s. Bubbles have no gravity themselves but drift when hit.'),
        select('Gravity inside', BUBBLE_MODES, c.bubble.mode, (v) => (c.bubble.mode = v)),
        c.bubble.mode === 'look' ? check('Snap direction to nearest axis', c.bubble.snap, (v) => (c.bubble.snap = v)) : null,
        c.bubble.mode !== 'zero' ? gSlider(c.bubble) : null,
      );
    } else if (id === 'attract') {
      body.append(
        h('p', 'Pick object A, then object B (or any point). They pull each other: F = G·m₁·m₂ / d².'),
        logSlider('G (attraction)', 0.005, 20, c.attract.G, (v) => v.toPrecision(2), (v) => (c.attract.G = v)),
      );
    } else if (id === 'tk') {
      body.append(
        h('p', `Telekinesis lifts up to ${TK_LIMIT_KG} kg of effective weight (mass × gravity). Heavier? Lower its gravity or mass first.`),
        slider('Hold distance', 1.5, 25, 0.1, c.tk.dist, (v) => `${v.toFixed(1)} m`, (v) => (c.tk.dist = v)),
        h('ul.pp-list', h('li', 'LMB grab / drop · RMB throw'), h('li', 'RMB on a free object: push · Shift+RMB: pull'), h('li', 'Hold R + mouse: rotate'), h('li', 'Z crush · X expand (mass follows size)')),
      );
    }
    clear(this.root).append(h('div.pp',
      h('div.pp-head', h('h3', 'Power settings'), h('button.icon-btn', { onclick: () => this.game.closePanel() }, '✕')),
      tabs, body,
      h('div.pp-foot', 'Press Q or Esc to return to the game')));
  }
}
