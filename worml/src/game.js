// Game orchestration: world streaming, the elemental quest, wormhole transits,
// HUD state and persistence.
import * as THREE from 'three';
import { PLANETS, PLANET_BY_ID, ELEMENTS, ELEMENT_ORDER } from './worlds.js';
import { smoothstep } from './noise.js';
import { makeDetailTexture, syncEnv } from './gfx.js';
import { Planet, TerrainManager } from './planet.js';
import { Sky } from './sky.js';
import { Player } from './player.js';
import { Gate, RING_Y, RING_R } from './gates.js';
import { EssenceField } from './essence.js';
import { Props } from './props.js';
import { Hud } from './hud.js';
import { Streaks, Tunnel } from './fx.js';

const SAVE_KEY = 'worml-save-v1';
const QUEST = ['thalassa', 'pyra', 'ferrum', 'sylva', 'petra', 'arcana'];
const SOURCE = { water: 'thalassa', fire: 'pyra', metal: 'ferrum', wood: 'sylva', earth: 'petra', magic: 'arcana' };
const CAP = 9;

const headScene = new THREE.Vector3(), headLocal = new THREE.Vector3(), playerLocal = new THREE.Vector3();
const gl = new THREE.Vector3(), v1 = new THREE.Vector3(), camUp = new THREE.Vector3(), camQ = new THREE.Quaternion();

function freshState() {
  return {
    open: { thalassa: true }, order: ['thalassa'], dest: {}, visited: {}, won: false,
    inv: Object.fromEntries(ELEMENT_ORDER.map((e) => [e, 0])),
    charge: Object.fromEntries(PLANETS.map((p) => [p.id, {}])),
  };
}

