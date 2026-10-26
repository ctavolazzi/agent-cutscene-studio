// Sound 2.8: the checks on the blockout preview (ROADMAP Sound 2.8, SOUND-PLAN 4.5). The preview itself is one capture:
//   node scripts/sound.js --out out/round-05/blockout.wav
//   node scripts/capture.js --profile preview --audio out/round-05/blockout.wav \
//     --captions review/round-04/captions/review.vtt --burn-captions --out review/round-05/preview.mp4
// and this script checks what that capture made, then writes review/round-NN/preview-check.json:
//   streams   ffprobe: one video, one audio and one subtitle stream, each the film's length (to a frame)
//   lag       the preview's audio against the WAV it was muxed from, in windows round the loudest moments: at most
//             2 samples (the bar of ROADMAP 2.8), with the correlation there
//   bottom    nothing drawn in the bottom SAFE rows (30 at 480x270), in windows round the densest captions: exactly,
//             the burn filter the capture uses drawn over the same frames captured without captions, before any encode,
//             leaves the bottom rows' bytes as they were (and changes the caption band's: the control); and, encoded,
//             the preview's bottom rows differ from the plain capture's by no more than the encoder's spread, measured
//             in the same frames' middle rows where nothing is drawn either
//   loudness  integrated loudness of the preview's audio per shot, and the stems the round ships
// Usage: node scripts/sound-preview.js [--round 05] [--wav out/round-05/blockout.wav] [--no-capture]
//   --no-capture skips the plain captures of the bottom-band windows and reuses the ones already under out/round-NN/.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { ROOT } from './lib/browser.mjs';
import { alignment, decodeAudio, ffprobe } from './lib/ffmpeg.mjs';
import { BAND, FRAME, LANE, SAFE, burnFilter, fontFile, parseVtt, probeSubtitles, toAss } from './lib/captions.js';
import { capture } from './capture.js';
import { integratedLufs } from '../src/audio/loudness.js';
import { SHOTS } from '../src/shots.js';
import { FPS, T_TOTAL } from '../src/world.js';

// The bars. lagSamples is ROADMAP 2.8's; correlation a starting value (the preview's AAC, scripts/lib/ffmpeg.mjs AUDIO,
// 320 kbps, against its own WAV). In the bottom band the burn must leave the bytes exactly as they were; encoded, the
// difference there must stay within what the encoder spreads where nothing is drawn: no pixel further off than the
// middle rows' worst, and a mean at most bottomMeanRatio times theirs (a starting value: measured round 05, the middle
// rows up to 45 and 76 levels with means 1.34 and 1.88, the bottom rows 12 and 30 with means 1.27 and 1.49; a caption
// drawn there would add its strokes, a hundred levels or more over a few rows)
export const BARS = Object.freeze({ lagSamples: 2, correlation: 0.99, bottomMeanRatio: 2 });
// The windows: the loudest moments for the lag (the car's arrival, the doors, the lighter), the densest captions for the
// bottom band (SOUND-PLAN 3.16: 31 to 37 s is the dense stretch), each two seconds, every edge on a frame
export const LAG_WINDOWS = Object.freeze([[19, 21], [31, 33], [79, 81]]);
export const BAND_WINDOWS = Object.freeze([[31, 33], [79, 81]]);

const rel = (p) => relative(ROOT, p);
const r = (x, d = 3) => (x === null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);

// Every frame of a video in [t0, t1) as rgb24 rows, the frames concatenated: { w, h, n, data }
export function decodeFrames(file, t0, t1, { w = FRAME.w, h = FRAME.h } = {}) {
  const a = ['-hide_banner', '-loglevel', 'error', '-ss', String(t0), '-t', String(t1 - t0), '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'];
  const p = spawnSync('ffmpeg', a, { maxBuffer: 1 << 30 });
  if (p.status !== 0) throw new Error(`decode frames of ${file}: ${p.stderr}`);
  return { w, h, n: p.stdout.length / (w * h * 3), data: p.stdout };
}

// The largest per-channel difference between two decoded runs of frames, over rows [y0, y1), and the frame and row where
export function largestDiff(a, b, y0, y1) {
  if (a.w !== b.w || a.h !== b.h || a.n !== b.n) throw new Error(`frames differ in shape: ${a.w}x${a.h}x${a.n} against ${b.w}x${b.h}x${b.n}`);
  let most = 0, at = null;
  const row = a.w * 3, frame = row * a.h;
  for (let f = 0; f < a.n; f++) for (let y = y0; y < y1; y++) {
    const o = f * frame + y * row;
    for (let k = 0; k < row; k++) { const d = Math.abs(a.data[o + k] - b.data[o + k]); if (d > most) { most = d; at = { frame: f, y }; } }
  }
  return { levels: most, at };
}

