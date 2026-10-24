// Top-down set map, drawn from src/set.js, src/world.js and src/shots.js. North is up, east is right.
import { Draw, hslHex } from './draw.js';
import { clipPolyRect, clipLineRect, dirOf, bearingOf, D2R } from './math.js';
import { STREET, CROSS, BRIDGE, LAMP, RAIL, MOON, WIND, BUILDINGS, CITY } from '../../src/set.js';
import { carAt, peopleAt, CAR, T_CAR_STOP, carTimes } from '../../src/world.js';
import { SHOTS, cameraAt, hfovDeg, tcode } from '../../src/shots.js';
import { carEmergence } from './checks.js';

export const shotColor = (n) => hslHex(((n - 1) * 24 + 8) % 360, 85, 64);
const C = {
  bg: '#0d1320', river: '#10243d', road: '#222c40', walk: '#2d384f', deck: '#33405a', parapet: '#aab6d1',
  bldg: '#1f2a45', bldgLine: '#5b6f99', corner: '#2e3f73', cornerLine: '#a9bdff', city: '#172036', cityLine: '#33415f',
  lamp: '#ffb46b', moon: '#d8e2ff', line180: '#ff5d5d', text: '#c9d4ee', dim: '#7d8bab',
  A: '#ffb454', B: '#6fd3ff', car: '#e8eefc', sight: '#ffe07a',
};

export function makeView(x0, x1, z0, z1, scale, ox, oy) {
  const w = (x1 - x0) * scale, h = (z1 - z0) * scale;
  return { x0, x1, z0, z1, scale, ox, oy, w, h, X: (x) => ox + (x - x0) * scale, Y: (z) => oy + (z - z0) * scale, rect: { x0: ox, x1: ox + w, y0: oy, y1: oy + h } };
}

// All drawing is clipped geometrically to the view, so the output has no clip paths and Excalidraw can hold it.
function api(d, v) {
  const P = (x, z) => [v.X(x), v.Y(z)];
  const inside = (x, z) => v.X(x) >= v.rect.x0 && v.X(x) <= v.rect.x1 && v.Y(z) >= v.rect.y0 && v.Y(z) <= v.rect.y1;
  return {
    inside,
    poly(pts, o = {}) { const c = clipPolyRect(pts.map(([x, z]) => P(x, z)), v.rect); if (c) d.poly(c, o); },
    box(x0, z0, x1, z1, o = {}) { this.poly([[x0, z0], [x1, z0], [x1, z1], [x0, z1]], o); },
    line(pts, o = {}) { for (const seg of clipLineRect(pts.map(([x, z]) => P(x, z)), v.rect)) d.line(seg, o); },
    arrow(pts, o = {}) {
      const px = pts.map(([x, z]) => P(x, z));
      const last = pts[pts.length - 1];
      for (const seg of clipLineRect(px, v.rect)) d.line(seg, o);
      if (inside(last[0], last[1])) d.arrow([px[px.length - 2], px[px.length - 1]], { ...o, head: o.head ?? 10 });
    },
    circle(x, z, rpx, o = {}) { if (inside(x, z)) d.circle(v.X(x), v.Y(z), rpx, o); },
    text(x, z, s, o = {}) { if (inside(x, z)) d.text(v.X(x) + (o.dx ?? 0), v.Y(z) + (o.dy ?? 0), s, o); },
  };
}

const carCorners = (x, z, heading, len = CAR.length, wid = CAR.width) => {
  const f = dirOf(heading), r = [Math.cos(heading * D2R), 0, Math.sin(heading * D2R)];
  return [[1, -1], [1, 1], [-1, 1], [-1, -1]].map(([a, b]) => [x + f[0] * len / 2 * a + r[0] * wid / 2 * b, z + f[2] * len / 2 * a + r[2] * wid / 2 * b]);
};

export function wedge(cam, shot, length) {
  const yaw = bearingOf(cam.pos, cam.target);
  const half = hfovDeg(shot.lens) / 2;
  const pts = [[cam.pos[0], cam.pos[2]]];
  for (let i = 0; i <= 16; i++) {
    const dv = dirOf(yaw - half + (2 * half * i) / 16);
    pts.push([cam.pos[0] + dv[0] * length, cam.pos[2] + dv[2] * length]);
  }
  return pts;
}

