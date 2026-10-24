// The car: engine, tyres in the snow, the brake creak and the settle at the stop, the doors, the key and the run-down,
// then hot metal ticking as it cools. Timed by carAt(t) and carTimes (src/world.js), placed on the car: the intake at
// the front, the exhaust at the rear, the tyres at the centre, each door at its side. See SOUND.md.
import { carAt, carTimes } from '../../world.js';
import { Biquad, OnePole, TAU, clamp, smoothstep, white } from '../dsp.js';
import { makeEvents } from '../events.js';

const D2R = Math.PI / 180;
// compass heading to world vectors: forward (heading 0 is north, -Z) and right
const fwdOf = (h) => [Math.sin(h * D2R), 0, -Math.cos(h * D2R)];
const rightOf = (h) => [Math.cos(h * D2R), 0, Math.sin(h * D2R)];
// a point on the car: `along` metres forward of its centre, `side` metres to its right, `up` metres high
export function carPoint(t, along, side, up) {
  const c = carAt(t);
  if (!c.present) return null;
  const f = fwdOf(c.heading), r = rightOf(c.heading);
  return [c.x + f[0] * along + r[0] * side, up, c.z + f[2] * along + r[2] * side];
}

export const ENGINE = { idleRpm: 780, rpmPerMs: 300, cylinders: 4 };
// the car is the one loud thing: heard across the set with a gentler distance law than the small sounds
export const CAR_LAW = { refDist: 3, rolloff: 0.6 };
const DOOR_LAW = { refDist: 2, rolloff: 0.8 };
const T_OFF = carTimes.lightsOff0; // the key turns as the headlights start to fade
const RUNDOWN = 0.45;

// Engine speed and throttle at t, before smoothing: cruising, off the throttle on the brakes, a little throttle
// through the corner, coasting to the stop with the clutch in at the end, idling, then the run-down after the key.
export function engineAt(t) {
  const T = carTimes;
  if (t < T.start || t >= T_OFF + RUNDOWN) return { rpm: 0, load: 0, on: false };
  const c = carAt(t);
  const rpm = Math.max(ENGINE.idleRpm, ENGINE.rpmPerMs * c.speed);
  let load;
  if (t < T.brake) load = 0.55;
  else if (t < T.turn0) load = 0.08;
  else if (t < T.turn1) load = 0.3;
  else if (t < T.stop) load = 0.1;
  else load = 0.06;
  if (t >= T_OFF) {
    const u = (t - T_OFF) / RUNDOWN;
    return { rpm: ENGINE.idleRpm * (1 - u) ** 1.6, load: 0.06 * (1 - u), on: true, dying: 1 - u };
  }
  return { rpm, load, on: true, dying: 1 };
}

export const DOOR_EVENTS = (() => {
  const d = carTimes.doors;
  return [
    { kind: 'open', side: -0.92, t: d.driver.open0, swing: d.driver.open1 - d.driver.open0 },
    { kind: 'open', side: 0.92, t: d.passenger.open0, swing: d.passenger.open1 - d.passenger.open0 },
    { kind: 'shut', side: -0.92, t: d.driver.close1 },
    { kind: 'shut', side: 0.92, t: d.passenger.close1 },
  ];
})();

// a decaying sine (a body resonance)
const ring = (dt, hz, tau, ph = 0) => Math.exp(-dt / tau) * Math.sin(TAU * hz * dt + ph);

