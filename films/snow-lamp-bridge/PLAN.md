# Snow, Lamp, Bridge: Plan (Stage 0)

**Status:** Stage 0, waiting for your go-ahead. Nothing is built yet except this file.
**Home:** `_workbench/snowy-bridge/`, branch `claude/snow-lamp-bridge-scene-kyov3c` (question 1).

**Update, Stage 1:** a few values in section 3 were superseded when the storyboard was drawn from the shot data. They are listed in section 8 and in `review/round-01/notes.md`; the data files in `src/` are the source of truth.

Everything marked *measured* came from throwaway probes I ran in this container before writing the plan.
The probes live in the session scratchpad, not in the repo.

---

## 1. How I understand the scene

**What it is.** A 112 second silent film (2688 frames at 24 fps) about two people arriving at a threshold and
choosing to stay in it. Nobody speaks. The story is carried by light, by the order in which we learn things
(a beam, then a car, then boots, then people), and by where two people look.

**Arc.**

| Beat | Shots | What it does |
|---|---|---|
| Alone | 1 to 2 | Lamp, snow, empty street. Establishes the one warm light. |
| Intrusion | 3 to 5 | Light arrives before the car. The car arrives. The headlights die on purpose. |
| People | 5 to 6 | Feet first, then bodies, then a look toward the bridge. |
| Threshold | 7 to 9 | They walk out of the pool of light onto the bridge and lean on the rail. |
| Release | 10 | The moon rises. It is the only thing in the film that arrives without anyone causing it. |
| Closeness | 11 to 14 | The lighter, the ember, one glance each, shoulders lean together. |
| Pull back | 15 | The whole night at once: two small figures, one lamp, one moon. |

**Two lights meet.** The lamp is warm, near, and always there. The moon is cool, far, and late. The headlights are a
third, brief, hard light, switched off on purpose so that "lamp light only" is a decision and not a default. The last
frame holds lamp and moon together.

**The three orders in the brief are rules, not suggestions:** light before the car, feet before the people,
anticipation (the look off) before the moon. I will check each one in the blockout contact sheet.

**What the PS1 look is for.** Low resolution forces readable silhouettes. Dither gives the dark a grain you can see
into. Fog gives the city its haze. Vertex wobble gives held frames a pulse. It has to stay serious: slow, weighted,
faceless, no gags. The main tonal risk is that stiff low-poly motion reads as comedy, so all animation stays small and slow.

**Structure I will build around.** One continuous world clock, 0 to 112 s. The shot table only chooses the camera.
A cut never rewinds the world, so "cut on action" means the action carries on across the cut with no overlap.
That makes staging the real job: each beat has to be seen from the right camera at the right second.

---

## 2. What I checked before planning (measured)

| Check | Result |
|---|---|
| Tools here | node 22.22, npm 10.9, ffmpeg 6.1.1 with libx264, Chromium 141 in `/opt/pw-browsers`, 4 cores, 15 GB RAM |
| three.js | latest stable is **0.186.1** (published 2026-09-24, four weeks old). Pinned exactly, no `^` |
| Other pins | vite 8.3.5, vite-plugin-singlefile 2.3.4 (its peer range includes vite 8), playwright-core 1.64.1. All exact |
| Headless WebGL2 | Works under SwiftShader (software) with and without the flags in the brief. A trivial draw plus 480x270 readback costs 3 ms |
| Probe scene | Patched Lambert (vertex snap + affine UV), 7 lights, exp2 fog, 60 buildings with 1 m subdivision, 5000 snow points, half-float 480x270 target, quantize/dither pass: **29 ms per frame including readback**. The `onBeforeCompile` patch compiled first try on 0.186.1 |
| Determinism | In that probe, rendering t=3.5, then 9.0, then 1.0, then 3.5 again gave **byte-identical** output for the two t=3.5 frames |
| Lighting in 0.186.1 | `MeshLambertMaterial` lights **per fragment**. There is no per-vertex lighting chunk any more (see 3.1) |
| H.264 round trip | The brief's exact encode settings, on a worst-case dithered dark sequence, sampled one pixel per 4x4 block: mean error **1.3 / 255**, 99th percentile 5, PSNR **42.9 dB** |
| Colour tagging | The brief's ffmpeg line writes an **untagged** file. Browsers and YouTube assume BT.709 for untagged HD, so saturated colours shift. Measured on test patches: aircraft red 200,30,30 came back as 214,45,27, green 30,160,60 as 19,140,56. With `out_color_matrix=bt709` and BT.709 tags both came back within 2 levels |

