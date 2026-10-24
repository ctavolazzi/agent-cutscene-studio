// Checks for the sound effects catalogue (src/audio/cues.js): the counts the spotting session found, every derived time
// and place equal to the picture function it comes from, the rule-made families re-derived here, a second import
// identical, the voice groups, the three orders and the Gate 0 answers.
// Each check is a function returning its problems; the real list must give none, and a planted fault must give some.
// Run: node --test tests/cues.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CUES, LAWS, LEVELS, DESIGN, LOCATIONS, WORLD, makeLocations, cuesAt, cuesIn, locationAt } from '../src/audio/cues.js';
import { CONFIG } from '../src/config.js';
import { mulberry32, hashString } from '../src/prng.js';
import { carAt, carTimes, headlights, moonlight, emberLevel, lighterOn, lighterFlicker, CAR, PEOPLE, PEOPLE_KEYS, LIGHTER, EMBER, EXHALE, T_TOTAL, FPS } from '../src/world.js';
import { BUILDINGS, BRIDGE, LAMP } from '../src/set.js';
import { SHOTS, cameraAt, shotAt } from '../src/shots.js';
import { SETTLE, SHAPE, DOOR_SIDE, buildCar, doorOpen, settlePitch, steerDeg } from '../src/actors/car.js';
import { EXIT, EMERGE, bodyToWorld, dims, groundY, makePoser, wrapDeg } from '../src/actors/people.js';
import { PRINT, footprintList } from '../src/fx/footprints.js';
import { SPATIAL, placeAt, listenerAt } from '../src/audio/spatial.js';
import { CAR_LAW } from '../src/audio/layers/car.js';
import { FOLEY_LAW, surfaceOf } from '../src/audio/layers/foley.js';
import { makeCamera } from '../scripts/lib/math.js';

const SR = CONFIG.audio.sr;
const T = carTimes;
const IDS = Object.keys(PEOPLE);
const near = (a, b, eps) => Math.abs(a - b) <= eps;
const near3 = (a, b, eps) => a !== null && b !== null && a.every((v, j) => near(v, b[j], eps));
const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const mean = (ps) => ps.reduce((s, p) => s.map((v, j) => v + p[j] / ps.length), [0, 0, 0]);
const plant = (list, id, patch) => list.map((c) => (c.id === id ? { ...c, ...patch } : c));
const byId = new Map(CUES.map((c) => [c.id, c]));
const posers = Object.fromEntries(IDS.map((id) => [id, makePoser(id)]));
const standY = Object.fromEntries(IDS.map((id) => [id, dims(id).ankleY]));
const doorOf = (id) => Object.keys(DOOR_SIDE).find((tag) => DOOR_SIDE[tag] === EXIT.outSide[id]);
const hands = (id, t) => { const p = posers[id](t); return p.arms.map((a) => bodyToWorld(p, a.hand)); };
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

// ---------- flams and voice groups ----------
// One person's contacts (steps, the hands' contacts) at least STEP.flam apart; in each voice group (`source`) the
// enabled voiced cues never overlap and no two onsets fall within STEP.flam, so one voice per group cuts nothing.
const isContact = (c) => c.family === 'feet' || (c.family === 'moves' && ['rest', 'cup'].includes(c.meta.kind));
function flamProblems(list) {
  const p = [];
  for (const id of IDS) {
    const own = list.filter((c) => c.enabled && c.person === id && isContact(c)).sort((a, b) => a.sync - b.sync);
    for (let i = 1; i < own.length; i++) if (own[i].sync - own[i - 1].sync < DESIGN.STEP.flam) p.push(`${own[i - 1].id} and ${own[i].id}`);
  }
  return p;
}
function voiceProblems(list) {
  const p = [], groups = {};
  for (const c of list) if (c.enabled && c.voices > 0) (groups[c.source] ??= []).push(c);
  for (const [g, cs] of Object.entries(groups)) {
    cs.sort((a, b) => a.t0 - b.t0);
    let end = -Infinity, endId = null;
    cs.forEach((c, i) => {
      if (c.t0 < end - 1e-9) p.push(`${g}: ${c.id} starts at ${c.t0} inside ${endId}`);
      if (i && c.t0 - cs[i - 1].t0 < DESIGN.STEP.flam) p.push(`${g}: ${cs[i - 1].id} and ${c.id} onsets within STEP.flam`);
      if (c.t1 > end) { end = c.t1; endId = c.id; }
    });
  }
  return p;
}

test('flams and voice groups: contacts 30 ms apart per person; one voice per group cuts nothing', () => {
  assert.equal(DESIGN.STEP.flam, 0.03);
  assert.deepEqual(flamProblems(CUES), []);
  assert.deepEqual(voiceProblems(CUES), []);
  const a = byId.get('foley.feet.A.05');
  const flam = [...CUES, { ...a, id: 'foley.feet.A.99', sync: a.sync + 0.01, t0: a.t0 + 0.01 }];
  assert.ok(flamProblems(flam).length > 0 && voiceProblems(flam).length > 0, 'control: two prints 10 ms apart');
  // controls: the unlatch ringing on into the swing, as it did with a designed tail; the slide back in the step's voice
  const u = byId.get('hard.door.driver.unlatch');
  assert.ok(voiceProblems(plant(CUES, u.id, { t1: u.t1 + 0.06 })).length > 0, 'control: an unlatch tail over the swing');
  assert.ok(voiceProblems(plant(CUES, 'foley.scuff.B.1', { source: 'B:feet' })).length > 0, 'control: B\'s slide cutting the step it grows from');
  // the slide that grows out of a step names it (SOUND-PLAN 3.12, decided: one footfall, two voices)
  const grows = CUES.filter((c) => c.family === 'scuff' && c.meta.step);
  assert.deepEqual(grows.map((c) => [c.id, c.meta.step]), [['foley.scuff.B.1', 'foley.feet.B.03']]);
  assert.ok(grows.every((c) => c.sync - byId.get(c.meta.step).sync < DESIGN.STEP.flam && c.source !== byId.get(c.meta.step).source));
});

