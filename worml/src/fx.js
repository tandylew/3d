// Speed streaks (a sense of motion in empty space) and the wormhole tunnel.
import * as THREE from 'three';
import { additive } from './gfx.js';
import { uvVS, tunnelFS } from './shaders.js';
import { mulberry32, smoothstep } from './noise.js';

const N = 150, BOX = 45;
const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), dir = new THREE.Vector3();
const Z = new THREE.Vector3(0, 0, 1);

export class Streaks {
  constructor(scene) {
    const rnd = mulberry32(5);
    this.pts = Array.from({ length: N }, () => new THREE.Vector3((rnd() * 2 - 1) * BOX, (rnd() * 2 - 1) * BOX, (rnd() * 2 - 1) * BOX));
    this.mat = new THREE.MeshBasicMaterial({ color: 0xbfd8ff, opacity: 0, ...additive });
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.035, 0.035, 1), this.mat, N);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    scene.add(this.mesh);
  }

  update(dt, vel, speed, alt) {
    const k = smoothstep(60, 600, speed) * smoothstep(40, 300, alt);
    this.mat.opacity = k * 0.55;
    this.mesh.visible = k > 0.01;
    if (!this.mesh.visible) return;
    dir.copy(vel).normalize();
    const vis = 45 * Math.log10(1 + speed / 30);
    q.setFromUnitVectors(Z, dir);
    s.set(1, 1, THREE.MathUtils.clamp(vis * 0.07, 0.4, 16));
    for (let i = 0; i < N; i++) {
      const p = this.pts[i];
      p.addScaledVector(dir, -vis * dt);
      for (const ax of ['x', 'y', 'z']) { if (p[ax] > BOX) p[ax] -= 2 * BOX; else if (p[ax] < -BOX) p[ax] += 2 * BOX; }
      // keep a clear bubble around the head for comfort
      const near = p.lengthSq() < 36;
      m4.compose(p, q, near ? s.clone().setScalar(0) : s);
      this.mesh.setMatrixAt(i, m4);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export class Tunnel {
  constructor(rig, detailTex) {
    this.u = {
      uDetail: { value: detailTex }, uColor: { value: new THREE.Vector3(1, 1, 1) }, uColor2: { value: new THREE.Vector3(1, 1, 1) },
      uTime: { value: 0 }, uAlpha: { value: 0 }, uMix: { value: 0 },
    };
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(30, 40, 24),
      new THREE.ShaderMaterial({ vertexShader: uvVS, fragmentShader: tunnelFS, uniforms: this.u, side: THREE.BackSide, transparent: true, depthTest: false, depthWrite: false }));
    this.mesh.renderOrder = 900;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    rig.add(this.mesh);
  }

  set(alpha, mix, time, camera) {
    this.mesh.visible = alpha > 0.001;
    this.u.uAlpha.value = alpha; this.u.uMix.value = mix; this.u.uTime.value = time;
    if (camera) { this.mesh.position.copy(camera.position); }
  }

  aim(camera) {
    // Point the tunnel where the player is looking (yaw only).
    const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
    this.mesh.rotation.set(0, e.y, 0);
  }
}
