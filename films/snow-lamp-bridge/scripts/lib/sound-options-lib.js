// Sound 2.12, measure the options before asking (ROADMAP Sound 2.12; SOUND-PLAN 3.4, 3.6, 3.7, 3.13, 3.17): the pieces
// scripts/sound-options.js and tests/sound-options.test.mjs share. The options are switches in config.audio.options,
// all off by default. This file turns them on, renders each cue alone through the blockout's own voices, measures A
// (off) against B (on) at the cues an option names, finds every cue a switch moves, and masters A and B through one
// gain. The muffle's input, the picture's hidden state, comes from the storyboard's own screen states and blockers
// (scripts/lib/sound-checks.js, scripts/sound-report.js), handed to the render as makeContext's `occlusion`, so src/
// never reads scripts/. Deterministic: the same picture gives the same numbers.
import { CUES, LAWS, LOCATIONS } from '../../src/audio/cues.js';
import { dbToGain } from '../../src/audio/dsp.js';
import { makeEvents } from '../../src/audio/events.js';
import { buildLayers } from '../../src/audio/index.js';
import { LEVEL } from '../../src/audio/layers/blockout/timbre.js';
import { placedEvent } from '../../src/audio/layers/blockout/voices.js';
import { integratedLufs, limit, truePeakEnvelope } from '../../src/audio/loudness.js';
import { BLOCK } from '../../src/audio/mix.js';
import { placeAt } from '../../src/audio/spatial.js';
import { SHOTS } from '../../src/shots.js';
import { T_TOTAL } from '../../src/world.js';
import { averageSpectrum, centroidHz } from './audio-analysis.mjs';
import { allocate, density, framesOf, screenState } from './sound-checks.js';

const r = (x, d = 2) => (x === null || x === undefined || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);
// The cues an option can move: enabled, with a voice, placed (the backgrounds are unplaced and read no option)
export const voicedPlaced = (cues = CUES) => cues.filter((c) => c.enabled && c.voices > 0 && c.place);
const shotOf = (t) => (SHOTS.find((s) => t >= s.start && t < s.end) ?? SHOTS[SHOTS.length - 1]).n;

// ---------- the switches ----------
// A config with some options changed: each key of `patch` replaces that option, an object merged one level deep
export function withOptions(config, patch) {
  const o = { ...config.audio.options };
  for (const [k, v] of Object.entries(patch)) o[k] = v && typeof v === 'object' && !Array.isArray(v) ? { ...o[k], ...v } : v;
  return { ...config, audio: { ...config.audio, options: o } };
}
// Every switch off (as config.js ships them), and each B: one switch on at its starting values
export const allOff = (config) => withOptions(config, { muffle: { mode: 'off' }, syncPan: { on: false }, listener: 'camera' });
export const SWITCHES = Object.freeze({
  muffleVolume: Object.freeze({ muffle: { mode: 'volume' } }),
  muffleSwap: Object.freeze({ muffle: { mode: 'swap' } }),
  syncPan: Object.freeze({ syncPan: { on: true } }),
  listener: Object.freeze({ listener: 'characters' }),
});

