// The committed audio stills and arrangement against the code (ROADMAP Sound 2.9): the blockout rendered once in a
// session (scripts/sound-review.js makeSession, about 25 s), measure.json read through measureOf (which refuses one
// measured on another render), every still and the arrangement rebuilt from the session's mastered mix and stems, and
// each SVG's sha256 compared with the one stills.json and sheet.json record. Rasterized by the Chromium that made the
// committed PNGs, they give those PNGs' sha256 (tests/sound-stills.test.mjs holds each committed PNG to its recorded
// sha256). So a change to the drawing code that is not followed by `node scripts/sound-review.js --round 05 --stills
// --sheet` fails here. The controls: a still on a colour scale 2 dB lower (SPEC.lo -90), and an arrangement whose
// levels are not over the street background.
// Run: node --test tests/sound-stills-rebuild.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHOTS } from '../src/shots.js';
import { rasterize } from '../scripts/lib/raster.mjs';
import { ARRANGEMENT_TS, makeSession, measureOf } from '../scripts/sound-review.js';
import { SCALE, SPEC, STILL, buildArrangement, buildStill, groupLevels, stillData } from '../scripts/lib/sound-stills.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REVIEW = resolve(ROOT, 'review/round-05');
const read = (p) => JSON.parse(readFileSync(resolve(REVIEW, p), 'utf8'));
const sha = (data) => createHash('sha256').update(data).digest('hex');
const dir = mkdtempSync(join(tmpdir(), 'sound-stills-rebuild-'));

// the session and every drawing, once for both tests
const session = makeSession({ log: () => {} }), measure = measureOf(session, REVIEW), stemOf = (g) => session.group(g), mix = session.mastered();
const DATA = SHOTS.map((s) => stillData(s, { mix, stemOf, measure }));
const STILLS = DATA.map((d) => buildStill(d, { measure }));
const ARR = buildArrangement({ measure, envelopes: groupLevels(session.groups, stemOf, measure, ARRANGEMENT_TS) });
const JSON_STILLS = read('stills.json'), SHEET = read('sheet.json');
// the controls: shot 5 on a colour scale 2 dB lower, the arrangement's levels not over the street (30 dB off)
const K = 4, LOWER = buildStill(DATA[K], { measure, scale: { ...SPEC, lo: SPEC.lo - 2 } });
const RAW_ARR = buildArrangement({ measure, envelopes: groupLevels(session.groups, stemOf, { ...measure, streetDb: 0 }, ARRANGEMENT_TS) });

test('the committed stills and arrangement are the code\'s drawings of the blockout: each SVG rebuilt from a session hashes to stills.json\'s and sheet.json\'s; a colour scale 2 dB lower and levels not over the street are caught', () => {
  assert.equal(JSON_STILLS.stills.length, STILLS.length);
  const off = STILLS.filter((st, i) => sha(st.d.toSVG()) !== JSON_STILLS.stills[i].svgSha256).map((st) => `shot ${st.shot.n}`);
  assert.deepEqual(off, [], 'stills whose SVG is not the one stills.json records: run node scripts/sound-review.js --round 05 --stills --sheet');
  assert.equal(sha(ARR.d.toSVG()), SHEET.arrangement.svgSha256, 'the arrangement\'s SVG');
  assert.notEqual(sha(LOWER.d.toSVG()), JSON_STILLS.stills[K].svgSha256, 'control: shot 5 on SPEC.lo -90');
  assert.notEqual(sha(RAW_ARR.d.toSVG()), SHEET.arrangement.svgSha256, 'control: the arrangement\'s levels not over the street');
});

test('rasterized by the Chromium that made them, the rebuilt SVGs give the committed PNGs (their recorded sha256); the control still does not', async (t) => {
  const jobs = STILLS.map((st, i) => ({ st, want: JSON_STILLS.stills[i].pngSha256, name: `shot-${i + 1}` }));
  jobs.push({ st: LOWER, want: JSON_STILLS.stills[K].pngSha256, name: 'control', control: true });
  const files = jobs.map((j) => { const svg = join(dir, `${j.name}.svg`); writeFileSync(svg, j.st.d.toSVG()); return { file: svg, out: join(dir, `${j.name}.png`), width: STILL.w, height: j.st.height, scale: SCALE }; });
  const arrSvg = join(dir, 'arrangement.svg');
  writeFileSync(arrSvg, ARR.d.toSVG());
  files.push({ file: arrSvg, out: join(dir, 'arrangement.png'), width: Math.round(ARR.d.w), height: Math.round(ARR.d.h) });
  const version = await rasterize(files);
  if (version !== JSON_STILLS.chromium || version !== SHEET.chromium) { t.skip(`this Chromium is ${version}; the PNGs were made by ${JSON_STILLS.chromium}, whose fonts and raster may differ`); return; }
  const got = (i) => sha(readFileSync(files[i].out));
  assert.deepEqual(jobs.filter((j, i) => !j.control && got(i) !== j.want).map((j) => j.name), [], 'stills whose raster is not the committed PNG');
  assert.equal(got(files.length - 1), SHEET.arrangement.pngSha256, 'the arrangement\'s raster');
  assert.notEqual(got(jobs.length - 1), jobs[jobs.length - 1].want, 'control: the planted still rasterizes to other bytes');
});
