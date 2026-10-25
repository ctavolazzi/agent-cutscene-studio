// Sound 2.6 and 2.7: the blockout's review round, the sound twin of scripts/blockout-review.js. One session renders the
// blockout once and each stem once (memoised for the run), and every step reads from it:
//   --measure  the measurements of SOUND-PLAN 4.5 into review/round-NN/measure.json; the measuring stems, one per voice
//              group (float WAV, out/round-NN/stems/, not committed); the listening stems, one per body (AAC,
//              review/round-NN/stems/ with stems.json); the parked design layers' drift (Sound 2.7); the blockout's
//              loudness target, chosen by measurement (the sweep in measure.json, the value in src/config.js)
//   --stills, --sheet  the audio stills and the arrangement sheet (Sound 2.9): steps to add here, on the same session,
//              reading measure.json's table, bands and series (the shape below)
// Usage: node scripts/sound-review.js --round 05 --measure
//
// measure.json:
//   { round, stage, parked, seed, sr, seconds, targetLufs, gainDb, cues, voiced, streetDb,
//     hush:     [t0, t1]                                      the run-down's end to the end of the shot after it (s)
//     groups:   [{ source, body, category, cues, file }]      each voice group, and its measuring stem under out/
//     renders:  { raw, again, mastered: { sha256, stats } }   the blockout before the master's normalization (twice) and after
//     measures: [entry]                                       one per measure of SOUND-PLAN 4.5, numbered in its order
//     table:    { columns, rows }                             one row per voiced cue: everything measured on it. `onset`
//               is the first sample that is not zero of the cue rendered alone (the renderer measure checks that each
//               group's stem is the sum of its cues alone); `read` says where its end and loudest window are read: its
//               group's stem, or its own render alone
//     bands:    { nominal: [Hz], cues: { [id]: { t, cue: [dB], masker: [dB] } } }   third octaves of each cue's loudest
//               100 ms and of everything else sounding in it (Infinity-free: a silent band is null)
//     series:   { hopSec, momentary: { windowSec, firstEnd, lufs }, shortTerm: { ... } }   the mastered mix, every 100 ms;
//               lufs[k] is the window ending at firstEnd + k * hopSec, null where silent }
//   entry = { id, n, name, definition, bar, source, starting, status: 'pass' | 'fail' | 'report', summary, columns,
//             rows }: storyboard/sound/report.json's check shape plus `source`, where its bar comes from. A row value is
//             a string, number, boolean or null, and a row that names a cue keys it `cue`.
//   Levels are dB of both channels' power summed, measured before the master stage (preMaster: the bus sum of the
//   voices, no reverb, highpass or fades), so they are the voices' own and not the limiter's; `overStreetDb` is against
//   the street background measured the same way (the level plan's 0 dB, SOUND-PLAN 1.3). The loudness series and
//   the loudness target are measured on the full render (reverb and master chain), raw and normalized.
// Deterministic: no clock is written; the same code gives the same files.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { CONFIG } from '../src/config.js';
import { CUES, DESIGN, LAWS, LOCATIONS } from '../src/audio/cues.js';
import { atStage, renderSoundtrack } from '../src/audio/index.js';
import { LEVEL, TIMBRE } from '../src/audio/layers/blockout/timbre.js';
import { bedSpan } from '../src/audio/layers/blockout/voices.js';
import { integratedLufs, normalize, samplePeak, targetOf, truePeakEnvelope } from '../src/audio/loudness.js';
import { BLOCK } from '../src/audio/mix.js';
import { placeAt } from '../src/audio/spatial.js';
import { encodeWav } from '../src/audio/wav.js';
import { hashString, mulberry32 } from '../src/prng.js';
import { SHOTS, shotAt } from '../src/shots.js';
import { carTimes, FPS, T_TOTAL } from '../src/world.js';
import * as A from './lib/audio-analysis.mjs';
import { alignment, decodeAudio } from './lib/ffmpeg.mjs';
import { allocate, maskingBed, safeBand } from './lib/sound-checks.js';
import { buildInput, syncRule } from './sound-report.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// the config at the blockout stage, parked as the config has it: what the review measures
export const BLOCKOUT = atStage(CONFIG, { stage: 'blockout' });
// the parked design layers, score parked (Sound 2.7): ambience, car, foley
export const DESIGN_PARKED = atStage(CONFIG, { stage: 'design', parked: ['score'] });

// The bars and the measuring choices, each with where it comes from. A starting value is labelled one.
export const BARS = Object.freeze({
  onsetSec: { v: 0.005, starting: false, source: 'ROADMAP Sound 2.6 and SOUND-PLAN 4.5: the renderer, onsets against cue times, every voiced cue (the S8.2 layers reached it)' },
  panDb: { v: 0.5, starting: false, source: 'SOUND-PLAN 4.5: today\'s car test; S8.2 measured 0.11 dB' },
  sumRatio: { v: 1e-6, starting: true, source: 'tests/sound-blockout.test.mjs: the stems against the mix measured one float32 step (1.3e-7 of the peak); about eight steps' },
  limiterDb: { v: 1, starting: true, source: 'Sound 2.6: a click limited for a few ms is not a level change, a pumped idle is; 1 dB in any 400 ms window' },
  endFloorDb: { v: 60, starting: false, source: 'the decay RT60 measures: a voice has stopped 60 dB under its loudest sample' },
  bandSpanDb: { v: 10, starting: true, source: 'a cue\'s measured band: the third octaves within 10 dB of its loudest one' },
  sideDb: { v: 3, starting: true, source: 'a cue lives in the side channel when its side carries 3 dB more than its mid (a hard-panned source carries both equally)' },
  windowSec: { v: LEVEL.windowSec, starting: false, source: 'the level plan\'s 100 ms window (SOUND-PLAN 1.3, src/audio/layers/blockout/timbre.js LEVEL.windowSec)' },
  sweepFromLufs: { v: -16, starting: false, source: 'SOUND-PLAN 3.18: integrated loudness kept at or under -16 LUFS' },
  sweepStepDb: { v: 0.5, starting: false, source: 'Sound 2.6: the sweep\'s step' },
});
const r = (x, d = 3) => (x === null || x === undefined || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);
const bar = (k) => `${BARS[k].v}${BARS[k].starting ? ' (starting value)' : ''}`;
const sha = (...arrays) => { const h = createHash('sha256'); for (const a of arrays) h.update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)); return h.digest('hex'); };
const pad2 = (n) => String(n).padStart(2, '0');
// one entry of measure.json; every row carries exactly the columns, a missing value as null
function entry(id, n, name, definition, barText, source, starting, status, summary, columns, rows) {
  for (const x of rows) for (const k of Object.keys(x)) if (!columns.includes(k)) throw new Error(`${id}: a row has ${k}, not a column`);
  return { id, n, name, definition, bar: barText, source, starting, status, summary, columns, rows: rows.map((x) => Object.fromEntries(columns.map((k) => [k, x[k] ?? null]))) };
}

// The detector's gap within one voice group (tests/sound-blockout.test.mjs): half the group's closest cue times, at
// most onsets()'s 80 ms, never under cues.js's flam merge. Cues of other groups are on other stems, so the gap never
// joins two sources (A's and B's steps 3.8 ms apart at 56.34 are measured apart).
export const minGapOf = (own, flam = DESIGN.STEP.flam) => Math.max(flam, Math.min(0.08, ...own.slice(1).map((c, i) => (c.t0 - own[i].t0) / 2)));
// The body a voice group belongs to, for the listening stems: the night (the backgrounds and the lamp's hum), or the
// group's own first word (car, A, B), so the stems are what the voice groups really give
export const bodyOf = (source) => (source.startsWith('bg:') || source === 'lamp' ? 'night' : source.split(':')[0]);

// Parts against the whole they should sum to (a group's cues alone and its stem, the voice groups and the mix before
// the master, the bodies and the raw mix): the largest difference in either channel over the whole's peak, and where
// (s); and the difference's power under the whole's, in dB. A part may be shorter than the whole (zeros after it).
export function sumAgainst(parts, whole) {
  const n = whole.left.length, L = new Float64Array(n), R = new Float64Array(n);
  for (const p of parts) for (let i = 0; i < Math.min(n, p.left.length); i++) { L[i] += p.left[i]; R[i] += p.right[i]; }
  let worst = 0, peak = 0, at = 0, e = 0, w = 0;
  for (let i = 0; i < n; i++) {
    const dl = L[i] - whole.left[i], dr = R[i] - whole.right[i], d = Math.max(Math.abs(dl), Math.abs(dr));
    if (d > worst) { worst = d; at = i; }
    peak = Math.max(peak, Math.abs(whole.left[i]), Math.abs(whole.right[i]));
    e += dl * dl + dr * dr; w += whole.left[i] * whole.left[i] + whole.right[i] * whole.right[i];
  }
  return { worst, peak, ratio: peak > 0 ? worst / peak : worst > 0 ? Infinity : 0, at: at / whole.sr, errorDb: e > 0 ? 10 * Math.log10(e / (w || 1e-30)) : -Infinity };
}