// ---------- the rule-made families, re-derived here ----------
// the tick chain from its design and seed: from the run-down's end plus a delay, while a tick still ends before the moon
const moonUp = (() => { let k = 0; while (!(moonlight(k / 240) > 0)) k++; return (k - 1) / 240; })();
const moonFull = (() => { let k = Math.round(moonUp * 240); while (moonlight(k / 240) < 1) k++; return k / 240; })();
function tickChain(D = DESIGN.TICK, seed = 'cues:tick') {
  const rng = mulberry32((CONFIG.seed ^ hashString(seed)) >>> 0), out = [];
  for (let t = T.lightsOff1 + D.delay, i = 0; t + D.dur < moonUp; i++) { const gap = D.gap + i * D.grow + D.jitter * rng(); out.push({ id: `hard.tick.car.${String(i + 1).padStart(2, '0')}`, sync: t, t1: t + D.dur, gap }); t += gap; }
  return out;
}
const withTicks = (list, chain) => [...list.filter((c) => c.family !== 'tick'), ...chain.map((k) => ({ ...byId.get('hard.tick.car.01'), id: k.id, sync: k.sync, t0: k.sync, t1: k.t1, meta: { n: 0, gap: k.gap } }))];

// a scuff: a planted ankle (footprintList()'s rule, outside walks and getting out) whose speed over one sample each side
// passes SCUFF.speed; runs found on a 1/240 s scan and their edges by a plain scan of samples, short slides dropped,
// overlapping runs of one person joined, placed at the ankles sliding at the onset
function expectedScuffs(id) {
  const ankle = (foot, t) => { const p = posers[id](t); return bodyToWorld(p, p.legs[foot].ankle); };
  const sliding = (foot, t) => {
    const p = posers[id](t);
    if (!p.visible || p.walk.env !== 0 || p.pose === 'emerge' || p.pose === 'exit') return false;
    const a = bodyToWorld(p, p.legs[foot].ankle);
    if (a[1] - groundY(a[0], a[2]) - standY[id] > PRINT.rest) return false;
    const b = ankle(foot, t - 1 / SR), c = ankle(foot, t + 1 / SR);
    return Math.hypot(c[0] - b[0], c[2] - b[2]) * SR / 2 > DESIGN.SCUFF.speed;
  };
  const step = 1 / 240, runs = [];
  for (let foot = 0; foot < 2; foot++) {
    let on = false, t0 = 0;
    for (let i = 0; i <= Math.round(T_TOTAL / step); i++) {
      const t = i * step, s = sliding(foot, t);
      if (s === on) continue;
      let k = Math.ceil((t - step) * SR - 1e-6); // the first sample after the last scan point where the state changes
      while (sliding(foot, k / SR) !== s) k++;
      if (s) t0 = k / SR; else { let d = 0; for (let u = t0; u < k / SR; u += 1 / 480) d += Math.hypot(...[0, 2].map((j) => ankle(foot, Math.min(u + 1 / 480, k / SR))[j] - ankle(foot, u)[j])); if (d >= DESIGN.SCUFF.min) runs.push({ foot, t0, t1: k / SR }); }
      on = s;
    }
  }
  runs.sort((a, b) => a.t0 - b.t0);
  const out = [];
  for (const r of runs) { const l = out[out.length - 1]; if (l && r.t0 <= l.t1) { l.t1 = Math.max(l.t1, r.t1); if (r.t0 === l.sync) l.first.push(r.foot); } else out.push({ sync: r.t0, t1: r.t1, first: [r.foot] }); }
  return out.map((s, i) => ({ ...s, id: `foley.scuff.${id}.${i + 1}`, place: mean(s.first.map((f) => ankle(f, s.sync))) }));
}

// a contact (DESIGN.CONTACT): the first sample where the parts are within half an internal pixel of how they sit at
// the key, by a plain scan from a 1/480 s bracket; half a pixel from the camera's own projection (scaleAt)
const halfPx = (p, t) => { const cam = makeCamera(cameraAt(shotAt(t), t), CONFIG.res.w, CONFIG.res.h); return DESIGN.CONTACT.px / cam.scaleAt(cam.toCam(p)[2]); };
function firstSample(yes, lo, hi) {
  for (let u = lo; u <= hi; u += 1 / 480) if (yes(u)) { let k = Math.ceil((u - 1 / 480) * SR - 1e-6); while (!yes(k / SR)) k++; return k / SR; }
  return null;
}
// the moves from PEOPLE_KEYS: walk segments joined, the lean with its rest, the turns (the one into the lee with its cup),
// the shifts; the head turns and getting out are not moves
function expectedMoves(id) {
  const keys = PEOPLE_KEYS[id], out = [], n = { walk: 0, turn: 0, shift: 0 };
  for (let i = 0; i + 1 < keys.length; i++) {
    const a = keys[i], b = keys[i + 1];
    if (posers[id]((a.t + b.t) / 2).walk.env > 0) { const l = out[out.length - 1]; if (l && l.kind === 'walk' && l.t1 === a.t) l.t1 = b.t; else out.push({ kind: 'walk', sync: a.t, t1: b.t, n: ++n.walk }); continue; }
    if (a.pose === 'emerge' || a.pose === 'exit') continue;
    if (b.pose === 'lean' && a.pose !== 'lean') {
      out.push({ kind: 'lean', sync: a.t, t1: b.t });
      const rest = hands(id, b.t), sync = firstSample((t) => hands(id, t).some((q, h) => dist3(q, rest[h]) <= halfPx(rest[h], t)), a.t, b.t);
      out.push({ kind: 'rest', sync, t1: sync + DESIGN.CONTACT.tail, place: mean(rest), eps: 1e-6, rest });
    } else if (Math.abs(wrapDeg(b.face - a.face)) >= DESIGN.TURN.minDeg) {
      out.push({ kind: 'turn', sync: a.t, t1: b.t, n: ++n.turn });
      if (b.pose === 'cup' && a.pose !== 'cup') {
        const gap = (t) => { const [h0, h1] = hands(id, t); return dist3(h0, h1); }, cupAt = (t) => { const p = posers[id](t); return bodyToWorld(p, p.cup); };
        const width = gap(b.t), sync = firstSample((t) => Math.abs(gap(t) - width) <= halfPx(cupAt(t), t), a.t, b.t);
        out.push({ kind: 'cup', sync, t1: sync + DESIGN.CONTACT.tail, place: cupAt(sync), eps: 1e-6 });
      }
    } else if (Math.hypot(b.x - a.x, b.z - a.z) >= DESIGN.SHIFT.min) out.push({ kind: 'shift', sync: a.t, t1: b.t, n: ++n.shift });
  }
  for (const m of out) m.id = `foley.moves.${id}.${['rest', 'cup', 'lean'].includes(m.kind) ? m.kind : m.kind + m.n}`;
  return out;
}
const SCUFFS = Object.fromEntries(IDS.map((id) => [id, expectedScuffs(id)]));
const MOVES = Object.fromEntries(IDS.map((id) => [id, expectedMoves(id)]));

