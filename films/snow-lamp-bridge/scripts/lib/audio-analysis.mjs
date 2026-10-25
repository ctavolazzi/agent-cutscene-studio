// Measurements on rendered audio, shared by the audio tests and scripts: stems, levels, onsets, stereo balance.
// Everything takes Float32Arrays at a sample rate, times in seconds.
import { CONFIG } from '../../src/config.js';
import { atStage, buildLayers, renderSoundtrack } from '../../src/audio/index.js';
import { CUES } from '../../src/audio/cues.js';
import { Biquad, dbToGain } from '../../src/audio/dsp.js';
import { integratedLufs, kWeighted } from '../../src/audio/loudness.js';
import { BLOCK } from '../../src/audio/mix.js';
import { T_TOTAL } from '../../src/world.js';
import { showingFrame } from './sound-checks.js';

const cache = new Map();
const stageKey = (config) => [config.audio.stage, config.audio.parked, config.seed];
// One layer (or several) of a config's stage alone: no reverb, no normalization, so onsets and levels are the layer's
// own. Cached per run.
export function stem(only, config = CONFIG) {
  const key = JSON.stringify([...stageKey(config), [].concat(only)]);
  if (!cache.has(key)) cache.set(key, renderSoundtrack(config, { only: [].concat(only), reverb: false, normalize: false }));
  return cache.get(key);
}

// One layer with some of its config changed (parts muted, one person's steps): { layer, set: { key: value } }.
// `keep` mutes every *Gain in the layer's config except those named. No reverb, no normalization. Cached per run.
export function stemWith(layer, { keep = null, set = {} } = {}, config = CONFIG) {
  const key = JSON.stringify([...stageKey(config), layer, keep, set]);
  if (!cache.has(key)) {
    const c = { ...config.audio[layer] };
    if (keep) for (const k of Object.keys(c)) if (k.endsWith('Gain') && !keep.includes(k)) c[k] = 0;
    Object.assign(c, set);
    cache.set(key, renderSoundtrack({ ...config, audio: { ...config.audio, [layer]: c } }, { only: [layer], reverb: false, normalize: false }));
  }
  return cache.get(key);
}

// The integrated loudness (BS.1770, both gates: absolute at -70 LUFS, relative at -10 LU, the meter normalize() uses)
// of [t0, t1). Named lufsOf until Sound 2.1, whose comment called it short-term and ungated: the gates stay, since the
// balance bars in tests/sound-layers.test.mjs were set on it.
export function integratedLufsOf(s, t0, t1) {
  const a = idx(t0, s.sr), b = idx(t1, s.sr);
  return integratedLufs(s.left.subarray(a, b), s.right.subarray(a, b), s.sr);
}

// the last time anything sounds before t (or -Infinity), and the first time anything sounds after t (or Infinity).
// "Sounds" is over `floor` (default -100 dBFS): a filter's tail decays toward zero without ever reaching it.
const over = (s, i, floor) => Math.abs(s.left[i]) > floor || Math.abs(s.right[i]) > floor;
export function lastSoundBefore(s, t, floor = 1e-5) { for (let i = idx(t, s.sr) - 1; i >= 0; i--) if (over(s, i, floor)) return i / s.sr; return -Infinity; }
export function firstSoundAfter(s, t, floor = 1e-5) { for (let i = idx(t, s.sr); i < s.left.length; i++) if (over(s, i, floor)) return i / s.sr; return Infinity; }

export const idx = (t, sr) => Math.max(0, Math.round(t * sr));

// root mean square of both channels over [t0, t1)
export function rms(left, right, sr, t0, t1) {
  const a = idx(t0, sr), b = Math.min(left.length, idx(t1, sr));
  let s = 0;
  for (let i = a; i < b; i++) s += left[i] * left[i] + right[i] * right[i];
  return Math.sqrt(s / Math.max(1, 2 * (b - a)));
}
export const db = (x) => 20 * Math.log10(Math.max(x, 1e-12));

// energy right minus left in dB over [t0, t1): positive when the sound sits to the right
export function balanceDb(left, right, sr, t0, t1) {
  const a = idx(t0, sr), b = Math.min(left.length, idx(t1, sr));
  let l = 0, r = 0;
  for (let i = a; i < b; i++) { l += left[i] * left[i]; r += right[i] * right[i]; }
  return 10 * Math.log10((r + 1e-20) / (l + 1e-20));
}

