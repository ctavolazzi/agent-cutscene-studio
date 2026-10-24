# Working rules

These held for all of Snow, Lamp, Bridge. The director's own rules come first; the rest are what kept the build honest.

## The director's rules

- **No em dashes or en dashes anywhere**: files, comments, commit messages, PR text, chat, on-screen text.
  `npm run check:forbidden` fails on the character, its escapes and its HTML entities in every text file.
- **Every video gets a thumbnail**, checked at 320 px wide before it is called done.
- **Never subscribe to or watch PR activity**, and never schedule PR check-ins, unless asked. Keep PRs as drafts.
- **No review stops between stages** unless a decision is genuinely the director's. Show progress with frames and
  keep building.
- **Never put a model name or identifier** in commits, PR text or files.

## The film is a pure function of time

- Every frame is `renderAt(t)`. The same t gives the same pixels whatever was drawn before, in any page.
- No `Math.random`, `Date.now`, `performance.now`, `new Date()` or timers in `src/`, except the playback block in
  `src/main.js` (the one clock). Seeded randomness only: `rngFor(name)`. `check:forbidden` enforces it.
- No state carried between calls. Derived things (footprints, tracks) are computed once at build from pure functions.
- Lights are created once and never added, removed or hidden (a changed light count recompiles every shader); set
  intensity to 0 instead.
- `npm run check:determinism` renders every shot's frames in four orders over two page loads and compares bytes.

## Log, measure, gate

- **Log every step in `BUILD_LOG.md` before and after**: the plan, then what happened, the numbers, what was wrong.
- **Measure, don't guess.** A decision offered to the director carries numbers computed from the real data and frames
  rendered at the moment in question. Two Gate 2 options in Snow, Lamp, Bridge were wrong until measured.
- **Commit only after `npm test && npm run check` both pass.** Never loop over test files with a shell for-loop: it
  does not stop on a failure, and one failing test reached a commit that way. Commit in small gated steps.
- **Look at the frames yourself** before calling a visual change done, at full size and at phone size.

## Tests

- Every check has a **planted-fault control**: show the check fails on a deliberately wrong input (an offset frame, a
  flipped image, a reversed roll, a NaN projection, a planted dash). A check that cannot fail proves nothing.
- When a change makes a test describe the old design, **rewrite it to check the same property on the new design**.
  Never loosen a bound silently; record why in `BUILD_LOG.md`.
- When a target turns out to be impossible, show why with numbers, set the new bar from a measurement, and say so in
  the PR (Snow, Lamp, Bridge: the 40 dB verify bar became 36 dB plus a frame identity check, after measuring the
  YUV 4:2:0 floor at three crf values).

## Git

- Work on the branch the session is given; open a draft PR to `main`; never push to someone else's branch.
- `out/`, `dist/` and `node_modules/` are ignored. MP4s go to GitHub releases, not git.
