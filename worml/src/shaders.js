// All GLSL lives here. Lighting is analytic (no shadow maps, no post-processing)
// so it stays affordable on a Quest 3, which renders every fragment twice.
// Surface colour is baked per vertex by the terrain worker; the fragment shader
// adds the things that make it read as a real place: crisp rock and strata on
// slopes, grain, water optics, cloud shadows and height-aware haze.

const ATMO = /* glsl */ `
const vec3 SUN_COLOR = vec3(1.0, 0.96, 0.9);
// Sky radiance for a view direction. mu = cos(angle to sun), thick = 0 at the
// zenith .. 1 along the horizon (long optical path: paler and brighter).
vec3 atmoColor(vec3 scatter, vec3 sunset, float sunElev, float mu, float thick) {
  float tw = 1.0 - smoothstep(-0.05, 0.42, sunElev);
  vec3 c = mix(scatter, sunset, tw * (0.3 + 0.7 * max(mu, 0.0)) * 0.9);
  c *= 0.72 + 0.28 * mu * mu;
  vec3 pale = mix(c, vec3(dot(c, vec3(0.3333))), 0.5 - 0.3 * tw) * 1.45 + 0.04;
  c = mix(c * 0.8, pale, thick * (0.72 - 0.2 * tw));
  return c * smoothstep(-0.26, 0.22, sunElev);
}
// Sunlight after its trip through the air: warm and dim near the horizon.
vec3 sunLight(float elev, vec3 sunset) {
  vec3 warm = mix(sunset, SUN_COLOR, 0.25);
  return mix(warm, SUN_COLOR, smoothstep(0.0, 0.4, elev)) * smoothstep(-0.1, 0.08, elev);
}
// Optical depth of haze between the camera (altitude hc) and a point (altitude
// hp) for an exponential atmosphere: valleys fill with haze, peaks stay clear.
float hazeDepth(float dist, float hc, float hp, float H, float fog0) {
  float a = max(hc, -200.0) / H, b = max(hp, -200.0) / H, d = b - a;
  float avg = abs(d) < 0.02 ? exp(-a) : (exp(-a) - exp(-b)) / d;
  return dist * fog0 * avg;
}
`;

