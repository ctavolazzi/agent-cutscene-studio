// World state as pure functions of time. Nothing here keeps state, so the same t always gives the same answer.
// Compass headings: 0 north, 90 east, 180 south, 270 west. Positions are [x, z] on the ground, meters.
import { RAIL, MOON } from './set.js';

export const T_TOTAL = 112;
export const FPS = 24;

const clamp01 = (u) => Math.min(1, Math.max(0, u));
const smooth = (u) => { u = clamp01(u); return u * u * (3 - 2 * u); };
const lerp = (a, b, u) => a + (b - a) * u;

// ---------- car ----------
export const CAR = { length: 4.7, width: 1.8, height: 1.4 };
const WEST_LANE_Z = 17.5; // westbound traffic keeps right, which is the north half of the cross street
const NORTH_LANE_X = 2.2; // northbound traffic keeps right, which is the east half of the bridge street
const TURN_R = 3.0;
// The car (and its headlights) appear at 14.0, the cut into shot 3, already moving: switching on any earlier lights
// facades in shot 2's frame in one step. Before 14.0 it would have been at x 44 at 13.0, on the same path.
const X_START = 38.7;
const T_START = 14.0;
const SPEED_W = 5.3; // cruising on the cross street
const SPEED_TURN = 3.4; // through the corner
const X_BRAKE = 12.0; // brakes from here to the turn, so the speed never steps
const X_TURN = NORTH_LANE_X + TURN_R; // 5.2
const T_BRAKE = T_START + (X_START - X_BRAKE) / SPEED_W;
const T_TURN0 = T_BRAKE + (X_BRAKE - X_TURN) / ((SPEED_W + SPEED_TURN) / 2); // constant deceleration
const T_TURN1 = T_TURN0 + (Math.PI / 2 * TURN_R) / SPEED_TURN;
export const CAR_STOP = { x: NORTH_LANE_X, z: 1.85 }; // front bumper at z -0.5
export const T_CAR_STOP = 29.0;
const NORTH_Z0 = WEST_LANE_Z - TURN_R; // 14.5

// Doors open and shut on these times (eased). The people's keys below step clear of each door's swing.
const DOORS = {
  driver: { open0: 30.5, open1: 31.1, close0: 33.9, close1: 34.5 },
  passenger: { open0: 32.0, open1: 32.6, close0: 35.0, close1: 35.6 },
};
export const carTimes = { start: T_START, brake: T_BRAKE, turn0: T_TURN0, turn1: T_TURN1, stop: T_CAR_STOP, lightsOff0: 36.2, lightsOff1: 36.6, doors: DOORS };

// position is the center of the car
export function carAt(t) {
  if (t < T_START) return { x: X_START, z: WEST_LANE_Z, heading: 270, speed: 0, present: false };
  if (t < T_BRAKE) {
    const x = X_START - SPEED_W * (t - T_START);
    return { x, z: WEST_LANE_Z, heading: 270, speed: SPEED_W, present: true };
  }
  if (t < T_TURN0) {
    const dt = t - T_BRAKE, a = (SPEED_TURN - SPEED_W) / (T_TURN0 - T_BRAKE);
    return { x: X_BRAKE - (SPEED_W * dt + 0.5 * a * dt * dt), z: WEST_LANE_Z, heading: 270, speed: SPEED_W + a * dt, present: true };
  }
  if (t < T_TURN1) {
    const u = (t - T_TURN0) / (T_TURN1 - T_TURN0);
    const phi = u * Math.PI / 2;
    const cx = X_TURN, cz = WEST_LANE_Z - TURN_R;
    return { x: cx - TURN_R * Math.sin(phi), z: cz + TURN_R * Math.cos(phi), heading: 270 + 90 * u, speed: SPEED_TURN, present: true };
  }
  // A cubic that leaves the corner at SPEED_TURN and comes to rest at the stop: s(0) 0, s'(0) k, s(1) 1, s'(1) 0.
  const T = T_CAR_STOP - T_TURN1;
  const d = NORTH_Z0 - CAR_STOP.z;
  const k = SPEED_TURN * T / d;
  const u = clamp01((t - T_TURN1) / T);
  const s = d * (k * u + (3 - 2 * k) * u * u + (k - 2) * u * u * u);
  const v = (d / T) * (k + 2 * (3 - 2 * k) * u + 3 * (k - 2) * u * u);
  return { x: NORTH_LANE_X, z: NORTH_Z0 - s, heading: 0, speed: u >= 1 ? 0 : v, present: true };
}

// 0 to 1. Headlights come on with the car, fade out over 0.4 s once the doors are shut.
export function headlights(t) {
  if (t < T_START) return 0;
  if (t < carTimes.lightsOff0) return 1;
  return 1 - clamp01((t - carTimes.lightsOff0) / (carTimes.lightsOff1 - carTimes.lightsOff0));
}