// The rest shows on the first frame at or after its contact: every hand drawn on its rest pixel (the snap, as
// src/ps1/material.js does it), and not yet on the frame before.
const snapOf = (cam, p) => { const s = cam.project(p); return [Math.floor((s[0] / cam.W * 2 - 1) * cam.W / 2 + 0.5), Math.floor((1 - s[1] / cam.H * 2) * cam.H / 2 + 0.5)]; };
const atRest = (id, rest, f) => { const t = f / FPS, cam = makeCamera(cameraAt(shotAt(t), t), CONFIG.res.w, CONFIG.res.h); return hands(id, t).every((q, h) => snapOf(cam, q).join() === snapOf(cam, rest[h]).join()); };
const showsAt = (c, rest) => { const f = Math.ceil(c.sync * FPS - 1e-9); return atRest(c.person, rest, f) && !atRest(c.person, rest, f - 1); };

function ruleListProblems(list) {
  const p = [], have = new Map(list.map((c) => [c.id, c]));
  const want = [...tickChain().map((k) => ({ ...k, family: 'tick' })), ...IDS.flatMap((id) => [...SCUFFS[id].map((s) => ({ ...s, family: 'scuff' })), ...MOVES[id].map((m) => ({ ...m, family: 'moves' }))])];
  for (const x of want) {
    const c = have.get(x.id);
    if (!c) { p.push(`${x.id}: missing`); continue; }
    if (x.kind && c.meta.kind !== x.kind) p.push(`${x.id}: kind ${c.meta.kind}, want ${x.kind}`);
  }
  for (const c of list) if (['tick', 'scuff', 'moves'].includes(c.family) && !want.some((x) => x.id === c.id)) p.push(`${c.id}: no rule makes it`);
  const count = (f, id, kind) => list.filter((c) => c.family === f && c.person === id && (!kind || c.meta.kind === kind)).length;
  // the spotting session's numbers: 5 scuffs for A and 3 for B (the turns in place, the lee, the shoulders), 18 moves
  const pinned = { A: { scuff: 5, walk: 3, turn: 4, lean: 1, rest: 1, cup: 1, shift: 1 }, B: { scuff: 3, walk: 3, turn: 2, lean: 1, rest: 1, cup: 0, shift: 1 } };
  for (const [id, n] of Object.entries(pinned)) for (const [k, v] of Object.entries(n)) { const got = k === 'scuff' ? count('scuff', id) : count('moves', id, k); if (got !== v) p.push(`${id} ${k}: ${got}, want ${v}`); }
  return p;
}

test('the rule-made families (ticks, scuffs, moves) are the lists their rules make, re-derived here', () => {
  assert.deepEqual(ruleListProblems(CUES), []);
  // controls: B's scuffs dropped, the lee turns dropped, a walk not joined (two cues for one stretch), a shift named a
  // turn (a wrong tick rule is the time check's: its ids stay, its times move)
  assert.ok(ruleListProblems(CUES.filter((c) => !(c.family === 'scuff' && c.person === 'B'))).length > 0, 'control: B\'s scuffs dropped');
  assert.ok(ruleListProblems(CUES.filter((c) => !/turns (into|out of) the lee/.test(c.label))).length > 0, 'control: the lee turns dropped');
  const w3 = byId.get('foley.moves.A.walk3'), mid = (w3.t0 + w3.t1) / 2;
  assert.ok(ruleListProblems([...plant(CUES, w3.id, { t1: mid }), { ...w3, id: 'foley.moves.A.walk4', sync: mid, t0: mid }]).length > 0, 'control: a walk not joined');
  const s1 = byId.get('foley.moves.A.shift1');
  assert.ok(ruleListProblems([...CUES.filter((c) => c !== s1), { ...s1, id: 'foley.moves.A.turn5', meta: { ...s1.meta, kind: 'turn' } }]).length > 0, 'control: a shift named a turn');
});

