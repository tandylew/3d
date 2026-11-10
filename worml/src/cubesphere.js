// Cube-sphere parameterisation shared by the quadtree and the terrain worker.
export const GRID = 24; // cells per patch side

// normal, right, up — chosen so right x up = normal (outward CCW triangles).
export const FACES = [
  [[1, 0, 0], [0, 0, -1], [0, 1, 0]],
  [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
  [[0, 1, 0], [1, 0, 0], [0, 0, -1]],
  [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
  [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
  [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
];

const Q = Math.PI / 4;

// Face coordinates (u,v in [-1,1]) to a unit direction. The tan() warp keeps
// patch area nearly uniform across the face.
export function patchDir(face, u, v, out) {
  const a = Math.tan(u * Q), b = Math.tan(v * Q);
  const n = face[0], r = face[1], t = face[2];
  const x = n[0] + r[0] * a + t[0] * b, y = n[1] + r[1] * a + t[1] * b, z = n[2] + r[2] * a + t[2] * b;
  const l = Math.sqrt(x * x + y * y + z * z);
  out[0] = x / l; out[1] = y / l; out[2] = z / l;
  return out;
}

// Shared index buffer: grid triangles plus double-sided skirt curtains.
export function patchIndices() {
  const N = GRID, V = N + 1, idx = [];
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const a = j * V + i, b = a + 1, c = a + V, e = c + 1;
      idx.push(a, b, c, b, e, c);
    }
  }
  const base = V * V;
  const edge = (g, s) => {
    for (let i = 0; i < N; i++) {
      const a = g(i), b = g(i + 1), c = s + i, e = s + i + 1;
      idx.push(a, b, c, b, e, c, a, c, b, b, c, e);
    }
  };
  edge((i) => i, base);
  edge((i) => N * V + i, base + V);
  edge((i) => i * V, base + 2 * V);
  edge((i) => i * V + N, base + 3 * V);
  return new Uint16Array(idx);
}
