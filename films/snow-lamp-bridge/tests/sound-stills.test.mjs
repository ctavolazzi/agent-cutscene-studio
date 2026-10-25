// Checks for the audio stills and the arrangement sheet (scripts/lib/sound-stills.js and scripts/sound-review.js
// --stills and --sheet, ROADMAP Sound 2.9). Each check is a function returning its problems, run on the drawings
// themselves: the real ones give none, and a planted fault gives some.
// - Every shot has its still, every voiced cue one marker, at its measured onset (measure.json table.onset) within half
//   a device pixel; a measure.json with one onset moved 50 ms moves exactly that marker, and a builder drawing markers
//   at the cue times instead is caught. The arrangement holds every voiced cue the same way.
// - The strips share one time axis: every drawn point at X of its own time, the spectrogram from X(t0) to X(t1) one
//   column a device pixel; a single click lands in the spectrogram column, the level lines and the pan line at its
//   time; on the rasterized PNG a spectrogram column is the device pixel column its time maps to; a strip planted one
//   unit off fails.
// - The reel's colours: each cue's person as the review captions have it.
// - Every image's SVG, the contact sheet and stills.json pass the forbidden-character scan; a planted dash is found.
// - Two processes draw the same bytes; a planted clock is seen. The session renders nothing twice; a session that does
//   not keep its renders is seen to.
// - No label overlaps another or leaves its drawing.
// - The committed stills.json, stills and contact sheet are these drawings of the committed measure.json.
// Signals here are synthetic (zeros, a click, seeded noise), so the tests need no blockout render; the session test
// renders three beds.
// Run: node --test tests/sound-stills.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CUES } from '../src/audio/cues.js';
import { SHOTS } from '../src/shots.js';
import { T_TOTAL } from '../src/world.js';
import { reviewTrack } from '../scripts/lib/captions.js';
import { rasterize } from '../scripts/lib/raster.mjs';
import { TL } from '../scripts/lib/sound-timeline.js';
import { textBox, textOverlaps } from '../scripts/lib/sound-map.js';
import { scan } from '../scripts/check-forbidden.js';
import { makeSession, sheetStep, stillsStep } from '../scripts/sound-review.js';
import {
  SCALE, STILL, arrangementProblems, axisProblems, buildArrangement, buildStill, contactSheetHtml, levelCurve, markerProblems, personOf,
  spectrogram, stillData, stillEntry,
} from '../scripts/lib/sound-stills.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REVIEW = resolve(ROOT, 'review/round-05');
const read = (p) => JSON.parse(readFileSync(resolve(REVIEW, p), 'utf8'));
const MEASURE = read('measure.json');
const SR = MEASURE.sr, N = Math.round(T_TOTAL * SR);
const signal = () => ({ sr: SR, left: new Float32Array(N), right: new Float32Array(N) });
const ZERO = signal();
const dir = mkdtempSync(join(tmpdir(), 'sound-stills-test-'));
const byId = new Map(CUES.map((c) => [c.id, c]));
// every still on silence: the markers, the lanes and the text are measure.json's; the curves are empty
const DATA = SHOTS.map((s) => stillData(s, { mix: ZERO, stemOf: () => ZERO, measure: MEASURE }));
const STILLS = DATA.map((d) => buildStill(d, { measure: MEASURE }));
// measure.json with one cue's measured onset moved by dt
const plantOnset = (m, id, dt) => ({ ...m, table: { ...m.table, rows: m.table.rows.map((x) => (x.cue === id ? { ...x, onset: x.onset + dt } : x)) } });
// a still's markers by cue
const markersOf = (st) => new Map(st.markers.map((m) => [m.cue, m]));

