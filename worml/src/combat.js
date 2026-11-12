// Guardians, bolts and drops. Each world's essence deposits are watched by
// creatures made of that world's element. They are articulated: a torso and
// head carried on jointed legs that step over the ground (two-bone IK, feet
// planted and re-planted in alternating groups). They patrol, run you down,
// crouch and pounce, rear up to spit, and sidestep bolts they see coming.
// When you take to the air they launch after you, legs trailing, and they
// will follow across open space; only a wormhole shakes them.
import * as THREE from 'three';
import { ELEMENTS, WEAK_TO, groundHeight } from './worlds.js';
import { Builder, propMaterial, glowMaterial } from './gfx.js';
import { mulberry32 } from './noise.js';

const MAXE = 44, MAXB = 96, MAX_PURSUERS = 6, MAXL = 6;
const L1 = 1.25, L2 = 1.45, BODY_H = 1.55;
const TAU = Math.PI * 2;
const m4 = new THREE.Matrix4(), q1 = new THREE.Quaternion(), v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3();
const sc = new THREE.Vector3(), col = new THREE.Color(), UPV = new THREE.Vector3();
const F = new THREE.Vector3(), Rv = new THREE.Vector3(), hip = new THREE.Vector3(), knee = new THREE.Vector3(), rest = new THREE.Vector3(), bend = new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0);

// Bodies face +Z and are about 1.4 m across.
const BODIES = {
  water() {   // Tidewraith: a smooth dark bell trailing ribbons
    const b = new Builder();
    b.blob(1.15, [0.1, 0.3, 0.36], 0, 0, 0.2, 0, { detail: 2, rough: 0.2, sy: 0.85, seed: 1, color2: [0.2, 0.5, 0.55], under: 0.2 });
    for (let i = 0; i < 9; i++) b.frond(Math.cos(i * 0.7) * 0.6, -0.4, Math.sin(i * 0.7) * 0.6, i * 0.7, 0.5, 0.12, -0.4, 2.2 + (i % 3) * 0.5, [0.18, 0.5, 0.55], 5);
    return b.build();
  },
  fire() {    // Cinder: clinker shell split by glowing seams
    const b = new Builder();
    b.blob(1.2, [0.1, 0.085, 0.08], 0, 0, 0, 0, { detail: 2, rough: 0.7, seed: 2, ridged: true });
    b.blob(0.95, [1.0, 0.4, 0.08], 0.7, 0, 0, 0, { detail: 1, rough: 0.2, seed: 3 });
    for (let i = 0; i < 5; i++) b.blob(0.45, [0.12, 0.1, 0.09], 0, Math.cos(i * 1.257) * 1.5, Math.sin(i * 2.1) * 0.6, Math.sin(i * 1.257) * 1.5, { detail: 1, rough: 0.7, seed: 4 + i, ridged: true });
    return b.build();
  },
  metal() {   // Sentinel: interlocked cubes of ore
    const b = new Builder();
    b.add(new THREE.BoxGeometry(1.5, 1.5, 1.5), [0.5, 0.51, 0.55], 0, 0, 0, 0, 1, 1, 1, 0.6, 0.6, 0);
    b.add(new THREE.BoxGeometry(1.1, 1.1, 1.1), [0.6, 0.56, 0.44], 0, 0.5, 0.5, -0.3, 1, 1, 1, 0.2, 0.3, 0.5);
    b.add(new THREE.BoxGeometry(0.9, 0.9, 0.9), [0.42, 0.26, 0.18], 0, -0.7, -0.3, 0.1, 1, 1, 1, 0.8, 0.1, 0.3);
    for (let i = 0; i < 4; i++) b.add(new THREE.BoxGeometry(0.4, 0.4, 0.4), [0.55, 0.56, 0.6], 0, Math.cos(i * 1.57) * 1.6, 0.2 * (i % 2 ? 1 : -1), Math.sin(i * 1.57) * 1.6, 1, 1, 1, i, i * 0.5, 0);
    return b.build();
  },
  wood() {    // Thornling: a seed pod bristling with thorns
    const b = new Builder();
    b.blob(1.0, [0.26, 0.2, 0.12], 0, 0, 0, 0, { detail: 2, rough: 0.3, seed: 5, color2: [0.2, 0.3, 0.12] });
    for (let i = 0; i < 16; i++) {
      const y = 1 - (2 * (i + 0.5)) / 16, r = Math.sqrt(1 - y * y), a = i * 2.4;
      b.spike(0.16, 1.1, 5, [0.5, 0.52, 0.42], 0, Math.cos(a) * r * 0.85, y * 0.85 - 0.0, Math.sin(a) * r * 0.85, -a, Math.acos(y));
    }
    return b.build();
  },
  earth() {   // Golem: stacked sandstone
    const b = new Builder(), a = [0.62, 0.4, 0.26], c = [0.76, 0.58, 0.4];
    b.blob(1.1, a, 0, 0, 0, 0, { detail: 2, rough: 0.4, seed: 6, color2: c });
    b.blob(0.6, c, 0, 0, 1.15, 0.1, { detail: 1, rough: 0.4, seed: 7, color2: a });
    b.blob(0.55, a, 0, 1.3, -0.1, 0.2, { detail: 1, rough: 0.5, seed: 8 });
    b.blob(0.55, a, 0, -1.3, -0.1, 0.2, { detail: 1, rough: 0.5, seed: 9 });
    return b.build();
  },
  magic() {   // Shade: a dark core in a crown of crystal
    const b = new Builder();
    b.blob(0.8, [0.1, 0.06, 0.16], 0, 0, 0, 0, { detail: 2, rough: 0.3, seed: 10 });
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * TAU, g = new THREE.ConeGeometry(0.22, 1.5, 6).translate(0, 0.75, 0);
      b.add(g, [0.5, 0.36, 0.7], 0.25, Math.cos(a) * 0.6, Math.sin(a) * 0.6, 0, 1, 1, 1, 0, 0, a - Math.PI / 2, true);
    }
    return b.build();
  },
};