Two honest caveats. The probe frame was blown out white: three 0.186 uses physical light units and my guessed lamp
value (900 cd) was far too hot. That is a tuning job for Stage 4, not a finding about the look. And the probe had no
car or characters, so the 29 ms is a floor, not an estimate for the finished scene.

---

## 3. Changes I would make, and why

I found these by working the geometry of the brief against its own shot list. The Stage 1 map, drawn from the same
camera data, will prove or kill each one. Where I am unsure I say so.

### 3.1 Encode: tag the video BT.709 (certain)
Use `-vf "vflip,scale=1920:1080:flags=neighbor:out_color_matrix=bt709:out_range=tv"` plus
`-colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv`. Everything else in the brief's encode
line stays. Reason is the measurement above.

### 3.2 Lighting style: per-fragment, with a Stage 4 comparison (decision for you, question 4)
The brief says light pools should read because of the 1 m subdivision. That is how PS1 per-vertex (Gouraud) lighting
behaves, but three 0.186.1 lights Lambert per pixel, so pools will be smooth. I will keep three's own lights and fog
as the brief insists. The look still gets its period feel from 480x270, 5-bit dither, vertex snap and texture swim.
At Stage 4 I will render the lamp shot twice, plain and with the light quantized into bands, so you can choose.
Moving real lighting into the vertex stage is possible on a 1 m grid but is a rewrite of three's lighting chunks, which
the brief says not to do.

### 3.3 Faces and the 180 degree line: stage for a west-side camera (decision for you, question 2)
On the bridge A and B face east, so the line between them runs north to south. The brief wants all glance coverage on
one side of that line. The two sides are the street side (west, behind their backs) and the river side (east, in front
of their faces, which means a camera hanging over the water). Because they face east, a west-side camera mostly sees backs.

My proposal: keep every camera on the **west** side and stage the glances so they still read:

- B stands south (nearer the lamp), A stands north, about 1.3 m apart, closing to 1.0 m at the end.
- Shot 11 is from the south-west end, low and close, looking north-north-east: B's shoulder soft in the foreground,
  A beyond. For the lighter A turns into the lee (wind from the east-north-east, so the lee is west) to shield the
  flame. That turn is motivated by the weather and shows A's face to the camera in three-quarter profile.
- Shot 12 is the reverse from the north-west end, looking south-south-east: B turns north to glance at A, which also
  turns B's face toward the camera.
- Shot 13 is from the south-west along the railing. It reads as a three-quarter **rear** two-shot, not three-quarter
  front: A's face is the readable one, B reads by the turn of the beanie and scarf.
- Faces are featureless anyway, so the glance is carried by head turns, silhouette and which way the light falls.

If you want to see both faces, the alternative is a river-side camera over the railing for 11 to 13. It works in CG
but puts the moon in front of the camera instead of behind the subjects, which weakens the rim light you asked for.

### 3.4 Shot 2: the composition as written cannot be framed (fairly sure)
"Lamp on the right third, corner building at left, bridge entrance and river beyond." The corner building is on the
south-east corner and the lamp is on the east sidewalk, so both are on the same side of the street, 26 m apart in depth.
Looking north from the south end, the building sits at the far right edge and the lamp further in. I could not find a
camera that puts the building left of the lamp and still sees the lamp past it.
**Proposal:** keep the building at the south-east corner (it makes shots 3 and 7 share a screen direction, see 3.6),
and re-block shot 2 as a camera at the south end of the street on the centreline, looking north. West row of buildings
at left, corner building as a dark mass at the right edge, lamp on the right third far up the street, bridge and river
at the vanishing point. Same beat, mirror-image corner. The Stage 1 wedge diagram settles it.

