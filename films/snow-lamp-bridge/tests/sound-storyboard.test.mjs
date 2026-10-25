// Checks for the sound storyboard (scripts/sound-storyboard.js, scripts/lib/sound-map.js, sound-timeline.js,
// sound-panel.js): every drawing is the cue catalogue drawn, checked on the drawing's own items. Each check is a function
// returning its problems; the real drawing must give none, and a planted fault must give some.
// Run: node --test tests/sound-storyboard.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CUES, WORLD, LAWS, LEVELS, makeCues } from '../src/audio/cues.js';
import { listenerAt, placeAt } from '../src/audio/spatial.js';
import { SHOTS, cameraAt, shotAt } from '../src/shots.js';
import { FPS } from '../src/world.js';
import { CONFIG } from '../src/config.js';
import { makeCamera } from '../scripts/lib/math.js';
import { buildSoundMap, buildSoundDetail, soundDetails, makePredictor, makeSight, textBox, textOverlaps, MAP_SCALE } from '../scripts/lib/sound-map.js';
import { buildTimeline, bedOnlyWindows, BED_ONLY, TL, DB } from '../scripts/lib/sound-timeline.js';
import { buildSoundPanel, decodeFrames, panelFrame, fieldX, levelR, SF, FW, FH } from '../scripts/lib/sound-panel.js';
import { sheetHtml } from '../scripts/sound-storyboard.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VIDEO = resolve(ROOT, 'out/snowy-bridge.mp4');
const near = (a, b, eps) => Math.abs(a - b) <= eps;
const placedVoiced = (cues) => cues.filter((c) => c.enabled && c.voices > 0 && c.place);
const main = buildSoundMap(), details = soundDetails().map((g) => buildSoundDetail(g)), tl = buildTimeline();
const byId = new Map(CUES.map((c) => [c.id, c]));
const sight = makeSight();
// the world without the south-east building, the one the car comes round in shot 3
const noSE = { ...WORLD, BUILDINGS: WORLD.BUILDINGS.filter((b) => b.id !== 'SE') };
// a predictor with a fault planted in its levels or pans (the drawings take it in place of the real one)
const real = makePredictor();
const planted = (f) => ({ ...real, at: (c, t) => { const q = real.at(c, t); return q && f(q, t); } });

// ---------- the timeline: every cue once ----------
// Every cue in the list has exactly one onset tick on the drawing, at its onset's x, and no tick names a cue that is
// not in the list.
function timelineProblems(t, cues) {
  const p = [], ticks = new Map();
  for (const it of t.d.items) if (it.role === 'onset') { if (!ticks.has(it.cue)) ticks.set(it.cue, []); ticks.get(it.cue).push(it); }
  for (const c of cues) {
    const ts = ticks.get(c.id) ?? [];
    if (ts.length !== 1) { p.push(`${c.id}: ${ts.length} onset ticks`); continue; }
    if (!near(ts[0].pts[0][0], TL.left + c.t0 * TL.pxPerS, 1e-9)) p.push(`${c.id}: tick at x ${ts[0].pts[0][0]}, onset at ${TL.left + c.t0 * TL.pxPerS}`);
  }
  for (const id of ticks.keys()) if (!cues.some((c) => c.id === id)) p.push(`${id}: a tick for no cue`);
  return p;
}

test('timeline: every cue appears exactly once, at its onset', () => {
  assert.ok(CUES.filter((c) => c.enabled).length > 100);
  assert.deepEqual(timelineProblems(tl, CUES), []);
  // controls: a cue dropped from the drawing, a cue drawn twice, a tick drawn a frame late
  const gone = CUES.find((c) => c.id === 'hard.door.driver.latch');
  assert.ok(timelineProblems(buildTimeline({ cues: CUES.filter((c) => c !== gone) }), CUES).length > 0, 'control: a dropped cue');
  assert.ok(timelineProblems(buildTimeline({ cues: [...CUES, { ...gone }] }), CUES).length > 0, 'control: a duplicated cue');
  const late = buildTimeline();
  late.d.items.find((it) => it.role === 'onset' && it.cue === gone.id).pts[0][0] += TL.pxPerS / FPS;
  assert.ok(timelineProblems(late, CUES).length > 0, 'control: a tick one frame late');
});

// ---------- the timeline: the in-frame bars ----------
// Each bar lies inside the joined spans of its lane's sounding cues (none bridges a gap where nothing sounds); at both
// of its ends a cue of the lane sounds in the bar's state (seen, or hidden by the blocker it names); and every moment a
// cue is seen or hidden, away from a change of state, lies under a bar of that kind.
function barProblems(t, cues, S = sight) {
  const p = [], bars = t.d.items.filter((it) => it.onScreen || it.hidden);
  const at = (c, x) => (c.t0 <= x && x < c.t1 && c.place(x) ? S.state(c, c.place(x), x) : null);
  for (const b of bars) {
    const src = b.onScreen ?? b.hidden, kind = b.onScreen ? 'on' : 'hidden';
    const own = cues.filter((c) => c.source === src && c.enabled && c.voices > 0 && c.place).sort((a, z) => a.t0 - z.t0), spans = [];
    for (const c of own) { const last = spans[spans.length - 1]; if (last && c.t0 <= last[1] + 1e-9) last[1] = Math.max(last[1], c.t1); else spans.push([c.t0, c.t1]); }
    if (!spans.some(([a, z]) => b.t0 >= a && b.t1 < z)) p.push(`${src}: a bar from ${b.t0} to ${b.t1} outside its cues' spans`);
    for (const x of [b.t0, b.t1]) if (!own.some((c) => { const s = at(c, x); return s && s.state === kind && (kind === 'on' || s.by === b.by); })) p.push(`${src}: not ${kind}${b.by ? ` (${b.by})` : ''} at ${x}`);
  }
  const step = 1 / 48;
  for (const c of cues.filter((x) => x.enabled && x.voices > 0 && x.place)) {
    for (let x = c.t0; x < c.t1; x += 1 / 12) {
      const s = at(c, x);
      if (!s || (s.state !== 'on' && s.state !== 'hidden')) continue;
      const near2 = [x - step, x + step].map((y) => at(c, y));
      if (near2.some((n) => !n || n.state !== s.state || n.by !== s.by)) continue; // a change of state: either side is right
      const kind = s.state === 'on' ? 'onScreen' : 'hidden';
      if (!bars.some((b) => b[kind] === c.source && (kind === 'onScreen' || b.by === s.by) && b.t0 - 1e-9 <= x && x <= b.t1 + step + 1e-9)) p.push(`${c.id}: ${s.state}${s.by ? ` (${s.by})` : ''} at ${x.toFixed(3)} with no bar`);
    }
  }
  return p;
}

