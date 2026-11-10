// Unified input: Meta Quest Touch controllers in VR, mouse + keyboard on desktop.
import * as THREE from 'three';
import { Builder, propMaterial, glowMaterial } from './gfx.js';

function makeHand() {
  return { trigger: 0, grip: 0, pos: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, -1), active: false, pad: null };
}

// A small procedural gauntlet so no controller model needs downloading.
function gauntlet(color) {
  const b = new Builder();
  b.add(new THREE.CylinderGeometry(0.022, 0.03, 0.13, 8), [0.16, 0.17, 0.2], 0, 0, 0, 0.02, 1, 1, 1, Math.PI / 2, 0, 0);
  b.add(new THREE.TorusGeometry(0.034, 0.007, 6, 16), color, 0.6, 0, 0, -0.045);
  b.add(new THREE.ConeGeometry(0.012, 0.05, 6), color, 0.8, 0, 0, -0.085, 1, 1, 1, -Math.PI / 2, 0, 0);
  const g = new THREE.Group();
  g.add(new THREE.Mesh(b.build(), propMaterial(0.6)));
  const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.03, 1), glowMaterial(color, 1.5, 1.2));
  orb.position.z = -0.11;
  g.add(orb);
  g.userData.orb = orb;
  return g;
}

export class Input {
  constructor(renderer, rig, camera, dom) {
    this.renderer = renderer; this.rig = rig; this.camera = camera; this.dom = dom;
    this.left = makeHand(); this.right = makeHand();
    this.move = new THREE.Vector2(); this.lift = 0;
    this.turnEdge = 0; this.actEdge = false;
    this.xr = false;
    this.keys = new Set();
    this.yaw = 0; this.pitch = 0;
    this.mouseGrip = false;
    this._turnHeld = false; this._actHeld = false; this._keyEdges = [];
    this.debug = null; // tests can inject { trigger, grip, dir }

    this.ctrl = [0, 1].map((i) => {
      const ray = renderer.xr.getController(i);
      const c = { ray, handed: null, model: null };
      ray.addEventListener('connected', (e) => {
        c.handed = e.data.handedness;
        if (!c.model) { c.model = gauntlet(c.handed === 'left' ? [0.3, 0.8, 1.0] : [1.0, 0.7, 0.3]); ray.add(c.model); }
        c.model.visible = true;
      });
      ray.addEventListener('disconnected', () => { c.handed = null; if (c.model) c.model.visible = false; });
      rig.add(ray);
      return c;
    });

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this._keyEdges.push(e.code);
      if (e.code === 'Space') e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    dom.addEventListener('mousedown', (e) => {
      if (this.xr || !this.desktopActive) return;
      if (document.pointerLockElement !== dom) dom.requestPointerLock?.();
      else if (e.button === 0) this.mouseGrip = true;
    });
    addEventListener('mouseup', () => { this.mouseGrip = false; });
    addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== dom) return;
      this.yaw -= e.movementX * 0.0022;
      this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch - e.movementY * 0.0022));
    });
  }

  pulse(hand, strength = 0.5, ms = 40) {
    try { hand.pad?.hapticActuators?.[0]?.pulse(strength, ms); } catch { /* haptics are optional */ }
  }

  frame() {
    this.turnEdge = 0; this.actEdge = false;
    this.move.set(0, 0); this.lift = 0;
    for (const h of [this.left, this.right]) { h.trigger = 0; h.grip = 0; h.active = false; h.pad = null; }
    const session = this.renderer.xr.getSession();
    this.xr = !!session && this.renderer.xr.isPresenting;
    if (this.xr) this.frameXR(session); else this.frameDesktop();
    this._keyEdges.length = 0;
    if (this.debug) {
      const d = this.debug;
      if (d.dir) this.right.dir.copy(d.dir).normalize();
      if (d.trigger !== undefined) this.right.trigger = d.trigger;
      if (d.grip !== undefined) this.right.grip = d.grip;
      if (d.act) { this.actEdge = true; d.act = false; }
    }
  }

  frameXR(session) {
    let turn = 0, act = false;
    let i = 0;
    for (const src of session.inputSources) {
      const c = this.ctrl[i++];
      if (!c || !src.gamepad || (src.handedness !== 'left' && src.handedness !== 'right')) continue;
      const h = src.handedness === 'left' ? this.left : this.right;
      const gp = src.gamepad;
      h.active = true; h.pad = gp;
      h.trigger = gp.buttons[0]?.value || 0;
      h.grip = gp.buttons[1]?.value || 0;
      c.ray.getWorldPosition(h.pos);
      h.dir.set(0, 0, -1).applyQuaternion(c.ray.getWorldQuaternion(new THREE.Quaternion()));
      const ax = gp.axes.length >= 4 ? gp.axes[2] : gp.axes[0] || 0;
      const ay = gp.axes.length >= 4 ? gp.axes[3] : gp.axes[1] || 0;
      if (src.handedness === 'left') {
        if (Math.hypot(ax, ay) > 0.15) this.move.set(ax, -ay);
      } else {
        if (Math.abs(ax) > 0.6) turn = Math.sign(ax);
        if (Math.abs(ay) > 0.5) this.lift = -ay;
      }
      if (gp.buttons[4]?.pressed || gp.buttons[5]?.pressed) act = true;
      if (c.model) c.model.userData.orb.scale.setScalar(0.5 + h.trigger * 0.5 + h.grip * 0.4);
    }
    if (turn && !this._turnHeld) this.turnEdge = turn;
    this._turnHeld = !!turn;
    if (act && !this._actHeld) this.actEdge = true;
    this._actHeld = act;
  }

  frameDesktop() {
    const k = this.keys, cam = this.camera;
    cam.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    cam.position.set(0, 1.7, 0);
    cam.updateMatrixWorld(true);
    const h = this.right;
    h.active = true;
    cam.getWorldDirection(h.dir);
    h.pos.set(0.25, -0.25, -0.5).applyMatrix4(cam.matrixWorld);
    this.left.pos.set(-0.25, -0.25, -0.5).applyMatrix4(cam.matrixWorld);
    this.left.dir.copy(h.dir);
    h.trigger = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    if (k.has('ShiftLeft') || k.has('ShiftRight')) h.trigger *= 0.25;
    this.move.x = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    this.lift = (k.has('Space') ? 1 : 0) - (k.has('KeyC') ? 1 : 0);
    h.grip = k.has('KeyE') || this.mouseGrip ? 1 : 0;
    for (const code of this._keyEdges) if (code === 'KeyF' || code === 'Enter') this.actEdge = true;
  }
}
