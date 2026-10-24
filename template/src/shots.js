// The shot table. Times are seconds on the one world clock. Every cut is a hard cut apart from the opening fade.
// Cameras: pos and target in meters (+Y up, north -Z, east +X), lens is full-frame focal length in mm,
// roll in degrees. Between keys everything eases in and out. The map, the panels and the 3D scene all read this file.
//
// A shot may set `ease`: the default eases each key segment in and out (a move stops at every key); 'linear' moves at
// a steady rate between keys (a dolly that has to hold a walking subject); 'spline' passes smoothly through the inner
// keys and eases only out of a hold and into the last key (a move that has to be somewhere at a given time).
//
// A key may give `frame: { P, sx, sy }` instead of a target: the camera is then aimed so that world point P
// lands at (sx, sy) in the frame (0,0 top left). That is how composition is specified, so it survives a lens or position change.
import { LAMP, WALL } from './set.js';

const D2R = Math.PI / 180;
const ASPECT = 16 / 9;
export const vfovDeg = (f) => (2 * Math.atan(12 / f)) / D2R; // 18mm 67.4, 24mm 53.1, 35mm 37.8, 50mm 27.0, 85mm 16.1
export const hfovDeg = (f, aspect = ASPECT) => (2 * Math.atan(Math.tan((vfovDeg(f) * D2R) / 2) * aspect)) / D2R;
// a point `dist` meters from `pos` along a compass bearing, at height y
export const ahead = (pos, bearingDeg, dist, y) => [
  pos[0] + Math.sin(bearingDeg * D2R) * dist,
  y ?? pos[1],
  pos[2] - Math.cos(bearingDeg * D2R) * dist,
];

// Aim from pos so that world point P appears at fraction (sx, sy) of the frame. Iterates on yaw and pitch.
export function solveTarget(pos, P, sx, sy, lens, dist = 30) {
  const tv = 12 / lens, th = tv * ASPECT;
  const d = [P[0] - pos[0], P[1] - pos[1], P[2] - pos[2]];
  let yaw = Math.atan2(d[0], -d[2]); // compass, radians
  let pitch = Math.atan2(d[1], Math.hypot(d[0], d[2]));
  for (let i = 0; i < 12; i++) {
    const f = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
    const r0 = [-f[2], 0, f[0]]; // f x up, unnormalised
    const rl = Math.hypot(r0[0], r0[2]) || 1;
    const r = [r0[0] / rl, 0, r0[2] / rl];
    const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
    const cz = d[0] * f[0] + d[1] * f[1] + d[2] * f[2];
    const cx = d[0] * r[0] + d[1] * r[1] + d[2] * r[2];
    const cy = d[0] * u[0] + d[1] * u[1] + d[2] * u[2];
    const x = 0.5 + (0.5 * (cx / cz)) / th, y = 0.5 - (0.5 * (cy / cz)) / tv;
    // screen error to angle error, small-angle
    yaw += Math.atan(((x - sx) * 2 * th)) * 0.9;
    pitch -= Math.atan((y - sy) * 2 * tv) * 0.9; // point too low on screen: tilt the camera down
  }
  return [pos[0] + Math.sin(yaw) * Math.cos(pitch) * dist, pos[1] + Math.sin(pitch) * dist, pos[2] - Math.cos(yaw) * Math.cos(pitch) * dist];
}

const lampHead = LAMP.head;
const wallMid = [(WALL.x0 + WALL.x1) / 2, 0.7, WALL.z];

// The template's example: three shots. Each shot has a number, a time span on the one clock, a lens (full-frame mm),
// camera keys (pos plus a target or a frame spec), an optional move label, the action, a sketch time and a subject.
export const SHOTS = [
  {
    n: 1, start: 0, end: 4, lens: 35, title: 'The lamp',
    framing: 'The lamp head against the night sky, snow falling through its light',
    keys: [{ t: 0, pos: [4.5, 1.4, 2.5], frame: { P: lampHead, sx: 0.62, sy: 0.32 } }],
    move: null,
    action: 'Fade in from black. Snow drifts through the lamp light.',
    sketchAt: 2.5, subject: lampHead, side: 'n/a',
  },
  {
    n: 2, start: 4, end: 8, lens: 24, title: 'The wall',
    framing: 'Low and wide along the wall, the lamp at the right third, a slight tilt',
    // a held 3 degree roll: tests/checks.test.mjs uses it to prove the camera check sees roll
    keys: [
      { t: 4, pos: [-3.5, 0.6, 2.5], frame: { P: wallMid, sx: 0.42, sy: 0.6 }, roll: 3 },
      { t: 8, pos: [-2.0, 0.6, 2.2], frame: { P: wallMid, sx: 0.42, sy: 0.6 }, roll: 3 },
    ],
    move: { kind: 'truck', dir: 'right', label: 'slow truck right along the wall' },
    action: 'Nothing moves but the snow.',
    sketchAt: 6, subject: wallMid, side: 'n/a',
  },
  {
    n: 3, start: 8, end: 12, lens: 50, title: 'Under the lamp',
    framing: 'Looking up at the lantern from near the ground',
    keys: [
      { t: 8, pos: [3.2, 0.5, 1.2], frame: { P: lampHead, sx: 0.5, sy: 0.3 } },
      { t: 12, pos: [2.9, 0.6, 0.6], frame: { P: lampHead, sx: 0.5, sy: 0.3 } },
    ],
    move: { kind: 'push', label: 'slow push in' },
    action: 'The lamp flickers. Hold to the end.',
    sketchAt: 10, subject: lampHead, side: 'n/a',
  },
];

