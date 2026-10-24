// Checks for the capture scripts: scripts/lib/ffmpeg.mjs, scripts/stills.js, scripts/capture.js, scripts/blockout-review.js.
// Run from the project root: node --test tests/capture.test.mjs
// Runs against whatever dist/index.html holds (the stub build until integration). Every comparison is made against
// frames read from the same page, or against a measured control, so it holds for the real scene too.
// Outputs go to $CAPTURE_TEST_OUT, or a folder in the system temp dir, never the project.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openScene, ROOT } from '../scripts/lib/browser.mjs';
import { AUDIO, BT709_SCALE, BT709_TAGS, PHONE, alignment, decodeAudio, encodeArgs, ffprobe, moovFirst, profileSize, rgbToPng, runFfmpeg, upscaleFactor, videoFilter } from '../scripts/lib/ffmpeg.mjs';
import { encodeWav } from '../src/audio/wav.js';
import { mulberry32 } from '../src/prng.js';
import { T_TOTAL } from '../src/world.js';
import { DEFAULT_OUT } from '../scripts/capture.js';
import { contactSheetHtml, shotTimes, stillDisplay } from '../scripts/blockout-review.js';
import { renderStills, stillName } from '../scripts/stills.js';
import { CONFIG } from '../src/config.js';

const OUT = process.env.CAPTURE_TEST_OUT ?? join(tmpdir(), 'snowy-bridge-capture-test');
const W = CONFIG.res.w, H = CONFIG.res.h, FPS = CONFIG.fps;
const DASH = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`); // built from code points so this file holds neither
const STRIP = 11; // the overlay strip's height in internal pixels (src/hud.js), the top rows of the picture
mkdirSync(OUT, { recursive: true });
const fresh = (name) => { const d = resolve(OUT, name); rmSync(d, { recursive: true, force: true }); mkdirSync(d, { recursive: true }); return d; };

function node(script, args, env) {
  const r = spawnSync(process.execPath, [resolve(ROOT, script), ...args], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26, env: env ?? process.env });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
// a page that serves one flat frame instantly, with the same __info shape as the real build; fps is overridable so a
// test can plant a mismatch
function plantedPage(file, { fps = FPS, level = 40, extra = '' } = {}) {
  writeFileSync(file, `<!doctype html><meta charset="utf-8"><script>