// ---------- derived times ----------
// the contact the step checks use: one person's ankle by footprintList()'s own rule
const down = (id, foot, t) => {
  const p = posers[id](t);
  if (!p.visible) return false;
  const a = bodyToWorld(p, p.legs[foot].ankle);
  return a[1] - groundY(a[0], a[2]) - standY[id] <= PRINT.rest;
};
// the first sample at or after the print step before it where the ankle is down, by a plain scan
const contactOf = (f) => { for (let k = Math.ceil((f.t - PRINT.dt) * SR); k <= Math.round(f.t * SR); k++) if (down(f.id, f.foot, k / SR)) return k / SR; return null; };
// an independent ground-plane test: the camera to point segment crossing a building's footprint, by orientations; the
// car's front is hidden while both front corners and the nose's centre are
const orient = (a, b, c) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
const segsCross = (p, q, r, s) => orient(p, q, r) * orient(p, q, s) < 0 && orient(r, s, p) * orient(r, s, q) < 0;
const hidden = (t) => {
  const c = carAt(t), h = c.heading * Math.PI / 180, cam = cameraAt(shotAt(t), t).pos, e = [cam[0], cam[2]];
  return [-1, 0, 1].every((s) => {
    const p = [c.x + Math.sin(h) * CAR.length / 2 + Math.cos(h) * s * CAR.width / 2, c.z - Math.cos(h) * CAR.length / 2 + Math.sin(h) * s * CAR.width / 2];
    return BUILDINGS.some((b) => { const r = [[b.x0, b.z0], [b.x1, b.z0], [b.x1, b.z1], [b.x0, b.z1]]; return r.some((v, i) => segsCross(e, p, v, r[(i + 1) % 4])); });
  });
};
// settlePitch's deepest point: the middle of the symmetric dip, checked against its neighbours
const deepest = T.stop + SETTLE.dur / 2;

