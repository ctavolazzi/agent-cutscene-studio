// Sound 1.4 and 1.5: the sound storyboard's measured checks. Builds scripts/lib/sound-checks.js's input from
// src/audio/cues.js and the picture's own modules (everything film specific lives here: the story orders, the bed-only
// windows of SOUND-PLAN 3.11, the blockers, the sync event of each family, the thresholds), runs the traceability
// control (scripts/lib/perturb.mjs) and the 15 checks, and writes <out>/report.json. Deterministic: the same picture
// gives the same bytes.
// Usage: node scripts/sound-report.js [--out <dir>] [--no-perturb]   (default storyboard/sound)
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { CONFIG } from '../src/config.js';
import { CUES, LAWS, DESIGN, LOCATIONS } from '../src/audio/cues.js';
import { listenerAt, placeAt } from '../src/audio/spatial.js';
import { BUILDINGS, BRIDGE } from '../src/set.js';
import { DIMS } from '../src/set/build.js';
import { SHOTS, cameraAt, shotAt } from '../src/shots.js';
import { carAt, carTimes, headlights, moonlight, lighterOn, emberLevel, smokePuffs, CAR, PEOPLE, PEOPLE_KEYS, LIGHTER, T_TOTAL, FPS } from '../src/world.js';
import { SHAPE, doorOpen, settlePitch } from '../src/actors/car.js';
import { bodyToWorld, dims, groundY, makePoser } from '../src/actors/people.js';
import { PRINT, footprintList } from '../src/fx/footprints.js';
import { makeCamera } from './lib/math.js';
import { runSoundChecks, screenState, powerSum } from './lib/sound-checks.js';
import { perturbAll } from './lib/perturb.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { w: W, h: H } = CONFIG.res;
const D2R = Math.PI / 180;
const IDS = Object.keys(PEOPLE);
const posers = Object.fromEntries(IDS.map((id) => [id, makePoser(id)]));
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dist3 = (a, b) => Math.hypot(...sub(a, b));
const frame = (f) => f / FPS;
// the first frame on which yes(t) holds
const firstFrame = (yes) => { for (let f = 0; frame(f) < T_TOTAL; f++) if (yes(frame(f))) return frame(f); return null; };
// the first instant f(t) > 0, by bisection on [0, T_TOTAL]
const firstPositive = (f) => { let lo = 0, hi = T_TOTAL; while (hi - lo > 1e-12) { const m = (lo + hi) / 2; if (f(m) > 0) hi = m; else lo = m; } return hi; };

// ---------- the camera, the listener models and the predicted levels ----------
const camera = (t) => makeCamera(cameraAt(shotAt(t), t), W, H);

// The modifiers (voices 0: the rise, the swell, the story ambiences) change the families they name in meta.modifies
// for the cues their span overlaps: from their t0 by their track (the rise from its level up to 0, the others from 0 to
// their level), holding the value they reach at t1 after it. A reading of SOUND-PLAN 1.3 and 4.1 for prediction only;
// the blockout renders them its own way.
const MODS = CUES.filter((c) => c.enabled && c.voices === 0 && c.meta.modifies);
const fraction = (m, t) => { const k = m.track(Math.min(Math.max(t, m.t0), m.t1 - 1e-9)); return m.id.endsWith('.rise') ? 1 - k.u : k.u ?? k.moon ?? k.pull ?? k.open ?? 0; };
const modDb = (c, t) => MODS.reduce((s, m) => (m.meta.modifies.includes(c.family) && m.t0 < c.t1 && c.t0 < m.t1 && t >= m.t0 ? s + m.level * fraction(m, t) : s), 0);
// the characters' listener (SOUND-PLAN 3.6, Silent Hill's pattern): level from the distance to the people out of the
// car, seen or not (the poser's `visible` is its presence; their cloth points, averaged), pan from the camera; the
// camera's level before anyone is there. Exported so tests/sound-options.test.mjs can hold src/audio/listeners.js,
// which renders this model, to the same point
const clothAt = (id, t) => { const p = posers[id](t); return p.visible ? [p.x, p.y + DESIGN.CLOTH.up, p.z] : null; };
export const charactersAt = (t) => { const ps = IDS.map((id) => clothAt(id, t)).filter(Boolean); return ps.length ? ps.reduce((s, p) => s.map((v, j) => v + p[j] / ps.length), [0, 0, 0]) : null; };
function hear(c, t, model = 'camera') {
  const level = c.level + modDb(c, t);
  if (!c.place) return { db: level, pan: null };
  const p = c.place(t);
  if (!p) return null;
  const law = LAWS[c.law], s = placeAt(p, t, listenerAt(t), law);
  let gain = s.gain;
  if (model === 'characters') { const q = charactersAt(t); if (q) gain = (law.refDist / Math.max(law.refDist, dist3(p, q))) ** law.rolloff; }
  return { db: level + 20 * Math.log10(gain), pan: s.pan };
}

