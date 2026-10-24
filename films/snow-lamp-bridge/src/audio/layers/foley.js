// Foley: every footstep (one per print in footprintList(), on its frame, at its place, by surface: the thin packed
// layer on the road, the deeper snow on the sidewalks, the deck's hollow), cloth as they lean on the parapet and as A
// turns into the lee, the lighter, the three drags and the exhale. All small and close. See SOUND.md.
import { BRIDGE } from '../../set.js';
import { PEOPLE, LIGHTER, EMBER, EXHALE, emberLevel, lighterFlicker } from '../../world.js';
import { footprintList, snowY } from '../../fx/footprints.js';
import { bodyToWorld, makePoser } from '../../actors/people.js';
import { Biquad, OnePole, TAU, clamp, pink, smoothstep, white } from '../dsp.js';
import { grains, makeEvents } from '../events.js';

// small sounds a film mix keeps close: a gentler distance law than the physical one
export const FOLEY_LAW = { refDist: 2.5, rolloff: 0.7 };

export const surfaceOf = (p) => (p.z <= BRIDGE.z0 && p.z >= BRIDGE.z1 ? 'deck' : snowY(p.x, p.z) > 0 ? 'walk' : 'road');

// One footstep per landing: prints of the same person within 30 ms (both boots at once) make one heavier step.
export function footsteps() {
  const out = [];
  for (const p of footprintList()) {
    const last = out[out.length - 1];
    if (last && last.id === p.id && p.t - last.t < 0.03) { last.heavy = true; continue; }
    out.push({ id: p.id, t: p.t, x: p.x, y: p.y, z: p.z, surface: surfaceOf(p), heavy: false, gap: Infinity });
  }
  // the time to the same person's next step: a quick step rolls onto its toe quickly and is over before the next heel
  for (const id of Object.keys(PEOPLE)) {
    const own = out.filter((s) => s.id === id);
    own.forEach((s, i) => { if (i + 1 < own.length) s.gap = own[i + 1].t - s.t; });
  }
  return out;
}

// the moments of cloth: both lean onto the parapet (arms land at 63.5), A turns into the lee to cup the flame and back
export const RUSTLES = [
  { id: 'A', t: 62.75, dur: 1.0, amp: 1, pat: 0.72 },
  { id: 'B', t: 62.8, dur: 1.0, amp: 1, pat: 0.7 },
  { id: 'A', t: 77.6, dur: 0.9, amp: 0.55 },
  { id: 'A', t: 82.3, dur: 1.4, amp: 0.4 },
];

const ring = (dt, hz, tau) => (dt < 0 ? 0 : Math.exp(-dt / tau) * Math.sin(TAU * hz * dt));

