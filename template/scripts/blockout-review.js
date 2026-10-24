// Blockout review set: first, middle and last frame of every shot, overlay on, at 4x, plus phone copies of the middle
// frames, a contact sheet (HTML and a 1500 px PNG) and stills.json. One browser session draws every still.
// Usage: node scripts/blockout-review.js [--round 02] [--outroot <dir>] [--file <html>]
// Writes <outroot>/round-NN/ (outroot defaults to review/): stills/shot-NN-first.png, -mid.png, -mid-phone.png,
// -last.png, contact-sheet.html, contact-sheet.png, stills.json. Exits non-zero if a still lands in the wrong shot.
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { openScene, ROOT } from './lib/browser.mjs';
import { rasterize } from './lib/raster.mjs';
import { renderStills } from './stills.js';

const SCALE = 4;
const SHEET_WIDTH = 1500, MARGIN = 20, GAP = 10;
const DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`, 'g');

const pad2 = (n) => String(n).padStart(2, '0');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const text = (s) => esc(String(s).replace(DASHES, ', ')); // shot data is not ours; keep dashes off the sheet whatever it says
// 1:51.958
const clock = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(3).padStart(6, '0')}`;

// The three review times of a shot. Starts and ends are whole seconds here, so all three sit on the frame grid.
export function shotTimes(shot, fps) {
  return [['first', shot.start], ['mid', (shot.start + shot.end) / 2], ['last', shot.end - 1 / fps]];
}

// How big each still is shown: the largest whole multiple of the internal frame that fits three across the sheet, so
// every internal pixel is the same number of screen pixels (480x270 is 1x, filling it exactly). Only a frame too wide
// for 1x falls back to a fractional size, and the header says which.
export function stillDisplay(res) {
  const room = (SHEET_WIDTH - 2 * MARGIN - 2 * GAP) / (3 * res.w);
  const scale = room >= 1 ? Math.floor(room) : Math.floor(room * 100) / 100;
  return { w: Math.round(res.w * scale), h: Math.round(res.h * scale), scale };
}