// ---------- blockers (onScreen): set.js and the set builder's sizes, the car's body and cabin ----------
const AX = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const aabb = (name, x0, x1, y0, y1, z0, z1) => ({ name, box: { c: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], ax: AX, h: [(x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2] } });
const inner = BRIDGE.halfWidth - BRIDGE.parapetThick, F = DIMS.far;
const SET_BLOCKERS = [
  ...BUILDINGS.map((b) => aabb(`building ${b.id}`, b.x0, b.x1, 0, b.h, b.z0, b.z1)),
  aabb('parapet east', inner, BRIDGE.halfWidth, 0, BRIDGE.parapetTop, BRIDGE.z1, BRIDGE.z0),
  aabb('parapet west', -BRIDGE.halfWidth, -inner, 0, BRIDGE.parapetTop, BRIDGE.z1, BRIDGE.z0),
  aabb('deck', -BRIDGE.halfWidth, BRIDGE.halfWidth, -DIMS.deckThick, 0, BRIDGE.z1, BRIDGE.z0),
  aabb('bank south', -F, F, -F, 0, BRIDGE.z0, F),
  aabb('bank north', -F, F, -F, 0, -F, BRIDGE.z1),
];
// the car's body and cabin at t as oriented boxes (its right, up and forward axes), or none before it is there
function carBoxes(t) {
  const c = carAt(t);
  if (!c.present) return [];
  const h = c.heading * D2R, fw = [Math.sin(h), 0, -Math.cos(h)], rt = [Math.cos(h), 0, Math.sin(h)], B = SHAPE.body, C = SHAPE.cabin;
  const at = (along, up) => [c.x + fw[0] * along, up, c.z + fw[2] * along];
  return [
    { name: 'car body', box: { c: at(0, (B.y0 + B.y1) / 2), ax: [rt, [0, 1, 0], fw], h: [CAR.width / 2, (B.y1 - B.y0) / 2, CAR.length / 2] } },
    { name: 'car cabin', box: { c: at(-C.back, (C.y0 + C.y1) / 2), ax: [rt, [0, 1, 0], fw], h: [C.width / 2, (C.y1 - C.y0) / 2, C.length / 2] } },
  ];
}
// The car's own sounds are judged against its body and cabin like any point (a far door, the exhaust, the tyres under
// it), except a point inside one of them (the engine bay, the springs, the brake at the axle), which by convention
// sounds through its own surface. What sounds inside the car for a person (the cabin, getting out) is hidden by it.
const ownCar = (c) => c.source.startsWith('car') && !['cabin', 'unload'].includes(c.family);
const blockers = (c, t) => [...SET_BLOCKERS, ...(ownCar(c) ? carBoxes(t).map((b) => ({ ...b, own: true })) : carBoxes(t))];

