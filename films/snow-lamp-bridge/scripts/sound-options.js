// Sound 2.12: measure the options before asking (ROADMAP Sound 2.12; SOUND-PLAN 3.4, 3.6, 3.7, 3.13, 3.17). Each of the
// first three options is a switch in config.audio.options, off by default: a muffle on the hidden sources done the PS1
// way (a volume drop, or a swap to a pre-filtered sample), a narrower pan for sync foley, and the characters as the
// listener for level. For each, A (every switch off, today's blockout) and B (that switch on at its starting values)
// are rendered cue by cue and measured at the cues the option names; every cue the switch moves is checked against
// the ones it names, cue by cue and on the whole mix before the master. The muffle is measured with two hidden
// states: the set's (the plan's case; a car's own body does not hide its own sounds), its B, and Sound 1's onScreen
// rule (a car's own body counted), for comparison. Then each option's set of mixes (A and its Bs) is mastered
// together and clipped at the option's moment: through A's gain and one limiter curve built from the loudest mix of
// the set at each sample (lib masterOf joint), or, for the characters' listener, whose B is up to 10 dB hotter than A
// at its steps, through one static gain low enough that nothing is limited (lib masterOf still). Either way B over A
// is the option alone at every sample. The fourth option, the style-frame scene, is a table of the scenes the data
// suggests. Writes review/round-NN/decisions/decisions.json and the clips beside it (each with the
// capture's sidecar), and the mastered WAVs to out/round-NN/options/. Deterministic: the same picture gives the same
// JSON and WAV bytes.
// Usage: node scripts/sound-options.js [--round 05] [--no-clips]   (the clips need dist/: npm run build)
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { CONFIG } from '../src/config.js';
import { CUES } from '../src/audio/cues.js';
import { atStage, makeContext, renderSoundtrack } from '../src/audio/index.js';
import { encodeWav } from '../src/audio/wav.js';
import { mulberry32, hashString } from '../src/prng.js';
import { FPS } from '../src/world.js';
import { buildInput } from './sound-report.js';
import {
  SWITCHES, allOff, candidateScenes, coherenceOf, compareCues, firstPoint, hiddenSpans, listenerRow, masterOf, movedAgainstNamed, renderCue,
  levelGainChange, momentOf, muffleRow, namedListener, namedMuffle, namedSyncPan, occlusionFrom, overCeiling, panRow, preMasterWith, sceneFacts, strayDifferences, swapVoices, withOptions,
} from './lib/sound-options-lib.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rel = (p) => relative(ROOT, p);
const r = (x, d = 2) => (x === null || x === undefined || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);

// ROADMAP Sound 2.12's audibility bar (starting values): an option that moves no cue by this much is decided by the lead
export const BAR = Object.freeze({ levelDb: 1, pan: 0.1, starting: true, from: 'ROADMAP Sound 2.12: 1 dB in level or 0.1 in pan at the cue' });
// Each clip is this long, from a frame. ROADMAP Sound 2.12 asks for a short clip at each option's moment; 7 s is a
// starting value, long enough to run from the engine's first hidden frame to the car in view (14.0 to 21.0 s)
export const CLIP_SEC = 7;
// The heard parts of a long cue, for option 3's worst window: within this of its own loudest 100 ms (starting value)
const HEARD_DB = 20;