### 3.5 Shot 4 and the lamp: "near the lamp base" and "beside the lamp" fight each other (certain)
If the camera is at the lamp base and the car stops 6 m away, the car is not beside the lamp. And the doors have to
land inside the lamp's pool or shot 6 has nothing to reveal.
**Proposal:** camera at snow level two metres north-west of the lamp base (about x 4.0, z -8.0). The car's front
bumper stops at about z -3.0, so about 5 to 6 m from the camera, with the front doors a few metres south of the lamp.
The lamp is a wide lantern, not a tight cone: a SpotLight with a half-angle near 70 degrees for the real light, plus a
separate narrow additive cone mesh for the visible shaft. If the blockout shows the pool too weak for the two of
them, I move the lamp 1.5 m north before I move the people. (Correction, 2026-10-22: north is away from the car doors; see `review/round-02/notes.md`, Corrections.)

### 3.6 Car route, what hides it, and screen direction (certain on direction, Stage 1 proves the rest)
**Route:** along the cross street from the east, westbound, then a right turn north onto the bridge street. It is the
only route where a south-east corner building screens the car from a camera on the west side.
**Screen direction:** with the camera on the west side looking east, north (toward the bridge) is **screen left**. I will hold
that for every shot that shows travel toward the bridge: the car turn in 3, the walk in 7. Their eyeline in 6 follows it.
**Hiding:** a camera on the west sidewalk south of the intersection sees the building's west face; the car stays hidden
behind it until it is roughly 15 m from the turn. I will size the building and cross street (narrowing the cross street to
about 6 m helps) on the Stage 1 map so the beams reach the facades before the car clears the corner.

### 3.7 Shot 6: a camera in front of the car makes them look into the lens (certain)
"Medium wide from in front of the car" plus "they look toward the bridge, eyeline out of frame": the bridge is north, so a
camera north of the car looking south has them looking at it.
**Proposal:** the camera sits ahead of the car's nose but off to the west, a three-quarter front view. They stand at the
car's curb side in the lamp's light and look north, which is screen left, down and out of frame. Same size, same chest
height, correct eyeline.

