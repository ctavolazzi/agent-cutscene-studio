// Checks for the PS1 look: the material patch (src/ps1/material.js) and the final pass (src/ps1/post.js).
// Run from the project root after npm run build: node --test tests/ps1.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { openScene } from '../scripts/lib/browser.mjs';
import { CONFIG } from '../src/config.js';
import { createPs1Uniforms, patchPs1, patchScene } from '../src/ps1/material.js';

const LEVELS = 2 ** CONFIG.ps1.bits - 1;
// how far a byte is from the nearest level the final pass can write (8-bit output rounds the level to a byte)
const offGrid = (v) => Math.abs(v - Math.round(Math.round((v / 255) * LEVELS) * (255 / LEVELS)));
const worstOffGrid = (buf) => { let w = 0; for (const v of buf) w = Math.max(w, offGrid(v)); return w; };

function compiled(material) {
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.lambert.vertexShader, fragmentShader: THREE.ShaderLib.lambert.fragmentShader };
  material.onBeforeCompile(shader, null);
  return shader;
}

test('patch: snap after projection, affine map coordinates, shared uniforms, its own program key', () => {
  const u = createPs1Uniforms(THREE, CONFIG);
  const a = patchPs1(THREE, new THREE.MeshLambertMaterial(), u), b = patchPs1(THREE, new THREE.MeshLambertMaterial(), u);
  const sa = compiled(a), sb = compiled(b);
  assert.equal(sa.uniforms.uPs1Snap, sb.uniforms.uPs1Snap, 'one uniform object drives every material');
  assert.equal(sa.uniforms.uPs1Snap.value, CONFIG.ps1.snap);
  assert.deepEqual(sa.uniforms.uPs1Res.value.toArray(), [CONFIG.res.w, CONFIG.res.h]);
  const v = sa.vertexShader;
  assert.ok(v.indexOf('ps1Snapped') > v.indexOf('#include <project_vertex>'), 'the snap runs after projection');
  assert.equal(v.split('#include <project_vertex>').length, 2, 'projection still happens exactly once');
  assert.match(sa.fragmentShader, /texture2D\( map, ps1MapUv \)/, 'the map samples the warped coordinates');
  assert.doesNotMatch(sa.fragmentShader, /texture2D\( map, vMapUv \)/);
  assert.match(a.customProgramCacheKey(), /^ps1\|/);
});

test('patch: an existing onBeforeCompile still runs, and a material is patched once', () => {
  const m = new THREE.MeshLambertMaterial();
  let ran = 0;
  m.onBeforeCompile = () => { ran++; };
  const u = createPs1Uniforms(THREE, CONFIG);
  patchPs1(THREE, m, u);
  patchPs1(THREE, m, u);
  const s = compiled(m);
  assert.equal(ran, 1);
  assert.equal(s.vertexShader.split('ps1Snapped =').length, 2, 'patched once, not twice');
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()), new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));
  assert.equal(patchScene(THREE, scene, u), 1, 'Lambert and Basic only');
});

test('control: the level check catches a value off the 5-bit grid', () => {
  assert.equal(worstOffGrid(Buffer.from([0, 8, 16, 33, 255])), 0);
  assert.ok(worstOffGrid(Buffer.from([0, 12])) >= 3, 'a byte between two levels is caught');
});

test('final pass: every pixel of real frames sits on a 5-bit level (overlay off)', { timeout: 300000 }, async () => {
  assert.equal(CONFIG.stage, 'look', 'the look stage draws through the final pass');
  const scene = await openScene({ overlay: false });
  try {
    for (const t of [4, 26, 36.4, 57, 80, 108]) {
      const { rgb } = await scene.frame(t);
      assert.ok(worstOffGrid(rgb) <= 1, `t ${t}: a channel is ${worstOffGrid(rgb)} off the nearest level`);
    }
    assert.deepEqual(scene.errors, []);
  } finally {
    await scene.close();
  }
});
