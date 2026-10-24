// Checks for src/set/build.js. Run from the project root: node tests/set.test.mjs
// Builds the grey set into a bare THREE.Scene (no renderer), checks it against src/set.js, and proves update(t, camera)
// is a pure function of t and the camera by comparing a scrambled-order run with an ascending one.
// Expected values are written out here or recomputed from set.js, never taken from the module under test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { CONFIG } from '../src/config.js';
import { mulberry32, hashString } from '../src/prng.js';
import { STREET, CROSS, BRIDGE, LAMP, MOON, BUILDINGS, CITY } from '../src/set.js';
import { moonAt, T_TOTAL, FPS, PEOPLE_KEYS } from '../src/world.js';
import { SHOTS, shotAt } from '../src/shots.js';
import { applyShotCamera } from '../src/timeline.js';
import { makePoser, bodyToWorld } from '../src/actors/people.js';
import { buildSet, DIMS, BRIDGE_EYE, cityHaze, streetFaces, aircraftOn } from '../src/set/build.js';

const EPS = 1e-6;
const D2R = Math.PI / 180;
const W = CONFIG.res.w, H = CONFIG.res.h;

// the same ctx main.js builds
function build() {
  const scene = new THREE.Scene();
  const ctx = { THREE, scene, config: CONFIG, rngFor: (name) => mulberry32((CONFIG.seed ^ hashString(name)) >>> 0) };
  const part = buildSet(ctx);
  scene.updateMatrixWorld(true);
  return { scene, part };
}
const get = (scene, name) => {
  const o = scene.getObjectByName(name);
  assert.ok(o, `missing object ${name}`);
  return o;
};
const bbox = (o) => { o.updateWorldMatrix(true, true); return new THREE.Box3().setFromObject(o); };
const near = (a, b, msg, eps = EPS) => assert.ok(Math.abs(a - b) <= eps, `${msg}: got ${a}, want ${b}`);
function extents(o, [x0, x1], [y0, y1], [z0, z1], label) {
  const b = bbox(o);
  near(b.min.x, Math.min(x0, x1), `${label} min.x`); near(b.max.x, Math.max(x0, x1), `${label} max.x`);
  near(b.min.y, Math.min(y0, y1), `${label} min.y`); near(b.max.y, Math.max(y0, y1), `${label} max.y`);
  near(b.min.z, Math.min(z0, z1), `${label} min.z`); near(b.max.z, Math.max(z0, z1), `${label} max.z`);
}
// a camera exactly as main.js sets it up (near 0.05, far 3000), placed by the shot table
const camAt = (t, cam = new THREE.PerspectiveCamera(37.8, W / H, 0.05, 3000)) => { applyShotCamera(cam, shotAt(t), t, W / H); return cam; };
const shotCam = (shot, t) => { const cam = new THREE.PerspectiveCamera(37.8, W / H, 0.05, 3000); applyShotCamera(cam, shot, t, W / H); return cam; };

test('bridge: deck top at 0, parapet inner face at 5.55 and top at BRIDGE.parapetTop, full length', () => {
  const { scene } = build();
  // The parapet top is a staging value (set.js lowered it from 1.30 to 1.15 so the pair rest their forearms on it, and
  // LEAN.handY follows it), so it is read from set.js; the plan view of the bridge is written out.
  const top = BRIDGE.parapetTop;
  extents(get(scene, 'deck'), [-6, 6], [-DIMS.deckThick, 0], [-38, -8], 'deck');
  extents(get(scene, 'parapet:east'), [5.55, 6.0], [0, top], [-38, -8], 'east parapet');
  extents(get(scene, 'parapet:west'), [-6.0, -5.55], [0, top], [-38, -8], 'west parapet');
  // the written-out plan numbers recomputed from set.js, so a data change cannot silently pass
  near(bbox(get(scene, 'parapet:east')).min.x, BRIDGE.halfWidth - BRIDGE.parapetThick, 'inner face from set.js');
  near(bbox(get(scene, 'parapet:west')).max.x, -(BRIDGE.halfWidth - BRIDGE.parapetThick), 'west inner face from set.js');
  near(bbox(get(scene, 'deck')).max.z, BRIDGE.z0, 'south abutment from set.js'); near(bbox(get(scene, 'deck')).min.z, BRIDGE.z1, 'north abutment from set.js');
  // Read from the data, the top still has to be a parapet the pair lean their forearms on: at least 1 m (it stops a
  // fall) and below the shoulders of both, measured on the rig standing still half a second before their last stand
  // key (beside the car, before the walk), above their own ground
  for (const id of ['A', 'B']) {
    const t = PEOPLE_KEYS[id].filter((k) => k.pose === 'stand').at(-1).t - 0.5;
    const q = makePoser(id)(t);
    assert.equal(q.pose, 'stand', `${id} stands at ${t}`);
    const shoulder = Math.min(...q.arms.map((a) => bodyToWorld(q, a.shoulder)[1])) - q.y;
    assert.ok(top >= 1.0 && top < shoulder, `parapet top ${top} m is no forearm rest for ${id} (shoulders ${shoulder.toFixed(2)} m)`);
  }
});

