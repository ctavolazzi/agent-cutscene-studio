// The blockout's voices (SOUND-PLAN 4.4): grey-box sound. One simple, obviously temporary timbre per family, made from
// the cue alone: its span, its track, its level, its place and its law (cues.js). Each voice draws its own seeded noise,
// rngFor('audio:blockout:' + id): the SPU has one noise generator for every voice, and a sample per voice is the PS1
// workaround. Pitch or level follows the cue's track where SOUND-PLAN 4.4's table says.
//
// The level rule. A cue's level is dB against the street background, at its law's refDist (cues.js LEVELS). A voice is
// scaled so that the RMS of its loudest LEVEL.windowSec (the level plan's 100 ms) is REF * 10 ^ (level / 20) after its
// bus, where REF is the street background's RMS over both channels (LEVEL.refDb). At refDist the law's gain is 1 and
// the pan is equal power, so a mono voice's power there is its stereo power: a step at 14 dB has a loudest 100 ms 14 dB
// over the street background, as the level plan states its rules. A steady voice's loudest window is its steady level;
// a background's level is its RMS over its whole span, both channels. Each layer divides out its bus gain
// (config.audio.buses), so the planned relative levels hold whatever the buses are. The modifiers (voices 0: the rise,
// the swell, the ambience changes) act after the scaling, in dB, and are not part of a voice's level.
import { CUES, LAWS, WORLD } from '../../cues.js';
import { Biquad, TAU, attackDecay, brown, dbToGain, pink } from '../../dsp.js';
import { BLOCK } from '../../mix.js';
import { LEVEL, TIMBRE, TOL } from './timbre.js';

// The catalogue a layer reads: cues.js's, or the one the context hands over (a changed picture, a stem's subset).
export const cueList = (ctx) => ctx.cues ?? CUES;
// The cues of a category that sound: enabled, with a voice (the offered ones stay out, Gate 0)
export const sounding = (list, category) => list.filter((c) => c.enabled && c.voices > 0 && c.category === category);
// A cue's part, the last field of its id (category.family.source.part), which names what it is: unlatch, latch, creak
export const partOf = (c) => c.id.slice(c.id.lastIndexOf('.') + 1);

const amp = (db) => dbToGain(LEVEL.refDb + db);
const band = (sr, hz, q) => [new Biquad(sr, 'bandpass', hz, q), new Biquad(sr, 'bandpass', hz, q)];
const through = (f, x) => f[1].process(f[0].process(x));
const retune = (f, hz) => { f[0].set(hz); f[1].set(hz); };
const white = (rng) => rng() * 2 - 1;
const saw = (ph) => (ph - Math.floor(ph)) * 2 - 1;
// the band offset of a person or a surface: its index in the picture's list, centred, `octaves` apart
const offset = (names, name, octaves) => (names.indexOf(name) - (names.length - 1) / 2) * octaves;
const PEOPLE = Object.keys(WORLD.PEOPLE); // A first: A lower, B higher
const SURFACES = [...new Set(CUES.filter((c) => c.family === 'feet').map((c) => c.surface))].sort();

// A cue's track sampled every BLOCK samples over its span (the rate the spatializer moves a voice), read back with
// linear interpolation: a track calls the picture's functions, too slow to call every sample. `max(key)` and `at0(key)`
// give the value's largest magnitude over the span and its value at the onset.
export function sampleTrack(c, sr) {
  if (!c.track) return null;
  const step = BLOCK / sr, n = Math.ceil((c.t1 - c.t0) / step) + 1, rows = [];
  for (let k = 0; k <= n; k++) rows.push(c.track(c.t0 + k * step));
  const cols = Object.fromEntries(Object.keys(rows[0]).map((key) => [key, Float64Array.from(rows, (r) => r[key])]));
  const at = (key, dt) => { const a = cols[key], x = Math.min(n, Math.max(0, dt / step)), i = Math.min(n - 1, Math.floor(x)); return a[i] + (a[i + 1] - a[i]) * (x - i); };
  at.max = (key) => cols[key].reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  at.at0 = (key) => cols[key][0];
  return at;
}

