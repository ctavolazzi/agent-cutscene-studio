// Tyre tracks (look stage): the car presses a dark track into the snow on the road under each wheel as it drives in,
// so the street is untouched before it arrives and its path stays written on the road after. Each track is one strip
// along that wheel's path, cut into short segments with the time the wheel reaches each; the segments are laid in
// order, so the drawn part is a prefix (setDrawRange) and a frame never depends on an earlier one.
// Wheel placement matches actors/car.js. Contract: src/CONTRACT.md
import { carAt, carTimes } from '../world.js';

export const TRACK = {
  dt: 1 / 96, // path sampling step, seconds
  step: 0.25, // meters of track per segment
  width: 0.2, // a little under the tyre's 0.22
  forward: 1.45, side: 0.82, // wheel centres from the car's centre (car.js SHAPE.wheel)
  lift: 0.009, // meters above the road: over its snow, under the prints (fx/footprints.js PRINT.lift)
};

const D2R = Math.PI / 180;
// the ground point under a wheel at time t: front (+1) or rear (-1), left (-1) or right (+1)
export function wheelAt(t, front, side) {
  const c = carAt(t), h = c.heading * D2R;
  const f = [Math.sin(h), -Math.cos(h)], r = [Math.cos(h), Math.sin(h)];
  return [c.x + f[0] * front * TRACK.forward + r[0] * side * TRACK.side, c.z + f[1] * front * TRACK.forward + r[1] * side * TRACK.side];
}

let cache = null;
// Four tracks, each a list of points { x, z, t } along one wheel's path from the car's start to its stop, a point every
// TRACK.step meters; t is when the wheel reaches it.
export function trackList() {
  if (cache) return cache;
  cache = [];
  for (const front of [1, -1]) {
    for (const side of [-1, 1]) {
      const pts = [];
      for (let t = carTimes.start; t <= carTimes.stop + TRACK.dt; t += TRACK.dt) {
        const tt = Math.min(t, carTimes.stop), [x, z] = wheelAt(tt, front, side);
        const last = pts[pts.length - 1];
        if (!last || Math.hypot(x - last.x, z - last.z) >= TRACK.step) pts.push({ x, z, t: tt });
      }
      cache.push({ front, side, pts });
    }
  }
  return cache;
}

// how many segments of a track are down at time t (segment i joins point i and i + 1)
export function segmentsDown(pts, t) {
  let lo = 0, hi = pts.length - 1; // count of points with time <= t, minus one, at least 0
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (pts[mid].t <= t) lo = mid; else hi = mid - 1;
  }
  return pts.length && pts[0].t <= t ? lo : 0;
}

// a strip along the points: two vertices per point, the width across the path; u across, v along in meters
function stripGeometry(THREE, pts) {
  const n = pts.length, pos = new Float32Array(n * 6), uv = new Float32Array(n * 4), idx = [];
  let along = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
    const nx = -dz / l * TRACK.width / 2, nz = dx / l * TRACK.width / 2;
    if (i) along += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    pos.set([pts[i].x - nx, TRACK.lift, pts[i].z - nz, pts[i].x + nx, TRACK.lift, pts[i].z + nz], i * 6);
    uv.set([0, along, 1, along], i * 4);
    if (i) { const k = 2 * (i - 1); idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 6).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

// a tread across the strip: soft edges, darker ribs every 4 px along (one repeat is 0.5 m of track)
function treadBytes(w, h) {
  const d = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w * 2 - 1, i = (y * w + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = y % 4 === 0 ? 200 : 255;
      d[i + 3] = Math.round(255 * Math.min(1, (1 - Math.abs(u)) * 2.5));
    }
  }
  return d;
}

export function buildTracks(ctx) {
  const { THREE, scene, config } = ctx;
  const root = new THREE.Group();
  root.name = 'tracks';
  const tex = new THREE.DataTexture(treadBytes(8, 16), 8, 16, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.repeat.set(1, 2); // v is in meters: two repeats a meter
  tex.needsUpdate = true;
  const material = new THREE.MeshLambertMaterial({
    color: config.tracks.color, map: tex, transparent: true, opacity: config.tracks.opacity, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6,
  });
  const strips = trackList().map(({ front, side, pts }) => {
    const m = new THREE.Mesh(stripGeometry(THREE, pts), material);
    m.name = `track-${front > 0 ? 'front' : 'rear'}-${side < 0 ? 'left' : 'right'}`;
    m.frustumCulled = false; // the bounding sphere is the whole path; the draw range does the hiding
    root.add(m);
    return { m, pts };
  });
  scene.add(root);
  return {
    root,
    material,
    update(t) {
      for (const { m, pts } of strips) {
        const n = segmentsDown(pts, t);
        m.geometry.setDrawRange(0, n * 6);
        m.visible = n > 0;
      }
    },
  };
}

