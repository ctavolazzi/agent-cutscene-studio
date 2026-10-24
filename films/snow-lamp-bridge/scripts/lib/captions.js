// Captions from the sound catalogue (src/audio/cues.js), SOUND-PLAN 3.16 and 4.3, ROADMAP Sound 1.10:
// - the review track: every planned sound, enabled or offered, as WebVTT (the canonical file) and SRT. A caption comes
//   in at its cue's onset to the millisecond and stays until the later of the cue's end and its onset plus 5/6 s; steps
//   merge into one caption per walker per surface stretch, each step kept as a tick for the step lane; ids live only in
//   the soft files (the VTT cue identifier and an SRT comment); off-screen cues are in italics; new cues say "(new)",
//   offered ones "(offered)" (offered cues are disabled: shown so the director can ask for them).
// - its layout in the 480x270 caption band below the HUD strip, at most 3 lines, and the ASS that burns it (libass);
// - the SDH track for Sound 6: plot-pertinent cues only (cue.sdh), the source named only when off screen and not again
//   while it keeps sounding (DCMP).
// The densest moment decides how 3 lines hold everything (measured, reviewTrack().stats): one line per caption would
// need 14 lines at 35.179 s (the doors, getting out, the idle and the first steps), so captions merge and none is
// dropped. They join per lane (the night and the car, then each person, who also owns their own door), a source's
// repeated words are said once and identical captions are counted; where that still needs a fourth line, lanes share a
// line (4.0 s of the film), and where even that does not hold, the band is condensed horizontally (0.8 s, never below
// BAND.condense's last step). Pure: the same cues give the same bytes.
import { spawnSync } from 'node:child_process';
import { closeSync, openSync, readFileSync, readSync, writeSync } from 'node:fs';
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
// CONDENSE: the horizontal scales the band may use, largest first, when 3 lines at full width do not hold a moment.
export const BAND = Object.freeze({ top: STRIP, pitch: STRIP, margin: 3, condense: Object.freeze([1, 0.95, 0.9, 0.85]) });
// The step lane under the band, one px below it: a row per walker (`row` px, `gap` apart, `pad` inside the lane's
// ground), a `tick` px wide mark per step sliding left through a playhead at the centre of the lane right of its
// `label` column, `half` seconds either side, so a tick crosses the playhead as its boot lands.
const lane = { top: BAND.top + MAX_LINES * BAND.pitch + 1, row: 5, gap: 1, pad: 1, half: 1.5, label: 10, tick: 2 };
const walkers = Object.keys(WORLD.PEOPLE).length;
export const LANE = Object.freeze({ ...lane, bottom: lane.top + 2 * lane.pad + walkers * lane.row + (walkers - 1) * lane.gap });
if (LANE.bottom > FRAME.h - SAFE) throw new Error('captions: the band and the step lane reach the bottom safe band');
// Colours: the storyboard map's A and B (scripts/lib/map.js), the HUD's text and strip (src/hud.js), new and offered marks.
export const COLOUR = Object.freeze({ world: '#e8eefc', A: '#ffb454', B: '#6fd3ff', new: '#7ae07a', offered: '#ff8fd0', strip: '#ffd36b', dark: '#000000', playhead: '#ffffff' });
const BACK_ALPHA = 0.6; // src/hud.js: the strip's rgba(0,0,0,0.6), the opacity of every dark ground here
const OFF_TICK = 0.4; // an off-screen step's tick, dimmer, as its caption is in italics
const SEP = ' \u00b7 '; // between captions in a lane (a middle dot)
const GAP = '   '; // between lanes sharing a line
const TIMES = '\u00d7'; // identical captions counted: "turns \u00d72"

// ---------- small helpers ----------
const ms = (t) => Math.round(t * 1000);
const persons = (w) => Object.keys(w.PEOPLE);
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
const pad = (n, k) => String(n).padStart(k, '0');
const stamp = (t, sep) => `${pad(Math.floor(t / 3600000), 2)}:${pad(Math.floor(t / 60000) % 60, 2)}:${pad(Math.floor(t / 1000) % 60, 2)}${sep}${pad(t % 1000, 3)}`;
export const vttTime = (t) => stamp(t, '.'); // t in ms
export const srtTime = (t) => stamp(t, ',');

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

