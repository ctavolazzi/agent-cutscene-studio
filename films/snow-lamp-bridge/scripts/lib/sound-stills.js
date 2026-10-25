// Sound 2.9 (ROADMAP; SOUND-PLAN 1.2, 4.5 and 4.7): pictures of sound from the blockout's review round. One audio still
// per shot and the arrangement sheet for the whole film, drawn from measure.json, the voice groups' stems and the
// mastered mix of scripts/sound-review.js's session, in round 04's colours, scales and lanes (sound-map.js,
// sound-timeline.js, sound-panel.js); then stills.json and the contact sheet.
// Every number drawn is measured (measure.json, a stem, the render) or predicted (cues.js through makePredictor, the
// storyboard's one rule), and each image's legend says which: measured is white and solid, or a filled mark; predicted
// is the lane's colour, translucent or hollow, or dashed.
// Pure: the same inputs give the same bytes. Signals come in as { sr, left, right }; nothing here renders audio.
import { deflateSync } from 'node:zlib';
import { shotColor } from './map.js';
import { PanelDraw } from './sound-panel.js';
import { makePredictor, makeLabeler, colorOf, voiced, fmtT, fmtDb, wrapText, textWidth, glyph, FAMILY } from './sound-map.js';
import { buildTimeline, lanesOf, partOf, bedOnlyWindows, hatch, keyGlyph, TL, DB } from './sound-timeline.js';
import { COLOUR } from './captions.js';
import { fft, idx, PHONE_SPEAKER } from './audio-analysis.mjs';
import { CUES, WORLD } from '../../src/audio/cues.js';
import { LEVEL } from '../../src/audio/layers/blockout/timbre.js';

// ---------- geometry, scales and colours ----------
// The raster scale: a still is drawn in units and written at SCALE device pixels a unit, so its spectrogram's columns
// and rows are whole device pixels (1200 px wide).
export const SCALE = 2;
// A still in units: 600 wide; every strip from x0 to x1 on the shot's one time axis. Text sizes: `body` and `text`
// carry the words a reader needs and read at a phone's 390 px (9 and 8.5 px there, `line` apart); `small` (the marker
// labels and the axes' numbers) reads at full size.
export const STILL = Object.freeze({ w: 600, x0: 62, x1: 588, title: 18, loud: 46, row: 13, glyphRow: 18, spec: 130, laneHead: 16, lane: 50, laneGap: 6, pan: 70, axis: 26, body: 14, text: 13, line: 16, small: 12 });
// The spectrogram: a Hann window of `size` samples centred on each column, the two channels' power averaged, in dB
// against a full-scale sine; rows log-spaced from fLo to fHi, each its band's loudest bin (a row narrower than a bin
// interpolates). The colour scale lo to hi in `step` dB steps: starting values from the mastered blockout's own
// spectrogram (round 05, these rows, 200 columns a shot over the 15 shots: 5 percent of the values under -91 dB, the
// median -52, 99 percent under -32.5, the loudest -17.3, the driver's unlatch), so the beds sit in the middle of the
// scale and a cue over them reads brighter. -115 to -25 and -100 to -30 were tried first (set from linear bins, which
// over-count the quiet top octaves) and drew the beds orange, the cues hardly brighter.
export const SPEC = Object.freeze({ size: 4096, fLo: 25, fHi: 20000, lo: -88, hi: -22, step: 3, ticks: [50, 100, 250, 500, 1000, 2000, 5000, 10000] });
// The loudness strip's scale, LUFS: the blockout's -23 target sits in it, the loudest momentary reading (-15.4) under hi
export const LOUD = Object.freeze({ lo: -45, hi: -10 });
// The level window: the level plan's 100 ms (SOUND-PLAN 1.3, timbre.js LEVEL.windowSec), the window measure.json's levels
// are read on; the measured lines are that window centred on each point. The mix's balance uses the same window.
export const WINDOW = LEVEL.windowSec;
// Measured is white; a miss of its bar red; a phone or mono flag (check 14) violet; the night and the car in the reel's
// colour (captions.js COLOUR: A orange, B blue, the world white)
export const INK = Object.freeze({ measured: '#ffffff', miss: '#ff5d5d', phone: '#d38cff', grid: '#2a3552', dim: '#8794b3', text: '#c9d4ee', box: '#0d1320', bg: '#080c16' });
export const REEL = Object.freeze({ A: COLOUR.A, B: COLOUR.B, world: COLOUR.world });
// The body a voice group belongs to (scripts/sound-review.js bodyOf, repeated here so this file needs no session): the
// night (the backgrounds and the lamp's hum), or the group's first word (car, A, B)
export const bodyOf = (source) => (source.startsWith('bg:') || source === 'lamp' ? 'night' : source.split(':')[0]);
const BODY_COLOUR = { night: FAMILY.wind.color, car: FAMILY.engine.color, A: '#ffa94d', B: '#4dc3ff' };

// The reel's lane of a cue (captions.js reviewTrack): its person, a door its person's (the side each gets out on,
// EXIT.outSide), and the world for everything else, the car and the night included
export function personOf(w = WORLD) {
  const ids = Object.keys(w.PEOPLE);
  const doorOwner = Object.fromEntries(ids.map((id) => [Object.keys(w.DOOR_SIDE).find((tag) => w.DOOR_SIDE[tag] === w.EXIT.outSide[id]), id]));
  return (c) => c.person ?? (c.family === 'door' ? doorOwner[c.meta.door] : 'world');
}

// A cue's short label (round 04's partOf): a step by its ordinal, a background by its family and place, and a number
// that would be bare (a tick, a scuff, a drag) after its family
export function stillLabel(c) {
  if (c.category === 'bg') return c.meta?.location ? `${c.family} ${c.meta.location}` : c.family;
  const p = partOf(c);
  return /^\d+$/.test(p) && c.family !== 'feet' ? `${c.family} ${p}` : p;
}

// One time axis: X(t) in units from t0 at x0 to t1 at x1; `cols` device pixels across; `ts` one point a unit, at each
// unit's middle (the lines' sample times)
export function axisOf(t0, t1, { x0 = STILL.x0, x1 = STILL.x1, scale = SCALE } = {}) {
  const pxPerSec = (x1 - x0) / (t1 - t0), n = Math.round(x1 - x0);
  return { t0, t1, x0, x1, scale, pxPerSec, X: (t) => x0 + (t - t0) * pxPerSec, cols: Math.round((x1 - x0) * scale), ts: Array.from({ length: n }, (_, i) => t0 + (i + 0.5) / pxPerSec) };
}

// The balance (right over left, dB) as a pan, -1 to 1, by the spatializer's equal-power law (spatial.js: the left gain
// cos((pan + 1) pi / 4), the right sin): so a balance and a placement share one scale
export const panOfBalance = (db) => (db === Infinity ? 1 : db === -Infinity ? -1 : (4 / Math.PI) * Math.atan(10 ** (db / 20)) - 1);

// ---------- curves over time, from signals ----------
// The level of the sum of `parts` (signals) in the window centred on each t, both channels' power, in dB minus refDb;
// null where it is silent
export function levelCurve(parts, ts, { win = WINDOW, refDb = 0 } = {}) {
  const sr = parts[0].sr;
  return ts.map((t) => {
    const a = Math.max(0, idx(t - win / 2, sr)), b = Math.min(parts[0].left.length, idx(t + win / 2, sr));
    let e = 0;
    for (let i = a; i < b; i++) { let l = 0, r = 0; for (const p of parts) { l += p.left[i]; r += p.right[i]; } e += l * l + r * r; }
    return e > 0 ? 10 * Math.log10(e / Math.max(1, b - a)) - refDb : null;
  });
}
// The balance (right over left, dB) of a signal in the window centred on each t; null where it is silent
export function balanceCurve(s, ts, { win = WINDOW } = {}) {
  return ts.map((t) => {
    const a = Math.max(0, idx(t - win / 2, s.sr)), b = Math.min(s.left.length, idx(t + win / 2, s.sr));
    let l = 0, r = 0;
    for (let i = a; i < b; i++) { l += s.left[i] * s.left[i]; r += s.right[i] * s.right[i]; }
    return l + r > 0 ? (l > 0 ? (r > 0 ? 10 * Math.log10(r / l) : -Infinity) : Infinity) : null;
  });
}
// The predicted level of a lane's cues at each t (the storyboard's rule, makePredictor): the power sum of the cues
// sounding then, on the level plan's scale; null where none sounds
export function predictedCurve(cues, ts, pred) {
  return ts.map((t) => {
    let e = 0;
    for (const c of cues) if (c.t0 <= t && t < c.t1) { const q = pred.at(c, t); if (q) e += 10 ** (q.db / 10); }
    return e > 0 ? 10 * Math.log10(e) : null;
  });
}

