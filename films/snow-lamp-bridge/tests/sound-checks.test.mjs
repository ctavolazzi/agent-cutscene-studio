// The sound storyboard's 15 checks (scripts/lib/sound-checks.js, SOUND-PLAN 4.3) on the film's own input
// (scripts/sound-report.js): every check with the planted fault of 4.3's last column, which must fail it (or, for a
// reported check, be listed), and the real data passing, or failing with its findings listed here.
// The trace check's perturbation runs end to end, through the module hook, in tests/cues-trace.test.mjs.
// Run: node --test tests/sound-checks.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as SC from '../scripts/lib/sound-checks.js';
import { buildInput } from '../scripts/sound-report.js';
import { CUES } from '../src/audio/cues.js';
import { SHOTS, cameraAt, shotAt } from '../src/shots.js';
import { carAt, FPS, PEOPLE_KEYS } from '../src/world.js';
import { listenerAt, placeAt } from '../src/audio/spatial.js';
import { engineAt, carPoint, CAR_LAW } from '../src/audio/layers/car.js';
import { RUSTLES } from '../src/audio/layers/foley.js';

const REAL = buildInput();
const byId = new Map(CUES.map((c) => [c.id, c]));
const like = (id, patch) => Object.freeze({ ...byId.get(id), ...patch });
// a cue moved to start at t (its sync, onset and end together)
const moved = (id, t, patch = {}) => { const c = byId.get(id); return like(id, { sync: t + c.lead, t0: t, t1: t + (c.t1 - c.t0), ...patch }); };
const withCues = (extra, drop = []) => ({ ...REAL, cues: [...REAL.cues.filter((c) => !drop.includes(c.id)), ...extra] });
const shot = (n) => SHOTS.find((s) => s.n === n);
const ids = (check, pred = () => true) => check.rows.filter((x) => x.cue && pred(x)).map((x) => x.cue);
const real = {};
const run = (id) => (real[id] ??= SC[id](REAL));

// ---------- 1 trace ----------
const still = { sync: 0, t0: 0, t1: 0, place: 0, gone: false, other: [] };
function observe(cues, moves) {
  const o = { added: [] };
  for (const c of cues) o[c.id] = { ...still, ...(moves[c.id] ?? {}) };
  return o;
}
const DOORS = (tag) => ({ id: `doors.${tag}`, tokens: [`carTimes.doors.${tag}`, 'doorOpen'], shift: 0.5, reached: true });

test('1 trace: provenance on every cue; a literal time, a door reading the wrong door and today\'s RUSTLES are caught', () => {
  const t = run('trace');
  assert.equal(t.status, 'report', 'no perturbation here: the static part only');
  assert.deepEqual(t.rows.filter((x) => x.problem), []);
  // static faults
  assert.equal(SC.trace(withCues([like('hard.tick.car.02', { id: 'planted.bare', derivedFrom: null, rule: null })])).status, 'fail', 'control: no provenance');
  assert.equal(SC.trace(withCues([like('hard.tick.car.02', { id: 'planted.designed', designed: ['level', 'loudness'] })])).status, 'fail', 'control: a designed field it does not have');
  // the perturbation's logic, on observations shaped as perturb.mjs makes them: the driver's door cues shift with the
  // driver's door; a planted latch reads the passenger's door while its provenance names the driver's; a literal time
  // and the four RUSTLES never move
  const wrong = like('hard.door.driver.latch', { id: 'planted.door.driver.wrong' });
  const literal = like('foley.moves.A.lean', { id: 'planted.literal', sync: 62.75, t0: 62.75, rule: null });
  const rustles = RUSTLES.map((x, i) => like('foley.moves.A.lean', { id: `planted.rustle.${i + 1}`, person: x.id, sync: x.t, t0: x.t, t1: x.t + x.dur, rule: null, derivedFrom: `PEOPLE_KEYS.${x.id} (the lean, the lee turns); poser root + CLOTH.up` }));
  const cues = [...CUES, wrong, literal, ...rustles];
  const driver = Object.fromEntries(CUES.filter((c) => c.family === 'door' && c.meta.door === 'driver').map((c) => [c.id, { sync: 0.5, t0: 0.5, t1: 0.5 }]));
  const passenger = Object.fromEntries(CUES.filter((c) => (c.family === 'door' && c.meta.door === 'passenger')).map((c) => [c.id, { sync: 0.5, t0: 0.5, t1: 0.5 }]));
  const traceOf = (extra = {}) => ({ perturbations: [DOORS('driver'), DOORS('passenger')], observed: { 'doors.driver': observe(cues, driver), 'doors.passenger': observe(cues, { ...passenger, [wrong.id]: { sync: 0.5, t0: 0.5, t1: 0.5 } }) }, ...extra });
  const r = SC.trace({ ...REAL, cues, trace: traceOf() });
  assert.equal(r.status, 'fail');
  const bad = [...new Set(ids(r, (x) => x.problem))].sort();
  // everything else in the catalogue that never moved under the two door perturbations is listed too; the planted
  // ones must be among the problems, with the reasons 4.3 names
  assert.ok(r.rows.some((x) => x.cue === wrong.id && x.perturbation === 'doors.passenger' && /names none/.test(x.problem)), 'control: the wrong door');
  assert.ok(r.rows.some((x) => x.cue === literal.id && /never moves/.test(x.problem)), 'control: a literal time');
  for (const x of rustles) assert.ok(bad.includes(x.id), `control: ${x.id}, today's RUSTLES`);
  // with the declared table the wrong door is caught from its own side too: still under the driver's door
  const expect = (c, pid) => (c.family === 'door' && pid === `doors.${c.meta.door}` ? { kind: 'shift', fields: ['sync', 't0', 't1'] } : { kind: 'still' });
  const e = SC.trace({ ...REAL, cues, trace: traceOf({ expect }) });
  assert.ok(e.rows.some((x) => x.cue === wrong.id && x.perturbation === 'doors.driver' && /not the shift/.test(x.problem)), 'control: the declared table');
  // an inexact shift, and a perturbation the hook did not reach
  const off = SC.trace({ ...REAL, cues: CUES, trace: { perturbations: [DOORS('driver')], observed: { 'doors.driver': observe(CUES, { ...driver, 'hard.door.driver.latch': { sync: 0.5 + 1e-6, t0: 0.5 + 1e-6, t1: 0.5 } }) }, expect } });
  assert.ok(off.rows.some((x) => x.cue === 'hard.door.driver.latch' && /not the shift/.test(x.problem)), 'control: a shift 1 us off');
  const unreached = SC.trace({ ...REAL, cues: CUES, trace: { perturbations: [{ ...DOORS('driver'), reached: false, note: 'the probe did not move' }], observed: { 'doors.driver': { added: [] } } } });
  assert.equal(unreached.status, 'fail', 'control: an unreached perturbation');
});

