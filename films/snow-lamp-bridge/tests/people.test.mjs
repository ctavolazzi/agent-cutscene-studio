// Node test for src/actors/people.js. Run from the project root: node tests/people.test.mjs
// Optional: S2_OUT=<dir> writes a few per-time snapshots to <dir>/people/ for inspection.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { buildPeople, solveTwoBone, solveArm, wrapDeg, groundY, makePoser, bodyToWorld, EMERGE, EXIT, SILL, LEAN, LEAN_OF } from '../src/actors/people.js';
import { buildCar } from '../src/actors/car.js';
import { peopleAt, PEOPLE, PEOPLE_KEYS, LIGHTER, carAt, carTimes } from '../src/world.js';
import { BRIDGE, STREET, RAIL } from '../src/set.js';
import { CONFIG } from '../src/config.js';
import { mulberry32, hashString } from '../src/prng.js';

const D2R = Math.PI / 180;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.S2_OUT ? join(process.env.S2_OUT, 'people') : null;
const IDS = ['A', 'B'];
const SIDES = ['L', 'R'];

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`ok ${passed} ${name}`);
}
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: got ${a}, want ${b} (eps ${eps})`);
// independent of the module's own wrap
const angDiff = (a, b) => { const d = (((a - b) % 360) + 360) % 360; return Math.min(d, 360 - d); };

const camera = new THREE.PerspectiveCamera(37.8, 16 / 9, 0.05, 3000);
const rngFor = (name) => mulberry32((CONFIG.seed ^ hashString(name)) >>> 0);
function make() {
  const scene = new THREE.Scene();
  const ctx = { THREE, scene, config: CONFIG, rngFor };
  const people = buildPeople(ctx);
  const get = (name) => {
    const o = scene.getObjectByName(name);
    assert.ok(o, `missing object ${name}`);
    return o;
  };
  const at = (t) => { people.update(t, camera); scene.updateMatrixWorld(true); };
  return { scene, people, get, at };
}
const W = make();
const wpos = (name) => new THREE.Vector3().setFromMatrixPosition(W.get(name).matrixWorld);
const headingOf = (v) => ((Math.atan2(v.x, -v.z) / D2R) + 360) % 360;
const forwardOf = (obj) => obj.getWorldDirection(new THREE.Vector3()).negate(); // built facing -Z
// a world point in person id's body frame (forward -Z, right +X, y above their ground)
const toBody = (id, v) => v.clone().applyMatrix4(W.get(`person-${id}`).matrixWorld.clone().invert());
const k = (id) => PEOPLE[id].height / 1.8;
const fwdOf = (h) => new THREE.Vector3(Math.sin(h * D2R), 0, -Math.cos(h * D2R));
const rightOf = (h) => new THREE.Vector3(Math.cos(h * D2R), 0, Math.sin(h * D2R));
// thigh angle in the body's sagittal plane, degrees, forward positive
function thighDeg(id, side) {
  const h = toBody(id, wpos(`person-${id}-thigh-${side}`)), kn = toBody(id, wpos(`person-${id}-shin-${side}`));
  return Math.atan2(-(kn.z - h.z), -(kn.y - h.y)) / D2R;
}
const shinDeg = (id, side) => {
  const kn = toBody(id, wpos(`person-${id}-shin-${side}`)), an = toBody(id, wpos(`person-${id}-foot-${side}`));
  return Math.atan2(-(an.z - kn.z), -(an.y - kn.y)) / D2R;
};
// how far the lower arm hangs forward of straight down, body frame, degrees
const armSwingDeg = (id, side) => {
  const s = toBody(id, wpos(`person-${id}-upperarm-${side}`)), h = toBody(id, wpos(`person-${id}-hand-${side}`));
  return Math.atan2(-(h.z - s.z), -(h.y - s.y)) / D2R;
};

// The staging, read from the keys so the checks follow the data.
const KEYS = PEOPLE_KEYS;
const keyTimes = [...new Set(IDS.flatMap((id) => KEYS[id].map((key) => key.t)))];
// the last spot each stands on before the walk to the bridge (the reveal in shot 6)
const lastStand = (id) => KEYS[id].filter((key) => key.pose === 'stand').at(-1);
// Getting out of the car: the first key is seated ('emerge'), then 'exit' (the outboard foot lands), then the key
// after it is standing. The driver sits on the left (-X), so A (outboard left) uses the driver's door.
const exitIndex = (id) => KEYS[id].findIndex((key) => key.pose === 'exit');
const exitKey = (id) => KEYS[id][exitIndex(id)];
const risenKey = (id) => KEYS[id][exitIndex(id) + 1];
const doorOf = (id) => carTimes.doors[EXIT.outSide[id] < 0 ? 'driver' : 'passenger'];
const sideTag = (s) => (s < 0 ? 'L' : 'R');
// Holds where a person stands still on one spot (consecutive 'stand' keys at the same place), as [t0, t1].
const stillHolds = (id) => KEYS[id].slice(0, -1).flatMap((a, i) => {
  const b = KEYS[id][i + 1];
  return a.pose === 'stand' && b.pose === 'stand' && a.x === b.x && a.z === b.z ? [[a.t, b.t]] : [];
});
// A held pose: the first and the last key with that pose, as [t0, t1].
const holdOf = (id, pose) => { const ks = KEYS[id].filter((key) => key.pose === pose); return [ks[0].t, ks[ks.length - 1].t]; };
// A glance: two consecutive lean or smoke keys holding the same look away from the face, as [t0, t1, key].
const glanceOf = (id) => {
  const ks = KEYS[id];
  for (let i = 0; i + 1 < ks.length; i++) {
    const a = ks[i], b = ks[i + 1];
    if ((a.pose === 'lean' || a.pose === 'smoke') && a.look === b.look && angDiff(a.look, a.face) > 30) return [a.t, b.t, a];
  }
  return null;
};
// Walking stretches: runs of key segments that peopleAt calls a walk and that cover ground, as [t0, t1].
function walkStretches(id) {
  const out = [];
  KEYS[id].slice(0, -1).forEach((a, i) => {
    const b = KEYS[id][i + 1];
    if (peopleAt((a.t + b.t) / 2)[id].pose !== 'walk' || Math.hypot(b.x - a.x, b.z - a.z) <= 0.01) return;
    if (out.length && out[out.length - 1][1] === a.t) out[out.length - 1][1] = b.t;
    else out.push([a.t, b.t]);
  });
  return out;
}
// Key segments that are a walk by pose but cover no ground (a turn on the spot at the rail): standing still.
const stillWalks = (id) => KEYS[id].slice(0, -1).flatMap((a, i) => {
  const b = KEYS[id][i + 1];
  return a.pose === 'walk' && a.x === b.x && a.z === b.z ? [[a.t, b.t]] : [];
});

// The car on its own, for the body the two sit inside before they get out: its shell and cabin as world boxes.
const C = (() => {
  const scene = new THREE.Scene();
  const car = buildCar({ THREE, scene, config: CONFIG, rngFor });
  return (t) => {
    car.update(t, camera);
    scene.updateMatrixWorld(true);
    const [shell, cabin] = ['car-shell', 'car-cabin'].map((n) => new THREE.Box3().setFromObject(scene.getObjectByName(n)));
    return { shell, cabin };
  };
})();
// every vertex of every mesh of a person but the blob shadow, world, as drawn at the last W.at
function bodyPoints(id) {
  const pts = [];
  W.get(`person-${id}`).traverse((o) => {
    if (!o.isMesh || o.name.endsWith('-shadow')) return;
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) pts.push({ name: o.name, p: new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld) });
  });
  return pts;
}
// how far the furthest of the points is outside the car's body (shell and cabin), 0 when all are inside
function outsideCar(pts, car) {
  let worst = [0, ''];
  for (const { name, p } of pts) {
    const d = Math.min(car.shell.distanceToPoint(p), car.cabin.distanceToPoint(p));
    if (d > worst[0]) worst = [d, `${name} at ${p.toArray().map((v) => v.toFixed(3))}`];
  }
  return worst;
}
const inFootprint = (p, shell) => p.x > shell.min.x && p.x < shell.max.x && p.z > shell.min.z && p.z < shell.max.z;
// the four corners of a shoe's sole, world (shoes only yaw with the body, so the sole is their lowest face)
function soleCorners(id, side) {
  const shoe = W.get(`person-${id}-shoe-${side}`), { width, height, depth } = shoe.geometry.parameters;
  return [-1, 1].flatMap((a) => [-1, 1].map((b) => new THREE.Vector3((a * width) / 2, -height / 2, (b * depth) / 2).applyMatrix4(shoe.matrixWorld)));
}
// how far the lowest point inside the car's footprint is below the car's underside, 0 when none is
const underCar = (pts, shell) => Math.max(0, ...pts.filter((p) => inFootprint(p, shell)).map((p) => shell.min.y - p.y));

// Everything update may touch, in a fixed traversal order.
function snapshot(scene) {
  const out = [];
  scene.traverse((o) => {
    out.push({
      name: o.name, visible: o.visible,
      p: o.position.toArray(), r: o.rotation.toArray().slice(0, 3), q: o.quaternion.toArray(), s: o.scale.toArray(),
      mw: Array.from(o.matrixWorld.elements),
      mat: o.material ? { color: o.material.color.toArray(), opacity: o.material.opacity, visible: o.material.visible } : null,
    });
  });
  return out;
}

const TIMES = [0, 20, 31.09, 31.1, 31.5, 32.4, 32.6, 33, 33.6, 33.8, 34.6, 35, 35.6, 37.3, 37.4, 37.8, 39.9, 40.0, 40.6, 41.6, 44.5, 50, 50.25,
  54, 56.3, 58, 58.15, 62, 62.5, 62.7, 63, 63.5, 70, 77.5, 78, 78.5, 80, 82, 82.4, 82.8, 83.5, 84, 86, 87.5, 90, 92, 96, 100,
  111.9, 112, ...keyTimes, LIGHTER.t0, LIGHTER.t1];
for (let f = 0; f < 112 * 24; f += 5) TIMES.push(f / 24);

check('build adds two person roots, no lights, and update adds or removes nothing', () => {
  const { scene, at } = make();
  assert.deepEqual(scene.children.map((c) => c.name), ['person-A', 'person-B']);
  let lights = 0, count = 0;
  scene.traverse((o) => { count++; if (o.isLight) lights++; });
  assert.equal(lights, 0, 'the people own no light sources');
  for (const t of [20, 31, 50, 70, 80, 90]) at(t);
  let after = 0;
  scene.traverse(() => after++);
  assert.equal(after, count);
});

check('materials come from one small set: Lambert for bodies, one basic material for the shadows', () => {
  const mats = new Set();
  W.scene.traverse((o) => { if (o.material) mats.add(o.material); });
  assert.ok(mats.size <= 10, `${mats.size} materials`);
  for (const m of mats) assert.ok(m.isMeshLambertMaterial || m.isMeshBasicMaterial, `unexpected ${m.type}`);
  const basic = [...mats].filter((m) => m.isMeshBasicMaterial);
  assert.equal(basic.length, 1, 'only the blob shadow is unlit');
  const hex = (name) => `#${W.get(name).material.color.getHexString()}`;
  assert.equal(hex('person-A-coat'), '#2a3145');
  assert.equal(hex('person-B-coat'), '#7d8db0');
  assert.equal(hex('person-A-skull'), '#b49c8a');
  assert.equal(hex('person-B-beanie'), '#b5584a');
  assert.equal(hex('person-B-scarf'), '#c79a45');
  assert.equal(W.get('person-A-upperarm-L-mesh').material, W.get('person-A-coat').material, 'sleeves match the coat');
  assert.equal(W.get('person-A-skull').material, W.get('person-B-skull').material, 'skin is shared');
  assert.throws(() => W.get('person-A-beanie'));
  assert.throws(() => W.get('person-B-hair'));
});

