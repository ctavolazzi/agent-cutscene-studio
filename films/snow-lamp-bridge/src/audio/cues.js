// The sound effects as one catalogue, derived from the picture's data (SOUND-PLAN.md 4.1). Every time and place comes
// from a call to the picture's functions and tables; every other number is a named designed value or rule below, and
// each cue lists which of its fields are designed. Built once at import by makeCues(world) and frozen: pure, no clocks,
// seeded randomness only through the project's rngFor pattern. The parked layers in layers/ are not read for timing.
// Gate 0 as applied here: the engine runs down at carTimes.lightsOff0 with no key click (question 2, option b: Sound 1.1
// measured the idle shake on screen, a 1 to 2 px flicker of the car's edges); nothing before the car's first light, the
// engine rising out of the quiet (question 3, a); the new cues of SOUND-PLAN 3.8 in, the offered ones listed, disabled.
// No propagation delay and no Doppler, by convention (SOUND-PLAN 3.15): a cue sounds at its time wherever it is.
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
export const LAWS = Object.freeze({
  physical: Object.freeze({ refDist: SPATIAL.refDist, rolloff: 1 }), // 6 dB a doubling: the lamp's hum
  car: Object.freeze({ refDist: 3, rolloff: 0.6 }), // the one loud thing, heard across the set
  door: Object.freeze({ refDist: 2, rolloff: 0.8 }),
  foley: Object.freeze({ refDist: 2.5, rolloff: 0.7 }), // small sounds a film mix keeps close
});

// Designed levels in dB, from the level plan (SOUND-PLAN 1.3). A voice's level is at its law's refDist against the
// street background (0 dB); a modifier's (voices 0: the rise, the swell, the ambience changes) is the change it makes.
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
  // 1.3 midground (cloth, scuffs, ticks, sounds inside the car, the forearms' rest, a door's swing and stop): 0 to 6 dB
  // over the background where each is framed (cloth at 3 to 5 m in shots 7, 9 and 11); farther, the distance law rules
  creak: 5, settle: 4, rebound: 0, unload: 3, cabin: 3, tick: 5, scuff: 6, cloth: 6, rest: 7, doorSwing: 6, flame: 4,
  // 1.3 the lamp's hum: the physical law from the lamp, just over the bed in shot 1, where it is the only placed sound
  hum: 13,
  // the story ambiences (1.3 arc): the wind eases at moonrise, the night opens on the last wide; held small for the score
  windEase: -2, nightOpen: 1.5,
  // offered, default out (3.8): the idle louder while a door is open
  idleDoor: 3,
});

// Designed timings and rules, each named where it is used.
const DOOR = { unlatchLead: 0.06, unlatch: 0.12, stop: 0.2, latch: 0.25 }; // the latch lets go just before the swing
const ENGINE = { idleRpm: 780, rpmPerMs: 300, rise: 2.5, cruise: 0.45, perMs2: 0.3, idleLoad: 0.06 }; // load from acceleration
const CREAK = { speed: 0.35 }; // m/s: the pads creak over the last stretch under this, to the stop (replaces "stop - 0.55")
const SETTLE_TAIL = 0.35;
const CABIN = { beltLead: 0.5, belt: 0.4, handbrake: 0.4 }; // each belt comes off, and is done, before that person's door opens
const TICK = { delay: 1.1, gap: 1.2, grow: 0.35, jitter: 1.5, dur: 0.06 }; // further apart as the metal cools
const STEP = { flam: 0.03, tail: 0.3 }; // one person's contacts closer than `flam` are one step (both boots)
const SCUFF = { speed: 0.1, min: 0.05 }; // a planted ankle sliding faster than `speed` m/s for at least `min` m
const TURN = { minDeg: 30 }; // a held pose turning this far is a turn (cloth)
const SHIFT = { min: 0.05 }; // a held pose moving the root this far is a shift (the shoulders closing in)
const CLOTH = { up: 1.2 }; // cloth sounds at the poser's root plus 1.2 m (SOUND-PLAN 4.1)
// The forearms' contact on the parapet: the first hand within 1 mm of where it rests at the lean key. The 2 cm reading
// lands 80 ms earlier, about 58 ms before the frame that shows the hands at rest, past the 45 ms at which early audio
// is noticed (BT.1359); 1 mm lands after the hands read as still (half an internal pixel) and before the next frame.
const REST = { dist: 0.001, tail: 0.25 };
const LIGHTER_CUE = { strikeLead: 0.07, release: 0.1 }; // the wheel and flint, before the flame they light
const SR = CONFIG.audio.sr; // contacts from the rig are bisected on the audio sample grid
const D2R = Math.PI / 180;

