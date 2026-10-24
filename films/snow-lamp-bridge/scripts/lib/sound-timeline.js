// Sound storyboard, part 2: the cue timeline, drawn like a DAW arrangement (SOUND-PLAN.md 4.3). One lane per voice group
// (a cue's `source`), the shots as columns in the picture's shot colours. In each lane: the predicted level at the camera
// as an envelope's height in dB against the place's background (makePredictor, the one rule), the pan as a thin line
// (left at the top), the spans where the source is in frame as a bar under the lane, every onset as a tick with a label.
// Over all lanes: the bed-only windows of SOUND-PLAN 3.11, the ones held for music, and the place change.
// Every onset tick carries its cue id (`cue`, role 'onset'), so a test can count each cue on the drawing itself.
import { Draw } from './draw.js';
import { shotColor } from './map.js';
import { makeCamera } from './math.js';
import { CUES, WORLD } from '../../src/audio/cues.js';
import { makePredictor, makeLabeler, colorOf, voiced, fmtT, fmtDb, wrapText, RULE_TEXT, PERSON, FAMILY } from './sound-map.js';

// SOUND-PLAN 3.11: the bed-only windows, by shot. No hard-effect or foley onset inside them; the backgrounds and the
// story ambiences go on. Two are held for music (the score fills them later).
export const BED_ONLY = [
  { shots: [1, 2], note: 'the hush before the car' },
  { shots: [10], note: 'moonrise', music: true },
  { shots: [12], note: 'B looks' },
  { shots: [15], note: 'the final wide', music: true },
];
export function bedOnlyWindows(w = WORLD) {
  return BED_ONLY.map((b) => { const ss = w.SHOTS.filter((s) => b.shots.includes(s.n)); return { ...b, t0: ss[0].start, t1: ss[ss.length - 1].end }; });
}

// The frame's aspect from the lens tables (tan of the half angles), so in-frame tests need no resolution.
export function frameSize(w = WORLD, H = 540) {
  const a = Math.tan((w.hfovDeg(50) * Math.PI) / 360) / Math.tan((w.vfovDeg(50) * Math.PI) / 360);
  return { W: Math.round(H * a), H };
}
// Is world point p inside the frame at t: in front of the camera of the shot playing then, and within its edges.
export function inFrame(w, p, t, F = frameSize(w)) {
  const q = makeCamera(w.cameraAt(w.shotAt(t), t), F.W, F.H).project(p);
  return !!q && q[0] >= 0 && q[0] <= F.W && q[1] >= 0 && q[1] <= F.H;
}

// The lanes: one per source (voice group), backgrounds first, then hard effects, then foley, each by its first onset.
const CAT_ORDER = { bg: 0, hard: 1, foley: 2 };
export function lanesOf(cues) {
  const by = new Map();
  for (const c of cues) { if (!by.has(c.source)) by.set(c.source, []); by.get(c.source).push(c); }
  return [...by.entries()].map(([source, cs]) => ({ source, cues: cs.slice().sort((a, b) => a.t0 - b.t0), category: cs[0].category }))
    .sort((a, b) => CAT_ORDER[a.category] - CAT_ORDER[b.category] || a.cues[0].t0 - b.cues[0].t0 || (a.source < b.source ? -1 : 1));
}

// Geometry, in px. The envelope's dB axis runs from DB.lo at the lane's floor to DB.hi at its top, so the background (0)
// sits at 3/8 down and the pan's centre line (half way) stays clear of it.
export const TL = { pxPerS: 28, left: 270, right: 40, laneLabels: 26, env: 48, bar: 5, gap: 9, catGap: 30, top: 344 };
export const DB = { lo: -30, hi: 18 };
const CAT_NAME = { bg: 'BACKGROUNDS AND AMBIENCES', hard: 'HARD EFFECTS', foley: 'FOLEY' };
const STEP = 1 / 48; // envelope samples: two per frame

// a cue's label in its lane: the part of its id after the source (a step's ordinal, 'unlatch', 'walk2')
export function partOf(c) {
  const p = c.id.split('.');
  return c.family === 'feet' || c.family === 'tick' ? p[p.length - 1] : p.slice(3).join('.') || p[1];
}

