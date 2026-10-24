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
import { RAIL, LAMP } from './set.js';
import { peopleAt, carAt } from './world.js';
import { makePoser, bodyToWorld } from './actors/people.js';

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

const headMid = (t) => { const p = peopleAt(t); return [(p.A.x + p.B.x) / 2, 1.6, (p.A.z + p.B.z) / 2]; };
const pairHeads = [RAIL.x, 1.6, (RAIL.zA + RAIL.zB) / 2];
const pairWaist = [RAIL.x, 1.0, (RAIL.zA + RAIL.zB) / 2];
const lampHead = LAMP.head;
const lampFoot = [LAMP.base[0], 0.15, LAMP.base[1]]; // where the post meets the sidewalk
const AHead = [RAIL.x, 1.7, RAIL.zA], BHead = [RAIL.x, 1.58, RAIL.zB];
// the cigarette tip where the people rig puts it in shot 14, so the insert is composed on the ember the light sits at
const AEmber = (() => { const q = makePoser('A')(98); return bodyToWorld(q, q.tip); })();

const s2a = [0.0, 2.2, 62.0];
const s2b = (() => { const d = ahead([0, 0, 0], 354, 1.5, 0); return [s2a[0] + d[0], 2.0, s2a[2] + d[2]]; })();
const s15a = [-2.0, 3.0, -7.4];
// pulls back along 245 degrees: the parked car's nose and the city window behind the lantern stay out of the end frame
const s15b = (() => { const d = ahead([0, 0, 0], 245, 2.0, 0); return [s15a[0] + d[0], 3.5, s15a[2] + d[2]]; })();