// The modifiers acting on a cue: enabled cues without a voice whose meta.modifies names its family, over a span that
// meets the cue's. Each changes the level by its own level times its track's first value, read inside its span, so it
// holds its last value after its end. That value reads 0 at the modifier's start (checked), so the voice does not jump
// as it begins: the swell, the wind easing, the night opening, the idle louder through an open door (offered). One that
// starts with the voice it acts on is an entry, from its level at the onset up to 0 at its end, where the value reads 1
// (checked): the rise out of the quiet. Returns t -> the change in dB.
export function modifiersOf(c, list, sr) {
  const fns = list.filter((m) => m.enabled && m.voices === 0 && m.meta.modifies?.includes(c.family) && m.t0 < c.t1 && c.t0 < m.t1).map((m) => {
    const key = Object.keys(m.track(m.t0))[0], at = (t) => m.track(Math.min(m.t1, Math.max(m.t0, t)))[key];
    const entry = Math.abs(m.t0 - c.t0) * sr < 1;
    if (Math.abs(at(m.t0)) > TOL.progressRatio || (entry && Math.abs(at(m.t1) - 1) > TOL.progressRatio)) throw new Error(`modifier ${m.id}: its track's ${key} reads ${at(m.t0)} at its start${entry ? ` and ${at(m.t1)} at its end` : ''}`);
    return (t) => (t < m.t0 ? 0 : entry ? m.level * (1 - at(t)) : m.level * at(t));
  });
  return (t) => fns.reduce((s, f) => s + f(t), 0);
}
// The same as a gain, sampled every BLOCK samples from `from` and interpolated: g(i), i samples after `from`
function gainCurve(change, from, n, sr) {
  const k = Math.ceil(n / BLOCK) + 1, g = new Float64Array(k + 1);
  for (let j = 0; j <= k; j++) g[j] = dbToGain(change(from + j * BLOCK / sr));
  return (i) => { const x = i / BLOCK, j = Math.min(k - 1, Math.floor(x)); return g[j] + (g[j + 1] - g[j]) * (x - j); };
}

// The RMS of the loudest `w` samples of gen(0..n-1); a voice shorter than the window is measured over the window too
function loudest(gen, n, w) {
  const sq = new Float64Array(w);
  let sum = 0, best = 0;
  for (let i = 0; i < Math.max(n, w); i++) {
    const x = i < n ? gen(i) : 0, j = i % w;
    sum += x * x - sq[j]; sq[j] = x * x;
    if (i + 1 >= w) best = Math.max(best, sum);
  }
  return Math.sqrt(best / w);
}

// ---------- the placeholder of each family: (c, { sr, rng, track }) -> (dt) -> a mono sample, unscaled ----------
// one-shots: an attack of TIMBRE.attackSec, then a decay; continuous voices: steady across the span, faded at its
// ends by the wrapper. A click: band noise, decaying fast. A knock: a decaying sine.
const click = (sr, rng, hz, q, sec) => { const f = band(sr, hz, q); return (dt) => through(f, white(rng)) * attackDecay(dt, TIMBRE.attackSec, sec); };
const knock = (hz, sec) => (dt) => Math.sin(TAU * hz * dt) * attackDecay(dt, TIMBRE.attackSec, sec);
// a sine whose pitch goes from hz0 to hz1 (exponentially) over the span, decaying at `ratio` of it: the door's swing
function sweep(c, sr, hz0, hz1, ratio) {
  const span = c.t1 - c.t0;
  let ph = 0;
  return (dt) => { ph += hz0 * (hz1 / hz0) ** (dt / span) / sr; return Math.sin(TAU * ph) * attackDecay(dt, TIMBRE.attackSec, span * ratio); };
}
// band noise whose centre and level follow functions of dt, retuned every BLOCK samples
function bandNoise(sr, rng, centre, q, level = () => 1) {
  const f = band(sr, centre(0), q);
  let i = 0;
  return (dt) => { if (++i % BLOCK === 0) retune(f, centre(dt)); return through(f, white(rng)) * level(dt); };
}
// the engine's buzz: a saw at the firing rate from the track's rpm, a little noise, through a band; `level` scales it
function buzz(sr, rng, track, T, level = () => 1) {
  const f = band(sr, T.bandHz, T.bandQ), n = TIMBRE.engine.noiseRatio;
  let ph = 0;
  return (dt) => { ph += track('rpm', dt) * TIMBRE.engine.firesPerRpm / sr; return through(f, saw(ph) * (1 - n) + white(rng) * n) * level(dt); };
}

