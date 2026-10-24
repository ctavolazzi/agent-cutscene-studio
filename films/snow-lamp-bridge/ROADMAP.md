# Snow, Lamp, Bridge: the work plan, step by step

Companion to `PLAN.md` (what and why) and the brief. This file is the how: every stage, every sub-step, what goes in,
what comes out, how it is checked, and what you decide at each gate. It is updated when a stage changes the plan.

Conventions used throughout:

- **Round folders.** Every gate puts its images and a `notes.md` in `review/round-NN/`, numbered continuously (01 is Stage 1).
  (Correction, 2026-10-24: in practice Stages 3 to 7 shared `review/round-03/`, which holds the finished film;
  round-04 onward belong to the sound stages below.)
- **Gate package.** The same four things every time: the round folder, a private Artifact page for your phone, a commit on
  `claude/snow-lamp-bridge-scene-kyov3c`, and an updated draft PR (#13). I never watch the PR.
- **Self-review.** Before a gate I open every image I render, write the specific problems in `notes.md`, then fix them.
  At most three rounds per stage, then I stop whether or not everything is fixed, and say what is left.
- **Source of truth.** `src/set.js`, `src/world.js`, `src/shots.js`. The storyboard, the 3D scene and the checks all read them.
  A change to staging is a change to one of those files, never to a drawing or a render.
- **Standing rules.** No em or en dashes anywhere (a scan runs before every commit). No `Math.random`, `Date.now` or
  `performance.now` in `src/` outside the playback clock (a scan will run before every commit from Stage 2 on).
  Nothing important in the bottom 120 px of the 1080p frame.

---

## Stage 0: Plan (done)

0.1 Read the whole brief.
0.2 Check the machine: node, ffmpeg, Chromium, three.js version, headless WebGL2, per-frame cost, H.264 round trip, colour tags.
0.3 Work the geometry of the set against the shot list and record the contradictions.
0.4 Write `PLAN.md`: understanding, changes, technical approach, risks, five questions.
0.5 Commit, push, open the draft PR.

**Gate 0 outcome:** you said to start using the defaults.

---

## Stage 1: Sketches and storyboard (done, waiting on you)

1.1 Project scaffold: `package.json` with exact pins, `npm install`.
1.2 Data files: `set.js` (layout), `world.js` (car, people, moon, lights as functions of time), `shots.js` (15 cameras, lenses, timing, a framing solver).
1.3 Checks on the data: car hidden behind the corner, screen direction, side of the 180 degree line, cut angles and size steps, safe strip, landmark positions.
1.4 Drawing layer that writes both SVG and Excalidraw JSON from one list of shapes.
1.5 Top-down map with car path and time marks, both people's paths, every camera with its wedge and move arrow, the 180 degree line, the moon bearing.
1.6 Three detail maps (arrival, bridge, railing) so the crowded parts can be read.
1.7 Fifteen panels: true-perspective sketches through each shot's lens, thirds, safe strip, move arrows, inset frames for the beats a single frame cannot show.
1.8 Contact sheet (`storyboard/index.html`) and `report.json`.
1.9 Self-review, three rounds, twelve fixes (listed in `review/round-01/notes.md`).
1.10 Round trip `map.excalidraw` through Excalidraw's own loader.
1.11 Gate package: `review/round-01/`, the Artifact page, commit, PR.

**Gate 1, what you decide:**

| # | Question | Default |
|---|---|---|
| 1 | Moon rises due east (84 degrees) or east-north-east (67.5, the brief) | 84 |
| 2 | A crossing in front of the car as the headlights die: off screen or shown | off screen |
| 3 | Shot 2 with the corner building as the second block on the right | OK as is |

Plus any markup on the panels or the map.

---

## Stage 2: Blockout

**Goal.** Prove the timing, staging and cameras in real 3D before any look work. Grey boxes, real clock, real cuts.
**Inputs.** The three data files after your Gate 1 notes.
**Outputs.** `review/round-02/`: 45 stills (first, middle, last frame of every shot), one contact sheet, `preview.mp4` at 480x270, `notes.md` with the measured frame cost.

2.1 **Vite skeleton.** `index.html`, `vite.config.js` with the single-file plugin, `src/main.js`, `src/config.js`.
    Check: `npm run build` makes one HTML file, and it opens from `file://` with no server and no console errors.
2.2 **Clock and modes.** Playback mode: real time drives `renderAt`, quantized to 1/24 s ticks (config switch for native rate).
    Capture mode (`?capture=1`): nothing advances; `window.renderAt(t)` is the only way a frame is drawn.
    Check: the determinism test from Stage 0 (scrambled times rendered twice, byte-identical) runs against the built file.
2.3 **Cameras from `shots.js`.** `cameraAt(shot, t)` becomes a three.js `PerspectiveCamera`: vertical FOV from the lens, position, look-at, roll. Hard cuts at the shot boundaries.
    Check: the camera at each shot's sketch time projects the landmarks to the same screen fractions as `report.json` (tolerance 0.01).
2.4 **Grey set from `set.js`.** Ground, road, sidewalks and curbs, bridge deck, both parapets, every building and city box, the river plane, the lamp post, a moon disc.
    Check: a still from camera 2 and camera 15 matches the storyboard panel in layout.
2.5 **Car.** A box with four wheels from `carAt(t)`; two hinged door boxes keyed from the door times.
2.6 **People.** Capsule, head sphere and a nose cone for facing, from `peopleAt(t)`, at their real heights; a simple lean offset for the rail poses.
2.7 **Lights, untuned but all present.** Hemisphere, lamp spot, two headlight spots, moon directional, lighter point, ember point. Intensities from `headlights(t)`, `moonlight(t)`, `lighterOn(t)`. Light count never changes after load.
2.8 **Snow placeholder.** `Points` with a minimal shader, seeded, position a pure function of `t`.
2.9 **Fade from black** over the first 3 s as a full-screen quad.
2.10 **Debug overlay.** Shot number, time, camera label. Burned into the preview; toggled off for stills when asked.
2.11 **`scripts/stills.js`.** Loads the built file with `?capture=1`, calls `renderAt` for a list of times, saves PNGs.
2.12 **`scripts/contact-sheet.js`.** Tiles stills into one labelled image.
2.13 **`scripts/capture.js`, preview profile.** Frame loop into ffmpeg at 480x270, fast settings. The full profile is added in Stage 5.
2.14 **Measure.** Milliseconds per frame and total capture time in software rendering. Written into `notes.md`.
2.15 **Self-review.** Every still against its storyboard panel: framing, staging, timing, eyelines, screen direction. The checks from Stage 1 re-run on the 3D cameras. Up to three rounds.
2.16 **Gate package.**

**Gate 2, what you decide:** pacing from the preview (which shots run long or short), staging you want changed, whether a single low-res lamp shadow map is worth proposing (I will say if the blockout suggests it).

**Risks.** The lamp pool may not cover both the car doors and the lean spot at radius 7 m; if so I move the lamp 1.5 m north and say so. (Correction, 2026-10-22: north is away from the car doors; a move that helps them goes south. See `review/round-02/notes.md`, Corrections.) Software rendering is slow, so the preview capture may take several minutes; that only matters for how long you wait, not for the result.

---

## Stage 3: Revisions from the blockout

**Goal.** Fold in your Gate 2 notes and what the blockout itself revealed, and keep the storyboard true.
**Outputs.** `review/round-03/`: new contact sheet, new preview, `notes.md` with a before-and-after table of every timing or camera change.

3.1 Read your notes and list each one as an item with a file it touches.
3.2 Apply the items to `shots.js`, `world.js` or `set.js`.
3.3 Pacing pass from the preview: shots that drag or rush, moves that feel unmotivated, cuts that jump. Change the data, not the renders.
3.4 Re-run the data checks.
3.5 Regenerate the storyboard (`npm run storyboard`) so the map and panels match the new data.
3.6 Re-render stills, contact sheet and preview.
3.7 Self-review and gate package.

**Gate 3, what you decide:** sign off on timing before the look work starts, since changing timing later is cheap but changing staging after the rigs exist is not.

---

## Stage 4: Look development

**Goal.** The real PS1 look and the real assets. Still images only; animation detail waits for Stage 5.
**Outputs.** `review/round-04/`: eight key stills, each at 1920x1080 and 384x216 side by side, plus the banded-light comparison for the lamp shot, and `notes.md`.

4.1 **PS1 material patch** (`src/ps1/material.js`). `onBeforeCompile` on `MeshLambertMaterial`: vertex snap to the internal pixel grid after projection (strength 0 to 1), affine UV warp (strength 0 to 1), shared uniforms, a custom program cache key.
    Check: a test quad shows visible wobble at strength 1 and none at 0.
4.2 **Final pass** (`src/ps1/post.js`). Scene into a 480x270 half-float render target, then one full-screen pass: linear to sRGB, 5 bits per channel, 4x4 Bayer dither. The canvas is upscaled 4x with nearest-neighbour. Both values come from `config.res`.
    Check: switching config to 320x180 gives a 6x upscale with no other edits.
4.3 **Config** (`src/config.js`). Resolution, fps, snap and warp strengths, dither on or off, fog colour and density, every light's colour and intensity, drift on or off, the 24 fps tick switch.
4.4 **Procedural textures** (`src/textures.js`). Canvas-drawn, 64 or 128 px, nearest, no mipmaps, seeded: snow, asphalt, brick, plaster, concrete, window grid (emissive), car paint, coat and jacket fabric.
4.5 **Set detail.** Lamp post with lantern head; parapet with chamfered top; buildings and ground subdivided to about 1 m; city boxes with emissive windows and two blinking aircraft lights; river plane with jittered reflection quads; a starfield; a crescent moon sprite.
4.6 **Fog.** `FogExp2`, dark blue-black. City materials carry a weaker fog of their own so the skyline stays a hazy band.
4.7 **Lights tuned.** Lamp colour near #FFB46B, angle and penumbra for a visible 7 m pool; headlights; the moon ramp; a very low hemisphere. Values in photometric units in `config.js`.
    Check: the lamp reads as the main light; the pool covers the car doors and the lean spot.
4.8 **Glow and beams.** Additive cards for the bulb, headlights and taillights; a faint cone under the lamp; faint cones ahead of the headlights.
4.9 **Blob shadows** under the car and each person.
4.10 **Finished snow.** Three depth layers, a camera-following volume, layered sine drift, brightness in the shader from the lamp cone, the headlights and the moon.
    Check: in the shot 1 still, flakes are visibly brighter inside the cone than outside it.
4.11 **Character rigs** (`src/actors/rig.js`). The primitive hierarchy from the brief, A and B as distinct silhouettes (B's beanie and scarf lighter than A's coat), a small two-bone IK helper for feet, forearms and the hand to the mouth. Posed, not yet animated.
4.12 **Car model.** Three-box sedan, dark green-black, wheels, hinged doors, emissive lenses.
4.13 **Eight key stills.** Shots 1, 3, 4, 5 (just after the headlights cut), 6, 10, 11, 15. Each at full size and phone size side by side. Plus the lamp shot twice: smooth lighting and banded lighting, for your call.
4.14 **Self-review against the brief's questions.** Is the lamp the main light? Does the snow glow inside the cone? Do the headlight sweeps read? Is the moon a soft backlight, not a flat fill? Is the city visible but hazy? Does the look read as intentional and moody?
4.15 **Gate package.**

**Gate 4, what you decide:** smooth or banded light; snap strength (I will show 1.0 and 0.5); any colour or exposure notes; whether the characters' silhouettes read at phone size.

**Risks.** Five-bit colour on a dark scene leaves few levels; banding and dither crawl are the thing to watch. Nearest-neighbour upscaling plus YouTube's re-encode is the reason the 4K export exists.

---

## Stage 5: Animation and render test

**Goal.** Finish every animation and effect, then run the real export and verify it.
**Outputs.** `review/round-05/`: the full MP4, the HTML, `verify` output, a contact sheet, `notes.md` listing anything that pops, slides, clips or reads poorly at phone size.

5.1 **Car.** Wheel rotation from distance over radius, steering from path curvature, body settle at the stop, idle vibration that ramps to zero at the shut-off, door hinges, light fade over 0.4 s.
5.2 **People.** Step out of the car (foot first, then the body rises), close the door, a distance-driven walk with weight and arm swing, stop at the rail, lean with forearms on the top (IK), head turns from `look`, cup the hands, lift the cigarette and lower it, a small exhale, the shoulder lean at the end.
    Check: feet never slide (a script samples foot positions during plants and reports any drift over 2 cm).
5.3 **Footprints.** Decals with birth times from the walk's planting phases; a decal shows once `t` passes its birth.
5.4 **Lighter and ember.** A flickering point light and flame sprite for 1.5 s; an ember point and light that brighten on each drag.
5.5 **Smoke.** Additive sprite puffs from `smokePuffs(t)`, lit warm by the lamp and cool by the moon, gone within 3 s.
5.6 **Moon.** Elevation from `moonAt(t)`; the directional light ramps over 8 s once it clears the haze.
5.7 **Playback UI** in the HTML. Play and pause on click or space, a scrub bar, a shot list, the debug toggle, letterboxed fit with nearest-neighbour upscaling.
5.8 **`npm run export`.** Build once, then capture from the built file over `file://`: 1920x1080, 24 fps, H.264, `yuv420p`, `-crf 16 -preset slow -tune animation`, `+faststart`, BT.709 tags, no audio. `npm run export:4k` is the same capture at 8x.
5.9 **`scripts/verify.js`.** `ffprobe` (duration, size, rate, codec, pixel format, tags, no audio, faststart); frame match (decode frame N, sample each 4x4 block, compare with a fresh `renderAt(N / 24)`: mean error 2.5 or less, PSNR 40 dB or more); scrub test at five positions; a 10 s smoothness timing.
5.10 **Determinism test** against the final build.
5.11 **Self-review.** Sample frames across the whole MP4 (every 2 s, plus the key beats), check at phone size, write the list.
5.12 **Gate package.**

**Gate 5, what you decide:** how playback feels on your own GPU (I cannot judge that here), what to polish, and whether the frame-match tolerance is tight enough for you.

**Risks.** The full capture in software rendering may take a while; I will report the real time. Cross-machine float differences can flip a dither pixel; the tolerance covers that.

---

## Stage 6: Polish rounds

Repeated as needed. Each round:

6.1 Turn your notes into a numbered list with the file each item touches.
6.2 Fix, re-run the checks and the determinism test.
6.3 Fresh MP4, contact sheet and `notes.md` in `review/round-NN/`.
6.4 Gate package.

---

## Stage 7: Final export

7.1 `npm run export` once, from a clean build. Both deliverables come from the same build.
7.2 `out/stills/`: one full-resolution PNG per shot at its best frame (the times live in `config.js`).
7.3 `out/thumbnails/`: three 1280x720 candidates from the strongest frames (likely the reveal, the lighter close-up and the final wide), clear space for a title, no text. Each checked at 320 px wide.
7.4 `out/README.md`: how to re-export, what every config value does, the final shot list with timings.
7.5 Commit everything except files over about 25 MB (the MP4 may be one; I will say where it is).
7.6 Update the PR and stop.

**Done means** (from the brief, checked one by one in `notes.md`): fades in from black, ends on the final wide, no audio track; every beat on screen in order; the lamp lights the snow and the ground; the headlights sweep the buildings and cut out; the moon rises and backlights; the railing is wide, concrete and chest high, leaned on with forearms; the 180 degree rule holds with no jump cuts; MP4 and HTML show the same frames; readable at phone size; nothing important in the bottom 120 px.

---

## Where connectors fit

| Connector | Used for | When |
|---|---|---|
| GitHub | the draft PR, updated at every gate | every stage |
| Artifact viewer | a private review page for your phone at every gate | every stage |
| Artifact comments | your markup on a review page reaches me | any gate |
| vidIQ | scoring the three thumbnail candidates, if you want it | Stage 7, on your word |
| vidIQ or YouTube | upload | only if you ask |

Everything that builds the scene is local: three.js, Vite, Playwright and ffmpeg.
---

## Sound stages (effects first)

**Why these stages exist.** You asked for sound effects to go through the same gated process as the picture. Stage 8
in `BUILD_LOG.md` (S8.0 to S8.3) is history: it went from a cue table straight to finished layers. The sound restarts
here at Sound 0. The what and the why are in `SOUND-PLAN.md`; its table 1.2 maps every picture stage and artifact to
its sound counterpart.

**Conventions**, in addition to the ones at the top of this file:

- **Names.** Sound 0 to Sound 6; steps "Sound 1.4"; gates "Sound gate 1". BUILD_LOG headings read
  `### Sound <stage>.<step>  Title`, so they never collide with the picture's S1.x, S2.x or the first pass's S8.x.
- **Scope.** Sound effects only: backgrounds, ambiences, hard effects, foley. The score is parked
  (`config.audio.parked: ['score']`): kept in the code, out of the mix.
- **The score comes back.** Effects run Sound 0 to Sound 3. The score's own plan starts after Sound gate 3 and runs
  beside effects Sound 4, as stages of its own (Score 0 onward, with its own gates). Sound 5 mixes both, and Sound 6
  ships one soundtrack with both.
- **Source of truth.** The picture's data files stay the truth: `src/set.js`, `src/world.js`, `src/shots.js`, the actors
  and `src/fx/footprints.js`. `src/audio/cues.js` is derived from them and never hand-edited for anything the picture
  knows. A change to a sound's time or place is a change to a derivation in `cues.js` (or, by your decision only, to the
  picture's data), never to a drawing, a layer or a test.
- **The picture is locked.** A sound finding that needs a picture change comes to you as a decision.
- **Round folders.** They continue the film's series: round-04 is the sound storyboard, round-05 the blockout, round-06
  the revisions. From Sound 4, rounds take the next free number in the order they are made, whichever track (effects or
  score) makes them.
- **Gate package.** The same four things every time: the round folder, a private Artifact page for your phone, a commit
  on `claude/snow-lamp-bridge-sound`, and the updated draft PR, which I never watch.
- **Stops.** You asked for the plan and then the blockout, so Sound gates 0 and 1 run on their defaults and their
  questions travel with Sound gate 2, the first stop. From Sound 3 on I keep building and stop only for what is yours:
  the style frame (Sound gate 4), the listen (Sound gate 5), publishing (Sound gate 6).
- **Checks.** Every new check ships with a planted-fault control. Every bar is set from a measurement, or labelled as a
  starting value until one exists. `npm test && npm run check` pass before every commit (and in `template/` when it
  changes).
- **Loudness and peaks (my call, stated here, not a gate question).** From Sound 5 the mix is anchored on the hush: the
  street background at a short-term loudness set by ear on the style frame. Integrated loudness is reported and kept at
  or under -16 LUFS rather than raised to it. Three true-peak bars: -2.0 dBFS on the limiter's 4x estimate, -1.5 dBTP on
  the WAV (the test), -1.0 dBTP on the AAC (verify). Until Sound 5 every level is compared relative to the background,
  since parking the score moves the normalization.

---

## Sound 0: Plan (done)

**Goal.** Plan the sound effects from the picture's own data, before anything is drawn or made.
**Inputs.**
- The locked picture data.
- The S8 engine and layers (`src/audio/`), their tests, `SOUND.md`, BUILD_LOG S8.0 to S8.3.

**Outputs.**
- `SOUND-PLAN.md`.
- These stages in `ROADMAP.md`, with the round-folder correction above.
- A superseded note in `playbook/process.md` ("Stage 5.5: Sound") and `template/ROADMAP.md`, and the same one-line
  pointer in the root `CLAUDE.md`'s Sound paragraph, each pointing at `SOUND-PLAN.md`.
- A `Sound 0` entry in `BUILD_LOG.md`.

Sound 0.1 **Spotting session from the data.** Every cue's time, place, distance, pan and on- or off-screen state from
    each of the 15 cameras: the visible actions with no sound, the sounds with no visible source, the cut jumps and the
    near coincidences, on print times and on contact times bisected from the rig.
    Check: my listener equals `spatial.listenerAt` exactly; the rebuilt tick list matches the rendered car stem to
    within 0.03 ms; the contact times lead the print times by 0 to one print step (20.8 ms).
Sound 0.2 **Inventory of the sound code.** The engine contract, every cue each layer plays and where its timing comes
    from, what each test pins (including the score assertions mixed into three tests), and what depends on the score.
    Check: every copied number is listed with its file and the data value it copies.
Sound 0.3 **Map the picture's process onto sound.** Each picture stage and artifact, paired with its sound counterpart.
    Check: `SOUND-PLAN.md` table 1.2 has a row for every picture stage from plan to final, each with its counterpart or
    a stated reason for none.
Sound 0.4 **Research.** Film practice (spotting, backgrounds and ambiences, point of audition, perspective at cuts,
    density, silence, captions, sync tolerance) and PS1 audio (the SPU, the reverb presets and their work areas, how the
    games placed and budgeted sound).
    Check: every claim in `SOUND-PLAN.md` Appendix B carries its source and strength, with file and line for the cloned
    sources.
Sound 0.5 **Write `SOUND-PLAN.md` and these stages.** The four questions at the top, once.
    Check: the forbidden-character scan passes; every number traces to a measurement or is marked "to be measured".
Sound 0.6 **Gate package.** The superseded notes; the Artifact page, one card per question; commit and PR.
    Check: `npm test && npm run check` pass in the film and in `template/`.

**Sound gate 0, what you decide:** the four questions at the top of `SOUND-PLAN.md`, "Your decisions (one minute)":
the feel without the score; the engine stopping with both people outside; anything before the car; what gets
published. Built on the defaults; the questions come to you at Sound gate 2.

**What you do:** nothing yet. The four questions come with the blockout.

---

## Sound 1: Sound storyboard

**Goal.** Plan every sound effect on paper, from the data: where it is, when, how loud and where in the stereo field
from each camera. Every check is measured before any sound is made.
**Inputs.**
- Your Sound gate 0 answers.
- The picture's data, `src/audio/spatial.js` and the laws.
- The published 1080p export, for its frames.

**Outputs.**
- `src/audio/cues.js`.
- `scripts/sound-storyboard.js` and `scripts/lib/sound-checks.js`.
- `storyboard/sound/`: `map.svg`, four `map-detail-*.svg`, `map.excalidraw`, `timeline.svg`, `panels/shot-NN.svg`
  (15), `report.json`, `index.html`, `captions/review.vtt` and `review.srt`.
- The spotting reel.
- `tests/cues.test.mjs` and `tests/sound-checks.test.mjs`.
- `review/round-04/`: the reel, PNGs and `notes.md`.

Sound 1.1 **Export the picture facts the cues need, and measure the idle shake.** From `actors/car.js`: `SHAPE` (at
    least `door`, `wheel`, `body`), `SETTLE`, `DOOR_SIDE`, `STEER_MAX_DEG`, `doorOpen`, `steerDeg`, `settlePitch`,
    `idleLift`. From `world.js`: `SPEED_W`, `X_START`. Exports only; no behaviour changes. Then measure whether the idle
    shake reads on screen (question 2): the car's own vertices through the shot 5 camera and the snap grid, with and
    without `idleLift`, from 30.0 to 36.6, and a look at the published frames.
    Check: `check:determinism` and `check:cameras` pass, and verify's frame match against the published export is
    unchanged. The shake result is written in `notes.md` with the option it selects.
Sound 1.2 **`src/audio/cues.js`.** `makeCues(world)` and the families in `SOUND-PLAN.md` 4.1, with the Sound gate 0
    answers applied: contact times beside print times, causal leads, the 10 door cues, the arrival, the brake and
    steering, the place backgrounds and the story ambiences, the tick rule, the engine stop. The cloth contact
    definition is fixed here, with both readings at the lean (2 cm: 63.400 and 63.396; 1 mm: 63.480 and 63.479) and the
    reason for the choice.
    Check: the counts match the spotting session (63 steps from 64 prints, 10 door cues, the tick rule ending before
    68.0). Every derived time equals its source function (1e-9 s; 1e-6 s for bisected contacts). A second import gives
    an identical list.
Sound 1.3 **Starting levels from the level plan.** Each family's designed level comes from `SOUND-PLAN.md` 1.3 (the
    background as the reference; the car at least 6 LU over it while it moves on screen; the idle 6 LU under the drive;
    foreground foley peaks 6 dB over the background; midground 0 to 6 dB). Today's parked design stems are measured
    and shown beside the plan as a comparison column only.
    Check: every level is listed as a designed field, and the predicted per-shot margins meet the plan.
