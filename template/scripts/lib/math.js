// Small vector math and a software projector with near-plane clipping, for the storyboard sketches.
// World: +Y up, north -Z, east +X (right handed: east x up = south). Camera looks down +f, right is f x up.
export const D2R = Math.PI / 180;
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const lerp = (a, b, u) => a + (b - a) * u;
export const mix3 = (a, b, u) => [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)];
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
// compass heading (0 north, 90 east) to a ground direction [x, 0, z]
export const dirOf = (deg) => [Math.sin(deg * D2R), 0, -Math.cos(deg * D2R)];
export const bearingOf = (from, to) => ((Math.atan2(to[0] - from[0], -(to[2] - from[2])) / D2R) + 360) % 360;

export function hexToRgb(h) {
  const s = h.replace('#', '');
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}
export const rgbToHex = (c) => '#' + c.map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
export const mixHex = (a, b, u) => rgbToHex(mix3(hexToRgb(a), hexToRgb(b), clamp(u, 0, 1)));

// lens is full-frame focal length in mm, so tan(vfov / 2) = 12 / lens
export function makeCamera({ pos, target, roll = 0, lens }, W, H) {
  const f = norm(sub(target, pos));
  let r = norm(cross(f, [0, 1, 0]));
  let u = cross(r, f);
  if (roll) {
    const c = Math.cos(roll * D2R), s = Math.sin(roll * D2R);
    const r2 = add(mul(r, c), mul(u, s));
    const u2 = sub(mul(u, c), mul(r, s));
    r = r2; u = u2;
  }
  const tv = 12 / lens;
  const th = tv * (W / H);
  const cam = {
    pos, f, r, u, tv, th, W, H, lens,
    toCam(p) { const d = sub(p, pos); return [dot(d, r), dot(d, u), dot(d, f)]; },
    toScreen(c) { return [(0.5 + 0.5 * (c[0] / c[2]) / th) * W, (0.5 - 0.5 * (c[1] / c[2]) / tv) * H]; },
    // returns [x, y, depth] or null when behind the camera
    project(p) { const c = cam.toCam(p); if (c[2] <= 0.05) return null; const s = cam.toScreen(c); return [s[0], s[1], c[2]]; },
    // pixels per meter at a depth
    scaleAt(depth) { return H / (2 * tv * depth); },
    // clip a world polygon to the near plane, project it, return [[x, y], ...] (or null)
    projectPoly(pts, near = 0.15) {
      const cs = pts.map((p) => cam.toCam(p));
      const out = [];
      for (let i = 0; i < cs.length; i++) {
        const a = cs[i], b = cs[(i + 1) % cs.length];
        const ain = a[2] >= near, bin = b[2] >= near;
        if (ain) out.push(a);
        if (ain !== bin) {
          const u2 = (near - a[2]) / (b[2] - a[2]);
          out.push([lerp(a[0], b[0], u2), lerp(a[1], b[1], u2), near]);
        }
      }
      if (out.length < 3) return null;
      return out.map((c) => cam.toScreen(c));
    },
  };
  return cam;
}

// Oriented box on the ground plane. heading is a compass bearing for the "length" axis.
// Returns faces: { pts: [p0, p1, p2, p3], n, kind } with p0 to p1 along the bottom edge as seen from outside.
export function makeBox(cx, cz, length, width, y0, y1, heading = 0) {
  const fx = Math.sin(heading * D2R), fz = -Math.cos(heading * D2R);
  const rx = Math.cos(heading * D2R), rz = Math.sin(heading * D2R);
  const hl = length / 2, hw = width / 2;
  const ring = [[hl, -hw], [hl, hw], [-hl, hw], [-hl, -hw]].map(([a, b]) => [cx + fx * a + rx * b, cz + fz * a + rz * b]);
  const bot = ring.map(([x, z]) => [x, y0, z]);
  const top = ring.map(([x, z]) => [x, y1, z]);
  const center = [cx, (y0 + y1) / 2, cz];
  const faces = [];
  const push = (p0, p1, p2, p3, kind) => {
    const fc = mul(add(add(p0, p1), add(p2, p3)), 0.25);
    let n = norm(cross(sub(p1, p0), sub(p3, p0)));
    if (dot(n, sub(fc, center)) < 0) { [p0, p1, p2, p3] = [p1, p0, p3, p2]; n = norm(cross(sub(p1, p0), sub(p3, p0))); }
    faces.push({ pts: [p0, p1, p2, p3], n, kind, center: fc });
  };
  for (let i = 0; i < 4; i++) push(bot[i], bot[(i + 1) % 4], top[(i + 1) % 4], top[i], 'side');
  push(top[0], top[1], top[2], top[3], 'top');
  return { faces, center };
}

