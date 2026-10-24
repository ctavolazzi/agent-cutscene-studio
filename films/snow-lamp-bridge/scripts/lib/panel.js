// Storyboard panels: true-perspective sketches of the real set through each shot's real camera and lens.
// Painter's algorithm, back-face culling, near-plane clipping. Rough on purpose: boxes, silhouettes, light.
import { Draw } from './draw.js';
import { makeCamera, makeBox, aabb, sub, add, mul, dot, norm, len, lerp, clamp, mixHex, dirOf, D2R } from './math.js';
import { STREET, CROSS, BRIDGE, LAMP, RAIL, MOON, BUILDINGS, CITY } from '../../src/set.js';
import { carAt, peopleAt, headlights, moonAt, moonlight, smokePuffs, CAR, LIGHTER, PEOPLE } from '../../src/world.js';
import { SHOTS, cameraAt, hfovDeg, vfovDeg, tcode } from '../../src/shots.js';
import { mulberry32, hashString } from '../../src/prng.js';
import { shotColor } from './map.js';

export const PW = 960, PH = 540, CAPTION_H = 200;
const SNOW = '#2b3652', ROAD = '#1f2a40', DECK = '#2e3954', WATER = '#0a1322';
const SAFE_Y = 1 - 120 / 1080;

// a thin crescent: the part of disc A (centre cx,cy radius r) that is not inside disc B, shifted up and left
function crescent(cx, cy, r) {
  const bx = cx - 0.3 * r, by = cy - 0.22 * r, rb = 0.97 * r, N = 72;
  const ptsA = [], ptsB = [];
  for (let i = 0; i < N; i++) { const a = (i / N) * 2 * Math.PI; ptsA.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); ptsB.push([bx + rb * Math.cos(a), by + rb * Math.sin(a)]); }
  const outA = ptsA.map((p) => Math.hypot(p[0] - bx, p[1] - by) > rb);
  const inB = ptsB.map((p) => Math.hypot(p[0] - cx, p[1] - cy) < r);
  const run = (flags) => {
    const n = flags.length, start = flags.findIndex((f, i) => f && !flags[(i + n - 1) % n]);
    if (start < 0) return [];
    const out = []; for (let k = 0; k < n && flags[(start + k) % n]; k++) out.push((start + k) % n);
    return out;
  };
  const A = run(outA).map((i) => ptsA[i]); let B = run(inB).map((i) => ptsB[i]);
  if (!A.length || !B.length) return ptsA;
  const end = A[A.length - 1];
  if (Math.hypot(end[0] - B[B.length - 1][0], end[1] - B[B.length - 1][1]) < Math.hypot(end[0] - B[0][0], end[1] - B[0][1])) B = B.reverse();
  return [...A, ...B];
}

function wrap(text, n) {
  const words = String(text).split(' '); const lines = []; let cur = '';
  for (const w of words) { if ((cur + ' ' + w).trim().length > n) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); }
  if (cur) lines.push(cur);
  return lines;
}

// ray (2D, ground plane) against a rectangle: returns distance to entry or null
function rayRect(o, dv, r, maxT) {
  let t0 = 0, t1 = maxT;
  for (let i = 0; i < 2; i++) {
    const lo = i === 0 ? r.x0 : r.z0, hi = i === 0 ? r.x1 : r.z1;
    if (Math.abs(dv[i]) < 1e-9) { if (o[i] < lo || o[i] > hi) return null; }
    else {
      let a = (lo - o[i]) / dv[i], b = (hi - o[i]) / dv[i];
      if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a); t1 = Math.min(t1, b);
      if (t0 > t1) return null;
    }
  }
  return t0 > 0 ? t0 : null;
}

