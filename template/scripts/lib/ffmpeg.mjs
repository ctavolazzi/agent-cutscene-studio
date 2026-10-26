// ffmpeg and ffprobe helpers for the capture scripts: encode profiles, PNG stills, and probing the result.
// Frames from the page are RGB, bottom row first, so every path here starts with vflip.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, openSync, readSync, closeSync } from 'node:fs';
import { dirname } from 'node:path';
import { CONFIG } from '../../src/config.js';

// ffmpeg's RGB to YUV default is BT.601 while players read HD as BT.709; without both of these, saturated colours
// shift by up to 40 levels (measured in Stage 0 and again in tests/capture.test.mjs)
export const BT709_SCALE = 'out_color_matrix=bt709:out_range=tv';
export const BT709_TAGS = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];

export const PROFILES = ['preview', 'full', '4k'];
export const PHONE = { w: 384, h: 216 };

// Integer upscale from the internal resolution to the delivery size, read from config so 320x180 gives 6x
export function upscaleFactor({ res = CONFIG.res, out = CONFIG.out } = {}) {
  const k = out.w / res.w;
  if (!Number.isInteger(k) || out.h / res.h !== k) throw new Error(`out ${out.w}x${out.h} is not a whole multiple of res ${res.w}x${res.h}`);
  return k;
}

// Output size of a profile for input frames of w x h. The factor is out / (the frames' own size) unless res is given,
// so frames of another size still land on the delivery size, or are refused if they cannot
export function profileSize(profile, { w, h }, { res = { w, h }, out = CONFIG.out } = {}) {
  if (profile === 'preview') return { w, h };
  const k = upscaleFactor({ res, out });
  if (profile === 'full') return { w: w * k, h: h * k };
  if (profile === '4k') return { w: w * k * 2, h: h * k * 2 };
  throw new Error(`unknown profile ${profile} (use ${PROFILES.join(', ')})`);
}

export function videoFilter(profile, { w, h }, { res, out } = {}) {
  const o = profileSize(profile, { w, h }, { res, out });
  // the scale is also where RGB becomes YUV, so it stays in the chain even when the size does not change
  return `vflip,scale=${o.w}:${o.h}:flags=neighbor:${BT709_SCALE}`;
}

// Full ffmpeg argument list: raw rgb24 frames of w x h on stdin, one H.264 MP4 out
// The soundtrack in an MP4: AAC-LC, 48 kHz stereo, 320 kb/s (YouTube's recommendation is AAC-LC at 48 kHz).
export const AUDIO = { codec: 'aac', sampleRate: 48000, channels: 2, bitrate: '320k' };

// `audio`: { file, from, to } adds the soundtrack (a WAV of the whole film) trimmed to the frames being captured;
// without it the file has no audio stream.
export function encodeArgs(profile, { w, h }, { fps = CONFIG.fps, output, res, out, audio = null } = {}) {
  const codec = profile === 'preview'
    ? ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20']
    : ['-c:v', 'libx264', '-crf', '16', '-preset', 'slow', '-tune', 'animation'];
  const sound = audio
    ? { input: ['-ss', String(audio.from), '-to', String(audio.to), '-i', audio.file],
      output: ['-map', '0:v:0', '-map', '1:a:0', '-c:a', AUDIO.codec, '-b:a', AUDIO.bitrate, '-ar', String(AUDIO.sampleRate), '-ac', String(AUDIO.channels)] }
    : { input: [], output: ['-an'] };
  const args = [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${w}x${h}`, '-framerate', String(fps), '-i', 'pipe:0',
    ...sound.input,
    '-vf', videoFilter(profile, { w, h }, { res, out }),
    ...codec,
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', ...sound.output,
    ...BT709_TAGS,
  ];
  if (output) args.push(output);
  return args;
}

// Run ffmpeg with `input` (a Buffer) on stdin; rejects with ffmpeg's stderr on a non-zero exit
export function runFfmpeg(args, input) {
  return new Promise((resolveP, reject) => {
    const p = spawn('ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.stdin.on('error', () => {}); // an early exit shows up as the exit code below
    p.on('close', (code) => (code === 0 ? resolveP() : reject(new Error(`ffmpeg exited ${code}: ${err.trim()}`))));
    p.stdin.end(input);
  });
}

// One frame to PNG: vflip, nearest-neighbour upscale; with phone, also a 384x216 area-downscaled copy (<name>-phone.png)
export async function rgbToPng(rgb, { w, h }, outPath, { scale = 4, phone = false } = {}) {
  if (rgb.length !== w * h * 3) throw new Error(`frame is ${rgb.length} bytes, want ${w * h * 3} for ${w}x${h}`);
  if (!outPath.endsWith('.png')) throw new Error(`not a .png path: ${outPath}`);
  mkdirSync(dirname(outPath), { recursive: true });
  const phonePath = phone ? outPath.replace(/\.png$/, '-phone.png') : null;
  const input = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${w}x${h}`, '-i', 'pipe:0'];
  const big = `scale=${w * scale}:${h * scale}:flags=neighbor`;
  const args = phone
    ? [...input, '-filter_complex', `[0:v]vflip,split=2[a][b];[a]${big}[big];[b]scale=${PHONE.w}:${PHONE.h}:flags=area[small]`,
      '-map', '[big]', '-frames:v', '1', '-pix_fmt', 'rgb24', outPath,
      '-map', '[small]', '-frames:v', '1', '-pix_fmt', 'rgb24', phonePath]
    : [...input, '-vf', `vflip,${big}`, '-frames:v', '1', '-pix_fmt', 'rgb24', outPath];
  await runFfmpeg(args, rgb);
  return { out: outPath, phone: phonePath };
}

