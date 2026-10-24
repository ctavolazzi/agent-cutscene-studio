// Verify an exported MP4 against the scene it came from (ROADMAP 5.9). Four checks:
// 1. probe: size for the profile, frame rate, frame count, duration, H.264, yuv420p, BT.709 tags, no audio, faststart
// 2. frame match: frames across every shot, decoded and area-downscaled to the internal resolution (each upscaled
//    block averages back to its pixel), against a fresh renderAt(N / fps) with the overlay off: mean error 2.5 or
//    less and PSNR 36 dB or more on every frame. And the frame is the right one: wherever the next or previous frame
//    differs from it, the decoded frame is closer to its own render than to theirs.
//    (The ROADMAP's first bar was 40 dB. Measured on this film: a decoded frame sits near 38 dB from its render even
//    at crf 10, against about 25 dB from its neighbours. The floor is the 8-bit limited-range YUV 4:2:0 round trip of a
//    dithered image, not the crf, so 36 dB leaves a margin and the identity test is what proves the match.)
// 3. scrub: five positions decoded with a seek (-ss before -i), held to the same bars, so a player can jump in
// 4. timing: 10 s of frames (240 at 24 fps) drawn back to back in the page, reported in ms per frame. This one is
//    information, not a pass or fail: in software WebGL it says nothing about a real GPU.
// Usage: node scripts/verify.js [--file out/film.mp4] [--profile full|4k] [--html dist/index.html]
// Writes <file>.verify.json and exits non-zero when a check fails.
import { spawnSync } from 'node:child_process';
import { realpathSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { openScene, ROOT } from './lib/browser.mjs';
import { ffprobe, profileSize } from './lib/ffmpeg.mjs';
import { DEFAULT_OUT } from './capture.js';

export const BAR = { meanError: 2.5, psnr: 36 };
const IN_709 = 'in_color_matrix=bt709:in_range=tv';

// decode the listed frame numbers (one pass over the file) at w x h, area-averaged, RGB top row first
export function decodeFrames(file, frames, { w, h }) {
  const sel = frames.map((n) => `eq(n\\,${n})`).join('+');
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-vf', `select='${sel}',scale=${w}:${h}:flags=area:${IN_709}`,
    '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`decode ${file}: ${r.stderr}`);
  const size = w * h * 3;
  if (r.stdout.length !== size * frames.length) throw new Error(`decoded ${r.stdout.length / size} frames, asked for ${frames.length}`);
  return frames.map((_, i) => r.stdout.subarray(i * size, (i + 1) * size));
}
// one frame found by seeking to just before its timestamp
export function seekFrame(file, n, fps, { w, h }) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', String((n - 0.25) / fps), '-i', file, '-frames:v', '1',
    '-vf', `scale=${w}:${h}:flags=area:${IN_709}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`seek ${file} to frame ${n}: ${r.stderr}`);
  return r.stdout;
}
export const flipRows = (rgb, w, h) => {
  const o = Buffer.alloc(rgb.length);
  for (let y = 0; y < h; y++) rgb.copy(o, (h - 1 - y) * w * 3, y * w * 3, (y + 1) * w * 3);
  return o;
};
export function compare(a, b) {
  let abs = 0, sq = 0;
  for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; abs += Math.abs(d); sq += d * d; }
  const mse = sq / a.length;
  return { meanError: +(abs / a.length).toFixed(3), psnr: mse === 0 ? Infinity : +(10 * Math.log10((255 * 255) / mse)).toFixed(2) };
}
const passes = (m) => m.meanError <= BAR.meanError && m.psnr >= BAR.psnr;

// frames to match: two in every shot (a quarter and three quarters in), the first and the last
export function matchFrames(shots, fps, total) {
  const n = new Set([0, Math.round(total * fps) - 1]);
  for (const s of shots) for (const f of [0.25, 0.75]) n.add(Math.round((s.start + (s.end - s.start) * f) * fps));
  return [...n].sort((a, b) => a - b);
}

export async function verify({ file, profile, html, log = console.log }) {
  const scene = await openScene({ file: html, overlay: false });
  const report = { file, profile, checks: {}, ok: true };
  const fail = (name, msg) => { report.ok = false; ((report.checks[name] ??= {}).problems ??= []).push(msg); log(`FAIL ${name}: ${msg}`); };
  try {
    const { fps, total, res, shots } = scene.info;
    const nFrames = Math.round(total * fps);

    // 1. probe
    const probe = await ffprobe(file);
    const size = profileSize(profile, res, { res, out: scene.info.out });
    const want = { width: size.w, height: size.h, frames: nFrames, r_frame_rate: `${fps}/1`, codec: 'h264', pix_fmt: 'yuv420p', color_space: 'bt709', color_primaries: 'bt709', color_transfer: 'bt709', color_range: 'tv', audioStreams: 0, videoStreams: 1, moovFirst: true };
    Object.assign(report.checks.probe ??= {}, { probe, want });
    for (const [k, v] of Object.entries(want)) if (probe[k] !== v) fail('probe', `${k} is ${probe[k]}, want ${v}`);
    if (!(Math.abs(probe.duration - total) <= 0.5 / fps)) fail('probe', `duration is ${probe.duration}, want ${total}`);
    log(`probe: ${probe.width}x${probe.height} ${probe.r_frame_rate} ${probe.frames} frames ${probe.duration} s ${probe.codec} ${probe.pix_fmt} ${probe.color_space} audio ${probe.audioStreams} faststart ${probe.moovFirst}`);

    // 2. frame match
    const list = matchFrames(shots, fps, total);
    const decoded = decodeFrames(file, list, res);
    const rows = [];
    const render = async (n) => flipRows((await scene.frame(n / fps)).rgb, res.w, res.h);
    for (let i = 0; i < list.length; i++) {
      const n = list[i], fresh = await render(n);
      const m = { frame: n, t: +(n / fps).toFixed(3), ...compare(decoded[i], fresh) };
      if (!passes(m)) fail('frames', `frame ${m.frame} (t ${m.t}): mean error ${m.meanError}, PSNR ${m.psnr} dB`);
      // identity: closer to frame n than to n - 1 or n + 1, wherever those differ from n by more than the codec loss
      m.neighbours = [];
      for (const k of [n - 1, n + 1].filter((k) => k >= 0 && k < nFrames)) {
        const other = await render(k), apart = compare(other, fresh), toOther = compare(decoded[i], other);
        m.neighbours.push({ frame: k, apart: apart.meanError, decodedTo: toOther.meanError });
        if (apart.psnr < m.psnr && !(m.meanError < toOther.meanError)) fail('frames', `frame ${n} is no closer to its render (${m.meanError}) than to frame ${k}'s (${toOther.meanError})`);
      }
      rows.push(m);
    }
    const worst = rows.reduce((w, m) => (m.meanError > w.meanError ? m : w), rows[0]);
    Object.assign(report.checks.frames ??= {}, { bar: BAR, frames: rows, worst });
    log(`frames: ${rows.length} matched, worst frame ${worst.frame} mean error ${worst.meanError} PSNR ${worst.psnr} dB`);

    // 3. scrub
    const scrub = [];
    for (const f of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      const n = Math.round(nFrames * f);
      const fresh = flipRows((await scene.frame(n / fps)).rgb, res.w, res.h);
      const m = { frame: n, ...compare(seekFrame(file, n, fps, res), fresh) };
      scrub.push(m);
      if (!passes(m)) fail('scrub', `seek to frame ${n}: mean error ${m.meanError}, PSNR ${m.psnr} dB`);
    }
    Object.assign(report.checks.scrub ??= {}, { positions: scrub });
    log(`scrub: ${scrub.map((m) => `${m.frame} (${m.meanError})`).join(', ')}`);

    // 4. timing (information)
    const ms = await scene.page.evaluate(([n, step]) => {
      const out = [];
      for (let i = 0; i < n; i++) { const a = performance.now(); window.renderAt(20 + i * step); out.push(performance.now() - a); }
      return out;
    }, [10 * fps, 1 / fps]);
    const sorted = [...ms].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)], mean = ms.reduce((s, v) => s + v, 0) / ms.length;
    report.checks.timing = { frames: ms.length, meanMs: +mean.toFixed(2), p95Ms: +p95.toFixed(2), budgetMs: +(1000 / fps).toFixed(2), note: 'information only; software WebGL in a headless browser' };
    log(`timing: ${ms.length} frames, mean ${mean.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms (budget ${(1000 / fps).toFixed(1)} ms, information only)`);
    if (scene.errors.length) fail('frames', `page errors: ${scene.errors.join(' | ')}`);
  } finally {
    await scene.close();
  }
  writeFileSync(`${file}.verify.json`, `${JSON.stringify(report, null, 1)}\n`);
  log(report.ok ? `PASS ${file}` : `FAIL ${file}`);
  return report;
}

async function main() {
  const { values: a } = parseArgs({ options: { file: { type: 'string' }, profile: { type: 'string', default: 'full' }, html: { type: 'string' } }, strict: true });
  if (!['full', '4k'].includes(a.profile)) throw new Error(`--profile full or 4k, not ${a.profile}`);
  const file = resolve(a.file ?? resolve(ROOT, DEFAULT_OUT[a.profile]));
  const r = await verify({ file, profile: a.profile, html: a.html && resolve(a.html) });
  if (!r.ok) process.exitCode = 1;
}

const isMain = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((e) => {
    console.error(`verify failed: ${e.message}`);
    process.exitCode = 1;
  });
}