// Allocator inputs (SOUND-PLAN 3.13), designed: higher priority keeps its voice; backgrounds are never stolen.
const PRIORITY = { bg: 120, hum: 110, engine: 100, lighter: 96, door: 90, stop: 90, feet: 80, breath: 78, drag: 76, brake: 72, tyres: 70, settle: 66, unload: 60, cabin: 56, rest: 54, moves: 44, scuff: 40, tick: 34, arrival: 0, ambience: 0 };
// The reverb bit per family (3.13), designed: the car and the doors ring in the street; steps in snow stay dry.
const REVERB = { engine: true, stop: true, tyres: false, brake: true, settle: true, unload: false, cabin: false, door: true, tick: true, feet: false, scuff: false, moves: false, lighter: false, drag: false, breath: false, wind: false, city: false, water: false, ambience: false, hum: true, arrival: false };

// The designed tables, for the tests and the storyboard to read.
export const DESIGN = Object.freeze(Object.fromEntries(Object.entries({ DOOR, ENGINE, CREAK, CABIN, TICK, STEP, SCUFF, TURN, SHIFT, CLOTH, REST, LIGHTER: LIGHTER_CUE, PRIORITY, REVERB, SETTLE_TAIL }).map(([k, v]) => [k, typeof v === 'object' ? Object.freeze(v) : v])));