export function build(ctx) {
  const { sr, rngFor, config } = ctx;
  const F = config.audio.foley;
  const posers = { A: makePoser('A'), B: makePoser('B') };
  const at = (id, key, up = 0) => (t) => {
    const p = posers[id](t);
    if (!p.visible) return null;
    const w = key ? bodyToWorld(p, p[key]) : [p.x, p.y, p.z];
    return [w[0], w[1] + up, w[2]];
  };
  const ev = [];

  // ---------- footsteps ----------
  // heel: a cluster of crunching grains and the snow packing under the weight; then the roll onto the toe, softer.
  // Road: thin, packed, a hard tap of the asphalt under it. Sidewalk: deeper, longer, sometimes a cold squeak.
  // Deck: the crunch plus a hollow note from the slab.
  const SURF = {
    road: { heel: 10, toe: 6, spread: 0.03, tap: 0.35, hollow: 0, squeak: 0, bp: 2100 },
    walk: { heel: 26, toe: 16, spread: 0.055, tap: 0, hollow: 0, squeak: 0.5, bp: 1700 },
    deck: { heel: 18, toe: 10, spread: 0.045, tap: 0.12, hollow: 1, squeak: 0, bp: 1900 },
  };
  footsteps().forEach((s, i) => {
    if (!F.stepsBy.includes(s.id)) return; // whose steps sound (both; one alone for the timing checks)
    const S = SURF[s.surface];
    const light = PEOPLE[s.id].height < 1.75; // B: lighter, brighter steps
    ev.push({
      t: s.t, dur: 0.32, place: () => [s.x, s.y, s.z], law: FOLEY_LAW,
      make: () => {
        const r = rngFor(`audio:step:${i}`);
        const w = (light ? 0.75 : 1) * (s.heavy ? 1.5 : 1) * (0.85 + 0.3 * r());
        const toeAt = Math.min(0.07 + 0.03 * r(), 0.4 * s.gap), tail = Math.min(0.26, 0.85 * s.gap);
        const heel = grains(r, { count: S.heel, spread: S.spread, tau: 0.0022 });
        const toe = grains(r, { count: S.toe, spread: S.spread, tau: 0.0018, first: 0.6 });
        const bp = new Biquad(sr, 'bandpass', S.bp * (light ? 1.2 : 1), 0.8), air = new Biquad(sr, 'highpass', 4200, 0.7);
        const n = white(r), thudLp = new Biquad(sr, 'lowpass', light ? 220 : 170, 0.8), hollow = new Biquad(sr, 'bandpass', 150, 5);
        const squeak = S.squeak && r() < S.squeak ? { at: 0.03 + 0.05 * r(), hz: 1300 + 400 * r() } : null;
        let sq = 0;
        return (dt) => {
          const c = heel(dt) + (dt >= toeAt ? toe(dt - toeAt) : 0);
          const crunch = bp.process(c) * 2.6 + air.process(c) * 0.5;
          const thud = thudLp.process(n()) * (dt < 0.004 ? dt / 0.004 : Math.exp(-(dt - 0.004) / 0.03)) * 1.6;
          let v = crunch + thud + S.tap * ring(dt, 1100, 0.006) + S.hollow * hollow.process(thud) * 3;
          if (squeak && dt >= squeak.at && dt < squeak.at + 0.03) {
            const u = (dt - squeak.at) / 0.03;
            sq += (squeak.hz * (1 - 0.2 * u)) / sr;
            v += 0.12 * Math.sin(TAU * sq) * Math.sin(Math.PI * u);
          }
          return v * w * 0.32 * smoothstep(tail + 0.06, tail, dt) * F.stepGain;
        };
      },
    });
  });

  // ---------- cloth ----------
  RUSTLES.forEach((c, i) => {
    const puffy = c.id === 'B'; // B's nylon jacket swishes brighter than A's wool coat
    ev.push({
      t: c.t, dur: c.dur, place: at(c.id, null, 1.2), law: FOLEY_LAW,
      make: () => {
        const r = rngFor(`audio:rustle:${i}`), n = white(r);
        const bp = new Biquad(sr, 'bandpass', puffy ? 3400 : 1500, 0.7), lp = new Biquad(sr, 'lowpass', 340, 0.8);
        const crinkle = new OnePole(sr, 60);
        let k = 0;
        return (dt) => {
          const u = dt / c.dur;
          if (r() < (puffy ? 60 : 35) / sr) k = 0.4 + 0.6 * r();
          k *= Math.exp(-1 / (0.012 * sr));
          const env = Math.sin(Math.PI * clamp(u, 0, 1)) ** 1.5;
          let v = bp.process(n()) * (0.25 + crinkle.process(k) * 3) * env * 0.5;
          if (c.pat !== undefined && dt >= c.pat) v += lp.process(n()) * Math.exp(-(dt - c.pat) / 0.04) * 0.9;
          return v * c.amp * F.rustleGain;
        };
      },
    });
  });

  // ---------- the lighter ----------
  // the wheel rasps on the flint (a ratchet of clicks), sparks, the flame catches with a soft rush, then flutters with
  // the light's own flicker until it goes out at LIGHTER.t1, with the click of the button let go
  const flameEnd = LIGHTER.t1 - LIGHTER.t0;
  ev.push({
    t: LIGHTER.t0, dur: flameEnd + 0.1, place: at('A', 'cup'), law: FOLEY_LAW,
    make: () => {
      const r = rngFor('audio:lighter'), n = white(r);
      const rasp = new Biquad(sr, 'bandpass', 4500, 1.5), rush = new Biquad(sr, 'lowpass', 700, 0.7), flame = new Biquad(sr, 'lowpass', 900, 0.7);
      const sparks = [0, 0.018, 0.034, 0.051].map((s) => ({ s, hz: 5000 + 3000 * r() }));
      let ratchet = 0;
      return (dt) => {
        let v = 0;
        if (dt < 0.065) {
          ratchet += 95 / sr;
          const click = ratchet >= 1 ? (ratchet -= 1, 1) : 0;
          v += rasp.process(n() * 0.4 + click * 3) * 1.4 * Math.sin(Math.PI * Math.min(1, dt / 0.065 + 0.08));
        } else v += rasp.process(0);
        for (const s of sparks) v += 0.35 * ring(dt - s.s, s.hz, 0.002);
        const c = dt - 0.07;
        if (c > 0) v += rush.process(n()) * (c < 0.015 ? c / 0.015 : Math.exp(-(c - 0.015) / 0.1)) * 0.9;
        else rush.process(0);
        const fl = smoothstep(0.08, 0.14, dt) * smoothstep(flameEnd, flameEnd - 0.06, dt);
        v += flame.process(n()) * 0.65 * fl * lighterFlicker(LIGHTER.t0 + dt);
        v += 0.3 * ring(dt - flameEnd, 2600, 0.005);
        return v * F.lighterGain;
      };
    },
  });

  // ---------- drags and the exhale ----------
  // a drag: a soft inhale through the filter and the paper crackling as the ember brightens (emberLevel)
  EMBER.drags.forEach((d, i) => {
    ev.push({
      t: d, dur: EMBER.dragDur + 0.1, place: at('A', 'tip'), law: FOLEY_LAW,
      make: () => {
        const r = rngFor(`audio:drag:${i}`), n = pink(r), breath = new Biquad(sr, 'bandpass', 1400, 0.7), hp = new Biquad(sr, 'highpass', 3000, 0.7);
        let k = 0;
        return (dt) => {
          const u = clamp(dt / EMBER.dragDur, 0, 1);
          const bump = (emberLevel(d + dt) - 1) / EMBER.dragGain;
          if (r() < (90 * bump) / sr) k = 0.3 + 0.7 * r();
          k *= Math.exp(-1 / (0.0015 * sr));
          return (breath.process(n()) * 0.5 * Math.sin(Math.PI * u) ** 2 + hp.process(k * (r() * 2 - 1)) * 1.2) * F.dragGain;
        };
      },
    });
  });
  ev.push({
    t: EXHALE.t, dur: EXHALE.life, place: at('A', 'mouth'), law: FOLEY_LAW,
    make: () => {
      const r = rngFor('audio:exhale'), n = pink(r), body = new Biquad(sr, 'bandpass', 650, 0.6), air = new Biquad(sr, 'highpass', 2000, 0.7);
      return (dt) => {
        const env = smoothstep(0, 0.12, dt) * Math.exp(-Math.max(0, dt - 0.12) / 0.7) * smoothstep(EXHALE.life, EXHALE.life - 0.3, dt);
        const x = n();
        return (body.process(x) * 0.9 + air.process(x) * 0.35) * env * F.breathGain;
      };
    },
  });

  const events = makeEvents(ctx, ev);
  return {
    name: 'foley',
    bus: 'fx',
    reverb: 0.25,
    process(L, R, i0, n) {
      events.process(L, R, i0, n);
      for (let k = 0; k < n; k++) { L[k] *= F.level; R[k] *= F.level; }
    },
  };
}
