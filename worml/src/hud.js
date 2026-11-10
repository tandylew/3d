// In-world HUD: a wrist display on the left controller, a soft toast panel
// that drifts in front of you, and labelled markers for every world.
import * as THREE from 'three';
import { ELEMENTS, ELEMENT_ORDER } from './worlds.js';

const FONT = 'system-ui, "Segoe UI", Roboto, sans-serif';

function panel(w, h, pxw, pxh) {
  const canvas = document.createElement('canvas');
  canvas.width = pxw; canvas.height = pxh;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
  mesh.renderOrder = 1000;
  mesh.frustumCulled = false;
  return { canvas, ctx: canvas.getContext('2d'), tex, mesh };
}

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

export function fmtDist(m) {
  if (m >= 1e5) return (m / 1000).toFixed(0) + ' km';
  if (m >= 1000) return (m / 1000).toFixed(1) + ' km';
  return m.toFixed(0) + ' m';
}
export function fmtSpeed(v) {
  return v >= 1000 ? (v / 1000).toFixed(v >= 1e4 ? 0 : 1) + ' km/s' : v.toFixed(0) + ' m/s';
}

const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
const lookM = new THREE.Matrix4(), UP = new THREE.Vector3(0, 1, 0);

export class Hud {
  constructor(scene, rig, camera, input) {
    this.scene = scene; this.rig = rig; this.camera = camera; this.input = input;
    this.wrist = panel(0.2, 0.15, 640, 480);
    this.toast = panel(1.5, 0.375, 1024, 256);
    this.toast.mesh.material.opacity = 0;
    rig.add(this.toast.mesh);
    this.toastT = 0; this.toastQueue = []; this.toastText = null;
    this.markers = new Map();
    this.tick = 0; this.wristTimer = 0;
  }

  say(title, sub = '', seconds = 5, color = '#ffffff') {
    this.toastQueue.push({ title, sub, seconds, color });
    if (this.toastQueue.length > 3) this.toastQueue.shift();
  }

  drawToast(m) {
    const { ctx, canvas, tex } = this.toast;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(6,10,22,0.72)'; rr(ctx, 8, 8, 1008, 240, 36); ctx.fill();
    ctx.strokeStyle = m.color; ctx.globalAlpha = 0.7; ctx.lineWidth = 4; ctx.stroke(); ctx.globalAlpha = 1;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = m.color; ctx.font = `700 ${m.sub ? 62 : 70}px ${FONT}`;
    ctx.fillText(m.title, 512, m.sub ? 92 : 128, 960);
    if (m.sub) { ctx.fillStyle = '#c9d6ee'; ctx.font = `400 40px ${FONT}`; ctx.fillText(m.sub, 512, 172, 960); }
    tex.needsUpdate = true;
  }

  marker(id) {
    let m = this.markers.get(id);
    if (!m) {
      const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 192;
      const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace;
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
      sprite.renderOrder = 950;
      this.scene.add(sprite);
      m = { canvas, ctx: canvas.getContext('2d'), tex, sprite, key: '' };
      this.markers.set(id, m);
    }
    return m;
  }

