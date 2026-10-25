// Checks for the blockout's measurement tooling (scripts/lib/audio-analysis.mjs, ROADMAP Sound 2.5, SOUND-PLAN 4.5):
// onsets to the sample, one-to-one matching, cue ends, sync judged on a measured onset, pan from a stem window, the
// momentary and short-term meters against ffmpeg, the third-octave bank on pure tones, the limiter's loss, the mono
// fold-down and the phone, the loudest window and the measured density; then the review's measures
// (scripts/sound-review.js). Each has a planted fault that must be found: a cue 5 ms late measured 5 ms late, and one
// 5.5 ms late that the 1 ms hop reads inside the 5 ms bar and the sample outside it; each cue of the closest pairs
// played 6 ms early or late, and a stem holding it there; a cue one frame late failing sync, and one on a frame time
// 10 ms late not excused as the reading's lag; swapped channels failing the pan bar; and an onset that a nearest-match
// rule hands to the wrong cue.
// Run: node --test tests/sound-measure.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CONFIG } from '../src/config.js';
import { CUES, DESIGN, LAWS } from '../src/audio/cues.js';
import { atStage } from '../src/audio/index.js';
import { placeAt } from '../src/audio/spatial.js';
import { encodeWav } from '../src/audio/wav.js';
import { mulberry32 } from '../src/prng.js';
import { FPS, T_TOTAL } from '../src/world.js';
import { buildInput, syncRule } from '../scripts/sound-report.js';
import {
  densityEntry, determinismEntry, driftEntry, driftTol, levelEntry, makeSession, maskingAndPhone, measureGroup, panEntry,
  readLagSec, rendererEntry, silenceEntry, stemsEntry, syncEntry, targetEntry, targetSweep, voicesEntry,
} from '../scripts/sound-review.js';
import {
  THIRD_OCTAVES, balanceDb, bandLevels, energyBlocks, foldDown, limiterLoss, loudestWindow, matchOnsets, matchOneToOne,
  measuredDensity, momentary, onsets, preMaster, preciseOnsets, predictedBalanceDb, segment, shortTerm, soundingEnd, syncOf, thirdOctaveBank,
} from '../scripts/lib/audio-analysis.mjs';

const BLOCKOUT = atStage(CONFIG, { stage: 'blockout' });
const SR = BLOCKOUT.audio.sr;
const dir = mkdtempSync(join(tmpdir(), 'sound-measure-test-'));
const byId = (id) => CUES.find((c) => c.id === id);
const quiet = CUES.filter((c) => c.voices === 0);
// one voice group's stem before the master, from cues.js's catalogue with some cues replaced or added
const groupOf = (source, swap = []) => preMaster([...quiet, ...CUES.filter((c) => c.source === source && c.voices > 0 && !swap.some((x) => x.id === c.id)), ...swap]);
const moveBy = (c, dt) => ({ ...c, sync: c.sync + dt, t0: c.t0 + dt, t1: c.t1 + dt });
// a cue played dt later in every respect: its span moved, and its place and track read dt earlier. moveBy moves only
// the span, and a voice whose level follows the picture waits for it: the flame, whose level is lighterFlicker's,
// moved 6 ms early by moveBy still starts at the first flame frame
const shiftBy = (c, dt) => ({ ...moveBy(c, dt), place: c.place && ((t) => c.place(t - dt)), track: c.track && ((t) => c.track(t - dt)) });
const own = (source) => CUES.filter((c) => c.enabled && c.voices > 0 && c.source === source).sort((a, b) => a.t0 - b.t0);
// the detector's gap within one voice group (tests/sound-blockout.test.mjs): half the group's closest onsets, at most
// 80 ms, never under cues.js's flam merge
const minGapOf = (list) => Math.max(DESIGN.STEP.flam, Math.min(0.08, ...list.slice(1).map((c, i) => (c.t0 - list[i].t0) / 2)));

