# Round 04: Sound 1, the sound storyboard

Sound effects only (the score is parked). Nothing is heard yet: this round plans every sound on paper, from the
picture's own data. Everything below is drawn from `src/audio/cues.js` (149 cues, 146 enabled, 38 new), which derives
every time and place from `src/world.js`, `src/set.js`, `src/shots.js`, the actors and the footprints, so the plan cannot
drift from the picture. The plan is `SOUND-PLAN.md`; the stages are the Sound stages in `ROADMAP.md`.

You asked for the plan and then a blockout, so this round runs on the plan's defaults and its one question travels with
Sound gate 2 (round 05).

## What to open

| File | What it is |
|---|---|
| `spotting-reel-phone.mp4` | **Watch this first.** The finished picture with a caption for every planned sound, no sound yet: A's sounds orange, B's blue, the night white, "new" sounds marked new, "offered" ones (in the list but off) marked offered, off-screen ones in italics, a tick per step under the captions. 480x270, made for a phone. The 31 to 37 s stretch is dense: pause there |
| `storyboard/sound/index.html` | The contact sheet: map, detail maps, timeline, 15 panels, the 15 checks. `storyboard-sheet.png` is the same page as one image |
| `timeline.png` | Every cue as a lane, like a DAW arrangement: level as the envelope's height, pan as the thin line, in-frame spans as bars under the lanes (outlined where something hides the source), the hush and the "held for music" windows hatched |
| `panels/shot-NN.png` | Per shot: the film's frame (lifted for viewing) with every sound's screen point, the stereo field over the shot's length, the listener from above, and the cue list with level, pan and where each sound is |
| `map.png`, `map-detail-*.png` | Where each sound is in the set, and each camera as a listener (wedge, left and right axis, level rings per distance law) |
| `captions/` | The review track (VTT, SRT, the burned ASS) and the SDH track for delivery (9 captions) |

The 1080p reel with soft subtitles is in `out/round-04-reel/` (44 MB, not committed; its video stream is the published
export's, copied).

## How it was built

The same workflows as the picture: Sound 0 by research, draft and critique (10 agents); `cues.js` by a builder and a
checker in a worktree; then four builders in parallel worktrees (the checks, the drawings, the blockout, the captions),
each followed by a checker that re-ran everything and tried to break it, and a fix pass. Two usage limits stopped the
builders partway; their small gated commits kept the work, and each resumed from its own worktree.

## What I checked, and how (`storyboard/sound/report.json`, tables in the sheet)

| # | Check | Result |
|---|---|---|
| 1 | trace: every cue moves with the picture data it names, and only that (17 perturbations, each in a child process with a patched module) | pass: 251 cue moves, 0 problems |
| 2 | onScreen: each cue's point through its shot's camera at its first frame | 91 on, 21 hidden (building SE hides the car's arrival; the car body hides the belts, the handbrake, getting out, B's first walk), 25 off, 2 behind |
| 3 | storyOrder: light before the car; feet before the people; nothing starts while the moon rises | pass (see ruling 1) |
| 4 | sync: each cue's onset 0 to 45 ms ahead of the first frame that shows its event | **12 off**: 6 scuffs (from 110 ms late to 43 ms early) and 6 cloth moves timed from a key while the picture first draws the motion 5 to 88 ms later. Sound 3 |
| 5 | stereoOrder: on the bridge A pans left of B | pass, margins 0.041 to 0.267 |
| 6 | cutPerspective: level and pan of every source across every cut | pass; the steps jump at the walk onto the bridge (-7.3 and -8.5 dB) and back (+7.2 and +10.0 dB) with the picture's change of size; the hum's small changes are held by the rule, which the renderer does not apply yet |
| 7 | approachRises: a source coming at the camera never gets quieter | pass; the first pass's engine fails it (the inverted arrival), as its control |
| 8, 9 | masking: pairs, and under everything sounding | reported: 95 pairs; 80 of 93 one-shots under 3 dB broadband margin (the idle beside shot 5's camera, the other walker's cloth, the bridge wind). Placeholders cannot judge this; measured per band at Sound 2, gated at Sound 4 |
| 10 | flams: one person's two cues within 30 ms | pass |
| 11 | density | pass (see ruling 2): at most 3 bodies; streams peak at 6 |
| 12 | voices: the PS1's 24 | pass, peak 12, nothing stolen or dropped |
| 13 | silence: the hush, moonrise, B's look, the last wide | pass, 0 onsets inside |
| 14, 15 | safe band, straddles | reported (bands measured at Sound 2); one step across 40 s |

Every check ships with a planted fault that is shown to fail (`tests/sound-checks.test.mjs`, 17 tests).

## Self-review: what I found and changed

1. **The two branches met at one test.** The blockout replaced `index.js`'s `LAYERS` with stages; the checks' spatial
   test still rendered through `LAYERS`. Ported to the stage API; 5 of 5 pass.
2. **The run-down was planned 2 dB over the idle it continues** (`LEVELS.rundown` 10 against `intakeIdle` 8), so the
   engine rose as the hush should return. Now 8: the idle's own voice falling to nothing.
3. **Shot 5's panel showed a black frame** (the shot averages under 2 of 255), so its 59 marks floated over nothing.
   The panels now show their frames lifted, as every review of this film does, and the caption says so.

## Rulings I made (the lead's calls; say if you disagree)

1. **Feet before the people allows feet out of frame.** The plan's rule ("through shot 5 the boots are heard on feet in
   frame") contradicted its own 3.7, which keeps B's four steps round the car off screen right. Off-screen steps show no
   body before shot 6's reveal, so they now pass; hidden or behind the camera still fails (planted control).
2. **Density counts bodies, not voice groups.** A car's intake, exhaust and tyres fuse into one thing the ear follows, as
   one person's steps and cloth do; Murch's two and a half is about streams a listener can follow. Counted by voice
   groups the car alone is four at its first light. The stream counts stay in the report beside the bodies.

## Carried forward

| Item | Where |
|---|---|
| The 12 sync misses (scuffs on the speed threshold, cloth from keys) | Sound 3: derive them from the first drawn motion |
| The hold rule for the hum and the idle (they step 1 to 3 dB at most cuts) | Sound 3: in the renderer |
| Sound 1.3's level margins (shot 8's far steps, shot 13's drag and exhale, some midground cloth) | Sound 2 measures; Sound 5 by ear |
| Per-band masking and the safe bands | Sound 2 measures; Sound 4 gates |
| `cues.js` still imports `surfaceOf` from the parked first-pass foley layer | before Sound 4 |
| The Excalidraw round trip is a scratch harness (1491 elements in and out), not a committed test | Sound 3 |

## Sound gate 1, carried to Sound gate 2

| # | Question | Default |
|---|---|---|
| 1 | From the spotting reel: any sound to add, drop or move. New ones are marked "new", offered ones "offered"; the silent-by-choice list is in `SOUND-PLAN.md` 3.8 | New ones in, offered ones out, nothing else changed |

Plus any markup on the map, the timeline or the panels.
