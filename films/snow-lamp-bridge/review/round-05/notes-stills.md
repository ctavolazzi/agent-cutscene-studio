# Round 05, the audio stills and the arrangement sheet: Sound 2.9 (branch s2-stills)

For the lead to merge into `notes.md`. Made by `node scripts/sound-review.js --round 05 --stills --sheet` after
`--measure` had written `measure.json` (the steps also run after it in one call: `--measure --stills --sheet`).
Every number drawn is measured (`measure.json`, a stem, the render) or predicted (`cues.js` through the storyboard's
rule), and every image's legend says which. Agents cannot hear, so these are the pictures of sound the panel starts
from (SOUND-PLAN 1.2 and 4.7). The second half of this branch answers the checker's findings F1 to F7 (the last
section).

## What is drawn, and from what

| File | What | From |
|---|---|---|
| `stills/shot-NN.png` (15, 1200 px wide; the SVG under `out/round-05/stills/`) | One per shot, top to bottom on one time axis: the header (shot, title, times, lens, place, how many cues sound and start) and its row of measure.json's loudness entry; the momentary (400 ms) and short-term (3 s) loudness lines; the cues at their measured onsets; the spectrogram of the mastered mix; predicted against measured level per voice group (or per body); the pan meter; under the time axis, the pan key of the cues longer than 1 s; the misses by name; the legend | measure.json (table, measures, series), the mastered mix (the -23 LUFS render), the voice groups' stems before the master, cues.js through makePredictor |
| `arrangement.png` (3446 by 3700 px; the SVG under `out/round-05/`) | Round 04's cue timeline (the same 32 lanes, 28 px a second, -30 to +18 dB, colours, envelopes, ticks, bed-only windows and place change; the pan lines left out), with each voice group's measured level, every voiced cue's measured onset, the misses and flags named, the silence measure's count under each bed-only window, and the mix's loudness along the bottom | the same |
| `contact-sheet.html`, `contact-sheet.png` | The arrangement, the 15 stills, measure.json's 15 entries (status, bar, source, summary; the rows collapsed), the listening stems and the decision clips | the files beside it |
| `stills.json` | Per still: its PNG and SVG, shot, span, size, the PNG's mapping (x of time t is x0 + (t - t0) pxPerSec device pixels), its lanes, the cues carried in from earlier shots, every marker's cue, measured onset, drawn x and y and misses, and the sha256 of its SVG and of its PNG; the Chromium that rasterized them | the drawings |
| `sheet.json` | The arrangement's SVG and PNG sha256, size and marker count; the contact sheet's HTML and PNG sha256 and the sha256 of each image it showed when it was rasterized; the Chromium | the drawings |

## How

- **One session, nothing rendered twice.** `--stills` and `--sheet` join `STEPS` in `scripts/sound-review.js` and read
  the session's memoised renders: the mastered mix (`session.mastered()`) and the 30 voice-group stems
  (`session.group(g)`). After `--measure` in the same run they are already there. Alone, the steps read
  `review/round-05/measure.json` and refuse it unless its raw render's sha256 is the session's (`measureOf`; the same
  code and cues, byte for byte), then render the raw mix, the master and the 30 stems once (about 25 s here). The
  session lists every render it makes (`session.rendered`); each step logs what it rendered.
- **Measured.** The spectrogram: a 4096-sample Hann window centred on each device pixel column of the mastered mix, the
  two channels' power averaged, dB against a full-scale sine, 260 log-spaced rows from 25 Hz to 20 kHz (each its band's
  loudest bin; a row narrower than a bin, under about 450 Hz, reads between the two nearest bins, so a tone there
  lights the row of the nearer bin centre: up to 2 px off at 100 Hz and 4 at 50, as the legend says), coloured in 3 dB
  steps from -88 to -22 dB. Check 14's 250 Hz and the phone's 500 Hz high-pass are violet ticks on both edges, off the
  picture itself. The level lines: each lane's stems before the master (summed, for a body), both channels' power in
  the level plan's 100 ms window centred on each point, minus measure.json's street background (-30.027 dB). The pan
  line: the mastered mix's balance in the same window, drawn on the spatializer's equal-power scale (a balance b sits
  at pan 4 atan(10^(b/20)) / pi - 1), left at the top as round 04's lanes. The loudness: measure.json's series, each
  reading at its window's middle; a run under the strip's floor (-45 LUFS: shot 1's fade-in to -60.7, shot 15's last
  reading -47.3) runs along the floor with an arrow and its lowest reading.
