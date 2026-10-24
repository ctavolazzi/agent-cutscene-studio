// Checks for the cigarette (src/fx/smoke.js). Run: node --test tests/smoke.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CONFIG } from '../src/config.js';
import { LIGHTER, EXHALE, emberLevel, smokePuffs } from '../src/world.js';
import { makePoser, bodyToWorld } from '../src/actors/people.js';
import { buildSmoke } from '../src/fx/smoke.js';

function built() {
  const scene = new THREE.Scene();
  const part = buildSmoke({ THREE, scene, config: CONFIG });
  return { scene, part, byName: (n) => scene.getObjectByName(n) };
}
const near = (p, q, eps = 1e-9) => p.every((v, i) => Math.abs(v - q[i]) < eps);
const poseA = makePoser('A');

test('adds no lights: lights.js owns the fixed set', () => {
  const { scene } = built();
  let lights = 0;
  scene.traverse((o) => { if (o.isLight) lights++; });
  assert.equal(lights, 0);
});

test('the flame shows only while the lighter burns, at the cupped hands', () => {
  const { part, byName } = built();
  const flame = byName('smoke-flame');
  for (const [t, want] of [[LIGHTER.t0 - 0.1, false], [LIGHTER.t0, true], [(LIGHTER.t0 + LIGHTER.t1) / 2, true], [LIGHTER.t1, false], [100, false]]) {
    part.update(t);
    assert.equal(flame.visible, want, `flame at ${t}`);
    if (want) {
      const a = poseA(t), at = bodyToWorld(a, a.cup);
      assert.ok(near(flame.position.toArray(), [at[0], at[1] + CONFIG.smoke.flame.lift, at[2]]), `flame at the cup, t ${t}`);
    }
  }
});

test('the ember lights when the flame goes out, sits at the tip and brightens on each drag', () => {
  const { part, byName } = built();
  const ember = byName('smoke-ember'), halo = byName('smoke-ember-halo');
  part.update(LIGHTER.t1 - 0.01);
  assert.equal(ember.visible, false, 'no ember before it catches');
  const opacityAt = (t) => { part.update(t); return halo.material.opacity; };
  for (const t of [LIGHTER.t1, 85, 97.4]) {
    part.update(t);
    assert.equal(ember.visible, emberLevel(t) > 0, `ember at ${t}`);
    const a = poseA(t);
    assert.ok(near(ember.position.toArray(), bodyToWorld(a, a.tip)), `ember at the tip, t ${t}`);
  }
  assert.ok(opacityAt(97.4) > opacityAt(94), 'a drag glows brighter than the ember at rest');
});

test('one sprite per puff, at the puff, none before the ember catches', () => {
  const { part, scene } = built();
  const visiblePuffs = () => { const out = []; scene.traverse((o) => { if (o.name.startsWith('smoke-puff-') && o.visible) out.push(o); }); return out; };
  part.update(LIGHTER.t1 - 0.01);
  assert.equal(visiblePuffs().length, 0);
  for (const t of [82, EXHALE.t + 0.5, EXHALE.t + 2, 105]) {
    part.update(t);
    const a = poseA(t), list = smokePuffs(t, bodyToWorld(a, a.tip)), shown = visiblePuffs();
    assert.equal(shown.length, list.length, `puff count at ${t}`);
    list.forEach((q, i) => assert.ok(near(scene.getObjectByName(`smoke-puff-${i}`).position.toArray(), q.pos), `puff ${i} at ${t}`));
  }
  part.update(EXHALE.t + 0.5);
  assert.ok(smokePuffs(EXHALE.t + 0.5, [0, 0, 0]).some((q) => q.kind === 'exhale'), 'the exhale is on screen half a second in');
});

test('same t, same visible state in any order (a hidden sprite keeps its last place, unseen)', () => {
  const { part, scene } = built();
  const snap = (t) => { part.update(t); const s = []; scene.traverse((o) => { if (o.isSprite) s.push(o.name, o.visible, ...(o.visible ? [...o.position.toArray(), o.material.opacity] : [])); }); return s; };
  const a = snap(91), b = (snap(79), snap(105), snap(91));
  assert.deepEqual(a, b);
});