const CLOUD = /* glsl */ `
uniform samplerCube uCloudMap;
uniform vec4 uCloudMix;   // how this world blends the four baked noise fields
uniform vec4 uCloudP;     // x threshold, y softness, z opacity, w layer altitude (m)
uniform vec2 uCloudCS;    // slow rotation of the weather about the pole
uniform vec4 uSites[10];  // xyz: direction of an essence deposit / anomaly, w: strength (0 = unused)
uniform float uR;
vec3 cloudRot(vec3 d) { return vec3(uCloudCS.x * d.x + uCloudCS.y * d.z, d.y, uCloudCS.x * d.z - uCloudCS.y * d.x); }
// The weather itself points at essence: the cloud deck opens in a clear eye
// above every deposit, walled by a ring of piled-up cloud.
float cloudEye(vec3 dir) {
  float e = 0.0;
  for (int i = 0; i < 10; i++) {
    float d = distance(dir, uSites[i].xyz) * uR;
    e += ((smoothstep(1000.0, 1500.0, d) * (1.0 - smoothstep(1700.0, 3000.0, d))) * 0.17 - (1.0 - smoothstep(450.0, 1200.0, d)) * 0.6) * uSites[i].w;
  }
  return e;
}
float cloudBase(vec3 dir) { return dot(textureCube(uCloudMap, cloudRot(dir)), uCloudMix) + cloudEye(dir); }
// Fraction of direct sun reaching a point at height h (planet-relative P).
float cloudShadow(vec3 P, vec3 up, float h) {
  float se = dot(up, uSunDir);
  vec3 dir = normalize(P + uSunDir * (max(uCloudP.w - h, 0.0) / max(se, 0.12)));
  float c = smoothstep(uCloudP.x, uCloudP.x + uCloudP.y, cloudBase(dir));
  return 1.0 - c * uCloudP.z * 0.78 * step(h, uCloudP.w);
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
uniform vec3 uCenter, uSunDir, uScatter, uSunset, uGlowColor, uRockCol, uRockP;
uniform float uFog0, uSpace, uTime, uCamSunElev, uH, uCamAlt, uStrata, uLiquid, uMetal;
uniform vec4 uShaft;   // xyz: axis of the well shaft, w: its radius (0 while sealed)
varying vec3 vColor;
varying vec3 vAux;     // x: height above the liquid level / 40 m (clamped), y: glow, z: shine
varying vec3 vDpos;
varying vec3 vNormal;
varying vec3 vWorld;
${ATMO}
${CLOUD}
void main() {
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  vec3 P = vWorld - uCenter;
  float rP = length(P);
  vec3 up = P / rP;
  float hgt = rP - uR;
  // the mouth of the shaft down to the core
  float along = dot(P, uShaft.xyz);
  if (along > 0.0 && length(P - uShaft.xyz * along) < uShaft.w) discard;
  float shoreH = vAux.x * 40.0;
  float liq = uLiquid * step(shoreH, 0.0);

  // Detail texture: R soft fbm, G hard grit, BA slope of both. The 8 m layer is
  // triplanar; the others use one skewed planar fetch each (integer
  // coefficients keep them continuous across patch tiles).
  vec3 w = up * up;
  vec2 flow = liq * uTime * vec2(0.021, 0.013);
  vec4 dx = texture2D(uDetail, vDpos.yz * 0.125 + flow);
  vec4 dy = texture2D(uDetail, vDpos.xz * 0.125 + flow);
  vec4 dz = texture2D(uDetail, vDpos.xy * 0.125 + flow);
  vec4 dn = dx * w.x + dy * w.y + dz * w.z;
  // two skewed planar mappings; each pixel uses whichever is less stretched on its slope
  vec3 Ng = normalize(vNormal);
  vec2 skew = abs(Ng.x - Ng.y - Ng.z) > abs(Ng.x + Ng.y - Ng.z)
    ? vec2(vDpos.x + vDpos.y, vDpos.z - vDpos.y) : vec2(vDpos.x - vDpos.y, vDpos.z + vDpos.y);
  vec4 dm = texture2D(uDetail, skew * 0.015625 - flow * 0.3);
  vec4 df = texture2D(uDetail, skew * 0.5 + flow * 2.0);
  vec4 dk = texture2D(uDetail, skew * 0.001953125);
  float fineF = 1.0 / (1.0 + dist * 0.1);
  float nearF = 1.0 / (1.0 + dist * 0.016);
  float midF = 1.0 / (1.0 + dist * 0.002);
  float farF = 1.0 / (1.0 + dist * 0.00018);
  vec3 bump = (vec3(0.0, dx.ba - 0.5) * w.x + vec3(dy.b - 0.5, 0.0, dy.a - 0.5) * w.y + vec3(dz.ba - 0.5, 0.0) * w.z) * nearF
            + vec3(dm.b - 0.5, (dm.a - dm.b) * 0.5, dm.a - 0.5) * midF
            + vec3(dk.b - 0.5, (dk.a - dk.b) * 0.5, dk.a - 0.5) * farF * 0.8
            + vec3(df.b - 0.5, (df.a - df.b) * 0.5, df.a - 0.5) * fineF;

  float slope = 1.0 - dot(Ng, up);
  vec3 albedo = pow(vColor, vec3(2.2));

  // Bare rock breaks through on steep ground along a ragged, pixel-sharp line,
  // banded by sedimentary strata that follow true altitude.
  float rag = (dm.r - 0.5) * 0.22 * midF + (dn.r - 0.5) * 0.14 * nearF + (dk.r - 0.5) * 0.2;
  float rock = smoothstep(uRockP.x, uRockP.y, slope + rag) * uRockP.z * (1.0 - liq);
  float band = sin(hgt * 0.37 + dk.r * 14.0 + dm.r * 3.0) * 0.6 + sin(hgt * 0.083 + dk.g * 6.0) * 0.4;
  albedo = mix(albedo, uRockCol * (1.0 + band * uStrata), rock);
  bump *= 1.0 + rock * 0.9;

  float tex = (dn.r - 0.5) * nearF * 0.28 + (dn.g - 0.5) * nearF * 0.34 + (dm.g - 0.5) * midF * 0.22
            + (df.g - 0.5) * fineF * 0.55 + (dk.r - 0.5) * farF * 0.4 + (dm.r - 0.5) * midF * 0.25;
  albedo *= max(1.0 + tex * mix(0.8, 0.2, liq), 0.5);
  // damp sand and foam along the waterline
  float wet = uLiquid * (1.0 - liq) * (1.0 - smoothstep(0.0, 1.6, shoreH + (dn.r - 0.5) * 1.2)) * (1.0 - vAux.y);
  albedo *= 1.0 - 0.45 * wet;
  float foam = liq * smoothstep(-2.2, -0.1, shoreH + (dm.r - 0.5) * 2.0 + sin(uTime * 0.9 + dk.r * 20.0) * 0.5)
             * smoothstep(0.35, 0.75, df.r * 0.6 + dn.g * 0.6) * step(0.6, vAux.z) * (1.0 - uMetal);

  float shine = max(vAux.z, wet * 0.5);
  vec3 N = normalize(mix(Ng, up, liq) + bump * mix(1.25, 0.3, liq));
  float sunE = dot(up, uSunDir);
  vec3 sunC = sunLight(sunE, uSunset) * cloudShadow(P, up, hgt);
  float ndl = max(dot(N, uSunDir), 0.0);
  vec3 sky = atmoColor(uScatter, uSunset, sunE, 0.0, 0.35);
  float nu = dot(N, up);
  // sun, sky dome, and a little sunlight bounced back off the surrounding ground
  vec3 light = sunC * ndl * 2.5 + sky * (0.6 + 0.42 * nu) + sunC * albedo * (0.5 - 0.4 * nu) * max(sunE, 0.0) * 0.35 + vec3(0.006, 0.007, 0.011);

  float ndv = max(dot(N, V), 0.0);
  float fres = pow(1.0 - ndv, 5.0);
  vec3 Rv = reflect(-V, N);
  Rv = normalize(Rv + up * max(-dot(Rv, up), 0.0) * 1.2);
  vec3 refl = atmoColor(uScatter, uSunset, sunE, dot(Rv, uSunDir), pow(1.0 - max(dot(Rv, up), 0.0), 3.0)) * 1.15 * (1.0 - uSpace * 0.8);
  float f0 = uMetal * (0.35 + 0.65 * liq);
  float mirror = clamp((f0 + (1.0 - f0) * fres) * shine, 0.0, 1.0);
  vec3 H = normalize(uSunDir + V);
  // waves too small to resolve from afar act as roughness: the glint widens and dims
  float gloss = mix(18.0, 900.0, shine * shine) / (1.0 + dist * 0.0004);
  float spec = pow(max(dot(N, H), 0.0), gloss) * (gloss + 8.0) * 0.012 * shine * (0.2 + 0.8 * mix(fres, 1.0, uMetal));
  vec3 col = mix(albedo * light, refl, mirror) + sunC * spec * 3.0;
  col = mix(col, (sunC * (0.35 + 0.65 * max(sunE, 0.0)) * 2.4 + sky) * 0.8, foam * 0.85);

  // Emissive: lava and luminous seas crust over in drifting plates; veins pulse gently.
  // (a cooled dark skin split by a web of bright cracks, with open molten pools)
  float plate = dm.r * 0.55 + dn.r * 0.3 + dk.r * 0.35;
  float cracks = 1.0 - smoothstep(0.0, 0.03 + 0.025 * dk.g, abs(plate - 0.6));
  float molten = max(cracks, smoothstep(0.64, 0.8, dk.r + (dm.r - 0.5) * 0.3));
  // on land the glow lives in fissures rather than lighting whole faces
  float fissure = 1.0 - smoothstep(0.0, 0.1, abs(dn.r * 0.6 + dm.r * 0.5 - 0.55));
  float land = (0.22 + 0.78 * fissure) * (0.85 + 0.15 * sin(uTime * 1.7 + dn.r * 9.0));
  float heat = vAux.y * mix(land, molten * 1.2 + 0.04, liq);
  col = mix(col, col * 0.3, liq * (1.0 - molten) * step(0.05, vAux.y));
  col += (uGlowColor + vec3(0.3, 0.22, 0.1) * heat * heat) * heat * mix(1.9, 2.4, liq) * mix(vec3(1.0), albedo * 2.5, 0.3);

  // Aerial perspective from the ground, limb haze from orbit.
  float mu = dot(-V, uSunDir);
  vec3 fogCol = atmoColor(uScatter, uSunset, uCamSunElev, mu, 1.0);
  fogCol += sunLight(uCamSunElev, uSunset) * pow(max(mu, 0.0), 12.0) * 0.25;
  float od = hazeDepth(dist, uCamAlt, hgt, uH, uFog0);
  col = mix(col, fogCol, (1.0 - exp(-od)) * (1.0 - uSpace * 0.85));
  float rim = pow(1.0 - max(dot(up, V), 0.0), 2.5) * 0.85 + 0.1;
  vec3 rimCol = atmoColor(uScatter, uSunset, sunE, mu, 0.4);
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
  vec3 col = atmoColor(uScatter, uSunset, se, mu, smoothstep(0.5, 4.5, od));
  vec3 sunC = sunLight(se, uSunset);
  float m = max(mu, 0.0);
  col += sunC * (pow(m, 6.0) * 0.12 + pow(m, 40.0) * 0.35 + pow(m, 600.0) * 3.0);
  float a = min((1.0 - exp(-od)) * 1.12, 1.0) * smoothstep(-0.36, 0.02, se);
  gl_FragColor = vec4(col, a);
  ${OUT}
}`;

