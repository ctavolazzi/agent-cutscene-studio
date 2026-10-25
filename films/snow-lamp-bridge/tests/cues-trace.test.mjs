// Sound 1.5, the traceability control (SOUND-PLAN 4.2): makeCues against a perturbed picture, one input family at a
// time, each in a child process whose module hook serves a patched world.js, set.js, shots.js or actors/car.js to every
// importer (scripts/lib/perturb.mjs). The declared table below says, family by family, which perturbations must move
// a cue and how; the trace check (scripts/lib/sound-checks.js) compares it with what moved. A planted module, imported
// in the same hooked children, carries a literal-time cue, a door cue reading the wrong door, today's RUSTLES, a step
// whose time reads footprintList() while its place is typed in, and a cue of A's whose time reads B's keys.
// Run: node --test tests/cues-trace.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CUES, LOCATIONS } from '../src/audio/cues.js';
import { PEOPLE_KEYS } from '../src/world.js';
import { RAIL } from '../src/set.js';
import { DOOR_SIDE } from '../src/actors/car.js';
import { EXIT } from '../src/actors/people.js';
import { trace } from '../scripts/lib/sound-checks.js';
import { perturbAll, makePerturbations } from '../scripts/lib/perturb.mjs';
import { buildInput } from '../scripts/sound-report.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = (p) => pathToFileURL(resolve(ROOT, p)).href;
const byId = new Map(CUES.map((c) => [c.id, c]));
const like = (id, patch) => Object.freeze({ ...byId.get(id), ...patch });

// ---------- the planted module ----------
// Imported by every child after cues.js, so it sees the same patched picture. Its cues are plain snapshots. A data:
// URL, so no file is written: it imports the picture by absolute URL, the same modules the hook patches.
const LAST_A = CUES.filter((c) => c.family === 'feet' && c.person === 'A').at(-1);
const PLANTED = `data:text/javascript,${encodeURIComponent(`
import { carTimes, PEOPLE_KEYS } from '${src('src/world.js')}';
import { footprintList } from '${src('src/fx/footprints.js')}';
import { RUSTLES } from '${src('src/audio/layers/foley.js')}';
const cue = (id, t, dur, extra = {}) => ({ id, sync: t, t0: t, t1: t + dur, enabled: true, place: null, ...extra });
const last = footprintList().filter((p) => p.id === 'A').at(-1);
export const CUES = [
  cue('planted.literal', 62.0, 1.5), // A's lean key, typed as a number
  cue('planted.door.wrong', carTimes.doors.passenger.close1, 0.25), // the driver's latch, reading the passenger's door
  ...RUSTLES.map((r, i) => cue('planted.rustle.' + (i + 1), r.t, r.dur)), // today's typed cloth moments
  // A's last step: its time and print from footprintList(), its place typed in as it stood when authored
  cue('planted.typed.step', last.t, ${LAST_A.t1 - LAST_A.t0}, { print: last.t, place: () => ${JSON.stringify(LAST_A.place(LAST_A.t0))} }),
  cue('planted.person.wrong', PEOPLE_KEYS.B.find((k) => k.pose === 'lean').t, 1.5), // A's lean, reading B's lean key
];
`)}`;
// the planted cues as the catalogue would carry them: their provenance claims what a derived cue would read
const PLANTED_CUES = [
  like('foley.moves.A.lean', { id: 'planted.literal', sync: 62.0, t0: 62.0, t1: 63.5, place: null, rule: null }),
  like('hard.door.driver.latch', { id: 'planted.door.wrong', place: null }),
  ...[0, 1, 2, 3].map((i) => like('foley.moves.A.lean', { id: `planted.rustle.${i + 1}`, place: null, rule: null, derivedFrom: 'PEOPLE_KEYS (the lean, the lee turns); poser root + CLOTH.up' })),
  like(LAST_A.id, { id: 'planted.typed.step' }),
  like('foley.moves.A.lean', { id: 'planted.person.wrong', place: null, rule: null }),
];

