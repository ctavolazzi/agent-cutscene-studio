// Checks for glow and beams (src/fx/glow.js). Run: node --test tests/glow.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CONFIG } from '../src/config.js';
import { LAMP } from '../src/set.js';
import { carTimes, headlights } from '../src/world.js';
import { buildGlow } from '../src/fx/glow.js';

function built() {
  const scene = new THREE.Scene();
  const part = buildGlow({ THREE, scene, config: CONFIG });
  return { scene, part, byName: (n) => scene.getObjectByName(n) };
}

test('adds no lights: lights.js owns the fixed set', () => {
  const { scene } = built();
  let lights = 0;
  scene.traverse((o) => { if (o.isLight) lights++; });
  assert.equal(lights, 0);
});

test('the car glows follow the headlights: off before the car, on while lit, fading with the cut, off after', () => {
  const { part, byName } = built();
  const head = byName('glow-head-left'), beam = byName('glow-beam-left'), tail = byName('glow-tail-right');
  for (const [t, want] of [[5, 0], [20, 1], [(carTimes.lightsOff0 + carTimes.lightsOff1) / 2, 0.5], [carTimes.lightsOff1 + 0.5, 0]]) {
    part.update(t);
    assert.ok(Math.abs(headlights(t) - want) < 1e-9, `headlights(${t})`);
    assert.equal(head.visible, want > 0, `head card at ${t}`);
    assert.ok(Math.abs(head.material.opacity - CONFIG.glow.headlight.opacity * want) < 1e-9, `head opacity at ${t}`);
    assert.ok(Math.abs(beam.material.opacity - CONFIG.glow.beamCone.opacity * want) < 1e-9, `beam opacity at ${t}`);
    assert.ok(Math.abs(tail.material.opacity - CONFIG.glow.taillight.opacity * want) < 1e-9, `tail opacity at ${t}`);
  }
});

test('the lamp glow sits at the lantern and never changes; same t, same state in any order', () => {
  const { part, byName } = built();
  const bulb = byName('glow-bulb');
  assert.ok(Math.abs(bulb.position.x - LAMP.head[0]) < 1e-9 && Math.abs(bulb.position.z - LAMP.head[2]) < 1e-9);
  const snap = (t) => { part.update(t); return byName('glow-head-right').position.toArray().concat(byName('glow-beam-right').quaternion.toArray()); };
  const a = snap(25), b = (snap(90), snap(18), snap(25));
  assert.deepEqual(a, b);
});
