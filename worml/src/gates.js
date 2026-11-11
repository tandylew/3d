// Wormhole gates: one per world. Each (except home) starts locked by an
// elemental affliction that only the complementary element can undo.
import * as THREE from 'three';
import { ELEMENTS } from './worlds.js';
import { Builder, propMaterial, glowMaterial, additive, ENV } from './gfx.js';
import { uvVS, portalFS, beaconFS } from './shaders.js';
import { mulberry32, smoothstep } from './noise.js';

export const RING_Y = 10.6, RING_R = 9.5;
const LOCK_COLOR = { fire: [1.0, 0.4, 0.08], metal: [0.6, 0.72, 0.85], wood: [0.45, 0.75, 0.2], earth: [0.85, 0.62, 0.35], magic: [0.5, 0.2, 0.95], water: [0.3, 0.7, 1] };
const PARTICLES = 72;
const m4 = new THREE.Matrix4(), pv = new THREE.Vector3(), sv = new THREE.Vector3(), qv = new THREE.Quaternion();

function structure(color) {
  const b = new Builder();
  const stone = [0.2, 0.2, 0.24], dark = [0.1, 0.1, 0.13];
  b.column(new THREE.CylinderGeometry(15, 17.5, 1.6, 28), 1.6, stone, 0, 0, -1.55, 0);
  b.column(new THREE.CylinderGeometry(11.5, 12, 0.25, 28), 0.25, dark, 0, 0, 0.0, 0);
  b.add(new THREE.TorusGeometry(RING_R, 1.15, 10, 56), stone, 0, 0, RING_Y, 0);
  b.add(new THREE.TorusGeometry(RING_R, 0.22, 6, 56), color, 0.9, 0, RING_Y, 1.05);
  b.add(new THREE.TorusGeometry(RING_R, 0.22, 6, 56), color, 0.9, 0, RING_Y, -1.05);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    b.add(new THREE.BoxGeometry(1.0, 2.2, 2.9), i % 2 ? dark : stone, 0, Math.cos(a) * RING_R, RING_Y + Math.sin(a) * RING_R, 0, 1, 1, 1, 0, 0, a + Math.PI / 2);
    b.add(new THREE.BoxGeometry(0.5, 0.5, 3.0), color, 0.9, Math.cos(a) * (RING_R + 0.9), RING_Y + Math.sin(a) * (RING_R + 0.9), 0, 1, 1, 1, 0, 0, a);
  }
  for (const sx of [-1, 1]) {
    b.column(new THREE.BoxGeometry(2.2, 7, 3.6), 7, stone, 0, sx * 11.6, 0, 0);
    b.add(new THREE.OctahedronGeometry(1.0, 0), color, 0.9, sx * 11.6, 8.6, 0, 1, 1.5, 1);
  }
  return b.build();
}

function affliction(element, seed) {
  const b = new Builder(), rnd = mulberry32(seed);
  if (element === 'fire') {
    for (let i = 0; i < 16; i++) {
      const a = rnd() * 6.28, r = 3 + rnd() * 9;
      b.blob(0.8 + rnd() * 1.3, [0.13, 0.11, 0.1], 0, Math.cos(a) * r, 0.5, (rnd() - 0.5) * 6, { detail: 1, rough: 0.7, sy: 0.7, seed: i, ridged: true });
      b.spike(0.3, 1.5 + rnd(), 4, [1.0, 0.4, 0.08], 0.8, Math.cos(a) * r, 0.6, (rnd() - 0.5) * 6, rnd() * 6, 0.3);
    }
  } else if (element === 'metal') {
    b.add(new THREE.CylinderGeometry(9.9, 9.9, 2.0, 6), [0.5, 0.53, 0.58], 0, 0, RING_Y, 0, 1, 1, 1, Math.PI / 2, 0, 0);
    b.add(new THREE.CylinderGeometry(6.2, 6.2, 2.8, 6), [0.22, 0.23, 0.27], 0, 0, RING_Y, 0, 1, 1, 1, Math.PI / 2, 0.52, 0);
    b.add(new THREE.CylinderGeometry(2.4, 2.4, 3.6, 6), [0.75, 0.45, 0.22], 0, 0, RING_Y, 0, 1, 1, 1, Math.PI / 2, 0, 0);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.52;
      b.add(new THREE.CylinderGeometry(0.7, 0.7, 2.8, 8), [0.7, 0.72, 0.76], 0, Math.cos(a) * 8, RING_Y + Math.sin(a) * 8, 0, 1, 1, 1, Math.PI / 2, 0, 0);
    }
  } else if (element === 'wood') {
    for (let k = 0; k < 7; k++) {
      const pts = [], a0 = rnd() * 6.28, turns = 1.2 + rnd() * 1.4, zs = rnd() - 0.5;
      for (let i = 0; i <= 14; i++) {
        const t = i / 14, a = a0 + t * turns * 6.28, r = RING_R * (0.25 + 0.8 * Math.abs(Math.cos(t * 3.1 + k)));
        pts.push(new THREE.Vector3(Math.cos(a) * r, RING_Y + Math.sin(a) * r, Math.sin(t * 9 + k) * 1.6 + zs));
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      b.add(new THREE.TubeGeometry(curve, 56, 0.4 + rnd() * 0.25, 5), k % 2 ? [0.22, 0.26, 0.1] : [0.3, 0.2, 0.1], 0);
      for (let i = 0; i < 12; i++) {
        const p = curve.getPoint(rnd());
        b.spike(0.22, 1.5, 4, [0.6, 0.64, 0.7], 0, p.x, p.y, p.z, rnd() * 6.28, 0.6 + rnd() * 1.6);
      }
    }
  } else if (element === 'earth') {
    for (let i = 0; i < 40; i++) {
      const y = Math.pow(rnd(), 1.6) * 19, half = Math.sqrt(Math.max(4, RING_R * RING_R - (y - RING_Y) ** 2));
      const tone = rnd();
      b.blob(1.7 + rnd() * 2.2, [0.5 + tone * 0.22, 0.31 + tone * 0.22, 0.2 + tone * 0.16], 0,
        (rnd() * 2 - 1) * half, y + 0.8, (rnd() - 0.5) * 4.5, { detail: 2, rough: 0.4, sy: 0.8, seed: i, rx: rnd() * 3, ry: rnd() * 3, color2: [0.74, 0.56, 0.39] });
    }
  } else if (element === 'magic') {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      b.spike(1.0, 7.5 + (i % 2) * 1.5, 5, [0.06, 0.03, 0.12], i % 2 ? 0 : 0.25, Math.cos(a) * RING_R, RING_Y + Math.sin(a) * RING_R, 0, 0, Math.atan2(Math.cos(a), -Math.sin(a)));
    }
    b.add(new THREE.OctahedronGeometry(2.6, 0), [0.25, 0.08, 0.45], 0.5, 0, RING_Y, 0, 1, 1.5, 1);
  } else return null;
  return b.build();
}

