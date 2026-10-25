// Checks for Sound 2.12's option switches (config.audio.options, read by layers/blockout/voices.js and spatial.js) and
// the tools that measure them (scripts/lib/sound-options-lib.js): every switch off renders today's samples, with or
// without an occlusion handed in, and the design stage reads none of them; each switch on moves exactly the cues it
// names, cue by cue and in the whole mix before the master; the muffle drops what it says or swaps to its lowpass; the
// narrower pan is the camera's pan times its width; the characters' level listener is the storyboard's own; the
// hidden state is Sound 1's; the options script's master is scripts/sound.js's, and its joint master keeps B over A
// the option alone; the style-frame candidates are the ones their rules pick. Each check has a planted fault shown
// to fail. Run: node --test tests/sound-options.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { CONFIG } from '../src/config.js';
import { CUES, DESIGN, LAWS, WORLD } from '../src/audio/cues.js';
import { atStage, makeContext, renderSoundtrack } from '../src/audio/index.js';
import { normalize } from '../src/audio/loudness.js';
import { placeAt } from '../src/audio/spatial.js';
import { mulberry32 } from '../src/prng.js';
import { predictedBalanceDb } from '../scripts/lib/audio-analysis.mjs';
import { buildInput } from '../scripts/sound-report.js';
import {
  SWITCHES, allOff, balanceOf, candidateScenes, compareCues, firstPoint, hiddenSpans, levelDb, levelGainChange, loudestDb, masterOf,
  movedAgainstNamed, muffleRow, namedListener, namedMuffle, namedSyncPan, occlusionFrom, preMasterWith, renderCue, strayDifferences, withOptions,
} from '../scripts/lib/sound-options-lib.js';

const BASE = allOff(atStage(CONFIG, { stage: 'blockout' }));
const SR = BASE.audio.sr;
const input = buildInput(), FPS = input.fps;
const { occlusion, hidden } = occlusionFrom(input);
const byId = new Map(CUES.map((c) => [c.id, c])), cue = (id) => byId.get(id);
const ctxA = makeContext(BASE), cacheA = new Map();
const hash = (x) => createHash('sha256').update(Buffer.from(x.left.buffer)).update(Buffer.from(x.right.buffer)).digest('hex');
let preA = null;
const pre = () => (preA ??= preMasterWith(BASE));

// ---------- bars, each the plan's number or set from a measurement ----------
// A volume drop on a cue the picture hides on every frame it covers: its level over its span drops by dropDb. Measured
// within 2e-8 dB on the 12 such cues (float32 rounding); the bar is a starting value with room over it
const DROP_TOL_DB = 1e-4;
// The swap's two 2-pole sections at 900 Hz against the cabin's 5.9 kHz clicks: measured 56.7 to 58.8 dB off; the bar
// is a starting value under that
const SWAP_CABIN_DB = -50;
// ROADMAP Sound 2.6: a cue's balance in its stem window within 0.5 dB of its placement's prediction (here the narrowed
// law's); the narrowed renders measured within 0.0001 dB
const PAN_TOL_DB = 0.5;
// The characters' listener against the storyboard's prediction at the onset (scripts/sound-report.js hear): measured
// within 0.12 dB on the 88 moved one-shots (their listener moves a little over their span); the bar is a starting
// value of about twice that
const PREDICT_TOL_DB = 0.25;

// ---------- every switch off ----------
test('every switch off renders today\'s samples: as config.js ships them, with no options at all, and with an occlusion handed in', () => {
  const none = { ...BASE, audio: { ...BASE.audio } };
  delete none.audio.options;
  const hideAll = () => () => true, today = hash(pre());
  assert.equal(hash(preMasterWith(none)), today, 'the config with no options, as before the switches');
  assert.equal(hash(preMasterWith(BASE, { occlusion: hideAll })), today, 'an occlusion hiding everything, the muffle off');
  assert.equal(hash(preMasterWith(withOptions(BASE, SWITCHES.muffleVolume))), today, 'the muffle on and no occlusion: src never builds one');
  // control: the muffle on with that occlusion is another mix
  assert.notEqual(hash(preMasterWith(withOptions(BASE, SWITCHES.muffleVolume), { occlusion: hideAll })), today);
  // the design stage reads none of them: its car and foley with every switch on and an occlusion are its own samples
  const design = atStage(BASE, { stage: 'design', parked: [] }), on = withOptions(design, { ...SWITCHES.muffleSwap, ...SWITCHES.syncPan, ...SWITCHES.listener });
  const stem = (cfg, occ) => hash(renderSoundtrack(cfg, { only: ['car', 'foley'], occlusion: occ, reverb: false, normalize: false }));
  assert.equal(stem(on, hideAll), stem(design, null));
});

