// The four time relics, the anomalies where they are found, and what they do.
//
//   Stillwater Pearls (pills, Thalassa)  slow time     the world crawls, you don't
//   The Rewinder (gun, Pyra)             reverse time  foes retrace their steps; collapses un-fall
//   Quickening Seeds (grenade, Sylva)    speed time    a tree's whole life in a breath; roots seize foes, essence regrows
//   Mantle of the Held Moment (cape,     freeze time   the world stops and an echo of you stays behind:
//     Petra)                                           it draws fire, casts when you cast, and you can step back into it
//
// Each relic waits on a lone mesa where time already misbehaves in its own
// way, which is how you spot the place from the air.
import * as THREE from 'three';
import { WEAPONS, WEAPON_ORDER, PLANET_BY_ID, groundHeight } from './worlds.js';
import { Builder, propMaterial, glowMaterial, additive, ENV } from './gfx.js';
import { uvVS, pillarFS, beaconFS } from './shaders.js';
import { treeGeometry } from './props.js';
import { mulberry32, smoothstep } from './noise.js';

const N = 70, TAU = Math.PI * 2;
const m4 = new THREE.Matrix4(), q1 = new THREE.Quaternion(), v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3(), sv = new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0);
const SHORT = { pearls: 'SLOW', rewinder: 'REWIND', seeds: 'GROW', mantle: 'FREEZE' };

const PICKUPS = {
  pearls() {   // an open shell holding three pearls
    const b = new Builder(), nacre = [0.82, 0.78, 0.72];
    b.blob(1.0, nacre, 0, 0, -0.1, 0, { detail: 2, rough: 0.18, sy: 0.3, seed: 1, color2: [0.7, 0.62, 0.66], ridged: true });
    b.blob(1.0, nacre, 0, 0, 0.55, -0.55, { detail: 2, rough: 0.18, sy: 0.3, seed: 2, rx: -0.9, color2: [0.7, 0.62, 0.66], ridged: true });
    for (let i = 0; i < 3; i++) b.add(new THREE.SphereGeometry(0.17, 14, 10), [0.9, 0.97, 1.0], 0.45, (i - 1) * 0.38, 0.22, 0.1 + (i % 2) * 0.2);
    return b.build();
  },
  rewinder() { // brass and obsidian, with a clock ring around the barrel
    const b = new Builder(), brass = [0.72, 0.55, 0.26], dark = [0.08, 0.07, 0.09];
    b.add(new THREE.CylinderGeometry(0.11, 0.14, 1.3, 12), brass, 0, 0, 0.3, -0.35, 1, 1, 1, Math.PI / 2, 0, 0);
    b.add(new THREE.BoxGeometry(0.26, 0.42, 0.9), dark, 0, 0, 0.26, 0.05);
    b.add(new THREE.BoxGeometry(0.22, 0.7, 0.3), dark, 0, 0, -0.18, 0.42, 1, 1, 1, 0.35, 0, 0);
    b.add(new THREE.TorusGeometry(0.34, 0.045, 8, 28), brass, 0.25, 0, 0.3, -0.5);
    b.add(new THREE.TorusGeometry(0.24, 0.03, 8, 24), [1.0, 0.75, 0.35], 0.8, 0, 0.3, -0.72);
    for (let i = 0; i < 12; i++) b.add(new THREE.BoxGeometry(0.03, 0.1, 0.03), brass, 0.3, Math.cos(i * 0.5236) * 0.34, 0.3 + Math.sin(i * 0.5236) * 0.34, -0.5);
    return b.build();
  },
  seeds() {    // three bristling pods on a twig
    const b = new Builder();
    b.limb([[0, 0.9, 0], [0.1, 0.4, 0], [0, 0, 0]], 0.05, 0.03, 5, [0.3, 0.24, 0.16]);
    [[0, -0.2, 0, 0.36], [-0.35, 0.25, 0.1, 0.27], [0.36, 0.4, -0.05, 0.25]].forEach(([x, y, z, r], i) => {
      b.blob(r, [0.5, 0.62, 0.2], 0.2, x, y, z, { detail: 2, rough: 0.25, sy: 1.25, seed: 20 + i, color2: [0.75, 0.7, 0.3] });
      for (let k = 0; k < 8; k++) b.spike(0.035, r * 0.9, 4, [0.8, 0.9, 0.5], 0.3, x + Math.cos(k * 0.785) * r * 0.8, y + Math.sin(k * 2.2) * r * 0.5, z + Math.sin(k * 0.785) * r * 0.8, -k * 0.785, 1.4);
    });
    return b.build();
  },
  mantle() {   // a cape caught mid-billow, with a gold clasp
    const b = new Builder();
    const g = new THREE.PlaneGeometry(1.5, 2.2, 8, 10), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), drop = (1.1 - y) / 2.2;
      p.setXYZ(i, x * (0.55 + drop * 0.6), y, Math.sin(x * 4 + y * 1.5) * 0.14 * drop + drop * drop * 0.45 - Math.abs(x) * 0.25);
    }
    g.computeVertexNormals();
    b.add(g, [0.2, 0.14, 0.34], -1);
    b.add(g.clone().translate(0, 0, -0.02), [0.75, 0.66, 0.9], 0.12);
    b.add(new THREE.TorusGeometry(0.14, 0.04, 8, 20), [0.85, 0.68, 0.3], 0.4, 0, 1.12, 0.06);
    return b.build();
  },
};

