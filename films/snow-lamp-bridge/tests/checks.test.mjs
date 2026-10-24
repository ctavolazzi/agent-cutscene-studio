// Tests for the three check scripts: check-forbidden, check-determinism and check-cameras.
// Run from the project root: node --test tests/checks.test.mjs (needs dist/index.html; any build with the capture API).
// Every check is also run against planted bad input, because a check that cannot fail proves nothing. The planted
// builds are copies of dist/index.html in the output folder with one window API wrapped; dist/ itself is only read.
// Output (JSON reports, logs, planted trees and pages) goes to $S2_OUT/checks/, or a fresh temp directory.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan, stripComments, playbackBlock } from '../scripts/check-forbidden.js';
import { checkTimes, scrambled, shotFor, orderProblems, DEFAULT_SEED, DEFAULT_MIN_DISTINCT } from '../scripts/check-determinism.js';
import { landmarksAt, checkTimesFor, compare, judgeShot, expectedAt, TOL, W, H } from '../scripts/check-cameras.js';
import { makeCamera } from '../scripts/lib/math.js';
import { SHOTS, cameraAt } from '../src/shots.js';
import { FPS, T_TOTAL } from '../src/world.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(process.env.S2_OUT ?? mkdtempSync(join(tmpdir(), 's2-')), 'checks');
mkdirSync(OUT, { recursive: true });
const EM = String.fromCharCode(0x2014), EN = String.fromCharCode(0x2013);
const BS = String.fromCharCode(92); // a backslash, so this file holds none of the escapes check-forbidden flags
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: got ${a}, want ${b} (eps ${eps})`);

// run a check script as the user would, and read back its JSON report
function run(script, args, name) {
  const json = join(OUT, `${name}.json`);
  rmSync(json, { force: true });
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts', script), ...args, '--json', json], { cwd: ROOT, encoding: 'utf8', timeout: 600000 });
  writeFileSync(join(OUT, `${name}.log`), `${r.stdout}\n${r.stderr}`);
  let report = null;
  try { report = JSON.parse(readFileSync(json, 'utf8')); } catch { /* the assertions below say what went wrong */ }
  return { code: r.status, out: r.stdout, err: r.stderr, report };
}

// A planted bad build: dist/index.html with a classic script at the top of <head> that wraps one window API when the
// page's module sets it. wrap is page source for (original) => replacement.
function plantedPage(name, prop, wrap) {
  const html = readFileSync(join(ROOT, 'dist/index.html'), 'utf8');
  assert.equal(html.split('<head>').length, 2, 'dist/index.html needs exactly one <head> to plant into');
  const trap = `<script>(() => { const wrap = ${wrap}; let real; Object.defineProperty(window, ${JSON.stringify(prop)}, { configurable: true, get() { return real; }, set(f) { real = wrap(f); } }); })();</script>`;
  const file = join(OUT, 'pages', `${name}.html`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, html.replace('<head>', () => `<head>\n${trap}`));
  return file;
}

// ---------- pure parts, no browser ----------

test('stripComments blanks comments only, and keeps lines and columns', () => {
  const src = [
    "const url = 'http://x.test/a'; // Math.random here is a comment",
    'const re = /["\'/]+/g; const n = 4 / 2; /* Date.now',
    '   still a comment */ const s = `a ${ { b: 1 }.b } // not a comment ${"x"}`;',
    'Math.random();',
  ].join('\n');
  const out = stripComments(src);
  assert.equal(out.length, src.length);
  const lines = out.split('\n');
  assert.equal(lines.length, 4);
  assert.ok(lines[0].startsWith("const url = 'http://x.test/a';"), lines[0]);
  assert.ok(!lines[0].includes('Math.random'));
  assert.ok(lines[1].includes('const n = 4 / 2;') && !lines[1].includes('Date.now'), lines[1]);
  assert.ok(lines[2].includes('// not a comment'), 'a // inside a template literal is text, not a comment');
  assert.ok(!lines[2].includes('still a comment'));
  assert.equal(lines[3], 'Math.random();');
});