test('timeline: the bars lie inside their cues\' spans, seen or hidden as the picture is, and none is missing', () => {
  assert.ok(tl.d.items.filter((it) => it.onScreen).length > 20 && tl.d.items.filter((it) => it.hidden).length > 5);
  assert.deepEqual(barProblems(tl, CUES).slice(0, 8), []);
  // controls: A's forearms' bar stretched over the gap to the cup (the bridged runs this test was written for); a bar
  // on the hum at a shot's middle where the lantern is out of frame; a hidden bar taken away
  const t2 = buildTimeline(), bar = t2.d.items.find((it) => it.onScreen === 'A:arms');
  bar.t1 = (bar.t1 + byId.get('foley.moves.A.cup').t0) / 2;
  assert.ok(barProblems(t2, CUES).length > 0, 'control: a bar over a gap');
  const hum = CUES.find((c) => c.family === 'hum'), off = SHOTS.map((s) => (s.start + s.end) / 2).find((t) => sight.state(hum, hum.place(t), t).state === 'off');
  const t3 = buildTimeline();
  t3.d.items.push({ k: 'rect', onScreen: hum.source, t0: off, t1: off + 0.1 });
  assert.ok(barProblems(t3, CUES).length > 0, 'control: a bar where the source is out of frame');
  const t4 = buildTimeline();
  t4.d.items.splice(t4.d.items.findIndex((it) => it.hidden === 'car:seat:passenger'), 1);
  assert.ok(barProblems(t4, CUES).some((x) => x.includes('with no bar')), 'control: a hidden span with no bar');
});

// ---------- the predicted level: one rule, read back from every drawing ----------
// The rule, from spatial.js directly: the designed level + 20 log10(gain) at the cue's place under its law, plus the
// modifiers (the real predictor's modDb, checked on its own just below).
function expected(c, t) {
  const mod = real.modDb(c, t);
  if (!c.place) return { db: c.level + mod, pan: null };
  const p = c.place(t);
  if (!p) return null;
  const s = placeAt(p, t, listenerAt(t), LAWS[c.law]);
  return { db: c.level + mod + 20 * Math.log10(s.gain), pan: s.pan };
}
// The modifiers: the rise holds the intake at LEVELS.rise below its own level at first light and lets go by its end;
// the swell has added LEVELS.swell by the stop; the wind ease has taken LEVELS of its own off the bridge wind by its
// end and holds it.
function modifierProblems(pred) {
  const p = [], plain = (c, t) => c.level + 20 * Math.log10(placeAt(c.place(t), t, listenerAt(t), LAWS[c.law]).gain);
  const rise = byId.get('hard.arrival.car.rise'), swell = byId.get('hard.arrival.car.swell'), ease = byId.get('bg.ambience.wind.ease');
  const intake = byId.get('hard.engine.car.intake'), wind = byId.get('bg.wind.bridge.bed');
  const want = [[intake, rise.t0, LEVELS.rise], [intake, rise.t1, 0], [intake, intake.t1 - 1e-6, LEVELS.swell], [wind, ease.t0, 0], [wind, ease.t1 + 1, ease.level]];
  for (const [c, t, db] of want) {
    const q = pred.at(c, t), got = q.db - (c.place ? plain(c, t) : c.level);
    if (!near(got, db, 1e-3)) p.push(`${c.id} at ${t}: ${got.toFixed(3)} dB from its modifiers, want ${db}`);
  }
  return p;
}

test('predicted level: the modifiers apply (the rise out of the quiet, the swell, the wind ease)', () => {
  assert.deepEqual(modifierProblems(real), []);
  // control: the catalogue without the rise, as the old rule read it: the engine at full level from the cut
  assert.ok(modifierProblems(makePredictor({ cues: CUES.filter((c) => c.id !== 'hard.arrival.car.rise') })).length > 0, 'control: no rise');
});