function expectations() {
  const e = new Map(), D = T.doors;
  for (const tag of Object.keys(D)) {
    const d = D[tag];
    Object.entries({ unlatch: [d.open0, d.open0], 'swing-open': [d.open0, d.open1], stop: [d.open1], 'swing-shut': [d.close0, d.close1], latch: [d.close1] }).forEach(([part, [sync, t1]]) => e.set(`hard.door.${tag}.${part}`, { sync, t1 }));
  }
  for (const part of ['intake', 'exhaust']) { e.set(`hard.engine.car.${part}`, { sync: T.start, t1: T.stop }); e.set(`hard.engine.car.${part}-idle`, { sync: T.stop, t1: T.lightsOff0 }); }
  e.set('hard.engine.car.door-open', { sync: Math.min(...Object.values(D).map((d) => d.open0)), t1: Math.max(...Object.values(D).map((d) => d.close1)) });
  e.set('hard.stop.car.rundown', { sync: T.lightsOff0, t1: T.lightsOff1 });
  for (const part of ['front', 'rear']) e.set(`hard.tyres.car.${part}`, { sync: T.start, t1: T.stop });
  e.set('hard.brake.car.pads1', { sync: T.brake, t1: T.turn0 });
  e.set('hard.brake.car.pads2', { sync: T.turn1, t1: T.stop });
  e.set('hard.brake.car.creak', { t1: T.stop, ok: (c) => carAt(c.sync).speed < DESIGN.CREAK.speed && carAt(c.sync - 1e-9).speed >= DESIGN.CREAK.speed });
  const lowest = (t) => settlePitch(t) <= settlePitch(t - 1e-4) && settlePitch(t) <= settlePitch(t + 1e-4);
  e.set('hard.settle.car.dip', { sync: T.stop, t1: deepest, ok: (c) => lowest(c.t1) });
  e.set('hard.settle.car.rebound', { sync: deepest, t1: T.stop + SETTLE.dur, ok: (c) => lowest(c.sync) });
  e.set('hard.cabin.car.handbrake', { sync: T.stop + SETTLE.dur });
  e.set('hard.arrival.car.rise', { sync: T.start });
  e.set('hard.arrival.car.swell', { t1: T.stop, ok: (c) => hidden(c.sync - 1e-6) && !hidden(c.sync + 1e-6) });
  for (const id of IDS) {
    e.set(`hard.cabin.${id}.belt`, { sync: D[doorOf(id)].open0 });
    const keys = PEOPLE_KEYS[id], i = keys.findIndex((k) => k.pose === 'emerge');
    e.set(`hard.unload.${id}.slide`, { sync: keys[i].t, t1: keys[i + 1].t });
    e.set(`hard.unload.${id}.rise`, { sync: keys[i + 1].t, t1: keys[i + 2].t });
    for (const s of SCUFFS[id]) e.set(s.id, { sync: s.sync, t1: s.t1, eps: 1e-6 });
    for (const m of MOVES[id]) e.set(m.id, { sync: m.sync, t1: m.t1, eps: m.eps, ok: m.kind === 'rest' ? (c) => showsAt(c, m.rest) : undefined });
  }
  for (const k of tickChain()) e.set(k.id, { sync: k.sync, t1: k.t1, ok: (c) => near(c.meta.gap, k.gap, 1e-12) });
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
const EXPECT = expectations();

// the steps, made by a rule over sampled data, checked by their own property
function stepProblems(c) {
  const p = [], prints = footprintList().filter((f) => f.id === c.person && c.meta.prints.includes(f.t));
  if (!prints.length) return [`${c.id}: no print at ${c.print}`];
  const contact = Math.min(...prints.map(contactOf));
  if (!near(c.sync, contact, 1e-6)) p.push(`${c.id}: contact ${c.sync}, the rig says ${contact}`);
  if (!near(c.print, prints[0].t, 1e-9)) p.push(`${c.id}: print ${c.print}`);
  return p;
}

function timeProblems(list) {
  const p = [];
  for (const c of list) {
    if (!near(c.t0, c.sync - c.lead + c.nudge, 1e-12)) p.push(`${c.id}: t0 is not sync - lead + nudge`);
    if (!(c.t1 > c.t0)) p.push(`${c.id}: ends at or before it starts`);
    if (c.family === 'feet') { p.push(...stepProblems(c)); continue; }
    const x = EXPECT.get(c.id), eps = x?.eps ?? 1e-9;
    if (!x) { p.push(`${c.id}: no expectation`); continue; }
    if (x.sync !== undefined && !near(c.sync, x.sync, eps)) p.push(`${c.id}: sync ${c.sync}, want ${x.sync}`);
    if (x.t1 !== undefined && !near(c.t1, x.t1, eps)) p.push(`${c.id}: t1 ${c.t1}, want ${x.t1}`);
    if (x.ok && !x.ok(c)) p.push(`${c.id}: fails its property`);
  }
  return p;
}

test('every derived time equals the picture function it comes from (1e-9 s; 1e-6 s for contacts from the rig)', () => {
  assert.deepEqual(timeProblems(CUES), []);
  // controls: a door 1 ms late, a step one sample late, a tick off its chain, the tick rule's growth, seed and delay
  // changed, the old typed rebound (+0.38) and a typed tail on the dip, a cue nothing derives, a scuff one PRINT.dt late,
  // the plan's 77.925 for the cup
  assert.ok(timeProblems(plant(CUES, 'hard.door.driver.latch', { sync: T.doors.driver.close1 + 1e-3, t0: T.doors.driver.close1 + 1e-3 })).length > 0, 'control: door');
  const s = byId.get('foley.feet.A.10');
  assert.ok(timeProblems(plant(CUES, s.id, { sync: s.sync + 1 / SR, t0: s.t0 + 1 / SR })).length > 0, 'control: step');
  const k = byId.get('hard.tick.car.03');
  assert.ok(timeProblems(plant(CUES, k.id, { sync: k.sync + 0.01, t0: k.t0 + 0.01, t1: k.t1 + 0.01 })).length > 0, 'control: tick');
  assert.ok(timeProblems(withTicks(CUES, tickChain({ ...DESIGN.TICK, grow: 0.5 }))).length > 0, 'control: the tick gap growing faster');
  assert.ok(timeProblems(withTicks(CUES, tickChain(DESIGN.TICK, 'cues:ticks'))).length > 0, 'control: the tick seed renamed');
  assert.ok(timeProblems(withTicks(CUES, tickChain({ ...DESIGN.TICK, delay: 2.1 }))).length > 0, 'control: the tick delay from the stop');
  assert.ok(timeProblems(plant(CUES, 'hard.settle.car.rebound', { sync: T.stop + 0.38, t0: T.stop + 0.38 })).length > 0, 'control: the typed rebound');
  assert.ok(timeProblems(plant(CUES, 'hard.settle.car.dip', { t1: T.stop + 0.5 })).length > 0, 'control: a typed tail on the dip');
  assert.ok(timeProblems([...CUES, { ...byId.get('hard.settle.car.dip'), id: 'hard.settle.car.typed' }]).length > 0, 'control: a cue nothing derives');
  const sc = byId.get('foley.scuff.A.1');
  assert.ok(timeProblems(plant(CUES, sc.id, { sync: sc.sync + PRINT.dt, t0: sc.t0 + PRINT.dt })).length > 0, 'control: a scuff a print step late');
  assert.ok(timeProblems(plant(CUES, 'foley.moves.A.cup', { sync: 77.925, t0: 77.925 })).length > 0, 'control: the cup at 77.925');
});

test('the forearms\' rest: half an internal pixel, which the first frame showing the hands at rest follows; not 2 cm or 1 mm', () => {
  for (const id of IDS) {
    const c = byId.get(`foley.moves.${id}.rest`), m = MOVES[id].find((x) => x.kind === 'rest');
    assert.ok(showsAt(c, m.rest), `${id}: the frame after the contact shows the hands at rest, the one before does not`);
    const lead = Math.ceil(c.sync * FPS - 1e-9) / FPS - c.sync;
    assert.ok(lead >= 0 && lead <= 1 / FPS, `${id}: leads its frame by ${lead}`);
    // controls: the 2 cm reading lands two frames early, the 1 mm reading a frame late
    const at = (r) => firstSample((t) => hands(id, t).some((q, h) => dist3(q, m.rest[h]) <= r), c.sync - 0.2, c.sync + 0.1);
    assert.ok(!showsAt({ ...c, sync: at(0.02) }, m.rest), `control: ${id} at the 2 cm reading`);
    assert.ok(!showsAt({ ...c, sync: at(0.001) }, m.rest), `control: ${id} at the 1 mm reading`);
  }
});

// ---------- places ----------
// The car's own three.js rig, its shake and settle held at rest: the doors' latch edge and hinge from the slab, the
// engine bay, the exhaust and the axles from the meshes. The people's points from the poser.
const rig = (() => {
  const scene = new THREE.Scene(), car = buildCar({ THREE, scene, config: CONFIG, rngFor: (n) => mulberry32((CONFIG.seed ^ hashString(n)) >>> 0) });
  const get = (n) => scene.getObjectByName(n), body = get('car-body');
  const at = (t) => { car.update(t); body.position.y = 0; body.rotation.x = 0; scene.updateMatrixWorld(true); };
  const pt = (obj, local) => new THREE.Vector3(...local).applyMatrix4(obj.matrixWorld).toArray();
  const shell = get('car-shell'), cab = get('car-cabin'), S = shell.geometry.parameters, Cb = cab.geometry.parameters, L = SHAPE.door.front - SHAPE.door.back;
  const local = { intake: [0, shell.position.y, (cab.position.z - Cb.depth / 2 + shell.position.z - S.depth / 2) / 2], exhaust: [0, shell.position.y - S.height / 2, shell.position.z + S.depth / 2], centre: [0, shell.position.y, 0] };
  return {
    car: (what, t) => { at(t); return pt(body, local[what]); },
    door: (tag, part, t) => { at(t); return pt(get(`car-door-${tag}-slab`), [0, 0, (part === 'latch' ? 1 : -1) * L / 2]); },
    axle: (front, up, t) => { at(t); const [a, b] = (front ? ['fl', 'fr'] : ['rl', 'rr']).map((w) => pt(get(`car-wheel-${w}`), [0, up - SHAPE.wheel.radius, 0])); return mean([a, b]); },
  };
})();
const seat = (id) => { const k = PEOPLE_KEYS[id].find((x) => x.pose === 'emerge'); return [k.x, EMERGE.hipY, k.z]; };
const posePt = (id, part) => (t) => { const p = posers[id](t); return bodyToWorld(p, p[part]); };
// where each cue should be, at time t
function expectedPlace(c, t) {
  const [cat, fam, src, part] = c.id.split('.');
  if (fam === 'door') return rig.door(src, ['unlatch', 'latch'].includes(part) ? 'latch' : 'hinge', c.sync);
  if (fam === 'engine' || fam === 'stop') return rig.car(c.source === 'car:exhaust' ? 'exhaust' : 'intake', t);
  if (fam === 'tick') return rig.car('intake', T.lightsOff1);
  if (fam === 'arrival') return rig.car('centre', t);
  if (fam === 'settle') return rig.car('centre', T.stop);
  if (fam === 'tyres') return rig.axle(part === 'front', 0, t);
  if (fam === 'brake') return rig.axle(true, SHAPE.wheel.radius, part === 'creak' ? T.stop : t);
  if (fam === 'cabin') return part === 'handbrake' ? mean(IDS.map(seat)) : seat(c.person);
  if (fam === 'unload') return part === 'slide' ? posePt(c.person, 'hip')(t) : seat(c.person);
  if (fam === 'feet') { const f = footprintList().find((x) => x.id === c.person && x.t === c.print); return [f.x, f.y, f.z]; }
  if (fam === 'scuff') return SCUFFS[c.person].find((s) => s.id === c.id).place;
  if (fam === 'moves') { const m = MOVES[c.person].find((x) => x.id === c.id); if (m.place) return m.place; const p = posers[c.person](t); return [p.x, p.y + DESIGN.CLOTH.up, p.z]; }
  if (fam === 'lighter') return posePt(c.person, 'cup')(t);
  if (fam === 'drag') return posePt(c.person, 'tip')(t);
  if (fam === 'breath') return posePt(c.person, 'mouth')(t);
  if (fam === 'hum') return LAMP.head;
  return undefined;
}
function placeProblems(list) {
  const p = [];
  for (const c of list) {
    if (!c.place) { if (c.category !== 'bg' || c.family === 'hum') p.push(`${c.id}: unplaced`); continue; }
    for (const t of [c.t0, (c.t0 + c.t1) / 2, c.t1 - 1e-6]) {
      const want = expectedPlace(c, t), got = c.place(t);
      if (want === undefined) { p.push(`${c.id}: no expected place`); break; }
      if (!near3(got, want, 1e-6)) { p.push(`${c.id} at ${t}: ${got}, want ${want}`); break; }
    }
  }
  return p;
}

test('every place equals the picture point it comes from (the car\'s rig, the prints, the poser, the lamp), to 1 um', () => {
  assert.deepEqual(placeProblems(CUES), []);
  // controls: the latch at the hinge, the driver's unlatch on the passenger side, a step 1 m off its print, the intake
  // at the rear, the hum at the lamp's base
  assert.ok(placeProblems(plant(CUES, 'hard.door.driver.latch', { place: byId.get('hard.door.driver.swing-shut').place })).length > 0, 'control: latch at the hinge');
  assert.ok(placeProblems(plant(CUES, 'hard.door.driver.unlatch', { place: byId.get('hard.door.passenger.unlatch').place })).length > 0, 'control: wrong side');
  const s = byId.get('foley.feet.B.07'), q = s.place(0);
  assert.ok(placeProblems(plant(CUES, s.id, { place: () => [q[0] + 1, q[1], q[2]] })).length > 0, 'control: a step off its print');
  assert.ok(placeProblems(plant(CUES, 'hard.engine.car.intake', { place: byId.get('hard.engine.car.exhaust').place })).length > 0, 'control: intake at the rear');
  assert.ok(placeProblems(plant(CUES, 'bg.hum.lamp.bed', { place: () => [LAMP.base[0], 0, LAMP.base[1]] })).length > 0, 'control: hum at the base');
});

// ---------- tracks: what a timbre follows reads the picture's own motion ----------
const TRACK_OF = {
  speed: (c, t) => carAt(t).speed,
  steer: (c, t) => (c.id === 'hard.tyres.car.front' ? steerDeg(t) : 0),
  open: (c, t) => Math.max(...Object.values(T.doors).map((d) => doorOpen(d, t))),
  flicker: (c, t) => (lighterOn(t) ? lighterFlicker(t) : 0),
  ember: (c, t) => emberLevel(t),
  swing: (c, t) => posers[c.person](t).walk.env,
  along: (c, t) => posers[c.person](t).walk.along,
  moon: (c, t) => moonlight(t),
};
function trackProblems(list) {
  const p = [];
  for (const c of list) {
    if (!c.track) continue;
    for (const t of [c.t0, (c.t0 + c.t1) / 2, c.t1 - 1e-6]) {
      const got = c.track(t), bad = Object.keys(TRACK_OF).filter((k) => k in got && !near(got[k], TRACK_OF[k](c, t), 1e-9));
      if (bad.length) { p.push(`${c.id} at ${t}: ${bad.join(', ')}`); break; }
    }
  }
  return p;
}

test('tracks follow the picture: speed and steering, the doors, the flame, the ember, the walk, the moonlight', () => {
  assert.deepEqual(trackProblems(CUES), []);
  assert.ok(CUES.filter((c) => c.track).length >= 15, 'the tracked cues are there');
  const f = byId.get('hard.tyres.car.front');
  assert.ok(trackProblems(plant(CUES, f.id, { track: (t) => ({ ...f.track(t), steer: 0 }) })).length > 0, 'control: the front tyres not steered');
});

// ---------- a second import ----------
const snapshot = (list) => list.map((c) => {
  const o = {};
  for (const [k, v] of Object.entries(c)) o[k] = typeof v === 'function' ? [c.t0, (c.t0 + c.t1) / 2, c.t1].map((t) => v(t)) : v;
  return o;
});
// every object and array inside a cue frozen (its place and track functions aside)
const thawed = (o, path) => (Object.isFrozen(o) ? Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? thawed(v, `${path}.${k}`) : [])) : [path]);
const freezeProblems = (list) => [...(Object.isFrozen(list) ? [] : ['the list']), ...list.flatMap((c) => thawed(c, c.id))];