// The envelope (peak of |x| over 1 ms hops, both channels) and onsets: times where the envelope rises above
// `ratio` times its median over the preceding `lookback` seconds and above `floorDb` absolute, at least `minGap`
// seconds after the previous onset. Times are the first hop over the line, so they lead the attack by under 1 ms.
export function onsets(left, right, sr, opts = {}) {
  return detect(left, right, sr, opts).hits.map((h) => h.j / 1000);
}
// The detector behind onsets() and preciseOnsets(): each hit is the 1 ms hop j whose peak first rises over its line,
// with that line (the larger of the floor and the ratio over the median before it).
function detect(left, right, sr, { ratioDb = 12, floorDb = -60, minGap = 0.08, lookback = 0.25, from = 0, to = Infinity } = {}) {
  const hop = Math.round(sr / 1000), env = [];
  for (let i = 0; i + hop <= left.length; i += hop) {
    let p = 0;
    for (let k = i; k < i + hop; k++) p = Math.max(p, Math.abs(left[k]), Math.abs(right[k]));
    env.push(p);
  }
  const look = Math.round(lookback * 1000), floor = 10 ** (floorDb / 20), ratio = 10 ** (ratioDb / 20);
  const hits = [];
  let last = -Infinity;
  for (let j = 1; j < env.length; j++) {
    const t = j / 1000;
    if (t < from || t > to || t - last < minGap || !(env[j] > floor)) continue; // under the floor: no hit, whatever the median
    const prev = env.slice(Math.max(0, j - look), j).sort((x, y) => x - y);
    const med = prev[Math.floor(prev.length / 2)] ?? 0;
    if (env[j] > floor && env[j] > ratio * Math.max(med, 1e-9)) { hits.push({ j, line: Math.max(floor, ratio * Math.max(med, 1e-9)) }); last = t; }
  }
  return { hop, hits };
}
// onsets() to the sample: each detection moved to the first sample of its hop, in either channel, over the detector's
// own line. The hop's time rounds an attack down by up to a millisecond, so a cue 6 ms late can read 5; this reads 6.
export function preciseOnsets(left, right, sr, opts = {}) {
  const { hop, hits } = detect(left, right, sr, opts);
  return hits.map(({ j, line }) => {
    for (let k = j * hop; k < (j + 1) * hop; k++) if (Math.abs(left[k]) > line || Math.abs(right[k]) > line) return k / sr;
    return j * hop / sr;
  });
}

// The blockout with only some voice groups sounding (a cue's `source` is its voice group): the cues whose source is
// named, plus the modifiers (no voice of their own), from `cues` (cues.js's by default, or a changed catalogue). No
// reverb, no normalization. Cached per run for cues.js's own catalogue.
export function groupStem(sources, { cues = CUES, config = atStage(CONFIG, { stage: 'blockout' }) } = {}) {
  const names = [].concat(sources), key = JSON.stringify(['groups', ...stageKey(config), names]);
  const make = () => renderSoundtrack(config, { cues: cues.filter((c) => c.voices === 0 || names.includes(c.source)), reverb: false, normalize: false });
  if (cues !== CUES) return make();
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
}

