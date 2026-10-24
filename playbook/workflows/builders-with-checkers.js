export const meta = {
  name: 'stage3-round2-build',
  description: 'Stage 3: apply the Gate 2 answers in three worktrees (rig, shot 5 camera, lamp and shot 8), then check each',
  phases: [
    { title: 'Build', detail: 'three builders, one git worktree each' },
    { title: 'Check', detail: 'one checker per builder tries to break the result' },
  ],
}

// Stage 3 of Snow, Lamp, Bridge: three builders, each in its own git worktree on its own branch, each followed by a checker that re-runs everything and tries to break the result. Adapt COMMON and JOBS to your film. Before running, create the worktrees: git worktree add <scratch>/wt/<key> -b <branch>, and symlink node_modules into each.
// Run with the Workflow tool in Claude Code:
//   Workflow({ scriptPath: 'playbook/workflows/builders-with-checkers.js', args: { film: '/abs/path/to/films/<slug>', scratch: '/abs/path/to/a/scratch/dir' } })
// The prompts below are the originals from Snow, Lamp, Bridge (they name its files, shots and decisions); keep the shape,
// rewrite the content for your film.
const FILM = args?.film ?? '/abs/path/to/films/snow-lamp-bridge'
const SCRATCH_DIR = args?.scratch ?? '/abs/path/to/scratch'

const WT = `${SCRATCH_DIR}/wt`
const SCR = `${SCRATCH_DIR}/s3`

const COMMON = (wt, branch) => `
Project: "Snow, Lamp, Bridge", a 112 s silent three.js scene (PS1 style later; now a grey-box blockout), 15 shots, 24 fps.
The source of truth is three data files: src/set.js (layout; +Y up, north is -Z, east is +X), src/world.js (car, people
keys, lights timing), src/shots.js (cameras; keys with pos/target or a frame spec { P, sx, sy } solved by solveTarget). The
people rig is src/actors/people.js (makePoser; poses: stand, walk, emerge, exit, lean, cup, smoke). The car is
src/actors/car.js, lights src/fx/lights.js, constants src/config.js. The contract is src/CONTRACT.md. The plan is PLAN.md
(section 3.9 is shot 5's beat budget), the roadmap ROADMAP.md, the log BUILD_LOG.md, the Gate 2 decisions and their
measurements review/round-02/notes.md (section "Corrections, 2026-10-22") and scripts/gate2-measure.js (wheelCover,
outline() with HALF = { A: 0.242, B: 0.264 }, pairStats, postInShots). The user answered Gate 2 with the recommended set.

YOUR WORKSPACE: the git worktree ${wt}/snowy-bridge on local branch ${branch}. Work only there. node_modules is a symlink
to the main checkout; never modify anything under node_modules or in the main checkout. Commit your work on
${branch} (git add the specific files you changed, then git commit with a plain message, no em or en dashes). Do not push.
Do not edit BUILD_LOG.md, ROADMAP.md, PLAN.md, anything in review/ or storyboard/ (the lead regenerates the storyboard after
merging, and writes the log and notes). Stay inside the files your scope lists.

RULES: no em dashes or en dashes anywhere (code, comments, commit messages, your report). No Math.random, Date.now,
performance.now or timers in src/ (the scene is a pure function of t). Write code and comments like the surrounding code.
Change data in the data files, never in renders.

CHECKS, all must pass before you commit: npm run build; node tests/car.test.mjs; node tests/people.test.mjs; node
tests/lights-snow.test.mjs; node tests/set.test.mjs; node tests/checks.test.mjs; node tests/capture.test.mjs; npm run
check:forbidden; npm run check:determinism; npm run check:cameras. Capture output to a log file and read it; a pipe hides
exit codes. If a test fails because it encodes the old design rather than a property, change the test to check the same
property on the new design, keep its planted controls, and report exactly what you changed and why. Never loosen a bound
just to pass; if you must, say why the new value is right.

LOOK AT FRAMES: node scripts/stills.js --times 31.8,33.2 --outdir ${SCR}/<your name>/<dir> --scale 4 --overlay 1 renders
dist/index.html (run npm run build first) to PNGs (t031.800.png). Read them with the Read tool. Shot 5 is nearly black: make
lifted copies for viewing with ffmpeg -i in.png -vf "format=rgb24,lutrgb=r=gammaval(0.4):g=gammaval(0.4):b=gammaval(0.4)" out.png.
Tile several frames into one image (PIL or ffmpeg xstack) to look at more at once. Write all scratch files under
${SCR}/<your name>/, never in the repo. If Chromium fails to launch, set TMPDIR=/tmp for that command.
Measure with scripts: makeCamera from scripts/lib/math.js (makeCamera(cameraAt(shot, t), 960, 540).project(p) gives pixel
x, y and depth, or null behind the camera); a scratch script must import project files by absolute path.`