- **Numbers of measure.json, drawn as what they are.** A placed cue's level (its loudest 100 ms) is a filled dot at
  that window's middle. A bed's level (the five unplaced beds: measure.json reads it as the mean between its
  crossfades, from t0 + 25 ms to t1 - 25 ms) is a white bar over that span, ticked where the span ends inside the shot,
  and the lane's head names each bed with both numbers. A cue's pan (its balance over its whole span) is a dot at the
  span's middle for a cue up to 1 s long; a longer one (the hum, the car, the walks, the leans, the shifts and others)
  is a row of the pan key under the time axis, naming both balances, with a bar over its span.
- **Predicted.** The level envelopes: `makePredictor` (round 04's rule) at each point, power-summed over the lane's cues
  sounding there; the hollow rings and dashed bars: measure.json's predictedDb and predicted balance; the dashed line:
  the background playing (`refAt`).
- **The lanes.** One per voice group sounding in the shot when there are at most 7; otherwise the night as one lane and
  the other groups each their own while there are at most 6 of them; otherwise one per body (the night, the car, A, B):
  shots 5 and 9.
- **The markers.** By person, as the reel (`captions.js` COLOUR and its lane rule: a door is its person's, the car and
  the night are the world's, white); a miss red, a check 14 flag violet, and a marked label names its person. Glyphs
  closer than a glyph's width (or a ring and a glyph closer than the ring's reach) are stacked down, so onsets at one
  moment show every person and a ring holds only its own glyph; each label sits on an opaque chip drawn over the
  leaders, so a leader stops at the labels it passes.
- **`buildTimeline`** gained a header option and a vertical shift (its own header moved into `drawHeader`, its key
  glyphs into `keyGlyph`); without them it draws round 04's timeline byte for byte (`storyboard/sound/timeline.svg`
  regenerated: identical sha256).

## The checks

`tests/sound-stills.test.mjs`: 20 tests on synthetic signals (zeros, a click, tones, seeded noise, a constant), each
with its planted fault, about 39 s alone. `tests/sound-stills-rebuild.test.mjs`: 2 tests on a real session, about 37 s
alone.