// ---------- small helpers ----------
const rngFor = (name) => mulberry32((CONFIG.seed ^ hashString(name)) >>> 0);
const clamp01 = (u) => Math.min(1, Math.max(0, u));
const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
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
  const T = w.carTimes, out = [];
  const B = w.SHAPE.body, C = w.SHAPE.cabin, half = w.CAR.length / 2;
  const bodyMid = (B.y0 + B.y1) / 2;
  const bayAlong = (-C.back + C.length / 2 + half) / 2; // the engine bay: between the cabin's front and the nose
  const firstLight = firstTrue((t) => w.headlights(t) > 0 && w.carAt(t).present, 0, w.T_TOTAL);
  const moonRise = firstTrue((t) => w.moonlight(t) > 0, 0, w.T_TOTAL);
  const moonFull = firstTrue((t) => w.moonlight(t) >= 1, moonRise, w.T_TOTAL);
  // the engine stops by question 2, option b: the run-down starts as the lights start to fade and lasts as long
  const stop0 = T.lightsOff0, stop1 = T.lightsOff1;
  const posers = Object.fromEntries(Object.keys(w.PEOPLE).map((id) => [id, w.makePoser(id)]));
  const doorOf = Object.fromEntries(Object.keys(w.PEOPLE).map((id) => [id, Object.keys(w.DOOR_SIDE).find((tag) => w.DOOR_SIDE[tag] === w.EXIT.outSide[id])]));
  const fixed = (p) => { const q = Object.freeze([...p]); return () => q; };
  const personAt = (id, pick) => (t) => { const p = posers[id](t); return p.visible ? pick(p) : null; };
  const clothAt = (id) => personAt(id, (p) => [p.x, p.y + CLOTH.up, p.z]);

  // fills in what most cues share; `sync - lead` is the onset
  const add = (c) => {
    const cue = {
      id: c.id, category: c.category, family: c.family, source: c.source, person: c.person ?? null, surface: c.surface ?? null,
      shape: c.shape ?? 'oneshot', sync: c.sync, print: c.print ?? null, lead: c.lead ?? 0,
      t0: c.sync - (c.lead ?? 0), t1: c.t1, place: c.place ?? null, placement: c.place ? c.placement ?? 'onset' : null,
      law: c.place ? c.law : null, perspective: c.place ? 'camera' : 'location', poa: 'camera', track: c.track ?? null,
      level: c.level, reverb: REVERB[c.family], priority: PRIORITY[c.family], voices: c.voices ?? (c.place ? 1 : 2),
      label: c.label, sdh: c.sdh ?? null, derivedFrom: c.derivedFrom ?? null, rule: c.rule ?? null,
      designed: Object.freeze(['level', 'priority', 'reverb', ...(c.lead ? ['lead'] : []), ...(c.designed ?? [])]),
      nudge: 0, new: c.new ?? false, offered: c.offered ?? false, enabled: !c.offered, meta: Object.freeze(c.meta ?? {}),
    };
    out.push(cue);
  };

  // ---------- the car: engine, the arrival, tyres, brake ----------
  const accel = (t) => (w.carAt(t + 1 / 48).speed - w.carAt(t - 1 / 48).speed) * 24;
  const drive = (t) => {
    const c = w.carAt(t);
    return { rpm: Math.max(ENGINE.idleRpm, ENGINE.rpmPerMs * c.speed), load: clamp01(ENGINE.cruise + ENGINE.perMs2 * accel(t)), speed: c.speed };
  };
  const intake = (t) => onCar(w, t, bayAlong, 0, bodyMid), exhaust = (t) => onCar(w, t, -half, 0, B.y0);
  const engineFrom = 'carAt (centre, heading), CAR.length, SHAPE.body, SHAPE.cabin';
  const lit = 'headlights(t) > 0 with carAt(t).present (the first light; the beams show in shot 3\'s first frame)';
  for (const [part, place, at] of [['intake', intake, 'the engine bay, between the cabin and the nose'], ['exhaust', exhaust, 'under the rear bumper']]) {
    add({ id: `hard.engine.car.${part}`, category: 'hard', family: 'engine', source: `car:${part}`, shape: 'continuous', sync: firstLight, t1: T.stop, place, placement: 'tracked', law: LAWS.car, track: drive, level: LEVELS[part], label: part === 'intake' ? '[the engine drives]' : '[the exhaust burbles]', sdh: part === 'intake' ? '[engine approaches]' : null, derivedFrom: `${lit}; to carTimes.stop; ${engineFrom}: ${at}`, rule: 'SOUND-PLAN 4.1 engine: rpm from carAt(t).speed, load from its acceleration', designed: ['track'] });
    add({ id: `hard.engine.car.${part}-idle`, category: 'hard', family: 'engine', source: `car:${part}`, shape: 'continuous', sync: T.stop, t1: stop0, place, law: LAWS.car, track: () => ({ rpm: ENGINE.idleRpm, load: ENGINE.idleLoad, speed: 0 }), level: LEVELS[`${part}Idle`], label: part === 'intake' ? '[the engine idles]' : '[the exhaust idles]', designed: ['track'], derivedFrom: `carTimes.stop to carTimes.lightsOff0 (question 2, option b); ${engineFrom}` });
  }
  add({ id: 'hard.engine.car.door-open', category: 'hard', family: 'engine', source: 'car:intake', shape: 'continuous', sync: Math.min(...Object.values(T.doors).map((d) => d.open0)), t1: Math.max(...Object.values(T.doors).map((d) => d.close1)), place: intake, law: LAWS.car, track: (t) => ({ open: Math.max(...Object.values(T.doors).map((d) => w.doorOpen(d, t))) }), level: LEVELS.idleDoor, voices: 0, label: '[the idle, louder through an open door]', derivedFrom: 'carTimes.doors open0 to close1, doorOpen', offered: true, new: true, meta: { modifies: ['engine'] } });
  add({ id: 'hard.arrival.car.rise', category: 'hard', family: 'arrival', source: 'car', shape: 'continuous', sync: firstLight, t1: firstLight + ENGINE.rise, place: (t) => onCar(w, t, 0, 0, bodyMid), placement: 'tracked', law: LAWS.car, track: (t) => ({ u: clamp01((t - firstLight) / ENGINE.rise) }), level: LEVELS.rise, voices: 0, label: '[the car rises out of the quiet]', derivedFrom: lit, rule: 'SOUND-PLAN 3.11 question 3 (a): a designed rise instead of switching on', designed: ['t1'], new: true, meta: { modifies: ['engine', 'tyres'] } });
  // the nose clears the corner: the first instant the shot's camera sees the car's nose past every building
  const nose = (t) => onCar(w, t, half, 0, bodyMid);
  const seen = (t) => { const p = nose(t); return p !== null && !w.BUILDINGS.some((b) => crosses(w.cameraAt(w.shotAt(t), t).pos, p, b)); };
  const clear = firstTrue(seen, firstLight, T.stop, 1 / 48);
  if (clear === null) throw new Error('cues: the car\'s nose is never seen before the stop');
  add({ id: 'hard.arrival.car.swell', category: 'hard', family: 'arrival', source: 'car', shape: 'continuous', sync: clear, t1: T.stop, place: (t) => onCar(w, t, 0, 0, bodyMid), placement: 'tracked', law: LAWS.car, track: (t) => ({ u: clamp01((t - clear) / (T.stop - clear)), speed: w.carAt(t).speed }), level: LEVELS.swell, voices: 0, label: '[the car swells as it comes in]', sdh: null, derivedFrom: 'the nose (carAt, CAR.length) first seen past BUILDINGS from cameraAt(shotAt(t)); to carTimes.stop', rule: 'SOUND-PLAN 3.10: it swells to the stop', new: true, meta: { modifies: ['engine', 'tyres'] } });
  for (const [part, s] of [['front', 1], ['rear', -1]]) {
    add({ id: `hard.tyres.car.${part}`, category: 'hard', family: 'tyres', source: `car:tyres:${part}`, shape: 'continuous', sync: firstLight, t1: T.stop, place: (t) => onCar(w, t, s * w.SHAPE.wheel.forward, 0, 0), placement: 'tracked', law: LAWS.car, track: (t) => ({ speed: w.carAt(t).speed, steer: s > 0 ? w.steerDeg(t) : 0 }), level: LEVELS.tyres, label: '[tyres in the snow]', derivedFrom: `${lit}; to carTimes.stop; carAt(t).speed, steerDeg (front); SHAPE.wheel.forward, the axle's contact` });
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
  spans.forEach((sp, i) => add({ id: `hard.brake.car.pads${i + 1}`, category: 'hard', family: 'brake', source: 'car:brakes', shape: 'continuous', sync: sp.t0, t1: sp.t1, place: (t) => onCar(w, t, w.SHAPE.wheel.forward, 0, w.SHAPE.wheel.radius), placement: 'tracked', law: LAWS.car, track: (t) => ({ speed: w.carAt(t).speed, decel: -accel(t) }), level: LEVELS.brake, label: '[brakes]', derivedFrom: 'carTimes.brake, turn0, turn1, stop; carAt(t).speed falls; SHAPE.wheel (front axle)', rule: 'SOUND-PLAN 4.1 brake: from carTimes.brake while decelerating', new: true }));
  const creak = firstTrue((t) => w.carAt(t).speed < CREAK.speed, T.turn1, T.stop, 1 / 48);
  add({ id: 'hard.brake.car.creak', category: 'hard', family: 'brake', source: 'car:brakes', sync: creak, t1: T.stop, place: fixed(onCar(w, T.stop, w.SHAPE.wheel.forward, 0, w.SHAPE.wheel.radius)), law: LAWS.car, track: (t) => ({ speed: w.carAt(t).speed }), level: LEVELS.creak, label: '[brakes creak]', derivedFrom: 'carAt(t).speed under CREAK.speed, to carTimes.stop; SHAPE.wheel', rule: 'SOUND-PLAN 4.1 brake: the creak over the last stretch under a speed, before the stop' });

  // ---------- the stop: settle, cabin, the run-down, ticks ----------
  const centre = fixed(onCar(w, T.stop, 0, 0, bodyMid));
  add({ id: 'hard.settle.car.dip', category: 'hard', family: 'settle', source: 'car:body', sync: T.stop, t1: T.stop + SETTLE_TAIL, place: centre, law: LAWS.car, level: LEVELS.settle, label: '[the car settles on its springs]', derivedFrom: 'carTimes.stop (settlePitch starts); carAt, SHAPE.body', designed: ['t1'] });
  // the deepest point of the dip: where settlePitch stops falling, by the sign of a centred difference (exact for a
  // symmetric dip, and clear of the rounding a search on the flat bottom's values would hit)
  const deepest = edge((t) => w.settlePitch(t + 1e-3) > w.settlePitch(t - 1e-3), T.stop, T.stop + w.SETTLE.dur);
  add({ id: 'hard.settle.car.rebound', category: 'hard', family: 'settle', source: 'car:body', sync: deepest, t1: deepest + SETTLE_TAIL, place: centre, law: LAWS.car, level: LEVELS.rebound, label: '[the springs rebound]', derivedFrom: "settlePitch's deepest point (SETTLE.dur); carAt, SHAPE.body", designed: ['t1'] });
  add({ id: 'hard.stop.car.rundown', category: 'hard', family: 'stop', source: 'car:intake', shape: 'continuous', sync: stop0, t1: stop1, place: intake, law: LAWS.car, track: (t) => { const u = clamp01((t - stop0) / (stop1 - stop0)); return { rpm: ENGINE.idleRpm * (1 - u), dying: 1 - u }; }, level: LEVELS.rundown, label: '[the engine runs down]', sdh: '[engine stops]', derivedFrom: 'carTimes.lightsOff0 to lightsOff1, the span idleLift and the headlights fade over', rule: 'question 2, option b: no key click' });
  const seats = Object.fromEntries(Object.entries(w.PEOPLE_KEYS).map(([id, keys]) => { const k = keys.find((x) => x.pose === 'emerge'); return [id, [k.x, w.EMERGE.hipY, k.z]]; }));
  const between = Object.values(seats).reduce((s, p, i, all) => s.map((v, j) => v + p[j] / all.length), [0, 0, 0]);
  add({ id: 'hard.cabin.car.handbrake', category: 'hard', family: 'cabin', source: 'car:cabin', sync: T.stop + w.SETTLE.dur, t1: T.stop + w.SETTLE.dur + CABIN.handbrake, place: fixed(between), law: LAWS.foley, level: LEVELS.cabin, label: '[handbrake, inside the car]', derivedFrom: 'carTimes.stop + SETTLE.dur (the body level again); between the seats, PEOPLE_KEYS emerge keys, EMERGE.hipY', rule: 'SOUND-PLAN 3.8: the handbrake after the stop', designed: ['t1'], new: true });
  for (const id of Object.keys(w.PEOPLE)) {
    const d = T.doors[doorOf[id]];
    add({ id: `hard.cabin.${id}.belt`, category: 'hard', family: 'cabin', source: 'car:cabin', person: id, sync: d.open0, lead: CABIN.beltLead, t1: d.open0 - CABIN.beltLead + CABIN.belt, place: fixed(seats[id]), law: LAWS.foley, level: LEVELS.cabin, label: `[${id}'s seat belt comes off]`, derivedFrom: `carTimes.doors.${doorOf[id]}.open0 (the door of EXIT.outSide.${id}); the seat, PEOPLE_KEYS.${id} emerge key, EMERGE.hipY`, rule: 'SOUND-PLAN 3.8: a belt before each door opens', designed: ['t1'], new: true });
  }
  // ticks: seeded spacing from the end of the run-down plus a delay, stopping before the moonlight rises
  const bay = fixed(onCar(w, stop1, bayAlong, 0, bodyMid));
  const trng = rngFor('cues:tick');
  for (let t = stop1 + TICK.delay, i = 0; t + TICK.dur < moonRise; i++) {
    const gap = TICK.gap + i * TICK.grow + TICK.jitter * trng();
    add({ id: `hard.tick.car.${String(i + 1).padStart(2, '0')}`, category: 'hard', family: 'tick', source: 'car:engine-bay', sync: t, t1: t + TICK.dur, place: bay, law: LAWS.car, level: LEVELS.tick, label: '[hot metal ticks]', derivedFrom: 'carTimes.lightsOff1 (the engine silent); moonlight(t) > 0 ends them; the engine bay', rule: 'SOUND-PLAN 3.11: seeded spacing from the engine stop plus a delay, ending before the moonlight rises', designed: ['t1'], meta: { n: i + 1, gap } });
    t += gap;
  }

  // ---------- the doors: unlatch, swing open, stop, swing shut, latch ----------
  for (const tag of Object.keys(w.DOOR_SIDE)) {
    const d = T.doors[tag], at = (part, t) => fixed(doorPoint(w, tag, part, t));
    const base = { category: 'hard', family: 'door', source: `car:door:${tag}`, law: LAWS.door, level: LEVELS.door, meta: { door: tag } };
    const from = `carTimes.doors.${tag}`;
    add({ ...base, id: `hard.door.${tag}.unlatch`, sync: d.open0, lead: DOOR.unlatchLead, t1: d.open0 - DOOR.unlatchLead + DOOR.unlatch, place: at('latch', d.open0), label: `[${tag} door unlatches]`, sdh: '[car door opens]', derivedFrom: `${from}.open0; the latch edge, SHAPE.door, DOOR_SIDE`, designed: ['t1'] });
    add({ ...base, id: `hard.door.${tag}.swing-open`, sync: d.open0, t1: d.open1, place: at('hinge', d.open0), label: `[${tag} door swings open]`, derivedFrom: `${from}.open0 to open1; the hinge, SHAPE.door, DOOR_SIDE`, level: LEVELS.doorSwing });
    add({ ...base, id: `hard.door.${tag}.stop`, sync: d.open1, t1: d.open1 + DOOR.stop, place: at('hinge', d.open1), label: `[${tag} door stops, open]`, derivedFrom: `${from}.open1; the hinge, SHAPE.door, DOOR_SIDE`, level: LEVELS.doorSwing, designed: ['t1'], new: true });
    add({ ...base, id: `hard.door.${tag}.swing-shut`, sync: d.close0, t1: d.close1, place: at('hinge', d.close0), label: `[${tag} door swings shut]`, derivedFrom: `${from}.close0 to close1; the hinge, SHAPE.door, DOOR_SIDE`, level: LEVELS.doorSwing, new: true });
    add({ ...base, id: `hard.door.${tag}.latch`, sync: d.close1, t1: d.close1 + DOOR.latch, place: at('latch', d.close1), label: `[${tag} door shuts]`, sdh: '[car door shuts]', derivedFrom: `${from}.close1; the latch edge, SHAPE.door, DOOR_SIDE`, designed: ['t1'] });
  }

  // ---------- getting out: the slide off the seat and the springs unloading as each one rises ----------
  for (const [id, keys] of Object.entries(w.PEOPLE_KEYS)) {
    const i = keys.findIndex((k) => k.pose === 'emerge'), e = keys[i], x = keys[i + 1], up = keys[i + 2];
    const hip = personAt(id, (p) => w.bodyToWorld(p, p.hip));
    add({ id: `hard.unload.${id}.slide`, category: 'hard', family: 'unload', source: `car:seat:${doorOf[id]}`, person: id, shape: 'continuous', sync: e.t, t1: x.t, place: hip, placement: 'tracked', law: LAWS.foley, level: LEVELS.unload, label: `[${id} slides off the seat]`, derivedFrom: `PEOPLE_KEYS.${id}: the emerge key to the exit key; makePoser hip`, new: true });
    add({ id: `hard.unload.${id}.rise`, category: 'hard', family: 'unload', source: `car:seat:${doorOf[id]}`, person: id, shape: 'continuous', sync: x.t, t1: up.t, place: fixed(seats[id]), law: LAWS.foley, level: LEVELS.unload, label: `[the seat springs back as ${id} rises]`, derivedFrom: `PEOPLE_KEYS.${id}: the exit key to the next; the seat, the emerge key, EMERGE.hipY`, new: true });
  }

  // ---------- feet: one step per landing, at the rig's contact, the print time beside it ----------
  const stand = (id) => w.BODY.ankleY * (w.PEOPLE[id].height / 1.8);
  // footprintList()'s own rule: the ankle down when it is within PRINT.rest of standing height over its ground
  const down = (id, foot) => (t) => {
    const p = posers[id](t);
    if (!p.visible) return false;
    const a = w.bodyToWorld(p, p.legs[foot].ankle);
    return a[1] - w.groundY(a[0], a[2]) - stand(id) <= w.PRINT.rest;
  };
  const steps = [];
  for (const f of w.footprintList()) {
    const yes = down(f.id, f.foot), lo = f.t - w.PRINT.dt;
    const prior = posers[f.id](lo).visible && !yes(lo);
    steps.push({ ...f, contact: prior ? edgeSample(yes, lo, f.t) : f.t });
  }
  for (const id of Object.keys(w.PEOPLE)) {
    const own = steps.filter((s) => s.id === id).sort((a, b) => a.contact - b.contact), merged = [];
    for (const s of own) {
      const last = merged[merged.length - 1];
      if (last && s.contact - last.contact < STEP.flam) last.prints.push(s); else merged.push({ ...s, prints: [s] });
    }
    merged.forEach((s, i) => {
      const next = merged[i + 1], both = s.prints.length > 1, surface = surfaceOf(s);
      add({ id: `foley.feet.${id}.${String(i + 1).padStart(2, '0')}`, category: 'foley', family: 'feet', source: `${id}:feet`, person: id, surface, sync: s.contact, print: s.t, t1: s.contact + Math.min(STEP.tail, next ? next.contact - s.contact : STEP.tail), place: fixed([s.x, s.y, s.z]), law: LAWS.foley, level: both ? LEVELS.feetBoth : LEVELS.feet, label: both ? `[${id} lands on both boots, ${surface}]` : `[${id} steps, ${surface}]`, sdh: id === w.footprintList()[0].id && i === 0 ? '[a boot crunches in the snow]' : null, derivedFrom: 'footprintList() (print time and place); the ankle down by its rule, bisected on the sample grid (contact); surfaceOf', rule: both ? 'SOUND-PLAN 3.12: one person\'s contacts within 30 ms are one step' : null, designed: ['t1'], meta: { foot: s.foot, prints: s.prints.map((p) => p.t), contacts: s.prints.map((p) => p.contact) } });
    });
  }

  // ---------- scuffs: a planted ankle sliding without lifting, outside the walk (the turns in place) ----------
  for (const id of Object.keys(w.PEOPLE)) {
    const dt = w.PRINT.dt, n = Math.round(w.T_TOTAL / dt), spans = [];
    for (let foot = 0; foot < 2; foot++) {
      let prev = null, run = null;
      for (let i = 0; i <= n; i++) {
        const t = i * dt, p = posers[id](t);
        const ok = p.visible && p.walk.env === 0 && p.pose !== 'emerge' && p.pose !== 'exit';
        const a = ok ? w.bodyToWorld(p, p.legs[foot].ankle) : null;
        const planted = ok && a[1] - w.groundY(a[0], a[2]) - stand(id) <= w.PRINT.rest;
        const d = planted && prev ? dist2(a, prev) : 0;
        if (d / dt > SCUFF.speed) { if (!run) run = { t0: t - dt, t1: t, d: 0 }; run.t1 = t; run.d += d; }
        else if (run) { if (run.d >= SCUFF.min) spans.push(run); run = null; }
        prev = planted ? a : null;
      }
    }
    // both feet of one turn are one scuff: overlapping spans joined
    spans.sort((a, b) => a.t0 - b.t0);
    const joined = [];
    for (const s of spans) { const last = joined[joined.length - 1]; if (last && s.t0 <= last.t1) last.t1 = Math.max(last.t1, s.t1); else joined.push({ ...s }); }
    joined.forEach((s, i) => add({ id: `foley.scuff.${id}.${i + 1}`, category: 'foley', family: 'scuff', source: `${id}:feet`, person: id, shape: 'continuous', sync: s.t0, t1: s.t1, place: fixed(((p) => [p.x, p.y, p.z])(posers[id](s.t0))), law: LAWS.foley, level: LEVELS.scuff, label: `[${id}'s boots scuff the snow]`, derivedFrom: `makePoser('${id}').pose(t).legs sampled at PRINT.dt, planted by footprintList()'s rule, outside walk (walk.env 0) and getting out`, rule: 'SOUND-PLAN 3.8: ankle slides without lift over a threshold (SCUFF)', new: true }));
  }

  // ---------- moves: cloth on the walk, the turns, the lean and its contact, the shift closer ----------
  for (const [id, keys] of Object.entries(w.PEOPLE_KEYS)) {
    const cloth = { category: 'foley', family: 'moves', source: `${id}:cloth`, person: id, law: LAWS.foley, level: LEVELS.cloth };
    const material = w.PEOPLE[id].coat, walks = [], counts = { turn: 0, shift: 0 };
    for (let i = 0; i + 1 < keys.length; i++) {
      const a = keys[i], b = keys[i + 1], mid = (a.t + b.t) / 2;
      if (posers[id](mid).walk.env > 0) { const last = walks[walks.length - 1]; if (last && last.t1 === a.t) last.t1 = b.t; else walks.push({ t0: a.t, t1: b.t }); continue; }
      if (a.pose === 'emerge' || a.pose === 'exit') continue; // getting out: the unload cues
      const turn = Math.abs(w.wrapDeg(b.face - a.face)), moved = dist2([a.x, 0, a.z], [b.x, 0, b.z]);
      const from = `PEOPLE_KEYS.${id}[${i}] to [${i + 1}]`;
      if (b.pose === 'lean' && a.pose !== 'lean') {
        add({ ...cloth, id: `foley.moves.${id}.lean`, shape: 'continuous', sync: a.t, t1: b.t, place: clothAt(id), placement: 'tracked', label: `[${id} leans on the parapet]`, derivedFrom: `${from} (into the lean); poser root + CLOTH.up`, meta: { material, kind: 'lean' } });
        // the forearms' contact (REST): the first hand within REST.dist of where it rests at the lean key
        const rest = posers[id](b.t).arms.map((arm) => w.bodyToWorld(posers[id](b.t), arm.hand));
        const near = (t) => { const p = posers[id](t); return p.arms.some((arm, h) => { const q = w.bodyToWorld(p, arm.hand); return Math.hypot(q[0] - rest[h][0], q[1] - rest[h][1], q[2] - rest[h][2]) <= REST.dist; }); };
        const contact = firstTrue(near, a.t, b.t, 1 / 240, edgeSample);
        add({ id: `foley.moves.${id}.rest`, category: 'foley', family: 'moves', source: `${id}:arms`, person: id, sync: contact, t1: contact + REST.tail, place: fixed(rest.reduce((s, q) => s.map((v, j) => v + q[j] / rest.length), [0, 0, 0])), law: LAWS.foley, level: LEVELS.rest, label: `[${id}'s forearms come to rest on the stone]`, derivedFrom: `makePoser('${id}') hands against their place at ${from}'s lean key, on the sample grid`, rule: 'SOUND-PLAN 3.8: the contact definition (REST): the first hand within 1 mm of rest', designed: ['t1'], meta: { kind: 'rest' } });
      } else if (turn >= TURN.minDeg) {
        const kind = b.pose === 'cup' ? 'into the lee' : a.pose === 'cup' ? 'out of the lee' : 'in place';
        counts.turn++;
        add({ ...cloth, id: `foley.moves.${id}.turn${counts.turn}`, shape: 'continuous', sync: a.t, t1: b.t, place: clothAt(id), placement: 'tracked', label: kind === 'in place' ? `[${id} turns]` : `[${id} turns ${kind}]`, derivedFrom: `${from} (the face turns); poser root + CLOTH.up`, rule: 'TURN: a held pose turning at least TURN.minDeg', new: kind === 'in place', meta: { material, kind: 'turn', deg: turn } });
      } else if (moved >= SHIFT.min) {
        counts.shift++;
        add({ ...cloth, id: `foley.moves.${id}.shift${counts.shift}`, shape: 'continuous', sync: a.t, t1: b.t, place: clothAt(id), placement: 'tracked', label: `[${id} shifts closer]`, derivedFrom: `${from} (the root moves); poser root + CLOTH.up`, rule: 'SHIFT: a held pose moving at least SHIFT.min', new: true, meta: { material, kind: 'shift' } });
      }
    }
    walks.forEach((s, i) => add({ ...cloth, id: `foley.moves.${id}.walk${i + 1}`, shape: 'continuous', sync: s.t0, t1: s.t1, place: clothAt(id), placement: 'tracked', track: (t) => { const p = posers[id](t); return { swing: p.walk.env, along: p.walk.along }; }, label: `[${id}'s ${material.split(',')[0].split(' ').pop()} swishes with the walk]`, derivedFrom: `PEOPLE_KEYS.${id} segments walking (makePoser walk.env > 0 at their middle), joined; poser root + CLOTH.up`, new: true, meta: { material, kind: 'walk' } }));
  }

  // ---------- the lighter, the drags, the breath (A) ----------
  const smoker = Object.keys(w.PEOPLE).find((id) => w.PEOPLE_KEYS[id].some((k) => k.pose === 'cup'));
  const cup = personAt(smoker, (p) => w.bodyToWorld(p, p.cup)), tip = personAt(smoker, (p) => w.bodyToWorld(p, p.tip)), mouth = personAt(smoker, (p) => w.bodyToWorld(p, p.mouth));
  const L = w.LIGHTER, firstFlame = Math.ceil(L.t0 * w.FPS - 1e-9) / w.FPS; // the first frame lighterOn shows
  const lighter = { category: 'foley', family: 'lighter', source: `${smoker}:lighter`, person: smoker, law: LAWS.foley, level: LEVELS.lighter };
  add({ ...lighter, id: `foley.lighter.${smoker}.strike`, sync: L.t0, lead: LIGHTER_CUE.strikeLead, t1: L.t0, place: cup, placement: 'onset', label: '[the lighter\'s wheel strikes]', sdh: '[lighter clicks]', derivedFrom: 'LIGHTER.t0 (the flame, ahead of its first frame); makePoser cup', rule: 'SOUND-PLAN 3.3: the strike leads the flame it lights', meta: { firstFlame } });
  add({ ...lighter, id: `foley.lighter.${smoker}.flame`, shape: 'continuous', sync: L.t0, t1: L.t1, place: cup, placement: 'tracked', track: (t) => ({ flicker: w.lighterOn(t) ? w.lighterFlicker(t) : 0 }), level: LEVELS.flame, label: '[the flame flutters]', derivedFrom: 'LIGHTER.t0 to t1, lighterOn, lighterFlicker; makePoser cup' });
  add({ ...lighter, id: `foley.lighter.${smoker}.release`, sync: L.t1, t1: L.t1 + LIGHTER_CUE.release, place: cup, placement: 'onset', label: '[the lighter clicks shut]', derivedFrom: 'LIGHTER.t1; makePoser cup', designed: ['t1'] });
  const E = w.EMBER, X = w.EXHALE;
  const after = E.drags.reduce((best, d, i) => (Math.abs(d + E.dragDur - X.t) < Math.abs(E.drags[best] + E.dragDur - X.t) ? i : best), 0);
  E.drags.forEach((d, i) => {
    add({ id: `foley.drag.${smoker}.${i + 1}`, category: 'foley', family: 'drag', source: `${smoker}:cigarette`, person: smoker, shape: 'continuous', sync: d, t1: d + E.dragDur, place: tip, placement: 'tracked', law: LAWS.foley, track: (t) => ({ ember: w.emberLevel(t) }), level: LEVELS.drag, label: `[${smoker} draws on the cigarette]`, derivedFrom: `EMBER.drags[${i}], EMBER.dragDur, emberLevel; makePoser tip` });
    // the drawn exhale follows its drag; the others (no smoke drawn) are offered, default out
    const t0 = i === after ? X.t : d + E.dragDur;
    add({ id: `foley.breath.${smoker}.exhale${i + 1}`, category: 'foley', family: 'breath', source: `${smoker}:breath`, person: smoker, shape: 'continuous', sync: t0, t1: t0 + X.life, place: mouth, placement: 'tracked', law: LAWS.foley, track: (t) => ({ age: t - t0, life: X.life }), level: LEVELS.breath, label: `[${smoker} exhales]`, sdh: i === after ? '[exhales]' : null, derivedFrom: i === after ? 'EXHALE.t, EXHALE.life; makePoser mouth' : `EMBER.drags[${i}] + dragDur, EXHALE.life; makePoser mouth`, rule: i === after ? null : 'SOUND-PLAN 3.8: offered, an exhale after a drag with no smoke drawn', offered: i !== after, new: i !== after });
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
  add({ id: 'bg.hum.lamp.bed', category: 'bg', family: 'hum', source: 'lamp', shape: 'continuous', sync: 0, t1: w.T_TOTAL, place: fixed(w.LAMP.head), law: LAWS.physical, level: LEVELS.hum, label: '[the lamp hums]', derivedFrom: 'LAMP.head; 0 to T_TOTAL' });

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
