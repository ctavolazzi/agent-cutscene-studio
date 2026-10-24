# Gate 2: blockout, round 02

Stage 2 is built, checked and reviewed. This round covers what the blockout proves: the timing of the 112 s, the
staging of each shot, the cameras, and the cuts. It is grey boxes with placeholder snow, so the look is not judged here.

## Files

- `preview.mp4`: the whole film at 480x270 with the shot overlay. H.264, yuv420p, BT.709 tagged, no audio.
  2,688 frames, 112 s. Captured in 159.8 s, 59.4 ms per frame (SwiftShader, headless Chromium).
- `stills/shot-NN-{first,mid,last}.png`: 45 stills at 4x, plus `mid-phone` copies at 384x216.
- `contact-sheet.png`: every shot, first, middle and last.
- `storyboard-sheet.png`, `panels/`, `map*.png`: the Gate 1 storyboard regenerated from the same data files, so the
  two can be compared side by side.
- `findings.json`: the 28 findings of the independent panel, with the skeptics' verdicts.
- `decisions/tSSS.mmm.png`: extra stills (4x, overlay on) at the moments the six decisions are about;
  `decisions/south-*.png` is the test render with the lamp moved 1.5 m south. Added 2026-10-22.
- `measure.json`: the measured numbers for the lamp, the tyre, shot 3, shot 8 and the frame brightness, from
  `node scripts/gate2-measure.js`. The arm and foot heights in Corrections 2 and 5 come from the rig (`makePoser`), checked
  by the second review.
- The review page: `node scripts/blockout-page.js` writes it to `out/gate2-page/` (not committed; it copies these files
  and adds gamma-lifted ones).

## Checks (all pass)

- Module tests: car 15, people 27, lights and snow 27, set 18, checks 21, capture 17.
- `check:forbidden`: 0 hits. No em or en dashes in any changed file.
- `check:determinism`: 62 scrambled times, byte-identical on a fresh page, 61 distinct frames.
- `check:cameras`: 188 comparisons against the storyboard's report, worst 2e-15 (tolerance 0.01).
- Storyboard numeric checks: every cut passes its angle or size test except the two intended new subjects (2 to 3, 3 to 4).

## The independent panel

Five reviewers (three shots each) read the stills against their storyboard panels, the camera rules and the
brief, and rendered extra moments where a beat fell between stills. Five skeptics then tried to refute each finding.
Result: 28 findings, 24 confirmed, 4 refuted. Two were blockers, both in shot 5. Full list with verdicts:
`findings.json`. Disposition below.

## Disposition