test('river: water at -6 between the banks, embankment walls from the water up to 0', () => {
  const { scene } = build();
  const w = bbox(get(scene, 'water'));
  near(w.min.y, -6, 'water min.y'); near(w.max.y, -6, 'water max.y');
  near(w.min.z, -38, 'water z1'); near(w.max.z, -8, 'water z0');
  assert.ok(w.min.x <= -1000 && w.max.x >= 1000, 'water is very wide in x');
  for (const [name, z, facing] of [['wall:south', -8, -1], ['wall:north', -38, 1]]) {
    const o = get(scene, name);
    const b = bbox(o);
    near(b.min.y, -6, `${name} bottom`); near(b.max.y, 0, `${name} top`);
    near(b.min.z, z, `${name} z`); near(b.max.z, z, `${name} z`);
    assert.ok(b.min.x <= -1000 && b.max.x >= 1000, `${name} spans the whole x range`);
    // a plane's front is its +Z; each wall must face the river
    const n = new THREE.Vector3(0, 0, 1).applyQuaternion(o.getWorldQuaternion(new THREE.Quaternion()));
    near(n.z, facing, `${name} faces the river`);
  }
});

test('ground: land planes, roads a few mm up, sidewalks curb-high and broken at the cross street', () => {
  const { scene } = build();
  const south = bbox(get(scene, 'land:south')), north = bbox(get(scene, 'land:north'));
  near(south.min.z, -8, 'south land starts at the south abutment'); near(south.max.y, 0, 'south land y');
  near(north.max.z, -38, 'north land starts at the north abutment'); near(north.max.y, 0, 'north land y');
  // a plane's front is its +Z; land, water and roads must face up or they are culled from above
  // the land is cut around the roads: its pieces must not run under any road (that z-fights from a low camera)
  const pieces = [];
  for (const name of ['land:south', 'land:north']) get(scene, name).children.forEach((m) => pieces.push(m));
  assert.ok(pieces.length >= 6, 'the land is in pieces');
  for (const road of ['road:street', 'road:cross:west', 'road:cross:east', 'road:north']) {
    const r = bbox(get(scene, road));
    for (const m of pieces) {
      const b = bbox(m);
      const ox = Math.min(b.max.x, r.max.x) - Math.max(b.min.x, r.min.x), oz = Math.min(b.max.z, r.max.z) - Math.max(b.min.z, r.min.z);
      assert.ok(ox <= 1e-9 || oz <= 1e-9, `${m.name} runs under ${road}`);
    }
  }
  // and together the pieces and roads cover the ground: sample points off the bridge all land on exactly one surface
  const surfaces = [...pieces, ...['road:street', 'road:cross:west', 'road:cross:east', 'road:north'].map((n) => get(scene, n))].map((m) => bbox(m));
  for (const [x, z] of [[0, 0], [0, 20], [20, 20], [-20, 20], [10, 5], [-10, 5], [0, 100], [100, 100], [-100, -100], [0, -100], [0, -400], [3, 60], [-3.5, 30]]) {
    const n = surfaces.filter((b) => x >= b.min.x - 1e-9 && x <= b.max.x + 1e-9 && z >= b.min.z - 1e-9 && z <= b.max.z + 1e-9).length;
    assert.ok(n >= 1, `no ground at (${x}, ${z})`);
  }
  for (const m of pieces) {
    const n = new THREE.Vector3(0, 0, 1).applyQuaternion(m.getWorldQuaternion(new THREE.Quaternion()));
    near(n.y, 1, `${m.name} faces up`, 1e-9);
  }
  for (const name of ['water', 'road:street', 'road:cross:west', 'road:cross:east', 'road:north']) {
    const n = new THREE.Vector3(0, 0, 1).applyQuaternion(get(scene, name).getWorldQuaternion(new THREE.Quaternion()));
    near(n.y, 1, `${name} faces up`, 1e-9);
  }
  for (const name of ['road:street', 'road:cross:west', 'road:cross:east', 'road:north']) {
    const y = bbox(get(scene, name)).max.y;
    assert.ok(y > 0.001 && y < 0.01, `${name} sits a few mm above the land, got ${y}`);
  }
  extents(get(scene, 'road:street'), [-3.5, 3.5], [DIMS.roadLift, DIMS.roadLift], [-8, STREET.zSouth], 'street road');
  extents(get(scene, 'road:cross:east'), [3.5, CROSS.xExtent], [DIMS.roadLift, DIMS.roadLift], [15, 25], 'cross east');
  extents(get(scene, 'road:cross:west'), [-CROSS.xExtent, -3.5], [DIMS.roadLift, DIMS.roadLift], [15, 25], 'cross west');
  const nr = bbox(get(scene, 'road:north'));
  near(nr.min.x, -6, 'north road west edge'); near(nr.max.x, 6, 'north road east edge'); near(nr.max.z, -38, 'north road start');
  assert.ok(nr.min.z <= -38 - 200, 'north road runs a few hundred meters');
  for (const [side, xs] of [['east', [3.5, 6.0]], ['west', [-6.0, -3.5]]]) {
    extents(get(scene, `sidewalk:${side}:north`), xs, [0, 0.15], [-8, 15], `${side} sidewalk north`);
    extents(get(scene, `sidewalk:${side}:south`), xs, [0, 0.15], [25, 70], `${side} sidewalk south`);
  }
});

