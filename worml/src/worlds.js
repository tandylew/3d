// World definitions and the procedural terrain functions. Shared verbatim by
// the main thread and the terrain worker so collision always matches the mesh.
import { Noise, clamp, lerp, smoothstep, mulberry32 } from './noise.js';

export const SUN = { name: 'Lumen', radius: 150000 };

// Terrain features are authored in metres at this reference radius, then kept
// at the same physical size on worlds of any radius.
const REF_RADIUS = 8000;

export const ELEMENTS = {
  water: { label: 'Water', css: '#4fc3ff', rgb: [0.25, 0.7, 1.0] },
  fire: { label: 'Fire', css: '#ff6a2a', rgb: [1.0, 0.38, 0.1] },
  metal: { label: 'Metal', css: '#cfd9e6', rgb: [0.72, 0.82, 0.92] },
  wood: { label: 'Wood', css: '#6fe05a', rgb: [0.35, 0.9, 0.3] },
  earth: { label: 'Earth', css: '#e6a55c', rgb: [0.92, 0.6, 0.28] },
  magic: { label: 'Magic', css: '#c77dff', rgb: [0.75, 0.42, 1.0] },
};
export const ELEMENT_ORDER = ['water', 'fire', 'metal', 'wood', 'earth', 'magic'];

// Quest order follows the classical overcoming cycle:
// water douses fire, fire melts metal, metal cuts wood, wood breaks earth.
export const PLANETS = [
  {
    id: 'thalassa', name: 'Thalassa', title: 'World of Water', element: 'water',
    radius: 30000, orbit: 1800000, angle: 40, lift: 0.03, seed: 1101, liquid: true, maxH: 1600,
    needs: null, lock: '',
    atmo: { scatter: [0.16, 0.4, 1.0], sunset: [1.0, 0.5, 0.25], density: 2.4, height: 900 },
    look: { rock: [0.31, 0.29, 0.27], rockP: [0.15, 0.3, 1], strata: 0.2, clouds: { mix: [0.55, 0, 0.33, 0.12], threshold: 0.5, soft: 0.13, opacity: 0.95, alt: 2300, tint: [1, 1, 1], drift: 0.0005 } },
    glow: [0.2, 0.9, 0.8],
  },
  {
    id: 'pyra', name: 'Pyra', title: 'World of Fire', element: 'fire',
    radius: 24000, orbit: 600000, angle: 12, lift: -0.02, seed: 2207, liquid: true, maxH: 3000,
    needs: { water: 5 }, lock: 'Wreathed in an undying firestorm. Water will douse it.',
    atmo: { scatter: [0.5, 0.3, 0.2], sunset: [1.0, 0.6, 0.3], density: 1.7, height: 900 },
    look: { rock: [0.15, 0.13, 0.125], rockP: [0.2, 0.42, 0.85], strata: 0.3, clouds: { mix: [0, 0.6, 0.3, 0.1], threshold: 0.5, soft: 0.2, opacity: 0.85, alt: 3900, tint: [0.34, 0.27, 0.24], drift: 0.0008 } },
    glow: [1.0, 0.33, 0.04],
  },
  {
    id: 'ferrum', name: 'Ferrum', title: 'World of Metal', element: 'metal',
    radius: 28000, orbit: 1000000, angle: 64, lift: 0.05, seed: 3319, liquid: true, maxH: 1200,
    needs: { fire: 5 }, lock: 'Sealed inside an iron shell. Fire will melt it.',
    atmo: { scatter: [0.3, 0.4, 0.54], sunset: [0.95, 0.72, 0.5], density: 1.4, height: 900 },
    look: { rock: [0.23, 0.24, 0.27], rockP: [0.1, 0.24, 1], strata: 0.3, metal: 0.45, clouds: { mix: [0.5, 0.3, 0, 0.2], threshold: 0.55, soft: 0.2, opacity: 0.6, alt: 2600, tint: [0.8, 0.82, 0.86], drift: 0.0004 } },
    glow: [0.15, 0.85, 1.0], rings: true,
  },
  {
    id: 'sylva', name: 'Sylva', title: 'World of Wood', element: 'wood',
    radius: 32000, orbit: 2250000, angle: 86, lift: -0.04, seed: 4421, liquid: true, maxH: 1600,
    needs: { metal: 5 }, lock: 'Strangled by iron-thorn vines. Metal will cut them.',
    atmo: { scatter: [0.2, 0.5, 0.95], sunset: [1.0, 0.55, 0.3], density: 2.4, height: 900 },
    look: { rock: [0.3, 0.29, 0.26], rockP: [0.17, 0.32, 1], strata: 0.18, clouds: { mix: [0.1, 0.45, 0.33, 0.12], threshold: 0.48, soft: 0.14, opacity: 0.95, alt: 2500, tint: [1, 1, 1], drift: 0.0005 } },
    glow: [0.5, 1.0, 0.3],
  },
  {
    id: 'petra', name: 'Petra', title: 'World of Earth', element: 'earth',
    radius: 34000, orbit: 1400000, angle: 112, lift: 0.02, seed: 5527, liquid: false, maxH: 3400,
    needs: { wood: 5 }, lock: 'Buried under living stone. Wood will root it apart.',
    atmo: { scatter: [0.75, 0.5, 0.3], sunset: [1.0, 0.45, 0.2], density: 1.9, height: 900 },
    look: { rock: [0.52, 0.31, 0.21], rockP: [0.1, 0.26, 1], strata: 0.3, clouds: { mix: [0.6, 0, 0.3, 0.1], threshold: 0.57, soft: 0.15, opacity: 0.75, alt: 4300, tint: [1, 0.94, 0.86], drift: 0.0004 } },
    glow: [1.0, 0.7, 0.3],
  },
  {
    id: 'arcana', name: 'Arcana', title: 'World of Magic', element: 'magic',
    radius: 26000, orbit: 2800000, angle: 132, lift: 0.06, seed: 6631, liquid: true, maxH: 4500,
    needs: { water: 2, fire: 2, metal: 2, wood: 2, earth: 2 },
    lock: 'Bound by a void seal. It yields only to all five elements.',
    atmo: { scatter: [0.4, 0.3, 0.8], sunset: [0.4, 0.85, 1.0], density: 2.2, height: 900 },
    look: { rock: [0.24, 0.17, 0.36], rockP: [0.18, 0.36, 0.8], strata: 0.25, clouds: { mix: [0.3, 0.3, 0.3, 0.1], threshold: 0.52, soft: 0.18, opacity: 0.8, alt: 5300, tint: [0.85, 0.76, 1], drift: 0.0007 } },
    glow: [0.75, 0.3, 1.0],
  },
];