// The starting values (config.audio.options) and why each, written beside the measurements
const WHY = {
  dropDb: 'one tier of the level plan (SOUND-PLAN 1.3: a foreground sound sits at least 6 dB over the background, the midground 0 to 6 dB), so a hidden sound steps down by the gap between the two',
  lowpassHz: 'an octave under the darkest the air law reaches with distance (spatial.js SPATIAL.minAirHz, 1800 Hz), so the muffle reads as something in the way rather than far away; two 2-pole sections, as the placeholders build their bands (voices.js band)',
  rampSec: 'the backgrounds\' crossfade at the place change (timbre.js TIMBRE.crossfadeSec): no click, and done 8 ms into the frame after the one whose state changed',
  widthRatio: 'halfway between the physical pan (1) and the centre (0): a midpoint to find out whether a narrower pan is audible at all, not a designed width. It puts the frame edge at 0.12 to 0.33 by lens instead of 0.24 to 0.66 (SOUND-PLAN 3.4)',
  kinds: 'the sync foley the task and the plan name: the steps, the scuffs and the hands\' contacts (the forearms coming to rest on the parapet, the hands cupping the lighter). Cloth on the walks, turns and shifts is not a contact and keeps its pan',
  listener: 'the storyboard\'s own characters model (scripts/sound-report.js hear), so the render can be checked against what Sound 1 predicted at every cut',
};
// What a placeholder can show of each option, and what it cannot
const PLACEHOLDER = {
  muffle: {
    can: 'when the muffle acts (the frames the picture hides each source) and how much level it takes off each voice',
    cannot: 'what a real muffle sounds like. The placeholders are narrow bands: the engine\'s buzz sits at 650 Hz, under the swap\'s 900 Hz cutoff, so the swap barely touches it, while a recorded engine has the high end a swap removes. The cabin\'s clicks (5.9 kHz) lose nearly everything. The swap\'s real effect on the engine is heard only at Sound 4',
  },
  syncPan: {
    can: 'the pan itself: the spatializer pans by level alone, so a band-limited step moves exactly as a real one would',
    cannot: 'how wide the stereo image feels against real backgrounds and real steps, whose high end localizes better than a 1.25 kHz band; and whether the wide image distracts on a phone (mono there either way)',
  },
  listener: {
    can: 'every level change the model makes, cue by cue and at the moment the people appear',
    cannot: 'the balance those levels make with real sounds (SOUND-PLAN 4.4: balance is reported at Sound 2, not judged)',
  },
};

