// The soundtrack: which layers make it and how they are built. Used by scripts/sound.js (the export) and by the
// player's worker (src/audio/worker.js), so both render the same samples. Pure: the same config and seed give the
// same bytes on every run and in every runtime.
import { mulberry32, hashString } from '../prng.js';
import { T_TOTAL } from '../world.js';
import { renderAll, renderBlocks } from './mix.js';
import { makeSpatializer } from './spatial.js';
import * as ambience from './layers/ambience.js';
import * as car from './layers/car.js';
import * as foley from './layers/foley.js';
import * as score from './layers/score.js';

// Layers in mix order. Each is a module with build(ctx); see src/audio/mix.js for the contract.
export const LAYERS = [ambience, car, foley, score];

export function makeContext(config) {
  const sr = config.audio.sr;
  return {
    sr,
    total: T_TOTAL,
    config,
    rngFor: (name) => mulberry32((config.seed ^ hashString(name)) >>> 0),
    spatializer: (place, law) => makeSpatializer(sr, place, law),
  };
}

export function buildLayers(config, only = null) {
  const ctx = makeContext(config);
  const all = LAYERS.map((m) => m.build(ctx));
  return only ? all.filter((l) => only.includes(l.name)) : all;
}

// The finished soundtrack: { sr, left, right, stats }. `only` renders a subset of layers (stems for tests).
export function renderSoundtrack(config, { only = null, reverb = true, normalize = true, onProgress = null } = {}) {
  return renderAll({ layers: buildLayers(config, only), config, sr: config.audio.sr, total: T_TOTAL, reverb, normalize, onProgress });
}

export { renderBlocks };