export const PLANET_BY_ID = Object.fromEntries(PLANETS.map((p) => [p.id, p]));

// ---------------------------------------------------------------- terrain

const RAW = {
  water(n, x, y, z, mf) {
    const c = n.fbm(x, y, z, 1.1, 5, mf);
    const m = c - 0.1 + n.fbm(x, y, z, 3.3, 4, mf) * 0.28;
    let h = m * 1500;
    if (m > -0.06) {
      const land = smoothstep(-0.06, 0.22, m);
      h += land * (n.ridged(x, y, z, 5, 7, mf) * 560 + n.fbm(x, y, z, 60, 6, mf) * 45);
    }
    return h;
  },
  fire(n, x, y, z, mf) {
    const b = n.fbm(x, y, z, 1.3, 5, mf);
    const r = n.ridged(x, y, z, 2.6, 8, mf);
    return b * 950 + 70 + r * r * 2600 * smoothstep(-0.15, 0.3, b) + n.fbm(x, y, z, 90, 6, mf) * 28;
  },
  metal(n, x, y, z, mf) {
    const b = n.fbm(x, y, z, 1.2, 5, mf) * 1000 + n.ridged(x, y, z, 3.1, 6, mf) * 700 - 150;
    const step = 140, t = b / step, fl = Math.floor(t), fr = t - fl;
    return (fl + smoothstep(0.72, 0.98, fr)) * step + fr * 14 + n.fbm(x, y, z, 120, 5, mf) * 7;
  },
  wood(n, x, y, z, mf) {
    const b = n.fbm(x, y, z, 1.5, 6, mf);
    let h = b * 760 + 120 + n.ridged(x, y, z, 4, 6, mf) * 900 * smoothstep(0.0, 0.4, b) + n.fbm(x, y, z, 70, 6, mf) * 34;
    const rv = Math.abs(n.fbm(x, y, z, 6, 4, mf));
    h -= (1 - smoothstep(0, 0.035, rv)) * clamp(h + 25, 0, 170);
    return h;
  },
  earth(n, x, y, z, mf) {
    const b = n.fbm(x, y, z, 1.1, 5, mf);
    let h = 300 + b * 650;
    h += smoothstep(0.04, 0.16, n.fbm(x, y, z, 4.2, 4, mf)) * 280;
    const mt = smoothstep(0.08, 0.45, b);
    h += mt * n.ridged(x, y, z, 3, 8, mf) * 3000;
    const cv = Math.abs(n.fbm(x, y, z, 5.5, 5, mf));
    h -= (1 - smoothstep(0.0, 0.05, cv)) * 330 * (1 - mt);
    return h + n.fbm(x, y, z, 150, 5, mf) * 12;
  },
  magic(n, x, y, z, mf) {
    const b = n.fbm(x, y, z, 1.4, 5, mf);
    const sp = n.ridged(x, y, z, 6, 7, mf);
    return b * 850 + 100 + sp * sp * sp * 6000 * smoothstep(-0.1, 0.3, b) + n.fbm(x, y, z, 45, 6, mf) * 48;
  },
};

