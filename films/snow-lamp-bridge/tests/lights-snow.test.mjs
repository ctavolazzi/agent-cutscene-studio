// Node test for src/fx/lights.js and src/fx/snow.js. Run from the project root: node tests/lights-snow.test.mjs
// The snow shader is also compiled and drawn in headless Chromium (software WebGL), loaded straight from src/ and
// never from dist/, then compared flake by flake with a JS copy of the shader. Needs the Chromium that
// scripts/lib/raster.mjs finds. Optional: S2_OUT=<dir> writes snapshots, per-shot snow counts and the GPU comparison
// to <dir>/lights-snow/ for inspection.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import * as THREE from 'three';
import * as lightsModule from '../src/fx/lights.js';
import * as snowModule from '../src/fx/snow.js';
import { CONFIG } from '../src/config.js';
import { LAMP, MOON, RAIL, WIND } from '../src/set.js';
import { carAt, carTimes, headlights, moonAt, moonlight, peopleAt, PEOPLE_KEYS, LIGHTER, lighterOn, emberOn, T_TOTAL } from '../src/world.js';
import { SHOTS, shotAt, cameraAt } from '../src/shots.js';
import { applyShotCamera } from '../src/timeline.js';
import { mulberry32, hashString } from '../src/prng.js';
import { makePoser, bodyToWorld, buildPeople } from '../src/actors/people.js';
import { buildCar } from '../src/actors/car.js';
import { buildSet } from '../src/set/build.js';
import { chromiumPath } from '../scripts/lib/raster.mjs';
import { GL_ARGS } from '../scripts/lib/browser.mjs';

const { buildLights } = lightsModule;
const { buildSnow } = snowModule;
const D2R = Math.PI / 180;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.S2_OUT ? join(process.env.S2_OUT, 'lights-snow') : null;
const W = CONFIG.res.w, H = CONFIG.res.h, FPS = CONFIG.fps;
const ASPECT = W / H;