| Check | Planted fault, shown to fail |
|---|---|
| Every shot has its still; every voiced cue (142) has one marker, in the still its measured onset falls in, at X(table.onset) within half a device pixel (`markerProblems`) | measure.json with foley.feet.A.05's onset 50 ms later: exactly that marker moves, by 50 ms on its shot's axis, and the drawing from the old file is off on that cue alone; a builder marking the cue time (t0) is caught on the moved cue, and across the film on the bridge's beds (their voices start 25 ms before t0, bedSpan) |
| One time axis: every line point, dot, ring, marker and bar at X of its own time or span, the spectrogram from X(t0) to X(t1) with one column a device pixel (`axisProblems`) | the spectrogram one unit right; a lane's line one unit right; a spectrogram with two columns fewer than its pixels |
| A click (one sample) lands in the spectrogram column, the level lines' and the pan line's windows at its time | the spectrogram computed over a span 10 ms later and drawn on the shot's axis puts it 0.5 units off |
| Rasterized (Chromium, as the steps do), a spectrogram column is the device pixel column its time maps to; the same SVG gives the same PNG bytes | the spectrogram drawn one unit right lands two device pixels right |
| The arrangement holds every voiced cue's measured onset in its own lane at X(onset) within half a pixel, and every cue's predicted tick; no label is dropped there or on any still (`arrangementProblems`) | a cue left out of measure.json; an onset moved 50 ms drawn at its cue time; every voiced cue off its sync bar at once, more labels than the sheet has room for |
| The reel's colours: each cue's person is the review captions' lane | a rule that leaves the doors to the world |
| Every still's SVG, the arrangement's, the contact sheet and stills.json pass `check-forbidden.js`'s scan | a label with an en dash (built from its code point) |
| Two processes draw the same bytes (a still, its spectrogram PNG, the arrangement, a stills.json entry, the contact sheet) | a label that prints the clock |
| The steps render nothing twice: a second pass over the session renders nothing and `session.rendered` has no key twice; neither step nor the library calls a renderer itself | a session that does not keep its renders (`keep: false`); a step source that calls `preMaster` |
| No label overlaps another, leaves its drawing or is under 11 units on a still (round 04's 9 px floor on the arrangement), and none is dropped | a label moved onto its neighbour; a label at 8 units |
| The committed stills.json and contact sheet are these drawings of this measure.json (each PNG the drawing's size, each mapping the drawing's, each marker's x its onset's mapping within half a pixel; the contact sheet byte for byte the code's, showing the arrangement and every still and linking every measure, stem and clip, each file there); every committed PNG hashes to the sha256 stills.json or sheet.json records, the contact sheet's HTML to its own, and the images the contact sheet's PNG was made from to those there now | a marker one pixel off; a still left off the sheet; one still's PNG with one byte changed (found on that still and on the contact sheet made from it) |
| Frequency: a tone at each of the eight ticks (50 Hz to 10 kHz) is brightest, in the spectrogram's own decoded pixels, in the rows where its tick is drawn, within one row and the half bin of the legend's note; the ticks rise with frequency (`toneProblems`) | the spectrogram's rows upside down |
| Pan: a mix left only, right only, right at half and left at a quarter draws its pan line where the meter puts each balance (the top, the foot, -6.02 and +12.04 dB), and L 10 is above 0 dB above R 10 (`panSideProblems`) | the balance's sign swapped; the meter drawn upside down |
| Level: a constant stem draws its white line at its level over the street, on every lane of shot 8 (the night sums four) and every lane of the arrangement (`levelLineProblems`, `arrangementLevelProblems`, `groupLevels`) | the still's and the arrangement's lines not over the street (30 dB off) |
| Values: every level dot, ring, bed bar, pan dot, pan ring and key row is at measure.json's number for it, measured and predicted apart, read back from the strips' scales, and every cue that has such a number in the shot has its mark once (`valueProblems`) | the measured pan dots drawn at the predicted balance; the level dots 50 ms early (at levelT: each at X of its own time, so the axis check passes); the bridge wind's white bar at its prediction; a key row with another number; a dot left out |
| Predicted: each lane's envelope is the power sum of the predictor over the enabled voiced cues of its groups (taken from cues.js, not from the lane), drawn wherever one sounds; the predictor gives round 04's drawn timeline envelope for every enabled voiced cue, read back from its drawing (`predictedProblems`) | a lane missing one step in the shot; a predictor 3 dB off (on the stills, and against the timeline) |
| Loudness: each point at its window's middle and value, every reading of the shot drawn, a reading under the floor inside a mark (`loudnessProblems`) | the momentary drawn at its windows' ends (the axis check passes); shot 1's marks removed |
| People: a miss label names the review captions' person, and every glyph keeps that person's colour (`missLabelProblems`) | "A scuff 1: sync" on B's scuff |
| Glyphs and leaders: no glyph on another, no ring around another cue's glyph, every label on an opaque chip drawn after the leaders (`glyphProblems`, `leaderProblems`) | shot 8's glyphs left on one row (A.29 on B.21); shot 5's labels without chips |
| measureOf returns the measure.json measured on the session's own render, and refuses one measured on another and a missing one | a guard that never compares (it accepts the other render) |
| Rebuild (`tests/sound-stills-rebuild.test.mjs`): a session renders the blockout, measureOf reads measure.json, and every still and the arrangement rebuilt from it hash to the SVG sha256 stills.json and sheet.json record; rasterized by the Chromium recorded there (the test skips this half on another Chromium, whose fonts and raster may differ), they give the recorded PNG sha256 | shot 5 on a colour scale 2 dB lower (SPEC.lo -90), its SVG and its PNG; the arrangement's levels not over the street |

Each of the checker's code mutations was applied to a scratch copy and the two test files run on it; the results are
in the last section.

- **The runs.** `--stills --sheet` alone: 25.6 s to render (33 renders: the raw mix, its true peaks, the master and
  the 30 group stems) and draw the 15 stills, 5.3 s to rasterize them, 5.4 s for the sheet, which rendered nothing
  (the session's memo). Run twice, all 36 files (15 PNG and 15 SVG, the arrangement's PNG and SVG, the contact sheet's
  HTML and PNG, stills.json, sheet.json) came out byte for byte the same. Sizes: the stills 1200 by 2784 to 3692 px,
  0.70 to 1.10 MB each (12.4 MB), the arrangement 1.0 MB, the contact sheet's PNG 7.7 MB (1500 by 13409 px), its HTML
  0.2 MB, stills.json 34 KB, sheet.json 2 KB.

## Looked at, and what was fixed

Every still, the arrangement and the contact sheet were opened at full size and scaled to 390 px wide (the contact
sheet also rendered as a page 390 px wide, as a phone shows the HTML). Fixed on the way, each seen on an image first:

| Seen | Fix |
|---|---|
| The spectrogram drew the beds orange and the cues hardly brighter (the first scale was set from linear bins, which over-count the quiet top octaves) | The scale from the rows' own levels: -88 to -22 dB |
| A lane's name on a chip hid the measured line where it ran near the top (the night's +2.5 dB on the bridge) | Each lane's name on its own row above it, with its numbers |
| At 390 px the 12-unit text was under 8 px | Titles, lane names, the misses and the legend at 13 to 14 units (8.5 to 9 px at 390); only the marker labels and the axes' numbers stay at 11 to 12 |
| Two red labels said "scuff 1: sync", A's and B's, the red having replaced the person's colour | A marked label names its person ("A scuff 1: sync"), and a check 14 flag says "phone" |
| The place change line crossed the strip titles; the colour bar's labels touched the next legend line; "None: ..." ran off the right edge; the lists started on their titles' baselines; the night's lane label and the pan title ran past 600 units | Each fixed, then held by the label check (no overlap, nothing outside, nothing under 11 units) |
| On the arrangement one miss label was dropped, and two labels ran through a neighbour's ring | More places to try, and every ring blocked before any label is placed; none dropped |
| The contact sheet said "(a starting value)" after bars that already say so, and "1 onsets" | Fixed |
| (after the checker) Labels of the beds' bars, first drawn in the night lane beside the bars, sat on its measured line | The beds' numbers moved to the lane's head, which wraps to a second row where it must (shots 3 to 9, 11, 13) |
| (after the checker) "momentary under -45 from 111.80 to 111.80 s" for a single reading, and on the arrangement that label ran off the right edge | One reading reads "momentary at 111.80 s: -47.3, under -45"; the arrangement's labels are bounded to the sheet |

After the checker's round, the stills were looked at again whole and in crops: shot 5's marker band (6 rows of
glyphs at its densest, about 34.5 s), shot 1's three beds at 0 s stacked, shot 3's four car voices at 14.0 s stacked,
shot 8's tick 08, B.21 and A.29 at 56.31 to 56.34 s three rows deep, shot 9's leans and shot 13's shifts and scuffs
each ringed alone, the pan keys of shots 3, 5 and 8, the night lanes' bars, shots 1 and 15's clamped loudness, the
violet ticks, and the hum's 120 and 240 Hz rows now clear of any line.

At 390 px the stills read: the header, the strip titles, the lane names with their numbers, the pan key, the misses by
name and the legend (about 9 px), the glyphs and their colours, the red and violet rings and the red brackets. The
marker labels (12 units, 7.8 px), the key rows (11 units) and the axes' numbers are legible only zoomed in or at full
size. The arrangement at 390 px is a thumbnail: like round 04's timeline it is a sheet to zoom into (3446 px wide); at
full size every label reads. The contact sheet as a page 390 px wide stacks one still a row at the screen's width.

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
  (-19.9 dB at 66 m, predicted -19.95). The five beds' span means (measure.json's level for an unplaced bed: the mean
  between its crossfades over its whole span, drawn as a bar) are within 0.26 dB of their predictions, all but the
  bridge's wind: its mean over 54.025 to 111.975 s reads 1.05 dB under its prediction (-0.55 against +0.50 dB), in shots 8
  to 15. The steps, the doors and the other one-shots agree at their loudest 100 ms (the 83
  that are not ticks within 0.26 dB, the near ticks 0.5 to 0.6 dB under: measure.json, the dots); along their spans
  the prediction is a flat box while the burst decays, so those curves differ by drawing, not by level. The continuous
  foley (cloth, slides, the flame) sits 0.7 to 1.7 dB under its flat prediction along its span (median) and matches at
  its loudest 100 ms: the level rule sets the loudest window.
