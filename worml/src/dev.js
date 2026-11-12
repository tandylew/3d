// Developer dashboard: live telemetry, quick warps to the places worth
// judging, quest shortcuts, look/flight tuning and self-playing demos that
// show each control in action. Opened with the DEV button, the ` key or ?dev.
import * as THREE from 'three';
import { PLANETS, ELEMENTS, SUN, terrainRaw } from './worlds.js';
import { FLIGHT } from './player.js';
import { fmtDist, fmtSpeed } from './hud.js';
import { mulberry32 } from './noise.js';

const PLACES = [
  ['gate', 'Wellhead'], ['core', 'Core gate'], ['deposit', 'Essence deposit'], ['anomaly', 'Time anomaly'], ['shore', 'Shore'], ['peak', 'Summit'],
  ['sunset', 'Sunset'], ['night', 'Night side'], ['clouds', 'Above clouds'], ['orbit', 'Low orbit'], ['far', 'Far view'],
];
const CTRL = {
  fly: { vr: 'Point a hand + Trigger', key: 'F for flight, then W', touch: 'FLY on, then left stick', hl: ['fly', 'stick'] },
  brake: { vr: 'Release Trigger', key: 'Release W', touch: 'Release the stick', hl: [] },
  move: { vr: 'Left stick', key: 'W A S D', touch: 'Left stick (right stick looks)', hl: ['stick', 'look'] },
  jump: { vr: 'A or X', key: 'Space', touch: 'LEAP', hl: ['jump'] },
  land: { vr: 'Release below 500 m', key: 'F for flight off', touch: 'FLY off', hl: ['fly'] },
  cast: { vr: 'Right grip, aim the hand', key: 'Left click', touch: 'CAST', hl: ['cast'] },
  time: { vr: 'Left grip (B switches relic)', key: 'E (Q switches relic)', touch: 'TIME (⟳ switches relic)', hl: ['time'] },
  none: null,
};
const DEMOS = [
  ['flight', 'Take off, cruise, land'], ['walk', 'Walk, strafe, super leap'], ['gather', 'Gather essence'], ['fight', 'Fight guardians'],
  ['relics', 'The four time relics'], ['unseal', 'Break a seal'], ['transit', 'Core, gate, and back up'], ['travel', 'Fly to another world'],
];
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), q1 = new THREE.Quaternion();
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

export class Dev {
  constructor({ game, input, renderer, camera, touch, quality, hooks }) {
    Object.assign(this, { game, input, renderer, camera, touch, quality, hooks });
    this.el = document.getElementById('dev');
    this.banner = document.getElementById('demo-banner');
    this.isOpen = false; this.world = 'thalassa';
    this.demo = null; this.dt = 0; this.tele = 0; this.frames = 0; this.acc = 0; this.fps = 0; this.worst = 0;
    this.sunAngle = 0; this.cloudOff = 0;
    this.scanCache = {};
    this.build();
    addEventListener('keydown', (e) => {
      if (e.code === 'Backquote') { this.toggle(); e.preventDefault(); }
      if (e.code === 'Escape' && this.demo) this.stopDemo();
    });
  }

