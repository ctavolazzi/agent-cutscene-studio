// The two people, A and B, at blockout level: capsules, a head sphere, a nose cone and shoes that show facing.
// Placement, body heading, head turn and pose come from peopleAt(t) and PEOPLE_KEYS only; nothing is carried
// between calls. Each person is a root group built facing -Z with rotation.y = -face, so in the body frame forward
// is -Z and right is +X. Every limb segment is a child of that root, placed at its upper joint and turned so its
// local -Y runs down the bone. Joint positions come from the pure solvers below, which keeps the rig flat and testable.
import { peopleAt, PEOPLE, PEOPLE_KEYS } from '../world.js';
import { STREET, CROSS, BRIDGE } from '../set.js';

const D2R = Math.PI / 180;
const clamp01 = (u) => Math.min(1, Math.max(0, u));
const smooth = (u) => { u = clamp01(u); return u * u * (3 - 2 * u); };
const lerp = (a, b, u) => a + (b - a) * u;

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const lerp3 = (a, b, u) => [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)];

// Proportions of a 1.80 m figure, meters. Each person scales every one of them by height / 1.8.
export const BODY = {
  hipY: 0.93, // hip joints when standing
  hipHalf: 0.095,
  ankleY: 0.07, // ankle point above the ground; the shoe sits under it
  thigh: 0.44,
  shin: 0.42, // thigh + shin = hipY - ankleY, so a straight leg stands exactly on the ground
  shoulderUp: 0.54, // shoulder joints above the hip, measured along the torso
  neckUp: 0.65, // base of the head above the hip, along the torso
  headR: 0.11, // crown at hipY + neckUp + 2 headR = 1.80
  upperArm: 0.3,
  forearm: 0.28,
  handR: 0.05,
  thighR: 0.075,
  shinR: 0.055,
  shoe: { w: 0.1, h: 0.08, l: 0.26, toe: 0.07 }, // toe: how far the shoe's centre sits ahead of the ankle
  shadowR: 0.38,
};

// A: narrow long coat, hem below the knee. B: wide, short, puffy jacket, beanie and scarf. Heights are standing heights.
// The torso capsule runs from `waist` to the head. A's coat continues below it as a skirt that hangs from the hips, so
// bending forward does not swing the hem out behind like a tail; `flare` widens it toward the hem.
const STYLE = {
  A: { torsoR: 0.165, waist: 0.8, hem: 0.42, flare: 1.3, width: 1.12, depth: 0.8, shoulderHalf: 0.19, upperArmR: 0.052, forearmR: 0.045, coat: 'coatA', legs: 'trousersA', top: 'hairA' },
  B: { torsoR: 0.215, waist: 0.8, hem: 0.8, width: 1.08, depth: 0.92, shoulderHalf: 0.215, upperArmR: 0.068, forearmR: 0.058, coat: 'jacketB', legs: 'trousersB', top: 'beanieB', scarf: 'scarfB' },
};
const SKIRT_FOLLOW = 0.3; // the skirt takes this share of the torso pitch

