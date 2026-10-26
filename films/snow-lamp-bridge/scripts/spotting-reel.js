// The spotting reel (SOUND-PLAN 3.16 and 4.3, ROADMAP Sound 1.10): every planned sound as a caption over the finished
// picture, before any sound exists. Made from the published export, so no frame is re-rendered:
// - spotting-reel.mp4: the 1080p picture with its video stream copied bit for bit, the review track as a soft mov_text
//   stream (justified top left, its font sized so that no line wraps in a libass player), and no audio: the export
//   carries the first-pass mix with the score;
// - spotting-reel-phone.mp4: a silent 480x270 copy, scaled down nearest neighbour to the internal pixels, with the HUD's
//   shot label in the top strip, the captions burned in their band below it and the step lane under them; nothing is
//   drawn in the bottom 30 px (checked on every frame before the encode);
// - captions/: review.vtt (the canonical track), review.srt, review.ass (the burn), review-soft.ass (the soft copy's
//   track as encoded), sdh.vtt and sdh.srt (Sound 6).
// Each MP4 gets a sidecar <file>.json with its ffprobe facts and the caption counts. No clocks, and paths relative to
// the film, so both MP4s and both sidecars are byte identical across runs.
// Usage: node scripts/spotting-reel.js [--outdir review/round-04] [--source out/snowy-bridge.mp4]
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { ROOT } from './lib/browser.mjs';
import { BT709_TAGS, encodeArgs, ffprobe } from './lib/ffmpeg.mjs';
import { FRAME, SAFE, burnFilter, fontFile, movTextEntries, parseVtt, probeSubtitles, reviewTrack, sdhSrt, sdhTrack, sdhVtt, subtitleStyle, toAss, toSrt, toVtt, topJustify, writeSoftAss } from './lib/captions.js';
import { videoHash } from './mux.js';
import { CONFIG } from '../src/config.js';
import { T_TOTAL } from '../src/world.js';

export const DEFAULT_OUTDIR = 'review/round-04';
export const DEFAULT_SOURCE = 'out/snowy-bridge.mp4';
export const NAMES = { soft: 'spotting-reel.mp4', phone: 'spotting-reel-phone.mp4', captions: 'captions' };
// the scale that takes the export back to its internal pixels: each 4x4 block to one pixel
export const SCALE = `scale=${FRAME.w}:${FRAME.h}:flags=neighbor`;
const BAND_ROWS = `crop=${FRAME.w}:${SAFE}:0:${FRAME.h - SAFE}`; // the bottom SAFE rows
const fps = CONFIG.fps;
const rel = (p) => relative(ROOT, p) || '.';
const partial = (p) => p.replace(/\.mp4$/, '.partial.mp4');
const span = (from, seconds) => [...(from ? ['-ss', String(from)] : []), ...(seconds ? ['-t', String(seconds)] : [])];

function ff(args, what) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(`${what}: ffmpeg failed: ${r.stderr.trim()}`);
  return r.stdout;
}
// the preview profile's own codec settings (scripts/lib/ffmpeg.mjs), for the 480x270 copy
export const previewCodec = () => { const a = encodeArgs('preview', FRAME); const i = a.indexOf('-c:v'); return a.slice(i, a.indexOf('-pix_fmt', i)); };

// The caption files, from the cues: the review track (VTT, SRT, and the burn read back from the VTT) and the SDH track
export function writeCaptions(dir) {
  mkdirSync(dir, { recursive: true });
  const track = reviewTrack(), sdh = sdhTrack();
  const files = { vtt: resolve(dir, 'review.vtt'), srt: resolve(dir, 'review.srt'), ass: resolve(dir, 'review.ass'), sdhVtt: resolve(dir, 'sdh.vtt'), sdhSrt: resolve(dir, 'sdh.srt') };
  writeFileSync(files.vtt, toVtt(track));
  writeFileSync(files.srt, toSrt(track));
  writeFileSync(files.sdhVtt, sdhVtt(sdh));
  writeFileSync(files.sdhSrt, sdhSrt(sdh));
  // the burn reads the canonical file back, as capture.js --burn-captions does
  writeFileSync(files.ass, toAss(parseVtt(readFileSync(files.vtt, 'utf8')), { from: 0, to: T_TOTAL, strip: true }));
  return { files, track, sdh };
}