test('a second import builds an identical list, frozen all the way down', async () => {
  const again = await import('../src/audio/cues.js?second');
  assert.notEqual(again.CUES, CUES, 'a fresh module instance');
  assert.deepStrictEqual(snapshot(again.CUES), snapshot(CUES));
  assert.deepStrictEqual(again.LOCATIONS, LOCATIONS);
  // control: one level changed is seen
  assert.throws(() => assert.deepStrictEqual(snapshot(plant(again.CUES, 'hard.door.driver.latch', { level: 14 })), snapshot(CUES)));
  assert.deepEqual(freezeProblems(CUES), []);
  const f = byId.get('foley.feet.B.08');
  assert.ok(freezeProblems(Object.freeze(plant(CUES, f.id, { meta: Object.freeze({ ...f.meta, prints: [...f.meta.prints] }) }).map(Object.freeze))).length > 0, 'control: a meta array left open');
});

// ---------- ids, order, provenance, the allocator's inputs ----------
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
    if (!Number.isFinite(c.priority) || typeof c.reverb !== 'boolean' || !Number.isInteger(c.voices) || c.voices < 0) p.push(`${c.id} allocator inputs ${c.priority} ${c.reverb} ${c.voices}`);
    if (c.law !== null && !Object.hasOwn(LAWS, c.law)) p.push(`${c.id} law ${JSON.stringify(c.law)} is not a key of LAWS`);
    if ((c.place === null) !== (c.law === null) || (c.place === null) !== (c.perspective === 'location')) p.push(`${c.id} place, law and perspective disagree`);
    if (!/^\[[^A-Z]*([AB][^A-Z]*)*\]$/.test(c.label) || (c.sdh !== null && !/^\[[a-z][^A-Z]*\]$/.test(c.sdh))) p.push(`${c.id} label ${c.label} / sdh ${c.sdh}`);
    if (c.nudge !== 0) p.push(`${c.id} nudged ${c.nudge} without a gate`);
  });
  return p;
}