| # | Shot | Finding | Result |
|---|---|---|---|
| 0 | 3 | The pan started late and overtook the car | Fixed: pan starts at 17.4, just before the nose clears (17.7); car stays at screen x 0.42 to 0.62 (was 0.09 to 0.63) |
| 1 | 2 | Headlights switched on one second before the cut | Fixed: the car starts at 14.0 from x 38.7, same path after 14.0 |
| 2 | 1 | Eye trace from lamp to lamp across the 1 to 2 cut | Refuted: both framings are the approved Gate 1 compositions |
| 3 | 5 | Headlight cut invisible from the camera (blocker) | Fixed: the camera pans north-east along the car's nose and the beams fall on the road in frame |
| 4 | 5 | Boots appear from nothing (blocker) | Fixed: each person is seated inside the car, then gets out feet first and rises in place; boots land at 31.8 and 33.2 |
| 5 | 5 | Truck runs away; the front tyre fills the frame | Partly: the camera holds on the door until 34.4, then trucks with A. The front tyre still fills the frame at 35 to 36. **Gate 2.** |
| 6 | 5 | B's boots are 10 cm tall, dark on dark | Fixed: B stands on the road at x 3.33 (the last flat ground before the curb ramp); the gap under the car shows the full 25 cm |
| 7 | 6 | B stands behind the car's corner | Fixed: B's stand spot moved 0.25 m east; checked by eye |
| 8 | 6 | A turns its back instead of through the lens | Refuted: a turn through the lens would break PLAN 3.7 |
| 9 | 9 | Forearms on the railing read as stiff arms | Fixed: parapet top 1.15 m (was 1.30). **Gate 2: decision.** |
| 10 | 7 | The dolly falls behind the walking pair and overtakes it | Fixed: `ease: 'linear'` for shot 7; the pair's screen x holds at 0.620 for the whole shot |
| 11 | 8 | A and B swap sides between the cuts | Fixed: A is on the river side of B through 7, 8 and 9 (A left in every sample) |
| 12 | 8 | The lamp post merges with B's silhouette | Mostly fixed: the post now sits at A's left edge, not behind B. 2026-10-22: by the cut it is in A's head. **Gate 2: see Corrections, 3.** |
| 13 | 7 | The 6 to 7 cut reads as a punch-in | Refuted: 34 degrees and a size step of 1.73 on the same lens |
| 14 | 11 | The lighter strikes before the cup is formed | Fixed: lighter at 78.6, after the turn and the cup |
| 15 | 12 | B's look back is cut halfway through | Fixed: B's glance is in shot 12, B holds on the city and is back by 88.7 |
| 16 | 12 | Parapet at B's shoulder height: arms read as level bars | Fixed by the parapet height (9). **Gate 2.** |
| 17 | 12 | B's hand touches A's coat on screen | Fixed: camera 0.35 m west at 70mm; B's hand clears A's coat by about 190 px (checked) |
| 18 | 12 | Framing says medium close, shot is medium | Fixed: 70mm, medium close as written |
| 19 | 10 | T-shaped arms at the rail | Fixed by the parapet height (9) |
| 20 | 13 | No glance happens in shot 13 | Fixed: A looks at the river until 90.9, glances at B 91.7 to 93.2, back by 94.2 |
| 21 | 13 | The shoulders-lean-closer beat does not read | Fixed: the lean-in happens inside 13 (94.2 to 95.8), not spread over 13 to 15 |
| 22 | 13 | Stray one-pixel line in the last second (render error) | Fixed: the embankment walls and the land and water planes are subdivided so no triangle is 5 km long. Verified: no fog-coloured column in the last frame |
| 23 | 13 | B has two glances and the second has no hold | Fixed: B looks at A once (shot 12) and holds on the city afterwards |
| 24 | 14 | The insert starts on the edge of A's hand | Fixed: the insert is still once the lean is done (94 to 96) |
| 25 | 14 | Snow passing in front of the subjects | Refuted for Stage 2: the snow is a placeholder, and the snow layers are Stage 4.10 |
| 26 | 15 | The parked car's nose slides in at the right edge | Fixed: the end camera pulls back along 245 degrees with the pair at sx 0.28; the car is out of frame |
| 27 | 15 | A window sits on top of the lantern in the end frame | Fixed by the same move: the lantern stands clear of the window |

## Decisions for Gate 2

1. **Shot 5: the doors are outside the lamp's pool.** The lamp reaches 7 m; the doors are 8 to 9 m away. The feet and
   the car read by the headlights and a faint lamp fall-off. Options: (a) move the lamp 1.5 m north, as the roadmap's
   risk note allowed; (b) keep it and let the headlight cut carry the shot, which is the PLAN 3.9 beat. I recommend
   (b) for the blockout, and the look stage can add a lamp glow instead of moving the post.
2. **Parapet height 1.15 m, not the 1.30 m in the plan's first table.** At 1.30 m both people's hands sat level with
   their shoulders, so leaning on the rail read as holding arms out. At 1.15 m their forearms rest on it. If 1.30 came
   from the brief rather than the table, the lean pose has to change instead; say which.
