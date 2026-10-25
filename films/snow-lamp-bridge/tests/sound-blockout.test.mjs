// Checks for the blockout stage (src/audio/layers/blockout/, SOUND-PLAN 4.4, ROADMAP Sound 2.3 and 2.4): one voice per
// sounding cue at its planned level; every one-shot's onset on its cue, on stems by voice group, matched one to one;
// every voice, continuous ones too, starting and stopping on its cue's samples when rendered alone; one attack per
// one-shot; each cue's pan where the camera hears it; nothing starting in the bed-only windows; the backgrounds'
// equal-power crossfade at the place change; the families told apart by their spectra; the same bytes twice; the stems
// summing to the mix; a changed picture moving the sound; and layers that read only cues.js. Each check is a function
// returning its problems: the real render gives none, a planted fault gives some.
// Run: node --test tests/sound-blockout.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { CONFIG } from '../src/config.js';
import { CUES, DESIGN, LAWS, LOCATIONS, WORLD, makeCues } from '../src/audio/cues.js';
import { STAGES, atStage, buildLayers, makeContext, renderSoundtrack } from '../src/audio/index.js';
import { BLOCK, renderAll } from '../src/audio/mix.js';
import { placeAt } from '../src/audio/spatial.js';
import { mulberry32 } from '../src/prng.js';
import { carTimes, T_TOTAL } from '../src/world.js';
import { SHOTS } from '../src/shots.js';
import { LEVEL, SEND, TIMBRE, TOL } from '../src/audio/layers/blockout/timbre.js';
import { bedNoise, bedSpan, bedVoice, modifiersOf, placedEvent } from '../src/audio/layers/blockout/voices.js';
import { stripComments } from '../scripts/check-forbidden.js';
import { averageSpectrum, balanceDb, centroidHz, groupStem, matchOnsets, matchOneToOne, nonzeroSpan, onsets, preMaster, predictedBalanceDb, rms, db } from '../scripts/lib/audio-analysis.mjs';

const BLOCKOUT = atStage(CONFIG, { stage: 'blockout' });
const SR = BLOCKOUT.audio.sr;
const DIR = resolve(import.meta.dirname, '../src/audio/layers/blockout');
const voiced = (list) => list.filter((c) => c.enabled && c.voices > 0);
const groupsOf = (list) => [...new Set(voiced(list).map((c) => c.source))];
const hash = (r) => createHash('sha256').update(Buffer.from(r.left.buffer)).update(Buffer.from(r.right.buffer)).digest('hex');

// ---------- bars, each a measurement or a labelled starting value ----------
// ROADMAP Sound 2.6: the renderer and the detector, onset against cue time (the S8.2 layers reached it)
const ONSET_TOL = 0.005;
// ROADMAP Sound 2.6, SOUND-PLAN 4.5: the balance in a cue's stem window against its placement (today's car test)
const PAN_TOL_DB = 0.5;
// Sound 2.3: twice the largest change of any family's centroid when only the seed changes (0.052 octave, the door,
// measured over the seeds 20261021, 1, 2 and 3), so noise alone cannot carry one family onto another. The smallest
// separation measured, the unload against the wind, is 0.188 octave.
const CENTROID_BAR_OCTAVES = 0.11;
// The level rule on a background, measured between its crossfades, a part of the span its level was set over: the
// RMS of a stationary noise moves a little with the window. Measured worst 0.0029 dB (the street's city); the bar is
// a starting value over it
const BED_TOL_DB = 0.01;
// Sound 2.4: the stems summed against the mix, both before the master's normalization: the rounding of the summing
// order only. Measured worst 1.3e-7 of the mix's peak, one float32 step there (2 ^ -23 is 1.2e-7); the bar is a
// starting value of about eight steps
const SUM_TOL_RATIO = 1e-6;
// SOUND-PLAN 3.11: the bed-only windows, from the picture: before the car's first light, the moonrise (the ease
// cue, which reads moonlight), shot 12 (B looks) and shot 15 (the final wide)
const shot = (n) => SHOTS.find((s) => s.n === n);
const ease = CUES.find((c) => c.id === 'bg.ambience.wind.ease');
const BED_ONLY = [['before the car', 0, carTimes.start], ['moonrise', ease.t0, ease.t1], ['shot 12', shot(12).start, shot(12).end], ['shot 15', shot(15).start, shot(15).end]];