// ---------- the session: every render once ----------
// The first sample that is not zero of a render, in seconds (null when silent)
const firstSound = (s) => { const z = A.nonzeroSpan(s); return z ? z[0] / s.sr : null; };
export function makeSession({ config = BLOCKOUT, cues = CUES, log = console.log } = {}) {
  const memo = new Map(), once = (k, f) => { if (!memo.has(k)) memo.set(k, f()); return memo.get(k); };
  const sr = config.audio.sr, quiet = cues.filter((c) => c.voices === 0), voiced = cues.filter((c) => c.enabled && c.voices > 0);
  const groups = [...new Set(voiced.map((c) => c.source))];
  const copy = (s) => ({ sr: s.sr, left: Float32Array.from(s.left), right: Float32Array.from(s.right) });
  const of = (pred) => [...quiet, ...voiced.filter(pred)];
  // per cue, keyed by the cue itself (a changed copy is another cue): its render alone, kept only for the cues read
  // alone (s.alone), and its onset (s.onsetOf), for every cue
  const renders = new WeakMap(), onsets = new WeakMap();
  const render = (c) => renders.get(c) ?? A.preMaster([...quiet, c], config);
  const s = {
    config, cues, sr, log, quiet, voiced, groups,
    own: (g) => voiced.filter((c) => c.source === g).sort((a, b) => a.t0 - b.t0 || (a.id < b.id ? -1 : 1)),
    // the full render before the master's normalization (reverb, highpass, fades), twice for determinism
    raw: () => once('raw', () => renderSoundtrack(config, { cues, normalize: false })),
    again: () => once('again', () => renderSoundtrack(config, { cues, normalize: false })),
    peaks: () => once('peaks', () => truePeakEnvelope(s.raw().left, s.raw().right)),
    // normalized at the stage's target, as renderSoundtrack would
    mastered: () => once('mastered', () => { const m = copy(s.raw()); m.stats = normalize(m.left, m.right, config.audio, sr, 4, s.peaks()); return m; }),
    // before the master: everything, one voice group, one cue alone (kept), the unplaced backgrounds
    pre: () => once('pre', () => A.preMaster(cues, config)),
    group: (g) => once(`group:${g}`, () => A.preMaster(of((c) => c.source === g), config)),
    alone: (c) => { if (!renders.has(c)) renders.set(c, A.preMaster([...quiet, c], config)); return renders.get(c); },
    // a cue's onset: the first sample that is not zero of the cue rendered alone, where its voice starts (every voice
    // starts from zero, so one sample after its start); a render made only for this is not kept (142 would hold 6 GB)
    onsetOf: (c) => { if (!onsets.has(c)) onsets.set(c, firstSound(render(c))); return onsets.get(c); },
    // the sum of a voice group's cues rendered alone (float64, both channels), which its stem must equal if no voice
    // leaks into another; each cue's onset is kept on the way
    aloneSum: (g) => once(`sum:${g}`, () => {
      const n = Math.round(T_TOTAL * sr), left = new Float64Array(n), right = new Float64Array(n);
      for (const c of s.own(g)) { const a = render(c); if (!onsets.has(c)) onsets.set(c, firstSound(a)); for (let i = 0; i < n; i++) { left[i] += a.left[i]; right[i] += a.right[i]; } }
      return { sr, left, right };
    }),
    // a cue rendered alone: its kept render, or one made for the call and not kept (a cue played otherwise, a plant);
    // its onset is kept on the way
    renderAlone: (c) => { const a = render(c); if (!onsets.has(c)) onsets.set(c, firstSound(a)); return a; },
    beds: () => once('beds', () => A.preMaster(of((c) => c.category === 'bg' && !c.place), config)),
    // the full render of some voice groups (a body, the street background) before normalization, reverb included
    renderOf: (key, pred) => once(`render:${key}`, () => renderSoundtrack(config, { cues: of(pred), normalize: false })),
  };
  return s;
}

// ---------- one voice group measured: onsets, ends, the loudest window, pan ----------
const LOOK_SEC = 0.05; // a continuous voice is read on its group's stem only if the stem is silent this long before it
// Where a cue's voice should start: its t0, or for an unplaced background the first sample bedSpan gives it (half the
// crossfade early, on purpose: voices.js)
export const startOf = (c, sr) => (c.place ? c.t0 : bedSpan(c, sr)[0] / sr);

// A group's stem against the sum of its cues rendered alone, as the renderer played them (`rendered`): the largest
// difference in either channel over the stem's peak, and where. It starts from the session's sum of its own cues and
// adds or takes away each cue played or listed otherwise, so a plant costs a render or two, not the group's.
function sumCheck(session, g, rendered, stem) {
  const base = session.own(g), inBase = new Set(base), inNow = new Set(rendered), sum = session.aloneSum(g);
  const add = rendered.filter((c) => !inBase.has(c)), sub = base.filter((c) => !inNow.has(c));
  let { left, right } = sum;
  if (add.length || sub.length) {
    left = Float64Array.from(left); right = Float64Array.from(right);
    for (const [list, k] of [[add, 1], [sub, -1]]) {
      for (const c of list) { const a = session.renderAlone(c); for (let i = 0; i < left.length; i++) { left[i] += k * a.left[i]; right[i] += k * a.right[i]; } }
    }
  }
  return sumAgainst([{ left, right }], stem);
}

// Each voiced cue of group g as the cue list has it (`own`), measured before the master:
//   onset   the first sample that is not zero of the cue rendered alone, as the renderer played it (session.onsetOf):
//           where its voice starts, whatever sounds with it. Not the detector: on a tail that is still sounding it
//           fires again every minGap, and the next cue's onset then reads a re-fire (round 05's checker found 5 of the
//           93 one-shots passing with their audio moved 6 ms early that way). That each onset read alone is where the
//           stem plays it is the group's `sum`: the stem against the sum of its cues alone
//   end     soundingEnd from the onset to the next cue of the group (or the end), BARS.endFloorDb
//   window  the loudest 100 ms of its own samples (to its t1 and the ring: events.js drops a voice in the block it ends
//           in, so its lowpass rings on to that block's end) and its level; for an unplaced background
//           its level over its span between its crossfades, as the level rule sets it (voices.js)
//   read    where the end and the window are read: 'stem', the group's stem up to the next cue of the group; or
//           'alone', the cue's own render, for a continuous voice that follows another of its group with less than
//           LOOK_SEC of silence (the engine's idle after the drive) and an unplaced background (crossfaded into the next
//           of its family)
// The detections (preciseOnsets on the stem, the group's gap) are for the strays and the silence windows.
// Options for the tests: another cue list (`own`); cues the renderer played in place of the list's (`played`, by id: a
// misplaced cue, whose render alone and the stem both move); another stem (one that is not the sum of its cues).
export function measureGroup(session, g, { own = session.own(g), played = [], stem = null } = {}) {
  const sr = session.sr, ring = BLOCK / sr, swap = new Map(played.map((p) => [p.id, p])), rendered = own.map((c) => swap.get(c.id) ?? c);
  stem ??= played.length ? A.preMaster([...session.quiet, ...rendered], session.config) : session.group(g);
  const sum = sumCheck(session, g, rendered, stem), det = A.preciseOnsets(stem.left, stem.right, sr, { minGap: minGapOf(own) });
  const rows = own.map((c, i) => {
    const p = rendered[i], next = own[i + 1], winEnd = next ? next.t0 : T_TOTAL;
    const alone = c.shape !== 'oneshot' && (!c.place || A.nonzeroSpan(stem, A.idx(c.t0 - LOOK_SEC, sr), A.idx(c.t0, sr)) !== null);
    const src = alone ? session.alone(p) : stem, limit = alone ? T_TOTAL : winEnd, onset = session.onsetOf(p);
    const e = A.soundingEnd(src, onset ?? c.t0, limit, BARS.endFloorDb.v);
    const spanEnd = Math.min(c.t1 + ring, limit), h = TIMBRE.crossfadeSec / 2;
    const w = c.place ? A.loudestWindow(src, c.t0, spanEnd, BARS.windowSec.v) : { t: c.t0 + h, db: A.powerDb(src, c.t0 + h, c.t1 - h) };
    return { c, src, read: alone ? 'alone' : 'stem', onset, expected: startOf(c, sr), end: e?.end ?? null, last: e?.last ?? null, window: w, spanEnd };
  });
  return { g, stem, detections: det, sum, rows };
}

// the predicted pan (spatial.js placeAt, the cue's law) of a placed cue at t: fixed where it starts for an 'onset' one
const panOf = (c) => { const p0 = c.placement === 'onset' ? c.place(c.t0) : null; return (t) => { const q = p0 ?? c.place(t); return q ? placeAt(q, t, undefined, LAWS[c.law]).pan : 0; }; };