export class Game {
  constructor({ renderer, scene, rig, camera, input, audio }) {
    Object.assign(this, { renderer, scene, rig, camera, input, audio });
    this.detail = makeDetailTexture(renderer);
    this.manager = new TerrainManager(2);
    this.sky = new Sky(renderer, scene, this.detail);
    this.planets = PLANETS.map((def, i) => new Planet(def, i, this.manager, this.detail, scene));
    this.gates = new Map(); this.fields = new Map();
    for (const p of this.planets) {
      const g = new Gate(p, this.detail);
      this.gates.set(p.def.id, g);
      this.fields.set(p.def.id, new EssenceField(p, g));
    }
    this.props = new Props();
    this.player = new Player(rig, camera, this.planets);
    this.hud = new Hud(scene, rig, camera, input);
    this.streaks = new Streaks(scene);
    this.tunnel = new Tunnel(rig, this.detail);
    this.transit = null; this.deliverT = 0; this.pendingUnlock = null; this.hintT = 0; this.saveT = 0;
    this.started = false; this.time = 0;

    this.state = freshState();
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) Object.assign(this.state, JSON.parse(raw));
    } catch { /* no storage: play without saving */ }
    for (const [id, g] of this.gates) g.setOpen(!!this.state.open[id], true);
    this.updateDests();

    const home = this.gates.get('thalassa');
    this.player.place(home.planet, home.frontDir(27), 0, home.z.clone().negate());
  }

  reset() {
    this.state = freshState();
    try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
    for (const [id, g] of this.gates) g.setOpen(!!this.state.open[id], true);
    this.updateDests();
  }

  save() { this.saveT = 0.5; }

  // Dev/test helper: hover above a world's gate site.
  warpTo(id, height = 0, back = 27) {
    const g = this.gates.get(id);
    this.player.place(g.planet, g.frontDir(back), height, g.z.clone().negate());
  }

  labels() {
    return this.renderer.xr.isPresenting ? { fly: 'point & squeeze TRIGGER', grip: 'GRIP', act: 'A' } : { fly: 'look & hold W', grip: 'E', act: 'F' };
  }

  begin() {
    if (this.started) return;
    this.started = true;
    const L = this.labels(), fresh = this.state.order.length === 1 && !this.state.inv.water;
    if (fresh) {
      this.hud.say('Welcome to Thalassa', `Hold ${L.grip} near the glowing orbs to gather Water`, 8, ELEMENTS.water.css);
      this.hud.say('To fly: ' + L.fly, 'The higher you are, the faster you go. Aim at a world to travel.', 9);
    } else this.hud.say('Welcome back', this.objective().lines[0], 6);
  }

  updateDests() {
    const s = this.state;
    for (const id of s.order) {
      const others = s.order.filter((o) => o !== id);
      let d = s.dest[id];
      if (!others.includes(d)) d = others[others.length - 1] || null;
      s.dest[id] = d;
      this.gates.get(id).setDest(d ? this.gates.get(d) : null);
    }
  }

  objective() {
    const s = this.state, L = this.labels();
    if (s.won) return { lines: ['The Worml network is complete', 'All six worlds are linked. Roam freely.'], goal: null };
    const id = QUEST.find((q) => !s.open[q]), def = PLANET_BY_ID[id];
    for (const el of Object.keys(def.needs)) {
      const short = def.needs[el] - (s.charge[id][el] || 0) - s.inv[el];
      if (short > 0) {
        const src = PLANET_BY_ID[SOURCE[el]];
        return { lines: [`Gather ${short} more ${ELEMENTS[el].label} essence on ${src.name}`, `Hold ${L.grip} near the glowing orbs`], goal: src.id };
      }
    }
    const here = this.player.planet.def.id === id && this.player.alt < 4000;
    return {
      lines: here ? [`Release your essence into the ${def.name} gate`, `Hold ${L.grip} beside the gate`]
        : [`Travel to ${def.name}: ${L.fly}`, def.lock],
      goal: id,
    };
  }

  unlock(gate) {
    const s = this.state, def = gate.planet.def;
    s.open[def.id] = true; s.order.push(def.id);
    gate.setOpen(true);
    this.updateDests();
    this.audio.unlock();
    this.hud.say(`${def.name} wormhole established`, 'Step through the ring to travel between linked worlds instantly', 8, ELEMENTS[def.element].css);
    if (QUEST.every((q) => s.open[q])) {
      s.won = true;
      this.hud.say('WORML COMPLETE', 'Every world is linked. The whole system is yours to roam.', 14, '#ffe9a8');
      this.audio.win();
    }
    this.save();
  }

  startTransit(gate) {
    this.transit = { t: 0, from: gate, to: gate.dest, moved: false, out: 0 };
    this.player.frozen = true;
    this.tunnel.u.uColor.value.set(...gate.color);
    this.tunnel.u.uColor2.value.set(...gate.dest.color);
    this.tunnel.aim(this.camera);
    this.audio.warp();
    for (const h of [this.input.left, this.input.right]) this.input.pulse(h, 0.8, 300);
  }

  updateTransit(dt) {
    const tr = this.transit;
    tr.t += dt;
    let alpha = Math.min(1, tr.t / 0.35);
    if (!tr.moved && tr.t > 0.5) {
      const to = tr.to;
      this.player.place(to.planet, to.frontDir(24), 0, to.z);
      this.tunnel.aim(this.camera);
      tr.moved = true;
    }
    // Hold the tunnel until the destination terrain has streamed in.
    if (tr.moved && tr.t > 2.6 && (this.manager.pending === 0 || tr.t > 10)) {
      tr.out += dt / 0.7;
      alpha = 1 - tr.out;
      if (tr.out >= 1) {
        this.transit = null;
        this.player.frozen = false;
        const def = tr.to.planet.def;
        this.hud.say(`${def.name}`, def.title, 4, ELEMENTS[def.element].css);
        alpha = 0;
      }
    }
    this.tunnel.set(alpha, smoothstep(0.4, 2.2, tr.t), this.time, this.camera);
  }

  frame(dt, time) {
    this.time = time;
    const { input, player, hud, state: s } = this;
    input.frame();
    if (this.transit) this.updateTransit(dt);
    player.update(dt, input);

    for (const p of this.planets) p.update(player.pos, time);
    this.manager.pump();
    const P = player.planet, def = P.def, id = def.id, alt = player.alt;
    syncEnv(P);
    this.sky.update(player.pos, time);

    this.camera.getWorldPosition(headScene);
    headLocal.copy(headScene).sub(P.group.position);
    playerLocal.copy(player.pos).sub(P.pos);
    const gate = this.gates.get(id), field = this.fields.get(id);
    for (const g of this.gates.values()) g.group.visible = g === gate && alt < 90000;
    for (const f of this.fields.values()) f.mesh.visible = f === field && alt < 5000;
    const gateDist = gate.update(dt, time, headLocal);
    this.props.update(P, playerLocal, alt);
    this.streaks.update(dt, player.vel, player.speed, alt);

    // --- gather essence
    const hands = [];
    for (const h of [input.left, input.right]) if (h.active) hands.push({ p: v1.copy(h.pos).sub(P.group.position).clone(), grip: h.grip, src: h });
    if (field.mesh.visible && hands.length && !this.transit) {
      const got = field.update(dt, time, hands, headLocal, s.inv[def.element] < CAP);
      for (const h of got) {
        s.inv[def.element] = Math.min(CAP, s.inv[def.element] + 1);
        this.audio.pickup(def.element);
        input.pulse(h.src, 0.6, 50);
        this.save();
      }
    }

    // --- gate interaction
    this.deliverT -= dt; this.hintT -= dt;
    if (this.pendingUnlock && (this.pendingUnlock.t -= dt) <= 0) { this.unlock(this.pendingUnlock.gate); this.pendingUnlock = null; }
    if (!this.transit && this.started) {
      const L = this.labels();
      if (gateDist > 140) gate.prompted = false;
      if (gateDist < 60 && !gate.open && !this.pendingUnlock) {
        const needs = def.needs, ch = s.charge[id];
        const can = Object.keys(needs).find((el) => (ch[el] || 0) < needs[el] && s.inv[el] > 0);
        const want = Object.keys(needs).filter((el) => (ch[el] || 0) < needs[el]);
        if (!gate.prompted) {
          gate.prompted = true;
          const list = want.map((el) => `${needs[el] - (ch[el] || 0)} ${ELEMENTS[el].label}`).join(', ');
          hud.say(`${def.name} gate is sealed`, can ? `Hold ${L.grip} to release your ${ELEMENTS[can].label} essence` : `${def.lock} Needs ${list}.`, 7, ELEMENTS[def.element].css);
        }
        const hand = hands.find((h) => h.grip > 0.5);
        if (hand && this.deliverT <= 0) {
          if (can) {
            s.inv[can]--; ch[can] = (ch[can] || 0) + 1;
            gate.sendOrb(gate.toLocal(hand.p, gl), ELEMENTS[can].rgb);
            gate.flash(ELEMENTS[can].rgb);
            this.audio.deliver(can);
            input.pulse(hand.src, 0.7, 60);
            this.deliverT = 0.32;
            if (Object.keys(needs).every((el) => (ch[el] || 0) >= needs[el])) this.pendingUnlock = { gate, t: 0.8 };
            this.save();
          } else if (this.hintT <= 0) {
            this.hintT = 6;
            const el = want[0];
            hud.say(`No ${ELEMENTS[el].label} essence to release`, `Gather it on ${PLANET_BY_ID[SOURCE[el]].name}`, 4);
          }
        }
      } else if (gateDist < 60 && gate.open && gate.unlockT < 0) {
        if (!gate.prompted) {
          gate.prompted = true;
          if (gate.dest) hud.say(`Wormhole to ${gate.dest.planet.def.name}`, s.order.length > 2 ? `Step through the ring · press ${L.act} to change destination` : 'Step through the ring to travel', 6, ELEMENTS[gate.dest.element].css);
          else hud.say('Wormhole dormant', 'Unseal a gate on another world to link it here', 6);
        }
        if (input.actEdge && s.order.length > 2) {
          const others = s.order.filter((o) => o !== id);
          s.dest[id] = others[(others.indexOf(s.dest[id]) + 1) % others.length];
          this.updateDests();
          hud.say(`Destination: ${gate.dest.planet.def.name}`, gate.dest.planet.def.title, 3, ELEMENTS[gate.dest.element].css);
          this.save();
        }
        gate.toLocal(headLocal, gl);
        if (gate.dest && Math.abs(gl.z) < 1.6 && Math.hypot(gl.x, gl.y - RING_Y) < RING_R - 1.2) this.startTransit(gate);
      }
      if (alt < 400 && !s.visited[id]) {
        s.visited[id] = true;
        const n = Object.keys(s.visited).length;
        if (n > 1) { hud.say(`${def.name} · ${def.title}`, `World ${n} of 6 discovered`, 6, ELEMENTS[def.element].css); this.audio.discover(); }
        this.save();
      }
    }

    // --- markers
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
    const onWorld = P.group.position.length() <= def.radius * 2.2;
    const gm = { id: 'gate', visible: onWorld && gateDist > 75 && !this.transit };
    if (gm.visible) {
      gm.dir = v1.copy(gate.center).addScaledVector(gate.up, 14 + gateDist * 0.03).sub(headLocal).normalize().clone();
      gm.name = `${def.name} gate`; gm.css = ELEMENTS[def.element].css; gm.dist = gateDist;
      gm.state = obj.goal === id ? 'goal' : gate.open ? 'open' : 'locked';
      gm.sub = gate.open ? 'Wormhole open' : 'Sealed'; gm.aimed = false;
    }
    hud.setMarker(gm);

    hud.update(dt, {
      css: ELEMENTS[def.element].css, linked: s.order.length, visited: Object.keys(s.visited).length,
      objective: obj.lines, inv: s.inv, speed: player.speed, alt,
      place: alt < def.radius * 0.6 ? `${def.name} · ${def.title}` : `Deep space · nearest world ${def.name}`,
    });
    this.audio.update(player.speed, player.thrusting, def.element, 1 - smoothstep(def.radius * 0.05, def.radius * 0.9, alt));

    if (this.saveT > 0 && (this.saveT -= dt) <= 0) {
      try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch { /* ignore */ }
    }
  }
}
