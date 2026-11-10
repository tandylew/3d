// Scenery scattered around the player: each world's signature flora/formations,
// placed deterministically from a hash of the ground cell so it is always the
// same wherever you return, yet nothing is stored.
import * as THREE from 'three';
import { Builder, propMaterial } from './gfx.js';
import { hash3, smoothstep } from './noise.js';
import { terrainRaw } from './worlds.js';

const CELL = 27, SPAN = 10, RANGE = CELL * SPAN;
const TAU = Math.PI * 2;

const MAKERS = {
  water: {
    shine: 0.15,
    big() {
      const b = new Builder();
      b.spike(0.42, 10.5, 6, [0.46, 0.36, 0.25], 0, 0, 0, 0, 0, 0.1);
      for (let i = 0; i < 9; i++) b.spike(0.75, 5.5 + (i % 3) * 0.6, 4, i % 2 ? [0.16, 0.5, 0.22] : [0.22, 0.6, 0.26], 0, -1.0, 10.2, 0, (i / 9) * TAU, 1.35 + (i % 3) * 0.28);
      return b.build();
    },
    small() {
      const b = new Builder();
      b.add(new THREE.IcosahedronGeometry(0.7, 0), [0.6, 0.6, 0.58], 0, 0, 0.2, 0, 1.2, 0.7, 1);
      for (let i = 0; i < 6; i++) b.spike(0.1, 1.6 + (i % 3) * 0.5, 4, [0.2, 0.85, 0.75], 0.25, Math.cos(i * 1.1) * 0.5, 0, Math.sin(i * 1.1) * 0.5, i * 1.3, 0.25);
      return b.build();
    },
  },
  fire: {
    shine: 0.5,
    big() {
      const b = new Builder();
      const hs = [15, 10, 7, 12, 5];
      hs.forEach((h, i) => {
        const a = i * 1.26, r = i ? 2.3 : 0;
        b.column(new THREE.CylinderGeometry(1.5, 1.7, h, 6), h, [0.1, 0.09, 0.09], 0, Math.cos(a) * r, 0, Math.sin(a) * r, i);
        b.column(new THREE.CylinderGeometry(1.1, 1.5, 0.5, 6), 0.5, [1.0, 0.4, 0.08], 0.5, Math.cos(a) * r, h, Math.sin(a) * r, i);
      });
      return b.build();
    },
    small() {
      const b = new Builder();
      b.add(new THREE.IcosahedronGeometry(1, 0), [0.12, 0.1, 0.1], 0, 0, 0.4, 0, 1.4, 0.8, 1.1);
      b.spike(0.25, 1.4, 4, [1.0, 0.45, 0.1], 0.7, 0.3, 0.6, 0.2, 0.5, 0.5);
      b.spike(0.18, 1.0, 4, [1.0, 0.3, 0.05], 0.7, -0.4, 0.5, -0.2, 2.5, 0.7);
      return b.build();
    },
  },
  metal: {
    shine: 0.9,
    big() {
      const b = new Builder();
      b.column(new THREE.BoxGeometry(2.4, 14, 2.4), 14, [0.5, 0.54, 0.6], 0, 0, 0, 0, 0.4);
      b.column(new THREE.BoxGeometry(3.4, 1, 3.4), 1, [0.2, 0.21, 0.25], 0, 0, 14, 0, 0.4);
      b.column(new THREE.BoxGeometry(0.3, 12.5, 2.5), 12.5, [0.2, 0.85, 1.0], 0.8, 0, 0.6, 0, 0.4);
      b.add(new THREE.OctahedronGeometry(1.3, 0), [0.2, 0.85, 1.0], 0.9, 0, 17, 0);
      b.column(new THREE.BoxGeometry(1.6, 5, 1.6), 5, [0.72, 0.42, 0.2], 0, 2.6, 0, 1.2, 1.1);
      return b.build();
    },
    small() {
      const b = new Builder();
      b.column(new THREE.BoxGeometry(1.4, 1.4, 1.4), 1.4, [0.6, 0.63, 0.68], 0, 0, 0, 0, 0.3);
      b.column(new THREE.BoxGeometry(0.9, 0.9, 0.9), 0.9, [0.75, 0.45, 0.22], 0, 0.2, 1.4, 0.1, 0.9);
      b.column(new THREE.BoxGeometry(0.5, 0.5, 0.5), 0.5, [0.2, 0.85, 1.0], 0.8, 0.9, 0, 0.8, 0.5);
      return b.build();
    },
  },
  wood: {
    shine: 0.05,
    big() {
      const b = new Builder();
      b.column(new THREE.CylinderGeometry(0.55, 1.0, 11, 7), 11, [0.33, 0.23, 0.14], 0, 0, 0, 0);
      b.add(new THREE.IcosahedronGeometry(4.6, 1), [0.13, 0.4, 0.1], 0, 0, 11.5, 0, 1, 0.8, 1);
      b.add(new THREE.IcosahedronGeometry(3.5, 1), [0.2, 0.52, 0.14], 0, 0.8, 15, 0.5, 1, 0.85, 1);
      b.add(new THREE.IcosahedronGeometry(3.0, 1), [0.1, 0.33, 0.1], 0, 3, 9.5, 1.2);
      b.add(new THREE.IcosahedronGeometry(2.6, 1), [0.17, 0.46, 0.12], 0, -2.8, 10, -1.5);
      return b.build();
    },
    small() {
      const b = new Builder();
      for (let i = 0; i < 7; i++) b.spike(0.32, 1.7, 4, i % 2 ? [0.2, 0.55, 0.14] : [0.12, 0.42, 0.1], 0, 0, 0, 0, (i / 7) * TAU, 0.95);
      b.add(new THREE.IcosahedronGeometry(0.22, 0), [1.0, 0.6, 0.85], 0.5, 0, 1.0, 0);
      return b.build();
    },
  },
  earth: {
    shine: 0.05,
    big() {
      const b = new Builder();
      b.add(new THREE.DodecahedronGeometry(2.8, 0), [0.75, 0.42, 0.22], 0, 0, 1.6, 0, 1, 0.75, 1);
      b.add(new THREE.DodecahedronGeometry(2.1, 0), [0.88, 0.62, 0.38], 0, 0.2, 4.6, 0, 1, 0.8, 1, 0, 1, 0);
      b.add(new THREE.DodecahedronGeometry(1.7, 0), [0.6, 0.3, 0.18], 0, -0.1, 7.2, 0.1, 1, 0.9, 1, 0, 2, 0);
      b.add(new THREE.DodecahedronGeometry(2.5, 0), [0.8, 0.5, 0.3], 0, 0, 9.4, 0, 1, 0.42, 1, 0, 0.6, 0);
      return b.build();
    },
    small() {
      const b = new Builder();
      b.add(new THREE.DodecahedronGeometry(1.1, 0), [0.7, 0.45, 0.28], 0, 0, 0.5, 0, 1.3, 0.8, 1);
      b.add(new THREE.DodecahedronGeometry(0.5, 0), [0.85, 0.6, 0.38], 0, 1.3, 0.25, 0.4);
      return b.build();
    },
  },
  magic: {
    shine: 0.9,
    big() {
      const b = new Builder();
      const cs = [[0.35, 0.85, 1.0], [0.85, 0.4, 1.0], [0.55, 0.5, 1.0]];
      b.spike(1.5, 15, 6, cs[0], 0.3, 0, -1, 0, 0, 0.05);
      for (let i = 0; i < 6; i++) b.spike(0.8 + (i % 2) * 0.4, 6 + (i % 3) * 2.5, 6, cs[i % 3], 0.3, Math.cos(i) * 1.2, -0.5, Math.sin(i) * 1.2, i * 1.05, 0.45 + (i % 3) * 0.15);
      return b.build();
    },
    small() {
      const b = new Builder();
      b.add(new THREE.OctahedronGeometry(0.55, 0), [0.9, 0.5, 1.0], 0.7, 0, 1.9, 0, 1, 1.7, 1);
      b.spike(0.3, 0.9, 5, [0.3, 0.8, 1.0], 0.3, 0, 0, 0, 0, 0.2);
      b.spike(0.2, 0.6, 5, [0.3, 0.8, 1.0], 0.3, 0.4, 0, 0.1, 2, 0.5);
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
  }

  setFor(element) {
    if (!this.sets[element]) {
      const mk = MAKERS[element], mat = propMaterial(mk.shine);
      const big = new THREE.InstancedMesh(mk.big(), mat, BIG), small = new THREE.InstancedMesh(mk.small(), mat, SMALL);
      big.frustumCulled = small.frustumCulled = false;
      this.sets[element] = { big, small };
    }
    return this.sets[element];
  }

  // `local` is the player position in planet coordinates.
  update(planet, local, alt) {
    if (alt > 900) { this.group.visible = false; return; }
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
