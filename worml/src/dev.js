// Developer dashboard: live telemetry, quick warps to the places worth
// judging, quest shortcuts, look/flight tuning and self-playing demos that
// show each control in action. Opened with the DEV button, the ` key or ?dev.
import * as THREE from 'three';
import { PLANETS, ELEMENTS, SUN, WEAPONS, WEAPON_ORDER, WEAK_TO, TRIALS, terrainRaw, groundHeight } from './worlds.js';
import { CAST, NOVA } from './game.js';
import { ARENA } from './trials.js';
import { FLIGHT } from './player.js';
import { fmtDist, fmtSpeed } from './hud.js';
import { mulberry32 } from './noise.js';

const PLACES = [
  ['gate', 'Wellhead'], ['core', 'Core gate'], ['deposit', 'Element trial'], ['anomaly', 'Time anomaly'], ['shore', 'Shore'], ['peak', 'Summit'],
  ['sunset', 'Sunset'], ['night', 'Night side'], ['clouds', 'Above clouds'], ['orbit', 'Low orbit'], ['far', 'Far view'],
];
const CTRL = {
  fly: { vr: 'Point a hand + Trigger', key: 'W (after a leap)', touch: 'Left stick (after a leap)', hl: ['stick'] },
  brake: { vr: 'Release Trigger', key: 'Release W', touch: 'Release the stick', hl: [] },
  move: { vr: 'Left stick', key: 'W A S D', touch: 'Left stick (right stick looks)', hl: ['stick', 'look'] },
  jump: { vr: 'A or X (again while rising: higher)', key: 'Space (again while rising: higher)', touch: 'Double-tap the look side (tap again while rising: higher)', hl: ['jump'] },
  bail: { vr: 'Release the triggers', key: 'Space while flying', touch: 'Double-tap the look side while flying', hl: ['jump'] },
  nova: { vr: 'Click the right stick', key: 'G', touch: 'The ✹ button, when it appears', hl: ['nova'] },
  land: { vr: 'Release below 500 m', key: 'Fly down to the ground', touch: 'Fly down to the ground', hl: [] },
  cast: { vr: 'Right grip: tap, or hold to full charge', key: 'Left click: tap, or hold to full charge', touch: 'Tap, or press until the ring closes', hl: ['cast'] },
  slash: { vr: 'Swing a controller', key: 'V', touch: 'Swipe across the open screen', hl: ['slash'] },
  time: { vr: 'Left grip (B switches relic)', key: 'E (Q switches relic)', touch: 'The relic button (⟳ switches)', hl: ['time'] },
  mark: { vr: 'Hold left grip, then let go', key: 'Hold E, then let go', touch: 'Hold the relic button, then let go', hl: ['time'] },
  none: null,
};
const DEMOS = [
  ['flight', 'Take off, cruise, land'], ['walk', 'Walk, leap, amp up, bail out'], ['gather', 'Win an element trial'], ['fight', 'Blade, cast, burst, blast'],
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
        <div class="grid"><button data-place="arena">Sun arena</button><button data-place="sun">The sun</button><button data-place="system">System overview</button><button data-place="midway">Deep space</button></div>
        <p class="note" id="dv-vrnote">Warp first, then <button id="dv-vr" class="link">enter VR from here</button> to judge a spot in the headset.</p>
      </details>
      <details open><summary>Control demos</summary>
        <div class="grid two">${demos}</div>
        <p class="note">Each demo plays the game for you and names the control it is using on every device. Esc or Stop ends it.</p>
      </details>
      <details open><summary>Spells &amp; relics</summary>
        <p class="note">Spell: the element your casts spend. Auto picks what the target is weak to.</p>
        <div class="chips">${['water', 'fire', 'metal', 'wood', 'earth'].map((e) => `<button class="chip" data-spell="${e}" style="--c:${ELEMENTS[e].css}">${ELEMENTS[e].label}</button>`).join('')}<button class="chip sel" data-spell="auto" style="--c:#cfe0ff">Auto</button></div>
        <div class="grid"><button data-cast="quick">Quick cast<small>tap</small></button><button data-cast="perfect">Burst<small>full charge: homes and kills</small></button><button data-cast="nova">Blast<small>charged by 5 kills</small></button></div>
        <div class="meter" title="Live charge. The bright band is the perfect window."><u id="dv-charge" style="width:0"></u><b style="left:${(CAST.W0 / CAST.MAX) * 100}%;width:${((CAST.W1 - CAST.W0) / CAST.MAX) * 100}%"></b></div>
        <div class="grid two">${WEAPON_ORDER.map((w) => `<button data-relic="${w}" style="box-shadow: inset 0 0 0 1px ${WEAPONS[w].css}">${WEAPONS[w].name}<small>${WEAPONS[w].verb} · ${WEAPONS[w].form} · ${w === 'rewinder' ? 'click: mark, click: rewind' : 'give + use'}</small></button>`).join('')}</div>
        <div class="grid"><button data-arsenal="recharge">Recharge relics</button><button data-arsenal="foes">Summon 3</button><button data-arsenal="calm">Dismiss foes</button></div>
        <div id="dv-arsenal" class="tele"></div>
      </details>
      <details><summary>Quest</summary>
        <div id="dv-quest" class="tele"></div>
        <div class="grid two">
          <button data-quest="next">Unseal next gate</button><button data-quest="all">Unseal all gates</button>
          <button data-quest="give">Fill essence</button><button data-quest="empty">Empty essence</button>
          <button data-quest="relics">Give all relics</button><button data-quest="foes">Summon guardians</button>
          <button data-quest="heal">Heal</button><button data-quest="hurt">Take 40 damage</button>
          <button data-quest="master">Master all trials</button><button data-quest="finale">Go to the finale</button>
          <button data-quest="boss">Skip to the Heliarch</button>
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
          ${toggle('props', 'Scenery')}${toggle('markers', 'World markers')}${toggle('wire', 'Wireframe', false)}${toggle('guides', 'Guiding messages', false)}
        </div>
        <div class="grid two"><button data-tune="reset">Reset tuning</button></div>
      </details>
      <details><summary>Controls &amp; live input</summary>
        <table class="ctl">
          <tr><th></th><th>Quest</th><th>Keyboard</th><th>Touch</th></tr>
          <tr><td>Fly</td><td>Trigger, aim hand</td><td>F toggles, W</td><td>FLY toggles, left stick</td></tr>
          <tr><td>Walk</td><td>Left stick</td><td>W A S D</td><td>Left stick</td></tr>
          <tr><td>Look / turn</td><td>Head, right stick</td><td>Mouse</td><td>Right stick</td></tr>
          <tr><td>Leap / higher / bail</td><td>A / X</td><td>Space</td><td>Double-tap look side</td></tr>
          <tr><td>Blade</td><td>Swing</td><td>V</td><td>Swipe</td></tr>
          <tr><td>Blast</td><td>Right stick click</td><td>G</td><td>✹</td></tr>
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
      else if (d.spell) this.spell(d.spell);
      else if (d.cast) this.castNow(d.cast);
      else if (d.relic) this.relic(d.relic);
      else if (d.arsenal) this.arsenal(d.arsenal);
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
      case 'guides': g.hud.guides = v; break;
    }
  }

  resetTuning() {
    const set = (id, v) => { const t = this.$('dv-' + id); if (t.type === 'checkbox') t.checked = v; else t.value = v; this.tune(t); };
    set('exposure', 1); set('sun', 0); set('cloud', 0); set('v0', 26); set('rate', 0.8);
    for (const id of ['autores', 'clouds', 'atmo', 'props', 'markers']) set(id, true);
    set('wire', false); set('guides', false);
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
      case 'arena': { const side = new THREE.Vector3(1, 0, 0).cross(g.trials.up).normalize(); free(ARENA.clone().addScaledVector(g.trials.up, 150).addScaledVector(side, 190), ARENA, side.clone().cross(g.trials.up)); break; }
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
    input.flyMode = kind === 'clouds' || kind === 'orbit' || kind === 'arena';      // arrive hovering when the place is in the air
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
    else if (k === 'relics') { for (const w of Object.keys(WEAPONS)) g.time.give(w); }
    else if (k === 'foes') this.summon(3);
    else if (k === 'heal') g.health = 100;
    else if (k === 'master') { for (const p of PLANETS) g.state.trial[p.id] = true; g.grant(12); g.save(); }
    else if (k === 'finale' || k === 'boss') {
      while (g.unlockNext());
      for (const p of PLANETS) g.state.trial[p.id] = true;
      g.state.finale = false; g.grant(12); g.health = 100; g.trials.reset();
      this.warp('thalassa', 'arena');
      if (k === 'boss') { g.trials.f.phase = 'rest'; g.trials.f.wave = 1; g.trials.f.restT = 1; }
    }
    else if (k === 'hurt') g.hurt(40);
  }

  // ---- spells and relics
  spell(el) {
    const g = this.game;
    g.forceEl = el === 'auto' ? null : el;
    if (g.forceEl) { g.state.inv[el] = 12; g.hud.poke(); }
    for (const b of this.el.querySelectorAll('[data-spell]')) b.classList.toggle('sel', b.dataset.spell === el);
  }

  // Throw a cast of a given quality straight down the current aim.
  castNow(kind) {
    const g = this.game, i = this.input;
    let el = g.castEl;
    if (!el) { g.grant(12); el = g.forceEl || 'water'; }
    if (kind === 'nova') { g.fury = NOVA.need; i.novaEdge = true; this.dbgOnce = { nova: true }; return; }
    g.throwCast(v1.copy(i.right.pos).add(g.player.pos).clone(), i.right.dir.clone(), el, g.castPower(kind === 'quick' ? 0.08 : 1));
  }

  relic(id) {
    const g = this.game, tw = g.time;
    if (!tw.has(id)) g.state.weapons[id] = true;
    g.state.sel = id;
    if (id === 'rewinder') { if (tw.marks) tw.releaseMark(); else { tw.cool.rewinder = 0; tw.beginMark(); this.heldMark = true; } g.save(); return; }
    if (!(id === 'mantle' && tw.echo)) tw.recharge();
    tw.use(this.input.xr ? this.input.left : this.input.right);
    g.save();
  }

  arsenal(k) {
    const g = this.game;
    if (k === 'recharge') g.time.recharge();
    else if (k === 'foes') { this.summon(3); }
    else if (k === 'calm') { g.combat.clear((e) => e.tag === 'dev'); g.combat.dropPursuit(); }
  }

  // Raise n guardians of this world's element out of the ground around the player.
  summon(n, el = null) {
    const g = this.game, c = g.combat, pl = g.player, P = pl.planet, up = pl.up, space = pl.alt > 5000;
    const t = new THREE.Vector3().crossVectors(up, new THREE.Vector3(0.3, 0.9, 0.1)).normalize(), b = new THREE.Vector3().crossVectors(up, t), out = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + 0.4, pos = g.headSolar.clone().addScaledVector(t, Math.cos(a) * 26).addScaledVector(b, Math.sin(a) * 26);
      if (!space) { const d = pos.clone().sub(P.pos).normalize(); pos.copy(P.pos).addScaledVector(d, P.def.radius + groundHeight(P.def, d.x, d.y, d.z)); }
      out.push(c.spawn({ planet: P, pos, el: el || P.def.element, emerge: true, tag: 'dev', space, striker: i % 2 === 0 }));
    }
    return out;
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

  // Hold the cast until the charge reaches `to` seconds, then let go.
  *charged(aimFn, to = CAST.W0 + 0.1) {
    const g = this.game, d = this.dbg;
    d.cast = true;
    for (let t = 0; t < 2.2 && g.chargeT < to; t += this.dt) { aimFn(); yield; }
    d.cast = false; aimFn(); yield; yield;
  }

  aimAt(solar) { const g = this.game; this.aim(v2.copy(solar).sub(g.player.pos).sub(g.input.right.pos)); }

  *demo_flight() {
    const g = this.game, p = g.player, d = this.dbg, gate = g.gates.get(p.planet.def.id), planet = p.planet;
    this.cap('Take off', 'A leap puts you in the air; from there, forward flies where you look', 'fly');
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
    this.cap('Touch down', 'Within a few metres of the ground, flight ends and you settle on your feet', 'land');
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
    delete d.fly;
    d.jump = true; yield;
    for (let t = 0; t < 1.4; t += this.dt) { this.cap('Leap', `${fmtDist(Math.max(0, p.alt))} up. A plain leap tops out at a couple of hundred metres.`, 'jump'); yield; }
    d.jump = true; yield;
    for (let t = 0; t < 8 && p.leaping; t += this.dt) { this.cap('Amp it up', `Pressed again while rising: the leap keeps climbing. ${fmtDist(Math.max(0, p.alt))}`, 'jump'); yield; }
    this.cap('Flying', 'A leap leaves you flying where you look', 'fly');
    yield* this.wait(2);
    this.cap('Bail out', 'Drop straight back to the ground', 'bail');
    d.jump = true; yield;
    for (let t = 0; t < 60 && !p.grounded; t += this.dt) yield;
    yield* this.wait(1.5);
    this.stopDemo();
  }

  // Strike the nearest guardian: blades while it is close, perfect casts otherwise.
  *strike() {
    const g = this.game, e = this.nearestFoe(); if (!e) { yield; return; }
    const d = e.pos.distanceTo(g.headSolar);
    this.aimAt(e.head);
    if (d < 13 || !g.castEl) {
      const dir = v2.copy(e.head).sub(g.headSolar).normalize().clone();
      this.dbg.slash = { pos: this.input.right.pos.clone(), dir, sweep: new THREE.Vector3().crossVectors(dir, g.player.up).normalize(), power: 0.9 };
      yield* this.wait(0.3);
    } else yield* this.charged(() => { const q = this.nearestFoe(); if (q) this.aimAt(q.head); });
  }

  *demo_gather() {
    const g = this.game, p = g.player, def = p.planet.def, field = g.fields.get(def.id), el = ELEMENTS[def.element], T = TRIALS[def.element], site = field.site;
    if (g.state.trial[def.id]) { g.state.trial[def.id] = false; g.trials.reset(); }
    this.cap(`To ${T.name}`, `Follow the stream from the well. ${el.label} is won there, not picked up.`, 'fly');
    this.dbg.jump = true; yield* this.wait(3);
    yield* this.flyTo(p.planet, site.pos.clone().addScaledVector(site.up, 6).addScaledVector(site.t1, 24), 5, 60);
    this.dbg.fly = false;
    for (let t = 0; t < 150 && !g.state.trial[def.id]; t += this.dt) {
      const e = this.nearestFoe();
      this.cap(T.name, `${T.intro}. ${T.hazard} burst where a ring closes: keep moving. Wave ${Math.max(1, g.trials.wave + 1)} · health ${Math.round(g.health)}`, e && e.pos.distanceTo(g.headSolar) < 13 ? 'slash' : 'cast');
      this.dbg.move.set(Math.sin(t * 0.8) * 0.9, 0.25);          // keep circling so the eruptions miss
      if (e) yield* this.strike(); else yield;
      if (g.health < 45) g.health = 100;
    }
    this.dbg.move.set(0, 0);
    this.cap(`${el.label} mastered`, 'The font is awake. Stand by it whenever you need a refill.', 'none');
    yield* this.wait(5);
    this.stopDemo();
  }

  *demo_fight() {
    const g = this.game, d = this.dbg;
    g.grant(9); g.health = 100; d.fly = false;
    this.summon(3);
    this.cap('Guardians rise', 'Out of the ground, the pool, the fire. The demo has filled your essence.', 'none');
    yield* this.wait(2.5);
    for (let n = 0; n < 6 && this.nearestFoe(); n++) {
      const e = this.nearestFoe(), dir = v2.copy(e.head).sub(g.headSolar).normalize().clone();
      this.aimAt(e.head);
      this.cap('Blade', 'A swing or a swipe throws a blade of your element. It is free, short-ranged, and cuts everything it crosses. Through the head it hits far harder.', 'slash');
      d.slash = { pos: this.input.right.pos.clone(), dir, sweep: new THREE.Vector3().crossVectors(dir, g.player.up).normalize(), power: 0.9 };
      yield* this.wait(0.45);
    }
    for (let n = 0; n < 3 && this.nearestFoe(); n++) { this.cap('Quick cast', 'A tap throws a weak bolt at once. Each cast spends one essence.', 'cast'); yield* this.charged(() => { const e = this.nearestFoe(); if (e) this.aimAt(e.head); }, 0.06); yield* this.wait(0.25); }
    this.summon(5);
    yield* this.wait(1.6);
    for (let n = 0; n < 4 && this.nearestFoe(); n++) {
      const el = g.castEl;
      this.cap('Burst', `Hold to full charge and let go: a surge of ${el ? ELEMENTS[el].label : 'your element'} hunts the guardian down and destroys it. Water runs on to the next like a river; fire bursts; wood roots; earth staggers.`, 'cast');
      yield* this.charged(() => { const e = this.nearestFoe(); if (e) this.aimAt(e.head); }, CAST.W0 + 0.1);
      yield* this.wait(0.9);
    }
    if (g.fury < NOVA.need) g.fury = NOVA.need;
    this.summon(6);
    this.cap('The blast', 'Every kill charges it. When it is full, let it go: everything near you is struck at once.', 'nova');
    yield* this.wait(2.6);
    d.nova = true; yield* this.wait(1.5);
    for (let n = 0; n < 12 && this.nearestFoe(); n++) yield* this.strike();
    d.cast = false;
    this.cap('Essence freed', 'A fallen guardian leaves essence of its own element. Hurt mends after five quiet seconds.', 'none');
    yield* this.wait(5);
    this.stopDemo();
  }

  *demo_relics() {
    const g = this.game, p = g.player, d = this.dbg, tw = g.time;
    for (const w of ['pearls', 'rewinder', 'seeds', 'mantle']) g.state.weapons[w] = true;
    d.fly = false;
    g.grant(9); g.health = 100; tw.pearls.n = 3; tw.seeds.n = 2; tw.cool.rewinder = tw.cool.mantle = 0;
    this.summon(4);
    this.cap('Four relics, four ways to bend time', 'Each is found at an anomaly on its own world. The demo has lent you all four.', 'none');
    yield* this.wait(3);
    g.state.sel = 'pearls'; d.time = true;
    this.cap('Stillwater Pearls: slow', 'Swallow one when you are bombarded. The world crawls; you do not.', 'time');
    yield* this.wait(1);
    for (let n = 0; n < 3; n++) yield* this.charged(() => { const e = this.nearestFoe(); if (e) this.aimAt(e.head); });
    g.state.sel = 'rewinder';
    tw.cool.rewinder = 0;
    this.cap('The Rewinder: mark', 'Press and every guardian near you is marked where it stands (the gold rings)', 'mark');
    d.time = true; d.timeHeld = true;
    for (let t = 0; t < 3.2; t += this.dt) { d.move.set(0, -0.8); yield; }
    d.move.set(0, 0);
    this.cap('The Rewinder: rewind', 'Let go, and each is hauled back to its mark, however close it had come', 'mark');
    d.timeHeld = false; yield* this.wait(2.5);
    g.state.sel = 'seeds';
    this.cap('Quickening Seeds: speed up', 'Throw one: a tree lives its whole life in a breath, its roots seize foes and spent essence regrows.', 'time');
    for (let t = 0; t < 1.5; t += this.dt) { const e = this.nearestFoe(); this.aimAt(e ? e.pos : v1.copy(g.headSolar).addScaledVector(p.up, -1)); yield; }
    d.time = true; yield* this.wait(5);
    g.state.sel = 'mantle'; d.time = true;
    this.cap('Mantle of the Held Moment: freeze', 'Time stops and an echo of you stays behind. Walk away: you are in two places at once.', 'time');
    d.fly = true; d.move.set(0.6, -1); yield* this.wait(4); d.move.set(0, 0);
    this.cap('Two places at once', 'Guardians attack the echo, and it casts whenever you cast', 'cast');
    for (let n = 0; n < 3; n++) yield* this.charged(() => { const e = this.nearestFoe(); if (e) this.aimAt(e.head); });
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
    this.cap('Cast at the seal', 'Aim at it: the element it needs is chosen for you. A perfect cast counts double.', 'cast');
    for (let n = 0; n < 10 && !gate.open && !g.pendingUnlock; n++) yield* this.charged(() => this.aimAt(v1.copy(gate.planet.pos).add(gate.site).addScaledVector(gate.up, 3)));
    for (let t = 0; t < 6 && !gate.open; t += this.dt) yield;
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
    if (this.game.time.marks && this.heldMark && !this.demo) (this.input.debug ||= {}).timeHeld = true; else if (this.heldMark) { this.heldMark = false; if (this.input.debug && !this.demo) this.input.debug = null; }
    if (this.dbgOnce) { (this.input.debug ||= {}).nova = true; this.dbgOnce = null; }
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
      + row('Trial', g.trials.active ? `wave ${g.trials.wave + 1} · ${g.trials.phase}` : g.state.trial[def.id] ? 'mastered' : 'not started') + row('Finale', `${g.trials.f.phase}${g.trials.f.boss ? ` · Heliarch ${Math.round(g.trials.f.boss.hp)} hp as ${g.trials.f.boss.el}` : ''} · played ${Math.floor(s.playTime / 60)}:${String(Math.floor(s.playTime % 60)).padStart(2, '0')}`)
      + row('Time', g.time.freezeT > 0 ? 'frozen' : g.time.slowT > 0 ? `slowed to ${g.time.worldScale * 100}% · ${g.time.slowT.toFixed(1)} s left` : 'normal') + row('Relics', g.time.list().join(', ') || 'none')
      + row('Terrain queue', g.manager.pending || 0) + row('Scenery', g.props.count)
      + row('Render', `${this.renderer.domElement.width}×${this.renderer.domElement.height} (${Math.round(this.quality.scale * 100)}%)`);
    const tw = g.time, lh = g.lastHit;
    this.$('dv-charge').style.width = `${g.chargeT < 0 ? 0 : Math.min(100, (g.chargeT / CAST.MAX) * 100)}%`;
    this.$('dv-arsenal').innerHTML = row('Spell', g.forceEl ? ELEMENTS[g.forceEl].label + ' (forced)' : g.castEl ? ELEMENTS[g.castEl].label + ' (auto)' : 'none carried')
      + row('Last cast', g.lastCast || '–') + row('Last hit', lh ? `${lh.dmg} dmg · x${lh.mult}${lh.perfect ? ' · perfect' : ''}${lh.eye ? ' · eye' : ''} · foe at ${lh.hp} hp` : '–')
      + row('World time', `${Math.round(tw.worldScale * 100)}%${tw.slowT > 0 ? ` · slow ${tw.slowT.toFixed(1)} s` : ''}${tw.freezeT > 0 ? ` · frozen ${tw.freezeT.toFixed(1)} s` : ''}${tw.echo ? ' · echo out' : ''}`)
      + row('Pearls / seeds', `${tw.pearls.n}/${tw.pearls.max} · ${tw.seeds.n}/${tw.seeds.max}`)
      + row('Rewinder / mantle', `${tw.cool.rewinder > 0 ? tw.cool.rewinder.toFixed(1) + ' s' : 'ready'} · ${tw.echo ? 'echo out' : tw.cool.mantle > 0 ? tw.cool.mantle.toFixed(0) + ' s' : 'ready'}`);
    const obj = g.objective();
    this.$('dv-quest').innerHTML = row('Objective', esc(obj.lines[0])) + row('Linked', s.order.join(' → '))
      + row('Essence', Object.entries(s.inv).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(', ') || 'none');
    const i = this.input, bar = (k, v) => `<span>${k}</span><i><u style="width:${Math.round(Math.abs(v) * 100)}%;${v < 0 ? 'background:#ff8a5c' : ''}"></u></i>`;
    this.$('dv-input').innerHTML = bar('Fly', Math.max(i.left.trigger, i.right.trigger) || Math.min(i.left.trigger, i.right.trigger)) + bar('Move X', i.move.x) + bar('Move Y', i.move.y)
      + bar('Lift', i.lift) + bar('Cast', i.cast ? 1 : 0) + bar('Flight', i.flyMode ? 1 : 0);
    const rs = this.$('dv-res'); if (document.activeElement !== rs) { rs.value = this.quality.scale; this.$('dvo-res').textContent = Math.round(this.quality.scale * 100) + '%'; }
  }
}