// The mean per-channel difference between two decoded runs of frames over rows [y0, y1)
export function meanDiff(a, b, y0, y1) {
  let s = 0, n = 0;
  const row = a.w * 3, frame = row * a.h;
  for (let f = 0; f < a.n; f++) for (let y = y0; y < y1; y++) { const o = f * frame + y * row; for (let k = 0; k < row; k++) { s += Math.abs(a.data[o + k] - b.data[o + k]); n++; } }
  return s / (n || 1);
}
// The middle rows: two macroblock rows clear of the step lane down to the bottom band, where nothing is drawn either
export const MIDDLE = Object.freeze([Math.ceil(LANE.bottom / 16) * 16 + 16, FRAME.h - SAFE]);

// The encoded judgment of one window: the bottom SAFE rows of the captioned preview against the plain capture differ
// no more than the middle rows do (both undrawn; the encoder spreads what the captions change into its rate control):
// no pixel further off than the middle's worst, a mean within bottomMeanRatio of theirs; while the caption band (from
// the HUD strip's foot to the step lane's) changes as captions do, its mean over that ratio of the middle's (the control)
export function bandVerdict(captioned, plain, bars = BARS) {
  const rows = (y0, y1) => ({ levels: largestDiff(captioned, plain, y0, y1).levels, mean: meanDiff(captioned, plain, y0, y1) });
  const bottom = rows(FRAME.h - SAFE, FRAME.h), middle = rows(...MIDDLE), band = rows(BAND.top, LANE.bottom), k = bars.bottomMeanRatio;
  return { bottom, middle, band, ok: bottom.levels <= middle.levels && bottom.mean <= k * middle.mean && band.mean > k * middle.mean };
}

// The burn the capture draws over [t0, t1) of the film: the review track's ASS, its times from t0 (capture.js's own)
export const burnAss = (vtt, t0, t1) => toAss(parseVtt(readFileSync(vtt, 'utf8')), { from: t0, to: t1, fps: FPS, strip: false });

// The exact judgment: an ASS (burnAss) drawn by the capture's burn filter over a plain video, before any encode, against
// the same frames as they are, each run of rows hashed whole. The bottom rows must hash the same; the caption band must
// not (the control: the burn draws there).
export function burnedRows(plain, assText, scratch) {
  const ass = `${scratch}.ass`, md5 = (crop, burn) => {
    const p = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', plain, '-vf', `${burn ? `${burnFilter(ass, fontFile())},` : ''}crop=${FRAME.w}:${crop[1] - crop[0]}:0:${crop[0]}`, '-f', 'md5', '-'], { encoding: 'utf8' });
    if (p.status !== 0) throw new Error(`burned rows of ${plain}: ${p.stderr}`);
    return p.stdout.trim();
  };
  writeFileSync(ass, assText);
  const bottom = [FRAME.h - SAFE, FRAME.h], band = [BAND.top, LANE.bottom];
  const out = { bottomSame: md5(bottom, false) === md5(bottom, true), bandSame: md5(band, false) === md5(band, true) };
  return { ...out, ok: out.bottomSame && !out.bandSame };
}

// The lag of the preview's audio against the WAV, window by window
export function lagRows(wav, preview, windows = LAG_WINDOWS, bars = BARS) {
  return windows.map(([t0, t1]) => {
    const x = alignment(wav, preview, { i0: Math.round(t0 * wav.sr), i1: Math.round(t1 * wav.sr) });
    return { t0, t1, lag: x.lag, correlation: r(x.correlation, 5), ok: Math.abs(x.lag) <= bars.lagSamples && x.correlation >= bars.correlation };
  });
}