- **Dense.** Shot 5 (29 to 40 s): 55 onsets in 11 s, the marker band 9 label rows and 6 glyph rows deep; 30.4 to 36.2 s
  holds the doors, the seats, the belts, both walkers' first steps and turns, the scuffs and the idle; the spectrogram
  shows the doors' and steps' broadband streaks over the idle's harmonics under 250 Hz until the run-down ends at 36.6
  s; measure.json counts 3 bodies in 10 runs between 33.2 and 37.8 s (none over), 12 voices at 34.61 s. Shot 7 (23
  onsets in 8 s, the two walkers alternating) and shot 8 (17 in 6 s) are steady. Onsets at one moment, now each seen:
  the beds and the hum at 0 s (shot 1), the car's four voices at 14.0 s (shot 3), tick 08 with B.21 and A.29 within 37
  ms of each other at 56.3 s (shot 8), both leans at 62.0 s (shot 9), both shifts at 94.2 s and A's scuff 5 with B's
  scuff 3 at 94.45 s (shot 13). The mix's balance swings widest in shot 5 (a twentieth of the windows under -3.6 dB, a
  twentieth over +5.5 dB) and shot 9 (to +4.3 dB).
- **The phone loses the latches.** The driver's and the passenger's latches (34.500 and 35.600 s, shot 5) live only
  from 178 to 224 Hz and lose 15.3 and 16.0 dB on the phone model (22 to 23 on a small phone); on the still they are
  violet, and the spectrogram shows them as short bright spots under the 250 Hz tick, below the phone's 500 Hz
  high-pass. The run-down (-3.4 dB on a phone, band 282 to 891 Hz) and the intake (-1.9 dB, 355 to 1122 Hz) also reach
  under 500 Hz.
