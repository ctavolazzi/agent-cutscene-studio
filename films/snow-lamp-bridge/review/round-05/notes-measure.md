# Round 05, the measurement half: Sound 2.5 to 2.7 (branch s2-measure)

For the lead to merge into `notes.md`. Everything below is measured by `node scripts/sound-review.js --round 05
--measure` (4.5 minutes alone on this 4 CPU machine) and written to `measure.json`; a number here that is not in that
file says where it comes from. The blockout is the placeholders of SOUND-PLAN 4.4, so the measures time, place and
count; the levels and the masking are reported, not judged.

## What is measured, and how

One session renders everything once: the blockout raw (reverb, highpass and fades, no normalization) twice, the mix
before the master stage, one stem per voice group (30) before the master, 18 cues alone (continuous voices that follow
another of their group without a gap, and the unplaced backgrounds), the four bodies with reverb, and the parked design
layers' parts. The levels, onsets, pans and bands are read on the stems before the master, where a voice is exact
zeros outside the samples it plays, so nothing measured is the limiter's. The loudness series and the target are read
on the full render, raw and normalized.

| Measure | How |
|---|---|
| 1 Renderer | `preciseOnsets` (onsets() moved to the first sample over the detector's own line) on each group's stem, the detector's gap half the group's closest cue times (at most 80 ms, never under the 30 ms flam merge), matched one to one within that gap; each one-shot judged against the 5 ms bar; any detection outside every cue span of its group fails |
| 2 Sync | The measured onset (the renderer's, or a continuous voice's first sample that is not zero) judged by `syncOf`: the film's `syncRule` (exported from `sound-report.js`, report.json byte identical) and `showingFrame` from `sound-checks.js`, the bar of check 4 |
| 3 Cue ends | `soundingEnd`: just after the last sample within 60 dB of the voice's loudest, and the last that is not zero |
| 4 Pan | The balance over the cue's span in its group's stem against `predictedBalanceDb` (placeAt under the cue's law) |
| 5 Level | The loudest 100 ms of the cue's own samples, against the street background measured the same way, against `hear` (the level plan's level, its law and modifiers), and against the beds in that window |
| 6 Loudness | Momentary (400 ms) and short-term (3 s), K-weighted with `loudness.js`'s own filters (`kWeighted`, now exported), every 100 ms, per shot |
| 7 Silence | Every detection and every continuous first sample of the hard and foley groups against the four bed-only windows |
| 8 Voices | Check 12's allocator on the measured spans (onset to end) |
| 9 Density | Check 11 on the stems: groups within 6 dB of the loudest over the trailing 100 ms, or with a measured onset in the last 100 ms, counted as bodies |
| 10 Masking | Third octaves (IEC 61260 nominal centres 25 Hz to 20 kHz, Butterworth order 3 per side) of the cue's loudest 100 ms against everything else sounding in it (the mix before the master minus its group) |
| 11 Phone and mono | The same window folded to mono, its side, and on a phone speaker; check 14 run on the measured bands |
| 12 Determinism | sha256 of the two raw renders |
| 13 Stems | The 30 group stems summed against the mix before the master |
| 14 Drift | The design stage with the score parked, each part rendered alone, onsets matched one to one against cues.js's enabled one-shots |
| 15 Target | The loudness sweep below |

## The bars and their sources

| Measure | Bar | Source |
|---|---|---|
| Renderer | within 5 ms | ROADMAP Sound 2.6, SOUND-PLAN 4.5 (the S8.2 layers reached it) |
| Sync | 0 to 45 ms ahead of the first showing frame, past the named lead; after the frame fails (45 ms a starting value) | ITU-R BT.1359 via SOUND-PLAN 3.3, check 4 (secondary) |
| Pan | within 0.5 dB | SOUND-PLAN 4.5 (today's car test; S8.2 measured 0.11 dB) |
| Silence | no onset inside | SOUND-PLAN 3.11, check 13 |
| Voices | at most 24, no steal, drop or cut | psx-spx via SOUND-PLAN 3.13, check 12 |
| Density | more than 2 bodies reported, more than 3 fails (starting values) | check 11, Murch (secondary) |
| Phone and mono | a story cue only below 250 Hz or only in the side channel fails (side: 3 dB more side than mid, a starting value) | check 14 |
| Stems | within 1e-6 of the peak (starting value) | `tests/sound-blockout.test.mjs` measured one float32 step |
| Target | no 400 ms window loses more than 1 dB to the limiter (starting value) | the brief for this step |
| Level, masking, ends, loudness, drift | reported | SOUND-PLAN 4.4 and 4.5 |

The phone speaker is a model, not a measurement: a 500 Hz second-order high-pass (800 Hz for a small phone) and an
8 kHz low-pass on the mono fold-down. Its numbers, sources and their strength are written beside `PHONE_SPEAKER` in
`scripts/lib/audio-analysis.mjs`: two patents and a datasheet seen only in search excerpts, one review measurement (an
excerpt), the 3GPP TS 26.131 hands-free mask (an excerpt of a mirror) and closed-box theory from memory (secondary).
The pages themselves could not be opened from here (the proxy refused them).

## Results

| # | Measure | Status | Result |
|---|---|---|---|
| 1 | Renderer | pass | 93 of 93 one-shots within 5 ms; the detector reads 0.04 to 2.0 ms after the cue time (steps 0.04 to 1.0, ticks to 0.10, the doors' swings open the latest at 2.0: a sine from zero); no onset outside its group's cues |
| 2 | Sync | fail | 119 judged, 20 off: the 12 Sound 1 found (6 scuffs, 110 ms late to 43 ms early; 6 cloth moves timed from keys, 5 to 88 ms early), and 8 below |
| 3 | Cue ends | report | end minus t1 from -653 ms (B's slide off the seat: a 50 ms knock on a 0.7 s span) to +24.9 ms (the street beds, which run half the crossfade past their t1), median -4.4 ms |
| 4 | Pan | pass | 142 cues, the worst 0.101 dB off its prediction |
| 5 | Level | report | measured minus predicted from -3.34 dB (the far ticks: the air lowpass the prediction leaves out) to +0.26 dB, median 0; the street background -30.03 dB (the rule's -30); 62 of 136 non-background cues 6 dB or more over the beds in their loudest 100 ms |
| 6 | Loudness | report | at -23 LUFS: the loudest momentary -15.41 LUFS (shot 5), short-term medians from -31.38 (shot 2, the hush before the car) to -18.30 (shot 5); per shot in measure.json |
| 7 | Silence | pass | 4 windows, no onset inside |
| 8 | Voices | pass | peak 12 voices at 34.61 s (planned 12); no steal, drop or cut; 2 crossfades (below) |
| 9 | Density | pass | peak 6 foreground streams, 3 bodies; 15 runs at 3 bodies (33.2 to 61.2 s), none over |
| 10 | Masking | report | 27 of 136 cues with no third octave 3 dB over everything else in their loudest 100 ms: the exhaust and the tyres under the intake (one body), getting out under the idle, cloth under the steps, the late ticks under the steps. Check 9 predicted 79 of the 93 one-shots under 3 dB broadband: per band the band-limited placeholders stand out where the broadband sum hid them |
| 11 | Phone and mono | fail | 9 story cues, 2 flagged: both latches "only below 250 Hz" (below). In mono the story cues change by -0.72 to 0 dB; on the phone by -16 to -0.05 dB (the run-down -3.4, the engine -1.9; the latches -15.3 and -16.0) |
| 12 | Determinism | pass | two renders, the same bytes (sha256 12c40d8d...) |
| 13 | Stems | pass | worst 9.74e-8 of the peak (about one float32 step), at 28.30 s |
| 14 | Drift | report | below |
| 15 | Target | pass | -23 LUFS, below |

The 8 sync cues off their frame that pass on their cue times: the engine's two parts and the tyres at the first light
(14.000), the engine's idle at the stop (29.000), the driver's latch (34.500) and the drawn exhale (90.000). Each
instant sits on its frame's own time, so on its cue time it is 0 ms ahead, a pass with nothing to spare; the measured
onset trails the cue time by the measurement's own lag (a continuous voice's first sample is zero, so the first that is
not is one sample, 0.02 ms, later; the detector's line is 0.21 ms into the latch's thump), so it reads 0.02 to 0.21 ms
after the frame. I kept the plan's bar exactly and report them as fails, with that note on each row. Nobody can hear
0.2 ms (BT.1359's audio late threshold is about 125 ms), so for Sound 3 the choice is a one-sample lead on instants
that fall on frame times, or a bar that allows the measurement's resolution; that is the lead's call.

The latches: the placeholder is a 200 Hz thump plus a 6 ms click at 1.8 kHz (SOUND-PLAN 4.4, "a thump plus a click at
the latch"). In its loudest 100 ms the thump's third octaves carry it; the click's are more than 10 dB down, so the
measured band is 178 to 224 Hz and check 14 flags it. On the phone the latch loses 15 to 16 dB, 22 to 23 on a small
one: the shut doors are the story's, so the real latch at Sound 4 needs its energy in the mid band. Not a renderer
fault; the placeholders are unchanged.

## The loudness target: chosen by measurement

The rule: the loudest integrated target at which no 400 ms window loses more than 1 dB to the limiter (a click held
for a few milliseconds is not a level change; a pumped engine is). The raw blockout reads -22.19 LUFS. Normalized from
-16 down in 0.5 dB steps until nothing is limited (the hush: the run-down's end, 36.6 s, to the end of shot 6, 46 s;
both read from cues.js, carTimes and SHOTS):

| Target | Gain dB | Worst 400 ms dB (at s) | Windows over 1 dB | Worst sample dB | Samples limited | Street in the hush (LUFS M, median) | Mix in the hush |
|---|---|---|---|---|---|---|---|
| -16 | 7.90 | 7.94 (28.3) | 232 | 11.22 | 960753 | -22.77 | -16.78 |
| -17 | 6.50 | 6.73 (28.3) | 185 | 9.82 | 820791 | -24.17 | -18.07 |
| -18 | 5.06 | 5.49 (28.3) | 137 | 8.38 | 590694 | -25.61 | -19.51 |
| -19 | 3.75 | 4.38 (28.3) | 73 | 7.08 | 366160 | -26.91 | -20.81 |
| -20 | 2.51 | 3.34 (28.1) | 39 | 5.83 | 213286 | -28.16 | -22.06 |
| -21 | 1.39 | 2.39 (28.1) | 25 | 4.71 | 129744 | -29.28 | -23.18 |
| -22 | 0.30 | 1.49 (28.1) | 12 | 3.62 | 66678 | -30.37 | -24.27 |
| -22.5 | -0.24 | 1.06 (28.1) | 5 | 3.09 | 42920 | -30.90 | -24.80 |
| **-23** | **-0.81** | **0.63 (28.1)** | **0** | **2.52** | **23145** | **-31.47** | **-25.37** |
| -24 | -1.81 | 0.35 (30.1) | 0 | 1.52 | 3471 | -32.47 | -26.37 |
| -25 | -2.81 | 0.12 (30.1) | 0 | 0.52 | 430 | -33.47 | -27.37 |
| -26 | -3.81 | 0 | 0 | 0 | 0 | -34.47 | -28.37 |

(Every half step is in measure.json; the true peak is -2.0 dBTP, the ceiling, at every target that limits.)

So the blockout's target is **-23 LUFS** (`config.audio.targetLufs.blockout`), and every quieter target meets the rule
too. The worst window is not the click the facts named before this step (11.2 dB off shot 5 at 30.4 s is the largest
loss of one sample, the driver's unlatch, 2.52 dB at -23) but the car arriving in shot 4 at full drive with the swell
(28.1 to 28.3 s): at -16 the limiter holds that engine 7.9 dB down for whole seconds. At -23 the mix sits 7 dB under
the plan's -16, the street background in the hush at -31.5 LUFS momentary; SOUND-PLAN 3.18 anchors the mix on the hush
from Sound 5 anyway, and integrated loudness stays under -16 as it asks. The design stage keeps -16, byte identical.

## The drift of the parked design layers (Sound 2.7)

Reported, not a bar. Of the 93 enabled one-shots: 72 matched, 18 missing, 3 with no design part to play them (the
handbrake and the two belts), and 102 extra onsets.

| Part | Matched | Missing | Extra | Drift (matched) |
|---|---|---|---|---|
| A's steps | 35 | 0 | 35 | 0.5 to 20.2 ms, median 10.9: the print times against the rig's contacts (SOUND-PLAN 3.3: up to 20.3 ms) |
| B's steps | 28 | 0 | 27 | 0.2 to 20.3 ms, median 7.8 |
| Doors | 4 | 6 | 7 | 0 ms: the design's open sounds at open0 (matched to the swing open; the unlatch 60 ms before it is missing), its shut at close1; no stops, no swings shut; the hinge creak and the seal are the extras |
| Settle | 2 | 0 | 2 | the dip 0.04 ms, the rebound +30.5 ms (the design's 0.38 s against settlePitch's deepest point) |
| Ticks | 2 | 8 | 9 | the first 0.02 ms (both start lightsOff1 + 1.1), one more 385 ms off; the design draws its own seeded spacing |
| Lighter | 1 | 1 | 1 | the strike +70 ms (the design at the flame, cues.js leads it by 70 ms); the release click is not detected under the flame |
| Rustles | 0 | 3 | 20 | the two forearm rests are 2.5 ms apart (A's and B's), so the window is 1.25 ms and neither design pat (63.47, 63.50) is taken; one part plays both people, so they cannot be told apart. The crinkles are the extras |
| Key | 0 | 0 | 1 | the key click, which Gate 0 removed |

## The stems

Measuring stems, one per voice group, float WAV at the level before the master: `out/round-05/stems/` (not committed;
the paths are in measure.json `groups`). Listening stems for the director, one per body, each at the mastered mix's own
gain (-0.806 dB) and unlimited, so they sum to the mix before its limiter (measured: within 9.0e-8 of the peak), AAC
96 kbps, in `review/round-05/stems/` with `stems.json` (sha256, seconds, integrated loudness and peak of the float
signal and of the AAC, the groups and the cues):

| Stem | Cues | Size | Integrated (float, AAC) | Peak |
|---|---|---|---|---|
| night.m4a (the backgrounds and the hum) | 6 | 1.37 MB | -27.92, -27.6 LUFS | -14.7 dBFS |
| car.m4a | 39 | 0.42 MB | -20.50, -20.5 LUFS | +0.44 dBFS, +1.7 dBTP on the AAC |
| A.m4a | 58 | 0.61 MB | -25.67, -25.8 LUFS | -3.6 dBFS |
| B.m4a | 39 | 0.39 MB | -25.81, -25.9 LUFS | -4.8 dBFS |

The car stem goes over full scale for a few milliseconds: those are the samples the mix's limiter takes up to 2.5 dB
off, left in so the stems add up; a player clips them. The encoder gives the same bytes for the same samples (checked
twice).

## measure.json, for the stills and the arrangement sheet (Sound 2.9)

The schema is written at the top of `scripts/sound-review.js`. In short: `measures` is one entry per measure in the
report.json check shape (`id, n, name, definition, bar, source, starting, status, summary, columns, rows`, every row
value a string, number, boolean or null, `cue` naming the cue); `table` is one row per voiced cue with everything
measured on it (onset, method, end, the loudest window and its level, predicted level, balance and predicted
balance); `bands` holds each cue's third octaves and its masker's at its loudest 100 ms; `series` the mastered mix's
momentary and short-term loudness every 100 ms (`lufs[k]` ends at `firstEnd + k * hopSec`); `groups` names each
measuring stem's file. The next steps (`--stills`, `--sheet`) join `STEPS` in `sound-review.js` and read the same
session, so nothing is rendered twice.

## What surprised me

- The limiter's worst window is the engine, not a click: the plan's -16 would hold the car's arrival 7.9 dB down.
- Eight sync cues fail by a fraction of a millisecond because their instants are exactly on frame times.
- Masking per band is far kinder than check 9's broadband prediction (27 at risk against 79): placeholders are narrow.
- The backgrounds' crossfade at the place change is two voices of one group for 50 ms; check 12's allocator calls that
  a cut. I count a crossfade of two unplaced beds of one family, no longer than `TIMBRE.crossfadeSec`, as intended
  (kind `crossfade`, with a planted overlap 0.1 s longer shown to fail). A ruling for the lead.
- Detecting the bridge's water bed on its stem finds it 24 ms before its t0: it starts half the crossfade early on
  purpose, so the renderer reads an unplaced bed from `bedSpan`.
- The AAC night stem reads 0.3 LU louder than its float signal (noise at 96 kbps).

## Tests changed

| Test | Change | Reason |
|---|---|---|
| `tests/audio.test.mjs`, the finished soundtrack | "-16 LUFS" read as `targetOf(CONFIG.audio)` (the default stage's target, -23 now); the 0.2 LU and -1.5 dBTP bars unchanged | the target is per stage since this step |
| `tests/audio.test.mjs`, the sidecar | one assertion added: a raw render names no target | the sidecar now names its target |
| `tests/audio.test.mjs` | new: the target per stage, with a stage the table lacks as its control | the new `targetOf` |
| `tests/sound-measure.test.mjs` | new, 23 tests | the tooling and the review's measures, each with its planted fault |

No bar was relaxed. `onsets()` was refactored onto a shared detector; it returns the same times on all 30 voice
groups' stems (checked), and the existing onset tests pass unchanged.

## Carried forward

| Item | Where |
|---|---|
| The 12 sync misses (unchanged from Sound 1) and the 8 on-frame instants | Sound 3 |
| The latches only below 250 Hz on measured bands | Sound 4 (the real latch); check 14 stays failing until then |
| The phone model's sources are excerpts | a phone measured, if it matters at Sound 5 |
| The rustles part plays both people in one stem | Sound 4 replaces RUSTLES |
| The template has no per-stage target | when the template gains stages |
