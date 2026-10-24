// The blockout's foley (SOUND-PLAN 4.4): every enabled foley cue in cues.js (the steps, the scuffs, cloth and the
// hands' contacts, the lighter, the drags, the breath) as a placeholder voice at its exact times and designed level,
// heard from the camera by the real spatializer. Reads only the cues (voices.js).
import { makeEvents } from '../../events.js';
import { SEND } from './timbre.js';
import { cueList, placedEvent, sounding } from './voices.js';

export function build(ctx) {
  const list = cueList(ctx), bus = 'fx', busDb = ctx.config.audio.buses[bus];
  const events = makeEvents(ctx, sounding(list, 'foley').map((c) => placedEvent(c, list, ctx, busDb)));
  return { name: 'foley', bus, reverb: SEND.foleyRatio, events: events.list, process: events.process };
}