function pedestal(weapon) {
  const b = new Builder(), stone = [0.36, 0.34, 0.33];
  b.blob(3.2, stone, 0, 0, -0.6, 0, { detail: 2, rough: 0.4, sy: 0.45, seed: 31 });
  for (let i = 0; i < 12; i++) {       // a ring of hour-stones
    const a = (i / 12) * TAU, tall = i % 3 === 0 ? 2.6 : 1.3;
    b.blob(0.5, stone, 0, Math.cos(a) * 6.5, tall * 0.5, Math.sin(a) * 6.5, { detail: 1, rough: 0.35, sy: tall, seed: 40 + i });
    b.add(new THREE.BoxGeometry(0.12, tall * 0.6, 0.12), WEAPONS[weapon].rgb, 0.8, Math.cos(a) * 6.1, tall * 0.6, Math.sin(a) * 6.1);
  }
  return b.build();
}

export class Timeworks {
  constructor(game, scene) {
    this.game = game; this.scene = scene;
    this.pearls = { n: 3, max: 3, t: 0, every: 22 };
    this.seeds = { n: 2, max: 2, t: 0, every: 16 };
    this.cool = { rewinder: 0, mantle: 0 };
    this.slowT = 0; this.freezeT = 0; this.echo = null;
    this.anoms = new Map(); this.blooms = []; this.grenades = [];
    this.rnd = mulberry32(99); this.hinted = {};
    // Rewinder beam
    this.beamU = { uColor: { value: new THREE.Vector3(1, 0.72, 0.3) }, uTime: ENV.uTime, uAlpha: { value: 0 } };
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1, 8, 1, true).translate(0, 0.5, 0),
      new THREE.ShaderMaterial({ vertexShader: uvVS, fragmentShader: beaconFS, uniforms: this.beamU, side: THREE.DoubleSide, ...additive }));
    this.beam.frustumCulled = false; this.beam.visible = false; this.beam.renderOrder = 7;
    scene.add(this.beam);
    // seed grenades in flight
    this.pods = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.22, 1), glowMaterial(WEAPONS.seeds.rgb, 1.4, 1.6), 6);
    this.pods.frustumCulled = false; this.pods.count = 0;
    scene.add(this.pods);
    // the echo you leave behind
    const eb = new Builder();
    eb.add(new THREE.CapsuleGeometry(0.28, 0.9, 4, 12), [1, 1, 1], 0, 0, 0.95, 0);
    eb.add(new THREE.SphereGeometry(0.2, 14, 10), [1, 1, 1], 0, 0, 1.75, 0);
    const cape = new THREE.PlaneGeometry(0.9, 1.3, 3, 4); cape.translate(0, 0.95, 0.3); eb.add(cape, [1, 1, 1], 0);
    this.echoMesh = new THREE.Mesh(eb.build(), glowMaterial(WEAPONS.mantle.rgb, 1.2, 0.9));
    this.echoMesh.material.side = THREE.DoubleSide;
    this.echoMesh.visible = false; this.echoMesh.frustumCulled = false;
    scene.add(this.echoMesh);
    this.treeGeo = null; this.treeMat = propMaterial(0.05, { material: { side: THREE.DoubleSide } });
  }

  get owned() { return this.game.state.weapons; }
  get worldScale() { return this.freezeT > 0 ? 0 : this.slowT > 0 ? 0.2 : 1; }
  has(id) { return !!this.owned[id]; }
  list() { return WEAPON_ORDER.filter((w) => this.owned[w]); }

  cycle(dir = 1) {
    const l = this.list(); if (l.length < 2) return;
    const s = this.game.state;
    s.sel = l[(l.indexOf(s.sel) + dir + l.length) % l.length];
    this.game.hud.say(WEAPONS[s.sel].name, WEAPONS[s.sel].verb, 2, WEAPONS[s.sel].css);
    this.game.hud.poke();
  }

  select(i) { const w = WEAPON_ORDER[i]; if (this.owned[w]) { this.game.state.sel = w; this.game.hud.poke(); } }

  // What the TIME control would use right now (for buttons and the HUD).
  current() {
    const id = this.game.state.sel;
    if (!id || !this.owned[id]) return null;
    const w = WEAPONS[id];
    let ready = true, count = null;
    if (id === 'pearls') { count = this.pearls.n; ready = count > 0 && this.slowT <= 0; }
    else if (id === 'seeds') { count = this.seeds.n; ready = count > 0; }
    else if (id === 'rewinder') ready = this.cool.rewinder <= 0;
    else ready = !!this.echo || this.cool.mantle <= 0;
    return { id, name: w.name, short: id === 'mantle' && this.echo ? 'RETURN' : SHORT[id], css: w.css, ready, count, many: this.list().length > 1 };
  }

  give(id) {
    const s = this.game.state;
    if (s.weapons[id]) return;
    s.weapons[id] = true; s.sel = id;
    const w = WEAPONS[id], L = this.game.labels();
    this.game.hud.say(`${w.name} acquired`, w.lore, 7, w.css);
    this.game.hud.say(`${w.verb}: ${L.time}`, this.list().length > 1 ? `Switch relics with ${L.cycle}` : `A relic of ${PLANET_BY_ID[w.world].name}`, 6, w.css);
    this.game.audio.relic?.();
    this.game.save();
  }

  // ------------------------------------------------------------------ use
  // hand: { pos (scene space), dir }
  use(hand) {
    const g = this.game, c = this.current(), au = g.audio;
    if (!c) { g.hud.say('No time relic yet', 'Look for a lone mesa where time runs strangely', 4); return false; }
    if (!c.ready) { au.tone(110, 0.15, 'square', 0.06); return false; }
    const origin = v1.copy(hand.pos).add(g.player.pos).clone(), dir = hand.dir.clone().normalize();
    if (c.id === 'pearls') {
      this.pearls.n--; this.slowT = 6;
      au.tone(660, 1.2, 'sine', 0.16, 0, 0.25); au.sweep(1.2, 2400, 200, 0.25);
    } else if (c.id === 'mantle') {
      if (this.echo) { this.recall(); return true; }
      this.echo = { pos: g.player.pos.clone(), quat: g.rig.quaternion.clone(), t: 15, inside: g.player.inside };
      this.freezeT = 5; this.cool.mantle = 32;
      au.tone(880, 0.9, 'triangle', 0.14); au.tone(1320, 1.4, 'sine', 0.1, 0.05);
      g.hud.say('Time is held', `Your echo stands here. ${g.labels().time} again to step back into it`, 5, WEAPONS.mantle.css);
    } else if (c.id === 'rewinder') {
      this.cool.rewinder = 2.6;
      let end = 300, did = false;
      const pick = g.combat.rayPick(origin, dir, 320);
      if (pick) { g.combat.rewind(pick.enemy); end = pick.t; did = true; }
      const P = g.player.planet, field = g.fields.get(P.def.id);
      for (const d of field.deposits) {
        if (!d.buried) continue;
        v2.copy(P.pos).add(d.pos).sub(origin);
        const t = v2.dot(dir);
        if (t > 0 && t < 420 && v2.addScaledVector(dir, -t).length() < 24 && field.unbury(d)) {
          g.state.unburied[P.def.id][d.index] = true; g.save(); did = true; end = Math.min(end, t);
          g.hud.say('The collapse un-falls', 'Stone lifts back to where it was', 4, WEAPONS.rewinder.css);
        }
      }
      this.beamFrom = origin; this.beamDir = dir; this.beamLen = end; this.beamT = 0.45;
      au.sweep(0.5, 4000, 300, 0.35); au.tone(520, 0.4, 'sawtooth', 0.08, 0, 0.4);
      if (!did) g.hud.say('Nothing there to undo', '', 1.5);
    } else if (c.id === 'seeds') {
      this.seeds.n--;
      this.grenades.push({ pos: origin.clone(), vel: dir.multiplyScalar(34).addScaledVector(g.player.up, 9).add(g.player.vel), life: 7 });
      au.tone(300, 0.25, 'triangle', 0.12, 0, 1.8);
    }
    g.hud.poke();
    return true;
  }

  recall() {
    const g = this.game, e = this.echo; if (!e) return;
    g.combat.spark(g.headSolar, WEAPONS.mantle.rgb, 10, 8);
    g.player.pos.copy(e.pos); g.player.vel.set(0, 0, 0); g.rig.quaternion.copy(e.quat);
    this.echo = null; this.freezeT = 0;
    g.audio.tone(1320, 0.5, 'sine', 0.14, 0, 0.5);
  }

  // When you cast, your echo casts too, at whatever is nearest it.
  echoCast(el) {
    const e = this.echo, g = this.game; if (!e) return;
    const from = v1.copy(e.pos).addScaledVector(v2.set(0, 1.4, 0).applyQuaternion(e.quat), 1).clone();
    let best = null, bd = 120;
    for (const en of g.combat.enemies) { if (en.state === 'dead') continue; const d = en.pos.distanceTo(from); if (d < bd) { bd = d; best = en; } }
    if (best) g.combat.castPlayer(from, v2.copy(best.pos).sub(from).normalize(), el, true);
  }

  bloom(planet, local) {
    this.treeGeo = this.treeGeo || treeGeometry();
    const up = local.clone().normalize();
    const mesh = new THREE.Mesh(this.treeGeo, this.treeMat);
    mesh.position.copy(local); mesh.quaternion.setFromUnitVectors(Y, up); mesh.scale.setScalar(0.001);
    planet.group.add(mesh);
    this.blooms.push({ planet, local: local.clone(), mesh, t: 0 });
    const g = this.game, n = g.fields.get(planet.def.id).regrow(local, 40);
    g.combat.spark(v1.copy(planet.pos).add(local).addScaledVector(up, 2), WEAPONS.seeds.rgb, 16, 14);
    g.audio.sweep(1.4, 200, 2600, 0.3); g.audio.tone(196, 1.2, 'triangle', 0.12, 0, 2);
    if (n) g.hud.say('A season passes in a breath', `${n} essence regrown`, 3, WEAPONS.seeds.css);
  }

  // ------------------------------------------------------------ anomalies
  anomaly(planet) {
    const def = planet.def, site = def.anomaly;
    if (!site) return null;
    let a = this.anoms.get(def.id);
    if (a) return a;
    const w = site.weapon, up = new THREE.Vector3(site.x, site.y, site.z);
    const pos = up.clone().multiplyScalar(def.radius + groundHeight(def, up.x, up.y, up.z));
    const g = new THREE.Group();
    g.position.copy(pos); g.quaternion.setFromUnitVectors(Y, up);
    planet.group.add(g);
    g.add(new THREE.Mesh(pedestal(w), propMaterial(0.2)));
    const pickup = new THREE.Mesh(PICKUPS[w](), propMaterial(w === 'rewinder' ? 0.85 : 0.5, { grain: 0.3, material: { side: THREE.DoubleSide } }));
    pickup.position.y = 2.6; pickup.scale.setScalar(1.7);
    g.add(pickup);
    const halo = new THREE.Mesh(new THREE.IcosahedronGeometry(1.5, 2), glowMaterial(WEAPONS[w].rgb, 2.4, 0.9));
    halo.position.y = 2.6; g.add(halo);
    const parts = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), glowMaterial(WEAPONS[w].rgb, 1.5, 1.3), N);
    parts.frustumCulled = false; g.add(parts);
    const pu = { uColor: { value: new THREE.Vector3(...WEAPONS[w].rgb) }, uTime: ENV.uTime, uAlpha: { value: 0.5 } };
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(1, 0.55, 1, 16, 1, true).translate(0, 0.5, 0),
      new THREE.ShaderMaterial({ vertexShader: uvVS, fragmentShader: pillarFS, uniforms: pu, side: THREE.DoubleSide, ...additive }));
    pillar.frustumCulled = false; pillar.renderOrder = 3; g.add(pillar);
    let tree = null;
    if (w === 'seeds') {
      this.treeGeo = this.treeGeo || treeGeometry();
      tree = new THREE.Mesh(this.treeGeo, this.treeMat); tree.position.set(9, 0, -4); g.add(tree);
    }
    const rnd = mulberry32(def.seed + 3);
    a = { planet, weapon: w, pos, up, g, pickup, halo, parts, pillar, pu, tree, seeds: Array.from({ length: N }, () => [rnd(), rnd(), rnd(), rnd()]) };
    this.anoms.set(def.id, a);
    return a;
  }

  animate(a, time, headLocal) {
    const owned = this.has(a.weapon), dist = a.pos.distanceTo(headLocal);
    a.pickup.visible = a.halo.visible = !owned;
    a.pickup.rotation.y = time * 0.6; a.pickup.position.y = 2.6 + Math.sin(time * 1.3) * 0.25;
    a.halo.scale.setScalar(1 + Math.sin(time * 2) * 0.08);
    const wd = THREE.MathUtils.clamp(dist * 0.005, 1.6, 600);
    a.pillar.scale.set(wd, 320 + dist * 0.9, wd);
    a.pu.uAlpha.value = (owned ? 0.15 : 0.6) * smoothstep(10, 140, dist);
    a.parts.visible = dist < 1500;
    if (a.tree) {
      // one tree living its whole life every few seconds
      const c = (time * 0.22) % 1, s = c < 0.7 ? smoothstep(0, 0.7, c) : 1 - smoothstep(0.7, 1, c);
      a.tree.scale.set(s, Math.max(0.001, s * (0.6 + 0.4 * s)), s).multiplyScalar(1.3);
    }
    if (!a.parts.visible) return dist;
    for (let i = 0; i < N; i++) {
      const s = a.seeds[i];
      let sc = 0.09 + s[3] * 0.1;
      if (a.weapon === 'pearls') {
        // rain that has almost stopped falling
        const f = (s[1] + time * 0.012 * (0.5 + s[3])) % 1, ang = s[0] * TAU, r = 2 + Math.sqrt(s[2]) * 15;
        v1.set(Math.cos(ang) * r, 14 - f * 14, Math.sin(ang) * r);
        sv.set(sc * 0.6, sc * 2.4, sc * 0.6);
      } else if (a.weapon === 'rewinder') {
        // embers flying backward: converging, descending, into the pedestal
        const f = 1 - ((s[1] + time * (0.16 + s[3] * 0.12)) % 1), ang = s[0] * TAU - f * 4;
        v1.set(Math.cos(ang) * f * 13, 0.6 + f * f * 17, Math.sin(ang) * f * 13);
        sv.setScalar(sc * (0.4 + 1.6 * f));
      } else if (a.weapon === 'seeds') {
        // pollen in a hurry
        const ang = s[0] * TAU + time * (2.5 + s[3] * 3), r = 3 + s[2] * 10;
        v1.set(Math.cos(ang) * r, 0.8 + s[1] * 9 + Math.sin(time * 6 + i) * 0.4, Math.sin(ang) * r);
        sv.setScalar(sc * (0.6 + 0.6 * Math.sin(time * 9 + i)));
      } else {
        // dust and stones hung in the air; once in a while the whole storm ticks forward one instant
        const tick = Math.floor(time / 5), k = (s[1] + tick * 0.037 * (i % 5 + 1)) % 1, ang = s[0] * TAU + tick * 0.21;
        const r = 3 + s[2] * 13;
        v1.set(Math.cos(ang) * r, 0.5 + k * 13, Math.sin(ang) * r);
        sv.setScalar(sc * (1 + (i % 4)) * 1.3);
      }
      m4.compose(v1, q1.identity(), sv);
      a.parts.setMatrixAt(i, m4);
    }
    a.parts.instanceMatrix.needsUpdate = true;
    return dist;
  }

  // ---------------------------------------------------------------- frame
  update(raw, time, headLocal) {
    const g = this.game, pl = g.player, P = pl.planet;
    for (const c of [this.pearls, this.seeds]) if (c.n < c.max && (c.t += raw) >= c.every) { c.t = 0; c.n++; }
    this.cool.rewinder -= raw; this.cool.mantle -= raw;
    if (this.slowT > 0 && (this.slowT -= raw) <= 0) g.audio.tone(330, 0.6, 'sine', 0.1, 0, 2);
    if (this.freezeT > 0) this.freezeT -= raw;

    for (const [id, a] of this.anoms) a.g.visible = id === P.def.id;
    const a = this.anomaly(P);
    if (a && pl.alt < 60000 && !pl.inside) {
      const dist = this.animate(a, time, headLocal);
      if (!this.has(a.weapon)) {
        if (dist < 260 && !this.hinted[a.weapon]) { this.hinted[a.weapon] = true; g.hud.say(WEAPONS[a.weapon].sign, 'Time is not behaving itself on this mesa', 6, WEAPONS[a.weapon].css); }
        if (dist < 5.5) this.give(a.weapon);
      }
    }

    // echo
    const e = this.echo;
    this.echoMesh.visible = !!e;
    if (e) {
      e.t -= raw;
      this.echoMesh.position.copy(e.pos).sub(pl.pos);
      this.echoMesh.quaternion.copy(e.quat);
      this.echoMesh.material.uniforms.uGain.value = 0.7 + 0.25 * Math.sin(time * 5);
      if (e.t <= 0) { this.echo = null; g.combat.spark(v1.copy(e.pos), WEAPONS.mantle.rgb, 8, 5); }
    }

    // seed grenades: lobbed, pulled down, burst where they land
    let n = 0;
    for (const s of this.grenades) {
      s.life -= raw;
      v1.copy(s.pos).sub(P.pos); const r = v1.length(); v1.divideScalar(r);
      s.vel.addScaledVector(v1, -16 * raw);
      s.pos.addScaledVector(s.vel, raw);
      v1.copy(s.pos).sub(P.pos); const r2 = v1.length(); v1.divideScalar(r2);
      const floor = P.def.radius + groundHeight(P.def, v1.x, v1.y, v1.z);
      if (r2 <= floor + 0.2 || s.life <= 0) { s.life = -1; if (!pl.inside) this.bloom(P, v1.multiplyScalar(floor)); continue; }
      m4.compose(v2.copy(s.pos).sub(pl.pos), q1.identity(), sv.setScalar(1));
      this.pods.setMatrixAt(n++, m4);
    }
    this.grenades = this.grenades.filter((s) => s.life > 0);
    this.pods.count = n; this.pods.instanceMatrix.needsUpdate = true;

    // blooms: grow in a second, grip and age whatever is caught in them, stand a while, wither
    for (const b of this.blooms) {
      b.t += raw;
      const grow = smoothstep(0, 1.3, b.t) * (1 - smoothstep(34, 37, b.t));
      b.mesh.scale.setScalar(Math.max(0.001, grow * 2.3));
      if (b.t < 9) {
        v1.copy(b.planet.pos).add(b.local);
        g.combat.inRadius(v1, 15, (en) => { en.root = 0.4; g.combat.damage(en, 26 * raw, null); });
      }
      if (b.t > 37) b.mesh.removeFromParent();
    }
    this.blooms = this.blooms.filter((b) => b.t <= 37);

    // rewinder beam
    if (this.beamT > 0) {
      this.beamT -= raw;
      this.beam.visible = true;
      this.beam.position.copy(this.beamFrom).sub(pl.pos);
      this.beam.quaternion.setFromUnitVectors(Y, this.beamDir);
      this.beam.scale.set(1 + (0.45 - this.beamT) * 6, this.beamLen, 1 + (0.45 - this.beamT) * 6);
      this.beamU.uAlpha.value = Math.max(0, this.beamT / 0.45) * 3;
    } else this.beam.visible = false;
  }
}
