// Builds the Gate 1 review page: one self-contained HTML file (SVGs embedded as data URIs) for the Artifact viewer.
// Usage: node scripts/review-page.js --out <path>
// The page content has no doctype, html, head or body tags; the viewer wraps it.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHOTS, tcode } from '../src/shots.js';
import { carTimes } from '../src/world.js';
import { shotColor } from './lib/map.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const outPath = args.includes('--out') ? args[args.indexOf('--out') + 1] : resolve(root, 'storyboard/review-page.html');
const report = JSON.parse(readFileSync(resolve(root, 'storyboard/report.json'), 'utf8'));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const uri = (rel) => `data:image/svg+xml;base64,${readFileSync(resolve(root, 'storyboard', rel)).toString('base64')}`;

const QUESTIONS = [
  ['Where does the moon rise?', 'Due east (84 degrees) so it can rise between the city banks, or east-north-east (67.5 degrees) as the brief says. At 67.5 it would rise behind the north-bank skyline unless the river bends downstream, which is more set work.', 'Default: 84 degrees.'],
  ['Should A be seen crossing the headlight beams?', 'A walks round the front of the car while the beams cut out (0:34.6 to 0:39.9). Shot 5 is at the side, so this is mostly off screen.', 'Default: leave it off screen.'],
  ['Is shot 2 right as it is?', 'The south-east corner building is the second block on the right; the first dark mass is the building beside it. It reads as a canyon leading to the bridge.', 'Default: yes.'],
];

const car = report.carFromShot3;
const strip = SHOTS.map((s) => `<button class="seg" style="flex:${s.end - s.start};--c:${shotColor(s.n)}" data-go="shot-${s.n}" aria-label="Jump to shot ${s.n}, ${tcode(s.start)}"><span>${s.n}</span></button>`).join('');
const panels = SHOTS.map((s) => `<figure id="shot-${s.n}" style="--c:${shotColor(s.n)}"><button class="zoom" data-alt="Shot ${s.n}, ${esc(s.title)}"><img alt="Storyboard panel for shot ${s.n}: ${esc(s.title)}. ${esc(s.action)}" src="${uri(`panels/shot-${String(s.n).padStart(2, '0')}.svg`)}" loading="lazy"></button></figure>`).join('');
const maps = [['map.svg', 'Set map, top down'], ['map-detail-arrival.svg', 'Detail: arrival and reveal, shots 4 to 7'], ['map-detail-bridge.svg', 'Detail: onto the bridge and the moonrise, shots 8 to 10'], ['map-detail-glances.svg', 'Detail: the railing, shots 11 to 15']]
  .map(([f, alt], i) => `<figure class="${i === 0 ? 'wide' : ''}"><button class="zoom" data-alt="${esc(alt)}"><img alt="${esc(alt)}" src="${uri(f)}" loading="lazy"></button></figure>`).join('');
const cuts = report.cuts.map((c) => `<tr><td>${c.cut}</td><td>${c.angleDeg}</td><td>${c.sizeRatio}</td><td>${esc(c.verdict)}</td></tr>`).join('');
const lms = report.landmarks.filter((r) => !String(r.shot).includes('last')).map((r) => `<tr><td>${r.shot}</td><td>${Object.entries(r.landmarks).map(([k, v]) => `${esc(k)} ${v.x.toFixed(2)}, ${v.y.toFixed(2)}`).join('<br>')}</td></tr>`).join('');
const dirs = report.directions.map((d) => `${d.shot}`).join(', ');
const qs = QUESTIONS.map(([q, why, def], i) => `<li><h3>${esc(q)}</h3><p>${esc(why)}</p><p class="def">${esc(def)}</p></li>`).join('');

