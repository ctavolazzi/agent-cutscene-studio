// Builds the Gate 2 review page for the Artifact viewer: the preview, the six decisions with the frames each one is
// about, every shot against its storyboard panel, the panel's 28 findings and the checks.
// Usage: node scripts/blockout-page.js [--round 02] [--out out/gate2-page]
// Reads review/round-NN/ (notes.md, findings.json, stills.json, measure.json from scripts/gate2-measure.js, the
// stills, decisions/, panels/, maps, preview.mp4) and storyboard/report.json. Writes <out>/review-page.html, copies of
// every published file beside it (images and video are published next to the page, not inlined), gamma-lifted copies
// under lift/ for the page's Lift shadows switch, and files.json, the list to publish.
// The page content has no doctype, html, head or body tags; the viewer wraps it. No em or en dashes reach the page.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { SHOTS, tcode } from '../src/shots.js';
import { carTimes } from '../src/world.js';
import { shotColor } from './lib/map.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// The module tests and their check counts, from the 2026-10-22 baseline run (BUILD_LOG S2.7b)
const TESTS = [['car', 15], ['people', 27], ['lights and snow', 27], ['set', 18], ['checks', 21], ['capture', 17]];
const LIFT_GAMMA = 0.4; // lifted copies: out = 255 * (in / 255) ^ 0.4, so a level of 2 shows as 37 and 120 as 189
const DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`, 'g');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const md = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`(.+?)`/g, '<code>$1</code>');
const pad2 = (n) => String(n).padStart(2, '0');
const sec = (t) => `${Number(t.toFixed(3))} s`;
// m:ss.s for whole-second marks; frames get two decimals like the overlay (0:59.96). Rounded before splitting, so 59.96 never prints as 0:60.0
const clockAt = (t, d) => { const c = Math.round(t * 10 ** d) / 10 ** d, mm = Math.floor(c / 60); return `${mm}:${(c - mm * 60).toFixed(d).padStart(3 + d, '0')}`; };
const clock = (t) => clockAt(t, 1);
const fclock = (t) => clockAt(t, 2);
// text that reads on a shot colour: dark on the light hues, white on the dark ones
const inkOn = (hex) => { const l = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2] > 0.3 ? '#0b0f1a' : '#ffffff'; };
// width and height of a PNG, from its header
const pngSize = (file) => { const b = readFileSync(file); if (b.toString('ascii', 1, 4) !== 'PNG') throw new Error(`not a PNG: ${file}`); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
const pct = (v) => `${Math.round(v * 100)}%`;
const range = (vals, d = 1) => { const lo = Math.min(...vals), hi = Math.max(...vals); return lo === hi ? lo.toFixed(d) : `${lo.toFixed(d)} to ${hi.toFixed(d)}`; };

// ---------- sources ----------

function readSources(roundDir) {
  const read = (f) => readFileSync(resolve(roundDir, f), 'utf8');
  const notes = read('notes.md');
  const findings = JSON.parse(read('findings.json')).findings;
  const stills = JSON.parse(read('stills.json'));
  if (!existsSync(resolve(roundDir, 'measure.json'))) throw new Error('measure.json is missing: run node scripts/gate2-measure.js first');
  const m = JSON.parse(read('measure.json'));
  const report = JSON.parse(readFileSync(resolve(ROOT, 'storyboard/report.json'), 'utf8'));
  const preview = JSON.parse(read('preview.mp4.json'));
  return { notes, findings, stills, m, report, preview };
}

// The disposition table in notes.md: | # | Shot | Finding | Result |
function dispositions(notes, findings) {
  const part = notes.split('## Disposition')[1].split('\n## ')[0];
  const rows = part.split('\n').filter((l) => /^\|\s*\d+\s*\|/.test(l)).map((l) => {
    const c = l.split('|').slice(1, -1).map((x) => x.trim());
    const n = Number(c[0]), f = findings[n];
    if (!f || f.shot !== Number(c[1])) throw new Error(`notes row ${n} (shot ${c[1]}) does not match findings.json`);
    const kind = /^Refuted/.test(c[3]) ? 'refuted' : /^Partly/.test(c[3]) ? 'partly' : /^Mostly/.test(c[3]) ? 'mostly' : 'fixed';
    // the page shows the skeptics' level where they changed it; notes.md row 12 points below, but on the page decision 3 holds it
    const severity = f.verified_severity && f.verified_severity !== f.severity ? `${f.severity}, verified ${f.verified_severity}` : f.severity;
    return { n, shot: Number(c[1]), finding: c[2], result: c[3].replace('see shot 8 below', 'see decision 3'), kind, gate: /\*\*Gate 2/.test(c[3]), severity, verdict: f.verdict };
  });
  if (rows.length !== findings.length) throw new Error(`notes.md has ${rows.length} rows, findings.json ${findings.length}`);
  return rows;
}
const known = (notes) => notes.split('## Known, for Stage 4 and later (not blockout problems)')[1].trim().split('\n\n')[0].replace(/\n/g, ' ');

const list = (xs) => (xs.length < 2 ? String(xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

// ---------- the six decisions ----------
// The same positions as the Corrections section of notes.md; the numbers come from measure.json.

function decisions({ m }) {
  const L = Object.fromEntries(m.lamp.rows.map((r) => [r.label, r]));
  const lvl = (re) => m.levels.filter((l) => re.test(l.label));
  const getOut = lvl(/^shot 5 at (30\.5|31\.2|31\.8|32\.6|33\.2|34|35) s$/), others = lvl(/^shot (6|7|9) middle$/);
  const W = m.shot5Wheel, v15 = W.variant15, s8 = m.shot8, s3 = m.shot3, ps = m.lamp.postInShots;
  const wide = s8.variants.find((v) => v.label === 'B 0.35 m further across'), half = s8.variants.find((v) => v.label === 'B 0.15 m further across');
  const f = (src, t, label) => ({ src, t, label });
  const dec = (t, label) => f(`decisions/t${t.toFixed(3).padStart(7, '0')}.png`, t, label);
  const st = (n, which, label) => { const s = SHOTS.find((x) => x.n === n); const t = which === 'first' ? s.start : which === 'mid' ? (s.start + s.end) / 2 : s.end - 1 / 24; return f(`stills/shot-${pad2(n)}-${which}.png`, t, label); };
  const pc = (v) => `${Math.round(v * 100)}%`, x2 = (v) => (Math.round(v * 100) / 100).toFixed(2), m1 = (v) => Number(v).toFixed(1);
  return [
    {
      id: 'd1', shots: [5], dark: true, play: 30, title: 'Shot 5: the boots land outside the lamp\'s light',
      body: [
        `The plan asks the look stage for a ${m.lamp.poolRadiusTarget} m pool under the lantern. A's boot lands ${m1(L['A boot lands'].now)} m from its centre and B's ${m1(L['B boot lands'].now)} m; at the rail A is ${m1(L['A at the rail'].now)} m away and B ${m1(L['B at the rail'].now)} m. The headlights point north, toward the bridge and away from the doors, so nothing lights the get-out.`,
        `From 30.5 to 35.0 s the frame averages ${range(getOut.map((x) => x.mean))} out of 255; shots 6, 7 and 9 average ${range(others.map((x) => x.mean), 0)}. A's landing cannot be seen at all, and B's boots are a faint silhouette under the car. Lift shadows shows both.`,
      ],
      correction: `The notes offered moving the lamp 1.5 m north. North is away from the car, so that puts the landings at ${m1(L['A boot lands'].north)} m and ${m1(L['B boot lands'].north)} m: darker. The letters below are not the notes' letters.`,
      changed: 'The notes recommended keeping the lamp because the headlight cut carries the shot, but the headlights point away from the doors. Moving the lamp south is the one option that fits the plan\'s 7 m pool, so I now recommend (c). The blockout lamp is untuned, so blockout brightness cannot compare the options; the distances can.',
      frames: [f('map-detail-arrival.png', null, 'Map: where A and B stand at 0:34 is outside the 7 m circle (drawn around the post)'), dec(31.8, 'A\'s boot lands'), dec(33.2, 'B\'s boot lands, under the car'), dec(36, 'Beams on the road, before the cut'), dec(37, 'After the cut')],
      options: [
        { key: 'a', label: 'Keep the lamp; the look stage stretches the pool', detail: `ROADMAP 4.7 already requires the pool to cover the car doors and the lean spot. With the lamp here that means about ${m1(L['A boot lands'].now)} m for A's landing while still lighting the rail, more than the ${m.lamp.poolRadiusTarget} m the plan names.` },
        { key: 'b', label: 'Keep the lamp; add one car light for the get-out', detail: `A courtesy light low in the car, on from when the driver's door opens (${carTimes.doors.driver.open0} s) and fading out with the headlights (${carTimes.lightsOff0} to ${carTimes.lightsOff1} s), so the cut stays one beat and the shot still ends on lamp light only. It is an eighth light: PLAN 4.2 fixes the film at seven lights and a test checks that, so both change.` },
        { key: 'c', rec: true, label: 'Move the lamp 1.5 m south', detail: `The planned ${m.lamp.poolRadiusTarget} m pool then reaches B's landing (${m1(L['B boot lands'].south)} m), A's within a few centimetres (${L['A boot lands'].south.toFixed(2)} m) and both rail spots (${m1(L['A at the rail'].south)} and ${m1(L['B at the rail'].south)} m). The post comes into shots ${list(ps.gainedSouth)} and leaves shot ${list(ps.lostSouth)}; in shot 4 it stands ${m1(ps.shot4PostDistanceSouth)} m from the camera at the left edge, so that camera moves a little. Shots ${list(ps.aimedAtLamp)} re-aim with it.` },
      ],
    },
    {
      id: 'd2', shots: [9, 10, 12], play: 60, title: `Parapet: ${m.parapetTop.toFixed(2)} m, and A's forearms do not rest yet`,
      body: [
        `The brief asks for a railing "chest high, leaned on with forearms". ${m.parapetTop.toFixed(2)} m is about B's lower chest and A's elbow height. B's forearm nearly rests on it; A's does not: A's elbow sits about 14 cm above the top and the arm slopes down to the hand, which still reads as reaching (shot 9).`,
        'At 1.30 m, the height in my first table, B\'s hands sat at B\'s shoulders and the lean read as arms held out.',
      ],
      frames: [st(9, 'mid', 'Shot 9: A\'s arm slopes down to the hand'), st(12, 'mid', 'Shot 12: B\'s forearm nearly rests'), st(10, 'mid', 'Shot 10: small at the rail')],
      options: [
        { key: 'a', rec: true, label: `Keep ${m.parapetTop.toFixed(2)} m and rework A's lean`, detail: 'In round 2 A leans lower and further forward so A\'s forearms rest too. B stays as is.' },
        { key: 'b', label: 'Back to 1.30 m and rework both poses', detail: 'Chest high for A; both leans are reworked so the forearms rest.' },
      ],
    },
    {
      id: 'd3', shots: [8], play: 54, title: 'Shot 8: the pair merges mid-shot, and the post ends in A\'s head',
      body: [
        'The camera stands on the deck, three-quarter to the walk (from straight ahead A hid B; from the other side A stood in front of the lamp). A stays on screen left of B in every frame, and the bulb is fully visible.',
        `Two problems remain. Their outlines overlap for ${m1(s8.outline.overlapSeconds)} s (closest at ${m1(s8.closest.t)} s), so the two coats read as one dark shape, though B's beanie still shows. And the lamp post, at A's edge mid-shot, is inside A's outline from ${m1(s8.post.insideAFrom)} s; at the cut it rises straight out of A's head, the fault the panel found on B (finding 12), now on A.`,
      ],
      changed: `The notes' second option accepted the post at A's edge without knowing it ends in A's head. Its "trail further" part does nothing from this camera; its 0.5 m gap across the deck nearly clears the overlap (${m1(half.overlapSeconds)} s left). I recommend (c).`,
      frames: [dec(54, 'Start of the shot'), dec(s8.closest.t, 'Closest: one dark shape'), dec(59, 'The post moving into A'), st(8, 'last', 'Last frame: the post in A\'s head')],
      options: [
        { key: 'a', label: 'Accept it for the blockout', detail: 'Both stay as they are.' },
        { key: 'b', label: 'Widen the gap between them', detail: `B keeps about ${wide.headGap.across.toFixed(2)} m from A instead of ${s8.closest.across.toFixed(2)} m, easing in after 54.0 s on the sidewalk so shot 7 is untouched. The outlines no longer touch. The post stays in A's head at the cut.` },
        { key: 'c', rec: true, label: 'Widen the gap and clear the post', detail: 'As (b), plus a small change to the camera or to A\'s last steps so the post clears A\'s head at the cut. I measure the options in round 2 and show you the frame.' },
      ],
    },
    {
      id: 'd4', shots: [5], dark: true, play: 34, title: `Shot 5: the front tyre fills the frame from ${m1(W.inFrame[0])} to ${m1(W.inFrame[1])} s`,
      body: [
        `The camera holds on the door until ${W.holdUntil} s, then slides ${m1(W.truckMetres)} m north along the car, passing ${range(W.rows.filter((r) => r.t >= 35).map((r) => r.distance), 1)} m from the driver-side front wheel. The wheel is in frame from ${m1(W.inFrame[0])} to ${m1(W.inFrame[1])} s, a second past the headlight cut, and covers up to ${pc(W.worstByVariant.now)} of it (at ${m1(W.worstAt.now)} s).`,
      ],
      correction: `The notes offered a 50mm lens 0.5 m further back: the wheel stays the same (${pc(W.worstByVariant['50mm, 0.5 m back'])} at worst), because a longer lens magnifies what the extra distance shrinks. From 1.5 m back it covers ${pc(W.worstByVariant['50mm, 1.5 m back'])} but A's feet, much nearer the camera, come out at about half size (${v15.feetRatio.join(' to ')} times). The other option, holding until 35.5 s and then pushing in, cannot work gently: every end frame that holds A's feet and both beams without the wheel looks roughly north, the hold looks east, and 0.7 s is too short for that turn.`,
      table: { caption: 'Share of the frame the wheel covers', head: ['Time', 'Now, 35mm', '50mm, 0.5 m back', '50mm, 1.0 m back', '50mm, 1.5 m back'],
        rows: [...W.rows.filter((r) => r.t >= 35).map((r) => [`${r.t.toFixed(1)} s`, pc(r.now), pc(r['50mm, 0.5 m back']), pc(r['50mm, 1.0 m back']), pc(r['50mm, 1.5 m back'])]),
          ['Worst, any frame', pc(W.worstByVariant.now), pc(W.worstByVariant['50mm, 0.5 m back']), pc(W.worstByVariant['50mm, 1.0 m back']), pc(W.worstByVariant['50mm, 1.5 m back'])]] },
      frames: [dec(34.4, 'The slide starts'), dec(35, 'Wheel coming in'), dec(35.5, 'Wheel mid frame'), dec(36, 'Just before the cut'), dec(37, 'After the cut, still in frame')],
      options: [
        { key: 'a', rec: true, label: 'Redesign the move so the wheel stays out', detail: 'Start the turn toward the bridge earlier, while A is still near the door, so the camera ends on A\'s feet and the beams without crossing the wheel. I design it in round 2 and show you frames before rendering the preview.' },
        { key: 'b', label: '50mm, 1.5 m further back', detail: `The same move. The wheel covers ${pc(W.worstByVariant['50mm, 1.5 m back'])} of the frame at worst instead of ${pc(W.worstByVariant.now)}, but A's feet, the subject, come out about half their current size.` },
        { key: 'c', label: 'Keep it for the blockout', detail: 'The wheel stays in frame through the cut; looked at again in the look stage.' },
      ],
    },
    {
      id: 'd5', shots: [5], dark: true, play: 30, title: 'Shot 5: getting out',
      body: [
        'As built, each person starts seated inside the car, both feet come out together at sill height and land together (A at 31.8 s, B at 33.2 s), then the body rises in place and walks clear of the door. The shot\'s text says "a boot lands" and PLAN 3.9 has "A\'s boot lands" and "B\'s boots land", so A landing on both feet at once reads as a hop. Turn on Lift shadows to see it; decision 1 is why it is dark.',
      ],
      changed: 'The notes asked you to confirm a feet-first get-out. It is both feet at once, so I recommend (b).',
      frames: [dec(30.8, 'Driver door opening'), dec(31.2, 'A seated, feet coming out'), dec(31.8, 'A lands on both feet'), dec(32.1, 'A rises in place'), dec(32.6, 'A walks clear of the door'), dec(33.2, 'B\'s boots land, under the car')],
      options: [
        { key: 'a', label: 'Confirm as built', detail: 'Both feet together for both people; landing times stay.' },
        { key: 'b', rec: true, label: 'A steps down one boot first; B as built', detail: 'A\'s foot nearest the door lands at 31.8 s, the other follows, then A rises. B\'s boots still land together under the car at 33.2 s.' },
      ],
    },
    {
      id: 'd6', shots: [3], play: 17, title: 'Shot 3: the car drifts right before it turns',
      body: [
        `The pan now starts at ${s3.panStart} s, just before the nose clears the corner (${m1(s3.noseVisible)} s), and follows the car. While the car drives west and brakes on the cross street it moves from ${x2(s3.minSx)} to ${x2(s3.maxSx)} of the frame width, against its direction of travel (north, toward the bridge, is screen left). Once it turns north (${m1(s3.turn0)} to ${m1(s3.turn1)} s) it moves back left to ${x2(s3.endSx)}. Before round 1 it swung from 0.09 to 0.63. The look stage may tighten it.`,
      ],
      frames: [dec(17.75, 'Nose clears the corner'), dec(18, 'Leftmost: only the nose shows'), dec(19.5, 'Braking on the cross street'), dec(20.75, 'Rightmost, the turn begins'), dec(21.3, 'In the turn, moving back left')],
      options: [
        { key: 'a', rec: true, label: 'Accept it for the blockout', detail: 'Round 2 leaves shot 3 alone.' },
        { key: 'b', label: 'Tighten it in round 2', detail: `Slow the pan between 18 and ${m1(s3.turn0)} s so the car holds nearer one place on screen.` },
      ],
    },
  ];
}