// Every envelope point and pan point on the timeline, at the time it is drawn for, against the rule.
function levelProblems(t) {
  const p = [];
  for (const it of t.d.items.filter((x) => (x.role === 'envelope' && x.ts) || x.role === 'pan')) {
    const c = byId.get(it.cue), ln = t.lanes.find((l) => l.source === c.source);
    it.ts.forEach((x, i) => {
      const e = expected(c, x), [px, py] = it.pts[i], want = it.role === 'pan' ? t.panY(ln, e.pan) : t.dbY(ln, e.db);
      if (!near(px, t.X(x), 1e-9) || !near(py, want, 1e-6)) p.push(`${c.id} ${it.role} at ${x.toFixed(3)}: drawn at ${px.toFixed(2)}, ${py.toFixed(2)}; the rule ${t.X(x).toFixed(2)}, ${want.toFixed(2)}`);
    });
  }
  return p;
}
// Every glyph in a panel's stereo field: x the pan, radius the level, y its time, and its style the picture's state
// (a cross behind the camera, filled only when seen, a bar exactly when hidden).
function fieldProblems(panel, shot, S = sight) {
  const p = [], items = panel.d.items, TY = (t) => SF.y + ((t - shot.start) / (shot.end - shot.start)) * SF.h;
  for (const it of items.filter((x) => x.role === 'field')) {
    const c = byId.get(it.cue), e = expected(c, it.at), s = S.state(c, c.place(it.at), it.at);
    if (!near(it.cx, fieldX(e.pan), 1e-6) || !near(it.cy, TY(it.at), 1e-6) || !near(it.r, levelR(e.db), 1e-6)) p.push(`${c.id} at ${it.at.toFixed(3)}: glyph ${it.cx.toFixed(2)}, ${it.cy.toFixed(2)}, r ${it.r.toFixed(2)}; the rule ${fieldX(e.pan).toFixed(2)}, ${TY(it.at).toFixed(2)}, r ${levelR(e.db).toFixed(2)}`);
    const barred = items.some((b) => b.role === 'field-bar' && b.cue === it.cue && b.at === it.at), filled = it.k === 'circle' && it.fill !== 'none';
    if ((it.k === 'line') !== (s.state === 'behind') || filled !== (s.state === 'on') || barred !== (s.state === 'hidden')) p.push(`${c.id} at ${it.at.toFixed(3)}: drawn ${it.k === 'line' ? 'a cross' : filled ? 'filled' : barred ? 'barred' : 'hollow'}, the picture says ${s.state}${s.by ? ` (${s.by})` : ''}`);
  }
  return p;
}

test('timeline and panels: the drawn level and pan read back as the rule', () => {
  assert.ok(tl.d.items.filter((x) => x.role === 'pan').length > 50);
  assert.deepEqual(levelProblems(tl).slice(0, 5), []);
  const panels = SHOTS.map((s) => [s, buildSoundPanel(s)]);
  for (const [s, panel] of panels) assert.deepEqual(fieldProblems(panel, s).slice(0, 5), [], `shot ${s.n}`);
  assert.ok(panels.reduce((n, [, q]) => n + q.d.items.filter((x) => x.role === 'field').length, 0) > 300);
  // controls: every pan mirrored; every level 6 dB up
  const mirror = planted((q) => ({ ...q, pan: q.pan === null ? null : -q.pan })), loud = planted((q) => ({ ...q, db: q.db + 6 }));
  assert.ok(levelProblems(buildTimeline({ pred: mirror })).length > 0, 'control: the timeline\'s pans mirrored');
  assert.ok(levelProblems(buildTimeline({ pred: loud })).length > 0, 'control: the timeline 6 dB up');
  assert.ok(fieldProblems(buildSoundPanel(SHOTS[4], { pred: mirror }), SHOTS[4]).length > 0, 'control: a stereo field mirrored');
  assert.ok(fieldProblems(buildSoundPanel(SHOTS[4], { pred: loud }), SHOTS[4]).length > 0, 'control: a stereo field 6 dB up');
});

// One scale for every lane: the bridge's wind bed sits as far over the street's as their designed levels say, and the
// background line steps up by the places' difference at the place change.
function scaleProblems(t) {
  const p = [], ln = t.lanes.find((l) => l.source === 'bg:wind'), dbOf = (y) => DB.lo + ((ln.envBot - y) / TL.env) * (DB.hi - DB.lo);
  const env = (id) => t.d.items.find((it) => it.role === 'envelope' && it.cue === id).pts[0][1];
  const st = byId.get('bg.wind.street.bed'), br = byId.get('bg.wind.bridge.bed'), got = dbOf(env(br.id)) - dbOf(env(st.id));
  if (!near(got, br.level - st.level, 1e-6)) p.push(`the bridge wind sits ${got.toFixed(2)} dB over the street's, designed ${br.level - st.level}`);
  const line = t.d.items.find((it) => it.role === 'background' && it.pts[0][1] < ln.envBot && it.pts[0][1] > ln.envTop), [a, b] = real.locations;
  const yAt = (x) => line.pts.find((q) => near(q[0], t.X(x), 1e-9))?.[1];
  const step = dbOf(yAt(b.t0)) - dbOf(yAt(a.t1 - 1e-6)), want = real.bg[b.name] - real.bg[a.name];
  if (!near(step, want, 1e-6)) p.push(`the background steps ${step.toFixed(2)} dB at ${b.t0}, the places differ by ${want.toFixed(2)}`);
  return p;
}

test('timeline: one scale for every lane, the bridge background a designed step over the street\'s', () => {
  assert.deepEqual(scaleProblems(tl), []);
  // control: the old rule, each level read against its own place's background (the beds drop at the place change)
  const old = planted((q, t) => ({ ...q, db: q.db - real.bg[real.locAt(t).name] }));
  assert.ok(scaleProblems(buildTimeline({ pred: old })).length > 0, 'control: each place on its own scale');
});

