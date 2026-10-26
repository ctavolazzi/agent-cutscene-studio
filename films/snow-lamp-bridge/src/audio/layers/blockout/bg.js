// The blockout's backgrounds (SOUND-PLAN 3.5, 4.4): one steady unplaced stereo bed per family and place (wind, city,
// and the water on the bridge), changing only at the place change, with a short equal-power crossfade, and by the
// story's ambience cues; and the lamp's hum, placed at the lantern. Reads only the cues (voices.js).
import { makeEvents } from '../../events.js';
import { SEND } from './timbre.js';
import { bedVoice, cueList, placedEvent, sounding } from './voices.js';

export function build(ctx) {
  const list = cueList(ctx), bus = 'amb', busDb = ctx.config.audio.buses[bus], all = sounding(list, 'bg');
  const beds = all.filter((c) => !c.place).map((c) => bedVoice(c, list, ctx, busDb));
  const placed = makeEvents(ctx, all.filter((c) => c.place).map((c) => placedEvent(c, list, ctx, busDb)));
  return {
    name: 'bg', bus, reverb: SEND.bgRatio, beds: beds.map((b) => b.cue), events: placed.list,
    process(L, R, i0, n) {
      for (const b of beds) b.process(L, R, i0, n);
      placed.process(L, R, i0, n);
    },
  };
}