Sound 1.4 **`scripts/lib/sound-checks.js`.** The 15 checks in `SOUND-PLAN.md` 4.3: trace, onScreen, storyOrder,
    sync, stereoOrder, cutPerspective (with the hold rule and both listener models), approachRises, maskingPairs,
    maskingBed, flams, density, voices (with the allocator), silence, safeBand, straddle. Film-generic, with no film
    constants. Screen direction and pan width go into the spatializer tests instead, with the guard for sources near the
    listener's vertical axis.
    Check: each planted fault in `tests/sound-checks.test.mjs` fails as it should (today's load schedule fails
    approachRises), and the real data passes or fails with a listed finding.
Sound 1.5 **Traceability control.** `makeCues` against a perturbed picture, one input family at a time, each in a child
    process where a Node module hook serves a patched copy of `world.js`, `set.js` or `shots.js` to every importer
    (`SOUND-PLAN.md` 4.2).
    Check: every non-designed cue moves under exactly the perturbations its `derivedFrom` names, by exactly the shift
    where the derivation is a pure time shift; a cue that never moves is designed or rule-made; a planted literal-time
    cue and today's `RUSTLES` are caught. If a constant cannot be reached, stop and bring the picture parameter to you.
Sound 1.6 **Sound map.** Sources by family; the car path with time marks; prints labelled with contact times; the doors
    at latch and hinge; cup, tip and mouth; the hum at the lantern; the place boundary and the unplaced backgrounds; the
    180 degree line and the lamp pool. A listener glyph per camera: wedge, left and right axis, the shaded half-plane
    behind it, level rings per law.
    Check: the map reads only `cues.js`, `SHOTS` and `spatial.js`; a cue moved in the data moves on the map.