### 3.8 Walk budget (certain, tune in the blockout)
They are on screen from 0:29 to 1:08. After the headlights die (about 0:36) and the reveal (to 0:46), the walk to the rail
has about 16 s. A and B travel roughly 10 to 12 m to the lean spot (B from the curb door, A around the car's front).
That is about **0.7 m/s**, a slow, deliberate walk through snow. A normal pace (1.3 m/s) would finish in 8 s and
starve shots 7 and 8. I will walk it at 0.7 m/s with weighted steps and see in the blockout whether it drags.

### 3.9 Shot 5 beat budget (the key lighting beat, 11 s)
The brief says let the headlight cut land. A tight sequence leaves it room:

| Time | Beat |
|---|---|
| 0:29.0 | Car stopped, body settles, idle vibration continues |
| 0:30.5 | Driver's door opens (near side, A) |
| 0:31.8 | A's boot lands in the snow, print left |
| 0:33.2 | B's boots land on the far side, seen in the gap under the car |
| 0:34.5 and 0:35.4 | Two doors close |
| 0:36.2 to 0:36.6 | Headlights and taillights fade out over 0.4 s, idle vibration stops |
| 0:36.6 to 0:40.0 | Lamp light only. 3.4 s of hold, with the snow still falling |

The gap under a sedan is about 0.15 m. At 3 m with a 35mm lens that is about 20 px tall at 480x270, enough to read.
If it does not read in the blockout I fall back to B exiting on the near side.

### 3.10 The moon (certain)
The moon must be below the haze line through shot 9 and only clear it during shot 10, or the anticipation is spent.
Moonlight stays at zero until it clears, then ramps over 8 s. A real moon rises far too slowly to see, so I will let it
rise about 5 degrees across shot 10, which is about a third of the 85mm frame height, then drift up to about 9
degrees by shot 15. That is fast for astronomy and right for a film.

### 3.11 Playback rate in the HTML (decision for you, question 5)
The MP4 is 24 fps. If the HTML renders at the display's refresh rate it will not show the same frames. I propose the
player quantizes time to 1/24 s ticks by default so the HTML and the MP4 show identical frames, with a config switch
for native refresh. 24 is also closer to the period.

### 3.12 Safe strip (certain)
120 px at 1080p is 30 internal pixels at 4x (20 at 6x). Shot 5 puts boots in the snow at the bottom of frame, so those
have to sit above the strip. Every review still will be saved twice: clean, and with thirds lines plus the strip drawn.

### Starting coordinates for Stage 1 (meters, +Y up, north is -Z, east is +X)

| Item | Start value |
|---|---|
| Bridge street | centreline x 0, road x -3.5 to +3.5, curbs 0.15 m, sidewalks to x +/-6.0, building line at x +/-6.2 |
| Cross street | z +15 to +25. If the hiding needs it, narrow it to z +17 to +23 and move the corner building's north face to z +23 |
| Bridge | deck x -6 to +6, starts z -8, ends z -38, deck at y 0, water at y -6 |
| East parapet | at x +6.0, top 1.30 m, 0.45 m thick, chamfered top |
| Lamp | base (5.0, -6.0), head 4.5 m, wide light as in 3.5 |
| Corner building | south-east: x 6.2 to 24, z 25 to 40, about 14 m tall |
| Car | sedan about 4.7 x 1.8 x 1.4 m, east lane x +2.2, front bumper stops at z -3.0 |
| Lean spot | x +5.4. B at z -10.0, A at z -11.3 |
| Moon | bearing 75 degrees (east-north-east), over the river's vanishing point |
| Wind | from the east-north-east, slow, so snow and smoke drift toward the camera side |

---

## 4. Technical approach

### 4.1 Layout and tooling
The layout in the brief, in `_workbench/snowy-bridge/`. Additions: `scripts/verify.js` (frame match and ffprobe checks),
`scripts/storyboard.js`, `scripts/contact-sheet.js`. `package.json` scripts: `dev`, `build`, `export`, `export:4k`,
`stills`, `storyboard`, `verify`. All dependencies pinned exactly. I use `playwright-core` (Playwright's API without the
browser download) and read the browser path from `CHROMIUM_PATH`, falling back to the installed Chromium; on your own
machine the README will give the one-line browser install. Vite 8 needs Node 20.19 or newer, or 22.12 or newer; the README will state that.

**Single source of truth.** `shots.js` holds every camera position, target, lens and time. The Stage 1 map, the Stage 1
panels and the 3D scene all read it, so the storyboard cannot drift from the scene. The panels are true-perspective
wireframe and silhouette projections of simple boxes through each shot's real camera, drawn as SVG. That keeps them in
the "rough sketch" register but means framing problems like 3.4 show up before any 3D exists.

**Storyboard files.** `storyboard/map.excalidraw` is plain Excalidraw JSON built from the same data as the SVG map.
I will round-trip it through Excalidraw's own restore function in a scratch page to check it loads. If I cannot get that
running here I will tell you at the gate, and the file will have been checked against the format only.

### 4.2 The PS1 look
- **Render path.** Scene into a 480x270 half-float `WebGLRenderTarget` (nearest, no MSAA), then my own full-screen pass:
  linear to sRGB, 5 bits per channel, 4x4 Bayer dither, written to a 480x270 canvas. Half float avoids the banding an
  8-bit linear target gives in dark scenes. No EffectComposer. All sizes, safe-strip pixels and snow point sizes derive
  from one `config.res` (`{ w: 480, h: 270 }`; 320x180 gives the 6x option).
- **Materials.** One `ps1(material)` helper around `MeshLambertMaterial` using `onBeforeCompile`. Vertex snap after
  `project_vertex` (blend between unsnapped and snapped pixel position, so "strength" is a 0 to 1 control). Affine warp
  by passing `uv * w` and `w` as varyings and dividing in the fragment. Both effects read shared uniform objects, so
  one config change moves every material. `customProgramCacheKey` set so patched programs never collide with stock.
  Textures are `CanvasTexture`, 64 or 128 px, nearest, no mipmaps, generated from the seeded PRNG.
- **Fog.** `FogExp2`, dark blue-black. City materials opt out of scene fog and carry a weaker haze of their own in the
  same patch, with emissive windows added after the haze so they punch through.
- **Lights.** A fixed set of seven that never changes count: hemisphere (very low), lamp SpotLight, two headlight
  SpotLights, moon DirectionalLight, lighter PointLight, ember PointLight. Beats change intensities, never `visible`.
  Toggling a light recompiles every shader and hitches playback. `renderer.compile` runs once before frame 0.
  Light values live in `config.js` in photometric terms and are tuned in Stage 4.
- **Glow, shadow.** Additive cards and cones with `depthWrite: false` for bulb, headlights, light shaft. Blob shadows
  are dark radial-gradient quads under the car and each character, positioned from the timeline.
- **Snow.** `Points` with a custom shader, 1 to 2 internal pixels. Position is a pure function of a seeded start, fall
  speed times `t`, and layered sine drift, wrapped in a box that follows the camera so every shot has near, middle and
  far flakes. Three depth layers. Brightness in the shader is ambient plus lamp cone plus headlights plus moon, with the
  lamp cone using the real lamp position and angle so flakes light up as they cross it.

### 4.3 Determinism
- One mulberry32 PRNG seeded once at load. A check script fails if `Math.random`, `Date.now` or `performance.now`
  appears in `src/` outside the playback clock in `main.js`.
- Footprints, smoke puffs, flame flicker and ember pulses are functions of seed and `t`. Footprints are decals with a
  birth time computed from the walk cycle's planting phases at load; a decal shows when `t` is past its birth.
- Test: render a list of times in scrambled order twice and require byte-identical readback. This is the real proof
  that the scene is a pure function of `t`, and the probe already passed it.
- **Cross-machine honesty:** on one machine, same `t` gives the same bytes. Across a software renderer and your GPU, float
  differences can flip a dither threshold or move a 1 px flake by a pixel. I will compare MP4 to HTML on the same
  machine, and tell you if your GPU shows a visible difference.

### 4.4 Characters and the car
- **Rig.** Hierarchy of primitives as the brief lists. Poses are keyframed tables on the timeline. A small analytic
  two-bone IK helper (about 60 lines, no library) plants feet, rests forearms on the rail and lifts a hand to the mouth,
  so feet never slide and the footprints land where the feet do. The walk cycle is driven by distance along the path, not
  by time.
- **Car.** Wheel angle from arc length over radius, steering from path curvature, body settle at the stop, idle
  vibration as noise with an amplitude ramp that goes to zero at the shut-off beat. Door hinges are keyed.
  Headlights are two SpotLights plus emissive lenses and soft cards. A boxy three-box sedan from the 1970s to 80s,
  dark green-black, no badge.
- **A and B.** A: 1.80 m, long dark coat, bare head. B: 1.68 m, puffy jacket, beanie, scarf. I will give B's beanie and
  scarf a lighter value than A's coat so both read at phone size when the dark coat sinks into the night.

### 4.5 Cameras
`shots.js` entries carry start and end, lens in mm (vfov = 2 * atan(12 / f)), position and target keyframes, easing,
roll, and an optional sub-1% drift. Hard cuts only, plus the opening fade. Moves ease in and out. Cuts that change angle by
less than 30 degrees or shot size by less than one step get flagged by a script that reads `shots.js`, so jump cuts are
caught by the data, not by my eye.

### 4.6 Capture and export
`npm run export` builds the single-file HTML, then `scripts/capture.js` loads **that same file from `file://`** with
`?capture=1`. That proves it opens from disk, and means the MP4 is made by the exact artifact you receive.
For each frame: `renderAt(i / 24)`, `gl.readPixels` in the same task, drop alpha, send to Node, pipe to ffmpeg.
Output is 1920x1080, 24 fps, H.264 `yuv420p`, `-crf 16 -preset slow -tune animation`, `+faststart`, no audio, BT.709
tagged (3.1). `export:4k` is the same capture scaled 8x to 3840x2160 (12x if you switch to 320x180). Frames can be
sharded over several browser pages because the scene is a pure function of time; I will only do that if the first
real export is slow.

Time estimate: unknown until the blockout exists. The probe was 29 ms a frame in software, so a plausible range for
the finished scene is a few minutes to about ten. I will report the real number at Stage 2.

### 4.7 Verification at Stage 5 (`npm run verify`)
- `ffprobe`: duration 112.0 s plus or minus one frame, 1920x1080, 24/1, H.264, `yuv420p`, BT.709 tags, no audio
  stream, `moov` before `mdat`.
- Frame match: decode MP4 frame N, sample the centre of each 4x4 block, compare with a fresh `renderAt(N / 24)` readback
  from the HTML. Threshold: mean error 2.5 / 255 or less and PSNR 40 dB or more. The measured baseline on the worst-case
  synthetic was 1.3 and 42.9 dB. The raw readback path itself must be bit-exact.
- Scrub bar: click five positions, read the scene time back, compare the frame to `renderAt`. Shot-list buttons jump to
  the first frame of each shot.
- Playback smoothness: measure frame times over a 10 s run. Here that is software rendering, so I can show pacing but not
  how it feels on your GPU. You are the judge of that at Gate 5.

### 4.8 How I review my own work
I can open the rendered PNGs myself, so each self-review round means I render, look at every image, write the specific
problems down in `notes.md` before fixing anything, then fix. Checks each round: framing against the storyboard, the
safe strip, a 384x216 copy for phone size, screen direction, eyelines, how the light reads, whether snow shows in
foreground, middle and background. At most three rounds per stage.

### 4.9 Repo hygiene
Source, storyboard, review stills, contact sheets, notes and the single-file HTML are committed. `node_modules`, `dist`
and raw frame dumps are not. MP4s: preview files are small and committed; a full 1080p export may run past 50 MB, so
anything over about 25 MB stays on disk in `out/` and I say so at the gate. Work goes to the branch above only.

---

## 5. Risks

| Risk | Why it matters | What I do about it |
|---|---|---|
| No real GPU here | Software rendering is slower and cannot show how playback feels | Report per-frame time at Stage 2; keep draw calls low with instanced snow and footprints; you judge feel at Gate 5 |
| Dark scene at 5 bits | The night has only a handful of levels; banding and dither crawl; YouTube's re-encode smears dark gradients | Design colours in 5-bit steps; use the 4K export (the brief's own point); keep exposure and fog colour in `config.js` |
| Tiny characters at phone size | 384x216 is smaller than the internal frame, so detail is lost | Rim light on both people, lighter beanie and scarf for B, silhouette-first design, 384x216 check every round |
| Cigarette beats at low resolution | Lighter flame and ember are a few pixels | Shots 11 and 14 are close, 50mm and 85mm. Ember will be at least 3x3 internal pixels, lit with a small additive card |
| Stiff motion reads as comedy | PS1 plus people plus a cigarette can slide into parody | Small, slow motions; weight in the walk; hold on light and silhouette; no exaggerated arm swing |
| Vertex snap crawl on slow dollies | Shots 2 and 15 move slowly, so edges will step by a pixel | Snap strength is a control; I will show it at 1.0 and 0.5 in the Stage 4 stills |
| Shader recompile hitches | Changing light count or toggling materials stalls | Constant light count, `renderer.compile` before frame 0 |
| Single-file HTML from disk | Module loading and CORS differ on `file://` | Capture itself runs from `file://`, so it fails loudly in the build; no workers, no external fetches |
| Layout contradictions in the brief | 3.4 to 3.7 would have shown up as bad framing in Stage 2 | The map and panels are generated from shot data, so they are caught at Stage 1 |
| Excalidraw cannot be opened here | I cannot confirm in a browser you use | Round-trip through Excalidraw's restore function; say so if I cannot |
| Cross-machine pixel differences | See 4.3 | Compare on one machine; tolerance defined in 4.7 |
| MP4 size | A long dithered 1080p clip can be large | Measured synthetic worst case is about 22 KB a frame, so roughly 60 MB for the full length. Real dark footage should be smaller; I will report the real size |