// ---------- the measurements ----------
// The muffle's two hidden states (lib occlusionFrom): 'set', the plan's muffle, hidden by the set or another body (a
// car's own body does not hide its own sounds), its B; 'all', Sound 1's onScreen rule, a car's own body counted
export const MUFFLE_VARIANTS = Object.freeze({
  set: Object.freeze({ ownBodies: false, what: 'hidden by the set or by another body: a car\'s own body does not hide its own sounds (the plan\'s muffle, the engine behind building SE; the cabin and getting out stay hidden by the car, as sounds inside it)' }),
  all: Object.freeze({ ownBodies: true, what: 'Sound 1\'s onScreen rule (storyboard check 2): hidden by any blocker, a car\'s own body counted for its own sounds (the exhaust behind the rear bumper, the passenger door behind the car), for comparison' }),
});
// Every A/B measured: { base, options: { muffle, syncPan, listener }, scenes }. Each option holds its B configs, its rows
// (one per cue it names) and its check (moved against named, and the mix's stray samples); the muffle holds both
// hidden states, each with its occlusion; scenes is option 4's table.
export function measureOptions({ log = console.log } = {}) {
  const base = allOff(atStage(CONFIG, { stage: 'blockout' })), input = buildInput(), cacheA = new Map(), ctxA = makeContext(base);
  const preA = preMasterWith(base), out = { base, options: {} };
  const check = (cfg, moved, named, occ = null) => ({ ...movedAgainstNamed(moved, named), mix: strayDifferences(preA, preMasterWith(cfg, { occlusion: occ }), named) });

  // option 1, both PS1 ways, with each hidden state, on every cue that state hides
  const variants = {};
  for (const [v, { ownBodies }] of Object.entries(MUFFLE_VARIANTS)) {
    const { occlusion, hidden } = occlusionFrom(input, CUES, { ownBodies }), named = namedMuffle(hidden), modes = {};
    for (const [mode, sw] of [['volume', SWITCHES.muffleVolume], ['swap', SWITCHES.muffleSwap]]) {
      const cfg = withOptions(base, sw), ctx = makeContext(cfg, { occlusion });
      const { moved, rows } = compareCues(ctxA, ctx, { cacheA, pad: 4096, measure: (c, a, b) => (hidden.has(c.id) ? muffleRow(c, a, b, hiddenSpans(c, hidden.get(c.id), FPS), hidden.get(c.id)) : null) });
      modes[mode] = { cfg, rows, check: check(cfg, moved, named, occlusion) };
      log(`muffle ${v} ${mode}: ${rows.length} hidden cues, moved ${moved.length}, stray ${modes[mode].check.stray.length}, mix stray samples ${modes[mode].check.mix.samples}`);
    }
    variants[v] = { occlusion, hidden, named, modes, swapVoices: swapVoices(hidden, input) };
  }
  // what Sound 1's rule hides that the set does not: frames hidden only by a cue's own body
  const { set, all } = variants;
  const beyondSet = [...all.hidden].map(([id, h]) => ({ cue: id, frames: h.hid.filter((x, j) => x && !set.hidden.get(id)?.hid[j]).length, by: [...new Set(h.by.filter((x, j) => x && !set.hidden.get(id)?.hid[j]))].join(', ') })).filter((x) => x.frames > 0);
  // the engine's placeholders over the engine clip (from its first hidden frame): how coherently the two buzzes, and the
  // buzzes with the tyres, add under A and under each muffle
  const eng = set.modes.volume.rows.filter(isEngine), e0 = Math.floor(Math.min(...eng.map((x) => x.from)) * FPS + 1e-9) / FPS, e1 = e0 + CLIP_SEC;
  const car = CUES.filter((c) => c.enabled && c.voices > 0 && c.place && ['engine', 'tyres'].includes(c.family) && c.t0 < e1 && c.t1 > e0), buzz = car.filter((c) => c.family === 'engine');
  const coh = (ctx) => { const rs = new Map(car.map((c) => [c.id, ctx === ctxA ? cacheA.get(c.id) : renderCue(c, ctx, { pad: 4096 })])); return { buzzes: r(coherenceOf(buzz.map((c) => rs.get(c.id)), e0, e1), 3), all: r(coherenceOf(car.map((c) => rs.get(c.id)), e0, e1), 3) }; };
  const coherence = { t0: e0, t1: e1, buzzes: buzz.map((c) => c.id), all: car.map((c) => c.id), A: coh(ctxA) };
  for (const [v, x] of Object.entries(variants)) coherence[v] = Object.fromEntries(Object.entries(x.modes).map(([mode, y]) => [mode, coh(makeContext(y.cfg, { occlusion: x.occlusion }))]));
  log(`engine coherence ${e0} to ${e1} s: A buzzes ${coherence.A.buzzes}, all ${coherence.A.all}; the set's swap ${coherence.set.swap.buzzes}, ${coherence.set.swap.all}`);
  out.options.muffle = { variants, beyondSet, coherence };

  // option 2, on the sync foley it names
  const cfg2 = withOptions(base, SWITCHES.syncPan), P = cfg2.audio.options.syncPan, named2 = namedSyncPan(P), set2 = new Set(named2);
  const c2 = compareCues(ctxA, makeContext(cfg2), { cacheA, pad: 4096, measure: (c, a, b) => (set2.has(c.id) ? panRow(c, a, b, P.widthRatio) : null) });
  out.options.syncPan = { cfg: cfg2, rows: c2.rows, named: named2, check: check(cfg2, c2.moved, named2) };
  log(`syncPan: ${c2.rows.length} named cues, moved ${c2.moved.length}, stray ${out.options.syncPan.check.stray.length}, mix stray samples ${out.options.syncPan.check.mix.samples}`);

  // option 3, on every placed voice still sounding once a person is out of the car
  const cfg3 = withOptions(base, SWITCHES.listener), ctx3 = makeContext(cfg3), from = firstPoint(ctx3.levelAt), named3 = namedListener(from), set3 = new Set(named3);
  const predicted = (c) => { const a = input.hear(c, c.t0, 'camera'), b = input.hear(c, c.t0, 'characters'); return a && b ? b.db - a.db : null; };
  const c3 = compareCues(ctxA, ctx3, { cacheA, pad: 4096, measure: (c, a, b) => (set3.has(c.id) ? listenerRow(c, a, b, predicted(c), HEARD_DB) : null) });
  out.options.listener = { cfg: cfg3, rows: c3.rows, named: named3, from, check: check(cfg3, c3.moved, named3) };
  // a named cue left alone must be one both listeners give the same gain throughout (both inside its law's refDist)
  const byId = new Map(CUES.map((c) => [c.id, c]));
  out.options.listener.check.stillWhy = out.options.listener.check.still.map((id) => ({ cue: id, largestGainChangeDb: r(levelGainChange(byId.get(id), ctx3.levelAt, base.audio.sr), 6) }));
  log(`listener: from ${from.toFixed(3)} s, ${c3.rows.length} named cues, moved ${c3.moved.length}, stray ${out.options.listener.check.stray.length}, mix stray samples ${out.options.listener.check.mix.samples}`);

  // option 4
  out.scenes = candidateScenes().map((s) => sceneFacts(s, input));
  return out;
}

