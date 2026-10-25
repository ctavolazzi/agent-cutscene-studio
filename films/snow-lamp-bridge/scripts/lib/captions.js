// Captions from the sound catalogue (src/audio/cues.js), SOUND-PLAN 3.16 and 4.3, ROADMAP Sound 1.10:
// - the review track: every planned sound, enabled or offered, as WebVTT (the canonical file) and SRT. A caption comes
//   in at its cue's onset to the millisecond and stays until the later of the cue's end and its onset plus 5/6 s; steps
//   merge into one caption per walker per surface stretch, each step kept as a tick for the step lane; ids live only in
//   the soft files (the VTT cue identifier and an SRT comment); off-screen cues are in italics; new cues say "(new)",
//   offered ones "(offered)" (offered cues are disabled: shown so the director can ask for them).
// - its sticky layout in the 480x270 caption band below the HUD strip, at most 3 lines: each caption gets a line and an
//   x when it comes in and keeps both, and its width, until it goes; the ASS that burns it (libass), and the soft copy's
//   mov_text style, sized so that no player line wraps.
// - the SDH track for Sound 6: plot-pertinent cues only (cue.sdh), the source named only when off screen and not again
//   while it keeps sounding (DCMP).
// The densest moment decides how 3 lines hold everything (measured, reviewTrack().stats): 14 captions at 35.179 s, so
// lines are shared between the night and the people and none is dropped; where a busy stretch still does not fit, the
// whole stretch is condensed horizontally by one step of BAND.condense, never moment by moment. Pure: the same cues give
// the same bytes.
import { spawnSync } from 'node:child_process';
import { closeSync, openSync, readFileSync, readSync, writeFileSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import { CUES, WORLD } from '../../src/audio/cues.js';
import { CONFIG } from '../../src/config.js';
import { tcode } from '../../src/shots.js';
import { visibleFrom } from './checks.js';
import { makeCamera } from './math.js';
import { PW, PH } from './panel.js';

// ---------- the rules (SOUND-PLAN 3.16) ----------
export const MIN_EVENT = 5 / 6; // Netflix's minimum event, 20 frames at 24 fps: the shortest any caption stays up
export const SDH_MAX = 7; // Netflix's longest event: an SDH caption for a long sound stays up no longer
export const MAX_LINES = 3; // review track, lines on screen at once (starting value, SOUND-PLAN 3.16)
export const SDH_LINES = 2; // SDH, lines on screen at once (Netflix)

// ---------- the 480x270 frame (src/hud.js, SOUND-PLAN 3.16) ----------
export const FRAME = Object.freeze({ w: CONFIG.res.w, h: CONFIG.res.h });
export const STRIP = 11; // src/hud.js stripH: the HUD strip is the frame's top 11 rows
export const SAFE = FRAME.h / 9; // the bottom ninth stays empty: 120 px at 1080p, 30 px at 480x270
export const FONT = Object.freeze({ face: 'DejaVu Sans', mono: 'DejaVu Sans Mono', em: 9 }); // the HUD's own 9 px text
// The caption band: MAX_LINES lines on the strip's own 11 px pitch, from the strip down, text inset 3 px as the HUD's.
// CONDENSE: the horizontal scales a busy stretch may use, largest first, when its captions do not fit at full width.
export const BAND = Object.freeze({ top: STRIP, pitch: STRIP, margin: 3, condense: Object.freeze([1, 0.95, 0.9, 0.85]) });
// The step lane under the band, one px below it: a row per walker (`row` px, `gap` apart, `pad` inside the lane's
// ground), a `tick` px wide mark per step sliding left through a playhead at the centre of the lane right of its
// `label` column, `half` seconds either side, so a tick crosses the playhead as its boot lands.
const lane = { top: BAND.top + MAX_LINES * BAND.pitch + 1, row: 5, gap: 1, pad: 1, half: 1.5, label: 10, tick: 2 };
const walkers = Object.keys(WORLD.PEOPLE).length;
export const LANE = Object.freeze({ ...lane, bottom: lane.top + 2 * lane.pad + walkers * lane.row + (walkers - 1) * lane.gap });
if (LANE.bottom > FRAME.h - SAFE) throw new Error('captions: the band and the step lane reach the bottom safe band');
// Colours: the storyboard map's A and B (scripts/lib/map.js), the HUD's text and strip (src/hud.js), new and offered marks.
// In the burn a caption's colour names its lane (the step lane's A and B label the colours); the soft text says "A: ".
export const COLOUR = Object.freeze({ world: '#e8eefc', A: '#ffb454', B: '#6fd3ff', new: '#7ae07a', offered: '#ff8fd0', strip: '#ffd36b', dark: '#000000', playhead: '#ffffff' });
const BACK_ALPHA = 0.6; // src/hud.js: the strip's rgba(0,0,0,0.6), the opacity of every dark ground here
const OFF_TICK = 0.4; // an off-screen step's tick, dimmer, as its caption is in italics
export const SEP = ' \u00b7 '; // between captions (a middle dot); in the burn a caption not at the line's start leads with it
const GAP = '   '; // between lanes sharing a soft line
const BLANK = '\u00a0'; // an empty line above a used one, so every caption keeps its line in the soft text too
// surfaceOf (src/audio/layers/foley.js) names the snowy sidewalk 'walk' (src/set.js: "sidewalks run to x +/-6.0"),
// which reads as the verb next to "walks"; the caption says the place
const SURFACE_WORD = Object.freeze({ walk: 'sidewalk' });
const surfaceWord = (s) => SURFACE_WORD[s] ?? s;

// ---------- small helpers ----------
const ms = (t) => Math.round(t * 1000);
const persons = (w) => Object.keys(w.PEOPLE);
const laneOrder = (w) => ['world', ...persons(w)];
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, BLANK).replace(/&amp;/g, '&');
const pad = (n, k) => String(n).padStart(k, '0');
const stamp = (t, sep) => `${pad(Math.floor(t / 3600000), 2)}:${pad(Math.floor(t / 60000) % 60, 2)}:${pad(Math.floor(t / 1000) % 60, 2)}${sep}${pad(t % 1000, 3)}`;
export const vttTime = (t) => stamp(t, '.'); // t in ms
export const srtTime = (t) => stamp(t, ',');
export const frameAt = (t, fps = CONFIG.fps) => Math.ceil((t * fps) / 1000 - 1e-6); // t in ms: the first frame at or after it