check('hidden at t = 20 and until each one\'s door is fully open, then visible (seated in the car)', () => {
  const tA = KEYS.A[0].t, tB = KEYS.B[0].t;
  assert.ok(tA < tB, 'A gets out first');
  for (const [t, a, b] of [[0, false, false], [20, false, false], [tA - 0.01, false, false], [tA, true, false], [tB - 0.01, true, false], [tB, true, true], [70, true, true], [112, true, true]]) {
    W.at(t);
    assert.equal(W.get('person-A').visible, a, `A at ${t}`);
    assert.equal(W.get('person-B').visible, b, `B at ${t}`);
    assert.equal(peopleAt(t).A === null, !a);
  }
  // each person appears seated inside the car, so once the door starts to open is early enough: the car's body hides
  // them until they are out of it (every vertex inside the body is checked at the first key, below)
  for (const id of IDS) assert.ok(KEYS[id][0].t >= doorOf(id).open0, `${id} appears at ${KEYS[id][0].t}, before the door starts to open at ${doorOf(id).open0}`);
});

check('root position equals peopleAt, standing on the road, the curb-high sidewalk or the deck', () => {
  for (const t of [31.1, 31.5, 33, 36, 37.6, 40, 40.3, 50, 58, 62.7, 70, 80, 95, 100, 106, 111.9]) {
    W.at(t);
    const P = peopleAt(t);
    for (const id of IDS) {
      if (!P[id]) continue;
      const r = W.get(`person-${id}`).position;
      assert.equal(r.x, P[id].x, `${id} x at ${t}`);
      assert.equal(r.z, P[id].z, `${id} z at ${t}`);
      assert.equal(r.y, groundY(P[id].x, P[id].z), `${id} y at ${t}`);
    }
  }
  for (const id of IDS) {
    near(groundY(KEYS[id][0].x, KEYS[id][0].z), 0, 1e-12, `${id} seated over the road`);
    near(groundY(exitKey(id).x, exitKey(id).z), 0, 1e-12, `${id} gets out onto the road`);
    near(groundY(lastStand(id).x, lastStand(id).z), STREET.curb, 1e-12, `${id} waits on the east sidewalk`);
  }
  near(groundY(RAIL.x, RAIL.zA), 0, 1e-12, 'bridge deck');
  near(groundY(STREET.roadHalf, 0), STREET.curb / 2, 1e-12, 'half way up the curb at the edge');
  // the step up the curb at about 40 s is a ramp, not a pop: under 5 cm per frame
  let prev = null;
  for (let f = Math.floor(37.3 * 24); f <= 40.6 * 24; f++) {
    W.at(f / 24);
    const y = W.get('person-A').position.y;
    if (prev !== null) assert.ok(Math.abs(y - prev) < 0.05, `A rises ${y - prev} m in one frame at ${f / 24}`);
    prev = y;
  }
});

check('facing equals face: rotation.y = -face, and the shoes point along it', () => {
  for (const t of [31, 31.4, 33, 36, 39, 50, 63, 70, 80, 90]) {
    W.at(t);
    const P = peopleAt(t);
    for (const id of IDS) {
      if (!P[id]) continue;
      const root = W.get(`person-${id}`);
      near(root.rotation.y, -P[id].face * D2R, 1e-12, `${id} rotation.y at ${t}`);
      assert.ok(angDiff(headingOf(forwardOf(root)), P[id].face) < 1e-6, `${id} heading at ${t}`);
      for (const s of SIDES) {
        const toe = new THREE.Vector3().setFromMatrixPosition(W.get(`person-${id}-shoe-${s}`).matrixWorld).sub(wpos(`person-${id}-foot-${s}`));
        assert.ok(angDiff(headingOf(toe), P[id].face) < 1e-6, `${id} shoe ${s} points along face at ${t}`);
      }
    }
  }
});

