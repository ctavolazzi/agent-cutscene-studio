// Stage 1 storyboard generator. Reads src/set.js, src/world.js and src/shots.js and writes:
//   storyboard/map.svg, map-detail-*.svg, map.excalidraw, panels/shot-NN.svg, report.json, index.html, index-standalone.html
//   review/round-NN/*.png   (rasters for review, only with --raster; the sheet is storyboard-sheet.png)
// Usage: node scripts/storyboard.js [--raster] [--round 01]
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Draw } from './lib/draw.js';
import { buildMainMap, buildDetailMap, DETAIL_GROUPS, shotColor } from './lib/map.js';
import { buildPanel, PW, PH, CAPTION_H } from './lib/panel.js';
import { runChecks } from './lib/checks.js';
import { rasterize } from './lib/raster.mjs';
import { SHOTS, tcode } from '../src/shots.js';
import { carTimes } from '../src/world.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const raster = args.includes('--raster');
const round = args.includes('--round') ? args[args.indexOf('--round') + 1] : '01';
const out = (p) => resolve(root, p);
const write = (p, s) => { mkdirSync(dirname(out(p)), { recursive: true }); writeFileSync(out(p), s); };

// ---- map files
const main = buildMainMap();
write('storyboard/map.svg', main.d.toSVG());
const detail = {};
for (const g of DETAIL_GROUPS) { detail[g.id] = buildDetailMap(g); write(`storyboard/map-detail-${g.id}.svg`, detail[g.id].d.toSVG()); }

// one Excalidraw scene: the main map, then the three detail maps in a row to its right
{
  const sheet = new Draw(1, 1);
  buildMainMap(sheet, [0, 0]);
  let x = main.d.w + 100;
  // `b.d` is the shared sheet, so step by the detail map's own view width
  for (const g of DETAIL_GROUPS) { const b = buildDetailMap(g, sheet, [x, 0]); x += b.v.w + 120; }
  write('storyboard/map.excalidraw', JSON.stringify(sheet.toExcalidraw({ bg: '#080c16' }), null, 1));
  console.log('map.excalidraw elements:', sheet.items.length);
}

// ---- panels
const panels = [];
for (const s of SHOTS) {
  const p = buildPanel(s);
  const name = `panels/shot-${String(s.n).padStart(2, '0')}.svg`;
  write(`storyboard/${name}`, p.toSVG());
  panels.push({ shot: s, name });
}

// ---- checks
const checks = runChecks();
write('storyboard/report.json', JSON.stringify(checks, null, 1));

// ---- contact sheet
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const lmRows = checks.landmarks.filter((r) => !String(r.shot).includes('last')).map((r) => {
  const cells = Object.entries(r.landmarks).map(([k, v]) => `${k} ${v.x.toFixed(2)},${v.y.toFixed(2)}${v.safeStrip ? ' <b>(safe strip!)</b>' : ''}`).join('<br>');
  return `<tr><td>${r.shot}</td><td>${r.t}</td><td>${r.hfov} x ${r.vfov}</td><td>${cells}</td></tr>`;
}).join('');
const cutRows = checks.cuts.map((c) => `<tr><td>${c.cut}</td><td>${c.subjectGapM}</td><td>${c.angleDeg}</td><td>${c.sizeRatio}</td><td class="${c.verdict.startsWith('WARN') ? 'warn' : ''}">${c.verdict}</td></tr>`).join('');
const dirRows = checks.directions.map((r) => `<tr><td>${r.shot}</td><td>${r.north}</td></tr>`).join('');
const sideRows = checks.sides.map((r) => `<tr><td>${r.shot}</td><td>${r.camX}</td><td>${r.side}</td></tr>`).join('');
const car = checks.carFromShot3;

