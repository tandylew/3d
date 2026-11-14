// Game orchestration: world streaming, the elemental quest, health and
// combat, time relics, wormhole transits, HUD state and persistence.
import * as THREE from 'three';
import { PLANETS, PLANET_BY_ID, ELEMENTS, ELEMENT_ORDER, WEAK_TO, WEAPONS, TRIALS } from './worlds.js';
import { smoothstep } from './noise.js';
import { makeDetailTexture, syncEnv, glowMaterial } from './gfx.js';
import { Planet, TerrainManager } from './planet.js';
import { Sky } from './sky.js';
import { Player } from './player.js';
import { Gate, RING_Y, RING_R } from './gates.js';
import { EssenceField } from './essence.js';
import { Props } from './props.js';
import { Hud } from './hud.js';
import { Streaks, Tunnel } from './fx.js';
import { Combat } from './combat.js';
import { Timeworks } from './timeworks.js';
import { Trials, ARENA } from './trials.js';

export const SAVE_KEY = 'worml-save-v3';
const QUEST = ['thalassa', 'pyra', 'ferrum', 'sylva', 'petra', 'arcana'];
const SOURCE = { water: 'thalassa', fire: 'pyra', metal: 'ferrum', wood: 'sylva', earth: 'petra', magic: 'arcana' };
const CAP = 12;
// Casting: hold to gather the charge, let go inside the resonance window for a perfect cast.
export const CAST = { W0: 0.7, W1: 1.7, MAX: 1.7 };
// The blast: charged by kills, released around you.
export const NOVA = { need: 5, radius: 17, dmg: 150 };

const headScene = new THREE.Vector3(), headLocal = new THREE.Vector3(), playerLocal = new THREE.Vector3();
const gl = new THREE.Vector3(), v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), camUp = new THREE.Vector3(), camQ = new THREE.Quaternion();

function freshState() {
  return {
    open: { thalassa: true }, order: ['thalassa'], visited: {}, won: false,
    inv: Object.fromEntries(ELEMENT_ORDER.map((e) => [e, 0])),
    charge: Object.fromEntries(PLANETS.map((p) => [p.id, {}])),
    weapons: {}, sel: null, trial: {}, finale: false, playTime: 0,
    unburied: Object.fromEntries(PLANETS.map((p) => [p.id, {}])),
  };
}