// ---------- the hidden state, from the picture ----------
// Every placed voiced cue's hidden state as Sound 1's onScreen check judges it (sound-checks.js screenState with the
// film's blockers): on each frame the cue covers, its rendered point (where it starts for an 'onset' placement, where
// it is for a tracked one) through that frame's camera, hidden when a blocker lies between them. Returns
//   occlusion(c): null for a cue never hidden, else t -> whether the frame on screen at t hides it (before its first
//                 frame, the first one's state), the function src/audio/index.js makeContext takes
//   hidden:       id -> { f0, hid: [bool per frame], by: [blocker or null per frame] } for each cue hidden on any frame
export function occlusionFrom(input, cues = CUES) {
  const fps = input.fps, hidden = new Map();
  for (const c of voicedPlaced(cues)) {
    const p0 = c.placement === 'onset' ? c.place(c.t0) : null, frames = framesOf(c, fps, input.total);
    const states = frames.map((f) => screenState(input, c, p0 ?? c.place(f / fps), f / fps));
    if (states.some((s) => s.state === 'hidden')) hidden.set(c.id, { f0: frames[0], hid: states.map((s) => s.state === 'hidden'), by: states.map((s) => s.blocker ?? null) });
  }
  const occlusion = (c) => {
    const h = hidden.get(c.id);
    return h ? (t) => h.hid[Math.min(h.hid.length - 1, Math.max(0, Math.floor(t * fps + 1e-9) - h.f0))] : null;
  };
  return { occlusion, hidden };
}
// The stretches of its span a cue is hidden, [{ t0, t1, by }], from occlusionFrom's entry for it
export function hiddenSpans(c, h, fps) {
  const out = [];
  h.hid.forEach((yes, j) => {
    if (!yes) return;
    const a = j === 0 ? c.t0 : Math.max(c.t0, (h.f0 + j) / fps), b = Math.min(c.t1, (h.f0 + j + 1) / fps), last = out[out.length - 1];
    if (b <= a) return;
    if (last && Math.abs(last.t1 - a) < 1e-9 && last.by === h.by[j]) last.t1 = b; else out.push({ t0: a, t1: b, by: h.by[j] });
  });
  return out;
}

// ---------- one cue alone, through the blockout's own voice ----------
// The bus each category plays on (layers/blockout/: bg on 'amb', hard and foley on 'fx')
export const busOf = (c) => (c.category === 'bg' ? 'amb' : 'fx');
// A placed voiced cue's samples alone, as its layer adds them to the mix before the master: its own event (voices.js
// placedEvent, events.js, the spatializer, with whatever options the context carries) times its bus gain, in blocks on
// the mixer's grid from the block its onset falls in to the end of the block it stops in (the spatializer's lowpass
// rings on to the block's end), plus `pad` zeros. Returns { sr, i0, left, right }: index k is the film's sample i0 + k.
export function renderCue(c, ctx, { cues = CUES, pad = 0 } = {}) {
  const { sr } = ctx, busDb = ctx.config.audio.buses[busOf(c)], g = dbToGain(busDb);
  const ev = makeEvents(ctx, [placedEvent(c, cues, ctx, busDb)]);
  const s0 = Math.round(c.t0 * sr), s1 = s0 + Math.round((c.t1 - c.t0) * sr), n = Math.round(T_TOTAL * sr);
  const i0 = Math.floor(s0 / BLOCK) * BLOCK, end = Math.min(n, Math.ceil(s1 / BLOCK) * BLOCK);
  const left = new Float32Array(end - i0 + pad), right = new Float32Array(end - i0 + pad), tl = new Float32Array(BLOCK), tr = new Float32Array(BLOCK);
  for (let a = i0; a < end; a += BLOCK) {
    const m = Math.min(BLOCK, end - a);
    tl.fill(0); tr.fill(0);
    ev.process(tl, tr, a, m);
    for (let k = 0; k < m; k++) { left[a - i0 + k] = tl[k] * g; right[a - i0 + k] = tr[k] * g; }
  }
  return { sr, i0, left, right };
}
// The samples [a, b) of a cue render that fall in [t0, t1) of the film
const span = (x, t0, t1) => [Math.max(0, Math.round(t0 * x.sr) - x.i0), Math.min(x.left.length, Math.round(t1 * x.sr) - x.i0)];
// both channels' summed squares over the samples [a, b) of a cue render
const powerOf = (x, a, b) => { let s = 0; for (let i = a; i < b; i++) s += x.left[i] * x.left[i] + x.right[i] * x.right[i]; return s; };
// The level of a render over some stretches of the film, [[t0, t1], ...]: both channels' power, in dB over the street
// background (the level rule's unit, voices.js: LEVEL.refDb is the street background's RMS over both channels). Null
// when the stretches hold no sample.
export function levelDb(x, stretches) {
  let s = 0, n = 0;
  for (const [t0, t1] of stretches) { const [a, b] = span(x, t0, t1); if (b > a) { s += powerOf(x, a, b); n += b - a; } }
  return n ? 10 * Math.log10(s / n + 1e-30) - LEVEL.refDb : null;
}
// The level of its loudest LEVEL.windowSec starting inside [t0, t1) (the level plan's measure of a voice, SOUND-PLAN
// 1.3), in the same unit; a window runs past t1 into the render's own samples (a short click is measured over 100 ms)
export function loudestDb(x, t0, t1) {
  const w = Math.round(LEVEL.windowSec * x.sr), [a, b] = span(x, t0, t1), pre = new Float64Array(x.left.length + 1);
  for (let i = 0; i < x.left.length; i++) pre[i + 1] = pre[i] + x.left[i] * x.left[i] + x.right[i] * x.right[i];
  let best = 0;
  for (let i = a; i <= Math.max(a, b - 1); i++) best = Math.max(best, pre[Math.min(x.left.length, i + w)] - pre[i]);
  return 10 * Math.log10(best / w + 1e-30) - LEVEL.refDb;
}
// The levels of a render in consecutive LEVEL.windowSec windows over [t0, t1): [{ t, db }]
export function windowsDb(x, t0, t1) {
  const out = [];
  for (let t = t0; t < t1 - 1e-9; t += LEVEL.windowSec) out.push({ t, db: levelDb(x, [[t, Math.min(t1, t + LEVEL.windowSec)]]) });
  return out;
}
// Energy right over left in dB over [t0, t1): positive when the sound sits to the right (audio-analysis.mjs balanceDb,
// on a cue render's own indexing)
export function balanceOf(x, t0, t1) {
  const [a, b] = span(x, t0, t1);
  let l = 0, rr = 0;
  for (let i = a; i < b; i++) { l += x.left[i] * x.left[i]; rr += x.right[i] * x.right[i]; }
  return 10 * Math.log10((rr + 1e-20) / (l + 1e-20));
}
// The spectral centroid in Hz of a render over some stretches of the film (audio-analysis.mjs averageSpectrum and
// centroidHz, 4096-sample Hann frames: a stretch shorter than a frame is measured over one frame from its start)
export function centroidOf(x, stretches) {
  const off = x.i0 / x.sr;
  return centroidHz(averageSpectrum(x, stretches.map(([t0, t1]) => [t0 - off, t1 - off])));
}
// Two renders of one cue differ in any sample
export const differs = (a, b) => a.left.length !== b.left.length || a.left.some((v, i) => v !== b.left[i]) || a.right.some((v, i) => v !== b.right[i]);

