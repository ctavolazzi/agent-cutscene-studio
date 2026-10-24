// Gate 2 measurements: the numbers the six Gate 2 decisions rest on, measured from the shot data and the review stills.
// Nothing here changes staging; it reads set.js, world.js and shots.js, storyboard/report.json and the PNGs in
// review/round-02/. One test render (the lamp moved 1.5 m south) patches a copy of dist/index.html under out/.
// Usage: node scripts/gate2-measure.js [--out review/round-02/measure.json] [--no-render]
// Prints a summary and writes the JSON the Gate 2 review page reads (scripts/blockout-page.js). --no-render skips the
// test render and measures the frames already in review/round-02/decisions/south-*.png.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { makeCamera } from './lib/math.js';
import { renderStills } from './stills.js';
import { LAMP, BRIDGE } from '../src/set.js';
import { SHOTS, cameraAt } from '../src/shots.js';
import { carAt, carTimes, peopleAt, FPS } from '../src/world.js';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const ROUND = resolve(ROOT, 'review/round-02');
const REPORT = JSON.parse(readFileSync(resolve(ROOT, 'storyboard/report.json'), 'utf8'));
const W = 960, H = 540;
const shot = (n) => SHOTS.find((s) => s.n === n);
const r3 = (v) => Math.round(v * 1000) / 1000;
const r2 = (v) => Math.round(v * 100) / 100;
const frames = (s, from = s.start) => { const out = []; for (let f = Math.round(from * FPS); f < Math.round(s.end * FPS); f++) out.push(f / FPS); return out; };
const project = (cam, p) => { const q = cam.project(p); return q ? [q[0] / W, q[1] / H] : null; };
const inFrame = (q) => q && q[0] >= 0 && q[0] <= 1 && q[1] >= 0 && q[1] <= 1;
const span = (xs) => [r2(Math.min(...xs)), r2(Math.max(...xs))];

// ---------- shot 3 ----------

// Where the car centre sits on screen from the start of the pan to the cut, split at the start of the turn
function shot3Drift() {
  const s = shot(3), panStart = 17.4;
  const pts = frames(s, panStart).map((t) => {
    const c = carAt(t), q = c.present ? project(makeCamera(cameraAt(s, t), W, H), [c.x, 0.7, c.z]) : null;
    return { t, sx: q && q[0] >= 0 && q[0] <= 1 ? q[0] : null };
  }).filter((p) => p.sx !== null);
  const straight = pts.filter((p) => p.t < carTimes.turn0);
  const lo = straight.reduce((a, p) => (p.sx < a.sx ? p : a)), hi = pts.reduce((a, p) => (p.sx > a.sx ? p : a)), end = pts[pts.length - 1];
  return {
    panStart, noseVisible: r3(REPORT.carFromShot3.noseVisible), brake: r3(carTimes.brake), turn0: r3(carTimes.turn0), turn1: r3(carTimes.turn1),
    minSx: r3(lo.sx), minAt: r3(lo.t), maxSx: r3(hi.sx), maxAt: r3(hi.t), endSx: r3(end.sx), endAt: r3(end.t),
    drift: r3(hi.sx - lo.sx), back: r3(hi.sx - end.sx),
  };
}

// ---------- shot 8 ----------