// Walk: hip swing and arm counter-swing in degrees, knee flex on the leg swinging through. The cycle length follows
// from the swing, so a stance foot travels as far as the body does. Swing fades in and out over `ramp` meters.
export const WALK = { swingDeg: 20, kneeDeg: 30, armDeg: 16, ramp: 0.35 };
// Getting out of the car (see world.js). 'emerge': seated in the car facing ahead, feet in the footwell, the coat skirt
// laid over the thighs, so the whole body sits inside the car's body boxes and nothing pops into view. 'exit': turned to
// the door and half risen, the outboard foot planted outside (outSide: -1 left for the driver, +1 right for the
// passenger). Heights here are the car's, in meters, not scaled with the person.
// skirtDeg is the skirt's rotation in the torso's sign convention (positive lets the hem swing back), so the coat
// lies forward over the thighs at a negative angle: -88 puts the hem about 0.3 m above the ground, clear of the car floor.
// `boot`: who puts one boot down first (PLAN 3.9, "A's boot lands"). At the exit key that person's inboard foot is still
// up, `up` m over its landing spot and `back` m nearer the car, and it steps down over the first `down` of the rise to
// standing, on its own clock. B lands on both boots at once, under the car in shot 5.
export const EMERGE = { hipY: 0.52, pitchDeg: 5, skirtDeg: -88, feetAhead: 0.45, handY: 0.77 };
export const EXIT = { hipFrac: 0.75, pitchDeg: 25, outSide: { A: -1, B: 1 }, boot: { A: { up: 0.21, back: 0.04, down: 0.45 } } };
// A seated foot's height in the footwell: ankle height, the sole 7 cm lower and still above the shell's 0.25 m underside.
export const SILL = { y: 0.36 };
// Getting out moves the feet on their own clock. The feet travel out to the door first, at sill height, and only once
// the body has got clear of the car's wall (FOOT_DROP, in the change's own time) do they come down to the ground. So a
// foot is never low while it is still under the wall. A foot at sill height is 0.29 m up, above the 0.25 m underside.
const FOOT_OUT = 0.5, FOOT_DROP = 0.56;
// At the east parapet: hands rest on the top, in world terms, because the parapet does not scale with the person.
// `pole` is the elbow's pole for the right arm, in the rail frame; the left arm mirrors it.
export const LEAN = { pitchDeg: 12, reach: 0.55, side: 0.19, handY: BRIDGE.parapetTop + 0.02, pole: [1, -0.2, 0.1] };
// What a person changes in LEAN, per held pose. The shared lean suits B. A is 12 cm taller: on it A's elbows stood
// 14 cm over the top and the forearms sloped 25 degrees down to the hands, arms reaching rather than resting. A's own
// lean pitches further over and reaches further, with the elbows pulled down and forward, so the forearms lie on the
// top. A cups and smokes from the shared torso (the lighter and the cigarette are placed from A's head); smoking, A's
// chest turns a little to the right, toward B, which brings the left shoulder forward far enough for that forearm to
// rest on the top too.
export const LEAN_OF = {
  A: { lean: { pitchDeg: 24, reach: 0.56, side: 0.13, pole: [1, -0.9, 0] }, smoke: { twistDeg: 25, reach: 0.62, side: 0.18, pole: [0.2, -1, 0] } },
  B: {},
};
const leanOf = (id, name) => ({ ...LEAN, ...LEAN_OF[id][name] });
// The east parapet's inner face. Every lean and smoke key faces it square on (face 90), which the test asserts.
export const PARAPET_INNER = BRIDGE.halfWidth - BRIDGE.parapetThick;
const RAIL_CLEAR = 0.02; // a hand going on or off the parapet passes its near edge this far clear
// No arm bone goes into the parapet: over it, every point of both bones stays `y` above its top. The guard eases in
// over `ramp` meters in front of the inner face. The held poses rest the elbows above the top (A's 1 to 5 cm, B's about
// 9), so it never moves them; it acts only while an arm is on its way.
const ARM_CLEAR = { y: 0.005, ramp: 0.03 };
// A hand coming onto the parapet from below its top (or leaving it downward) rises to a point above its near edge
// (the first share of the arm's move), then crosses over the top (the rest); the two overlap a little so the hand does
// not stop at the edge. A hand coming from above the top (the cupped hands) goes straight. The two paths blend over
// `blend` meters of the other end's height, so nothing jumps.
const VIA = { up: 0.65, over: 0.55, blend: 0.1 };
// In a pose change the hands arrive at this share of the segment, ahead of the body. Onto the parapet they take the
// whole turn: the routed path is long, and the hands land as the body comes square to the rail.
const ARM_LEAD = { lean: 1, stand: 1, other: 0.6 }; // stand: the hands come up with the body out of the door, not ahead of it
const TABLE_RATE = 120; // distance and support table samples per second
const CURB_RAMP = 0.3; // meters over which a step up or down the curb happens
const STEP_SMOOTH = 0.3; // seconds over which the hips rise onto a step up (see makeSupportTable)
const SWING_SEE = 0.3; // meters ahead of the shoe that a swinging foot clears

const STATIC = { stand: 'stand', walk: 'stand', emerge: 'emerge', exit: 'exit', lean: 'lean', cup: 'cup', smoke: 'smoke' };

// Heading difference wrapped to -180..180 (180 maps to -180).
export const wrapDeg = (a) => ((((a + 180) % 360) + 360) % 360) - 180;

// Height of the walking surface: the curb-high sidewalks, else road and deck at 0. Ramped across each edge so a
// step up the curb is a short rise, not a 15 cm jump.
const band = (v, a, b, w) => smooth((v - a + w / 2) / w) * smooth((b + w / 2 - v) / w);
export function groundY(x, z) {
  const across = band(Math.abs(x), STREET.roadHalf, STREET.walkOuter, CURB_RAMP);
  const along = Math.max(band(z, BRIDGE.z0, CROSS.z0, CURB_RAMP), band(z, CROSS.z1, STREET.zSouth, CURB_RAMP));
  return STREET.curb * across * along;
}

// Analytic two-bone IK. From root S toward target T with bone lengths a then b; the middle joint bends toward the
// pole direction. Out-of-reach targets are clamped, so the chain stops short along the line. Arrays in, arrays out.
export function solveTwoBone(S, T, a, b, pole) {
  const d = sub(T, S);
  const dl = len(d);
  const u = dl > 1e-9 ? mul(d, 1 / dl) : [0, -1, 0];
  const r = Math.min(Math.max(dl, Math.abs(a - b) + 1e-9), a + b - 1e-9);
  const x = (a * a - b * b + r * r) / (2 * r);
  const h = Math.sqrt(Math.max(0, a * a - x * x));
  let p = sub(pole, mul(u, dot(pole, u)));
  let pl = len(p);
  if (pl < 1e-9) { p = Math.abs(u[2]) < 0.9 ? [-u[1], u[0], 0] : [0, -u[2], u[1]]; pl = len(p); }
  p = mul(p, 1 / pl);
  return { joint: add(S, add(mul(u, x), mul(p, h))), end: add(S, mul(u, r)) };
}

// solveTwoBone, but the elbow keeps the bones out of an obstacle. `dip(points)` says how far the deepest of the given
// points is inside it (0 when clear). If the plain solve dips, the pole takes the smallest upward pull that clears,
// found by bisection, so the elbow swings up about the shoulder-hand line just enough. Pure: same inputs, same answer.
const LIFT = { max: 20, steps: 20 };
export function solveArm(S, T, a, b, pole, dip) {
  const pl = len(pole) || 1;
  const at = (lam) => solveTwoBone(S, T, a, b, [pole[0] / pl, pole[1] / pl + lam, pole[2] / pl]);
  const depth = (sol) => dip([0.25, 0.5, 0.75, 1].flatMap((f) => [lerp3(S, sol.joint, f), lerp3(sol.joint, sol.end, f)]));
  const plain = at(0);
  if (depth(plain) <= 0) return plain;
  let lo = 0, hi = LIFT.max;
  if (depth(at(hi)) > 0) return at(hi);
  for (let i = 0; i < LIFT.steps; i++) {
    const mid = (lo + hi) / 2;
    if (depth(at(mid)) > 0) lo = mid; else hi = mid;
  }
  return at(hi);
}