check('head yaw relative to the body is look - face wrapped, and nose and head face `look`', () => {
  assert.equal(wrapDeg(245 - 190), 55);
  assert.equal(wrapDeg(0 - 270), 90);
  assert.equal(wrapDeg(350 - 10), -20);
  assert.equal(wrapDeg(10 - 350), 20);
  assert.equal(wrapDeg(-90), -90);
  assert.equal(wrapDeg(180), -180);
  const rel = (s) => (((s.look - s.face + 540) % 360) - 180);
  let turned = 0;
  for (const t of [31, 32, 33.6, 38.78, 80, 87.5, 90, 92, 96, 70, ...keyTimes]) {
    W.at(t);
    const P = peopleAt(t);
    for (const id of IDS) {
      if (!P[id]) continue;
      const head = W.get(`person-${id}-head`);
      near(head.rotation.y, -rel(P[id]) * D2R, 1e-12, `${id} head yaw at ${t}`);
      assert.ok(Math.abs(rel(P[id])) <= 180);
      assert.ok(angDiff(headingOf(forwardOf(head)), P[id].look) < 1e-6, `${id} head faces look at ${t}`);
      const nose = wpos(`person-${id}-nose`).sub(wpos(`person-${id}-head`));
      assert.ok(angDiff(headingOf(nose), P[id].look) < 1e-6, `${id} nose points along look at ${t}`);
      if (Math.abs(rel(P[id])) > 30) turned++;
    }
  }
  assert.ok(turned >= 5, `the sample includes real head turns: ${turned}`);
  // A cups the flame looking into the lee, over the right shoulder
  const [c0, c1] = holdOf('A', 'cup'), cup = KEYS.A.find((key) => key.pose === 'cup');
  W.at((c0 + c1) / 2);
  near(W.get('person-A-head').rotation.y, -rel(cup) * D2R, 1e-12, `A cupping: face ${cup.face}, look ${cup.look}`);
  assert.ok(rel(cup) > 30, 'a right turn');
  // one glance each, held, and each looks toward the other: B to the north (a left turn), A to the south (a right turn)
  for (const [id, other, sign] of [['B', 'A', -1], ['A', 'B', 1]]) {
    const g = glanceOf(id);
    assert.ok(g, `${id} glances`);
    const [g0, g1, key] = g, tm = (g0 + g1) / 2;
    W.at(tm);
    near(W.get(`person-${id}-head`).rotation.y, -rel(key) * D2R, 1e-12, `${id} glancing at ${tm}: face ${key.face}, look ${key.look}`);
    assert.equal(Math.sign(rel(key)), sign, `${id} turns the head the way the other stands`);
    const P = peopleAt(tm), toOther = headingOf(new THREE.Vector3(P[other].x - P[id].x, 0, P[other].z - P[id].z));
    assert.ok(angDiff(P[id].look, toOther) < 10, `${id} looks ${P[id].look}, ${other} is at ${toOther}`);
  }
});

check('proportions scale with height: crowns at 1.80 and 1.68, head radius about 0.11', () => {
  // both standing still on their spots: the longest stretch where both hold one
  let both = null;
  for (const a of stillHolds('A')) for (const b of stillHolds('B')) {
    const lo = Math.max(a[0], b[0]), hi = Math.min(a[1], b[1]);
    if (hi > lo && (!both || hi - lo > both[1] - both[0])) both = [lo, hi];
  }
  assert.ok(both, 'both stand still together somewhere');
  const t = (both[0] + both[1]) / 2;
  W.at(t);
  for (const id of IDS) {
    assert.equal(peopleAt(t)[id].pose, 'stand', `${id} at ${t}`);
    const g = W.get(`person-${id}`).position.y;
    const crown = wpos(`person-${id}-head`).y + W.get(`person-${id}-skull`).geometry.parameters.radius;
    near(crown - g, PEOPLE[id].height, 1e-9, `${id} crown`);
    near(W.get(`person-${id}-skull`).geometry.parameters.radius, 0.11 * k(id), 1e-12, `${id} head radius`);
    for (const s of SIDES) {
      near(wpos(`person-${id}-foot-${s}`).y - g, 0.07 * k(id), 1e-6, `${id} ankle ${s} on the ground`);
      const shoe = W.get(`person-${id}-shoe-${s}`);
      const bottom = new THREE.Vector3().setFromMatrixPosition(shoe.matrixWorld).y - shoe.geometry.parameters.height / 2;
      near(bottom, g, 1e-6, `${id} shoe sole on the ground`);
    }
    near(Math.abs(thighDeg(id, 'L')), 0, 0.01, `${id} standing legs straight`);
  }
  // A: narrower, longer coat ending low (a skirt hangs from the hips below the torso capsule); B: wider, shorter, puffy
  const A = W.get('person-A-coat').geometry.parameters, B = W.get('person-B-coat').geometry.parameters;
  assert.ok(A.radius < B.radius, 'A narrower');
  const topA = wpos('person-A-coat').y + A.height / 2 + A.radius - W.get('person-A').position.y;
  const topB = wpos('person-B-coat').y + B.height / 2 + B.radius - W.get('person-B').position.y;
  const skirt = W.get('person-A-coat-skirt');
  const hemA = wpos('person-A-coat-skirt').y - skirt.geometry.parameters.height / 2 - W.get('person-A').position.y;
  const hemB = wpos('person-B-coat').y - (B.height / 2 + B.radius) - W.get('person-B').position.y;
  near(hemA, 0.42, 1e-9, "A's coat ends below the knee");
  near(hemB, 0.8 * k('B'), 1e-9, "B's jacket ends at the hip");
  assert.ok(topA - hemA > 1.0 && topB - hemB < 0.75, `coat lengths ${topA - hemA}, ${topB - hemB}`);
  assert.ok(skirt.geometry.parameters.radiusBottom > skirt.geometry.parameters.radiusTop, 'the coat flares to the hem');
  assert.throws(() => W.get('person-B-coat-skirt'));
});

// A forearm resting on the parapet: the elbow joint over the parapet (past its inner face) and `lo` to `hi` m above its
// top, and the forearm within `slope` degrees of level. E and H are the elbow and hand, world. Returns the failures,
// so a planted pose can be shown to fail it.
function restMisses(E, H, { lo, hi, slope }) {
  const inner = BRIDGE.halfWidth - BRIDGE.parapetThick, top = BRIDGE.parapetTop, out = [];
  if (!(E.x > inner)) out.push(`elbow x ${E.x.toFixed(3)} short of the inner face ${inner}`);
  if (!(E.y - top >= lo && E.y - top <= hi)) out.push(`elbow ${((E.y - top) * 100).toFixed(1)} cm above the top`);
  const d = Math.atan2(Math.abs(H.y - E.y), Math.hypot(H.x - E.x, H.z - E.z)) / D2R;
  if (!(d <= slope)) out.push(`forearm ${d.toFixed(1)} degrees off level`);
  return out;
}
// The brief's railing is "leaned on with forearms". A: the elbow joint 1 to 5 cm above the top, so the sleeve lies on
// it, and the forearm within 10 degrees of level. B keeps the shared lean, accepted at Gate 2 as it stands (elbow 9 cm
// up at the joint, 3.6 cm at the sleeve's underside, forearm 16 degrees down): this holds it there.
const REST = { A: { lo: 0.01, hi: 0.05, slope: 10 }, B: { lo: 0.01, hi: 0.1, slope: 17 } };

