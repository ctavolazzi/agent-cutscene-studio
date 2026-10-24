// Sound storyboard, part 1 (SOUND-PLAN.md 4.3): what the drawings share, and the sound map.
// - The predicted level and pan: the one rule every drawing uses (makePredictor).
// - Text boxes from Helvetica's metrics and a label placer, so no label covers another (the tests check the boxes).
// - The colours and glyphs of the families.
// - The sound map: every placed source from src/audio/cues.js on the picture's top-down view, each camera as a listener.
// Everything comes from cues.js (CUES, LAWS, WORLD, makeLocations), SHOTS and spatial.js. The picture's data reach this
// file only through cues.js's WORLD, so a map built from makeCues(patched world) follows the patch.
import { Draw } from './draw.js';
import { makeView, wedge, shotColor } from './map.js';
import { clipPolyRect, clipLineRect, bearingOf, dirOf, D2R } from './math.js';
import { CUES, LAWS, WORLD, makeLocations } from '../../src/audio/cues.js';
import { SPATIAL, listenerAt, placeAt } from '../../src/audio/spatial.js';

const r2 = (n) => Math.round(n * 100) / 100;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const fmtT = (t) => t.toFixed(2);
export const fmtDb = (db) => { const r = Math.round(db * 10) / 10; return r === 0 ? '0.0' : `${r > 0 ? '+' : ''}${r.toFixed(1)}`; };

// ---------- the predicted level and pan: the one rule ----------
// A cue at time t is heard from the camera of the shot playing at t (spatial.listenerAt): pan and gain come from
// spatial.placeAt at the cue's place under its law (LAWS[c.law]), and the cue's designed level is added. The result is
// shown against the background of the place playing at t: the power sum of that place's enabled background beds (the
// street sums to 0 dB, the reference of SOUND-PLAN 1.3). An unplaced bed has no pan and its designed level. A cue with
// no voice of its own (voices 0: the rise, the swell, the ambience changes) is a change to others, not a level.
export const RULE_TEXT = 'Predicted level = the cue\'s designed level + 20 log10(gain), gain from spatial.placeAt at the cue\'s place under LAWS[cue.law], heard from the camera playing at that moment; shown in dB against the place\'s background (the power sum of its background beds: street 0 dB, the reference). Pan from the same placeAt. Unplaced beds: no pan, their designed level.';
const powerSum = (dbs) => 10 * Math.log10(dbs.reduce((s, db) => s + 10 ** (db / 10), 0));

export function makePredictor({ cues = CUES, w = WORLD } = {}) {
  const locations = makeLocations(w);
  const beds = (name) => cues.filter((c) => c.enabled && c.category === 'bg' && !c.place && c.voices > 0 && c.meta.location === name);
  const bg = Object.fromEntries(locations.map((l) => [l.name, powerSum(beds(l.name).map((c) => c.level))]));
  const locAt = (t) => locations.find((l) => t >= l.t0 && t < l.t1) ?? locations[locations.length - 1];
  return {
    bg, locations, locAt, beds,
    // { t, pan (null unplaced), db (against the background), abs, ref, dist, behind, p } or null when the source is nowhere
    at(c, t) {
      const ref = bg[locAt(t).name];
      if (!c.place) return { t, pan: null, abs: c.level, db: c.level - ref, ref, dist: null, behind: false, p: null };
      const p = c.place(t);
      if (!p) return null;
      const L = listenerAt(t), s = placeAt(p, t, L, LAWS[c.law]);
      const abs = c.level + 20 * Math.log10(s.gain);
      return { t, pan: s.pan, abs, db: abs - ref, ref, dist: s.dist, behind: dot(sub(p, L.pos), L.f) < 0, p };
    },
  };
}
// a cue that sounds as its own voice (not a modifier of others)
export const voiced = (c) => c.voices > 0;
// the cues sounding at any time in [t0, t1)
export const sounding = (cues, t0, t1) => cues.filter((c) => c.t0 < t1 && c.t1 > t0);

// ---------- colours and glyphs ----------
export const PERSON = { A: '#ffa94d', B: '#4dc3ff' }; // orange and sky blue: apart for every common colour vision
export const FAMILY = {
  engine: { shape: 'tri', color: '#ff7a6b' }, arrival: { shape: 'tri', color: '#ff7a6b' }, stop: { shape: 'tri', color: '#ff7a6b' },
  tyres: { shape: 'diamond', color: '#d8b48a' }, brake: { shape: 'tridown', color: '#ff5fa2' }, settle: { shape: 'square', color: '#b48cff' },
  cabin: { shape: 'square', color: '#7fe08a' }, door: { shape: 'square', color: '#f0f0f0' }, unload: { shape: 'diamond', color: '#7fe0c0' },
  tick: { shape: 'dot', color: '#9aa6c4' }, hum: { shape: 'dot', color: '#fff0a0' },
  feet: { shape: 'dot', person: true }, scuff: { shape: 'diamond', person: true }, moves: { shape: 'square', person: true },
  lighter: { shape: 'tri', person: true }, drag: { shape: 'tridown', person: true }, breath: { shape: 'diamond', person: true },
  wind: { shape: 'dot', color: '#8fb0ff' }, city: { shape: 'dot', color: '#b0a4f5' }, water: { shape: 'dot', color: '#4fa3e0' }, ambience: { shape: 'dot', color: '#8fb0ff' },
};
export const colorOf = (c) => (FAMILY[c.family]?.person && c.person ? PERSON[c.person] : FAMILY[c.family]?.color ?? '#ffffff');
export const LAW_COLOR = { physical: '#fff0a0', car: '#ff7a6b', door: '#f0f0f0', foley: '#7fe08a' };
export const RING_DB = [-6, -12, -18, -24];
const RING_DASH = { '-6': null, '-12': [7, 4], '-18': [2, 4], '-24': [1, 7] };
// the distance at which a law has fallen by `db` (placeAt: gain = (refDist / dist) ^ rolloff past refDist)
export const ringRadius = (law, db) => law.refDist * 10 ** (-db / (20 * law.rolloff));

