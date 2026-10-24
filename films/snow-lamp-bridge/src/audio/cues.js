// The sound effects as one catalogue, derived from the picture's data (SOUND-PLAN.md 4.1). Every time and place comes
// from a call to the picture's functions and tables; every other number is a named designed value or rule below, and
// each cue lists which of its fields are designed. Built once at import by makeCues(world) and frozen: pure, no clocks,
// seeded randomness only through the project's rngFor pattern. The parked layers in layers/ are not read for timing.
// Gate 0 as applied here: the engine runs down at carTimes.lightsOff0 with no key click (question 2, option b: Sound 1.1
// measured the idle shake on screen, a 1 to 2 px flicker of the car's edges); nothing before the car's first light, the
// engine rising out of the quiet (question 3, a); the new cues of SOUND-PLAN 3.8 in, the offered ones listed, disabled.
// No propagation delay and no Doppler, by convention (SOUND-PLAN 3.15): a cue sounds at its time wherever it is.
// A cue's `source` is its voice group: cues of one group never overlap, so one voice per group cuts nothing.
import { CONFIG } from '../config.js';
import { mulberry32, hashString } from '../prng.js';
import * as world from '../world.js';
import * as set from '../set.js';
import * as shots from '../shots.js';
import * as car from '../actors/car.js';
import * as people from '../actors/people.js';
import * as footprints from '../fx/footprints.js';
import { SPATIAL } from './spatial.js';
import { surfaceOf } from './layers/foley.js';

// Everything the cues read from the picture, in one object, so makeCues can be handed another picture.
export const WORLD = Object.freeze({ ...world, ...set, ...shots, ...car, ...people, ...footprints });

// Distance laws (spatial.js placeAt): the camera hears every cue; the gentler laws are cheats kept on purpose (3.4).
// A cue's `law` is a key into this table.
export const LAWS = Object.freeze({
  physical: Object.freeze({ refDist: SPATIAL.refDist, rolloff: 1 }), // 6 dB a doubling: the lamp's hum
  car: Object.freeze({ refDist: 3, rolloff: 0.6 }), // the one loud thing, heard across the set
  door: Object.freeze({ refDist: 2, rolloff: 0.8 }),
  foley: Object.freeze({ refDist: 2.5, rolloff: 0.7 }), // small sounds a film mix keeps close
});
// The law each placed family is heard by (designed): the car's sounds by the car law (the ticks too, which today's
// layer leaves on the physical law), the doors by their own, the people's small sounds by foley, the hum physical.
const LAW_OF = { engine: 'car', arrival: 'car', tyres: 'car', brake: 'car', settle: 'car', stop: 'car', tick: 'car', door: 'door', cabin: 'foley', unload: 'foley', feet: 'foley', scuff: 'foley', moves: 'foley', lighter: 'foley', drag: 'foley', breath: 'foley', hum: 'physical' };

// Designed levels in dB, from the level plan (SOUND-PLAN 1.3). A voice's level is at its law's refDist against the
// street background (0 dB); a modifier's (voices 0: the rise, the swell, the ambience changes) is the change it makes.
// Starting values: where one level per cue cannot meet a rule at every framing, the shortfall is a Sound 2 question.
export const LEVELS = Object.freeze({
  // 1.3 street background: the reference, wind and city summing to 0 dB
  street: Object.freeze({ wind: -1, city: -7 }),
  // 1.3 bridge background: one designed step of +2.5 dB over the street, at the place change, the water in it
  bridge: Object.freeze({ wind: 0.5, city: -7, water: -3.5 }),
  // 1.3 the car while it moves on screen: at least 6 LU over the street background, never quieter as it comes closer
  intake: 16, exhaust: 13.5, tyres: 9, brake: 6, swell: 3,
  // 1.3 the idle: at least 6 LU under the drive
  intakeIdle: 8, exhaustIdle: 5.5,
  // 1.3 the engine's first light (question 3): rises out of the quiet from this far down
  rise: -30,
  // 1.3 foreground foley: peaks at least 6 dB over the background in a 100 ms window, at the distances its shots
  // frame it (shot 8's far steps and shot 13's drag and exhale at 7 m fall short: perspective, Sound 2 and 5)
  door: 13, rundown: 10, feet: 14, feetBoth: 17, lighter: 10, drag: 9.5, breath: 9.5,
  // 1.3 midground (cloth, scuffs, ticks, sounds inside the car, the hands' contacts, a door's swing and stop): 0 to 6 dB
  // over the background where each is framed (cloth at 3 to 5 m in shots 7, 9 and 11); farther, the distance law rules
  creak: 5, settle: 4, rebound: 0, unload: 3, cabin: 3, tick: 5, scuff: 6, cloth: 6, contact: 7, doorSwing: 6, flame: 4,
  // 1.3 the lamp's hum: the physical law from the lamp, just over the bed in shot 1, where it is the only placed sound
  hum: 13,
  // the story ambiences (1.3 arc): the wind eases at moonrise, the night opens on the last wide; held small for the score
  windEase: -2, nightOpen: 1.5,
  // offered, default out (3.8): the idle louder while a door is open
  idleDoor: 3,
});

// Designed timings and rules, each named where it is used.
const DOOR = { unlatchLead: 0.06, stop: 0.2, latch: 0.25 }; // the latch lets go just before the swing; the stop and the shut ring on
const ENGINE = { idleRpm: 780, rpmPerMs: 300, rise: 2.5, cruise: 0.45, perMs2: 0.3, idleLoad: 0.06 }; // load from acceleration
const CREAK = { speed: 0.35 }; // m/s: the pads creak over the last stretch under this, to the stop (replaces "stop - 0.55")
const CABIN = { beltLead: 0.5, belt: 0.4, handbrake: 0.4 }; // each belt comes off, and is done, before that person's door opens
const TICK = { delay: 1.1, gap: 1.2, grow: 0.35, jitter: 1.5, dur: 0.06 }; // further apart as the metal cools
const STEP = { flam: 0.03, tail: 0.3 }; // one person's contacts closer than `flam` are one step (both boots)
// a planted ankle sliding faster than `speed` m/s (a centred difference over one audio sample each side) for `min` m
const SCUFF = { speed: 0.1, min: 0.05 };
const TURN = { minDeg: 30 }; // a held pose turning this far is a turn (cloth)
const SHIFT = { min: 0.05 }; // a held pose moving the root this far is a shift (the shoulders closing in)
const CLOTH = { up: 1.2 }; // cloth sounds at the poser's root plus 1.2 m (SOUND-PLAN 4.1)
// A contact from the rig: the first instant the touching parts come within `px` internal pixels of how they sit at the
// key, at their depth from the shot's camera. The vertex snap rounds every vertex to the nearest pixel, so a part this
// close to where it stops is drawn there: the contact leads the first frame that shows it at rest. The forearms' rest:
// a hand against its place on the parapet at the lean key (5.9 mm for A, 5.0 mm for B in shot 9: 63.4484 and 63.4509,
// 9.9 and 7.4 ms ahead of frame 1523, the first to show the hands at rest; the 2 cm readings, 63.403 and 63.399, lead
// it by 56 and 59 ms, past the 45 ms of BT.1359, and the 1 mm readings, 63.479 and 63.478, trail it by 21 and 20 ms).
// The cup: the gap between A's hands against its width at the cup key (2.6 mm in shot 11), the hands closing round the
// lighter at 78.0693, 14.1 ms ahead of frame 1874.
const CONTACT = { px: 0.5, tail: 0.25 };
const LIGHTER_CUE = { strikeLead: 0.07, release: 0.1 }; // the wheel and flint, before the flame they light
const SR = CONFIG.audio.sr; // contacts from the rig are bisected on the audio sample grid
const D2R = Math.PI / 180;

