# Round 05, the audio stills and the arrangement sheet: Sound 2.9 (branch s2-stills)

For the lead to merge into `notes.md`. Made by `node scripts/sound-review.js --round 05 --stills --sheet` after
`--measure` had written `measure.json` (the steps also run after it in one call: `--measure --stills --sheet`).
Every number drawn is measured (`measure.json`, a stem, the render) or predicted (`cues.js` through the storyboard's
rule), and every image's legend says which. Agents cannot hear, so these are the pictures of sound the panel starts
from (SOUND-PLAN 1.2 and 4.7).

## What is drawn, and from what

| File | What | From |
|---|---|---|
| `stills/shot-NN.png` (15, 1200 px wide; the SVG under `out/round-05/stills/`) | One per shot, top to bottom on one time axis: the header (shot, title, times, lens, place, how many cues sound and start) and its row of measure.json's loudness entry; the momentary (400 ms) and short-term (3 s) loudness lines; the cues at their measured onsets; the spectrogram of the mastered mix; predicted against measured level per voice group (or per body); the pan meter; the misses by name; the legend | measure.json (table, measures, series), the mastered mix (the -23 LUFS render), the voice groups' stems before the master, cues.js through makePredictor |
| `arrangement.png` (3446 by 3700 px; the SVG under `out/round-05/`) | Round 04's cue timeline (the same 32 lanes, 28 px a second, -30 to +18 dB, colours, envelopes, ticks, bed-only windows and place change; the pan lines left out), with each voice group's measured level, every voiced cue's measured onset, the misses and flags named, the silence measure's count under each bed-only window, and the mix's loudness along the bottom | the same |
| `contact-sheet.html`, `contact-sheet.png` | The arrangement, the 15 stills, measure.json's 15 entries (status, bar, source, summary; the rows collapsed), the listening stems and the decision clips | the files beside it |
| `stills.json` | Per still: its PNG and SVG, shot, span, size, the PNG's mapping (x of time t is x0 + (t - t0) pxPerSec device pixels), its lanes, the cues carried in from earlier shots, and every marker's cue, measured onset, drawn x and misses | the drawings |

## How

- **One session, nothing rendered twice.** `--stills` and `--sheet` join `STEPS` in `scripts/sound-review.js` and read
  the session's memoised renders: the mastered mix (`session.mastered()`) and the 30 voice-group stems
  (`session.group(g)`). After `--measure` in the same run they are already there. Alone, the steps read
  `review/round-05/measure.json` and refuse it unless its raw render's sha256 is the session's (the same code and cues,
  byte for byte), then render the raw mix, the master and the 30 stems once (about 25 s here). The session now lists
  every render it makes (`session.rendered`); each step logs what it rendered.
- **Measured.** The spectrogram: a 4096-sample Hann window centred on each device pixel column of the mastered mix, the
  two channels' power averaged, dB against a full-scale sine, 260 log-spaced rows from 25 Hz to 20 kHz (each its band's
  loudest bin; a row narrower than a bin interpolates), coloured in 3 dB steps from -88 to -22 dB. The level lines:
  each lane's stems before the master (summed, for a body), both channels' power in the level plan's 100 ms window
  centred on each point, minus measure.json's street background (-30.027 dB). The pan line: the mastered mix's balance
  in the same window, drawn on the spatializer's equal-power scale (a balance b sits at pan 4 atan(10^(b/20)) / pi - 1),
  left at the top as round 04's lanes. Dots, rings and glyphs: measure.json's level, pan and table.onset rows. The
  loudness: measure.json's series, each reading at its window's middle.
