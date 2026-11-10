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
    left: input.left.active, right: input.right.active, trigger: input.right.trigger, grip: input.left.grip,
    alt: p.alt, speed: p.speed, water: g.state.inv.water, overlayHidden: document.getElementById('overlay').classList.contains('hidden'),
    wristOnLeft: g.hud.wrist.mesh.parent === input.ctrl.find((k) => k.handed === 'left')?.ray,
    yaw: Math.atan2(...(() => { const e = g.rig.matrixWorld.elements; return [e[8], e[10]]; })()),
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
await wait(6000);
s = await state();
check('trigger thrust lifts off', s.trigger > 0.9 && s.alt > 5 && s.speed > 20, `alt=${s.alt.toFixed(0)} m, speed=${s.speed.toFixed(0)} m/s`);
await page.screenshot({ path: 'shots/xr-flight.png' });
await page.evaluate(() => window.xrDevice.controllers.right.updateButtonValue('trigger', 0));

// Snap turn on the right stick.
const yaw0 = (await state()).yaw;
await page.evaluate(() => window.xrDevice.controllers.right.updateAxes('thumbstick', 1, 0));
await wait(1200);
await page.evaluate(() => window.xrDevice.controllers.right.updateAxes('thumbstick', 0, 0));
await wait(600);
s = await state();
let dy = Math.abs(s.yaw - yaw0); if (dy > Math.PI) dy = 2 * Math.PI - dy;
check('right stick snap-turns 30 degrees', Math.abs(dy - Math.PI / 6) < 0.12, `turned ${(dy * 180 / Math.PI).toFixed(1)} deg`);

// Left grip gathers essence: stand among the orbs and squeeze.
await page.evaluate(() => {
  const g = window.worml.game, f = g.fields.get('thalassa'), o = f.orbs[0];
  g.player.pos.copy(g.player.planet.pos).add(f.anchor).add(o.home).addScaledVector(o.up, -1.2);
  window.xrDevice.controllers.left.updateButtonValue('squeeze', 1);
});
await wait(7000);
s = await state();
check('left grip draws in essence', s.grip > 0.9 && s.water >= 1, `water=${s.water}`);
await page.evaluate(() => window.xrDevice.controllers.left.updateButtonValue('squeeze', 0));

let failed = 0;
for (const r of log) { if (!r.ok) failed++; console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  (' + r.detail + ')' : ''}`); }
for (const e of errors) console.log('PAGE ERROR:', e.slice(0, 500));
await browser.close(); server.close();
if (failed || errors.length) { console.log(`\n${failed} failed, ${errors.length} page errors`); process.exit(1); }
console.log('\nAll XR checks passed.');
process.exit(0);