export class Game {
  constructor({ renderer, scene, rig, camera, input, audio }) {
    Object.assign(this, { renderer, scene, rig, camera, input, audio });
    this.detail = makeDetailTexture(renderer);
    this.manager = new TerrainManager(2);
    this.sky = new Sky(renderer, scene, this.detail);
    this.planets = PLANETS.map((def, i) => new Planet(def, i, this.manager, this.detail, scene, this.sky.cloudMap));
    this.gates = new Map(); this.fields = new Map();
    for (const p of this.planets) {
      this.gates.set(p.def.id, new Gate(p, this.detail));
      this.fields.set(p.def.id, new EssenceField(p));
    }
    this.props = new Props();
    this.player = new Player(rig, camera, this.planets);
    this.hud = new Hud(scene, rig, camera, input);
    this.streaks = new Streaks(scene);
    this.tunnel = new Tunnel(rig, this.detail);
    this.combat = new Combat(this, scene);
    this.time = new Timeworks(this, scene);
    this.trials = new Trials(this, scene);
    this.cap = CAP; this.slashCool = 0; this.prevAlt = 0;
    this.transit = null; this.pendingUnlock = null; this.saveT = 0;
    this.started = false; this.clock = 0; this.worldTime = 0;
    this.health = 100; this.hurtT = 99; this.hurtFlash = 0; this.dead = null;
    this.castCool = 0; this.castEl = null; this.told = {}; this.tellT = {};
    this.fury = 0; this.chargeT = -1; this.castLock = false; this.forceEl = null; this.lastHit = null; this.lastCast = ''; this.radarT = 0;
    this.chargeOrb = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), glowMaterial([1, 1, 1], 1.6, 1.5));
    this.chargeOrb.visible = false; this.chargeOrb.frustumCulled = false; this.chargeOrb.renderOrder = 8;
    scene.add(this.chargeOrb);
    this.headSolar = new THREE.Vector3();

    this.state = freshState();
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) { const s = JSON.parse(raw), f = freshState(); Object.assign(this.state, s); for (const k of ['weapons', 'unburied', 'charge', 'inv', 'trial']) this.state[k] = { ...f[k], ...(s[k] || {}) }; }
    } catch { /* no storage: play without saving */ }
    this.applyState();

    const home = this.gates.get('thalassa');
    this.player.place(home.planet, home.frontDir(36), 0, home.z.clone().negate());
  }

  applyState() {
    for (const [id, g] of this.gates) g.setOpen(!!this.state.open[id], true);
    this.player.arena = this.state.won ? ARENA : null;
    this.updateDests();
    this.pendingUnlock = null;
  }

  reset() {
    this.state = freshState();
    try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
    this.applyState();
    this.health = 100; this.told = {};
    this.trials.reset();
    this.combat.dropPursuit(); this.combat.clear(() => true);
    this.time.echo = null;
  }

  save() { this.saveT = 0.5; }

  // Stand `back` metres from a world's wellhead, `height` above the ground.
  warpTo(id, height = 0, back = 36) {
    const g = this.gates.get(id);
    this.player.place(g.planet, g.frontDir(back), height, g.z.clone().negate());
    this.combat.dropPursuit();
  }

  // Hang in a world's hollow core, in front of its gate (if its shaft is open).
  warpCore(id, side = 1) {
    const g = this.gates.get(id);
    if (!g.planet.shaftOpen) return false;
    this.player.placeCore(g.planet, g.z.clone().multiplyScalar(40 * side).addScaledVector(g.up, -1.7), g.z.clone().multiplyScalar(-side));
    this.combat.dropPursuit();
    return true;
  }

  labels() {
    if (this.renderer.xr.isPresenting) return { fly: 'point & squeeze TRIGGER', cast: 'Hold RIGHT GRIP, release on the flash', slash: 'Swing a controller', time: 'LEFT GRIP', cycle: 'B', jump: 'A', hud: 'Y' };
    if (this.input.touch.on) return { fly: 'the left stick, once you have leapt', cast: 'Tap, or press and release on the flash,', slash: 'Swipe across the screen', time: 'TIME', cycle: '⟳', jump: 'Double-tap the look side', hud: '◎' };
    return { fly: 'W, once you have leapt', cast: 'Hold LEFT CLICK, release on the flash', slash: 'V', time: 'E', cycle: 'Q', jump: 'SPACE', hud: 'H' };
  }

  // What a cast released after `t` seconds of charge carries.
  castPower(t) {
    const { W0, W1, MAX } = CAST;
    if (t < W0) { const f = t / W0; return { dmg: 14 + 26 * f * f, speed: 110 + 40 * f, size: 0.26 + 0.12 * f, perfect: false, label: f < 0.25 ? 'quick' : 'early' }; }
    // fully charged: a burst. With a guardian to go after it homes and destroys; otherwise it flies straight.
    return { dmg: 72, speed: 240, size: 0.62, perfect: true, label: 'burst' };
  }

  // Say something once per `gap` seconds at most (hints that could otherwise nag).
  tell(key, gap, title, sub, sec = 5, css = '#ffffff') {
    if (!this.hud.guides || (this.tellT[key] || -1e9) + gap > this.clock) return;
    this.tellT[key] = this.clock;
    this.hud.say(title, sub, sec, css);
  }

  // ---- dev dashboard helpers
  nextSealed() { const id = QUEST.find((q) => !this.state.open[q]); return id ? this.gates.get(id) : null; }

  grant(n) { for (const el of ELEMENT_ORDER) this.state.inv[el] = el === 'magic' ? 0 : Math.max(0, Math.min(CAP, n)); this.hud.poke(); this.save(); }

  grantFor(gate) {
    const needs = gate.planet.def.needs || {}, ch = this.state.charge[gate.planet.def.id];
    for (const el of Object.keys(needs)) this.state.inv[el] = Math.max(this.state.inv[el], needs[el] - (ch[el] || 0));
    this.save();
  }

  unlockNext() { const g = this.nextSealed(); if (g) this.unlock(g); return g; }

  begin() {
    if (this.started) return;
    this.started = true;
    const L = this.labels(), fresh = this.state.order.length === 1 && !this.state.inv.water;
    if (fresh) {
      this.hud.say('Welcome to Thalassa', 'Follow the glowing stream from the well to the Tidepool, where Water is won', 8, ELEMENTS.water.css);
      this.hud.say(`${L.jump} to leap`, `${L.slash} to strike. ${L.hud} for objectives.`, 9);
    } else this.hud.say('Welcome back', this.objective().lines[0], 6);
  }

  // The linked worlds form a ring in the order they were opened: each gate's
  // front face leads onward round it, its back face leads back.
  updateDests() {
    const o = this.state.order, n = o.length;
    for (let i = 0; i < n; i++) {
      const g = this.gates.get(o[i]);
      g.setDests(n > 1 ? this.gates.get(o[(i + 1) % n]) : null, n > 1 ? this.gates.get(o[(i - 1 + n) % n]) : null);
    }
    for (const [id, g] of this.gates) if (!o.includes(id)) g.setDests(null, null);
  }

  objective() {
    const s = this.state, L = this.labels();
    if (s.finale) return { lines: ['Worml is complete', 'The star is quiet and all six worlds are linked. Roam freely.'], goal: null };
    if (s.won) return { lines: ['Face the Heliarch at the Sun', 'Fly to the ring that hangs before the star'], goal: 'sun' };
    const id = QUEST.find((q) => !s.open[q]), def = PLANET_BY_ID[id];
    for (const el of Object.keys(def.needs)) {
      const short = def.needs[el] - (s.charge[id][el] || 0) - s.inv[el];
      if (short > 0) {
        const src = PLANET_BY_ID[SOURCE[el]], T = TRIALS[el];
        return s.trial[src.id]
          ? { lines: [`Refill ${ELEMENTS[el].label} at the font on ${src.name}`, `Stand by it at ${T.name}`], goal: src.id, gather: true }
          : { lines: [`Master ${ELEMENTS[el].label} at ${T.name} on ${src.name}`, 'Follow the glowing stream from the well, or the radar'], goal: src.id, gather: true };
      }
    }
    const here = this.player.planet.def.id === id && this.player.alt < 4000;
    return {
      lines: here ? [`Break the seal on ${def.name}'s well`, `${L.cast} aimed at it`]
        : [`Travel to ${def.name}`, this.player.inside ? `Pass through the gate, or ${L.jump} to ride up and fly` : def.lock],
      goal: id,
    };
  }

  unlock(gate) {
    const s = this.state, def = gate.planet.def;
    if (s.open[def.id]) return;
    s.open[def.id] = true; s.order.push(def.id);
    gate.setOpen(true);
    this.updateDests();
    this.audio.unlock();
    this.hud.note(`${def.name}'s well is open`, ELEMENTS[def.element].css);
    if (QUEST.every((q) => s.open[q])) {
      s.won = true; this.player.arena = ARENA;
      this.hud.note('Every world is linked. The Sun wakes.', '#ffe9a8', 5);
      this.audio.win();
    }
    this.save();
  }

  // ------------------------------------------------------------- combat glue
  targetPos() {
    const e = this.time.echo;
    return this.decoyActive() ? v2.set(0, 1.4, 0).applyQuaternion(e.quat).add(e.pos) : this.headSolar;
  }

  decoyActive() { return !!this.time.echo && this.time.freezeT <= 0; }

  // The seal on the current world's well, as a target for cast bolts.
  sealTarget() {
    const P = this.player.planet, gate = this.gates.get(P.def.id);
    if (gate.open || this.pendingUnlock || this.player.alt > 3000) return null;
    return { pos: v2.copy(P.pos).add(gate.site).addScaledVector(gate.up, 3).clone(), r: 17, gate };
  }

  hitSeal(el, perfect = false, slash = false) {
    const P = this.player.planet, def = P.def, gate = this.gates.get(def.id), needs = def.needs, ch = this.state.charge[def.id];
    if (!needs || gate.open) return;
    // a blade carries your element into the seal too, but it still costs the essence
    if (slash) { if (!el || !needs[el] || (ch[el] || 0) >= needs[el] || this.state.inv[el] <= 0) return; this.state.inv[el]--; }
    if (needs[el] && (ch[el] || 0) < needs[el]) {
      ch[el] = Math.min(needs[el], (ch[el] || 0) + (perfect ? 2 : 1));     // a perfect cast counts double
      gate.flash(ELEMENTS[el].rgb);
      this.audio.deliver(el);
      const done = Object.keys(needs).reduce((n, k) => n + Math.min(ch[k] || 0, needs[k]), 0), total = Object.values(needs).reduce((a, b) => a + b, 0);
      if (done >= total) this.pendingUnlock = { gate, t: 0.8 };
      else this.hud.say(`The seal weakens: ${done} / ${total}`, perfect ? 'Perfect cast: counts double' : '', 1.6, ELEMENTS[el].css);
      this.save();
    } else {
      const want = Object.keys(needs).filter((k) => (ch[k] || 0) < needs[k]).map((k) => ELEMENTS[k].label).join(', ');
      this.tell('sealwrong', 4, 'The seal shrugs it off', `${def.lock} It needs ${want}.`, 4);
    }
  }

  gain(el, n) {
    const s = this.state;
    s.inv[el] = Math.min(CAP, s.inv[el] + n);
    this.audio.pickup(el);
    this.hud.poke();
    if (!this.told.power) { this.told.power = true; this.hud.say(`${ELEMENTS[el].label} essence is now your power`, `Hold ${this.labels().cast} to charge, release as the orb flashes white for a perfect cast`, 8, ELEMENTS[el].css); }
    this.save();
  }

  hurt(dmg) {
    if (this.dead || this.transit || !this.started) return;
    this.health -= dmg; this.hurtT = 0; this.hurtFlash = 1;
    this.audio.tone(90, 0.22, 'sawtooth', 0.2, 0, 0.5);
    for (const h of [this.input.left, this.input.right]) this.input.pulse(h, 0.9, 80);
    if (this.health < 45 && this.time.has('pearls') && this.combat.hunting >= 2) this.tell('pearlhint', 40, 'Outnumbered', `Swallow a Stillwater Pearl: ${this.labels().time}`, 4, WEAPONS.pearls.css);
    if (this.health <= 0) this.die();
  }

  die() {
    this.health = 0;
    this.dead = { t: 0, moved: false };
    this.player.frozen = true;
    this.audio.tone(60, 1.6, 'sawtooth', 0.2, 0, 0.3);
    this.hud.note('You are unmade', '#ff8a7a');
  }

  onAggro(e) {
    const weak = WEAK_TO[e.el], L = this.labels();
    this.tell('aggro', 45, 'Guardians!', weak && this.state.inv[weak] ? `${ELEMENTS[weak].label} overcomes ${ELEMENTS[e.el].label}: aim and ${L.cast}`
      : Object.values(this.state.inv).some((n) => n) ? `Aim and ${L.cast}. ${weak ? ELEMENTS[weak].label + ' would hit them hardest.' : ''}` : 'You have no essence to cast. Gather some, or outrun them.', 6, ELEMENTS[e.el].css);
  }

  onPursue() { this.tell('pursue', 60, 'They are following you', 'Guardians chase through open space. Only a wormhole shakes them.', 6, '#ff8a7a'); }

  onHit(e, mult, eye, b) {
    this.lastHit = { dmg: Math.round(b.dmg * mult), mult: +mult.toFixed(2), eye, perfect: b.perfect, el: b.el, hp: Math.max(0, Math.round(e.hp)) };
    if (mult > 1.5 && WEAK_TO[e.el] === b.el && !this.told.weak) { this.told.weak = true; this.hud.say('Overcome!', `${ELEMENTS[WEAK_TO[e.el]].label} overcomes ${ELEMENTS[e.el].label}`, 3, ELEMENTS[WEAK_TO[e.el]].css); }
    if (eye) this.tell('eye', 8, 'Eye strike', 'A bolt through the head hits 1.6x as hard', 2, '#ffe9a8');
    this.audio.tone(eye ? 700 : mult > 1.5 ? 520 : 300, 0.12, 'triangle', 0.12);
    if (b.perfect) this.audio.tone(1040, 0.25, 'sine', 0.1, 0.03);
  }

  // every kill feeds the blast
  onKill() { if (this.fury < NOVA.need) { this.fury++; if (this.fury === NOVA.need) { this.audio.tone(880, 0.4, 'sine', 0.14); this.audio.tone(1320, 0.5, 'sine', 0.1, 0.1); this.hud.poke(); } } }

  // Throw a fully charged cast: at a guardian it becomes a homing burst (two essence if you have it).
  throwCast(origin, dir, el, pw) {
    const s = this.state, target = pw.perfect ? this.combat.pickTarget(origin, dir) : null;
    s.inv[el]--;
    if (target) { if (s.inv[el] > 0) s.inv[el]--; this.combat.burst(origin, dir, el, target); }
    else this.combat.castPlayer(origin, dir, el, pw);
    this.time.echoCast(el, pw);
    this.lastCast = pw.label;
    this.audio.tone(el === 'fire' ? 180 : el === 'water' ? 420 : 300, 0.2, 'triangle', pw.perfect ? 0.2 : 0.12, 0, pw.perfect ? 3 : 2.2);
    this.hud.poke(); this.save();
  }

  // Which element a cast along this ray should spend: what the thing you are
  // aiming at is weak to, if you carry it; otherwise whatever you hold most of.
  pickElement(origin, dir) {
    const inv = this.state.inv, seal = this.sealTarget();
    if (this.forceEl && inv[this.forceEl] > 0) return this.forceEl;
    if (seal) {
      v1.copy(seal.pos).sub(origin);
      const t = v1.dot(dir);
      if (t > 0 && t < 400 && v1.addScaledVector(dir, -t).length() < 22) {
        const needs = seal.gate.planet.def.needs, ch = this.state.charge[seal.gate.planet.def.id];
        const el = Object.keys(needs).find((k) => (ch[k] || 0) < needs[k] && inv[k] > 0);
        if (el) return el;
      }
    }
    const pick = this.combat.rayPick(origin, dir, 260);
    let foe = pick?.enemy;
    if (!foe && this.combat.hunting) { let bd = 1e9; for (const e of this.combat.enemies) { if (e.state !== 'chase') continue; const d = e.pos.distanceTo(origin); if (d < bd) { bd = d; foe = e; } } }
    if (foe && WEAK_TO[foe.el] && inv[WEAK_TO[foe.el]] > 0) return WEAK_TO[foe.el];
    let best = null;
    for (const el of ELEMENT_ORDER) if (inv[el] > 0 && (!best || inv[el] > inv[best]) && !(foe && el === foe.el && Object.values(inv).filter((n) => n).length > 1)) best = el;
    return best;
  }

  // ------------------------------------------------------------- wormholes
  startTransit(gate, to, forward) {
    this.transit = { t: 0, from: gate, to, forward, moved: false, out: 0 };
    this.player.frozen = true;
    this.tunnel.u.uColor.value.set(...gate.color);
    this.tunnel.u.uColor2.value.set(...to.color);
    this.tunnel.aim(this.camera);
    this.audio.warp();
    for (const h of [this.input.left, this.input.right]) this.input.pulse(h, 0.8, 300);
  }

  updateTransit(dt) {
    const tr = this.transit;
    tr.t += dt;
    let alpha = Math.min(1, tr.t / 0.35);
    if (!tr.moved && tr.t > 0.5) {
      // Going onward you step out of the far gate's back face (so the door
      // behind you leads back); going back, out of its front face.
      const to = tr.to, side = tr.forward ? -1 : 1;
      this.player.placeCore(to.planet, to.z.clone().multiplyScalar(26 * side).addScaledVector(to.up, -1.7), to.z.clone().multiplyScalar(side));
      to.lastZ = side;
      this.combat.dropPursuit();       // nothing follows you through a wormhole
      this.time.echo = null;
      this.tunnel.aim(this.camera);
      tr.moved = true;
    }
    // Hold the tunnel until the destination has streamed in.
    if (tr.moved && tr.t > 2.6 && (this.manager.pending === 0 || tr.t > 10)) {
      tr.out += dt / 0.7;
      alpha = 1 - tr.out;
      if (tr.out >= 1) {
        this.transit = null;
        this.player.frozen = false;
        const def = tr.to.planet.def;
        this.hud.note(`Core of ${def.name}`, ELEMENTS[def.element].css);
        alpha = 0;
      }
    }
    this.tunnel.set(alpha, smoothstep(0.4, 2.2, tr.t), this.clock, this.camera);
  }

  // What the on-screen buttons should show.
  uiState() {
    const el = this.castEl;
    return { castCss: el ? ELEMENTS[el].css : null, castCount: el ? this.state.inv[el] : 0, weapon: this.time.current(),
      w0: CAST.W0, w1: CAST.W1,
      leaping: this.player.leaping, nova: this.fury >= NOVA.need,
      charge: this.chargeT < 0 ? 0 : Math.min(1, this.chargeT / CAST.W0), perfect: this.chargeT >= CAST.W0 && this.chargeT <= CAST.W1 };
  }

  // ------------------------------------------------------------------ frame
  frame(dt, time) {
    this.clock = time;
    const { input, player, hud, state: s, combat } = this;
    input.frame(dt);
    const ws = this.time.worldScale;
    this.worldTime += dt * ws;
    const wt = this.worldTime;
    if (this.transit) this.updateTransit(dt);

    // ---- one-shot actions
    const L = this.labels();
    if (this.started && !this.transit && !this.dead) {
      if (input.hudEdge) hud.toggleObjectives();
      if (input.flyEdge && !input.touch.on) hud.say(input.flyMode ? 'Flight on' : 'Flight off', input.flyMode ? 'Forward flies where you look. You hover when still.' : 'You walk, and fall if in the air.', 1.6);
      const airborne = !player.inside && !player.grounded && player.alt > 8;
      if (input.jumpEdge && (player.leaping ? player.amp() : airborne && input.flyMode && !input.xr ? player.bail(input) : player.jump())) {
        this.audio.sweep(0.9, player.dive ? 2400 : 300, player.dive ? 300 : 2400, 0.3);
        if (player.inside) this.tell('ride', 30, 'Riding the shaft', 'Up to the wellhead', 3);
        else if (!this.told.leap) { this.told.leap = true; hud.say('Leap!', `Again in the air to go higher. ${L.fly} to steer.`, 5); }
      }
      if (input.cycleEdge) this.time.cycle(1);
      if (input.select >= 0) this.time.select(input.select);
    }
    // Flight looks after itself on flat screens: a leap puts you in the air and
    // flying; coming down to within a few metres of the ground lands you.
    if (!input.xr) {
      if (player.inside) input.flyMode = true;
      else if (!player.leaping && player.alt < 3.5 && this.prevAlt >= 3.5 && !this.transit) input.flyMode = false;
    }
    this.prevAlt = player.alt;
    if (this.started && !s.finale) s.playTime += dt;
    player.update(dt, input);

    for (const p of this.planets) p.update(player.pos, wt);
    this.manager.pump();
    const P = player.planet, def = P.def, id = def.id, alt = player.alt, inside = player.inside;
    syncEnv(P);
    this.sky.update(player.pos, wt);

    this.camera.getWorldPosition(headScene);
    this.headSolar.copy(headScene).add(player.pos);
    headLocal.copy(headScene).sub(P.group.position);
    playerLocal.copy(player.pos).sub(P.pos);
    const gate = this.gates.get(id), field = this.fields.get(id);
    for (const g of this.gates.values()) {
      g.siteGroup.visible = g === gate && alt < 90000;
      g.group.visible = g === gate && (inside || alt < 200);
    }
    for (const p of this.planets) p.shaft.visible = p.chamber.visible = p === P && p.shaftOpen && alt < 3000;
    for (const f of this.fields.values()) f.group.visible = f === field && alt < 120000 && !inside;
    const gateDist = gate.update(dt * ws, wt, headLocal);
    if (inside) this.props.group.visible = false; else this.props.update(P, playerLocal, alt);
    this.streaks.update(dt, player.vel, player.speed, inside ? 500 : alt);

    // ---- relics and guardians
    const tHand = input.xr ? input.left : input.right;
    if (this.started && !this.transit && !this.dead && input.timeEdge) { if (s.sel === 'rewinder' && this.time.has('rewinder')) this.time.beginMark(); else this.time.use(tHand); }
    if (this.time.marks && (!input.timeHeld || this.time.markT > 6)) this.time.releaseMark();
    // ---- the blast: five kills charge it; it strikes everything round you
    if (input.novaEdge && this.fury >= NOVA.need && this.started && !this.transit && !this.dead) {
      this.fury = 0;
      const el = this.pickElement(this.headSolar, input.right.dir);
      combat.nova(this.headSolar.clone(), NOVA.radius, NOVA.dmg, el ? ELEMENTS[el].rgb : [1, 0.92, 0.7]);
      for (const h of [input.left, input.right]) input.pulse(h, 1, 150);
      hud.poke();
    }
    this.time.update(dt, time, headLocal);
    this.trials.update(dt * ws, dt, wt, headLocal);
    combat.update(dt * ws, dt, wt);
    // Is there anything to attack? On touch screens that turns the open area from look-drags into attack gestures.
    const sealNear = !gate.open && !inside && gateDist < 130;
    input.touch.combat = !this.dead && !this.transit && (combat.enemies.some((e) => e.state !== 'idle' && e.state !== 'dead' && e.pos.distanceTo(this.headSolar) < 110) || sealNear || this.trials.active || this.trials.finaleActive);

    // ---- melee: a swing of the controller, a swipe of the screen. Free, short-ranged,
    // and it carries whatever element you hold most usefully without spending it.
    this.slashCool -= dt;
    const canAct = this.started && !this.transit && !this.dead;
    for (const sl of input.slashes) {
      if (!canAct || this.slashCool > 0) break;
      this.slashCool = 0.22;
      const o = v1.copy(sl.pos).add(player.pos).clone();
      const el = this.pickElement(o, sl.dir);
      // a clean cut: the swipe passes through a guardian's head on screen (or, in VR, a full-blooded swing)
      let clean = sl.power >= 0.95 && !sl.ndc;
      if (sl.ndc && sl.ndc.path) {
        for (const e of combat.enemies) {
          if (e.state === 'dead' || e.pos.distanceTo(this.headSolar) > 45) continue;
          v2.copy(e.head).sub(player.pos).project(this.camera);
          if (v2.z < 1 && sl.ndc.path.some((q) => Math.hypot((q[0] - v2.x) * this.camera.aspect, q[1] - v2.y) < 0.16)) { clean = true; break; }
        }
      }
      combat.slash(o, sl.dir, sl.sweep, el, sl.power, clean);
      if (sl.hand) input.pulse(sl.hand, 0.7, 50);
      if (clean) this.tell('clean', 12, 'Clean cut', 'A blade drawn through the head hits far harder', 2, '#ffe9a8');
    }
    // ---- aimed casts from the screen: a tap (quick) or a press released at the right moment (perfect)
    for (const sh of input.shots) {
      if (!canAct) break;
      const dir = v2.set(sh.ndc[0], sh.ndc[1], 0.5).unproject(this.camera).sub(headScene.setFromMatrixPosition(this.camera.matrixWorld)).normalize().clone();
      const o = v1.copy(input.right.pos).add(player.pos).clone(), el = this.pickElement(o, dir), pw = this.castPower(sh.t);
      if (!el) { combat.slash(o, dir, v2.set(1, 0, 0).applyQuaternion(this.camera.getWorldQuaternion(camQ)), null, 0.5, false); this.tell('empty', 8, 'No essence to cast', 'Swipe to strike instead, or win some at a trial', 3); continue; }
      this.throwCast(o, dir, el, pw);
    }

    // ---- casting: hold to charge, release to throw. Let go inside the short
    // resonance window (the orb flashes white, a chime sounds) for a perfect cast.
    this.castCool -= dt;
    const origin = v1.copy(input.right.pos).add(player.pos).clone(), aim = input.right.dir;
    this.castEl = this.pickElement(origin, aim);
    const canCast = this.started && !this.transit && !this.dead;
    if (!input.cast) this.castLock = false;
    const release = () => {
      const el = this.castEl || this.chargeEl, pw = this.castPower(this.chargeT);
      this.chargeT = -1; this.castCool = 0.12;
      if (!el || s.inv[el] <= 0) return;
      this.throwCast(origin, aim, el, pw);
      input.pulse(input.right, pw.perfect ? 1 : 0.4, pw.perfect ? 90 : 40);
    };
    if (input.cast && canCast && !this.castLock) {
      if (this.chargeT < 0) {
        if (this.castCool <= 0) {
          if (this.castEl) { this.chargeT = 0; this.chargeEl = this.castEl; }
          else this.tell('empty', 6, 'No essence to cast', `${L.slash} to strike instead, or win some at a trial`, 3);
        }
      } else {
        const before = this.chargeT;
        this.chargeT += dt;
        if (before < CAST.W0 && this.chargeT >= CAST.W0) { this.audio.tone(1320, 0.16, 'sine', 0.16); input.pulse(input.right, 0.8, 30); }
        if (this.chargeT >= CAST.MAX) { release(); this.castLock = true; }
      }
    } else if (this.chargeT >= 0) { if (canCast) release(); else this.chargeT = -1; }
    // the charge, gathered at your casting hand
    const orb = this.chargeOrb;
    orb.visible = this.chargeT >= 0;
    if (orb.visible) {
      const c = Math.min(1, this.chargeT / CAST.W0), inWin = this.chargeT >= CAST.W0 && this.chargeT <= CAST.W1, over = this.chargeT > CAST.W1;
      const rgb = ELEMENTS[this.castEl || this.chargeEl].rgb, sc = input.xr ? 1 : 0.55;
      orb.position.copy(input.right.pos).addScaledVector(aim, input.xr ? 0.16 : 0.1);
      orb.scale.setScalar(sc * (inWin ? 0.085 + 0.012 * Math.sin(time * 40) : over ? 0.05 * (1 - (this.chargeT - CAST.W1) / (CAST.MAX - CAST.W1)) + 0.012 : 0.012 + 0.05 * c));
      orb.material.uniforms.uColor.value.set(...(inWin ? [1, 1, 1] : over ? rgb.map((q) => q * 0.4) : rgb));
      orb.material.uniforms.uGain.value = inWin ? 3 : 1.4;
    }

    // ---- health: hurt fades, and you mend if left alone a few seconds
    this.hurtT += dt; this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2.5);
    if (!this.dead && this.hurtT > 5 && this.health < 100) this.health = Math.min(100, this.health + 14 * dt);
    if (this.dead) {
      const d = this.dead; d.t += dt;
      if (!d.moved && d.t > 1.6) {
        d.moved = true;
        for (const el of ELEMENT_ORDER) s.inv[el] = Math.ceil(s.inv[el] / 2);
        this.time.echo = null; this.time.slowT = this.time.freezeT = 0;
        this.warpTo(id, 0, 36);
        this.health = 100; this.save();
      }
      if (d.t > 3.2) { this.dead = null; player.frozen = false; }
    }
    // veil: red for hurt, blue while slowed, pale gold while frozen, black across a death
    const low = this.health < 35 && !this.dead ? 0.25 + 0.15 * Math.sin(time * 6) : 0;
    const tint = hud.veilU.uTint.value, fade = hud.veilU.uFade.value;
    if (this.hurtFlash > 0.01 || low) tint.set(0.9, 0.05, 0.03, Math.max(this.hurtFlash * 0.8, low));
    else if (this.time.freezeT > 0) tint.set(1.0, 0.9, 0.7, 0.45);
    else if (this.time.slowT > 0) tint.set(0.35, 0.75, 1.0, 0.4 * Math.min(1, this.time.slowT));
    else tint.w = 0;
    fade.set(0, 0, 0, this.dead ? Math.min(1, this.dead.t / 1.2, Math.max(0, (3.2 - this.dead.t) / 1.2)) : 0);
    hud.veil.visible = tint.w > 0.005 || fade.w > 0.005;

    // ---- the well and the gate
    if (this.pendingUnlock && (this.pendingUnlock.t -= dt) <= 0) { this.unlock(this.pendingUnlock.gate); this.pendingUnlock = null; }
    if (!this.transit && this.started && !this.dead) {
      if (gateDist > 160) gate.prompted = false;
      if (!inside && gateDist < 75 && !gate.prompted) {
        gate.prompted = true;
        if (!gate.open) {
          const needs = def.needs, ch = s.charge[id];
          const want = Object.keys(needs).filter((el) => (ch[el] || 0) < needs[el]);
          const can = want.find((el) => s.inv[el] > 0);
          const list = want.map((el) => `${needs[el] - (ch[el] || 0)} ${ELEMENTS[el].label}`).join(', ');
          hud.say(`${def.name}'s well is sealed`, can ? `Cast ${ELEMENTS[can].label} at the seal: aim and ${L.cast}` : `${def.lock} Needs ${list}.`, 7, ELEMENTS[def.element].css);
        } else hud.say(`${def.name}'s well`, 'Step in to fall to the core, where the gate hangs', 5, ELEMENTS[def.element].css);
      }
      if (inside) {
        gate.toLocal(headLocal, gl);
        const rr = Math.hypot(gl.x, gl.y - RING_Y);
        if (Math.abs(gl.z) > 1.6) gate.lastZ = Math.sign(gl.z);
        if (rr < 120 && !gate.corePrompt) {
          gate.corePrompt = true;
          if (gate.next) hud.say(s.order.length > 2 ? `Front: on to ${gate.next.planet.def.name} · Back: ${gate.prev.planet.def.name}` : `Wormhole to ${gate.next.planet.def.name}`, s.order.length > 2 ? 'Each face of the ring leads a different way round the chain' : 'Pass through the ring', 7, ELEMENTS[gate.next.element].css);
          else hud.say('The gate is dormant', 'Break the seal on another world to give it somewhere to lead', 6);
        }
        const to = gate.lastZ > 0 ? gate.next : gate.prev;
        if (to && gate.unlockT < 0 && Math.abs(gl.z) < 1.6 && rr < RING_R - 1.2) this.startTransit(gate, to, gate.lastZ > 0);
      } else gate.corePrompt = false;
      if (alt < 400 && !s.visited[id]) {
        s.visited[id] = true;
        const n = Object.keys(s.visited).length;
        if (n > 1) { hud.note(`${def.name} · ${def.title}`, ELEMENTS[def.element].css); this.audio.discover(); }
        this.save();
      }
    }

    // ---- markers: worlds when you are out among them; the rest only with objectives shown
    const obj = this.objective();
    camUp.set(0, 1, 0).applyQuaternion(this.camera.getWorldQuaternion(camQ));
    for (const p of this.planets) {
      const d = p.group.position.length(), R = p.def.radius;
      const info = { id: p.def.id, visible: d > R * 2.2 && !this.transit };
      if (info.visible) {
        info.dir = v1.copy(p.group.position).addScaledVector(camUp, R * 1.2 + d * 0.02).normalize().clone();
        info.name = p.def.name; info.css = ELEMENTS[p.def.element].css; info.dist = d - R;
        info.state = obj.goal === p.def.id ? 'goal' : s.open[p.def.id] ? 'open' : 'locked';
        info.sub = ELEMENTS[p.def.element].label + (s.open[p.def.id] ? ' · linked' : '');
        info.aimed = player.aimTarget === p;
      }
      hud.setMarker(info);
    }
    const guide = hud.showObjectives && !this.transit && !inside && P.group.position.length() <= def.radius * 2.2;
    const gm = { id: 'gate', visible: guide && gateDist > 90 };
    if (gm.visible) {
      gm.dir = v1.copy(gate.site).addScaledVector(gate.up, 14 + gateDist * 0.03).sub(headLocal).normalize().clone();
      gm.name = `${def.name} well`; gm.css = ELEMENTS[def.element].css; gm.dist = gateDist;
      gm.state = obj.goal === id && !obj.gather ? 'goal' : gate.open ? 'open' : 'locked';
      gm.sub = gate.open ? 'Open' : 'Sealed'; gm.aimed = false;
    }
    hud.setMarker(gm);
    const dm = { id: 'deposit', visible: false }, site = field.site;
    if (guide && obj.gather && obj.goal === id && site) {
      const bd = site.pos.distanceTo(headLocal);
      if (bd > 70) {
        dm.visible = true;
        dm.dir = v1.copy(site.pos).addScaledVector(site.up, 12 + bd * 0.03).sub(headLocal).normalize().clone();
        dm.name = TRIALS[def.element].name; dm.css = ELEMENTS[def.element].css; dm.dist = bd; dm.state = 'goal'; dm.sub = s.trial[id] ? 'Font: refill' : `Win ${ELEMENTS[def.element].label}`; dm.aimed = false;
      }
    }
    hud.setMarker(dm);
    // the Sun, once it is the goal
    const ad = player.pos.distanceTo(ARENA), sm = { id: 'sun', visible: s.won && !s.finale && !this.transit && !inside && ad > 400 };
    if (sm.visible) {
      sm.dir = v1.copy(ARENA).sub(player.pos).addScaledVector(camUp, ad * 0.03).normalize().clone();
      sm.name = 'The Sun'; sm.css = '#ffd27a'; sm.dist = ad; sm.state = 'goal'; sm.sub = 'The Heliarch'; sm.aimed = false;
    }
    hud.setMarker(sm);
    for (const [key, sign] of [['portalF', 1], ['portalB', -1]]) {
      const to = sign > 0 ? gate.next : gate.prev;
      const pm = { id: key, visible: inside && !!to && !this.transit && (s.order.length > 2 || sign > 0) };
      if (pm.visible) {
        gate.toLocal(headLocal, gl);
        pm.visible = s.order.length <= 2 || Math.sign(gl.z || 1) === sign;
        pm.dir = v1.copy(gate.center).addScaledVector(gate.up, RING_R + 4).sub(headLocal).normalize().clone();
        pm.name = to.planet.def.name; pm.css = ELEMENTS[to.element].css; pm.dist = headLocal.length();
        pm.state = obj.goal === to.planet.def.id ? 'goal' : 'open';
        pm.sub = s.order.length > 2 ? (sign > 0 ? 'Onward' : 'Back') : 'Wormhole'; pm.aimed = false;
      }
      hud.setMarker(pm);
    }

    // ---- radar: where things lie around you, by bearing and (log) distance
    if ((this.radarT -= dt) <= 0) {
      this.radarT = 0.1;
      const blips = [], onWorld = !inside && alt < def.radius * 0.5 && !this.transit;
      if (onWorld) {
        const up = player.up, f = this.camera.getWorldDirection(v2).addScaledVector(up, -v2.dot(up)).normalize().clone(), r = v2.crossVectors(f, up).clone();
        const goal = obj.goal === id ? (obj.gather ? 'deposit' : 'well') : null;
        const add = (local, kind, css, extra = {}) => {
          v1.copy(local).sub(headLocal);
          const x = v1.dot(r), y = v1.dot(f), d = Math.acos(Math.max(-1, Math.min(1, local.dot(headLocal) / (local.length() * headLocal.length())))) * def.radius;
          blips.push({ a: Math.atan2(x, y), d, kind, css, goal: goal === kind, ...extra });
        };
        add(gate.site, 'well', ELEMENTS[def.element].css, { open: gate.open });
        if (field.site) add(field.site.pos, 'deposit', ELEMENTS[def.element].css, { buried: !s.trial[id] });
        if (def.anomaly) { const a = this.time.anomaly(P); add(a.pos, 'anomaly', WEAPONS[a.weapon].css, { owned: this.time.has(a.weapon) }); }
        for (const e of combat.enemies) if (e.state === 'chase' || e.state === 'pursue') add(v1.copy(e.pos).sub(P.pos).clone(), 'foe', '#ff5a4a');
      }
      hud.setRadar(onWorld ? blips : null);
    }

    hud.update(dt, {
      css: ELEMENTS[def.element].css, linked: s.order.length, visited: Object.keys(s.visited).length,
      objective: obj.lines, inv: s.inv, speed: player.speed, alt,
      place: ad < 3000 ? 'The ring before the Sun' : inside ? `Inside ${def.name}` : alt < def.radius * 0.6 ? `${def.name} · ${def.title}` : `Deep space · nearest world ${def.name}`,
      health: this.health, castEl: this.castEl, weapon: this.time.current(), fury: this.fury / NOVA.need,
    });
    this.audio.update(player.speed, player.thrusting, def.element, inside ? 1 : 1 - smoothstep(def.radius * 0.05, def.radius * 0.9, alt));

    if (this.saveT > 0 && (this.saveT -= dt) <= 0) {
      try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch { /* ignore */ }
    }
  }
}