// ------------------------------------------------------------------- clouds
// A single shell per world. Coverage comes from a baked cube map (seamless on
// the sphere, one fetch); a tiling 2D texture erodes the edges up close.
export const cloudFS = /* glsl */ `
precision highp float;
uniform sampler2D uDetail;
uniform vec3 uCenter, uSunDir, uScatter, uSunset, uCloudTint;
uniform float uTime, uCamSunElev, uH, uCamAlt, uSpace, uFog0;
varying vec3 vWorld;
${ATMO}
${CLOUD}
void main() {
  vec3 P = vWorld - uCenter;
  float rP = length(P);
  vec3 up = P / rP;
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  float base = cloudBase(up);
  // triplanar erosion: soft billows from R, wispy breakup from G
  vec3 qp = cloudRot(up) * (rP / 2600.0);
  vec3 tw = up * up;
  vec4 dt = texture2D(uDetail, qp.yz) * tw.x + texture2D(uDetail, qp.xz + uTime * 0.0006) * tw.y + texture2D(uDetail, qp.xy) * tw.z;
  float nearD = 1.0 / (1.0 + dist / 30000.0);
  float n = base + ((dt.r - 0.5) * 0.22 + (dt.g - 0.5) * 0.1) * nearD;
  float dens = smoothstep(uCloudP.x, uCloudP.x + uCloudP.y, n);
  float alpha = dens * uCloudP.z * smoothstep(20.0, 700.0, dist);
  if (alpha < 0.004) discard;

  float sunE = dot(up, uSunDir);
  vec3 tang = uSunDir - up * sunE;
  float occ = smoothstep(uCloudP.x - 0.04, uCloudP.x + uCloudP.y * 1.6, cloudBase(normalize(up + tang * 0.02)));
  vec3 sunC = sunLight(sunE, uSunset);
  vec3 sky = atmoColor(uScatter, uSunset, sunE, 0.0, 0.35);
  float mu = dot(-V, uSunDir);
  float below = 1.0 - smoothstep(-200.0, 200.0, uCamAlt - uCloudP.w);
  // from above: bright tops, shaded where more cloud stands toward the sun
  vec3 top = sunC * mix(2.9, 1.1, occ) + sky * 0.7;
  // from below: thick cores are grey, thin edges glow, silver lining toward the sun
  vec3 bottom = sunC * mix(2.6, 0.5, dens) * (1.0 - occ * 0.35) + sky * 0.75
              + sunC * pow(max(mu, 0.0), 10.0) * (1.0 - dens) * 2.5;
  vec3 col = uCloudTint * mix(top, bottom, below);

  vec3 fogCol = atmoColor(uScatter, uSunset, uCamSunElev, mu, 1.0);
  float od = hazeDepth(dist, uCamAlt, uCloudP.w, uH, uFog0);
  col = mix(col, fogCol, (1.0 - exp(-od)) * (1.0 - uSpace * 0.85));
  float rim = pow(1.0 - max(dot(up, V), 0.0), 2.5) * 0.8;
  col = mix(col, atmoColor(uScatter, uSunset, sunE, mu, 0.4), rim * uSpace);
  gl_FragColor = vec4(col, alpha);
  ${OUT}
}`;