// resolve frame specs into targets once, so everything downstream just reads pos and target
for (const s of SHOTS) {
  for (const k of s.keys) {
    if (k.frame && !k.target) {
      const P = typeof k.frame.P === 'function' ? k.frame.P(k.t) : k.frame.P;
      k.target = solveTarget(k.pos, P, k.frame.sx, k.frame.sy, s.lens);
    }
  }
}

// Monotone cubic through (ts, ys) at t: passes every key, never overshoots, a hold (two equal keys) stays still, and it
// starts and ends at rest. Inner tangents are the weighted harmonic mean of the neighbouring slopes (Fritsch-Butland),
// zero where the slope changes sign or one side is flat.
function monotone(ts, ys, t) {
  const n = ts.length;
  if (t <= ts[0]) return ys[0];
  if (t >= ts[n - 1]) return ys[n - 1];
  const d = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (ts[i + 1] - ts[i]));
  const m = ys.map(() => 0);
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) continue;
    const h0 = ts[i] - ts[i - 1], h1 = ts[i + 1] - ts[i], w0 = 2 * h1 + h0, w1 = h1 + 2 * h0;
    m[i] = (w0 + w1) / (w0 / d[i - 1] + w1 / d[i]);
  }
  let i = 0;
  while (t >= ts[i + 1]) i++;
  const h = ts[i + 1] - ts[i], s = (t - ts[i]) / h, s2 = s * s, s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * ys[i] + (s3 - 2 * s2 + s) * h * m[i] + (-2 * s3 + 3 * s2) * ys[i + 1] + (s3 - s2) * h * m[i + 1];
}

const ease = (u) => { u = Math.min(1, Math.max(0, u)); return 0.5 - 0.5 * Math.cos(Math.PI * u); };
const mix = (a, b, u) => a.map((v, i) => v + (b[i] - v) * u);

// Camera for shot `shot` at world time t.
export function cameraAt(shot, t) {
  if (shot.orbit) {
    const o = shot.orbit;
    const u = ease((t - shot.start) / (shot.end - shot.start));
    const az = o.az0 + (o.az1 - o.az0) * u;
    const pos = [o.c[0] + Math.sin(az * D2R) * o.r, o.y, o.c[2] - Math.cos(az * D2R) * o.r];
    return { pos, target: solveTarget(pos, o.frame.P, o.frame.sx, o.frame.sy, shot.lens), roll: 0, lens: shot.lens };
  }
  const k = shot.keys;
  if (t <= k[0].t || k.length === 1) return { pos: k[0].pos, target: k[0].target, roll: k[0].roll ?? 0, lens: shot.lens };
  if (shot.ease === 'spline') {
    const ts = k.map((x) => x.t), along = (get) => monotone(ts, k.map(get), t);
    return { pos: [0, 1, 2].map((j) => along((x) => x.pos[j])), target: [0, 1, 2].map((j) => along((x) => x.target[j])), roll: along((x) => x.roll ?? 0), lens: shot.lens };
  }
  let i = 0;
  while (i < k.length - 2 && k[i + 1].t <= t) i++;
  const a = k[i], b = k[i + 1];
  const lin = Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t)));
  const u = shot.ease === 'linear' ? lin : ease(lin);
  return { pos: mix(a.pos, b.pos, u), target: mix(a.target, b.target, u), roll: (a.roll ?? 0) + ((b.roll ?? 0) - (a.roll ?? 0)) * u, lens: shot.lens };
}

export const shotAt = (t) => SHOTS.find((s) => t >= s.start && t < s.end) ?? SHOTS[SHOTS.length - 1];

export const tcode = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
