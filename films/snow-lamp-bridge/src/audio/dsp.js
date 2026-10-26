// DSP primitives for the soundtrack. Plain JavaScript, no Web Audio, so the same code renders in Node (the export)
// and in the browser (the player's worker). Filters keep state, so a voice must be fed its samples in order: the mixer
// renders the whole film once, front to back. Randomness only from the seeded PRNG handed in (rngFor(name)).

export const TAU = Math.PI * 2;
export const dbToGain = (db) => 10 ** (db / 20);
export const gainToDb = (g) => 20 * Math.log10(Math.max(g, 1e-12));
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const smoothstep = (a, b, x) => { const u = clamp((x - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); };

// white noise in -1..1 from a seeded PRNG
export const white = (rng) => () => rng() * 2 - 1;

// Paul Kellet's economy pink noise filter over white noise: about -3 dB an octave
export function pink(rng) {
  let b0 = 0, b1 = 0, b2 = 0;
  return () => {
    const w = rng() * 2 - 1;
    b0 = 0.99765 * b0 + w * 0.099046;
    b1 = 0.963 * b1 + w * 0.2965164;
    b2 = 0.57 * b2 + w * 1.0526913;
    return (b0 + b1 + b2 + w * 0.1848) * 0.2;
  };
}

// brown (red) noise: integrated white, leaky so it stays bounded
export function brown(rng) {
  let y = 0;
  return () => { y = (y + 0.02 * (rng() * 2 - 1)) * 0.998; return y * 3.5; };
}

// One-pole lowpass or highpass. setHz may be called every block for a moving cutoff.
export class OnePole {
  constructor(sr, hz, type = 'lp') { this.sr = sr; this.type = type; this.y = 0; this.x1 = 0; this.setHz(hz); }
  setHz(hz) { this.a = Math.exp(-TAU * clamp(hz, 1, this.sr * 0.49) / this.sr); }
  process(x) {
    const lp = (this.y = (1 - this.a) * x + this.a * this.y);
    return this.type === 'lp' ? lp : x - lp;
  }
}

// RBJ cookbook biquad, transposed direct form II. Types: lowpass, highpass, bandpass (0 dB peak), peaking,
// lowshelf, highshelf, notch.
export class Biquad {
  constructor(sr, type, hz, q = Math.SQRT1_2, gainDb = 0) {
    this.sr = sr; this.type = type; this.z1 = 0; this.z2 = 0; this.set(hz, q, gainDb);
  }
  set(hz, q = this.q, gainDb = this.gainDb) {
    this.q = q; this.gainDb = gainDb;
    const w = TAU * clamp(hz, 1, this.sr * 0.49) / this.sr, cw = Math.cos(w), sw = Math.sin(w), alpha = sw / (2 * q);
    const A = 10 ** (gainDb / 40);
    let b0, b1, b2, a0, a1, a2;
    switch (this.type) {
      case 'lowpass': b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
      case 'highpass': b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
      case 'bandpass': b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
      case 'notch': b0 = 1; b1 = -2 * cw; b2 = 1; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
      case 'peaking': b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A; break;
      case 'lowshelf': {
        const s = 2 * Math.sqrt(A) * alpha;
        b0 = A * ((A + 1) - (A - 1) * cw + s); b1 = 2 * A * ((A - 1) - (A + 1) * cw); b2 = A * ((A + 1) - (A - 1) * cw - s);
        a0 = (A + 1) + (A - 1) * cw + s; a1 = -2 * ((A - 1) + (A + 1) * cw); a2 = (A + 1) + (A - 1) * cw - s; break;
      }
      case 'highshelf': {
        const s = 2 * Math.sqrt(A) * alpha;
        b0 = A * ((A + 1) + (A - 1) * cw + s); b1 = -2 * A * ((A - 1) + (A + 1) * cw); b2 = A * ((A + 1) + (A - 1) * cw - s);
        a0 = (A + 1) - (A - 1) * cw + s; a1 = 2 * ((A - 1) - (A + 1) * cw); a2 = (A + 1) - (A - 1) * cw - s; break;
      }
      default: throw new Error(`unknown biquad type ${this.type}`);
    }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
    return this;
  }
  process(x) {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
}

// Envelopes as pure functions of the time since an event (seconds): 0 before it.
export const expDecay = (dt, tau) => (dt < 0 ? 0 : Math.exp(-dt / tau));
// a linear attack then an exponential decay
export const attackDecay = (dt, attack, tau) => (dt < 0 ? 0 : dt < attack ? dt / attack : Math.exp(-(dt - attack) / tau));
// a raised-cosine window over [t0, t1] with fades of `fade` seconds at each end
export function windowed(t, t0, t1, fade) {
  if (t <= t0 || t >= t1) return 0;
  const a = Math.min(1, (t - t0) / fade), b = Math.min(1, (t1 - t) / fade);
  return 0.5 - 0.5 * Math.cos(Math.PI * Math.min(a, b));
}

// equal-power pan, p in -1 (left) .. 1 (right)
export function panGains(p) {
  const a = (clamp(p, -1, 1) + 1) * Math.PI / 4;
  return [Math.cos(a), Math.sin(a)];
}

export const midiToHz = (m) => 440 * 2 ** ((m - 69) / 12);

// A Freeverb-style reverb (8 combs and 4 allpasses a channel, tunings from Jezar's Freeverb scaled to the sample
// rate), standing in for the PS1 SPU's reverb unit: short and a little metallic, low-passed in the tank.
export class Reverb {
  constructor(sr, { room = 0.78, damp = 0.45, width = 1, predelayMs = 20 } = {}) {
    const k = sr / 44100, spread = 23;
    const combT = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617], apT = [556, 441, 341, 225];
    const make = (n) => ({ buf: new Float32Array(Math.max(1, Math.round(n * k))), i: 0, store: 0 });
    this.combs = [combT.map(make), combT.map((n) => make(n + spread))];
    this.aps = [apT.map(make), apT.map((n) => make(n + spread))];
    this.feedback = room; this.damp = damp; this.width = width;
    this.pre = new Float32Array(Math.max(1, Math.round(predelayMs * sr / 1000))); this.pi = 0;
  }
  // input mono, returns [l, r]
  process(x) {
    const d = this.pre[this.pi]; this.pre[this.pi] = x; this.pi = (this.pi + 1) % this.pre.length;
    const input = d * 0.015;
    const out = [0, 0];
    for (let ch = 0; ch < 2; ch++) {
      let acc = 0;
      for (const c of this.combs[ch]) {
        const y = c.buf[c.i];
        c.store = y * (1 - this.damp) + c.store * this.damp;
        c.buf[c.i] = input + c.store * this.feedback;
        c.i = (c.i + 1) % c.buf.length;
        acc += y;
      }
      for (const a of this.aps[ch]) {
        const b = a.buf[a.i];
        a.buf[a.i] = acc + b * 0.5;
        a.i = (a.i + 1) % a.buf.length;
        acc = b - acc;
      }
      out[ch] = acc;
    }
    const w1 = this.width / 2 + 0.5, w2 = (1 - this.width) / 2;
    return [out[0] * w1 + out[1] * w2, out[1] * w1 + out[0] * w2];
  }
}
