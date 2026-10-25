// Measurements on rendered audio, shared by the audio tests and scripts: stems, levels, onsets, stereo balance.
// Everything takes Float32Arrays at a sample rate, times in seconds.
import { CONFIG } from '../../src/config.js';
import { atStage, buildLayers, renderSoundtrack } from '../../src/audio/index.js';
import { CUES } from '../../src/audio/cues.js';
import { dbToGain } from '../../src/audio/dsp.js';
import { integratedLufs } from '../../src/audio/loudness.js';
import { BLOCK } from '../../src/audio/mix.js';
import { T_TOTAL } from '../../src/world.js';

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
export function onsets(left, right, sr, { ratioDb = 12, floorDb = -60, minGap = 0.08, lookback = 0.25, from = 0, to = Infinity } = {}) {
  const hop = Math.round(sr / 1000), env = [];
  for (let i = 0; i + hop <= left.length; i += hop) {
    let p = 0;
    for (let k = i; k < i + hop; k++) p = Math.max(p, Math.abs(left[k]), Math.abs(right[k]));
    env.push(p);
  }
  const look = Math.round(lookback * 1000), floor = 10 ** (floorDb / 20), ratio = 10 ** (ratioDb / 20);
  const out = [];
  let last = -Infinity;
  for (let j = 1; j < env.length; j++) {
    const t = j / 1000;
    if (t < from || t > to || t - last < minGap) continue;
    const prev = env.slice(Math.max(0, j - look), j).sort((x, y) => x - y);
    const med = prev[Math.floor(prev.length / 2)] ?? 0;
    if (env[j] > floor && env[j] > ratio * Math.max(med, 1e-9)) { out.push(t); last = t; }
  }
  return out;
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