// legs: how many; limb: colour of the legs; striker: closes in and pounces (others keep range and spit)
const STATS = {
  water: { hp: 55, dmg: 6, aggro: 32, n: 2, legs: 6, limb: [0.16, 0.42, 0.46], thick: 0.7 },
  fire: { hp: 90, dmg: 9, aggro: 75, n: 3, legs: 4, limb: [0.13, 0.1, 0.09], thick: 1.2 },
  metal: { hp: 120, dmg: 9, aggro: 70, n: 3, legs: 4, limb: [0.5, 0.5, 0.54], thick: 1.0 },
  wood: { hp: 90, dmg: 9, aggro: 80, n: 4, legs: 6, limb: [0.3, 0.24, 0.14], thick: 0.8 },
  earth: { hp: 140, dmg: 10, aggro: 70, n: 3, legs: 4, limb: [0.62, 0.42, 0.28], thick: 1.6 },
  magic: { hp: 120, dmg: 12, aggro: 90, n: 5, legs: 4, limb: [0.42, 0.3, 0.6], thick: 0.8 },
};

function limbGeometry(color) {
  const b = new Builder();
  b.add(new THREE.CylinderGeometry(0.07, 0.13, 1, 6).translate(0, 0.5, 0), color, 0);
  b.add(new THREE.SphereGeometry(0.15, 8, 6), color.map((c) => c * 0.7), 0);
  return b.build();
}

function headGeometry(color) {
  const b = new Builder();
  b.blob(0.42, color, 0, 0, 0, 0, { detail: 1, rough: 0.25, sz: 1.3, seed: 77 });
  b.spike(0.09, 0.5, 5, color.map((c) => c * 1.3), 0, 0.22, 0.2, -0.1, 0, -0.5);
  b.spike(0.09, 0.5, 5, color.map((c) => c * 1.3), 0, -0.22, 0.2, -0.1, 0, 0.5);
  return b.build();
}