test('stripComments: a / after the ) of an if, while, for or with header starts a regex; after a call it divides', () => {
  const slash = `${BS}/`;
  const cases = [
    `if (globalThis.x) /https?:${slash}${slash}/.test('a') && Math.random();`,
    `while (n--) /x:${slash}${slash}/.test(s) && Math.random();`,
    `for (const k of ks) /^${slash}${slash}/.test(k) && Math.random();`,
  ];
  // each regex ends in an escaped slash, so a reader that takes its opening / for division sees a // comment there
  for (const src of cases) assert.equal(stripComments(src), src, 'nothing is a comment here, so nothing is blanked');
  // division after a call or a grouping paren is still division: the // that follows is a real comment
  assert.equal(stripComments('const a = f(x) / g(y); // Math.random').trimEnd(), 'const a = f(x) / g(y);');
  assert.equal(stripComments('const b = (p + q) / 2; // Date.now').trimEnd(), 'const b = (p + q) / 2;');
});

test('stripComments with literals: true blanks strings, templates and regex literals, so braces in them do not count', () => {
  const src = "const s = '{'; const r = /[}]/; const t = `a${ {b: 1}.b }c`; // }";
  const out = stripComments(src, { literals: true });
  assert.equal(out.length, src.length);
  assert.equal(out.replace(/[^{}]/g, ''), '{}', 'only the object literal inside the substitution keeps its braces');
  assert.ok(out.includes('{b: 1}.b'), out);
});

test('playbackBlock finds the body of if (!params.capture) { in src/main.js', () => {
  const text = readFileSync(join(ROOT, 'src/main.js'), 'utf8');
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.includes('if (!params.capture) {')) + 1;
  const end = lines.findIndex((l, k) => k >= start && l === '}') + 1;
  assert.ok(start > 0 && end > start, `start ${start} end ${end}`);
  const b = playbackBlock(text);
  assert.equal(b.start, start);
  assert.equal(b.end, end);
  assert.equal(playbackBlock(text.replace('!params.capture', 'params.capturing')), null);
});

test('determinism times: start, start + 1/24, middle and end - 1/24 of every shot, plus 0, 3 and 111.9', () => {
  const times = checkTimes(SHOTS, FPS, T_TOTAL);
  assert.equal(times.length, 62); // 15 shots x 4, plus 3.0 and 111.9 (0 is shot 1's start)
  assert.deepEqual(times, [...times].sort((a, b) => a - b));
  for (const t of [0, 3.0, 111.9, 7, 7 + 1 / 24, 10.5, 14 - 1 / 24, 29, 34.5, 92.5, 106, 112 - 1 / 24]) {
    assert.ok(times.some((x) => Math.abs(x - t) < 1e-9), `missing t ${t}`);
  }
  for (const s of SHOTS) assert.equal(times.filter((t) => shotFor(SHOTS, t) === s.n).length >= 4, true, `shot ${s.n}`);
  assert.ok(times.every((t) => t >= 0 && t < T_TOTAL));
});

test('scrambled order is a fixed permutation that steps back in time, and the fresh page starts in another shot', () => {
  const times = checkTimes(SHOTS, FPS, T_TOTAL);
  const a = scrambled(times), b = scrambled(times);
  assert.deepEqual(a, b, 'same seed, same order');
  assert.deepEqual([...a].sort((x, y) => x - y), times, 'a permutation');
  assert.notDeepEqual(a, times);
  assert.ok(a.slice(1).filter((t, i) => t < a[i]).length >= 20, 'plenty of backward steps');
  assert.notDeepEqual(scrambled(times, DEFAULT_SEED + 1), a, 'the seed matters');
  assert.deepEqual(orderProblems(times, a, SHOTS), []);
  assert.notEqual(shotFor(SHOTS, a[0]), shotFor(SHOTS, times[0]));
  // controls: an order that never steps back, and one that starts where the first page starts, are both refused
  assert.equal(orderProblems(times, times, SHOTS).length, 2);
  assert.deepEqual(orderProblems(times, [times[1], ...times.filter((t) => t !== times[1])], SHOTS), ['the fresh page would start in the same shot as the first page']);
  assert.equal(DEFAULT_MIN_DISTINCT, 15, 'one distinct frame per shot by default');
});

