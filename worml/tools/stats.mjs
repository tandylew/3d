// Dev tool: print terrain statistics per world (height range, liquid cover, gate site).
import { PLANETS, terrainRaw } from '../src/worlds.js';
for (const d of PLANETS) {
  let mn = 1e9, mx = -1e9, liq = 0; const N = 20000;
  const t0 = performance.now();
  for (let i = 0; i < N; i++) {
    const y = 1 - (2 * (i + 0.5)) / N, r = Math.sqrt(1 - y * y), a = i * 2.399963;
    const h = terrainRaw(d, Math.cos(a) * r, y, Math.sin(a) * r);
    if (h < mn) mn = h; if (h > mx) mx = h; if (h < 0) liq++;
  }
  const ms = performance.now() - t0;
  console.log(d.id.padEnd(9), 'min', mn.toFixed(0).padStart(6), 'max', mx.toFixed(0).padStart(6), 'below0', ((liq / N) * 100).toFixed(0) + '%', 'gateH', d.gate.h.toFixed(0), (ms / N * 1000).toFixed(1) + 'us/sample');
}
