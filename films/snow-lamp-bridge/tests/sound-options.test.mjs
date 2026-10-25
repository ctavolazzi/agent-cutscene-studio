// Checks for Sound 2.12's option switches (config.audio.options, read by layers/blockout/voices.js and spatial.js) and
// the tools that measure them (scripts/lib/sound-options-lib.js): every switch off renders today's samples, with or
// without an occlusion handed in, and the design stage reads none of them; each switch on moves exactly the cues it
// names, cue by cue and in the whole mix before the master; the muffle drops what it says or swaps to its lowpass, follows
// the hidden state block by block over rampSec, and keeps the swap's copy in step; the narrower pan is the camera's
// pan times its width; the characters' level listener is the storyboard's own, its point and every cue's level, while
// the pan and the air stay the camera's; a switch set to a value it does not know is refused; the hidden state is
// Sound 1's; the options script's master is scripts/sound.js's, and its joint master keeps B over A the option alone;
// the style-frame candidates are the ones their rules pick. Each check has a planted fault shown to fail.
// Run: node --test tests/sound-options.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { CONFIG } from '../src/config.js';
import { CUES, DESIGN, LAWS, WORLD } from '../src/audio/cues.js';
import { Biquad, dbToGain } from '../src/audio/dsp.js';
import { atStage, makeContext, renderSoundtrack } from '../src/audio/index.js';
import { muffleOf, placedEvent } from '../src/audio/layers/blockout/voices.js';
import { normalize } from '../src/audio/loudness.js';
import { BLOCK } from '../src/audio/mix.js';
import { placeAt } from '../src/audio/spatial.js';
import { mulberry32 } from '../src/prng.js';
import { predictedBalanceDb } from '../scripts/lib/audio-analysis.mjs';
import { buildInput, charactersAt } from '../scripts/sound-report.js';
import {
  SWITCHES, allOff, balanceOf, candidateScenes, coherenceOf, compareCues, firstPoint, hiddenSpans, levelDb, levelGainChange, loudestDb, masterOf,
  movedAgainstNamed, muffleRow, namedListener, namedMuffle, namedSyncPan, occlusionFrom, preMasterWith, renderCue, strayDifferences, withOptions,
} from '../scripts/lib/sound-options-lib.js';

const BASE = allOff(atStage(CONFIG, { stage: 'blockout' }));
const SR = BASE.audio.sr;
const input = buildInput(), FPS = input.fps;
// Sound 1's hidden state (its onScreen rule, a car's own body counted) and the set's (the muffle's B: a car's own body
// does not hide its own sounds)
const { occlusion, hidden } = occlusionFrom(input), SET = occlusionFrom(input, CUES, { ownBodies: false });
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
// value of about twice that. The continuous cues, window by window against the same model, measured within 0.024 dB
const PREDICT_TOL_DB = 0.25;
// The windows of a continuous cue held to the model: those where the model's gain ratio moves under this across the
// window's block edges (a cut or a person getting out moves it inside one block, which the spatializer interpolates and
// a window's mean cannot follow). A starting value: it keeps 1596 of the 1618 heard windows, on all 37 cues
const STEADY_DB = 0.5;
// The ramp out of a muffle, rendered, against a linear ramp in amplitude from the drop to 1 over rampSec, weighted by
// the cue's own power: measured within 0.0017 dB on the intake (the spatializer's air lowpass smooths the ramp a little,
// and the ramp starts a sample into its block); a starting value
const RAMP_TOL_DB = 0.05;

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
    ['muffle by the set, volume', withOptions(BASE, SWITCHES.muffleVolume), SET.occlusion, namedMuffle(SET.hidden)],
    ['muffle by the set, swap', withOptions(BASE, SWITCHES.muffleSwap), SET.occlusion, namedMuffle(SET.hidden)],
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

