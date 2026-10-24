// Measurements on rendered audio, shared by the audio tests and scripts: stems, levels, onsets, stereo balance.
// Everything takes Float32Arrays at a sample rate, times in seconds.
import { CONFIG } from '../../src/config.js';
import { renderSoundtrack } from '../../src/audio/index.js';

const cache = new Map();
// One layer (or several) alone: no reverb, no normalization, so onsets and levels are the layer's own. Cached per run.
export function stem(only) {
  const key = [].concat(only).join(',');
  if (!cache.has(key)) cache.set(key, renderSoundtrack(CONFIG, { only: [].concat(only), reverb: false, normalize: false }));
  return cache.get(key);
}

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