// True when the moov box comes before mdat (what +faststart is for), null if neither is found
export function moovFirst(path) {
  const fd = openSync(path, 'r');
  try {
    const head = Buffer.alloc(16);
    let pos = 0;
    for (let n = 0; n < 64; n++) {
      if (readSync(fd, head, 0, 16, pos) < 8) return null;
      let size = head.readUInt32BE(0);
      const type = head.toString('latin1', 4, 8);
      if (type === 'moov') return true;
      if (type === 'mdat') return false;
      if (size === 1) size = Number(head.readBigUInt64BE(8));
      if (size < 8) return null;
      pos += size;
    }
    return null;
  } finally {
    closeSync(fd);
  }
}

// The facts the verify step needs from a file
export function ffprobe(path) {
  return new Promise((resolveP, reject) => {
    const p = spawn('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffprobe exited ${code} on ${path}: ${err.trim()}`));
      const j = JSON.parse(out);
      const streams = j.streams ?? [];
      const v = streams.find((s) => s.codec_type === 'video') ?? {};
      const a = streams.find((s) => s.codec_type === 'audio') ?? {};
      const num = (x) => (x === undefined || x === 'N/A' ? null : Number(x));
      resolveP({
        file: path,
        format: j.format?.format_name ?? null,
        duration: num(j.format?.duration ?? v.duration),
        width: v.width ?? null,
        height: v.height ?? null,
        r_frame_rate: v.r_frame_rate ?? null,
        avg_frame_rate: v.avg_frame_rate ?? null,
        frames: num(v.nb_frames),
        codec: v.codec_name ?? null,
        profile: v.profile ?? null,
        pix_fmt: v.pix_fmt ?? null,
        color_space: v.color_space ?? null,
        color_primaries: v.color_primaries ?? null,
        color_transfer: v.color_transfer ?? null,
        color_range: v.color_range ?? null,
        videoStreams: streams.filter((s) => s.codec_type === 'video').length,
        audioStreams: streams.filter((s) => s.codec_type === 'audio').length,
        audioCodec: a.codec_name ?? null,
        audioRate: num(a.sample_rate),
        audioChannels: a.channels ?? null,
        audioDuration: num(a.duration),
        bitRate: num(j.format?.bit_rate),
        size: num(j.format?.size),
        moovFirst: /mp4|mov/.test(j.format?.format_name ?? '') ? moovFirst(path) : null,
      });
    });
  });
}

// The audio of a media file decoded to 48 kHz stereo float: { sr, left, right }
export function decodeAudio(file, sr = AUDIO.sampleRate) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-vn', '-ac', '2', '-ar', String(sr), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`decode audio of ${file}: ${r.stderr}`);
  const all = new Float32Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.byteLength / 4);
  const n = all.length / 2, left = new Float32Array(n), right = new Float32Array(n);
  for (let i = 0; i < n; i++) { left[i] = all[2 * i]; right[i] = all[2 * i + 1]; }
  return { sr, left, right };
}

// Where b's content sits against a's: the lag in samples (b later is positive) within +-maxLag that best correlates
// the two over [i0, i1) of a, and the normalized correlation there. Coarse on a smoothed copy (an 8-sample moving
// average widens the correlation peak, so a 2-sample lag step cannot step over it), then sample exact on the signals.
export function alignment(a, b, { i0 = 0, i1 = a.length, maxLag = 2400 } = {}) {
  const mono = (s, i) => (s.left[i] ?? 0) + (s.right[i] ?? 0);
  const smooth = (s) => {
    const lo = Math.max(0, i0 - maxLag - 8), hi = Math.min(s.left.length, i1 + maxLag + 8), out = new Float64Array(hi - lo);
    let acc = 0;
    for (let i = lo; i < hi; i++) { acc += mono(s, i) - (i - 8 >= lo ? mono(s, i - 8) : 0); out[i - lo] = acc / 8; }
    return { at: (i) => out[i - lo] ?? 0 };
  };
  const corr = (fa, fb, lag, step) => {
    let xy = 0, xx = 0, yy = 0;
    for (let i = i0; i < i1; i += step) { const x = fa(i), y = fb(i + lag); xy += x * y; xx += x * x; yy += y * y; }
    return xy / Math.sqrt(xx * yy || 1);
  };
  const sa = smooth(a), sb = smooth(b);
  let best = 0, bc = -Infinity;
  for (let lag = -maxLag; lag <= maxLag; lag += 2) { const c = corr(sa.at, sb.at, lag, 4); if (c > bc) { bc = c; best = lag; } }
  let fine = best;
  bc = -Infinity;
  for (let lag = best - 4; lag <= best + 4; lag++) { const c = corr((i) => mono(a, i), (i) => mono(b, i), lag, 1); if (c > bc) { bc = c; fine = lag; } }
  return { lag: fine, correlation: bc };
}
