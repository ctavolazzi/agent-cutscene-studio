// Footprints (look stage): a print wherever a shoe comes down in the snow (the land, the road's thin layer and the
// cover on the sidewalks and the deck), shown from the moment the shoe lands. The prints come from the rig itself:
// each person's pose is sampled over the film once, and a foot is planted when its ankle is at standing height over
// the ground and has stopped moving. So the prints are a pure function of the walk, and any change to the walk moves
// them with it. Contract: src/CONTRACT.md
import { BRIDGE, CROSS, STREET } from '../set.js';
import { PEOPLE, T_TOTAL } from '../world.js';
import { BODY, bodyToWorld, groundY, makePoser } from '../actors/people.js';

export const PRINT = {
  dt: 1 / 48, // sampling step, seconds: a print shows at most half a frame after its shoe lands
  rest: 0.01, // meters over standing height that still count as down
  lifted: 0.025, // meters over standing height that count as a foot in the air
  gap: 0.1, // a landing within this of the same foot's last print makes no new one
  lift: 0.012, // meters above the ground: over the snow cover (set/build.js DIMS.coverLift)
};

// the height a print lies at: the sidewalks' cover at curb height, else 0 (the land, the road's snow a few mm up, the deck's)
export function snowY(x, z) {
  const ax = Math.abs(x), walk = ax >= STREET.roadHalf && ax <= STREET.walkOuter;
  const curb = walk && ((z >= BRIDGE.z0 && z <= CROSS.z0) || (z >= CROSS.z1 && z <= STREET.zSouth));
  return curb ? STREET.curb : 0;
}

let cache = null;
// Every print in the film: { id, foot (0 left, 1 right), t (when it lands), x, y, z, heading (degrees, the shoe's
// face), length, width }, sorted by t. Computed once. A print is made when a shoe comes down: its ankle drops to
// standing height after being lifted, or the person first appears with it down. Its place is the shoe's centre then.
export function footprintList() {
  if (cache) return cache;
  const out = [];
  for (const id of Object.keys(PEOPLE)) {
    const pose = makePoser(id), k = PEOPLE[id].height / 1.8;
    const stand = BODY.ankleY * k, toe = BODY.shoe.toe * k;
    const n = Math.round(T_TOTAL / PRINT.dt);
    const state = [null, null], last = [null, null]; // per foot: 'down' or 'up' (null while hidden); its last print
    for (let i = 0; i <= n; i++) {
      const t = i * PRINT.dt, p = pose(t);
      if (!p.visible) { state[0] = state[1] = null; continue; }
      const h = p.face * Math.PI / 180, fwd = [Math.sin(h), -Math.cos(h)];
      p.legs.forEach((leg, foot) => {
        const a = bodyToWorld(p, leg.ankle);
        const x = a[0] + fwd[0] * toe, z = a[2] + fwd[1] * toe;
        const over = a[1] - groundY(a[0], a[2]) - stand;
        const now = over <= PRINT.rest ? 'down' : over >= PRINT.lifted ? 'up' : state[foot] ?? 'up';
        const lands = now === 'down' && state[foot] !== 'down';
        state[foot] = now;
        if (!lands) return;
        const l = last[foot];
        if (l && Math.hypot(x - l.x, z - l.z) < PRINT.gap) return;
        last[foot] = { id, foot, t, x, y: snowY(x, z) + PRINT.lift, z, heading: p.face, length: BODY.shoe.l * k, width: BODY.shoe.w * k };
        out.push(last[foot]);
      });
    }
  }
  out.sort((a, b) => a.t - b.t || a.id.localeCompare(b.id) || a.foot - b.foot);
  cache = out;
  return out;
}

// a shoe print: a sole and a heel, darker in the middle where the snow packs hardest; grey in RGB, shape in alpha
function printBytes(w, h) {
  const d = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w * 2 - 1, v = (y + 0.5) / h; // v 0 at the heel, 1 at the toe
      const sole = Math.hypot(u / 0.95, (v - 0.66) / 0.33), heel = Math.hypot(u / 0.8, (v - 0.17) / 0.16);
      const r = Math.min(sole, heel);
      const a = r >= 1 ? 0 : Math.min(1, (1 - r) * 3);
      const i = (y * w + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = Math.round(255 * (0.75 + 0.25 * r));
      d[i + 3] = Math.round(255 * a);
    }
  }
  return d;
}

export function buildFootprints(ctx) {
  const { THREE, scene, config } = ctx;
  const root = new THREE.Group();
  root.name = 'footprints';
  const tex = new THREE.DataTexture(printBytes(16, 32), 16, 32, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  const material = new THREE.MeshLambertMaterial({
    color: config.footprints.color, map: tex, transparent: true, opacity: config.footprints.opacity, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8,
  });
  const geometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2); // flat, its +V along -Z (the shoe's toe)
  const prints = footprintList().map((f, i) => {
    const m = new THREE.Mesh(geometry, material);
    m.name = `print-${f.id}-${i}`;
    m.position.set(f.x, f.y, f.z);
    m.rotation.y = -f.heading * Math.PI / 180;
    m.scale.set(f.width, 1, f.length);
    m.visible = false;
    m.renderOrder = 0;
    root.add(m);
    return { m, t: f.t };
  });
  scene.add(root);
  return {
    root,
    material,
    update(t) {
      for (const p of prints) p.m.visible = t >= p.t;
    },
  };
}
