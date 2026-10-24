// Every number the blockout uses (SOUND-PLAN 4.4), in one place: the placeholders' timbres, the level rule, the
// reverb sends. None is a time on the film's clock or an event's offset or length: those come from the cues alone.
// Each key ends in its unit (Hz, Db, Q, Ratio, Octaves, Sec, PerRpm); a time (Sec) is a placeholder's own envelope,
// shorter than the window its level is measured in. tests/sound-blockout.test.mjs scans this folder for both rules.
const freeze = (o) => { for (const v of Object.values(o)) if (v && typeof v === 'object') freeze(v); return Object.freeze(o); };

// The level rule (voices.js): the street background's RMS over both channels, before the master normalization, and
// the level plan's window (SOUND-PLAN 1.3): a voice's level is the RMS of its loudest 100 ms.
export const LEVEL = freeze({ refDb: -30, windowSec: 0.1 });

// The reverb stays as today until Sound 4 (SOUND-PLAN 4.4): the parked ambience, car and foley layers' sends, copied
// because those layers do not export them. Sound 4 replaces them with each cue's reverb bit.
export const SEND = freeze({ bgRatio: 0.15, hardRatio: 0.2, foleyRatio: 0.25 });

// A modifier's value must read 0 at its start, and an entry's 1 at its end (voices.js), to this
export const TOL = freeze({ progressRatio: 1e-6 });

// One obviously temporary timbre per family, each in its own band so the families stay apart (SOUND-PLAN 4.4's table).
// Noise bands are white noise through two bandpasses; a buzz is a saw at the firing rate through one.
export const TIMBRE = freeze({
  attackSec: 0.001, // every one-shot's attack: its onset lands within a millisecond of its t0
  edgeSec: 0.005, // a continuous voice fades in and out over this, a one-shot out: no click where a voice stops
  crossfadeSec: 0.05, // the backgrounds' equal-power crossfade, centred on the place change
  hum: { partialHz: [120, 240], partialRatio: [1, 0.5] }, // pure partials
  city: { highpassHz: 40, lowpassHz: 300 }, // brown noise
  wind: { bandHz: 750, bandQ: 0.7 }, // pink noise
  water: { bandHz: 7000, bandQ: 0.7 }, // grey: white noise in a wide band
  engine: { bandHz: 650, bandQ: 1.4, firesPerRpm: 1 / 30, noiseRatio: 0.2 }, // a four-stroke four fires twice a turn
  stop: { bandHz: 240, bandQ: 1.4 }, // the engine's buzz, darker, falling to nothing with the run-down
  tyres: { bandHz: 900, bandQ: 2, steerOctaves: 0.5 }, // the band moves with the steering, up at full lock
  brake: { bandHz: 2700, bandQ: 3, creakHz: 1900, creakLowRatio: 0.7 }, // pads; the creak glides down as it stops
  settle: { knockHz: 300, decaySec: 0.05 },
  unload: { knockHz: 520, decaySec: 0.05 },
  cabin: { bandHz: 5900, bandQ: 3, decaySec: 0.012 },
  door: { clickHz: 1800, clickQ: 3, clickSec: 0.006, sweepLowHz: 400, sweepHighHz: 800, sweepDecayRatio: 0.25, knockHz: 340, thumpHz: 200, knockSec: 0.04 },
  tick: { bandHz: 9500, bandQ: 4, decaySec: 0.008 },
  feet: { bandHz: 1250, bandQ: 1, decaySec: 0.045, bothRatio: 2, personOctaves: 0.5, surfaceOctaves: 0.25 },
  scuff: { bandHz: 1650, bandQ: 2, slideOctaves: 0.5 },
  moves: { bandHz: 1100, bandQ: 1.5, personOctaves: 0.5, fadeSec: 0.08, tapSec: 0.04 },
  lighter: { clickHz: 6300, clickQ: 3, clickSec: 0.012, flameHz: 4600, flameQ: 2 },
  drag: { bandHz: 3900, bandQ: 2 },
  breath: { bandHz: 2600, bandQ: 1.2 },
});
