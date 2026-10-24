// Sound 1 storyboard generator (SOUND-PLAN.md 4.3). Reads src/audio/cues.js, SHOTS, src/audio/spatial.js and the
// published export's frames, and writes, by default to storyboard/sound/:
//   map.svg, map-detail-<id>.svg (4), map.excalidraw, timeline.svg, panels/shot-NN.svg (15), index.html
// index.html is the contact sheet; when report.json sits beside it (scripts/sound-report.js writes it) the sheet renders
// its checks and tables, and otherwise says where it comes from. With --raster, PNGs of every drawing and of the sheet go
// to review/round-NN/ (--round, default 04), or to --raster-dir.
// Usage: node scripts/sound-storyboard.js [--out <dir>] [--raster] [--round 04] [--raster-dir <dir>] [--video <mp4>]
//        [--no-frames]
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Draw } from './lib/draw.js';
import { shotColor } from './lib/map.js';
import { buildSoundMap, buildSoundDetail, soundDetails, makePredictor, RULE_TEXT, FAMILY, PERSON, LAW_COLOR, fmtT, fmtDb } from './lib/sound-map.js';
import { buildTimeline, bedOnlyWindows } from './lib/sound-timeline.js';
import { buildSoundPanel, decodeFrames, panelFrame, PANEL_W } from './lib/sound-panel.js';
import { rasterize } from './lib/raster.mjs';
import { CUES, LAWS, WORLD } from '../src/audio/cues.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pad2 = (n) => String(n).padStart(2, '0');
export const panelName = (shot) => `panels/shot-${pad2(shot.n)}.svg`;

async function main() {
  const args = process.argv.slice(2);
  const opt = (k, dflt) => (args.includes(k) ? args[args.indexOf(k) + 1] : dflt);
  const outDir = resolve(root, opt('--out', 'storyboard/sound'));
  const raster = args.includes('--raster'), round = opt('--round', '04');
  const rasterDir = resolve(root, opt('--raster-dir', `review/round-${round}`));
  const video = resolve(root, opt('--video', 'out/snowy-bridge.mp4'));
  const frames = !args.includes('--no-frames');
  const out = (p) => resolve(outDir, p);
  const write = (p, s) => { mkdirSync(dirname(out(p)), { recursive: true }); writeFileSync(out(p), s); };

  // ---- the maps, and the Excalidraw sheet: the main map, then the detail maps in a row to its right
  const main = buildSoundMap();
  write('map.svg', main.d.toSVG());
  const details = soundDetails().map((g) => { const b = buildSoundDetail(g); write(`map-detail-${g.id}.svg`, b.d.toSVG()); return { g, b }; });
  const sheet = new Draw(1, 1);
  buildSoundMap({}, sheet, [0, 0]);
  let x = main.d.w + 100;
  for (const { g, b } of details) { buildSoundDetail(g, {}, sheet, [x, 0]); x += b.d.w + 100; }
  const scene = sheet.toExcalidraw({ bg: '#080c16', source: 'snow-lamp-bridge/scripts/sound-storyboard.js' });
  write('map.excalidraw', JSON.stringify(scene, null, 1));

  // ---- the timeline
  const tl = buildTimeline();
  write('timeline.svg', tl.d.toSVG());

  // ---- the panels, each with its own frame from the published export
  if (frames && !existsSync(video)) throw new Error(`no export at ${video}: the panels show its frames (pass --video <mp4>, or --no-frames to draw them without)`);
  const want = WORLD.SHOTS.map((s) => panelFrame(s));
  const decoded = frames ? decodeFrames(video, want.map((f) => f.n)) : new Map();
  const panels = WORLD.SHOTS.map((s, i) => {
    const fr = want[i], p = buildSoundPanel(s, { frame: { ...fr, png: decoded.get(fr.n) ?? null } });
    write(panelName(s), p.d.toSVG());
    return { shot: s, p };
  });

  // ---- the contact sheet
  const reportPath = out('report.json');
  const report = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8')) : null;
  write('index.html', sheetHtml(report));
  const dropped = [main, ...details.map((q) => q.b), tl, ...panels.map((q) => q.p)].reduce((s, b) => s + b.labeler.dropped.length, 0);
  console.log(`wrote ${relative(root, outDir) || outDir}: map, ${details.length} detail maps, map.excalidraw (${scene.elements.length} elements), timeline, ${panels.length} panels, index.html${report ? ' with report.json' : ' (no report.json yet)'}; ${dropped} labels dropped`);

  if (raster) {
    mkdirSync(resolve(rasterDir, 'panels'), { recursive: true });
    const px = (b) => ({ width: Math.round(b.d.w), height: Math.round(b.d.h) });
    const jobs = [
      { file: out('index.html'), out: resolve(rasterDir, 'storyboard-sheet.png'), width: 1500, height: 900 },
      { file: out('map.svg'), out: resolve(rasterDir, 'map.png'), ...px(main) },
      { file: out('timeline.svg'), out: resolve(rasterDir, 'timeline.png'), ...px(tl) },
      ...details.map(({ g, b }) => ({ file: out(`map-detail-${g.id}.svg`), out: resolve(rasterDir, `map-detail-${g.id}.png`), ...px(b) })),
      ...panels.map(({ shot, p }) => ({ file: out(panelName(shot)), out: resolve(rasterDir, `panels/shot-${pad2(shot.n)}.png`), width: PANEL_W, height: Math.round(p.d.h) })),
    ];
    await rasterize(jobs);
    console.log(`rasterized ${jobs.length} images to ${relative(root, rasterDir) || rasterDir}`);
  }
}