// On or off screen at the onset: the cue's place through its shot's camera at t0, inside the storyboard's PW x PH frame
// (edges included). 'unplaced' for a background, which has no point; a placed cue with no point at t0 (a person not in
// the picture) is off.
export function screenOf(c, w = WORLD) {
  if (!c.place) return 'unplaced';
  const p = c.place(c.t0);
  if (!p) return 'off';
  const q = makeCamera(w.cameraAt(w.shotAt(c.t0), c.t0), PW, PH).project(p);
  return q && q[0] >= 0 && q[0] <= PW && q[1] >= 0 && q[1] <= PH ? 'on' : 'off';
}

// Seen, for the SDH: on screen as above and not behind a building from the camera (the storyboard's ground-plane sight
// line, scripts/lib/checks.js). The engine at the car's first light is in frame but behind the south-east block.
export function seenOf(c, w = WORLD) {
  if (screenOf(c, w) !== 'on') return false;
  const p = c.place(c.t0), eye = w.cameraAt(w.shotAt(c.t0), c.t0).pos;
  return visibleFrom(eye, [p[0], p[2]]);
}

// ---------- font metrics, for the layout (libass draws the same faces) ----------
const metricsCache = new Map();
// The file fontconfig gives libass for a face; `want` guards against a silent substitute where the layout needs the face
export function fontFile(face = FONT.face, { style = 'Book', want = /dejavu/i } = {}) {
  const r = spawnSync('fc-match', ['-f', '%{file}', `${face}:style=${style}`], { encoding: 'utf8' });
  if (r.status !== 0 || !r.stdout || (want && !want.test(r.stdout))) throw new Error(`captions: the ${face} font is not installed (fc-match gave ${r.stdout || r.stderr})`);
  return r.stdout;
}
// Advance widths from the TrueType tables (head, hhea, hmtx, cmap format 4) and the cell libass sizes a face by: its
// OS/2 win ascent plus descent, in ems, so a size of s draws an em of s / cell px.
export function fontMetrics(file = fontFile()) {
  if (metricsCache.has(file)) return metricsCache.get(file);
  const b = readFileSync(file), tab = {};
  for (let i = 0; i < b.readUInt16BE(4); i++) { const o = 12 + 16 * i; tab[b.toString('latin1', o, o + 4)] = b.readUInt32BE(o + 8); }
  const upm = b.readUInt16BE(tab.head + 18), nh = b.readUInt16BE(tab.hhea + 34);
  const cell = (b.readUInt16BE(tab['OS/2'] + 74) + b.readUInt16BE(tab['OS/2'] + 76)) / upm;
  const adv = (g) => b.readUInt16BE(tab.hmtx + 4 * Math.min(g, nh - 1));
  let sub = null;
  for (let i = 0; i < b.readUInt16BE(tab.cmap + 2); i++) { const o = tab.cmap + 4 + 8 * i; if (b.readUInt16BE(o) === 3 && b.readUInt16BE(o + 2) === 1) sub = tab.cmap + b.readUInt32BE(o + 4); }
  if (sub === null || b.readUInt16BE(sub) !== 4) throw new Error(`captions: no Unicode cmap in ${file}`);
  const seg = b.readUInt16BE(sub + 6) / 2, ends = sub + 14, starts = ends + 2 * seg + 2, deltas = starts + 2 * seg, ranges = deltas + 2 * seg;
  const glyph = (cp) => {
    for (let i = 0; i < seg; i++) {
      if (cp > b.readUInt16BE(ends + 2 * i)) continue;
      const s = b.readUInt16BE(starts + 2 * i), ro = b.readUInt16BE(ranges + 2 * i), d = b.readInt16BE(deltas + 2 * i);
      if (cp < s) return 0;
      if (!ro) return (cp + d) & 0xffff;
      const g = b.readUInt16BE(ranges + 2 * i + ro + 2 * (cp - s));
      return g ? (g + d) & 0xffff : 0;
    }
    return 0;
  };
  const advances = new Map(); // per code point, so a layout pass measures fast
  const advance = (cp) => { if (!advances.has(cp)) advances.set(cp, adv(glyph(cp)) / upm); return advances.get(cp); };
  // in ems, without kerning (which narrows this face's lines a little; tests/captions.test.mjs measures the drawn width)
  const width = (s) => { let sum = 0; for (const ch of s) sum += advance(ch.codePointAt(0)); return sum; };
  const m = { file, upm, cell, width, size: (em) => em * cell };
  metricsCache.set(file, m);
  return m;
}
// A line's width in px at the band's em and a horizontal scale
export const lineWidth = (text, scale = 1, m = fontMetrics()) => m.width(text) * FONT.em * scale;
export const AVAIL = FRAME.w - 2 * BAND.margin;