// Half widths at the shoulder including the upper arm: people.js STYLE shoulderHalf + upperArmR, times height / 1.8
const HALF = { A: 0.242, B: 0.264 };
// screen x extent of a body standing at ground point p, half width `half`, at height y, seen from cam
function outline(cam, p, half, y = 1.35) {
  const dx = p.x - cam.pos[0], dz = p.z - cam.pos[2], L = Math.hypot(dx, dz), u = [-dz / L, dx / L];
  const a = project(cam, [p.x + u[0] * half, y, p.z + u[1] * half]), b = project(cam, [p.x - u[0] * half, y, p.z - u[1] * half]);
  return [Math.min(a[0], b[0]), Math.max(a[0], b[0])];
}
// The pair over shot 8 with B moved by [dx, dz] (camera unchanged)
function pairStats([dx, dz]) {
  const s = shot(8);
  let head = null, body = null;
  let overlap = 0;
  for (const t of frames(s)) {
    const P = peopleAt(t), A = P.A, B = { ...P.B, x: P.B.x + dx, z: P.B.z + dz }, cam = makeCamera(cameraAt(s, t), W, H);
    const hg = project(cam, [B.x, 1.58, B.z])[0] - project(cam, [A.x, 1.72, A.z])[0];
    const og = outline(cam, B, HALF.B)[0] - outline(cam, A, HALF.A)[1];
    if (!head || hg < head.gap) head = { t: r3(t), gap: r3(hg), across: r2(Math.abs(B.x - A.x)) };
    if (!body || og < body.gap) body = { t: r3(t), gap: r3(og) };
    if (og < 0) overlap++;
  }
  return { headGap: head, outlineGap: body, overlapSeconds: r2(overlap / FPS) };
}
function shot8Pair() {
  const s = shot(8), fs = frames(s);
  const now = pairStats([0, 0]);
  const variants = [['B 0.5 m further back', [0, 0.5]], ['B 0.15 m further across', [-0.15, 0]], ['B 0.25 m further across', [-0.25, 0]], ['B 0.35 m further across', [-0.35, 0]], ['B 0.5 m further across', [-0.5, 0]]]
    .map(([label, d]) => ({ label, move: d, ...pairStats(d) }));
  // heads closer than 0.04 of the frame (about two head widths at this distance)
  const gaps = fs.map((t) => { const P = peopleAt(t), cam = makeCamera(cameraAt(s, t), W, H); return [t, project(cam, [P.B.x, 1.58, P.B.z])[0] - project(cam, [P.A.x, 1.72, P.A.z])[0]]; });
  const near = gaps.filter(([, g]) => g < 0.04).map(([t]) => t);
  // the lamp post against A: is the post inside A's outline, and from when to the cut
  const post = fs.map((t) => {
    const P = peopleAt(t), cam = makeCamera(cameraAt(s, t), W, H);
    const px = project(cam, [LAMP.base[0], 2.0, LAMP.base[1]])[0], o = outline(cam, P.A, HALF.A);
    return { t, minusHead: px - project(cam, [P.A.x, 1.72, P.A.z])[0], inside: px >= o[0] && px <= o[1] };
  });
  let k = post.length; while (k > 0 && post[k - 1].inside) k--;
  const at = (t) => post.reduce((a, p) => (Math.abs(p.t - t) < Math.abs(a.t - t) ? p : a));
  const head = now.headGap, P = peopleAt(head.t), cam = makeCamera(cameraAt(s, head.t), W, H);
  return {
    cameraX: cameraAt(s, s.start).pos[0], aLeftOfBEveryFrame: gaps.every(([, g]) => g > 0),
    closest: { t: head.t, gap: head.gap, across: head.across, aSx: r3(project(cam, [P.A.x, 1.72, P.A.z])[0]), postSx: r3(project(cam, [LAMP.base[0], 2.0, LAMP.base[1]])[0]) },
    under: near.length ? { gap: 0.04, from: r3(near[0]), to: r3(near[near.length - 1]), seconds: r2(near.length / FPS) } : null,
    outline: { gap: now.outlineGap, overlapSeconds: now.overlapSeconds, halfWidths: HALF },
    post: { insideAFrom: k < post.length ? r3(post[k].t) : null, minusHeadAt: [54, 57.5, 59, 59.5, fs[fs.length - 1]].map((t) => ({ t: r3(at(t).t), dx: r3(at(t).minusHead) })) },
    variants,
  };
}

// ---------- the lamp ----------