// The longest world-axis span of any one triangle of a mesh, in meters.
function longestTriangleSpan(m) {
  m.updateWorldMatrix(true, false);
  const g = m.geometry, pos = g.getAttribute('position');
  const idx = g.index ? g.index.array : Array.from({ length: pos.count }, (_, i) => i);
  const v = (i) => new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(m.matrixWorld);
  let worst = 0;
  for (let k = 0; k < idx.length; k += 3) {
    const tri = [v(idx[k]), v(idx[k + 1]), v(idx[k + 2])];
    for (const ax of ['x', 'y', 'z']) worst = Math.max(worst, Math.max(...tri.map((p) => p[ax])) - Math.min(...tri.map((p) => p[ax])));
  }
  return worst;
}

// A 5 km triangle seen nearly edge-on gets its depth wrong (the fogged embankment wall drew over the parapet in shot 13),
// so the big planes are cut into pieces no more than 100 m along any axis. Written out here, not read from build.js.
const MAX_TRIANGLE_SPAN = 100;

test('ground: the big planes are subdivided, no triangle spans more than 100 m along an axis', () => {
  const { scene } = build();
  // planted control: the same embankment wall as one quad fails the measure, and cut every 100 m it passes
  const whole = new THREE.Mesh(new THREE.PlaneGeometry(2 * DIMS.far, -BRIDGE.waterY));
  const cut = new THREE.Mesh(new THREE.PlaneGeometry(2 * DIMS.far, -BRIDGE.waterY, Math.ceil((2 * DIMS.far) / MAX_TRIANGLE_SPAN), 1));
  assert.ok(longestTriangleSpan(whole) > MAX_TRIANGLE_SPAN, 'the control: an uncut wall is caught');
  assert.ok(longestTriangleSpan(cut) <= MAX_TRIANGLE_SPAN + 1e-6, 'the control: a cut wall passes');
  let checked = 0;
  scene.traverse((o) => {
    if (!o.isMesh) return;
    checked++;
    const span = longestTriangleSpan(o);
    assert.ok(span <= MAX_TRIANGLE_SPAN + 1e-3, `${o.name} has a triangle ${span.toFixed(2)} m long`); // 1 mm: float32 vertices
  });
  assert.ok(checked > 50, `checked ${checked} meshes`);
  // the planes that used to be one quad each are the ones that had to be cut: each now has many triangles
  for (const name of ['water', 'wall:south', 'wall:north', 'road:north']) {
    const g = get(scene, name).geometry;
    assert.ok(g.index.count / 3 > 2, `${name} is subdivided`);
  }
});

test('buildings: one box per BUILDINGS entry with the right extents, corner in its own grey', () => {
  const { scene, part } = build();
  const meshes = [];
  scene.traverse((o) => { if (o.name.startsWith('building:')) meshes.push(o); });
  assert.equal(meshes.length, BUILDINGS.length);
  for (const b of BUILDINGS) {
    const m = get(scene, `building:${b.id}`);
    extents(m, [b.x0, b.x1], [0, b.h], [b.z0, b.z1], b.id);
    assert.equal(m.material, b.corner ? part.materials.corner : part.materials.building, `${b.id} material`);
  }
  assert.notEqual(part.materials.corner.color.getHex(), part.materials.building.color.getHex());
});

// Street faces worked out by hand from set.js: a facade on the building line (x +/-6.2) faces the bridge street, one
// on z 15 or z 25 faces the cross street. Written out so a wrong rule in the module cannot pass.
const STREET_FACES = {
  E1: ['west', 'south'], E2: ['west'], E3: ['south'],
  W1: ['east', 'south'], W2: ['east'], W3: ['south'],
  SE: ['west', 'north'], SE2: ['north'], SW: ['east', 'north'], SW2: ['north'], SE3: ['west'], SW3: ['east'],
};

