// The template's example layer: the bed under the picture. Wind (two decorrelated pink noises through bandpasses that
// wander, with gusts) and the lamp's 120 Hz ballast hum, placed at the lantern so it pans and fades with each camera,
// and dipping with the light's own flicker (lampFlicker), so what you hear and what you see move together.
// Seeded noise and pure functions of t only. Replace it with your film's sounds, one layer per kind of sound.
import { LAMP } from '../../set.js';
import { lampFlicker } from '../../world.js';
import { Biquad, OnePole, TAU, pink } from '../dsp.js';

// a slow, smooth wander in about -1..1, from a few incommensurate sines with seeded phases
function wander(rng, rates) {
  const parts = rates.map((hz) => ({ hz: hz * (0.85 + 0.3 * rng()), ph: rng() * TAU }));
  return (t) => parts.reduce((s, p) => s + Math.sin(TAU * p.hz * t + p.ph), 0) / parts.length;
}

export function build(ctx) {
  const { sr, rngFor, spatializer, config } = ctx;
  const A = config.audio.ambience;
  const rng = rngFor('audio:ambience');

  const wind = [0, 1].map((ch) => ({
    noise: pink(rngFor(`audio:wind:${ch}`)),
    bp: new Biquad(sr, 'bandpass', 500, 0.6),
    lp: new OnePole(sr, 2500),
    centre: wander(rng, [0.031, 0.047, 0.083]),
  }));
  const gust = wander(rng, [0.06, 0.11, 0.023]);

  const hum = spatializer(() => LAMP.head);
  const humBuf = new Float32Array(1024);

  return {
    name: 'ambience',
    bus: 'amb',
    reverb: 0.15,
    process(L, R, i0, n) {
      for (let k = 0; k < n; k++) {
        const t = (i0 + k) / sr;
        const g = A.windGain * (0.55 + 0.45 * (0.5 + 0.5 * gust(t)));
        for (let ch = 0; ch < 2; ch++) {
          const w = wind[ch];
          if (k === 0) w.bp.set(420 + 260 * w.centre(t), 0.6);
          const v = w.lp.process(w.bp.process(w.noise())) * g;
          if (ch === 0) L[k] += v; else R[k] += v;
        }
        const f = lampFlicker(t);
        humBuf[k] = A.humGain * f * f * (Math.sin(TAU * 120 * t) + 0.5 * Math.sin(TAU * 240 * t + 0.3) + 0.25 * Math.sin(TAU * 360 * t + 1.1));
      }
      hum.process(humBuf, L, R, i0, n);
    },
  };
}