test('ids are unique and category.family.source.part, sorted by t0; every cue has derivedFrom or rule, lists its designed fields and has allocator inputs', () => {
  assert.deepEqual(shapeProblems(CUES), []);
  assert.ok(CUES.length > 100);
  const swapped = [...CUES];
  [swapped[10], swapped[60]] = [swapped[60], swapped[10]];
  assert.ok(shapeProblems(swapped).length > 0, 'control: out of order');
  assert.ok(shapeProblems([...CUES, CUES[5]]).length > 0, 'control: an id twice');
  assert.ok(shapeProblems(plant(CUES, 'hard.tick.car.02', { derivedFrom: null, rule: null })).length > 0, 'control: no provenance');
  assert.ok(shapeProblems(plant(CUES, 'hard.tick.car.02', { designed: Object.freeze(['level', 'loudness']) })).length > 0, 'control: a designed field it does not have');
  assert.ok(shapeProblems(plant(CUES, 'hard.door.driver.latch', { label: '[Car Door Shuts]' })).length > 0, 'control: a capitalised caption');
  assert.ok(shapeProblems(plant(CUES, 'bg.wind.street.bed', { priority: undefined })).length > 0, 'control: a background with no priority');
  assert.ok(shapeProblems(plant(CUES, 'hard.door.driver.latch', { law: LAWS.door })).length > 0, 'control: the law object, not its key');
});

// ---------- the three orders, the Gate 0 answers ----------
// storyOrder 1: nothing but the backgrounds and the hum before the car's first light
const firstLight = (() => { let f = 0; while (!(headlights(f / CONFIG.fps) > 0 && carAt(f / CONFIG.fps).present)) f++; return f / CONFIG.fps; })();
const beforeLight = (list) => list.filter((c) => c.enabled && c.t0 < firstLight - 1e-9 && c.category !== 'bg').map((c) => c.id);
// storyOrder 3: no hard effect or foley starts while the moonlight rises (above 0, until full)
const duringMoonrise = (list) => list.filter((c) => c.enabled && c.category !== 'bg' && c.t0 >= moonUp - 1e-9 && c.t0 < moonFull).map((c) => c.id);

test('storyOrder 1: no enabled cue before the car\'s first light (carTimes.start) other than the backgrounds and the hum', () => {
  assert.ok(near(firstLight, T.start, 1e-9), 'the beams first show with the car');
  assert.deepEqual(beforeLight(CUES), []);
  assert.ok(CUES.some((c) => c.category === 'bg' && c.t0 === 0), 'the night is there from the first frame');
  const e = byId.get('hard.engine.car.intake');
  assert.deepEqual(beforeLight([...CUES, { ...e, id: 'hard.engine.car.early', t0: 13.5, sync: 13.5 }]), ['hard.engine.car.early'], 'control: an engine onset at 13.5');
});

