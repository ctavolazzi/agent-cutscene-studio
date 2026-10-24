// Numeric audits that run on the same data the storyboard draws. Nothing here is eyeballed.
import { BUILDINGS, LAMP, RAIL, MOON, BRIDGE } from '../../src/set.js';
import { SHOTS, cameraAt, hfovDeg, vfovDeg } from '../../src/shots.js';
import { carAt, peopleAt, moonAt, CAR } from '../../src/world.js';
import { makeCamera, segHitsRect, bearingOf, dirOf, D2R } from './math.js';

export const W = 960, H = 540;
const SAFE_Y = 1 - 120 / 1080; // bottom 120 px of a 1080p frame

// Ground-plane sight line: buildings are far taller than the camera and the car, so a footprint test is exact enough.
export function visibleFrom(eye, p, ignore = []) {
  const a = [eye[0], eye[2]], b = [p[0], p[1] ?? p[2]];
  for (const bl of BUILDINGS) {
    if (ignore.includes(bl.id)) continue;
    if (segHitsRect(a, b, bl)) return false;
  }
  return true;
}

// When does the car first become visible from a camera, and when is all of it visible?
export function carEmergence(eye, t0 = 13, t1 = 24) {
  let nose = null, full = null, hiddenAt = null;
  for (let t = t0; t <= t1; t += 0.02) {
    const c = carAt(t);
    const f = dirOf(c.heading);
    const noseP = [c.x + f[0] * CAR.length / 2, c.z + f[2] * CAR.length / 2];
    const tailP = [c.x - f[0] * CAR.length / 2, c.z - f[2] * CAR.length / 2];
    const vn = visibleFrom(eye, noseP), vt = visibleFrom(eye, tailP);
    if (!vn && hiddenAt === null) hiddenAt = t;
    if (vn && nose === null) nose = t;
    if (vn && vt && full === null) full = t;
  }
  return { hiddenAt, noseVisible: nose, fullyVisible: full };
}

export function landmarkReport() {
  const rows = [];
  for (const s of SHOTS) for (const [tag, t] of [['', s.sketchAt], [' (last frame)', s.end - 0.05]]) {
    const cam = makeCamera(cameraAt(s, t), W, H);
    const P = peopleAt(t);
    const moon = moonAt(t);
    const lm = {
      'lamp head': LAMP.head,
      'lamp base': [LAMP.base[0], 0.3, LAMP.base[1]],
      'bridge entrance': [0, 1.0, BRIDGE.z0],
      'corner bldg NW corner': [6.2, 6, 25],
    };
    const car = carAt(t);
    if (car.present) lm['car centre'] = [car.x, 0.7, car.z];
    if (P.A) { lm['A head'] = [P.A.x, 1.72, P.A.z]; lm['A feet'] = [P.A.x, 0, P.A.z]; }
    if (P.B) { lm['B head'] = [P.B.x, 1.58, P.B.z]; lm['B feet'] = [P.B.x, 0, P.B.z]; }
    if (moon.visible) {
      const el = moon.elevationDeg * D2R, az = MOON.azimuthDeg * D2R;
      lm['moon'] = [cam.pos[0] + Math.sin(az) * Math.cos(el) * 1000, cam.pos[1] + Math.sin(el) * 1000, cam.pos[2] - Math.cos(az) * Math.cos(el) * 1000];
    }
    const out = {};
    for (const [name, p] of Object.entries(lm)) {
      const q = cam.project(p);
      if (!q) continue;
      const x = q[0] / W, y = q[1] / H;
      const inFrame = x >= 0 && x <= 1 && y >= 0 && y <= 1;
      if (inFrame) out[name] = { x: +x.toFixed(3), y: +y.toFixed(3), safeStrip: y > SAFE_Y };
    }
    rows.push({ shot: s.n + tag, t: +t.toFixed(2), hfov: +hfovDeg(s.lens).toFixed(1), vfov: +vfovDeg(s.lens).toFixed(1), landmarks: out });
  }
  return rows;
}

// Is "toward the bridge" (north) screen-left? Negative dx means left.
export function directionReport() {
  const rows = [];
  // shot 4 looks south at the car, so north is behind the camera and the test says nothing
  for (const n of [3, 5, 6, 7, 9, 11, 13]) {
    const s = SHOTS[n - 1];
    const t = s.sketchAt;
    const cam = makeCamera(cameraAt(s, t), W, H);
    const subj = typeof s.subject === 'function' ? s.subject(t) : s.subject;
    const a = cam.project(subj), b = cam.project([subj[0], subj[1], subj[2] - 4]);
    if (!a || !b) { rows.push({ shot: n, north: 'n/a (behind camera)' }); continue; }
    const dx = b[0] - a[0];
    rows.push({ shot: n, north: Math.abs(dx) < 4 ? 'toward or away from camera' : dx < 0 ? 'screen left' : 'screen right' });
  }
  return rows;
}

export function sideReport() {
  return SHOTS.filter((s) => s.n >= 9).map((s) => {
    const c = cameraAt(s, s.sketchAt);
    return { shot: s.n, camX: +c.pos[0].toFixed(2), line: RAIL.x, side: c.pos[0] < RAIL.x ? 'west' : 'EAST (crosses the line)' };
  });
}

// Cut audit: does each cut change the angle on the subject by 30 degrees or more, or the shot size by a clear step?
export function cutReport() {
  const rows = [];
  for (let i = 0; i < SHOTS.length - 1; i++) {
    const a = SHOTS[i], b = SHOTS[i + 1];
    const ca = cameraAt(a, a.end - 0.01), cb = cameraAt(b, b.start);
    const sa = typeof a.subject === 'function' ? a.subject(a.end - 0.01) : a.subject;
    const sb = typeof b.subject === 'function' ? b.subject(b.start) : b.subject;
    const gap = Math.hypot(sa[0] - sb[0], sa[2] - sb[2]);
    const dA = [ca.pos[0] - sa[0], ca.pos[2] - sa[2]], dB = [cb.pos[0] - sb[0], cb.pos[2] - sb[2]];
    const ang = (Math.atan2(dB[1], dB[0]) - Math.atan2(dA[1], dA[0])) / D2R;
    const angle = Math.abs(((ang + 540) % 360) - 180);
    // shot size ~ lens / distance to subject
    const sizeA = a.lens / Math.max(Math.hypot(...dA, ca.pos[1] - sa[1]), 0.5);
    const sizeB = b.lens / Math.max(Math.hypot(...dB, cb.pos[1] - sb[1]), 0.5);
    const ratio = Math.max(sizeA, sizeB) / Math.min(sizeA, sizeB);
    let verdict;
    if (gap > 6) verdict = 'new subject';
    else if (angle >= 30) verdict = 'ok (angle)';
    else if (ratio >= 1.6) verdict = 'ok (size step)';
    else verdict = 'WARN: jump cut risk';
    rows.push({ cut: `${a.n} to ${b.n}`, subjectGapM: +gap.toFixed(1), angleDeg: +angle.toFixed(0), sizeRatio: +ratio.toFixed(2), verdict });
  }
  return rows;
}

export function runChecks() {
  const cam3 = cameraAt(SHOTS[2], 14);
  return {
    carFromShot3: carEmergence(cam3.pos),
    carFromShot2: carEmergence(cameraAt(SHOTS[1], 10).pos),
    landmarks: landmarkReport(),
    directions: directionReport(),
    sides: sideReport(),
    cuts: cutReport(),
  };
}