test('buildings: two or three warm windows each, on hand-listed street faces, just outside the facade', () => {
  const { scene } = build();
  assert.deepEqual(Object.keys(STREET_FACES).sort(), BUILDINGS.map((b) => b.id).sort(), 'the table covers every building');
  const info = get(scene, 'windows').userData.windows;
  for (const b of BUILDINGS) {
    assert.deepEqual([...streetFaces(b)].sort(), [...STREET_FACES[b.id]].sort(), `${b.id} street faces`);
    const mine = info.filter((w) => w.id === b.id);
    assert.ok(mine.length >= 2 && mine.length <= 3, `${b.id} has ${mine.length} windows`);
    for (const w of mine) {
      assert.ok(STREET_FACES[b.id].includes(w.face), `${b.id} window on ${w.face}, street faces ${STREET_FACES[b.id]}`);
      const [x, y, z] = w.center;
      // on the outward side of that face, by 1 to 10 cm
      const off = { west: b.x0 - x, east: x - b.x1, north: b.z0 - z, south: z - b.z1 }[w.face];
      assert.ok(off > 0.01 && off < 0.1, `${b.id} window stands ${off} m off the wall`);
      // and over a street: the bridge street between the building lines, or the cross street between z 15 and 25
      if (w.face === 'west' || w.face === 'east') assert.ok(Math.abs(x) < STREET.buildingLine, `${b.id} window looks onto the street, x ${x}`);
      else assert.ok(z > CROSS.z0 && z < CROSS.z1, `${b.id} window looks onto the cross street, z ${z}`);
      assert.ok(y - DIMS.window.h / 2 > 0 && y + DIMS.window.h / 2 < b.h, `${b.id} window inside the wall height`);
      if (w.face === 'west' || w.face === 'east') assert.ok(z - DIMS.window.w / 2 >= b.z0 && z + DIMS.window.w / 2 <= b.z1, `${b.id} window inside the wall`);
      else assert.ok(x - DIMS.window.w / 2 >= b.x0 && x + DIMS.window.w / 2 <= b.x1, `${b.id} window inside the wall`);
    }
  }
  assert.equal(get(scene, 'windows').geometry.index.count, info.length * 6, 'two triangles per window');
  // both triangles of every quad wind counter-clockwise seen from outside, so front faces point away from the wall
  const outward = { west: [-1, 0, 0], east: [1, 0, 0], north: [0, 0, -1], south: [0, 0, 1] };
  for (const mesh of ['windows', 'city-windows']) {
    const g = get(scene, mesh).geometry, pos = g.getAttribute('position'), idx = g.index.array;
    const list = get(scene, mesh).userData.windows;
    const v = (i) => new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
    for (let k = 0; k < idx.length; k += 3) {
      const a = v(idx[k]), b = v(idx[k + 1]), c = v(idx[k + 2]);
      const n = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
      const want = outward[list[Math.floor(k / 6)].face];
      near(n.dot(new THREE.Vector3(...want)), 1, `${mesh} quad ${Math.floor(k / 6)} faces out`, 1e-6);
    }
  }
});

test('city: one box per CITY entry with the right extents, out of the fog, hazed by distance', () => {
  const { scene, part } = build();
  const meshes = [];
  scene.traverse((o) => { if (o.name.startsWith('city:')) meshes.push(o); });
  assert.equal(meshes.length, CITY.length);
  const fog = new THREE.Color(CONFIG.fog.color);
  CITY.forEach((b) => {
    const m = get(scene, `city:${b.id}`);
    extents(m, [b.x0, b.x1], [0, b.h], [b.z0, b.z1], b.id);
    assert.equal(m.material.fog, false, `${b.id} opts out of scene fog`);
    const d = Math.hypot((b.x0 + b.x1) / 2 - 5.25, (b.z0 + b.z1) / 2 + 10.65);
    const f = 1 - Math.exp(-((d * 0.004) ** 2));
    near(m.userData.haze, f, `${b.id} haze`, 1e-12);
    near(m.material.emissive.r, fog.r * f, `${b.id} emissive is fog colour times haze`, 1e-6);
    near(m.material.emissive.b, fog.b * f, `${b.id} emissive blue`, 1e-6);
  });
  near(BRIDGE_EYE[0], 5.25, 'haze origin x'); near(BRIDGE_EYE[2], -10.65, 'haze origin z');
  // the far city is hazier than the near city
  const byD = [...CITY].sort((a, b) => a.x0 - b.x0);
  assert.ok(get(scene, `city:${byD[0].id}`).userData.haze < get(scene, `city:${byD[byD.length - 1].id}`).userData.haze);
  assert.equal(part.materials.cityWindow.fog, false);
  assert.equal(part.materials.aircraft.fog, false);
});