check('lean at t = 70: forearms rest on the parapet top, hands at P0 + forward reach, +/-side, y top + 0.02, torso pitched per person', () => {
  W.at(70);
  const inner = BRIDGE.halfWidth - BRIDGE.parapetThick, outer = BRIDGE.halfWidth, top = BRIDGE.parapetTop;
  for (const id of IDS) {
    const s = peopleAt(70)[id];
    assert.equal(s.pose, 'lean');
    const L = { ...LEAN, ...LEAN_OF[id].lean };
    const P0 = new THREE.Vector3(s.x, 0, s.z), F = fwdOf(s.face), Rt = rightOf(s.face);
    near(-W.get(`person-${id}-torso`).rotation.x / D2R, L.pitchDeg, 1e-9, `${id} torso pitch`);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(W.get(`person-${id}-torso`).getWorldQuaternion(new THREE.Quaternion()));
    near(Math.acos(up.y) / D2R, L.pitchDeg, 1e-9, `${id} torso tilt from vertical`);
    assert.ok(up.dot(F) > 0, 'tilted toward the parapet');
    // both feet planted, soles on the deck
    for (const side of SIDES) near(wpos(`person-${id}-foot-${side}`).y, 0.07 * k(id), 1e-6, `${id} ${side} ankle on the deck`);
    // the torso, coat and legs stay clear of the parapet: nothing below its top reaches the inner face, and anything
    // over the parapet is above its top (the arms are checked below)
    for (const { name, p } of bodyPoints(id)) {
      if (/arm|hand/.test(name)) continue;
      assert.ok(p.y >= top || p.x < inner, `${name} at ${p.toArray().map((v) => v.toFixed(3))} is in the parapet`);
    }
    SIDES.forEach((side, i) => {
      const sg = i ? 1 : -1;
      const hand = wpos(`person-${id}-hand-${side}`);
      assert.ok(hand.x > inner && hand.x < outer, `${id} hand ${side} x ${hand.x} over the parapet`);
      assert.ok(hand.y >= top && hand.y <= top + 0.03, `${id} hand ${side} y ${hand.y} within 3 cm above the top`);
      const want = P0.clone().addScaledVector(F, L.reach).addScaledVector(Rt, sg * L.side).setY(top + 0.02);
      assert.ok(hand.distanceTo(want) < 0.01, `${id} hand ${side} ${hand.toArray()} vs ${want.toArray()}`);
      const miss = restMisses(wpos(`person-${id}-forearm-${side}`), hand, REST[id]);
      assert.deepEqual(miss, [], `${id} ${side} forearm does not rest on the top`);
      // the arm chain keeps its bone lengths and lies on or above the top wherever it is over the parapet
      const S = wpos(`person-${id}-upperarm-${side}`), E = wpos(`person-${id}-forearm-${side}`);
      near(S.distanceTo(E), 0.3 * k(id), 1e-9, `${id} upper arm length`);
      near(E.distanceTo(hand), 0.28 * k(id), 1e-9, `${id} forearm length`);
      for (const [a, b] of [[S, E], [E, hand]]) {
        for (let j = 0; j <= 50; j++) {
          const p = a.clone().lerp(b, j / 50);
          if (p.x >= inner && p.x <= outer) assert.ok(p.y >= top - 1e-9, `${id} ${side} arm axis dips to ${p.y} inside the parapet`);
        }
      }
      // elbow bends down and outward: outside the shoulder, below the shoulder-hand line
      const sb = toBody(id, S), eb = toBody(id, E), hb = toBody(id, hand);
      assert.ok(sg * eb.x > sg * sb.x + 0.05, `${id} ${side} elbow outward`);
      const mid = sb.clone().lerp(hb, 0.5);
      assert.ok(eb.y < mid.y, `${id} ${side} elbow below the shoulder-hand line`);
    });
  }
  // planted control: A on the shared lean (B's: pitch 12, the shared reach and pole), solved here from A's standing
  // hips, has the elbows about 14 cm over the top and the forearms 25 degrees down, which the rest check catches
  const s = peopleAt(70).A, q = { x: s.x, y: groundY(s.x, s.z), z: s.z, face: s.face }, p = LEAN.pitchDeg * D2R;
  const sh = [0.19, 0.93 + 0.54 * Math.cos(p), 0.02 - 0.54 * Math.sin(p)];
  const { joint, end } = solveTwoBone(sh, [LEAN.side, LEAN.handY - q.y, -LEAN.reach], 0.3, 0.28, LEAN.pole);
  const shared = restMisses(new THREE.Vector3(...bodyToWorld(q, joint)), new THREE.Vector3(...bodyToWorld(q, end)), REST.A);
  assert.equal(shared.length, 2, `A on the shared lean: ${shared.join('; ')}`);
});

check('getting out, the keys: seated, then the outboard foot out, then standing; never a walk, risen before the door shuts', () => {
  for (const id of IDS) {
    const ks = KEYS[id], ix = exitIndex(id);
    assert.equal(ks[0].pose, 'emerge', `${id} starts seated`);
    assert.equal(ix, 1, `${id} gets out straight after the seated key`);
    assert.equal(risenKey(id).pose, 'stand', `${id} stands after getting out`);
    assert.ok(risenKey(id).t <= doorOf(id).close0, `${id} still getting out at ${risenKey(id).t}, the door shuts from ${doorOf(id).close0}`);
    // the seated-to-exit move covers ground faster than a walk (0.2 m/s), so by speed alone sampleKeys would call it a
    // walk: this is the case the never-a-walk rule exists for (the pose loop below checks it sample by sample)
    const speed = (a, b) => Math.hypot(b.x - a.x, b.z - a.z) / (b.t - a.t);
    assert.ok(speed(ks[0], ks[1]) > 0.2, `${id} seated to exit moves ${speed(ks[0], ks[1])} m/s: the never-a-walk rule is not exercised`);
    // the rise is in place, so the outboard foot planted on the ground does not slide while the body comes up
    assert.ok(speed(ks[1], ks[2]) < 1e-9, `${id} rises in place, but its root moves at ${speed(ks[1], ks[2])} m/s`);
    for (let f = Math.ceil(ks[0].t * 240); f < risenKey(id).t * 240; f++) {
      const t = f / 240, want = t < ks[ix].t ? 'emerge' : 'exit';
      assert.equal(peopleAt(t)[id].pose, want, `${id} at ${t}`);
    }
  }
});

check('getting out, the first key: seated facing ahead, feet in the footwell, the whole person inside the car\'s body', () => {
  for (const id of IDS) {
    const key = KEYS[id][0], t = key.t, car = C(t);
    W.at(t);
    assert.equal(peopleAt(t)[id].pose, 'emerge');
    assert.equal(key.face, carAt(t).heading, `${id} faces the way the car does`);
    const g = W.get(`person-${id}`).position.y;
    near(g, 0, 1e-12, `${id} over the road`);
    // heights are the car's, not scaled with the person
    near(wpos(`person-${id}-torso`).y - g, EMERGE.hipY, 1e-9, `${id} seat height`);
    near(-W.get(`person-${id}-torso`).rotation.x / D2R, EMERGE.pitchDeg, 1e-9, `${id} torso pitch`);
    for (const side of SIDES) {
      near(wpos(`person-${id}-foot-${side}`).y - g, SILL.y, 1e-6, `${id} ankle ${side} in the footwell`);
      const knee = toBody(id, wpos(`person-${id}-shin-${side}`)), hip = toBody(id, wpos(`person-${id}-thigh-${side}`));
      assert.ok(knee.z < hip.z, `${id} knee ${side} forward of the hips`);
    }
    // nothing pops into view: every vertex of the person (but the blob shadow on the road) is inside the car's body
    const [out, where] = outsideCar(bodyPoints(id), car);
    assert.ok(out <= 1e-9, `${id} pokes ${out.toFixed(4)} m out of the car's body at ${t}: ${where} (shell ${car.shell.min.toArray()} to ${car.shell.max.toArray()})`);
  }
  // A's coat skirt is laid over the thighs, its hem ahead of the hips
  W.at(KEYS.A[0].t);
  near(-W.get('person-A-skirt').rotation.x / D2R, EMERGE.skirtDeg, 1e-9, 'skirt angle');
  const sk = W.get('person-A-coat-skirt');
  const hem = toBody('A', new THREE.Vector3(0, -sk.geometry.parameters.height / 2, 0).applyMatrix4(sk.matrixWorld));
  const hip = toBody('A', wpos('person-A-torso'));
  assert.ok(hem.z < hip.z, `hem ${hem.z - hip.z} m behind the hips, not over the thighs`);
});

// how far a shoe's sole is above the ground under it, as drawn at the last W.at
const soleUp = (id, side) => {
  const shoe = W.get(`person-${id}-shoe-${side}`), c = new THREE.Vector3().setFromMatrixPosition(shoe.matrixWorld);
  return c.y - shoe.geometry.parameters.height / 2 - groundY(c.x, c.z);
};
// One boot, then the other (decision 5b): the inboard boot lands a few tenths of a second after the outboard one (at
// the exit key), and before the hips are half way up from the doorway to standing. `lag` in seconds, `rise` 0 to 1.
const oneBootFirst = ({ lag, rise }) => lag >= 0.15 && lag <= 0.5 && rise < 0.5;