// ---------- the muffle's timing ----------
const M = BASE.audio.options.muffle, DROP = dbToGain(-M.dropDb);
// A planted hidden state for a cue that toggles every half second from its onset, seen first: both ways, many times,
// off the block grid
const toggle = (c) => (t) => Math.floor((t - c.t0) / 0.5) % 2 === 1;
// The muffle's gain on a voice, sample by sample: voices.js muffleOf in volume mode on a constant 1 (1 where it is null)
function gainOf(c, occ, mode = 'volume') {
  const n = Math.round((c.t1 - c.t0) * SR), m = muffleOf(c, makeContext(withOptions(BASE, { muffle: { mode } }), { occlusion: occ }), n), g = new Float64Array(n).fill(1);
  if (m) { const f = m(); for (let i = 0; i < n; i++) g[i] = f(1, i); }
  return g;
}
// The gain against the option's definition: wherever the hidden state has held for a block and rampSec (it is read
// every BLOCK samples and followed over rampSec; from the onset it starts where the state stands), the gain is the drop
// while hidden and 1 while seen, and it never moves faster than the whole drop in rampSec
function timingProblems(c, occ, g) {
  const hold = BLOCK + Math.ceil(M.rampSec * SR), rate = (1 - DROP) / (M.rampSec * SR), hid = occ(c) ?? (() => false), p = [];
  let state = null, since = 0, settled = null, fast = null;
  for (let i = 0; i < g.length; i++) {
    const s = hid(c.t0 + i / SR);
    if (s !== state) { if (state !== null) since = i; state = s; }
    if ((since === 0 || i - since >= hold) && !(Math.abs(g[i] - (s ? DROP : 1)) <= 1e-12)) settled ??= `${c.id}: gain ${g[i].toFixed(4)} at ${(c.t0 + i / SR).toFixed(4)} s, ${s ? 'hidden' : 'seen'} since ${(c.t0 + since / SR).toFixed(4)} s`;
    if (i > 0 && Math.abs(g[i] - g[i - 1]) > rate * (1 + 1e-9)) fast ??= `${c.id}: the gain moves ${Math.abs(g[i] - g[i - 1]).toExponential(3)} in a sample at ${(c.t0 + i / SR).toFixed(4)} s, over the whole drop in rampSec`;
  }
  return [settled, fast].filter(Boolean);
}
// The swap against its definition: the voice crossfaded, by the muffle's own amount (from gainOf), to a copy of itself
// through two lowpasses at lowpassHz that run on every sample from the onset, so the copy is in step whenever it is
// heard. Driven by seeded noise; returns the largest difference from that
function swapGap(c, occ) {
  const n = Math.round((c.t1 - c.t0) * SR), vol = gainOf(c, occ), f = muffleOf(c, makeContext(withOptions(BASE, { muffle: { mode: 'swap' } }), { occlusion: occ }), n)();
  const lp = [new Biquad(SR, 'lowpass', M.lowpassHz), new Biquad(SR, 'lowpass', M.lowpassHz)], rng = mulberry32(7);
  let worst = 0;
  for (let i = 0; i < n; i++) {
    const x = rng() * 2 - 1, y = lp[1].process(lp[0].process(x)), m = (vol[i] - 1) / (DROP - 1);
    worst = Math.max(worst, Math.abs(f(x, i) - (x + (y - x) * m)));
  }
  return worst;
}