export function drawFrame(d, F, camSpec, t, shot, { labels = true } = {}) {
  const cam = makeCamera(camSpec, F.w, F.h);
  const off = (pts) => pts.map((p) => [p[0] + F.x, p[1] + F.y]);
  const poly = (wpts, st) => { const q = cam.projectPoly(wpts); if (q) d.poly(off(q), st); };
  const seg = (a, b, st) => {
    let ca = cam.toCam(a), cb = cam.toCam(b); const n = 0.15;
    if (ca[2] < n && cb[2] < n) return;
    if (ca[2] < n) { const u = (n - ca[2]) / (cb[2] - ca[2]); ca = [lerp(ca[0], cb[0], u), lerp(ca[1], cb[1], u), n]; }
    else if (cb[2] < n) { const u = (n - cb[2]) / (ca[2] - cb[2]); cb = [lerp(cb[0], ca[0], u), lerp(cb[1], ca[1], u), n]; }
    d.line(off([cam.toScreen(ca), cam.toScreen(cb)]), st);
  };
  const pt = (p) => { const q = cam.project(p); return q ? [q[0] + F.x, q[1] + F.y, q[2]] : null; };
  const rnd = mulberry32(hashString('snow' + shot.n));
  const ml = moonlight(t), mn = moonAt(t);
  const moonDir = [Math.sin(MOON.azimuthDeg * D2R) * Math.cos(mn.elevationDeg * D2R), Math.sin(mn.elevationDeg * D2R), -Math.cos(MOON.azimuthDeg * D2R) * Math.cos(mn.elevationDeg * D2R)];
  const lampHead = LAMP.head;
  const hl = headlights(t);
  const car = carAt(t);

  d.clipStart(F.x, F.y, F.w, F.h);
  // ---- sky, stars, moon
  d.vgrad(F.x, F.y, F.w, F.h, [[0, '#04070f'], [1, '#101b30']]);
  for (let i = 0; i < 70; i++) d.circle(F.x + rnd() * F.w, F.y + rnd() * F.h * 0.55, rnd() < 0.15 ? 1.4 : 0.8, { fill: '#cfd9f2', op: 0.5 });
  if (mn.visible || mn.elevationDeg > -2.5) {
    const mp = cam.project(add(cam.pos, mul(moonDir, 1000)));
    if (mp) {
      const r = (Math.tan(MOON.angularRadiusDeg * D2R) / cam.tv) * (F.h / 2);
      const x = mp[0] + F.x, y = mp[1] + F.y;
      d.circle(x, y, Math.max(r * 3.2, 14), { fill: '#8fb0ff', glow: true, op: 0.4 });
      d.poly(crescent(x, y, Math.max(r, 3)), { fill: '#eef3ff' });
    }
  }

  // ---- ground planes
  const quad = (x0, x1, z0, z1, y, fill) => poly([[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]], { fill });
  const BIG = 3000;
  quad(-BIG, BIG, BRIDGE.z1, BRIDGE.z0, BRIDGE.waterY, WATER); // river
  quad(-BIG, BIG, BRIDGE.z0, BIG, 0, SNOW);
  quad(-BIG, BIG, -BIG, BRIDGE.z1, 0, SNOW);
  quad(-STREET.roadHalf, STREET.roadHalf, BRIDGE.z0, BIG, 0.01, ROAD);
  quad(-BIG, BIG, CROSS.z0, CROSS.z1, 0.01, ROAD);
  quad(-STREET.walkOuter, STREET.walkOuter, BRIDGE.z1, BRIDGE.z0, 0.01, DECK);
  quad(-STREET.walkOuter, STREET.walkOuter, -BIG, BRIDGE.z1, 0.01, ROAD);
  // curb and sidewalk edges, and the road centre
  for (const x of [-6, -3.5, 3.5, 6]) seg([x, 0.02, BRIDGE.z0], [x, 0.02, 400], { stroke: '#3c4a6b', sw: 0.8 });
  seg([0, 0.02, BRIDGE.z0], [0, 0.02, 400], { stroke: '#3c4a6b', sw: 0.6, dash: [8, 10] });
  for (const z of [CROSS.z0, CROSS.z1]) seg([-300, 0.02, z], [300, 0.02, z], { stroke: '#3c4a6b', sw: 0.8 });

  // ---- lamp pool on the ground
  const ring = (r, n = 36) => Array.from({ length: n }, (_, i) => [LAMP.base[0] + Math.cos((i / n) * 6.2832) * r, 0.03, LAMP.base[1] + Math.sin((i / n) * 6.2832) * r]);
  for (const [r, a] of [[LAMP.poolRadius, 0.08], [LAMP.poolRadius * 0.68, 0.1], [LAMP.poolRadius * 0.4, 0.14]]) poly(ring(r), { fill: '#ffb46b', fillOp: a });

  // ---- headlight beams on the ground, and the facades they hit
  const facadePatches = []; // [{ pts (world), alpha }], drawn right after the building they belong to
  if (hl > 0.01 && car.present) {
    const f = dirOf(car.heading), r = [Math.cos(car.heading * D2R), 0, Math.sin(car.heading * D2R)];
    for (const side of [-1, 1]) {
      const o = [car.x + f[0] * 2.1 + r[0] * 0.65 * side, 0, car.z + f[2] * 2.1 + r[2] * 0.65 * side];
      const arc = [[o[0], 0.04, o[2]]];
      const hits = [];
      for (let a = -15; a <= 15.01; a += 2.5) {
        const dv = dirOf(car.heading + a);
        let best = null;
        for (const b of BUILDINGS) { const tt = rayRect([o[0], o[2]], [dv[0], dv[2]], b, 40); if (tt !== null && (best === null || tt < best.t)) best = { t: tt, b }; }
        const range = best ? best.t : 26;
        arc.push([o[0] + dv[0] * range, 0.04, o[2] + dv[2] * range]);
        if (best) hits.push({ a, b: best.b, p: [o[0] + dv[0] * best.t, o[2] + dv[2] * best.t], t: best.t });
      }
      poly(arc, { fill: '#e6efff', fillOp: 0.13 * hl });
      for (let i = 0; i < hits.length - 1; i++) {
        const h0 = hits[i], h1 = hits[i + 1];
        if (h0.b.id !== h1.b.id) continue;
        const H0 = 2.2 + h0.t * 0.14, H1 = 2.2 + h1.t * 0.14;
        facadePatches.push({ id: h0.b.id, alpha: 0.34 * hl * clamp(1.3 - h0.t / 40, 0.15, 1), pts: [[h0.p[0], 0.05, h0.p[1]], [h1.p[0], 0.05, h1.p[1]], [h1.p[0], H1, h1.p[1]], [h0.p[0], H0, h0.p[1]]] });
      }
    }
  }

  // ---- objects, painted far to near
  const objs = [];
  const depthOf = (c) => len(sub(c, cam.pos));
  const DEFAULT_SIDE = '#1a2339';
  const faceColor = (f, baseSide, baseTop) => {
    let base = f.kind === 'top' ? baseTop : baseSide;
    // buildings: tone each side by which way it faces, so neighbouring facades separate from each other
    if (f.kind === 'side' && baseSide === DEFAULT_SIDE) base = f.n[2] > 0.5 ? '#26324f' : f.n[0] < -0.5 ? '#202a46' : f.n[0] > 0.5 ? '#171f36' : '#141b2e';
    const toLamp = sub(lampHead, f.center), dl = len(toLamp);
    const L = Math.max(0, dot(norm(toLamp), f.n)) / (1 + (dl / 5.5) ** 2);
    base = mixHex(base, '#ffb46b', clamp(L * 1.5, 0, 0.78));
    if (ml > 0) base = mixHex(base, '#8fb0ff', clamp(Math.max(0, dot(f.n, moonDir)) * ml * 0.32, 0, 0.4));
    return base;
  };
  const litWindows = (b, face, fi) => {
    const p0 = face.pts[0], p1 = face.pts[1], p3 = face.pts[3];
    const w = len(sub(p1, p0)), h = len(sub(p3, p0));
    const ux = norm(sub(p1, p0)), uy = norm(sub(p3, p0));
    const cols = Math.floor(w / 3.2), rows = Math.floor((h - 1.2) / 3);
    const out = [];
    for (let rr = 0; rr < rows; rr++) for (let cc = 0; cc < cols; cc++) {
      if ((hashString(`${b.id}${fi}${rr}${cc}`) % 1000) / 1000 > 0.075) continue;
      const u = ((cc + 0.5) * w) / cols, v = 1.2 + rr * 3;
      const q = (du, dv) => add(add(p0, mul(ux, u + du)), mul(uy, v + dv));
      const nn = mul(face.n, 0.05);
      out.push([add(q(-0.55, -0.55), nn), add(q(0.55, -0.55), nn), add(q(0.55, 0.65), nn), add(q(-0.55, 0.65), nn)]);
    }
    return out;
  };
  const addBox = (b, box, { baseSide = '#1a2339', baseTop = '#2e3a58', stroke = '#52658f', windows = false } = {}) => {
    objs.push({ depth: depthOf(box.center), fn: () => {
      box.faces.forEach((f, fi) => {
        if (dot(f.n, sub(cam.pos, f.center)) <= 0) return;
        poly(f.pts, { fill: faceColor(f, baseSide, baseTop), stroke, sw: 0.8 });
        if (windows && f.kind === 'side') for (const wq of litWindows(b, f, fi)) poly(wq, { fill: '#ffcf7a', fillOp: 0.9 });
      });
      for (const p of facadePatches) if (p.id === b.id) poly(p.pts, { fill: '#f2f7ff', fillOp: p.alpha });
    } });
  };
  for (const b of BUILDINGS) addBox(b, aabb(b), { windows: true });
  for (const c of CITY) { const hb = c; addBox(hb, aabb(hb), { baseSide: '#10172a', baseTop: '#1d2740', stroke: '#27334f', windows: depthOf([(c.x0 + c.x1) / 2, 0, (c.z0 + c.z1) / 2]) < 160 }); }
  // aircraft lights
  for (const c of CITY.filter((c) => c.aircraft)) {
    const p = pt([(c.x0 + c.x1) / 2, c.h + 1, (c.z0 + c.z1) / 2]);
    if (p) objs.push({ depth: p[2] + 1, fn: () => d.circle(p[0], p[1], 2.6, { fill: '#ff3b3b' }) });
  }
  // parapets, in 5 m runs so far-to-near ordering stays right
  for (let z = BRIDGE.z1; z < BRIDGE.z0; z += 5) {
    for (const [cx, base] of [[5.775, '#7d8aa8'], [-5.775, '#566280']]) {
      const box = makeBox(cx, z + 2.5, 5, 0.45, 0, BRIDGE.parapetTop, 0);
      addBox({ id: 'rail' }, box, { baseSide: base, baseTop: '#a7b2cb', stroke: '#2a3552' });
    }
  }
  // lamp: post, arm, lantern, glow, and a faint shaft
  {
    const post = makeBox(LAMP.base[0], LAMP.base[1], 0.16, 0.16, 0, 4.3, 0);
    const arm = makeBox(4.8, LAMP.base[1], 0.5, 0.1, 4.2, 4.32, 90);
    const head = makeBox(LAMP.head[0], LAMP.head[2], 0.5, 0.5, 4.3, 4.8, 0);
    const hp = pt(LAMP.head);
    objs.push({ depth: depthOf(LAMP.head), fn: () => {
      for (const b of [post, arm, head]) for (const f of b.faces) { if (dot(f.n, sub(cam.pos, f.center)) <= 0) continue; poly(f.pts, { fill: '#0e1322', stroke: '#6a7a9e', sw: 0.8 }); }
      for (let i = 0; i < 18; i++) {
        const a0 = (i / 18) * 6.2832, a1 = ((i + 1) / 18) * 6.2832, R = 4.8;
        poly([LAMP.head, [LAMP.head[0] + Math.cos(a0) * R, 0, LAMP.head[2] + Math.sin(a0) * R], [LAMP.head[0] + Math.cos(a1) * R, 0, LAMP.head[2] + Math.sin(a1) * R]], { fill: '#ffb46b', fillOp: 0.022 });
      }
      if (hp) { const sc = cam.scaleAt(hp[2]); d.circle(hp[0], hp[1], Math.max(24, 1.9 * sc), { fill: '#ffb46b', glow: true, op: 0.6 }); d.circle(hp[0], hp[1], Math.max(4, 0.16 * sc), { fill: '#ffe9c4' }); }
    } });
  }

  // ---- car
  if (car.present) {
    const f = dirOf(car.heading), r = [Math.cos(car.heading * D2R), 0, Math.sin(car.heading * D2R)];
    const local = (a, b, y) => [car.x + f[0] * a + r[0] * b, y, car.z + f[2] * a + r[2] * b];
    const parts = [
      makeBox(car.x, car.z, CAR.length, CAR.width, 0.25, 0.9, car.heading),
      makeBox(car.x - f[0] * 0.3, car.z - f[2] * 0.3, 2.4, 1.6, 0.9, 1.4, car.heading),
    ];
    const wheels = [];
    for (const a of [1.45, -1.45]) for (const b of [-0.82, 0.82]) wheels.push(makeBox(car.x + f[0] * a + r[0] * b, car.z + f[2] * a + r[2] * b, 0.68, 0.22, 0, 0.66, car.heading));
    const open = (a0, a1, b) => ({ hinge: local(a0, b, 0.3), end: (ang) => local(a0 - Math.cos(ang) * (a0 - a1), b + Math.sign(b) * Math.sin(ang) * (a0 - a1), 0.3) });
    objs.push({ depth: depthOf([car.x, 0.7, car.z]), fn: () => {
      // blob shadow
      const sh = Array.from({ length: 20 }, (_, i) => { const a = (i / 20) * 6.2832; return local(Math.cos(a) * 2.6, Math.sin(a) * 1.25, 0.03); });
      poly(sh, { fill: '#04060b', fillOp: 0.6 });
      for (const w of wheels) for (const fc of w.faces) { if (dot(fc.n, sub(cam.pos, fc.center)) > 0) poly(fc.pts, { fill: '#05070c', stroke: '#2a3552', sw: 0.6 }); }
      for (const part of parts) for (const fc of part.faces) {
        if (dot(fc.n, sub(cam.pos, fc.center)) <= 0) continue;
        poly(fc.pts, { fill: faceColor(fc, '#0f1727', '#1c2740'), stroke: '#52628a', sw: 0.9 });
      }
      // doors: driver (west, 270 side when heading north) opens 0:30.5 to 0:34.5, passenger 0:32 to 0:35.4
      for (const [side, t0, t1] of [[-1, 30.5, 34.5], [1, 32.0, 35.4]]) {
        if (t >= t0 && t < t1) {
          const dd = open(0.95, -0.15, side * 0.9);
          const ang = 70 * D2R;
          const hinge = dd.hinge, end = dd.end(ang);
          poly([hinge, end, [end[0], 1.0, end[2]], [hinge[0], 1.0, hinge[2]]], { fill: '#0f1727', stroke: '#8fa2cf', sw: 1 });
        }
      }
      // lights
      for (const b of [-0.65, 0.65]) {
        const hp = pt(local(2.36, b, 0.7)), tp = pt(local(-2.36, b, 0.8));
        if (hp && hl > 0.01) { const sc = cam.scaleAt(hp[2]); d.circle(hp[0], hp[1], Math.max(10, 0.7 * sc), { fill: '#e6efff', glow: true, op: 0.85 * hl }); d.circle(hp[0], hp[1], Math.max(2.2, 0.09 * sc), { fill: '#ffffff', op: hl }); }
        if (tp && hl > 0.01) { const sc = cam.scaleAt(tp[2]); d.circle(tp[0], tp[1], Math.max(6, 0.35 * sc), { fill: '#ff3b3b', glow: true, op: 0.75 * hl }); d.circle(tp[0], tp[1], Math.max(1.6, 0.05 * sc), { fill: '#ff8a8a', op: hl }); }
      }
    } });
  }

  // ---- footprints from the walk
  const prints = [];
  for (const [id, keys] of [['A', [[30.5, 31.8], [34.6, 39.9], [44.5, 62]]], ['B', [[32.2, 33.2], [44.5, 62]]]]) {
    for (const [t0, t1] of keys) {
      let acc = 0, last = null, side = 1;
      for (let tt = t0; tt <= Math.min(t, t1); tt += 0.05) {
        const p = peopleAt(tt)[id]; if (!p) continue;
        if (last) acc += Math.hypot(p.x - last[0], p.z - last[1]);
        if (!last || acc >= 0.72) { prints.push({ x: p.x + side * 0.1 * Math.cos(p.face * D2R), z: p.z + side * 0.1 * Math.sin(p.face * D2R), face: p.face }); side = -side; acc = 0; }
        last = [p.x, p.z];
      }
    }
  }
  // footprints are flat, so they are drawn now, with the ground, before anything upright
  for (const p of prints) {
    const f = dirOf(p.face), r = [Math.cos(p.face * D2R), 0, Math.sin(p.face * D2R)];
    poly([[p.x + f[0] * 0.15 - r[0] * 0.05, 0.04, p.z + f[2] * 0.15 - r[2] * 0.05], [p.x + f[0] * 0.15 + r[0] * 0.05, 0.04, p.z + f[2] * 0.15 + r[2] * 0.05], [p.x - f[0] * 0.15 + r[0] * 0.05, 0.04, p.z - f[2] * 0.15 + r[2] * 0.05], [p.x - f[0] * 0.15 - r[0] * 0.05, 0.04, p.z - f[2] * 0.15 - r[2] * 0.05]], { fill: '#0a0f1b', fillOp: 0.85 });
  }

  // ---- the two people
  const people = peopleAt(t);
  const ember = t >= LIGHTER.t1;
  for (const id of ['A', 'B']) {
    const s = people[id]; if (!s) continue;
    const H = PEOPLE[id].height, k = H / 1.8;
    const F3 = dirOf(s.face), R3 = [Math.cos(s.face * D2R), 0, Math.sin(s.face * D2R)];
    const P0 = [s.x, 0, s.z];
    const up = (y) => [0, y, 0];
    let sh = add(P0, up(1.5 * k)), hip = add(P0, up(0.95 * k)), head = add(P0, up(1.69 * k));
    const ph = t * 5.2;
    let feet = [add(P0, mul(R3, -0.1)), add(P0, mul(R3, 0.1))];
    const hands = [null, null];
    if (s.pose === 'walk') {
      const sw = Math.sin(ph);
      feet = [add(add(P0, mul(R3, -0.1)), mul(F3, 0.28 * sw)), add(add(P0, mul(R3, 0.1)), mul(F3, -0.28 * sw))];
      hands[0] = add(add(P0, mul(R3, -0.24)), add(up(0.82 * k), mul(F3, -0.14 * sw)));
      hands[1] = add(add(P0, mul(R3, 0.24)), add(up(0.82 * k), mul(F3, 0.14 * sw)));
    } else if (s.pose === 'exit') {
      sh = add(add(P0, up(1.3 * k)), mul(F3, 0.25)); head = add(add(P0, up(1.45 * k)), mul(F3, 0.32)); hip = add(add(P0, up(0.8 * k)), mul(F3, 0.05));
      feet = [add(P0, mul(R3, -0.14)), add(add(P0, mul(R3, 0.1)), mul(F3, -0.25))];
      hands[0] = add(add(P0, mul(R3, -0.25)), add(up(0.9 * k), mul(F3, 0.3))); hands[1] = add(add(P0, mul(R3, 0.25)), add(up(1.0 * k), mul(F3, 0.2)));
    } else if (s.pose === 'lean' || s.pose === 'smoke' || s.pose === 'cup') {
      sh = add(add(P0, up(1.42 * k)), mul(F3, 0.16)); hip = add(add(P0, up(0.95 * k)), mul(F3, 0.05));
      head = add(add(sh, up(0.22 * k)), mul(F3, 0.1));
      const rail = (side) => add(add(P0, mul(F3, 0.55)), add(mul(R3, 0.19 * side), up(1.32)));
      hands[0] = rail(-1); hands[1] = rail(1);
      const mouth = add(add(head, mul(F3, 0.1)), up(-0.1));
      if (s.pose === 'cup') { hands[0] = add(add(mouth, mul(R3, -0.07)), mul(F3, 0.1)); hands[1] = add(add(mouth, mul(R3, 0.07)), mul(F3, 0.1)); }
      if (s.pose === 'smoke' && id === 'A') hands[1] = add(mouth, mul(R3, 0.05));
    } else { // stand
      hands[0] = add(add(P0, mul(R3, -0.25)), up(0.8 * k)); hands[1] = add(add(P0, mul(R3, 0.25)), up(0.8 * k));
    }
    objs.push({ depth: depthOf(add(P0, up(0.9))), fn: () => {
      const sh0 = Array.from({ length: 14 }, (_, i) => { const a = (i / 14) * 6.2832; return [P0[0] + Math.cos(a) * 0.45, 0.03, P0[2] + Math.sin(a) * 0.45]; });
      poly(sh0, { fill: '#04060b', fillOp: 0.55 });
      const thick = (a, b, wm, fill, stroke = '#0a0f1a') => {
        // limbs and legs: a quad with round ends
        const pa = pt(a), pb = pt(b); if (!pa || !pb) return;
        const w = Math.max(1.5, wm * cam.scaleAt((pa[2] + pb[2]) / 2));
        const dx = pb[0] - pa[0], dy = pb[1] - pa[1], l = Math.hypot(dx, dy) || 1, nx = (-dy / l) * w / 2, ny = (dx / l) * w / 2;
        d.poly([[pa[0] + nx, pa[1] + ny], [pb[0] + nx, pb[1] + ny], [pb[0] - nx, pb[1] - ny], [pa[0] - nx, pa[1] - ny]], { fill, stroke, sw: 0.6 });
        d.circle(pa[0], pa[1], w / 2, { fill, stroke, sw: 0.6 }); d.circle(pb[0], pb[1], w / 2, { fill, stroke, sw: 0.6 });
      };
      const coat = id === 'A' ? '#141a2a' : '#6b7b99', coatLine = id === 'A' ? '#5a6c94' : '#a9b8d4';
      const limb = mixHex(coat, '#ffffff', 0.1);
      // a tapered quad: no round caps, so a coat has a flat hem and the figure does not read as balls on sticks
      const tapered = (a, b, wa, wb, fill, stroke) => {
        const pa = pt(a), pb = pt(b); if (!pa || !pb) return;
        const wA = wa * cam.scaleAt(pa[2]), wB = wb * cam.scaleAt(pb[2]);
        const dx = pb[0] - pa[0], dy = pb[1] - pa[1], l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l;
        d.poly([[pa[0] + (nx * wA) / 2, pa[1] + (ny * wA) / 2], [pb[0] + (nx * wB) / 2, pb[1] + (ny * wB) / 2], [pb[0] - (nx * wB) / 2, pb[1] - (ny * wB) / 2], [pa[0] - (nx * wA) / 2, pa[1] - (ny * wA) / 2]], { fill, stroke, sw: 0.9 });
      };
      for (const ft of feet) thick(ft, add(hip, mul(sub(ft, P0), 0.3)), 0.15, id === 'A' ? '#0d1220' : '#2a3350', 'none');
      if (id === 'A') tapered(sh, add(P0, up(0.45)), 0.46, 0.64, coat, coatLine); // long coat, flares to the hem
      else tapered(sh, add(P0, up(0.8)), 0.5, 0.58, coat, coatLine);
      for (let i = 0; i < 2; i++) {
        if (!hands[i]) continue;
        const sp = add(sh, mul(R3, (i === 0 ? -1 : 1) * 0.21)), elbow = add(mul(add(sp, hands[i]), 0.5), add(up(-0.08), mul(F3, -0.05)));
        thick(sp, elbow, 0.13, limb, 'none'); thick(elbow, hands[i], 0.11, limb, 'none');
      }
      if (id === 'B') thick(add(sh, up(0.06)), add(sh, up(0.12)), 0.34, '#c79a45', 'none'); // scarf
      const hp = pt(head);
      if (hp) {
        const rr = 0.115 * cam.scaleAt(hp[2]);
        d.circle(hp[0], hp[1], rr, { fill: '#8d847f', stroke: '#0a0f1a', sw: 0.7 });
        if (id === 'B') d.poly([[hp[0] - rr * 1.05, hp[1] - rr * 0.1], [hp[0] - rr * 0.8, hp[1] - rr * 1.1], [hp[0] + rr * 0.8, hp[1] - rr * 1.1], [hp[0] + rr * 1.05, hp[1] - rr * 0.1]], { fill: '#b5584a', stroke: '#0a0f1a', sw: 0.7 });
        else d.circle(hp[0], hp[1] - rr * 0.35, rr * 0.95, { fill: '#241c1a', fillOp: 0.9 });
        const lk = dirOf(s.look), np = pt(add(head, mul(lk, 0.16)));
        if (np) d.circle(np[0], np[1], Math.max(1.2, rr * 0.16), { fill: '#e8d6c4' }); // nose tick: which way the head is turned
      }
      // lighter, ember
      if (id === 'A' && t >= LIGHTER.t0 && t < LIGHTER.t1) {
        const fp = pt(add(add(head, mul(F3, 0.2)), up(-0.1)));
        if (fp) { const sc = cam.scaleAt(fp[2]); d.circle(fp[0], fp[1], Math.max(14, 0.32 * sc), { fill: '#ff9a3a', glow: true, op: 0.8 }); d.circle(fp[0], fp[1], Math.max(2, 0.025 * sc), { fill: '#ffe08a' }); }
      }
      if (id === 'A' && ember) {
        const ep = pt(add(add(head, mul(F3, 0.2)), up(-0.1)));
        if (ep) { const sc = cam.scaleAt(ep[2]); d.circle(ep[0], ep[1], Math.max(8, 0.09 * sc), { fill: '#ff5a1a', glow: true, op: 0.85 }); d.circle(ep[0], ep[1], Math.max(1.6, 0.013 * sc), { fill: '#ffb066' }); }
      }
    } });
  }
  // smoke: a wisp from the ember, and the cloud A exhales
  const A = people.A;
  if (A && ['lean', 'smoke', 'cup'].includes(A.pose) && t >= LIGHTER.t1) {
    const F = dirOf(A.face);
    for (const pf of smokePuffs(t, [A.x + F[0] * 0.46, 1.54, A.z + F[2] * 0.46])) {
      const sp = pt(pf.pos);
      if (sp) objs.push({ depth: sp[2] - 0.2, fn: () => d.circle(sp[0], sp[1], Math.max(1.2, pf.r * cam.scaleAt(sp[2])), { fill: pf.kind === 'exhale' && pf.age < 1.2 ? '#f4d9b0' : '#b8c6e8', fillOp: pf.alpha }) });
    }
  }

  objs.sort((a, b) => b.depth - a.depth);
  for (const o of objs) o.fn();

  // ---- falling snow, sparse: most flakes are small, a few are close and bright
  for (let i = 0; i < 160; i++) {
    const x = F.x + rnd() * F.w, y = F.y + rnd() * F.h, near = rnd() < 0.12;
    d.circle(x, y, near ? 2.6 : 1.2, { fill: '#f4f8ff', op: near ? 0.85 : 0.55 });
  }
  d.clipEnd();

  // ---- overlays: thirds and the bottom safe strip
  d.line([[F.x + F.w / 3, F.y], [F.x + F.w / 3, F.y + F.h]], { stroke: '#ffffff', strokeOp: 0.16, sw: 1, dash: [4, 6] });
  d.line([[F.x + (2 * F.w) / 3, F.y], [F.x + (2 * F.w) / 3, F.y + F.h]], { stroke: '#ffffff', strokeOp: 0.16, sw: 1, dash: [4, 6] });
  d.line([[F.x, F.y + F.h / 3], [F.x + F.w, F.y + F.h / 3]], { stroke: '#ffffff', strokeOp: 0.16, sw: 1, dash: [4, 6] });
  d.line([[F.x, F.y + (2 * F.h) / 3], [F.x + F.w, F.y + (2 * F.h) / 3]], { stroke: '#ffffff', strokeOp: 0.16, sw: 1, dash: [4, 6] });
  d.rect(F.x, F.y + F.h * SAFE_Y, F.w, F.h * (1 - SAFE_Y), { fill: '#ff5d5d', fillOp: 0.1 });
  d.line([[F.x, F.y + F.h * SAFE_Y], [F.x + F.w, F.y + F.h * SAFE_Y]], { stroke: '#ff5d5d', strokeOp: 0.55, sw: 1 });
  if (labels) d.text(F.x + F.w - 6, F.y + F.h - 5, 'safe strip: nothing important below the line', { fill: '#ff8c8c', size: 10, anchor: 'end' });
  d.rect(F.x, F.y, F.w, F.h, { stroke: '#7d8bab', sw: 1.5 });
  return cam;
}