// The blockout's layers summed into their buses and nothing else: renderBlocks's bus sum without its master chain (no
// reverb, highpass or fades), from the cues in `cues` (cues.js's by default). What the voices themselves play, so a
// voice is exact zeros outside the samples it sounds: the master highpass rings on after every voice, and its fade in
// covers the start. tests/sound-blockout.test.mjs shows that this through the master chain is groupStem, sample for
// sample. { sr, left, right }, not cached.
export function preMaster(cues = CUES, config = atStage(CONFIG, { stage: 'blockout' })) {
  const layers = buildLayers(config, null, { cues }), sr = config.audio.sr, n = Math.round(T_TOTAL * sr);
  const left = new Float32Array(n), right = new Float32Array(n), tl = new Float32Array(BLOCK), tr = new Float32Array(BLOCK);
  const gain = Object.fromEntries(Object.entries(config.audio.buses).map(([k, v]) => [k, dbToGain(v)]));
  for (let i0 = 0; i0 < n; i0 += BLOCK) {
    const m = Math.min(BLOCK, n - i0);
    for (const layer of layers) {
      tl.fill(0); tr.fill(0);
      layer.process(tl, tr, i0, m);
      const g = gain[layer.bus] ?? 1;
      for (let k = 0; k < m; k++) { left[i0 + k] += tl[k] * g; right[i0 + k] += tr[k] * g; }
    }
  }
  return { sr, left, right };
}
// The samples of [a, b) that are not zero in either channel: the first and the last, or null when all are zero
export function nonzeroSpan(s, a = 0, b = s.left.length) {
  let first = -1, last = -1;
  for (let i = a; i < b; i++) if (s.left[i] !== 0 || s.right[i] !== 0) { if (first < 0) first = i; last = i; }
  return first < 0 ? null : [first, last];
}

// Expected and detected onsets matched one to one, within `tol` seconds: the closest pairs first, so two expected
// times can never claim one detection (a nearest-match rule would hand both to it). Returns the pairs (detected minus
// expected), the expected times left unmatched and the detections left over.
export function matchOneToOne(expected, detected, tol) {
  const cand = [];
  expected.forEach((e, i) => detected.forEach((d, j) => { if (Math.abs(d - e) <= tol) cand.push({ i, j, diff: d - e }); }));
  cand.sort((a, b) => Math.abs(a.diff) - Math.abs(b.diff) || a.i - b.i || a.j - b.j);
  const ue = new Set(), ud = new Set(), pairs = [];
  for (const c of cand) if (!ue.has(c.i) && !ud.has(c.j)) { ue.add(c.i); ud.add(c.j); pairs.push({ expected: expected[c.i], detected: detected[c.j], diff: c.diff }); }
  pairs.sort((a, b) => a.expected - b.expected);
  return { pairs, missed: expected.filter((_, i) => !ue.has(i)), extra: detected.filter((_, j) => !ud.has(j)) };
}

// The balance (right over left, dB) that a placement predicts over [t0, t1), weighted by the energy the stem actually
// has in each millisecond: the pan says where a voice sits, the stem says when it is loud. panAt(t) is the pan, -1 to
// 1, the spatializer's equal-power law turns into the channel gains.
export function predictedBalanceDb(s, t0, t1, panAt) {
  const hop = Math.round(s.sr / 1000);
  let l = 0, r = 0;
  for (let a = idx(t0, s.sr), b = Math.min(s.left.length, idx(t1, s.sr)); a < b; a += hop) {
    let e = 0;
    for (let i = a; i < Math.min(b, a + hop); i++) e += s.left[i] * s.left[i] + s.right[i] * s.right[i];
    const p = panAt((a + hop / 2) / s.sr), g = (p + 1) * Math.PI / 4;
    l += e * Math.cos(g) ** 2; r += e * Math.sin(g) ** 2;
  }
  return 10 * Math.log10((r + 1e-20) / (l + 1e-20));
}

// An in-place radix-2 FFT of re and im (length a power of two)
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2, xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

// The power spectrum of the mono sum, averaged over Hann frames of `size` samples hopping half a frame through each
// [t0, t1) window (at least one frame from each window's start): { hz: bin width, power: Float64Array(size / 2) }
export function averageSpectrum(s, windows, size = 4096) {
  const power = new Float64Array(size / 2), re = new Float64Array(size), im = new Float64Array(size);
  const hann = Float64Array.from({ length: size }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / size));
  let frames = 0;
  for (const [t0, t1] of windows) {
    const a = idx(t0, s.sr), b = idx(t1, s.sr);
    for (let f = a; (f === a || f + size <= b) && f + size <= s.left.length; f += size / 2) {
      for (let i = 0; i < size; i++) { re[i] = 0.5 * (s.left[f + i] + s.right[f + i]) * hann[i]; im[i] = 0; }
      fft(re, im);
      for (let k = 0; k < size / 2; k++) power[k] += re[k] * re[k] + im[k] * im[k];
      frames++;
    }
  }
  return { hz: s.sr / size, power, frames };
}
// The spectral centroid in Hz of an average spectrum, from `lo` Hz up (the master highpass sits at 35 Hz)
export function centroidHz({ hz, power }, lo = 20) {
  let a = 0, b = 0;
  for (let k = Math.ceil(lo / hz); k < power.length; k++) { a += k * hz * power[k]; b += power[k]; }
  return b > 0 ? a / b : NaN;
}