// Allocator inputs (SOUND-PLAN 3.13), designed, by family (or the row a cue names): higher priority keeps its voice;
// the backgrounds are never stolen.
const PRIORITY = { wind: 120, city: 120, water: 120, hum: 110, engine: 100, lighter: 96, door: 90, stop: 90, feet: 80, breath: 78, drag: 76, brake: 72, tyres: 70, settle: 66, unload: 60, cabin: 56, contact: 54, moves: 44, scuff: 40, tick: 34, arrival: 0, ambience: 0 };
// The reverb bit per family (3.13), designed: the car and the doors ring in the street; steps in snow stay dry.
const REVERB = { engine: true, stop: true, tyres: false, brake: true, settle: true, unload: false, cabin: false, door: true, tick: true, feet: false, scuff: false, moves: false, contact: false, lighter: false, drag: false, breath: false, wind: false, city: false, water: false, ambience: false, hum: true, arrival: false };

// The designed tables, for the tests and the storyboard to read.
export const DESIGN = Object.freeze(Object.fromEntries(Object.entries({ DOOR, ENGINE, CREAK, CABIN, TICK, STEP, SCUFF, TURN, SHIFT, CLOTH, CONTACT, LIGHTER: LIGHTER_CUE, PRIORITY, REVERB, LAW: LAW_OF }).map(([k, v]) => [k, Object.freeze(v)])));

// ---------- small helpers ----------
const rngFor = (name) => mulberry32((CONFIG.seed ^ hashString(name)) >>> 0);
const clamp01 = (u) => Math.min(1, Math.max(0, u));
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const mean = (ps) => ps.reduce((s, p) => s.map((v, j) => v + p[j] / ps.length), [0, 0, 0]);
// an object and everything inside it frozen (the meta tables and their arrays)
const deepFreeze = (o) => { for (const v of Object.values(o)) if (v && typeof v === 'object') deepFreeze(v); return Object.freeze(o); };
// The first instant in (lo, hi] where yes(t) holds, given it fails at lo and holds at hi, to 1e-10 s.
function edge(yes, lo, hi) {
  for (let i = 0; i < 80 && hi - lo > 1e-10; i++) { const m = (lo + hi) / 2; if (yes(m)) hi = m; else lo = m; }
  return hi;
}
// The same on the audio sample grid: the first sample k / SR in (lo, hi] where yes holds.
function edgeSample(yes, lo, hi) {
  let a = Math.floor(lo * SR), b = Math.round(hi * SR);
  while (b - a > 1) { const m = Math.floor((a + b) / 2); if (yes(m / SR)) b = m; else a = m; }
  return b / SR;
}
// The first instant in [lo, hi] where yes holds: a scan at `step`, then bisection; null when it never does.
function firstTrue(yes, lo, hi, step = 1 / 240, refine = edge) {
  if (yes(lo)) return lo;
  for (let i = 1, a = lo; a < hi; i++) { const b = Math.min(hi, lo + i * step); if (yes(b)) return refine(yes, a, b); a = b; }
  return null;
}
// A ground segment from p to q, against an axis-aligned footprint (Liang-Barsky): true when it passes through it.
function crosses(p, q, b) {
  let u0 = 0, u1 = 1;
  const d = [q[0] - p[0], q[2] - p[2]];
  for (const [o, dd, lo, hi] of [[p[0], d[0], b.x0, b.x1], [p[2], d[1], b.z0, b.z1]]) {
    if (Math.abs(dd) < 1e-12) { if (o < lo || o > hi) return false; continue; }
    let a = (lo - o) / dd, c = (hi - o) / dd;
    if (a > c) [a, c] = [c, a];
    u0 = Math.max(u0, a); u1 = Math.min(u1, c);
    if (u0 > u1) return false;
  }
  return true;
}

// A point on the car in its ground frame: `along` m forward of the centre, `side` m to its right, `up` m high.
function onCar(w, t, along, side, up) {
  const c = w.carAt(t);
  if (!c.present) return null;
  const h = c.heading * D2R;
  return [c.x + Math.sin(h) * along + Math.cos(h) * side, up, c.z - Math.cos(h) * along + Math.sin(h) * side];
}
// A door's hinge, or its latch edge swung as actors/car.js swings the slab about the hinge, at the door's mid height.
function doorPoint(w, tag, part, t) {
  const D = w.SHAPE.door, s = w.DOOR_SIDE[tag], y = D.y0 + D.height / 2;
  if (part === 'hinge') return onCar(w, t, D.front, s * D.side, y);
  const L = D.front - D.back, th = s * w.doorOpen(w.carTimes.doors[tag], t) * D.maxDeg * D2R;
  return onCar(w, t, D.front - L * Math.cos(th), s * D.side + L * Math.sin(th), y);
}

