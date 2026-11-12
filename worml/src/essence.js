// Elemental essence wells up at deposits scattered over each whole world. A
// deposit announces itself without any marker: it sits in a ringed crater,
// the ground around it is veined with light, a pillar of light stands over
// it, the clouds part above it and guardians gather round it.
import * as THREE from 'three';
import { ELEMENTS, groundHeight } from './worlds.js';
import { Builder, propMaterial, glowMaterial, additive, ENV } from './gfx.js';
import { uvVS, pillarFS } from './shaders.js';
import { mulberry32, smoothstep } from './noise.js';

const m4 = new THREE.Matrix4(), qv = new THREE.Quaternion(), sv = new THREE.Vector3(), tv = new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0);
export const REACH = 7;       // orbs this close to you fly to your hand on their own
const PER = 7;

// The font at the heart of a deposit: a cluster of raw essence in its element.
function fontGeometry(rgb, seed) {
  const b = new Builder(), dark = [0.14, 0.13, 0.15];
  b.blob(3.4, dark, 0, 0, 0.2, 0, { detail: 2, rough: 0.5, sy: 0.4, seed });
  const pale = rgb.map((c) => c * 0.6 + 0.4);
  for (let i = 0; i < 7; i++) {
    const a = i * 2.4, r = i ? 1.3 + (i % 3) * 0.5 : 0, h = i ? 2.2 + (i % 4) * 0.9 : 6.5;
    b.blob(i ? 0.6 : 1.0, rgb, 0.55, Math.cos(a) * r, h * 0.5, Math.sin(a) * r, { detail: 2, rough: 0.25, sy: h / (i ? 1.2 : 2), seed: seed + i, color2: pale, under: 0.1 });
  }
  return b.build();
}

function rubbleGeometry(rock, seed) {
  const b = new Builder(), rnd = mulberry32(seed);
  for (let i = 0; i < 16; i++) {
    const a = rnd() * 6.283, r = Math.sqrt(rnd()) * 12, y = (1 - r / 13) * 8 * rnd();
    const tone = 0.8 + rnd() * 0.5;
    b.blob(2.6 + rnd() * 2.6, rock.map((c) => c * tone), 0, Math.cos(a) * r, y + 0.8, Math.sin(a) * r, { detail: 1, rough: 0.55, sy: 0.75, seed: seed + i, ry: rnd() * 6, ridged: i % 3 === 0 });
  }
  return b.build();
}

export class EssenceField {
  constructor(planet) {
    this.planet = planet;
    const def = planet.def, R = def.radius, rnd = mulberry32(def.seed + 99), rgb = ELEMENTS[def.element].rgb;
    this.element = def.element;
    this.group = new THREE.Group();
    this.group.visible = false;
    planet.group.add(this.group);
    const fontGeo = fontGeometry(rgb, def.seed), fontMat = propMaterial(0.7, { grain: 0.4 });
    const orbGeo = new THREE.IcosahedronGeometry(1, 2), orbMat = glowMaterial(rgb, 1.7, 1.5);
    const pillarGeo = new THREE.CylinderGeometry(1, 0.55, 1, 16, 1, true).translate(0, 0.5, 0);
    let rubbleGeo = null; const rubbleMat = propMaterial(0.1);
    this.deposits = def.deposits.map((site, index) => {
      const up = new THREE.Vector3(site.x, site.y, site.z);
      const pos = up.clone().multiplyScalar(R + groundHeight(def, up.x, up.y, up.z));
      const t1 = new THREE.Vector3().crossVectors(up, Math.abs(up.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : Y).normalize();
      const t2 = new THREE.Vector3().crossVectors(t1, up);
      const g = new THREE.Group();
      g.position.copy(pos);
      g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(t1, up, t2));
      this.group.add(g);
      g.add(new THREE.Mesh(fontGeo, fontMat));
      const pu = { uColor: { value: new THREE.Vector3(...rgb) }, uTime: ENV.uTime, uAlpha: { value: 0.5 } };
      const pillar = new THREE.Mesh(pillarGeo, new THREE.ShaderMaterial({ vertexShader: uvVS, fragmentShader: pillarFS, uniforms: pu, side: THREE.DoubleSide, ...additive }));
      pillar.frustumCulled = false; pillar.renderOrder = 3;
      g.add(pillar);
      const orbs = [];
      for (let i = 0; i < PER; i++) {
        const a = (i / PER) * Math.PI * 2 + rnd() * 0.5, r = 9 + rnd() * 20;
        const d = pos.clone().addScaledVector(t1, Math.cos(a) * r).addScaledVector(t2, Math.sin(a) * r).normalize();
        // deposit-local (x, y, z) = (t1, up, t2)
        const world = d.clone().multiplyScalar(R + groundHeight(def, d.x, d.y, d.z) + 1.5).sub(pos);
        const home = new THREE.Vector3(world.dot(t1), world.dot(up), world.dot(t2));
        orbs.push({ home, pos: home.clone(), state: 0, t: rnd() * 10, hand: null });
      }
      const mesh = new THREE.InstancedMesh(orbGeo, orbMat, PER);
      mesh.frustumCulled = false; mesh.renderOrder = 4;
      g.add(mesh);
      let rubble = null;
      if (site.buried) {
        rubbleGeo = rubbleGeo || rubbleGeometry(def.look.rock, def.seed + 7);
        rubble = new THREE.Mesh(rubbleGeo, rubbleMat);
        g.add(rubble);
      }
      return { index, site, up, pos, g, pillar, pu, orbs, mesh, rubble, buried: !!site.buried, undo: -1, inv: new THREE.Matrix4().copy(g.matrixWorld), near: false };
    });
    for (const d of this.deposits) this.draw(d, 0);
  }