Sound 1.7 **Detail maps:** car arrival (shots 2 to 5), arrival (4 to 7), bridge (8 to 10), railing (11 to 15).
    Check: every label is readable at the PNG's size, and none covers another, by eye and by bounding-box overlap.
Sound 1.8 **Cue timeline.** One lane per source, shots as columns, level as envelope height against the background,
    pan as a line in the lane, on-screen spans as a bar, onsets as labelled ticks, the bed-only windows, "held for
    music" and the place change marked.
    Check: every cue in `cues.js` appears exactly once.
Sound 1.9 **Fifteen shot panels.** Each has the film's frame at the shot's middle, decoded from the published export,
    with the cues' screen points; the stereo field over the shot's duration with the lens's frame width at
    +/- sin(hfov/2); the listener mini map and the cue list.
    Check: each panel's cue points land where `project()` puts them on the decoded frame; the frame is the shot's own
    (by its time stamp).
Sound 1.10 **Review captions and the spotting reel.**
    - `review.vtt` and `review.srt` from `cues.js` under `SOUND-PLAN.md` 3.16: steps merged per walker per surface
      stretch, ids only in the soft tracks, off-screen cues in italics in the VTT, new cues marked "new", offered ones
      "offered".
    - The published 1080p picture with the review track as soft subtitles: video stream copied, audio dropped (`-an`),
      since `out/snowy-bridge.mp4` carries the S8.3 mix.
    - A silent 480x270 copy: the shot label in the top strip, the captions in their own band below it, the step lane
      under them.
    Check: each caption's in-time equals its cue's onset to the millisecond and its out-time is at least 0.833 s later;
    at most 3 lines at once; the video stream's MD5 is unchanged in the soft copy; nothing is drawn in the bottom 30 px
    of the 480x270 copy (120 px at 1080p).
