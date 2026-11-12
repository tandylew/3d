// The font: the heart of each world's trial ground, standing on an islet in a
// pool of the world's own liquid. It is dormant until you master the trial
// (see trials.js); after that, standing by it refills your element.
import * as THREE from 'three';
import { ELEMENTS, groundHeight } from './worlds.js';
import { Builder, propMaterial, glowMaterial } from './gfx.js';

const Y = new THREE.Vector3(0, 1, 0);

// A cluster of raw essence in its element.
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

export class EssenceField {
  constructor(planet) {
    this.planet = planet;
    const def = planet.def, R = def.radius, rgb = ELEMENTS[def.element].rgb;
    this.element = def.element;
    this.group = new THREE.Group();
    this.group.visible = false;
    planet.group.add(this.group);
    this.fontMat = propMaterial(0.7, { grain: 0.4 });
    this.deposits = def.deposits.map((site, index) => {
      const up = new THREE.Vector3(site.x, site.y, site.z);
      const pos = up.clone().multiplyScalar(R + groundHeight(def, up.x, up.y, up.z));
      const t1 = new THREE.Vector3().crossVectors(up, Math.abs(up.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : Y).normalize();
      const t2 = new THREE.Vector3().crossVectors(t1, up);
      const g = new THREE.Group();
      g.position.copy(pos);
      g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(t1, up, t2));
      this.group.add(g);
      const font = new THREE.Mesh(fontGeometry(rgb, def.seed), this.fontMat);
      g.add(font);
      const halo = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), glowMaterial(rgb, 2.2, 0.8));
      halo.position.y = 4; g.add(halo);
      return { index, site, up, pos, t1, t2, g, font, halo };
    });
    this.attuned = false;
  }

  // The one trial ground on this world.
  get site() { return this.deposits[0]; }

  nearest(local) { const d = this.deposits[0]; return { dep: d, dist: d ? d.pos.distanceTo(local) : Infinity }; }

  // Dormant: dull and small. Attuned: it breathes light.
  update(time, attuned, stir) {
    this.attuned = attuned;
    for (const d of this.deposits) {
      const k = attuned ? 1 + 0.12 * Math.sin(time * 2.2) : 0.25 + stir * 0.5;
      d.halo.scale.setScalar(3.2 * k);
      d.halo.material.uniforms.uGain.value = attuned ? 0.9 : 0.25 + stir * 0.5;
      this.fontMat.uniforms.uFlash.value = attuned ? 0.25 + 0.15 * Math.sin(time * 2.2) : stir * 0.6;
      this.fontMat.uniforms.uTint.value.set(...ELEMENTS[this.element].rgb);
    }
  }
}
