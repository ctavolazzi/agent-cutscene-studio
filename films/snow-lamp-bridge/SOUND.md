# Snow, Lamp, Bridge: sound design

> **Superseded, 2026-10-24.** This was the first pass (BUILD_LOG Stage 8), made without a storyboard or a blockout.
> The sound now runs through gated stages: `SOUND-PLAN.md` (the plan) and the Sound stages in `ROADMAP.md`. Its cue
> table below is history; from Sound 1 the cues live in `src/audio/cues.js`, derived from the picture's data.

The film was silent by its first brief. Stage 8 gives it a soundtrack made the way the picture is made: synthesized
in code (no recorded samples), seeded, deterministic to the byte, timed by the same data that times the picture, and
placed in stereo by the camera of each shot. The engine is in `src/audio/` (contract in `src/audio/mix.js`); levels and
tunings live in `config.audio`.

## The feel

A cold, quiet night: the hush of snow, wind that picks up on the bridge, a city far off, the lamp's faint buzz up close.
The car is the only loud thing, and when it stops the world goes back to quiet. Every sound is small and close: boots
in snow, a door, a lighter, a breath. The score enters only after the car is dead and the two of them stand in the lamp
light, stays under everything, opens up at moonrise, and resolves on the last wide. PS1 flavour: a short, slightly
metallic reverb (the SPU's), a music bus bandlimited like 22 kHz samples, sounds that are simple and a little stylized
rather than realistic. Never harsh: nothing clips, nothing clicks at a cut.

## Engine facts the layers rely on

- 48 kHz stereo, one pass front to back in blocks of 256; a layer's `process(L, R, i0, n)` adds into its block.
- `ctx.spatializer(place, law)` places a mono voice: `place(t)` returns a world point `[x, y, z]` (or null) and the
  voice is panned, levelled and low-passed (air, behind the camera) from the camera at t. The distance law is
  `(refDist / dist) ^ rolloff`: physical (1.5 m, 1) by default; the car uses (3 m, 0.6) and the foley (2.5 m, 0.7), the
  way a film mix keeps its loud and its intimate sounds readable across the set.
- `src/audio/events.js` schedules one-shots (`{ t, dur, place, make, law }`), each with its own voice and spatializer
  only while it sounds, and `grains()` builds crunches and crackles from seeded decaying ticks with the first at 0.
- Buses `amb`, `fx`, `music` (levels in `config.audio.buses`), a reverb send per layer, master highpass at 35 Hz, the
  picture's 3 s fade in and a 1.5 s fade out, then normalization to -16 LUFS integrated under a -2 dBFS ceiling on the
  true peak (4x oversampled), corrected and limited again until the limited mix reads the target.
- Seeded randomness: `ctx.rngFor('audio:<layer>:<what>')`. No `Math.random`, no clocks.
- Raw levels: write each layer so its loudest moments peak around -12 to -6 dBFS raw at a close camera; the mix pass
  sets the final balance with the bus and layer gains.

## Cue sheet (seconds; from src/world.js, src/fx/footprints.js and src/shots.js)

| Time | Event | Layer |
|---|---|---|
| 0 to 3 | fade in from black: wind, city, lamp hum (shot 1 is close on the lamp) | ambience |
| 14.0 | the car appears far east on the cross street at 5.3 m/s (x 38.7, z 17.5), engine at a cruise | car |
| 19.04 to 20.60 | braking for the corner, 5.3 to 3.4 m/s | car |
| 20.60 to 21.99 | the turn north into the bridge street | car |
| 21.99 to 29.0 | slowing to a stop at (2.2, 1.85), last metre very slow, the snow crunching slower under the tyres; the brakes creak from 28.45 | car |
| 29.0, 29.38 | the body settles on its springs, twice | car |
| 29.0 to 36.2 | engine idling | car |
| 30.5 to 31.1 | driver door opens (latch at 30.5, hinge during the swing) | car |
| 31.77, 32.04 | A's first boot, then the second (on the road snow) | foley |
| 32.0 to 32.6 | passenger door opens | car |
| 33.31 | B lands on both boots at once (one heavier crunch) | foley |
| 33.9 to 34.5 | driver door shuts (thunk and latch at 34.5) | car |
| 35.0 to 35.6 | passenger door shuts (thunk at 35.6) | car |
| 36.2 to 36.65 | engine off (key click at 36.2, a 0.45 s run-down with a misfire or two), headlights off | car |
| 37.7 to 75 | hot metal ticks, further apart as it cools | car |
| 31.77 to 61.71 | 64 prints: A 35, B 29, at the exact times in `footprintList()` (17 on the road, 33 on the sidewalk, 14 on the deck); 63 steps, as B's two boots at 33.31 make one. A quick step rolls onto its toe quickly | foley |
| 40 | the score enters, very soft, as they stand in the lamp light (shot 6) | score |
| 54 to 62 | onto the bridge: wind rises, the river below comes up | ambience |
| 62.75 to 63.75 | both lean on the parapet: A's wool coat, B's nylon jacket, forearms landing at 63.47 and 63.5 | foley |
| 77.6, 82.3 | A's coat as A turns into the lee to cup the flame, and back | foley |
| 68 to 76 | moonrise: the score opens up (the main melody) | score |
| 78.6 | the lighter: the wheel's rasp on the flint, sparks, the flame catches; flame flutter with `lighterFlicker(t)` until 80.1, then the button let go | foley |
| 80.2, 89.2, 97.0 | drags (0.8 s each): a soft inhale and the paper crackling, louder with `emberLevel(t)` | foley |
| 90.0 | A exhales (smoke for 2.8 s): a long breath out | foley |
| 100 to 112 | the last wide: the score resolves; the fade out over the last 1.5 s | score |

Places for the spatializer: the car from `carAt(t)` (engine at the front, exhaust at the rear, y about 0.3); doors at
the car's sides (driver x - 0.92, passenger x + 0.92 about 0.3 m ahead of centre); footsteps at each print's (x, y, z);
the lighter, drags and breath at A's `cup`, `tip` and `mouth` from `makePoser('A')` and `bodyToWorld`.

## The score

An original cue, about a minute of music in total, no melody before the car is gone. D Dorian, slow, no fixed tempo:
chords change on shots. Instruments, all synthesized: a soft pad (two detuned saws, low-passed near 1.2 kHz, 2 s attack,
3 s release), a bell (two-operator FM, about 1:3.5, decaying index), a sine sub an octave below the root. The music bus
is low-passed near 9 kHz (the feel of 22 kHz samples) and sent to the reverb.

| Time | Chord (voicing) | Notes |
|---|---|---|
| 40 to 46 | Dm(add9): D3 A3 E4 F4 | enters from nothing over 4 s, very quiet |
| 46 to 54 | Bbmaj7: Bb2 F3 A3 D4 | |
| 54 to 60 | Fmaj7/A: A2 F3 C4 E4 | |
| 60 to 68 | Gm9: G2 D3 F3 A3 Bb3 | the lean |
| 68 to 76 | Dm(add9) then Bbmaj7 at 72 | moonrise: bell melody A4 D5 E5 F5 E5 D5 C5 A4, one note every 1 s from 68.5 |
| 76 to 89 | Gm(add9) held, thinned to the pad alone | under the lighter and B's look: quiet |
| 89 to 100 | Bbmaj7 then Fmaj7 at 94 | soft bell answers: F5 E5 D5 at 91, 93, 95 |
| 100 to 112 | Gm7 at 100, A7sus4 at 104, D major (D3 A3 F#4 A4) at 107 held to the end | the melody once more, A4 D5 E5 at 101, 102.5, 104; the last chord rings into the fade |

## In the player and in the export

- The player (`dist/index.html`) renders the soundtrack in a worker (`src/audio/worker.js`) as the page opens. The
  Sound button (or M) plays it once rendered; browsers start audio only from a click or a key. While it plays, the
  picture's time is the audio clock's, less the output latency, so picture and sound cannot drift; a seek, a pause
  or a shot button restarts the sound at the picture's time. Chromium renders the same samples as Node to within one
  float32 step on 161 of 10.75 million samples (the last bit of a math function), bit-identical everywhere else.
- `npm run export` renders `out/sound.wav` (`scripts/sound.js`), then the capture muxes it as AAC-LC 48 kHz stereo at
  320 kb/s, trimmed to exactly the captured frames (`--audio`). `npm run verify` renders the soundtrack again and
  compares the WAV byte for byte, then cross-correlates the MP4's decoded audio with it in three windows (lag 0),
  and checks the loudness (within 0.3 LU) and ffmpeg's true peak (at or under -1 dBTP).

## Checks (each with a planted fault)

`tests/audio.test.mjs` (the engine) and `tests/sound-layers.test.mjs` (the layers):

- Determinism: two renders give the same bytes; another seed gives another soundtrack.
- Loudness: the meter agrees with ffmpeg's ebur128 within 0.2 LU; the master lands at -16 LUFS; the true peak (ffmpeg)
  is at or under -1.5 dBTP; normalize holds the target on a signal with bursts that need limiting.
- Timing: the settle, every door and the key, every footstep (per person, so A's and B's never mask each other), the
  lighter and every bell note start within one frame (1/24 s) of their cue in their layer's stem; the same schedule
  three frames early does not match.
- Placement: window by window, the car's stereo balance is the pan the camera predicts, within 0.5 dB; swapped
  channels fail.
- Silence: no car before 14 s, no engine after its run-down, no score before 40 s (a planted sample at -80 dBFS is
  found).
- Presence: the lean, each drag and the exhale rise 20 dB over the moment before them; a window with nothing
  scheduled does not.
- Balance, as the brief has it: the car over the bed by 6 LU while it drives and its idle 6 LU under its drive; the
  score creeping in 6 LU under the bed and opening 3 LU at moonrise; the footsteps reading over the bed.
- Cuts: no click at any shot boundary (the master's sample-to-sample step at a cut is within its neighbourhood's range).