function page(img) {
  const mapImgs = DETAIL_GROUPS.map((g) => `<a href="map-detail-${g.id}.svg"><img src="${img(`map-detail-${g.id}.svg`)}" alt="${esc(g.title)}"></a>`).join('');
  const cards = panels.map(({ shot, name }) => `<figure style="--c:${shotColor(shot.n)}"><a href="${name}"><img src="${img(name)}" alt="Shot ${shot.n}"></a></figure>`).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Snow Lamp Bridge Storyboard</title>
<style>
:root { color-scheme: dark; --bg:#080c16; --fg:#e8eefc; --dim:#8794b3; --line:#1d2740; --warn:#ff8c8c; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.5 Helvetica, Arial, sans-serif; }
main { max-width: 1500px; margin: 0 auto; padding: 24px 16px 64px; }
h1 { font-size: 28px; margin: 0 0 4px; } h2 { font-size: 20px; margin: 40px 0 12px; border-bottom: 1px solid var(--line); padding-bottom: 6px; }
p, li { color: #c9d4ee; max-width: 90ch; } .dim { color: var(--dim); }
img { display: block; width: 100%; height: auto; background: #0d1320; }
.maps { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); margin-top: 16px; }
.grid { display: grid; gap: 18px; grid-template-columns: repeat(auto-fill, minmax(min(100%, 440px), 1fr)); }
figure { margin: 0; border: 1px solid var(--line); border-top: 4px solid var(--c); border-radius: 4px; overflow: hidden; }
table { border-collapse: collapse; width: 100%; font-size: 13px; margin: 8px 0 24px; } th, td { text-align: left; padding: 5px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { color: var(--dim); font-weight: 600; } .warn { color: var(--warn); font-weight: 700; }
.cols { display: grid; gap: 24px; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); }
a { color: #9db4ff; }
</style></head><body><main>
<h1>Snow, Lamp, Bridge: storyboard</h1>
<p class="dim">Stage 1, for your markup. Everything here is generated from <code>src/set.js</code>, <code>src/world.js</code> and <code>src/shots.js</code>, so it cannot drift from the scene. The panels are true-perspective sketches through each shot's real lens.</p>
<h2>Set map</h2>
<p>Top-down, north up. Numbered circles are cameras with their field of view. The red dashed line is the 180 degree line between A and B. Click a map for the full SVG. The editable version is <code>map.excalidraw</code> (open it at excalidraw.com).</p>
<a href="map.svg"><img src="${img('map.svg')}" alt="Set map"></a>
<div class="maps">${mapImgs}</div>
<h2>Shot by shot</h2>
<p class="dim">White dashed lines are thirds. The red band is the bottom 120 px of a 1080p frame (YouTube's progress bar). Moving shots show an end frame at the right of the caption. White arrows are camera moves.</p>
<div class="grid">${cards}</div>
<h2>Checks, measured from the shot data</h2>
<div class="cols"><div>
<h3>The car and the corner building</h3>
<p>From camera 3 the car is hidden from the start, its nose clears the corner at <b>${car.noseVisible.toFixed(1)} s</b> and all of it is visible at <b>${car.fullyVisible.toFixed(1)} s</b>. The headlights come on at ${carTimes.start.toFixed(1)} s, so the beams reach the facades about ${(car.noseVisible - carTimes.start).toFixed(1)} s before the car appears.</p>
<h3>Is north (toward the bridge) screen left?</h3><table><tr><th>Shot</th><th>North reads as</th></tr>${dirRows}</table>
<h3>Which side of the 180 degree line?</h3><table><tr><th>Shot</th><th>Camera x</th><th>Side</th></tr>${sideRows}</table>
</div><div>
<h3>Cuts: 30 degrees or a clear size step</h3><table><tr><th>Cut</th><th>Subject gap m</th><th>Angle</th><th>Size ratio</th><th>Verdict</th></tr>${cutRows}</table>
</div></div>
<h3>Landmarks in frame (x, y as a fraction of the frame, 0,0 top left)</h3>
<table><tr><th>Shot</th><th>t</th><th>FOV deg</th><th>Landmarks</th></tr>${lmRows}</table>
</main></body></html>`;
}
write('storyboard/index.html', page((n) => n));
const dataUri = (n) => `data:image/svg+xml;base64,${readFileSync(out('storyboard/' + n)).toString('base64')}`;
write('storyboard/index-standalone.html', page(dataUri));
console.log('wrote storyboard: map, 3 detail maps, excalidraw, 15 panels, report, index.html, index-standalone.html');

// ---- rasters for review
if (raster) {
  const dir = `review/round-${round}`;
  mkdirSync(out(dir + '/panels'), { recursive: true });
  const jobs = [
    // storyboard-sheet, not contact-sheet: a round folder also holds the blockout contact sheet
    { file: out('storyboard/index.html'), out: out(`${dir}/storyboard-sheet.png`), width: 1500, height: 900 },
    { file: out('storyboard/map.svg'), out: out(`${dir}/map.png`), width: Math.round(main.d.w), height: Math.round(main.d.h) },
  ];
  for (const g of DETAIL_GROUPS) jobs.push({ file: out(`storyboard/map-detail-${g.id}.svg`), out: out(`${dir}/map-detail-${g.id}.png`), width: Math.round(detail[g.id].d.w), height: Math.round(detail[g.id].d.h) });
  for (const { shot, name } of panels) jobs.push({ file: out('storyboard/' + name), out: out(`${dir}/panels/shot-${String(shot.n).padStart(2, '0')}.png`), width: PW, height: PH + CAPTION_H });
  await rasterize(jobs);
  console.log(`rasterized ${jobs.length} images to ${dir}`);
}
