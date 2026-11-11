// UI test (`npm run test:ui`): phone-sized touch session + the dev dashboard.
// Checks the touch controls drive the game, every warp lands somewhere sane,
// and the control demos run. Saves screenshots to shots/.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { serve } from './serve.mjs';
const { chromium, devices } = createRequire(import.meta.url)('playwright');

mkdirSync('shots', { recursive: true });
const server = await serve(0);
const base = `http://localhost:${server.address().port}/?reset&res=0.5`;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [], log = [];
const check = (name, ok, detail = '') => log.push({ name, ok: !!ok, detail: String(detail) });
const watch = (page) => { page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', (e) => errors.push(String(e.stack || e))); };

// ---------------------------------------------------------------- phone
{
  const ctx = await browser.newContext({ ...devices['Pixel 7 landscape'], deviceScaleFactor: 1 });
  const page = await ctx.newPage(); watch(page); page.setDefaultTimeout(180000);
  await page.goto(base);
  await page.waitForFunction(() => window.worml?.ready);
  check('phone: play button says Play', (await page.textContent('#enter-desktop')) === 'Play');
  await page.tap('#enter-desktop');
  await page.waitForTimeout(1500);
  check('phone: touch controls shown', await page.isVisible('.t-fly') && await page.isVisible('#t-base'));
  const state = () => page.evaluate(() => { const { input, game } = window.worml; return { trig: input.right.trigger, grip: input.right.grip, mx: input.move.x, my: input.move.y, lift: input.lift, yaw: input.yaw, alt: game.player.alt, speed: game.player.speed }; });
  const hold = async (sel, fn) => {
    const box = await page.locator(sel).boundingBox(), x = box.x + box.width / 2, y = box.y + box.height / 2;
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 7 }] });
    await page.waitForTimeout(1500);
    const r = await fn();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(1200);
    return r;
  };
  let s = await hold('.t-fly', state);
  check('phone: FLY button thrusts', s.trig === 1 && s.speed > 1, `trigger=${s.trig} speed=${s.speed.toFixed(1)}`);
  s = await hold('.t-grip', state);
  check('phone: GATHER button grips', s.grip === 1);
  s = await hold('.t-up', state);
  check('phone: ▲ lifts', s.lift === 1);
  s = await state();
  check('phone: buttons release', s.trig === 0 && s.grip === 0 && s.lift === 0);
  // stick + look, with two fingers at once
  const cdp = await ctx.newCDPSession(page), vp = page.viewportSize(), yaw0 = s.yaw;
  const sx = 110, sy = vp.height - 100, lx = vp.width * 0.6, ly = vp.height * 0.4;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sx, y: sy, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sx, y: sy, id: 1 }, { x: lx, y: ly, id: 2 }] });
  for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: sx, y: sy - i * 10, id: 1 }, { x: lx + i * 20, y: ly, id: 2 }] });
  await page.waitForTimeout(700);
  s = await state();
  check('phone: stick walks forward', s.my > 0.8 && Math.abs(s.mx) < 0.2, `move=(${s.mx.toFixed(2)}, ${s.my.toFixed(2)})`);
  check('phone: dragging turns the view', Math.abs(s.yaw - yaw0) > 0.2, `yaw ${yaw0.toFixed(2)} -> ${s.yaw.toFixed(2)}`);
  await page.screenshot({ path: 'shots/ui-phone.png' });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(300);
  s = await state();
  check('phone: stick recentres', s.mx === 0 && s.my === 0);
  check('phone: prompts name touch controls', await page.evaluate(() => window.worml.game.labels().grip === 'GATHER'));
  await page.tap('#btn-dev');
  await page.waitForTimeout(500);
  check('phone: dashboard opens', await page.isVisible('#dev'));
  await page.screenshot({ path: 'shots/ui-phone-dev.png' });
  await ctx.close();
}

// ---------------------------------------------------------------- portrait phone
{
  const ctx = await browser.newContext({ ...devices['Pixel 7'], deviceScaleFactor: 1 });
  const page = await ctx.newPage(); watch(page); page.setDefaultTimeout(180000);
  await page.goto(base);
  await page.waitForFunction(() => window.worml?.ready);
  await page.screenshot({ path: 'shots/ui-portrait-title.png' });
  await page.tap('#enter-desktop');
  await page.waitForTimeout(2500);
  const fov = await page.evaluate(() => window.worml.camera.fov);
  check('portrait: field of view widened', fov > 80, `fov=${fov.toFixed(0)}`);
  await page.screenshot({ path: 'shots/ui-portrait.png' });
  await ctx.close();
}