export function buildTimeline({ cues = CUES, w = WORLD } = {}) {
  const pred = makePredictor({ cues, w }), lanes = lanesOf(cues), T = w.T_TOTAL, F = frameSize(w);
  const X = (t) => TL.left + t * TL.pxPerS, width = TL.left + T * TL.pxPerS + TL.right;
  // lane positions
  let y = TL.top, cat = null;
  for (const ln of lanes) {
    if (ln.category !== cat) { y += TL.catGap; cat = ln.category; ln.catHead = true; }
    ln.y = y; ln.envTop = y + TL.laneLabels; ln.envBot = ln.envTop + TL.env; ln.barY = ln.envBot + 2;
    y = ln.barY + TL.bar + TL.gap;
  }
  const height = y + 30;
  const d = new Draw(width, height, { bg: '#080c16' });
  const L = makeLabeler(d, { pad: 1.5 });
  const dbY = (ln, db) => ln.envBot - ((Math.min(DB.hi, Math.max(DB.lo, db)) - DB.lo) / (DB.hi - DB.lo)) * TL.env;
  const panY = (ln, pan) => ln.envTop + ((pan + 1) / 2) * TL.env;

  // ---- header: title, rule, legend
  L.fixed(24, 40, 'Snow, Lamp, Bridge: the cue timeline', { size: 26, weight: 700, fill: '#fff' });
  L.fixed(24, 66, `Every cue in src/audio/cues.js (${cues.length}, ${cues.filter((c) => c.enabled).length} enabled), one lane per voice group (${lanes.length}), as heard from the camera playing at each moment. Time runs left to right, ${TL.pxPerS} px a second.`, { size: 14, fill: '#8794b3' });
  wrapText(RULE_TEXT, 1500, 12).forEach((s, i) => L.fixed(24, 92 + i * 16, s, { size: 12, fill: '#8794b3' }));
  const lx = 24, ly = 150;
  const key = [
    ['env', `Envelope: predicted level against the place's background, ${DB.lo} dB at the lane's floor to ${fmtDb(DB.hi)} dB at its top; the dashed line is the background, 0 dB.`],
    ['pan', 'Thin white line: the pan, left at the top of the lane, right at its foot, centre half way.'],
    ['bar', 'Bar under the lane: the source is in frame (projected through the shot\'s camera, frame by frame).'],
    ['tick', 'Tick and label: a cue\'s onset (steps by their ordinal, ticks by number). Dashed: offered, default out.'],
    ['mod', 'Dashed box: a cue with no voice of its own (the rise, the swell, the ambience changes); its line is its track, 0 to 1.'],
    ['bed', 'Hatched columns: bed-only windows (SOUND-PLAN 3.11), no hard or foley onset; two are held for music.'],
  ];
  key.forEach(([k, s], i) => {
    const yy = ly + i * 20;
    if (k === 'env') d.poly([[lx, yy], [lx + 30, yy], [lx + 30, yy - 10], [lx + 15, yy - 6], [lx, yy - 8]], { fill: PERSON.A, fillOp: 0.45, stroke: PERSON.A, sw: 1 });
    if (k === 'pan') d.line([[lx, yy - 8], [lx + 30, yy - 2]], { stroke: '#fff', sw: 1 });
    if (k === 'bar') d.rect(lx, yy - 6, 30, 5, { fill: PERSON.B });
    if (k === 'tick') d.line([[lx + 15, yy - 12], [lx + 15, yy + 2]], { stroke: FAMILY.door.color, sw: 1.5 });
    if (k === 'mod') d.rect(lx, yy - 11, 30, 11, { stroke: FAMILY.engine.color, sw: 1, dash: [3, 2] });
    if (k === 'bed') hatch(d, lx, yy - 12, 30, 13);
    L.fixed(lx + 42, yy, s, { size: 12, fill: '#c9d4ee' });
  });

  // ---- shots as columns, the time ruler, the windows and the place change
  const sy = 286, all = [sy - 4, height - 20];
  for (const s of w.SHOTS) {
    const x0 = X(s.start), x1 = X(s.end), col = shotColor(s.n);
    d.rect(x0, sy, x1 - x0 - 1, 22, { fill: col, fillOp: 0.9 });
    L.fixed((x0 + x1) / 2, sy + 16, String(s.n), { size: 14, weight: 700, fill: '#0b1020', anchor: 'middle' });
    d.rect(x0, sy + 24, x1 - x0, all[1] - sy - 24, { fill: col, fillOp: (s.n % 2) ? 0.045 : 0.02 });
    d.line([[x0, sy + 24], [x0, all[1]]], { stroke: col, strokeOp: 0.35, sw: 1 });
    L.place(x0 + 3, sy - 8, s.title, { size: 11, fill: col }, { cands: [[0, 0, 'e']], leader: false });
  }
  for (let t = 0; t <= T; t += 1) {
    d.line([[X(t), sy + 24], [X(t), sy + (t % 5 ? 28 : 34)]], { stroke: '#8794b3', sw: 1 });
    if (t % 5 === 0) L.place(X(t) + 2, sy + 44, `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`, { size: 10, fill: '#8794b3' }, { cands: [[0, 0, 'e']], leader: false });
  }
  for (const b of bedOnlyWindows(w)) {
    hatch(d, X(b.t0), sy + 48, X(b.t1) - X(b.t0), all[1] - sy - 48, { bed: b.note });
    L.place(X(b.t0) + 3, TL.top + 14, b.music ? `bed only, held for music: ${b.note}` : `bed only: ${b.note}`, { size: 11, weight: 700, fill: '#c9d4ee' }, { cands: [[0, 0, 'e'], [0, 13, 'e']], leader: false });
  }
  const br = pred.locations.slice(1);
  for (const l of br) {
    d.line([[X(l.t0), sy + 24], [X(l.t0), all[1]]], { stroke: '#8fb0ff', sw: 2.5, dash: [6, 4], place: l.name });
    L.place(X(l.t0) + 3, TL.top, `the place changes: ${pred.locations[0].name} to ${l.name}, ${fmtT(l.t0)} s (shot ${l.shots[0]}); backgrounds ${fmtDb(pred.bg[pred.locations[0].name])} to ${fmtDb(pred.bg[l.name])} dB`, { size: 11, weight: 700, fill: '#8fb0ff' }, { cands: [[0, 0, 'e']], leader: false });
  }

  // ---- lanes
  const manifest = [];
  for (const ln of lanes) {
    const c0 = ln.cues[0], col = colorOf(c0);
    if (ln.catHead) L.fixed(16, ln.y - 10, CAT_NAME[ln.category], { size: 12, weight: 700, fill: '#8794b3' });
    d.rect(TL.left, ln.envTop, T * TL.pxPerS, TL.env, { fill: '#0d1320', fillOp: 0.55 });
    d.line([[TL.left, dbY(ln, 0)], [X(T), dbY(ln, 0)]], { stroke: '#8794b3', sw: 0.8, dash: [4, 4], strokeOp: 0.7 });
    const fams = [...new Set(ln.cues.map((c) => c.family))].join(', '), laws = [...new Set(ln.cues.map((c) => c.law ?? 'unplaced'))].join(', ');
    L.fixed(16, ln.envTop + 12, ln.source, { size: 13, weight: 700, fill: col });
    L.fixed(16, ln.envTop + 28, `${fams}; ${laws}; ${ln.cues.length} cue${ln.cues.length > 1 ? 's' : ''}`, { size: 11, fill: '#8794b3' });
    const onBar = [];
    for (const c of ln.cues) {
      const ccol = colorOf(c), off = !c.enabled;
      if (!voiced(c)) {
        // a modifier: a dashed box over its span and its track's first field, 0 to 1
        const x0 = X(c.t0), x1 = X(c.t1), key0 = c.track ? Object.keys(c.track(c.t0))[0] : null;
        d.rect(x0, ln.envTop, Math.max(2, x1 - x0), TL.env, { stroke: ccol, sw: 1, dash: [3, 2], cue: c.id, role: 'envelope', ...(off ? { op: 0.6 } : {}) });
        if (key0) { const pts = []; for (let t = c.t0; t <= c.t1 + 1e-9; t += STEP) pts.push([X(t), ln.envBot - Math.min(1, Math.max(0, c.track(Math.min(t, c.t1))[key0])) * TL.env]); d.line(pts, { stroke: ccol, sw: 1.2, strokeOp: 0.9 }); }
      } else {
        // the envelope and the pan, sampled at STEP, broken where the source is nowhere
        const ts = [];
        for (let t = c.t0; t < c.t1; t += STEP) ts.push(t);
        ts.push(Math.max(c.t0, c.t1 - 1e-6));
        let seg = [], pans = [];
        const flush = () => {
          if (seg.length) {
            const pts = seg.map((s) => [X(s.t), dbY(ln, s.db)]);
            if (pts.length === 1 || pts[pts.length - 1][0] - pts[0][0] < 2) pts.push([pts[0][0] + 2, pts[pts.length - 1][1]]);
            d.poly([...pts, [pts[pts.length - 1][0], ln.envBot], [pts[0][0], ln.envBot]], off ? { stroke: ccol, sw: 1, dash: [3, 2], cue: c.id, role: 'envelope' } : { fill: ccol, fillOp: 0.38, stroke: ccol, sw: 1, cue: c.id, role: 'envelope' });
            if (pans.length > 1) d.line(pans, { stroke: '#ffffff', sw: 0.9, strokeOp: off ? 0.4 : 0.9 });
          }
          seg = []; pans = [];
        };
        for (const t of ts) {
          const q = pred.at(c, t);
          if (!q) { flush(); continue; }
          seg.push({ t, db: q.db });
          if (q.pan !== null) pans.push([X(t), panY(ln, q.pan)]);
          if (q.p && !off) onBar.push({ t, on: inFrame(w, q.p, t, F) });
        }
        flush();
      }
      d.line([[X(c.t0), ln.envTop - 2], [X(c.t0), ln.envBot]], { stroke: ccol, sw: 1.4, cue: c.id, role: 'onset', ...(off ? { dash: [2, 2] } : {}) });
      manifest.push({ id: c.id, lane: ln.source, x: X(c.t0) });
      // the label: in the strip above the lane, first row then second, then nudged right
      const str = partOf(c) + (off ? ' (offered, off)' : '');
      const cands = [[1, -2, 'e'], [1, -14, 'e'], [9, -2, 'e'], [9, -14, 'e'], [18, -14, 'e'], [18, -2, 'e']];
      L.place(X(c.t0), ln.envTop, str, { size: 10, fill: ccol }, { cands, leader: false });
    }
    // the in-frame bar: runs of samples in frame
    onBar.sort((a, b) => a.t - b.t);
    let run = null;
    for (const s of onBar) {
      if (s.on && !run) run = { t0: s.t, t1: s.t };
      else if (s.on) run.t1 = s.t;
      else if (run) { d.rect(X(run.t0), ln.barY, Math.max(1.5, X(run.t1 + STEP) - X(run.t0)), TL.bar, { fill: col, onScreen: ln.source }); run = null; }
    }
    if (run) d.rect(X(run.t0), ln.barY, Math.max(1.5, X(run.t1 + STEP) - X(run.t0)), TL.bar, { fill: col, onScreen: ln.source });
  }
  return { d, lanes, manifest, labeler: L, X };
}

// diagonal hatching over a box (the bed-only windows)
function hatch(d, x, y, w, h, tag = {}) {
  d.rect(x, y, w, h, { fill: '#c9d4ee', fillOp: 0.05, stroke: '#c9d4ee', strokeOp: 0.35, sw: 1, dash: [4, 3], ...tag });
  const step = 14;
  for (let k = -h; k < w; k += step) {
    const a = k < 0 ? [x, y + h + k] : [x + k, y + h], b = k + h > w ? [x + w, y + k + h - w] : [x + k + h, y];
    d.line([a, b], { stroke: '#c9d4ee', strokeOp: 0.12, sw: 1 });
  }
}