export async function checkPreview({ round = '05', wav = resolve(ROOT, 'out/round-05/blockout.wav'), vtt = resolve(ROOT, 'review/round-04/captions/review.vtt'), noCapture = false, log = console.log } = {}) {
  const dir = resolve(ROOT, `review/round-${round}`), file = resolve(dir, 'preview.mp4'), scratch = resolve(ROOT, `out/round-${round}/preview-plain`);
  if (!existsSync(file)) throw new Error(`no preview at ${rel(file)}: capture it first (the header says how)`);
  const problems = [];
  // streams
  const probe = await ffprobe(file), subs = probeSubtitles(file), frames = Math.round(T_TOTAL * FPS), oneFrame = 1 / FPS + 1e-6;
  const streams = { video: probe.videoStreams, audio: probe.audioStreams, subtitle: subs.streams, frames: probe.frames, duration: probe.duration, audioDuration: probe.audioDuration, subtitleCodec: subs.codec, subtitleDuration: subs.duration, width: probe.width, height: probe.height };
  if (probe.videoStreams !== 1 || probe.audioStreams !== 1 || subs.streams !== 1) problems.push(`streams: ${probe.videoStreams} video, ${probe.audioStreams} audio, ${subs.streams} subtitle; want one each`);
  if (probe.frames !== frames) problems.push(`video: ${probe.frames} frames, want ${frames}`);
  for (const [what, d] of [['the file', probe.duration], ['the audio', probe.audioDuration]]) if (!(Math.abs(d - T_TOTAL) <= oneFrame)) problems.push(`${what} lasts ${d} s, want ${T_TOTAL} to a frame`);
  // ffmpeg ends a mov_text track on its last caption's end, which may fall before the film's: it must not run past it
  if (!(subs.duration > 0 && subs.duration <= T_TOTAL + oneFrame)) problems.push(`the subtitle track lasts ${subs.duration} s, want more than 0 and at most ${T_TOTAL}`);
  log(`streams: ${probe.videoStreams} video (${probe.frames} frames), ${probe.audioStreams} audio (${probe.audioDuration} s), ${subs.streams} subtitle (${subs.codec}, ${subs.duration} s)`);
  // lag
  const a = decodeAudio(wav), b = decodeAudio(file), lag = lagRows(a, b);
  for (const x of lag) if (!x.ok) problems.push(`lag ${x.t0} to ${x.t1} s: ${x.lag} samples at correlation ${x.correlation}`);
  log(`lag: ${lag.map((x) => `${x.t0} to ${x.t1} s ${x.lag} samples (${x.correlation})`).join('; ')}`);
  // bottom band
  mkdirSync(scratch, { recursive: true });
  const bottom = [];
  for (const [t0, t1] of BAND_WINDOWS) {
    const plain = resolve(scratch, `plain-${t0}-${t1}.mp4`);
    if (!noCapture || !existsSync(plain)) await capture({ profile: 'preview', from: t0, to: t1, out: plain, log: () => {} });
    const v = bandVerdict(decodeFrames(file, t0, t1), decodeFrames(plain, 0, t1 - t0)), exact = burnedRows(plain, burnAss(vtt, t0, t1), resolve(scratch, `burn-${t0}-${t1}`));
    const row = (x) => ({ levels: x.levels, mean: r(x.mean, 3) });
    bottom.push({ t0, t1, exact, encoded: { bottom: row(v.bottom), middle: row(v.middle), band: row(v.band), ok: v.ok }, ok: exact.ok && v.ok });
    if (!exact.ok) problems.push(`bottom band ${t0} to ${t1} s, before the encode: the burn ${exact.bottomSame ? 'leaves the bottom rows' : 'draws in the bottom rows'} and ${exact.bandSame ? 'draws nothing in the caption band' : 'draws in the caption band'}`);
    if (!v.ok) problems.push(`bottom band ${t0} to ${t1} s, encoded: the bottom ${SAFE} rows change by ${v.bottom.levels} levels (mean ${r(v.bottom.mean)}), the undrawn middle rows by ${v.middle.levels} (mean ${r(v.middle.mean)}), the caption band by mean ${r(v.band.mean)}`);
  }
  log(`bottom ${SAFE} rows: ${bottom.map((x) => `${x.t0} to ${x.t1} s ${x.exact.bottomSame ? 'untouched by the burn' : 'DRAWN ON by the burn'}; encoded at most ${x.encoded.bottom.levels} levels, mean ${x.encoded.bottom.mean} (middle ${x.encoded.middle.levels}, ${x.encoded.middle.mean}; the caption band mean ${x.encoded.band.mean})`).join('; ')}`);
  // loudness per shot and the stems
  const shots = SHOTS.map((s) => { const i0 = Math.round(s.start * b.sr), i1 = Math.round(s.end * b.sr); return { shot: s.n, lufs: r(integratedLufs(b.left.subarray(i0, i1), b.right.subarray(i0, i1), b.sr), 2) }; });
  const stemsFile = resolve(dir, 'stems/stems.json'), stems = existsSync(stemsFile) ? JSON.parse(readFileSync(stemsFile, 'utf8')) : null;
  const out = {
    round, file: rel(file), wav: rel(wav), captions: rel(vtt),
    bars: { ...BARS, bottom: 'the burn leaves the bottom rows\' bytes as they were; encoded, they differ no more than the undrawn middle rows', sources: { lagSamples: 'ROADMAP Sound 2.8', correlation: 'starting value', bottom: 'ROADMAP Sound 2.8 (nothing drawn in the bottom 30 px)' } },
    streams, lag, bottom, loudness: { integrated: r(integratedLufs(b.left, b.right, b.sr), 2), shots },
    stems: stems ? stems.bodies.map((s) => s.file ?? s.name) : null,
    problems, ok: problems.length === 0,
  };
  writeFileSync(resolve(dir, 'preview-check.json'), `${JSON.stringify(out, null, 1)}\n`);
  log(problems.length ? `preview: ${problems.length} problems\n  ${problems.join('\n  ')}` : `preview: every check passes; wrote ${rel(resolve(dir, 'preview-check.json'))}`);
  return out;
}

async function main() {
  const { values: a } = parseArgs({ options: { round: { type: 'string', default: '05' }, wav: { type: 'string' }, 'no-capture': { type: 'boolean', default: false } }, strict: true });
  const out = await checkPreview({ round: String(Number(a.round)).padStart(2, '0'), wav: a.wav ? resolve(a.wav) : undefined, noCapture: a['no-capture'] });
  if (!out.ok) process.exitCode = 1;
}

const isMain = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((e) => { console.error(`sound-preview failed: ${e.message}`); process.exitCode = 1; });
