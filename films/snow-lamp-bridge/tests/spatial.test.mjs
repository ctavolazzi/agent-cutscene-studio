// Spatializer tests (src/audio/spatial.js): screen direction and pan width follow from the pan formula, so they are
// tested here rather than reported per shot (SOUND-PLAN 4.0); and the guard for sources near the listener's vertical
// axis (3.5). Each check is a function returning its problems; the real spatializer gives none, a planted fault some.
// Run: node --test tests/spatial.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { SHOTS, cameraAt, shotAt, hfovDeg } from '../src/shots.js';
import { T_TOTAL, FPS } from '../src/world.js';
import { CUES } from '../src/audio/cues.js';
import { SPATIAL, axisSine, listenerAt, makeSpatializer, placeAt } from '../src/audio/spatial.js';
import { LAYERS, makeContext } from '../src/audio/index.js';
import { renderAll } from '../src/audio/mix.js';
import { makeCamera, D2R } from '../scripts/lib/math.js';

const { w: W, h: H } = CONFIG.res;
const pan = (p, t) => placeAt(p, t).pan;
const mirrored = (p, t) => -pan(p, t);
const doubled = (p, t) => Math.max(-1, Math.min(1, 2 * pan(p, t)));
const withAxis = (deg, f) => { const keep = SPATIAL.axisDeg; SPATIAL.axisDeg = deg; try { return f(); } finally { SPATIAL.axisDeg = keep; } };
const dbOf = (g) => 20 * Math.log10(g);

// A world point at screen fraction (xn, yn) from the centre (-1..1, +y up) and `depth` m in front of the camera at t.
function screenPoint(t, xn, yn, depth) {
  const cam = makeCamera(cameraAt(shotAt(t), t), W, H);
  return [0, 1, 2].map((j) => cam.pos[j] + cam.f[j] * depth + cam.r[j] * xn * cam.th * depth + cam.u[j] * yn * cam.tv * depth);
}
// Where a point lands on screen at t: fractions from the centre, and the roll band there. With the camera rolled by
// `roll`, the pan (from the unrolled right axis) and the screen side can disagree only where |xn| <= |yn| (H/W) tan(roll).
function onScreen(p, t) {
  const c = cameraAt(shotAt(t), t), cam = makeCamera(c, W, H), q = cam.project(p);
  if (!q || q[0] < 0 || q[0] > W || q[1] < 0 || q[1] > H) return null;
  const xn = 2 * q[0] / W - 1, yn = 1 - 2 * q[1] / H;
  return { xn, yn, band: Math.abs(yn) * (H / W) * Math.abs(Math.tan((c.roll ?? 0) * D2R)) };
}

// ---------- screen direction ----------
// Every on-screen point outside the roll band pans to its own screen side: a grid of screen points at three depths in
// every shot at its start, middle and end (with columns close to the centre line, where the band is), and every enabled
// placed cue on every frame it sounds on screen. Inside the band the disagreements are counted per shot.
const COLUMNS = [-0.95, -0.7, -0.45, -0.2, -0.05, -0.02, -0.01, 0.01, 0.02, 0.05, 0.2, 0.45, 0.7, 0.95];
function directionProblems(panOf) {
  const p = [], inBand = {}, flipped = {};
  const judge = (pt, t, what) => {
    const s = onScreen(pt, t);
    if (!s || Math.abs(s.xn) < 1e-9) return;
    const v = panOf(pt, t), n = shotAt(t).n, agree = Math.sign(v) === Math.sign(s.xn);
    if (Math.abs(s.xn) <= s.band) { inBand[n] = (inBand[n] ?? 0) + 1; if (!agree) flipped[n] = (flipped[n] ?? 0) + 1; return; }
    if (!agree) p.push(`${what} at ${t.toFixed(3)}: screen ${s.xn.toFixed(3)}, pan ${v.toFixed(3)}`);
  };
  for (const s of SHOTS) for (const t of [s.start, (s.start + s.end) / 2, s.end - 1e-3]) {
    for (const xn of COLUMNS) for (const yn of [-0.95, -0.5, 0, 0.5, 0.95]) for (const d of [2, 10, 40]) judge(screenPoint(t, xn, yn, d), t, `shot ${s.n} grid ${xn},${yn} at ${d} m`);
  }
  for (const c of CUES) {
    if (!c.enabled || !c.place) continue;
    for (let f = Math.ceil(c.t0 * FPS - 1e-9); f / FPS < c.t1 && f / FPS < T_TOTAL; f++) { const t = f / FPS, q = c.place(t); if (q) judge(q, t, c.id); }
  }
  return { problems: p, inBand, flipped };
}