const W = ${W}, H = ${H};
window.__info = { fps: ${fps}, total: 112, res: { w: W, h: H }, out: { w: ${CONFIG.out.w}, h: ${CONFIG.out.h} }, shots: [{ n: 1, start: 0, end: 112, title: 'Planted', lens: 35 }] };
const b64 = btoa(String.fromCharCode(${level}).repeat(W * H * 3));
window.__frameRGB = (t) => { ${extra} return { info: { t, shot: 1, title: 'Planted', lens: 35 }, b64 }; };
window.__ready = true;
</script>`);
  return file;
}
// first frame of a video or a PNG as RGB, top row first
function decode(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 28 });
  assert.equal(r.status, 0, `decode ${file}: ${r.stderr}`);
  return r.stdout;
}
const flipRows = (rgb, w, h) => {
  const o = Buffer.alloc(rgb.length);
  for (let y = 0; y < h; y++) rgb.copy(o, (h - 1 - y) * w * 3, y * w * 3, (y + 1) * w * 3);
  return o;
};
// sample the centre of each k x k block of a k-times upscaled image, giving back the w x h image
function sampleDown(big, w, h, k) {
  const o = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) big.copy(o, (y * w + x) * 3, ((y * k + (k >> 1)) * w * k + x * k + (k >> 1)) * 3, ((y * k + (k >> 1)) * w * k + x * k + (k >> 1)) * 3 + 3);
  return o;
}
// mean absolute difference over rows [y0, y1) of two w-wide RGB images
function meanDiff(a, b, w, y0, y1) {
  let s = 0;
  for (let i = y0 * w * 3; i < y1 * w * 3; i++) s += Math.abs(a[i] - b[i]);
  return s / ((y1 - y0) * w * 3);
}
// one page frame (bottom row first) through a profile's own arguments, decoded: what the encoder alone does to it
async function encodeOne(profile, rgb, file) {
  await runFfmpeg(encodeArgs(profile, { w: W, h: H }, { output: file }), rgb);
  return decode(file);
}
// a capture may differ from the page by up to half again the encoder's own error, plus a level
const near = (control) => 1.5 * control + 1;
const K = CONFIG.out.w / W; // the full profile's upscale

// one browser for the reference frames
let scenePromise = null;
const scene = () => (scenePromise ??= openScene({ overlay: true }));
after(async () => { if (scenePromise) await (await scenePromise).close(); });

test('ffmpeg.mjs: BT.709 constants and the three profiles, sizes read from config', () => {
  assert.equal(BT709_SCALE, 'out_color_matrix=bt709:out_range=tv');
  assert.deepEqual(BT709_TAGS, ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv']);
  const has = (args, seq) => args.some((_, i) => seq.every((v, j) => args[i + j] === v));
  const tags = (args) => has(args, BT709_TAGS);

  const p = encodeArgs('preview', { w: 480, h: 270 }, { output: 'x.mp4' });
  assert.ok(has(p, ['-vf', 'vflip,scale=480:270:flags=neighbor:out_color_matrix=bt709:out_range=tv']), p.join(' '));
  for (const seq of [['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20'], ['-pix_fmt', 'yuv420p'], ['-movflags', '+faststart'], ['-an'], ['-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', '480x270', '-framerate', '24', '-i', 'pipe:0']]) assert.ok(has(p, seq), `preview lacks ${seq.join(' ')}`);
  assert.ok(tags(p) && p.at(-1) === 'x.mp4' && !p.includes('-tune'));

  const f = encodeArgs('full', { w: 480, h: 270 });
  assert.ok(has(f, ['-vf', 'vflip,scale=1920:1080:flags=neighbor:out_color_matrix=bt709:out_range=tv']), f.join(' '));
  assert.ok(has(f, ['-c:v', 'libx264', '-crf', '16', '-preset', 'slow', '-tune', 'animation', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an']), f.join(' '));
  assert.ok(tags(f));
  const k4 = encodeArgs('4k', { w: 480, h: 270 });
  assert.ok(has(k4, ['-vf', 'vflip,scale=3840:2160:flags=neighbor:out_color_matrix=bt709:out_range=tv']), k4.join(' '));
  assert.ok(has(k4, ['-crf', '16', '-preset', 'slow', '-tune', 'animation']) && tags(k4));

  // the factor is out / res: 4 at 480x270, 6 at the 320x180 option, and a fractional one is refused
  assert.equal(upscaleFactor(), 4);
  const six = { res: { w: 320, h: 180 }, out: { w: 1920, h: 1080 } };
  assert.equal(upscaleFactor(six), 6);
  assert.deepEqual(profileSize('full', { w: 320, h: 180 }, six), { w: 1920, h: 1080 });
  assert.deepEqual(profileSize('4k', { w: 320, h: 180 }, six), { w: 3840, h: 2160 });
  assert.equal(videoFilter('preview', { w: 320, h: 180 }, six), `vflip,scale=320:180:flags=neighbor:${BT709_SCALE}`);
  assert.throws(() => upscaleFactor({ res: { w: 500, h: 270 }, out: { w: 1920, h: 1080 } }), /whole multiple/);
  assert.throws(() => encodeArgs('8k', { w: 480, h: 270 }), /unknown profile/);
  // with no res given, the factor comes from the frames passed in, so other frame sizes still reach the delivery size
  assert.deepEqual(profileSize('full', { w: 320, h: 180 }), { w: 1920, h: 1080 });
  assert.deepEqual(profileSize('4k', { w: 320, h: 180 }), { w: 3840, h: 2160 });
  assert.ok(has(encodeArgs('full', { w: 320, h: 180 }), ['-vf', `vflip,scale=1920:1080:flags=neighbor:${BT709_SCALE}`]));
  assert.ok(has(encodeArgs('4k', { w: 320, h: 180 }), ['-s', '320x180']));
  assert.throws(() => encodeArgs('full', { w: 500, h: 270 }), /whole multiple/);
});

test('ffmpeg.mjs: colours survive the encode within 3 levels; dropping the matrix or the tags shifts them 20 or more', async () => {
  const d = fresh('colour');
  const w = 128, h = 64, B = 32;
  const cols = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 180, 107], [255, 211, 107], [5, 8, 15], [200, 200, 200], [157, 184, 255]];
  // block (bx, by) in picture order; the buffer is bottom row first like the page's
  const frame = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) frame.set(cols[(x >> 5) + 4 * ((h - 1 - y) >> 5)], (y * w + x) * 3);
  const worst = async (name, edit) => {
    const file = resolve(d, `${name}.mp4`);
    const args = edit(encodeArgs('preview', { w, h }, { output: file }));
    await runFfmpeg(args, Buffer.concat([frame, frame]));
    const rgb = decode(file);
    let m = 0;
    cols.forEach((c, i) => {
      const x = (i % 4) * B + B / 2, y = Math.floor(i / 4) * B + B / 2;
      for (let k = 0; k < 3; k++) m = Math.max(m, Math.abs(rgb[(y * w + x) * 3 + k] - c[k]));
    });
    return m;
  };
  const good = await worst('bt709', (a) => a);
  const noMatrix = await worst('no-matrix', (a) => a.map((s) => s.replace(`:${BT709_SCALE}`, '')));
  const noTags = await worst('no-tags', (a) => { const i = a.indexOf('-colorspace'); return [...a.slice(0, i), ...a.slice(i + BT709_TAGS.length)]; });
  console.log(`  colour error: bt709 ${good}, matrix left out ${noMatrix}, tags left out ${noTags} (levels of 255)`);
  assert.ok(good <= 3, `BT.709 round trip off by ${good}`);
  assert.ok(noMatrix >= 20, `control: leaving the matrix out should shift colours, got ${noMatrix}`);
  assert.ok(noTags >= 20, `control: leaving the tags out should shift colours, got ${noTags}`);
});

test('ffmpeg.mjs: rgbToPng flips, upscales nearest neighbour, and writes the 384x216 phone copy', async () => {
  const d = fresh('png');
  const w = 16, h = 9;
  const src = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) src.set([(i * 37) & 255, (i * 91 + 7) & 255, (i * 13 + 200) & 255], i * 3);
  const r = await rgbToPng(src, { w, h }, resolve(d, 'a.png'), { scale: 4, phone: true });
  assert.equal(r.phone, resolve(d, 'a-phone.png'));
  const big = decode(r.out);
  assert.equal(big.length, w * 4 * h * 4 * 3);
  // every pixel of every 4x4 block equals the flipped source pixel
  for (let y = 0; y < h * 4; y++) for (let x = 0; x < w * 4; x++) {
    const s = ((h - 1 - (y >> 2)) * w + (x >> 2)) * 3, o = (y * w * 4 + x) * 3;
    assert.deepEqual([...big.subarray(o, o + 3)], [...src.subarray(s, s + 3)], `pixel ${x},${y}`);
  }
  const ph = await ffprobe(r.phone);
  assert.deepEqual([ph.width, ph.height], [PHONE.w, PHONE.h]);
  assert.deepEqual([PHONE.w, PHONE.h], [384, 216]);
  const r2 = await rgbToPng(src, { w, h }, resolve(d, 'b.png'), { scale: 2 });
  assert.equal(r2.phone, null);
  assert.ok(!existsSync(resolve(d, 'b-phone.png')));
  const p2 = await ffprobe(r2.out);
  assert.deepEqual([p2.width, p2.height, p2.moovFirst], [32, 18, null]);
  await assert.rejects(rgbToPng(src.subarray(3), { w, h }, resolve(d, 'c.png')), /bytes/);
});

test('ffmpeg.mjs: moovFirst tells a faststart file from one without it', async () => {
  const d = fresh('faststart');
  const frame = Buffer.alloc(64 * 36 * 3, 90);
  const yes = resolve(d, 'yes.mp4'), no = resolve(d, 'no.mp4');
  const args = encodeArgs('preview', { w: 64, h: 36 }, { output: yes });
  await runFfmpeg(args, frame);
  const i = args.indexOf('-movflags');
  await runFfmpeg([...args.slice(0, i), ...args.slice(i + 2, -1), no], frame);
  assert.equal(moovFirst(yes), true);
  assert.equal(moovFirst(no), false, 'control: without +faststart mdat comes first');
});

// Geometry of the full and 4k encodes, independent of the build: a 480x270 picture with 1 px stripes in x and y (so a
// block that is shifted or smoothed by any amount shows), a red marker top left and a blue one bottom right (so a
// missing flip shows). Every output pixel is checked against the picture pixel at (floor(x / k), floor(y / k)).
const GW = 480, GH = 270;
const inMarker = (px, py) => (px < 60 && py < 40) || (px >= GW - 60 && py >= GH - 40);
const geomPic = Buffer.alloc(GW * GH * 3); // top row first
for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
  const v = (x & 1 ? 200 : 40) + (y & 1 ? 20 : 0);
  geomPic.set(x < 60 && y < 40 ? [220, 40, 40] : inMarker(x, y) ? [40, 40, 220] : [v, v, v], (y * GW + x) * 3);
}
function geomError(got, k) {
  const OW = GW * k, OH = GH * k;
  assert.equal(got.length, OW * OH * 3, `output is not ${OW}x${OH}`);
  let max = 0, sum = 0;
  // mean error by output x mod k and y mod k over the stripes: equal at every phase when blocks line up
  const px = new Float64Array(k), py = new Float64Array(k), nx = new Float64Array(k), ny = new Float64Array(k);
  for (let y = 0; y < OH; y++) {
    const sy = Math.floor(y / k);
    for (let x = 0; x < OW; x++) {
      const sx = Math.floor(x / k), s = (sy * GW + sx) * 3, o = (y * OW + x) * 3;
      let e = 0;
      for (let c = 0; c < 3; c++) { const dd = Math.abs(got[o + c] - geomPic[s + c]); e += dd; if (dd > max) max = dd; }
      sum += e;
      if (!inMarker(sx, sy)) { px[x % k] += e; nx[x % k] += 3; py[y % k] += e; ny[y % k] += 3; }
    }
  }
  const spreadOf = (a, n) => { const m = [...a].map((v, i) => v / n[i]); return Math.max(...m) - Math.min(...m); };
  const o = (20 * k * OW + 30 * k) * 3; // centre of the red marker
  return { max, mean: sum / (OW * OH * 3), spread: Math.max(spreadOf(px, nx), spreadOf(py, ny)), topLeft: [...got.subarray(o, o + 3)] };
}

test('ffmpeg.mjs: full and 4k encodes are upright and block aligned at every output pixel; planted faults fail the check', async () => {
  const d = fresh('geometry');
  const src = flipRows(geomPic, GW, GH); // bottom row first, like the page's frames
  const run = async (name, profile, edit = (a) => a) => {
    const file = resolve(d, `${name}.mp4`);
    await runFfmpeg(edit(encodeArgs(profile, { w: GW, h: GH }, { output: file })), src);
    return geomError(decode(file), profileSize(profile, { w: GW, h: GH }).w / GW);
  };
  const lossless = (a) => { const i = a.indexOf('-crf'); return [...a.slice(0, i), '-qp', '0', ...a.slice(i + 2)]; };
  const vf = (f) => (a) => a.map((s, i) => (a[i - 1] === '-vf' ? f(s) : s));
  const fmt = (r) => `max ${r.max}, mean ${r.mean.toFixed(3)}, phase spread ${r.spread.toFixed(3)}, top left ${r.topLeft.join(',')}`;
  for (const profile of ['full', '4k']) {
    const lossy = await run(profile, profile);
    const exact = await run(`${profile}-qp0`, profile, lossless);
    console.log(`  ${profile} geometry: as shipped ${fmt(lossy)}; at qp 0 ${fmt(exact)}`);
    // at qp 0 only the RGB to YUV rounding is left, so every pixel within 3 levels means upright, aligned, nearest
    assert.ok(exact.max <= 3, `${profile} at qp 0: ${fmt(exact)}`);
    assert.ok(lossy.mean < 1 && lossy.spread < 0.5, `${profile} as shipped: ${fmt(lossy)}`);
    assert.ok(lossy.topLeft[0] > 180 && lossy.topLeft[2] < 90, `${profile}: the red marker belongs at the top left`);
  }
  // controls: each planted fault in the full chain must break the same check
  const faults = {
    'no vflip': (s) => s.replace('vflip,', ''),
    bilinear: (s) => s.replace('flags=neighbor', 'flags=bilinear'),
    'shifted 2 px': (s) => `${s},crop=iw-2:ih:2:0,pad=iw+2:ih:0:0`,
  };
  for (const [name, f] of Object.entries(faults)) {
    const r = await run(`fault-${name.replace(/\W+/g, '-')}`, 'full', (a) => vf(f)(lossless(a)));
    console.log(`  control, ${name}: ${fmt(r)}`);
    assert.ok(r.max >= 100, `control: ${name} should fail the per-pixel check, got ${fmt(r)}`);
  }
});

test('stills.js: three times at 4x with phone copies, pixel exact against the page, the right way up', async () => {
  const d = fresh('stills');
  const times = [1, 2.5, 90];
  const r = node('scripts/stills.js', ['--times', times.join(','), '--outdir', d, '--phone']);
  assert.equal(r.code, 0, r.err + r.out);
  assert.match(r.out, /3 stills in/);
  const s = await scene();
  for (const t of times) {
    const file = resolve(d, stillName(t));
    const p = await ffprobe(file);
    assert.deepEqual([p.width, p.height], [W * 4, H * 4], file);
    const ph = await ffprobe(file.replace(/\.png$/, '-phone.png'));
    assert.deepEqual([ph.width, ph.height], [384, 216]);
    const ref = (await s.frame(t)).rgb;
    const got = sampleDown(decode(file), W, H, 4);
    assert.ok(got.equals(flipRows(ref, W, H)), `still at ${t} differs from the page's frame`);
    assert.ok(!got.equals(ref), `control: the unflipped frame must differ at ${t}, or this check could not catch a missing vflip`);
  }
  assert.deepEqual(readdirSync(d).sort(), ['t001.000-phone.png', 't001.000.png', 't002.500-phone.png', 't002.500.png', 't090.000-phone.png', 't090.000.png']);
  const bad = node('scripts/stills.js', ['--times', '1,x', '--outdir', d]);
  assert.notEqual(bad.code, 0, 'a bad time must fail');
});

