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
  const thal = g.planets[0], field = g.fields.get('thalassa'), home = g.gates.get('thalassa');

  // 1. start state
  step(30);
  dbg.fly = false; step(30);
  check('starts grounded on Thalassa', p.planet.def.id === 'thalassa' && p.grounded && p.alt < 0.5, `alt=${p.alt.toFixed(2)}`);
  check('home well open, others sealed', home.open && thal.shaftOpen && !g.gates.get('pyra').open && !g.planets[1].shaftOpen);
  check('objectives hidden until asked for', !g.hud.wrist.mesh.visible);
  g.hud.toggleObjectives(); step(3);
  check('objectives toggle on', g.hud.wrist.mesh.visible); g.hud.toggleObjectives();
  check('only the wellhead keeps a beacon', field.deposits.every((d) => !d.pillar.visible));
  check('radar shows the well, 8 deposits and the anomaly', g.hud.blips && g.hud.blips.filter((b) => b.kind === 'deposit').length === 8 && g.hud.blips.some((b) => b.kind === 'well') && g.hud.blips.some((b) => b.kind === 'anomaly') && g.hud.radar.mesh.visible, `blips=${g.hud.blips?.length}`);
  check('streams run from every deposit and the anomaly to the well', thal.uniforms.uTrailA.value.filter((v) => v.w > 0).length === 9);
  check('8 deposits spread over each world, guarded', g.planets.every((q) => g.fields.get(q.def.id).deposits.length === 8) && c.enemies.length === 16, `guardians=${c.enemies.length}`);

  // 2. super leap and coming back down
  delete dbg.fly; dbg.jump = true; step(); sec(7);
  const apex = p.alt;
  check('super leap throws you kilometres up', apex > 1500 && input.flyMode, `alt=${apex.toFixed(0)} m`);
  dbg.fly = false;
  let fell = 0; for (; fell < 90 && !p.grounded; fell += DT) step();
  check('with flight off you sink back and land', p.grounded, `${fell.toFixed(1)} s`);

  // 3. gather by walking into orbs (no button)
  dbg.fly = true;
  const dep = field.deposits[0];
  flyTo(thal, dep.pos.clone().addScaledVector(dep.up, 25), 40, 60);
  let guard = 0;
  while (s.inv.water < 6 && guard++ < 14) {
    const here = p.pos.clone().sub(thal.pos);
    const o = dep.orbs.filter((q) => q.state === 0).map((q) => q.pos.clone().applyMatrix4(dep.g.matrix)).sort((a, b) => a.distanceTo(here) - b.distanceTo(here))[0];
    if (!o) break;
    flyTo(thal, o, 3.5, 20); sec(1);
  }
  check('gathered water essence by proximity', s.inv.water >= 6, `water=${s.inv.water}`);

  // 4. guardians notice, and casting kills them
  let seen = 0; for (; seen < 20 && !c.hunting; seen += DT) { flyTo(thal, dep.pos.clone().addScaledVector(dep.up, 8), 6, 0.2); step(); }
  check('guardians at the deposit attack', c.hunting > 0, `hunting=${c.hunting}`);
  g.grant(12); g.health = 100;
  let kills = 0; const onKill = g.onKill; g.onKill = (e) => { kills++; onKill.call(g, e); };
  const total = () => Object.values(s.inv).reduce((a, b) => a + b, 0);
  const foe = () => c.enemies.filter((e) => e.state === 'chase' || e.state === 'idle').sort((a, b) => a.pos.distanceTo(g.headSolar) - b.pos.distanceTo(g.headSolar))[0];
  // guardians are articulated: on the ground their feet are planted and they step
  flyTo(thal, dep.pos.clone().addScaledVector(dep.up, 2.5), 2, 10); dbg.fly = false; sec(1.5);
  const w = foe(), feet0 = w.legs.map((l) => l.foot.clone());
  sec(2.5);
  const stepped = w.legs.filter((l, i) => l.foot.distanceTo(feet0[i]) > 0.3).length;
  const footAlt = Math.max(...w.legs.map((l) => { const d = l.foot.clone().sub(thal.pos), r = d.length(); d.divideScalar(r); return Math.abs(r - thal.def.radius - window.worml.groundHeight(thal.def, d.x, d.y, d.z)); }));
  check('guardians walk on jointed legs', !w.air && w.legs.length === 6 && w.legs.every((l) => l.set) && stepped >= 3 && footAlt < 1.2, `legs=${w.legs.length} stepped=${stepped} worst foot ${footAlt.toFixed(2)} m off the ground, act=${w.act}`);
  dbg.fly = true; flyTo(thal, dep.pos.clone().addScaledVector(dep.up, 8), 3, 6);
  check('they take to the air when you do', (() => { sec(2); return c.enemies.some((e) => e.state === 'chase' && e.air); })());
  const quick = g.castPower(0.08), perfect = g.castPower(0.85), late = g.castPower(1.5);
  check('a perfect cast carries far more than a quick or overheld one', perfect.perfect && perfect.dmg > quick.dmg * 3 && perfect.speed > quick.speed * 1.8 && late.dmg < perfect.dmg / 2, `quick ${quick.dmg.toFixed(0)}, perfect ${perfect.dmg}, overheld ${late.dmg.toFixed(0)}`);
  const spent = castAt(() => foe().head, 40, () => kills > 0);
  check('timed release registers as a perfect hit', g.lastHit && g.lastHit.perfect, JSON.stringify(g.lastHit));
  check('casting essence destroys a guardian', kills > 0, `${spent.toFixed(1)} s, health ${Math.round(g.health)}`);
  check('casting spends essence', total() < 60, `carried ${total()} of 60`);
  sec(6);
  check('a fallen guardian leaves essence of its element', c.drops.length === 0 && kills > 0);

  // 5. health: hurt, then mend after a quiet spell
  g.warpTo('thalassa', 0, 60); step(10);
  g.health = 100; g.hurt(40);
  sec(4); const mid = g.health; sec(10);
  check('health holds, then recovers when left alone', mid === 60 && g.health === 100, `after 4 s ${mid}, after 14 s ${g.health}`);

  // 6. fly to Pyra with guardians in pursuit
  flyTo(thal, dep.pos.clone().addScaledVector(dep.up, 30), 30, 60);
  dev.summon(2); sec(1);
  const pyra = g.planets.find((q) => q.def.id === 'pyra'), pg = g.gates.get('pyra');
  const d0 = p.pos.distanceTo(pyra.pos);
  const up = flyTo(thal, p.pos.clone().sub(thal.pos).setLength(thal.def.radius * 1.6), 500, 60);
  const chasing = c.pursuing;
  check('guardians give chase into space', chasing > 0, `pursuing=${chasing}`);
  const hi = flyTo(pyra, pg.site.clone().setLength(pyra.def.radius * 3), pyra.def.radius * 0.3, 120);
  const f = flyTo(pyra, pg.site.clone().addScaledVector(pg.z, 46).addScaledVector(pg.up, 2), 12, 120);
  f.sec += hi.sec; f.vmax = Math.max(f.vmax, hi.vmax);
  check('flew Thalassa -> Pyra', p.planet.def.id === 'pyra' && p.alt < 60, `${(d0 / 1000).toFixed(0)} km in ${(up.sec + f.sec).toFixed(1)} s, peak ${(f.vmax / 1000).toFixed(0)} km/s, alt=${p.alt.toFixed(1)}`);
  dbg.fly = false; sec(5);
  check('lands and stands upright', p.grounded && new THREE.Vector3(0, 1, 0).applyQuaternion(g.rig.quaternion).dot(p.up) > 0.999);
  let arrived = 0; const near = () => c.enemies.some((e) => e.foreign && e.pos.distanceTo(g.headSolar) < 200);
  for (; arrived < 90 && !near(); arrived += DT) step();
  check('pursuers arrive on the new world', near(), `after ${arrived.toFixed(1)} s, foreign=${c.enemies.filter((e) => e.foreign).length}`);

  // 7. break the seal by casting water at it
  s.inv.water = 7;
  const sealPt = () => pyra.pos.clone().add(pg.site).addScaledVector(pg.up, 3);
  castAt(sealPt, 6, () => (s.charge.pyra.water || 0) >= 1, 0.05);
  check('a quick cast at the seal counts once', (s.charge.pyra.water || 0) === 1, JSON.stringify(s.charge.pyra));
  const w0 = s.inv.water;
  castAt(sealPt, 20, () => (s.charge.pyra.water || 0) >= 5);
  check('perfect casts at the seal count double', (s.charge.pyra.water || 0) === 5 && w0 - s.inv.water <= 3, `4 charges for ${w0 - s.inv.water} essence`);
  sec(6);
  check('Pyra well opens and links', pg.open && s.open.pyra && pyra.shaftOpen && pg.next === home && home.next === pg);

  // 8. into the well: the shaft carries you to the core
  dbg.fly = true; flyTo(pyra, pg.site.clone().addScaledVector(pg.up, 6), 3, 20); dbg.fly = false;
  let fall = 0; for (; fall < 60 && !(p.inside && p.pos.distanceTo(pyra.pos) < 280 && !p.ride); fall += DT) step();
  check('the shaft carries you to the core', p.inside && p.pos.distanceTo(pyra.pos) < 300, `${fall.toFixed(1)} s, r=${p.pos.distanceTo(pyra.pos).toFixed(0)} m`);

  // 9. through the gate: arrive in Thalassa's core, pursuit shaken
  dev.summon(0);
  dbg.fly = true;
  flyTo(pyra, pg.z.clone().multiplyScalar(40), 5, 20);
  flyTo(pyra, pg.z.clone().multiplyScalar(-6), 0.5, 20, () => !!g.transit);
  check('transit starts on entering the ring', !!g.transit);
  sec(14);
  check('arrive in the core of Thalassa', !g.transit && p.planet.def.id === 'thalassa' && p.inside && !p.frozen, `r=${p.pos.distanceTo(thal.pos).toFixed(0)} m`);
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
  check('game won: all six worlds linked', s.won && s.order.length === 6);

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
  const an = thal.def.anomaly;
  p.place(thal, new THREE.Vector3(an.x, an.y, an.z), 1.2, home.z); c.dropPursuit(); sec(2);
  check('Stillwater Pearls picked up at the Thalassa anomaly', s.weapons.pearls === true && s.sel === 'pearls');
  // measure a guardian and its bolt at full speed, then under the pearls
  g.warpTo('thalassa', 0, 60); flyTo(thal, dep.pos.clone().addScaledVector(dep.up, 30), 30, 60);
  g.health = 100; const [sub] = dev.summon(1); sec(1);
  const probe = () => { const b = { pos: g.headSolar.clone().addScaledVector(p.up, 500), vel: p.up.clone().multiplyScalar(34), life: 9, from: 'enemy', el: 'water', rgb: [1, 1, 1], size: 0.1, dmg: 0 }; c.bolts.push(b); return b; };
  const run = () => { const b = probe(), b0 = b.pos.clone(), a0 = sub.age, w0 = g.worldTime, cool0 = sub.cool; let path = 0, last = sub.pos.clone(); for (let k = 0; k < 144; k++) { step(); path += sub.pos.distanceTo(last); last.copy(sub.pos); } return { bolt: b.pos.distanceTo(b0), age: sub.age - a0, world: g.worldTime - w0, path }; };
  const fast = run();
  g.health = 100; dbg.time = true; step(2);
  check('pearls slow the world to a fifth', tw.slowT > 0 && tw.worldScale === 0.2 && tw.pearls.n === 2);
  const slow = run();
  const own = (() => { const o = p.pos.clone(); flyTo(thal, p.pos.clone().sub(thal.pos).addScaledVector(p.up, 40), 2, 1); return p.pos.distanceTo(o); })();
  check('slow: guardian bolts crawl at a fifth speed', Math.abs(slow.bolt / fast.bolt - 0.2) < 0.02, `${fast.bolt.toFixed(1)} m -> ${slow.bolt.toFixed(1)} m in 2 s`);
  check('slow: guardians think and move at a fifth speed', Math.abs(slow.age / fast.age - 0.2) < 0.02 && Math.abs(slow.world / fast.world - 0.2) < 0.02 && slow.path < fast.path * 0.45, `clock ${fast.age.toFixed(2)} -> ${slow.age.toFixed(2)} s, travelled ${fast.path.toFixed(1)} -> ${slow.path.toFixed(1)} m`);
  check('slow: you still move at full speed', own > 15, `${own.toFixed(0)} m in 1 s`);
  c.dropPursuit();
  sec(7);
  check('time resumes', tw.worldScale === 1);
  for (const w of ['rewinder', 'seeds', 'mantle']) tw.give(w);
  g.warpTo('thalassa', 0, 60); flyTo(thal, dep.pos.clone().addScaledVector(dep.up, 30), 30, 60);
  g.grant(12); g.health = 100;
  const [victim] = dev.summon(1); sec(2);
  s.sel = 'rewinder'; aimAt(victim.pos); dbg.time = true; step(2);
  check('the Rewinder sends a guardian back', victim.state === 'rewind', victim.state);
  sec(6);
  check('rewound guardian is home and pacified', victim.state === 'idle' && victim.pacify > 0 && victim.hp === victim.max);
  s.sel = 'seeds'; dbg.dir.copy(p.up).multiplyScalar(-0.3).add(new THREE.Vector3().crossVectors(p.up, new THREE.Vector3(1, 0.2, 0)).normalize()).normalize(); dbg.time = true; step(2);
  sec(5);
  check('a Quickening Seed grows a tree where it lands', tw.blooms.length === 1 && tw.blooms[0].mesh.scale.x > 1.5, `blooms=${tw.blooms.length}`);
  const b4 = p.pos.clone();
  s.sel = 'mantle'; dbg.time = true; step(2);
  check('the Mantle freezes time and leaves an echo', tw.freezeT > 0 && tw.worldScale === 0 && !!tw.echo);
  flyTo(thal, p.pos.clone().sub(thal.pos).addScaledVector(p.up, 60), 5, 6);
  const away = p.pos.distanceTo(b4);
  dbg.time = true; step(2);
  check('using it again returns you to the echo', away > 30 && p.pos.distanceTo(b4) < 0.5 && !tw.echo, `went ${away.toFixed(0)} m, back to ${p.pos.distanceTo(b4).toFixed(2)} m`);
  const fs = g.fields.get('pyra'), bd = fs.deposits.find((q) => q.buried);
  p.place(g.planets[1], bd.up.clone().addScaledVector(g.gates.get('pyra').x, 50 / 24000), 3, home.z); c.dropPursuit(); step(5);
  tw.cool.rewinder = 0; s.sel = 'rewinder'; aimAt(g.planets[1].pos.clone().add(bd.pos)); dbg.time = true; step(2); sec(3);
  check('the Rewinder un-buries a collapsed deposit', !bd.buried && s.unburied.pyra[bd.index]);

  // 14. death and recovery
  g.grant(8); g.warpTo('pyra', 0, 300); step(5);
  g.hurt(500); sec(1);
  check('lethal damage unmakes you', !!g.dead && p.frozen);
  sec(4);
  const dw = p.pos.clone().sub(g.planets[1].pos).distanceTo(g.gates.get('pyra').site);
  check('you reform at the wellhead with half your essence', !g.dead && !p.frozen && g.health === 100 && s.inv.water === 4 && dw < 80, `health=${g.health} water=${s.inv.water} ${dw.toFixed(0)} m from well`);
  return log;
});

let failed = 0;
for (const r of result) { if (!r.ok) failed++; console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  (' + r.detail + ')' : ''}`); }
for (const e of errors) console.log('PAGE ERROR:', e.slice(0, 500));
await browser.close(); server.close();
if (failed || errors.length) { console.log(`\n${failed} failed, ${errors.length} page errors`); process.exit(1); }
console.log('\nAll checks passed.');
process.exit(0);