test('city: window grid on west and river faces, tinted toward the fog colour, standoff growing with distance', () => {
  const { scene, part } = build();
  const info = get(scene, 'city-windows').userData.windows;
  assert.ok(info.length > 100 && info.length < 3000, `a sparse grid, got ${info.length}`);
  const byId = Object.fromEntries(CITY.map((b) => [b.id, b]));
  let nearest = Infinity, farthest = 0;
  for (const w of info) {
    const b = byId[w.id];
    const river = b.z0 >= BRIDGE.z0 ? 'north' : 'south';
    assert.ok(w.face === 'west' || w.face === river, `${w.id} window on ${w.face}`);
    near(w.haze, cityHaze(w.center[0], w.center[2]), 'window haze', 1e-12);
    // standoff: max(0.05, 0.0013 * distance of the wall point from the railing), so about 0.6 m at 450 m and a few cm
    // on the near city, where a big standoff slid windows off their own box on screen
    const [x, , z] = w.center;
    const off = { west: b.x0 - x, north: b.z0 - z, south: z - b.z1 }[w.face];
    const wall = w.face === 'west' ? [b.x0, z] : [x, w.face === 'north' ? b.z0 : b.z1];
    const d = Math.hypot(wall[0] - 5.25, wall[1] + 10.65);
    near(off, Math.max(0.05, 0.0013 * d), `${w.id} ${w.face} window standoff at ${d.toFixed(0)} m`, 1e-9);
    assert.ok(off >= 0.05 - 1e-9 && off <= 0.6, `${w.id} standoff ${off}`);
    if (d < 75) assert.ok(off < 0.1, `${w.id} near window stands ${off} m off`);
    nearest = Math.min(nearest, d); farthest = Math.max(farthest, d);
  }
  assert.ok(nearest < 60 && farthest > 400, `windows from ${nearest} to ${farthest} m`);
  // a few depth steps of offset and no slope factor (see build.js)
  const cw = part.materials.cityWindow;
  assert.equal(cw.polygonOffset, true);
  assert.equal(cw.polygonOffsetFactor, 0);
  assert.ok(cw.polygonOffsetUnits < 0 && cw.polygonOffsetUnits >= -4, `units ${cw.polygonOffsetUnits}`);
  // first box of each bank shows its whole west face; at least one bank gets west-face windows
  assert.ok(info.some((w) => w.face === 'west'));
  assert.ok(info.some((w) => w.face === 'north') && info.some((w) => w.face === 'south'));
  // colour attribute: the farthest window is closer to the fog colour than the nearest
  const col = get(scene, 'city-windows').geometry.getAttribute('color');
  const fog = new THREE.Color(CONFIG.fog.color);
  const dist = (i) => Math.hypot(col.getX(i * 4) - fog.r, col.getY(i * 4) - fog.g, col.getZ(i * 4) - fog.b);
  const order = info.map((w, i) => [w.haze, i]).sort((a, b) => a[0] - b[0]);
  assert.ok(dist(order[order.length - 1][1]) < dist(order[0][1]));
});

test('city: aircraft lights on the roofs of the aircraft boxes, blinking from t alone', () => {
  const { scene, part } = build();
  const towers = CITY.filter((b) => b.aircraft);
  assert.equal(towers.length, 2);
  for (const b of towers) {
    const a = get(scene, `aircraft:${b.id}`);
    near(a.position.y, b.h + DIMS.aircraftRadius, `${b.id} light on the roof`);
    assert.ok(a.position.x > b.x0 && a.position.x < b.x1 && a.position.z > b.z0 && a.position.z < b.z1);
  }
  const cam = new THREE.PerspectiveCamera();
  for (const [t, want] of [[0, true], [0.2, true], [0.25, false], [1.4, true], [1.6, false], [74.9, true], [75, false], [75.3, false]]) {
    assert.equal(aircraftOn(t), (t * 0.75) % 1 < 0.18);
    part.update(t, cam);
    for (const b of towers) assert.equal(get(scene, `aircraft:${b.id}`).visible, want, `aircraft at t ${t}`);
  }
});

// the lantern's size in its own frame (it is turned about Y in the world)
function localSize(head) {
  const box = new THREE.Box3();
  for (const c of head.children) {
    c.geometry.computeBoundingBox();
    box.union(c.geometry.boundingBox.clone().applyMatrix4(c.matrix));
  }
  return box.getSize(new THREE.Vector3());
}

test('lamp: post at LAMP.base, lantern centred at LAMP.head with a lit bulb inside the glass, no lights in the set', () => {
  const { scene, part } = build();
  const post = get(scene, 'lamp:post');
  near(post.position.x, LAMP.base[0], 'post x'); near(post.position.z, LAMP.base[1], 'post z');
  const pb = bbox(post);
  near(pb.min.y, 0, 'post foot'); near(pb.max.y, 4.3, 'post top');
  near(post.geometry.parameters.radiusTop, 0.08, 'post radius');
  for (const name of ['lamp:head', 'lamp:glass']) {
    const p = get(scene, name).getWorldPosition(new THREE.Vector3());
    near(p.x, LAMP.head[0], `${name} x`); near(p.y, LAMP.head[1], `${name} y`); near(p.z, LAMP.head[2], `${name} z`);
  }
  const head = get(scene, 'lamp:head');
  const size = localSize(head);
  assert.ok(size.y > 0.45 && size.y < 0.6 && size.x > 0.45 && size.x < 0.6 && size.z > 0.45 && size.z < 0.6, `lantern about 0.5 m, got ${size.toArray()}`);
  // the bulb: big enough to read, wholly inside the glass, centred on the lantern's axis
  const bulb = get(scene, 'lamp:bulb'), glass = get(scene, 'lamp:glass');
  const r = bulb.geometry.parameters.radius, g = glass.geometry.parameters;
  assert.ok(r >= 0.1 && r <= 0.15, `bulb radius ${r}`);
  near(bulb.position.x, 0, 'bulb on the axis'); near(bulb.position.z, 0, 'bulb on the axis');
  assert.ok(Math.abs(bulb.position.y) + r <= g.height / 2 && r <= g.width / 2, 'bulb inside the glass');
  // colours, and draw order: the panes are nearly opaque, so the bulb must draw after them to show through
  assert.equal(bulb.material.color.getHexString(), 'ffb46b');
  assert.ok(glass.material.transparent && glass.material.opacity >= 0.8 && glass.material.depthWrite === false, 'glass glows');
  assert.ok(bulb.material.transparent && bulb.material.opacity === 1 && bulb.renderOrder > glass.renderOrder, 'bulb drawn after the glass');
  for (const m of [bulb.material, glass.material]) assert.equal(m.fog, false, 'the lit lantern keeps its colour in the fog');
  for (const m of [bulb.material, glass.material]) assert.ok(Object.values(part.materials).includes(m));
  // the arm reaches from the post toward the street, over to the lantern
  const arm = bbox(get(scene, 'lamp:arm'));
  assert.ok(arm.min.x <= LAMP.head[0] + EPS && arm.max.x >= LAMP.base[0] - EPS, 'arm spans post to lantern');
  let lights = 0;
  scene.traverse((o) => { if (o.isLight) lights++; });
  assert.equal(lights, 0);
});