// Raw height in metres relative to the planet's base radius (can be negative:
// below "sea level" on planets with a liquid).
export function terrainRaw(def, x, y, z, mf = Infinity, useGate = true) {
  const n = def.noise, k = def.radius / REF_RADIUS, sx = x * k, sy = y * k, sz = z * k, m = mf / k;
  let h = RAW[def.element](n, sx, sy, sz, m) + n.fbm(sx, sy, sz, 1300, 3, m) * 1.6;
  const g = def.gate;
  if (useGate && g) {
    const dx = x - g.x, dy = y - g.y, dz = z - g.z;
    const d2 = (dx * dx + dy * dy + dz * dz) * def.radius * def.radius;
    if (d2 < g.r1 * g.r1) h = lerp(g.h, h, smoothstep(g.r0, g.r1, Math.sqrt(d2)));
  }
  return h;
}

// Height of the walkable surface (liquid surfaces sit at 0).
export function groundHeight(def, x, y, z) {
  const h = terrainRaw(def, x, y, z);
  return def.liquid && h < 0 ? 0 : h;
}

const mix3 = (o, a, b, t) => { o.r = a[0] + (b[0] - a[0]) * t; o.g = a[1] + (b[1] - a[1]) * t; o.b = a[2] + (b[2] - a[2]) * t; };
const into = (o, b, t) => { o.r += (b[0] - o.r) * t; o.g += (b[1] - o.g) * t; o.b += (b[2] - o.b) * t; };