// ---------- the summaries and the calls ----------
const top = (rows, key, n) => [...rows].sort((a, b) => Math.abs(b[key]) - Math.abs(a[key]) || (a.cue < b.cue ? -1 : 1)).slice(0, n);
const maxAbs = (rows, key) => rows.reduce((m, x) => Math.max(m, Math.abs(x[key] ?? 0)), 0);
// the value of `key` with the largest magnitude, its sign kept (0 for no rows)
const extreme = (rows, key) => rows.reduce((m, x) => (Math.abs(x[key] ?? 0) > Math.abs(m) ? x[key] : m), 0);
const call = (audible) => (audible ? 'ask the director' : 'decided: below audibility');
const isEngine = (row) => row.family === 'engine';

export function summarize(m) {
  const mu = m.options.muffle, sp = m.options.syncPan, li = m.options.listener;
  const byMode = (modes) => Object.fromEntries(Object.entries(modes).map(([mode, x]) => {
    const eng = x.rows.filter(isEngine), rest = x.rows.filter((y) => !isEngine(y));
    return [mode, {
      engine: { cues: eng.length, largestHiddenDb: extreme(eng, 'dHiddenDb'), largestCentroidOct: extreme(eng, 'dCentroidOct'), atOrOverBar: eng.filter((y) => Math.abs(y.dHiddenDb) >= BAR.levelDb).length, byBlocker: eng.map((y) => ({ cue: y.cue, parts: y.byBlocker.map((b) => ({ by: b.by, own: b.own, frames: b.frames, from: b.from, to: b.to, dHiddenDb: b.dHiddenDb })) })) },
      others: { cues: rest.length, largestHiddenDb: extreme(rest, 'dHiddenDb'), largestCentroidOct: extreme(rest, 'dCentroidOct'), atOrOverBar: rest.filter((y) => Math.abs(y.dHiddenDb) >= BAR.levelDb).length },
    }];
  }));
  const muAudible = Object.values(mu.variants).some((v) => Object.values(v.modes).some((x) => x.rows.some((y) => Math.abs(y.dHiddenDb) >= BAR.levelDb)));
  const spPan = sp.rows.filter((y) => Math.abs(y.dPan) >= BAR.pan).length, liLevel = li.rows.filter((y) => Math.abs(y.dLoudestDb) >= BAR.levelDb).length;
  return {
    muffle: { byVariant: Object.fromEntries(Object.entries(mu.variants).map(([v, x]) => [v, byMode(x.modes)])), call: call(muAudible) },
    syncPan: { cues: sp.rows.length, atOrOverBar: spPan, largestDPan: extreme(sp.rows, 'dPan'), largestDBalanceDb: extreme(sp.rows, 'dBalanceDb'), call: call(spPan > 0) },
    listener: {
      cues: li.rows.length, atOrOverBar: liLevel, worstWindowAtOrOverBar: li.rows.filter((y) => Math.abs(y.dWorstDb) >= BAR.levelDb).length,
      largest: top(li.rows, 'dLoudestDb', 10).map((y) => ({ cue: y.cue, shot: y.shot, dLoudestDb: y.dLoudestDb, predictedDb: y.predictedDb })),
      // the storyboard's prediction is at the onset: a one-shot holds it, a long cue moves with the people
      worstPredictionGapDb: { oneshots: r(maxAbs(li.rows.filter((y) => y.predictedDb !== null && y.shape === 'oneshot').map((y) => ({ g: y.dLoudestDb - y.predictedDb })), 'g'), 3), continuous: r(maxAbs(li.rows.filter((y) => y.predictedDb !== null && y.shape !== 'oneshot').map((y) => ({ g: y.dLoudestDb - y.predictedDb })), 'g'), 3) },
      call: call(liLevel > 0),
    },
  };
}

// ---------- the master, the WAVs and the clips ----------
const sha = (b) => createHash('sha256').update(b).digest('hex');
const dither = (config) => mulberry32((config.seed ^ hashString('audio:dither')) >>> 0);
function writeWav(path, x, config) {
  const bytes = encodeWav(x.left, x.right, x.sr ?? config.audio.sr, dither(config));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  return sha(bytes);
}
// The level difference of the whole mastered mix (both channels' power) and its balance difference over a window
function mixDiff(a, b, t0, t1, sr) {
  const i0 = Math.round(t0 * sr), i1 = Math.round(t1 * sr);
  let la = 0, ra = 0, lb = 0, rb = 0;
  for (let i = i0; i < i1; i++) { la += a.left[i] ** 2; ra += a.right[i] ** 2; lb += b.left[i] ** 2; rb += b.right[i] ** 2; }
  return { dLevelDb: r(10 * Math.log10((lb + rb) / (la + ra))), dBalanceDb: r(10 * Math.log10(rb / lb) - 10 * Math.log10(ra / la)) };
}