Sound 1.11 **`report.json` and `index.html`.** The audit tables: cues per shot; the on-screen table (screen x against
    pan); storyOrder and sync; stereo order; perspective at each cut under both listener models; the arrival; masking
    pairs and masking by the background; flams; density and voices; silence, safe band and straddles; trace.
    Check: the page renders from disk, and every row links to a cue id that exists.
Sound 1.12 **Excalidraw round trip** of the sound map through Excalidraw's own loader, as in picture Stage 1.10.
    Check: element count in equals element count out.
Sound 1.13 **Self-review.** Watch the reel, open every drawing, and write the problems into `notes.md` before fixing.
    Up to three rounds.
    Check: every finding has a disposition (fixed, deferred with a reason, or a question for you).
Sound 1.14 **Gate package:** `review/round-04/`, the Artifact page (the reel first), commit, PR.

**Sound gate 1, what you decide:**

| # | Question | Default |
|---|---|---|
| 1 | From the spotting reel: any sound to add, drop or move. The new ones are marked "new", the offered ones "offered", and the silent-by-choice list is on the page | New ones in, offered ones out, nothing else changed |

Plus any markup on the map, the timeline or the panels, if you want to.

**What you do:** at Sound gate 2, watch the 112 s spotting reel. It has no sound: a caption for each planned sound,
new ones marked. Tell me any sound to add, drop or move. Everything else is my evidence.