- **Predicted.** The level envelopes: `makePredictor` (round 04's rule) at each point, power-summed over the lane's cues
  sounding there; the hollow rings: measure.json's predictedDb and predicted balance; the dashed line: the background
  playing (`refAt`).
- **The lanes.** One per voice group sounding in the shot when there are at most 7; otherwise the night as one lane and
  the other groups each their own while there are at most 6 of them; otherwise one per body (the night, the car, A, B):
  shots 5 and 9.
- **The colours.** The markers by person, as the reel (`captions.js` COLOUR and its lane rule: a door is its person's,
  the car and the night are the world's, white); the lanes in round 04's family colours; measured white; a miss red; a
  check 14 flag violet.
- **`buildTimeline`** gained a header option and a vertical shift (its own header moved into `drawHeader`, its key
  glyphs into `keyGlyph`); without them it draws round 04's timeline byte for byte (`storyboard/sound/timeline.svg`
  regenerated: identical sha256).

## The checks (`tests/sound-stills.test.mjs`, 11 tests, each with its planted fault; 40 s alone)

| Check | Planted fault, shown to fail |
|---|---|
| Every shot has its still; every voiced cue (142) has one marker, in the still its measured onset falls in, at X(table.onset) within half a device pixel (`markerProblems`) | measure.json with foley.feet.A.05's onset 50 ms later: exactly that marker moves, by 50 ms on its shot's axis, and the drawing from the old file is off on that cue alone; a builder marking the cue time (t0) is caught on the moved cue, and across the film on the bridge's beds (their voices start 25 ms before t0, bedSpan) |
| One time axis: every line point, dot, ring and marker at X of its own time, the spectrogram from X(t0) to X(t1) with one column a device pixel (`axisProblems`) | the spectrogram one unit right; a lane's line one unit right; a spectrogram with two columns fewer than its pixels |
| A click (one sample) lands in the spectrogram column, the level lines' and the pan line's windows at its time | the spectrogram computed over a span 10 ms later and drawn on the shot's axis puts it 0.5 units off |
| Rasterized (Chromium, as the steps do), a spectrogram column is the device pixel column its time maps to; the same SVG gives the same PNG bytes | the spectrogram drawn one unit right lands two device pixels right |
| The arrangement holds every voiced cue's measured onset in its own lane at X(onset) within half a pixel, and every cue's predicted tick; no label is dropped there or on any still (`arrangementProblems`) | a cue left out of measure.json; an onset moved 50 ms drawn at its cue time; every voiced cue off its sync bar at once, more labels than the sheet has room for |
| The reel's colours: each cue's person is the review captions' lane | a rule that leaves the doors to the world |
| Every still's SVG, the arrangement's, the contact sheet and stills.json pass `check-forbidden.js`'s scan | a label with an en dash (built from its code point) |
| Two processes draw the same bytes (a still, its spectrogram PNG, the arrangement, a stills.json entry, the contact sheet) | a label that prints the clock |
| The steps render nothing twice: a second pass over the session renders nothing and `session.rendered` has no key twice; neither step nor the library calls a renderer itself | a session that does not keep its renders (`keep: false`); a step source that calls `preMaster` |
| No label overlaps another, leaves its drawing or is under 11 units on a still (round 04's 9 px floor on the arrangement), and none is dropped | a label moved onto its neighbour; a label at 8 units |
| The committed stills.json, stills and contact sheet are these drawings of this measure.json: each PNG the drawing's size, each mapping the drawing's, each marker's x its onset's mapping within half a pixel; the contact sheet byte for byte the code's, showing the arrangement and every still and linking every measure, stem and clip, each file there | a marker one pixel off; a still left off the sheet |
- **The runs.** `--stills --sheet` alone: 25 s to render (33 renders: the raw mix, its true peaks, the master and the 30
  group stems), 30 s for the 15 stills, 5 s for the sheet, which rendered nothing (the session's memo). Run twice, all
  35 files (15 PNG and 15 SVG, the arrangement's PNG and SVG, the contact sheet's HTML and PNG, stills.json) came out
  byte for byte the same. Sizes: the stills 0.56 to 0.90 MB each (9.8 MB), the arrangement 1.0 MB, the contact sheet's
  PNG 6.3 MB (1500 by 12177 px), its HTML 0.2 MB. `--measure --stills --sheet` in one call (4.4 minutes for the
  measure): the stills and the sheet logged "rendered: nothing", and every committed file, measure.json and the stems
  included, came out byte for byte as committed.

## Looked at, and what was fixed before committing

Every still, the arrangement and the contact sheet were opened at full size and scaled to 390 px wide (the contact
sheet also rendered as a page 390 px wide, as a phone shows the HTML). Fixed on the way, each seen on an image first:

| Seen | Fix |
|---|---|
| The spectrogram drew the beds orange and the cues hardly brighter (the first scale was set from linear bins, which over-count the quiet top octaves) | The scale from the rows' own levels: -88 to -22 dB |
| A lane's name on a chip hid the measured line where it ran near the top (the night's +2.5 dB on the bridge) | Each lane's name on its own row above it, with how far its cues' loudest 100 ms are from their predictions |
| At 390 px the 12-unit text was under 8 px | Titles, lane names, the misses and the legend at 13 to 14 units (8.5 to 9 px at 390); only the marker labels and the axes' numbers stay at 11 to 12 |
| Two red labels said "scuff 1: sync", A's and B's, the red having replaced the person's colour | A marked label names its person ("A scuff 1: sync"), and a check 14 flag says "phone" |
| The place change line crossed the strip titles; the colour bar's labels touched the next legend line; "None: ..." ran off the right edge; the lists started on their titles' baselines; the night's lane label and the pan title ran past 600 units | Each fixed, then held by the label check (no overlap, nothing outside, nothing under 11 units) |
| On the arrangement one miss label was dropped, and two labels ran through a neighbour's ring | More places to try, and every ring blocked before any label is placed; none dropped |
| The contact sheet said "(a starting value)" after bars that already say so, and "1 onsets" | Fixed |

At 390 px the stills read: the header, the strip titles, the lane names with their differences, the misses by name and
the legend (about 9 px), the glyphs and their colours, the red and violet rings and the red brackets. The marker labels
(12 units, 7.8 px) and the axes' numbers are legible only zoomed in or at full size. The arrangement at 390 px is a
thumbnail: like round 04's timeline it is a sheet to zoom into (3446 px wide); at full size every label reads. The
contact sheet as a page 390 px wide stacks one still a row at the screen's width.

## What the stills show (for the panel to start from)

Numbers along the curves come from the stills' own data (the stems' 100 ms windows against the predictor at each
point, leaving out 60 ms either side of each cue's start and end, where a centred window straddles them); the rest is
measure.json.

- **Measured and predicted disagree most on the car, over time, not at the loudest window.** In shot 4 (22 to 29 s) the
  tyres' measured level falls under the prediction as the car slows: median -10.6 dB (front) and -11.0 (rear), a tenth
  of the points under -23 dB, -44 dB at 28.93 s as it stops; in shot 3 already -2.0 and -2.1 (to -6.5 at 20.9 s). The
  tyres' placeholder takes its level from `carAt(t).speed` (voices.js, `tyres`), the predictor holds the designed level
  with the rise and the swell. measure.json's level entry sees only -1.27 dB (front), at the loudest 100 ms (19.1 s).
  The engine's two parts sit under their prediction too: median -1.1 dB in shot 3, -3.3 in shot 4 (to -5.5 at 25.3 s),
  -2.8 and -2.9 at their loudest windows (28.4 and 28.7 s): the prediction rises with the swell (+3 dB from 17.5 to 29
  s); the buzz is a saw at the rpm's firing rate through a fixed band (voices.js), so its level likely moves with the
  rpm as the car slows. That cause is read in the code, not measured apart. The brakes (pads2) sit 2.4 dB under (median,
  shot 4).
- **The ticks far away** read 1.2 dB (08) and 3.3 dB (09, 10) under their predictions (shots 8 and 9, labelled on the
  stills): measure.json's level entry, the air lowpass the predictor leaves out.
- **Where they agree.** The beds and the hum, the whole film: the night's lanes median 0.0 dB, a tenth to nine tenths
  within 0.4 dB (the city bed's own noise 1.3); the hum to 0.0 everywhere, close in shot 1 (+1.6 dB) and far in shot 2
  (-19.9 dB at 66 m, predicted -19.95). The steps, the doors and the other one-shots agree at their loudest 100 ms (the 83
  that are not ticks within 0.26 dB, the near ticks 0.5 to 0.6 dB under: measure.json, the dots); along their spans the prediction is a flat box while the burst decays, so those curves differ
  by drawing, not by level. The continuous foley (cloth, slides, the flame) sits 0.7 to 1.7 dB under its flat
  prediction along its span (median) and matches at its loudest 100 ms: the level rule sets the loudest window.
- **Dense.** Shot 5 (29 to 40 s): 55 onsets in 11 s, the marker band 9 label rows deep; 30.4 to 36.2 s holds the doors,
  the seats, the belts, both walkers' first steps and turns, the scuffs and the idle; the spectrogram shows the doors'
  and steps' broadband streaks over the idle's harmonics under 250 Hz until the run-down ends at 36.6 s; measure.json
  counts 3 bodies in 10 runs between 33.2 and 37.8 s (none over), 12 voices at 34.61 s. Shot 7 (23 onsets in 8 s, the
  two walkers alternating) and shot 8 (17 in 6 s) are steady. The mix's balance swings widest in shot 5 (a twentieth of
  the windows under -3.6 dB, a twentieth over +5.5 dB) and shot 9 (to +4.3 dB).
- **The phone loses the latches.** The driver's and the passenger's latches (34.500 and 35.600 s, shot 5) live only
  from 178 to 224 Hz and lose 15.3 and 16.0 dB on the phone model (22 to 23 on a small phone); on the still they are
  violet, and the spectrogram shows them as short bright spots under the 250 Hz line, below the phone's 500 Hz
  high-pass. The run-down (-3.4 dB on a phone, band 282 to 891 Hz) and the intake (-1.9 dB, 355 to 1122 Hz) also reach
  under 500 Hz. The hum's partials (120 and 240 Hz, timbre.js) are the two lines under the phone's line in every shot.
- **Silence holds where planned.** Shots 1 and 2, 10, 12 and 15 have no onset (measure.json's silence: 0 in each window);
  their spectrograms show only the beds and the hum's two lines, and shot 1 the fade in. After the engine dies (36.6 s)
  the hush shows: shot 6's momentary loudness median -27.2 LUFS against shot 5's -19.6, and from 41.3 to 44.5 s only
  tick 04 (42.97 s) starts. After the rests (63.7 s) nothing starts but tick 10 (65.65 s) until A turns at 77.5 s: 13.8 s across
  shot 10. Shot 15's last 1.5 s is the master's fade (the loudness line and the spectrogram; the lanes are before the
  master and do not fade).
- **Off their bar, all in sync, all foley (the 12 of Sound 1).** Shot 5: A's scuff 1 (its event not shown within 0.5 s),
  B's scuff 1 (110.1 ms after its frame), B's turn 2 (125.0 ms ahead), B's scuff 2 (4.5 ms after); shot 6: A's scuff 2
  (77.1 ms after); shot 9: both leans (83.3 ms ahead); shot 11: A's turn 4 (83.3 ms ahead) and scuff 4 (80.1 ms after);
  shot 13: A's shift (133.3 ms ahead), B's shift (50.0 ms ahead), B's scuff 3 (88.2 ms ahead). Each is a red ring with
  a bracket to its frame on its still and on the arrangement. No pan miss and no renderer miss anywhere: every placed
  cue's measured balance sits in its predicted ring (worst 0.101 dB).

## What is not drawn, and why

- The third octaves per cue (measure.json bands) and the masking measure: the spectrogram is the mix, not each cue
  against its masker; the bands are in measure.json, and a per-cue band picture is for the panel to ask for.
- The cue ends (measure.json ends) as marks: the level lines show where each voice stops; a mark per end would double
  the marker band in shot 5.
- The drift of the parked design layers (Sound 2.7): a different stage's render, reported in measure.json; the stills
  show the blockout only.
- The spectrogram has one resolution (a 4096-sample window, 85 ms): its onsets are smeared about 40 ms either way, so
  timing is read from the markers, never from the spectrogram.
- The level lines use the level plan's 100 ms window centred on each point, so a one-shot's line starts 50 ms before its
  onset; the legend says so.
- The arrangement does not read at phone width (a 3446 px sheet); the stills are the pictures for the phone.

## Carried forward

| Item | Where |
|---|---|
| The tyres and the engine under their prediction as the car slows (the placeholders follow speed and rpm; the predictor does not) | Sound 2.10's panel, then Sound 3: a predictor that follows the same data, or placeholders that do not |
| The latches only below 250 Hz | Sound 4 (already carried from Sound 2.6) |
| The 12 sync misses | Sound 3 (already carried) |
| The contact sheet's PNG is 6.3 MB | if the gate package needs it smaller: a JPEG copy, or the stills at a lower scale |