// ---------- each switch moves what it names, and only that ----------
// The check: every placed voiced cue rendered alone with the switch off and on; the cues that differ against the cues
// the option names (written from its definition, not its code); and the whole mix before the master, which must not
// differ outside the named cues' samples. `still` keeps named cues that rightly do not move.
function switchProblems(cfg, occ, named, { only = null, stillOk = () => false } = {}) {
  const ctx = makeContext(cfg, { occlusion: occ }), { moved } = compareCues(ctxA, ctx, { cacheA, only });
  const m = movedAgainstNamed(moved, only ? named.filter((id) => only.includes(id)) : named), p = [];
  for (const id of m.stray) p.push(`${id}: moved, not named`);
  for (const id of m.still.filter((x) => !stillOk(x, ctx))) p.push(`${id}: named, not moved`);
  return p;
}
const mixProblems = (cfg, occ, named) => { const s = strayDifferences(pre(), preMasterWith(cfg, { occlusion: occ }), named); return s.samples ? [`the mix differs at ${s.samples} samples outside the named cues, first at ${s.first} s`] : []; };

test('each switch moves exactly the cues it names, cue by cue and in the whole mix before the master', () => {
  const listener = withOptions(BASE, SWITCHES.listener), from = firstPoint(makeContext(listener).levelAt);
  const cases = [
    ['muffle, volume', withOptions(BASE, SWITCHES.muffleVolume), occlusion, namedMuffle(hidden)],
    ['muffle, swap', withOptions(BASE, SWITCHES.muffleSwap), occlusion, namedMuffle(hidden)],
    ['sync pan', withOptions(BASE, SWITCHES.syncPan), null, namedSyncPan(withOptions(BASE, SWITCHES.syncPan).audio.options.syncPan)],
    ['listener', listener, null, namedListener(from)],
  ];
  // a named cue the characters' listener leaves alone is one both listeners give the same gain throughout
  const stillOk = (id, ctx) => levelGainChange(cue(id), ctx.levelAt, SR) === 0;
  for (const [what, cfg, occ, named] of cases) {
    assert.ok(named.length > 0, what);
    assert.deepEqual(switchProblems(cfg, occ, named, { stillOk: what === 'listener' ? stillOk : undefined }), [], what);
    assert.deepEqual(mixProblems(cfg, occ, named), [], what);
  }
});

test('a switch that leaks to another cue is found: the muffle on a step, the pan on the lighter, the listener before anyone is out', () => {
  const named1 = namedMuffle(hidden), step = 'foley.feet.A.10', leaky = (c) => (c.id === step ? () => true : occlusion(c));
  assert.ok(!hidden.has(step));
  const vol = withOptions(BASE, SWITCHES.muffleVolume);
  assert.deepEqual(switchProblems(vol, leaky, named1, { only: [step, named1[0]] }), [`${step}: moved, not named`]);
  const s = strayDifferences(pre(), preMasterWith(vol, { occlusion: leaky }), named1), c = cue(step);
  assert.ok(s.samples > 0 && Math.abs(s.first - Math.round(c.t0 * SR) / SR) < 1 / SR, `the first stray sample, at ${s.first} s, is the planted step's onset`);
  // the pan narrowed for the lighter too, while the option names the steps, the scuffs and the hands' contacts
  const P = BASE.audio.options.syncPan, pan = withOptions(BASE, { syncPan: { on: true, kinds: [...P.kinds, 'lighter'] } }), lighters = CUES.filter((c) => c.family === 'lighter').map((c) => c.id);
  assert.deepEqual(switchProblems(pan, null, namedSyncPan(P), { only: [...lighters, step] }), lighters.map((id) => `${id}: moved, not named`));
  assert.equal(mixProblems(pan, null, namedSyncPan(P)).length, 1);
  // the characters' listener with a point from the start (A's first): the engine moves before anyone is out
  const cfg = withOptions(BASE, SWITCHES.listener), real = makeContext(cfg).levelAt, from = firstPoint(real), early = (t) => real(t) ?? real(from);
  const ctx = { ...makeContext(cfg), levelAt: early }, { moved } = compareCues(ctxA, ctx, { cacheA, only: ['hard.engine.car.intake', step] });
  assert.deepEqual(movedAgainstNamed(moved, namedListener(from)).stray, ['hard.engine.car.intake']);
});

