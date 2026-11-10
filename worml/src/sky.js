// Deep-space backdrop: baked nebula cube map, crisp point stars and the sun.
import * as THREE from 'three';
import { SUN } from './worlds.js';
import { mulberry32 } from './noise.js';
import { uvVS, nebulaFS, starVS, starFS, sunFS, coronaFS } from './shaders.js';
import { additive } from './gfx.js';

export class Sky {
  constructor(renderer, scene, detailTex) {
    // Nebula: rendered once into a cube map so it costs nothing per frame.
    const rt = new THREE.WebGLCubeRenderTarget(1024, { type: THREE.HalfFloatType, generateMipmaps: false });
    const bakeScene = new THREE.Scene();
    const box = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2),
      new THREE.ShaderMaterial({ vertexShader: uvVS, fragmentShader: nebulaFS, side: THREE.BackSide }));
    bakeScene.add(box);
    new THREE.CubeCamera(0.1, 10, rt).update(renderer, bakeScene);
    box.geometry.dispose(); box.material.dispose();
    scene.background = rt.texture;

    const rnd = mulberry32(77), COUNT = 2600;
    const pos = new Float32Array(COUNT * 3), col = new Float32Array(COUNT * 3), size = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
      const z = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - z * z);
      pos.set([Math.cos(a) * r * 6e6, z * 6e6, Math.sin(a) * r * 6e6], i * 3);
      const m = Math.pow(rnd(), 5), t = rnd();
      const b = 0.35 + m * 1.6;
      col.set([b * (0.75 + 0.35 * t), b * 0.85, b * (1.1 - 0.35 * t)], i * 3);
      size[i] = 1.6 + m * 3.4;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    sg.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    sg.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    this.stars = new THREE.Points(sg, new THREE.ShaderMaterial({ vertexShader: starVS, fragmentShader: starFS, ...additive }));
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -10;
    scene.add(this.stars);

    this.time = { value: 0 };
    this.sun = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24),
      new THREE.ShaderMaterial({ vertexShader: uvVS, fragmentShader: sunFS, uniforms: { uDetail: { value: detailTex }, uTime: this.time } }));
    this.sun.scale.setScalar(SUN.radius);
    scene.add(this.sun);
    this.corona = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
      new THREE.ShaderMaterial({ vertexShader: uvVS, fragmentShader: coronaFS, ...additive }));
    this.corona.scale.setScalar(SUN.radius * 9);
    this.corona.renderOrder = -5;
    scene.add(this.corona);
  }

  update(playerPos, time) {
    this.time.value = time;
    this.sun.position.copy(playerPos).negate();
    this.corona.position.copy(this.sun.position);
    this.corona.lookAt(0, 0, 0);
  }
}
