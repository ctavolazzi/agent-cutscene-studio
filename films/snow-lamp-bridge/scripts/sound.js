// Render the soundtrack (src/audio/) to out/sound.wav: 48 kHz stereo 16-bit, normalized, with a JSON report beside it.
// Usage: node scripts/sound.js [--out out/sound.wav] [--stage blockout|design] [--parked score,car] [--only bg,hard]
//        [--raw] [--no-reverb] [--spectrogram]
//   --stage and --parked override config.audio's (--parked '' parks nothing), --only renders a subset of the stage's
//   layers (a stem), --raw skips the normalization, --spectrogram writes <out>.png too.
// Runs in Node: no browser. The player renders the same samples in a worker (src/audio/worker.js). Both files it writes
// are the same bytes on every run: no clock is read (time a render from the shell).
import { spawnSync } from 'node:child_process';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { CONFIG } from '../src/config.js';
import { atStage, layerNames, renderSoundtrack } from '../src/audio/index.js';
import { LEVEL } from '../src/audio/layers/blockout/timbre.js';
import { normalize, targetOf } from '../src/audio/loudness.js';
import { encodeWav } from '../src/audio/wav.js';
import { mulberry32, hashString } from '../src/prng.js';
import { SHOTS } from '../src/shots.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// What the master's limiter takes off each shot: per window of the level plan's 100 ms, the raw mix's peak times the
// normalization's gain against the output's peak, in dB; the largest in each shot, and where. The gain is read from
// the samples (the largest output over raw ratio: the limiter only takes off), not from normalize's report. A click's
// peak sits about 20 dB over its level (voices.js), so a fixed integrated target can limit hard (SOUND-PLAN 3.18).
export function limiterByShot(raw, out, sr, shots = SHOTS, windowSec = LEVEL.windowSec) {
  let g = 0;
  for (let i = 0; i < raw.left.length; i++) {
    if (Math.abs(raw.left[i]) > 1e-4) g = Math.max(g, out.left[i] / raw.left[i]);
    if (Math.abs(raw.right[i]) > 1e-4) g = Math.max(g, out.right[i] / raw.right[i]);
  }
  const w = Math.round(windowSec * sr), rows = [];
  for (let a = 0; a < raw.left.length; a += w) {
    let pr = 0, po = 0;
    for (let i = a; i < Math.min(raw.left.length, a + w); i++) { pr = Math.max(pr, Math.abs(raw.left[i]), Math.abs(raw.right[i])); po = Math.max(po, Math.abs(out.left[i]), Math.abs(out.right[i])); }
    rows.push({ t: a / sr, db: po > 0 ? Math.max(0, 20 * Math.log10(pr * g / po)) : 0 });
  }
  return shots.map((s) => {
    const r = rows.filter((x) => x.t >= s.start && x.t < s.end), top = r.reduce((m, x) => (x.db > m.db ? x : m), r[0]);
    const maxDb = +top.db.toFixed(2);
    return { shot: s.n, maxDb, at: maxDb > 0 ? +top.t.toFixed(1) : null };
  });
}

// The sidecar names the stage, the parked layers and the loudness target the stage normalizes to, so verify.js can
// render the same soundtrack again (check 5), and what the limiter took off each shot. The raw mix is normalized here
// exactly as renderAll would, so the bytes match.
export function renderToWav({ out = resolve(ROOT, 'out/sound.wav'), stage, parked, only = null, raw = false, reverb = true, spectrogram = false, log = console.log } = {}) {
  const config = atStage(CONFIG, { stage, parked });
  const r = renderSoundtrack(config, { only, reverb, normalize: false });
  const before = raw ? null : { left: Float32Array.from(r.left), right: Float32Array.from(r.right) };
  const stats = raw ? null : normalize(r.left, r.right, config.audio, r.sr);
  const bytes = encodeWav(r.left, r.right, r.sr, mulberry32((config.seed ^ hashString('audio:dither')) >>> 0));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, bytes);
  const report = {
    file: out, sr: r.sr, seconds: r.left.length / r.sr, stage: config.audio.stage, parked: config.audio.parked,
    layers: layerNames(config, only), only: only ?? null, raw, reverb, targetLufs: raw ? null : targetOf(config.audio), sha256: createHash('sha256').update(bytes).digest('hex'), stats,
    limiter: before ? limiterByShot(before, r, r.sr) : null,
  };
  if (spectrogram) {
    const png = out.replace(/\.wav$/, '.png');
    const s = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', out, '-lavfi', 'showspectrumpic=s=1600x600:legend=1:scale=log:fscale=log', png]);
    if (s.status !== 0) throw new Error(`spectrogram: ${s.stderr}`);
    report.spectrogram = png;
  }
  writeFileSync(`${out}.json`, `${JSON.stringify(report, null, 1)}\n`);
  const worst = report.limiter?.reduce((m, x) => (x.maxDb > m.maxDb ? x : m));
  log(`sound: ${report.seconds.toFixed(2)} s at ${r.sr} Hz, stage ${report.stage} (${report.layers.join(', ')}; parked ${report.parked.join(', ') || 'none'})${stats ? `, ${stats.lufs} LUFS (target ${report.targetLufs}), peak ${stats.peakDb} dBFS (gain ${stats.gainDb} dB, ${stats.limitedSamples} samples limited, at most ${worst.maxDb} dB, shot ${worst.shot} at ${worst.at} s)` : ' (raw)'}, ${out}`);
  return report;
}

const list = (s) => (s === undefined ? undefined : s.split(',').filter(Boolean));

async function main() {
  const { values: a } = parseArgs({ options: { out: { type: 'string' }, stage: { type: 'string' }, parked: { type: 'string' }, only: { type: 'string' }, raw: { type: 'boolean', default: false }, 'no-reverb': { type: 'boolean', default: false }, spectrogram: { type: 'boolean', default: false } }, strict: true });
  renderToWav({ out: a.out && resolve(a.out), stage: a.stage, parked: list(a.parked), only: list(a.only) ?? null, raw: a.raw, reverb: !a['no-reverb'], spectrogram: a.spectrogram });
}

const isMain = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((e) => { console.error(`sound failed: ${e.message}`); process.exitCode = 1; });
