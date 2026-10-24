// Capture the built scene (dist/index.html) to H.264: every frame drawn by renderAt(i / fps), streamed into ffmpeg.
// Usage: node scripts/capture.js --profile preview|full|4k [--from 0] [--to 112] [--out <path>] [--overlay 0|1] [--file <html>]
//        [--audio out/sound.wav]
// Frames run from round(from * fps) to round(to * fps) - 1. The overlay defaults on for preview and off for full and 4k.
// --audio muxes the soundtrack (scripts/sound.js writes it) as AAC, trimmed to exactly the captured frames.
// Encodes to <name>.partial.<ext>, probes that, and only renames it to <out> (with a sidecar <out>.json) when the probe
// matches the request, so a failed run never leaves a file at <out>. A probe mismatch keeps the partial file and its
// sidecar for diagnosis; any other failure removes the partial file.
// Exits non-zero on any ffmpeg error, page error, or a probe that does not match what was asked for.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { openScene, ROOT } from './lib/browser.mjs';
import { AUDIO, encodeArgs, ffprobe, profileSize, PROFILES } from './lib/ffmpeg.mjs';
import { CONFIG } from '../src/config.js';

export const DEFAULT_OUT = { preview: 'out/preview.mp4', full: 'out/snowy-bridge.mp4', '4k': 'out/snowy-bridge-4k.mp4' };
const PROGRESS_EVERY = 48;

const partialPath = (p) => { const e = extname(p); return `${p.slice(0, p.length - e.length)}.partial${e}`; };

