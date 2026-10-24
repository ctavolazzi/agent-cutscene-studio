// Render stills of the built scene (dist/index.html) at chosen times, one browser for all of them.
// Usage: node scripts/stills.js --times 1,2.5,90 --outdir <dir> [--scale 4] [--overlay 0|1] [--phone] [--file <html>]
// Each still is <outdir>/t<seconds>.png (t002.500.png), upscaled nearest neighbour; --phone adds a 384x216 copy.
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { openScene } from './lib/browser.mjs';
import { rgbToPng } from './lib/ffmpeg.mjs';
import { CONFIG } from '../src/config.js';

const IN_FLIGHT = 4; // PNG encodes run while the page draws the next frame

// items: [{ t, out, phone? }]. Pass `scene` (from openScene) to reuse an open browser; it is then left open and
// `overlay` and `file` are ignored. Throws on any page error.
export async function renderStills({ items, scale = 4, overlay = CONFIG.overlay, phone = false, file, scene: given, log = () => {} }) {
  checkDistinct(items, phone);
  const scene = given ?? (await openScene({ file, overlay }));
  const pending = [];
  try {
    const { res, fps, total } = scene.info;
    const done = [];
    for (const it of items) {
      if (!Number.isFinite(it.t) || it.t < 0 || it.t > total) throw new Error(`time ${it.t} is outside 0 to ${total}`);
      const f = await scene.frame(it.t);
      if (scene.errors.length) throw new Error(`page error: ${scene.errors.join(' | ')}`);
      const rec = { t: it.t, frame: Math.round(it.t * fps), out: it.out, phone: null, shot: f.info.shot, title: f.info.title, lens: f.info.lens };
      done.push(rec);
      const p = rgbToPng(f.rgb, res, it.out, { scale, phone: it.phone ?? phone }).then((r) => { rec.phone = r.phone; log(`still t ${it.t.toFixed(3)}  shot ${rec.shot}  ${r.out}`); });
      p.catch(() => {}); // a failure is rethrown where it is awaited; this only stops an early one counting as unhandled
      pending.push(p);
      if (pending.length >= IN_FLIGHT) await pending.shift();
    }
    await Promise.all(pending.splice(0));
    if (scene.errors.length) throw new Error(`page error: ${scene.errors.join(' | ')}`);
    return done;
  } finally {
    await Promise.allSettled(pending);
    if (!given) await scene.close();
  }
}

// Two items writing one file would silently keep only the last, while the count still reported both
function checkDistinct(items, phone) {
  const seen = new Map();
  for (const it of items) {
    const outs = [resolve(it.out)];
    if (it.phone ?? phone) outs.push(outs[0].replace(/\.png$/, '-phone.png'));
    for (const o of outs) {
      if (seen.has(o)) throw new Error(`two stills would write ${o} (times ${seen.get(o)} and ${it.t}); give each its own file`);
      seen.set(o, it.t);
    }
  }
}

export const stillName = (t) => `t${t.toFixed(3).padStart(7, '0')}.png`;

async function main() {
  const { values: a } = parseArgs({
    options: {
      times: { type: 'string' }, outdir: { type: 'string' }, scale: { type: 'string', default: '4' },
      overlay: { type: 'string', default: CONFIG.overlay ? '1' : '0' }, phone: { type: 'boolean', default: false }, file: { type: 'string' },
    },
    strict: true,
  });
  if (!a.times || !a.outdir) throw new Error('usage: node scripts/stills.js --times 1,2.5,90 --outdir <dir> [--scale 4] [--overlay 0|1] [--phone] [--file <html>]');
  const times = a.times.split(',').map((s) => Number(s.trim()));
  if (times.some((t) => !Number.isFinite(t))) throw new Error(`bad --times ${a.times}`);
  const scale = Number(a.scale);
  if (!Number.isInteger(scale) || scale < 1) throw new Error(`bad --scale ${a.scale}`);
  if (a.overlay !== '0' && a.overlay !== '1') throw new Error(`bad --overlay ${a.overlay} (use 0 or 1)`);
  const outdir = resolve(a.outdir);
  const items = times.map((t) => ({ t, out: resolve(outdir, stillName(t)) }));
  const t0 = performance.now();
  const done = await renderStills({ items, scale, overlay: a.overlay === '1', phone: a.phone, file: a.file && resolve(a.file), log: console.log });
  console.log(`${done.length} stills in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
}

const isMain = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((e) => {
    console.error(`stills failed: ${e.message}`);
    process.exitCode = 1;
  });
}
