// Checks for the captions (scripts/lib/captions.js) and the spotting reel (scripts/spotting-reel.js), SOUND-PLAN 3.16
// and ROADMAP Sound 1.10. Each check is a function returning its problems, read from the written files (the VTT, the
// ASS, the MP4s) and re-derived from the cues here, not from the module's own bookkeeping; the real track must give
// none, and a planted fault must give some.
// The reel is made once from the published export into $CAPTION_TEST_OUT or a temp folder (about 30 s).
// Run: node --test tests/captions.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ROOT } from '../scripts/lib/browser.mjs';
import { BT709_TAGS, ffprobe } from '../scripts/lib/ffmpeg.mjs';
import { visibleFrom } from '../scripts/lib/checks.js';
import { makeCamera } from '../scripts/lib/math.js';
import { PW, PH } from '../scripts/lib/panel.js';
import {
  AVAIL, BAND, FONT, FRAME, LANE, MAX_LINES, MIN_EVENT, SAFE, SDH_LINES, SDH_MAX, STRIP, assTime, assVisibleText, burnFilter, fontFile,
  fontMetrics, laneX, lineWidth, movTextJustification, parseVtt, reviewTrack, runsText, sdhSrt, sdhTrack, sdhVtt, subtitleText, toAss, toSrt, toVtt,
} from '../scripts/lib/captions.js';
import { NAMES, SCALE, bottomBand, phoneCopy, previewCodec, softCopy, spottingReel, writeCaptions } from '../scripts/spotting-reel.js';
import { videoHash } from '../scripts/mux.js';
import { CUES, WORLD } from '../src/audio/cues.js';
import { CONFIG } from '../src/config.js';
import { SHOTS, cameraAt, shotAt } from '../src/shots.js';
import { T_TOTAL } from '../src/world.js';