// ---------- the measures, each an entry of measure.json ----------
// 1 the renderer: every voiced cue's onset (measureGroup: the first sample of its own render) against where its voice
// should start (startOf); each group's stem against the sum of its cues alone; and no detection on a stem where no cue
// of its group sounds (from each cue's start to its end and the ring, within the onset bar)
export function rendererEntry(measured) {
  const rows = [], tol = BARS.onsetSec.v;
  for (const { g, rows: cs, detections, sum } of measured) {
    for (const x of cs) {
      const d = x.onset === null ? null : x.onset - x.expected, ok = d !== null && Math.abs(d) <= tol;
      rows.push({ kind: 'onset', cue: x.c.id, group: g, shape: x.c.shape, expected: r(x.expected, 6), onset: r(x.onset, 6), diffMs: d === null ? null : r(d * 1000), ok, note: ok ? null : d === null ? 'silent alone' : `${r(Math.abs(d) * 1000, 3)} ms ${d > 0 ? 'late' : 'early'}, past ${tol * 1000} ms` });
    }
    const sok = sum.ratio <= BARS.sumRatio.v;
    rows.push({ kind: 'sum', cue: null, group: g, sumRatio: Number.isFinite(sum.ratio) ? Number(sum.ratio.toExponential(3)) : null, at: r(sum.at, 6), ok: sok, note: sok ? null : `the stem is not the sum of its cues alone: ${sum.ratio.toExponential(2)} of its peak at ${r(sum.at, 4)} s` });
    for (const t of detections) if (!cs.some((x) => t >= x.expected - tol && t < x.spanEnd + tol)) rows.push({ kind: 'stray', cue: null, group: g, onset: r(t, 6), ok: false, note: 'an onset where no cue of its group sounds' });
  }
  const on = rows.filter((x) => x.kind === 'onset'), sums = rows.filter((x) => x.kind === 'sum'), bad = rows.filter((x) => !x.ok).length;
  const worstMs = Math.max(0, ...on.filter((x) => x.diffMs !== null).map((x) => Math.abs(x.diffMs))), worstSum = Math.max(0, ...sums.map((x) => x.sumRatio ?? Infinity));
  return entry('renderer', 1, 'Renderer', 'Every voiced cue\'s onset, the first sample that is not zero of the cue rendered alone before the master (where its voice starts, whatever sounds with it), against its cue time (an unplaced background against the first sample bedSpan gives it, half the crossfade early); each voice group\'s stem against the sum of its cues rendered alone, so each onset read alone is where the stem plays it and no voice leaks into another or sounds where no cue is; and no detection on the stem (preciseOnsets, the group\'s gap) outside every cue span of its group. A renderer test, not sync. The onsets are not the detector\'s: on a tail that is still sounding it fires again every minGap', `Within ${bar('onsetSec')} s; each stem the sum of its cues alone within ${bar('sumRatio')} of its peak`, `${BARS.onsetSec.source}; the sum: ${BARS.sumRatio.source}`, BARS.onsetSec.starting || BARS.sumRatio.starting, bad ? 'fail' : 'pass', `${on.length} voiced cues (${on.filter((x) => x.shape === 'oneshot').length} one-shots), ${on.filter((x) => x.ok).length} within ${tol * 1000} ms of their start (worst ${r(worstMs, 3)} ms); ${sums.filter((x) => x.ok).length} of ${sums.length} group stems the sum of their cues alone (worst ${worstSum.toExponential(2)} of the peak); ${rows.filter((x) => x.kind === 'stray').length} onsets outside their group's cues`, ['kind', 'cue', 'group', 'shape', 'expected', 'onset', 'diffMs', 'sumRatio', 'at', 'ok', 'note'], rows);
}

