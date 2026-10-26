// The car: an older low-poly sedan at blockout level. Placement, heading and timing come from world.js only.
// Built facing -Z (north), so rotation.y = -heading. Local axes: forward is -Z and right is +X, so the driver
// side (left) is -X. A forward offset f sits at local z = -f.
// Hierarchy: root (ground position, heading, visibility) holds the wheels and the blob shadow, which stay on the
// ground; body (idle shake, settle pitch) holds the shell, cabin, doors and lenses.
import { carAt, headlights, carTimes, CAR } from '../world.js';

const D2R = Math.PI / 180;
const clamp01 = (u) => Math.min(1, Math.max(0, u));
const smooth = (u) => { u = clamp01(u); return u * u * (3 - 2 * u); };

export const SHAPE = {
  body: { y0: 0.25, y1: 0.9 },
  cabin: { length: 2.4, width: 1.6, y0: 0.9, y1: CAR.height, back: 0.3 },
  wheel: { radius: 0.33, width: 0.22, forward: 1.45, side: 0.82, segments: 12 },
  // hinge at the front edge (forward 0.95), door runs back to forward -0.15; outer skin 5 cm proud of the shell
  door: { front: 0.95, back: -0.15, thick: 0.06, height: 0.75, y0: 0.3, side: 0.92, maxDeg: 70 },
  headlamp: { side: 0.65, y: 0.7, w: 0.3, h: 0.18, d: 0.04 },
  taillight: { side: 0.65, y: 0.72, w: 0.32, h: 0.12, d: 0.04 },
  shadow: { length: 2.6, width: 1.25, y: 0.02, inner: 0.65, segments: 24 },
};

// Door times (eased in and out) come from carTimes.doors in world.js, beside the people's keys that step clear of them.
export const DOOR_SIDE = { driver: -1, passenger: 1 }; // the driver sits on the left, which is -X
export const STEER_MAX_DEG = 30; // right turn
export const SETTLE = { dur: 0.7, pitchDeg: 1.5 };
// Idle shake in meters. Non-integer frequencies well clear of multiples of 24 Hz, so 24 fps sampling never freezes it.
export const IDLE = [
  { amp: 0.0016, hz: 13.7, phase: 0.0 },
  { amp: 0.0011, hz: 19.3, phase: 1.1 },
  { amp: 0.0007, hz: 31.1, phase: 2.3 },
];
const TABLE_RATE = 240; // distance table samples per second

// Every material the car uses, in one place, so Stage 4 can swap them for the PS1 patch.
function makeMaterials(THREE, config) {
  const lambert = (color) => new THREE.MeshLambertMaterial({ color });
  return {
    shell: lambert('#1d2a24'),
    door: lambert('#26372e'), // a step lighter than the shell so the doors read as separate pieces
    cabin: lambert('#111a17'),
    tyre: lambert('#141414'),
    hub: lambert('#5c6166'), // a light bar across each wheel, so the spin reads in grey-box
    headlamp: new THREE.MeshBasicMaterial({ color: config.lights.headlight.color }),
    taillight: new THREE.MeshBasicMaterial({ color: '#ff2a12' }),
    shadow: new THREE.MeshBasicMaterial({
      color: '#000000', transparent: true, opacity: 0.6, depthWrite: false, vertexColors: true,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4,
    }),
  };
}

// Flat ellipse on the ground: solid out to `inner` of the radius, then vertex alpha fades to clear at the rim.
function blobGeometry(THREE, s) {
  const n = s.segments;
  const pos = [0, 0, 0];
  const col = [0, 0, 0, 1];
  for (const [r, a] of [[s.inner, 1], [1, 0]]) {
    for (let i = 0; i < n; i++) {
      const th = (i / n) * Math.PI * 2;
      pos.push(r * Math.cos(th), r * Math.sin(th), 0);
      col.push(0, 0, 0, a);
    }
  }
  const idx = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    idx.push(0, 1 + i, 1 + j);
    idx.push(1 + i, 1 + n + i, 1 + n + j, 1 + i, 1 + n + j, 1 + j);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  g.setIndex(idx);
  g.rotateX(-Math.PI / 2); // built in XY facing +Z, laid flat facing +Y
  g.scale(s.width, 1, s.length);
  g.computeVertexNormals();
  return g;
}