  // info: { id, dir (unit, scene space), name, sub, dist, css, state: 'locked'|'open'|'goal', aimed }
  setMarker(info) {
    const m = this.marker(info.id);
    m.sprite.visible = info.visible;
    if (!info.visible) return;
    const goal = info.state === 'goal';
    const D = 420, w = D * (info.aimed ? 0.27 : goal ? 0.23 : 0.19);
    m.sprite.position.copy(info.dir).multiplyScalar(D);
    m.sprite.scale.set(w, w * 0.375, 1);
    m.sprite.material.opacity = info.aimed || goal ? 1 : 0.6;
    const key = [info.name, info.sub, fmtDist(info.dist), info.state, info.aimed].join('|');
    if (key === m.key) return;
    m.key = key;
    const { ctx } = m;
    ctx.clearRect(0, 0, 512, 192);
    ctx.fillStyle = 'rgba(6,10,22,0.55)'; rr(ctx, 6, 6, 500, 150, 28); ctx.fill();
    ctx.lineWidth = info.aimed ? 7 : 3; ctx.strokeStyle = info.css; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(236, 156); ctx.lineTo(256, 186); ctx.lineTo(276, 156); ctx.fillStyle = info.css; ctx.fill();
    ctx.beginPath(); ctx.arc(62, 80, 30, 0, 6.3); ctx.fillStyle = info.css; ctx.fill();
    ctx.fillStyle = '#06101e'; ctx.font = `700 34px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(info.state === 'open' ? '✓' : info.state === 'goal' ? '➤' : '•', 62, 82);
    ctx.textAlign = 'left'; ctx.fillStyle = '#ffffff'; ctx.font = `700 46px ${FONT}`;
    ctx.fillText(info.name.toUpperCase(), 108, 54, 380);
    ctx.fillStyle = '#c9d6ee'; ctx.font = `400 30px ${FONT}`;
    ctx.fillText(`${info.sub}  ·  ${fmtDist(info.dist)}`, 108, 108, 380);
    m.tex.needsUpdate = true;
  }

  drawWrist(s) {
    const { ctx, tex } = this.wrist;
    ctx.clearRect(0, 0, 640, 480);
    ctx.fillStyle = 'rgba(6,10,22,0.8)'; rr(ctx, 6, 6, 628, 468, 34); ctx.fill();
    ctx.strokeStyle = s.css; ctx.lineWidth = 4; ctx.stroke();
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff'; ctx.font = `800 40px ${FONT}`; ctx.fillText('WORML', 32, 48);
    ctx.textAlign = 'right'; ctx.fillStyle = s.css; ctx.font = `600 30px ${FONT}`;
    ctx.fillText(`${s.linked}/6 linked · ${s.visited}/6 visited`, 608, 48);
    ctx.textAlign = 'left'; ctx.fillStyle = '#ffe9a8'; ctx.font = `700 33px ${FONT}`;
    ctx.fillText(s.objective[0], 32, 112, 580);
    ctx.fillStyle = '#c9d6ee'; ctx.font = `400 27px ${FONT}`;
    ctx.fillText(s.objective[1] || '', 32, 156, 580);
    ELEMENT_ORDER.slice(0, 5).forEach((el, i) => {
      const x = 32 + i * 118, y = 200, e = ELEMENTS[el], n = s.inv[el] || 0;
      ctx.fillStyle = 'rgba(255,255,255,0.07)'; rr(ctx, x, y, 106, 120, 18); ctx.fill();
      ctx.beginPath(); ctx.arc(x + 53, y + 40, 22, 0, 6.3); ctx.fillStyle = e.css; ctx.globalAlpha = n ? 1 : 0.3; ctx.fill(); ctx.globalAlpha = 1;
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.font = `700 30px ${FONT}`; ctx.fillText(String(n), x + 53, y + 42);
      ctx.fillStyle = '#c9d6ee'; ctx.font = `400 23px ${FONT}`; ctx.fillText(e.label, x + 53, y + 94);
      ctx.textAlign = 'left';
    });
    ctx.fillStyle = '#ffffff'; ctx.font = `600 30px ${FONT}`;
    ctx.fillText(`${s.place}`, 32, 366, 580);
    ctx.fillStyle = '#9fb4d8'; ctx.font = `400 28px ${FONT}`;
    ctx.fillText(`Speed ${fmtSpeed(s.speed)}   ·   Altitude ${fmtDist(Math.max(0, s.alt))}`, 32, 416, 580);
    tex.needsUpdate = true;
  }

  update(dt, state) {
    // --- wrist panel: on the left controller in VR, bottom-left of view on desktop
    const wm = this.wrist.mesh, leftCtrl = this.input.ctrl.find((k) => k.handed === 'left');
    const parent = this.input.xr && leftCtrl ? leftCtrl.ray : this.camera;
    if (wm.parent !== parent) {
      parent.add(wm);
      if (parent === this.camera) { wm.position.set(-0.36, -0.2, -0.75); wm.rotation.set(-0.1, 0.35, 0); wm.scale.setScalar(1.25); }
      else { wm.position.set(0.02, 0.1, 0.03); wm.rotation.set(-1.0, 0, 0); wm.scale.setScalar(1); }
    }
    this.wristTimer -= dt;
    if (this.wristTimer <= 0) { this.wristTimer = 0.2; this.drawWrist(state); }

    // --- toast: lazily follows the head so it's readable but never glued to the face
    const t = this.toast.mesh;
    this.toastT -= dt;
    if (this.toastT <= 0 && this.toastQueue.length) {
      this.toastText = this.toastQueue.shift();
      this.toastT = this.toastText.seconds;
      this.drawToast(this.toastText);
    }
    const target = this.toastT > 0 ? Math.min(1, this.toastT * 2, (this.toastText.seconds - this.toastT) * 3) : 0;
    t.material.opacity += (target - t.material.opacity) * Math.min(1, dt * 10);
    t.visible = t.material.opacity > 0.01;
    a.set(0, 0, -1).applyQuaternion(this.camera.quaternion); a.y = 0;
    if (a.lengthSq() < 1e-4) a.set(0, 0, -1);
    a.normalize();
    b.copy(this.camera.position).addScaledVector(a, 2.3); b.y -= 0.42;
    t.position.lerp(b, Math.min(1, dt * 3));
    // Face the head, computed in rig space (the rig itself tilts with the planet).
    c.copy(this.camera.position); c.y -= 0.1;
    t.quaternion.setFromRotationMatrix(lookM.lookAt(c, t.position, UP));
  }
}
