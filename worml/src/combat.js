// Guardians, bolts and drops. Each world's essence deposits are watched by
// creatures made of that world's element. They are weak to the element that
// overcomes theirs, they chase you across open space if you flee by flying,
// and they lose you only when you slip through a wormhole.
import * as THREE from 'three';
import { ELEMENTS, WEAK_TO, groundHeight } from './worlds.js';
import { Builder, propMaterial, glowMaterial } from './gfx.js';
import { mulberry32 } from './noise.js';

const MAXE = 44, MAXB = 96, MAX_PURSUERS = 6;
const TAU = Math.PI * 2;
const m4 = new THREE.Matrix4(), q1 = new THREE.Quaternion(), v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3();
const sc = new THREE.Vector3(), col = new THREE.Color(), UPV = new THREE.Vector3();

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

const STATS = {
  water: { hp: 55, dmg: 6, aggro: 30, n: 2 }, fire: { hp: 90, dmg: 9, aggro: 75, n: 3 }, metal: { hp: 120, dmg: 9, aggro: 70, n: 3 },
  wood: { hp: 90, dmg: 9, aggro: 80, n: 4 }, earth: { hp: 140, dmg: 10, aggro: 70, n: 3 }, magic: { hp: 120, dmg: 12, aggro: 90, n: 5 },
};

