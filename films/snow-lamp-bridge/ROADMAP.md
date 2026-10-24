# Snow, Lamp, Bridge: the work plan, step by step

Companion to `PLAN.md` (what and why) and the brief. This file is the how: every stage, every sub-step, what goes in,
what comes out, how it is checked, and what you decide at each gate. It is updated when a stage changes the plan.

Conventions used throughout:

- **Round folders.** Every gate puts its images and a `notes.md` in `review/round-NN/`, numbered continuously (01 is Stage 1).
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