// 0 closed, 1 fully open
export function doorOpen(d, t) {
  return smooth((t - d.open0) / (d.open1 - d.open0)) * (1 - smooth((t - d.close0) / (d.close1 - d.close0)));
}

// Degrees to the right. Eases in and out inside the turn and is exactly zero outside it.
export function steerDeg(t) {
  const { turn0, turn1 } = carTimes;
  if (t <= turn0 || t >= turn1) return 0;
  const u = (t - turn0) / (turn1 - turn0);
  return STEER_MAX_DEG * smooth(u / 0.25) * smooth((1 - u) / 0.25);
}

// Radians about local X; negative is nose down.
export function settlePitch(t) {
  const u = (t - carTimes.stop) / SETTLE.dur;
  if (u <= 0 || u >= 1) return 0;
  const s = Math.sin(Math.PI * u);
  return -SETTLE.pitchDeg * D2R * s * s;
}

// Engine runs from the start until the shut-off beat; the shake fades out with the headlights.
export function idleLift(t) {
  if (t < carTimes.start) return 0;
  const env = 1 - smooth((t - carTimes.lightsOff0) / (carTimes.lightsOff1 - carTimes.lightsOff0));
  if (env <= 0) return 0;
  let y = 0;
  for (const s of IDLE) y += s.amp * Math.sin(2 * Math.PI * s.hz * t + s.phase);
  return y * env;
}

// Fails at build, not on screen, if a schedule cannot ease open then shut.
function doorSchedule(tag) {
  const d = { ...carTimes.doors?.[tag] };
  const ok = [d.open0, d.open1, d.close0, d.close1].every(Number.isFinite) &&
    d.open0 < d.open1 && d.open1 <= d.close0 && d.close0 < d.close1;
  if (!ok) throw new Error(`car: bad ${tag} door times ${JSON.stringify(d)}`);
  return { side: DOOR_SIDE[tag], ...d };
}