// Share of the bulb's silhouette disc that a camera sees, by raycasting samples against every opaque mesh in the set,
// and the bulb's diameter on screen in internal pixels. The glass is the glow itself and the moon is sky: not occluders.
function bulbView(scene, cam) {
  const bulb = scene.getObjectByName('lamp:bulb');
  const skip = new Set([bulb, scene.getObjectByName('lamp:glass'), scene.getObjectByName('moon')]);
  const blockers = [];
  scene.traverse((o) => { if (o.isMesh && !skip.has(o)) blockers.push(o); });
  const c = bulb.getWorldPosition(new THREE.Vector3()), r = bulb.geometry.parameters.radius;
  const v = c.clone().project(cam);
  if (v.z > 1 || Math.abs(v.x) > 1 || Math.abs(v.y) > 1) return null;
  const toCam = cam.position.clone().sub(c).normalize();
  const a = new THREE.Vector3(0, 1, 0).cross(toCam).normalize(), b = toCam.clone().cross(a);
  const ray = new THREE.Raycaster();
  let n = 0, seen = 0;
  for (let i = -8; i <= 8; i++) for (let j = -8; j <= 8; j++) {
    if (i * i + j * j > 64) continue;
    const p = c.clone().addScaledVector(a, (i / 8) * r * 0.98).addScaledVector(b, (j / 8) * r * 0.98)
      .addScaledVector(toCam, Math.sqrt(1 - (i * i + j * j) / 64) * r * 0.98);
    const d = p.clone().sub(cam.position), dist = d.length();
    ray.set(cam.position, d.normalize());
    ray.far = dist - 1e-3;
    n++;
    if (!ray.intersectObjects(blockers, false).length) seen++;
  }
  const px = Math.abs(c.clone().addScaledVector(a, r).project(cam).x - v.x) * W;
  return { seen: seen / n, px };
}

test('lamp: the bulb reads in every shot that frames it, most of all in shot 1', () => {
  const { scene, part } = build();
  part.update(4, shotCam(SHOTS[0], 4));
  scene.updateMatrixWorld(true);
  // shot 1 looks up at the lantern from 5.7 m: the bulb is the focal point
  const s1 = bulbView(scene, shotCam(SHOTS[0], 4));
  assert.ok(s1, 'the bulb is in frame in shot 1');
  assert.ok(s1.seen >= 0.8, `shot 1 sees ${(100 * s1.seen).toFixed(0)}% of the bulb`);
  assert.ok(s1.px >= 20, `shot 1 bulb is ${s1.px.toFixed(1)} px across`);
  // every other shot that frames the lamp sees all of it: no frame post or plate in front
  const framed = [];
  for (const s of SHOTS.slice(1)) {
    for (const u of [0.02, 0.5, 0.98]) {
      const t = s.start + (s.end - s.start) * u;
      const view = bulbView(scene, shotCam(s, t));
      if (!view) continue;
      framed.push(s.n);
      assert.ok(view.seen >= 0.95, `shot ${s.n} at t ${t.toFixed(2)} sees ${(100 * view.seen).toFixed(0)}% of the bulb`);
    }
  }
  for (const n of [2, 8, 10, 15]) assert.ok(framed.includes(n), `shot ${n} frames the lamp, so it is checked`);
  // shot 2 is 68 m away: the lit panes still cover a couple of pixels
  const cam2 = shotCam(SHOTS[1], 7.2), c = new THREE.Vector3(...LAMP.head);
  const half = new THREE.Vector3(1, 0, 0).multiplyScalar(DIMS.lantern.glass / 2);
  const span = Math.abs(c.clone().add(half).project(cam2).x - c.clone().sub(half).project(cam2).x) * W / 2;
  assert.ok(span >= 1.5, `shot 2 lantern glow ${span.toFixed(2)} px wide`);
});