// ---------- font metrics, for the layout (libass draws the same face) ----------
let metricsCache = null;
export function fontFile(face = FONT.face) {
  const r = spawnSync('fc-match', ['-f', '%{file}', `${face}:style=Book`], { encoding: 'utf8' });
  if (r.status !== 0 || !r.stdout || !/dejavu/i.test(r.stdout)) throw new Error(`captions: the ${face} font is not installed (fc-match gave ${r.stdout || r.stderr})`);
  return r.stdout;
}
// Advance widths from the TrueType tables (head, hhea, hmtx, cmap format 4) and the libass size that draws an em of
// FONT.em px: libass sizes a face by its OS/2 win ascent plus descent, not its em.
export function fontMetrics(file = fontFile()) {
  if (metricsCache?.file === file) return metricsCache;
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
  // in ems, without kerning (which narrows this face's lines a little; tests/captions.test.mjs measures the drawn width)
  const width = (s) => [...s].reduce((sum, ch) => sum + adv(glyph(ch.codePointAt(0))), 0) / upm;
  metricsCache = { file, upm, cell, width, size: (em) => em * cell };
  return metricsCache;
}
// A line's width in px at the band's em and a horizontal scale
export const lineWidth = (text, scale = 1, m = fontMetrics()) => m.width(text) * FONT.em * scale;
export const AVAIL = FRAME.w - 2 * BAND.margin;

// ---------- the review track ----------
// The captions (one per cue; one per step stretch; one per place's background), then the moments between their
// changes, each laid out in at most MAX_LINES lines.
export function reviewTrack(cues = CUES, w = WORLD, { metrics = fontMetrics() } = {}) {
  const ids = persons(w);
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
    const f = r.cues[0];
    add(r.cues, f.person, r.walk ? `walks, ${f.surface}` : r.cues.length > 1 ? `steps, ${f.surface}` : words(f.label, f.person), '', r.screen);
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

  // the moments: every change of what is on screen starts one
  const bounds = [...new Set(merged.flatMap((c) => [c.in, c.out]))].sort((a, b) => a - b);
  const lanes = ['world', ...ids];
  const slices = [];
  for (let i = 0; i + 1 < bounds.length; i++) {
    const a = bounds[i], on = merged.filter((c) => c.in <= a && c.out > a);
    if (!on.length) continue;
    const phrases = lanes.map((lane) => lanePhrases(on.filter((c) => c.lane === lane)));
    const fit = layout(lanes, phrases, metrics);
    slices.push({ start: a, end: bounds[i + 1], caps: on, lines: fit.lines, scale: fit.scale, shared: fit.share });
  }
  ticks.sort((a, b) => a.t - b.t || (a.person < b.person ? -1 : 1));
  const densest = slices.reduce((d, s) => (s.caps.length > d.caps ? { at: s.start, caps: s.caps.length } : d), { at: 0, caps: 0 });
  const condensed = slices.filter((s) => s.scale < 1);
  return {
    captions: merged, slices, ticks,
    stats: {
      captions: merged.length, slices: slices.length, ticks: ticks.length, cues: merged.reduce((n, c) => n + c.ids.length, 0),
      offScreen: merged.filter((c) => c.italic).length, new: merged.filter((c) => c.mark === 'new').length, offered: merged.filter((c) => c.mark === 'offered').length,
      maxLines: Math.max(...slices.map((s) => s.lines.length)), densest: { at: densest.at, captions: densest.caps },
      shared: { slices: slices.filter((s) => s.shared).length, ms: slices.filter((s) => s.shared).reduce((n, s) => n + s.end - s.start, 0) },
      condensed: { slices: condensed.length, ms: condensed.reduce((n, s) => n + s.end - s.start, 0), minScale: Math.min(...slices.map((s) => s.scale)) },
    },
  };
}

