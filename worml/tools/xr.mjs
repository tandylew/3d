// Runs the game inside an emulated Meta Quest 3 WebXR runtime (IWER, Meta's
// own emulator) to exercise the real immersive-vr code path: session start,
// stereo rendering, Touch controller tracking, triggers, grips and sticks.
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { serve } from './serve.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const server = await serve(0);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1024, height: 512 } });
page.setDefaultTimeout(180000);
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e.stack || e)));
await page.addInitScript(await readFile(require.resolve('iwer/build/iwer.min.js'), 'utf8'));
await page.addInitScript(() => {
  const d = new IWER.XRDevice(IWER.metaQuest3);
  d.installRuntime({ forceInstall: true });
  window.xrDevice = d;
});
await page.goto(`http://localhost:${server.address().port}/?reset`);
await page.waitForFunction(() => window.worml?.ready);
const log = [];
const check = (name, ok, detail = '') => log.push({ name, ok: !!ok, detail: String(detail) });

check('Enter VR button offered', await page.isVisible('#enter-vr'));
await page.click('#enter-vr');
await page.waitForFunction(() => window.worml.renderer.xr.isPresenting);
await page.waitForTimeout(1500);

const wait = (ms) => page.waitForTimeout(ms);
const state = () => page.evaluate(() => {
  const { game: g, input, renderer } = window.worml, p = g.player;
  const cam = renderer.xr.getCamera();
  return {
    presenting: renderer.xr.isPresenting, xr: input.xr, eyes: cam.cameras.length,
    left: input.left.active, right: input.right.active, trigger: input.right.trigger,
    alt: p.alt, speed: p.speed, water: g.state.inv.water, overlayHidden: document.getElementById('overlay').classList.contains('hidden'),
    wristOnLeft: g.hud.wrist.mesh.parent === input.ctrl.find((k) => k.handed === 'left')?.ray,
    // heading: the rig's forward axis, flattened against the local up (the rig also rolls upright as you move over a small world)
    fwd: (() => { const f = new window.worml.THREE.Vector3(0, 0, -1).applyQuaternion(g.rig.quaternion); f.addScaledVector(p.up, -f.dot(p.up)).normalize(); return f.toArray(); })(),
  };
});

let s = await state();
check('immersive session presenting in stereo', s.presenting && s.xr && s.eyes === 2 && s.overlayHidden, `eyes=${s.eyes}`);
check('both Touch controllers tracked', s.left && s.right);
check('wrist display attached to left controller', s.wristOnLeft);
await page.screenshot({ path: 'shots/xr-ground.png' });

// Point the right controller up and forward, squeeze the trigger: take off.
await page.evaluate(() => {
  const c = window.xrDevice.controllers.right;
  c.position.set(0.25, 1.3, -0.3);
  c.quaternion.set(Math.sin(0.45), 0, 0, Math.cos(0.45)); // pitched 0.9 rad upward
  c.updateButtonValue('trigger', 1);
});
// (software rendering runs at a few fps, so wait on altitude rather than the clock)
await page.waitForFunction(() => window.worml.game.player.alt > 8, null, { timeout: 60000 }).catch(() => {});
s = await state();
check('trigger thrust lifts off', s.trigger > 0.9 && s.alt > 8 && s.speed > 10, `alt=${s.alt.toFixed(0)} m, speed=${s.speed.toFixed(0)} m/s`);
await page.screenshot({ path: 'shots/xr-flight.png' });
await page.evaluate(() => window.xrDevice.controllers.right.updateButtonValue('trigger', 0));

// Snap turn on the right stick.
await page.evaluate(() => { const g = window.worml.game; g.warpTo('thalassa', 0, 140); });
await wait(2500);
const f0 = (await state()).fwd;
await page.evaluate(() => window.xrDevice.controllers.right.updateAxes('thumbstick', 1, 0));
await wait(1200);
await page.evaluate(() => window.xrDevice.controllers.right.updateAxes('thumbstick', 0, 0));
await wait(600);
s = await state();
let dy = Math.acos(Math.max(-1, Math.min(1, s.fwd[0] * f0[0] + s.fwd[1] * f0[1] + s.fwd[2] * f0[2])));
check('right stick snap-turns 30 degrees', Math.abs(dy - Math.PI / 6) < 0.12, `turned ${(dy * 180 / Math.PI).toFixed(1)} deg`);