test('moon: 900 m from the camera along moonAt(t), facing it, hidden while low', () => {
  const { scene, part } = build();
  const moon = get(scene, 'moon');
  const cam = new THREE.PerspectiveCamera();
  cam.position.set(3.1, 1.6, -9.4);
  part.update(75, cam);
  const m = moonAt(75);
  const az = m.azimuthDeg * D2R, el = m.elevationDeg * D2R;
  const want = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
  const off = moon.position.clone().sub(cam.position);
  near(off.length(), 900, 'distance', 1e-6);
  near(off.clone().normalize().dot(want), 1, 'direction', 1e-12);
  near(m.azimuthDeg, MOON.azimuthDeg, 'azimuth from set.js');
  assert.ok(m.elevationDeg > 4 && m.elevationDeg < 5.5, `elevation at 75 is ${m.elevationDeg}`);
  assert.equal(moon.visible, true, 'visible at 75');
  moon.updateMatrixWorld(true);
  const front = new THREE.Vector3(0, 0, 1).applyQuaternion(moon.getWorldQuaternion(new THREE.Quaternion()));
  near(front.dot(off.clone().normalize().negate()), 1, 'disc faces the camera', 1e-9);
  near(moon.geometry.parameters.radius, 900 * Math.tan(MOON.angularRadiusDeg * D2R), 'angular radius', 1e-9);
  assert.equal(moon.material.fog, false);
  assert.equal(moon.material.depthWrite, false);
  assert.ok(moon.renderOrder < 0);
  part.update(10, cam);
  assert.equal(moon.visible, false, 'hidden at 10');
  part.update(66, cam);
  assert.equal(moon.visible, true, 'at -1.2 degrees it is partly up and shown');
  part.update(62, cam);
  assert.equal(moon.visible, false, 'at -3.3 degrees it is hidden');
});

test('stars: a few hundred seeded points, centred on the camera, dim, out of the fog', () => {
  const { scene, part } = build();
  const stars = get(scene, 'stars');
  const n = stars.geometry.getAttribute('position').count;
  assert.ok(n >= 200 && n <= 600, `star count ${n}`);
  const cam = new THREE.PerspectiveCamera();
  cam.position.set(-19, 2.5, -7.9);
  part.update(70, cam);
  assert.deepEqual(stars.position.toArray(), [-19, 2.5, -7.9]);
  assert.equal(part.materials.star.fog, false);
  assert.equal(part.materials.star.sizeAttenuation, false);
  const col = stars.geometry.getAttribute('color');
  for (let i = 0; i < n; i++) assert.ok(Math.max(col.getX(i), col.getY(i), col.getZ(i)) <= 0.55, 'dim');
  const pos = stars.geometry.getAttribute('position');
  for (let i = 0; i < n; i++) assert.ok(pos.getY(i) > 0, 'above the horizon');
});

// Surfaces that meet on screen somewhere in the film, worked out from set.js: the roads on the land, the sidewalks
// between road and land, the deck meeting the roads and the land at the abutments, the parapets over the land, the
// sidewalk and the water, the embankment walls between land, water and deck, and the buildings standing on the land
// and the roads beside each other (the corner building SE shares its east wall with SE2).
const MEETS = [
  ['land', 'road'], ['land', 'sidewalk'], ['road', 'sidewalk'],
  ['deck', 'parapet'], ['deck', 'road'], ['deck', 'land'], ['parapet', 'land'], ['parapet', 'sidewalk'], ['parapet', 'water'],
  ['wall', 'water'], ['wall', 'land'], ['wall', 'deck'],
  ['building', 'land'], ['building', 'sidewalk'], ['building', 'road'], ['building', 'corner'],
  ['corner', 'land'], ['corner', 'road'], ['corner', 'sidewalk'],
];

test('materials: one Lambert grey per surface; surfaces that meet differ by 25% in luminance; corner dark and warm', () => {
  const { part } = build();
  const M = part.materials;
  const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; // three keeps colours linear, so this is luminance
  const keys = ['land', 'road', 'sidewalk', 'deck', 'parapet', 'wall', 'building', 'corner', 'water'];
  for (const k of keys) assert.ok(M[k].isMeshLambertMaterial, `${k} is Lambert`);
  for (const [a, b] of MEETS) {
    const [lo, hi] = [lum(M[a].color), lum(M[b].color)].sort((x, y) => x - y);
    assert.ok(hi / lo >= 1.25, `${a} and ${b} meet on screen but are too close: ${lum(M[a].color)} vs ${lum(M[b].color)}`);
  }
  // shot 2: 'the corner building is the dark mass at right'. No brighter than the other buildings, and warmer in hue
  const corner = M.corner.color, bld = M.building.color;
  assert.ok(lum(corner) <= lum(bld), `corner ${lum(corner)} brighter than buildings ${lum(bld)}`);
  assert.ok(corner.r > corner.b && bld.b > bld.r, 'the corner is warm, the other buildings cool');
  assert.equal(M.city.length, CITY.length);
  for (const m of M.city) assert.ok(m.isMeshLambertMaterial && m.fog === false);
});