// Colours are sRGB albedos chosen from real materials (grass, wet sand,
// basalt, sandstone...) rather than pure hues; the fragment shader adds rock,
// strata and grain on top.
const SHADE = {
  water(n, x, y, z, h, sl, o) {
    if (h < 0) {
      mix3(o, [0.24, 0.52, 0.5], [0.03, 0.14, 0.25], smoothstep(0, 70, -h));
      into(o, [0.01, 0.06, 0.16], smoothstep(60, 600, -h));
      o.liq = 1; o.shine = 0.95; return;
    }
    const v = n.s(x * 70, y * 70, z * 70) * 0.5 + 0.5;
    mix3(o, [0.29, 0.34, 0.19], [0.4, 0.42, 0.25], v);
    into(o, [0.44, 0.42, 0.27], smoothstep(0.55, 0.9, n.s(x * 23 + 5, y * 23, z * 23) * 0.5 + 0.5) * 0.6);
    into(o, [0.36, 0.38, 0.28], smoothstep(250, 600, h));
    into(o, [0.82, 0.76, 0.62], 1 - smoothstep(5, 18, h + v * 6));
    into(o, [0.4, 0.38, 0.34], smoothstep(0.14, 0.3, sl) * 0.5);
    into(o, [0.93, 0.94, 0.96], smoothstep(900, 1150, h) * (1 - smoothstep(0.2, 0.34, sl)));
    o.shine = 0.06;
  },
  fire(n, x, y, z, h, sl, o, mf) {
    if (h < 0) {
      mix3(o, [0.5, 0.12, 0.03], [0.95, 0.42, 0.08], smoothstep(0, 40, -h));
      o.liq = 1; o.glow = 0.55 + 0.45 * smoothstep(0, 30, -h); o.shine = 0.12; return;
    }
    const v = n.s(x * 40, y * 40, z * 40) * 0.5 + 0.5;
    mix3(o, [0.12, 0.11, 0.11], [0.27, 0.24, 0.22], v * (0.4 + smoothstep(0.05, 0.3, sl) * 0.6));
    into(o, [0.36, 0.2, 0.14], smoothstep(700, 1700, h) * 0.7);
    into(o, [0.5, 0.44, 0.2], smoothstep(0.7, 0.92, n.s(x * 17 - 3, y * 17, z * 17) * 0.5 + 0.5) * 0.35);
    const vein = (1 - smoothstep(0.0, 0.022, Math.abs(n.fbm(x, y, z, 45, 3, mf)))) * (1 - smoothstep(40, 520, h));
    const shore = 1 - smoothstep(0, 14, h);
    o.glow = Math.max(vein * 0.9, shore * 0.6);
    into(o, [0.6, 0.2, 0.06], o.glow * 0.45);
    o.shine = 0.22;
  },
  metal(n, x, y, z, h, sl, o, mf) {
    if (h < 0) { o.r = 0.5; o.g = 0.52; o.b = 0.56; o.liq = 1; o.shine = 1; return; }
    const v = n.fbm(x, y, z, 22, 3, mf) + 0.5;
    mix3(o, [0.34, 0.34, 0.36], [0.22, 0.22, 0.25], clamp(v, 0, 1));
    into(o, [0.42, 0.25, 0.16], smoothstep(0.5, 0.78, n.s(x * 9, y * 9, z * 9) * 0.5 + 0.5) * 0.85);
    into(o, [0.5, 0.48, 0.44], smoothstep(600, 850, h));
    const riser = smoothstep(0.1, 0.24, sl);
    into(o, [0.16, 0.16, 0.19], riser * 0.6);
    const seam = (1 - smoothstep(0.0, 0.014, Math.abs(n.fbm(x, y, z, 70, 2, mf)))) * (1 - riser);
    o.glow = seam * 0.4;
    into(o, [0.3, 0.75, 0.9], o.glow * 0.8);
    o.shine = 0.5 - riser * 0.2;
  },
  wood(n, x, y, z, h, sl, o) {
    if (h < 0) {
      mix3(o, [0.2, 0.32, 0.24], [0.04, 0.13, 0.13], smoothstep(0, 22, -h));
      o.liq = 1; o.shine = 0.9; return;
    }
    const v = n.s(x * 26, y * 26, z * 26) * 0.5 + 0.5;
    mix3(o, [0.27, 0.33, 0.17], [0.15, 0.21, 0.11], smoothstep(0.3, 0.7, v));
    into(o, [0.4, 0.36, 0.17], smoothstep(0.72, 0.9, n.s(x * 11 + 9, y * 11, z * 11) * 0.5 + 0.5) * 0.6);
    into(o, [0.3, 0.25, 0.17], 1 - smoothstep(2, 10, h));
    into(o, [0.36, 0.35, 0.3], smoothstep(0.16, 0.3, sl) * 0.5);
    into(o, [0.52, 0.53, 0.47], smoothstep(900, 1300, h));
    o.shine = 0.05;
  },
  earth(n, x, y, z, h, sl, o) {
    const s = h / 38 + n.s(x * 8, y * 8, z * 8) * 1.6;
    mix3(o, [0.63, 0.38, 0.24], [0.76, 0.58, 0.4], 0.5 + 0.5 * Math.sin(s));
    into(o, [0.45, 0.25, 0.17], (0.5 + 0.5 * Math.sin(s * 2.7 + 1.3)) * 0.35);
    into(o, [0.8, 0.66, 0.47], (1 - smoothstep(0.02, 0.08, sl)) * 0.9);
    into(o, [0.5, 0.47, 0.3], smoothstep(0.62, 0.85, n.s(x * 19, y * 19 + 4, z * 19) * 0.5 + 0.5) * (1 - smoothstep(0.02, 0.1, sl)) * 0.45);
    into(o, [0.95, 0.95, 0.97], smoothstep(1500, 1900, h) * (1 - smoothstep(0.2, 0.34, sl)));
    o.shine = 0.04;
  },
  magic(n, x, y, z, h, sl, o, mf) {
    if (h < 0) {
      mix3(o, [0.42, 0.24, 0.72], [0.16, 0.08, 0.5], smoothstep(0, 60, -h));
      o.liq = 1; o.glow = 0.5; o.shine = 0.85; return;
    }
    const v = n.s(x * 30, y * 30, z * 30) * 0.5 + 0.5;
    mix3(o, [0.2, 0.15, 0.26], [0.13, 0.14, 0.24], v);
    const cr = smoothstep(0.16, 0.32, sl);
    into(o, [0.34, 0.6, 0.7], cr * 0.5);
    const vein = 1 - smoothstep(0.0, 0.022, Math.abs(n.fbm(x, y, z, 38, 3, mf)));
    const tip = smoothstep(1100, 1900, h);
    into(o, [0.6, 0.4, 0.7], Math.max(vein, tip * 0.5) * 0.6);
    o.glow = Math.max(vein * 0.8, cr * 0.1, tip * 0.3);
    o.shine = 0.25 + cr * 0.5;
  },
};

