// The seven lights of the film, built once at load. Beats change intensities, never the count and never `visible`:
// a changed light count recompiles every shader. Placement and timing come from set.js and world.js only.
// three.js 0.186 uses physical units: spot and point intensities are candela, directional is lux (see config.lights).
import { LAMP, MOON } from '../set.js';
import { carAt, headlights, moonAt, moonlight, lighterOn, lighterFlicker, emberLevel } from '../world.js';
import { makePoser, bodyToWorld } from '../actors/people.js';

const D2R = Math.PI / 180;

// Headlights in car-local meters: forward along the heading, side to the right. They sit just ahead of the lenses
// actors/car.js draws (front face 2.35, lens 0.04 deep, centre 0.7 up, 0.65 out). Each beam is aimed at the road
// surface this far ahead, which tips it down by about 3 degrees.
const HEADLIGHT = { forward: 2.4, side: 0.65, y: 0.7, aimAhead: 15, aimY: 0 };
// Never below 5 degrees, so the moon never lights the set from under the ground. Aimed at the bridge's south end,
// near where the two stand at the parapet; the light is directional, so the aim only sets the direction's origin.
const MOON_LIGHT = { minElevationDeg: 5, aim: [0, 0, -10], distance: 100 };
// The flame's flicker and the ember's drags are world.js timing (lighterFlicker, emberLevel), shared with fx/smoke.js.

export function buildLights(ctx) {
  const { THREE, scene, config } = ctx;
  const L = config.lights;

  const add = (light, name) => {
    light.name = name;
    scene.add(light);
    return light;
  };
  // Spot and directional lights aim at their target's world matrix, so the target lives in the scene graph.
  const aimed = (light, name) => {
    add(light, name);
    light.target.name = `${name}-target`;
    scene.add(light.target);
    return light;
  };
  // Matrices are updated as soon as a light moves, so anything that reads them before the next render (the capture
  // scripts, the tests) sees the pose for this t and not the last one drawn.
  const place = (light, p, aim) => {
    light.position.set(p[0], p[1], p[2]);
    light.updateMatrixWorld();
    if (aim) {
      light.target.position.set(aim[0], aim[1], aim[2]);
      light.target.updateMatrixWorld();
    }
  };
  const spot = (c, intensity) => new THREE.SpotLight(c.color, intensity, c.distance, c.angleDeg * D2R, c.penumbra, c.decay);

  add(new THREE.HemisphereLight(L.hemi.sky, L.hemi.ground, L.hemi.intensity), 'light-hemi');

  // The flame and the ember sit where actors/people.js puts A's cupped hands and cigarette tip: one rig, one answer.
  const poseA = makePoser('A');

  const lamp = aimed(spot(L.lamp, L.lamp.intensity), 'light-lamp');
  place(lamp, LAMP.head, [LAMP.head[0], 0, LAMP.head[2]]); // straight down; never moves

  // left is the driver side, -X in the car's own frame, matching the lens names in actors/car.js
  const heads = [['left', -1], ['right', 1]].map(([tag, side]) => ({ side, light: aimed(spot(L.headlight, 0), `light-headlight-${tag}`) }));

  const moon = aimed(new THREE.DirectionalLight(L.moon.color, 0), 'light-moon');
  const lighter = add(new THREE.PointLight(L.lighter.color, 0, L.lighter.distance, L.lighter.decay), 'light-lighter');
  const ember = add(new THREE.PointLight(L.ember.color, 0, L.ember.distance, L.ember.decay), 'light-ember');

  return {
    update(t) {
      const c = carAt(t);
      const h = c.heading * D2R;
      const fx = Math.sin(h), fz = -Math.cos(h); // forward
      const rx = Math.cos(h), rz = Math.sin(h); // right
      const beam = c.present ? L.headlight.intensity * headlights(t) : 0;
      for (const { side, light } of heads) {
        const x = c.x + fx * HEADLIGHT.forward + rx * side * HEADLIGHT.side;
        const z = c.z + fz * HEADLIGHT.forward + rz * side * HEADLIGHT.side;
        place(light, [x, HEADLIGHT.y, z], [x + fx * HEADLIGHT.aimAhead, HEADLIGHT.aimY, z + fz * HEADLIGHT.aimAhead]);
        light.intensity = beam;
      }

      const el = Math.max(moonAt(t).elevationDeg, MOON_LIGHT.minElevationDeg) * D2R;
      const az = MOON.azimuthDeg * D2R;
      const dir = [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)];
      const m = MOON_LIGHT.aim, d = MOON_LIGHT.distance;
      place(moon, [m[0] + dir[0] * d, m[1] + dir[1] * d, m[2] + dir[2] * d], m);
      moon.intensity = L.moon.intensity * moonlight(t);

      const a = poseA(t);
      place(lighter, bodyToWorld(a, a.cup));
      lighter.intensity = lighterOn(t) ? L.lighter.intensity * lighterFlicker(t) : 0;

      place(ember, bodyToWorld(a, a.tip));
      ember.intensity = L.ember.intensity * emberLevel(t);
    },
  };
}