// One lane's captions on screen, in onset order: identical ones counted, and a source's words said once when its next
// caption repeats at least two of them ("passenger door unlatches \u00b7 swings open").
function lanePhrases(caps) {
  const out = [];
  for (const c of caps) {
    const same = out.find((p) => p.words === c.words && p.mark === c.mark && p.italic === c.italic);
    if (same) { same.count++; same.ids.push(...c.ids); continue; }
    out.push({ words: c.words, text: c.words, mark: c.mark, italic: c.italic, source: c.source, count: 1, ids: [...c.ids] });
  }
  for (let j = 1; j < out.length; j++) {
    const a = out[j - 1], b = out[j];
    if (a.source !== b.source) continue;
    const x = a.words.split(' '), y = b.words.split(' ');
    let k = 0;
    while (k < x.length - 1 && k < y.length - 1 && x[k] === y[k]) k++;
    if (k >= 2) b.text = y.slice(k).join(' ');
  }
  for (const p of out) p.text += p.count > 1 ? ` ${TIMES}${p.count}` : '';
  return out;
}
const markText = (m) => (m ? ` (${m})` : '');
export const plainLine = (segs) => segs.map((s) => s.text + (s.kind === 'phrase' ? markText(s.mark) : '')).join('');

// Each lane starts its own line and wraps between its captions; when that needs more than MAX_LINES lines, a lane may
// also follow the previous one on its line. The first of these that fits, at the widest scale in BAND.condense, wins.
function layout(lanes, phrases, metrics) {
  for (const [scale, share] of BAND.condense.flatMap((s) => [[s, false], [s, true]])) {
    const lines = [], fits = (segs) => lineWidth(plainLine(segs), scale, metrics) <= AVAIL;
    for (let k = 0; k < lanes.length; k++) {
      const lane = lanes[k], ps = phrases[k];
      if (!ps.length) continue;
      const prefix = lane === 'world' ? [] : [{ kind: 'prefix', lane, text: `${lane}: ` }];
      const ph = (p) => ({ kind: 'phrase', lane, text: p.text, mark: p.mark, italic: p.italic, ids: p.ids });
      const last = lines[lines.length - 1];
      let cur;
      if (share && last && fits([...last, { kind: 'gap', lane, text: GAP }, ...prefix, ph(ps[0])])) { cur = lines.pop(); cur.push({ kind: 'gap', lane, text: GAP }, ...prefix, ph(ps[0])); } else cur = [...prefix, ph(ps[0])];
      for (const p of ps.slice(1)) {
        const next = [...cur, { kind: 'sep', lane, text: SEP }, ph(p)];
        if (fits(next)) cur = next; else { lines.push(cur); cur = [...prefix, ph(p)]; }
      }
      lines.push(cur);
    }
    if (lines.length <= MAX_LINES && lines.every(fits)) return { lines, scale, share };
  }
  throw new Error(`captions: a moment does not fit ${MAX_LINES} lines at the narrowest scale ${BAND.condense[BAND.condense.length - 1]}`);
}

// ---------- writers: WebVTT (canonical), SRT ----------
// A line in WebVTT: a person's lane in a class span named after them, italics for off screen, the marks in classes.
function vttLine(segs) {
  let out = '', open = null;
  for (const s of segs) {
    const lane = s.lane === 'world' ? null : s.lane;
    if (lane !== open) { if (open) out += '</c>'; if (lane && s.kind !== 'gap') { out += `<c.${lane}>`; open = lane; } else open = null; }
    if (s.kind === 'gap' && lane) { out += esc(s.text); continue; }
    out += s.kind === 'phrase' ? `${s.italic ? `<i>${esc(s.text)}</i>` : esc(s.text)}${s.mark ? ` <c.${s.mark}>(${s.mark})</c>` : ''}` : esc(s.text);
  }
  return open ? `${out}</c>` : out;
}
// the ids on screen: a phrase's ids joined by +, phrases by a space, lines by |
const idsOf = (slice) => slice.lines.map((l) => l.filter((s) => s.kind === 'phrase').map((s) => s.ids.join('+')).join(' ')).join(' | ');
// cue settings: at the top, left aligned, the whole width (nothing goes in the bottom ninth)
export const VTT_SETTINGS = 'line:0 position:0% align:start size:100%';

