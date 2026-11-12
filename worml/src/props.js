// Scenery scattered around the player: each world's signature flora/formations,
// placed deterministically from a hash of the ground cell so it is always the
// same wherever you return, yet nothing is stored.
import * as THREE from 'three';
import { Builder, propMaterial } from './gfx.js';
import { hash3, smoothstep } from './noise.js';
import { terrainRaw } from './worlds.js';

const CELL = 27, SPAN = 10, RANGE = CELL * SPAN;
const TAU = Math.PI * 2;

const hex = (r0, r1, h) => new THREE.CylinderGeometry(r0, r1, h, 6);

// Each world gets a large and a small scenery model. They are built once from
// noise-shaped lumps, tapered limbs and leaf strips, then instanced.
const MAKERS = {
  // Thalassa: leaning palms, wave-worn rocks and dune grass
  water: {
    shine: 0.1,
    big() {
      const b = new Builder();
      b.limb([[0, -0.4, 0], [0.25, 2.6, 0.05], [0.8, 5.6, 0.1], [1.7, 8.4, 0.1], [2.4, 10.2, 0]], 0.42, 0.2, 7, [0.4, 0.34, 0.27]);
      b.blob(0.42, [0.3, 0.26, 0.16], 0, 2.4, 10.2, 0, { detail: 1, rough: 0.2 });
      for (let i = 0; i < 11; i++) {
        const yaw = (i / 11) * TAU + (i % 3) * 0.2, c = i % 2 ? [0.2, 0.36, 0.13] : [0.27, 0.42, 0.16];
        b.frond(2.4, 10.25, 0, yaw, 4.2 + (i % 4) * 0.5, 0.52, 2.2 - (i % 3) * 0.8, 4.6 + (i % 2) * 1.2, c, 6);
      }
      for (let i = 0; i < 3; i++) b.blob(0.2, [0.3, 0.22, 0.12], 0, 2.4 + Math.cos(i * 2.1) * 0.35, 9.85, Math.sin(i * 2.1) * 0.35, { detail: 1, rough: 0.1 });
      return b.build();
    },
    small() {
      const b = new Builder();
      b.blob(0.85, [0.47, 0.45, 0.42], 0, 0, 0.18, 0, { detail: 2, rough: 0.5, sy: 0.62, seed: 3, color2: [0.32, 0.33, 0.3] });
      b.blob(0.4, [0.5, 0.47, 0.43], 0, 0.95, 0.05, 0.4, { detail: 1, rough: 0.5, sy: 0.6, seed: 5 });
      for (let i = 0; i < 12; i++) {
        const a = i * 2.4, r = 0.7 + (i % 4) * 0.25;
        b.frond(Math.cos(a) * r - 0.6, 0, Math.sin(a) * r + 0.9, a * 1.7, 0.7 + (i % 3) * 0.3, 0.045, 1.3, 0.75, i % 2 ? [0.42, 0.47, 0.22] : [0.5, 0.5, 0.27], 3);
      }
      return b.build();
    },
  },
  // Pyra: columnar basalt and clinker
  fire: {
    shine: 0.3,
    big() {
      const b = new Builder();
      const hs = [13, 9.5, 6.5, 11, 4.5, 7.5, 3];
      hs.forEach((h, i) => {
        const a = i * 1.047, r = i ? 2.75 : 0, tone = 0.1 + (i % 3) * 0.025;
        b.column(hex(1.56, 1.6, h), h, [tone, tone * 0.95, tone * 0.93], 0, Math.cos(a) * r, -1, Math.sin(a) * r, 0.52, true);
        b.column(hex(1.2, 1.56, 0.35), 0.35, [tone * 0.8, tone * 0.75, tone * 0.72], 0, Math.cos(a) * r, h - 1, Math.sin(a) * r, 0.52, true);
      });
      b.blob(2.4, [0.13, 0.11, 0.1], 0, 3.2, 0.3, 2.6, { detail: 2, rough: 0.6, sy: 0.5, seed: 8, ridged: true });
      b.blob(1.5, [0.12, 0.1, 0.1], 0, -3.4, 0.2, -1.8, { detail: 1, rough: 0.6, sy: 0.6, seed: 2, ridged: true });
      return b.build();
    },
    small() {
      const b = new Builder();
      b.blob(1.2, [0.13, 0.11, 0.105], 0, 0, 0.3, 0, { detail: 2, rough: 0.75, sy: 0.6, seed: 11, ridged: true, color2: [0.2, 0.13, 0.1] });
      b.blob(0.55, [0.11, 0.1, 0.1], 0, 1.3, 0.1, 0.5, { detail: 1, rough: 0.7, sy: 0.7, seed: 4, ridged: true });
      b.blob(0.28, [1.0, 0.36, 0.06], 0.55, 0.1, 0.12, -0.75, { detail: 1, rough: 0.5, sy: 0.35, seed: 6 });
      return b.build();
    },
  },
  // Ferrum: pyrite-like cubic crystals growing out of dark ore
  metal: {
    shine: 0.85, grain: 0.45,
    big() {
      const b = new Builder();
      b.blob(3.1, [0.2, 0.2, 0.23], 0, 0, 0.5, 0, { detail: 2, rough: 0.5, sy: 0.55, seed: 21, color2: [0.36, 0.24, 0.17] });
      const cubes = [[0, 2.6, 0, 3.6, 0.4, 0.2, 0.3], [2.0, 1.6, 0.8, 2.2, 0.9, 0.5, 0.1], [-1.9, 1.5, -0.6, 2.0, 0.2, 1.1, 0.6],
        [0.6, 4.6, -0.5, 1.7, 0.7, 0.3, 0.9], [-0.7, 1.2, 2.0, 1.5, 0.3, 0.8, 0.2], [1.3, 3.6, 1.6, 1.1, 1.0, 0.2, 0.5]];
      cubes.forEach(([x, y, z, sz, rx, ry, rz], i) => {
        const c = i % 2 ? [0.62, 0.58, 0.46] : [0.5, 0.51, 0.54];
        b.add(new THREE.BoxGeometry(sz, sz, sz), c, 0, x, y, z, 1, 1, 1, rx, ry, rz);
      });
      return b.build();
    },
    small() {
      const b = new Builder();
      b.blob(0.8, [0.24, 0.24, 0.27], 0, 0, 0.22, 0, { detail: 1, rough: 0.5, sy: 0.6, seed: 23, color2: [0.4, 0.26, 0.18] });
      b.add(new THREE.BoxGeometry(0.75, 0.75, 0.75), [0.6, 0.57, 0.46], 0, 0.15, 0.75, 0.05, 1, 1, 1, 0.5, 0.4, 0.2);
      b.add(new THREE.BoxGeometry(0.45, 0.45, 0.45), [0.5, 0.51, 0.55], 0, -0.5, 0.45, 0.3, 1, 1, 1, 0.2, 1.0, 0.6);
      b.add(new THREE.BoxGeometry(0.3, 0.3, 0.3), [0.62, 0.6, 0.5], 0, 0.6, 0.35, -0.4, 1, 1, 1, 0.9, 0.3, 0.1);
      return b.build();
    },
  },
  // Sylva: broadleaf trees and ferns
  wood: {
    shine: 0.05,
    big() {
      const b = new Builder();
      const bark = [0.27, 0.22, 0.17];
      b.limb([[0, -0.6, 0], [0.1, 2.5, 0.05], [-0.15, 5.5, 0.1], [0.2, 8.6, 0]], 0.75, 0.36, 8, bark);
      for (let i = 0; i < 5; i++) { const a = i * 1.257; b.limb([[Math.cos(a) * 0.45, 0.5, Math.sin(a) * 0.45], [Math.cos(a) * 1.0, -0.1, Math.sin(a) * 1.0], [Math.cos(a) * 1.7, -0.5, Math.sin(a) * 1.7]], 0.26, 0.08, 5, bark); }
      b.limb([[0, 6.2, 0.05], [1.8, 8.0, 0.5], [3.2, 9.4, 0.9]], 0.26, 0.1, 5, bark);
      b.limb([[-0.1, 5.2, 0], [-1.7, 7.2, -0.9], [-2.9, 8.8, -1.6]], 0.24, 0.1, 5, bark);
      b.limb([[0.1, 7.0, 0], [0.3, 8.6, -1.6], [0.4, 10.2, -2.6]], 0.2, 0.08, 5, bark);
      const leafA = [0.29, 0.38, 0.17], leafB = [0.4, 0.47, 0.22];
      const crowns = [[0.2, 11.3, 0, 3.8, 3], [3.3, 10.2, 1.0, 2.8, 2], [-3.0, 9.6, -1.7, 2.7, 2], [0.5, 10.8, -2.9, 2.6, 2], [-0.6, 13.2, 0.9, 2.6, 2], [1.3, 9.6, 2.7, 2.2, 2]];
      crowns.forEach(([x, y, z, r, detail], i) => b.blob(r, leafA, -1, x, y, z, { detail, rough: 0.34, freq: 1.25, sy: 0.8, seed: 30 + i * 3, under: 0.4, color2: leafB }));
      return b.build();
    },
    small() {
      const b = new Builder();
      for (let i = 0; i < 11; i++) {
        const yaw = (i / 11) * TAU + (i % 2) * 0.25;
        b.frond(0, 0.05, 0, yaw, 1.3 + (i % 3) * 0.35, 0.22, 1.5 - (i % 3) * 0.35, 1.5, i % 2 ? [0.17, 0.31, 0.1] : [0.24, 0.38, 0.13], 5);
      }
      b.blob(0.42, [0.34, 0.33, 0.3], 0, 1.1, 0.08, 0.7, { detail: 1, rough: 0.5, sy: 0.6, seed: 40, color2: [0.24, 0.3, 0.17] });
      return b.build();
    },
  },
  // Petra: wind-carved sandstone hoodoos and boulders
  earth: {
    shine: 0.04,
    big() {
      const b = new Builder();
      const a = [0.62, 0.39, 0.25], c = [0.76, 0.58, 0.4], d = [0.5, 0.29, 0.2];
      b.blob(2.7, a, 0, 0, 1.0, 0, { detail: 2, rough: 0.35, sy: 0.75, seed: 51, color2: c });
      b.blob(2.0, d, 0, 0.15, 3.6, 0.1, { detail: 2, rough: 0.35, sy: 0.9, seed: 53, color2: a });
      b.blob(1.55, a, 0, -0.1, 6.0, 0.05, { detail: 2, rough: 0.3, sy: 1.0, seed: 55, color2: c });
      b.blob(2.4, c, 0, 0.1, 8.2, 0, { detail: 2, rough: 0.35, sy: 0.5, seed: 57, color2: d });
      b.blob(1.3, a, 0, 2.9, 0.4, 1.4, { detail: 1, rough: 0.5, sy: 0.7, seed: 59, color2: c });
      return b.build();
    },
    small() {
      const b = new Builder();
      b.blob(1.0, [0.62, 0.41, 0.27], 0, 0, 0.35, 0, { detail: 2, rough: 0.5, sy: 0.7, seed: 61, color2: [0.74, 0.56, 0.39] });
      b.blob(0.45, [0.68, 0.48, 0.33], 0, 1.25, 0.12, 0.45, { detail: 1, rough: 0.5, sy: 0.7, seed: 63 });
      for (let i = 0; i < 7; i++) b.frond(-1.0, 0, -0.5, i * 0.9, 0.5 + (i % 3) * 0.18, 0.03, 0.8, 0.3, [0.5, 0.46, 0.27], 3);
      return b.build();
    },
  },
  // Arcana: amethyst-like crystal clusters on dark stone
  magic: {
    shine: 0.9, grain: 0.3,
    big() {
      const b = new Builder();
      b.blob(2.6, [0.2, 0.15, 0.27], 0, 0, 0.3, 0, { detail: 2, rough: 0.5, sy: 0.5, seed: 71, color2: [0.13, 0.14, 0.24] });
      const cs = [[0.46, 0.3, 0.62], [0.36, 0.34, 0.66], [0.56, 0.38, 0.68]];
      const xt = [[0, 0, 12, 1.25, 0, 0.05], [1.3, 0.6, 7.5, 0.85, 0.4, 0.42], [-1.2, 0.4, 6.5, 0.8, 2.6, 0.38], [0.3, -1.3, 5.5, 0.7, 4.4, 0.5],
        [-0.5, 1.4, 4.6, 0.6, 1.5, 0.55], [1.7, -0.9, 3.6, 0.5, 5.6, 0.7], [-1.8, -0.8, 3.2, 0.5, 3.5, 0.75]];
      xt.forEach(([x, z, h, r, yaw, tilt], i) => {
        const g = hex(r, r * 1.05, h).translate(0, h / 2, 0), tip = new THREE.ConeGeometry(r, r * 1.9, 6).translate(0, h + r * 0.95, 0);
        b.add(g, cs[i % 3], 0.07, x, 0.1, z, 1, 1, 1, 0, yaw, tilt, true);
        b.add(tip, cs[(i + 1) % 3], 0.16, x, 0.1, z, 1, 1, 1, 0, yaw, tilt, true);
      });
      return b.build();
    },
    small() {
      const b = new Builder();
      b.blob(0.7, [0.2, 0.15, 0.27], 0, 0, 0.15, 0, { detail: 1, rough: 0.5, sy: 0.55, seed: 75 });
      [[0, 0, 1.6, 0.2, 0, 0.1], [0.3, 0.2, 1.0, 0.15, 1, 0.5], [-0.3, -0.1, 0.8, 0.13, 3, 0.6], [0.1, -0.35, 0.6, 0.11, 5, 0.7]].forEach(([x, z, h, r, yaw, tilt], i) => {
        b.add(hex(r, r, h).translate(0, h / 2, 0), [0.5, 0.36, 0.68], 0.1, x, 0.1, z, 1, 1, 1, 0, yaw, tilt, true);
        b.add(new THREE.ConeGeometry(r, r * 1.9, 6).translate(0, h + r * 0.95, 0), [0.56, 0.42, 0.72], 0.2, x, 0.1, z, 1, 1, 1, 0, yaw, tilt, true);
        void i;
      });
      return b.build();
    },
  },
};