// ---------- the two people ----------
// Keys carry time, ground position and pose. Between keys the position is a straight line, eased only where noted.
// face: body heading. look: head heading (what the eyes point at).
// Getting out: each person starts seated inside the car's body (hidden by it) once the door is fully open, slides
// out (pose 'emerge' to 'exit'), plants the outboard foot (A at 31.8, B at 33.2), rises to standing (the inboard foot
// lifts over the sill), then steps back past the door's edge before it shuts. Each door swings 70 degrees out about a
// hinge 0.95 m ahead of the car's centre, sweeping 1.1 m: driver hinge at (1.28, 0.90), passenger at (3.12, 0.90);
// a standing person stays more than 1.35 m from a hinge while its door moves.
const A_KEYS = [
  { t: 30.9, x: 1.7, z: 1.55, face: 0, look: 0, pose: 'emerge' }, // seated at the wheel, then swivels left to the door
  { t: 31.8, x: 1.0, z: 1.55, face: 270, look: 270, pose: 'exit' }, // out of the door, the left boot lands; the right follows (people.js EXIT.boot)
  { t: 32.4, x: 1.0, z: 1.55, face: 270, look: 270, pose: 'stand' }, // rises in place, clear of the car's west wall
  { t: 33.2, x: 0.65, z: 2.3, face: 220, look: 200, pose: 'stand' }, // walks clear of the open door
  { t: 33.8, x: 0.65, z: 2.3, face: 20, look: 30, pose: 'stand' }, // turns to swing the door shut (33.9 to 34.5)
  { t: 34.6, x: 0.65, z: 2.3, face: 0, look: 0, pose: 'stand' },
  // round the front of the car once the beams are out, then in beside B
  { t: 37.3, x: 0.65, z: -0.9, face: 0, look: 0, pose: 'walk' },
  { t: 37.8, x: 1.05, z: -1.3, face: 90, look: 90, pose: 'walk' },
  { t: 39.9, x: 3.6, z: -1.3, face: 90, look: 90, pose: 'walk' },
  { t: 40.6, x: 4.45, z: -1.0, face: 110, look: 110, pose: 'stand' },
  { t: 41.6, x: 4.55, z: -0.95, face: 0, look: 0, pose: 'stand' }, // turns toward the bridge
  { t: 44.5, x: 4.55, z: -0.95, face: 0, look: 0, pose: 'stand' },
  // A ahead and on the river side (east) of B, B trailing 1.3 m: seen from the street side (7), from in front on the
  // bridge (8) and from behind (9), A is screen left of B every time. Straight up the deck to the cut, then a curve in
  // to the rail: on that line the lamp post stays clear of A from shot 8's camera, and B walks 0.65 to 0.7 m west of
  // A, so that camera never lines them up one behind the other.
  { t: 54.0, x: 4.5, z: -6.8, face: 0, look: 0, pose: 'walk' },
  { t: 58.6, x: 4.5, z: -9.8, face: 0, look: 0, pose: 'walk' }, // A on the river side of B, as in shot 7
  { t: 60.0, x: 4.5, z: -10.7, face: 10, look: 10, pose: 'walk' },
  { t: 62.0, x: RAIL.x, z: RAIL.zA, face: 45, look: 45, pose: 'walk' },
  { t: 63.5, x: RAIL.x, z: RAIL.zA, face: 90, look: 90, pose: 'lean' },
  { t: 77.5, x: RAIL.x, z: RAIL.zA, face: 90, look: 90, pose: 'lean' },
  // turns into the lee (the wind is from 70, so the lee is about 250) to shield the flame: three-quarter profile to
  // shot 11. The lighter strikes once the turn and the cup are done (LIGHTER below).
  { t: 78.5, x: RAIL.x, z: RAIL.zA, face: 190, look: 245, pose: 'cup' },
  { t: 82.0, x: RAIL.x, z: RAIL.zA, face: 190, look: 245, pose: 'cup' },
  { t: 84.0, x: RAIL.x, z: RAIL.zA, face: 90, look: 90, pose: 'smoke' }, // 2 s to turn back: the cup faced 100 degrees away
  // One glance each (PLAN): B's is in shot 12; A's comes in shot 13, after the exhale at 90.0
  { t: 90.9, x: RAIL.x, z: RAIL.zA, face: 90, look: 90, pose: 'smoke' },
  { t: 91.7, x: RAIL.x, z: RAIL.zA, face: 90, look: 175, pose: 'smoke' },
  { t: 93.2, x: RAIL.x, z: RAIL.zA, face: 90, look: 175, pose: 'smoke' },
  { t: 94.2, x: RAIL.x, z: RAIL.zA, face: 90, look: 90, pose: 'smoke' },
  { t: 95.8, x: RAIL.x, z: RAIL.zA + 0.2, face: 90, look: 90, pose: 'smoke' }, // shoulders close in, inside shot 13
  { t: 112.0, x: RAIL.x, z: RAIL.zA + 0.2, face: 90, look: 90, pose: 'smoke' },
];
const B_KEYS = [
  { t: 32.2, x: 2.66, z: 1.55, face: 0, look: 0, pose: 'emerge' }, // seated, then swivels right to the door
  { t: 33.2, x: 3.3, z: 1.55, face: 90, look: 90, pose: 'exit' }, // out of the door, both boots on the ground outside
  { t: 33.8, x: 3.3, z: 1.55, face: 90, look: 90, pose: 'stand' }, // rises in place, clear of the car's east wall
  { t: 34.6, x: 3.33, z: 2.3, face: 165, look: 150, pose: 'stand' }, // walks onto the road, the last flat ground before the ramp
  { t: 35.0, x: 3.33, z: 2.3, face: 340, look: 330, pose: 'stand' }, // turns to swing the door shut (35.0 to 35.6)
  { t: 35.7, x: 3.33, z: 2.3, face: 30, look: 0, pose: 'stand' },
  { t: 37.8, x: 4.55, z: 0.35, face: 0, look: 0, pose: 'stand' },
  { t: 44.5, x: 4.55, z: 0.35, face: 0, look: 0, pose: 'stand' },
  { t: 54.0, x: 3.85, z: -5.5, face: 0, look: 0, pose: 'walk' },
  // straight on, 0.65 m west of A, and over the abutment's step on the sidewalk, 6 cm clear of the curb ramp
  { t: 57.6, x: 3.85, z: -8.4, face: 0, look: 0, pose: 'walk' },
  // B trails A across the deck: side by side from shot 8's camera, and at the cut far enough behind A that the
  // camera in 9, behind them, sees B clear of A
  { t: 60.0, x: 3.8, z: -9.25, face: 0, look: 0, pose: 'walk' },
  { t: 62.0, x: RAIL.x, z: RAIL.zB, face: 55, look: 55, pose: 'walk' },
  { t: 63.5, x: RAIL.x, z: RAIL.zB, face: 90, look: 90, pose: 'lean' },
  { t: 85.0, x: RAIL.x, z: RAIL.zB, face: 90, look: 90, pose: 'lean' },
  { t: 86.0, x: RAIL.x, z: RAIL.zB, face: 90, look: 0, pose: 'lean' }, // glances at A, holds, looks back before the cut
  { t: 87.7, x: RAIL.x, z: RAIL.zB, face: 90, look: 0, pose: 'lean' },
  { t: 88.7, x: RAIL.x, z: RAIL.zB, face: 90, look: 90, pose: 'lean' },
  { t: 94.2, x: RAIL.x, z: RAIL.zB, face: 90, look: 90, pose: 'lean' },
  { t: 95.8, x: RAIL.x, z: RAIL.zB - 0.2, face: 90, look: 90, pose: 'lean' }, // shoulders close in, inside shot 13
  { t: 112.0, x: RAIL.x, z: RAIL.zB - 0.2, face: 90, look: 90, pose: 'lean' },
];