// A point on the torso: `x` across it and `up` along its axis from the hip, after a twist about that axis (positive
// turns the chest to the right) and then a forward pitch, both radians. Same order as the torso group's XYZ Euler.
function onTorso(hip, pitch, twist, x, up) {
  const xt = x * Math.cos(twist), zt = x * Math.sin(twist);
  const c = Math.cos(pitch), s = Math.sin(pitch);
  return [hip[0] + xt, hip[1] + up * c + zt * s, hip[2] - up * s + zt * c];
}

// Scaled dimensions for one person.
function dims(id) {
  const k = PEOPLE[id].height / 1.8;
  const D = {};
  for (const [key, v] of Object.entries(BODY)) if (typeof v === 'number') D[key] = v * k;
  const S = STYLE[id];
  return {
    ...D, k, id,
    torsoR: S.torsoR * k, waist: S.waist * k, hem: S.hem * k, shoulderHalf: S.shoulderHalf * k,
    upperArmR: S.upperArmR * k, forearmR: S.forearmR * k, coatHalf: S.torsoR * S.width * k,
    cycle: 4 * (D.thigh + D.shin) * Math.sin(WALK.swingDeg * D2R),
  };
}

const headOf = (R, hip, pitch) => add(onTorso(hip, pitch, 0, 0, R.neckUp), [0, R.headR, 0]);
const faceDirs = (yawDeg) => {
  const y = yawDeg * D2R;
  return { fwd: [Math.sin(y), 0, -Math.cos(y)], right: [Math.cos(y), 0, Math.sin(y)] };
};
// A vector given in a frame turned `deg` degrees clockwise (seen from above) from the body, in the body frame.
const turn = (v, deg) => {
  const h = deg * D2R, c = Math.cos(h), s = Math.sin(h);
  return [c * v[0] - s * v[2], v[1], s * v[0] + c * v[2]];
};

// Hands hanging from the shoulders, swung forward by `swing` radians, elbows slightly bent and pointing back.
function hangingArms(R, hip, pitch, swing = [0, 0]) {
  return [-1, 1].map((side, i) => {
    const sh = onTorso(hip, pitch, 0, side * R.shoulderHalf, R.shoulderUp);
    const l = 0.97 * (R.upperArm + R.forearm);
    return { target: add(sh, [side * 0.04 * R.k, -l * Math.cos(swing[i]), -l * Math.sin(swing[i])]), pole: [side * 0.3, 0, 1] };
  });
}
// A forearm resting on the parapet, in the rail frame: square to the parapet, from the key that holds the pose.
// `deg` turns the rail frame into the body frame; settle() decides how much of that turn the hand takes. The elbow
// pole turns with it, so the elbow points out, a little down and back, away from the wall once the body is square.
// A stronger downward pull drops B's lower elbows into the parapet top. `via` is the point the hand passes going on
// or off from below: beside the coat, just above the top, at the parapet's near edge. Coming up beside the coat, not
// in front of it, matters for B, whose puffy jacket nearly touches the parapet.
function railHand(side, R, rail, L) {
  const c = R.handR + RAIL_CLEAR;
  return {
    deg: rail.deg, face: rail.face, viaMax: rail.wall - c,
    target: [side * L.side, L.handY - rail.rootY, -L.reach],
    via: [side * Math.max(L.side, R.coatHalf + c), BRIDGE.parapetTop + c - rail.rootY, -(rail.wall - c)],
    pole: [side * L.pole[0], L.pole[1], L.pole[2]],
  };
}
// A rail hand in the body frame. With w = 1 its spot is fixed to the parapet; with w = 0 it turns with the body.
// A pose change gives each end its own blend weight, so a hand on the parapet stays put, and a hand on its way
// there aims in front of the body first and settles onto the parapet spot as it arrives. `via` never sits closer to
// the parapet face than a hand's clearance (world x), so the climb to it, from a hand below the top, cannot cut the wall.
function settle(h, w) {
  if (h.deg === undefined) return h;
  const via = turn(h.via, h.deg * w);
  const c = Math.cos(h.face * D2R), s = Math.sin(h.face * D2R);
  const over = c * via[0] - s * via[2] - h.viaMax;
  if (over > 0) { via[0] -= c * over; via[2] += s * over; }
  return { target: turn(h.target, h.deg * w), via, pole: turn(h.pole, h.deg * w) };
}
const KNEES = (side) => [side * 0.1, 0, -1];
// Hands raised to the face: elbows down, forward and a little out.
const RAISED = (side) => [side * 0.5, -1, -0.5];
// With the hands at the face the shoulders follow the gaze part of the way, so a hand in front of a face turned far
// over one shoulder does not fold that arm flat. The head still turns by look - face relative to the body.
const TWIST = 0.4;