export function aabb(b, y0 = 0, y1 = b.h) {
  return makeBox((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2, b.z1 - b.z0, b.x1 - b.x0, y0, y1, 0);
}

// 2D segment against axis-aligned rectangle (slab test). Used for ground-plane sight lines through buildings.
export function segHitsRect(a, b, r) {
  let t0 = 0, t1 = 1;
  const d = [b[0] - a[0], b[1] - a[1]];
  const lo = [r.x0, r.z0], hi = [r.x1, r.z1];
  for (let i = 0; i < 2; i++) {
    if (Math.abs(d[i]) < 1e-9) { if (a[i] < lo[i] || a[i] > hi[i]) return false; }
    else {
      let u0 = (lo[i] - a[i]) / d[i], u1 = (hi[i] - a[i]) / d[i];
      if (u0 > u1) [u0, u1] = [u1, u0];
      t0 = Math.max(t0, u0); t1 = Math.min(t1, u1);
      if (t0 > t1) return false;
    }
  }
  return true;
}

// Sutherland-Hodgman clip of a convex polygon against an axis-aligned rectangle
export function clipPolyRect(pts, r) {
  const edges = [
    (p) => p[0] >= r.x0, (p) => p[0] <= r.x1, (p) => p[1] >= r.y0, (p) => p[1] <= r.y1,
  ];
  const isect = [
    (a, b) => [r.x0, a[1] + ((b[1] - a[1]) * (r.x0 - a[0])) / (b[0] - a[0])],
    (a, b) => [r.x1, a[1] + ((b[1] - a[1]) * (r.x1 - a[0])) / (b[0] - a[0])],
    (a, b) => [a[0] + ((b[0] - a[0]) * (r.y0 - a[1])) / (b[1] - a[1]), r.y0],
    (a, b) => [a[0] + ((b[0] - a[0]) * (r.y1 - a[1])) / (b[1] - a[1]), r.y1],
  ];
  let out = pts;
  for (let e = 0; e < 4 && out.length; e++) {
    const inp = out; out = [];
    for (let i = 0; i < inp.length; i++) {
      const a = inp[i], b = inp[(i + 1) % inp.length];
      const ai = edges[e](a), bi = edges[e](b);
      if (ai) out.push(a);
      if (ai !== bi) out.push(isect[e](a, b));
    }
  }
  return out.length >= 3 ? out : null;
}

// clip an open polyline to a rectangle; returns an array of polylines
export function clipLineRect(pts, r) {
  const res = []; let cur = [];
  const inside = (p) => p[0] >= r.x0 && p[0] <= r.x1 && p[1] >= r.y0 && p[1] <= r.y1;
  const seg = (a, b) => {
    let t0 = 0, t1 = 1; const dx = b[0] - a[0], dy = b[1] - a[1];
    const p = [-dx, dx, -dy, dy], q = [a[0] - r.x0, r.x1 - a[0], a[1] - r.y0, r.y1 - a[1]];
    for (let i = 0; i < 4; i++) {
      if (p[i] === 0) { if (q[i] < 0) return null; }
      else { const u = q[i] / p[i]; if (p[i] < 0) { if (u > t1) return null; t0 = Math.max(t0, u); } else { if (u < t0) return null; t1 = Math.min(t1, u); } }
    }
    return [[a[0] + t0 * dx, a[1] + t0 * dy], [a[0] + t1 * dx, a[1] + t1 * dy]];
  };
  for (let i = 0; i < pts.length - 1; i++) {
    const s = seg(pts[i], pts[i + 1]);
    if (!s) { if (cur.length) { res.push(cur); cur = []; } continue; }
    if (!cur.length) cur.push(s[0]);
    cur.push(s[1]);
    if (!inside(pts[i + 1])) { res.push(cur); cur = []; }
  }
  if (cur.length) res.push(cur);
  return res.filter((l) => l.length >= 2);
}