// ---------- what a switch moves ----------
// Every placed voiced cue rendered alone under context A and context B (or only those whose ids are in `only`): the
// ids whose samples differ, and for each cue `measure(c, a, b)` (a row, or null). `cacheA` keeps A's renders across
// calls (A is the same for every option). `cues` is the catalogue the voices read their modifiers from.
export function compareCues(ctxA, ctxB, { cues = CUES, only = null, measure = null, cacheA = new Map(), pad = 0 } = {}) {
  const moved = [], rows = [];
  for (const c of voicedPlaced(cues)) {
    if (only && !only.includes(c.id)) continue;
    if (!cacheA.has(c.id)) cacheA.set(c.id, renderCue(c, ctxA, { cues, pad }));
    const a = cacheA.get(c.id), b = renderCue(c, ctxB, { cues, pad });
    if (differs(a, b)) moved.push(c.id);
    const row = measure?.(c, a, b);
    if (row) rows.push(row);
  }
  return { moved, rows };
}
// Moved against named: the cues a switch moved that it does not name (a leak), and the ones it names but left alone
export function movedAgainstNamed(moved, named) {
  const m = new Set(moved), n = new Set(named);
  return { named: n.size, moved: m.size, stray: moved.filter((id) => !n.has(id)), still: named.filter((id) => !m.has(id)) };
}
// The whole blockout before its master (layers summed into their buses, no reverb, highpass or fades: audio-analysis.mjs
// preMaster), with a context's options and occlusion: { sr, left, right }
export function preMasterWith(config, { cues = CUES, occlusion = null } = {}) {
  const layers = buildLayers(config, null, { cues, occlusion }), sr = config.audio.sr, n = Math.round(T_TOTAL * sr);
  const left = new Float32Array(n), right = new Float32Array(n), tl = new Float32Array(BLOCK), tr = new Float32Array(BLOCK);
  const gain = Object.fromEntries(Object.entries(config.audio.buses).map(([k, v]) => [k, dbToGain(v)]));
  for (let i0 = 0; i0 < n; i0 += BLOCK) {
    const m = Math.min(BLOCK, n - i0);
    for (const layer of layers) {
      tl.fill(0); tr.fill(0);
      layer.process(tl, tr, i0, m);
      const g = gain[layer.bus] ?? 1;
      for (let k = 0; k < m; k++) { left[i0 + k] += tl[k] * g; right[i0 + k] += tr[k] * g; }
    }
  }
  return { sr, left, right };
}
// The samples where two full renders differ outside every named cue's render span (renderCue's blocks): 0 when a
// switch changes the mix only where the cues it names sound. Returns { samples, first } (first: the time of the first)
export function strayDifferences(a, b, named, cues = CUES) {
  const sr = a.sr, inside = new Uint8Array(a.left.length), byId = new Map(cues.map((c) => [c.id, c]));
  for (const id of named) {
    const c = byId.get(id), s0 = Math.round(c.t0 * sr), s1 = s0 + Math.round((c.t1 - c.t0) * sr);
    inside.fill(1, Math.floor(s0 / BLOCK) * BLOCK, Math.min(inside.length, Math.ceil(s1 / BLOCK) * BLOCK));
  }
  let samples = 0, first = null;
  for (let i = 0; i < a.left.length; i++) {
    if (inside[i] || (a.left[i] === b.left[i] && a.right[i] === b.right[i])) continue;
    samples++; first ??= i / sr;
  }
  return { samples, first };
}