// ---------- files ----------

function ffmpeg(args) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr}`);
}
const LUT = `lutrgb=r=gammaval(${LIFT_GAMMA}):g=gammaval(${LIFT_GAMMA}):b=gammaval(${LIFT_GAMMA})`;
function liftPng(src, dst) { mkdirSync(dirname(dst), { recursive: true }); ffmpeg(['-i', src, '-vf', `format=rgb24,${LUT}`, '-pix_fmt', 'rgb24', dst]); }
function liftMp4(src, dst) {
  mkdirSync(dirname(dst), { recursive: true });
  ffmpeg(['-i', src, '-vf', `scale=in_color_matrix=bt709:in_range=tv,format=rgb24,${LUT},scale=out_color_matrix=bt709:out_range=tv,format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv', dst]);
}

// ---------- page ----------

function pageHtml({ round, src, rows, decs, stillsByShot, size }) {
  const { m } = src;
  const counts = rows.reduce((a, r) => ((a[r.kind] = (a[r.kind] || 0) + 1), a), {});
  const confirmed = rows.filter((r) => r.verdict === 'confirmed').length;
  const blockers = rows.filter((r) => r.severity === 'blocker');
  const strip = SHOTS.map((s) => `<button class="seg" type="button" style="flex:${s.end - s.start};--c:${shotColor(s.n)};--ink:${inkOn(shotColor(s.n))}" data-go="shot-${s.n}" aria-label="Jump to shot ${s.n}, ${tcode(s.start)}"><span>${s.n}</span></button>`).join('');
  const img = (fr, cls = 'still') => `<button class="zoom" type="button" data-alt="${esc(fr.label ?? '')}${fr.t != null ? `, ${sec(fr.t)}` : ''}"><img class="${cls}" ${cls === 'still' ? `data-lift="lift/${esc(fr.src)}" ` : ''}src="${esc(fr.src)}" width="${size(fr.src)[0]}" height="${size(fr.src)[1]}" alt="${esc(fr.label ?? '')}" loading="lazy"></button>`;
  const frame = (fr) => `<figure class="fr">${img(fr, fr.src.startsWith('map') ? 'map' : 'still')}<figcaption>${fr.t != null ? `<span class="tc">${fclock(fr.t)}</span> ` : ''}${esc(fr.label ?? '')}</figcaption></figure>`;
  const chip = (n) => `<a class="chip" href="#shot-${n}" style="--c:${shotColor(n)};--ink:${inkOn(shotColor(n))}">${n}</a>`;

  const decHtml = decs.map((d, i) => {
    const opts = d.options.map((o) => `<label class="opt" for="${d.id}-${o.key}"><input type="radio" name="${d.id}" id="${d.id}-${o.key}" value="${o.key}"><span class="ok">${o.key}</span><span class="ot"><span class="ol"><b>${esc(o.label)}</b>${o.rec ? ' <span class="rec">Recommended</span>' : ''}</span><span class="od">${esc(o.detail)}</span></span></label>`).join('');
    const def = d.options.find((o) => o.rec);
    const table = d.table ? `<div class="scroll"><table><caption>${esc(d.table.caption)}</caption><tr>${d.table.head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>${d.table.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table></div>` : '';
    return `<article class="dec" id="${d.id}" data-title="${esc(d.title)}">
<header class="dh"><span class="dn">${i + 1}</span><div><div class="chips">Shot ${d.shots.map(chip).join(' ')}</div><h3>${esc(d.title)}</h3></div></header>
${d.body.map((p) => `<p>${esc(p)}</p>`).join('')}
${d.correction ? `<p class="corr"><b>Correction to the notes.</b> ${esc(d.correction)}</p>` : ''}
${d.changed ? `<p class="changed"><b>Recommendation.</b> ${esc(d.changed)}</p>` : ''}
${table}
<div class="frames">${d.frames.map(frame).join('')}</div>
<p class="play"><button type="button" class="btn" data-play="${d.play}">Play the preview from ${clock(d.play)}</button>${d.dark ? ' <button type="button" class="btn" data-lifttoggle aria-pressed="false">Lift shadows</button>' : ''}</p>
<fieldset class="opts"><legend>Your answer${def ? ` <span class="dim">(default if you say go: ${def.key})</span>` : ''}</legend>${opts}</fieldset>
<label class="note" for="${d.id}-note"><span>Note (optional)</span><textarea id="${d.id}-note" rows="2" placeholder="Anything to add or change"></textarea></label>
<p class="status" id="${d.id}-status" aria-live="polite">Not answered yet</p>
</article>`;
  }).join('\n');

  const shotHtml = SHOTS.map((s) => {
    const st = stillsByShot.get(s.n);
    const mine = rows.filter((r) => r.shot === s.n);
    const finds = mine.length ? `<ul class="finds">${mine.map((r) => `<li><span class="res ${r.kind}">${r.kind === 'mostly' ? 'mostly fixed' : r.kind}</span>${r.gate ? '<span class="res gate">Gate 2</span>' : ''} <span class="sev">${r.severity}</span> ${md(r.finding)}</li>`).join('')}</ul>` : '<p class="dim small">No panel findings.</p>';
    return `<section class="shot" id="shot-${s.n}" style="--c:${shotColor(s.n)}">
<header class="sh"><span class="sn">${s.n}</span><h3>${esc(s.title)}</h3><span class="meta">${clock(s.start)} to ${clock(s.end)}, ${s.end - s.start} s, ${s.lens}mm</span></header>
<p class="act">${esc(s.action)}</p>
<div class="cmp"><figure class="fr panel">${img({ src: `panels/shot-${pad2(s.n)}.png`, label: `Shot ${s.n} storyboard panel (Gate 1)` }, 'panelimg')}<figcaption>Storyboard (Gate 1)</figcaption></figure>
<div class="three">${st.map((x) => frame({ src: x.file, t: x.t, label: x.which === 'mid' ? 'middle' : x.which })).join('')}</div></div>
${finds}
</section>`;
  }).join('\n');

  const findRows = rows.map((r) => `<tr><td>${r.n}</td><td><a href="#shot-${r.shot}">${r.shot}</a></td><td><span class="sev">${r.severity}</span></td><td>${md(r.finding)}</td><td><span class="res ${r.kind}">${r.kind === 'mostly' ? 'mostly fixed' : r.kind}</span>${r.gate ? ' <span class="res gate">Gate 2</span>' : ''} ${md(r.result.replace(/^(Fixed|Refuted|Partly|Mostly fixed)(:|\.)?\s*/, ''))}</td></tr>`).join('');

  const html = `<title>Snow Lamp Bridge Blockout</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500&family=Source+Sans+3:wght@400;600&display=swap">
<style>
/* Layout: the Gate 1 page's look (night blue, the lamp's amber as the one accent). One column: preview, six decision
   cards with their frames and answers, then every shot against its storyboard panel, the findings table and the checks.
   A sticky shot strip with the Lift shadows switch. */
:root {
  --bg: #0b0f1a; --surface: #121829; --raise: #182036; --line: #232d47; --fg: #e6ebf7; --dim: #93a0bd; --accent: #ffb46b; --cool: #8fb0ff; --warn: #ff9c9c; --good: #8fe0a8; --frame: #05070d; --snmix: 100%;
  --display: "Barlow Condensed", "Arial Narrow", "Helvetica Neue", sans-serif; --body: "Source Sans 3", "Helvetica Neue", Arial, sans-serif; --mono: "IBM Plex Mono", ui-monospace, Menlo, monospace;
  color-scheme: dark;
}
@media (prefers-color-scheme: light) { :root:not([data-theme="dark"]) { --bg: #f2f4f9; --surface: #ffffff; --raise: #e9edf6; --line: #d3d9e8; --fg: #121829; --dim: #566480; --accent: #9a4f0d; --cool: #3558b8; --warn: #b3322f; --good: #17633a; --frame: #0b0f1a; --snmix: 45%; color-scheme: light; } }
:root[data-theme="light"] { --bg: #f2f4f9; --surface: #ffffff; --raise: #e9edf6; --line: #d3d9e8; --fg: #121829; --dim: #566480; --accent: #9a4f0d; --cool: #3558b8; --warn: #b3322f; --good: #17633a; --frame: #0b0f1a; --snmix: 45%; color-scheme: light; }
* { box-sizing: border-box; }
body { background: var(--bg); color: var(--fg); font: 17px/1.55 var(--body); padding-block: 0 64px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
.wrap { max-width: 1180px; margin: 0 auto; }
h1, h2, h3 { font-family: var(--display); font-weight: 600; letter-spacing: 0.01em; text-wrap: balance; margin: 0; line-height: 1.1; }
h1 { font-size: clamp(2.4rem, 7vw, 4.2rem); font-weight: 700; }
h2 { font-size: 1.9rem; margin: 56px 0 6px; scroll-margin-top: 64px; } h3 { font-size: 1.35rem; }
p { max-width: 68ch; margin: 8px 0 0; } .dim { color: var(--dim); } .small { font-size: 0.9rem; }
a { color: var(--cool); }
code { font-family: var(--mono); font-size: 0.86em; }
.kicker { font: 500 0.8rem var(--mono); letter-spacing: 0.12em; text-transform: uppercase; color: var(--accent); margin: 28px 0 8px; }
.facts { display: flex; flex-wrap: wrap; gap: 6px 28px; font: 400 0.9rem var(--mono); color: var(--dim); margin-top: 14px; } .facts b { color: var(--fg); font-weight: 500; }
.bar { position: sticky; top: env(safe-area-inset-top, 0px); z-index: 5; background: var(--bg); border-bottom: 1px solid var(--line); margin: 24px calc(-1 * max(16px, env(safe-area-inset-left, 0px))) 0; padding: 8px max(16px, env(safe-area-inset-right, 0px)) 8px max(16px, env(safe-area-inset-left, 0px)); }
body::before { content: ""; position: fixed; inset: 0 0 auto; height: env(safe-area-inset-top, 0px); z-index: 10; background: var(--bg); }
.barrow { display: flex; gap: 8px; align-items: center; max-width: 1180px; margin: 0 auto; }
.strip { display: flex; gap: 2px; flex: 1; min-width: 0; }
.seg { flex-basis: 0; min-width: 0; height: 30px; border: 0; padding: 0; background: var(--c); color: var(--ink); font: 700 0.85rem var(--display); cursor: pointer; border-radius: 2px; overflow: hidden; }
@media (max-width: 520px) { .seg { flex: 1 1 0 !important; } }
.seg:hover { filter: brightness(1.12); } .seg span { pointer-events: none; }
.lift { flex: none; height: 30px; padding: 0 10px; border-radius: 15px; border: 1px solid var(--line); background: var(--surface); color: var(--fg); font: 600 0.9rem var(--display); letter-spacing: 0.03em; cursor: pointer; white-space: nowrap; }
.lift[aria-pressed="true"], .btn[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: var(--bg); }
.lift .long { display: none; } @media (min-width: 640px) { .lift .long { display: inline; } }
:focus-visible { outline: 2px solid var(--cool); outline-offset: 2px; }
ul.look { list-style: none; padding: 0; margin: 14px 0 0; display: grid; gap: 10px; } ul.look li { padding-left: 16px; position: relative; max-width: 68ch; } ul.look li::before { content: ""; position: absolute; left: 0; top: 0.7em; width: 7px; height: 7px; border-radius: 50%; background: var(--accent); }
.video { margin-top: 16px; background: var(--frame); border: 1px solid var(--line); border-radius: 4px; overflow: hidden; scroll-margin-top: 64px; }
.video video { display: block; width: 100%; height: auto; aspect-ratio: 16 / 9; max-width: 100%; image-rendering: pixelated; background: #000; }
.vcap { display: flex; flex-wrap: wrap; gap: 4px 18px; padding: 8px 12px; font: 400 0.82rem var(--mono); color: var(--dim); background: var(--surface); border-top: 1px solid var(--line); }
.zoom { display: block; width: 100%; padding: 0; border: 0; background: var(--frame); cursor: zoom-in; }
.zoom img { display: block; width: 100%; height: auto; }
img.still { image-rendering: pixelated; aspect-ratio: 16 / 9; }
figure { margin: 0; min-width: 0; }
.fr { background: var(--surface); border: 1px solid var(--line); border-radius: 3px; overflow: hidden; }
.fr figcaption { padding: 4px 8px 6px; font-size: 0.85rem; line-height: 1.35; color: var(--dim); }
.tc { font: 500 0.8rem var(--mono); color: var(--fg); font-variant-numeric: tabular-nums; }
.decs { display: grid; gap: 22px; margin-top: 18px; }
.dec { background: var(--surface); border: 1px solid var(--line); border-radius: 6px; padding: 18px 18px 16px; min-width: 0; scroll-margin-top: 64px; }
.dh { display: flex; gap: 14px; align-items: flex-start; }
.dn { font: 700 2.4rem/0.9 var(--display); color: var(--accent); min-width: 1.1em; }
.chips { font: 500 0.75rem var(--mono); color: var(--dim); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 4px; }
.chip { display: inline-block; min-width: 22px; padding: 1px 6px; border-radius: 3px; background: var(--c); color: var(--ink); font: 700 0.8rem var(--display); text-align: center; text-decoration: none; letter-spacing: 0; }
.corr { border-left: 3px solid var(--warn); padding: 6px 0 6px 12px; background: color-mix(in srgb, var(--warn) 9%, transparent); }
.changed { border-left: 3px solid var(--cool); padding: 6px 0 6px 12px; background: color-mix(in srgb, var(--cool) 9%, transparent); }
.frames { display: grid; gap: 8px; margin-top: 14px; align-items: start; grid-template-columns: repeat(auto-fill, minmax(min(100%, 200px), 1fr)); }
.play { margin-top: 12px; display: flex; flex-wrap: wrap; gap: 8px; }
.dec td:first-child, .dec th:first-child { white-space: nowrap; }
.btn { font: 600 1rem var(--display); letter-spacing: 0.03em; padding: 7px 14px; border-radius: 4px; border: 1px solid var(--line); background: var(--raise); color: var(--fg); cursor: pointer; }
.btn:hover { border-color: var(--cool); }
.btn.primary { background: var(--accent); border-color: var(--accent); color: var(--bg); }
fieldset.opts { border: 0; padding: 0; margin: 16px 0 0; display: grid; gap: 8px; min-width: 0; }
fieldset.opts legend { padding: 0; margin-bottom: 8px; font: 600 1.05rem var(--display); letter-spacing: 0.02em; }
.opt { position: relative; display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border: 1px solid var(--line); border-radius: 4px; background: var(--raise); cursor: pointer; }
.opt:hover { border-color: var(--cool); }
.opt input { position: absolute; left: 12px; top: 12px; width: 1px; height: 1px; margin: 0; opacity: 0; pointer-events: none; }
.opt .ok { flex: none; width: 26px; height: 26px; border-radius: 50%; border: 2px solid var(--dim); display: grid; place-items: center; font: 700 0.95rem var(--display); color: var(--dim); }
.opt:has(input:checked) { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, var(--raise)); }
.opt:has(input:checked) .ok { background: var(--accent); border-color: var(--accent); color: var(--bg); }
.opt:has(input:focus-visible) { outline: 2px solid var(--cool); outline-offset: 2px; }
.ot { display: grid; gap: 2px; min-width: 0; } .ot b { font-weight: 600; } .od { color: var(--dim); font-size: 0.95rem; }
.rec { display: inline-block; font: 500 0.7rem var(--mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--good); border: 1px solid var(--good); border-radius: 3px; padding: 0 5px; margin-left: 4px; vertical-align: 2px; }
.note { display: grid; gap: 4px; margin-top: 12px; font-size: 0.9rem; color: var(--dim); }
.note textarea { width: 100%; font: 400 1rem var(--body); color: var(--fg); background: var(--bg); border: 1px solid var(--line); border-radius: 4px; padding: 8px 10px; resize: vertical; }
.status { font: 400 0.82rem var(--mono); color: var(--dim); margin-top: 8px; } .btn.small { font-size: 0.85rem; padding: 2px 10px; } .status.saved { color: var(--good); } .status.err { color: var(--warn); }
.answers { margin-top: 22px; padding: 16px 18px; border: 1px solid var(--accent); border-radius: 6px; background: var(--surface); }
.answers .row { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-top: 10px; }
.answers textarea { width: 100%; margin-top: 10px; font: 400 0.9rem var(--mono); color: var(--fg); background: var(--bg); border: 1px solid var(--line); border-radius: 4px; padding: 8px 10px; }
.count { font: 500 1rem var(--mono); color: var(--accent); }
.scroll { overflow-x: auto; margin-top: 12px; }
table { border-collapse: collapse; width: 100%; font: 400 0.85rem var(--mono); font-variant-numeric: tabular-nums; }
caption { text-align: left; color: var(--dim); padding-bottom: 4px; font: 400 0.82rem var(--mono); }
th, td { text-align: left; padding: 5px 10px 5px 0; border-bottom: 1px solid var(--line); vertical-align: top; } th { color: var(--dim); font-weight: 500; }
.shots { display: grid; gap: 18px; margin-top: 18px; }
.shot { border-top: 4px solid var(--c); background: var(--surface); border-radius: 4px; padding: 12px 14px 14px; min-width: 0; scroll-margin-top: 64px; }
.sh { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 14px; }
.sn { font: 700 1.8rem/1 var(--display); color: color-mix(in srgb, var(--c) var(--snmix), var(--fg)); } .meta { font: 400 0.82rem var(--mono); color: var(--dim); }
.act { color: var(--dim); font-size: 0.95rem; }
.cmp { display: grid; gap: 8px; margin-top: 10px; grid-template-columns: minmax(0, 1fr); }
.three { display: grid; gap: 8px; grid-template-columns: repeat(3, minmax(0, 1fr)); }
.three .fr figcaption { font-size: 0.78rem; padding: 3px 6px 4px; }
@media (min-width: 900px) { .cmp { grid-template-columns: minmax(0, 1fr) minmax(0, 2.2fr); align-items: start; } }
ul.finds { list-style: none; padding: 0; margin: 10px 0 0; display: grid; gap: 6px; font-size: 0.92rem; }
.res { display: inline-block; font: 500 0.7rem var(--mono); letter-spacing: 0.06em; text-transform: uppercase; border-radius: 3px; padding: 1px 5px; margin-right: 4px; border: 1px solid currentColor; }
.res.fixed { color: var(--good); } .res.refuted { color: var(--dim); } .res.partly, .res.mostly { color: var(--accent); } .res.gate { color: var(--cool); }
.sev { font: 400 0.75rem var(--mono); color: var(--dim); }
.cards { display: grid; gap: 14px; margin-top: 16px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr)); }
.card { background: var(--surface); border: 1px solid var(--line); border-radius: 4px; padding: 14px 16px; min-width: 0; } .card p { margin-top: 4px; font-size: 0.95rem; }
.num { font: 500 1.5rem var(--mono); color: var(--accent); font-variant-numeric: tabular-nums; }
details { margin-top: 14px; } summary { cursor: pointer; font: 600 1.05rem var(--display); letter-spacing: 0.02em; }
.sheets { display: grid; gap: 12px; margin-top: 14px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr)); }
.sheets img { max-height: 260px; object-fit: cover; object-position: top; }
footer { margin-top: 56px; color: var(--dim); font-size: 0.9rem; border-top: 1px solid var(--line); padding-top: 16px; }
dialog { padding: 0; border: 1px solid var(--line); background: var(--bg); color: var(--fg); max-width: 96vw; max-height: 94vh; border-radius: 4px; overflow: auto; } dialog::backdrop { background: rgb(5 8 14 / 0.85); }
dialog .head { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 8px 12px; position: sticky; top: 0; background: var(--bg); border-bottom: 1px solid var(--line); font: 500 0.85rem var(--mono); }
dialog img { display: block; width: min(1440px, 94vw); height: auto; background: var(--frame); }
dialog img.still { image-rendering: pixelated; }
@media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; } }
</style>
<div class="wrap">
<p class="kicker">Gate 2, Stage 2 blockout, round ${esc(round)}</p>
<h1>Snow, Lamp, Bridge</h1>
<p>The whole 1:52 scene now runs in 3D, as grey boxes with placeholder snow. This gate judges timing, staging, cameras and cuts, not the look. An independent panel raised ${rows.length} findings; round 1 fixed what was clear. Six calls are yours before round 2.</p>
<div class="facts"><span><b>112 s</b> runtime</span><span><b>15</b> shots</span><span><b>${rows.length}</b> findings, ${confirmed} confirmed</span><span><b>${blockers.length}</b> blockers, ${blockers.every((r) => r.kind === 'fixed') ? 'staging fixed' : 'not all fixed'}</span><span><b>6</b> decisions</span><span><b>all</b> checks pass</span></div>
<div class="bar"><div class="barrow"><div class="strip" role="navigation" aria-label="Jump to a shot">${strip}</div><button class="lift" type="button" id="lift" aria-pressed="false" title="Show gamma-lifted copies of the frames and the preview, to see staging in the dark shots">Lift<span class="long"> shadows</span></button></div></div>

<h2 id="start">Start here</h2>
<ul class="look">
<li>Watch the preview once. The overlay at the top shows the shot, the time and the lens.</li>
<li>Shot 5 is nearly black on most screens. <b>Lift</b> in the bar above swaps in brightened copies of every frame and of the preview, so the staging shows. It is a review aid, not the look.</li>
<li>Then the six decisions. Each has the frames it is about; tap a frame to enlarge it. Pick an answer and it saves to this page, where I read it. <b>Copy answers</b> at the end gives text for the chat instead.</li>
<li>Checking the notes found problems in five of the six decisions, and the recommendations for 1, 3 and 5 changed. Each card says what changed. Answer with this page's letters.</li>
<li>Also wanted at this gate: anything in the preview that runs long or short. Put it in any note, or in the chat.</li>
<li>Detail, if you want it: every shot against its storyboard panel, the panel's ${rows.length} findings, and the checks.</li>
</ul>

<h2 id="preview">The preview</h2>
<div class="video"><video id="vid" controls playsinline preload="metadata" src="preview.mp4" data-lift="lift/preview.mp4" poster="stills/shot-01-mid.png"></video>
<div class="vcap"><span>480 x 270, the internal size</span><span>24 fps, 2,688 frames</span><span>no sound</span><span>overlay on</span></div></div>

<h2 id="decisions">Six decisions for you</h2>
<p class="dim" id="savenote">Answers save to this page once you pick one.</p>
<div class="decs">
${decHtml}
</div>
<div class="answers" id="answers"><div class="row"><span class="count" id="count">0 of 6 answered</span><button type="button" class="btn primary" id="copy">Copy answers</button><span class="status" id="copystatus" aria-live="polite"></span></div>
<p class="dim small">Or reply in chat: "go" takes every default (${decs.map((d, i) => `${i + 1}${d.options.find((o) => o.rec)?.key ?? '?'}`).join(' ')}), or give a number and letter for each.</p>
<textarea id="copytext" rows="8" readonly hidden></textarea></div>

<h2 id="shots">Shot by shot</h2>
<p class="dim">Each shot's Gate 1 storyboard panel beside the first, middle and last blockout frames, with the panel's findings for that shot. Tap any image to enlarge it.</p>
<div class="shots">
${shotHtml}
</div>
<div class="sheets"><figure class="fr">${img({ src: 'contact-sheet.png', label: 'Contact sheet: every shot, first, middle and last' }, 'map')}<figcaption>Contact sheet, all 45 frames</figcaption></figure><figure class="fr">${img({ src: 'storyboard-sheet.png', label: 'Storyboard sheet, regenerated from the same data' }, 'map')}<figcaption>Storyboard sheet, regenerated</figcaption></figure><figure class="fr">${img({ src: 'map.png', label: 'Set map, top down' }, 'map')}<figcaption>Set map</figcaption></figure></div>

<h2 id="findings">What the panel found</h2>
<p>Five reviewers read the frames against their storyboard panels and the brief, and rendered extra moments between them. Five skeptics then tried to refute each finding. ${counts.fixed ?? 0} fixed, ${(counts.partly ?? 0) + (counts.mostly ?? 0)} partly or mostly fixed, ${counts.refuted ?? 0} refuted.</p>
<details><summary>All ${rows.length} findings and what happened to each</summary><div class="scroll"><table><tr><th>#</th><th>Shot</th><th>Level</th><th>Finding</th><th>Result</th></tr>${findRows}</table></div></details>

<h2 id="checks">Checks on this build</h2>
<div class="cards">
<div class="card"><h3>Module tests</h3><p><span class="num">${TESTS.reduce((a, [, n]) => a + n, 0)}</span> checks in ${TESTS.length} files: ${TESTS.map(([f, n]) => `${f} ${n}`).join(', ')}. All pass.</p></div>
<div class="card"><h3>Same frame, any order</h3><p><span class="num">62</span> times rendered in scrambled order and on a fresh page are byte-identical; 61 distinct frames.</p></div>
<div class="card"><h3>Cameras match the storyboard</h3><p><span class="num">188</span> landmark comparisons, worst difference 2e-15 of the frame (tolerance 0.01).</p></div>
<div class="card"><h3>Rendering cost</h3><p><span class="num">${Math.round(src.preview.msPerFrame)}</span> ms a frame in software WebGL: the preview took ${Math.round(src.preview.seconds)} s for ${src.preview.frames.toLocaleString('en-US')} frames; ${src.stills.count} stills took ${Math.round(src.stills.stillSeconds)} s.</p></div>
</div>
<p class="dim small">Run on 2026-10-22 against the build this page shows. No em or en dashes in any source file (0 hits).</p>
<details><summary>Known, for the look stage and later (not blockout problems)</summary><p>${md(known(src.notes))}</p></details>

<footer>Source: <code>_workbench/snowy-bridge/</code> on branch <code>claude/snow-lamp-bridge-scene-kyov3c</code>. This round's notes are in <code>review/round-${esc(round)}/notes.md</code>; the numbers in the decisions come from <code>scripts/gate2-measure.js</code>. The lifted copies use gamma ${LIFT_GAMMA}.</footer>
</div>
<dialog id="lb" aria-label="Enlarged image"><div class="head"><span id="lbt"></span><button type="button" class="btn" id="lbx">Close</button></div><img id="lbi" alt=""></dialog>
<script>
(function () {
  var DECS = ${JSON.stringify(decs.map((d) => ({ id: d.id, title: d.title, options: d.options.map((o) => ({ key: o.key, label: o.label })) })))};
  var $ = function (id) { return document.getElementById(id); };
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }

  // lightbox and shot strip
  var lb = $('lb'), lbi = $('lbi'), lbt = $('lbt');
  document.addEventListener('click', function (e) {
    var z = e.target.closest('.zoom');
    if (z && lb && lb.showModal) { var im = z.querySelector('img'); lbi.src = im.currentSrc || im.src; lbi.className = im.className; lbi.alt = z.getAttribute('data-alt') || ''; lbt.textContent = z.getAttribute('data-alt') || ''; lb.showModal(); return; }
    var g = e.target.closest('[data-go]');
    if (g) { var el = $(g.getAttribute('data-go')); if (el) el.scrollIntoView({ block: 'start' }); return; }
    var p = e.target.closest('[data-play]');
    if (p) { playFrom(Number(p.getAttribute('data-play'))); return; }
    if (e.target.id === 'lbx' || e.target === lb) lb.close();
  });

  // preview
  var vid = $('vid');
  function playFrom(t) {
    vid.scrollIntoView({ block: 'center' });
    var go = function () { vid.currentTime = t; var r = vid.play(); if (r && r.catch) r.catch(function () {}); };
    if (vid.readyState >= 1) go(); else { vid.addEventListener('loadedmetadata', go, { once: true }); vid.load(); }
  }

  // Lift shadows: swap every frame and the preview for its lifted copy
  var liftBtn = $('lift');
  function setLift(on) {
    liftBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    document.querySelectorAll('[data-lifttoggle]').forEach(function (b) { b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    document.querySelectorAll('img[data-lift]').forEach(function (im) {
      if (!im.dataset.base) im.dataset.base = im.getAttribute('src');
      im.setAttribute('src', on ? im.dataset.lift : im.dataset.base);
    });
    if (!vid.dataset.base) vid.dataset.base = vid.getAttribute('src');
    var want = on ? vid.dataset.lift : vid.dataset.base;
    if (vid.getAttribute('src') !== want) {
      var t = vid.currentTime || 0, playing = !vid.paused;
      vid.setAttribute('src', want); vid.load();
      vid.addEventListener('loadedmetadata', function () { if (t) vid.currentTime = t; if (playing) { var r = vid.play(); if (r && r.catch) r.catch(function () {}); } }, { once: true });
    }
    if (lb.open && lbi.classList.contains('still')) { var b = lbi.getAttribute('src').replace(/^lift\\//, ''); lbi.setAttribute('src', on ? 'lift/' + b : b); }
    store('slb-gate2-lift', on ? '1' : '0');
  }
  liftBtn.addEventListener('click', function () { setLift(liftBtn.getAttribute('aria-pressed') !== 'true'); });
  document.querySelectorAll('[data-lifttoggle]').forEach(function (b) { b.addEventListener('click', function () { setLift(liftBtn.getAttribute('aria-pressed') !== 'true'); }); });
  if (store('slb-gate2-lift') === '1') setLift(true);

  // answers: one document per decision, answers/d1 to answers/d6. One write at a time per document, only when the
  // answer changed; a write that fails for a passing reason is retried once; picks made before the store is ready
  // are written once it is.
  var db = null, isReady = false, local = {}, saving = {}, dirty = {}, timers = {}, last = {}, early = {};
  function formOf(id) {
    var r = document.querySelector('input[name="' + id + '"]:checked');
    return { choice: r ? r.value : '', note: $(id + '-note').value.trim() };
  }
  function bodyOf(id) {
    var d = DECS.filter(function (x) { return x.id === id; })[0], f = formOf(id);
    var opt = d.options.filter(function (o) { return o.key === f.choice; })[0];
    return { decision: d.title, choice: f.choice, choiceLabel: opt ? opt.label : '', note: f.note, updatedAt: new Date().toISOString() };
  }
  var sig = function (b) { return b.choice + '|' + b.note; };
  function status(id, text, cls, retry) {
    var s = $(id + '-status'); s.textContent = text; s.className = 'status' + (cls ? ' ' + cls : '');
    if (retry) { var b = document.createElement('button'); b.type = 'button'; b.className = 'btn small'; b.textContent = 'Retry'; b.addEventListener('click', function () { save(id, true); }); s.appendChild(document.createTextNode(' ')); s.appendChild(b); }
  }
  function count() {
    var n = DECS.filter(function (d) { return formOf(d.id).choice; }).length;
    $('count').textContent = n + ' of ' + DECS.length + ' answered';
  }
  function apply(id, data) {
    if (dirty[id] || saving[id]) return;
    if (data.choice) { var r = $(id + '-' + data.choice); if (r) r.checked = true; }
    var ta = $(id + '-note'); if (document.activeElement !== ta && typeof data.note === 'string') ta.value = data.note;
    if (db) last[id] = sig({ choice: data.choice || '', note: data.note || '' });
    if (data.choice) status(id, db ? 'Saved' : 'Kept on this device only', db ? 'saved' : '');
  }
  function save(id, force) {
    clearTimeout(timers[id]);
    var body = bodyOf(id);
    if (!body.choice && !body.note) { dirty[id] = false; return; }
    if (!db) {
      local[id] = body; store('slb-gate2-answers', JSON.stringify(local)); dirty[id] = false;
      if (!isReady) { early[id] = true; status(id, 'Kept on this page until the answer store is ready'); return; }
      status(id, 'Kept on this device only: use Copy answers to send it'); return;
    }
    if (saving[id]) { dirty[id] = true; return; }
    if (!force && last[id] === sig(body)) { dirty[id] = false; status(id, 'Saved', 'saved'); return; }
    saving[id] = true; dirty[id] = false; status(id, 'Saving');
    write(id, body, 0);
  }
  function write(id, body, attempt) {
    db.doc('answers/' + id).set(body).then(function () {
      saving[id] = false; last[id] = sig(body); status(id, 'Saved', 'saved');
      if (dirty[id]) save(id);
    }, function (err) {
      var code = err && err.code;
      if ((code === 'unavailable' || code === 'resource_exhausted') && attempt === 0) {
        status(id, 'Saving (trying again)');
        setTimeout(function () { dirty[id] = false; write(id, bodyOf(id), 1); }, 1200);
        return;
      }
      saving[id] = false; dirty[id] = false;
      if (code === 'invalid_argument') status(id, 'Not saved: this page lets you view but not answer. Use Copy answers.', 'err');
      else status(id, 'Not saved (' + (code || 'error') + '). Use Retry, or Copy answers.', 'err', true);
    });
  }
  DECS.forEach(function (d) {
    document.querySelectorAll('input[name="' + d.id + '"]').forEach(function (r) { r.addEventListener('change', function () { dirty[d.id] = true; count(); save(d.id); }); });
    $(d.id + '-note').addEventListener('input', function () { dirty[d.id] = true; clearTimeout(timers[d.id]); timers[d.id] = setTimeout(function () { save(d.id); }, 800); });
  });
  try { local = JSON.parse(store('slb-gate2-answers') || '{}') || {}; } catch (e) { local = {}; }
  var claude = window.claude;
  var ready = claude && claude.use ? claude.use('db') : Promise.resolve(null);
  ready.catch(function () { return null; }).then(function (got) {
    db = got; isReady = true;
    if (!db) {
      $('savenote').textContent = 'Answers cannot be saved to this page here, so they stay on this device. Use Copy answers and paste them in the chat.';
      Object.keys(local).forEach(function (id) { apply(id, local[id]); });
      Object.keys(early).forEach(function (id) { status(id, 'Kept on this device only: use Copy answers to send it'); });
      count(); return;
    }
    $('savenote').textContent = 'Answers save to this page as you pick them, and I read them from there. Change one any time.';
    var pending = Object.keys(early); pending.forEach(function (id) { dirty[id] = true; });
    db.collection('answers').onSnapshot(function (snap) {
      snap.docs.forEach(function (doc) { if (doc.exists && /^d[1-6]$/.test(doc.id)) apply(doc.id, doc.data()); });
      if (pending) { var p = pending; pending = null; p.forEach(function (id) { save(id, true); }); }
      count();
    }, function () { $('savenote').textContent = 'The saved answers stopped updating. Picks still save; reload to see changes made elsewhere.'; });
  });

  // copy answers as text
  $('copy').addEventListener('click', function () {
    var lines = ['Gate 2 answers (Snow, Lamp, Bridge)'];
    DECS.forEach(function (d, i) {
      var f = formOf(d.id), o = d.options.filter(function (x) { return x.key === f.choice; })[0];
      lines.push((i + 1) + '. ' + d.title + ': ' + (o ? '(' + o.key + ') ' + o.label : 'no answer') + (f.note ? '. Note: ' + f.note : ''));
    });
    var text = lines.join('\\n'), ta = $('copytext'), done = function (msg) { $('copystatus').textContent = msg; };
    var fallback = function () { ta.hidden = false; ta.value = text; ta.focus(); ta.select(); done('Select all and copy the text below.'); };
    try { navigator.clipboard.writeText(text).then(function () { done('Copied. Paste it in the chat.'); }, fallback); } catch (e) { fallback(); }
  });
  count();
})();
</script>
`;
  const hit = html.match(DASHES);
  if (hit) throw new Error(`the page contains ${hit.length} em or en dashes`);
  return html;
}