test('camera landmarks and times are the ones in the spec', () => {
  checkTimesFor(SHOTS[4]).forEach((t, k) => near(t, [29.01, 32.4, 39.95][k], 1e-9, `shot 5 time ${k}`));
  const at = (t) => Object.fromEntries(landmarksAt(t));
  const early = at(0.01);
  // the lamp as moved 1.5 m south at Gate 2 (decision 1c)
  assert.deepEqual(early, { 'lamp head': [4.6, 4.5, -4.5], 'lamp base': [5.0, 0.3, -4.5], 'bridge entrance': [0, 1, -8], 'corner building': [6.2, 6, 25] });
  const parked = at(29.01);
  parked['car centre'].forEach((v, k) => near(v, [2.2, 0.7, 1.85][k], 1e-9, `car centre ${k}`));
  assert.equal(parked['A head'], undefined, 'nobody is out of the car yet');
  const rail = at(64.5);
  assert.deepEqual(rail['A head'], [5.25, 1.72, -11.3]);
  assert.deepEqual(rail['A feet'], [5.25, 0, -11.3]);
  assert.deepEqual(rail['B head'], [5.25, 1.58, -10.0]);
  assert.deepEqual(rail['B feet'], [5.25, 0, -10.0]);
});

test('compare: both in range, neither, one each side, and the edge of the range', () => {
  near(compare([0.5, 0.5], [0.503, 0.49]).diff, 0.01, 1e-12, 'larger axis difference');
  assert.equal(compare([1.5, 0.5], [1.6, 0.5]), null, 'outside both frames');
  assert.equal(compare(null, null), null);
  assert.equal(compare([0.5, 0.5], null).diff, Infinity, 'one camera sees it, the other has it behind');
  near(compare([1.1, 0.5], [1.3, 0.5]).diff, 0.2, 1e-12, 'well inside one, outside the other');
  assert.equal(compare([1.195, 0.5], [1.205, 0.5]), null, 'straddling the edge is not a finding');
});

test('compare: a projection that is not null and not two finite numbers always fails', () => {
  const broken = { diff: Infinity, nonFinite: true };
  assert.deepEqual(compare([0.5, 0.5], [NaN, NaN]), broken, 'in range against NaN');
  assert.deepEqual(compare([NaN, NaN], [NaN, NaN]), broken, 'NaN on both sides is not out of frame');
  assert.deepEqual(compare([1.5, 0.5], [NaN, NaN]), broken, 'out of frame against NaN');
  assert.deepEqual(compare(null, [0.5, NaN]), broken, 'behind against half NaN');
  assert.deepEqual(compare([0.5, 0.5], undefined), broken, 'a missing answer is not behind the camera');
  assert.deepEqual(compare([0.5, 0.5], [0.5]), broken, 'one number is not a position');
  assert.deepEqual(compare([0.5, 0.5], [Infinity, 0.5]), broken);
});

test('judgeShot fails on any bad row, never just the worst, and ranks NaN as the worst', () => {
  const row = (diff, extra = {}) => ({ diff, landmark: `d ${diff}`, ...extra });
  const good = judgeShot([row(1e-16), row(2e-16)]);
  assert.equal(good.ok, true);
  assert.equal(good.worst.diff, 2e-16);
  for (const rows of [[row(1e-16), row(NaN)], [row(NaN), row(1e-16)]]) {
    const j = judgeShot(rows);
    assert.equal(j.ok, false, 'a NaN row fails wherever it sits');
    assert.ok(Number.isNaN(j.worst.diff), 'and it is reported as the worst');
    assert.deepEqual(j.problems, ['1 non-finite projection']);
  }
  const nf = judgeShot([row(1e-16), row(Infinity, { nonFinite: true }), row(3e-16)]);
  assert.equal(nf.ok, false);
  assert.equal(nf.worst.nonFinite, true);
  assert.equal(nf.bad, 1);
  assert.deepEqual(judgeShot([row(1e-16), row(Infinity)]).problems, ['1 visibility split']);
  assert.deepEqual(judgeShot([row(1e-16), row(0.02), row(0.015)]).problems, [`2 over ${TOL}, worst 0.0200`]);
  assert.deepEqual(judgeShot([]).problems, ['no landmark in frame to compare']);
  assert.equal(judgeShot([row(0.009)]).ok, true, 'under the tolerance');
});

