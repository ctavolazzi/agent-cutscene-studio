// Determinism check on the built scene (dist/index.html): the same t must give the same bytes whatever was drawn before.
// Times: each shot's start, start + 1/fps, middle and end - 1/fps, plus 0, 3.0 and 111.9. Four passes, frames hashed
// with sha1 of the RGB bytes:
//   1 ascending   in one page, every time in order
//   2 scrambled   same page, a fixed scrambled order (seeded mulberry32), so each time has a different predecessor
//   3 again       same page, the first time once more
//   4 fresh page  a second, freshly loaded page draws the scrambled order. Its first draw is a later time in another
//                 shot, so state latched on a page's first draw (a start time, a first camera) shows up here, where
//                 passes 1 to 3 cannot see it: they all share the first page's first draw.
// Every hash for one t must match. A flat build is deterministic by default, so the run also fails when fewer than
// --min-distinct of the times draw distinct frames (default one per shot).
// Usage: node scripts/check-determinism.js [--file <html>] [--overlay 0|1] [--seed <n>] [--min-distinct <n>] [--json <file>]
//   --overlay defaults to 0: the frames that ship. 1 also covers the shot overlay.
//   --inject-error <t,...> is a test hook: the page's frame at each listed time carries the previously drawn time in
//   its first bytes, which is the kind of state between calls that this check exists to catch.
// Exits 0 on pass, 1 on any mismatch, wrong shot, too few distinct frames, page error or crash.
import { createHash } from 'node:crypto';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { openScene } from './lib/browser.mjs';
import { mulberry32, hashString } from '../src/prng.js';
import { SHOTS } from '../src/shots.js';

export const DEFAULT_SEED = hashString('check-determinism');
export const DEFAULT_MIN_DISTINCT = SHOTS.length;
export const PASSES = ['ascending', 'scrambled', 'again', 'fresh page'];
const EXTRA_TIMES = [0, 3.0, 111.9];

const key = (t) => t.toFixed(6);
const sha1 = (buf) => createHash('sha1').update(buf).digest('hex');

export function checkTimes(shots, fps, total) {
  const seen = new Map();
  const add = (t) => { if (t >= 0 && t < total) seen.set(key(t), t); };
  for (const s of shots) {
    add(s.start);
    add(s.start + 1 / fps);
    add((s.start + s.end) / 2);
    add(s.end - 1 / fps);
  }
  EXTRA_TIMES.forEach(add);
  return [...seen.values()].sort((a, b) => a - b);
}