// A glyph of `shape` at (x, y), radius r. The first item carries `tag` (cue ids, roles) for the tests.
export function glyph(d, x, y, shape, r, st = {}, tag = {}) {
  const o = { fill: st.fill ?? '#fff', stroke: st.stroke ?? '#0b1020', sw: st.sw ?? 1, ...(st.op != null ? { op: st.op } : {}), ...(st.dash ? { dash: st.dash } : {}), ...tag };
  if (shape === 'dot') return d.circle(x, y, r, o);
  const P = {
    square: [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [a * 0.86, b * 0.86]),
    diamond: [[0, -1.2], [1.2, 0], [0, 1.2], [-1.2, 0]],
    tri: [[0, -1.25], [1.1, 0.75], [-1.1, 0.75]],
    tridown: [[0, 1.25], [1.1, -0.75], [-1.1, -0.75]],
  }[shape];
  // a poly's tag point is its centre, so a test reads it as cx, cy
  return d.poly(P.map(([a, b]) => [x + a * r, y + b * r]), { ...o, cx: x, cy: y });
}

// ---------- text boxes and the label placer ----------
// Helvetica's advance widths in 1/1000 em (the standard AFM) for ASCII 32 to 126. Chromium draws Helvetica and Arial
// here with Liberation Sans, which has the same metrics. Bold is up to about 10 percent wider.
const AFM = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556,
  278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611,
  722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
export function textWidth(s, size, weight = 400) {
  let em = 0;
  for (const ch of String(s)) { const k = ch.codePointAt(0); em += k >= 32 && k <= 126 ? AFM[k - 32] : 1000; }
  return (em / 1000) * size * (weight >= 600 ? 1.1 : 1);
}
// The box a Draw text item covers: its widest line, from the cap height above the first baseline to the descender
// below the last (lines are 1.25 em apart, as Draw writes them).
export function textBox(it) {
  const lines = String(it.str).split('\n'), size = it.size ?? 14;
  const w = Math.max(...lines.map((l) => textWidth(l, size, it.weight ?? 400)));
  const x0 = it.anchor === 'middle' ? it.x - w / 2 : it.anchor === 'end' ? it.x - w : it.x;
  return { x0, x1: x0 + w, y0: it.y - 0.8 * size, y1: it.y + (lines.length - 1) * 1.25 * size + 0.22 * size };
}
export const boxesHit = (a, b, pad = 0) => a.x0 < b.x1 + pad && b.x0 < a.x1 + pad && a.y0 < b.y1 + pad && b.y0 < a.y1 + pad;
// Every pair of text items in a drawing whose boxes overlap: [[a, b], ...] (the check the tests run).
export function textOverlaps(d) {
  const ts = d.items.filter((it) => it.k === 'text').map((it) => ({ it, b: textBox(it) })), out = [];
  for (let i = 0; i < ts.length; i++) for (let j = i + 1; j < ts.length; j++) if (boxesHit(ts[i].b, ts[j].b)) out.push([ts[i].it, ts[j].it]);
  return out;
}

// Candidate places around a point, nearest first: [dx, dy, side], side e (right), w (left), n (above), s (below).
function ring(r) {
  const out = [];
  for (const k of [0, 10, 22, 38, 58, 84, 116, 150]) {
    const q = r + 3 + k;
    out.push([q, 0, 'e'], [-q, 0, 'w'], [0, -q, 'n'], [0, q, 's'], [q * 0.75, -q * 0.75, 'e'], [-q * 0.75, -q * 0.75, 'w'], [q * 0.75, q * 0.75, 'e'], [-q * 0.75, q * 0.75, 'w']);
  }
  return out;
}
// A label placer over a drawing: each label goes to the first candidate whose box is clear of every box placed or
// blocked so far and inside `bounds`. A label set away from its point gets a thin leader line. Returns the text item, or
// null when nothing fits (the caller counts those, so a dropped label is never silent).
export function makeLabeler(d, { bounds = null, pad = 2 } = {}) {
  const boxes = [];
  const fits = (b) => (!bounds || (b.x0 >= bounds.x0 && b.x1 <= bounds.x1 && b.y0 >= bounds.y0 && b.y1 <= bounds.y1)) && boxes.every((o) => !boxesHit(o, b, pad));
  const textAt = (x, y, side, str, o) => {
    const size = o.size ?? 11, lines = String(str).split('\n').length;
    const h = (lines - 1) * 1.25 * size;
    if (side === 'e') return { x, y: y + size * 0.32 - h / 2, anchor: 'start' };
    if (side === 'w') return { x, y: y + size * 0.32 - h / 2, anchor: 'end' };
    if (side === 'n') return { x, y: y - h - 0.22 * size, anchor: 'middle' };
    return { x, y: y + 0.8 * size, anchor: 'middle' };
  };
  return {
    boxes,
    dropped: [],
    block(b) { boxes.push(b); },
    // a label exactly here (titles, legends): drawn and blocked; false if it overlaps something already placed
    fixed(x, y, str, o = {}) { const it = { k: 'text', x, y, str, size: 14, ...o }; const b = textBox(it); const ok = fits(b); boxes.push(b); d.add(it); return ok; },
    // `later`: an array that takes the items instead of the drawing, for a label placed now and drawn on top later
    place(x, y, str, o = {}, { r = 4, cands = null, leader = true, later = null } = {}) {
      const put = (it) => (later ? later.push(it) : d.add(it));
      for (const [dx, dy, side] of cands ?? ring(r)) {
        const at = textAt(x + dx, y + dy, side, str, o), it = { k: 'text', str, size: 11, ...o, ...at }, b = textBox(it);
        if (!fits(b)) continue;
        boxes.push(b);
        if (leader && Math.hypot(dx, dy) > r + 6) {
          const tx = Math.min(Math.max(x, b.x0), b.x1), ty = Math.min(Math.max(y, b.y0), b.y1);
          put({ k: 'line', pts: [[x, y], [tx, ty]], stroke: o.fill ?? '#c9d4ee', sw: 0.7, strokeOp: 0.6 });
        }
        put(it);
        return it;
      }
      this.dropped.push(str);
      return null;
    },
  };
}