// ---------- the muffle ----------
const muffleRows = (mode, over = {}) => {
  const ctx = makeContext(withOptions(BASE, { muffle: { mode, ...over } }), { occlusion });
  return compareCues(ctxA, ctx, { only: namedMuffle(hidden), pad: 4096, measure: (c, a, b) => muffleRow(c, a, b, hiddenSpans(c, hidden.get(c.id), FPS), hidden.get(c.id)) }).rows;
};
function dropProblems(mode, over = {}) {
  const ctx = makeContext(withOptions(BASE, { muffle: { mode, ...over } }), { occlusion }), want = -BASE.audio.options.muffle.dropDb, p = [];
  for (const [id, h] of hidden) {
    if (!h.hid.every(Boolean)) continue;
    const c = cue(id), a = renderCue(c, ctxA), b = renderCue(c, ctx), d = levelDb(b, [[c.t0, c.t1]]) - levelDb(a, [[c.t0, c.t1]]);
    if (!(Math.abs(d - want) <= DROP_TOL_DB)) p.push(`${id}: ${d.toFixed(6)} dB, want ${want}`);
  }
  return p;
}

test('the muffle: the volume drop takes dropDb off a cue hidden on every frame; the swap takes the band over its lowpass; an unknown mode is refused', () => {
  assert.equal([...hidden.values()].filter((h) => h.hid.every(Boolean)).length, 12);
  assert.deepEqual(dropProblems('volume'), []);
  // control: a drop of 3 dB where the option says 6
  assert.equal(dropProblems('volume', { dropDb: 3 }).length, 12);
  const swap = muffleRows('swap'), cabin = (rows) => rows.filter((x) => x.family === 'cabin');
  assert.equal(cabin(swap).length, 3);
  assert.deepEqual(cabin(swap).filter((x) => !(x.dHiddenDb <= SWAP_CABIN_DB)).map((x) => x.cue), []);
  assert.deepEqual(swap.filter((x) => x.centroidB > x.centroidA).map((x) => x.cue), [], 'a lowpass never raises a centroid');
  // control: a lowpass at 20 kHz leaves the cabin's clicks nearly whole
  assert.equal(cabin(muffleRows('swap', { lowpassHz: 20000 })).filter((x) => !(x.dHiddenDb <= SWAP_CABIN_DB)).length, 3);
  assert.throws(() => renderCue(cue(namedMuffle(hidden)[0]), makeContext(withOptions(BASE, { muffle: { mode: 'filter' } }), { occlusion })), /muffle mode 'filter'/);
});

// ---------- the narrower pan ----------
function panProblems(renderOf) {
  const P = withOptions(BASE, SWITCHES.syncPan).audio.options.syncPan, law = (c) => ({ ...LAWS[c.law], width: P.widthRatio }), p = [];
  for (const id of namedSyncPan(P)) {
    const c = cue(id), q = c.place(c.t0);
    if (placeAt(q, c.t0, undefined, law(c)).pan !== placeAt(q, c.t0, undefined, LAWS[c.law]).pan * P.widthRatio) p.push(`${id}: the pan is not the camera's times ${P.widthRatio}`);
    const x = renderOf(c), off = x.i0 / x.sr, p0 = c.placement === 'onset' ? q : null;
    const panAt = (t) => { const s = p0 ?? c.place(t + off); return s ? placeAt(s, t + off, undefined, law(c)).pan : 0; };
    const want = predictedBalanceDb(x, c.t0 - off, c.t1 - off, panAt), got = balanceOf(x, c.t0, c.t1);
    if (!(Math.abs(got - want) <= PAN_TOL_DB)) p.push(`${id}: balance ${got.toFixed(2)} dB, the narrowed law predicts ${want.toFixed(2)}`);
  }
  return p;
}