test('shot 5 landmarks can see its roll: dropping the 3 degrees moves one by more than the tolerance', () => {
  const s = SHOTS[4];
  let worst = 0;
  for (const t of checkTimesFor(s)) {
    const c = cameraAt(s, t);
    const flat = makeCamera({ ...c, roll: 0 }, W, H);
    for (const [, p] of landmarksAt(t)) {
      const q = flat.project(p);
      const r = compare(expectedAt(s, t, p), q && [q[0] / W, q[1] / H]);
      if (r) worst = Math.max(worst, r.diff);
    }
  }
  assert.equal(cameraAt(s, 29.01).roll > 2.9, true);
  assert.ok(worst > TOL, `worst ${worst}`);
});

// ---------- check-forbidden ----------

test('check-forbidden passes on the project and allows the clock only inside the playback block of src/main.js', () => {
  const r = run('check-forbidden.js', [], 'forbidden-project');
  assert.equal(r.code, 0, r.out);
  assert.equal(r.report.ok, true);
  assert.ok(r.report.files.code >= 5 && r.report.files.text >= 20, JSON.stringify(r.report.files));
  const pb = r.report.playback;
  assert.equal(pb.file, 'src/main.js');
  assert.deepEqual([pb.start, pb.end], (({ start, end }) => [start, end])(playbackBlock(readFileSync(join(ROOT, 'src/main.js'), 'utf8'))));
  assert.ok(r.report.allowed.length >= 2);
  for (const a of r.report.allowed) {
    assert.equal(a.file, 'src/main.js');
    assert.ok(['performance.now', 'requestAnimationFrame', 'setAnimationLoop'].includes(a.rule), a.rule);
    assert.ok(a.line > pb.start && a.line < pb.end, `${a.rule} at line ${a.line} is outside lines ${pb.start} to ${pb.end}`);
  }
  assert.match(r.out, new RegExp(`playback block: src/main\\.js lines ${pb.start} to ${pb.end}`));
  assert.match(r.out, /PASS: 0 hits/);
});

