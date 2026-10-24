// Checks for the snow cover's prints (src/fx/footprints.js). Run: node --test tests/footprints.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CONFIG } from '../src/config.js';
import { PEOPLE } from '../src/world.js';
import { BODY, bodyToWorld, groundY, makePoser } from '../src/actors/people.js';
import { PRINT, buildFootprints, footprintList, snowY } from '../src/fx/footprints.js';

const prints = footprintList();
const posers = Object.fromEntries(Object.keys(PEOPLE).map((id) => [id, makePoser(id)]));

test('there are prints from both people, sorted by time, each lying on the snow', () => {
  for (const id of Object.keys(PEOPLE)) assert.ok(prints.filter((f) => f.id === id).length >= 10, `${id} leaves a trail`);
  for (let i = 1; i < prints.length; i++) assert.ok(prints[i].t >= prints[i - 1].t, 'sorted by time');
  for (const f of prints) assert.ok(Math.abs(f.y - (snowY(f.x, f.z) + PRINT.lift)) < 1e-12);
  assert.equal(snowY(4.5, 0), 0.15, 'control: the east sidewalk is curb high');
  assert.equal(snowY(0, 0), 0, 'control: the road is not');
  assert.ok(prints.some((f) => f.id === 'A' && f.t > 31 && f.t < 33), "A's boot leaves a print by the car (shot 5)");
});

test('each print is where a shoe of that person stands, at the moment it lands', () => {
  for (const f of prints) {
    const p = posers[f.id](f.t), k = PEOPLE[f.id].height / 1.8;
    assert.ok(p.visible, `${f.id} is on screen at ${f.t}`);
    const a = bodyToWorld(p, p.legs[f.foot].ankle);
    assert.ok(a[1] - groundY(a[0], a[2]) - BODY.ankleY * k <= PRINT.rest + 1e-9, `${f.id} foot ${f.foot} is down at ${f.t}`);
    const h = p.face * Math.PI / 180, toe = BODY.shoe.toe * k;
    assert.ok(Math.hypot(a[0] + Math.sin(h) * toe - f.x, a[2] - Math.cos(h) * toe - f.z) < 1e-9, 'under the shoe');
    // a step earlier the shoe was not yet down at this spot: lifted, or somewhere else, or not on screen
    const q = posers[f.id](f.t - PRINT.dt);
    if (q.visible) {
      const b = bodyToWorld(q, q.legs[f.foot].ankle);
      assert.ok(b[1] - groundY(b[0], b[2]) - BODY.ankleY * k > PRINT.rest, `${f.id} foot ${f.foot} landed at ${f.t}, not before`);
    }
  }
});

test('the walk leaves alternating prints, a step apart or side by side where it starts and stops', () => {
  for (const id of Object.keys(PEOPLE)) {
    const walk = prints.filter((f) => f.id === id && posers[id](f.t).pose === 'walk');
    assert.ok(walk.length >= 8, `${id}: ${walk.length} prints while walking`);
    let alternations = 0;
    for (let i = 1; i < walk.length; i++) {
      if (walk[i].foot !== walk[i - 1].foot) alternations++;
      const d = Math.hypot(walk[i].x - walk[i - 1].x, walk[i].z - walk[i - 1].z);
      assert.ok(d > PRINT.gap && d < 1.2, `${id}: ${d.toFixed(2)} m between prints at ${walk[i - 1].t} and ${walk[i].t}`);
    }
    assert.ok(alternations >= (walk.length - 1) * 0.8, `${id}: feet alternate (${alternations} of ${walk.length - 1})`);
  }
});

test('a print shows from its landing on; no lights; same t, same state in any order', () => {
  const scene = new THREE.Scene();
  const part = buildFootprints({ THREE, scene, config: CONFIG });
  let lights = 0;
  scene.traverse((o) => { if (o.isLight) lights++; });
  assert.equal(lights, 0);
  const meshes = part.root.children;
  assert.equal(meshes.length, prints.length);
  const f = prints[5], m = meshes[5];
  part.update(f.t - 1e-6);
  assert.equal(m.visible, false);
  part.update(f.t);
  assert.equal(m.visible, true);
  const snap = (t) => { part.update(t); return meshes.map((x) => x.visible); };
  const a = snap(55), b = (snap(100), snap(20), snap(55));
  assert.deepEqual(a, b);
  assert.ok(snap(111).every(Boolean), 'every print is down by the end');
});