// ---------- the review track ----------
// The captions (one per cue; one per step stretch; one per place's background), each a chip with its text fixed for its
// life, laid out once (layout), then the moments between their changes as the soft files list them.
export function reviewTrack(cues = CUES, w = WORLD, { metrics = fontMetrics(), fps = CONFIG.fps } = {}) {
  const ids = persons(w), order = laneOrder(w);
  const doorOwner = Object.fromEntries(ids.map((id) => [Object.keys(w.DOOR_SIDE).find((tag) => w.DOOR_SIDE[tag] === w.EXIT.outSide[id]), id]));
  const laneOf = (c) => c.person ?? (c.family === 'door' ? doorOwner[c.meta.door] : 'world');
  const words = (label, lane) => { const s = label.replace(/^\[|\]$/g, ''); return lane === 'world' ? s : s.replace(new RegExp(`^${lane}('s)? `), ''); };
  const mark = (c) => (c.offered ? 'offered' : c.new ? 'new' : '');
  const caps = [];
  const add = (cs, lane, text, m, screen) => caps.push({ ids: cs.map((c) => c.id), cues: cs, lane, words: text, mark: m, italic: screen === 'off', screen, source: cs[0].source, in: ms(cs[0].t0), out: ms(Math.max(cs[cs.length - 1].t1, cs[0].t0 + MIN_EVENT)) });

  // steps: one caption per walker per surface stretch, a stretch being consecutive steps on one surface, inside one
  // walk (the walk's cloth cue spans it, ends included) or outside any, and seen the same way at each onset, so the
  // italics hold for every step it carries
  const walks = cues.filter((c) => c.family === 'moves' && c.meta?.kind === 'walk');
  const walkOf = (c) => walks.find((m) => m.person === c.person && c.t0 >= m.t0 && c.t0 <= m.t1)?.id ?? null;
  const ticks = [], runs = [];
  for (const id of ids) {
    let run = null;
    for (const c of cues.filter((x) => x.family === 'feet' && x.person === id)) {
      const screen = screenOf(c, w), key = `${c.surface}|${walkOf(c)}|${screen}`;
      ticks.push({ id: c.id, person: id, t: ms(c.t0), on: screen === 'on' });
      if (run && run.key === key) run.cues.push(c); else { run = { key, cues: [c], screen, walk: walkOf(c) }; runs.push(run); }
    }
  }
  for (const r of runs) {
    const f = r.cues[0], where = surfaceWord(f.surface);
    add(r.cues, f.person, r.walk ? `walks, ${where}` : r.cues.length > 1 ? `steps, ${where}` : words(f.label, f.person).replace(new RegExp(`, ${f.surface}$`), `, ${where}`), '', r.screen);
  }
  // a place's backgrounds sound as one bed, one caption naming them; every other cue is a caption of its own
  const beds = new Map();
  for (const c of cues) {
    if (c.family === 'feet') continue;
    if (c.category === 'bg' && c.meta?.location) { if (!beds.has(c.meta.location)) beds.set(c.meta.location, []); beds.get(c.meta.location).push(c); continue; }
    add([c], laneOf(c), words(c.label, laneOf(c)), mark(c), screenOf(c, w));
  }
  for (const [loc, cs] of beds) {
    if (cs.some((c) => c.t0 !== cs[0].t0 || c.t1 !== cs[0].t1)) throw new Error(`captions: the ${loc} backgrounds do not share one span`);
    add(cs, 'world', `${loc}: ${cs.map((c) => c.family).join(', ')}`, '', 'unplaced');
  }
  // identical captions (lane, words, mark, span, italics) read as one: the car's front and rear tyres
  const merged = [];
  for (const c of caps.sort((a, b) => a.in - b.in || (a.ids[0] < b.ids[0] ? -1 : 1))) {
    const same = merged.find((m) => m.lane === c.lane && m.words === c.words && m.mark === c.mark && m.in === c.in && m.out === c.out && m.italic === c.italic);
    if (same) { same.ids.push(...c.ids); same.cues.push(...c.cues); } else merged.push(c);
  }

  // the chips: arrivals in one frame are laid out together (the burn shows them from the same frame), the night's
  // first, then each person's, the longest staying first, so the beds hold the left of the band and a place's new bed
  // takes the old one's place
  const sep = metrics.width(SEP) * FONT.em;
  const chips = merged.map((c) => ({ ...c, frame: frameAt(c.in, fps), base: metrics.width(c.words + markText(c.mark)) * FONT.em, sep }))
    .sort((a, b) => a.frame - b.frame || order.indexOf(a.lane) - order.indexOf(b.lane) || b.out - a.out || a.in - b.in || (a.ids[0] < b.ids[0] ? -1 : 1));
  const stretches = busyStretches(chips, fps);
  layout(chips);

  // the moments: every change of what is on screen starts one; each line is a row, its chips in lane order, then in
  // onset order (a fixed order, so the soft text never reorders a line; the burn keeps each chip's x)
  const bounds = [...new Set(chips.flatMap((c) => [c.in, c.out]))].sort((a, b) => a - b);
  const slices = [];
  for (let i = 0; i + 1 < bounds.length; i++) {
    const a = bounds[i], on = chips.filter((c) => c.in <= a && c.out > a);
    if (!on.length) continue;
    const rows = Array.from({ length: MAX_LINES }, (_, r) => on.filter((c) => c.row === r).sort((p, q) => order.indexOf(p.lane) - order.indexOf(q.lane) || p.in - q.in || (p.ids[0] < q.ids[0] ? -1 : 1)));
    while (!rows[rows.length - 1].length) rows.pop();
    slices.push({ start: a, end: bounds[i + 1], rows, lines: rows.map((r) => softSegs(r)) });
  }
  ticks.sort((a, b) => a.t - b.t || (a.person < b.person ? -1 : 1));
  const densest = slices.reduce((d, s) => { const n = s.rows.flat().length; return n > d.captions ? { at: s.start, captions: n } : d; }, { at: 0, captions: 0 });
  return {
    captions: merged, chips, slices, ticks, stretches,
    stats: {
      captions: merged.length, slices: slices.length, ticks: ticks.length, cues: merged.reduce((n, c) => n + c.ids.length, 0),
      offScreen: merged.filter((c) => c.italic).length, new: merged.filter((c) => c.mark === 'new').length, offered: merged.filter((c) => c.mark === 'offered').length,
      maxLines: Math.max(...slices.map((s) => s.rows.length)), densest,
      condensed: stretches.filter((s) => s.scale < 1).map((s) => ({ from: s.chips[0].in, to: Math.max(...s.chips.map((c) => c.out)), captions: s.chips.length, scale: s.scale })),
    },
  };
}
const markText = (m) => (m ? ` (${m})` : '');

// Busy stretches: runs of chips that each arrive within MIN_EVENT (20 frames) of the one before. A stretch is condensed
// as one, every chip in it at one scale kept for its life, so the band never squeezes for a moment.
function busyStretches(chips, fps) {
  const gap = Math.round(MIN_EVENT * fps), out = [];
  for (const c of chips) {
    const s = out[out.length - 1];
    if (s && c.frame - s.last <= gap) { s.chips.push(c); s.last = c.frame; } else out.push({ first: c.frame, last: c.frame, chips: [c], scale: BAND.condense[0] });
    c.stretch = out[out.length - 1];
  }
  return out;
}