// for each expected time, the nearest detected onset and the difference (detected minus expected)
export function matchOnsets(expected, detected) {
  return expected.map((e) => {
    let best = null;
    for (const d of detected) if (best === null || Math.abs(d - e) < Math.abs(best - e)) best = d;
    return { expected: e, detected: best, diff: best === null ? Infinity : best - e };
  });
}

export const peak = (left, right) => { let p = 0; for (let i = 0; i < left.length; i++) p = Math.max(p, Math.abs(left[i]), Math.abs(right[i])); return p; };
export const finite = (left, right) => { for (let i = 0; i < left.length; i++) if (!Number.isFinite(left[i]) || !Number.isFinite(right[i])) return false; return true; };

// ---------- Sound 2.5: the review's measurements (SOUND-PLAN 4.5) ----------
// Film-generic: each takes signals { sr, left, right } and times, and returns plain numbers. The film's glue, which
// decides what is measured on which stem, is scripts/sound-review.js.

// The samples of [t0, t1) as sample indices, clipped to the signal
const span = (s, t0, t1) => [Math.max(0, idx(t0, s.sr)), Math.min(s.left.length, idx(t1, s.sr))];

// Where a voice stops sounding in [t0, t1): `end` just after the last sample of either channel within `floorDb` of the
// loudest sample there (60 dB, the decay RT60 measures), and `last` just after the last sample that is not zero at
// all (the spatializer's lowpass rings on a little). null when [t0, t1) is silent. Seconds.
export function soundingEnd(s, t0, t1, floorDb = 60) {
  const [a, b] = span(s, t0, t1);
  let p = 0;
  for (let i = a; i < b; i++) p = Math.max(p, Math.abs(s.left[i]), Math.abs(s.right[i]));
  if (p === 0) return null;
  const line = p * 10 ** (-floorDb / 20);
  let last = -1;
  for (let i = b - 1; i >= a; i--) {
    const v = Math.max(Math.abs(s.left[i]), Math.abs(s.right[i]));
    if (last < 0 && v > 0) last = i;
    if (v > line) return { end: (i + 1) / s.sr, last: (last + 1) / s.sr, peak: p };
  }
  return null;
}

// Sync on a measured onset (SOUND-PLAN 3.3, check 4 of scripts/lib/sound-checks.js): the frame that shows the rule's
// event nearest the onset (showingFrame, sampling the picture's state at frame times within `search` s), and the
// onset's lead on that frame past the cue's named lead. 0 to `ahead` s passes; audio after its frame fails.
export function syncOf(rule, onset, lead, { fps, search, ahead }) {
  const f = showingFrame(rule, onset, fps, search);
  if (f === null) return { frame: null, aheadMs: null, pastMs: null, ok: false, note: `not shown within ${search} s of the onset` };
  const a = f / fps - onset, past = a - lead, ok = past >= -1e-9 && past <= ahead + 1e-9;
  const note = ok ? null : past < 0 ? `${(-past * 1000).toFixed(2)} ms after its frame` : `${((past - ahead) * 1000).toFixed(2)} ms too early`;
  return { frame: f / fps, aheadMs: a * 1000, pastMs: past * 1000, ok, note };
}