export class Gate {
  constructor(planet, detailTex) {
    this.planet = planet;
    const def = planet.def, g = def.gate;
    this.element = def.element;
    this.color = ELEMENTS[def.element].rgb;
    this.up = new THREE.Vector3(g.x, g.y, g.z);
    this.z = planet.sunDir.clone().addScaledVector(this.up, -planet.sunDir.dot(this.up)).normalize();
    this.x = new THREE.Vector3().crossVectors(this.up, this.z);
    this.base = this.up.clone().multiplyScalar(def.radius + g.h + 0.05);      // planet-local
    this.center = this.base.clone().addScaledVector(this.up, RING_Y);
    this.group = new THREE.Group();
    this.group.position.copy(this.base);
    this.group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(this.x, this.up, this.z));
    planet.group.add(this.group);
    this.inv = new THREE.Matrix4();

    this.open = false; this.unlockT = -1; this.dest = null;
    this.mat = propMaterial(0.45);
    this.group.add(new THREE.Mesh(structure(this.color), this.mat));

    const ag = affliction(def.element, def.seed);
    this.aff = null;
    if (ag) {
      this.affMat = propMaterial(def.element === 'metal' ? 0.9 : 0.25);
      this.aff = new THREE.Mesh(ag, this.affMat);
      this.group.add(this.aff);
    }

    this.portalU = { uDetail: { value: detailTex }, uColor: { value: new THREE.Vector3(...this.color) }, uColor2: { value: new THREE.Vector3(1, 1, 1) }, uTime: ENV.uTime, uOpen: { value: 0 } };
    this.portal = new THREE.Mesh(new THREE.CircleGeometry(RING_R - 0.6, 56),
      new THREE.ShaderMaterial({ vertexShader: uvVS, fragmentShader: portalFS, uniforms: this.portalU, side: THREE.DoubleSide, transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor }));
    this.portal.position.y = RING_Y;
    this.portal.renderOrder = 5;
    this.group.add(this.portal);