// The held poses in the body frame: pelvis, torso pitch (forward positive), ankle targets, hand targets and poles.
// `rail` places the parapet: the rail frame's turn from the body (deg), the body heading (face), the ground under the
// root and how far east of the root the parapet's inner face is (wall), which is forward in the rail frame.
function staticPose(name, R, yawDeg, rail) {
  const k = R.k;
  if (name === 'emerge') {  // (getOut: see FOOT_OUT)
    // seated, facing ahead: both feet on the footwell floor in front of the seat, hands in the lap, the coat over the
    // thighs. The turn to the door then carries the feet a few tens of centimetres, not across the car.
    const hip = [0, EMERGE.hipY, 0.04 * k];
    return {
      getOut: true, hip, pitch: EMERGE.pitchDeg * D2R, twist: 0, skirt: EMERGE.skirtDeg * D2R,
      feet: [-1, 1].map((side) => ({ target: [side * R.hipHalf, SILL.y, -EMERGE.feetAhead * k], pole: KNEES(side) })),
      hands: [-1, 1].map((side) => ({ target: [side * 0.16 * k, EMERGE.handY, -0.3 * k], pole: [0, -0.4, -1] })), // hands in the lap, elbows forward, clear of the coat and the cabin
    };
  }
  if (name === 'exit') {
    // out of the door, turned to it: the outboard foot on the ground outside the car, the inboard one beside it (or, with
    // EXIT.boot, still coming down to that spot), the hips low in the doorway, the hands close to where they stand.
    // Feet down first, then the body rises between them: in place, and no foot has to cross the sill once it is down.
    const s = EXIT.outSide[R.id];
    const hip = [0, EXIT.hipFrac * R.hipY, 0.04 * k];
    const pitch = EXIT.pitchDeg * D2R;
    const feet = [-1, 1].map((side) => ({ target: [side * (R.hipHalf + 0.01 * k), R.ankleY, -0.05 * k], pole: KNEES(side) }));
    const boot = EXIT.boot[R.id];
    if (boot) {
      // the inboard foot is still on its way down: `late` gives it its own clock out of this key (see blendPose)
      const f = feet[s < 0 ? 1 : 0];
      f.target = add(f.target, [0, boot.up, boot.back]);
      f.late = boot.down;
    }
    return {
      getOut: true, hip, pitch, twist: 0,
      feet,
      hands: [{ target: [s * 0.2 * k, 0.66 * k, -0.2 * k], pole: [s * 0.6, -0.4, 0] }, { target: [-s * 0.2 * k, 0.8 * k, -0.25 * k], pole: [-s * 0.6, -0.4, 0] }] // sideways poles: between 'emerge' (forward) and 'stand' (back) the blend passes through neither, so no elbow flips
        .sort((a, b) => a.target[0] - b.target[0]), // left hand first
    };
  }
  if (name === 'lean' || name === 'cup' || name === 'smoke') {
    const L = leanOf(R.id, name);
    const hip = [0, R.hipY, 0.02 * k];
    const pitch = L.pitchDeg * D2R;
    const feet = [-1, 1].map((side) => ({ target: [side * R.hipHalf, R.ankleY, 0.02 * k], pole: KNEES(side) }));
    const head = headOf(R, hip, pitch);
    const { fwd, right } = faceDirs(yawDeg);
    let hands = [railHand(-1, R, rail, L), railHand(1, R, rail, L)];
    let twist = 0;
    if (name === 'cup') {
      // both hands cupped in front of the face, wherever the head is turned
      const cup = add(add(head, mul(fwd, 0.2 * k)), [0, -0.1 * k, 0]);
      hands = [-1, 1].map((side) => ({ target: add(cup, mul(right, side * 0.07 * k)), pole: RAISED(side) }));
      twist = TWIST * yawDeg * D2R;
    } else if (name === 'smoke') {
      // right hand at the mouth, left forearm still on the parapet
      hands = [railHand(-1, R, rail, L), { target: add(add(head, mul(fwd, 0.1 * k)), [0, -0.1 * k, 0]), pole: RAISED(1) }];
      // the chest starts turned twistDeg and follows the gaze from there, reaching the cup's share (TWIST) when the
      // head is turned 90 degrees, so a glance to the right does not wring the arm on the parapet down into it
      const base = L.twistDeg ?? 0;
      twist = (base + ((TWIST * 90 - base) * yawDeg) / 90) * D2R;
    }
    return { hip, pitch, twist, feet, hands };
  }
  const hip = [0, R.hipY, 0];
  return {
    hip, pitch: 0, twist: 0,
    feet: [-1, 1].map((side) => ({ target: [side * R.hipHalf, R.ankleY, 0], pole: KNEES(side) })),
    hands: hangingArms(R, hip, 0),
  };
}

// Body moves over the whole change; hands lead, and bow out a little on the way so they pass clear of the coat.
// A hand coming up onto the parapet (or going down off it) goes by its `via` point instead, so it never cuts the wall.
function blendPose(p, q, u, k, lead) {
  const wb = smooth(u), a = clamp01(u / lead), wa = smooth(a), bow = 4 * wa * (1 - wa);
  const skirtOf = (P) => P.skirt ?? P.pitch * SKIRT_FOLLOW;
  // getting out: a foot's ground position moves in the first half (FOOT_OUT), its height only from FOOT_DROP on
  const getOut = p.getOut || q.getOut;
  const wx = getOut ? smooth(clamp01(u / FOOT_OUT)) : wb, wy = getOut ? smooth(clamp01((u - FOOT_DROP) / (1 - FOOT_DROP))) : wb;
  return {
    hip: lerp3(p.hip, q.hip, wb),
    pitch: lerp(p.pitch, q.pitch, wb),
    twist: lerp(p.twist, q.twist, wb),
    skirt: lerp(skirtOf(p), skirtOf(q), getOut ? wy : wb), // the hem lies forward until the body is clear, then falls
    feet: p.feet.map((f, i) => {
      const g = q.feet[i];
      // a foot left up at the key it leaves (EXIT.boot) steps down first, landing at `late` of this change
      const wl = f.late ? smooth(clamp01(u / f.late)) : null;
      const target = [lerp(f.target[0], g.target[0], wl ?? wx), lerp(f.target[1], g.target[1], wl ?? wy), lerp(f.target[2], g.target[2], wl ?? wx)];
      return { target, pole: lerp3(f.pole, g.pole, wb) };
    }),
    hands: p.hands.map((h0, i) => {
      const h = settle(h0, 1 - wa), g = settle(q.hands[i], wa), pole = lerp3(h.pole, g.pole, wa);
      const straight = add(lerp3(h.target, g.target, wa), mul([(i ? 1 : -1) * 0.04 * k, 0, -0.1 * k], bow));
      if (!h.via === !g.via) return { target: straight, pole };
      const via = h.via ?? g.via, other = h.via ? g : h;
      const routed = lerp3(lerp3(h.target, via, smooth(a / VIA.up)), g.target, smooth((a - VIA.over) / (1 - VIA.over)));
      const relax = smooth((other.target[1] - via[1]) / VIA.blend + 0.5);
      return { target: lerp3(routed, straight, relax), pole };
    }),
  };
}

