// Checks for the audio engine (src/audio/): determinism, the loudness meter against ffmpeg, normalization, the peak
// ceiling, stereo placement from the camera, the fade in, clicks at cuts, and the WAV file, on the default stage
// (config.audio.stage); the stage switch and the parking (SOUND-PLAN 3.1, 4.4); the sidecar scripts/sound.js writes
// and how verify.js reads it. Each has a planted fault. Run: node --test tests/audio.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CONFIG } from '../src/config.js';
import { SHOTS } from '../src/shots.js';
import { T_TOTAL } from '../src/world.js';
import { mulberry32 } from '../src/prng.js';
import { STAGES, atStage, buildLayers, layerNames, renderSoundtrack } from '../src/audio/index.js';
import { renderAll } from '../src/audio/mix.js';
import { integratedLufs, normalize, samplePeak } from '../src/audio/loudness.js';
import { listenerAt, placeAt } from '../src/audio/spatial.js';
import { encodeWav } from '../src/audio/wav.js';
import { rms, db } from '../scripts/lib/audio-analysis.mjs';
import { renderToWav } from '../scripts/sound.js';
import { LEGACY_SOUND, madeBy } from '../scripts/verify.js';

const SR = CONFIG.audio.sr;
const dir = mkdtempSync(join(tmpdir(), 'audio-test-'));
let full = null;
const master = () => (full ??= renderSoundtrack(CONFIG));
const hash = (a, b) => createHash('sha256').update(Buffer.from(a.buffer)).update(Buffer.from(b.buffer)).digest('hex');

// ffmpeg's EBU R128 meter on a WAV: { I, TP }
function ffmpegLoudness(left, right) {
  const f = join(dir, `m${Math.round(left[1000] * 1e9)}-${left.length}.wav`);
  writeFileSync(f, encodeWav(left, right, SR, mulberry32(1)));
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', f, '-af', 'ebur128=peak=true:framelog=quiet', '-f', 'null', '-'], { encoding: 'utf8' });
  const I = Number(/I:\s+(-?[\d.]+) LUFS/.exec(r.stderr)?.[1]);
  const TP = Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(r.stderr)?.[1]);
  return { I, TP };
}

// a test signal: stereo noise with a level that steps, so the gating matters
function steppedNoise(seconds, seed = 7) {
  const rng = mulberry32(seed), n = seconds * SR, l = new Float32Array(n), r = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const g = [0.05, 0.3, 0.01, 0.15][Math.floor(i / SR / 2) % 4];
    l[i] = (rng() * 2 - 1) * g; r[i] = (rng() * 2 - 1) * g * 0.7;
  }
  return [l, r];
}

test('determinism: two renders of the soundtrack give the same samples', () => {
  const a = master(), b = renderSoundtrack(CONFIG);
  assert.equal(hash(a.left, a.right), hash(b.left, b.right));
  assert.equal(a.left.length, Math.round(T_TOTAL * SR));
  // control: another seed is another soundtrack (the stage's first layer, a stem)
  const only = layerNames(CONFIG).slice(0, 1);
  const other = renderSoundtrack({ ...CONFIG, seed: CONFIG.seed + 1 }, { only, normalize: false });
  const same = renderSoundtrack(CONFIG, { only, normalize: false });
  assert.notEqual(hash(other.left, other.right), hash(same.left, same.right));
});

test('loudness meter agrees with ffmpeg ebur128 within 0.2 LU, and tracks gain exactly', () => {
  const [l, r] = steppedNoise(12);
  const ours = integratedLufs(l, r), ref = ffmpegLoudness(l, r).I;
  assert.ok(Math.abs(ours - ref) < 0.2, `ours ${ours} ffmpeg ${ref}`);
  const l2 = l.map((v) => v * 2), r2 = r.map((v) => v * 2);
  assert.ok(Math.abs(integratedLufs(l2, r2) - ours - 6.0206) < 0.01, 'doubling the signal adds 6.02 LU');
  // a 1 kHz sine at -20 dBFS on both channels reads about -20 + 3.01 - 0.69 + the K-weighting at 1 kHz (+0.69)
  const s = new Float32Array(SR * 4).map((_, i) => 0.1 * Math.sin(2 * Math.PI * 1000 * i / SR));
  assert.ok(Math.abs(integratedLufs(s, s) - ffmpegLoudness(s, s).I) < 0.2);
});

