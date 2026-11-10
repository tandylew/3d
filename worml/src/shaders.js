// All GLSL lives here. Shaders are deliberately cheap per pixel: the Quest 3
// renders every fragment twice at high resolution, so lighting is analytic and
// surface detail is baked into vertex attributes by the terrain worker.

const ATMO = /* glsl */ `
const vec3 SUN_COLOR = vec3(1.0, 0.95, 0.86);
vec3 atmoColor(vec3 scatter, vec3 sunset, float sunElev, float mu, float thick) {
  float tw = 1.0 - smoothstep(-0.05, 0.42, sunElev);
  vec3 c = mix(scatter, sunset, tw * (0.3 + 0.7 * max(mu, 0.0)) * 0.9);
  vec3 pale = mix(c, vec3(dot(c, vec3(0.3333))), 0.25) * 1.2 + 0.03;
  c = mix(c, pale, thick * 0.5);
  return c * smoothstep(-0.26, 0.22, sunElev);
}
`;

const OUT = /* glsl */ `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
`;

// ------------------------------------------------------------------ terrain
export const terrainVS = /* glsl */ `
attribute vec3 aColor;
attribute vec3 aAux;
attribute vec3 aDpos;
varying vec3 vColor;
varying vec3 vAux;
varying vec3 vDpos;
varying vec3 vNormal;
varying vec3 vWorld;
void main() {
  vColor = aColor; vAux = aAux; vDpos = aDpos; vNormal = normal;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

export const terrainFS = /* glsl */ `
precision highp float;
uniform sampler2D uDetail;
uniform vec3 uCenter, uSunDir, uScatter, uSunset, uGlowColor;
uniform float uFog, uSpace, uTime, uCamSunElev;
varying vec3 vColor;
varying vec3 vAux;
varying vec3 vDpos;
varying vec3 vNormal;
varying vec3 vWorld;
${ATMO}
void main() {
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  vec3 up = normalize(vWorld - uCenter);
  float liq = step(0.5, vAux.x);

  // Surface detail. The 8 m layer is triplanar (3 fetches); the 64 m and 1.3 m
  // layers use one skewed planar fetch each, which never degenerates on any
  // axis-aligned slope. Five texture reads per pixel in total.
  vec3 w = up * up;
  vec2 flow = liq * uTime * vec2(0.021, 0.013);
  vec4 dx = texture2D(uDetail, vDpos.yz * 0.125 + flow);
  vec4 dy = texture2D(uDetail, vDpos.xz * 0.125 + flow);
  vec4 dz = texture2D(uDetail, vDpos.xy * 0.125 + flow);
  vec4 dn = dx * w.x + dy * w.y + dz * w.z;
  // integer coefficients keep the mapping continuous across patch tiles
  vec2 skew = vec2(vDpos.x + vDpos.y, vDpos.z - vDpos.y);
  vec4 dm = texture2D(uDetail, skew * 0.015625 - flow * 0.3);
  vec4 df = texture2D(uDetail, skew * 0.75 + flow * 2.0);
  float fineF = 1.0 / (1.0 + dist * 0.12);
  float nearF = 1.0 / (1.0 + dist * 0.02);
  float midF = 1.0 / (1.0 + dist * 0.0025);
  vec3 bump = (vec3(0.0, dx.ba - 0.5) * w.x + vec3(dy.b - 0.5, 0.0, dy.a - 0.5) * w.y + vec3(dz.ba - 0.5, 0.0) * w.z) * nearF
            + vec3(dm.b - 0.5, (dm.a - dm.b) * 0.5, dm.a - 0.5) * midF
            + vec3(df.b - 0.5, (df.a - df.b) * 0.5, df.a - 0.5) * fineF;

  vec3 N = normalize(mix(normalize(vNormal), up, liq) + bump * mix(2.2, 0.6, liq));
  vec3 albedo = pow(vColor, vec3(2.2));
  float tex = (dn.r - 0.5) * nearF + (dm.g - 0.5) * midF * 1.3 + (df.g - 0.5) * fineF * 1.1;
  albedo *= max(1.0 + tex * mix(1.5, 0.3, liq), 0.15);

  float shine = vAux.z;
  float day = smoothstep(-0.18, 0.12, dot(up, uSunDir));
  float ndl = max(dot(N, uSunDir), 0.0);
  vec3 sky = atmoColor(uScatter, uSunset, dot(up, uSunDir), 0.0, 0.3);
  vec3 H = normalize(uSunDir + V);
  float ndh = max(dot(N, H), 0.0);
  float fres = pow(1.0 - max(dot(N, V), 0.0), 5.0);
  float spec = pow(ndh, mix(24.0, 260.0, shine)) * shine * (0.6 + 4.0 * shine);
  vec3 base = mix(albedo, sky * 0.9, clamp(fres * shine + shine * 0.12, 0.0, 0.9));
  vec3 ambient = sky * (0.22 + 0.2 * dot(N, up)) + vec3(0.012, 0.014, 0.022);
  vec3 col = base * (SUN_COLOR * ndl * day * 1.7 + ambient) + SUN_COLOR * spec * day;

  float pulse = 0.7 + 0.6 * dm.g + 0.25 * sin(uTime * 1.7 + dn.g * 9.0);
  col += uGlowColor * vAux.y * pulse * 2.6 * mix(vec3(1.0), albedo * 2.5, 0.35);

  // Aerial perspective near the ground, limb haze from orbit.
  float mu = dot(-V, uSunDir);
  vec3 fogCol = atmoColor(uScatter, uSunset, uCamSunElev, mu, 1.0);
  col = mix(col, fogCol, (1.0 - exp(-dist * uFog)) * (1.0 - uSpace));
  float rim = pow(1.0 - max(dot(up, V), 0.0), 2.5) * 0.85 + 0.1;
  vec3 rimCol = atmoColor(uScatter, uSunset, dot(up, uSunDir), mu, 0.4);
  col = mix(col, rimCol, rim * uSpace);

  gl_FragColor = vec4(col, 1.0);
  ${OUT}
}`;

// --------------------------------------------------------------- atmosphere
export const atmoVS = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

export const atmoFS = /* glsl */ `
precision highp float;
uniform vec3 uCenter, uSunDir, uScatter, uSunset;
uniform float uR, uRa, uH, uDensity;
varying vec3 vWorld;
${ATMO}
void main() {
  vec3 o = cameraPosition - uCenter;
  vec3 d = normalize(vWorld - cameraPosition);
  float b = dot(o, d);
  float oo = dot(o, o);
  float disc = b * b - (oo - uRa * uRa);
  if (disc < 0.0) discard;
  float sq = sqrt(disc);
  float t0 = max(-b - sq, 0.0);
  float t1 = -b + sq;
  float discP = b * b - (oo - uR * uR);
  if (discP > 0.0) {
    float tp = -b - sqrt(discP);
    if (tp > 0.0) t1 = min(t1, tp);
  }
  float L = max(t1 - t0, 0.0);
  float od = 0.0;
  float se = 0.0;
  for (int i = 0; i < 5; i++) {
    vec3 p = o + d * (t0 + L * (float(i) + 0.5) / 5.0);
    float r = length(p);
    float dens = exp(-max(r - uR, 0.0) / uH);
    od += dens;
    se += dens * dot(p / r, uSunDir);
  }
  se /= max(od, 1e-5);
  od *= L / 5.0 * uDensity / uH;
  float mu = dot(d, uSunDir);
  vec3 col = atmoColor(uScatter, uSunset, se, mu, smoothstep(0.6, 5.0, od));
  float dayS = smoothstep(-0.3, 0.1, se);
  col += SUN_COLOR * (pow(max(mu, 0.0), 10.0) * 0.25 + pow(max(mu, 0.0), 220.0) * 2.0) * dayS;
  float a = min((1.0 - exp(-od)) * 1.12, 1.0) * smoothstep(-0.36, 0.02, se);
  gl_FragColor = vec4(col, a);
  ${OUT}
}`;

// -------------------------------------------------- props, gates (lit solids)
export const propVS = /* glsl */ `
attribute vec4 aColor;
varying vec4 vColor;
varying vec3 vNormal;
varying vec3 vWorld;
void main() {
  vColor = aColor;
  #ifdef USE_INSTANCING
    mat4 m = modelMatrix * instanceMatrix;
  #else
    mat4 m = modelMatrix;
  #endif
  vNormal = normalize(mat3(m) * normal);
  vec4 w = m * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

export const propFS = /* glsl */ `
precision highp float;
uniform vec3 uCenter, uSunDir, uScatter, uSunset, uTint;
uniform float uFog, uCamSunElev, uShine, uFlash;
varying vec4 vColor;
varying vec3 vNormal;
varying vec3 vWorld;
${ATMO}
void main() {
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  vec3 N = normalize(vNormal);
  vec3 up = normalize(vWorld - uCenter);
  vec3 albedo = pow(vColor.rgb, vec3(2.2));
  float day = smoothstep(-0.18, 0.12, dot(up, uSunDir));
  float ndl = max(dot(N, uSunDir), 0.0);
  vec3 sky = atmoColor(uScatter, uSunset, dot(up, uSunDir), 0.0, 0.3);
  vec3 H = normalize(uSunDir + V);
  float spec = pow(max(dot(N, H), 0.0), 60.0) * uShine * 2.0;
  float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
  vec3 col = albedo * (SUN_COLOR * ndl * day * 1.7 + sky * (0.24 + 0.2 * dot(N, up)) + 0.014)
           + SUN_COLOR * spec * day + sky * fres * uShine * 0.6;
  col += albedo * vColor.a * 5.0 + uTint * uFlash * (0.4 + fres);
  vec3 fogCol = atmoColor(uScatter, uSunset, uCamSunElev, dot(-V, uSunDir), 1.0);
  col = mix(col, fogCol, 1.0 - exp(-dist * uFog));
  gl_FragColor = vec4(col, 1.0);
  ${OUT}
}`;

// ------------------------------------------- soft additive glow spheres (orbs)
export const glowVS = /* glsl */ `
varying vec3 vNormal;
varying vec3 vWorld;
varying vec3 vTint;
uniform vec3 uColor;
void main() {
  #ifdef USE_INSTANCING
    mat4 m = modelMatrix * instanceMatrix;
  #else
    mat4 m = modelMatrix;
  #endif
  #ifdef USE_INSTANCING_COLOR
    vTint = instanceColor;
  #else
    vTint = uColor;
  #endif
  vNormal = normalize(mat3(m) * normal);
  vec4 w = m * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

export const glowFS = /* glsl */ `
precision highp float;
uniform float uPower, uGain;
varying vec3 vNormal;
varying vec3 vWorld;
varying vec3 vTint;
void main() {
  float f = abs(dot(normalize(vNormal), normalize(cameraPosition - vWorld)));
  float a = pow(f, uPower);
  vec3 col = vTint * a * uGain + mix(vTint, vec3(1.0), 0.6) * pow(f, uPower * 6.0) * uGain * 0.35;
  gl_FragColor = vec4(col, 1.0);
  ${OUT}
}`;

// ------------------------------------------------------------------- portal
export const uvVS = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vLocal;
void main() {
  vUv = uv;
  vLocal = position;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

export const portalFS = /* glsl */ `
precision highp float;
uniform sampler2D uDetail;
uniform vec3 uColor, uColor2;
uniform float uTime, uOpen;
varying vec2 vUv;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float a = atan(p.y, p.x) / 6.2831853;
  float sw = a + r * 0.9 - uTime * 0.09;
  float n1 = texture2D(uDetail, vec2(sw * 2.0, r * 0.6 - uTime * 0.11)).r;
  float n2 = texture2D(uDetail, vec2(-sw * 3.0 + 0.3, r * 1.3 + uTime * 0.07)).g;
  float swirl = smoothstep(0.25, 0.85, n1 * 0.6 + n2 * 0.6);
  float edge = smoothstep(1.0, 0.86, r);
  float core = smoothstep(0.55, 0.0, r);
  vec3 col = mix(uColor * 0.25, uColor2, swirl) * (0.12 + swirl * 1.1) + mix(uColor2, vec3(1.0), 0.5) * core * core * 0.7;
  col += uColor * smoothstep(0.8, 0.98, r) * 1.2;
  float alpha = edge * uOpen;
  gl_FragColor = vec4(col * alpha, alpha * 0.92);
  ${OUT}
}`;

export const beaconFS = /* glsl */ `
precision highp float;
uniform vec3 uColor;
uniform float uTime, uAlpha;
varying vec2 vUv;
void main() {
  float fade = pow(1.0 - vUv.y, 2.2);
  float pulse = 0.8 + 0.2 * sin(vUv.y * 60.0 - uTime * 3.0);
  gl_FragColor = vec4(uColor * fade * pulse * uAlpha * 0.5, 1.0);
  ${OUT}
}`;

// ----------------------------------------------------------- wormhole tunnel
export const tunnelFS = /* glsl */ `
precision highp float;
uniform sampler2D uDetail;
uniform vec3 uColor, uColor2;
uniform float uTime, uAlpha, uMix;
varying vec3 vLocal;
void main() {
  vec3 d = normalize(vLocal);
  float ang = atan(d.y, d.x) / 6.2831853;
  float depth = d.z / max(length(d.xy), 0.04);
  float n1 = texture2D(uDetail, vec2(ang * 3.0 + depth * 0.05, depth * 0.11 + uTime * 0.9)).r;
  float n2 = texture2D(uDetail, vec2(ang * 7.0 - depth * 0.03, depth * 0.23 + uTime * 1.7)).g;
  float streak = pow(clamp(n1 * 0.7 + n2 * 0.55, 0.0, 1.0), 4.0) * 1.5;
  vec3 tint = mix(uColor, uColor2, clamp(uMix + (n2 - 0.5) * 0.5, 0.0, 1.0));
  float ahead = smoothstep(0.75, 1.0, -d.z);
  // kept well below white: a full-field flash is harsh inside a headset
  vec3 col = tint * (0.03 + streak) + vec3(1.0) * ahead * ahead * ahead * 0.5 + tint * ahead * 0.35;
  gl_FragColor = vec4(col, uAlpha);
  ${OUT}
}`;

// ---------------------------------------------------------------------- sun
export const sunFS = /* glsl */ `
precision highp float;
uniform sampler2D uDetail;
uniform float uTime;
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vLocal;
void main() {
  vec3 n = normalize(vLocal);
  float f = max(dot(n, normalize(cameraPosition - vWorld)), 0.0);
  float g = texture2D(uDetail, vUv * vec2(8.0, 4.0) + vec2(uTime * 0.004, 0.0)).r
          * texture2D(uDetail, vUv * vec2(20.0, 10.0) - vec2(0.0, uTime * 0.006)).g;
  vec3 col = mix(vec3(1.0, 0.45, 0.1), vec3(1.0, 0.93, 0.75), pow(f, 0.6)) * (2.2 + g * 5.0);
  gl_FragColor = vec4(col, 1.0);
  ${OUT}
}`;

export const coronaFS = /* glsl */ `
precision highp float;
varying vec2 vUv;
void main() {
  float r = length(vUv * 2.0 - 1.0);
  float a = pow(max(1.0 - r, 0.0), 4.0) * 0.8 + pow(max(1.0 - r * 3.0, 0.0), 2.0) * 1.6;
  gl_FragColor = vec4(vec3(1.0, 0.82, 0.55) * a, 1.0);
  ${OUT}
}`;

export const ringFS = /* glsl */ `
precision highp float;
uniform sampler2D uDetail;
uniform vec3 uSunDir, uCenter;
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vLocal;
void main() {
  float r = length(vLocal.xy);
  float t = (r - 1.35) / 1.05;
  float bands = texture2D(uDetail, vec2(t * 1.7, 0.31)).r * 0.7 + texture2D(uDetail, vec2(t * 9.0, 0.77)).g * 0.5;
  float a = smoothstep(0.0, 0.06, t) * smoothstep(1.0, 0.9, t) * smoothstep(0.3, 0.75, bands);
  // Planet shadow across the rings.
  vec3 p = vWorld - uCenter;
  float along = dot(p, uSunDir);
  float perp = length(p - uSunDir * along);
  float shadow = (along < 0.0 && perp < 1.0 * length(p) / r) ? 0.12 : 1.0;
  vec3 col = mix(vec3(0.75, 0.62, 0.45), vec3(0.6, 0.75, 0.9), bands) * shadow * 0.9;
  gl_FragColor = vec4(col, a * 0.85);
  ${OUT}
}`;

export const starVS = /* glsl */ `
attribute float aSize;
attribute vec3 aColor;
varying vec3 vColor;
void main() {
  vColor = aColor;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
  gl_PointSize = aSize;
}`;

export const starFS = /* glsl */ `
precision highp float;
varying vec3 vColor;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  gl_FragColor = vec4(vColor * max(1.0 - r, 0.0) * 1.6, 1.0);
  ${OUT}
}`;

// Nebula backdrop, baked once into a cube map at startup.
export const nebulaFS = /* glsl */ `
precision highp float;
varying vec3 vLocal;
float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 6; i++) { s += a * vnoise(p); p = p * 2.03 + 7.1; a *= 0.5; } return s; }
void main() {
  vec3 d = normalize(vLocal);
  vec3 q = d * 2.2 + vec3(fbm(d * 2.0 + 3.0), fbm(d * 2.0 - 5.0), fbm(d * 2.0 + 11.0)) * 1.4;
  float n = fbm(q);
  float band = exp(-pow(abs(d.y * 0.9 + 0.25 * d.x + (fbm(d * 3.0) - 0.5) * 0.5) * 2.6, 2.0));
  float cloud = smoothstep(0.42, 0.85, n) * (0.25 + band);
  vec3 c1 = vec3(0.10, 0.16, 0.42), c2 = vec3(0.45, 0.12, 0.40), c3 = vec3(0.05, 0.32, 0.36);
  vec3 col = mix(mix(c1, c2, fbm(d * 1.6 + 20.0)), c3, smoothstep(0.4, 0.8, fbm(d * 1.3 - 9.0))) * cloud * 0.55;
  col += vec3(0.9, 0.8, 1.0) * band * smoothstep(0.5, 0.9, fbm(d * 40.0)) * 0.05;
  // Dense faint star dust (crisp bright stars are separate points).
  vec3 g = d * 260.0; vec3 id = floor(g); float h = hash(id);
  float star = step(0.985, h) * smoothstep(0.5, 0.0, length(fract(g) - 0.5)) * (0.3 + band);
  col += vec3(0.8, 0.85, 1.0) * star * 0.5;
  gl_FragColor = vec4(col + vec3(0.002, 0.003, 0.008), 1.0);
}`;