function keySegment(keys, t) {
  if (t < keys[0].t) return null;
  const last = keys.length - 1;
  if (t >= keys[last].t) return { a: keys[last], b: keys[last], u: 0 };
  let i = 0;
  while (keys[i + 1].t <= t) i++;
  return { a: keys[i], b: keys[i + 1], u: (t - keys[i].t) / (keys[i + 1].t - keys[i].t) };
}

// Cumulative ground distance along peopleAt, sampled once, plus the stretches where the pose is a walk.
// The walk phase and the swing envelope read these, so both are pure functions of t.
function makeWalkTable(id) {
  const keys = PEOPLE_KEYS[id];
  const t0 = keys[0].t, t1 = keys[keys.length - 1].t;
  const n = Math.ceil((t1 - t0) * TABLE_RATE) + 1;
  const dist = new Float64Array(n);
  const walking = new Uint8Array(n);
  let prev = peopleAt(t0)[id];
  walking[0] = prev.pose === 'walk' ? 1 : 0;
  for (let i = 1; i < n; i++) {
    const s = peopleAt(Math.min(t1, t0 + i / TABLE_RATE))[id];
    dist[i] = dist[i - 1] + Math.hypot(s.x - prev.x, s.z - prev.z);
    walking[i] = s.pose === 'walk' ? 1 : 0;
    prev = s;
  }
  // each stretch is widened by one sample so its ends sit on the standing samples either side
  const stretches = [];
  for (let i = 0; i < n; i++) {
    if (!walking[i]) continue;
    let j = i;
    while (j + 1 < n && walking[j + 1]) j++;
    const a = Math.max(0, i - 1), b = Math.min(n - 1, j + 1);
    stretches.push({ t0: t0 + a / TABLE_RATE, t1: t0 + b / TABLE_RATE, d0: dist[a], d1: dist[b] });
    i = j;
  }
  const distanceAt = (t) => {
    const f = (t - t0) * TABLE_RATE;
    if (f <= 0) return 0;
    if (f >= n - 1) return dist[n - 1];
    const i = Math.floor(f);
    return dist[i] + (dist[i + 1] - dist[i]) * (f - i);
  };
  return {
    distanceAt,
    stretches,
    // distance into the current stretch and the swing envelope, 0 outside any stretch
    walkAt(t) {
      const d = distanceAt(t);
      for (const s of stretches) {
        if (t < s.t0 || t > s.t1) continue;
        return { along: d - s.d0, env: smooth((d - s.d0) / WALK.ramp) * smooth((s.d1 - d) / WALK.ramp) };
      }
      return { along: 0, env: 0 };
    },
  };
}

// The walking legs at sample s (from peopleAt) and w (from walkAt): thigh swing and knee flex per leg, how far each
// ankle hangs below the hips and sits ahead of them, and the ground under each shoe (world y). A walk's held pose is
// standing, so the hips are over the root. `support` is the ground height the hips ride on (world y): they sit at
// support + ankle height + the longer leg's drop, so no shoe is below its own ground and the lower one stands on it.
function walkGait(R, s, w) {
  const phase = (2 * Math.PI * w.along) / R.cycle;
  const th = WALK.swingDeg * D2R * w.env * Math.sin(phase);
  const kn = WALK.kneeDeg * D2R * w.env;
  const thigh = [th, -th];
  const knee = [kn * Math.max(0, Math.cos(phase)), kn * Math.max(0, -Math.cos(phase))];
  const reach = [0, 1].map((i) => R.thigh * Math.cos(thigh[i]) + R.shin * Math.cos(thigh[i] - knee[i]));
  const ahead = [0, 1].map((i) => R.thigh * Math.sin(thigh[i]) + R.shin * Math.sin(thigh[i] - knee[i]));
  const hc = Math.cos(s.face * D2R), hs = Math.sin(s.face * D2R), toe = BODY.shoe.toe * R.k;
  const at = (x, fwd) => groundY(s.x + hc * x + hs * fwd, s.z + hs * x - hc * fwd); // body right x, forward fwd
  const ground = [0, 1].map((i) => at((i ? 1 : -1) * R.hipHalf, ahead[i] + toe));
  // A swinging foot clears what it is about to land on: its floor is the highest ground under its shoe and SWING_SEE
  // ahead of it, in proportion to its knee flex, so a planted foot (no flex) stands on the ground under its shoe.
  // Only the foot rises for it, not the hips.
  const floor = [0, 1].map((i) => {
    const x = (i ? 1 : -1) * R.hipHalf, c = ahead[i] + toe;
    let high = ground[i];
    const heel = c - (BODY.shoe.l / 2) * R.k, span = BODY.shoe.l * R.k + SWING_SEE;
    for (let j = 0; j <= 6; j++) high = Math.max(high, at(x, heel + (j / 6) * span));
    // the clearance ramps in with the walk (w.env): at the first step, a planted foot is not lifted to the ground ahead
    return ground[i] + (high - ground[i]) * Math.max(0, (i ? -1 : 1) * Math.cos(phase)) * w.env; // the leg's own flex (knee[i] / kn)
  });
  const flat = Math.max(reach[0], reach[1]);
  return { phase, thigh, knee, reach, ahead, ground, floor, flat, support: Math.max(ground[0] + reach[0], ground[1] + reach[1]) - flat };
}