// ---------- loudness over time: momentary and short-term (EBU Tech 3341, ITU-R BS.1770-4) ----------
// The K-weighted energy of both channels in consecutive blocks of `hopSec` (the 100 ms the meters update on), summed
// per block: the sums the momentary and short-term windows slide over. K-weighted with src/audio/loudness.js's filters.
export function kBlocks(s, hopSec = 0.1) {
  const kl = kWeighted(s.left), kr = kWeighted(s.right), size = Math.round(hopSec * s.sr), n = Math.floor(kl.length / size), sums = new Float64Array(n);
  for (let k = 0; k < n; k++) { let e = 0; for (let i = k * size; i < (k + 1) * size; i++) e += kl[i] * kl[i] + kr[i] * kr[i]; sums[k] = e; }
  return { hopSec, size, sums };
}
// The loudness of every `windowSec` window that ends on a block boundary, ungated (momentary: 0.4 s; short-term: 3 s):
// lufs[k] is the window ending at end(k) = firstEnd + k * hopSec, from the first full window on; -Infinity for silence.
export function loudnessSeries(blocks, windowSec) {
  const w = Math.round(windowSec / blocks.hopSec), n = blocks.sums.length - w + 1, lufs = new Float64Array(Math.max(0, n));
  let e = 0;
  for (let k = 0; k < blocks.sums.length; k++) {
    e += blocks.sums[k];
    if (k >= w) e -= blocks.sums[k - w];
    if (k >= w - 1) lufs[k - w + 1] = e > 1e-30 ? -0.691 + 10 * Math.log10(e / (w * blocks.size)) : -Infinity;
  }
  return { hopSec: blocks.hopSec, windowSec, firstEnd: w * blocks.hopSec, lufs };
}
export const momentary = (s) => loudnessSeries(kBlocks(s), 0.4);
export const shortTerm = (s) => loudnessSeries(kBlocks(s), 3);
// The largest, the median and the smallest reading of the series' windows that lie inside [t0, t1), and how many
const EPS_T = 1e-9;
export function seriesSummary(series, t0, t1) {
  const v = [];
  series.lufs.forEach((x, k) => { const e = series.firstEnd + k * series.hopSec; if (e - series.windowSec >= t0 - EPS_T && e <= t1 + EPS_T) v.push(x); });
  if (!v.length) return { n: 0, max: null, median: null, min: null };
  const sorted = [...v].sort((a, b) => a - b);
  return { n: v.length, max: sorted[sorted.length - 1], median: sorted[Math.floor(sorted.length / 2)], min: sorted[0] };
}

// ---------- the limiter's loss ----------
// What a limiter took off a normalization: per `windowSec` window on a `hopSec` hop, 20 log10 of the raw RMS times
// the gain over the output's RMS (dB; windows where nothing sounds read 0), the worst window, and the worst single
// sample: the smallest output over raw times gain among samples over `floorDb` after the gain (below it the float32
// rounding of the output, not the limiter, moves the ratio). Windows are listed by their start, t = k * hopSec.
export function limiterLoss(raw, out, gainDb, { windowSec = 0.4, hopSec = 0.1, floorDb = -60 } = {}) {
  const sr = raw.sr, g = dbToGain(gainDb), size = Math.round(hopSec * sr), nb = Math.floor(raw.left.length / size);
  const er = new Float64Array(nb), eo = new Float64Array(nb), floor = dbToGain(floorDb);
  let worstSample = { t: null, db: 0 };
  for (let k = 0; k < nb; k++) {
    let a = 0, b = 0;
    for (let i = k * size; i < (k + 1) * size; i++) {
      const l = raw.left[i] * g, r = raw.right[i] * g;
      a += l * l + r * r; b += out.left[i] * out.left[i] + out.right[i] * out.right[i];
      const [x, y] = Math.abs(l) >= Math.abs(r) ? [l, out.left[i]] : [r, out.right[i]];
      if (Math.abs(x) > floor) { const d = -20 * Math.log10(Math.max(1e-12, y / x)); if (d > worstSample.db) worstSample = { t: i / sr, db: d }; }
    }
    er[k] = a; eo[k] = b;
  }
  const w = Math.round(windowSec / hopSec), db = new Float64Array(Math.max(0, nb - w + 1));
  let worst = { t: null, db: 0 };
  for (let k = 0; k + w <= nb; k++) {
    let a = 0, b = 0;
    for (let j = k; j < k + w; j++) { a += er[j]; b += eo[j]; }
    db[k] = a > 0 && b > 0 ? 10 * Math.log10(a / b) : 0;
    if (db[k] > worst.db) worst = { t: k * hopSec, db: db[k] };
  }
  return { windowSec, hopSec, db, worst, worstSample };
}