// ---------- onsets to the sample, and matching one to one ----------
// The renderer bar (ROADMAP Sound 2.6): an onset within 5 ms of its cue time. onsets() reports the 1 ms hop an
// attack crosses its line in, which rounds the attack down by less than a millisecond; preciseOnsets() reads the
// sample. Measured: this step on time reads 0.083 ms after its t0 (the first sample of its attack over the detector's
// line), so 5 ms late reads 5.083 ms against its cue time and exactly 5 ms (240 samples) against its own reading on
// time; the bar on that shift is one sample. A whole millisecond keeps an attack's place in its hop, so 6 ms late
// reads over 5 ms on the hop too, and only a fractional shift tells the two apart: 5.5 ms late, this step's attack
// lands 0.77 ms into its hop, onsets() reads it 4.81 ms late, inside the bar, and preciseOnsets() 5.58, outside it
// (the test checks that premise). The time is read within READ_TOL, the renderer bar is RENDER_TOL.
const RENDER_TOL = 0.005, READ_TOL = 0.01;
test('onsets to the sample: a step 5 ms late reads 5 ms late; 5.5 ms late the hop reads it inside the 5 ms bar, the sample outside', () => {
  const g = 'A:feet', c = byId('foley.feet.A.05'), times = own(g).map((x) => x.t0);
  const read = (stem, tol) => matchOneToOne(times, preciseOnsets(stem.left, stem.right, SR, { minGap: minGapOf(own(g)) }), tol);
  const at = (m) => m.pairs.find((x) => x.expected === c.t0);
  const real = read(groupOf(g), RENDER_TOL), late5 = read(groupOf(g, [moveBy(c, 0.005)]), READ_TOL);
  assert.equal(real.missed.length, 0, 'every step of the group within the bar');
  assert.ok(Math.abs(at(real).diff) < 0.25e-3, `on time: ${at(real).diff * 1000} ms`);
  assert.ok(Math.abs(at(late5).diff - at(real).diff - 0.005) <= 1 / SR + 1e-9, `5 ms late reads ${((at(late5).diff - at(real).diff) * 1000).toFixed(3)} ms later`);
  // control: 6 ms late is no longer within the bar, and reads 6 ms late
  const late6 = read(groupOf(g, [moveBy(c, 0.006)]), RENDER_TOL);
  assert.deepEqual(late6.missed, [c.t0]);
  assert.ok(Math.abs(at(read(groupOf(g, [moveBy(c, 0.006)]), READ_TOL)).diff - at(real).diff - 0.006) <= 1 / SR + 1e-9);
  // the hop against the sample: 5.5 ms late, its attack lands far enough into its hop that the hop's time is inside the
  // bar (premise), so onsets() would pass it and preciseOnsets() fails it
  const s55 = groupOf(g, [moveBy(c, 0.0055)]), attack = at(read(s55, READ_TOL)).detected;
  assert.ok((attack * 1000) % 1 > 0.5 + at(real).diff * 1000, `premise: the attack lands ${((attack * 1000) % 1).toFixed(3)} ms into its hop`);
  const byHop = at(matchOneToOne(times, onsets(s55.left, s55.right, SR, { minGap: minGapOf(own(g)) }), RENDER_TOL));
  assert.ok(byHop && byHop.diff <= RENDER_TOL, 'control: on the hop it reads inside the bar');
  assert.deepEqual(read(s55, RENDER_TOL).missed, [c.t0], 'to the sample it is outside the bar');
  // onsets() is unchanged by the refactor into a shared detector, and still rounds to the millisecond
  const s = groupOf(g), hop = onsets(s.left, s.right, SR, { minGap: minGapOf(own(g)) }), fine = preciseOnsets(s.left, s.right, SR, { minGap: minGapOf(own(g)) });
  assert.equal(hop.length, fine.length);
  assert.ok(hop.every((t, i) => fine[i] >= t - 1e-12 && fine[i] < t + 0.001), 'each precise onset inside its hop');
});

test('one to one: an onset that a nearest-match rule hands to the wrong cue is matched right; nearest-match passes it (control)', () => {
  // a ghost cue 3 ms after a real tick, never rendered: the one onset belongs to the real cue
  const real = byId('hard.tick.car.03'), ghost = real.t0 + 0.003, s = groupOf(real.source);
  const det = preciseOnsets(s.left, s.right, SR), expected = [...own(real.source).map((x) => x.t0), ghost].sort((a, b) => a - b);
  const one = matchOneToOne(expected, det, RENDER_TOL);
  assert.deepEqual(one.missed, [ghost], 'the ghost has no onset of its own');
  assert.ok(one.pairs.some((x) => x.expected === real.t0 && Math.abs(x.diff) < 0.001), 'the real cue keeps its onset');
  // control: the nearest-match rule gives the real tick's onset to the ghost too, and so misses nothing
  const near = matchOnsets(expected, det);
  assert.equal(near.find((x) => x.expected === ghost).detected, near.find((x) => x.expected === real.t0).detected);
  assert.ok(near.every((x) => Math.abs(x.diff) <= RENDER_TOL));
});

// ---------- cue ends ----------
// soundingEnd: just after the last sample within 60 dB of the loudest in the span. Measured on the brake's first pad
// span rendered alone (a continuous voice, faded over its last 5 ms): 0.15 ms before its t1. The planted fault cuts
// the cue 50 ms short; its measured end moves 50 ms, to a millisecond.
test('cue ends: a continuous voice ends on its t1; one cut 50 ms short is measured 50 ms short', () => {
  const c = byId('hard.brake.car.pads1'), end = (x) => soundingEnd(preMaster([...quiet, x]), x.t0, x.t1 + 0.1).end;
  const real = end(c), cut = end({ ...c, t1: c.t1 - 0.05 });
  assert.ok(real <= c.t1 + 1e-9 && real > c.t1 - 0.001, `ends ${((real - c.t1) * 1000).toFixed(3)} ms from its t1`);
  assert.ok(Math.abs(real - cut - 0.05) < 0.001, `the cut voice ends ${((real - cut) * 1000).toFixed(2)} ms earlier`);
  // silence has no end; a span holding only the ring of a voice that stopped has `last` past `end`
  assert.equal(soundingEnd({ sr: SR, left: new Float32Array(SR), right: new Float32Array(SR) }, 0, 1), null);
});

// ---------- sync on the measured onset ----------
// check 4's judgement with the measured onset in place of the cue time: the frame that shows the event (the film's
// syncRule, scripts/sound-report.js) must come 0 to 45 ms after the onset, past the cue's lead. A step one frame late
// is heard after the frame that shows its boot down.
const SYNC = { fps: FPS, search: 0.5, ahead: 0.045 };
test('sync on the measured onset: a step one frame late against its picture event fails', () => {
  const g = 'A:feet', c = byId('foley.feet.A.05'), rule = syncRule(c);
  // the onset detected near a cue's time on a stem, matched within the renderer bar
  const onsetOf = (x, stem) => matchOneToOne([x.t0], preciseOnsets(stem.left, stem.right, SR, { from: x.t0 - 0.01, to: x.t0 + 0.1 }), RENDER_TOL).pairs[0].detected;
  const real = syncOf(rule, onsetOf(c, groupOf(g)), c.lead, SYNC);
  assert.ok(real.ok && real.aheadMs >= 0 && real.aheadMs <= 45, JSON.stringify(real));
  // control: the step rendered one frame late, measured where it now sounds
  const late = moveBy(c, 1 / FPS), judged = syncOf(rule, onsetOf(late, groupOf(g, [late])), c.lead, SYNC);
  assert.equal(judged.ok, false);
  assert.match(judged.note, /ms after its frame$/);
  assert.equal(judged.frame, real.frame, 'the same frame shows the same boot');
});

