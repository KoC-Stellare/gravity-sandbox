// Guided tutorial in The Lab: one task at a time, each one completes when the player does it.
import { h, clear } from './dom.js';
import { kbd } from './help.js';
import { G_EARTH } from '../config.js';

function steps() {
  return [
    { id: 'move', title: 'Move around', text: () => `Walk with ${kbd('forward')}${kbd('left')}${kbd('back')}${kbd('right')} and look with the mouse. Walk a few meters.`,
      check: (g, s) => g.player.getFeet().distanceTo(s.start) > 4 },
    { id: 'jump', title: 'Jump', text: () => `Press ${kbd('jump')} to jump.`,
      check: (g) => !g.player.grounded && g.player.vel.dot(g.player.getUp()) > 1 },
    { id: 'object', title: 'Object gravity', text: () => 'Press <kbd>1</kbd> for Object gravity. Aim at a box and left click: it now falls toward where you were looking. Right click on it resets it.',
      check: (g, s) => s.cmd('objGrav', (c) => c.ids.length === 1) },
    { id: 'panel', title: 'Power settings', text: () => `Press ${kbd('powerWheel')} to open the power settings. Pick the direction "Up" and the "Moon" preset, then press ${kbd('powerWheel')} again to close.`,
      check: (g, s) => { if (g.panel.open) s.opened = true; return s.opened && !g.panel.open; } },
    { id: 'float', title: 'Make it float', text: () => 'With those settings, left click a box. It floats up slowly, like on the Moon.',
      check: (g, s) => s.cmd('objGrav', (c) => c.ids.length === 1 && c.dir[1] > 0.5) },
    { id: 'scan', title: 'Area scan', text: () => 'Press <kbd>2</kbd>. Hold left click on the pile of boxes to grow the sphere, then release: every object inside changes at once.',
      check: (g, s) => s.cmd('objGrav', (c) => c.ids.length >= 2) },
    { id: 'grab', title: 'Telekinesis', text: () => 'Press <kbd>7</kbd>. Aim at a ball or a small box and left click to grab it. Move the mouse to carry it.',
      check: (g) => g.holdOf(g.slot) != null },
    { id: 'throw', title: 'Throw', text: () => 'While holding it, right click to throw it.',
      check: (g, s) => s.cmd('tkThrow') },
    { id: 'resize', title: 'Crush and expand', text: () => `Aim at an object and press ${kbd('expand')} to make it bigger, or ${kbd('crush')} to crush it smaller. Its mass changes with its size.`,
      check: (g, s) => s.cmd('tkResize') },
    { id: 'heavy', title: 'Too heavy?', text: () => `The grey concrete blocks weigh 2.4 tonnes, too heavy to lift. Press ${kbd('powerWheel')}, set Mass to ×0.1, close it, then use Object gravity (<kbd>1</kbd>) on a concrete block. Now grab it with telekinesis (<kbd>7</kbd>).`,
      check: (g) => { const id = g.holdOf(g.slot); const o = id != null && g.pw.objects.get(id); return !!o && (o.type === 'steelblock' || o.type === 'concrete'); } },
    { id: 'bubble', title: 'Gravity bubble', text: () => 'Press <kbd>5</kbd>. Hold left click to grow a bubble, release to place it. Inside it there is no gravity: push things into it.',
      check: (g, s) => s.cmd('bubbleAdd') },
    { id: 'attract', title: 'Attraction', text: () => 'Press <kbd>6</kbd>. Left click one ball, then another object: they pull each other together.',
      check: (g, s) => s.cmd('linkAdd') },
    { id: 'wall', title: 'Walk on walls', text: () => 'Press <kbd>4</kbd>. Look at a wall and left click. You fall toward it and land on it.',
      check: (g) => !!g.player.personalG && g.player.getUp().y < 0.3 && g.player.grounded },
    { id: 'back', title: 'Back to the floor', text: () => 'Right click with Body gravity selected to return to the normal gravity.',
      check: (g) => !g.player.personalG && g.player.getUp().y > 0.95 && g.player.grounded },
    { id: 'world', title: 'World gravity', text: () => 'Press <kbd>3</kbd>. Look up at the ceiling and left click: the whole room falls up, you too.',
      check: (g, s) => s.cmd('worldGrav', (c) => c.dir[1] > 0.5 || c.s < G_EARTH * 0.9) },
    { id: 'reset', title: 'Reset everything', text: () => `Hold ${kbd('resetAll')} for one second to reset all gravity in the room.`,
      check: (g, s) => s.cmd('resetAll') },
    { id: 'ragdoll', title: 'Go limp', text: () => `Press ${kbd('ragdoll')} to go limp like a mannequin, then press ${kbd('ragdoll')} again to stand up.`,
      check: (g, s) => { if (g.player.ragdolled) s.limp = true; return s.limp && !g.player.ragdolled; } },
  ];
}

export class Tutorial {
  constructor(game) {
    this.game = game;
    this.steps = steps();
    this.i = 0;
    this.done = false;
    this.el = h('div.tutorial');
    document.getElementById('hud').append(this.el);
    this.cmds = [];
    this.off = game.on('cmd', (c) => this.cmds.push(c));
    this.enterStep();
  }

  enterStep() {
    const g = this.game;
    this.cmds = [];
    const cmds = () => this.cmds;
    this.state = {
      start: g.player.getFeet().clone(),
      cmd: (name, pred) => cmds().some((c) => c.c === name && (!pred || pred(c))),
    };
    this.doneTimer = 0;
    this.render();
  }

  render(flash = false) {
    clear(this.el);
    if (this.done) {
      this.el.append(h('div.tut-head', h('b', 'Tutorial complete')),
        h('h4', 'You know all the powers'),
        h('p', { html: `Keep playing here, or press Esc and leave to try the other maps and Build Map. Everything can be combined: try a bubble inside a flipped room.` }));
      this.el.classList.add('complete');
      return;
    }
    const s = this.steps[this.i];
    this.el.classList.toggle('ok', flash);
    this.el.append(
      h('div.tut-head', h('b', `Tutorial · ${this.i + 1}/${this.steps.length}`), h('span', 'Esc → skip step or exit')),
      h('h4', (flash ? '✓ ' : '') + s.title),
      h('p', { html: s.text() }),
      h('div.tut-bar', h('i', { style: { width: `${(this.i / this.steps.length) * 100}%` } })));
  }

  update(dt) {
    if (this.done) { this.endTimer -= dt; if (this.endTimer <= 0) this.destroy(); return; }
    const g = this.game;
    if (this.doneTimer > 0) {
      this.doneTimer -= dt;
      if (this.doneTimer <= 0) this.next();
      return;
    }
    let ok = false;
    try { ok = this.steps[this.i].check(g, this.state); } catch { ok = false; }
    if (ok) { this.doneTimer = 1.1; this.render(true); }
  }

  next() {
    this.i++;
    if (this.i >= this.steps.length) {
      this.done = true;
      this.endTimer = 12;
      try { localStorage.setItem('gs_tut_done', '1'); } catch { /* ignore */ }
      this.render();
      return;
    }
    this.enterStep();
  }

  skip() { if (!this.done) this.next(); }

  destroy() {
    this.off?.();
    this.el.remove();
    if (this.game.tutorial === this) this.game.tutorial = null;
  }
}