export function toVtt(track, { title = 'review' } = {}) {
  const head = ['WEBVTT', '', `NOTE ${title} track from src/audio/cues.js (scripts/lib/captions.js): ${track.stats.captions} captions of ${track.stats.cues} cues, at most ${MAX_LINES} lines; the cue identifiers list the ids on screen: a caption's joined by +, captions by a space, lines by |`, ''];
  const ticks = ['NOTE ticks: the step lane, one per step: walker, contact in ms, on or off screen, cue id', ...track.ticks.map((k) => `${k.person} ${k.t} ${k.on ? 'on' : 'off'} ${k.id}`), ''];
  const body = track.slices.flatMap((s, i) => [`${i + 1} ${idsOf(s)}`, `${vttTime(s.start)} --> ${vttTime(s.end)} ${VTT_SETTINGS}`, ...s.lines.map(vttLine), '']);
  return [...head, ...ticks, ...body].join('\n');
}

// SRT: no classes, so the lanes and marks are font colours; {\an8} puts it at the top; the ids ride in the id attribute
// of empty font tags, which players drop. ffmpeg's SRT reader keeps a tag of up to 128 bytes (measured: 117 characters
// of id), and shows a longer one as text, so the ids are split over tags of at most SRT_IDS characters each.
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
  let out = '', open = null;
  for (const s of segs) {
    const lane = s.lane === 'world' ? null : s.lane;
    if (lane !== open) { if (open) out += '</font>'; if (lane && s.kind !== 'gap') { out += `<font color="${COLOUR[lane] ?? COLOUR.world}">`; open = lane; } else open = null; }
    if (s.kind === 'gap' && lane) { out += s.text; continue; }
    out += s.kind === 'phrase' ? `${s.italic ? `<i>${s.text}</i>` : s.text}${s.mark ? ` <font color="${COLOUR[s.mark]}">(${s.mark})</font>` : ''}` : s.text;
  }
  return open ? `${out}</font>` : out;
}
export function toSrt(track) {
  return track.slices.map((s, i) => [String(i + 1), `${srtTime(s.start)} --> ${srtTime(s.end)}`, `{\\an8}${srtComment(idsOf(s))}${s.lines.map(srtLine).join('\n')}`, ''].join('\n')).join('\n');
}

