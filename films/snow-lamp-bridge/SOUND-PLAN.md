# Snow, Lamp, Bridge: Sound Plan (Sound 0)

**Status:** Sound 0 done. You asked for the plan and then a blockout, so Sound 1 (storyboard) and Sound 2 (blockout)
follow on the defaults below; every question here comes back to you at Sound gate 2, before anything is designed.
**Scope:** sound effects only: backgrounds, ambiences, hard effects and foley. The score is parked (1.5).
**Home:** `films/snow-lamp-bridge/`, branch `claude/snow-lamp-bridge-sound`. The tree was clean at `0b82298` (the S8.3
work committed) before this plan was written.
**Names:** the sound stages are Sound 0 to Sound 6, their steps "Sound 1.4", their gates "Sound gate 1", so they never
collide with the picture's Stage 1 and Gate 1, or with BUILD_LOG's S1.x, S2.x and S8.x headings.

Everything marked *measured* came from read-only probes that import the film's own modules. The probes live in the
session scratchpad, not in the repo. I changed nothing in the repo to write this plan.

---

## Your decisions (one minute)

Four questions. Each has my default, and the storyboard and blockout are built on the defaults; answer any of them at
Sound gate 2 and the cue list changes before any sound is designed. The numbers behind each are in section 6.

| # | Question | Default |
|---|---|---|
| 1 | **The feel without the score** (1.3). A cold, quiet night. The car is the only loud thing, heard with its first light. The hush comes back as the doors open. Moonrise (1:08) and the last wide (1:40) add no new sound, only a small change in the night, and both are held for the score. Is that the film you want to hear? | Yes, as written in 1.3 |
| 2 | **The engine stops at 0:36, after both of them are out and both doors are shut.** Sound cannot fix that; it can only hide it or move it. Stop the engine while the driver is still seated, just before the first door opens (0:30), and let the lights go out later in silence? | Yes, if Sound 1 shows the idle shake cannot be seen on screen. If it can, the engine runs down at 0:36 with no key click |
| 3 | **Anything before the car?** Shots 1 and 2 (0:00 to 0:14) are the empty street. | Nothing. The car is first heard at the cut to shot 3 (0:14), rising out of the quiet with its light, as your "light before the car" asks |
| 4 | **What gets published.** | One soundtrack, effects and score together, after Sound 6, and only on your word. No effects-only upload; the silent upload stays up |

I will also do these unless you object, one line each:
- The camera is the ear for every sound. The car and the small sounds keep their gentler distance laws, written down as choices (3.4).
- Each of the two places (the street, the bridge) has one steady background, which changes once, at the cut onto the bridge (0:54). The lamp's hum sits at the lamp; the water is part of the bridge's background; snow has no sound of its own (3.5).
- At a cut, single sounds (a step, a door) follow the new camera. Steady sounds keep their level and side unless the change is large (3.6).
- The car swells as it comes in and reads clearly over the quiet whenever it moves on screen (3.10).
- Each sound gets its own voice, the way a PS1 game plays effects. Voices are counted against the console's 24, and the PS1 liberties we take are written down (3.13).
- No delay for distance, no Doppler (3.15).
- Captions sit in the top band, never in the bottom 120 px (3.16).
- New sounds for actions we see but do not hear (the door swings and stops, getting out, the turns, the shoulders, cloth on the walk, sounds inside the car) appear in the Sound 1 spotting reel, marked "new", for you to keep or drop there (3.8).

---

## 1. How I understand the sound brief now

### 1.1 What you asked, and the honest answer

Your words: "Sound effects first. Focus only on sound effects. Use the same workflows to plan the sounds then do a
blockout. I’m sure you can see the preferred workflow evolving and emerging here…no? Did you storyboard the sounds like
you did the other stuff?"

**No, I did not.** The picture went through plan, storyboard, blockout, revisions, look, animation, polish and final,
each with measured checks and a gate. The sound skipped all of that. It went from a hand-written cue table in `SOUND.md`
straight to four finished layers (BUILD_LOG S8.0 to S8.3): no sound map, no stereo panel per shot, no report, no
placeholder stage, no review round. In picture terms, that is going from `PLAN.md` straight to Stage 7.

**Yes, I see the workflow, and this plan follows it.** Table 1.2 is the direct answer: every picture stage and artifact,
with its sound counterpart.

### 1.2 The same workflow, artifact for artifact

| Picture stage and artifact | Sound stage and artifact | Same or different, and why |
|---|---|---|
| Stage 0: `PLAN.md` | Sound 0: `SOUND-PLAN.md` | Same |
| PLAN 1: the Arc table; "the three orders in the brief are rules" | 1.3: the sound arc, the level plan, the three orders in sound | Same. The orders become a check in the Sound 1 report (storyOrder) |
| `set.js`, `world.js`, `shots.js`: the source of truth | `src/audio/cues.js` | Different on purpose: a catalogue derived from the picture's data, never a fourth source of truth |
| Stage 1 map: every camera with its wedge | Sound map: every source placed; every camera as a listener (wedge, left and right axis, level rings) | Same drawing, plus what a listener needs |
| Three detail maps | Four detail maps | Same |
| 15 true-perspective panels | 15 panels: the shot's frame beside its stereo field | Same, but drawn over the whole shot: one instant cannot show a sound |
| `report.json`: measured checks | `report.json`: 15 sound checks (4.3) | Same, but each check has a planted-fault control; the picture's had none |
| `storyboard/index.html` | `storyboard/sound/index.html` | Same |
| Excalidraw round trip | The same, for the sound map | Same |
| (none) | The spotting reel: the silent picture with a caption for every planned sound | New. You see where every sound will be before any sound exists |
| Stage 2: grey boxes, real clock, `preview.mp4` | Sound 2: placeholder sounds at the real cue times, `preview.mp4` with captions | Same |
| 45 stills and a contact sheet | Audio stills per shot (spectrogram, level, pan) and an arrangement sheet | Same idea: pictures of sound |
| `findings.json`, an independent panel, skeptics | The same | Same |
| `decisions/` frames | `decisions/` clips | Same, as clips: a sound decision has to be heard |
| Stage 3: revisions | Sound 3: revisions | Same |
| Stage 4: look | Sound 4: design, one style-frame scene first | Same role: the first stage where things are made to be final |
| Stage 5: animation and render test | Folded into Sound 4 (how a sound moves is its design) and Sound 5 (the listening copy is the render test) | Different: a sound has no look apart from how it moves |
| Stage 6: polish rounds, repeated | Sound 5: mix rounds, repeated as needed | Same |
| Stage 7: final | Sound 6: final, with the score in | Same |
| Gate package: round folder, Artifact page, commit, draft PR | The same | Same |

### 1.3 The feel, the sound arc and the level plan (effects only)

**The feel.** A cold, quiet night that the snow makes quieter still. The car is the only loud thing: it is heard with
its first light, swells as it comes round the corner and in, and when its engine stops the hush comes back as the doors
open. After that every sound is small and close: boots in snow, a door, cloth, a lighter, a breath. Two places, each with
its own air: the street, a canyon between facades 12.4 m apart (`set.js`), where the lamp hums; and the bridge, open,
with wider wind and the water below. The film's two releases, the moonrise and the last wide, add no new sound: the
night itself changes a little, and both are held for the score, which fills them later. PS1 flavour: simple, slightly
stylized sounds, one short reverb used sparingly, dry steps in the snow. Nothing harsh, nothing clipped, no click at a
cut.

This replaces the S8.0 feel in `SOUND.md`, which was never gated and leaned on the score for the moonrise and the end.

**The sound arc.**

