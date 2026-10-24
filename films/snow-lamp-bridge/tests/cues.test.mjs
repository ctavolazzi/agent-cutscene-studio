// Checks for the sound effects catalogue (src/audio/cues.js): the counts the spotting session found, every derived time
// equal to the picture function it comes from, a second import identical, the three orders and the Gate 0 answers.
// Each check is a function returning its problems; the real list must give none, and a planted fault must give some.
// Run: node --test tests/cues.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { CUES, LAWS, LEVELS, DESIGN, LOCATIONS, cuesAt, cuesIn, locationAt } from '../src/audio/cues.js';
import { CONFIG } from '../src/config.js';
import { carAt, carTimes, headlights, moonlight, CAR, PEOPLE, PEOPLE_KEYS, LIGHTER, EMBER, EXHALE, T_TOTAL } from '../src/world.js';
import { BUILDINGS } from '../src/set.js';
import { SHOTS, cameraAt, shotAt } from '../src/shots.js';
import { SETTLE, DOOR_SIDE } from '../src/actors/car.js';
import { BODY, EXIT, bodyToWorld, groundY, makePoser } from '../src/actors/people.js';
import { PRINT, footprintList } from '../src/fx/footprints.js';
import { SPATIAL, placeAt, listenerAt } from '../src/audio/spatial.js';
import { CAR_LAW } from '../src/audio/layers/car.js';
import { FOLEY_LAW, surfaceOf } from '../src/audio/layers/foley.js';

const SR = CONFIG.audio.sr;
const T = carTimes;
const near = (a, b, eps) => Math.abs(a - b) <= eps;
const plant = (list, id, patch) => list.map((c) => (c.id === id ? { ...c, ...patch } : c));
const byId = new Map(CUES.map((c) => [c.id, c]));
const posers = Object.fromEntries(Object.keys(PEOPLE).map((id) => [id, makePoser(id)]));
const doorOf = (id) => Object.keys(DOOR_SIDE).find((tag) => DOOR_SIDE[tag] === EXIT.outSide[id]);
const shot8 = SHOTS.find((s) => s.n === 8), last = SHOTS[SHOTS.length - 1];

// ---------- counts ----------
function countProblems(list) {
  const p = [], feet = list.filter((c) => c.family === 'feet');
  const surfaces = {};
  for (const c of feet) surfaces[c.surface] = (surfaces[c.surface] ?? 0) + 1;
  const prints = feet.flatMap((c) => c.meta.prints);
  if (feet.length !== 63) p.push(`${feet.length} steps, want 63`);
  if (prints.length !== 64 || prints.length !== footprintList().length) p.push(`${prints.length} prints behind the steps, want 64`);
  if (surfaces.road !== 16 || surfaces.walk !== 33 || surfaces.deck !== 14) p.push(`surfaces ${JSON.stringify(surfaces)}`);
  for (const c of feet) if (c.surface !== surfaceOf(footprintList().find((f) => f.t === c.print && f.id === c.person))) p.push(`${c.id} surface is not surfaceOf()'s`);
  const doors = list.filter((c) => c.family === 'door');
  if (doors.length !== 10) p.push(`${doors.length} door cues, want 10`);
  for (const tag of Object.keys(DOOR_SIDE)) for (const part of ['unlatch', 'swing-open', 'stop', 'swing-shut', 'latch']) if (!doors.some((c) => c.id === `hard.door.${tag}.${part}`)) p.push(`no ${tag} ${part}`);
  return p;
}

test('counts: 63 steps from 64 prints (16 road, 33 walk, 14 deck by surfaceOf) and 10 door cues', () => {
  assert.deepEqual(countProblems(CUES), []);
  // control: B's two boots left as two steps, and a door cue dropped
  const both = CUES.find((c) => c.family === 'feet' && c.meta.prints.length > 1);
  assert.ok(both, 'one step stands on two prints');
  const split = CUES.flatMap((c) => (c === both ? [0, 1].map((i) => ({ ...c, id: `${c.id}${i}`, meta: { ...c.meta, prints: [c.meta.prints[i]] } })) : [c]));
  assert.ok(countProblems(split).length > 0, 'control: an unmerged flam');
  assert.ok(countProblems(CUES.filter((c) => c.id !== 'hard.door.driver.stop')).length > 0, 'control: a missing door stop');
});