// Surface appearance for a point: colour (sRGB), liquid flag, emissive glow and
// specular shine. `slope` is 1 - dot(normal, up).
export function shade(def, x, y, z, raw, slope, out, mf = Infinity) {
  out.liq = 0; out.glow = 0; out.shine = 0;
  const k = def.radius / REF_RADIUS;
  SHADE[def.element](def.noise, x * k, y * k, z * k, raw, slope, out, mf / k);
  return out;
}

// ---------------------------------------------------------------- layout

function tangentBasis(x, y, z) {
  // Any unit vector perpendicular to (x,y,z), plus the third axis.
  let ax = 0, ay = 1, az = 0;
  if (Math.abs(y) > 0.9) { ax = 1; ay = 0; }
  let tx = ay * z - az * y, ty = az * x - ax * z, tz = ax * y - ay * x;
  const l = Math.hypot(tx, ty, tz); tx /= l; ty /= l; tz /= l;
  const bx = y * tz - z * ty, by = z * tx - x * tz, bz = x * ty - y * tx;
  return [tx, ty, tz, bx, by, bz];
}

// Step `east`/`north` metres across the surface from a unit direction.
export function offsetDir(def, d, east, north) {
  const [tx, ty, tz, bx, by, bz] = tangentBasis(d[0], d[1], d[2]);
  const e = east / def.radius, n = north / def.radius;
  const x = d[0] + tx * e + bx * n, y = d[1] + ty * e + by * n, z = d[2] + tz * e + bz * n;
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
}

function chooseGateSite(def) {
  const rnd = mulberry32(def.seed * 7 + 3);
  const s = def.sunDir;
  const [tx, ty, tz, bx, by, bz] = tangentBasis(s[0], s[1], s[2]);
  let best = null;
  for (let k = 0; k < 600; k++) {
    // Day side, 30-60 degrees off the sub-solar point: always lit, sun at a flattering angle.
    const th = ((30 + rnd() * 30) * Math.PI) / 180, az = rnd() * Math.PI * 2;
    const ct = Math.cos(th), st = Math.sin(th), ca = Math.cos(az), sa = Math.sin(az);
    const d = [s[0] * ct + (tx * ca + bx * sa) * st, s[1] * ct + (ty * ca + by * sa) * st, s[2] * ct + (tz * ca + bz * sa) * st];
    const h = terrainRaw(def, d[0], d[1], d[2], Infinity, false);
    if (def.liquid && h < 25) continue;
    let rough = 0;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2, rr = i % 2 ? 80 : 160;
      const q = offsetDir(def, d, Math.cos(a) * rr, Math.sin(a) * rr);
      const hq = terrainRaw(def, q[0], q[1], q[2], Infinity, false);
      rough = Math.max(rough, Math.abs(hq - h));
      if (def.liquid && hq < 4) rough += 200;
    }
    const score = rough + Math.max(0, h - 110) * 0.15;
    if (!best || score < best.score) best = { d, h, score };
    if (score < 16) break;
  }
  const g = best || { d: s, h: 60 };
  return { x: g.d[0], y: g.d[1], z: g.d[2], h: Math.max(g.h, def.liquid ? 30 : -1e9), r0: 62, r1: 175 };
}

for (const def of PLANETS) {
  const a = (def.angle * Math.PI) / 180;
  def.pos = [Math.cos(a) * def.orbit, def.lift * def.orbit, Math.sin(a) * def.orbit];
  const l = Math.hypot(def.pos[0], def.pos[1], def.pos[2]);
  def.sunDir = [-def.pos[0] / l, -def.pos[1] / l, -def.pos[2] / l];
  def.noise = new Noise(def.seed);
  def.gate = null;
  def.gate = chooseGateSite(def);
}
