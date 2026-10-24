// Put the soundtrack into an exported MP4 without drawing a frame: the video stream is copied bit for bit, the WAV is
// encoded as AAC (the same settings as capture.js --audio) and trimmed to the frames the MP4 holds (read from its
// capture sidecar, <file>.json; the whole film when there is none). For a new mix of a finished film: render the
// sound, mux it into each export, verify.
// Usage: node scripts/mux.js --file out/snowy-bridge.mp4 [--audio out/sound.wav]
// Writes <name>.partial.mp4, probes it (the same frames, size and codec as before, one AAC stream as long as the
// picture) and only then replaces the file; the sidecar gets a `mux` record. Exits non-zero on any failure.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { ROOT } from './lib/browser.mjs';
import { AUDIO, ffprobe } from './lib/ffmpeg.mjs';
import { CONFIG } from '../src/config.js';

// the video stream's bytes, hashed by ffmpeg: equal before and after means the picture was not touched
export function videoHash(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-map', '0:v:0', '-c', 'copy', '-f', 'md5', '-'], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`hash ${file}: ${r.stderr}`);
  return r.stdout.trim();
}

export async function mux({ file, audio = resolve(ROOT, 'out/sound.wav'), log = console.log }) {
  if (!existsSync(file)) throw new Error(`no video at ${file}`);
  if (!existsSync(audio)) throw new Error(`no soundtrack at ${audio} (run node scripts/sound.js)`);
  const sidecarPath = `${file}.json`;
  const sidecar = existsSync(sidecarPath) ? JSON.parse(readFileSync(sidecarPath, 'utf8')) : null;
  const before = await ffprobe(file);
  const fps = sidecar?.fps ?? CONFIG.fps;
  const from = sidecar ? sidecar.firstFrame / fps : 0;
  const to = sidecar ? (sidecar.lastFrame + 1) / fps : before.frames / fps;
  const e = extname(file), tmp = `${file.slice(0, file.length - e.length)}.partial${e}`;
  rmSync(tmp, { force: true });
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-ss', String(from), '-to', String(to), '-i', audio,
    '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', AUDIO.codec, '-b:a', AUDIO.bitrate, '-ar', String(AUDIO.sampleRate),
    '-ac', String(AUDIO.channels), '-movflags', '+faststart', tmp];
  const r = spawnSync('ffmpeg', args, { encoding: 'utf8' });
  if (r.status !== 0) { rmSync(tmp, { force: true }); throw new Error(`ffmpeg failed: ${r.stderr.trim()}`); }
  const p = await ffprobe(tmp);
  const n = before.frames;
  const want = { width: before.width, height: before.height, frames: n, r_frame_rate: before.r_frame_rate, codec: before.codec, pix_fmt: before.pix_fmt, color_space: before.color_space, audioStreams: 1, audioCodec: AUDIO.codec, audioRate: AUDIO.sampleRate, audioChannels: AUDIO.channels, moovFirst: true };
  const problems = Object.entries(want).filter(([k, v]) => p[k] !== v).map(([k, v]) => `${k} is ${p[k]}, want ${v}`);
  if (!(Math.abs(p.audioDuration - n / fps) <= 1 / fps)) problems.push(`audio duration is ${p.audioDuration}, want ${n / fps}`);
  const hashes = { before: videoHash(file), after: videoHash(tmp) };
  if (hashes.before !== hashes.after) problems.push('the video stream changed');
  if (problems.length) throw new Error(`mux output does not match: ${problems.join('; ')} (kept ${tmp})`);
  renameSync(tmp, file);
  if (sidecar) {
    sidecar.mux = { audio, from, to, ffmpeg: ['ffmpeg', ...args.slice(0, -1), file], videoMd5: hashes.after, ffprobe: { ...p, file } };
    writeFileSync(sidecarPath, `${JSON.stringify(sidecar, null, 1)}\n`);
  }
  log(`mux: ${file}: video copied (${hashes.after}), ${p.audioCodec} ${p.audioRate} Hz ${p.audioChannels} ch ${p.audioDuration} s from ${audio} (${from} to ${to} s)`);
  return { file, from, to, probe: p };
}

async function main() {
  const { values: a } = parseArgs({ options: { file: { type: 'string' }, audio: { type: 'string' } }, strict: true });
  if (!a.file) throw new Error('usage: node scripts/mux.js --file <mp4> [--audio out/sound.wav]');
  await mux({ file: resolve(a.file), audio: a.audio ? resolve(a.audio) : undefined });
}

const isMain = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((e) => {
    console.error(`mux failed: ${e.message}`);
    process.exitCode = 1;
  });
}