// ---------- 2 onScreen ----------
test('2 onScreen: on, hidden by a named blocker, off with its side, behind; a point behind the camera and one behind SE', () => {
  const o = run('onScreen'), row = (id) => o.rows.find((x) => x.cue === id);
  assert.equal(o.status, 'report');
  for (const x of o.rows) assert.ok(['on', 'hidden', 'off', 'behind'].includes(x.state) && x.frames === x.on + x.hidden + x.off + x.behind, x.cue);
  // the findings SOUND-PLAN 2.3 names, measured here: the engine heard behind the south-east building, the driver's
  // unlatch off the top of the frame, B's steps off right while A crosses, the deck steps below the frame in shot 9,
  // ticks behind the camera there, the belts inside the car
  assert.deepEqual([row('hard.engine.car.intake').state, row('hard.engine.car.intake').blocker], ['hidden', 'building SE']);
  assert.deepEqual([row('hard.door.driver.unlatch').state, row('hard.door.driver.unlatch').side], ['off', 'top']);
  assert.deepEqual(['foley.feet.B.04', 'foley.feet.B.07'].map((id) => row(id).side), ['right', 'right']);
  assert.ok(o.rows.filter((x) => x.shot === 9 && x.cue.startsWith('foley.feet')).every((x) => x.state === 'off' && x.side === 'bottom'));
  assert.deepEqual(['hard.tick.car.09', 'hard.tick.car.10'].map((id) => row(id).state), ['behind', 'behind']);
  assert.ok(['hard.cabin.A.belt', 'hard.cabin.B.belt'].every((id) => row(id).blocker === 'car body'));
  // the passenger door, on the car's far side from shot 5's camera, is behind the body (its points sit 2 cm outside the
  // body's side); the driver's, on the near side, is not; the car's points inside its body (the engine bay, the
  // springs, the brake at the axle) are not hidden by it, by convention
  const passenger = CUES.filter((c) => c.family === 'door' && c.meta.door === 'passenger').map((c) => c.id);
  assert.deepEqual(passenger.map((id) => [row(id).state, row(id).blocker]), passenger.map(() => ['hidden', 'car body']));
  assert.deepEqual(['hard.door.driver.swing-shut', 'hard.door.driver.latch'].map((id) => row(id).state), ['on', 'on']);
  assert.ok(['hard.settle.car.dip', 'hard.stop.car.rundown', 'hard.brake.car.pads1', 'hard.tick.car.03'].every((id) => row(id).state === 'on'));
  // control: the passenger hinge from shot 5's camera at 32.0 is hidden by the car body; with the car's own sounds
  // exempt from its boxes (the first run's blockers) it read on
  const hinge = byId.get('hard.door.passenger.swing-open'), p32 = hinge.place(32);
  assert.deepEqual([SC.screenState(REAL, hinge, p32, 32).state, SC.screenState(REAL, hinge, p32, 32).blocker], ['hidden', 'car body'], 'control: the far hinge');
  const exempt = { ...REAL, blockers: (c, t) => REAL.blockers(c, t).filter((b) => !b.own) };
  assert.equal(SC.screenState(exempt, hinge, p32, 32).state, 'on', 'control: the first run\'s exemption');
  // controls: a point 2 m behind shot 3's camera at 15.0, a step-like cue where the car is at 15.0 (behind SE), and a
  // point far off the frame's left edge
  const L = listenerAt(15), car = carAt(15), cam = cameraAt(shotAt(15), 15);
  const step = byId.get('foley.feet.A.05');
  const st = (p) => SC.screenState(REAL, step, p, 15);
  assert.equal(st(L.pos.map((v, j) => v - 2 * L.f[j])).state, 'behind', 'control: behind the camera');
  assert.deepEqual([st([car.x, 0.5, car.z]).state, st([car.x, 0.5, car.z]).blocker], ['hidden', 'building SE'], 'control: behind the south-east building');
  assert.deepEqual([st(L.pos.map((v, j) => v + 10 * L.f[j] - 30 * L.r[j])).state, st(L.pos.map((v, j) => v + 10 * L.f[j] - 30 * L.r[j])).side], ['off', 'left'], 'control: off the left edge');
  assert.ok(cam.pos.every((v, j) => v === L.pos[j]), 'the listener is the camera');
});