const BUILD_SCHEMA = { type: 'object', properties: {
  status: { type: 'string', enum: ['done', 'partial', 'blocked'] }, commit: { type: 'string' }, filesChanged: { type: 'array', items: { type: 'string' } },
  summary: { type: 'string' }, measurements: { type: 'string' }, testChanges: { type: 'string' }, framesLookedAt: { type: 'array', items: { type: 'string' } },
  concerns: { type: 'array', items: { type: 'string' } } }, required: ['status', 'commit', 'filesChanged', 'summary', 'measurements', 'testChanges', 'framesLookedAt', 'concerns'] }
const CHECK_SCHEMA = { type: 'object', properties: {
  verdict: { type: 'string', enum: ['pass', 'pass-with-issues', 'fail'] }, summary: { type: 'string' },
  findings: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, severity: { type: 'string', enum: ['high', 'medium', 'low'] }, problem: { type: 'string' }, evidence: { type: 'string' }, fix: { type: 'string' } }, required: ['id', 'severity', 'problem', 'evidence', 'fix'] } } },
  required: ['verdict', 'summary', 'findings'] }

const JOBS = [
  {
    key: 'rig', branch: 's3-rig',
    task: `YOUR TASK: two changes to A in the people rig. Scope: src/actors/people.js; src/world.js A_KEYS between 29 and 34 s only;
tests/people.test.mjs only where a check encodes the old design. Do not touch src/shots.js or src/set.js.

1. A's forearms rest on the parapet (Gate 2 decision 2a). The parapet top is BRIDGE.parapetTop = 1.15 m (keep it). The brief
asks for a railing "chest high, leaned on with forearms". Today, with makePoser at t 64 and 70, A's shoulders are at 1.458 m,
elbows 1.289 m, hands 1.170 m: the elbow joint is about 14 cm above the top and the forearm slopes about 27 degrees down to
the hand, so it reads as arms reaching (shot 9). B's elbow is 1.240 m (about 9 cm above the top at the joint, about 3.6 cm at
the sleeve underside, sloping about 16 degrees); B is acceptable, leave B as is unless a shared change improves B too.
Target for A in the held lean (and the forearm left on the parapet in 'smoke'): the forearm lies on the top, the elbow joint
1 to 5 cm above the top over the parapet (the ARM_CLEAR comment already promises "The held poses rest the elbows 1 to 5 cm
above the top"), the forearm within about 10 degrees of level, no arm bone into the parapet, the torso and coat clear of the
parapet's inner face, both feet planted. Expect per-person lean parameters (more forward pitch, a lower hip, a different
reach) rather than a shared change. Keep every transition into and out of the lean, cup and smoke poses within the rig's
existing guarantees (joint speed limits, the VIA routing over the near edge). Check A in shots 9 to 15 (60 to 112 s).
2. A steps down one boot first (decision 5b). Today both feet come out together at sill height and land together at 31.8 s
(the emerge to exit change; blendPose uses one wx/wy clock for both feet when getting out). The shot's text says "a boot
lands" and PLAN 3.9 says "0:31.8 A's boot lands in the snow". Target: A's outboard foot (the driver side, EXIT.outSide.A = -1,
A's left) lands at 31.8 s; the inboard foot follows a few tenths of a second later and lands before or as A rises; then A
rises in place and walks as now. B is unchanged: B's boots land together at 33.2 s, seen under the car. Keep every get-out
guarantee the tests check: no foot low while still under the car's wall, no sole below the underside while under the car,
feet clear the sill, no joint faster than the tests allow, no door through anyone (door times in world.js carTimes.doors).
Shot 5's camera is at ground level west of the car looking east (until 34.4 s), so look at lifted frames at 30.8, 31.2,
31.5, 31.8, 32.0, 32.2, 32.4, 32.8.`,
    check: `Check the rig builder's work: A's forearms at the parapet (shots 9 to 15) and A's one-boot-first get-out (31 to 33 s).
Measure A's and B's elbows, hands and forearm slope with makePoser at several times between 63.5 and 112 s; confirm A's elbow
is 1 to 5 cm above the top and the forearm near level, nothing goes into the parapet, and B is no worse than before (B's
elbow joint was about 9 cm above the top). Measure A's ankle heights from 31.0 to 32.6 s and confirm the outboard foot lands
at 31.8 s and the inboard foot later. Look at frames (lifted for shot 5). Look for anything that pops, slides, floats, cuts
through the car, a door or the parapet, or reads wrong at phone size.`,
  },
  {
    key: 'cam5', branch: 's3-cam5',
    task: `YOUR TASK: redesign shot 5's camera move (Gate 2 decision 4a). Scope: the shot 5 entry in src/shots.js only.

Facts to read from the code (do not assume): shot 5 runs 29 to 40 s, lens 35, ease 'spline', keys at 29 (pos [-0.3, 0.25,
1.9], target [3.7, -0.1, 1.9], roll 3), 34.4 (same, roll 0), 36.2 (pos [-0.3, 0.25, 0.6], target [3.2, -0.1, -1.6]) and 40.
The car is parked at carAt(32) (x 2.2, z 1.85, heading 0, so it faces north, -Z); its driver-side front wheel centre is
about (1.38, 0.33, 0.40), radius 0.33, half width 0.11 (src/actors/car.js SHAPE.wheel; compute it). The headlights (world.js
headlights, lights.js) sit ahead of the lenses and aim north; they fade out from 36.2 to 36.6 s (carTimes.lightsOff0/1).
A's boot lands at 31.8 s on the driver (west) side, B's boots land at 33.2 s on the far (east) side and are seen in the
gap under the car (0.25 m). Read people positions from world.js peopleAt(t) at run time: another builder is changing A's
get-out slightly. Doors: carTimes.doors.
The problem today: after the hold, the camera slides 1.3 m north passing 1.7 to 2.1 m from that wheel, which is in frame
from 34.7 to 37.6 s and covers up to 19% of the frame (scripts/gate2-measure.js wheelCover measures it). Holding until
35.5 s and then pushing in cannot work gently: every end frame that holds A's feet and both beams without the wheel looks
roughly north, while the hold looks east.
Requirements: (1) Until about 33.6 s the shot stays as it is: the hold on the door with the roll settling, A's boot landing,
B's boots in the gap under the car at 33.2 s. (2) From then to the end of the shot, the front wheel covers at most about 1%
of the frame in every frame, and no other part of the car becomes a wall across the frame. (3) From 36.2 to 36.6 s, A's feet
and both headlight beams (the lit road patches 3 to 6 m ahead of each light) are in frame and not hidden by the car body.
(4) One gentle move that follows A: start turning toward the bridge earlier, while A is still near the door; peak pan rate
under about 30 degrees a second, no jerk; the camera stays near snow level (y about 0.25, rising a little only if needed)
and never enters the car or a building. (5) A's feet stay in frame while A walks from the door toward the front of the car.
(6) The shot ends on lamp light only after the cut (the lamp is being moved to base (5, -4.5) by another builder; the post
may appear in the end frame; that is fine). (7) Update the shot's move label, insets and the comment above it to describe
the new move; keep subject, sketchAt and side sensible. Measure frame by frame over 29 to 40 s with a scratch script and
report a table: wheel coverage, A's feet on screen, each beam spot visible and in frame, pan rate. Render 33.2, 34.0, 34.8,
35.5, 36.2, 36.6, 38.0 and 39.9 s and look at lifted copies.`,
    check: `Check the shot 5 camera builder's work. Independently measure, every frame from 29 to 40 s: the front wheel's share of
the frame (convex hull of both rims, clipped to the frame), whether A's feet are in frame, whether both beam spots (3 and 6
m ahead of each headlight) are in frame and not blocked by the car's body box at 36.2 to 36.6 s, the pan rate and its
changes, the camera height, and that the camera is never inside the car. Confirm the hold up to about 33.6 s is unchanged
(compare with git show HEAD~1:snowy-bridge/src/shots.js or the branch base ef7aa24), including B's boots under the car at
33.2 s. Look at lifted frames across the shot. Look for a move that feels unmotivated, a whip, a jump, or a frame that loses
the subject.`,
  },
  {
    key: 'lamp8', branch: 's3-lamp8',
    task: `YOUR TASK: move the lamp (Gate 2 decision 1c) and fix shot 8 (decision 3c). Scope: src/set.js (LAMP only); src/shots.js
(any shot except shot 5, only where needed); src/world.js (A_KEYS and B_KEYS between 44 and 62 s only); tests only where
they encode old values.

1. In src/set.js move LAMP base from [5, -6] to [5, -4.5] and the lantern head from [4.6, 4.5, -6] to [4.6, 4.5, -4.5].
Nothing else about the lamp changes. Then:
(a) Every frame, every person must clear the post: body half widths at the shoulder A 0.242 m, B 0.264 m (find the post's
radius in src/set/build.js); keep at least 10 cm of air. Move walk keys (44 to 62 s) if not.
(b) Check every shot that frames the lamp (scripts/gate2-measure.js postInShots lists them; after the move expect 1, 2, 3,
4, 5, 6, 7, 8, 10, 14, 15). Shots 1 and 2 are framed on LAMP.head and re-aim by themselves: confirm shot 1 is still close on
the lamp head against the sky and shot 2 still has the lamp far up the street on the right third. Shot 4 ("Snow level at
the lamp base"; camera today at (3.8, 0.25, -6.5)): after the move the post stands about 2.3 m from the camera at the left
edge. Re-place shot 4's camera so the shot reads as written (the car drives toward the camera and the lamp and stops about
6 m away; snow level near the lamp base), with the post either a deliberate element or out of frame, never a bar half cut
at the edge. Shot 6 (the reveal, "They stand in the lamp light beside the dark car"): the post enters at about the left
third; confirm it does not cut through a person. Shots 7, 8, 10, 12, 14 and 15: look at first, middle and last frames;
especially shot 15's end frame "Two people at the railing under the lamp", now that the lamp is 1.5 m further from them.
In no shot may the post merge with a person's silhouette or grow out of a head (the round 2 panel's finding 12). Fix
compositions in src/shots.js through the frame specs, keeping each shot's text true.
2. Shot 8 (camera at (4.0, 1.5, -22), 50mm, framed on headMid(57)). Today B's outline overlaps A's for 2.9 s (closest at
57.6 s): B is 0.34 m from A across the deck. Widen it so the outlines never overlap: B about 0.69 m from A across the deck,
the widening easing in after 54.0 s (54.0 is shot 7's last frame and a shared key, so shot 7 is untouched), B's path staying
off the curb ramp (people.js groundY; B crosses the abutment's step on the sidewalk). A stays screen left of B in every
frame of shots 7, 8 and 9, and both still reach their rail spots (RAIL.zA, RAIL.zB) by 62.0 s as now. Then the post:
before the lamp move it was inside A's outline from 58.0 s and rose out of A's head at the cut; re-measure with the moved
lamp. Make the post clear both heads and outlines in the last second of shot 8 with a small change to shot 8's camera or
to A's last steps, keeping the bulb fully visible (check:cameras and the checks test need at least 95%), the rim light
behind them, the screen sides across the 7 to 8 and 8 to 9 cuts, and the 180 degree rule (glance cameras west of the A and
B line). Use outline() and pairStats() from scripts/gate2-measure.js. Report the measurements before and after.`,
    check: `Check the lamp and shot 8 builder's work. Confirm the lamp moved exactly as specified and nothing else in set.js
changed. Independently measure: every person's clearance from the post every frame; in every shot, whether the post
overlaps any person's outline or head (project the post and outlines); shot 8's outline gap every frame and the post
against both heads in the last second; A screen left of B through shots 7, 8 and 9; both rail spots reached by 62.0 s;
nothing changed in shot 7. Look at first, middle and last frames of shots 1, 2, 4, 6, 7, 8, 10, 12, 14 and 15. Look for a
broken composition, a post half cut at a frame edge, or a person walking through the post or onto the curb ramp.`,
  },
]