test('stills.js: two stills that would write one file are refused before any work', async () => {
  const d = fresh('collide');
  // 1 and 1.0001 both name t001.000.png; before the fix this printed "2 stills" and kept one file
  const r = node('scripts/stills.js', ['--times', '1,1.0001', '--outdir', d]);
  assert.notEqual(r.code, 0, r.out);
  assert.match(r.err, /two stills would write \S*t001\.000\.png \(times 1 and 1\.0001\)/);
  assert.deepEqual(readdirSync(d), []);
  // a phone copy counts as a file too; the build path does not exist, so reaching the browser would fail differently
  const missing = resolve(d, 'missing.html');
  await assert.rejects(renderStills({ items: [{ t: 1, out: resolve(d, 'a.png'), phone: true }, { t: 2, out: resolve(d, 'a-phone.png') }], file: missing }), /two stills would write \S*a-phone\.png/);
  await assert.rejects(renderStills({ items: [{ t: 1, out: resolve(d, 'a.png') }, { t: 2, out: resolve(d, 'a-phone.png') }], file: missing }), /No build at/, 'control: without the phone copy the names are distinct');
});

test('capture.js: 2 s preview from 10 to 12 is 480x270, 24/1, 48 frames, yuv420p, BT.709, no audio, faststart', async () => {
  const d = fresh('preview');
  const file = resolve(OUT, 'preview.mp4');
  rmSync(file, { force: true });
  const r = node('scripts/capture.js', ['--profile', 'preview', '--from', '10', '--to', '12', '--out', file]);
  assert.equal(r.code, 0, r.err + r.out);
  assert.match(r.out, /frame 48\/48 /);
  assert.match(r.out, /done: 48 frames in [\d.]+ s, [\d.]+ ms\/frame/);
  const p = await ffprobe(file);
  assert.equal(p.width, 480); assert.equal(p.height, 270);
  assert.equal(p.r_frame_rate, '24/1'); assert.equal(p.frames, 48);
  assert.ok(Math.abs(p.duration - 2) < 0.5 / FPS, `duration ${p.duration}`);
  assert.equal(p.codec, 'h264'); assert.equal(p.pix_fmt, 'yuv420p');
  assert.deepEqual([p.color_space, p.color_primaries, p.color_transfer, p.color_range], ['bt709', 'bt709', 'bt709', 'tv']);
  assert.equal(p.audioStreams, 0); assert.equal(p.videoStreams, 1); assert.equal(p.moovFirst, true);
  const side = JSON.parse(readFileSync(`${file}.json`, 'utf8'));
  assert.equal(side.frames, 48); assert.equal(side.firstFrame, 240); assert.equal(side.lastFrame, 287);
  assert.equal(side.profile, 'preview'); assert.equal(side.overlay, true);
  assert.ok(side.seconds > 0 && side.msPerFrame > 0);
  assert.deepEqual(side.problems, []);
  assert.equal(side.ffmpeg[0], 'ffmpeg'); assert.equal(side.ffmpeg.at(-1), file);
  assert.ok(side.ffmpeg.includes('vflip,scale=480:270:flags=neighbor:out_color_matrix=bt709:out_range=tv'));
  assert.deepEqual(side.ffprobe, p);
  assert.ok(!existsSync(resolve(OUT, 'preview.partial.mp4')), 'the partial file is renamed away');
  // the right way up: the video's first frame matches the page's frame 240 flipped, as closely as the encoder allows.
  // The limit is relative to a control, the same page frame encoded alone with the same arguments, so a busier real
  // scene (more compression error) moves the limit with it
  const ref = (await (await scene()).frame(10)).rgb;
  const want = flipRows(ref, W, H);
  const got = decode(file);
  const ctrl = await encodeOne('preview', ref, resolve(d, 'control.mp4'));
  const strip = meanDiff(got, want, W, 0, STRIP), body = meanDiff(got, want, W, STRIP, H), unflipped = meanDiff(got, ref, W, 0, STRIP);
  const cStrip = meanDiff(ctrl, want, W, 0, STRIP), cBody = meanDiff(ctrl, want, W, STRIP, H);
  console.log(`  preview frame 0 vs page: strip rows ${strip.toFixed(2)} flipped (control ${cStrip.toFixed(2)}), ${unflipped.toFixed(2)} unflipped; rest ${body.toFixed(2)} (control ${cBody.toFixed(2)})`);
  assert.ok(strip <= near(cStrip) && body <= near(cBody), `preview differs from the page more than the encoder alone: strip ${strip} vs ${cStrip}, rest ${body} vs ${cBody}`);
  assert.ok(unflipped > 3 * strip && unflipped > 10, `control: the unflipped frame should be clearly worse (${unflipped})`);
  writeFileSync(resolve(d, 'probe.json'), JSON.stringify(p, null, 1));
});