function angLerp(a, b, u) {
  let d = ((b - a + 540) % 360) - 180;
  return (a + d * u + 360) % 360;
}

function sampleKeys(keys, t) {
  if (t < keys[0].t) return null;
  const last = keys[keys.length - 1];
  if (t >= last.t) return { ...last };
  let i = 0;
  while (keys[i + 1].t <= t) i++;
  const a = keys[i], b = keys[i + 1];
  const u = (t - a.t) / (b.t - a.t);
  // a segment is a walk only if it covers real ground: faster than 0.2 m/s. The slow 0.2 m shoulder lean-in at the rail is not a walk.
  const dist = Math.hypot(b.x - a.x, b.z - a.z);
  const moving = dist > 0.01 && dist / (b.t - a.t) > 0.2;
  // getting out, the body starts fast and eases into the doorway, so the feet clear the car's wall while still low
  const uRoot = a.pose === 'emerge' ? 1 - Math.pow(1 - u, 1.5) : u; // a gentle start, so the feet move less than 7 cm a frame
  const getOut = a.pose === 'emerge' || a.pose === 'exit'; // sliding out of the car and rising are not walks
  return {
    t,
    x: lerp(a.x, b.x, moving ? uRoot : smooth(u)),
    z: lerp(a.z, b.z, moving ? uRoot : smooth(u)),
    face: angLerp(a.face, b.face, smooth(u)),
    look: angLerp(a.look, b.look, smooth(u)),
    pose: moving && !getOut ? 'walk' : a.pose,
  };
}