// ---------- the markers: every voiced cue once, on its measured onset ----------
test('every shot has its still and every voiced cue one marker on its measured onset; an onset moved 50 ms moves only its marker; markers at the cue times are caught', () => {
  assert.equal(STILLS.length, SHOTS.length);
  assert.deepEqual(STILLS.map((s) => s.shot.n), SHOTS.map((s) => s.n));
  for (const st of STILLS) assert.deepEqual(markerProblems(st, MEASURE), [], `shot ${st.shot.n}`);
  const marked = STILLS.flatMap((s) => s.markers.map((m) => m.cue)).sort();
  assert.deepEqual(marked, MEASURE.table.rows.map((x) => x.cue).sort(), 'every voiced cue in exactly one still');

  // one onset moved 50 ms later: exactly that marker moves, by 50 ms on the shot's axis
  const id = 'foley.feet.A.05', row = MEASURE.table.rows.find((x) => x.cue === id), k = SHOTS.findIndex((s) => row.onset >= s.start && row.onset < s.end);
  assert.ok(row.onset + 0.05 < SHOTS[k].end, 'premise: the moved onset stays in its shot');
  const moved = plantOnset(MEASURE, id, 0.05), after = buildStill(DATA[k], { measure: moved }), was = markersOf(STILLS[k]), now = markersOf(after);
  assert.deepEqual(markerProblems(after, moved), []);
  for (const [cue, m] of now) {
    const dx = m.x - was.get(cue).x;
    if (cue === id) assert.ok(Math.abs(dx - 0.05 * after.axis.pxPerSec) < 1e-9, `${cue} moved ${dx}`);
    else assert.equal(dx, 0, `${cue} moved ${dx}`);
  }
  const stale = markerProblems(STILLS[k], moved);
  assert.equal(stale.length, 1, stale.join('; '));
  assert.ok(stale[0].startsWith(id), 'control: the drawing from the old measure.json is off on that cue');

  // a builder that marks the cue time (t0) in place of the measured onset
  const atCue = (x) => x.t0;
  assert.ok(markerProblems(buildStill(DATA[k], { measure: moved, markAt: atCue }), moved).some((p) => p.startsWith(id)), 'control: the moved cue drawn at its cue time');
  const film = DATA.flatMap((d) => markerProblems(buildStill(d, { measure: MEASURE, markAt: atCue }), MEASURE));
  assert.ok(film.some((p) => p.startsWith('bg.wind.bridge.bed')), `control: the bridge's beds start 25 ms before their cue time (${film.length} problems)`);
});

// ---------- one time axis ----------
test('every strip on one time axis: each point, dot and marker at X of its own time, the spectrogram one column a device pixel; a strip one unit off fails', () => {
  for (const st of STILLS) assert.deepEqual(axisProblems(st), [], `shot ${st.shot.n}`);
  const k = 2, img = buildStill(DATA[k], { measure: MEASURE });
  img.d.images.find((x) => x.role === 'spectrogram').x += 1;
  assert.ok(axisProblems(img).some((p) => p.startsWith('the spectrogram spans')), 'control: the spectrogram one unit right');
  const line = buildStill(DATA[k], { measure: MEASURE }), bg = line.d.items.find((x) => x.role === 'background');
  bg.pts = bg.pts.map(([x, y]) => [x + 1, y]);
  assert.ok(axisProblems(line).some((p) => p.startsWith('background')), 'control: a level lane\'s line one unit right');
  const cols = buildStill(DATA[k], { measure: MEASURE });
  cols.d.images.find((x) => x.role === 'spectrogram').cols -= 2;
  assert.ok(axisProblems(cols).some((p) => p.includes('columns over')), 'control: a spectrogram with fewer columns than device pixels');
});

// A click (one sample, both channels) at time t in an otherwise silent film
function click(t, a = 1) { const s = signal(), i = Math.round(t * SR); s.left[i] = a; s.right[i] = a; return s; }
// The spectrogram column a click lands in: the loudest column, summed over the rows
function loudestColumn(spec) {
  let best = -1, at = -1;
  for (let k = 0; k < spec.cols; k++) { let e = 0; for (let r = 0; r < spec.rows; r++) e += 10 ** (spec.db[r * spec.cols + k] / 10); if (e > best) { best = e; at = k; } }
  return at;
}
// the middle of the span where a curve is not null
const middleOf = (ts, vs) => { const on = ts.filter((_, i) => vs[i] !== null); return (on[0] + on[on.length - 1]) / 2; };