test('capture.js: 1 s of the full profile is 1920x1080, 24 frames, crf 16 slow animation, overlay off by default', async () => {
  const file = resolve(OUT, 'full-1s.mp4');
  const r = node('scripts/capture.js', ['--profile', 'full', '--from', '10', '--to', '11', '--out', file]);
  assert.equal(r.code, 0, r.err + r.out);
  const p = await ffprobe(file);
  assert.deepEqual([p.width, p.height, p.frames, p.r_frame_rate, p.pix_fmt, p.color_space, p.audioStreams, p.moovFirst], [1920, 1080, 24, '24/1', 'yuv420p', 'bt709', 0, true]);
  const side = JSON.parse(readFileSync(`${file}.json`, 'utf8'));
  assert.equal(side.overlay, false);
  for (const v of ['-crf', '16', '-preset', 'slow', '-tune', 'animation']) assert.ok(side.ffmpeg.includes(v), v);
  assert.ok(side.ffmpeg.includes('vflip,scale=1920:1080:flags=neighbor:out_color_matrix=bt709:out_range=tv'));
  // nearest-neighbour upscale of the page's frame (drawn without the overlay, as the capture was), against the same
  // frame encoded alone. On the stub the frame is flat, so the geometry test above is what guards orientation and
  // block alignment of this profile
  const s2 = await openScene({ overlay: false });
  try {
    const raw = (await s2.frame(10)).rgb;
    const ref = flipRows(raw, W, H);
    const got = sampleDown(decode(file), W, H, K);
    const ctrl = sampleDown(await encodeOne('full', raw, resolve(OUT, 'full-control.mp4')), W, H, K);
    const e = meanDiff(got, ref, W, 0, H), c = meanDiff(ctrl, ref, W, 0, H);
    console.log(`  full frame 0 vs page, block centres: mean error ${e.toFixed(2)} (control ${c.toFixed(2)})`);
    assert.ok(e <= near(c), `full frame differs from the page by ${e}, the encoder alone by ${c}`);
  } finally {
    await s2.close();
  }
});

test('capture.js: two frames of 4k are 3840x2160', async () => {
  const file = resolve(OUT, 'k4-2f.mp4');
  const r = node('scripts/capture.js', ['--profile', '4k', '--from', '10', '--to', String(10 + 2 / FPS), '--out', file]);
  assert.equal(r.code, 0, r.err + r.out);
  const p = await ffprobe(file);
  assert.deepEqual([p.width, p.height, p.frames], [3840, 2160, 2]);
});

test('capture.js: default outputs, and frame ranges round to the frame grid', () => {
  assert.deepEqual(DEFAULT_OUT, { preview: 'out/preview.mp4', full: 'out/snowy-bridge.mp4', '4k': 'out/snowy-bridge-4k.mp4' });
  // from 10 to 10.05: round(240) to round(241.2) - 1 is one frame
  const file = resolve(OUT, 'one.mp4');
  const r = node('scripts/capture.js', ['--profile', 'preview', '--from', '10', '--to', '10.05', '--out', file, '--overlay', '0']);
  assert.equal(r.code, 0, r.err + r.out);
  const side = JSON.parse(readFileSync(`${file}.json`, 'utf8'));
  assert.deepEqual([side.firstFrame, side.lastFrame, side.frames, side.ffprobe.frames, side.overlay], [240, 240, 1, 1, false]);
});

