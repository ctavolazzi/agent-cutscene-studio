// Checks for the captions (scripts/lib/captions.js) and the spotting reel (scripts/spotting-reel.js), SOUND-PLAN 3.16
// and ROADMAP Sound 1.10. Each check is a function returning its problems, read from the written files (the VTT, the
// ASS, the MP4s) and re-derived from the cues here, not from the module's own bookkeeping; the real track must give
// none, and a planted fault must give some.
// The reel is made once from the published export into $CAPTION_TEST_OUT, or into a folder of this process's own in the
// system temp dir that is removed afterwards, so parallel runs never share files (about 2 minutes in all).
// Run: node --test tests/captions.test.mjs
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { ROOT } from '../scripts/lib/browser.mjs';
import { BT709_TAGS, ffprobe } from '../scripts/lib/ffmpeg.mjs';
import { visibleFrom } from '../scripts/lib/checks.js';
import { makeCamera } from '../scripts/lib/math.js';
import { PW, PH } from '../scripts/lib/panel.js';
import {
  AVAIL, BAND, FONT, FRAME, LANE, MAX_LINES, MIN_EVENT, SAFE, SDH_LINES, SDH_MAX, SDH_VERBS, SRT_POS, STRIP, assTime, assVisibleText, burnFilter,
  chipPos, chipWidth, clipVtt, fontFile, fontMetrics, frameAt, laneX, lineWidth, movTextEntries, parseVtt, reviewTrack, runsText, sdhSplit, sdhSrt, sdhTrack,
  sdhVtt, subtitleStyle, subtitleText, toAss, toSrt, toVtt, topJustify,
} from '../scripts/lib/captions.js';
import { NAMES, SCALE, bottomBand, phoneCopy, previewCodec, softCopy, spottingReel, writeCaptions } from '../scripts/spotting-reel.js';
import { videoHash } from '../scripts/mux.js';
import { CUES, WORLD } from '../src/audio/cues.js';
import { CONFIG } from '../src/config.js';
import { SHOTS, cameraAt, shotAt } from '../src/shots.js';
import { T_TOTAL } from '../src/world.js';

const OUT = process.env.CAPTION_TEST_OUT ?? join(tmpdir(), `snowy-bridge-caption-test-${process.pid}`);
after(() => { if (!process.env.CAPTION_TEST_OUT) rmSync(OUT, { recursive: true, force: true }); });
const SOURCE = resolve(ROOT, 'out/snowy-bridge.mp4');
const DASH = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`); // built from code points so this file holds neither
const FPS = CONFIG.fps;
const ms = (t) => Math.round(t * 1000);
const SHOWN = CUES.filter((c) => c.enabled || c.offered); // every cue the review track carries: offered ones too
const IDS = new Set(CUES.map((c) => c.id)), byId = new Map(CUES.map((c) => [c.id, c]));
const PEOPLE = Object.keys(WORLD.PEOPLE);
mkdirSync(OUT, { recursive: true });
const fresh = (name) => { const d = resolve(OUT, name); rmSync(d, { recursive: true, force: true }); mkdirSync(d, { recursive: true }); return d; };
const ff = (args, maxBuffer = 1 << 28) => { const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { maxBuffer }); assert.equal(r.status, 0, String(r.stderr ?? r.error)); return r.stdout; };

const TRACK = reviewTrack();
const VTT = toVtt(TRACK), PARSED = parseVtt(VTT), ASS = toAss(PARSED);
const edit = (text, from, to) => { assert.ok(text.includes(from), `the plant needs "${from}"`); return text.replace(from, to); };
// a plant in the cues only (the soft text), past the NOTE blocks (the ticks and the burn's layout)
const BODY = VTT.indexOf('\n\n1 ') + 2;
const editCues = (from, to) => VTT.slice(0, BODY) + edit(VTT.slice(BODY), from, to);
const withEntry = (parsed, e0, patch) => ({ ...parsed, entries: parsed.entries.map((e) => (e === e0 ? { ...e, ...patch } : e)) });
const withChip = (parsed, c0, patch) => ({ ...parsed, chips: parsed.chips.map((c) => (c === c0 ? { ...c, ...patch } : c)) });

// ---------- reading the VTT back, independently of the writer's model ----------
// The ids of an entry: its identifier after the running number, lines by |, captions by a space, a caption's ids by +;
// an empty line (held so the lines below keep their places) is -
const groupsOf = (e) => e.id.replace(/^\d+ /, '').split(' | ').map((l) => (l === '-' ? [] : l.split(' ').map((g) => g.split('+'))));
const idsIn = (e) => groupsOf(e).flat(2);
const key = (ids) => ids.join('+');
// A line's captions with their styles: split at the middle dot and the lane gap (after: which one came before); a
// lane's "A: " and a blank line dropped
function chunksOf(runs) {
  const chars = runs.flatMap((r) => [...r.text].map((ch) => ({ ch, italic: r.italic, mark: r.mark, lane: r.lane })));
  const text = chars.map((c) => c.ch).join(''), out = [];
  if (!text.trim()) return out;
  const pieces = text.split(/( · | {3})/);
  let at = 0;
  for (let i = 0; i < pieces.length; i += 2) {
    const part = pieces[i], after = i ? (pieces[i - 1] === ' · ' ? 'sep' : 'gap') : null;
    const start = text.indexOf(part, at), cs = chars.slice(start, start + part.length);
    at = start + part.length;
    const markChars = cs.filter((c) => c.mark), mark = markChars.length ? markChars[0].mark : '';
    let words = cs.filter((c) => !c.mark).map((c) => c.ch).join('').replace(/ $/, '');
    const prefix = PEOPLE.find((p) => words.startsWith(`${p}: `)), skip = prefix ? prefix.length + 2 : 0;
    const wordChars = cs.filter((c) => !c.mark).slice(skip, words.length);
    words = words.slice(skip);
    const it = new Set(wordChars.filter((c) => c.ch !== ' ').map((c) => c.italic));
    out.push({ words, mark, italic: it.size === 1 ? [...it][0] : 'mixed', mark2: markChars.map((c) => c.ch).join(''), prefix: prefix ?? null, after });
  }
  return out;
}

// On or off screen at the onset, re-derived: the cue's place through its shot's camera at t0, inside 0 to PW and 0 to PH
function offScreen(c) {
  if (!c.place) return false; // a background: no point, neither on nor off
  const p = c.place(c.t0);
  if (!p) return true;
  const q = makeCamera(cameraAt(shotAt(c.t0), c.t0), PW, PH).project(p);
  return !(q && q[0] >= 0 && q[0] <= PW && q[1] >= 0 && q[1] <= PH);
}
// A caption's lane, re-derived: its person, a door's owner (each person gets out through their own door), else the night
const DOOR_OWNER = Object.fromEntries(PEOPLE.map((p) => [Object.keys(WORLD.DOOR_SIDE).find((t) => WORLD.DOOR_SIDE[t] === WORLD.EXIT.outSide[p]), p]));
const laneOfCue = (c) => c.person ?? (c.family === 'door' ? DOOR_OWNER[c.meta.door] : 'world');

// ---------- the checks ----------
// 1. In-time: a cue's caption comes in exactly at its onset, to the millisecond. A step is carried by its stretch's
// caption, which comes in at the first step's onset, so a step is listed no later than its onset and a stretch's ids
// first appear exactly at the onset of the earliest of them.
function inTimeProblems(parsed, cues = SHOWN) {
  const p = [], first = new Map();
  for (const e of parsed.entries) for (const id of idsIn(e)) if (!first.has(id)) first.set(id, e.start);
  for (const c of cues) {
    if (!first.has(c.id)) { p.push(`${c.id} is never on screen`); continue; }
    if (c.family !== 'feet' && first.get(c.id) !== ms(c.t0)) p.push(`${c.id} comes in at ${first.get(c.id)} ms, its onset is ${ms(c.t0)} ms`);
    if (c.family === 'feet' && first.get(c.id) > ms(c.t0)) p.push(`${c.id} first listed at ${first.get(c.id)} ms, after its contact at ${ms(c.t0)} ms`);
  }
  for (const e of parsed.entries) {
    const fresh = idsIn(e).filter((id) => first.get(id) === e.start && byId.get(id)?.family === 'feet');
    if (fresh.length && e.start !== Math.min(...fresh.map((id) => ms(byId.get(id).t0)))) p.push(`a stretch comes in at ${e.start} ms, not at a step's onset`);
  }
  return p;
}