check('getting out, the exit key: the outboard boot on the ground outside the car, the hips low in the doorway, then the other boot', () => {
  for (const id of IDS) {
    const t = exitKey(id).t, car = C(t), s = EXIT.outSide[id], boot = EXIT.boot[id];
    W.at(t);
    assert.equal(peopleAt(t)[id].pose, 'exit');
    const g = W.get(`person-${id}`).position.y;
    near(wpos(`person-${id}-torso`).y - g, EXIT.hipFrac * 0.93 * k(id), 1e-9, `${id} hip height`);
    near(-W.get(`person-${id}-torso`).rotation.x / D2R, EXIT.pitchDeg, 1e-9, `${id} torso pitch`);
    // the outboard shoe stands on the ground; the inboard one too, unless this person puts one boot down first, when it
    // is still `up` over the ground. Every vertex of each is outside the car's footprint.
    for (const side of SIDES) {
      const inboard = side === sideTag(-s);
      near(soleUp(id, side), inboard && boot ? boot.up : 0, 1e-6, `${id} ${side} sole height`);
      const pts = bodyPoints(id).filter((v) => v.name === `person-${id}-shoe-${side}`);
      assert.ok(pts.every((v) => !inFootprint(v.p, car.shell)), `${id} ${side} shoe outside the car`);
    }
    // the outboard boot is beside the hip, the other beside it across the body: the step out is the walk after this key
    const out = toBody(id, wpos(`person-${id}-foot-${sideTag(s)}`)), inb = toBody(id, wpos(`person-${id}-foot-${sideTag(-s)}`));
    assert.ok(Math.abs(out.z) < 0.15 * k(id), `${id} outboard foot ${out.z} m from the hips' line, not stepped out in front`);
    near(Math.abs(out.x - inb.x), 2 * (0.095 + 0.01) * k(id), 1e-6, `${id} boots side by side`); // hip half-width 0.095 (people.js BODY)
    for (const side of SIDES) {
      const knee = toBody(id, wpos(`person-${id}-shin-${side}`)), hip = toBody(id, wpos(`person-${id}-thigh-${side}`));
      assert.ok(knee.z < hip.z, `${id} knee ${side} bends forward`);
    }
    // planted control: the same test of the whole person finds it half out of the car, in the doorway
    assert.ok(outsideCar(bodyPoints(id), car)[0] > 0.1, `${id} is half out of the car`);
  }
  // From the exit key to standing, every 1/240 s: the outboard boot stays down, and the inboard one lands (once).
  const landing = {};
  for (const id of IDS) {
    const t0 = exitKey(id).t, t1 = risenKey(id).t, s = EXIT.outSide[id];
    const hipAt = (t) => { W.at(t); return wpos(`person-${id}-torso`).y - W.get(`person-${id}`).position.y; };
    const h0 = EXIT.hipFrac * 0.93 * k(id), h1 = 0.93 * k(id);
    let lands = null;
    for (let f = Math.round(t0 * 240); f <= Math.round(t1 * 240); f++) {
      const t = f / 240, h = hipAt(t);
      assert.ok(Math.abs(soleUp(id, sideTag(s))) < 1e-6, `${id} outboard boot off the ground at ${t}`);
      const up = soleUp(id, sideTag(-s));
      if (up > 1e-3) assert.equal(lands, null, `${id} inboard boot lifts again at ${t}`);
      else if (lands === null) lands = { lag: t - t0, rise: (h - h0) / (h1 - h0) };
    }
    assert.ok(lands, `${id} inboard boot never lands before ${t1}`);
    landing[id] = lands;
  }
  console.log(`   inboard boot lands after the outboard: A ${landing.A.lag.toFixed(3)} s (hips ${(landing.A.rise * 100).toFixed(0)}% up), B ${landing.B.lag.toFixed(3)} s`);
  assert.ok(oneBootFirst(landing.A), `A: ${JSON.stringify(landing.A)}`);
  // B's boots land together, as built: and that is what the one-boot rule catches (planted control)
  assert.equal(landing.B.lag, 0, 'B lands on both boots at once');
  assert.ok(!oneBootFirst(landing.B), 'the one-boot rule passes two boots landing together');
  assert.ok(!oneBootFirst({ lag: landing.A.lag, rise: 0.8 }), 'the one-boot rule passes a boot that lands once A is nearly up');
  // A's long coat hangs from the hips rather than swinging out behind like a tail
  W.at(exitKey('A').t);
  near(-W.get('person-A-skirt').rotation.x / D2R, 0.3 * EXIT.pitchDeg, 1e-9, 'skirt follows 30% of the pitch');
  const sk = W.get('person-A-coat-skirt');
  const hem = toBody('A', new THREE.Vector3(0, -sk.geometry.parameters.height / 2, 0).applyMatrix4(sk.matrixWorld));
  const hip = toBody('A', wpos('person-A-torso'));
  assert.ok(hem.z - hip.z < 0.1, `hem ${hem.z - hip.z} m behind the hips`);
  // risen to standing by the next key, a step back out of the door's swing
  for (const id of IDS) {
    const t = risenKey(id).t;
    W.at(t);
    // 1e-4, not 1e-9: the walk table widens each walk by one sample (1/120 s), so the walk ramps in a fraction of a
    // millimetre before the stand key; at the key itself the hips are 0.02 mm off standing
    near(wpos(`person-${id}-torso`).y - W.get(`person-${id}`).position.y, 0.93 * k(id), 1e-4, `${id} standing at ${t}`);
    near(W.get(`person-${id}-torso`).rotation.x, 0, 1e-12);
  }
});

check('getting out: nothing shows under the car, no shoe sole (or any other part) below its underside inside its footprint, any 1/240 s', () => {
  // The low camera in shot 5 sees under the car, so while a person is in it or stepping out of it, nothing of them
  // may hang below the car's underside where the car is above it: not the feet coming over the sill, not the coat.
  let sole = [0, ''], body = [0, ''];
  for (const id of IDS) {
    for (let f = Math.ceil(KEYS[id][0].t * 240); f <= risenKey(id).t * 240; f++) {
      const t = f / 240, { shell } = C(t);
      W.at(t);
      for (const side of SIDES) {
        const d = underCar(soleCorners(id, side), shell);
        if (d > sole[0]) sole = [d, `${id} ${side} at ${t.toFixed(4)}`];
      }
      for (const { name, p } of bodyPoints(id)) {
        const d = underCar([p], shell);
        if (d > body[0]) body = [d, `${name} at ${t.toFixed(4)}, ${p.toArray().map((v) => v.toFixed(3))}`];
      }
    }
  }
  console.log(`   under the car's underside inside its footprint: deepest sole ${(sole[0] * 100).toFixed(2)} cm (${sole[1]}), deepest part ${(body[0] * 100).toFixed(2)} cm (${body[1]})`);
  assert.equal(sole[0], 0, `a sole is ${sole[0]} m below the car's underside, under the car: ${sole[1]}`);
  // planted control: A's standing shoes, moved under the seat, are caught
  const t = risenKey('A').t, { shell } = C(t);
  W.at(t);
  const shift = new THREE.Vector3(KEYS.A[0].x - risenKey('A').x, 0, KEYS.A[0].z - risenKey('A').z);
  const moved = SIDES.flatMap((side) => soleCorners('A', side).map((p) => p.add(shift)));
  assert.ok(underCar(moved, shell) > 0.2, `standing soles under the car read ${underCar(moved, shell)}`);
  assert.equal(body[0], 0, `a part is ${body[0]} m below the car's underside, under the car: ${body[1]}`);
});

check('walk at t = 50: legs swing +/-20 against each other, arms counter-swing, phase from distance walked', () => {
  const cycle = (id) => 4 * 0.86 * k(id) * Math.sin(20 * D2R);
  // distance walked since the stretch began (the last stand key), integrated here independently of the module's table
  const walked = (id, t) => {
    const t0 = lastStand(id).t;
    let d = 0, p = peopleAt(t0)[id];
    const n = Math.round((t - t0) * 2000);
    for (let i = 1; i <= n; i++) { const q = peopleAt(t0 + i / 2000)[id]; d += Math.hypot(q.x - p.x, q.z - p.z); p = q; }
    return d;
  };
  for (const id of IDS) {
    const got = [];
    for (const t of [50, 50.25]) {
      W.at(t);
      assert.equal(peopleAt(t)[id].pose, 'walk');
      const L = thighDeg(id, 'L'), R = thighDeg(id, 'R');
      near(L, -R, 1e-6, `${id} legs opposite at ${t}`);
      const want = 20 * Math.sin((2 * Math.PI * walked(id, t)) / cycle(id));
      near(L, want, 0.05, `${id} left thigh at ${t}`);
      // arms swing against their own leg
      if (Math.abs(L) > 3) assert.ok(Math.sign(armSwingDeg(id, 'L')) === -Math.sign(L), `${id} left arm counter-swings at ${t}`);
      got.push(L);
    }
    assert.ok(Math.abs(got[0] - got[1]) > 2, `${id} legs move between 50 and 50.25: ${got}`);
  }
  // full amplitude, knee flex on the passing leg, and on level ground the lower shoe always on the ground
  // (the curb steps, where each shoe has its own ground, are checked over the whole film further down)
  let maxSwing = 0, maxFlex = 0, maxDrop = 0, level = 0;
  for (let t = 46; t < 60; t += 1 / 48) {
    W.at(t);
    const g = W.get('person-A').position.y;
    const grounds = SIDES.map((s) => { const c = wpos(`person-A-shoe-${s}`); return groundY(c.x, c.z); });
    if (grounds.some((v) => Math.abs(v - g) > 1e-12)) continue;
    level++;
    maxSwing = Math.max(maxSwing, Math.abs(thighDeg('A', 'L')));
    maxFlex = Math.max(maxFlex, thighDeg('A', 'L') - shinDeg('A', 'L'));
    const ankles = SIDES.map((s) => wpos(`person-A-foot-${s}`).y - g);
    near(Math.min(...ankles), 0.07, 1e-9, `lowest ankle grounded at ${t}`);
    maxDrop = Math.max(maxDrop, 0.93 - (wpos('person-A-torso').y - g));
  }
  assert.ok(level > 600, `${level} level frames`);
  assert.ok(maxSwing <= 20 + 1e-9 && maxSwing > 19.9, `swing ${maxSwing}`);
  assert.ok(maxFlex > 25 && maxFlex <= 30 + 1e-9, `knee flex ${maxFlex}`);
  assert.ok(maxDrop > 0.02 && maxDrop < 0.06, `vertical bob ${maxDrop}`);
});

