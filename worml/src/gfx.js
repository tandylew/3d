// Shared graphics helpers: procedural detail texture, a tiny geometry merger
// with baked vertex colours, and the material factories.
import * as THREE from 'three';
import { mulberry32, Noise } from './noise.js';
import { propVS, propFS, glowVS, glowFS } from './shaders.js';

// Environment uniforms of the world the player is currently at. Props, gates
// and orbs all share these objects so they light and fog like the terrain.
export const ENV = {
  uDetail: { value: null },
  uCloudMap: { value: null },
  uCenter: { value: new THREE.Vector3() },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uScatter: { value: new THREE.Vector3(0.3, 0.5, 1) },
  uSunset: { value: new THREE.Vector3(1, 0.5, 0.3) },
  uCloudMix: { value: new THREE.Vector4(1, 0, 0, 0) },
  uCloudP: { value: new THREE.Vector4(0.5, 0.1, 0, 2000) },
  uCloudCS: { value: new THREE.Vector2(1, 0) },
  uFog0: { value: 0 }, uR: { value: 1 }, uH: { value: 500 }, uCamAlt: { value: 0 },
  uCamSunElev: { value: 1 },
  uTime: { value: 0 },
};

export function syncEnv(planet) {
  const u = planet.uniforms;
  ENV.uCloudMap.value = u.uCloudMap.value;
  for (const k of ['uCenter', 'uSunDir', 'uScatter', 'uSunset', 'uCloudMix', 'uCloudP', 'uCloudCS']) ENV[k].value.copy(u[k].value);
  for (const k of ['uFog0', 'uR', 'uH', 'uCamAlt', 'uCamSunElev', 'uTime']) ENV[k].value = u[k].value;
}

// Tileable RGBA noise. R = soft fbm, G = hard high-frequency grit,
// B,A = slope of a blend of the two (for bump lighting).
export function makeDetailTexture() {
  const S = 512;
  const field = (seed, f0, octaves, gain) => {
    const rnd = mulberry32(seed), out = new Float32Array(S * S);
    let amp = 0.5;
    for (let o = 0; o < octaves; o++) {
      const f = f0 << o, lat = new Float32Array(f * f);
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
      amp *= gain;
    }
    let mn = 1e9, mx = -1e9;
    for (const v of out) { if (v < mn) mn = v; if (v > mx) mx = v; }
    for (let i = 0; i < out.length; i++) out[i] = (out[i] - mn) / (mx - mn);
    return out;
  };
  const A = field(11, 4, 6, 0.5), B = field(29, 16, 5, 0.85), data = new Uint8Array(S * S * 4);
  const Hh = new Float32Array(S * S);
  for (let i = 0; i < Hh.length; i++) Hh[i] = A[i] * 0.6 + B[i] * 0.16;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const gx = Hh[y * S + ((x + 1) % S)] - Hh[y * S + ((x + S - 1) % S)];
      const gy = Hh[((y + 1) % S) * S + x] - Hh[((y + S - 1) % S) * S + x];
      data[i * 4] = A[i] * 255; data[i * 4 + 1] = B[i] * 255;
      data[i * 4 + 2] = Math.max(0, Math.min(255, 127.5 + gx * 2200));
      data[i * 4 + 3] = Math.max(0, Math.min(255, 127.5 + gy * 2200));
    }
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  ENV.uDetail.value = t;
  return t;
}

// Merges primitives into one geometry with per-part colour + glow. Parts keep
// their own normals: curved shapes shade smoothly, `flat` parts stay faceted.
const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _nm = new THREE.Matrix3();
const _blobNoise = new Noise(4242);

export class Builder {
  constructor() { this.pos = []; this.nrm = []; this.col = []; this.m = new THREE.Matrix4(); }

  // color: [r,g,b]; glow > 0 emissive, glow < 0 foliage. `shadeFn(v, n)` may
  // return a brightness multiplier per vertex (baked occlusion).
  add(geom, color, glow = 0, tx = 0, ty = 0, tz = 0, sx = 1, sy = sx, sz = sx, rx = 0, ry = 0, rz = 0, flat = false, shadeFn = null) {
    let g = geom.index ? geom.toNonIndexed() : geom;
    if (flat || !g.attributes.normal) { g = g.clone(); g.computeVertexNormals(); }
    this.m.compose(new THREE.Vector3(tx, ty, tz), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
    _nm.getNormalMatrix(this.m);
    const p = g.attributes.position, n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      _v.fromBufferAttribute(p, i).applyMatrix4(this.m);
      _n.fromBufferAttribute(n, i).applyMatrix3(_nm).normalize();
      const k = shadeFn ? shadeFn(_v, _n) : 1;
      this.pos.push(_v.x, _v.y, _v.z);
      this.nrm.push(_n.x, _n.y, _n.z);
      this.col.push(color[0] * k, color[1] * k, color[2] * k, glow);
    }
    return this;
  }

  // A cone whose base sits at (x,y,z), leaning `tilt` radians from vertical toward heading `yaw`.
  spike(radius, len, seg, color, glow, x, y, z, yaw = 0, tilt = 0, flat = false) {
    const g = new THREE.ConeGeometry(radius, len, seg).translate(0, len / 2, 0);
    return this.add(g, color, glow, x, y, z, 1, 1, 1, 0, yaw, tilt, flat);
  }

  // A prism/box-like primitive resting on its base at (x,y,z).
  column(geom, h, color, glow, x, y, z, ry = 0, flat = false) {
    return this.add(geom.translate(0, h / 2, 0), color, glow, x, y, z, 1, 1, 1, 0, ry, 0, flat);
  }