// ---------- flams ----------
function flamProblems(list) {
  const p = [];
  for (const id of Object.keys(PEOPLE)) {
    const own = list.filter((c) => c.family === 'feet' && c.person === id).sort((a, b) => a.sync - b.sync);
    for (let i = 1; i < own.length; i++) if (own[i].sync - own[i - 1].sync < DESIGN.STEP.flam) p.push(`${own[i - 1].id} and ${own[i].id}`);
  }
  return p;
}

test('flams: no person has two steps within 30 ms on contact times', () => {
  assert.equal(DESIGN.STEP.flam, 0.03);
  assert.deepEqual(flamProblems(CUES), []);
  const a = CUES.find((c) => c.id === 'foley.feet.A.05');
  assert.ok(flamProblems([...CUES, { ...a, id: 'foley.feet.A.99', sync: a.sync + 0.01 }]).length > 0, 'control: two prints 10 ms apart');
});

// ---------- derived times ----------
// The planted fault the contact checks catch: one person's ankle by footprintList()'s own rule
const stand = (id) => BODY.ankleY * (PEOPLE[id].height / 1.8);
const down = (id, foot, t) => {
  const p = posers[id](t);
  if (!p.visible) return false;
  const a = bodyToWorld(p, p.legs[foot].ankle);
  return a[1] - groundY(a[0], a[2]) - stand(id) <= PRINT.rest;
};
// the first sample at or after the print step before it where the ankle is down, by a plain scan
const contactOf = (f) => { for (let k = Math.ceil((f.t - PRINT.dt) * SR); k <= Math.round(f.t * SR); k++) if (down(f.id, f.foot, k / SR)) return k / SR; return null; };
// an independent ground-plane test: the camera to point segment crossing a building's footprint, by orientations
const orient = (a, b, c) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
const segsCross = (p, q, r, s) => orient(p, q, r) * orient(p, q, s) < 0 && orient(r, s, p) * orient(r, s, q) < 0;
const hidden = (t) => {
  const c = carAt(t), h = c.heading * Math.PI / 180, nose = [c.x + Math.sin(h) * CAR.length / 2, c.z - Math.cos(h) * CAR.length / 2];
  const cam = cameraAt(shotAt(t), t).pos, e = [cam[0], cam[2]];
  return BUILDINGS.some((b) => { const r = [[b.x0, b.z0], [b.x1, b.z0], [b.x1, b.z1], [b.x0, b.z1]]; return r.some((v, i) => segsCross(e, nose, v, r[(i + 1) % 4])); });
};

