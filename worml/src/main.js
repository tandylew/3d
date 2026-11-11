import * as THREE from 'three';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { Game } from './game.js';
import { TouchControls } from './touch.js';
import { Dev } from './dev.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
const coarse = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0 && !matchMedia('(pointer: fine)').matches;
// Render resolution adapts to hold frame rate on phones and laptops (VR sets its own).
const quality = {
  max: Math.min(devicePixelRatio || 1, coarse ? 1.75 : 2), scale: Number(params.get('res')) || 1, auto: !params.has('res'), t: 0, n: 0,
  set(v) {
    this.scale = Math.max(0.4, Math.min(1, v));
    if (!renderer.xr.isPresenting) renderer.setPixelRatio(this.max * this.scale);
  },
  frame(dt) {
    if (!this.auto || renderer.xr.isPresenting) return;
    this.t += dt; this.n++;
    if (this.n < 50) return;
    const avg = this.t / this.n; this.t = 0; this.n = 0;
    if (avg > 1 / 43) this.set(this.scale * (avg > 1 / 28 ? 0.75 : 0.88));
    else if (avg < 1 / 57 && this.scale < 1) this.set(this.scale * 1.06);
  },
};
renderer.setPixelRatio(quality.max * quality.scale);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const rig = new THREE.Group();
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.08, 2e7);
camera.position.set(0, 1.7, 0);
rig.add(camera);
scene.add(rig);

function fit() {
  if (renderer.xr.isPresenting) return;
  camera.aspect = innerWidth / innerHeight;
  // Hold a usable horizontal field of view when the screen is tall and narrow.
  const tanV = Math.min(1.15, Math.max(Math.tan((36 * Math.PI) / 180), 0.52 / camera.aspect));
  camera.fov = (Math.atan(tanV) * 360) / Math.PI;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}
addEventListener('resize', fit);
addEventListener('orientationchange', () => setTimeout(fit, 250));
fit();

const input = new Input(renderer, rig, camera, renderer.domElement);
const audio = new Audio();
if (params.has('reset')) { try { localStorage.removeItem('worml-save-v1'); } catch { /* ignore */ } }
const game = new Game({ renderer, scene, rig, camera, input, audio });

// ---------------------------------------------------------------- front end
const overlay = $('overlay'), status = $('status'), vrBtn = $('enter-vr'), deskBtn = $('enter-desktop'), devBtn = $('open-dev');
const topbar = $('topbar');
const touch = new TouchControls(input, $('touch'));
let ready = false, frames = 0, quietFrames = 0, vrOk = false, playing = false;

function setTouch(on) {
  if (touch.enabled === on) return;
  touch.setEnabled(on);
  document.body.classList.toggle('touch', on);
}
function setPlaying(on) {
  playing = on;
  document.body.classList.toggle('playing', on);
  topbar.hidden = !on;
  if (!on) setTouch(false);
}
function hideOverlay() { overlay.classList.add('hidden'); }
function showOverlay() { overlay.classList.remove('hidden'); dev.close(); dev.stopDemo(); setPlaying(false); input.desktopActive = false; document.exitPointerLock?.(); }

async function enterVR() {
  audio.start();
  try {
    const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor'] });
    session.addEventListener('end', () => { showOverlay(); fit(); quality.set(quality.scale); });
    await renderer.xr.setSession(session);
    hideOverlay(); setPlaying(false); dev.close();
    game.begin();
  } catch (err) {
    status.textContent = 'Could not start VR: ' + (err?.message || err);
  }
}

// Play on the flat screen: touch controls on phones/tablets, mouse + keys otherwise.
function enterFlat(lockPointer = true) {
  audio.start();
  input.desktopActive = true;
  hideOverlay();
  setPlaying(true);
  if (coarse) {
    setTouch(true);
    const el = document.documentElement;
    try { (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el)?.then?.(() => screen.orientation?.lock?.('landscape').catch(() => {}))?.catch?.(() => {}); } catch { /* optional */ }
  } else if (lockPointer && !dev.isOpen) renderer.domElement.requestPointerLock?.();
  game.begin();
}

// A finger on the screen switches to touch controls even on hybrid devices.
addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch' && playing && !touch.enabled) { document.exitPointerLock?.(); setTouch(true); } }, true);

const dev = new Dev({
  game, input, renderer, camera, touch, quality,
  hooks: { enterVR, vrSupported: () => vrOk, play: () => { if (!playing && !renderer.xr.isPresenting && ready) enterFlat(false); } },
});

vrBtn.addEventListener('click', enterVR);
deskBtn.addEventListener('click', () => enterFlat(true));
devBtn.addEventListener('click', () => dev.open());
$('btn-dev').addEventListener('click', () => dev.toggle());
$('btn-menu').addEventListener('click', showOverlay);
$('reset').addEventListener('click', () => { game.reset(); status.textContent = 'Progress reset.'; });
if (coarse) deskBtn.textContent = 'Play';

if (navigator.xr?.isSessionSupported) {
  navigator.xr.isSessionSupported('immersive-vr').then((ok) => {
    vrOk = ok;
    vrBtn.hidden = !ok;
    if (ok) deskBtn.classList.add('secondary');
    else $('vr-note').hidden = false;
  }).catch(() => { $('vr-note').hidden = false; });
} else $('vr-note').hidden = false;

// ---------------------------------------------------------------- main loop
const clock = new THREE.Clock();
let time = 0;
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  time += dt;
  dev.update(dt);
  game.frame(dt, time);
  if (playing) quality.frame(dt);
  renderer.render(scene, camera);

  if (!ready) {
    frames++;
    quietFrames = game.manager.pending === 0 ? quietFrames + 1 : 0;
    status.textContent = `Shaping worlds… ${Math.min(99, Math.round(frames / 1.5))}%`;
    if (frames > 20 && quietFrames > 10) {
      ready = true;
      status.textContent = 'Ready.';
      vrBtn.disabled = deskBtn.disabled = devBtn.disabled = false;
      if (params.has('dev')) dev.open();
      document.body.classList.add('ready');
    }
  }
});

// Handy for debugging and automated tests.
window.worml = { game, input, renderer, scene, camera, rig, THREE, dev, touch, quality, get ready() { return ready; } };