export function buildPage({ round = '02', out = resolve(ROOT, 'out/gate2-page'), log = console.log } = {}) {
  const roundDir = resolve(ROOT, `review/round-${round}`);
  const src = readSources(roundDir);
  const rows = dispositions(src.notes, src.findings);
  const decs = decisions(src);
  const stillsByShot = new Map(SHOTS.map((s) => [s.n, src.stills.stills.filter((x) => x.shot === s.n)]));

  // every file the page references, published at the same relative path
  const plain = new Set(['preview.mp4', 'contact-sheet.png', 'storyboard-sheet.png', 'map.png', 'map-detail-arrival.png']);
  const lifted = new Set();
  for (const s of src.stills.stills) { plain.add(s.file); lifted.add(s.file); }
  for (const s of SHOTS) plain.add(`panels/shot-${pad2(s.n)}.png`);
  for (const d of decs) for (const fr of d.frames) { plain.add(fr.src); if (!fr.src.startsWith('map')) lifted.add(fr.src); }

  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  for (const f of plain) {
    const from = resolve(roundDir, f);
    if (!existsSync(from)) throw new Error(`missing ${from}${f.startsWith('decisions/') ? ' (render it with node scripts/stills.js --outdir review/round-02/decisions)' : ''}`);
    mkdirSync(dirname(resolve(out, f)), { recursive: true });
    copyFileSync(from, resolve(out, f));
  }
  for (const f of lifted) liftPng(resolve(roundDir, f), resolve(out, 'lift', f));
  log(`lifting the preview (gamma ${LIFT_GAMMA})`);
  liftMp4(resolve(roundDir, 'preview.mp4'), resolve(out, 'lift/preview.mp4'));

  const sizes = new Map(), size = (f) => { if (!sizes.has(f)) sizes.set(f, pngSize(resolve(roundDir, f))); return sizes.get(f); };
  const html = pageHtml({ round, src, rows, decs, stillsByShot, size });
  writeFileSync(resolve(out, 'review-page.html'), html);
  const files = [...plain, ...[...lifted].map((f) => `lift/${f}`), 'lift/preview.mp4'].sort();
  const bytes = files.reduce((a, f) => a + statSync(resolve(out, f)).size, 0);
  writeFileSync(resolve(out, 'files.json'), `${JSON.stringify(files, null, 1)}\n`);
  log(`wrote ${resolve(out, 'review-page.html')} (${(html.length / 1024).toFixed(0)} KB) and ${files.length} files (${(bytes / 1048576).toFixed(1)} MB)`);
  return { out, files, bytes, rows, decs };
}

const isMain = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { values: a } = parseArgs({ options: { round: { type: 'string', default: '02' }, out: { type: 'string' } }, strict: true });
  try {
    buildPage({ round: pad2(Number(a.round)), out: a.out && resolve(a.out) });
  } catch (e) {
    console.error(`review page failed: ${e.message}`);
    process.exitCode = 1;
  }
}
