// The soundtrack: which layers make it and how they are built. Used by scripts/sound.js (the export) and by the
// player's worker (src/audio/worker.js), so both render the same samples. Pure: the same config and seed give the
// same bytes on every run and in every runtime.
import { mulberry32, hashString } from '../prng.js';
import { T_TOTAL } from '../world.js';
import { renderAll, renderBlocks } from './mix.js';
import { makeSpatializer } from './spatial.js';
import { LISTENERS, charactersListener } from './listeners.js';
import * as ambience from './layers/ambience.js';
import * as car from './layers/car.js';
import * as foley from './layers/foley.js';
import * as score from './layers/score.js';
import * as bg from './layers/blockout/bg.js';
import * as hard from './layers/blockout/hard.js';
import * as blockoutFoley from './layers/blockout/foley.js';

// The layers of each stage (config.audio.stage, SOUND-PLAN 4.4), in mix order and keyed by the name each one's build
// returns, so a stage minus its parked layers is known before anything is built. Each is a module with build(ctx); see
// src/audio/mix.js for the contract. 'blockout' is the placeholders, which read only cues.js; 'design' is the first
// pass, reachable by the switch and never deleted.
export const STAGES = Object.freeze({
  blockout: Object.freeze({ bg, hard, foley: blockoutFoley }),
  design: Object.freeze({ ambience, car, foley, score }),
});

// The layers a config renders, as [name, module] in mix order: its stage's, minus config.audio.parked, then only the
// ones named in `only` (a stem). A parked layer named in `only` stays out: parking holds for stems too.
export function layersOf(config, only = null) {
  const { stage, parked } = config.audio, all = STAGES[stage];
  if (!all) throw new Error(`audio stage '${stage}': want ${Object.keys(STAGES).map((s) => `'${s}'`).join(' or ')}`);
  for (const n of only ?? []) if (!all[n]) throw new Error(`no layer '${n}' in the ${stage} stage (${Object.keys(all).join(', ')})`);
  return Object.entries(all).filter(([n]) => !parked.includes(n) && (!only || only.includes(n)));
}
export const layerNames = (config, only = null) => layersOf(config, only).map(([n]) => n);

// The same config at another stage or with other layers parked (undefined keeps what it has).
export const atStage = (config, { stage = config.audio.stage, parked = config.audio.parked } = {}) => ({ ...config, audio: { ...config.audio, stage, parked } });

// `cues` hands the cue-reading layers another catalogue than src/audio/cues.js's CUES (one made by makeCues from a
// changed picture, or a subset for a stem); the design layers do not read it. `occlusion`, for Sound 2.12's muffle
// A/B only, maps a cue to null (never hidden) or to t -> whether the picture hides its source at t: the hidden state
// is the picture's screen state (scripts/lib/sound-checks.js), so only scripts/sound-options.js builds one, src/ never
// does, and the default render has none. `levelAt` is the characters' listener when config.audio.options.listener
// asks for it (Sound 2.12's option 3), else null; a listener it does not know is refused, so a misspelt one cannot
// render the camera while it is reported as the characters. The blockout's voices read both (blockout/voices.js).
export function makeContext(config, { cues = null, occlusion = null } = {}) {
  const sr = config.audio.sr, listener = config.audio.options?.listener;
  if (listener !== undefined && !LISTENERS.includes(listener)) throw new Error(`listener '${listener}': want ${LISTENERS.map((x) => `'${x}'`).join(', ')}`);
  return {
    sr,
    total: T_TOTAL,
    config,
    cues,
    occlusion,
    levelAt: listener === 'characters' ? charactersListener() : null,
    rngFor: (name) => mulberry32((config.seed ^ hashString(name)) >>> 0),
    spatializer: (place, law) => makeSpatializer(sr, place, law),
  };
}

export function buildLayers(config, only = null, { cues = null, occlusion = null } = {}) {
  const ctx = makeContext(config, { cues, occlusion });
  return layersOf(config, only).map(([name, m]) => {
    const layer = m.build(ctx);
    if (layer.name !== name) throw new Error(`layer '${name}' builds as '${layer.name}'`);
    return layer;
  });
}

// The finished soundtrack: { sr, left, right, stats }. `only` renders a subset of layers (stems for tests).
export function renderSoundtrack(config, { only = null, cues = null, occlusion = null, reverb = true, normalize = true, onProgress = null } = {}) {
  return renderAll({ layers: buildLayers(config, only, { cues, occlusion }), config, sr: config.audio.sr, total: T_TOTAL, reverb, normalize, onProgress });
}

export { renderBlocks };