test('materials: every material and geometry in the set is made once, at build', () => {
  const { scene, part } = build();
  const known = new Set(Object.values(part.materials).flat());
  const used = new Set();
  scene.traverse((o) => { if (o.material) used.add(o.material); });
  assert.ok(used.size > 10);
  for (const m of used) assert.ok(known.has(m), `${m.type} ${m.name} on an object is not in the materials object`);
});

// every field update(t, camera) could touch, for every object in the set
function snapshot(root) {
  const out = [];
  root.traverse((o) => {
    const m = o.material;
    out.push({
      name: o.name,
      p: o.position.toArray(), q: o.quaternion.toArray(), s: o.scale.toArray(), v: o.visible, ro: o.renderOrder,
      i: o.isLight ? o.intensity : null,
      m: m ? { c: m.color?.toArray(), e: m.emissive?.toArray(), ei: m.emissiveIntensity, o: m.opacity, v: m.visible, u: m.uniforms ? JSON.stringify(m.uniforms) : null } : null,
    });
  });
  return out;
}
// the objects themselves, and the material and geometry each one holds
function identities(root) {
  const out = [];
  root.traverse((o) => out.push([o, o.material, o.geometry]));
  return out;
}
function sameObjects(now, then, msg) {
  assert.equal(now.length, then.length, `${msg}: object count changed`);
  now.forEach(([o, m, g], i) => {
    assert.ok(o === then[i][0], `${msg}: object ${i} replaced`);
    assert.ok(m === then[i][1], `${msg}: ${o.name} got a new material`);
    assert.ok(g === then[i][2], `${msg}: ${o.name} got a new geometry`);
  });
}

test('update(t, camera) is a pure function: scrambled order equals ascending order', () => {
  const { part } = build();
  const materials = { ...part.materials };
  const ids = identities(part.root);
  const times = new Set([0, 10, 62, 62.5, 63, 66, 68, 68.3, 75, 75.3, 1.4, 1.6, T_TOTAL - 1e-6]);
  for (const s of SHOTS) for (const u of [0, 0.5, 0.999]) times.add(s.start + (s.end - s.start) * u);
  for (let f = 0; f < 48; f++) times.add(66 + f / FPS); // two seconds of frames across the moonrise threshold
  const asc = [...times].sort((a, b) => a - b);
  const want = new Map();
  for (const t of asc) {
    part.update(t, camAt(t));
    want.set(t, snapshot(part.root));
    sameObjects(identities(part.root), ids, `ascending t ${t}`);
  }

  // a seeded shuffle, each time visited twice, with a fresh camera object each call
  const rnd = mulberry32(99);
  const scrambled = [...asc, ...asc].map((t) => [rnd(), t]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
  assert.notDeepEqual(scrambled.slice(0, asc.length), asc);
  for (const t of scrambled) {
    part.update(t, camAt(t));
    assert.deepStrictEqual(snapshot(part.root), want.get(t), `state at t ${t} depends on call order`);
    sameObjects(identities(part.root), ids, `scrambled t ${t}`);
  }
  for (const [k, m] of Object.entries(materials)) assert.ok(part.materials[k] === m, `materials.${k} replaced`);
  // and a second build gives the same state, so build-time randomness is seeded
  const again = build().part;
  for (const t of [7.2, 75, 101]) {
    again.update(t, camAt(t));
    part.update(t, camAt(t));
    assert.deepStrictEqual(snapshot(again.root), snapshot(part.root), `second build differs at ${t}`);
  }
  // the moon stays 900 m from every shot camera
  for (const t of asc) {
    const cam = camAt(t);
    part.update(t, cam);
    near(part.root.getObjectByName('moon').position.distanceTo(cam.position), 900, `moon distance at ${t}`, 1e-6);
  }
});

test('build is deterministic: two builds give identical geometry', () => {
  const a = build().scene, b = build().scene;
  for (const name of ['windows', 'city-windows', 'stars']) {
    for (const attr of ['position', 'color']) {
      const x = a.getObjectByName(name).geometry.getAttribute(attr).array;
      const y = b.getObjectByName(name).geometry.getAttribute(attr).array;
      assert.deepStrictEqual(Array.from(x), Array.from(y), `${name} ${attr}`);
    }
  }
});

// built from code points so this file never holds the characters it looks for
const DASH = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);

test('source rules: no clocks, no unseeded randomness, no lights, no dashes', () => {
  const src = readFileSync(new URL('../src/set/build.js', import.meta.url), 'utf8');
  for (const bad of ['Math.random', 'Date.now', 'performance.now', 'new Date(', 'setTimeout', 'setInterval', 'requestAnimationFrame', 'Light(']) {
    assert.ok(!src.includes(bad), `src/set/build.js contains ${bad}`);
  }
  assert.ok(!DASH.test(src), 'src/set/build.js contains an en or em dash');
  const self = readFileSync(new URL(import.meta.url), 'utf8');
  assert.ok(!DASH.test(self), 'this test contains an en or em dash');
});
