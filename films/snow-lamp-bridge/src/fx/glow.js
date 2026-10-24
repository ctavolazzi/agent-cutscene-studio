// Glow and beams (look stage): additive cards on the bulb, the headlights and the taillights, a faint visible cone
// under the lamp and one ahead of each headlight. They add no light to the scene (lights.js owns the seven lights);
// they make the light sources read as bright. Depth-tested, so whatever stands in front of a source hides its glow.
// Everything is a pure function of t. Contract: src/CONTRACT.md
import { LAMP } from '../set.js';
import { CAR, carAt, headlights } from '../world.js';

const D2R = Math.PI / 180;
// lens centres in the car's own frame (right, up, back), matching actors/car.js; a card sits just ahead of its lens
const LENS = { head: { side: 0.65, y: 0.7, out: CAR.length / 2 + 0.08 }, tail: { side: 0.65, y: 0.72, out: CAR.length / 2 + 0.08 } };
// how far below the lantern the bulb hangs (set/build.js DIMS.bulb lift is from the plate; this is the glow's centre)
const BULB_DROP = 0.05;

// a soft round falloff, white, the strength in alpha: (1 - r)^2, eased at the rim
function glowBytes(n) {
  const d = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const r = Math.hypot((x + 0.5) / n * 2 - 1, (y + 0.5) / n * 2 - 1);
      const a = r >= 1 ? 0 : (1 - r) ** 2;
      const i = (y * n + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = 255;
      d[i + 3] = Math.round(a * 255);
    }
  }
  return d;
}

// an open cone with its apex at the origin pointing down -Y, brightest at the apex and fading to nothing at the base
function coneGeometry(THREE, radius, length, segments = 24) {
  const g = new THREE.ConeGeometry(radius, length, segments, 4, true);
  g.translate(0, -length / 2, 0); // apex at the origin
  const pos = g.attributes.position, col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const k = (1 + pos.getY(i) / length) ** 3; // 1 at the apex, 0 at the base
    col[3 * i] = col[3 * i + 1] = col[3 * i + 2] = k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

export function buildGlow(ctx) {
  const { THREE, scene, config } = ctx;
  const G = config.glow;
  const root = new THREE.Group();
  root.name = 'glow';

  const tex = new THREE.DataTexture(glowBytes(32), 32, 32, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;

  const card = (color, size, name) => {
    const m = new THREE.SpriteMaterial({ map: tex, color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false });
    const s = new THREE.Sprite(m);
    s.scale.set(size, size, 1);
    s.name = name;
    root.add(s);
    return s;
  };
  // A cone's surface is brightest where it faces the camera and fades where it turns edge-on, so it reads as a soft
  // shaft of lit air, not a solid wedge, from any side and from inside it. Strength fades from the apex (vertex colour).
  const cone = (color, radius, length, name) => {
    const m = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: color }, uOpacity: { value: 0 }, uEdge: { value: G.coneEdge } },
      vertexShader: /* glsl */ `
        attribute vec3 color;
        varying float vFade; varying vec3 vN; varying vec3 vView;
        void main() {
          vec4 mv = modelViewMatrix * vec4( position, 1.0 );
          vFade = color.r; vN = normalMatrix * normal; vView = -mv.xyz;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uOpacity; uniform float uEdge;
        varying float vFade; varying vec3 vN; varying vec3 vView;
        void main() {
          float facing = abs( dot( normalize( vN ), normalize( vView ) ) );
          gl_FragColor = vec4( uColor, uOpacity * vFade * pow( facing, uEdge ) );
        }`,
      blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    m.opacity = 0; // keep the shared opacity API: update() writes uOpacity through it
    Object.defineProperty(m, 'opacity', { get: () => m.uniforms.uOpacity.value, set: (v) => { if (m.uniforms) m.uniforms.uOpacity.value = v; } });
    const c = new THREE.Mesh(coneGeometry(THREE, radius, length), m);
    c.name = name;
    root.add(c);
    return c;
  };

  const lampColor = new THREE.Color(config.lights.lamp.color);
  const headColor = new THREE.Color(config.lights.headlight.color);
  const tailColor = new THREE.Color(G.taillight.color);

  // the lamp never changes: its card and cone are placed once
  const bulb = card(lampColor, G.bulb.size, 'glow-bulb');
  bulb.position.set(LAMP.head[0], LAMP.head[1] - BULB_DROP, LAMP.head[2]);
  bulb.material.opacity = G.bulb.opacity;
  const lampLen = LAMP.head[1] - 0.05;
  const lampCone = cone(lampColor, Math.tan(G.lampCone.halfAngleDeg * D2R) * lampLen, lampLen, 'glow-lamp-cone');
  lampCone.position.set(LAMP.head[0], LAMP.head[1] - 0.1, LAMP.head[2]);
  lampCone.material.opacity = G.lampCone.opacity;

  const heads = [-1, 1].map((s) => ({ s, card: card(headColor, G.headlight.size, `glow-head-${s < 0 ? 'left' : 'right'}`), cone: cone(headColor, Math.tan(G.beamCone.halfAngleDeg * D2R) * G.beamCone.length, G.beamCone.length, `glow-beam-${s < 0 ? 'left' : 'right'}`) }));
  const tails = [-1, 1].map((s) => ({ s, card: card(tailColor, G.taillight.size, `glow-tail-${s < 0 ? 'left' : 'right'}`) }));
  const up = new THREE.Vector3(0, 1, 0), fwd = new THREE.Vector3();

  scene.add(root);
  return {
    root,
    update(t) {
      const c = carAt(t), on = c.present ? headlights(t) : 0;
      const h = c.heading * D2R, f = [Math.sin(h), -Math.cos(h)], r = [Math.cos(h), Math.sin(h)];
      for (const { s, card: k, cone: b } of heads) {
        const x = c.x + f[0] * LENS.head.out + r[0] * s * LENS.head.side, z = c.z + f[1] * LENS.head.out + r[1] * s * LENS.head.side;
        k.position.set(x, LENS.head.y, z);
        k.material.opacity = G.headlight.opacity * on;
        k.visible = on > 0;
        // the beam cone points along the car, tipped down like the light (lights.js aims 15 m ahead at the ground)
        b.position.set(x, LENS.head.y, z);
        fwd.set(f[0] * 15, -LENS.head.y, f[1] * 15).normalize();
        b.quaternion.setFromUnitVectors(up.clone().negate(), fwd);
        b.material.opacity = G.beamCone.opacity * on;
        b.visible = on > 0;
      }
      for (const { s, card: k } of tails) {
        k.position.set(c.x - f[0] * LENS.tail.out + r[0] * s * LENS.tail.side, LENS.tail.y, c.z - f[1] * LENS.tail.out + r[1] * s * LENS.tail.side);
        k.material.opacity = G.taillight.opacity * on;
        k.visible = on > 0;
      }
    },
  };
}