// ---------- hidden sources (SOUND-PLAN 3.7) ----------
// Each panel's frame marks: one per point in front of the camera, a circle in frame and a diamond at the edge out of it;
// a bar through it, and its blocker in the shot's list, exactly when the picture hides it at the frame.
function markProblems(panel, shot, S = sight) {
  const p = [], items = panel.d.items, cam = cameraAt(shot, panel.frame.t).pos;
  for (const q of panel.points) {
    const c = byId.get(q.id), marks = items.filter((it) => it.cue === q.id && (it.role === 'frame' || it.role === 'frame-edge'));
    if (q.x === null) { if (marks.length) p.push(`${q.id}: marked behind the camera`); continue; }
    const inside = q.x >= 0 && q.x <= FW && q.y >= 0 && q.y <= FH, by = inside ? S.hiddenBy(c, q.p, cam, panel.frame.t) : null;
    if (marks.length !== 1 || marks[0].role !== (inside ? 'frame' : 'frame-edge')) p.push(`${q.id}: ${marks.map((m) => m.role).join(', ') || 'no mark'}, ${inside ? 'in frame' : 'out of frame'}`);
    if (items.some((it) => it.role === 'frame-bar' && it.cue === q.id) !== !!by) p.push(`${q.id}: ${by ? `hidden (${by}) and not barred` : 'barred and not hidden'}`);
    const where = items.find((it) => it.role === 'list-where' && it.cue === q.id)?.str ?? '';
    if (where.startsWith('hidden (') !== !!by || (by && !where.startsWith(`hidden (${by})`))) p.push(`${q.id}: the list says "${where}"${by ? `, hidden by the ${by}` : ''}`);
  }
  return p;
}

test('hidden: the car behind building SE in shot 3 reads hidden on the timeline, the frame, the field and the list', () => {
  const intake = byId.get('hard.engine.car.intake'), s3 = SHOTS.find((s) => s.start <= 15 && 15 < s.end);
  assert.deepEqual(sight.state(intake, intake.place(15), 15), { state: 'hidden', by: 'building SE' });
  assert.ok(tl.d.items.some((it) => it.hidden === intake.source && it.by === 'building SE' && it.t0 <= 15 && 15 <= it.t1), 'an outlined bar over 15 s');
  assert.ok(tl.d.items.some((it) => it.k === 'text' && it.hiddenBy?.includes('building SE') && it.str.includes('the building SE, 14.00 to')), 'the blocker named');
  const p3 = buildSoundPanel(s3);
  assert.ok(p3.d.items.some((it) => it.role === 'field' && it.cue === intake.id && it.at < 17 && it.state === 'hidden'), 'barred in the field');
  for (const s of SHOTS) assert.deepEqual(markProblems(buildSoundPanel(s), s), [], `shot ${s.n}`);
  assert.ok(markProblems(p3, s3).length === 0 && p3.points.some((q) => q.by === 'building SE'), 'shot 3 marks something hidden');
  // controls: without the building the engine at 15 s is seen, so a timeline and a panel drawn that way disagree with
  // the picture; a second mark planted on an in-frame point (an edge diamond beside its circle)
  assert.equal(makeSight(noSE).state(intake, intake.place(15), 15).state, 'on', 'control: no building, no hiding');
  assert.ok(barProblems(buildTimeline({ sight: makeSight(noSE) }), CUES).length > 0, 'control: the timeline drawn without SE');
  const flat = buildSoundPanel(s3, { sight: makeSight(noSE) });
  assert.ok(fieldProblems(flat, s3).length > 0 && markProblems(flat, s3).length > 0, 'control: shot 3 drawn without SE');
  const twice = buildSoundPanel(s3), m = twice.d.items.find((it) => it.role === 'frame' && !it.hidden);
  twice.d.items.push({ k: 'poly', pts: [], role: 'frame-edge', cue: m.cue, cx: m.cx, cy: m.cy });
  assert.ok(markProblems(twice, s3).length > 0, 'control: an in-frame point marked twice');
});

// ---------- the map: each glyph at its place ----------
// Every enabled voiced placed cue has exactly one glyph, at its place at its onset, through the map's view.
function glyphProblems(m, cues) {
  const p = [];
  for (const c of placedVoiced(cues)) {
    const gs = m.d.items.filter((it) => it.role === 'glyph' && it.cue === c.id);
    if (gs.length !== 1) { p.push(`${c.id}: ${gs.length} glyphs`); continue; }
    const g = gs[0], q = c.place(c.t0);
    if (g.at !== c.t0) p.push(`${c.id}: drawn at ${g.at}, onset ${c.t0}`);
    if (!near(g.cx, m.v.X(q[0]), 1e-6) || !near(g.cy, m.v.Y(q[2]), 1e-6)) p.push(`${c.id}: glyph at ${g.cx}, ${g.cy}, place at ${m.v.X(q[0])}, ${m.v.Y(q[2])}`);
  }
  return p;
}

test('map: every placed cue\'s glyph sits at its place, and moves when the place moves', () => {
  assert.deepEqual(glyphProblems(main, CUES), []);
  // a picture with the lamp's head 0.5 m east and the doors' skin 0.1 m further out: the cues follow, the map follows
  const H = WORLD.LAMP.head, D = WORLD.SHAPE.door;
  const moved = { ...WORLD, LAMP: { ...WORLD.LAMP, head: [H[0] + 0.5, H[1], H[2]] }, SHAPE: { ...WORLD.SHAPE, door: { ...D, side: D.side + 0.1 } } };
  const cues2 = makeCues(moved), m2 = buildSoundMap({ cues: cues2, w: moved });
  assert.deepEqual(glyphProblems(m2, cues2), []);
  const at = (m, id) => m.d.items.find((it) => it.role === 'glyph' && it.cue === id);
  assert.ok(near(at(m2, 'bg.hum.lamp.bed').cx - at(main, 'bg.hum.lamp.bed').cx, 0.5 * MAP_SCALE, 1e-6), 'the hum moved 0.5 m east');
  assert.ok(Math.hypot(at(m2, 'hard.door.driver.latch').cx - at(main, 'hard.door.driver.latch').cx, at(m2, 'hard.door.driver.latch').cy - at(main, 'hard.door.driver.latch').cy) > 0.5, 'the latch moved');
  // control: the old map against the moved picture's cues
  assert.ok(glyphProblems(main, cues2).length >= 2, 'control: glyphs left where the places were');
});