// ---------- the declared table ----------
// Codes: '.' still (the default); 'S' sync, t0, t1 and a step's print move by exactly the perturbation's shift; 's'
// sync and t0 do, t1 stays; 't' only t1 does; a trailing 'p' lets the place move; 'P' the times stay and the place must
// move; 'p' alone the times stay, the place may move; 'c' a step under a change of the walk's ground or path, compared
// by its number among the person's steps: wherever its print moves (another step) its place must move too, and the
// contact, the count and the rest may change; '~' it must move somehow; '?' free.
// A cue's place follows a person's rig, so under that person's keys it may move wherever the person is still moving
// at the cue's own times (the lighter strikes as A comes out of the turn into the lee); its time must not.
const doorOf = (id) => Object.keys(DOOR_SIDE).find((tag) => DOOR_SIDE[tag] === EXIT.outSide[id]);
const keyAt = (c, t) => PEOPLE_KEYS[c.person].find((k) => k.t === t);
const atRail = (c, t) => { const ks = PEOPLE_KEYS[c.person].filter((k) => k.t <= t); return ks[ks.length - 1].x === RAIL.x; };
const TABLE = [
  ['the drive (engine, exhaust)', (c) => /^hard\.engine\.car\.(intake|exhaust)$/.test(c.id), () => ({ 'car.start': 'sp', 'car.stop': 'tp', 'car.dims': 'P', 'car.shape': 'P' })],
  ['the idle', (c) => /^hard\.engine\.car\.\w+-idle$/.test(c.id), () => ({ 'car.stop': 's', 'car.lights': 't', 'car.dims': 'P', 'car.shape': 'P' })],
  ['the idle through an open door (offered)', (c) => c.id === 'hard.engine.car.door-open', () => ({ 'doors.driver': 's', 'doors.passenger': 't', 'car.dims': 'P', 'car.shape': 'P' })],
  ['the rise', (c) => c.id === 'hard.arrival.car.rise', () => ({ 'car.start': 'S', 'car.shape': 'P' })],
  // a longer car shows its front sooner: the swell's onset moves, by no shift
  ['the swell', (c) => c.id === 'hard.arrival.car.swell', () => ({ 'car.start': 'sp', 'car.stop': 'tp', 'car.dims': '~', 'car.shape': 'P' })],
  ['the tyres', (c) => c.family === 'tyres', () => ({ 'car.start': 'sp', 'car.stop': 'tp', 'car.shape': 'P' })],
  ['the brake from carTimes.brake', (c) => c.id === 'hard.brake.car.pads1', () => ({ 'car.start': 'S', 'car.shape': 'P' })],
  ['the brake to the stop', (c) => c.id === 'hard.brake.car.pads2', () => ({ 'car.start': 'sp', 'car.stop': 'tp', 'car.shape': 'P' })],
  // the creak starts under a speed: moving the drive's start or the stop reshapes the last stretch, so it moves by no shift
  ['the creak', (c) => c.id === 'hard.brake.car.creak', () => ({ 'car.start': '~', 'car.stop': '~', 'car.shape': 'P' })],
  ['the settle', (c) => c.family === 'settle', () => ({ 'car.stop': 'S', 'car.shape': 'P' })],
  ['the handbrake', (c) => c.id === 'hard.cabin.car.handbrake', () => ({ 'car.stop': 'S' })],
  ['the belts', (c) => c.family === 'cabin' && c.person, (c) => ({ [`doors.${doorOf(c.person)}`]: 'S' })],
  ['the run-down', (c) => c.family === 'stop', () => ({ 'car.lights': 'S', 'car.dims': 'P', 'car.shape': 'P' })],
  // the chain ends before the moonlight rises by its rule; 0.5 s later adds no tick, the next one would start after it
  ['the ticks', (c) => c.family === 'tick', () => ({ 'car.lights': 'S', 'car.dims': 'P', 'car.shape': 'P' })],
  ['the doors', (c) => c.family === 'door', (c) => ({ [`doors.${c.meta.door}`]: 'S', 'car.shape': 'P' })],
  ['getting out', (c) => c.family === 'unload', (c) => ({ [`keys.${c.person}`]: 'S' })],
  // the steps near the abutment (the curb's ramp) and on the last walk to the rail move with the rig: measured, A.26 to
  // A.29 and B.20 to B.23 under the bridge (B.20 by its contact alone, 1 ms, its print and place kept), A.34 and B.26 to
  // B.28 under the rail, where A takes one step fewer (A.35 gone)
  ['the steps', (c) => c.family === 'feet', (c) => ({ [`keys.${c.person}`]: 'S', bridge: 'c', rail: 'c' })],
  ['the scuffs', (c) => c.family === 'scuff', (c) => ({ [`keys.${c.person}`]: 'S', rail: atRail(c, c.sync) ? 'P' : '.' })],
  ['cloth on the walk', (c) => c.meta.kind === 'walk', (c) => ({ [`keys.${c.person}`]: 'S', rail: keyAt(c, c.t1)?.x === RAIL.x ? 'P' : '.' })],
  ['the lean', (c) => c.meta.kind === 'lean', (c) => ({ [`keys.${c.person}`]: 'S', rail: 'P' })],
  // the rest is judged through shot 9's orbiting camera, whose half pixel changes with time: it moves, by no shift
  ['the forearms\' rest', (c) => c.meta.kind === 'rest', (c) => ({ [`keys.${c.person}`]: '~', rail: 'P' })],
  ['the turns', (c) => c.meta.kind === 'turn', (c) => ({ [`keys.${c.person}`]: 'S', rail: atRail(c, c.sync) ? 'P' : '.' })],
  ['the cup', (c) => c.meta.kind === 'cup', () => ({ 'keys.A': 'S', rail: '~' })],
  ['the shift closer', (c) => c.meta.kind === 'shift', (c) => ({ [`keys.${c.person}`]: 'S', rail: 'P' })],
  ['the lighter', (c) => c.family === 'lighter', () => ({ lighter: 'S', 'keys.A': 'p', rail: 'P' })],
  ['the drags', (c) => c.family === 'drag', () => ({ ember: 'S', 'keys.A': 'p', rail: 'P' })],
  ['the drawn exhale', (c) => c.family === 'breath' && !c.offered, () => ({ exhale: 'Sp', 'keys.A': 'p', rail: 'P' })],
  ['the offered exhales', (c) => c.family === 'breath' && c.offered, () => ({ ember: 'Sp', 'keys.A': 'p', rail: 'P' })],
  ['the street beds', (c) => c.category === 'bg' && c.meta.location === 'street', () => ({ place: 't' })],
  ['the bridge beds', (c) => c.category === 'bg' && c.meta.location === 'bridge', () => ({ place: 's' })],
  ['the wind eases', (c) => c.id === 'bg.ambience.wind.ease', () => ({ moonlight: 'S' })],
  // rule-made from shot 15's camera move, which no perturbation touches
  ['the night opens', (c) => c.id === 'bg.ambience.night.open', () => ({})],
  ['the hum', (c) => c.family === 'hum', () => ({ lamp: 'P' })],
];
const CODES = {
  '.': { kind: 'still' }, S: { kind: 'shift', fields: ['sync', 't0', 't1', 'print'] }, Sp: { kind: 'shift', fields: ['sync', 't0', 't1', 'print'], free: ['place'] },
  s: { kind: 'shift', fields: ['sync', 't0'] }, sp: { kind: 'shift', fields: ['sync', 't0'], free: ['place'] },
  t: { kind: 'shift', fields: ['t1'] }, tp: { kind: 'shift', fields: ['t1'], free: ['place'] }, P: { kind: 'still', must: ['place'] }, p: { kind: 'still', free: ['place'] },
  c: { kind: 'still', free: ['sync', 't0', 't1', 'print', 'place', 'gone', 'added', 'other'], couple: [['print', 'place']] },
  '~': { kind: 'moves' }, '?': { kind: 'free' },
};
const rowOf = (c, table = TABLE) => table.filter(([, sel]) => sel(c));
const expectFrom = (table) => (c, pid) => { const rows = rowOf(c, table); const code = rows.length === 1 ? rows[0][2](c)[pid] ?? '.' : null; return code === null ? null : { ...CODES[code], label: code }; };
// contacts bisected on the audio sample grid: the plan's 1e-6 s; every other derived time 1e-9 s
const tolOf = (c) => (c.family === 'feet' || c.family === 'scuff' || ['rest', 'cup'].includes(c.meta.kind) ? 1e-6 : 1e-9);