// ---------- levels in a window ----------
// The loudest `windowSec` of a voice whose samples are those of `s` in [t0, t1), zero outside (a voice shorter than
// the window is measured over the window too, as src/audio/layers/blockout/voices.js sets levels): its start on a
// 1 ms grid and its level, the power of both channels summed, in dB. null when the span is silent.
export function loudestWindow(s, t0, t1, windowSec = 0.1) {
  const ms = Math.round(s.sr / 1000), [a, b] = span(s, t0, t1), w = Math.round(windowSec * 1000), n = Math.max(1, Math.ceil((b - a) / ms));
  const e = new Float64Array(n);
  for (let k = 0; k < n; k++) for (let i = a + k * ms; i < Math.min(b, a + (k + 1) * ms); i++) e[k] += s.left[i] * s.left[i] + s.right[i] * s.right[i];
  let best = -1, at = 0, run = 0;
  for (let k = 0; k < Math.max(n, w); k++) {
    run += k < n ? e[k] : 0;
    if (k >= w) run -= e[k - w];
    if (k >= Math.min(w, n) - 1 && run > best) { best = run; at = Math.max(0, k - w + 1); }
  }
  return best > 0 ? { t: (a + at * ms) / s.sr, db: 10 * Math.log10(best / (w * ms)) } : null;
}
// The level of [t0, t1), both channels' power summed, in dB (-Infinity when silent)
export function powerDb(s, t0, t1) {
  const [a, b] = span(s, t0, t1);
  let e = 0;
  for (let i = a; i < b; i++) e += s.left[i] * s.left[i] + s.right[i] * s.right[i];
  return e > 0 ? 10 * Math.log10(e / Math.max(1, b - a)) : -Infinity;
}
// The energy of both channels in consecutive blocks of `sec` (the density's 10 ms grid)
export function energyBlocks(s, sec) {
  const size = Math.round(sec * s.sr), n = Math.ceil(s.left.length / size), e = new Float64Array(n);
  for (let k = 0; k < n; k++) for (let i = k * size; i < Math.min(s.left.length, (k + 1) * size); i++) e[k] += s.left[i] * s.left[i] + s.right[i] * s.right[i];
  return { sec, size, e };
}

// ---------- third octaves (IEC 61260-1:2014) ----------
// The base-ten third-octave bands, G = 10 ^ (3 / 10): exact mid-band frequencies 1000 * G ^ (x / 3) for x = -16 (25 Hz)
// to 13 (20 kHz), band edges a twentieth of a decade either side (G ^ (1 / 6)), each with its nominal name.
const NOMINAL = [25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000];
export const THIRD_OCTAVES = Object.freeze(NOMINAL.map((nominal, i) => {
  const hz = 1000 * 10 ** ((i - 16) / 10);
  return Object.freeze({ nominal, hz, lo: hz * 10 ** (-1 / 20), hi: hz * 10 ** (1 / 20) });
}));

