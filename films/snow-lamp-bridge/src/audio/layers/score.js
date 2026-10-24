// The score: an original cue in D Dorian that enters at 40 s, after the car is dead, stays under everything, opens up
// at moonrise and resolves on the last wide. A pad of detuned saws (low-passed, slow attack and release), a two-operator
// FM bell, a sine sub an octave under the bass, and the music bus low-passed near 9 kHz, like 22 kHz samples. Not placed
// in the world: the pad is spread across the stereo field, the bells sit by pitch. Times and voicings: SOUND.md.
import { Biquad, TAU, clamp, midiToHz, smoothstep } from '../dsp.js';

const NOTE = { C: 0, 'C#': 1, D: 2, Eb: 3, E: 4, F: 5, 'F#': 6, G: 7, Bb: 10, A: 9, B: 11 };
export const midi = (name) => {
  const m = /^([A-G][b#]?)(-?\d)$/.exec(name);
  return 12 * (Number(m[2]) + 1) + NOTE[m[1]];
};

// chords on shots: [start, voicing]. Each holds until the next; a note common to both is held, not struck again.
export const CHORDS = [
  [40, 'D3 A3 E4 F4'], // Dm(add9), from nothing over 4 s
  [46, 'Bb2 F3 A3 D4'], // Bbmaj7
  [54, 'A2 F3 C4 E4'], // Fmaj7/A
  [60, 'G2 D3 F3 A3 Bb3'], // Gm9, the lean
  [68, 'D3 A3 E4 F4'], // moonrise
  [72, 'Bb2 F3 A3 D4'],
  [76, 'G2 D3 A3 Bb3'], // Gm(add9), under the lighter and B's look
  [89, 'Bb2 F3 A3 D4'],
  [94, 'A2 F3 C4 E4'],
  [100, 'G2 D3 F3 Bb3'], // Gm7
  [104, 'A2 E3 G3 D4'], // A7sus4
  [107, 'D3 A3 F#4 A4'], // D major, held into the fade
].map(([t, v]) => ({ t, notes: v.split(' ').map(midi) }));
export const SCORE_END = 112;

// the bell: the moonrise melody, the answers, the melody once more
export const BELLS = [
  ...['A4', 'D5', 'E5', 'F5', 'E5', 'D5', 'C5', 'A4'].map((n, i) => ({ t: 68.5 + i, note: n, vel: i === 3 ? 1 : 0.8 })),
  ...[['F5', 91], ['E5', 93], ['D5', 95]].map(([n, t]) => ({ t, note: n, vel: 0.6 })),
  ...[['A4', 101], ['D5', 102.5], ['E5', 104]].map(([n, t]) => ({ t, note: n, vel: 0.75 })),
].map((b) => ({ ...b, midi: midi(b.note) }));

// how loud the pad is through the cue, and how open its filter is (it opens at moonrise)
const DYN = [[40, 0.35], [46, 0.45], [60, 0.5], [68, 0.85], [76, 0.4], [89, 0.55], [100, 0.6], [107, 0.7]];
const OPEN = [[40, 1100], [60, 1250], [68, 1900], [76, 1000], [89, 1300], [100, 1500]];
const stepAt = (table, t) => { let v = table[0][1]; for (const [t0, x] of table) if (t >= t0) v = x; return v; };

// note spans for one voice part: consecutive chords holding the same pitch make one long note
function spans(chords, end) {
  const out = [], open = new Map();
  chords.forEach((c, i) => {
    const t1 = i + 1 < chords.length ? chords[i + 1].t : end;
    const now = new Set(c.notes);
    for (const [m, s] of open) if (!now.has(m)) { out.push(s); open.delete(m); }
    for (const m of c.notes) {
      if (open.has(m)) open.get(m).t1 = t1;
      else open.set(m, { midi: m, t0: c.t, t1 });
    }
  });
  for (const s of open.values()) out.push(s);
  return out.sort((a, b) => a.t0 - b.t0 || a.midi - b.midi);
}

// a band-limited saw (polyBLEP), phase in cycles
const blep = (p, dp) => (p < dp ? (p /= dp, p + p - p * p - 1) : p > 1 - dp ? (p = (p - 1) / dp, p * p + p + p + 1) : 0);

export function build(ctx) {
  const { sr, rngFor, config } = ctx;
  const S = config.audio.score;
  const rng = rngFor('audio:score');
  const ATTACK = 2, RELEASE = 3, FIRST_ATTACK = 4;

  // the pad: each span two saws a few cents apart, one leaning left and one right, with a slow drift
  const pad = spans(CHORDS, SCORE_END + RELEASE).map((s, i) => ({
    ...s,
    hz: midiToHz(s.midi),
    attack: s.t0 === CHORDS[0].t ? FIRST_ATTACK : ATTACK,
    saws: [-1, 1].map((side) => ({ p: rng(), cents: side * (5 + 3 * rng()), side, drift: { hz: 0.07 + 0.05 * rng(), ph: rng() * TAU } })),
    pan: clamp(((i % 5) - 2) * 0.18, -0.5, 0.5),
  }));
  // each saw's place in the stereo field: its note's pan, the two saws spread either side of it
  for (const s of pad) for (const w of s.saws) { const a = (clamp(s.pan + w.side * 0.35, -1, 1) + 1) * Math.PI / 4; w.gl = Math.cos(a); w.gr = Math.sin(a); }
  const livePad = [];
  // the sub: the lowest note of each chord an octave down, held through ties like the pad
  const sub = spans(CHORDS.map((c) => ({ t: c.t, notes: [Math.min(...c.notes) - 12] })), SCORE_END + RELEASE)
    .map((s) => ({ ...s, hz: midiToHz(s.midi), p: 0, attack: s.t0 === CHORDS[0].t ? FIRST_ATTACK + 2 : 3 }));
  const bells = BELLS.map((b) => ({ ...b, hz: midiToHz(b.midi), pan: clamp((b.midi - 74) / 10, -0.6, 0.6), pc: 0, pm: 0 }));

  const padLp = [0, 1].map(() => new Biquad(sr, 'lowpass', 1100, 0.9));
  const busLp = [0, 1].map(() => new Biquad(sr, 'lowpass', 9000, 0.7));
  let dyn = DYN[0][1], open = OPEN[0][1];
  const slew = 1 - Math.exp(-1 / (1.5 * sr)); // dynamics move over about 1.5 s, never in a step
  const env = (t, s) => smoothstep(s.t0, s.t0 + s.attack, t) * (1 - smoothstep(s.t1, s.t1 + RELEASE, t));

  return {
    name: 'score',
    bus: 'music',
    reverb: 0.45,
    process(L, R, i0, n) {
      const t0 = i0 / sr;
      if (t0 + n / sr < CHORDS[0].t) return; // silent until 40 s
      for (const f of padLp) f.set(open, 0.9); // the cutoff follows `open` block by block
      // the pad notes sounding in this block, their envelopes at its ends and each saw's pitch (the drift is slow)
      const t1 = (i0 + n) / sr;
      livePad.length = 0;
      for (const s of pad) {
        if (t1 < s.t0 || t0 > s.t1 + RELEASE) continue;
        s.e0 = env(t0, s); s.e1 = env(t1, s);
        for (const w of s.saws) w.dp = (s.hz * 2 ** ((w.cents + 2.5 * Math.sin(TAU * w.drift.hz * t0 + w.drift.ph)) / 1200)) / sr;
        livePad.push(s);
      }
      for (let k = 0; k < n; k++) {
        const t = (i0 + k) / sr;
        dyn += (stepAt(DYN, t) - dyn) * slew;
        open += (stepAt(OPEN, t) - open) * slew;
        let pl = 0, pr = 0;
        const u = k / n;
        for (const s of livePad) {
          const e = s.e0 + (s.e1 - s.e0) * u;
          for (const w of s.saws) {
            w.p += w.dp; if (w.p >= 1) w.p -= 1;
            const v = (2 * w.p - 1 - blep(w.p, w.dp)) * e;
            pl += v * w.gl; pr += v * w.gr;
          }
        }
        let ml = padLp[0].process(pl) * 0.05 * dyn * S.padGain, mr = padLp[1].process(pr) * 0.05 * dyn * S.padGain;
        let sv = 0;
        for (const s of sub) {
          if (t < s.t0 || t > s.t1 + RELEASE) continue;
          s.p += s.hz / sr; if (s.p >= 1) s.p -= 1;
          sv += Math.sin(TAU * s.p) * env(t, s);
        }
        ml += sv * 0.06 * S.subGain * smoothstep(40, 46, t); mr += sv * 0.06 * S.subGain * smoothstep(40, 46, t);
        for (const b of bells) {
          const dt = t - b.t;
          if (dt < 0 || dt > 6) continue;
          // two operators at 1 : 3.5, the index falling fast (the strike) to a soft tail
          b.pm += (b.hz * 3.5) / sr; if (b.pm >= 1) b.pm -= 1;
          b.pc += b.hz / sr; if (b.pc >= 1) b.pc -= 1;
          const index = 2.2 * Math.exp(-dt / 0.35) + 0.3;
          const v = Math.sin(TAU * b.pc + index * Math.sin(TAU * b.pm)) * Math.min(1, dt / 0.002) * Math.exp(-dt / 1.8) * b.vel;
          const a = (b.pan + 1) * Math.PI / 4;
          ml += v * Math.cos(a) * 0.09 * S.bellGain; mr += v * Math.sin(a) * 0.09 * S.bellGain;
        }
        L[k] += busLp[0].process(ml) * S.level;
        R[k] += busLp[1].process(mr) * S.level;
      }
    },
  };
}
