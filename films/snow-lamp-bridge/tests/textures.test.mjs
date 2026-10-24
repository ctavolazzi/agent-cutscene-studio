// Checks for the procedural textures (src/textures.js). Run: node --test tests/textures.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { mulberry32, hashString } from '../src/prng.js';
import { CONFIG } from '../src/config.js';
import { CRESCENT, TEX_SIZE, TILE, crescentBytes, makeTextures, textureBytes, worldUV } from '../src/textures.js';

const rngFor = (name) => mulberry32((CONFIG.seed ^ hashString(name)) >>> 0);
const N = TEX_SIZE;
const grey = (bytes, x, y) => bytes[((N - 1 - y) * N + x) * 4]; // y down, as the painters draw

test('seeded: the same name gives the same bytes, different names differ', () => {
  assert.deepEqual(textureBytes('brick', rngFor), textureBytes('brick', rngFor));
  assert.notDeepEqual(textureBytes('brick', rngFor), textureBytes('plaster', rngFor));
});

test('every texture: 64 px, grey, opaque, nearest, repeating, no mipmaps, sRGB, never black', () => {
  const tex = makeTextures(THREE, rngFor);
  for (const [name, t] of Object.entries(tex)) {
    if (name === 'moon') continue; // a mask, not a tiling detail map: its own test below
    assert.equal(t.image.width, N, name);
    assert.equal(t.magFilter, THREE.NearestFilter, name);
    assert.equal(t.wrapS, THREE.RepeatWrapping, name);
    assert.equal(t.generateMipmaps, false, name);
    assert.equal(t.colorSpace, THREE.SRGBColorSpace, name);
    assert.ok(TILE[name] > 0, `${name} has a tile size`);
    const d = t.image.data;
    for (let i = 0; i < d.length; i += 4) {
      assert.ok(d[i] === d[i + 1] && d[i] === d[i + 2] && d[i + 3] === 255, `${name} pixel ${i / 4} is grey and opaque`);
      assert.ok(d[i] >= 100, `${name} pixel ${i / 4} is too dark to tint (${d[i]})`);
    }
  }
});

test('brick: mortar on every course line, bricks lighter than mortar', () => {
  const b = textureBytes('brick', rngFor);
  for (let x = 0; x < N; x++) assert.equal(grey(b, x, 0), grey(b, 0, 0), `mortar at x ${x}`);
  assert.ok(grey(b, 4, 4) > grey(b, 0, 0) + 20, 'a brick face is clearly lighter than the mortar');
});

test('worldUV: one repeat per TILE meters on every face of a box, wherever it stands', () => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(6, 4, 2), new THREE.MeshBasicMaterial());
  m.position.set(10, 2, -3);
  m.updateMatrixWorld(true);
  worldUV(THREE, m, 2);
  const uv = m.geometry.attributes.uv, pos = m.geometry.attributes.position, nor = m.geometry.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    const w = [pos.getX(i) + 10, pos.getY(i) + 2, pos.getZ(i) - 3];
    const n = [nor.getX(i), nor.getY(i), nor.getZ(i)].map(Math.abs);
    const [a, b] = n[1] === 1 ? [w[0], w[2]] : n[0] === 1 ? [w[2], w[1]] : [w[0], w[1]];
    assert.ok(Math.abs(uv.getX(i) - a / 2) < 1e-5 && Math.abs(uv.getY(i) - b / 2) < 1e-5, `vertex ${i}`);
  }
});

test('moon: a crescent, lit limb at the bottom, horns up, clear outside the disc', () => {
  const n = CRESCENT.size, d = crescentBytes();
  const alpha = (x, y) => d[(y * n + x) * 4 + 3]; // row 0 is the bottom
  const mid = n / 2;
  assert.equal(alpha(mid, 1), 255, 'the bottom of the disc is lit');
  assert.equal(alpha(mid, mid), 0, 'the middle is in the dark part');
  assert.equal(alpha(0, n - 1), 0, 'outside the disc is clear');
  const lit = (y) => { let c = 0; for (let x = 0; x < n; x++) if (alpha(x, y)) c++; return c; };
  assert.ok(lit(Math.round(n * 0.6)) > 0 && lit(Math.round(n * 0.6)) < lit(4) * 2, 'the horns rise at the sides');
  let any = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) any++;
  assert.ok(any > n * n * 0.1 && any < n * n * 0.5, `a crescent, not a disc or a sliver (${any} lit pixels)`);
});