// ---------- the voices and the level rule ----------
// One voice per enabled cue with a voice; the level rule (voices.js): a placed voice's loudest LEVEL.windowSec, mono
// before the spatializer, has an RMS of REF * 10 ^ ((level - bus) / 20); a background's RMS over its span, both
// channels, the same. Measured on what each voice actually plays.
const busOf = (c) => (c.category === 'bg' ? 'amb' : 'fx');
const want = (c) => LEVEL.refDb + c.level - BLOCKOUT.audio.buses[busOf(c)];
function voiceProblems(list, busFor = busOf) {
  const p = [], ctx = makeContext(BLOCKOUT, { cues: list });
  const built = buildLayers(BLOCKOUT, null, { cues: list }), ids = new Set(built.flatMap((l) => [...(l.events ?? []).map((e) => e.cue), ...(l.beds ?? [])]));
  for (const c of list) {
    const sounds = ids.has(c.id);
    if (sounds && (c.offered || c.voices === 0)) p.push(`${c.id}: ${c.offered ? 'an offered cue' : 'a modifier'} sounds`);
    if (!sounds && c.enabled && c.voices > 0) p.push(`${c.id}: enabled, but no voice`);
  }
  const w = Math.round(LEVEL.windowSec * SR), n = Math.round(T_TOTAL * SR);
  // the modifiers act after the level, so each voice is measured without them (they are checked on their own below)
  const bare = list.filter((c) => c.voices > 0);
  for (const c of voiced(list)) {
    const busDb = BLOCKOUT.audio.buses[busFor(c)];
    let got;
    if (c.place) {
      const e = placedEvent(c, bare, ctx, busDb), v = e.make(), m = Math.round(e.dur * SR), sq = new Float64Array(m + 1);
      for (let i = 0; i < m; i++) { const x = v(i / SR); sq[i + 1] = sq[i] + x * x; }
      let best = 0;
      for (let i = 0; i + w <= Math.max(m, w); i++) best = Math.max(best, (sq[Math.min(m, i + w)] - sq[Math.min(m, i)]) / w);
      got = 10 * Math.log10(best);
      if (!(Math.abs(got - want(c)) <= 1e-3)) p.push(`${c.id}: ${got.toFixed(3)} dBFS, want ${want(c).toFixed(3)}`);
    } else {
      // a background plays from the start of its crossfade, in blocks, like the mixer; measured between its crossfades,
      // a part of the span its level was set over
      const b = bedVoice(c, bare, ctx, busDb), L = new Float32Array(n), R = new Float32Array(n);
      for (let i0 = 0; i0 < n; i0 += SR) b.process(L.subarray(i0), R.subarray(i0), i0, Math.min(SR, n - i0));
      const h = TIMBRE.crossfadeSec, end = c.t1 - h;
      got = db(rms(L, R, SR, c.t0 + h, end)) + 10 * Math.log10(2); // rms() is per channel; the rule sums both
      if (!(Math.abs(got - want(c)) <= BED_TOL_DB)) p.push(`${c.id}: ${got.toFixed(3)} dBFS, want ${want(c).toFixed(3)}`);
    }
  }
  return p;
}

// The modifiers (voices.js modifiersOf): the rise starts with the engine at its level and comes up to 0 dB; the swell
// goes from 0 to its level and stops with the drive; the wind's ease goes from 0 to its level and holds after it; the
// offered door-open modifier, taken in, lifts the idle while a door is open and is gone once both are shut.
function modifierProblems(list) {
  const p = [], at = (id, t) => modifiersOf(list.find((c) => c.id === id), list, SR)(t), by = (id) => list.find((c) => c.id === id);
  const rise = by('hard.arrival.car.rise'), swell = by('hard.arrival.car.swell'), easeIt = by('bg.ambience.wind.ease');
  const near = (a, b, what) => { if (!(Math.abs(a - b) <= TOL.progressRatio)) p.push(`${what}: ${a.toFixed(4)} dB, want ${b}`); };
  near(at('hard.engine.car.intake', rise.t0), rise.level, 'the engine at its first light');
  near(at('hard.engine.car.intake', rise.t1), 0, 'the engine at the end of the rise');
  near(at('hard.tyres.car.front', swell.t1), swell.level, 'the tyres at the stop');
  near(at('hard.engine.car.intake-idle', swell.t1), 0, 'the idle, which starts as the swell ends');
  near(at('bg.wind.bridge.bed', easeIt.t0), 0, 'the bridge wind as the moon rises');
  near(at('bg.wind.bridge.bed', easeIt.t1 + (T_TOTAL - easeIt.t1) / 2), easeIt.level, 'the bridge wind after the moonrise');
  const door = by('hard.engine.car.door-open'), taken = list.map((c) => (c === door ? { ...c, enabled: true } : c)), d = carTimes.doors.driver;
  const idle = (t) => modifiersOf(by('hard.engine.car.intake-idle'), taken, SR)(t);
  near(idle(d.open1), door.level, 'the idle with the driver\'s door open (offered, taken in)');
  near(idle(door.t1), 0, 'the idle with both doors shut (offered, taken in)');
  return p;
}

test('voices: one per sounding cue, none for the offered or the modifiers; each at its planned level by the rule', () => {
  assert.deepEqual(modifierProblems(CUES), []);
  // control: an engine that starts a sample after its rise is not entered by it: full level at its start, and the
  // rise's -30 dB arriving as it ends
  const late = CUES.map((c) => (c.id === 'hard.engine.car.intake' ? { ...c, t0: c.t0 + 1 / SR } : c));
  assert.deepEqual(modifierProblems(late).map((x) => x.split(':')[0]), ['the engine at its first light', 'the engine at the end of the rise']);
  assert.deepEqual(voiceProblems(CUES), []);
  // controls: an offered cue enabled without being taken in (Gate 0: offered ones stay silent) sounds; a voice scaled
  // for the wrong bus is 9 dB off
  const offered = CUES.find((c) => c.offered && c.voices > 0);
  assert.deepEqual(voiceProblems(CUES.map((c) => (c === offered ? { ...c, enabled: true } : c))), [`${offered.id}: an offered cue sounds`]);
  const flip = (c) => (c.family === 'tick' ? (c.category === 'bg' ? 'fx' : 'amb') : busOf(c));
  assert.ok(voiceProblems(CUES, flip).some((x) => x.startsWith('hard.tick')), 'control: the ticks on the wrong bus');
});