check('shoes stand on the ground under each shoe, at the curb steps too, and the hips never pop', () => {
  // every frame both are visible: no sole below the ground under its own centre, and the hips (world) move less than
  // 4 cm a frame, also stepping up and down the curb at 39.7 and 56 s. From the exit key on, when the outboard foot is
  // down, the lower sole is close to the ground too (before it, both feet are in the footwell, checked above).
  const posers = { A: makePoser('A'), B: makePoser('B') };
  let deepest = 0, highest = 0, floats = 0, hipStep = [0, ''];
  for (const id of IDS) {
    let prev = null;
    for (let f = 30 * 24; f < 112 * 24; f++) {
      const t = f / 24, q = posers[id](t);
      if (!q.visible) { prev = null; continue; }
      const gaps = q.legs.map((L) => {
        const c = bodyToWorld(q, [L.ankle[0], L.ankle[1], L.ankle[2] - 0.07 * k(id)]); // the shoe's centre, sole at -0.07 k
        return c[1] - 0.07 * k(id) - groundY(c[0], c[2]);
      });
      deepest = Math.min(deepest, ...gaps);
      if (t >= exitKey(id).t) {
        highest = Math.max(highest, Math.min(...gaps));
        if (Math.min(...gaps) > 0.01) floats++;
      }
      const hy = q.y + q.hip[1];
      if (prev !== null && Math.abs(hy - prev) > hipStep[0]) hipStep = [Math.abs(hy - prev), `${id} at ${t.toFixed(3)}`];
      prev = hy;
    }
  }
  console.log(`   deepest sole ${(deepest * 100).toFixed(2)} cm, highest lower sole ${(highest * 100).toFixed(2)} cm (${floats} frames over 1 cm), largest hip step ${(hipStep[0] * 100).toFixed(2)} cm (${hipStep[1]})`);
  assert.ok(deepest > -1e-6, `a sole sinks ${deepest} m into the ground`);
  // 4.5 cm: stepping down the 15 cm curb onto the deck, the hips ease down over 0.3 s, so for a frame or two the lower
  // sole is a few cm up (A at 56.2 is the worst, 4.0 cm, 13 m from shot 8's camera)
  assert.ok(highest < 0.045 && floats <= 8, `the lower sole floats ${highest} m, ${floats} frames over 1 cm`);
  assert.ok(hipStep[0] < 0.04, `the hips jump ${hipStep[0]} m in a frame: ${hipStep[1]}`);
  // the step up the curb is on camera in shot 5 (ends at 40) at ground level: a shoe lands on the curb, not in it
  let landed = null;
  for (let f = Math.round(39 * 24); f < 40 * 24 && landed === null; f++) {
    W.at(f / 24);
    for (const side of SIDES) {
      const c = wpos(`person-A-shoe-${side}`);
      if (groundY(c.x, c.z) > 0.14) { landed = f / 24; break; }
    }
  }
  assert.ok(landed !== null, 'A steps onto the curb before shot 5 ends at 40');
});

check('walks ease in and out by distance, and a stationary walk key is standing still', () => {
  // Every end of every walking stretch, where both shoes stand on the root's own ground. On uneven ground (a foot on
  // the curb's ramp) a standing leg bends by design; the ground and hip checks above cover those frames.
  const level = (id) => SIDES.every((s) => { const c = wpos(`person-${id}-shoe-${s}`); return Math.abs(groundY(c.x, c.z) - W.get(`person-${id}`).position.y) < 1e-3; });
  let ends = 0, still = 0;
  const uneven = [];
  for (const id of IDS) {
    for (const [t0, t1] of walkStretches(id)) {
      for (const [t, why] of [[t0 + 1 / 240, 'setting off'], [t1 - 1 / 240, 'arriving']]) {
        W.at(t);
        if (!level(id)) { uneven.push(`${id} ${why} at ${t.toFixed(3)}`); continue; }
        assert.ok(Math.abs(thighDeg(id, 'L')) < 1, `${id} ${why} at ${t}: ${thighDeg(id, 'L')}`);
        ends++;
      }
    }
    for (const [t0, t1] of stillWalks(id)) {
      const t = (t0 + t1) / 2;
      W.at(t);
      assert.equal(peopleAt(t)[id].pose, 'walk', `${id} at ${t}`);
      assert.ok(Math.abs(thighDeg(id, 'L')) < 1, `${id} at ${t}, no ground covered: ${thighDeg(id, 'L')}`);
      near(wpos(`person-${id}-torso`).y - W.get(`person-${id}`).position.y, 0.93 * k(id), 1e-9, `${id} at ${t}: no bob while standing`);
      still++;
    }
  }
  console.log(`   ${ends} stretch ends on level ground, ${still} stationary walk keys; on uneven ground: ${uneven.join(', ') || 'none'}`);
  assert.ok(ends >= 8 && still >= 2, `${ends} stretch ends, ${still} stationary walk keys`);
});

check('cup at t = 80: both hands in front of the face, where the head is turned', () => {
  W.at(80);
  const s = peopleAt(80).A;
  assert.equal(s.pose, 'cup');
  const head = wpos('person-A-head'), F = fwdOf(s.look), Rt = rightOf(s.look);
  SIDES.forEach((side, i) => {
    const hand = wpos(`person-A-hand-${side}`);
    const want = head.clone().addScaledVector(F, 0.2).add(new THREE.Vector3(0, -0.1, 0)).addScaledVector(Rt, (i ? 1 : -1) * 0.07);
    assert.ok(hand.distanceTo(want) < 0.01, `hand ${side} ${hand.toArray()} vs ${want.toArray()}`);
    assert.ok(hand.clone().sub(head).dot(F) > 0.15, 'in front of the face');
    // elbows below the shoulders
    assert.ok(wpos(`person-A-forearm-${side}`).y < wpos(`person-A-upperarm-${side}`).y, `${side} elbow below the shoulder`);
  });
});

check('smoke: right hand at the mouth (head + forward 0.1, down 0.1), left forearm stays on the parapet', () => {
  const inner = BRIDGE.halfWidth - BRIDGE.parapetThick, outer = BRIDGE.halfWidth, top = BRIDGE.parapetTop;
  for (const t of [86, 90, 92, 96]) {
    W.at(t);
    const s = peopleAt(t).A;
    assert.equal(s.pose, 'smoke');
    const head = wpos('person-A-head');
    const mouth = head.clone().addScaledVector(fwdOf(s.look), 0.1).add(new THREE.Vector3(0, -0.1, 0));
    assert.ok(wpos('person-A-hand-R').distanceTo(mouth) < 0.005, `right hand at the mouth at ${t}`);
    const left = wpos('person-A-hand-L');
    assert.ok(left.x > inner && left.x < outer && left.y >= top && left.y <= top + 0.03, `left hand on the parapet at ${t}: ${left.toArray()}`);
    // and that forearm rests on the top as it does in the lean, the glance at B (92) included
    assert.deepEqual(restMisses(wpos('person-A-forearm-L'), left, REST.A), [], `A's left forearm at ${t}`);
  }
});

check('every lean and smoke key faces the east parapet square on (face 90): the rail frame rests on it', () => {
  for (const id of IDS) for (const key of PEOPLE_KEYS[id]) if (key.pose === 'lean' || key.pose === 'smoke') assert.equal(key.face, 90, `${id} ${key.pose} at ${key.t}`);
});