// Right grip casts essence; left grip uses the time relic; A leaps; Y shows objectives.
const g2 = () => page.evaluate(() => { const g = window.worml.game; return { carried: Object.values(g.state.inv).reduce((a, b) => a + b, 0), slow: g.time.slowT, alt: g.player.alt, hud: g.hud.wrist.mesh.visible, bolts: g.combat.bolts.length }; });
await page.evaluate(() => { const g = window.worml.game; g.grant(9); g.time.give('pearls'); });
check('objectives panel hidden by default', !(await g2()).hud);
const c0 = (await g2()).carried;
await page.evaluate(() => window.xrDevice.controllers.right.updateButtonValue('squeeze', 1));
await page.waitForFunction((n) => Object.values(window.worml.game.state.inv).reduce((a, b) => a + b, 0) < n, c0, { timeout: 120000 }).catch(() => {});
await page.evaluate(() => window.xrDevice.controllers.right.updateButtonValue('squeeze', 0));
let q = await g2();
check('right grip casts essence', q.carried < c0, `carried ${c0} -> ${q.carried}`);
await page.evaluate(() => window.xrDevice.controllers.left.updateButtonValue('squeeze', 1));
await page.waitForFunction(() => window.worml.game.time.slowT > 0, null, { timeout: 30000 }).catch(() => {});
await page.evaluate(() => window.xrDevice.controllers.left.updateButtonValue('squeeze', 0));
check('left grip uses the time relic', (await g2()).slow > 0);
await page.evaluate(() => window.xrDevice.controllers.left.updateButtonValue('y-button', 1));
await page.waitForFunction(() => window.worml.game.hud.wrist.mesh.visible, null, { timeout: 30000 }).catch(() => {});
await page.evaluate(() => window.xrDevice.controllers.left.updateButtonValue('y-button', 0));
check('Y shows the objectives on the wrist', (await g2()).hud);
const a0 = (await g2()).alt;
await page.evaluate(() => window.xrDevice.controllers.right.updateButtonValue('a-button', 1));
await wait(800);
await page.evaluate(() => window.xrDevice.controllers.right.updateButtonValue('a-button', 0));
await page.waitForFunction((a) => window.worml.game.player.alt > a + 60, a0, { timeout: 90000 }).catch(() => {});
q = await g2();
check('A makes a leap', q.alt > a0 + 60, `alt ${a0.toFixed(0)} -> ${q.alt.toFixed(0)} m`);
await page.screenshot({ path: 'shots/xr-leap.png' });

// Swing the right controller: a blade.
const sl0 = await page.evaluate(() => window.worml.game.combat.slashCount || 0);
await page.evaluate(() => new Promise((done) => {
  const c = window.xrDevice.controllers.right; let i = 0;
  const id = setInterval(() => { c.position.set(-0.5 + i * 0.12, 1.3, -0.4); if (++i > 12) { clearInterval(id); done(); } }, 30);
}));
await page.waitForFunction((n) => (window.worml.game.combat.slashCount || 0) > n, sl0, { timeout: 30000 }).catch(() => {});
check('swinging a controller throws a blade', (await page.evaluate(() => window.worml.game.combat.slashCount || 0)) > sl0);

let failed = 0;
for (const r of log) { if (!r.ok) failed++; console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  (' + r.detail + ')' : ''}`); }
for (const e of errors) console.log('PAGE ERROR:', e.slice(0, 500));
await browser.close(); server.close();
if (failed || errors.length) { console.log(`\n${failed} failed, ${errors.length} page errors`); process.exit(1); }
console.log('\nAll XR checks passed.');
process.exit(0);