// ---------- the spectrogram ----------
// The rows' bands, top (highest) first: `rows` log-spaced bands from fLo to fHi, { lo, hi } Hz
export function rowBands(rows, fLo = SPEC.fLo, fHi = SPEC.fHi) {
  const r = Math.log(fHi / fLo) / rows;
  return Array.from({ length: rows }, (_, k) => { const j = rows - 1 - k; return { lo: fLo * Math.exp(j * r), hi: fLo * Math.exp((j + 1) * r) }; });
}
// A spectrogram of signal s over [t0, t1): `cols` columns, column k centred on t0 + (k + 0.5) (t1 - t0) / cols (so a
// column is one device pixel of the axis it is drawn on), `rows` log-frequency rows. dB per row and column, row-major,
// top row first; the columns' centre times in `times`.
export function spectrogram(s, { t0, t1, cols, rows, size = SPEC.size, fLo = SPEC.fLo, fHi = SPEC.fHi }) {
  const sr = s.sr, half = size / 2, hz = sr / size, win = new Float64Array(size);
  for (let i = 0; i < size; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
  const norm = (win.reduce((a, b) => a + b, 0) / 2) ** 2; // a full-scale sine on a bin reads 1
  const bands = rowBands(rows, fLo, fHi).map((b) => ({ ...b, a: Math.ceil(b.lo / hz), z: Math.ceil(b.hi / hz) - 1, at: Math.sqrt(b.lo * b.hi) / hz }));
  const db = new Float32Array(rows * cols), times = new Float64Array(cols), p = new Float64Array(half + 1), re = new Float64Array(size), im = new Float64Array(size);
  for (let k = 0; k < cols; k++) {
    const tc = t0 + ((k + 0.5) * (t1 - t0)) / cols, c0 = Math.round(tc * sr) - half;
    times[k] = tc;
    p.fill(0);
    for (const ch of [s.left, s.right]) {
      for (let i = 0; i < size; i++) { const j = c0 + i; re[i] = j >= 0 && j < ch.length ? ch[j] * win[i] : 0; im[i] = 0; }
      fft(re, im);
      for (let b = 0; b <= half; b++) p[b] += (re[b] * re[b] + im[b] * im[b]) / norm / 2;
    }
    for (let r = 0; r < rows; r++) {
      const B = bands[r];
      let v = 0;
      if (B.a <= B.z) for (let b = B.a; b <= Math.min(B.z, half); b++) v = Math.max(v, p[b]);
      else { const i = Math.floor(B.at), f = B.at - i; v = p[Math.min(half, i)] * (1 - f) + p[Math.min(half, i + 1)] * f; }
      db[r * cols + k] = v > 0 ? 10 * Math.log10(v) : -300;
    }
  }
  return { t0, t1, cols, rows, size, fLo, fHi, times, db };
}
// Matplotlib's magma at nine stops: dark to bright, readable in grey and for every common colour vision
const MAGMA = ['#000004', '#1c1044', '#4f127b', '#812581', '#b5367a', '#e55064', '#fb8761', '#fec287', '#fcfdbf'].map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
// The colour of a level: below lo the darkest stop, then one colour per `step` dB, the top step at hi and over
export function specColour(db, { lo = SPEC.lo, hi = SPEC.hi, step = SPEC.step } = {}) {
  const n = Math.round((hi - lo) / step);
  if (!(db >= lo)) return MAGMA[0];
  const q = Math.min(n - 1, Math.floor((db - lo) / step)), u = (q + 1) / n, x = u * (MAGMA.length - 1), i = Math.min(MAGMA.length - 2, Math.floor(x)), f = x - i;
  return MAGMA[i].map((v, k) => Math.round(v + (MAGMA[i + 1][k] - v) * f));
}

// ---------- PNG ----------
const CRC = Uint32Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const head = Buffer.alloc(4), tail = Buffer.alloc(4), td = Buffer.concat([Buffer.from(type, 'latin1'), data]); head.writeUInt32BE(data.length); tail.writeUInt32BE(crc32(td)); return Buffer.concat([head, td, tail]); };
// An 8-bit RGB PNG of w by h from rgb (w * h * 3 bytes, top row first); zlib at level 9, so the same pixels give the
// same bytes
export function encodePng(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h), ihdr = Buffer.alloc(13);
  for (let y = 0; y < h; y++) Buffer.from(rgb.buffer, rgb.byteOffset + y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
// A spectrogram as a PNG, one pixel per column and row
export function spectrogramPng(spec) {
  const rgb = new Uint8Array(spec.cols * spec.rows * 3);
  for (let i = 0; i < spec.cols * spec.rows; i++) rgb.set(specColour(spec.db[i]), i * 3);
  return encodePng(spec.cols, spec.rows, rgb);
}

// ---------- what measure.json says about each cue ----------
// Each cue's misses of a bar (the renderer's onset, sync, pan) and its phone or mono flag (check 14), from the entries
// of measure.json: Map(cue id, [{ kind, bar, text }]); `bar` false marks a flag, not a bar
export function missesOf(measure) {
  const out = new Map(), add = (id, m) => { if (!out.has(id)) out.set(id, []); out.get(id).push(m); };
  const entry = (id) => measure.measures.find((x) => x.id === id);
  for (const x of entry('renderer').rows) if (x.kind === 'onset' && x.ok === false) add(x.cue, { kind: 'onset', bar: true, text: `onset ${x.note}` });
  for (const x of entry('sync').rows) {
    if (x.ok !== false) continue;
    const text = x.frame === null ? 'sync: its event is not shown within 0.5 s' : x.aheadMs < 0 ? `sync: ${fmtMs(-x.aheadMs)} ms after its frame` : `sync: ${fmtMs(x.aheadMs)} ms ahead of its frame`;
    add(x.cue, { kind: 'sync', bar: true, text, frame: x.frame });
  }
  for (const x of entry('pan').rows) if (x.ok === false) add(x.cue, { kind: 'pan', bar: true, text: `pan: ${fmtDb(x.diffDb)} dB off its prediction` });
  for (const x of entry('phoneMono').rows) if (x.flag) add(x.cue, { kind: 'phone', bar: false, text: `phone and mono: ${x.flag}${x.phoneDb === null || x.phoneDb === undefined ? '' : ` (${fmtDb(x.phoneDb)} dB on a phone)`}` });
  return out;
}
const fmtMs = (v) => (Math.round(v * 10) / 10).toFixed(1);

// ---------- one still's data ----------
// The level lanes of a shot: one per voice group sounding in it when the shot has at most MAX_LANES; otherwise the
// night as one lane and the other groups each their own, while there are at most MAX_LANES - 1 of them; otherwise one
// lane per body. Each { key, label, colour, groups, cues }, in round 04's lane order (backgrounds, hard, foley).
export const MAX_LANES = 7;
export function stillLanes(shot, rows, { cues = CUES } = {}) {
  const order = lanesOf(cues).map((l) => l.source), byId = new Map(cues.map((c) => [c.id, c]));
  const on = rows.filter((x) => x.t0 < shot.end && Math.max(x.t1, x.end ?? x.t1) > shot.start);
  const groups = [...new Set(on.map((x) => x.group))].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const lane = (key, gs, label, colour) => ({ key, label, colour, groups: gs, cues: rows.filter((x) => gs.includes(x.group)).map((x) => byId.get(x.cue)) });
  const asGroup = (g) => { const c = byId.get(on.find((x) => x.group === g).cue); return lane(g, [g], g, colorOf(c)); };
  const asBody = (b) => lane(b, groups.filter((g) => bodyOf(g) === b), b === 'night' ? 'the night (all backgrounds and the hum)' : `${b} (all its groups)`, BODY_COLOUR[b]);
  if (groups.length <= MAX_LANES) return groups.map(asGroup);
  const night = groups.filter((g) => bodyOf(g) === 'night'), rest = groups.filter((g) => bodyOf(g) !== 'night');
  if (rest.length <= MAX_LANES - 1) return [...(night.length ? [asBody('night')] : []), ...rest.map(asGroup)];
  return [...new Set(groups.map(bodyOf))].map(asBody);
}

// Everything a still draws that comes from signals: the spectrogram of the mastered mix, each lane's measured and
// predicted levels, the mix's balance. `mix` the mastered mix; `stemOf(group)` a voice group's stem before the master.
export function stillData(shot, { mix, stemOf, measure, cues = CUES, w = WORLD, pred = makePredictor({ cues, w }) }) {
  const axis = axisOf(shot.start, shot.end);
  const spec = spectrogram(mix, { t0: shot.start, t1: shot.end, cols: axis.cols, rows: Math.round(STILL.spec * SCALE) });
  const lanes = stillLanes(shot, measure.table.rows, { cues }).map((ln) => ({
    ...ln, measured: levelCurve(ln.groups.map(stemOf), axis.ts, { refDb: measure.streetDb }), predicted: predictedCurve(ln.cues.filter((c) => c.enabled && voiced(c)), axis.ts, pred),
  }));
  return { shot, axis, spec, lanes, background: axis.ts.map((t) => pred.refAt(t)), balance: balanceCurve(mix, axis.ts) };
}

// ---------- drawing helpers ----------
// A drawing that holds images (PanelDraw) and tags each with what it is, for the checks
class StillDraw extends PanelDraw {
  image(x, y, w, h, href, tag = {}) { this.images.push({ x, y, w, h, href, ...tag }); return this; }
}
// A polyline through the points that are not null, broken at each null: one line per run, each carrying its sample
// times (`ts`) so a check can read the drawing back
function runs(xs, ys, ts) {
  const out = [];
  let cur = null;
  for (let i = 0; i < xs.length; i++) {
    if (ys[i] === null || !Number.isFinite(ys[i])) { cur = null; continue; }
    if (!cur) { cur = { pts: [], ts: [] }; out.push(cur); }
    cur.pts.push([xs[i], ys[i]]); cur.ts.push(ts[i]);
  }
  return out;
}
const clampTo = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ---------- one still ----------
// The audio still of one shot (SOUND-PLAN 4.5): the header and its loudness row; the loudness lines; the cue markers at
// their measured onsets; the spectrogram of the mastered mix; the lanes' predicted and measured levels; the pan meter;
// the misses; the legend. Every strip on one time axis (axisOf). `markAt(row)` is where a marker goes, the measured
// onset: passed in only to plant a fault.
export function buildStill(data, { measure, cues = CUES, w = WORLD, markAt = (row) => row.onset } = {}) {
  const { shot, axis, spec, lanes } = data, { X, x0, x1 } = axis, S = STILL, col = shotColor(shot.n);
  const byId = new Map(cues.map((c) => [c.id, c])), lane = personOf(w), misses = missesOf(measure), rows = measure.table.rows;
  const starts = rows.filter((x) => x.onset !== null && markAt(x) >= shot.start && markAt(x) < shot.end).sort((a, b) => markAt(a) - markAt(b) || (a.cue < b.cue ? -1 : 1));
  const carried = rows.filter((x) => !starts.includes(x) && x.t0 < shot.end && Math.max(x.t1, x.end ?? x.t1) > shot.start);
  const loudRow = measure.measures.find((m) => m.id === 'loudness').rows.find((x) => x.shot === shot.n);
  const pred = makePredictor({ cues, w }), place = pred.locAt(shot.start).name;
  const bed = bedOnlyWindows(w).find((b) => b.t0 <= shot.start && shot.end <= b.t1), changes = pred.locations.slice(1).filter((l) => l.t0 > shot.start - 1e-9 && l.t0 < shot.end);
  const silence = measure.measures.find((m) => m.id === 'silence');

  // the marker labels' rows, greedily: each label in the lowest row where it clears the one before it
  const items = [], rowEnds = [];
  for (const x of starts) {
    // a marked cue loses its person's colour to red or violet, so its label names the person
    const c = byId.get(x.cue), ms = misses.get(x.cue) ?? [], bad = ms.filter((m) => m.bar), who = lane(c);
    const str = ms.length ? `${who === 'world' ? '' : `${who} `}${stillLabel(c)}: ${ms.map((m) => m.kind).join(', ')}` : stillLabel(c);
    const wd = textWidth(str, S.small, bad.length ? 700 : 400), xm = X(markAt(x)), right = xm + 3 + wd > x1;
    const a = right ? xm - 3 - wd : xm - 3, z = a + wd;
    let r = rowEnds.findIndex((e) => e + 4 <= a);
    if (r < 0) { r = rowEnds.length; rowEnds.push(z); } else rowEnds[r] = z;
    items.push({ x, c, ms, bad, str, xm, a, right, row: r });
  }
  const labelRows = Math.max(1, rowEnds.length);

  // vertical layout
  const head = wrapText(`${fmtT(shot.start)} to ${fmtT(shot.end)} s (${(shot.end - shot.start).toFixed(0)} s), ${shot.lens} mm, the ${place}. ${starts.length + carried.length} voiced cues sound here: ${starts.length} start in this shot, ${carried.length} started before it (their markers are in the shot they start in).${bed ? ` Bed only (SOUND-PLAN 3.11): ${bed.note}${bed.music ? ', held for music' : ''}.` : ''}${changes.map((l) => ` The place changes to the ${l.name} at ${fmtT(l.t0)} s (blue dashed line).`).join('')}`, S.w - 20, S.body);
  const loudText = loudRow ? `Loudness of the mastered mix (measure.json): momentary ${fmtLufs(loudRow.mMin)} to ${fmtLufs(loudRow.mMax)}, median ${fmtLufs(loudRow.mMedian)}; short-term median ${fmtLufs(loudRow.sMedian)}; the shot integrated ${fmtLufs(loudRow.integrated)} LUFS.` : '';
  const loudLines = wrapText(loudText, S.w - 20, S.text);
  let y = 46 + head.length * 18 + loudLines.length * S.line + 8;
  const yLoud = y + S.title; y = yLoud + S.loud + 6;
  const yBand = y + S.title, yGlyph = yBand + labelRows * S.row + 10; y = yGlyph + S.glyphRow;
  const ySpec = y + S.title; y = ySpec + S.spec + 6;
  const yLanes = y + S.title; y = yLanes + lanes.length * (S.laneHead + S.lane + S.laneGap);
  const yPan = y + S.title; y = yPan + S.pan;
  const yAxis = y; y += S.axis;
  const missRows = starts.flatMap((x) => (misses.get(x.cue) ?? []).map((m) => ({ x, m })));
  const missLines = missRows.length ? missRows.flatMap(({ x, m }) => wrapText(`${x.cue} at ${x.onset.toFixed(3)} s, ${m.text}`, S.w - 34, S.text).map((s, i) => ({ s, i, m }))) : wrapText('None: every cue that starts here is inside its renderer, sync and pan bars, and none is flagged by check 14.', S.w - 34, S.text).map((s, i) => ({ s, i, m: null }));
  const yMiss = y + S.title; y = yMiss + missLines.length * S.line + 10;
  const legend = legendLines(measure);
  const yLegend = y + S.title, H = Math.ceil(yLegend + legendHeight(legend) + 12);
  const d = new StillDraw(S.w, H, { bg: INK.bg });
  const L = makeLabeler(d, { pad: 1 });
  const strip = (yy, h) => d.rect(x0, yy, x1 - x0, h, { fill: INK.box, stroke: INK.grid, sw: 1 });
  const title = (yy, s) => L.fixed(4, yy - 5, s, { size: S.text, weight: 700, fill: INK.text });

  // ---- header
  d.rect(0, 0, 46, 36, { fill: col });
  L.fixed(23, 27, String(shot.n), { size: 24, weight: 700, fill: '#0b1020', anchor: 'middle' });
  L.fixed(56, 27, shot.title, { size: 22, weight: 700, fill: '#fff' });
  head.forEach((s, i) => L.fixed(4, 58 + i * 18, s, { size: S.body, fill: col }));
  loudLines.forEach((s, i) => L.fixed(4, 58 + head.length * 18 + i * S.line, s, { size: S.text, fill: INK.text }));

  // whole seconds: faint lines through every strip, on top of the spectrogram
  const secs = [];
  for (let t = Math.ceil(shot.start); t <= shot.end + 1e-9; t++) secs.push(t);

  // ---- loudness: momentary and short-term of the mastered mix, from measure.json's series, each reading at its
  // window's middle (a meter shows it at the window's end)
  title(yLoud, 'LOUDNESS, LUFS: momentary (400 ms) and short-term (3 s), measured');
  strip(yLoud, S.loud);
  const ly = (v) => yLoud + S.loud - ((clampTo(v, LOUD.lo, LOUD.hi) - LOUD.lo) / (LOUD.hi - LOUD.lo)) * S.loud;
  const target = measure.targetLufs;
  d.line([[x0, ly(target)], [x1, ly(target)]], { stroke: INK.dim, sw: 0.8, dash: [4, 3] });
  L.fixed(x0 - 4, ly(target) + 4, String(target), { size: 11, fill: INK.dim, anchor: 'end' });
  L.fixed(x0 - 4, yLoud + 9, String(LOUD.hi), { size: 11, fill: INK.dim, anchor: 'end' });
  L.fixed(x0 - 4, yLoud + S.loud, String(LOUD.lo), { size: 11, fill: INK.dim, anchor: 'end' });
  for (const [k, sw, stroke, role] of [['shortTerm', 2, '#8fb0ff', 'loud-s'], ['momentary', 1.1, INK.measured, 'loud-m']]) {
    const s = measure.series[k], ts = [], vs = [];
    for (let i = 0; i < s.lufs.length; i++) { const t = s.firstEnd + i * measure.series.hopSec - s.windowSec / 2; if (t >= shot.start && t <= shot.end) { ts.push(t); vs.push(s.lufs[i] === null ? null : ly(s.lufs[i])); } }
    for (const rn of runs(ts.map(X), vs, ts)) d.line(rn.pts, { stroke, sw, role, ts: rn.ts });
  }

  // ---- the cue markers at their measured onsets; a sync miss's bracket to its frame
  title(yBand, `CUES AT THEIR MEASURED ONSETS (${starts.length}), coloured by person`);
  if (bed) hatch(d, x0, yBand, x1 - x0, yGlyph + S.glyphRow - yBand, { bed: bed.note });
  const markers = [], gy = yGlyph + 7;
  for (const it of items) {
    const { x, c, ms, bad, str, xm, a, row } = it, fill = REEL[lane(c)], ink = bad.length ? INK.miss : ms.length ? INK.phone : fill;
    const ty = yGlyph - 8 - row * S.row;
    d.line([[xm, gy - 5], [xm, ty + 3]], { stroke: ink, sw: 0.6, strokeOp: 0.55 });
    L.fixed(it.right ? a + textWidth(str, S.small, bad.length ? 700 : 400) : a, ty, str, { size: S.small, fill: ink, weight: bad.length ? 700 : 400, anchor: it.right ? 'end' : 'start' });
    for (const m of ms.filter((q) => q.kind === 'sync' && q.frame !== null && q.frame !== undefined)) {
      const xf = X(m.frame);
      d.line([[xm, gy + 7], [xf, gy + 7]], { stroke: INK.miss, sw: 1.6, role: 'sync-frame', cue: c.id, t: m.frame });
      d.line([[xf, gy + 3], [xf, gy + 11]], { stroke: INK.miss, sw: 1.6 });
    }
    if (ms.length) d.circle(xm, gy, 7.5, { stroke: ink, sw: 1.8 });
    glyph(d, xm, gy, FAMILY[c.family]?.shape ?? 'dot', 4.5, { fill, stroke: '#0b1020', sw: 1 }, { role: 'marker', cue: c.id, t: markAt(x) });
    markers.push({ cue: c.id, onset: x.onset, t: markAt(x), x: xm, misses: ms.map((m) => m.kind) });
  }

  // ---- the spectrogram of the mastered mix, one column a device pixel
  title(ySpec, 'SPECTROGRAM OF THE MASTERED MIX, measured (log frequency, dB re full scale)');
  d.image(x0, ySpec, x1 - x0, S.spec, `data:image/png;base64,${spectrogramPng(spec).toString('base64')}`, { role: 'spectrogram', t0: spec.t0, t1: spec.t1, cols: spec.cols, rows: spec.rows });
  d.rect(x0, ySpec, x1 - x0, S.spec, { stroke: INK.grid, sw: 1 });
  const fy = (f) => ySpec + S.spec * (1 - Math.log(f / SPEC.fLo) / Math.log(SPEC.fHi / SPEC.fLo));
  for (const f of SPEC.ticks) {
    d.line([[x0 - 3, fy(f)], [x0, fy(f)]], { stroke: INK.dim, sw: 1 });
    L.fixed(x0 - 5, fy(f) + 4, f >= 1000 ? `${f / 1000}k` : String(f), { size: 11, fill: INK.dim, anchor: 'end' });
  }
  for (const [f, s] of [[250, '250 Hz: check 14'], [PHONE_SPEAKER.highpassHz, `${PHONE_SPEAKER.highpassHz} Hz: the phone's high-pass`]]) {
    d.line([[x0, fy(f)], [x1, fy(f)]], { stroke: INK.phone, sw: 0.9, dash: [5, 3], strokeOp: 0.85 });
    const it = { k: 'text', x: x1 - 3, y: fy(f) - 3, str: s, size: 11, fill: INK.phone, anchor: 'end' };
    d.rect(x1 - 5 - textWidth(s, 11), fy(f) - 13, textWidth(s, 11) + 4, 12, { fill: '#000004', fillOp: 0.6 });
    d.add(it);
  }

  // ---- the lanes: predicted envelope, measured line, the background playing, each cue's loudest window
  title(yLanes, 'LEVEL, dB OVER THE STREET BACKGROUND: white measured, colour predicted');
  const tsAll = axis.ts, xs = tsAll.map(X), levelDots = [];
  lanes.forEach((ln, k) => {
    const top = yLanes + k * (S.laneHead + S.lane + S.laneGap) + S.laneHead, bot = top + S.lane, dy = (db) => bot - ((clampTo(db, DB.lo, DB.hi) - DB.lo) / (DB.hi - DB.lo)) * S.lane;
    strip(top, S.lane);
    d.line([[x0, dy(0)], [x1, dy(0)]], { stroke: '#5d6a8a', sw: 0.8 });
    L.fixed(x0 - 4, dy(0) + 4, '0', { size: 11, fill: INK.dim, anchor: 'end' });
    L.fixed(x0 - 4, top + 9, fmtDb(DB.hi), { size: 11, fill: INK.dim, anchor: 'end' });
    L.fixed(x0 - 4, bot, String(DB.lo), { size: 11, fill: INK.dim, anchor: 'end' });
    d.line(xs.map((x, i) => [x, dy(data.background[i])]), { stroke: INK.dim, sw: 0.8, dash: [4, 4], strokeOp: 0.8, role: 'background', lane: ln.key, ts: tsAll });
    for (const rn of runs(xs, ln.predicted.map((v) => (v === null ? null : dy(v))), tsAll)) {
      const pts = rn.pts.length > 1 ? rn.pts : [...rn.pts, [rn.pts[0][0] + 1, rn.pts[0][1]]];
      d.poly([...pts, [pts[pts.length - 1][0], bot], [pts[0][0], bot]], { fill: ln.colour, fillOp: 0.33, stroke: ln.colour, sw: 1, role: 'level-predicted', lane: ln.key, ts: rn.ts });
    }
    for (const rn of runs(xs, ln.measured.map((v) => (v === null ? null : dy(v))), tsAll)) d.line(rn.pts, { stroke: INK.measured, sw: 1.3, role: 'level-measured', lane: ln.key, ts: rn.ts });
    for (const x of rows.filter((r) => ln.groups.includes(r.group) && r.levelT !== null && r.levelT + WINDOW / 2 >= shot.start && r.levelT + WINDOW / 2 < shot.end)) {
      const t = x.levelT + WINDOW / 2, xx = X(t);
      if (x.predictedDb !== null) d.circle(xx, dy(x.predictedDb), 3.2, { stroke: ln.colour, sw: 1.3, role: 'level-dot-predicted', cue: x.cue, t });
      d.circle(xx, dy(x.overStreetDb), 2, { fill: INK.measured, role: 'level-dot', cue: x.cue, t });
      levelDots.push({ cue: x.cue, t, measured: x.overStreetDb, predicted: x.predictedDb });
      if (x.predictedDb !== null && Math.abs(x.overStreetDb - x.predictedDb) >= 1) L.place(xx, dy(x.overStreetDb), `${fmtDb(x.overStreetDb - x.predictedDb)}`, { size: 11, fill: INK.measured }, { r: 3, cands: [[4, -6, 'e'], [-4, -6, 'w'], [4, 8, 'e'], [-4, 8, 'w']], leader: false, chip: true });
    }
    // the lane's name over it, and how far its cues' measured loudest 100 ms are from their predictions
    const diffs = rows.filter((r) => ln.groups.includes(r.group) && r.levelT !== null && r.predictedDb !== null && r.levelT + WINDOW / 2 >= shot.start && r.levelT + WINDOW / 2 < shot.end).map((r) => r.overStreetDb - r.predictedDb);
    L.fixed(x0, top - 4, ln.label, { size: S.text, weight: 700, fill: ln.colour });
    if (diffs.length) L.fixed(x0 + textWidth(ln.label, S.text, 700) + 8, top - 4, `measured minus predicted, ${diffs.length} cue${diffs.length > 1 ? 's' : ''}: ${diffs.length > 1 ? `${fmtDb(Math.min(...diffs))} to ${fmtDb(Math.max(...diffs))}` : fmtDb(diffs[0])} dB`, { size: S.text, fill: INK.text });
  });

  // ---- the pan meter: left at the top (round 04's lanes), the balance on the spatializer's equal-power scale
  title(yPan, 'PAN, LEFT AT THE TOP: white line the mix, measured; cues filled measured, hollow predicted');
  strip(yPan, S.pan);
  const py = (db) => yPan + ((panOfBalance(db) + 1) / 2) * S.pan;
  for (const db of [-20, -10, -3, 0, 3, 10, 20]) d.line([[x0, py(db)], [x1, py(db)]], { stroke: db === 0 ? '#5d6a8a' : INK.grid, sw: 0.8, dash: db === 0 || Math.abs(db) === 10 ? undefined : [2, 3] });
  for (const [db, s] of [[-10, 'L 10'], [0, '0 dB'], [10, 'R 10']]) L.fixed(x0 - 4, py(db) + 4, s, { size: 11, fill: INK.dim, anchor: 'end' });
  for (const rn of runs(xs, data.balance.map((v) => (v === null ? null : py(v))), tsAll)) d.line(rn.pts, { stroke: INK.measured, sw: 1.1, role: 'pan-mix', ts: rn.ts });
  const panRows = new Map(measure.measures.find((m) => m.id === 'pan').rows.map((x) => [x.cue, x]));
  for (const x of rows.filter((r) => byId.get(r.cue)?.place && r.t0 < shot.end && r.t1 > shot.start)) {
    const p = panRows.get(x.cue);
    if (!p) continue;
    const c = byId.get(x.cue), t = (Math.max(x.t0, shot.start) + Math.min(x.t1, shot.end)) / 2, xx = X(t), fill = REEL[lane(c)], off = p.ok === false;
    d.circle(xx, py(p.predictedDb), 3.6, { stroke: off ? INK.miss : fill, sw: 1.3, role: 'pan-predicted', cue: x.cue, t });
    d.circle(xx, py(p.balanceDb), 2.1, { fill: off ? INK.miss : fill, role: 'pan-measured', cue: x.cue, t });
  }

  // ---- the time axis and the whole seconds through every strip
  for (const t of secs) {
    d.line([[X(t), yLoud], [X(t), yPan + S.pan]], { stroke: '#ffffff', strokeOp: 0.09, sw: 1 });
    d.line([[X(t), yAxis], [X(t), yAxis + 5]], { stroke: INK.dim, sw: 1 });
    if (axis.pxPerSec >= 36 || (t - Math.ceil(shot.start)) % 2 === 0) L.fixed(X(t), yAxis + 18, String(t), { size: S.small, fill: INK.dim, anchor: t === shot.start ? 'start' : t === shot.end ? 'end' : 'middle' });
  }
  // the place change, through each strip (not over the titles between them)
  for (const l of changes) {
    for (const [a, b] of [[yLoud, yLoud + S.loud], [yBand, yGlyph + S.glyphRow], [ySpec, ySpec + S.spec], [yLanes, yLanes + lanes.length * (S.laneHead + S.lane + S.laneGap)], [yPan, yPan + S.pan]]) d.line([[X(l.t0), a], [X(l.t0), b]], { stroke: '#8fb0ff', sw: 2, dash: [6, 4], place: l.name });
  }

  // ---- the misses, by name
  title(yMiss, 'OFF THEIR BAR IN THIS SHOT (red), FLAGGED BY CHECK 14 (violet): measure.json');
  missLines.forEach(({ s, i, m }, k) => L.fixed(i ? 22 : 8, yMiss + 6 + k * S.line, s, { size: S.text, fill: m === null ? INK.text : m.bar ? INK.miss : INK.phone }));

  // ---- the legend
  title(yLegend, 'WHAT IS MEASURED AND WHAT IS PREDICTED');
  drawLegend(d, L, legend, yLegend);
  return { d, shot, axis, height: H, markers, carried: carried.map((x) => x.cue), lanes: lanes.map((ln) => ({ key: ln.key, groups: ln.groups })), levelDots, bed: bed ? bed.note : null, silence: silence.status, labeler: L };
}
const fmtLufs = (v) => (v === null || v === undefined ? 'none' : v.toFixed(1));

// The legend's lines: [{ kind, text }], kind 'measured', 'predicted', 'spec' or 'marks'
function legendLines(measure) {
  return [
    { kind: 'measured', text: `MEASURED, white and solid, or a filled mark. The spectrogram and the white pan line: the mastered mix (${measure.targetLufs} LUFS, the render). The white level lines: each lane's stems before the master, in ${WINDOW * 1000} ms windows centred on each point, over the street background measured the same way (measure.json streetDb, ${measure.streetDb} dB, is 0 here). Filled dots: measure.json's level (each cue's loudest ${WINDOW * 1000} ms) and pan (its balance over its span). Cue glyphs: measure.json table.onset. Loudness: measure.json series.` },
    { kind: 'predicted', text: 'PREDICTED, the lane\'s colour, translucent or hollow, or dashed. The envelopes: cues.js through the storyboard\'s rule (makePredictor, round 04\'s timeline), power-summed in a lane. Hollow rings: measure.json predictedDb and the predicted balance (spatial.js under each cue\'s law). Dashed grey: the background playing.' },
    { kind: 'spec', text: `Spectrogram: a ${SPEC.size}-sample Hann window centred on each pixel column, the two channels' power averaged, dB against a full-scale sine; rows log-spaced from ${SPEC.fLo} Hz to ${SPEC.fHi / 1000} kHz, each its band's loudest bin. Colour in ${SPEC.step} dB steps:` },
    { kind: 'marks', text: 'A number by a dot: measured minus predicted, where they differ by 1 dB or more. Red: off its bar (the renderer\'s onset, sync with its frame, or pan); the red bracket runs from the onset to the frame that shows its event. Violet: flagged by check 14 (phone and mono). Glyph shapes are the families\' (round 04); A orange, B blue, the night and the car white (the reel\'s).' },
  ].map((x) => ({ ...x, lines: wrapText(x.text, STILL.w - 40, STILL.text) }));
}
const legendHeight = (legend) => legend.reduce((s, x) => s + x.lines.length * STILL.line + 6, 0) + 40;
function drawLegend(d, L, legend, y0) {
  let y = y0 + 6;
  for (const x of legend) {
    const sx = 8;
    if (x.kind === 'measured') { d.line([[sx, y - 4], [sx + 18, y - 4]], { stroke: INK.measured, sw: 1.6 }); d.circle(sx + 9, y + 8, 2.2, { fill: INK.measured }); }
    if (x.kind === 'predicted') { d.poly([[sx, y + 2], [sx + 18, y + 2], [sx + 18, y - 8], [sx + 9, y - 4], [sx, y - 6]], { fill: FAMILY.door.color, fillOp: 0.33, stroke: FAMILY.door.color, sw: 1 }); d.circle(sx + 9, y + 10, 3.2, { stroke: FAMILY.door.color, sw: 1.3 }); }
    if (x.kind === 'marks') { d.circle(sx + 9, y - 4, 6, { stroke: INK.miss, sw: 1.8 }); glyph(d, sx + 9, y - 4, 'dot', 3.5, { fill: REEL.A, stroke: '#0b1020' }); }
    x.lines.forEach((s, i) => L.fixed(32, y + i * STILL.line, s, { size: STILL.text, fill: x.kind === 'measured' ? '#ffffff' : INK.text }));
    y += x.lines.length * STILL.line + 6;
    if (x.kind === 'spec') {
      const n = Math.round((SPEC.hi - SPEC.lo) / SPEC.step), bw = (STILL.w - 120) / (n + 1);
      for (let q = -1; q < n; q++) { const [r, g, b] = specColour(SPEC.lo + (q + 0.5) * SPEC.step); d.rect(32 + (q + 1) * bw, y - 6, bw + 0.3, 12, { fill: `rgb(${r},${g},${b})` }); }
      L.fixed(32, y + 20, `under ${SPEC.lo}`, { size: 11, fill: INK.dim });
      L.fixed(32 + (n + 1) * bw, y + 20, `${SPEC.hi} dB and over`, { size: 11, fill: INK.dim, anchor: 'end' });
      y += 40;
    }
  }
}

// ---------- the checks the tests run on a still ----------
// Every strip on the still's one time axis: each line's points at X of its sample times, each marker and dot at X of
// its time, the spectrogram from X(t0) to X(t1) with one column a device pixel; within half a device pixel. Returns
// the problems.
export function axisProblems(still) {
  const { axis } = still, tol = 0.5 / axis.scale + 1e-9, p = [];
  for (const it of still.d.items) {
    if (it.ts && it.pts) {
      const pts = it.k === 'poly' ? it.pts.slice(0, it.ts.length) : it.pts;
      pts.forEach((q, i) => { if (Math.abs(q[0] - axis.X(it.ts[i])) > tol) p.push(`${it.role}${it.lane ? ` ${it.lane}` : ''}: point ${i} at x ${q[0]}, its time ${it.ts[i]} maps to ${axis.X(it.ts[i])}`); });
    } else if (it.role && it.t !== undefined) {
      const x = it.cx ?? (it.k === 'line' ? it.pts[1][0] : it.x);
      if (Math.abs(x - axis.X(it.t)) > tol) p.push(`${it.role} ${it.cue ?? ''}: at x ${x}, its time ${it.t} maps to ${axis.X(it.t)}`);
    }
  }
  const im = still.d.images.find((x) => x.role === 'spectrogram');
  if (!im) p.push('no spectrogram');
  else {
    if (Math.abs(im.x - axis.X(im.t0)) > tol || Math.abs(im.x + im.w - axis.X(im.t1)) > tol) p.push(`the spectrogram spans x ${im.x} to ${im.x + im.w}, its times ${im.t0} to ${im.t1} map to ${axis.X(im.t0)} to ${axis.X(im.t1)}`);
    if (im.cols !== Math.round(im.w * axis.scale)) p.push(`the spectrogram has ${im.cols} columns over ${im.w * axis.scale} device pixels`);
  }
  return p;
}
// Every cue that starts in the shot (measure.json table.onset in [start, end)) has one marker, at X(onset) within half
// a device pixel, and no other cue has one
export function markerProblems(still, measure) {
  const { axis, shot } = still, tol = 0.5 / axis.scale + 1e-9, p = [], marks = new Map();
  for (const it of still.d.items.filter((x) => x.role === 'marker')) { if (marks.has(it.cue)) p.push(`${it.cue}: two markers`); marks.set(it.cue, it); }
  for (const x of measure.table.rows) {
    const inShot = x.onset !== null && x.onset >= shot.start && x.onset < shot.end, it = marks.get(x.cue);
    if (inShot && !it) p.push(`${x.cue}: no marker (onset ${x.onset})`);
    if (!inShot && it) p.push(`${x.cue}: a marker, but its onset ${x.onset} is not in shot ${shot.n}`);
    if (inShot && it && Math.abs(it.cx - axis.X(x.onset)) > tol) p.push(`${x.cue}: marker at x ${it.cx}, its measured onset ${x.onset} maps to ${axis.X(x.onset)}`);
  }
  return p;
}

// ---------- the arrangement ----------
// The arrangement's header height: the title, the source line and the legend's two columns over round 04's lanes
const ARR_HEADER_H = 330;
// The arrangement sheet: round 04's timeline (lanesOf, TL, DB, colours, the predicted envelopes and onset ticks, the
// bed-only windows, the place change; the pan lines left out), with the measurements drawn over it: each voice group's
// measured level (`envelopes`: Map(group, { ts, db }), dB over the street background, null where silent), every voiced
// cue's measured onset, the misses and the flags, and the mastered mix's loudness along the bottom.
export function buildArrangement({ measure, envelopes, cues = CUES, w = WORLD, markAt = (row) => row.onset }) {
  const header = { height: ARR_HEADER_H, draw: (d, L, ctx) => arrangementHeader(d, L, ctx, measure) };
  const tl = buildTimeline({ cues, w, header, pan: false });
  const { d, lanes, X, dbY } = tl, lane = personOf(w), misses = missesOf(measure), byId = new Map(cues.map((c) => [c.id, c]));
  const L = makeLabeler(d, { pad: 1 });
  L.boxes.push(...tl.labeler.boxes);
  // the measured level of each lane: white over the predicted envelope
  for (const ln of lanes) {
    const e = envelopes.get(ln.source);
    if (!e) continue;
    for (const rn of runs(e.ts.map(X), e.db.map((v) => (v === null ? null : dbY(ln, v))), e.ts)) d.line(rn.pts, { stroke: INK.measured, sw: 1.1, strokeOp: 0.95, role: 'measured-level', lane: ln.source, ts: rn.ts });
  }
  // every voiced cue's measured onset: a filled triangle in the reel's colour, its tip on the lane's floor
  const markers = [];
  for (const x of measure.table.rows) {
    const ln = lanes.find((l) => l.source === x.group), c = byId.get(x.cue);
    if (!ln || !c || x.onset === null) continue;
    const t = markAt(x), xm = X(t), y = ln.envBot, ms = misses.get(x.cue) ?? [], bad = ms.filter((m) => m.bar);
    d.poly([[xm, y], [xm + 3.5, y + 7], [xm - 3.5, y + 7]], { fill: REEL[lane(c)], stroke: '#0b1020', sw: 0.8, role: 'measured-onset', cue: x.cue, t, cx: xm });
    markers.push({ cue: x.cue, lane: x.group, onset: x.onset, t, x: xm, misses: ms.map((m) => m.kind) });
    if (!ms.length) continue;
    const ink = bad.length ? INK.miss : INK.phone;
    d.circle(xm, y + 3, 8, { stroke: ink, sw: 1.8 });
    d.line([[xm, ln.envTop], [xm, y]], { stroke: ink, sw: 1, strokeOp: 0.7 });
    for (const m of ms.filter((q) => q.kind === 'sync' && q.frame !== null && q.frame !== undefined)) d.line([[xm, y + 12], [X(m.frame), y + 12]], { stroke: INK.miss, sw: 2 });
    L.place(xm, y + 3, ms.map((m) => m.text.replace(/^sync: /, 'sync ').replace(/^phone and mono: /, 'phone: ')).join('; '), { size: 11, weight: 700, fill: ink }, { r: 9, cands: [[11, 0, 'e'], [11, 12, 'e'], [-11, 0, 'w'], [11, -12, 'e'], [-11, 12, 'w'], [11, 24, 'e'], [-11, -12, 'w'], [-11, 24, 'w'], [11, -24, 'e'], [-11, -24, 'w']], leader: false, chip: true });
  }
  // the silence windows: what measure.json's silence measure found inside each
  const sil = measure.measures.find((m) => m.id === 'silence');
  for (const b of bedOnlyWindows(w)) {
    const r = sil.rows.find((x) => x.group === null && Math.abs(x.t0 - b.t0) < 1e-6 && Math.abs(x.t1 - b.t1) < 1e-6);
    L.place(X(b.t0) + 3, tl.top + 28, r ? `measured: ${r.onsets} onset${r.onsets === 1 ? '' : 's'} inside (measure.json silence)` : 'not measured', { size: 11, fill: r && r.onsets === 0 ? '#ffffff' : INK.miss }, { cands: [[0, 0, 'e'], [0, 13, 'e']], leader: false });
  }
  // the mastered mix's loudness along the bottom
  const y0 = tl.bottom + 50, h = 120, ly = (v) => y0 + h - ((clampTo(v, LOUD.lo, LOUD.hi) - LOUD.lo) / (LOUD.hi - LOUD.lo)) * h;
  d.h = y0 + h + 40;
  L.fixed(16, y0 - 14, 'LOUDNESS OF THE MASTERED MIX, measured (measure.json series): momentary (400 ms) white, short-term (3 s) blue, LUFS, each reading at its window\'s middle', { size: 12, weight: 700, fill: '#8794b3' });
  d.rect(TL.left, y0, w.T_TOTAL * TL.pxPerS, h, { fill: INK.box, stroke: INK.grid, sw: 1 });
  for (const s of w.SHOTS) d.line([[X(s.start), y0], [X(s.start), y0 + h]], { stroke: shotColor(s.n), strokeOp: 0.35, sw: 1 });
  for (const v of [LOUD.hi, -20, measure.targetLufs, -30, -40, LOUD.lo]) {
    d.line([[TL.left, ly(v)], [TL.left + w.T_TOTAL * TL.pxPerS, ly(v)]], { stroke: v === measure.targetLufs ? INK.dim : INK.grid, sw: 0.8, dash: v === measure.targetLufs ? [4, 3] : undefined });
    L.fixed(TL.left - 6, ly(v) + 4, `${v}${v === measure.targetLufs ? ' (target)' : ''}`, { size: 11, fill: INK.dim, anchor: 'end' });
  }
  for (const [k, sw, stroke, role] of [['shortTerm', 1.8, '#8fb0ff', 'loud-s'], ['momentary', 1, INK.measured, 'loud-m']]) {
    const s = measure.series[k], ts = s.lufs.map((_, i) => s.firstEnd + i * measure.series.hopSec - s.windowSec / 2);
    for (const rn of runs(ts.map(X), s.lufs.map((v) => (v === null ? null : ly(v))), ts)) d.line(rn.pts, { stroke, sw, role, ts: rn.ts });
  }
  return { d, lanes, markers, X, timeline: tl, labeler: L };
}

// The arrangement's header: the title, what it is, and one legend in two columns, predicted on the left (round 04's
// key glyphs), measured on the right
function arrangementHeader(d, L, { cues, lanes, pred }, measure) {
  L.fixed(24, 40, 'Snow, Lamp, Bridge: the arrangement, measured over predicted (round 05)', { size: 26, weight: 700, fill: '#fff' });
  L.fixed(24, 66, `Round 04's cue timeline (every cue in src/audio/cues.js, ${cues.length}, one lane per voice group, ${lanes.length}, the same scale and colours) with the blockout's measurements over it: ${measure.voiced} voiced cues, ${measure.groups.length} voice groups (measure.json, review round ${measure.round}).`, { size: 14, fill: '#8794b3' });
  L.fixed(24, 88, `Time runs left to right, ${TL.pxPerS} px a second from x ${TL.left} px. Levels on the level plan's scale, ${DB.lo} dB at a lane's floor to ${fmtDb(DB.hi)} dB at its top, 0 the street background (predicted ${fmtDb(pred.bg.street)} dB, measured ${measure.streetDb} dB before the master).`, { size: 14, fill: '#8794b3' });
  const col = (x, y, head, rows) => {
    L.fixed(x, y, head, { size: 14, weight: 700, fill: head.startsWith('MEASURED') ? '#ffffff' : '#c9d4ee' });
    rows.forEach(([draw, s], i) => { const yy = y + 24 + i * 18; draw(x, yy); L.fixed(x + 42, yy, s, { size: 12, fill: '#c9d4ee' }); });
  };
  col(24, 124, 'PREDICTED (cues.js through the storyboard\'s rule: round 04, unchanged)', [
    [(x, y) => keyGlyph(d, 'env', x, y), 'Filled envelope: the predicted level; dashed line: the background playing.'],
    [(x, y) => keyGlyph(d, 'tick', x, y), 'Tick and label: a cue\'s time in cues.js (its t0). Dashed: offered and off.'],
    [(x, y) => keyGlyph(d, 'mod', x, y), 'Dashed box: a modifier, with no voice of its own (its line its track).'],
    [(x, y) => keyGlyph(d, 'bar', x, y), 'Bar under the lane: in frame and seen; outlined: in frame but hidden.'],
    [(x, y) => keyGlyph(d, 'bed', x, y), 'Hatched: the bed-only windows (SOUND-PLAN 3.11), no hard or foley onset.'],
    [(x, y) => d.line([[x, y - 12], [x, y + 2]], { stroke: '#8fb0ff', sw: 2.5, dash: [6, 4] }), 'Blue dashed line: the place changes, street to bridge.'],
  ]);
  col(1200, 124, 'MEASURED (measure.json and the stems, before the master)', [
    [(x, y) => d.line([[x, y - 4], [x + 30, y - 8]], { stroke: INK.measured, sw: 1.4 }), `White line: the voice group's stem, ${WINDOW * 1000} ms windows centred on each point, on the same scale.`],
    [(x, y) => d.poly([[x + 15, y - 9], [x + 18.5, y - 2], [x + 11.5, y - 2]], { fill: REEL.A, stroke: '#0b1020', sw: 0.8 }), 'Filled triangle: the measured onset (table.onset, the first sample of the cue rendered alone); A orange, B blue, the night and the car white.'],
    [(x, y) => { d.circle(x + 15, y - 5, 7, { stroke: INK.miss, sw: 1.8 }); d.line([[x + 15, y + 2], [x + 30, y + 2]], { stroke: INK.miss, sw: 2 }); }, 'Red ring, named: off its bar (sync with its frame, pan, the renderer\'s onset); the red line runs to the frame that shows the event.'],
    [(x, y) => d.circle(x + 15, y - 5, 7, { stroke: INK.phone, sw: 1.8 }), 'Violet ring, named: flagged by check 14 on the measured bands (phone and mono).'],
    [(x, y) => d.line([[x, y - 4], [x + 30, y - 4]], { stroke: '#8fb0ff', sw: 1.8 }), 'Along the bottom: the mastered mix\'s momentary (white) and short-term (blue) loudness, LUFS.'],
    [() => {}, 'Under each bed-only window\'s name: the onsets measure.json\'s silence measure found inside it.'],
  ]);
}

// Every voiced cue (measure.json table) has one measured onset on the arrangement, in its own lane, at X(onset) within
// half a pixel; and every cue of the catalogue keeps its predicted tick
export function arrangementProblems(arr, measure, cues = CUES) {
  const p = [], tol = 0.5 + 1e-9, got = new Map();
  for (const it of arr.d.items.filter((x) => x.role === 'measured-onset')) { if (got.has(it.cue)) p.push(`${it.cue}: two measured onsets`); got.set(it.cue, it); }
  for (const x of measure.table.rows) {
    const it = got.get(x.cue);
    if (!it) { p.push(`${x.cue}: no measured onset`); continue; }
    if (Math.abs(it.cx - arr.X(x.onset)) > tol) p.push(`${x.cue}: measured onset at x ${it.cx}, its onset ${x.onset} maps to ${arr.X(x.onset)}`);
    const ln = arr.lanes.find((l) => l.source === x.group);
    if (!ln || Math.abs(it.pts[0][1] - ln.envBot) > 1e-9) p.push(`${x.cue}: not on its lane ${x.group}`);
  }
  for (const id of got.keys()) if (!measure.table.rows.some((x) => x.cue === id)) p.push(`${id}: a measured onset for a cue measure.json does not have`);
  const ticks = new Set(arr.d.items.filter((x) => x.role === 'onset').map((x) => x.cue));
  for (const c of cues) if (!ticks.has(c.id)) p.push(`${c.id}: no predicted tick`);
  return p;
}

// ---------- stills.json and the contact sheet ----------
// stills.json's entry for a still: its files, shot, time span, the pixel mapping of the PNG (x of time t is x0 + (t -
// t0) * pxPerSec, in device pixels), and every marker's cue, measured onset and drawn x (device pixels)
export function stillEntry(still, { png, svg }) {
  const { axis, shot } = still, k = axis.scale;
  return {
    shot: shot.n, title: shot.title, lens: shot.lens, file: png, svg, t0: shot.start, t1: shot.end, width: STILL.w * k, height: Math.round(still.height * k), scale: k,
    x0: axis.x0 * k, pxPerSec: Number((axis.pxPerSec * k).toFixed(6)), lanes: still.lanes, bedOnly: still.bed, carried: still.carried,
    markers: still.markers.map((m) => ({ cue: m.cue, onset: m.onset, x: Number((m.x * k).toFixed(3)), misses: m.misses })),
  };
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// The contact sheet (review/round-NN/contact-sheet.html): the arrangement, the 15 stills, measure.json's entries as
// tables (status, bar, source, summary; the rows collapsed), then the listening stems and the decision clips. Its only
// outside files are its images and the linked media, all beside it.
export function contactSheetHtml({ measure, stills, stems, decisions }) {
  const cell = (v) => (v === null || v === undefined ? '' : typeof v === 'boolean' ? (v ? 'yes' : 'no') : typeof v === 'number' ? (Number.isInteger(v) ? String(v + 0) : String(v)) : esc(v));
  const table = (m) => `<details><summary>${m.rows.length} row${m.rows.length === 1 ? '' : 's'}</summary><div class="scroll"><table><tr>${m.columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr>${m.rows.map((r) => `<tr>${m.columns.map((c) => `<td>${cell(r[c])}</td>`).join('')}</tr>`).join('')}</table></div></details>`;
  const entries = measure.measures.slice().sort((a, b) => a.n - b.n).map((m) => `<section class="entry" id="m-${esc(m.id)}"><h3>${m.n}. ${esc(m.name)} <span class="chip ${esc(m.status)}">${esc(m.status)}</span></h3>
<p><b>Bar:</b> ${esc(m.bar)}${m.starting ? ' <span class="dim">(a starting value)</span>' : ''}</p><p><b>Source:</b> ${esc(m.source)}</p><p class="summary">${esc(m.summary)}</p>${table(m)}</section>`).join('\n');
  const cards = stills.map((s) => `<figure style="--c:${shotColor(s.shot)}"><a href="${esc(s.file)}"><img src="${esc(s.file)}" alt="Audio still, shot ${s.shot}"></a><figcaption><b>${s.shot}</b> ${esc(s.title)}: ${fmtT(s.t0)} to ${fmtT(s.t1)} s, ${s.markers.length} onsets${s.markers.some((m) => m.misses.length) ? `, ${s.markers.filter((m) => m.misses.length).length} marked` : ''}</figcaption></figure>`).join('\n');
  const stemList = stems.bodies.map((b) => `<li><a href="stems/${esc(b.file)}">stems/${esc(b.file)}</a>: ${b.cues.length} cues, ${b.lufs} LUFS (float), ${(b.bytes / 1e6).toFixed(2)} MB</li>`).join('');
  const clipList = decisions.options.filter((o) => o.clips?.length).map((o) => `<li><b>${esc(o.id)}</b>: ${esc(o.question)}<ul>${o.clips.map((c) => { const f = c.file.replace(/^review\/round-\d+\//, ''); return `<li><a href="${esc(f)}">${esc(f)}</a> (${c.seconds} s)</li>`; }).join('')}</ul></li>`).join('');
  const counts = ['pass', 'fail', 'report'].map((k) => `${measure.measures.filter((m) => m.status === k).length} ${k}`).join(', ');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Blockout Audio Stills</title>
<style>
:root { color-scheme: dark; --bg:#080c16; --fg:#e8eefc; --dim:#8794b3; --line:#1d2740; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.5 Helvetica, Arial, sans-serif; }
main { max-width: 1500px; margin: 0 auto; padding: 24px 16px 64px; }
h1 { font-size: 28px; margin: 0 0 4px; } h2 { font-size: 20px; margin: 36px 0 12px; border-bottom: 1px solid var(--line); padding-bottom: 6px; }
h3 { font-size: 16px; margin: 18px 0 6px; }
p, li { color: #c9d4ee; max-width: 100ch; } p, li, h1, h2, h3, td { overflow-wrap: anywhere; } .dim { color: var(--dim); }
img { display: block; width: 100%; height: auto; background: #0d1320; }
.grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(min(100%, 460px), 1fr)); }
figure { margin: 0; border: 1px solid var(--line); border-top: 4px solid var(--c); border-radius: 4px; overflow: hidden; }
figcaption { padding: 6px 10px; font-size: 14px; color: #c9d4ee; }
table { border-collapse: collapse; width: 100%; font-size: 12px; margin: 8px 0 16px; } th, td { text-align: left; padding: 3px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { color: var(--dim); font-weight: 600; position: sticky; top: 0; background: var(--bg); }
.scroll { overflow: auto; max-height: 32em; }
details summary { cursor: pointer; color: #9db4ff; }
.chip { display: inline-block; padding: 1px 9px; border-radius: 10px; font-size: 12px; font-weight: 700; vertical-align: 2px; color: #0b1020; }
.chip.pass { background: #6fe39a; } .chip.fail { background: #ff6b6b; } .chip.report { background: #8fb0ff; }
.entry { border-top: 1px solid var(--line); } .summary { color: var(--fg); }
a { color: #9db4ff; }
</style></head><body><main>
<h1>Snow, Lamp, Bridge: blockout round ${esc(measure.round)}, the audio stills</h1>
<p class="dim">Sound 2.9: pictures of sound for the review panel, made by <code>node scripts/sound-review.js --round ${esc(measure.round)} --stills --sheet</code> from <code>measure.json</code>, the voice groups' stems and the mastered mix (the ${esc(measure.stage)} stage, ${esc(measure.parked.join(', ') || 'nothing')} parked, ${measure.targetLufs} LUFS). On every image white and solid, or a filled mark, is measured; the lane's colour, translucent, hollow or dashed, is predicted. Stills are 1200 px wide; open one for its full size.</p>
<h2>The arrangement</h2>
<p>The whole film as round 04's cue timeline, with the measured onsets, levels, misses and flags over the predicted ones, and the mix's loudness along the bottom.</p>
<a href="arrangement.png"><img src="arrangement.png" alt="The arrangement sheet"></a>
<h2>The audio stills, one per shot</h2>
<p class="dim">Each: the shot's loudness, its cues at their measured onsets, the spectrogram of the mastered mix, predicted against measured level per voice group (or per body), the pan meter, the misses by name and the legend. stills.json gives each still's time to pixel mapping and every marker's x.</p>
<div class="grid">
${cards}
</div>
<h2>measure.json: the ${measure.measures.length} measures</h2>
<p>${counts}. The rows are collapsed; open a table to read them.</p>
${entries}
<h2>Listening stems</h2>
<p class="dim">One per body at the mastered mix's own gain, AAC ${esc(stems.bitrate)} (stems/stems.json).</p>
<ul>${stemList}</ul>
<h2>Decision clips</h2>
<p class="dim">Sound 2.12 (decisions/decisions.json).</p>
<ul>${clipList}</ul>
</main></body></html>
`;
}