---

## 6. Questions for you

Each has my default. If you answer "go" with no changes, I take the defaults.

1. **Home.** Is `_workbench/snowy-bridge/` the right place? Nothing else in your repos fits a standalone film.
   *Default: yes.*
2. **Faces on the bridge.** Stage everything from the west (street) side, so shots 11 to 13 show profiles and rear
   three-quarters, with A turning into the wind for the lighter (3.3)? Or do you want a river-side camera over the rail so
   both faces show? This changes the 180 degree line, so I want it settled before the map. *Default: west only.*
3. **Shot 2 composition.** Corner building at the right edge, lamp right third beyond it (3.4), or do you want the corner
   building mirrored to the south-west so shot 2 reads as written? Mirroring breaks the shared screen direction in 3 and 7.
   *Default: keep the south-east corner, re-block shot 2.*
4. **Lighting style.** Smooth per-fragment lighting from three as it stands, with a banded comparison at Stage 4 (3.2)?
   *Default: yes.*
5. **HTML playback rate.** Quantize to 24 fps ticks so the HTML and MP4 show the same frames (3.11)?
   *Default: yes, with a config switch.*

Not questions, but things I will pick unless you object: the car (boxy 1970s to 80s sedan, dark green-black, no badge),
A and B stay unnamed and ungendered in all notes, the walk pace in 3.8, and the lamp position as a loose "about z -6".