// The pool is centred under the lantern (lights.js aims the spot straight down from LAMP.head), so distances are from
// that ground point. LAMP.poolRadius is the radius the plan asks Stage 4 to light, not a measured edge: the blockout
// spot has no range cutoff. North is -Z.
const POOL = [LAMP.head[0], LAMP.head[2]];
function lampReach() {
  const moments = [['A boot lands', 'A', 31.8], ['B boot lands', 'B', 33.2], ['A at the rail', 'A', 64], ['B at the rail', 'B', 64]];
  const shifts = { now: 0, north: -1.5, south: 1.5 };
  const rows = moments.map(([label, who, t]) => {
    const p = peopleAt(t)[who];
    const d = Object.fromEntries(Object.entries(shifts).map(([k, dz]) => [k, r2(Math.hypot(p.x - POOL[0], p.z - (POOL[1] + dz)))]));
    return { label, who, t, at: [r2(p.x), r2(p.z)], ...d };
  });
  return { poolCentre: POOL, poolRadiusTarget: LAMP.poolRadius, northIs: '-Z', rows, postInShots: postInShots() };
}
// Shots whose frame holds any part of the post (sampled every 0.25 s, ignoring what stands in front of it), for the
// lamp where it is and moved 1.5 m south. Shots framed on the lamp head re-aim with it, so they keep it either way.
function postInShots() {
  const aimed = SHOTS.filter((s) => (s.keys || []).some((k) => k.frame && k.frame.P === LAMP.head)).map((s) => s.n);
  const seen = (z) => SHOTS.filter((s) => {
    if (aimed.includes(s.n)) return true;
    for (let t = s.start; t < s.end; t += 0.25) {
      const cam = makeCamera(cameraAt(s, t), W, H);
      for (let y = 0; y <= LAMP.height; y += 0.25) if (inFrame(project(cam, [LAMP.base[0], y, z]))) return true;
    }
    return false;
  }).map((s) => s.n);
  const now = seen(LAMP.base[1]), south = seen(LAMP.base[1] + 1.5);
  // how close the moved post comes to shot 4's camera, the one placed at the lamp base
  const s4 = shot(4), c4 = cameraAt(s4, s4.start).pos;
  return { aimedAtLamp: aimed, now, south, gainedSouth: south.filter((n) => !now.includes(n)), lostSouth: now.filter((n) => !south.includes(n)),
    shot4PostDistanceSouth: r2(Math.hypot(c4[0] - LAMP.base[0], c4[2] - (LAMP.base[1] + 1.5))) };
}

// The test render: the lamp (base and lantern) moved 1.5 m south in a copy of the built scene, shot 5 at both landings
const SOUTH_TIMES = [31.8, 33.2];
const southFile = (t) => `decisions/south-t${t.toFixed(3).padStart(7, '0')}.png`;
async function southRender() {
  const dist = resolve(ROOT, 'dist/index.html');
  if (!existsSync(dist)) throw new Error('dist/index.html is missing: run npm run build first');
  const html = readFileSync(dist, 'utf8');
  const from = `base:[${LAMP.base[0]},${LAMP.base[1]}],height:${LAMP.height},head:[${LAMP.head.join(',')}]`;
  const to = `base:[${LAMP.base[0]},${LAMP.base[1] + 1.5}],height:${LAMP.height},head:[${LAMP.head[0]},${LAMP.head[1]},${LAMP.head[2] + 1.5}]`;
  if (html.split(from).length !== 2) throw new Error(`the lamp constant ${from} is not in dist/index.html exactly once`);
  mkdirSync(resolve(ROOT, 'out'), { recursive: true });
  const file = resolve(ROOT, 'out/gate2-lamp-south.html');
  writeFileSync(file, html.replace(from, to));
  await renderStills({ items: SOUTH_TIMES.map((t) => ({ t, out: resolve(ROUND, southFile(t)) })), scale: 4, overlay: true, file });
}

// ---------- shot 5, the front wheel ----------

