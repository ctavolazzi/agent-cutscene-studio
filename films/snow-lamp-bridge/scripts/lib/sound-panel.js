// Sound storyboard, part 3: one panel per shot (SOUND-PLAN.md 4.3). The film's own frame at the shot's middle, decoded
// from the published export, with every cue's screen point marked through the shot's camera (makeCamera(...).project);
// beside it the stereo field over the whole shot (x the pan from -1 to 1 with the lens's frame edges at +/- sin(hfov/2),
// y the time down the shot; glyph size the predicted level, filled in frame and seen, hollow out of frame, barred in
// frame but hidden, a cross behind the camera); a mini map of the listener; and the shot's cue list underneath, whose
// numbers the marks carry. A hidden point names its blocker in the list (SOUND-PLAN 3.7).
import { spawnSync } from 'node:child_process';
import { Draw } from './draw.js';
import { shotColor, makeView, wedge } from './map.js';
import { makeCamera, bearingOf, dirOf, clipPolyRect, clipLineRect, D2R } from './math.js';
import { CUES, LAWS, WORLD } from '../../src/audio/cues.js';
import { CONFIG } from '../../src/config.js';
import { makePredictor, makeSight, makeLabeler, colorOf, voiced, sounding, fmtT, fmtDb, glyph, wrapText, textBox, FAMILY, LAW_COLOR, RING_DB, ringRadius } from './sound-map.js';
import { DB } from './sound-timeline.js';

export const FW = 960, FH = 540; // the frame as drawn: the export's 480x270 internal pixels at 2x
const RIGHT = { x: 990, w: 500 };
export const SF = { x: RIGHT.x + 34, y: 66, w: RIGHT.w - 44, h: 322 }; // the stereo field's box
const MM = { x: RIGHT.x + 10, y: SF.y + SF.h + 46, w: RIGHT.w - 20, h: 250 };
export const PANEL_W = RIGHT.x + RIGHT.w + 10;
const ROW = 15, LIST_Y = MM.y + MM.h + 44; // the cue list starts under the frame's caption and the mini map

// A drawing that can also hold raster images (the decoded frame): written as <image> elements under everything else.
// Draw's own toSVG is untouched; this one inserts the background and the images after the defs.
export class PanelDraw extends Draw {
  constructor(w, h, opts = {}) { super(w, h, {}); this.fill = opts.bg ?? null; this.images = []; }
  image(x, y, w, h, href) { this.images.push({ x, y, w, h, href }); return this; }
  toSVG() {
    const lines = super.toSVG().split('\n'), at = lines[1].startsWith('<defs>') ? 2 : 1;
    const under = [];
    if (this.fill) under.push(`<rect width="${this.w}" height="${this.h}" fill="${this.fill}"/>`);
    for (const im of this.images) under.push(`<image x="${im.x}" y="${im.y}" width="${im.w}" height="${im.h}" preserveAspectRatio="none" style="image-rendering:pixelated" href="${im.href}"/>`);
    lines.splice(at, 0, ...under);
    return lines.join('\n');
  }
}

// The frames numbered `ns` of a video (frame n shows t = n / fps), as PNG buffers at the film's internal size: scaled
// down nearest-neighbour, so the export's whole-number upscale gives back the film's own pixels. One ffmpeg pass,
// selected by frame number; the PNG stream is cut chunk by chunk at each IEND.
// The panels show the frames lifted, as every review of this film does for its dark shots (shot 5 averages under 2 of
// 255): the marks must land on something you can see. The caption says so; the film itself is not changed.
export const PANEL_LIFT = "curves=all='0/0 0.25/0.6 1/1'";
export function decodeFrames(file, ns, { w = CONFIG.res.w, h = CONFIG.res.h, lift = PANEL_LIFT } = {}) {
  const sel = [...new Set(ns)].sort((a, b) => a - b);
  const vf = `select='${sel.map((n) => `eq(n,${n})`).join('+')}',scale=${w}:${h}:flags=neighbor${lift ? `,${lift}` : ''}`;
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', vf, '-fps_mode', 'passthrough', '-f', 'image2pipe', '-c:v', 'png', '-'], { maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`ffmpeg could not decode frames ${sel.join(', ')} of ${file}: ${String(r.stderr).trim()}`);
  const buf = r.stdout, out = new Map();
  let i = 0;
  while (i < buf.length) {
    const start = i;
    i += 8; // the PNG signature
    for (;;) { const len = buf.readUInt32BE(i), type = buf.toString('latin1', i + 4, i + 8); i += 12 + len; if (type === 'IEND') break; }
    out.set(sel[out.size], buf.subarray(start, i));
  }
  if (out.size !== sel.length) throw new Error(`decoded ${out.size} frames of ${sel.length} from ${file}`);
  return out;
}