3. **Shot 8 is now three-quarter, not frontal, and A is on the river side of B.** The camera moved from x 5.3 to x 4.0
   because from 5.3 the pair lines up along the camera's view and A hides B, and from 1.0 A walks in front of the lamp.
   At x 4.0 the bulb is fully visible, A is left of B in every sample, and the pair is about 0.03 of the frame apart
   at the closest, with the lamp post at A's left edge. Options: accept; or make B trail further (a 0.5 m gap across the
   deck) and accept a lamp post at A's edge.
4. **Shot 5: the front tyre is in frame at 35 to 36.** The camera is 1.7 m from the front wheel while it trucks north.
   Options: hold until 35.5 and push in on the feet instead; or lengthen the lens to 50mm and step back 0.5 m.
5. **Getting out changed, and the beats are the same.** Both people step out of the car onto the ground feet first,
   rise in place, then walk clear of the open door. A's boot lands at 31.8 and B's at 33.2, as PLAN 3.9 has them.
   Confirm the choreography.
6. **Shot 3, car path: a 0.2 frame drift.** The car drifts from 0.42 to 0.62 as it turns north, and the pan follows it
   instead of overtaking it. Acceptable for blockout; the look stage may tighten it.

## Corrections, 2026-10-22 (second session, before your answers)

Found while building the review page and checked twice by independent reviewers, each finding put to a skeptic. Every
measured number comes from `scripts/gate2-measure.js` (`measure.json`); the frames for each decision are in `decisions/`.
No staging data changed. These replace the options and recommendations above. **Answer with these letters.**

1. **Shot 5, the lamp.** The doors are outside the lamp's 7 m pool (a Stage 4 target; the blockout spot has no range
   cutoff, so blockout brightness cannot compare the options). Measured from the pool's centre under the lantern, A's boot
   lands 8.36 m away and B's 7.66 m; A at the rail is 5.34 m, B 4.05 m. North is toward the bridge, away from the car, so
   the notes' "move it north" makes the doors darker (9.74 and 9.14 m). The headlights point north and do not light them.
   From 30.5 to 35.0 s the frame averages 1.4 to 1.9 out of 255: A's landing is invisible, B's boots a faint silhouette.
   - (a) Keep the lamp; Stage 4 stretches the pool to about 8.4 m while still lighting the rail (ROADMAP 4.7 requires
     "the pool covers the car doors and the lean spot").
   - (b) Keep the lamp; add one car light for the get-out (on at 30.5 s, fading with the headlights at 36.2 to 36.6 s).
     An eighth light against PLAN 4.2's fixed seven and its test.
   - (c) **Recommended.** Move the lamp 1.5 m south. The planned 7 m pool then reaches B's landing (6.19 m), A's within
     4 cm (7.04 m), and both rail spots (6.83 and 5.54 m). Costs: the post comes into shots 4 and 6 and leaves shot 12;
     in shot 4 it stands 2.3 m from the camera at the left edge, so that camera moves a little in round 2. Shots 1 and 2
     re-aim with it. (A test render, `decisions/south-*.png`, is still dark because the blockout lamp is untuned.)
2. **Parapet height.** The brief asks for a railing "chest high, leaned on with forearms" (ROADMAP, Done means). 1.15 m
   is about B's lower chest and A's elbow height. B's forearm nearly rests on it (elbow joint 9 cm above the top); A's does
   not (elbow 14 cm above, the arm sloping about 27 degrees to the hand), which is still the stiff-arm read of finding 9.
   At 1.30 m only B's hands were at shoulder height (A's were 14 cm below A's shoulders).
   - (a) **Recommended.** Keep 1.15 m and rework A's lean in round 2 so A's forearms rest too.
   - (b) Go back to 1.30 m (chest high for A) and rework both poses.
