// Procedural textures for the look stage: 64 px, drawn from a seeded PRNG into plain byte arrays (no canvas, so tests
// can build them in Node), nearest filtering, no mipmaps, repeating. Each is a grey detail map near white that the
// material's colour tints, so the tones in set/build.js still set the colour and the texture adds the grain.
// worldUV() maps a mesh's texture by world position, so every surface gets the same texel size in meters whatever
// the size of its box. Contract: src/CONTRACT.md (seeded, no clocks).

export const TEX_SIZE = 64;
// meters covered by one repeat of each texture on the set
export const TILE = { snow: 2, asphalt: 2, concrete: 2, brick: 2, plaster: 3, carPaint: 1, coatA: 0.5, jacketB: 0.5 };

const clamp01 = (v) => Math.min(1, Math.max(0, v));

// tileable value noise: a grid of random values every `cell` pixels, bilinear between them, wrapping at the edge
function valueNoise(rng, n, cell) {
  const g = Math.max(1, Math.round(n / cell));
  const grid = Float32Array.from({ length: g * g }, () => rng());
  const at = (i, j) => grid[((j % g) + g) % g * g + (((i % g) + g) % g)];
  const smooth = (u) => u * u * (3 - 2 * u);
  return (x, y) => {
    const fx = (x / n) * g, fy = (y / n) * g;
    const i = Math.floor(fx), j = Math.floor(fy), u = smooth(fx - i), v = smooth(fy - j);
    const a = at(i, j) + (at(i + 1, j) - at(i, j)) * u, b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * u;
    return a + (b - a) * v;
  };
}
// a few octaves, 0 to 1
function fbm(rng, n, cells) {
  const layers = cells.map((c) => valueNoise(rng, n, c));
  const total = cells.reduce((s, _, k) => s + 0.5 ** k, 0);
  return (x, y) => layers.reduce((s, f, k) => s + f(x, y) * 0.5 ** k, 0) / total;
}

// Each painter returns the grey value (0 to 1) of pixel (x, y), y down, on an n x n tile.
const PAINTERS = {
  // fresh snow: soft unevenness and the odd glint
  snow(rng, n) {
    const f = fbm(rng, n, [16, 8, 4]);
    const glints = new Set(Array.from({ length: Math.round(n * n * 0.012) }, () => Math.floor(rng() * n * n)));
    return (x, y) => (glints.has(y * n + x) ? 1 : 0.86 + 0.1 * f(x, y));
  },
  // worn asphalt: coarse grain with light and dark stones
  asphalt(rng, n) {
    const f = fbm(rng, n, [8, 4, 2]);
    const stones = new Map(Array.from({ length: Math.round(n * n * 0.07) }, () => [Math.floor(rng() * n * n), rng() < 0.5 ? 1 : 0.5]));
    return (x, y) => stones.get(y * n + x) ?? 0.72 + 0.22 * f(x, y);
  },
  // cast concrete in slabs: a dark joint along the tile's edges, mottled faces
  concrete(rng, n) {
    const f = fbm(rng, n, [16, 8]);
    return (x, y) => (x === 0 || y === 0 ? 0.62 : 0.8 + 0.14 * f(x, y));
  },
  // running bond brick, 16 x 8 px a brick (0.5 x 0.25 m at the set's tile), one-pixel mortar, each brick its own shade
  brick(rng, n) {
    const bw = 16, bh = 8, rows = n / bh, cols = n / bw;
    const shade = Float32Array.from({ length: rows * cols }, () => 0.78 + 0.2 * rng());
    const f = fbm(rng, n, [4]);
    return (x, y) => {
      const r = Math.floor(y / bh), off = (r % 2) * (bw / 2), xx = (x + off) % n, c = Math.floor(xx / bw);
      if (y % bh === 0 || xx % bw === 0) return 0.55;
      return shade[r * cols + c] * (0.92 + 0.08 * f(x, y));
    };
  },
  // old plaster: broad blotches and a few darker stains
  plaster(rng, n) {
    const f = fbm(rng, n, [32, 16, 8]);
    return (x, y) => 0.76 + 0.22 * f(x, y);
  },
  // car paint: almost flat, a faint orange peel
  carPaint(rng, n) {
    const f = fbm(rng, n, [8]);
    return (x, y) => 0.9 + 0.08 * f(x, y);
  },
  // A's wool coat: a diagonal twill
  coatA(rng, n) {
    const f = fbm(rng, n, [8]);
    return (x, y) => ((x + y) % 4 < 2 ? 0.9 : 0.78) + 0.06 * f(x, y);
  },
  // B's puffy jacket: quilted channels across it
  jacketB(rng, n) {
    const f = fbm(rng, n, [16]);
    return (x, y) => (y % 12 < 2 ? 0.66 : 0.94 - 0.12 * Math.abs((y % 12) - 7) / 5) + 0.04 * f(x, y);
  },
};

