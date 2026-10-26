# Round 05: Sound 2, the blockout (Sound gate 2)

Every planned sound effect is now heard as a deliberately crude placeholder (a beep, click or hiss) at its exact time,
place and planned level, from each shot's camera, over the finished picture. The score is parked. This round is the
first stop since the plan: the Sound gate 0 and 1 questions travel with it.

**What you do:** watch `preview.mp4` once on headphones and once on the phone speaker. Judge only three things: does
each sound land on its action, does it come from the right side, is any moment crowded. Left and right need
headphones. Then answer the questions at the end (or on the gate page). Everything else here is my evidence.

## What to open

| File | What it is |
|---|---|
| `preview.mp4` | **Start here.** 112 s, 480x270, the shot label at the top, the review captions burned in their band (A orange, B blue, the night white, "new" and "offered" marked, a tick per step), the blockout sound at -23 LUFS. The captions are also a soft track, off by default |
| `decisions/` | The A/B clips for questions O1 to O3, 7 s each, and `decisions.json` (every number behind them) |
| `stills/shot-NN.png` | One "audio still" per shot: loudness, every cue at its measured onset, the spectrogram, measured against predicted level, the pan meter, what missed its bar |
| `arrangement.png` | The whole film as lanes, measured over predicted |
| `contact-sheet.html` | The arrangement, the 15 stills and the 15 measures in one page |
| `stems/` | Four listening stems by body (the night, the car, A, B), AAC |
| `measure.json`, `preview-check.json`, `findings.json` | The measurements, the preview's checks, the panel's 42 findings with verdicts and dispositions |

`notes-measure.md`, `notes-options.md` and `notes-stills.md` are the three builders' own notes. The first two were
written before the engine fix below and are marked so: the JSON files and this page hold the current numbers.

## How it was built

The same workflows as the picture. Two builders in parallel worktrees (the measurements; the options), each followed by
an independent checker that re-ran everything and tried to break it, and a fix pass; then a third builder for the stills
and the arrangement, checked and fixed the same way; the preview and its checks by me; my own review written down before
the panel (below); an independent panel by shot group with a skeptic per reviewer and a completeness critic; one fix
round. Two usage limits stopped agents partway; their small gated commits kept the work.

The checkers mattered. The measurement checker found the renderer measure could not see a misplaced cue (it now reads
each cue rendered alone: 372 of 377 planted misplacements caught, the 5 misses the 3 cues that start at 0 s) and a
control that could not fail. The options checker found the listener clips pumping with the limiter (now one still gain).
The stills checker found a rebuild check that compared only image sizes (now content hashes).

## What I changed as the lead

1. **The engine's two placeholders were in phase.** The intake's and the exhaust's buzzes are one saw from one rpm
   track, so they added coherently: 1.86 times their summed powers over the drive, 1.54 over the idle. The engine was
   louder in the mix than its two planned levels. Each now starts its own share of a firing period in (the exhaust half a
   period): 1.002 and 1.001, with an in-phase control in `tests/sound-blockout.test.mjs`. Found by the options builder.
2. **The merged target.** The options code read the loudness target as one number; the measurement branch made it one per
   stage. Fixed where the merged gate caught it.
3. **The preview's soft captions.** The mp4 muxer marks the first text track enabled, so a player could draw the soft
   track over the burned band. `capture.js` now clears that bit when the captions are burned (checked both ways in
   `tests/capture.test.mjs`); the preview was captured again. Found by the panel's completeness critic.
4. **README** now says not to re-export during the blockout: `npm run export` would overwrite the S8.3 listening copy
   (`out/sound.wav`, `out/snowy-bridge.mp4`) with the placeholders. That copy is unchanged.

## The measurements (`measure.json`)