  // ------------------------------------------------------------------ UI
  build() {
    const chips = PLANETS.map((p) => `<button class="chip" data-world="${p.id}" style="--c:${ELEMENTS[p.element].css}">${p.name}</button>`).join('');
    const places = PLACES.map(([k, l]) => `<button data-place="${k}">${l}</button>`).join('');
    const demos = DEMOS.map(([k, l]) => `<button data-demo="${k}">▶ ${l}</button>`).join('');
    const slider = (id, label, min, max, step, val) => `<label class="sl"><span>${label}</span><input type="range" id="dv-${id}" min="${min}" max="${max}" step="${step}" value="${val}"><output id="dvo-${id}"></output></label>`;
    const toggle = (id, label, on = true) => `<label class="tg"><input type="checkbox" id="dv-${id}" ${on ? 'checked' : ''}>${label}</label>`;
    this.el.innerHTML = `
      <header><b>Worml dev</b><span id="dv-fps"></span><button id="dv-close" title="Close">✕</button></header>
      <details open><summary>Telemetry</summary><div id="dv-tele" class="tele"></div></details>
      <details open><summary>Warp</summary>
        <div class="chips">${chips}</div>
        <div class="grid">${places}</div>
        <div class="grid"><button data-place="sun">The sun</button><button data-place="system">System overview</button><button data-place="midway">Deep space</button></div>
        <p class="note" id="dv-vrnote">Warp first, then <button id="dv-vr" class="link">enter VR from here</button> to judge a spot in the headset.</p>
      </details>
      <details open><summary>Control demos</summary>
        <div class="grid two">${demos}</div>
        <p class="note">Each demo plays the game for you and names the control it is using on every device. Esc or Stop ends it.</p>
      </details>
      <details><summary>Quest</summary>
        <div id="dv-quest" class="tele"></div>
        <div class="grid two">
          <button data-quest="next">Unseal next gate</button><button data-quest="all">Unseal all gates</button>
          <button data-quest="give">Fill essence</button><button data-quest="empty">Empty essence</button>
          <button data-quest="relics">Give all relics</button><button data-quest="foes">Summon guardians</button>
          <button data-quest="heal">Heal</button><button data-quest="hurt">Take 40 damage</button>
          <button data-quest="reset">Reset progress</button>
        </div>
      </details>
      <details><summary>Look &amp; flight tuning</summary>
        ${slider('exposure', 'Exposure', 0.4, 2, 0.02, this.renderer.toneMappingExposure)}
        ${slider('sun', 'Sun angle here', -110, 110, 1, 0)}
        ${slider('cloud', 'Cloud cover', -0.2, 0.2, 0.01, 0)}
        ${slider('res', 'Render scale', 0.4, 1, 0.05, 1)}
        ${slider('v0', 'Ground speed m/s', 5, 200, 1, FLIGHT.V0)}
        ${slider('rate', 'Speed per metre of altitude', 0.1, 3, 0.05, FLIGHT.RATE)}
        <div class="grid two">
          ${toggle('autores', 'Auto render scale')}${toggle('clouds', 'Clouds')}${toggle('atmo', 'Atmosphere')}
          ${toggle('props', 'Scenery')}${toggle('markers', 'World markers')}${toggle('wire', 'Wireframe', false)}
        </div>
        <div class="grid two"><button data-tune="reset">Reset tuning</button></div>
      </details>
      <details><summary>Controls &amp; live input</summary>
        <table class="ctl">
          <tr><th></th><th>Quest</th><th>Keyboard</th><th>Touch</th></tr>
          <tr><td>Fly</td><td>Trigger, aim hand</td><td>F toggles, W</td><td>FLY toggles, left stick</td></tr>
          <tr><td>Walk</td><td>Left stick</td><td>W A S D</td><td>Left stick</td></tr>
          <tr><td>Look / turn</td><td>Head, right stick</td><td>Mouse</td><td>Right stick</td></tr>
          <tr><td>Super leap</td><td>A / X</td><td>Space</td><td>LEAP</td></tr>
          <tr><td>Cast element</td><td>Right grip</td><td>Click</td><td>CAST</td></tr>
          <tr><td>Time relic</td><td>Left grip</td><td>E</td><td>TIME</td></tr>
          <tr><td>Switch relic</td><td>B</td><td>Q, 1-4</td><td>⟳</td></tr>
          <tr><td>Objectives</td><td>Y</td><td>H</td><td>◎</td></tr>
        </table>
        <div id="dv-input" class="bars"></div>
      </details>`;
    const $ = (id) => this.el.querySelector('#' + id);
    this.$ = $;
    $('dv-close').onclick = () => this.close();
    $('dv-vr').onclick = () => this.hooks.enterVR();
    this.el.addEventListener('click', (e) => {
      const t = e.target.closest('button'); if (!t) return;
      const d = t.dataset;
      if (d.world) { this.world = d.world; this.markWorld(); this.warp(d.world, 'gate'); }
      else if (d.place) this.warp(this.world, d.place);
      else if (d.demo) this.startDemo(d.demo);
      else if (d.quest) this.quest(d.quest);
      else if (d.tune) this.resetTuning();
      t.blur();
    });
    this.el.addEventListener('input', (e) => this.tune(e.target));
    this.markWorld();
    for (const id of ['exposure', 'sun', 'cloud', 'res', 'v0', 'rate']) this.tune($('dv-' + id));
  }

  markWorld() { for (const b of this.el.querySelectorAll('[data-world]')) b.classList.toggle('sel', b.dataset.world === this.world); }

  open() {
    this.isOpen = true; this.el.hidden = false; document.body.classList.add('dev-open');
    document.exitPointerLock?.();
    this.input.dragLook = true;
    this.world = this.game.player.planet.def.id; this.markWorld();
    this.$('dv-vrnote').hidden = !this.hooks.vrSupported();
    this.hooks.play();
  }

  close() { this.isOpen = false; this.el.hidden = true; document.body.classList.remove('dev-open'); this.input.dragLook = false; }

  toggle() { if (this.isOpen) this.close(); else this.open(); }