// ---------- the story orders (SOUND-PLAN 1.3) ----------
const firstLight = firstFrame((t) => headlights(t) > 0 && carAt(t).present);
const moonRise = firstPositive(moonlight), moonFull = (() => { let lo = moonRise, hi = T_TOTAL; while (hi - lo > 1e-12) { const m = (lo + hi) / 2; if (moonlight(m) >= 1) hi = m; else lo = m; } return hi; })();
// the bodies first seen: the first frame showing either head on screen, unhidden
const headAt = (id, t) => { const p = posers[id](t); return p.visible ? bodyToWorld(p, p.head) : null; };
const pseudo = { id: 'head', source: 'person', family: 'body' };
const bodiesSeen = firstFrame((t) => IDS.some((id) => screenState({ camera, blockers }, pseudo, headAt(id, t), t).state === 'on'));
const ORDERS = [
  { name: 'Light before the car: no car sound before the first frame that shows its light', kind: 'notBefore', t: firstLight, select: (c) => c.source.startsWith('car') },
  // off screen is allowed: B's steps off screen right in shot 5 are kept on purpose (SOUND-PLAN 3.7) and show no body;
  // hidden or behind the camera would put a sound on a person the frame could have shown
  { name: 'Feet before the people: until the first frame showing a head, every step and scuff lands on feet in frame or out of it, never hidden or behind', kind: 'onScreen', allow: ['on', 'off'], t0: 0, t1: bodiesSeen, select: (c) => c.family === 'feet' || c.family === 'scuff' },
  { name: 'Anticipation before the moon: no onset while the moonlight rises', kind: 'noOnset', t0: moonRise, t1: moonFull, select: (c) => c.category !== 'bg' },
];