test('normalize lands on the target and holds every sample under the ceiling', () => {
  const [l, r] = steppedNoise(12, 9).map((ch) => ch.map((v) => v * 0.2));
  // a few loud 5 ms bursts (a door slam's crest factor): the loudness hardly sees them, the ceiling must catch them
  for (const at of [1.5, 4.2, 7.7, 10.1]) for (let i = 0; i < SR / 200; i++) { const k = Math.round(at * SR) + i; l[k] = 0.5 * Math.sign(l[k] || 1); r[k] = -0.45 * Math.sign(r[k] || 1); }
  const st = normalize(l, r, { targetLufs: -16, ceilingDb: -2 });
  assert.ok(Math.abs(st.lufs + 16) < 0.15, `lufs ${st.lufs}`);
  assert.ok(samplePeak(l, r) <= 10 ** (-2 / 20) + 1e-6, `peak ${st.peakDb}`);
  // control: without the limiter this signal would go over the ceiling
  assert.ok(st.peakBeforeLimitDb > 0, `the test signal really needed limiting (${st.peakBeforeLimitDb} dB)`);
});

test('the finished soundtrack: -16 LUFS integrated and a true peak at or under -1.5 dBTP (ffmpeg)', () => {
  const m = master();
  const ref = ffmpegLoudness(m.left, m.right);
  assert.ok(Math.abs(ref.I - CONFIG.audio.targetLufs) <= 0.2, `integrated ${ref.I}`);
  assert.ok(ref.TP <= -1.5, `true peak ${ref.TP}`);
});

test('placement: a source to the camera\'s right pans right, behind is quieter and darker, far is quieter', () => {
  const t = 10, L = listenerAt(t);
  const at = (dx, dz) => [L.pos[0] + L.r[0] * dx + L.f[0] * dz, L.pos[1], L.pos[2] + L.r[2] * dx + L.f[2] * dz];
  assert.ok(placeAt(at(3, 3), t).pan > 0.5, 'right');
  assert.ok(placeAt(at(-3, 3), t).pan < -0.5, 'left (control for the sign)');
  const front = placeAt(at(0, 4), t), behind = placeAt(at(0, -4), t), far = placeAt(at(0, 40), t);
  assert.ok(behind.gain < front.gain && behind.hz < front.hz, 'behind');
  assert.ok(far.gain < front.gain / 5 && far.hz < front.hz, 'far');
});

test('the fade in follows the picture: near silence at the first frame, full level after 3 s', () => {
  const m = master();
  assert.ok(db(rms(m.left, m.right, SR, 0, 0.05)) < db(rms(m.left, m.right, SR, 5, 6)) - 30);
});

test('no click at any cut: the step across each shot boundary is within the range of its neighbourhood', () => {
  const m = master();
  const check = (left) => SHOTS.slice(1).map((s) => {
    const c = Math.round(s.start * SR), around = [];
    for (let i = c - SR / 2; i < c + SR / 2; i++) if (Math.abs(i - c) > SR / 100) around.push(Math.abs(left[i] - left[i - 1]));
    around.sort((a, b) => a - b);
    const line = 2 * around[Math.floor(around.length * 0.999)] + 1e-4;
    let atCut = 0;
    for (let i = c - SR / 200; i < c + SR / 200; i++) atCut = Math.max(atCut, Math.abs(left[i] - left[i - 1]));
    return { n: s.n, ok: atCut <= line, line };
  });
  const rows = check(m.left);
  assert.deepEqual(rows.filter((x) => !x.ok), []);
  // control: a step three times over the middle cut's own line, planted at that cut, is caught there and only there
  const mid = SHOTS[Math.floor(SHOTS.length / 2)];
  const bad = Float32Array.from(m.left);
  const c = Math.round(mid.start * SR), step = 3 * rows.find((x) => x.n === mid.n).line;
  for (let i = c; i < c + SR / 100; i++) bad[i] += step;
  assert.deepEqual(check(bad).filter((x) => !x.ok).map((x) => x.n), [mid.n]);
});

test('the WAV: 16-bit PCM stereo at 48 kHz, the right length, readable by ffprobe', () => {
  const m = master();
  const f = join(dir, 'sound.wav');
  writeFileSync(f, encodeWav(m.left, m.right, SR, mulberry32(3)));
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', f], { encoding: 'utf8' });
  const s = JSON.parse(r.stdout).streams[0];
  assert.deepEqual([s.codec_name, Number(s.sample_rate), s.channels], ['pcm_s16le', 48000, 2]);
  assert.ok(Math.abs(Number(s.duration) - T_TOTAL) < 1e-3);
  assert.equal(readFileSync(f).length, 44 + 4 * m.left.length);
});

