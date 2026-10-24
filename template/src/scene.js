// The scene: everything the camera sees, built once, then posed from t on every frame. main.js calls buildScene(ctx)
// and gets back a list of parts, each { update(t, camera) }. This is the file a new film replaces (or splits into
// src/set/, src/actors/, src/fx/ the way films/snow-lamp-bridge does). Contract: src/CONTRACT.md
//
// The template's example: snowy ground, a low concrete wall, a street lamp with a spot light and a glow card, and
// falling snow. Every position is a pure function of t; the only randomness is seeded (rngFor).
import { GROUND, WALL, LAMP } from './set.js';
import { lampFlicker } from './world.js';
import { makeTextures, worldUV, TILE } from './textures.js';

// a soft round falloff, white, the strength in alpha
function glowBytes(n) {
  const d = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const r = Math.hypot((x + 0.5) / n * 2 - 1, (y + 0.5) / n * 2 - 1);
      const i = (y * n + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = 255;
      d[i + 3] = Math.round(255 * (r >= 1 ? 0 : (1 - r) ** 2));
    }
  }
  return d;
}

export function buildScene(ctx) {
  const { THREE, scene, config, rngFor } = ctx;
  const tex = config.stage === 'look' ? makeTextures(THREE, rngFor) : null;
  const lambert = (color, map) => new THREE.MeshLambertMaterial({ color, map: (tex && map && tex[map]) || null });
  const M = {
    snow: lambert('#c4cad4', 'snow'),
    concrete: lambert('#8f959e', 'concrete'),
    metal: lambert('#2a2d33'),
    lantern: new THREE.MeshBasicMaterial({ color: '#d98a4a' }),
    bulb: new THREE.MeshBasicMaterial({ color: config.lights.lamp.color }),
  };
  const root = new THREE.Group();
  root.name = 'set';
  const add = (geo, mat, name, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.name = name; root.add(m); return m; };

  // ground and wall
  const ground = add(new THREE.PlaneGeometry(GROUND.size, GROUND.size, GROUND.segments, GROUND.segments), M.snow, 'ground', 0, 0, 0);
  ground.rotation.x = -Math.PI / 2;
  add(new THREE.BoxGeometry(WALL.x1 - WALL.x0, WALL.height, WALL.thick), M.concrete, 'wall', (WALL.x0 + WALL.x1) / 2, WALL.height / 2, WALL.z);

  // the lamp: a six-sided post, an arm, a lantern box and a bulb
  const [bx, bz] = LAMP.base, [hx, hy, hz] = LAMP.head;
  add(new THREE.CylinderGeometry(0.06, 0.08, LAMP.height, 6), M.metal, 'lamp-post', bx, LAMP.height / 2, bz);
  const arm = add(new THREE.BoxGeometry(Math.abs(bx - hx) + 0.1, 0.05, 0.05), M.metal, 'lamp-arm', (bx + hx) / 2, hy + 0.25, bz);
  add(new THREE.BoxGeometry(0.3, 0.32, 0.3), M.lantern, 'lamp-lantern', hx, hy + 0.05, hz);
  add(new THREE.SphereGeometry(0.08, 6, 4), M.bulb, 'lamp-bulb', hx, hy - 0.05, hz);

  // world-space texture coordinates, so every surface gets the same texel size in meters
  root.updateMatrixWorld(true);
  root.traverse((o) => { if (o.isMesh && o.material.map && TILE[o.material.map.name]) worldUV(THREE, o, TILE[o.material.map.name]); });
  scene.add(root);

  // lights: a dim sky, and the lamp's spot pointing straight down. Lights are made here, once (never add or remove later)
  const L = config.lights;
  const hemi = new THREE.HemisphereLight(L.hemi.sky, L.hemi.ground, L.hemi.intensity);
  hemi.name = 'light-hemi';
  const lamp = new THREE.SpotLight(L.lamp.color, L.lamp.intensity, L.lamp.distance, L.lamp.angleDeg * Math.PI / 180, L.lamp.penumbra, L.lamp.decay);
  lamp.name = 'light-lamp';
  lamp.position.set(hx, hy, hz);
  lamp.target.position.set(hx, 0, hz);
  scene.add(hemi, lamp, lamp.target);

  // the glow card on the bulb: additive, depth tested, so whatever stands in front hides it
  const glowTex = new THREE.DataTexture(glowBytes(32), 32, 32, THREE.RGBAFormat, THREE.UnsignedByteType);
  glowTex.magFilter = glowTex.minFilter = THREE.LinearFilter;
  glowTex.needsUpdate = true;
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: L.lamp.color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false }));
  glow.name = 'glow-bulb';
  glow.position.set(hx, hy - 0.05, hz);
  glow.scale.setScalar(config.glow.size);
  scene.add(glow);

  // snow: each flake has a seeded start and falls at its own speed, wrapping in a box around the lamp
  const S = config.snow, rng = rngFor('snow');
  const flakes = Array.from({ length: S.count }, () => ({
    x: (rng() - 0.5) * S.box[0], y: rng() * S.box[1], z: (rng() - 0.5) * S.box[2],
    fall: S.fall[0] + rng() * (S.fall[1] - S.fall[0]), phase: rng() * Math.PI * 2,
  }));
  const pos = new Float32Array(S.count * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(hx, S.box[1] / 2, hz), Math.hypot(...S.box));
  const snow = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#dfe6f2', size: S.sizePx, sizeAttenuation: false }));
  snow.name = 'snow';
  scene.add(snow);

  return [{
    update(t) {
      lamp.intensity = L.lamp.intensity * lampFlicker(t);
      glow.material.opacity = config.glow.opacity * lampFlicker(t);
      for (let i = 0; i < flakes.length; i++) {
        const f = flakes[i];
        const y = (((f.y - f.fall * t) % S.box[1]) + S.box[1]) % S.box[1];
        pos[3 * i] = hx + f.x + 0.25 * Math.sin(t * 0.7 + f.phase);
        pos[3 * i + 1] = y;
        pos[3 * i + 2] = hz + f.z + 0.25 * Math.cos(t * 0.5 + f.phase);
      }
      geo.attributes.position.needsUpdate = true;
    },
  }];
}
