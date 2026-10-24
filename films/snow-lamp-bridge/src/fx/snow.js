// The snow: one Points cloud. Every flake's position is a pure function of its seeded attributes and t, computed in
// the vertex shader, then wrapped into a box centred on the camera so every shot has near, middle and far flakes.
// Brightness comes from the lights that matter: the lamp (strongest in its cone below the lantern), the two headlight
// beams while they burn, and the moon once it clears the haze. Flakes within NEAR meters draw one pixel larger, so the
// near layer reads in front of the middle and far ones.
import { LAMP, WIND } from '../set.js';
import { carAt, headlights, moonlight } from '../world.js';

const D2R = Math.PI / 180;

// The placeholder's look, in one place.
const LOOK = {
  bigShare: 0.35, // share of flakes drawn at the larger size, so small far-looking flakes dominate
  drift: 0.6, // lateral sway amplitude, meters
  driftRate: [0.61, 0.47], // sway on x and z, radians per second (periods of about 10 and 13 s)
  windSpeed: 0.35, // m/s, blowing toward the west-south-west
  edge: 0.85, // flakes fade over the outer 15 percent of the box, so the wrap never pops a flake in or out
  base: 0.12, // brightness of a flake no light reaches
  baseColor: '#c4cede',
  lampGain: 1.4,
  moonGain: 0.45,
  lampCone: [45, 25], // degrees from straight down: full boost inside 25, the base share (0.3) outside 45
  headGain: 1.3,
  headCone: [22, 12], // degrees off the beam: full inside 12, nothing outside 22 (the headlight spot's half angle)
  headReach: 25, // meters along a beam at which it stops lighting flakes
  nearSize: 4, // meters: flakes nearer than this draw one pixel larger
};
// where the headlights sit on the car and where they aim, as fx/lights.js places them
const HEADLIGHT = { forward: 2.4, side: 0.65, y: 0.7, aimAhead: 15 };

const VERT = /* glsl */ `
uniform float uTime;
uniform vec3 uCam;
uniform float uMoon;
uniform vec3 uBox;
uniform vec2 uWind;
uniform float uDrift;
uniform vec2 uDriftRate;
uniform float uEdge;
uniform vec3 uLamp;
uniform float uLampReach;
uniform float uLampGain;
uniform float uMoonGain;
uniform float uBase;
uniform vec3 uBaseColor;
uniform vec3 uLampColor;
uniform vec3 uMoonColor;
uniform float uFogDensity;
uniform vec2 uLampCone;
uniform vec3 uHead0;
uniform vec3 uHead1;
uniform vec3 uHeadDir;
uniform float uHeadOn;
uniform vec2 uHeadCos;
uniform float uHeadReach;
uniform float uHeadGain;
uniform vec3 uHeadColor;
uniform float uNearSize;

attribute float aSpeed;
attribute float aPhase;
attribute float aSize;

varying vec3 vColor;
varying float vAlpha;
varying float vFog;

// how strongly the beam from lens o lights point p: inside its cone, fading with distance
float beam(vec3 p, vec3 o) {
  vec3 d = p - o;
  float r = length(d);
  float c = smoothstep(uHeadCos.x, uHeadCos.y, dot(d, uHeadDir) / max(r, 1e-4));
  float f = 1.0 - clamp(r / uHeadReach, 0.0, 1.0);
  return c * f * f;
}

void main() {
  // position is the flake's seeded start in a unit cube; the rest is a function of uTime alone
  vec3 p = position * uBox;
  p.y -= aSpeed * uTime;
  p.x += uDrift * sin(uTime * uDriftRate.x + aPhase);
  p.z += uDrift * sin(uTime * uDriftRate.y + aPhase * 1.7);
  p.xz += uWind * uTime;

  // wrap into the box around the camera, in world space (the Points object stays at the origin)
  vec3 lo = uCam - 0.5 * uBox;
  p = lo + mod(p - lo, uBox);
  vec3 q = abs(p - uCam) / (0.5 * uBox);
  vAlpha = 1.0 - smoothstep(uEdge, 1.0, max(q.x, max(q.y, q.z)));

  vec3 dl = p - uLamp;
  float dlen = length(dl);
  float lamp = 1.0 - clamp(dlen / uLampReach, 0.0, 1.0);
  float lampCone = 0.3 + 0.7 * smoothstep(uLampCone.x, uLampCone.y, -dl.y / max(dlen, 1e-4));
  float head = uHeadOn * (beam(p, uHead0) + beam(p, uHead1));
  vColor = uBaseColor * uBase + uLampColor * (uLampGain * lamp * lamp * lampCone) + uMoonColor * (uMoonGain * uMoon) + uHeadColor * (uHeadGain * head);

  vec4 mv = viewMatrix * vec4(p, 1.0);
  float depth = -mv.z;
  vFog = 1.0 - exp(-uFogDensity * uFogDensity * depth * depth);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = max(aSize, 1.0) + step(depth, uNearSize);
}
`;

