// Flight model. The core rule: top speed is proportional to your distance from
// the nearest surface. Leaving a world you accelerate exponentially; arriving
// you decelerate the same way, so distance shrinks by a constant *ratio* per
// second. Crossing 400 km and creeping the last 40 m take the same few seconds.
import * as THREE from 'three';
import { SUN, groundHeight } from './worlds.js';
import { smoothstep } from './noise.js';

// Live-tunable from the dev dashboard.
export const FLIGHT = {
  V0: 26,          // m/s top speed at ground level
  RATE: 0.8,       // 1/s : speed limit gained per metre of altitude
  VMAX: 5e6,
  WALK: 7,
};
const SNAP = Math.PI / 6;

const up = new THREE.Vector3(), rel = new THREE.Vector3(), tv = new THREE.Vector3();
const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
const q = new THREE.Quaternion(), qi = new THREE.Quaternion();
const s1 = new THREE.Vector3(), s2 = new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0);

export class Player {
  constructor(rig, camera, planets) {
    this.rig = rig; this.camera = camera; this.planets = planets;
    this.pos = new THREE.Vector3();      // feet, solar-system coordinates (doubles)
    this.vel = new THREE.Vector3();
    this.up = new THREE.Vector3(0, 1, 0);
    this.fall = 0; this.grounded = false; this.frozen = false;
    this.planet = planets[0]; this.alt = 0; this.speed = 0; this.vLimit = FLIGHT.V0;
    this.aimTarget = null; this.thrusting = false;
  }

  // Bend the pointing direction toward a far world you're roughly aiming at,
  // so hitting a small disc across the solar system doesn't need sniper aim.
  assist(dir, apply) {
    let best = null, bestCos = 0;
    for (const p of this.planets) {
      s1.copy(p.pos).sub(this.pos);
      const d = s1.length();
      if (d < p.def.radius * 3) continue;
      const cos = dir.dot(s1.divideScalar(d));
      const cone = Math.cos(Math.max(0.16, Math.atan(p.def.radius / d) * 1.4));
      if (cos > cone && cos > bestCos) { best = p; bestCos = cos; s2.copy(s1); }
    }
    if (best && apply) dir.lerp(s2, 0.9).normalize();
    return best;
  }

