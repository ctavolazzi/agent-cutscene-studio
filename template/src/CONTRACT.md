# The scene contract

Every module in `src/` follows these rules. They are what make the scene a pure function of time, so the MP4 and
the HTML show the same frames, and so several parts can be written in parallel without touching each other.

## Data comes from three files, never from anywhere else

| File | Gives you |
|---|---|
| `src/set.js` | the layout, in meters. +Y up, north is -Z, east is +X. |
| `src/world.js` | `T_TOTAL`, `FPS`, `fadeIn(t)`, every timing as a pure function of time, and `landmarksAt(t)` (named world points the camera check compares). |
| `src/shots.js` | `SHOTS`, `cameraAt(shot, t)`, `shotAt(t)`, `vfovDeg(lens)`, `solveTarget(...)`: the cameras. |

`src/scene.js` builds the parts from these; `src/config.js` holds every tunable value.

Compass headings are degrees: 0 north (-Z), 90 east (+X), 180 south (+Z), 270 west (-X).
A heading `h` as a direction is `[Math.sin(h), 0, -Math.cos(h)]` (radians). The right-hand side of that heading is
`[Math.cos(h), 0, Math.sin(h)]`.

## A scene part

```js
// src/<area>/<name>.js
export function buildThing(ctx) {
  const { THREE, scene, config, rngFor } = ctx;
  // build meshes once, add them to `scene`
  return {
    update(t, camera) {
      // set transforms, visibility, intensities and uniforms from t (and the camera) only
    },
  };
}
```

- `build` runs once at load. It may use `rngFor('<name>')` for seeded randomness. `rngFor` returns a fresh mulberry32
  PRNG seeded from the project seed and the name, so parts do not affect each other.
- `update(t, camera)` must give the same result for the same `t` no matter what order times are called in.
  **No state carried between calls** (no "previous t", no accumulating velocities). Compute everything from `t`.
- **Forbidden in `src/`:** `Math.random`, `Date.now`, `performance.now`, `new Date()`, timers. The only clock is the
  playback loop in `main.js`.
- **Never add or remove lights after load** and never toggle `light.visible`: a changed light count recompiles every
  shader and stalls. Set `intensity = 0` instead.
- Materials: `MeshLambertMaterial` (or `MeshBasicMaterial` for emissive cards). The PS1 patch (`src/ps1/material.js`)
  applies to these two in the look stage; shader materials need their own snap. Keep materials created in one place
  per module.
- No textures loaded from files. No external assets.
- No em or en dashes anywhere, comments included.

## A sound layer

```js
// src/audio/layers/<name>.js, listed in LAYERS in src/audio/index.js, with its own block in config.audio
export function build(ctx) {
  const { sr, total, config, rngFor, spatializer } = ctx;
  // make voices, filters and schedules once
  return {
    name: '<name>', bus: 'amb', reverb: 0.2, // bus 'amb', 'fx' or 'music'; reverb send 0 to 1
    process(L, R, i0, n) {
      // ADD n samples, starting at sample i0 (time i0 / sr), into L and R
    },
  };
}
```

- The soundtrack is rendered once, front to back, in blocks: `process` is called for every block in order, so a
  layer **may** keep state (filters, phases, envelopes), unlike a scene part. It is still deterministic: the same
  config and seed give the same samples on every run.
- Timing comes from the same functions the picture reads (`src/world.js`, the rigs, the prints), never from copied
  numbers, so the sound follows any change to the animation.
- `spatializer(place, law)` hears a mono voice from the shot's camera: `place(t)` returns a world point or null.
  `src/audio/events.js` schedules one-shots. Seeded randomness only: `rngFor('audio:<layer>:<what>')`.
- The player's AudioContext clock belongs to the playback block of `main.js`, like every other clock.

## The window API (for scripts in `scripts/`)

| Name | Does |
|---|---|
| `window.__ready` | `true` once the scene is built and compiled |
| `window.__info` | `{ fps, total, res: {w,h}, out: {w,h}, shots: [{n, start, end, title, lens}] }` |
| `window.renderAt(t)` | draws the frame for time `t`, returns `{ t, shot, title, lens }` |
| `window.__frameRGB(t)` | draws the frame and returns `{ info, b64 }`: base64 of the internal frame as RGB bytes, **bottom row first** (WebGL order; flip it with ffmpeg `vflip`) |
| `window.__project([x,y,z], t)` | applies the camera for time `t` and returns `[sx, sy]`, the point's position as a fraction of the frame (0,0 top left), or `null` behind the camera |

In playback (not capture) mode, `window.__sound` holds the player's soundtrack state: `{ state: 'rendering' | 'ready' |
'failed', progress, on, sr, left, right, stats, src, o0 }` (the tests read it).

URL parameters: `?capture=1` (nothing animates on its own, no sound; only the API draws), `?overlay=0` (no shot overlay),
`?t=<seconds>` (playback starts there).