function expectations() {
  const e = new Map(), D = T.doors;
  for (const tag of Object.keys(D)) {
    const d = D[tag];
    Object.entries({ unlatch: [d.open0], 'swing-open': [d.open0, d.open1], stop: [d.open1], 'swing-shut': [d.close0, d.close1], latch: [d.close1] }).forEach(([part, [sync, t1]]) => e.set(`hard.door.${tag}.${part}`, { sync, t1 }));
  }
  for (const part of ['intake', 'exhaust']) { e.set(`hard.engine.car.${part}`, { sync: T.start, t1: T.stop }); e.set(`hard.engine.car.${part}-idle`, { sync: T.stop, t1: T.lightsOff0 }); }
  e.set('hard.engine.car.door-open', { sync: Math.min(...Object.values(D).map((d) => d.open0)), t1: Math.max(...Object.values(D).map((d) => d.close1)) });
  e.set('hard.stop.car.rundown', { sync: T.lightsOff0, t1: T.lightsOff1 });
  for (const part of ['front', 'rear']) e.set(`hard.tyres.car.${part}`, { sync: T.start, t1: T.stop });
  e.set('hard.brake.car.pads1', { sync: T.brake, t1: T.turn0 });
  e.set('hard.brake.car.pads2', { sync: T.turn1, t1: T.stop });
  e.set('hard.brake.car.creak', { t1: T.stop, ok: (c) => carAt(c.sync).speed < DESIGN.CREAK.speed && carAt(c.sync - 1e-9).speed >= DESIGN.CREAK.speed });
  e.set('hard.settle.car.dip', { sync: T.stop });
  e.set('hard.settle.car.rebound', { sync: T.stop + SETTLE.dur / 2 });
  e.set('hard.cabin.car.handbrake', { sync: T.stop + SETTLE.dur });
  e.set('hard.arrival.car.rise', { sync: T.start });
  e.set('hard.arrival.car.swell', { t1: T.stop, ok: (c) => hidden(c.sync - 1e-6) && !hidden(c.sync + 1e-6) });
  for (const id of Object.keys(PEOPLE)) {
    e.set(`hard.cabin.${id}.belt`, { sync: D[doorOf(id)].open0 });
    const keys = PEOPLE_KEYS[id], i = keys.findIndex((k) => k.pose === 'emerge');
    e.set(`hard.unload.${id}.slide`, { sync: keys[i].t, t1: keys[i + 1].t });
    e.set(`hard.unload.${id}.rise`, { sync: keys[i + 1].t, t1: keys[i + 2].t });
  }
  e.set('foley.lighter.A.strike', { sync: LIGHTER.t0, t1: LIGHTER.t0 });
  e.set('foley.lighter.A.flame', { sync: LIGHTER.t0, t1: LIGHTER.t1 });
  e.set('foley.lighter.A.release', { sync: LIGHTER.t1 });
  EMBER.drags.forEach((d, i) => {
    e.set(`foley.drag.A.${i + 1}`, { sync: d, t1: d + EMBER.dragDur });
    const t0 = near(d + EMBER.dragDur, EXHALE.t, 1e-9) ? EXHALE.t : d + EMBER.dragDur;
    e.set(`foley.breath.A.exhale${i + 1}`, { sync: t0, t1: t0 + EXHALE.life });
  });
  e.set('bg.wind.street.bed', { sync: 0, t1: shot8.start });
  e.set('bg.city.street.bed', { sync: 0, t1: shot8.start });
  for (const f of ['wind', 'city', 'water']) e.set(`bg.${f}.bridge.bed`, { sync: shot8.start, t1: T_TOTAL });
  e.set('bg.ambience.wind.ease', { ok: (c) => moonlight(c.sync - 1e-9) === 0 && moonlight(c.sync) > 0 && moonlight(c.t1) >= 1 && moonlight(c.t1 - 1e-9) < 1 });
  e.set('bg.ambience.night.open', { sync: last.keys[0].t, t1: last.keys[1].t });
  e.set('bg.hum.lamp.bed', { sync: 0, t1: T_TOTAL });
  return e;
}