// The sticky layout: each chip takes a row and an x (whole px) when it comes in and keeps both until it goes, so nothing
// on screen moves. Its candidates are the row's start or just after a chip that shares part of its life (a chip not at
// the start leads with SEP); it goes where its lane continues, else where it leaves the least room unused (best fit).
// If a chip finds no room, its busy stretch steps down one scale and the whole layout runs again.
function layout(chips) {
  for (;;) {
    const failed = place(chips);
    if (!failed) return;
    const s = failed.stretch, k = BAND.condense.indexOf(s.scale);
    if (k + 1 >= BAND.condense.length) throw new Error(`captions: ${failed.ids[0]} at ${failed.in} ms does not fit ${MAX_LINES} lines at the narrowest scale ${s.scale}`);
    s.scale = BAND.condense[k + 1];
  }
}
// lane continues, then the least room left unused (best fit), then the upper row, then the left
const better = (a, b) => (a.cont !== b.cont ? a.cont : a.slack !== b.slack ? a.slack < b.slack : a.r !== b.r ? a.r < b.r : a.x < b.x);
function place(chips) {
  const rows = Array.from({ length: MAX_LINES }, () => []);
  for (const c of chips) {
    const s = c.stretch.scale;
    let best = null;
    for (let r = 0; r < MAX_LINES; r++) {
      const over = rows[r].filter((e) => e.out > c.in && e.in < c.out);
      for (const x of [...new Set([0, ...over.map((e) => e.x + e.w)])]) {
        const w = Math.ceil((c.base + (x > 0 ? c.sep : 0)) * s - 1e-9);
        if (x + w > AVAIL || over.some((e) => e.x < x + w && e.x + e.w > x)) continue;
        // slack: the room left unused up to the next chip on the right, or the line's end (measured: preferring the
        // leftmost open end instead fragments the lines, and the busy stretch then fails even at 0.85)
        const cand = { r, x, w, cont: over.some((e) => e.lane === c.lane && e.x + e.w === x), slack: Math.min(AVAIL, ...over.filter((e) => e.x >= x + w).map((e) => e.x)) - (x + w) };
        if (!best || better(cand, best)) best = cand;
      }
    }
    if (!best) return c;
    Object.assign(c, { row: best.r, x: best.x, w: best.w, scale: s });
    rows[best.r].push(c);
  }
  return null;
}

// A soft line: one row's chips, each lane's run led by its name ("A: "), runs apart by GAP; an empty row is BLANK
function softSegs(chips) {
  const segs = [];
  let lane = null;
  for (const c of chips) {
    if (c.lane !== lane) { if (lane !== null) segs.push({ kind: 'gap', lane: c.lane, text: GAP }); if (c.lane !== 'world') segs.push({ kind: 'prefix', lane: c.lane, text: `${c.lane}: ` }); lane = c.lane; } else segs.push({ kind: 'sep', lane, text: SEP });
    segs.push({ kind: 'phrase', lane: c.lane, text: c.words, mark: c.mark, italic: c.italic, ids: c.ids });
  }
  return segs.length ? segs : [{ kind: 'blank', lane: 'world', text: BLANK }];
}

// ---------- writers: WebVTT (canonical), SRT ----------
// A phrase in WebVTT: italics for off screen, the mark in its class; a person's run in a class span named after them
const phraseVtt = (s) => `${s.italic ? `<i>${esc(s.text)}</i>` : esc(s.text)}${s.mark ? ` <c.${s.mark}>(${s.mark})</c>` : ''}`;
function vttLine(segs) {
  let out = '', open = false;
  for (const s of segs) {
    if (s.kind === 'gap') { if (open) { out += '</c>'; open = false; } out += s.text; continue; }
    if (s.kind === 'prefix') { out += `<c.${s.lane}>`; open = true; }
    out += s.kind === 'phrase' ? phraseVtt(s) : esc(s.text);
  }
  return open ? `${out}</c>` : out;
}
const chipVtt = (c) => (c.lane === 'world' ? phraseVtt({ ...c, text: c.words }) : `<c.${c.lane}>${phraseVtt({ ...c, text: c.words })}</c>`);
// the ids on screen: a caption's joined by +, captions by a space in line order, lines by |, an empty line as -
const idsOf = (slice) => slice.rows.map((r) => (r.length ? r.map((c) => c.ids.join('+')).join(' ') : '-')).join(' | ');
// cue settings: at the top, left aligned, the whole width (nothing goes in the bottom ninth)
export const VTT_SETTINGS = 'line:0 position:0% align:start size:100%';

export function toVtt(track, { title = 'review' } = {}) {
  const s = track.stats;
  const head = ['WEBVTT', '', `NOTE ${title} track from src/audio/cues.js (scripts/lib/captions.js): ${s.captions} captions of ${s.cues} cues, at most ${MAX_LINES} lines; the cue identifiers list the ids on screen: a caption's joined by +, captions by a space, lines by |, an empty line as -`, ''];
  const ticks = ['NOTE ticks: the step lane, one per step: walker, contact in ms, on or off screen, cue id', ...track.ticks.map((k) => `${k.person} ${k.t} ${k.on ? 'on' : 'off'} ${k.id}`), ''];
  const layoutNote = ['NOTE layout: the burn, one caption a line: ids, line, x in px right of the band inset, horizontal scale, in and out in ms, text', ...track.chips.map((c) => `${c.ids.join('+')} ${c.row} ${c.x} ${c.scale} ${c.in} ${c.out} ${chipVtt(c)}`), ''];
  const body = track.slices.flatMap((sl, i) => [`${i + 1} ${idsOf(sl)}`, `${vttTime(sl.start)} --> ${vttTime(sl.end)} ${VTT_SETTINGS}`, ...sl.lines.map(vttLine), '']);
  return [...head, ...ticks, ...layoutNote, ...body].join('\n');
}