export function buildCar(ctx) {
  const { THREE, scene, config } = ctx;
  const mats = makeMaterials(THREE, config);
  const lensBase = { headlamp: mats.headlamp.color.clone(), taillight: mats.taillight.color.clone() };

  // Cumulative distance along carAt, sampled once, so wheel spin is a pure function of t.
  const t0 = carTimes.start;
  const n = Math.ceil((carTimes.stop + 1 - t0) * TABLE_RATE) + 1;
  const dist = new Float64Array(n);
  let prev = carAt(t0);
  for (let i = 1; i < n; i++) {
    const c = carAt(t0 + i / TABLE_RATE);
    dist[i] = dist[i - 1] + Math.hypot(c.x - prev.x, c.z - prev.z);
    prev = c;
  }
  const distanceAt = (t) => {
    const f = (t - t0) * TABLE_RATE;
    if (f <= 0) return 0;
    if (f >= n - 1) return dist[n - 1];
    const i = Math.floor(f);
    return dist[i] + (dist[i + 1] - dist[i]) * (f - i);
  };

  const mesh = (geo, mat, name, parent, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.name = name;
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };
  const group = (name, parent, x = 0, y = 0, z = 0) => {
    const g = new THREE.Group();
    g.name = name;
    g.position.set(x, y, z);
    parent.add(g);
    return g;
  };

  const root = group('car', scene);
  const body = group('car-body', root);

  const B = SHAPE.body;
  mesh(new THREE.BoxGeometry(CAR.width, B.y1 - B.y0, CAR.length), mats.shell, 'car-shell', body, 0, (B.y0 + B.y1) / 2, 0);
  const C = SHAPE.cabin;
  mesh(new THREE.BoxGeometry(C.width, C.y1 - C.y0, C.length), mats.cabin, 'car-cabin', body, 0, (C.y0 + C.y1) / 2, C.back);

  // Lenses sit just proud of the front and rear faces.
  const half = CAR.length / 2;
  const H = SHAPE.headlamp, T = SHAPE.taillight;
  const headGeo = new THREE.BoxGeometry(H.w, H.h, H.d);
  const tailGeo = new THREE.BoxGeometry(T.w, T.h, T.d);
  for (const [tag, s] of [['left', -1], ['right', 1]]) {
    mesh(headGeo, mats.headlamp, `car-headlamp-${tag}`, body, s * H.side, H.y, -(half + H.d / 2));
    mesh(tailGeo, mats.taillight, `car-taillight-${tag}`, body, s * T.side, T.y, half + T.d / 2);
  }

  // Doors: a hinge group at the front edge, the slab running back from it.
  const D = SHAPE.door;
  const doorLen = D.front - D.back;
  const doorGeo = new THREE.BoxGeometry(D.thick, D.height, doorLen);
  const doors = [];
  for (const tag of Object.keys(DOOR_SIDE)) {
    const d = doorSchedule(tag);
    const hinge = group(`car-door-${tag}`, body, d.side * D.side, 0, -D.front);
    mesh(doorGeo, mats.door, `car-door-${tag}-slab`, hinge, 0, D.y0 + D.height / 2, doorLen / 2);
    doors.push({ hinge, d });
  }

  // Wheels: a steer pivot (rotation.y) holding a spinner (rotation.x). They live on root, so they stay on the ground.
  const W = SHAPE.wheel;
  const tyreGeo = new THREE.CylinderGeometry(W.radius, W.radius, W.width, W.segments);
  tyreGeo.rotateZ(Math.PI / 2); // axle along local X
  const hubGeo = new THREE.BoxGeometry(W.width + 0.02, W.radius * 1.4, 0.07);
  const wheels = [];
  for (const [tag, fwd, side] of [['fl', 1, -1], ['fr', 1, 1], ['rl', -1, -1], ['rr', -1, 1]]) {
    const pivot = group(`car-wheel-${tag}`, root, side * W.side, W.radius, -fwd * W.forward);
    const spinner = group(`car-wheel-${tag}-spin`, pivot);
    mesh(tyreGeo, mats.tyre, `car-wheel-${tag}-tyre`, spinner, 0, 0, 0);
    mesh(hubGeo, mats.hub, `car-wheel-${tag}-hub`, spinner, 0, 0, 0);
    wheels.push({ pivot, spinner, front: fwd > 0 });
  }

  const shadow = mesh(blobGeometry(THREE, SHAPE.shadow), mats.shadow, 'car-shadow', root, 0, SHAPE.shadow.y, 0);
  // Transparent, so it still draws after the opaque ground; -1 puts it before the snow and smoke (0), which then
  // blend over it instead of being darkened by it.
  shadow.renderOrder = -1;

  return {
    update(t) {
      const c = carAt(t);
      root.visible = c.present;
      root.position.set(c.x, 0, c.z);
      root.rotation.set(0, -c.heading * D2R, 0);

      body.position.y = idleLift(t);
      body.rotation.x = settlePitch(t);

      // Rolling toward -Z turns the wheel top forward, which is a negative rotation about +X.
      // Each signed product gets `+ 0` so a rest value is 0, never -0, and snapshots compare cleanly.
      const spin = -distanceAt(t) / W.radius + 0;
      const steer = -steerDeg(t) * D2R + 0; // a right turn points the wheels toward +X, which is negative about +Y
      for (const w of wheels) {
        w.spinner.rotation.x = spin;
        w.pivot.rotation.y = w.front ? steer : 0;
      }

      // Outward is toward the door's own side: -X for the driver, +X for the passenger.
      for (const { hinge, d } of doors) hinge.rotation.y = d.side * doorOpen(d, t) * D.maxDeg * D2R + 0;

      const h = headlights(t);
      mats.headlamp.color.copy(lensBase.headlamp).multiplyScalar(h);
      mats.taillight.color.copy(lensBase.taillight).multiplyScalar(h);
    },
  };
}