export const PEOPLE = {
  A: { height: 1.8, coat: 'long dark coat, bare head', tone: '#1c2234' },
  B: { height: 1.68, coat: 'puffy jacket, knit beanie, scarf', tone: '#6a7a96' },
};

export function peopleAt(t) {
  return { A: sampleKeys(A_KEYS, t), B: sampleKeys(B_KEYS, t) };
}
export const PEOPLE_KEYS = { A: A_KEYS, B: B_KEYS };

// ---------- moon and light ramps ----------
const MOON_EL = [
  { t: 0, el: -12 },
  { t: 60, el: -4 },
  { t: 66, el: -1.2 },
  { t: 68, el: 0.2 },
  { t: 76, el: 5.0 },
  { t: 112, el: 9.0 },
];
export function moonAt(t) {
  let el = MOON_EL[MOON_EL.length - 1].el;
  for (let i = 0; i < MOON_EL.length - 1; i++) {
    const a = MOON_EL[i], b = MOON_EL[i + 1];
    if (t >= a.t && t < b.t) { el = lerp(a.el, b.el, smooth((t - a.t) / (b.t - a.t))); break; }
  }
  return { azimuthDeg: MOON.azimuthDeg, elevationDeg: el, visible: el > 0 };
}
// moonlight is zero until the moon clears the haze, then ramps up over about 8 s
export function moonlight(t) { return smooth((t - 68) / 8); }

// fade from black over the first 3 s
export function fadeIn(t) { return smooth(t / 3); }
// lighter flame: about 1.5 s of flicker, then the ember takes over. It strikes after A's turn into the lee and the cup.
export const LIGHTER = { t0: 78.6, t1: 80.1 };
export const lighterOn = (t) => t >= LIGHTER.t0 && t < LIGHTER.t1;
export const emberOn = (t) => t >= LIGHTER.t1;
// Flame flicker from t alone, between 0.5 and 1. The light (fx/lights.js) and the flame card (fx/smoke.js) share it.
export const lighterFlicker = (t) => 0.75 + 0.25 * Math.sin(t * 37) * Math.sin(t * 23.3);
// The ember holds steady once lit and brightens for 0.8 s on each drag. The drag at 89.2 ends as A exhales at 90.0.
export const EMBER = { drags: [80.2, 89.2, 97.0], dragDur: 0.8, dragGain: 2.0 };
// 0 before the ember catches, 1 when steady, up to 1 + dragGain at the middle of a drag.
export function emberLevel(t) {
  if (!emberOn(t)) return 0;
  let bump = 0;
  for (const d of EMBER.drags) {
    const u = (t - d) / EMBER.dragDur;
    if (u > 0 && u < 1) bump = Math.max(bump, Math.sin(Math.PI * u) ** 2);
  }
  return 1 + EMBER.dragGain * bump;
}
// A exhales; smoke drifts for 2 to 3 s
export const EXHALE = { t: 90.0, life: 2.8 };

// Smoke as a pure function of time. `origin` is the cigarette tip, world meters. Drifts toward the west-south-west.
// Two kinds: a thin wisp from the ember once it has caught, and the cloud A exhales at EXHALE.t.
export function smokePuffs(t, origin) {
  const lee = [-Math.sin(70 * Math.PI / 180), -Math.cos(70 * Math.PI / 180) * -1]; // unit drift, x then z: from ENE toward WSW
  const out = [];
  if (t >= LIGHTER.t1 + 0.5) {
    const period = 3.6;
    for (let i = 0; i < 8; i++) {
      const age = (((t - 80 - i * 0.45) % period) + period) % period;
      out.push({ kind: 'wisp', age, pos: [origin[0] + lee[0] * 0.12 * age + 0.03 * Math.sin(age * 4 + i), origin[1] + 0.16 * age, origin[2] + lee[1] * 0.12 * age + 0.03 * Math.cos(age * 3.3 + i)], r: 0.015 + 0.02 * age, alpha: 0.4 * (1 - age / period) });
    }
  }
  for (let i = 0; i < 7; i++) {
    const age = t - (EXHALE.t + i * 0.18);
    if (age < 0 || age >= EXHALE.life) continue;
    out.push({ kind: 'exhale', age, pos: [origin[0] + lee[0] * 0.5 * age, origin[1] + 0.25 * age + 0.05 * Math.sin(age * 3 + i), origin[2] + lee[1] * 0.5 * age], r: 0.06 + 0.1 * age, alpha: 0.45 * (1 - age / EXHALE.life) });
  }
  return out;
}