// wedge reaches just past the subject, so a wide shot's wedge is long and a close one is short
const WEDGE_CAP = 34;
function wedgeLength(s) {
  const c = cameraAt(s, s.sketchAt);
  const subj = typeof s.subject === 'function' ? s.subject(s.sketchAt) : s.subject;
  const dist = Math.hypot(subj[0] - c.pos[0], subj[2] - c.pos[2]);
  return { len: Math.min(WEDGE_CAP, Math.max(4, dist + 1.5)), dist, subj };
}

// opts: detail (bigger labels and notes), only (array of shot numbers to draw cameras for)
export function drawMap(d, v, { detail = false, only = null } = {}) {
  const g = api(d, v);
  const fs = detail ? 14 : 12;
  d.rect(v.rect.x0, v.rect.y0, v.w, v.h, { fill: C.bg });

  // ---- land, water, streets
  g.box(-300, BRIDGE.z1, 400, BRIDGE.z0, { fill: C.river });
  g.box(-STREET.roadHalf, BRIDGE.z0, STREET.roadHalf, 90, { fill: C.road });
  g.box(-STREET.walkOuter, BRIDGE.z0, -STREET.roadHalf, 90, { fill: C.walk });
  g.box(STREET.roadHalf, BRIDGE.z0, STREET.walkOuter, 90, { fill: C.walk });
  g.box(-300, CROSS.z0, 400, CROSS.z1, { fill: C.road });
  g.box(-STREET.walkOuter, BRIDGE.z1, STREET.walkOuter, BRIDGE.z0, { fill: C.deck });
  g.box(-STREET.walkOuter, BRIDGE.zNorth, STREET.walkOuter, BRIDGE.z1, { fill: C.road });
  g.box(RAIL.x + 0.3, BRIDGE.z1, 6.0, BRIDGE.z0, { fill: C.parapet }); // east parapet, the one they lean on
  g.box(-6.0, BRIDGE.z1, -5.55, BRIDGE.z0, { fill: '#6f7c99' });

  // ---- buildings and city
  for (const b of BUILDINGS) {
    g.box(b.x0, b.z0, b.x1, b.z1, { fill: b.corner ? C.corner : C.bldg, stroke: b.corner ? C.cornerLine : C.bldgLine, sw: b.corner ? 2 : 1 });
    g.text((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2, b.corner ? `${b.id} CORNER ${b.h} m\nhides the car` : `${b.id}  ${b.h} m`, { fill: b.corner ? '#dfe7ff' : C.text, size: fs - 1, anchor: 'middle' });
  }
  for (const c of CITY) {
    g.box(c.x0, c.z0, c.x1, c.z1, { fill: C.city, stroke: C.cityLine, sw: 0.8 });
    if (c.aircraft) g.circle((c.x0 + c.x1) / 2, (c.z0 + c.z1) / 2, 3.5, { fill: '#ff3b3b' });
  }

  // ---- place names, drawn after the buildings so nothing covers them
  g.text(40, -23, 'RIVER (flows east to west, water 6 m below the deck)', { fill: '#4f7bb0', size: fs, anchor: 'middle' });
  g.text(0, 68, 'BRIDGE STREET', { fill: C.dim, size: fs, anchor: 'middle' });
  g.text(-42, 21, 'CROSS STREET', { fill: C.dim, size: fs });
  g.text(0, -52, 'bridge, 12 m wide', { fill: C.dim, size: fs - 1, anchor: 'middle' });
  g.text(7.0, -30, `east parapet\n${BRIDGE.parapetTop.toFixed(2)} m, 0.45 m thick`, { fill: C.text, size: fs - 1 });
  g.text(-18, -9.5, 'open snowy plaza\n(shot 10 camera)', { fill: C.dim, size: fs - 1, anchor: 'middle' });
  g.text(60, -3, 'CITY, south bank (receding east into fog)', { fill: C.dim, size: fs, anchor: 'middle' });
  g.text(60, -58, 'CITY, north bank', { fill: C.dim, size: fs, anchor: 'middle' });

  // ---- lamp and its pool
  const pool = [];
  for (let i = 0; i < 48; i++) pool.push([LAMP.base[0] + Math.cos((i / 48) * 6.2832) * LAMP.poolRadius, LAMP.base[1] + Math.sin((i / 48) * 6.2832) * LAMP.poolRadius]);
  g.poly(pool, { fill: C.lamp, fillOp: 0.1, stroke: C.lamp, strokeOp: 0.7, sw: 1.2, dash: [6, 5] });
  g.circle(LAMP.base[0], LAMP.base[1], detail ? 7 : 5, { fill: C.lamp, stroke: '#fff', sw: 1.5 });
  g.text(LAMP.base[0] + 1.1, LAMP.base[1] + (detail ? 2.4 : 1.4), detail ? `LAMP 4.5 m\nwarm pool r ${LAMP.poolRadius} m` : 'LAMP', { fill: C.lamp, size: fs, weight: 700 });

  // ---- 180 degree line
  g.line([[RAIL.x, -33], [RAIL.x, 13]], { stroke: C.line180, sw: 2, dash: [10, 7] });
  g.text(RAIL.x + 0.5, detail ? 10.5 : -34, detail ? '180 degree line' : '180 degree line (A and B), glance cameras stay WEST', { fill: C.line180, size: fs, weight: 700 });

  // ---- moon and wind
  const mid = [RAIL.x, (RAIL.zA + RAIL.zB) / 2], md = dirOf(MOON.azimuthDeg);
  g.arrow([mid, [mid[0] + md[0] * 40, mid[1] + md[2] * 40]], { stroke: C.moon, sw: 1.5, dash: [3, 5] });
  g.text(mid[0] + md[0] * 24, mid[1] + md[2] * 24 - 2.2, `moon, azimuth ${MOON.azimuthDeg} deg, clears the haze at 1:08`, { fill: C.moon, size: fs, anchor: 'middle' });

  // ---- car path with time marks
  const carPath = [];
  for (let t = carTimes.start; t <= T_CAR_STOP + 0.001; t += 0.1) { const c = carAt(t); carPath.push([c.x, c.z]); }
  g.line(carPath, { stroke: C.car, sw: 2.5 });
  for (const t of [14, 16, 18, 20, 22, 24, 26, 28]) {
    const c = carAt(t);
    g.circle(c.x, c.z, 3.5, { fill: C.car });
    g.text(c.x, c.z, tcode(t), { fill: C.car, size: fs - 1, dx: 7, dy: detail ? 4 : -7 });
  }
  const em = carEmergence(cameraAt(SHOTS[2], 14).pos);
  for (const [t, label, col, dy] of [[carTimes.start, `car and headlights on, ${tcode(carTimes.start)}`, '#aeb9d6', 14], [em.noseVisible, `nose clears corner ${tcode(em.noseVisible)}`, C.sight, -20]]) {
    const c = carAt(t);
    g.poly(carCorners(c.x, c.z, c.heading), { stroke: col, sw: 1.5, dash: [4, 3] });
    g.text(c.x, c.z, label, { fill: col, size: fs - 1, dy, anchor: 'middle' });
  }
  const stop = carAt(T_CAR_STOP);
  g.poly(carCorners(stop.x, stop.z, 0), { fill: '#2c3550', stroke: C.car, sw: 2 });
  // sight line from the shot 3 camera past the corner: the car is hidden behind the building until it crosses this
  const c3 = cameraAt(SHOTS[2], 14), dv = [6.2 - c3.pos[0], 25 - c3.pos[2]], k = 60 / Math.hypot(...dv);
  g.line([[c3.pos[0], c3.pos[2]], [c3.pos[0] + dv[0] * k, c3.pos[2] + dv[1] * k]], { stroke: C.sight, sw: 1.2, dash: [2, 6] });
  g.text(33, 29, 'sight line from camera 3 past the corner', { fill: C.sight, size: fs - 1 });

  // ---- the two people
  for (const [id, col] of [['A', C.A], ['B', C.B]]) {
    const pts = [];
    for (let t = 30.5; t <= 63.5; t += 0.25) { const p = peopleAt(t)[id]; if (p) pts.push([p.x, p.z]); }
    g.line(pts, { stroke: col, sw: detail ? 2.5 : 2 });
    for (const [t, lab] of [[34, '0:34'], [44, '0:44'], [54, '0:54'], [62, '1:02']]) {
      const p = peopleAt(t)[id];
      g.circle(p.x, p.z, detail ? 6 : 4, { fill: col, stroke: '#0d1320', sw: 1 });
      if (detail) g.text(p.x, p.z, lab, { fill: col, size: fs - 2, dx: id === 'A' ? -9 : 9, dy: 4, anchor: id === 'A' ? 'end' : 'start' });
    }
    const end = peopleAt(70)[id];
    g.circle(end.x, end.z, detail ? 10 : 6, { fill: col, stroke: '#fff', sw: 2 });
    g.text(end.x, end.z, id, { fill: '#0d1320', size: detail ? 14 : 10, weight: 700, anchor: 'middle', dy: detail ? 5 : 3.5 });
  }

  // ---- cameras: wedges first, then paths, then markers
  const list = SHOTS.filter((s) => !only || only.includes(s.n));
  for (const s of list) {
    const col = shotColor(s.n), c0 = cameraAt(s, s.start), { len, dist, subj } = wedgeLength(s);
    g.poly(wedge(c0, s, len), { fill: col, fillOp: len > 20 ? 0.05 : 0.12, stroke: col, strokeOp: 0.85, sw: 1.2 });
    if (dist > len) g.line([[c0.pos[0], c0.pos[2]], [subj[0], subj[2]]], { stroke: col, strokeOp: 0.7, sw: 1, dash: [2, 5] }); // ray on to the subject
    const c1 = cameraAt(s, s.end - 0.01);
    const moved = Math.hypot(c1.pos[0] - c0.pos[0], c1.pos[2] - c0.pos[2]) > 0.3;
    const turned = Math.abs(((bearingOf(c1.pos, c1.target) - bearingOf(c0.pos, c0.target) + 540) % 360) - 180) < 177;
    if (turned || moved) g.poly(wedge(c1, s, len), { stroke: col, strokeOp: 0.8, sw: 1.2, dash: [5, 4] });
    if (s.orbit) {
      const arc = [];
      for (let i = 0; i <= 12; i++) arc.push(cameraAt(s, s.start + ((s.end - s.start) * i) / 12).pos);
      g.arrow(arc.map((p) => [p[0], p[2]]), { stroke: col, sw: 2.5 });
    } else if (moved) {
      g.arrow([[c0.pos[0], c0.pos[2]], [c1.pos[0], c1.pos[2]]], { stroke: col, sw: 2.5 });
      g.circle(c1.pos[0], c1.pos[2], detail ? 8 : 5, { stroke: col, sw: 2 });
    }
  }
  for (const s of list) {
    const col = shotColor(s.n), c0 = cameraAt(s, s.start);
    g.circle(c0.pos[0], c0.pos[2], detail ? 14 : 10, { fill: col, stroke: '#0d1320', sw: 1.5 });
    g.text(c0.pos[0], c0.pos[2], String(s.n), { fill: '#0d1320', size: detail ? 16 : 12, weight: 700, anchor: 'middle', dy: detail ? 6 : 4.5 });
    if (detail) g.text(c0.pos[0], c0.pos[2], `${s.lens}mm  ${tcode(s.start)}`, { fill: col, size: 12, dx: -20, dy: 4, anchor: 'end' });
  }
}

export function drawTimeline(d, x, y, w) {
  const total = 112, pxPerS = w / total;
  d.text(x, y - 8, 'TIMELINE (hard cuts, one world clock)', { fill: C.text, size: 13, weight: 700 });
  for (const s of SHOTS) {
    const x0 = x + s.start * pxPerS, w0 = (s.end - s.start) * pxPerS;
    d.rect(x0, y, w0 - 1, 34, { fill: shotColor(s.n), fillOp: 0.9 });
    d.text(x0 + w0 / 2, y + 15, String(s.n), { fill: '#0d1320', size: 15, weight: 700, anchor: 'middle' });
    d.text(x0 + w0 / 2, y + 29, `${s.end - s.start}s`, { fill: '#0d1320', size: 10, anchor: 'middle' });
    d.text(x0 + 2, y + 50, tcode(s.start), { fill: C.dim, size: 10 });
  }
  d.text(x + w, y + 50, '1:52', { fill: C.dim, size: 10, anchor: 'end' });
  for (const [t, label, col] of [[13, 'headlights on', '#e8eefc'], [36.4, 'headlights cut', '#e8eefc'], [68, 'moon clears haze', C.moon], [78, 'lighter', C.lamp]]) {
    d.line([[x + t * pxPerS, y - 2], [x + t * pxPerS, y + 36]], { stroke: col, sw: 1.5, dash: [3, 3] });
    d.text(x + t * pxPerS + 3, y + 63, label, { fill: col, size: 10 });
  }
}

export function drawLegend(d, x, y) {
  const rows = [[C.A, 'A path (0:30 to 1:03)'], [C.B, 'B path'], [C.car, 'car path, marks every 2 s'], [C.lamp, 'lamp warm pool, r 7 m'], [C.line180, '180 degree line'], [C.moon, 'moon bearing'], [C.sight, 'sight line past the corner']];
  d.text(x, y, 'LEGEND', { fill: C.text, size: 13, weight: 700 });
  rows.forEach(([c, label], i) => { d.rect(x, y + 10 + i * 20, 22, 6, { fill: c }); d.text(x + 30, y + 17 + i * 20, label, { fill: C.text, size: 12 }); });
  d.text(x, y + 168, 'Numbered circles are cameras. Solid wedge: field of view at the shot\nstart, reaching the subject. Dashed wedge: at the shot end.\nArrow: camera move. North is up.\nWind blows from the east-north-east toward the street side.', { fill: C.dim, size: 11 });
}

const MAIN = { x0: -45, x1: 90, z0: -70, z1: 75, scale: 10 };

// Main map. `offset` places it inside a larger Excalidraw sheet.
export function buildMainMap(d = null, offset = [0, 0]) {
  const v = makeView(MAIN.x0, MAIN.x1, MAIN.z0, MAIN.z1, MAIN.scale, 40 + offset[0], 150 + offset[1]);
  d = d ?? new Draw(v.w + 80, v.h + 190, { bg: '#080c16' });
  d.text(40 + offset[0], 52 + offset[1], 'Snow, Lamp, Bridge: set map, top-down', { fill: '#fff', size: 26, weight: 700 });
  d.text(40 + offset[0], 76 + offset[1], 'Generated from src/set.js, src/world.js and src/shots.js. Stage 1 storyboard, for your markup.', { fill: C.dim, size: 14 });
  drawTimeline(d, 40 + offset[0], 112 + offset[1], v.w);
  drawMap(d, v);
  drawLegend(d, v.X(-43), v.Y(-67));
  return { d, v };
}

export const DETAIL_GROUPS = [
  { id: 'arrival', title: 'Arrival and reveal: shots 4, 5, 6, 7', only: [4, 5, 6, 7], view: [-6, 12, -14, 6, 42] },
  { id: 'bridge', title: 'Onto the bridge and the moonrise: shots 8, 9, 10', only: [8, 9, 10], view: [-22, 10, -27, 2, 32] },
  { id: 'glances', title: 'The railing: shots 11 to 15', only: [11, 12, 13, 14, 15], view: [-8, 10, -20, 6, 38] },
];

export function buildDetailMap(group, d = null, offset = [0, 0]) {
  const [x0, x1, z0, z1, scale] = group.view;
  const v = makeView(x0, x1, z0, z1, scale, 30 + offset[0], 118 + offset[1]);
  d = d ?? new Draw(v.w + 60, v.h + 148, { bg: '#080c16' });
  d.text(30 + offset[0], 40 + offset[1], `Detail: ${group.title}`, { fill: '#fff', size: 21, weight: 700 });
  d.text(30 + offset[0], 64 + offset[1], `${scale} px per meter. Wedges reach the subject. Time marks are mm:ss on the world clock.`, { fill: C.dim, size: 13 });
  d.text(30 + offset[0], 86 + offset[1], 'Car stops at 0:29, front bumper z -0.5.  A and B walk 0:44.5 to 1:02 at about 0.6 m/s (circles: orange A, blue B).', { fill: C.text, size: 12 });
  d.text(30 + offset[0], 104 + offset[1], 'A: 1.80 m, long dark coat, bare head, smokes, stands north.  B: 1.68 m, puffy jacket, beanie, scarf, stands south.', { fill: C.text, size: 12 });
  drawMap(d, v, { detail: true, only: group.only });
  return { d, v };
}
