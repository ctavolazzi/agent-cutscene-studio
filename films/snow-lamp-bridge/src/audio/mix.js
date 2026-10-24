// The mixer: renders every layer front to back in blocks, sums them into buses (ambience, effects, music), feeds a
// reverb send, applies the master chain (highpass, the fade in that matches the picture's, a fade out on the last
// frames), then normalizes the finished film to the target loudness under a peak ceiling.
//
// A layer is a module in src/audio/layers/ exporting build(ctx) that returns
//   { name, bus: 'amb' | 'fx' | 'music', reverb: 0..1, process(L, R, i0, n) }
// process ADDS n samples starting at sample i0 (time i0 / sr) into L and R (Float32Arrays of length >= n, zeroed for
// it). It is called once per block, in order, from sample 0 to the end, so it may keep filter state between calls.
// ctx = { sr, total, config, rngFor(name), spatializer(place) } (see src/audio/index.js).
import { Biquad, Reverb, dbToGain, smoothstep } from './dsp.js';
import { normalize } from './loudness.js';

export const BLOCK = 256;

export function* renderBlocks({ layers, config, sr, total, reverb = true }) {
  const A = config.audio;
  const n = Math.round(total * sr);
  const busGain = Object.fromEntries(Object.entries(A.buses).map(([k, db]) => [k, dbToGain(db)]));
  const verb = new Reverb(sr, A.reverb);
  const ret = dbToGain(A.reverb.returnDb);
  const hp = [new Biquad(sr, 'highpass', A.masterHighpassHz, 0.7), new Biquad(sr, 'highpass', A.masterHighpassHz, 0.7)];
  const tl = new Float32Array(BLOCK), tr = new Float32Array(BLOCK), send = new Float32Array(BLOCK);
  for (let i0 = 0; i0 < n; i0 += BLOCK) {
    const m = Math.min(BLOCK, n - i0);
    const L = new Float32Array(m), R = new Float32Array(m);
    send.fill(0);
    for (const layer of layers) {
      tl.fill(0); tr.fill(0);
      layer.process(tl, tr, i0, m);
      const g = busGain[layer.bus] ?? 1, s = (layer.reverb ?? 0) * g;
      for (let k = 0; k < m; k++) {
        L[k] += tl[k] * g; R[k] += tr[k] * g;
        send[k] += (tl[k] + tr[k]) * 0.5 * s;
      }
    }
    for (let k = 0; k < m; k++) {
      const t = (i0 + k) / sr;
      let l = L[k], r = R[k];
      if (reverb) { const [vl, vr] = verb.process(send[k]); l += vl * ret; r += vr * ret; }
      const fade = smoothstep(0, A.fadeIn, t) * smoothstep(total, total - A.fadeOut, t);
      L[k] = hp[0].process(l) * fade;
      R[k] = hp[1].process(r) * fade;
    }
    yield { i0, n: m, L, R };
  }
}

// The whole film: { sr, left, right, stats }. normalize: false leaves the raw mix (stems and tests).
export function renderAll({ layers, config, sr, total, reverb = true, normalize: norm = true }) {
  const n = Math.round(total * sr);
  const left = new Float32Array(n), right = new Float32Array(n);
  for (const b of renderBlocks({ layers, config, sr, total, reverb })) { left.set(b.L, b.i0); right.set(b.R, b.i0); }
  const stats = norm ? normalize(left, right, config.audio, sr) : null;
  return { sr, left, right, stats };
}