// How late an onset read alone can be against its cue time: the first sample that is not zero is the one after its
// voice's start (every voice starts from zero), and the start is the cue time rounded to the sample: 1.5 samples
export const readLagSec = (sr) => 1.5 / sr;
// 2 sync: each sync cue's measured onset against the first frame that shows its event (check 4's rule and bar)
export function syncEntry(table, input, rule = syncRule) {
  const T = input.thresholds, opts = { fps: FPS, search: T.syncSearch.v, ahead: T.syncAhead.v }, rows = [];
  let judged = 0, bad = 0;
  for (const x of table) {
    const c = x.c, rl = c.category === 'bg' ? null : rule(c);
    if (!rl) continue;
    if (rl.reason) { rows.push({ cue: c.id, family: c.family, event: null, t0: r(c.t0, 6), onset: r(x.onset, 6), frame: null, aheadMs: null, leadMs: r(c.lead * 1000, 2), ok: null, cueOk: null, note: `not judged: ${rl.reason}` }); continue; }
    judged++;
    const at = x.onset === null ? null : A.syncOf(rl, x.onset, c.lead, opts), cue = A.syncOf(rl, c.t0, c.lead, opts);
    const ok = at ? at.ok : false;
    if (!ok) bad++;
    // an instant on its frame's own time passes on its cue time with 0 ms to spare, and its onset, read one sample
    // after its voice's start, then reads after the frame: within the reading's lag, and only then, that is the note
    const lagMs = readLagSec(x.src.sr) * 1000, edge = !ok && cue.ok && at && at.pastMs < 0 && -at.pastMs <= lagMs + 1e-6 && Math.abs(cue.pastMs) < 1e-6;
    rows.push({ cue: c.id, family: c.family, event: rl.event, t0: r(c.t0, 6), onset: r(x.onset, 6), frame: at ? r(at.frame, 6) : null, aheadMs: at ? r(at.aheadMs, 2) : null, leadMs: r(c.lead * 1000, 2), ok, cueOk: cue.ok, note: at ? (edge ? `${at.note}: its instant is on the frame's own time (0 ms ahead on its cue time), and its onset trails that by the reading's lag (at most ${r(lagMs, 4)} ms: a voice's first sample is zero)` : at.note) : 'no measured onset' });
  }
  const flips = rows.filter((x) => x.ok !== null && x.ok !== x.cueOk).length, edges = rows.filter((x) => /on the frame's own time/.test(x.note ?? '')), late = edges.map((x) => -x.aheadMs);
  return entry('sync', 2, 'Sync with the picture', 'Each sync cue\'s measured onset (the first sample of the cue rendered alone, the renderer measure\'s) against the first frame that shows its event, the picture\'s own state functions sampled at frame times (scripts/sound-report.js syncRule, sound-checks showingFrame); cueOk is check 4\'s verdict on the cue time. Modifiers have no voice and are not listed', `Onset 0 to ${T.syncAhead.v} s ahead of that frame (starting value), past its named lead; audio after the frame fails`, 'ITU-R BT.1359 via SOUND-PLAN 3.3 and check 4 (secondary)', T.syncAhead.starting, bad ? 'fail' : 'pass', `${judged} judged, ${bad} off their frame: ${bad - edges.length} miss on their cue times too (check 4's), ${edges.length} have their instant on the frame's own time and read ${late.length ? `${r(Math.min(...late), 2)} to ${r(Math.max(...late), 2)}` : 'no'} ms after it, the reading's lag (${flips} judged otherwise than on their cue times); ${rows.length - judged} not judged (no event the picture shows)`, ['cue', 'family', 'event', 't0', 'onset', 'frame', 'aheadMs', 'leadMs', 'ok', 'cueOk', 'note'], rows);
}

// 3 cue ends: where each voice stops sounding against its t1
export function endsEntry(table) {
  const rows = table.map((x) => ({ cue: x.c.id, family: x.c.family, shape: x.c.shape, t1: r(x.c.t1, 6), end: r(x.end, 6), endMs: x.end === null ? null : r((x.end - x.c.t1) * 1000, 2), last: r(x.last, 6), read: x.read, note: x.end === null ? 'silent' : null }));
  const d = rows.filter((x) => x.endMs !== null).map((x) => x.endMs).sort((a, b) => a - b);
  return entry('ends', 3, 'Cue ends', `Where each cue's own voice stops sounding, in its voice group's stem or alone (read): just after its last sample within ${BARS.endFloorDb.v} dB of its loudest (end), and just after its last sample that is not zero (last, the spatializer's ring), against its t1`, 'Reported', BARS.endFloorDb.source, false, 'report', `${rows.length} voices; end minus t1 from ${d[0]} to ${d[d.length - 1]} ms, median ${d[Math.floor(d.length / 2)]} ms`, ['cue', 'family', 'shape', 't1', 'end', 'endMs', 'last', 'read', 'note'], rows);
}

// 4 pan: each cue's balance in its own stem window against what its placement predicts (a background against centre)
export function panEntry(table, stemOf) {
  const rows = table.map((x) => {
    const c = x.c, s = stemOf(c.source), got = A.balanceDb(s.left, s.right, s.sr, c.t0, c.t1), want = c.place ? A.predictedBalanceDb(s, c.t0, c.t1, panOf(c)) : 0;
    return { cue: c.id, family: c.family, balanceDb: r(got), predictedDb: r(want), diffDb: r(got - want), ok: Math.abs(got - want) <= BARS.panDb.v };
  });
  const bad = rows.filter((x) => !x.ok).length, worst = rows.reduce((m, x) => Math.max(m, Math.abs(x.diffDb)), 0);
  return entry('pan', 4, 'Pan', 'Each voiced cue\'s balance (right over left, dB) over its span in its voice group\'s stem, against its placement\'s prediction (spatial.js placeAt under its law, weighted by the stem\'s energy each millisecond); an unplaced background against the centre', `Within ${bar('panDb')} dB`, BARS.panDb.source, BARS.panDb.starting, bad ? 'fail' : 'pass', `${rows.length} cues, ${bad} off; the worst ${r(worst)} dB`, ['cue', 'family', 'balanceDb', 'predictedDb', 'diffDb', 'ok'], rows);
}

// 5 level per cue: the loudest 100 ms against the street background, the prediction and the beds sounding with it
export function levelEntry(table, { streetDb, beds, hear }) {
  const rows = table.map((x) => {
    const c = x.c, w = x.window;
    if (!w) return { cue: c.id, family: c.family, t: null, levelDb: null, overStreetDb: null, predictedDb: null, diffDb: null, overBedDb: null };
    const tc = Math.min(c.t1 - 1e-6, Math.max(c.t0, w.t + BARS.windowSec.v / 2)), h = hear(c, tc), bed = A.powerDb(beds, w.t, w.t + BARS.windowSec.v), over = w.db - streetDb;
    return { cue: c.id, family: c.family, t: r(w.t, 3), levelDb: r(w.db, 2), overStreetDb: r(over, 2), predictedDb: h ? r(h.db, 2) : null, diffDb: h ? r(over - h.db, 2) : null, overBedDb: c.category === 'bg' ? null : r(w.db - bed, 2) };
  });
  const d = rows.filter((x) => x.diffDb !== null).map((x) => x.diffDb).sort((a, b) => a - b);
  const fg = rows.filter((x) => x.overBedDb !== null);
  return entry('level', 5, 'Level per cue', 'Each voiced cue\'s loudest 100 ms (both channels\' power) on its stem before the master, against the street background measured the same way (overStreetDb), against the prediction (the level plan\'s level, its law at the camera and its modifiers at the window\'s middle: sound-report hear, which leaves out the air lowpass), and against the beds sounding in that window (overBedDb)', 'Reported, not gated: placeholders have no real spectrum (SOUND-PLAN 4.4)', 'SOUND-PLAN 4.4 and 4.5', false, 'report', `${rows.length} cues; measured minus predicted from ${d[0]} to ${d[d.length - 1]} dB, median ${d[Math.floor(d.length / 2)]} dB; ${fg.filter((x) => x.overBedDb >= 6).length} of ${fg.length} non-background cues 6 dB or more over the beds in their loudest 100 ms`, ['cue', 'family', 't', 'levelDb', 'overStreetDb', 'predictedDb', 'diffDb', 'overBedDb'], rows);
}

// 6 loudness over time: momentary and short-term per shot, on the mastered mix
export function loudnessEntry(mastered, shots = SHOTS) {
  const m = A.momentary(mastered), s = A.shortTerm(mastered), rows = [];
  for (const sh of shots) {
    const a = A.seriesSummary(m, sh.start, sh.end), b = A.seriesSummary(s, sh.start, sh.end), i0 = A.idx(sh.start, mastered.sr), i1 = A.idx(sh.end, mastered.sr);
    rows.push({ shot: sh.n, start: sh.start, end: sh.end, mMax: r(a.max, 2), mMedian: r(a.median, 2), mMin: r(a.min, 2), sMax: r(b.max, 2), sMedian: r(b.median, 2), sMin: r(b.min, 2), integrated: r(integratedLufs(mastered.left.subarray(i0, i1), mastered.right.subarray(i0, i1), mastered.sr), 2) });
  }
  const top = rows.reduce((x, y) => ((y.mMax ?? -Infinity) > (x.mMax ?? -Infinity) ? y : x));
  return { series: { m, s }, entry: entry('loudness', 6, 'Loudness over time', 'Momentary (400 ms) and short-term (3 s) loudness of the mastered blockout, K-weighted and ungated (EBU Tech 3341), every 100 ms: per shot the largest, median and smallest reading of the windows inside it, and the shot\'s own integrated loudness (gated)', 'Reported per shot', 'SOUND-PLAN 4.5', false, 'report', `the loudest momentary ${top.mMax} LUFS in shot ${top.shot}; short-term medians from ${Math.min(...rows.map((x) => x.sMedian ?? Infinity))} to ${Math.max(...rows.map((x) => x.sMedian ?? -Infinity))} LUFS`, ['shot', 'start', 'end', 'mMax', 'mMedian', 'mMin', 'sMax', 'sMedian', 'sMin', 'integrated'], rows) };
}

// 7 silence: no measured onset (a detection, or a continuous voice's first sample) of a hard or foley group inside a
// bed-only window
export function silenceEntry(measured, input) {
  const S = input.silence, rows = [];
  let bad = 0;
  for (const w of S.windows) {
    const hits = [];
    for (const { g, rows: cs, detections } of measured) {
      if (!cs.some((x) => S.select(x.c))) continue;
      const times = [...detections, ...cs.filter((x) => x.c.shape !== 'oneshot' && x.onset !== null).map((x) => x.onset)];
      for (const t of times) if (t >= w.t0 && t < w.t1) hits.push({ g, t });
    }
    rows.push({ window: w.name, t0: r(w.t0, 3), t1: r(w.t1, 3), group: null, onset: null, onsets: hits.length });
    for (const h of hits.sort((a, b) => a.t - b.t)) { bad++; rows.push({ window: w.name, t0: r(w.t0, 3), t1: r(w.t1, 3), group: h.g, onset: r(h.t, 6), onsets: null }); }
  }
  return entry('silence', 7, 'Silence windows', 'No measured onset of a hard-effect or foley voice group (every detection on its stem, and each continuous voice\'s first sample) inside a declared bed-only window (scripts/sound-report.js, SOUND-PLAN 3.11)', 'Any onset fails', 'SOUND-PLAN 3.11, check 13', false, bad ? 'fail' : 'pass', `${S.windows.length} windows, ${bad} onsets inside`, ['window', 't0', 't1', 'group', 'onset', 'onsets'], rows);
}

// 8 voices: the PS1 count on the measured spans (onset to end), with check 12's allocator. Two unplaced backgrounds of
// one family overlapping by no more than the place change's crossfade (TIMBRE.crossfadeSec) are the crossfade the
// blockout plays on purpose (SOUND-PLAN 3.5), listed as kind 'crossfade', not a cut
export function voicesEntry(table, input) {
  const limit = input.thresholds.voiceLimit.v, spans = table.map((x) => ({ ...x.c, t0: x.onset ?? x.c.t0, t1: x.end ?? x.c.t1 }));
  const a = allocate(spans, limit), planned = allocate(input.cues, limit), byId = new Map(spans.map((c) => [c.id, c]));
  const crossfade = (x) => { const c = byId.get(x.cue), o = byId.get(x.other); return x.kind === 'cut' && !c.place && !o.place && c.family === o.family && o.t1 - c.t0 <= TIMBRE.crossfadeSec + 0.001; }; // to a millisecond: the ends are read to the sample
  const events = a.events.map((x) => ({ ...x, kind: crossfade(x) ? 'crossfade' : x.kind }));
  const rows = [{ kind: 'peak', cue: null, t: r(a.peak.t, 3), other: null, voices: a.peak.n, planned: planned.peak.n }, { kind: 'demand', cue: null, t: r(a.demand.t, 3), other: null, voices: a.demand.n, planned: planned.demand.n }, ...events.map((x) => ({ kind: x.kind, cue: x.cue, t: r(x.t, 3), other: x.other, voices: null, planned: null }))];
  const bad = events.some((x) => x.kind !== 'crossfade') || a.demand.n > limit;
  return entry('voices', 8, 'Voices', 'Check 12\'s count and allocator on the measured spans (each voiced cue from its measured onset to its measured end): a mono voice one, a stereo bed two; one voice per voice group, so two cues of a group sounding at once is a cut, except two backgrounds of a family inside the place change\'s crossfade (kind crossfade, intended)', `At most ${limit} (psx-spx); zero steals, drops or cuts`, 'SOUND-PLAN 3.13, check 12', false, bad ? 'fail' : 'pass', `peak ${a.peak.n} voices at ${r(a.peak.t, 3)} s (planned ${planned.peak.n}); ${events.filter((x) => x.kind === 'steal').length} steals, ${events.filter((x) => x.kind === 'drop').length} drops, ${events.filter((x) => x.kind === 'cut').length} cuts; ${events.filter((x) => x.kind === 'crossfade').length} crossfades of a background at the place change`, ['kind', 'cue', 't', 'other', 'voices', 'planned'], rows);
}

// 9 density: check 11 on the stems: foreground voice groups by their measured level and onsets, counted as bodies
export function densityEntry(measured, input) {
  const T = input.thresholds, step = T.densityStep.v, rep = T.densityReport.v, fail = T.densityFail.v;
  const groups = measured.filter((m) => m.rows.some((x) => input.density.select(x.c))).map((m) => ({ name: m.g, body: input.density.body(m.rows[0].c), blocks: A.energyBlocks(m.stem, step), onsets: m.rows.map((x) => x.onset).filter((t) => t !== null) }));
  const ticks = A.measuredDensity(groups, { step, window: BARS.windowSec.v, recent: T.densityRecent.v, db: T.densityDb.v, total: T_TOTAL });
  const rows = [];
  let run = null, worst = 0, worstBodies = 0;
  const close = () => { if (run) rows.push({ t0: r(run.t0, 2), t1: r(run.t1, 2), shot: shotAt(run.t0).n, peak: run.peak, bodies: run.bodies, streams: run.streams, fails: run.bodies > fail }); run = null; };
  for (const k of ticks) {
    worst = Math.max(worst, k.fg.length); worstBodies = Math.max(worstBodies, k.bodies);
    if (k.bodies <= rep) { close(); continue; }
    if (!run) run = { t0: k.t, t1: k.t, peak: 0, bodies: 0, streams: '' };
    run.t1 = k.t + step; run.bodies = Math.max(run.bodies, k.bodies);
    if (k.fg.length > run.peak) { run.peak = k.fg.length; run.streams = k.fg.join(', '); }
  }
  close();
  const bad = rows.filter((x) => x.fails).length;
  return entry('density', 9, 'Density', `Check 11 on the stems: every ${step * 1000} ms, the voice groups whose energy over the trailing ${BARS.windowSec.v * 1000} ms is within ${T.densityDb.v} dB of the loudest group sounding, or with a measured onset in the last ${T.densityRecent.v * 1000} ms, and the bodies they belong to`, `More than ${rep} bodies reported; more than ${fail} fails (starting values, Murch's two and a half)`, 'SOUND-PLAN 4.3 check 11; Murch (secondary)', true, bad ? 'fail' : 'pass', `peak ${worst} foreground streams (${worstBodies} bodies); ${rows.length} runs over ${rep} bodies, ${bad} over ${fail}`, ['t0', 't1', 'shot', 'peak', 'bodies', 'streams', 'fails'], rows);
}

// 10 masking per band, and 11 phone and mono: both on each cue's loudest 100 ms, its own samples against everything
// else sounding there (the mix before the master minus its group's stem). Returns the two entries and the bands.
// `predicted`: check 9's predicted broadband margins by cue (computed from `input` unless given).
export function maskingAndPhone(table, { pre, stemOf, groups, input, streetDb, predicted = null }) {
  const sr = pre.sr, M = input.thresholds.bedMargin.v, low = input.thresholds.lowHz.v, rowsM = [], rowsP = [], bands = {}, measured = new Map();
  const bed = predicted ?? new Map(maskingBed(input).rows.map((x) => [x.cue, x]));
  for (const x of table) {
    const c = x.c, w = x.window;
    if (c.category === 'bg' || !w) continue;
    const t0 = w.t, t1 = w.t + BARS.windowSec.v, own = stemOf(c.source);
    const cue = A.segment(x.src, t0, t1, { keep: (t) => t >= c.t0 && t < x.spanEnd }), masker = A.segment(pre, t0, t1, { minus: own });
    const lc = A.bandLevels(cue.left, cue.right, sr, cue.from, cue.to), lm = A.bandLevels(masker.left, masker.right, sr, masker.from, masker.to);
    // a band where the cue is silent leads nothing; where nothing else sounds it leads by Infinity, the loudest such first
    const margins = lc.map((b, i) => (b.db === -Infinity ? -Infinity : b.db - lm[i].db));
    const best = margins.reduce((k, v, i) => (v > margins[k] || (v === margins[k] && lc[i].db > lc[k].db) ? i : k), 0);
    const loudest = groups.filter((g) => g !== c.source).map((g) => ({ g, db: A.powerDb(stemOf(g), t0, t1) })).reduce((a, b) => (b.db > a.db ? b : a), { g: null, db: -Infinity });
    const broadband = A.powerDb({ sr, left: cue.left.subarray(cue.from), right: cue.right.subarray(cue.from) }, 0, Infinity) - A.powerDb({ sr, left: masker.left.subarray(masker.from), right: masker.right.subarray(masker.from) }, 0, Infinity);
    bands[c.id] = { t: r(t0, 3), cue: lc.map((b) => r(b.db, 1)), masker: lm.map((b) => r(b.db, 1)) };
    const p = bed.get(c.id);
    rowsM.push({ cue: c.id, family: c.family, t: r(t0, 3), broadbandDb: r(broadband, 1), bestBand: lc[best].nominal, bestMarginDb: r(margins[best], 1), bandsOver: margins.filter((v) => v >= M).length, loudestOther: loudest.g, atRisk: !(margins[best] >= M), predictedDb: p ? r(p.margin, 1) : null });
    // the band the cue lives in: the third octaves within bandSpanDb of its loudest
    const top = Math.max(...lc.map((b) => b.db)), inBand = lc.map((b, i) => [b, i]).filter(([b]) => b.db >= top - BARS.bandSpanDb.v);
    const lo = A.THIRD_OCTAVES[inBand[0][1]].lo, hi = A.THIRD_OCTAVES[inBand[inBand.length - 1][1]].hi;
    const f = A.foldDown(cue, sr), fm = A.foldDown(masker, sr), side = f.sideDb - f.monoDb > BARS.sideDb.v;
    measured.set(c.id, { lo: r(lo, 0), hi: r(hi, 0), side, from: 'measured: the third octaves within 10 dB of its loudest, in its loudest 100 ms' });
    rowsP.push({ cue: c.id, family: c.family, story: input.safeBand.story(c), overStreetDb: r(f.stereoDb - streetDb, 1), monoDb: r(f.monoDb - f.stereoDb, 2), sideDb: r(f.sideDb - f.stereoDb, 2), phoneDb: r(f.phoneDb - f.stereoDb, 2), smallPhoneDb: r(f.smallPhoneDb - f.stereoDb, 2), phoneOverMaskerDb: r(f.phoneDb - fm.phoneDb, 1), lo: r(lo, 0), hi: r(hi, 0), side, flag: null });
  }
  const check = safeBand({ ...input, safeBand: { story: input.safeBand.story, band: (c) => measured.get(c.id) ?? null, measured: true } });
  for (const x of check.rows) { const row = rowsP.find((y) => y.cue === x.cue); if (row) row.flag = x.flag; else rowsP.push({ cue: x.cue, family: x.family, story: true, flag: x.flag }); }
  const risk = rowsM.filter((x) => x.atRisk).length, predictedRisk = rowsM.filter((x) => x.predictedDb !== null && x.predictedDb < M).length;
  const masking = entry('masking', 10, 'Masking per band', `Each voiced non-background cue's third-octave levels (IEC 61260 centres, Butterworth order 3) on its loudest 100 ms against everything else sounding then (the mix before the master minus its own voice group): the band where it stands out most and by how much, how many bands it leads by ${M} dB or more, the broadband margin, the loudest other group (check 8's pairs), and check 9's predicted broadband margin. Per-band levels in measure.json bands`, `A cue with no band ${M} dB over its masker reported (check 9's ${M} dB, starting value); gated only at Sound 4 (SOUND-PLAN 4.4)`, 'SOUND-PLAN 4.3 checks 8 and 9, 4.5', true, 'report', `${rowsM.length} cues; ${risk} with no third octave ${M} dB over everything else in their loudest 100 ms (check 9 predicted ${predictedRisk} of the one-shots under ${M} dB broadband)`, ['cue', 'family', 't', 'broadbandDb', 'bestBand', 'bestMarginDb', 'bandsOver', 'loudestOther', 'atRisk', 'predictedDb'], rowsM);
  const flagged = rowsP.filter((x) => x.flag).length, story = rowsP.filter((x) => x.story);
  const phone = entry('phoneMono', 11, 'Phone and mono', `Each voiced non-background cue's loudest 100 ms in the mono fold-down (L + R) / 2, its side (L - R) / 2, and on a phone speaker (the fold-down through a ${A.PHONE_SPEAKER.highpassHz} Hz second-order high-pass, or ${A.PHONE_SPEAKER.smallHz} Hz for a small one, and an ${A.PHONE_SPEAKER.lowpassHz} Hz low-pass; scripts/lib/audio-analysis.mjs PHONE_SPEAKER, with its sources), each as a change from the stereo level in dB, the phone level over the masker's on the phone, and the band it lives in (lo to hi, Hz). Check 14 run on those measured bands`, `Check 14: a story cue that lives only below ${low} Hz or only in the side channel (side ${bar('sideDb')} dB over mid) fails`, 'SOUND-PLAN 4.3 check 14; the phone model\'s sources are excerpts and a secondary text (audio-analysis.mjs)', true, check.status === 'fail' ? 'fail' : 'pass', `${story.length} story cues, ${flagged} flagged; on the phone the story cues change by ${Math.min(...story.map((x) => x.phoneDb ?? Infinity))} to ${Math.max(...story.map((x) => x.phoneDb ?? -Infinity))} dB, in mono by ${Math.min(...story.map((x) => x.monoDb ?? Infinity))} to ${Math.max(...story.map((x) => x.monoDb ?? -Infinity))} dB`, ['cue', 'family', 'story', 'overStreetDb', 'monoDb', 'sideDb', 'phoneDb', 'smallPhoneDb', 'phoneOverMaskerDb', 'lo', 'hi', 'side', 'flag'], rowsP);
  return { masking, phone, bands };
}
// 12 determinism: two renders, the same bytes
export function determinismEntry(a, b) {
  const ha = sha(a.left, a.right), hb = sha(b.left, b.right);
  return entry('determinism', 12, 'Determinism', 'The blockout rendered twice in one run, before the master\'s normalization: the sha256 of both channels\' float32 samples', 'The same bytes', 'SOUND-PLAN 4.6', false, ha === hb ? 'pass' : 'fail', ha === hb ? `two renders, the same bytes (${ha.slice(0, 12)})` : 'two renders differ', ['render', 'sha256'], [{ render: 'first', sha256: ha }, { render: 'second', sha256: hb }]);
}

// 13 the stems against the mix: every voice group alone, summed, equals the mix before the master stage
export function stemsEntry(groups, stemOf, pre) {
  const { worst, peak, ratio, at } = sumAgainst(groups.map(stemOf), pre);
  return entry('stems', 13, 'Stems against the mix', `The ${groups.length} voice groups rendered alone before the master, summed, against the whole blockout before the master: the largest difference in either channel over the mix's peak`, `Within ${bar('sumRatio')} of the peak`, BARS.sumRatio.source, BARS.sumRatio.starting, ratio <= BARS.sumRatio.v ? 'pass' : 'fail', `worst ${ratio.toExponential(2)} of the peak at ${r(at, 4)} s`, ['groups', 'worst', 'peak', 'ratio', 'at'], [{ groups: groups.length, worst: Number(worst.toExponential(3)), peak: r(peak, 6), ratio: Number(ratio.toExponential(3)), at: r(at, 6) }]);
}

// ---------- 14 the drift of the parked design layers (Sound 2.7) ----------
// Each part of the design layers that plays one-shots the cue list also has, rendered alone (stemWith: its *Gain kept,
// the others muted), its onsets detected to the sample and matched one to one against the enabled one-shot cue times of
// the families it plays, within half the closest spacing of those times (at most 0.5 s): each cue with its drift or
// missing, the cues no part plays, and the extra onsets. The design's key click has no cue (Gate 0, question 2 b).
export const DESIGN_PARTS = Object.freeze([
  { name: 'A\'s steps', layer: 'foley', keep: ['stepGain'], set: { stepsBy: 'A' }, plays: (c) => c.family === 'feet' && c.person === 'A' },
  { name: 'B\'s steps', layer: 'foley', keep: ['stepGain'], set: { stepsBy: 'B' }, plays: (c) => c.family === 'feet' && c.person === 'B' },
  { name: 'doors', layer: 'car', keep: ['doorGain'], plays: (c) => c.family === 'door' },
  { name: 'settle', layer: 'car', keep: ['settleGain'], plays: (c) => c.family === 'settle' },
  { name: 'ticks', layer: 'car', keep: ['tickGain'], plays: (c) => c.family === 'tick' },
  { name: 'key', layer: 'car', keep: ['keyGain'], plays: () => false },
  { name: 'lighter', layer: 'foley', keep: ['lighterGain'], plays: (c) => c.family === 'lighter' },
  { name: 'rustles', layer: 'foley', keep: ['rustleGain'], plays: (c) => c.family === 'moves' && c.shape === 'oneshot' },
]);
const MAX_DRIFT_TOL = 0.5;
// The matching tolerance for one part: half the closest spacing of its cue times, at most MAX_DRIFT_TOL, so no design
// onset can be matched to two cues. One number per part: a cue far from its neighbours is judged as tightly as the
// closest pair (the rustles' 1.25 ms for A's cup, though its next cue is 15 s away)
export const driftTol = (times) => Math.min(MAX_DRIFT_TOL, ...times.slice(1).map((t, i) => (t - times[i]) / 2));
// 14 the drift: each part's onsets against its cues, from `stemOfPart(part)` (the part rendered alone)
export function driftEntry(cues, stemOfPart, parts = DESIGN_PARTS) {
  const shots = cues.filter((c) => c.enabled && c.voices > 0 && c.shape === 'oneshot'), rows = [];
  for (const c of shots.filter((x) => !parts.some((p) => p.plays(x)))) rows.push({ cue: c.id, family: c.family, part: null, t0: r(c.t0, 6), onset: null, driftMs: null, status: 'no part plays it' });
  for (const p of parts) {
    const own = shots.filter((c) => p.plays(c)).sort((a, b) => a.t0 - b.t0), times = own.map((c) => c.t0), s = stemOfPart(p);
    const det = A.preciseOnsets(s.left, s.right, s.sr), m = A.matchOneToOne(times, det, own.length > 1 ? driftTol(times) : MAX_DRIFT_TOL);
    for (const c of own) { const x = m.pairs.find((q) => q.expected === c.t0); rows.push({ cue: c.id, family: c.family, part: p.name, t0: r(c.t0, 6), onset: x ? r(x.detected, 6) : null, driftMs: x ? r(x.diff * 1000, 2) : null, status: x ? 'matched' : 'missing' }); }
    for (const d of m.extra) rows.push({ cue: null, family: null, part: p.name, t0: null, onset: r(d, 6), driftMs: null, status: 'extra' });
  }
  rows.sort((a, b) => (a.t0 ?? a.onset) - (b.t0 ?? b.onset));
  const matched = rows.filter((x) => x.status === 'matched'), drift = matched.map((x) => Math.abs(x.driftMs)).sort((a, b) => a - b);
  const count = (s) => rows.filter((x) => x.status === s).length;
  return entry('drift', 14, 'Drift of the parked design layers', 'The design stage with the score parked (ambience, car, foley): each part that plays one-shots rendered alone, its onsets detected to the sample and matched one to one against the enabled one-shot cue times of the families it plays (within half their closest spacing, at most 0.5 s): each cue with its drift (onset minus cue time) or missing, the cues no part plays, and the extra onsets', 'Reported, not a bar: drift is expected until Sound 4', 'ROADMAP Sound 2.7', false, 'report', `${shots.length} one-shots: ${matched.length} matched (drift ${drift.length ? `${drift[0]} to ${drift[drift.length - 1]} ms, median ${drift[Math.floor(drift.length / 2)]} ms` : 'none'}), ${count('missing')} missing, ${count('no part plays it')} with no part to play them; ${count('extra')} extra onsets`, ['cue', 'family', 'part', 't0', 'onset', 'driftMs', 'status'], rows);
}

// ---------- 15 the blockout's loudness target, chosen by measurement ----------
// The raw blockout normalized (loudness.js normalize, the stage's ceiling) to integrated targets from sweepFromLufs
// down in sweepStepDb steps, until nothing is limited: per target the limiter's loss per 400 ms window and per sample
// (limiterLoss), the samples limited, the integrated loudness and the true peak (the limiter's 4x estimate), and the
// momentary loudness of the street background and of the whole mix in the hush. The rule: the loudest target at which
// no 400 ms window loses more than limiterDb. `hush` is [t0, t1); `street` the street background's raw render.
export function targetSweep({ raw, peaks, audio, street, hush, log = () => {} }) {
  const rows = [], sr = raw.sr;
  const hushM = (s, gainDb) => { const v = A.seriesSummary(A.momentary(s), hush[0], hush[1]); return { median: v.median === null ? null : v.median + gainDb, min: v.min === null ? null : v.min + gainDb, max: v.max === null ? null : v.max + gainDb }; };
  const streetRaw = hushM(street, 0);
  for (let k = 0; ; k++) {
    const target = BARS.sweepFromLufs.v - k * BARS.sweepStepDb.v, out = { sr, left: Float32Array.from(raw.left), right: Float32Array.from(raw.right) };
    const st = normalize(out.left, out.right, { ...audio, targetLufs: target }, sr, 4, peaks), loss = A.limiterLoss(raw, out, st.gainDb);
    let tp = 0;
    for (const v of truePeakEnvelope(out.left, out.right)) if (v > tp) tp = v;
    tp = A.db(tp);
    const mix = A.seriesSummary(A.momentary(out), hush[0], hush[1]);
    const over = [...loss.db].filter((v) => v > BARS.limiterDb.v).length;
    rows.push({ target, gainDb: st.gainDb, integrated: st.lufs, truePeakDb: r(tp, 2), limitedSamples: st.limitedSamples, worstWindowDb: r(loss.worst.db, 3), worstWindowAt: r(loss.worst.t, 1), worstShot: loss.worst.t === null ? null : shotAt(loss.worst.t + 0.2).n, windowsOver: over, worstSampleDb: r(loss.worstSample.db, 2), worstSampleAt: r(loss.worstSample.t, 4), hushStreetMedian: r(streetRaw.median === null ? null : streetRaw.median + st.gainDb, 2), hushStreetMin: r(streetRaw.min === null ? null : streetRaw.min + st.gainDb, 2), hushStreetMax: r(streetRaw.max === null ? null : streetRaw.max + st.gainDb, 2), hushMixMedian: r(mix.median, 2), meets: !(loss.worst.db > BARS.limiterDb.v) });
    log(`  target ${target} LUFS: gain ${st.gainDb} dB, ${st.limitedSamples} samples limited, worst 400 ms ${loss.worst.db.toFixed(2)} dB at ${loss.worst.t} s`);
    if (st.limitedSamples === 0) break;
  }
  const chosen = rows.find((x) => x.meets) ?? null;
  return { rows, chosen, monotone: rows.every((x, i) => !rows[i - 1]?.meets || x.meets) };
}
// 15 the target: the sweep's rows, and whether the configured blockout target is the one the rule chooses
export function targetEntry(sweep, configured) {
  const ch = sweep.chosen, ok = ch !== null && configured === ch.target;
  return entry('target', 15, 'The blockout\'s loudness target', `The raw blockout normalized to integrated targets from ${BARS.sweepFromLufs.v} LUFS down in ${BARS.sweepStepDb.v} dB steps until nothing is limited: per target the limiter's largest loss in any 400 ms window (the raw RMS times the gain against the output's, on a 100 ms hop), where, how many windows lose more than ${BARS.limiterDb.v} dB, the largest loss of one sample and where, the samples limited, the integrated loudness, the true peak (4x), and the momentary loudness of the street background (the beds alone, reverb in) and of the whole mix in the hush (the run-down's end to the end of the shot after it)`, `The loudest target at which no 400 ms window loses more than ${bar('limiterDb')} dB; the configured blockout target must be that one`, BARS.limiterDb.source, BARS.limiterDb.starting, ok ? 'pass' : 'fail', ch ? `chosen ${ch.target} LUFS (gain ${ch.gainDb} dB, worst 400 ms ${ch.worstWindowDb} dB, worst sample ${ch.worstSampleDb} dB, true peak ${ch.truePeakDb} dBTP, the street background in the hush ${ch.hushStreetMedian} LUFS momentary); configured ${configured}; ${sweep.monotone ? 'every quieter target meets the rule too' : 'not monotone: a quieter target fails'}` : `no target from ${BARS.sweepFromLufs.v} down meets the rule; configured ${configured}`, ['target', 'gainDb', 'integrated', 'truePeakDb', 'limitedSamples', 'worstWindowDb', 'worstWindowAt', 'worstShot', 'windowsOver', 'worstSampleDb', 'worstSampleAt', 'hushStreetMedian', 'hushStreetMin', 'hushStreetMax', 'hushMixMedian', 'meets'], sweep.rows);
}

// ---------- the files ----------
// A 32-bit float WAV (format 3): the measuring stems keep their levels exactly, past full scale included
export function encodeFloatWav(left, right, sr) {
  const n = left.length, buf = Buffer.alloc(44 + 8 * n);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + 8 * n, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(3, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 8, 28); buf.writeUInt16LE(8, 32); buf.writeUInt16LE(32, 34);
  buf.write('data', 36); buf.writeUInt32LE(8 * n, 40);
  for (let i = 0; i < n; i++) { buf.writeFloatLE(left[i], 44 + 8 * i); buf.writeFloatLE(right[i], 48 + 8 * i); }
  return buf;
}
// JSON with each array of numbers on one line (the bands and the series), so measure.json stays readable
export const compactJson = (o) => `${JSON.stringify(o, null, 1).replace(/\[\s+((?:-?[\d.e+-]+|null)(?:,\s+(?:-?[\d.e+-]+|null))*)\s+\]/g, (_, xs) => `[${xs.replace(/,\s+/g, ', ')}]`)}\n`;
const fileName = (source) => source.replace(/[^A-Za-z0-9]+/g, '-');

// The listening stems (Sound 2.6, for the director): one per body, the full render of its voice groups (reverb and the
// master chain in) at the mastered mix's own gain and unlimited, so the float stems sum to the mix before its limiter;
// AAC at LISTEN.bitrate (the export's codec, scripts/lib/ffmpeg.mjs AUDIO, at a third of its rate), bit-exact flags so
// the same samples give the same file. The AAC files do not sum exactly: each is measured against its float stem
// (codingError), and their decoded sum against the mix.
export const LISTEN = Object.freeze({ codec: 'aac', bitrate: '96k', sampleRate: 48000, channels: 2 });
function encodeAac(wav, m4a) {
  const p = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', wav, '-c:a', LISTEN.codec, '-b:a', LISTEN.bitrate, '-ar', String(LISTEN.sampleRate), '-ac', String(LISTEN.channels), '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:a', '+bitexact', m4a], { encoding: 'utf8' });
  if (p.status !== 0) throw new Error(`aac ${m4a}: ${p.stderr}`);
}
function meterOf(path) {
  const p = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', path, '-af', 'ebur128=peak=true:framelog=quiet', '-f', 'null', '-'], { encoding: 'utf8' });
  const d = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path], { encoding: 'utf8' });
  return { I: Number(/I:\s+(-?[\d.]+) LUFS/.exec(p.stderr)?.[1]), TP: Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(p.stderr)?.[1]), seconds: Number(d.stdout.trim()) };
}
// The listening stems' bodies, each { name, render }: the full render of its voice groups before normalization
export const listeningBodies = (session) => [...new Set(session.groups.map(bodyOf))].map((name) => ({ name, render: session.renderOf(`body:${name}`, (c) => bodyOf(c.source) === name) }));
// How far a decoded file is from the float signal it was encoded from: the lag (samples, the decoded later is
// positive) that best aligns them over the signal's loudest second (ffmpeg.mjs alignment, within LAG_MAX), the decoded
// file moved back by it, and the error's power under the signal's, both channels, in dB
const LAG_MAX = 2048; // two AAC frames: more than the encoder's priming, which the decoder trims
export function codingError(float, decoded) {
  const w = A.loudestWindow(float, 0, float.left.length / float.sr, 1), i0 = A.idx(w.t, float.sr), i1 = Math.min(float.left.length, i0 + float.sr);
  const { lag } = alignment(float, decoded, { i0, i1, maxLag: LAG_MAX });
  const back = (x) => Float32Array.from(float.left, (_, i) => x[i + lag] ?? 0), aligned = { sr: float.sr, left: back(decoded.left), right: back(decoded.right) };
  return { lag, aligned, errorDb: sumAgainst([aligned], float).errorDb };
}
export function listeningStems(session, { round, gainDb, targetLufs, reviewDir, outDir, log = () => {} }) {
  const g = 10 ** (gainDb / 20), raw = session.raw(), bodies = listeningBodies(session), decoded = [], out = [];
  mkdirSync(resolve(reviewDir, 'stems'), { recursive: true }); mkdirSync(resolve(outDir, 'listen'), { recursive: true });
  for (const { name: b, render: s } of bodies) {
    const left = Float32Array.from(s.left, (x) => x * g), right = Float32Array.from(s.right, (x) => x * g);
    const wav = resolve(outDir, 'listen', `${b}.wav`), m4a = resolve(reviewDir, 'stems', `${b}.m4a`);
    writeFileSync(wav, encodeFloatWav(left, right, s.sr));
    encodeAac(wav, m4a);
    const bytes = readFileSync(m4a), meter = meterOf(m4a), own = session.voiced.filter((c) => bodyOf(c.source) === b), err = codingError({ sr: s.sr, left, right }, decodeAudio(m4a, s.sr));
    decoded.push(err.aligned);
    out.push({ name: b, file: `${b}.m4a`, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, seconds: r(meter.seconds, 3), lufs: r(integratedLufs(left, right, s.sr), 2), peakDb: r(A.db(samplePeak(left, right)), 2), aac: { lufs: meter.I, truePeakDb: meter.TP, lagSamples: err.lag, errorDb: r(err.errorDb, 2) }, groups: [...new Set(own.map((c) => c.source))], cues: own.map((c) => c.id) });
    log(`  stem ${b}: ${own.length} cues, ${(bytes.length / 1e6).toFixed(2)} MB, ${meter.I} LUFS, the AAC's coding error ${(-err.errorDb).toFixed(2)} dB under its float stem (lag ${err.lag})`);
  }
  const float = sumAgainst(bodies.map((x) => x.render), raw), aac = sumAgainst(decoded, { sr: raw.sr, left: Float32Array.from(raw.left, (x) => x * g), right: Float32Array.from(raw.right, (x) => x * g) });
  return {
    round, stage: session.config.audio.stage, gainDb, targetLufs, codec: LISTEN.codec, bitrate: LISTEN.bitrate,
    note: 'each body at the mastered mix\'s own gain, unlimited. The float stems (out/round-NN/listen/*.wav) sum to the mix before its limiter: sumRatio is their largest difference over the raw mix\'s peak. The AAC files are coded, so they do not: aacSum is their decoded sum against that mix at the same gain (the largest difference over its peak, where, and the error\'s power under the mix\'s), and each body\'s aac.errorDb its own coding error under its float stem (aac.lagSamples the lag that aligns them). lufs and peakDb are the float signal\'s, aac.lufs and aac.truePeakDb the encoded file\'s (ffmpeg ebur128)',
    sumRatio: Number(float.ratio.toExponential(3)), aacSum: { ratio: r(aac.ratio, 4), at: r(aac.at, 4), errorDb: r(aac.errorDb, 2) }, bodies: out,
  };
}