test('the narrower pan: each named cue\'s pan is the camera\'s times the width, and its stem\'s balance follows it', () => {
  const ctx = makeContext(withOptions(BASE, SWITCHES.syncPan));
  assert.deepEqual(panProblems((c) => renderCue(c, ctx)), []);
  // control: today's renders against the narrowed law; every cue whose balance moves by more than the bar fails
  const moving = namedSyncPan(BASE.audio.options.syncPan).filter((id) => Math.abs(balanceOf(renderCue(cue(id), ctx), cue(id).t0, cue(id).t1) - balanceOf(renderCue(cue(id), ctxA), cue(id).t0, cue(id).t1)) > PAN_TOL_DB);
  assert.ok(moving.length > 0);
  assert.equal(panProblems((c) => renderCue(c, ctxA)).length, moving.length);
});

// ---------- the characters' listener ----------
function predictionProblems(ctx, select) {
  const p = [], from = firstPoint(makeContext(withOptions(BASE, SWITCHES.listener)).levelAt);
  for (const id of namedListener(from)) {
    const c = cue(id);
    if (c.shape !== 'oneshot' || !select(c)) continue;
    const a = renderCue(c, ctxA, { pad: 4096 }), b = renderCue(c, ctx, { pad: 4096 }), got = loudestDb(b, c.t0, c.t1) - loudestDb(a, c.t0, c.t1);
    const want = input.hear(c, c.t0, 'characters').db - input.hear(c, c.t0, 'camera').db;
    if (!(Math.abs(got - want) <= PREDICT_TOL_DB)) p.push(`${id}: ${got.toFixed(2)} dB, the storyboard predicts ${want.toFixed(2)}`);
  }
  return p;
}

test('the characters\' level listener: the camera\'s level until a person is out of the car, then the storyboard\'s own prediction', () => {
  const ctx = makeContext(withOptions(BASE, SWITCHES.listener)), from = firstPoint(ctx.levelAt);
  // A's first frame out of the car is 742 (30.917 s); the poser shows A from just before it
  assert.ok(from > 741 / FPS && from <= 742 / FPS, `${from}`);
  assert.equal(ctx.levelAt(from - 1e-3), null);
  assert.deepEqual(predictionProblems(ctx, () => true), []);
  // control: a listener that hears from A alone puts B's sounds off the prediction
  const poseA = WORLD.makePoser('A'), aOnly = (t) => { const s = poseA(t); return s.visible ? [s.x, s.y + DESIGN.CLOTH.up, s.z] : null; };
  assert.ok(predictionProblems({ ...ctx, levelAt: aOnly }, (c) => c.person === 'B').length > 0);
});

// ---------- the hidden state ----------
// the voiced cues the picture hides, with their hidden and covered frame counts, against Sound 1's onScreen rows
function hiddenProblems(h) {
  const voiced = new Set(CUES.filter((c) => c.enabled && c.voices > 0).map((c) => c.id));
  const rows = JSON.parse(readFileSync(resolve(import.meta.dirname, '../storyboard/sound/report.json'), 'utf8')).checks.find((c) => c.id === 'onScreen').rows.filter((x) => x.hidden > 0 && voiced.has(x.cue));
  const p = rows.filter((x) => !h.has(x.cue) || h.get(x.cue).hid.filter(Boolean).length !== x.hidden || h.get(x.cue).hid.length !== x.frames).map((x) => `${x.cue}: Sound 1 has ${x.hidden} of ${x.frames} frames hidden`);
  for (const id of h.keys()) if (!rows.some((x) => x.cue === id)) p.push(`${id}: hidden here, not in Sound 1`);
  return p;
}