// the families made by a rule over sampled data, checked by their own property
function ruleProblems(c) {
  const p = [];
  if (c.family === 'feet') {
    const prints = footprintList().filter((f) => f.id === c.person && c.meta.prints.includes(f.t));
    if (!prints.length) return [`${c.id}: no print at ${c.print}`];
    const contact = Math.min(...prints.map(contactOf));
    if (!near(c.sync, contact, 1e-6)) p.push(`${c.id}: contact ${c.sync}, the rig says ${contact}`);
    if (!near(c.print, prints[0].t, 1e-9)) p.push(`${c.id}: print ${c.print}`);
  } else if (c.family === 'tick') {
    const ticks = CUES.filter((x) => x.family === 'tick'), i = ticks.findIndex((x) => x.id === c.id);
    const want = i === 0 ? T.lightsOff1 + DESIGN.TICK.delay : ticks[i - 1].sync + ticks[i - 1].meta.gap;
    if (!near(c.sync, want, 1e-9)) p.push(`${c.id}: ${c.sync}, the rule says ${want}`);
  } else if (c.family === 'moves' && c.meta.kind === 'rest') {
    const keys = PEOPLE_KEYS[c.person], k = keys.find((x) => x.pose === 'lean');
    const rest = posers[c.person](k.t).arms.map((a) => bodyToWorld(posers[c.person](k.t), a.hand));
    const at = (t) => posers[c.person](t).arms.some((a, h) => { const q = bodyToWorld(posers[c.person](t), a.hand); return Math.hypot(q[0] - rest[h][0], q[1] - rest[h][1], q[2] - rest[h][2]) <= DESIGN.REST.dist; });
    if (!(at(c.sync) && !at(c.sync - 1 / SR) && near(c.sync * SR, Math.round(c.sync * SR), 1e-6 * SR))) p.push(`${c.id}: not the first sample within ${DESIGN.REST.dist} m of rest`);
  } else if (c.family === 'moves') {
    const keys = PEOPLE_KEYS[c.person];
    if (!keys.some((k) => near(k.t, c.sync, 1e-9)) || !keys.some((k) => near(k.t, c.t1, 1e-9))) p.push(`${c.id}: not on ${c.person}'s keys`);
    const walking = (a, b) => posers[c.person]((a + b) / 2).walk.env > 0;
    const inner = keys.filter((k) => k.t >= c.sync - 1e-9 && k.t <= c.t1 + 1e-9);
    const segs = inner.slice(1).map((k, i) => walking(inner[i].t, k.t));
    if (c.meta.kind === 'walk' ? !segs.every(Boolean) : segs.some(Boolean)) p.push(`${c.id}: its segments are ${c.meta.kind === 'walk' ? 'not all' : 'partly'} walking`);
  } else if (c.family === 'scuff') {
    const onGrid = (t) => near(t / PRINT.dt, Math.round(t / PRINT.dt), 1e-6);
    const slid = [0, 1].some((foot) => {
      const a = posers[c.person](c.sync), b = posers[c.person](c.sync + PRINT.dt);
      const pa = bodyToWorld(a, a.legs[foot].ankle), pb = bodyToWorld(b, b.legs[foot].ankle);
      return down(c.person, foot, c.sync + PRINT.dt) && Math.hypot(pb[0] - pa[0], pb[2] - pa[2]) / PRINT.dt > DESIGN.SCUFF.speed;
    });
    if (!onGrid(c.sync) || !onGrid(c.t1) || !slid) p.push(`${c.id}: not a planted slide on PRINT.dt`);
  } else p.push(`${c.id}: no expectation`);
  return p;
}

function timeProblems(list) {
  const e = expectations(), p = [];
  for (const c of list) {
    if (!near(c.t0, c.sync - c.lead + c.nudge, 1e-12)) p.push(`${c.id}: t0 is not sync - lead + nudge`);
    if (!(c.t1 > c.t0)) p.push(`${c.id}: ends at or before it starts`);
    const x = e.get(c.id);
    if (!x) { p.push(...ruleProblems(c)); continue; }
    if (x.sync !== undefined && !near(c.sync, x.sync, 1e-9)) p.push(`${c.id}: sync ${c.sync}, want ${x.sync}`);
    if (x.t1 !== undefined && !near(c.t1, x.t1, 1e-9)) p.push(`${c.id}: t1 ${c.t1}, want ${x.t1}`);
    if (x.ok && !x.ok(c)) p.push(`${c.id}: fails its property`);
  }
  return p;
}