test('a click lands where its time maps: the spectrogram column, the level and pan lines; a spectrogram computed 10 ms off does not', () => {
  const shot = SHOTS[2], tc = shot.start + 2.46, c = click(tc), data = stillData(shot, { mix: c, stemOf: () => c, measure: MEASURE }), { axis } = data;
  const half = 0.5 / SCALE;
  const k = loudestColumn(data.spec), xs = axis.x0 + (k + 0.5) / SCALE;
  assert.ok(Math.abs(xs - axis.X(tc)) <= half + 1e-9, `the click's column at x ${xs}, its time at ${axis.X(tc)}`);
  for (const ln of data.lanes) assert.ok(Math.abs(axis.X(middleOf(axis.ts, ln.measured)) - axis.X(tc)) <= 0.5 + 1e-9, `${ln.key}: the level line's window centred on the click`);
  assert.ok(Math.abs(axis.X(middleOf(axis.ts, data.balance)) - axis.X(tc)) <= 0.5 + 1e-9, 'the pan line\'s window centred on the click');
  // control: the same spectrogram computed over a span 10 ms later and drawn on the shot's axis
  const off = spectrogram(c, { t0: shot.start + 0.01, t1: shot.end + 0.01, cols: axis.cols, rows: data.spec.rows }), ko = loudestColumn(off), xo = axis.x0 + (ko + 0.5) / SCALE;
  assert.ok(Math.abs(xo - axis.X(tc)) > half, `control: 10 ms off puts the click at x ${xo}, ${axis.X(tc)} wanted`);
});

// The device pixel column of a raster that is brightest over the rows y0 to y1 (RGB summed)
function rgbOf(png) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', png, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 28 });
  assert.equal(r.status, 0, String(r.stderr));
  return r.stdout;
}
function brightestColumn(rgb, width, y0, y1) {
  let best = -1, at = -1;
  for (let x = 0; x < width; x++) {
    let e = 0;
    for (let y = y0; y < y1; y++) for (let ch = 0; ch < 3; ch++) e += rgb[(y * width + x) * 3 + ch];
    if (e > best) { best = e; at = x; }
  }
  return at;
}

// The spectrogram's colours are 3 dB steps, so a click lights several neighbouring columns alike; the raster is checked
// on a spectrogram with one bright column instead, the one the click test above finds the click in
test('rasterized, a spectrogram column is the device pixel column its time maps to, and the same SVG gives the same PNG; the spectrogram one unit off is caught', async () => {
  const k = 400, data = { ...DATA[2], spec: { ...DATA[2].spec, db: DATA[2].spec.db.map((_, i) => (i % DATA[2].spec.cols === k ? 0 : -300)) } };
  const one = buildStill(data, { measure: MEASURE }), moved = buildStill(data, { measure: MEASURE });
  moved.d.images.find((x) => x.role === 'spectrogram').x += 1;
  const files = { one, again: one, moved };
  await rasterize(Object.entries(files).map(([name, st]) => { const svg = join(dir, `${name}.svg`); writeFileSync(svg, st.d.toSVG()); return { file: svg, out: join(dir, `${name}.png`), width: STILL.w, height: st.height, scale: SCALE }; }));
  assert.ok(readFileSync(join(dir, 'one.png')).equals(readFileSync(join(dir, 'again.png'))), 'the same SVG rasterized twice gives the same bytes');
  const im = one.d.images.find((x) => x.role === 'spectrogram'), W = STILL.w * SCALE, y0 = Math.round(im.y * SCALE) + 2, y1 = Math.round((im.y + im.h) * SCALE) - 2;
  const want = Math.floor(one.axis.X(data.spec.times[k]) * SCALE);
  assert.equal(want, Math.round(one.axis.x0 * SCALE) + k, 'premise: column k\'s time maps into device pixel x0 + k');
  assert.equal(brightestColumn(rgbOf(join(dir, 'one.png')), W, y0, y1), want, 'the bright column in the PNG');
  assert.equal(brightestColumn(rgbOf(join(dir, 'moved.png')), W, y0, y1), want + SCALE, 'control: the spectrogram drawn one unit right');
});