// ---------- the step: --measure ----------
// The per-cue table of measure.json, from the group measurements and the pan and level entries
function cueTable(table, entries) {
  const pan = new Map(entries.pan.rows.map((x) => [x.cue, x])), level = new Map(entries.level.rows.map((x) => [x.cue, x]));
  const columns = ['cue', 'group', 'family', 'category', 'shape', 'shot', 't0', 't1', 'onset', 'onsetMs', 'read', 'end', 'endMs', 'last', 'levelT', 'levelDb', 'overStreetDb', 'predictedDb', 'overBedDb', 'balanceDb', 'predictedBalanceDb'];
  const rows = table.map((x) => {
    const c = x.c, p = pan.get(c.id), l = level.get(c.id);
    return { cue: c.id, group: c.source, family: c.family, category: c.category, shape: c.shape, shot: shotAt(c.t0).n, t0: r(c.t0, 6), t1: r(c.t1, 6), onset: r(x.onset, 6), onsetMs: x.onset === null ? null : r((x.onset - c.t0) * 1000), read: x.read, end: r(x.end, 6), endMs: x.end === null ? null : r((x.end - c.t1) * 1000, 2), last: r(x.last, 6), levelT: l.t, levelDb: l.levelDb, overStreetDb: l.overStreetDb, predictedDb: l.predictedDb, overBedDb: l.overBedDb, balanceDb: p.balanceDb, predictedBalanceDb: p.predictedDb };
  });
  return { columns, rows };
}
const seriesOut = (s) => ({ windowSec: s.windowSec, firstEnd: r(s.firstEnd, 3), lufs: [...s.lufs].map((v) => r(v, 2)) });