// ---------- what each option names ----------
// The declared sets, written from each option's definition and not from its code, so the check can catch the code.
// muffle: every cue the picture hides on any frame it covers. syncPan: the foley cues of the kinds named (a family, or
// family.kind). listener: every placed voice still sounding once the level listener has a point (`from`, its first).
export const namedMuffle = (hidden) => [...hidden.keys()];
export const namedSyncPan = (P, cues = CUES) => voicedPlaced(cues).filter((c) => c.category === 'foley' && (P.kinds.includes(c.family) || P.kinds.includes(`${c.family}.${c.meta.kind}`))).map((c) => c.id);
export const namedListener = (from, cues = CUES) => voicedPlaced(cues).filter((c) => c.t1 > from).map((c) => c.id);
// The first instant a level listener has a point (to 1e-6 s), or null when it never does
export function firstPoint(levelAt, total = T_TOTAL) {
  if (levelAt(0)) return 0;
  if (!levelAt(total - 1e-9)) return null;
  let lo = 0, hi = total - 1e-9;
  while (hi - lo > 1e-6) { const m = (lo + hi) / 2; if (levelAt(m)) hi = m; else lo = m; }
  return hi;
}

// ---------- the measurements per option ----------
// Option 1, per hidden cue: the level difference while hidden and over its whole window, the loudest 100 ms, and the
// spectral centroid while hidden, A and B
export function muffleRow(c, a, b, spans, h) {
  const framesBy = Object.fromEntries([...new Set(h.by.filter(Boolean))].sort().map((k) => [k, h.by.filter((x) => x === k).length]));
  framesBy.frames = h.hid.length;
  const st = spans.map((s) => [s.t0, s.t1]), hiddenA = levelDb(a, st), hiddenB = levelDb(b, st), ca = centroidOf(a, st), cb = centroidOf(b, st);
  return {
    cue: c.id, family: c.family, shot: shotOf(c.t0), t0: r(c.t0, 3), t1: r(c.t1, 3), framesBy,
    hiddenSec: r(st.reduce((s, [x, y]) => s + y - x, 0), 3), from: r(spans[0].t0, 3), to: r(spans[spans.length - 1].t1, 3), by: [...new Set(spans.map((s) => s.by))].join(', '),
    levelHiddenA: r(hiddenA), dHiddenDb: r(hiddenB - hiddenA), dCueDb: r(levelDb(b, [[c.t0, c.t1]]) - levelDb(a, [[c.t0, c.t1]])),
    dLoudestDb: r(loudestDb(b, c.t0, c.t1) - loudestDb(a, c.t0, c.t1)),
    centroidA: r(ca, 0), centroidB: r(cb, 0), dCentroidOct: r(Math.log2(cb / ca), 3),
  };
}
// Option 2, per named cue: the pan at its onset under each law (spatial.js placeAt, the cue's own point) and the
// balance in its stem window, A and B
export function panRow(c, a, b, width) {
  const p = c.place(c.t0), panA = placeAt(p, c.t0, undefined, LAWS[c.law]).pan, panB = placeAt(p, c.t0, undefined, { ...LAWS[c.law], width }).pan;
  const balA = balanceOf(a, c.t0, c.t1), balB = balanceOf(b, c.t0, c.t1);
  return { cue: c.id, family: c.family, shot: shotOf(c.t0), t0: r(c.t0, 3), panA: r(panA, 3), panB: r(panB, 3), dPan: r(panB - panA, 3), balanceA: r(balA), balanceB: r(balB), dBalanceDb: r(balB - balA) };
}
// Option 3, per named cue: the level difference over its whole window, at its loudest 100 ms, and the largest in any
// 100 ms window where A is within `floorDb` of its own loudest (the parts of the cue that are heard); `predicted` is
// the storyboard's (scripts/sound-report.js hear, 'characters' against 'camera', at the onset)
export function listenerRow(c, a, b, predicted, floorDb = 20) {
  const la = loudestDb(a, c.t0, c.t1), wa = windowsDb(a, c.t0, c.t1), wb = windowsDb(b, c.t0, c.t1);
  let worst = 0, at = null;
  wa.forEach((w, j) => { if (w.db !== null && w.db >= la - floorDb && Math.abs(wb[j].db - w.db) > Math.abs(worst)) { worst = wb[j].db - w.db; at = w.t; } });
  return {
    cue: c.id, family: c.family, shape: c.shape, shot: shotOf(c.t0), t0: r(c.t0, 3), t1: r(c.t1, 3), loudestA: r(la),
    dCueDb: r(levelDb(b, [[c.t0, c.t1]]) - levelDb(a, [[c.t0, c.t1]])), dLoudestDb: r(loudestDb(b, c.t0, c.t1) - la),
    dWorstDb: r(worst), worstAt: r(at, 2), predictedDb: r(predicted),
  };
}