test('storyOrder 3: no onset from the moonlight\'s rise (68.0) to 76, and the tick rule ends before it', () => {
  assert.ok(near(moonUp, 68, 1e-6) && near(moonFull, 76, 1e-6), `moonlight ${moonUp} to ${moonFull}`);
  assert.deepEqual(duringMoonrise(CUES), []);
  const ticks = CUES.filter((c) => c.family === 'tick'), chain = tickChain(), stop = chain[chain.length - 1];
  assert.ok(ticks.length >= 5 && ticks.every((c) => c.t1 < moonUp), 'every tick ends before the moonlight rises');
  assert.ok(stop.sync + stop.gap + DESIGN.TICK.dur >= moonUp, 'the rule stops at the moonlight, not earlier');
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
function newProblems(list) {
  const p = [], offered = list.filter((c) => c.offered).map((c) => c.id).sort();
  if (JSON.stringify(offered) !== JSON.stringify(['foley.breath.A.exhale1', 'foley.breath.A.exhale3', 'hard.engine.car.door-open'])) p.push(`offered ${offered}`);
  if (!list.every((c) => c.enabled === !c.offered)) p.push('an offered cue enabled, or another disabled');
  const fresh = (pred) => list.some((c) => c.new && c.enabled && pred(c));
  for (const [what, pred] of Object.entries({
    'the swing shut': (c) => c.id.endsWith('swing-shut'), 'the door stop': (c) => c.id.endsWith('.stop') && c.family === 'door',
    'getting out': (c) => c.family === 'unload', 'scuffs': (c) => c.family === 'scuff', 'cloth on the walk': (c) => c.meta.kind === 'walk',
    'the shoulders': (c) => c.meta.kind === 'shift', 'the brake': (c) => c.family === 'brake', 'the handbrake': (c) => c.id.endsWith('handbrake'), 'a belt': (c) => c.id.endsWith('belt'),
    'the cup contact': (c) => c.meta.kind === 'cup',
  })) if (!fresh(pred)) p.push(`${what} is not in as new`);
  if (!list.filter((c) => c.family === 'cabin' && c.id.endsWith('belt')).every((c) => c.t1 <= T.doors[doorOf(c.person)].open0 + 1e-9 && c.t0 >= T.stop)) p.push('a belt outside its seated span');
  return p;
}

test('the new cues of SOUND-PLAN 3.8 are in; the offered ones are listed and disabled', () => {
  assert.deepEqual(newProblems(CUES), []);
  // controls: the cup contact not marked new, an offered exhale enabled
  assert.ok(newProblems(plant(CUES, 'foley.moves.A.cup', { new: false })).length > 0, 'control: a new cue not marked');
  assert.ok(newProblems(plant(CUES, 'foley.breath.A.exhale1', { enabled: true })).length > 0, 'control: an offered cue enabled');
});

// ---------- laws, levels ----------
const LAW_WANT = { engine: 'car', arrival: 'car', tyres: 'car', brake: 'car', settle: 'car', stop: 'car', tick: 'car', door: 'door', cabin: 'foley', unload: 'foley', feet: 'foley', scuff: 'foley', moves: 'foley', lighter: 'foley', drag: 'foley', breath: 'foley', hum: 'physical' };
const lawProblems = (list) => list.filter((c) => c.place && c.law !== LAW_WANT[c.family]).map((c) => `${c.id}: law ${c.law}, want ${LAW_WANT[c.family]}`);

test('laws as today\'s layers use them, one per family by key; the level plan\'s firm rules for the car and the bridge', () => {
  assert.deepEqual({ ...LAWS.car }, { ...CAR_LAW });
  assert.deepEqual({ ...LAWS.foley }, { ...FOLEY_LAW });
  assert.deepEqual({ ...LAWS.physical }, { refDist: SPATIAL.refDist, rolloff: 1 });
  assert.deepEqual({ ...LAWS.door }, { refDist: 2, rolloff: 0.8 });
  assert.deepEqual(lawProblems(CUES), []);
  assert.ok(lawProblems(CUES.map((c) => (c.family === 'door' ? { ...c, law: 'car' } : c))).length > 0, 'control: the doors on the car law');
  const sum = (o) => 10 * Math.log10(Object.values(o).reduce((s, x) => s + 10 ** (x / 10), 0));
  assert.ok(near(sum(LEVELS.street), 0, 0.05), 'the street background is the reference');
  assert.ok(near(sum(LEVELS.bridge) - sum(LEVELS.street), 2.5, 0.05), 'the bridge one designed step over it');
  // the car while it moves on screen (its front seen, to the stop): at least 6 dB over the street background, frame by frame
  const swell = byId.get('hard.arrival.car.swell');
  const carDb = (list, t) => {
    const parts = list.filter((c) => c.enabled && c.voices > 0 && ['engine', 'tyres'].includes(c.family) && t >= c.t0 && t < c.t1);
    const gain = (c) => c.level + 20 * Math.log10(placeAt(c.place(t), t, listenerAt(t), LAWS[c.law]).gain);
    return 10 * Math.log10(parts.reduce((s, c) => s + 10 ** (gain(c) / 10), 0));
  };
  const worst = (list) => { let m = Infinity; for (let f = Math.ceil(swell.sync * FPS); f < T.stop * FPS; f++) m = Math.min(m, carDb(list, f / FPS) - sum(LEVELS.street)); return m; };
  assert.ok(worst(CUES) >= 6, `the car over the street background: ${worst(CUES).toFixed(1)} dB`);
  const quiet = CUES.map((c) => (c.family === 'engine' || c.family === 'tyres' ? { ...c, level: c.level - 6 } : c));
  assert.ok(!(worst(quiet) >= 6), 'control: the car 6 dB down fails');
  for (const part of ['intake', 'exhaust']) assert.ok(byId.get(`hard.engine.car.${part}`).level - byId.get(`hard.engine.car.${part}-idle`).level >= 6, `${part}: the idle 6 dB under the drive`);
});

// ---------- places in time ----------
const locationProblems = (locs) => {
  const want = [['street', 1, 7, 0, shot8.start], ['bridge', 8, 15, shot8.start, T_TOTAL]];
  return JSON.stringify(locs.map((l) => [l.name, l.shots[0], l.shots[l.shots.length - 1], l.t0, l.t1])) === JSON.stringify(want) ? [] : ['the places are not street 1 to 7, bridge 8 to 15'];
};

test('LOCATIONS from SHOTS: the street for shots 1 to 7, the bridge for 8 to 15; cuesAt, cuesIn and locationAt', () => {
  assert.deepEqual(locationProblems(LOCATIONS), []);
  // control: shot 8's subject 1 m short of the deck puts shot 8 in the street
  const moved = SHOTS.map((s) => (s.n === 8 ? { ...s, subject: () => { const p = typeof s.subject === 'function' ? s.subject() : s.subject; return [p[0], p[1], BRIDGE.z0 + 1]; } } : s));
  assert.ok(locationProblems(makeLocations({ ...WORLD, SHOTS: moved })).length > 0, 'control: shot 8 off the deck');
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