test('the hidden state is Sound 1\'s: the same 19 voiced cues hidden on the same frames as storyboard/sound/report.json check 2', () => {
  assert.equal(hidden.size, 19);
  assert.deepEqual(hiddenProblems(hidden), []);
  // control: the car's body and cabin left out of the blockers; the cues it hides are no longer hidden
  const noCar = { ...input, blockers: (c, t) => input.blockers(c, t).filter((b) => !b.name.startsWith('car')) };
  assert.ok(hiddenProblems(occlusionFrom(noCar).hidden).length >= 15);
});

// ---------- the master ----------
// a test signal: stereo noise with sparse clicks well over the rest, so the normalization limits them
function clicky(seconds, seed) {
  const rng = mulberry32(seed), n = seconds * SR, left = new Float32Array(n), right = new Float32Array(n);
  for (let i = 0; i < n; i++) { left[i] = (rng() * 2 - 1) * 0.02; right[i] = (rng() * 2 - 1) * 0.015; }
  for (let i = SR / 4; i < n; i += SR / 2) left[i] = right[i + 1] = 0.6;
  return { sr: SR, left, right };
}

test('the master: masterOf replays normalize sample for sample; a joint master holds every mix of a set to B over A and under the ceiling', () => {
  const A = clicky(6, 3), m = masterOf(A, BASE.audio), own = { left: Float32Array.from(A.left), right: Float32Array.from(A.right) };
  const stats = normalize(own.left, own.right, BASE.audio, SR);
  assert.ok(stats.limitedSamples > 0, 'the test signal is limited');
  assert.ok(m.out.left.every((x, i) => x === own.left[i]) && m.out.right.every((x, i) => x === own.right[i]), 'normalize, sample for sample');
  // B: A with its clicks 6 dB louder; the set mastered jointly
  const B = { sr: SR, left: A.left.map((x) => (Math.abs(x) > 0.5 ? x * 2 : x)), right: A.right.map((x) => (Math.abs(x) > 0.5 ? x * 2 : x)) };
  const ratioProblems = (a, b) => { let bad = 0; for (let i = 0; i < a.left.length; i++) { const want = B.left[i] / A.left[i], got = b.left[i] / a.left[i]; if (A.left[i] !== 0 && Math.abs(got / want - 1) > 1e-6) bad++; } return bad; };
  const j = m.joint([A, B]), ceiling = 10 ** (BASE.audio.ceilingDb / 20) * (1 + 1e-6);
  assert.equal(ratioProblems(j.mixes[0], j.mixes[1]), 0);
  for (const x of j.mixes) assert.ok(x.left.every((v) => Math.abs(v) <= ceiling) && x.right.every((v) => Math.abs(v) <= ceiling));
  assert.ok(j.extra.samples > 0 && j.extra.maxDb > 0, 'B\'s louder clicks turn A down there too, and that is reported');
  // control: B mastered on its own (a per-clip normalization) is not B over A
  assert.ok(ratioProblems(j.mixes[0], masterOf(B, BASE.audio).out) > 0);
});

// ---------- option 4 ----------
test('the style-frame candidates: the default first, then the scenes their rules pick', () => {
  const s = candidateScenes(), fams = (t0, t1, cues = CUES) => new Set(cues.filter((c) => c.enabled && c.voices > 0 && c.t0 < t1 && c.t1 > t0).map((c) => c.family)).size;
  assert.deepEqual(s.map((x) => [x.name, x.shots]), [['default', 'shots 4 to 6'], ['most families, shortest', 'shots 4 to 5'], ['both places', 'shots 5 to 8'], ['what the default leaves out', 'shots 11 to 13']]);
  assert.equal(fams(s[1].t0, s[1].t1), fams(s[0].t0, s[0].t1), 'the shorter scene holds as many families as the default');
  // control: a lighter planted in shot 4 is a family the default now has, and the last scene no longer needs it
  const planted = CUES.map((c) => (c.family === 'lighter' ? { ...c, t0: c.t0 - 54, t1: c.t1 - 54 } : c));
  assert.notDeepEqual(candidateScenes(planted).map((x) => x.shots), s.map((x) => x.shots));
});
