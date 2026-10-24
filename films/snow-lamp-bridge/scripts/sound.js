// Render the soundtrack (src/audio/) to out/sound.wav: 48 kHz stereo 16-bit, normalized, with a JSON report beside it.
// Usage: node scripts/sound.js [--out out/sound.wav] [--only ambience,car] [--raw] [--no-reverb] [--spectrogram]
//   --only renders a subset of layers (a stem), --raw skips the normalization, --spectrogram writes <out>.png too.
// Runs in Node: no browser. The player renders the same samples in a worker (src/audio/worker.js).
import { spawnSync } from 'node:child_process';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { CONFIG } from '../src/config.js';
import { renderSoundtrack, LAYERS } from '../src/audio/index.js';
import { encodeWav } from '../src/audio/wav.js';
import { mulberry32, hashString } from '../src/prng.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function renderToWav({ out = resolve(ROOT, 'out/sound.wav'), only = null, raw = false, reverb = true, spectrogram = false, log = console.log } = {}) {
  const t0 = performance.now();
  const r = renderSoundtrack(CONFIG, { only, reverb, normalize: !raw });
  const seconds = (performance.now() - t0) / 1000;
  const bytes = encodeWav(r.left, r.right, r.sr, mulberry32((CONFIG.seed ^ hashString('audio:dither')) >>> 0));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, bytes);
  const report = {
    file: out, sr: r.sr, seconds: r.left.length / r.sr, layers: only ?? LAYERS.map((m) => m.build ? m.name ?? null : null),
    renderSeconds: +seconds.toFixed(2), sha256: createHash('sha256').update(bytes).digest('hex'), stats: r.stats,
  };
  report.layers = only ?? 'all';
  writeFileSync(`${out}.json`, `${JSON.stringify(report, null, 1)}\n`);
  if (spectrogram) {
    const png = out.replace(/\.wav$/, '.png');
    const s = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', out, '-lavfi', 'showspectrumpic=s=1600x600:legend=1:scale=log:fscale=log', png]);
    if (s.status !== 0) throw new Error(`spectrogram: ${s.stderr}`);
    report.spectrogram = png;
  }
  log(`sound: ${report.seconds.toFixed(2)} s at ${r.sr} Hz in ${report.renderSeconds} s${r.stats ? `, ${r.stats.lufs} LUFS, peak ${r.stats.peakDb} dBFS (gain ${r.stats.gainDb} dB, ${r.stats.limitedSamples} samples limited)` : ' (raw)'}, ${out}`);
  return report;
}

async function main() {
  const { values: a } = parseArgs({ options: { out: { type: 'string' }, only: { type: 'string' }, raw: { type: 'boolean', default: false }, 'no-reverb': { type: 'boolean', default: false }, spectrogram: { type: 'boolean', default: false } }, strict: true });
  renderToWav({ out: a.out && resolve(a.out), only: a.only ? a.only.split(',') : null, raw: a.raw, reverb: !a['no-reverb'], spectrogram: a.spectrogram });
}

const isMain = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((e) => { console.error(`sound failed: ${e.message}`); process.exitCode = 1; });