  // -------------------------------------------------------------- tuning
  tune(t) {
    if (!t || !t.id) return;
    const id = t.id.slice(3), v = t.type === 'checkbox' ? t.checked : Number(t.value), g = this.game;
    const out = this.el.querySelector('#dvo-' + id);
    if (out) out.textContent = id === 'sun' ? v + '°' : id === 'res' ? Math.round(v * 100) + '%' : v;
    switch (id) {
      case 'exposure': this.renderer.toneMappingExposure = v; break;
      case 'sun': this.sunAngle = v; break;
      case 'cloud': this.cloudOff = v; for (const p of g.planets) p.uniforms.uCloudP.value.x = p.def.look.clouds.threshold - v; break;
      case 'res': this.quality.set(v); break;
      case 'v0': FLIGHT.V0 = v; break;
      case 'rate': FLIGHT.RATE = v; break;
      case 'autores': this.quality.auto = v; break;
      case 'clouds': for (const p of g.planets) p.clouds.visible = v; break;
      case 'atmo': for (const p of g.planets) p.shell.visible = v; break;
      case 'props': g.props.enabled = v; break;
      case 'markers': g.hud.markersOn = v; break;
      case 'wire': for (const p of g.planets) p.material.wireframe = v; break;
    }
  }

  resetTuning() {
    const set = (id, v) => { const t = this.$('dv-' + id); if (t.type === 'checkbox') t.checked = v; else t.value = v; this.tune(t); };
    set('exposure', 1); set('sun', 0); set('cloud', 0); set('v0', 26); set('rate', 0.8);
    for (const id of ['autores', 'clouds', 'atmo', 'props', 'markers']) set(id, true);
    set('wire', false);
  }

  // Slide the sun across the sky of the world you are on (lighting preview only).
  applySun() {
    const pl = this.game.player;
    for (const p of this.game.planets) {
      if (p !== pl.planet || !this.sunAngle) { p.sunDir.copy(p.baseSun); continue; }
      v1.crossVectors(p.baseSun, pl.up);
      if (v1.lengthSq() < 1e-6) v1.set(1, 0, 0);
      p.sunDir.copy(p.baseSun).applyAxisAngle(v1.normalize(), (-this.sunAngle * Math.PI) / 180);
    }
  }

  // ---------------------------------------------------------------- warp
  scan(planet) {
    const def = planet.def;
    if (this.scanCache[def.id]) return this.scanCache[def.id];
    const rnd = mulberry32(def.seed + 5), sun = planet.baseSun, out = { peak: null, low: null, shore: null };
    const d = new THREE.Vector3();
    for (let i = 0; i < 2600; i++) {
      d.set(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1);
      if (d.lengthSq() > 1 || d.lengthSq() < 0.01) continue;
      d.normalize();
      const c = d.dot(sun);
      if (c < 0.3 || c > 0.93) continue;
      const h = terrainRaw(def, d.x, d.y, d.z);
      if (!out.peak || h > out.peak.h) out.peak = { d: d.clone(), h };
      if (!out.low || h < out.low.h) out.low = { d: d.clone(), h };
      if (def.liquid && h > 2 && h < 9 && !out.shore) {
        // want open liquid within a short walk
        for (let a = 0; a < 6 && !out.shore; a++) {
          v1.set(Math.cos(a), Math.sin(a * 1.7), Math.sin(a)).cross(d).normalize();
          v2.copy(d).addScaledVector(v1, 90 / def.radius).normalize();
          if (terrainRaw(def, v2.x, v2.y, v2.z) > -4) continue;
          v2.copy(d).addScaledVector(v1, -220 / def.radius).normalize();   // and real land behind
          if (terrainRaw(def, v2.x, v2.y, v2.z) > 25) out.shore = { d: d.clone(), h, toward: v1.clone() };
        }
      }
    }
    return (this.scanCache[def.id] = out);
  }