// ---------- pan ----------
// A placed cue's balance in its own stem window against its placement's prediction (predictedBalanceDb, weighted by
// the stem's energy each millisecond), bar 0.5 dB (SOUND-PLAN 4.5). The driver's door cues sit well off centre.
const PAN_TOL_DB = 0.5;
const panDiff = (c, s) => {
  const p0 = c.placement === 'onset' ? c.place(c.t0) : null;
  const panAt = (t) => { const q = p0 ?? c.place(t); return q ? placeAt(q, t, undefined, LAWS[c.law]).pan : 0; };
  return balanceDb(s.left, s.right, s.sr, c.t0, c.t1) - predictedBalanceDb(s, c.t0, c.t1, panAt);
};
test('pan from the stem window: each driver\'s door cue within 0.5 dB of its prediction; swapped channels fail', () => {
  const s = groupOf('car:door:driver'), cues = own('car:door:driver');
  // every one leans more than half the bar, so swapping the channels moves each by more than the bar
  const lean = cues.map((c) => balanceDb(s.left, s.right, SR, c.t0, c.t1));
  assert.ok(lean.every((x) => Math.abs(x) > PAN_TOL_DB / 2), `the door leans: ${lean.map((x) => x.toFixed(2))}`);
  assert.deepEqual(cues.filter((c) => !(Math.abs(panDiff(c, s)) <= PAN_TOL_DB)).map((c) => c.id), []);
  // control: left and right swapped
  const swapped = { ...s, left: s.right, right: s.left };
  assert.deepEqual(cues.filter((c) => !(Math.abs(panDiff(c, swapped)) <= PAN_TOL_DB)).map((c) => c.id), cues.map((c) => c.id));
});

// ---------- momentary and short-term loudness against ffmpeg ----------
// ffmpeg's ebur128 filter, fed 100 ms frames (asetnsamples), gives the momentary (M) and short-term (S) loudness of
// the windows ending at each frame's end. Measured against ours on the stepped noise: 0.0008 LU (M) and 0.0007 LU (S)
// at worst; the bar is a starting value over that. Control: our series read one hop out of step misses by far.
const METER_TOL_LU = 0.01;
function steppedNoise(seconds, seed = 7) {
  const rng = mulberry32(seed), n = seconds * SR, l = new Float32Array(n), r = new Float32Array(n);
  for (let i = 0; i < n; i++) { const g = [0.05, 0.3, 0.01, 0.15][Math.floor(i / SR / 2) % 4]; l[i] = (rng() * 2 - 1) * g; r[i] = (rng() * 2 - 1) * g * 0.7; }
  return { sr: SR, left: l, right: r };
}
function ffmpegSeries(s) {
  const f = join(dir, `meter-${s.left.length}.wav`);
  writeFileSync(f, encodeWav(s.left, s.right, SR, mulberry32(1)));
  const p = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', f, '-af', 'asetnsamples=n=4800:p=0,ebur128=metadata=1,ametadata=print:key=lavfi.r128.M,ametadata=print:key=lavfi.r128.S', '-f', 'null', '-'], { encoding: 'utf8' });
  const read = (k) => [...p.stderr.matchAll(new RegExp(`lavfi\\.r128\\.${k}=(-?[\\d.]+)`, 'g'))].map((m) => Number(m[1]));
  return { M: read('M'), S: read('S') };
}
// the worst difference between our series and ffmpeg's frames (frame k holds the window ending at (k + 1) * 0.1 s)
const worstAgainst = (ours, theirs, shift = 0) => ours.lufs.reduce((w, v, k) => { const f = theirs[Math.round((ours.firstEnd + k * ours.hopSec) * 10) - 1 + shift]; return f === undefined ? w : Math.max(w, Math.abs(v - f)); }, 0);
test('momentary (400 ms) and short-term (3 s) loudness agree with ffmpeg ebur128 within 0.01 LU; one hop out of step does not', () => {
  const s = steppedNoise(12), ref = ffmpegSeries(s), m = momentary(s), st = shortTerm(s);
  assert.equal(m.lufs.length, 117); assert.equal(st.lufs.length, 91);
  assert.ok(worstAgainst(m, ref.M) <= METER_TOL_LU, `momentary ${worstAgainst(m, ref.M)}`);
  assert.ok(worstAgainst(st, ref.S) <= METER_TOL_LU, `short-term ${worstAgainst(st, ref.S)}`);
  // doubling the signal adds 6.02 LU to every window
  const twice = momentary({ sr: SR, left: s.left.map((x) => 2 * x), right: s.right.map((x) => 2 * x) });
  assert.ok(twice.lufs.every((v, k) => Math.abs(v - m.lufs[k] - 6.0206) < 1e-3));
  // control: the same series compared one frame late
  assert.ok(worstAgainst(m, ref.M, 1) > 1, 'control: a series one hop out of step');
});

