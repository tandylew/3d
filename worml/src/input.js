// Unified input: Meta Quest Touch controllers in VR, mouse + keyboard on
// desktop, and an on-screen stick + buttons on phones and tablets.
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
    // Touch state, written by touch.js (virtual stick + on-screen buttons).
    this.touch = { on: false, move: new THREE.Vector2(), look: new THREE.Vector2(), cast: 0, time: false, cycle: false, jump: false, hud: false };
    // Actions (edges are true for one frame)
    this.flyMode = false;                 // flat screens: stick/W flies where you look, and you hover
    this.cast = false;                    // elemental power, held
    this.timeEdge = false; this.cycleEdge = false; this.jumpEdge = false; this.hudEdge = false; this.flyEdge = false;
    this.select = -1;                     // direct time-relic choice (keys 1-4)
    this._held = {}; this._mouse = [false, false, false]; this._wheel = 0;
    this.dragLook = false; // dev dashboard: drag the view with the mouse instead of locking the pointer
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
      if (e.code === 'Space' || e.code === 'Tab') e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    dom.addEventListener('mousedown', (e) => {
      if (this.xr || !this.desktopActive || this.touch.on) return;
      if (this.dragLook) { this._drag = true; return; }
      if (document.pointerLockElement !== dom) dom.requestPointerLock?.();
      else { this._mouse[e.button] = true; if (e.button === 2) this._keyEdges.push('Mouse2'); }
    });
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    dom.addEventListener('wheel', (e) => { if (document.pointerLockElement === dom) this._wheel += Math.sign(e.deltaY); }, { passive: true });
    addEventListener('mouseup', (e) => { this._mouse[e.button] = false; this._drag = false; });
    addEventListener('mousemove', (e) => {
      const locked = document.pointerLockElement === dom;
      if (!locked && !this._drag) return;
      this.look(e.movementX * (locked ? 0.0022 : -0.004), e.movementY * (locked ? 0.0022 : -0.004));
    });
  }

  look(dx, dy) {
    this.yaw -= dx;
    this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch - dy));
  }

  pulse(hand, strength = 0.5, ms = 40) {
    try { hand.pad?.hapticActuators?.[0]?.pulse(strength, ms); } catch { /* haptics are optional */ }
  }

  edge(name, down) {
    const was = this._held[name]; this._held[name] = down;
    return down && !was;
  }

  frame(dt = 1 / 60) {
    this.turnEdge = 0; this.actEdge = false;
    this.timeEdge = this.cycleEdge = this.jumpEdge = this.hudEdge = this.flyEdge = false; this.cast = false; this.select = -1;
    this.move.set(0, 0); this.lift = 0;
    for (const h of [this.left, this.right]) { h.trigger = 0; h.grip = 0; h.active = false; h.pad = null; }
    const session = this.renderer.xr.getSession();
    this.xr = !!session && this.renderer.xr.isPresenting;
    if (this.xr) this.frameXR(session); else this.frameDesktop(dt);
    this._keyEdges.length = 0; this._wheel = 0;
    if (this.debug) {
      const d = this.debug;
      if (d.dir) this.right.dir.copy(d.dir).normalize();
      if (d.trigger !== undefined) this.right.trigger = d.trigger;
      if (d.move) this.move.copy(d.move);
      if (d.lift !== undefined) this.lift = d.lift;
      if (d.cast) this.cast = true;
      if (d.time) { this.timeEdge = true; d.time = false; }
      if (d.jump) { this.jumpEdge = true; d.jump = false; }
      if (d.cycle) { this.cycleEdge = true; d.cycle = false; }
      if (d.fly !== undefined) this.flyMode = d.fly;
    }
    if (this.flyEdge) this.flyMode = !this.flyMode;
  }

  frameXR(session) {
    let turn = 0;
    let i = 0;
    const b = (gp, n) => !!gp.buttons[n]?.pressed;
    for (const src of session.inputSources) {
      const c = this.ctrl[i++];
      if (!c || !src.gamepad || (src.handedness !== 'left' && src.handedness !== 'right')) continue;
      const left = src.handedness === 'left', h = left ? this.left : this.right;
      const gp = src.gamepad;
      h.active = true; h.pad = gp;
      h.trigger = gp.buttons[0]?.value || 0;
      h.grip = gp.buttons[1]?.value || 0;
      c.ray.getWorldPosition(h.pos);
      h.dir.set(0, 0, -1).applyQuaternion(c.ray.getWorldQuaternion(new THREE.Quaternion()));
      const ax = gp.axes.length >= 4 ? gp.axes[2] : gp.axes[0] || 0;
      const ay = gp.axes.length >= 4 ? gp.axes[3] : gp.axes[1] || 0;
      if (left) {
        if (Math.hypot(ax, ay) > 0.15) this.move.set(ax, -ay);
        // left hand: grip uses the time relic, X leaps, Y shows the objectives
        if (this.edge('lg', h.grip > 0.6)) this.timeEdge = true;
        if (this.edge('lx', b(gp, 4))) this.jumpEdge = true;
        if (this.edge('ly', b(gp, 5))) this.hudEdge = true;
      } else {
        if (Math.abs(ax) > 0.6) turn = Math.sign(ax);
        if (Math.abs(ay) > 0.5) this.lift = -ay;
        // right hand: grip casts your element where it points, A leaps, B switches relic
        if (h.grip > 0.6) this.cast = true;
        if (this.edge('ra', b(gp, 4))) this.jumpEdge = true;
        if (this.edge('rb', b(gp, 5))) this.cycleEdge = true;
      }
      if (c.model) c.model.userData.orb.scale.setScalar(0.5 + h.trigger * 0.5 + h.grip * 0.4);
    }
    if (turn && !this._turnHeld) this.turnEdge = turn;
    this._turnHeld = !!turn;
  }

  frameDesktop(dt) {
    const k = this.keys, cam = this.camera, t = this.touch;
    if (t.on) this.look(t.look.x * Math.abs(t.look.x) * 2.6 * dt, -t.look.y * Math.abs(t.look.y) * 1.9 * dt);
    cam.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    cam.position.set(0, 1.7, 0);
    cam.updateMatrixWorld(true);
    const h = this.right;
    h.active = true;
    cam.getWorldDirection(h.dir);
    h.pos.set(0.25, -0.25, -0.5).applyMatrix4(cam.matrixWorld);
    this.left.pos.set(-0.25, -0.25, -0.5).applyMatrix4(cam.matrixWorld);
    this.left.dir.copy(h.dir);
    let fwd = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    if (k.has('ShiftLeft') || k.has('ShiftRight')) fwd *= 0.25;
    fwd = Math.max(-1, Math.min(1, fwd + (t.on ? t.move.y : 0)));
    // Fly mode: forward means "along where I look", at the full speed limit.
    if (this.flyMode) h.trigger = fwd; else this.move.y = fwd;
    this.move.x = Math.max(-1, Math.min(1, (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0) + (t.on ? t.move.x : 0)));
    this.lift = (k.has('KeyR') ? 1 : 0) - (k.has('KeyC') ? 1 : 0);
    this.cast = this._mouse[0] || k.has('KeyX') || (t.on && !!t.cast);
    for (const code of this._keyEdges) {
      if (code === 'Space') this.jumpEdge = true;
      else if (code === 'KeyF') this.flyEdge = true;
      else if (code === 'KeyE' || code === 'Mouse2') this.timeEdge = true;
      else if (code === 'KeyQ') this.cycleEdge = true;
      else if (code === 'KeyH' || code === 'Tab') this.hudEdge = true;
      else if (/^Digit[1-4]$/.test(code)) this.select = Number(code[5]) - 1;
    }
    if (this._wheel) this.cycleEdge = true;
    if (t.on) {
      if (t.time) { this.timeEdge = true; t.time = false; }
      if (t.cycle) { this.cycleEdge = true; t.cycle = false; }
      if (t.jump) { this.jumpEdge = true; t.jump = false; }
      if (t.hud) { this.hudEdge = true; t.hud = false; }
    }
  }
}