// ---------- onsets ----------
// On each voice group's stem (one voice at a time, so A's and B's steps 3.8 ms apart at 56.34 are measured apart):
// every enabled one-shot matched one to one within ONSET_TOL, and no detection outside the group's cue spans. The
// detector's minimum gap is the group's own smallest onset spacing halved (the doors' unlatch leads the swing by 60 ms),
// never under cues.js's flam merge (DESIGN.STEP.flam): one source's cues closer than that are one sound. This tests the
// renderer and the detector (ROADMAP 2.6). The detector re-triggers on a sustained tail once its gap has passed, so a
// detection inside a cue's span is not counted against it: the exact spans and the one-attack check below cover that,
// and the continuous voices, which this test cannot time.
const minGapOf = (own) => Math.max(DESIGN.STEP.flam, Math.min(0.08, ...own.slice(1).map((c, i) => (c.t0 - own[i].t0) / 2)));
function onsetProblems(list, stemOf, match = matchOneToOne) {
  const p = [];
  for (const g of groupsOf(list)) {
    const own = voiced(list).filter((c) => c.source === g).sort((a, b) => a.t0 - b.t0), shots1 = own.filter((c) => c.shape === 'oneshot');
    if (!shots1.length) continue;
    const s = stemOf(g), det = onsets(s.left, s.right, s.sr, { minGap: minGapOf(own) });
    const m = match(own.map((c) => c.t0), det, ONSET_TOL);
    for (const c of shots1) if (!m.pairs.some((x) => x.expected === c.t0 && Math.abs(x.diff) <= ONSET_TOL)) p.push(`${c.id}: no onset within ${ONSET_TOL * 1000} ms of ${c.t0.toFixed(4)}`);
    for (const d of m.extra) if (!own.some((c) => d >= c.t0 - ONSET_TOL && d < c.t1 + ONSET_TOL)) p.push(`${g}: an onset at ${d} where no cue sounds`);
  }
  return p;
}
const stemOf = (g) => groupStem(g);

test('onsets: every enabled one-shot within 5 ms of its t0, on its voice group\'s stem, matched one to one', () => {
  assert.deepEqual(onsetProblems(CUES, stemOf), []);
  // control: a step rendered 7 ms late is found (the detector reports the 1 ms hop an attack starts in, so a cue 6 ms
  // late can read 5 ms: 7 ms is the first whole step past the bar)
  const late = CUES.map((c) => (c.id === 'foley.feet.A.05' ? { ...c, t0: c.t0 + 0.007 } : c));
  assert.deepEqual(onsetProblems(CUES.filter((c) => c.source === 'A:feet'), (g) => groupStem(g, { cues: late })), ['foley.feet.A.05: no onset within 5 ms of ' + CUES.find((c) => c.id === 'foley.feet.A.05').t0.toFixed(4)]);
  // control: a second cue 3 ms after a real one, never rendered. One to one leaves it unmatched; a nearest-match rule
  // hands both to the one onset and passes
  const real = CUES.find((c) => c.id === 'hard.tick.car.03'), ghost = { ...real, id: 'hard.tick.car.ghost', t0: real.t0 + 0.003 };
  const both = [...CUES.filter((c) => c.source === real.source), ghost];
  assert.ok(onsetProblems(both, stemOf).includes(`hard.tick.car.ghost: no onset within 5 ms of ${ghost.t0.toFixed(4)}`));
  const nearest = (e, d, tol) => ({ pairs: matchOnsets(e, d).filter((x) => Math.abs(x.diff) <= tol), extra: [] });
  assert.deepEqual(onsetProblems(both, stemOf, nearest), [], 'the nearest-match rule passes the ghost');
});

// ---------- every voice exactly where its cue is ----------
// Each voiced cue rendered alone with its modifiers, before the master chain (preMaster), where a voice is exact zeros
// outside the samples it plays: its first and last samples are read, not detected. So this times the continuous voices
// the detector cannot (the engine, tyres, brake, cloth, the beds) and every one-shot again, each apart from its
// group's neighbours, an early start into the previous cue's span included. A placed voice starts on its t0's sample
// (an attack or a fade from 0 may make that first value zero: then one sample later) and stops on its t1's, to a sample
// of rounding, or rings on in the spatializer's lowpass to the end of that block (events.js drops a voice in the block
// it ends in: 255 samples at most; measured, the ring reaches 84 samples before it rounds to zero). A background plays
// bedSpan's samples: its span widened by half the crossfade at each end.
const N = Math.round(T_TOTAL * SR), at = (t) => Math.round(t * SR);
const quiet = (list) => list.filter((c) => c.voices === 0);
function expectedSpan(c) {
  if (!c.place) { const [a, b] = bedSpan(c, SR), e = Math.min(N, b); return { first: [a, a + 1], last: [e - 2, e - 1] }; }
  const a = at(c.t0), e = at(c.t1);
  return { first: [a, a + 1], last: [e - 2, Math.min(N, Math.ceil((e + 1) / BLOCK) * BLOCK) - 1] };
}
function exactProblems(list, spanOf) {
  const p = [];
  for (const c of voiced(list)) {
    const got = spanOf(c), want = expectedSpan(c);
    if (!got) { p.push(`${c.id}: silent`); continue; }
    if (got[0] < want.first[0] || got[0] > want.first[1]) p.push(`${c.id}: starts at sample ${got[0]}, ${((got[0] - want.first[0]) / SR * 1000).toFixed(2)} ms from its t0`);
    if (got[1] < want.last[0] || got[1] > want.last[1]) p.push(`${c.id}: stops at sample ${got[1]}, want ${want.last[0]} to ${want.last[1]}`);
  }
  return p;
}