// ---------- third octaves on pure tones ----------
// The bank is 30 Butterworth band-passes of order 3 (IEC 61260's usual class 1 realisation). A tone at a band's
// centre reads its own level there (measured within 0.034 dB) and at least 18.2 dB less in each neighbour up to
// 2 kHz; the bilinear transform squeezes the upper side near Nyquist (17.6 dB at 6.3 kHz, 15.1 at 12.5 kHz, 12.2 at
// 16 kHz). A tone at a band edge reads -3 dB in both bands that share it (measured within 0.04 dB). Bars: starting
// values over those. Control: one RBJ band-pass biquad per band (Q 4.3, the third octave's) lets far more through.
const TONE = { amp: 0.1, inBandDb: 0.1, edgeDb: 0.1 };
const toneOf = (hz, n = SR) => Float32Array.from({ length: n }, (_, i) => TONE.amp * Math.sin(2 * Math.PI * hz * i / SR));
const rejectionBar = (hz) => (hz <= 2100 ? 18 : hz <= 13000 ? 15 : 12);
test('third octaves on pure tones: its own level at a band centre, the neighbours down, the edges at -3 dB', () => {
  const bank = thirdOctaveBank(SR), ref = 10 * Math.log10(TONE.amp ** 2); // two channels at amp: power summed
  assert.equal(bank.length, 30);
  assert.deepEqual([bank[0].nominal, bank[16].nominal, bank[29].nominal], [25, 1000, 20000]);
  assert.ok(Math.abs(THIRD_OCTAVES[16].hz - 1000) < 1e-9 && Math.abs(THIRD_OCTAVES[0].hz - 25.119) < 1e-3);
  const p = [];
  for (const [i, b] of bank.entries()) {
    const t = toneOf(b.hz), lv = bandLevels(t, t, SR, SR / 2, SR);
    if (!(Math.abs(lv[i].db - ref) <= TONE.inBandDb)) p.push(`${b.nominal} Hz: ${(lv[i].db - ref).toFixed(3)} dB in its band`);
    for (const j of [i - 1, i + 1]) if (lv[j] && !(ref - lv[j].db >= rejectionBar(b.hz))) p.push(`${b.nominal} Hz: only ${(ref - lv[j].db).toFixed(1)} dB down in ${lv[j].nominal}`);
    if (i + 1 < bank.length) {
      const e = toneOf(b.hi), le = bandLevels(e, e, SR, SR / 2, SR);
      for (const j of [i, i + 1]) if (!(Math.abs(le[j].db - ref + 10 * Math.log10(2)) <= TONE.edgeDb)) p.push(`edge ${b.hi.toFixed(0)} Hz: ${(le[j].db - ref).toFixed(3)} dB in ${le[j].nominal}`);
    }
  }
  assert.deepEqual(p, []);
  // control: a single RBJ biquad per band is not a third-octave filter
  const rbj = (hz) => { const x = toneOf(hz * 2 ** (1 / 3)), out = new Float64Array(x.length); const w = 2 * Math.PI * hz / SR, al = Math.sin(w) / (2 * 4.32), a0 = 1 + al; let x1 = 0, x2 = 0, y1 = 0, y2 = 0; for (let i = 0; i < x.length; i++) { const y = (al * x[i] - al * x2 + 2 * Math.cos(w) * y1 - (1 - al) * y2) / a0; x2 = x1; x1 = x[i]; y2 = y1; y1 = y; out[i] = y; } let e = 0; for (let i = SR / 2; i < SR; i++) e += out[i] ** 2; return ref - 10 * Math.log10(2 * e / (SR / 2)); };
  assert.ok(rbj(1000) < rejectionBar(1000), `control: an RBJ biquad rejects the next band by only ${rbj(1000).toFixed(1)} dB`);
});

// ---------- the limiter's loss ----------
// The blockout's loudness rule (Sound 2.6): no 400 ms window may lose more than 1 dB to the limiter. A click limited
// for a few milliseconds is not a level change; a pumped stretch is. Planted on noise: a 500 ms stretch held 3 dB
// down, and a 2 ms dip of 10 dB.
test('the limiter\'s loss: a pumped half second reads 3 dB in its windows; a 2 ms click limited 10 dB is under 1 dB there', () => {
  const s = steppedNoise(4, 3), g = 2, out = { sr: SR, left: s.left.map((x) => x * g), right: s.right.map((x) => x * g) };
  assert.equal(limiterLoss(s, out, 20 * Math.log10(g)).worst.db < 1e-6, true, 'nothing limited, nothing lost');
  const click = { sr: SR, left: Float32Array.from(out.left), right: Float32Array.from(out.right) };
  for (let i = 1.5 * SR; i < 1.5 * SR + 0.002 * SR; i++) { click.left[i] *= 10 ** (-10 / 20); click.right[i] *= 10 ** (-10 / 20); }
  const c = limiterLoss(s, click, 20 * Math.log10(g));
  assert.ok(c.worst.db < 1 && c.worstSample.db > 9.99, `click: window ${c.worst.db.toFixed(3)} dB, sample ${c.worstSample.db.toFixed(2)} dB`);
  const pump = { sr: SR, left: Float32Array.from(out.left), right: Float32Array.from(out.right) };
  for (let i = 2 * SR; i < 2.5 * SR; i++) { pump.left[i] *= 10 ** (-3 / 20); pump.right[i] *= 10 ** (-3 / 20); }
  const q = limiterLoss(s, pump, 20 * Math.log10(g));
  assert.ok(Math.abs(q.worst.db - 3) < 0.01 && q.worst.t >= 2 && q.worst.t <= 2.1, `pump: ${q.worst.db.toFixed(3)} dB at ${q.worst.t}`);
});