// The hips' support height while walking, as a pure function of t: the raw support from walkGait, sampled once, and
// its mean over the last STEP_SMOOTH seconds. supportAt(t) takes the lower of the two, so a step down follows the feet
// and a step up the curb rises over that time instead of in a frame; a shoe left below its ground bends its knee.
function makeSupportTable(id, R, table) {
  const keys = PEOPLE_KEYS[id];
  const t0 = keys[0].t, t1 = keys[keys.length - 1].t;
  const n = Math.ceil((t1 - t0) * TABLE_RATE) + 1;
  const raw = (t) => {
    const s = peopleAt(Math.min(Math.max(t, t0), t1))[id];
    const w = s.pose === 'walk' ? table.walkAt(s.t) : { env: 0 };
    return w.env > 0 ? walkGait(R, s, w).support : groundY(s.x, s.z);
  };
  const sum = new Float64Array(n); // running integral of the raw support, trapezoids
  let prev = raw(t0);
  for (let i = 1; i < n; i++) {
    const cur = raw(t0 + i / TABLE_RATE);
    sum[i] = sum[i - 1] + (prev + cur) / (2 * TABLE_RATE);
    prev = cur;
  }
  const first = raw(t0), last = raw(t1);
  const integral = (t) => {
    const f = (t - t0) * TABLE_RATE;
    if (f <= 0) return f / TABLE_RATE * first;
    if (f >= n - 1) return sum[n - 1] + (f - (n - 1)) / TABLE_RATE * last;
    const i = Math.floor(f);
    return sum[i] + (sum[i + 1] - sum[i]) * (f - i);
  };
  return (t, now) => Math.min(now, (integral(t) - integral(t - STEP_SMOOTH)) / STEP_SMOOTH);
}

