// Element trials and the finale.
//
// Each world's element is won, not picked up. Its trial ground is a pool of
// the world's own liquid (water, lava, quicksilver...; a quarry pit on dry
// Petra) with a dormant font on an islet. Step in and guardians rise out of
// it in three waves while the ground erupts under you (geysers, fire jets,
// rockfalls). Clear them and the font wakes: your element fills, and from
// then on the font refills it whenever you stand by it.
//
// When all six worlds are linked the star itself wakes. At an arena hung
// before the Sun, waves of every element come out of the flares, then the
// Heliarch, which wears one element after another and must be answered with
// the element that overcomes each. Braziers round the arena refill all five.
import * as THREE from 'three';
import { ELEMENTS, WEAK_TO, TRIALS, SUN, PLANETS, groundHeight } from './worlds.js';
import { glowMaterial, propMaterial, Builder } from './gfx.js';
import { mulberry32 } from './noise.js';

const Y = new THREE.Vector3(0, 1, 0);
const m4 = new THREE.Matrix4(), q1 = new THREE.Quaternion(), v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3(), sc = new THREE.Vector3(), col = new THREE.Color();
const MAXH = 14, FIVE = ['water', 'fire', 'metal', 'wood', 'earth'];
const WAVES = { water: [3, 4, 5], fire: [4, 6, 7], metal: [4, 5, 7], wood: [5, 6, 8], earth: [4, 5, 6], magic: [5, 6, 8] };
const BOSS_ORDER = ['fire', 'metal', 'wood', 'earth', 'water'];

// Where the finale is fought: on the Thalassa side of the Sun, well clear of its surface.
export const ARENA = (() => {
  const p = PLANETS[0].pos, l = Math.hypot(p[0], p[1], p[2]), k = (SUN.radius * 2.3) / l;
  return new THREE.Vector3(p[0] * k, p[1] * k + SUN.radius * 0.35, p[2] * k);
})();
export const ARENA_R = 95;