// ---------- sync: the event each family's cue belongs to, as a state the picture shows at frame times ----------
// A rule's state changes on the frame that shows the event: from false to true, or ('any') to another value.
const prints = footprintList();
const downAt = (id, foot, t) => { const p = posers[id](t); if (!p.visible) return false; const a = bodyToWorld(p, p.legs[foot].ankle); return a[1] - groundY(a[0], a[2]) - dims(id).ankleY <= PRINT.rest; };
const ankleAt = (id, foot, t) => { const p = posers[id](t); return bodyToWorld(p, p.legs[foot].ankle); };
// a point as the PS1 vertex snap draws it: its internal pixel (src/ps1/material.js)
const snapOf = (cam, p) => { const s = cam.project(p); return s && [Math.floor((s[0] / cam.W * 2 - 1) * cam.W / 2 + 0.5), Math.floor((1 - s[1] / cam.H * 2) * cam.H / 2 + 0.5)]; };
const handsAt = (id, t) => { const p = posers[id](t); return p.arms.map((a) => bodyToWorld(p, a.hand)); };
const keyAfter = (id, t) => PEOPLE_KEYS[id].find((k) => k.t > t);
// A move made from a key (getting out, walks, turns, the lean, a shift) starts at that key in the data; the picture
// shows it on the first frame after the key that draws the person moving: a drawn point (head, hip, hands, ankles), on
// screen and unhidden, on another internal pixel than on the frame before, both through this frame's camera (so the
// camera's own motion does not count). Not judged when no point of the person is in view at the key.
const PERSON = { id: 'person', source: 'person', family: 'body' };
const drawnAt = (id, t) => { const p = posers[id](t); return p.visible ? [p.head, p.hip, ...p.arms.map((a) => a.hand), ...p.legs.map((l) => l.ankle)].map((v) => bodyToWorld(p, v)) : []; };
const inView = (id, t) => drawnAt(id, t).some((q) => screenState({ camera, blockers }, PERSON, q, t).state === 'on');
const drawnMoving = (id, t) => { const cam = camera(t), a = drawnAt(id, t), b = drawnAt(id, t - 1 / FPS); return a.length === b.length && a.some((q, i) => screenState({ camera, blockers }, PERSON, q, t).state === 'on' && String(snapOf(cam, q)) !== String(snapOf(cam, b[i]))); };
function fromKey(c, what) {
  const at = Math.floor(c.sync * FPS + 1e-9) / FPS; // the last frame at or before the key
  if (!inView(c.person, at)) return { reason: `${c.person} is off screen or hidden at the key: the start is not shown` };
  return { event: `${what}: ${c.person} drawn moving after the key (a drawn point on another pixel)`, state: (t) => t > c.sync + 1e-9 && drawnMoving(c.person, t), note: drawnMoving(c.person, at) ? 'carries on from a motion drawn before its key' : null };
}
const lit = (t) => headlights(t) > 0 && carAt(t).present;
const frontSeen = (t) => {
  const k = carAt(t), h = k.heading * D2R;
  return k.present && [-1, 0, 1].some((s) => screenState({ camera, blockers: () => SET_BLOCKERS }, pseudo, [k.x + Math.sin(h) * CAR.length / 2 + Math.cos(h) * s * CAR.width / 2, (SHAPE.body.y0 + SHAPE.body.y1) / 2, k.z - Math.cos(h) * CAR.length / 2 + Math.sin(h) * s * CAR.width / 2], t).state === 'on');
};
// Exported for scripts/sound-review.js, which judges the same events on the measured onsets (Sound 2.6).
export function syncRule(c) {
  if (!c.enabled || c.category === 'bg') return null;
  const part = c.id.split('.')[3];
  switch (c.family) {
    case 'feet': {
      const feet = c.meta.prints.map((t) => prints.find((p) => p.id === c.person && p.t === t).foot);
      return { event: 'a boot on the ground (the rig\'s ankle at standing height)', state: (t) => feet.some((f) => downAt(c.person, f, t)) };
    }
    case 'door': {
      const d = carTimes.doors[c.meta.door], open = (t) => doorOpen(d, t);
      if (part === 'unlatch' || part === 'swing-open') return { event: 'the door moving (doorOpen above 0)', state: (t) => open(t) > 0 };
      if (part === 'stop') return { event: 'the door full open (doorOpen 1)', state: (t) => open(t) >= 1 };
      if (part === 'swing-shut') return { event: 'the door swinging back (doorOpen under 1 once open)', state: (t) => t >= d.open1 && open(t) < 1 };
      return { event: 'the door shut (doorOpen 0 once swinging back)', state: (t) => t >= d.close0 && open(t) === 0 };
    }
    case 'engine': case 'tyres':
      if (part.endsWith('idle')) return { event: 'the car at rest', state: (t) => carAt(t).present && carAt(t).speed === 0 };
      return { event: 'the car\'s first light (headlights)', state: lit };
    case 'arrival':
      if (part === 'rise') return { event: 'the car\'s first light (headlights)', state: lit };
      return { event: 'the car\'s front in frame past the buildings', state: frontSeen };
    case 'brake':
      if (part === 'creak') return { reason: 'a designed speed threshold, not an event on screen' };
      return { event: 'the car slowing', state: (t) => carAt(t).speed < carAt(c.sync).speed - 1e-9 };
    case 'settle':
      if (part === 'dip') return { event: 'the nose going down (settlePitch under 0)', state: (t) => settlePitch(t) < 0 };
      return { event: 'the nose coming back up', state: (t) => t > carTimes.stop && settlePitch(t) > settlePitch(t - 1 / FPS) };
    case 'stop': return { event: 'the lights fading (headlights under 1)', state: (t) => t >= carTimes.lightsOff0 && headlights(t) < 1 };
    case 'tick': return { reason: 'rule-made: hot metal, nothing the picture shows' };
    case 'cabin': return { reason: 'inside the car, off screen: nothing the picture shows' };
    case 'unload': return fromKey(c, 'getting out from its key (PEOPLE_KEYS)');
    case 'scuff': {
      // the planted ankle drawn on another pixel than on the frame before (the vertex snap)
      const foot = c.meta.first[0];
      return { event: 'the planted ankle drawn sliding (its pixel changes)', state: (t) => { const cam = camera(t); return downAt(c.person, foot, t) && String(snapOf(cam, ankleAt(c.person, foot, t))) !== String(snapOf(cam, ankleAt(c.person, foot, t - 1 / FPS))); } };
    }
    case 'moves': {
      const key = keyAfter(c.person, c.sync);
      if (c.meta.kind === 'rest') {
        const rest = handsAt(c.person, key.t);
        return { event: 'the hands drawn on their rest pixels (the vertex snap)', state: (t) => { const cam = camera(t); return handsAt(c.person, t).every((q, i) => String(snapOf(cam, q)) === String(snapOf(cam, rest[i]))); } };
      }
      if (c.meta.kind === 'cup') {
        // the hands' spacing within half an internal pixel, at their depth, of their spacing at the cup key: their screen
        // offset is no measure, it turns with the body
        const gap = (t) => { const [a, b] = handsAt(c.person, t); return dist3(a, b); }, width = gap(key.t);
        const cupAt = (t) => { const p = posers[c.person](t); return bodyToWorld(p, p.cup); };
        return { event: 'the hands drawn closed round the lighter (their spacing within half a pixel of the cup\'s)', state: (t) => { const cam = camera(t); return Math.abs(gap(t) - width) * cam.scaleAt(cam.toCam(cupAt(t))[2]) <= 0.5; } };
      }
      return fromKey(c, `the ${c.meta.kind} from its key (PEOPLE_KEYS)`);
    }
    case 'lighter':
      if (part === 'release') return { event: 'the flame out (lighterOn false)', state: (t) => t >= LIGHTER.t0 && !lighterOn(t) };
      return { event: 'the flame (lighterOn)', state: lighterOn };
    case 'drag': return { event: 'the ember brightening (emberLevel over its steady 1)', state: (t) => emberLevel(t) > 1 + 1e-9 };
    case 'breath': return { event: 'the exhaled smoke drawn (smokePuffs)', state: (t) => smokePuffs(t, [0, 0, 0]).some((p) => p.kind === 'exhale') };
    default: return { reason: `no sync event declared for ${c.family}` };
  }
}