// Pose solver for one person. Returns pose(t): every joint in the body frame, plus where the body stands.
// Pure: the only data built here are the distance and support tables, and pose(t) reads nothing else that changes.
export function makePoser(id) {
  const R = dims(id);
  const keys = PEOPLE_KEYS[id];
  const table = makeWalkTable(id);
  const supportAt = makeSupportTable(id, R, table);
  return function pose(t) {
    const live = peopleAt(t)[id];
    // hidden people still get a fixed, fully solved pose (the first key), so no transform depends on call order
    const s = live ?? { ...keys[0], t };
    const y = groundY(s.x, s.z);
    const yawDeg = wrapDeg(s.look - s.face);
    const seg = keySegment(keys, s.t) ?? { a: keys[0], b: keys[0], u: 0 };
    const from = STATIC[seg.a.pose], to = STATIC[seg.b.pose];
    // each held pose places the parapet from its own key, so hands on it stay put while the body turns
    const railOf = (key) => ({ deg: key.face - s.face, face: s.face, rootY: y, wall: PARAPET_INNER - s.x });
    let P = staticPose(from, R, yawDeg, railOf(seg.a));
    P = from !== to
      ? blendPose(P, staticPose(to, R, yawDeg, railOf(seg.b)), seg.u, R.k, ARM_LEAD[to] ?? ARM_LEAD.other)
      : { ...P, hands: P.hands.map((h) => settle(h, 1)) };

    // the ground under a body-frame point, relative to the ground under the root: each shoe stands on its own ground
    const hc = Math.cos(s.face * D2R), hs = Math.sin(s.face * D2R), toe = BODY.shoe.toe * R.k;
    const lift = (v) => groundY(s.x + hc * v[0] - hs * v[2], s.z + hs * v[0] + hc * v[2]) - y;
    // how far body-frame points sit inside the east parapet, below its top; ramped in just in front of its inner face
    const dip = (pts) => {
      let d = 0;
      for (const v of pts) {
        const wx = s.x + hc * v[0] - hs * v[2], wz = s.z + hs * v[0] + hc * v[2];
        if (wz >= BRIDGE.z0 || wz <= BRIDGE.z1 || wx >= BRIDGE.halfWidth) continue;
        d = Math.max(d, (BRIDGE.parapetTop + ARM_CLEAR.y - y - v[1]) * smooth((wx - PARAPET_INNER + ARM_CLEAR.ramp) / ARM_CLEAR.ramp));
      }
      return d;
    };

    let { hip } = P;
    const { pitch, twist } = P;
    const skirt = P.skirt ?? pitch * SKIRT_FOLLOW;
    let legs, hands = P.hands;
    const w = s.pose === 'walk' ? table.walkAt(t) : { along: 0, env: 0 };
    if (w.env > 0) {
      // swing the thighs and flex the knee of the leg passing through; the hips ride on the support height
      const g = walkGait(R, s, w);
      hip = [hip[0], R.ankleY + g.flat + supportAt(t, g.support) - y, hip[2]];
      legs = [-1, 1].map((side, i) => {
        const h = [hip[0] + side * R.hipHalf, hip[1], hip[2]];
        const kj = add(h, [0, -R.thigh * Math.cos(g.thigh[i]), -R.thigh * Math.sin(g.thigh[i])]);
        const a = g.thigh[i] - g.knee[i];
        const ankle = add(kj, [0, -R.shin * Math.cos(a), -R.shin * Math.sin(a)]);
        const floor = R.ankleY + g.floor[i] - y;
        if (ankle[1] >= floor - 1e-7) return { hip: h, knee: kj, ankle }; // a stance foot on its floor stays straight
        // the hips are still rising onto a step: this shoe stands on its ground and the knee takes up the rest. The
        // pole is straight ahead, the plane the swing bends the knee in, so the hand-over from the swing is seamless.
        const { joint, end } = solveTwoBone(h, [ankle[0], floor, ankle[2]], R.thigh, R.shin, [0, 0, -1]);
        return { hip: h, knee: joint, ankle: end };
      });
      const arm = WALK.armDeg * D2R * w.env * Math.sin(g.phase);
      hands = hangingArms(R, hip, pitch, [-arm, arm]); // each arm swings against its own leg
    } else {
      legs = P.feet.map((f, i) => {
        const h = [hip[0] + (i ? 1 : -1) * R.hipHalf, hip[1], hip[2]];
        const target = add(f.target, [0, lift([f.target[0], 0, f.target[2] - toe]), 0]);
        const { joint, end } = solveTwoBone(h, target, R.thigh, R.shin, f.pole);
        return { hip: h, knee: joint, ankle: end };
      });
    }
    const arms = hands.map((hd, i) => {
      const sh = onTorso(hip, pitch, twist, (i ? 1 : -1) * R.shoulderHalf, R.shoulderUp);
      const { joint, end } = solveArm(sh, hd.target, R.upperArm, R.forearm, hd.pole, dip);
      return { shoulder: sh, elbow: joint, hand: end };
    });
    const head = headOf(R, hip, pitch);
    const { fwd } = faceDirs(yawDeg);
    const mouth = add(add(head, mul(fwd, 0.1 * R.k)), [0, -0.1 * R.k, 0]);
    return {
      visible: Boolean(live), x: s.x, y, z: s.z, face: s.face, look: s.look, yawDeg, pose: s.pose,
      hip, pitch, twist, skirt, legs, arms, head, mouth,
      cup: add(add(head, mul(fwd, 0.2 * R.k)), [0, -0.1 * R.k, 0]), // the lighter flame, between the cupped hands
      // The cigarette's lit end: it sits in the lips and points 0.1 m along the gaze, so the flame at `cup` lights it,
      // and in the smoke pose it is 0.1 m past the right hand at the mouth, clear of the hand (r 0.05) and the head.
      // The ember light and the smoke start here.
      tip: add(mouth, mul(fwd, 0.1 * R.k)),
      walk: w,
    };
  };
}

// Body frame to world: rotate by -face about +Y, then move to the ground position.
export function bodyToWorld(p, v) {
  const h = p.face * D2R, c = Math.cos(h), s = Math.sin(h);
  return [p.x + c * v[0] - s * v[2], p.y + v[1], p.z + s * v[0] + c * v[2]];
}

// Every material the people use, in one place, so Stage 4 can swap them for the PS1 patch.
function makeMaterials(THREE) {
  const lambert = (color) => new THREE.MeshLambertMaterial({ color });
  return {
    coatA: lambert('#2a3145'),
    trousersA: lambert('#1c1f28'),
    hairA: lambert('#1b1614'),
    jacketB: lambert('#7d8db0'),
    trousersB: lambert('#3b455c'),
    beanieB: lambert('#b5584a'),
    scarfB: lambert('#c79a45'),
    skin: lambert('#b49c8a'),
    shoe: lambert('#121317'),
    shadow: new THREE.MeshBasicMaterial({
      color: '#000000', transparent: true, opacity: 0.45, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4,
    }),
  };
}