// ---------- one master for A and every B ----------
// The A mix's master: src/audio/loudness.js normalize's passes (the gain that brings the limited mix to the target,
// then the limiter's gain curve under the ceiling), repeated here because normalize hands out neither its exact gain
// (its report rounds it) nor its gain curve. `out` is A mastered, checked against normalize in
// tests/sound-options.test.mjs sample for sample. `joint(raws)` masters a set of mixes (A and its Bs) through A's gain
// and one gain curve: the limiter's, from the loudest of them at each sample, so every mix of the set goes through
// the same gain sample for sample (B over A is the option and nothing else) and none passes the ceiling. Where a B
// is louder than A at a peak, that curve also turns A down there: `extra` says how much and where, against A's own.
// Returns { stats, out, joint(raws) -> { mixes, extra: { samples, maxDb, at } } }.
export function masterOf(rawA, { targetLufs, ceilingDb }, passes = 4) {
  const { sr } = rawA, n = rawA.left.length, peaks = truePeakEnvelope(rawA.left, rawA.right), before = integratedLufs(rawA.left, rawA.right, sr);
  const curveOf = (env, g) => { const c = new Float64Array(n).fill(1); return { c, limited: limit(c, new Float64Array(n).fill(1), dbToGain(ceilingDb), sr, undefined, undefined, env, g).reducedSamples }; };
  const run = (raw, g, curve) => {
    const left = new Float32Array(n), right = new Float32Array(n);
    for (let i = 0; i < n; i++) { left[i] = Math.fround(raw.left[i] * g) * curve[i]; right[i] = Math.fround(raw.right[i] * g) * curve[i]; }
    return { sr, left, right };
  };
  let gainDb = targetLufs - before, g = 1, own = null, lufs = before, pass = 0, out = null;
  while (pass < passes) {
    pass++;
    g = dbToGain(gainDb);
    own = curveOf(peaks, g);
    out = run(rawA, g, own.c);
    lufs = integratedLufs(out.left, out.right, sr);
    if (Math.abs(lufs - targetLufs) < 0.05) break;
    gainDb += targetLufs - lufs;
  }
  const joint = (raws) => {
    const env = Float32Array.from(peaks);
    for (const x of raws) { if (x === rawA) continue; const e = truePeakEnvelope(x.left, x.right); for (let i = 0; i < n; i++) if (e[i] > env[i]) env[i] = e[i]; }
    const { c } = curveOf(env, g);
    let samples = 0, worst = 1, at = null;
    for (let i = 0; i < n; i++) if (c[i] < own.c[i]) { samples++; if (c[i] / own.c[i] < worst) { worst = c[i] / own.c[i]; at = i / sr; } }
    return { mixes: raws.map((x) => run(x, g, c)), extra: { samples, maxDb: r(-20 * Math.log10(worst), 2), at: r(at, 3) } };
  };
  return { stats: { lufsBefore: r(before, 3), gainDb: r(20 * Math.log10(g), 3), limitedSamples: own.limited, passes: pass, lufs: r(lufs, 3) }, out, joint };
}
// The largest difference in dB a level listener makes to a cue's law gain over its span, on the block grid the
// spatializer reads it on (spatial.js placeAt with and without `levelAt`): 0 when both listeners give it the same gain
// everywhere (both within the law's refDist, for example)
export function levelGainChange(c, levelAt, sr) {
  const p0 = c.placement === 'onset' ? c.place(c.t0) : null;
  let worst = 0;
  for (let i = Math.floor(c.t0 * sr / BLOCK) * BLOCK; i <= Math.ceil(c.t1 * sr / BLOCK) * BLOCK; i += BLOCK) {
    const t = i / sr, p = p0 ?? c.place(t);
    if (!p) continue;
    const a = placeAt(p, t, undefined, LAWS[c.law]).gain, b = placeAt(p, t, undefined, { ...LAWS[c.law], levelAt }).gain;
    worst = Math.max(worst, Math.abs(20 * Math.log10(b / a)));
  }
  return worst;
}
// How far a mastered render goes over the ceiling, past float32 rounding (1e-6 of it): { samples over it, peak in dBFS }
export function overCeiling(x, ceilingDb) {
  const c = dbToGain(ceilingDb) * (1 + 1e-6);
  let samples = 0, peak = 0;
  for (let i = 0; i < x.left.length; i++) { const p = Math.max(Math.abs(x.left[i]), Math.abs(x.right[i])); if (p > c) samples++; peak = Math.max(peak, p); }
  return { samples, peakDb: r(20 * Math.log10(peak), 3) };
}