test('check-forbidden catches planted randomness, clocks, timers and dashes in every written form, and nothing else', () => {
  const tree = join(OUT, 'forbidden-tree');
  rmSync(tree, { recursive: true, force: true });
  cpSync(join(ROOT, 'src'), join(tree, 'src'), { recursive: true });
  writeFileSync(join(tree, 'README.md'), 'A clean note.\n');
  const clean = run('check-forbidden.js', ['--root', tree], 'forbidden-clean');
  assert.equal(clean.code, 0, `the unplanted copy must pass first:\n${clean.out}`);
  const cleanAllowed = clean.report.allowed.map((a) => `${a.rule} ${a.line}`);

  const put = (rel, text) => { mkdirSync(dirname(join(tree, rel)), { recursive: true }); writeFileSync(join(tree, rel), text); };
  put('src/fx/planted.js', [
    '// Math.random in a comment is fine, and so is Date.now',
    'export const r = Math.random();',
    "export const url = 'http://example.test'; // setTimeout in a comment",
    '/* performance.now()',
    '   new Date() */',
    'export const ok = 1;',
  ].join('\n'));
  put('src/actors/clock.js', 'export const a = performance.now();\nexport const b = new Date();\nsetTimeout(() => {}, 5);\nexport const c = Date.now();\n');
  // the ways around the plain rules that a reviewer found
  put('src/fx/clock3.js', [
    "import * as THREE from 'three';",
    "import { Timer } from 'three/addons/misc/Timer.js';",
    'const clock = new THREE.Clock();',
    'export const tm = new Timer();',
    'export const loop = (r, f) => r.setAnimationLoop(f);',
    "export const r2 = Math['random']();",
    'const { random } = Math; export const r3 = random();',
    "export const r4 = Reflect.get(Math, 'random')();",
    `export const label = 'S01 0:03 ${BS}u2014 lamp';`,
    'export const label2 = `range 1' + BS + 'u{2013}9`;',
    'export const tl = performance.timeOrigin;',
    'const { now } = performance; export const n3 = now();',
    "export const n2 = Date['now']();",
    `if (globalThis.x) /https?:${BS}/${BS}//.test('a') && Math.random();`,
    "export const gpu = { powerPreference: 'high-performance' };",
    'export const fine = String.fromCharCode(0x2014).length;',
  ].join('\n'));
  // a clock read in main.js outside the playback block (here, in the capture API) is a hit, not an allowance
  const mainPath = join(tree, 'src/main.js');
  const mainLines = readFileSync(mainPath, 'utf8').split('\n');
  const projectAt = mainLines.findIndex((l) => l.startsWith('function project(')) + 1;
  assert.ok(projectAt > 0, 'src/main.js has function project(');
  mainLines.splice(projectAt, 0, '  const jitter = performance.now() % 1e-9;');
  writeFileSync(mainPath, `${mainLines.join('\n')}setInterval(() => {}, 10);\n`);
  const mainEnd = mainLines.length;
  put('NOTES.md', `line one\nline two\nan em ${EM} dash\n`);
  put('docs/range.txt', `pages 1${EN}9\n`);
  put('docs/page.html', `<p>a ${'&'}mdash; b ${'&'}ndash; c ${'&#'}8212; d ${'&#x'}2013; e</p>\n`);
  put('styles/site.css', `.label::after { content: '${BS}2014'; }\n`);
  put('docs/octal.txt', `a CSS escape outside CSS and HTML is just text: ${BS}2014\n`);
  put('scripts/tool.js', `const t0 = Date.now(); // scripts may read the clock\nconst x = 'en ${EN} dash';\n`);
  // all of these are out of scope: skipped directories, and binary files
  put('node_modules/pkg/index.js', `Math.random(); // ${EM}\n`);
  put('dist/index.html', `<p>${EM}</p>\n`);
  put('out/log.txt', `${EM}\n`);
  put('.git/HEAD', `${EM}\n`);
  writeFileSync(join(tree, 'still.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xe2, 0x80, 0x94]));
  writeFileSync(join(tree, 'blob'), Buffer.concat([Buffer.from([0]), Buffer.from(EM)]));

  const r = run('check-forbidden.js', ['--root', tree], 'forbidden-planted');
  assert.equal(r.code, 1, r.out);
  assert.equal(r.report.ok, false);
  const got = r.report.hits.map((h) => `${h.rule} ${h.file}:${h.line}`).sort();
  const want = [
    'Math.random src/fx/planted.js:2',
    'performance.now src/actors/clock.js:1',
    'new Date src/actors/clock.js:2',
    'timer src/actors/clock.js:3',
    'Date.now src/actors/clock.js:4',
    'three.js clock src/fx/clock3.js:2',
    'three.js clock src/fx/clock3.js:3',
    'three.js clock src/fx/clock3.js:4',
    'setAnimationLoop src/fx/clock3.js:5',
    'Math.random src/fx/clock3.js:6',
    'Math.random src/fx/clock3.js:7',
    'Math.random src/fx/clock3.js:8',
    'em dash (U+2014) as an escape src/fx/clock3.js:9',
    'en dash (U+2013) as an escape src/fx/clock3.js:10',
    'performance clock src/fx/clock3.js:11',
    'performance clock src/fx/clock3.js:12',
    'Date.now src/fx/clock3.js:13',
    'Math.random src/fx/clock3.js:14',
    `performance.now src/main.js:${projectAt + 1}`,
    `timer src/main.js:${mainEnd}`,
    'em dash (U+2014) NOTES.md:3',
    'en dash (U+2013) docs/range.txt:1',
    'em dash (U+2014) as an entity docs/page.html:1',
    'en dash (U+2013) as an entity docs/page.html:1',
    'em dash (U+2014) as an entity docs/page.html:1',
    'en dash (U+2013) as an entity docs/page.html:1',
    'em dash (U+2014) as a CSS escape styles/site.css:1',
    'en dash (U+2013) scripts/tool.js:2',
  ].sort();
  assert.deepEqual(got, want);
  // the playback block moved down one line with the planted line above it, and is still the only allowance
  assert.deepEqual(r.report.allowed.map((a) => `${a.rule} ${a.line - 1}`), cleanAllowed);
  assert.equal(r.report.playback.start, clean.report.playback.start + 1);
  assert.equal(r.report.files.binary, 2);
  // the readable table gives file:line:column for each hit
  assert.match(r.out, /Math\.random\s+src\/fx\/planted\.js:2:18/);
  assert.match(r.out, /em dash \(U\+2014\)\s+NOTES\.md:3:7/);
  assert.match(r.out, /em dash \(U\+2014\) as an entity\s+docs\/page\.html:1:6/);
  assert.match(r.out, new RegExp(`FAIL: ${want.length} hits`));
  assert.ok(!r.out.includes(EM) && !r.out.includes(EN), 'the report itself never prints a dash');
  // and the in-process scan agrees with the CLI
  assert.equal(scan(tree).hits.length, want.length);
});

test('the playback allowance ends at the matching brace, whatever braces sit in strings, comments and regexes', () => {
  const tree = join(OUT, 'playback-tree');
  rmSync(tree, { recursive: true, force: true });
  mkdirSync(join(tree, 'src'), { recursive: true });
  const body = [
    'const x = performance.now();',
    'if (!params.capture) {',
    "  const s = '}'; // }",
    '  const re = /[}]/;',
    '  requestAnimationFrame(() => {});',
    '}',
    'requestAnimationFrame(() => {});',
  ];
  writeFileSync(join(tree, 'src/main.js'), `${body.join('\n')}\n`);
  const r = scan(tree);
  assert.deepEqual(r.playback, { file: 'src/main.js', start: 2, end: 6 });
  assert.deepEqual(r.allowed.map((a) => `${a.rule} ${a.line}`), ['requestAnimationFrame 5']);
  assert.deepEqual(r.hits.map((h) => `${h.rule} ${h.line}`), ['performance.now 1', 'requestAnimationFrame 7']);
  // control: without the block nothing is allowed
  writeFileSync(join(tree, 'src/main.js'), `${body.join('\n').replace('!params.capture', 'params.capture === false')}\n`);
  const r2 = scan(tree);
  assert.equal(r2.playback, null);
  assert.deepEqual(r2.allowed, []);
  assert.deepEqual(r2.hits.map((h) => `${h.rule} ${h.line}`), ['performance.now 1', 'requestAnimationFrame 5', 'requestAnimationFrame 7']);
});

// ---------- check-determinism (headless Chromium, dist/index.html) ----------

test('check-determinism passes on the build: every time hashes the same in all four passes, over two page loads', () => {
  // The stub build draws only 2 distinct frames, so this run lowers the floor to 1. The flat-build test below shows
  // the default floor failing; S2.3 runs the default on the real scene.
  const r = run('check-determinism.js', ['--min-distinct', '1'], 'determinism');
  assert.equal(r.code, 0, `${r.out}\n${r.err}`);
  const rep = r.report;
  assert.equal(rep.ok, true);
  assert.equal(rep.times, 62);
  assert.equal(rep.draws, 187);
  assert.equal(rep.pages, 2);
  assert.equal(rep.errors.length, 0);
  assert.equal(rep.minDistinct, 1);
  assert.ok(rep.distinctFrames >= 2, `${rep.distinctFrames} distinct frames`);
  for (const x of rep.results) {
    assert.equal(new Set(x.hashes.map((h) => h.hash)).size, 1, `t ${x.t}`);
    assert.equal(x.shot, shotFor(SHOTS, x.t), `t ${x.t} drew shot ${x.shot}`);
    assert.deepEqual(x.hashes.map((h) => h.pass), x.t === 0 ? ['ascending', 'scrambled', 'again', 'fresh page'] : ['ascending', 'scrambled', 'fresh page']);
  }
  assert.deepEqual(rep.order, scrambled(checkTimes(SHOTS, FPS, T_TOTAL)), 'the pages ran the documented order');
  assert.deepEqual(rep.firstDraws, [0, rep.order[0]]);
  assert.notEqual(shotFor(SHOTS, rep.order[0]), 1, 'the fresh page starts in another shot');
  assert.match(r.out, /PASS: 0 of 62 times differ/);
});

test('check-determinism fails, naming the time and shot, when a frame depends on the previous draw', () => {
  // the planted bug only shows if the time's predecessor differs between the two orders
  const times = checkTimes(SHOTS, FPS, T_TOTAL), order = scrambled(times);
  const before = (list, t) => list[list.indexOf(t) - 1];
  assert.notEqual(before(order, 50), before(times, 50));
  const r = run('check-determinism.js', ['--inject-error', '0,50', '--min-distinct', '1'], 'determinism-injected');
  assert.equal(r.code, 1, r.out);
  assert.deepEqual(r.report.failures.map((f) => [f.t, f.shot, f.problems, f.differs]), [
    [0, 1, ['hash mismatch'], ['scrambled', 'again', 'fresh page']],
    [50, 7, ['hash mismatch'], ['scrambled', 'fresh page']],
  ]);
  const first = r.report.failures[0].hashes;
  assert.equal(first.length, 4);
  assert.equal(new Set(first.map((h) => h.hash)).size, 3, 'the repeat draw of the first time is caught too');
  assert.match(r.out, /MISMATCH t 0\.000 shot 1: hash mismatch \(differs in: scrambled, again, fresh page\)/);
  assert.match(r.out, /MISMATCH t 50\.000 shot 7: hash mismatch/);
  assert.match(r.out, /FAIL: 2 of 62 times/);
});

test('check-determinism fails a build that latches state on its first draw, which only the fresh page can see', () => {
  // every frame XORs in the first t that page ever drew: 0 in the first page (no change), a later t in the fresh one
  const file = plantedPage('latch', '__frameRGB', `(f) => {
    let first = null;
    return (t) => {
      const r = f(t);
      if (first === null) first = t;
      const mark = new Uint8Array(new Float64Array([first]).buffer);
      const s = atob(r.b64);
      let head = '';
      for (let i = 0; i < 8; i++) head += String.fromCharCode(s.charCodeAt(i) ^ mark[i]);
      return { info: r.info, b64: btoa(head + s.slice(8)) };
    };
  }`);
  const r = run('check-determinism.js', ['--file', file, '--min-distinct', '1'], 'determinism-latch');
  assert.equal(r.code, 1, r.out);
  const rep = r.report;
  assert.equal(rep.errors.length, 0, rep.errors.join('\n'));
  assert.equal(rep.failures.length, 62, 'every time differs');
  for (const f of rep.failures) {
    assert.deepEqual(f.problems, ['hash mismatch'], `t ${f.t}`);
    assert.deepEqual(f.differs, ['fresh page'], `t ${f.t}: the first page's three passes agree with each other`);
  }
  assert.match(r.out, /differs in: fresh page/);
  assert.match(r.out, /FAIL: 62 of 62 times differ/);
});

test('check-determinism fails a flat build at the default floor of one distinct frame per shot', () => {
  const file = plantedPage('flat', '__frameRGB', "(f) => (t) => { const r = f(t); return { info: r.info, b64: 'A'.repeat(r.b64.length) }; }");
  const r = run('check-determinism.js', ['--file', file], 'determinism-flat');
  assert.equal(r.code, 1, r.out);
  const rep = r.report;
  assert.equal(rep.errors.length, 0, rep.errors.join('\n'));
  assert.equal(rep.failures.length, 0, 'every hash matches: a flat build is deterministic');
  assert.equal(rep.distinctFrames, 1);
  assert.equal(rep.minDistinct, 15);
  assert.equal(rep.tooFlat, true);
  assert.match(r.out, /TOO FLAT: only 1 distinct frame, want at least 15/);
  assert.match(r.out, /FAIL: 0 of 62 times differ or drew the wrong shot, 0 page errors, 1 distinct frame \(min 15\)/);
});

// ---------- check-cameras (headless Chromium, dist/index.html) ----------

test('check-cameras passes: the three.js cameras match makeCamera on every shot, roll included', () => {
  const r = run('check-cameras.js', [], 'cameras');
  assert.equal(r.code, 0, `${r.out}\n${r.err}`);
  const rep = r.report;
  assert.equal(rep.ok, true);
  assert.deepEqual(rep.stale, []);
  assert.equal(rep.shots.length, 15);
  for (const s of rep.shots) {
    assert.ok(s.compared >= 1, `shot ${s.n} compared nothing`);
    assert.equal(s.bad, 0, `shot ${s.n}`);
    assert.ok(s.worst.diff < 1e-6, `shot ${s.n} worst ${s.worst.diff}`);
    assert.ok(s.rows.every((x) => !x.nonFinite), `shot ${s.n} has a broken projection`);
  }
  near(rep.shots[4].maxRollDeg, 3, 0.01, 'shot 5 roll');
  // shot 1 is framed so the lamp head sits at (0.36, 0.30)
  const lamp = rep.shots[0].rows.find((x) => x.landmark === 'lamp head' && x.t === 0.01);
  near(lamp.actual[0], 0.36, 1e-6, 'lamp head x');
  near(lamp.actual[1], 0.30, 1e-6, 'lamp head y');
  assert.match(r.out, /PASS: \d+ comparisons/);
});

test('check-cameras fails on a wrong expectation: shot 5 aimed 2 degrees off, then its roll reversed', () => {
  for (const [arg, name] of [['5', 'cameras-injected-aim'], ['5:roll', 'cameras-injected-roll']]) {
    const r = run('check-cameras.js', ['--inject-error', arg], name);
    assert.equal(r.code, 1, r.out);
    const failed = r.report.shots.filter((s) => !s.ok);
    assert.deepEqual(failed.map((s) => s.n), [5], `${arg}: only shot 5 fails`);
    assert.ok(failed[0].worst.diff > TOL, `${arg}: worst ${failed[0].worst.diff}`);
    assert.ok(failed[0].bad >= 1);
    assert.match(r.out, /\n\s+5\s+35\s+3\.0\s+.*FAIL .*\d+ over 0\.01, worst/);
    assert.match(r.out, /FAIL: \d+ comparisons, .* 1 of 15 shots failed/);
  }
  // control: reversing a zero roll changes nothing, so the hook is not failing shots by itself
  const ctl = run('check-cameras.js', ['--inject-error', '1:roll'], 'cameras-injected-control');
  assert.equal(ctl.code, 0, ctl.out);
});

test('check-cameras fails a build whose projection goes NaN at each shot\'s sketch time, even when NaN is not the first row', () => {
  const sketch = SHOTS.map((s) => s.sketchAt);
  const file = plantedPage('nan-sketch', '__project', `(f) => (p, t) => (${JSON.stringify(sketch)}.includes(t) ? [NaN, NaN] : f(p, t))`);
  const r = run('check-cameras.js', ['--file', file], 'cameras-nan');
  assert.equal(r.code, 1, r.out);
  const rep = r.report;
  assert.equal(rep.errors.length, 0, rep.errors.join('\n'));
  assert.deepEqual(rep.shots.filter((s) => !s.ok).map((s) => s.n), SHOTS.map((s) => s.n), 'every shot fails');
  for (const s of rep.shots) {
    const shot = SHOTS.find((x) => x.n === s.n);
    const broken = s.rows.filter((x) => x.nonFinite);
    assert.equal(broken.length, landmarksAt(shot.sketchAt).length, `shot ${s.n}: every landmark at the sketch time, in frame or not`);
    assert.ok(broken.every((x) => x.t === shot.sketchAt && x.actual.every((v) => v === 'NaN')), `shot ${s.n}: NaN kept in the JSON`);
    assert.equal(s.worst.nonFinite, true, `shot ${s.n}`);
    assert.match(s.problems[0], /non-finite projection/);
  }
  // the case a worst-row-only judge missed: shot 5's first row is a good one
  assert.equal(rep.shots[4].rows[0].nonFinite, undefined);
  assert.match(r.out, /FAIL: \d+ comparisons, worst non-finite .* 15 of 15 shots failed/);
});