// ---------- the catalogue ----------
export function makeCues(w = WORLD) {
  const T = w.carTimes, out = [], ids = Object.keys(w.PEOPLE);
  const B = w.SHAPE.body, C = w.SHAPE.cabin, half = w.CAR.length / 2;
  const bodyMid = (B.y0 + B.y1) / 2;
  const bayAlong = (-C.back + C.length / 2 + half) / 2; // the engine bay: between the cabin's front and the nose
  const firstLight = firstTrue((t) => w.headlights(t) > 0 && w.carAt(t).present, 0, w.T_TOTAL);
  const moonRise = firstTrue((t) => w.moonlight(t) > 0, 0, w.T_TOTAL);
  const moonFull = firstTrue((t) => w.moonlight(t) >= 1, moonRise, w.T_TOTAL);
  // the engine stops by question 2, option b: the run-down starts as the lights start to fade and lasts as long
  const stop0 = T.lightsOff0, stop1 = T.lightsOff1;
  const posers = Object.fromEntries(ids.map((id) => [id, w.makePoser(id)]));
  const standY = Object.fromEntries(ids.map((id) => [id, w.dims(id).ankleY])); // the standing ankle height the prints use
  const doorOf = Object.fromEntries(ids.map((id) => [id, Object.keys(w.DOOR_SIDE).find((tag) => w.DOOR_SIDE[tag] === w.EXIT.outSide[id])]));
  const fixed = (p) => { const q = Object.freeze([...p]); return () => q; };
  const personAt = (id, pick) => (t) => { const p = posers[id](t); return p.visible ? pick(p) : null; };
  const clothAt = (id) => personAt(id, (p) => [p.x, p.y + CLOTH.up, p.z]);
  // CONTACT.px internal pixels at p, in meters, through the camera of the shot at t (a pixel is 2 d tan(vfov / 2) / h)
  const pxAt = (p, t) => {
    const c = w.cameraAt(w.shotAt(t), t), f = sub3(c.target, c.pos), v = sub3(p, c.pos);
    const d = (v[0] * f[0] + v[1] * f[1] + v[2] * f[2]) / Math.hypot(f[0], f[1], f[2]);
    return CONTACT.px * 2 * d * Math.tan(w.vfovDeg(c.lens) * D2R / 2) / CONFIG.res.h;
  };

  // fills in what most cues share; `sync - lead` is the onset; `row` names the allocator and reverb row if not the family
  const add = (c) => {
    const row = c.row ?? c.family;
    out.push({
      id: c.id, category: c.category, family: c.family, source: c.source, person: c.person ?? null, surface: c.surface ?? null,
      shape: c.shape ?? 'oneshot', sync: c.sync, print: c.print ?? null, lead: c.lead ?? 0,
      t0: c.sync - (c.lead ?? 0), t1: c.t1, place: c.place ?? null, placement: c.place ? c.placement ?? 'onset' : null,
      law: c.place ? LAW_OF[c.family] : null, perspective: c.place ? 'camera' : 'location', poa: 'camera', track: c.track ?? null,
      level: c.level, reverb: REVERB[row], priority: PRIORITY[row], voices: c.voices ?? (c.place ? 1 : 2),
      label: c.label, sdh: c.sdh ?? null, derivedFrom: c.derivedFrom ?? null, rule: c.rule ?? null,
      designed: Object.freeze(['level', 'priority', 'reverb', ...(c.lead ? ['lead'] : []), ...(c.designed ?? [])]),
      nudge: 0, new: c.new ?? false, offered: c.offered ?? false, enabled: !c.offered, meta: deepFreeze({ ...c.meta }),
    });
  };

  // ---------- the car: engine, the arrival, tyres, brake ----------
  const hFrame = 1 / (2 * w.FPS); // the acceleration: a centred difference over one frame
  const accel = (t) => (w.carAt(t + hFrame).speed - w.carAt(t - hFrame).speed) / (2 * hFrame);
  const drive = (t) => {
    const c = w.carAt(t);
    return { rpm: Math.max(ENGINE.idleRpm, ENGINE.rpmPerMs * c.speed), load: clamp01(ENGINE.cruise + ENGINE.perMs2 * accel(t)), speed: c.speed };
  };
  const intake = (t) => onCar(w, t, bayAlong, 0, bodyMid), exhaust = (t) => onCar(w, t, -half, 0, B.y0);
  const engineFrom = 'carAt (centre, heading), CAR.length, SHAPE.body, SHAPE.cabin';
  const lit = 'headlights(t) > 0 with carAt(t).present (the first light; the beams show in shot 3\'s first frame)';
  for (const [part, place, at] of [['intake', intake, 'the engine bay, between the cabin and the nose'], ['exhaust', exhaust, 'under the rear bumper']]) {
    add({ id: `hard.engine.car.${part}`, category: 'hard', family: 'engine', source: `car:${part}`, shape: 'continuous', sync: firstLight, t1: T.stop, place, placement: 'tracked', track: drive, level: LEVELS[part], label: part === 'intake' ? '[the engine drives]' : '[the exhaust burbles]', sdh: part === 'intake' ? '[engine approaches]' : null, derivedFrom: `${lit}; to carTimes.stop; ${engineFrom}: ${at}`, rule: 'SOUND-PLAN 4.1 engine: rpm from carAt(t).speed, load from its acceleration', designed: ['track'] });
    add({ id: `hard.engine.car.${part}-idle`, category: 'hard', family: 'engine', source: `car:${part}`, shape: 'continuous', sync: T.stop, t1: stop0, place, track: () => ({ rpm: ENGINE.idleRpm, load: ENGINE.idleLoad, speed: 0 }), level: LEVELS[`${part}Idle`], label: part === 'intake' ? '[the engine idles]' : '[the exhaust idles]', designed: ['track'], derivedFrom: `carTimes.stop to carTimes.lightsOff0 (question 2, option b); ${engineFrom}` });
  }
  add({ id: 'hard.engine.car.door-open', category: 'hard', family: 'engine', source: 'car:intake', shape: 'continuous', sync: Math.min(...Object.values(T.doors).map((d) => d.open0)), t1: Math.max(...Object.values(T.doors).map((d) => d.close1)), place: intake, track: (t) => ({ open: Math.max(...Object.values(T.doors).map((d) => w.doorOpen(d, t))) }), level: LEVELS.idleDoor, voices: 0, label: '[the idle, louder through an open door]', derivedFrom: 'carTimes.doors open0 to close1, doorOpen', offered: true, new: true, meta: { modifies: ['engine'] } });
  add({ id: 'hard.arrival.car.rise', category: 'hard', family: 'arrival', source: 'car', shape: 'continuous', sync: firstLight, t1: firstLight + ENGINE.rise, place: (t) => onCar(w, t, 0, 0, bodyMid), placement: 'tracked', track: (t) => ({ u: clamp01((t - firstLight) / ENGINE.rise) }), level: LEVELS.rise, voices: 0, label: '[the car rises out of the quiet]', derivedFrom: lit, rule: 'SOUND-PLAN 3.11 question 3 (a): a designed rise instead of switching on', designed: ['t1'], new: true, meta: { modifies: ['engine', 'tyres'] } });
  // the car comes round the corner: the first instant the shot's camera sees any of its front (a front corner or the
  // nose's centre) past every building; in shot 3 the right front corner clears first, 0.24 s before the centre
  const front = (t) => [-1, 0, 1].map((s) => onCar(w, t, half, s * w.CAR.width / 2, bodyMid));
  const seen = (t) => { const cam = w.cameraAt(w.shotAt(t), t).pos; return front(t).some((p) => p !== null && !w.BUILDINGS.some((b) => crosses(cam, p, b))); };
  const clear = firstTrue(seen, firstLight, T.stop, 1 / 48);
  if (clear === null) throw new Error('cues: the car\'s front is never seen before the stop');
  add({ id: 'hard.arrival.car.swell', category: 'hard', family: 'arrival', source: 'car', shape: 'continuous', sync: clear, t1: T.stop, place: (t) => onCar(w, t, 0, 0, bodyMid), placement: 'tracked', track: (t) => ({ u: clamp01((t - clear) / (T.stop - clear)), speed: w.carAt(t).speed }), level: LEVELS.swell, voices: 0, label: '[the car swells as it comes in]', sdh: null, derivedFrom: 'the front (carAt, CAR.length, CAR.width: both corners and the centre) first seen past BUILDINGS from cameraAt(shotAt(t)); to carTimes.stop', rule: 'SOUND-PLAN 3.10: it swells to the stop', new: true, meta: { modifies: ['engine', 'tyres'] } });
  for (const [part, s] of [['front', 1], ['rear', -1]]) {
    add({ id: `hard.tyres.car.${part}`, category: 'hard', family: 'tyres', source: `car:tyres:${part}`, shape: 'continuous', sync: firstLight, t1: T.stop, place: (t) => onCar(w, t, s * w.SHAPE.wheel.forward, 0, 0), placement: 'tracked', track: (t) => ({ speed: w.carAt(t).speed, steer: s > 0 ? w.steerDeg(t) : 0 }), level: LEVELS.tyres, label: '[tyres in the snow]', derivedFrom: `${lit}; to carTimes.stop; carAt(t).speed, steerDeg (front); SHAPE.wheel.forward, the axle's contact` });
  }
  // the brake: the carTimes segments from carTimes.brake on in which the speed falls, adjacent ones joined
  const marks = [T.brake, T.turn0, T.turn1, T.stop];
  const spans = [];
  for (let i = 0; i + 1 < marks.length; i++) {
    const a = marks[i], b = marks[i + 1];
    if (!(w.carAt(b - 1e-6).speed < w.carAt(a).speed - 1e-6)) continue;
    const last = spans[spans.length - 1];
    if (last && last.t1 === a) last.t1 = b; else spans.push({ t0: a, t1: b });
  }
  spans.forEach((sp, i) => add({ id: `hard.brake.car.pads${i + 1}`, category: 'hard', family: 'brake', source: 'car:brakes', shape: 'continuous', sync: sp.t0, t1: sp.t1, place: (t) => onCar(w, t, w.SHAPE.wheel.forward, 0, w.SHAPE.wheel.radius), placement: 'tracked', track: (t) => ({ speed: w.carAt(t).speed, decel: -accel(t) }), level: LEVELS.brake, label: '[brakes]', derivedFrom: 'carTimes.brake, turn0, turn1, stop; carAt(t).speed falls; SHAPE.wheel (front axle)', rule: 'SOUND-PLAN 4.1 brake: from carTimes.brake while decelerating', new: true }));
  // the creak sounds over the pads, so it is a voice of its own
  const creak = firstTrue((t) => w.carAt(t).speed < CREAK.speed, T.turn1, T.stop, 1 / 48);
  add({ id: 'hard.brake.car.creak', category: 'hard', family: 'brake', source: 'car:brakes:creak', shape: 'continuous', sync: creak, t1: T.stop, place: fixed(onCar(w, T.stop, w.SHAPE.wheel.forward, 0, w.SHAPE.wheel.radius)), track: (t) => ({ speed: w.carAt(t).speed }), level: LEVELS.creak, label: '[brakes creak]', derivedFrom: 'carAt(t).speed under CREAK.speed, to carTimes.stop; SHAPE.wheel', rule: 'SOUND-PLAN 4.1 brake: the creak over the last stretch under a speed, before the stop' });

  // ---------- the stop: settle, cabin, the run-down, ticks ----------
  const centre = fixed(onCar(w, T.stop, 0, 0, bodyMid));
  // the deepest point of the dip: where settlePitch stops falling, by the sign of a centred difference (exact for a
  // symmetric dip, and clear of the rounding a search on the flat bottom's values would hit)
  const deepest = edge((t) => w.settlePitch(t + 1e-3) > w.settlePitch(t - 1e-3), T.stop, T.stop + w.SETTLE.dur);
  add({ id: 'hard.settle.car.dip', category: 'hard', family: 'settle', source: 'car:body', sync: T.stop, t1: deepest, place: centre, level: LEVELS.settle, label: '[the car settles on its springs]', derivedFrom: "carTimes.stop to settlePitch's deepest point (the nose going down); carAt, SHAPE.body" });
  add({ id: 'hard.settle.car.rebound', category: 'hard', family: 'settle', source: 'car:body', sync: deepest, t1: T.stop + w.SETTLE.dur, place: centre, level: LEVELS.rebound, label: '[the springs rebound]', derivedFrom: "settlePitch's deepest point to carTimes.stop + SETTLE.dur (the body level again); carAt, SHAPE.body" });
  add({ id: 'hard.stop.car.rundown', category: 'hard', family: 'stop', source: 'car:intake', shape: 'continuous', sync: stop0, t1: stop1, place: intake, track: (t) => { const u = clamp01((t - stop0) / (stop1 - stop0)); return { rpm: ENGINE.idleRpm * (1 - u), dying: 1 - u }; }, level: LEVELS.rundown, label: '[the engine runs down]', sdh: '[engine stops]', derivedFrom: 'carTimes.lightsOff0 to lightsOff1, the span idleLift and the headlights fade over', rule: 'question 2, option b: no key click' });
  const seats = Object.fromEntries(Object.entries(w.PEOPLE_KEYS).map(([id, keys]) => { const k = keys.find((x) => x.pose === 'emerge'); return [id, [k.x, w.EMERGE.hipY, k.z]]; }));
  add({ id: 'hard.cabin.car.handbrake', category: 'hard', family: 'cabin', source: 'car:handbrake', sync: T.stop + w.SETTLE.dur, t1: T.stop + w.SETTLE.dur + CABIN.handbrake, place: fixed(mean(Object.values(seats))), level: LEVELS.cabin, label: '[handbrake, inside the car]', derivedFrom: 'carTimes.stop + SETTLE.dur (the body level again); between the seats, PEOPLE_KEYS emerge keys, EMERGE.hipY', rule: 'SOUND-PLAN 3.8: the handbrake after the stop', designed: ['t1'], new: true });
  for (const id of ids) {
    const d = T.doors[doorOf[id]];
    add({ id: `hard.cabin.${id}.belt`, category: 'hard', family: 'cabin', source: `car:belt:${doorOf[id]}`, person: id, sync: d.open0, lead: CABIN.beltLead, t1: d.open0 - CABIN.beltLead + CABIN.belt, place: fixed(seats[id]), level: LEVELS.cabin, label: `[${id}'s seat belt comes off]`, derivedFrom: `carTimes.doors.${doorOf[id]}.open0 (the door of EXIT.outSide.${id}); the seat, PEOPLE_KEYS.${id} emerge key, EMERGE.hipY`, rule: 'SOUND-PLAN 3.8: a belt before each door opens', designed: ['t1'], new: true });
  }
  // ticks: seeded spacing from the end of the run-down plus a delay, stopping before the moonlight rises
  const bay = fixed(onCar(w, stop1, bayAlong, 0, bodyMid));
  const trng = rngFor('cues:tick');
  for (let t = stop1 + TICK.delay, i = 0; t + TICK.dur < moonRise; i++) {
    const gap = TICK.gap + i * TICK.grow + TICK.jitter * trng();
    add({ id: `hard.tick.car.${String(i + 1).padStart(2, '0')}`, category: 'hard', family: 'tick', source: 'car:engine-bay', sync: t, t1: t + TICK.dur, place: bay, level: LEVELS.tick, label: '[hot metal ticks]', derivedFrom: 'carTimes.lightsOff1 (the engine silent); moonlight(t) > 0 ends them; the engine bay', rule: 'SOUND-PLAN 3.11: seeded spacing from the engine stop plus a delay, ending before the moonlight rises', designed: ['t1'], meta: { n: i + 1, gap } });
    t += gap;
  }

  // ---------- the doors: unlatch, swing open, stop, swing shut, latch ----------
  for (const tag of Object.keys(w.DOOR_SIDE)) {
    const d = T.doors[tag], at = (part, t) => fixed(doorPoint(w, tag, part, t));
    const base = { category: 'hard', family: 'door', source: `car:door:${tag}`, level: LEVELS.door, meta: { door: tag } };
    const from = `carTimes.doors.${tag}`;
    add({ ...base, id: `hard.door.${tag}.unlatch`, sync: d.open0, lead: DOOR.unlatchLead, t1: d.open0, place: at('latch', d.open0), label: `[${tag} door unlatches]`, sdh: '[car door opens]', derivedFrom: `${from}.open0 (it sounds until the swing begins); the latch edge, SHAPE.door, DOOR_SIDE` });
    add({ ...base, id: `hard.door.${tag}.swing-open`, sync: d.open0, t1: d.open1, place: at('hinge', d.open0), label: `[${tag} door swings open]`, derivedFrom: `${from}.open0 to open1; the hinge, SHAPE.door, DOOR_SIDE`, level: LEVELS.doorSwing });
    add({ ...base, id: `hard.door.${tag}.stop`, sync: d.open1, t1: d.open1 + DOOR.stop, place: at('hinge', d.open1), label: `[${tag} door stops, open]`, derivedFrom: `${from}.open1; the hinge, SHAPE.door, DOOR_SIDE`, level: LEVELS.doorSwing, designed: ['t1'], new: true });
    add({ ...base, id: `hard.door.${tag}.swing-shut`, sync: d.close0, t1: d.close1, place: at('hinge', d.close0), label: `[${tag} door swings shut]`, derivedFrom: `${from}.close0 to close1; the hinge, SHAPE.door, DOOR_SIDE`, level: LEVELS.doorSwing, new: true });
    add({ ...base, id: `hard.door.${tag}.latch`, sync: d.close1, t1: d.close1 + DOOR.latch, place: at('latch', d.close1), label: `[${tag} door shuts]`, sdh: '[car door shuts]', derivedFrom: `${from}.close1; the latch edge, SHAPE.door, DOOR_SIDE`, designed: ['t1'] });
  }

  // ---------- getting out: the slide off the seat and the springs unloading as each one rises ----------
  for (const [id, keys] of Object.entries(w.PEOPLE_KEYS)) {
    const i = keys.findIndex((k) => k.pose === 'emerge'), e = keys[i], x = keys[i + 1], up = keys[i + 2];
    const hip = personAt(id, (p) => w.bodyToWorld(p, p.hip));
    add({ id: `hard.unload.${id}.slide`, category: 'hard', family: 'unload', source: `car:seat:${doorOf[id]}`, person: id, shape: 'continuous', sync: e.t, t1: x.t, place: hip, placement: 'tracked', level: LEVELS.unload, label: `[${id} slides off the seat]`, derivedFrom: `PEOPLE_KEYS.${id}: the emerge key to the exit key; makePoser hip`, new: true });
    add({ id: `hard.unload.${id}.rise`, category: 'hard', family: 'unload', source: `car:seat:${doorOf[id]}`, person: id, shape: 'continuous', sync: x.t, t1: up.t, place: fixed(seats[id]), level: LEVELS.unload, label: `[the seat springs back as ${id} rises]`, derivedFrom: `PEOPLE_KEYS.${id}: the exit key to the next; the seat, the emerge key, EMERGE.hipY`, new: true });
  }

  // ---------- feet: one step per landing, at the rig's contact, the print time beside it ----------
  // footprintList()'s own rule: the ankle down when it is within PRINT.rest of standing height over its ground
  const down = (id, foot) => (t) => {
    const p = posers[id](t);
    if (!p.visible) return false;
    const a = w.bodyToWorld(p, p.legs[foot].ankle);
    return a[1] - w.groundY(a[0], a[2]) - standY[id] <= w.PRINT.rest;
  };
  const steps = [], stepsOf = Object.fromEntries(ids.map((id) => [id, []]));
  for (const f of w.footprintList()) {
    const yes = down(f.id, f.foot), lo = f.t - w.PRINT.dt;
    const prior = posers[f.id](lo).visible && !yes(lo);
    steps.push({ ...f, contact: prior ? edgeSample(yes, lo, f.t) : f.t });
  }
  for (const id of ids) {
    const own = steps.filter((s) => s.id === id).sort((a, b) => a.contact - b.contact), merged = [];
    for (const s of own) {
      const last = merged[merged.length - 1];
      if (last && s.contact - last.contact < STEP.flam) last.prints.push(s); else merged.push({ ...s, prints: [s] });
    }
    merged.forEach((s, i) => {
      const next = merged[i + 1], both = s.prints.length > 1, surface = surfaceOf(s), cid = `foley.feet.${id}.${String(i + 1).padStart(2, '0')}`;
      stepsOf[id].push({ id: cid, contact: s.contact });
      add({ id: cid, category: 'foley', family: 'feet', source: `${id}:feet`, person: id, surface, sync: s.contact, print: s.t, t1: s.contact + Math.min(STEP.tail, next ? next.contact - s.contact : STEP.tail), place: fixed([s.x, s.y, s.z]), level: both ? LEVELS.feetBoth : LEVELS.feet, label: both ? `[${id} lands on both boots, ${surface}]` : `[${id} steps, ${surface}]`, sdh: id === w.footprintList()[0].id && i === 0 ? '[a boot crunches in the snow]' : null, derivedFrom: 'footprintList() (print time and place); the ankle down by its rule (dims ankleY), bisected on the sample grid (contact); surfaceOf', rule: both ? 'SOUND-PLAN 3.12: one person\'s contacts within 30 ms are one step' : null, designed: ['t1'], meta: { foot: s.foot, prints: s.prints.map((p) => p.t), contacts: s.prints.map((p) => p.contact) } });
    });
  }

  // ---------- scuffs: a planted ankle sliding without lifting, outside the walk (the turns in place) ----------
  // Found on PRINT.dt, each edge bisected on the sample grid. A slide gets its own voice: one that starts within
  // STEP.flam after a step of the same person grows out of that step (meta.step), its speed rising from zero, so the
  // two are one footfall in two voices, the crunch and the grind, and neither cuts the other.
  const hS = 1 / SR;
  for (const id of ids) {
    const ankle = (foot, t) => { const p = posers[id](t); return w.bodyToWorld(p, p.legs[foot].ankle); };
    const planted = (foot, t) => {
      const p = posers[id](t);
      if (!p.visible || p.walk.env !== 0 || p.pose === 'emerge' || p.pose === 'exit') return false;
      const a = w.bodyToWorld(p, p.legs[foot].ankle);
      return a[1] - w.groundY(a[0], a[2]) - standY[id] <= w.PRINT.rest;
    };
    const dt = w.PRINT.dt, n = Math.round(w.T_TOTAL / dt), runs = [];
    for (let foot = 0; foot < 2; foot++) {
      const yes = (t) => planted(foot, t) && dist2(ankle(foot, t - hS), ankle(foot, t + hS)) / (2 * hS) > SCUFF.speed, no = (t) => !yes(t);
      let run = null;
      for (let i = 0; i <= n; i++) {
        const t = i * dt;
        if (yes(t)) { if (!run) run = { foot, t0: i ? edgeSample(yes, t - dt, t) : t }; continue; }
        if (run) { run.t1 = edgeSample(no, t - dt, t); runs.push(run); run = null; }
      }
    }
    // how far each run slides, through the PRINT.dt samples inside it; the short ones drop
    for (const r of runs) {
      const ts = [r.t0];
      for (let k = Math.floor(r.t0 / dt) + 1; k * dt < r.t1; k++) ts.push(k * dt);
      ts.push(r.t1);
      r.d = ts.slice(1).reduce((s, t, k) => s + dist2(ankle(r.foot, ts[k]), ankle(r.foot, t)), 0);
    }
    // both feet of one turn are one scuff: overlapping runs joined
    const joined = [];
    for (const r of runs.filter((x) => x.d >= SCUFF.min).sort((a, b) => a.t0 - b.t0 || a.foot - b.foot)) {
      const last = joined[joined.length - 1];
      if (last && r.t0 <= last.t1) { last.t1 = Math.max(last.t1, r.t1); last.feet.push(r.foot); last.d.push(r.d); } else joined.push({ t0: r.t0, t1: r.t1, feet: [r.foot], d: [r.d], first: [] });
      if (r.t0 === joined[joined.length - 1].t0) joined[joined.length - 1].first.push(r.foot); // the feet sliding at its onset
    }
    joined.forEach((s, i) => {
      const step = stepsOf[id].find((x) => s.t0 >= x.contact && s.t0 - x.contact < STEP.flam);
      add({ id: `foley.scuff.${id}.${i + 1}`, category: 'foley', family: 'scuff', source: `${id}:feet:slide`, person: id, shape: 'continuous', sync: s.t0, t1: s.t1, place: fixed(mean(s.first.map((f) => ankle(f, s.t0)))), level: LEVELS.scuff, label: `[${id}'s boots scuff the snow]`, derivedFrom: `makePoser('${id}') ankles, planted by footprintList()'s rule outside walk (walk.env 0) and getting out, their speed over one sample each side; found on PRINT.dt, bisected on the sample grid; the sliding ankles at onset`, rule: 'SOUND-PLAN 3.8: ankle slides without lift over a threshold (SCUFF)', new: true, meta: { feet: s.feet, first: s.first, slid: s.d, step: step ? step.id : null } });
    });
  }

  // ---------- moves: cloth on the walk, the turns, the lean and the hands' contacts, the shift closer ----------
  for (const [id, keys] of Object.entries(w.PEOPLE_KEYS)) {
    const cloth = { category: 'foley', family: 'moves', source: `${id}:cloth`, person: id, level: LEVELS.cloth };
    const contactCue = { category: 'foley', family: 'moves', source: `${id}:arms`, person: id, row: 'contact', level: LEVELS.contact, designed: ['t1'] };
    const material = w.PEOPLE[id].coat, walks = [], counts = { turn: 0, shift: 0 };
    const hands = (t) => { const p = posers[id](t); return p.arms.map((arm) => w.bodyToWorld(p, arm.hand)); };
    for (let i = 0; i + 1 < keys.length; i++) {
      const a = keys[i], b = keys[i + 1], mid = (a.t + b.t) / 2;
      if (posers[id](mid).walk.env > 0) { const last = walks[walks.length - 1]; if (last && last.t1 === a.t) last.t1 = b.t; else walks.push({ t0: a.t, t1: b.t }); continue; }
      if (a.pose === 'emerge' || a.pose === 'exit') continue; // getting out: the unload cues
      const turn = Math.abs(w.wrapDeg(b.face - a.face)), moved = dist2([a.x, 0, a.z], [b.x, 0, b.z]);
      const from = `PEOPLE_KEYS.${id}[${i}] to [${i + 1}]`;
      if (b.pose === 'lean' && a.pose !== 'lean') {
        add({ ...cloth, id: `foley.moves.${id}.lean`, shape: 'continuous', sync: a.t, t1: b.t, place: clothAt(id), placement: 'tracked', label: `[${id} leans on the parapet]`, derivedFrom: `${from} (into the lean); poser root + CLOTH.up`, meta: { material, kind: 'lean' } });
        // the forearms' contact (CONTACT): the first hand within CONTACT.px of where it rests at the lean key
        const rest = hands(b.t);
        const near = (t) => hands(t).some((q, h) => dist3(q, rest[h]) <= pxAt(rest[h], t));
        const contact = firstTrue(near, a.t, b.t, 1 / 240, edgeSample);
        add({ ...contactCue, id: `foley.moves.${id}.rest`, sync: contact, t1: contact + CONTACT.tail, place: fixed(mean(rest)), label: `[${id}'s forearms come to rest on the stone]`, derivedFrom: `makePoser('${id}') hands against their place at ${from}'s lean key, through cameraAt(shotAt(t)), vfovDeg and CONFIG.res; on the sample grid`, rule: 'SOUND-PLAN 3.8: the contact definition (CONTACT): the first hand within half an internal pixel of its rest', meta: { kind: 'rest' } });
      } else if (turn >= TURN.minDeg) {
        const kind = b.pose === 'cup' ? 'into the lee' : a.pose === 'cup' ? 'out of the lee' : 'in place';
        counts.turn++;
        add({ ...cloth, id: `foley.moves.${id}.turn${counts.turn}`, shape: 'continuous', sync: a.t, t1: b.t, place: clothAt(id), placement: 'tracked', label: kind === 'in place' ? `[${id} turns]` : `[${id} turns ${kind}]`, derivedFrom: `${from} (the face turns); poser root + CLOTH.up`, rule: 'TURN: a held pose turning at least TURN.minDeg', new: kind === 'in place', meta: { material, kind: 'turn', deg: turn } });
        // into the lee the hands close round the lighter (CONTACT): the first instant the gap between them is within
        // CONTACT.px of its width at the cup key. Out of the lee they part, a release with no contact: the turn's cloth.
        if (b.pose === 'cup' && a.pose !== 'cup') {
          const gap = (t) => { const [h0, h1] = hands(t); return dist3(h0, h1); };
          const cupAt = (t) => { const p = posers[id](t); return w.bodyToWorld(p, p.cup); };
          const width = gap(b.t), closed = (t) => Math.abs(gap(t) - width) <= pxAt(cupAt(t), t);
          const contact = firstTrue(closed, a.t, b.t, 1 / 240, edgeSample);
          add({ ...contactCue, id: `foley.moves.${id}.cup`, sync: contact, t1: contact + CONTACT.tail, place: fixed(cupAt(contact)), label: `[${id} cups both hands round the lighter]`, derivedFrom: `makePoser('${id}') hands, their gap against its width at ${from}'s cup key, at the cup through cameraAt(shotAt(t)), vfovDeg and CONFIG.res; on the sample grid`, rule: 'SOUND-PLAN 3.8: the contact definition (CONTACT): the hands\' gap within half an internal pixel of its width at the cup', new: true, meta: { kind: 'cup' } });
        }
      } else if (moved >= SHIFT.min) {
        counts.shift++;
        add({ ...cloth, id: `foley.moves.${id}.shift${counts.shift}`, shape: 'continuous', sync: a.t, t1: b.t, place: clothAt(id), placement: 'tracked', label: `[${id} shifts closer]`, derivedFrom: `${from} (the root moves); poser root + CLOTH.up`, rule: 'SHIFT: a held pose moving at least SHIFT.min', new: true, meta: { material, kind: 'shift' } });
      }
    }
    walks.forEach((s, i) => add({ ...cloth, id: `foley.moves.${id}.walk${i + 1}`, shape: 'continuous', sync: s.t0, t1: s.t1, place: clothAt(id), placement: 'tracked', track: (t) => { const p = posers[id](t); return { swing: p.walk.env, along: p.walk.along }; }, label: `[${id}'s ${material.split(',')[0].split(' ').pop()} swishes with the walk]`, derivedFrom: `PEOPLE_KEYS.${id} segments walking (makePoser walk.env > 0 at their middle), joined; poser root + CLOTH.up`, new: true, meta: { material, kind: 'walk' } }));
  }

  // ---------- the lighter, the drags, the breath (A) ----------
  const smoker = ids.find((id) => w.PEOPLE_KEYS[id].some((k) => k.pose === 'cup'));
  const cup = personAt(smoker, (p) => w.bodyToWorld(p, p.cup)), tip = personAt(smoker, (p) => w.bodyToWorld(p, p.tip)), mouth = personAt(smoker, (p) => w.bodyToWorld(p, p.mouth));
  const L = w.LIGHTER, firstFlame = Math.ceil(L.t0 * w.FPS - 1e-9) / w.FPS; // the first frame lighterOn shows
  const lighter = { category: 'foley', family: 'lighter', source: `${smoker}:lighter`, person: smoker, level: LEVELS.lighter };
  add({ ...lighter, id: `foley.lighter.${smoker}.strike`, sync: L.t0, lead: LIGHTER_CUE.strikeLead, t1: L.t0, place: cup, placement: 'onset', label: '[the lighter\'s wheel strikes]', sdh: '[lighter clicks]', derivedFrom: 'LIGHTER.t0 (the flame, ahead of its first frame); makePoser cup', rule: 'SOUND-PLAN 3.3: the strike leads the flame it lights', meta: { firstFlame } });
  add({ ...lighter, id: `foley.lighter.${smoker}.flame`, shape: 'continuous', sync: L.t0, t1: L.t1, place: cup, placement: 'tracked', track: (t) => ({ flicker: w.lighterOn(t) ? w.lighterFlicker(t) : 0 }), level: LEVELS.flame, label: '[the flame flutters]', derivedFrom: 'LIGHTER.t0 to t1, lighterOn, lighterFlicker; makePoser cup' });
  add({ ...lighter, id: `foley.lighter.${smoker}.release`, sync: L.t1, t1: L.t1 + LIGHTER_CUE.release, place: cup, placement: 'onset', label: '[the lighter clicks shut]', derivedFrom: 'LIGHTER.t1; makePoser cup', designed: ['t1'] });
  const E = w.EMBER, X = w.EXHALE;
  const after = E.drags.reduce((best, d, i) => (Math.abs(d + E.dragDur - X.t) < Math.abs(E.drags[best] + E.dragDur - X.t) ? i : best), 0);
  E.drags.forEach((d, i) => {
    add({ id: `foley.drag.${smoker}.${i + 1}`, category: 'foley', family: 'drag', source: `${smoker}:cigarette`, person: smoker, shape: 'continuous', sync: d, t1: d + E.dragDur, place: tip, placement: 'tracked', track: (t) => ({ ember: w.emberLevel(t) }), level: LEVELS.drag, label: `[${smoker} draws on the cigarette]`, derivedFrom: `EMBER.drags[${i}], EMBER.dragDur, emberLevel; makePoser tip` });
    // the drawn exhale follows its drag; the others (no smoke drawn) are offered, default out
    const t0 = i === after ? X.t : d + E.dragDur;
    add({ id: `foley.breath.${smoker}.exhale${i + 1}`, category: 'foley', family: 'breath', source: `${smoker}:breath`, person: smoker, shape: 'continuous', sync: t0, t1: t0 + X.life, place: mouth, placement: 'tracked', track: (t) => ({ age: t - t0, life: X.life }), level: LEVELS.breath, label: `[${smoker} exhales]`, sdh: i === after ? '[exhales]' : null, derivedFrom: i === after ? 'EXHALE.t, EXHALE.life; makePoser mouth' : `EMBER.drags[${i}] + dragDur, EXHALE.life; makePoser mouth`, rule: i === after ? null : 'SOUND-PLAN 3.8: offered, an exhale after a drag with no smoke drawn', offered: i !== after, new: i !== after });
  });

  // ---------- backgrounds per place, the story ambiences, the lamp's hum ----------
  for (const loc of makeLocations(w)) {
    for (const [family, level] of Object.entries(LEVELS[loc.name])) {
      add({ id: `bg.${family}.${loc.name}.bed`, category: 'bg', family, source: `bg:${family}`, shape: 'continuous', sync: loc.t0, t1: loc.t1, level, label: `[${family}, ${loc.name}]`, derivedFrom: `LOCATIONS (${loc.name}: shots ${loc.shots[0]} to ${loc.shots[loc.shots.length - 1]}), from SHOTS subjects over BRIDGE`, rule: 'SOUND-PLAN 3.5: one steady background per place, changing once', meta: { location: loc.name } });
    }
  }
  add({ id: 'bg.ambience.wind.ease', category: 'bg', family: 'ambience', source: 'bg:wind', shape: 'continuous', sync: moonRise, t1: moonFull, track: (t) => ({ moon: w.moonlight(t) }), level: LEVELS.windEase, voices: 0, label: '[the wind eases]', derivedFrom: 'moonlight(t): above 0 to full', rule: 'SOUND-PLAN 3.5: the wind eases with the moonlight', meta: { modifies: ['wind'] } });
  const last = w.SHOTS[w.SHOTS.length - 1], k = last.keys, same = (a, b) => a.every((v, j) => v === b[j]);
  const m0 = k.findIndex((x, j) => j > 0 && !same(x.pos, k[j - 1].pos)) - 1, m1 = k.findLastIndex((x, j) => j > 0 && !same(x.pos, k[j - 1].pos));
  const pull0 = w.cameraAt(last, k[m0].t).pos, pullLen = Math.hypot(...k[m1].pos.map((v, j) => v - pull0[j]));
  add({ id: 'bg.ambience.night.open', category: 'bg', family: 'ambience', source: 'bg:night', shape: 'continuous', sync: k[m0].t, t1: k[m1].t, track: (t) => ({ pull: Math.hypot(...w.cameraAt(last, t).pos.map((v, j) => v - pull0[j])) / pullLen }), level: LEVELS.nightOpen, voices: 0, label: '[the night opens]', derivedFrom: `SHOTS (shot ${last.n}): the keys between which its camera moves, cameraAt`, rule: 'SOUND-PLAN 3.5: the night opens with the last pull back', meta: { modifies: ['wind', 'city', 'water'] } });
  add({ id: 'bg.hum.lamp.bed', category: 'bg', family: 'hum', source: 'lamp', shape: 'continuous', sync: 0, t1: w.T_TOTAL, place: fixed(w.LAMP.head), level: LEVELS.hum, label: '[the lamp hums]', derivedFrom: 'LAMP.head; 0 to T_TOTAL' });

  out.sort((a, b) => a.t0 - b.t0 || (a.id < b.id ? -1 : 1));
  return Object.freeze(out.map((c) => Object.freeze(c)));
}