const html = `<title>Snow Lamp Bridge Storyboard</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500&family=Source+Sans+3:wght@400;600&display=swap">
<style>
/* Layout: one column of sections under a sticky shot strip; panels in a responsive grid; maps full width then three details. Dark first, the lamp's amber is the single accent. */
:root {
  --bg: #0b0f1a; --surface: #121829; --line: #232d47; --fg: #e6ebf7; --dim: #93a0bd; --accent: #ffb46b; --cool: #8fb0ff; --warn: #ff9c9c;
  --display: "Barlow Condensed", "Arial Narrow", "Helvetica Neue", sans-serif; --body: "Source Sans 3", "Helvetica Neue", Arial, sans-serif; --mono: "IBM Plex Mono", ui-monospace, Menlo, monospace;
  color-scheme: dark;
}
@media (prefers-color-scheme: light) { :root:not([data-theme="dark"]) { --bg: #f2f4f9; --surface: #ffffff; --line: #d3d9e8; --fg: #121829; --dim: #566480; --accent: #9a4f0d; --cool: #3558b8; --warn: #b3322f; color-scheme: light; } }
:root[data-theme="light"] { --bg: #f2f4f9; --surface: #ffffff; --line: #d3d9e8; --fg: #121829; --dim: #566480; --accent: #9a4f0d; --cool: #3558b8; --warn: #b3322f; color-scheme: light; }
* { box-sizing: border-box; }
body { background: var(--bg); color: var(--fg); font: 17px/1.55 var(--body); padding-block: 0 64px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
.wrap { max-width: 1320px; margin: 0 auto; }
h1, h2, h3 { font-family: var(--display); font-weight: 600; letter-spacing: 0.01em; text-wrap: balance; margin: 0; line-height: 1.1; }
h1 { font-size: clamp(2.4rem, 7vw, 4.2rem); font-weight: 700; }
h2 { font-size: 1.9rem; margin: 52px 0 6px; } h3 { font-size: 1.3rem; }
p { max-width: 68ch; margin: 8px 0 0; } .dim { color: var(--dim); }
.kicker { font: 500 0.8rem var(--mono); letter-spacing: 0.12em; text-transform: uppercase; color: var(--accent); margin: 28px 0 8px; }
.facts { display: flex; flex-wrap: wrap; gap: 6px 28px; font: 400 0.9rem var(--mono); color: var(--dim); margin-top: 14px; } .facts b { color: var(--fg); font-weight: 500; }
.bar { position: sticky; top: env(safe-area-inset-top, 0px); z-index: 5; background: var(--bg); border-bottom: 1px solid var(--line); margin: 24px calc(-1 * max(16px, env(safe-area-inset-left, 0px))) 0; padding: 8px max(16px, env(safe-area-inset-right, 0px)) 8px max(16px, env(safe-area-inset-left, 0px)); }
body::before { content: ""; position: fixed; inset: 0 0 auto; height: env(safe-area-inset-top, 0px); z-index: 10; background: var(--bg); }
.strip { display: flex; gap: 2px; max-width: 1320px; margin: 0 auto; }
.seg { flex-basis: 0; min-width: 0; height: 30px; border: 0; padding: 0; background: var(--c); color: #0b0f1a; font: 700 0.85rem var(--display); cursor: pointer; border-radius: 2px; }
.seg:hover { filter: brightness(1.12); } .seg span { pointer-events: none; }
:focus-visible { outline: 2px solid var(--cool); outline-offset: 2px; }
ul.look { list-style: none; padding: 0; margin: 14px 0 0; display: grid; gap: 10px; } ul.look li { padding-left: 16px; position: relative; max-width: 68ch; } ul.look li::before { content: ""; position: absolute; left: 0; top: 0.7em; width: 7px; height: 7px; border-radius: 50%; background: var(--accent); }
.maps { display: grid; gap: 14px; margin-top: 16px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 380px), 1fr)); }
.maps .wide { grid-column: 1 / -1; }
.grid { display: grid; gap: 16px; margin-top: 16px; grid-template-columns: repeat(auto-fill, minmax(min(100%, 400px), 1fr)); }
figure { margin: 0; min-width: 0; background: var(--surface); border: 1px solid var(--line); border-top: 4px solid var(--c, var(--line)); border-radius: 4px; overflow: hidden; scroll-margin-top: 72px; }
.zoom { display: block; width: 100%; padding: 0; border: 0; background: #0d1320; cursor: zoom-in; } .zoom img { display: block; width: 100%; height: auto; }
.audits { display: grid; gap: 18px; margin-top: 16px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 340px), 1fr)); }
.card { background: var(--surface); border: 1px solid var(--line); border-radius: 4px; padding: 16px; min-width: 0; } .card h3 { margin-bottom: 6px; } .card p { margin-top: 6px; }
.num { font: 500 1.6rem var(--mono); color: var(--accent); font-variant-numeric: tabular-nums; }
details { margin-top: 14px; } summary { cursor: pointer; font: 600 1.05rem var(--display); letter-spacing: 0.02em; }
.scroll { overflow-x: auto; margin-top: 8px; } table { border-collapse: collapse; width: 100%; font: 400 0.85rem var(--mono); font-variant-numeric: tabular-nums; } th, td { text-align: left; padding: 5px 10px 5px 0; border-bottom: 1px solid var(--line); vertical-align: top; } th { color: var(--dim); font-weight: 500; }
ol.q { padding: 0; margin: 16px 0 0; display: grid; gap: 14px; counter-reset: q; list-style: none; max-width: 68ch; }
ol.q li { counter-increment: q; background: var(--surface); border: 1px solid var(--line); border-radius: 4px; padding: 14px 16px 14px 56px; position: relative; }
ol.q li::before { content: counter(q); position: absolute; left: 16px; top: 10px; font: 700 1.8rem var(--display); color: var(--accent); }
.def { font: 500 0.85rem var(--mono); color: var(--cool); }
footer { margin-top: 56px; color: var(--dim); font-size: 0.9rem; border-top: 1px solid var(--line); padding-top: 16px; } code { font-family: var(--mono); font-size: 0.88em; }
dialog { padding: 0; border: 1px solid var(--line); background: var(--bg); color: var(--fg); max-width: 96vw; max-height: 94vh; border-radius: 4px; } dialog::backdrop { background: rgb(5 8 14 / 0.8); }
dialog .head { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 8px 12px; position: sticky; top: 0; background: var(--bg); border-bottom: 1px solid var(--line); font: 500 0.85rem var(--mono); }
dialog button { font: 600 0.95rem var(--display); letter-spacing: 0.03em; padding: 6px 14px; border-radius: 3px; border: 1px solid var(--line); background: var(--surface); color: var(--fg); cursor: pointer; }
dialog img { display: block; width: min(1280px, 92vw); height: auto; background: #0d1320; }
</style>
<div class="wrap">
<p class="kicker">Gate 1, Stage 1, for your markup</p>
<h1>Snow, Lamp, Bridge</h1>
<p>Storyboard for the 1:52 silent scene. Nothing is built in 3D yet. The map and all 15 panels are drawn from the same shot data the scene will use, so they cannot drift from it.</p>
<div class="facts"><span><b>112 s</b> runtime</span><span><b>15</b> shots</span><span><b>24</b> fps</span><span><b>480 x 270</b> internal</span></div>
<div class="bar"><div class="strip" role="navigation" aria-label="Jump to a shot">${strip}</div></div>

<h2>What to look at</h2>
<ul class="look">
<li>The map first. The red dashed line is the 180 degree line between the two people. Every glance camera stays on the west side of it.</li>
<li>Then the 15 panels in order. Each is a true-perspective sketch through that shot's lens. White dashed lines are thirds, the red band is the bottom 120 px that YouTube covers, and the small frames beside the caption are other moments in the same shot.</li>
<li>Last, the three questions at the bottom. Reply with answers, or "go" to take the defaults.</li>
</ul>

<h2>Set map</h2>
<p class="dim">North is up. Numbered circles are cameras, with their field of view. Tap any image to enlarge it.</p>
<div class="maps">${maps}</div>

<h2>Shot by shot</h2>
<div class="grid">${panels}</div>

<h2>Checks measured from the shot data</h2>
<div class="audits">
<div class="card"><h3>The car behind the corner</h3><p>From camera 3 the car is hidden until <span class="num">${car.noseVisible.toFixed(1)} s</span>, and fully visible at ${car.fullyVisible.toFixed(1)} s. The headlights come on at ${carTimes.start.toFixed(1)} s, so the beams reach the facades about ${(car.noseVisible - carTimes.start).toFixed(1)} s first.</p></div>
<div class="card"><h3>Screen direction</h3><p>In shots ${dirs}, north (toward the bridge) is screen left. The car, the walk and the eyelines all travel the same way.</p></div>
<div class="card"><h3>Safe strip and the line</h3><p>No head, foot, lamp, moon or car falls in the bottom 120 px at any sketch frame or last frame. Cameras for shots 9 to 15 are all west of the A and B line.</p></div>
</div>
<details><summary>Every cut: angle change and size step</summary><div class="scroll"><table><tr><th>Cut</th><th>Angle deg</th><th>Size ratio</th><th>Verdict</th></tr>${cuts}</table></div></details>
<details><summary>Where things land in each frame (x, y as a fraction, top left is 0, 0)</summary><div class="scroll"><table><tr><th>Shot</th><th>Landmarks</th></tr>${lms}</table></div></details>

<h2>Three decisions for you</h2>
<ol class="q">${qs}</ol>

<footer>Source and the editable map (<code>map.excalidraw</code>) are in <code>_workbench/snowy-bridge/</code> on branch <code>claude/snow-lamp-bridge-scene-kyov3c</code>. Notes for this round are in <code>review/round-01/notes.md</code>.</footer>
</div>
<dialog id="lb" aria-label="Enlarged image"><div class="head"><span id="lbt"></span><button type="button" id="lbx">Close</button></div><img id="lbi" alt=""></dialog>
<script>
(function () {
  var lb = document.getElementById('lb'), img = document.getElementById('lbi'), t = document.getElementById('lbt');
  document.addEventListener('click', function (e) {
    var z = e.target.closest('.zoom');
    if (z && lb && lb.showModal) { img.src = z.querySelector('img').src; img.alt = z.getAttribute('data-alt') || ''; t.textContent = z.getAttribute('data-alt') || ''; lb.showModal(); return; }
    var g = e.target.closest('[data-go]');
    if (g) { var el = document.getElementById(g.getAttribute('data-go')); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    if (e.target.id === 'lbx' || e.target === lb) lb.close();
  });
})();
</script>
`;
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, html);
console.log('wrote', outPath, (html.length / 1024 / 1024).toFixed(2), 'MB');