let passed = 0;
async function check(name, fn) {
  await fn();
  passed++;
  console.log(`ok ${passed} ${name}`);
}
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: got ${a}, want ${b} (eps ${eps})`);
const nearVec = (a, b, eps, msg) => a.forEach((v, i) => near(v, b[i], eps, `${msg} [${i}]`));
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const mid = (a, b) => a.map((v, i) => (v + b[i]) / 2);

const ctxFor = (scene, seed = CONFIG.seed) => ({ THREE, scene, config: CONFIG, rngFor: (name) => mulberry32((seed ^ hashString(name)) >>> 0) });

// one scene with both parts, the way main.js builds them, with main.js's camera
function make({ seed, lights = buildLights, snow = buildSnow } = {}) {
  const scene = new THREE.Scene();
  const ctx = ctxFor(scene, seed);
  const parts = [lights(ctx), snow(ctx)];
  const camera = new THREE.PerspectiveCamera(37.8, ASPECT, 0.05, 3000);
  const get = (name) => {
    const o = scene.getObjectByName(name);
    assert.ok(o, `missing object ${name}`);
    return o;
  };
  // the real camera for t, then every part, exactly as timeline.renderAt does it
  const at = (t) => {
    applyShotCamera(camera, shotAt(t), t, ASPECT);
    for (const p of parts) p.update(t, camera);
  };
  return { scene, parts, camera, get, at };
}

const LIGHT_NAMES = ['light-hemi', 'light-lamp', 'light-headlight-left', 'light-headlight-right', 'light-moon', 'light-lighter', 'light-ember'];
const lightsOf = (scene) => { const out = []; scene.traverse((o) => { if (o.isLight) out.push(o); }); return out; };
const trans = (o) => new THREE.Vector3().setFromMatrixPosition(o.matrixWorld).toArray();
const uniformValue = (v) => (typeof v === 'number' ? v : v.toArray());

// Everything update may touch, in a fixed traversal order. No scene.updateMatrixWorld here on purpose:
// the matrices recorded are the ones the module itself left behind.
function snapshot(scene) {
  const out = [];
  scene.traverse((o) => {
    if (o === scene) return;
    const rec = { name: o.name, type: o.type, visible: o.visible, p: o.position.toArray(), mw: Array.from(o.matrixWorld.elements) };
    if (o.isLight) Object.assign(rec, { intensity: o.intensity, color: o.color.toArray() });
    if (o.isPoints) rec.uniforms = Object.fromEntries(Object.entries(o.material.uniforms).map(([k, u]) => [k, uniformValue(u.value)]));
    out.push(rec);
  });
  return out;
}

// the edges of every beat come from world.js: the car (and its beams) appearing, the beams fading, the lighter and ember
const { start: CAR_T0, lightsOff0: BEAM_T0, lightsOff1: BEAM_T1 } = carTimes;
const TIMES = [
  0, 5, 10, CAR_T0 - 0.01, CAR_T0, CAR_T0 + 0.01, 20, carTimes.turn0, (carTimes.turn0 + carTimes.turn1) / 2, carTimes.turn1, 29, 30, 34.5,
  BEAM_T0, (BEAM_T0 + BEAM_T1) / 2, BEAM_T1 - 0.01, BEAM_T1, BEAM_T1 + 0.1, 40, 60, 66, 68, 70, 72, 76, 77.99, 78, 78.5,
  LIGHTER.t0 - 0.01, LIGHTER.t0, LIGHTER.t0 + 0.1, 79, LIGHTER.t1 - 0.01, LIGHTER.t1, 80.2, 80.6, 81,
  85, 89.2, 89.6, 90, 95, 97, 97.4, 100, 111.9, T_TOTAL - 1e-6,
];
for (let f = 0; f < T_TOTAL * FPS; f += 5) TIMES.push(f / FPS);
const ASC = [...new Set(TIMES)].sort((a, b) => a - b);

function shuffled(arr, seed) {
  const out = [...arr];
  const r = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

// Times whose state differs between ascending order and a scrambled order (each on a fresh build).
function orderMismatches(opts, times = ASC) {
  const ref = new Map();
  const a = make(opts);
  for (const t of times) { a.at(t); ref.set(t, snapshot(a.scene)); }
  const b = make(opts);
  const bad = [];
  for (const t of shuffled(times, 99)) {
    b.at(t);
    try { assert.deepStrictEqual(snapshot(b.scene), ref.get(t)); } catch { bad.push(t); }
  }
  return { bad, ref };
}

// ---------------- lights

await check('exactly seven lights, of the right kinds, with targets in the scene', () => {
  const { scene, get } = make();
  const lights = lightsOf(scene);
  assert.equal(lights.length, 7);
  assert.deepEqual(lights.map((l) => l.name).sort(), [...LIGHT_NAMES].sort());
  const kinds = {};
  for (const l of lights) kinds[l.type] = (kinds[l.type] ?? 0) + 1;
  assert.deepEqual(kinds, { HemisphereLight: 1, SpotLight: 3, DirectionalLight: 1, PointLight: 2 });
  for (const n of ['light-lamp', 'light-headlight-left', 'light-headlight-right', 'light-moon']) {
    const l = get(n);
    assert.equal(l.target.parent, scene, `${n} target must be in the scene`);
    assert.equal(l.target.name, `${n}-target`);
  }
  for (const l of lights) assert.equal(l.castShadow, false, `${l.name} casts no shadow in the blockout`);
});

await check('light count, scene graph and visibility never change across updates', () => {
  const { scene, at } = make();
  const count = () => { let n = 0, lights = 0, hidden = 0; scene.traverse((o) => { n++; if (o.isLight) lights++; if (!o.visible) hidden++; }); return { n, lights, hidden }; };
  const before = count();
  assert.equal(before.lights, 7);
  assert.equal(before.hidden, 0);
  for (const t of shuffled(ASC, 5)) {
    at(t);
    assert.deepEqual(count(), before, `scene changed at t ${t}`);
  }
});

await check('hemisphere light: config sky, ground and intensity', () => {
  const { get } = make();
  const h = get('light-hemi');
  assert.ok(h.isHemisphereLight);
  assert.deepEqual(h.color.toArray(), new THREE.Color(CONFIG.lights.hemi.sky).toArray());
  assert.deepEqual(h.groundColor.toArray(), new THREE.Color(CONFIG.lights.hemi.ground).toArray());
  assert.equal(h.intensity, 0.6);
});

await check('lamp: a spot at LAMP.head pointing straight down, 70 degrees, constant over the whole film', () => {
  const { get, at } = make();
  const L = CONFIG.lights.lamp;
  const lamp = get('light-lamp');
  for (const t of [0, 4, 36.4, 79, 111.9]) {
    at(t);
    assert.deepEqual(lamp.position.toArray(), [4.6, 4.5, -4.5]); // moved 1.5 m south at Gate 2 (decision 1c)
    assert.deepEqual(lamp.position.toArray(), LAMP.head);
    assert.deepEqual(lamp.target.position.toArray(), [LAMP.head[0], 0, LAMP.head[2]]);
    assert.ok(lamp.target.position.y < lamp.position.y, 'target below the lamp');
    nearVec(trans(lamp), LAMP.head, 1e-12, 'lamp world position');
    nearVec(trans(lamp.target), [4.6, 0, -4.5], 1e-12, 'lamp target world position');
    assert.equal(lamp.intensity, 60);
  }
  near(lamp.angle, 70 * D2R, 1e-12, 'angle');
  assert.equal(L.angleDeg, 70);
  assert.equal(lamp.penumbra, 0.5);
  assert.equal(lamp.decay, 2);
  assert.equal(lamp.distance, 0);
  assert.deepEqual(lamp.color.toArray(), new THREE.Color(L.color).toArray());
});

await check('headlights: 0 before the car appears, 400 from carTimes.start, half halfway through the fade, 0 once faded', () => {
  const { get, at } = make();
  const hl = [get('light-headlight-left'), get('light-headlight-right')];
  // the car and its beams appear together, already moving, at the cut into shot 3
  assert.equal(CAR_T0, SHOTS.find((s) => s.n === 3).start, 'the beams come on at the cut into shot 3');
  const want = new Map([[0, 0], [10, 0], [CAR_T0 - 0.01, 0], [CAR_T0, 400], [20, 400], [30, 400], [BEAM_T0, 400], [BEAM_T1, 0], [BEAM_T1 + 0.1, 0], [40, 0], [60, 0], [111.9, 0]]);
  for (const t of shuffled([...want.keys()], 3)) {
    at(t);
    for (const l of hl) near(l.intensity, want.get(t), 1e-9, `${l.name} at ${t}`);
  }
  at((BEAM_T0 + BEAM_T1) / 2);
  for (const l of hl) near(l.intensity, 200, 1e-6, `${l.name} halfway through the fade`);
  // positive exactly while the car is present and its lights are up
  for (const t of ASC) {
    at(t);
    const on = carAt(t).present && headlights(t) > 0;
    for (const l of hl) assert.equal(l.intensity > 0, on, `${l.name} at ${t}`);
  }
  const L = CONFIG.lights.headlight;
  for (const l of hl) {
    near(l.angle, L.angleDeg * D2R, 1e-12, 'angle');
    assert.equal(l.penumbra, L.penumbra);
    assert.equal(l.decay, L.decay);
  }
});

await check('headlights sit just ahead of the lenses (forward 2.4, side 0.65, y 0.7) and aim 15 m ahead at the road', () => {
  const { get, at } = make();
  const left = get('light-headlight-left'), right = get('light-headlight-right');
  // t 18: westbound on the cross street at x 17.5, heading 270, so the car's left is south (+Z)
  at(18);
  nearVec(left.position.toArray(), [15.1, 0.7, 18.15], 1e-9, 'left at 18');
  nearVec(right.position.toArray(), [15.1, 0.7, 16.85], 1e-9, 'right at 18');
  nearVec(left.target.position.toArray(), [0.1, 0, 18.15], 1e-9, 'left target at 18');
  // t 30: parked facing north at (2.2, 1.85)
  at(30);
  nearVec(left.position.toArray(), [1.55, 0.7, -0.55], 1e-9, 'left at 30');
  nearVec(right.position.toArray(), [2.85, 0.7, -0.55], 1e-9, 'right at 30');
  nearVec(right.target.position.toArray(), [2.85, 0, -15.55], 1e-9, 'right target at 30');
  // through the turn and everywhere else: car-local offsets from carAt(t), matrices current
  for (const t of ASC) {
    at(t);
    const c = carAt(t);
    const h = c.heading * D2R;
    const f = [Math.sin(h), 0, -Math.cos(h)], r = [Math.cos(h), 0, Math.sin(h)];
    for (const [l, side] of [[left, -1], [right, 1]]) {
      const p = l.position, d = [p.x - c.x, p.z - c.z];
      near(d[0] * f[0] + d[1] * f[2], 2.4, 1e-9, `forward offset at ${t}`);
      near(d[0] * r[0] + d[1] * r[2], 0.65 * side, 1e-9, `side offset at ${t}`);
      assert.equal(p.y, 0.7);
      const aim = l.target.position.clone().sub(p);
      near(Math.hypot(aim.x, aim.z), 15, 1e-9, `aim distance at ${t}`);
      near((aim.x * f[0] + aim.z * f[2]) / 15, 1, 1e-9, `aim straight ahead at ${t}`);
      near(Math.atan2(-aim.y, 15) / D2R, Math.atan2(0.7, 15) / D2R, 1e-9, `aim pitch down at ${t}`);
      nearVec(trans(l), p.toArray(), 1e-9, `matrixWorld follows ${l.name} at ${t}`);
      nearVec(trans(l.target), l.target.position.toArray(), 1e-9, `matrixWorld follows ${l.name} target at ${t}`);
    }
  }
});

await check('moon: 0 at t 60, full (0.35) at t 80, from azimuth 84 and never below 5 degrees', () => {
  const { get, at } = make();
  const moon = get('light-moon');
  at(60); assert.equal(moon.intensity, 0);
  at(80); assert.equal(moon.intensity, 0.35);
  at(111.9); assert.equal(moon.intensity, 0.35);
  at(72); near(moon.intensity, 0.35 * moonlight(72), 1e-12, 'moon at 72');
  assert.ok(moon.intensity > 0 && moon.intensity < 0.35);
  const dirAt = (t) => { at(t); return moon.position.clone().sub(moon.target.position); };
  for (const t of ASC) {
    const d = dirAt(t);
    near(d.length(), 100, 1e-9, `moon distance at ${t}`);
    d.normalize();
    const el = Math.asin(d.y) / D2R;
    const az = ((Math.atan2(d.x, -d.z) / D2R) + 360) % 360;
    near(az, MOON.azimuthDeg, 1e-9, `azimuth at ${t}`);
    near(el, Math.max(moonAt(t).elevationDeg, 5), 1e-9, `elevation at ${t}`);
    assert.ok(el >= 5 - 1e-9, `moon light from below 5 degrees at ${t}`);
    nearVec(moon.target.position.toArray(), [0, 0, -10], 0, 'moon aim');
    nearVec(trans(moon.target), [0, 0, -10], 1e-12, 'moon target matrix');
    near(moon.intensity, 0.35 * moonlight(t), 1e-12, `moon intensity at ${t}`);
  }
  near(Math.asin(dirAt(70).normalize().y) / D2R, 5, 1e-9, 'clamped at t 70');
  const el100 = Math.asin(dirAt(100).normalize().y) / D2R;
  near(el100, moonAt(100).elevationDeg, 1e-9, 'tracks the moon at t 100');
  assert.ok(el100 > 7.9 && el100 < 8.0, `t 100 elevation ${el100}`);
});

await check('lighter: on only from LIGHTER.t0 to LIGHTER.t1, flickering from t', () => {
  const { get, at } = make();
  const lighter = get('light-lighter');
  // about 1.5 s of flame, struck only once A has turned into the lee and cupped the hands (A's first 'cup' key)
  near(LIGHTER.t1 - LIGHTER.t0, 1.5, 1e-9, 'flame duration');
  const cupKey = PEOPLE_KEYS.A.find((k) => k.pose === 'cup');
  assert.ok(cupKey && cupKey.t <= LIGHTER.t0, `the lighter strikes at ${LIGHTER.t0}, before A's cup pose at ${cupKey?.t}`);
  const flick = (t) => 3 * (0.75 + 0.25 * Math.sin(t * 37) * Math.sin(t * 23.3));
  const { t0, t1 } = LIGHTER;
  for (const t of [...ASC, t0 - 0.01, t0, t0 + 0.25, t1 - 0.25, t1 - 1e-4, t1]) {
    at(t);
    const on = t >= t0 && t < t1;
    assert.equal(lighterOn(t), on);
    if (on) {
      near(lighter.intensity, flick(t), 1e-12, `flicker at ${t}`);
      assert.ok(lighter.intensity >= 1.5 && lighter.intensity <= 3, `range at ${t}`);
    } else assert.equal(lighter.intensity, 0, `lighter off at ${t}`);
  }
  // a flicker, not a constant: several distinct values inside 1.5 s at 24 fps
  const seen = new Set();
  for (let f = Math.ceil(t0 * FPS); f < t1 * FPS; f++) { at(f / FPS); seen.add(lighter.intensity.toFixed(4)); }
  assert.ok(seen.size >= 20, `only ${seen.size} distinct flicker values`);
});

