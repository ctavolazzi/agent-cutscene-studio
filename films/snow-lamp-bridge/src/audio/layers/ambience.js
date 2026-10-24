// The bed under everything: wind (louder on the bridge), the distant city, the sodium lamp's ballast hum (placed at
// the lantern, so it is close in shot 1 and gone across the street), and the river under the bridge (placed below the
// deck, so it rises as they walk onto the bridge). Seeded noise and pure functions of t only.
import { LAMP, BRIDGE } from '../../set.js';
import { Biquad, OnePole, pink, brown, white, TAU, smoothstep } from '../dsp.js';
import { listenerAt } from '../spatial.js';

// a slow, smooth wander in about -1..1, from a few incommensurate sines with seeded phases
function wander(rng, rates) {
  const parts = rates.map((hz) => ({ hz: hz * (0.85 + 0.3 * rng()), ph: rng() * TAU }));
  return (t) => parts.reduce((s, p) => s + Math.sin(TAU * p.hz * t + p.ph), 0) / parts.length;
}

export function build(ctx) {
  const { sr, rngFor, spatializer, config } = ctx;
  const A = config.audio.ambience;
  const rng = rngFor('audio:ambience');

  // wind: two decorrelated pink noises through bandpasses that wander, with gusts
  const wind = [0, 1].map((ch) => ({
    noise: pink(rngFor(`audio:wind:${ch}`)),
    bp: new Biquad(sr, 'bandpass', 500, 0.6),
    lp: new OnePole(sr, 2500),
    centre: wander(rng, [0.031, 0.047, 0.083]),
  }));
  const gust = wander(rng, [0.06, 0.11, 0.023]);

  // the city: brown noise, very low, a little wider than mono
  const city = [0, 1].map((ch) => ({ noise: brown(rngFor(`audio:city:${ch}`)), lp: new Biquad(sr, 'lowpass', 220, 0.7), hp: new Biquad(sr, 'highpass', 45, 0.7) }));

  // the lamp: a 120 Hz ballast buzz with odd and even harmonics, placed at the lantern
  const hum = spatializer(() => LAMP.head);
  const humBuf = new Float32Array(1024);

  // the river: bandpassed noise with a fast, uneven surface modulation, placed under the deck in front of the listener
  const river = spatializer((t) => { const L = listenerAt(t); return [L.pos[0], BRIDGE.waterY, Math.min(-12, Math.max(-34, L.pos[2] - 6))]; });
  const riverNoise = white(rngFor('audio:river')), riverBp = new Biquad(sr, 'bandpass', 700, 0.5), riverLp = new OnePole(sr, 1800);
  const ripple = wander(rng, [3.1, 4.7, 7.3, 1.9]);
  const riverBuf = new Float32Array(1024);

  return {
    name: 'ambience',
    bus: 'amb',
    reverb: 0.15,
    process(L, R, i0, n) {
      const t0 = i0 / sr, lis = listenerAt(t0);
      // on the bridge deck (south abutment z -8, north z -38) the wind is stronger
      const onBridge = smoothstep(-6, -10, lis.pos[2]) * smoothstep(-40, -36, lis.pos[2]);
      const windGain = A.windGain * (1 + A.bridgeWindBoost * onBridge);
      for (let k = 0; k < n; k++) {
        const t = (i0 + k) / sr;
        const g = windGain * (0.55 + 0.45 * (0.5 + 0.5 * gust(t)));
        for (let ch = 0; ch < 2; ch++) {
          const w = wind[ch];
          if (k === 0) w.bp.set(420 + 260 * w.centre(t), 0.6);
          const v = w.lp.process(w.bp.process(w.noise())) * g;
          const c = city[ch].hp.process(city[ch].lp.process(city[ch].noise())) * A.cityGain;
          if (ch === 0) L[k] += v + c; else R[k] += v + c;
        }
        humBuf[k] = A.humGain * (Math.sin(TAU * 120 * t) + 0.5 * Math.sin(TAU * 240 * t + 0.3) + 0.25 * Math.sin(TAU * 360 * t + 1.1) + 0.12 * Math.sin(TAU * 600 * t + 2.0));
        riverBuf[k] = riverLp.process(riverBp.process(riverNoise())) * A.riverGain * (0.6 + 0.4 * ripple(t));
      }
      hum.process(humBuf, L, R, i0, n);
      river.process(riverBuf, L, R, i0, n);
    },
  };
}
