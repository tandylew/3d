// In-world HUD: a wrist display on the left controller, a soft toast panel
// that drifts in front of you, and labelled markers for every world.
import * as THREE from 'three';
import { ELEMENTS, ELEMENT_ORDER } from './worlds.js';
import { uvVS, veilFS } from './shaders.js';

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
    this.markersOn = true; this.flatKey = '';
    // The objectives panel stays out of the way until asked for.
    this.showObjectives = false;
    this.wrist.mesh.visible = false;
    // Vitals: a slim strip low in view that appears only when it has news
    // (hurt, essence gained or spent, a relic used) and fades again.
    this.vitals = panel(0.6, 0.075, 960, 120);
    this.vitals.mesh.material.opacity = 0;
    camera.add(this.vitals.mesh);
    this.vitalsT = 0; this.vitalsKey = '';
    // Radar: a small disc showing what lies around you. Up is where you face;
    // distance is logarithmic, so the far side of the world still fits.
    this.radar = panel(0.16, 0.16, 256, 256);
    this.radar.mesh.visible = false;
    this.radarOn = true; this.blips = null; this.radarParent = null;
    // Veil: full-view tint for damage, time effects and fades.
    this.veilU = { uTint: { value: new THREE.Vector4(1, 0, 0, 0) }, uFade: { value: new THREE.Vector4(0, 0, 0, 0) } };
    this.veil = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ vertexShader: uvVS, fragmentShader: veilFS, uniforms: this.veilU, transparent: true, depthTest: false, depthWrite: false }));
    this.veil.position.z = -0.3; this.veil.renderOrder = 980; this.veil.frustumCulled = false;
    camera.add(this.veil);
  }

  say(title, sub = '', seconds = 5, color = '#ffffff') {
    this.toastQueue.push({ title, sub, seconds, color });
    if (this.toastQueue.length > 3) this.toastQueue.shift();
  }

  setRadar(blips) { this.blips = blips; this.radarDirty = true; }

  drawRadar() {
    const { ctx, tex } = this.radar, C = 128, R = 112;
    ctx.clearRect(0, 0, 256, 256);
    ctx.beginPath(); ctx.arc(C, C, R, 0, 6.3); ctx.fillStyle = 'rgba(6,10,22,0.5)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = 2; ctx.stroke();
    const rad = (d) => Math.min(1, Math.log(1 + d / 12) / Math.log(1 + 45000 / 12)) * (R - 10);
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    for (const d of [100, 1000, 10000]) { ctx.beginPath(); ctx.arc(C, C, rad(d), 0, 6.3); ctx.stroke(); }
    // you, facing up
    ctx.beginPath(); ctx.moveTo(C, C - 9); ctx.lineTo(C + 6, C + 6); ctx.lineTo(C - 6, C + 6); ctx.closePath(); ctx.fillStyle = '#ffffff'; ctx.fill();
    const pt = (b) => { const r = rad(b.d); return [C + Math.sin(b.a) * r, C - Math.cos(b.a) * r]; };
    const well = this.blips.find((b) => b.kind === 'well');
    // streams: every deposit is joined to the well
    if (well) {
      const [wx, wy] = pt(well);
      for (const b of this.blips) {
        if (b.kind !== 'deposit' && b.kind !== 'anomaly') continue;
        const [x, y] = pt(b);
        ctx.strokeStyle = b.css; ctx.globalAlpha = 0.35; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(wx, wy); ctx.lineTo(x, y); ctx.stroke(); ctx.globalAlpha = 1;
      }
    }
    for (const b of this.blips) {
      const [x, y] = pt(b);
      ctx.fillStyle = ctx.strokeStyle = b.css; ctx.lineWidth = 3;
      if (b.kind === 'well') { ctx.beginPath(); ctx.arc(x, y, 9, 0, 6.3); ctx.stroke(); if (b.open) { ctx.beginPath(); ctx.arc(x, y, 3.5, 0, 6.3); ctx.fill(); } }
      else if (b.kind === 'deposit') { ctx.globalAlpha = b.spent ? 0.4 : 1; ctx.beginPath(); ctx.arc(x, y, 6, 0, 6.3); if (b.buried) ctx.stroke(); else ctx.fill(); ctx.globalAlpha = 1; }
      else if (b.kind === 'anomaly') { ctx.globalAlpha = b.owned ? 0.4 : 1; ctx.beginPath(); ctx.moveTo(x, y - 9); ctx.lineTo(x + 7, y); ctx.lineTo(x, y + 9); ctx.lineTo(x - 7, y); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1; }
      else { ctx.beginPath(); ctx.arc(x, y, 4.5, 0, 6.3); ctx.fill(); }
      if (b.goal) { ctx.strokeStyle = '#ffe9a8'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 13, 0, 6.3); ctx.stroke(); }
    }
    tex.needsUpdate = true;
  }

  toggleObjectives() { this.showObjectives = !this.showObjectives; return this.showObjectives; }

  // Show the vitals strip for a few seconds.
  poke(sec = 3.5) { this.vitalsT = Math.max(this.vitalsT, sec); }

  drawVitals(s) {
    const { ctx, tex } = this.vitals;
    ctx.clearRect(0, 0, 960, 120);
    ctx.textBaseline = 'middle';
    let x = 20;
    // health
    ctx.fillStyle = 'rgba(6,10,22,0.6)'; rr(ctx, x, 36, 300, 48, 24); ctx.fill();
    const hp = Math.max(0, s.health / 100);
    ctx.fillStyle = hp > 0.5 ? '#7be08a' : hp > 0.25 ? '#ffc65c' : '#ff6b5c';
    if (hp > 0.02) { rr(ctx, x + 6, 42, 288 * hp, 36, 18); ctx.fill(); }
    x += 324;
    // essence you carry (only what you have)
    for (const el of ELEMENT_ORDER) {
      const n = s.inv[el]; if (!n) continue;
      ctx.fillStyle = 'rgba(6,10,22,0.6)'; rr(ctx, x, 30, 84, 60, 30); ctx.fill();
      if (el === s.castEl) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.stroke(); }
      ctx.beginPath(); ctx.arc(x + 28, 60, 15, 0, 6.3); ctx.fillStyle = ELEMENTS[el].css; ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = `700 30px ${FONT}`; ctx.textAlign = 'left'; ctx.fillText(String(n), x + 50, 62);
      x += 92;
    }
    // time relic
    if (s.weapon) {
      const w = s.weapon, label = w.short + (w.count != null ? ` ${w.count}` : '');
      ctx.font = `700 28px ${FONT}`;
      const tw = ctx.measureText(label).width + 44;
      ctx.fillStyle = 'rgba(6,10,22,0.6)'; rr(ctx, 940 - tw, 30, tw, 60, 30); ctx.fill();
      ctx.strokeStyle = w.css; ctx.globalAlpha = w.ready ? 1 : 0.35; ctx.lineWidth = 3; ctx.stroke();
      ctx.fillStyle = w.css; ctx.textAlign = 'center'; ctx.fillText(label, 940 - tw / 2, 62); ctx.globalAlpha = 1;
    }
    tex.needsUpdate = true;
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
    m.sprite.visible = info.visible && this.markersOn;
    if (!m.sprite.visible) return;
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
    ctx.fillText(`Speed ${fmtSpeed(s.speed)}   ·   ${s.alt < -1 ? 'Depth' : 'Altitude'} ${fmtDist(Math.abs(s.alt))}`, 32, 416, 580);
    tex.needsUpdate = true;
  }

  update(dt, state) {
    // --- wrist panel: on the left controller in VR, bottom-left of view on desktop
    const wm = this.wrist.mesh, leftCtrl = this.input.ctrl.find((k) => k.handed === 'left');
    const parent = this.input.xr && leftCtrl ? leftCtrl.ray : this.camera;
    if (wm.parent !== parent) {
      parent.add(wm); this.flatKey = '';
      if (parent !== this.camera) { wm.position.set(0.02, 0.1, 0.03); wm.rotation.set(-1.0, 0, 0); wm.scale.setScalar(1); }
    }
    if (parent === this.camera) {
      // Flat screens: pin the panel to a corner whatever the aspect ratio.
      // Touch layouts keep the bottom of the screen for thumbs, so it goes top-left.
      const touch = this.input.touch.on, cam = this.camera, key = `${cam.aspect.toFixed(3)}|${cam.fov.toFixed(1)}|${touch}`;
      if (key !== this.flatKey) {
        this.flatKey = key;
        const d = 0.75, hh = Math.tan((cam.fov * Math.PI) / 360) * d, hw = hh * cam.aspect;
        const frac = cam.aspect < 1 ? 0.44 : touch ? 0.25 : 0.2;
        const sc = Math.min((hw * 2 * frac) / 0.2, (hh * 2 * 0.32) / 0.15);
        const mx = Math.min(hw, hh) * 0.06;
        wm.scale.setScalar(sc);
        wm.position.set(-hw + mx + 0.1 * sc, touch ? hh - mx - 0.075 * sc : -hh + mx + 0.075 * sc, -d);
        wm.rotation.set(0, touch ? 0 : 0.2, 0);
        this.toastScale = Math.min(1, (hw / d) * 2.3 * 2 * 0.92 / 1.5);
      }
    }
    wm.visible = this.showObjectives;
    this.wristTimer -= dt;
    if (wm.visible && this.wristTimer <= 0) { this.wristTimer = 0.2; this.drawWrist(state); }

    // --- radar: on the left wrist in VR, in a corner of the screen otherwise
    const rm = this.radar.mesh, rParent = this.input.xr && leftCtrl ? leftCtrl.ray : this.camera;
    if (rm.parent !== rParent) { rParent.add(rm); if (rParent !== this.camera) { rm.position.set(-0.13, 0.08, 0.05); rm.rotation.set(-1.0, 0, 0); rm.scale.setScalar(0.75); } }
    rm.visible = this.radarOn && !!this.blips;
    if (rm.visible && this.radarDirty) { this.radarDirty = false; this.drawRadar(); }
    if (rm.visible && rParent === this.camera) {
      const d = 0.75, hh = Math.tan((this.camera.fov * Math.PI) / 360) * d, hw = hh * this.camera.aspect, touch = this.input.touch.on;
      const sc = Math.min((hh * 2 * (touch ? 0.26 : 0.24)) / 0.16, (hw * 2 * 0.3) / 0.16), m = Math.min(hw, hh) * 0.05;
      rm.scale.setScalar(sc); rm.rotation.set(0, 0, 0);
      // touch: bottom centre, between the thumbs. Desktop: top left.
      if (touch) rm.position.set(0, -hh + m + 0.08 * sc, -d); else rm.position.set(-hw + m + 0.08 * sc, hh - m - 0.08 * sc, -d);
    }

    // --- vitals strip
    const vm = this.vitals.mesh, cam = this.camera;
    const vkey = [Math.round(state.health), ELEMENT_ORDER.map((e) => state.inv[e]).join(), state.castEl, state.weapon ? state.weapon.short + state.weapon.count + state.weapon.ready : ''].join('|');
    if (vkey !== this.vitalsKey) { if (this.vitalsKey) this.poke(); this.vitalsKey = vkey; this.drawVitals(state); }
    if (state.health < 99.5) this.poke(1);
    this.vitalsT -= dt;
    vm.material.opacity += ((this.vitalsT > 0 ? 1 : 0) - vm.material.opacity) * Math.min(1, dt * 6);
    vm.visible = vm.material.opacity > 0.01;
    if (this.input.xr) { vm.position.set(0, -0.3, -0.9); vm.scale.setScalar(0.75); this.veil.scale.set(1, 1, 1); }
    else {
      const d = 0.75, hh = Math.tan((cam.fov * Math.PI) / 360) * d, hw = hh * cam.aspect;
      const sc = Math.min(1.5, (hw * 2 * (cam.aspect < 1 ? 0.9 : 0.42)) / 0.6);
      vm.scale.setScalar(sc);
      // touch layouts keep the bottom for thumbs: the strip sits at the top centre
      vm.position.set(0, this.input.touch.on ? hh - 0.07 * sc - hh * 0.04 : -hh + 0.06 * sc + hh * 0.03, -d);
      this.veil.scale.set(hw / d * 0.3 * 1.1, hh / d * 0.3 * 1.1, 1);
    }

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
    t.scale.setScalar(this.input.xr ? 1 : this.toastScale || 1);
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