// One attack per one-shot (the envelope: the peak of each 1 ms hop through its span): after its first ATTACK_LOOK_SEC,
// no ATTACK_LOOK_SEC of it more than ATTACK_RISE_DB louder than the ATTACK_LOOK_SEC before. A second attack inside a
// span (a ghost the detector's gap hides, an event made twice) rises out of the first one's decay.
// ATTACK_RISE_DB is the onset detector's own rise (onsets' ratioDb, 12 dB); ATTACK_LOOK_SEC is a starting value,
// longer than the wobble of a noise burst's envelope. Measured worst over every one-shot: 4.9 dB (foley.feet.A.08, its
// noise); the planted ghost below rises 18.2 dB. A re-attack early in the decay (30 ms into a step: 5.4 dB) stays unseen.
const ATTACK_RISE_DB = 12, ATTACK_LOOK_SEC = 0.01;
function riseDb(s, c) {
  const hop = Math.round(SR / 1000), look = Math.round(ATTACK_LOOK_SEC * SR / hop), a = at(c.t0), b = at(c.t1), env = [];
  for (let i = a; i < b; i += hop) { let p = 0; for (let k = i; k < Math.min(b, i + hop); k++) p = Math.max(p, Math.abs(s.left[k]), Math.abs(s.right[k])); env.push(p); }
  let worst = -Infinity;
  for (let j = look; j < env.length; j++) {
    let before = 0, after = 0;
    for (let q = j - look; q < j; q++) before = Math.max(before, env[q]);
    for (let q = j; q < Math.min(env.length, j + look); q++) after = Math.max(after, env[q]);
    if (after > 0) worst = Math.max(worst, before > 0 ? db(after / before) : Infinity);
  }
  return worst;
}
const attackProblems = (list, riseOf) => voiced(list).filter((c) => c.shape === 'oneshot').flatMap((c) => { const r = riseOf(c); return r > ATTACK_RISE_DB ? [`${c.id}: rises ${r.toFixed(1)} dB inside its span, a second attack`] : []; });

// each voiced cue rendered alone once (with the modifiers of its list), kept as its span and its rise
const ALONE = new Map();
function alone(c, list = CUES) {
  if (!ALONE.has(c)) { const s = preMaster([c, ...quiet(list)]); ALONE.set(c, { span: nonzeroSpan(s), rise: c.shape === 'oneshot' ? riseDb(s, c) : null }); }
  return ALONE.get(c);
}
const byId = (id, list = CUES) => list.find((c) => c.id === id);
const moveBy = (c, dt) => ({ ...c, t0: c.t0 + dt, t1: c.t1 + dt });

test('every voice where its cue is: rendered alone, its first sample on its t0 and its last on its t1, continuous ones too', () => {
  // the pre-master stems are the real stems: one group's, through the mixer's own master chain, is groupStem sample
  // for sample (a layer on a bus the mixer does not know is summed at gain 1)
  const g = 'car:door:driver', pm = preMaster(CUES.filter((c) => c.voices === 0 || c.source === g));
  const pre = { name: 'pre', bus: 'pre-master', reverb: 0, process(L, R, i0, n) { L.set(pm.left.subarray(i0, i0 + n)); R.set(pm.right.subarray(i0, i0 + n)); } };
  const through = renderAll({ layers: [pre], config: BLOCKOUT, sr: SR, total: T_TOTAL, reverb: false, normalize: false }), real = groupStem(g);
  assert.ok(through.left.every((x, i) => x === real.left[i]) && through.right.every((x, i) => x === real.right[i]), 'preMaster is the stem before the master chain');
  assert.deepEqual(exactProblems(CUES, (c) => alone(c).span), []);
  // controls: a continuous voice rendered 10 ms late (the engine's drive), and one 10 ms early, into the span of the
  // cue before it in its group (the idle into the drive: the onset test and a group stem would see one run)
  for (const [id, dt] of [['hard.engine.car.intake', 0.01], ['hard.engine.car.intake-idle', -0.01]]) {
    const c = byId(id), p = exactProblems([c], () => alone(moveBy(c, dt)).span);
    assert.deepEqual(p.map((x) => x.split(' at ')[0]), [`${id}: starts`, `${id}: stops`]);
    assert.ok(Math.abs(Number(p[0].match(/(-?[\d.]+) ms from its t0$/)[1]) - dt * 1000) < 0.05, p[0]); // a sample of envelope
  }
});

test('one attack per one-shot: no 10 ms inside its span 12 dB louder than the 10 ms before', () => {
  assert.deepEqual(attackProblems(CUES, (c) => alone(c).rise), []);
  // control: a second step 120 ms into foley.feet.A.10's span, rendered with it (the onset test passes it)
  const c = byId('foley.feet.A.10'), ghost = { ...moveBy(c, 0.12), id: 'foley.feet.A.ghost' }, s = preMaster([c, ghost, ...quiet(CUES)]);
  assert.deepEqual(attackProblems([c], () => riseDb(s, c)).map((x) => x.split(':')[0]), [c.id]);
});

// ---------- pan ----------
// Each placed cue's balance in its own stem window against what its placement predicts (spatial.js placeAt, the law
// the cue names, weighted by the energy the stem has in each millisecond); a background's against the centre.
function panProblems(list, stemOf, swap = false) {
  const p = [];
  for (const c of voiced(list)) {
    const s = stemOf(c.source), [L, R] = swap ? [s.right, s.left] : [s.left, s.right];
    const p0 = c.placement === 'onset' ? c.place(c.t0) : null;
    const panAt = (t) => { const q = p0 ?? c.place(t); return q ? placeAt(q, t, undefined, LAWS[c.law]).pan : 0; };
    const predicted = c.place ? predictedBalanceDb({ ...s, left: L, right: R }, c.t0, c.t1, panAt) : 0, got = balanceDb(L, R, s.sr, c.t0, c.t1);
    if (!(Math.abs(got - predicted) <= PAN_TOL_DB)) p.push(`${c.id}: balance ${got.toFixed(2)} dB, predicted ${predicted.toFixed(2)}`);
  }
  return p;
}