await check('ember: 0 before LIGHTER.t1, steady 0.25 after, 0.75 at the middle of each 0.8 s drag (80.2, 89.2, 97.0)', () => {
  const { get, at } = make();
  const ember = get('light-ember');
  const { t1 } = LIGHTER;
  // the ember catches as the flame goes out, and before the first drag starts, so no drag is cut short
  assert.ok(t1 <= 80.2, `the ember catches at ${t1}, after the first drag starts at 80.2`);
  for (const t of [0, 60, 78, 79, t1 - 0.01]) { at(t); assert.equal(ember.intensity, 0, `off at ${t}`); }
  for (const t of [t1, (t1 + 80.2) / 2, 80.2, 85, 89.2, 92, 95, 96.9, 97, 99, 111.9]) { at(t); near(ember.intensity, 0.25, 1e-12, `steady at ${t}`); }
  for (const t of [81, 90, 97.8]) { at(t); near(ember.intensity, 0.25, 1e-9, `drag over at ${t}`); }
  for (const t of [80.6, 89.6, 97.4]) { at(t); near(ember.intensity, 0.75, 1e-9, `drag peak at ${t}`); }
  for (const t of [80.4, 89.4, 97.2]) { at(t); near(ember.intensity, 0.25 + 0.5 * Math.sin(Math.PI / 4) ** 2, 1e-9, `drag rising at ${t}`); }
  for (const t of ASC) { at(t); assert.equal(ember.intensity > 0, emberOn(t), `ember on iff emberOn at ${t}`); }
});

// ---------------- lighter and ember against the people rig (actors/people.js), every frame either is lit

const poseA = makePoser('A');
const rigA = (t) => {
  const q = poseA(t);
  const w = (v) => bodyToWorld(q, v);
  return { cup: w(q.cup), mouth: w(q.mouth), handL: w(q.arms[0].hand), handR: w(q.arms[1].hand) };
};
const gazeA = (t) => { const l = peopleAt(t).A.look * D2R; return [Math.sin(l), 0, -Math.cos(l)]; };
const LIT_FRAMES = []; // every frame from the first one the lighter is on to the end of the film
for (let f = Math.ceil(LIGHTER.t0 * FPS); f < T_TOTAL * FPS; f++) LIT_FRAMES.push(f / FPS);

// Every way the lights can be out of place against the rig. `place(t)` gives { lighter, ember } positions for t.
function rigMisses(place) {
  const out = [];
  const miss = (t, what, d, max) => { if (!(d <= max)) out.push(`${what} at ${t.toFixed(3)}: ${d.toFixed(3)} m, max ${max}`); };
  for (const t of LIT_FRAMES) {
    const r = rigA(t), p = place(t);
    if (lighterOn(t)) {
      miss(t, 'lighter to the rig cup', dist(p.lighter, r.cup), 0.03);
      // the hands reach the cup at 78.1 (they lead the turn that starts at 77.5) and the lighter strikes after that
      // (LIGHTER.t0), so the flame is between them from its first frame
      miss(t, 'lighter to the middle of the hands', dist(p.lighter, mid(r.handL, r.handR)), 0.005);
    }
    if (emberOn(t)) {
      miss(t, 'ember to the rig cup', dist(p.ember, r.cup), 0.03);
      if (t < 82) miss(t, 'ember to the middle of the cupped hands', dist(p.ember, mid(r.handL, r.handR)), 0.005);
      if (t >= 84.0) {
        // smoking: the right hand is at the mouth and the tip glows 0.1 m past it along the gaze
        const g = gazeA(t);
        miss(t, 'right hand to the mouth', dist(r.handR, r.mouth), 0.01);
        miss(t, 'ember to the tip past the right hand', dist(p.ember, r.handR.map((v, i) => v + g[i] * 0.1)), 0.03);
      }
    }
  }
  return out;
}

await check('lighter and ember sit where the people rig puts the cupped hands and the cigarette tip, every lit frame', () => {
  const { get, at } = make();
  const lighter = get('light-lighter'), ember = get('light-ember');
  const misses = rigMisses((t) => {
    at(t);
    nearVec(trans(lighter), lighter.position.toArray(), 1e-12, `lighter matrix at ${t}`);
    nearVec(trans(ember), ember.position.toArray(), 1e-12, `ember matrix at ${t}`);
    return { lighter: lighter.position.toArray(), ember: ember.position.toArray() };
  });
  assert.deepEqual(misses.slice(0, 5), [], `${misses.length} misses`);
  // the frames checked start on the first lit frame and run, one per frame, to the last frame of the film
  assert.ok(lighterOn(LIT_FRAMES[0]) && !lighterOn(LIT_FRAMES[0] - 1 / FPS), `first checked frame ${LIT_FRAMES[0]}`);
  near(LIT_FRAMES.at(-1), T_TOTAL - 1 / FPS, 1e-9, 'last checked frame');
  assert.equal(LIT_FRAMES.length, Math.round((T_TOTAL - LIT_FRAMES[0]) * FPS));
  assert.ok(LIT_FRAMES.length > 800, `only ${LIT_FRAMES.length} lit frames`);
  // t 79, the cup hold: A faces 190 and looks 245, into the lee. The head is 0.115 m ahead of the feet (torso pitch
  // 12 degrees) at 1.676 m; the cup is 0.2 m ahead of it along the gaze and 0.1 m down.
  at(79);
  nearVec(lighter.position.toArray(), [5.0487, 1.5758, -11.1021], 1e-4, 'lighter at 79');
  nearVec(ember.position.toArray(), [5.0487, 1.5758, -11.1021], 1e-4, 'tip at 79');
  // 7 cm from each hand (hand spheres are 5 cm), so the flame lights their inner faces
  const r79 = rigA(79);
  near(dist(lighter.position.toArray(), r79.handL), 0.07, 0.005, 'flame to the left hand');
  near(dist(lighter.position.toArray(), r79.handR), 0.07, 0.005, 'flame to the right hand');
  // t 85 smoking, turned back to the river (face and look 90, square on at RAIL.zA), and t 100 with the shoulders
  // closed in (z + 0.2): the same pose 0.2 m further south
  at(85); nearVec(ember.position.toArray(), [5.5651, 1.5758, RAIL.zA], 1e-4, 'tip at 85');
  near(peopleAt(85).A.look, 90, 1e-12, 'A looks at the river at 85');
  const tip85 = ember.position.toArray();
  at(100); nearVec(ember.position.toArray(), [5.5651, 1.5758, RAIL.zA + 0.2], 1e-4, 'tip at 100');
  nearVec(ember.position.toArray(), [tip85[0], tip85[1], tip85[2] + 0.2], 1e-9, 'tip at 100 is the tip at 85 moved 0.2 m south');
  near(peopleAt(100).A.z, RAIL.zA + 0.2, 1e-12, 'A at 100');
  near(dist(ember.position.toArray(), rigA(100).handR), 0.1, 1e-6, 'tip 0.1 m past the hand at 100');
});

await check('control: the rig check catches the old placement and a head without the torso pitch', () => {
  // the first build: fixed heights 1.45 and 1.54 along the body heading, not the gaze
  const old = (t) => {
    const a = peopleAt(t).A, h = a.face * D2R;
    const pt = (fw, y) => [a.x + Math.sin(h) * fw, y, a.z - Math.cos(h) * fw];
    return { lighter: pt(0.32, 1.45), ember: pt(0.46, 1.54) };
  };
  assert.ok(rigMisses(old).length > 700, 'the old placement passed');
  // the cup along the gaze, but from a head straight over the feet (0.115 m too far back)
  const upright = (t) => {
    const a = peopleAt(t).A, l = a.look * D2R;
    const p = [a.x + Math.sin(l) * 0.2, 1.5758, a.z - Math.cos(l) * 0.2];
    return { lighter: p, ember: p };
  };
  assert.ok(rigMisses(upright).length > 700, 'an upright head passed');
});