// The front-left (driver side) wheel. The silhouette of a short cylinder is convex, so the clipped convex hull of its
// two rims is the area it covers on screen.
const WHEEL = { centre: [carAt(32).x - 0.82, 0.33, carAt(32).z - 1.45], radius: 0.33, halfWidth: 0.11 };
function hull(pts) {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], hi = [];
  for (const q of p) { while (lo.length > 1 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.reverse()) { while (hi.length > 1 && cr(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
  return lo.slice(0, -1).concat(hi.slice(0, -1));
}
function clipToFrame(poly) {
  const edges = [[(q) => q[0] >= 0, (a, b) => a[0] / (a[0] - b[0])], [(q) => q[0] <= 1, (a, b) => (a[0] - 1) / (a[0] - b[0])],
    [(q) => q[1] >= 0, (a, b) => a[1] / (a[1] - b[1])], [(q) => q[1] <= 1, (a, b) => (a[1] - 1) / (a[1] - b[1])]];
  let out = poly;
  for (const [inside, cut] of edges) {
    const src = out; out = [];
    for (let i = 0; i < src.length; i++) {
      const a = src[i], b = src[(i + 1) % src.length];
      const lerp = () => { const u = cut(a, b); return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]; };
      if (inside(a)) { out.push(a); if (!inside(b)) out.push(lerp()); } else if (inside(b)) out.push(lerp());
    }
    if (!out.length) return [];
  }
  return out;
}
const area = (poly) => Math.abs(poly.reduce((s, a, i) => { const b = poly[(i + 1) % poly.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0)) / 2;
function wheelRim(cam) {
  const { centre: c, radius: R, halfWidth: hw } = WHEEL, pts = [];
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * 2 * Math.PI;
    for (const dx of [-hw, hw]) { const q = project(cam, [c[0] + dx, c[1] + R * Math.sin(a), c[2] + R * Math.cos(a)]); if (q) pts.push(q); }
  }
  return pts;
}
const wheelCover = (cam) => { const pts = wheelRim(cam); return pts.length < 3 ? 0 : area(clipToFrame(hull(pts))); };
const wheelHeight = (cam) => { const ys = wheelRim(cam).map((q) => q[1]); return Math.max(...ys) - Math.min(...ys); };
// how tall 0.3 m stands at A's feet, as a share of the frame height
const feetScale = (cam, p) => { const a = project(cam, [p.x, 0, p.z]), b = project(cam, [p.x, 0.3, p.z]); return a && b ? Math.abs(a[1] - b[1]) : null; };
// the same camera with another lens, stepped back along its horizontal view direction
function steppedBack(c, metres, lens) {
  const d = [c.target[0] - c.pos[0], c.target[2] - c.pos[2]], L = Math.hypot(d[0], d[1]), u = [d[0] / L, d[1] / L];
  return { ...c, lens, pos: [c.pos[0] - u[0] * metres, c.pos[1], c.pos[2] - u[1] * metres], target: [c.target[0] - u[0] * metres, c.target[1], c.target[2] - u[1] * metres] };
}
function shot5Wheel() {
  const s = shot(5);
  const variants = [['now', 0, s.lens], ['50mm, 0.5 m back', 0.5, 50], ['50mm, 1.0 m back', 1.0, 50], ['50mm, 1.5 m back', 1.5, 50]];
  const cams = (t) => variants.map(([, m, lens]) => makeCamera(steppedBack(cameraAt(s, t), m, lens), W, H));
  const rows = [34.4, 35.0, 35.5, 36.0, 36.4].map((t) => {
    const c = cameraAt(s, t), cs = cams(t);
    const row = { t, distance: r2(Math.hypot(c.pos[0] - WHEEL.centre[0], c.pos[2] - WHEEL.centre[2])) };
    variants.forEach(([name], i) => { row[name] = r3(wheelCover(cs[i])); });
    return row;
  });
  // every frame from the end of the hold to the end of the shot; the wheel counts as in frame above 0.5% of it
  const worst = {}, worstAt = {}, seen = [];
  for (const t of frames(s, s.keys[1].t)) {
    cams(t).forEach((cam, i) => { const v = wheelCover(cam), n = variants[i][0]; if (!(v <= worst[n])) { worst[n] = v; worstAt[n] = t; } if (i === 0 && v > 0.005) seen.push(t); });
  }
  // sizes in the 50mm, 1.5 m variant against now, 35.0 to 36.4 s: the wheel's height and A's feet
  const sizes = frames(s, 35).filter((t) => t <= 36.4).map((t) => {
    const cs = cams(t), A = peopleAt(t).A;
    return { wheel: wheelHeight(cs[3]) / wheelHeight(cs[0]), feet: feetScale(cs[3], A) / feetScale(cs[0], A) };
  });
  const c0 = cameraAt(s, s.keys[1].t).pos, c1 = cameraAt(s, carTimes.lightsOff0).pos;
  return {
    wheel: WHEEL, holdUntil: s.keys[1].t, inFrame: [r3(seen[0]), r3(seen[seen.length - 1])], truckMetres: r2(Math.hypot(c1[0] - c0[0], c1[2] - c0[2])), variants: variants.map((v) => v[0]), rows,
    worstByVariant: Object.fromEntries(variants.map(([n]) => [n, r3(worst[n])])), worstAt: Object.fromEntries(variants.map(([n]) => [n, r3(worstAt[n])])),
    variant15: { wheelHeightRatio: span(sizes.map((x) => x.wheel)), feetRatio: span(sizes.map((x) => x.feet)) },
  };
}

// ---------- brightness ----------

// Mean luma (0 to 255) of a review still below the overlay strip, decoded by ffmpeg
function stillLevel(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-vf', 'crop=iw:ih*0.94:0:ih*0.06', '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1'], { maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error(`ffmpeg could not read ${file}: ${r.stderr}`);
  const px = r.stdout, hist = new Array(256).fill(0);
  let sum = 0;
  for (const v of px) { sum += v; hist[v]++; }
  let acc = 0, p99 = 0;
  for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= 0.99 * px.length) { p99 = i; break; } }
  return { mean: Math.round((sum / px.length) * 10) / 10, p99 };
}
function levels() {
  const files = [
    ...['30.500', '31.200', '31.800', '32.600', '33.200', '34.000', '35.000', '35.500', '36.000', '37.000', '38.500'].map((t) => [`shot 5 at ${Number(t)} s`, `decisions/t0${t}.png`]),
    ...SOUTH_TIMES.map((t) => [`shot 5 at ${t} s, lamp 1.5 m south`, southFile(t)]),
    ['shot 6 middle', 'stills/shot-06-mid.png'], ['shot 7 middle', 'stills/shot-07-mid.png'], ['shot 9 middle', 'stills/shot-09-mid.png'],
  ];
  return files.filter(([, f]) => existsSync(resolve(ROUND, f))).map(([label, f]) => ({ label, file: f, ...stillLevel(resolve(ROUND, f)) }));
}

export function measure() {
  return {
    note: 'Measured from src/ data and review/round-02 stills by scripts/gate2-measure.js. Screen x is a fraction of the frame width (0 left, 1 right).',
    carTimes: { doors: carTimes.doors, lightsOff: [carTimes.lightsOff0, carTimes.lightsOff1] },
    parapetTop: BRIDGE.parapetTop,
    shot3: shot3Drift(), shot8: shot8Pair(), lamp: lampReach(), shot5Wheel: shot5Wheel(), levels: levels(),
  };
}

const isMain = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { values: a } = parseArgs({ options: { out: { type: 'string', default: resolve(ROUND, 'measure.json') }, 'no-render': { type: 'boolean', default: false } }, strict: true });
  try {
    if (!a['no-render']) await southRender();
    const m = measure();
    writeFileSync(resolve(a.out), `${JSON.stringify(m, null, 1)}\n`);
    const s3 = m.shot3, s8 = m.shot8, w = m.shot5Wheel, ps = m.lamp.postInShots;
    console.log(`shot 3: car x ${s3.minSx} (${s3.minAt} s) to ${s3.maxSx} (${s3.maxAt} s), back to ${s3.endSx} by ${s3.endAt} s; turn ${s3.turn0} to ${s3.turn1}; nose visible ${s3.noseVisible}`);
    console.log(`shot 8: heads closest ${s8.closest.gap} at ${s8.closest.t} s (${s8.closest.across} m across the deck); outlines ${s8.outline.gap.gap} at ${s8.outline.gap.t} s, overlapping ${s8.outline.overlapSeconds} s; post inside A from ${s8.post.insideAFrom} s`);
    for (const v of s8.variants) console.log(`  ${v.label}: heads ${v.headGap.gap} (${v.headGap.across} m across), outlines ${v.outlineGap.gap}, overlapping ${v.overlapSeconds} s`);
    for (const r of m.lamp.rows) console.log(`pool centre to ${r.label}: now ${r.now} m, 1.5 m north ${r.north} m, 1.5 m south ${r.south} m (target radius ${m.lamp.poolRadiusTarget} m)`);
    console.log(`post in shots now ${ps.now.join(' ')}; south ${ps.south.join(' ')} (gains ${ps.gainedSouth.join(' ') || 'none'}, loses ${ps.lostSouth.join(' ') || 'none'}); shot 4 camera ${ps.shot4PostDistanceSouth} m from the moved post`);
    console.log(`wheel worst every frame: ${w.variants.map((v) => `${v} ${(w.worstByVariant[v] * 100).toFixed(1)}% at ${w.worstAt[v]}`).join(', ')}; 1.5 m variant: wheel height x${w.variant15.wheelHeightRatio.join(' to ')}, A's feet x${w.variant15.feetRatio.join(' to ')}; truck ${w.truckMetres} m`);
    for (const l of m.levels) console.log(`level ${l.label}: mean ${l.mean}, p99 ${l.p99}`);
    console.log(`wrote ${a.out}`);
  } catch (e) {
    console.error(`gate2 measure failed: ${e.message}`);
    process.exitCode = 1;
  }
}
