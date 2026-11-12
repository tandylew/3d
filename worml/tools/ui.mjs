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
const want = (part) => !process.env.ONLY || process.env.ONLY === part;
const watch = (page) => { page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', (e) => errors.push(String(e.stack || e))); };

// ---------------------------------------------------------------- phone
if (want('phone')) {
  const ctx = await browser.newContext({ ...devices['Pixel 7 landscape'], deviceScaleFactor: 1 });
  const page = await ctx.newPage(); watch(page); page.setDefaultTimeout(180000);
  await page.goto(base);
  await page.waitForFunction(() => window.worml?.ready);
  check('phone: play button says Play', (await page.textContent('#enter-desktop')) === 'Play');
  await page.tap('#enter-desktop');
  await page.waitForTimeout(1500);
  check('phone: two sticks and nothing else', await page.isVisible('#t-left') && await page.isVisible('#t-right') && (await page.$$('.t-cast, .t-jump, .t-fly, .t-grip, .t-act')).length === 0 && !(await page.isVisible('.t-time')));
  check('phone: objectives hidden by default', await page.evaluate(() => !window.worml.game.hud.wrist.mesh.visible));
  const state = () => page.evaluate(() => { const { input, game } = window.worml; return { trig: input.right.trigger, mx: input.move.x, my: input.move.y, fly: input.flyMode, yaw: input.yaw, alt: game.player.alt, combat: input.touch.combat, slashes: game.combat.slashCount || 0, carried: Object.values(game.state.inv).reduce((a, b) => a + b, 0), last: game.lastCast, hold: input.touch.holdT }; });
  const cdp = await ctx.newCDPSession(page), vp = page.viewportSize();
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  const wait = (ms) => page.waitForTimeout(ms);
  const lx = 110, ly = vp.height - 70, rx = vp.width - 110, ry = vp.height - 70;
  let s = await state(); const yaw0 = s.yaw;
  // both thumbs at once: left walks, right looks
  await touch('touchStart', [{ x: lx, y: ly, id: 1 }]);
  await touch('touchStart', [{ x: lx, y: ly, id: 1 }, { x: rx, y: ry, id: 2 }]);
  for (let i = 1; i <= 6; i++) await touch('touchMove', [{ x: lx, y: ly - i * 10, id: 1 }, { x: rx + i * 10, y: ry, id: 2 }]);
  await wait(2500);
  s = await state();
  check('phone: left stick walks forward', s.my > 0.8 && Math.abs(s.mx) < 0.2 && s.trig === 0, `move=(${s.mx.toFixed(2)}, ${s.my.toFixed(2)})`);
  check('phone: right stick turns the view', Math.abs(s.yaw - yaw0) > 0.2, `yaw ${yaw0.toFixed(2)} -> ${s.yaw.toFixed(2)}`);
  check('phone: two thumbs do not zoom the page', await page.evaluate(() => (window.visualViewport?.scale ?? 1) === 1 && getComputedStyle(document.body).touchAction === 'none'));
  await touch('touchEnd', []); await wait(2500);
  s = await state();
  check('phone: sticks recentre', s.mx === 0 && s.my === 0);
  // pinch and double tap in the open area leave the scale alone
  await touch('touchStart', [{ x: vp.width * 0.4, y: vp.height * 0.3, id: 1 }, { x: vp.width * 0.6, y: vp.height * 0.3, id: 2 }]);
  for (let i = 1; i <= 8; i++) await touch('touchMove', [{ x: vp.width * 0.4 - i * 12, y: vp.height * 0.3, id: 1 }, { x: vp.width * 0.6 + i * 12, y: vp.height * 0.3, id: 2 }]);
  await touch('touchEnd', []); await wait(500);
  check('phone: pinch does not zoom', await page.evaluate(() => (window.visualViewport?.scale ?? 1) === 1 && window.innerWidth === document.documentElement.clientWidth));
  // with nothing to fight, dragging the open area looks around
  const y1 = (await state()).yaw;
  await touch('touchStart', [{ x: vp.width * 0.5, y: vp.height * 0.25, id: 3 }]);
  for (let i = 1; i <= 8; i++) await touch('touchMove', [{ x: vp.width * 0.5 + i * 14, y: vp.height * 0.25, id: 3 }]);
  await touch('touchEnd', []); await wait(1200);
  s = await state();
  check('phone: with nothing to fight, dragging the open area looks', !s.combat && Math.abs(s.yaw - y1) > 0.1 && s.slashes === 0, `yaw ${y1.toFixed(2)} -> ${s.yaw.toFixed(2)}`);
  check('phone: radar is shown', await page.evaluate(() => window.worml.game.hud.radar.mesh.visible));
  await page.screenshot({ path: 'shots/ui-phone.png' });
  // a guardian near: the open area takes attack gestures
  await page.evaluate(() => { const w = window.worml; w.game.grant(6); w.dev.summon(1); });
  await page.waitForFunction(() => window.worml.input.touch.combat, null, { timeout: 60000 }).catch(() => {});
  await wait(800);
  check('phone: a guardian near turns the open area into attack gestures', (await state()).combat && await page.isVisible('#t-hint'));
  const y2 = (await state()).yaw;
  await touch('touchStart', [{ x: vp.width * 0.3, y: vp.height * 0.3, id: 4 }]);
  for (let i = 1; i <= 6; i++) await touch('touchMove', [{ x: vp.width * 0.3 + i * 45, y: vp.height * 0.3 - i * 6, id: 4 }]);
  await touch('touchEnd', []);
  await page.waitForFunction(() => (window.worml.game.combat.slashCount || 0) > 0, null, { timeout: 30000 }).catch(() => {});
  s = await state();
  check('phone: a swipe throws a blade and does not turn the view', s.slashes === 1 && Math.abs(s.yaw - y2) < 0.01 && s.carried === 30, `slashes=${s.slashes}`);
  await touch('touchStart', [{ x: vp.width * 0.5, y: vp.height * 0.3, id: 5 }]); await wait(60); await touch('touchEnd', []);
  await page.waitForFunction(() => Object.values(window.worml.game.state.inv).reduce((a, b) => a + b, 0) < 30, null, { timeout: 30000 }).catch(() => {});
  s = await state();
  check('phone: a tap is a quick cast', s.carried === 29 && s.last === 'quick', `carried=${s.carried} last=${s.last}`);
  await touch('touchStart', [{ x: vp.width * 0.5, y: vp.height * 0.3, id: 6 }]);
  // (let go from inside the page on the very frame the ring flashes: at test frame rates the window is only a few frames wide)
  const ringOn = await page.evaluate(() => new Promise((done) => {
    const tick = () => { const r = document.getElementById('t-ring'); if (window.worml.input.touch.holdT >= 0.72) done(!r.hidden && r.classList.contains('perfect')); else requestAnimationFrame(tick); };
    tick();
  }));
  await touch('touchEnd', []);
  await page.waitForFunction(() => window.worml.game.lastCast === 'perfect', null, { timeout: 30000 }).catch(() => {});
  s = await state();
  check('phone: press and release on the flash is a perfect cast', ringOn && s.last === 'perfect' && s.carried === 28, `ring=${ringOn} last=${s.last}`);
  await page.evaluate(() => { const w = window.worml; w.game.combat.clear(() => true); w.game.health = 100; });
  await wait(1500);
  // double tap the look side: super leap, and flight follows
  const a0 = (await state()).alt;
  // (sent back to back: awaiting each one would space the taps by whole frames at test frame rates)
  await Promise.all([touch('touchStart', [{ x: rx, y: ry, id: 8 }]), touch('touchEnd', []), touch('touchStart', [{ x: rx, y: ry, id: 9 }]), touch('touchEnd', [])]);
  await page.waitForFunction((a) => window.worml.game.player.alt > a + 40, a0, { timeout: 90000 }).catch(() => {});
  s = await state();
  check('phone: double-tap on the look side is a super leap', s.alt > a0 + 40, `alt ${a0.toFixed(0)} -> ${s.alt.toFixed(0)} m`);
  await page.waitForFunction(() => !window.worml.game.player.leaping, null, { timeout: 120000 }).catch(() => {});
  await wait(500);
  check('phone: after a leap you are flying, with no button pressed', (await state()).fly === true);
  check('phone: prompts name touch gestures', await page.evaluate(() => window.worml.game.labels().slash.startsWith('Swipe')));
  await page.evaluate(() => window.worml.game.time.give('pearls'));
  await wait(1500);
  check('phone: TIME button appears once a relic is owned', await page.isVisible('.t-time') && (await page.textContent('.t-time')) === 'SLOW');
  await page.tap('.t-time'); await wait(1200);
  check('phone: TIME uses the relic', await page.evaluate(() => window.worml.game.time.slowT > 0));
  await page.tap('#btn-hud'); await wait(1500);
  check('phone: ◎ shows the objectives', await page.evaluate(() => window.worml.game.hud.wrist.mesh.visible));
  await page.screenshot({ path: 'shots/ui-phone-hud.png' });
  await page.tap('#btn-dev');
  await page.waitForTimeout(500);
  check('phone: dashboard opens', await page.isVisible('#dev'));
  await page.screenshot({ path: 'shots/ui-phone-dev.png' });
  await ctx.close();
}

// ---------------------------------------------------------------- portrait phone
if (want('portrait')) {
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
if (want('desktop')) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }); watch(page); page.setDefaultTimeout(180000);
  await page.goto(base);
  await page.waitForFunction(() => window.worml?.ready);
  await page.click('#open-dev');
  await page.waitForFunction(() => document.getElementById('dv-tele')?.textContent.includes('Thalassa'), null, { timeout: 60000 }).catch(() => {});
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
      if (!r.ok || (!global && r.id !== w)) bad.push(`${w}/${pl}:${JSON.stringify(r)}`);
    }
  }
  check(`desktop: ${worlds.length * places.length} warps land cleanly`, bad.length === 0, bad.join(' '));
  // a look at a few
  for (const [w, pl, wait] of [['thalassa', 'deposit', 10000], ['pyra', 'deposit', 10000], ['ferrum', 'deposit', 10000], ['sylva', 'deposit', 10000], ['petra', 'deposit', 10000], ['arcana', 'deposit', 10000], ['ferrum', 'anomaly', 9000], ['thalassa', 'far', 8000]]) {
    await page.click(`[data-world="${w}"]`); await page.click(`[data-place="${pl}"]`);
    await page.waitForTimeout(wait);
    await page.screenshot({ path: `shots/ui-${w}-${pl}.png` });
  }
  // spells and relics panel
  const ars = () => page.evaluate(() => { const g = window.worml.game; return { force: g.forceEl, fire: g.state.inv.fire, bolts: g.combat.bolts.filter((b) => b.from === 'player').length, perfect: g.combat.bolts.some((b) => b.perfect), slow: g.time.slowT, sel: g.state.sel, owned: Object.keys(g.state.weapons).length, blooms: g.time.blooms.length + g.time.grenades.length, echo: !!g.time.echo, last: g.lastCast }; });
  await page.click('[data-spell="fire"]');
  let a = await ars();
  check('desktop: spell buttons force the cast element', a.force === 'fire' && a.fire === 12);
  await page.click('[data-cast="perfect"]'); await page.waitForTimeout(150);
  a = await ars();
  check('desktop: perfect cast on demand', a.last === 'perfect' && a.fire === 11, JSON.stringify(a));
  await page.click('[data-cast="quick"]'); await page.click('[data-cast="over"]');
  check('desktop: quick and overheld casts on demand', (await ars()).fire === 9);
  await page.click('[data-spell="auto"]');
  check('desktop: Auto clears the forced element', (await ars()).force === null);
  await page.click('[data-relic="pearls"]'); await page.waitForTimeout(100);
  a = await ars();
  check('desktop: relic button gives and uses the Pearls', a.slow > 0 && a.sel === 'pearls');
  await page.click('[data-relic="seeds"]'); await page.waitForTimeout(100);
  check('desktop: relic button throws a Quickening Seed', (await ars()).blooms === 1);
  await page.click('[data-relic="mantle"]'); await page.waitForTimeout(100);
  check('desktop: relic button raises the Mantle echo', (await ars()).echo);
  await page.click('[data-relic="rewinder"]'); await page.waitForTimeout(100);
  check('desktop: all four relics owned after using each', (await ars()).owned === 4);
  check('desktop: arsenal readout is live', (await page.textContent('#dv-arsenal')).includes('World time'));
  await page.click('[data-arsenal="calm"]');
  // quest shortcuts
  await page.click('summary:has-text("Quest")');
  await page.click('[data-quest="next"]');
  check('desktop: unseal-next opens Pyra', await page.evaluate(() => window.worml.game.state.open.pyra === true));
  await page.click('[data-quest="all"]');
  check('desktop: unseal-all wins', await page.evaluate(() => window.worml.game.state.won === true));
  await page.click('[data-quest="finale"]'); await page.waitForTimeout(8000);
  await page.screenshot({ path: 'shots/ui-finale.png' });
  check('desktop: go-to-finale warps to the Sun arena with every trial mastered', await page.evaluate(() => { const g = window.worml.game; return g.player.arena && g.player.pos.distanceTo(g.player.arena) < 600 && Object.keys(g.state.trial).length === 6; }));
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
      out[name] = { trial: !!g.state.trial.thalassa, sec: Math.round(sec), done: !dev.demo, caps: caps.size, planet: p.planet.def.id, alt: Math.round(p.alt), inside: p.inside, water: g.state.inv.water, open: g.state.order.join('>'), health: Math.round(g.health), foes: g.combat.hunting };
      dev.stopDemo();
    };
    run('walk', 120); run('gather', 240); run('fight', 110); run('relics', 90); run('flight', 150); run('unseal', 60); run('transit', 160); run('travel', 400);
    return out;
  });
  check('demo: walk and leap completes', demo.walk.done && demo.walk.alt < 5, JSON.stringify(demo.walk));
  check('demo: the trial is won', demo.gather.done && demo.gather.trial && demo.gather.water >= 10, JSON.stringify(demo.gather));
  check('demo: fight clears the guardians', demo.fight.done && demo.fight.foes === 0, JSON.stringify(demo.fight));
  check('demo: relics runs through all four', demo.relics.done && demo.relics.caps >= 6, JSON.stringify(demo.relics));
  check('demo: flight returns to the ground', demo.flight.done && demo.flight.alt < 60, JSON.stringify(demo.flight));
  check('demo: unseal opens Pyra', demo.unseal.done && demo.unseal.open.includes('pyra'), JSON.stringify(demo.unseal));
  check('demo: transit goes core to core and back up', demo.transit.done && demo.transit.planet === 'pyra' && !demo.transit.inside, JSON.stringify(demo.transit));
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
