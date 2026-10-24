// Camera parity: the camera behind window.__project in the built scene (dist/index.html) must put the landmarks where
// the storyboard's camera maths puts them. Expected: scripts/lib/math.js makeCamera(cameraAt(shot, t), 960, 540), as a
// fraction of the frame. Actual: window.__project(point, t). Three times per shot (start + 0.01, sketchAt, end - 0.05).
// Scope: __project places its own probe PerspectiveCamera with applyShotCamera (src/timeline.js), the same function
// that places the render camera, so a mistake in applyShotCamera, shots.js or the lens maths is caught. A change made
// only on the render path (timeline.renderAt adding something, or a part moving the camera it is handed) is NOT seen
// here, because the page does not yet expose the camera that drew the frame.
// A landmark is compared where both positions are within -0.2..1.2 of the frame; it also fails when only one of the
// two is well inside that range (one camera sees it, the other does not), and whenever either side is not null and
// not two finite numbers (a NaN projection is broken, never out of frame). Every shot needs at least one comparison.
// Usage: node scripts/check-cameras.js [--file <html>] [--tol 0.01] [--json <file>]
//   --inject-error <shot>[:roll] is a test hook: the expected camera for that shot is aimed 2 degrees to the right,
//   or with :roll keeps its aim but turns its roll the wrong way (the sign slip most likely between two conventions).
// Exits 0 on pass, 1 on any difference over the tolerance, a broken projection, a stale build, a page error or a crash.
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { openScene } from './lib/browser.mjs';
import { makeCamera, D2R } from './lib/math.js';
import { LAMP, BRIDGE, BUILDINGS } from '../src/set.js';
import { SHOTS, cameraAt } from '../src/shots.js';
import { carAt, peopleAt } from '../src/world.js';

export const W = 960, H = 540;
export const TOL = 0.01;
export const RANGE = [-0.2, 1.2];
const INJECT_DEG = 2;
const CORNER = BUILDINGS.find((b) => b.corner);

export const checkTimesFor = (shot) => [shot.start + 0.01, shot.sketchAt, shot.end - 0.05];

export function landmarksAt(t) {
  const lm = [
    ['lamp head', LAMP.head],
    ['lamp base', [LAMP.base[0], 0.3, LAMP.base[1]]],
    ['bridge entrance', [0, 1, BRIDGE.z0]],
    ['corner building', [CORNER.x0, 6, CORNER.z0]],
  ];
  const P = peopleAt(t);
  if (P.A) lm.push(['A head', [P.A.x, 1.72, P.A.z]], ['A feet', [P.A.x, 0, P.A.z]]);
  if (P.B) lm.push(['B head', [P.B.x, 1.58, P.B.z]], ['B feet', [P.B.x, 0, P.B.z]]);
  const car = carAt(t);
  if (car.present) lm.push(['car centre', [car.x, 0.7, car.z]]);
  return lm;
}

// turn the aim about the vertical through the camera, compass degrees (positive is clockwise seen from above)
function yawed(c, deg) {
  const d = [c.target[0] - c.pos[0], c.target[1] - c.pos[1], c.target[2] - c.pos[2]];
  const cs = Math.cos(deg * D2R), sn = Math.sin(deg * D2R);
  return { ...c, target: [c.pos[0] + d[0] * cs - d[2] * sn, c.target[1], c.pos[2] + d[0] * sn + d[2] * cs] };
}

// inject: null, or { shot, kind: 'aim' | 'roll' }
export function expectedAt(shot, t, p, { inject = null } = {}) {
  let c = cameraAt(shot, t);
  if (inject?.shot === shot.n) c = inject.kind === 'roll' ? { ...c, roll: -c.roll } : yawed(c, INJECT_DEG);
  const q = makeCamera(c, W, H).project(p);
  return q ? [q[0] / W, q[1] / H] : null;
}

const inRange = (v, pad = 0) => !!v && v.every((x) => x >= RANGE[0] + pad && x <= RANGE[1] - pad);
const finitePair = (v) => Array.isArray(v) && v.length === 2 && v.every(Number.isFinite);
const diffOf = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));