**Risks.**
- Screen direction and pan width pass by construction under the pan formula, so they moved into the spatializer tests;
  the notes say which report checks are guards rather than findings.
- The module hook may not reach every constant; the fallback is a picture parameter, which needs your word.
- The idle-shake measurement decides question 2; if it is borderline, I show you the frames and both options.

---

## Sound 2: Sound blockout

**Goal.** Hear every planned cue as a placeholder over the finished picture, at its exact time, place and planned
level. Timing, placement, presence and density are judged before any sound is designed. Balance is reported, not
judged: placeholders have no real spectrum.
**Inputs.**
- Your Sound gate 1 answers.
- `cues.js` and the checks.
- The engine.

**Outputs.**
- `config.audio.stage` (default `'blockout'`) and `config.audio.parked` (default `['score']`).
- `src/audio/layers/blockout/` (`bg.js`, `hard.js`, `foley.js`).
- `tests/sound-blockout.test.mjs`.
- `scripts/sound-review.js`.
- `review/round-05/`: `preview.mp4` and `preview.mp4.json`; the captions, `stems/` and `measure.json`;
  `findings.json` and the audio stills; the arrangement sheet; `decisions/`; `notes.md`.

Sound 2.1 **Stage switch and parking.** `config.audio.stage` is `'blockout' | 'design'`; `index.js` builds its layers
    by stage, minus the parked ones. The sidecar gains `stage` and `parked` fields. Also fix `scripts/sound.js` (line
    26 builds a layer list from a `name` the modules do not export) and `lufsOf` (its comment says ungated, it calls
    the gated meter).
    Check: `'design'` with the score unparked reproduces today's `out/sound.wav` byte for byte (sha256 `f80b1542...`).
    `'design'` with the score parked has a silent music bus. `'blockout'` builds only the blockout layers.