test('screen direction: every on-screen source pans to its own screen side, outside the band shot 5\'s roll opens', () => {
  const real = directionProblems(pan);
  assert.deepEqual(real.problems, []);
  // the band is shot 5's alone: it is the only shot that rolls, and its grid points near the centre fall in it
  const rolled = SHOTS.filter((s) => s.keys.some((k) => k.roll)).map((s) => s.n);
  assert.deepEqual(rolled, [5]);
  assert.deepEqual(Object.keys(real.inBand).map(Number), rolled, `points in the roll band: ${JSON.stringify(real.inBand)}`);
  // and the band is needed: inside it, some points do pan to the other side (the roll turns the screen's axes)
  assert.ok(real.flipped[5] > 0, `flips inside shot 5's band: ${JSON.stringify(real.flipped)}`);
  // control: a mirrored pan
  assert.ok(directionProblems(mirrored).problems.length > 100, 'control: the mirrored pan is caught');
});

// ---------- pan width at the frame edge, per lens ----------
// A source at the frame's left or right edge, level with the lens axis, pans by sin(hfov / 2) alone. SOUND-PLAN 2.1's
// table, by lens and the shots that use it, to its two decimals; and exactly the lens's half angle.
const PLAN_WIDTH = { 85: [0.24, [10, 14]], 70: [0.29, [12]], 50: [0.39, [1, 8, 11]], 35: [0.52, [3, 5, 6, 7, 9, 13]], 24: [0.66, [2, 4, 15]] };
function widthProblems(panOf) {
  const p = [];
  const lenses = [...new Set(SHOTS.map((s) => s.lens))].sort((a, b) => a - b);
  if (JSON.stringify(lenses) !== JSON.stringify(Object.keys(PLAN_WIDTH).map(Number).sort((a, b) => a - b))) p.push(`lenses ${lenses}`);
  for (const [lens, [width, shots]] of Object.entries(PLAN_WIDTH)) {
    const uses = SHOTS.filter((s) => s.lens === Number(lens)).map((s) => s.n);
    if (JSON.stringify(uses) !== JSON.stringify(shots)) p.push(`${lens} mm: shots ${uses}, the plan says ${shots}`);
    const half = Math.sin(hfovDeg(Number(lens)) / 2 * D2R);
    for (const n of uses) {
      const s = SHOTS[n - 1], t = s.keys.find((k) => !k.roll)?.t ?? s.end - 1e-3; // a moment the camera is level
      for (const side of [-1, 1]) {
        const v = panOf(screenPoint(t, side, 0, 6), t);
        if (Math.abs(v - side * half) > 1e-9) p.push(`shot ${n} (${lens} mm) ${side < 0 ? 'left' : 'right'} edge: pan ${v}, sin(hfov / 2) ${half}`);
        if (Math.abs(Math.abs(v) - width) > 0.005) p.push(`shot ${n} (${lens} mm): |pan| ${Math.abs(v).toFixed(3)}, the plan's table ${width}`);
      }
    }
  }
  return p;
}

test('pan width at the frame edge: sin(hfov / 2) for each lens, as SOUND-PLAN 2.1\'s table (0.24 at 85 mm to 0.66 at 24 mm)', () => {
  assert.deepEqual(widthProblems(pan), []);
  assert.ok(widthProblems(doubled).length > 0, 'control: a doubled pan');
  assert.ok(widthProblems(mirrored).length > 0, 'control: a mirrored pan');
});