| # | Measure | Bar and source | Result |
|---|---|---|---|
| 1 | Renderer | every voiced cue within 5 ms of its start (ROADMAP 2.6) | pass: 142 of 142, worst 0.031 ms; each voice group's stem the sum of its cues alone |
| 2 | Sync | onset 0 to 45 ms ahead of the first frame that shows its event (BT.1359, SOUND-PLAN 3.3) | fail: 12 of 119 off, Sound 1's 12 (K1); 8 on-frame instants pass by ruling R4 |
| 3 | Cue ends | reported | median 4.4 ms before t1 |
| 4 | Pan | within 0.5 dB of the camera's prediction | pass: 142 cues, worst 0.101 dB |
| 5 | Level | reported | measured minus predicted -3.34 to +0.26 dB, median 0 |
| 6 | Loudness | reported | loudest momentary -15.29 LUFS (shot 5) |
| 7 | Silence | no onset in the four bed-only windows | pass |
| 8 | Voices | the PS1's 24 | pass: peak 12 |
| 9 | Density | at most 3 bodies (starting value) | pass: peak 3 |
| 10 | Masking per band | reported | 25 of 136 cues with no third octave 3 dB clear (K5) |
| 11 | Phone and mono | check 14 | fail: the two latches live under 250 Hz (K6) |
| 12 | Determinism | two renders, same bytes | pass |
| 13 | Stems | the stems sum to the mix | pass: worst 1.13e-7 of the peak |
| 14 | Drift of the parked first-pass layers | reported | 72 of 93 matched, median 8.7 ms; drift is expected until Sound 4 |
| 15 | Loudness target | no 400 ms window loses over 1 dB to the limiter | pass: -23 LUFS (R5) |

**The preview** (`preview-check.json`): one video, one audio and one subtitle stream, each 112 s; the audio 0 samples
from its WAV in three windows; the burn draws nothing in the bottom 30 px (exact, before the encode, with a control); per
shot from -30.8 LUFS (shot 2) to -19.1 (shot 5).

## My self-review, written before the panel

| # | What I saw | Evidence | Call, after the panel |
|---|---|---|---|
| S1 | The walk in shot 7 nearly as loud as the car | per shot, shot 7 -20.8 LUFS against shots 4 and 5 at -19.4 and -19.1 | **Corrected by the panel (DEC-04, G456-01):** shot 5's loudness is the people's, not the car's, and by body the people outdo the car through the film. Question L |
| S2 | The tyres' measured level falls far under the prediction as the car slows | shot 4, -10.6 dB median | The placeholder follows speed, as the plan asks; the storyboard's predictor does not. Sound 3 |
| S3 | The engine 1 to 3 dB under its prediction on the drive | stills 3 and 4 | Same cause; Sound 3 |
| S4 | 12 foley cues off their frame | measure 2 | K1, Sound 3 |
| S5 | The latches lose 15 to 16 dB on a phone | measure 11 | K6, Sound 4 |
| S6 | Shot 5 is the densest stretch | 55 onsets in 11 s, 12 voices, 3 bodies | Within the bars; your ear decides |
| S7 | The intake hidden by the building, at full level only for its last 1.4 s | `decisions.json` | Question O1 |
| S8 | ~~The bridge wind 1.05 dB under its prediction~~ | | **Withdrawn (G10-3):** the bed's prediction reads its modifiers at the span's start, before the wind eases; not a level gap |
| S9 | Every planned silence holds | measure 7 | Pass |

## The panel (`findings.json`)

Four reviewers by shot group (1 to 3, 4 to 6, 7 to 9, 10 to 15), each with every lens (timing, placement, perspective,
masking and density, story beats, phone and mono), and one on the decisions; a skeptic per reviewer; then a
completeness critic. 42 findings: 29 confirmed, 8 refuted, 5 from the critic (checked by me). No blocker survived. Shots
2, 4, 7, 10, 11, 12 and 14 were found clean by their reviewers.

Every finding has a disposition in `findings.json`. In short: 17 fixed now (the preview's captions, the README, these
notes and the questions), 9 became questions for you (some of them refuted as faults but still yours to decide), 8 are
carried to Sound 3 or 4 (the known items below), 7 were refuted and change nothing, and one is a ruling (DEC-06, R5).

## My rulings (say if you disagree; question R)

- **R1. Feet before the people allows feet out of frame** (round 04). The plan's 3.7 keeps B's four steps round the car
  off screen right; they show no body. Hidden or behind the camera still fails.
- **R2. Density counts bodies, not voice groups** (round 04): a car's intake, exhaust and tyres fuse into one thing the
  ear follows.
- **R3. The two backgrounds of one family crossfading at the place change (0:54) are intended**, not a cut voice.
- **R4. An onset on its frame's own time, read within 1.5 samples after it, is on its frame.** The measure cannot tell
  them apart. This is the one bar this round moved.