test('pan: each cue\'s balance in its stem window within 0.5 dB of its placement\'s prediction', () => {
  assert.deepEqual(panProblems(CUES, stemOf), []);
  // the data has cues on both sides of the frame
  const bal = voiced(CUES).filter((c) => c.place).map((c) => balanceDb(stemOf(c.source).left, stemOf(c.source).right, SR, c.t0, c.t1));
  assert.ok(bal.some((x) => x < -3) && bal.some((x) => x > 3));
  // control: left and right swapped, every cue leaning more than the bar either way fails
  const leaning = bal.filter((x) => Math.abs(x) > PAN_TOL_DB).length;
  assert.ok(leaning > 0 && panProblems(CUES, stemOf, true).length >= leaning, `${leaning} leaning cues`);
});

// ---------- the bed-only windows ----------
// No hard-effect or foley onset inside a declared window (SOUND-PLAN 3.11), on the fx layers alone: the backgrounds
// and the hum carry on.
function bedOnlyProblems(s) {
  const p = [];
  for (const [name, a, b] of BED_ONLY) {
    const d = onsets(s.left, s.right, s.sr, { from: a, to: b });
    if (d.length) p.push(`${name} (${a} to ${b}): onsets at ${d.join(', ')}`);
  }
  return p;
}

test('bed-only windows: no hard or foley onset before the car\'s light, through the moonrise, in shots 12 and 15', () => {
  const fx = renderSoundtrack(BLOCKOUT, { only: ['hard', 'foley'], reverb: false, normalize: false });
  assert.deepEqual(bedOnlyProblems(fx), []);
  // control: a step planted in shot 12 is found there
  const step = CUES.find((c) => c.id === 'foley.feet.B.20'), at = (shot(12).start + shot(12).end) / 2;
  const planted = renderSoundtrack(BLOCKOUT, { only: ['foley'], cues: [{ ...step, id: 'foley.feet.B.planted', t0: at, t1: at + step.t1 - step.t0 }], reverb: false, normalize: false });
  assert.deepEqual(bedOnlyProblems(planted).map((x) => x.split(' (')[0]), ['shot 12']);
});

// ---------- the place change ----------
// At each place change (LOCATIONS), each background family's outgoing and incoming beds, rendered alone: the gain the
// render applies to each bed's own noise (bedNoise, drawn as the render draws it), sample by sample over both channels,
// so it is exact (to float32 rounding) and free of the noise's fluctuation, relative to the bed's steady gain beside
// the crossfade. Where a family sounds on both sides (wind, city) the squares sum to 1 (equal power); on every side the
// gain moves gradually and is 0 outside the crossfade. A switch is not gradual; a linear crossfade dips 3 dB midway.
// XFADE_STEP_RATIO, the most a gain may move in a millisecond: a starting value. The 50 ms crossfade's steepest is
// 0.031 (the cosine's), so any crossfade shorter than about 31 ms fails, and a switch, a step of 1, fails by far.
// XFADE_TOL_RATIO: the squares sum to 1 within 2.9e-7 measured (float32 rounding); the bar is a starting value over it.
// A gain per millisecond by least squares would not do: two noises weight the samples of a millisecond differently,
// and the squares of the two averages then miss 1 by up to 0.009.
const XFADE_PAD_SEC = 0.01, XFADE_STEP_RATIO = 0.05, XFADE_TOL_RATIO = 1e-5;
const CHANGES = LOCATIONS.slice(1).map((l) => l.t0);
const crossfadeWindow = (T) => [at(T - TIMBRE.crossfadeSec / 2 - XFADE_PAD_SEC), at(T + TIMBRE.crossfadeSec / 2 + XFADE_PAD_SEC)];
// a background's own noise over [a, b), from bedSpan's first sample, as bedVoice draws it
function bedRaw(c, a, b) {
  const [s0] = bedSpan(c, SR), gen = bedNoise(c, makeContext(BLOCKOUT)), raw = [new Float64Array(b - a), new Float64Array(b - a)];
  for (let i = s0; i < b; i++) { const l = gen[0](), r = gen[1](); if (i >= a) { raw[0][i - a] = l; raw[1][i - a] = r; } }
  return raw;
}
// the gain from raw to stem (both [a, b), window-local) at each sample, over both channels, normalized by `steady`
// (its first or last sample); 0 where the noise is not drawn yet
function gainsOf(stem, raw, steady) {
  const g = new Float64Array(raw[0].length);
  for (let k = 0; k < g.length; k++) { const xx = raw[0][k] ** 2 + raw[1][k] ** 2; g[k] = xx > 0 ? (stem.left[k] * raw[0][k] + stem.right[k] * raw[1][k]) / xx : 0; }
  const ref = steady === 'first' ? g[0] : g[g.length - 1];
  return g.map((x) => x / ref);
}
// sides: { family: { out: gains or null, in: gains or null } } at one place change
function placeChangeProblems(sides) {
  const p = [];
  for (const [f, { out, in: inn }] of Object.entries(sides)) {
    for (const [name, g] of [['out', out], ['in', inn]]) {
      if (!g) continue;
      const hop = Math.round(SR / 1000);
      let step = 0;
      for (let k = hop; k < g.length; k++) step = Math.max(step, Math.abs(g[k] - g[k - hop]));
      if (!(step <= XFADE_STEP_RATIO)) p.push(`${f} ${name}: a step of ${step.toFixed(3)} in a millisecond`);
      if (g[name === 'out' ? g.length - 1 : 0] !== 0) p.push(`${f} ${name}: still sounding beyond the crossfade`);
    }
    if (out && inn) {
      let worst = 0;
      for (let k = 0; k < out.length; k++) worst = Math.max(worst, Math.abs(out[k] * out[k] + inn[k] * inn[k] - 1));
      if (!(worst <= XFADE_TOL_RATIO)) p.push(`${f}: the squares sum to 1 within ${worst.toExponential(1)}, not equal power`);
    }
  }
  return p;
}
// the sides at place change T, from `stemOf(cue, a, b)` (a window-local stem): the beds that end there and start there
function sidesAt(T, stemOf) {
  const [a, b] = crossfadeWindow(T), beds = voiced(CUES).filter((c) => !c.place), sides = {};
  for (const f of new Set(beds.filter((c) => c.t1 === T || c.t0 === T).map((c) => c.family))) {
    const side = (c, steady) => (c ? gainsOf(stemOf(c, a, b), bedRaw(c, a, b), steady) : null);
    sides[f] = { out: side(beds.find((c) => c.family === f && c.t1 === T), 'first'), in: side(beds.find((c) => c.family === f && c.t0 === T), 'last') };
  }
  return sides;
}