// ---------- the other per-check inputs ----------
// SOUND-PLAN 3.6's steady placed sources, which hold at a cut: the lamp's hum and the engine at rest from carTimes.stop
const STEADY = { select: (c) => c.family === 'hum' || (c.family === 'engine' && c.sync === carTimes.stop), label: 'SOUND-PLAN 3.6: the lamp\'s hum and the engine idling at rest from carTimes.stop' };
const carCentre = (t) => { const k = carAt(t); return k.present ? [k.x, (SHAPE.body.y0 + SHAPE.body.y1) / 2, k.z] : null; };
const carDb = (t) => { const dbs = CUES.filter((c) => c.enabled && c.voices > 0 && ['engine', 'tyres'].includes(c.family) && c.t0 <= t && t < c.t1).map((c) => hear(c, t)?.db).filter((x) => x !== undefined && x !== null); return dbs.length ? powerSum(dbs) : null; };
const shot = (n) => SHOTS.find((s) => s.n === n);
// SOUND-PLAN 3.11's bed-only windows, by shot
const WINDOWS = [[1, 2, 'the hush before the car'], [10, 10, 'moonrise, held for music'], [12, 12, 'B looks'], [15, 15, 'the final wide, held for music']].map(([a, b, name]) => ({ name: `${name} (shot${a === b ? ` ${a}` : `s ${a} to ${b}`})`, t0: shot(a).start, t1: shot(b).end }));
// the story cues' bands, declared by family from the blockout's placeholders (SOUND-PLAN 4.4), until Sound 2 measures them
const PHONE = { lo: 300, hi: 8000 };
const BANDS = {
  engine: { ...PHONE, from: 'SOUND-PLAN 4.4: a buzz kept in a band a phone can play' },
  stop: { ...PHONE, from: 'SOUND-PLAN 4.4: a click, then the engine\'s buzz falling' },
  door: { ...PHONE, from: 'SOUND-PLAN 4.4: clicks, sweeps, a knock, a thump' },
  feet: { ...PHONE, from: 'SOUND-PLAN 4.4: a broadband band-limited noise burst' },
  lighter: { ...PHONE, from: 'SOUND-PLAN 4.4: a click and held noise' },
  breath: { ...PHONE, from: 'SOUND-PLAN 4.4: a filtered noise swell' },
};
const THRESHOLDS = {
  syncAhead: { v: 0.045, starting: true, why: 'ITU-R BT.1359, SOUND-PLAN 3.3' },
  syncSearch: { v: 0.5, starting: false, why: 'how far round its instant a cue\'s first showing frame is looked for' },
  stereoSep: { v: 0.1, starting: true, why: 'about 1.4 dB of channel balance, by ear at Sound 2' },
  holdDb: { v: 3, starting: true, why: 'SOUND-PLAN 3.6' },
  holdPan: { v: 0.25, starting: true, why: 'SOUND-PLAN 3.6' },
  jumpDb: { v: 6, starting: true, why: 'SOUND-PLAN 4.3' },
  cutStream: { v: 2, starting: true, why: 'a source\'s gap across a cut against the shorter of its neighbouring gaps: each stream\'s measured ratio is in its row' },
  approachFall: { v: 1, starting: true, why: 'SOUND-PLAN 3.10' },
  maskBefore: { v: 0.2, starting: true, why: 'forward masking, SOUND-PLAN 4.3' },
  maskAfter: { v: 0.02, starting: true, why: 'backward masking, SOUND-PLAN 4.3' },
  maskDb: { v: 6, starting: true, why: 'SOUND-PLAN 4.3' },
  bedMargin: { v: 3, starting: true, why: 'SOUND-PLAN 4.3' },
  bedWindow: { v: 0.1, starting: false, why: 'the level plan\'s 100 ms window, SOUND-PLAN 1.3' },
  bedStep: { v: 0.01, starting: false, why: 'the grid the bed is sampled on' },
  flam: { v: DESIGN.STEP.flam, starting: false, why: 'cues.js DESIGN.STEP.flam, SOUND-PLAN 3.12' },
  densityStep: { v: 0.01, starting: false, why: 'SOUND-PLAN 4.3' },
  densityRecent: { v: 0.1, starting: true, why: 'SOUND-PLAN 4.3' },
  densityDb: { v: 6, starting: true, why: 'SOUND-PLAN 4.3' },
  densityReport: { v: 2, starting: true, why: 'Murch\'s two and a half' },
  densityFail: { v: 3, starting: true, why: 'Murch\'s two and a half' },
  voiceLimit: { v: 24, starting: false, why: 'the SPU\'s 24 voices, psx-spx' },
  lowHz: { v: 250, starting: true, why: 'SOUND-PLAN 4.3' },
};

