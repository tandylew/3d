// Builds terrain patch geometry off the main thread so the headset never
// drops frames while new ground streams in.
import { PLANETS, terrainRaw, shade } from './worlds.js';
import { FACES, GRID, patchDir } from './cubesphere.js';

const N = GRID;            // cells per side
const V = N + 1;           // vertices per side
const B = V + 2;           // with a one-vertex border for normals
const VERTS = V * V + 4 * V;
const TILE = 64;           // detail-texture tiling period in metres

const hgt = new Float64Array(B * B);
const px = new Float64Array(B * B), py = new Float64Array(B * B), pz = new Float64Array(B * B);
const dxs = new Float64Array(B * B), dys = new Float64Array(B * B), dzs = new Float64Array(B * B);
const d = [0, 0, 0];
const sh = { r: 0, g: 0, b: 0, liq: 0, glow: 0, shine: 0 };

function build(job) {
  const def = PLANETS[job.planet];
  const R = def.radius;
  const face = FACES[job.face];
  const span = 2 / (1 << job.level);
  const u0 = -1 + job.ix * span, v0 = -1 + job.iy * span;
  const mf = 16 * (1 << job.level);
  const full = job.level >= job.maxLevel ? Infinity : mf;

  patchDir(face, u0 + span / 2, v0 + span / 2, d);
  const hc = terrainRaw(def, d[0], d[1], d[2], full);
  const hcR = def.liquid && hc < 0 ? 0 : hc;
  const cx = d[0] * (R + hcR), cy = d[1] * (R + hcR), cz = d[2] * (R + hcR);

  for (let j = 0; j < B; j++) {
    for (let i = 0; i < B; i++) {
      const k = j * B + i;
      patchDir(face, u0 + ((i - 1) / N) * span, v0 + ((j - 1) / N) * span, d);
      const h = terrainRaw(def, d[0], d[1], d[2], full);
      hgt[k] = h;
      const r = R + (def.liquid && h < 0 ? 0 : h);
      dxs[k] = d[0]; dys[k] = d[1]; dzs[k] = d[2];
      px[k] = d[0] * r; py[k] = d[1] * r; pz[k] = d[2] * r;
    }
  }

  const pos = new Float32Array(VERTS * 3), nrm = new Float32Array(VERTS * 3);
  const col = new Float32Array(VERTS * 3), aux = new Float32Array(VERTS * 3), dps = new Float32Array(VERTS * 3);
  const ox = cx - Math.round(cx / TILE) * TILE, oy = cy - Math.round(cy / TILE) * TILE, oz = cz - Math.round(cz / TILE) * TILE;
  let rad2 = 0, minH = 1e9, maxH = -1e9;

  for (let j = 0; j < V; j++) {
    for (let i = 0; i < V; i++) {
      const k = (j + 1) * B + (i + 1), o = (j * V + i) * 3;
      const ux = dxs[k], uy = dys[k], uz = dzs[k];
      const ax = px[k + 1] - px[k - 1], ay = py[k + 1] - py[k - 1], az = pz[k + 1] - pz[k - 1];
      const bx = px[k + B] - px[k - B], by = py[k + B] - py[k - B], bz = pz[k + B] - pz[k - B];
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;
      const h = hgt[k];
      const slope = 1 - (nx * ux + ny * uy + nz * uz);
      shade(def, ux, uy, uz, h, slope, sh, full);
      if (sh.liq) { nx = ux; ny = uy; nz = uz; }
      const x = px[k] - cx, y = py[k] - cy, z = pz[k] - cz;
      pos[o] = x; pos[o + 1] = y; pos[o + 2] = z;
      nrm[o] = nx; nrm[o + 1] = ny; nrm[o + 2] = nz;
      col[o] = sh.r; col[o + 1] = sh.g; col[o + 2] = sh.b;
      aux[o] = h > 40 ? 1 : h < -40 ? -1 : h / 40; aux[o + 1] = sh.glow; aux[o + 2] = sh.shine;
      dps[o] = x + ox; dps[o + 1] = y + oy; dps[o + 2] = z + oz;
      const r2 = x * x + y * y + z * z;
      if (r2 > rad2) rad2 = r2;
      const hr = def.liquid && h < 0 ? 0 : h;
      if (hr < minH) minH = hr;
      if (hr > maxH) maxH = hr;
    }
  }

  // Skirts: a curtain hanging off each edge hides cracks between LOD levels.
  const drop = ((R * Math.PI) / 2 / (1 << job.level)) * 0.06 + 1;
  let s = V * V;
  const skirt = (i, j) => {
    const src = (j * V + i) * 3, dst = s * 3, k = (j + 1) * B + (i + 1);
    pos[dst] = pos[src] - dxs[k] * drop; pos[dst + 1] = pos[src + 1] - dys[k] * drop; pos[dst + 2] = pos[src + 2] - dzs[k] * drop;
    for (let c = 0; c < 3; c++) {
      nrm[dst + c] = nrm[src + c]; col[dst + c] = col[src + c]; aux[dst + c] = aux[src + c];
      dps[dst + c] = dps[src + c];
    }
    s++;
  };
  for (let i = 0; i < V; i++) skirt(i, 0);
  for (let i = 0; i < V; i++) skirt(i, N);
  for (let j = 0; j < V; j++) skirt(0, j);
  for (let j = 0; j < V; j++) skirt(N, j);

  return { id: job.id, pos, nrm, col, aux, dps, center: [cx, cy, cz], radius: Math.sqrt(rad2) + drop, minH, maxH };
}

self.onmessage = (e) => {
  const out = build(e.data);
  self.postMessage(out, [out.pos.buffer, out.nrm.buffer, out.col.buffer, out.aux.buffer, out.dps.buffer]);
};