test('the place change: each background crossfades with equal power, gradually, inside its crossfade', () => {
  assert.deepEqual(CHANGES, [54]);
  const rendered = (c, a, b) => { const s = preMaster([c, ...quiet(CUES)]); return { left: s.left.subarray(a, b), right: s.right.subarray(a, b) }; };
  const sides = sidesAt(CHANGES[0], rendered);
  assert.deepEqual(Object.fromEntries(Object.entries(sides).map(([f, x]) => [f, [!!x.out, !!x.in]])), { city: [true, true], wind: [true, true], water: [false, true] });
  assert.deepEqual(placeChangeProblems(sides), []);
  // controls, each made of the beds' own noise: a switch at the place change (every side steps by 1), and a linear
  // crossfade over the same span (gradual, but the squares of wind and city dip to a half)
  const T = CHANGES[0], h = TIMBRE.crossfadeSec / 2, [a] = crossfadeWindow(T);
  const planted = (env) => (c, a0, b0) => {
    const raw = bedRaw(c, a0, b0), side = c.t1 === T ? (u) => env(1 - u) : env, stem = { left: new Float32Array(b0 - a0), right: new Float32Array(b0 - a0) };
    for (let k = 0; k < b0 - a0; k++) { const u = Math.min(1, Math.max(0, ((a0 + k) / SR - T + h) / (2 * h))), g = side(u); stem.left[k] = raw[0][k] * g; stem.right[k] = raw[1][k] * g; }
    return stem;
  };
  assert.ok(a > 0);
  const switched = placeChangeProblems(sidesAt(T, planted((u) => (u >= 0.5 ? 1 : 0))));
  assert.deepEqual(switched.filter((x) => x.includes('a step of')).map((x) => x.split(':')[0]), ['city out', 'city in', 'wind out', 'wind in', 'water in']);
  const linear = placeChangeProblems(sidesAt(T, planted((u) => u)));
  assert.deepEqual(linear.map((x) => x.split(':')[0]), ['city', 'wind']);
});

// ---------- timbre ----------
// Each family's spectral centroid (the mono sum of its stem over its cues' spans), from cues.js's families, rendered
// from `list`; and the pairs closer than CENTROID_BAR_OCTAVES. Families that share a voice group are one voice
// changing, not two sounds to tell apart: the engine and its run-down (car:intake), which starts in the engine's band.
const FAMILIES = Object.groupBy(voiced(CUES), (c) => c.family);
const oneVoice = (a, b) => FAMILIES[a].some((x) => FAMILIES[b].some((y) => x.source === y.source));
function centroidOf(f, list = CUES) {
  const own = list.filter((c) => FAMILIES[f].some((x) => x.id === c.id));
  return centroidHz(averageSpectrum(groupStem([...new Set(own.map((c) => c.source))], { cues: list }), own.map((c) => [c.t0, c.t1])));
}
function centroidProblems(hz) {
  const fams = Object.keys(hz), p = [];
  for (let i = 0; i < fams.length; i++) for (let j = i + 1; j < fams.length; j++) {
    if (oneVoice(fams[i], fams[j])) continue;
    const d = Math.abs(Math.log2(hz[fams[i]] / hz[fams[j]]));
    if (!(d >= CENTROID_BAR_OCTAVES)) p.push(`${fams[i]} ${hz[fams[i]].toFixed(0)} Hz and ${fams[j]} ${hz[fams[j]].toFixed(0)} Hz: ${d.toFixed(3)} octave`);
  }
  return p;
}

test('timbre: every family\'s spectral centroid at least 0.11 octave from every other family\'s but its own voice\'s', () => {
  const fams = Object.keys(FAMILIES);
  assert.deepEqual(fams.flatMap((a, i) => fams.slice(i + 1).filter((b) => oneVoice(a, b)).map((b) => `${a} ${b}`)), ['engine stop']);
  const hz = Object.fromEntries(fams.map((f) => [f, centroidOf(f)]));
  assert.deepEqual(centroidProblems(hz), []);
  // control: the cabin's clicks played with the ticks' placeholder are not told apart from the ticks
  const asTicks = CUES.map((c) => (c.family === 'cabin' ? { ...c, family: 'tick' } : c));
  const p = centroidProblems({ ...hz, cabin: centroidOf('cabin', asTicks) });
  assert.equal(p.length, 1); assert.ok(/^cabin .* and tick /.test(p[0]) || /^tick .* and cabin /.test(p[0]), p[0]);
});