let RUN = null;
const perturbed = async () => (RUN ??= await perturbAll({ extra: PLANTED }));
const traceOf = (T, { cues = CUES, table = TABLE } = {}) => trace({ ...buildInput({ trace: { ...T, expect: expectFrom(table), tol: tolOf } }), cues });

test('the table covers the catalogue: every cue in exactly one row, every perturbation it names one that exists', () => {
  const ids = new Set(makePerturbations({ placeShot: LOCATIONS[1].shots[0] }).map((p) => p.id));
  for (const c of CUES) assert.equal(rowOf(c).length, 1, `${c.id}: ${rowOf(c).map((r) => r[0])}`);
  for (const [name, sel, f] of TABLE) for (const c of CUES.filter(sel)) for (const [pid, code] of Object.entries(f(c))) assert.ok(ids.has(pid) && code in CODES, `${name}: ${pid} ${code}`);
});

test('every perturbation reaches its constant through the hook (no fallback needed)', async () => {
  const T = await perturbed();
  assert.deepEqual(T.perturbations.filter((p) => !p.reached).map((p) => `${p.id}: ${p.note}`), []);
  assert.equal(T.perturbations.length, 17);
});

test('the catalogue moves exactly as the table says under every perturbation, pure shifts exactly', async () => {
  const r = traceOf(await perturbed());
  // every problem row counts, as in the report: a cue only a perturbed picture has is judged there too
  assert.deepEqual(r.rows.filter((x) => x.problem).map((x) => `${x.cue} ${x.perturbation}: ${x.problem}`), []);
  // the steps the rail and the bridge reach: their print and place move together, and A's last is gone under the rail
  const stepMoves = (pid) => r.rows.filter((x) => x.perturbation === pid && x.moved && byId.get(x.cue)?.family === 'feet').map((x) => x.cue).sort();
  assert.deepEqual([stepMoves('rail'), stepMoves('bridge')], [['foley.feet.A.34', 'foley.feet.A.35', 'foley.feet.B.26', 'foley.feet.B.27', 'foley.feet.B.28'], ['foley.feet.A.26', 'foley.feet.A.27', 'foley.feet.A.28', 'foley.feet.A.29', 'foley.feet.B.20', 'foley.feet.B.21', 'foley.feet.B.22', 'foley.feet.B.23']]);
  // every cue moves under something except the rule-made night opening; and the shifts that should be exact are
  const movers = new Set(r.rows.filter((x) => x.moved && byId.has(x.cue)).map((x) => x.cue));
  assert.deepEqual(CUES.filter((c) => !movers.has(c.id)).map((c) => c.id), ['bg.ambience.night.open']);
  const shifts = r.rows.filter((x) => byId.has(x.cue) && CODES[x.expected]?.kind === 'shift' && !x.problem).length;
  console.log(`   ${shifts} cue moves that are exact time shifts, ${movers.size} of ${CUES.length} cues moved`);
  assert.ok(shifts >= 140, `${shifts} exact shifts (153 measured when the table was written; a floor, so a table that stops checking shifts fails)`);
  // controls: a table entry wrong by one code (the hum still under the lamp), and a cue whose provenance does not name
  // what it reads (the hum without LAMP.head)
  const wrongTable = TABLE.map((row) => (row[0] === 'the hum' ? [row[0], row[1], () => ({})] : row));
  assert.ok(traceOf(await perturbed(), { table: wrongTable }).rows.some((x) => x.cue === 'bg.hum.lamp.bed' && /the table says still/.test(x.problem ?? '')), 'control: a wrong table entry');
  const vague = CUES.map((c) => (c.id === 'bg.hum.lamp.bed' ? { ...c, derivedFrom: 'the lamp; 0 to T_TOTAL' } : c));
  assert.ok(traceOf(await perturbed(), { cues: vague }).rows.some((x) => x.cue === 'bg.hum.lamp.bed' && /names none/.test(x.problem ?? '')), 'control: an unnamed input');
});