export async function capture({ profile, from = 0, to, out, overlay, file, audio = null, log = console.log }) {
  if (!PROFILES.includes(profile)) throw new Error(`unknown profile ${profile} (use ${PROFILES.join(', ')})`);
  if (audio && !existsSync(audio)) throw new Error(`no soundtrack at ${audio} (run node scripts/sound.js)`);
  overlay ??= profile === 'preview' ? CONFIG.overlay : false;
  const outPath = resolve(out ?? resolve(ROOT, DEFAULT_OUT[profile]));
  const tmpPath = partialPath(outPath);
  const tLoad = performance.now();
  const scene = await openScene({ file, overlay });
  const loadSeconds = (performance.now() - tLoad) / 1000;
  let ff = null, keepPartial = false;
  try {
    const { fps, total, res } = scene.info;
    to ??= total;
    if (!(from >= 0 && to > from && to <= total)) throw new Error(`need 0 <= from < to <= ${total}, got from ${from} to ${to}`);
    const i0 = Math.round(from * fps), i1 = Math.round(to * fps), n = i1 - i0;
    if (n <= 0) throw new Error(`no frames between ${from} and ${to}`);
    const size = profileSize(profile, res, { res: scene.info.res, out: scene.info.out });
    const sound = audio ? { file: audio, from: i0 / fps, to: i1 / fps } : null;
    const args = encodeArgs(profile, res, { fps, res: scene.info.res, out: scene.info.out, output: tmpPath, audio: sound });
    const frameBytes = res.w * res.h * 3;
    mkdirSync(dirname(outPath), { recursive: true });
    for (const p of [tmpPath, `${tmpPath}.json`]) rmSync(p, { force: true }); // leftovers of an earlier failed run
    log(`capture ${profile}: frames ${i0} to ${i1 - 1} (${n}), ${res.w}x${res.h} to ${size.w}x${size.h}, overlay ${overlay ? 'on' : 'off'}, sound ${audio ?? 'none'}, ${outPath}`);

    ff = spawn('ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'] });
    let ffErr = '', stdinErr = null;
    ff.stderr.on('data', (d) => { ffErr += d; });
    ff.stdin.on('error', (e) => { stdinErr = e; });
    const exited = new Promise((r) => {
      ff.on('error', (e) => r({ code: null, error: e }));
      ff.on('close', (code, signal) => r({ code, signal }));
    });
    const ffFailure = async () => {
      const x = await exited;
      return new Error(`ffmpeg failed (exit ${x.code ?? x.signal ?? x.error?.message}): ${ffErr.trim() || stdinErr?.message || 'no output'}`);
    };
    // backpressure: wait for the pipe to drain before the next frame, but never wait on a dead ffmpeg
    const write = async (buf) => {
      if (stdinErr || ff.exitCode !== null || ff.signalCode !== null) throw await ffFailure();
      if (!ff.stdin.write(buf)) {
        const r = await Promise.race([once(ff.stdin, 'drain').then(() => 'drain', () => 'error'), exited.then(() => 'exit')]);
        if (r !== 'drain') throw await ffFailure();
      }
    };
    const pageCheck = () => { if (scene.errors.length) throw new Error(`page error: ${scene.errors.join(' | ')}`); };
    // ask the page for the next frame while this one is written; page.evaluate calls run one at a time anyway
    const grab = (i) => { const p = scene.frame(i / fps); p.catch(() => {}); return p; };

    const tStart = performance.now();
    let next = grab(i0);
    for (let i = i0; i < i1; i++) {
      const f = await next;
      if (i + 1 < i1) next = grab(i + 1);
      pageCheck();
      if (f.rgb.length !== frameBytes) throw new Error(`frame ${i} is ${f.rgb.length} bytes, want ${frameBytes}`);
      await write(f.rgb);
      const k = i - i0 + 1;
      if (k % PROGRESS_EVERY === 0 || k === n) {
        const s = (performance.now() - tStart) / 1000;
        log(`frame ${k}/${n}  t ${(i / fps).toFixed(3)}  shot ${f.info.shot}  ${s.toFixed(1)} s  ${((s * 1000) / k).toFixed(1)} ms/frame  eta ${((s / k) * (n - k)).toFixed(0)} s`);
      }
    }
    ff.stdin.end();
    const x = await exited;
    if (x.code !== 0) throw await ffFailure();
    pageCheck();
    const seconds = (performance.now() - tStart) / 1000;

    // probe the partial file: the final path only ever holds a file that passed
    const probe = await ffprobe(tmpPath);
    const want = { width: size.w, height: size.h, frames: n, r_frame_rate: `${fps}/1`, codec: 'h264', pix_fmt: 'yuv420p', color_space: 'bt709', color_primaries: 'bt709', color_transfer: 'bt709', color_range: 'tv', audioStreams: audio ? 1 : 0, moovFirst: true };
    if (audio) Object.assign(want, { audioCodec: AUDIO.codec, audioRate: AUDIO.sampleRate, audioChannels: AUDIO.channels });
    const problems = Object.entries(want).filter(([key, v]) => probe[key] !== v).map(([key, v]) => `${key} is ${probe[key]}, want ${v}`);
    // the container's duration is the longer stream's; AAC ends on a 1024-sample packet, so allow it one frame
    if (Math.abs(probe.duration - n / fps) > (audio ? 1 : 0.5) / fps) problems.push(`duration is ${probe.duration}, want ${n / fps}`);
    if (audio && !(Math.abs(probe.audioDuration - n / fps) <= 1 / fps)) problems.push(`audio duration is ${probe.audioDuration}, want ${n / fps}`);
    const ok = problems.length === 0;
    const file = ok ? outPath : tmpPath;
    if (ok) renameSync(tmpPath, outPath);
    else keepPartial = true;
    probe.file = file;
    const msPerFrame = (seconds * 1000) / n;
    const sidecar = {
      file, profile, from, to, overlay, fps, firstFrame: i0, lastFrame: i1 - 1, frames: n,
      res: scene.info.res, size, seconds: +seconds.toFixed(3), loadSeconds: +loadSeconds.toFixed(3), msPerFrame: +msPerFrame.toFixed(2),
      ffmpeg: ['ffmpeg', ...args.slice(0, -1), file], ffprobe: probe, problems,
    };
    writeFileSync(`${file}.json`, `${JSON.stringify(sidecar, null, 1)}\n`);
    log(`done: ${n} frames in ${seconds.toFixed(1)} s, ${msPerFrame.toFixed(1)} ms/frame (load ${loadSeconds.toFixed(1)} s)`);
    log(`ffprobe: ${probe.width}x${probe.height} ${probe.r_frame_rate} ${probe.frames} frames ${probe.duration} s ${probe.codec} ${probe.pix_fmt} ${probe.color_space}/${probe.color_primaries}/${probe.color_transfer}/${probe.color_range} audio ${probe.audioStreams}${probe.audioStreams ? ` (${probe.audioCodec} ${probe.audioRate} Hz ${probe.audioChannels} ch ${probe.audioDuration} s)` : ''} faststart ${probe.moovFirst}`);
    if (!ok) throw new Error(`output does not match the request: ${problems.join('; ')} (kept ${tmpPath} and its .json for diagnosis)`);
    return sidecar;
  } catch (e) {
    if (ff && ff.exitCode === null && ff.signalCode === null) ff.kill('SIGKILL');
    if (!keepPartial) rmSync(tmpPath, { force: true });
    throw e;
  } finally {
    await scene.close();
  }
}

async function main() {
  const { values: a } = parseArgs({
    options: { profile: { type: 'string' }, from: { type: 'string', default: '0' }, to: { type: 'string' }, out: { type: 'string' }, overlay: { type: 'string' }, file: { type: 'string' }, audio: { type: 'string' } },
    strict: true,
  });
  if (!a.profile) throw new Error('usage: node scripts/capture.js --profile preview|full|4k [--from 0] [--to 112] [--out <path>] [--overlay 0|1] [--file <html>] [--audio <wav>]');
  const from = Number(a.from), to = a.to === undefined ? undefined : Number(a.to);
  if (!Number.isFinite(from) || (to !== undefined && !Number.isFinite(to))) throw new Error(`bad --from ${a.from} or --to ${a.to}`);
  if (a.overlay !== undefined && a.overlay !== '0' && a.overlay !== '1') throw new Error(`bad --overlay ${a.overlay} (use 0 or 1)`);
  await capture({
    profile: a.profile, from, to, out: a.out, overlay: a.overlay === undefined ? undefined : a.overlay === '1', file: a.file && resolve(a.file),
    audio: a.audio && resolve(a.audio),
  });
}

const isMain = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((e) => {
    console.error(`capture failed: ${e.message}`);
    process.exitCode = 1;
  });
}