// SRT: no classes, so the lanes and marks are font colours; {\an7} puts it top left, as the VTT and the mov_text; the
// ids ride in the id attribute of empty font tags, which players drop. ffmpeg's SRT reader keeps a tag of up to 128 bytes
// (measured: 117 characters of id), and shows a longer one as text, so the ids are split over tags of at most SRT_IDS.
const SRT_IDS = 96;
export function srtComment(ids) {
  const out = [];
  let rest = ids;
  while (rest.length > SRT_IDS) {
    const cut = Math.max(rest.lastIndexOf(' ', SRT_IDS), rest.lastIndexOf('+', SRT_IDS));
    out.push(rest.slice(0, cut > 0 ? cut : SRT_IDS));
    rest = rest.slice(cut > 0 ? cut : SRT_IDS);
  }
  return [...out, rest].map((c) => `<font id="${c}"></font>`).join('');
}
function srtLine(segs) {
  let out = '', open = false;
  for (const s of segs) {
    if (s.kind === 'gap') { if (open) { out += '</font>'; open = false; } out += s.text; continue; }
    if (s.kind === 'prefix') { out += `<font color="${COLOUR[s.lane] ?? COLOUR.world}">`; open = true; }
    out += s.kind === 'phrase' ? `${s.italic ? `<i>${s.text}</i>` : s.text}${s.mark ? ` <font color="${COLOUR[s.mark]}">(${s.mark})</font>` : ''}` : s.text;
  }
  return open ? `${out}</font>` : out;
}
export const SRT_POS = '{\\an7}';
export function toSrt(track) {
  return track.slices.map((s, i) => [String(i + 1), `${srtTime(s.start)} --> ${srtTime(s.end)}`, `${SRT_POS}${srtComment(idsOf(s))}${s.lines.map(srtLine).join('\n')}`, ''].join('\n')).join('\n');
}

// ---------- reading the WebVTT back (the burn, the soft copy and capture.js read the file, not the cues) ----------
const parseTime = (s) => { const m = /^(?:(\d+):)?(\d{2}):(\d{2})\.(\d{3})$/.exec(s); if (!m) throw new Error(`captions: bad time ${s}`); return ((+(m[1] ?? 0) * 60 + +m[2]) * 60 + +m[3]) * 1000 + +m[4]; };
const LAYOUT_LINE = /^(\S+) (\d+) (\d+) ([\d.]+) (\d+) (\d+) (.+)$/;
export function parseVtt(text) {
  const blocks = text.replace(/\r\n/g, '\n').split(/\n{2,}/).map((b) => b.split('\n')).filter((b) => b.length && b[0] !== '');
  if (!/^WEBVTT/.test(blocks[0]?.[0] ?? '')) throw new Error('captions: not a WebVTT file');
  const entries = [], ticks = [], chips = [], notes = [];
  for (const b of blocks.slice(1)) {
    if (/^NOTE\b/.test(b[0])) {
      notes.push(b.join('\n'));
      if (/^NOTE ticks\b/.test(b[0])) for (const l of b.slice(1)) { const [person, t, on, id] = l.split(' '); ticks.push({ person, t: Number(t), on: on === 'on', id }); }
      if (/^NOTE layout\b/.test(b[0])) for (const l of b.slice(1)) {
        const m = LAYOUT_LINE.exec(l);
        if (!m) throw new Error(`captions: a layout line I cannot read: ${l}`);
        chips.push({ ids: m[1].split('+'), row: +m[2], x: +m[3], scale: +m[4], in: +m[5], out: +m[6], runs: parseCueLine(m[7]) });
      }
      continue;
    }
    const ti = b.findIndex((l) => l.includes('-->'));
    if (ti < 0) throw new Error(`captions: a block with no timing: ${b[0]}`);
    const [a, rest] = b[ti].split(' --> '), [e, ...settings] = rest.split(' ');
    entries.push({ id: ti ? b.slice(0, ti).join('\n') : null, start: parseTime(a), end: parseTime(e), settings: settings.join(' '), lines: b.slice(ti + 1).filter((l) => l !== '').map(parseCueLine) });
  }
  return { entries, ticks, chips, notes };
}
// A clip's soft track: the cues over [from, to) of the film (seconds), shifted to start at 0, their identifiers, settings
// and text as written. NOTE blocks are left out (the ticks and the layout are in film time; only a burn reads them).
export function clipVtt(text, from, to) {
  const blocks = text.replace(/\r\n/g, '\n').split(/\n{2,}/).map((b) => b.split('\n').filter((l) => l !== '')).filter((b) => b.length);
  if (!/^WEBVTT/.test(blocks[0]?.[0] ?? '')) throw new Error('captions: not a WebVTT file');
  const a0 = ms(from), out = ['WEBVTT', ''];
  for (const b of blocks.slice(1)) {
    const ti = b.findIndex((l) => l.includes('-->'));
    if (/^NOTE\b/.test(b[0]) || ti < 0) continue;
    const [a, rest] = b[ti].split(' --> '), [e, ...settings] = rest.split(' ');
    const s = Math.max(parseTime(a), a0), f = Math.min(parseTime(e), ms(to));
    if (s < f) out.push(...b.slice(0, ti), [`${vttTime(s - a0)} --> ${vttTime(f - a0)}`, ...settings].join(' '), ...b.slice(ti + 1), '');
  }
  return out.join('\n');
}
// A cue line into styled runs: { text, italic, lane, mark }
function parseCueLine(line) {
  const out = [], stack = [];
  let italic = false;
  for (const tok of line.split(/(<[^>]*>)/)) {
    if (!tok) continue;
    if (tok === '<i>') { italic = true; continue; }
    if (tok === '</i>') { italic = false; continue; }
    const cls = /^<c\.([\w.]+)>$/.exec(tok);
    if (cls) { stack.push(cls[1]); continue; }
    if (tok === '</c>') { stack.pop(); continue; }
    if (tok.startsWith('<')) throw new Error(`captions: unknown tag ${tok}`);
    const mark = stack.find((c) => c === 'new' || c === 'offered') ?? '';
    out.push({ text: unesc(tok), italic, lane: stack.find((c) => c !== 'new' && c !== 'offered') ?? 'world', mark });
  }
  return out;
}
export const runsText = (runs) => runs.map((r) => r.text).join('');
// A chip's drawn width in the burn (px, whole, as the layout reserved it): its text, led by SEP when not at the start
export const chipWidth = (chip, m = fontMetrics()) => Math.ceil(m.width((chip.x > 0 ? SEP : '') + runsText(chip.runs)) * FONT.em * chip.scale - 1e-9);