// 2. Out-time: a cue stays on screen without a gap from its first entry until at least the later of its end and its
// in-time plus 5/6 s
function outTimeProblems(parsed, cues = SHOWN) {
  const p = [], spans = new Map();
  for (const e of parsed.entries) for (const id of idsIn(e)) { if (!spans.has(id)) spans.set(id, []); spans.get(id).push(e); }
  for (const c of cues) {
    const es = spans.get(c.id);
    if (!es) continue; // inTimeProblems reports it
    for (let i = 1; i < es.length; i++) if (es[i].start !== es[i - 1].end) { p.push(`${c.id} leaves the screen from ${es[i - 1].end} to ${es[i].start} ms`); break; }
    const a = es[0].start, b = es[es.length - 1].end;
    if (b - a < ms(MIN_EVENT) || b < ms(c.t1)) p.push(`${c.id} is on screen ${a} to ${b} ms; it ends at ${ms(c.t1)} ms and needs ${ms(MIN_EVENT)} ms at least`);
  }
  return p;
}

// 3. At most MAX_LINES lines at once, and entries never overlap (a player would stack them)
function lineProblems(parsed) {
  const p = [];
  let last = -1;
  for (const e of parsed.entries) {
    if (e.start < last) p.push(`entries overlap at ${e.start} ms: a player would stack more lines`);
    last = e.end;
    if (e.lines.length > MAX_LINES) p.push(`${e.lines.length} lines at ${e.start} ms`);
  }
  return p;
}

// 4. The burn's layout (the VTT's layout note): each caption inside the band at its own scale, on one of the lines, and
// never over another caption on its line while both are up; each soft line lists exactly the captions of that line
function layoutProblems(parsed, metrics = fontMetrics()) {
  const p = [], byKey = new Map(parsed.chips.map((c) => [key(c.ids), c]));
  for (const c of parsed.chips) {
    const w = chipWidth(c, metrics);
    if (!(Number.isInteger(c.x) && c.x >= 0 && c.x + w <= AVAIL)) p.push(`${key(c.ids)} at x ${c.x}, ${w} px wide: outside the band's ${AVAIL} px`);
    if (!(c.row >= 0 && c.row < MAX_LINES)) p.push(`${key(c.ids)} on line ${c.row}`);
    if (!BAND.condense.includes(c.scale)) p.push(`${key(c.ids)} at scale ${c.scale}, not one of ${BAND.condense}`);
  }
  for (const a of parsed.chips) for (const b of parsed.chips) {
    if (a === b || a.row !== b.row || a.ids[0] > b.ids[0] || !(a.in < b.out && b.in < a.out)) continue;
    if (a.x < b.x + chipWidth(b, metrics) && b.x < a.x + chipWidth(a, metrics)) p.push(`${key(a.ids)} and ${key(b.ids)} overlap on line ${a.row}`);
  }
  for (const e of parsed.entries) groupsOf(e).forEach((line, i) => line.forEach((g) => {
    const c = byKey.get(key(g));
    if (!c) p.push(`${e.start} ms: ${key(g)} has no place in the layout`);
    else if (c.row !== i || !(c.in <= e.start && e.end <= c.out)) p.push(`${e.start} ms: ${key(g)} is listed on line ${i}, laid out on line ${c.row} from ${c.in} to ${c.out} ms`);
  }));
  return p;
}

// 5. Sticky (F1 of the review): a caption still on screen never changes line, nor its order among the captions it shares
// a line with; in the burn it is one event at one place, its own, for its whole life
function stickyProblems(parsed) {
  const p = [], where = new Map(), order = new Map();
  let prev = null;
  for (const e of parsed.entries) {
    const lines = groupsOf(e).map((l) => l.map(key));
    lines.forEach((l, i) => l.forEach((k, j) => {
      const w = where.get(k);
      if (w && prev && w.end === e.start && w.line !== i) p.push(`${k} moves from line ${w.line} to ${i} at ${e.start} ms while on screen`);
      where.set(k, { line: i, end: e.end });
      for (const k2 of l.slice(j + 1)) {
        if (order.get(`${k2}|${k}`)) p.push(`${k} and ${k2} swap places on line ${i} at ${e.start} ms`);
        order.set(`${k}|${k2}`, true);
      }
    }));
    prev = e;
  }
  return p;
}
// The burn's caption events: the Band text events with a \pos and a \fscx
function burnEvents(ass) {
  return ass.split('\n').filter((l) => l.startsWith('Dialogue: 1,') && /\\fscx\d+/.test(l)).map((l) => {
    const f = l.split(','), m = /\\pos\(([\d.]+),([\d.]+)\)\\fscx(\d+)/.exec(l);
    return { a: f[1], b: f[2], x: +m[1], y: +m[2], fscx: +m[3] };
  });
}
function burnStickyProblems(ass, parsed, { from = 0, to = T_TOTAL } = {}) {
  const p = [], events = burnEvents(ass), used = new Set();
  for (const c of parsed.chips) {
    const a = Math.max(c.in / 1000, from), b = Math.min(c.out / 1000, to);
    if (!(a < b)) continue;
    const want = { a: assTime(a - from), b: assTime(b - from), ...chipPos(c), fscx: Math.round(c.scale * 100) };
    if (want.a === want.b) continue; // shown on no frame of this clip
    const hits = events.filter((v) => v.x === want.x && v.y === want.y && v.a === want.a && v.b === want.b && v.fscx === want.fscx);
    if (hits.length !== 1) p.push(`${key(c.ids)}: ${hits.length} burn events at its place for its whole life, want 1`);
    hits.forEach((h) => used.add(h));
  }
  for (const v of events) if (!used.has(v)) p.push(`a burned caption at (${v.x}, ${v.y}) from ${v.a} to ${v.b} is no caption's whole life`);
  return p;
}

// 6. One scale per busy stretch (F1): the captions that each arrive within 20 frames (5/6 s) of the one before share
// one horizontal scale for their lives, so the band is never condensed for a moment
function stretchProblems(parsed) {
  const p = [], gap = Math.round(MIN_EVENT * FPS), frames = [...new Set(parsed.chips.map((c) => frameAt(c.in)))].sort((a, b) => a - b);
  const stretchOf = new Map();
  let s = -1;
  frames.forEach((f, i) => { if (i === 0 || f - frames[i - 1] > gap) s++; stretchOf.set(f, s); });
  const scales = new Map();
  for (const c of parsed.chips) { const k = stretchOf.get(frameAt(c.in)); if (!scales.has(k)) scales.set(k, new Set()); scales.get(k).add(c.scale); }
  for (const [k, v] of scales) if (v.size > 1) p.push(`busy stretch ${k} uses scales ${[...v].join(', ')}`);
  return p;
}

// 7. No cue id in burned text: the ASS's dialogue as drawn, and the VTT's cue text, hold no id
const idHits = (texts) => texts.flatMap((t) => [...IDS].filter((id) => t.includes(id)).map((id) => `${id} in "${t.slice(0, 60)}"`));
const burnedIdProblems = (ass, parsed) => [...idHits(assVisibleText(ass)), ...idHits(parsed.entries.flatMap((e) => e.lines.map(runsText)))];