// Every glyph on a detail map has a label naming its cue, and every step is labelled with its contact time on one of
// the detail maps.
function detailLabelProblems(maps, cues) {
  const p = [], named = new Map();
  for (const m of maps) {
    const texts = m.d.items.filter((it) => it.k === 'text' && it.cues);
    for (const it of texts) for (const id of it.cues) named.set(id, [...(named.get(id) ?? []), it.str]);
    for (const g of m.d.items.filter((it) => it.role === 'glyph')) if (!texts.some((it) => it.cues.includes(g.cue))) p.push(`${g.cue}: a glyph with no label`);
  }
  for (const c of cues.filter((x) => x.enabled && x.family === 'feet')) if (!(named.get(c.id) ?? []).includes(c.sync.toFixed(2))) p.push(`${c.id}: its contact time ${c.sync.toFixed(2)} is on no detail map`);
  return p;
}

test('detail maps: every glyph is labelled, every step with its contact time', () => {
  assert.deepEqual(detailLabelProblems(details, CUES), []);
  // controls: the bridge's map left out (its steps lose their times); a label taken off a glyph
  assert.ok(detailLabelProblems(details.filter((_, i) => i !== 2), CUES).length > 0, 'control: no bridge map');
  const m = buildSoundDetail(soundDetails()[3]);
  m.d.items.find((it) => it.k === 'text' && it.cues).cues = [];
  assert.ok(detailLabelProblems([m], []).length > 0, 'control: an unlabelled glyph');
});

// ---------- the panels: the points and the frames ----------
// Each placed cue sounding in the shot has a point: its place at a time inside its span and the shot, projected through
// the shot's camera at the panel's frame time; a mark is drawn on it when it is in frame.
function pointProblems(panel, shot, cues) {
  const p = [], tf = panel.frame.t, cam = makeCamera(cameraAt(shot, tf), FW, FH);
  const want = placedVoiced(cues).filter((c) => c.t0 < shot.end && c.t1 > shot.start);
  for (const c of want) {
    const q = panel.points.find((x) => x.id === c.id);
    if (!q) { if (c.place(Math.min(Math.max(tf, c.t0, shot.start), Math.min(c.t1, shot.end) - 1e-6))) p.push(`${c.id}: no point`); continue; }
    if (q.t < Math.max(c.t0, shot.start) || q.t >= Math.min(c.t1, shot.end)) p.push(`${c.id}: marked at ${q.t}, outside its span in the shot`);
    const pr = cam.project(c.place(q.t));
    if (pr === null ? q.x !== null : !near(pr[0], q.x, 1e-9) || !near(pr[1], q.y, 1e-9)) p.push(`${c.id}: point ${q.x}, ${q.y}, project() ${pr}`);
    if (pr && pr[0] >= 0 && pr[0] <= FW && pr[1] >= 0 && pr[1] <= FH) {
      const mk = panel.d.items.find((it) => it.role === 'frame' && it.cue === c.id);
      if (!mk || !near(mk.cx, pr[0], 1e-9) || !near(mk.cy, pr[1], 1e-9)) p.push(`${c.id}: no mark on its point`);
    }
  }
  if (panel.points.length !== new Set(panel.points.map((x) => x.id)).size) p.push('a cue marked twice');
  return p;
}
// The frame is the shot's own: the one nearest its middle, by frame number, inside the shot.
function frameProblems(panel, shot) {
  const p = [], n = panel.frame.n;
  if (n !== Math.round(((shot.start + shot.end) / 2) * FPS)) p.push(`frame ${n} is not the middle of shot ${shot.n}`);
  if (shotAt(n / FPS) !== shot || !near(panel.frame.t, n / FPS, 1e-12)) p.push(`frame ${n} (${panel.frame.t} s) belongs to shot ${shotAt(n / FPS).n}`);
  return p;
}

test('panels: every cue point equals project() through the shot\'s camera at the panel\'s frame', () => {
  for (const s of SHOTS) {
    const panel = buildSoundPanel(s);
    assert.deepEqual(pointProblems(panel, s, CUES), [], `shot ${s.n}`);
    assert.ok(panel.points.length > 0, `shot ${s.n} marks something`);
  }
  // controls: a point nudged by a pixel; a panel checked against the next shot's camera
  const s5 = SHOTS[4], p5 = buildSoundPanel(s5), q = p5.points.find((x) => x.x !== null);
  q.x += 1;
  assert.ok(pointProblems(p5, s5, CUES).length > 0, 'control: a point one pixel off');
  assert.ok(pointProblems(buildSoundPanel(SHOTS[5]), SHOTS[6], CUES).length > 0, 'control: shot 6\'s points read as shot 7\'s');
});