// ---------- the mono fold-down and the phone ----------
// foldDown: stereo, mono (L + R) / 2, side (L - R) / 2 and the phone, each played on both channels. A centred source
// loses nothing in mono, a hard-panned one 3 dB, an anti-phase one all of it (the "side channel only" of check 14).
// The phone's 500 Hz second-order high-pass takes a 100 Hz tone down by about 28 dB (|H| = (f / fc) ^ 2 well below
// the corner) and leaves 2 kHz within a few tenths.
test('mono and phone: centred keeps its level, hard left loses 3 dB, anti-phase vanishes; the phone cuts 100 Hz, keeps 2 kHz', () => {
  const n = SR / 2, seg = (l, r) => ({ left: l, right: r, from: SR / 4, to: n });
  const t2k = toneOf(2000, n), t100 = toneOf(100, n), zero = new Float32Array(n);
  const c = foldDown(seg(t2k, t2k), SR), left = foldDown(seg(t2k, zero), SR), anti = foldDown(seg(t2k, t2k.map((x) => -x)), SR);
  assert.ok(Math.abs(c.monoDb - c.stereoDb) < 1e-6 && c.sideDb === -Infinity);
  assert.ok(Math.abs(left.monoDb - left.stereoDb + 10 * Math.log10(2)) < 1e-6, `hard left ${left.monoDb - left.stereoDb}`);
  assert.equal(anti.monoDb, -Infinity);
  assert.ok(anti.sideDb - anti.stereoDb > -1e-6, 'all of it in the side');
  const low = foldDown(seg(t100, t100), SR);
  assert.ok(low.phoneDb - low.stereoDb < -25 && low.smallPhoneDb < low.phoneDb, `100 Hz on the phone: ${(low.phoneDb - low.stereoDb).toFixed(1)} dB`);
  assert.ok(Math.abs(c.phoneDb - c.stereoDb) < 0.5, `2 kHz on the phone: ${(c.phoneDb - c.stereoDb).toFixed(2)} dB`);
});

// ---------- the loudest window and segments ----------
test('loudest window: a click shorter than the window is measured over the whole window; a segment keeps only its span', () => {
  const n = SR, l = new Float32Array(n), r = new Float32Array(n);
  for (let i = 0; i < 0.01 * SR; i++) { l[SR / 2 + i] = 0.5; r[SR / 2 + i] = 0.5; } // 10 ms at 0.5 on both channels
  const s = { sr: SR, left: l, right: r }, w = loudestWindow(s, 0.5, 0.51);
  assert.ok(Math.abs(w.db - 10 * Math.log10(2 * 0.25 * 0.01 / 0.1)) < 1e-9, `${w.db}`);
  assert.equal(w.t, 0.5);
  const cut = segment(s, 0.5, 0.6, { lead: 0.1, keep: (t) => t >= 0.505 });
  assert.equal(cut.from, 0.1 * SR);
  assert.equal(cut.left[cut.from + 0.001 * SR], 0); assert.equal(cut.left[cut.from + 0.006 * SR], 0.5);
  assert.equal(loudestWindow({ sr: SR, left: new Float32Array(n), right: new Float32Array(n) }, 0, 1), null);
});

// ---------- measured density ----------
test('measured density: groups sounding together are counted, within 6 dB of the loudest or fresh; one 20 dB down is not', () => {
  const step = 0.01, total = 1, mk = (name, body, level, from, to, onset) => {
    const l = new Float32Array(SR * total);
    for (let i = from * SR; i < to * SR; i++) l[i] = level * Math.sin(i);
    return { name, body, blocks: energyBlocks({ sr: SR, left: l, right: l }, step), onsets: onset === null ? [] : [onset] };
  };
  const groups = [mk('A:feet', 'A', 0.3, 0.1, 0.9, 0.1), mk('B:feet', 'B', 0.2, 0.2, 0.9, 0.2), mk('car:engine', 'car', 0.03, 0, 1, null)];
  const ticks = measuredDensity(groups, { step, window: 0.1, recent: 0.1, db: 6, total });
  assert.equal(ticks.length, 100);
  assert.deepEqual(ticks[50].fg, ['A:feet', 'B:feet']); // the engine is 20 dB under the loudest and not fresh
  assert.equal(ticks[50].bodies, 2);
  assert.deepEqual(ticks[5].fg, ['car:engine'], 'alone, the engine is the loudest');
  // control: the engine 4 dB under the steps joins them
  const loud = [groups[0], groups[1], mk('car:engine', 'car', 0.2, 0, 1, null)];
  assert.equal(measuredDensity(loud, { step, window: 0.1, recent: 0.1, db: 6, total })[50].bodies, 3);
});

// ---------- the review's measures (scripts/sound-review.js), each with its planted fault ----------
// On a few voice groups of the real blockout (one session, each stem rendered once) or on small made-up signals.
const session = makeSession({ log: () => {} });
const INPUT = buildInput();
const failing = (e) => e.rows.filter((x) => x.ok === false).map((x) => x.cue ?? x.note);
const rowsOf = (e, kind) => e.rows.filter((x) => x.kind === kind);