// ---------- a clip's moment ----------
// Where an option changes the most: the window of `len` seconds, starting on a frame, whose rows at or over `bar` by
// `key` (in |value|, with their onset inside it) sum to the most; ties go to more rows, then the earlier start. The
// windows tried start on each such row's onset, a quarter and a half of `len` before it. Rows need t0.
export function momentOf(rows, key, bar, len, fps, total = T_TOTAL) {
  const hits = rows.filter((x) => Math.abs(x[key]) >= bar);
  let best = null;
  for (const h of hits) {
    for (const lead of [0, len / 4, len / 2]) {
      const t0 = Math.max(0, Math.min(total - len, Math.floor((h.t0 - lead) * fps) / fps)), t1 = t0 + len;
      const inside = hits.filter((x) => x.t0 >= t0 && x.t0 < t1), sum = inside.reduce((s, x) => s + Math.abs(x[key]), 0);
      if (!best || sum > best.sum + 1e-9 || (Math.abs(sum - best.sum) <= 1e-9 && (inside.length > best.count || (inside.length === best.count && t0 < best.t0)))) best = { t0, t1, count: inside.length, sum };
    }
  }
  return best;
}
// The PS1 voices a swap muffle asks for (SOUND-PLAN 3.13): a swapped cue holds two voices for its life (the voice and
// its pre-filtered copy in step), so the demand at each onset is the voices check's plus one per sounding cue the
// picture hides. Returns { peak, at, film } against the film's own peak without it.
export function swapVoices(hidden, input, cues = CUES) {
  const voiced = cues.filter((c) => c.enabled && c.voices > 0), film = allocate(cues, input.thresholds.voiceLimit.v).peak;
  let best = { n: 0, t: 0 };
  for (const t of voiced.map((c) => c.t0)) {
    const live = voiced.filter((c) => c.t0 <= t && t < c.t1), n = live.reduce((s, c) => s + c.voices + (hidden.has(c.id) ? 1 : 0), 0);
    if (n > best.n) best = { n, t };
  }
  return { peak: best.n, at: r(best.t, 3), film: film.n, filmAt: r(film.t, 3), limit: input.thresholds.voiceLimit.v };
}