// ---------- the burn: ASS for libass ----------
// ASS colours are blue, green, red: &HAABBGGRR in a style, &HBBGGRR& in an override tag; alpha 0 is opaque
const bgr = (hex) => `${hex.slice(5, 7)}${hex.slice(3, 5)}${hex.slice(1, 3)}`.toUpperCase();
const styleColour = (hex) => `&H00${bgr(hex)}`, tagColour = (hex) => `&H${bgr(hex)}&`;
const tagAlpha = (opacity) => `&H${pad(Math.round((1 - opacity) * 255).toString(16).toUpperCase(), 2)}&`;
// An ASS time (centiseconds) that shows from the first frame at or after t: libass draws an event on a frame when its
// start is at or before the frame's time, so the frame's time is floored to the centisecond. t in seconds from the clip.
export function assTime(t, fps = CONFIG.fps) {
  const k = Math.max(0, Math.ceil(t * fps - 1e-6)), cs = Math.floor((k * 100) / fps + 1e-6);
  return `${Math.floor(cs / 360000)}:${pad(Math.floor(cs / 6000) % 60, 2)}:${pad(Math.floor(cs / 100) % 60, 2)}.${pad(cs % 100, 2)}`;
}
const assCs = (s) => { const m = /^(\d+):(\d{2}):(\d{2})\.(\d{2})$/.exec(s); return ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 100 + +m[4]; };
const assText = (s) => s.replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}');
const box = (w, h) => `m 0 0 l ${w} 0 ${w} ${h} 0 ${h}`;
const draw = (x, y, colour, opacity, shape) => `{\\an7\\pos(${x},${y})\\bord0\\shad0\\1c${tagColour(colour)}\\1a${tagAlpha(opacity)}\\p1}${shape}{\\p0}`;
// The x of a tick at film time `now` for a step at `t` (seconds): it crosses the playhead as the boot lands
export const laneX = (t, now) => LANE.label + (FRAME.w - LANE.label) / 2 + (t - now) * ((FRAME.w - LANE.label) / 2 / LANE.half);
// Where the burn puts a chip: its text's top left, and its dark ground (from the frame's edge for a chip at the start)
export const chipPos = (chip) => ({ x: BAND.margin + chip.x, y: BAND.top + chip.row * BAND.pitch });