// A Butterworth band-pass between lo and hi Hz (order 3 per side, six poles: the usual class 1 realisation of IEC
// 61260), as three second-order sections. The analog prototype's poles are moved to the band (s -> (s^2 + w0^2) /
// (bw s)), the edges prewarped so the bilinear transform puts its -3 dB points on lo and hi, and each conjugate pair
// of poles gets one section with a zero at DC and one at Nyquist: 0 dB at the band's centre, by construction.
export function butterBandpass(sr, lo, hi, order = 3) {
  const K = 2 * sr, w1 = K * Math.tan(Math.PI * lo / sr), w2 = K * Math.tan(Math.PI * hi / sr), w0 = Math.sqrt(w1 * w2), bw = w2 - w1;
  const poles = [];
  for (let k = 0; k < order; k++) {
    const th = Math.PI * (2 * k + order + 1) / (2 * order), pr = Math.cos(th) * bw, pi = Math.sin(th) * bw;
    // the roots of s^2 - p bw s + w0^2: (p bw +- sqrt((p bw)^2 - 4 w0^2)) / 2, in complex numbers
    const dr = pr * pr - pi * pi - 4 * w0 * w0, di = 2 * pr * pi, m = Math.hypot(dr, di);
    const sr2 = Math.sqrt((m + dr) / 2), si2 = Math.sign(di || 1) * Math.sqrt(Math.max(0, (m - dr) / 2));
    for (const sg of [1, -1]) { const re = (pr + sg * sr2) / 2, im = (pi + sg * si2) / 2; if (im > 1e-9 * w0) poles.push([re, im]); }
  }
  if (poles.length !== order) throw new Error(`butterBandpass ${lo} to ${hi} Hz: ${poles.length} poles above the axis, want ${order}`);
  return poles.map(([re, im]) => {
    const a = -2 * re, b = re * re + im * im, d0 = K * K + a * K + b;
    return { b0: bw * K / d0, a1: (2 * b - 2 * K * K) / d0, a2: (K * K - a * K + b) / d0 };
  });
}
// x filtered through second-order sections of butterBandpass (b1 = 0, b2 = -b0), in place, transposed direct form II
function runSections(secs, x) {
  for (const { b0, a1, a2 } of secs) {
    let z1 = 0, z2 = 0;
    for (let i = 0; i < x.length; i++) { const v = x[i], y = b0 * v + z1; z1 = -a1 * y + z2; z2 = -b0 * v - a2 * y; x[i] = y; }
  }
  return x;
}
const BANKS = new Map();
// The bank for a sample rate: each band's sections, designed once (bands whose top edge passes Nyquist left out)
export function thirdOctaveBank(sr) {
  if (!BANKS.has(sr)) BANKS.set(sr, Object.freeze(THIRD_OCTAVES.filter((b) => b.hi < sr / 2).map((b) => Object.freeze({ ...b, secs: butterBandpass(sr, b.lo, b.hi) }))));
  return BANKS.get(sr);
}
// The level in each third octave of a window: `left` and `right` are a segment (Float32Arrays or plain arrays) that
// starts `from` samples before the window, so every band's filter has settled on what it was hearing (0.5 s settles
// the 25 Hz band, whose envelope has a time constant near 0.1 s, to under -40 dB), and the window is [from, to).
// Each band's level is both channels' power summed, in dB (-Infinity when silent). Returns [{ nominal, hz, db }].
export function bandLevels(left, right, sr, from, to) {
  return thirdOctaveBank(sr).map((b) => {
    let e = 0;
    for (const ch of [left, right]) { const y = runSections(b.secs, Float64Array.from(ch.subarray ? ch.subarray(0, to) : ch.slice(0, to))); for (let i = from; i < to; i++) e += y[i] * y[i]; }
    return { nominal: b.nominal, hz: b.hz, db: e > 0 ? 10 * Math.log10(e / (to - from)) : -Infinity };
  });
}
// A copy of s over [t0 - lead, t1): its samples where `keep(t)` holds, zeros elsewhere (a voice's own samples cut
// from a stem, or a stem minus another, by `minus`). Returns { left, right, from, to }: the window [t0, t1) is
// [from, to) of the copy.
export function segment(s, t0, t1, { lead = 0.5, minus = null, keep = null } = {}) {
  const [a, b] = span(s, t0 - lead, t1), [w0] = span(s, t0, t1), n = b - a, left = new Float32Array(n), right = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const k = a + i;
    if (keep && !keep(k / s.sr)) continue;
    left[i] = s.left[k] - (minus ? minus.left[k] : 0); right[i] = s.right[k] - (minus ? minus.right[k] : 0);
  }
  return { sr: s.sr, left, right, from: w0 - a, to: n };
}