// ---------- option 4: the style-frame scene ----------
// The facts of a candidate scene [t0, t1) (SOUND-PLAN 3.17; ROADMAP Sound gate 2, question 2), from the cues and the
// storyboard's own checks on `input` (scripts/sound-report.js buildInput): the voiced families sounding in it out of
// the film's, the categories, the cues sounding and starting in it, the peak bodies (the density check's own count:
// the largest k whose runs over k - 1 bodies meet the scene) and voices (the voices check's demand at its start and at
// each onset in it), the places, the hush (the engine's run-down ending inside it, the longest stretch with only the
// backgrounds sounding, and the bed-only windows of SOUND-PLAN 3.11 it reaches), and whether it holds the film's
// densest moments (the voices' peak, and the bodies' peak).
export function sceneFacts(scene, input, { cues = CUES, bodies = bodyRuns(input) } = {}) {
  const { t0, t1 } = scene, voiced = cues.filter((c) => c.enabled && c.voices > 0);
  const live = voiced.filter((c) => c.t0 < t1 && c.t1 > t0), fams = new Set(live.map((c) => c.family)), all = new Set(voiced.map((c) => c.family));
  const demandAt = (t) => voiced.filter((c) => c.t0 <= t && t < c.t1).reduce((s, c) => s + c.voices, 0);
  const times = [t0, ...voiced.filter((c) => c.t0 >= t0 && c.t0 < t1).map((c) => c.t0)];
  const peakVoices = times.reduce((m, t) => (demandAt(t) > m.n ? { n: demandAt(t), t } : m), { n: 0, t: t0 });
  const peakBodies = Math.max(0, ...bodies.filter((x) => x.t0 < t1 && x.t1 > t0).map((x) => x.over + 1));
  // the stretches with no hard or foley cue sounding, clipped to the scene
  const busy = live.filter((c) => c.category !== 'bg').map((c) => [Math.max(t0, c.t0), Math.min(t1, c.t1)]).sort((a, b) => a[0] - b[0]);
  let quiet = { len: 0, t0: null }, edge = t0;
  for (const [a, b] of [...busy, [t1, t1]]) { if (a - edge > quiet.len) quiet = { len: a - edge, t0: edge }; edge = Math.max(edge, b); }
  const rundown = cues.find((c) => c.family === 'stop'), film = allocate(cues, input.thresholds.voiceLimit.v).peak;
  const filmBodies = Math.max(...bodies.map((x) => x.over + 1)), densest = bodies.filter((x) => x.over + 1 === filmBodies);
  return {
    name: scene.name, shots: scene.shots, t0: r(t0, 3), t1: r(t1, 3), seconds: r(t1 - t0, 3), why: scene.why,
    families: fams.size, filmFamilies: all.size, missing: [...all].filter((f) => !fams.has(f)).sort(),
    categories: [...new Set(live.map((c) => c.category))].sort(), cuesSounding: live.length, cuesStarting: times.length - 1,
    peakBodies, peakVoices: peakVoices.n, peakVoicesAt: r(peakVoices.t, 3),
    places: LOCATIONS.filter((l) => l.t0 < t1 && l.t1 > t0).map((l) => l.name),
    hush: {
      engineDies: rundown.t1 > t0 && rundown.t1 <= t1, engineDiesAt: r(rundown.t1, 3),
      longestBedOnly: r(quiet.len, 3), longestBedOnlyFrom: r(quiet.t0, 3),
      bedOnlyWindows: input.silence.windows.filter((w) => w.t0 < t1 && w.t1 > t0).map((w) => w.name),
    },
    densest: { voicesPeak: film.n, voicesPeakAt: r(film.t, 3), holdsVoicesPeak: film.t >= t0 && film.t < t1, bodiesPeak: filmBodies, holdsBodiesPeak: densest.some((x) => x.t0 < t1 && x.t1 > t0) },
  };
}
// The density check's runs for every count of bodies: [{ over, t0, t1 }], a run being where more than `over` bodies
// are in the foreground (sound-checks.js density with its report bar at each count; its ticks are computed once)
export function bodyRuns(input) {
  const own = { ...input, thresholds: { ...input.thresholds, densityReport: { ...input.thresholds.densityReport } } }, out = [];
  for (let over = 0; ; over++) {
    own.thresholds.densityReport.v = over;
    const rows = density(own).rows;
    if (!rows.length) return out;
    out.push(...rows.map((x) => ({ over, t0: x.t0, t1: x.t1 })));
  }
}
// The candidate scenes the data suggests, by rule, over runs of whole shots up to `maxSec` long: the default (shots 4
// to 6, ROADMAP gate 2); the shortest with the most families; the shortest with the most families that reaches both
// places; the shortest that holds every family the default leaves out.
export function candidateScenes(cues = CUES, maxSec = 32) {
  const voiced = cues.filter((c) => c.enabled && c.voices > 0), famsOf = (t0, t1) => new Set(voiced.filter((c) => c.t0 < t1 && c.t1 > t0).map((c) => c.family));
  const placesOf = (t0, t1) => LOCATIONS.filter((l) => l.t0 < t1 && l.t1 > t0).length;
  const runs = [];
  for (let a = 0; a < SHOTS.length; a++) for (let b = a; b < SHOTS.length; b++) {
    const t0 = SHOTS[a].start, t1 = SHOTS[b].end;
    if (t1 - t0 <= maxSec + 1e-9) runs.push({ shots: [SHOTS[a].n, SHOTS[b].n], t0, t1, fams: famsOf(t0, t1), places: placesOf(t0, t1) });
  }
  const best = (list) => list.reduce((m, x) => (!m || x.fams.size > m.fams.size || (x.fams.size === m.fams.size && x.t1 - x.t0 < m.t1 - m.t0) ? x : m), null);
  const byShots = (x) => (x.shots[0] === x.shots[1] ? `shot ${x.shots[0]}` : `shots ${x.shots[0]} to ${x.shots[1]}`);
  const def = runs.find((x) => x.shots[0] === 4 && x.shots[1] === 6), left = [...famsOf(0, T_TOTAL)].filter((f) => !def.fams.has(f));
  const holds = runs.filter((x) => left.every((f) => x.fams.has(f))).reduce((m, x) => (!m || x.t1 - x.t0 < m.t1 - m.t0 ? x : m), null);
  const out = [
    { ...def, name: 'default', why: 'ROADMAP Sound gate 2: every category, the densest moment and the hush after the engine dies (SOUND-PLAN 3.17)' },
    { ...best(runs), name: 'most families, shortest', why: `the shortest run of whole shots up to ${maxSec} s with the most families` },
    { ...best(runs.filter((x) => x.places > 1)), name: 'both places', why: `the shortest run up to ${maxSec} s with the most families that reaches the street and the bridge` },
    { ...holds, name: 'what the default leaves out', why: `the shortest run up to ${maxSec} s holding every family the default has none of (${left.join(', ')})` },
  ];
  return out.map((x) => ({ name: x.name, shots: byShots(x), t0: x.t0, t1: x.t1, why: x.why }));
}