// The burn of a parsed review VTT over [from, to) of the film, times relative to `from`. strip: draw the HUD strip
// (shot label and clock, as src/hud.js draws it) for a picture made without the overlay. Each caption is one event at
// its own fixed place for its whole life, its colour its lane's.
export function toAss(parsed, { from = 0, to = WORLD.T_TOTAL, fps = CONFIG.fps, strip = true, w = WORLD, metrics = fontMetrics() } = {}) {
  const size = (em) => +metrics.size(em).toFixed(3);
  const out = [
    '[Script Info]', '; the review captions burned into the caption band (scripts/lib/captions.js); no cue ids here', 'ScriptType: v4.00+',
    `PlayResX: ${FRAME.w}`, `PlayResY: ${FRAME.h}`, 'WrapStyle: 2', 'ScaledBorderAndShadow: yes', 'YCbCr Matrix: TV.709', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Band,${FONT.face},${size(FONT.em)},${styleColour(COLOUR.world)},${styleColour(COLOUR.world)},${styleColour(COLOUR.dark)},${styleColour(COLOUR.dark)},0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1`,
    `Style: Strip,${FONT.mono},${size(FONT.em)},${styleColour(COLOUR.strip)},${styleColour(COLOUR.strip)},${styleColour(COLOUR.dark)},${styleColour(COLOUR.dark)},0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1`,
    '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  const T = (t) => assTime(t - from, fps), ev = (layer, a, b, style, text) => { if (assCs(a) < assCs(b)) out.push(`Dialogue: ${layer},${a},${b},${style},,0,0,0,,${text}`); };
  const clip = (a, b) => [Math.max(a, from), Math.min(b, to)];
  if (strip) {
    ev(0, T(from), T(to), 'Band', draw(0, 0, COLOUR.dark, BACK_ALPHA, box(FRAME.w, STRIP)));
    // the HUD's label, frame by frame (src/hud.js label())
    for (let k = Math.ceil(from * fps - 1e-6); k / fps < to - 1e-9; k++) {
      const t = k / fps, s = w.shotAt(t);
      const label = `S${pad(s.n, 2)}  ${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}  ${s.lens}mm  ${s.title}  [${tcode(s.start)} to ${tcode(s.end)}]`;
      ev(1, T(t), T(Math.min(to, (k + 1) / fps)), 'Strip', `{\\an7\\pos(${BAND.margin},1)}${assText(label)}`);
    }
  }
  for (const c of parsed.chips) {
    const [a, b] = clip(c.in / 1000, c.out / 1000);
    if (!(a < b)) continue;
    const p = chipPos(c), wd = chipWidth(c, metrics), lead = c.x > 0, colour = (r) => (r.mark ? COLOUR[r.mark] : COLOUR[r.lane] ?? COLOUR.world);
    ev(0, T(a), T(b), 'Band', draw(lead ? p.x : 0, p.y, COLOUR.dark, BACK_ALPHA, box(lead ? wd : wd + BAND.margin, BAND.pitch)));
    // libass trims an event's leading space; a hard space (\h, the same advance in this face) holds the separator's place
    const text = (lead ? `{\\1c${tagColour(colour(c.runs[0]))}\\i0}${assText(SEP).replace(/^ /, '\\h')}` : '') + c.runs.map((r) => `{\\1c${tagColour(colour(r))}\\i${r.italic ? 1 : 0}}${assText(r.text)}`).join('');
    ev(1, T(a), T(b), 'Band', `{\\an7\\pos(${p.x},${p.y})\\fscx${Math.round(c.scale * 100)}}${text}`);
  }
  // the step lane: its ground, the rows' names, the playhead, then a tick per step sliding through it
  const people = persons(w), rowY = (p) => LANE.top + LANE.pad + people.indexOf(p) * (LANE.row + LANE.gap);
  const laneH = LANE.bottom - LANE.top;
  ev(0, T(from), T(to), 'Band', draw(0, LANE.top, COLOUR.dark, BACK_ALPHA, box(FRAME.w, laneH)));
  for (const p of people) ev(1, T(from), T(to), 'Band', `{\\an4\\pos(2,${rowY(p) + LANE.row / 2})\\fs${size(LANE.row + 2)}\\1c${tagColour(COLOUR[p] ?? COLOUR.world)}}${p}`);
  ev(2, T(from), T(to), 'Band', draw(Math.round(laneX(0, 0)), LANE.top, COLOUR.playhead, 1, box(1, laneH)));
  for (const k of parsed.ticks) {
    const t = k.t / 1000, [a, b] = clip(t - LANE.half, t + LANE.half);
    if (!(a < b) || !people.includes(k.person)) continue;
    const ta = assCs(T(a)) / 100 + from, tb = assCs(T(b)) / 100 + from; // the times libass will hold the ends at
    const x1 = +laneX(t, ta).toFixed(2), x2 = +laneX(t, tb).toFixed(2), y = rowY(k.person);
    ev(3, T(a), T(b), 'Band', `{\\an7\\move(${x1},${y},${x2},${y})\\bord0\\shad0\\1c${tagColour(COLOUR[k.person] ?? COLOUR.world)}\\1a${tagAlpha(k.on ? 1 : OFF_TICK)}\\p1}${box(LANE.tick, LANE.row)}{\\p0}`);
  }
  return `${out.join('\n')}\n`;
}
// The rendered text of an ASS file's dialogue lines: override blocks and drawings removed (what the viewer can read)
export function assVisibleText(ass) {
  return ass.split('\n').filter((l) => l.startsWith('Dialogue:')).map((l) => l.split(',').slice(9).join(','))
    .filter((t) => !/\\p1/.test(t)).map((t) => t.replace(/\{[^}]*\}/g, '').replace(/\\N/g, '\n'));
}

// The ffmpeg filter that burns an ASS file, with its font folder; a path's specials escaped for both filter levels
export function burnFilter(assPath, font = fontFile()) {
  const q = (p) => p.replace(/[\\':]/g, '\\$&').replace(/[\\'[\],;]/g, '\\$&');
  return `ass=filename=${q(assPath)}:fontsdir=${q(dirname(font))}`;
}

// ---------- the soft copy: mov_text sized so that no line wraps ----------
// ffmpeg turns a WebVTT file into ASS with its own default style (PlayRes, Arial, size, margins), and the mov_text
// encoder writes that style's size into every style record. So the soft track is ffmpeg's own conversion with one field
// changed: the font size, the largest (up to ffmpeg's) at which every line fits libass's wrap width over a w x h
// picture. An em is size * (h / PlayResY) / cell px, the wrap width (PlayResX - MarginL - MarginR) * w / PlayResX px.
const assStyleField = (ass, name) => {
  const fmt = ass.split('\n').find((l) => /^Format:/.test(l) && l.includes('Fontsize')).slice(7).split(',').map((s) => s.trim());
  const style = ass.split('\n').find((l) => l.startsWith('Style: ')).slice(7).split(',');
  return style[fmt.indexOf(name)];
};
export function softStyle(ass) {
  const res = (k) => Number(new RegExp(`^${k}: (\\d+)$`, 'm').exec(ass)?.[1]);
  const f = (k) => assStyleField(ass, k);
  return { playResX: res('PlayResX'), playResY: res('PlayResY'), font: f('Fontname'), size: Number(f('Fontsize')), marginL: Number(f('MarginL')), marginR: Number(f('MarginR')), marginV: Number(f('MarginV')) };
}
// The width of a styled line in ems of the soft font (its italic face for italic runs)
export function softFonts(face) {
  return { regular: fontMetrics(fontFile(face, { style: 'Regular', want: null })), italic: fontMetrics(fontFile(face, { style: 'Italic', want: null })) };
}
const softEm = (runs, fonts) => runs.reduce((s, r) => s + (r.italic ? fonts.italic : fonts.regular).width(r.text), 0);
export function softSize(style, lines, { w, h, fonts = softFonts(style.font) }) {
  const em = Math.max(0, ...lines.map((l) => softEm(l, fonts)));
  const wrap = ((style.playResX - style.marginL - style.marginR) * w) / style.playResX;
  return { size: em ? Math.min(style.size, Math.floor((wrap * fonts.regular.cell * style.playResY) / (em * h))) : style.size, em: +em.toFixed(3), wrap };
}
// Write the soft track's ASS for a VTT over a w x h picture: ffmpeg's conversion with the fitted size. Returns the facts.
export function writeSoftAss(vttPath, assPath, { w, h }) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', vttPath, '-f', 'ass', assPath], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`captions: ffmpeg could not read ${vttPath}: ${r.stderr}`);
  const ass = readFileSync(assPath, 'utf8'), style = softStyle(ass);
  const fit = softSize(style, parseVtt(readFileSync(vttPath, 'utf8')).entries.flatMap((e) => e.lines), { w, h });
  const fmt = ass.split('\n').find((l) => /^Format:/.test(l) && l.includes('Fontsize')).slice(7).split(',').map((s) => s.trim());
  const sized = ass.replace(/^Style: (.*)$/m, (_, v) => { const f = v.split(','); f[fmt.indexOf('Fontsize')] = String(fit.size); return `Style: ${f.join(',')}`; });
  writeFileSync(assPath, sized);
  return { from: style.size, size: fit.size, font: style.font, playRes: [style.playResX, style.playResY], widestEm: fit.em, wrapPx: +fit.wrap.toFixed(1), frame: [w, h] };
}

// ---------- the SDH track (Sound 6) ----------
// A plot-pertinent sound (cue.sdh), in brackets, lowercase, present tense, as written in cues.js. Its source is the
// words before its verb, named only when the source is not seen at the onset (seenOf: out of frame or behind a
// building), and not again while that voice group has kept sounding since a caption named it (the engine that
// approached is the engine that stops). The verb is the one word of SDH_VERBS a text holds: a word ending in s is not
// enough (a plural or possessive source ends in s too), so a text with none of them, or two, is refused.
export const SDH_VERBS = Object.freeze(['approaches', 'opens', 'crunches', 'shuts', 'stops', 'clicks', 'exhales']);
export function sdhSplit(text) {
  if (!/^\[[^[\]]+\]$/.test(text)) throw new Error(`captions: sdh ${text} is not one bracketed caption`);
  const ws = text.slice(1, -1).toLowerCase().split(' '), at = ws.flatMap((x, i) => (SDH_VERBS.includes(x) ? [i] : []));
  if (at.length !== 1) throw new Error(`captions: sdh ${text} holds ${at.length} verbs of SDH_VERBS, want 1 (add its verb there if it is new)`);
  return { source: ws.slice(0, at[0]).join(' ') || null, sound: ws.slice(at[0]).join(' ') };
}
export function sdhTrack(cues = CUES, w = WORLD) {
  const items = cues.filter((c) => c.enabled && c.sdh).sort((a, b) => a.t0 - b.t0);
  const named = [];
  const sounding = (src, a, b) => { // the group's enabled cues cover [a, b] with no gap
    let t = a;
    for (const c of cues.filter((x) => x.enabled && x.source === src && x.t1 > a).sort((x, y) => x.t0 - y.t0)) { if (c.t0 > t + 1e-9) break; t = Math.max(t, c.t1); if (t >= b) return true; }
    return t >= b;
  };
  return items.map((c) => {
    const { source, sound } = sdhSplit(c.sdh), seen = seenOf(c, w);
    const kept = named.some((n) => n.source === c.source && sounding(c.source, n.t0, c.t0));
    const say = Boolean(source) && !seen && !kept;
    if (say) named.push({ source: c.source, t0: c.t0 });
    return { id: c.id, in: ms(c.t0), out: ms(Math.max(c.t0 + MIN_EVENT, Math.min(c.t1, c.t0 + SDH_MAX))), text: `[${say ? `${source} ` : ''}${sound}]`, seen, named: say, kept, source };
  });
}
export function sdhVtt(sdh) {
  return ['WEBVTT', '', 'NOTE SDH track (Sound 6) from src/audio/cues.js: plot-pertinent sounds only; the cue identifiers are the cue ids', '',
    ...sdh.flatMap((s) => [s.id, `${vttTime(s.in)} --> ${vttTime(s.out)} ${VTT_SETTINGS}`, esc(s.text), ''])].join('\n');
}
export const sdhSrt = (sdh) => sdh.map((s, i) => [String(i + 1), `${srtTime(s.in)} --> ${srtTime(s.out)}`, `${SRT_POS}${srtComment(s.id)}${s.text}`, ''].join('\n')).join('\n');

// ---------- MP4 subtitle helpers ----------
// The facts of a file's subtitle streams (ffmpeg.mjs's probe counts video and audio only)
export function probeSubtitles(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 's', '-show_streams', '-of', 'json', file], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffprobe ${file}: ${r.stderr}`);
  const s = JSON.parse(r.stdout).streams ?? [];
  const num = (x) => (x === undefined || x === 'N/A' ? null : Number(x));
  return { streams: s.length, codec: s[0]?.codec_name ?? null, duration: num(s[0]?.duration), start: num(s[0]?.start_time), packets: num(s[0]?.nb_frames), language: s[0]?.tags?.language ?? null };
}
// The text a player shows from a file's first subtitle stream, as SRT
export function subtitleText(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-map', '0:s:0', '-f', 'srt', '-'], { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(`subtitles of ${file}: ${r.stderr}`);
  return r.stdout;
}
// The style ffmpeg hands libass for a file's first subtitle stream (what a libass player draws with)
export function subtitleStyle(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-map', '0:s:0', '-c:s', 'ass', '-f', 'ass', '-'], { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(`subtitles of ${file}: ${r.stderr}`);
  return { ...softStyle(r.stdout), alignment: Number(assStyleField(r.stdout, 'Alignment')), sizeOverrides: (r.stdout.match(/\\fs\d/g) ?? []).length };
}
// The 3GPP text sample entries (tx3g) in a file's moov box: where each one's justification bytes sit, its values, and
// its default style's font size (TS 26.245: after the display flags, the justification, the background colour and the
// default text box come the style record's start, end, font id and face flags, then the size)
function tx3gEntries(fd, file) {
  const head = Buffer.alloc(16);
  let pos = 0, moov = null;
  for (let n = 0; n < 64 && !moov; n++) {
    if (readSync(fd, head, 0, 16, pos) < 8) break;
    let size = head.readUInt32BE(0);
    if (size === 1) size = Number(head.readBigUInt64BE(8));
    if (head.toString('latin1', 4, 8) === 'moov') moov = { pos, size };
    if (size < 8) break;
    pos += size;
  }
  if (!moov) throw new Error(`no moov box in ${file}`);
  const box = Buffer.alloc(moov.size);
  readSync(fd, box, 0, moov.size, moov.pos);
  const hits = [];
  for (let i = box.indexOf('tx3g'); i >= 4; i = box.indexOf('tx3g', i + 4)) {
    // a sample entry: its size, 'tx3g', six reserved zero bytes, data reference index 1, displayFlags, then the two
    if (box.readUInt32BE(i - 4) < 38 || box.readUIntBE(i + 4, 6) !== 0 || box.readUInt16BE(i + 10) !== 1) continue;
    hits.push({ at: moov.pos + i + 16, justification: [box.readInt8(i + 16), box.readInt8(i + 17)], size: box[i + 37] });
  }
  return hits;
}
// ffmpeg writes every mov_text track bottom centred. The text sample entry's justification (horizontal then vertical,
// 0 left or top, 1 centre, -1 right or bottom) is set to top left in place, so a player that honours it keeps the
// captions out of the bottom band too. Returns what it was.
export function topJustify(file) {
  const fd = openSync(file, 'r+');
  try {
    const hits = tx3gEntries(fd, file);
    if (hits.length !== 1) throw new Error(`${file} has ${hits.length} tx3g sample entries, want 1`);
    writeSync(fd, Buffer.from([0, 0]), 0, 2, hits[0].at);
    return { was: hits[0].justification, now: [0, 0] };
  } finally {
    closeSync(fd);
  }
}
// Each tx3g sample entry in a file: [horizontal, vertical] justification and the default font size
export function movTextEntries(file) {
  const fd = openSync(file, 'r');
  try { return tx3gEntries(fd, file).map((h) => ({ justification: h.justification, size: h.size })); } finally { closeSync(fd); }
}
export const movTextJustification = (file) => movTextEntries(file).map((e) => e.justification);