// The most a mix takes off another, sample by sample over a window (in dB, where the other is over 1e-6)
function mostTakenDb(a, b, t0, t1, sr) {
  let most = 0;
  for (let i = Math.round(t0 * sr); i < Math.round(t1 * sr); i++) for (const [x, y] of [[a.left[i], b.left[i]], [a.right[i], b.right[i]]]) if (Math.abs(x) > 1e-6) most = Math.max(most, -20 * Math.log10(Math.abs(y / x)));
  return r(most);
}
// A mix against a reference in 10 ms windows over [t0, t1) (the reference raised by `shiftDb`): how many windows, how
// many sit 1 dB and 3 dB or more under it, and the lowest. What a shared curve takes off A, window by window
const DUCK_SEC = 0.01;
function duck(ref, x, t0, t1, sr, shiftDb = 0) {
  const w = Math.round(DUCK_SEC * sr), k = 10 ** (shiftDb / 10), out = [];
  for (let i = Math.round(t0 * sr); i + w <= Math.round(t1 * sr); i += w) {
    let e0 = 0, e1 = 0;
    for (let j = i; j < i + w; j++) { e0 += ref.left[j] ** 2 + ref.right[j] ** 2; e1 += x.left[j] ** 2 + x.right[j] ** 2; }
    if (e0 > 0) out.push(10 * Math.log10((e1 + 1e-30) / (e0 * k)));
  }
  return { windows: out.length, overOneDb: out.filter((d) => d <= -1).length, overThreeDb: out.filter((d) => d <= -3).length, worstDb: r(Math.min(0, ...out)) };
}

// How each option's set is mastered (lib masterOf): 'joint', A's gain and one limiter curve from the loudest mix of
// the set at each sample, which keeps A as today's master wherever no B is louder at a peak; 'still', one static gain
// and no limiter, for the characters' listener, whose B runs up to 10 dB hotter than A at its steps, so that a joint
// curve would turn A down in step with B's steps, a pumping today's master does not have (what it would take off A
// in the clip is measured beside the still master, as `jointWouldTake`)
const MASTER = Object.freeze({ muffle: 'joint', 'sync-pan': 'joint', listener: 'still' });