// ---------- determinism, and the stems against the mix ----------
test('determinism: two blockout renders give the same samples; another seed does not', () => {
  const a = renderSoundtrack(BLOCKOUT, { normalize: false }), b = renderSoundtrack(BLOCKOUT, { normalize: false });
  assert.equal(hash(a), hash(b));
  // control: another seed is another blockout
  const other = renderSoundtrack({ ...BLOCKOUT, seed: BLOCKOUT.seed + 1 }, { only: ['foley'], normalize: false }), same = renderSoundtrack(BLOCKOUT, { only: ['foley'], normalize: false });
  assert.notEqual(hash(other), hash(same));
});

// The voice groups rendered alone and summed, against the whole blockout, both without the reverb and before the
// normalization: equal to float32 rounding, so no voice leaks state into another (the audio twin of "no state between
// calls"). `stemOf(cues)` renders a subset.
function sumProblems(list, groups, stemOf, mixOf) {
  const mix = mixOf(list), sum = [new Float64Array(mix.left.length), new Float64Array(mix.left.length)];
  for (const g of groups) { const s = stemOf(list, g); for (let i = 0; i < s.left.length; i++) { sum[0][i] += s.left[i]; sum[1][i] += s.right[i]; } }
  let worst = 0, peak = 0;
  for (let i = 0; i < mix.left.length; i++) {
    worst = Math.max(worst, Math.abs(sum[0][i] - mix.left[i]), Math.abs(sum[1][i] - mix.right[i]));
    peak = Math.max(peak, Math.abs(mix.left[i]), Math.abs(mix.right[i]));
  }
  return worst <= SUM_TOL_RATIO * peak ? [] : [`the stems sum to the mix within ${(worst / peak).toExponential(2)} of its peak, bar ${SUM_TOL_RATIO}`];
}
const subset = (list, g) => list.filter((c) => c.voices === 0 || [].concat(g).includes(c.source));

test('stems: every voice group rendered alone, summed, equals the mix before the master\'s normalization', () => {
  const mixOf = () => renderSoundtrack(BLOCKOUT, { reverb: false, normalize: false });
  assert.deepEqual(sumProblems(CUES, groupsOf(CUES), (list, g) => groupStem(g), mixOf), []);
  // control: a leak. Every voice drawing from one shared stream (the SPU's single noise generator, not the per-voice
  // workaround): a group alone draws other numbers than it does in the mix
  const two = subset(CUES, ['A:feet', 'B:feet']);
  const leaky = (list) => {
    const shared = mulberry32(7), ctx = { ...makeContext(BLOCKOUT, { cues: list }), rngFor: () => shared };
    return renderAll({ layers: Object.values(STAGES.blockout).map((m) => m.build(ctx)), config: BLOCKOUT, sr: SR, total: T_TOTAL, reverb: false, normalize: false });
  };
  assert.ok(sumProblems(two, ['A:feet', 'B:feet'], (list, g) => leaky(subset(list, g)), leaky).length > 0, 'control: a shared noise stream');
  assert.deepEqual(sumProblems(two, ['A:feet', 'B:feet'], (list, g) => groupStem(g, { cues: list }), (list) => renderSoundtrack(BLOCKOUT, { cues: list, reverb: false, normalize: false })), [], 'and the same two groups with their own streams sum');
});

// ---------- a changed picture ----------
// SOUND-PLAN 4.2's time perturbations of carTimes, LIGHTER, EMBER and EXHALE, here all at once, on a patched world
// object for makeCues: every carTimes field (start, brake, the turns, stop, the lights, the doors) and the car's
// motion, lights, settle and steering DT later; the lighter, the drags and the exhale DT later. makeCues then moves by
// DT exactly the voiced cues whose derivedFrom names those inputs (42 today: engine, tyres, brake, settle, cabin, the
// doors, the run-down, the ticks, lighter, drags, breath) and no other. Rendered from the moved catalogue, each alone,
// every moved voice starts and stops on its new samples, DT after the old render's. The feet, cloth, scuffs, the
// getting out, the beds and the hum read the people and the places, which do not move here.
const DT = 0.5;
const later = (f) => (t) => f(t - DT);
const plus = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? v + DT : plus(v)]));
const shiftPicture = (w) => ({
  ...w, carTimes: plus(w.carTimes), carAt: later(w.carAt), headlights: later(w.headlights), settlePitch: later(w.settlePitch), steerDeg: later(w.steerDeg),
  LIGHTER: plus(w.LIGHTER), lighterOn: later(w.lighterOn), lighterFlicker: later(w.lighterFlicker),
  EMBER: { ...w.EMBER, drags: w.EMBER.drags.map((d) => d + DT) }, emberLevel: later(w.emberLevel), EXHALE: { ...w.EXHALE, t: w.EXHALE.t + DT },
});
const SHIFTED = /carTimes|headlights|settlePitch|LIGHTER|EMBER|EXHALE/;
function shiftProblems(before, after, spanOf) {
  const p = [], old = new Map(before.map((c) => [c.id, c])), moved = voiced(after).filter((c) => SHIFTED.test(c.derivedFrom ?? ''));
  p.push(...exactProblems(moved, spanOf));
  for (const c of moved) {
    const got = spanOf(c), was = alone(old.get(c.id)).span;
    if (got && !(Math.abs(got[0] - was[0] - DT * SR) <= 1)) p.push(`${c.id}: moved ${((got[0] - was[0]) / SR).toFixed(4)} s, want ${DT}`);
  }
  return p;
}