---

## 7. What each gate gives you

| Gate | You get | Stops me from |
|---|---|---|
| 1 Storyboard | `storyboard/index.html` contact sheet, `map.excalidraw`, SVG map and 15 panels, all from one data file | Any 3D work |
| 2 Blockout | `review/round-01/` first, middle, last still per shot, contact sheet, 480x270 preview MP4, measured capture time | Textures and PS1 shaders |
| 3 Revisions | Updated `shots.js`, map and panels, new contact sheet and preview | Look development |
| 4 Look | Eight key stills at 1920x1080 and 384x216 side by side, plus the banded-light comparison | Animation polish |
| 5 Animation | Full MP4 and HTML, `npm run verify` output, notes on pops, slides, clipping, phone-size problems | Final export |
| 6 Polish | Fresh MP4, contact sheet and notes each round | Final export |
| 7 Final | `out/` with MP4, HTML, one still per shot, three 1280x720 thumbnails with space for a title and no text, `README.md` | |

Thumbnails: every video gets one, so they are part of Stage 7. They follow your thumbnail rule and are checked at
320 px wide.

**Next action:** stop here. Reply with answers to the five questions or "go", and I start Stage 1.

---

## 8. Changes since Stage 0 (found while drawing Stage 1)

| Item | Stage 0 | Now |
|---|---|---|
| Car front bumper stop | z -3.0 | z -0.5 (car centre z 1.85), so the walk to the rail is about 0.6 m/s and not 0.45 |
| Lean spot | x +5.4 | x +5.25 (B z -10.0, A z -11.3) |
| Moon bearing | 75 degrees | 84 degrees, where the river's banks converge, so it can rise between the city banks |
| Lamp pool | "wide lantern" | a visible warm pool of radius about 7 m is now a requirement for Stage 4, because the car stop and the lean spot are about 11 m apart |
| Shot 2 camera | south end of the street | z 62, outside the south buildings |
| Shot 9 | north-west arc | south-west arc, 232 to 217 degrees, so the river and city are beyond them |
| Shots 10, 13, 14, 15 | see 3.3 | new camera positions, all still on the west side of the line; in `src/shots.js` |
| People on the walk | single file | a loose diagonal, A ahead and west of B |
| Tooling | | `npm run storyboard` writes the map, Excalidraw file, 15 panels and contact sheet; `npm run storyboard:review` also writes PNGs to `review/round-01/` |