export const SHOTS = [
  {
    n: 1, start: 0, end: 7, lens: 50, title: 'The lamp',
    framing: 'Close on the lamp head against the black sky',
    // moved 1.5 m south with the lamp (Gate 2, 1c), so it sees the lantern exactly as before: the lantern's turn is set
    // for this line of sight, and from the old spot the plate hid most of the bulb
    keys: [{ t: 0, pos: [2.0, 1.1, -0.9], frame: { P: lampHead, sx: 0.36, sy: 0.3 } }],
    move: null,
    action: 'Fade in from black over 3 s. Snow swirls through the lamp light. Lamp light only.',
    sketchAt: 4.0, subject: lampHead, side: 'n/a',
  },
  {
    n: 2, start: 7, end: 14, lens: 24, title: 'The empty street',
    framing: 'Wide, south end of the street on the centreline, looking north to the bridge and river',
    keys: [
      { t: 7, pos: s2a, frame: { P: lampHead, sx: 0.667, sy: 0.44 } },
      { t: 14, pos: s2b, frame: { P: lampHead, sx: 0.667, sy: 0.44 } },
    ],
    move: { kind: 'push', label: 'slow dolly in, 1.5 m' },
    action: 'Nothing moves but the snow. Hold the stillness. The corner building is the dark mass at right.',
    sketchAt: 7.2, subject: lampHead, side: 'n/a',
  },
  {
    n: 3, start: 14, end: 22, lens: 35, title: 'Light before the car',
    framing: 'Wide from the west sidewalk, facing the south-east corner building',
    // the pan starts as the car's nose clears the corner (17.7), so it follows the car instead of overtaking it
    keys: [
      { t: 14, pos: [-5.0, 1.7, 33.0], target: [15, 1.5, 23] },
      { t: 17.4, pos: [-5.0, 1.7, 33.0], target: [15, 1.5, 23] },
      { t: 21.9, pos: [-5.0, 1.7, 33.0], target: [3.0, 1.2, 8.0] },
    ],
    move: { kind: 'pan', dir: 'left', label: 'locked, then a pan left with the car (toward the bridge)' },
    action: 'Beams sweep the facades first. The car noses out from behind the corner building and turns north.',
    sketchAt: 16.4, insets: [{ t: 17.8, label: '0:17.8 the car noses out' }, { t: 21.9, label: '0:21.9 pan done, car turned north' }],
    subject: () => { const c = carAt(18.8); return [c.x, 0.7, c.z]; }, side: 'west',
  },
  {
    n: 4, start: 22, end: 29, lens: 24, title: 'The car arrives',
    framing: 'Snow level at the lamp base, looking south down the street at the approaching car',
    // 2 m north of the post, which stands in the snow on the left third: the car comes down the lane right of it
    keys: [
      { t: 22, pos: [4.5, 0.25, -6.5], frame: { P: lampFoot, sx: 0.33, sy: 0.6 } },
      { t: 29, pos: [4.5, 0.25, -6.5], frame: { P: lampFoot, sx: 0.27, sy: 0.72 } },
    ],
    move: { kind: 'tilt', dir: 'up', label: 'small tilt up as the car arrives' },
    action: 'The car drives toward the camera and the lamp. Beams fill with lit snow. It stops about 6 m away.',
    sketchAt: 26.2, subject: () => { const c = carAt(26.2); return [c.x, 0.7, c.z]; }, side: 'west',
  },
  {
    n: 5, start: 29, end: 40, lens: 35, title: 'Feet in the snow',
    framing: 'Ground level beside the car, framed on the door bottoms, driver side',
    // Holds on the driver's door while A gets out and B lands beyond the car, then backs away from the car (west and
    // south) turning toward the bridge with A, and comes north past the car's front to end looking across its nose at
    // A walking into the lamp light. From the hold the front wheel sits 2.25 m off at 48 degrees, between the door and
    // the bridge, so any turn sweeps it; backing away keeps it small (at most 5.9% of the frame, against 19% when the
    // camera trucked past it). A's feet stay in frame and clear of the car from 34.6 s to the end; both beams' lit
    // patches are in frame and clear of the car from 36.2 to 36.6; the camera stays between 0.25 and 0.4 m up and the
    // turn peaks under 26 degrees a second. Found by a search over camera paths (BUILD_LOG, S3 round 2, shot 5).
    ease: 'spline',
    keys: [
      { t: 29, pos: [-0.3, 0.25, 1.9], target: [3.7, -0.1, 1.9], roll: 3 },
      { t: 33.5, pos: [-0.3, 0.25, 1.9], target: [3.7, -0.1, 1.9], roll: 0 },
      { t: 35.3, pos: [-1.6, 0.35, 2.8], target: [2.77, 0.61, 0.38], roll: 0 },
      { t: 36.4, pos: [-1.55, 0.4, 1.4], target: [1.64, -0.21, -2.4], roll: 0 },
      { t: 40, pos: [-1.25, 0.35, -0.65], target: [3.13, -0.26, -2.98], roll: 0 },
    ],
    move: { kind: 'truck', dir: 'left', label: 'hold on the door, roll settling to level, then back away from the car turning toward the bridge with A, and come north past its nose' },
    action: 'A door opens, a boot lands, prints stay. B lands on the far side, seen under the car. Doors close. Headlights cut at 0:36. Lamp light only.',
    sketchAt: 32.4, insets: [{ t: 33.4, label: '0:33.4 B lands, seen under the car' }, { t: 36.4, label: '0:36.4 headlights cut' }, { t: 39.6, label: '0:39.6 lamp light only' }],
    subject: () => [0.8, 0.3, 1.45], side: 'west',
  },
  {
    n: 6, start: 40, end: 46, lens: 35, title: 'The reveal',
    framing: 'Medium wide ahead of the car and off to the west, chest height',
    keys: [{ t: 40, pos: [-2.0, 1.35, -5.5], frame: { P: [4.55, 1.5, -0.3], sx: 0.64, sy: 0.38 } }],
    move: null,
    action: 'They stand in the lamp light beside the dark car. They look north toward the bridge, off frame left.',
    sketchAt: 44.0, subject: () => [4.55, 1.0, -0.3], side: 'west',
  },
  {
    n: 7, start: 46, end: 54, lens: 35, title: 'The walk',
    framing: 'Side tracking shot from the street side',
    ease: 'linear', // the dolly keeps pace with the walk instead of easing in and out against it
    keys: [
      { t: 46, pos: [0.0, 1.3, -1.5], frame: { P: headMid, sx: 0.62, sy: 0.29 } },
      { t: 54, pos: [0.0, 1.3, -6.4], frame: { P: headMid, sx: 0.62, sy: 0.29 } },
    ],
    move: { kind: 'truck', dir: 'left', label: 'dolly parallel to their walk (toward the bridge)' },
    action: 'They walk toward the bridge, through the lamp pool. Footprints trail behind.',
    sketchAt: 52.0, subject: () => headMid(52), side: 'west',
  },
  {
    n: 8, start: 54, end: 60, lens: 50, title: 'Onto the bridge',
    framing: 'Three-quarter from the bridge deck, looking back south at them, so the pair reads side by side',
    // off the pair's line of walk (x 5.3 put A in front of B; x 1 put A in front of the lamp): a three-quarter view.
    // x 4.8 with A walking straight up the deck at x 4.5: the lamp post stands just left of A the whole shot (at x 4.0
    // it sat inside A from 56 s and rose out of A's head at the cut), and the lantern hangs above and behind A.
    keys: [{ t: 54, pos: [4.8, 1.5, -22.0], frame: { P: headMid(57), sx: 0.5, sy: 0.54 } }],
    move: null,
    action: 'They walk toward the camera onto the bridge. The lamp behind them is a warm rim light on lit snow.',
    sketchAt: 57.0, subject: () => headMid(57), side: 'north end of the line',
  },
  {
    n: 9, start: 60, end: 68, lens: 35, title: 'The railing',
    framing: 'Over their shoulders from behind as they reach the east railing, from the south-west',
    orbit: { c: pairHeads, r: 3.8, az0: 232, az1: 217, y: 1.75, frame: { P: pairHeads, sx: 0.36, sy: 0.5 } },
    keys: [],
    move: { kind: 'arc', label: 'slow 15 degree arc around them' },
    action: 'They stop and lean forearms on the wide concrete railing. River and the city banks beyond.',
    sketchAt: 64.5, subject: pairHeads, side: 'west',
  },
  {
    n: 10, start: 68, end: 76, lens: 85, title: 'Moonrise',
    framing: 'Long lens from the open plaza west of the bridge head, on the horizon',
    keys: [{ t: 68, pos: [-19.0, 2.5, -7.9], frame: { P: pairWaist, sx: 0.3, sy: 0.7 } }],
    move: null,
    action: 'The crescent moon rises over the river between the city banks. They are small at the railing. Moonlight grows into a cool rim.',
    sketchAt: 75.5, insets: [{ t: 68.3, label: '1:08 the moon at the haze line' }], subject: pairWaist, side: 'west',
  },
  {
    n: 11, start: 76, end: 84, lens: 50, title: 'The lighter',
    framing: 'Medium close on A, three-quarter profile, B shoulder in the foreground, from the south-west',
    keys: [{ t: 76, pos: [3.8, 1.5, -8.4], frame: { P: AHead, sx: 0.56, sy: 0.38 } }],
    move: null,
    action: 'A turns into the lee and cups both hands. The lighter flickers orange on hands and face. The ember catches.',
    sketchAt: 79.2, insets: [{ t: 83.8, label: '1:23.8 the ember, A turned back' }], subject: AHead, side: 'west',
  },
  {
    n: 12, start: 84, end: 89, lens: 70, title: 'B looks',
    framing: 'Reverse medium close on B from the north-west end of the line',
    // 70mm for a medium close on B; 0.35 m west of the line through the pair, so B's hand on the parapet clears A's coat
    keys: [{ t: 84, pos: [3.45, 1.5, -13.4], frame: { P: BHead, sx: 0.48, sy: 0.42 } }],
    move: null,
    action: 'B glances at A, holds the look for a beat, then looks back out at the city.',
    sketchAt: 87.5, subject: BHead, side: 'west',
  },
  {
    n: 13, start: 89, end: 96, lens: 35, title: 'Smoke and glance',
    framing: 'Rear three-quarter two-shot from the west, a little south of square on, both visible',
    keys: [
      { t: 89, pos: [-1.0, 1.5, -8.0], frame: { P: pairHeads, sx: 0.5, sy: 0.36 } },
      { t: 96, pos: [-0.45, 1.5, -8.23], frame: { P: pairHeads, sx: 0.5, sy: 0.36 } },
    ],
    move: { kind: 'push', label: 'very slow push in' },
    action: 'A exhales. Smoke drifts through lamp light and moonlight. A glance, and the shoulders lean closer.',
    sketchAt: 91.5, subject: pairHeads, side: 'west',
  },
  {
    n: 14, start: 96, end: 100, lens: 85, title: 'Ember and smoke',
    framing: 'Insert on the ember and smoke in the backlight, from the north end of the line, snow passing',
    keys: [{ t: 96, pos: [4.8, 1.55, -13.8], frame: { P: AEmber, sx: 0.45, sy: 0.5 } }],
    move: null,
    action: 'A quiet beat.',
    sketchAt: 98.0, subject: AEmber, side: 'west',
  },
  {
    n: 15, start: 100, end: 112, lens: 24, title: 'Under the lamp',
    framing: 'Final wide from the bridge entrance, behind them and a little south, slightly high, looking east down the river',
    keys: [
      { t: 100, pos: s15a, frame: { P: pairHeads, sx: 0.28, sy: 0.62 } },
      { t: 108, pos: s15b, frame: { P: pairHeads, sx: 0.28, sy: 0.62 } },
      { t: 112, pos: s15b, frame: { P: pairHeads, sx: 0.28, sy: 0.62 } },
    ],
    move: { kind: 'pull', label: 'slow dolly back with a slight rise, then hold for the last 4 s' },
    action: 'Two people at the railing under the lamp, the moon over the river, city lights along both banks, snow drifting.',
    sketchAt: 101.0, subject: pairHeads, side: 'west',
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
