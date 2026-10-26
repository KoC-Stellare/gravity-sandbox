import * as THREE from 'three';
import { h, $, clear } from './dom.js';
import { POWERS, DIR_MODES } from '../powers/powers.js';
import { settings, keyLabel } from '../core/settings.js';
import { fmtG, escapeHtml } from '../util.js';
import { MAX_OBJECTS, PUBLIC_URL } from '../config.js';

/** In-game heads-up display. */
export class Hud {
  constructor(root) {
    this.root = root;
    this.crosshair = h('div.crosshair', h('i'), h('i'), h('i'), h('i'), h('b'));
    this.flashEl = h('div.flash');
    this.target = h('div.target-info');
    this.bar = h('div.power-bar');
    this.barSlots = POWERS.map((p, i) => {
      const el = h('div.slot', h('kbd', i + 1), h('span.ic', p.icon), h('span.nm', p.short));
      this.bar.append(el);
      return el;
    });
    this.powerDetail = h('div.power-detail');
    this.compassCanvas = h('canvas.compass', { width: 150, height: 150 });
    this.compassText = h('div.compass-text');
    this.compass = h('div.compass-box', this.compassCanvas, this.compassText);
    this.room = h('div.room-panel');
    this.counters = h('div.counters');
    this.fps = h('div.fps');
    this.center = h('div.center-msg');
    this.playersList = h('div.players-list');
    this.heldBar = h('div.held-bar');
    this.tip = h('div.tip-card');
    this.tipTimer = 0;
    this.root.append(this.crosshair, this.flashEl, this.target, this.powerDetail, this.bar, this.compass, this.room, this.counters, this.fps, this.center, this.playersList, this.heldBar, this.tip);
    this.flashTimer = 0;
    this.frames = 0; this.fpsTime = 0;
    this.ctx = this.compassCanvas.getContext('2d');
  }

  show(v) { this.root.classList.toggle('hidden', !v); }

  flash(text, kind = '') {
    this.flashEl.textContent = text;
    this.flashEl.className = 'flash show ' + kind;
    this.flashTimer = kind === 'warn' ? 3 : 1.8;
  }

  showTip(t, seconds = 10) {
    this.tip.innerHTML = `<b>${t.title}</b><p>${t.text}</p><small>Tips can be turned off in Settings</small>`;
    this.tip.classList.add('show');
    this.tipTimer = seconds;
  }
  hideTip() { this.tip.classList.remove('show'); this.tipTimer = 0; }

  setCenter(text) { this.center.innerHTML = text || ''; this.center.classList.toggle('show', !!text); }

  update(dt, game) {
    const pw = game.powers;
    // fps
    this.frames++; this.fpsTime += dt;
    if (this.fpsTime > 0.5) { this.fps.textContent = Math.round(this.frames / this.fpsTime) + ' FPS'; this.frames = 0; this.fpsTime = 0; }
    this.fps.style.display = settings.get('showFps') ? '' : 'none';
    if (this.tipTimer > 0) { this.tipTimer -= dt; if (this.tipTimer <= 0) this.hideTip(); }
    if (this.flashTimer > 0) { this.flashTimer -= dt; if (this.flashTimer <= 0) this.flashEl.classList.remove('show'); }

    // power bar
    this.barSlots.forEach((el, i) => {
      el.classList.toggle('active', i === pw.index);
      el.querySelector('kbd').textContent = keyLabel(settings.get('bindings')[POWERS[i].key]);
    });
    const p = pw.power;
    this.powerDetail.innerHTML = `<b>${p.name}</b> <span>${this.powerSummary(pw)}</span><em>${p.hint}</em>`;

    // crosshair state
    const info = pw.targetInfo();
    const tk = p.id === 'tk';
    this.crosshair.className = 'crosshair' + (info ? ' on' : '') + (tk ? ' tk' : '') + (pw.hold ? ' hold' : '');
    if (info) {
      this.target.innerHTML = `<b>${escapeHtml(info.name)}</b>` + info.lines.map((l) => `<span>${escapeHtml(l)}</span>`).join('') +
        (info.heavy && tk ? '<span class="warn">too heavy to lift</span>' : '');
      this.target.classList.add('show');
    } else this.target.classList.remove('show');

    // counters
    const nObj = game.pw.countDynamic();
    this.counters.innerHTML = `<span>Objects <b>${nObj}/${MAX_OBJECTS}</b></span><span>Bubbles <b>${game.field.bubbles.length}</b></span><span>Links <b>${game.links().length}</b></span>`;

    // held
    if (pw.hold) {
      const heavy = game.tooHeavy();
      this.heldBar.innerHTML = `Holding · ${pw.cfg.tk.dist.toFixed(1)} m${heavy ? ' · <b class="warn">too heavy</b>' : ''} <em>wheel distance · ${keyLabel(settings.get('bindings').rotate)} rotate · RMB throw</em>`;
      this.heldBar.classList.add('show');
    } else this.heldBar.classList.remove('show');

    // room panel
    if (game.net) {
      const players = game.playerList();
      this.room.innerHTML = `<div class="code">ROOM <b>${game.net.code}</b></div>` + players.map((pl) =>
        `<div class="pl"><i style="background:${pl.color}"></i>${escapeHtml(pl.name)}${pl.host ? ' <small>host</small>' : ''}${pl.me ? ' <small>you</small>' : ''}</div>`).join('');
      this.room.style.display = '';
    } else this.room.style.display = 'none';

    this.drawCompass(game);
  }

