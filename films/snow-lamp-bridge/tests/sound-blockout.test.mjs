// Checks for the blockout stage (src/audio/layers/blockout/, SOUND-PLAN 4.4, ROADMAP Sound 2.3 and 2.4): one voice per
// sounding cue at its planned level; every one-shot's onset on its cue, on stems by voice group, matched one to one;
// each cue's pan where the camera hears it; nothing starting in the bed-only windows; the families told apart by
// their spectra; the same bytes twice; the stems summing to the mix; a changed picture moving the sound; and layers
// that read only cues.js. Each check is a function returning its problems: the real render gives none, a planted
// fault gives some. Run: node --test tests/sound-blockout.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { CONFIG } from '../src/config.js';
import { CUES, DESIGN, LAWS, WORLD, makeCues } from '../src/audio/cues.js';
import { STAGES, atStage, buildLayers, makeContext, renderSoundtrack } from '../src/audio/index.js';
import { renderAll } from '../src/audio/mix.js';
import { placeAt } from '../src/audio/spatial.js';
import { mulberry32 } from '../src/prng.js';
import { carTimes, T_TOTAL } from '../src/world.js';
import { SHOTS } from '../src/shots.js';
import { LEVEL, SEND, TIMBRE, TOL } from '../src/audio/layers/blockout/timbre.js';
import { placedEvent, bedVoice, modifiersOf } from '../src/audio/layers/blockout/voices.js';
import { stripComments } from '../scripts/check-forbidden.js';
import { averageSpectrum, balanceDb, centroidHz, groupStem, idx, matchOnsets, matchOneToOne, onsets, predictedBalanceDb, rms, db } from '../scripts/lib/audio-analysis.mjs';

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
// separation measured, brake against breath, is 0.209 octave.
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
// never under cues.js's flam merge (DESIGN.STEP.flam): one source's cues closer than that are one sound.
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

// ---------- timbre ----------
// Each family's spectral centroid (the mono sum of its stem over its cues' spans), from cues.js's families, rendered
// from `list`; and the pairs closer than CENTROID_BAR_OCTAVES.
const FAMILIES = Object.groupBy(voiced(CUES), (c) => c.family);
function centroidOf(f, list = CUES) {
  const own = list.filter((c) => FAMILIES[f].some((x) => x.id === c.id));
  return centroidHz(averageSpectrum(groupStem([...new Set(own.map((c) => c.source))], { cues: list }), own.map((c) => [c.t0, c.t1])));
}
function centroidProblems(hz) {
  const fams = Object.keys(hz), p = [];
  for (let i = 0; i < fams.length; i++) for (let j = i + 1; j < fams.length; j++) {
    const d = Math.abs(Math.log2(hz[fams[i]] / hz[fams[j]]));
    if (!(d >= CENTROID_BAR_OCTAVES)) p.push(`${fams[i]} ${hz[fams[i]].toFixed(0)} Hz and ${fams[j]} ${hz[fams[j]].toFixed(0)} Hz: ${d.toFixed(3)} octave`);
  }
  return p;
}

test('timbre: every family\'s spectral centroid at least 0.11 octave from every other family\'s', () => {
  const hz = Object.fromEntries(Object.keys(FAMILIES).map((f) => [f, centroidOf(f)]));
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
// makeCues on a picture whose doors move 0.5 s later (SOUND-PLAN 4.2's carTimes perturbation): rendered, every door
// onset moves by the same 0.5 s, within ONSET_TOL.
const DT = 0.5;
const shiftDoors = (w) => ({ ...w, carTimes: { ...w.carTimes, doors: Object.fromEntries(Object.entries(w.carTimes.doors).map(([k, d]) => [k, Object.fromEntries(Object.entries(d).map(([q, v]) => [q, v + DT]))])) } });
function shiftProblems(before, after, stemOf) {
  const p = [];
  for (const g of groupsOf(after).filter((x) => x.startsWith('car:door'))) {
    const was = voiced(before).filter((c) => c.source === g), now = voiced(after).filter((c) => c.source === g).sort((a, b) => a.t0 - b.t0), s = stemOf(g);
    const det = onsets(s.left, s.right, s.sr, { minGap: minGapOf(now) });
    const m = matchOneToOne(now.map((c) => c.t0), det, ONSET_TOL);
    for (const c of now) {
      const old = was.find((x) => x.id === c.id), hit = m.pairs.find((x) => x.expected === c.t0);
      if (!hit) p.push(`${c.id}: no onset at its new time ${c.t0.toFixed(4)}`);
      else if (!(Math.abs(hit.detected - old.t0 - DT) <= ONSET_TOL)) p.push(`${c.id}: moved ${(hit.detected - old.t0).toFixed(4)} s, want ${DT}`);
    }
  }
  return p;
}

test('a time shift of the picture moves the onsets: the doors 0.5 s later, rendered, sound 0.5 s later', () => {
  const moved = makeCues(shiftDoors(WORLD));
  assert.equal(voiced(moved).filter((c) => c.family === 'door').length, 10);
  assert.deepEqual(shiftProblems(CUES, moved, (g) => groupStem(g, { cues: moved })), []);
  // control: a layer that kept reading the old picture (cues.js's own list) is found on every door cue
  assert.equal(shiftProblems(CUES, moved, (g) => groupStem(g)).length, 10);
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
