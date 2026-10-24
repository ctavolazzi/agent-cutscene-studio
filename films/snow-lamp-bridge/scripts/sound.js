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
import { encodeWav } from '../src/audio/wav.js';
import { mulberry32, hashString } from '../src/prng.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// The sidecar names the stage and the parked layers, so verify.js can render the same soundtrack again (check 5).
export function renderToWav({ out = resolve(ROOT, 'out/sound.wav'), stage, parked, only = null, raw = false, reverb = true, spectrogram = false, log = console.log } = {}) {
  const config = atStage(CONFIG, { stage, parked });
  const r = renderSoundtrack(config, { only, reverb, normalize: !raw });
  const bytes = encodeWav(r.left, r.right, r.sr, mulberry32((config.seed ^ hashString('audio:dither')) >>> 0));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, bytes);
  const report = {
    file: out, sr: r.sr, seconds: r.left.length / r.sr, stage: config.audio.stage, parked: config.audio.parked,
    layers: layerNames(config, only), only: only ?? null, raw, reverb, sha256: createHash('sha256').update(bytes).digest('hex'), stats: r.stats,
  };
  if (spectrogram) {
    const png = out.replace(/\.wav$/, '.png');
    const s = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', out, '-lavfi', 'showspectrumpic=s=1600x600:legend=1:scale=log:fscale=log', png]);
    if (s.status !== 0) throw new Error(`spectrogram: ${s.stderr}`);
    report.spectrogram = png;
  }
  writeFileSync(`${out}.json`, `${JSON.stringify(report, null, 1)}\n`);
  log(`sound: ${report.seconds.toFixed(2)} s at ${r.sr} Hz, stage ${report.stage} (${report.layers.join(', ')}; parked ${report.parked.join(', ') || 'none'})${r.stats ? `, ${r.stats.lufs} LUFS, peak ${r.stats.peakDb} dBFS (gain ${r.stats.gainDb} dB, ${r.stats.limitedSamples} samples limited)` : ' (raw)'}, ${out}`);
  return report;
}

const list = (s) => (s === undefined ? undefined : s.split(',').filter(Boolean));

async function main() {
  const { values: a } = parseArgs({ options: { out: { type: 'string' }, stage: { type: 'string' }, parked: { type: 'string' }, only: { type: 'string' }, raw: { type: 'boolean', default: false }, 'no-reverb': { type: 'boolean', default: false }, spectrogram: { type: 'boolean', default: false } }, strict: true });
  renderToWav({ out: a.out && resolve(a.out), stage: a.stage, parked: list(a.parked), only: list(a.only) ?? null, raw: a.raw, reverb: !a['no-reverb'], spectrogram: a.spectrogram });
}

const isMain = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((e) => { console.error(`sound failed: ${e.message}`); process.exitCode = 1; });