// The frame a panel shows: the frame nearest the shot's middle, by its number in the export.
export function panelFrame(shot, w = WORLD) {
  const n = Math.round(((shot.start + shot.end) / 2) * w.FPS);
  return { n, t: n / w.FPS };
}

// The panel's cues, numbered in the order the list prints them (by onset): everything sounding in the shot.
export function panelCues(shot, cues = CUES) {
  return sounding(cues, shot.start, shot.end).slice().sort((a, b) => a.t0 - b.t0 || (a.id < b.id ? -1 : 1));
}
// Where a placed cue is marked on the frame: its place at the frame's time if it sounds then, else at the nearest moment
// of the shot that it sounds; through the shot's camera at the frame's time. { id, t, p, x, y, depth } or null.
export function framePoint(c, shot, tf, w = WORLD) {
  const t = Math.min(Math.max(tf, c.t0, shot.start), Math.min(c.t1, shot.end) - 1e-6);
  const p = c.place(t);
  if (!p) return null;
  const q = makeCamera(w.cameraAt(shot, tf), FW, FH).project(p);
  return { id: c.id, t, p, x: q ? q[0] : null, y: q ? q[1] : null, depth: q ? q[2] : null, sounding: c.t0 <= tf && tf < c.t1 };
}
const FIELD_STEPS = 20; // glyphs down the stereo field for a cue that sounds through the whole shot
// a field glyph's radius for a level, and its x for a pan
export const levelR = (db) => 2.5 + Math.min(1, Math.max(0, (db - DB.lo) / (DB.hi - DB.lo))) * 10;
export const fieldX = (pan) => SF.x + ((pan + 1) / 2) * SF.w;