// Fisher-Yates with the project's own PRNG, so the order is the same on every run and every machine.
export function scrambled(list, seed = DEFAULT_SEED) {
  const rnd = mulberry32(seed >>> 0);
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export const shotFor = (shots, t) => (shots.find((s) => t >= s.start && t < s.end) ?? shots[shots.length - 1]).n;

// The orders only prove something if the scrambled one steps back in time and the fresh page starts elsewhere.
export function orderProblems(times, order, shots) {
  const problems = [];
  if (!order.slice(1).some((t, i) => t < order[i])) problems.push('the scrambled order never steps back in time');
  if (shotFor(shots, order[0]) === shotFor(shots, times[0])) problems.push('the fresh page would start in the same shot as the first page');
  return problems;
}

async function injectError(page, targets) {
  await page.evaluate((ts) => {
    const draw = window.__frameRGB;
    let prev = -1;
    window.__frameRGB = (t) => {
      const r = draw(t);
      const before = prev;
      prev = t;
      if (!ts.some((x) => Math.abs(x - t) < 1e-9)) return r;
      const mark = new Uint8Array(new Float64Array([before]).buffer);
      const s = atob(r.b64);
      let head = '';
      for (let i = 0; i < 8; i++) head += String.fromCharCode(s.charCodeAt(i) ^ mark[i]);
      return { info: r.info, b64: btoa(head + s.slice(8)) };
    };
  }, targets);
}

export async function checkDeterminism({ file, overlay = false, seed = DEFAULT_SEED, minDistinct = DEFAULT_MIN_DISTINCT, inject = [], log = console.log } = {}) {
  const open = async (label) => {
    const scene = await openScene({ file, overlay });
    if (inject.length) await injectError(scene.page, inject);
    return { scene, label };
  };
  const pages = [];
  try {
    pages.push(await open('first page'));
    const { info } = pages[0].scene;
    const times = checkTimes(info.shots, info.fps, info.total);
    const order = scrambled(times, seed);
    const orderIssues = orderProblems(times, order, info.shots);
    if (orderIssues.length) throw new Error(`${orderIssues.join('; ')}, so the run proves nothing: pick another --seed`);
    const frameBytes = info.res.w * info.res.h * 3;
    const draws = times.length * 3 + 1;
    const rows = new Map(times.map((t) => [key(t), { t, want: shotFor(info.shots, t), shots: new Set(), hashes: [] }]));
    const draw = async (scene, t, pass) => {
      const f = await scene.frame(t);
      if (f.rgb.length !== frameBytes) throw new Error(`frame at t ${t} is ${f.rgb.length} bytes, want ${frameBytes}`);
      const row = rows.get(key(t));
      row.shots.add(f.info.shot);
      row.hashes.push({ pass, hash: sha1(f.rgb) });
    };
    log(`check-determinism: ${times.length} times, ${draws} draws in two pages, overlay ${overlay ? 'on' : 'off'}, seed ${seed}, min distinct ${minDistinct}`);
    const t0 = performance.now();
    const a = pages[0].scene;
    for (const t of times) await draw(a, t, 'ascending');
    for (const t of order) await draw(a, t, 'scrambled');
    await draw(a, times[0], 'again');
    pages.push(await open('fresh page'));
    const b = pages[1].scene;
    if (JSON.stringify(b.info) !== JSON.stringify(info)) throw new Error('the two page loads report different scene info');
    for (const t of order) await draw(b, t, 'fresh page');
    const seconds = (performance.now() - t0) / 1000;

    const results = [...rows.values()].map((r) => {
      const ref = r.hashes[0].hash;
      const differs = r.hashes.filter((h) => h.hash !== ref).map((h) => h.pass);
      const shot = [...r.shots];
      const problems = [];
      if (differs.length) problems.push('hash mismatch');
      if (shot.length !== 1 || shot[0] !== r.want) problems.push(`drew shot ${shot.join('/')}, want ${r.want}`);
      return { t: r.t, shot: shot.length === 1 ? shot[0] : shot, wantShot: r.want, hashes: r.hashes, differs, ok: problems.length === 0, problems };
    });
    const distinct = new Set(results.map((r) => r.hashes[0].hash)).size;
    const tooFlat = distinct < minDistinct;
    const failures = results.filter((r) => !r.ok);
    const errors = pages.flatMap((p) => p.scene.errors.map((e) => `${p.label}: ${e}`));
    return {
      ok: failures.length === 0 && errors.length === 0 && !tooFlat,
      file: file ?? 'dist/index.html', overlay, seed, inject, minDistinct,
      times: times.length, draws, pages: pages.length, passes: PASSES,
      backwardSteps: order.slice(1).filter((t, i) => t < order[i]).length, firstDraws: [times[0], order[0]],
      distinctFrames: distinct, tooFlat,
      seconds: +seconds.toFixed(2), msPerDraw: +((seconds * 1000) / draws).toFixed(1),
      order, results,
      failures: failures.map((r) => ({ t: r.t, shot: r.shot, problems: r.problems, differs: r.differs, hashes: r.hashes })), errors,
    };
  } finally {
    for (const p of pages) await p.scene.close();
  }
}

function printReport(r) {
  const rows = r.results.map((x) => ({
    t: x.t.toFixed(3),
    shot: String(x.shot),
    sha1: x.hashes[0].hash.slice(0, 12),
    draws: String(x.hashes.length),
    result: x.ok ? 'ok' : `FAIL ${x.problems.join(', ')}`,
  }));
  const cols = ['t', 'shot', 'sha1', 'draws', 'result'];
  const w = cols.map((c) => Math.max(c.length, ...rows.map((x) => x[c].length)));
  const fmt = (x) => cols.map((c, k) => (k < 2 ? x[c].padStart(w[k]) : x[c].padEnd(w[k]))).join('  ').trimEnd();
  console.log(fmt(Object.fromEntries(cols.map((c) => [c, c]))));
  console.log(w.map((x) => '-'.repeat(x)).join('  '));
  rows.forEach((x) => console.log(fmt(x)));
  console.log(`\nscrambled order steps back in time ${r.backwardSteps} times; first draws: t ${r.firstDraws[0]} in the first page, t ${r.firstDraws[1]} in the fresh page`);
  console.log(`${r.distinctFrames} distinct frames among ${r.times} times (want at least ${r.minDistinct}); ${r.msPerDraw} ms per draw`);
  if (r.tooFlat) console.log(`TOO FLAT: only ${r.distinctFrames} distinct frame${r.distinctFrames === 1 ? '' : 's'}, want at least ${r.minDistinct} (--min-distinct). A build that draws nothing that moves is deterministic by default, so this run proves nothing about the scene.`);
  for (const f of r.failures) {
    const where = f.differs.length ? ` (differs in: ${f.differs.join(', ')})` : '';
    console.log(`MISMATCH t ${f.t.toFixed(3)} shot ${f.shot}: ${f.problems.join(', ')}${where}`);
    for (const h of f.hashes) console.log(`  ${h.pass.padEnd(10)} ${h.hash}`);
  }
  for (const e of r.errors) console.log(`PAGE ERROR ${e}`);
  console.log(`\n${r.ok ? 'PASS' : 'FAIL'}: ${r.failures.length} of ${r.times} times differ or drew the wrong shot, ${r.errors.length} page errors, ${r.distinctFrames} distinct frame${r.distinctFrames === 1 ? '' : 's'} (min ${r.minDistinct})`);
}

async function main() {
  const { values: a } = parseArgs({
    options: {
      file: { type: 'string' }, overlay: { type: 'string', default: '0' }, seed: { type: 'string' }, 'min-distinct': { type: 'string' },
      json: { type: 'string' }, 'inject-error': { type: 'string' },
    },
    strict: true,
  });
  if (a.overlay !== '0' && a.overlay !== '1') throw new Error(`bad --overlay ${a.overlay} (use 0 or 1)`);
  const seed = a.seed === undefined ? DEFAULT_SEED : Number(a.seed);
  if (!Number.isInteger(seed)) throw new Error(`bad --seed ${a.seed}`);
  const minDistinct = a['min-distinct'] === undefined ? DEFAULT_MIN_DISTINCT : Number(a['min-distinct']);
  if (!Number.isInteger(minDistinct) || minDistinct < 0) throw new Error(`bad --min-distinct ${a['min-distinct']}`);
  const inject = a['inject-error'] ? a['inject-error'].split(',').map(Number) : [];
  if (inject.some((t) => !Number.isFinite(t))) throw new Error(`bad --inject-error ${a['inject-error']}`);
  if (inject.length) console.log(`TEST HOOK: frames at t ${inject.join(', ')} depend on the previous draw`);
  const report = await checkDeterminism({ file: a.file && resolve(a.file), overlay: a.overlay === '1', seed, minDistinct, inject });
  printReport(report);
  if (a.json) {
    mkdirSync(dirname(resolve(a.json)), { recursive: true });
    writeFileSync(resolve(a.json), `${JSON.stringify(report, null, 1)}\n`);
  }
  process.exitCode = report.ok ? 0 : 1;
}

const isMain = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((e) => {
    console.error(`check-determinism failed: ${e.message}`);
    process.exitCode = 1;
  });
}
