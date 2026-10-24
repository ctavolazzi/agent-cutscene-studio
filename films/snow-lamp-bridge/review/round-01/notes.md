# Round 01: Stage 1, sketches and storyboard

Gate 1. Nothing 3D exists yet. Everything below is drawn from three data files, so the plan cannot drift from the scene:
`src/set.js` (the layout), `src/world.js` (car, people, moon and lights as pure functions of time) and `src/shots.js` (15 cameras).

## What to open

| File | What it is |
|---|---|
| `storyboard/index.html` | The contact sheet in shot order: map, detail maps, 15 panels, audit tables. Open this first. |
| `storyboard/map.excalidraw` | The editable map: main map plus three detail maps side by side. Open at excalidraw.com and mark it up. |
| `storyboard/map.svg`, `map-detail-*.svg` | The same maps as SVG. |
| `storyboard/panels/shot-NN.svg` | One panel per shot: a true-perspective sketch through the shot's real lens, with the world as it is at that second. |
| `review/round-01/*.png` | Rasters of all of the above, so you can look without opening a browser. |

How to read a panel: white dashed lines are thirds, the red band is the bottom 120 px of a 1080p frame, white arrows are camera moves, and the smaller frames in the caption strip are other moments of the same shot (the end frame of a move, or key beats).

## What I checked, and how

Numbers, not eyeballing, from the shot data (`storyboard/report.json`, tables at the bottom of the contact sheet):

- **Car and the corner building.** A ground-plane sight line against the building footprints, from camera 3: the car is hidden from the start, its nose clears the south-east corner at **17.7 s**, all of it is visible at **18.6 s**. Headlights come on at 13.0 s, so the beams reach the facades about 4.7 s before the car does.
- **Screen direction.** In shots 3, 5, 6, 7, 9, 11 and 13, north (toward the bridge) is screen left in every one.
- **180 degree line.** Cameras for shots 9 to 15 are all on the west side of the A and B line (x 5.25).
- **Cuts.** Every cut changes the angle on the subject by 30 degrees or more, or the shot size by a clear step, or goes to a new subject. Smallest angle change is 17 degrees (5 to 6), which is a 4x size step.
- **Safe strip.** No landmark (heads, feet, lamp, moon, car) falls in the bottom 120 px at any sketch frame or last frame.
- **Moon.** Visible in shots 10, 13 and 15, clear of the lamp in each (shot 15 reads pair, moon, lamp left to right, about 18 degrees apart).
- **Excalidraw file.** I ran it through Excalidraw's own `restoreElements` and `exportToSvg` (v0.18.1) in Chromium: 520 elements in, 520 out, none dropped, export succeeded. `excalidraw-roundtrip-check.png` is what Excalidraw's own renderer makes of the file.

## What I found and changed during self-review

Three passes: all 15 panels and the maps; the 12 panels that changed; then spot checks plus the Excalidraw round trip.

Problems I wrote down before fixing:

1. **Lamp bulb and car headlights drew as huge solid discs** (shots 1, 5, 8, 15). Sized in meters now, with a soft glow.
2. **People read as balls on sticks.** Round caps on coats and a ring of outlines at every joint. Coats are now tapered quads with a flat hem, limbs have no outlines.
3. **A and B stood upright for eight seconds** (92 to 100 s) instead of leaning on the rail. A real bug in `world.js`: any position change counted as a walk, including the 0.2 m shoulder lean-in. Walking now means faster than 0.2 m/s. Found because the ember in shot 14 was in the wrong place.
4. **The moon was eight times too big, and had a black disc in it** (covering the crescent with a sky-coloured circle). Now 1.4 degrees in radius, drawn as a true thin crescent.
5. **The moon was hidden behind my own seeded skyline** in shot 10, and the lamp sat on the same bearing as the moon from the plaza. The skyline is kept low along the moon's bearing and the camera moved to z -7.9.
6. **Shot 15 (the last image) hid the moon behind the east-row building.** Camera moved to the bridge entrance, (-2, 3.0, -7.4).
7. **Shot 9 looked at a building, not the river.** The arc moved from the north-west to the south-west (azimuth 232 to 217), which also clears the 30 degree cut rule against shot 10.
8. **B hid behind A in shots 8 and 13.** They now walk in a loose diagonal (A ahead and west of B), and shot 13 is from the west with both visible.
9. **Shot 11 and 12 showed whole heads in the foreground.** The framing now half-crops B (11) and A (12), so they read as shoulders.
10. **Doors were drawn on top of the front wheels.** A real sedan's front door is about 0.4 m ahead of centre, between the axles. Moved, so B's boots show in the gap under the car.
11. **Shots 3 and 5 did not show their own beat.** Panels now carry inset frames: shot 3 shows beams on the facade, the car emerging, and the end; shot 5 shows B's boots, the headlight cut, and lamp light only.
12. **Excalidraw sheet had the three detail maps stacked on top of each other.** Caught by the round trip, not by the SVGs. Fixed.