const FRAG = /* glsl */ `
uniform vec3 uFogColor;

varying vec3 vColor;
varying float vAlpha;
varying float vFog;

void main() {
  gl_FragColor = vec4(vColor, vAlpha);
  #include <colorspace_fragment>
  // fog after the output transform, the way three.js applies FogExp2 to its own materials
  gl_FragColor.rgb = mix(gl_FragColor.rgb, linearToOutputTexel(vec4(uFogColor, 1.0)).rgb, vFog);
}
`;

// Every material the snow uses, in one place, so Stage 4 can swap it.
function makeMaterials(THREE, config) {
  const to = (WIND.fromDeg + 180) * D2R; // the wind blows toward the opposite bearing
  return {
    flake: new THREE.ShaderMaterial({
      name: 'snow-flake',
      uniforms: {
        uTime: { value: 0 },
        uCam: { value: new THREE.Vector3() },
        uMoon: { value: 0 },
        uBox: { value: new THREE.Vector3(...config.snow.box) },
        uWind: { value: new THREE.Vector2(Math.sin(to), -Math.cos(to)).multiplyScalar(LOOK.windSpeed) },
        uDrift: { value: LOOK.drift },
        uDriftRate: { value: new THREE.Vector2(...LOOK.driftRate) },
        uEdge: { value: LOOK.edge },
        uLamp: { value: new THREE.Vector3(...LAMP.head) },
        uLampReach: { value: LAMP.poolRadius }, // the warm boost reaches zero at the edge of the lamp's pool
        uLampGain: { value: LOOK.lampGain },
        uMoonGain: { value: LOOK.moonGain },
        uBase: { value: LOOK.base },
        uBaseColor: { value: new THREE.Color(LOOK.baseColor) },
        uLampColor: { value: new THREE.Color(config.lights.lamp.color) },
        uMoonColor: { value: new THREE.Color(config.lights.moon.color) },
        uFogColor: { value: new THREE.Color(config.fog.color) },
        uFogDensity: { value: config.fog.density },
        uLampCone: { value: new THREE.Vector2(Math.cos(LOOK.lampCone[0] * D2R), Math.cos(LOOK.lampCone[1] * D2R)) },
        uHead0: { value: new THREE.Vector3() },
        uHead1: { value: new THREE.Vector3() },
        uHeadDir: { value: new THREE.Vector3(0, 0, -1) },
        uHeadOn: { value: 0 },
        uHeadCos: { value: new THREE.Vector2(Math.cos(LOOK.headCone[0] * D2R), Math.cos(LOOK.headCone[1] * D2R)) },
        uHeadReach: { value: LOOK.headReach },
        uHeadGain: { value: LOOK.headGain },
        uHeadColor: { value: new THREE.Color(config.lights.headlight.color) },
        uNearSize: { value: LOOK.nearSize },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      fog: false, // fog is done by hand above, with the scene's own density and colour
    }),
  };
}

export function buildSnow(ctx) {
  const { THREE, scene, config, rngFor } = ctx;
  const S = config.snow;
  const n = S.count;

  // Per-flake attributes, drawn in a fixed order from the snow's own seeded stream.
  const rng = rngFor('snow');
  const base = new Float32Array(n * 3);
  const speed = new Float32Array(n);
  const phase = new Float32Array(n);
  const size = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    base[i * 3] = rng();
    base[i * 3 + 1] = rng();
    base[i * 3 + 2] = rng();
    speed[i] = S.fallMin + (S.fallMax - S.fallMin) * rng();
    phase[i] = rng() * Math.PI * 2;
    size[i] = rng() < LOOK.bigShare ? S.sizePx[1] : S.sizePx[0];
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(base, 3));
  geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speed, 1));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(size, 1));

  const mats = makeMaterials(THREE, config);
  const points = new THREE.Points(geometry, mats.flake);
  points.name = 'snow';
  points.frustumCulled = false; // the shader moves every flake, so the geometry's bounds mean nothing
  // Transparent objects sort by renderOrder before distance, and the snow writes no depth. 2 draws it after the shadow
  // discs (car -1, people 1) and the lantern's panes and bulb (0, 1), so none of them paints over a flake in front of it.
  // The cost is that a flake behind the panes shows through them. Smoke cards will need a place in this order too.
  points.renderOrder = 2;
  scene.add(points);

  const u = mats.flake.uniforms;
  return {
    update(t, camera) {
      u.uTime.value = t;
      u.uMoon.value = moonlight(t);
      // the headlights, placed as fx/lights.js places the spots
      const c = carAt(t), h = c.heading * D2R, fx = Math.sin(h), fz = -Math.cos(h), rx = Math.cos(h), rz = Math.sin(h);
      u.uHeadOn.value = c.present ? headlights(t) : 0;
      [u.uHead0, u.uHead1].forEach((uh, i) => {
        const side = i ? 1 : -1;
        uh.value.set(c.x + fx * HEADLIGHT.forward + rx * side * HEADLIGHT.side, HEADLIGHT.y, c.z + fz * HEADLIGHT.forward + rz * side * HEADLIGHT.side);
      });
      u.uHeadDir.value.set(fx * HEADLIGHT.aimAhead, -HEADLIGHT.y, fz * HEADLIGHT.aimAhead).normalize();
      if (camera) camera.getWorldPosition(u.uCam.value);
      else u.uCam.value.set(0, 0, 0);
    },
  };
}