await check('shot 14 (the insert on the ember) keeps the ember in frame for all 4 s', () => {
  const { get, at, camera } = make();
  const ember = get('light-ember');
  const s14 = SHOTS.find((s) => s.n === 14);
  const sx = [];
  for (let f = Math.ceil(s14.start * FPS); f < s14.end * FPS; f++) {
    const t = f / FPS;
    at(t);
    const v = ember.position.clone().project(camera);
    const x = (v.x + 1) / 2, y = (1 - v.y) / 2;
    assert.ok(v.z > -1 && v.z < 1 && x > 0.1 && x < 0.9 && y > 0.1 && y < 0.9, `ember out of frame at ${t}: ${x}, ${y}`);
    sx.push(x);
  }
  // shots.js composes on the rig's tip at 98 s at sx 0.45. The camera is locked and A's 0.2 m lean-in toward B is over
  // before the shot starts (it ends inside shot 13), so the ember holds where it was composed
  const last = PEOPLE_KEYS.A.at(-1), leanEnd = PEOPLE_KEYS.A.find((k) => k.x === last.x && k.z === last.z); // first key at the final spot
  assert.ok(leanEnd.t <= s14.start, `A's lean-in ends at ${leanEnd.t}, after shot 14 starts at ${s14.start}`);
  for (const x of sx) near(x, 0.45, 0.01, 'ember where shot 14 is composed');
  console.log(`   shot 14 ember sx ${Math.min(...sx).toFixed(3)} to ${Math.max(...sx).toFixed(3)} (composed for 0.45)`);
});

await check('lights ignore the camera argument', () => {
  const a = make(), b = make();
  a.at(79);
  b.at(79);
  const other = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  other.position.set(9, 9, 9);
  b.parts[0].update(79, other);
  b.parts[0].update(79, undefined);
  const lightsOnly = (s) => snapshot(s).filter((r) => r.type !== 'Points');
  assert.deepStrictEqual(lightsOnly(b.scene), lightsOnly(a.scene));
});

// ---------------- snow

const S = CONFIG.snow;

await check('snow: one Points with a ShaderMaterial (not raw), transparent, no depth write, no fog, never culled', () => {
  const { get } = make();
  const p = get('snow');
  assert.ok(p.isPoints);
  assert.ok(p.material.isShaderMaterial);
  assert.ok(!p.material.isRawShaderMaterial);
  assert.equal(p.material.transparent, true);
  assert.equal(p.material.depthWrite, false);
  assert.equal(p.material.fog, false);
  assert.equal(p.frustumCulled, false);
  assert.deepEqual(p.position.toArray(), [0, 0, 0], 'flakes are computed in world space, so the cloud stays at the origin');
});

await check('snow draws after every other transparent object in the set, car and people (it writes no depth)', () => {
  const scene = new THREE.Scene();
  const ctx = ctxFor(scene);
  buildSet(ctx); buildCar(ctx); buildPeople(ctx);
  buildSnow(ctx);
  const snow = scene.getObjectByName('snow');
  assert.equal(snow.renderOrder, 2);
  // three.js sorts the transparent list by the nearest Group's renderOrder, then the object's own, then distance
  const key = (o) => { let g = o; while (g && !g.isGroup) g = g.parent; return [g ? g.renderOrder : 0, o.renderOrder]; };
  const before = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
  const others = [];
  scene.traverse((o) => { if (o !== snow && o.material && [o.material].flat().some((m) => m.transparent)) others.push(o); });
  const names = others.map((o) => o.name);
  for (const n of ['car-shadow', 'person-A-shadow', 'person-B-shadow', 'lamp:glass', 'lamp:bulb']) assert.ok(names.includes(n), `no ${n} found`);
  for (const o of others) assert.ok(before(key(o), key(snow)), `${o.name} [${key(o)}] would draw over the snow [${key(snow)}]`);
});

await check('snow attributes: right lengths and ranges, seeded from rngFor(\'snow\')', () => {
  const { get } = make();
  const g = get('snow').geometry;
  const n = S.count;
  assert.ok(n >= 1000, 'a snow count that reads at 480x270');
  assert.equal(g.attributes.position.array.length, n * 3);
  assert.equal(g.attributes.position.itemSize, 3);
  for (const k of ['aSpeed', 'aPhase', 'aSize']) {
    assert.equal(g.attributes[k].array.length, n, `${k} length`);
    assert.equal(g.attributes[k].itemSize, 1, `${k} item size`);
  }
  const b = g.attributes.position.array, sp = g.attributes.aSpeed.array, ph = g.attributes.aPhase.array, sz = g.attributes.aSize.array;
  for (let i = 0; i < n * 3; i++) assert.ok(b[i] >= 0 && b[i] <= 1, `base ${i} outside the unit cube`);
  let big = 0;
  for (let i = 0; i < n; i++) {
    assert.ok(sp[i] >= Math.fround(S.fallMin) && sp[i] <= Math.fround(S.fallMax), `speed ${i} = ${sp[i]}`);
    assert.ok(ph[i] >= 0 && ph[i] <= Math.fround(2 * Math.PI), `phase ${i}`);
    assert.ok(sz[i] === S.sizePx[0] || sz[i] === S.sizePx[1], `size ${i} = ${sz[i]}`);
    if (sz[i] === 2) big++;
  }
  assert.ok(big > 0.3 * n && big < 0.4 * n, `${big} two-pixel flakes`);
  // fall speeds span the configured range, so flakes do not fall in lockstep
  assert.ok(Math.min(...sp) < S.fallMin + 0.01 && Math.max(...sp) > S.fallMax - 0.01);
  // the first flake is the first three draws of the snow's own stream
  const r = mulberry32((CONFIG.seed ^ hashString('snow')) >>> 0);
  assert.deepEqual([b[0], b[1], b[2]], [Math.fround(r()), Math.fround(r()), Math.fround(r())]);
  near(sp[0], S.fallMin + (S.fallMax - S.fallMin) * r(), 1e-6, 'first speed');
});

await check('snow attributes are identical across two builds with the same seed, and differ with another seed', () => {
  const attrs = (m) => Object.fromEntries(Object.entries(m.get('snow').geometry.attributes).map(([k, a]) => [k, Array.from(a.array)]));
  const a = attrs(make()), b = attrs(make());
  assert.deepStrictEqual(a, b);
  const c = attrs(make({ seed: CONFIG.seed + 1 }));
  for (const k of Object.keys(a)) assert.notDeepStrictEqual(c[k], a[k], `${k} ignores the seed`);
});

await check('snow uniforms: update sets uTime, uCam and uMoon only; the rest come from set.js and config', () => {
  const { get, at, camera, parts } = make();
  const u = get('snow').material.uniforms;
  const sceneLight = (name) => get(name);
  const DYNAMIC = ['uTime', 'uCam', 'uMoon', 'uHead0', 'uHead1', 'uHeadDir', 'uHeadOn'];
  const statics = () => Object.fromEntries(Object.entries(u).filter(([k]) => !DYNAMIC.includes(k)).map(([k, v]) => [k, uniformValue(v.value)]));
  const before = statics();
  for (const t of [4, 60, 80, 111.9]) {
    at(t);
    assert.equal(u.uTime.value, t);
    assert.equal(u.uMoon.value, moonlight(t));
    nearVec(u.uCam.value.toArray(), cameraAt(shotAt(t), t).pos, 1e-9, `uCam at ${t}`);
    assert.deepStrictEqual(statics(), before, `a static uniform changed at ${t}`);
    // the headlight uniforms follow world.js: the lenses where fx/lights.js puts the spots, on while the lights burn
    const c = carAt(t);
    assert.equal(u.uHeadOn.value, c.present ? headlights(t) : 0, `uHeadOn at ${t}`);
  }
  at(25);
  for (const [k, light] of [['uHead0', 'light-headlight-left'], ['uHead1', 'light-headlight-right']]) {
    const L = sceneLight(light);
    nearVec(u[k].value.toArray(), L.getWorldPosition(new THREE.Vector3()).toArray(), 1e-9, `${k} sits at ${light}`);
    const aim = L.target.getWorldPosition(new THREE.Vector3()).sub(L.getWorldPosition(new THREE.Vector3())).normalize();
    nearVec(u.uHeadDir.value.toArray(), aim.toArray(), 1e-9, `uHeadDir points where ${light} points`);
  }
  assert.equal(u.uHeadOn.value, 1);
  at(60); assert.equal(u.uMoon.value, 0);
  at(80); assert.equal(u.uMoon.value, 1);
  assert.deepEqual(u.uBox.value.toArray(), [40, 18, 40]);
  assert.deepEqual(u.uLamp.value.toArray(), LAMP.head);
  assert.equal(u.uLampReach.value, LAMP.poolRadius);
  assert.equal(u.uLampReach.value, 7);
  assert.equal(u.uFogDensity.value, 0.012);
  assert.deepEqual(u.uFogColor.value.toArray(), new THREE.Color(CONFIG.fog.color).toArray());
  assert.deepEqual(u.uLampColor.value.toArray(), new THREE.Color(CONFIG.lights.lamp.color).toArray());
  assert.deepEqual(u.uMoonColor.value.toArray(), new THREE.Color(CONFIG.lights.moon.color).toArray());
  near(u.uDrift.value, 0.6, 1e-12, 'drift amplitude');
  // wind from 70 degrees blows toward 250: west-south-west, mostly -X with some +Z
  const w = u.uWind.value, ws = w.length();
  assert.ok(ws > 0.1 && ws < 1, `wind speed ${ws}`);
  near(w.x / ws, Math.sin((WIND.fromDeg + 180) * D2R), 1e-12, 'wind x');
  near(w.y / ws, -Math.cos((WIND.fromDeg + 180) * D2R), 1e-12, 'wind z');
  assert.ok(w.x < 0 && w.y > 0 && Math.abs(w.x) > Math.abs(w.y));
  // orientation does not matter, only where the camera is; no camera means the origin
  const turned = camera.clone();
  turned.lookAt(0, 100, 0);
  turned.updateMatrixWorld(true);
  parts[1].update(80, turned);
  nearVec(u.uCam.value.toArray(), camera.position.toArray(), 1e-12, 'uCam ignores orientation');
  parts[1].update(80);
  assert.deepEqual(u.uCam.value.toArray(), [0, 0, 0]);
});