// 8. Italics exactly for off-screen cues, the marks, and the lanes: each caption's words in italics when its cues are
// off screen at their onsets (all the cues a caption carries agree), "(offered)" on offered cues, "(new)" on other new
// ones; in the soft text a person's caption follows their name, in the burn it is in their colour
function styleProblems(parsed) {
  const p = [];
  for (const e of parsed.entries) {
    const groups = groupsOf(e);
    if (groups.length !== e.lines.length) { p.push(`${e.start} ms: ${groups.length} id lines for ${e.lines.length} text lines`); continue; }
    e.lines.forEach((runs, i) => {
      const chunks = chunksOf(runs);
      if (chunks.length !== groups[i].length) { p.push(`${e.start} ms line ${i + 1}: ${chunks.length} captions for ${groups[i].length} id groups`); return; }
      let lane = null;
      chunks.forEach((ch, j) => {
        const cs = groups[i][j].map((id) => byId.get(id));
        if (cs.some((c) => !c)) { p.push(`${e.start} ms: an unknown id in ${groups[i][j]}`); return; }
        const off = new Set(cs.map(offScreen)), marks = new Set(cs.map((c) => (c.offered ? 'offered' : c.new ? 'new' : ''))), lanes = new Set(cs.map(laneOfCue));
        if (off.size > 1) p.push(`${groups[i][j]}: one caption for cues on and off screen`);
        if (ch.italic !== [...off][0]) p.push(`${e.start} ms "${ch.words}": italic ${ch.italic}, off screen ${[...off][0]}`);
        const want = [...marks][0];
        if (marks.size > 1 || ch.mark !== want || (want && ch.mark2 !== `(${want})`)) p.push(`${e.start} ms "${ch.words}": marked "${ch.mark2}", want "${want ? `(${want})` : ''}"`);
        const l = [...lanes][0];
        // a name starts a person's run; a caption after a dot continues the run; one at the line's start or after a gap
        // with no name is the night's
        if (ch.prefix) lane = ch.prefix; else if (ch.after !== 'sep') lane = 'world';
        if (lanes.size > 1 || lane !== l) p.push(`${e.start} ms "${ch.words}": read as ${lane}'s, the cue is ${l}'s`);
      });
    });
  }
  for (const c of parsed.chips) {
    const cs = c.ids.map((id) => byId.get(id)), l = laneOfCue(cs[0]), word = c.runs.filter((r) => !r.mark && r.text.trim());
    if (word.some((r) => r.lane !== l)) p.push(`${key(c.ids)} burns in ${word[0].lane}'s colour, the cue is ${l}'s`);
    if (word.some((r) => r.italic !== offScreen(cs[0]))) p.push(`${key(c.ids)} burns italic ${!offScreen(cs[0])}, off screen ${offScreen(cs[0])}`);
    const want = cs[0].offered ? 'offered' : cs[0].new ? 'new' : '', got = c.runs.filter((r) => r.mark).map((r) => r.text).join('');
    if (got !== (want ? `(${want})` : '')) p.push(`${key(c.ids)} burns marked "${got}", want "${want ? `(${want})` : ''}"`);
  }
  return p;
}