// ---------- the sheet ----------
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// the id of a cue's row in the cue list, which the check tables link to
export const cueAnchor = (id) => `cue-${id}`;

// The contact sheet, index.html: the drawings, how to read them, report.json's checks and tables rendered by their
// schema (SOUND-PLAN 4.3, in the order of their n), and every cue. `report` is the parsed report.json, or null.
export function sheetHtml(report, { cues = CUES, w = WORLD } = {}) {
  const ids = new Set(cues.map((c) => c.id));
  // a cell, generically: numbers to three places, a cue id linked to its row in the cue list (the "cue" column must
  // name one; any other cell that holds a cue id, such as the cue a pair is masked by, is linked too)
  const cell = (key, v) => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'boolean') return v ? 'yes' : 'no';
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(3);
    if (ids.has(v)) return `<a href="#${esc(cueAnchor(v))}">${esc(v)}</a>`;
    if (key === 'cue') return `<span class="warn">${esc(v)} (no such cue)</span>`;
    return esc(v);
  };
  // a table of rows; a long one scrolls in its own box, so one check cannot bury the next
  const table = (t) => {
    const cols = t.columns ?? Object.keys(t.rows?.[0] ?? {});
    if (!t.rows?.length) return '<p class="dim">No rows.</p>';
    return `<div class="scroll${t.rows.length > 20 ? ' tall' : ''}"><table><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr>${t.rows.map((r) => `<tr>${cols.map((c) => `<td>${cell(c, r[c])}</td>`).join('')}</tr>`).join('')}</table></div>`;
  };
  const reportHtml = (rep) => {
    if (!rep) return '<p class="note">No <code>report.json</code> here yet. It is generated by <code>scripts/sound-report.js</code>, which writes the checks of SOUND-PLAN 4.3 to <code>storyboard/sound/report.json</code>; run it, then run this script again to see them on this page.</p>';
    const checks = (rep.checks ?? []).slice().sort((a, b) => a.n - b.n);
    const counts = ['pass', 'fail', 'report'].map((k) => `${checks.filter((c) => c.status === k).length} ${k}`).join(', ');
    const sec = checks.map((c) => `<section class="check" id="check-${esc(c.id)}">
<h3>${esc(c.n)}. ${esc(c.name)} <span class="chip ${esc(c.status)}">${esc(c.status)}</span></h3>
<p>${esc(c.definition)}</p>
<p><b>Bar:</b> ${esc(c.bar)}${c.starting ? ' <span class="dim">(a starting value, to be set from measurement)</span>' : ''}</p>
<p class="summary">${esc(c.summary)}</p>
${table(c)}
</section>`).join('\n');
    const tabs = Object.entries(rep.tables ?? {}).map(([k, t]) => `<h3 id="table-${esc(k)}">${esc(k)}</h3>${table(t)}`).join('\n');
    return `<p>${esc(rep.cues)} cues, ${esc(rep.enabled)} enabled. ${checks.length} checks: ${counts}.</p>\n${sec}\n<h2>Tables</h2>\n${tabs}`;
  };
  const colour = (c) => (FAMILY[c.family]?.person && c.person ? PERSON[c.person] : FAMILY[c.family]?.color) ?? '#fff';
  const cueList = () => {
    const cols = ['id', 'sounds, s', 'sync', 'lead', 'level, dB', 'law', 'placement', 'flags', 'label', 'from the data'];
    const rows = cues.map((c) => `<tr id="${esc(cueAnchor(c.id))}"><td style="color:${colour(c)}">${esc(c.id)}</td><td>${fmtT(c.t0)} to ${fmtT(c.t1)}</td><td>${fmtT(c.sync)}</td><td>${c.lead ? fmtT(c.lead) : ''}</td><td>${fmtDb(c.level)}${c.voices === 0 ? ' (a change)' : ''}</td><td>${esc(c.law ?? 'unplaced')}</td><td>${esc(c.placement ?? '')}</td><td>${[c.new ? 'new' : '', c.offered ? 'offered' : '', c.enabled ? '' : 'off'].filter(Boolean).join(', ')}</td><td>${esc(c.label)}</td><td class="dim">${esc(c.derivedFrom ?? '')}${c.rule ? `<br>rule: ${esc(c.rule)}` : ''}</td></tr>`).join('');
    return `<div class="scroll"><table class="cues"><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr>${rows}</table></div>`;
  };
  const pred = makePredictor({ cues, w });
  const swatch = (col) => `<span class="sw" style="background:${col}"></span>`;
  const famLegend = [...new Set(cues.map((c) => c.family))].map((f) => `<span class="key">${FAMILY[f]?.person ? swatch(PERSON.A) + swatch(PERSON.B) : swatch(FAMILY[f]?.color ?? '#fff')}${esc(f)}</span>`).join('');
  const lawLegend = Object.entries(LAWS).map(([k, L]) => `<span class="key">${swatch(LAW_COLOR[k])}${esc(k)}: ref ${L.refDist} m, rolloff ${L.rolloff}</span>`).join('');
  const places = pred.locations.map((l) => `${l.name}, shots ${l.shots[0]} to ${l.shots[l.shots.length - 1]}, ${fmtT(l.t0)} to ${fmtT(l.t1)} s, background ${fmtDb(pred.bg[l.name])} dB`).join('; ');
  const windows = bedOnlyWindows(w).map((b) => `${fmtT(b.t0)} to ${fmtT(b.t1)} s (${b.note}${b.music ? ', held for music' : ''})`).join('; ');
  const maps = soundDetails(w, cues).map((g) => `<a href="map-detail-${g.id}.svg"><img src="map-detail-${g.id}.svg" alt="${esc(g.title)}"></a>`).join('');
  const cards = w.SHOTS.map((s) => `<figure style="--c:${shotColor(s.n)}"><a href="${panelName(s)}"><img src="${panelName(s)}" alt="Shot ${s.n}"></a></figure>`).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Snow Lamp Bridge Sound Storyboard</title>