// Four independent noise fields baked into a cube map at startup:
// R,G weather systems, B cumulus-scale billows, A fine breakup.
export const cloudBakeFS = /* glsl */ `
precision highp float;
varying vec3 vLocal;
float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p, int oct) {
  float a = 0.5, s = 0.0, n = 0.0;
  for (int i = 0; i < 6; i++) { if (i >= oct) break; s += a * vnoise(p); n += a; p = p * 2.03 + 7.1; a *= 0.5; }
  return s / n;
}
void main() {
  vec3 d = normalize(vLocal);
  vec3 w = vec3(fbm(d * 2.6 + 1.7, 3), fbm(d * 2.6 + 9.2, 3), fbm(d * 2.6 - 4.1, 3)) - 0.5;
  float a = fbm(d * 3.4 + w * 2.2, 5);
  float b = fbm(d * 5.0 + 31.7 - w * 1.8, 5);
  float c = fbm(d * 20.0 + w * 5.0, 3);
  float e = fbm(d * 56.0 + 3.3, 2);
  gl_FragColor = vec4(a, b, c, e);
}`;

// -------------------------------------------------- props, gates (lit solids)
export const propVS = /* glsl */ `
attribute vec4 aColor;
varying vec4 vColor;
varying vec3 vNormal;
varying vec3 vWorld;
varying vec3 vLocal;
void main() {
  vColor = aColor;
  vLocal = position;
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

// aColor.a > 0 is emissive glow; aColor.a < 0 marks foliage (light wraps
// around and shines through it).
export const propFS = /* glsl */ `
precision highp float;
uniform sampler2D uDetail;
uniform vec3 uCenter, uSunDir, uScatter, uSunset, uTint;
uniform float uFog0, uCamSunElev, uShine, uFlash, uH, uCamAlt, uGrain;
varying vec4 vColor;
varying vec3 vNormal;
varying vec3 vWorld;
varying vec3 vLocal;
${ATMO}
${CLOUD}
void main() {
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  vec3 P = vWorld - uCenter;
  float rP = length(P);
  vec3 up = P / rP;
  float hgt = rP - uR;
  float leaf = max(-vColor.a, 0.0), glow = max(vColor.a, 0.0);
  vec2 uv = vec2(vLocal.x + vLocal.y, vLocal.z - vLocal.y);
  vec4 d1 = texture2D(uDetail, uv * 0.11);
  vec4 d2 = texture2D(uDetail, uv * 0.53);
  float lod = 1.0 / (1.0 + dist * 0.02);
  vec3 Nv = gl_FrontFacing ? vNormal : -vNormal;
  vec3 N = normalize(Nv + (vec3(d2.b, d1.a, d2.a) - 0.5) * (0.5 + leaf * 0.5) * uGrain * lod);
  vec3 albedo = pow(vColor.rgb, vec3(2.2));
  albedo *= 1.0 + ((d1.r - 0.5) * 0.5 + (d2.g - 0.5) * 0.6 * lod) * uGrain;
  float sunE = dot(up, uSunDir);
  vec3 sunC = sunLight(sunE, uSunset) * cloudShadow(P, up, hgt);
  float nl = dot(N, uSunDir);
  float wrap = 0.12 + leaf * 0.4;
  float diff = max((nl + wrap) / (1.0 + wrap), 0.0);
  vec3 sky = atmoColor(uScatter, uSunset, sunE, 0.0, 0.35);
  float nu = dot(N, up);
  vec3 light = sunC * diff * 2.5 + sky * (0.6 + 0.42 * nu) + sunC * (0.5 - 0.4 * nu) * max(sunE, 0.0) * 0.12 + 0.008;
  vec3 H = normalize(uSunDir + V);
  float fres = pow(1.0 - max(dot(N, V), 0.0), 5.0);
  float gloss = mix(18.0, 500.0, uShine * uShine);
  float spec = pow(max(dot(N, H), 0.0), gloss) * (gloss + 8.0) * 0.012 * uShine;
  vec3 col = albedo * light + sunC * spec * 3.0 + sky * fres * uShine * 0.8;
  // sunlight through leaves when looking toward the sun
  col += albedo * vec3(1.1, 1.25, 0.7) * sunC * leaf * pow(max(dot(-V, uSunDir), 0.0), 3.0) * 0.6;
  col += albedo * glow * 5.0 + uTint * uFlash * (0.4 + fres);
  float mu = dot(-V, uSunDir);
  vec3 fogCol = atmoColor(uScatter, uSunset, uCamSunElev, mu, 1.0);
  col = mix(col, fogCol, 1.0 - exp(-hazeDepth(dist, uCamAlt, hgt, uH, uFog0)));
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
uniform vec3 uColor, uColor2, uColor3;
uniform float uTime, uOpen;
varying vec2 vUv;
void main() {
  // each face shows where it leads: front = onward, back = the way back
  vec3 uDest = gl_FrontFacing ? uColor2 : uColor3;
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float a = atan(p.y, p.x) / 6.2831853;
  float sw = a + r * 0.9 - uTime * 0.09;
  float n1 = texture2D(uDetail, vec2(sw * 2.0, r * 0.6 - uTime * 0.11)).r;
  float n2 = texture2D(uDetail, vec2(-sw * 1.5 + 0.3, r * 0.65 + uTime * 0.07 + 0.37)).r;
  float swirl = smoothstep(0.25, 0.85, n1 * 0.6 + n2 * 0.6);
  float edge = smoothstep(1.0, 0.86, r);
  float core = smoothstep(0.55, 0.0, r);
  vec3 col = mix(uColor * 0.25, uDest, swirl) * (0.12 + swirl * 1.1) + mix(uDest, vec3(1.0), 0.5) * core * core * 0.7;
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
  float n2 = texture2D(uDetail, vec2(ang * 4.0 - depth * 0.03, depth * 0.12 + uTime * 0.9 + 0.41)).r;
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
          * texture2D(uDetail, vUv * vec2(20.0, 10.0) - vec2(0.0, uTime * 0.006)).g * 1.3;
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
  float bands = texture2D(uDetail, vec2(t * 1.7, 0.31)).r * 0.7 + texture2D(uDetail, vec2(t * 4.0, 0.77)).g * 0.5;
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
  vec3 c1 = vec3(0.10, 0.14, 0.30), c2 = vec3(0.30, 0.14, 0.24), c3 = vec3(0.10, 0.22, 0.26);
  vec3 col = mix(mix(c1, c2, fbm(d * 1.6 + 20.0)), c3, smoothstep(0.4, 0.8, fbm(d * 1.3 - 9.0))) * cloud * 0.3;
  col += vec3(0.9, 0.8, 1.0) * band * smoothstep(0.5, 0.9, fbm(d * 40.0)) * 0.05;
  // Dense faint star dust (crisp bright stars are separate points).
  vec3 g = d * 260.0; vec3 id = floor(g); float h = hash(id);
  float star = step(0.985, h) * smoothstep(0.5, 0.0, length(fract(g) - 0.5)) * (0.3 + band);
  col += vec3(0.8, 0.85, 1.0) * star * 0.5;
  gl_FragColor = vec4(col + vec3(0.002, 0.003, 0.008), 1.0);
}`;

// ------------------------------------------------- shaft and hollow core
// Emissive rock: cold crust near the surface, then strata lit from within,
// then a geode of the world's own element around the gate.
export const coreFS = /* glsl */ `
precision highp float;
uniform sampler2D uDetail;
uniform vec3 uCenter, uGlowColor, uRockCol;
uniform vec4 uShaft;
uniform float uTime, uR, uCoreR, uChamber;
varying vec3 vWorld;
void main() {
  vec3 P = vWorld - uCenter;
  float r = length(P);
  float along = dot(P, uShaft.xyz);
  float perp = length(P - uShaft.xyz * along);
  if (uChamber > 0.5 && along > 0.0 && perp < uShaft.w) discard;
  vec3 n = P / r;
  vec3 w = n * n;
  float depth = clamp(1.0 - (r - uCoreR) / (uR - uCoreR), 0.0, 1.0);   // 0 at the surface, 1 at the core
  // shaft walls map by (angle, depth); the chamber is triplanar on the sphere
  vec3 q = mix(vec3(atan(P.z, P.x) * 15.0, r * 0.02, 0.0), P * 0.004, uChamber);
  vec4 d1 = mix(texture2D(uDetail, q.xy), texture2D(uDetail, q.yz) * w.x + texture2D(uDetail, q.xz) * w.y + texture2D(uDetail, q.xy) * w.z, uChamber);
  vec4 d2 = texture2D(uDetail, mix(q.xy * 5.0, (P.xy + P.zx) * 0.021, uChamber));
  float facet = smoothstep(0.35, 0.65, d1.r) * 0.6 + d2.g * 0.4;
  vec3 V = normalize(cameraPosition - vWorld);
  float rimL = pow(1.0 - abs(dot(V, mix(normalize(P - uShaft.xyz * along), n, uChamber))), 2.0);
  vec3 rock = uRockCol * (0.25 + 0.9 * facet);
  // rings of light sinking toward the core, veins that brighten with depth
  float ring = pow(0.5 + 0.5 * sin(r * 0.045 + uTime * 2.4), 12.0);
  float vein = 1.0 - smoothstep(0.0, 0.03, abs(d1.r * 0.7 + d2.r * 0.4 - 0.55));
  float heat = mix(0.05, 1.0, depth * depth);
  vec3 col = rock * (0.12 + 0.5 * rimL) * (1.0 - 0.6 * depth);
  col += uGlowColor * (vein * (0.15 + 0.9 * heat) * (1.0 - 0.45 * uChamber) + ring * (0.12 + 0.5 * heat) * (1.0 - uChamber));
  // the geode: crystal facets catching the gate's light
  float sparkle = pow(d2.g, 6.0) * (0.6 + 0.4 * sin(uTime * 1.3 + d1.r * 40.0));
  col += uChamber * (uGlowColor * (0.015 + facet * facet * 0.09 + rimL * 0.12) + vec3(1.0) * sparkle * 0.9);
  gl_FragColor = vec4(col, 1.0);
  ${OUT}
}`;

// Full-view tint attached to the head: damage, time effects, fades.
export const veilFS = /* glsl */ `
precision highp float;
uniform vec4 uTint;    // rgb + strength, vignette-shaped
uniform vec4 uFade;    // rgb + alpha, uniform
varying vec2 vUv;
void main() {
  float r = length(vUv * 2.0 - 1.0);
  float v = smoothstep(0.25, 1.05, r) * uTint.a;
  vec3 col = mix(uTint.rgb, uFade.rgb, uFade.a);
  gl_FragColor = vec4(col, max(v, uFade.a));
}`;

// A soft light shaft (deposit pillars, god rays through the cloud eye).
export const pillarFS = /* glsl */ `
precision highp float;
uniform vec3 uColor;
uniform float uTime, uAlpha;
varying vec2 vUv;
void main() {
  float fade = pow(1.0 - vUv.y, 1.6) * smoothstep(0.0, 0.02, vUv.y);
  float drift = 0.75 + 0.25 * sin(vUv.y * 40.0 - uTime * 1.5 + vUv.x * 12.566);
  gl_FragColor = vec4(uColor * fade * drift * uAlpha, 1.0);
  ${OUT}
}`;