export const FAMILY = {
  engine: (c, { sr, rng, track }) => buzz(sr, rng, track, TIMBRE.engine),
  stop: (c, { sr, rng, track }) => buzz(sr, rng, track, TIMBRE.stop, (dt) => track('dying', dt)),
  tyres: (c, { sr, rng, track }) => {
    const T = TIMBRE.tyres, steer = track.max('steer') || 1, speed = track.max('speed') || 1;
    return bandNoise(sr, rng, (dt) => T.bandHz * 2 ** (T.steerOctaves * track('steer', dt) / steer), T.bandQ, (dt) => track('speed', dt) / speed);
  },
  brake: (c, { sr, rng, track }) => {
    const T = TIMBRE.brake;
    if (partOf(c) === 'creak') {
      const v0 = track.at0('speed') || 1;
      let ph = 0;
      return (dt) => { ph += T.creakHz * (T.creakLowRatio + (1 - T.creakLowRatio) * track('speed', dt) / v0) / sr; return Math.sin(TAU * ph); };
    }
    const decel = track.max('decel') || 1;
    return bandNoise(sr, rng, () => T.bandHz, T.bandQ, (dt) => Math.max(0, track('decel', dt)) / decel);
  },
  settle: () => knock(TIMBRE.settle.knockHz, TIMBRE.settle.decaySec),
  unload: () => knock(TIMBRE.unload.knockHz, TIMBRE.unload.decaySec),
  cabin: (c, { sr, rng }) => click(sr, rng, TIMBRE.cabin.bandHz, TIMBRE.cabin.bandQ, TIMBRE.cabin.decaySec),
  door: (c, { sr, rng }) => {
    const T = TIMBRE.door, part = partOf(c);
    if (part === 'unlatch') return click(sr, rng, T.clickHz, T.clickQ, T.clickSec);
    if (part === 'swing-open') return sweep(c, sr, T.sweepLowHz, T.sweepHighHz, T.sweepDecayRatio);
    if (part === 'swing-shut') return sweep(c, sr, T.sweepHighHz, T.sweepLowHz, T.sweepDecayRatio);
    if (part === 'stop') return knock(T.knockHz, T.knockSec);
    if (part === 'latch') { const k = knock(T.thumpHz, T.knockSec), cl = click(sr, rng, T.clickHz, T.clickQ, T.clickSec); return (dt) => k(dt) + cl(dt); }
    throw new Error(`blockout: no door placeholder for ${c.id}`);
  },
  tick: (c, { sr, rng }) => click(sr, rng, TIMBRE.tick.bandHz, TIMBRE.tick.bandQ, TIMBRE.tick.decaySec),
  feet: (c, { sr, rng }) => {
    const T = TIMBRE.feet, hz = T.bandHz * 2 ** (offset(PEOPLE, c.person, T.personOctaves) + offset(SURFACES, c.surface, T.surfaceOctaves));
    const sec = T.decaySec * (c.meta.prints.length > 1 ? T.bothRatio : 1); // both boots at once: the heavy step, longer
    return click(sr, rng, hz, T.bandQ, sec);
  },
  scuff: (c, { sr, rng }) => {
    const T = TIMBRE.scuff, span = c.t1 - c.t0;
    return bandNoise(sr, rng, (dt) => T.bandHz * 2 ** (T.slideOctaves * dt / span), T.bandQ);
  },
  moves: (c, { sr, rng }) => {
    const T = TIMBRE.moves, hz = T.bandHz * 2 ** offset(PEOPLE, c.person, T.personOctaves);
    if (c.shape === 'oneshot') return click(sr, rng, hz, T.bandQ, T.tapSec); // a contact: the forearms, the cup
    const span = c.t1 - c.t0, fade = Math.min(T.fadeSec, span / 2 / 2);
    return bandNoise(sr, rng, () => hz, T.bandQ, (dt) => Math.min(1, dt / fade, (span - dt) / fade));
  },
  lighter: (c, { sr, rng, track }) => {
    const T = TIMBRE.lighter;
    if (c.shape === 'oneshot') return click(sr, rng, T.clickHz, T.clickQ, T.clickSec); // the strike, the release
    const most = track.max('flicker') || 1;
    return bandNoise(sr, rng, () => T.flameHz, T.flameQ, (dt) => track('flicker', dt) / most);
  },
  drag: (c, { sr, rng, track }) => {
    const e0 = track.at0('ember'), rise = track.max('ember') - e0 || 1; // the draw: the ember's rise over its glow
    return bandNoise(sr, rng, () => TIMBRE.drag.bandHz, TIMBRE.drag.bandQ, (dt) => Math.max(0, track('ember', dt) - e0) / rise);
  },
  breath: (c, { sr, rng, track }) => bandNoise(sr, rng, () => TIMBRE.breath.bandHz, TIMBRE.breath.bandQ, (dt) => Math.sin(Math.PI * Math.min(1, Math.max(0, track('age', dt) / track('life', dt))))),
  hum: (c) => (dt) => TIMBRE.hum.partialHz.reduce((s, hz, j) => s + TIMBRE.hum.partialRatio[j] * Math.sin(TAU * hz * (c.t0 + dt)), 0),
};

