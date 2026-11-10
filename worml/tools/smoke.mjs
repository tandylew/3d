// Automated playthrough (`npm test`). Boots the real game in headless Chromium
// and drives it through its debug input hook with a fixed 72 Hz timestep:
// gather essence, fly between worlds, unseal a gate, ride the wormhole, win.
import { createRequire } from 'node:module';
import { serve } from './serve.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');

const server = await serve(0);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.setDefaultTimeout(180000);
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e.stack || e)));
await page.goto(`http://localhost:${server.address().port}/?reset`);
await page.waitForFunction(() => window.worml?.ready);

const result = await page.evaluate(() => {
  const { game: g, input, renderer, THREE } = window.worml;
  renderer.setAnimationLoop(null);                   // we own the clock from here
  document.getElementById('overlay').classList.add('hidden');
  input.desktopActive = true;
  g.begin();
  const DT = 1 / 72, log = [], p = g.player, s = g.state;
  let t = 1000;
  const step = (n = 1) => { for (let i = 0; i < n; i++) { t += DT; g.frame(DT, t); } };
  const check = (name, ok, detail = '') => log.push({ name, ok: !!ok, detail: String(detail) });
  const dbg = (input.debug = { trigger: 0, grip: 0, dir: new THREE.Vector3(0, 0, -1) });
  // Fly toward a planet-local point of the given world; returns simulated seconds.
  const flyTo = (planet, local, stopDist, maxSec, grip = 0) => {
    const target = new THREE.Vector3(); let sec = 0, vmax = 0;
    for (; sec < maxSec; sec += DT) {
      target.copy(planet.pos).add(local).sub(p.pos);
      const head = new THREE.Vector3(); g.camera.getWorldPosition(head);
      target.sub(head);
      if (target.length() < stopDist || (g.transit && !grip && stopDist < 1)) break;
      dbg.dir.copy(target).normalize(); dbg.trigger = 1; dbg.grip = grip;
      // Like a player, skim around a world rather than pushing into the ground when the goal is beyond the horizon.
      const inward = dbg.dir.dot(p.up), R = p.planet.def.radius;
      if (inward < 0 && p.alt < R * 0.4 && target.length() > R * 0.5) dbg.dir.addScaledVector(p.up, -inward).normalize();
      step(); vmax = Math.max(vmax, p.speed);
    }
    dbg.trigger = 0;
    return { sec, vmax };
  };

  // 1. start state
  step(30);
  check('starts grounded on Thalassa', p.planet.def.id === 'thalassa' && p.grounded && p.alt < 0.5, `alt=${p.alt.toFixed(2)}`);
  check('home gate open, others sealed', g.gates.get('thalassa').open && !g.gates.get('pyra').open);

  // 2. gather water by flying to orbs with grip held
  const field = g.fields.get('thalassa');
  let guard = 0;
  while (s.inv.water < 5 && guard++ < 14) {
    const o = field.orbs.filter((q) => q.state === 0).sort((a, b) => a.home.distanceTo(p.pos.clone().sub(p.planet.pos).sub(field.anchor)) - b.home.distanceTo(p.pos.clone().sub(p.planet.pos).sub(field.anchor)))[0];
    flyTo(p.planet, o.home.clone().add(field.anchor), 6, 20, 1);
    dbg.grip = 1; step(90); dbg.grip = 0;
  }
  check('gathered 5 water essence', s.inv.water >= 5, `water=${s.inv.water}`);

  // 3. interplanetary flight to Pyra's gate
  const pyra = g.planets.find((q) => q.def.id === 'pyra'), pg = g.gates.get('pyra');
  const d0 = p.pos.distanceTo(pyra.pos);
  const up = flyTo(p.planet, p.pos.clone().sub(p.planet.pos).setLength(p.planet.def.radius * 1.6), 500, 60);
  // Approach like a player would: aim above the gate's side of the world, then descend on its beacon.
  const hi = flyTo(pyra, pg.center.clone().setLength(pyra.def.radius * 3), pyra.def.radius * 0.3, 120);
  const f = flyTo(pyra, pg.center.clone().addScaledVector(pg.z, 30), 12, 120);
  f.sec += hi.sec; f.vmax = Math.max(f.vmax, hi.vmax);
  check('flew Thalassa -> Pyra', p.planet.def.id === 'pyra' && p.alt < 60, `${(d0 / 1000).toFixed(0)} km in ${(up.sec + f.sec).toFixed(1)} s, peak ${(f.vmax / 1000).toFixed(0)} km/s, alt=${p.alt.toFixed(1)}`);
  check('no tunnelling through terrain', p.alt > -0.5, `alt=${p.alt.toFixed(2)}`);
  dbg.dir.copy(p.up).negate(); dbg.trigger = 0; step(360);
  check('lands and stands upright', p.grounded && new THREE.Vector3(0, 1, 0).applyQuaternion(g.rig.quaternion).dot(p.up) > 0.999);
  check('Pyra discovered', s.visited.pyra);

  // 4. douse the firestorm
  dbg.grip = 1; step(72 * 4); dbg.grip = 0;
  check('water released into gate', (s.charge.pyra.water || 0) === 5 && s.inv.water === 0, JSON.stringify(s.charge.pyra));
  step(72 * 5);
  check('Pyra gate unsealed + linked', pg.open && s.open.pyra && pg.dest === g.gates.get('thalassa') && g.gates.get('thalassa').dest === pg);

  // 5. ride the wormhole home
  flyTo(pyra, pg.center.clone(), 0.5, 20);
  check('transit starts on entering ring', !!g.transit || p.planet.def.id === 'thalassa');
  step(72 * 14);
  const tg = g.gates.get('thalassa');
  const arrive = p.pos.clone().sub(p.planet.pos).distanceTo(tg.base);
  check('arrived at Thalassa gate', !g.transit && p.planet.def.id === 'thalassa' && arrive < 40 && !p.frozen, `dist to gate ${arrive.toFixed(1)} m`);

  // 6. rest of the chain (essence granted directly; gates still unsealed by play)
  for (const id of ['ferrum', 'sylva', 'petra', 'arcana']) {
    const gate = g.gates.get(id);
    for (const el of Object.keys(gate.planet.def.needs)) s.inv[el] = gate.planet.def.needs[el];
    g.warpTo(id, 0, 24); step(20);
    dbg.grip = 1; step(72 * 6); dbg.grip = 0; step(72 * 5);
    check(`${id} gate unsealed`, gate.open && s.open[id]);
  }
  check('game won: all six worlds linked', s.won && s.order.length === 6);

  // 7. destination cycling
  const ag = g.gates.get('arcana'), before = ag.dest;
  dbg.act = true; step(3);
  check('act button cycles wormhole destination', ag.dest && ag.dest !== before);
  return log;
});

let failed = 0;
for (const r of result) { if (!r.ok) failed++; console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  (' + r.detail + ')' : ''}`); }
for (const e of errors) console.log('PAGE ERROR:', e.slice(0, 500));
await browser.close(); server.close();
if (failed || errors.length) { console.log(`\n${failed} failed, ${errors.length} page errors`); process.exit(1); }
console.log('\nAll checks passed.');
process.exit(0);