// ---------- the phone and the mono fold-down (SOUND-PLAN 4.3 check 14) ----------
// The small loudspeaker a phone plays through, as a response for the safe-band check. A sealed micro speaker falls at
// 12 dB an octave below its resonance (a closed box is a second-order high-pass) and is limited at the top; one
// speaker plays the mono fold-down (L + R) / 2. Each number, its source and how strong it is (as SOUND-PLAN Appendix B
// grades them: primary read in the source, secondary a summary, excerpt seen only in a search result):
//   highpassHz 500   a phone speaker's resonance "usually around 500 Hz": a USPTO patent on bass compensation for
//                    phones, found by search, not opened (excerpt). The sources read agree on 500 to 700 Hz as where
//                    the output starts to fall (a patent on audio reproduction: flat "from about 700 Hz onwards",
//                    with a peak near 6 kHz; excerpt).
//   smallHz 800      a stricter case: a Knowles 11 x 15 x 3.5 mm phone speaker, resonance 800 Hz on a 1 cm3 closed
//                    back cavity (its datasheet, cdn.eicom.ru/media/PDF/3468456.pdf, seen in a search; excerpt).
//   order 2, Q 0.707 a closed-box driver below resonance is a second-order high-pass (R. H. Small, "Closed-box
//                    loudspeaker systems", JAES 1972; from memory, secondary); a Butterworth Q is a starting value.
//   lowpassHz 8000   the plan's own "low-pass near 8 kHz" (check 14's definition); the top of the 3GPP TS 26.131
//                    wideband hand-held hands-free receive mask is 8 kHz (a mirror of the clause, seen in a search;
//                    excerpt); one review measured a phone's speaker at 230 Hz to 10 kHz, +-3.5 dB (Sound & Vision,
//                    HTC One; excerpt). Second order, a starting value.
// None of these was measured on a phone here: the model is a defensible stand-in, and the levels it gives are changes
// against the stereo mix, not absolute phone levels.
export const PHONE_SPEAKER = Object.freeze({ highpassHz: 500, smallHz: 800, q: Math.SQRT1_2, lowpassHz: 8000 });

// The levels of a segment's window [from, to) (segment() above) as heard four ways, both channels' power summed, in
// dB: stereo; the mono fold-down M = (L + R) / 2 on both channels; its side S = (L - R) / 2 the same way (what the
// fold-down throws away); and the phone, M through the speaker (with the nominal resonance and the small one). A
// centred source loses nothing in mono, a hard-panned one 3 dB, one only in the side channel all of it.
export function foldDown(seg, sr, { phone = PHONE_SPEAKER } = {}) {
  const { left: L, right: R, from, to } = seg, n = to - from, pow = (f) => { let e = 0; for (let i = from; i < to; i++) { const v = f(i); e += v * v; } return e > 0 ? 10 * Math.log10(2 * e / n) : -Infinity; };
  const M = Float64Array.from(L, (x, i) => (x + R[i]) / 2);
  const speaker = (hz) => {
    const hp = new Biquad(sr, 'highpass', hz, phone.q), lp = new Biquad(sr, 'lowpass', phone.lowpassHz, phone.q), y = new Float64Array(M.length);
    for (let i = 0; i < M.length; i++) y[i] = lp.process(hp.process(M[i]));
    return y;
  };
  const P = speaker(phone.highpassHz), Q = speaker(phone.smallHz);
  let st = 0;
  for (let i = from; i < to; i++) st += L[i] * L[i] + R[i] * R[i];
  return { stereoDb: st > 0 ? 10 * Math.log10(st / n) : -Infinity, monoDb: pow((i) => M[i]), sideDb: pow((i) => (L[i] - R[i]) / 2), phoneDb: pow((i) => P[i]), smallPhoneDb: pow((i) => Q[i]) };
}

// ---------- measured density (check 11 on the stems) ----------
// Every `step` s, the voice groups sounding in the trailing `window` s (their energy over it) within `db` of the
// loudest group sounding then, or with a measured onset in the last `recent` s, and the bodies they belong to.
// groups: [{ name, body, blocks: energyBlocks(stem, step), onsets: [s] }]. Returns [{ t, fg: [names], bodies }].
export function measuredDensity(groups, { step, window, recent, db, total }) {
  const w = Math.round(window / step), out = [];
  for (let k = 0; k * step < total - EPS_T; k++) {
    const t = k * step, lv = {};
    for (const g of groups) {
      let e = 0;
      for (let j = Math.max(0, k - w + 1); j <= k; j++) e += g.blocks.e[j] ?? 0;
      lv[g.name] = e > 0 ? 10 * Math.log10(e / (w * g.blocks.size)) : -Infinity;
    }
    const loud = Math.max(-Infinity, ...Object.values(lv));
    const fg = groups.filter((g) => g.onsets.some((x) => x <= t + EPS_T && x > t - recent) || (lv[g.name] > -Infinity && lv[g.name] >= loud - db)).map((g) => g.name).sort();
    out.push({ t, fg, bodies: new Set(fg.map((n) => groups.find((g) => g.name === n).body)).size });
  }
  return out;
}