test('a time shift of the picture moves the sound: the car and the smoker 0.5 s later, rendered, sound 0.5 s later', () => {
  const moved = makeCues(shiftPicture(WORLD)), old = new Map(CUES.map((c) => [c.id, c]));
  // the patch is a pure time shift of what it names: each voiced cue moves by DT or not at all, as its derivedFrom says
  const how = voiced(moved).map((c) => { const d = c.t0 - old.get(c.id).t0, d1 = c.t1 - old.get(c.id).t1; return [c.id, SHIFTED.test(c.derivedFrom ?? ''), Math.abs(d - DT) < 1e-6 && Math.abs(d1 - DT) < 1e-6 ? DT : Math.abs(d) < 1e-9 && Math.abs(d1) < 1e-9 ? 0 : d]; });
  assert.deepEqual(how.filter(([, named, d]) => d !== (named ? DT : 0)), []);
  assert.equal(voiced(moved).length, voiced(CUES).length);
  assert.equal(how.filter(([, named]) => named).length, 42);
  assert.deepEqual(shiftProblems(CUES, moved, (c) => alone(c, moved).span), []);
  // control: a layer that kept reading the old picture (cues.js's own list) is found on every moved cue
  const stale = shiftProblems(CUES, moved, (c) => alone(old.get(c.id)).span);
  assert.equal(new Set(stale.map((x) => x.split(':')[0])).size, 42);
});

// ---------- the layers read only cues.js ----------
// 1. No number in the layer code but 0, 1 and 2: every other number lives in timbre.js, under a name.
// 2. timbre.js: every value's key (or its nearest ancestor's) ends in a unit, and every time (Sec) is a placeholder's
//    own envelope, at most the level plan's window (LEVEL.windowSec, 100 ms): the typed times SOUND-PLAN A.3 found
//    (62.75, +0.38, 0.45, 0.55, 1.1, 75) are all longer, so none can hide there.
// 3. Imports: cues.js, the engine (dsp, events, mix) and each other only; the picture is reached through the cues.
const NUM = /(?<![\w$.])(?:\d[\d_]*\.?\d*|\.\d+)(?:e[+-]?\d+)?(?![\w$])/gi;
const ALLOWED = new Set(['0', '1', '2']);
const IMPORTS = new Set(['../../cues.js', '../../dsp.js', '../../events.js', '../../mix.js', './timbre.js', './voices.js']);
const UNITS = /(Hz|Db|Q|Ratio|Octaves|Sec|PerRpm)$/;
function codeProblems(files) {
  const p = [];
  for (const [name, src] of Object.entries(files)) {
    const code = stripComments(src, { literals: true }), raw = stripComments(src);
    if (name !== 'timbre.js') {
      code.split('\n').forEach((line, i) => { for (const m of line.matchAll(NUM)) if (!ALLOWED.has(m[0])) p.push(`${name}:${i + 1}: the number ${m[0]}`); });
    }
    for (const m of raw.matchAll(/\bfrom\s+(['"])([^'"]+)\1|\bimport\s*\(\s*(['"])([^'"]+)\3/g)) if (!IMPORTS.has(m[2] ?? m[4])) p.push(`${name}: imports ${m[2] ?? m[4]}`);
  }
  return p;
}
function tableProblems(tables) {
  const p = [];
  const walk = (o, path, unit) => {
    for (const [k, v] of Object.entries(o)) {
      const u = UNITS.exec(k)?.[1] ?? unit, at = `${path}.${k}`;
      if (v && typeof v === 'object') walk(v, at, u);
      else if (!u) p.push(`${at}: no unit`);
      else if (u === 'Sec' && !(v > 0 && v <= LEVEL.windowSec)) p.push(`${at}: ${v} s is not a placeholder's envelope time`);
    }
  };
  for (const [name, t] of Object.entries(tables)) walk(t, name, null);
  return p;
}
const sources = () => Object.fromEntries(readdirSync(DIR).filter((f) => f.endsWith('.js')).map((f) => [f, readFileSync(resolve(DIR, f), 'utf8')]));

test('the blockout layers read only cues.js: no time literals in layers/blockout/, imports only cues.js and the engine', () => {
  const files = sources();
  assert.deepEqual(Object.keys(files).sort(), ['bg.js', 'foley.js', 'hard.js', 'timbre.js', 'voices.js']);
  assert.deepEqual(codeProblems(files), []);
  assert.deepEqual(tableProblems({ TIMBRE, LEVEL, SEND, TOL }), []);
  // controls: a typed time in a layer; a picture module imported; a rustle at 62.75 and an offset of 0.38 in the table;
  // a number in the table with no unit
  const hard = files['hard.js'];
  const typed = codeProblems({ 'hard.js': hard.replace('export function build(ctx) {', 'export function build(ctx) {\n  const stop = 29.35; // the rebound') });
  assert.equal(typed.length, 1); assert.match(typed[0], /^hard\.js:\d+: the number 29\.35$/);
  assert.deepEqual(codeProblems({ 'hard.js': `import { carTimes } from '../../../world.js';\n${hard}` }), ['hard.js: imports ../../../world.js']);
  assert.equal(tableProblems({ TIMBRE: { ...TIMBRE, rustleSec: 62.75, settle: { ...TIMBRE.settle, reboundSec: 0.38 } } }).length, 2);
  assert.deepEqual(tableProblems({ TIMBRE: { ...TIMBRE, stop: 75 } }), ['TIMBRE.stop: no unit']);
});