// Compare one landmark. Returns null when it is out of both frames (null is behind the camera), else { diff }:
// Infinity for a visibility split, and Infinity with nonFinite for a projection that is neither null nor two finite
// numbers, which always fails.
export function compare(exp, act, tol = TOL) {
  if ((exp !== null && !finitePair(exp)) || (act !== null && !finitePair(act))) return { diff: Infinity, nonFinite: true };
  if (inRange(exp) && inRange(act)) return { diff: diffOf(exp, act) };
  // one camera has it well inside the range and the other has it outside or behind: a real disagreement
  if (inRange(exp, tol) || inRange(act, tol)) return { diff: exp && act ? diffOf(exp, act) : Infinity };
  return null;
}

// Judge one shot's rows. Every row counts, not just the worst: a row whose diff is not <= tol (NaN included) fails.
// The worst row ranks NaN as Infinity, so a broken row is never hidden behind a good one.
const severity = (d) => (d <= Infinity ? d : Infinity);
export function judgeShot(rows, tol = TOL) {
  const worst = rows.reduce((w, r) => (!w || severity(r.diff) > severity(w.diff) ? r : w), null);
  const bad = rows.filter((r) => !(r.diff <= tol));
  const broken = bad.filter((r) => r.nonFinite || Number.isNaN(r.diff)).length;
  const split = bad.filter((r) => r.diff === Infinity && !r.nonFinite).length;
  const over = bad.length - broken - split;
  const problems = [];
  if (!rows.length) problems.push('no landmark in frame to compare');
  if (broken) problems.push(`${broken} non-finite projection${broken === 1 ? '' : 's'}`);
  if (split) problems.push(`${split} visibility split${split === 1 ? '' : 's'}`);
  if (over) problems.push(`${over} over ${tol}, worst ${Math.max(...bad.filter((r) => Number.isFinite(r.diff)).map((r) => r.diff)).toFixed(4)}`);
  return { worst, bad: bad.length, ok: problems.length === 0, problems };
}

export async function checkCameras({ file, tol = TOL, inject = null, log = console.log } = {}) {
  const scene = await openScene({ file, overlay: false });
  try {
    const { info } = scene;
    const stale = [];
    if (info.shots.length !== SHOTS.length) stale.push(`build has ${info.shots.length} shots, src/shots.js has ${SHOTS.length}`);
    for (const s of SHOTS) {
      const b = info.shots.find((x) => x.n === s.n);
      if (!b || b.start !== s.start || b.end !== s.end || b.lens !== s.lens) stale.push(`shot ${s.n} differs between the build and src/shots.js`);
    }
    const hook = !inject ? '' : inject.kind === 'roll' ? `, TEST HOOK: shot ${inject.shot} expected roll reversed` : `, TEST HOOK: shot ${inject.shot} expected camera aimed ${INJECT_DEG} degrees off`;
    log(`check-cameras: ${SHOTS.length} shots, 3 times each, tolerance ${tol}${hook}`);
    const shots = [];
    for (const s of SHOTS) {
      const rows = [];
      for (const t of checkTimesFor(s)) {
        const { roll } = cameraAt(s, t);
        for (const [name, p] of landmarksAt(t)) {
          const exp = expectedAt(s, t, p, { inject });
          const act = await scene.project(p, t);
          const c = compare(exp, act, tol);
          if (!c) continue;
          rows.push({ t, roll, landmark: name, point: p, expected: exp, actual: act, diff: c.diff, ...(c.nonFinite ? { nonFinite: true } : {}) });
        }
      }
      const { worst, bad, ok, problems } = judgeShot(rows, tol);
      const rolls = checkTimesFor(s).map((t) => cameraAt(s, t).roll);
      shots.push({
        n: s.n, title: s.title, lens: s.lens, times: checkTimesFor(s), maxRollDeg: Math.max(...rolls.map(Math.abs)),
        compared: rows.length, bad, worst, ok, problems, rows,
      });
    }
    const errors = [...scene.errors];
    const failed = shots.filter((s) => !s.ok);
    return { ok: failed.length === 0 && stale.length === 0 && errors.length === 0, file: file ?? 'dist/index.html', tol, inject, stale, errors, shots };
  } finally {
    await scene.close();
  }
}