// ---------- the arrangement ----------
const TS = Array.from({ length: Math.round(T_TOTAL * TL.pxPerS) }, (_, i) => (i + 0.5) / TL.pxPerS);
const silentEnvelopes = () => new Map(MEASURE.groups.map((g) => [g.source, { ts: TS, db: TS.map(() => null) }]));
const ARR = buildArrangement({ measure: MEASURE, envelopes: silentEnvelopes() });
const dropped = (b) => b.labeler.dropped.map((s) => `dropped: ${s}`);
test('the arrangement holds every voiced cue\'s measured onset in its lane and every cue\'s predicted tick, with no label dropped; a cue left out, a moved onset drawn at its cue time and a crowd of labels are caught', () => {
  assert.deepEqual(arrangementProblems(ARR, MEASURE), []);
  assert.equal(ARR.markers.length, MEASURE.table.rows.length);
  assert.deepEqual(dropped(ARR), []);
  for (const st of STILLS) assert.deepEqual(dropped(st), [], `shot ${st.shot.n}`);
  const id = 'hard.tick.car.05', less = { ...MEASURE, table: { ...MEASURE.table, rows: MEASURE.table.rows.filter((x) => x.cue !== id) } };
  assert.deepEqual(arrangementProblems(buildArrangement({ measure: less, envelopes: silentEnvelopes() }), MEASURE), [`${id}: no measured onset`], 'control: a cue left out');
  const moved = plantOnset(MEASURE, id, 0.05), arr = buildArrangement({ measure: moved, envelopes: silentEnvelopes() });
  assert.deepEqual(arrangementProblems(arr, moved), []);
  const dx = arr.markers.find((m) => m.cue === id).x - ARR.markers.find((m) => m.cue === id).x;
  assert.ok(Math.abs(dx - 0.05 * TL.pxPerS) < 1e-9, `moved ${dx} px`);
  assert.ok(arrangementProblems(buildArrangement({ measure: moved, envelopes: silentEnvelopes(), markAt: (x) => x.t0 }), moved).some((p) => p.startsWith(id)), 'control: drawn at its cue time');
  // every voiced cue off its sync bar at once: more labels than the sheet has room for, and each is counted
  const sync = MEASURE.measures.find((m) => m.id === 'sync'), all = { ...MEASURE, measures: MEASURE.measures.map((m) => (m === sync ? { ...m, rows: MEASURE.table.rows.map((x) => ({ cue: x.cue, ok: false, frame: x.onset + 0.2, aheadMs: -200 })) } : m)) };
  assert.ok(dropped(buildArrangement({ measure: all, envelopes: silentEnvelopes() })).length > 0, 'control: a crowd of miss labels');
});

// ---------- colours: the reel's person ----------
test('each cue\'s person is the review captions\' lane (A orange, B blue, the world white); one that ignores the doors is caught', () => {
  const lane = personOf(), caps = reviewTrack().captions, off = [];
  for (const c of caps) for (const id of c.ids) if (lane(byId.get(id)) !== c.lane) off.push(`${id}: ${lane(byId.get(id))}, the reel's ${c.lane}`);
  assert.deepEqual(off, []);
  const noDoors = (c) => c.person ?? 'world';
  assert.ok(caps.some((c) => c.ids.some((id) => noDoors(byId.get(id)) !== c.lane)), 'control: the doors left to the world');
});

// ---------- the forbidden characters ----------
test('every still\'s and the arrangement\'s SVG, the contact sheet and stills.json pass the forbidden-character scan; a planted dash is found', () => {
  const clean = mkdtempSync(join(dir, 'scan-')), stills = STILLS.map((st) => stillEntry(st, { png: `stills/shot-${String(st.shot.n).padStart(2, '0')}.png`, svg: 'none' }));
  STILLS.forEach((st, i) => writeFileSync(join(clean, `shot-${i + 1}.svg`), st.d.toSVG()));
  writeFileSync(join(clean, 'arrangement.svg'), ARR.d.toSVG());
  writeFileSync(join(clean, 'contact-sheet.html'), contactSheetHtml({ measure: MEASURE, stills, stems: read('stems/stems.json'), decisions: read('decisions/decisions.json') }));
  writeFileSync(join(clean, 'stills.json'), JSON.stringify({ stills }, null, 1));
  const r = scan(clean);
  assert.equal(r.files.text, 18);
  assert.deepEqual(r.hits, []);
  const dash = buildStill(DATA[0], { measure: MEASURE });
  dash.d.text(10, 10, `the hush${String.fromCharCode(0x2013)}the car`, { size: 12 });
  writeFileSync(join(clean, 'shot-1.svg'), dash.d.toSVG());
  assert.deepEqual(scan(clean).hits.map((h) => h.file), ['shot-1.svg'], 'control: a dash in a label');
});