// The ends of a voice: a continuous one fades in and out over TIMBRE.edgeSec, a one-shot (its own attack) out only
const edges = (c, n, sr) => {
  const e = TIMBRE.edgeSec * sr;
  return c.shape === 'oneshot' ? (i) => Math.min(1, (n - i) / e) : (i) => Math.min(1, i / e, (n - i) / e);
};

// A placed voice for one cue, as an event for src/audio/events.js: its own seeded placeholder, scaled to its level by
// the level rule (one pass at build to measure it, then the same seed again to play it), faded at its ends, changed by
// its modifiers, heard from the camera through LAWS[c.law]. An 'onset' placement is fixed where the cue starts.
export function placedEvent(c, list, ctx, busDb) {
  if (!c.place || !FAMILY[c.family]) throw new Error(`blockout: ${c.id} has no ${c.place ? 'placeholder' : 'place'}`);
  const { sr } = ctx, n = Math.round((c.t1 - c.t0) * sr), track = sampleTrack(c, sr), edge = edges(c, n, sr);
  const voice = () => { const v = FAMILY[c.family](c, { sr, rng: ctx.rngFor(`audio:blockout:${c.id}`), track }); return (i) => v(i / sr) * edge(i); };
  const scale = amp(c.level - busDb) / (loudest(voice(), n, Math.round(LEVEL.windowSec * sr)) || 1);
  const change = modifiersOf(c, list, sr), gain = gainCurve(change, c.t0, n, sr);
  const p0 = c.placement === 'onset' ? c.place(c.t0) : null;
  return {
    t: c.t0, dur: c.t1 - c.t0, law: LAWS[c.law], cue: c.id,
    place: c.placement === 'tracked' ? c.place : () => p0,
    make: () => { const v = voice(); return (dt) => { const i = Math.round(dt * sr); return v(i) * scale * gain(i); }; },
  };
}

// The backgrounds' noises (SOUND-PLAN 4.4): pink for the wind, brown for the city, grey for the water. One generator
// per channel drawing from the voice's one stream in turn, so the two channels are decorrelated.
const BED = {
  wind: (sr, rng) => { const p = pink(rng), f = band(sr, TIMBRE.wind.bandHz, TIMBRE.wind.bandQ); return () => through(f, p()); },
  city: (sr, rng) => { const b = brown(rng), f = [new Biquad(sr, 'highpass', TIMBRE.city.highpassHz), new Biquad(sr, 'lowpass', TIMBRE.city.lowpassHz)]; return () => through(f, b()); },
  water: (sr, rng) => { const f = band(sr, TIMBRE.water.bandHz, TIMBRE.water.bandQ); return () => through(f, white(rng)); },
};

// An unplaced stereo background for one cue: its level by the rule above (its RMS over its span), an equal-power
// crossfade of TIMBRE.crossfadeSec centred on each end, so the place change is a short crossfade and nothing else.
export function bedVoice(c, list, ctx, busDb) {
  if (c.place || !BED[c.family]) throw new Error(`blockout: ${c.id} is not an unplaced background`);
  const { sr } = ctx, h = TIMBRE.crossfadeSec / 2;
  const make = () => { const rng = ctx.rngFor(`audio:blockout:${c.id}`); return [BED[c.family](sr, rng), BED[c.family](sr, rng)]; };
  const s0 = Math.max(0, Math.round((c.t0 - h) * sr)), s1 = Math.round((c.t1 + h) * sr), m0 = Math.round(c.t0 * sr), m1 = Math.round(c.t1 * sr);
  // the measuring pass, over the span itself, from the same start the render takes
  let sum = 0;
  const g = make();
  for (let i = s0; i < m1; i++) { const l = g[0](), r = g[1](); if (i >= m0) sum += l * l + r * r; }
  const scale = amp(c.level - busDb) / (Math.sqrt(sum / (m1 - m0)) || 1);
  const ramp = (t) => Math.sin(Math.PI / 2 * Math.min(1, Math.max(0, (t - c.t0 + h) / (2 * h)), Math.max(0, (c.t1 + h - t) / (2 * h))));
  const change = modifiersOf(c, list, sr), gain = gainCurve(change, s0 / sr, s1 - s0, sr);
  const gen = make();
  return {
    cue: c.id,
    process(L, R, i0, n) {
      for (let k = Math.max(0, s0 - i0); k < n && i0 + k < s1; k++) {
        const i = i0 + k, a = ramp(i / sr) * gain(i - s0) * scale;
        L[k] += gen[0]() * a; R[k] += gen[1]() * a;
      }
    },
  };
}