  // Point the play space so "forward" is `fwd`, keeping `upHint` roughly up.
  face(fwd, upHint) {
    const f = fwd.clone().normalize(), r = new THREE.Vector3().crossVectors(f, upHint).normalize();
    const u = new THREE.Vector3().crossVectors(r, f);
    this.game.rig.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(r, u, f.negate()));
  }

  warp(id, kind) {
    const g = this.game, pl = g.player, input = this.input;
    if (g.transit) return;
    this.stopDemo();
    const planet = g.planets.find((p) => p.def.id === id), def = planet.def, gate = g.gates.get(id), sun = planet.baseSun;
    const R = def.radius;
    input.yaw = 0; input.pitch = 0;
    const free = (pos, lookAt, upHint) => { pl.pos.copy(pos); pl.vel.set(0, 0, 0); pl.fall = 0; this.face(v1.copy(lookAt).sub(pos), upHint); };
    // a land direction at a given sun elevation (sine), searching round the terminator
    const atSun = (sinE) => {
      const t = new THREE.Vector3(0, 1, 0).cross(sun).normalize(), b = new THREE.Vector3().crossVectors(sun, t);
      let best = null;
      for (let i = 0; i < 64; i++) {
        const a = (i / 64) * Math.PI * 2;
        const d = sun.clone().multiplyScalar(sinE).addScaledVector(t, Math.cos(a) * Math.sqrt(1 - sinE * sinE)).addScaledVector(b, Math.sin(a) * Math.sqrt(1 - sinE * sinE));
        const h = terrainRaw(def, d.x, d.y, d.z);
        const score = (def.liquid && h < 3 ? 1000 : 0) + Math.abs(h - 60);
        if (!best || score < best.score) best = { d, score };
      }
      return best.d;
    };
    switch (kind) {
      case 'gate': g.warpTo(id, 0, 36); break;
      case 'core':
        if (!g.warpCore(id)) { g.warpTo(id, 0, 36); g.hud.say(`${def.name}'s well is sealed`, 'Quest → Unseal next gate opens it', 4); }
        break;
      case 'deposit': {
        const d = g.fields.get(id).deposits[0];
        pl.place(planet, d.up.clone().addScaledVector(gate.x, 60 / R), 0, gate.x.clone().negate());
        break;
      }
      case 'anomaly': {
        const a = def.anomaly;
        if (!a) { g.warpTo(id, 0, 36); g.hud.say(`No time anomaly on ${def.name}`, 'Thalassa, Pyra, Sylva and Petra each hold one', 4); break; }
        pl.place(planet, new THREE.Vector3(a.x, a.y, a.z).addScaledVector(gate.x, 26 / R), 0, gate.x.clone().negate());
        break;
      }
      case 'peak': { const s = this.scan(planet).peak; pl.place(planet, s.d, 1, v1.crossVectors(s.d, sun).clone()); input.pitch = -0.25; break; }
      case 'shore': {
        const sc = this.scan(planet), s = sc.shore || sc.low;
        pl.place(planet, s.d, 0.5, s.toward || v1.crossVectors(s.d, sun).clone());
        break;
      }
      case 'sunset': { const d = atSun(0.07); pl.place(planet, d, 1, sun.clone()); break; }
      case 'night': { const d = atSun(-0.75); pl.place(planet, d, 1, sun.clone()); break; }
      case 'clouds': pl.place(planet, gate.frontDir(27), def.look.clouds.alt + 1100, gate.z.clone().negate()); input.pitch = -0.3; break;
      case 'orbit': pl.place(planet, gate.frontDir(27), R * 0.55, v1.crossVectors(gate.up, sun).clone()); input.pitch = -0.75; break;
      case 'far': {
        const side = new THREE.Vector3().crossVectors(sun, new THREE.Vector3(0, 1, 0)).normalize();
        const d = sun.clone().multiplyScalar(0.62).addScaledVector(side, 0.78).normalize();
        free(planet.pos.clone().addScaledVector(d, R * 4.6), planet.pos, new THREE.Vector3(0, 1, 0));
        break;
      }
      case 'sun': { const d = PLANETS[0].pos; v2.set(d[0], d[1], d[2]).normalize(); free(v2.clone().multiplyScalar(SUN.radius * 4.5), new THREE.Vector3(), new THREE.Vector3(0, 1, 0)); break; }
      case 'system': free(new THREE.Vector3(0.3e6, 4.4e6, 0.9e6), new THREE.Vector3(), new THREE.Vector3(0, 0, -1)); break;
      case 'midway': {
        const here = pl.planet, goal = g.objective().goal;
        const to = g.planets.find((p) => p.def.id === goal && p !== here) || g.planets.find((p) => p !== here);
        free(here.pos.clone().lerp(to.pos, 0.5), to.pos, new THREE.Vector3(0, 1, 0));
        break;
      }
    }
    pl.grounded = false;
    input.flyMode = kind === 'clouds' || kind === 'orbit';      // arrive hovering when the place is in the air
    g.combat.dropPursuit();
  }

  quest(k) {
    const g = this.game;
    this.stopDemo();
    if (k === 'next') g.unlockNext();
    else if (k === 'all') { while (g.unlockNext()); }
    else if (k === 'give') g.grant(9);
    else if (k === 'empty') g.grant(0);
    else if (k === 'reset') { g.reset(); this.warp('thalassa', 'gate'); }
    else if (k === 'relics') { for (const w of ['pearls', 'rewinder', 'seeds', 'mantle']) g.time.give(w); }
    else if (k === 'foes') this.summon(3);
    else if (k === 'heal') g.health = 100;
    else if (k === 'hurt') g.hurt(40);
  }

  // Bring the nearest idle guardians of this world to the player, angry.
  summon(n) {
    const g = this.game, c = g.combat, up = g.player.up;
    const list = c.enemies.filter((e) => e.state === 'idle' && !e.foreign).sort((a, b) => a.pos.distanceTo(g.headSolar) - b.pos.distanceTo(g.headSolar)).slice(0, n);
    const t = new THREE.Vector3().crossVectors(up, new THREE.Vector3(0.3, 0.9, 0.1)).normalize(), b = new THREE.Vector3().crossVectors(up, t);
    list.forEach((e, i) => {
      const a = (i / n) * Math.PI * 2;
      e.pos.copy(g.headSolar).addScaledVector(t, Math.cos(a) * 32).addScaledVector(b, Math.sin(a) * 32).addScaledVector(up, 5);
      e.state = 'chase'; e.pacify = 0; e.hp = e.max; e.hist.length = 0;
    });
    return list;
  }

  // --------------------------------------------------------------- demos
  platform() { return this.renderer.xr.isPresenting ? 'vr' : this.input.touch.on ? 'touch' : 'key'; }

  cap(title, sub = '', ctrl = 'none') {
    const c = CTRL[ctrl], pf = this.platform();
    const chip = (k, label) => `<span class="${pf === k ? 'me' : ''}"><i>${label}</i>${esc(c[k])}</span>`;
    this.banner.innerHTML = `<div><b>${esc(title)}</b><em>${esc(sub)}</em>${c ? `<p>${chip('vr', 'Quest')}${chip('key', 'Keys')}${chip('touch', 'Touch')}</p>` : ''}</div><button id="demo-stop">Stop</button>`;
    this.banner.querySelector('#demo-stop').onclick = () => this.stopDemo();
    this.banner.hidden = false;
    this.touch?.highlight(c ? c.hl : []);
  }

  startDemo(name) {
    if (this.game.transit) return;
    this.stopDemo();
    this.hooks.play();
    this.dbg = this.input.debug = { trigger: 0, cast: false, dir: new THREE.Vector3(0, 0, -1), move: new THREE.Vector2(), lift: 0, fly: true };
    this.demo = this['demo_' + name]();
  }

  stopDemo() {
    if (!this.demo) return;
    this.demo = null; this.input.debug = null; this.input.flyMode = false;
    this.banner.hidden = true;
    this.touch?.highlight([]);
  }

  // steer: fly along `dir` (scene space) and swing the flat-screen camera to match
  aim(dir) {
    const input = this.input, d = this.dbg;
    d.dir.copy(dir).normalize();
    if (this.renderer.xr.isPresenting) return;
    v1.copy(d.dir).applyQuaternion(q1.copy(this.game.rig.quaternion).invert());
    const yaw = Math.atan2(-v1.x, -v1.z), pitch = Math.asin(Math.max(-1, Math.min(1, v1.y)));
    const k = 1 - Math.exp(-this.dt * 4);
    let dy = yaw - input.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    input.yaw += dy * k; input.pitch += (Math.max(-1.45, Math.min(1.45, pitch)) - input.pitch) * k;
  }

  *wait(sec) { for (let t = 0; t < sec; t += this.dt) yield; }

  // Fly toward a planet-local point; stops within stopDist or when `until()` says so.
  *flyTo(planet, local, stopDist, maxSec, grip = 0, until = null) {
    const g = this.game, p = g.player, d = this.dbg, target = new THREE.Vector3(), head = new THREE.Vector3();
    for (let t = 0; t < maxSec; t += this.dt) {
      g.camera.getWorldPosition(head);
      target.copy(planet.pos).add(local).sub(p.pos).sub(head);
      if (target.length() < stopDist || (until && until())) break;
      const dir = target.clone().normalize();
      // skim round a world instead of pushing into the ground when the goal is over the horizon
      const inward = dir.dot(p.up), R = p.planet.def.radius;
      if (inward < 0 && p.alt < R * 0.4 && target.length() > R * 0.5) dir.addScaledVector(p.up, -inward).normalize();
      this.aim(dir); d.trigger = 1;
      yield;
    }
    d.trigger = 0;
  }

  nearestFoe() {
    const g = this.game; let best = null, bd = 1e9;
    for (const e of g.combat.enemies) { if (e.state !== 'chase' && e.state !== 'pursue') continue; const d = e.pos.distanceTo(g.headSolar); if (d < bd) { bd = d; best = e; } }
    return best;
  }

  aimAt(solar) { const g = this.game; this.aim(v2.copy(solar).sub(g.player.pos).sub(g.input.right.pos)); }

  *demo_flight() {
    const g = this.game, p = g.player, d = this.dbg, gate = g.gates.get(p.planet.def.id), planet = p.planet;
    this.cap('Take off', 'Turn flight on, then push forward: you fly where you look', 'fly');
    const fwd = new THREE.Vector3();
    for (let t = 0; t < 14 && p.alt < 1500; t += this.dt) {
      g.camera.getWorldDirection(fwd); fwd.addScaledVector(p.up, -fwd.dot(p.up)).normalize();
      this.aim(fwd.multiplyScalar(0.55).addScaledVector(p.up, 0.83)); d.trigger = 1; yield;
    }
    this.cap('Speed grows with altitude', `${FLIGHT.V0} m/s at the ground, plus ${FLIGHT.RATE} m/s for every metre of height. Now ${fmtSpeed(p.speed)}.`, 'fly');
    for (let t = 0; t < 9 && p.alt < 20000; t += this.dt) { this.aim(v2.copy(p.up)); d.trigger = 1; yield; }
    this.cap('Let go to brake', 'Release and you coast to a stop in a couple of seconds, at any speed. With flight on you hover.', 'brake');
    d.trigger = 0; yield* this.wait(3);
    this.cap('Descend', 'Aim at the ground. The limit shrinks as you approach, so arrival is always gentle', 'fly');
    yield* this.flyTo(planet, gate.frontDir(44).multiplyScalar(gate.site.length() + 3), 14, 40);
    this.cap('Touch down', 'Turn flight off and you settle on your feet', 'land');
    d.fly = false; yield* this.wait(4);
    this.stopDemo();
  }

  *demo_walk() {
    const g = this.game, p = g.player, d = this.dbg;
    d.fly = false;
    this.cap('Walk', 'One stick moves you, the other (or the mouse, or your head) looks', 'move');
    d.move.set(0, 1); yield* this.wait(3);
    this.cap('Strafe', 'Sideways, without turning', 'move');
    d.move.set(1, 0); yield* this.wait(2); d.move.set(-1, 0); yield* this.wait(2); d.move.set(0, 0);
    this.cap('Super leap', 'A giant jump into the sky, leaning the way you look', 'jump');
    d.jump = true; yield;
    for (let t = 0; t < 8 && (p.leaping || t < 1); t += this.dt) { this.cap('Super leap', `${fmtDist(Math.max(0, p.alt))} up and climbing. Leap again in the air to go higher still.`, 'jump'); yield; }
    this.cap('Hover, then come down', 'You arrive with flight on. Switch it off to sink back: the fall eases as the ground nears.', 'land');
    yield* this.wait(2.5);
    d.fly = false;
    for (let t = 0; t < 40 && !p.grounded; t += this.dt) yield;
    yield* this.wait(1.5);
    this.stopDemo();
  }

  *demo_gather() {
    const g = this.game, p = g.player, def = p.planet.def, field = g.fields.get(def.id), el = ELEMENTS[def.element];
    if (g.state.inv[def.element] > 6) g.state.inv[def.element] = 6;
    const near = field.nearest(p.pos.clone().sub(p.planet.pos)), dep = near.dist < 3000 && !near.dep.buried ? near.dep : field.deposits[0];
    this.cap(`Find ${el.label} essence`, 'A deposit: a ringed crater under a pillar of light, where the clouds have parted', 'fly');
    yield* this.flyTo(p.planet, dep.pos.clone().addScaledVector(dep.up, 30), 45, 60);
    for (let n = 0; n < 4; n++) {
      const here = p.pos.clone().sub(p.planet.pos);
      const o = dep.orbs.filter((q) => q.state === 0).map((q) => q.pos.clone().applyMatrix4(dep.g.matrix)).sort((a, b) => a.distanceTo(here) - b.distanceTo(here))[0];
      if (!o) break;
      this.cap(`Gather ${el.label} essence`, 'No button: move into the orbs and they fly to you', 'fly');
      yield* this.flyTo(p.planet, o, 4, 20);
      yield* this.wait(0.8);
      this.cap(`${g.state.inv[def.element]} ${el.label} essence`, 'It is now your power: every cast spends one', 'none');
    }
    yield* this.wait(2.5);
    this.stopDemo();
  }

  *demo_fight() {
    const g = this.game, d = this.dbg;
    g.grant(9); g.health = 100;
    const foes = this.summon(3);
    if (!foes.length) { this.cap('No guardians near', 'Warp to an essence deposit first'); yield* this.wait(3); this.stopDemo(); return; }
    this.cap('Guardians', 'They gather at deposits and attack when you come close. The demo has filled your essence.', 'none');
    yield* this.wait(2.5);
    for (let t = 0; t < 40; t += this.dt) {
      const e = this.nearestFoe(); if (!e) break;
      this.aimAt(e.pos); d.cast = true;
      const el = g.castEl;
      this.cap('Cast your element', el ? `${ELEMENTS[el].label} is chosen for you: what the target is weak to, if you carry it. Health ${Math.round(g.health)}` : 'Out of essence', 'cast');
      yield;
    }
    d.cast = false;
    this.cap('Essence freed', 'A fallen guardian leaves essence of its own element. Hurt mends after five quiet seconds.', 'none');
    yield* this.wait(5);
    this.stopDemo();
  }

  *demo_relics() {
    const g = this.game, p = g.player, d = this.dbg, tw = g.time;
    for (const w of ['pearls', 'rewinder', 'seeds', 'mantle']) g.state.weapons[w] = true;
    g.grant(9); g.health = 100; tw.pearls.n = 3; tw.seeds.n = 2; tw.cool.rewinder = tw.cool.mantle = 0;
    this.summon(4);
    this.cap('Four relics, four ways to bend time', 'Each is found at an anomaly on its own world. The demo has lent you all four.', 'none');
    yield* this.wait(3);
    g.state.sel = 'pearls'; d.time = true;
    this.cap('Stillwater Pearls: slow', 'Swallow one when you are bombarded. The world crawls; you do not.', 'time');
    for (let t = 0; t < 5; t += this.dt) { const e = this.nearestFoe(); if (e) { this.aimAt(e.pos); d.cast = true; } yield; }
    d.cast = false;
    g.state.sel = 'rewinder';
    this.cap('The Rewinder: reverse', 'Shoot a guardian and it retraces its path home. It also un-falls collapsed rock.', 'time');
    for (let t = 0; t < 3; t += this.dt) { const e = this.nearestFoe(); if (e) this.aimAt(e.pos); if (t > 1.2 && e && tw.cool.rewinder <= 0) d.time = true; yield; }
    g.state.sel = 'seeds';
    this.cap('Quickening Seeds: speed up', 'Throw one: a tree lives its whole life in a breath, its roots seize foes and spent essence regrows.', 'time');
    for (let t = 0; t < 1.5; t += this.dt) { const e = this.nearestFoe(); this.aimAt(e ? e.pos : v1.copy(g.headSolar).addScaledVector(p.up, -1)); yield; }
    d.time = true; yield* this.wait(5);
    g.state.sel = 'mantle'; d.time = true;
    this.cap('Mantle of the Held Moment: freeze', 'Time stops and an echo of you stays behind. Walk away: you are in two places at once.', 'time');
    d.fly = true; d.move.set(0.6, -1); yield* this.wait(4); d.move.set(0, 0);
    this.cap('Two places at once', 'Guardians attack the echo, and it casts whenever you cast', 'cast');
    for (let t = 0; t < 4; t += this.dt) { const e = this.nearestFoe(); if (e) { this.aimAt(e.pos); d.cast = true; } yield; }
    d.cast = false;
    this.cap('Step back into the echo', 'Use the mantle again and you are where you were', 'time');
    d.time = true; yield* this.wait(3.5);
    this.stopDemo();
  }

  *demo_unseal() {
    const g = this.game, d = this.dbg, gate = g.nextSealed();
    if (!gate) { this.cap('Every well is already open', 'Use Quest → Reset progress to seal them again'); yield* this.wait(4); this.stopDemo(); return; }
    const def = gate.planet.def;
    g.grantFor(gate);
    g.warpTo(def.id, 0, 46);
    this.cap(`${def.name}'s well is sealed`, def.lock + ' (the demo has granted the essence it needs)');
    yield* this.wait(4);
    this.cap('Cast at the seal', 'Aim at it: the element it needs is chosen for you', 'cast');
    for (let t = 0; t < 16 && !gate.open; t += this.dt) { this.aimAt(v1.copy(gate.planet.pos).add(gate.site).addScaledVector(gate.up, 3)); d.cast = t > 1; yield; }
    d.cast = false;
    this.cap(`${def.name}'s well is open`, 'The seal is gone and the shaft drops to the core, where the gate hangs');
    yield* this.wait(5);
    this.stopDemo();
  }

  *demo_transit() {
    const g = this.game, p = g.player, s = g.state, d = this.dbg;
    if (s.order.length < 2) { g.unlockNext(); this.cap('Opening a second well first', 'A wormhole needs two ends'); yield* this.wait(4.5); }
    const id = s.open[p.planet.def.id] ? p.planet.def.id : 'thalassa', gate = g.gates.get(id);
    g.warpTo(id, 0, 30);
    d.fly = false;
    this.cap(`${gate.planet.def.name}'s well`, 'Step into the shaft and it carries you down', 'move');
    yield* this.wait(1.5);
    for (let t = 0; t < 12 && !p.inside; t += this.dt) { this.aimAt(v1.copy(gate.planet.pos).add(gate.site)); d.move.set(0, 1); yield; }
    d.move.set(0, 0);
    for (let t = 0; t < 40 && p.ride; t += this.dt) { this.cap('Falling to the core', `${fmtDist(Math.abs(p.alt))} down at ${fmtSpeed(p.speed)}: fastest mid-shaft, gentle at both ends`, 'none'); yield; }
    this.cap(`The gate, at the core of ${gate.planet.def.name}`, s.order.length > 2 ? `Front face: on to ${gate.next.planet.def.name}. Back face: back to ${gate.prev.planet.def.name}.` : `Through the ring to ${gate.next.planet.def.name}`, 'fly');
    d.fly = true;
    // come round to the front face, then through
    yield* this.flyTo(gate.planet, gate.z.clone().multiplyScalar(40), 6, 20);
    yield* this.flyTo(gate.planet, gate.z.clone().multiplyScalar(-6), 0.5, 20, 0, () => !!g.transit);
    this.cap('In transit', 'Nothing that was chasing you can follow');
    while (g.transit) yield;
    this.cap(`Core of ${p.planet.def.name}`, 'You step out of the far gate\'s back face: the door behind you leads back', 'none');
    yield* this.wait(4);
    this.cap('Ride the shaft up', 'A super leap inside a world carries you up to its wellhead', 'jump');
    d.jump = true; yield;
    for (let t = 0; t < 40 && (p.inside || p.eject > 0); t += this.dt) yield;
    yield* this.wait(3);
    this.stopDemo();
  }

  *demo_travel() {
    const g = this.game, p = g.player, from = p.planet, goal = g.objective().goal;
    const to = g.planets.find((q) => q.def.id === goal && q !== from) || g.planets.find((q) => q !== from);
    const tg = g.gates.get(to.def.id), R = from.def.radius;
    this.cap(`Flying to ${to.def.name}`, 'First climb: your speed limit rises with every metre of altitude', 'fly');
    yield* this.flyTo(from, p.pos.clone().sub(from.pos).setLength(R * 1.6), 500, 40);
    this.cap('Aim at the world marker', `Aim assist bends your course toward ${to.def.name}. ${fmtDist(p.pos.distanceTo(to.pos))} to go`, 'fly');
    yield* this.flyTo(to, tg.site.clone().setLength(to.def.radius * 3), to.def.radius * 0.3, 150);
    this.cap('Descent', 'Keep going: braking is automatic as the ground comes up', 'fly');
    yield* this.flyTo(to, tg.site.clone().addScaledVector(tg.z, 44).addScaledVector(tg.up, 2), 12, 150);
    this.cap(`Landed on ${to.def.name}`, to.def.title, 'land');
    this.dbg.fly = false;
    yield* this.wait(5);
    this.stopDemo();
  }

  // --------------------------------------------------------------- frame
  update(dt) {
    this.dt = dt;
    this.applySun();
    if (this.demo) {
      const r = this.demo.next();
      if (r.done) this.stopDemo();
    }
    this.frames++; this.acc += dt; this.worst = Math.max(this.worst, dt);
    if ((this.tele -= dt) > 0) return;
    this.tele = 0.25;
    this.fps = this.frames / (this.acc || 1); const worst = this.worst;
    this.frames = 0; this.acc = 0; this.worst = 0;
    if (!this.isOpen) return;
    const g = this.game, p = g.player, def = p.planet.def, info = this.renderer.info.render, s = g.state;
    const sunDeg = (Math.asin(Math.max(-1, Math.min(1, p.up.dot(p.planet.sunDir)))) * 180) / Math.PI;
    this.$('dv-fps').textContent = `${this.fps.toFixed(0)} fps`;
    const row = (k, v) => `<span>${k}</span><b>${v}</b>`;
    this.$('dv-tele').innerHTML = row('World', `${def.name} (${ELEMENTS[def.element].label})`) + row(p.inside ? 'Depth' : 'Altitude', fmtDist(Math.abs(p.alt)) + (p.grounded ? ' · grounded' : p.inside ? ' · inside' : ''))
      + row('Speed / limit', `${fmtSpeed(p.speed)} / ${fmtSpeed(p.vLimit)}`) + row('Sun elevation', sunDeg.toFixed(0) + '°')
      + row('Frame', `${(1000 / (this.fps || 1)).toFixed(1)} ms avg · ${(worst * 1000).toFixed(0)} ms worst`)
      + row('Draw calls / tris', `${info.calls} / ${(info.triangles / 1000).toFixed(0)}k`)
      + row('Health', `${Math.round(g.health)}${g.dead ? ' · dead' : ''}`) + row('Guardians', `${g.combat.enemies.length} posted · ${g.combat.hunting} hunting · ${g.combat.pursuing} pursuing`)
      + row('Time', g.time.freezeT > 0 ? 'frozen' : g.time.slowT > 0 ? 'slowed' : 'normal') + row('Relics', g.time.list().join(', ') || 'none')
      + row('Terrain queue', g.manager.pending || 0) + row('Scenery', g.props.count)
      + row('Render', `${this.renderer.domElement.width}×${this.renderer.domElement.height} (${Math.round(this.quality.scale * 100)}%)`);
    const obj = g.objective();
    this.$('dv-quest').innerHTML = row('Objective', esc(obj.lines[0])) + row('Linked', s.order.join(' → '))
      + row('Essence', Object.entries(s.inv).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(', ') || 'none');
    const i = this.input, bar = (k, v) => `<span>${k}</span><i><u style="width:${Math.round(Math.abs(v) * 100)}%;${v < 0 ? 'background:#ff8a5c' : ''}"></u></i>`;
    this.$('dv-input').innerHTML = bar('Fly', Math.max(i.left.trigger, i.right.trigger) || Math.min(i.left.trigger, i.right.trigger)) + bar('Move X', i.move.x) + bar('Move Y', i.move.y)
      + bar('Lift', i.lift) + bar('Cast', i.cast ? 1 : 0) + bar('Flight', i.flyMode ? 1 : 0);
    const rs = this.$('dv-res'); if (document.activeElement !== rs) { rs.value = this.quality.scale; this.$('dvo-res').textContent = Math.round(this.quality.scale * 100) + '%'; }
  }
}