// ---------- 3 storyOrder ----------
test('3 storyOrder: light before the car and anticipation before the moon hold; feet before the people fails on B\'s off-screen steps', () => {
  const s = run('storyOrder');
  assert.equal(s.status, 'fail');
  // finding: the four steps B takes round the car, off screen right in shot 5 (kept on purpose, SOUND-PLAN 3.7), break
  // "through shot 5 the boots are heard on feet in frame"; the bodies are first seen at shot 6's start
  // (the three scuffs before the bodies are seen, A's first and B's first two, are on screen)
  assert.deepEqual(ids(s), ['foley.feet.B.04', 'foley.feet.B.05', 'foley.feet.B.06', 'foley.feet.B.07']);
  assert.ok(s.rows.filter((x) => x.cue).every((x) => /^Feet before/.test(x.order) && x.detail === 'off (right)'));
  const early = CUES.filter((c) => c.enabled && c.family === 'scuff' && c.t0 < REAL.orders[1].t1).map((c) => c.id);
  assert.deepEqual(early, ['foley.scuff.A.1', 'foley.scuff.B.1', 'foley.scuff.B.2']);
  assert.ok(early.every((id) => !ids(s).includes(id)));
  assert.equal(REAL.orders[1].t1, shot(6).start, 'the first frame showing a head is shot 6\'s first');
  // control: an engine onset planted at 13.5
  const engine = moved('hard.engine.car.intake', 13.5, { id: 'hard.engine.car.early' });
  assert.ok(ids(SC.storyOrder(withCues([engine]))).includes(engine.id), 'control: an engine onset at 13.5');
  // control: a scuff (boots too) planted where B's fourth step lands, off screen right in shot 5
  const b4 = byId.get('foley.feet.B.04'), scuff = moved('foley.scuff.B.1', b4.t0, { id: 'planted.scuff', place: b4.place });
  const s2 = SC.storyOrder(withCues([scuff]));
  assert.ok(s2.rows.some((x) => x.cue === scuff.id && x.detail === 'off (right)'), 'control: an off-screen scuff');
  // and the definition is the input's: renamed orders print their own names, nothing of this film's
  const named = SC.storyOrder({ ...REAL, orders: [{ name: 'A planted order', kind: 'noOnset', t0: 0, t1: 0, select: () => false }] });
  assert.ok(named.definition.includes('A planted order') && !/moon|car|feet/.test(named.definition), named.definition);
});