    this.beaconU = { uColor: { value: new THREE.Vector3(...this.color) }, uTime: ENV.uTime, uAlpha: { value: 0.5 } };
    this.beacon = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 14, 1, true).translate(0, 0.5, 0),
      new THREE.ShaderMaterial({ vertexShader: uvVS, fragmentShader: beaconFS, uniforms: this.beaconU, side: THREE.DoubleSide, ...additive }));
    this.beacon.position.y = RING_Y * 2 + 2;
    this.beacon.frustumCulled = false;
    this.group.add(this.beacon);

    this.partMat = glowMaterial(LOCK_COLOR[def.element], 1.6, 0.55);
    this.parts = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), this.partMat, PARTICLES);
    this.parts.frustumCulled = false;
    this.group.add(this.parts);
    const rnd = mulberry32(def.seed + 5);
    this.seeds = Array.from({ length: PARTICLES }, () => [rnd(), rnd(), rnd(), rnd()]);

    this.orbMat = glowMaterial([1, 1, 1], 1.5, 1.6);
    this.orbs = Array.from({ length: 8 }, () => {
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 1), this.orbMat.clone());
      m.visible = false; m.userData = { t: 1, from: new THREE.Vector3() };
      this.group.add(m);
      return m;
    });
    this.setOpen(false, true);
  }

  setOpen(open, instant = false) {
    this.open = open;
    if (instant) {
      if (this.aff) this.aff.visible = !open;
      this.portalU.uOpen.value = open ? 1 : 0;
      this.unlockT = -1;
    } else if (open) this.unlockT = 0;
    this.partMat.uniforms.uColor.value.set(...(open ? this.color : LOCK_COLOR[this.element]));
    this.beaconU.uAlpha.value = open ? 1.0 : 0.4;
  }

  setDest(gate) {
    this.dest = gate;
    this.portalU.uColor2.value.set(...(gate ? gate.color : this.color.map((c) => c * 0.35)));
  }

  // Planet-local point -> gate-local.
  toLocal(v, out) {
    return out.copy(v).sub(this.base).applyMatrix4(this.inv);
  }

  // A spot `dist` metres in front of the portal, as a unit direction on the planet.
  frontDir(dist) {
    return this.base.clone().addScaledVector(this.z, dist).normalize();
  }

  sendOrb(fromLocal, rgb) {
    const o = this.orbs.find((m) => !m.visible) || this.orbs[0];
    o.userData.t = 0; o.userData.from.copy(fromLocal);
    o.material.uniforms.uColor.value.set(...rgb);
    o.visible = true;
  }

  flash(rgb) {
    this.mat.uniforms.uTint.value.set(...rgb);
    this.mat.uniforms.uFlash.value = 1;
  }

  update(dt, time, headLocal) {
    this.inv.makeRotationFromQuaternion(this.group.quaternion).invert();
    const dist = headLocal.distanceTo(this.center);
    // Beacon: a pillar of light that widens with distance so the gate can be found from orbit.
    const w = THREE.MathUtils.clamp(dist * 0.005, 0.7, 900);
    this.beacon.scale.set(w, 700 + dist * 0.9, w);
    this.beaconU.uAlpha.value = (this.open ? 1.0 : 0.45) * smoothstep(25, 260, dist);

    this.mat.uniforms.uFlash.value *= Math.exp(-dt * 2.5);
    if (this.unlockT >= 0) {
      this.unlockT += dt;
      const t = Math.min(1, this.unlockT / 3.4);
      if (this.aff) {
        const s = 1 - smoothstep(0.1, 0.95, t);
        this.aff.scale.set(0.3 + 0.7 * s, Math.max(s, 0.001), 0.3 + 0.7 * s);
        this.affMat.uniforms.uFlash.value = Math.sin(t * Math.PI) * 2.5;
        this.aff.visible = t < 0.95;
      }
      this.portalU.uOpen.value = smoothstep(0.55, 1, t);
      if (t >= 1) this.unlockT = -1;
    }

    const fire = this.element === 'fire' && !this.open;
    for (let i = 0; i < PARTICLES; i++) {
      const s = this.seeds[i];
      let sc;
      if (this.open) {
        const f = (s[2] + time * (0.08 + s[3] * 0.1)) % 1, a = s[0] * 6.283 + time * (0.4 + s[1]), r = (RING_R - 1) * (1 - f);
        pv.set(Math.cos(a) * r, RING_Y + Math.sin(a) * r, (s[1] - 0.5) * 1.6);
        sc = 0.1 + 0.25 * (1 - f);
      } else {
        const f = (s[1] + time * (fire ? 0.25 + s[3] * 0.3 : 0.04 + s[3] * 0.05)) % 1;
        pv.set((s[0] - 0.5) * 19 + Math.sin(time * 1.3 + i) * (fire ? 0.8 : 0.3), f * (fire ? 22 : 20), (s[2] - 0.5) * (fire ? 5 : 7));
        sc = fire ? (1.9 + s[3] * 1.6) * (1 - f) * Math.min(1, f * 8) : 0.16 + s[3] * 0.2;
      }
      if (this.unlockT >= 0 && !this.open) sc = 0;
      m4.compose(pv, qv, sv.setScalar(sc));
      this.parts.setMatrixAt(i, m4);
    }
    this.parts.instanceMatrix.needsUpdate = true;

    for (const o of this.orbs) {
      if (!o.visible) continue;
      const u = o.userData;
      u.t += dt / 0.7;
      if (u.t >= 1) { o.visible = false; continue; }
      const e = u.t * u.t * (3 - 2 * u.t);
      o.position.lerpVectors(u.from, pv.set(0, RING_Y, 0), e);
      o.position.y += Math.sin(u.t * Math.PI) * 3;
      o.scale.setScalar(1 - u.t * 0.5);
    }
    return dist;
  }
}