test('every derived time equals the picture function it comes from (1e-9 s; 1e-6 s for contacts from the rig)', () => {
  assert.deepEqual(timeProblems(CUES), []);
  // controls: a door 1 ms late, a step one sample late, a tick off its chain, a cue nothing derives
  assert.ok(timeProblems(plant(CUES, 'hard.door.driver.latch', { sync: T.doors.driver.close1 + 1e-3, t0: T.doors.driver.close1 + 1e-3 })).length > 0, 'control: door');
  const s = byId.get('foley.feet.A.10');
  assert.ok(timeProblems(plant(CUES, s.id, { sync: s.sync + 1 / SR, t0: s.t0 + 1 / SR })).length > 0, 'control: step');
  const k = byId.get('hard.tick.car.03');
  assert.ok(timeProblems(plant(CUES, k.id, { sync: k.sync + 0.01, t0: k.t0 + 0.01 })).length > 0, 'control: tick');
  assert.ok(timeProblems([...CUES, { ...byId.get('hard.settle.car.dip'), id: 'hard.settle.car.typed', sync: 29.38, t0: 29.38, t1: 29.7 }]).length > 0, 'control: a typed time');
  const r = byId.get('foley.moves.B.rest');
  assert.ok(timeProblems(plant(CUES, r.id, { sync: r.sync - 0.08, t0: r.t0 - 0.08 })).length > 0, 'control: the 2 cm reading');
});

// ---------- a second import ----------
const snapshot = (list) => list.map((c) => {
  const o = {};
  for (const [k, v] of Object.entries(c)) o[k] = typeof v === 'function' ? [c.t0, (c.t0 + c.t1) / 2, c.t1].map((t) => v(t)) : v;
  return o;
});

test('a second import builds an identical list', async () => {
  const again = await import('../src/audio/cues.js?second');
  assert.notEqual(again.CUES, CUES, 'a fresh module instance');
  assert.deepStrictEqual(snapshot(again.CUES), snapshot(CUES));
  assert.deepStrictEqual(again.LOCATIONS, LOCATIONS);
  // control: one level changed is seen
  assert.throws(() => assert.deepStrictEqual(snapshot(plant(again.CUES, 'hard.door.driver.latch', { level: 14 })), snapshot(CUES)));
  assert.ok(Object.isFrozen(CUES) && CUES.every((c) => Object.isFrozen(c) && Object.isFrozen(c.designed)), 'frozen');
});

// ---------- ids, order, provenance ----------
function shapeProblems(list) {
  const p = [], seen = new Set();
  const fields = ['id', 'category', 'family', 'source', 'person', 'surface', 'shape', 'sync', 'print', 'lead', 't0', 't1', 'place', 'placement', 'law', 'perspective', 'poa', 'track', 'level', 'reverb', 'priority', 'voices', 'label', 'sdh', 'derivedFrom', 'rule', 'designed', 'nudge', 'new', 'offered', 'enabled'];
  list.forEach((c, i) => {
    if (seen.has(c.id)) p.push(`${c.id} twice`);
    seen.add(c.id);
    if (i && list[i - 1].t0 > c.t0) p.push(`${c.id} out of order`);
    const parts = c.id.split('.');
    if (parts.length !== 4 || parts[0] !== c.category || parts[1] !== c.family) p.push(`${c.id} is not category.family.source.part`);
    for (const f of fields) if (!(f in c)) p.push(`${c.id} has no ${f}`);
    if (!['hard', 'foley', 'bg'].includes(c.category)) p.push(`${c.id} category ${c.category}`);
    if (!c.derivedFrom && !c.rule) p.push(`${c.id} has neither derivedFrom nor rule`);
    if (!Array.isArray(c.designed) || !c.designed.includes('level') || c.designed.some((f) => !(f in c))) p.push(`${c.id} designed ${c.designed}`);
    if ((c.lead !== 0) !== c.designed.includes('lead')) p.push(`${c.id} lead ${c.lead} and its designed list disagree`);
    if (!Number.isFinite(c.level)) p.push(`${c.id} level ${c.level}`);
    if (c.law && !Object.values(LAWS).includes(c.law)) p.push(`${c.id} law is not one of LAWS`);
    if ((c.place === null) !== (c.law === null) || (c.place === null) !== (c.perspective === 'location')) p.push(`${c.id} place, law and perspective disagree`);
    if (!/^\[[^A-Z]*([AB][^A-Z]*)*\]$/.test(c.label) || (c.sdh !== null && !/^\[[a-z][^A-Z]*\]$/.test(c.sdh))) p.push(`${c.id} label ${c.label} / sdh ${c.sdh}`);
    if (c.nudge !== 0) p.push(`${c.id} nudged ${c.nudge} without a gate`);
  });
  return p;
}

