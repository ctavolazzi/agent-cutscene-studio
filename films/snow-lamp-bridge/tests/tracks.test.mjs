// Checks for the tyre tracks (src/fx/tracks.js). Run: node --test tests/tracks.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CONFIG } from '../src/config.js';
import { carTimes } from '../src/world.js';
import { buildCar } from '../src/actors/car.js';
import { TRACK, buildTracks, segmentsDown, trackList, wheelAt } from '../src/fx/tracks.js';

const tracks = trackList();

test('four tracks, one per wheel, from the start to the stop, each point on its wheel path in time order', () => {
  assert.equal(tracks.length, 4);
  for (const { front, side, pts } of tracks) {
    assert.ok(pts.length > 100, `${pts.length} points`);
    assert.equal(pts[0].t, carTimes.start);
    assert.ok(pts.at(-1).t <= carTimes.stop && pts.at(-1).t > carTimes.stop - 1.5, `the last point ${pts.at(-1).t} is near the stop`);
    for (let i = 0; i < pts.length; i++) {
      const [x, z] = wheelAt(pts[i].t, front, side);
      assert.ok(Math.hypot(x - pts[i].x, z - pts[i].z) < 1e-9);
      if (i) {
        assert.ok(pts[i].t > pts[i - 1].t);
        assert.ok(Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z) >= TRACK.step - 1e-9);
      }
    }
  }
});

test('the wheel points sit under the car model\'s wheels', () => {
  const scene = new THREE.Scene();
  const car = buildCar({ THREE, scene, config: CONFIG });
  const p = new THREE.Vector3();
  for (const t of [16, 24, 27.5, 29.5]) {
    car.update(t);
    scene.updateMatrixWorld(true);
    for (const [tag, front, side] of [['fl', 1, -1], ['fr', 1, 1], ['rl', -1, -1], ['rr', -1, 1]]) {
      scene.getObjectByName(`car-wheel-${tag}`).getWorldPosition(p);
      const [x, z] = wheelAt(t, front, side);
      assert.ok(Math.hypot(p.x - x, p.z - z) < 1e-6, `${tag} at ${t}: model ${p.x.toFixed(3)}, ${p.z.toFixed(3)}, track ${x.toFixed(3)}, ${z.toFixed(3)}`);
    }
  }
});

test('the drawn part grows as the wheels pass: none before the car, all of it once stopped, never shrinking', () => {
  const scene = new THREE.Scene();
  const part = buildTracks({ THREE, scene, config: CONFIG });
  let lights = 0;
  scene.traverse((o) => { if (o.isLight) lights++; });
  assert.equal(lights, 0);
  const meshes = part.root.children;
  part.update(carTimes.start - 0.01);
  assert.ok(meshes.every((m) => !m.visible));
  let prev = meshes.map(() => 0);
  for (let t = carTimes.start; t <= 40; t += 0.37) {
    part.update(t);
    const now = meshes.map((m) => m.geometry.drawRange.count);
    now.forEach((c, i) => assert.ok(c >= prev[i], `track ${i} shrank at ${t}`));
    prev = now;
  }
  part.update(100);
  meshes.forEach((m, i) => assert.equal(m.geometry.drawRange.count, (tracks[i].pts.length - 1) * 6, 'whole track down'));
  // a segment is down only once the wheel has reached its far end
  const { pts } = tracks[0], k = 40;
  assert.equal(segmentsDown(pts, pts[k].t), k);
  assert.equal(segmentsDown(pts, pts[k].t - 1e-6), k - 1);
});