// ---------------- order independence (both modules together)

await check('scrambled order equals ascending order for every light, target, matrix and snow uniform', () => {
  const { bad, ref } = orderMismatches({});
  assert.deepEqual(bad, [], 'state depends on call order');
  // a third, fresh build walked backwards agrees too
  const c = make();
  for (const t of [...ASC].reverse()) { c.at(t); assert.deepStrictEqual(snapshot(c.scene), ref.get(t), `reverse order differs at ${t}`); }
  if (OUT) {
    mkdirSync(OUT, { recursive: true });
    const pick = [10, 20, 36.4, 60, 79, 80.6, 85, 100].map((t) => {
      c.at(t);
      return { t, state: snapshot(c.scene).map(({ mw, ...r }) => r) };
    });
    writeFileSync(join(OUT, 'snapshots.json'), JSON.stringify({ times: ASC.length, pick }, null, 1));
  }
});

await check('control: the order check catches a planted stateful light and a planted stateful snow clock', () => {
  const some = ASC.filter((_, i) => i % 9 === 0);
  // a smoothing bug: moon intensity blended with whatever the previous call left
  const smoothedLights = (ctx) => {
    const real = buildLights(ctx);
    let prev = 0;
    return { update(t, cam) { real.update(t, cam); const m = ctx.scene.getObjectByName('light-moon'); const now = m.intensity; m.intensity = 0.5 * (now + prev); prev = now; } };
  };
  assert.ok(orderMismatches({ lights: smoothedLights }, some).bad.length > 0, 'stateful light not caught');
  // an accumulating clock: uTime advances by one frame per call
  const tickingSnow = (ctx) => {
    const real = buildSnow(ctx);
    let ticks = 0;
    return { update(t, cam) { real.update(t, cam); ctx.scene.getObjectByName('snow').material.uniforms.uTime.value = ticks++ / 24; } };
  };
  assert.ok(orderMismatches({ snow: tickingSnow }, some).bad.length > 0, 'stateful snow not caught');
});

// ---------------- shader sanity, static (the GPU check further down compiles and draws it)

// three.js declares these for every ShaderMaterial; declaring them again is a compile error
const PREFIX_NAMES = ['position', 'normal', 'uv', 'modelMatrix', 'modelViewMatrix', 'projectionMatrix', 'viewMatrix', 'normalMatrix', 'cameraPosition', 'isOrthographic'];
const PREFIX_FUNCS = ['linearToOutputTexel']; // fragment prefix of a non-raw ShaderMaterial
const GLSL_JS = { float: (v) => typeof v === 'number', vec2: (v) => v?.isVector2, vec3: (v) => v?.isVector3 || v?.isColor, vec4: (v) => v?.isVector4, mat4: (v) => v?.isMatrix4 };
const ITEM = { float: 1, vec2: 2, vec3: 3, vec4: 4 };

function glslProblems(vertIn, fragIn, material, geometry) {
  const problems = [];
  const resolve = (src, label) => src.replace(/^[ \t]*#include +<([\w.]+)>/gm, (_, name) => {
    if (!(name in THREE.ShaderChunk)) problems.push(`${label}: unknown include <${name}>`);
    return THREE.ShaderChunk[name] ?? '';
  });
  const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const vert = strip(resolve(vertIn, 'vertex')), frag = strip(resolve(fragIn, 'fragment'));
  const decls = (src, qual) => [...src.matchAll(new RegExp(`(?:^|;|\\n)\\s*${qual}\\s+(?:(?:lowp|mediump|highp)\\s+)?(\\w+)\\s+(\\w+)\\s*;`, 'g'))].map((m) => ({ type: m[1], name: m[2] }));
  for (const [label, src] of [['vertex', vert], ['fragment', frag]]) {
    const stack = [];
    const pairs = { ')': '(', '}': '{', ']': '[' };
    for (const ch of src) {
      if ('({['.includes(ch)) stack.push(ch);
      else if (ch in pairs && stack.pop() !== pairs[ch]) { problems.push(`${label}: unbalanced ${ch}`); break; }
    }
    if (stack.length) problems.push(`${label}: unclosed ${stack.join('')}`);
    const mains = src.match(/\bvoid\s+main\s*\(\s*(void)?\s*\)\s*\{/g) ?? [];
    if (mains.length !== 1) problems.push(`${label}: ${mains.length} main functions`);
    // one statement per line in these shaders: anything that is not a brace, a directive or a declaration list must end in ;
    src.split('\n').map((l) => l.trim()).forEach((l, i) => {
      if (l && !l.startsWith('#') && !/[;{}]$/.test(l)) problems.push(`${label} line ${i + 1}: no semicolon: ${l}`);
    });
    for (const q of ['uniform', 'attribute', 'varying']) {
      for (const d of decls(src, q)) {
        if (PREFIX_NAMES.includes(d.name)) problems.push(`${label}: redeclares three.js built-in ${q} ${d.name}`);
      }
    }
    // every u*, a*, v* name used is declared in this stage
    const declared = new Set(['uniform', 'attribute', 'varying'].flatMap((q) => decls(src, q).map((d) => d.name)));
    for (const m of src.matchAll(/\b([uav][A-Z]\w*)\b/g)) if (!declared.has(m[1])) problems.push(`${label}: ${m[1]} used but not declared`);
    for (const d of decls(src, 'uniform')) {
      if (!(src.match(new RegExp(`\\b${d.name}\\b`, 'g')).length > 1)) problems.push(`${label}: uniform ${d.name} declared but never used`);
      const u = material.uniforms[d.name];
      if (!u) problems.push(`${label}: uniform ${d.name} has no value in material.uniforms`);
      else if (!GLSL_JS[d.type]?.(u.value)) problems.push(`${label}: uniform ${d.type} ${d.name} has a mismatched value`);
    }
  }
  if (decls(frag, 'attribute').length) problems.push('fragment: declares an attribute');
  const vv = decls(vert, 'varying').map((d) => `${d.type} ${d.name}`).sort();
  const fv = decls(frag, 'varying').map((d) => `${d.type} ${d.name}`).sort();
  if (JSON.stringify(vv) !== JSON.stringify(fv)) problems.push(`varyings differ: vertex [${vv}] fragment [${fv}]`);
  for (const v of decls(vert, 'varying')) if (!new RegExp(`\\b${v.name}\\s*=`).test(vert)) problems.push(`vertex: varying ${v.name} never written`);
  const allUniforms = new Set([...decls(vert, 'uniform'), ...decls(frag, 'uniform')].map((d) => d.name));
  for (const k of Object.keys(material.uniforms)) if (!allUniforms.has(k)) problems.push(`material.uniforms.${k} is not declared in either shader`);
  for (const a of decls(vert, 'attribute')) {
    const g = geometry.attributes[a.name];
    if (!g) problems.push(`vertex: attribute ${a.name} missing from the geometry`);
    else if (g.itemSize !== ITEM[a.type]) problems.push(`vertex: attribute ${a.type} ${a.name} has item size ${g.itemSize}`);
  }
  for (const k of Object.keys(geometry.attributes)) {
    if (k !== 'position' && !decls(vert, 'attribute').some((a) => a.name === k)) problems.push(`geometry attribute ${k} is not declared`);
  }
  if (!/\bposition\b/.test(vert)) problems.push('vertex: never reads position');
  if (!/\bgl_Position\s*=/.test(vert)) problems.push('vertex: never writes gl_Position');
  if (!/\bgl_PointSize\s*=/.test(vert)) problems.push('vertex: never writes gl_PointSize');
  if (!/\bgl_FragColor\s*=/.test(frag)) problems.push('fragment: never writes gl_FragColor');
  for (const f of PREFIX_FUNCS) if (frag.includes(f) && material.isRawShaderMaterial) problems.push(`fragment: ${f} needs the ShaderMaterial prefix`);
  return problems;
}