test('ids are unique and category.family.source.part, sorted by t0; every cue has derivedFrom or rule and lists its designed fields', () => {
  assert.deepEqual(shapeProblems(CUES), []);
  assert.ok(CUES.length > 100);
  const swapped = [...CUES];
  [swapped[10], swapped[60]] = [swapped[60], swapped[10]];
  assert.ok(shapeProblems(swapped).length > 0, 'control: out of order');
  assert.ok(shapeProblems([...CUES, CUES[5]]).length > 0, 'control: an id twice');
  assert.ok(shapeProblems(plant(CUES, 'hard.tick.car.02', { derivedFrom: null, rule: null })).length > 0, 'control: no provenance');
  assert.ok(shapeProblems(plant(CUES, 'hard.tick.car.02', { designed: Object.freeze(['level', 'loudness']) })).length > 0, 'control: a designed field it does not have');
  assert.ok(shapeProblems(plant(CUES, 'hard.door.driver.latch', { label: '[Car Door Shuts]' })).length > 0, 'control: a capitalised caption');
});

// ---------- the three orders, the Gate 0 answers ----------
// storyOrder 1: nothing but the backgrounds and the hum before the car's first light
const firstLight = (() => { let f = 0; while (!(headlights(f / CONFIG.fps) > 0 && carAt(f / CONFIG.fps).present)) f++; return f / CONFIG.fps; })();
const beforeLight = (list) => list.filter((c) => c.enabled && c.t0 < firstLight - 1e-9 && c.category !== 'bg').map((c) => c.id);
// storyOrder 3: no hard effect or foley starts while the moonlight rises (above 0, until full)
const moonUp = (() => { let k = 0; while (!(moonlight(k / 240) > 0)) k++; return (k - 1) / 240; })();
const moonFull = (() => { let k = Math.round(moonUp * 240); while (moonlight(k / 240) < 1) k++; return k / 240; })();
const duringMoonrise = (list) => list.filter((c) => c.enabled && c.category !== 'bg' && c.t0 >= moonUp - 1e-9 && c.t0 < moonFull).map((c) => c.id);

test('storyOrder 1: no enabled cue before the car\'s first light (carTimes.start) other than the backgrounds and the hum', () => {
  assert.ok(near(firstLight, T.start, 1e-9), 'the beams first show with the car');
  assert.deepEqual(beforeLight(CUES), []);
  assert.ok(CUES.some((c) => c.category === 'bg' && c.t0 === 0), 'the night is there from the first frame');
  const e = byId.get('hard.engine.car.intake');
  assert.deepEqual(beforeLight([...CUES, { ...e, id: 'hard.engine.car.early', t0: 13.5, sync: 13.5 }]), ['hard.engine.car.early'], 'control: an engine onset at 13.5');
});

