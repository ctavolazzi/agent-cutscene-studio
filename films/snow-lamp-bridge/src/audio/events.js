// One-shot sounds on a schedule, for the car and foley layers. An event is
//   { t (start, seconds), dur (seconds), place(t) -> world point or null, make() -> voice, law (optional) }
// and voice(dt) returns the next mono sample dt seconds after the start. It is called once per sample, in order, so it
// may keep filter state. A voice and its spatializer are made when the event starts and dropped when it ends, so a long
// list costs only the events sounding at the time.
export function makeEvents(ctx, events) {
  const { sr, spatializer } = ctx;
  const list = events.slice().sort((a, b) => a.t - b.t);
  const buf = new Float32Array(1024);
  const live = [];
  let next = 0;
  return {
    list,
    process(L, R, i0, n) {
      const end = i0 + n;
      while (next < list.length && Math.round(list[next].t * sr) < end) {
        const e = list[next++];
        const s = Math.round(e.t * sr);
        live.push({ voice: e.make(), sp: spatializer(e.place, e.law), s, e: s + Math.round(e.dur * sr) });
      }
      for (let j = live.length - 1; j >= 0; j--) {
        const v = live[j];
        for (let k = 0; k < n; k++) {
          const i = i0 + k;
          buf[k] = i >= v.s && i < v.e ? v.voice((i - v.s) / sr) : 0;
        }
        v.sp.process(buf, L, R, i0, n);
        if (v.e <= end) live.splice(j, 1);
      }
    },
  };
}

// A short burst of crackle: `count` grains at seeded times in [0, spread) seconds, each a decaying noise tick of
// `tau` seconds, the first one at 0 so the onset is exact. Returns grains(dt) -> sample (unfiltered).
export function grains(rng, { count, spread, tau, first = 1, amp = [0.4, 1] }) {
  const g = [{ t: 0, a: first, tau }];
  for (let i = 1; i < count; i++) g.push({ t: rng() * spread, a: amp[0] + (amp[1] - amp[0]) * rng(), tau: tau * (0.5 + rng()) });
  g.sort((a, b) => a.t - b.t);
  return (dt) => {
    let s = 0;
    for (const x of g) {
      if (x.t > dt) break;
      const u = (dt - x.t) / x.tau;
      if (u < 8) s += x.a * Math.exp(-u) * (rng() * 2 - 1);
    }
    return s;
  };
}