// The renderer measure reads each voiced cue's onset on its own render (the first sample that is not zero) and checks
// each group's stem against the sum of its cues alone. The detector on the stem could not: on a tail still sounding it
// fires again every minGap, and the later cue of a close pair read a re-fire wherever its audio was (round 05's checker:
// 5 of the 93 one-shots passed with their audio 6 ms early, foley.feet.B.03 at 50 ms). Planted on the closest pairs,
// 6 ms early and late, two ways: the renderer playing the cue there (`played`: its render alone and the stem both
// move), which its own row fails; and a stem holding it there while the cue alone does not (a voice leaking into the
// group), which only the sum sees.
const PAIRS = [
  ['foley.feet.B.02', 'foley.feet.B.03'], ['foley.feet.A.12', 'foley.feet.A.13'], ['hard.door.driver.unlatch', 'hard.door.driver.swing-open'],
  ['hard.door.passenger.unlatch', 'hard.door.passenger.swing-open'], ['foley.lighter.A.flame', 'foley.lighter.A.release'],
];
test('renderer measure: the closest pairs\' groups pass; each cue of a pair played 6 ms early or late fails on its own row; a stem holding it there fails the sum', () => {
  const groups = [...new Set(PAIRS.map(([a]) => byId(a).source)), 'car:engine-bay', 'bg:wind'];
  const real = rendererEntry(groups.map((g) => measureGroup(session, g)));
  assert.equal(real.status, 'pass', JSON.stringify(failing(real)));
  assert.equal(rowsOf(real, 'sum').length, groups.length);
  const problems = [];
  for (const pair of PAIRS) {
    for (const id of pair) {
      for (const dt of [-0.006, 0.006]) {
        const c = byId(id), moved = shiftBy(c, dt), say = `${id} ${dt > 0 ? '+' : ''}${dt * 1000} ms`;
        // the renderer plays it there: its own row fails, by the shift; its partner and the sum pass (a stray is allowed:
        // the unlatch 6 ms early sounds before any cue of its door)
        const played = rendererEntry([measureGroup(session, c.source, { played: [moved] })]), bad = rowsOf(played, 'onset').filter((x) => !x.ok);
        if (bad.length !== 1 || bad[0].cue !== id || Math.abs(bad[0].diffMs - dt * 1000) > 0.05 || !rowsOf(played, 'sum')[0].ok) problems.push(`${say} played: ${JSON.stringify(failing(played))}`);
        // the stem holds it there, its render alone does not: every onset row passes, the sum fails inside its span
        const leak = rendererEntry([measureGroup(session, c.source, { stem: groupOf(c.source, [moved]) })]), sum = rowsOf(leak, 'sum')[0];
        if (!rowsOf(leak, 'onset').every((x) => x.ok) || sum.ok || !(sum.at >= Math.min(c.t0, moved.t0) - 1e-3 && sum.at <= Math.max(c.t1, moved.t1) + 0.02)) problems.push(`${say} in the stem: ${JSON.stringify(failing(leak))}`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

test('renderer measure: a ghost cue the renderer never played, a stray onset and continuous voices played 30 ms late fail', () => {
  // a ghost cue 3 ms after a real tick, never rendered: alone it plays on time, so only the sum finds the stem without it
  const real = byId('hard.tick.car.03'), ghost = { ...real, id: 'hard.tick.car.ghost', sync: real.sync + 0.003, t0: real.t0 + 0.003, t1: real.t1 + 0.003 };
  const both = [...own(real.source), ghost].sort((a, b) => a.t0 - b.t0);
  const e = rendererEntry([measureGroup(session, real.source, { own: both })]), sum = rowsOf(e, 'sum')[0];
  assert.deepEqual([e.status, sum.ok, rowsOf(e, 'onset').every((x) => x.ok)], ['fail', false, true]);
  assert.ok(sum.at >= ghost.t0 && sum.at < ghost.t1 + 0.01, `the stem departs from the sum at ${sum.at}`);
  // control: the list without the ghost passes
  assert.equal(rendererEntry([measureGroup(session, real.source)]).status, 'pass');
  // a step rendered where no cue of the group sounds (the cue list does not know it): a stray, and the sum
  const stray = moveBy(byId('foley.feet.A.02'), 0.7);
  const s = rendererEntry([measureGroup(session, 'A:feet', { stem: groupOf('A:feet', [byId('foley.feet.A.02'), stray]) })]);
  assert.deepEqual([...new Set(s.rows.filter((x) => !x.ok).map((x) => x.kind))].sort(), ['stray', 'sum']);
  assert.ok(rowsOf(s, 'stray').some((x) => Math.abs(x.onset - stray.t0) < 0.002));
  // continuous voices (SOUND-PLAN 4.5's bar is not only for one-shots): cloth, a brake, a drag and the bridge's wind
  // bed (judged from bedSpan's start, half the crossfade early), each played 30 ms late, fail on their own rows
  for (const id of ['foley.moves.B.walk1', 'hard.brake.car.pads1', 'foley.drag.A.1', 'bg.wind.bridge.bed']) {
    const c = byId(id), late = rendererEntry([measureGroup(session, c.source, { played: [shiftBy(c, 0.03)] })]);
    assert.deepEqual(rowsOf(late, 'onset').filter((x) => !x.ok).map((x) => [x.cue, Math.round(x.diffMs)]), [[id, 30]]);
    assert.equal(rowsOf(rendererEntry([measureGroup(session, c.source)]), 'onset').find((x) => x.cue === id).ok, true, `${id} on time`);
  }
});

test('sync measure: a step one frame late against its picture event fails, where it passed on time', () => {
  const c = byId('foley.feet.A.05'), real = syncEntry(measureGroup(session, 'A:feet').rows, INPUT);
  assert.equal(real.rows.find((x) => x.cue === c.id).ok, true);
  const late = syncEntry(measureGroup(session, 'A:feet', { played: [shiftBy(c, 1 / FPS)] }).rows, INPUT);
  const row = late.rows.find((x) => x.cue === c.id);
  assert.deepEqual([late.status, row.ok, row.cueOk], ['fail', false, true]);
  assert.match(row.note, /ms after its frame$/);
});

// An instant on its frame's own time passes on its cue time with nothing to spare, and its onset, the first sample
// that is not zero (one after its voice's start), reads 0.02 ms after the frame: that, and only that, is the reading's
// lag (readLagSec, 1.5 samples). A cue on a frame time played 10 ms late is late, and its note says so plainly.
test('sync measure: an instant on its frame\'s own time reads the reading\'s lag after it, noted so; played 10 ms late it is plainly late', () => {
  for (const id of ['hard.door.driver.latch', 'hard.engine.car.intake']) {
    const c = byId(id), row = (m) => syncEntry(m.rows, INPUT).rows.find((x) => x.cue === id);
    const on = row(measureGroup(session, c.source));
    assert.deepEqual([on.ok, on.cueOk], [false, true], id);
    assert.match(on.note, /on the frame's own time/);
    assert.ok(-on.aheadMs > 0 && -on.aheadMs <= readLagSec(SR) * 1000 + 1e-6, `${id} reads ${-on.aheadMs} ms after its frame`);
    const late = row(measureGroup(session, c.source, { played: [shiftBy(c, 0.01)] }));
    assert.deepEqual([late.ok, late.cueOk], [false, true]);
    assert.match(late.note, /^10\.02 ms after its frame$/, `${id}: ${late.note}`);
  }
});

test('pan measure: the driver\'s door passes; swapped channels fail every one of its cues', () => {
  const rows = measureGroup(session, 'car:door:driver').rows, stem = session.group('car:door:driver');
  assert.equal(panEntry(rows, () => stem).status, 'pass');
  const swapped = panEntry(rows, () => ({ ...stem, left: stem.right, right: stem.left }));
  assert.deepEqual(failing(swapped), rows.map((x) => x.c.id));
});

test('silence measure: B\'s steps start in no bed-only window; a step planted in shot 12 is found there', () => {
  assert.equal(silenceEntry([measureGroup(session, 'B:feet')], INPUT).status, 'pass');
  const step = byId('foley.feet.B.20'), s12 = INPUT.silence.windows.find((w) => /shot 12/.test(w.name)), at = (s12.t0 + s12.t1) / 2;
  const planted = { ...step, id: 'foley.feet.B.planted', sync: at, t0: at, t1: at + step.t1 - step.t0 };
  const e = silenceEntry([measureGroup(session, 'B:feet', { stem: groupOf('B:feet', [step, planted]) })], INPUT);
  assert.equal(e.status, 'fail');
  assert.deepEqual([...new Set(e.rows.filter((x) => x.onset !== null).map((x) => `${x.window}: ${x.group}`))], [`${s12.name}: B:feet`]);
});

test('voices measure: the measured spans pass; a voice running into the next of its group is a cut; 25 at once is too many', () => {
  const rows = ['A:feet', 'car:intake', 'car:door:driver'].flatMap((g) => measureGroup(session, g).rows);
  assert.equal(voicesEntry(rows, INPUT).status, 'pass');
  const i = rows.findIndex((x) => x.c.id === 'foley.feet.A.05'), next = rows[i + 1];
  const into = rows.map((x, k) => (k === i ? { ...x, end: next.onset + 0.01 } : x));
  assert.deepEqual(voicesEntry(into, INPUT).rows.filter((x) => x.kind === 'cut').map((x) => [x.cue, x.other]), [[next.c.id, 'foley.feet.A.05']]);
  // the place change: the street's wind and the bridge's overlap inside the crossfade, on purpose; overlapping longer,
  // they are a cut
  const wind = measureGroup(session, 'bg:wind').rows, fade = voicesEntry(wind, INPUT);
  assert.deepEqual([fade.status, fade.rows.filter((x) => x.kind === 'crossfade').map((x) => x.cue)], ['pass', ['bg.wind.bridge.bed']]);
  const longer = voicesEntry(wind.map((x) => (x.c.id === 'bg.wind.street.bed' ? { ...x, end: x.end + 0.1 } : x)), INPUT);
  assert.deepEqual([longer.status, longer.rows.filter((x) => x.kind === 'cut').map((x) => x.cue)], ['fail', ['bg.wind.bridge.bed']]);
  // 25 groups sounding at once, each a voice of its own
  const many = Array.from({ length: 25 }, (_, k) => ({ c: { ...byId('hard.tick.car.03'), id: `planted.${k}`, source: `planted:${k}`, t0: 1, t1: 2 }, onset: 1, end: 2 }));
  assert.equal(voicesEntry(many, INPUT).status, 'fail');
});

test('density measure: three bodies sounding together pass; a fourth body at the same moment fails', () => {
  const mk = (id, source, person) => {
    const l = new Float32Array(SR * 3);
    for (let i = SR; i < 2 * SR; i++) l[i] = 0.1 * Math.sin(i * 0.3);
    return { g: source, stem: { sr: SR, left: l, right: l }, rows: [{ c: { ...byId('foley.feet.A.05'), id, source, person, category: 'foley' }, onset: 1 }] };
  };
  const three = [mk('a', 'A:feet', 'A'), mk('b', 'B:feet', 'B'), mk('c', 'car:door:driver', null)];
  assert.equal(densityEntry(three, INPUT).status, 'pass');
  assert.equal(densityEntry([...three, mk('d', 'C:feet', 'C')], INPUT).status, 'fail');
});

// a made-up story cue for the phone and masking measures: the first step (it has an SDH caption), its samples a tone
const storyOf = (hz, sign = 1, masker = 0) => {
  const c = CUES.find((x) => x.family === 'feet' && x.sdh !== null), n = Math.round(c.t1 * SR) + SR, l = new Float32Array(n), r = new Float32Array(n);
  for (let i = Math.round(c.t0 * SR); i < Math.round(c.t1 * SR); i++) { l[i] = 0.1 * Math.sin(2 * Math.PI * hz * i / SR); r[i] = sign * l[i]; }
  const stem = { sr: SR, left: l, right: r }, pre = { sr: SR, left: Float32Array.from(l), right: Float32Array.from(r) }, rng = mulberry32(5);
  for (let i = 0; i < n; i++) { const v = masker * (rng() * 2 - 1); pre.left[i] += v; pre.right[i] += v; }
  const row = { c, src: stem, window: loudestWindow(stem, c.t0, c.t1), spanEnd: c.t1 };
  return maskingAndPhone([row], { pre, stemOf: () => stem, groups: [c.source], input: { ...INPUT, cues: [c] }, streetDb: -30, predicted: new Map() });
};
test('phone and mono measure: a 1 kHz story cue passes; one at 120 Hz lives only below 250 Hz, an anti-phase one only in the side', () => {
  assert.equal(storyOf(1000).phone.status, 'pass');
  assert.deepEqual(storyOf(120).phone.rows.map((x) => x.flag), ['only below 250 Hz']);
  assert.deepEqual(storyOf(1000, -1).phone.rows.map((x) => x.flag), ['only in the side channel']);
  assert.equal(storyOf(120).phone.status, 'fail');
});

test('masking measure: a cue alone stands out in its band; under loud broadband noise it is at risk', () => {
  const alone = storyOf(1000).masking.rows[0], noisy = storyOf(1000, 1, 1).masking.rows[0];
  assert.deepEqual([alone.atRisk, alone.bestBand], [false, 1000]);
  assert.equal(noisy.atRisk, true);
});

test('determinism and stems measures: the same render twice passes, one changed sample fails; a group left out of the sum fails', () => {
  const a = groupOf('A:feet'), b = groupOf('A:feet');
  assert.equal(determinismEntry(a, b).status, 'pass');
  const c = { ...b, left: Float32Array.from(b.left) }; c.left[1000] += 1e-7;
  assert.equal(determinismEntry(a, c).status, 'fail');
  const two = ['A:feet', 'B:feet'], pre = preMaster([...quiet, ...CUES.filter((x) => two.includes(x.source) && x.voices > 0)]);
  assert.equal(stemsEntry(two, (g) => session.group(g), pre).status, 'pass');
  assert.equal(stemsEntry(['A:feet'], (g) => session.group(g), pre).status, 'fail');
});

test('level measure: a tick planted 6 dB louder is measured 6 dB louder, and so is its prediction', () => {
  const g = 'car:engine-bay', c = byId('hard.tick.car.03'), loud = { ...c, level: c.level + 6 };
  const beds = { sr: SR, left: new Float32Array(Math.round(T_TOTAL * SR)), right: new Float32Array(Math.round(T_TOTAL * SR)) }, hear = (x, t) => INPUT.hear(x, t, 'camera');
  const at = (rows) => levelEntry(rows, { streetDb: -30, beds, hear }).rows.find((x) => x.cue === c.id);
  const real = at(measureGroup(session, g).rows), planted = at(measureGroup(session, g, { stem: groupOf(g, [loud]), own: own(g).map((x) => (x.id === c.id ? loud : x)) }).rows);
  assert.ok(Math.abs(planted.overStreetDb - real.overStreetDb - 6) < 0.01, `${planted.overStreetDb} against ${real.overStreetDb}`);
  assert.ok(Math.abs(planted.predictedDb - real.predictedDb - 6) < 1e-6 && Math.abs(planted.diffDb - real.diffDb) < 0.01);
});

test('loudness target: the loudest target whose 400 ms windows lose at most 1 dB is chosen; configured louder, the measure fails', () => {
  // a quiet bed and a loud second of 1 ms pulses every 50 ms: at the louder targets the limiter holds every pulse and,
  // releasing over 120 ms, never recovers between them (a pumped second); at the quieter ones it leaves them alone
  const n = 6 * SR, rng = mulberry32(11), raw = { sr: SR, left: new Float32Array(n), right: new Float32Array(n) };
  for (let i = 0; i < n; i++) { const t = i / SR, pulse = t >= 2 && t < 3 && (i % (SR / 20)) < SR / 1000; raw.left[i] = pulse ? 0.2 : 0.005 * (rng() * 2 - 1); raw.right[i] = pulse ? 0.2 : 0.005 * (rng() * 2 - 1); }
  const sweep = targetSweep({ raw, peaks: null, audio: BLOCKOUT.audio, street: raw, hush: [4, 6] });
  const first = sweep.rows.findIndex((x) => x.meets);
  assert.ok(first > 0, 'the louder targets pump the loud second');
  assert.equal(sweep.chosen, sweep.rows[first]);
  assert.ok(sweep.rows.slice(0, first).every((x) => x.worstWindowDb > 1) && sweep.rows[first].worstWindowDb <= 1);
  assert.equal(sweep.rows[sweep.rows.length - 1].limitedSamples, 0, 'the sweep runs until nothing is limited');
  assert.equal(targetEntry(sweep, sweep.chosen.target).status, 'pass');
  assert.equal(targetEntry(sweep, sweep.chosen.target + 0.5).status, 'fail', 'control: a target louder than the rule allows');
});

test('drift measure: a design onset 30 ms late reads +30 ms, one not played is missing, an onset with no cue is extra', () => {
  const tick = byId('hard.tick.car.03'), cues = [1, 2, 3].map((t, k) => ({ ...tick, id: `drift.${k}`, sync: t, t0: t, t1: t + 0.06 }));
  const n = 5 * SR, l = new Float32Array(n);
  for (const t of [1.03, 2, 4]) for (let i = 0; i < 0.005 * SR; i++) l[Math.round(t * SR) + i] = 0.5 * Math.sin(i);
  const part = { name: 'ticks', plays: (c) => c.family === 'tick' }, e = driftEntry(cues, () => ({ sr: SR, left: l, right: l }), [part]);
  assert.deepEqual(e.rows.map((x) => [x.cue, x.status, x.driftMs === null ? null : Math.round(x.driftMs)]), [['drift.0', 'matched', 30], ['drift.1', 'matched', 0], ['drift.2', 'missing', null], [null, 'extra', null]]);
  assert.equal(driftTol([1, 2, 3]), 0.5); assert.ok(Math.abs(driftTol([1, 1.2]) - 0.1) < 1e-12);
});