export class Combat {
  constructor(game, scene) {
    this.game = game;
    this.enemies = []; this.bolts = []; this.drops = [];
    this.planet = null; this.rnd = mulberry32(4711); this.nextId = 1;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.bodies = {};
    this.eyes = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), glowMaterial([1, 1, 1], 1.4, 1.6), MAXE);
    this.eyes.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAXE * 3), 3);
    this.bars = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ toneMapped: false, depthWrite: false, transparent: true, opacity: 0.9 }), MAXE);
    this.bars.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAXE * 3), 3);
    this.orbs = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), glowMaterial([1, 1, 1], 1.5, 1.8), MAXB);
    this.orbs.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAXB * 3), 3);
    for (const m of [this.eyes, this.bars, this.orbs]) { m.frustumCulled = false; m.count = 0; m.renderOrder = 6; this.group.add(m); }
  }

  body(el) {
    if (!this.bodies[el]) {
      const m = new THREE.InstancedMesh(BODIES[el](), propMaterial(el === 'metal' || el === 'magic' ? 0.8 : 0.2, { grain: 0.6, material: { side: THREE.DoubleSide } }), MAXE);
      m.frustumCulled = false; m.count = 0;
      this.group.add(m);
      this.bodies[el] = m;
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
          id: this.nextId++, el: def.element, planet, dep: d.index, slot: k, nest: d.pos.clone().addScaledVector(d.up, 4),
          pos: new THREE.Vector3(), vel: new THREE.Vector3(), hp: st.hp, max: st.hp, dmg: st.dmg, aggro: st.aggro,
          state: 'idle', cool: 1 + this.rnd() * 2, phase: (k / st.n) * TAU + d.index, hist: [], histT: 0,
          stun: 0, root: 0, burn: 0, slow: 0, pacify: 0, flash: 0, foreign: false, rew: 0, dead: 0, age: 0,
        };
        this.post(e, 0);
        this.enemies.push(e);
      }
    }
  }

  // An idle guardian's place in the ring it flies around its deposit.
  post(e, time) {
    const a = e.phase + time * 0.25, r = 16 + (e.slot % 2) * 7;
    const up = v3.copy(e.nest).normalize();
    v1.set(-up.y, up.x, 0); if (v1.lengthSq() < 0.01) v1.set(0, -up.z, up.y); v1.normalize();
    v2.crossVectors(up, v1);
    e.pos.copy(e.planet.pos).add(e.nest).addScaledVector(v1, Math.cos(a) * r).addScaledVector(v2, Math.sin(a) * r).addScaledVector(up, 6 + Math.sin(a * 2.3) * 2.5);
  }

  // Wormholes shake pursuit: strangers vanish, locals drift back to their posts.
  dropPursuit() {
    this.enemies = this.enemies.filter((e) => !e.foreign);
    for (const e of this.enemies) if (e.state !== 'idle' && e.state !== 'dead') { e.state = 'idle'; e.pacify = 6; this.post(e, 0); }
    this.bolts.length = 0;
  }

  get hunting() { let n = 0; for (const e of this.enemies) if (e.state === 'chase' || e.state === 'pursue') n++; return n; }
  get pursuing() { let n = 0; for (const e of this.enemies) if (e.state === 'pursue') n++; return n; }

  // ---------------------------------------------------------------- attacks
  // origin/dir in solar coordinates. Returns false if nothing to throw.
  castPlayer(origin, dir, el, fromEcho = false) {
    const rgb = ELEMENTS[el].rgb;
    this.bolts.push({ pos: origin.clone(), vel: dir.clone().multiplyScalar(150).add(this.game.player.vel), life: 2.4, from: 'player', el, rgb, size: 0.42, echo: fromEcho });
  }

  spark(pos, rgb, n = 6, speed = 9) {
    for (let i = 0; i < n && this.bolts.length < MAXB - 8; i++) {
      v1.set(this.rnd() - 0.5, this.rnd() - 0.5, this.rnd() - 0.5).normalize().multiplyScalar(speed * (0.4 + this.rnd()));
      this.bolts.push({ pos: pos.clone(), vel: v1.clone(), life: 0.25 + this.rnd() * 0.35, from: 'fx', rgb, size: 0.2 });
    }
  }

  damage(e, amount, el = null) {
    if (e.state === 'dead' || e.state === 'rewind') return 0;
    let mult = 1;
    if (el) {
      mult = e.el === 'magic' ? 1.4 : WEAK_TO[e.el] === el ? 2.5 : el === e.el ? 0.6 : 1;
      if (el === 'water') e.slow = 3; else if (el === 'fire') e.burn = 3; else if (el === 'wood') e.root = 1.6;
      else if (el === 'earth') { e.stun = 0.8; e.vel.addScaledVector(v1.copy(e.pos).sub(this.game.player.pos).normalize(), 18); }
      else if (el === 'metal') mult *= 1.25;
    }
    const d = amount * mult;
    e.hp -= d; e.flash = 1; e.pacify = 0;
    if (e.state === 'idle') e.state = 'chase';
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

  // ----------------------------------------------------------------- frame
  // dt: world time (slowed or frozen by relics). raw: the player's own time.
  update(dt, raw, time) {
    const g = this.game, pl = g.player, P = pl.planet;
    if (P !== this.planet) this.setPlanet(P);
    const target = g.targetPos(v3.set(0, 0, 0)).clone();        // solar: the head, or the echo standing in for it
    const head = g.headSolar;
    let pursuers = this.pursuing;

    for (const e of this.enemies) {
      e.age += dt; e.flash = Math.max(0, e.flash - raw * 4);
      if (e.state === 'dead') { e.dead -= raw; continue; }
      const dist = e.pos.distanceTo(target);
      if (e.state === 'idle') {
        if (e.pacify > 0) e.pacify -= dt;
        if (dist > 320) { if (!e.foreign) this.post(e, time); continue; }
        // drift back to the ring round the deposit
        v2.copy(e.pos); this.post(e, time); v1.copy(e.pos).sub(v2);
        const step = Math.min(v1.length(), 12 * dt);
        e.pos.copy(v2); if (step > 0) e.pos.addScaledVector(v1.normalize(), step);
        if (e.pacify <= 0 && dist < e.aggro && !g.dead && !pl.inside) { e.state = 'chase'; g.onAggro(e); }
        continue;
      }
      if (e.state === 'rewind') {
        // retrace its own path at speed; strangers unravel all the way home
        e.rew -= raw;
        for (let k = 0; k < 3 && e.hist.length; k++) e.pos.lerp(e.hist[e.hist.length - 1], 0.6), e.pos.distanceTo(e.hist[e.hist.length - 1]) < 1 && e.hist.pop();
        if (e.rew <= 0 || !e.hist.length) {
          this.spark(e.pos, [1, 0.75, 0.35], 8, 6);
          if (e.foreign) { e.state = 'dead'; e.dead = 0; } else { e.state = 'idle'; e.hp = e.max; e.pacify = 30; }
        }
        continue;
      }
      // ---- chase (near you) or pursue (across space)
      if (e.burn > 0) { e.burn -= dt; e.hp -= 8 * dt; if (e.hp <= 0) { this.kill(e); continue; } }
      e.stun -= dt; e.root -= dt; e.slow -= dt; e.cool -= dt;
      e.histT -= dt;
      if (e.histT <= 0) { e.histT = 0.2; e.hist.push(e.pos.clone()); if (e.hist.length > 70) e.hist.shift(); }
      if (g.dead || (pl.inside && e.state === 'chase' && dist > 60)) { e.state = 'idle'; e.pacify = 8; if (e.foreign) { e.state = 'dead'; e.dead = 0; } continue; }
      const far = dist > 150;
      if (e.state === 'chase' && far) {
        if (pursuers < MAX_PURSUERS) { e.state = 'pursue'; pursuers++; g.onPursue(e); }
        else { e.state = 'idle'; e.pacify = 10; if (e.foreign) { e.state = 'dead'; e.dead = 0; } continue; }
      } else if (e.state === 'pursue' && dist < 110) e.state = 'chase';
      if (e.state === 'pursue' && (e.age > 600 || dist > 6e6)) { e.state = 'dead'; e.dead = 0; continue; }

      // altitude above the nearest world sets its speed, exactly as it does yours
      let near = P, alt = Infinity;
      for (const p of g.planets) { const a = e.pos.distanceTo(p.pos) - p.def.radius; if (a < alt) { alt = a; near = p; } }
      UPV.copy(e.pos).sub(near.pos).normalize();
      v1.copy(target).sub(e.pos);
      if (e.state === 'chase') {
        // hold a ring around you rather than piling on
        const a = e.phase + time * 0.35;
        v2.set(-UPV.y, UPV.x, 0); if (v2.lengthSq() < 0.01) v2.set(0, -UPV.z, UPV.y); v2.normalize();
        v1.addScaledVector(v2, Math.cos(a) * 13).addScaledVector(v3.crossVectors(UPV, v2), Math.sin(a) * 13).addScaledVector(UPV, 3.5);
      }
      const d = v1.length();
      let speed = e.state === 'chase' ? Math.min(17, d * 1.5) : Math.min(22 + 0.72 * Math.max(0, alt), d * 1.2 + 12);
      if (e.slow > 0) speed *= 0.4;
      if (e.stun > 0 || e.root > 0) speed = 0;
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
      if (e.state === 'chase' && dist < 55 && e.cool <= 0 && e.stun <= 0) {
        e.cool = 2 + this.rnd() * 1.4;
        v1.copy(target).sub(e.pos).normalize();
        this.bolts.push({ pos: e.pos.clone().addScaledVector(v1, 1.4), vel: v1.multiplyScalar(34), life: 3, from: 'enemy', el: e.el, rgb: ELEMENTS[e.el].rgb, size: 0.34, dmg: e.dmg });
        g.audio.tone(320, 0.18, 'square', 0.05, 0, 0.5);
      }
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
          if (e.state === 'dead' || e.state === 'rewind') continue;
          const t = Math.max(0, Math.min(L, v3.copy(e.pos).sub(v1).dot(v2)));
          if (v3.copy(v1).addScaledVector(v2, t).distanceTo(e.pos) < 2.3) {
            const mult = this.damage(e, 30, b.el);
            this.spark(b.pos, b.rgb, mult > 1.5 ? 10 : 5);
            g.onHit(e, mult);
            b.life = 0; break;
          }
        }
        if (b.life > 0 && seal && b.pos.distanceTo(seal.pos) < seal.r) { b.life = 0; this.spark(b.pos, b.rgb, 10, 12); g.hitSeal(b.el); }
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
      if (dd < 16) d.pos.lerp(head, 1 - Math.exp(-raw * (dd < 6 ? 8 : 2.5)));
      if (dd < 1.2) { d.t = 1e9; g.gain(d.el, 1); }
    }
    this.drops = this.drops.filter((d) => d.t < 90);
    this.render(time);
  }

  render(time) {
    const g = this.game, o = g.player.pos, camQ = g.camera.getWorldQuaternion(q1).clone();
    const counts = {}; let ne = 0, nb = 0, no = 0;
    for (const el in this.bodies) counts[el] = 0;
    for (const e of this.enemies) {
      const mesh = this.body(e.el), k = counts[e.el] = counts[e.el] || 0;
      if (k >= MAXE) continue;
      v1.copy(e.pos).sub(o);
      if (v1.length() > 9000 && e.state === 'idle') continue;       // far posts aren't drawn
      UPV.copy(e.pos).sub(e.planet.pos).normalize();
      // face the player (or idle heading), bob and pulse
      v2.copy(g.headSolar).sub(e.pos);
      if (e.state === 'idle') v2.crossVectors(UPV, v3.copy(e.pos).sub(e.planet.pos).sub(e.nest)).negate();
      m4.lookAt(v2, v3.set(0, 0, 0), UPV); q1.setFromRotationMatrix(m4);
      const dying = e.state === 'dead' ? Math.max(0, e.dead / 0.6) : 1;
      const s = (1 + e.flash * 0.25 + Math.sin(time * 3 + e.phase) * 0.04) * dying * (e.state === 'rewind' ? 0.8 : 1);
      v1.addScaledVector(UPV, Math.sin(time * 1.7 + e.phase * 3) * 0.35);
      m4.compose(v1, q1, sc.setScalar(s));
      mesh.setMatrixAt(k, m4); counts[e.el] = k + 1;
      if (ne < MAXE && e.state !== 'dead') {
        // the eye: its element's colour at rest, hot when it has you, pale gold while rewinding
        const hot = e.state === 'chase' || e.state === 'pursue';
        const rgb = ELEMENTS[e.el].rgb, pulse = hot && e.cool < 0.5 ? 1.9 : 1;
        if (e.state === 'rewind') col.setRGB(1, 0.8, 0.4); else if (e.pacify > 0) col.setRGB(0.5, 0.6, 0.7); else col.setRGB(hot ? 1 : rgb[0], hot ? rgb[1] * 0.35 : rgb[1], hot ? rgb[2] * 0.3 : rgb[2]);
        v2.set(0, 0.15, 1.05).applyQuaternion(q1).multiplyScalar(s).add(v1);
        m4.compose(v2, q1, sc.setScalar((e.state === 'pursue' ? 0.9 + Math.min(4, v1.length() * 0.004) : 0.34) * pulse));
        this.eyes.setMatrixAt(ne, m4); this.eyes.setColorAt(ne, col);
        if (e.hp < e.max) {
          const f = Math.max(0, e.hp / e.max);
          v2.copy(v1).addScaledVector(UPV, 2.3);
          m4.compose(v2, camQ, sc.set(2.2 * f, 0.16, 1));
          this.bars.setMatrixAt(nb, m4); this.bars.setColorAt(nb, col.setRGB(1 - f * 0.7, 0.25 + f * 0.7, 0.2)); nb++;
        }
        ne++;
      }
    }
    for (const el in this.bodies) { this.bodies[el].count = counts[el] || 0; this.bodies[el].instanceMatrix.needsUpdate = true; }
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