const BIG = 200, SMALL = 320;
const m4 = new THREE.Matrix4(), qv = new THREE.Quaternion(), qy = new THREE.Quaternion();
const pv = new THREE.Vector3(), sv = new THREE.Vector3(), dv = new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0), surf = new THREE.Vector3();

export class Props {
  constructor() {
    this.sets = {};
    this.group = new THREE.Group();
    this.anchor = new THREE.Vector3();
    this.planet = null;
    this.count = 0;
    this.enabled = true;
  }

  setFor(element) {
    if (!this.sets[element]) {
      const mk = MAKERS[element], mat = propMaterial(mk.shine, { grain: mk.grain, material: { side: THREE.DoubleSide } });
      const big = new THREE.InstancedMesh(mk.big(), mat, BIG), small = new THREE.InstancedMesh(mk.small(), mat, SMALL);
      big.frustumCulled = small.frustumCulled = false;
      this.sets[element] = { big, small };
    }
    return this.sets[element];
  }

  // `local` is the player position in planet coordinates.
  update(planet, local, alt) {
    if (alt > 900 || !this.enabled) { this.group.visible = false; return; }
    this.group.visible = true;
    // Work on the base sphere so the cell set doesn't change with altitude.
    local = surf.copy(local).setLength(planet.def.radius);
    if (this.planet === planet && local.distanceTo(this.anchor) < 34) return;
    if (this.planet !== planet) {
      this.group.removeFromParent();
      this.group.clear();
      const s = this.setFor(planet.def.element);
      this.group.add(s.big, s.small);
      planet.group.add(this.group);
      this.planet = planet;
    }
    this.rebuild(planet, local);
  }

