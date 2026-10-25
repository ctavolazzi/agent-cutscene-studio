# Build log: Snow, Lamp, Bridge

Every step is written here **before** it is taken (intent and actions) and filled in **after** (result, time,
lessons). This is the raw material for a repeatable process: once the pipeline has run end to end, the reusable
parts get distilled into a runbook (and possibly a Claude skill) for future videos.

Companions: `PLAN.md` (what and why), `ROADMAP.md` (the stage plan), `review/round-NN/notes.md` (each gate).

Entry format:

```
### S<stage>.<step>  Title
- Intent:   why this step exists and what it must produce
- Actions:  the concrete commands or files
- Result:   what actually happened (filled in after)
- Lessons:  anything to do differently next time (filled in after)
```

---

## Reusable lessons (read first on a new video)

These cost time once. They apply to any scene built this way in this environment.

| Area | Lesson |
|---|---|
| Source of truth | Put layout, world state and cameras in three data files (`set.js`, `world.js`, `shots.js`). Storyboard, 3D scene and checks all read them. Change staging there, never in a drawing. |
| Composition | Specify framing as "this world point lands at (sx, sy)" and solve for the camera target (`solveTarget` in `shots.js`). It survives lens and position changes; raw look-at targets do not. |
| Checks before pictures | Run numeric checks (sight lines, screen direction, 180 line, cut angles, safe strip, landmark positions) before drawing. They find staging errors faster than looking. |
| Pose sampling | A keyframed position change is a walk only above about 0.2 m/s. Otherwise slow drifts (a lean-in) flip people into a walk pose. |
| Celestial objects | Check the moon's bearing against the skyline and against bright practicals (the lamp) from every camera that sees it. Both collided here. |
| Video colour | ffmpeg's RGB to YUV default is BT.601 while players assume BT.709 for HD. Always pass `out_color_matrix=bt709:out_range=tv` and the BT.709 tags, or saturated colours shift by up to 20 levels. |
| three.js 0.186 | `MeshLambertMaterial` lights per fragment. There is no per-vertex lighting chunk. |
| Chromium screenshots | `fullPage: true` on a top-level SVG document hangs. Size the viewport to the SVG instead. |
| Chromium flags | `--use-angle=swiftshader --enable-unsafe-swiftshader` slow plain page screenshots about 10x. Use them only when WebGL is needed. |
| Scratch scripts | A script in the scratchpad cannot resolve packages from the project. Import by absolute path (`.../node_modules/playwright-core/index.mjs`). |
| Shell | `pkill -f <pattern>` inside the same bash command line can match and kill that shell (exit 144). Kill by PID. |
| Excalidraw | Validate a generated `.excalidraw` by bundling `@excalidraw/excalidraw` (`restoreElements`, `exportToSvg`) into a test page with Vite and running it in Chromium. A Node import fails. The round trip caught a layout bug the SVGs did not show. |
| Review | Look at every rendered image. Write the problems down before fixing. Three rounds at most, then report what is left. |
| PRs | The user does not want PRs watched. The harness auto-subscribes after PR creation and after pushes: unsubscribe each time. |
| Writing | No em or en dashes anywhere (docs, code comments, on-screen text). Scan before every commit. |

---

## Stage 0: Plan (done 2026-10-21)

### S0.1  Read the brief, check the machine
- Result: node 22, ffmpeg 6.1.1 with libx264, Chromium 141 at `/opt/pw-browsers`, 4 cores, 15 GB. WebGL2 works headless under SwiftShader with or without flags. three 0.186.1 pinned. A probe scene (patched Lambert, 7 lights, fog, 5000 points, half-float target, dither pass) cost 29 ms per frame and was byte-deterministic.
- Lessons: probe the risky parts (WebGL, readback, encode, colour) before planning. Each probe took minutes and changed the plan.

### S0.2  Write `PLAN.md`, commit, open draft PR
- Result: PR #13. Five questions; the user said to start with the defaults.

## Stage 1: Storyboard (done 2026-10-21)

### S1.1 to S1.11  (see `review/round-01/notes.md` for the findings)
- Actions: data files, checks, a drawing layer that writes SVG and Excalidraw from one shape list, map, three detail maps, 15 true-perspective panels with inset frames, contact sheet, three self-review rounds, Excalidraw round trip, review Artifact page, commit.
- Result: 12 problems found and fixed in self-review, including a real pose bug and a moon hidden by the skyline. Gate 1 page: https://claude.ai/artifact/RgQoedvDEaZgWjEm9JafEF
- Lessons: the inset frames (other moments of the same shot) were needed for shots whose beat a single frame cannot show (3, 5, 10, 11).

---

## Stage 2: Blockout (started 2026-10-21 21:05 UTC)