// ---------- the map ----------
const C = {
  bg: '#0d1320', river: '#0f2238', road: '#1c2538', walk: '#252f45', deck: '#2c3750', parapet: '#8e9bb8', bldg: '#182238', bldgLine: '#3e4f73',
  city: '#141c30', cityLine: '#2a3654', pool: '#ffb46b', line180: '#ff5d5d', text: '#c9d4ee', dim: '#7d8bab', car: '#e8eefc', unplaced: '#8fb0ff',
};
export const MAP_COLORS = C;

// Drawing in world meters, clipped geometrically to the view (no clip paths, so Excalidraw holds it).
function api(d, v) {
  const P = (x, z) => [v.X(x), v.Y(z)];
  const inside = (x, z) => v.X(x) >= v.rect.x0 && v.X(x) <= v.rect.x1 && v.Y(z) >= v.rect.y0 && v.Y(z) <= v.rect.y1;
  return {
    P, inside,
    poly(pts, o = {}) { const c = clipPolyRect(pts.map(([x, z]) => P(x, z)), v.rect); if (c) d.poly(c, o); },
    box(x0, z0, x1, z1, o = {}) { this.poly([[x0, z0], [x1, z0], [x1, z1], [x0, z1]], o); },
    line(pts, o = {}) { for (const s of clipLineRect(pts.map(([x, z]) => P(x, z)), v.rect)) d.line(s, o); },
    arc(x, z, rm, a0, a1, o = {}, n = 72) { const pts = []; for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; pts.push([x + Math.cos(a) * rm, z + Math.sin(a) * rm]); } this.line(pts, o); },
  };
}