  // An organic lump: an icosphere pushed in and out by noise, smooth-shaded,
  // darker underneath and in its hollows. Rocks, boulders, tree crowns.
  // opt: { detail, rough (0..1), freq, seed, sy, sx, sz, rx, ry, rz, under (how dark the underside gets), color2 }
  blob(radius, color, glow, x, y, z, opt = {}) {
    const { detail = 2, rough = 0.3, freq = 1.3, seed = 0, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0, under = 0.45, color2 = null, ridged = false } = opt;
    const g = new THREE.IcosahedronGeometry(1, detail);
    const p = g.attributes.position, n = g.attributes.normal, amp = [];
    const f = (vx, vy, vz) => {
      let a = _blobNoise.s(vx * freq + seed * 7.1, vy * freq - seed * 3.3, vz * freq + seed) * 0.6
            + _blobNoise.s(vx * freq * 2.3 + 9 + seed, vy * freq * 2.3, vz * freq * 2.3 - seed) * 0.3;
      if (ridged) a = 0.5 - Math.abs(a) * 1.6;
      return 1 + a * rough;
    };
    const a = new THREE.Vector3(), b = new THREE.Vector3(), t1 = new THREE.Vector3(), t2 = new THREE.Vector3(), d = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      d.fromBufferAttribute(p, i).normalize();
      t1.set(d.y, -d.x, 0); if (t1.lengthSq() < 0.01) t1.set(0, d.z, -d.y); t1.normalize(); t2.crossVectors(d, t1);
      const e = 0.06, r0 = f(d.x, d.y, d.z);
      a.copy(d).addScaledVector(t1, e).normalize(); a.multiplyScalar(f(a.x, a.y, a.z));
      b.copy(d).addScaledVector(t2, e).normalize(); b.multiplyScalar(f(b.x, b.y, b.z));
      d.multiplyScalar(r0);
      a.sub(d); b.sub(d);
      t1.crossVectors(a, b).normalize();
      if (t1.dot(d) < 0) t1.negate();
      p.setXYZ(i, d.x, d.y, d.z); n.setXYZ(i, t1.x, t1.y, t1.z);
      amp.push(r0);
    }
    let i = 0;
    const base = this.pos.length / 3;
    this.add(g, color, glow, x, y, z, radius * sx, radius * sy, radius * sz, rx, ry, rz, false,
      (v, nn) => (1 - under * (0.5 - 0.5 * nn.y)) * (0.72 + 0.28 * Math.min(1, Math.max(0, (amp[i++] - (1 - rough * 0.6)) / (rough * 1.2 + 1e-3)))));
    if (color2) {
      // mottle between two tones by noise so no two lumps look alike
      for (let k = base; k < this.pos.length / 3; k++) {
        const t = 0.5 + 0.5 * _blobNoise.s(this.pos[k * 3] * 0.9 + seed, this.pos[k * 3 + 1] * 0.9, this.pos[k * 3 + 2] * 0.9);
        const o = k * 4, l = Math.hypot(this.col[o], this.col[o + 1], this.col[o + 2]) / (Math.hypot(color[0], color[1], color[2]) || 1);
        for (let c = 0; c < 3; c++) this.col[o + c] = (color[c] + (color2[c] - color[c]) * t) * l;
      }
    }
    return this;
  }

  // A tapered limb following a list of points (trunks, branches, roots).
  limb(points, r0, r1, seg, color, glow = 0) {
    const curve = new THREE.CatmullRomCurve3(points.map((q) => new THREE.Vector3(q[0], q[1], q[2])));
    const ts = Math.max(2, points.length * 3);
    const g = new THREE.TubeGeometry(curve, ts, 1, seg, false);
    // TubeGeometry has a constant radius: pull each ring in toward the taper.
    const p = g.attributes.position, c = new THREE.Vector3(), q = new THREE.Vector3();
    for (let i = 0; i <= ts; i++) {
      curve.getPointAt(i / ts, c);
      const r = r0 + (r1 - r0) * (i / ts);
      for (let j = 0; j <= seg; j++) {
        const k = i * (seg + 1) + j;
        q.fromBufferAttribute(p, k).sub(c).multiplyScalar(r).add(c);
        p.setXYZ(k, q.x, q.y, q.z);
      }
    }
    return this.add(g, color, glow);
  }

  // A leaf blade / palm frond: a creased strip arcing out from (x,y,z) along
  // heading `yaw`, rising then drooping. Rendered double-sided.
  frond(x, y, z, yaw, len, width, rise, droop, color, seg = 5) {
    const pos = [], idx = [], cy = Math.cos(yaw), sy = Math.sin(yaw);
    for (let i = 0; i <= seg; i++) {
      const t = i / seg, out = len * t, up = rise * t - droop * t * t;
      const w = width * Math.pow(Math.sin(Math.PI * Math.min(0.97, t * 0.9 + 0.08)), 0.7);
      for (const side of [-1, 0, 1]) pos.push(x + cy * out - sy * side * w, y + up - Math.abs(side) * w * 0.35, z + sy * out + cy * side * w);
      if (i < seg) { const a = i * 3; idx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a + 1, a + 4, a + 2, a + 2, a + 4, a + 5); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return this.add(g, color, -1);
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('aColor', new THREE.Float32BufferAttribute(this.col, 4));
    g.computeBoundingSphere();
    return g;
  }
}

export function propMaterial(shine = 0.1, extra = {}) {
  return new THREE.ShaderMaterial({
    vertexShader: propVS, fragmentShader: propFS,
    uniforms: { ...ENV, uShine: { value: shine }, uGrain: { value: extra.grain ?? 1 }, uFlash: { value: 0 }, uTint: { value: new THREE.Vector3(1, 1, 1) } },
    ...(extra.material || {}),
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
