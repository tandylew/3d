import * as THREE from 'three';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { Game } from './game.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
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

addEventListener('resize', () => {
  if (renderer.xr.isPresenting) return;
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const input = new Input(renderer, rig, camera, renderer.domElement);
const audio = new Audio();
if (params.has('reset')) { try { localStorage.removeItem('worml-save-v1'); } catch { /* ignore */ } }
const game = new Game({ renderer, scene, rig, camera, input, audio });

// ---------------------------------------------------------------- front end
const overlay = $('overlay'), status = $('status'), vrBtn = $('enter-vr'), deskBtn = $('enter-desktop');
let ready = false, frames = 0, quietFrames = 0;

function hideOverlay() { overlay.classList.add('hidden'); }
function showOverlay() { overlay.classList.remove('hidden'); }

async function enterVR() {
  audio.start();
  try {
    const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor'] });
    session.addEventListener('end', () => { input.desktopActive = false; showOverlay(); });
    await renderer.xr.setSession(session);
    hideOverlay();
    game.begin();
  } catch (err) {
    status.textContent = 'Could not start VR: ' + (err?.message || err);
  }
}

function enterDesktop() {
  audio.start();
  input.desktopActive = true;
  hideOverlay();
  renderer.domElement.requestPointerLock?.();
  game.begin();
}

vrBtn.addEventListener('click', enterVR);
deskBtn.addEventListener('click', enterDesktop);
$('reset').addEventListener('click', () => { game.reset(); status.textContent = 'Progress reset.'; });

if (navigator.xr?.isSessionSupported) {
  navigator.xr.isSessionSupported('immersive-vr').then((ok) => {
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
  game.frame(dt, time);
  renderer.render(scene, camera);

  if (!ready) {
    frames++;
    quietFrames = game.manager.pending === 0 ? quietFrames + 1 : 0;
    status.textContent = `Shaping worlds… ${Math.min(99, Math.round(frames / 1.5))}%`;
    if (frames > 20 && quietFrames > 10) {
      ready = true;
      status.textContent = 'Ready.';
      vrBtn.disabled = deskBtn.disabled = false;
      document.body.classList.add('ready');
    }
  }
});

// Handy for debugging and automated tests.
window.worml = { game, input, renderer, scene, camera, rig, THREE, get ready() { return ready; } };