  rebuild(planet, local) {
    const def = planet.def, R = def.radius, g = def.gate;
    const { big, small } = this.sets[def.element];
    this.anchor.copy(local);
    this.group.position.copy(local);
    const up = dv.copy(local).normalize();
    const t1 = new THREE.Vector3().crossVectors(up, Math.abs(up.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : Y).normalize();
    const t2 = new THREE.Vector3().crossVectors(up, t1);
    const seen = new Set();
    let nb = 0, ns = 0;
    for (let i = -SPAN; i <= SPAN; i++) {
      for (let j = -SPAN; j <= SPAN; j++) {
        pv.copy(local).addScaledVector(t1, i * CELL).addScaledVector(t2, j * CELL);
        const cx = Math.floor(pv.x / CELL), cy = Math.floor(pv.y / CELL), cz = Math.floor(pv.z / CELL);
        const key = cx + ',' + cy + ',' + cz;
        if (seen.has(key)) continue;
        seen.add(key);
        const h0 = hash3(cx, cy, cz, def.seed);
        if (h0 > 0.62) continue;
        const isBig = h0 < 0.2;
        if (isBig ? nb >= BIG : ns >= SMALL) continue;
        pv.set((cx + hash3(cx, cy, cz, 1)) * CELL, (cy + hash3(cx, cy, cz, 2)) * CELL, (cz + hash3(cx, cy, cz, 3)) * CELL).normalize();
        const raw = terrainRaw(def, pv.x, pv.y, pv.z);
        if (def.liquid && raw < 1.5) continue;
        const gd = Math.hypot(pv.x - g.x, pv.y - g.y, pv.z - g.z) * R;
        if (gd < 48) continue;
        let clear = true;
        for (const q of def.sites) if (Math.hypot(pv.x - q.x, pv.y - q.y, pv.z - q.z) * R < q.r0 * 0.9) { clear = false; break; }
        if (!clear) continue;
        sv.copy(pv).addScaledVector(t1, 4 / R).normalize();
        if (Math.abs(terrainRaw(def, sv.x, sv.y, sv.z) - raw) > (isBig ? 2.6 : 4)) continue;
        qv.setFromUnitVectors(Y, pv).multiply(qy.setFromAxisAngle(Y, hash3(cx, cy, cz, 4) * 6.283));
        sv.copy(pv);
        const d = sv.multiplyScalar(R).distanceTo(local); // distance along the ground, ignoring height
        pv.multiplyScalar(R + raw - 0.15);
        const fade = smoothstep(RANGE, RANGE * 0.7, d);
        if (fade <= 0.01) continue;
        const hs = hash3(cx, cy, cz, 5);
        const sc = (isBig ? 0.8 + hs * hs * 1.6 : 0.6 + hs * 1.1) * fade;
        m4.compose(pv.sub(local), qv, sv.set(sc, sc * (0.85 + hash3(cx, cy, cz, 6) * 0.4), sc));
        if (isBig) big.setMatrixAt(nb++, m4); else small.setMatrixAt(ns++, m4);
      }
    }
    big.count = nb; small.count = ns;
    big.instanceMatrix.needsUpdate = true; small.instanceMatrix.needsUpdate = true;
    this.count = nb + ns;
  }
}

// The broadleaf tree, for time effects that grow one on demand.
export function treeGeometry() { return MAKERS.wood.big(); }
