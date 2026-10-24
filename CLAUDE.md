# CLAUDE.md, agent-cutscene-studio

Short PS1-style films in three.js. A person directs; you plan, build, measure, review and report.

**New session:** read this file, then `playbook/rules.md` and `playbook/process.md`. To continue a film, read its
`README.md`, `ROADMAP.md`, the end of its `BUILD_LOG.md` and its newest `review/round-NN/notes.md`, run `npm ci` and
`npm test` in its folder, and carry on from the next stage.

## Layout

- `films/<slug>/` is one self-contained film (its own engine copy, package.json and node_modules). Work inside it; run
  every npm command from there. Never change a finished film's engine by accident: a fix goes in on purpose, gated.
- `template/` is the starter. `node tools/new-film.mjs <slug> "Title"` makes a new film from it. Engine improvements go
  into `template/` too, with its tests green.
- `playbook/` holds the process, the rules, the techniques, prompts and workflow scripts.
- Skills: `/new-film`, `/review-round`, `/ship-film` (in `.claude/skills/`).

## Rules (the director's; they are not optional)

- No em dashes or en dashes anywhere: files, commits, PR text, chat, on-screen text. `npm run check:forbidden` scans files.
- Every video gets a thumbnail, checked at 320 px wide.
- Never subscribe to or watch PR activity, and never schedule PR check-ins, unless asked. PRs stay drafts.
- No review stops between stages unless a decision is genuinely the director's. Keep building and show frames.
- Never put a model name or identifier in commits, PRs or files.
- Log every step in the film's `BUILD_LOG.md` before and after taking it.
- Commit only after `npm test && npm run check` pass in the film you changed (and in `template/` if you changed it).
  Never loop over test files with a for-loop. Commit in small gated steps.

## The contract (each film's `src/CONTRACT.md` has the full version)

Every frame is `renderAt(t)`, a pure function of t: no `Math.random`, `Date.now` or timers in `src/` outside the
playback block of `src/main.js`; seeded randomness via `rngFor(name)`; no state between calls; lights created once and
never added or removed. Data comes from `src/set.js`, `src/world.js` and `src/shots.js`; every tunable value is in
`src/config.js`.

## Sound

Each film's `src/audio/` synthesizes its soundtrack from the same timing data as the picture (seeded, one pass,
heard from each shot's camera); `config.audio` holds every level. `npm run export` renders `out/sound.wav` before the
capture and muxes it; `npm run verify` checks sync and loudness. Process: sound goes through gated stages like the
picture (plan, storyboard, blockout, revisions, design, mix, final); `films/snow-lamp-bridge/SOUND-PLAN.md` and its
`ROADMAP.md` Sound stages are the worked example (playbook Stage 5.5 is superseded until rewritten).

## Gotchas

- Rendering is software WebGL in headless Chromium: about 100 ms a frame at 1080p, 200 ms at 4K. Plan exports.
- The soundtrack renders in about 11 s in Node for a 112 s film; the player renders it in a worker as the page opens.
- A pipe hides exit codes: capture to a log file, then read it.
- `pkill -f <pattern>` also matches the shell running it (and any background chain whose command line holds the
  pattern): find the PID with `ps` and kill that.
- Scratch scripts must import project files and `playwright-core` by absolute path.
- Dark shots: judge staging on a lifted copy (`curves=all='0/0 0.25/0.6 1/1'`), the look on the real frame.
- Measure before offering a decision; set a test bar from a measurement, never from a guess.
- `out/`, `dist/` and `node_modules/` are ignored. MP4s go to GitHub releases.