export function build(ctx) {
  const { sr, rngFor, spatializer, config } = ctx;
  const C = config.audio.car;
  const rng = rngFor('audio:car');

  // ---------- the engine ----------
  const front = spatializer((t) => carPoint(t, 1.7, 0, 0.6), CAR_LAW);
  const rear = spatializer((t) => carPoint(t, -2.3, 0.4, 0.3), CAR_LAW);
  const tyres = spatializer((t) => carPoint(t, 0, 0, 0.15), CAR_LAW);
  const bufF = new Float32Array(1024), bufR = new Float32Array(1024), bufT = new Float32Array(1024);
  const rpmS = new OnePole(sr, 1.5), loadS = new OnePole(sr, 2.5);
  const eRng = rngFor('audio:car:engine'), eNoise = white(rngFor('audio:car:engine-noise'));
  // the exhaust: low and round, its fundamental at idle (26 Hz) taken out so the burble lives in its harmonics
  const exhaustLp = new Biquad(sr, 'lowpass', 220, 0.9), exhaustBoom = new Biquad(sr, 'peaking', 95, 1.2, 4), exhaustHp = new Biquad(sr, 'highpass', 45, 0.7);
  const intakeBp = new Biquad(sr, 'bandpass', 900, 0.8), mechHp = new Biquad(sr, 'highpass', 300, 0.7);
  rpmS.y = ENGINE.rpmPerMs * carAt(carTimes.start).speed; loadS.y = 0.55; // already cruising when it appears
  let phase = 0, cycleAmp = 1, cycleN = 0, jitter = 1;

  // ---------- tyres on snow ----------
  const tNoise = white(rngFor('audio:car:tyre')), tBp = new Biquad(sr, 'bandpass', 500, 0.7), tLp = new OnePole(sr, 2500);
  const crunchRng = rngFor('audio:car:crunch'), crunchBp = new Biquad(sr, 'bandpass', 1700, 1.2);
  let crunch = 0;

  // ---------- one-shots: brake creak, settle, doors, key, ticks ----------
  const at = (along, side, up) => (t) => carPoint(t, along, side, up);
  const ev = [];
  // the brakes creak over the last half second of the stop, then the body settles on its springs
  const creak = { t: carTimes.stop - 0.55, dur: 0.6 };
  ev.push({
    t: creak.t, dur: creak.dur, place: at(1.2, 0.8, 0.35), law: CAR_LAW,
    make: () => {
      const bp = new Biquad(sr, 'bandpass', 1150, 9), r2 = rngFor('audio:car:creak');
      let ph = 0;
      return (dt) => {
        const u = dt / creak.dur, hz = 150 - 90 * u;
        ph += hz / sr;
        const stick = ph >= 1 ? (ph -= 1, 1) : 0;
        const env = smoothstep(0, 0.3, u) * (1 - smoothstep(0.85, 1, u));
        return bp.process(stick * (0.7 + 0.3 * r2())) * env * 3.2 * C.brakeGain;
      };
    },
  });
  for (const [dt0, amp] of [[0, 1], [0.38, 0.45]]) {
    ev.push({
      t: carTimes.stop + dt0, dur: 0.35, place: at(0, 0, 0.4), law: CAR_LAW,
      make: () => { const lp = new Biquad(sr, 'lowpass', 260, 0.8), n = white(rngFor(`audio:car:settle:${dt0}`)); return (dt) => (ring(dt, 48, 0.07) * 0.8 + lp.process(n()) * Math.exp(-dt / 0.04) * 0.6) * amp * C.settleGain; },
    });
  }
  // doors: an open is the latch and the seal letting go, then a hinge creak through the swing; a shut is the
  // door's body thump with the latch catching 12 ms later
  for (const d of DOOR_EVENTS) {
    if (d.kind === 'open') {
      ev.push({
        t: d.t, dur: d.swing + 0.3, place: at(0.3, d.side, 0.9), law: DOOR_LAW,
        make: () => {
          const r2 = rngFor(`audio:car:door:${d.t}`), n = white(r2), bp = new Biquad(sr, 'bandpass', 2600, 2.5), hp = new Biquad(sr, 'bandpass', 520, 6);
          let ph = 0;
          return (dt) => {
            const latch = bp.process(n()) * Math.exp(-dt / 0.006) * 2.2 + ring(dt, 1350, 0.012) * 0.35 + ring(dt, 140, 0.03) * 0.3;
            const seal = dt > 0.04 ? Math.exp(-(dt - 0.04) / 0.05) * n() * 0.18 : 0;
            const u = (dt - 0.06) / d.swing;
            let hinge = 0;
            if (u > 0 && u < 1) { ph += (35 + 25 * Math.sin(Math.PI * u)) / sr; if (ph >= 1) { ph -= 1; hinge = 1; } }
            return (latch + seal + hp.process(hinge * (0.6 + 0.4 * r2())) * 1.6 * Math.sin(Math.PI * clamp(u, 0, 1))) * C.doorGain;
          };
        },
      });
    } else {
      ev.push({
        t: d.t, dur: 0.5, place: at(0.3, d.side, 0.8), law: DOOR_LAW,
        make: () => {
          const r2 = rngFor(`audio:car:door:${d.t}`), n = white(r2), lp = new Biquad(sr, 'lowpass', 420, 0.9), bp = new Biquad(sr, 'bandpass', 2300, 2.5);
          return (dt) => {
            const body = lp.process(n()) * Math.exp(-dt / 0.05) * 2.4 + ring(dt, 82, 0.09) * 0.9 + ring(dt, 210, 0.035, 0.5) * 0.4;
            const latch = dt > 0.012 ? bp.process(n()) * Math.exp(-(dt - 0.012) / 0.005) * 1.6 + ring(dt - 0.012, 1600, 0.01) * 0.25 : bp.process(0);
            return (body + latch) * C.doorGain * 1.6;
          };
        },
      });
    }
  }
  // the key: two small clicks inside the car at the wheel
  ev.push({
    t: T_OFF, dur: 0.12, place: at(0.4, -0.45, 0.9),
    make: () => { const n = white(rngFor('audio:car:key')), bp = new Biquad(sr, 'bandpass', 3200, 3); return (dt) => bp.process(n()) * (Math.exp(-dt / 0.003) + (dt > 0.035 ? 0.6 * Math.exp(-(dt - 0.035) / 0.003) : 0)) * 1.4 * C.keyGain; },
  });
  // hot metal ticks as the engine cools: further apart as time goes on
  for (let t = carTimes.lightsOff1 + 1.1, i = 0; t < 75; i++) {
    const hz = 3200 + 2400 * rng(), amp = 0.5 + 0.5 * rng();
    ev.push({
      t, dur: 0.06, place: at(1.5, (rng() - 0.5) * 0.8, 0.7),
      make: () => (dt) => (ring(dt, hz, 0.008) + 0.5 * ring(dt, hz * 1.53, 0.005)) * amp * C.tickGain,
    });
    t += 1.2 + i * 0.35 + 1.5 * rng();
  }
  const oneShots = makeEvents(ctx, ev);

  return {
    name: 'car',
    bus: 'fx',
    reverb: 0.2,
    process(L, R, i0, n) {
      const t0 = i0 / sr;
      if (t0 < carTimes.start - 0.01) return; // nothing before the car appears
      for (let k = 0; k < n; k++) {
        const t = (i0 + k) / sr;
        const e = engineAt(t);
        let f = 0, r = 0;
        if (e.on) {
          // rpm and load are smoothed so a change of phase never steps; the engine starts already running at 14.0
          const rpm = rpmS.process(e.rpm), load = loadS.process(e.load);
          const fire = (rpm / 60) * (ENGINE.cylinders / 2);
          phase += (fire * jitter) / sr;
          if (phase >= 1) {
            phase -= 1; cycleN++;
            // each firing a little different, and every other one weaker (the burble)
            cycleAmp = (0.85 + 0.3 * eRng()) * (cycleN % 2 ? 0.82 : 1) * (e.dying < 0.35 ? 0.5 + eRng() : 1);
            jitter = 1 + (eRng() - 0.5) * 0.04;
          }
          const pulse = Math.exp(-phase * 7) * cycleAmp - 0.14;
          const g = (0.03 + 1.75 * load) * e.dying ** 0.5 * smoothstep(carTimes.start - 0.01, carTimes.start + 0.25, t);
          // a soft saturation, like a pipe's own limit: the burble keeps its body and loses its sharpest peaks
          r = Math.tanh(1.6 * exhaustHp.process(exhaustBoom.process(exhaustLp.process(pulse))) * g * 1.3) / 1.6 * C.exhaustGain;
          const comb = eNoise() * (0.25 + Math.exp(-phase * 5));
          if (k === 0) intakeBp.set(500 + rpm * 0.45 + 900 * load, 0.8);
          f = (intakeBp.process(comb) * 0.5 + mechHp.process(pulse) * 0.12) * g * C.intakeGain;
        }
        bufF[k] = f; bufR[k] = r;
        // tyres: a soft roar that rises with speed, and snow crunching under them, grain by grain, slow at the end
        const c = carAt(t);
        let ty = 0;
        if (c.present && c.speed > 0) {
          if (k === 0) tBp.set(250 + 90 * c.speed, 0.7);
          ty = tLp.process(tBp.process(tNoise())) * Math.min(1, c.speed / 5.3) ** 1.3 * 0.55;
          if (crunchRng() < (c.speed * 110 + 12) / sr) crunch = 0.4 + 0.6 * crunchRng();
          ty += crunchBp.process(crunch * (crunchRng() * 2 - 1)) * 0.4;
          crunch *= Math.exp(-1 / (0.003 * sr));
        }
        bufT[k] = ty * C.tyreGain;
      }
      front.process(bufF, L, R, i0, n);
      rear.process(bufR, L, R, i0, n);
      tyres.process(bufT, L, R, i0, n);
      oneShots.process(L, R, i0, n);
      for (let k = 0; k < n; k++) { L[k] *= C.level; R[k] *= C.level; }
    },
  };
}
