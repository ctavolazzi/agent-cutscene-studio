# Round 05: Sound 2.12, the options measured before asking (branch s2-options)

ROADMAP Sound 2.12: the muffle on the hidden engine done the PS1 way, a narrower pan for sync foley, the second listener
model, and the style-frame scene, each measured before it becomes a question at Sound gate 2. This file is for the lead
to merge into `notes.md`. Every number below is in `decisions/decisions.json`, made by
`node scripts/sound-options.js --round 05` (about 5 minutes with the clips, 2 without: `--no-clips`). These are
placeholders: what each can and cannot show is said under each option.

## How each A/B was made

- **A** is every switch off: today's blockout. **B** is one switch on at its starting values. The switches live in
  `config.audio.options` (all off), read by the blockout's voices (`layers/blockout/voices.js`) and the spatializer
  (`spatial.js placeAt`). The picture's hidden state reaches the render only as `makeContext`'s `occlusion`, which only
  the options script builds (from Sound 1's own screen states and blockers); src/ never imports scripts/.
- **Measured per cue, before the master.** Each cue is rendered alone through its own voice and the real spatializer,
  so a difference is the option's, not the limiter's or another cue's (`scripts/lib/sound-options-lib.js renderCue`).
  A cue's level is in dB over the street background (the level rule's unit); "its loudest 100 ms" is the level plan's
  measure of a voice.
- **What each switch moves.** Every placed voice rendered under A and B; the cues that differ against the cues the
  option names, written from its definition and not from its code; and the whole mix before the master compared outside
  the named cues' samples.

  | Switch | Named | Moved | Moved, not named | Named, not moved | Mix samples changed outside the named cues |
  |---|---|---|---|---|---|
  | muffle, volume | 19 | 19 | 0 | 0 | 0 |
  | muffle, swap | 19 | 19 | 0 | 0 | 0 |
  | narrower pan | 74 | 74 | 0 | 0 | 0 |
  | characters' listener | 125 | 115 | 0 | 10 (both listeners give them the same gain throughout: inside the law's refDist) | 0 |

- **Byte identity, every switch off.** The default render (`node scripts/sound.js`) is sha256 `6f9c4925...cb7` before
  and after; the design stage with the score unparked is the S8.3 `f80b1542...1da` before and after.
- **The clips.** 7 s each, `capture.js --profile preview`, the overlay on, each with the capture's own sidecar
  (ffprobe facts). The soundtrack: the A mix's master, replayed exactly (`a.wav` has the default render's sha256), then
  each option's set of mixes through A's gain and **one** limiter curve, from the loudest of the set at each sample. So
  at every sample B over A is the option and nothing else, and nothing passes the -2 dB ceiling. The cost: where B is
  louder than A at a peak, that curve turns A down too. Inside the clips: the muffle's and the pan's A are within
  0.06 dB of the default preview (at most 1.47 and 0.23 dB at single peaks); the listener's A is 0.81 dB under it on
  average and up to 9.94 dB at B's loudest steps. Through A's own curve the listener's B would reach +7.9 dBFS and clip.
- **The audibility bar** (ROADMAP 2.12, starting values): 1 dB in level or 0.1 in pan at the cue. All three A/Bs measure
  over it, so all three are "ask the director". The style frame is a question by the gate table.

## Option 1: the muffle on the hidden engine

**Definition.** While the picture hides a placed cue's source (Sound 1's onScreen judgement: its rendered point through
the frame's camera, a blocker between them), its voice is muffled, the PS1 way, since the SPU has no per-voice filter:

- **volume:** the voice's volume drops by 6 dB;
- **swap:** the voice crossfades to a copy of itself through a fixed lowpass, the pre-filtered sample a PS1 bank would
  hold, playing in step from the onset (two voices while the cue lives).

The hidden state is read per block and the muffle follows it over 50 ms. It names every cue hidden on any frame.

| Starting value | Why |
|---|---|
| dropDb 6 | One tier of the level plan (SOUND-PLAN 1.3: foreground at least 6 dB over the background, midground 0 to 6): a hidden sound steps down by the gap between the two |
| lowpassHz 900, two 2-pole sections | An octave under the darkest the air law reaches with distance (`SPATIAL.minAirHz`, 1800 Hz), so it reads as something in the way, not far away; built as the placeholders build their bands |
| rampSec 0.05 | The backgrounds' crossfade at the place change (`TIMBRE.crossfadeSec`): no click, done 8 ms into the frame after the change |