  place(planet, dirVec, heightAbove = 0, forward = null) {
    const d = dirVec.clone().normalize();
    const g = groundHeight(planet.def, d.x, d.y, d.z);
    this.pos.copy(planet.pos).addScaledVector(d, planet.def.radius + g + heightAbove);
    this.vel.set(0, 0, 0); this.fall = 0;
    this.up.copy(d);
    // Orient the play space: +Y along the local up, -Z along `forward`.
    const f = (forward ? forward.clone() : new THREE.Vector3(0, 0, -1)).addScaledVector(d, -(forward || new THREE.Vector3(0, 0, -1)).dot(d));
    if (f.lengthSq() < 1e-6) f.set(1, 0, 0).addScaledVector(d, -d.x);
    f.normalize();
    const r = new THREE.Vector3().crossVectors(f, d).normalize();
    this.rig.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(r, d, f.clone().negate()));
    this.planet = planet;
  }

  update(dt, input) {
    // --- nearest world and altitude above its actual terrain
    let P = this.planets[0], bestAlt = Infinity;
    for (const p of this.planets) {
      const d = this.pos.distanceTo(p.pos) - p.def.radius;
      if (d < bestAlt) { bestAlt = d; P = p; }
    }
    this.planet = P;
    const R = P.def.radius;
    rel.copy(this.pos).sub(P.pos);
    let dist = rel.length();
    up.copy(rel).divideScalar(dist);
    let ground = groundHeight(P.def, up.x, up.y, up.z);
    let alt = dist - R - ground;
    const sunAlt = this.pos.length() - SUN.radius * 1.25;
    const { V0, RATE, VMAX, WALK } = FLIGHT;
    const vLimit = Math.min(VMAX, V0 + RATE * Math.max(0, Math.min(alt, sunAlt)));
    this.vLimit = vLimit;

    if (this.frozen) { this.vel.set(0, 0, 0); this.speed = 0; this.alt = alt; this.up.copy(up); return; }

    const nearW = 1 - smoothstep(R * 0.05, R * 0.9, alt); // 1 near the ground, 0 in open space

    // --- snap turn about the head, so the view pivots in place
    if (input.turnEdge) {
      a.copy(this.camera.position).applyQuaternion(this.rig.quaternion);
      this.rig.quaternion.multiply(q.setFromAxisAngle(Y, -input.turnEdge * SNAP));
      b.copy(this.camera.position).applyQuaternion(this.rig.quaternion);
      this.pos.add(a).sub(b);
    }

    // --- desired velocity: point a hand, squeeze the trigger, go
    tv.set(0, 0, 0);
    let flying = false;
    this.aimTarget = input.right.active ? this.assist(a.copy(input.right.dir), false) : null;
    for (const h of [input.left, input.right]) {
      if (!h.active || Math.abs(h.trigger) < 0.05) continue;
      a.copy(h.dir);
      if (nearW < 0.5 && h.trigger > 0) this.assist(a, true);
      tv.addScaledVector(a, h.trigger * vLimit);
      flying = true;
    }
    // thumbstick: stroll / strafe relative to where you look
    const rigUp = a.copy(Y).applyQuaternion(this.rig.quaternion);
    this.camera.getWorldDirection(b);
    b.addScaledVector(rigUp, -b.dot(rigUp) * nearW);
    if (b.lengthSq() > 1e-6) b.normalize();
    c.crossVectors(b, rigUp).normalize();
    const stroll = this.grounded ? WALK : Math.max(WALK, vLimit * 0.4);
    tv.addScaledVector(b, input.move.y * stroll).addScaledVector(c, input.move.x * stroll);
    if (input.lift) { tv.addScaledVector(rigUp, input.lift * Math.max(WALK, vLimit * 0.4)); flying = true; }
    if (tv.length() > vLimit) tv.setLength(vLimit);
    this.thrusting = flying;

    this.vel.lerp(tv, 1 - Math.exp(-dt * (tv.lengthSq() > 0.01 ? 2.2 : 3.0)));
    if (this.vel.length() > vLimit) this.vel.setLength(vLimit);

    // --- gentle gravity near the ground when not flying
    const wasGrounded = this.grounded;
    if (flying || alt > 500) this.fall = 0;
    else if (!this.grounded) this.fall = Math.min(this.fall + 11 * dt, 34);
    this.pos.addScaledVector(this.vel, dt).addScaledVector(up, -this.fall * dt);

    // --- collide with terrain
    rel.copy(this.pos).sub(P.pos);
    dist = rel.length();
    up.copy(rel).divideScalar(dist);
    ground = groundHeight(P.def, up.x, up.y, up.z);
    alt = dist - R - ground;
    const stick = wasGrounded && !flying && alt < 1.2;
    if (alt <= 0.02 || stick) {
      // ease over small bumps instead of jolting the view
      const target = stick && alt > -0.6 ? alt * Math.exp(-dt * 12) : 0;
      this.pos.copy(P.pos).addScaledVector(up, R + ground + target);
      alt = target;
      this.grounded = true; this.fall = 0;
      const vn = this.vel.dot(up);
      if (vn < 0) this.vel.addScaledVector(up, -vn);
    } else this.grounded = false;
    if (sunAlt < 0) this.pos.setLength(SUN.radius * 1.25);

    // --- near a world, roll the play space upright so you land on your feet
    if (nearW > 0) {
      rigUp.copy(Y).applyQuaternion(this.rig.quaternion);
      q.setFromUnitVectors(rigUp, up);
      qi.identity().slerp(q, Math.min(1, dt * 3.2 * nearW));
      this.rig.quaternion.premultiply(qi).normalize();
    }

    this.alt = alt; this.speed = this.vel.length() + this.fall; this.up.copy(up);
  }
}