// ---------- determinism ----------
// Two processes draw the same bytes from the same seeded signals: nothing drawn reads a clock or unseeded randomness.
const DRAW = `
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { buildArrangement, buildStill, contactSheetHtml, levelCurve, spectrogramPng, stillData, stillEntry } from './scripts/lib/sound-stills.js';
import { TL } from './scripts/lib/sound-timeline.js';
import { SHOTS } from './src/shots.js';
import { mulberry32 } from './src/prng.js';
const h = (s) => createHash('sha256').update(s).digest('hex'), read = (p) => JSON.parse(readFileSync('review/round-05/' + p, 'utf8'));
const measure = read('measure.json'), shot = SHOTS[13], sr = measure.sr, n = 112 * sr, rnd = mulberry32(7);
const s = { sr, left: new Float32Array(n), right: new Float32Array(n) };
for (let i = Math.round(shot.start * sr); i < Math.round(shot.end * sr); i++) { s.left[i] = (rnd() - 0.5) * 0.1; s.right[i] = (rnd() - 0.5) * 0.08; }
const data = stillData(shot, { mix: s, stemOf: () => s, measure }), still = buildStill(data, { measure });
if (process.env.PLANT) still.d.text(1, 1, String(process.hrtime.bigint()), { size: 10 }); // a planted clock
const ts = Array.from({ length: 200 }, (_, i) => shot.start + i * 0.02), env = new Map([['bg:wind', { ts, db: levelCurve([s], ts, { refDb: measure.streetDb }) }]]);
const entry = stillEntry(still, { png: 'p', svg: 's' });
console.log(JSON.stringify({ still: h(still.d.toSVG()), spec: h(spectrogramPng(data.spec)), arrangement: h(buildArrangement({ measure, envelopes: env }).d.toSVG()), entry: h(JSON.stringify(entry)), sheet: h(contactSheetHtml({ measure, stills: [entry], stems: read('stems/stems.json'), decisions: read('decisions/decisions.json') })) }));`;
const drawRun = (env = {}) => {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', DRAW], { cwd: ROOT, env: { ...process.env, ...env }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
};
const diffs = (a, b) => Object.keys(a).filter((k) => a[k] !== b[k]);
test('determinism: two runs draw byte-identical stills, spectrograms, arrangement, stills.json entries and contact sheets; a planted clock is seen', () => {
  const a = drawRun(), b = drawRun();
  assert.equal(Object.keys(a).length, 5);
  assert.deepEqual(diffs(a, b), []);
  assert.deepEqual(diffs(drawRun({ PLANT: '1' }), drawRun({ PLANT: '1' })), ['still'], 'control: a planted clock');
});

