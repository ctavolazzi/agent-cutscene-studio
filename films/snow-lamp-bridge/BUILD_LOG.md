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
