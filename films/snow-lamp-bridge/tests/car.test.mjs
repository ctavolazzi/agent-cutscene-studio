// Node test for src/actors/car.js. Run from the project root: node tests/car.test.mjs
// Optional: S2_OUT=<dir> writes the per-time snapshots to <dir>/car/ for inspection.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { buildCar } from '../src/actors/car.js';
import { carAt, carTimes, headlights, peopleAt, CAR, T_TOTAL } from '../src/world.js';
import { CONFIG } from '../src/config.js';
import { mulberry32, hashString } from '../src/prng.js';

const D2R = Math.PI / 180;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.S2_OUT ? join(process.env.S2_OUT, 'car') : null;

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`ok ${passed} ${name}`);
}
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: got ${a}, want ${b} (eps ${eps})`);

function make() {
  const scene = new THREE.Scene();
  const ctx = { THREE, scene, config: CONFIG, rngFor: (name) => mulberry32((CONFIG.seed ^ hashString(name)) >>> 0) };
  const car = buildCar(ctx);
  const get = (name) => {
    const o = scene.getObjectByName(name);
    assert.ok(o, `missing object ${name}`);
    return o;
  };
  const at = (t) => { car.update(t, camera); scene.updateMatrixWorld(true); };
  return { scene, car, get, at };
}
const camera = new THREE.PerspectiveCamera(37.8, 16 / 9, 0.05, 3000);
const world = (obj, local = [0, 0, 0]) => new THREE.Vector3(...local).applyMatrix4(obj.matrixWorld);
const headingOf = (v) => ((Math.atan2(v.x, -v.z) / D2R) + 360) % 360;
const forwardOf = (obj) => obj.getWorldDirection(new THREE.Vector3()).negate(); // built facing -Z
// Distance on the ground plane from point p = [x, z] to the segment a-b (Vector3s).
const segDist = (p, a, b) => {
  const ab = [b.x - a.x, b.z - a.z], ap = [p[0] - a.x, p[1] - a.z];
  const u = Math.min(1, Math.max(0, (ap[0] * ab[0] + ap[1] * ab[1]) / (ab[0] ** 2 + ab[1] ** 2)));
  return Math.hypot(ap[0] - u * ab[0], ap[1] - u * ab[1]);
};

// Everything update may touch, in a fixed traversal order.
function snapshot(scene) {
  const out = [];
  scene.traverse((o) => {
    const rec = {
      name: o.name, visible: o.visible,
      p: o.position.toArray(), r: o.rotation.toArray().slice(0, 3), s: o.scale.toArray(),
      mw: Array.from(o.matrixWorld.elements),
    };
    if (o.material) rec.mat = { color: o.material.color.toArray(), opacity: o.material.opacity, visible: o.material.visible };
    if (o.isLight) rec.intensity = o.intensity;
    out.push(rec);
  });
  return out;
}

const tm = (carTimes.turn0 + carTimes.turn1) / 2;
const T0 = carTimes.start; // the car appears, already moving, with its headlights on
const DR = carTimes.doors.driver, PA = carTimes.doors.passenger;
const mid = (a, b) => (a + b) / 2;
const doorTimes = [DR, PA].flatMap((d) => [d.open0, mid(d.open0, d.open1), d.open1, d.close0, mid(d.close0, d.close1), d.close1]);
const TIMES = [
  0, 5, 10, T0 - 0.01, T0, T0 + 0.5, 15, 18.8, 20, carTimes.turn0 - 0.01, carTimes.turn0, carTimes.turn0 + 0.1, tm,
  carTimes.turn1 - 0.1, carTimes.turn1, carTimes.turn1 + 0.01, 22, 26.2, 28.9, 29, 29.2, 29.35, 29.7, 30, 31.5, 33,
  34, 35, 36, 36.2, 36.3, 36.4, 36.6, 36.7, 40, 60, 111.9, ...doorTimes,
];
for (let f = 0; f < 112 * 24; f += 7) TIMES.push(f / 24);

check('build adds one car root, no lights, and update adds or removes nothing', () => {
  const { scene, at } = make();
  assert.equal(scene.children.length, 1);
  assert.equal(scene.children[0].name, 'car');
  let lights = 0, count = 0;
  scene.traverse((o) => { count++; if (o.isLight) lights++; });
  assert.equal(lights, 0, 'the car owns no light sources');
  for (const t of [10, 20, tm, 33, 40]) at(t);
  let after = 0;
  scene.traverse(() => after++);
  assert.equal(after, count);
});

check('hidden at t = 10 and before the start, visible from carTimes.start', () => {
  const { get, at } = make();
  assert.ok(T0 > 10, `the car starts after t 10 (${T0})`);
  for (const t of [0, 10, T0 - 0.01]) { at(t); assert.equal(get('car').visible, false, `t ${t}`); }
  for (const t of [T0, 20, tm, 40, 111.9]) { at(t); assert.equal(get('car').visible, carAt(t).present, `t ${t}`); assert.equal(get('car').visible, true); }
});

check('position and heading equal carAt(t), including mid-turn', () => {
  const { get, at } = make();
  const car = get('car');
  for (const t of [T0, 15, 18.8, carTimes.turn0 + 0.1, tm, carTimes.turn1 - 0.1, 25, 29, 50]) {
    at(t);
    const c = carAt(t);
    assert.equal(car.position.x, c.x, `x at ${t}`);
    assert.equal(car.position.y, 0, `y at ${t}`);
    assert.equal(car.position.z, c.z, `z at ${t}`);
    assert.equal(car.rotation.y, -c.heading * D2R, `rotation.y at ${t}`);
    const f = forwardOf(car);
    near(f.x, Math.sin(c.heading * D2R), 1e-9, `forward x at ${t}`);
    near(f.z, -Math.cos(c.heading * D2R), 1e-9, `forward z at ${t}`);
  }
  at(tm);
  near(carAt(tm).heading, 315, 1e-9, 'mid-turn heading');
  near(headingOf(forwardOf(car)), 315, 1e-9, 'mid-turn world heading');
});

check('front wheels steer right by 30 degrees mid-turn and are straight outside the turn', () => {
  const { get, at } = make();
  at(tm);
  near(get('car-wheel-fl').rotation.y, -30 * D2R, 1e-12, 'fl steer');
  near(get('car-wheel-fr').rotation.y, -30 * D2R, 1e-12, 'fr steer');
  assert.equal(get('car-wheel-rl').rotation.y, 0);
  near(headingOf(forwardOf(get('car-wheel-fr'))), 345, 1e-9, 'front wheel points 30 degrees right of the car');
  let maxDeg = 0;
  for (let t = carTimes.turn0; t <= carTimes.turn1; t += 0.01) { at(t); maxDeg = Math.max(maxDeg, -get('car-wheel-fl').rotation.y / D2R); }
  assert.ok(maxDeg <= 30 + 1e-9, `max steer ${maxDeg}`);
  for (const t of [20, carTimes.turn0 - 0.01, carTimes.turn0, carTimes.turn1, carTimes.turn1 + 0.01, 25, 40]) {
    at(t);
    assert.equal(get('car-wheel-fl').rotation.y, 0, `fl steer at ${t}`);
    assert.equal(get('car-wheel-fr').rotation.y, 0, `fr steer at ${t}`);
  }
});

check('wheels spin more as distance grows, distance / radius, constant once stopped', () => {
  const { get, at } = make();
  const spin = (t) => { at(t); return 0 - get('car-wheel-rl-spin').rotation.x; }; // 0 - x keeps a rest value at +0
  let last = -1;
  for (let t = T0 + 0.25; t < 29; t += 0.25) {
    const s = spin(t);
    assert.ok(s > last, `spin at ${t} (${s}) should exceed ${last}`);
    last = s;
  }
  assert.equal(spin(T0 - 1), 0);
  assert.equal(spin(T0), 0);
  // straight run from the start x to the corner at 5.2 (north lane 2.2 plus radius 3), quarter turn of radius 3,
  // then 14.5 - 1.85 north. The path is the same whatever the start, so only the straight follows carAt(start).
  const c0 = carAt(T0), cTurn = carAt(carTimes.turn0);
  near(cTurn.x, 5.2, 1e-9, 'the corner starts at x 5.2');
  assert.equal(cTurn.z, c0.z, 'the run to the corner is straight, along one lane');
  const straight = c0.x - cTurn.x;
  assert.ok(straight > 30, `the car starts well east of the corner (${straight} m)`);
  // 1 mm: the table interpolates linearly across the braking and the corner
  near(spin(carTimes.turn0) * 0.33, straight, 1e-3, 'distance at turn0');
  const tCruise = 18;
  assert.ok(tCruise > T0 + 1 && tCruise < carTimes.brake, `t ${tCruise} is on the straight, before the braking at ${carTimes.brake}`);
  near(spin(tCruise) * 0.33, c0.speed * (tCruise - T0), 1e-9, 'distance on the straight, before the braking, is exact');
  near(c0.speed, 5.3, 1e-12, 'cruising speed');
  const total = straight + (Math.PI / 2) * 3 + 12.65;
  near(spin(29) * 0.33, total, 1e-3, 'distance at the stop');
  for (const t of [30, 40, 111.9]) near(spin(t), spin(29), 1e-9, `no spin after the stop, t ${t}`);
  for (const tag of ['fl', 'fr', 'rr']) { at(20); assert.equal(get(`car-wheel-${tag}-spin`).rotation.x, get('car-wheel-rl-spin').rotation.x); }
  // Rolling without slipping, heading north: the rim point now at the top moves north at twice the car's speed,
  // the contact point at the bottom stays put. Take the material points under the top and bottom at t, follow them.
  const w = get('car-wheel-rl-spin');
  const dt = 1 / 2400;
  at(25);
  const a = w.rotation.x;
  const top = [0, 0.33 * Math.cos(a), -0.33 * Math.sin(a)], bot = [0, -0.33 * Math.cos(a), 0.33 * Math.sin(a)];
  near(world(w, top).y, 0.66, 1e-9, 'top point is at the top');
  const top0 = world(w, top), bot0 = world(w, bot);
  at(25 + dt);
  const top1 = world(w, top), bot1 = world(w, bot);
  const carStep = carAt(25).z - carAt(25 + dt).z;
  near((top0.z - top1.z) / carStep, 2, 0.01, 'top moves north at twice the car speed');
  near((bot0.z - bot1.z) / carStep, 0, 0.01, 'contact point does not slide');
});

check('doors: driver fully open at 33.0, passenger at 34.0, both closed at 36, swinging outward', () => {
  const { get, at } = make();
  // the schedule this check samples: both doors wide at the times below, both shut again by 36
  assert.ok(DR.open1 <= 33.0 && 33.0 <= DR.close0, `driver fully open at 33.0 (${JSON.stringify(DR)})`);
  assert.ok(PA.open1 <= 34.0 && 34.0 <= PA.close0, `passenger fully open at 34.0 (${JSON.stringify(PA)})`);
  assert.ok(Math.max(DR.close1, PA.close1) <= 36 && Math.min(DR.open0, PA.open0) >= 30.5, 'both closed before 30.5 and from 36');
  at(33.0);
  assert.equal(get('car-door-driver').rotation.y, -70 * D2R);
  at(34.0);
  assert.equal(get('car-door-passenger').rotation.y, 70 * D2R);
  for (const t of [29, 30.5, 36, 40, 111.9]) {
    at(t);
    assert.equal(get('car-door-driver').rotation.y, 0, `driver at ${t}`);
    assert.equal(get('car-door-passenger').rotation.y, 0, `passenger at ${t}`);
  }
  at(DR.open1); assert.equal(get('car-door-driver').rotation.y, -70 * D2R);
  at(PA.open1); assert.equal(get('car-door-passenger').rotation.y, 70 * D2R);
  at(mid(DR.open0, DR.open1)); near(get('car-door-driver').rotation.y, -35 * D2R, 1e-9, `driver half open at ${mid(DR.open0, DR.open1)}`);
  at(mid(PA.open0, PA.open1)); near(get('car-door-passenger').rotation.y, 35 * D2R, 1e-9, `passenger half open at ${mid(PA.open0, PA.open1)}`);
  at(mid(DR.close0, DR.close1)); near(get('car-door-driver').rotation.y, -35 * D2R, 1e-9, `driver half shut at ${mid(DR.close0, DR.close1)}`);
  at(mid(PA.close0, PA.close1)); near(get('car-door-passenger').rotation.y, 35 * D2R, 1e-9, `passenger half shut at ${mid(PA.close0, PA.close1)}`);

  // closed: door centres at z 1.45, sides at x 2.2 -/+ 0.92
  at(36);
  const dc = world(get('car-door-driver-slab')), pc = world(get('car-door-passenger-slab'));
  near(dc.z, 1.45, 1e-9, 'driver door centre z'); near(dc.x, 2.2 - 0.92, 1e-9, 'driver door x');
  near(pc.z, 1.45, 1e-9, 'passenger door centre z'); near(pc.x, 2.2 + 0.92, 1e-9, 'passenger door x');
  near(world(get('car-door-driver')).z, 1.85 - 0.95, 1e-9, 'hinge at the front edge');

  // open: rear edges swing out to the west (driver) and east (passenger), 70 degrees round from due south
  at(33.0);
  const dh = get('car-door-driver'), dRear = world(dh, [0, 0, 1.1]), dFront = world(dh);
  near(dRear.x, dFront.x - 1.1 * Math.sin(70 * D2R), 1e-9, 'driver rear edge out west');
  near(dRear.z, dFront.z + 1.1 * Math.cos(70 * D2R), 1e-9, 'driver rear edge z');
  at(34.0);
  const ph = get('car-door-passenger'), pRear = world(ph, [0, 0, 1.1]), pFront = world(ph);
  near(pRear.x, pFront.x + 1.1 * Math.sin(70 * D2R), 1e-9, 'passenger rear edge out east');
  near(pRear.z, pFront.z + 1.1 * Math.cos(70 * D2R), 1e-9, 'passenger rear edge z');
});

check('door times come from carTimes.doors in world.js, and a bad schedule fails at build', () => {
  const saved = carTimes.doors;
  try {
    carTimes.doors = { driver: { ...saved.driver, open0: 30.9, open1: 31.5 }, passenger: saved.passenger };
    const { get, at } = make();
    at(30.9); assert.equal(get('car-door-driver').rotation.y, 0);
    at(31.2); near(get('car-door-driver').rotation.y, -35 * D2R, 1e-9, 'driver half open at 31.2 on the changed times');
    at(31.5); assert.equal(get('car-door-driver').rotation.y, -70 * D2R);
    at(32.3); near(get('car-door-passenger').rotation.y, 35 * D2R, 1e-9, 'passenger on its own times');
    carTimes.doors = { driver: saved.driver, passenger: { ...saved.passenger, open1: 31.0 } };
    assert.throws(() => make(), /bad passenger door times/);
    carTimes.doors = { driver: saved.driver };
    assert.throws(() => make(), /bad passenger door times/);
  } finally {
    carTimes.doors = saved;
  }
});

// A person is a vertical cylinder of radius BODY_R at peopleAt(t); a door is its slab's ground footprint, the segment
// from the hinge to the rear edge, 6 cm thick. The slab spans y 0.3 to 1.05, inside any standing body, so 2D is enough.
// Negative gap means the slab is inside the body. Treating the slab as a 6 cm wide capsule overstates it by up to
// 3 cm past its square ends, which errs toward reporting a cut.
const BODY_R = 0.25, DOOR_LEN = 1.1, DOOR_HALF = 0.03;
const doorGap = (hinge, x, z) => segDist([x, z], world(hinge), world(hinge, [0, 0, DOOR_LEN])) - DOOR_HALF - BODY_R;
check('door sweep: the gap measure catches a body in the swing and passes one clear of it (planted controls)', () => {
  const { get, at } = make();
  at(29);
  const hinge = { driver: get('car-door-driver'), passenger: get('car-door-passenger') };
  const hd = world(hinge.driver), hp = world(hinge.passenger);
  near(hd.x, 2.2 - 0.92, 1e-9, 'driver hinge x'); near(hp.x, 2.2 + 0.92, 1e-9, 'passenger hinge x');
  near(hd.z, 0.9, 1e-9, 'hinge z');
  // closed doors: a body 0.2 m off the skin is inside, one 0.3 m off is clear
  assert.ok(doorGap(hinge.driver, hd.x - 0.03 - 0.2, 1.45) < 0, 'body against the closed driver door');
  assert.ok(doorGap(hinge.driver, hd.x - 0.03 - 0.3, 1.45) > 0, 'body clear of the closed driver door');
  // a body standing in the door's V is cut while the door swings, and clear only at full open (why an end-pose check misses it)
  at(mid(DR.open0, DR.open1)); assert.ok(doorGap(hinge.driver, 0.8, 1.45) < -0.1, 'half-open driver door cuts (0.8, 1.45)');
  at(DR.open1); assert.ok(doorGap(hinge.driver, 0.8, 1.45) > 0, 'fully open driver door clears (0.8, 1.45)');
  at(mid(PA.open0, PA.open1)); assert.ok(doorGap(hinge.passenger, 3.7, 1.45) < -0.1, 'half-open passenger door cuts (3.7, 1.45)');
  at(PA.open1); assert.ok(doorGap(hinge.passenger, 3.7, 1.45) > 0, 'fully open passenger door clears (3.7, 1.45)');
  // 1.45 m from the hinge, mid-arc, is outside the 1.1 m door plus thickness plus body for the whole swing
  for (const [tag, s, d] of [['driver', -1, DR], ['passenger', 1, PA]]) {
    const t0 = d.open0 - 0.1, t1 = d.close1 + 0.1;
    const h = world(hinge[tag]);
    const x = h.x + s * 1.45 * Math.sin(35 * D2R), z = h.z + 1.45 * Math.cos(35 * D2R);
    let min = Infinity;
    for (let t = t0; t <= t1; t += 1 / 240) { at(t); min = Math.min(min, doorGap(hinge[tag], x, z)); }
    near(min, 1.45 - DOOR_LEN - DOOR_HALF - BODY_R, 1e-3, `${tag} door tip passes 7 cm from a body 1.45 m out`);
  }
});

check('door sweep: no door passes through a person, every 1/240 s of the film', () => {
  const { get, at } = make();
  const hinge = { driver: get('car-door-driver'), passenger: get('car-door-passenger') };
  const hits = new Map();
  let samples = 0;
  for (let f = 0; f <= T_TOTAL * 240; f++) {
    const t = f / 240;
    at(t);
    const ppl = peopleAt(t);
    for (const who of ['A', 'B']) {
      const p = ppl[who];
      if (!p) continue;
      for (const door of ['driver', 'passenger']) {
        samples++;
        const g = doorGap(hinge[door], p.x, p.z);
        if (g >= 0) continue;
        const key = `${who}/${door}`;
        const h = hits.get(key) ?? { who, door, t0: t, t1: t, min: 0, n: 0 };
        h.t1 = t; h.min = Math.min(h.min, g); h.n++;
        hits.set(key, h);
      }
    }
  }
  assert.ok(samples > 2 * 2 * 70 * 240, `the sweep saw the people (${samples} samples)`);
  const fmt = (h) => `${h.who} in the ${h.door} door ${h.t0.toFixed(3)} to ${h.t1.toFixed(3)} s, ${h.n} samples, deepest ${(-h.min).toFixed(3)} m`;
  for (const h of hits.values()) assert.fail(`door through a body: ${fmt(h)}`);
});

check('lenses scale with headlights(t) toward black, 0 after 36.6, never hidden', () => {
  const { get, at } = make();
  const base = new THREE.Color(CONFIG.lights.headlight.color);
  at(20);
  const head = get('car-headlamp-left'), tail = get('car-taillight-right');
  assert.deepEqual(head.material.color.toArray(), base.toArray());
  const tailFull = tail.material.color.toArray();
  assert.ok(tailFull[0] > 0.5 && tailFull[1] < 0.1, 'taillight is red');
  at(36.4);
  const h = headlights(36.4);
  near(h, 0.5, 1e-9, 'headlights half way at 36.4');
  head.material.color.toArray().forEach((v, i) => near(v, base.toArray()[i] * h, 1e-12, 'headlamp half'));
  tail.material.color.toArray().forEach((v, i) => near(v, tailFull[i] * h, 1e-12, 'taillight half'));
  for (const t of [36.6, 36.7, 40, 100, 111.9]) {
    at(t);
    for (const n of ['car-headlamp-left', 'car-headlamp-right', 'car-taillight-left', 'car-taillight-right']) {
      const o = get(n);
      assert.deepEqual(o.material.color.toArray(), [0, 0, 0], `${n} at ${t}`);
      assert.equal(o.visible, true);
      assert.equal(o.material.visible, true);
    }
  }
  // placement: front bumper at z -0.5 when stopped, lenses at +/-0.65 and about 0.7 up
  at(40);
  const hl = world(get('car-headlamp-left')), hr = world(get('car-headlamp-right'));
  near(hl.x, 2.2 - 0.65, 1e-9, 'left headlamp x'); near(hr.x, 2.2 + 0.65, 1e-9, 'right headlamp x');
  near(hl.y, 0.7, 1e-9, 'headlamp height');
  assert.ok(hl.z < -0.5 && hl.z > -0.56, `headlamp just ahead of the bumper, z ${hl.z}`);
  const tl = world(get('car-taillight-left'));
  assert.ok(tl.z > 1.85 + 2.35 && tl.z < 1.85 + 2.41, `taillight at the rear, z ${tl.z}`);
});

check('body: settle dip after the stop, then level; idle shake while the engine runs only', () => {
  const { get, at } = make();
  const body = get('car-body');
  at(28.9); assert.equal(body.rotation.x, 0);
  at(29.0); assert.equal(body.rotation.x, 0);
  at(29.35); near(body.rotation.x, -1.5 * D2R, 1e-12, 'peak pitch');
  const lamp = get('car-headlamp-left');
  const dipY = world(lamp).y;
  at(29.7); near(body.rotation.x, 0, 1e-12, 'level at 29.7 (the end, to float precision)');
  for (const t of [29.71, 30, 33, 40]) { at(t); assert.equal(body.rotation.x, 0, `level at ${t}`); }
  at(30);
  assert.ok(world(lamp).y - dipY > 0.04, 'nose dips (the headlamp drops) at the settle');

  const ys = [];
  for (let f = Math.ceil(T0 * 24); f < carTimes.lightsOff0 * 24; f++) { at(f / 24); ys.push(body.position.y); }
  const maxAbs = Math.max(...ys.map(Math.abs));
  const mean = ys.reduce((a, b) => a + b, 0) / ys.length;
  const sd = Math.sqrt(ys.reduce((a, b) => a + (b - mean) ** 2, 0) / ys.length);
  assert.ok(maxAbs > 0.001 && maxAbs <= 0.005, `shake is a few millimetres (max ${maxAbs})`);
  assert.ok(sd > 0.0005, `shake still moves when sampled at 24 fps (sd ${sd})`);
  for (const t of [0, T0 - 0.01, 36.6, 36.7, 40, 111.9]) { at(t); assert.equal(body.position.y, 0, `still at ${t}`); }
  at(36.4); assert.ok(Math.abs(body.position.y) <= maxAbs, 'fading at 36.4');
});

check('blob shadow: dark transparent ellipse 2.6 by 1.25 just above the ground, no depth write, does not pitch', () => {
  const { get, at } = make();
  const s = get('car-shadow');
  assert.equal(s.material.depthWrite, false);
  assert.equal(s.material.transparent, true, 'transparent, so it draws after the opaque ground whatever its renderOrder');
  assert.equal(s.renderOrder, -1, 'before the snow and smoke (renderOrder 0), so they blend over it');
  assert.ok(s.material.color.r === 0 && s.material.color.g === 0 && s.material.color.b === 0);
  s.geometry.computeBoundingBox();
  const bb = s.geometry.boundingBox;
  near(bb.max.x, 1.25, 1e-6, 'half width'); near(bb.min.x, -1.25, 1e-6, 'half width');
  near(bb.max.z, 2.6, 1e-6, 'half length'); near(bb.min.z, -2.6, 1e-6, 'half length');
  near(bb.max.y - bb.min.y, 0, 1e-9, 'flat');
  const ny = s.geometry.getAttribute('normal').getY(0);
  near(ny, 1, 1e-6, 'faces up');
  for (const t of [20, 29.35, 40]) {
    at(t);
    near(world(s).y, 0.02, 1e-12, `shadow height at ${t}`);
    near(world(s).x, carAt(t).x, 1e-9, 'under the car');
  }
});

check('shapes: body, cabin and wheels at the spec sizes', () => {
  // geometry buffers are Float32, so sizes read from them hold to about 1e-7; 1e-6 throughout
  const { get, at } = make();
  at(40);
  const box = (n) => { const g = get(n).geometry; g.computeBoundingBox(); return g.boundingBox; };
  const shell = box('car-shell');
  near(shell.max.z - shell.min.z, CAR.length, 1e-6, 'body length'); near(shell.max.x - shell.min.x, CAR.width, 1e-6, 'body width');
  near(world(get('car-shell')).y + shell.min.y, 0.25, 1e-6, 'body bottom'); near(world(get('car-shell')).y + shell.max.y, 0.9, 1e-6, 'body top');
  const cab = box('car-cabin');
  near(cab.max.z - cab.min.z, 2.4, 1e-6, 'cabin length'); near(cab.max.x - cab.min.x, 1.6, 1e-6, 'cabin width');
  near(world(get('car-cabin')).y + cab.max.y, CAR.height, 1e-6, 'cabin top is CAR.height');
  near(world(get('car-cabin')).y + cab.min.y, 0.9, 1e-6, 'cabin bottom on the body top');
  near(world(get('car-cabin')).z - 1.85, 0.3, 1e-6, 'cabin shifted 0.3 toward the rear (south when heading north)');
  const tyre = box('car-wheel-fl-tyre');
  near(tyre.max.x - tyre.min.x, 0.22, 1e-6, 'tyre width along the axle');
  near(tyre.max.y, 0.33, 1e-6, 'tyre radius');
  const fl = world(get('car-wheel-fl')), rr = world(get('car-wheel-rr'));
  near(fl.x, 2.2 - 0.82, 1e-6, 'fl side'); near(fl.z, 1.85 - 1.45, 1e-6, 'fl forward'); near(fl.y, 0.33, 1e-6, 'axle height');
  near(rr.x, 2.2 + 0.82, 1e-6, 'rr side'); near(rr.z, 1.85 + 1.45, 1e-6, 'rr back');
  const door = box('car-door-driver-slab');
  near(door.max.z - door.min.z, 1.1, 1e-6, 'door length'); near(door.max.x - door.min.x, 0.06, 1e-6, 'door thickness');
  near(world(get('car-door-driver-slab')).y + door.min.y, 0.3, 1e-6, 'door bottom'); near(door.max.y - door.min.y, 0.75, 1e-6, 'door height');
  const mats = new Set();
  get('car').traverse((o) => { if (o.material) mats.add(o.material); });
  for (const m of mats) assert.ok(m.isMeshLambertMaterial || m.isMeshBasicMaterial, `material type ${m.type}`);
  assert.equal(mats.size, 8, 'eight shared materials');
});

check('scrambled order equals ascending order, and a fresh build agrees', () => {
  const a = make();
  const asc = [...TIMES].sort((x, y) => x - y);
  const ref = new Map();
  for (const t of asc) { a.at(t); ref.set(t, snapshot(a.scene)); }
  const rnd = mulberry32(12345);
  const order = [...asc];
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  assert.notDeepEqual(order, asc);
  for (const t of order) { a.at(t); assert.deepStrictEqual(snapshot(a.scene), ref.get(t), `state at ${t} depends on call order`); }
  const b = make();
  for (const t of [...order].reverse()) { b.at(t); assert.deepStrictEqual(snapshot(b.scene), ref.get(t), `fresh build differs at ${t}`); }
  // camera argument has no effect
  const other = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  other.position.set(9, 9, 9);
  b.car.update(33, other); b.scene.updateMatrixWorld(true);
  assert.deepStrictEqual(snapshot(b.scene), ref.get(33));
  if (OUT) {
    mkdirSync(OUT, { recursive: true });
    const pick = [10, 20, tm, 29.35, 33, 34, 36.4, 40].map((t) => ({ t, state: ref.get(t)?.map(({ mw, ...r }) => r) }));
    writeFileSync(join(OUT, 'snapshots.json'), JSON.stringify({ times: asc.length, pick }, null, 1));
  }
});

check('source rules: no clocks, no Math.random, no timers, no em or en dashes', () => {
  const dashes = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);
  for (const rel of ['src/actors/car.js', 'tests/car.test.mjs']) {
    const src = readFileSync(join(ROOT, rel), 'utf8');
    assert.ok(!dashes.test(src), `${rel} has an em or en dash`);
    if (rel.startsWith('src/')) {
      for (const bad of ['Math.random', 'Date.now', 'performance.now', 'new Date(', 'setTimeout', 'setInterval', 'requestAnimationFrame']) {
        assert.ok(!src.includes(bad), `${rel} uses ${bad}`);
      }
    }
  }
});

console.log(`all ${passed} checks passed`);