export function contactSheetHtml({ round, info, stills }) {
  const { w: STILL_W, h: STILL_H, scale: shown } = stillDisplay(info.res);
  const rows = info.shots.map((s) => {
    const cells = stills.filter((x) => x.shot === s.n).map((x) => `<figure><img src="${esc(x.file)}" width="${STILL_W}" height="${STILL_H}" alt="Shot ${s.n}, ${x.which} frame, ${x.t.toFixed(3)} seconds"><figcaption><b>${x.which}</b> ${clock(x.t)} <span>(${x.t.toFixed(3)} s, frame ${x.frame})</span></figcaption></figure>`).join('');
    return `<section class="row"><div class="meta"><span class="n">${pad2(s.n)}</span><span class="title">${text(s.title)}</span><span class="range">${clock(s.start)} to ${clock(s.end)}, ${(s.end - s.start).toFixed(1)} s</span><span class="lens">${text(s.lens)} mm</span></div><div class="stills">${cells}</div></section>`;
  }).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Blockout round ${text(round)}</title>
<style>
:root { --bg: #0b0f1a; --surface: #121829; --line: #232d47; --fg: #e6ebf7; --dim: #93a0bd; --accent: #ffb46b; color-scheme: dark; }
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--bg); color: var(--fg); }
body { width: ${SHEET_WIDTH}px; padding: 24px ${MARGIN}px 28px; font: 15px/1.4 "DejaVu Sans", "Helvetica Neue", Arial, sans-serif; }
h1 { margin: 0; font-size: 28px; font-weight: 700; }
header p { margin: 6px 0 18px; color: var(--dim); }
.row { padding: 12px 0 14px; border-top: 1px solid var(--line); }
.meta { display: flex; align-items: baseline; gap: 18px; margin-bottom: 8px; }
.meta .n { font: 700 30px/1 "DejaVu Sans Mono", monospace; color: var(--accent); }
.meta .title { font-size: 19px; font-weight: 700; }
.meta .range, .meta .lens { font: 14px/1.4 "DejaVu Sans Mono", monospace; color: var(--dim); }
/* three stills of ${STILL_W} px plus two ${GAP} px gaps, ${3 * STILL_W + 2 * GAP} of the ${SHEET_WIDTH - 2 * MARGIN} px inside the margins: each internal pixel is ${shown} screen px */
.stills { display: grid; grid-template-columns: repeat(3, ${STILL_W}px); gap: ${GAP}px; }
figure { margin: 0; background: var(--surface); outline: 1px solid var(--line); }
img { display: block; width: ${STILL_W}px; height: ${STILL_H}px; image-rendering: pixelated; }
figcaption { padding: 4px 8px 6px; font: 13px/1.4 "DejaVu Sans Mono", monospace; }
figcaption span { color: var(--dim); }
</style>
</head>
<body>
<header>
<h1>Snow, Lamp, Bridge: blockout round ${text(round)}</h1>
<p>First, middle and last frame of each shot, overlay on. ${info.shots.length} shots, ${stills.length} stills, ${info.res.w}x${info.res.h} internal, saved at ${SCALE}x, shown here at ${shown}x. Running time ${info.total} s at ${info.fps} fps.</p>
</header>
${rows}
</body>
</html>
`;
}

export async function blockoutReview({ round = '02', outroot = resolve(ROOT, 'review'), file, log = console.log }) {
  const dir = resolve(outroot, `round-${round}`);
  const t0 = performance.now();
  const scene = await openScene({ file, overlay: true });
  let done;
  try {
    const { info } = scene;
    const items = [];
    for (const s of info.shots) {
      for (const [which, t] of shotTimes(s, info.fps)) {
        items.push({ t, out: resolve(dir, 'stills', `shot-${pad2(s.n)}-${which}.png`), phone: which === 'mid', shot: s, which });
      }
    }
    log(`blockout review round ${round}: ${items.length} stills into ${dir}`);
    const rendered = await renderStills({ items, scale: SCALE, scene, log });
    done = { info, stills: items.map((it, i) => ({
      shot: it.shot.n, title: it.shot.title, lens: it.shot.lens, which: it.which, t: it.t, frame: rendered[i].frame,
      file: relative(dir, it.out), phone: rendered[i].phone && relative(dir, rendered[i].phone), renderedShot: rendered[i].shot,
    })) };
  } finally {
    await scene.close();
  }
  const { info, stills } = done;
  const stillSeconds = (performance.now() - t0) / 1000;

  const html = contactSheetHtml({ round, info, stills });
  writeFileSync(resolve(dir, 'contact-sheet.html'), html);
  await rasterize([{ file: resolve(dir, 'contact-sheet.html'), out: resolve(dir, 'contact-sheet.png'), width: SHEET_WIDTH, fullPage: true }]);

  const wrong = stills.filter((x) => x.renderedShot !== x.shot);
  const report = {
    round, scale: SCALE, overlay: true, fps: info.fps, total: info.total, res: info.res, count: stills.length,
    phoneCount: stills.filter((x) => x.phone).length, stillSeconds: +stillSeconds.toFixed(2),
    contactSheet: { html: 'contact-sheet.html', png: 'contact-sheet.png', width: SHEET_WIDTH, still: stillDisplay(info.res) }, wrongShot: wrong.length, stills,
  };
  writeFileSync(resolve(dir, 'stills.json'), `${JSON.stringify(report, null, 1)}\n`);
  log(`${stills.length} stills in ${stillSeconds.toFixed(1)} s, contact sheet ${resolve(dir, 'contact-sheet.png')}`);
  if (wrong.length) throw new Error(`stills in the wrong shot: ${wrong.map((x) => `shot ${x.shot} ${x.which} at ${x.t} drew shot ${x.renderedShot}`).join('; ')}`);
  return report;
}

async function main() {
  const { values: a } = parseArgs({ options: { round: { type: 'string', default: '02' }, outroot: { type: 'string' }, file: { type: 'string' } }, strict: true });
  if (!/^\d{1,2}$/.test(a.round)) throw new Error(`bad --round ${a.round} (a number such as 02)`);
  mkdirSync(resolve(a.outroot ?? resolve(ROOT, 'review')), { recursive: true });
  await blockoutReview({ round: pad2(Number(a.round)), outroot: a.outroot && resolve(a.outroot), file: a.file && resolve(a.file) });
}

const isMain = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((e) => {
    console.error(`blockout review failed: ${e.message}`);
    process.exitCode = 1;
  });
}