export class Trials {
  constructor(game, scene) {
    this.game = game;
    this.rnd = mulberry32(2024);
    this.phase = 'idle'; this.wave = 0; this.queue = 0; this.spawnT = 0; this.hazT = 2; this.restT = 0; this.planet = null; this.stir = 0; this.refillT = 0;
    this.hazards = [];
    // telegraph rings and eruption columns
    this.rings = new THREE.InstancedMesh(new THREE.TorusGeometry(1, 0.06, 6, 40).rotateX(Math.PI / 2), glowMaterial([1, 1, 1], 1.2, 1.6), MAXH);
    this.cols = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.75, 1, 1, 12, 1, true).translate(0, 0.5, 0), glowMaterial([1, 1, 1], 1.0, 1.3), MAXH);
    for (const m of [this.rings, this.cols]) {
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAXH * 3), 3);
      m.material.side = THREE.DoubleSide; m.frustumCulled = false; m.count = 0; m.renderOrder = 6; scene.add(m);
    }

    // ---- finale arena: a ring of stone before the Sun, five braziers and a dais
    this.f = { phase: 'idle', wave: 0, queue: 0, spawnT: 0, hazT: 3, restT: 0, boss: null, shiftT: 0, addT: 0, shift: 0, t: 0 };
    const b = new Builder(), stone = [0.2, 0.19, 0.21], dark = [0.09, 0.09, 0.11];
    b.add(new THREE.TorusGeometry(ARENA_R, 5, 10, 96), stone, 0, 0, 0, 0, 1, 1, 0.5, Math.PI / 2, 0, 0);
    b.add(new THREE.TorusGeometry(ARENA_R * 0.45, 1.6, 8, 72), dark, 0, 0, 0, 0, 1, 1, 0.5, Math.PI / 2, 0, 0);
    b.add(new THREE.TorusGeometry(ARENA_R + 9, 0.8, 6, 96), [1.0, 0.8, 0.45], 0.8, 0, 0, 0, 1, 1, 1, Math.PI / 2, 0, 0);
    this.braziers = FIVE.map((el, i) => {
      const a = (i / 5) * Math.PI * 2, x = Math.cos(a) * ARENA_R, z = Math.sin(a) * ARENA_R;
      b.column(new THREE.CylinderGeometry(3.4, 5, 16, 8), 16, stone, 0, x, -2, z);
      b.add(new THREE.TorusGeometry(4.6, 0.7, 6, 20), ELEMENTS[el].rgb, 0.9, x, 14.5, z, 1, 1, 1, Math.PI / 2, 0, 0);
      return { el, local: new THREE.Vector3(x, 19, z) };
    });
    this.arena = new THREE.Group();
    this.arena.add(new THREE.Mesh(b.build(), propMaterial(0.4)));
    for (const br of this.braziers) {
      br.flame = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), glowMaterial(ELEMENTS[br.el].rgb, 1.6, 1.5));
      br.flame.position.copy(br.local); this.arena.add(br.flame);
    }
    // the arena's own "up" points away from the Sun
    this.up = ARENA.clone().normalize();
    this.arena.quaternion.setFromUnitVectors(Y, this.up);
    this.arena.visible = false;
    scene.add(this.arena);
    for (const br of this.braziers) br.pos = br.local.clone().applyQuaternion(this.arena.quaternion).add(ARENA);
  }

  get active() { return this.phase === 'fight' || this.phase === 'rest'; }
  get finaleActive() { return this.f.phase !== 'idle' && this.f.phase !== 'done'; }

  reset() {
    this.phase = 'idle'; this.wave = 0; this.queue = 0; this.hazards.length = 0;
    Object.assign(this.f, { phase: 'idle', wave: 0, queue: 0, boss: null });
    this.game.combat.clear((e) => e.tag === 'trial' || e.tag === 'finale');
  }

  // A telegraphed eruption. pos solar, up unit; bursts after `warn` seconds.
  hazard(pos, up, rgb, r = 4.5, warn = 1.25, dmg = 13, tall = 16) {
    if (this.hazards.length < MAXH) this.hazards.push({ pos: pos.clone(), up: up.clone(), rgb, r, warn, dmg, tall, t: 0, burst: false });
  }

  // The Rewinder un-happens eruptions near its beam.
  undoNear(origin, dir, range) {
    let n = 0;
    for (const h of this.hazards) {
      v1.copy(h.pos).sub(origin); const t = v1.dot(dir);
      if (t > 0 && t < range && v1.addScaledVector(dir, -t).length() < 14 && !h.burst) { h.t = 99; h.burst = true; n++; }
    }
    return n;
  }

  undoAround(center, r) {
    let n = 0;
    for (const h of this.hazards) if (!h.burst && h.pos.distanceTo(center) < r) { h.t = 99; h.burst = true; n++; }
    return n;
  }

  // ------------------------------------------------------------------ trial
  updateTrial(dt, raw, wt, headLocal) {
    const g = this.game, pl = g.player, P = pl.planet, def = P.def, s = g.state, field = g.fields.get(def.id), site = field.site;
    if (this.planet !== P) { if (this.active) g.combat.clear((e) => e.tag === 'trial'); this.planet = P; this.phase = 'idle'; this.wave = 0; this.hazards.length = 0; }
    const mastered = !!s.trial[def.id], el = def.element, E = ELEMENTS[el], T = TRIALS[el];
    const dist = site.pos.distanceTo(headLocal), onSite = dist < 60 && !pl.inside && pl.alt < 60;
    this.stir += ((this.active ? 1 : 0) - this.stir) * Math.min(1, raw * 2);
    field.update(wt, mastered, this.stir);
    if (!g.started || g.dead || g.transit) return;

    if (mastered) {
      // the woken font refills its element while you stand by it
      if (dist < 14 && s.inv[el] < g.cap && (this.refillT -= raw) <= 0) { this.refillT = 0.3; g.gain(el, 1); }
      return;
    }
    const alive = () => g.combat.enemies.filter((e) => e.tag === 'trial' && e.state !== 'dead').length;
    const waves = WAVES[el];
    if (this.phase === 'idle') {
      if (dist < 240 && dist > 60) g.tell('trialnear', 90, T.name, `${E.label} is won here, not found. Step in.`, 5, E.css);
      if (onSite) {
        this.phase = 'rest'; this.wave = -1; this.restT = 1.2; this.hazT = 3;
        g.hud.note(T.name, E.css);
        g.hud.say('Swipe, swing or cast', `${g.labels().slash} to strike for free. ${g.labels().cast} spends essence and hits harder.`, 7);
        g.audio.tone(98, 1.2, 'sawtooth', 0.12, 0, 0.6);
      }
      return;
    }
    if (dist > 280) {      // walked away: the pool settles and the trial waits
      g.combat.clear((e) => e.tag === 'trial' && e.state !== 'pursue');
      this.phase = 'idle'; this.hazards.length = 0;
      g.hud.say(`${T.name} falls quiet`, 'Return to begin again', 4, E.css);
      return;
    }
    if (this.phase === 'rest') {
      if ((this.restT -= dt) <= 0) {
        this.wave++;
        if (this.wave >= waves.length) {
          // mastered
          s.trial[def.id] = true; s.inv[el] = g.cap;
          this.phase = 'idle'; this.hazards.length = 0;
          g.hud.note(`${E.label} mastered`, E.css, 4);
          g.audio.unlock(); g.hud.poke(6); g.save();
          g.combat.spark(v1.copy(P.pos).add(site.pos).addScaledVector(site.up, 6), E.rgb, 30, 22);
          return;
        }
        this.phase = 'fight'; this.queue = waves[this.wave]; this.spawnT = 0.2;
        g.hud.say(`Wave ${this.wave + 1} of ${waves.length}`, '', 2, E.css);
      }
      return;
    }
    // ---- fight: guardians rise out of the pool one after another
    if (this.queue > 0 && (this.spawnT -= dt) <= 0) {
      this.spawnT = 0.45; this.queue--;
      const a = this.rnd() * Math.PI * 2, r = 16 + this.rnd() * 22;
      v1.copy(site.pos).addScaledVector(site.t1, Math.cos(a) * r).addScaledVector(site.t2, Math.sin(a) * r).normalize();
      const pos = v1.clone().multiplyScalar(def.radius + groundHeight(def, v1.x, v1.y, v1.z)).add(P.pos);
      g.combat.spawn({ planet: P, pos, el, emerge: true, tag: 'trial', striker: this.queue % 2 === 0 });
      g.audio.tone(70, 0.6, 'sawtooth', 0.1, 0, 2.2);
    }
    if (this.queue === 0 && alive() === 0) { this.phase = 'rest'; this.restT = 2.2; return; }
    // the ground erupts where you stand (or just ahead of where you are going)
    if ((this.hazT -= dt) <= 0 && pl.alt < 20) {
      this.hazT = (el === 'water' ? 4.2 : 2.6) + this.rnd() * 1.6;
      v1.copy(pl.pos).sub(P.pos).addScaledVector(pl.vel, 0.9).addScaledVector(site.t1, (this.rnd() - 0.5) * 6).addScaledVector(site.t2, (this.rnd() - 0.5) * 6).normalize();
      this.hazard(v2.copy(v1).multiplyScalar(def.radius + groundHeight(def, v1.x, v1.y, v1.z) + 0.15).add(P.pos), v1, E.rgb);
    }
  }

  // ----------------------------------------------------------------- finale
  updateFinale(dt, raw, wt) {
    const g = this.game, pl = g.player, s = g.state, f = this.f, c = g.combat;
    const d = pl.pos.distanceTo(ARENA);
    this.arena.visible = d < 4e5;
    if (!this.arena.visible) return;
    this.arena.position.copy(ARENA).sub(pl.pos);
    for (const br of this.braziers) br.flame.scale.setScalar(3.4 + Math.sin(wt * 3 + br.local.x) * 0.5);
    if (!g.started || g.dead || g.transit) return;
    // braziers: fly through one and that element is full again
    if (d < 400) for (const br of this.braziers) if (g.headSolar.distanceTo(br.pos) < 13 && s.inv[br.el] < g.cap) { s.inv[br.el] = g.cap; g.audio.pickup(br.el); g.hud.poke(); g.hud.say(`${ELEMENTS[br.el].label} rekindled`, '', 1.2, ELEMENTS[br.el].css); }
    if (!s.won || s.finale) return;
    const near = pl.planet;
    const spawn = (el, o = {}) => {
      const a = this.rnd() * Math.PI * 2, r = 50 + this.rnd() * 60;
      v1.set(Math.cos(a) * r, 8 + this.rnd() * 40, Math.sin(a) * r).applyQuaternion(this.arena.quaternion).add(ARENA);
      return c.spawn({ planet: near, pos: v1, el, emerge: true, tag: 'finale', space: true, ...o });
    };
    const alive = () => c.enemies.filter((e) => e.tag === 'finale' && e.state !== 'dead' && !e.boss).length;
    if (f.phase === 'idle') {
      if (d < 260) {
        f.phase = 'rest'; f.wave = -1; f.restT = 2.5; f.hazT = 4;
        g.hud.note('The star wakes', '#ffd27a', 4);
        g.audio.warp();
      }
      return;
    }
    if (d > 1800) {       // left the arena: it resets
      c.clear((e) => e.tag === 'finale'); Object.assign(f, { phase: 'idle', boss: null }); this.hazards.length = 0;
      g.hud.say('The star subsides', 'Return to the ring to face it again', 5, '#ffd27a');
      return;
    }
    // solar flares burst around you throughout
    if ((f.hazT -= dt) <= 0) {
      f.hazT = 2.2 + this.rnd() * 1.6;
      v1.copy(g.headSolar).addScaledVector(pl.vel, 0.8).add(v2.set(this.rnd() - 0.5, this.rnd() - 0.5, this.rnd() - 0.5).multiplyScalar(8));
      this.hazard(v1, v2.copy(v1).sub(pl.pos).cross(this.up).normalize(), [1.0, 0.75, 0.35], 6, 1.3, 14, 0);     // in open space a flare is a ring and a burst, not a column across your face
    }
    if (f.phase === 'rest') {
      if ((f.restT -= dt) > 0) return;
      f.wave++;
      if (f.wave < 2) {
        f.phase = 'fight'; f.queue = f.wave === 0 ? 12 : 16; f.spawnT = 0.3;
        g.hud.say(f.wave === 0 ? 'First flare' : 'Second flare', 'Aim for what each is weak to: it is chosen for you if you carry it', 4, '#ffd27a');
      } else {
        f.phase = 'boss'; f.shift = 0; f.shiftT = 11; f.addT = 9;
        f.boss = spawn(BOSS_ORDER[0], { boss: true, sz: 4.2, hp: 2600, dmg: 11, striker: false });
        f.boss.pos.copy(ARENA).addScaledVector(this.up, 60);
        this.announce(f.boss);
      }
      return;
    }
    if (f.phase === 'fight') {
      if (f.queue > 0 && (f.spawnT -= dt) <= 0) { f.spawnT = 0.4; f.queue--; spawn(['fire', 'metal', 'wood', 'earth', 'water', 'magic'][Math.floor(this.rnd() * 6)]); }
      if (f.queue === 0 && alive() === 0) { f.phase = 'rest'; f.restT = 3; }
      return;
    }
    // ---- the Heliarch: it wears each element in turn
    const boss = f.boss;
    if (!boss || boss.state === 'dead' || !c.enemies.includes(boss)) {
      c.clear((e) => e.tag === 'finale' && !e.boss);
      f.phase = 'done'; s.finale = true; this.hazards.length = 0;
      const t = Math.round(s.playTime), mm = Math.floor(t / 60), ss = String(t % 60).padStart(2, '0');
      g.hud.note(`WORML COMPLETE · ${mm}:${ss}`, '#ffe9a8', 14);
      g.audio.win();
      for (let i = 0; i < 6; i++) c.spark(v1.copy(ARENA).add(v2.set(this.rnd() - 0.5, this.rnd() - 0.5, this.rnd() - 0.5).multiplyScalar(120)), ELEMENTS[FIVE[i % 5]].rgb, 10, 30);
      g.save();
      return;
    }
    if ((f.shiftT -= dt) <= 0) {
      f.shiftT = 11; f.shift = (f.shift + 1) % BOSS_ORDER.length;
      boss.el = BOSS_ORDER[f.shift]; boss.st = c.statsFor(boss.el); boss.flash = 1;
      for (const l of boss.legs) l.set = false;
      boss.legs.length = Math.min(boss.legs.length, boss.st.legs);
      c.spark(boss.pos, ELEMENTS[boss.el].rgb, 20, 30);
      this.announce(boss);
    }
    if ((f.addT -= dt) <= 0) { f.addT = 8; if (alive() < 9) for (let i = 0; i < 4; i++) spawn(boss.el); }
  }

  announce(boss) {
    const w = WEAK_TO[boss.el], g = this.game;
    g.hud.note(`The Heliarch: ${ELEMENTS[boss.el].label}`, ELEMENTS[boss.el].css);
    g.hud.say(`The Heliarch burns as ${ELEMENTS[boss.el].label}`, `${ELEMENTS[w].label} overcomes it${g.state.inv[w] ? '' : ': rekindle it at a brazier'}`, 5, ELEMENTS[boss.el].css);
    g.audio.tone(82, 1.0, 'sawtooth', 0.14, 0, 0.5);
  }

  // ------------------------------------------------------------------ frame
  update(dt, raw, wt, headLocal) {
    const g = this.game, pl = g.player;
    this.updateTrial(dt, raw, wt, headLocal);
    this.updateFinale(dt, raw, wt);
    // hazards: a ring closes on the spot, then it erupts
    let n = 0;
    for (const h of this.hazards) {
      h.t += dt;
      const k = Math.min(1, h.t / h.warn);
      if (!h.burst && h.t >= h.warn) {
        h.burst = true;
        g.combat.spark(h.pos, h.rgb, 14, 16);
        g.audio.tone(60, 0.35, 'sawtooth', 0.14, 0, 3);
        if (g.headSolar.distanceTo(v1.copy(h.pos).addScaledVector(h.up, 1.5)) < h.r + 1 && !g.decoyActive()) g.hurt(h.dmg);
      }
      if (n >= MAXH) continue;
      v1.copy(h.pos).sub(pl.pos);
      q1.setFromUnitVectors(Y, h.up);
      m4.compose(v1, q1, sc.setScalar(h.burst ? h.r * (1 + (h.t - h.warn) * 2) : h.r * (1.6 - 0.6 * k)));
      this.rings.setMatrixAt(n, m4); this.rings.setColorAt(n, col.setRGB(...h.rgb).multiplyScalar(h.burst ? Math.max(0, 1 - (h.t - h.warn) * 2.5) : 0.4 + k));
      const e = h.burst ? Math.max(0, 1 - (h.t - h.warn) / 0.5) : 0;
      m4.compose(v1, q1, sc.set(h.r * 0.5 * e + 0.001, h.tall * e + 0.001, h.r * 0.5 * e + 0.001).multiplyScalar(h.tall ? 1 : 0));
      this.cols.setMatrixAt(n, m4); this.cols.setColorAt(n, col.setRGB(...h.rgb));
      n++;
    }
    this.hazards = this.hazards.filter((h) => h.t < h.warn + 0.5);
    this.rings.count = this.cols.count = n;
    for (const m of [this.rings, this.cols]) { m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; }
  }
}