- **The hum's partials** (120 and 240 Hz, timbre.js) show as two lines under the 250 Hz tick in shots 1 and 4 to 15.
  Measured on the stills' own rows (each row's median over the shot against the median of the rows 3 to 6 away on
  either side): 120 Hz stands 3.7 to 5.1 dB over its neighbours and 240 Hz 5.4 to 15.8 dB there, one to five 3 dB
  colour steps. In shots 2 and 3 they stand 1.0 and 0.6 dB (shot 2) and 2.3 and -1.4 dB (shot 3) over their
  neighbours, under one colour step: the hum is far there (-19.9 dB in shot 2) and the street and the car cover it.
- **Silence holds where planned.** Shots 1 and 2, 10, 12 and 15 have no onset (measure.json's silence: 0 in each
  window); their spectrograms show only the beds, the hum's lines in shots 1, 10, 12 and 15 (not in shot 2, above), and
  shot 1 the fade in. After the engine dies (36.6 s) the hush shows: shot 6's momentary loudness median -27.2 LUFS
  against shot 5's -19.6, and from 41.3 to 44.5 s only tick 04 (42.97 s) starts. After the rests (63.7 s) nothing
  starts but tick 10 (65.65 s) until A turns at 77.5 s: 13.8 s across shot 10. Shot 15's last 1.5 s is the master's
  fade (the loudness line, its last reading under -45 LUFS, and the spectrogram; the lanes are before the master and do
  not fade).
- **Off their bar, all in sync, all foley (the 12 of Sound 1).** Shot 5: A's scuff 1 (its event not shown within 0.5 s),
  B's scuff 1 (110.1 ms after its frame), B's turn 2 (125.0 ms ahead), B's scuff 2 (4.5 ms after); shot 6: A's scuff 2
  (77.1 ms after); shot 9: both leans (83.3 ms ahead); shot 11: A's turn 4 (83.3 ms ahead) and scuff 4 (80.1 ms after);
  shot 13: A's shift (133.3 ms ahead), B's shift (50.0 ms ahead), B's scuff 3 (88.2 ms ahead). Each is a red ring with
  a bracket to its frame on its still and on the arrangement. No pan miss and no renderer miss anywhere: every cue's
  measured balance is within 0.101 dB of its prediction (measure.json pan).

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

## The checker's findings, and what was done

