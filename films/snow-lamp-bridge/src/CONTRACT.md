# The scene contract

Every module in `src/` follows these rules. They are what make the scene a pure function of time, so the MP4 and
the HTML show the same frames, and so several parts can be written in parallel without touching each other.

## Data comes from three files, never from anywhere else

| File | Gives you |
|---|---|
| `src/set.js` | `STREET`, `CROSS`, `BRIDGE`, `LAMP`, `RAIL`, `MOON`, `WIND`, `BUILDINGS`, `CITY`: the layout, in meters. +Y up, north is -Z, east is +X. |
| `src/world.js` | `carAt(t)`, `headlights(t)`, `peopleAt(t)`, `PEOPLE`, `moonAt(t)`, `moonlight(t)`, `fadeIn(t)`, `LIGHTER`, `lighterOn(t)`, `emberOn(t)`, `EXHALE`, `smokePuffs(t, origin)`, `CAR`, `carTimes`, `T_TOTAL`, `FPS`. Pure functions of time. |
| `src/shots.js` | `SHOTS`, `cameraAt(shot, t)`, `shotAt(t)`, `vfovDeg(lens)`. The 15 cameras. |

Compass headings in `world.js` are degrees: 0 north (-Z), 90 east (+X), 180 south (+Z), 270 west (-X).
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
- Materials in the blockout: `MeshLambertMaterial` (or `MeshBasicMaterial` for emissive cards), flat greys chosen so
  shapes read against each other. The PS1 patch replaces these in Stage 4, so keep materials created in one place per
  module.
- No textures loaded from files. No external assets.
- No em or en dashes anywhere, comments included.

## The window API (for scripts in `scripts/`)

| Name | Does |
|---|---|
| `window.__ready` | `true` once the scene is built and compiled |
| `window.__info` | `{ fps, total, res: {w,h}, out: {w,h}, shots: [{n, start, end, title, lens}] }` |
| `window.renderAt(t)` | draws the frame for time `t`, returns `{ t, shot, title, lens }` |
| `window.__frameRGB(t)` | draws the frame and returns `{ info, b64 }`: base64 of the internal frame as RGB bytes, **bottom row first** (WebGL order; flip it with ffmpeg `vflip`) |
| `window.__project([x,y,z], t)` | applies the camera for time `t` and returns `[sx, sy]`, the point's position as a fraction of the frame (0,0 top left), or `null` behind the camera |

URL parameters: `?capture=1` (nothing animates on its own; only the API draws), `?overlay=0` (no shot overlay),
`?t=<seconds>` (playback starts there).
