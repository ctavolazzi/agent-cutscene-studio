// The listeners a sound can be heard by (SOUND-PLAN 3.4, 3.6). The camera hears every cue today, for its level and its
// pan alike (spatial.js listenerAt). The characters' listener is Sound 2.12's option 3, Silent Hill's pattern from the
// PS1 research: the level from the people, the pan still from the camera. Its point is the mean of the cloth points
// (each poser's root plus DESIGN.CLOTH.up, where cues.js puts their cloth sounds) of the people out of the car (the
// poser's `visible`, its presence), whether or not the camera sees them: one person while only one is out, and none
// before anyone is, when the camera's level holds. It is the point scripts/sound-report.js predicts its 'characters'
// model with (charactersAt), so a render can be checked against the storyboard.
import { DESIGN, WORLD } from './cues.js';

// The values config.audio.options.listener takes: who hears the level (src/audio/index.js makeContext refuses others)
export const LISTENERS = Object.freeze(['camera', 'characters']);

// The characters' listener for a picture (cues.js WORLD by default): t -> its point, or null while nobody is out.
// The spatializer asks for it at every block edge of every placed voice, and a poser call is slow next to that, so each
// listener remembers the points it has given (a pure function of t: the same t always gives the same point).
export function charactersListener(w = WORLD) {
  const posers = Object.keys(w.PEOPLE).map((id) => w.makePoser(id)), seen = new Map();
  const at = (t) => {
    const ps = posers.map((pose) => pose(t)).filter((p) => p.visible).map((p) => [p.x, p.y + DESIGN.CLOTH.up, p.z]);
    return ps.length ? Object.freeze(ps.reduce((s, p) => s.map((v, j) => v + p[j] / ps.length), [0, 0, 0])) : null;
  };
  return (t) => { if (!seen.has(t)) seen.set(t, at(t)); return seen.get(t); };
}