// The soft copy: the source's video stream copied, the VTT as a mov_text stream (ffmpeg's own conversion with its font
// sized to the picture, written to softAss, or to a temp file beside the partial one) justified top left, no audio.
// Refuses to keep a file whose video stream is not the source's bytes, that has audio, or whose captions are not one
// stream spanning the picture at the fitted size.
export async function softCopy({ source, vtt, out, softAss: keep = null }) {
  const tmp = partial(out), softAss = keep ?? `${tmp}.soft.ass`;
  rmSync(tmp, { force: true });
  const src = await ffprobe(source);
  const soft = writeSoftAss(vtt, softAss, { w: src.width, h: src.height });
  const args = ['-i', source, '-i', softAss, '-map', '0:v:0', '-map', '1:s:0', '-c:v', 'copy', '-c:s', 'mov_text', '-an',
    '-metadata:s:s:0', 'language=eng', '-metadata:s:s:0', 'handler_name=Review captions', '-movflags', '+faststart'];
  ff([...args, tmp], 'soft copy');
  const probe = await ffprobe(tmp), subtitles = probeSubtitles(tmp);
  const md5 = { source: videoHash(source), copy: videoHash(tmp) };
  const problems = ['width', 'height', 'frames', 'r_frame_rate', 'codec', 'pix_fmt', 'color_space'].filter((k) => probe[k] !== src[k]).map((k) => `${k} is ${probe[k]}, want ${src[k]}`);
  if (probe.audioStreams !== 0) problems.push(`${probe.audioStreams} audio streams, want none`);
  if (md5.copy !== md5.source) problems.push('the video stream is not the source\'s bytes');
  // an MP4 carries text subtitles only as mov_text (this ffmpeg refuses webvtt there), so one stream is the check
  if (subtitles.streams !== 1) problems.push(`${subtitles.streams} subtitle streams, want one`);
  else if (!(Math.abs(subtitles.duration - src.frames / fps) <= 1 / fps)) problems.push(`captions last ${subtitles.duration} s, want ${src.frames / fps}`);
  let justification = null, style = null;
  if (subtitles.streams === 1) {
    justification = topJustify(tmp);
    style = subtitleStyle(tmp);
    if (style.size !== soft.size) problems.push(`the soft font size is ${style.size}, want ${soft.size}`);
  }
  if (problems.length) throw new Error(`soft copy: ${problems.join('; ')} (kept ${tmp})`);
  renameSync(tmp, out);
  if (!keep) rmSync(softAss);
  return { args: ['ffmpeg', ...args.map((a) => (a === source || a === softAss ? rel(a) : a)), rel(out)], md5, justification, soft, style, entries: movTextEntries(out), probe: { ...probe, file: rel(out) }, subtitles };
}

// The bottom SAFE rows of every frame before the encode, as the scale alone leaves them and as the burn leaves them,
// each stream hashed whole: equal digests mean nothing was drawn there on any frame
export function bottomBand({ source, ass, font = fontFile(), from = 0, seconds = null, scratch }) {
  const files = [`${scratch}.scaled.md5`, `${scratch}.burned.md5`];
  ff([...span(from, seconds), '-i', source, '-filter_complex', `[0:v]${SCALE},split[a][b];[a]${BAND_ROWS}[s];[b]${burnFilter(ass, font)},${BAND_ROWS}[c]`,
    '-map', '[s]', '-f', 'md5', files[0], '-map', '[c]', '-f', 'md5', files[1]], 'bottom band');
  const [scaled, burned] = files.map((f) => { const d = readFileSync(f, 'utf8').trim(); rmSync(f); return d; });
  return { rows: [FRAME.h - SAFE, FRAME.h], scaled, burned, equal: scaled === burned };
}