Gate 1 outcome: the user said "Let's begin the build", taken as "go" with the defaults (moon at 84 degrees, A's crossing off screen, shot 2 as is). No data changes needed.

Goal: prove timing, staging and cameras in real 3D before any look work. Grey boxes, the real clock, the real cuts.
Output: `review/round-02/` with first, middle and last stills of every shot, a contact sheet, `preview.mp4` at 480x270, and `notes.md` with the measured frame cost.

Planned steps, written before starting:

### S2.1  Skeleton and the module contract (done by hand, not delegated)
- Intent: one working build with a fixed contract, so several modules can be written in parallel without touching each other.
- Actions:
  - `vite.config.js` (single-file plugin), `index.html`, `src/config.js`, `src/timeline.js`, `src/main.js`.
  - Contract: every scene part is `build(ctx)` returning `{ update(t, camera) }`, where `ctx = { THREE, scene, config, rngFor(name) }`. No part keeps state between calls. All randomness comes from `rngFor`.
  - Window API for scripts: `__ready`, `renderAt(t)`, `__frameRGB(t)` (base64 RGB of the internal frame), `__project(point, t)`, `__info`.
  - Stubs for every part so the build always works.
- Check: `npm run build` gives one HTML file; it loads from `file://` in headless Chromium and `renderAt` returns.
- Result (21:12 UTC): done, commit `399291c`. The single-file build is 755 KB and loads from `file://`. `__frameRGB` returns 388,800 bytes (480x270 RGB) and is byte-identical for the same `t` after rendering other times in between. `__project` puts shot 1's lamp head at (0.360, 0.300), exactly the storyboard solver's position, so FOV, aspect and roll conventions agree between `scripts/lib/math.js` and three.js. Added `scripts/lib/browser.mjs` (`openScene`) so the script builders share one way to load the scene.
- Lessons: write the contract and the shared helpers by hand before fanning out. Builders working in parallel need something real to code and test against, and stubs keep the build green while they work.

### S2.2  Parallel module build, with adversarial review and repair (workflow)
- Intent: write the scene parts in parallel against the contract, then have an independent reviewer try to break each one before it is accepted.
- Actions: one workflow, a pipeline per module: build, then review (contract, determinism, three.js API, data fidelity, no dashes), then fix if the reviewer found anything.
  - `src/set/build.js`: grey set from `set.js`.
  - `src/actors/car.js`, `src/actors/people.js`: from `world.js`.
  - `src/fx/lights.js`, `src/fx/snow.js`: all seven lights, placeholder snow.
  - `scripts/lib/browser.mjs`, `scripts/stills.js`, `scripts/capture.js`, `scripts/check-determinism.js`, `scripts/check-cameras.js`, `scripts/blockout-review.js`.
- Check: every module passes its own Node test and its reviewer.
- Started (21:15 UTC): workflow `stage2-blockout-modules`, run `wf_2955a32e-ce0`. Six builders in parallel (set, car, people, lights-snow, capture, checks), each followed by an adversarial reviewer and, only when the reviewer has blocker or major findings, a fixer. Rules given to every builder: own only your files plus `tests/<module>.test.mjs`; do not run `vite build` or touch `dist/` (a known-good stub build that script builders test against); test scene modules in Node by calling `update` at scrambled times and deep-comparing; test scripts against the stub build; checks must be shown to fail on planted bad input.
- While it runs: added npm scripts (`check`, `check:forbidden`, `check:determinism`, `check:cameras`, `test`, `preview`, `review:blockout`) and ignored `out/`.
- Result: 18 agents (6 builders, 6 reviewers, 6 fixers: every reviewer found at least one major problem). Every module passes its own Node tests after the fix pass. The reviewers each worked on one module, so the problems that remain are the ones between modules, found when I read the reviews side by side:
  1. The car doors swing through the people: A and B appear at the door before it is open and stand inside its arc when it closes.
  2. A slides sideways for 0.5 s (39.4 to 39.9) at the end of the walk round the car.
  3. Road and sidewalk z-fight the ground in shot 5 (camera 0.25 m up, near plane 0.05 m).
  4. The lighter flame and the ember are placed by `lights.js` from its own guesses at A's hands, not from `people.js`, so the light and the flame drawn in A's hands disagree.
  5. The car's speed jumps from 5.3 to 3.4 m/s at the start of the turn.
  6. The headlight lights sit 0.07 m behind the lenses the car model draws.
  7. Snow is too sparse to read at 480x270, and its draw order against the fog-lit set is unset.
  8. The city haze strength is a constant inside `set/build.js` instead of in `config.js`.
  9. No `stills`, `export` or `export:4k` npm scripts yet.
  10. A's cup pose (face 150, look 225) shows the back of the head in shot 11, not the three-quarter profile the storyboard has.
- Lessons: per-module reviewers catch module bugs well but cannot see contract gaps between modules (who owns A's hand position, who owns door timing). Next time, give each builder the list of facts it must *read* from another module instead of computing, and add one cross-module reviewer at the end of the workflow that reads all modules together.

### S2.3  Integrate
- Intent: one build with every part live.
- Actions: `npm run build`; fix integration errors; run the checks.
- Checks: determinism (scrambled times rendered twice, byte-identical); camera parity (three.js cameras project the landmarks to the same screen fractions as the storyboard's `report.json`, within 0.01).
- Result: the ten cross-module problems from S2.2, fixed in the data files where possible:
  1. Door times moved into `world.js` (`carTimes.doors`); `car.js` reads only those. Each person now appears in the open door's V once it is fully open, steps back past the door's edge (over 1.35 m from the hinge), and the door shuts after. The car test's door sweep (every 1/240 s) is now strict: no door passes through anyone.
  2. A's walk round the car front got two corner keys, so the body faces the way it moves; A walks in beside B and turns to face the bridge.
  3. Road material has a depth offset; the near plane is 0.1 m (now `CONFIG.near`).
  4. The lighter and ember read A's cup and cigarette tip from the people rig (`makePoser`). Shot 14 is now composed on that same tip, so the insert lands where the light is (sx 0.44 to 0.49 against 0.45).
  5. The car brakes at constant deceleration from x 12 to the corner, then leaves it on a cubic that starts at the corner speed: no speed steps.
  6. Headlight lights sit just ahead of the drawn lenses (forward 2.4, y 0.7).
  7. Snow count 12,000 (from 4,000); render order was already set.
  8. City haze density lives in `CONFIG.fog.cityDensity`.
  9. `npm run stills`, `npm run export`, `npm run export:4k`; `npm test` fixed to a glob (Node 22's `--test` does not take a directory).
  10. A's cup pose faces 190 and looks 245, into the lee (wind from 70), which is a three-quarter profile from shot 11's camera; A gets 2 s to turn back (smoke key 84.0), which keeps every joint under 7 cm per frame.
  - Two stationary keys at the end of walks were marked `walk`, which kept the gait running in place; they are `stand` now. Rule: the key that ends a walk is `stand`.
  - The module tests hard-coded the old times and positions; updated to the new data, with the planted controls kept. One bound loosened on purpose: a walking foot may move 16 cm in a frame (was 12) because A's swing foot now meets the curb mid-stride.
  - Storyboard regenerated from the new data (it reads the same files).
- Checks (all pass): 6 test files (car 15, people 24, lights and snow 27, set, checks, capture), `check:forbidden` 0 hits, `check:determinism` 62 times byte-identical across scrambled order and a fresh page, 61 distinct frames, `check:cameras` 192 comparisons, worst 1.4e-15.
- Measured: 69.7 ms per frame drawn and read back in headless Chromium (SwiftShader, 12,000 flakes). 2,688 frames is about 3 minutes plus encoding.
- Lessons: when a parallel build leaves cross-module gaps, fix them in the data files first; most were one or two keys. Tests that hard-code data values break on every staging change; prefer tests that read the data and check a property (no door through a body, no joint over 7 cm a frame).

### S2.4  Render the review set
- Actions: 45 stills (first, middle, last of each shot) at 4x, a contact sheet, `preview.mp4` at 480x270 with the overlay; measure milliseconds per frame.
- Result: `node scripts/blockout-review.js --round 02` draws the 45 stills in about 6 s (one browser session). `node scripts/capture.js --profile preview --out review/round-02/preview.mp4` ran at 58.5 ms per frame, 2,688 frames in about 2.6 minutes.
- Lessons: the contact sheet at 1500 px is too small to judge a 480x270 frame. For my own look I tile three shots at a time (9 stills at 640x360) with ffmpeg `xstack`; that size shows staging problems the sheet hides. `storyboard.js --raster` wrote its sheet to the same `contact-sheet.png` as the blockout and replaced it; it now writes `storyboard-sheet.png`.

### S2.5  Review: mine, then an independent per-shot panel (workflow)
- Intent: catch what I miss. Each shot's stills are judged against its storyboard panel and the brief's camera rules by a separate reviewer.
- Actions: I look at every still first and write my list. Then a workflow: one reviewer per shot, each with the three stills, the panel, and the rules; findings with a fixed schema; a second reviewer tries to refute each finding.

- My pass, written down before fixing anything:
1. **Shot 5, render error (fixed):** the snow ground and the road z-fought across the whole frame, flipping between bright and dark in steps as the camera trucked (seen in a brightened sequence: 3 to 35 to 3 to 37 mean level). A red-land, green-road debug build confirmed it. Polygon offset and a 5 mm lift did not hold from a camera 0.25 m up over 5 km triangles. Fix: the land is now cut into rectangles around the roads instead of running under them; the set test checks that no land piece runs under a road and that the pieces and roads still cover the ground.
2. **Shot 8, staging (fixed):** by the last frame B was hidden behind A. Both walked straight diagonals to rail spots on the same x, so from the frontal camera they lined up. Fix: both walk straight up the deck first and curve in to the rail during shot 9 (keys at 58.6 and 60.0 for A, 59.6 for B); they stay 2.6 to 3.8 degrees apart from the camera through the shot.
3. **Shot 5, light (to Gate 2):** the doors are 8 to 9 m from the lamp, outside its pool: about 0.06 lux at the driver door against 3 under the lamp and 0.55 at the rail. This is the risk the roadmap named. It is a staging choice for the user, so it goes to Gate 2 with options rather than being changed here.
4. **Scheduled later, not blockout problems:** the moon is a full disc (crescent sprite is 4.5); the lamp reads as a 2 px dot in shot 2 at 68 m (glow cards, 4.8); snow is not lit in the headlight beams in shots 3 and 4 (4.10); no footprints, flame, ember mesh or smoke yet (5.3 to 5.5); the near building windows in shot 15 are large flat bright slabs (window emissive tuning, 4.7).
- Fix 2 needed one test bound relaxed: the lower sole may float 4.5 cm (was 3.5) for a frame or two while stepping down the curb onto the deck at 56 s, now in a different gait phase.

### S2.6  Fix, at most three rounds
- Status: round 1 applied (see below). Round 2 is for Gate 2 decisions; no further changes are made without the user's answers.
- Actions: changes go into the data files or the modules, never into images. Re-render and re-check after each round.
- Panel result (workflow `blockout-review-round-02`, run `wf_4cbf13ef-8ba`): 5 reviewers (three shots each, to stay near the 10-agent guideline) and 5 skeptics, 10 agents, 46 minutes, 436 tool calls. 28 findings, 24 confirmed, 4 refuted (two were Gate 1 compositions working as approved, one a later-stage snow item, one a turn that would have looked into the lens). The reviewers rendered extra moments between first, middle and last and projected world points through the shot data, which found problems no single still shows: a car sliding backwards across frame during a pan, a one-frame light pop, a person appearing out of nothing.
- Round 1 plan, written before the changes (finding numbers refer to `review/round-02/findings.json`):
  - Shot 5 (blockers 3 and 4, majors 5 and 6): new `emerge` pose in the rig: each person starts seated inside the car's body, slides out, the outboard foot lands (A at 31.8, B at 33.2, as PLAN 3.9 says) while the inboard foot stays in the footwell, then they rise and step clear of the door. A foot that moves more than a few cm lifts on its way (it clears the sill). Camera holds on the door until A walks, then pans north-east along the car's nose so the headlight cut is in frame. This needs a smooth multi-key camera move: cameraAt gets an opt-in monotone cubic spline (`ease: 'spline'`), which passes through interior keys without stopping.
  - Shot 3 (major 0): pan starts at 17.4 as the nose appears, keeps the approved end frame. Inset moves to 17.8.
  - Shot 2 (major 1): the car starts at 14.0 from x 38.7 (same path after 14.0), so the headlights come on behind the cut.
  - Shot 7 (major 10): `ease: 'linear'` for the dolly, so it holds the walking pair.
  - Shots 7 to 9 (major 11, minor 12): A walks on the river side of B, so the A-left, B-right order holds across both cuts; B trails 1.3 m so the lamp post clears B's head; shot 8's camera moves to x 5.3.
  - Shots 9, 10, 12 (majors 9, 16, minor 19): parapet top 1.30 to 1.15 m so forearms rest on it. Flagged for Gate 2 because 1.30 came from PLAN's starting table ("chest high").
  - Shots 11 to 14 (minors 14, 15, 23, 24, majors 20, 21): one glance each. B looks at A inside shot 12 and is back on the city before the cut; A holds on the river through 12 and glances after the exhale in 13; the shoulders close in at 94.2 to 95.8, inside 13, so the insert in 14 is still. Lighter strikes at 78.6, after the cup.
  - Shot 12 (minors 17, 18): 70mm (medium close as the text says), camera 0.35 m west so B's hand clears A's coat.
  - Shot 13 (major 22): the embankment walls and the big land and water planes are subdivided so no triangle spans kilometres.
  - Shot 6 (minor 7): stand spots 0.25 m east so B clears the car's corner.
  - Shot 15 (minors 26, 27): pull back along 245 degrees with the pair at sx 0.28: the car's nose and the window behind the lantern leave the end frame.
- Round 1 applied (S2.6, first pass). The four module-test updates passed car, lights and set. The people test stopped at check 10 on three real defects, which I fix in the rig and the data, not in the test:
  1. Seated skirt: `rotation.x = -skirt` swung the hem back under the car floor (lowest point 0.10 m, under the 0.25 m underside). Sign flipped so the coat lies forward over the thighs.
  2. B's stand spot at x 3.4 is on the curb ramp (x 3.35 to 3.65): the hips dropped 5.5 cm in one frame. B now stands on the road at x 3.33, the last flat x, 1.5 cm clear of the car's side.
  3. Joint jumps while getting out: the inboard foot travelled from in front of the hips to behind them, and the outboard foot planted ahead then slid 15 cm as the body rose. Now the inboard foot stays in the footwell in front of the hips, the outboard foot steps out only in the walk, A and B rise in place at the door (no root move, so no slide), and the hands move less between exit and stand.
  - Known and kept: the doorway positions sit inside the car's solid shell box (the model has no hole for the open door). From the camera at the west side the parts inside the car are hidden by its wall; only the legs under the car show.
  - Also fixed: the build.js comment said no triangle is longer than 100 m. It is 100 m per axis; the diagonals are longer. Comment reworded.

- Round 1 result: the people test passes all 27 checks after the rig and data fixes above; car 15, lights and snow 27, set 18, checks 21, capture 17. Storyboard regenerated. Determinism (62 times, byte-identical), camera parity (188 comparisons, worst 2e-15) and `check:forbidden` pass.
- Further round 1 changes found while re-rendering, each checked by eye and numerically:
  - Shot 8 camera from x 5.3 to x 4.0 (three-quarter, not frontal). From 5.3 the pair lined up with the camera and A hid B; from 1.0 A stood in front of the lamp and failed the bulb test. A is on the river side of B throughout 7, 8 and 9. The bulb is 100% visible in shot 8 (the test needs 95%).
  - B crosses the abutment's step on the sidewalk (waypoint 57.6), not on the curb ramp, which was adding float frames.
  - The shot 7 dolly holds the pair at screen x 0.620 for the whole shot.
  - Walk clearance ramps in with the walk. Before this, the first step lifted a planted foot to curb height in one frame; the leg's own flex is now used (each leg swings opposite the other).
- Test changes, each recorded in `review/round-02/notes.md`: the get-out checks were rewritten for the new pose (the old exit-on-appearing check no longer describes the design); the standing-height tolerance is 1e-4 because the walk table widens each walk by one sample; the "appears after the door opens" check now asks for the door to start opening, since the seated body is hidden by the car.
- Gate 2 package: `review/round-02/notes.md` (dispositions for all 28 panel findings, six decisions for the user), `findings.json`, the contact sheet, the storyboard sheet and the panels. The 45 full-size stills and the preview MP4 are not committed (large, reproducible with `npm run review:blockout` and `node scripts/capture.js --profile preview --out review/round-02/preview.mp4`).
- Lessons from this round: a body that moves linearly drags its feet through a wall unless the feet are timed separately; the test that asks "does the foot clear the wall" caught what the still never showed. Swivels at 7 degrees a frame throw the feet 9 cm, so a long swivel needs a long segment. A pole that flips sign between two poses flips the elbow, so keep blended poses on one side of zero.

### S2.7  Gate package
- Actions: `review/round-02/notes.md`, update this log and `ROADMAP.md` if the plan changed, review Artifact page, commit, push, update PR #13, unsubscribe from the PR.
- Done in the first session: `review/round-02/` (notes, findings, sheets, panels, stills, preview), log and roadmap, commits up to dbf3648, PR #13 body for Stages 0 to 2. Not done: the review Artifact page.

### S2.7b  Gate 2 review page (2026-10-22, second session)
- Intent: the phone page the gate package promises (ROADMAP conventions), so the six Gate 2 decisions can be judged from pictures, not from text alone. Staging data does not change: the page only reads the current build.
- Actions:
  1. `npm ci`, `npm run build`, then the full check list as a baseline (six module tests, `check:forbidden`, `check:determinism`, `check:cameras`), so the page describes a build that passes.
  2. Decision stills: `node scripts/stills.js` at the moments each decision is about (shot 5 door and boot times, the 34.4 to 36.0 tyre window, the shot 3 drift, shot 8's closest approach and lamp post, the parapet lean in shots 9, 10 and 12) into `review/round-02/decisions/`.
  3. `scripts/blockout-page.js`: builds `out/gate2-page/review-page.html` from `notes.md` (the disposition table), `findings.json`, `stills.json`, `SHOTS` and a decisions list kept in the script, the same way `scripts/review-page.js` built Gate 1. Images and the preview are published beside the page, not inlined.
  4. An answer card per decision on the page, saved to the artifact's database (`answers/d1` to `answers/d6`) so I can read the answers back; a copy-as-text button as the fallback.
  5. Independent check of the page (workflow): facts against the sources, phone and desktop layout in both themes, each decision answerable from its own pictures.
  6. Publish privately, commit, push, update PR #13. No PR watching.
- Result so far (steps 1 to 5):
  - Baseline: all six test files pass (car 15, people 27, lights and snow 27, set 18, checks 21, capture 17), `check:forbidden` 0 hits, `check:determinism` 62 times byte-identical, `check:cameras` 188 comparisons, worst 2e-15.
  - The page is built into `out/gate2-page/` (ignored by git), not into the round folder: 151 files, 27.1 MB, with gamma 0.4 lifted copies of every frame and of the preview for a Lift shadows switch. Shot 5's get-out averages 1.4 to 1.9 out of 255, so the frames are black at normal viewing.
  - Measuring for the page found that two of the notes' options were wrong: decision 1's "move the lamp 1.5 m north" goes away from the doors, and decision 4's "50mm, 0.5 m back" does not shrink the tyre. `scripts/gate2-measure.js` now produces every number the page states (`review/round-02/measure.json`), including a test render of the lamp moved 1.5 m south (`decisions/south-*.png`).
  - Independent check (workflow `gate2-page-review`, run `wf_9569ec3b-b2d`): four reviewers (facts, my corrections, function, clarity), one skeptic each, 8 agents, 38 minutes. 41 findings, most confirmed. The ones that changed what the page says: option (b) of decision 4 cut A's feet to about half size, not by 10%; in shot 8 the post rises out of A's head at the cut, and "B trails further" does nothing from that camera; moving the lamp south was still black in a render, the post would enter shots 4 and 6, and ROADMAP 4.7 already requires the pool to cover the car doors; the courtesy light would be an eighth light against PLAN 4.2; shot 3's drift happens while braking, before the turn, and two frame captions were wrong. Page faults: a failed save could not be retried, picks made before the store answered were lost, jump links landed on the wrong shot without scroll anchoring (Safari), low contrast in the light theme, timecodes that printed 0:60.0.
  - All fixed in the generator and the measure script; a mock store test passed six cases (burst, transient failure, Retry, snapshot after failure, early pick, read-only), jump links land at 64 px with scroll anchoring off.
- Lessons: measure an option before writing it down. Two of six options in the first notes rested on a direction or an optics rule that one line of maths would have caught. A whole-frame average said "too dark" faster than any reviewer did; check it on every lighting beat.

### S2.7c  Close the gate package (2026-10-22)
- Intent: the user said "proceed carefully". That is not an answer to the six decisions, so staging stays as it is. Finish the package: notes in line with the page, a second independent check of the rewritten decisions, the full check list, commit, push, publish the page privately, update PR #13.
- Actions: rewrite the Corrections section of `review/round-02/notes.md`; a two-agent workflow (reviewer and skeptic) over the decision cards and the notes; the six test files, `npm run build`, the three checks; commit the scripts, `measure.json`, `decisions/` and the docs (not `out/`); push; publish with the `db` capability and read the store back once; update the PR body; unsubscribe from PR #13 in case the harness subscribed.
- Result: the second check (workflow `gate2-page-recheck`, run `wf_a87809dc-2a7`, 4 agents, 29 minutes) found that the decisions themselves still had errors, all confirmed by its skeptics: moving the lamp 1.5 m south is the one option that fits the plan's 7 m pool (I had judged it by the untuned blockout lamp's brightness); A's forearms do not rest at 1.15 m (elbow 14 cm above the top); the get-out puts both feet down at once, not one; the hold-then-push-in for the tyre needs a turn too fast to be gentle; the tyre stays in frame until 37.6 s. Recommendations now: 1c 2a 3c 4a 5b 6a. Notes, PLAN 3.5's lamp note, the page generator and `measure.json` (the tyre's time in frame) updated. The page is built but not published: the user asked how this helps the video, so the gate package stops here and the next work is round 2.
- All six test files and the three checks passed before the commit (no `src/` change since).
- Lessons: a review page is only as good as the decisions on it. Two independent passes over the decisions found more than the page itself ever needed; next gate, measure the options first and spend one review pass on the decisions, not on the page.

## Stage 3: Revisions from the blockout (started 2026-10-22)

Gate 2 answer from the user: "Go", the recommended set 1c 2a 3c 4a 5b 6a (`review/round-02/notes.md`, Corrections). No
pacing notes were given, so the pacing pass (3.3) is mine.

### S3.1  The items, each with the files it touches
1. **1c, lamp 1.5 m south.** `src/set.js` LAMP base z -6 to -4.5, lantern with it. Then every shot that frames the lamp
   (1, 2, 4, 6, 7, 8, 10, 12, 14, 15): shot 4's camera (the post would stand 2.3 m away at the left edge), the end frame
   of 15 ("under the lamp"), and the walk paths past the post. `src/shots.js`, maybe `src/world.js`.
2. **2a, A's forearms rest at 1.15 m.** `src/actors/people.js` lean pose for A only (A's elbow is 14 cm above the top today).
3. **3c, shot 8.** B keeps about 0.69 m from A across the deck, easing in after 54.0 s so shot 7 is untouched
   (`src/world.js` B_KEYS), and the post clears A's head at the cut (`src/shots.js` shot 8 camera or A's last steps).
   Measured after item 1, because the post moves.
4. **4a, shot 5 camera.** Start the turn toward the bridge earlier so the front wheel stays out of frame, ending on A's
   feet and both beams for the cut at 36.2 to 36.6 s; B's boots under the car at 33.2 s stay in frame. `src/shots.js` shot 5.
5. **5b, A steps down one boot first.** `src/actors/people.js` get-out clock, maybe `src/world.js` A_KEYS 30.5 to 32.4.
6. **6a.** No change.

### S3.2  Apply the items (workflow, three builders in separate git worktrees, then a checker each)
- Intent: the three groups touch separate parts of the data (people rig; shot 5's camera; lamp, compositions and shot
  8), so they can be built at once. Each builder works in its own worktree on its own local branch, runs every test and
  check, renders and looks at its frames, and commits locally. A checker then tries to break each result. I merge the
  three branches here, then run everything again on the merged build.
- Lesson applied from S2.2: each builder gets the list of facts it must read from other modules (door times, the
  wheel, the beams, the lamp), and the merged build gets its own review.

## Stage 4: Look development (started 2026-10-22, alongside the Stage 3 builders)

The user, on Gate 3: "I think it's probably fine please just start working on making the video". Timing is taken as
signed off once the Stage 3 merge passes its checks; no more review pages or panels between stages.

### S4.1 to S4.3  The PS1 render path
- Intent: the frame goes through the PlayStation look before any asset work, so every later look decision is made on
  the real output.
- Actions: `src/ps1/material.js` (onBeforeCompile on every Lambert and Basic material: vertex snap to the 480x270 grid
  after projection, affine map coordinates by the uv-times-w trick, one shared uniform object, a `ps1|` program key that
  chains any existing hook); `src/ps1/post.js` (half-float target at config.res, then one pass: fade in linear light,
  linear to sRGB, 5 bits per channel, 4x4 Bayer dither fixed to the pixel grid); `config.ps1` and `stage: 'look'`;
  timeline draws through the pass when present; `tests/ps1.test.mjs`.
- Result: every shot renders through the pass; all six test files, the new PS1 test (4 checks, including a planted
  off-grid control), check:forbidden, check:determinism (62 distinct frames, byte-identical) and check:cameras pass.
  The upscale stays where it was (CSS at display, ffmpeg in the capture), driven by config.out / config.res, so a 320x180
  config is a 6x upscale with no other edit.
- Lessons: none yet; textures (4.4) will be the first real test of the affine warp.

### S4.4  Procedural textures
- Actions: `src/textures.js`: nine 64 px grey detail maps (snow, asphalt, concrete, brick, plaster, car paint, A's coat,
  B's jacket) painted from seeded value noise into byte arrays, so they build in Node and tests can read them; nearest,
  repeating, no mipmaps. `worldUV()` maps a mesh by world position, one repeat per `TILE` meters, so a brick is the same
  size on every building. The set's near surfaces get them in the look stage (land, road, sidewalks, deck, parapets,
  walls, buildings, the corner building); the city stays flat under its haze. `tests/textures.test.mjs`.
- Result: brick, slab joints and road grain read at 480x270; all set, lights, checks, PS1 and texture tests pass;
  determinism holds (62 distinct frames). The car and the people get theirs with their models (4.11, 4.12).

### S4.5 (moon) and S4.8  Crescent moon; glow and beams
- Crescent: a seeded 64 px mask on the moon disc, lit limb down and horns up, alpha-tested so stars show through.
- `src/fx/glow.js` (look stage): additive cards on the bulb, both headlights and both taillights (the car's follow
  `headlights(t)`), a faint cone under the lantern and one ahead of each headlight. No lights added. The first cones
  were flat additive surfaces and read as solid wedges up close (shots 1, 4, 6); a small shader now fades each cone where
  it turns edge-on and toward its base, so it reads as a soft shaft from any side. Values in `config.glow`.
- Checks: `npm test` (71 passing, new `tests/glow.test.mjs`) and `npm run check` (forbidden, build, determinism, cameras).
- Lesson: a test loop written as `for ...; do node ...; done` does not stop on a failure, and one failing texture test
  reached a commit (fixed in the next). Commits now run behind `npm test && npm run check`.

### S4.10  Finished snow
- Actions: `src/fx/snow.js`: the lamp's boost is shaped by its cone below the lantern (full within 25 degrees of
  straight down, 0.3 of it outside 45); both headlight beams light the flakes inside them while they burn (placed and
  aimed exactly as fx/lights.js places the spots, fading over 25 m); flakes within 4 m draw one pixel larger, so the
  near layer reads over the middle and far ones. The flake positions, wrap, wind and drift are unchanged.
- Test: the GPU check's JS copy of the shader got the same terms. Two coverage problems came up and were fixed in the
  test, not by loosening it. Too few headlit flakes at the old sample times, so moments with the beams near the camera
  were added (20.5, 28, 35.8, 36 s). The isolation rule never admits the large near sprites, so the near layer is
  scored on the ring of pixels the extra size adds, where no other flake draws (128 flakes, all match). New planted
  faults (lamp cone, headlights, near layer) are each caught; all 27 lights and snow checks pass.

### S4.5 (river)  River reflections: tried and removed
- Tried: a streak on the water under each lit window facing the river, placed where it would reflect toward the
  rail, shimmering in stepped levels (131 streaks). Removed: from every camera the water is 6 m below the deck and
  hidden behind the parapet, so the only streaks that showed came from windows close to the bridge and read as bright
  debris on the parapet (shots 9 and 15). The river stays a dark plane; nothing on screen needs more.
- Lesson: check what the cameras can see of a surface before dressing it. One still per river shot would have said so.

### S5.4 and S5.5  Lighter flame, ember and smoke
- Before: the lighter and the ember were lights only (fx/lights.js) and `smokePuffs(t)` in world.js had nothing drawing it.
- Actions: `src/fx/smoke.js` (look stage): an additive flame card and halo at the rig's `cup` point while the lighter
  burns, flickering with the same `lighterFlicker(t)` as the light; the ember and a small halo at the rig's `tip`,
  scaled by `emberLevel(t)` so each drag glows; a pool of 16 soft sprites drawn from `smokePuffs(t, tip)` (wisp and
  exhale), normal blending under the fog. The flicker and ember timing moved from fx/lights.js into world.js so the
  light and the drawn flame share one definition. Values in `config.smoke`.
- First stills (79, 85, 91, 97.4 s): flame and smoke read; the ember halo on a drag was the size of A's head and the
  puffs looked solid. Halo 0.16 m to 0.09 m at 0.45, puffs to 0.7 opacity.
- Check: `tests/smoke.test.mjs` (no lights added, flame only while the lighter burns and at the cup, ember at the tip
  and brighter on a drag, one sprite per puff at its position, same t same visible state in any order).
- Result: all tests and checks pass (forbidden, build, determinism, cameras).
- Gate for this commit (smoke, controls, verify script): 78 tests pass; forbidden, build, determinism, cameras pass.

### S5.7  Playback controls
- Before: the page played and paused on a click or Space, nothing else.
- Actions: `index.html` gets a control strip over the bottom of the frame (outside the canvas, so no frame or capture
  contains it): Play/Pause, the time, the shot title, a scrub bar at one frame a step, a shot list sized by duration
  (the current shot lit; click to jump), an Overlay toggle (`hud.setOverlay`). Keys: Space or K, Left/Right one frame
  (Shift: one second), [ and ] for the previous and next shot, Home, D for the overlay. The strip fades after 2.5 s
  without a pointer move while playing. Capture mode never shows it.
- Found while testing: a seek to frame n could draw frame n - 1 (n / 24 * 24 lands just under n in floating point);
  the playback quantizer now adds 1e-6 before the floor.
- Check: `tests/playback.test.mjs` (built page: pause, shot jump, frame step, next shot, overlay key, play button, no
  controls in capture mode). Looked at the strip at 960x540 and at phone width.

### S5.9  scripts/verify.js
- Written ahead of the export: probe (size, rate, frame count, duration, H.264, yuv420p, BT.709 tags, no audio,
  faststart); frame match on two frames a shot plus the first and last, decoded in one pass and area-averaged back to
  480x270, against a fresh render with the overlay off (mean error 2.5 or less, PSNR 40 dB or more); five seeks held to
  the same bar; 240 frames timed back to back in the page (information only in software WebGL). Writes
  `<file>.verify.json`. First real run comes with the export.

### S5.3  Snow cover and footprints
- Before: the sidewalks and the deck draw as bare concrete (shots 4, 7, 8, 9 stills), so a footprint would have
  nothing to sit in, and "Feet in the snow" has no snow under the feet.
- Plan: a thin snow cover on the sidewalk tops and on the deck between the parapets (the road stays dark asphalt, the
  curbs and parapets stay concrete); prints found from the rig (a shoe that has stopped at standing height over snow
  becomes a print at that moment), drawn as small dark decals that show from their landing time.
- Actions: `set/build.js` adds a `cover` material (snow texture, `TONES.cover`) and flats on the four sidewalk runs at
  curb height and on the deck between the parapets, `DIMS.coverLift` above them with a depth offset. `src/fx/footprints.js`
  samples each person's rig every 1/48 s once at build: a shoe that comes down (ankle back to standing height after
  being lifted, or first seen down) off the road makes a print under the shoe's centre, facing the body; a landing
  within 0.1 m of the same foot's last print makes none. Prints are flat decals (sole and heel in a 16x32 mask), Lambert
  so the lamp warms them, shown from their landing time. `BODY` in people.js is exported for the shoe sizes.
- First version found prints from the ankle stopping; the procedural walk lets the stance foot slide, so it gave one
  foot only and doubled prints. Landings (down after up) give alternating prints about 0.6 m apart: 46 in all.
- First prints were too faint to read (#8a93a6 at 0.6); now #5a637a at 0.8. In shot 7 a trail shows behind B and in
  shot 15 one leads along the deck to the rail.
- Not done, on purpose: cloth textures on the people and car paint (4.11, 4.12). At 480x270 a person spans about 100
  px in a medium shot, so the coat weave would be finer than a pixel and only shimmer; flat Lambert reads better.
- Check: `tests/footprints.test.mjs` (both trails, none on the road, each on the snow, each where that shoe stands at
  the moment it lands and not a step before, alternating feet at step spacing, shown from landing on, no lights).
- Gate: 82 tests pass; forbidden, build, determinism, cameras pass.

### S3 round 2, rig (merged from s3-rig)
- Merged the rig builder's commit 37ae352: A rests the forearms on the parapet; getting out, the outboard boot lands
  first and the other follows. people.js, world.js (a key comment), tests/people.test.mjs. Merged cleanly over the
  smoke and footprint work; the footprints follow the new exit on their own (it is on the road, so no prints).
- Looked at 31.6, 32.0, 64, 72, 86 and 104 s. Shot 5 is still black at 31.6 and 32.0: its camera (s3-cam5) and the
  lamp move (s3-lamp8) are still being built, and the shot needs light either way (4.7).
- Gate: 82 tests pass; forbidden, build, determinism, cameras pass.

### S4.7 / S5.1  Snow on the road and tyre tracks
- Before: shot 5 ("Feet in the snow") was black at 31.6 to 33 s. The car parks on dark asphalt (#34383e), so the boots
  land on nothing that catches the little light there, and there is no snow under the feet the shot is named for.
- Actions: the road becomes a thin grey layer of snow (`TONES.road` #7d838e with the snow texture; still 1.3 times the
  sidewalk curb's luminance apart, so the materials test holds). `src/fx/tracks.js`: one strip per wheel along its
  path from the car's start to its stop, a segment every 0.25 m stamped with the time that wheel reaches it; the drawn
  part is a prefix (`setDrawRange`), so the street is untouched before the car and keeps its path after. Values in
  `config.tracks`. Boot prints are now made on the road too (A's first boot at 31.77 s by the door).
- Result: shot 5's legs, boots, the car's underside and the ground read at 32.5, 35 and 37.5 s; shot 4's road takes
  the headlights; shot 7 shows the boot trail behind B.
- Check: `tests/tracks.test.mjs` (four tracks on their wheel paths in time order, each point under the car model's own
  wheel at four times, drawn part grows and never shrinks, a segment shows only once its far end is reached).

### S7 tooling  scripts/finals.js
- One still per shot at full size (`out/stills/shot-NN.png`, the time from `CONFIG.finals.stills` or the shot's
  middle) and the three thumbnail candidates (`out/thumbnails/`): the frame upscaled 3 or 4 times nearest and cropped
  to 1280x720, as PNG and JPG, each with a 320x180 area-downscaled copy and a sheet of the three for the 320 px check.
  Ran once on the current build: 15 stills and 3 candidates written. Times and crops get chosen after the merges.
- Gate: 85 tests pass; forbidden, build, determinism, cameras pass.

### S3 round 2, lamp and shot 8 (from the s3-lamp8 worktree) and verify fix
- Before: the lamp and shot 8 builder and the shot 5 camera builder both stopped on a usage limit before committing.
  The lamp builder's worktree held a nearly finished change; the shot 5 builder left nothing. I apply the lamp diff
  here, check it myself (tests, frames of every shot that frames the lamp, the walk past the post), then do shot 5.
- The lamp diff: LAMP base [5, -6] to [5, -4.5] and the head to [4.6, 4.5, -4.5] (decision 1c); shot 1's camera moves
  south with it so the lantern reads as before; shot 4 re-placed 2 m north of the post, framed on its foot; shot 8's
  camera to x 4.8; A and B walk straight up the deck onto the bridge (A at x 4.5, B 0.65 m west); tests updated for
  the new lamp position.
- verify.js, found on the first real export: a failure before a check had its entry crashed the report (fixed), and
  the 40 dB PSNR bar cannot be met by this film. Measured on 2 s of shot 7: the decoded frame sits 38.0 dB from its own
  render at crf 16, 38.3 at crf 12 and 38.4 at crf 10, and 25.5 to 25.9 dB from the frames either side. The floor is
  the 8-bit limited-range YUV 4:2:0 round trip of a dithered image, not the crf. The bar is now 36 dB plus an identity
  check (each decoded frame closer to its own render than to a differing neighbour's). Planted fault: every decoded
  frame read one late; the identity check caught 4 of 4. The trial export passes: 1920x1080, 24 fps, 2688 frames,
  112 s, H.264 yuv420p, BT.709, no audio, faststart; 32 frames matched, worst mean error 2.39 and 38.3 dB; five seeks
  pass; 58 ms a frame in software WebGL (information only).
- Checked here: the rebuilt cameras match (check-cameras); frames at 3.5, 10, 18, 22.5, 26, 28.9, 40.5 to 59.9, 72, 98,
  100.5 to 111.9. Shot 1 still close on the lantern; shot 2 has the lamp small on the right third far up the street;
  shot 4's post is a dark bar on the left third with the car coming down the lane right of it; shot 6's post stands
  left of the pair; shot 8's post stays clear left of A to the cut (it rose out of A's head before), the lantern above
  and behind. Walking past the post (40 to 62 s, every 1/48 s): A's nearest joint is the swinging right hand, 0.25 m
  from the post's axis (radius 0.08), the hips 0.48 m; B's nearest is 0.77 m.
- Gate: 85 tests pass; forbidden, build, determinism, cameras pass.

### S3 round 2, shot 5 camera (decision 4a)
- Before: from 34.4 s the camera trucked 1.3 m north past the front wheel, which covered up to 19% of the frame.
- Found: from the hold (which has to stay to about 33.5 s for A's boot and B's boots under the car), the wheel sits
  2.25 m off at a 48 degree bearing, between the door (90) and the bridge (about 8), so any turn sweeps across it, and A
  walks right past the wheel at the headlight cut. The brief's "wheel at most 1%" cannot be met by a continuous move
  from this hold (it needs the wheel 6.4 m away, or a pan far over 30 degrees a second). So I searched camera paths
  (scratch script, random search plus refinement, four seeds a round) with hard requirements: A's feet in frame and not
  hidden by the car from 34.6 s to the end, all four beam patches (3 and 6 m ahead of each lamp) in frame and clear of
  the car from 36.2 to 36.6, peak turn under 30 degrees a second, the camera 0.4 m or more from the car and 0.25 to
  0.6 m up; and the wheel's largest and mean share of the frame as the cost. Every seed found the same move.
- New move: hold on the door to 33.5 s, back away from the car to (-1.6, 0.35, 2.8) by 35.3 while turning toward the
  bridge, come north to (-1.55, 0.4, 1.4) by 36.4 with the beams ahead and A's feet passing the wheel, then north past
  the car's front to (-1.25, 0.35, -0.65) at 40, looking across the nose at A walking into the lamp light.
- Measured every frame: wheel at most 5.9% (36.17 s), A's feet in frame throughout and never hidden by the car
  (0 of 182 checks from 36.2), beams 0 misses, peak turn 26.7 degrees a second, nothing near the car. Looked at 33.2 to
  39.9 s: the beams light the snow ahead while A's boots walk past the car, cut at 36.2, then lamp light only.
- A first try ended looking up an empty street with A gone; the end key now follows A (yaw 62, 7 degrees down).
- Gate: 85 tests pass; forbidden, build, determinism, cameras pass.

### S7  Final export, stills, thumbnails, README
- Before: all of round 2 is in (rig, lamp and shot 8, shot 5). One build feeds every deliverable: `npm run export`
  builds and captures the 1080p MP4, then `scripts/verify.js`, `scripts/finals.js` (15 stills, three thumbnails) and
  the 4K capture and its verify all read that same `dist/index.html`.
- Thumbnails (7.3): the strongest frames turned out to be moonrise (74 s: the crescent over the two at the rail, the
  lamp's cone, open sky for a title), the lighter (79.3 s, 4x crop: A's face in the flame, B's red beanie) and the final
  wide (108 s, 4x crop on the pair and the lamp). The reveal (41 to 45 s) reads weaker at 320 px. At 320 px all three
  read but sat dark in a bright grid, so the thumbnails (only) get a gentle shadow lift (`CONFIG.finals.lift`, an
  ffmpeg curves spec); the film and the stills are not graded. Checked side by side at 320 px with and without.
- README.md (7.4): what the files are, how to re-export and verify, the playback keys, every config value, the shot
  list with timings, and how the code is laid out. `npm run verify` and `npm run finals` added.
- Final 1080p export: 2688 frames in 262 s (97 ms a frame), 44.5 MB. Verify passes: probe as specified; 32 frames
  matched, worst frame 570 (23.75 s, shot 4, the beams full of snow) at mean error 2.497 against the 2.5 bar and
  37.9 dB; five seeks pass. That frame is close to the bar because it is mostly dithered snow, where the YUV round
  trip loses most; a lower crf does not move it (measured above).
- Self-review from the MP4 (one frame every 2 s, 320 px): the beats run in order and read at that size, except shot
  5's hold (30 to 33 s) and shot 2's empty street, which are very dark. Tried a lighter road snow (#a4aab5, the next
  tone the materials test allows): almost no change in those frames, since little light reaches the door side, so
  the road stays as it is. The hold stays a dark beat between the bright arrival and the lit reveal.
- Final 4K export from the same build: 2688 frames in 537 s (200 ms a frame), 75.3 MB, 3840x2160. Verify passes:
  worst frame 570 at mean error 2.37 and 38.3 dB; five seeks pass.
- `npm run finals` from the same build: 15 stills (times in `CONFIG.finals.stills`) and the three thumbnails.
- Storyboard regenerated for the final cameras: all 14 cuts pass the angle or size step, every bridge shot keeps its
  camera west of the 180 degree line, and one landmark touches YouTube's bottom 120 px strip (B's feet in shot 7's
  last frame, at 0.891 of the height against 0.889). Left as is: 2 px, and only while the bar is up.
- `review/round-03/`: first, middle and last frame of every shot from the same build, the contact sheet, and
  `notes.md` with the ROADMAP's "done means" list checked item by item.
- Gate for this commit: 85 tests pass; forbidden, build, determinism, cameras pass.

### S7.3b  The title thumbnail
- Before: three untitled thumbnail candidates in `out/` (not committed). The user asked for the thumbnail.
- Actions: `scripts/title-thumbnail.py` (Pillow) sets "SNOW, / LAMP, / BRIDGE" on the moonrise candidate, in the dark sky
  between the crescent and the lamp. The lettering is DejaVu Sans Bold drawn at a quarter of the size with no
  antialiasing, given a 1 px dark outline and drop shadow at that size, then scaled up 4x nearest, so its stair steps
  match the film's pixels. "LAMP," is in the lamp's amber, "SNOW," a cold white, "BRIDGE" warm white.
- Result: `packaging/thumbnail.jpg` (1280x720, 236 KB, under YouTube's 2 MB), `thumbnail.png` and `thumbnail-320.png`.
  At 320 px the title, the moon, the lamp and both figures read.
- Gate: 85 tests pass; forbidden, build, determinism, cameras pass.

### Moved to agent-cutscene-studio
- Before: the film lived in a private workbench repo as `snowy-bridge/`, on a branch behind a draft PR.
- Actions: moved with its whole record (plan, log, storyboard, review rounds 01 to 03, the thumbnail) to the public
  repo ctavolazzi/agent-cutscene-studio as `films/snow-lamp-bridge/`, beside a starter template and the playbook drawn
  from this film. Nothing that draws a frame changed. One fix: `npm test` now runs `vite build` first, because a fresh
  clone has no `dist/` and the browser tests read `dist/index.html` (found by making a film from the template and
  running its tests straight after `npm ci`).

### Published
- The director uploaded the film to YouTube with the titled thumbnail: https://youtu.be/F02fKQvjlJQ
- Actions: linked from this README, the repo's README (the thumbnail links to the video) and playbook/prompts/youtube.md.

## Stage 8: Sound

### S8.0  Plan
- Before: the film is silent by the original brief. The director asked to continue the engineering with sound.
- Plan: a soundtrack made the way the picture is made. Every sample is synthesized in code from the same timing data
  (no recorded samples, seeded noise only), rendered in one pass over the whole film at 48 kHz stereo, deterministic to
  the byte. Sources are placed in the stereo field from their position relative to each shot's camera (`cameraAt`), so
  the car pans with the picture. Footsteps land on the frames the prints appear (`footprintList`), doors on the door
  times, the lighter on `LIGHTER.t0`, drags on `EMBER.drags`, the exhale on `EXHALE.t`.
- Engine first (one fixed API for the layers): `src/audio/` (DSP primitives, spatializer, mixer with buses and a
  PS1-style reverb, BS.1770 loudness meter and normalization with a peak limiter, WAV writer), `scripts/sound.js`
  (render to `out/sound.wav`), audio muxed by `scripts/capture.js --audio`, audio checks in `scripts/verify.js`, and
  playback in the HTML player (rendered in a worker, video slaved to the audio clock).
- Then four layers in parallel (ambience, car, foley, score), merged and mixed, then measured: onset times against the
  events, stereo placement against the picture, integrated loudness and true peak (ffmpeg as the reference meter),
  spectrograms. The director's ears are the real gate.

### S8.1  The audio engine and the ambience bed
- Actions: `src/audio/` written: `dsp.js` (noise, one-pole and RBJ biquad filters, envelopes, a Freeverb-style reverb
  standing in for the PS1 SPU's), `spatial.js` (listener from `cameraAt`; pan, inverse-distance level, air lowpass,
  quieter and darker behind the camera; gains ramped across each 256-sample block so a cut never clicks), `mix.js`
  (layers into `amb`, `fx` and `music` buses, reverb send, 25 Hz master highpass, the picture's 3 s fade in, a 1.5 s
  fade out), `loudness.js` (BS.1770-4 integrated loudness, a lookahead limiter), `wav.js` (16-bit with seeded TPDF
  dither), `index.js` (the layer list, the context). `scripts/sound.js` renders `out/sound.wav` and its stats.
  The ambience layer: wind (louder on the deck), the city far off, the lamp's 120 Hz hum at the lantern, the river
  under the deck. Car, foley and score are silent stubs with their config blocks, so each is built in its own files.
- Found: a single normalize pass came in 1.5 LU under the target on a signal with loud bursts, because limiting the
  bursts takes their energy out of the measurement. `normalize` now corrects the gain and limits again from the
  unlimited signal until it reads the target (at most 4 passes). The control test plants 5 ms bursts that go over 0 dBFS.
- Measured: the 112 s soundtrack renders in about 5 s in Node; our meter and ffmpeg's ebur128 agree to 0.2 LU;
  the master reads -16.0 LUFS and its true peak (ffmpeg) is under -1.5 dBTP.
- Gate: 93 tests pass (8 new in `tests/audio.test.mjs`, each with a planted fault); forbidden, build, determinism,
  cameras pass.

### S8.2  The car, the foley and the score
- Before: ambience only; car, foley and score were silent stubs.
- Actions: `src/audio/events.js` (one-shots with their own voice and spatializer while they sound; seeded grains).
  Car (`layers/car.js`): a four-cylinder engine from rpm and throttle that follow `carAt` (firing pulses with per-cycle
  variation and a burble, the intake at the front and the exhaust at the rear of the car), tyres on snow that crunch
  slower as it stops, the brake creak, the settle, both doors (latch, seal, hinge; thunk and latch), the key and the
  run-down, hot metal ticks. Foley (`layers/foley.js`): a step per landing in `footprintList()` by surface and person,
  cloth at the lean and A's turns, the lighter with the flame following `lighterFlicker`, three drags with the paper
  crackling with `emberLevel`, the exhale. Score (`layers/score.js`): the cue in SOUND.md, with held common tones, a
  pad filter that opens at moonrise, FM bells and a sub, the bus low-passed at 9 kHz.
- Found and fixed:
  - The car was 20 dB under the night bed in shot 3 (26 m away, physical distance law): loud and intimate sources now
    get their own law (car (3 m, 0.6), foley (2.5 m, 0.7)); the ambience bus went to -9 dB.
  - The limiter worked 5 dB on the cruising engine: a soft saturation on the exhaust and the car 2 dB down; now 1 dB
    on its peaks only.
  - The master's true peak was -1.1 dBTP with every sample under -2 dBFS (inter-sample overs on snow transients): the
    limiter now detects true peaks on a 4x windowed-sinc interpolation (checked on a sine at fs/4: samples 0.707,
    true peak 1.000). Now -2.0 dBTP by ffmpeg.
  - Octave bands showed 63 Hz as the loudest band from 44 s on: the score's sub down 9 dB, the idle's 26 Hz
    fundamental high-passed out of the exhaust, the master highpass from 25 to 35 Hz.
  - One of A's steps (39.29, 146 ms after the last) read 34 ms late: its toe roll triggered the detector. A quick step
    now rolls onto its toe within 40 percent of the gap, and the step check uses a 50 ms minimum gap.
- Measured: every door, the settle and the key on their cue to the sample; 63 steps within 5 ms of their prints; the
  lighter on 78.6; all 14 bell notes within 5 ms. The car's balance matches the predicted pan within 0.11 dB.
  The master: -16.0 LUFS, -2.0 dBTP, LRA 6.7 LU, rendered in 11 s.
- Gate: 15 audio tests pass (7 new in `tests/sound-layers.test.mjs`, each with a planted fault).

### S8.3  Sound in the player and the exports; the mix pass
- Before: the soundtrack existed only as `out/sound.wav`; the MP4s and the player were silent.
- Player: `src/audio/worker.js` renders the soundtrack as the page opens (inlined with `?worker&inline`, so the single
  HTML file still works from disk); the Sound button (or M) plays it once rendered, from a click as browsers require.
  While it plays, the picture's time is the audio clock's less the output latency, and a seek, pause or shot button
  restarts the source at the picture's time. Measured: Chromium's render equals Node's on all but 161 of 10.75
  million samples, and those differ by one float32 step (about -144 dBFS; the last bit of a math function), so
  `tests/sound-player.test.mjs` holds the player to one step, with equal stats, and a planted two-step change fails.
- Export: `capture.js --audio` muxes the WAV as AAC-LC 48 kHz stereo at 320 kb/s, trimmed to exactly the captured
  frames; `npm run export` renders the sound first. `scripts/mux.js` puts a new mix into a finished export with the
  video stream copied (its MD5 checked equal), so a remix needs no new frames. `verify.js` check 5: the WAV is what the
  code renders today (byte for byte), the MP4's audio is in sync with it (cross-correlation, three windows), the same
  loudness within 0.3 LU, ffmpeg's true peak at or under -1 dBTP. Tests: AAC args, a capture with a click track
  (clicks within 1 ms of their times, a planted 5 ms shift found), mux (picture unchanged, click 1.5 s into a clip
  that starts at 10 s).
- Mix pass, per shot (master LUFS): the bridge shots read -14.5 to -15.5, louder than the car's idle in shot 5,
  because the wind on the deck was +5 dB. The brief: the car is the only loud thing, the bridge beats are small and
  close. `bridgeWindBoost` 0.8 to 0.35. Now: shots 1 and 2 at -21.2 and -19.7 (the hush), shot 3 at -11.4 (the car,
  the loudest moment), 4 to 9 at -16.1 to -18.6, 10 (moonrise, the score opening) at -14.4, 11 to 14 at -15.9 to
  -16.7, 15 at -17.1.
- 1080p: the first export (old mix) was remuxed with the new one; verify passes: the frames as before (worst frame
  570 at 2.497 and 37.9 dB, identical to Stage 7), the WAV current, sync lag 0 samples in all three windows
  (correlation 0.997, 1.000, 1.000), -16 LUFS, true peak -1.7 dBTP.
- Template: the engine, an example ambience layer (wind, and the lamp's hum dipping with its flicker), sound.js,
  mux.js, capture and verify with sound, the player's Sound button and the tests; 65 template tests pass. Playbook:
  Stage 5.5 Sound in process.md, a Sound section in techniques.md.
- Found: `pkill -f` with the capture's command line also killed the shell running it and the background chain
  (the second time in this project); noted in the repo's CLAUDE.md: kill by PID.
- The cut check's planted fault was a fixed +0.3 step at the middle cut; the new mix's neighbourhood there grew, so
  the control stopped firing while the check itself passed. The control now plants a step three times over that
  cut's own line, so it scales with what it tests (film and template).
- The 4K capture with the earlier mix was stopped: the director asked for sound effects first, through the same
  plan, storyboard and blockout stages as the picture (Stage S0 on). The 1080p with the S8.3 mix stays as the
  listening copy.
- Gate for this commit: 105 tests pass; forbidden, build, determinism, cameras pass.

## Sound stages (effects first)

The director, after S8.3: "Sound effects first. Focus only on sound effects. Use the same workflows to plan the sounds
then do a blockout. I'm sure you can see the preferred workflow evolving and emerging here...no? Did you storyboard the
sounds like you did the other stuff?" No: Stage 8 went from a cue table straight to finished layers. The sound restarts
at Sound 0 and runs through the picture's gated stages (ROADMAP.md, Sound stages).

### Sound 0  Plan
- Before: four finished layers with about 20 typed numbers the picture already knows, no storyboard, no blockout.
- Actions: the research, draft and critique workflow (playbook/workflows/research-draft-critique.js, adapted): five
  readers (a spotting session measured from the picture's data, an inventory of the sound code, the picture's process
  mapped onto sound, film sound practice, PS1 audio from cloned primary sources), a draft, three critics (facts, sound
  and PS1 accuracy, the director's advocate) and a revision. 10 agents. Wrote `SOUND-PLAN.md` and the Sound stages in
  `ROADMAP.md` (with a correction: Stages 3 to 7 shared round-03, so sound rounds start at round-04). Superseded notes
  in `SOUND.md`, `playbook/process.md` Stage 5.5, `template/ROADMAP.md` and the root `CLAUDE.md`.
- Found (measured, details in the plan): the car's arrival is inverted (loudest at 19.0 s, 21.9 m, quieter as it comes
  in: -23.5 dB at the cut to shot 4); the engine stops at 36.2 s with both people outside and both doors shut; the
  river plays on the street where no water can be seen; the wind steps at 10 of the 14 cuts because it reads the
  camera; the tick list in SOUND.md had already drifted (says 75, last tick 71.179); visible actions with no sound (door
  swings to shut, door stops, getting out, turns in place, cloth on the walk, the shoulders closing in); step contacts
  lead their print times by 0.2 to 20.3 ms.
- Decision: you asked for the plan then the blockout, so Sound gates 0 and 1 run on the plan's defaults and their
  questions travel with Sound gate 2, the first stop.
- Gate for this commit: documents only, no code changed since 0b82298 (whose gate passed: 105 film tests, 66 template
  tests, every check); the forbidden-character scan passes on the film, the template and the repo.

### Sound 1.1 to 1.3  The cue catalogue
- Before: cue times and places typed into the parked layers.
- Actions (builders with checkers, playbook/workflows/builders-with-checkers.js adapted: one builder in worktree
  s1-cues, one checker, one fix pass): `actors/car.js` exports SHAPE, DOOR_SIDE, STEER_MAX_DEG, SETTLE, IDLE, doorOpen,
  steerDeg, settlePitch, idleLift; `world.js` exports X_START and SPEED_W; `actors/people.js` exports dims. Exports only:
  567 frames hash the same before and after, the built HTML is byte identical, determinism and cameras pass.
  `src/audio/cues.js`: 148 cues (145 enabled, 3 offered and off, 38 new), every time and place from a picture function,
  everything else a named designed value or rule (LEVELS, DESIGN, LAW_OF). Steps sound at the rig's contact on the
  sample grid (0.17 to 20.33 ms before their prints); 63 steps from 64 prints; 10 door cues; the arrival swell from the
  first instant any part of the car's front is seen (17.47); ticks by a seeded rule ending before the moonlight rises;
  rig contacts by one rule: the parts within half an internal pixel of their rest, at their depth from the shot's
  camera (the forearm rests land 9.9 and 7.4 ms before the first frame that shows them; A's hands close on the lighter
  at 78.069). `tests/cues.test.mjs`: 15 checks.
- Question 2 measured: the idle shake shows. The car's vertices move up to 1.24 internal px before the PS1 snap and 2 px
  after, in 110 of 159 frames; renders with and without it differ in 117 frames, up to 255 levels at the car's edge
  against the beam glow (36.04 to 36.25). So option (b): the engine runs down at 36.2 with the lights, no key click.
- The checker re-derived every cue on its own (zero mismatches over 1e-6 s or 1 mm) but its 24 planted faults found
  the tests weak (7 caught): no place checks, a tick test that read its own answer, rule families never checked for
  completeness, one typed settle tail, a typed 1.8 m height, the law stored as an object, the forearm contact landing
  21 ms after its frame. All fixed; 35 of 35 planted faults now caught.
- Open: Sound 1.3's per-shot margins are not all met with one level per cue (shot 8's far steps +0.1 to +2.2 dB and
  shot 13's drag and exhale +0.5 dB against the +6 dB rule; some midground cloth and the ticks under 0 dB; shot 3's
  brake pads -4.3 dB). Carried to Sound 2 (perspective, the hold rule) and Sound 5. The parked stems' comparison column
  is still to do. cues.js still imports surfaceOf from the parked layers/foley.js; moved before Sound 4.
- Found about my own commits: the six commits before Sound 1 carry a co-author trailer that names a model, against this
  repo's rule. Rewriting them needs a force push, which was not allowed here; from now on the trailer names no model.
- Gate: 120 tests pass; forbidden, build, determinism, cameras pass.

### Sound 1.4 to 1.13 and Sound 2.1 to 2.4  The storyboard, the stage switch, the captions
- Before: the cue catalogue only.
- Actions: four builders in parallel worktrees, each followed by a checker and a fix pass (builders with checkers,
  adapted). Two usage limits stopped them partway; each resumed from its worktree's gated commits.
  - checks (s1-checks): `scripts/lib/sound-checks.js` (the 15 checks of SOUND-PLAN 4.3, film-generic),
    `scripts/sound-report.js` (the film's glue: orders, windows, blockers, sync events), `scripts/lib/perturb.mjs` and
    its module hooks (Sound 1.5: 17 perturbations, each in a child process), a vertical-axis guard in `spatial.js` (the
    first-pass render stays byte identical, sha256 f80b1542), tests with planted faults. The checker's high finding
    (the far door judged on screen through the car body) and five medium ones fixed.
  - board (s1-board): `scripts/sound-storyboard.js` with `lib/sound-map.js`, `sound-timeline.js`, `sound-panel.js`:
    the sound map, 4 detail maps, the timeline drawn like a DAW arrangement, 15 panels, the contact sheet, Excalidraw
    (1491 elements in and out). The checker found hidden sources drawn as on screen, the engine drawn at full level from
    14.0 (the rise ignored) and the bridge beds drawn as quieter: fixed, with the drawn levels and pans now tested.
  - blockout (s2-blockout): `config.audio.stage` ('blockout' default, 'design' the first pass) and `audio.parked`
    (['score']); `src/audio/layers/blockout/` (placeholders that read only cues.js); the score tests split out and
    guarded; verify reads old sidecars as "made before the switch". The design stage with the score unparked renders
    byte identical to the first pass. Voices timed exactly (each cue rendered alone before the master); the crossfade at
    the place change checked.
  - captions (s1-captions): `scripts/lib/captions.js` (review and SDH tracks, VTT, SRT, ASS), `scripts/spotting-reel.js`
    (the 1080p picture with soft subtitles, video copied bit for bit; a 480x270 phone copy with the captions burned),
    `capture.js --captions` and `--burn-captions`. The checker found the burned layout reflowing frame to frame and the
    soft track wrapping past 3 lines: sticky layout, a fitted font size.
- Merged: the four branches touch disjoint files. The merged gate found one interaction (the checks' spatial test used
  the `LAYERS` export the blockout replaced): ported to the stage API.
- Self-review of round 04 (`review/round-04/notes.md`): the run-down was planned 2 dB over the idle it continues
  (now equal); shot 5's panel frame was black (the panels now show lifted frames, labelled). Two rulings: "feet before
  the people" allows feet out of frame (the plan's 3.7 keeps B's off-screen steps); density counts bodies, not voice
  groups (a car's parts fuse into one stream the ear follows). Their tests now check the rulings, with the old rules as
  planted controls.
- Report: 14 of 15 checks pass or report; sync finds 12 cues off their frame (6 scuffs, 6 cloth moves timed from keys),
  carried to Sound 3.
- Gate for this commit: 205 tests (202 pass, 3 skipped: the parked score, each with its printed reason); forbidden, build, determinism, cameras pass.

### Sound 2.5 to 2.12  Measurement, the options, then the review set (before)

- Plan: two builders in parallel worktrees, each followed by a checker and a fix pass. `s2-measure` takes Sound 2.5
  to 2.7 (the measurement tooling with planted faults, `scripts/sound-review.js --measure`, `measure.json`, the stems,
  the blockout loudness target chosen by measurement, the design-layer drift). `s2-options` takes Sound 2.12 (the four
  options rendered and measured, with clips). Then the audio stills and the arrangement sheet (Sound 2.9) on top of
  `measure.json`, the preview (2.8), and the independent panel (2.10).
- Found before starting: at the -16 LUFS target the blockout's limiter takes up to 11.2 dB off shot 5 (30.4 s) and
  10.3 dB off shot 4, 960753 samples limited (raw mix -22.2 LUFS, peak 9.2 dB over the ceiling after gain). Measured
  levels and onsets in the master would be the limiter's, so the measurements read the stems before the master, and
  the blockout's own target is chosen by measurement (SOUND-PLAN 3.18 keeps integrated loudness at or under -16).

#### s2-measure: Sound 2.5, the measurement tooling (before)
- Plan: in `scripts/lib/audio-analysis.mjs`, onsets to the sample, cue ends, sync on the measured onset (showingFrame
  and the film's syncRule, exported from `scripts/sound-report.js` with report.json byte identical), momentary and
  short-term loudness (the K-weighting `loudness.js` uses, exported), third octaves (IEC 61260 centres), the phone
  and mono fold-down, the limiter's loss per window. Planted faults in `tests/sound-measure.test.mjs`.
- Before: the design stage with the score unparked renders sha256 f80b1542... (checked, out/round-05/design-check.wav).

#### s2-measure: Sound 2.5, the measurement tooling (after)
- Added to `scripts/lib/audio-analysis.mjs`: `preciseOnsets` (onsets() and it share one detector; onsets() returns the
  same times on all 30 voice groups' stems), `soundingEnd`, `syncOf`, `kBlocks`, `loudnessSeries`, `momentary`,
  `shortTerm`, `seriesSummary`, `limiterLoss`, `loudestWindow`, `powerDb`, `energyBlocks`, `THIRD_OCTAVES`,
  `butterBandpass`, `thirdOctaveBank`, `bandLevels`, `segment`, `PHONE_SPEAKER` (its sources beside it), `foldDown`,
  `measuredDensity`. `kWeighted` exported from `loudness.js`, `syncRule` from `sound-report.js` (report.json
  regenerated to scratch: byte identical).
- Measured: precise onsets of all 93 one-shots on their group stems within 2.0 ms of their cues (the door swings
  open the latest; corrected after the checker: not "a sine from zero", which crosses -60 dBFS 0.06 and 0.08 ms
  after t0, but the detector firing again on the unlatch's tail every 30 ms, held back by its gap; see the checker's
  fixes below); the meters against ffmpeg ebur128: 0.0008 LU momentary, 0.0007 LU short-term;
  the third-octave bank: 0.034 dB in band, 18.2 dB down in the neighbours to 2 kHz, 12.2 dB at 16 kHz.
- `tests/sound-measure.test.mjs`: 11 tests, each with its planted fault (a step 5 ms late reads 5 ms later to the
  sample and 6 ms late fails the bar; a ghost onset one to one against nearest match; a cue 50 ms short; a step one
  frame late fails sync; swapped channels; one hop out of step against ffmpeg; an RBJ biquad as a third octave; a
  pumped window against a limited click; anti-phase in mono; a louder engine joining the density).

#### s2-measure: Sound 2.6, scripts/sound-review.js and a target per stage (before)
- Plan: `config.audio.targetLufs` per stage (the design stage stays -16 and byte identical), read by
  `loudness.js targetOf` in `normalize`, so renderSoundtrack, renderAll, `scripts/sound.js`, the player's worker and
  `verify.js` check 5 all follow the stage; the sidecar names its target. `scripts/sound-review.js --measure`: one
  session, the 15 measures of SOUND-PLAN 4.5 into `review/round-05/measure.json`, the stems, the sweep.

#### s2-measure: Sound 2.6, scripts/sound-review.js and a target per stage (after)
- `config.audio.targetLufs` is `{ blockout: -23, design: -16 }`; `loudness.js targetOf` reads it in `normalize` (which
  also takes the source's true-peak envelope when the caller has it); the sidecar of `scripts/sound.js` names its
  target; `verify.js` check 5 reports the target and says when a WAV was made at another. The design stage with the
  score unparked still renders sha256 f80b1542... (checked).
- The sweep (the raw blockout at -22.19 LUFS, normalized from -16 down in 0.5 dB steps): at -16 the worst 400 ms
  window loses 7.94 dB at 28.3 s (shot 4, the car arriving at full drive with the swell), 960753 samples limited;
  -22.5 still loses 1.06 dB there; -23 loses 0.63 dB at worst (worst sample 2.52 dB at 30.44, the driver's unlatch),
  23145 samples limited, true peak -2 dBTP, the street background in the hush -31.47 LUFS momentary. Every quieter
  target meets the rule too. So the blockout's target is -23.
- `scripts/sound-review.js --measure`: one session (the raw render twice, the mix before the master, 30 voice-group
  stems, 18 cues rendered alone, the bodies, the design parts), 15 entries; 4.5 min alone on 4 CPUs.
- Tests: `tests/audio.test.mjs` reads the default stage's target instead of -16 and checks targetOf (with a stage
  the table lacks as its control); `tests/sound-measure.test.mjs` gains 12 tests of the review's measures, each with
  its planted fault. Gate: 229 tests (222 pass, 7 skipped: the parked score, and 4 reel tests with no published
  export in this worktree); forbidden, build, determinism, cameras pass.

#### s2-measure: Sound 2.6 and 2.7, measure.json, the stems, the drift (before)
- Plan: run `node scripts/sound-review.js --round 05 --measure` at the chosen -23 and commit its outputs:
  `review/round-05/measure.json`, the listening stems and `stems.json`, and `review/round-05/notes-measure.md`.

#### s2-measure: Sound 2.6 and 2.7, measure.json, the stems, the drift (after)
- `review/round-05/measure.json` (15 entries; the same bytes on two runs; its mastered render is the same WAV
  `scripts/sound.js` writes, sha256 610a1d0e...): renderer pass (93 of 93 within 5 ms, worst 2.0 ms); sync fail (20:
  Sound 1's 12, and 8 instants on their frame's own time read 0.02 to 0.21 ms after it); pan pass (worst 0.101 dB);
  silence, voices (2 crossfades of a background, intended), density (3 bodies at most), determinism and stems
  (9.7e-8) pass; phone and mono fail (both latches only below 250 Hz on measured bands); level, ends, loudness,
  masking (27 of 136 cues at risk per band) and drift (72 of 93 one-shots matched, 18 missing, 102 extra onsets)
  reported; target pass (-23).
- Listening stems `review/round-05/stems/` (night, car, A, B; AAC 96 kbps, 0.39 to 1.37 MB; `stems.json`): at the
  mix's gain, summing to the mix before its limiter within 9.0e-8 of the peak. Measuring stems, 30 float WAVs, in
  `out/round-05/stems/` (not committed).
- Notes: `review/round-05/notes-measure.md`. Gate: 229 tests (222 pass, 7 skipped), forbidden, build, determinism,
  cameras pass.

#### s2-measure: sound-review.js reads its window and flam from the source (before)
- `stems.json` names its round and stage (the run that wrote the committed one already did); the review's window is
  `LEVEL.windowSec`, the detector's floor gap `DESIGN.STEP.flam`, the ring `BLOCK / sr`: the same numbers, read
  instead of typed. Check: measure.json and stems.json the same bytes after a fresh run; the full gate.

#### s2-measure: sound-review.js reads its window and flam from the source (after)
- A fresh `--measure` run wrote measure.json and stems.json byte identical to the committed ones. Gate: 229 tests
  (222 pass, 7 skipped), forbidden, build, determinism, cameras pass (one gate was stopped by a time limit while the
  other builder's gate shared the CPUs, and rerun alone: 417 s). The design stage with the score unparked renders
  sha256 f80b1542f97013ccb37b9e9cd36e940bea524efcd9a2a47da9bbb55bf8c611da.

#### s2-measure: the checker's findings and the fix plan (before)
- An independent checker found nine things (F1 to F9). High: the detector fires again on a tail that is still
  sounding, once every minGap, and the renderer accepted those re-fires inside a cue's span, so 5 of the 93 one-shots
  passed with their own audio moved 6 ms early (some at 30 to 50 ms), and 6 committed onsets were hop times after a
  re-fire (F1); the "onsets to the sample" control could not fail (F2). Medium: the sync edge note had no upper bound
  (F3); the 49 continuous voices had no renderer bar (F4); the stems' sum was claimed for the AAC files, where it holds
  only for the float renders (F5). Low: the schema left out `hush` (F6); the drift notes misread the rustles (F7);
  check 5 said nothing about a WAV from before the per-stage target (F8); comments and SOUND.md (F9).
- Checked before planning (scratch, builder-s2-measure): each of the 142 voiced cues rendered alone starts within
  0.031 ms of its expected start (one sample after t0; a background half the crossfade before), and every group's stem
  equals the sum of its cues rendered alone within 8.2e-8 of its peak; the 142 alone renders take 35 s. Moving a cue
  in the cue list does move its audio (B.03 moved -6 ms changes the stem from 34.594 s), so both kinds of plant are
  misplacements; only the detector missed them.
- Plan, four gated commits: (1) the renderer reads every voiced cue's onset on its own render, cross-checks each group's
  stem against the sum of its cues alone, and judges every voiced cue (F1, F4); the sync edge note bounded by that
  reading's lag (F3); the hop control (F2); the schema and comments (F6, F9); (2) the listening stems: the float sum
  tested, the AAC files' own error measured (F5); (3) verify check 5 and SOUND.md (F8, F9); (4) measure.json,
  stems.json and the notes rerun on the fixed code (F7's correction there).

#### s2-measure: the renderer reads each cue alone (before)
- Plan: `measureGroup` reads every voiced cue's onset as the first sample that is not zero of the cue rendered alone
  (memoised by cue, renders not kept), and the group's stem against the sum of its cues alone (a planted cue played
  at another time through `played`, or a stem that is not that sum). `rendererEntry` judges all 142 voiced cues
  (a background against bedSpan's start), one row per group for the sum, and the detector's strays as before. The sync
  edge note only within the reading's lag (1.5 samples). The hop control planted at 5.5 ms. Tests for each, on the
  closest pairs (B.02 and B.03, A.12 and A.13, both doors' unlatch and swing open, the flame and the release) 6 ms
  early and late, each shown to fail.

#### s2-measure: the renderer reads each cue alone (after)
- `scripts/sound-review.js`: the session keeps each cue's onset (the first sample that is not zero of the cue alone)
  and each group's sum of its cues alone; `measureGroup` reads every onset there (`played` plants a cue the renderer
  misplaced, `stem` one that is not the sum), and its `method` column is now `read` (where the end and the window are
  read, the stem or the cue alone). `rendererEntry` judges every voiced cue against `startOf` (t0, or bedSpan's first
  sample for a background), one `sum` row per group (bar 1e-6 of the peak, the stems' starting value) and the strays.
  The sync edge note only within `readLagSec` (1.5 samples). Comments for the exports the checker named; the schema
  names `hush`.
- Measured on all 142 voiced cues (scratch sens2.mjs): every cue played 6 ms early and 6 ms late in every respect
  (its span, place and track) fails on its own row and no other, and every one-shot's audio moved 6 ms early in the
  stem alone fails its group's sum: 372 of 377 plants found. The 5 not found are the three cues that start with the
  film (the street's wind and city beds and the lamp's hum, t0 0): an onset before the film's first sample cannot be
  read, and the beds start half the crossfade before t0, clipped at 0, so a shift under 25 ms either way stays there.
- `moveBy` alone does not misplace a voice whose level follows the picture: the flame moved 6 ms early by moveBy still
  starts at its first flame frame (lighterFlicker), so the tests plant with `shiftBy`, its track and place moved too.
- `tests/sound-measure.test.mjs`: 25 tests (23 before): the hop plant (A.05 5.5 ms late: its attack 0.77 ms into
  its hop, onsets() reads 4.81 ms, preciseOnsets() 5.58); the closest pairs played 6 ms early and late (own row) and
  held there by the stem (the sum); a ghost (the sum), a stray (stray and sum), four continuous voices 30 ms late; the
  latch and the intake on time (the edge note) and 10 ms late (plain "10.02 ms after its frame"). The renderer
  test's nearest-match control is gone with the matching (the tooling test keeps it). 91 s alone (28 s before).
- Gate: 231 tests (224 pass, 7 skipped: the parked score, and 4 reel tests with no published export in this
  worktree); forbidden, build, determinism, cameras pass. The design stage with the score unparked renders sha256
  f80b1542f97013ccb37b9e9cd36e940bea524efcd9a2a47da9bbb55bf8c611da.

#### s2-measure: the listening stems, float and AAC (before)
- Plan: one helper for every sum against a whole (`sumAgainst`: the group sums, the stems entry, the bodies), which
  also gives the difference's power under the whole's. The listening stems: the float bodies' sum against the raw mix
  as before, a test of it with a body left out; each AAC file decoded and measured against its float stem (the lag
  that aligns them, the coding error in dB), and the decoded files' sum against the mix, all in stems.json, so the
  notes say what holds for which.

#### s2-measure: the listening stems, float and AAC (after)
- `sumAgainst` (largest difference over the whole's peak, where, and the error's power in dB) now serves the group
  sums, the stems entry and the bodies. `listeningBodies`, `codingError` (the lag by ffmpeg.mjs `alignment` over the
  loudest second, then the error) and stems.json's `aac.lagSamples`, `aac.errorDb` and `aacSum`.
- Measured (scratch, the same m4a bytes as committed): the float bodies sum to the raw mix within 9.0e-8 of its peak;
  every AAC file aligns at lag 0; coding error under its float stem night 9.61 dB, car 17.59, A 17.68, B 15.60; the
  decoded files summed against the mix differ by up to 0.380 of its peak (at 30.44 s, the driver's unlatch), the error
  13.03 dB under the mix. So the sum holds for the float stems, not the files the director gets.
- Test: the four bodies sum within the stems bar and each one left out fails; codingError reads a planted 101-sample
  lag and an error of a tenth of each sample as 101 and -20.00 dB, a signal against itself lag 0 and no error.
- Gate: 232 tests (225 pass, 7 skipped); forbidden, build, determinism, cameras pass. The design stage with the score
  unparked renders sha256 f80b1542f97013ccb37b9e9cd36e940bea524efcd9a2a47da9bbb55bf8c611da.

#### s2-measure: verify check 5's target, and SOUND.md (before)
- Plan: `madeAtOf(sidecar)` reads the target a WAV was made at (a sidecar from before the per-stage target names none:
  -16), and `staleSound` words check 5's problem with it, so a blockout WAV made at -16 says so; a test with that
  planted sidecar and its controls. SOUND.md's two "-16 LUFS" lines say the target is per stage.

#### s2-measure: verify check 5's target, and SOUND.md (after)
- `scripts/verify.js`: `LEGACY_TARGET_LUFS` (-16), `madeAtOf`, `staleSound`; check 5 uses them, so a blockout WAV
  whose sidecar predates the per-stage target reads "made at the blockout stage, parked score, at -16 LUFS where the
  stage's target is now -23". The S8.3 sidecar (no stage, no target: the design stage, still -16) gets no note.
- `tests/audio.test.mjs`: one test, the planted pre-target sidecar and its controls (a named target, today's or
  another; a raw render; no sidecar; the S8.3 sidecar). SOUND.md: the normalization and the loudness check name the
  target per stage.
- Gate: 233 tests (226 pass, 7 skipped); forbidden, build, determinism, cameras pass. The design stage with the score
  unparked renders sha256 f80b1542f97013ccb37b9e9cd36e940bea524efcd9a2a47da9bbb55bf8c611da.

#### s2-measure: measure.json, the stems and the notes after the fixes (before)
- Plan: run `node scripts/sound-review.js --round 05 --measure` on the fixed code (twice, to check the bytes), then
  rewrite `review/round-05/notes-measure.md` from the new measure.json and stems.json: the renderer's new reading,
  the corrected 2.0 ms explanation (also in this log's Sound 2.5 entry), the sync edges, the stems' float and AAC
  sums, the drift's rustles, and each finding's disposition, the disagreements with their measurements.

#### s2-measure: measure.json, the stems and the notes after the fixes (after)
- Three runs of `--measure` (265 s each; 5.0 GB resident at most, sampled every 20 s on the first): each differs from the one before only in the text the
  code changed between them (the sync summary's single value, the drift's definition of an extra), and stems.json
  and the four m4a files are byte identical across all three and to the committed m4a; the mastered render is still
  sha256 610a1d0e...
- measure.json: renderer pass (142 of 142 voiced cues within 5 ms, worst 0.031 ms; 30 of 30 stems the sum of their
  cues alone, worst 8.2e-8); sync fail (20: Sound 1's 12, and the 8 on-frame instants now 0.02 ms after their frames,
  one sample); the six onsets the detector misread now read 0.021 ms; ends, pan, level, loudness, silence, voices,
  density, masking, phone and mono, determinism, stems, target as before. The drift's extras are said to include the
  detector's re-fires 80 ms apart. stems.json: the float sum 9.0e-8; the AAC files' sum 0.380 of the peak, 13.03 dB
  under the mix; coding error per file 9.61 to 17.68 dB.
- `review/round-05/notes-measure.md` rewritten from those files: the renderer's reading and why, the corrected 2.0 ms,
  the drift's rustles (the pats are not detected; a tolerance per cue tried, scratch drift-tol.mjs: it would match A's
  cup to a crinkle 17 ms early, a false match, so not adopted), the stems both ways, each finding's disposition, and the
  two disagreements with their measurements. The Sound 2.5 entry above is corrected in place.
- Gate: 233 tests (226 pass, 7 skipped); forbidden, build, determinism, cameras pass. The design stage with the score
  unparked renders sha256 f80b1542f97013ccb37b9e9cd36e940bea524efcd9a2a47da9bbb55bf8c611da.

#### s2-options: Sound 2.12, the plan (before)
- Before: no option switches; the hidden state, the narrower pan and the characters' listener exist only as Sound 1
  predictions (storyboard/sound/report.json checks 2 and 6). Base commit 80a432e.
- Plan: record the sha256 of the default render and of the design stage with the score unparked; add the switches to
  `config.audio.options` (all off), read by the blockout voices and the spatializer, with the hidden state handed in
  through `makeContext` by the options script only; `scripts/sound-options.js` renders each A/B through one master gain,
  measures it per cue, checks it moves only the cues it names, and captures clips; `tests/sound-options.test.mjs`
  with planted leaks; `review/round-05/decisions/` and `notes-options.md`.

#### s2-options: the switches, the measuring library and their test (after)
- Before: sha256 of `node scripts/sound.js` (the default blockout) 6f9c4925b58beaf80d2e385932b921532d3d7a558952ea589922718a18f51cb7; of the design
  stage with the score unparked f80b1542f97013ccb37b9e9cd36e940bea524efcd9a2a47da9bbb55bf8c611da (the S8.3 bytes).
- Actions: `config.audio.options` (muffle mode 'off', syncPan off, listener 'camera'); `makeContext` takes `occlusion`
  (only the options script builds one) and builds `levelAt` when the listener is 'characters'
  (`src/audio/listeners.js`, Sound 1's model); `placeAt` takes `levelAt` and `width` from a law; the blockout voices
  add them to a cue's law and apply the muffle after the level rule. `scripts/lib/sound-options-lib.js` and
  `tests/sound-options.test.mjs` (9 tests, each with a planted fault).
- After, every switch off: the same two sha256, byte for byte. Measured: the hidden state matches Sound 1's check 2
  (19 voiced cues, the same frames); each switch moves exactly the cues it names (0 stray, 0 stray samples in the
  mix); the A master replays `normalize` sample for sample.
- Gate (added at the fix pass, F8: no gate result was kept for this commit): re-run then from a `git archive e94f193`
  copy, npm test exit 0 (214 tests, 207 pass, 0 fail, 7 skipped), npm run check exit 0 (forbidden 0 hits,
  determinism 0 of 62 differ, cameras 191 comparisons, worst 2.00e-15).

#### s2-options: the options script, its measurements and clips (before)
- Plan: `node scripts/sound-options.js --round 05` measures options 1 to 3 cue by cue (A against B), checks what each
  moves, masters each set through A's gain and one limiter curve, captures 7 s preview clips at each option's moment
  into `review/round-05/decisions/`, tabulates the style-frame candidates, and writes `decisions.json`.

#### s2-options: the options script, its measurements and clips (after)
- Actions: `scripts/sound-options.js` (`--round 05`, about 5 min; `--no-clips` about 2). `review/round-05/decisions/`:
  `decisions.json` and 10 preview clips of 7 s (7.3 MB) with their capture sidecars; the mastered WAVs in
  `out/round-05/options/`. Two runs give the same WAVs and the same rows.
- Measured (per cue, before the master): the volume muffle takes 6.00 dB off all 19 hidden cues; the swap 1.9 dB off
  the engine (its 650 Hz buzz is under the 900 Hz cutoff), 57 to 59 dB off the cabin's clicks. The narrower pan moves
  28 of 74 sync foley cues by 0.1 or more (up to 0.40, B's off-screen steps in shot 5). The characters' listener moves
  98 of 125 cues by 1 dB or more, all louder, up to +11.4 dB (shot 8's far steps). All three: ask the director.
- Found: the intake and exhaust placeholders are phase-locked (the same saw from the same rpm track) and add
  coherently in the mix; Sound 1's blockers hide the exhaust behind its own car 229 frames; through A's own limiter
  curve the listener's B would reach +7.9 dBFS, so each set shares one curve from its loudest mix.
- Style frame: the default (shots 4 to 6) against 4 to 5, 5 to 8 and 11 to 13, picked by rule.
- Gate (added at the fix pass, F8: no gate result was kept for this commit): re-run then from a `git archive 0143d4e`
  copy, npm test exit 0 (214 tests, 207 pass, 0 fail, 7 skipped), npm run check exit 0 (the same three PASS lines).

#### s2-options: the notes (before)
- Added at the fix pass (F8); no 'before' entry was written at the time. The step, from its commit a7b262d: write
  review/round-05/notes-options.md from decisions.json for the lead to merge into notes.md.

#### s2-options: the notes (after)
- `review/round-05/notes-options.md` for the lead to merge: how each A/B was made, each option's definition, starting
  values and why, numbers, clips, what a placeholder can and cannot show, the call, and my recommended default (no
  muffle, the physical pan, the camera as listener, shots 4 to 6); three findings beyond the options.
- Byte identity before this last commit: the default render 6f9c4925..., the design stage with the score unparked
  f80b1542... (the S8.3 bytes), as before the branch.
- Gate (added at the fix pass, F8, from the builder's own logs, written 02:35 to 02:41, just before this commit at
  02:41; no exit status was kept): npm test 214 tests, 207 pass, 0 fail, 7 skipped; npm run check, forbidden 0 hits,
  determinism 0 of 62 differ, cameras 191 comparisons, worst 2.00e-15.

#### s2-options: the checker's findings F1 to F9, the plan (before)
- Before: HEAD a7b262d. The checker's gate there: npm test exit 0 (214 tests, 207 pass, 0 fail, 7 skipped), npm run
  check exit 0; the default render 6f9c4925..., the design stage with the score unparked f80b1542... (S8.3).
- Plan, in three gated commits. (1) The checks: the muffle's timing per block and its ramp, and the swap's copy in
  step (F1, planted f1, f2, f8); the characters' listener keeping the camera's pan and air, and its point equal to
  sound-report.js's at every frame (F2, planted f7, f4); a misspelt listener or a syncPan kind naming no cue refused
  (F7). (2) The options script: the muffle with the set's blockers only (a car's own body does not hide its own
  sounds), rendered, measured, clipped and split by blocker (F4); the listener set mastered through one static gain
  with no limiter in its clip (F3); the header and CLIP_SEC comments (F5); decisions.json and the clips rerun.
  (3) The notes (F3, F4, F6, F9) and this log (F8).

#### s2-options: F1, F2 and F7, the checks (before)
- Plan: export voices.js `muffleOf` so a test reads the muffle's gain sample by sample; measure the intake (hidden
  14.000 to 17.875 s) under each mode before setting any bar; export sound-report.js `charactersAt`; refuse unknown
  listener values in `makeContext` and syncPan kinds that name no voiced foley cue in `lawOf`. Each new check is shown
  failing on the checker's planted f1, f2, f4, f7 and f8.

#### s2-options: F1, F2 and F7, the checks (after)
- Actions: voices.js exports `muffleOf`; `lawOf` refuses a syncPan kind that names no voiced foley cue of the film;
  `makeContext` refuses a listener other than 'camera' and 'characters' (listeners.js `LISTENERS`); sound-report.js
  exports `charactersAt`; listeners.js and sound-report.js say "the people out of the car, seen or not" (F6).
  tests/sound-options.test.mjs gains four tests: the muffle's gain sample by sample (settled to the drop or 1 a block
  and rampSec after each change, never faster than the whole drop in rampSec) on all 19 hidden cues and a planted
  toggle, and the swap against its definition (a copy filtered on every sample, measured within 3.3e-16); the intake
  in the render (-6.000 dB over 14.000 to 17.875 s, its ramp within 0.0017 dB of a linear one, today's samples from a
  block and rampSec after 17.875 s, the last differing sample 52.4 ms after it); the listener's point equal to
  charactersAt on every half frame, 37 continuous cues within 0.024 dB of the model in 1596 steady windows, pan, air
  and distance the camera's at every block edge, each stem's balance within 0.0014 dB of the camera's pan; refused
  values. Bars: RAMP_TOL_DB 0.05 and STEADY_DB 0.5 are starting values set from those measurements.
- Planted on copies of this tree, `node --test tests/sound-options.test.mjs`: f1 (state read at the onset) and f2 (no
  ramp) fail 2 tests each, f8 (copy filtered only while heard) 1, f4 (listener at the roots) 1, f7 (pan halved under
  the listener) 1, no listener check 1, no kinds check 1; every other test passes on each.
- Gate: npm test exit 0 (218 tests, 211 pass, 0 fail, 7 skipped, the same 7 as before); npm run check exit 0
  (forbidden 0 hits, determinism 0 of 62 differ, cameras 191 comparisons, worst 2.00e-15). The design stage with the
  score unparked f80b1542... and the default render 6f9c4925..., as before.

#### s2-options: F3, F4 and F5, the options script (before)
- Before: decisions.json measures the muffle with Sound 1's hidden state only, which counts a car's own body; the
  listener set shares one limiter curve driven by B's steps; two comments in scripts/sound-options.js do not match.
- Plan: `occlusionFrom(..., { ownBodies: false })` leaves out the boxes sound-report.js marks `own`; the muffle is
  measured with both hidden states ('set', its B, and 'all', Sound 1's), its rows split by blocker and the engine
  clip by part (the rise, the intake behind building SE at full level, the intake in view); clips for both at the
  engine, the set's at the car. `masterOf` gains `still`, one static gain under A's with no limiter, for the listener
  set; every clip reports what its master takes off A in 10 ms windows. Tests: the set's state against Sound 1's
  frame for frame, the switches with it, the still master. Then the script rerun with clips.

#### s2-options: F3, F4 and F5, the options script (after)
- Actions: lib `occlusionFrom` takes `ownBodies` and records whether each frame's blocker is the cue's own body;
  `muffleRow` splits by blocker; `masterOf` gains `still`; `coherenceOf` (the engine's coherence, now in
  decisions.json, F9). The script measures the muffle by the set (B, 14 cues) and by Sound 1's rule (19), clips both
  at the engine and the set's at the car body, masters the listener set through one static gain 12.01 dB under A's
  with no limiter, and reports each clip's A against today's master in 10 ms windows. Header and CLIP_SEC comments
  fixed (F5). Tests: the set's hidden state is Sound 1's less the own-body frames, frame for frame; each switch by
  the set; the still master; coherenceOf. Planted on copies: occlusionFrom ignoring `ownBodies` and the still gain from
  A alone each fail one test of the file (13 pass); a coherence ignoring where a render starts fails its test.
- Rerun `node scripts/sound-options.js --round 05` (4.5 min): 12 clips of 7 s (9.3 MB with decisions.json), each
  moment's clips with identical decoded video. Engine clip, B against A, by the set: -1.33 dB (volume), -1.00 (swap);
  by Sound 1's rule -2.19, -2.56. By part: the rise -1.78/-0.85 under both; the intake behind building SE at full
  level -4.59/-1.71 under both; the intake in view -0.41/-0.76 by the set, -1.55/-3.41 by Sound 1's rule. The car
  moment moved to 28.250 s (the door cues are no longer hidden): -0.11/-0.12 dB by the set. The listener clip: +6.37
  dB; the shared curve would have taken 1 dB or more off its A in 107 of 700 windows (worst -8.68), the still master
  takes none; today's limiter takes 1 dB or more in 11 (worst -4.45). The muffle and pan clips' A: at most 2 of 700
  windows 1 dB or more under today's master (worst -1.11).
- Gate: npm test exit 0 (220 tests, 213 pass, 0 fail, 7 skipped); npm run check exit 0 (forbidden 0 hits,
  determinism 0 of 62 differ, cameras 191 comparisons, worst 2.00e-15). Default render 6f9c4925... and `a.wav` the
  same bytes; the design stage with the score unparked f80b1542... (S8.3).

#### s2-options: F6, F8 and F9, the notes and this log (before)
- Plan: rewrite review/round-05/notes-options.md from the rerun decisions.json (the muffle by the set and by Sound 1's
  rule, the still master and the clips' A against today's master, the listener's definition, the continuous cues' gap,
  the phantom as an inference, the checks, the checker's findings with what changed and one disagreement); add the
  missing 'before' entry and the gate results to the first three sub-entries above, marked as added at this pass.

#### s2-options: F6, F8 and F9, the notes and this log (after)
- Actions: review/round-05/notes-options.md rewritten from the rerun decisions.json: the muffle by the set and by
  Sound 1's rule with the engine clip by part and a recommendation reworded on that split; the listener's still
  master and every clip's A against today's master; the listener as the people out of the car, seen or not, with the
  continuous cues' 6.92 dB gap to the onset prediction and why; the phantom as an inference; 15 checks; the checker's
  findings and what changed, with one measured disagreement (F2: the hum's stem balance is 0.82 dB from A's by
  design, so balances are held to the camera's pan law). The rampSec reason in the script now counts the block
  latency (55 ms, not "8 ms into the next frame"); the rerun gave the same 12 clips byte for byte and a decisions.json
  that differs only in that sentence. This log: the gates of the first three commits and the notes' 'before'.
- Gate: npm test exit 0 (220 tests, 213 pass, 0 fail, 7 skipped); npm run check exit 0 (forbidden 0 hits,
  determinism 0 of 62 differ, cameras 191 comparisons, worst 2.00e-15).

#### lead: the merge, the engine's phase, the sync ruling (before)
- Merged s2-measure and s2-options (both checked and fixed). The merged gate found one interaction: `masterOf`
  (sound-options-lib) read `targetLufs` as a number, and it is per stage since s2-measure. It now reads `targetOf`.
- The engine's placeholders: the intake's and the exhaust's buzzes are one saw from one rpm track, in phase, so they
  add coherently (power of the sum over the sum of powers 1.86 over the drive, 1.54 over the idle, by cue span): the
  engine is louder in the mix than its two planned levels. A placeholder fault, fixed before the preview: each voice
  group's buzz starts its own share of a firing period in (`TIMBRE.engine.startRatio`, the exhaust half a period).
- Sync, the lead's ruling: an instant on its frame's own time whose onset reads within the reading's lag (1.5 samples)
  after the frame is on its frame and passes, with its note. The measure cannot tell the two apart; BT.1359 puts the
  threshold for late sound near 125 ms. The 12 real misses (Sound 1's) still fail.
- Accepted as they stand: the crossfade ruling (two beds of one family overlapping inside `TIMBRE.crossfadeSec` are
  intended); the group-sum bar 1e-6 of the peak (a starting value); the AAC listening stems are for listening (their
  decoded sum is 13.0 dB under the mix's error floor, the float stems sum within 9.0e-8).

#### lead: the merge, the engine's phase, the sync ruling (after)
- The engine's two parts now add as their powers: 1.002 over the drive, 1.001 over the idle (in phase, the control:
  1.862 and 1.542). New test in `tests/sound-blockout.test.mjs` with that control. `masterOf` reads the stage's target.
  The sync ruling is in `syncEntry` (`scripts/sound-review.js`), its test changed to expect the pass, and the bar's
  text says so.
- Gate: 249 tests, 246 pass, 0 fail, 3 skipped (the parked score); check pass (forbidden 0, determinism, cameras 191
  comparisons, worst 2.00e-15). The design stage still renders the S8.3 bytes (sha256 f80b1542).

#### lead: measure.json, the stems and the options regenerated on the fixed engine
- `node scripts/sound-review.js --round 05 --measure` (255 s): renderer pass (142 cues, worst 0.031 ms); sync fail, 12
  off (Sound 1's), the 8 on-frame instants on their frames by the ruling; pan pass (worst 0.101 dB); silence, voices,
  density, determinism and stems pass; phone and mono fail on the two latches only (a placeholder's band, Sound 4); the
  target still -23 LUFS by the rule (worst 400 ms window 0.961 dB at -23: the driver's unlatch, 3.15 dB on one sample,
  ducks its window through the limiter's release). The raw blockout reads -22.83 LUFS (it was -22.19 with the engine in
  phase): 3270 samples limited at -23, all in shot 5 at 30.4 s.
- `node scripts/sound-options.js --round 05`: all three A/Bs still measure over the audibility bar (ask the director).
  The engine clip under the muffle by the set: -0.89 dB with the volume drop, -0.49 dB with the swap (it was -1.33 and
  -1.00 with the buzzes in phase); -3.93 and -1.67 dB over the 1.4 s the intake is hidden at full level.

#### lead: Sound 2.8, the preview (before)
- Capture the blockout preview: `node scripts/sound.js --out out/round-05/blockout.wav`, then `node scripts/capture.js
  --profile preview --audio out/round-05/blockout.wav --captions review/round-04/captions/review.vtt --burn-captions
  --out review/round-05/preview.mp4` (cues.js is unchanged since round 04, so its review track is the round's). Check it
  with a new `scripts/sound-preview.js`: the streams, the audio lag against the WAV, and nothing drawn in the bottom 30 px.

#### lead: Sound 2.8, the preview (after)
- `review/round-05/preview.mp4` (13.6 MB, 480x270, the overlay, 2688 frames): the blockout at -23 LUFS integrated
  (-23.06 measured on the AAC), the review track soft (mov_text, 112 s) and burned. `preview-check.json`: one video,
  one audio and one subtitle stream, each 112 s; the audio 0 samples from the WAV in all three windows (correlation
  0.99876 to 0.99998); the burn leaves the bottom 30 rows' bytes untouched (exact, before the encode, at 31 to 33 and 79
  to 81 s) and draws in the caption band (the control); encoded, the bottom rows differ from a plain capture by at most
  12 and 30 levels, inside the encoder's spread in the undrawn middle rows (45 and 76).
- Per shot (integrated, the preview's AAC): the car's shots 4 and 5 at -19.4 and -19.1 LUFS; shot 7, the two walkers in
  step, at -20.8, within 1.7 LU of them; shot 3, the car's drive, at -23.8. For the panel: the plan wants the car the
  only loud thing. Balance is reported at Sound 2, not judged (placeholders have no real spectrum).
- `scripts/sound-preview.js` and `tests/sound-preview.test.mjs` (3 tests, each with a planted fault: 3 samples of lag
  either way; text in the bottom rows or none in the band; the review track pinned to the foot of the frame).
- Gate: 252 tests, 249 pass, 0 fail, 3 skipped (the parked score); check pass.

#### s2-stills: Sound 2.9, the plan (before)
- Before: base 21871c8. `measure.json` holds every number the drawings need except the curves over time (the
  spectrogram, the stems' levels, the mix's balance), which come from the session's renders: the mastered mix (8.9 s
  here) and the 30 voice-group stems before the master (7 s). The design stage with the score unparked renders sha256
  f80b1542f97013ccb37b9e9cd36e940bea524efcd9a2a47da9bbb55bf8c611da (checked, out/round-05/design-check.wav).
- Plan: `scripts/lib/sound-stills.js` (the spectrogram, the level and balance curves, one still per shot, the
  arrangement on round 04's timeline lanes, stills.json, the contact sheet); `buildTimeline` gains a header option and
  a shift (its default drawing byte identical); `--stills` and `--sheet` join `STEPS` in `scripts/sound-review.js` on
  the same session (memoised, so `--measure --stills --sheet` renders nothing twice; alone they check the raw render
  against measure.json's sha256 before drawing); `tests/sound-stills.test.mjs` with planted faults; then the images,
  looked at full size and at 390 px, and `review/round-05/notes-stills.md`.

#### s2-stills: the drawing library, the steps and their checks (after)
- `scripts/lib/sound-stills.js`: the time axis, the spectrogram (4096-sample Hann centred on each device pixel column,
  log rows 25 Hz to 20 kHz, magma in 3 dB steps from -88 to -22 dB: set from the mastered blockout's own row levels,
  median -52, 99 percent under -32.5; -115 to -25 and -100 to -30 were tried first and drew the beds orange), a PNG
  encoder, the level and balance curves (100 ms windows centred on each point), the lanes (per voice group, or per
  body in shots 5 and 9), one still per shot, the arrangement on round 04's lanes, stills.json entries, the contact
  sheet. Measured is white or filled; predicted the lane's colour, translucent or hollow; the markers by person in the
  reel's colours (a test holds them to the captions' lanes).
- `buildTimeline` gained a header option, a shift and `pan: false`; round 04's `timeline.svg` regenerates byte for byte
  (sha256 defaa92f...). `makeSession` lists its renders (`rendered`) and takes `keep: false` to plant re-rendering.
  `--stills` and `--sheet` joined `STEPS`; alone they refuse a measure.json whose raw sha256 is not the session's.
- `tests/sound-stills.test.mjs`: 9 tests, each with its planted fault (37 s alone).
- Gate: npm test exit 0 (258 tests, 255 pass, 0 fail, 3 skipped: the parked score); npm run check exit 0 (forbidden 0
  hits, determinism 0 of 62 differ, cameras 191 comparisons, worst 2.00e-15). The design stage with the score unparked
  renders sha256 f80b1542f97013ccb37b9e9cd36e940bea524efcd9a2a47da9bbb55bf8c611da.

#### s2-stills: the stills, the arrangement and the contact sheet (before)
- Plan: `node scripts/sound-review.js --round 05 --stills --sheet` on the committed measure.json (made at 21871c8 on
  this engine), twice, the second run's files compared byte for byte with the first's; then look at every image at full
  size and at 390 px, fix what does not read, and add the checks that the committed files are the code's.

#### s2-stills: the stills, the arrangement and the contact sheet (after)
- `node scripts/sound-review.js --round 05 --stills --sheet`: 25 s of renders (33: the raw mix, its peaks, the master,
  the 30 group stems), 30 s for the stills, 5 s for the sheet, which rendered nothing. Run twice: all 35 files byte for
  byte the same. The stills 9.8 MB, the arrangement 1.0 MB, the contact sheet's PNG 6.3 MB.
- Looked at every image at full size and at 390 px (the contact sheet also as a 390 px page). Fixed from what was seen:
  the spectrogram's scale (-88 to -22 dB, from the rows' own levels), lane names off the lines, text sizes for the phone
  (13 to 14 units), a marked label names its person, overlapping and overflowing labels, labels through the
  arrangement's rings, two wordings on the sheet. Added the label check and the check that the committed files are the
  code's (11 tests now).
- What the stills show is in `review/round-05/notes-stills.md`: the tyres fall 4.5 to 44 dB under their prediction
  through shot 4 (median -10.6 dB) and the engine 3.3 dB (median), where measure.json's loudest windows see -1.3 and
  -2.8; the beds and the hum agree to 0.4 dB; the latches lose 15 to 16 dB on the phone; silence holds in the five
  bed-only shots; the 12 sync misses are all foley.
- Gate: npm test exit 0 (260 tests, 257 pass, 0 fail, 3 skipped: the parked score); npm run check exit 0 (forbidden 0
  hits, determinism 0 of 62 differ, cameras 191 comparisons, worst 2.00e-15). The design stage with the score unparked
  renders sha256 f80b1542f97013ccb37b9e9cd36e940bea524efcd9a2a47da9bbb55bf8c611da.

#### s2-stills: the steps in one call
- `node scripts/sound-review.js --round 05 --measure --stills --sheet`: the measure in 263 s, then the stills and the
  sheet, each logging "rendered for them: nothing"; `git status` clean after it (measure.json, the stems, the stills,
  the arrangement and the contact sheet all byte for byte as committed). The note is added to notes-stills.md.
- Gate: npm test exit 0 (260 tests, 257 pass, 0 fail, 3 skipped); npm run check exit 0 (forbidden 0 hits, determinism
  0 of 62 differ, cameras 191 comparisons, worst 2.00e-15).

#### s2-stills: the checker's findings F1 to F7, the plan (before)
- Before: HEAD 160ccf7. The checker's gate there: npm test exit 0 (260 tests, 257 pass, 0 fail, 3 skipped), npm run
  check exit 0; the design stage with the score unparked f80b1542.... Findings: check 11 compares only the PNGs' sizes
  (F1); nothing checks the values on the vertical axes or keeps measured and predicted apart (F2); the measureOf guard
  has no test (F3); the notes claim the hum's lines in every shot (F4); the beds' span means and long cues' pans are
  drawn as moments (F5); coincident glyphs hide each other (F6); leaders through labels, clamped loudness unmarked, a
  lost colon, the low rows' bin centres (F7).
- Plan, in gated commits. (1) The library and its checks: stills.json and a new sheet.json carry each SVG's and PNG's
  sha256 (and the Chromium version that rasterized them); read-back checks, each with a planted fault, for tones on the
  frequency ticks, left and right on the pan meter, a stem's known level on the lane (stills and arrangement), every
  dot, ring, bar and key row against measure.json, the predicted envelopes against cues.js through the predictor and
  round 04's timeline, the loudness at each window's middle, the miss labels' person, glyph overlaps and the leaders;
  measureOf on a stub session; the committed PNGs against their hashes, and a rebuild from a real session against
  stills.json and sheet.json. The beds' level as a bar over its span, long cues' pan as a key under the meter, glyphs
  stacked, leaders behind label chips, clamped loudness marked, the colon kept, the bins in the legend, the 250 and
  500 Hz lines moved off the spectrogram to violet ticks at its edges. (2) The images rerun and looked at, the notes
  (F4 measured per shot, F5's shot 8 sentence, the new checks), this log.

#### s2-stills: F1 to F7, the library, the checks and the images (after)
- `scripts/lib/sound-stills.js`: a bed's level (measure.json's mean between its crossfades) is a white bar over that
  span, named in the lane's head with both numbers (the heads wrap); a cue over 1 s has its pan in a key under the
  axis, the shorter ones stay dots; glyphs closer than a glyph's width (or a ring's reach) are stacked down, each ring
  around its own; labels on opaque chips over the leaders; loudness under -45 LUFS marked with an arrow and its lowest
  reading (stills and arrangement); the arrangement keeps "sync: ..."; the 250 and 500 Hz lines moved off the
  spectrogram to violet ticks at its edges; the legend says where rows read between bins. Every drawn number carries
  its role and what it draws. New read-back checks: `toneProblems`, `panSideProblems`, `levelLineProblems`,
  `arrangementLevelProblems`, `valueProblems`, `predictedProblems`, `loudnessProblems`, `missLabelProblems`,
  `glyphProblems`, `leaderProblems`; `groupLevels` (the arrangement's levels, used by --sheet); `decodePng`.
- `scripts/sound-review.js`: stills.json records each still's SVG and PNG sha256, the new sheet.json the arrangement's
  and the contact sheet's (and the images it was made from), both with the Chromium (`rasterize` returns its version).
- Tests: `tests/sound-stills.test.mjs` 20 (was 11): check 11 now holds every committed PNG to its recorded sha256
  (planted: one byte of one still), and 9 new checks with planted faults, among them measureOf's guard (F3).
  `tests/sound-stills-rebuild.test.mjs` (new, 2, about 37 s): the 15 stills and the arrangement rebuilt from a real
  session hash to the recorded SVG sha256, and rasterize to the recorded PNG sha256 on the recorded Chromium (planted:
  SPEC.lo -90, levels not over the street).
- Mutation run in scratch copies (the checker's M05 to M22, and four new: no stacking, no chips, no clamp marks, a
  bed's bar at its prediction): every one fails at least one test. M05 first passed (one-sided signals take the
  balance's infinite branches), so the pan check now also draws spans right at half and left at a quarter.
- Images: `node scripts/sound-review.js --round 05 --stills --sheet` twice, all 36 outputs byte for byte the same;
  looked at whole and in crops (shots 1, 3, 5, 8, 9, 13 and 15, the arrangement, the contact sheet). The design stage
  with the score unparked renders sha256 f80b1542f97013ccb37b9e9cd36e940bea524efcd9a2a47da9bbb55bf8c611da.
- Gate before commit e88cc83: npm test exit 0 (271 tests, 268 pass, 0 fail, 3 skipped: the parked score; both
  rebuild tests ran on the recorded Chromium); npm run check exit 0 (forbidden 0 hits, determinism 0 of 62 differ,
  cameras 191 comparisons, worst 2.00e-15).

#### s2-stills: the notes after the checker's findings (before)
- Plan: rewrite `review/round-05/notes-stills.md` for the new drawings and checks: the hum's lines measured per shot
  (F4), the bridge wind's span mean (F5), the five unplaced beds, the onsets at one moment now seen, the mutation run,
  and a table of the findings and what was done.

#### s2-stills: the notes after the checker's findings (after)
- `review/round-05/notes-stills.md`: the hum's 120 and 240 Hz rows measured on each still's own rows (each row's median
  over the shot against the rows 3 to 6 away): 3.7 to 5.1 and 5.4 to 15.8 dB over their neighbours in shots 1 and 4 to
  15, under one 3 dB colour step in shots 2 (1.0 and 0.6 dB) and 3 (2.3 and -1.4 dB); the bridge wind's mean over
  54.025 to 111.975 s 1.05 dB under its prediction; the checks table (22 tests over two files), the mutation table,
  the second look at the images, and the findings F1 to F7 with what was done.
- Gate: npm test exit 0 (271 tests, 268 pass, 0 fail, 3 skipped: the parked score); npm run check exit 0 (forbidden 0
  hits, determinism 0 of 62 differ, cameras 191 comparisons, worst 2.00e-15).