// frame: { n, t, png (a Buffer of the decoded frame) } or null (drawn as a placeholder note). pred and sight: the level
// rule and the screen test (makePredictor, makeSight), passed in only to plant faults.
export function buildSoundPanel(shot, { cues = CUES, w = WORLD, frame = null, pred = makePredictor({ cues, w }), sight = makeSight(w) } = {}) {
  const list = panelCues(shot, cues), col = shotColor(shot.n);
  const fr = frame ?? { ...panelFrame(shot, w), png: null };
  const rows = Math.ceil(list.length / 2);
  const H = LIST_Y + 22 + rows * ROW + 20;
  const d = new PanelDraw(PANEL_W, H, { bg: '#080c16' });
  const L = makeLabeler(d, { pad: 1 });
  const num = new Map(list.map((c, i) => [c.id, i + 1]));
  const hfov = w.hfovDeg(shot.lens), edge = Math.sin((hfov * D2R) / 2), camAt = w.cameraAt(shot, fr.t).pos;

  // ---- the frame, and every placed cue's point on it
  if (fr.png) d.image(0, 0, FW, FH, `data:image/png;base64,${Buffer.from(fr.png).toString('base64')}`);
  else { d.rect(0, 0, FW, FH, { fill: '#0d1320' }); L.fixed(FW / 2, FH / 2, 'no frame: the published export was not read (--no-frames)', { size: 16, fill: '#8794b3', anchor: 'middle' }); }
  d.rect(0, 0, FW, FH, { stroke: '#7d8bab', sw: 1.5 });
  d.rect(0, 0, 64, 44, { fill: col });
  L.fixed(32, 33, String(shot.n), { size: 30, weight: 700, fill: '#0b1020', anchor: 'middle' });
  L.block({ x0: 0, x1: 64, y0: 0, y1: 44 });
  const points = [];
  const inner = { x0: 4, x1: FW - 4, y0: 4, y1: FH - 4 };
  for (const c of list.filter((x) => voiced(x) && x.place)) {
    const q = framePoint(c, shot, fr.t, w);
    if (!q) continue;
    points.push(q);
    if (q.x === null) continue; // behind the camera: in the list and the stereo field, not on the frame
    const inside = q.x >= 0 && q.x <= FW && q.y >= 0 && q.y <= FH, ccol = colorOf(c);
    // in frame but behind something, the car where the frame shows it: the mark is barred, the list names the blocker
    q.by = inside ? sight.hiddenBy(c, q.p, camAt, fr.t) : null;
    const x = Math.min(FW - 7, Math.max(7, q.x)), y = Math.min(FH - 7, Math.max(7, q.y));
    // an offered cue (default out) is dashed, never filled
    const lit = q.sounding && c.enabled;
    if (inside) {
      d.circle(q.x, q.y, 6, { fill: lit ? ccol : '#0b1020', fillOp: lit ? 0.9 : 0.6, stroke: lit ? '#0b1020' : ccol, sw: 2, cue: c.id, role: 'frame', ...(q.by ? { hidden: q.by } : {}), ...(c.enabled ? {} : { dash: [2, 2] }) });
      if (q.by) d.line([[q.x - 9, q.y], [q.x + 9, q.y]], { stroke: ccol, sw: 2.2, cue: c.id, role: 'frame-bar' });
    } else d.poly([[x, y - 6], [x + 6, y], [x, y + 6], [x - 6, y]], { fill: 'none', stroke: ccol, sw: 1.5, cue: c.id, role: 'frame-edge', cx: x, cy: y });
    L.block({ x0: x - 6, x1: x + 6, y0: y - 6, y1: y + 6 });
  }
  // numbers: each beside its point and kept inside the frame, on a dark chip so a bright frame cannot hide it
  const Lf = makeLabeler(d, { pad: 1, bounds: inner }), chips = [];
  Lf.boxes.push(...L.boxes);
  for (const q of points.filter((p) => p.x !== null)) {
    const c = list.find((x) => x.id === q.id), x = Math.min(FW - 7, Math.max(7, q.x)), y = Math.min(FH - 7, Math.max(7, q.y));
    Lf.place(x, y, String(num.get(c.id)), { size: 12, weight: 700, fill: colorOf(c) }, { r: 6, later: chips });
  }
  for (const it of chips) {
    if (it.k === 'text') { const b = textBox(it); d.rect(b.x0 - 1.5, b.y0 - 1, b.x1 - b.x0 + 3, b.y1 - b.y0 + 2, { fill: '#0b1020', fillOp: 0.7 }); }
    d.add(it);
  }
  const capLines = wrapText(`Frame ${fr.n} (${fmtT(fr.t)} s) of the published export, lifted for viewing (${PANEL_LIFT}; the film is darker). Marks: filled, sounding in this frame; hollow, sounding elsewhere in the shot (marked where it is then); barred, in frame but hidden (the list names what hides it); dashed, offered and off; diamond at the edge, out of frame.`, FW - 8, 11);
  capLines.forEach((line, i) => L.fixed(4, FH + 17 + i * 14, line, { size: 11, fill: '#c9d4ee' }));

  // ---- the stereo field over the whole shot
  L.fixed(RIGHT.x + 10, 22, 'STEREO FIELD OVER THE SHOT', { size: 13, weight: 700, fill: '#c9d4ee' });
  L.fixed(RIGHT.x + 10, 38, `x: pan, left to right. y: time, ${fmtT(shot.start)} at the top to ${fmtT(shot.end)} s.`, { size: 11, fill: '#8794b3' });
  const bedsAt = pred.beds(pred.locAt(shot.start).name);
  L.fixed(RIGHT.x + 10, 53, `Unplaced beds, on both sides, at ${fmtT(shot.start)} s: ${bedsAt.map((c) => `${c.family} ${fmtDb(pred.at(c, shot.start).db)}`).join(', ')}; background ${fmtDb(pred.refAt(shot.start))} dB.`, { size: 11, fill: '#8794b3' });
  const PX = fieldX, TY = (t) => SF.y + ((t - shot.start) / (shot.end - shot.start)) * SF.h;
  d.rect(SF.x, SF.y, SF.w, SF.h, { fill: '#0d1320', stroke: '#2a3552', sw: 1 });
  d.rect(PX(-edge), SF.y, PX(edge) - PX(-edge), SF.h, { fill: col, fillOp: 0.07 });
  for (const s of [-edge, edge]) d.line([[PX(s), SF.y], [PX(s), SF.y + SF.h]], { stroke: col, sw: 1.2, dash: [5, 4], edge: s });
  d.line([[PX(0), SF.y], [PX(0), SF.y + SF.h]], { stroke: '#2a3552', sw: 1 });
  L.fixed(PX(-1), SF.y + SF.h + 14, 'L -1', { size: 10, fill: '#8794b3' });
  L.fixed(PX(1), SF.y + SF.h + 14, 'R +1', { size: 10, fill: '#8794b3', anchor: 'end' });
  L.fixed(PX(0), SF.y + SF.h + 14, `frame edges +/- ${edge.toFixed(2)} (${shot.lens} mm, ${hfov.toFixed(1)} deg)`, { size: 10, fill: col, anchor: 'middle' });
  for (let t = Math.ceil(shot.start); t <= shot.end; t++) {
    d.line([[SF.x - 4, TY(t)], [SF.x, TY(t)]], { stroke: '#8794b3', sw: 1 });
    if ((t - Math.ceil(shot.start)) % (shot.end - shot.start > 8 ? 2 : 1) === 0) L.fixed(SF.x - 6, TY(t) + 3.5, String(t), { size: 10, fill: '#8794b3', anchor: 'end' });
  }
  d.line([[SF.x, TY(fr.t)], [SF.x + SF.w, TY(fr.t)]], { stroke: '#ffffff', strokeOp: 0.5, sw: 1, dash: [2, 3] });
  const field = [];
  for (const c of list.filter((x) => voiced(x) && x.place)) {
    const a = Math.max(c.t0, shot.start), b = Math.min(c.t1, shot.end), ts = [a];
    // a continuous cue every FIELD_STEP of the shot, so its glyphs stay apart down the field
    const step = Math.max(0.25, (shot.end - shot.start) / FIELD_STEPS);
    if (c.shape === 'continuous') for (let t = Math.ceil(a / step) * step; t < b; t += step) if (t > a + 1e-9) ts.push(t);
    const ccol = colorOf(c), pts = [];
    for (const t of ts) {
      const q = pred.at(c, t);
      if (!q) continue;
      const x = PX(q.pan), y = TY(t), r = levelR(q.db), { state, by } = sight.state(c, q.p, t), tag = { cue: c.id, role: 'field', at: t, state, by };
      pts.push([x, y]);
      field.push({ id: c.id, t, pan: q.pan, db: q.db, state, by });
      // behind the camera a cross; hidden, a hollow glyph with a bar through it; out of frame hollow; seen, filled
      if (state === 'behind') { d.line([[x - r, y - r], [x + r, y + r]], { stroke: ccol, sw: 1.6, ...tag, cx: x, cy: y, r }); d.line([[x - r, y + r], [x + r, y - r]], { stroke: ccol, sw: 1.6 }); continue; }
      d.circle(x, y, r, { fill: state === 'on' ? ccol : 'none', fillOp: state === 'on' ? 0.75 : 1, stroke: ccol, sw: 1.4, ...tag, ...(c.enabled ? {} : { dash: [2, 2] }) });
      if (state === 'hidden') d.line([[x - r - 2.5, y], [x + r + 2.5, y]], { stroke: ccol, sw: 1.6, cue: c.id, role: 'field-bar', at: t });
    }
    if (pts.length > 1) d.line(pts, { stroke: ccol, sw: 0.8, strokeOp: 0.6 });
  }
  const Ls = makeLabeler(d, { pad: 1, bounds: { x0: SF.x + 2, x1: SF.x + SF.w - 2, y0: SF.y + 2, y1: SF.y + SF.h - 2 } });
  for (const id of [...new Set(field.map((f) => f.id))]) {
    const f = field.find((x) => x.id === id), c = list.find((x) => x.id === id);
    Ls.place(PX(f.pan), TY(f.t), String(num.get(id)), { size: 10, weight: 700, fill: colorOf(c) }, { r: levelR(f.db) });
  }

  // ---- the listener: a mini map at the frame's time
  L.fixed(RIGHT.x + 10, MM.y - 10, `THE LISTENER AT ${fmtT(fr.t)} s, from above, north up`, { size: 13, weight: 700, fill: '#c9d4ee' });
  const miniDropped = miniMap(d, shot, fr.t, list, points, w, num);

  // ---- caption and the cue list
  const y0 = FH + 17 + capLines.length * 14 + 24;
  L.fixed(4, y0, `SHOT ${shot.n}  ${shot.title}`, { size: 22, weight: 700, fill: '#fff' });
  const loc = pred.locAt(fr.t).name;
  wrapText(`${fmtT(shot.start)} to ${fmtT(shot.end)} s (${(shot.end - shot.start).toFixed(0)} s), ${shot.lens} mm, the ${loc} (background ${fmtDb(pred.refAt(fr.t))} dB at the frame). ${list.length} cues sound in this shot. In the list, each placed cue's level (dB on the level plan's scale, read against that background), pan and place are at the moment it is marked on the frame. In the stereo field, glyph size is the level, ${DB.lo} to ${fmtDb(DB.hi)} dB: filled, in frame and seen; hollow, out of frame; barred, in frame but hidden; a cross, behind the camera.`, FW - 10, 12)
    .forEach((line, i) => L.fixed(4, y0 + 24 + i * 16, line, { size: 12, fill: col }));
  const COLS = [[0, '#'], [22, 'cue'], [262, 'sounds, s'], [372, 'level'], [432, 'pan'], [482, 'where']];
  for (const x of [14, 14 + PANEL_W / 2]) for (const [dx, s] of COLS) L.fixed(x + dx, LIST_Y, s, { size: 11, weight: 700, fill: '#8794b3' });
  list.forEach((c, i) => {
    const x = 14 + (i < rows ? 0 : PANEL_W / 2), y = LIST_Y + 18 + (i % rows) * ROW, ccol = colorOf(c);
    const pt = points.find((p) => p.id === c.id), at = pt ? pt.t : Math.min(Math.max(fr.t, c.t0, shot.start), Math.min(c.t1, shot.end) - 1e-6);
    const q = voiced(c) ? pred.at(c, at) : null;
    const where = !voiced(c) ? `modifies ${(c.meta.modifies ?? []).join(', ')}` : !c.place ? 'unplaced bed' : !q || !pt ? 'nowhere' : pt.x === null || q.behind ? 'behind the camera'
      : pt.x < 0 ? 'off left' : pt.x > FW ? 'off right' : pt.y < 0 ? 'off the top' : pt.y > FH ? 'off the foot' : pt.by ? `hidden (${pt.by})` : 'in frame';
    const cells = [[0, String(i + 1)], [22, c.id], [262, `${fmtT(c.t0)} to ${fmtT(c.t1)}`], [372, voiced(c) ? (q ? `${fmtDb(q.db)} dB` : '') : `${fmtDb(c.level)} dB`], [432, q && q.pan !== null ? q.pan.toFixed(2) : ''], [482, where + (c.new ? ', new' : '') + (c.enabled ? '' : ', offered, off')]];
    for (const [dx, s] of cells) if (s) L.fixed(x + dx, y, s, { size: 11, fill: dx === 0 || dx === 22 ? ccol : '#c9d4ee', ...(dx === 22 ? { cue: c.id, role: 'list' } : dx === 372 && q ? { cue: c.id, role: 'list-level', at, db: q.db } : dx === 482 ? { cue: c.id, role: 'list-where' } : {}) });
  });
  // every label placed or dropped counts, whichever placer it went through
  L.dropped.push(...Lf.dropped, ...Ls.dropped, ...miniDropped);
  return { d, frame: fr, points, field, list, labeler: L };
}