test('the muffle follows the hidden state block by block and moves over rampSec; the swap\'s copy stays in step', () => {
  // every hidden cue, and the intake under a planted toggle
  const intake = cue('hard.engine.car.intake'), planted = (c) => (c.id === intake.id ? toggle(c) : null);
  for (const id of hidden.keys()) assert.deepEqual(timingProblems(cue(id), occlusion, gainOf(cue(id), occlusion)), [], id);
  for (const id of SET.hidden.keys()) assert.deepEqual(timingProblems(cue(id), SET.occlusion, gainOf(cue(id), SET.occlusion)), [], id);
  assert.deepEqual(timingProblems(intake, planted, gainOf(intake, planted)), []);
  // controls: the state read once at the onset (it never lifts); no ramp (it jumps)
  const once = (c) => { const h = occlusion(c); return h && (() => h(c.t0)); }, step = (c) => (t) => t >= c.t0 + 1;
  assert.equal(timingProblems(intake, occlusion, gainOf(intake, once)).length, 1);
  const jump = Float64Array.from(gainOf(intake, step), (x) => (x < 1 ? DROP : 1));
  assert.ok(timingProblems(intake, step, jump).some((x) => x.includes('moves')));
  // the swap: the copy in step on every hidden cue and through the toggle (within float rounding: measured 3.3e-16)
  for (const id of hidden.keys()) assert.ok(swapGap(cue(id), occlusion) <= 1e-12, id);
  assert.ok(swapGap(intake, planted) <= 1e-12);
});

