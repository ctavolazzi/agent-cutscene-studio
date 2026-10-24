// The blockout's hard effects (SOUND-PLAN 4.4): every enabled hard cue in cues.js (the car: engine, tyres, brake,
// settle, the cabin, the doors, getting out, the run-down, the ticks) as a placeholder voice at its exact times and
// designed level, heard from the camera by the real spatializer. Reads only the cues (voices.js).
import { makeEvents } from '../../events.js';
import { SEND } from './timbre.js';
import { cueList, placedEvent, sounding } from './voices.js';

export function build(ctx) {
  const list = cueList(ctx), bus = 'fx', busDb = ctx.config.audio.buses[bus];
  const events = makeEvents(ctx, sounding(list, 'hard').map((c) => placedEvent(c, list, ctx, busDb)));
  return { name: 'hard', bus, reverb: SEND.hardRatio, events: events.list, process: events.process };
}