  setBuried(index, buried) {
    const d = this.deposits[index];
    if (!d || !d.rubble) return;
    d.buried = buried; d.undo = -1;
    d.rubble.visible = buried; d.rubble.scale.setScalar(1); d.rubble.position.set(0, 0, 0); d.rubble.rotation.y = 0;
  }

  // The Rewinder: the collapse plays backward and the rubble lifts away.
  unbury(d) { if (d.buried && d.undo < 0) { d.undo = 0; return true; } return false; }

  // Quickening seeds: spent orbs near a point (planet-local) regrow at once.
  regrow(local, radius) {
    let n = 0;
    for (const d of this.deposits) {
      if (d.pos.distanceTo(local) > radius + 40) continue;
      for (const o of d.orbs) if (o.state === 2) { o.state = 0; o.pos.copy(o.home); n++; }
    }
    return n;
  }

  nearest(local) {
    let best = null, bd = Infinity;
    for (const d of this.deposits) { const q = d.pos.distanceTo(local); if (q < bd) { bd = q; best = d; } }
    return { dep: best, dist: bd };
  }

  draw(d, time) {
    let i = 0;
    for (const o of d.orbs) {
      let scale = 0.55 + 0.08 * Math.sin(time * 2 + o.t);
      if (o.state === 1) scale *= Math.min(1, 0.3 + (o.d ?? 3) * 0.3);
      else if (o.state === 2 || d.buried) scale = 0;
      m4.compose(o.pos, qv, sv.setScalar(scale));
      d.mesh.setMatrixAt(i++, m4);
    }
    d.mesh.instanceMatrix.needsUpdate = true;
  }

  // hands: [{ p: Vector3 planet-local }], head: Vector3 planet-local.
  // Returns the hands that collected an orb this frame.
  update(dt, time, hands, head, canCollect) {
    const got = [];
    for (const d of this.deposits) {
      const dist = d.pos.distanceTo(head);
      // pillar: widens and lengthens with distance so it reads from orbit; fades as you arrive
      const w = THREE.MathUtils.clamp(dist * 0.006, 2.2, 700);
      d.pillar.scale.set(w, 380 + dist * 0.9, w);
      d.pu.uAlpha.value = (d.buried ? 0.22 : 0.55) * smoothstep(12, 160, dist);
      d.mesh.visible = dist < 4000;
      if (d.undo >= 0) {
        d.undo += dt / 1.8;
        const e = smoothstep(0, 1, d.undo);
        d.rubble.position.y = e * 26; d.rubble.rotation.y = -e * 2.5; d.rubble.scale.setScalar(Math.max(0.001, 1 - e));
        if (d.undo >= 1) { d.buried = false; d.undo = -1; d.rubble.visible = false; }
      }
      const near = dist < 300;
      if (!near && !d.near) continue;
      d.near = near;
      d.g.updateMatrixWorld();
      for (const o of d.orbs) {
        if (o.state === 0) {
          o.pos.copy(o.home); o.pos.y += Math.sin(time * 1.1 + o.t) * 0.25;
          if (canCollect && !d.buried && hands.length) {
            tv.copy(o.pos).applyMatrix4(d.g.matrix);   // planet-local
            if (tv.distanceTo(head) < REACH) { o.state = 1; o.hand = hands[0]; }
            else for (const h of hands) if (tv.distanceTo(h.p) < 2.5) { o.state = 1; o.hand = h; break; }
          }
        } else if (o.state === 1) {
          tv.copy(o.hand.p).sub(d.pos).set(tv.dot(sv.setFromMatrixColumn(d.g.matrix, 0)), tv.dot(sv.setFromMatrixColumn(d.g.matrix, 1)), tv.dot(sv.setFromMatrixColumn(d.g.matrix, 2)));
          o.pos.lerp(tv, 1 - Math.exp(-dt * 7));
          o.d = o.pos.distanceTo(tv);
          if (o.d < 0.5) { o.state = 2; o.t = 0; got.push(o.hand); }
        } else {
          o.t += dt;
          if (o.t > 50) { o.state = 0; o.pos.copy(o.home); }
        }
      }
      this.draw(d, time);
    }
    return got;
  }
}