// ---------- 4 sync ----------
test('4 sync: onsets 0 to 45 ms ahead of their first showing frame; the scuffs and six moves miss it; one frame late and 60 ms early fail', () => {
  const s = run('sync');
  assert.equal(s.status, 'fail');
  // findings: the scuff rule (a designed ankle speed, cues.js SCUFF) against the frame that first draws the planted
  // ankle on another pixel: from 110 ms late (B's first) to 43 ms too early (B's last); A's first has no visible start,
  // its slide carries straight on from the walk. And six moves made from a key, whose sound starts at the key while the
  // first frame drawing the person moving comes later as the move eases in: the lean 83 ms (both), A's turn out of the
  // lee 83 ms, A's shift closer 133 ms and B's 50 ms, and B's turn behind the car in shot 5, 125 ms (only B's ankles in
  // view). Every other judged cue meets the bar.
  const MOVES = ['foley.moves.A.lean', 'foley.moves.A.shift1', 'foley.moves.A.turn4', 'foley.moves.B.lean', 'foley.moves.B.shift1', 'foley.moves.B.turn2'];
  assert.deepEqual(ids(s, (x) => x.ok === false).sort(), [...MOVES, 'foley.scuff.A.1', 'foley.scuff.A.2', 'foley.scuff.A.4', 'foley.scuff.B.1', 'foley.scuff.B.2', 'foley.scuff.B.3']);
  const row = (id) => s.rows.find((x) => x.cue === id);
  assert.deepEqual(MOVES.map((id) => row(id).aheadMs), [83.33, 133.33, 83.33, 83.33, 50, 125]);
  // the moves whose person is out of view at the key are not judged: getting out inside the car, B behind it
  assert.deepEqual(ids(s, (x) => x.ok === null && /start is not shown/.test(x.note)), ['hard.unload.A.slide', 'hard.unload.B.slide', 'foley.moves.B.walk2']);
  assert.deepEqual([row('foley.scuff.A.1').frame, row('foley.scuff.A.1').aheadMs], [null, null], 'no frame, no lead measured');
  // control: a key-made move judged by the key alone (the first run's rule) could not fail: A's turn out of the lee
  // met it at 0 ms
  const turn4 = byId.get('foley.moves.A.turn4');
  const keyRule = { event: 'the key', state: (t) => PEOPLE_KEYS.A.filter((k) => k.t <= t).length, change: 'any' };
  assert.equal(SC.sync({ ...REAL, cues: [turn4], sync: { rule: () => keyRule } }).rows[0].ok, true, 'control: the key rule passes it');
  // control: A's walk onto the bridge planted 100 ms late, after the first frame drawing A walking
  const walk = byId.get('foley.moves.A.walk3'), late100 = like(walk.id, { id: 'foley.moves.A.late', t0: walk.t0 + 0.1 });
  assert.match(SC.sync({ ...REAL, cues: [late100] }).rows[0].note ?? '', /after its frame/, 'control: a move 100 ms late');
  assert.ok(Math.abs(row('foley.moves.A.cup').aheadMs - 14.06) < 0.01, 'the cup leads its frame by 14.1 ms, as cues.js says');
  assert.ok(row('foley.lighter.A.strike').ok && row('foley.lighter.A.strike').leadMs > 0, 'the strike leads the flame by its named lead');
  assert.ok(s.rows.filter((x) => x.ok === null).every((x) => /^not judged/.test(x.note)));
  // controls: the driver's latch one frame late, a step 60 ms early
  const late = like('hard.door.driver.latch', { id: 'hard.door.driver.late', sync: byId.get('hard.door.driver.latch').sync + 1 / FPS, t0: byId.get('hard.door.driver.latch').t0 + 1 / FPS });
  const early = like('foley.feet.A.10', { id: 'foley.feet.A.early', t0: byId.get('foley.feet.A.10').t0 - 0.06 });
  const p = SC.sync({ ...REAL, cues: [late, early] });
  assert.deepEqual(p.rows.map((x) => [x.cue, x.ok]), [[late.id, false], [early.id, false]]);
  assert.ok(/after its frame/.test(p.rows[0].note) && /too early/.test(p.rows[1].note));
});

// ---------- 5 stereoOrder ----------
test('5 stereoOrder: A pans left of B whenever both sound in shots 9 to 15; swapped, it fails', () => {
  const s = run('stereoOrder');
  assert.equal(s.status, 'pass');
  assert.deepEqual(s.rows.filter((x) => x.bothFrames).map((x) => x.shot), [9, 13], 'both sound in the lean (9) and the shoulders closing in (13)');
  // the margins SOUND-PLAN 4.3 quotes, measured on every frame: 0.04 (shot 14) to 0.27 (shot 11)
  assert.deepEqual([Math.min(...s.rows.map((x) => x.margin)), Math.max(...s.rows.map((x) => x.margin))], [0.041, 0.267]);
  assert.equal(SC.stereoOrder({ ...REAL, stereo: { ...REAL.stereo, left: 'B', right: 'A' } }).status, 'fail', 'control: A and B swapped');
  // control: who sounds is read from the cues passed in: a B cue planted at 97.0 to 97.8 in shot 14, where the margin
  // is 0.04, makes both sound there, under the 0.1 separation
  const b = like('foley.moves.B.shift1', { id: 'planted.B', sync: 97, t0: 97, t1: 97.8 });
  const r14 = SC.stereoOrder(withCues([b])).rows.find((x) => x.shot === 14);
  assert.deepEqual([r14.bothFrames > 0, r14.marginBoth, r14.verdict], [true, 0.041, 'not separated'], 'control: a planted B cue');
  assert.ok(SC.stereoOrder({ ...REAL, stereo: { ...REAL.stereo, pointLabel: 'the planted points' } }).definition.endsWith('at the planted points'), 'the point label is the input\'s');
});