test('the muffle in the render: the intake drops by dropDb while building SE hides it, ramps back over rampSec, then is today\'s sample for sample', () => {
  const c = cue('hard.engine.car.intake'), [span] = hiddenSpans(c, hidden.get(c.id), FPS), seen = span.t1;
  assert.equal(span.by, 'building SE');
  assert.ok(Math.abs(seen - 17.875) < 1e-9 && span.t0 === c.t0 && c.t1 > seen + 1, `${span.t0} to ${seen} of ${c.t0} to ${c.t1}`);
  const a = renderCue(c, ctxA), b = renderCue(c, makeContext(withOptions(BASE, SWITCHES.muffleVolume), { occlusion }));
  const d = levelDb(b, [[c.t0, seen]]) - levelDb(a, [[c.t0, seen]]);
  assert.ok(Math.abs(d + M.dropDb) <= DROP_TOL_DB, `${d} dB while hidden`);
  // the ramp starts on the first block at or after the frame that shows it (blocks counted from the onset)
  const s0 = Math.round(c.t0 * SR), r0 = s0 + Math.ceil((seen * SR - s0) / BLOCK) * BLOCK, r1 = r0 + Math.round(M.rampSec * SR);
  let ea = 0, ew = 0, eb = 0;
  for (let i = r0; i < r1; i++) {
    const k = i - a.i0, e = a.left[k] ** 2 + a.right[k] ** 2, g = DROP + (1 - DROP) * (i - r0) / (r1 - r0);
    ea += e; ew += e * g * g; eb += b.left[k] ** 2 + b.right[k] ** 2;
  }
  const ramp = 10 * Math.log10(eb / ea), want = 10 * Math.log10(ew / ea);
  assert.ok(Math.abs(ramp - want) <= RAMP_TOL_DB && want < -1, `the ramp ${ramp} dB, a linear ramp over rampSec ${want}`);
  // after a block and rampSec, today's samples exactly
  const k0 = Math.round((seen + BLOCK / SR + M.rampSec) * SR) - a.i0;
  let differ = 0;
  for (let k = k0; k < a.left.length; k++) if (a.left[k] !== b.left[k] || a.right[k] !== b.right[k]) differ++;
  assert.equal(differ, 0);
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

// The listener's point against the storyboard's (scripts/sound-report.js charactersAt) on every frame and between them
function pointProblems(levelAt) {
  const p = [];
  for (let k = 0; k < input.total * FPS * 2; k++) {
    const t = k / (2 * FPS), a = levelAt(t), b = charactersAt(t);
    if (!a !== !b || (a && a.some((v, j) => !(Math.abs(v - b[j]) <= 1e-9)))) p.push(`${t.toFixed(4)} s: ${a?.map((v) => v.toFixed(3))} against ${b?.map((v) => v.toFixed(3))}`);
  }
  return p;
}
// Each named cue heard by its law under the switch (voices.js placedEvent's, the one the spatializer is handed): at
// every block edge of its span its pan, air cutoff and distance are the camera's (LAWS[c.law]) exactly, and its stem's
// balance follows the camera's pan within PAN_TOL_DB (ROADMAP 2.6), measured on its own power
function cameraKeptProblems(ctx, named, renderOf = (c) => renderCue(c, ctx)) {
  const p = [];
  for (const id of named) {
    const c = cue(id), law = placedEvent(c, CUES, ctx, 0).law, p0 = c.placement === 'onset' ? c.place(c.t0) : null;
    for (let i = Math.floor(c.t0 * SR / BLOCK) * BLOCK; i <= Math.ceil(c.t1 * SR / BLOCK) * BLOCK; i += BLOCK) {
      const t = i / SR, q = p0 ?? c.place(t);
      if (!q) continue;
      const a = placeAt(q, t, undefined, LAWS[c.law]), b = placeAt(q, t, undefined, law);
      if (a.pan !== b.pan || a.hz !== b.hz || a.dist !== b.dist) { p.push(`${id} at ${t.toFixed(4)} s: pan ${b.pan} hz ${b.hz} against the camera's ${a.pan} ${a.hz}`); break; }
    }
    const x = renderOf(c), off = x.i0 / SR, panAt = (t) => { const s = p0 ?? c.place(t + off); return s ? placeAt(s, t + off, undefined, LAWS[c.law]).pan : 0; };
    const want = predictedBalanceDb(x, c.t0 - off, c.t1 - off, panAt), got = balanceOf(x, c.t0, c.t1);
    if (!(Math.abs(got - want) <= PAN_TOL_DB)) p.push(`${id}: balance ${got.toFixed(2)} dB, the camera's pan predicts ${want.toFixed(2)}`);
  }
  return p;
}
// Each continuous cue's level window by window (LEVEL.windowSec, where A is within 20 dB of its loudest and the model
// is steady) against the storyboard's characters model at its rendered point (sound-report.js hear, 'characters' over
// 'camera', at the middle of each block), weighted by A's own power. A one-shot is held at its onset by the test above
function continuousProblems(ctx, named, from) {
  const p = [], w = Math.round(0.1 * SR);
  for (const id of named) {
    const c = cue(id);
    if (c.shape === 'oneshot') continue;
    const p0 = c.placement === 'onset' ? c.place(c.t0) : null, heard = p0 ? { ...c, place: () => p0 } : c;
    const ratio = (t) => { const a = input.hear(heard, t, 'camera'), b = input.hear(heard, t, 'characters'); return a && b ? b.db - a.db : 0; };
    const a = renderCue(c, ctxA), b = renderCue(c, ctx), loud = loudestDb(a, c.t0, c.t1);
    let worst = 0, at = null;
    for (let s = Math.round(Math.max(c.t0, from) * SR); s < Math.round(c.t1 * SR); s += w) {
      const e = Math.min(Math.round(c.t1 * SR), s + w), dbs = [];
      if (levelDb(a, [[s / SR, e / SR]]) < loud - 20) continue;
      for (let i = Math.floor(s / BLOCK) * BLOCK; i <= e; i += BLOCK) dbs.push(ratio(i / SR));
      if (Math.max(...dbs) - Math.min(...dbs) > STEADY_DB) continue;
      let ea = 0, ew = 0, eb = 0;
      for (let i = s; i < e; i += BLOCK) {
        const j = Math.min(e, Math.floor(i / BLOCK) * BLOCK + BLOCK), g = dbToGain(ratio((i + j) / 2 / SR)) ** 2;
        for (let k = i - a.i0; k < j - a.i0; k++) { const x = a.left[k] ** 2 + a.right[k] ** 2; ea += x; ew += x * g; eb += b.left[k] ** 2 + b.right[k] ** 2; }
        i = j - BLOCK;
      }
      const d = 10 * Math.log10(eb / ea) - 10 * Math.log10(ew / ea);
      if (Math.abs(d) > Math.abs(worst)) { worst = d; at = s / SR; }
    }
    if (!(Math.abs(worst) <= PREDICT_TOL_DB)) p.push(`${id}: ${worst.toFixed(2)} dB off the model at ${at.toFixed(2)} s`);
  }
  return p;
}

test('the characters\' listener moves the level alone: its point is the storyboard\'s, every continuous cue follows the model, the pan and the air stay the camera\'s', () => {
  const ctx = makeContext(withOptions(BASE, SWITCHES.listener)), from = firstPoint(ctx.levelAt), named = namedListener(from);
  assert.deepEqual(pointProblems(ctx.levelAt), []);
  assert.deepEqual(continuousProblems(ctx, named, from), []);
  assert.deepEqual(cameraKeptProblems(ctx, named), []);
  // controls: the listener at the people's roots, not their cloth points (the hum's level moves); a law that also
  // narrows the pan (sync pan on for every foley kind), and its renders
  const posers = Object.keys(WORLD.PEOPLE).map((id) => WORLD.makePoser(id));
  const roots = (t) => { const ps = posers.map((pose) => pose(t)).filter((x) => x.visible).map((x) => [x.x, x.y, x.z]); return ps.length ? ps.reduce((s, x) => s.map((v, j) => v + x[j] / ps.length), [0, 0, 0]) : null; };
  assert.ok(pointProblems(roots).length > 0);
  assert.equal(continuousProblems({ ...ctx, levelAt: roots }, ['bg.hum.lamp.bed'], from).length, 1);
  const narrow = makeContext(withOptions(BASE, { ...SWITCHES.listener, ...SWITCHES.syncPan })), steps = named.filter((id) => cue(id).family === 'feet');
  assert.ok(cameraKeptProblems(narrow, steps).length >= steps.length);
});

// ---------- the switches' values ----------
test('a switch set to a value it does not know is refused: a listener, a muffle mode, a sync pan kind that names no foley cue', () => {
  assert.throws(() => makeContext(withOptions(BASE, { listener: 'character' })), /listener 'character'/);
  assert.throws(() => makeContext(withOptions(BASE, { listener: 'Camera' })), /listener 'Camera'/);
  const step = cue('foley.feet.A.10');
  assert.throws(() => renderCue(step, makeContext(withOptions(BASE, { syncPan: { on: true, kinds: ['feet', 'fet'] } }))), /syncPan kinds 'fet'/);
  assert.throws(() => renderCue(step, makeContext(withOptions(BASE, { syncPan: { on: true, kinds: ['feet', 'door'] } }))), /syncPan kinds 'door'/);
  assert.throws(() => renderCue(step, makeContext(withOptions(BASE, { muffle: { mode: 'Volume' } }), { occlusion })), /muffle mode 'Volume'/);
  // controls: the values it knows, and a kind left alone while the switch is off
  for (const listener of ['camera', 'characters']) assert.doesNotThrow(() => makeContext(withOptions(BASE, { listener })));
  assert.doesNotThrow(() => renderCue(step, makeContext(withOptions(BASE, { syncPan: { on: true, kinds: ['feet', 'moves.cup'] } }))));
  assert.doesNotThrow(() => renderCue(step, makeContext(withOptions(BASE, { syncPan: { on: false, kinds: ['fet'] } }))));
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

// The set's hidden state against Sound 1's: a frame is hidden by the set exactly when Sound 1 hides it by something
// other than the cue's own body (sound-checks.js screenState tries the set's blockers before the car's, so a frame it
// gives to an own box has no other blocker), frame for frame
function setProblems(set, all) {
  const p = [];
  for (const [id, h] of all) {
    const want = h.hid.map((x, j) => x && !h.own[j]), got = set.get(id)?.hid ?? want.map(() => false);
    if (want.some((x, j) => x !== got[j])) p.push(`${id}: ${got.filter(Boolean).length} frames hidden by the set, want ${want.filter(Boolean).length}`);
  }
  for (const id of set.keys()) if (!all.has(id)) p.push(`${id}: hidden by the set, not by Sound 1`);
  return p;
}

test('the set\'s hidden state: Sound 1\'s less the frames a car\'s own body hides; the engine behind building SE, the cabin and getting out kept', () => {
  assert.deepEqual(setProblems(SET.hidden, hidden), []);
  const by = (id) => [...new Set(SET.hidden.get(id).by.filter(Boolean))];
  assert.deepEqual(by('hard.engine.car.intake'), ['building SE']);
  assert.deepEqual(by('hard.engine.car.exhaust'), ['building SE']);
  assert.ok(!SET.hidden.has('hard.door.passenger.unlatch') && SET.hidden.has('hard.cabin.A.belt') && SET.hidden.has('hard.unload.A.slide'));
  // control: the own boxes kept (Sound 1's rule) is not the set's
  assert.ok(setProblems(occlusionFrom(input).hidden, hidden).length > 0);
});

// ---------- the master ----------
// a test signal: stereo noise with sparse clicks well over the rest, so the normalization limits them
function clicky(seconds, seed) {
  const rng = mulberry32(seed), n = seconds * SR, left = new Float32Array(n), right = new Float32Array(n);
  for (let i = 0; i < n; i++) { left[i] = (rng() * 2 - 1) * 0.02; right[i] = (rng() * 2 - 1) * 0.015; }
  for (let i = SR / 4; i < n; i += SR / 2) left[i] = right[i + 1] = 0.6;
  return { sr: SR, left, right };
}

test('the master: masterOf replays normalize sample for sample; a joint or a still master holds every mix of a set to B over A and under the ceiling, the still one with no curve', () => {
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
  // the still master: one static gain under A's, so neither mix is limited (each is its raw mix times that gain), B over
  // A, and both under the ceiling
  const st = m.still([A, B]);
  assert.ok(st.belowDb > 0 && st.gainDb < m.stats.gainDb, `${st.belowDb} dB under A's gain`);
  assert.equal(ratioProblems(st.mixes[0], st.mixes[1]), 0);
  for (const [x, raw] of [[st.mixes[0], A], [st.mixes[1], B]]) {
    assert.ok(x.left.every((v) => Math.abs(v) <= ceiling) && x.right.every((v) => Math.abs(v) <= ceiling));
    let lo = Infinity, hi = 0;
    for (let i = 0; i < raw.left.length; i++) if (Math.abs(raw.left[i]) > 1e-3) { const k = x.left[i] / raw.left[i]; lo = Math.min(lo, k); hi = Math.max(hi, k); }
    assert.ok(hi / lo - 1 < 1e-6, `no curve: the raw mix times one gain (${lo} to ${hi})`);
  }
  // control: the still gain from A alone leaves B's louder clicks over the ceiling
  const alone = m.still([A]), ga = 10 ** (alone.gainDb / 20);
  assert.ok(B.left.some((v) => Math.abs(v * ga) > ceiling));
});

// ---------- the engine's coherence ----------
test('coherenceOf: two equal renders in phase add to twice their powers, a render and its negative cancel, two noises add as powers', () => {
  const noise = (seed, i0 = 0) => { const rng = mulberry32(seed), n = SR, left = new Float32Array(n), right = new Float32Array(n); for (let i = 0; i < n; i++) { left[i] = rng() * 2 - 1; right[i] = rng() * 2 - 1; } return { sr: SR, i0, left, right }; };
  const x = noise(1), neg = { ...x, left: x.left.map((v) => -v), right: x.right.map((v) => -v) };
  assert.ok(Math.abs(coherenceOf([x, x], 0, 1) - 2) < 1e-9);
  assert.ok(coherenceOf([x, neg], 0, 1) < 1e-9);
  assert.ok(Math.abs(coherenceOf([x, noise(2)], 0, 1) - 1) < 0.02);
  // the renders are summed by film sample (their i0): the same noise starting half a second later meets another part of
  // itself and adds as powers; a sum that ignored i0 would read it as one noise in phase, 2
  const late = { ...x, i0: SR / 2 };
  assert.ok(Math.abs(coherenceOf([x, late], 0.5, 1) - 1) < 0.02);
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