// ---------- the session: nothing rendered twice ----------
// The steps draw from the session's memoised renders only: a second pass renders nothing, and no render is made twice
// (session.rendered); a session that does not keep its renders makes the same one again. And the steps' code and the
// drawing library call no renderer themselves.
const twice = (keys) => keys.filter((k, i) => keys.indexOf(k) !== i);
test('the stills and the sheet render nothing twice on a session; a session that does not keep its renders, and a step that renders for itself, are caught', () => {
  const beds = new Set(['bg:city', 'bg:wind', 'lamp']), cues = CUES.filter((c) => c.voices === 0 || beds.has(c.source));
  const s = makeSession({ cues, log: () => {} }), shot = SHOTS[0], ts = TS.slice(0, 200);
  const pass = () => { stillData(shot, { mix: s.mastered(), stemOf: (g) => s.group(g), measure: MEASURE }); for (const g of beds) levelCurve([s.group(g)], ts); };
  pass();
  const first = s.rendered.slice();
  pass();
  assert.deepEqual(s.rendered, first, 'a second pass renders nothing');
  assert.deepEqual(twice(s.rendered), []);
  assert.deepEqual(first.filter((k) => k.startsWith('group:')).sort(), [...beds].map((g) => `group:${g}`).sort());
  const loose = makeSession({ cues, log: () => {}, keep: false });
  loose.group('lamp'); loose.group('lamp');
  assert.deepEqual(twice(loose.rendered), ['group:lamp'], 'control: a session that does not keep its renders');
  const RENDERS = /\b(?:preMaster|renderSoundtrack|renderAll|stemWith|groupStem)\s*\(/;
  for (const [name, src] of [['stillsStep', String(stillsStep)], ['sheetStep', String(sheetStep)], ['sound-stills.js', readFileSync(resolve(ROOT, 'scripts/lib/sound-stills.js'), 'utf8')]]) assert.ok(!RENDERS.test(src), `${name} calls a renderer`);
  assert.ok(RENDERS.test(`${String(stillsStep)}; A.preMaster(cues, config)`), 'control: a step that renders for itself');
});

// ---------- labels ----------
// No two labels' boxes overlap (Helvetica's metrics, sound-map.js textBox), none is under `min` (a still's axes'
// numbers at 11 units, 22 px in its PNG; the arrangement keeps round 04's floor of 9 px, tests/sound-storyboard.test.mjs),
// none leaves its drawing
function labelProblems(d, min = 11) {
  const p = textOverlaps(d).map(([a, b]) => `"${a.str}" covers "${b.str}"`);
  for (const it of d.items.filter((x) => x.k === 'text')) {
    if ((it.size ?? 14) < min) p.push(`"${it.str}" at ${it.size}`);
    const b = textBox(it);
    if (b.x0 < 0 || b.y0 < 0 || b.x1 > d.w || b.y1 > d.h) p.push(`"${it.str}" leaves the drawing`);
  }
  return p;
}
test('labels: none overlaps another, none is too small or outside, on every still and the arrangement; a label moved onto another and one at 8 are caught', () => {
  for (const st of STILLS) assert.deepEqual(labelProblems(st.d), [], `shot ${st.shot.n}`);
  assert.deepEqual(labelProblems(ARR.d, 9), [], 'the arrangement');
  const st = buildStill(DATA[4], { measure: MEASURE }), ts = st.d.items.filter((it) => it.k === 'text');
  Object.assign(ts[ts.length - 1], { x: ts[ts.length - 2].x + 3, y: ts[ts.length - 2].y + 2, anchor: ts[ts.length - 2].anchor });
  assert.ok(labelProblems(st.d).some((x) => x.includes('covers')), 'control: a label moved onto another');
  ts[0].size = 8;
  assert.ok(labelProblems(st.d).some((x) => x.endsWith('at 8')), 'control: a label at 8');
});

// ---------- the committed files ----------
// review/round-05's stills.json and contact sheet are this code's output from measure.json: every still listed with
// its PNG (1200 px wide, the drawing's height), its mapping the drawing's, each marker's x the time mapping of its
// measured onset within half a device pixel; the contact sheet byte for byte what contactSheetHtml writes, showing
// the arrangement and every still and linking every measure, stem and decision clip, each file there.
const pngSize = (file) => { const b = readFileSync(file); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; };
function stillsJsonProblems(json, stills, measure) {
  const p = [], onset = new Map(measure.table.rows.map((x) => [x.cue, x.onset]));
  if (json.stills.length !== stills.length) p.push(`${json.stills.length} stills listed, ${stills.length} shots`);
  json.stills.forEach((e, i) => {
    const st = stills[i], at = `shot ${e.shot}`;
    if (!st || e.shot !== st.shot.n || e.t0 !== st.shot.start || e.t1 !== st.shot.end) { p.push(`${at}: not shot ${st?.shot.n}`); return; }
    if (!existsSync(resolve(REVIEW, e.file))) { p.push(`${at}: no ${e.file}`); return; }
    const sz = pngSize(resolve(REVIEW, e.file));
    if (sz.w !== STILL.w * SCALE || sz.h !== e.height || e.height !== Math.round(st.height * SCALE)) p.push(`${at}: ${sz.w} by ${sz.h} px, the drawing ${STILL.w * SCALE} by ${Math.round(st.height * SCALE)}`);
    if (e.x0 !== st.axis.x0 * SCALE || Math.abs(e.pxPerSec - st.axis.pxPerSec * SCALE) > 1e-6) p.push(`${at}: its mapping is not the drawing's`);
    const want = st.markers.map((m) => m.cue).join(), got = e.markers.map((m) => m.cue).join();
    if (want !== got) p.push(`${at}: markers ${got}, the drawing's ${want}`);
    for (const m of e.markers) {
      if (m.onset !== onset.get(m.cue)) p.push(`${at}: ${m.cue} onset ${m.onset}, measure.json's ${onset.get(m.cue)}`);
      if (Math.abs(m.x - (e.x0 + (m.onset - e.t0) * e.pxPerSec)) > 0.5) p.push(`${at}: ${m.cue} drawn at x ${m.x}, its onset maps to ${e.x0 + (m.onset - e.t0) * e.pxPerSec}`);
    }
  });
  return p;
}
function contactProblems(html, { measure, stills, stems, decisions }) {
  const p = [], has = (s) => html.includes(s), file = (f) => existsSync(resolve(REVIEW, f));
  if (!has('src="arrangement.png"') || !file('arrangement.png')) p.push('no arrangement');
  for (const s of stills) if (!has(`<img src="${s.file}"`) || !file(s.file)) p.push(`no still for shot ${s.shot}`);
  for (const m of measure.measures) if (!has(`id="m-${m.id}"`)) p.push(`no entry ${m.id}`);
  if ((html.match(/<details>/g) ?? []).length !== measure.measures.length) p.push('a table not collapsed');
  for (const b of stems.bodies) if (!has(`href="stems/${b.file}"`) || !file(`stems/${b.file}`)) p.push(`no stem ${b.file}`);
  for (const o of decisions.options) for (const c of o.clips ?? []) { const f = c.file.replace(/^review\/round-\d+\//, ''); if (!has(`href="${f}"`) || !file(f)) p.push(`no clip ${f}`); }
  return p;
}
test('the committed stills.json, stills and contact sheet are these drawings of measure.json; a marker one pixel off and a still left off the sheet are caught', () => {
  const json = read('stills.json'), html = readFileSync(resolve(REVIEW, 'contact-sheet.html'), 'utf8'), stems = read('stems/stems.json'), decisions = read('decisions/decisions.json');
  assert.equal(json.raw, MEASURE.renders.raw.sha256, 'made from this measure.json');
  assert.deepEqual(stillsJsonProblems(json, STILLS, MEASURE), []);
  assert.equal(html, contactSheetHtml({ measure: MEASURE, stills: json.stills, stems, decisions }), 'the contact sheet is the code\'s, from the committed files');
  assert.deepEqual(contactProblems(html, { measure: MEASURE, stills: json.stills, stems, decisions }), []);
  assert.equal(pngSize(resolve(REVIEW, 'arrangement.png')).w, Math.round(ARR.d.w));
  const off = structuredClone(json);
  off.stills[4].markers[7].x += 1;
  assert.ok(stillsJsonProblems(off, STILLS, MEASURE).some((x) => x.includes(off.stills[4].markers[7].cue)), 'control: a marker one pixel off');
  const s = json.stills[9], cut = html.replace(new RegExp(`<figure[^\\n]*${s.file}[^\\n]*</figure>\\n`), '');
  assert.notEqual(cut, html, 'premise: the card was cut');
  assert.deepEqual(contactProblems(cut, { measure: MEASURE, stills: json.stills, stems, decisions }), [`no still for shot ${s.shot}`], 'control: a still left off the sheet');
});