// ---------- 6 cutPerspective ----------
test('6 cutPerspective: places steady inside a place, the hum held under 3 dB and applied over, everything else following the camera with its jumps listed; a +12 dB bed and an unheld hum fail', () => {
  const c = run('cutPerspective'), hum = (cut) => c.rows.find((x) => x.cue === 'bg.hum.lamp.bed' && x.cut === cut);
  assert.equal(c.status, 'pass');
  // SOUND-PLAN 3.6: the hum's -21.5 and +18.3 dB jumps apply (into shots 2 and 4), its 1 to 3 dB wobbles are held
  assert.deepEqual([hum(7).dDb, hum(7).verdict, hum(22).dDb, hum(22).held], [-21.53, 'applied', 18.34, false]);
  assert.ok([40, 46, 89, 96, 100].every((t) => hum(t).held && hum(t).dRendered === 0), 'the small changes held');
  assert.ok(c.rows.filter((x) => x.kind === 'location').every((x) => x.verdict === 'steady' || x.verdict === 'place change'));
  // the steady sources are the caller's (the hum and the idle; the idle starts on the cut into shot 5, so crosses none);
  // with no renderer passed the definition says those verdicts pass by construction
  assert.deepEqual([...new Set(c.rows.filter((x) => x.kind === 'steady').map((x) => x.cue))], ['bg.hum.lamp.bed']);
  assert.match(c.definition, /pass by construction until it is passed/);
  // the moving car at 22 and the walking cloth follow the camera like the steps: at 40 A's cloth -2.02 dB beside A's
  // step -2.13 dB, one walker in one perspective
  assert.deepEqual(c.rows.filter((x) => x.kind === 'moving').map((x) => `${x.cut} ${x.cue}`).slice(0, 6), ['22 hard.engine.car.exhaust', '22 hard.engine.car.intake', '22 hard.tyres.car.front', '22 hard.tyres.car.rear', '22 hard.brake.car.pads2', '40 foley.moves.A.walk2']);
  assert.ok(c.rows.filter((x) => x.kind === 'moving').every((x) => x.held === null && x.verdict !== 'held'));
  // the step jumps SOUND-PLAN 3.6 keeps: no step straddles 54 or 60, but both walks carry on across them, -7 to -9 dB
  // into shot 8 and +7 to +10 dB into shot 9 under the camera model; the characters model holds every one at 0
  const walk = (cut) => c.rows.filter((x) => x.cut === cut && x.kind === 'one-shot stream' && x.cue.startsWith('foley.feet')).map((x) => [x.cue.split('.')[2], x.dDb, x.verdict]);
  assert.deepEqual(walk(54), [['A', -7.27, 'jump'], ['B', -8.54, 'jump']]);
  assert.deepEqual(walk(60), [['A', 7.17, 'jump'], ['B', 10.02, 'jump']]);
  // the ticks, a second apart and growing to five, carry on across the four walking cuts by their own rhythm (gap
  // ratios 1.44, 1.63, 1.04 and 1.42), -6.05 dB at 54 (SOUND-PLAN A.1's car column)
  const ticks = c.rows.filter((x) => x.cue.startsWith('hard.tick'));
  assert.deepEqual(ticks.map((x) => [x.cut, x.gapRatio, x.dDb, x.verdict]), [[40, 1.44, -3.62, 'follows the camera'], [46, 1.63, 4.52, 'follows the camera'], [54, 1.04, -6.05, 'jump'], [60, 1.42, 2.48, 'follows the camera']]);
  // the characters model holds every follower at 0 once the people are there; at 22, before anyone is, it is the camera's
  const followers = c.rows.filter((x) => x.kind !== 'location' && x.kind !== 'steady');
  assert.ok(followers.every((x) => (x.cut === 22 ? x.dDb_characters === x.dDb : x.dDb_characters === 0)));
  // B stops before 40 and walks on after 44.5: a gap of 20.8 times its last, no stream
  assert.ok(!c.rows.some((x) => x.cut === 40 && x.cue.startsWith('foley.feet.B')));
  // control: a sparse one-shot source, 3 s apart across the cut into shot 13, is a stream; the first run's one-second
  // window missed it
  const sparse = [83.5, 86.5, 89.5, 92.5].map((t, i) => moved('hard.tick.car.03', t, { id: `planted.sparse.${i + 1}`, source: 'planted:sparse' }));
  assert.ok(SC.cutPerspective(withCues(sparse)).rows.some((x) => x.cut === 89 && x.cue === 'planted.sparse.2' && x.gapRatio === 1), 'control: a sparse stream');
  // control: a ratio under any stream's sees none, only the step that rings across 40
  const short = SC.cutPerspective({ ...REAL, thresholds: { ...REAL.thresholds, cutStream: { ...REAL.thresholds.cutStream, v: 0.5 } } });
  assert.deepEqual(short.rows.filter((x) => x.kind.startsWith('one-shot')).map((x) => x.cue), ['foley.feet.A.14'], 'control: no stream under 0.5');
  // control: every continuous source declared steady (the first run's reading) holds A's walking cloth at 40
  const all = SC.cutPerspective({ ...REAL, steady: { select: () => true, label: 'every continuous source' } });
  assert.ok(all.rows.some((x) => x.cut === 40 && x.cue === 'foley.moves.A.walk2' && x.held), 'control: the cloth held as steady');
  // controls: +12 dB on the street's wind after the cut into shot 4, inside the street; the hum rendered raw
  const loud = { ...REAL, hear: (q, t, m) => { const h = REAL.hear(q, t, m); return q.id === 'bg.wind.street.bed' && t >= shot(4).start ? { ...h, db: h.db + 12 } : h; } };
  assert.ok(SC.cutPerspective(loud).rows.some((x) => x.cue === 'bg.wind.street.bed' && x.verdict === 'changed inside a place'), 'control: +12 dB on a bed inside a place');
  const raw = { ...REAL, rendered: (q) => (t) => REAL.hear(q, t, 'camera') };
  const leaks = SC.cutPerspective(raw);
  assert.equal(leaks.status, 'fail');
  assert.ok(leaks.rows.some((x) => x.cue === 'bg.hum.lamp.bed' && x.cut === 46 && x.verdict === 'leaks under the hold threshold'), 'control: a 1.3 dB hum change not held');
});