// The --measure step: the 15 measures on one session, then measure.json, the measuring stems (out/round-NN/stems/, not
// committed) and the listening stems with stems.json (review/round-NN/stems/). Returns the report, and leaves it on
// the session for the steps after it
export async function measureStep(session, { round, reviewDir, outDir, log = console.log }) {
  const start = performance.now(), say = (msg) => log(`[${((performance.now() - start) / 1000).toFixed(1)} s] ${msg}`);
  const input = buildInput(), cfg = session.config, sr = session.sr, stemOf = (g) => session.group(g);
  say(`round ${round}: the ${cfg.audio.stage} stage, ${session.voiced.length} voiced cues in ${session.groups.length} voice groups`);
  const raw = session.raw(); say('the raw render');
  const again = session.again(); say('the raw render again');
  const pre = session.pre(); say('the mix before the master');
  const measured = session.groups.map((g) => measureGroup(session, g)); say(`${measured.length} voice groups rendered and measured`);
  const table = measured.flatMap((m) => m.rows).sort((a, b) => a.c.t0 - b.c.t0 || (a.c.id < b.c.id ? -1 : 1));
  const street = LOCATIONS.find((l) => l.name === 'street'), beds = session.beds();
  const streetDb = A.powerDb(beds, street.t0, street.t1 - TIMBRE.crossfadeSec / 2);
  const e = {};
  e.renderer = rendererEntry(measured);
  e.sync = syncEntry(table, input); say('renderer and sync');
  e.ends = endsEntry(table);
  e.pan = panEntry(table, stemOf);
  e.level = levelEntry(table, { streetDb, beds, hear: (c, t) => input.hear(c, t, 'camera') }); say('ends, pan, level');
  // the hush: from the run-down's end (the engine dead, carTimes.lightsOff1) to the end of the shot after it
  const stop = session.cues.find((c) => c.family === 'stop');
  if (Math.abs(stop.t1 - carTimes.lightsOff1) > 1e-9) throw new Error(`the run-down ends at ${stop.t1}, not carTimes.lightsOff1 ${carTimes.lightsOff1}`);
  const hush = [stop.t1, SHOTS[SHOTS.indexOf(shotAt(stop.t1)) + 1].end];
  say(`the loudness sweep (hush ${hush[0]} to ${hush[1]} s)`);
  const sweep = targetSweep({ raw, peaks: session.peaks(), audio: cfg.audio, street: session.renderOf('street', (c) => c.category === 'bg' && !c.place), hush, log: say });
  const mastered = session.mastered(), loud = loudnessEntry(mastered); say(`mastered at ${targetOf(cfg.audio)} LUFS: ${mastered.stats.lufs} LUFS, gain ${mastered.stats.gainDb} dB`);
  e.loudness = loud.entry;
  e.silence = silenceEntry(measured, input);
  e.voices = voicesEntry(table, input);
  e.density = densityEntry(measured, input); say('silence, voices, density');
  const mp = maskingAndPhone(table, { pre, stemOf, groups: session.groups, input, streetDb });
  e.masking = mp.masking; e.phoneMono = mp.phone; say('masking per band, phone and mono');
  e.determinism = determinismEntry(raw, again);
  e.stems = stemsEntry(session.groups, stemOf, pre); say('determinism, the stems against the mix');
  e.drift = driftEntry(session.cues, (p) => A.stemWith(p.layer, { keep: p.keep, set: p.set ?? {} }, DESIGN_PARKED)); say('the design layers\' drift');
  e.target = targetEntry(sweep, targetOf(cfg.audio));
  const measures = Object.values(e).sort((a, b) => a.n - b.n);

  // the measuring stems (not committed) and the listening stems
  mkdirSync(resolve(outDir, 'stems'), { recursive: true });
  const groups = session.groups.map((g) => {
    const file = resolve(outDir, 'stems', `${fileName(g)}.wav`), s = stemOf(g), own = session.own(g);
    writeFileSync(file, encodeFloatWav(s.left, s.right, sr));
    return { source: g, body: bodyOf(g), category: own[0].category, cues: own.length, file: relative(ROOT, file) };
  });
  say(`${groups.length} measuring stems in ${relative(ROOT, resolve(outDir, 'stems'))}`);
  const stems = listeningStems(session, { round, gainDb: mastered.stats.gainDb, targetLufs: targetOf(cfg.audio), reviewDir, outDir, log: say });
  writeFileSync(resolve(reviewDir, 'stems', 'stems.json'), `${JSON.stringify(stems, null, 1)}\n`);

  const report = {
    round, stage: cfg.audio.stage, parked: cfg.audio.parked, seed: cfg.seed, sr, seconds: raw.left.length / sr, targetLufs: targetOf(cfg.audio), gainDb: mastered.stats.gainDb,
    cues: session.cues.length, voiced: session.voiced.length, streetDb: r(streetDb, 3), hush: hush.map((t) => r(t, 6)), groups,
    renders: { raw: { sha256: sha(raw.left, raw.right) }, again: { sha256: sha(again.left, again.right) }, mastered: { sha256: createHash('sha256').update(encodeWav(mastered.left, mastered.right, sr, mulberry32((cfg.seed ^ hashString('audio:dither')) >>> 0))).digest('hex'), stats: mastered.stats } },
    measures, table: cueTable(table, e),
    bands: { nominal: A.thirdOctaveBank(sr).map((b) => b.nominal), cues: mp.bands },
    series: { hopSec: loud.series.m.hopSec, momentary: seriesOut(loud.series.m), shortTerm: seriesOut(loud.series.s) },
  };
  mkdirSync(reviewDir, { recursive: true });
  writeFileSync(resolve(reviewDir, 'measure.json'), compactJson(report));
  for (const m of measures) log(`${String(m.n).padStart(2)} ${m.id.padEnd(12)} ${m.status.padEnd(6)} ${m.summary}`);
  say(`wrote ${relative(ROOT, resolve(reviewDir, 'measure.json'))} and ${relative(ROOT, resolve(reviewDir, 'stems'))}/`);
  session.measure = report; // for the steps that follow (--stills, --sheet)
  return report;
}

// The steps in the order they run; each reads the session (and what earlier steps left on it) and writes its files.
// Sound 2.9's --stills and --sheet join here.
export const STEPS = Object.freeze({ measure: measureStep });

async function main() {
  const { values: a } = parseArgs({ options: { round: { type: 'string', default: '05' }, ...Object.fromEntries(Object.keys(STEPS).map((k) => [k, { type: 'boolean', default: false }])) }, strict: true });
  if (!/^\d{1,2}$/.test(a.round)) throw new Error(`bad --round ${a.round} (a number such as 05)`);
  const round = pad2(Number(a.round)), asked = Object.keys(STEPS).filter((k) => a[k]);
  if (!asked.length) throw new Error(`no step asked for: pass ${Object.keys(STEPS).map((k) => `--${k}`).join(' or ')}`);
  const session = makeSession(), ctx = { round, reviewDir: resolve(ROOT, 'review', `round-${round}`), outDir: resolve(ROOT, 'out', `round-${round}`), log: console.log };
  for (const k of asked) await STEPS[k](session, ctx);
}

const isMain = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((err) => { console.error(`sound review failed: ${err.stack}`); process.exitCode = 1; });
