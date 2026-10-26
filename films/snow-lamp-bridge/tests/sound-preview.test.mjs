// Checks for the preview's checks (scripts/sound-preview.js, ROADMAP Sound 2.8): the audio lag against the WAV, and
// nothing drawn in the bottom 30 px, exactly before the encode and within the encoder's spread after it. Each check
// passes on a good input and fails on a planted fault.
// Run: node --test tests/sound-preview.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolve } from 'node:path';
import { BARS, MIDDLE, bandVerdict, burnAss, burnedRows, lagRows } from '../scripts/sound-preview.js';
import { BAND, FRAME, LANE, SAFE } from '../scripts/lib/captions.js';

const VTT = resolve(import.meta.dirname, '../review/round-04/captions/review.vtt');

const SR = 48000;
// two seconds of seeded noise bursts, stereo
function noise(seconds = 2, seed = 7) {
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32 - 0.5; };
  const n = seconds * SR, left = new Float32Array(n), right = new Float32Array(n);
  for (let i = 0; i < n; i++) { const g = (i % 4800) < 480 ? 1 : 0.05; left[i] = rnd() * g; right[i] = rnd() * g; }
  return { sr: SR, left, right };
}
const shifted = (x, k) => ({ sr: x.sr, left: Float32Array.from(x.left, (_, i) => x.left[i - k] ?? 0), right: Float32Array.from(x.right, (_, i) => x.right[i - k] ?? 0) });

test('lag: the WAV against itself lags 0 samples; 2 samples late still passes; 3 late fails, as does 3 early', () => {
  const a = noise(), win = [[0.5, 1.5]];
  assert.deepEqual(lagRows(a, a, win).map((x) => [x.lag, x.ok]), [[0, true]]);
  assert.deepEqual(lagRows(a, shifted(a, BARS.lagSamples), win).map((x) => [x.lag, x.ok]), [[2, true]]);
  assert.deepEqual(lagRows(a, shifted(a, 3), win).map((x) => [x.lag, x.ok]), [[3, false]]);
  assert.deepEqual(lagRows(a, shifted(a, -3), win).map((x) => [x.lag, x.ok]), [[-3, false]]);
});

// frames as decodeFrames gives them: rgb24, the frames concatenated
function frames(n, fill) {
  const w = FRAME.w, h = FRAME.h, data = Buffer.alloc(n * w * h * 3);
  for (let f = 0; f < n; f++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) data[((f * h + y) * w + x) * 3 + c] = fill(f, x, y, c);
  return { w, h, n, data };
}
test('encoded: spread everywhere and text in the band pass; text in the bottom rows fails, as does a band with nothing drawn', () => {
  const base = (f, x, y) => (x * 7 + y * 13 + f * 3) % 200, spread = (f, x, y, c) => ((x * 31 + y * 17 + f + c) % 5) - 2;
  const plain = frames(2, base);
  const text = (y0, y1) => (f, x, y, c) => Math.max(0, Math.min(255, base(f, x, y) + spread(f, x, y, c) + (y >= y0 && y < y1 && x % 6 < 3 ? 120 : 0)));
  assert.equal(bandVerdict(frames(2, text(BAND.top, BAND.top + 8)), plain).ok, true);
  assert.equal(bandVerdict(frames(2, text(FRAME.h - SAFE + 4, FRAME.h - SAFE + 12)), plain).ok, false, 'text in the bottom rows');
  assert.equal(bandVerdict(frames(2, text(0, 0)), plain).ok, false, 'nothing drawn in the band: the control fails');
  assert.ok(MIDDLE[0] >= LANE.bottom && MIDDLE[1] === FRAME.h - SAFE);
});

test('exact: the review track burned over a plain clip leaves the bottom rows and draws in the band; a planted caption at the foot draws in the bottom rows', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sound-preview-test-')), clip = join(dir, 'plain.mp4');
  try {
    const p = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc=size=${FRAME.w}x${FRAME.h}:rate=24:duration=1`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clip], { encoding: 'utf8' });
    assert.equal(p.status, 0, p.stderr);
    // the round's own track over one second of the dense stretch (SOUND-PLAN 3.16), as the capture burns it
    const ass = burnAss(VTT, 31, 32);
    assert.match(ass, /^Dialogue:/m, 'the window has captions');
    assert.deepEqual(burnedRows(clip, ass, join(dir, 'good')), { bottomSame: true, bandSame: false, ok: true });
    // the planted fault: every caption of the same track pinned to the bottom of the frame
    const foot = ass.replace(/^(Dialogue:(?:[^,]*,){9})/gm, `$1{\\an2\\pos(${FRAME.w / 2},${FRAME.h - 2})}`);
    assert.notEqual(foot, ass);
    const planted = burnedRows(clip, foot, join(dir, 'foot'));
    assert.equal(planted.bottomSame, false, 'a caption at the foot draws in the bottom rows');
    assert.equal(planted.ok, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