| Beat | Shots, time | What you hear | Foreground | Deliberately absent | What changes, and from which data |
|---|---|---|---|---|---|
| Alone | 1 to 2, 0:00 to 0:14 | Wind, the city far off, the lamp's hum: close in shot 1, far in shot 2 | The hum, in shot 1 only | Every onset; the water; the car (question 3) | Nothing. The hum follows the camera: 5.6 m away in shot 1, 66 m in shot 2 |
| Intrusion | 3 to 5, 0:14 to 0:30 | The car with its first light: rising out of the quiet, swelling round the corner and in; the brake; the stop and the settle; a short idle | The car | Small sounds | The car rises as it approaches (the arrival rule, 3.10); the tyres follow speed and steering (`carAt`, `steerDeg`). By default the engine stops before 0:30.5 (question 2) |
| People | 5 to 6, 0:30 to 0:46 | The hush as the doors open: unlatch, swing, stop; getting out; boots in snow; cloth; the turns in place; both doors shut; hot metal ticking | Doors and boots, close | The engine (question 2); any music | The ticks start after the engine stops (a rule). The lights go out at 0:36 in silence |
| Threshold | 7 to 9, 0:46 to 1:08 | Two sets of boots in step and their coats. At 0:54 the place changes: wider wind, the water below. The lean on the parapet: cloth and forearms | The steps (two walkers, both in sync) | | The background changes once, at 0:54 (the place boundary, from `SHOTS`). The last new sounds before the moon: the lean (1:02 to 1:03.5) and a tick at 1:06 |
| Release | 10, 1:08 to 1:16 | The night only. Nothing starts; the wind eases a little as the moonlight comes up. Held for music | None | Every onset | The wind ambience eases with `moonlight(t)`, 68 to 76 |
| Closeness | 11 to 14, 1:16 to 1:40 | Small and close: A's coat as A turns into the lee, the lighter, three drags, the exhale; B's look in silence (shot 12); both coats as the shoulders close in | The lighter and the breath, 2 to 7 m away | | Nothing in the night changes. Shot 12 (1:24 to 1:29) has no onset |
| Pull back | 15, 1:40 to 1:52 | The whole night at once: wind, the far city, the hum, the water. Nothing starts. Held for music | None | Every onset | The ambience opens a little with the pull back (shot 15's camera, `cameraAt`), then the 1.5 s fade |

**The three orders in sound.** The picture's three rules hold in sound too, and the Sound 1 report checks each one
(storyOrder, 4.3):
1. **Light before the car.** No car sound before the first frame that shows its light (question 3).
2. **Feet before the people.** Through shot 5 the boots are heard on feet in frame; the bodies are first seen in shot 6.
3. **Anticipation before the moon.** The night settles first: the last new sound is the tick at 1:06, and from 1:08
   (`moonlight(t)` above 0) nothing starts.

**The level plan.** Sound 1 sets every starting level from these rules, not from the parked S8 layers; today's S8
balance is shown beside them as a comparison column only. All values are starting values, measured at Sound 1 and heard
at Sound 2.

| Layer | Starting rule | Today, for comparison (S8.3) |
|---|---|---|
| Street background (wind, city) | The reference: 0 dB | |
| Bridge background (wind, city, water) | One designed step over the street, at 0:54 (starting value +2.5 dB, today's wind step at that cut) | The wind changes at 10 of the 14 cuts (A.1) |
| The car while it moves on screen | At least 6 LU over the street background, short-term; never quieter as it comes closer | +8.3 dB in shot 3, +1.9 dB in shot 4 by RMS (A.4) |
| The idle | At least 6 LU under the drive | Today's test measures shot 3 only |
| Foreground foley (steps, doors, lighter, drags, breath) | Peaks at least 6 dB over the background in a 100 ms window, and still over it through the phone simulation | 5 to 15 dB under the bed by RMS in shots 6 to 9 (A.4) |
| Midground (cloth, scuffs, ticks, sounds inside the car) | 0 to 6 dB over the background | |
| The lamp's hum | The distance law from the lamp; foreground in shot 1 only | -11.4 dB in shot 1, -33.0 dB in shot 2 |

### 1.4 What "sound effects" means here

| Kind | What it is | In this film |
|---|---|---|
| Backgrounds | Steady beds that build a place, with nothing in them seen on screen | Wind, the city far off, the water (on the bridge) |
| Ambiences | Steady sounds allowed to change for the story, each change a cue derived from a data event | The wind easing at moonrise; the night opening on the last wide |
| Sync ambience | A steady sound whose source is seen | The lamp's hum (seen in shot 1) |
| Hard effects | Sync sounds tied to an action we see, or hidden on purpose | The car: engine, tyres, brake, settle, doors, the engine stopping, hot-metal ticks; sounds inside the car |
| Foley | Feet, moves (cloth) and specifics (props) | 63 steps, scuffs, cloth on the walk and at the turns, the lean and the shoulders, the lighter, three drags, the exhale |

### 1.5 Why the score is parked, and how it comes back

You said effects only. The score is also the one layer with no derived timing: its 12 chord times and 14 bell times are
typed literals (8 of the chord times equal shot starts without reading `SHOTS`; 4 fall inside shots). A plan whose rule
is "derive, never copy" has no place for it until it has a plan of its own.

It stays in the code (`src/audio/layers/score.js`), out of the mix. **Effects run Sound 0 to Sound 3. The score's own
plan starts after Sound gate 3 and runs beside effects Sound 4. Sound 5 mixes both, and Sound 6 ships one soundtrack with
both** (question 4). The score's cue times will read `SHOTS` and the picture's data instead of literals, and it shares
the 24 voices with the effects.

### 1.6 What cannot change

The picture is finished, published and locked. In picture Stage 1, a finding could move staging; in Sound 1 it cannot.
Anything that would need a picture change comes to you as a decision. Everything else is solved with level, timbre,
perspective or priority, never by moving a sound off its frame.

### 1.7 The skipped method also went into the template and the playbook

Commit `9941029` copied the S8 method into `playbook/process.md` ("Stage 5.5: Sound": a cue sheet, then layers, then
measurement, then a listen, with no storyboard and no blockout) and into `template/` (the engine, an example layer, and
a Sound line in `template/ROADMAP.md`). Any film started with `tools/new-film.mjs` before Sound 6 would repeat it. So at
Sound 0.6 I add a short note in both places: "superseded: sound now runs through gated stages; see
`films/snow-lamp-bridge/SOUND-PLAN.md`". The root `CLAUDE.md`'s Sound paragraph points to Stage 5.5, so it gets the same
one-line pointer, with your go. Sound 6.5 rewrites all three from what worked.

---

## 2. What I checked before planning (measured)

### 2.1 Probes and facts

| Check | Result |
|---|---|
| The listener | My listener matches `spatial.listenerAt(t)` (that is, `cameraAt(shotAt(t), t)`) exactly |
| The tick list | Private inside `layers/car.js`. I rebuilt it from the layer's seed, and it matches the onsets in the rendered car stem to within 0.03 ms |
| Render time | The full 112 s soundtrack renders in 11.86 s in Node |
| Player parity | Chromium equals Node on all but 161 of 10.75 M samples; those 161 differ by one float32 step |
| Meter | Ours agrees with ffmpeg's ebur128 to within 0.2 LU |
| Today's master | -26.829 LUFS before normalization; +10.889 dB of gain; +1.66 dB peak before the limiter; 93,040 limited samples; 2 passes; -16.003 LUFS and a -2 dB peak after |
| True-peak bars | Three in use: -2.0 dBFS (the limiter, on our 4x estimate), -1.5 dBTP (the test, ffmpeg on the WAV), -1.0 dBTP (verify, ffmpeg on the AAC) |
| Onset detector | Leads the attack by under 1 ms. Triggers at least 80 ms apart. Matches each expected time to the nearest onset, so two cues can claim the same one |
| Spatializer | Pan is `x / hypot(x, z)` in the camera's frame: the sine of the horizontal angle off the lens axis, with a sin/cos pan law. It ignores the screen position and the camera's roll (shot 5 rolls 3 degrees, 29 to 33.5 s); height enters only through the camera's pitch. Gains update every 256 samples (5.33 ms). No occlusion, no Doppler, no propagation delay |
| Step timing | `footprintList()` samples the rig every 1/48 s (`PRINT.dt`). Bisecting the rig's ankle height at 1/48000 s puts the boot's contact 0.2 to 20.3 ms before its print time (mean 8.8 ms) |
| Captions | This ffmpeg has the libass `subtitles` and `ass` filters, `drawtext`, and the `mov_text`, `srt` and `webvtt` encoders |
| Research | No web page could be opened here. The PS1 facts come from cloned primary sources (psx-spx, the Metal Gear Solid and Silent Hill decompilations, PsyDoom's libspu, DuckStation); the film-practice claims rest on search excerpts and secondary summaries. Appendix B tags each one |

**Stereo width of the frame.** A source at the frame edge pans by the lens alone:

| Lens | Shots | Pan at the frame edge |
|---|---|---|
| 85 mm | 10, 14 | 0.24 |
| 70 mm | 12 | 0.29 |
| 50 mm | 1, 8, 11 | 0.39 |
| 35 mm | 3, 5, 6, 7, 9, 13 | 0.52 |
| 24 mm | 2, 4, 15 | 0.66 |

### 2.2 The data in one place

- **Car.** Appears at 14.000 at (38.70, 17.50), doing 5.3 m/s. Brakes from 19.038 (5.3 to 3.4 m/s by 20.601), turns
  from 20.601 to 21.987 and stops at 29.000 at (2.20, 1.85). The body settles in one dip (`settlePitch`, `SETTLE.dur`
  0.7 s): deepest at 29.35, level again at 29.70. The idle shake (`idleLift`, three components of 1.6, 1.1 and 0.7 mm)
  and the lights both fade from 36.200 to 36.600. Today's engine run-down ends at 36.650 (a typed 0.45 s).
- **Car geometry.** `CAR` in `world.js` holds only length 4.7, width 1.8 and height 1.4. The parts live in the
  unexported `SHAPE` in `actors/car.js`: wheels at forward 1.45 and side 0.82; doors hinged at forward 0.95, latch edge
  at -0.15, side 0.92, opening to 70 degrees.
- **Doors.** Driver: opens 30.5 to 31.1, shuts 33.9 to 34.5. Passenger: opens 32.0 to 32.6, shuts 35.0 to 35.6.
- **Feet.** 64 prints (A 35, B 29) from 31.771 to 61.729 make 63 steps (16 road, 33 walk, 14 deck: `surfaceOf()`
  names them 'road', 'walk' and 'deck'). B's two boots land together at 33.313, the one heavy step; B's exit key in
  `world.js` says 33.2, and the rig's landing is where the print detector finds it.
- **Ticks.** 11, from 37.700 to 71.179.
- **Lighter and breath.** Lighter 78.6 to 80.1. Drags at 80.2, 89.2 and 97.0, each 0.8 s. One exhale, at 90.0 (after
  drag 2), lasting 2.8 s. Smoke wisps from 80.6.
- **Moon.** `moonAt(t)` elevation above 0 from 67.52. `moonlight(t)` is above 0 from 68.0, which `world.js` calls
  clearing the haze, and full by 76.
- **Constants.** The lamp head is at (4.60, 4.50, -4.50). The water is at y -6, between embankment walls at z -8 and
  -38 (`BRIDGE.z0`, `z1`); it is a flat, still plane with no piers. The wind comes from 70 degrees. The street's
  facades stand at x -6.2 and +6.2; west of the bridge head is an open plaza.

### 2.3 Shot by shot: what is seen, what is heard today, what is missing

dB figures are spatial gains under the law each sound uses today: car (3 m, rolloff 0.6), door (2 m, 0.8), foley
(2.5 m, 0.7), physical (1.5 m, 1).

| Shot | Seen | Heard today | On or off screen | Missing or wrong |
|---|---|---|---|---|
| 1 The lamp, 0 to 7, 50 mm, locked | The lamp and the snow | The bed only: hum at 5.6 m (-11.4 dB), river, wind, city | The hum is on screen. No water is in frame | 7 s with no onset, right for the hush. The river plays though no water can be seen |
| 2 The empty street, 7 to 14, 24 mm, push | The street, the corner, the lamp far off | The bed only; hum at 66.7 to 65.2 m (-33.0 dB) | The water is hidden by the bank | 7 s with no onset. The car does not exist on the clock before 14.000 |
| 3 Light before the car, 14 to 22, 35 mm, pan | Beams first; the nose clears the corner at 17.720, the whole car is in view at 18.600; it brakes at 19.038 and turns from 20.601 to 21.987 | Engine, exhaust and tyres from 14.000: 44.8 m at 14.0 (-14.1 dB car law, -29.5 physical) to 18.1 m at 21.0 (-9.4, -21.7), before the engine's load | The engine is heard 3.72 s before the nose shows, behind the south-east building | The brake has no sound of its own (tyres and rpm follow speed only), and nothing follows the steering through the turn. With the load schedule, the car is loudest at 19.0 (-10.4 dB, 21.9 m) |
| 4 The car arrives, 22 to 29, 24 mm, tilt | The car coming in, from 19.4 m to about 7 m | Engine, tyres, exhaust; the brake creak at 28.450 | The car is on screen throughout; the lamp is 4.7 m away, above the frame | The arrival is inverted: -23.5 dB at the cut (19.4 m), rising only to -18.4 dB at 28.0 (7.3 m), quieter than in shot 3 (3.10). Only 1.9 dB over the bed by RMS. The creak's 0.55 s lead is typed |
| 5 Feet in the snow, 29 to 40, 35 mm, truck | The stop, the doors, boots, people getting out, the doors shutting, the headlights fading from 36.200 to 36.600 | Settles at 29.000 and 29.380. Idle. Doors open at 30.500 and 32.000 and shut at 34.500 and 35.600. Steps from 31.771. The key at 36.200 and the run-down. Ticks at 37.700 and 39.557 | The car spans the stereo field (intake -0.58, exhaust +0.62). The driver door's unlatch is off frame, top left. B's steps from 36.229 to 37.667 are off screen right, at +0.80 to +0.68 | The swings to shut, both door stops, getting out and the turns in place are silent. The key clicks with nobody in the car. The densest moment of the film is here (A.2) |
| 6 The reveal, 40 to 46, 35 mm, locked | Both of them in the lamp light, and the parked car | Steps; ticks at 42.138 and 44.787, both on screen | All on screen | A's 110 degree turn at the lamp (40.600 to 41.600) is silent |
| 7 The walk, 46 to 54, 35 mm, truck | The walk toward the bridge | Steps for both, on screen. Ticks at 48.518 and 51.182, off screen right | The hum pans from -0.50 to +0.48 as they pass the lamp | Cloth on the walk is silent |
| 8 Onto the bridge, 54 to 60, 50 mm, locked | The pair 15 to 11 m away, the lamp and the car behind them | Steps at -11.4 to -9.3 dB. Deck steps from 55.875. Ticks on screen at 22.5 m (-23.5 dB) | The water is below the camera, hidden by the deck | The wind steps up 2.5 dB at this cut, because it reads the camera's z |
| 9 The railing, 60 to 68, 35 mm, arc | The lean onto the parapet, 62.000 to 63.500 | Five deck steps. Rustles at 62.750 and 62.800. Ticks behind the camera at 61.862 and 66.040 | The feet are below the frame while the bodies are on screen. The lamp is behind the camera, at pan +1.00 | The cloth times are typed. The hands ease onto the top with no single contact: within 2 cm of rest they land at 63.400 (A) and 63.396 (B), within 1 mm at 63.480 and 63.479; the typed cues are 63.47 and 63.50. Sound 1 fixes the definition (3.8) |
| 10 Moonrise, 68 to 76, 85 mm, locked | The moon clears the haze | One tick at 71.179: off screen, 22.85 m, -23.7 dB | The moon is on screen; it has no sound | With the score parked, nothing marks the release (1.3) |
| 11 The lighter, 76 to 84, 50 mm, locked | A turns into the lee, cups, lights, drags and turns back | Rustle at 77.600, lighter from 78.600 to 80.100, drag at 80.200, rustle at 82.300 | A is on screen at 3.3 m. B is on screen at the right edge, in the foreground (2.2 m, pan +0.32) | The rustles sit 0.1 s and 0.3 s into moves that start at 77.5 and 82.0; both offsets are typed. The visible flame (first frame 78.625) comes before today's ignition sound (78.67) |
| 12 B looks, 84 to 89, 70 mm, locked | B turns the head at 85.000 and back at 87.700 | Nothing | B is on screen at 3.9 m. A is on screen at the left edge, in the foreground (2.8 m, pan -0.23) | 5 s with no onset, right for the look |
| 13 Smoke and glance, 89 to 96, 35 mm, push | The drag, the exhale, A's glance, the shoulders closing in | Drag at 89.200; exhale at 90.000 for 2.8 s | Both on screen, 6.3 to 6.9 m away | The shoulders closing in (94.200 to 95.800), a story beat, are silent |
| 14 Ember and smoke, 96 to 100, 85 mm, locked | The ember insert, with A's head (2.76 m) and B's head (3.64 m) in frame | Drag at 97.000, the tip 2.81 m away | All on screen | No smoke is drawn after drag 3 |
| 15 Under the lamp, 100 to 112, 24 mm, pull | The whole night at once, the water in frame | The bed only | The hum pans from +0.45 to +0.29 | 12 s with no onset; with the score parked, nothing marks the end (1.3) |

### 2.4 Gaps between the picture and today's cues

**A. Visible actions with no sound.**
1. **Turns in place.** The rig slides the ankles without lifting them, so `footprintList()` places nothing:
   - A, 160 degrees, 33.200 to 33.800: the ankles slide 0.19 m, 0.96 to 1.21 m from the camera, on screen.
   - B, 175 degrees, 34.6 to 35.0, sliding 0.18 m; then another 50 degrees, 35.0 to 35.7, sliding 0.07 m.
   - A, 110 degrees at the lamp, 40.6 to 41.6, sliding 0.14 and 0.23 m.
   - The shoulders closing in, 94.2 to 95.8: both slide 0.20 m.
2. **Doors.** The swings to shut (33.900 driver, off screen; 35.000 passenger, on screen) are silent, though the opening
   swings have a hinge sound. Neither door's stop at full open sounds (31.100 off screen, 32.600 on screen).
3. **Getting out.** A slides out of the seat from 30.9 to 31.8 and rises from 31.8 to 32.4; B slides from 32.2 to 33.2
   and rises from 33.2 to 33.8. The seat, the cloth and the springs unloading are all implied.
4. **Cloth on the walk.** B's puffy nylon jacket and A's long coat (`PEOPLE`) move on every step from 31.8 to 62, but
   cloth sounds only at the lean and the two turns into and out of the lee.
5. **Cloth timed by typed numbers.** At the lean, the planned contacts trail the rig's by 70 and 104 ms on the 2 cm
   reading (but by -10 and +21 ms on the 1 mm reading); the planned 30 ms between A and B is not in the rig, which has
   them 1 to 4 ms apart. At the lighter, A's right hand peaks at 2.29 m/s at 77.892 and reaches the cup at 77.925; the
   rustle sits at 77.6.
6. **The car.** The brake from 19.038 has no sound of its own; the turn from 20.601 to 21.987 changes only the engine's
   load. Nothing reads `steerDeg`.
7. **Inside the car, off screen.** Before getting out (29.0 to 30.5, and 31.0 to 32.0): handbrake, gear lever, belt.
   Nothing is planned.
8. **Breath.** `EXHALE` has one entry (after drag 2). After drags 1 and 3 no smoke is drawn.
9. **Silent, probably by choice:** the head turns (85.0 and 87.7 B; 90.9 and 93.2 A), the lights, the smoke, the moon,
   the aircraft lights, the prints and tracks appearing, the snow. The rig never puts the lighter away.

**B. Planned sounds whose source is off screen or hidden.**
1. **Deliberate:** the engine behind the corner (14.000 to 17.720); the driver door's unlatch (30.500); B's steps off
   screen right while A crosses in frame; the deck steps in shot 9, with the feet below the frame.
2. **The key click at 36.200 with nobody in the car.** A has been outside since 31.8 and B since 33.2 (question 2).
3. **Ticks.** 7 of the 11 are off screen or behind the camera. The last (71.179, -23.7 dB) is probably inaudible.
4. **The river.** Today's point is 6 m north of the camera, clamped to z -12 to -34, so it moves at every cut. In shots
   1 to 7 it sits at z -12 (74 m north of the camera in shot 2) and plays at -16 to -34 dB where banks and buildings
   hide the water. On the deck (shots 8, 9, 11 to 14) it pans from +0.04 to -0.88 while the nearest water is straight
   below.
5. **Wind and city are not placed.** The data's wind direction is unused.

**C. Numbers in the layers not derived from the data.** About 20, listed in Appendix A.3 with what each copies.

### 2.5 The evidence in five lines (details in Appendix A)

1. **Cuts (A.1).** At the walk onto and along the bridge the steps change by -7 to -9 dB (7>8) and +7 to +10 dB (8>9),
   in step with the picture's own change of size. The hum jumps -21.5 and +18.3 dB. Smaller 1 to 3 dB wobbles on the
   hum and the river at most cuts.
2. **Near coincidences (A.2).** 15 cross-source pairs within 60 ms on today's times (16 on contact times). The A and B
   steps within 30 ms are 4 pairs either way, but which 4 changes.
3. **Copied numbers (A.3).** Every time and place in the car and foley layers that the picture already knows, typed
   again, and one drift that has already happened (the ticks).
4. **Balance (A.4).** The car is 8.3 dB over the bed in shot 3 but 1.9 dB in shot 4; foley sits 5 to 15 dB under the bed
   by RMS in shots 6 to 9.
5. **Voices (A.5).** Peaks of 8 to 12 depending on the definition; the densest second holds 6 one-shot onsets, from
   36.188.

---

## 3. Changes I would make, and why

### 3.1 Park the score (certain)

`config.audio.parked: ['score']` takes the score out of every render. The code stays, and the `music` bus stays in the
contract, silent.

The four score assertions in `tests/sound-layers.test.mjs` live inside three mixed tests: the bells share a test with
the lighter; "no score before 40" sits in the silence test with the car checks; "creeps in" and "opens at moonrise" sit
in the balance test with the car and foley checks. They are split out first, into score-only tests, so the guard skips
only them (a guard on the whole tests would also skip the lighter, the car's silence and the balance). The guard runs
them only when the score is enabled and prints why when it is not. A new test checks the parking: with the score parked
the music bus renders zero, and a planted, enabled score makes that test fail.

Normalization shifts every absolute level when the score leaves (+10.889 dB of gain today), so every comparison until
Sound 5 is relative: a cue against the background, a cue against its prediction.

### 3.2 One cue list, derived, never copied (certain)

`src/audio/cues.js` becomes the single list of sound effects (4.1). Every time and place in it comes from a call to the
picture's own functions or tables. Everything in Appendix A.3 is replaced by a derivation or a named rule. Doors sound
at their latch edge or hinge (`SHAPE.door`), tyres and the brake at the wheels (`SHAPE.wheel`). `SOUND.md` stops
carrying a cue table and points at `cues.js` and the storyboard.

### 3.3 The sync reference: the physical instant, with causal leads (certain)

Each sync cue carries the physical instant it belongs to, taken from the data at a fine step: a boot's contact, a
latch closing, a forearm reaching the parapet. For steps that is the rig's ankle reaching the ground, bisected at
1/48000 s with `footprintList()`'s own rule, not the print time, which sits on a 1/48 s grid and trails the contact by
up to 20.3 ms. The print time stays in the cue beside it.

The picture shows each event on the first frame at or after that instant, up to 41.7 ms later. So a sound at the instant
leads its first frame by 0 to 41.7 ms, inside the 45 ms that ITU-R BT.1359 gives for audio early before it is
detectable (secondary, Appendix B). Audio late is detectable only from about 125 ms.

Some sounds come before what the picture shows, because they cause it: the lighter's strike before the flame (the first
flame frame is 78.625; today's rasp starts at 78.600 and its ignition at 78.67, after the flame), and a door's unlatch
before its swing. Each family gets a named causal `lead` in `cues.js`, listed under `designed` and separate from
`nudge`.

### 3.4 Point of audition: the camera, with the laws written down as cheats (unless you object)

The camera is the listener for every sound, as today. The per-category laws already cheat proximity on purpose (car
3 m and 0.6, foley 2.5 m and 0.7): the car at 44.8 m reads -14.1 dB instead of -29.5 dB physical. I keep them and write
each one down in `cues.js` as a choice.

The intimate foley already sits close in its close shots: the lighter in shot 11 at 2.98 m (-1.1 dB) and drag 3 in shot
14 at 2.81 m (-0.7 dB). The only cues an extra "close" cheat would change are drag 2 and the exhale in shot 13, at 7.35
and 7.23 m (-6.6 and -6.5 dB), and shot 13 is a 35 mm push at about 7 m, where practice would not cheat. Every cue
still carries a `poa` field, so one can be cheated later. That is a mix detail for Sound 5, by ear.

Pan stays physical, so the frame edge pans 0.24 to 0.66 by lens and placed sources re-pan at cuts. A narrower pan for
sync foley is measured at Sound 2 and offered only if the difference is audible.

### 3.5 Backgrounds and ambiences: two places, plus story changes (unless you object; the feel is question 1)

| Source | What it is | Where heard | At a cut |
|---|---|---|---|
| Wind, city (background) | Unplaced stereo beds | Both places; the bridge's step over the street is designed | Constant within a place. Changes once, at 54.000, with a short crossfade whose length the no-click check sets |
| Water (background) | An unplaced element of the bridge's background: a wide, slow river is nearly silent except where it laps at walls, and there are no piers | The bridge only, shots 8 to 15 | Constant within the bridge |
| Wind (ambience) | A story layer over the background | Moonrise and the final wide | Eases with `moonlight(t)` (68 to 76); opens with shot 15's pull back. Each change is a cue with its data event |
| Lamp hum (sync ambience) | A point source at `LAMP.head` | Near the lamp: -11.4 dB in shot 1, -33.0 dB in shot 2 | Follows the camera under the hold rule (3.6) |
| Snow | No layer. Falling snow is silent; its sound is the quiet of everything else | | |

This removes the wind's camera-driven steps (+2.5 dB at 7>8; up to 1.8 dB at the other bridge cuts; 0.13 dB at 22 and
29) and its drift inside shots (0.67 dB in shot 9, 0.66 dB in shot 15). It keeps out of the mix the pan flips that
placing wind and city would cause (the pan's sign would change at 8 and 9 of the 14 cuts). It also removes the river
from the street, where no water can be seen, and avoids a placed water point directly below a deck camera, where the
azimuth pan is degenerate and the in-front test flips on a tiny pitch, switching -2.5 dB and the darker filter on and
off.

The other option: the water placed as lapping along the two embankment lines (z -8 and -38 at y -6). Then the
spatializer needs a guard for sources near the listener's vertical axis, with a planted control; I add the guard either
way.

### 3.6 Perspective at cuts: one-shots follow the camera, steady sounds hold (unless you object)

Editors cut perspective only when the distance changes significantly, and over-cutting is a known bad habit (Boom Box
Post, search excerpt). A continuous distance law does the opposite: it changes every steady source at every cut by
whatever the distance changed, and darkens it behind the camera. Pan flips also break the stable stereo image a scene
needs.

So:
- **One-shots** (a step, a door) follow the camera's law. The step jumps at 7>8 (-7 to -9 dB) and 8>9 (+7 to +10 dB)
  agree in sign with the picture's change of size, and stay.
- **Steady placed sources** (the hum, the idle) follow a **hold rule**: at a cut, a change under a threshold (starting
  values 3 dB and 0.25 in pan, set from the Sound 1 measurement) is held as an offset for the new shot, so the sound
  carries on unchanged; a larger change applies. Motion inside a shot still follows the law. The hum's -21.5 and
  +18.3 dB jumps apply; its 1 to 3 dB wobbles are held.
- **Backgrounds** change only at the place change (3.5).

The Sound 1 report shows every cut under two listener models side by side: the camera (today), and Silent Hill's
pattern of level from the distance to the characters with pan from the camera (the PS1 research's proposal). Sound 2
plays both as an A/B, and it becomes a question only if the difference is audible.

### 3.7 Off-screen and hidden sounds (certain)

I keep every deliberate off-screen sound in 2.4 B.1. The engine heard 3.72 s before its nose shows mirrors the brief's
"light before the car". Occlusion is not modelled, and PS1 placement was volume and pan only. The storyboard marks every
hidden cue with its blocker. Sound 2 measures a muffle on the hidden engine, done the PS1 way (a volume drop, or a swap
to a pre-filtered sample), and offers it only if it is audible.

### 3.8 Visible actions that lack a sound (shown in the reel)

**New, derived from the data, in the spotting reel marked "new" (default in):**
- the door swings to shut (33.9 to 34.5, 35.0 to 35.6) and both door stops (31.100, 32.600), so opening and closing
  match: each door has unlatch, swing open, stop, swing shut and latch, 10 door cues in all;
- getting out (A 30.9 to 32.4, B 32.2 to 33.8): seat, cloth and the springs unloading;
- the turns in place, as scuffs from the rig's ankle slide (2.4 A.1);
- cloth on the walk, from each person's walk segments and arm swing, midground;
- the shoulders closing in, cloth for both (94.2 to 95.8);
- every cloth contact moved to the rig's contact moments, once Sound 1 fixes the definition (the 2 cm and 1 mm readings
  in 2.3 differ by 80 ms);
- the brake as a sound of its own (from 19.038, while the car decelerates), and the tyres following `steerDeg` as well
  as speed;
- inside the car, off screen: the handbrake after the stop and a belt before each door opens.

**Offered, default out, in the reel marked "offered":** an exhale after drag 1 and after drag 3 (no smoke is drawn for
either); the idle louder and brighter while a door is open (this matters only if question 2 falls back to the run-down
at 0:36).

**Silent by choice, listed in the reel so you can ask for any:** the head turns, the lights, the smoke, the moon, the
aircraft lights, the prints, the snow.

### 3.9 The engine stop (question 2)

At 36.200 a key clicks off screen right (pan +0.73, -7.0 dB). Both doors have been shut since 34.5 and 35.6. The engine
stops with nobody in the car, and sound cannot explain that: it can only hide it or move it. Section 6 has the options
and the shake measurement behind the default.

### 3.10 The car's arrival and its place over the hush (unless you object)

The arrival is inverted today. The per-segment engine load (0.55 cruising, 0.08 braking, 0.3 turning, 0.1 to the stop)
times the gentle car law makes the car loudest far away and partly hidden, then quieter as it drives at the camera
(car law and load, before smoothing):

| Time | Shot | Distance | Level |
|---|---|---|---|
| 19.0 | 3 | 21.9 m | -10.4 dB |
| 20.0 (braking) | 3 | 18.9 m | -25.0 dB |
| 21.0 | 3 | 18.1 m | -14.5 dB |
| 22.0 (the cut) | 4 | 19.4 m | -23.5 dB |
| 28.0 | 4 | 7.3 m | -18.4 dB |

Fixes:
- The arrival is a cue of its own, with a stated intent: it swells to the stop.
- A storyboard check (approachRises, 4.3): while a source comes toward the camera on screen, its predicted level never
  falls by more than 1 dB, cuts included. Today's schedule fails it, which is its planted control.
- The load comes from the car's acceleration (the derivative of `carAt(t).speed`), not typed per segment. Shot 4 is one
  steady deceleration, so this alone cannot fix the inversion; the load shapes the engine's timbre more than its level,
  and the level follows distance plus the arrival's swell.
- The car reads at least 6 LU over the street background whenever it moves on screen (shots 3 and 4), and its idle at
  least 6 LU under its drive. Today's balance test measures only 15 to 19 s; the rewritten test covers both shots.

### 3.11 Before the car, and the quiet windows (question 3)

The car does not exist on the clock before 14.000 only because its headlights would light shot 2's facades. Today its
engine switches on with the cut over 0.25 s, at -14 dB from 45 m behind a building, which announces the cut.

**Bed-only windows** (no hard-effect or foley onset; the background and the ambience continue and may change only by a
story cue):

| Window | Shots | Note |
|---|---|---|
| 0 to 14 | 1 and 2 | The hush before the car (question 3) |
| 68 to 76 | 10 | Moonrise. Held for music |
| 84 to 89 | 12 | B looks |
| 100 to 112 | 15 | The final wide. Held for music |

One cue moves: the tick at 71.179. The ticks end by a rule from the data, before `moonlight(t)` rises above 0 (68.0),
instead of the typed 75. Silence here is a quiet bed, never digital zero; `techniques.md` is cited only for its
detection floor ("silent" means under -100 dBFS in a stem).

### 3.12 Masking and flams: balance and timbre, never time (certain)

Two walkers are exactly the case where every step must stay in sync (Murch's rule of two and a half). The picture is
locked, so a masked pair (the A and B steps 3.8 ms apart at 56.34; the driver door's latch and B's step at 34.50) is
solved by level and timbre, never by moving a cue off its contact. The `nudge` field is 0 unless a gate decides
otherwise, and any nudge is logged. One person's two boots within 30 ms are merged into one step (B at 33.313), on
contact times.

### 3.13 PS1: the model, the voice budget and the liberties we take (unless you object)

**Two models:**
- **Model A**, inferred (unconfirmed) from the Metal Gear Solid decompilation: a cutscene's effects pre-mixed into one
  stream, with the picture slaved to it. A rendered soundtrack already is this.
- **Model B**, attributed to Final Fantasy VII fields, Resident Evil 2 rooms and Vagrant Story (search excerpts): each
  event triggers its own voice with its own pan and volume, backgrounds are loops, and one shared hardware reverb sits
  on top.

**Default: Model B.** The cue list, the storyboard and the checks are built on it, because that is where voices,
priority and reverb on or off mean something.

**Voices.** The SPU has 24 (psx-spx). One definition is fixed at Sound 1: a mono one-shot or loop is one voice from its
onset to the end of its release, a stereo background is two, a voice at zero gain is not counted. An allocator with
priorities and voice groups (one voice per body) must show zero steals, drops and unintended cuts. The 24 cannot fail on
effects alone (peaks of 8 to 12 today, A.5), so it is a hardware report, not the density bar (4.3, check 11). The score's
share is decided in its own plan; a five-note pad is 10 voices on its own.

**The liberties.** The SPU has no per-voice filter and one global reverb (each voice on or off through its EON bit, one
wet depth). We take these liberties and write each one down:

| Liberty | Today | The PS1 way | Default |
|---|---|---|---|
| Air lowpass per voice, and darker behind the camera | Every placed voice | Volume only, or a pre-filtered sample | Kept in the blockout (it is the engine); heard on real sounds at Sound 4 and kept or dropped there |
| A muffle on the hidden engine | Proposed as an A/B | A volume drop, or a swap to a pre-filtered sample | If tried, the PS1 way (3.7) |
| Reverb sends per layer (amb 0.15, car 0.2, foley 0.25) | Freeverb with sends | Per voice on or off; one wet depth | Per-cue on or off (`reverb` in `cues.js`); one wet depth per place, changed only at 54.000; steps in snow dry or nearly dry, since fresh snow absorbs |

Silent Hill keeps a table of 36 per-area reverb depths (`g_Sd_ReverbDepths`), and Metal Gear Solid's snowfields make
footprints a mechanic (`EFFECT_FOOTPRINTS`). Both snowy exteriors are the references for the style frame; how their
banks and reverb are actually used is unverified.

### 3.14 Reverb: the SPU's formula or today's Freeverb (heard at Sound 4)

Today's reverb is a Freeverb-style unit (8 combs and 4 allpasses a channel) standing in for the SPU's. The SPU's own
reverb is a fixed formula (psx-spx, "SPU Reverb Formula") whose presets (Room, Studio A to C, Hall, Space, Echo, Delay,
Pipe in libspu) differ only in their register values and the size of their work area in sound RAM. It is short and a
little metallic, like the stand-in, but it is the real thing and costs RAM we can report (Sound 4.5). Neither can be
judged on placeholder beeps, so the choice is made by ear on the style frame at Sound gate 4, with an A/B clip beside
it. My default is the SPU formula with one preset.

### 3.15 No propagation delay, no Doppler (unless you object)

The cases that would matter are distant transients, not the engine (a continuous sound has no sync point to be late
against). At 343 m/s the ticks at 22.5 m in shot 8 would arrive 66 ms late and the steps at 11 to 15 m 32 to 44 ms
late: under the 125 ms at which late audio becomes detectable, and against film practice, which drops the delay. I
write "no delay, by convention" into `cues.js`, so it is a recorded choice and not an accident.

### 3.16 Captions (certain)

Nothing goes in the bottom 120 px at 1080p (30 px at the preview's 480x270). Captions get their own band below the
preview's 11 px HUD strip.

| Track | Content | Rules |
|---|---|---|
| Review (Sound 1 and 2) | Every planned sound, readable | In-time exact (the cue's onset); out-time at the later of the cue's end and its in-time plus 0.833 s (20 frames, Netflix's minimum event). Steps merged into one line per walker per surface stretch ("[A walks, road]"), with the individual steps drawn as ticks in a thin lane under the caption band. At most 3 lines at once (starting value, from the densest moment). Ids only in the soft WebVTT and SRT, never burned. Off-screen cues in italics in the VTT |
| SDH deliverable (Sound 6) | Plot-pertinent sounds only | One caption per spotted run, lowercase, in brackets, present tense; the source named only when it is off screen, and not named again while a sound continues (DCMP) |

The exact per-cue times stay in `report.json` and the timeline.

### 3.17 One scene designed first (certain as a step; the scene is a Sound gate 2 question)

Make one crucial scene work early and let it set the style (Randy Thom's practice, search excerpt). Sound 4 starts with
one style-frame scene, finished and heard by you before the other layers are refactored. My default is shots 4 to 6
(22.0 to 46.0): every category, the densest moment and the hush after the engine dies.

### 3.18 Loudness: anchored on the hush (my call, heard at Sound gate 5)

Normalizing a hushed, effects-only track to a fixed integrated level raises the quiet as a side effect. YouTube turns
loud uploads down to about -14 LUFS and does not turn quiet ones up (secondary). So from Sound 5 the mix is anchored on
the hush: the street background sits at a short-term loudness set by ear on the style frame. Integrated loudness is
reported and kept at or under -16 LUFS rather than raised to it. The three true-peak bars stay: -2.0 dBFS on the
limiter's 4x estimate, -1.5 dBTP on the WAV, -1.0 dBTP on the AAC. These are delivery engineering and stay my decision;
how quiet the night sits is part of your balance question at Sound gate 5.

---

## 4. Technical approach

### 4.0 The starting design, and what I changed

| Starting design | Kept, changed or added | Why |
|---|---|---|
| `cues.js` as the sound's `world.js` | Kept, as a derived catalogue (like `footprints.js`), not a fourth source. Designed fields named in each cue | `set.js`, `world.js` and `shots.js` stay the truth; the perturbation control proves it (4.2) |
| Every cue derived from the picture's functions | Kept, plus a sync instant per cue (a contact, a latch) beside the print time, and named causal leads | 3.3 |
| Predicted level at the camera | Changed: a designed level from the level plan (1.3) plus the distance law, reported against the place's background | The data gives no source a loudness; normalization moves absolutes |
| Timeline: level as intensity, pan as colour | Changed: level as an envelope's height, pan as a thin line inside the lane, on-screen spans as a bar under it | Two continuous variables on one mark are hard to read |
| Panel: the stereo field per shot | Kept, drawn over the shot's whole duration | The picture's lesson: one frame cannot show a beat (its insets for shots 3, 5, 10, 11) |
| Screen-direction check | Moved: screen direction and pan width follow from the pan formula, so they become spatializer tests with mirrored and doubled-pan controls. The report keeps a per-shot table of on-screen sources, screen x and pan | A check that cannot fail on correct data belongs in the engine's tests; shot 5's roll is where a sign can disagree near the centre |
| Perspective jumps at cuts | Changed: keyed on `perspective`, with the hold rule for steady sources and two listener models | 3.6 |
| Masking: "a few tens of ms" | Changed: two checks, transient pairs (200 ms before to 20 ms after) and simultaneous masking by everything sounding, backgrounds included | The film's real masking risk is steady sound under small sounds |
| Density against 24 voices | Changed: foreground streams by voice group is the bar (Murch's two and a half); the 24 is a hardware report | 3.13 |
| Traceability | Kept, with a perturbation of every input family in a child process | 4.2 |
| Captions naming every cue | Changed: readable durations, merged runs, ids only in the soft tracks; an SDH track for delivery | 3.16 |
| (added) | The sound arc, the level plan and the three orders (1.3); the spotting reel; the style frame; the arrival check; sync measured against the picture's frames | |

### 4.1 `src/audio/cues.js`: the single source of truth for sound

**Rules:**
- **Pure.** Built once at import by `makeCues(world)` and frozen. No `Math.random`, no clocks; rule-based families (the
  ticks) seed through `rngFor`.
- **No literals for anything the picture knows.** Places and times come from the picture's functions and tables.
- **The picture is not changed by this.** Sound 1.1 exports what is missing: from `actors/car.js`, `SHAPE` (at least
  `door`, `wheel`, `body`), `SETTLE`, `DOOR_SIDE`, `STEER_MAX_DEG`, `doorOpen`, `steerDeg`, `settlePitch` and
  `idleLift`; from `world.js`, `SPEED_W` and `X_START`. Exporting changes no frame, and the determinism check, the
  camera check and verify's frame match prove it.

**One cue:**

```js
{
  id: 'hard.door.driver.latch',      // category.family.source.part; steps use ordinals: 'foley.feet.A.07'
  category: 'hard',                   // 'hard' | 'foley' | 'bg'
  family: 'door',                     // engine, arrival, tyres, brake, settle, unload, cabin, door, stop, tick |
                                      // feet, scuff, moves, lighter, drag, breath | wind, city, water, ambience, hum
  source: 'car:door:driver',          // what makes it; also the allocator's voice group
  person: null,                       // 'A' | 'B' | null
  surface: null,                      // 'road' | 'walk' | 'deck' | null, as surfaceOf() names them
  shape: 'oneshot',                   // 'oneshot' | 'continuous'
  sync: 34.5,                         // the physical instant from the data (a contact, a latch); steps: the contact
  print: null,                        // steps only: the print time, on footprintList()'s 1/48 s grid
  lead: 0,                            // designed: how far the onset comes before `sync` (a strike before its flame)
  t0: 34.5, t1: 34.62,                // onset = sync - lead + nudge; t1 may be designed (the tail)
  place: (t) => [x, y, z],            // a world point; null for an unplaced background
  placement: 'onset',                 // 'onset' (fixed when it starts) | 'tracked' (moves with the source)
  law: 'door',                        // a key into LAWS: physical, car, door, foley
  perspective: 'camera',              // 'camera' (follows each shot; steady ones under the hold rule) | 'location'
  poa: 'camera',                      // 'camera' | 'close' (3.4)
  track: null,                        // (t) => data a timbre may follow: { rpm, load, speed, steer, flicker, ember }
  level: -12,                         // designed: dB at the law's refDist, from the level plan (1.3)
  reverb: true,                       // designed: this voice's reverb bit (3.13)
  priority: 64, voices: 1,            // allocator inputs (3.13)
  label: '[car door shuts]',          // the review caption
  sdh: '[car door shuts]',            // the delivery caption, or null if not plot pertinent
  derivedFrom: 'carTimes.doors.driver.close1; SHAPE.door.back, SHAPE.door.side',
  rule: null,                         // or 'SOUND-PLAN 3.11' for a cue made by a rule from data
  designed: ['level', 't1', 'lead', 'priority', 'reverb'],  // fields that are choices, not data
  nudge: 0,                           // seconds, 0 unless a gate decided otherwise; logged
}
```

**Exports:** `CUES` (frozen, sorted by `t0`), `LAWS`, `LOCATIONS` (street for shots 1 to 7, bridge for 8 to 15, from
`SHOTS`), `cuesAt(t)`, `cuesIn(t0, t1)`, `locationAt(t)`, `makeCues(world)`.

**Families and the data each one reads:**

| Family | Category | Time from | Place from | Designed |
|---|---|---|---|---|
| Engine (intake, exhaust) | hard | `carTimes.start`; the stop by question 2; the run-down length from `carTimes.lightsOff1 - lightsOff0` (0.4 s, the span `idleLift` fades over; replaces the typed 0.45) | `carPoint` over `CAR` and `SHAPE.body` | Level; rpm law (`ENGINE`); load from the acceleration of `carAt(t).speed` |
| Arrival | hard | `carAt` from the corner (the nose clears at 17.72) to `carTimes.stop` | As the engine | The swell (check approachRises) |
| Tyres | hard | `carAt(t).speed`, `steerDeg` | The wheel contacts, `SHAPE.wheel` (forward 1.45, side 0.82) | Level |
| Brake | hard | Rule: from `carTimes.brake` while the car decelerates; the creak over the last stretch before `carTimes.stop` where speed is under a threshold (replaces "stop - 0.55") | Front wheels, `SHAPE.wheel` | Threshold, level |
| Settle | hard | `settlePitch`: onset at `carTimes.stop` (29.000), the rebound at its deepest point (29.35; replaces the typed +0.38, which gives 29.38) | Body centre | Level |
| Unload | hard | The poser's slide and rise segments from `PEOPLE_KEYS` (A 30.9 to 32.4, B 32.2 to 33.8) | That seat, from `SHAPE` | Level |
| Cabin (new) | hard | Handbrake: a designed delay after `carTimes.stop`. Belt: inside each person's seated span, before their door's `open0` | The cabin | Whether at all (the reel), level |
| Door: unlatch, swing open, stop, swing shut, latch | hard | `carTimes.doors.*`: `open0`, `open1`, `close0`, `close1`; the unlatch leads `open0` by a designed lead | Latch edge `SHAPE.door.back` or hinge `SHAPE.door.front`, at `SHAPE.door.side` with `DOOR_SIDE` | Lead, level |
| Engine stop | hard | Question 2 | The engine | Level |
| Tick | hard | Rule: seeded spacing from the engine stop plus a designed delay, ending before `moonlight(t)` rises above 0 (68.0) | The engine bay | Spacing, delay, level |
| Feet | foley | The contact from the rig (ankle height bisected at 1/48000 s, `footprintList()`'s own rule); the print time beside it; `footsteps()` merges flams | Each print | Timbre by surface and person |
| Scuff | foley | `makePoser(id).pose(t).legs`: an ankle slide without lift, over a threshold | The ankle | Threshold, level |
| Moves (cloth) | foley | Walk segments from `PEOPLE_KEYS` and the arm swing; the turns, the lean, the lee turns, the shoulders; contacts from the rig's hands and arms under a stated definition (Sound 1.2) | Poser root plus 1.2 m, via `bodyToWorld` | Material from `PEOPLE[id]` (A's long coat, B's puffy jacket), level |
| Lighter | foley | `LIGHTER.t0`, `t1`, `lighterFlicker`; the strike leads the first flame frame | `cup` | Lead, inner timings (Sound 4) |
| Drag | foley | `EMBER.drags`, `dragDur`, `emberLevel` | `tip` | Level |
| Breath | foley | `EXHALE.t`, `life`; exhales after drags 1 and 3 offered (default out) | `mouth` | Whether at all, level |
| Wind, city, water (background) | bg | `LOCATIONS` from `SHOTS`; `T_TOTAL` | None (unplaced) | Level per place |
| Ambience (story) | bg | `moonlight(t)` (68 to 76); shot 15's camera (`cameraAt`) | None | The size of each change |
| Hum | bg (sync ambience) | 0 to `T_TOTAL` | `LAMP.head` | Level |

### 4.2 The perturbation control

A cue list that only claims to be derived is the drift that already happened in `SOUND.md`. So `makeCues` is run
against perturbed pictures, one input family at a time, each in its own child process:
- **Times:** `PEOPLE_KEYS` +0.1 s (A, then B); `carTimes` start, stop, doors and lights +0.5 s each; `LIGHTER`, `EMBER`,
  `EXHALE` +0.3 s; the moonlight ramp +0.5 s; the place change (shot 8's start) +0.5 s.
- **Places:** `CAR` and `SHAPE` dimensions x1.1; `LAMP.head` +0.5 m in x; `BRIDGE` and the rail +1 m.

`people.js` and `footprints.js` import `world.js` directly, and `footprints.js` caches at module level, so an injected
object would not reach them. Instead a Node module hook (`module.register`) in the child serves a patched copy of
`world.js`, `set.js` or `shots.js` to every importer, and the cache starts fresh in each child. No picture file
changes. If some constant cannot be reached that way, the fallback is to give that picture module a parameter: a
picture change, gated by `check:determinism`, `check:cameras` and verify's frame match, and brought to you first.

**Bar:** every non-designed cue moves under exactly the perturbations its `derivedFrom` names, and under no other. A pure
time shift moves it by exactly that amount (1e-9 s; 1e-6 s for bisected contacts). A cue that never moves must be
designed or made by a rule. Today the typed `RUSTLES` (62.75, 62.8, 77.6, 82.3) fail it: the lean and lee-turn keys
move, the rustles do not.

### 4.3 The sound storyboard: `scripts/sound-storyboard.js`

**Where it writes.** `storyboard/sound/`; with `--raster --round 04`, PNGs also go to `review/round-04/`.

**What it reuses.** The picture's libraries (`lib/draw.js`, `map.js`, `panel.js`, `math.js`, `raster.mjs`), plus a new
`scripts/lib/sound-checks.js` that is film-generic (no film constants), so it can move into `template/`.

**What it reads.** `cues.js`, `spatial.js` (`listenerAt`, `placeAt`) and `SHOTS`, nothing else, and the published
export for its frames.

**Drawings:**
- **Sound map** (`map.svg`, `map.excalidraw`), north up, the same view as the picture's map:
  - **Sources:** a glyph per family; the car path with time marks and its engine, exhaust and wheel points; the doors at
    the latch edge and hinge; each step at its print, coloured A or B and labelled with its contact time; the cup, tip
    and mouth; the hum at the lantern; the place boundary with the bridge background (wind field from 70 degrees, the
    water, the city's bearings) drawn as unplaced.
  - **Context:** the 180 degree line and the lamp pool.
  - **A listener glyph per camera, replacing the wedge:** the field-of-view wedge (what is on screen); the left and right
    axis; the half-plane behind the camera shaded (-2.5 dB from `behindGain` 0.75, air x 0.45); level rings per law:

    | Law | -6 dB | -12 dB | -18 dB | -24 dB |
    |---|---|---|---|---|
    | Physical (1.5 m, 1) | 3.0 m | 6.0 m | 11.9 m | 23.8 m |
    | Foley (2.5 m, 0.7) | 6.7 m | 18 m | | |
    | Car (3 m, 0.6) | 9.5 m | 30 m | 95 m | |

- **Detail maps:** car arrival (shots 2 to 5), arrival (4 to 7), bridge (8 to 10), railing (11 to 15).
- **Cue timeline** (`timeline.svg`), drawn like a DAW arrangement: one lane per source, shots as columns in
  `shotColor`; predicted level as an envelope's height, in dB against the background; pan as a thin line inside the
  lane, left at the top; on-screen spans as a bar under the lane; onsets as ticks with labels; the bed-only windows,
  "held for music" and the place change at 54.000 marked.
- **Fifteen shot panels** (`panels/shot-NN.svg`): the finished film's frame at the shot's middle, decoded from the
  published export with no rebuild, with every cue's screen point marked; beside it the stereo field over the shot's
  duration (x is pan from -1 to 1, with the lens's frame width at +/- sin(hfov/2); y is time); glyph size for predicted
  level, filled for on screen, hollow for off screen, a cross for behind the camera; a mini map of the listener; the
  shot's cue list underneath.
- **`report.json` and `index.html`**: the audit tables. Plus `captions/review.vtt` and `review.srt`.
- **The spotting reel:** the published picture (`out/snowy-bridge.mp4`, video stream copied and audio dropped, since that
  file carries the S8.3 mix) with the review track as soft subtitles; and a silent 480x270 copy with the shot label in
  the top strip, the captions in their band below it and the step lane under them. New cues are marked "new", offered
  ones "offered". You watch where every sound will be before any sound exists.

**Checks** (`report.json`). Each has a planted-fault control in `tests/sound-checks.test.mjs`. Literature figures are
starting values, set from measurement at Sound 1 and Sound 2.

| # | Check | Definition | Bar (starting values marked) | Planted fault |
|---|---|---|---|---|
| 1 | trace | Every cue has `derivedFrom` or a `rule` and names its `designed` fields; the perturbation control (4.2) | Exact | A cue with a literal time; a door cue reading the wrong door; today's `RUSTLES` |
| 2 | onScreen | Each cue's point through `makeCamera(...).project`: on, hidden (blocker named: building, parapet, deck, bank, car body, cabin), off (with the frame side) or behind. Judged per point, so feet and body can differ | Reported per cue | A point behind the camera reads behind; a point behind the south-east building at 15.0 reads hidden(SE) |
| 3 | storyOrder | The three orders (1.3): no car sound before the first frame that shows its light; steps through shot 5 land on feet in frame; no onset from 68.0 to 76 | Any breach fails | An engine onset planted at 13.5 |
| 4 | sync | Each sync cue's onset against its first showing frame, found by sampling the picture's own state functions at frame times | Onset 0 to 45 ms ahead of that frame, or a named `lead` (starting value, BT.1359) | A cue one frame late; a cue 60 ms early |
| 5 | stereoOrder | Shots 9 to 15: whenever both people sound, A pans left of B by at least a minimum audible separation; the point used is the cloth point (root plus 1.2 m) | 0.1 in pan, about 1.4 dB of channel balance (starting value, checked by ear at Sound 2). Below it is reported "not separated", not "holds". Today the margins are 0.04 (shot 14) to 0.27 (shot 11); the hands can flip | A and B swapped |
| 6 | cutPerspective | Every source sounding across every cut: delta dB and delta pan, keyed on `perspective`. A 'location' source must not change inside a place; a steady 'camera' source follows the hold rule; one-shots are reported, with jumps of 6 dB or more listed. Both listener models side by side (3.6) | A 'location' change inside a place fails; a change under the hold threshold that leaks through fails | +12 dB planted on a background inside a place; a 2 dB hum change not held |
| 7 | approachRises | While a source comes toward the camera on screen, its predicted level never falls by more than 1 dB, cuts included | Any larger fall fails (starting value) | Today's load schedule (it fails) |
| 8 | maskingPairs | Cue c is at risk when another source's onset falls from 200 ms before to 20 ms after it, within 6 dB of it | Reported; the remedy is level and timbre (3.12) | Two equal cues from different sources 10 ms apart |
| 9 | maskingBed | Each one-shot against everything sounding in its window, backgrounds and steady sources included: broadband margin at Sound 1, per third octave on peak short-window levels at Sound 2 (reported) and Sound 4 (gated) | Margin under 3 dB reported (starting value) | A step planted under a loud steady noise |
| 10 | flams | One person's two cues within 30 ms, on contact times, must be merged | Any unmerged pair fails | Two prints 10 ms apart for one person |
| 11 | density | Every 10 ms: foreground streams (voice groups within 6 dB of the loudest sounding, or with an onset in the last 100 ms) | More than 2 reported; more than 3 fails (starting values, Murch's two and a half) | Four groups planted at one moment |
| 12 | voices | The PS1 count (3.13) and the allocator | At most 24; zero steals, drops or unintended cuts | 30 simultaneous steps; a retrigger cutting its own tail |
| 13 | silence | No hard-effect or foley onset inside a declared window | Any onset fails | A cue planted in shot 12 |
| 14 | safeBand | Each story cue's band: by family at Sound 1; measured at Sound 2 through a phone simulation (mono, high-pass about 300 Hz, low-pass about 8 kHz) and a mono fold-down | Flag a story cue that lives only below about 250 Hz or only in the side channel | A 60 Hz-only cue; an anti-phase cue |
| 15 | straddle | One-shots sounding across a cut, where the placement mode matters | Reported | A one-shot planted across 54.000 |

The caption rules (3.16) are checked at Sound 1.10, not in the report.

### 4.4 The blockout stage

**The switch.**
- `config.audio.stage` is `'blockout' | 'design'`, mirroring `config.stage`; from Sound 2 the default is
  `'blockout'`. `config.audio.parked` defaults to `['score']`.
- `index.js` builds its layers from the stage, minus the parked ones:
  - **Blockout:** three layers that read only `cues.js`: `layers/blockout/bg.js` on the `amb` bus, `hard.js` and
    `foley.js` on `fx`.
  - **Design:** today's `ambience.js`, `car.js` and `foley.js`, untouched until Sound 4. Parked: reachable by the
    switch, never deleted.
- **Proof that parking changes nothing:** with stage `'design'` and the score unparked, the render reproduces today's
  `out/sound.wav` byte for byte (sha256 `f80b1542...`).

**Placeholders: grey-box sound.** One simple timbre per family, spatialized by the real spatializer under the real laws,
at the exact cue times and planned levels. Each voice gets its own seeded noise through `rngFor`: the SPU's noise
generator runs at one frequency for every noise voice (psx-spx), and a random sample per voice is the PS1 workaround.
The placeholders are deliberately and obviously temporary, to avoid temp love. The reverb stays as today (Freeverb and
today's sends), so only the sources change; reverb is judged at Sound 4.

What the blockout can show: timing, placement, presence and density. It cannot show balance, which depends on spectrum
and envelope that placeholders do not have, so balance is reported at Sound 2 and not gated.

| Family | Placeholder | Follows the data |
|---|---|---|
| Engine | A buzz, kept in a band a phone can play | Pitch from `engineAt(t).rpm`, level from the arrival rule |
| Tyres | Noise | Level from speed; band moves with `steerDeg` |
| Brake | Band noise while braking, a held sine glide for the creak | The deceleration |
| Settle, unload | A low knock, in a phone's band | |
| Cabin | A short click | |
| Doors | A click at unlatch; a rising sweep for the swing open, a falling one for the swing shut; a knock at the stop; a thump plus a click at the latch | The swing spans |
| Engine stop | A click, then the buzz falling to nothing | The run-down |
| Ticks | One short high click each | |
| Feet | A band-limited noise burst, with a band offset per person (A lower, B higher) and per surface; the heavy step longer | Broadband enough that flams and masking between the walkers are not hidden by pitch |
| Scuffs | A short noise slide | The slide's span |
| Moves | A band-noise smear, A's band lower than B's | The move's span |
| Lighter | A click, noise held for the flame, a click at release | Amplitude from `lighterFlicker` |
| Drags | Noise | `emberLevel` |
| Breath | A filtered noise swell | `EXHALE.life` |
| Wind, city, water | Steady pink, brown and grey noise per place, unplaced stereo | The place; the ambience changes |
| Hum | Pure partials at 120 and 240 Hz | |

**Tests change honestly.** Each change is recorded in the notes with its reason; no bar is relaxed without one.
- **`tests/audio.test.mjs`:** determinism, the meter, normalize, the master's loudness and peaks, the fade and no clicks
  at cuts are properties of the engine; they run on the default stage, and their margins move. Screen direction and pan
  width join them as spatializer tests (4.0), with the vertical-axis guard (3.5).
- **`tests/sound-layers.test.mjs`:** it pins the parked design layers, so it runs with stage `'design'` explicitly and
  stays their regression test. The score assertions are split out and guarded first (3.1). Its copied numbers (`+0.38`,
  the lean windows, the offsets 1.7, 0 and 0.6) stay until Sound 4, which replaces them with reads from `cues.js`.
- **`tests/sound-player.test.mjs` and `capture.test.mjs`:** unchanged; they follow whatever the layers render.
- **`scripts/verify.js` check 5:** today's sidecar (`out/sound.wav.json`) has no stage or parked field. A missing field
  means "made before the stage switch, score in", and the S8.3 listening copy is reported that way, not as a bare
  mismatch. Sound 2.1 writes both fields from then on.
- **New:** `tests/cues.test.mjs` (trace, the perturbation, counts: 63 steps from 64 prints, 10 door cues, the tick
  rule); `tests/sound-checks.test.mjs` (every check with its planted fault); `tests/sound-blockout.test.mjs` (onsets,
  pan, silence windows, the stems summing to the mix).
- **Two small defects, fixed at Sound 2.1:** `scripts/sound.js` line 26 builds a layer list from a `name` the modules
  do not export (line 28 then overwrites it); `lufsOf` in `scripts/lib/audio-analysis.mjs` says "short-term, ungated"
  but calls the gated `integratedLufs`.

### 4.5 Review tooling, and the review round

- **Preview.** `capture.js --profile preview --audio` (480x270) renders the blockout sound under the shot overlay, as
  the picture's blockout did. It adds the review captions twice: a soft `mov_text` track, and a burned copy in its own
  band below the HUD strip. `preview.mp4.json` holds the ffprobe facts, the per-shot loudness and the stem list.
- **Stems by voice group.** One stem per person's feet, per door, and so on, rendered alone. Cues in different groups
  that coincide (A and B, 3.8 ms apart at 56.34) are then measured apart. The detector's 80 ms minimum gap applies only
  within one group, where the closest pair is B's at 104 ms.
- **Measurements** (`measure.json`):

| Measure | Bar |
|---|---|
| Renderer: onsets matched one to one against cue times | Within 5 ms (the S8.2 layers reached it). This tests the renderer and the detector, not sync |
| Sync with the picture: each sync cue's measured onset against its first showing frame | 0 to 45 ms ahead, or its named lead (check 4); audio after the frame fails |
| Cue ends | Reported |
| Pan per cue, from its balance in its own stem window, against the prediction | Within 0.5 dB (today's car test; S8.2 measured 0.11 dB) |
| Level per cue against the background, against the prediction | Reported, not gated (4.4) |
| Short-term loudness, 400 ms and 3 s windows | Reported per shot |
| Silence windows | No onsets inside |
| Voices, density, masking per band | Against checks 9, 11 and 12 (masking reported) |
| Phone simulation and mono fold-down | Against check 14 |
| Onset drift of the parked design layers against `cues.js` | Reported, not gated: drift is expected until Sound 4 |

- **Audio stills per shot:** a spectrogram strip, predicted against measured level, a pan meter and cue markers.
- **An arrangement sheet:** the whole film, with measured onsets drawn over predicted ones.
- **Gate package:** `review/round-05/` (`preview.mp4`, the captions, `stems/`, `measure.json`, `findings.json`,
  `decisions/` with a short clip at each decision moment, `notes.md`) and a private Artifact page.

### 4.6 Determinism and the contract

- `cues.js` is pure: built once from data, frozen, no clocks, no unseeded randomness. A second import gives the same
  list.
- The blockout follows the engine's rules. Two renders give the same bytes. The stems rendered alone and summed equal
  the full mix before the master stage, so no layer leaks state into another: the audio twin of "no state between
  calls", since audio is a stateful one-pass render, not `renderAt(t)`.
- The player's parity test (one float32 step) applies unchanged.
- The forbidden-character and forbidden-API scans cover the new files.

### 4.7 How I review my own work

I cannot hear, so every review works from measurements and pictures of sound: the drawings, opened one by one;
spectrograms with cue markers; onset plots, balance meters and loudness curves; the phone and mono simulations. Each
round I write the specific problems in the notes before fixing anything. At most three rounds per stage, then I stop and
say what is left.

At Sound 2 an independent panel reviews the blockout by shot group, with lenses for timing, placement, perspective,
masking and density, story beats (each beat has its sound, silence where planned) and phone readability. Skeptics
follow, and the findings go to `findings.json` in the picture's schema. Agents cannot hear either, so every finding
cites a measurement or an image. I measure every option before it becomes a question; the picture's Gate 2 had two
wrong options until they were measured. Only your ears say whether it is good.

---

## 5. Risks

| Risk | Why it matters | What I do |
|---|---|---|
| I cannot hear | Correct timing and placement can still sound wrong | Listening proxies (4.7). Your ears at Sound gates 2, 4 and 5. The blockout is judged on timing, place, presence and density only |
| `cues.js` becomes a fourth hand-edited source | The ticks in `SOUND.md` already drifted ("37.7 to 75" against a last tick at 71.179) | The per-family perturbation (4.2); designed fields named in every cue |
| The perturbation cannot reach a constant | The module hook patches copies; some value may sit where no hook reaches | The fallback is a picture parameter, a picture change brought to you, gated by determinism, cameras and frame match |
| The picture is locked | Some sound problems want a staging change (the engine stop) | Those become your decisions. Everything else is level, timbre or perspective |
| The idle shake may read on screen | Question 2's default stops the engine 6 s before the shake fades | Measured at Sound 1.1 before anything moves; the fallback is the run-down at 0:36 |
| Two timing implementations from Sound 2 to Sound 4 | The parked layers keep their own copies | The drift report at Sound 2 and 3; zero drift required at Sound 4 |
| Exporting picture internals | `actors/car.js` and `world.js` gain exports | Determinism, `check:cameras` and verify's frame match must pass unchanged |
| Absolute levels move | Parking the score changes the normalization (+10.889 dB today) | Relative measures until Sound 5 |
| Thresholds from the literature | A wrong bar passes bad work or fails good work | Labelled as starting values; set from the Sound 1 and 2 measurements |
| The research came from search excerpts and summaries | Quotes and figures are unchecked against full texts | Tagged in Appendix B. Nothing depends on an unconfirmed claim alone |
| Temp love | You grow fond of the placeholders | Obviously temporary timbres; the style frame replaces them early |
| Placeholders mask differently from final sounds | Masking and density at Sound 2 are not final | Masking per band is gated only at Sound 4 |
| Some checks rarely fail | A check that never fires proves nothing | A planted control each, and the margin reported |
| The listening copy is not current | `out/snowy-bridge.mp4` carries the S8.3 mix with the score | Kept until Sound 5. Verify reads its sidecar; the notes say so |
| Captions burned with libass | Your machine's ffmpeg may lack it | The soft tracks need nothing; the burned copy is made here |
| The template and playbook teach the skipped method | A new film would repeat it | The superseded note at Sound 0.6 (1.7) |

---

## 6. Questions for you: the options and the numbers

The four questions are at the top of this file, once. This section holds only what lies behind each.

**Question 1, the feel.** The feel, the arc, the three orders and the level plan are in 1.3. What is new against the S8
feel: the moonrise and the last wide carry no new sound and are held for the score; the hush arrives as the doors open
(question 2); the car swells instead of fading as it comes in (3.10).

**Question 2, the engine stop.** Measured: the idle shake is three components of 1.6, 1.1 and 0.7 mm (3.4 mm at most).
At shot 5's 2.5 to 3.8 m on a 35 mm lens, one internal pixel of the 480x270 frame covers 6.3 to 9.7 mm, so the shake is
0.35 to 0.55 internal px, and shot 5's camera trucks the whole time, so the car re-snaps to the pixel grid every frame
anyway. Vertex snap could still turn the shake into an occasional 1 px step; Sound 1.1 checks it from the car's own
vertices through the shot 5 camera and the snap grid, and on the published frames.

| Option | What you hear | What it costs |
|---|---|---|
| (a) A key fob blip or lock chirp from A | The car "locks" itself | An anachronism for a 1970s to 80s sedan (PLAN 4.4); explains the gap wrongly |
| (b) The engine runs down at 0:36, no key click | The car switches itself off with nobody in it; nothing draws attention to it | Fallback |
| (c) As today: a key click at 0:36 | A key turns in an empty car | |
| (d) The key turns and the idle dies while A is still seated, a designed lead before the driver door unlatches (0:30.5); the lights still fade at 0:36, in silence (headlights left on with the engine off are normal for the period) | The hush arrives as the door opens; the idle no longer masks the doors and steps in shot 5 | Needs the shake not to show (Sound 1.1). Moves the ticks earlier (they follow the engine stop), and Sound 1 measures that density in shot 5 |
| (e) Reopen the picture for that beat | Picture and sound agree | A change to a finished, published film; only on your word |

**Default: (d)** if the shake does not show; **(b)** if it does.

**Question 3, before the car.** Measured: extending the car's path backward at `SPEED_W` from `X_START` (no picture
change), the car would be 70 to 58 m from shot 2's camera between 11.0 and 13.9 s, off frame right, pan +0.90 to +0.82,
at -16.4 to -15.5 dB under the car law (-33.4 to -31.8 physical), only 1.4 to 2.3 dB under its level at 14.0. A pre-lap
would need its own, lower designed level.

| Option | Note |
|---|---|
| (a) Nothing before 0:14; the engine rises out of the quiet over its first seconds instead of switching on | Default. Keeps "light before the car" in sound; stops the engine announcing the cut. If Sound 1 finds the beams show after 14.0, the sound waits for them |
| (b) As today: on with the cut over 0.25 s | Announces the cut |
| (c) A pre-lap: faintly, from the far right, over the last seconds of shot 2 | Builds anticipation, but we would hear the car before we see its light |

**Question 4, what gets published.** The sound version is a new upload, keeping the silent one, with the existing title
thumbnail checked at 320 px, and the SDH captions with it; at Sound gate 6 I ask once more, and publish only on your
word.

---

## 7. What each sound gate gives you, and what you do

**Where the work stops.** You asked for the plan and then the blockout, so Sound gates 0 and 1 run on their defaults and
their questions travel with Sound gate 2, the first stop. From Sound 3 on I keep building and stop only for what is
yours: the style frame (Sound gate 4), the listen (Sound gate 5) and publishing (Sound gate 6).

| Gate | You get | What you do | Stops me from |
|---|---|---|---|
| Sound 0 Plan | This file and the sound stages in `ROADMAP.md` | Nothing now: the four questions at the top come to you at Sound gate 2 | |
| Sound 1 Storyboard | The spotting reel; the sound map, detail maps, cue timeline, 15 panels and `report.json` (my evidence); `review/round-04/` | At Sound gate 2: watch the 112 s spotting reel (no sound, a caption for each planned sound, new ones marked "new", offered ones "offered") and tell me any sound to add, drop or move | |
| Sound 2 Blockout (the first stop) | `preview.mp4` with the overlay, the placeholder sound and the captions; a clip at each decision; `review/round-05/`; the Sound gate 0 and 1 questions | Listen to the 112 s preview once on headphones and once on the phone speaker. Every sound is a deliberate beep, click or hiss, rougher than the copy you have now. Judge only whether each lands on its action, comes from the right side, and whether any moment is crowded. Left and right need headphones | Sound design |
| Sound 3 Revisions | The revised storyboard and blockout, with a before-and-after table | Nothing, unless I ask | Designing a cue whose timing or place is not signed off |
| Sound 4 Design | The style-frame clip (0:22 to 0:46), then the full design | Listen to the style frame on headphones: the first sounds meant to be final. Say what feels wrong | The mix |
| Sound 5 Mix | A 1080p listening copy with effects and score | Listen start to finish, headphones then phone. Say what is too loud, too quiet or missing, including how quiet the night sits | The final export |
| Sound 6 Final | 1080p and 4K with sound from one build, verified; the SDH captions; `README.md` and `SOUND.md`; the template and the playbook updated | Say whether to publish | |

**Next action:** Sound 1, then Sound 2, then the first stop at Sound gate 2.

---

## Appendix A. Evidence

### A.1 Level and pan at each cut (dB change under today's laws)

| Cut | Lamp hum | Car (engine, then parked) | A | B | River, nearest water |
|---|---|---|---|---|---|
| 7 (1>2) | -21.53, pan -0.12 to +0.28 | | | | -16.92, pan flips -0.99 to +0.22 |
| 14 (2>3) | +4.51, pan flips +0.28 to -0.76 | | | | +4.37, flips |
| 22 (3>4) | +18.34 | +0.54 | | | +13.75 |
| 29 (4>5) | -5.75 | +4.33, pan flips +0.20 to -0.58 | | | -2.71, flips |
| 40 (5>6) | +0.85 | -6.04 | -2.07 | -2.38 | -0.55 |
| 46 (6>7) | +1.30 | +7.83 | +3.01 | +3.53 | +0.50 |
| 54 (7>8) | -9.55, flips | -9.99 | -7.38 | -8.69 | -2.53, flips |
| 60 (8>9) | +10.58, flips | +5.74 | +7.38 | +9.93 | +2.21 |
| 68 (9>10) | -12.08 | -6.53 | -10.45 | -12.00 | -0.79 |
| 76 (10>11) | +11.13 | +5.65 | +12.23 | +13.85 | -1.41, flips |
| 84 (11>12) | -3.07 | -1.30 | +0.94 | -2.67 | +2.50 |
| 89 (12>13) | +2.31 | +1.25 | -5.62 | -3.21 | 0.00 |
| 96 (13>14) | -2.94 | -1.58 | +5.05 | +3.04 | -2.56 |
| 100 (14>15) | +2.45 | +3.98 | -6.68 | -4.76 | +0.95, flips |

"Flips" means the pan changes sign. The wind's camera-driven boost steps +2.52 dB at 54, between -1.79 and +0.99 dB at the
other seven bridge cuts, +/-0.13 dB at 22 and 29, and drifts 0.67 dB within shot 9 and 0.66 dB within shot 15. If
wind and city were placed from their data, the wind's pan would change sign at 8 of the 14 cuts and the city's at 9.

### A.2 Near coincidences: cues from different sources within 60 ms

Today's cue times for everything but the steps, which are given both ways: on the print grid (1/48 s) and on contact
times bisected from the rig. The doors, key and ticks will move when `cues.js` derives them (3.8, question 2, the tick
rule), so Sound 1 recomputes this table.

| Cue 1 | Cue 2 | Gap on print times (ms) | Gap on contact times (ms) | dB, 1 / 2 |
|---|---|---|---|---|
| Passenger door unlatch, 32.000 | A step, 32.042 (contact 32.034) | 42 | 34 | -3.9 / 0.0 |
| Driver door latch, 34.500 | B step, 34.500 (contact 34.499) | 0 | 0.6 | -1.7 / -3.6 |
| A step, 36.188 (contact 36.172) | Key and run-down, 36.200 | 13 | 28 | -0.4 / -7.0, -1.6 |
| A step, 36.188 | B step, 36.229 (contact 36.228) | 42 | 57 | -0.4 / -4.5 |
| Key and run-down, 36.200 | B step, 36.229 | 29 | 28 | -7.0, -1.6 / -4.5 |
| B step, 37.667 (contact 37.665) | A step, 37.688 (contact 37.678) | 21 | 13 | -5.1 / -1.0 |
| B step, 37.667 | Tick, 37.700 | 33 | 35 | -5.1 / -8.6 |
| A step, 37.688 | Tick, 37.700 | 13 | 22 | -1.0 / -8.6 |
| A step, 48.500 (contact 48.480) | Tick, 48.518 | 18 | 38 | -3.7 / -8.9 |
| A step, 54.208 (contact 54.200) | Tick, 54.237 | 28 | 37 | -10.9 / -23.5 |
| Tick, 54.237 | B step, 54.295 (contact) | over 60 | 59 | -23.5 / |
| A step, 56.354 (contact 56.344) | B step, 56.354 (contact 56.340) | 0 | 3.8 | -10.2 / -10.8 |
| A step, 56.917 (contact 56.906) | B step, 56.938 (contact 56.928) | 21 | 22 | -10.2 / -10.6 |
| A step, 57.813 (contact 57.808) | B step, 57.854 (contact 57.834) | 42 | 26 | |
| A step, 61.708 (contact 61.691) | B step, 61.729 (contact 61.724) | 21 | 33 | -3.5 / -2.3 |
| A rustle, 62.750 | B rustle, 62.800 | 50 | 50 | -3.3 / -1.9 |
| A turns in place, 33.200 | B rises out of the door, 33.200 | not planned today | | 0.0 / -2.4 |
| A and B lean, 62.000; shift together, 94.200 | | not planned today | | |

A and B steps within 30 ms: 4 pairs on print times (37.67, 56.35, 56.92, 61.71) and 4 on contact times (37.67, 56.34,
56.91, 57.81); within 50 ms, 6 and 5. The densest second holds 6 one-shot onsets either way: from 36.188 on print times,
from 36.172 on contact times.

### A.3 Numbers in the layers that are not derived from the data

- **Typed times.** The rustles 62.75, 62.8, 77.6 and 82.3, and their contact offsets 0.72 and 0.70. The creak's 0.55 s
  lead. The second settle at +0.38 s (the picture's settle is one 0.7 s dip, deepest at 29.35; the test copies 0.38).
  The run-down's 0.45 s (the picture fades the shake over 0.4 s). The tick loop's end at 75 and its 1.1 s start offset.
- **Typed places.** The door point, 0.3 m forward of the car's centre (`SHAPE.door` has the hinge at 0.95 and the latch
  edge at -0.15). The door side +/-0.92, a copy of `SHAPE.door.side`, which is not exported. The key point. The car's part
  offsets (intake 1.7 forward, exhaust 2.3 back and 0.4 aside, tyres at the centre): `CAR` exists in `world.js`, and
  `actors/car.js` and `scripts/lib/checks.js` read it, but the car layer does not, and `SHAPE.wheel` is unexported. The
  river's -12, -34 and 6 m. The bridge edges for the wind boost, copies of `BRIDGE.z0` and `z1`.
- **Other copies.** `5.3`, a copy of `SPEED_W`, which `world.js` does not export. The `light` and `puffy` people flags,
  which `PEOPLE` already describes.
- **Private or unexported.** The door law and the tick list are private in `layers/car.js`. `actors/car.js` does not
  export `SHAPE`, `doorOpen`, `steerDeg`, `settlePitch`, `idleLift`, `SETTLE` or `IDLE`.
- **Drift that has already happened.** `SOUND.md` says the ticks run "37.7 to 75"; the last tick is 71.179.

### A.4 Balance today

Raw RMS per layer with bus gains, no reverb, before normalization (dBFS):

| Shot | Car | Foley | Bed | Car or foley against the bed |
|---|---|---|---|---|
| 3 | -25.0 | | -33.3 | car +8.3 dB |
| 4 | -32.0 | | -33.9 | car +1.9 dB |
| 5 | -31.3 | -38.6 | -34.0 | |
| 6 | | -45.8 | -33.0 | foley -12.8 dB |
| 7 | | -38.4 | -33.1 | foley -5.3 dB |
| 8 | | -45.0 | -30.4 | foley -14.7 dB |
| 9 | | | | foley -8.3 dB |

Foley peaks: -15.2, -11.7, -20.5 and -13.7 dBFS in shots 6 to 9; -9.7 in shot 5. RMS understates impulsive sounds
against a steady bed, which is why check 9 uses peak short-window levels.

Per-shot master loudness from the S8.3 mix, with the score in: shots 1 and 2, -21.2 and -19.7 LUFS; shot 3, -11.4 (the
loudest); shots 4 to 9, -16.1 to -18.6; shot 10, -14.4; shots 11 to 14, -15.9 to -16.7; shot 15, -17.1.

### A.5 Voices, by definition

| Definition | Count |
|---|---|
| Spatializers created | 96: 5 continuous, 19 car one-shots, 72 foley one-shots |
| Spatializers processed in one block (wind and city are not spatialized) | Peak 8, at 32.04 |
| Sounding sources at 36.23 | 9 (wind, city, hum, river, intake, exhaust, key, A's step, B's step); 10 with the car's silent tyre spatializer; 12 if wind and city also count as stereo pairs. That 12 is also reached at 32.04 |
| One-shot onsets in the densest second | 6, from 36.188 (print times) or 36.172 (contact times) |

Sound 1 fixes one definition (3.13) and reports every time its peak is reached.

---

## Appendix B. Sources and their strength

Strength: **primary** means read here in a cloned source; **secondary** means a summary or a reviewer's citation, not
checked against the full text; **excerpt** means seen only in a search result; **inference** means drawn from code, not
stated by it.

| Claim | Used in | Source | Strength |
|---|---|---|---|
| The SPU has 24 voices | 3.13, check 12 | psx-spx `docs/soundprocessingunitspu.md` lines 73 to 76 | Primary |
| 512 KB sound RAM; the first 4 KB are capture buffers; the reverb work area runs to the top | Sound 4.5 | psx-spx lines 51 to 58 | Primary |
| Reverb work area per preset: Room 9.7 KB, Studio A 7.8, Studio B 18.1, Studio C 28.0, Hall 43.5, Space 61.7, Echo and Delay 96.1, Pipe 15.0 | Sound 4.5 | PsyDoom `game/PsyQ/LIBSPU_Resources.cpp` lines 366 to 377 (base addresses; size is (0x10000 - base) x 8 bytes, my arithmetic) | Primary |
| One global reverb; each voice on or off (EON); a fixed reverb formula | 3.13, 3.14 | psx-spx lines 893 to 905 and "SPU Reverb Formula" (line 921) | Primary |
| One noise frequency for every noise voice; a random ADPCM sample as the workaround | 4.4 | psx-spx lines 583 to 598 | Primary |
| ADPCM in 16-byte blocks of 28 samples | Sound 4.5 | psx-spx lines 10 and 804; 28 is 14 data bytes x 2, my arithmetic | Primary |
| Silent Hill: 36 per-area reverb depths | 3.13 | SH decompilation `src/bodyprog/sound/sound_data.c` line 31 | Primary; their use per area unverified |
| Metal Gear Solid: footprints as a demo effect | 3.13 | MGS decompilation `source/kojo/demoexec.c` line 774, `demo.h` line 35 | Primary; the sound side unverified |
| MGS demos pre-mix their effects into one stream (Model A) | 3.13 | The PS1 research notes | Inference, unconfirmed |
| FF7, RE2 and Vagrant Story trigger effects as separate voices (Model B) | 3.13 | The PS1 research notes | Excerpt |
| Silent Hill: level from the distance to the characters, pan from the camera | 3.6 | The PS1 research notes | Inference; offered as an A/B only |
| MGS reaches full pan only past about 2.4 m | Not used | The PS1 research notes, no file or line recorded | Unverified; dropped as a bar |
| Cut perspective only on a significant distance change; over-cutting is a bad habit | 3.6 | Boom Box Post | Excerpt |
| A background has no on-screen elements; ambiences are automated for story | 1.4, 3.5 | Boom Box Post | Excerpt |
| Drive-ins and arrivals are cues of their own; do not fake distance on an on-board sound | 3.10 | Boom Box Post, vehicle checklist | Excerpt |
| Murch: an encoded to embodied spectrum; about two and a half elements of one kind can be followed, about five when spread across the spectrum | 3.12, check 11 | Murch, "Dense Clarity, Clear Density", via summaries (icaudiodesign, a White Rose thesis); Transom not opened | Secondary |
| A sound map as a timeline of which group carries each beat (Sonnenschein); hyper-real or impressionistic (Finan) | 1.3 | Search results | Excerpt |
| Make one crucial scene work early (Randy Thom) | 3.17 | Search results | Excerpt |
| Games test dialogue as subtitles before any audio exists | The spotting reel | Search results | Excerpt |
| Lip-sync detectability: audio early from about 45 ms, audio late from about 125 ms | 3.3, 3.15, check 4 | ITU-R BT.1359, widely quoted figures | Secondary |
| Forward masking up to about 200 ms; backward 5 to 20 ms | Check 8 | Psychoacoustics texts (Zwicker and Fastl), from memory | Secondary; starting values only |
| Minimum subtitle event 5/6 s (20 frames at 24 fps) | 3.16 | Netflix timed text style guide (backlothelp.netflix.com, article 215758617) | Secondary |
| Caption the essential sound; name the source only when not visible; do not re-source a continuing sound | 3.16 | DCMP Captioning Key | Secondary |
| YouTube turns loud uploads down to about -14 LUFS and does not turn quiet ones up | 3.18 | productionadvice.co.uk, youlean.co | Secondary |
| Fresh snow absorbs sound | 3.13 | General acoustics | Common knowledge, not measured here |
