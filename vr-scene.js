/* vr-scene.js — WebXR scene: click "Enter VR" to grab and move cubes,
 * spheres, and prisms with the controller trigger. Also drag-able with the
 * mouse outside VR. Layout is persisted with kstore so it survives a refresh.
 */
import * as THREE from "three";
import { VRButton } from "three/addons/webxr/VRButton.js";
import { XRControllerModelFactory } from "three/addons/webxr/XRControllerModelFactory.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const container = document.getElementById("vrContainer");

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0f172a);
scene.fog = new THREE.Fog(0x0f172a, 4, 12);

const camera = new THREE.PerspectiveCamera(
  60, container.clientWidth / container.clientHeight, 0.01, 50
);
camera.position.set(0, 1.6, 2.4);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(container.clientWidth, container.clientHeight);
renderer.xr.enabled = true;
container.appendChild(renderer.domElement);
container.appendChild(VRButton.createButton(renderer));

const hemi = new THREE.HemisphereLight(0xffffff, 0x223344, 1.1);
scene.add(hemi);
const dir = new THREE.DirectionalLight(0xffffff, 1.2);
dir.position.set(2, 4, 2);
scene.add(dir);

const floor = new THREE.Mesh(
  new THREE.CircleGeometry(3, 48),
  new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 1 })
);
floor.rotation.x = -Math.PI / 2;
scene.add(floor);
scene.add(new THREE.GridHelper(6, 24, 0x334155, 0x1e293b));

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1, -0.5);
controls.enableDamping = true;
renderer.xr.addEventListener("sessionstart", () => { controls.enabled = false; });
renderer.xr.addEventListener("sessionend", () => { controls.enabled = true; });

// ---- objects ----
const COLORS = { cube: 0x6366f1, sphere: 0x22c55e, prism: 0xf59e0b };
const grabbables = [];

function makeGeometry(type) {
  if (type === "sphere") return new THREE.SphereGeometry(0.18, 32, 16);
  if (type === "prism") return new THREE.CylinderGeometry(0.2, 0.2, 0.32, 3);
  return new THREE.BoxGeometry(0.28, 0.28, 0.28);
}

function randomSpawnPosition() {
  return new THREE.Vector3(
    (Math.random() - 0.5) * 0.9,
    1 + Math.random() * 0.4,
    -0.8 + (Math.random() - 0.5) * 0.6
  );
}

function spawn(type, position, color) {
  const material = new THREE.MeshStandardMaterial({
    color: color ?? COLORS[type] ?? 0x94a3b8, roughness: 0.4, metalness: 0.1,
  });
  const mesh = new THREE.Mesh(makeGeometry(type), material);
  mesh.position.copy(position || randomSpawnPosition());
  mesh.userData.type = type;
  scene.add(mesh);
  grabbables.push(mesh);
  return mesh;
}

function clearAll() {
  grabbables.forEach((o) => scene.remove(o));
  grabbables.length = 0;
}

function serialize() {
  return grabbables.map((o) => ({
    type: o.userData.type,
    color: o.material.color.getHex(),
    x: o.position.x, y: o.position.y, z: o.position.z,
  }));
}

let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { kstore.set("vr/objects", serialize()); }, 300);
}

(async () => {
  const saved = await kstore.get("vr/objects", null);
  if (saved === null) {
    spawn("cube", new THREE.Vector3(-0.4, 1, -0.8));
    spawn("sphere", new THREE.Vector3(0, 1, -0.9));
    spawn("prism", new THREE.Vector3(0.4, 1, -0.8));
  } else {
    saved.forEach((o) => spawn(o.type, new THREE.Vector3(o.x, o.y, o.z), o.color));
  }
})();

document.getElementById("addCube").onclick = () => { spawn("cube"); persist(); };
document.getElementById("addSphere").onclick = () => { spawn("sphere"); persist(); };
document.getElementById("addPrism").onclick = () => { spawn("prism"); persist(); };
document.getElementById("clearAll").onclick = () => { clearAll(); persist(); };

// ---- VR controller grabbing ----
const raycaster = new THREE.Raycaster();
const tempMatrix = new THREE.Matrix4();
const controllerModelFactory = new XRControllerModelFactory();

function getIntersections(controller) {
  tempMatrix.identity().extractRotation(controller.matrixWorld);
  raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
  raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);
  return raycaster.intersectObjects(grabbables, false);
}

function onSelectStart(event) {
  const controller = event.target;
  const hits = getIntersections(controller);
  if (hits.length > 0) {
    const object = hits[0].object;
    controller.attach(object);
    controller.userData.selected = object;
  }
}

function onSelectEnd(event) {
  const controller = event.target;
  const object = controller.userData.selected;
  if (object) {
    scene.attach(object);
    controller.userData.selected = undefined;
    persist();
  }
}

for (let i = 0; i < 2; i++) {
  const controller = renderer.xr.getController(i);
  controller.addEventListener("selectstart", onSelectStart);
  controller.addEventListener("selectend", onSelectEnd);
  scene.add(controller);

  const ray = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1),
    ]),
    new THREE.LineBasicMaterial({ color: 0x6366f1 })
  );
  ray.scale.z = 1.5;
  controller.add(ray);

  const grip = renderer.xr.getControllerGrip(i);
  grip.add(controllerModelFactory.createControllerModel(grip));
  scene.add(grip);
}

// ---- mouse dragging outside VR ----
const pointer = new THREE.Vector2();
const dragPlane = new THREE.Plane();
const dragOffset = new THREE.Vector3();
let dragging = null;

function updatePointer(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
}

renderer.domElement.addEventListener("pointerdown", (e) => {
  if (renderer.xr.isPresenting) return;
  updatePointer(e);
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(grabbables, false);
  if (hits.length > 0) {
    dragging = hits[0].object;
    controls.enabled = false;
    const normal = camera.getWorldDirection(new THREE.Vector3()).negate();
    dragPlane.setFromNormalAndCoplanarPoint(normal, dragging.position);
    dragOffset.copy(hits[0].point).sub(dragging.position);
  }
});

renderer.domElement.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  updatePointer(e);
  raycaster.setFromCamera(pointer, camera);
  const hit = new THREE.Vector3();
  if (raycaster.ray.intersectPlane(dragPlane, hit)) {
    dragging.position.copy(hit.sub(dragOffset));
  }
});

window.addEventListener("pointerup", () => {
  if (dragging) {
    dragging = null;
    controls.enabled = true;
    persist();
  }
});

// ---- resize ----
new ResizeObserver(() => {
  const w = container.clientWidth, h = container.clientHeight;
  if (!w || !h) return;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}).observe(container);

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});