Sound 2.2 **Tests changed honestly.**
    - The four score assertions are split out of their three mixed tests first, then guarded by the parking (the guard
      prints its reason); the lighter, car-silence and balance checks keep running.
    - `sound-layers.test.mjs` runs with stage `'design'` explicitly.
    - A new test proves the parking holds, with a planted enabled score.
    - `verify.js` check 5 treats a sidecar without `stage` or `parked` as "made before the switch, score in".
    - Screen direction, pan width and the vertical-axis guard join the spatializer tests.
    Check: every change is written in `notes.md` with its reason; no bar is relaxed without one; the full suite is green.
Sound 2.3 **Placeholder voices,** one timbre per family (`SOUND-PLAN.md` 4.4): band-limited noise bursts for steps,
    with a band offset per person and per surface; each voice with its own seeded noise; obviously temporary; pitch or
    level following the data where the table says.
    Check: each family's spectral centroid is distinct from the others by a margin set from the first measurement; two
    renders give the same bytes.
Sound 2.4 **Blockout layers read `cues.js` only.**
    Check: the Sound 1.5 perturbation, rendered, moves the measured onsets by the same amount. A scan finds no time
    literals in `layers/blockout/`.
Sound 2.5 **Measurement tooling,** added to `scripts/lib/audio-analysis.mjs`: stems by voice group; one-to-one onset
    matching and cue-end detection; the first frame that shows each sync event, from the picture's state functions at
    frame times; pan per cue from its stem window's balance; short-term loudness series (400 ms and 3 s); levels per
    third octave on peak short windows; the phone simulation and the mono fold-down.
    Check: planted faults are found: a cue 5 ms late, a cue one frame late against its picture event, swapped channels,
    and an onset that a nearest-match rule would hand to the wrong cue.
Sound 2.6 **Render and measure** into `measure.json`:
    - the renderer: onsets against cue times within 5 ms (a renderer and detector test, not sync);
    - sync with the picture: each sync cue's onset 0 to 45 ms ahead of its first showing frame, or its named lead
      (starting value); audio after the frame fails;
    - pan against the prediction: balance within 0.5 dB;
    - level against the background, and masking per band: reported, not gated;
    - the silence windows, voices and density, phone and mono.
    Check: two renders give the same bytes, and the stems rendered alone and summed equal the mix before the master
    stage.
Sound 2.7 **Drift of the parked design layers.** Today's design stems' onsets against `cues.js`, as a list.
    Check: the report exists and lists every drifting cue. It is not a pass bar: drift is expected until Sound 4.
Sound 2.8 **Preview.** `capture.js --profile preview --audio` (480x270) with the shot overlay, the blockout sound, and
    the review captions as a soft track and burned into their own band below the HUD strip.
    Check: ffprobe shows a video, an audio and a subtitle stream with the right duration; the capture's alignment lag
    is at most 2 samples; nothing is drawn in the bottom 30 px.
Sound 2.9 **Audio stills and the arrangement sheet.** Per shot: a spectrogram strip, predicted against measured level, a
    pan meter and cue markers. For the whole film: the arrangement, with measured onsets drawn over predicted ones.
    Check: every shot has its still; every cue marker sits on its measured onset.
Sound 2.10 **Self-review, then an independent panel.** My own pass first, written down before fixing. Then reviewers
    by shot group, with lenses for timing, placement, perspective, masking and density, story beats, and phone and
    mono. Then skeptics; the results go into `findings.json` in the picture's schema. Agents cannot hear, so every
    finding cites a measurement or an image.
    Check: every finding has a verdict and a disposition.
Sound 2.11 **Fix rounds,** at most three. Each round's plan is written before its changes.
    Check: the checks and `measure.json` are re-run after each round.
Sound 2.12 **Measure the options before asking.** The muffle on the hidden engine, done the PS1 way (a volume drop or a
    pre-filtered sample swap); a narrower pan for sync foley; the second listener model (level from the characters,
    pan from the camera); the style-frame scene. Each A/B is rendered and measured, with a short clip at its moment.
    Check: each option in the notes cites its measured difference. An A/B whose difference measures below audibility
    (starting value: 1 dB in level or 0.1 in pan at the cue) is decided by me, written down, and not asked.
Sound 2.13 **Gate package:** `review/round-05/`, the Artifact page (the preview first, then the clips), commit, PR.

**Sound gate 2, what you decide:**

| # | Question | Default |
|---|---|---|
| 1 | Timing, placement or density notes from the preview | None |
| 2 | The style-frame scene to design first in Sound 4 | Shots 4 to 6 (0:22 to 0:46) |
| 3 | Each A/B from Sound 2.12 that measured audible, with its clip | As today (no muffle, physical pan, the camera as listener) |