test('storyOrder 3: no onset from the moonlight\'s rise (68.0) to 76, and the ticks end before it', () => {
  assert.ok(near(moonUp, 68, 1e-6) && near(moonFull, 76, 1e-6), `moonlight ${moonUp} to ${moonFull}`);
  assert.deepEqual(duringMoonrise(CUES), []);
  const ticks = CUES.filter((c) => c.family === 'tick');
  assert.ok(ticks.length >= 5 && ticks.every((c) => c.t1 < moonUp), 'every tick ends before the moonlight rises');
  const lastTick = ticks[ticks.length - 1];
  assert.ok(lastTick.sync + lastTick.meta.gap + DESIGN.TICK.dur >= moonUp, 'the rule stops at the moonlight, not earlier');
  assert.ok(ticks[0].sync > T.lightsOff1, 'the ticks follow the engine stop');
  const tick = ticks[0];
  assert.deepEqual(duringMoonrise([...CUES, { ...tick, id: 'hard.tick.car.late', t0: 70, sync: 70, t1: 70.06 }]), ['hard.tick.car.late'], 'control: a tick at 70');
});

// Question 2 fell to option (b): Sound 1.1 measured the idle shake on screen. No car sound after the run-down.
const ENGINE_FAMILIES = ['engine', 'tyres', 'arrival', 'stop', 'brake'];
function stopProblems(list) {
  const p = [], run = list.filter((c) => c.family === 'stop');
  if (run.length !== 1 || !near(run[0].sync, T.lightsOff0, 1e-9) || !near(run[0].t1, T.lightsOff1, 1e-9)) p.push('the run-down is not lightsOff0 to lightsOff1');
  for (const c of list) if (c.enabled && ENGINE_FAMILIES.includes(c.family) && c.t1 > T.lightsOff1 + 1e-9) p.push(`${c.id} sounds after the stop`);
  for (const c of list) if (/key/.test(c.id) || /\bkey\b/.test(c.label)) p.push(`${c.id}: a key click`);
  const idle = list.filter((c) => c.id.endsWith('-idle'));
  if (!idle.length || idle.some((c) => !near(c.t1, T.lightsOff0, 1e-9))) p.push('the idle does not run to the run-down');
  return p;
}

test('question 2, option (b): the engine runs down at lightsOff0 over the lights\' fade, no key click, nothing after', () => {
  assert.deepEqual(stopProblems(CUES), []);
  const idle = byId.get('hard.engine.car.intake-idle');
  assert.ok(stopProblems(plant(CUES, idle.id, { t1: 36.5 })).length > 0, 'control: the idle past the stop');
  assert.ok(stopProblems([...CUES, { ...byId.get('hard.cabin.car.handbrake'), id: 'hard.cabin.car.key', label: '[the key turns]' }]).length > 0, 'control: a key click');
  // option (d) would have stopped the engine before the driver's door; it did not
  assert.ok(CUES.some((c) => c.family === 'engine' && c.enabled && c.t1 > T.doors.driver.open0));
});

// ---------- the Gate 0 lists: new in, offered out ----------
test('the new cues of SOUND-PLAN 3.8 are in; the offered ones are listed and disabled', () => {
  const offered = CUES.filter((c) => c.offered).map((c) => c.id).sort();
  assert.deepEqual(offered, ['foley.breath.A.exhale1', 'foley.breath.A.exhale3', 'hard.engine.car.door-open']);
  assert.ok(CUES.every((c) => c.enabled === !c.offered));
  const fresh = (pred) => CUES.some((c) => c.new && c.enabled && pred(c));
  for (const [what, pred] of Object.entries({
    'the swing shut': (c) => c.id.endsWith('swing-shut'), 'the door stop': (c) => c.id.endsWith('.stop') && c.family === 'door',
    'getting out': (c) => c.family === 'unload', 'scuffs': (c) => c.family === 'scuff', 'cloth on the walk': (c) => c.meta.kind === 'walk',
    'the shoulders': (c) => c.meta.kind === 'shift', 'the brake': (c) => c.family === 'brake', 'the handbrake': (c) => c.id.endsWith('handbrake'), 'a belt': (c) => c.id.endsWith('belt'),
  })) assert.ok(fresh(pred), what);
  assert.ok(CUES.filter((c) => c.family === 'cabin' && c.id.endsWith('belt')).every((c) => c.t1 <= T.doors[doorOf(c.person)].open0 + 1e-9 && c.t0 >= T.stop), 'each belt inside its seated span, before its door opens');
});