| Finding | Done |
|---|---|
| F1 (high): check 11 compared only the PNGs' sizes, so the committed stills could go stale against the code | stills.json now records each still's SVG and PNG sha256, and a new sheet.json the arrangement's and the contact sheet's (and the images the contact sheet was made from), with the Chromium that rasterized them. Check 11 holds every committed PNG to its recorded sha256 (planted: one byte of one still). The new `tests/sound-stills-rebuild.test.mjs` renders a session (about 25 s), rebuilds the 15 stills and the arrangement, and compares their SVG sha256 with the records, then rasterizes them and compares the PNG sha256 (on the recorded Chromium; skipped on another). Planted: SPEC.lo -90 on shot 5, the arrangement's levels not over the street. The checker's M08 (SPEC.lo -90 in the code) fails the rebuild test |
| F2 (medium): nothing checked the vertical axes or kept measured and predicted apart | Seven read-back checks, each with planted faults (the table above): tones on their ticks from the decoded pixels; pan balances, including partial ones, at their place on the meter; a constant stem's level on every lane of a still and of the arrangement; every dot, ring, bar and key row against measure.json; the predicted envelopes against the predictor over the lanes' own cues, and the predictor against round 04's drawn timeline; loudness at each window's middle with clamped readings marked; miss labels naming the captions' person. The checker's mutations M05, M06, M07, M10, M12, M17, M18, M19, M20 and M22 each fail at least one of them (below) |
| F3 (medium): the measureOf guard had no test | A test with stub sessions: it returns the file for its own render, refuses another render and a missing file; planted: a guard that never compares. M21 fails it |
| F4 (medium): the notes claimed the hum's lines in every shot, and the 240 Hz row sat under the dashed 250 Hz line | Measured per shot (above): the lines show in shots 1 and 4 to 15, under one colour step in shots 2 and 3; the notes now say so. The 250 and 500 Hz lines and their chips are gone from the picture: violet ticks on both edges instead, so the 240 Hz row is seen, and nothing hides the spectrogram's top right |
| F5 (medium): span numbers drawn as moments | A bed's level is a bar over the span measure.json averages, named in the lane's head with both numbers; the legend says loudest 100 ms for placed cues and the span's mean for beds. Pans of cues over 1 s are rows of a key under the axis, each "over its whole span", with a bar over it (the car's four voices are four rows, not one blob). The shot 8 sentence now says the wind bed's mean over 54.025 to 111.975 s. There are five unplaced beds, not six: the two street beds and the three bridge beds (the other two unplaced background cues are modifiers with no voice) |
| F6 (low): coincident glyphs hid each other, and a ring took in another person's glyph | Glyphs stacked down the band, each ring around its own glyph only; held by `glyphProblems` (planted: shot 8 on one row) |
| F7 (low): leaders through labels; clamped loudness unmarked; the arrangement's "sync its event"; low rows at bin centres | Every marker label on an opaque chip drawn over the leaders (`leaderProblems`, planted: no chips); runs under -45 LUFS marked with an arrow and their lowest reading, on the stills and the arrangement (`loudnessProblems`, planted: the marks removed); the colon kept ("sync: its event ..."); the legend says where rows read between bins and by how much |

The mutation run (each applied to a scratch copy of the film, then `tests/sound-stills.test.mjs` and, where it
touches a drawing, `tests/sound-stills-rebuild.test.mjs`). Every one fails at least one test:

| Mutation | Fails |
|---|---|
| M05 the mix's balance with its sign swapped (log10(l / r)) | pan. With only one-sided spans it passed: left only and right only take the balance's infinite branches, which the mutation does not touch; the check now also draws right at half and left at a quarter |
| M06 the frequency rows flipped | frequency |
| M07 the stills' level lines not over the street | level; both rebuild tests |
| M08 SPEC.lo -90 | both rebuild tests (colours are held there, by the SVG and PNG hashes) |
| M10 the pan meter upside down | pan; values |
| M12 the loudness at each window's end | loudness |
| M17 the level dots at levelT, 50 ms early | values |
| M18 each lane's first cue left out of its prediction | predicted |
| M19 the measured pan dots at the predicted balance | values |
| M20 the arrangement's level lines not over the street | level; both rebuild tests |
| M21 measureOf's guard always passing | measureOf |
| M22 a miss label naming the other person | people |
| no stacking (new) | glyphs and leaders; check 11 (each still's height is not stills.json's) |
| no chips under the marker labels (new) | glyphs and leaders |
| no marks on clamped loudness (new) | loudness |
| a bed's white bar at its prediction (new) | values |

## Carried forward

| Item | Where |
|---|---|
| The tyres and the engine under their prediction as the car slows (the placeholders follow speed and rpm; the predictor does not) | Sound 2.10's panel, then Sound 3: a predictor that follows the same data, or placeholders that do not |
| The bridge's wind bed 1.05 dB under its prediction over its span | Sound 2.10's panel |
| The latches only below 250 Hz | Sound 4 (already carried from Sound 2.6) |
| The 12 sync misses | Sound 3 (already carried) |
| The contact sheet's PNG is 7.7 MB | if the gate package needs it smaller: a JPEG copy, or the stills at a lower scale |