**What you do:** listen to the 112 s preview once on headphones and once on the phone speaker. Every sound is a
deliberate beep, click or hiss, rougher than the copy you have now. Judge only whether each lands on its action, comes
from the right side, and whether any moment is crowded. Left and right need headphones.

**Risks.**
- Temp love: the placeholders are deliberately crude, and the style frame replaces them early.
- Placeholders mask differently from final sounds, so masking per band is gated only at Sound 4.
- The listening copy (`out/snowy-bridge.mp4`, the S8.3 mix with the score) stays as it is, and the notes say so.

---

## Sound 3: Sound revisions

**Goal.** Fold in your Sound gate 2 notes and what the blockout revealed, and keep the sound storyboard true.
**Inputs.** Your Sound gate 2 answers, `findings.json`, `measure.json`.
**Outputs.** `review/round-06/`: the regenerated sound storyboard, a new blockout preview and `measure.json`, and
`notes.md` with a before-and-after table of every changed cue, law, rule or level.

Sound 3.1 **The items.** Each note becomes an item naming the file it touches: `cues.js`, a law, a designed level or
    `config.audio`. A picture file only by your explicit decision.
    Check: every Sound gate 2 answer and every open finding maps to an item.
Sound 3.2 **Apply the items.**
    Check: the perturbation control and every Sound 1 check still pass.
Sound 3.3 **Regenerate the storyboard** (`node scripts/sound-storyboard.js --raster --round 06`) so the map, timeline,
    panels and reel match the data.
    Check: the report's diff against round-04 lists exactly the intended changes.
Sound 3.4 **Re-render the blockout, measure and preview.**
    Check: `measure.json` meets the Sound 2 bars; the design-layer drift report is refreshed.
Sound 3.5 **Self-review and gate package.** No stop, unless an item is a decision only you can make.

**Sound gate 3:** signed off by your Sound gate 2 answers, unless something new needs you. What sounds where and when is
fixed here: changing how a cue sounds later is cheap; changing which cues exist and where they sit, once the layers
are rebuilt on them, is not. The score's own plan starts after this gate.

---

## Sound 4: Sound design

**Goal.** Make the real sounds, starting with one scene. The parked design layers are refactored to read `cues.js`, and
every copied number is removed. The score's own stages run beside this one.
**Inputs.**
- Sound gate 2 and 3 answers.
- `cues.js`.
- The parked layers (`ambience.js`, `car.js`, `foley.js`).
- `SOUND-PLAN.md` 3.13 and 3.14 (the PS1 model, the liberties, the reverb).

**Outputs.**
- The refactored layers.
- `config.audio.stage: 'design'` as the default.
- Re-pinned tests.
- The next round folder: the style-frame clip with its A/B clips, the full design preview and `notes.md`.

Sound 4.1 **The style-frame scene** (default shots 4 to 6). Design every cue in it on `cues.js`, in the PS1 character
    of Sound 4.5, with the SPU reverb (one preset) and the air lowpass on, and play it for you before the rest. A/B clips
    beside it: Freeverb against the SPU formula, the air lowpass on and off. This is a stop: the style is yours.
    Check: it meets the Sound 2 bars for onset, sync, pan and level; masking per band (check 9) passes in the scene.
Sound 4.2 **Backgrounds and ambiences.** The two places' backgrounds from `LOCATIONS`, the water in the bridge's; the
    story ambiences from their data events (`moonlight(t)`, shot 15's camera); the hum at `LAMP.head` under the hold
    rule; the camera-z wind boost removed.
    Check: no 'location' source changes inside a place (cutPerspective); there is no water energy in shots 1 to 7; each
    ambience change starts on its data event.
Sound 4.3 **Car.**
    - Every time and place comes from `cues.js`: parts from `SHAPE`, the brake and creak from the speed rules, the
      settle from `settlePitch`, the doors at latch and hinge, the arrival's swell, load from acceleration.
    - The tick list is no longer private.
    - The engine stop follows your Sound gate 0 answer.
    Check: a scan finds none of the copied numbers listed in `SOUND-PLAN.md` A.3 in `car.js`; design onsets match
    `cues.js` with zero drift; approachRises holds on the measured stems.
Sound 4.4 **Foley.**
    - Steps at their contacts from `cues.js`.
    - The new cues kept at Sound gate 1: scuffs, getting out, cloth on the walk, the shoulders, the door swings and
      stops, the cabin sounds.
    - Cloth at the rig's contacts, materials from `PEOPLE[id]`.
    - `RUSTLES` removed.
    Check: zero drift; the presence test (a rise of 20 dB over the moment before) holds for every story cue, with its
    windows read from `cues.js`.
Sound 4.5 **PS1 character.**
    - **Reverb:** one SPU preset for the film (or Freeverb, by your Sound gate 4 answer); each cue's reverb bit from
      `cues.js`; one wet depth per place, changed only at 54.000; steps in snow dry or nearly dry.
    - **Sample rates:** 22.05 kHz for transients; 11.025 kHz allowed for rumble and backgrounds.
    - **Loops:** backgrounds as short loops with block-aligned loop points (multiples of 28 samples).
    - **Variations:** 2 to 4 per material per person.
    - **RAM:** sample RAM reported against 508 KB minus the chosen preset's work area (for example 498.3 KB with Room,
      464.5 KB with Hall), as a soft check.
    Check: no energy above each sample's declared rate over 2; the voice allocator still shows zero steals; the RAM
    total is reported.
Sound 4.6 **Tests re-pinned to `cues.js`.** The copied `+0.38`, the lean windows and the offsets 1.7, 0 and 0.6 are
    replaced by cue reads. The design-layer drift check becomes a pass bar at zero. Masking per band becomes a pass bar.
    Check: each change is recorded with its reason, and the full suite is green.
Sound 4.7 **Self-review from measurements:** octave bands, spectrograms, onsets against cues and against frames,
    balance, phone and mono, per stem and per shot. Up to three rounds.
    Check: every finding has a disposition.
Sound 4.8 **Gate package:** the round folder, the Artifact page, commit, PR.