function moveArrows(d, F, shot) {
  const m = shot.move; if (!m) return;
  const col = '#ffffff', o = { stroke: col, sw: 3, op: 0.95 };
  const label = (x, y, anchor = 'start') => d.text(x, y, m.label, { fill: col, size: 13, weight: 700, anchor });
  const { x, y, w, h } = F;
  if (m.kind === 'push' || m.kind === 'pull') {
    const a = m.kind === 'push' ? 1 : -1;
    for (const [sx, sy] of [[0.1, 0.12], [0.9, 0.12], [0.1, 0.72], [0.9, 0.72]]) {
      const px = x + w * sx, py = y + h * sy, cx = x + w * 0.5, cy = y + h * 0.45;
      const dx = (cx - px) * 0.18 * a, dy = (cy - py) * 0.18 * a;
      d.arrow([[px, py], [px + dx, py + dy]], { ...o, head: 10 });
    }
    label(x + w / 2, y + 22, 'middle');
  } else if (m.kind === 'pan' || m.kind === 'truck') {
    const left = m.dir === 'left';
    d.arrow([[x + w * (left ? 0.72 : 0.28), y + 34], [x + w * (left ? 0.28 : 0.72), y + 34]], { ...o, head: 12 });
    label(x + w / 2, y + 22, 'middle');
  } else if (m.kind === 'tilt') {
    d.arrow([[x + w - 34, y + h * 0.55], [x + w - 34, y + h * 0.25]], { ...o, head: 12 });
    d.text(x + w - 46, y + h * 0.4, m.label, { fill: col, size: 13, weight: 700, anchor: 'end' });
  } else if (m.kind === 'arc') {
    const pts = []; for (let i = 0; i <= 14; i++) { const a = Math.PI * (0.2 + 0.6 * i / 14); pts.push([x + w / 2 - Math.cos(a) * w * 0.28, y + 70 - Math.sin(a) * 38]); }
    d.arrow(pts, { ...o, head: 12 });
    label(x + w / 2, y + 22, 'middle');
  }
}