// ---------- the vertical-axis guard ----------
// A listener 1.5 m up looking north, pitched by `deg`, and sources around the point 7.5 m straight below it (the water
// under a deck camera, the case SOUND-PLAN 3.5 names): a tiny pitch must not switch the behind loss, straight below or
// off the axis toward the camera's side (where the pitch carries the source across z = 0) through the cone's inner part,
// a centimetre to either side must not flip the pan, and the guard must be continuous at its edge. Toward the edge the
// ramp narrows to meet the hard behind plane outside the cone, where a source at the camera's side switches the whole
// 2.5 dB on a tiny pitch by the plane's design (SOUND-PLAN 2.1), the axis or not. The bars, 0.05 dB and 1% of the air
// filter on a 0.1 degree pitch, are starting values far under a just noticeable level change.
const listener = (deg) => { const a = deg * D2R, f = [0, Math.sin(a), -Math.cos(a)]; return { pos: [0, 1.5, 0], f, r: [1, 0, 0] }; };
const below = (dx = 0) => [dx, -6, 0];
const offAxis = (frac) => { const a = frac * SPATIAL.axisDeg * D2R; return [Math.sin(a) * 7.5, 1.5 - Math.cos(a) * 7.5, 0]; };
const INNER = [0, 0.1, 0.25, 0.5, 0.75]; // fractions of the cone's angle judged on the pitch bar
const pitchSwitch = (q, hear = placeAt) => { const up = hear(q, 0, listener(0.05)), down = hear(q, 0, listener(-0.05)); return { db: dbOf(up.gain) - dbOf(down.gain), air: up.hz / down.hz - 1, hz: [up.hz, down.hz] }; };
function guardProblems(hear = placeAt) {
  const p = [];
  for (const frac of INNER) {
    const s = pitchSwitch(offAxis(frac), hear), at = frac ? `${(frac * SPATIAL.axisDeg).toFixed(1)} degrees off the axis` : 'straight below';
    if (Math.abs(s.db) > 0.05) p.push(`${at}: a 0.1 degree pitch switches ${s.db.toFixed(3)} dB`);
    if (Math.abs(s.air) > 0.01) p.push(`${at}: a 0.1 degree pitch switches the air filter ${s.hz[0].toFixed(0)} to ${s.hz[1].toFixed(0)} Hz`);
  }
  const l = hear(below(-0.01), 0, listener(0.05)), r = hear(below(0.01), 0, listener(0.05));
  if (Math.abs(r.pan - l.pan) > 0.02) p.push(`2 cm across swings the pan ${l.pan.toFixed(2)} to ${r.pan.toFixed(2)}`);
  // continuity at the cone's edge: a source just inside and just outside it, in front and behind
  const edge = SPATIAL.axisDeg * D2R;
  for (const zs of [1, -1]) {
    const at = (a) => [Math.sin(a) * 0.6 * 7.5, -Math.cos(a) * 7.5 + 1.5, -zs * Math.sin(a) * 0.8 * 7.5];
    const a = hear(at(edge * (1 - 1e-9)), 0, listener(0)), b = hear(at(edge * (1 + 1e-9)), 0, listener(0));
    if (Math.abs(a.pan - b.pan) > 1e-6 || Math.abs(dbOf(a.gain) - dbOf(b.gain)) > 1e-6 || Math.abs(a.hz - b.hz) > 1e-3) p.push(`a step at the cone's edge (${zs > 0 ? 'in front' : 'behind'})`);
  }
  return p;
}
// The first run's guard, the planted fault off the axis: inside the cone its behind share still switched by w across
// z = 0 (half the 2.5 dB at half the cone's angle). Rebuilt here from the formula without a guard, as placeAt had it.
function firstRunGuard(q, t, L) {
  const o = withAxis(0, () => placeAt(q, t, L)), d = q.map((v, j) => v - L.pos[j]), dist = Math.hypot(...d);
  const x = d[0] * L.r[0] + d[1] * L.r[1] + d[2] * L.r[2], z = d[0] * L.f[0] + d[1] * L.f[1] + d[2] * L.f[2];
  const edge = Math.sin(SPATIAL.axisDeg * D2R), s = Math.hypot(x, z) / dist;
  if (s >= edge) return o;
  const w = s / edge, b = 0.5 + ((z < 0 ? 1 : 0) - 0.5) * w, un = z < 0 ? [SPATIAL.behindGain, SPATIAL.behindAir] : [1, 1];
  return { ...o, pan: o.pan * w, gain: o.gain / un[0] * (1 + (SPATIAL.behindGain - 1) * b), hz: o.hz / un[1] * (1 + (SPATIAL.behindAir - 1) * b) };
}

test('the vertical-axis guard: no behind switch on a tiny pitch in the cone\'s inner part, no pan flip a centimetre across, continuous at its edge', () => {
  assert.deepEqual(guardProblems(), []);
  const near = [0.99, 1.01].map((frac) => `${(frac * SPATIAL.axisDeg).toFixed(1)} deg ${pitchSwitch(offAxis(frac)).db.toFixed(3)} dB`);
  console.log(`   a 0.1 degree pitch, off the axis: ${INNER.map((frac) => `${(frac * SPATIAL.axisDeg).toFixed(1)} deg ${pitchSwitch(offAxis(frac)).db.toFixed(3)} dB`).join(', ')}; toward the edge ${near.join(', ')}`);
  // control: the guard removed (a cone of 0 degrees is the formula without it): 2.5 dB and the air filter switch on a
  // 0.1 degree pitch, and the pan swings from one side to the other
  const off = withAxis(0, () => guardProblems());
  assert.ok(off.some((x) => x.includes('dB')) && off.some((x) => x.includes('air filter')) && off.some((x) => x.includes('pan')), `control: ${off}`);
  // control: the first run's guard passes straight below and fails off the axis, 1.25 dB at half the cone's angle
  const first = guardProblems(firstRunGuard);
  assert.ok(first.length && first.every((x) => !x.startsWith('straight below')) && first.some((x) => x.startsWith(`${(0.5 * SPATIAL.axisDeg).toFixed(1)} degrees off the axis: a 0.1 degree pitch switches`)), `control: ${first}`);
});