// ---------- 7 approachRises ----------
// Today's first-pass schedule, read-only from the parked layers/car.js: engineAt's per-segment load times its engine
// gain (0.03 + 1.75 load, as its process() has it) at its intake point (carPoint 1.7 m ahead, 0.6 m up), CAR_LAW.
const firstPass = (t) => { const e = engineAt(t); return e.on ? 20 * Math.log10((0.03 + 1.75 * e.load) * placeAt(carPoint(t, 1.7, 0, 0.6), t, listenerAt(t), CAR_LAW).gain) : null; };

test('7 approachRises: the car never falls more than 1 dB under its peak while it comes on; today\'s load schedule does', () => {
  const a = run('approachRises');
  assert.equal(a.status, 'pass');
  assert.deepEqual(a.rows.map((x) => x.worstFall), [0, 0]);
  // the rebuilt first pass reproduces SOUND-PLAN 3.10's table, and fails
  assert.deepEqual([19, 20, 21, 22, 28].map((t) => Math.round(firstPass(t) * 10) / 10), [-10.4, -25, -14.5, -23.5, -18.4]);
  const bad = SC.approachRises({ ...REAL, approach: [{ ...REAL.approach[0], level: firstPass }] });
  assert.equal(bad.status, 'fail', 'control: today\'s load schedule');
  assert.ok(bad.rows.some((x) => x.worstFall > 10), `the braking drop: ${bad.rows.map((x) => x.worstFall)}`);
});

// ---------- 8 maskingPairs ----------
test('8 maskingPairs: two equal cues from different sources 10 ms apart are listed', () => {
  const m = run('maskingPairs');
  assert.equal(m.status, 'report');
  assert.ok(m.rows.every((x) => x.dtMs >= -200 - 1e-9 && x.dtMs <= 20 + 1e-9 && x.margin <= 6));
  // the near coincidences SOUND-PLAN A.2 names: A and B 3.8 ms apart at 56.34, the driver's latch and B's step at 34.5
  assert.ok(m.rows.some((x) => x.cue === 'foley.feet.A.29' && x.by === 'foley.feet.B.21') || m.rows.some((x) => x.cue === 'foley.feet.B.21' && x.by === 'foley.feet.A.29'));
  // control: two copies of a tick in shot 12's quiet, from two sources, 10 ms apart
  const a = moved('hard.tick.car.03', 86, { id: 'planted.a', source: 'planted:a' }), b = moved('hard.tick.car.03', 86.01, { id: 'planted.b', source: 'planted:b' });
  assert.ok(SC.maskingPairs(withCues([a, b])).rows.some((x) => x.cue === a.id && x.by === b.id), 'control: two equal cues 10 ms apart');
});

// ---------- 9 maskingBed ----------
test('9 maskingBed: each one-shot against the steady sound under it; a step under a loud steady noise is at risk', () => {
  const m = run('maskingBed'), row = (id) => m.rows.find((x) => x.cue === id);
  assert.equal(m.status, 'report');
  // findings: the door swings under the idle beside the camera in shot 5, the far deck steps under the bridge's wind
  assert.ok(['hard.door.driver.swing-open', 'hard.door.passenger.stop'].every((id) => row(id).atRisk && row(id).loudest === 'hard.engine.car.intake-idle'));
  assert.ok(['foley.feet.A.26', 'foley.feet.A.29'].every((id) => row(id).atRisk && row(id).loudest === 'bg.wind.bridge.bed'));
  // control: a step in shot 12 under a 30 dB steady bed of its own
  const step = moved('foley.feet.A.30', 86, { id: 'planted.step' });
  const noise = like('bg.city.bridge.bed', { id: 'planted.noise', source: 'planted:noise', level: 30 });
  const ok = SC.maskingBed(withCues([step])).rows.find((x) => x.cue === step.id), bad = SC.maskingBed(withCues([step, noise])).rows.find((x) => x.cue === step.id);
  assert.ok(!ok.atRisk && bad.atRisk && bad.loudest === noise.id, `control: ${ok.margin} dB alone, ${bad.margin} dB under the noise`);
});

// ---------- 10 flams ----------
test('10 flams: one person\'s contacts at least 30 ms apart; two prints 10 ms apart fail', () => {
  const f = run('flams');
  assert.equal(f.status, 'pass');
  const s = byId.get('foley.feet.A.05');
  assert.equal(SC.flams(withCues([like(s.id, { id: 'foley.feet.A.flam', sync: s.sync + 0.01, t0: s.t0 + 0.01 })])).status, 'fail', 'control: two prints 10 ms apart');
});

// ---------- 11 density ----------
test('11 density: more than 3 foreground streams fails; the car\'s four parts at its first light and shot 5\'s pile-up do', () => {
  const d = run('density');
  assert.equal(d.status, 'fail');
  // findings: at 14.0 the car's four voice groups start together (one body, four streams by the definition); in shot 5
  // the doors, the getting out, the cloth and the scuffs pile up (6 streams at 33.6 to 35.2, three bodies at most); the
  // lean's two forearm rests with both coats (63.45); the shoulders closing in (94.5)
  const fails = d.rows.filter((x) => x.fails);
  assert.deepEqual([...new Set(fails.map((x) => x.shot))], [3, 5, 9, 13]);
  assert.equal(Math.max(...d.rows.map((x) => x.peak)), 6);
  assert.ok(d.rows.every((x) => x.bodies <= 3));
  // control: four groups planted in shot 12's quiet
  const four = [0, 1, 2, 3].map((i) => moved('hard.tick.car.03', 86, { id: `planted.${i}`, source: `planted:${i}` }));
  assert.ok(SC.density(withCues(four)).rows.some((x) => x.shot === 12 && x.fails && x.peak === 4), 'control: four groups at one moment');
});

// ---------- 12 voices ----------
test('12 voices: at most 24 and nothing stolen, dropped or cut; 30 steps at once and a retrigger fail', () => {
  const v = run('voices');
  assert.equal(v.status, 'pass');
  assert.equal(v.rows.find((x) => x.kind === 'peak').voices, 12, 'the peak SOUND-PLAN A.5 measured');
  const steps = Array.from({ length: 30 }, (_, i) => moved('foley.feet.A.30', 86, { id: `planted.${i}`, source: `planted:${i}` }));
  const many = SC.voices(withCues(steps));
  assert.equal(many.status, 'fail', 'control: 30 simultaneous steps');
  assert.ok(many.rows.find((x) => x.kind === 'demand').voices > 24 && many.rows.some((x) => x.kind === 'steal' || x.kind === 'drop'));
  const s = byId.get('foley.feet.A.30'), again = like(s.id, { id: 'foley.feet.A.again', sync: s.sync + 0.1, t0: s.t0 + 0.1, t1: s.t1 + 0.1 });
  assert.ok(SC.voices(withCues([again])).rows.some((x) => x.kind === 'cut'), 'control: a retrigger cutting its own tail');
});