**Sound gate 4, what you decide:**

| # | Question | Default |
|---|---|---|
| 1 | The style frame: as built, or notes (the reverb and the air lowpass are heard in it, with A/B clips) | As built, with the SPU reverb and the air lowpass on |
| 2 | Anything in the full design that reads wrong | None |

**What you do:** listen to the style-frame clip (0:22 to 0:46) on headphones, then its A/B clips. These are the first
sounds meant to be final. Say what feels wrong.

**Risks.**
- The refactor can shift onsets that the blockout proved; the zero-drift bar catches it.
- A real sound can mask a neighbour that its placeholder did not; masking per band is gated here for that reason.

---

## Sound 5: Mix, repeated as needed

**Goal.** Balance every shot, with the effects and the score together, then master to the delivery bars. Like the
picture's polish rounds, this repeats until you are happy; each round gets the next round folder.
**Inputs.** The effects design from Sound 4; the score from its own stages; the level plan (`SOUND-PLAN.md` 1.3); the
bed-only windows, now partly filled by the score where they were held for music.
**Outputs.** Per round: a 1080p listening copy remuxed with the new mix, per-shot loudness, phone and mono results, and
`notes.md`.

Sound 5.1 **Balance per shot.** The car over the street background while it moves on screen, the idle under the drive,
    foreground foley over the background, the windows quiet where planned, backgrounds constant within a place, the
    score under the effects where it enters.
    Check: the balance tests, rewritten to read `cues.js` and `LOCATIONS`, pass, and their reversed controls fail.
Sound 5.2 **Loudness and peaks,** as the conventions above state: the hush anchored, integrated reported at or under
    -16 LUFS, the three true-peak bars.
    Check: ffmpeg's integrated reading agrees with ours within 0.2 LU; the true peak is at or under -1.5 dBTP on the
    WAV.
Sound 5.3 **Phone and mono.**
    Check: every story cue stays over the background through the phone simulation; the mono fold-down loss is reported
    per cue and for the mix.
Sound 5.4 **Cuts.**
    Check: no click at any shot boundary (the existing test with its scaled control); the backgrounds' crossfade at
    54.000 is clean.
Sound 5.5 **Remux the 1080p listening copy** with `scripts/mux.js`.
    Check: the video MD5 is unchanged; verify check 5 passes on sync, loudness and true peak.
Sound 5.6 **Self-review and gate package.** This is a stop, because the listen is yours.

**Sound gate 5, what you decide:**

| # | Question | Default |
|---|---|---|
| 1 | The balance, from the 1080p listening copy, including how quiet the night sits | As measured, if every check passes |

**What you do:** listen start to finish, on headphones and then on the phone. Say what is too loud, too quiet or
missing. Another round follows if you have notes.

Measurements say the sound is correct; only your ears say it is good.

---

## Sound 6: Sound final

**Goal.** Deliver the film with sound from one build, verified, with captions. Then write the process down so the next
film starts with it.
**Inputs.** The mix you approved at Sound gate 5.
**Outputs.**
- `out/` with the 1080p and 4K MP4s with sound, `sound.wav` and their sidecars.
- The SDH captions (SRT and WebVTT).
- An updated `README.md` and `SOUND.md`.
- The final round folder's `notes.md`, with "Done means".
- The template, the playbook and the root `CLAUDE.md` updated.

Sound 6.1 **Export once from a clean build.** `npm run export` (it renders the sound first), then the 4K capture with
    `--audio` from that same build.
    Check: both MP4s come from the same build hash and the same WAV.
Sound 6.2 **Verify both MP4s.** The WAV is byte-equal to a fresh render; sync within 48 samples (1 ms, verify's
    `SOUND_BAR.lagSamples`; S8.3 measured 0) in the three windows; loudness within 0.3 LU of the WAV; the true peak at
    or under -1.0 dBTP; the frames as in Stage 7.
    Check: `npm run verify` passes for 1080p and 4K.
Sound 6.3 **SDH captions.** From `cues.js`, plot-pertinent cues only, one caption per spotted run: lowercase, in
    brackets, present tense; the source named only when off screen and not named again while a sound continues;
    in-times exact, each caption shown at least 0.833 s; nothing in the bottom 120 px.
    Check: every caption traces to cues with `sdh` set; its in-time equals the first cue's onset to the millisecond.
Sound 6.4 **`SOUND.md` and `README.md` rewritten from `cues.js` and the final layers.** No hand-typed cue table.
    Check: a scan finds no times in `SOUND.md` that are not generated from `cues.js`.
Sound 6.5 **Template, playbook and root `CLAUDE.md`.**
    - Into `template/`: the `cues.js` skeleton, `scripts/sound-storyboard.js`, `scripts/lib/sound-checks.js` with its
      controls, the blockout layers and the stage switch.
    - In `playbook/process.md`: Stage 5.5 is replaced by this track of sound stages. For a new film, Sound 0 to 2 run
      alongside picture Stages 0 to 2, so cue timing can still inform staging; a locked picture, as here, is a separate
      mode.
    - The root `CLAUDE.md`'s Sound paragraph and `template/ROADMAP.md` point at the new stages.
    Check: the template's tests are green, and `node tools/new-film.mjs` makes a film whose sound storyboard runs.
Sound 6.6 **Final notes.** "Done means" as a table of item, result and evidence:
    - every story beat has its sound, or its planned quiet;
    - the three orders hold in sound;
    - every cue traces to data;
    - the stereo 180 degree line holds where A and B are separated;
    - no click at any cut;
    - the loudness and true-peak bars are met;
    - the phone and mono checks pass;
    - nothing in the bottom 120 px.
    Plus "Known and left as is".
    Check: every row cites a file or a measurement.
Sound 6.7 **Commit, update the PR, and stop.** Any file over about 25 MB stays in `out/`, and the notes say where.

**Sound gate 6, what you decide:**

| # | Question | Default |
|---|---|---|
| 1 | Publish the sound version as a new YouTube upload, keeping the silent one, with the existing title thumbnail checked at 320 px and the SDH captions | Only on your word |

**What you do:** say whether to publish.