check('no arm cuts the east parapet, any frame from 55 to 112 s: not turning onto the rail, not lighting up', () => {
  // The parapet box: x 5.55 (inner face) to 6.0, below its top (BRIDGE.parapetTop), z -38 to -8. Every arm bone axis
  // point and every hand centre stays out of it, and no hand sphere pokes through the inner face from the deck side.
  const inner = BRIDGE.halfWidth - BRIDGE.parapetThick, outer = BRIDGE.halfWidth, top = BRIDGE.parapetTop;
  near(inner, 5.55, 1e-12, 'inner face');
  const inBox = (p) => p.x > inner && p.x < outer && p.y < top && p.z < BRIDGE.z0 && p.z > BRIDGE.z1;
  let axisWorst = [0, ''], faceWorst = [0, ''], lowest = 9;
  for (let f = 55 * 24; f < 112 * 24; f++) {
    const t = f / 24;
    W.at(t);
    for (const id of IDS) {
      const r = 0.05 * k(id);
      for (const side of SIDES) {
        const S = wpos(`person-${id}-upperarm-${side}`), E = wpos(`person-${id}-forearm-${side}`), H = wpos(`person-${id}-hand-${side}`);
        for (const [a, b] of [[S, E], [E, H]]) {
          for (let j = 0; j <= 40; j++) {
            const p = a.clone().lerp(b, j / 40);
            if (inBox(p)) {
              const d = Math.min(p.x - inner, outer - p.x, top - p.y);
              if (d > axisWorst[0]) axisWorst = [d, `${id} ${side} at ${t.toFixed(3)}`];
            }
            if (p.x >= inner && p.x <= outer && p.z < BRIDGE.z0 && p.z > BRIDGE.z1) lowest = Math.min(lowest, p.y);
          }
        }
        if (H.x < inner && H.z < BRIDGE.z0 && H.z > BRIDGE.z1) {
          const d = Math.min(H.x + r - inner, top - (H.y - r));
          if (d > faceWorst[0]) faceWorst = [d, `${id} ${side} at ${t.toFixed(3)}`];
        }
      }
    }
  }
  console.log(`   deepest arm point inside the parapet ${(axisWorst[0] * 100).toFixed(2)} cm, hand through its face ${(faceWorst[0] * 100).toFixed(2)} cm, lowest arm point over it ${lowest.toFixed(3)} m`);
  assert.equal(axisWorst[0], 0, `an arm bone is ${axisWorst[0]} m inside the parapet: ${axisWorst[1]}`);
  assert.ok(faceWorst[0] < 0.005, `a hand pokes ${faceWorst[0]} m through the parapet face: ${faceWorst[1]}`);
  assert.ok(lowest >= top, `an arm point over the parapet is at ${lowest}`);
  // the hands land on the rail as the turn ends, and stay put on the top until A turns away to light up
  const [l0, l1] = holdOf('A', 'lean');
  W.at(l0);
  const landed = SIDES.map((s) => wpos(`person-A-hand-${s}`));
  for (const t of [(l0 + l1) / 2, l1]) {
    W.at(t);
    SIDES.forEach((s, i) => assert.ok(wpos(`person-A-hand-${s}`).distanceTo(landed[i]) < 1e-9, `A ${s} hand moved on the rail by ${t}`));
  }
});

check('cigarette: the lighter flame (`cup`) sits between the cupped hands, and the lit end (`tip`) is clear of hand and head', () => {
  const pA = makePoser('A');
  const w = (q, v) => new THREE.Vector3(...bodyToWorld(q, v));
  const [c0, c1] = holdOf('A', 'cup');
  // the lighter strikes once the turn into the lee and the cup are done, and burns out before the hands open
  assert.ok(LIGHTER.t0 >= c0 && LIGHTER.t1 <= c1, `lighter ${LIGHTER.t0} to ${LIGHTER.t1}, cupped ${c0} to ${c1}`);
  let prev = null, jump = 0;
  for (let f = Math.round(LIGHTER.t0 * 24); f < 112 * 24; f++) {
    const t = f / 24, q = pA(t);
    const hl = w(q, q.arms[0].hand), hr = w(q, q.arms[1].hand), head = w(q, q.head), cup = w(q, q.cup), tip = w(q, q.tip);
    const gaze = fwdOf(q.look);
    // between the lips, 0.1 m along the gaze from the mouth: where the flame at the cup lights it
    near(tip.distanceTo(w(q, q.mouth).addScaledVector(gaze, 0.1)), 0, 1e-9, `tip from the mouth at ${t}`);
    if (t >= c0 && t <= c1) assert.ok(cup.distanceTo(hl.clone().lerp(hr, 0.5)) < 0.005, `cup between the hands at ${t}`);
    if (q.pose === 'smoke') {
      // the right hand holds it at the lips, so the tip is 0.1 m past the hand along the gaze
      assert.ok(tip.distanceTo(hr.clone().addScaledVector(gaze, 0.1)) < 1e-6, `tip past the right hand at ${t}`);
      assert.ok(tip.distanceTo(hr) > 0.05 + 0.04, `tip clear of the right hand at ${t}`);
      assert.ok(tip.distanceTo(head) > 0.11 + 0.08, `tip clear of the head at ${t}`);
    }
    if (prev) jump = Math.max(jump, tip.distanceTo(prev));
    prev = tip;
  }
  assert.ok(jump < 0.05, `the tip jumps ${jump} m in a frame`);
  // the hands have closed round the flame when the lighter comes on
  const q0 = pA(LIGHTER.t0);
  assert.ok(w(q0, q0.cup).distanceTo(w(q0, q0.arms[0].hand).lerp(w(q0, q0.arms[1].hand), 0.5)) < 0.005);
  const q = pA(96);
  const tip96 = w(q, q.tip);
  console.log(`   tip at 96: ${tip96.toArray().map((v) => v.toFixed(3))}, at 100: ${w(pA(100), pA(100).tip).toArray().map((v) => v.toFixed(3))}`);
});

check('pose changes are blended: no joint jumps between frames in the body frame, beyond what a walking foot does', () => {
  // Measured relative to the root, so the scripted path and turns in world.js do not count against the rig.
  // Swinging feet and shins legitimately move fast in a walk (about twice body speed), so they get their own bound.
  const names = [];
  for (const id of IDS) for (const part of ['head', 'torso', 'hand-L', 'hand-R', 'forearm-L', 'forearm-R', 'foot-L', 'foot-R', 'shin-L', 'shin-R']) names.push([id, part]);
  let prev = null;
  const worst = { pose: [0, ''], walk: [0, ''] };
  for (let f = 0; f < 112 * 24; f++) {
    const t = f / 24;
    W.at(t);
    const P = peopleAt(t);
    const cur = names.map(([id, part]) => (W.get(`person-${id}`).visible ? { p: toBody(id, wpos(`person-${id}-${part}`)), walk: P[id].pose === 'walk' } : null));
    if (prev) {
      cur.forEach((c, i) => {
        if (!c || !prev[i]) return;
        const d = c.p.distanceTo(prev[i].p);
        const leg = /^(foot|shin)/.test(names[i][1]);
        const kind = leg && (c.walk || prev[i].walk) ? 'walk' : 'pose';
        if (d > worst[kind][0]) worst[kind] = [d, `${names[i][0]} ${names[i][1]} at ${t.toFixed(3)}`];
      });
    }
    prev = cur;
  }
  console.log(`   largest per-frame move: ${worst.pose[0].toFixed(4)} m (${worst.pose[1]}); walking legs ${worst.walk[0].toFixed(4)} m (${worst.walk[1]})`);
  assert.ok(worst.pose[0] < 0.07, `a joint jumps ${worst.pose[0]} m: ${worst.pose[1]}`);
  // 0.16: a swing foot that meets the curb mid-stride also rises 15 cm over it (A at 39.6, about 3.6 m/s, inside a real step's range)
  assert.ok(worst.walk[0] < 0.16, `a walking foot jumps ${worst.walk[0]} m: ${worst.walk[1]}`);
});