// ---------- reading the WebVTT back (the burn and capture.js read the file, not the cues) ----------
const parseTime = (s) => { const m = /^(?:(\d+):)?(\d{2}):(\d{2})\.(\d{3})$/.exec(s); if (!m) throw new Error(`captions: bad time ${s}`); return ((+(m[1] ?? 0) * 60 + +m[2]) * 60 + +m[3]) * 1000 + +m[4]; };
export function parseVtt(text) {
  const blocks = text.replace(/\r\n/g, '\n').split(/\n{2,}/).map((b) => b.split('\n')).filter((b) => b.length && b[0] !== '');
  if (!/^WEBVTT/.test(blocks[0]?.[0] ?? '')) throw new Error('captions: not a WebVTT file');
  const entries = [], ticks = [], notes = [];
  for (const b of blocks.slice(1)) {
    if (/^NOTE\b/.test(b[0])) {
      notes.push(b.join('\n'));
      if (/^NOTE ticks\b/.test(b[0])) for (const l of b.slice(1)) { const [person, t, on, id] = l.split(' '); ticks.push({ person, t: Number(t), on: on === 'on', id }); }
      continue;
    }
    const ti = b.findIndex((l) => l.includes('-->'));
    if (ti < 0) throw new Error(`captions: a block with no timing: ${b[0]}`);
    const [a, rest] = b[ti].split(' --> '), [e, ...settings] = rest.split(' ');
    entries.push({ id: ti ? b.slice(0, ti).join('\n') : null, start: parseTime(a), end: parseTime(e), settings: settings.join(' '), lines: b.slice(ti + 1).filter((l) => l !== '').map(parseCueLine) });
  }
  return { entries, ticks, notes };
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

// The burn of a parsed review VTT over [from, to) of the film, times relative to `from`. strip: draw the HUD strip
// (shot label and clock, as src/hud.js draws it) for a picture made without the overlay.
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
  for (const e of parsed.entries) {
    const [a, b] = clip(e.start / 1000, e.end / 1000);
    if (!(a < b)) continue;
    const scale = BAND.condense.find((s) => e.lines.every((l) => lineWidth(runsText(l), s, metrics) <= AVAIL)) ?? BAND.condense[BAND.condense.length - 1];
    ev(0, T(a), T(b), 'Band', draw(0, BAND.top, COLOUR.dark, BACK_ALPHA, box(FRAME.w, e.lines.length * BAND.pitch)));
    e.lines.forEach((runs, i) => {
      const text = runs.map((r) => `{\\1c${tagColour(r.mark ? COLOUR[r.mark] : COLOUR[r.lane] ?? COLOUR.world)}\\i${r.italic ? 1 : 0}}${assText(r.text)}`).join('');
      ev(1, T(a), T(b), 'Band', `{\\an7\\pos(${BAND.margin},${BAND.top + i * BAND.pitch})\\fscx${Math.round(scale * 100)}}${text}`);
    });
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

// ---------- the SDH track (Sound 6) ----------
// A plot-pertinent sound (cue.sdh), in brackets, lowercase, present tense, as written in cues.js. Its source (the words
// before the first verb) is named only when the source is not seen at the onset (seenOf: out of frame or behind a
// building), and not again while that voice group has kept sounding since a caption named it (the engine that
// approached is the engine that stops).
const SDH_RE = /^\[(?:(.+?) )?(\S+s\b.*)\]$/;
export function sdhTrack(cues = CUES, w = WORLD) {
  const items = cues.filter((c) => c.enabled && c.sdh).sort((a, b) => a.t0 - b.t0);
  const named = [];
  const sounding = (src, a, b) => { // the group's enabled cues cover [a, b] with no gap
    let t = a;
    for (const c of cues.filter((x) => x.enabled && x.source === src && x.t1 > a).sort((x, y) => x.t0 - y.t0)) { if (c.t0 > t + 1e-9) break; t = Math.max(t, c.t1); if (t >= b) return true; }
    return t >= b;
  };
  return items.map((c) => {
    const m = SDH_RE.exec(c.sdh.toLowerCase());
    if (!m) throw new Error(`captions: ${c.id} sdh ${c.sdh} is not "[source verb...]" in brackets`);
    const [, source, sound] = m, seen = seenOf(c, w);
    const kept = named.some((n) => n.source === c.source && sounding(c.source, n.t0, c.t0));
    const say = Boolean(source) && !seen && !kept;
    if (say) named.push({ source: c.source, t0: c.t0 });
    return { id: c.id, in: ms(c.t0), out: ms(Math.max(c.t0 + MIN_EVENT, Math.min(c.t1, c.t0 + SDH_MAX))), text: `[${say ? `${source} ` : ''}${sound}]`, seen, named: say, kept, source: source ?? null };
  });
}
export function sdhVtt(sdh) {
  return ['WEBVTT', '', 'NOTE SDH track (Sound 6) from src/audio/cues.js: plot-pertinent sounds only; the cue identifiers are the cue ids', '',
    ...sdh.flatMap((s) => [s.id, `${vttTime(s.in)} --> ${vttTime(s.out)} ${VTT_SETTINGS}`, esc(s.text), ''])].join('\n');
}
export const sdhSrt = (sdh) => sdh.map((s, i) => [String(i + 1), `${srtTime(s.in)} --> ${srtTime(s.out)}`, `{\\an8}${srtComment(s.id)}${s.text}`, ''].join('\n')).join('\n');

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
// The 3GPP text sample entries (tx3g) in a file's moov box: where each one's justification bytes sit, and their values
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
    hits.push({ at: moov.pos + i + 16, justification: [box.readInt8(i + 16), box.readInt8(i + 17)] });
  }
  return hits;
}
// ffmpeg writes every mov_text track bottom centred. The text sample entry's justification (TS 26.245: horizontal then
// vertical, 0 left or top, 1 centre, -1 right or bottom) is set to top left in place, so a player that honours it keeps
// the captions out of the bottom band too. Returns what it was.
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
// The justification of each tx3g sample entry in a file, [horizontal, vertical]
export function movTextJustification(file) {
  const fd = openSync(file, 'r');
  try { return tx3gEntries(fd, file).map((h) => h.justification); } finally { closeSync(fd); }
}