**Which cues, when** (the same 19 voiced cues and frames as Sound 1's check 2):

| Shot | Cues | Hidden by | Hidden frames |
|---|---|---|---|
| 3 | the intake (14.000 to 17.875), the tyres (to 17.917 and 18.458) | building SE | 93, 94, 107 of 360 |
| 3, 4 | the exhaust (14.000 to 29.000) | building SE 111, **its own car body 229** | 340 of 360 |
| 5 | handbrake, both belts, getting out (A and B), the passenger door (unlatch, swing open, stop, swing shut, latch), B's walk and two turns (cloth) | the car body | all or most of their frames |

**Measured at the cue** (level while hidden, B against A):

| Cue | A while hidden (dB over the bed) | Volume | Swap | Swap's centroid |
|---|---|---|---|---|
| intake | -0.35 | -6.00 | -1.91 | 628 to 570 Hz (-0.14 oct) |
| exhaust | +2.33 | -5.99 (-5.29 over its whole 15 s) | -1.95 | 632 to 573 Hz (-0.14 oct) |
| tyres, front and rear | -8.14, -7.71 | -6.00 | -6.05, -6.13 | -0.20 oct |
| cabin (handbrake, belts) | -3.3 to -4.4 | -6.00 | -56.7 to -58.8 | 6.0 kHz to 2.0 to 2.2 kHz |
| passenger unlatch | +11.41 | -6.00 | -21.62 | -0.37 oct |
| cloth (B's walk and turns) | -0.04 to +1.69 | -6.00 | -12.6 to -12.8 | -0.46 to -0.50 oct |
| getting out (4) | -3.3 to -8.1 | -6.00 | -2.97 to -2.98 | 0 |
| door swings, stop, latch | -6.9 to +6.6 | -6.00 | -0.03 to -3.20 | 0 to -0.02 oct |

**In the mix, at the moments:** the engine clip (14.0 to 21.0 s): -2.19 dB with the volume drop, -2.56 dB with the
swap. The car-body clip (28.67 to 35.67 s): -0.22 and -0.25 dB (the muffled cues are small sounds under the idle).
The swap takes more off the engine clip than its per-cue numbers say because the intake's and the exhaust's
placeholder buzzes are the same saw from the same rpm track: in A they add coherently (1.76 times the sum of their
powers over 14 to 21 s), and the swap's lowpass shifts the exhaust's phase against the intake's. A placeholder
artifact (below).

**Voices:** the swap holds two voices per muffled cue; the peak demand goes from 12 (33.31 s) to 15 (28.38 s) of 24.

**Clips:** `decisions/muffle-engine-a.mp4`, `-b-volume.mp4`, `-b-swap.mp4` (14.000 to 21.000 s: from the engine's first
hidden frame through the car coming into view) and `decisions/muffle-car-a.mp4`, `-b-volume.mp4`, `-b-swap.mp4`
(28.667 to 35.667 s: where the muffle takes the most off the car-body cues).

**What a placeholder can show:** when the muffle acts and how much level it takes off each voice. **What it cannot:**
what a real muffle sounds like. The engine's buzz sits in a band at 650 Hz, under the 900 Hz cutoff, so the swap barely
touches it, while a recorded engine has the top end a swap removes; the cabin's 5.9 kHz clicks lose nearly everything.
The swap on the engine can only be judged at Sound 4.

**Call: ask the director** (both ways move every hidden cue by 1 dB or more: -6.00 dB, and -1.9 dB on the engine for
the swap).

**What I would recommend as the default:** no muffle, as today. Where the plan wanted one, the building hides the intake
from 14.000 to 17.875 s, but the engine rises out of the quiet until 16.5 s, so the muffle acts on it at full level for
only the last 1.4 s; most of what the engine clip loses is the exhaust, and 229 of its 340 hidden frames are its own car
body, which a listener does not hear as something in the way. If the director wants a muffle: the volume way, counting
the set (buildings, parapets) and not a car's own body for the car's own sounds, and the cabin sounds inside the closed
car; the swap measured again on the designed engine at Sound 4.

## Option 2: a narrower pan for sync foley

**Definition.** The pan of every foley cue of the kinds named (`syncPan.kinds`: the steps, the scuffs, the hands'
contacts: the forearms' rest on the parapet and the cup round the lighter) times 0.5, from the camera as today. Every
other cue keeps its pan.

| Starting value | Why |
|---|---|
| widthRatio 0.5 | Halfway between the physical pan (1) and the centre (0): a midpoint to find out whether narrowing is audible at all, not a designed width. The frame edge pans 0.12 to 0.33 by lens instead of 0.24 to 0.66 (SOUND-PLAN 3.4) |
| kinds | The sync foley the plan names; cloth on the walks, turns and shifts is not a contact and keeps its pan |

**Measured:** 74 cues named (63 steps, 8 scuffs, 3 contacts). **28 move by 0.1 in pan or more** at their onset (25
steps, 3 scuffs, no contact), up to -0.399; their balance in their stem windows moves up to -10.24 dB. By shot: 17 in
shot 5, 9 in shot 7, 2 in shot 9. **The four largest are B's steps off screen right in shot 5** (pan 0.68 to 0.80,
halved to 0.34 to 0.40), the steps SOUND-PLAN 3.7 keeps off screen right on purpose; the others are steps and scuffs
on screen away from the centre (x 0.21 to 0.84 of the frame) in shots 5 and 7, plus 2 off the bottom edge in shot 9. The contacts sit near
the centre and move under 0.1 (0.092 at most). Every narrowed render's balance follows the narrowed law within
0.0001 dB.

**In the mix at the moment** (32.833 to 39.833 s): the balance moves 0.49 dB toward the centre; the level does not move.

**Clips:** `decisions/sync-pan-a.mp4`, `sync-pan-b.mp4` (32.833 to 39.833 s: where the sync foley's pan moves the most;
B walking round the car). Headphones needed.

**What a placeholder can show:** the pan itself; the spatializer pans by level alone, so a band-limited step moves
exactly as a real one would. **What it cannot:** how wide the image feels against real backgrounds and real steps, whose
top end localizes better than a 1.25 kHz band; on a phone both are mono.

**Call: ask the director** (28 cues move by 0.1 in pan or more).

**What I would recommend as the default:** the physical pan, as today. The cues it moves most are the off-screen steps
whose pan is what tells where B is; the rest are on-screen steps the narrower pan would pull away from the feet.

## Option 3: the second listener model, level from the characters

**Definition (the level listener).** The level of every placed voice by its own distance law from the characters'
point: the mean of the visible people's cloth points (each poser's root plus 1.2 m, `DESIGN.CLOTH.up`, where cues.js
puts their cloth sounds). That is A alone from 30.900 s (the poser shows A just before frame 742, A's first frame out
of the car), then the midpoint of A and B once B is out; before 30.900 s the camera's level holds. The pan, the air
lowpass and the darker sound behind the camera stay the camera's; the behind loss is not applied to the characters'
level (it is the camera's). This is the model `scripts/sound-report.js` already predicts with, and the render matches
the prediction: the 88 one-shots it names are within 0.12 dB of it.

| Starting value | Why |
|---|---|
| listener 'characters' | The storyboard's own characters model, so the render can be checked against what Sound 1 predicted at every cut |

**Measured:** 125 placed cues sound after 30.900 s; 115 move. The other 10 have the same gain under both listeners
throughout, both inside the law's reference distance (A's first three steps, scuff, walk and turn, A getting out, the
driver's door swinging open and stopping).
**98 move by 1 dB or more at their loudest 100 ms** (103 in their worst 100 ms window), **all louder**: no cue gets
quieter by 1 dB, since the people stand nearer their own sounds than the camera does.

| Largest movers | Loudest 100 ms, B against A |
|---|---|
| shot 8's steps (A 26 to 28, B 18 to 24), the 50 mm at about 15 m | +10.3 to +11.4 dB |
| steps in shot 6 | up to +7.4 dB |
| scuffs, cloth, drags, doors, the exhale | up to +7.05, +6.98, +6.55, +6.38, +6.23 dB |
| ticks | up to +5.16 dB |
| the lamp's hum | +3.43 at its loudest; +13.87 in its worst window (54.0 s, the pair under the lamp) |

Under the characters every step in shots 7, 8 and 9 sits at 13.9 to 14.0 dB (its planned 14 dB); under the camera they
are 10.0 to 11.0, 2.5 to 4.7 and 10.5 to 13.4 dB. So the perspective jumps at 7>8 and 8>9 that SOUND-PLAN 3.6 keeps
(they follow the picture's change of size) vanish.

**In the mix at the moment** (52.792 to 59.792 s): +5.88 dB.

**Clips:** `decisions/listener-a.mp4`, `listener-b.mp4` (52.792 to 59.792 s: where the levels move the most, the walk
onto the bridge). Here the joint master turns A down by 0.81 dB on average, up to 9.94 dB at B's loudest steps, so the
A clip is a little quieter than the preview at those steps; B over A is still the option alone.

**What a placeholder can show:** every level change the model makes, cue by cue and at the moment the people appear.
**What it cannot:** the balance those levels make with real sounds (SOUND-PLAN 4.4: balance is reported at Sound 2, not
judged).

**Call: ask the director** (98 cues move by 1 dB or more, up to +11.4 dB).

**What I would recommend as the default:** the camera, as today. The characters' listener removes the perspective cuts
the plan keeps, lifts shot 8's far steps 10 to 11 dB (Sound 1.3 found them only 0.1 to 2.2 dB short of their margin),
and every level of the plan, set under the camera, would have to be set again; the mix also gets hotter at the steps.

## Option 4: the style-frame scene to design first in Sound 4

Candidates: runs of whole shots up to 32 s (the default's 24 s and a third, so it stays a scene heard before the rest),
picked by rule from the cues; facts from the cues and the storyboard's own density and voices checks. The film has 19
voiced families.

| Scene | Shots, time | Length | Families | Missing | Cues sounding, starting | Peak bodies, voices | Places | The hush | The densest moments |
|---|---|---|---|---|---|---|---|---|---|
| **default** | 4 to 6, 22.0 to 46.0 | 24 s | 15 | water, lighter, drag, breath | 74, 66 | 3, 12 | street | the engine dies (36.6); longest bed-only stretch 1.47 s (43.03) | both: the voices' peak (33.31) and 3 bodies |
| most families, shortest | 4 to 5, 22.0 to 40.0 | 18 s | 15 | the same | 64, 56 | 3, 12 | street | the engine dies; **no** bed-only stretch | both |
| both places | 5 to 8, 29.0 to 60.0 | 31 s | 14 | brake, tyres, lighter, drag, breath | 108, 105 | 3, 12 | street and bridge (the place change, the water) | the engine dies; 1.47 s | both |
| what the default leaves out | 11 to 13, 76.0 to 96.0 | 20 s | 9 (bg and foley only) | the car, the doors, the feet, the ticks | 19, 15 | 2, 11 | bridge | no engine; 5.20 s (shot 12, B looks) | neither |

All four use 3 categories except the last (bg and foley). **Call: ask the director** (gate 2, question 2).

**What I would recommend:** the default, shots 4 to 6. It holds every category, both densest moments, the engine dying
and 15 of 19 families. Shots 4 to 5 are 6 s shorter with the same families but no stretch where the backgrounds sound
alone, and SOUND-PLAN 3.18 sets the street background's level by ear on the style frame. Shots 5 to 8 are the choice if
the bridge's air (the water, the place change) should be in it, at the cost of the car's drive and 7 more seconds.
Shots 11 to 13 are the complement and better heard as the second scene.

## Findings beyond the options (for the lead)

1. **The intake and exhaust placeholders are phase-locked.** Both play the same saw from the same rpm track, so they add
   coherently: over 14 to 21 s the intake, the exhaust and the two tyres summed have 1.76 times the sum of their four
   powers (+2.4 dB; the tyres are noise, so the excess is the two buzzes), and the buzzes image as one phantom between
   their two points rather than two sources. Stems by voice group measure them apart, so a per-stem
   level reads right while the mix is louder. A placeholder fix (a per-voice phase or rate offset) is cheap if the lead
   wants it; until then the engine is louder in the mix than its two planned levels' power sum.
2. **Sound 1's blocker rule hides a car's exhaust behind its own body** (229 of 360 frames, the rear bumper seen from
   the front). Right for "is the point visible", wrong for "is the sound occluded"; it matters only if a muffle is taken.
3. **The characters' listener runs about 10 dB hotter at the steps**; through today's -16 LUFS master its B would reach
   +7.9 dBFS before limiting. Relevant to s2-measure's loudness target only if the option is taken.

## Checks (tests/sound-options.test.mjs, 9 tests, each with a planted fault)

| Check | Planted fault that fails it |
|---|---|
| every switch off renders today's samples (with no options key, with an occlusion and the muffle off, with the muffle on and no occlusion); the design stage reads none | the muffle on with an occlusion hiding everything |
| each switch moves exactly the cues it names, cue by cue and in the mix | the muffle leaking to a step, the pan to the lighter, the listener to before anyone is out |
| the volume drop is 6 dB on the 12 cues hidden on every frame (within 1e-4 dB; measured 2e-8); the swap takes 50 dB or more off the cabin (measured 56.7 to 58.8); a lowpass never raises a centroid; an unknown mode is refused | a 3 dB drop; a 20 kHz lowpass |
| the narrower pan is the camera's pan times the width, and each stem's balance follows it within 0.5 dB (ROADMAP 2.6) | today's renders against the narrowed law |
| the characters' listener holds the camera's level until 30.900 s, then matches the storyboard's prediction within 0.25 dB (measured 0.12) | a listener that hears from A alone |
| the hidden state is Sound 1's check 2, cue for cue and frame for frame | the car's boxes left out of the blockers |
| `masterOf` replays `normalize` sample for sample; a joint master keeps B over A and both under the ceiling | B normalized on its own |
| the style-frame candidates are the ones their rules pick | a lighter planted in shot 4 |

No existing test or bar was changed.
