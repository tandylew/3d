// Automated playthrough (`npm test`). Boots the real game in headless Chromium
// and drives it through its debug input hook with a fixed 72 Hz timestep:
// gather, fight, leap, fly between worlds with guardians in pursuit, break a
// seal by casting, fall to the core, ride wormholes both ways, use every time
// relic, die and recover, win.
import { createRequire } from 'node:module';
import { serve } from './serve.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');

const server = await serve(0);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.setDefaultTimeout(400000);
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e.stack || e)));
await page.goto(`http://localhost:${server.address().port}/?reset`);
await page.waitForFunction(() => window.worml?.ready);

const result = await page.evaluate(() => {
  const { game: g, input, renderer, THREE, dev } = window.worml;
  renderer.setAnimationLoop(null);                   // we own the clock from here
  document.getElementById('overlay').classList.add('hidden');
  input.desktopActive = true;
  g.begin();
  const DT = 1 / 72, log = [], p = g.player, s = g.state, c = g.combat, tw = g.time;
  let t = 1000;
  const step = (n = 1) => { for (let i = 0; i < n; i++) { t += DT; g.frame(DT, t); } };
  const sec = (x) => step(Math.round(x * 72));
  const check = (name, ok, detail = '') => log.push({ name, ok: !!ok, detail: String(detail) });
  const dbg = (input.debug = { trigger: 0, cast: false, dir: new THREE.Vector3(0, 0, -1), move: new THREE.Vector2(), fly: true });
  const V = () => new THREE.Vector3();
  const aimAt = (solar) => dbg.dir.copy(solar).sub(p.pos).sub(input.right.pos).normalize();
  // Fly toward a planet-local point of the given world; returns simulated seconds.
  const flyTo = (planet, local, stopDist, maxSec, until = null) => {
    const target = V(); let sc = 0, vmax = 0;
    for (; sc < maxSec; sc += DT) {
      target.copy(planet.pos).add(local).sub(p.pos);
      const head = V(); g.camera.getWorldPosition(head);
      target.sub(head);
      if (target.length() < stopDist || (until && until())) break;
      dbg.dir.copy(target).normalize(); dbg.trigger = 1;
      // Like a player, skim around a world rather than pushing into the ground when the goal is beyond the horizon.
      const inward = dbg.dir.dot(p.up), R = p.planet.def.radius;
      if (!p.inside && inward < 0 && p.alt < R * 0.4 && target.length() > R * 0.5) dbg.dir.addScaledVector(p.up, -inward).normalize();
      step(); vmax = Math.max(vmax, p.speed);
    }
    dbg.trigger = 0;
    return { sec: sc, vmax };
  };
  // Charge-and-release casts at a moving point until done(). `hold` is how long to charge (default: the perfect window).
  const castAt = (pointFn, maxSec, done, hold = 0.82) => {
    const t0 = t;
    while (t - t0 < maxSec && !done()) {
      dbg.cast = true;
      for (let k = 0; k < 160 && g.chargeT < hold; k++) { aimAt(pointFn()); step(); }
      dbg.cast = false; aimAt(pointFn()); step(4);
    }
    return t - t0;
  };
  const thal = g.planets[0], field = g.fields.get('thalassa'), home = g.gates.get('thalassa'), site = field.site, tr = g.trials;
  const total = () => Object.values(s.inv).reduce((a, b) => a + b, 0);
  const foe = () => c.enemies.filter((e) => e.state === 'chase' || e.state === 'emerge' || e.state === 'idle').sort((a, b) => a.pos.distanceTo(g.headSolar) - b.pos.distanceTo(g.headSolar))[0];
  const slashAt = (pt) => { const dir = pt.clone().sub(g.headSolar).normalize(); aimAt(pt); dbg.slash = { pos: input.right.pos.clone(), dir, sweep: new THREE.Vector3().crossVectors(dir, p.up).normalize(), power: 0.9 }; step(18); };
  let kills = 0, slashKills = 0; const onKill = g.onKill; g.onKill = (e) => { kills++; onKill.call(g, e); };
  const onHit = g.onHit; let lastFrom = ''; g.onHit = (e, m, eye, b) => { lastFrom = b.from; if (e.hp <= 0 && b.from === 'slash') slashKills++; onHit.call(g, e, m, eye, b); };

  // 1. start state
  step(30);
  dbg.fly = false; step(30); delete dbg.fly;
  check('starts grounded on Thalassa', p.planet.def.id === 'thalassa' && p.grounded && p.alt < 0.5, `alt=${p.alt.toFixed(2)}`);
  check('home well open, others sealed', home.open && thal.shaftOpen && !g.gates.get('pyra').open && !g.planets[1].shaftOpen);
  check('objectives hidden until asked for', !g.hud.wrist.mesh.visible);
  check('worlds are half the size', g.planets.every((q) => q.def.radius <= 17000));
  check('each world has exactly three sites: well, trial, time relic', g.planets.every((q) => q.def.deposits.length === 1 && !!q.def.anomaly && q.def.sites.length === 2));
  check('radar shows just those three', g.hud.blips && g.hud.blips.length === 3 && ['well', 'deposit', 'anomaly'].every((k) => g.hud.blips.some((b) => b.kind === k)), `blips=${g.hud.blips?.length}`);
  check('a stream runs from the trial and from the anomaly to the well', thal.uniforms.uTrailA.value.filter((v) => v.w > 0).length === 2);
  check('no guardians until something raises them', c.enemies.length === 0);
  const far = Math.max(site.pos.distanceTo(home.site), thal.def.sites[1] ? new THREE.Vector3(thal.def.anomaly.x, thal.def.anomaly.y, thal.def.anomaly.z).multiplyScalar(thal.def.radius).distanceTo(home.site) : 0);
  check('all three are within a short flight', far < 1800, `${far.toFixed(0)} m`);

  // 2. super leap, automatic flight, automatic landing
  check('flight is off on the ground', !input.flyMode);
  dbg.jump = true; step(); sec(7);
  const apex = p.alt;
  check('a leap throws you kilometres up and leaves you flying', apex > 1500 && input.flyMode, `alt=${apex.toFixed(0)} m`);
  flyTo(thal, site.pos.clone().addScaledVector(site.up, 1.5).addScaledVector(site.t1, 70), 3, 60);
  sec(3);
  check('coming down to the ground lands you and ends flight', !input.flyMode && p.grounded, `alt=${p.alt.toFixed(1)} fly=${input.flyMode}`);

  // 3. the trial: Water is won at the Tidepool
  check('the trial ground is a pool with the font on an islet', window.worml.groundHeight(thal.def, site.up.x, site.up.y, site.up.z) > 1 && (() => { const d = site.pos.clone().addScaledVector(site.t1, 25).normalize(); return window.worml.terrainRaw(thal.def, d.x, d.y, d.z) < 0; })());
  check('the font is dormant and you carry nothing', !s.trial.thalassa && total() === 0);
  dbg.move.set(0, 1); aimAt(thal.pos.clone().add(site.pos)); let walk = 0;
  for (; walk < 20 && !tr.active; walk += DT) { input.yaw = 0; step(); }
  // walk in using the debug hand direction as heading is not possible on foot: fly the last stretch if needed
  if (!tr.active) flyTo(thal, site.pos.clone().addScaledVector(site.up, 2).addScaledVector(site.t1, 30), 3, 20);
  dbg.move.set(0, 0); sec(2.5);
  check('stepping in starts the trial', tr.active, tr.phase);
  let rose = null, sawGround = false, sawLegs = false, bursts = 0;
  for (let k = 0; k < 72 * 170 && !s.trial.thalassa; k++) {
    const e = foe();
    if (e && e.state === 'emerge' && e.h < 0) rose = e;
    if (e && e.state === 'chase' && !e.air && e.legs.every((l) => l.set)) { sawGround = true; if (e.legs.some((l) => l.t < 1)) sawLegs = true; }
    bursts += tr.hazards.filter((h) => h.burst && h.t - h.warn < DT * 1.5).length;
    if (g.health < 50) g.health = 100;
    if (e && e.state !== 'emerge') {
      if (e.pos.distanceTo(g.headSolar) < 14 || !g.castEl) slashAt(e.head);
      else castAt(() => e.head, 1.2, () => e.state === 'dead');
    } else { dbg.move.set(0.8, 0.2); step(); dbg.move.set(0, 0); }
  }
  check('guardians rise out of the pool', !!rose);
  check('they fight on foot, stepping on jointed legs', sawGround && sawLegs);
  check('the ground erupts during the trial', bursts > 0, `${bursts} eruptions`);
  check('blades (free) kill guardians', slashKills > 0, `${slashKills} of ${kills} kills by blade`);
  check('clearing three waves masters Water and fills it', s.trial.thalassa && s.inv.water === 12 && kills >= 5, `kills=${kills} water=${s.inv.water}`);
  s.inv.water = 3; flyTo(thal, site.pos.clone().addScaledVector(site.up, 3), 3, 10); sec(4);
  check('the woken font refills its element', s.inv.water === 12, `water=${s.inv.water}`);

  // 4. casting skill
  const quick = g.castPower(0.08), perfect = g.castPower(0.85), late = g.castPower(1.5);
  check('a perfect cast carries far more than a quick or overheld one', perfect.perfect && perfect.dmg > quick.dmg * 3 && late.dmg < perfect.dmg / 2, `quick ${quick.dmg.toFixed(0)}, perfect ${perfect.dmg}, overheld ${late.dmg.toFixed(0)}`);
  g.health = 100; g.warpTo('thalassa', 0, 80); step(10);
  const [dummy] = dev.summon(1, 'fire'); sec(2);
  const w0 = s.inv.water;
  castAt(() => dummy.head, 20, () => dummy.state === 'dead' || !c.enemies.includes(dummy));
  check('water is chosen against fire and a timed release is a perfect hit', g.lastHit && g.lastHit.perfect && g.lastHit.el === 'water' && s.inv.water < w0, JSON.stringify(g.lastHit));
  sec(6);
  check('a fallen guardian leaves essence of its element', s.inv.fire >= 1 && c.drops.length === 0, `fire=${s.inv.fire}`);

  // 5. health: hurt, then mend after a quiet spell
  c.clear(() => true); g.health = 100; g.hurt(40);
  sec(4); const mid = g.health; sec(10);
  check('health holds, then recovers when left alone', mid === 60 && g.health === 100, `after 4 s ${mid}, after 14 s ${g.health}`);

  // 6. fly to Pyra with guardians in pursuit
  dev.summon(2); sec(2.5);
  const pyra = g.planets.find((q) => q.def.id === 'pyra'), pg = g.gates.get('pyra');
  const d0 = p.pos.distanceTo(pyra.pos);
  const up = flyTo(thal, p.pos.clone().sub(thal.pos).setLength(thal.def.radius * 1.6), 500, 60);
  check('guardians give chase into space', c.pursuing > 0, `pursuing=${c.pursuing}`);
  const hi = flyTo(pyra, pg.site.clone().setLength(pyra.def.radius * 3), pyra.def.radius * 0.3, 120);
  const f = flyTo(pyra, pg.site.clone().addScaledVector(pg.z, 46).addScaledVector(pg.up, 2), 12, 120);
  f.sec += hi.sec; f.vmax = Math.max(f.vmax, hi.vmax);
  check('flew Thalassa -> Pyra', p.planet.def.id === 'pyra' && p.alt < 60, `${(d0 / 1000).toFixed(0)} km in ${(up.sec + f.sec).toFixed(1)} s, peak ${(f.vmax / 1000).toFixed(0)} km/s`);
  sec(5);
  check('lands and stands upright', p.grounded && new THREE.Vector3(0, 1, 0).applyQuaternion(g.rig.quaternion).dot(p.up) > 0.999);
  let arrived = 0; const near = () => c.enemies.some((e) => e.foreign && e.pos.distanceTo(g.headSolar) < 200);
  for (; arrived < 90 && !near(); arrived += DT) step();
  check('pursuers arrive on the new world', near(), `after ${arrived.toFixed(1)} s`);

  // 7. break the seal by casting water at it
  s.inv.water = 7; g.health = 100;
  const sealPt = () => pyra.pos.clone().add(pg.site).addScaledVector(pg.up, 3);
  castAt(sealPt, 6, () => (s.charge.pyra.water || 0) >= 1, 0.05);
  check('a quick cast at the seal counts once', (s.charge.pyra.water || 0) === 1, JSON.stringify(s.charge.pyra));
  const w1 = s.inv.water;
  castAt(sealPt, 20, () => (s.charge.pyra.water || 0) >= 5);
  check('perfect casts at the seal count double', (s.charge.pyra.water || 0) === 5 && w1 - s.inv.water <= 3, `4 charges for ${w1 - s.inv.water} essence`);
  sec(6);
  check('Pyra well opens and links', pg.open && s.open.pyra && pyra.shaftOpen && pg.next === home && home.next === pg);

  // 8. into the well: the shaft carries you to the core
  flyTo(pyra, pg.site.clone().addScaledVector(pg.up, 6), 3, 20);
  let fall = 0; for (; fall < 60 && !(p.inside && p.pos.distanceTo(pyra.pos) < 280 && !p.ride); fall += DT) step();
  check('the shaft carries you to the core', p.inside && p.pos.distanceTo(pyra.pos) < 300, `${fall.toFixed(1)} s`);
  check('inside a world you fly', input.flyMode);

  // 9. through the gate: arrive in Thalassa's core, pursuit shaken
  flyTo(pyra, pg.z.clone().multiplyScalar(40), 5, 20);
  flyTo(pyra, pg.z.clone().multiplyScalar(-6), 0.5, 20, () => !!g.transit);
  check('transit starts on entering the ring', !!g.transit);
  sec(14);
  check('arrive in the core of Thalassa', !g.transit && p.planet.def.id === 'thalassa' && p.inside && !p.frozen);
  check('nothing follows through a wormhole', c.hunting === 0 && !c.enemies.some((e) => e.foreign), `hunting=${c.hunting}`);

  // 10. leap inside a world: ride the shaft up to the wellhead
  dbg.jump = true; step();
  let ride = 0; for (; ride < 60 && (p.inside || p.eject > 0); ride += DT) step();
  sec(2);
  const fromWell = p.pos.clone().sub(thal.pos).distanceTo(home.site);
  check('a leap in the core rides up to the wellhead', !p.inside && fromWell < 150 && p.alt > -1, `${ride.toFixed(1)} s, ${fromWell.toFixed(0)} m from the well`);

  // 11. rest of the chain, each seal broken by casting
  for (const id of ['ferrum', 'sylva', 'petra', 'arcana']) {
    const gate = g.gates.get(id);
    g.grantFor(gate);
    g.warpTo(id, 2, 46); step(20);
    castAt(() => gate.planet.pos.clone().add(gate.site).addScaledVector(gate.up, 3), 30, () => !!g.pendingUnlock || gate.open);
    sec(6);
    check(`${id} seal broken`, gate.open && s.open[id]);
  }
  check('all six linked: the Sun becomes the goal', s.won && !s.finale && g.objective().goal === 'sun' && !!p.arena);

  // 12. forward and back through the same gate
  const through = (id, side) => {
    const gate = g.gates.get(id);
    g.warpCore(id, side); step(10);
    flyTo(gate.planet, gate.z.clone().multiplyScalar(-6 * side), 0.5, 20, () => !!g.transit);
    sec(14);
    return p.planet.def.id;
  };
  const fwd = through('ferrum', 1), back = through('ferrum', -1);
  check('front face leads onward, back face leads back', fwd === 'sylva' && back === 'pyra', `front -> ${fwd}, back -> ${back}`);

  // 13. time relics
  const toAnomaly = (q) => { const an = q.def.anomaly; p.place(q, new THREE.Vector3(an.x, an.y, an.z), 1.2, home.z); c.dropPursuit(); sec(2); };
  toAnomaly(thal);
  check('Stillwater Pearls picked up at the Thalassa anomaly', s.weapons.pearls === true && s.sel === 'pearls');
  g.warpTo('thalassa', 0, 80); step(10);
  g.health = 100; const [sub] = dev.summon(1); sec(2.5);
  const probe = () => { const b = { pos: g.headSolar.clone().addScaledVector(p.up, 500), vel: p.up.clone().multiplyScalar(34), life: 9, from: 'enemy', el: 'water', rgb: [1, 1, 1], size: 0.1, dmg: 0 }; c.bolts.push(b); return b; };
  const run = () => { const b = probe(), b0 = b.pos.clone(), a0 = sub.age, wt0 = g.worldTime; let path = 0, last = sub.pos.clone(); for (let k = 0; k < 144; k++) { g.health = 100; step(); path += sub.pos.distanceTo(last); last.copy(sub.pos); } return { bolt: b.pos.distanceTo(b0), age: sub.age - a0, world: g.worldTime - wt0, path }; };
  const fast = run();
  dbg.time = true; step(2);
  check('pearls slow the world to a fifth', tw.slowT > 0 && tw.worldScale === 0.2 && tw.pearls.n === 2);
  const slow = run();
  check('slow: guardian bolts crawl at a fifth speed', Math.abs(slow.bolt / fast.bolt - 0.2) < 0.02, `${fast.bolt.toFixed(1)} m -> ${slow.bolt.toFixed(1)} m in 2 s`);
  check('slow: guardians think and move at a fifth speed', Math.abs(slow.age / fast.age - 0.2) < 0.02 && slow.path < fast.path * 0.5, `clock ${fast.age.toFixed(2)} -> ${slow.age.toFixed(2)} s, travelled ${fast.path.toFixed(1)} -> ${slow.path.toFixed(1)} m`);
  sec(7);
  check('time resumes', tw.worldScale === 1);
  for (const w of ['rewinder', 'seeds', 'mantle']) tw.give(w);
  g.health = 100;
  s.sel = 'rewinder'; aimAt(sub.pos); dbg.time = true; step(2);
  check('the Rewinder sends a guardian back', sub.state === 'rewind', sub.state);
  sec(6); c.clear(() => true);
  tr.hazard(g.headSolar.clone().addScaledVector(p.up, -1).add(new THREE.Vector3().crossVectors(p.up, new THREE.Vector3(1, 0.2, 0)).normalize().multiplyScalar(12)), p.up, [1, 1, 1], 4, 5);
  tw.cool.rewinder = 0; aimAt(tr.hazards[0].pos); dbg.time = true; step(3);
  check('the Rewinder un-happens an eruption', tr.hazards.length === 0 || tr.hazards[0].burst);
  s.sel = 'seeds'; dbg.dir.copy(p.up).multiplyScalar(-0.3).add(new THREE.Vector3().crossVectors(p.up, new THREE.Vector3(1, 0.2, 0)).normalize()).normalize(); dbg.time = true; step(2);
  sec(5);
  check('a Quickening Seed grows a tree where it lands', tw.blooms.length === 1 && tw.blooms[0].mesh.scale.x > 1.5, `blooms=${tw.blooms.length}`);
  const b4 = p.pos.clone();
  s.sel = 'mantle'; dbg.time = true; step(2);
  check('the Mantle freezes time and leaves an echo', tw.freezeT > 0 && tw.worldScale === 0 && !!tw.echo);
  flyTo(thal, p.pos.clone().sub(thal.pos).addScaledVector(p.up, 60), 5, 6);
  const away = p.pos.distanceTo(b4);
  dbg.time = true; step(2);
  check('using it again returns you to the echo', away > 30 && p.pos.distanceTo(b4) < 0.5 && !tw.echo, `went ${away.toFixed(0)} m`);
  const every0 = tw.pearls.every;
  toAnomaly(g.planets[2]); step(3);
  check('Ferrum holds a passive relic that speeds the others', s.weapons.mainspring === true && tw.pearls.every === every0 / 2 && s.sel === 'mantle');
  toAnomaly(g.planets[5]); step(3);
  check('Arcana holds one that deepens them', s.weapons.prism === true && tw.pearls.max === 4 && tw.seeds.max === 3);

  // 14. the finale at the Sun
  const ARENA = tr.arena.position.clone().add(p.pos);   // scene -> solar
  dev.warp('thalassa', 'arena'); step(5);
  const A = p.arena.clone();
  check('the arena hangs before the Sun', A.length() > 150000 * 1.5 && A.length() < 150000 * 4 && tr.arena.visible);
  const fa = flyTo({ pos: A }, tr.up.clone().multiplyScalar(25), 12, 60);
  check('you arrive at the arena at a fighting pace', p.vLimit < 60 && p.pos.distanceTo(A) < 200, `limit ${p.vLimit.toFixed(0)} m/s after ${fa.sec.toFixed(1)} s`);
  sec(4);
  check('the finale begins', tr.finaleActive, tr.f.phase);
  s.inv.fire = 0; const br = tr.braziers.find((q) => q.el === 'fire');
  flyTo({ pos: br.pos }, new THREE.Vector3(), 6, 30); step(5);
  check('a brazier refills its element', s.inv.fire === 12);
  // fight the two flares for real for a while, then sweep up
  const k0 = kills; let seenEls = new Set();
  for (let k = 0; k < 72 * 60 && tr.f.phase !== 'boss'; k++) {
    g.health = 100;
    const e = foe(); for (const q of c.enemies) seenEls.add(q.el);
    if (e && e.state !== 'emerge') { if (k < 72 * 25) castAt(() => e.head, 1.2, () => e.state === 'dead'); else c.damage(e, 9999); }
    else step();
    for (const el of ['water', 'fire', 'metal', 'wood', 'earth']) if (s.inv[el] < 3) s.inv[el] = 12;
  }
  check('waves of many elements pour out of the flares', kills - k0 >= 14 && seenEls.size >= 3, `${kills - k0} felled, elements: ${[...seenEls].join(' ')}`);
  for (let k = 0; k < 72 * 8 && !tr.f.boss; k++) step();
  const boss = tr.f.boss;
  check('then the Heliarch: huge, and wearing fire', !!boss && boss.boss && boss.sz > 4 && boss.el === 'fire' && boss.max >= 1500);
  for (let k = 0; k < 72 * 4; k++) { g.health = 100; step(); }
  const hp0 = boss.hp; s.inv.water = 12;
  castAt(() => boss.pos, 6, () => boss.hp < hp0);
  check('it is answered with the element that overcomes it', boss.hp < hp0 && g.lastHit.el === 'water' && g.lastHit.mult >= 2.5, JSON.stringify(g.lastHit));
  const el0 = boss.el; for (let k = 0; k < 72 * 12; k++) { g.health = 100; step(); }
  check('it changes element as the fight goes on', boss.el !== el0 && c.enemies.some((e) => e.tag === 'finale' && !e.boss), `${el0} -> ${boss.el}`);
  c.damage(boss, 99999); sec(2);
  check('felling it completes the game, with your time', s.finale && tr.f.phase === 'done' && s.playTime > 0 && g.objective().goal === null && !c.enemies.some((e) => e.tag === 'finale' && e.state !== 'dead'), `played ${Math.round(s.playTime)} s of test time`);

  // 15. death and recovery
  g.grant(8); g.warpTo('pyra', 0, 300); step(5);
  g.hurt(500); sec(1);
  check('lethal damage unmakes you', !!g.dead && p.frozen);
  sec(4);
  const dw = p.pos.clone().sub(g.planets[1].pos).distanceTo(g.gates.get('pyra').site);
  check('you reform at the wellhead with half your essence', !g.dead && !p.frozen && g.health === 100 && s.inv.water === 4 && dw < 80, `health=${g.health} water=${s.inv.water}`);
  return log;
});

let failed = 0;
for (const r of result) { if (!r.ok) failed++; console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  (' + r.detail + ')' : ''}`); }
for (const e of errors) console.log('PAGE ERROR:', e.slice(0, 500));
await browser.close(); server.close();
if (failed || errors.length) { console.log(`\n${failed} failed, ${errors.length} page errors`); process.exit(1); }
console.log('\nAll checks passed.');
process.exit(0);