// ---------- laws, levels, places ----------
test('laws as today\'s layers use them; the level plan\'s firm rules for the car and the bridge', () => {
  assert.deepEqual({ ...LAWS.car }, { ...CAR_LAW });
  assert.deepEqual({ ...LAWS.foley }, { ...FOLEY_LAW });
  assert.deepEqual({ ...LAWS.physical }, { refDist: SPATIAL.refDist, rolloff: 1 });
  assert.deepEqual({ ...LAWS.door }, { refDist: 2, rolloff: 0.8 });
  const sum = (o) => 10 * Math.log10(Object.values(o).reduce((s, x) => s + 10 ** (x / 10), 0));
  assert.ok(near(sum(LEVELS.street), 0, 0.05), 'the street background is the reference');
  assert.ok(near(sum(LEVELS.bridge) - sum(LEVELS.street), 2.5, 0.05), 'the bridge one designed step over it');
  // the car while it moves on screen (its nose seen, to the stop): at least 6 dB over the street background, frame by frame
  const swell = byId.get('hard.arrival.car.swell');
  const carDb = (list, t) => {
    const parts = list.filter((c) => c.enabled && c.voices > 0 && ['engine', 'tyres'].includes(c.family) && t >= c.t0 && t < c.t1);
    const gain = (c) => c.level + 20 * Math.log10(placeAt(c.place(t), t, listenerAt(t), c.law).gain);
    return 10 * Math.log10(parts.reduce((s, c) => s + 10 ** (gain(c) / 10), 0));
  };
  const worst = (list) => { let m = Infinity; for (let f = Math.ceil(swell.sync * 24); f < T.stop * 24; f++) m = Math.min(m, carDb(list, f / 24) - sum(LEVELS.street)); return m; };
  assert.ok(worst(CUES) >= 6, `the car over the street background: ${worst(CUES).toFixed(1)} dB`);
  const quiet = CUES.map((c) => (c.family === 'engine' || c.family === 'tyres' ? { ...c, level: c.level - 6 } : c));
  assert.ok(!(worst(quiet) >= 6), 'control: the car 6 dB down fails');
  for (const part of ['intake', 'exhaust']) assert.ok(byId.get(`hard.engine.car.${part}`).level - byId.get(`hard.engine.car.${part}-idle`).level >= 6, `${part}: the idle 6 dB under the drive`);
});

test('LOCATIONS from SHOTS: the street for shots 1 to 7, the bridge for 8 to 15; cuesAt, cuesIn and locationAt', () => {
  assert.deepEqual(LOCATIONS.map((l) => [l.name, l.shots[0], l.shots[l.shots.length - 1], l.t0, l.t1]), [['street', 1, 7, 0, shot8.start], ['bridge', 8, 15, shot8.start, T_TOTAL]]);
  assert.equal(locationAt(shot8.start - 1e-6).name, 'street');
  assert.equal(locationAt(shot8.start).name, 'bridge');
  assert.equal(locationAt(T_TOTAL).name, 'bridge');
  assert.ok(CUES.filter((c) => c.family === 'water').every((c) => c.t0 >= shot8.start), 'water on the bridge only');
  const at = cuesAt(31);
  assert.ok(at.some((c) => c.id === 'hard.door.driver.swing-open') && at.every((c) => c.enabled && c.t0 <= 31 && 31 < c.t1));
  assert.ok(!cuesAt(82, { all: false }).some((c) => c.offered) && cuesAt(82, { all: true }).some((c) => c.id === 'foley.breath.A.exhale1'));
  assert.deepEqual(cuesIn(84, 89).filter((c) => c.category !== 'bg').map((c) => c.id), [], 'B looks in silence (shot 12)');
  assert.deepEqual(cuesIn(0, T_TOTAL, { all: true }).length, CUES.length);
});