// The set under the sounds, dim: river, streets, deck, parapets, buildings, the far city, the lamp's pool, the 180 degree
// line and the place boundary. Labels go through the placer after the sources, so a source label always wins.
function drawBase(d, v, w, g) {
  const { STREET, CROSS, BRIDGE, BUILDINGS, CITY, LAMP, RAIL } = w;
  const far = 1000;
  d.rect(v.rect.x0, v.rect.y0, v.w, v.h, { fill: C.bg });
  g.box(-far, BRIDGE.z1, far, BRIDGE.z0, { fill: C.river });
  g.box(-STREET.roadHalf, BRIDGE.z0, STREET.roadHalf, far, { fill: C.road });
  g.box(-STREET.walkOuter, BRIDGE.z0, -STREET.roadHalf, far, { fill: C.walk });
  g.box(STREET.roadHalf, BRIDGE.z0, STREET.walkOuter, far, { fill: C.walk });
  g.box(-far, CROSS.z0, far, CROSS.z1, { fill: C.road });
  g.box(-STREET.walkOuter, BRIDGE.z1, STREET.walkOuter, BRIDGE.z0, { fill: C.deck });
  g.box(-STREET.walkOuter, -far, STREET.walkOuter, BRIDGE.z1, { fill: C.road });
  const inner = BRIDGE.halfWidth - BRIDGE.parapetThick;
  g.box(inner, BRIDGE.z1, BRIDGE.halfWidth, BRIDGE.z0, { fill: C.parapet, fillOp: 0.7 });
  g.box(-BRIDGE.halfWidth, BRIDGE.z1, -inner, BRIDGE.z0, { fill: C.parapet, fillOp: 0.45 });
  for (const b of BUILDINGS) g.box(b.x0, b.z0, b.x1, b.z1, { fill: C.bldg, stroke: C.bldgLine, sw: 1 });
  for (const c of CITY) g.box(c.x0, c.z0, c.x1, c.z1, { fill: C.city, stroke: C.cityLine, sw: 0.8 });
  const pool = [];
  for (let i = 0; i < 48; i++) pool.push([LAMP.base[0] + Math.cos((i / 48) * 2 * Math.PI) * LAMP.poolRadius, LAMP.base[1] + Math.sin((i / 48) * 2 * Math.PI) * LAMP.poolRadius]);
  g.poly(pool, { fill: C.pool, fillOp: 0.06, stroke: C.pool, strokeOp: 0.5, sw: 1, dash: [6, 5] });
  g.line([[RAIL.x, BRIDGE.z1], [RAIL.x, CROSS.z0]], { stroke: C.line180, sw: 1.6, dash: [10, 7], strokeOp: 0.85 });
  g.line([[v.x0, BRIDGE.z0], [v.x1, BRIDGE.z0]], { stroke: C.unplaced, sw: 2, dash: [3, 4] });
}
function labelBase(d, v, w, g, L, detail) {
  const { BRIDGE, BUILDINGS, RAIL, STREET, CROSS, LAMP } = w;
  const fs = detail ? 12 : 11, at = (x, z, s, o, opt) => g.inside(x, z) && L.place(v.X(x), v.Y(z), s, { size: fs, fill: C.dim, ...o }, opt);
  at(RAIL.x, BRIDGE.z1 + 2, '180 degree line', { fill: C.line180, weight: 700 }, { r: 2 });
  at(LAMP.base[0] - LAMP.poolRadius, LAMP.base[1], 'lamp pool', { fill: C.pool }, { r: 2 });
  for (const b of BUILDINGS) at((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2, b.id, {}, { cands: [[0, 0, 'n']], leader: false });
  at(-STREET.walkOuter - 2, (BRIDGE.z0 + BRIDGE.z1) / 2, 'RIVER', { fill: '#4f7bb0' }, { r: 2 });
  at(-STREET.walkOuter - 2, (CROSS.z0 + CROSS.z1) / 2, 'CROSS STREET', {}, { r: 2 });
}

// The unplaced backgrounds. The main map names each place's beds and their sum beside the place boundary, right-aligned
// at the map's east edge; a detail map labels the boundary only (its header names the beds). The wind's bearing is drawn
// as arrows over the river, toward where it blows (set WIND.fromDeg).
// The arrows are drawn now; the labels are returned, to be placed after the sources so they keep clear of the glyphs.
function drawUnplaced(d, v, w, g, L, pred, detail) {
  const { BRIDGE, WIND } = w;
  const fs = 12, inView = BRIDGE.z0 > v.z0 && BRIDGE.z0 < v.z1, span = (BRIDGE.z0 - BRIDGE.z1);
  const labels = () => {
    if (!detail) {
      for (const loc of pred.locations) {
        const beds = pred.beds(loc.name).map((c) => `${c.family} ${fmtDb(c.level)}`).join(', ');
        const str = `${loc.name.toUpperCase()}: shots ${loc.shots[0]} to ${loc.shots[loc.shots.length - 1]}, ${fmtT(loc.t0)} to ${fmtT(loc.t1)} s\nbackground, unplaced: ${beds} dB, sum ${fmtDb(pred.bg[loc.name])} dB`;
        const north = loc.name === 'bridge';
        L.place(v.rect.x1 - 6, v.Y(BRIDGE.z0) + (north ? -10 : 10), str, { size: fs, fill: C.unplaced, weight: 700 }, { cands: [[0, north ? -20 : 20, 'w'], [0, north ? -44 : 44, 'w'], [0, north ? -68 : 68, 'w']], leader: false });
      }
    } else if (inView) {
      // on the boundary line, at its east end, else its west end, just above or below it
      const br = pred.locations.find((l) => l.name !== pred.locations[0].name), y = v.Y(BRIDGE.z0), x0 = v.rect.x0, x1 = v.rect.x1;
      const at = [-12, 14, -30, 32].flatMap((dy) => [[x1 - 6, y + dy, 'w'], [x0 + 6, y + dy, 'e']]);
      if (br) L.place(0, 0, `${pred.locations[0].name} | ${br.name}: the place changes at ${fmtT(br.t0)} s (shot ${br.shots[0]})`, { size: fs, fill: C.unplaced }, { cands: at, leader: false });
    }
    const wx = v.x0 + (v.x1 - v.x0) * 0.55, wz = BRIDGE.z1 + span * 0.5;
    if (g.inside(wx, wz)) L.place(v.X(wx), v.Y(wz), `wind from ${WIND.fromDeg} deg, and the water: unplaced, bridge only`, { size: fs - 1, fill: C.unplaced }, { r: 6 });
  };
  const to = dirOf(WIND.fromDeg + 180);
  for (const fx of [0.2, 0.55, 0.85]) for (const fz of [0.3, 0.7]) {
    const x = v.x0 + (v.x1 - v.x0) * fx, z = BRIDGE.z1 + span * fz, l = Math.min(4, span * 0.25);
    if (!g.inside(x, z)) continue;
    const a = [x - to[0] * l / 2, z - to[2] * l / 2], b = [x + to[0] * l / 2, z + to[2] * l / 2];
    g.line([a, b], { stroke: C.unplaced, sw: 1.2, dash: [3, 3], strokeOp: 0.7 });
    const p = g.P(...b), q = g.P(...a), ux = (p[0] - q[0]) / Math.hypot(p[0] - q[0], p[1] - q[1]), uy = (p[1] - q[1]) / Math.hypot(p[0] - q[0], p[1] - q[1]);
    d.poly([p, [p[0] - ux * 7 - uy * 3.5, p[1] - uy * 7 + ux * 3.5], [p[0] - ux * 7 + uy * 3.5, p[1] - uy * 7 - ux * 3.5]], { fill: C.unplaced, op: 0.7 });
  }
  return labels;
}

// One camera as a listener: the half-plane behind it shaded (quieter and darker there, spatial.SPATIAL), its level rings
// per law at -6 to -24 dB (the laws its shot's cues are heard by), the field-of-view wedge at the shot's start (dashed at
// its end when it moves), the left and right axis with its head to the right, and the camera's number.
export function listenerGlyph(d, v, g, L, shot, { cues, w, detail = false, wedgeLen, ringsOpacity = 1, maxRing = Infinity, wedgeOp = 0.1 }) {
  const col = shotColor(shot.n), c0 = w.cameraAt(shot, shot.start), c1 = w.cameraAt(shot, shot.end - 1e-6);
  const yaw = bearingOf(c0.pos, c0.target), f = dirOf(yaw), r = [Math.cos(yaw * D2R), 0, Math.sin(yaw * D2R)];
  const x = c0.pos[0], z = c0.pos[2];
  const len = wedgeLen ?? 8;
  // behind: the half-disc on the far side of the camera's left and right axis
  const back = [];
  for (let i = 0; i <= 24; i++) { const a = Math.PI * (i / 24); back.push([x + (r[0] * Math.cos(a) - f[0] * Math.sin(a)) * len, z + (r[2] * Math.cos(a) - f[2] * Math.sin(a)) * len]); }
  g.poly([[x, z], ...back], { fill: '#000000', fillOp: 0.16, stroke: col, strokeOp: 0.35, sw: 0.8, dash: [2, 3] });
  // the rings over the half-plane in front (behind is the shaded half-disc), out to `maxRing` meters
  const laws = [...new Set(sounding(cues, shot.start, shot.end).filter((c) => c.enabled && voiced(c) && c.place).map((c) => c.law))].sort();
  const a0 = Math.atan2(r[2], r[0]);
  for (const law of laws) for (const db of RING_DB) {
    const rm = ringRadius(LAWS[law], db);
    if (rm > maxRing) continue;
    g.arc(x, z, rm, a0, a0 - Math.PI, { stroke: LAW_COLOR[law], strokeOp: 0.5 * ringsOpacity, sw: detail ? 1 : 0.8, dash: RING_DASH[db] ?? undefined, ring: { shot: shot.n, law, db } }, 48);
  }
  g.poly(wedge(c0, shot, len), { fill: col, fillOp: wedgeOp, stroke: col, strokeOp: 0.85, sw: 1.2 });
  const moved = Math.hypot(c1.pos[0] - c0.pos[0], c1.pos[2] - c0.pos[2]) > 0.3;
  const turned = Math.abs(((bearingOf(c1.pos, c1.target) - yaw + 540) % 360) - 180) > 3;
  if (moved || turned) g.poly(wedge(c1, shot, len), { stroke: col, strokeOp: 0.7, sw: 1, dash: [5, 4] });
  if (moved) g.line([[x, z], [c1.pos[0], c1.pos[2]]], { stroke: col, sw: 2 });
  // left and right: a line through the camera, the head at the right
  const half = len * 0.45, lp = [x - r[0] * half, z - r[2] * half], rp = [x + r[0] * half, z + r[2] * half];
  g.line([lp, rp], { stroke: col, sw: 1.6 });
  if (g.inside(...rp)) { const p = g.P(...rp), u = [r[0], r[2]], s = detail ? 9 : 7; d.poly([p, [p[0] - u[0] * s - u[1] * s * 0.55, p[1] - u[1] * s + u[0] * s * 0.55], [p[0] - u[0] * s + u[1] * s * 0.55, p[1] - u[1] * s - u[0] * s * 0.55]], { fill: col }); }
  // the camera's disc and number are drawn last, over every field and source (see cameraMarks)
  return g.inside(x, z) ? { n: shot.n, col, x: v.X(x), y: v.Y(z), R: detail ? 11 : 7, size: detail ? 13 : 11 } : null;
}
// The cameras' numbers are placed before the sources' labels (inside the disc when it is free, else beside it with a
// leader) and drawn after everything, with the discs, so no field or glyph covers a number.
function cameraMarks(d, L, marks) {
  const later = [];
  for (const m of marks.filter(Boolean)) {
    const at = L.place(m.x, m.y, String(m.n), { size: m.size, weight: 700, fill: '#0b1020' }, { cands: [[0, -(m.size * 0.5), 's']], leader: false, later });
    if (!at) { L.dropped.pop(); L.place(m.x, m.y, String(m.n), { size: m.size, weight: 700, fill: m.col }, { r: m.R, later }); }
  }
  for (const m of marks.filter(Boolean)) L.block({ x0: m.x - m.R, x1: m.x + m.R, y0: m.y - m.R, y1: m.y + m.R });
  return () => {
    for (const m of marks.filter(Boolean)) d.circle(m.x, m.y, m.R, { fill: m.col, stroke: '#0b1020', sw: 1.2, listener: m.n });
    for (const it of later) d.add(it);
  };
}

// Where a cue's glyph goes: its place at `from` (its onset unless a detail map starts later), or the first moment after
// that it has one.
export function glyphTime(c, from = c.t0) {
  if (c.place(from)) return from;
  for (let k = 1; k <= 64; k++) { const t = from + ((c.t1 - from) * k) / 64; if (c.place(t)) return t; }
  return null;
}
const sameSpot = (p, q) => Math.hypot(p[0] - q[0], p[2] - q[2]) < 0.02;

// The sources: one glyph per voiced placed cue at its place (offered ones dashed), the tracked ones' paths, the car's path
// with time marks and its parts at each mark. `label`: 'all' gives every source its own label (cues at one spot share
// one), 'groups' only the overview labels of the main map.
function drawSources(d, v, g, L, cues, w, { label, detail, span = null, pred }) {
  const show = cues.filter((c) => voiced(c) && c.place && (!span || (c.t0 < span[1] && c.t1 > span[0])));
  const fs = detail ? 11 : 10, R = detail ? 5.5 : 3.6;
  // the car's path, centre of the car, from the engine's first sound to its stop, with marks every 2 s
  const eng = cues.find((c) => c.family === 'engine' && c.placement === 'tracked');
  if (eng) {
    const t0 = span ? Math.max(eng.t0, span[0]) : eng.t0, t1 = span ? Math.min(eng.t1, span[1]) : eng.t1, path = [];
    for (let t = t0; t <= t1 + 1e-9; t += 0.05) { const c = w.carAt(t); if (c.present) path.push([c.x, c.z]); }
    g.line(path, { stroke: C.car, sw: detail ? 2.5 : 2, strokeOp: 0.75 });
    const parts = cues.filter((c) => c.placement === 'tracked' && voiced(c) && ['engine', 'tyres'].includes(c.family));
    for (let t = Math.ceil(t0 / 2) * 2; t <= t1; t += 2) {
      for (const c of parts) { const p = c.place(t); if (p && g.inside(p[0], p[2])) glyph(d, v.X(p[0]), v.Y(p[2]), FAMILY[c.family].shape, R * 0.7, { fill: colorOf(c) }, { role: 'part', cue: c.id, at: t }); }
      const cc = w.carAt(t), ew = Math.abs(Math.sin(cc.heading * D2R)) > 0.7, r = 7;
      const first = ew ? [[0, r + 3, 's'], [0, -r - 3, 'n']] : [[r + 3, 0, 'e'], [-r - 3, 0, 'w']];
      if (g.inside(cc.x, cc.z)) L.place(v.X(cc.x), v.Y(cc.z), `${t} s`, { size: fs, fill: C.car }, { r, cands: [...first, ...ring(r)] });
    }
  }
  // tracked sources: their path over their span, faint
  for (const c of show.filter((x) => x.placement === 'tracked' && x.family !== 'engine' && x.family !== 'tyres')) {
    const pts = [];
    for (let k = 0; k <= 48; k++) { const p = c.place(c.t0 + ((c.t1 - c.t0) * k) / 48); if (p) pts.push([p[0], p[2]]); }
    g.line(pts, { stroke: colorOf(c), sw: 1, strokeOp: 0.45, dash: c.enabled ? undefined : [3, 3] });
  }
  // one glyph per cue, at its place when it starts (steps at their print)
  const placed = [];
  for (const c of show) {
    const at = glyphTime(c, span ? Math.max(c.t0, span[0]) : c.t0);
    if (at === null) continue;
    const p = c.place(at);
    if (!g.inside(p[0], p[2])) continue;
    const st = FAMILY[c.family];
    glyph(d, v.X(p[0]), v.Y(p[2]), st.shape, c.family === 'feet' ? R * 0.8 : R, { fill: c.enabled ? colorOf(c) : 'none', stroke: c.enabled ? '#0b1020' : colorOf(c), sw: c.enabled ? 1 : 1.2, dash: c.enabled ? null : [2, 2] }, { role: 'glyph', cue: c.id, at });
    placed.push({ c, p, at });
  }
  for (const q of placed) L.block({ x0: v.X(q.p[0]) - R, x1: v.X(q.p[0]) + R, y0: v.Y(q.p[2]) - R, y1: v.Y(q.p[2]) + R });
  if (label === 'all') {
    // cues at one spot share a label; steps carry their contact time, A's to the west and B's to the east
    const groups = [];
    // a tracked source drawn after its onset (the map starts later) keeps a label of its own
    for (const q of placed) {
      const late = q.c.placement === 'tracked' && q.at > q.c.t0 + 1e-9;
      const gq = !late && groups.find((x) => !x.late && sameSpot(x.p, q.p) && x.family === q.c.family && x.person === q.c.person);
      if (gq) gq.cs.push(q.c); else groups.push({ p: q.p, at: q.at, late, family: q.c.family, person: q.c.person, cs: [q.c] });
    }
    groups.sort((a, b) => (a.family === 'feet') - (b.family === 'feet') || a.cs[0].t0 - b.cs[0].t0);
    for (const gq of groups) {
      const x = v.X(gq.p[0]), y = v.Y(gq.p[2]), col = colorOf(gq.cs[0]);
      const str = labelOf(gq);
      const west = gq.person === 'A';
      const cands = gq.family === 'feet' ? ring(R).filter(([, , s]) => s === (west ? 'w' : 'e')).concat(ring(R).filter(([, , s]) => s !== (west ? 'w' : 'e'))) : null;
      L.place(x, y, str, { size: fs, fill: col, cues: gq.cs.map((c) => c.id) }, { r: R, cands }); // the ids it names, for the tests
    }
  } else {
    labelGroups(d, v, g, L, placed, fs, R, pred);
  }
  return placed;
}
// the label of the cues at one spot: their family and part, and their onsets
export function shortLabel(cs) {
  // the id's source and part; a numbered part names its family ('A scuff 1', 'tick 03')
  const part = (c) => {
    if (c.family === 'hum') return 'lamp hum';
    const p = c.id.split('.').slice(2);
    if (/^[0-9]+$/.test(p[p.length - 1])) p.splice(p.length - 1, 0, c.family);
    return p.join(' ').replace(/^car /, '');
  };
  if (cs.length > 3) return `${cs[0].family} x${cs.length}, ${fmtT(cs[0].t0)} to ${fmtT(cs[cs.length - 1].t0)}`;
  return cs.map((c) => `${part(c)} ${fmtT(c.t0)}`).join('\n');
}
// a source drawn later than its onset (a detail map that starts after it) says where it is drawn
function labelOf(gq) {
  if (gq.family === 'feet') return fmtT(gq.cs[0].sync);
  return gq.late ? `${shortLabel(gq.cs).split(' ').slice(0, -1).join(' ')} at ${fmtT(gq.at)} (from ${fmtT(gq.cs[0].t0)})` : shortLabel(gq.cs);
}
// The main map's labels: one per cluster of sources (the car at rest, each walker's steps, the rail, the hum).
function labelGroups(d, v, g, L, placed, fs, R, pred) {
  const clusters = new Map();
  const key = (c) => (c.family === 'hum' ? 'hum' : c.family === 'feet' ? `feet ${c.person}` : c.person && ['lighter', 'drag', 'breath'].includes(c.family) ? 'smoke' : c.category === 'hard' ? 'car' : `${c.person} moves`);
  for (const q of placed) { const k = key(q.c); if (!clusters.has(k)) clusters.set(k, []); clusters.get(k).push(q); }
  const text = {
    hum: () => 'lamp hum (lantern), whole film',
    car: (qs) => `the car's sounds (${qs.length}): stop, doors, getting out, ticks`,
    smoke: (qs) => `lighter, drags, breath: ${fmtT(qs[0].c.t0)} to ${fmtT(qs[qs.length - 1].c.t1)}`,
  };
  for (const [k, qs] of clusters) {
    qs.sort((a, b) => a.c.t0 - b.c.t0);
    const mx = qs.reduce((s, q) => s + q.p[0], 0) / qs.length, mz = qs.reduce((s, q) => s + q.p[2], 0) / qs.length;
    const str = text[k]?.(qs) ?? (k.startsWith('feet') ? `${k.split(' ')[1]}'s steps (${qs.length}), ${fmtT(qs[0].c.sync)} to ${fmtT(qs[qs.length - 1].c.sync)}` : `${k.split(' ')[0]}'s cloth and contacts (${qs.length})`);
    const col = k === 'hum' ? FAMILY.hum.color : k === 'car' ? C.car : colorOf(qs[0].c);
    L.place(v.X(mx), v.Y(mz), str, { size: fs + 1, fill: col, weight: 700 }, { r: 10 });
  }
}

// ---------- legend ----------
function drawLegend(d, x, y, L, { cues, wFor, main = true }) {
  const line = (dy, str, o = {}) => L.fixed(x, y + dy, str, { size: 12, fill: C.text, ...o });
  let dy = 0;
  line(dy, 'LEGEND', { size: 14, weight: 700 }); dy += 24;
  const fams = [...new Set(cues.filter((c) => voiced(c) && c.place).map((c) => c.family))];
  for (const fam of fams) {
    const st = FAMILY[fam], col = st.person ? PERSON.A : st.color;
    glyph(d, x + 8, y + dy - 4, st.shape, 5, { fill: col });
    if (st.person) glyph(d, x + 22, y + dy - 4, st.shape, 5, { fill: PERSON.B });
    line(dy, fam + (st.person ? ' (A orange, B blue)' : ''), { x: x + 34 }); dy += 18;
  }
  dy += 6;
  glyph(d, x + 8, y + dy - 4, 'square', 5, { fill: 'none', stroke: PERSON.A, dash: [2, 2] });
  line(dy, 'offered, default out (disabled)', { x: x + 34 }); dy += 24;
  line(dy, 'LISTENERS (one per camera)', { size: 13, weight: 700 }); dy += 20;
  for (const s of wrapText(`Wedge: field of view at the shot's start, dashed at its end. The line through the camera is its left and right axis, the head at its right. Shaded half-disc: behind the camera, ${fmtDb(20 * Math.log10(SPATIAL.behindGain))} dB and darker (behindGain ${SPATIAL.behindGain}, air x ${SPATIAL.behindAir}). Rings, over the half in front: where each law has fallen by -6, -12, -18 and -24 dB, for the laws its shot's cues use${main ? `; this map leaves out rings past ${MAIN_RING} m (the detail maps draw them all)` : ''}.`, wFor)) { line(dy, s, { fill: C.dim }); dy += 16; }
  dy += 4;
  for (const [law, Lw] of Object.entries(LAWS)) {
    d.line([[x, y + dy - 4], [x + 26, y + dy - 4]], { stroke: LAW_COLOR[law], sw: 2 });
    line(dy, `${law} (ref ${Lw.refDist} m, rolloff ${Lw.rolloff}): ${RING_DB.map((db) => `${ringRadius(Lw, db).toFixed(1)}`).join(', ')} m`, { x: x + 34 }); dy += 18;
  }
  for (const db of RING_DB) { d.line([[x, y + dy - 4], [x + 26, y + dy - 4]], { stroke: C.text, sw: 1.2, dash: RING_DASH[db] ?? undefined }); line(dy, `${db} dB ring`, { x: x + 34 }); dy += 17; }
  dy += 8;
  line(dy, 'PREDICTED LEVEL', { size: 13, weight: 700 }); dy += 20;
  for (const s of wrapText(RULE_TEXT, wFor)) { line(dy, s, { fill: C.dim }); dy += 16; }
  return dy;
}
export function wrapText(text, px, size = 12) {
  const words = String(text).split(' '), out = [];
  let cur = '';
  for (const wd of words) { const t = cur ? `${cur} ${wd}` : wd; if (textWidth(t, size) > px && cur) { out.push(cur); cur = wd; } else cur = t; }
  if (cur) out.push(cur);
  return out;
}

// ---------- the main map and the detail maps ----------
export const MAP_SCALE = 10; // px per meter, the picture's main map (scripts/lib/map.js)
const MAIN_RING = 25; // m: the main map leaves out the rings past this, which only cross other cameras' glyphs
const LEGEND_W = 430;

// The whole set, north up, the picture's extent (set.js bounds). Returns { d, v, placed, labeler }.
export function buildSoundMap({ cues = CUES, w = WORLD } = {}, d = null, offset = [0, 0]) {
  const B = w.bounds;
  const v = makeView(B.x0, B.x1, B.z0, B.z1, MAP_SCALE, 40 + offset[0], 110 + offset[1]);
  d = d ?? new Draw(v.w + LEGEND_W + 100, v.h + 150, { bg: '#080c16' });
  const L = makeLabeler(d), g = api(d, v), pred = makePredictor({ cues, w });
  L.fixed(40 + offset[0], 48 + offset[1], 'Snow, Lamp, Bridge: sound map, top-down', { size: 26, weight: 700, fill: '#fff' });
  L.fixed(40 + offset[0], 76 + offset[1], `Generated from src/audio/cues.js (${cues.length} cues), SHOTS and spatial.js. Sound 1 storyboard, for your markup. North is up.`, { size: 14, fill: C.dim });
  drawBase(d, v, w, g);
  const unplaced = drawUnplaced(d, v, w, g, L, pred, false);
  const marks = cameraMarks(d, L, w.SHOTS.map((s) => listenerGlyph(d, v, g, L, s, { cues, w, wedgeLen: 9, ringsOpacity: 0.45, maxRing: MAIN_RING })));
  const placed = drawSources(d, v, g, L, cues, w, { label: 'groups', detail: false, pred });
  unplaced();
  marks();
  labelBase(d, v, w, g, L, false);
  drawLegend(d, v.rect.x1 + 30, v.rect.y0 + 10, L, { cues, wFor: LEGEND_W - 20 });
  return { d, v, placed, labeler: L, pred };
}

// The four detail groups (SOUND-PLAN 4.3). Each view is fitted to its cameras (where they start and end) and the sources
// it shows, with a margin, at up to DETAIL.px pixels on the long side and DETAIL.maxScale px per meter.
const DETAIL = { margin: 1.5, px: 1300, maxScale: 70 };
export function soundDetails(w = WORLD, cues = CUES) {
  const groups = [
    // the car's sounds up to its stop; what follows the stop is on the arrival's map, closer in
    { id: 'car', title: 'The car arrives: shots 2 to 5', note: 'The car\'s own sounds up to its stop; the rest is on the next map. ', only: [2, 3, 4, 5], keep: (c) => c.category === 'hard' && c.t0 <= w.carTimes.stop },
    // the car's moving sounds are on the car's map, so this one can zoom in on the car at rest
    { id: 'arrival', title: 'Out of the car and the walk: shots 4 to 7', only: [4, 5, 6, 7], keep: (c) => !(c.category === 'hard' && c.placement === 'tracked') },
    { id: 'bridge', title: 'Onto the bridge and the moonrise: shots 8 to 10', only: [8, 9, 10], keep: () => true },
    { id: 'railing', title: 'The railing: shots 11 to 15', only: [11, 12, 13, 14, 15], keep: () => true },
  ];
  return groups.map((gr) => {
    const shots = w.SHOTS.filter((s) => gr.only.includes(s.n)), span = [shots[0].start, shots[shots.length - 1].end], pts = [];
    for (const s of shots) for (const t of [s.start, s.end - 1e-6]) pts.push(w.cameraAt(s, t).pos);
    for (const c of detailCues(cues, gr, span)) {
      if (c.family === 'engine' && c.placement === 'tracked') { for (let t = Math.max(c.t0, span[0]); t <= Math.min(c.t1, span[1]); t += 0.25) { const p = c.place(t); if (p) pts.push(p); } continue; }
      const at = glyphTime(c, Math.max(c.t0, span[0])); if (at !== null) pts.push(c.place(at));
    }
    const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[2]), m = DETAIL.margin;
    const box = [Math.floor(Math.min(...xs) - m), Math.ceil(Math.max(...xs) + m), Math.floor(Math.min(...zs) - m), Math.ceil(Math.max(...zs) + m)];
    const scale = Math.min(DETAIL.maxScale, Math.floor(DETAIL.px / Math.max(box[1] - box[0], box[3] - box[2])));
    return { ...gr, span, view: [...box, scale] };
  });
}
// the voiced placed cues a detail map shows: sounding in its span, and kept by its group
const detailCues = (cues, group, span) => cues.filter((c) => voiced(c) && c.place && c.t0 < span[1] && c.t1 > span[0] && group.keep(c));

