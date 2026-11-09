// Game test suite: solo play, player movement at several frame rates, hostile input, editor, two-player room.
// usage: node tests/run.mjs [gamePath=/] [port=8801] [siteRoot=repository]   (see tests/README.md)
import { serve, launch, openPage, checker, ROOT } from './lib.mjs';

const gamePath = process.argv[2] || '/';
const port = +(process.argv[3] || 8801);
const root = process.argv[4] || ROOT;
const base = `http://localhost:${port}`;
const srv = await serve(root, port);
const browser = await launch();
const { ok, done } = checker();
const log = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function section(names, fn) { try { await fn(); } catch (e) { for (const n of names) ok(n, false, 'crashed: ' + String(e.message || e).split('\n')[0]); } }
async function fresh(ctx) {
  const p = await openPage(ctx, base, { log, path: gamePath });
  await p.evaluate(async () => { const { getDefaultMap } = await import('/js/maps/defaults.js'); __gs.playSolo(getDefaultMap('lab')); });
  await sleep(1500);
  return p;
}

try {
  // ------------------------------------------------------------------ SOLO
  let ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  let solo = await openPage(ctx, base, { log, path: gamePath });
  await solo.evaluate(async () => { const { getDefaultMap } = await import('/js/maps/defaults.js'); __gs.playSolo(getDefaultMap('lab')); });
  await sleep(2500);
  const s1 = await solo.evaluate(() => ({ mode: __gs.game.mode, n: __gs.game.pw.objects.size, feet: __gs.game.player.getFeet().toArray() }));
  ok('solo: The Lab starts', s1.mode === 'play' && s1.n > 50, JSON.stringify(s1));

  const cmds = await solo.evaluate(async () => {
    const g = __gs.game, sim = g.sim, pw = sim.pw;
    const step = (n) => { for (let i = 0; i < n; i++) sim.update(1 / 60); };
    const box = [...pw.objects.values()].find((o) => o.type === 'box');
    const y0 = pw.objPos(box).y;
    g.send({ c: 'objGrav', ids: [box.id], dir: [0, 1, 0], s: 9.81, massMul: 1 }); step(60);
    const rose = pw.objPos(box).y - y0;
    g.send({ c: 'objReset', ids: [box.id] });
    g.send({ c: 'bubbleAdd', pos: [0, 3, 0], r: 2, mode: 'zero', dir: [0, -1, 0], s: 0 });
    const balls = [...pw.objects.values()].filter((o) => o.type === 'ball');
    g.send({ c: 'linkAdd', a: balls[0].id, b: balls[1].id, G: 5 });
    const d0 = pw.objPos(balls[0]).distanceTo(pw.objPos(balls[1])); step(120);
    const d1 = pw.objPos(balls[0]).distanceTo(pw.objPos(balls[1]));
    g.send({ c: 'tkGrab', id: balls[2].id }); g.send({ c: 'tkAim', target: [0, 5, 0], rot: null }); step(120);
    const heldY = pw.objPos(balls[2]).y; const held = g.holdOf(0);
    g.send({ c: 'tkThrow', dir: [1, 0, 0] }); step(5);
    const thrown = pw.mainBody(balls[2]).linvel().x;
    g.send({ c: 'tkResize', id: box.id, f: 1.25 });
    g.send({ c: 'worldGrav', dir: [0, -1, 0], s: 0 }); step(30);
    g.send({ c: 'resetAll' }); step(30);
    g.send({ c: 'ragdoll', vel: [0, 0, 0] }); step(120);
    const rag = g.player.ragdolled; g.send({ c: 'recover' }); step(10);
    return { rose, bubbles: 1, links: d0 - d1, heldY, held: held === balls[2].id, thrown, scale: box.scale, world: sim.field.world.s, rag, recovered: !g.player.ragdolled };
  });
  ok('solo: object gravity lifts a box', cmds.rose > 1, cmds.rose.toFixed(2));
  ok('solo: attraction pulls two balls together', cmds.links > 0.05, cmds.links.toFixed(3));
  ok('solo: telekinesis holds, then throws', cmds.held && cmds.heldY > 3 && cmds.thrown > 3, `${cmds.heldY.toFixed(2)} ${cmds.thrown.toFixed(1)}`);
  ok('solo: resize + resetAll + ragdoll/recover', Math.abs(cmds.scale - 1.25) < 1e-6 && Math.abs(cmds.world - 9.81) < 1e-6 && cmds.rag && cmds.recovered, JSON.stringify(cmds));

  await solo.close();
  solo = await fresh(ctx);
  await section(['robust: malformed player commands are rejected without throwing', 'robust: simulation keeps running with finite positions afterwards'], async () => {
  // malformed commands from a (simulated) remote player must not break the host's simulation
  const bad = await solo.evaluate(() => {
    const sim = __gs.game.sim, pw = sim.pw;
    const id = [...pw.objects.values()].find((o) => o.type === 'crate').id;
    const evil = [
      { c: 'worldGrav', dir: null, s: 5 }, { c: 'worldGrav', dir: [NaN, 'x', 0], s: NaN }, { c: 'objGrav', ids: [id], dir: 'abc', s: 1e99, massMul: NaN },
      { c: 'objGrav', ids: 'nope' }, { c: 'bubbleAdd', pos: 'x', r: NaN, mode: {}, dir: null, s: null }, { c: 'bubbleAdd', pos: [1e30, NaN, 0], r: 2, mode: 'in', dir: [0, 0, 0], s: 3 },
      { c: 'bubbleEdit', id: 1, dir: 7, s: 'a' }, { c: 'linkAdd', a: id, point: 'zz', G: NaN }, { c: 'linkAdd', a: id, b: id, G: 1 }, { c: 'tkGrab', id, target: [NaN, 0, 0] },
      { c: 'tkAim', target: null }, { c: 'tkAim', target: [NaN, Infinity, 0], rot: ['a', 2, 3] }, { c: 'tkThrow', dir: null }, { c: 'tkPush', id, dir: [NaN, 0, 0] },
      { c: 'tkResize', id, f: NaN }, { c: 'tkResize', id, f: -5 }, { c: 'ragdoll', vel: 'x', feet: [NaN, 0, 0], quat: [0, 0, 0, 0] }, { c: 'toString' }, null, 5, { c: 'objReset', ids: [{}] },
    ];
    let threw = 0;
    for (const cmd of evil) { try { sim.command(1, cmd); } catch { threw++; } }
    let stepErr = null;
    try { for (let i = 0; i < 120; i++) sim.update(1 / 60); } catch (e) { stepErr = String(e.message || e); }
    let finite = true;
    for (const o of pw.objects.values()) { const p = pw.objPos(o); if (![p.x, p.y, p.z].every(Number.isFinite)) finite = false; }
    try { sim.command(0, { c: 'resetAll' }); } catch { /* ignore */ }
    return { threw, stepErr, finite };
  });
  ok('robust: malformed player commands are rejected without throwing', bad.threw === 0, `threw ${bad.threw}`);
  ok('robust: simulation keeps running with finite positions afterwards', !bad.stepErr && bad.finite, JSON.stringify(bad));

  });
  await solo.close();
  solo = await fresh(ctx);
  await section(['robust: a corrupted shared map loads safely'], async () => {
  const badMap = await solo.evaluate(async () => {
    const { sanitizeMap } = await import('/js/maps/defaults.js');
    try {
      const m = sanitizeMap({ name: 'x', spawns: [], bounds: { min: [5, 5, 5], max: [-5, -5, -5] }, statics: [{ pos: [0, -1, 0], size: [20, 1, 20] }, null, 'junk'],
        objects: [{ type: 'constructor', pos: [0, 0, 0] }, { type: 'box', pos: [0, 2, 0], scale: NaN, massMul: -3, grav: { dir: 'x', s: 1 }, quat: 'q', color: 5, material: 'nope' }, null, { type: 'ball', pos: [1, 2, 0], scale: 1e9 }] });
      __gs.game.start(m, 'solo');
      for (let i = 0; i < 60; i++) __gs.game.sim.update(1 / 60);
      const g = __gs.game;
      g.player.teleport(g.player.center.clone().setY(-500)); g.update(1 / 60);   // forces the respawn path
      return { ok: true, n: g.pw.objects.size, spawns: m.spawns.length, bounds: m.bounds };
    } catch (e) { return { ok: false, err: String(e.message || e) }; }
  });
  ok('robust: a corrupted shared map loads safely', badMap.ok && badMap.spawns >= 1, JSON.stringify(badMap));

  });
  await solo.close();
  solo = await fresh(ctx);
  await section(['efficiency: idle HUD does not rewrite the DOM every frame'], async () => {
  // HUD work per frame
  const hud = await solo.evaluate(async () => {
    const { getDefaultMap } = await import('/js/maps/defaults.js');
    __gs.game.start(getDefaultMap('lab'), 'solo');
    await new Promise((r) => setTimeout(r, 600));
    let n = 0;
    const g = __gs.game;
    g.hud.update(1 / 60, g);
    const mo = new MutationObserver((l) => { n += l.length; });
    mo.observe(document.querySelector('#hud'), { childList: true, subtree: true, characterData: true, attributes: true });
    for (let i = 0; i < 120; i++) g.hud.update(1 / 60, g);   // two seconds of frames with nothing changing
    n += mo.takeRecords().length;
    mo.disconnect();
    return n;
  });
  ok('efficiency: idle HUD does not rewrite the DOM every frame', hud < 20, `${hud} DOM changes in 120 identical frames`);

  });
  await solo.close();
  solo = await fresh(ctx);
  await section(['editor: spawn, test, back to editor, exit', 'efficiency: editing an item does not leak GPU geometry'], async () => {
  // editor
  const ed = await solo.evaluate(async () => {
    const { getDefaultMap } = await import('/js/maps/defaults.js');
    __gs.game.leave();
    __gs.openEditor(getDefaultMap('room'), null);
    const e = __gs.editor;
    e.spawnAt({ point: new (await import('three')).Vector3(0, 0, 0), normal: new (await import('three')).Vector3(0, 1, 0), item: null });
    const info = __gs.renderer.renderer.info;
    __gs.renderer.render(0.016);
    const g0 = info.memory.geometries;
    let it = e.items[e.items.length - 1];
    for (let i = 0; i < 40; i++) { it.data.size = [1 + i * 0.01, 1, 1]; it = e.refreshItem(it); __gs.renderer.render(0.016); }
    const g1 = info.memory.geometries;
    e.test();
    await new Promise((r) => setTimeout(r, 500));
    const testing = __gs.game.mode === 'play' && __gs.testing;
    __gs.game.leave();
    await new Promise((r) => setTimeout(r, 300));
    const back = e.active && e.map.objects.length === 1;
    e.dirty = false; e.exit();
    return { leak: g1 - g0, testing, back, menu: !document.querySelector('#menu').classList.contains('hidden') };
  });
  ok('editor: spawn, test, back to editor, exit', ed.testing && ed.back && ed.menu, JSON.stringify(ed));
  ok('efficiency: editing an item does not leak GPU geometry', ed.leak <= 1, `${ed.leak} geometries leaked in 40 edits`);

  });
  await solo.close();
  // ---------------- player movement at several frame rates (frames are stepped by hand)
  const MOVE = ['move: no hopping while walking on a flat floor', 'move: jump height is the same at every frame rate', 'move: stairs and ramp are climbed without being catapulted',
    'move: walking off an edge falls to the floor; a 10 m fall takes 1.43 s', 'move: wall walking and standing on a loose crate', 'low fps: game time stays real time at 10 fps'];
  solo = await fresh(ctx);
  await section(MOVE, async () => {
    const mv = await solo.evaluate(async () => {
      const THREE = await import('three');
      const { getDefaultMap } = await import('/js/maps/defaults.js');
      const g = __gs.game; g.update = () => {};
      const idle = { x: 0, z: 0, jump: false, sprint: false, crouch: false, up: 0 };
      const fwd = { ...idle, z: 1 };
      const res = {};
      for (const hz of [10, 30, 60, 144]) {
        const dt = 1 / hz, r = (res[hz] = {});
        // scene(map, feet, yaw): a map without loose objects, player placed and settled
        const scene = (map, feet, yaw = 0, keep = false) => {
          __gs.playSolo(getDefaultMap(map));
          if (!keep) for (const o of [...g.sim.pw.objects.values()]) g.sim.pw.removeObject(o.id);
          g.player.teleport(new THREE.Vector3(...feet)); g.player.yaw = yaw;
          run(0.6, idle);
        };
        // run(seconds, move): returns stats over those frames
        const run = (secs, move, until) => {
          const p = g.player; let air = 0, top = -1e9, i = 0; const n = Math.round(secs * hz);
          for (; i < n && !(until && until(p.getFeet())); i++) { p.update(dt, typeof move === 'function' ? move(i * dt) : move); g.sim.update(dt); if (!p.grounded) air++; top = Math.max(top, p.getFeet().y); }
          return { air: air / Math.max(i, 1), top, feet: p.getFeet().toArray(), grounded: p.grounded, secs: i * dt };
        };
        scene('room', [0, 0.1, 10]);
        const t0 = g.sim.time; run(1, idle); r.simSecond = g.sim.time - t0;
        const w = run(3, fwd); r.flatAir = w.air; r.flatTop = w.top; r.flatDist = 10 - w.feet[2];
        run(0.5, idle);
        const j = run(1.6, (t) => (t < dt ? { ...idle, jump: true } : idle)); r.jumpTop = j.top; r.jumpLanded = j.grounded && Math.abs(j.feet[1] - 0.031) < 0.02;
        // The Lab stairs (x=-14): 10 steps of 0.4 m from z=8 to z=2, then a block 4 m high until z=-3.7
        scene('lab', [-14, 0.1, 10]);
        const st = run(6, fwd, (f) => f.z < 0.5); const stEnd = run(1, idle); r.stairsTop = Math.max(st.top, stEnd.top); r.stairsEnd = stEnd.feet; r.stairsGrounded = stEnd.grounded;
        const off = run(6, fwd, (f) => f.z < -5.5); const offEnd = run(1.5, idle); r.edgeEnd = offEnd.feet; r.edgeGrounded = offEnd.grounded;
        // The Lab ramp: walk +x from the floor up onto the platform (top at y=2.04)
        scene('lab', [0.5, 0.1, -13], -Math.PI / 2);
        const rp = run(6, fwd, (f) => f.x > 10); const rpEnd = run(1, idle); r.rampTop = Math.max(rp.top, rpEnd.top); r.rampEnd = rpEnd.feet; r.rampGrounded = rpEnd.grounded;
        // wall walking in the empty room: gravity toward the +x wall, then walk along the wall
        scene('room', [12, 0.1, 0]);
        g.player.personalG = { dir: [1, 0, 0], s: 9.81 };
        run(3, idle); const wl = run(1.5, fwd); r.wallEnd = wl.feet; r.wallAir = wl.air; r.wallUpX = g.player.getUp().x;
        // fall from 10 m
        scene('room', [0, 0.1, 0]);
        g.player.teleport(new THREE.Vector3(5, 10.031, 5)); g.sim.update(1 / 60); g.player.grounded = false; g.player.vel.set(0, 0, 0);
        let landed = null; for (let i = 0; i < hz * 3 && landed == null; i++) { g.player.update(dt, idle); g.sim.update(dt); if (g.player.grounded) landed = (i + 1) * dt; }
        r.fall = landed;
        // standing on a loose crate (1.2 m): stays on it, counted as on the ground
        scene('room', [0, 0.1, 0]);
        g.sim.pw.addObject({ type: 'crate', pos: [6, 0.61, 6] }); run(0.5, idle);
        g.player.teleport(new THREE.Vector3(6, 1.26, 6)); const cr = run(2, idle); r.crate = { feet: cr.feet, air: cr.air };
      }
      return res;
    });
    const all = (f) => Object.entries(mv).every(([hz, r]) => f(r, +hz));
    const show = (f) => Object.entries(mv).map(([hz, r]) => `${hz}fps ${f(r)}`).join(', ');
    ok('low fps: game time stays real time at 10 fps', Math.abs(mv[10].simSecond - 1) < 0.02, `1 s of frames = ${mv[10].simSecond.toFixed(3)} s of physics`);
    ok('move: no hopping while walking on a flat floor', all((r) => r.flatAir === 0 && r.flatTop < 0.045 && r.flatDist > 14 && r.flatDist < 15.2), show((r) => `air ${(r.flatAir * 100).toFixed(0)}% top ${r.flatTop.toFixed(3)} m`));
    ok('move: jump height is the same at every frame rate', all((r) => r.jumpTop > 1.34 && r.jumpTop < 1.45 && r.jumpLanded), show((r) => r.jumpTop.toFixed(2) + ' m'));
    ok('move: stairs and ramp are climbed without being catapulted', all((r) => r.stairsGrounded && Math.abs(r.stairsEnd[1] - 4.03) < 0.05 && r.stairsTop < 5 && r.rampGrounded && Math.abs(r.rampEnd[1] - 2.07) < 0.06 && r.rampTop < 2.6),
      show((r) => `stairs ${r.stairsEnd[1].toFixed(2)} (max ${r.stairsTop.toFixed(2)}) ramp ${r.rampEnd[1].toFixed(2)} (max ${r.rampTop.toFixed(2)})`));
    ok('move: walking off an edge falls to the floor; a 10 m fall takes 1.43 s', all((r, hz) => r.edgeGrounded && Math.abs(r.edgeEnd[1] - 0.03) < 0.03 && Math.abs(r.fall - 1.428) < 0.03 + 1.5 / hz),
      show((r) => `floor ${r.edgeEnd[1].toFixed(2)} fall ${r.fall?.toFixed(2)} s`));
    ok('move: wall walking and standing on a loose crate', all((r) => r.wallUpX < -0.99 && Math.abs(r.wallEnd[0] - 19.97) < 0.03 && r.wallEnd[2] < -5 && r.wallAir < 0.1 && r.crate.air < 0.05 && Math.abs(r.crate.feet[1] - 1.24) < 0.06),
      show((r) => `wall x ${r.wallEnd[0].toFixed(2)} z ${r.wallEnd[2].toFixed(1)} air ${(r.wallAir * 100).toFixed(0)}% crate y ${r.crate.feet[1].toFixed(2)} air ${(r.crate.air * 100).toFixed(0)}%`));
  });
  await solo.close();
  solo = await fresh(ctx);
  await solo.evaluate(() => __gs.game.leave());
  // feedback panel
  const fb = await solo.evaluate(async () => {
    document.querySelector('.fb-link').click();
    const open = !!document.querySelector('.feedback-wrap') && __gs.input.suspended;
    document.querySelector('.feedback-wrap .icon-btn').click();
    return open && !document.querySelector('.feedback-wrap') && !__gs.input.suspended;
  });
  ok('feedback: panel opens and closes', fb);
  await ctx.close();

  // ------------------------------------------------------------------ MULTIPLAYER
  ctx = await browser.newContext({ viewport: { width: 1000, height: 600 } });
  const host = await openPage(ctx, base, { log, path: gamePath, user: { id: '00000000-0000-4000-8000-000000000001', name: 'HostPlayer', color: '#f28c28' } });
  const ch0 = await host.evaluate(() => window.__stubChannels);
  await host.evaluate(async () => { const { settings } = await import('/js/core/settings.js'); __gs.menu.show('settings'); document.querySelector('.settings-grid').dataset.mark = '1'; settings.set('fov', 80); });
  try { await host.waitForFunction(() => window.__stubCalls.some((c) => c.table === 'profiles' && c.op === 'update'), null, { timeout: 10000 }); } catch { /* reported below */ }
  await sleep(1200);
  const afterSet = await host.evaluate(() => ({ ch: window.__stubChannels, kept: !!document.querySelector('.settings-grid[data-mark]'), saved: window.__stubCalls.some((c) => c.table === 'profiles' && c.op === 'update') }));
  ok('settings: saved to the account', afterSet.saved);
  ok('efficiency: saving settings does not reconnect Realtime channels', afterSet.ch === ch0, `${ch0} -> ${afterSet.ch} channels`);
  ok('settings: screen is not rebuilt under the player after auto-save', afterSet.kept);

  await host.evaluate(async () => { const { getDefaultMap } = await import('/js/maps/defaults.js'); __gs.hostRoom(getDefaultMap('lab')); });
  await host.waitForFunction(() => __gs.game.role === 'host' && __gs.game.net?.code, null, { timeout: 20000 });
  const code = await host.evaluate(() => __gs.game.net.code);
  const client = await openPage(ctx, base, { log, path: gamePath, user: { id: '00000000-0000-4000-8000-000000000002', name: 'Guest_Two', color: '#9b7cf2' } });
  // a hostile client: tampered colour and name in the handshake
  await client.evaluate(async (c) => {
    const { account } = await import('/js/net/supa.js');
    account.profile.color = 'red"></i><img id="xss1" src="x" onerror="window.__xss=1"><i x="';
    __gs.joinRoom(c);
  }, code);
  let joined = true;
  try { await client.waitForFunction(() => __gs.game.role === 'client' && __gs.game.mode === 'play', null, { timeout: 30000 }); } catch { joined = false; }
  ok('multiplayer: client joins the room over WebRTC', joined);
  if (joined) {
    await sleep(2500);
    const xss = await host.evaluate(() => ({ fired: !!window.__xss, el: !!document.querySelector('#xss1'), color: __gs.game.playerList().find((p) => !p.me)?.color }));
    ok('security: a tampered player colour cannot inject HTML into the host', !xss.fired && !xss.el, JSON.stringify(xss));
    const sync = await host.evaluate(() => ({ n: __gs.game.pw.objects.size, remote: __gs.game.remote.size }));
    const csync = await client.evaluate(() => ({ n: __gs.game.pw.objects.size, remote: __gs.game.remote.size, slot: __gs.game.slot }));
    ok('multiplayer: both sides see the same objects and each other', sync.n === csync.n && sync.remote === 1 && csync.remote === 1 && csync.slot === 1, JSON.stringify({ sync, csync }));
    // client changes gravity of one box; host applies it; client sees it move
    const id = await client.evaluate(() => { const o = [...__gs.game.pw.objects.values()].find((x) => x.type === 'box'); __gs.game.send({ c: 'objGrav', ids: [o.id], dir: [0, 1, 0], s: 9.81, massMul: 1 }); return o.id; });
    const t0 = await host.evaluate(() => __gs.game.sim.time);
    await host.waitForFunction((t) => __gs.game.sim.time > t + 1.5, t0, { timeout: 60000 });
    await sleep(400);
    const hy = await host.evaluate((i) => { const o = __gs.game.pw.objects.get(i); return { y: __gs.game.pw.objPos(o).y, grav: o.grav }; }, id);
    const cy = await client.evaluate((i) => __gs.game.pw.objPos(__gs.game.pw.objects.get(i)).y, id);
    ok('multiplayer: client power is applied by the host and mirrored back', hy.grav && hy.y > 2 && cy > 1.2 && Math.abs(hy.y - cy) < 6, `host ${hy.y.toFixed(2)} client ${cy.toFixed(2)}`);
    await host.evaluate(() => __gs.game.sendChat('hello from host'));
    await client.evaluate(() => __gs.game.sendChat('hello from client'));
    await sleep(600);
    const chat = await client.evaluate(() => document.querySelector('#chat .chat-list').textContent);
    const hchat = await host.evaluate(() => document.querySelector('#chat .chat-list').textContent);
    ok('multiplayer: chat both ways', chat.includes('hello from host') && hchat.includes('hello from client'));
    // hostile messages straight on the data channel
    await client.evaluate(() => {
      const n = __gs.game.net;
      n.toHost({ t: 'cmd', cmd: { c: 'worldGrav', dir: null, s: 3 } });
      n.toHost({ t: 'cmd', cmd: { c: 'tkAim', target: [NaN, NaN, NaN] } });
      n.toHost({ t: 'pose', p: [NaN, 'a', 0], q: [0, 0, 0, 0], v: null });
      n.toHost({ t: 'pose', p: 'x', q: 5 });
      n.toHost({ t: 'chat', text: { toString: 1 } });
      n.toHost('not json at all');
      n.toHost(null);
    });
    await sleep(1500);
    const alive = await host.evaluate(() => { const g = __gs.game; const t0 = g.sim.time; return new Promise((r) => setTimeout(() => { const w = g.sim.field.world; r({ advanced: g.sim.time - t0, dirOk: Array.isArray(w.dir) && w.dir.every(Number.isFinite), remote: g.remote.size }); }, 700)); });
    ok('robust: hostile network messages do not stop the host', alive.advanced > 0.2 && alive.dirOk, JSON.stringify(alive));
    await client.evaluate(() => __gs.game.leave());
    await sleep(6500);
    const left = await host.evaluate(() => ({ remote: __gs.game.remote.size, players: __gs.game.sim.players.size, mode: __gs.game.mode }));
    ok('multiplayer: host notices the client leaving', left.remote === 0 && left.players === 1 && left.mode === 'play', JSON.stringify(left));
  }
  // invites: only well-formed ones are shown
  const inv = await host.evaluate(async () => {
    const { social } = await import('/js/net/social.js');
    document.querySelector('#invites').replaceChildren();
    social.emit('invite', { from: 'Friend', fromId: 'x', code: 'ABC234' });
    social.emit('invite', { from: 'Bad', code: { toUpperCase: 1 } });
    social.emit('invite', { from: 'Bad', code: '../../x' });
    social.emit('invite', null);
    for (let i = 0; i < 20; i++) social.emit('invite', { from: 'Spam' + i, code: 'SPAM' + String(i).padStart(2, '2').replace(/[01]/g, '2') });
    return { n: document.querySelectorAll('#invites .invite').length, text: document.querySelector('#invites').textContent };
  });
  ok('robust: malformed or flooding invites are filtered', inv.n >= 1 && inv.n <= 4 && !inv.text.includes('../'), `${inv.n} shown`);
  await ctx.close();
} catch (e) {
  ok('suite ran to the end', false, e.stack || String(e));
}
const errs = log.filter((l) => !/GPU stall|WebGL.*swiftshader|GL Driver Message|Automatic fallback to software|Unknown color red/i.test(l));
ok('no console errors or warnings', errs.length === 0, errs.slice(0, 12).join(' | '));
const failed = done();
await browser.close(); srv.close();
process.exit(failed ? 1 : 0);