export class Combat {
  constructor(game, scene) {
    this.game = game;
    this.enemies = []; this.bolts = []; this.drops = [];
    this.planet = null; this.rnd = mulberry32(4711); this.nextId = 1;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.bodies = {}; this.limbs = {}; this.heads = {};
    this.eyes = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), glowMaterial([1, 1, 1], 1.4, 1.6), MAXE);
    this.eyes.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAXE * 3), 3);
    this.bars = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ toneMapped: false, depthWrite: false, transparent: true, opacity: 0.9 }), MAXE);
    this.bars.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAXE * 3), 3);
    this.orbs = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), glowMaterial([1, 1, 1], 1.5, 1.8), MAXB);
    this.orbs.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAXB * 3), 3);
    for (const m of [this.eyes, this.bars, this.orbs]) { m.frustumCulled = false; m.count = 0; m.renderOrder = 6; this.group.add(m); }
  }

  parts(el) {
    if (!this.bodies[el]) {
      const st = STATS[el], shine = el === 'metal' || el === 'magic' ? 0.8 : 0.2;
      const mk = (geo, n) => { const m = new THREE.InstancedMesh(geo, propMaterial(shine, { grain: 0.6, material: { side: THREE.DoubleSide } }), n); m.frustumCulled = false; m.count = 0; this.group.add(m); return m; };
      this.bodies[el] = mk(BODIES[el](), MAXE);
      this.limbs[el] = mk(limbGeometry(st.limb), MAXE * MAXL * 2);
      this.heads[el] = mk(headGeometry(st.limb.map((c) => c * 1.15)), MAXE);
    }
    return this.bodies[el];
  }

  // ------------------------------------------------------------ population
  // Called when the nearest world changes. Guards of the old world go home
  // unless they are already after you; the new world's guards take up posts.
  setPlanet(planet) {
    this.enemies = this.enemies.filter((e) => e.state === 'pursue' || e.state === 'chase' || e.state === 'rewind');
    for (const e of this.enemies) e.foreign = e.planet !== planet;
    this.planet = planet;
    if (!planet) return;
    const def = planet.def, st = STATS[def.element], field = this.game.fields.get(def.id);
    for (const d of field.deposits) {
      for (let k = 0; k < st.n; k++) {
        if (this.enemies.some((e) => e.planet === planet && e.dep === d.index && e.slot === k)) continue;
        const e = {
          id: this.nextId++, el: def.element, planet, dep: d.index, slot: k, nest: d.pos.clone(), st,
          pos: new THREE.Vector3(), vel: new THREE.Vector3(), fwd: new THREE.Vector3(1, 0, 0), head: new THREE.Vector3(),
          hp: st.hp, max: st.hp, dmg: st.dmg, aggro: st.aggro, striker: k % 2 === 0,
          state: 'idle', act: 'run', actT: 0, air: false, h: BODY_H, vy: 0, pitch: 0,
          cool: 1 + this.rnd() * 2, cool2: 2 + this.rnd() * 3, dodgeCool: 0, phase: (k / st.n) * TAU + d.index, hist: [], histT: 0,
          stun: 0, root: 0, burn: 0, slow: 0, pacify: 0, flash: 0, foreign: false, rew: 0, dead: 0, age: 0, near: false,
          legs: Array.from({ length: st.legs }, (_, i) => ({ side: i % 2 ? 1 : -1, fz: (Math.floor(i / 2) / Math.max(1, st.legs / 2 - 1) - 0.5) * 1.5, foot: new THREE.Vector3(), from: new THREE.Vector3(), t: 1, set: false })),
        };
        this.post(e, 0, false);
        this.enemies.push(e);
      }
    }
  }

  // An idle guardian patrols a ring round its deposit. With `walk` it is set
  // down on the actual ground; far-off posts skip that cost.
  post(e, time, walk) {
    const a = e.phase + time * 0.11, r = 17 + (e.slot % 3) * 6;
    const up = v3.copy(e.nest).normalize();
    v1.set(-up.y, up.x, 0); if (v1.lengthSq() < 0.01) v1.set(0, -up.z, up.y); v1.normalize();
    v2.crossVectors(up, v1);
    e.pos.copy(e.nest).addScaledVector(v1, Math.cos(a) * r).addScaledVector(v2, Math.sin(a) * r);
    e.fwd.copy(v1).multiplyScalar(-Math.sin(a)).addScaledVector(v2, Math.cos(a)).normalize();
    if (walk) {
      UPV.copy(e.pos).normalize();
      const def = e.planet.def;
      e.pos.copy(UPV).multiplyScalar(def.radius + groundHeight(def, UPV.x, UPV.y, UPV.z) + BODY_H);
    } else e.pos.addScaledVector(up, 3);
    e.pos.add(e.planet.pos);
    e.h = BODY_H; e.air = false; e.act = 'run';
  }

  // Wormholes shake pursuit: strangers vanish, locals drift back to their posts.
  dropPursuit() {
    this.enemies = this.enemies.filter((e) => !e.foreign);
    for (const e of this.enemies) if (e.state !== 'idle' && e.state !== 'dead') { e.state = 'idle'; e.pacify = 6; this.post(e, 0, false); for (const l of e.legs) l.set = false; }
    this.bolts.length = 0;
  }

  get hunting() { let n = 0; for (const e of this.enemies) if (e.state === 'chase' || e.state === 'pursue') n++; return n; }
  get pursuing() { let n = 0; for (const e of this.enemies) if (e.state === 'pursue') n++; return n; }

  // ---------------------------------------------------------------- attacks
  // origin/dir in solar coordinates. power: { dmg, speed, size, perfect }
  castPlayer(origin, dir, el, power = {}, fromEcho = false) {
    const rgb = power.perfect ? ELEMENTS[el].rgb.map((c) => c * 0.6 + 0.4) : ELEMENTS[el].rgb;
    this.bolts.push({ pos: origin.clone(), vel: dir.clone().multiplyScalar(power.speed || 120).add(this.game.player.vel), life: 2.4, from: 'player', el, rgb,
      size: power.size || 0.36, dmg: power.dmg || 24, perfect: !!power.perfect, echo: fromEcho, warned: false });
  }

  spark(pos, rgb, n = 6, speed = 9) {
    for (let i = 0; i < n && this.bolts.length < MAXB - 8; i++) {
      v1.set(this.rnd() - 0.5, this.rnd() - 0.5, this.rnd() - 0.5).normalize().multiplyScalar(speed * (0.4 + this.rnd()));
      this.bolts.push({ pos: pos.clone(), vel: v1.clone(), life: 0.25 + this.rnd() * 0.35, from: 'fx', rgb, size: 0.2 });
    }
  }

  // Returns the total multiplier applied (element x eye strike).
  damage(e, amount, el = null, eye = false) {
    if (e.state === 'dead' || e.state === 'rewind') return 0;
    let mult = eye ? 1.6 : 1;
    if (el) {
      mult *= e.el === 'magic' ? 1.4 : WEAK_TO[e.el] === el ? 2.5 : el === e.el ? 0.6 : 1;
      if (el === 'water') e.slow = 3; else if (el === 'fire') e.burn = 3; else if (el === 'wood') e.root = 1.6;
      else if (el === 'earth') { e.stun = 0.8; e.vel.addScaledVector(v1.copy(e.pos).sub(this.game.player.pos).normalize(), 18); }
      else if (el === 'metal') mult *= 1.25;
    }
    const d = amount * mult;
    e.hp -= d; e.flash = 1; e.pacify = 0;
    if (e.state === 'idle') { e.state = 'chase'; e.act = 'run'; }
    if (e.hp <= 0) this.kill(e);
    return mult;
  }

  kill(e) {
    e.state = 'dead'; e.dead = 0.6;
    this.spark(e.pos, ELEMENTS[e.el].rgb, 14, 14);
    this.drops.push({ pos: e.pos.clone(), el: e.el, t: 0 });
    this.game.audio.tone(140, 0.5, 'sawtooth', 0.14, 0, 0.3);
    this.game.onKill(e);
  }

  // The Rewinder: nearest live guardian close to a ray. origin solar, dir unit.
  rayPick(origin, dir, range) {
    let best = null, bt = range;
    for (const e of this.enemies) {
      if (e.state === 'dead' || e.state === 'rewind') continue;
      v1.copy(e.pos).sub(origin);
      const t = v1.dot(dir);
      if (t < 0 || t > bt) continue;
      if (v1.addScaledVector(dir, -t).length() < 2.6 + t * 0.03) { best = e; bt = t; }
    }
    return best ? { enemy: best, t: bt } : null;
  }

  rewind(e) { e.state = 'rewind'; e.rew = 4; e.stun = e.root = e.burn = 0; this.spark(e.pos, [1, 0.75, 0.35], 8, 6); }

  inRadius(pos, r, fn) { for (const e of this.enemies) if (e.state !== 'dead' && e.pos.distanceTo(pos) < r) fn(e); }

  setAct(e, act, t) { e.act = act; e.actT = t; }

  // ----------------------------------------------------------------- frame
  // dt: world time (slowed or frozen by relics). raw: the player's own time.
  // wt: the world clock, which slows and stops with dt.
  update(dt, raw, wt) {
    const g = this.game, pl = g.player, P = pl.planet;
    if (P !== this.planet) this.setPlanet(P);
    const target = g.targetPos().clone();        // solar: the head, or the echo standing in for it
    const head = g.headSolar;
    let pursuers = this.pursuing;
    // how high the target is above the ground: guardians run while you are low, fly when you are not
    const tAlt = pl.inside ? 0 : pl.alt + 1.5;

    for (const e of this.enemies) {
      e.age += dt; e.flash = Math.max(0, e.flash - raw * 4);
      if (e.state === 'dead') { e.dead -= raw; continue; }
      const dist = e.pos.distanceTo(target);
      e.near = dist < 420;
      if (e.state === 'idle') {
        if (e.pacify > 0) e.pacify -= dt;
        if (!e.near) { if (!e.foreign) this.post(e, wt, false); for (const l of e.legs) l.set = false; continue; }
        // walk the patrol ring
        v2.copy(e.pos); this.post(e, wt, true); v1.copy(e.pos).sub(v2);
        const step = Math.min(v1.length(), 9 * dt);
        e.vel.copy(v1).setLength(dt > 0 ? step / dt : 0);
        e.pos.copy(v2); if (step > 0) e.pos.addScaledVector(v1.normalize(), step);
        if (e.pacify <= 0 && dist < e.aggro && !g.dead && !pl.inside) { e.state = 'chase'; e.act = 'run'; g.onAggro(e); }
        this.legs(e, dt, wt);
        continue;
      }
      if (e.state === 'rewind') {
        // retrace its own path at speed; strangers unravel all the way home
        e.rew -= raw;
        for (let k = 0; k < 3 && e.hist.length; k++) { const h = e.hist[e.hist.length - 1]; e.pos.lerp(h, 0.6); if (e.pos.distanceTo(h) < 1) e.hist.pop(); }
        e.air = true; this.legs(e, raw, wt);
        if (e.rew <= 0 || !e.hist.length) {
          this.spark(e.pos, [1, 0.75, 0.35], 8, 6);
          if (e.foreign) { e.state = 'dead'; e.dead = 0; } else { e.state = 'idle'; e.hp = e.max; e.pacify = 30; }
        }
        continue;
      }
      // ---- chase (near you) or pursue (across space)
      if (e.burn > 0) { e.burn -= dt; e.hp -= 8 * dt; if (e.hp <= 0) { this.kill(e); continue; } }
      e.stun -= dt; e.root -= dt; e.slow -= dt; e.cool -= dt; e.cool2 -= dt; e.dodgeCool -= dt;
      e.histT -= dt;
      if (e.histT <= 0) { e.histT = 0.2; e.hist.push(e.pos.clone()); if (e.hist.length > 70) e.hist.shift(); }
      if (g.dead || (pl.inside && e.state === 'chase' && dist > 60)) { e.state = 'idle'; e.pacify = 8; if (e.foreign) { e.state = 'dead'; e.dead = 0; } continue; }
      const far = dist > 150;
      if (e.state === 'chase' && far) {
        if (pursuers < MAX_PURSUERS) { e.state = 'pursue'; pursuers++; g.onPursue(e); }
        else { e.state = 'idle'; e.pacify = 10; if (e.foreign) { e.state = 'dead'; e.dead = 0; } continue; }
      } else if (e.state === 'pursue' && dist < 110) { e.state = 'chase'; e.act = 'run'; }
      if (e.state === 'pursue' && (e.age > 600 || dist > 6e6)) { e.state = 'dead'; e.dead = 0; continue; }

      // altitude above the nearest world sets its speed, exactly as it does yours
      let near = P, alt = Infinity;
      for (const p of g.planets) { const a = e.pos.distanceTo(p.pos) - p.def.radius; if (a < alt) { alt = a; near = p; } }
      UPV.copy(e.pos).sub(near.pos); const er = UPV.length(); UPV.divideScalar(er);
      const groundR = alt < 500 ? near.def.radius + groundHeight(near.def, UPV.x, UPV.y, UPV.z) : -1e9;
      const above = er - groundR;                        // its own height over the ground
      const mob = (e.slow > 0 ? 0.4 : 1) * (e.stun > 0 || e.root > 0 ? 0 : 1);
      const wantAir = e.state === 'pursue' || tAlt > 7 || above > 40;
      if (wantAir) { e.air = true; if (e.act !== 'windup') e.act = 'run'; }
      else if (e.air && above < BODY_H + 1.5) { e.air = false; e.h = Math.max(BODY_H, above); e.vy = 0; }   // touch down

      v1.copy(target).sub(e.pos);
      if (e.air) {
        // ---- airborne: legs trailing, ring round you, or run you down across space
        if (e.state === 'chase') {
          const a = e.phase + wt * 0.35;
          v2.set(-UPV.y, UPV.x, 0); if (v2.lengthSq() < 0.01) v2.set(0, -UPV.z, UPV.y); v2.normalize();
          v1.addScaledVector(v2, Math.cos(a) * 13).addScaledVector(v3.crossVectors(UPV, v2), Math.sin(a) * 13).addScaledVector(UPV, 3.5);
        }
        const d = v1.length();
        const speed = (e.state === 'chase' ? Math.min(17, d * 1.5) : Math.min(22 + 0.72 * Math.max(0, alt), d * 1.2 + 12)) * mob;
        v1.divideScalar(d || 1);
        const inward = v1.dot(UPV), R = near.def.radius;
        if (inward < 0 && alt < R * 0.4 && d > R * 0.5) v1.addScaledVector(UPV, -inward).normalize();   // skim round a world, don't dive through it
        e.vel.lerp(v1.multiplyScalar(speed), 1 - Math.exp(-dt * 3));
        e.pos.addScaledVector(e.vel, dt);
        if (alt < 400) {
          v1.copy(e.pos).sub(near.pos);
          const r = v1.length(); UPV.copy(v1).divideScalar(r);
          const floor = near.def.radius + groundHeight(near.def, UPV.x, UPV.y, UPV.z) + 3.2;
          if (r < floor) e.pos.copy(near.pos).addScaledVector(UPV, floor);
        }
        v1.copy(target).sub(e.pos).normalize();
        e.fwd.lerp(v1, Math.min(1, dt * 5)).normalize();
        e.pitch += (0 - e.pitch) * Math.min(1, dt * 6);
        if (e.act === 'windup') { e.actT -= dt; if (e.actT <= 0) { this.spit(e, target); e.act = 'run'; } }
        else if (e.state === 'chase' && dist < 55 && e.cool <= 0 && e.stun <= 0) this.setAct(e, 'windup', 0.5);
      } else {
        // ---- on the ground: run, strafe, crouch, pounce, rear up, sidestep
        v1.addScaledVector(UPV, -v1.dot(UPV));              // flat direction to the target
        const d = v1.length(); v1.divideScalar(d || 1);
        v2.crossVectors(UPV, v1);                            // strafe axis
        let want = 0, strafe = 0, face = v1;
        e.actT -= dt;
        if (e.act === 'run') {
          if (e.striker) { want = d > 6 ? 13 : 0; strafe = Math.sin(wt * 1.3 + e.phase) * 4; }
          else { want = d > 26 ? 10 : d < 16 ? -7 : 0; strafe = (e.slot % 4 < 2 ? 1 : -1) * 6; }
          if (e.striker && d > 6 && d < 19 && e.cool2 <= 0 && mob > 0.5) this.setAct(e, 'crouch', 0.38);
          else if (!e.striker && d < 48 && e.cool <= 0 && mob > 0) this.setAct(e, 'windup', 0.55);
          else if (e.striker && d < 48 && d > 22 && e.cool <= 0 && mob > 0) this.setAct(e, 'windup', 0.55);
        } else if (e.act === 'crouch') {
          if (e.actT <= 0) {            // spring
            e.act = 'pounce'; e.actT = 1.4; e.hit = false;
            const T = Math.max(0.45, Math.min(0.8, d / 22));
            e.vel.copy(v1).multiplyScalar(d / T); e.vy = 0.5 * 24 * T + (tAlt - 1.5) / T;
            g.audio.tone(210, 0.2, 'sawtooth', 0.06, 0, 2);
          }
        } else if (e.act === 'pounce') {
          want = null;
          e.vy -= 24 * dt; e.h += e.vy * dt;
          if (!e.hit && dist < 2.4) { e.hit = true; if (!g.decoyActive()) g.hurt(Math.round(e.dmg * 1.6)); this.spark(e.pos, ELEMENTS[e.el].rgb, 6); }
          if (e.h <= BODY_H && e.vy < 0) { e.h = BODY_H; e.vy = 0; e.cool2 = 3 + this.rnd() * 2.5; this.setAct(e, 'recover', 0.55); e.vel.multiplyScalar(0.2); }
        } else if (e.act === 'windup') {
          if (e.actT <= 0) { this.spit(e, target); this.setAct(e, 'recover', 0.3); }
        } else if (e.act === 'dodge') {
          want = null;
          if (e.actT <= 0) { e.act = 'run'; e.vel.multiplyScalar(0.3); }
        } else if (e.actT <= 0) e.act = 'run';             // recover
        if (want !== null) {
          v3.copy(v1).multiplyScalar(want).addScaledVector(v2, strafe).multiplyScalar(mob);
          if (e.act !== 'run') v3.set(0, 0, 0);
          e.vel.addScaledVector(UPV, -e.vel.dot(UPV)).lerp(v3, 1 - Math.exp(-dt * 5));
        }
        e.pos.addScaledVector(e.vel, dt);
        // ride height: low in a crouch, reared when winding up
        if (e.act !== 'pounce') e.h += ((e.act === 'crouch' ? 0.75 : e.act === 'recover' ? 1.1 : BODY_H) - e.h) * Math.min(1, dt * 12);
        e.pitch += ((e.act === 'windup' ? 0.6 : e.act === 'crouch' ? -0.25 : e.act === 'pounce' ? 0.3 : 0) - e.pitch) * Math.min(1, dt * 10);
        UPV.copy(e.pos).sub(near.pos).normalize();
        e.pos.copy(near.pos).addScaledVector(UPV, near.def.radius + groundHeight(near.def, UPV.x, UPV.y, UPV.z) + e.h);
        // heading: where it is going when it runs, at you when it is about to act
        const sp = e.vel.length();
        if (e.act === 'run' && sp > 2 && d > 20) face = v3.copy(e.vel).divideScalar(sp);
        e.fwd.lerp(face, Math.min(1, dt * 7)).addScaledVector(UPV, -e.fwd.dot(UPV)).normalize();
      }
      this.legs(e, dt, wt);
    }
    this.enemies = this.enemies.filter((e) => e.state !== 'dead' || e.dead > 0);

    // ---- bolts
    const seal = g.sealTarget();
    for (const b of this.bolts) {
      const step = b.from === 'enemy' ? dt : raw;
      b.life -= step;
      v1.copy(b.pos);
      b.pos.addScaledVector(b.vel, step);
      if (b.from === 'fx' || b.life <= 0) continue;
      if (b.from === 'player') {
        v2.copy(b.pos).sub(v1); const L = v2.length() || 1; v2.divideScalar(L);
        for (const e of this.enemies) {
          if (e.state === 'dead' || e.state === 'rewind' || b.hitId === e.id) continue;
          v3.copy(e.pos).sub(v1);
          const along = v3.dot(v2);
          // a guardian that sees a bolt coming may spring aside: only on the ground, only with time to react
          if (!b.warned && !e.air && e.state === 'chase' && e.act === 'run' && e.dodgeCool <= 0 && e.stun <= 0 && e.root <= 0 && along > 8 && along < 60
            && v3.clone().addScaledVector(v2, -along).length() < 2.5 && along / (b.vel.length() || 1) > 0.11 && dt > 0) {
            b.warned = true;
            if (this.rnd() < 0.55) {
              UPV.copy(e.pos).sub(P.pos).normalize();
              v3.crossVectors(UPV, v2).normalize().multiplyScalar((this.rnd() < 0.5 ? 1 : -1) * 26 * (e.slow > 0 ? 0.4 : 1));
              e.vel.copy(v3); e.dodgeCool = 2.2 + this.rnd(); this.setAct(e, 'dodge', 0.26);
            }
            v3.copy(e.pos).sub(v1);
          }
          const t = Math.max(0, Math.min(L, along));
          v3.copy(v1).addScaledVector(v2, t);
          const eye = v3.distanceTo(e.head) < 0.8 + b.size;
          if (eye || v3.distanceTo(e.pos) < 1.5 + b.size) {
            const mult = this.damage(e, b.dmg, b.el, eye);
            this.spark(b.pos, b.rgb, mult > 1.5 ? 10 : 5);
            g.onHit(e, mult, eye, b);
            if (b.perfect && !b.hitId) { b.hitId = e.id; b.dmg *= 0.6; } else b.life = 0;   // a perfect cast punches through once
            break;
          }
        }
        if (b.life > 0 && seal && b.pos.distanceTo(seal.pos) < seal.r) { b.life = 0; this.spark(b.pos, b.rgb, 10, 12); g.hitSeal(b.el, b.perfect); }
        // bolts splash on the ground
        if (b.life > 0 && !pl.inside && pl.alt < 3000) {
          v3.copy(b.pos).sub(P.pos); const r = v3.length(); v3.divideScalar(r);
          if (r < P.def.radius + groundHeight(P.def, v3.x, v3.y, v3.z) - 0.6) { b.life = 0; this.spark(b.pos, b.rgb, 4, 6); }
        }
      } else if (step > 0) {
        v2.copy(b.pos).sub(v1); const L = v2.length() || 1; v2.divideScalar(L);
        const t = Math.max(0, Math.min(L, v3.copy(target).sub(v1).dot(v2)));
        if (v3.copy(v1).addScaledVector(v2, t).distanceTo(target) < 1.0) {
          b.life = 0; this.spark(b.pos, b.rgb, 5);
          if (!g.decoyActive()) g.hurt(b.dmg);
        }
      }
    }
    this.bolts = this.bolts.filter((b) => b.life > 0);

    // ---- drops: essence freed from a fallen guardian drifts to you
    for (const d of this.drops) {
      d.t += raw;
      const dd = d.pos.distanceTo(head);
      if (dd < 40) d.pos.lerp(head, 1 - Math.exp(-raw * (dd < 6 ? 8 : 2.5)));
      if (dd < 1.2) { d.t = 1e9; g.gain(d.el, 1); }
    }
    this.drops = this.drops.filter((d) => d.t < 90);
    this.render(wt);
  }

  spit(e, target) {
    e.cool = 2.2 + this.rnd() * 1.4;
    v1.copy(target).sub(e.head).normalize();
    this.bolts.push({ pos: e.head.clone().addScaledVector(v1, 0.6), vel: v1.clone().multiplyScalar(34), life: 3, from: 'enemy', el: e.el, rgb: ELEMENTS[e.el].rgb, size: 0.34, dmg: e.dmg });
    this.game.audio.tone(320, 0.18, 'square', 0.05, 0, 0.5);
  }

  // Feet: each leg keeps its foot planted until the body has moved on, then
  // swings it to a new hold while the other group of legs bears the weight.
  legs(e, dt, wt) {
    if (!e.near) return;
    UPV.copy(e.pos).sub((e.foreign && this.planet ? this.planet : e.planet).pos).normalize();
    F.copy(e.fwd); Rv.crossVectors(UPV, F).normalize();
    const flying = e.air || e.act === 'pounce';
    const sp = e.vel.length(), stride = 0.75 + Math.min(1.1, sp * 0.07), swing = Math.max(0.09, 0.2 - sp * 0.006);
    let busy = [0, 0];
    for (let i = 0; i < e.legs.length; i++) if (e.legs[i].t < 1) busy[(i + (i >> 1)) & 1]++;
    for (let i = 0; i < e.legs.length; i++) {
      const l = e.legs[i], grp = (i + (i >> 1)) & 1;
      hip.copy(e.pos).addScaledVector(Rv, l.side * 0.5).addScaledVector(F, l.fz);
      if (flying) {
        // tucked and trailing, paddling a little
        rest.copy(hip).addScaledVector(F, -1.5).addScaledVector(Rv, l.side * 0.5).addScaledVector(UPV, -0.5 + Math.sin(wt * 7 + i * 1.3) * 0.25);
        if (!l.set) l.foot.copy(rest); else l.foot.lerp(rest, Math.min(1, dt * 10));
        l.t = 1; l.set = true;
        continue;
      }
      rest.copy(hip).addScaledVector(Rv, l.side * 1.0).addScaledVector(e.vel, 0.1);
      rest.addScaledVector(UPV, -(v1.copy(rest).sub(e.pos).dot(UPV) + e.h));     // down onto the ground plane under the body
      if (!l.set) { l.foot.copy(rest); l.set = true; l.t = 1; }
      if (l.t < 1) {
        l.t = Math.min(1, l.t + dt / swing);
        l.foot.lerpVectors(l.from, rest, l.t).addScaledVector(UPV, Math.sin(l.t * Math.PI) * 0.5);
      } else if (l.foot.distanceTo(rest) > stride && (busy[1 - grp] === 0 || l.foot.distanceTo(rest) > stride * 2.2)) {
        l.from.copy(l.foot); l.t = 0; busy[grp]++;
      }
    }
  }

  render(time) {
    const g = this.game, o = g.player.pos, camQ = g.camera.getWorldQuaternion(q1).clone();
    const counts = {}, lc = {}; let ne = 0, nb = 0, no = 0;
    for (const el in this.bodies) { counts[el] = 0; lc[el] = 0; }
    for (const e of this.enemies) {
      const mesh = this.parts(e.el), k = counts[e.el] = counts[e.el] || 0;
      lc[e.el] = lc[e.el] || 0;
      if (k >= MAXE) continue;
      v1.copy(e.pos).sub(o);
      if (v1.length() > 9000 && e.state === 'idle') continue;       // far posts aren't drawn
      UPV.copy(e.pos).sub((e.foreign && this.planet ? this.planet : e.planet).pos).normalize();
      F.copy(e.fwd).addScaledVector(UPV, e.pitch).normalize();
      m4.lookAt(F, v3.set(0, 0, 0), UPV); q1.setFromRotationMatrix(m4);
      const dying = e.state === 'dead' ? Math.max(0, e.dead / 0.6) : 1;
      const s = (1 + e.flash * 0.25) * dying * (e.state === 'rewind' ? 0.8 : 1) * 0.85;
      // torso sways with the stride
      v1.addScaledVector(UPV, Math.sin(time * 9 + e.phase * 3) * Math.min(0.12, e.vel.length() * 0.012));
      m4.compose(v1, q1, sc.setScalar(s));
      mesh.setMatrixAt(k, m4);
      // head: out on a neck, turned toward you
      Rv.crossVectors(UPV, F).normalize();
      v2.copy(g.headSolar).sub(e.pos).normalize();
      if (e.state === 'idle') v2.copy(F);
      e.head.copy(e.pos).addScaledVector(F, 1.15).addScaledVector(UPV, 0.45 + e.pitch * 0.6);
      m4.lookAt(v3.copy(v2).multiplyScalar(0.7).add(F).normalize(), sc.set(0, 0, 0), UPV); const hq = new THREE.Quaternion().setFromRotationMatrix(m4);
      m4.compose(v3.copy(e.head).sub(o), hq, sc.setScalar(s * 1.1));
      this.heads[e.el].setMatrixAt(k, m4);
      counts[e.el] = k + 1;
      // legs: hip -> knee -> foot
      if (e.near && e.state !== 'dead') {
        const lm = this.limbs[e.el], th = e.st.thick;
        for (const l of e.legs) {
          if (!l.set || lc[e.el] >= MAXE * MAXL * 2 - 2) continue;
          hip.copy(e.pos).addScaledVector(Rv, l.side * 0.5).addScaledVector(e.fwd, l.fz);
          v2.copy(l.foot).sub(hip);
          let d = v2.length(); const reach = L1 + L2 - 0.02;
          if (d > reach) { v2.multiplyScalar(reach / d); d = reach; }
          v2.divideScalar(d || 1);
          const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d || 1), hgt = Math.sqrt(Math.max(0, L1 * L1 - a * a));
          bend.copy(UPV).addScaledVector(Rv, l.side * 0.7).addScaledVector(v2, -(UPV.dot(v2) + Rv.dot(v2) * l.side * 0.7)).normalize();
          knee.copy(hip).addScaledVector(v2, a).addScaledVector(bend, hgt);
          v3.copy(knee).sub(hip); const u1 = v3.length();
          m4.compose(sc.copy(hip).sub(o), q1.setFromUnitVectors(Y, v3.divideScalar(u1 || 1)), v3.set(th * 1.25, u1, th * 1.25));
          lm.setMatrixAt(lc[e.el]++, m4);
          v3.copy(hip).addScaledVector(v2, d).sub(knee); const u2 = v3.length();
          m4.compose(sc.copy(knee).sub(o), q1.setFromUnitVectors(Y, v3.divideScalar(u2 || 1)), v3.set(th, u2, th));
          lm.setMatrixAt(lc[e.el]++, m4);
        }
      }
      if (ne < MAXE && e.state !== 'dead') {
        // the eye: its element's colour at rest, hot when it has you, flaring just before it strikes
        const hot = e.state === 'chase' || e.state === 'pursue';
        const rgb = ELEMENTS[e.el].rgb, pulse = e.act === 'windup' || e.act === 'crouch' ? 2.1 : 1;
        if (e.state === 'rewind') col.setRGB(1, 0.8, 0.4); else if (e.pacify > 0) col.setRGB(0.5, 0.6, 0.7); else if (e.slow > 0 || g.time.slowT > 0) col.setRGB(0.45, 0.8, 1); else col.setRGB(hot ? 1 : rgb[0], hot ? rgb[1] * 0.35 : rgb[1], hot ? rgb[2] * 0.3 : rgb[2]);
        v2.set(0, 0.05, 0.5).applyQuaternion(hq).add(e.head).sub(o);
        m4.compose(v2, hq, sc.setScalar((e.state === 'pursue' ? 0.8 + Math.min(4, v2.length() * 0.004) : 0.26) * pulse));
        this.eyes.setMatrixAt(ne, m4); this.eyes.setColorAt(ne, col);
        if (e.hp < e.max) {
          const f = Math.max(0, e.hp / e.max);
          v2.copy(e.pos).sub(o).addScaledVector(UPV, 2.6);
          m4.compose(v2, camQ, sc.set(2.2 * f, 0.16, 1));
          this.bars.setMatrixAt(nb, m4); this.bars.setColorAt(nb, col.setRGB(1 - f * 0.7, 0.25 + f * 0.7, 0.2)); nb++;
        }
        ne++;
      }
    }
    for (const el in this.bodies) {
      this.bodies[el].count = this.heads[el].count = counts[el] || 0; this.limbs[el].count = lc[el] || 0;
      for (const m of [this.bodies[el], this.heads[el], this.limbs[el]]) m.instanceMatrix.needsUpdate = true;
    }
    for (const b of this.bolts) {
      if (no >= MAXB) break;
      m4.compose(v1.copy(b.pos).sub(o), q1.identity(), sc.setScalar(b.size * (b.from === 'fx' ? Math.min(1, b.life * 4) : 1)));
      this.orbs.setMatrixAt(no, m4); this.orbs.setColorAt(no, col.setRGB(...b.rgb)); no++;
    }
    for (const d of this.drops) {
      if (no >= MAXB) break;
      m4.compose(v1.copy(d.pos).sub(o), q1.identity(), sc.setScalar(0.5 + 0.08 * Math.sin(time * 5 + d.t)));
      this.orbs.setMatrixAt(no, m4); this.orbs.setColorAt(no, col.setRGB(...ELEMENTS[d.el].rgb)); no++;
    }
    this.eyes.count = ne; this.bars.count = nb; this.orbs.count = no;
    for (const m of [this.eyes, this.bars, this.orbs]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
  }
}