// ---------------------------------------------------------------- desktop dashboard
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }); watch(page); page.setDefaultTimeout(180000);
  await page.goto(base);
  await page.waitForFunction(() => window.worml?.ready);
  await page.click('#open-dev');
  await page.waitForTimeout(3000);
  check('desktop: dashboard opens from the title screen', await page.isVisible('#dev') && await page.evaluate(() => document.getElementById('overlay').classList.contains('hidden')));
  check('desktop: telemetry is live', (await page.textContent('#dv-tele')).includes('Thalassa'));
  // every warp for every world, driven through the real buttons
  const worlds = await page.$$eval('[data-world]', (els) => els.map((e) => e.dataset.world));
  const places = await page.$$eval('.grid [data-place]', (els) => els.map((e) => e.dataset.place));
  const bad = [];
  for (const w of worlds) {
    await page.click(`[data-world="${w}"]`);
    for (const pl of places) {
      await page.click(`[data-place="${pl}"]`);
      await page.waitForTimeout(60);
      const r = await page.evaluate(() => { const p = window.worml.game.player; return { id: p.planet.def.id, alt: p.alt, ok: Number.isFinite(p.pos.x + p.pos.y + p.pos.z) && Number.isFinite(window.worml.rig.quaternion.x) }; });
      const global = ['sun', 'system', 'midway'].includes(pl);
      if (!r.ok || (!global && r.id !== w) || (!global && r.alt < -1)) bad.push(`${w}/${pl}:${JSON.stringify(r)}`);
    }
  }
  check(`desktop: ${worlds.length * places.length} warps land cleanly`, bad.length === 0, bad.join(' '));
  // a look at a few
  for (const [w, pl, wait] of [['petra', 'peak', 9000], ['pyra', 'shore', 9000], ['arcana', 'gate', 9000], ['ferrum', 'orbit', 7000], ['sylva', 'sunset', 9000]]) {
    await page.click(`[data-world="${w}"]`); await page.click(`[data-place="${pl}"]`);
    await page.waitForTimeout(wait);
    await page.screenshot({ path: `shots/ui-${w}-${pl}.png` });
  }
  // quest shortcuts
  await page.click('summary:has-text("Quest")');
  await page.click('[data-quest="next"]');
  check('desktop: unseal-next opens Pyra', await page.evaluate(() => window.worml.game.state.open.pyra === true));
  await page.click('[data-quest="all"]');
  check('desktop: unseal-all wins', await page.evaluate(() => window.worml.game.state.won === true));
  await page.click('[data-quest="reset"]');
  check('desktop: reset reseals', await page.evaluate(() => { const s = window.worml.game.state; return !s.won && s.order.length === 1; }));
  // tuning
  await page.click('summary:has-text("Look")');
  await page.fill('#dv-exposure', '1.4'); await page.dispatchEvent('#dv-exposure', 'input');
  await page.fill('#dv-rate', '2'); await page.dispatchEvent('#dv-rate', 'input');
  check('desktop: sliders apply', await page.evaluate(() => window.worml.renderer.toneMappingExposure === 1.4));
  await page.click('[data-tune="reset"]');
  check('desktop: tuning resets', await page.evaluate(() => window.worml.renderer.toneMappingExposure === 1));
  // demos, run on a fixed clock so slow software rendering doesn't matter
  const demo = await page.evaluate(() => {
    const { game: g, dev, renderer } = window.worml;
    renderer.setAnimationLoop(null);
    const DT = 1 / 60; let t = 5000; const out = {};
    const run = (name, maxSec) => {
      dev.warp('thalassa', 'gate');
      for (let i = 0; i < 30; i++) { t += DT; dev.update(DT); g.frame(DT, t); }
      dev.startDemo(name);
      let sec = 0, caps = new Set();
      while (dev.demo && sec < maxSec) { t += DT; sec += DT; dev.update(DT); g.frame(DT, t); caps.add(document.querySelector('#demo-banner b')?.textContent); }
      const p = g.player;
      out[name] = { sec: Math.round(sec), done: !dev.demo, caps: caps.size, planet: p.planet.def.id, alt: Math.round(p.alt), water: g.state.inv.water, open: g.state.order.join('>') };
      dev.stopDemo();
    };
    run('walk', 40); run('gather', 120); run('flight', 150); run('unseal', 60); run('transit', 80); run('travel', 400);
    return out;
  });
  check('demo: walk completes', demo.walk.done, JSON.stringify(demo.walk));
  check('demo: gather collects essence', demo.gather.done && demo.gather.water >= 2, JSON.stringify(demo.gather));
  check('demo: flight returns to the ground', demo.flight.done && demo.flight.alt < 60, JSON.stringify(demo.flight));
  check('demo: unseal opens Pyra', demo.unseal.done && demo.unseal.open.includes('pyra'), JSON.stringify(demo.unseal));
  check('demo: transit changes world', demo.transit.done && demo.transit.planet !== 'thalassa', JSON.stringify(demo.transit));
  check('demo: travel lands on another world', demo.travel.done && demo.travel.alt < 80, JSON.stringify(demo.travel));
  await page.close();
}

let failed = 0;
for (const r of log) { if (!r.ok) failed++; console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail && (!r.ok || r.detail.length < 90) ? '  (' + r.detail + ')' : ''}`); }
for (const e of errors) console.log('PAGE ERROR:', e.slice(0, 600));
await browser.close(); server.close();
if (failed || errors.length) { console.log(`\n${failed} failed, ${errors.length} page errors`); process.exit(1); }
console.log('\nAll UI checks passed.');
process.exit(0);
