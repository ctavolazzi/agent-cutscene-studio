// Where a sound sits in the stereo field, from where its source is relative to the camera of the shot playing at that
// moment (src/shots.js). So the car pans with the picture and a cut moves the listener with the camera, as the eye
// moves. Pan from the source's direction in the camera's frame, level from distance (inverse distance past a reference
// radius), a lowpass from distance (air) and a darker, quieter sound behind the camera.
import { cameraAt, shotAt } from '../shots.js';
import { clamp, OnePole } from './dsp.js';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// The listener at time t: the camera's position, forward and right (right = forward x up, as scripts/lib/math.js)
export function listenerAt(t) {
  const c = cameraAt(shotAt(t), t);
  const f = norm(sub(c.target, c.pos));
  const r = norm(cross(f, [0, 1, 0]));
  return { pos: c.pos, f, r };
}

// axisDeg: the cone round the listener's vertical axis where the azimuth is degenerate (below). A starting value: the
// closest any placed sound comes to that axis today is 28 degrees (the lamp's hum from shot 4's camera), parked layers
// and cues.js alike, so the guard changes nothing in today's mix (tests/spatial.test.mjs).
export const SPATIAL = { refDist: 1.5, airMeters: 60, minAirHz: 1800, behindGain: 0.75, behindAir: 0.45, axisDeg: 10 };

// The sine of a source's angle from the listener's vertical axis (the camera's up): 0 straight above or below it.
export function axisSine(p, L) {
  const d = sub(p, L.pos), dist = Math.hypot(d[0], d[1], d[2]);
  return dist > 0 ? Math.hypot(dot(d, L.r), dot(d, L.f)) / dist : 0;
}

// How a source at world point p sounds from the listener: pan -1..1, gain, and a lowpass cutoff in Hz. `refDist` and
// `rolloff` set the distance law, gain = (refDist / dist) ^ rolloff past refDist: 1 is the physical law (6 dB a
// doubling); a loud source heard across the set (the car) uses a gentler one, as a film mix does.
export function placeAt(p, t, L = listenerAt(t), { refDist = SPATIAL.refDist, rolloff = 1 } = {}) {
  const d = sub(p, L.pos), dist = Math.hypot(d[0], d[1], d[2]);
  const x = dot(d, L.r), z = dot(d, L.f);
  const flat = Math.hypot(x, z) || 1;
  let pan = clamp(x / flat, -1, 1);
  let gain = (refDist / Math.max(refDist, dist)) ** rolloff;
  let hz = Math.max(SPATIAL.minAirHz, 20000 * Math.exp(-dist / SPATIAL.airMeters));
  // Near the vertical axis the azimuth is degenerate: a tiny pitch would flip the pan and switch the behind loss on and
  // off. Inside the cone the pan shrinks toward the centre and the behind loss toward half, both continuous at its edge.
  const edge = Math.sin(SPATIAL.axisDeg * Math.PI / 180), s = dist > 0 ? Math.hypot(x, z) / dist : 0;
  if (s < edge) {
    const w = s / edge, b = 0.5 + ((z < 0 ? 1 : 0) - 0.5) * w;
    pan *= w; gain *= 1 + (SPATIAL.behindGain - 1) * b; hz *= 1 + (SPATIAL.behindAir - 1) * b;
  } else if (z < 0) { gain *= SPATIAL.behindGain; hz *= SPATIAL.behindAir; }
  return { pan, gain, hz, dist };
}

// A voice placed in space. place(t) is where its source is (or null when it is nowhere). Each block of samples is
// panned and levelled with gains interpolated from the block's start to its end (so a cut moves the sound within one
// block, a few ms, never a click), and passed through a lowpass that follows the distance.
export function makeSpatializer(sr, place, law = {}) {
  const lpL = new OnePole(sr, 20000), lpR = new OnePole(sr, 20000);
  const gainsAt = (t) => {
    const p = place(t);
    if (!p) return { l: 0, r: 0, hz: 20000 };
    const s = placeAt(p, t, undefined, law);
    const a = (s.pan + 1) * Math.PI / 4;
    return { l: Math.cos(a) * s.gain, r: Math.sin(a) * s.gain, hz: s.hz };
  };
  return {
    // mono in (n samples from sample i0), added into L and R
    process(mono, L, R, i0, n) {
      const a = gainsAt(i0 / sr), b = gainsAt((i0 + n) / sr);
      const hz = (a.hz + b.hz) / 2;
      lpL.setHz(hz); lpR.setHz(hz);
      for (let k = 0; k < n; k++) {
        const u = k / n, x = mono[k];
        L[k] += lpL.process(x * (a.l + (b.l - a.l) * u));
        R[k] += lpR.process(x * (a.r + (b.r - a.r) * u));
      }
    },
  };
}
