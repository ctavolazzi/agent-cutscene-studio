// ffmpeg and ffprobe helpers for the capture scripts: encode profiles, PNG stills, and probing the result.
// Frames from the page are RGB, bottom row first, so every path here starts with vflip.
import { spawn } from 'node:child_process';
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
export function encodeArgs(profile, { w, h }, { fps = CONFIG.fps, output, res, out } = {}) {
  const codec = profile === 'preview'
    ? ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20']
    : ['-c:v', 'libx264', '-crf', '16', '-preset', 'slow', '-tune', 'animation'];
  const args = [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${w}x${h}`, '-framerate', String(fps), '-i', 'pipe:0',
    '-vf', videoFilter(profile, { w, h }, { res, out }),
    ...codec,
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an',
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
        bitRate: num(j.format?.bit_rate),
        size: num(j.format?.size),
        moovFirst: /mp4|mov/.test(j.format?.format_name ?? '') ? moovFirst(path) : null,
      });
    });
  });
}