test('capture.js: exits non-zero on an ffmpeg error, a page error, or bad arguments, and leaves no output', () => {
  const d = fresh('fail');
  // ffmpeg cannot pick a muxer for this extension
  const bad = resolve(d, 'bad.xyz');
  const r1 = node('scripts/capture.js', ['--profile', 'preview', '--from', '10', '--to', '11', '--out', bad]);
  assert.notEqual(r1.code, 0);
  assert.match(r1.err, /ffmpeg failed/);
  assert.ok(!existsSync(bad) && !existsSync(resolve(d, 'bad.partial.xyz')) && !existsSync(`${bad}.json`));

  // a planted page that throws once t passes 10.5
  const page = plantedPage(resolve(d, 'planted.html'), { extra: `if (t > 10.5) setTimeout(() => { throw new Error('planted page error'); }, 0);` });
  const out2 = resolve(d, 'page.mp4');
  const r2 = node('scripts/capture.js', ['--profile', 'preview', '--from', '10', '--to', '12', '--out', out2, '--file', page]);
  assert.notEqual(r2.code, 0);
  assert.match(r2.err, /planted page error/);
  assert.ok(!existsSync(out2) && !existsSync(resolve(d, 'page.partial.mp4')));
  // the same page before the planted error captures fine, so the failure above is the page error and nothing else
  const ok = node('scripts/capture.js', ['--profile', 'preview', '--from', '10', '--to', '10.5', '--out', resolve(d, 'ok.mp4'), '--file', page]);
  assert.equal(ok.code, 0, ok.err);

  for (const args of [['--profile', 'huge'], ['--profile', 'preview', '--from', '12', '--to', '10'], ['--profile', 'preview', '--to', '200'], ['--profile', 'preview', '--overlay', '2'], ['--profile', 'preview', '--bogus']]) {
    const r = node('scripts/capture.js', [...args, '--out', resolve(d, 'x.mp4')]);
    assert.notEqual(r.code, 0, args.join(' '));
  }
  assert.ok(!existsSync(resolve(d, 'x.mp4')));
});

test('capture.js: a probe that does not match the request leaves nothing at the final path, only the partial file and its sidecar', () => {
  const d = fresh('mismatch');
  const out = resolve(d, 'ntsc.mp4'), partial = resolve(d, 'ntsc.partial.mp4');
  // 23.976 fps encodes as 2997/125, which the probe refuses (the reviewer's planted case)
  const r = node('scripts/capture.js', ['--profile', 'preview', '--from', '10', '--to', '10.5', '--out', out, '--file', plantedPage(resolve(d, 'ntsc.html'), { fps: 23.976 })]);
  assert.notEqual(r.code, 0, r.out);
  assert.match(r.err, /output does not match the request: r_frame_rate is 2997\/125, want 23\.976\/1/);
  assert.ok(!existsSync(out) && !existsSync(`${out}.json`), 'nothing at the final path');
  assert.ok(existsSync(partial), 'the partial file is kept for diagnosis');
  const side = JSON.parse(readFileSync(`${partial}.json`, 'utf8'));
  assert.deepEqual([side.file, side.ffprobe.file, side.ffmpeg.at(-1)], [partial, partial, partial]);
  assert.ok(side.problems.some((p) => p.startsWith('r_frame_rate is 2997/125')), side.problems.join('; '));
  // the next good run to the same path clears those leftovers and writes the final file
  const ok = node('scripts/capture.js', ['--profile', 'preview', '--from', '10', '--to', '10.5', '--out', out, '--file', plantedPage(resolve(d, 'pal.html'))]);
  assert.equal(ok.code, 0, ok.err);
  assert.ok(existsSync(out) && existsSync(`${out}.json`) && !existsSync(partial) && !existsSync(`${partial}.json`));
  assert.equal(JSON.parse(readFileSync(`${out}.json`, 'utf8')).ffprobe.file, out);
});