// The places (SOUND-PLAN 3.5): a shot belongs to the bridge when its subject stands over the deck, and runs of shots
// in one place join. Street for shots 1 to 7, bridge for 8 to 15 with today's SHOTS.
export function makeLocations(w = WORLD) {
  const runs = [];
  for (const s of w.SHOTS) {
    const p = typeof s.subject === 'function' ? s.subject() : s.subject;
    const name = p[2] <= w.BRIDGE.z0 && p[2] >= w.BRIDGE.z1 ? 'bridge' : 'street';
    const last = runs[runs.length - 1];
    if (last && last.name === name) { last.shots.push(s.n); last.t1 = s.end; } else runs.push({ name, shots: [s.n], t0: s.start, t1: s.end });
  }
  return Object.freeze(runs.map((r) => Object.freeze({ ...r, shots: Object.freeze(r.shots) })));
}

export const CUES = makeCues();
export const LOCATIONS = makeLocations();

// Cues sounding at t (t0 <= t < t1), enabled ones unless `all`.
export const cuesAt = (t, { all = false } = {}) => CUES.filter((c) => (all || c.enabled) && c.t0 <= t && t < c.t1);
// Cues starting in [t0, t1), enabled ones unless `all`.
export const cuesIn = (t0, t1, { all = false } = {}) => CUES.filter((c) => (all || c.enabled) && c.t0 >= t0 && c.t0 < t1);
// The place at t: the location whose span holds it (the last one at the very end).
export const locationAt = (t) => LOCATIONS.find((l) => t >= l.t0 && t < l.t1) ?? LOCATIONS[LOCATIONS.length - 1];