export function buildSoundDetail(group, { cues = CUES, w = WORLD } = {}, d = null, offset = [0, 0]) {
  const [x0, x1, z0, z1, scale] = group.view, pred = makePredictor({ cues, w });
  const width = Math.max((x1 - x0) * scale + 60, 760), head = [
    `${group.note ?? ''}${scale} px per meter. The cues sounding ${fmtT(group.span[0])} to ${fmtT(group.span[1])} s, each labelled with its onset; steps with their contact times, A's to the west of the print and B's to the east. Listeners, rings and shading as on the main map.`,
    `Backgrounds, unplaced: ${pred.locations.map((l) => `${l.name} ${pred.beds(l.name).map((c) => `${c.family} ${fmtDb(c.level)}`).join(', ')} (sum ${fmtDb(pred.bg[l.name])} dB)`).join('; ')}.`,
  ].flatMap((p) => wrapText(p, width - 60, 12));
  const top = 56 + head.length * 16;
  const v = makeView(x0, x1, z0, z1, scale, (width - (x1 - x0) * scale) / 2 + offset[0], top + offset[1]);
  d = d ?? new Draw(width, v.h + top + 30, { bg: '#080c16' });
  const L = makeLabeler(d, { bounds: { x0: offset[0] + 4, x1: offset[0] + width - 4, y0: offset[1] + 4, y1: offset[1] + v.h + top + 26 } }), g = api(d, v);
  const shots = w.SHOTS.filter((s) => group.only.includes(s.n));
  L.fixed(30 + offset[0], 36 + offset[1], `Sound detail: ${group.title}`, { size: 21, weight: 700, fill: '#fff' });
  head.forEach((line, i) => L.fixed(30 + offset[0], 58 + offset[1] + i * 16, line, { size: 12, fill: C.dim }));
  drawBase(d, v, w, g);
  const marks = cameraMarks(d, L, shots.map((s) => {
    const subj = typeof s.subject === 'function' ? s.subject(s.start) : s.subject, c0 = w.cameraAt(s, s.start);
    const len = Math.min(34, Math.max(4, Math.hypot(subj[0] - c0.pos[0], subj[2] - c0.pos[2]) + 1.5));
    return listenerGlyph(d, v, g, L, s, { cues, w, detail: true, wedgeLen: len, wedgeOp: 0.05 });
  }));
  const unplaced = drawUnplaced(d, v, w, g, L, pred, true);
  const placed = drawSources(d, v, g, L, cues.filter((c) => group.keep(c)), w, { label: 'all', detail: true, span: group.span, pred });
  unplaced();
  marks();
  labelBase(d, v, w, g, L, true);
  return { d, v, placed, labeler: L, pred };
}