export function buildInput({ trace = null } = {}) {
  return {
    cues: CUES, fps: FPS, total: T_TOTAL, shots: SHOTS.map(({ n, start, end, lens }) => ({ n, start, end, lens })), locations: LOCATIONS,
    listener: listenerAt, place: placeAt, camera, hear, models: ['camera', 'characters'], blockers,
    trace, orders: ORDERS, sync: { rule: syncRule },
    stereo: { shots: SHOTS.filter((s) => s.n >= 9).map((s) => s.n), left: 'A', right: 'B', point: clothAt, pointLabel: 'the cloth points (the poser\'s root + DESIGN.CLOTH.up)' },
    steady: STEADY,
    approach: [{ name: 'the car', point: carCentre, level: carDb, blockers: () => SET_BLOCKERS }],
    flams: { isContact: (c) => c.family === 'feet' || (c.family === 'moves' && ['rest', 'cup'].includes(c.meta.kind)) },
    // the bars count bodies: a car's intake, exhaust and tyres fuse into one object the ear follows (Murch's two and a
    // half is about streams the listener can follow), as one person's steps and cloth do
    density: { select: (c) => c.category !== 'bg', body: (c) => c.person ?? c.source.split(':')[0], by: 'body' },
    silence: { windows: WINDOWS, select: (c) => c.category === 'hard' || c.category === 'foley' },
    safeBand: { story: (c) => c.sdh !== null, band: (c) => BANDS[c.family] ?? null, measured: false },
    thresholds: THRESHOLDS,
  };
}

export async function makeReport({ perturb = true } = {}) {
  const trace = perturb ? await perturbAll() : null;
  return runSoundChecks(buildInput({ trace }));
}

async function main() {
  const { values: a } = parseArgs({ options: { out: { type: 'string', default: 'storyboard/sound' }, 'no-perturb': { type: 'boolean', default: false } }, strict: true });
  const report = await makeReport({ perturb: !a['no-perturb'] });
  const dir = resolve(ROOT, a.out);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'report.json'), `${JSON.stringify(report, null, 1)}\n`);
  for (const c of report.checks) console.log(`${String(c.n).padStart(2)} ${c.id.padEnd(15)} ${c.status.padEnd(6)} ${c.summary}`);
  console.log(`wrote ${resolve(dir, 'report.json')}: ${report.cues} cues, ${report.enabled} enabled`);
}

const isMain = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((e) => { console.error(`sound-report failed: ${e.stack}`); process.exitCode = 1; });