export function buildPeople(ctx) {
  const { THREE, scene } = ctx;
  const mats = makeMaterials(THREE);
  const DOWN = new THREE.Vector3(0, -1, 0);
  const dir = new THREE.Vector3(); // scratch, fully overwritten before every use

  const mesh = (geo, mat, name, parent, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.name = name;
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };
  const group = (name, parent) => {
    const g = new THREE.Group();
    g.name = name;
    parent.add(g);
    return g;
  };
  // A bone: a group at the upper joint holding a capsule down its local -Y, from `radius` above the joint to `tip`
  // below it. By default both rounded ends are centred on the joints, so neighbouring bones share a sphere there.
  const bone = (name, parent, length, radius, mat, tip = length + radius) => {
    const g = group(name, parent);
    mesh(new THREE.CapsuleGeometry(radius, tip - radius, 3, 10), mat, `${name}-mesh`, g, 0, (radius - tip) / 2, 0);
    return g;
  };
  const aim = (g, from, to) => {
    g.position.set(from[0], from[1], from[2]);
    const d = sub(to, from), l = len(d) || 1;
    dir.set(d[0] / l, d[1] / l, d[2] / l);
    g.quaternion.setFromUnitVectors(DOWN, dir);
  };

  const people = ['A', 'B'].map((id) => {
    const R = dims(id), S = STYLE[id], k = R.k;
    const name = `person-${id}`;
    const root = group(name, scene);

    const disc = new THREE.CircleGeometry(R.shadowR, 20);
    disc.rotateX(-Math.PI / 2);
    const shadow = mesh(disc, mats.shadow, `${name}-shadow`, root, 0, 0.012, 0);
    shadow.renderOrder = 1;

    // torso pivots at the hip; the capsule runs from the waist to the base of the head
    const torso = group(`${name}-torso`, root);
    const top = R.hipY + R.neckUp;
    const coat = mesh(new THREE.CapsuleGeometry(R.torsoR, top - R.waist - 2 * R.torsoR, 4, 12), mats[S.coat], `${name}-coat`, torso, 0, (R.waist + top) / 2 - R.hipY, 0);
    coat.scale.set(S.width, 1, S.depth);
    let skirt = null;
    if (R.hem < R.waist) {
      // its top tucks 3 cm up inside the torso capsule
      const h = R.hipY + 0.03 * k - R.hem;
      skirt = group(`${name}-skirt`, root);
      const m = mesh(new THREE.CylinderGeometry(R.torsoR * 0.98, R.torsoR * S.flare, h, 12), mats[S.coat], `${name}-coat-skirt`, skirt, 0, 0.03 * k - h / 2, 0);
      m.scale.set(S.width, 1, S.depth);
    }
    if (S.scarf) {
      const wrap = new THREE.TorusGeometry(0.09 * k, 0.04 * k, 6, 12);
      wrap.rotateX(Math.PI / 2);
      mesh(wrap, mats[S.scarf], `${name}-scarf`, torso, 0, R.neckUp - 0.035 * k, 0);
      // the hanging end, tipped back to lie on the curve of the jacket
      const tail = mesh(new THREE.BoxGeometry(0.08 * k, 0.18 * k, 0.03 * k), mats[S.scarf], `${name}-scarf-tail`, torso, 0.05 * k, R.neckUp - 0.21 * k, -0.2 * k);
      tail.rotation.x = 0.12;
    }

    const head = group(`${name}-head`, root);
    mesh(new THREE.SphereGeometry(R.headR, 12, 8), mats.skin, `${name}-skull`, head);
    const nose = new THREE.ConeGeometry(0.025 * k, 0.06 * k, 6);
    nose.rotateX(-Math.PI / 2); // tip toward -Z, the way the head faces
    mesh(nose, mats.skin, `${name}-nose`, head, 0, -0.015 * k, -(R.headR + 0.02 * k));
    if (S.top === 'hairA') {
      // a cap over the crown and the back of the head, leaving the face clear
      const hair = mesh(new THREE.SphereGeometry(R.headR * 1.04, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.42), mats.hairA, `${name}-hair`, head);
      hair.rotation.x = 0.45;
    } else {
      const beanie = mesh(new THREE.SphereGeometry(R.headR * 1.08, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.5), mats.beanieB, `${name}-beanie`, head, 0, 0.012 * k, 0);
      beanie.rotation.x = 0.2;
    }

    const limbs = [-1, 1].map((side) => {
      const tag = side < 0 ? 'L' : 'R';
      const footG = group(`${name}-foot-${tag}`, root);
      const sh = BODY.shoe;
      mesh(new THREE.BoxGeometry(sh.w * k, sh.h * k, sh.l * k), mats.shoe, `${name}-shoe-${tag}`, footG, 0, -R.ankleY + (sh.h * k) / 2, -sh.toe * k);
      const handG = group(`${name}-hand-${tag}`, root);
      mesh(new THREE.SphereGeometry(R.handR, 8, 6), mats.skin, `${name}-hand-${tag}-mesh`, handG);
      return {
        thigh: bone(`${name}-thigh-${tag}`, root, R.thigh, R.thighR, mats[S.legs]),
        shin: bone(`${name}-shin-${tag}`, root, R.shin, R.shinR, mats[S.legs]),
        foot: footG,
        upper: bone(`${name}-upperarm-${tag}`, root, R.upperArm, R.upperArmR, mats[S.coat]),
        fore: bone(`${name}-forearm-${tag}`, root, R.forearm, R.forearmR, mats[S.coat], R.forearm), // the sleeve stops at the wrist
        hand: handG,
      };
    });

    return { root, torso, skirt, head, limbs, pose: makePoser(id) };
  });

  return {
    update(t) {
      for (const p of people) {
        const q = p.pose(t);
        p.root.visible = q.visible;
        p.root.position.set(q.x, q.y, q.z);
        p.root.rotation.set(0, -q.face * D2R + 0, 0);
        p.torso.position.set(q.hip[0], q.hip[1], q.hip[2]);
        p.torso.rotation.set(-q.pitch, -q.twist + 0, 0); // XYZ order: twist about the torso axis, then pitch forward
        if (p.skirt) {
          p.skirt.position.set(q.hip[0], q.hip[1], q.hip[2]);
          p.skirt.rotation.set(-q.skirt, 0, 0);
        }
        p.head.position.set(q.head[0], q.head[1], q.head[2]);
        p.head.rotation.set(0, -q.yawDeg * D2R + 0, 0);
        p.limbs.forEach((l, i) => {
          const leg = q.legs[i], arm = q.arms[i];
          aim(l.thigh, leg.hip, leg.knee);
          aim(l.shin, leg.knee, leg.ankle);
          l.foot.position.set(leg.ankle[0], leg.ankle[1], leg.ankle[2]);
          aim(l.upper, arm.shoulder, arm.elbow);
          aim(l.fore, arm.elbow, arm.hand);
          l.hand.position.set(arm.hand[0], arm.hand[1], arm.hand[2]);
        });
      }
    },
  };
}
