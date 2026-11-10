// Shared graphics helpers: procedural detail texture, a tiny geometry merger
// with baked vertex colours, and the material factories.
import * as THREE from 'three';
import { mulberry32 } from './noise.js';
import { propVS, propFS, glowVS, glowFS } from './shaders.js';

// Environment uniforms of the world the player is currently at. Props, gates
// and orbs all share these objects so they light and fog like the terrain.
export const ENV = {
  uCenter: { value: new THREE.Vector3() },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uScatter: { value: new THREE.Vector3(0.3, 0.5, 1) },
  uSunset: { value: new THREE.Vector3(1, 0.5, 0.3) },
  uFog: { value: 0 },
  uCamSunElev: { value: 1 },
  uTime: { value: 0 },
};

export function syncEnv(planet) {
  const u = planet.uniforms;
  ENV.uCenter.value.copy(u.uCenter.value);
  ENV.uSunDir.value.copy(u.uSunDir.value);
  ENV.uScatter.value.copy(u.uScatter.value);
  ENV.uSunset.value.copy(u.uSunset.value);
  ENV.uFog.value = u.uFog.value;
  ENV.uCamSunElev.value = u.uCamSunElev.value;
  ENV.uTime.value = u.uTime.value;
}

// Tileable RGBA noise: R,G = two fbm fields, B,A = gradient of R (for bump).
export function makeDetailTexture() {
  const S = 256;
  const field = (seed) => {
    const rnd = mulberry32(seed), out = new Float32Array(S * S);
    let amp = 0.5;
    for (let o = 0; o < 5; o++) {
      const f = 4 << o, lat = new Float32Array(f * f);
      for (let i = 0; i < lat.length; i++) lat[i] = rnd();
      for (let y = 0; y < S; y++) {
        const fy = (y / S) * f, y0 = Math.floor(fy), ty = fy - y0, sy = ty * ty * (3 - 2 * ty);
        for (let x = 0; x < S; x++) {
          const fx = (x / S) * f, x0 = Math.floor(fx), tx = fx - x0, sx = tx * tx * (3 - 2 * tx);
          const x1 = (x0 + 1) % f, y1 = (y0 + 1) % f;
          const a = lat[y0 * f + x0], b = lat[y0 * f + x1], c = lat[y1 * f + x0], d = lat[y1 * f + x1];
          out[y * S + x] += amp * (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy);
        }
      }
      amp *= 0.5;
    }
    let mn = 1e9, mx = -1e9;
    for (const v of out) { if (v < mn) mn = v; if (v > mx) mx = v; }
    for (let i = 0; i < out.length; i++) out[i] = (out[i] - mn) / (mx - mn);
    return out;
  };
  const A = field(11), B = field(29), data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const gx = A[y * S + ((x + 1) % S)] - A[y * S + ((x + S - 1) % S)];
      const gy = A[((y + 1) % S) * S + x] - A[((y + S - 1) % S) * S + x];
      data[i * 4] = A[i] * 255; data[i * 4 + 1] = B[i] * 255;
      data[i * 4 + 2] = Math.max(0, Math.min(255, 127.5 + gx * 900));
      data[i * 4 + 3] = Math.max(0, Math.min(255, 127.5 + gy * 900));
    }
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

// Merges primitives into one flat-shaded geometry with per-part colour + glow.
export class Builder {
  constructor() { this.pos = []; this.col = []; this.m = new THREE.Matrix4(); }

  add(geom, color, glow = 0, tx = 0, ty = 0, tz = 0, sx = 1, sy = sx, sz = sx, rx = 0, ry = 0, rz = 0) {
    const g = geom.index ? geom.toNonIndexed() : geom;
    this.m.compose(new THREE.Vector3(tx, ty, tz), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
    const p = g.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(this.m);
      this.pos.push(v.x, v.y, v.z);
      this.col.push(color[0], color[1], color[2], glow);
    }
    return this;
  }

  // A cone whose base sits at (x,y,z), leaning `tilt` radians from vertical toward heading `yaw`.
  spike(radius, len, seg, color, glow, x, y, z, yaw = 0, tilt = 0) {
    const g = new THREE.ConeGeometry(radius, len, seg).translate(0, len / 2, 0);
    return this.add(g, color, glow, x, y, z, 1, 1, 1, 0, yaw, tilt);
  }

  // A prism/box-like primitive resting on its base at (x,y,z).
  column(geom, h, color, glow, x, y, z, ry = 0) {
    return this.add(geom.translate(0, h / 2, 0), color, glow, x, y, z, 1, 1, 1, 0, ry, 0);
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('aColor', new THREE.Float32BufferAttribute(this.col, 4));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

export function propMaterial(shine = 0.1, extra = {}) {
  return new THREE.ShaderMaterial({
    vertexShader: propVS, fragmentShader: propFS,
    uniforms: { ...ENV, uShine: { value: shine }, uFlash: { value: 0 }, uTint: { value: new THREE.Vector3(1, 1, 1) } },
    ...extra,
  });
}

export function glowMaterial(color = [1, 1, 1], power = 2, gain = 1.4) {
  return new THREE.ShaderMaterial({
    vertexShader: glowVS, fragmentShader: glowFS,
    uniforms: { uColor: { value: new THREE.Vector3(...color) }, uPower: { value: power }, uGain: { value: gain } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}

export const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };
