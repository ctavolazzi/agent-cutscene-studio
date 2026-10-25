// Checks for the design stage's layers (src/audio/layers/, the first pass, parked until Sound 4): every scheduled sound
// starts on its cue, the car is placed where the picture puts it, nothing sounds before or after its time, and the
// balance follows the brief in SOUND.md. Their regression test: it renders the 'design' stage explicitly, whatever the
// default stage is. The score's checks run only while the score is unparked (config.audio.parked, SOUND-PLAN 3.1); the
// other checks never depended on it. Each check has a planted fault. Run: node --test tests/sound-layers.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { atStage } from '../src/audio/index.js';
import { carTimes, LIGHTER, EMBER, EXHALE, FPS } from '../src/world.js';
import { footprintList } from '../src/fx/footprints.js';
import { placeAt } from '../src/audio/spatial.js';
import { carPoint, DOOR_EVENTS } from '../src/audio/layers/car.js';
import { footsteps, surfaceOf } from '../src/audio/layers/foley.js';
import { BELLS, CHORDS } from '../src/audio/layers/score.js';
import { balanceDb, firstSoundAfter, lastSoundBefore, integratedLufsOf, matchOnsets, onsets, rms, db, stem as stemAt, stemWith as stemWithAt } from '../scripts/lib/audio-analysis.mjs';

// the design stage, with the parking as configured
const DESIGN = atStage(CONFIG, { stage: 'design' });
const stem = (only) => stemAt(only, DESIGN);
const stemWith = (layer, opts) => stemWithAt(layer, opts, DESIGN);
const SCORE_PARKED = DESIGN.audio.parked.includes('score') && 'the score is parked (config.audio.parked, SOUND-PLAN 3.1): its checks run once it is unparked';

const FRAME = 1 / FPS;
// how many of the expected times have a detected onset within one frame
const onCue = (expected, detected) => matchOnsets(expected, detected).filter((m) => Math.abs(m.diff) <= FRAME).length;
const THREE_FRAMES = 3 / FPS;

test('car: the settle, every door, and the key land within a frame of their cues', () => {
  const s = stemWith('car', { keep: ['doorGain', 'keyGain', 'settleGain'] });
  const expected = [carTimes.stop, carTimes.stop + 0.38, ...DOOR_EVENTS.map((d) => d.t), carTimes.lightsOff0];
  const d = onsets(s.left, s.right, s.sr, { from: carTimes.stop - 0.5, to: carTimes.lightsOff1 });
  assert.equal(onCue(expected, d), expected.length, JSON.stringify(matchOnsets(expected, d)));
  // control: the same sounds three frames early are not on cue
  assert.equal(onCue(expected.map((t) => t - THREE_FRAMES), d), 0);
});

test('foley: every footstep lands within a frame of its print, for each person', () => {
  const prints = footprintList();
  const bySurface = {};
  for (const p of prints) bySurface[surfaceOf(p)] = (bySurface[surfaceOf(p)] ?? 0) + 1;
  assert.deepEqual([prints.length, bySurface], [64, { road: 17, walk: 33, deck: 14 }], 'the prints the cue sheet counts');
  assert.equal(footsteps().length, 63, "B's two boots at 33.31 make one heavier step");
  for (const id of ['A', 'B']) {
    const s = stemWith('foley', { keep: ['stepGain'], set: { stepsBy: id } });
    const expected = footsteps().filter((x) => x.id === id).map((x) => x.t);
    const d = onsets(s.left, s.right, s.sr, { from: 31, to: 62, minGap: 0.05 });
    assert.equal(onCue(expected, d), expected.length, `${id}: ${JSON.stringify(matchOnsets(expected, d).filter((m) => Math.abs(m.diff) > FRAME))}`);
    // control: three frames early, almost nothing is on cue (a stray match on a toe roll at most, 10 percent)
    assert.ok(onCue(expected.map((t) => t - THREE_FRAMES), d) <= expected.length * 0.1, id);
  }
});

test('foley: the lighter strikes on LIGHTER.t0', () => {
  const l = stemWith('foley', { keep: ['lighterGain'] });
  const dl = onsets(l.left, l.right, l.sr, { from: LIGHTER.t0 - 1, to: LIGHTER.t0 + 0.5 });
  assert.equal(onCue([LIGHTER.t0], dl), 1);
  assert.equal(onCue([LIGHTER.t0 - THREE_FRAMES], dl), 0, 'control');
});

test('score: every bell note on its time', { skip: SCORE_PARKED }, () => {
  const b = stemWith('score', { keep: ['bellGain'] });
  const times = BELLS.map((x) => x.t);
  const db_ = onsets(b.left, b.right, b.sr, { from: 60, to: 112, minGap: 0.3, ratioDb: 6 });
  assert.equal(onCue(times, db_), times.length);
  assert.equal(onCue(times.map((t) => t - THREE_FRAMES), db_), 0, 'control');
});

test('foley: the lean, each drag and the exhale sound in their windows, and not just before', () => {
  const rise = (s, t0, t1, quiet0, quiet1) => db(rms(s.left, s.right, s.sr, t0, t1)) - db(rms(s.left, s.right, s.sr, quiet0, quiet1));
  const r = stemWith('foley', { keep: ['rustleGain'] });
  assert.ok(rise(r, 62.9, 63.6, 62.2, 62.7) > 20, 'the lean');
  const d = stemWith('foley', { keep: ['dragGain'] });
  for (const t of EMBER.drags) assert.ok(rise(d, t + 0.2, t + 0.6, t - 0.6, t - 0.1) > 20, `drag at ${t}`);
  const e = stemWith('foley', { keep: ['breathGain'] });
  assert.ok(rise(e, EXHALE.t + 0.1, EXHALE.t + 1, EXHALE.t - 0.6, EXHALE.t - 0.1) > 20, 'the exhale');
  // control: a window where nothing is scheduled does not pass
  assert.ok(!(rise(d, 85, 85.4, 84, 84.5) > 20));
});

test('silence: no car before it appears, no engine after the run-down', () => {
  const car = stem('car');
  assert.ok(lastSoundBefore(car, carTimes.start) < 0, 'car before 14.0');
  assert.ok(firstSoundAfter(car, 0) >= carTimes.start - 0.001, 'the car starts at 14.0');
  const engine = stemWith('car', { keep: ['exhaustGain', 'intakeGain'] });
  assert.ok(firstSoundAfter(engine, carTimes.lightsOff0 + 0.5) === Infinity, 'engine after the run-down');
  // control: a single planted sample before 14.0 is found
  const bad = { ...car, left: Float32Array.from(car.left) };
  bad.left[Math.round((carTimes.start - 1) * car.sr)] = 1e-4; // -80 dBFS
  assert.ok(lastSoundBefore(bad, carTimes.start) > 0);
});

test('score: nothing before 40 s', { skip: SCORE_PARKED }, () => {
  const score = stem('score');
  assert.ok(firstSoundAfter(score, 0) >= CHORDS[0].t, 'score before 40 s');
  // control: a single planted sample before 40 s is found
  const bad = { ...score, left: Float32Array.from(score.left) };
  bad.left[Math.round(39 * score.sr)] = 1e-4; // -80 dBFS
  assert.ok(firstSoundAfter(bad, 0) < CHORDS[0].t);
});

test('placement: the engine sits in the stereo field where the picture puts it, window by window', () => {
  const s = stemWith('car', { keep: ['intakeGain'] });
  const rows = [];
  for (let t = carTimes.start; t < carTimes.lightsOff0; t += 0.25) {
    let p = 0;
    for (let k = 0; k < 5; k++) { const u = t + 0.05 * k + 0.025; p += placeAt(carPoint(u, 1.7, 0, 0.6), u).pan / 5; }
    const want = 20 * Math.log10(Math.tan((p + 1) * Math.PI / 4)); // constant-power pan, right over left
    rows.push({ t, want, got: balanceDb(s.left, s.right, s.sr, t, t + 0.25), swapped: balanceDb(s.right, s.left, s.sr, t, t + 0.25) });
  }
  assert.deepEqual(rows.filter((r) => Math.abs(r.got - r.want) > 0.5).map((r) => r.t), []);
  // the car is on the left of shot 5's frame at the front, on the right at the back: both appear in the data
  assert.ok(rows.some((r) => r.want < -3) && rows.some((r) => r.want > 3));
  // control: with left and right swapped, most windows that lean either way fail
  const leaning = rows.filter((r) => Math.abs(r.want) > 1);
  assert.ok(leaning.filter((r) => Math.abs(r.swapped - r.want) > 0.5).length > leaning.length * 0.9);
});

test('balance, as the brief has it: the car is the loud thing, the idle under the drive, the steps over the bed', () => {
  const amb = stem('ambience'), car = stem('car'), foley = stem('foley');
  assert.ok(integratedLufsOf(car, 15, 19) > integratedLufsOf(amb, 15, 19) + 6, 'the car over the bed as it drives');
  assert.ok(integratedLufsOf(car, 15, 19) > integratedLufsOf(car, 30, 33.5) + 6, 'the idle is quieter than the drive');
  assert.ok(integratedLufsOf(foley, 40, 52) > integratedLufsOf(amb, 40, 52) - 6, 'footsteps read over the bed');
  // control: the same comparison the other way round fails
  assert.ok(!(integratedLufsOf(amb, 15, 19) > integratedLufsOf(car, 15, 19) + 6));
});

test('balance, the score: it enters under the bed and opens at moonrise', { skip: SCORE_PARKED }, () => {
  const amb = stem('ambience'), score = stem('score');
  assert.ok(integratedLufsOf(score, 40, 43) < integratedLufsOf(amb, 40, 43) - 6, 'the score creeps in');
  assert.ok(integratedLufsOf(score, 70, 76) > integratedLufsOf(score, 46, 54) + 3, 'and opens at moonrise');
  // control: the same comparison the other way round fails
  assert.ok(!(integratedLufsOf(score, 46, 54) > integratedLufsOf(score, 70, 76) + 3));
});
