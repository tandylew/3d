// Elemental essence: glowing orbs scattered around each world's gate and in
// outlying groves. Hold GRIP to draw nearby orbs into your hand.
import * as THREE from 'three';
import { ELEMENTS, groundHeight } from './worlds.js';
import { glowMaterial } from './gfx.js';
import { mulberry32 } from './noise.js';

const m4 = new THREE.Matrix4(), qv = new THREE.Quaternion(), sv = new THREE.Vector3(), tv = new THREE.Vector3();
export const REACH = 18;

export class EssenceField {
  constructor(planet, gate) {
    this.planet = planet;
    const def = planet.def, R = def.radius, rnd = mulberry32(def.seed + 99);
    this.element = def.element;
    this.anchor = gate.base.clone();
    this.orbs = [];
    const put = (east, north) => {
      const p = gate.base.clone().addScaledVector(gate.x, east).addScaledVector(gate.z, north).normalize();
      const h = groundHeight(def, p.x, p.y, p.z);
      const home = p.clone().multiplyScalar(R + h + 1.4).sub(this.anchor);
      this.orbs.push({ home, pos: home.clone(), up: p, state: 0, t: rnd() * 10, hand: null });
    };
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + rnd() * 0.3, r = 26 + rnd() * 80;
      put(Math.cos(a) * r, Math.sin(a) * r);
    }
    for (let k = 0; k < 8; k++) {
      const a = rnd() * Math.PI * 2, r = 350 + rnd() * 2300, ex = Math.cos(a) * r, ny = Math.sin(a) * r;
      for (let i = 0; i < 6; i++) put(ex + (rnd() - 0.5) * 36, ny + (rnd() - 0.5) * 36);
    }
    this.mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 2), glowMaterial(ELEMENTS[def.element].rgb, 1.7, 1.5), this.orbs.length);
    this.mesh.position.copy(this.anchor);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    planet.group.add(this.mesh);
  }

  // hands: [{ p: Vector3 planet-local, grip: 0..1 }], head: Vector3 planet-local.
  // Returns the hands that collected an orb this frame.
  update(dt, time, hands, head, canCollect) {
    const got = [];
    let i = 0;
    for (const o of this.orbs) {
      let scale = 0.55 + 0.08 * Math.sin(time * 2 + o.t);
      if (o.state === 0) {
        o.pos.copy(o.home).addScaledVector(o.up, Math.sin(time * 1.1 + o.t) * 0.25);
        if (canCollect) {
          tv.copy(o.pos).add(this.anchor);
          if (tv.distanceTo(head) < 1.8) { o.state = 1; o.hand = hands[0]; }
          else for (const h of hands) {
            const d = tv.distanceTo(h.p);
            if (d < 0.9 || (h.grip > 0.5 && d < REACH)) { o.state = 1; o.hand = h; break; }
          }
        }
      } else if (o.state === 1) {
        tv.copy(o.hand.p).sub(this.anchor);
        o.pos.lerp(tv, 1 - Math.exp(-dt * 6));
        const d = o.pos.distanceTo(tv);
        scale *= Math.min(1, 0.3 + d * 0.3);
        if (d < 0.45) { o.state = 2; o.t = 0; got.push(o.hand); }
      } else {
        o.t += dt;
        scale = 0;
        if (o.t > 50) { o.state = 0; o.pos.copy(o.home); }
      }
      m4.compose(o.pos, qv, sv.setScalar(scale));
      this.mesh.setMatrixAt(i++, m4);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    return got;
  }
}