export function buildPanel(shot) {
  const d = new Draw(PW, PH + CAPTION_H, { bg: '#080c16' });
  const t = shot.sketchAt;
  const col = shotColor(shot.n);
  const F = { x: 0, y: 0, w: PW, h: PH };
  drawFrame(d, F, cameraAt(shot, t), t, shot);
  moveArrows(d, F, shot);
  d.rect(0, 0, 64, 44, { fill: col });
  d.text(32, 33, String(shot.n), { fill: '#0b1020', size: 30, weight: 700, anchor: 'middle' });
  // insets: other moments of the same shot (moving shots default to their end frame)
  const insets = shot.insets ?? (shot.move ? [{ t: shot.end - 0.05, label: 'end frame' }] : []);
  const y0 = PH + 28;
  d.text(14, y0, `SHOT ${shot.n}  ${shot.title}`, { fill: '#ffffff', size: 22, weight: 700 });
  d.text(14, y0 + 24, `${tcode(shot.start)} to ${tcode(shot.end)} (${shot.end - shot.start} s)  ${shot.lens}mm  ${hfovDeg(shot.lens).toFixed(0)} x ${vfovDeg(shot.lens).toFixed(0)} deg  main frame ${t.toFixed(1)} s`, { fill: col, size: 12, weight: 700 });
  const n = insets.length;
  const [iw, ih] = n >= 3 ? [200, 112] : [266, 150];
  const gap = 8;
  const wrapAt = n >= 3 ? 36 : n === 2 ? 50 : n === 1 ? 78 : 118;
  const lines = [...wrap(shot.framing + '.', wrapAt), ...wrap(shot.action, wrapAt)];
  lines.slice(0, 9).forEach((l, i) => d.text(14, y0 + 48 + i * 16, l, { fill: '#c9d4ee', size: 13 }));
  insets.forEach((ins, k) => {
    const ix = PW - 12 - iw * (n - k) - gap * (n - 1 - k), iy = PH + 20;
    drawFrame(d, { x: ix, y: iy, w: iw, h: ih }, cameraAt(shot, ins.t), ins.t, shot, { labels: false });
    d.text(ix, iy - 5, ins.label, { fill: '#9fb0d6', size: 11 });
  });
  return d;
}