## Changes from the brief and from my Stage 0 plan (all in the data files)

| Item | Brief or Stage 0 | Now | Why |
|---|---|---|---|
| Car front bumper stop | z -3.0 | z -0.5 (car centre z 1.85) | The walk to the rail has about 17 s. From z -3.0 it was 0.45 m/s. Now about 0.6 m/s. Needs a lamp pool of radius about 7 m, noted for Stage 4. |
| Lean spot | x 5.4 | x 5.25, B z -10.0, A z -11.3 | Body centre sits 0.3 m off the parapet's inner face (x 5.55). |
| Moon azimuth | 75 (Stage 0) | **84** | See question 1. |
| Shot 2 camera | z 42 | z 62 | At z 42 the camera was inside the south buildings and walls filled both thirds. |
| Shot 4 camera | near the lamp base | (3.8, 0.25, -6.5), a step north-west of the lamp base | Distance to the stopped car is 6.3 m, matching the brief. |
| Shot 9 | from behind | from the south-west, arc 232 to 217 degrees | River and city beyond, and a 47 degree cut from shot 10. |
| Shot 10 camera | (-19, 2.5, -4.2) | (-19, 2.5, -7.9) | Separates the lamp from the moon. |
| Shot 13 | from the south-west end | from the west, (-1.0, 1.5, -8.0) | Both people visible. Brief says "three-quarter front"; faces are not visible from the west, so it is a rear three-quarter. |
| Shot 14 | from the south-west | from the north end, (4.8, 1.55, -13.8) | B hides behind A, so the ember reads alone. |
| Shot 15 | (-3, 3.4, 1.5) | (-2.0, 3.0, -7.4) | Clear view east, moon not behind a building. |

Stage 0 question defaults taken, since you said to start: west-side cameras only, shot 2 re-blocked, per-fragment lighting, 24 fps HTML ticks, home in `_workbench/snowy-bridge/`.

## Still weak, and what I am unsure about

- **The figures are crude.** Capsule limbs, no faces. Enough to judge staging and eyelines, not enough to judge performance. That is Stage 5.
- **Shot 3's main frame is low on information.** At 16.4 s a tall wall fills the frame and the lit patch on the facade is the only content. The two insets carry the shot. I think it is right (you see light before the car), but it is the weakest panel.
- **Shot 5 is dark and busy at the main frame.** A's coat hem on the right, B's legs in the gap under the car, the far headlight glowing top left. The insets read better.
- **Shot 9: A is mostly hidden** behind B and the rail from this angle. The beat (they reach the rail and lean) reads, A's face does not.
- **Shot 14's arms are heavy tubes** at 85mm. A rendering artifact of the sketch, not a staging problem.
- **No faces are visible anywhere from the west.** As planned in Stage 0, glances read by head turns and the nose tick. If that turns out too opaque in the blockout, the fallback is a river-side camera for shots 11 to 13.
- **Lamp pool.** The staging needs a visible warm pool of radius about 7 m. A three.js SpotLight with a 70 degree half angle should do it, but this is untested until Stage 2.

## Questions for you (defaults in bold, "go" takes them)

1. **Moon azimuth: 84 degrees (almost due east), or the brief's east-north-east (67.5)?** At 84 the river's two banks converge there, so the moon can rise between the city banks, as the brief asks. At 67.5 it would rise behind the north-bank skyline. To keep ENE I would have to bend the river downstream, which is more set work. **Default: 84.**
2. **A walks around the front of the car in 0:34.6 to 0:39.9,** crossing the dying headlight beams as they cut at 0:36.2 to 0:36.6. Shot 5's camera is at the side so this is mostly off screen. Fine, or do you want it seen? **Default: leave it off screen.**
3. **Shot 2:** the corner building you named is the second block on the right; the first dark mass is the building beside it. Reads as a canyon leading to the bridge. OK, or do you want the corner building more prominent? **Default: OK.**