test('panels: each frame is the shot\'s own, by its frame number', (t) => {
  for (const s of SHOTS) assert.deepEqual(frameProblems(buildSoundPanel(s), s), [], `shot ${s.n}`);
  // control: shot 7's panel with shot 8's frame
  assert.ok(frameProblems(buildSoundPanel(SHOTS[6], { frame: { ...panelFrame(SHOTS[7]), png: null } }), SHOTS[6]).length > 0, 'control: the next shot\'s frame');
  if (!existsSync(VIDEO)) { t.diagnostic(`no export at ${VIDEO}: the decoded pixels are not compared`); return; }
  // the embedded image is that frame's pixels: all 15 frames decoded by number in one pass, as the script decodes them,
  // each equal to the frame decoded at n / FPS by time; control: the last shot's frame n + 1 differs
  const rgb = (args) => { const r = spawnSync('ffmpeg', ['-v', 'error', ...args, '-vf', `scale=${CONFIG.res.w}:${CONFIG.res.h}:flags=neighbor`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 26 }); assert.equal(r.status, 0, String(r.stderr)); return r.stdout; };
  const frames = SHOTS.map((s) => panelFrame(s)), pngs = decodeFrames(VIDEO, frames.map((f) => f.n));
  let embedded = null;
  for (const [i, s] of SHOTS.entries()) {
    const fr = frames[i], panel = buildSoundPanel(s, { frame: { ...fr, png: pngs.get(fr.n) } });
    const b64 = /href="data:image\/png;base64,([^"]+)"/.exec(panel.d.toSVG())[1];
    embedded = spawnSync('ffmpeg', ['-v', 'error', '-f', 'png_pipe', '-i', '-', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { input: Buffer.from(b64, 'base64'), maxBuffer: 1 << 26 }).stdout;
    const byTime = rgb(['-ss', String(fr.n / FPS), '-i', VIDEO, '-frames:v', '1']);
    assert.ok(embedded.length === CONFIG.res.w * CONFIG.res.h * 3 && embedded.equals(byTime), `shot ${s.n}: the panel shows frame ${fr.n}`);
  }
  const lastN = frames[frames.length - 1].n + 1;
  assert.ok(!embedded.equals(rgb(['-ss', String(lastN / FPS), '-i', VIDEO, '-frames:v', '1'])), `control: frame ${lastN} differs`);
});

// ---------- labels ----------
// No two labels' boxes overlap (Helvetica's metrics), none is under 9 px, none leaves its drawing.
function labelProblems(d) {
  const p = textOverlaps(d).map(([a, b]) => `"${a.str}" covers "${b.str}"`);
  for (const it of d.items.filter((x) => x.k === 'text')) {
    if ((it.size ?? 14) < 9) p.push(`"${it.str}" at ${it.size} px`);
    const b = textBox(it);
    if (b.x0 < 0 || b.y0 < 0 || b.x1 > d.w || b.y1 > d.h) p.push(`"${it.str}" leaves the drawing`);
  }
  return p;
}

test('labels: none overlaps another, none is too small, outside or dropped, on the maps, the timeline and the panels', () => {
  for (const [name, b] of [['map', main], ...details.map((x, i) => [`detail ${i}`, x]), ['timeline', tl]]) {
    assert.deepEqual(labelProblems(b.d), [], name);
    assert.equal(b.labeler.dropped.length, 0, `${name}: labels dropped ${b.labeler.dropped}`);
  }
  for (const s of SHOTS) {
    const p = buildSoundPanel(s);
    assert.deepEqual(labelProblems(p.d), [], `panel ${s.n}`);
    assert.equal(p.labeler.dropped.length, 0, `panel ${s.n}: labels dropped ${p.labeler.dropped}`);
  }
  // controls: a step's label moved onto another's; a label at 6 px
  const m = buildSoundDetail(soundDetails()[1]), ts = m.d.items.filter((it) => it.k === 'text' && /^[0-9]+\.[0-9]{2}$/.test(it.str));
  Object.assign(ts[1], { x: ts[0].x + 3, y: ts[0].y + 2, anchor: ts[0].anchor });
  assert.ok(labelProblems(m.d).length > 0, 'control: a label over another');
  const t2 = buildTimeline();
  t2.d.items.find((it) => it.k === 'text' && it.str === 'unlatch').size = 6;
  assert.ok(labelProblems(t2.d).length > 0, 'control: a 6 px label');
});