phase('Build')
const results = await pipeline(
  JOBS,
  (j) => agent(`${COMMON(`${WT}/${j.key}`, j.branch)}\n\n${j.task}\n\nReturn the commit hash on ${j.branch}, the files you changed, what you did, the measurements, any test changes and why, the frames you looked at, and any concerns.`,
    { label: `build:${j.key}`, phase: 'Build', schema: BUILD_SCHEMA }),
  (b, j) => {
    if (!b) return { key: j.key, build: null, check: null }
    return agent(`${COMMON(`${WT}/${j.key}`, j.branch)}\n\nYou are the CHECKER for this builder. You are read-only: do not edit, commit or reset anything in the worktree (you may build, run the tests and checks, and render into ${SCR}/check-${j.key}/). The builder's report:\n${JSON.stringify(b, null, 1)}\n\nThe builder's brief was:\n${j.task}\n\n${j.check}\n\nRe-run every check yourself. Report pass, pass-with-issues or fail, with findings (severity, evidence, fix).`,
      { label: `check:${j.key}`, phase: 'Check', schema: CHECK_SCHEMA })
      .then((c) => ({ key: j.key, build: b, check: c }))
  },
)
for (const r of results.filter(Boolean)) log(`${r.key}: build ${r.build ? r.build.status : 'none'}, check ${r.check ? r.check.verdict : 'none'}`)
return results