3. **Shot 8.** The outlines overlap for 2.9 s (closest at 57.6 s) and from 58.0 s the lamp post is inside A's outline;
   at the cut it rises out of A's head (finding 12 moved from B to A). The notes' option accepted the post at A's edge
   without knowing where it ends. B trailing further does nothing from this camera; a 0.5 m gap across the deck nearly
   clears the overlap (0.04 s) and 0.69 m clears it with margin. The wider spacing eases in after 54.0 s on the
   sidewalk, so shot 7 is untouched.
   - (a) Accept it. (b) Widen the gap only. (c) **Recommended.** Widen the gap and move the camera or A's last steps so
     the post clears A's head at the cut.
4. **Shot 5, the tyre.** The camera slides 1.3 m north, passing 1.7 to 2.1 m from the front wheel, which is in frame
   from 34.7 to 37.6 s (a second past the headlight cut) and covers up to 19% of it. 50mm from 0.5 m back changes
   nothing (19.1%); from 1.5 m back the wheel drops to 11.2% but A's feet come out at about half size (0.51 to 0.57).
   Holding on the door until 35.5 s and then pushing in does not work as written: every end frame that holds A's feet
   and both beams without the wheel looks roughly north, the hold looks east, and that turn cannot be gentle in 0.7 s.
   - (a) **Recommended.** Redesign the move: start the turn toward the bridge earlier, while A is still near the door,
     so the wheel stays out. I design it in round 2 and show you frames before rendering the preview.
   - (b) 50mm, 1.5 m further back. (c) Keep it for the blockout.
5. **Getting out.** As built, both feet come out together at sill height and land together (A at 31.8 s, B at 33.2 s),
   then the body rises in place. The shot's text says "a boot lands" and PLAN 3.9 has "A's boot lands" and "B's boots
   land", so A landing on both feet at once reads as a hop.
   - (a) Confirm as built. (b) **Recommended.** A puts the foot nearest the door down first, then the other; B as built.
6. **Shot 3.** The car moves from 0.42 to 0.62 of the frame while it drives west and brakes (17.9 to 20.75 s), then back
   to 0.55 during the turn (20.6 to 22.0 s). The nose clears the corner at 17.7 s, just after the pan starts at 17.4.
   - (a) **Recommended.** Accept for the blockout. (b) Tighten it in round 2.

Recommended set ("go"): **1c 2a 3c 4a 5b 6a**.

Also asked at this gate (ROADMAP Stage 2): **pacing**, any shot in the preview that runs long or short, in your own
words; and the **lamp shadow map**: the blockout does not suggest one, since nothing in it depends on cast shadows yet. The
blob shadows (4.9) come first; I will raise a shadow map again only if they do not ground the figures.

## What changed in the test files (for review)

Everything the test checks is still checked. These changes were needed because the staging moved:

- `people.test.mjs`: the old "exit pose on appearing" check is four checks (seated, outside the car body; the get-out
  is never a walk; both boots on the ground outside; no sole below the underside under the car). Two numeric changes,
  each with its reason in the file: the standing-height tolerance is 1e-4 (not 1e-9), because the walk table widens each
  walk by one sample; and the "appears after the door opens" check now allows the seated appearance once the door
  starts to open, because the car's body hides them until they are out.
- `car.test.mjs`: door and start times now read `carTimes`, not literals. The door sweep is strict: no door passes through
  anyone (the known-conflict allowance is gone).
- `set.test.mjs`: the ground is checked as pieces around the roads; no piece runs under a road; the pieces and roads cover
  the ground.
- `lights-snow.test.mjs`: headlight positions at the lenses; the lighter and the ember read the rig's hands and tip; the
  rig import is allowed for lights.js only.

## Measured

- Still renders: 45 stills in 6.0 s.
- Preview: 2,688 frames in 159.8 s, 59.4 ms per frame.
- Load: 0.7 s.

## Known, for Stage 4 and later (not blockout problems)

Moon as a full disc (crescent at 4.5); no glow on the lamp, lenses or windows (4.8); snow not lit by the headlights
(4.10); no footprints (5.3); no lighter flame, ember or smoke sprites (5.4, 5.5); window emissive values (4.7); figures
are grey boxes.