await check('snow shaders pass the static GLSL check', () => {
  const p = make().get('snow');
  const m = p.material;
  assert.deepEqual(glslProblems(m.vertexShader, m.fragmentShader, m, p.geometry), []);
  // the dash rule applies inside GLSL strings too
  assert.ok(!new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`).test(m.vertexShader + m.fragmentShader));
});

await check('control: the GLSL check catches planted errors', () => {
  const p = make().get('snow');
  const m = p.material, V = m.vertexShader, F = m.fragmentShader;
  const caught = (v, f, mat = m, what = '') => assert.ok(glslProblems(v, f, mat, p.geometry).length > 0, `missed: ${what}`);
  caught(V, F.replace(/\}\s*$/, ''), m, 'a missing closing brace');
  caught(V.replace('gl_PointSize = max(aSize, 1.0) + step(depth, uNearSize);', 'gl_PointSize = max(aSize, 1.0 + step(depth, uNearSize)'), F, m, 'an unclosed paren and no semicolon');
  caught(V, F.replace('varying float vFog;', 'varying vec2 vFog;'), m, 'a varying type mismatch');
  caught(V, F.replace('varying float vAlpha;', ''), m, 'a missing varying');
  caught('attribute vec3 position;\n' + V, F, m, 'a redeclared built-in');
  caught(V.replace('p.y -= aSpeed * uTime;', 'p.y -= aSpeed * uTimeX;'), F, m, 'an undeclared uniform');
  caught(V, F.replace('#include <colorspace_fragment>', '#include <no_such_chunk>'), m, 'an unknown include');
  const noVal = { ...m, uniforms: { ...m.uniforms } };
  delete noVal.uniforms.uEdge;
  caught(V, F, noVal, 'a uniform with no value');
  const wrongType = { ...m, uniforms: { ...m.uniforms, uBox: { value: 40 } } };
  caught(V, F, wrongType, 'a vec3 uniform given a number');
});

// ---------------- a JS copy of the snow shader

// Fed only from the material's uniforms, as update(t, camera) left them, and from the geometry's attributes.
// The GPU check below holds it to the real shader flake by flake, so the coverage check can rely on it.
const srgbOETF = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 0.41666) - 0.055); // three.js sRGBTransferOETF
const smoothstep = (a, b, x) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
const glslMod = (a, b) => a - b * Math.floor(a / b);

function mirrorSnow(points, camera, { shade = false } = {}) {
  const u = points.material.uniforms, A = points.geometry.attributes, n = A.aSpeed.count;
  const T = u.uTime.value, box = u.uBox.value.toArray(), cam = u.uCam.value.toArray(), lamp = u.uLamp.value.toArray();
  const wind = u.uWind.value, rate = u.uDriftRate.value, drift = u.uDrift.value, edge = u.uEdge.value;
  const base = A.position.array, speed = A.aSpeed.array, phase = A.aPhase.array, size = A.aSize.array;
  const fogOut = u.uFogColor.value.toArray().map(srgbOETF);
  const bc = u.uBaseColor.value.toArray(), lc = u.uLampColor.value.toArray(), mc = u.uMoonColor.value.toArray(), hc = u.uHeadColor.value.toArray();
  const heads = [u.uHead0.value.toArray(), u.uHead1.value.toArray()], hd = u.uHeadDir.value.toArray();
  const beam = (p, o) => {
    const d = [p[0] - o[0], p[1] - o[1], p[2] - o[2]], r = Math.hypot(...d);
    const c = smoothstep(u.uHeadCos.value.x, u.uHeadCos.value.y, (d[0] * hd[0] + d[1] * hd[1] + d[2] * hd[2]) / Math.max(r, 1e-4));
    const f = 1 - Math.min(1, Math.max(0, r / u.uHeadReach.value));
    return c * f * f;
  };
  const v = new THREE.Vector4();
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = [
      base[i * 3] * box[0] + drift * Math.sin(T * rate.x + phase[i]) + wind.x * T,
      base[i * 3 + 1] * box[1] - speed[i] * T,
      base[i * 3 + 2] * box[2] + drift * Math.sin(T * rate.y + phase[i] * 1.7) + wind.y * T,
    ];
    let q = 0;
    for (let k = 0; k < 3; k++) {
      const lo = cam[k] - box[k] / 2;
      p[k] = lo + glslMod(p[k] - lo, box[k]);
      q = Math.max(q, Math.abs(p[k] - cam[k]) / (box[k] / 2));
    }
    const alpha = 1 - smoothstep(edge, 1, q);
    v.set(p[0], p[1], p[2], 1).applyMatrix4(camera.matrixWorldInverse);
    const depth = -v.z;
    v.applyMatrix4(camera.projectionMatrix);
    const inClip = v.w > 0 && Math.abs(v.z / v.w) <= 1; // GL drops a point whose centre is outside the depth range
    const f = { i, p, q, alpha, depth, inClip, ndc: inClip ? [v.x / v.w, v.y / v.w] : null, size: Math.max(size[i], 1) + (u.uNearSize.value >= depth ? 1 : 0) }; // GLSL step(depth, uNearSize)
    if (shade) {
      const dl = [p[0] - lamp[0], p[1] - lamp[1], p[2] - lamp[2]], dlen = Math.hypot(...dl);
      const lw = 1 - Math.min(1, Math.max(0, dlen / u.uLampReach.value));
      const lcone = 0.3 + 0.7 * smoothstep(u.uLampCone.value.x, u.uLampCone.value.y, -dl[1] / Math.max(dlen, 1e-4));
      const hw = u.uHeadOn.value * (beam(p, heads[0]) + beam(p, heads[1]));
      const fog = 1 - Math.exp(-(u.uFogDensity.value ** 2) * depth * depth);
      // 8-bit output over a black frame, with any term switched off
      const colour = (o = {}) => [0, 1, 2].map((k) => {
        const lin = bc[k] * u.uBase.value + (o.lamp === 0 ? 0 : lc[k] * u.uLampGain.value * lw * lw * lcone) + (o.moon === 0 ? 0 : mc[k] * u.uMoonGain.value * u.uMoon.value) + (o.head === 0 ? 0 : hc[k] * u.uHeadGain.value * hw);
        const fg = o.fog === 0 ? 0 : fog;
        return Math.min(1, srgbOETF(lin) * (1 - fg) + fogOut[k] * fg) * (o.alpha ?? alpha) * 255;
      });
      f.rgb = colour();
      const differs = (o) => colour(o).some((c, k) => Math.abs(c - f.rgb[k]) >= 4);
      // which terms visibly change this flake, so each term can be scored on the flakes it actually reaches
      f.tags = { lamp: differs({ lamp: 0 }), moon: differs({ moon: 0 }), head: differs({ head: 0 }), fog: differs({ fog: 0 }), fade: differs({ alpha: 1 }), big: f.size >= 2, near: depth < u.uNearSize.value };
    }
    out.push(f);
  }
  return out;
}

await check('the JS copy of the snow shader puts near, middle and far flakes in frame in every shot', () => {
  const { get, at, camera } = make();
  const p = get('snow');
  const report = [];
  for (const shot of SHOTS) {
    const bands = { near: 0, middle: 0, far: 0 };
    let frames = 0;
    for (let f = Math.ceil(shot.start * FPS); f < shot.end * FPS; f += 4) {
      frames++;
      at(f / FPS);
      for (const fl of mirrorSnow(p, camera)) {
        assert.ok(fl.q <= 1 + 1e-9, 'a flake escaped the box');
        if (fl.alpha < 0.5 || !fl.inClip || Math.abs(fl.ndc[0]) > 1 || Math.abs(fl.ndc[1]) > 1) continue; // faded or out of frame
        bands[fl.depth < 5 ? 'near' : fl.depth < 12 ? 'middle' : 'far']++;
      }
    }
    const perFrame = Object.fromEntries(Object.entries(bands).map(([k, n]) => [k, +(n / frames).toFixed(1)]));
    report.push({ shot: shot.n, lens: shot.lens, frames, perFrame });
    for (const [k, n] of Object.entries(bands)) assert.ok(n > 0, `shot ${shot.n} has no ${k} flakes`);
  }
  if (OUT) { mkdirSync(OUT, { recursive: true }); writeFileSync(join(OUT, 'snow-coverage.json'), JSON.stringify(report, null, 1)); }
  console.log('   flakes in frame per frame (near < 5 m, middle < 12 m, far):');
  for (const r of report) console.log(`   shot ${String(r.shot).padStart(2)} ${String(r.lens).padStart(2)}mm  near ${r.perFrame.near}  middle ${r.perFrame.middle}  far ${r.perFrame.far}`);
});

// ---------------- the snow shader on a GPU: headless Chromium, software WebGL, the snow alone over black

// Lamp-lit flakes (4, 50, 106, 111), headlit ones (20.5, 25, 28, 35.8, 36), moonlit ones (93 on), fogged distant ones, and
// up to 39 m of wind travel, so the camera-centred wrap is exercised. A flake is scored only when nothing else is drawn
// within 2 px, and near flakes are the biggest, so the long-lens shots (10, 12, 14), with few flakes on screen, are
// where most of them can be scored.
const GPU = { times: [4, 10, 20.5, 25, 28, 35.8, 36, 50, 66, 70, 74, 86, 93, 97, 99, 106, 111], snap: 0.07, tol: 2, min: 20 };
const TAGS = ['all', 'lamp', 'moon', 'head', 'fog', 'fade', 'big', 'near'];
const HARNESS = `<!doctype html><html><body style="margin:0;background:#000">
<canvas id="c" width="${W}" height="${H}"></canvas>
<script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js"}}</script>
<script type="module">
import * as THREE from 'three';
import { CONFIG } from '/src/config.js';
import { mulberry32, hashString } from '/src/prng.js';
import { applyShotCamera } from '/src/timeline.js';
import { shotAt } from '/src/shots.js';
import { buildSnow } from '/src/fx/snow.js';
const W = ${W}, H = ${H};
const errors = [];
const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('c'), antialias: false });
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0x000000, 1);
renderer.debug.onShaderError = (gl, program, vs, fs) => errors.push([gl.getProgramInfoLog(program), gl.getShaderInfoLog(vs), gl.getShaderInfoLog(fs)].join(' '));
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(CONFIG.fog.color, CONFIG.fog.density);
const camera = new THREE.PerspectiveCamera(37.8, W / H, 0.05, 3000);
const snow = buildSnow({ THREE, scene, config: CONFIG, rngFor: (n) => mulberry32((CONFIG.seed ^ hashString(n)) >>> 0) });
const mat = scene.getObjectByName('snow').material;
const original = mat.vertexShader;
const gl = renderer.getContext();
const px = new Uint8Array(W * H * 4);
window.frame = (t, vert) => {
  const v = vert ?? original;
  if (mat.vertexShader !== v) { mat.vertexShader = v; mat.needsUpdate = true; }
  applyShotCamera(camera, shotAt(t), t, W / H);
  snow.update(t, camera);
  renderer.render(scene, camera);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
  let s = '';
  for (let i = 0; i < px.length; i += 0x8000) s += String.fromCharCode.apply(null, px.subarray(i, i + 0x8000));
  return btoa(s);
};
window.errors = () => errors;
window.ready = true;
</script></body></html>`;

async function openSnowPage() {
  const browser = await chromium.launch({ executablePath: chromiumPath(), headless: true, args: [...GL_ARGS, '--no-proxy-server'] });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const logs = [];
  page.on('pageerror', (e) => logs.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()); });
  // project files are served read-only from disk under a made-up host: no server, no build, nothing written
  const TYPES = { '.js': 'text/javascript', '.html': 'text/html' };
  await page.route('http://snow.test/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/') return route.fulfill({ body: HARNESS, contentType: 'text/html' });
    if (!(path.startsWith('/src/') || path.startsWith('/node_modules/three/'))) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ body: readFileSync(join(ROOT, path)), contentType: TYPES[extname(path)] ?? 'application/octet-stream' });
  });
  await page.goto('http://snow.test/');
  await page.waitForFunction(() => window.ready === true, null, { timeout: 120000 });
  return {
    frame: async (t, vert) => Buffer.from(await page.evaluate(([tt, vv]) => window.frame(tt, vv), [t, vert]), 'base64'),
    problems: async () => [...(await page.evaluate(() => window.errors())), ...logs],
    close: () => browser.close(),
  };
}

// Pixels (x, y), bottom row 0, whose centres fall inside a point sprite `size` pixels wide centred at (cx, cy).
function coverage(cx, cy, size) {
  const h = size / 2, cells = [];
  for (let y = Math.floor(cy - h); y <= Math.ceil(cy + h); y++) {
    for (let x = Math.floor(cx - h); x <= Math.ceil(cx + h); x++) {
      if (x + 0.5 >= cx - h && x + 0.5 < cx + h && y + 0.5 >= cy - h && y + 0.5 < cy + h) cells.push(y * W + x);
    }
  }
  return cells.sort((a, b) => a - b);
}

// Score one GPU frame against the copy. A flake counts when nothing else is drawn within 2 pixels of it: it passes if
// the lit pixels are exactly its sprite and every one is the predicted colour. GPUs snap point centres to a subpixel
// grid (SwiftShader floors them to 1/32 pixel or coarser), so a sprite may sit up to `snap` pixels off in x and y.
function scoreFrame(rgba, flakes) {
  const lit = (k) => rgba[k * 4] > 2 || rgba[k * 4 + 1] > 2 || rgba[k * 4 + 2] > 2;
  const owner = new Int32Array(W * H).fill(-1); // flake index within 2 px, or -2 where two flakes are that close
  const explained = new Uint8Array(W * H); // within 1 px of a predicted sprite
  const cov = flakes.map((f) => coverage(((f.ndc[0] + 1) / 2) * W, ((f.ndc[1] + 1) / 2) * H, f.size));
  cov.forEach((cells, j) => {
    for (const c of cells) {
      const cx = c % W, cy = (c - cx) / W;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const X = cx + dx, Y = cy + dy;
          if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
          const k = Y * W + X;
          owner[k] = owner[k] === -1 || owner[k] === j ? j : -2;
          if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) explained[k] = 1;
        }
      }
    }
  });
  const stats = Object.fromEntries(TAGS.map((k) => [k, { n: 0, ok: 0 }]));
  let worst = 0;
  flakes.forEach((f, j) => {
    const wx = ((f.ndc[0] + 1) / 2) * W, wy = ((f.ndc[1] + 1) / 2) * H, r = f.size / 2 + 2;
    if (f.alpha < 0.05 || wx < r || wy < r || wx > W - r || wy > H - r) return;
    const win = [];
    for (let y = Math.floor(wy - r); y <= Math.ceil(wy + r); y++) for (let x = Math.floor(wx - r); x <= Math.ceil(wx + r); x++) win.push(y * W + x);
    if (win.some((k) => owner[k] !== j && owner[k] !== -1)) return;
    const litCells = win.filter(lit).sort((a, b) => a - b);
    const want = litCells.join();
    let placed = false;
    for (const dx of [-GPU.snap, 0, GPU.snap]) for (const dy of [-GPU.snap, 0, GPU.snap]) if (coverage(wx + dx, wy + dy, f.size).join() === want) placed = true;
    let shaded = litCells.length > 0;
    for (const k of litCells) {
      for (let c = 0; c < 3; c++) {
        const e = Math.abs(rgba[k * 4 + c] - f.rgb[c]);
        if (placed) worst = Math.max(worst, e);
        if (e > GPU.tol) shaded = false;
      }
    }
    for (const tag of TAGS) {
      if (tag === 'near' || (tag !== 'all' && !f.tags[tag])) continue;
      stats[tag].n++;
      if (placed && shaded) stats[tag].ok++;
    }
  });
  // The near layer, scored on its own: near flakes are the biggest sprites, so the isolation rule above almost never
  // admits one. Instead look only at the ring of pixels the extra size adds, keep the ring pixels no other predicted
  // flake covers, and ask whether the GPU lit them. Without the near layer they stay dark.
  const cover = new Uint16Array(W * H);
  cov.forEach((cells, j) => { if (flakes[j].alpha >= 0.05 && Math.max(...flakes[j].rgb) > 2) for (const c of cells) cover[c]++; });
  flakes.forEach((f, j) => {
    if (!f.tags.near || f.alpha < 0.5 || Math.max(...f.rgb) < 8) return; // bright enough that every pixel of it is lit
    const wx = ((f.ndc[0] + 1) / 2) * W, wy = ((f.ndc[1] + 1) / 2) * H;
    if (wx < 3 || wy < 3 || wx > W - 3 || wy > H - 3) return;
    // the sprite may sit up to `snap` px off (see above), so the ring is tried at each of those offsets
    const ringAt = (x, y) => { const small = new Set(coverage(x, y, f.size - 1)); return coverage(x, y, f.size).filter((c) => !small.has(c) && cover[c] <= 1); };
    if (!ringAt(wx, wy).filter((c) => cover[c] === 1).length) return;
    stats.near.n++;
    let ok = false;
    for (const dx of [-GPU.snap, 0, GPU.snap]) for (const dy of [-GPU.snap, 0, GPU.snap]) {
      const ring = ringAt(wx + dx, wy + dy);
      if (ring.length && ring.filter(lit).length * 2 >= ring.length) ok = true;
    }
    if (ok) stats.near.ok++;
  });
  let litN = 0, unexplained = 0;
  for (let k = 0; k < W * H; k++) if (lit(k)) { litN++; if (!explained[k]) unexplained++; }
  return { stats, litN, unexplained, worst };
}

// Every GPU.times frame drawn with `vert` (the real vertex shader when undefined), scored and summed.
async function gpuRun(snowPage, vert) {
  const { get, at, camera } = make();
  const points = get('snow');
  const total = { stats: Object.fromEntries(TAGS.map((k) => [k, { n: 0, ok: 0 }])), litN: 0, unexplained: 0, worst: 0, frames: [] };
  for (const t of GPU.times) {
    const rgba = await snowPage.frame(t, vert);
    at(t);
    const r = scoreFrame(rgba, mirrorSnow(points, camera, { shade: true }).filter((f) => f.inClip));
    for (const k of TAGS) { total.stats[k].n += r.stats[k].n; total.stats[k].ok += r.stats[k].ok; }
    total.litN += r.litN;
    total.unexplained += r.unexplained;
    total.worst = Math.max(total.worst, r.worst);
    total.frames.push({ t, shot: shotAt(t).n, litPixels: r.litN, checked: r.stats.all.n, matched: r.stats.all.ok });
  }
  total.rate = Object.fromEntries(TAGS.map((k) => [k, total.stats[k].n ? total.stats[k].ok / total.stats[k].n : 0]));
  total.unexplainedShare = total.unexplained / Math.max(1, total.litN);
  return total;
}
const describe = (r) => TAGS.map((k) => `${k} ${r.rate[k].toFixed(3)} of ${r.stats[k].n}`).join(', ') + `; unexplained lit pixels ${(r.unexplainedShare * 100).toFixed(2)}%`;

const snowPage = await openSnowPage();
try {
  const VERT = make().get('snow').material.vertexShader;

  await check('snow on the GPU: the real shader compiles and draws every flake where, and in the colour, the JS copy predicts', async () => {
    const r = await gpuRun(snowPage, undefined);
    assert.deepEqual(await snowPage.problems(), [], 'shader or page errors');
    console.log(`   ${describe(r)}; worst colour error ${r.worst.toFixed(2)} levels`);
    if (OUT) { mkdirSync(OUT, { recursive: true }); writeFileSync(join(OUT, 'snow-gpu.json'), JSON.stringify(r, null, 1)); }
    for (const f of r.frames) assert.ok(f.litPixels > 100 && f.checked > 30, `too little to check at t ${f.t}: ${JSON.stringify(f)}`);
    for (const k of TAGS) {
      // every term reaches enough flakes to be tested, and they all agree
      assert.ok(r.stats[k].n >= GPU.min, `only ${r.stats[k].n} flakes test the ${k} term`);
      assert.ok(r.rate[k] >= 0.98, `${k}: ${r.stats[k].ok} of ${r.stats[k].n} flakes match`);
    }
    assert.ok(r.unexplainedShare <= 0.002, `${r.unexplained} of ${r.litN} lit pixels have no flake predicted near them`);
    assert.ok(r.worst <= GPU.tol, `worst colour error ${r.worst}`);
  });

  await check('control: the GPU check catches each planted shader fault (wrap, wind, drift, fog, lamp, lamp cone, headlights, moon, edge fade, size, near layer)', async () => {
    const PLANTED = {
      'wrap not centred on the camera': ['p = lo + mod(p - lo, uBox);', 'p = mod(p, uBox);'],
      'no wind': ['p.xz += uWind * uTime;', 'p.xz += uWind * uTime * 0.0;'],
      'no drift on x': ['p.x += uDrift * sin(uTime * uDriftRate.x + aPhase);', ''],
      'no fog': ['gl_Position = projectionMatrix * mv;', 'vFog = 0.0;\n  gl_Position = projectionMatrix * mv;'],
      'no lamp boost': ['uLampColor * (uLampGain * lamp * lamp * lampCone)', 'uLampColor * (0.0 * lamp * lampCone)'],
      'lamp boost not shaped by its cone': ['float lampCone = 0.3 + 0.7 * smoothstep(uLampCone.x, uLampCone.y, -dl.y / max(dlen, 1e-4));', 'float lampCone = 1.0;'],
      'no headlight boost': ['uHeadColor * (uHeadGain * head)', 'uHeadColor * (0.0 * head)'],
      'no near layer': ['gl_PointSize = max(aSize, 1.0) + step(depth, uNearSize);', 'gl_PointSize = max(aSize, 1.0);'],
      'no moon boost': ['uMoonColor * (uMoonGain * uMoon)', 'uMoonColor * (0.0 * uMoon)'],
      'no edge fade': ['vAlpha = 1.0 - smoothstep(uEdge, 1.0, max(q.x, max(q.y, q.z)));', 'vAlpha = 1.0;'],
      'every flake 1 pixel': ['gl_PointSize = max(aSize, 1.0) + step(depth, uNearSize);', 'gl_PointSize = 1.0;'],
    };
    const lines = [];
    for (const [what, [from, to]] of Object.entries(PLANTED)) {
      assert.ok(VERT.includes(from), `the shader no longer has "${from}"; update this control`);
      const r = await gpuRun(snowPage, VERT.replace(from, to));
      assert.deepEqual(await snowPage.problems(), [], `${what}: the planted shader must still compile, or the check proves nothing`);
      const worstTag = TAGS.reduce((a, k) => (r.rate[k] < r.rate[a] ? k : a), 'all');
      lines.push(`   ${what}: ${worstTag} ${r.rate[worstTag].toFixed(3)}, unexplained ${(r.unexplainedShare * 100).toFixed(1)}%`);
      assert.ok(r.rate[worstTag] < 0.5 || r.unexplainedShare > 0.1, `missed: ${what} (${describe(r)})`);
    }
    console.log(lines.join('\n'));
  });
} finally {
  await snowPage.close();
}

// ---------------- source rules and the contract

await check('contract: each module exports only its builder and reads data only from set.js and world.js (and the people rig)', () => {
  assert.deepEqual(Object.keys(lightsModule), ['buildLights']);
  assert.deepEqual(Object.keys(snowModule), ['buildSnow']);
  for (const rel of ['src/fx/lights.js', 'src/fx/snow.js']) {
    const src = readFileSync(join(ROOT, rel), 'utf8');
    const from = [...src.matchAll(/^import\b[^;]*?\bfrom\s+'([^']+)'/gm)].map((m) => m[1]);
    assert.ok(from.length > 0, `${rel}: no imports found`);
    // lights.js reads A's hands and cigarette tip from the people rig, so the flame and the drawn hands are one answer
    const allowed = rel === 'src/fx/lights.js' ? ['../set.js', '../world.js', '../actors/people.js'] : ['../set.js', '../world.js'];
    for (const f of from) assert.ok(allowed.includes(f), `${rel} imports ${f}`);
  }
});

await check('source rules: no clocks, no Math.random, no timers, no em or en dashes', () => {
  const dashes = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);
  for (const rel of ['src/fx/lights.js', 'src/fx/snow.js', 'tests/lights-snow.test.mjs']) {
    const src = readFileSync(join(ROOT, rel), 'utf8');
    assert.ok(!dashes.test(src), `${rel} has an em or en dash`);
    if (rel.startsWith('src/')) {
      for (const bad of ['Math.random', 'Date.now', 'performance.now', 'new Date(', 'setTimeout', 'setInterval', 'requestAnimationFrame', '.visible =', 'scene.remove', '.remove(']) {
        assert.ok(!src.includes(bad), `${rel} uses ${bad}`);
      }
    }
  }
});

console.log(`all ${passed} checks passed`);