  powerSummary(pw) {
    const c = pw.cfg;
    const mode = (m) => DIR_MODES.find((d) => d.id === m)?.label || ({ in: 'Toward center', out: 'Away from center' })[m] || m;
    switch (pw.power.id) {
      case 'object': case 'scan': return c.object.mode === 'zero' ? 'zero-g' : `${mode(c.object.mode)} · ${fmtG(c.object.g * 9.81)} · mass ×${c.object.mass}`;
      case 'world': return `${fmtG(c.world.g * 9.81)} toward where you look${c.world.snap ? ' (snapped)' : ''}`;
      case 'body': return c.body.useWorld ? 'world strength' : fmtG(c.body.g * 9.81);
      case 'bubble': return c.bubble.mode === 'zero' ? 'zero-g inside' : `${mode(c.bubble.mode)} · ${fmtG(c.bubble.g * 9.81)}`;
      case 'attract': return `G = ${c.attract.G}` + (pw.attractA != null ? ' · pick B' : '');
      case 'tk': return pw.hold ? 'holding' : 'aim at anything';
    }
    return '';
  }

  drawCompass(game) {
    const ctx = this.ctx, W = 150, C = 75;
    ctx.clearRect(0, 0, W, W);
    const cam = game.renderer.camera;
    const inv = cam.quaternion.clone().invert();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath(); ctx.arc(C, C, 52, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath(); ctx.arc(C, C, 30, 0, Math.PI * 2); ctx.stroke();
    // world axes projected (small)
    const axes = [[1, 0, 0, '#ef5b4f', 'X'], [0, 1, 0, '#5cc46a', 'Y'], [0, 0, 1, '#4fa3d9', 'Z']];
    for (const [x, y, z, col, lab] of axes) {
      const v = new THREE.Vector3(x, y, z).applyQuaternion(inv);
      ctx.strokeStyle = col; ctx.globalAlpha = v.z > 0 ? 0.35 : 0.8;
      ctx.beginPath(); ctx.moveTo(C, C); ctx.lineTo(C + v.x * 22, C - v.y * 22); ctx.stroke();
      ctx.fillStyle = col; ctx.font = '9px sans-serif'; ctx.fillText(lab, C + v.x * 26 - 3, C - v.y * 26 + 3);
    }
    ctx.globalAlpha = 1;
    const arrow = (vec, col, len) => {
      if (vec.lengthSq() < 1e-6) { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(C, C, 5, 0, Math.PI * 2); ctx.fill(); return; }
      const v = vec.clone().normalize().applyQuaternion(inv);
      const ex = C + v.x * len, ey = C - v.y * len;
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 3; ctx.globalAlpha = v.z > 0.3 ? 0.55 : 1;
      ctx.beginPath(); ctx.moveTo(C, C); ctx.lineTo(ex, ey); ctx.stroke();
      const a = Math.atan2(ey - C, ex - C);
      ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(ex - 9 * Math.cos(a - 0.45), ey - 9 * Math.sin(a - 0.45)); ctx.lineTo(ex - 9 * Math.cos(a + 0.45), ey - 9 * Math.sin(a + 0.45)); ctx.fill();
      ctx.globalAlpha = 1; ctx.lineWidth = 1;
    };
    const w = game.field.world;
    const wv = new THREE.Vector3(...w.dir).multiplyScalar(w.s > 0 ? 1 : 0);
    arrow(wv, '#ffffff', 50);
    const pg = game.player.gravity;
    arrow(pg, '#35d0e6', 38);
    this.compassText.innerHTML = `<span class="w">World ${fmtG(w.s)}</span><span class="p">You ${fmtG(pg.length())}${game.player.personalG ? ' · surface' : ''}</span>`;
  }

  /** Tab list */
  showPlayers(show, game) {
    this.playersList.classList.toggle('show', !!show);
    if (!show) return;
    const list = game.playerList();
    clear(this.playersList).append(
      h('h4', game.net ? `Room ${game.net.code}` : 'Singleplayer'),
      ...list.map((p) => h('div.row', h('i', { style: { background: p.color } }), p.name, p.host ? h('small', 'host') : null)),
      game.net ? h('p.small', 'Invite link: ', h('code', `${PUBLIC_URL}/join/${game.net.code}`)) : null,
    );
  }
}