const OUT = process.env.CAPTION_TEST_OUT ?? join(tmpdir(), 'snowy-bridge-caption-test');
const SOURCE = resolve(ROOT, 'out/snowy-bridge.mp4');
const DASH = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`); // built from code points so this file holds neither
const FPS = CONFIG.fps;
const ms = (t) => Math.round(t * 1000);
const SHOWN = CUES.filter((c) => c.enabled || c.offered); // every cue the review track carries: offered ones too
const IDS = new Set(CUES.map((c) => c.id)), byId = new Map(CUES.map((c) => [c.id, c]));
const PEOPLE = Object.keys(WORLD.PEOPLE);
mkdirSync(OUT, { recursive: true });
const fresh = (name) => { const d = resolve(OUT, name); rmSync(d, { recursive: true, force: true }); mkdirSync(d, { recursive: true }); return d; };
const ff = (args) => { const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { maxBuffer: 1 << 28 }); assert.equal(r.status, 0, String(r.stderr)); return r.stdout; };

const TRACK = reviewTrack();
const VTT = toVtt(TRACK), PARSED = parseVtt(VTT), ASS = toAss(PARSED);
const edit = (text, from, to) => { assert.ok(text.includes(from), `the plant needs "${from}"`); return text.replace(from, to); };

// ---------- reading the VTT back, independently of the writer's model ----------
// The ids of an entry: its identifier after the running number, lines by |, captions by a space, a caption's ids by +
const groupsOf = (e) => e.id.replace(/^\d+ /, '').split(' | ').map((l) => l.split(' ').map((g) => g.split('+')));
const idsIn = (e) => groupsOf(e).flat(2);
// A line's captions with their styles: split at the middle dot and the lane gap; a lane's "A: " and a count dropped
function chunksOf(runs) {
  const chars = runs.flatMap((r) => [...r.text].map((ch) => ({ ch, italic: r.italic, mark: r.mark })));
  const text = chars.map((c) => c.ch).join(''), out = [];
  let at = 0;
  for (const part of text.split(/ · | {3}/)) {
    const start = text.indexOf(part, at), cs = chars.slice(start, start + part.length);
    at = start + part.length;
    const markChars = cs.filter((c) => c.mark), mark = markChars.length ? markChars[0].mark : '';
    let words = cs.filter((c) => !c.mark).map((c) => c.ch).join('').replace(/ $/, '');
    const prefix = PEOPLE.find((p) => words.startsWith(`${p}: `));
    const skip = prefix ? prefix.length + 2 : 0, count = /( ×\d+)$/.exec(words);
    const wordChars = cs.filter((c) => !c.mark).slice(skip, skip + words.length - skip - (count ? count[1].length : 0));
    words = words.slice(skip, words.length - (count ? count[1].length : 0));
    const it = new Set(wordChars.filter((c) => c.ch !== ' ').map((c) => c.italic));
    out.push({ words, mark, italic: it.size === 1 ? [...it][0] : 'mixed', mark2: markChars.map((c) => c.ch).join('') });
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

// 3. At most MAX_LINES lines at once, each within the band's width at a scale the burn may use
function lineProblems(parsed, metrics = fontMetrics()) {
  const p = [];
  let last = -1;
  for (const e of parsed.entries) {
    if (e.start < last) p.push(`entries overlap at ${e.start} ms: a player would stack more lines`);
    last = e.end;
    if (e.lines.length > MAX_LINES) p.push(`${e.lines.length} lines at ${e.start} ms`);
    if (!BAND.condense.some((s) => e.lines.every((l) => lineWidth(runsText(l), s, metrics) <= AVAIL))) p.push(`a line at ${e.start} ms is wider than ${AVAIL} px at every scale`);
  }
  return p;
}

// 4. No cue id in burned text: the ASS's dialogue as drawn, and the VTT's cue text, hold no id
const idHits = (texts) => texts.flatMap((t) => [...IDS].filter((id) => t.includes(id)).map((id) => `${id} in "${t.slice(0, 60)}"`));
const burnedIdProblems = (ass, parsed) => [...idHits(assVisibleText(ass)), ...idHits(parsed.entries.flatMap((e) => e.lines.map(runsText)))];

// 5 and 6. Italics exactly for off-screen cues, and the marks: each caption's words in italics when its cue is off
// screen at its onset (all the cues a caption carries agree), "(offered)" on offered cues, "(new)" on other new ones
function styleProblems(parsed) {
  const p = [];
  for (const e of parsed.entries) {
    const groups = groupsOf(e);
    if (groups.length !== e.lines.length) { p.push(`${e.start} ms: ${groups.length} id lines for ${e.lines.length} text lines`); continue; }
    e.lines.forEach((runs, i) => {
      const chunks = chunksOf(runs);
      if (chunks.length !== groups[i].length) { p.push(`${e.start} ms line ${i + 1}: ${chunks.length} captions for ${groups[i].length} id groups`); return; }
      chunks.forEach((ch, j) => {
        const cs = groups[i][j].map((id) => byId.get(id));
        if (cs.some((c) => !c)) { p.push(`${e.start} ms: an unknown id in ${groups[i][j]}`); return; }
        const off = new Set(cs.map(offScreen)), marks = new Set(cs.map((c) => (c.offered ? 'offered' : c.new ? 'new' : '')));
        if (off.size > 1) p.push(`${groups[i][j]}: one caption for cues on and off screen`);
        if (ch.italic !== [...off][0]) p.push(`${e.start} ms "${ch.words}": italic ${ch.italic}, off screen ${[...off][0]}`);
        const want = [...marks][0];
        if (marks.size > 1 || ch.mark !== want || (want && ch.mark2 !== `(${want})`)) p.push(`${e.start} ms "${ch.words}": marked "${ch.mark2}", want "${want ? `(${want})` : ''}"`);
      });
    });
  }
  return p;
}

// 7. Every cue the track carries is represented: listed in an entry; a step also by its tick, in the VTT and in the
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

test('captions: the densest moment decides how 3 lines hold everything; nothing is dropped', () => {
  const s = TRACK.stats;
  console.log(`  ${s.captions} captions of ${s.cues} cues in ${s.slices} moments; densest ${s.densest.captions} captions at ${s.densest.at} ms; lanes share a line ${s.shared.ms} ms, condensed ${s.condensed.ms} ms (scale down to ${s.condensed.minScale}); ${s.offScreen} in italics, ${s.new} new, ${s.offered} offered`);
  assert.ok(s.densest.captions > MAX_LINES, 'one line per caption would need more than 3 lines somewhere, or no merge would be needed');
  assert.ok(s.maxLines <= MAX_LINES);
  assert.equal(s.cues, SHOWN.length, 'every enabled and offered cue is carried, none dropped');
  assert.equal(s.ticks, CUES.filter((c) => c.family === 'feet').length);
  assert.equal(TRACK.captions.filter((c) => c.mark === 'offered').length, CUES.filter((c) => c.offered).length);
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
  const short = { ...PARSED, entries: PARSED.entries.map((e) => (e === rundown ? { ...e, end: e.end - 100 } : e)) };
  assert.ok(outTimeProblems(short).some((x) => x.startsWith('hard.stop.car.rundown')), outTimeProblems(short).join('\n'));
  const mid = PARSED.entries.find((e) => e.start > 20000 && idsIn(e).includes('hard.engine.car.intake'));
  const gap = { ...PARSED, entries: PARSED.entries.filter((e) => e !== mid) };
  assert.ok(outTimeProblems(gap).some((x) => /hard\.engine\.car\.intake leaves the screen/.test(x)));
});

test('captions: at most 3 lines at once, each within the band; a fourth line or an overlong one fails', () => {
  assert.deepEqual(lineProblems(PARSED), []);
  const e0 = PARSED.entries.find((e) => e.lines.length === MAX_LINES);
  const four = { ...PARSED, entries: PARSED.entries.map((e) => (e === e0 ? { ...e, lines: [...e.lines, e.lines[0]] } : e)) };
  assert.ok(lineProblems(four).some((x) => /^4 lines/.test(x)));
  const wide = { ...PARSED, entries: PARSED.entries.map((e) => (e === e0 ? { ...e, lines: [[{ text: e.lines.map(runsText).join(' '), italic: false, lane: 'world', mark: '' }]] } : e)) };
  assert.ok(lineProblems(wide).some((x) => /wider than/.test(x)));
});

test('captions: libass draws a line no wider than the layout measured it', () => {
  // the widest line of the track at full scale, drawn alone, against its measured width; a control at the wrong size
  const lines = PARSED.entries.flatMap((e) => e.lines.map(runsText)).filter((l) => lineWidth(l) <= AVAIL);
  const widest = lines.reduce((a, b) => (lineWidth(b) > lineWidth(a) ? b : a));
  const d = fresh('width'), ass = resolve(d, 'w.ass');
  const drawn = (fs) => {
    writeFileSync(ass, `${toAss({ entries: [], ticks: [] }, { from: 0, to: 1, strip: false })}Dialogue: 9,0:00:00.00,0:00:01.00,Band,,0,0,0,,{\\an7\\pos(0,100)${fs ? `\\fs${fs}` : ''}}${widest}\n`);
    const raw = ff(['-f', 'lavfi', '-i', `color=black:s=${FRAME.w}x${FRAME.h}:d=1:r=${FPS}`, '-vf', burnFilter(ass), '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-']);
    let right = -1;
    for (let y = 98; y < 114; y++) for (let x = 0; x < FRAME.w; x++) if (raw[y * FRAME.w + x] > 40 && x > right) right = x;
    return right + 1;
  };
  const got = drawn(null), want = lineWidth(widest);
  console.log(`  widest line: drawn ${got} px, measured ${want.toFixed(1)} px: "${widest}"`);
  // within a pixel above (the ink's edge), and a little below (this face's kerning narrows a line slightly)
  assert.ok(got <= want + 1 && got >= want - 3, `drawn ${got}, measured ${want}`);
  const big = drawn(+(fontMetrics().size(FONT.em + 1)).toFixed(3));
  assert.ok(big > want + 1, `control: a size up must measure wider, got ${big}`);
});

test('captions: no cue id in burned text; ids only in the VTT identifiers and the SRT comment; planted ids fail', () => {
  assert.deepEqual(burnedIdProblems(ASS, PARSED), []);
  assert.ok(PARSED.entries.every((e) => idsIn(e).every((id) => IDS.has(id))), 'every identifier names real cues');
  const planted = parseVtt(edit(VTT, '\nstreet: city, wind', '\nbg.city.street.bed street: city, wind'));
  assert.ok(burnedIdProblems(toAss(planted), planted).some((x) => x.startsWith('bg.city.street.bed')));
  // the SRT carries the ids in an empty font tag that ffmpeg's SRT reader drops; plain text would show
  const d = fresh('srt');
  const asText = (srt) => { const f = resolve(d, 'a.srt'); writeFileSync(f, srt); return spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', f, '-f', 'ass', '-'], { encoding: 'utf8' }).stdout; };
  const srt = toSrt(TRACK);
  assert.ok(srt.includes('<font id="bg.city.street.bed+bg.wind.street.bed bg.hum.lamp.bed">'));
  // every entry's ids come back from its tags, whole, and none reaches the text ffmpeg reads
  const entries = srt.split('\n\n').filter(Boolean);
  entries.forEach((b, i) => assert.equal([...b.matchAll(/<font id="([^"]*)"><\/font>/g)].map((m) => m[1]).join(''), PARSED.entries[i].id.replace(/^\d+ /, ''), `SRT entry ${i + 1}`));
  assert.deepEqual(idHits(asText(srt).split('\n').filter((l) => l.startsWith('Dialogue'))), []);
  assert.ok(idHits([asText(srt.replace('<font id="', '<b>').replace('"></font>', '</b>'))]).length > 0, 'control: ids as text would show');
  // control: one tag longer than ffmpeg's reader keeps shows as text, which is why the ids are split
  const whole = srt.split('\n\n')[1].replace(/<\/font><font id="/g, '');
  assert.ok(idHits(asText(whole).split('\n').filter((l) => l.startsWith('Dialogue'))).length > 0, 'control: a long tag is shown');
});

test('captions: italics exactly for off-screen cues, "(new)" and "(offered)" marks; planted flips fail', () => {
  assert.deepEqual(styleProblems(PARSED), []);
  const off = TRACK.captions.find((c) => c.italic && c.lane === 'world');
  assert.ok(off, 'some caption is off screen');
  const flip = parseVtt(edit(VTT, `<i>${off.words}</i>`, off.words));
  assert.ok(styleProblems(flip).some((x) => x.includes(`"${off.words}": italic false, off screen true`)), styleProblems(flip).join('\n'));
  const on = parseVtt(edit(VTT, '\nstreet: city, wind', '\n<i>street: city, wind</i>'));
  assert.ok(styleProblems(on).some((x) => x.includes('"street: city, wind": italic true')));
  const unmarked = parseVtt(edit(VTT, 'the car rises out of the quiet <c.new>(new)</c>', 'the car rises out of the quiet'));
  assert.ok(styleProblems(unmarked).some((x) => x.includes('want "(new)"')));
  const offered = parseVtt(edit(VTT, '<c.offered>(offered)</c>', '<c.new>(new)</c>'));
  assert.ok(styleProblems(offered).some((x) => x.includes('want "(offered)"')));
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
});

test('captions: the burn shows each entry from the first frame at or after its start, and the strip reads as the HUD', () => {
  // libass draws an event when its start is at or before the frame's time in ms (vf_subtitles truncates pts * 1000)
  const frameMs = (k) => Math.floor((k * 1000) / FPS);
  const shown = (t, k) => { const [h, m, x] = assTime(t).split(':'); return Math.round((+h * 3600 + +m * 60 + +x) * 1000) <= frameMs(k); };
  for (const e of PARSED.entries) {
    const k = Math.ceil((e.start / 1000) * FPS - 1e-6);
    assert.ok(shown(e.start / 1000, k) && (k === 0 || !shown(e.start / 1000, k - 1)), `entry at ${e.start} ms`);
  }
  const strip = assVisibleText(ASS).filter((t) => /^S\d\d {2}/.test(t));
  assert.equal(strip.length, Math.round(T_TOTAL * FPS), 'one strip label per frame');
  assert.equal(strip[0], `S01  0:00.00  ${SHOTS[0].lens}mm  ${SHOTS[0].title}  [0:00 to 0:07]`);
  assert.ok(strip.every((t) => !DASH.test(t)));
});

// ---------- the SDH track ----------
function sdhProblems(sdh) {
  const p = [], want = CUES.filter((c) => c.enabled && c.sdh).map((c) => c.id);
  if (JSON.stringify(sdh.map((s) => s.id)) !== JSON.stringify(want)) p.push(`SDH carries ${sdh.map((s) => s.id)}, want the plot-pertinent ${want}`);
  const named = [];
  for (const s of sdh) {
    const c = byId.get(s.id);
    if (!c?.sdh) { p.push(`${s.id} is not plot pertinent`); continue; }
    if (s.text !== s.text.toLowerCase() || !/^\[[^[\]]+\]$/.test(s.text)) p.push(`${s.id} "${s.text}" is not lowercase in brackets`);
    const [, source, sound] = /^\[(?:(.+?) )?(\S+s\b.*)\]$/.exec(c.sdh);
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
  // three at once
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

test('reel: the soft copy is the published picture bit for bit with the review track as mov_text, top left, no audio', { skip: why }, async () => {
  const r = await reel();
  const softProblems = async (file) => {
    const p = [], probe = await ffprobe(file), src = await ffprobe(SOURCE);
    if (videoHash(file) !== videoHash(SOURCE)) p.push('the video stream is not the source\'s bytes');
    if (probe.audioStreams !== 0) p.push(`${probe.audioStreams} audio streams`);
    let text = '';
    try { text = subtitleText(file); } catch { p.push('no subtitle stream'); }
    if (text && !text.includes('street: city, wind')) p.push('the captions are not the review track');
    p.push(...idHits(text ? [text] : []));
    const j = movTextJustification(file);
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
  // control: the phone copy is not the source's picture and has no captions stream
  const bad = await softProblems(r.phone);
  assert.ok(bad.includes('the video stream is not the source\'s bytes') && bad.includes('no subtitle stream'), bad.join('; '));
  // the same inputs give the same bytes
  const again = resolve(fresh('soft-again'), NAMES.soft);
  await softCopy({ source: SOURCE, vtt: r.files.vtt, out: again });
  assert.ok(readFileSync(again).equals(readFileSync(r.soft)), 'two soft copies differ');
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
  // a planted caption line in the bottom band
  const plantedAss = resolve(d, 'planted.ass');
  writeFileSync(plantedAss, readFileSync(segAss, 'utf8').replace(/\\pos\(3,11\)/, `\\pos(3,${FRAME.h - SAFE + 5})`));
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
  const two = await phoneCopy({ source: SOURCE, ass: segAss, out: resolve(d, 'two.mp4'), from, seconds });
  assert.equal(one.probe.frames, seconds * FPS);
  assert.ok(readFileSync(resolve(d, 'one.mp4')).equals(readFileSync(resolve(d, 'two.mp4'))), 'two phone copies of one stretch differ');
});

test('reel: the caption files are written, the VTT is the track, and a second write gives the same bytes', { skip: why }, async () => {
  const r = await reel();
  assert.equal(readFileSync(r.files.vtt, 'utf8'), VTT);
  const again = writeCaptions(fresh('captions-again'));
  for (const k of Object.keys(r.files)) assert.ok(readFileSync(again.files[k]).equals(readFileSync(r.files[k])), k);
  assert.ok(readFileSync(r.files.ass, 'utf8').includes(`PlayResX: ${FRAME.w}`));
  assert.ok(fontFile().endsWith('.ttf'));
});