// The phone copy: the source scaled to the internal pixels with an ASS burned in (its times relative to `from`),
// silent, the preview profile's codec. Refuses to keep a file with anything drawn in the bottom band.
export async function phoneCopy({ source, ass, out, font = fontFile(), from = 0, seconds = null }) {
  const tmp = partial(out);
  rmSync(tmp, { force: true });
  const vf = `${SCALE},${burnFilter(ass, font)}`;
  const args = [...span(from, seconds), '-i', source, '-map', '0:v:0', '-vf', vf, ...previewCodec(), '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', ...BT709_TAGS];
  ff([...args, tmp], 'phone copy');
  const band = bottomBand({ source, ass, font, from, seconds, scratch: tmp });
  const src = await ffprobe(source), probe = await ffprobe(tmp);
  const frames = seconds ? Math.round(seconds * fps) : src.frames;
  const want = { width: FRAME.w, height: FRAME.h, frames, r_frame_rate: `${fps}/1`, codec: 'h264', pix_fmt: 'yuv420p', color_space: 'bt709', color_primaries: 'bt709', color_transfer: 'bt709', color_range: 'tv', audioStreams: 0, moovFirst: true };
  const problems = Object.entries(want).filter(([k, v]) => probe[k] !== v).map(([k, v]) => `${k} is ${probe[k]}, want ${v}`);
  if (!band.equal) problems.push(`something is drawn in the bottom ${SAFE} rows (${band.burned} against ${band.scaled})`);
  if (problems.length) throw new Error(`phone copy: ${problems.join('; ')} (kept ${tmp})`);
  renameSync(tmp, out);
  return { args: ['ffmpeg', ...args.map((a) => (a === source ? rel(a) : a === vf ? `${SCALE},ass=${rel(ass)}` : a)), rel(out)], band, probe: { ...probe, file: rel(out) } };
}

export async function spottingReel({ outdir = resolve(ROOT, DEFAULT_OUTDIR), source = resolve(ROOT, DEFAULT_SOURCE), log = console.log } = {}) {
  if (!existsSync(source)) throw new Error(`no published export at ${source}`);
  const written = writeCaptions(resolve(outdir, NAMES.captions)), { track, sdh } = written;
  const files = { ...written.files, softAss: resolve(outdir, NAMES.captions, 'review-soft.ass') }; // softCopy writes it
  const counts = { ...track.stats, sdh: sdh.length };
  log(`captions: ${counts.captions} review captions of ${counts.cues} cues in ${counts.slices} moments, ${counts.ticks} step ticks, at most ${counts.maxLines} lines; ${counts.sdh} SDH captions`);
  const side = (file, o) => writeFileSync(`${file}.json`, `${JSON.stringify({ file: rel(file), source: rel(source), ...o, counts }, null, 1)}\n`);

  const soft = resolve(outdir, NAMES.soft), s = await softCopy({ source, vtt: files.vtt, out: soft, softAss: files.softAss });
  side(soft, { captions: rel(files.vtt), encoded: rel(files.softAss), ffmpeg: s.args, videoMd5: s.md5, movTextJustification: s.justification, softFont: s.soft, libassStyle: s.style, movText: s.entries, ffprobe: s.probe, subtitles: s.subtitles });
  log(`soft: ${rel(soft)}: video copied (${s.md5.copy}), mov_text ${s.subtitles.duration} s, justification ${s.justification.was} to ${s.justification.now}, ${s.soft.font} ${s.soft.size} (from ${s.soft.from}; widest line ${s.soft.widestEm} em of ${s.soft.wrapPx} px)`);

  const phone = resolve(outdir, NAMES.phone), p = await phoneCopy({ source, ass: files.ass, out: phone });
  side(phone, { burned: rel(files.ass), ffmpeg: p.args, bottomBand: p.band, ffprobe: p.probe });
  log(`phone: ${rel(phone)}: ${p.probe.width}x${p.probe.height} ${p.probe.frames} frames, the bottom ${SAFE} rows untouched on every frame (${p.band.burned})`);
  return { soft, phone, files, track, sdh, band: p.band };
}

async function main() {
  const { values: a } = parseArgs({ options: { outdir: { type: 'string', default: DEFAULT_OUTDIR }, source: { type: 'string', default: DEFAULT_SOURCE } }, strict: true });
  await spottingReel({ outdir: resolve(a.outdir), source: resolve(a.source) });
}

const isMain = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((e) => {
    console.error(`spotting reel failed: ${e.message}`);
    process.exitCode = 1;
  });
}