check('forearms and hands stay out of the coat, any frame (B comes up beside the puffy jacket to reach the rail)', () => {
  // Points along each forearm and the hand, in the coat mesh's own frame (its scale undone), against its capsule.
  // The puffy jacket and a hanging hand already touch by about 3.5 cm while walking; nothing goes deeper than 4.5 cm.
  const capDist = (p, r, hh) => Math.hypot(p.x, p.y - Math.max(-hh, Math.min(hh, p.y)), p.z) - r;
  let worst = [0, ''];
  for (let f = 30 * 24; f < 112 * 24; f++) {
    const t = f / 24;
    W.at(t);
    for (const id of IDS) {
      if (!W.get(`person-${id}`).visible) continue;
      const coat = W.get(`person-${id}-coat`), inv = coat.matrixWorld.clone().invert();
      const { radius, height } = coat.geometry.parameters, s = Math.min(coat.scale.x, coat.scale.z);
      for (const side of SIDES) {
        const E = wpos(`person-${id}-forearm-${side}`), H = wpos(`person-${id}-hand-${side}`);
        const rFore = W.get(`person-${id}-forearm-${side}-mesh`).geometry.parameters.radius;
        const rHand = W.get(`person-${id}-hand-${side}-mesh`).geometry.parameters.radius;
        for (let j = 0; j <= 20; j++) {
          const p = E.clone().lerp(H, j / 20).applyMatrix4(inv);
          const d = -capDist(p, radius, height / 2) * s + (j === 20 ? rHand : rFore);
          if (d > worst[0]) worst = [d, `${id} ${side} at ${t.toFixed(3)}`];
        }
      }
    }
  }
  console.log(`   deepest forearm or hand into the coat ${(worst[0] * 100).toFixed(1)} cm (${worst[1]})`);
  assert.ok(worst[0] < 0.045, `an arm cuts ${worst[0]} m into the coat: ${worst[1]}`);
});

check('blob shadow: a dark transparent disc on the ground under each person, no depth write', () => {
  W.at(50);
  for (const id of IDS) {
    const sh = W.get(`person-${id}-shadow`);
    assert.ok(sh.material.isMeshBasicMaterial && sh.material.transparent && sh.material.depthWrite === false);
    assert.ok(sh.material.opacity > 0.2 && sh.material.opacity < 0.8);
    assert.equal(sh.material.color.getHex(), 0);
    const p = wpos(`person-${id}-shadow`), r = W.get(`person-${id}`).position;
    near(p.x, r.x, 1e-9); near(p.z, r.z, 1e-9);
    assert.ok(p.y - r.y > 0 && p.y - r.y < 0.03, 'just above the ground');
    // flattened in the geometry, and the root only ever turns about +Y, so the disc stays level
    sh.geometry.computeBoundingBox();
    const box = sh.geometry.boundingBox;
    near(box.max.y - box.min.y, 0, 1e-9, 'lies flat');
    assert.ok(box.max.x > 0.3 * k(id) && box.max.x < 0.5, `radius ${box.max.x}`);
    const n = new THREE.Vector3(0, 1, 0).applyQuaternion(sh.getWorldQuaternion(new THREE.Quaternion()));
    near(n.y, 1, 1e-9, 'not tilted');
  }
});

check('two-bone IK: lengths kept, reaches reachable targets, clamps far ones, bends toward the pole', () => {
  const rnd = mulberry32(99);
  const r = (s) => (rnd() * 2 - 1) * s;
  for (let i = 0; i < 400; i++) {
    const S = [r(1), r(1), r(1)], a = 0.2 + rnd() * 0.2, b = 0.2 + rnd() * 0.2;
    const dir = [r(1), r(1), r(1)], dl = Math.hypot(...dir), want = rnd() * (a + b) * 1.3;
    const T = S.map((v, j) => v + (dir[j] / dl) * want);
    const pole = [r(1), r(1), r(1)];
    const { joint: J, end: E } = solveTwoBone(S, T, a, b, pole);
    const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
    near(dist(S, J), a, 1e-9, 'upper bone');
    near(dist(J, E), b, 1e-9, 'lower bone');
    if (want > Math.abs(a - b) + 1e-6 && want < a + b - 1e-6) near(dist(E, T), 0, 1e-9, 'reaches the target');
    else assert.ok(dist(E, T) < Math.max(0, want - (a + b), Math.abs(a - b) - want) + 1e-6, 'clamped along the line');
    // the joint sits on the pole's side of the root-target line
    const u = T.map((v, j) => (v - S[j]) / want);
    const pd = pole.map((v, j) => v - u[j] * (pole[0] * u[0] + pole[1] * u[1] + pole[2] * u[2]));
    const off = J.map((v, j) => v - S[j]);
    const offPerp = off.map((v, j) => v - u[j] * (off[0] * u[0] + off[1] * u[1] + off[2] * u[2]));
    if (Math.hypot(...pd) > 1e-3 && Math.hypot(...offPerp) > 1e-6) assert.ok(offPerp[0] * pd[0] + offPerp[1] * pd[1] + offPerp[2] * pd[2] > 0, 'bends toward the pole');
  }
  const pure = solveTwoBone([0, 1, 0], [0.2, 0.7, -0.3], 0.3, 0.28, [1, -1, 0]);
  assert.deepStrictEqual(pure, solveTwoBone([0, 1, 0], [0.2, 0.7, -0.3], 0.3, 0.28, [1, -1, 0]));
});

check('guarded arm solve: the plain solve when clear, else the elbow swings up just enough to clear', () => {
  const S = [0, 1.4, 0], T = [0.25, 1.38, -0.12], pole = [1, -1, 0.2];
  const plain = solveTwoBone(S, T, 0.3, 0.28, pole);
  const free = solveArm(S, T, 0.3, 0.28, pole, () => 0);
  for (const key of ['joint', 'end']) free[key].forEach((v, i) => near(v, plain[key][i], 1e-12, `nothing in the way: same ${key}`));
  // a floor at y 1.25 under everything: the plain elbow dips to about 1.17, the guarded one sits on the floor
  const floor = 1.25;
  const dip = (pts) => Math.max(0, ...pts.map((p) => floor - p[1]));
  assert.ok(plain.joint[1] < floor - 0.05, `plain elbow ${plain.joint[1]}`);
  const g = solveArm(S, T, 0.3, 0.28, pole, dip);
  const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  near(dist(S, g.joint), 0.3, 1e-9, 'upper bone kept');
  near(dist(g.joint, g.end), 0.28, 1e-9, 'lower bone kept');
  near(dist(g.end, T), 0, 1e-9, 'hand still on its target');
  assert.ok(g.joint[1] >= floor - 1e-5 && g.joint[1] < floor + 1e-3, `guarded elbow ${g.joint[1]}: clear, and only just`);
  assert.deepStrictEqual(solveArm(S, T, 0.3, 0.28, pole, dip), g, 'pure');
});

check('scrambled order equals ascending order, and a fresh build agrees', () => {
  const a = make();
  const asc = [...new Set(TIMES)].sort((x, y) => x - y);
  const ref = new Map();
  for (const t of asc) { a.at(t); ref.set(t, snapshot(a.scene)); }
  const rnd = mulberry32(20261021);
  const order = [...asc];
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  assert.notDeepEqual(order, asc);
  for (const t of order) { a.at(t); assert.deepStrictEqual(snapshot(a.scene), ref.get(t), `state at ${t} depends on call order`); }
  const b = make();
  for (const t of [...order].reverse()) { b.at(t); assert.deepStrictEqual(snapshot(b.scene), ref.get(t), `fresh build differs at ${t}`); }
  // the camera argument has no effect: the whole sweep again on a third build, with a different camera, and with none,
  // in another order; this covers the moving times (getting out of the car, walks at 50, the turn onto the rail at
  // 62.7, the lighter)
  const other = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  other.position.set(9, 9, 9);
  other.lookAt(5, 1, -11);
  other.updateMatrixWorld(true);
  const c = make();
  const order2 = [...asc];
  const rnd2 = mulberry32(7);
  for (let i = order2.length - 1; i > 0; i--) { const j = Math.floor(rnd2() * (i + 1)); [order2[i], order2[j]] = [order2[j], order2[i]]; }
  order2.forEach((t, i) => {
    c.people.update(t, i % 2 ? other : undefined);
    c.scene.updateMatrixWorld(true);
    assert.deepStrictEqual(snapshot(c.scene), ref.get(t), `the camera changes the state at ${t}`);
  });
  for (const t of [...IDS.flatMap((id) => [KEYS[id][0].t, exitKey(id).t]), 50, 62.7, LIGHTER.t0]) assert.ok(TIMES.includes(t), `${t} is in the sweep`);
  if (OUT) {
    mkdirSync(OUT, { recursive: true });
    const pick = [20, 30.5, 33, 50, 70, 80, 90].map((t) => ({ t, state: ref.get(t)?.map(({ mw, ...r }) => r) }));
    writeFileSync(join(OUT, 'snapshots.json'), JSON.stringify({ times: asc.length, pick }, null, 1));
  }
});

check('source rules: no clocks, no Math.random, no timers, no em or en dashes', () => {
  const dashes = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);
  for (const rel of ['src/actors/people.js', 'tests/people.test.mjs']) {
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