// ---------- the contact sheet ----------
// report.json rendered by its schema: one section per check in the order of n, each with its name, bar, summary and
// status chip, every "cue" cell a link, and every link to a row of the cue list that is on the page; without a report,
// a note on where it comes from.
const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function sheetProblems(html, report) {
  const p = [], rows = new Set([...html.matchAll(/<tr id="(cue-[^"]+)"/g)].map((m) => m[1]));
  for (const m of html.matchAll(/href="#(cue-[^"]+)"/g)) if (!rows.has(m[1])) p.push(`a link to ${m[1]}, which is no row of the cue list`);
  for (const m of html.matchAll(/class="warn">([^<]+)</g)) p.push(`a row names no cue: ${m[1]}`);
  if (!report) return html.includes('scripts/sound-report.js') ? p : [...p, 'no note on where report.json comes from'];
  const order = [...html.matchAll(/<section class="check" id="check-([^"]+)">/g)].map((m) => m[1]);
  const want = report.checks.slice().sort((a, b) => a.n - b.n).map((c) => c.id);
  if (order.join() !== want.join()) p.push(`checks in the order ${order}, not ${want}`);
  for (const c of report.checks) {
    const sec = html.split(`id="check-${c.id}">`)[1]?.split('</section>')[0] ?? '';
    for (const s of [c.name, c.bar, c.summary]) if (s !== null && !sec.includes(escHtml(s))) p.push(`${c.id}: "${s}" is not in its section`);
    if (!sec.includes(`class="chip ${c.status}"`)) p.push(`${c.id}: no ${c.status} chip`);
    // a cue cell names a cue by its id, as a string: linked when it does, flagged when it does not
    for (const r of c.rows) {
      if (!('cue' in r)) continue;
      const known = typeof r.cue === 'string' && byId.has(r.cue);
      if (known && !sec.includes(`href="#cue-${escHtml(r.cue)}"`)) p.push(`${c.id}: ${r.cue} is not linked`);
      if (!known && !sec.includes(`class="warn">${escHtml(r.cue)} (no such cue)`)) p.push(`${c.id}: ${r.cue} names no cue and is not flagged`);
    }
  }
  for (const k of Object.keys(report.tables)) if (!html.includes(`id="table-${k}"`)) p.push(`no table ${k}`);
  // odd values print plainly: no "null" bar, no negative zero, and long words wrap instead of widening the page
  if (/Bar:<\/b> (<span[^>]*>)?(null|undefined)\b/.test(html)) p.push('a bar printed as null');
  if (/>-0\.0+</.test(html)) p.push('a negative zero');
  if (!html.includes('p, li, h1, h2, h3 { overflow-wrap: anywhere; }')) p.push('long words do not wrap');
  return p;
}
const sampleReport = () => ({
  cues: CUES.length, enabled: CUES.filter((c) => c.enabled).length,
  checks: [
    { id: 'sync', n: 4, name: 'Sync', definition: 'Each sync cue against its first showing frame.', bar: '0 to 45 ms ahead', starting: true, status: 'fail', summary: 'one cue late', columns: ['cue', 't', 'ok'], rows: [{ cue: CUES[40].id, t: CUES[40].t0, ok: false }] },
    { id: 'trace', n: 1, name: 'Trace', definition: 'Every cue traced.', bar: 'Exact', starting: false, status: 'pass', summary: 'all traced', columns: ['cue', 'by', 'note'], rows: [{ cue: CUES[0].id, by: CUES[1].id, note: null }] },
    { id: 'zeta', n: 9, name: 'Odd values', definition: 'x'.repeat(400), bar: null, starting: false, status: 'report', summary: 'y'.repeat(300), columns: ['cue', 't'], rows: [{ cue: CUES[2].id, t: -0.0001 }] },
  ],
  tables: { onScreen: { columns: ['cue', 'shot'], rows: [{ cue: CUES[60].id, shot: 5 }] }, perShot: { columns: ['shot', 'onsets'], rows: [{ shot: 1, onsets: 0 }] } },
});

test('sheet: report.json renders by its schema, every row linked to a cue on the page', () => {
  const rep = sampleReport();
  assert.deepEqual(sheetProblems(sheetHtml(rep), rep), []);
  assert.deepEqual(sheetProblems(sheetHtml(null), null), []);
  // controls: a row naming a cue that does not exist; a cue's row taken off the page; the checks out of order
  const bad = sampleReport();
  bad.checks[0].rows.push({ cue: 'foley.feet.A.99', t: 1, ok: true });
  assert.ok(sheetProblems(sheetHtml(bad), bad).some((x) => x.includes('foley.feet.A.99')), 'control: no such cue');
  assert.ok(sheetProblems(sheetHtml(rep).replace(`<tr id="cue-${CUES[40].id}"`, '<tr'), rep).length > 0, 'control: a link to no row');
  const html = sheetHtml(rep), [a, b] = ['check-trace', 'check-sync'].map((id) => html.indexOf(`<section class="check" id="${id}">`));
  const swapped = html.slice(0, a) + html.slice(b, html.indexOf('</section>', b) + 10) + '\n' + html.slice(a, b - 1) + html.slice(html.indexOf('</section>', b) + 10);
  assert.ok(sheetProblems(swapped, rep).some((x) => x.startsWith('checks in the order')), 'control: checks out of order');
  // controls for odd values: a cue given as a number, flagged; the same left unflagged; a null bar, a negative zero and
  // the wrap rule planted back into the page
  const num = sampleReport();
  num.checks[1].rows.push({ cue: 42, by: null, note: null });
  assert.ok(sheetHtml(num).includes('class="warn">42 (no such cue)'), 'a numeric cue is flagged');
  assert.ok(sheetProblems(sheetHtml(num).replace('class="warn">42 (no such cue)', '>42'), num).some((x) => x.includes('42 names no cue')), 'control: a numeric cue unflagged');
  assert.ok(sheetProblems(html.replace('none given', 'null'), rep).includes('a bar printed as null'), 'control: a null bar');
  assert.ok(sheetProblems(html.replace('<td>0.000</td>', '<td>-0.000</td>'), rep).includes('a negative zero'), 'control: a negative zero');
  assert.ok(sheetProblems(html.replace('p, li, h1, h2, h3 { overflow-wrap: anywhere; }', ''), rep).includes('long words do not wrap'), 'control: no wrap rule');
});

// ---------- determinism ----------
// Two separate processes draw the same bytes: nothing drawn depends on a clock, on randomness or on a cache.
const DRAW = `
import { createHash } from 'node:crypto';
import { buildSoundMap, buildSoundDetail, soundDetails } from './scripts/lib/sound-map.js';
import { buildTimeline } from './scripts/lib/sound-timeline.js';
import { buildSoundPanel, panelFrame } from './scripts/lib/sound-panel.js';
import { SHOTS } from './src/shots.js';
import { Draw } from './scripts/lib/draw.js';
import { sheetHtml } from './scripts/sound-storyboard.js';
const h = (s) => createHash('sha256').update(s).digest('hex');
const png = Buffer.from('89504e470d0a1a0a', 'hex'); // the same stand-in bytes for a frame in every run
const out = {};
const m = buildSoundMap();
if (process.env.PLANT) m.d.text(1, 1, String(process.hrtime.bigint()), { size: 10 }); // a planted clock
out.map = h(m.d.toSVG());
for (const g of soundDetails()) out[g.id] = h(buildSoundDetail(g).d.toSVG());
out.timeline = h(buildTimeline().d.toSVG());
for (const s of [SHOTS[0], SHOTS[4], SHOTS[10]]) out['shot' + s.n] = h(buildSoundPanel(s, { frame: { ...panelFrame(s), png } }).d.toSVG());
const sheet = new Draw(1, 1); buildSoundMap({}, sheet, [0, 0]); out.excalidraw = h(JSON.stringify(sheet.toExcalidraw()));
out.sheet = h(sheetHtml(null));
console.log(JSON.stringify(out));`;
const drawRun = (env = {}) => {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', DRAW], { cwd: ROOT, env: { ...process.env, ...env }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
};
const diffs = (a, b) => Object.keys(a).filter((k) => a[k] !== b[k]);

test('determinism: two runs draw byte-identical maps, timeline, panels, Excalidraw scene and sheet', () => {
  const a = drawRun(), b = drawRun();
  assert.equal(Object.keys(a).length, 11);
  assert.deepEqual(diffs(a, b), []);
  // control: a drawing that reads a clock differs between runs, and the comparison sees it
  assert.deepEqual(diffs(drawRun({ PLANT: '1' }), drawRun({ PLANT: '1' })), ['map'], 'control: a planted clock');
});

// ---------- the Excalidraw scene ----------
// The scene holds one element per drawn shape and text, each with a unique id, finite geometry and ordered indices.
function sceneProblems(scene, sheet) {
  const p = [], ids = new Set(), els = scene.elements;
  for (const e of els) {
    if (ids.has(e.id)) p.push(`duplicate id ${e.id}`);
    ids.add(e.id);
    for (const k of ['x', 'y', 'width', 'height']) if (!Number.isFinite(e[k])) p.push(`${e.id}: ${k} ${e[k]}`);
    if (e.points && e.points.some((q) => !q.every(Number.isFinite))) p.push(`${e.id}: a point is not finite`);
  }
  for (let i = 1; i < els.length; i++) if (!(els[i - 1].index < els[i].index)) p.push(`index order at ${els[i].id}`);
  const texts = sheet.items.filter((it) => it.k === 'text').length;
  if (els.filter((e) => e.type === 'text').length !== texts) p.push(`${els.filter((e) => e.type === 'text').length} text elements for ${texts} labels`);
  if (sheet.items.some((it) => it.k === 'clip')) p.push('a clip path, which Excalidraw cannot hold');
  return p;
}

test('excalidraw: the sound map scene is whole, every label and shape in it', () => {
  const sheet = buildSoundMap({}, new (main.d.constructor)(1, 1), [0, 0]).d;
  const scene = sheet.toExcalidraw();
  assert.ok(scene.elements.length > 400);
  assert.deepEqual(sceneProblems(scene, sheet), []);
  // controls: a NaN coordinate; a duplicated element
  const bad = JSON.parse(JSON.stringify(scene));
  bad.elements[5].x = null;
  bad.elements.push({ ...bad.elements[3] });
  assert.ok(sceneProblems(bad, sheet).length >= 2, 'control: a broken scene');
});

// ---------- agreement with the checks (scripts/sound-report.js) ----------
// The checks predict levels, judge the screen and declare the bed-only windows in scripts/sound-report.js, on the
// checks branch. Once both are in one tree, the drawings must say what the report says: on every frame of every enabled
// voiced cue, the same level, pan and screen state (with the same blocker), and the same windows. Skipped until then.
const REPORT = resolve(ROOT, 'scripts/sound-report.js');
async function checksInput() {
  const { buildInput } = await import(REPORT), { screenState } = await import(resolve(ROOT, 'scripts/lib/sound-checks.js'));
  return { input: buildInput(), screenState };
}
function agreeProblems({ input, screenState }, { pred = real, S = sight, windows = bedOnlyWindows() } = {}, first = false) {
  const p = [], theirs = input.silence.windows;
  if (theirs.length !== windows.length || theirs.some((x, i) => !near(x.t0, windows[i].t0, 1e-12) || !near(x.t1, windows[i].t1, 1e-12))) p.push(`bed-only windows ${windows.map((x) => `${x.t0} to ${x.t1}`)}, the checks' ${theirs.map((x) => `${x.t0} to ${x.t1}`)}`);
  for (const c of CUES.filter((x) => x.enabled && x.voices > 0)) {
    for (let f = Math.ceil(c.t0 * FPS - 1e-9); f / FPS < c.t1; f++) {
      if (first && p.length) return p;
      const t = f / FPS, mine = pred.at(c, t), h = input.hear(c, t, input.models[0]);
      if (!mine !== !h || (mine && (!near(mine.db, h.db, 1e-9) || (mine.pan ?? 9) !== (h.pan ?? 9)))) p.push(`${c.id} at ${t.toFixed(3)}: drawn ${mine?.db} dB pan ${mine?.pan}, the checks ${h?.db} dB pan ${h?.pan}`);
      if (!c.place || !mine) continue;
      const a = S.state(c, mine.p, t), b = screenState(input, c, mine.p, t);
      if (a.state !== b.state || a.by !== (b.blocker ?? null)) p.push(`${c.id} at ${t.toFixed(3)}: drawn ${a.state} ${a.by ?? ''}, the checks ${b.state} ${b.blocker ?? ''}`);
    }
  }
  return p;
}

test('agreement with the checks: the same levels, pans, screen states and bed-only windows as scripts/sound-report.js', { skip: existsSync(REPORT) ? false : 'scripts/sound-report.js is on the checks branch; this runs once both are in one tree' }, async () => {
  const chk = await checksInput();
  assert.deepEqual(agreeProblems(chk).slice(0, 5), []);
  // controls: a bed-only window dropped; the modifiers left out; the car never there to hide anything
  assert.ok(agreeProblems(chk, { windows: bedOnlyWindows(WORLD, BED_ONLY.filter((b) => !b.shots.includes(12))) }, true).length > 0, 'control: a window dropped');
  assert.ok(agreeProblems(chk, { pred: makePredictor({ cues: CUES.filter((c) => c.voices > 0) }) }, true).length > 0, 'control: no modifiers');
  const noCar = makeSight({ ...WORLD, carAt: (t) => ({ ...WORLD.carAt(t), present: false }) });
  assert.ok(agreeProblems(chk, { S: noCar }, true).length > 0, 'control: no car to hide behind');
});