// The crescent moon's mask (look stage): white, opaque inside the lit crescent, clear elsewhere. The disc fills the
// square; the dark part is the same disc pushed up by `phase` radii, so the lit limb is at the bottom and the horns
// point up, as a moon low in the east looks with the sun below the western horizon.
export const CRESCENT = { phase: 0.42, size: 64 };
export function crescentBytes(n = CRESCENT.size, phase = CRESCENT.phase) {
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n * 2 - 1, v = (y + 0.5) / n * 2 - 1; // v up (row 0 is the bottom)
      const lit = u * u + v * v <= 1 && u * u + (v - phase * 2) ** 2 > 1;
      const i = (y * n + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = lit ? 255 : 0;
    }
  }
  return data;
}

// The grey bytes of one texture (n * n * 4, RGBA, row 0 at the bottom as three expects), from the PRNG named after it
export function textureBytes(name, rngFor, n = TEX_SIZE) {
  const paint = PAINTERS[name](rngFor(`texture:${name}`), n);
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const v = Math.round(clamp01(paint(x, y)) * 255), i = ((n - 1 - y) * n + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return data;
}

export function makeTextures(THREE, rngFor, n = TEX_SIZE) {
  const out = {};
  for (const name of Object.keys(PAINTERS)) {
    const t = new THREE.DataTexture(textureBytes(name, rngFor, n), n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.colorSpace = THREE.SRGBColorSpace;
    t.name = name;
    t.needsUpdate = true;
    out[name] = t;
  }
  const moon = new THREE.DataTexture(crescentBytes(), CRESCENT.size, CRESCENT.size, THREE.RGBAFormat, THREE.UnsignedByteType);
  moon.magFilter = moon.minFilter = THREE.NearestFilter;
  moon.generateMipmaps = false;
  moon.colorSpace = THREE.SRGBColorSpace;
  moon.name = 'moon';
  moon.needsUpdate = true;
  out.moon = moon;
  return out;
}

// Rewrite a mesh's uv from world position, planar along the face's main axis: up-facing faces map x and z, faces
// along x map z and y, faces along z map x and y. `tile` is the meters one repeat covers. The mesh's world matrix
// must be current. The geometry must belong to this mesh alone.
export function worldUV(THREE, mesh, tile) {
  const g = mesh.geometry, pos = g.attributes.position, nor = g.attributes.normal;
  const m = mesh.matrixWorld, nm = new THREE.Matrix3().getNormalMatrix(m);
  const p = new THREE.Vector3(), q = new THREE.Vector3();
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).applyMatrix4(m);
    q.fromBufferAttribute(nor, i).applyMatrix3(nm);
    const ax = Math.abs(q.x), ay = Math.abs(q.y), az = Math.abs(q.z);
    const [a, b] = ay >= ax && ay >= az ? [p.x, p.z] : ax >= az ? [p.z, p.y] : [p.x, p.y];
    uv[2 * i] = a / tile;
    uv[2 * i + 1] = b / tile;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}