const f3 = (v) => (v === null ? 'behind' : finitePair(v) ? `${v[0].toFixed(3)},${v[1].toFixed(3)}` : `broken ${Array.isArray(v) ? `[${v.map(String).join(',')}]` : String(v)}`);
const diffText = (row) => (row.nonFinite ? 'non-finite' : Number.isFinite(row.diff) ? row.diff.toExponential(1) : 'visibility');

function printReport(r) {
  const rows = r.shots.map((s) => ({
    shot: String(s.n), lens: String(s.lens), roll: s.maxRollDeg ? s.maxRollDeg.toFixed(1) : '0', compared: String(s.compared),
    worst: s.worst ? diffText(s.worst) : 'none',
    'at (t, landmark)': s.worst ? `${s.worst.t.toFixed(2)} ${s.worst.landmark}` : '',
    'expected / actual': s.worst ? `${f3(s.worst.expected)} / ${f3(s.worst.actual)}` : '',
    result: s.ok ? 'ok' : `FAIL ${s.problems.join(', ')}`,
  }));
  const cols = Object.keys(rows[0]);
  const w = cols.map((c) => Math.max(c.length, ...rows.map((x) => x[c].length)));
  const right = new Set(['shot', 'lens', 'roll', 'compared', 'worst']);
  const fmt = (x) => cols.map((c, k) => (right.has(c) ? x[c].padStart(w[k]) : x[c].padEnd(w[k]))).join('  ').trimEnd();
  console.log(fmt(Object.fromEntries(cols.map((c) => [c, c]))));
  console.log(w.map((x) => '-'.repeat(x)).join('  '));
  rows.forEach((x) => console.log(fmt(x)));
  for (const s of r.stale) console.log(`STALE BUILD ${s} (rebuild dist/)`);
  for (const e of r.errors) console.log(`PAGE ERROR ${e}`);
  const n = r.shots.reduce((a, s) => a + s.compared, 0);
  const worsts = r.shots.filter((s) => s.worst).map((s) => s.worst);
  const broken = worsts.find((w) => w.nonFinite);
  const worst = worsts.length ? Math.max(...worsts.map((w) => w.diff)) : null;
  const worstText = worst === null ? 'none' : broken ? 'non-finite' : Number.isFinite(worst) ? worst.toExponential(2) : 'visibility';
  console.log(`\n${r.ok ? 'PASS' : 'FAIL'}: ${n} comparisons, worst ${worstText} (tolerance ${r.tol}), ${r.shots.filter((s) => !s.ok).length} of ${r.shots.length} shots failed`);
}

async function main() {
  const { values: a } = parseArgs({
    options: { file: { type: 'string' }, tol: { type: 'string' }, json: { type: 'string' }, 'inject-error': { type: 'string' } },
    strict: true,
  });
  const tol = a.tol === undefined ? TOL : Number(a.tol);
  if (!(tol > 0)) throw new Error(`bad --tol ${a.tol}`);
  let inject = null;
  if (a['inject-error'] !== undefined) {
    const [n, kind = 'aim'] = a['inject-error'].split(':');
    inject = { shot: Number(n), kind };
    if (!SHOTS.some((s) => s.n === inject.shot) || !['aim', 'roll'].includes(kind)) throw new Error(`bad --inject-error ${a['inject-error']} (use <shot> or <shot>:roll)`);
  }
  const report = await checkCameras({ file: a.file && resolve(a.file), tol, inject });
  printReport(report);
  if (a.json) {
    mkdirSync(dirname(resolve(a.json)), { recursive: true });
    // keep Infinity and NaN readable: JSON would turn both into null
    writeFileSync(resolve(a.json), `${JSON.stringify(report, (k, v) => (typeof v === 'number' && !Number.isFinite(v) ? String(v) : v), 1)}\n`);
  }
  process.exitCode = report.ok ? 0 : 1;
}

const isMain = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((e) => {
    console.error(`check-cameras failed: ${e.message}`);
    process.exitCode = 1;
  });
}