// The mastered mixes as WAVs, and the moments to clip. 'a' is the A mix through its own master (the default render's
// bytes); each option's set (A and its Bs) is mastered together, by MASTER's way: 'a-<set>' is its A.
// Returns { wavs: { name: { file, sha256, over } }, sets: { set: { how, ... } }, master, moments }
export function masterAndMoments(m, wavDir, { log = console.log } = {}) {
  const { base } = m, A = base.audio, rawA = renderSoundtrack(base, { normalize: false }), master = masterOf(rawA, A), mixes = { a: master.out };
  const mu = m.options.muffle.variants;
  const sets = {
    muffle: { 'muffle-volume': [mu.set.modes.volume.cfg, mu.set.occlusion], 'muffle-swap': [mu.set.modes.swap.cfg, mu.set.occlusion], 'muffle-volume-all': [mu.all.modes.volume.cfg, mu.all.occlusion], 'muffle-swap-all': [mu.all.modes.swap.cfg, mu.all.occlusion] },
    'sync-pan': { 'sync-pan': [m.options.syncPan.cfg, null] },
    listener: { listener: [m.options.listener.cfg, null] },
  };
  const wav = (name) => { const file = resolve(wavDir, `${name}.wav`); return { file: rel(file), sha256: writeWav(file, mixes[name], base), over: overCeiling(mixes[name], A.ceilingDb) }; };
  const wavs = { a: wav('a') }, how = {}, jointA = {};
  for (const [set, bs] of Object.entries(sets)) {
    const names = Object.keys(bs), raws = names.map((k) => renderSoundtrack(bs[k][0], { normalize: false, occlusion: bs[k][1] }));
    if (MASTER[set] === 'still') {
      const j = master.still([rawA, ...raws]);
      mixes[`a-${set}`] = j.mixes[0];
      names.forEach((k, i) => { mixes[k] = j.mixes[i + 1]; });
      how[set] = { how: 'still', gainDb: j.gainDb, belowDb: j.belowDb, at: j.at };
      const jj = master.joint([rawA, ...raws]);
      jointA[set] = jj.mixes[0];
      how[set].jointWould = jj.extra;
      log(`master ${set}: one static gain for ${['A', ...names].join(', ')}, ${j.belowDb} dB under A's (the set's highest true peak at ${j.at} s), no limiter`);
    } else {
      const j = master.joint([rawA, ...raws]);
      mixes[`a-${set}`] = j.mixes[0];
      names.forEach((k, i) => { mixes[k] = j.mixes[i + 1]; });
      how[set] = { how: 'joint', ...j.extra };
      log(`master ${set}: A's gain, one curve for ${['A', ...names].join(', ')}; it takes up to ${j.extra.maxDb} dB more off A than A's own (${j.extra.samples} samples)`);
    }
    for (const k of [`a-${set}`, ...names]) wavs[k] = wav(k);
  }
  // the moments: the engine from its first hidden frame; the other hidden cues, the pan and the listener where the
  // option moves them the most (lib momentOf). The muffle's moments are its B's, the set's hidden state
  const muRows = mu.set.modes.volume.rows, eng = muRows.filter(isEngine), first = Math.min(...eng.map((x) => x.from));
  const engineAt = Math.floor(first * FPS + 1e-9) / FPS, rest = momentOf(muRows.filter((x) => !isEngine(x)), 'dHiddenDb', BAR.levelDb, CLIP_SEC, FPS);
  const pan = momentOf(m.options.syncPan.rows, 'dPan', BAR.pan, CLIP_SEC, FPS), lis = momentOf(m.options.listener.rows, 'dLoudestDb', BAR.levelDb, CLIP_SEC, FPS);
  // the engine clip in three parts: the rise out of the quiet, the intake behind building SE at full level, the intake in view
  const rise = CUES.find((c) => c.id === 'hard.arrival.car.rise').t1, intake = eng.find((x) => x.cue === 'hard.engine.car.intake').to;
  const moments = {
    muffleEngine: { t0: engineAt, t1: engineAt + CLIP_SEC, what: 'the engine from its first hidden frame (building SE, shot 3) through the car coming into view', clips: [['muffle-engine-a', 'a-muffle'], ['muffle-engine-b-volume', 'muffle-volume'], ['muffle-engine-b-swap', 'muffle-swap'], ['muffle-engine-b-volume-all', 'muffle-volume-all'], ['muffle-engine-b-swap-all', 'muffle-swap-all']], parts: [[engineAt, rise, 'the rise out of the quiet (hard.arrival.car.rise)'], [rise, intake, 'the intake behind building SE at full level'], [intake, engineAt + CLIP_SEC, 'the intake in view; the set still hides the exhaust and the tyres for a few frames, Sound 1\'s rule the exhaust behind its own car']] },
    muffleCar: { t0: rest.t0, t1: rest.t1, what: `the ${CLIP_SEC} s where the muffle takes the most off the other hidden cues (${rest.count} onsets, all hidden by the car body)`, clips: [['muffle-car-a', 'a-muffle'], ['muffle-car-b-volume', 'muffle-volume'], ['muffle-car-b-swap', 'muffle-swap']], also: ['muffle-volume-all', 'muffle-swap-all'] },
    syncPan: { t0: pan.t0, t1: pan.t1, what: `the ${CLIP_SEC} s where the sync foley's pan moves the most (${pan.count} onsets moving by ${BAR.pan} or more)`, clips: [['sync-pan-a', 'a-sync-pan'], ['sync-pan-b', 'sync-pan']] },
    listener: { t0: lis.t0, t1: lis.t1, what: `the ${CLIP_SEC} s where the levels move the most (${lis.count} onsets whose loudest 100 ms moves by ${BAR.levelDb} dB or more)`, clips: [['listener-a', 'a-listener'], ['listener-b', 'listener']] },
  };
  for (const [k, x] of Object.entries(moments)) {
    x.t0 = r(x.t0, 4); x.t1 = r(x.t1, 4);
    const a = x.clips[0][1], bs = [...x.clips.slice(1).map(([, w]) => w), ...(x.also ?? [])], set = a.slice(2);
    x.mix = Object.fromEntries(bs.map((w) => [w, mixDiff(mixes[a], mixes[w], x.t0, x.t1, A.sr)]));
    if (x.parts) x.parts = x.parts.map(([t0, t1, what]) => ({ t0: r(t0, 4), t1: r(t1, 4), what, mix: Object.fromEntries(bs.map((w) => [w, mixDiff(mixes[a], mixes[w], t0, t1, A.sr).dLevelDb])) }));
    // the set's A against the default master inside the clip: what its master took off A there, window by window. A
    // still master is a static gain under it, and then the windows say what today's limiter does to A that it does not
    x.aAgainstDefault = { ...mixDiff(mixes.a, mixes[a], x.t0, x.t1, A.sr), mostDb: mostTakenDb(mixes.a, mixes[a], x.t0, x.t1, A.sr) };
    if (how[set].how === 'still') Object.assign(x.aAgainstDefault, { todaysLimiter: duck(mixes[a], mixes.a, x.t0, x.t1, A.sr, how[set].belowDb), jointWouldTake: duck(mixes.a, jointA[set], x.t0, x.t1, A.sr) });
    else x.aAgainstDefault.windows = duck(mixes.a, mixes[a], x.t0, x.t1, A.sr);
    delete x.also;
    log(`moment ${k}: ${x.t0} to ${x.t1} s`);
  }
  return {
    wavs, sets: how, moments,
    master: { ...master.stats, ceilingDb: A.ceilingDb, targetLufs: A.targetLufs, what: 'the A mix (every switch off, the default blockout) normalized as scripts/sound.js does it, its own master giving a.wav; each option\'s set of mixes then goes through A\'s gain and one limiter curve from the loudest of the set at each sample (joint), or through one static gain low enough that none is limited (still, the characters\' listener), so B over A is the option alone and nothing passes the ceiling' },
  };
}

