// Stage 7 deliverables from the built scene, overlay off (ROADMAP 7.2 and 7.3):
// out/stills/shot-NN.png   one full-resolution still per shot (config.out size) at the time in CONFIG.finals.stills,
//                          or the middle of the shot when it has none
// out/thumbnails/<name>.png and .jpg   three 1280x720 candidates: the frame upscaled `scale` times (nearest, so every
//                          pixel stays square), cropped to 1280x720 around (cx, cy), fractions of the frame from the top
//                          left, with CONFIG.finals.lift (a curves spec) applied when set. No text: the crops leave
//                          room for a title. The stills are never graded.
// out/thumbnails/<name>-320.png   each one area-downscaled to 320x180, the size it is judged at, and sheet-320.png
//                          with all three side by side
// Usage: node scripts/finals.js [--only stills|thumbs] [--file <html>]
import { mkdirSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { openScene, ROOT } from './lib/browser.mjs';
import { runFfmpeg } from './lib/ffmpeg.mjs';
import { renderStills } from './stills.js';
import { CONFIG } from '../src/config.js';

export const THUMB = { w: 1280, h: 720, check: 320 };

// the crop's top left corner in upscaled pixels, kept inside the frame
export function cropAt({ cx, cy, scale }, res) {
  const W = res.w * scale, H = res.h * scale;
  if (W < THUMB.w || H < THUMB.h) throw new Error(`scale ${scale} gives ${W}x${H}, smaller than ${THUMB.w}x${THUMB.h}`);
  const clamp = (v, hi) => Math.min(hi, Math.max(0, Math.round(v)));
  return { x: clamp(cx * W - THUMB.w / 2, W - THUMB.w), y: clamp(cy * H - THUMB.h / 2, H - THUMB.h) };
}

export function stillTimes(shots, chosen = CONFIG.finals.stills) {
  return shots.map((s) => ({ n: s.n, t: chosen[s.n] ?? +((s.start + s.end) / 2).toFixed(3) }));
}

async function thumbs(scene, outdir, log) {
  const { res } = scene.info;
  mkdirSync(outdir, { recursive: true });
  const small = [];
  for (const th of CONFIG.finals.thumbs) {
    const f = await scene.frame(th.t);
    if (scene.errors.length) throw new Error(`page error: ${scene.errors.join(' | ')}`);
    const { x, y } = cropAt(th, res);
    const base = resolve(outdir, th.name);
    const input = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${res.w}x${res.h}`, '-i', 'pipe:0'];
    const lift = CONFIG.finals.lift ? `,curves=all='${CONFIG.finals.lift}'` : '';
    const big = `vflip,scale=${res.w * th.scale}:${res.h * th.scale}:flags=neighbor,crop=${THUMB.w}:${THUMB.h}:${x}:${y}${lift}`;
    await runFfmpeg([...input, '-filter_complex', `[0:v]${big},split=3[a][b][c];[c]scale=${THUMB.check}:${(THUMB.check * 9) / 16}:flags=area[s]`,
      '-map', '[a]', '-frames:v', '1', '-pix_fmt', 'rgb24', `${base}.png`,
      '-map', '[b]', '-frames:v', '1', '-q:v', '2', `${base}.jpg`,
      '-map', '[s]', '-frames:v', '1', '-pix_fmt', 'rgb24', `${base}-320.png`], f.rgb);
    small.push(`${base}-320.png`);
    log(`thumb ${th.name}: t ${th.t}, shot ${f.info.shot}, ${th.scale}x, crop at ${x},${y}`);
  }
  const ins = small.flatMap((p) => ['-i', p]);
  await runFfmpeg(['-hide_banner', '-loglevel', 'error', '-y', ...ins, '-filter_complex', `${small.map((_, i) => `[${i}:v]pad=iw+8:ih:0:0:black[p${i}]`).join(';')};${small.map((_, i) => `[p${i}]`).join('')}hstack=inputs=${small.length}`,
    '-frames:v', '1', resolve(outdir, 'sheet-320.png')]);
}

export async function finals({ only, file, log = console.log }) {
  const scene = await openScene({ file, overlay: false });
  try {
    if (only !== 'thumbs') {
      const dir = resolve(ROOT, 'out/stills');
      const items = stillTimes(scene.info.shots).map(({ n, t }) => ({ t, out: resolve(dir, `shot-${String(n).padStart(2, '0')}.png`) }));
      await renderStills({ items, scale: CONFIG.out.w / CONFIG.res.w, scene, log });
      log(`${items.length} stills in ${dir}`);
    }
    if (only !== 'stills') await thumbs(scene, resolve(ROOT, 'out/thumbnails'), log);
  } finally {
    await scene.close();
  }
}

async function main() {
  const { values: a } = parseArgs({ options: { only: { type: 'string' }, file: { type: 'string' } }, strict: true });
  if (a.only && !['stills', 'thumbs'].includes(a.only)) throw new Error(`--only stills or thumbs, not ${a.only}`);
  await finals({ only: a.only, file: a.file && resolve(a.file) });
}

const isMain = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((e) => {
    console.error(`finals failed: ${e.message}`);
    process.exitCode = 1;
  });
}
