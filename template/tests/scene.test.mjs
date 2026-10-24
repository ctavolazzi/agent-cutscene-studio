// Checks for the example scene (src/scene.js). Replace these with your film's own when you replace the scene.
// Run: node --test tests/scene.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CONFIG } from '../src/config.js';
import { mulberry32, hashString } from '../src/prng.js';
import { LAMP } from '../src/set.js';
import { T_TOTAL, lampFlicker } from '../src/world.js';
import { buildScene } from '../src/scene.js';

function built() {
  const scene = new THREE.Scene();
  const ctx = { THREE, scene, config: CONFIG, rngFor: (name) => mulberry32((CONFIG.seed ^ hashString(name)) >>> 0) };
  return { scene, parts: buildScene(ctx) };
}

test('the scene is built from parts that each have update(t)', () => {
  const { parts } = built();
  assert.ok(Array.isArray(parts) && parts.length >= 1);
  for (const p of parts) assert.equal(typeof p.update, 'function');
});

test('lights are made once at build: a sky and the lamp, the lamp at LAMP.head pointing straight down', () => {
  const { scene, parts } = built();
  const lights = [];
  scene.traverse((o) => { if (o.isLight) lights.push(o); });
  assert.deepEqual(lights.map((l) => l.name).sort(), ['light-hemi', 'light-lamp']);
  const lamp = scene.getObjectByName('light-lamp');
  assert.deepEqual(lamp.position.toArray(), LAMP.head);
  assert.deepEqual(lamp.target.position.toArray(), [LAMP.head[0], 0, LAMP.head[2]]);
  parts.forEach((p) => p.update(5));
  let after = 0;
  scene.traverse((o) => { if (o.isLight) after++; });
  assert.equal(after, 2, 'update never adds a light');
});

test('the lamp flickers between 0.85 and 1 of its intensity', () => {
  for (let t = 0; t < T_TOTAL; t += 0.01) {
    const f = lampFlicker(t);
    assert.ok(f >= 0.85 - 1e-12 && f <= 1 + 1e-12, `t ${t}: ${f}`);
  }
});

test('same t, same snow, whatever was drawn before; the snow moves between frames', () => {
  const { scene, parts } = built();
  const snap = (t) => { parts.forEach((p) => p.update(t)); return Array.from(scene.getObjectByName('snow').geometry.attributes.position.array); };
  const a = snap(6), b = (snap(11), snap(0.5), snap(6));
  assert.deepEqual(a, b);
  assert.notDeepEqual(snap(6), snap(6 + 1 / CONFIG.fps));
  // control: a second build with the same seed gives the same flakes
  const other = built();
  other.parts.forEach((p) => p.update(6));
  assert.deepEqual(Array.from(other.scene.getObjectByName('snow').geometry.attributes.position.array), a);
});