// Backpressure: an ffmpeg that reads slower than the page draws. Waiting for 'drain' paces the frame loop to the
// reader; without it the loop runs ahead and the frames pile up in memory. The throttle sits first on PATH, and a
// mutant copy of capture.js with the wait removed proves the measurement can tell the two apart.
test('capture.js: waits for drain, so a slow ffmpeg paces the frame loop; a copy without the wait runs ahead', () => {
  const d = fresh('drain');
  const RATE = 2e6; // bytes per second, about 194 ms per 480x270 frame
  const real = spawnSync('sh', ['-c', 'command -v ffmpeg'], { encoding: 'utf8' }).stdout.trim();
  assert.ok(real, 'ffmpeg on PATH');
  const bin = resolve(d, 'bin');
  mkdirSync(bin);
  // CommonJS by extension, so it runs whatever package scope the temp dir is in
  writeFileSync(resolve(bin, 'throttle.cjs'), `const { spawn } = require('node:child_process');
const ff = spawn(process.env.THROTTLE_REAL, process.argv.slice(2), { stdio: ['pipe', 'inherit', 'inherit'] });
ff.on('close', (c) => process.exit(c ?? 1));
ff.stdin.on('error', () => {});
const RATE = Number(process.env.THROTTLE_BPS), CHUNK = 65536, q = [];
let ended = false, busy = false;
process.stdin.on('data', (b) => { q.push(b); process.stdin.pause(); pump(); });
process.stdin.on('end', () => { ended = true; pump(); });
function pump() {
  if (busy) return;
  if (!q.length) { if (ended) ff.stdin.end(); else process.stdin.resume(); return; }
  busy = true;
  const b = q.shift();
  if (b.length > CHUNK) q.unshift(b.subarray(CHUNK));
  const piece = b.subarray(0, CHUNK);
  ff.stdin.write(piece);
  setTimeout(() => { busy = false; pump(); }, (piece.length / RATE) * 1000);
}
`);
  writeFileSync(resolve(bin, 'ffmpeg'), `#!/bin/sh\nexec "${process.execPath}" "${resolve(bin, 'throttle.cjs')}" "$@"\n`);
  chmodSync(resolve(bin, 'ffmpeg'), 0o755);
  const env = { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}`, THROTTLE_REAL: real, THROTTLE_BPS: String(RATE) };

  // the mutant: capture.js with the drain wait switched off, its imports pointed back at the real modules
  let src = readFileSync(resolve(ROOT, 'scripts/capture.js'), 'utf8');
  const swaps = [
    ['if (!ff.stdin.write(buf)) {', 'if (!ff.stdin.write(buf) && false) {'],
    [`from './lib/`, `from '${pathToFileURL(resolve(ROOT, 'scripts/lib')).href}/`],
    [`from '../src/`, `from '${pathToFileURL(resolve(ROOT, 'src')).href}/`],
  ];
  for (const [a, b] of swaps) {
    assert.ok(src.includes(a), `the mutant needs "${a}" in capture.js`);
    src = src.split(a).join(b);
  }
  writeFileSync(resolve(d, 'capture-no-drain.mjs'), src);

  const page = plantedPage(resolve(d, 'fast.html')); // serves frames in a few ms, far faster than the throttle
  const readerMs = ((W * H * 3) / RATE) * 1000, n = FPS;
  const run = (script, name) => {
    const r = node(script, ['--profile', 'preview', '--from', '0', '--to', '1', '--out', resolve(d, `${name}.mp4`), '--file', page], env);
    assert.equal(r.code, 0, `${name}: ${r.err}${r.out}`);
    const loop = r.out.match(new RegExp(`frame ${n}/${n} .*?([\\d.]+) s\\s+([\\d.]+) ms/frame`));
    const done = r.out.match(/done: \d+ frames in ([\d.]+) s/);
    assert.ok(loop && done, r.out);
    const res = { loopMs: Number(loop[2]), loopS: Number(loop[1]), doneS: Number(done[1]) };
    console.log(`  ${name}: frame loop ${res.loopMs} ms/frame, loop ${res.loopS} s of ${res.doneS} s; the reader takes ${readerMs.toFixed(0)} ms/frame`);
    return res;
  };
  const good = run('scripts/capture.js', 'with-drain');
  assert.ok(good.loopMs >= 0.6 * readerMs, `the loop should be paced by the reader: ${good.loopMs} ms/frame against ${readerMs.toFixed(0)}`);
  assert.ok(good.loopS >= 0.8 * good.doneS, `the loop should take most of the run: ${good.loopS} of ${good.doneS} s`);
  const bad = run(resolve(d, 'capture-no-drain.mjs'), 'no-drain mutant');
  assert.ok(bad.loopMs <= 0.5 * readerMs && bad.loopS <= 0.5 * bad.doneS, `control: without the wait the loop must run ahead of the reader, got ${bad.loopMs} ms/frame, ${bad.loopS} of ${bad.doneS} s`);
});

test('blockout-review.js: 45 stills at the first, middle and last frame of every shot, phone copies, contact sheet 1500 px wide', async () => {
  const root = fresh('rev');
  const r = node('scripts/blockout-review.js', ['--round', '02', '--outroot', root]);
  assert.equal(r.code, 0, r.err + r.out);
  const dir = resolve(root, 'round-02');
  const s = await scene();
  const { shots, fps } = s.info;
  assert.equal(shots.length, 15);
  const files = readdirSync(resolve(dir, 'stills')).sort();
  assert.equal(files.length, 60, '45 stills plus 15 phone copies');
  const j = JSON.parse(readFileSync(resolve(dir, 'stills.json'), 'utf8'));
  assert.deepEqual([j.round, j.count, j.phoneCount, j.scale, j.overlay, j.wrongShot, j.fps], ['02', 45, 15, 4, true, 0, 24]);
  for (const sh of shots) {
    const nn = String(sh.n).padStart(2, '0');
    const mine = j.stills.filter((x) => x.shot === sh.n);
    assert.deepEqual(mine.map((x) => x.which), ['first', 'mid', 'last']);
    assert.deepEqual(mine.map((x) => x.t), [sh.start, (sh.start + sh.end) / 2, sh.end - 1 / fps]);
    assert.deepEqual(shotTimes(sh, fps).map(([, t]) => t), mine.map((x) => x.t));
    for (const x of mine) {
      assert.equal(x.file, `stills/shot-${nn}-${x.which}.png`);
      assert.equal(x.phone, x.which === 'mid' ? `stills/shot-${nn}-mid-phone.png` : null);
      assert.equal(x.renderedShot, sh.n, `${x.file} drew shot ${x.renderedShot}`);
      assert.equal(x.frame, Math.round(x.t * fps));
    }
  }
  // spot check two stills against the page, overlay on
  const { res } = s.info;
  for (const x of [j.stills[0], j.stills[44]]) {
    const p = await ffprobe(resolve(dir, x.file));
    assert.deepEqual([p.width, p.height], [res.w * 4, res.h * 4]);
    assert.ok(sampleDown(decode(resolve(dir, x.file)), res.w, res.h, 4).equals(flipRows((await s.frame(x.t)).rgb, res.w, res.h)), x.file);
  }
  // each still is shown at a whole multiple of the internal frame; 480x270 fills the sheet at exactly 1x
  const shown = stillDisplay(res);
  if (res.w === 480) assert.deepEqual(shown, { w: 480, h: 270, scale: 1 });
  assert.deepEqual(j.contactSheet.still, shown);
  const sheet = await ffprobe(resolve(dir, 'contact-sheet.png'));
  assert.equal(sheet.width, 1500);
  assert.ok(sheet.height > shots.length * shown.h, `full page, got ${sheet.height} px tall`);
  const html = readFileSync(resolve(dir, 'contact-sheet.html'), 'utf8');
  for (const sh of shots) assert.ok(html.includes(sh.title), sh.title);
  assert.equal((html.match(/<img /g) ?? []).length, 45);
  assert.equal(html.split(`width="${shown.w}" height="${shown.h}"`).length - 1, 45);
  assert.ok(html.includes(`shown here at ${shown.scale}x`));
  assert.ok(!DASH.test(html), 'no em or en dashes on the contact sheet');
});

test('blockout-review.js: the sheet sizes stills from the internal resolution and says the scale it shows', () => {
  const sheetFor = (res) => contactSheetHtml({
    round: '02', info: { res, fps: 24, total: 112, shots: [{ n: 1, start: 0, end: 4, title: 'Bridge', lens: 35 }] },
    stills: [{ shot: 1, which: 'first', t: 0, frame: 0, file: 'stills/shot-01-first.png' }],
  });
  for (const [res, w, h, scale] of [[{ w: 480, h: 270 }, 480, 270, 1], [{ w: 320, h: 180 }, 320, 180, 1], [{ w: 240, h: 135 }, 480, 270, 2], [{ w: 640, h: 360 }, 480, 270, 0.75]]) {
    assert.deepEqual(stillDisplay(res), { w, h, scale }, `${res.w}x${res.h}`);
    const html = sheetFor(res);
    assert.ok(html.includes(`width="${w}" height="${h}"`) && html.includes(`repeat(3, ${w}px)`) && html.includes(`shown here at ${scale}x`), `${res.w}x${res.h}`);
    assert.ok(3 * w + 2 * 10 <= 1500 - 40, `three stills of ${w} px fit the sheet`);
  }
  // control: the old fixed 480 px would claim 1x for a 320 px frame shown at 1.5 screen pixels per pixel
  assert.ok(!sheetFor({ w: 320, h: 180 }).includes('width="480"'));
});

test('no em or en dashes in the capture files', () => {
  const dash = DASH;
  for (const f of ['scripts/lib/ffmpeg.mjs', 'scripts/stills.js', 'scripts/capture.js', 'scripts/blockout-review.js', 'tests/capture.test.mjs']) {
    assert.ok(!dash.test(readFileSync(resolve(ROOT, f), 'utf8')), f);
  }
});

test('ffmpeg.mjs: the soundtrack muxes as AAC 48 kHz stereo, trimmed to the frames; no audio input means -an', () => {
  const has = (args, seq) => args.some((_, i) => seq.every((v, j) => args[i + j] === v));
  const a = encodeArgs('full', { w: 480, h: 270 }, { output: 'x.mp4', audio: { file: 's.wav', from: 10, to: 12 } });
  assert.ok(has(a, ['-i', 'pipe:0', '-ss', '10', '-to', '12', '-i', 's.wav']), a.join(' '));
  assert.ok(has(a, ['-map', '0:v:0', '-map', '1:a:0', '-c:a', 'aac', '-b:a', AUDIO.bitrate, '-ar', '48000', '-ac', '2']), a.join(' '));
  assert.ok(!a.includes('-an') && a.at(-1) === 'x.mp4');
  assert.ok(encodeArgs('full', { w: 480, h: 270 }).includes('-an'), 'control: without a soundtrack the file stays silent');
});

test('capture.js --audio: the clip carries the soundtrack from its own start, to the millisecond', async () => {
  // a test soundtrack the length of the film: quiet noise, with loud 2 ms clicks at 10.5 s and 11.25 s
  const sr = AUDIO.sampleRate, n = Math.round(T_TOTAL * sr), rng = mulberry32(5);
  const l = new Float32Array(n).map(() => (rng() - 0.5) * 0.002), r = Float32Array.from(l);
  const clicks = [10.5, 11.25];
  for (const t of clicks) for (let i = 0; i < sr / 500; i++) { l[Math.round(t * sr) + i] = 0.9 * (i % 2 ? -1 : 1); r[Math.round(t * sr) + i] = 0.9 * (i % 2 ? -1 : 1); }
  const wav = resolve(fresh('audio'), 'clicks.wav');
  writeFileSync(wav, encodeWav(l, r, sr, mulberry32(1)));
  const file = resolve(OUT, 'audio', 'preview-audio.mp4');
  const res = node('scripts/capture.js', ['--profile', 'preview', '--from', '10', '--to', '12', '--out', file, '--audio', wav]);
  assert.equal(res.code, 0, res.err + res.out);
  const p = await ffprobe(file);
  assert.deepEqual([p.audioStreams, p.audioCodec, p.audioRate, p.audioChannels, p.frames], [1, 'aac', 48000, 2, 48]);
  assert.ok(Math.abs(p.audioDuration - 2) <= 1 / FPS, `audio ${p.audioDuration} s`);
  const d = decodeAudio(file);
  const first = (from) => { for (let i = Math.round(from * sr); i < d.left.length; i++) if (Math.abs(d.left[i]) > 0.3) return i / sr; return null; };
  const got = [first(0), first(1)];
  for (let k = 0; k < clicks.length; k++) assert.ok(Math.abs(got[k] - (clicks[k] - 10)) <= 0.001, `click ${k} at ${got[k]}, want ${clicks[k] - 10}`);
  // the alignment helper agrees: the clip against the soundtrack from 10 s is lag 0, and a planted 5 ms shift is found
  const ref = { left: l.subarray(10 * sr, 12 * sr), right: r.subarray(10 * sr, 12 * sr) };
  assert.ok(Math.abs(alignment(ref, d, { i0: 0.2 * sr, i1: 1.8 * sr }).lag) <= 2);
  const late = { left: new Float32Array(d.left.length), right: new Float32Array(d.left.length) };
  late.left.set(d.left.subarray(0, d.left.length - 240), 240); late.right.set(d.right.subarray(0, d.right.length - 240), 240);
  assert.ok(Math.abs(alignment(ref, late, { i0: 0.2 * sr, i1: 1.8 * sr }).lag - 240) <= 2, 'control');
  // and a missing soundtrack is refused before any frame is drawn
  const miss = node('scripts/capture.js', ['--profile', 'preview', '--from', '10', '--to', '11', '--out', resolve(OUT, 'audio', 'none.mp4'), '--audio', resolve(OUT, 'audio', 'nope.wav')]);
  assert.notEqual(miss.code, 0);
  assert.match(miss.err, /no soundtrack at/);
});

test('mux.js: a new soundtrack goes into an exported MP4 with the picture untouched, trimmed to its frames', async () => {
  const { mux, videoHash } = await import('../scripts/mux.js');
  const sr = AUDIO.sampleRate, n = Math.round(T_TOTAL * sr);
  const l = new Float32Array(n), r = new Float32Array(n);
  for (let i = 0; i < sr / 500; i++) { l[Math.round(11.5 * sr) + i] = 0.9 * (i % 2 ? -1 : 1); r[Math.round(11.5 * sr) + i] = l[Math.round(11.5 * sr) + i]; }
  const d = fresh('mux');
  const wav = resolve(d, 'click.wav');
  writeFileSync(wav, encodeWav(l, r, sr, mulberry32(2)));
  const file = resolve(d, 'silent.mp4');
  const c = node('scripts/capture.js', ['--profile', 'preview', '--from', '10', '--to', '12', '--out', file]);
  assert.equal(c.code, 0, c.err + c.out);
  const before = videoHash(file);
  assert.equal((await ffprobe(file)).audioStreams, 0);
  await mux({ file, audio: wav, log: () => {} });
  const p = await ffprobe(file);
  assert.deepEqual([p.audioStreams, p.audioCodec, p.frames], [1, 'aac', 48]);
  assert.equal(videoHash(file), before, 'the video stream is the same bytes');
  // the sidecar says the clip starts at 10 s, so the click at 11.5 s lands 1.5 s in
  const a = decodeAudio(file);
  let at = null;
  for (let i = 0; i < a.left.length && at === null; i++) if (Math.abs(a.left[i]) > 0.3) at = i / sr;
  assert.ok(Math.abs(at - 1.5) <= 0.001, `click at ${at}`);
  assert.ok(JSON.parse(readFileSync(`${file}.json`, 'utf8')).mux.from === 10);
  // a missing soundtrack is refused and the file is left as it was
  await assert.rejects(mux({ file, audio: resolve(d, 'nope.wav'), log: () => {} }), /no soundtrack at/);
  assert.equal(videoHash(file), before);
});

// ---------- captions (ROADMAP Sound 1.10 and 2.8): --captions and --burn-captions ----------
const captionsLib = () => import('../scripts/lib/captions.js');
// every frame of a video as RGB, top row first
function frames(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 30 });
  assert.equal(r.status, 0, `decode ${file}: ${r.stderr}`);
  return r.stdout;
}
// the largest difference in each row of a w x h picture, over every frame
function rowDiff(a, b, w, h) {
  assert.equal(a.length, b.length, 'the same number of frames');
  const out = new Array(h).fill(0);
  for (let i = 0; i < a.length; i++) { const y = Math.floor(i / (w * 3)) % h, d = Math.abs(a[i] - b[i]); if (d > out[y]) out[y] = d; }
  return out;
}

test('capture.js --captions: the review track as one mov_text stream over exactly the captured frames, top left, with or without a soundtrack', async () => {
  const { reviewTrack, toVtt, probeSubtitles, subtitleText, movTextJustification } = await captionsLib();
  const d = fresh('captions');
  const vtt = resolve(d, 'review.vtt');
  writeFileSync(vtt, toVtt(reviewTrack()));
  const page = plantedPage(resolve(d, 'flat.html'));
  // 13 to 15 s: the street's bed, then at 14.000 the car's first light
  const file = resolve(d, 'soft.mp4');
  const r = node('scripts/capture.js', ['--profile', 'preview', '--from', '13', '--to', '15', '--out', file, '--file', page, '--captions', vtt]);
  assert.equal(r.code, 0, r.err + r.out);
  const s = probeSubtitles(file), p = await ffprobe(file);
  assert.deepEqual([s.streams, s.codec, s.start, p.videoStreams, p.audioStreams, p.frames], [1, 'mov_text', 0, 1, 0, 48]);
  assert.ok(Math.abs(s.duration - 2) <= 1 / FPS, `captions last ${s.duration} s, the clip 2 s`);
  const text = subtitleText(file);
  assert.match(text, /^1\n00:00:00,000 --> 00:00:01,000\n[^\n]*street: city, wind/);
  assert.match(text, /\n2\n00:00:01,000 --> 00:00:02,000\n[^\n]*the car rises out of the quiet \(new\)/);
  assert.deepEqual(movTextJustification(file), [[0, 0]], 'top left, out of the bottom band');
  const side = JSON.parse(readFileSync(`${file}.json`, 'utf8'));
  assert.deepEqual(side.problems, []);
  assert.deepEqual([side.captions.file, side.captions.burned, side.captions.subtitles.streams], [vtt, false, 1]);
  assert.ok(readdirSync(d).every((f) => !f.includes('.captions.')), 'the clip\'s caption files are cleaned up');

  // with a soundtrack (Sound 2.8): video, AAC and the captions, each its own stream
  const sr = AUDIO.sampleRate, n = Math.round(T_TOTAL * sr), silent = new Float32Array(n);
  const wav = resolve(d, 'silent.wav');
  writeFileSync(wav, encodeWav(silent, silent, sr, mulberry32(3)));
  const both = resolve(d, 'both.mp4');
  const r2 = node('scripts/capture.js', ['--profile', 'preview', '--from', '13', '--to', '15', '--out', both, '--file', page, '--captions', vtt, '--audio', wav]);
  assert.equal(r2.code, 0, r2.err + r2.out);
  const p2 = await ffprobe(both), s2 = probeSubtitles(both);
  assert.deepEqual([p2.videoStreams, p2.audioStreams, p2.audioCodec, s2.streams, s2.codec, p2.frames], [1, 1, 'aac', 1, 'mov_text', 48]);
  assert.ok(Math.abs(s2.duration - 2) <= 1 / FPS && Math.abs(p2.audioDuration - 2) <= 1 / FPS);

  // controls: without --captions no subtitle stream; a track that ends 1 s into the clip gives a stream of 1 s, so the
  // duration measured above is the track's; --burn-captions alone and a missing track are refused
  const none = resolve(d, 'none.mp4');
  assert.equal(node('scripts/capture.js', ['--profile', 'preview', '--from', '13', '--to', '15', '--out', none, '--file', page]).code, 0);
  assert.equal(probeSubtitles(none).streams, 0);
  const shortVtt = resolve(d, 'short.vtt');
  writeFileSync(shortVtt, 'WEBVTT\n\n1\n00:00:00.000 --> 00:00:14.000\nthe street\n');
  const short = resolve(d, 'short.mp4');
  assert.equal(node('scripts/capture.js', ['--profile', 'preview', '--from', '13', '--to', '15', '--out', short, '--file', page, '--captions', shortVtt]).code, 0);
  assert.ok(Math.abs(probeSubtitles(short).duration - 1) <= 1 / FPS, `a 1 s track, got ${probeSubtitles(short).duration}`);
  const lone = node('scripts/capture.js', ['--profile', 'preview', '--from', '13', '--to', '14', '--out', resolve(d, 'x.mp4'), '--file', page, '--burn-captions']);
  assert.notEqual(lone.code, 0);
  assert.match(lone.err, /--burn-captions burns the --captions track/);
  const gone = node('scripts/capture.js', ['--profile', 'preview', '--from', '13', '--to', '14', '--out', resolve(d, 'y.mp4'), '--file', page, '--captions', resolve(d, 'nope.vtt')]);
  assert.notEqual(gone.code, 0);
  assert.match(gone.err, /no captions at/);
});

test('capture.js --burn-captions: only the caption band changes; a band planted at the bottom fails the same check', async () => {
  const { reviewTrack, toVtt, toAss, parseVtt, burnFilter, STRIP, LANE, SAFE } = await captionsLib();
  const d = fresh('burn');
  const vtt = resolve(d, 'review.vtt');
  writeFileSync(vtt, toVtt(reviewTrack()));
  const page = plantedPage(resolve(d, 'flat.html'));
  // 33 to 35 s: three lines and steps in the lane, on a flat picture so any change is the burn's
  const run = (name, extra) => {
    const f = resolve(d, `${name}.mp4`);
    const r = node('scripts/capture.js', ['--profile', 'preview', '--from', '33', '--to', '35', '--out', f, '--file', page, '--captions', vtt, ...extra]);
    assert.equal(r.code, 0, r.err + r.out);
    return f;
  };
  const soft = run('soft', []), burned = run('burned', ['--burn-captions']);
  assert.equal(JSON.parse(readFileSync(`${burned}.json`, 'utf8')).captions.burned, true);
  // the encoder works in 16 px macroblocks and its deblocking filter reaches 3 px across a block edge, so a change in
  // the band may touch the rows of the blocks that hold it and 3 more (measured: rows 64 and 65 by 5 levels, then 0)
  const MB = 16, DEBLOCK = 3, blocks = Math.ceil(LANE.bottom / MB) * MB + DEBLOCK;
  const check = (other) => {
    const rows = rowDiff(frames(soft), frames(other), W, H);
    return { inBand: Math.max(...rows.slice(STRIP, LANE.bottom)), below: Math.max(...rows.slice(blocks)), bottom: Math.max(...rows.slice(H - SAFE)) };
  };
  const got = check(burned);
  // a control: the same burn moved into the bottom band, drawn over the soft capture with the same encoder settings
  const ass = toAss(parseVtt(readFileSync(vtt, 'utf8')), { from: 33, to: 35, strip: false });
  const plantedAss = resolve(d, 'planted.ass');
  writeFileSync(plantedAss, ass.replace(/\\pos\(3,11\)/g, `\\pos(3,${H - SAFE + 4})`));
  const planted = resolve(d, 'planted.mp4');
  const args = encodeArgs('preview', { w: W, h: H });
  const codec = args.slice(args.indexOf('-c:v'), args.indexOf('-pix_fmt', args.indexOf('-c:v')));
  assert.equal(spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', soft, '-map', '0:v:0', '-vf', burnFilter(plantedAss), ...codec, '-pix_fmt', 'yuv420p', ...BT709_TAGS, planted]).status, 0);
  const bad = check(planted);
  console.log(`  burn against the soft capture, largest change: in the band ${got.inBand}, below its macroblocks ${got.below}, bottom ${SAFE} rows ${got.bottom}; planted at the bottom: bottom rows ${bad.bottom}`);
  assert.ok(got.inBand > 100, 'the captions are drawn in the band');
  assert.ok(got.below <= 2 && got.bottom <= 2, 'nothing else changes (starting value: 2 levels of encoder rounding; measured 0)');
  assert.ok(bad.bottom > 100, 'control: a line burned into the bottom band shows in the same check');
});
