// Dev tool: boot the game headless, run a script of debug steps, save screenshots.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { serve } from './serve.mjs';

const server = await serve(0);
const url = `http://localhost:${server.address().port}/?reset`;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') { errors.push(m.text()); console.log('[console]', m.type(), m.text().slice(0, 600)); } });
page.on('pageerror', (e) => { errors.push(String(e)); console.log('[pageerror]', e.stack || e); });
await page.goto(url);
try {
  await page.waitForFunction(() => window.worml?.ready, null, { timeout: 120000 });
} catch (e) { console.log('not ready:', e.message.split('\n')[0]); }
const steps = process.argv.slice(2);
page.setDefaultTimeout(120000);
await page.screenshot({ path: 'shots/00-title.png' });
await page.evaluate(() => { document.getElementById('overlay').classList.add('hidden'); window.worml.game.begin(); });
let n = 1;
for (const step of steps) {
  const [name, code, wait] = step.split('::');
  if (code) await page.evaluate(code);
  await page.waitForTimeout(Number(wait) || 2500);
  await page.screenshot({ path: `shots/${String(n++).padStart(2, '0')}-${name}.png` });
  console.log('shot', name, await page.evaluate(() => { const g = window.worml.game, p = g.player; return JSON.stringify({ planet: p.planet.def.id, alt: Math.round(p.alt), speed: Math.round(p.speed), pending: g.manager.pending, props: g.props.count, calls: window.worml.renderer.info.render.calls, tris: window.worml.renderer.info.render.triangles }); }));
}
console.log('errors:', errors.length);
await browser.close();
server.close();
