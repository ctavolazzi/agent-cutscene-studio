// Loudness to ITU-R BS.1770-4 / EBU R128 (integrated, gated), the peak limiter and the normalization that sets the
// final level. The meter is checked against ffmpeg's ebur128 filter in tests/audio.test.mjs.
import { dbToGain, gainToDb } from './dsp.js';

// K-weighting at 48 kHz: the pre-filter (high shelf) and the RLB highpass, coefficients from BS.1770-4
const K = [
  { b: [1.53512485958697, -2.69169618940638, 1.19839281085285], a: [-1.69065929318241, 0.73248077421585] },
  { b: [1.0, -2.0, 1.0], a: [-1.99004745483398, 0.99007225036621] },
];

function kWeighted(x) {
  let y = x;
  for (const { b, a } of K) {
    const out = new Float64Array(y.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < y.length; i++) {
      const v = b[0] * y[i] + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2;
      x2 = x1; x1 = y[i]; y2 = y1; y1 = v; out[i] = v;
    }
    y = out;
  }
  return y;
}

// Integrated loudness in LUFS of a stereo signal at 48 kHz (-Infinity for silence)
export function integratedLufs(left, right, sr = 48000) {
  if (sr !== 48000) throw new Error('the K-weighting coefficients here are for 48 kHz');
  const kl = kWeighted(left), kr = kWeighted(right);
  const block = Math.round(0.4 * sr), step = Math.round(0.1 * sr);
  const z = [];
  for (let s = 0; s + block <= kl.length; s += step) {
    let a = 0, b = 0;
    for (let i = s; i < s + block; i++) { a += kl[i] * kl[i]; b += kr[i] * kr[i]; }
    z.push((a + b) / block);
  }
  const lufs = (ms) => -0.691 + 10 * Math.log10(ms);
  const abs = z.filter((v) => lufs(v) > -70);
  if (!abs.length) return -Infinity;
  const rel = lufs(abs.reduce((s, v) => s + v, 0) / abs.length) - 10;
  const gated = abs.filter((v) => lufs(v) > rel);
  return lufs(gated.reduce((s, v) => s + v, 0) / gated.length);
}

export function samplePeak(left, right) {
  let p = 0;
  for (let i = 0; i < left.length; i++) p = Math.max(p, Math.abs(left[i]), Math.abs(right[i]));
  return p;
}

// Offline peak limiter: every sample ends at or under `ceiling`. The gain starts falling `attack` samples before a
// peak (a symmetric minimum over the window) and recovers at `release` per sample, so it never clicks.
export function limit(left, right, ceiling, sr = 48000, attackMs = 2, releaseMs = 120) {
  const n = left.length, need = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = Math.max(Math.abs(left[i]), Math.abs(right[i]));
    need[i] = p > ceiling ? ceiling / p : 1;
  }
  const att = Math.max(1, Math.round(attackMs * sr / 1000)), rel = 1 / Math.max(1, releaseMs * sr / 1000);
  const env = new Float32Array(n);
  // the minimum of the needed gain over [i - att, i + att], with a straight-line approach into each dip
  for (let i = 0; i < n; i++) env[i] = 1;
  for (let i = 0; i < n; i++) {
    if (need[i] >= 1) continue;
    for (let k = -att; k <= att; k++) {
      const j = i + k;
      if (j < 0 || j >= n) continue;
      const g = need[i] + (1 - need[i]) * (Math.abs(k) / (att + 1));
      if (g < env[j]) env[j] = g;
    }
  }
  let g = 1, reduced = 0;
  for (let i = 0; i < n; i++) {
    g = Math.min(env[i], g + rel);
    if (g < 1) reduced++;
    left[i] *= g; right[i] *= g;
  }
  return { reducedSamples: reduced };
}

// Set the integrated loudness to `targetLufs`, then hold every sample under `ceilingDb`. Limiting loud transients
// takes their energy out of the measurement, so the gain is corrected and the limiter run again (a few passes at most,
// each from the unlimited signal) until the limited result reads the target. Works in place. Returns what it did.
export function normalize(left, right, { targetLufs, ceilingDb }, sr = 48000, passes = 4) {
  const before = integratedLufs(left, right, sr);
  if (!Number.isFinite(before)) return { lufsBefore: before, gainDb: 0, peakBeforeLimitDb: -Infinity, limitedSamples: 0, passes: 0, lufs: before, peakDb: -Infinity };
  const srcL = Float32Array.from(left), srcR = Float32Array.from(right);
  let gainDb = targetLufs - before, lufs = before, peakBefore = 0, lim = null, pass = 0;
  while (pass < passes) {
    pass++;
    const g = dbToGain(gainDb);
    for (let i = 0; i < left.length; i++) { left[i] = srcL[i] * g; right[i] = srcR[i] * g; }
    peakBefore = gainToDb(samplePeak(left, right));
    lim = limit(left, right, dbToGain(ceilingDb), sr);
    lufs = integratedLufs(left, right, sr);
    if (Math.abs(lufs - targetLufs) < 0.05) break;
    gainDb += targetLufs - lufs;
  }
  return {
    lufsBefore: +before.toFixed(3), gainDb: +gainDb.toFixed(3), peakBeforeLimitDb: +peakBefore.toFixed(2),
    limitedSamples: lim.reducedSamples, passes: pass, lufs: +lufs.toFixed(3), peakDb: +gainToDb(samplePeak(left, right)).toFixed(2),
  };
}
