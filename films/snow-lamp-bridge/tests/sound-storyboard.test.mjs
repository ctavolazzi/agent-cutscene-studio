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
import { CUES, WORLD, makeCues } from '../src/audio/cues.js';
import { SHOTS, cameraAt, shotAt } from '../src/shots.js';
import { FPS } from '../src/world.js';
import { CONFIG } from '../src/config.js';
import { makeCamera } from '../scripts/lib/math.js';
import { buildSoundMap, buildSoundDetail, soundDetails, textBox, textOverlaps, MAP_SCALE } from '../scripts/lib/sound-map.js';
import { buildTimeline, inFrame, TL } from '../scripts/lib/sound-timeline.js';
import { buildSoundPanel, decodeFrames, panelFrame, FW, FH } from '../scripts/lib/sound-panel.js';
import { sheetHtml } from '../scripts/sound-storyboard.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VIDEO = resolve(ROOT, 'out/snowy-bridge.mp4');
const near = (a, b, eps) => Math.abs(a - b) <= eps;
const placedVoiced = (cues) => cues.filter((c) => c.enabled && c.voices > 0 && c.place);
const main = buildSoundMap(), details = soundDetails().map((g) => buildSoundDetail(g)), tl = buildTimeline();

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
// Each in-frame bar lies inside the joined spans of its lane's sounding cues (none bridges a gap where nothing sounds),
// and at both of its ends a cue of the lane sounds with its point in frame.
function barProblems(t, cues) {
  const p = [];
  for (const b of t.d.items.filter((it) => it.onScreen)) {
    const own = cues.filter((c) => c.source === b.onScreen && c.enabled && c.voices > 0 && c.place).sort((a, z) => a.t0 - z.t0), spans = [];
    for (const c of own) { const last = spans[spans.length - 1]; if (last && c.t0 <= last[1] + 1e-9) last[1] = Math.max(last[1], c.t1); else spans.push([c.t0, c.t1]); }
    if (!spans.some(([a, z]) => b.t0 >= a && b.t1 < z)) p.push(`${b.onScreen}: a bar from ${b.t0} to ${b.t1} outside its cues' spans`);
    for (const at of [b.t0, b.t1]) if (!own.some((c) => c.t0 <= at && at < c.t1 && c.place(at) && inFrame(WORLD, c.place(at), at))) p.push(`${b.onScreen}: nothing in frame at ${at}`);
  }
  return p;
}

test('timeline: the in-frame bars lie inside their cues\' spans, in frame at both ends', () => {
  assert.ok(tl.d.items.filter((it) => it.onScreen).length > 20);
  assert.deepEqual(barProblems(tl, CUES), []);
  // controls: A's forearms' bar stretched over the gap to the cup (the bridged runs this test was written for); a bar
  // on the hum at a shot's middle where the lantern is out of frame
  const t2 = buildTimeline(), bar = t2.d.items.find((it) => it.onScreen === 'A:arms');
  bar.t1 = (bar.t1 + CUES.find((c) => c.id === 'foley.moves.A.cup').t0) / 2;
  assert.ok(barProblems(t2, CUES).length > 0, 'control: a bar over a gap');
  const hum = CUES.find((c) => c.family === 'hum'), off = SHOTS.map((s) => (s.start + s.end) / 2).find((t) => !inFrame(WORLD, hum.place(t), t));
  const t3 = buildTimeline();
  t3.d.items.push({ k: 'rect', onScreen: hum.source, t0: off, t1: off + 0.1 });
  assert.ok(barProblems(t3, CUES).length > 0, 'control: a bar where the source is out of frame');
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
    for (const s of [c.name, c.bar, c.summary]) if (!sec.includes(escHtml(s))) p.push(`${c.id}: "${s}" is not in its section`);
    if (!sec.includes(`class="chip ${c.status}"`)) p.push(`${c.id}: no ${c.status} chip`);
    for (const r of c.rows) if ('cue' in r && !sec.includes(`href="#cue-${escHtml(r.cue)}"`)) p.push(`${c.id}: ${r.cue} is not linked`);
  }
  for (const k of Object.keys(report.tables)) if (!html.includes(`id="table-${k}"`)) p.push(`no table ${k}`);
  return p;
}
const sampleReport = () => ({
  cues: CUES.length, enabled: CUES.filter((c) => c.enabled).length,
  checks: [
    { id: 'sync', n: 4, name: 'Sync', definition: 'Each sync cue against its first showing frame.', bar: '0 to 45 ms ahead', starting: true, status: 'fail', summary: 'one cue late', columns: ['cue', 't', 'ok'], rows: [{ cue: CUES[40].id, t: CUES[40].t0, ok: false }] },
    { id: 'trace', n: 1, name: 'Trace', definition: 'Every cue traced.', bar: 'Exact', starting: false, status: 'pass', summary: 'all traced', columns: ['cue', 'by', 'note'], rows: [{ cue: CUES[0].id, by: CUES[1].id, note: null }] },
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