// The clips: capture.js at each moment over each mix (the overlay on, the preview default)
export async function makeClips(moments, wavs, dir, { log = console.log } = {}) {
  if (!existsSync(resolve(ROOT, 'dist/index.html'))) throw new Error('no dist/index.html: run npm run build first');
  const { capture } = await import('./capture.js');
  const files = {};
  for (const x of Object.values(moments)) {
    for (const [name, wav] of x.clips) {
      const out = resolve(dir, `${name}.mp4`);
      await capture({ profile: 'preview', from: x.t0, to: x.t1, out, audio: resolve(ROOT, wavs[wav].file), log });
      const side = JSON.parse(readFileSync(`${out}.json`, 'utf8'));
      files[name] = { file: rel(out), sidecar: rel(`${out}.json`), wav: wavs[wav].file, bytes: side.ffprobe.size, seconds: side.ffprobe.duration, audioSeconds: side.ffprobe.audioDuration };
    }
  }
  return files;
}

// ---------- decisions.json ----------
export function decisions(m, s, mastered, clips, dir) {
  const O = m.base.audio.options, clipsOf = (k) => mastered.moments[k].clips.map(([name]) => clips?.[name] ?? { file: rel(resolve(dir, `${name}.mp4`)), made: false });
  const moment = (k) => { const x = mastered.moments[k]; return { t0: x.t0, t1: x.t1, what: x.what, mix: x.mix, aAgainstDefault: x.aAgainstDefault }; };
  const muffle = m.options.muffle, V = muffle.variants;
  return {
    stage: 'Sound 2.12', made: 'node scripts/sound-options.js --round 05', bar: BAR, clipSeconds: CLIP_SEC,
    master: { ...mastered.master, sets: mastered.sets }, wavs: mastered.wavs,
    options: [
      {
        id: 'muffle', question: 'ROADMAP gate 2, question 3: the muffle on the hidden engine, done the PS1 way',
        definition: 'While the picture hides a placed cue\'s source (its rendered point through the frame\'s camera, a blocker between them, as Sound 1\'s onScreen check judges it), the voice is muffled, the PS1 way: volume, its volume drops by dropDb; swap, it crossfades to a copy of itself through a fixed lowpass, the pre-filtered sample a PS1 bank would hold (two voices in step while it is hidden). The hidden state is read per block and the muffle follows it over rampSec. It names every cue hidden on any frame it covers; the engine is the plan\'s case. Two hidden states: set (B, the plan\'s) and all (Sound 1\'s rule, for comparison)',
        starting: { dropDb: { v: O.muffle.dropDb, why: WHY.dropDb }, lowpassHz: { v: O.muffle.lowpassHz, why: WHY.lowpassHz }, rampSec: { v: O.muffle.rampSec, why: WHY.rampSec } },
        variants: Object.fromEntries(Object.entries(V).map(([v, x]) => [v, {
          what: MUFFLE_VARIANTS[v].what, named: x.named.length, summary: s.muffle.byVariant[v], swapVoices: x.swapVoices,
          moves: Object.fromEntries(Object.entries(x.modes).map(([k, y]) => [k, y.check])),
          rows: Object.fromEntries(Object.entries(x.modes).map(([k, y]) => [k, y.rows])),
        }])),
        beyondSet: muffle.beyondSet, coherence: muffle.coherence,
        moments: { engine: { ...moment('muffleEngine'), parts: mastered.moments.muffleEngine.parts }, car: moment('muffleCar') }, clips: [...clipsOf('muffleEngine'), ...clipsOf('muffleCar')],
        call: s.muffle.call, placeholder: PLACEHOLDER.muffle,
      },
      {
        id: 'syncPan', question: 'ROADMAP gate 2, question 3: a narrower pan for sync foley',
        definition: 'The pan of every foley cue of the kinds named (a family, or a family and its meta.kind) times widthRatio, from the camera as today; every other cue keeps its pan',
        starting: { widthRatio: { v: O.syncPan.widthRatio, why: WHY.widthRatio }, kinds: { v: O.syncPan.kinds, why: WHY.kinds } },
        named: m.options.syncPan.named.length, summary: s.syncPan, moves: m.options.syncPan.check, rows: m.options.syncPan.rows,
        moments: { pan: moment('syncPan') }, clips: clipsOf('syncPan'), call: s.syncPan.call, placeholder: PLACEHOLDER.syncPan,
      },
      {
        id: 'listener', question: 'ROADMAP gate 2, question 3: the second listener model, level from the characters and pan from the camera',
        definition: `The level of every placed voice by its own distance law from the characters' point: the mean of the cloth points (each poser's root plus 1.2 m, DESIGN.CLOTH.up) of the people out of the car, whether or not the camera sees them (the poser's presence), one person while only one is out, the camera's level before anyone is (until ${r(m.options.listener.from, 3)} s, just before A's first frame out of the car). The pan, the air lowpass and the dark behind the camera stay the camera's. A cue's level is its loudest 100 ms (the level plan's measure)`,
        starting: { listener: { v: 'characters', why: WHY.listener } },
        from: r(m.options.listener.from, 4), named: m.options.listener.named.length, summary: s.listener, moves: m.options.listener.check, rows: m.options.listener.rows,
        moments: { listener: moment('listener') }, clips: clipsOf('listener'), call: s.listener.call, placeholder: PLACEHOLDER.listener,
      },
      {
        id: 'styleFrame', question: 'ROADMAP gate 2, question 2: the style-frame scene to design first in Sound 4',
        definition: 'Runs of whole shots, up to 32 s (the default\'s 24 s and a third: a scene the director hears before the rest), chosen by rule from the cues; each with its facts from the cues and the storyboard\'s density and voices checks',
        scenes: m.scenes, call: 'ask the director', placeholder: { can: 'which cues, families, places and quiet each scene holds', cannot: 'which scene sets the style best: that is heard, at Sound 4' },
      },
    ],
  };
}

async function main() {
  const { values: a } = parseArgs({ options: { round: { type: 'string', default: '05' }, 'no-clips': { type: 'boolean', default: false } }, strict: true });
  const dir = resolve(ROOT, `review/round-${a.round}/decisions`), wavDir = resolve(ROOT, `out/round-${a.round}/options`);
  const m = measureOptions(), s = summarize(m), mastered = masterAndMoments(m, wavDir);
  const clips = a['no-clips'] ? null : await makeClips(mastered.moments, mastered.wavs, dir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'decisions.json'), `${JSON.stringify(decisions(m, s, mastered, clips, dir), null, 1)}\n`);
  console.log(`wrote ${rel(resolve(dir, 'decisions.json'))}: muffle ${s.muffle.call}; syncPan ${s.syncPan.call}; listener ${s.listener.call}`);
}

const isMain = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((e) => { console.error(`sound-options failed: ${e.stack}`); process.exitCode = 1; });