// ---------- the stage switch and the parking (SOUND-PLAN 3.1, 4.4) ----------
test('stages: each builds its own layers in mix order, minus the parked ones; an unknown stage or layer is refused', () => {
  const names = (stage, parked) => layerNames(atStage(CONFIG, { stage, parked }));
  assert.deepEqual(names('design', ['score']), ['ambience', 'car', 'foley']);
  assert.deepEqual(names('design', []), ['ambience', 'car', 'foley', 'score'], 'the score comes back when unparked');
  assert.deepEqual(buildLayers(atStage(CONFIG, { stage: 'design' }), ['car', 'foley']).map((l) => l.name), ['car', 'foley']);
  for (const [stage, mods] of Object.entries(STAGES)) for (const name of Object.keys(mods)) assert.equal(typeof mods[name].build, 'function', `${stage} ${name}`);
  // controls: a stage that does not exist, and a stem naming another stage's layer
  assert.throws(() => names('look', []), /audio stage 'look'/);
  assert.throws(() => layerNames(atStage(CONFIG, { stage: 'design' }), ['nope']), /no layer 'nope' in the design stage/);
});

test('parking: the score is parked by default and the music bus renders silence; a planted enabled score is heard', () => {
  assert.ok(CONFIG.audio.parked.includes('score'), 'parked by default (SOUND-PLAN 3.1)');
  // everything a config builds that goes to the music bus, mixed alone
  const musicPeak = (config) => {
    const r = renderAll({ layers: buildLayers(config).filter((l) => l.bus === 'music'), config, sr: SR, total: T_TOTAL, reverb: false, normalize: false });
    return samplePeak(r.left, r.right);
  };
  const design = atStage(CONFIG, { stage: 'design' });
  assert.equal(musicPeak(design), 0, 'the design stage with the score parked');
  assert.deepEqual(layerNames(design, ['score']), [], 'a stem of a parked layer is empty: the parking holds for stems');
  // control: the score planted back in, enabled, is heard on the music bus
  assert.ok(musicPeak(atStage(design, { parked: [] })) > 1e-3);
});

test('sidecar: scripts/sound.js names the stage, the parked and the built layers; both files are the same bytes every run', () => {
  const out = join(dir, 'stem.wav'), run = () => {
    renderToWav({ out, stage: 'design', only: ['ambience'], raw: true, log: () => {} });
    return [readFileSync(out), readFileSync(`${out}.json`)];
  };
  const [wav1, json1] = run(), [wav2, json2] = run();
  assert.ok(wav1.equals(wav2) && json1.equals(json2), 'no clock in either file');
  const side = JSON.parse(json1);
  assert.deepEqual([side.stage, side.parked, side.layers], ['design', CONFIG.audio.parked, ['ambience']]);
  assert.equal(side.renderSeconds, undefined, 'render time is not written: it differs every run');
});

test('verify check 5: a sidecar without stage or parked was made before the stage switch, score in', () => {
  // the S8.3 listening copy's sidecar has neither field
  const s83 = { file: 'out/sound.wav', sr: SR, seconds: T_TOTAL, layers: 'all', renderSeconds: 11.86, sha256: 'f80b1542', stats: {} };
  const legacy = madeBy(s83);
  assert.deepEqual(legacy, { ...LEGACY_SOUND, parked: [] });
  assert.deepEqual(layerNames(atStage(CONFIG, legacy)), ['ambience', 'car', 'foley', 'score'], 'rendered again with the S8.3 layers');
  assert.ok(legacy.made.includes('before the stage switch'));
  // a sidecar with the fields is read as written; no sidecar is the config as it is
  assert.deepEqual(madeBy({ ...s83, stage: 'blockout', parked: ['score'] }).stage, 'blockout');
  assert.deepEqual(madeBy({ ...s83, stage: 'design', parked: [] }).parked, []);
  assert.deepEqual([madeBy(null).stage, madeBy(null).parked], [CONFIG.audio.stage, CONFIG.audio.parked]);
  // controls: only one missing field is enough; a written stage is never overridden by the legacy reading
  assert.equal(madeBy({ ...s83, stage: 'blockout' }).made, LEGACY_SOUND.made);
  assert.notEqual(madeBy({ ...s83, stage: 'blockout', parked: [] }).made, LEGACY_SOUND.made);
});