// ---------- 13 silence ----------
test('13 silence: no onset in the four bed-only windows; one planted in shot 12 fails', () => {
  const s = run('silence');
  assert.equal(s.status, 'pass');
  assert.deepEqual(REAL.silence.windows.map((w) => [w.t0, w.t1]), [[shot(1).start, shot(2).end], [shot(10).start, shot(10).end], [shot(12).start, shot(12).end], [shot(15).start, shot(15).end]]);
  assert.equal(SC.silence(withCues([moved('hard.tick.car.03', 86, { id: 'planted.tick' })])).status, 'fail', 'control: a cue in shot 12');
});

// ---------- 14 safeBand ----------
test('14 safeBand: the story cues\' declared bands are in a phone\'s; a 60 Hz-only cue and an anti-phase one are flagged', () => {
  const s = run('safeBand');
  assert.equal(s.status, 'report', 'declared by family: nothing to measure before Sound 2');
  assert.deepEqual(s.rows.filter((x) => x.flag), []);
  assert.deepEqual(s.rows.map((x) => x.cue).sort(), CUES.filter((c) => c.enabled && c.sdh).map((c) => c.id).sort());
  const low = like('hard.door.driver.latch', { id: 'planted.low', family: 'planted-low' }), side = like('hard.door.driver.latch', { id: 'planted.side', family: 'planted-side' });
  const bands = { 'planted-low': { lo: 40, hi: 80, side: false, from: 'planted' }, 'planted-side': { lo: 300, hi: 8000, side: true, from: 'planted' } };
  const p = SC.safeBand({ ...withCues([low, side]), safeBand: { ...REAL.safeBand, band: (c) => bands[c.family] ?? REAL.safeBand.band(c) } });
  assert.equal(p.status, 'fail');
  assert.deepEqual(p.rows.filter((x) => x.flag).map((x) => [x.cue, x.flag]), [[low.id, 'only below 250 Hz'], [side.id, 'only in the side channel']]);
});

// ---------- 15 straddle ----------
test('15 straddle: one-shots across a cut are listed; one planted across 54.000 is', () => {
  const s = run('straddle');
  assert.equal(s.status, 'report');
  assert.deepEqual(ids(s), ['foley.feet.A.14'], 'A\'s step that rings across the cut into shot 6');
  const across = moved('foley.feet.A.30', shot(8).start - 0.1, { id: 'planted.across' });
  assert.ok(ids(SC.straddle(withCues([across]))).includes(across.id), 'control: a one-shot across the place change');
});

// ---------- the report ----------
// what report.json promises: the 15 checks in order, each with its fields, rows keyed by exactly their columns, plain
// values only, and every cue a row names a cue that exists
function reportProblems(r) {
  const p = [];
  if (JSON.stringify(r.checks.map((c) => [c.n, c.id])) !== JSON.stringify(['trace', 'onScreen', 'storyOrder', 'sync', 'stereoOrder', 'cutPerspective', 'approachRises', 'maskingPairs', 'maskingBed', 'flams', 'density', 'voices', 'silence', 'safeBand', 'straddle'].map((id, i) => [i + 1, id]))) p.push('the checks are not the 15 in order');
  for (const c of r.checks) if (!['pass', 'fail', 'report'].includes(c.status) || typeof c.starting !== 'boolean' || !c.summary || !c.definition || !c.bar || !c.name) p.push(`${c.id}: its fields`);
  if (JSON.stringify(Object.keys(r.tables)) !== JSON.stringify(['onScreen', 'perShot'])) p.push('the tables');
  for (const [name, c] of [...r.checks.map((x) => [x.id, x]), ...Object.entries(r.tables)]) for (const x of c.rows) {
    if (JSON.stringify(Object.keys(x)) !== JSON.stringify(c.columns)) p.push(`${name}: a row not keyed by its columns`);
    for (const v of Object.values(x)) if (!(v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)))) p.push(`${name}: a value ${JSON.stringify(v)}`);
    if (x.cue !== undefined && x.cue !== null && !byId.has(x.cue)) p.push(`${name}: ${x.cue} is not a cue`);
  }
  return p;
}

test('runSoundChecks: the 15 checks in order, rows of plain values keyed by column, cue ids that exist, the same twice', () => {
  const r = SC.runSoundChecks(REAL), again = SC.runSoundChecks(buildInput());
  assert.deepEqual(reportProblems(r), []);
  assert.deepEqual([r.cues, r.enabled], [CUES.length, CUES.filter((c) => c.enabled).length]);
  assert.equal(r.tables.perShot.rows.length, SHOTS.length);
  assert.equal(JSON.stringify(again), JSON.stringify(r), 'a second input gives the same report');
  // controls: a row naming a cue that does not exist, a value that is an object
  const bad = structuredClone(r);
  bad.checks[1].rows[0].cue = 'foley.feet.Z.01';
  bad.checks[3].rows[0].note = { not: 'plain' };
  assert.equal(reportProblems(bad).length, 2);
});