// 9. Every cue the track carries is represented: listed in an entry; a step also by its tick, in the VTT and in the
// burn, crossing the playhead in its walker's row at its onset
function representationProblems(parsed, ass, cues = SHOWN) {
  const p = [], listed = new Set(parsed.entries.flatMap(idsIn));
  for (const c of cues) if (!listed.has(c.id)) p.push(`${c.id} is not in the track`);
  const moves = ass.split('\n').filter((l) => /\\move\(/.test(l)).map((l) => {
    const f = l.split(','), m = /\\move\(([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+)\)/.exec(l);
    const cs = (s) => { const [h, mm, x] = s.split(':'); return (+h * 3600 + +mm * 60 + +x); };
    return { a: cs(f[1]), b: cs(f[2]), x1: +m[1], y: +m[2], x2: +m[3] };
  });
  const playhead = laneX(0, 0);
  for (const c of cues.filter((x) => x.family === 'feet')) {
    const k = parsed.ticks.find((x) => x.id === c.id);
    if (!k) { p.push(`${c.id} has no tick`); continue; }
    if (k.t !== ms(c.t0) || k.person !== c.person || k.on === offScreen(c)) p.push(`${c.id} tick ${JSON.stringify(k)} against onset ${ms(c.t0)} ms, ${c.person}, off ${offScreen(c)}`);
    const t = k.t / 1000, y = LANE.top + LANE.pad + PEOPLE.indexOf(c.person) * (LANE.row + LANE.gap);
    const m = moves.find((v) => v.y === y && v.a <= t && t < v.b && Math.abs(v.x1 + ((v.x2 - v.x1) * (t - v.a)) / (v.b - v.a) - playhead) < 0.05);
    if (!m) p.push(`${c.id}: no tick in the burn crossing the playhead in ${c.person}'s row at ${t} s`);
  }
  return p;
}

// ---------- the track ----------
test('captions: layout from the frame: the band under the 11 px HUD strip, the lane under it, nothing in the bottom ninth', () => {
  assert.deepEqual([FRAME.w, FRAME.h, STRIP, SAFE], [480, 270, 11, 30]);
  assert.equal((SAFE / FRAME.h) * 1080, 120, 'the same band is the bottom 120 px at 1080p');
  assert.equal(BAND.top, STRIP);
  assert.ok(BAND.top + MAX_LINES * BAND.pitch <= LANE.top && LANE.bottom <= FRAME.h - SAFE, JSON.stringify(LANE));
  assert.equal(MIN_EVENT * 24, 20, '5/6 s is 20 frames at 24 fps');
});

test('captions: the densest moment decides how 3 lines hold everything; nothing is dropped; one busy stretch condensed', () => {
  const s = TRACK.stats;
  console.log(`  ${s.captions} captions of ${s.cues} cues in ${s.slices} moments; densest ${s.densest.captions} captions at ${s.densest.at} ms; condensed: ${JSON.stringify(s.condensed)}; ${s.offScreen} in italics, ${s.new} new, ${s.offered} offered`);
  assert.ok(s.densest.captions > MAX_LINES, 'one line per caption would need more than 3 lines somewhere, or no sharing would be needed');
  assert.ok(s.maxLines <= MAX_LINES);
  assert.equal(s.cues, SHOWN.length, 'every enabled and offered cue is carried, none dropped');
  assert.equal(s.ticks, CUES.filter((c) => c.family === 'feet').length);
  assert.equal(TRACK.captions.filter((c) => c.mark === 'offered').length, CUES.filter((c) => c.offered).length);
  assert.ok(s.condensed.every((x) => x.scale < 1 && BAND.condense.includes(x.scale)));
});

test('captions: each caption comes in at its cue\'s onset to the millisecond; planted shifts fail', () => {
  assert.deepEqual(inTimeProblems(PARSED), []);
  // controls: the entry where the driver's door unlatch first appears, 1 ms late; a stretch that comes in early
  const late = parseVtt(edit(VTT, '00:00:30.440 -->', '00:00:30.441 -->'));
  assert.ok(inTimeProblems(late).some((x) => x.startsWith('hard.door.driver.unlatch comes in at 30441')), inTimeProblems(late).join('\n'));
  const early = parseVtt(edit(VTT, '00:00:31.756 -->', '00:00:31.755 -->'));
  assert.ok(inTimeProblems(early).some((x) => /stretch comes in at 31755/.test(x)), inTimeProblems(early).join('\n'));
});

test('captions: each caption stays at least 5/6 s and until its cue ends, without a gap; planted cuts fail', () => {
  assert.deepEqual(outTimeProblems(PARSED), []);
  // controls: the run-down's last entry ends 100 ms early; an entry in the middle of the engine's drive dropped
  const rundown = PARSED.entries.filter((e) => idsIn(e).includes('hard.stop.car.rundown')).at(-1);
  assert.ok(outTimeProblems(withEntry(PARSED, rundown, { end: rundown.end - 100 })).some((x) => x.startsWith('hard.stop.car.rundown')));
  const mid = PARSED.entries.find((e) => e.start > 20000 && idsIn(e).includes('hard.engine.car.intake'));
  assert.ok(outTimeProblems({ ...PARSED, entries: PARSED.entries.filter((e) => e !== mid) }).some((x) => /hard\.engine\.car\.intake leaves the screen/.test(x)));
});

test('captions: at most 3 lines at once, entries never overlap; a fourth line or an overlap fails', () => {
  assert.deepEqual(lineProblems(PARSED), []);
  const e0 = PARSED.entries.find((e) => e.lines.length === MAX_LINES);
  assert.ok(lineProblems(withEntry(PARSED, e0, { lines: [...e0.lines, e0.lines[0]] })).some((x) => /^4 lines/.test(x)));
  assert.ok(lineProblems(withEntry(PARSED, e0, { start: e0.start - 1 })).some((x) => /entries overlap/.test(x)));
});

test('captions: the layout keeps every caption inside the band and off its neighbours, on the line the soft text lists it', () => {
  assert.deepEqual(layoutProblems(PARSED), []);
  assert.equal(PARSED.chips.length, TRACK.stats.captions, 'one layout line per caption');
  // controls: a caption pushed past the band's edge; one moved onto its neighbour; one listed on another line
  const wide = PARSED.chips.find((c) => c.x > 0);
  assert.ok(layoutProblems(withChip(PARSED, wide, { x: AVAIL - 10 })).some((x) => x.includes('outside the band')));
  const left = PARSED.chips.find((c) => c.x > 0 && PARSED.chips.some((d) => d.row === c.row && d.x === 0 && d.in < c.out && c.in < d.out));
  assert.ok(layoutProblems(withChip(PARSED, left, { x: 0 })).some((x) => x.includes('overlap on line')));
  assert.ok(layoutProblems(withChip(PARSED, left, { row: (left.row + 1) % MAX_LINES })).some((x) => /is listed on line \d, laid out on line/.test(x)));
});

test('captions: sticky: no caption changes line or order while on screen, and each burns at one place for its life; planted moves fail', () => {
  assert.deepEqual(stickyProblems(PARSED), []);
  assert.deepEqual(burnStickyProblems(ASS, PARSED), []);
  const moves = (parsed) => stickyProblems(parsed).length;
  // controls: in one entry two lines swap (ids and text together); two captions on one line swap
  const e0 = PARSED.entries.find((e, i) => i > 0 && e.lines.length === MAX_LINES && groupsOf(e).every((l) => l.length) && PARSED.entries[i - 1].end === e.start);
  const lines = e0.id.replace(/^\d+ /, '').split(' | ');
  const swapped = withEntry(PARSED, e0, { id: `${e0.id.match(/^\d+/)[0]} ${[lines[1], lines[0], ...lines.slice(2)].join(' | ')}`, lines: [e0.lines[1], e0.lines[0], ...e0.lines.slice(2)] });
  assert.ok(moves(swapped) > 0, 'a line swap moves its captions');
  assert.ok(stickyProblems(swapped).some((x) => / moves from line /.test(x)));
  // two captions that already shared a line in the entry before
  const shared = (e, i) => { const prev = groupsOf(PARSED.entries[i - 1]).map((l) => l.map(key).join(' ')); return groupsOf(e).findIndex((l) => l.length > 1 && prev.some((p) => p.includes(`${key(l[0])} ${key(l[1])}`))); };
  const e1 = PARSED.entries.find((e, i) => i > 0 && PARSED.entries[i - 1].end === e.start && shared(e, i) >= 0);
  const li = shared(e1, PARSED.entries.indexOf(e1)), ls = e1.id.replace(/^\d+ /, '').split(' | '), gs = ls[li].split(' ');
  ls[li] = [gs[1], gs[0], ...gs.slice(2)].join(' ');
  assert.ok(stickyProblems(withEntry(PARSED, e1, { id: `${e1.id.match(/^\d+/)[0]} ${ls.join(' | ')}` })).some((x) => / swap places on line /.test(x)));
  // the burn: one caption's event split in two, its second half 4 px to the right
  const c = PARSED.chips.find((x) => x.out - x.in > 2000), p = chipPos(c), mid = assTime((c.in + 1000) / 1000);
  const line = ASS.split('\n').find((l) => l.startsWith(`Dialogue: 1,${assTime(c.in / 1000)},${assTime(c.out / 1000)},`) && l.includes(`\\pos(${p.x},${p.y})`));
  const split = ASS.replace(line, `${line.replace(`,${assTime(c.out / 1000)},`, `,${mid},`)}\n${line.replace(`${assTime(c.in / 1000)},`, `${mid},`).replace(`\\pos(${p.x},`, `\\pos(${p.x + 4},`)}`);
  assert.ok(burnStickyProblems(split, PARSED).some((x) => x.startsWith(`${key(c.ids)}: 0 burn events`)), 'control: a caption that moves in the burn');
});

test('captions: one scale per busy stretch, kept for each caption\'s life; a planted second scale fails', () => {
  assert.deepEqual(stretchProblems(PARSED), []);
  const condensed = PARSED.chips.filter((c) => c.scale < 1);
  assert.ok(condensed.length > 0, 'the densest stretch is condensed');
  assert.equal(new Set(burnEvents(ASS).map((v) => v.fscx)).size, new Set(PARSED.chips.map((c) => c.scale)).size, 'the burn uses only the layout\'s scales');
  assert.ok(stretchProblems(withChip(PARSED, condensed[1], { scale: 1 })).some((x) => /uses scales/.test(x)));
});

test('captions: libass draws a caption no wider than the layout reserved for it', () => {
  // the widest caption of the track at full scale, drawn alone, against its reserved width; a control at the wrong size
  const full = PARSED.chips.filter((c) => c.scale === 1 && c.x > 0), widest = full.reduce((a, b) => (chipWidth(b) > chipWidth(a) ? b : a));
  const d = fresh('width'), ass = resolve(d, 'w.ass');
  const drawn = (fs) => {
    const one = toAss({ entries: [], ticks: [], chips: [{ ...widest, x: 0, row: 8, in: 0, out: 1000 }] }, { from: 0, to: 1, strip: false });
    writeFileSync(ass, fs ? one.replace(/\\fscx100\}/, `\\fscx100\\fs${fs}}`) : one);
    const raw = ff(['-f', 'lavfi', '-i', `color=black:s=${FRAME.w}x${FRAME.h}:d=1:r=${FPS}`, '-vf', burnFilter(ass), '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-']);
    let right = -1;
    const y0 = BAND.top + 8 * BAND.pitch;
    for (let y = y0; y < y0 + BAND.pitch; y++) for (let x = 0; x < FRAME.w; x++) if (raw[y * FRAME.w + x] > 40 && x > right) right = x;
    return right + 1 - BAND.margin;
  };
  const got = drawn(null), want = chipWidth({ ...widest, x: 0 });
  console.log(`  widest caption: drawn ${got} px, reserved ${want} px: "${runsText(widest.runs)}"`);
  // within a pixel above (the ink's edge), and a little below (this face's kerning narrows a line slightly)
  assert.ok(got <= want + 1 && got >= want - 4, `drawn ${got}, reserved ${want}`);
  const big = drawn(+(fontMetrics().size(FONT.em + 1)).toFixed(3));
  assert.ok(big > want + 1, `control: a size up must measure wider, got ${big}`);
});

test('captions: no cue id in burned text; ids only in the VTT identifiers and the SRT comment; planted ids fail', () => {
  assert.deepEqual(burnedIdProblems(ASS, PARSED), []);
  assert.ok(PARSED.entries.every((e) => idsIn(e).every((id) => IDS.has(id))), 'every identifier names real cues');
  const planted = parseVtt(edit(VTT, '\nthe lamp hums', '\nbg.hum.lamp.bed the lamp hums'));
  assert.ok(burnedIdProblems(ASS, planted).some((x) => x.startsWith('bg.hum.lamp.bed')));
  const plantedBurn = parseVtt(VTT.replace(/^(\S+ \d+ \d+ [\d.]+ \d+ \d+ )the lamp hums$/m, '$1bg.hum.lamp.bed'));
  assert.ok(burnedIdProblems(toAss(plantedBurn), PARSED).some((x) => x.startsWith('bg.hum.lamp.bed')), 'control: an id in the burn');
  // the SRT carries the ids in an empty font tag that ffmpeg's SRT reader drops; plain text would show
  const d = fresh('srt');
  const asText = (srt) => { const f = resolve(d, 'a.srt'); writeFileSync(f, srt); return spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', f, '-f', 'ass', '-'], { encoding: 'utf8' }).stdout; };
  const srt = toSrt(TRACK);
  // every entry's ids come back from its tags, whole, and none reaches the text ffmpeg reads
  const entries = srt.split('\n\n').filter(Boolean);
  entries.forEach((b, i) => assert.equal([...b.matchAll(/<font id="([^"]*)"><\/font>/g)].map((m) => m[1]).join(''), PARSED.entries[i].id.replace(/^\d+ /, ''), `SRT entry ${i + 1}`));
  assert.deepEqual(idHits(asText(srt).split('\n').filter((l) => l.startsWith('Dialogue'))), []);
  assert.ok(idHits([asText(srt.replace('<font id="', '<b>').replace('"></font>', '</b>'))]).length > 0, 'control: ids as text would show');
  // control: one tag longer than ffmpeg's reader keeps shows as text, which is why the ids are split
  const long = entries.find((b) => (b.match(/<font id="/g) ?? []).length > 1);
  assert.ok(long, 'some entry needs its ids split');
  assert.ok(idHits(asText(`${long.replace(/"><\/font><font id="/g, '')}\n`).split('\n').filter((l) => l.startsWith('Dialogue'))).length > 0, 'control: a long tag is shown');
  // top left like the VTT and the mov_text (F7): every SRT entry starts with {\an7}, and ffmpeg reads it as alignment 7
  assert.equal(SRT_POS, '{\\an7}');
  assert.ok(entries.every((b) => b.split('\n')[2].startsWith(SRT_POS)) && sdhSrt(sdhTrack()).split('\n\n').filter(Boolean).every((b) => b.split('\n')[2].startsWith(SRT_POS)));
  assert.match(asText(srt).split('\n').find((l) => l.startsWith('Dialogue')), /\{\\an7\}/);
});

test('captions: italics exactly for off-screen cues, the marks and the lanes, soft and burned; planted flips fail', () => {
  assert.deepEqual(styleProblems(PARSED), []);
  const off = TRACK.captions.find((c) => c.italic && c.lane === 'world');
  assert.ok(off, 'some caption is off screen');
  const flip = parseVtt(editCues(`\n<i>${off.words}</i>`, `\n${off.words}`));
  assert.ok(styleProblems(flip).some((x) => x.includes(`"${off.words}": italic false, off screen true`)), styleProblems(flip).join('\n'));
  const on = parseVtt(editCues('\nthe lamp hums', '\n<i>the lamp hums</i>'));
  assert.ok(styleProblems(on).some((x) => x.includes('"the lamp hums": italic true')));
  const unmarked = parseVtt(editCues('the car rises out of the quiet <c.new>(new)</c>', 'the car rises out of the quiet'));
  assert.ok(styleProblems(unmarked).some((x) => /"the car rises out of the quiet": marked "", want "\(new\)"/.test(x)), styleProblems(unmarked).join('\n'));
  const offered = parseVtt(editCues('<c.offered>(offered)</c>', '<c.new>(new)</c>'));
  assert.ok(styleProblems(offered).some((x) => x.includes('want "(offered)"')));
  const unmarkedBurn = parseVtt(edit(VTT, 'the car rises out of the quiet <c.new>(new)</c>', 'the car rises out of the quiet'));
  assert.ok(styleProblems(unmarkedBurn).some((x) => /burns marked "", want "\(new\)"/.test(x)), 'control: the burn\'s mark too');
  // a person's caption with its name dropped reads as the night's; a person's caption burned in the night's colour
  const unnamed = parseVtt(VTT.slice(0, BODY) + VTT.slice(BODY).replace(/\n((?:[^\n]*   )?)<c\.B>B: /, '\n$1<c.B>'));
  assert.ok(styleProblems(unnamed).some((x) => /read as world's, the cue is B's/.test(x)), styleProblems(unnamed).join('\n'));
  const b = PARSED.chips.find((c) => c.runs[0].lane === 'B');
  assert.ok(styleProblems(withChip(PARSED, b, { runs: b.runs.map((r) => ({ ...r, lane: 'world' })) })).some((x) => /burns in world's colour/.test(x)));
});

test('captions: every carried cue is represented, a step by its stretch and by its tick in the VTT and the burn', () => {
  assert.deepEqual(representationProblems(PARSED, ASS), []);
  const gone = { ...PARSED, entries: PARSED.entries.map((e) => ({ ...e, id: e.id.replace('hard.cabin.car.handbrake', 'hard.cabin.car.x') })) };
  assert.ok(representationProblems(gone, ASS).includes('hard.cabin.car.handbrake is not in the track'));
  const tick = PARSED.ticks.find((k) => k.id === 'foley.feet.B.10'), noTick = { ...PARSED, ticks: PARSED.ticks.filter((k) => k !== tick) };
  assert.ok(representationProblems(noTick, toAss(noTick)).some((x) => x.startsWith('foley.feet.B.10 has no tick')));
  const lateTick = parseVtt(edit(VTT, `B ${tick.t} `, `B ${tick.t + 50} `));
  const bad = representationProblems(lateTick, toAss(lateTick));
  assert.ok(bad.some((x) => x.startsWith('foley.feet.B.10 tick')), bad.join('\n'));
  assert.ok(representationProblems(PARSED, toAss(lateTick)).some((x) => x.startsWith('foley.feet.B.10: no tick in the burn')), 'control: a tick drawn 50 ms late misses the playhead');
  // the snowy sidewalk reads as a place, not "walks, walk" (F5 of the review)
  assert.ok(TRACK.captions.some((c) => c.words === 'walks, sidewalk') && TRACK.captions.every((c) => !/, walk$/.test(c.words)));
});

test('captions: the burn shows each caption from the first frame at or after its in-time, and the strip reads as the HUD', () => {
  // libass draws an event when its start is at or before the frame's time in ms (vf_subtitles truncates pts * 1000)
  const frameMs = (k) => Math.floor((k * 1000) / FPS);
  const shown = (t, k) => { const [h, m, x] = assTime(t).split(':'); return Math.round((+h * 3600 + +m * 60 + +x) * 1000) <= frameMs(k); };
  for (const c of PARSED.chips) {
    const k = frameAt(c.in);
    assert.ok(shown(c.in / 1000, k) && (k === 0 || !shown(c.in / 1000, k - 1)), `caption at ${c.in} ms`);
  }
  const strip = assVisibleText(ASS).filter((t) => /^S\d\d {2}/.test(t));
  assert.equal(strip.length, Math.round(T_TOTAL * FPS), 'one strip label per frame');
  assert.equal(strip[0], `S01  0:00.00  ${SHOTS[0].lens}mm  ${SHOTS[0].title}  [0:00 to 0:07]`);
  assert.ok(strip.every((t) => !DASH.test(t)));
});

// ---------- the SDH track ----------
// The source and the sound of each SDH text, written out by hand; a new text fails here until its split is written too
const SPLITS = {
  '[engine approaches]': ['engine', 'approaches'], '[car door opens]': ['car door', 'opens'], '[a boot crunches in the snow]': ['a boot', 'crunches in the snow'],
  '[car door shuts]': ['car door', 'shuts'], '[engine stops]': ['engine', 'stops'], '[lighter clicks]': ['lighter', 'clicks'], '[exhales]': [null, 'exhales'],
};
function sdhProblems(sdh) {
  const p = [], want = CUES.filter((c) => c.enabled && c.sdh).map((c) => c.id);
  if (JSON.stringify(sdh.map((s) => s.id)) !== JSON.stringify(want)) p.push(`SDH carries ${sdh.map((s) => s.id)}, want the plot-pertinent ${want}`);
  const named = [];
  for (const s of sdh) {
    const c = byId.get(s.id);
    if (!c?.sdh) { p.push(`${s.id} is not plot pertinent`); continue; }
    if (s.text !== s.text.toLowerCase() || !/^\[[^[\]]+\]$/.test(s.text)) p.push(`${s.id} "${s.text}" is not lowercase in brackets`);
    if (!SPLITS[c.sdh]) { p.push(`${s.id}: no split written for "${c.sdh}"`); continue; }
    const [source, sound] = SPLITS[c.sdh];
    // seen: on screen, and the ground line from the camera to it clear of every building
    const pt = c.place?.(c.t0), seen = !offScreen(c) && Boolean(pt) && visibleFrom(cameraAt(shotAt(c.t0), c.t0).pos, [pt[0], pt[2]]);
    // still sounding: the voice group's enabled cues cover the span since an earlier caption named it
    const group = CUES.filter((x) => x.enabled && x.source === c.source).sort((a, b) => a.t0 - b.t0);
    const covers = (a, b) => { let t = a; for (const x of group) if (x.t0 <= t + 1e-9 && x.t1 > t) t = x.t1; return t >= b; };
    const kept = named.some((n) => n.source === c.source && covers(n.t0, c.t0));
    const say = Boolean(source) && !seen && !kept;
    if (say) named.push({ source: c.source, t0: c.t0 });
    const text = `[${say ? `${source} ` : ''}${sound}]`;
    if (s.text !== text) p.push(`${s.id} reads "${s.text}", want "${text}" (seen ${seen}, still sounding ${kept})`);
    if (s.in !== ms(c.t0) || s.out - s.in < ms(MIN_EVENT) || s.out - s.in > SDH_MAX * 1000) p.push(`${s.id} ${s.in} to ${s.out} ms`);
  }
  for (const s of sdh) if (sdh.filter((x) => x.in <= s.in && x.out > s.in).length > SDH_LINES) p.push(`more than ${SDH_LINES} SDH lines at ${s.in} ms`);
  return p;
}

test('SDH: plot-pertinent cues only, lowercase, brackets, the source named only when not seen and not again while it sounds', () => {
  const sdh = sdhTrack();
  for (const s of sdh) console.log(`  ${(s.in / 1000).toFixed(3)} ${s.text}  (${s.id})`);
  assert.deepEqual(sdhProblems(sdh), []);
  const by = Object.fromEntries(sdh.map((s) => [s.id, s]));
  assert.equal(by['hard.engine.car.intake'].text, '[engine approaches]', 'the engine at the first light is in frame but behind a building: named');
  assert.equal(by['hard.stop.car.rundown'].kept, true, 'the engine has sounded since it was named');
  // controls: a source named on screen, an off-screen source unnamed, a capital, a cue that is not plot pertinent,
  // three at once, a late in-time
  const plant = (id, patch) => sdh.map((s) => (s.id === id ? { ...s, ...patch } : s));
  assert.ok(sdhProblems(plant('hard.door.passenger.unlatch', { text: '[car door opens]' })).some((x) => x.startsWith('hard.door.passenger.unlatch reads')));
  assert.ok(sdhProblems(plant('hard.door.driver.unlatch', { text: '[opens]' })).some((x) => x.startsWith('hard.door.driver.unlatch reads')));
  assert.ok(sdhProblems(plant('foley.lighter.A.strike', { text: '[Clicks]' })).some((x) => /not lowercase/.test(x)));
  assert.ok(sdhProblems([...sdh, { id: 'hard.tick.car.01', in: 37700, out: 38533, text: '[ticks]' }]).length > 0);
  const crunch = sdh.find((s) => s.id === 'foley.feet.A.01');
  assert.ok(sdhProblems([...sdh, crunch].sort((a, b) => a.in - b.in)).some((x) => x === `more than ${SDH_LINES} SDH lines at 31940 ms`));
  assert.ok(sdhProblems(plant('hard.door.passenger.unlatch', { in: 31100 })).some((x) => x.startsWith('hard.door.passenger.unlatch 31100 to')));
  const vtt = sdhVtt(sdh), srt = sdhSrt(sdh);
  assert.equal(parseVtt(vtt).entries.length, sdh.length);
  assert.ok(parseVtt(vtt).entries.every((e, i) => e.id === sdh[i].id && e.start === sdh[i].in && runsText(e.lines[0]) === sdh[i].text));
  assert.equal((srt.match(/<font id="/g) ?? []).length, sdh.length);
});

test('SDH: the source and verb split matches the hand-written splits; plural, possessive and two-verb texts are refused (F4)', () => {
  const texts = [...new Set(CUES.filter((c) => c.sdh).map((c) => c.sdh))];
  for (const t of texts) {
    assert.ok(SPLITS[t], `write the split of ${t} into SPLITS`);
    assert.deepEqual(Object.values(sdhSplit(t)), SPLITS[t], t);
  }
  // every verb the parser knows is used, so the list is no wider than the texts
  for (const v of SDH_VERBS) assert.ok(texts.some((t) => sdhSplit(t).sound.split(' ')[0] === v), `${v} is used`);
  // controls: the old rule (the first word ending in s is the verb) misread these; now each is refused, loudly
  for (const t of ['[tyres crunch]', '[doors slam shut]', '[A\'s boots crunch]', '[the door opens and shuts]', 'car door opens']) assert.throws(() => sdhSplit(t), /verbs of SDH_VERBS|not one bracketed/, t);
  const bad = CUES.map((c) => (c.id === 'hard.door.driver.unlatch' ? { ...c, sdh: '[tyres crunch]' } : c));
  assert.throws(() => sdhTrack(bad), /\[tyres crunch\] holds 0 verbs/);
});

test('captions: a second build gives the same bytes; no em or en dashes in the files or the outputs', () => {
  assert.equal(toVtt(reviewTrack()), VTT);
  assert.equal(toAss(parseVtt(VTT)), ASS);
  assert.equal(sdhVtt(sdhTrack()), sdhVtt(sdhTrack()));
  for (const f of ['scripts/lib/captions.js', 'scripts/spotting-reel.js', 'tests/captions.test.mjs']) assert.ok(!DASH.test(readFileSync(resolve(ROOT, f), 'utf8')), f);
  for (const t of [VTT, ASS, toSrt(TRACK), sdhVtt(sdhTrack())]) assert.ok(!DASH.test(t));
});

// ---------- the reel ----------
let reelPromise = null;
const reel = () => (reelPromise ??= spottingReel({ outdir: fresh('reel'), source: SOURCE, log: () => {} }));
const haveSource = existsSync(SOURCE);
const why = haveSource ? false : `no published export at ${SOURCE}`;

// The soft track as a libass player draws it over the picture (F2 of the review): one frame for each entry a frame
// shows, the lines found as bands of ink, each placed in its line's slot by the style's own pitch; every entry must draw
// exactly its non-empty lines in their slots, at most MAX_LINES (no wrap, no line lost, none moved)
function softLineProblems(file, vtt, { w = 1920, h = 1080 } = {}) {
  const entries = parseVtt(vtt).entries.filter((e) => frameAt(e.start) < frameAt(e.end));
  const st = subtitleStyle(file), pitch = (st.size * h) / st.playResY, top = (st.marginV * h) / st.playResY;
  const sel = entries.map((e) => `eq(n\\,${frameAt(e.start)})`).join('+');
  const g = ff(['-f', 'lavfi', '-i', `color=black:s=${w}x${h}:r=${FPS}:d=${T_TOTAL}`, '-vf', `subtitles=filename=${file},select='${sel}'`, '-vsync', '0', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], 1 << 30);
  const p = [], n = g.length / (w * h);
  if (n !== entries.length) p.push(`drew ${n} frames for ${entries.length} entries`);
  let most = 0;
  for (let f = 0; f < Math.min(n, entries.length); f++) {
    const bands = [];
    let cur = null;
    for (let y = 0; y < h; y++) {
      let ink = false;
      for (let x = 0; x < w && !ink; x++) ink = g[f * w * h + y * w + x] > 80;
      if (ink) { if (cur && y - cur.y1 <= 1) cur.y1 = y; else { cur = { y0: y, y1: y }; bands.push(cur); } }
    }
    const e = entries[f], want = e.lines.flatMap((l, i) => (runsText(l).trim() ? [i] : []));
    const got = bands.map((b) => Math.floor(((b.y0 + b.y1) / 2 - top) / pitch));
    most = Math.max(most, bands.length);
    if (JSON.stringify(got) !== JSON.stringify(want)) p.push(`${e.start} ms: lines drawn in slots ${got}, the text has ${want}`);
  }
  if (most > MAX_LINES) p.push(`${most} lines drawn at once`);
  return p;
}

test('reel: the soft copy is the published picture bit for bit with the review track as mov_text, top left, no audio, no line wrapped', { skip: why }, async () => {
  const r = await reel();
  const softProblems = async (file) => {
    const p = [], probe = await ffprobe(file), src = await ffprobe(SOURCE);
    if (videoHash(file) !== videoHash(SOURCE)) p.push('the video stream is not the source\'s bytes');
    if (probe.audioStreams !== 0) p.push(`${probe.audioStreams} audio streams`);
    let text = '';
    try { text = subtitleText(file); } catch { p.push('no subtitle stream'); }
    if (text && !text.includes('street: city, wind')) p.push('the captions are not the review track');
    p.push(...idHits(text ? [text] : []));
    const j = movTextEntries(file).map((x) => x.justification);
    if (JSON.stringify(j) !== '[[0,0]]') p.push(`justification ${JSON.stringify(j)}`);
    if (probe.frames !== src.frames) p.push(`${probe.frames} frames`);
    return p;
  };
  assert.deepEqual(await softProblems(r.soft), []);
  const side = JSON.parse(readFileSync(`${r.soft}.json`, 'utf8'));
  assert.equal(side.videoMd5.copy, side.videoMd5.source);
  assert.equal(side.subtitles.codec, 'mov_text');
  assert.ok(Math.abs(side.subtitles.duration - T_TOTAL) <= 1 / FPS, `captions last ${side.subtitles.duration} s`);
  assert.equal(side.counts.cues, SHOWN.length);
  // the style a libass player gets: the fitted size everywhere (no per-run size), top left
  const st = subtitleStyle(r.soft);
  console.log(`  soft track: ${st.font} ${st.size} (ffmpeg's default ${side.softFont.from}), widest line ${side.softFont.widestEm} em of a ${side.softFont.wrapPx} px wrap at ${side.softFont.frame.join('x')}`);
  assert.deepEqual([st.size, st.alignment, st.sizeOverrides], [side.softFont.size, 7, 0]);
  assert.ok(st.size < side.softFont.from, 'smaller than ffmpeg\'s default, which wraps (the control below)');
  assert.deepEqual(movTextEntries(r.soft), [{ justification: [0, 0], size: st.size }]);
  // every entry draws its lines in their slots and never wraps; the same track at ffmpeg's default size does
  const vtt = readFileSync(r.files.vtt, 'utf8');
  const lines = softLineProblems(r.soft, vtt);
  assert.deepEqual(lines, []);
  const d = fresh('soft-default'), control = resolve(d, 'default.mp4');
  ff(['-i', SOURCE, '-i', r.files.vtt, '-map', '0:v:0', '-map', '1:s:0', '-c:v', 'copy', '-c:s', 'mov_text', '-an', control]);
  topJustify(control);
  const wrapped = softLineProblems(control, vtt);
  console.log(`  control at size ${subtitleStyle(control).size}: ${wrapped.length} entries drawn wrong, e.g. ${wrapped[0]}`);
  assert.ok(wrapped.length > 0 && wrapped.some((x) => /lines drawn at once/.test(x)), 'control: the default size wraps into more than 3 lines');
  // control: the phone copy is not the source's picture and has no captions stream
  const bad = await softProblems(r.phone);
  assert.ok(bad.includes('the video stream is not the source\'s bytes') && bad.includes('no subtitle stream'), bad.join('; '));
  // the same inputs give the same bytes
  const again = resolve(fresh('soft-again'), NAMES.soft);
  await softCopy({ source: SOURCE, vtt: r.files.vtt, out: again });
  assert.ok(readFileSync(again).equals(readFileSync(r.soft)), 'two soft copies differ');
});

// An ffmpeg first on PATH that changes the soft copy's encode (the one call with -c:s mov_text) and runs the real one:
// drop: argument pairs removed; remove: single arguments removed; swap: argument pairs replaced; suffix: an argument
// ending in a suffix replaced by a path; add: arguments put before the output
function plantedFfmpeg(dir) {
  const real = spawnSync('sh', ['-c', 'command -v ffmpeg'], { encoding: 'utf8' }).stdout.trim();
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'plant.cjs'), `const { spawnSync } = require('node:child_process');
const p = JSON.parse(process.env.PLANT || '{}');
let a = process.argv.slice(2);
if (a.includes('mov_text')) {
  for (const [x, y] of p.drop ?? []) { const i = a.findIndex((v, k) => v === x && a[k + 1] === y); if (i >= 0) a.splice(i, 2); }
  for (const x of p.remove ?? []) a = a.filter((v) => v !== x);
  for (const [x, y, x2, y2] of p.swap ?? []) { const i = a.findIndex((v, k) => v === x && a[k + 1] === y); if (i >= 0) a.splice(i, 2, x2, y2); }
  for (const [s, path] of p.suffix ?? []) a = a.map((v) => (v.endsWith(s) ? path : v));
  if (p.add) a.splice(a.length - 1, 0, ...p.add);
}
process.exit(spawnSync(process.env.PLANT_REAL, a, { stdio: 'inherit' }).status ?? 1);
`);
  writeFileSync(resolve(dir, 'ffmpeg'), `#!/bin/sh\nexec "${process.execPath}" "${resolve(dir, 'plant.cjs')}" "$@"\n`);
  chmodSync(resolve(dir, 'ffmpeg'), 0o755);
  return { PATH: `${dir}${delimiter}${process.env.PATH}`, PLANT_REAL: real };
}
// run fn with the planted ffmpeg first on this process's PATH (softCopy spawns ffmpeg itself), then restore it
async function planted(env, plant, fn) {
  const was = { PATH: process.env.PATH, PLANT: process.env.PLANT, PLANT_REAL: process.env.PLANT_REAL };
  Object.assign(process.env, env, { PLANT: JSON.stringify(plant) });
  try { return await fn(); } finally { for (const [k, v] of Object.entries(was)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}

test('reel: the soft copy refuses each fault its guards name, and keeps nothing at the output (F3)', { skip: why }, async () => {
  const d = fresh('soft-plants'), short = resolve(d, 'short.mp4'), vtt = resolve(d, 'short.vtt');
  // two seconds of the export, every stream copied (the audio too, for the audio plant), with two busy seconds of the
  // track (31 to 33 s), whose long lines need a size below ffmpeg's default
  ff(['-i', SOURCE, '-map', '0', '-c', 'copy', '-frames:v', String(2 * FPS), '-t', '2', short]);
  writeFileSync(vtt, clipVtt(VTT, 31, 33));
  const out = (n) => resolve(d, `${n}.mp4`), good = await softCopy({ source: short, vtt, out: out('good') });
  assert.equal(good.subtitles.streams, 1, 'the unplanted copy passes');
  const env = plantedFfmpeg(resolve(d, 'bin'));
  const cases = [
    ['reencoded', { swap: [['-c:v', 'copy', '-c:v', 'libx264']] }, /the video stream is not the source's bytes/],
    ['audio', { remove: ['-an'], add: ['-map', '0:a:0', '-c:a', 'copy'] }, /1 audio streams, want none/],
    ['nosubs', { drop: [['-map', '1:s:0']] }, /0 subtitle streams, want one/],
    ['default-size', { suffix: [['.soft.ass', vtt]] }, /the soft font size is 16, want \d+/],
  ];
  for (const [name, plant, msg] of cases) {
    await planted(env, plant, () => assert.rejects(softCopy({ source: short, vtt, out: out(name) }), msg, name));
    assert.ok(!existsSync(out(name)), `${name}: nothing at the output`);
  }
  // a caption that outlasts the picture
  const late = resolve(d, 'late.vtt');
  writeFileSync(late, `${readFileSync(vtt, 'utf8')}\n00:00:04.000 --> 00:00:05.000\nlate\n`);
  await assert.rejects(softCopy({ source: short, vtt: late, out: out('late') }), /captions last 5 s, want 2/);
  assert.ok(!existsSync(out('late')));
});

test('reel: the phone copy is 480x270, silent, nothing drawn in the bottom 30 px on any frame; a planted drawing there fails', { skip: why }, async () => {
  const r = await reel();
  const p = await ffprobe(r.phone);
  assert.deepEqual([p.width, p.height, p.frames, p.audioStreams, p.codec, p.color_space], [FRAME.w, FRAME.h, Math.round(T_TOTAL * FPS), 0, 'h264', 'bt709']);
  const side = JSON.parse(readFileSync(`${r.phone}.json`, 'utf8'));
  assert.equal(side.bottomBand.equal, true, 'every frame, before the encode');
  assert.deepEqual(side.bottomBand.rows, [FRAME.h - SAFE, FRAME.h]);
  // a busy stretch again, and the encoded file: its bottom rows against the source's scaled rows, beside an unburned
  // encode of the same stretch (the encoder's own error is the bar)
  const d = fresh('band'), from = 31, seconds = 6, parsedSeg = parseVtt(readFileSync(r.files.vtt, 'utf8'));
  const segAss = resolve(d, 'seg.ass');
  writeFileSync(segAss, toAss(parsedSeg, { from, to: from + seconds, strip: true }));
  assert.equal(bottomBand({ source: SOURCE, ass: segAss, from, seconds, scratch: resolve(d, 'b') }).equal, true);
  const rows = (args) => ff([...args, '-vf', `crop=${FRAME.w}:${SAFE}:0:${FRAME.h - SAFE}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  const src = ff(['-ss', String(from), '-t', String(seconds), '-i', SOURCE, '-vf', `${SCALE},crop=${FRAME.w}:${SAFE}:0:${FRAME.h - SAFE}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  const err = (buf) => { let s = 0, m = 0; for (let i = 0; i < buf.length; i++) { const e = Math.abs(buf[i] - src[i]); s += e; if (e > m) m = e; } return { mean: s / buf.length, max: m }; };
  const enc = (vf, out) => { ff(['-ss', String(from), '-t', String(seconds), '-i', SOURCE, '-map', '0:v:0', '-vf', vf, ...previewCodec(), '-pix_fmt', 'yuv420p', '-an', ...BT709_TAGS, out]); return out; };
  const control = err(rows(['-i', enc(SCALE, resolve(d, 'control.mp4'))]));
  const burned = err(rows(['-ss', String(from), '-t', String(seconds), '-i', r.phone]));
  // a planted caption in the bottom band: the first line's captions moved there
  const plantedAss = resolve(d, 'planted.ass');
  writeFileSync(plantedAss, readFileSync(segAss, 'utf8').replace(new RegExp(`\\\\pos\\((\\d+),${BAND.top}\\)`, 'g'), `\\pos($1,${FRAME.h - SAFE + 5})`));
  assert.ok(readFileSync(plantedAss, 'utf8') !== readFileSync(segAss, 'utf8'), 'the plant moved a line');
  const planted = err(rows(['-i', enc(`${SCALE},${burnFilter(plantedAss)}`, resolve(d, 'planted.mp4'))]));
  console.log(`  bottom ${SAFE} rows against the source, ${from} to ${from + seconds} s: unburned encode mean ${control.mean.toFixed(3)} max ${control.max}; phone copy mean ${burned.mean.toFixed(3)} max ${burned.max}; planted line mean ${planted.mean.toFixed(3)} max ${planted.max}`);
  // the bar: the encoder's own error on these rows plus a margin (starting values; measured on 31 to 37 s: unburned
  // mean 2.92 max 25, the phone copy mean 2.91 max 21, a planted line mean 3.08 max 217)
  const bar = (e) => e.mean <= control.mean * 1.25 + 0.5 && e.max <= control.max + 16;
  assert.ok(bar(burned), 'the phone copy\'s bottom rows are the encoder\'s error only');
  assert.ok(!bar(planted), 'control: a line drawn in the bottom band fails the bar');
  assert.equal(bottomBand({ source: SOURCE, ass: plantedAss, from, seconds, scratch: resolve(d, 'c') }).equal, false, 'control: the frame digests see it too');
  await assert.rejects(phoneCopy({ source: SOURCE, ass: plantedAss, out: resolve(d, 'refused.mp4'), from, seconds }), /drawn in the bottom 30 rows/);
  // the same stretch twice gives the same bytes
  const one = await phoneCopy({ source: SOURCE, ass: segAss, out: resolve(d, 'one.mp4'), from, seconds });
  await phoneCopy({ source: SOURCE, ass: segAss, out: resolve(d, 'two.mp4'), from, seconds });
  assert.equal(one.probe.frames, seconds * FPS);
  assert.ok(readFileSync(resolve(d, 'one.mp4')).equals(readFileSync(resolve(d, 'two.mp4'))), 'two phone copies of one stretch differ');
});

test('reel: the caption files are written, the VTT is the track, and a second write gives the same bytes', { skip: why }, async () => {
  const r = await reel();
  assert.equal(readFileSync(r.files.vtt, 'utf8'), VTT);
  const again = writeCaptions(fresh('captions-again'));
  for (const k of Object.keys(again.files)) assert.ok(readFileSync(again.files[k]).equals(readFileSync(r.files[k])), k);
  assert.ok(existsSync(r.files.softAss), 'the soft copy\'s track as encoded');
  assert.ok(readFileSync(r.files.ass, 'utf8').includes(`PlayResX: ${FRAME.w}`));
  assert.ok(fontFile().endsWith('.ttf'));
  assert.ok(lineWidth('x') > 0);
});