// Away from the axis the guard is not there: every result equal, bit for bit, to the formula without it, on a sweep of
// directions all round a real listener, near and far. `hear` is the spatializer under test.
const D2EDGE = Math.sin(SPATIAL.axisDeg * D2R);
function awayProblems(hear = placeAt) {
  const p = [], t = 57, L = listenerAt(t);
  const u = [L.r[1] * L.f[2] - L.r[2] * L.f[1], L.r[2] * L.f[0] - L.r[0] * L.f[2], L.r[0] * L.f[1] - L.r[1] * L.f[0]];
  let n = 0;
  for (let az = 0; az < 360; az += 7.5) for (let el = -88; el <= 88; el += 4) for (const d of [0.5, 3, 30]) {
    const a = az * D2R, e = el * D2R;
    const q = [0, 1, 2].map((j) => L.pos[j] + d * (Math.cos(e) * (Math.sin(a) * L.r[j] + Math.cos(a) * L.f[j]) + Math.sin(e) * u[j]));
    if (axisSine(q, L) < D2EDGE) continue;
    n++;
    const g = hear(q, t, L), o = withAxis(0, () => placeAt(q, t, L));
    if (!['pan', 'gain', 'hz', 'dist'].every((k) => Object.is(g[k], o[k]))) p.push(`az ${az} el ${el} at ${d} m`);
  }
  return { problems: p, n };
}

test('away from the vertical axis the guard changes nothing: bit for bit the formula without it', () => {
  const r = awayProblems();
  assert.deepEqual(r.problems, []);
  assert.ok(r.n > 4000, `${r.n} directions outside the cone`);
  // control: a guard reaching twice as far is caught in the sweep, between the two cones
  assert.ok(awayProblems((q, t, L) => withAxis(2 * SPATIAL.axisDeg, () => placeAt(q, t, L))).problems.length > 0, 'control: a wider guard');
});

// The closest any placed sound comes to the vertical axis: every position the parked design's spatializers ask for
// while the soundtrack renders (each block's ends, exactly what placeAt receives), and every enabled cues.js point on
// every frame it sounds. Outside the cone the formula is unchanged (above), so the render is too.
function closestParked() {
  const ctx = makeContext(CONFIG);
  let m = { s: Infinity };
  const spy = { ...ctx, spatializer: (place, law) => makeSpatializer(ctx.sr, (t) => { const p = place(t); if (p) { const s = axisSine(p, listenerAt(t)); if (s < m.s) m = { s, t }; } return p; }, law) };
  renderAll({ layers: LAYERS.map((l) => l.build(spy)), config: CONFIG, sr: ctx.sr, total: T_TOTAL, normalize: false, reverb: false });
  return m;
}
function closestCue(list = CUES) {
  let m = { s: Infinity };
  for (const c of list) {
    if (!c.enabled || !c.place) continue;
    for (let f = Math.ceil(c.t0 * FPS - 1e-9); f / FPS < c.t1 && f / FPS < T_TOTAL; f++) {
      const t = f / FPS, p = c.place(t);
      if (p) { const s = axisSine(p, listenerAt(t)); if (s < m.s) m = { s, t, id: c.id }; }
    }
  }
  return m;
}

test('today\'s mix never comes near the axis: the parked design and cues.js stay outside the cone', () => {
  const parked = closestParked(), cues = closestCue();
  console.log(`   closest to the vertical axis: parked ${(Math.asin(parked.s) / D2R).toFixed(2)} deg at ${parked.t}, cues.js ${(Math.asin(cues.s) / D2R).toFixed(2)} deg (${cues.id} at ${cues.t})`);
  assert.ok(parked.s > D2EDGE && cues.s > D2EDGE, 'outside the cone');
  // control: a source planted straight below shot 8's camera, the water under the deck, is inside it
  const L = listenerAt(57), plant = { ...CUES.find((c) => c.family === 'hum'), id: 'planted', t0: 56, t1: 58, place: () => [L.pos[0], -6, L.pos[2]] };
  assert.ok(closestCue([plant]).s < D2EDGE, 'control: a source straight below a deck camera');
});