- **R5. The blockout plays at -23 LUFS**, the loudest target at which no 400 ms window loses more than 1 dB to the
  limiter. One placeholder click (the driver's unlatch, 0:30.44) is what binds it; without it the rule would allow -21
  (DEC-06). It is re-chosen when the placeholders change at Sound 3; from Sound 5 the mix is anchored on the hush
  (SOUND-PLAN 3.18), and integrated loudness stays at or under -16.

## Known, so do not judge these as faults (K1 to K7)

- **K1.** 12 foley sounds land 5 to 125 ms off their frame: 6 scuffs and 6 cloth moves timed from animation keys (shots
  5, 6, 9, 11, 13). Sound 3 derives them from the first drawn motion.
- **K2.** The hum and the idle step 1 to 3 dB at some cuts: the "hold steady sounds" rule (SOUND-PLAN 3.6) is not in the
  renderer yet. Sound 3.
- **K3.** In shot 5 the door swings and getting out are buried in the idle: their placeholders sit in the engine's band
  (the panel counts seven cues). Sound 3 moves the placeholders apart.
- **K4.** On the bridge the tick at 1:06 is under the water's hiss: both placeholders sit near 7 to 10 kHz. Sound 3.
- **K5.** Of the 25 masking flags, most are another voice of the same moment (one walker's cloth under the other's
  steps, the two halves of the engine, A's and B's shifts); the rest are K3 and K4.
- **K6.** On a phone the lamp's hum and the city's rumble vanish (their placeholders live under 300 Hz) and the latches
  lose 15 to 16 dB. The designed sounds at Sound 4 need energy above 500 Hz.
- **K7.** Balance between families is not judged until Sound 5: placeholders have no real spectrum. One rule already
  breaks in the blockout: the idle is only 1.4 to 3.7 LU under the drive, where the plan wants 6. Sound 3 sets the idle's
  levels and adds that comparison to `measure.json`.

## Tests changed this round (ROADMAP 2.2)

| Test | Change | Reason | Bar moved |
|---|---|---|---|
| `tests/sound-measure.test.mjs` (sync) | an on-frame instant read within 1.5 samples now passes | ruling R4 | **yes, the one** |
| `tests/audio.test.mjs` (the finished soundtrack) | reads the stage's target (`targetOf`) instead of -16 | the target is per stage | no: the 0.2 LU and -1.5 dBTP bars stand |
| (none: `masterOf` in `scripts/lib/sound-options-lib.js`) | the options' master reads the stage's target | the merge; its test passed unchanged once fixed | no |
| `tests/capture.test.mjs` (burn) | also asserts the soft track is default alone and not when burned | CC-01 | no: a new assertion |
| `tests/sound-blockout.test.mjs` | new: the engine's parts add as their powers, with an in-phase control | the engine fix | new |
| `tests/sound-measure.test.mjs`, `sound-options.test.mjs`, `sound-stills.test.mjs`, `sound-preview.test.mjs` | new: 26, 15, 11 and 3 tests, each with a planted fault | Sound 2.5 to 2.12 | new |
| `tests/sound-layers.test.mjs` | runs at the parked design stage; its balance asserts (the car over the bed, the idle 6 dB under the drive) guard only the first-pass layers | Sound 2.1 (round 04) | no |

Gate for the round's last commit: 274 tests, 271 pass, 0 fail, 3 skipped (the parked score); `npm run check` passes; the design stage still renders the S8.3 bytes (sha256 f80b1542).

## Carried forward

| Item | Where |
|---|---|
| K1 to K4, K7; S2 and S3 (the storyboard's predictor reads each voice's own envelope) | Sound 3 |
| K6; the swap muffle judged on the designed engine, if O1 is taken | Sound 4 |
| A guard so an export cannot overwrite the listening copy at the blockout stage (CC-02 option) | Sound 3 |
| SOUND-PLAN 1.3 rewritten to your answers to A, E, H and L | Sound 3 |

## The questions

Also on the gate page, with the preview and the clips, where your answers are saved: https://claude.ai/artifact/EgKbB8AMm1y2iJaEnT8rVP (private to you).

Each has my default; "go" means every default. The letters match `findings.json`'s dispositions.

**From Sound gate 0 (the plan)**

| # | Question | Default |
|---|---|---|
| A | **The feel without the score.** A cold, quiet night; the car the only loud thing, heard with its first light; small, close sounds after it; moonrise and the last wide held for the score. Is that the film you want to hear? Read it with E and L, which say where the blockout differs | Yes |
| E | **The engine stop and the hush.** The engine's idle shake shows in the picture (measured at Sound 1), so the engine cannot stop before the doors open: it idles under both doors and both people getting out, and runs down at 0:36 as the lights go out. The hush starts at 0:36.6, after both doors shut, not "as the doors open" as the plan first said. (a) Keep this. (b) Also play the idle louder and brighter while a door is open (the "offered" caption at 0:30.5 to 0:35.6). (c) Change the picture so the shake stops sooner and the engine can stop at 0:30, before the first door (a change to the finished film: only on your word) | (a) |
| B | **Anything before the car?** Shots 1 and 2 (0:00 to 0:14) are the empty street | Nothing: the car is first heard with its light at 0:14 |
| C | **What gets published.** | One soundtrack, effects and score, after Sound 6, only on your word; the silent upload stays |

**From Sound gate 1 (the storyboard)**

| # | Question | Default |
|---|---|---|
| G | **From the captions: any sound to add, drop or move.** "New" ones are sounds for actions the first mix did not hear; "offered" ones are listed but silent. If you take the offered third exhale, it would run 0.6 s into the final wide's held silence, so Sound 3 would end it at the cut | New ones in, offered ones out |

**From Sound gate 2 (this blockout)**

| # | Question | Default |
|---|---|---|
| L | **Should the car stay the loudest thing?** In the blockout the boots and coats are as loud as the car: their loudest moment, B's two boots landing at 0:33, is 1 LU louder than the car's arrival at 0:28.6, and the walk at 0:46 to 0:54 (people -21.9 LUFS) is louder than the drive at 0:14 to 0:22 (-23.8). Each sound was set only against the night, never against the car. If yes, Sound 3 adds one rule: nothing after the car is louder than its arrival, by a margin set by measurement and heard at Sound 5 | Yes |
| P | **Shot 8's steps (0:54 to 1:00).** The camera is 15 m away on a long lens, so the steps drop to the level of the bridge's wind (0 to 2 dB over it), and on a phone four of them fall under it. (a) Keep the camera's distance. (b) Lift them 4 to 6 dB as a written cheat, so they stay over the wind. (c) Hear the levels from the characters (O3) | (b) |
| H | **The lamp's hum follows the camera.** It is a low tone in front whenever the camera stands near the lamp (shots 1, 4, 6, 7); at 1:00, when the lamp goes off screen beside the camera, it gets 10.6 dB louder in the right ear only for 8 s, then drops 12 dB on the moonrise cut. (a) As now. (b) Keep it under the night outside shot 1, as the plan's level table says | (b) |
| F | **The ending.** The sound fades over the last 1.5 s while the picture holds the lit wide to its last frame. (a) Keep the fade until the score's ending is planned (Sound 5). (b) Cut the sound with the picture (a few ms of ramp). (c) Fade the picture too (a change to the finished film) | (a) |
| N | **Timing, placement or crowding notes from the preview.** Skip K1 to K7 above | None |
| S | **The scene to design first (Sound 4)**, finished and heard before the rest. I now recommend shots 3 to 6 (0:14 to 0:46, 32 s): the car's first light, the hidden engine, the arrival, the doors, the people, the hush. The plan's first pick, shots 4 to 6 (0:22 to 0:46), starts with the car already loud. Shots 5 to 8 would add the bridge | Shots 3 to 6 |
| O1 | **Muffle sounds the picture hides?** (Clips `muffle-engine-a` and `-b-volume`, 0:14 to 0:21: the engine behind the building.) (a) None. (b) Drop by 6 dB the sounds the set hides: the engine and tyres behind the building, 0:14 to about 0:18.6. (c) Also the sounds inside or behind the car in shot 5 (the handbrake, the belts, getting out, B's first walk). In the engine clip (b) takes 3.9 dB off the 1.4 s the engine is hidden at full level, 0.9 dB over the 7 s | (a) |
| O2 | **A narrower pan for steps and hand contacts?** (Clips `sync-pan-a` and `-b`, 0:32.8 to 0:39.8, B walking round the car, off screen right.) B is a test at half width, so "yes" means "narrower", the width set at Sound 4. 28 of 74 cues move by 0.1 or more, most of all B's off-screen steps | No, the camera's pan |
| O3 | **Who hears the levels: the camera, or the characters?** (Clips `listener-a` and `-b`, 0:52.8 to 0:59.8, the walk onto the bridge; both clips play 3.15 dB under the preview; judge the boots' size at the cut onto the bridge, 1.2 s in, not the overall level.) From the characters, 98 cues get louder by 1 dB or more, shot 8's far steps by 10 to 11 dB, and in shot 13 the drag and the exhale by about 6.5 dB, which the plan's foreground rule wants there; the cuts' changes of size would no longer be heard | The camera |
| R | **My rulings R1 to R5** | As written |