// The listener from above at time t: the camera's wedge, its behind half shaded, its rings, and the shot's sources at
// the points marked on the frame. The view is the camera and those points, square, with a margin.
function miniMap(d, shot, t, list, points, w, num) {
  const cam = w.cameraAt(shot, t), pts = [cam.pos, ...points.map((p) => p.p)];
  const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[2]), cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  const span = Math.max(6, Math.max(...xs) - Math.min(...xs), (Math.max(...zs) - Math.min(...zs)) * MM.w / MM.h) * 1.4, scale = MM.w / span;
  const v = makeView(cx - span / 2, cx + span / 2, cz - (MM.h / scale) / 2, cz + (MM.h / scale) / 2, scale, MM.x, MM.y);
  d.rect(MM.x, MM.y, MM.w, MM.h, { fill: '#0d1320', stroke: '#2a3552', sw: 1 });
  const P = (x, z) => [v.X(x), v.Y(z)], box = { x0: MM.x, x1: MM.x + MM.w, y0: MM.y, y1: MM.y + MM.h };
  const clip = (q) => q.every(([x, y]) => x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1);
  const poly = (pts, o) => { const c = clipPolyRect(pts, box); if (c) d.poly(c, o); };
  const yaw = bearingOf(cam.pos, cam.target), f = dirOf(yaw), r = [Math.cos(yaw * D2R), 0, Math.sin(yaw * D2R)], col = shotColor(shot.n);
  // behind, and the rings in front, inside the box only
  const R = span;
  const back = [P(cam.pos[0], cam.pos[2])];
  for (let i = 0; i <= 24; i++) { const a = Math.PI * (i / 24); back.push(P(cam.pos[0] + (r[0] * Math.cos(a) - f[0] * Math.sin(a)) * R, cam.pos[2] + (r[2] * Math.cos(a) - f[2] * Math.sin(a)) * R)); }
  poly(back, { fill: '#000000', fillOp: 0.3 });
  const laws = [...new Set(list.filter((c) => c.enabled && voiced(c) && c.place).map((c) => c.law))].sort(), a0 = Math.atan2(r[2], r[0]);
  for (const law of laws) for (const db of RING_DB) {
    const rm = ringRadius(LAWS[law], db), arc = [];
    for (let i = 0; i <= 48; i++) { const a = a0 - (Math.PI * i) / 48; arc.push(P(cam.pos[0] + Math.cos(a) * rm, cam.pos[2] + Math.sin(a) * rm)); }
    for (const sgm of clipLineRect(arc, box)) d.line(sgm, { stroke: LAW_COLOR[law], strokeOp: 0.55, sw: 1, dash: db === -6 ? undefined : db === -12 ? [6, 4] : db === -18 ? [2, 4] : [1, 6] });
  }
  const wd = wedge(cam, shot, span).map(([x, z]) => P(x, z));
  poly(wd, { fill: col, fillOp: 0.1, stroke: col, strokeOp: 0.8, sw: 1.2 });
  const lp = P(cam.pos[0] - r[0] * span * 0.08, cam.pos[2] - r[2] * span * 0.08), rp = P(cam.pos[0] + r[0] * span * 0.08, cam.pos[2] + r[2] * span * 0.08);
  for (const sgm of clipLineRect([lp, rp], box)) d.line(sgm, { stroke: col, sw: 1.6 });
  if (clip([rp])) d.circle(rp[0], rp[1], 3, { fill: col });
  for (const q of points) {
    const c = list.find((x) => x.id === q.id), [x, y] = P(q.p[0], q.p[2]);
    if (clip([[x, y]])) glyph(d, x, y, FAMILY[c.family].shape, 4, { fill: c.enabled ? colorOf(c) : 'none', stroke: c.enabled ? '#0b1020' : colorOf(c) });
  }
  const [cxp, cyp] = P(cam.pos[0], cam.pos[2]);
  d.circle(cxp, cyp, 7, { fill: col, stroke: '#0b1020', sw: 1.2 });
  const L = makeLabeler(d, { pad: 1, bounds: { x0: MM.x + 2, x1: MM.x + MM.w - 2, y0: MM.y + 2, y1: MM.y + MM.h - 2 } });
  const m = `${span.toFixed(1)} m across`;
  L.place(MM.x + MM.w - 6, MM.y + MM.h - 10, m, { size: 10, fill: '#8794b3' }, { cands: [[0, 0, 'w']], leader: false });
  for (const q of points) {
    const c = list.find((x) => x.id === q.id), [x, y] = P(q.p[0], q.p[2]);
    if (clip([[x, y]])) L.place(x, y, String(num.get(c.id)), { size: 9, fill: colorOf(c) }, { r: 4 });
  }
  return L.dropped;
}