<style>
:root { color-scheme: dark; --bg:#080c16; --fg:#e8eefc; --dim:#8794b3; --line:#1d2740; --warn:#ff8c8c; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.5 Helvetica, Arial, sans-serif; }
main { max-width: 1500px; margin: 0 auto; padding: 24px 16px 64px; }
h1 { font-size: 28px; margin: 0 0 4px; } h2 { font-size: 20px; margin: 40px 0 12px; border-bottom: 1px solid var(--line); padding-bottom: 6px; }
h3 { font-size: 16px; margin: 22px 0 6px; }
p, li { color: #c9d4ee; max-width: 100ch; } .dim { color: var(--dim); } .note { color: #c9d4ee; border-left: 3px solid #8fb0ff; padding-left: 10px; }
img { display: block; width: 100%; height: auto; background: #0d1320; }
.maps { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 640px), 1fr)); margin-top: 16px; }
.grid { display: grid; gap: 18px; grid-template-columns: repeat(auto-fill, minmax(min(100%, 440px), 1fr)); }
figure { margin: 0; border: 1px solid var(--line); border-top: 4px solid var(--c); border-radius: 4px; overflow: hidden; }
table { border-collapse: collapse; width: 100%; font-size: 13px; margin: 8px 0 24px; } th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { color: var(--dim); font-weight: 600; } .warn { color: var(--warn); font-weight: 700; }
table.cues td { font-size: 12px; } table.cues td:nth-child(2) { white-space: nowrap; } .scroll { overflow-x: auto; }
.scroll.tall { max-height: 32em; overflow-y: auto; border-bottom: 1px solid var(--line); } .scroll.tall th { position: sticky; top: 0; background: var(--bg); }
.chip { display: inline-block; padding: 1px 9px; border-radius: 10px; font-size: 12px; font-weight: 700; vertical-align: 2px; color: #0b1020; }
.chip.pass { background: #6fe39a; } .chip.fail { background: #ff6b6b; } .chip.report { background: #8fb0ff; }
.check { border-top: 1px solid var(--line); } .summary { color: var(--fg); }
.key { display: inline-block; margin: 2px 14px 2px 0; font-size: 13px; color: #c9d4ee; } .sw { display: inline-block; width: 11px; height: 11px; border-radius: 2px; margin-right: 4px; vertical-align: -1px; }
a { color: #9db4ff; } tr:target td { background: #1d2a4a; }
</style></head><body><main>
<h1>Snow, Lamp, Bridge: sound storyboard</h1>
<p class="dim">Sound 1, for your markup. Everything here is generated from <code>src/audio/cues.js</code> (${cues.length} cues, ${cues.filter((c) => c.enabled).length} enabled, ${cues.filter((c) => c.new).length} new, ${cues.filter((c) => c.offered).length} offered and off), the shot table and <code>src/audio/spatial.js</code>, so it cannot drift from the picture. The panels show the published film's own frames.</p>
<h2>How to read it</h2>
<p><b>Predicted level.</b> ${esc(RULE_TEXT)}</p>
<p><b>Families</b> (glyph colours; A orange, B blue for the people's sounds): ${famLegend}</p>
<p><b>Distance laws</b> (the rings): ${lawLegend}</p>
<p><b>Bed-only windows</b> (SOUND-PLAN 3.11): ${esc(windows)}. <b>Places:</b> ${esc(places)}.</p>
<h2>Sound map</h2>
<p>Top-down, north up, the picture's view. Every placed source at its place: the car's path with its engine, exhaust and tyres every 2 s, the doors at latch and hinge, each step at its print, the cup, the tip and the mouth, the hum at the lantern. Each camera is a listener: its wedge, its left and right axis, the half behind it shaded, rings where each law has fallen by -6 to -24 dB. The editable version is <code>map.excalidraw</code> (open it at excalidraw.com).</p>
<a href="map.svg"><img src="map.svg" alt="Sound map"></a>
<div class="maps">${maps}</div>
<h2>Cue timeline</h2>
<p>One lane per voice group, like a DAW arrangement. Click it for the full size.</p>
<a href="timeline.svg"><img src="timeline.svg" alt="Cue timeline"></a>
<h2>Shot by shot</h2>
<p class="dim">The film's frame at the shot's middle with every cue's point on it, the stereo field over the whole shot (pan across, time down), the listener from above, and the shot's cue list. Numbers on the marks are rows of the list.</p>
<div class="grid">${cards}</div>
<h2>Checks (report.json)</h2>
${reportHtml(report)}
<h2>Every cue</h2>
<p class="dim">Sorted by onset. Ids in the check tables link here.</p>
${cueList()}
</main></body></html>`;
}

const isMain = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((e) => { console.error(`sound-storyboard failed: ${e.stack}`); process.exitCode = 1; });