test('planted: a literal time, a door cue reading the wrong door, today\'s RUSTLES, a typed step place and A reading B\'s keys are caught', async () => {
  const r = traceOf(await perturbed(), { cues: [...CUES, ...PLANTED_CUES] });
  const of = (id) => r.rows.filter((x) => x.cue === id && x.problem).map((x) => `${x.perturbation}: ${x.problem}`);
  // the literal: still where A's keys move, and moved by nothing
  assert.ok(of('planted.literal').some((x) => /^keys\.A: .*not the shift/.test(x)) && of('planted.literal').some((x) => /never moves/.test(x)), of('planted.literal').join('\n'));
  // the wrong door: still under its own door, moved by the other one, whose inputs its provenance does not name
  const w = of('planted.door.wrong');
  assert.ok(w.some((x) => /^doors\.driver: .*not the shift/.test(x)) && w.some((x) => /^doors\.passenger: .*names none/.test(x)), w.join('\n'));
  // the rustles: the lean and lee-turn keys move, the rustles do not (SOUND-PLAN 4.2)
  for (let i = 1; i <= 4; i++) assert.ok(of(`planted.rustle.${i}`).some((x) => /never moves/.test(x)), `planted.rustle.${i}`);
  // the typed step place: under A's keys it shifts like a step, under the rail its print moves to A's new last print
  // and its place stays where it was typed
  const typed = of('planted.typed.step');
  assert.ok(typed.some((x) => /^rail: .*the place does not follow the print/.test(x)) && !typed.some((x) => /^keys\.A/.test(x)), typed.join('\n'));
  // A's lean reading B's lean key: it moves under B's keys, whose inputs it does not name (PEOPLE_KEYS.A is not B's),
  // and is still under A's
  const person = of('planted.person.wrong');
  assert.ok(person.some((x) => /^keys\.B: moves, but its provenance names none of PEOPLE_KEYS\.B/.test(x)) && person.some((x) => /^keys\.A: .*not the shift/.test(x)), person.join('\n'));
});
