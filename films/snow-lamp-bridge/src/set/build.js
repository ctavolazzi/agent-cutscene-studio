// The grey set, built once from src/set.js at true scale: land, roads, sidewalks, the bridge, the river,
// the near buildings, the city on both banks, the lamp, the moon and the stars.
// update(t, camera) only places the moon and the stars around the camera and blinks the aircraft lights.
// No lights here: src/fx/lights.js owns every light. Contract: src/CONTRACT.md
import { STREET, CROSS, BRIDGE, LAMP, RAIL, MOON, BUILDINGS, CITY } from '../set.js';
import { moonAt } from '../world.js';
import { CONFIG } from '../config.js';
import { makeTextures, worldUV, TILE } from '../textures.js';

const D2R = Math.PI / 180;

// Sizes set.js leaves to the builder. Every position comes from set.js; these are thicknesses, margins and counts.
export const DIMS = {
  far: 2500, // land and water run this far, so their far edge sits almost on the true horizon
  roadLift: 0.005, // road surfaces sit a few mm above the land so they never z-fight with it
  coverLift: 0.006, // the snow on the sidewalks and the deck, a few mm over them (fx/footprints.js prints sit above it)
  deckThick: 0.8,
  northRoad: 300, // road beyond the bridge
  post: { top: 4.3, radius: 0.08 },
  armThick: 0.06,
  // The lantern is turned so no corner post stands within 27 degrees of the line of sight from any camera that frames
  // it (shots 1, 2, 3, 8, 10, 15). Square to the street, a post crosses the bulb in shot 1; at 45 degrees, one crosses
  // it in shots 2, 8, 10 and 15. Shot 1 looks up from 37 degrees below, so the bulb hangs a little high to clear the plate.
  lantern: { glass: 0.44, height: 0.42, plate: 0.04, plateWide: 0.48, cap: 0.06, capWide: 0.56, frame: 0.04, turnDeg: -18.5 },
  bulb: { radius: 0.12, lift: 0.08 },
  // near buildings: a few lit windows on street faces, standing just off the wall
  window: { w: 1.2, h: 1.6, out: 0.04, floor: 3.2, sill: 1.7, pitch: 2.6, margin: 1.5 },
  // city: a sparse grid on the faces that look toward the bridge. Each stands off its wall by outPerM per meter from
  // the bridge, never less than outMin: about 0.6 m at 450 m, where depth precision with a 0.05 m near plane is
  // about 0.25 m (half that at the 0.1 m near plane in config.js), and a few cm on the near city, where a big offset would slide windows off their own silhouette.
  cityWindow: { w: 1.4, h: 1.8, outMin: 0.05, outPerM: 0.0013, floor: 3.4, base: 4.0, pitch: 3.6, margin: 1.8, chance: 0.16, coolChance: 0.18 },
  cityHazeDensity: CONFIG.fog.cityDensity,
  aircraftRadius: 1.2,
  moonDist: 900,
  moonHideBelowDeg: -2.5,
  stars: { count: 360, radius: 1500, minElDeg: 1 },
};

// Where the city haze is measured from: the pair at the railing.
export const BRIDGE_EYE = [RAIL.x, 0, (RAIL.zA + RAIL.zB) / 2];

// The city opts out of scene fog (density 0.012 would erase it) and carries a lighter haze of its own.
export function cityHaze(x, z) {
  const k = Math.hypot(x - BRIDGE_EYE[0], z - BRIDGE_EYE[2]) * DIMS.cityHazeDensity;
  return 1 - Math.exp(-k * k);
}

// how far a city window stands off its wall (see DIMS.cityWindow)
export const cityWindowOut = (x, z) =>
  Math.max(DIMS.cityWindow.outMin, DIMS.cityWindow.outPerM * Math.hypot(x - BRIDGE_EYE[0], z - BRIDGE_EYE[2]));

export const aircraftOn = (t) => (t * 0.75) % 1 < 0.18;

// Flat greys. Surfaces that meet on screen differ by at least a quarter in luminance, so they read apart under dim light.
export const TONES = {
  land: '#c4cad4', // snow
  cover: '#b7bdc8', // the snow on the sidewalks and the deck, a little trodden
  parapet: '#a7adb6',
  sidewalk: '#8f959e',
  deck: '#666b73',
  building: '#50555d',
  corner: '#4f4840', // warmer and darker than the other buildings: shot 2's dark mass at right
  wall: '#43474e',
  road: '#7d838e', // a thin, grey layer of snow on the asphalt; the sidewalks' cover is whiter
  water: '#0e131b',
  city: '#4d5463',
  lampMetal: '#2a2d33',
  glow: '#d98a4a', // the lantern's lit panes, a step under the bulb
  bulb: '#ffb46b',
  window: '#ffc98a',
  cityWarm: '#ffc98a',
  cityCool: '#d8e4ff',
  aircraft: '#ff2a1a',
  moon: '#eef3ff',
  star: '#c8d4ff',
};

// Every material in the set, made here and nowhere else, so Stage 4 can swap the Lambert ones for the PS1 patch.
// `haze` holds one factor per CITY box. Those boxes get diffuse * (1 - f) and fog colour * f as emissive, which is
// exactly what scene fog does to a lit surface, only with the city's own density.
// `tex` (from src/textures.js, the look stage) adds a detail map to the near set's surfaces; without it they stay flat.
export function makeSetMaterials(THREE, config, haze = [], tex = null) {
  const lambert = (hex, map) => new THREE.MeshLambertMaterial({ color: hex, map: (tex && map && tex[map]) || null });
  const fogColor = new THREE.Color(config.fog.color);
  const cityGrey = new THREE.Color(TONES.city);
  return {
    land: lambert(TONES.land, 'snow'),
    // a few mm above the land, plus a depth offset: from shot 5's camera 0.25 m up, the lift alone loses to depth precision past 30 m
    road: new THREE.MeshLambertMaterial({ color: TONES.road, map: tex ? tex.snow : null, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 }),
    sidewalk: lambert(TONES.sidewalk, 'concrete'),
    cover: new THREE.MeshLambertMaterial({ color: TONES.cover, map: tex ? tex.snow : null, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 }),
    deck: lambert(TONES.deck, 'concrete'),
    parapet: lambert(TONES.parapet, 'concrete'),
    wall: lambert(TONES.wall, 'concrete'),
    water: lambert(TONES.water),
    building: lambert(TONES.building, 'brick'),
    corner: lambert(TONES.corner, 'plaster'),
    lampMetal: lambert(TONES.lampMetal),
    // The lit lantern is the film's subject, so it keeps its colour through the fog at any distance.
    // The panes are nearly opaque and write no depth; the bulb sits in the transparent queue too (at full opacity)
    // so it can draw after them and show as a hot core, while the opaque frame posts still hide it.
    lampGlass: new THREE.MeshBasicMaterial({ color: TONES.glow, transparent: true, opacity: 0.85, depthWrite: false, fog: false }),
    bulb: new THREE.MeshBasicMaterial({ color: TONES.bulb, transparent: true, opacity: 1, fog: false }),
    window: new THREE.MeshBasicMaterial({ color: TONES.window }),
    city: haze.map((f) => new THREE.MeshLambertMaterial({
      color: cityGrey.clone().multiplyScalar(1 - f),
      emissive: fogColor.clone().multiplyScalar(f),
      fog: false,
    })),
    // The standoff (cityWindowOut) leaves the farthest windows about 2.7 depth steps in front of their wall; two more
    // steps of offset add margin without sliding them sideways. No slope factor: a window seen nearly edge-on has a
    // steep depth slope, and a factor would pull it meters forward, through the nearer boxes.
    cityWindow: new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, polygonOffset: true, polygonOffsetFactor: 0, polygonOffsetUnits: -2 }),
    aircraft: new THREE.MeshBasicMaterial({ color: TONES.aircraft, fog: false }),
    // drawn first and never written to depth, so anything in front covers it
    // in the look stage a crescent: the mask's clear part is cut away, so the stars show through the dark of the moon
    moon: new THREE.MeshBasicMaterial({ color: TONES.moon, fog: false, depthWrite: false, map: tex ? tex.moon : null, alphaTest: tex ? 0.5 : 0 }),
    star: new THREE.PointsMaterial({ size: 1, sizeAttenuation: false, vertexColors: true, fog: false, depthWrite: false }),
  };
}

// ---------- footprints and faces ----------

const lohi = (a, b) => (a < b ? [a, b] : [b, a]);

function box(THREE, mat, xa, xb, ya, yb, za, zb, name) {
  const [x0, x1] = lohi(xa, xb), [y0, y1] = lohi(ya, yb), [z0, z1] = lohi(za, zb);
  const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), mat);
  m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  m.name = name;
  return m;
}

// No triangle may span more than this many meters along either axis. A 5 km triangle seen nearly edge-on gets its depth wrong: the far,
// fully fogged part of the embankment wall drew over the parapet in shot 13, one pixel wide, from 0.23 m off its plane.
const MAX_TRI = 100;
const segsFor = (length) => Math.max(1, Math.ceil(length / MAX_TRI));

// a horizontal rectangle facing up, subdivided so no triangle is longer than MAX_TRI
function flat(THREE, mat, xa, xb, za, zb, y, name) {
  const [x0, x1] = lohi(xa, xb), [z0, z1] = lohi(za, zb);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0, segsFor(x1 - x0), segsFor(z1 - z0)), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
  m.name = name;
  return m;
}

// A face of an axis-aligned footprint: outward normal, the plane coordinate, and its span.
function faceOf(b, face) {
  if (face === 'west') return { face, n: [-1, 0, 0], at: b.x0, axis: 'z', lo: b.z0, hi: b.z1 };
  if (face === 'east') return { face, n: [1, 0, 0], at: b.x1, axis: 'z', lo: b.z0, hi: b.z1 };
  if (face === 'north') return { face, n: [0, 0, -1], at: b.z0, axis: 'x', lo: b.x0, hi: b.x1 };
  return { face, n: [0, 0, 1], at: b.z1, axis: 'x', lo: b.x0, hi: b.x1 };
}

// the point s meters along face f from its low end, at height y, standing `out` meters off the wall
function facePoint(f, s, y, out) {
  const along = f.lo + s;
  return f.axis === 'z' ? [f.at + f.n[0] * out, y, along] : [along, y, f.at + f.n[2] * out];
}

// column offsets along a face, centred on it
function columns(len, pitch, margin) {
  const n = Math.max(1, Math.floor((len - 2 * margin) / pitch) + 1);
  const first = (len - (n - 1) * pitch) / 2;
  return Array.from({ length: n }, (_, i) => first + i * pitch);
}

// A facade faces a street when it stands on the bridge street's building line or on an edge of the cross street.
export function streetFaces(b) {
  const on = (a, v) => Math.abs(a - v) < 1e-6;
  const faces = [];
  if (on(b.x0, STREET.buildingLine)) faces.push('west');
  if (on(b.x1, -STREET.buildingLine)) faces.push('east');
  if (on(b.z1, CROSS.z0)) faces.push('south');
  if (on(b.z0, CROSS.z1)) faces.push('north');
  return faces;
}

// One merged geometry for many small wall quads, so hundreds of windows cost one draw call.
// Each quad: c (centre), n (outward axis normal), w, h, color (linear rgb). up x n is the quad's right-hand axis.
function quadsGeometry(THREE, quads) {
  const pos = [], nor = [], col = [], idx = [];
  for (const q of quads) {
    const u = [q.n[2], 0, -q.n[0]];
    const hw = q.w / 2, hh = q.h / 2;
    const base = pos.length / 3;
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      pos.push(q.c[0] + u[0] * hw * a, q.c[1] + hh * b, q.c[2] + u[2] * hw * a);
      nor.push(q.n[0], q.n[1], q.n[2]);
      col.push(q.color[0], q.color[1], q.color[2]);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

// ---------- the build ----------

export function buildSet(ctx) {
  const { THREE, scene, config, rngFor } = ctx;
  const haze = CITY.map((b) => cityHaze((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2));
  const tex = config.stage === 'look' ? makeTextures(THREE, rngFor) : null;
  const materials = makeSetMaterials(THREE, config, haze, tex);
  const M = materials;
  const F = DIMS.far;

  const root = new THREE.Group();
  root.name = 'set';
  const group = (name) => { const g = new THREE.Group(); g.name = name; root.add(g); return g; };

  // ground: snow, the river, and the embankment walls the deck spans
  const ground = group('set:ground');
  // The land is cut around the roads instead of running under them. Two coplanar planes 5 mm apart z-fight across
  // the whole frame from shot 5's camera 0.25 m up: the depth of a 5 km triangle is not interpolated that precisely,
  // and polygon offset did not save it. Every piece is a rectangle; together they tile the ground the roads leave.
  const R = STREET.roadHalf, X = CROSS.xExtent, W0 = BRIDGE.halfWidth;
  const landPieces = (name, rects) => {
    const g = new THREE.Group();
    g.name = name;
    rects.forEach(([xa, xb, za, zb], i) => g.add(flat(THREE, M.land, xa, xb, za, zb, 0, `${name}:${i}`)));
    return g;
  };
  ground.add(landPieces('land:south', [
    [-F, -X, BRIDGE.z0, F], [X, F, BRIDGE.z0, F],
    [-X, -R, BRIDGE.z0, CROSS.z0], [-X, -R, CROSS.z1, F],
    [R, X, BRIDGE.z0, CROSS.z0], [R, X, CROSS.z1, F],
    [-R, R, STREET.zSouth, F],
  ]));
  ground.add(landPieces('land:north', [
    [-F, -W0, -F, BRIDGE.z1], [W0, F, -F, BRIDGE.z1], [-W0, W0, -F, BRIDGE.z1 - DIMS.northRoad],
  ]));
  ground.add(flat(THREE, M.water, -F, F, BRIDGE.z1, BRIDGE.z0, BRIDGE.waterY, 'water'));
  const wallH = -BRIDGE.waterY;
  for (const [z, name, turn] of [[BRIDGE.z0, 'wall:south', Math.PI], [BRIDGE.z1, 'wall:north', 0]]) {
    // a plane faces +Z; the south bank's wall faces north across the river, so it turns half way round
    const w = new THREE.Mesh(new THREE.PlaneGeometry(2 * F, wallH, segsFor(2 * F), 1), M.wall);
    w.position.set(0, BRIDGE.waterY + wallH / 2, z);
    w.rotation.y = turn;
    w.name = name;
    ground.add(w);
  }

  // roads, a few mm above the land's edges. The cross street stops at the bridge street's road so the two never overlap.
  const y = DIMS.roadLift;
  ground.add(flat(THREE, M.road, -R, R, BRIDGE.z0, STREET.zSouth, y, 'road:street'));
  ground.add(flat(THREE, M.road, -CROSS.xExtent, -R, CROSS.z0, CROSS.z1, y, 'road:cross:west'));
  ground.add(flat(THREE, M.road, R, CROSS.xExtent, CROSS.z0, CROSS.z1, y, 'road:cross:east'));
  ground.add(flat(THREE, M.road, -BRIDGE.halfWidth, BRIDGE.halfWidth, BRIDGE.z1 - DIMS.northRoad, BRIDGE.z1, y, 'road:north'));

  // sidewalks: raised curb-high boxes, broken where the cross street runs through
  for (const [side, sx] of [['east', 1], ['west', -1]]) {
    for (const [part, za, zb] of [['north', BRIDGE.z0, CROSS.z0], ['south', CROSS.z1, STREET.zSouth]]) {
      ground.add(box(THREE, M.sidewalk, sx * R, sx * STREET.walkOuter, 0, STREET.curb, za, zb, `sidewalk:${side}:${part}`));
      ground.add(flat(THREE, M.cover, sx * R, sx * STREET.walkOuter, za, zb, STREET.curb + DIMS.coverLift, `cover:sidewalk:${side}:${part}`));
    }
  }

  // the bridge: deck top at y 0, parapets with their outer faces on the deck edge
  const bridge = group('set:bridge');
  const W = BRIDGE.halfWidth, inner = W - BRIDGE.parapetThick;
  bridge.add(box(THREE, M.deck, -W, W, -DIMS.deckThick, 0, BRIDGE.z1, BRIDGE.z0, 'deck'));
  bridge.add(box(THREE, M.parapet, inner, W, 0, BRIDGE.parapetTop, BRIDGE.z1, BRIDGE.z0, 'parapet:east'));
  bridge.add(box(THREE, M.parapet, -W, -inner, 0, BRIDGE.parapetTop, BRIDGE.z1, BRIDGE.z0, 'parapet:west'));
  bridge.add(flat(THREE, M.cover, -inner, inner, BRIDGE.z1, BRIDGE.z0, DIMS.coverLift, 'cover:deck'));

  // near buildings, each with two or three lit windows on its street faces
  const buildings = group('set:buildings');
  const wrng = rngFor('windows');
  const WIN = DIMS.window;
  const warm = new THREE.Color(TONES.window);
  const winQuads = [], winInfo = [];
  for (const b of BUILDINGS) {
    const m = box(THREE, b.corner ? M.corner : M.building, b.x0, b.x1, 0, b.h, b.z0, b.z1, `building:${b.id}`);
    m.userData = { id: b.id, corner: !!b.corner };
    buildings.add(m);
    const faces = streetFaces(b).map((f) => faceOf(b, f));
    if (!faces.length) continue;
    const n = wrng() < 0.5 ? 2 : 3;
    const top = Math.max(1, Math.floor((b.h - 1 - WIN.h / 2 - WIN.sill) / WIN.floor));
    const used = new Set();
    for (let k = 0, tries = 0; k < n && tries < 40; tries++) {
      const f = faces[Math.floor(wrng() * faces.length)];
      const cols = columns(f.hi - f.lo, WIN.pitch, WIN.margin);
      const col = Math.floor(wrng() * cols.length);
      const floor = 1 + Math.floor(wrng() * top);
      const key = `${f.face}:${col}:${floor}`;
      if (used.has(key)) continue;
      used.add(key);
      const c = facePoint(f, cols[col], floor * WIN.floor + WIN.sill, WIN.out);
      winQuads.push({ c, n: f.n, w: WIN.w, h: WIN.h, color: [warm.r, warm.g, warm.b] });
      winInfo.push({ id: b.id, face: f.face, center: c });
      k++;
    }
  }
  const windows = new THREE.Mesh(quadsGeometry(THREE, winQuads), M.window);
  windows.name = 'windows';
  windows.userData = { windows: winInfo };
  buildings.add(windows);

  // the city: hazed boxes, a sparse grid of windows on the faces that look back at the bridge, two aircraft lights
  const city = group('set:city');
  const crng = rngFor('city-windows');
  const CW = DIMS.cityWindow;
  const fogColor = new THREE.Color(config.fog.color);
  const cWarm = new THREE.Color(TONES.cityWarm), cCool = new THREE.Color(TONES.cityCool);
  const cityQuads = [], cityInfo = [], aircraft = [];
  CITY.forEach((b, i) => {
    const m = box(THREE, M.city[i], b.x0, b.x1, 0, b.h, b.z0, b.z1, `city:${b.id}`);
    m.userData = { id: b.id, haze: haze[i] };
    city.add(m);
    // a west face is only seen above its western neighbour on the same bank
    let west = null;
    for (const o of CITY) if (o !== b && o.bank === b.bank && o.x1 <= b.x0 && (!west || o.x1 > west.x1)) west = o;
    const river = b.z0 >= BRIDGE.z0 ? 'north' : 'south';
    for (const f of [faceOf(b, 'west'), faceOf(b, river)]) {
      const hidden = f.face === 'west' && west ? west.h : 0;
      for (const s of columns(f.hi - f.lo, CW.pitch, CW.margin)) {
        for (let yc = CW.base; yc + CW.h / 2 < b.h - 1.5; yc += CW.floor) {
          const r = crng(), bright = crng(), cool = crng();
          if (r >= CW.chance || yc - CW.h / 2 < hidden) continue;
          const onWall = facePoint(f, s, yc, 0);
          const c = facePoint(f, s, yc, cityWindowOut(onWall[0], onWall[2]));
          const fh = cityHaze(c[0], c[2]);
          const col = (cool < CW.coolChance ? cCool : cWarm).clone().multiplyScalar(0.55 + 0.45 * bright).lerp(fogColor, fh);
          cityQuads.push({ c, n: f.n, w: CW.w, h: CW.h, color: [col.r, col.g, col.b] });
          cityInfo.push({ id: b.id, face: f.face, center: c, haze: fh });
        }
      }
    }
    if (b.aircraft) {
      const a = new THREE.Mesh(new THREE.SphereGeometry(DIMS.aircraftRadius, 8, 6), M.aircraft);
      a.position.set((b.x0 + b.x1) / 2, b.h + DIMS.aircraftRadius, (b.z0 + b.z1) / 2);
      a.name = `aircraft:${b.id}`;
      city.add(a);
      aircraft.push(a);
    }
  });
  const cityWindows = new THREE.Mesh(quadsGeometry(THREE, cityQuads), M.cityWindow);
  cityWindows.name = 'city-windows';
  cityWindows.userData = { windows: cityInfo };
  city.add(cityWindows);

  // the lamp: post, a short arm toward the street at the post top, the lantern sitting on its end
  const lamp = group('set:lamp');
  const [bx, bz] = LAMP.base;
  const [hx, hy, hz] = LAMP.head;
  const P = DIMS.post;
  const post = new THREE.Mesh(new THREE.CylinderGeometry(P.radius, P.radius, P.top, 8), M.lampMetal);
  post.position.set(bx, P.top / 2, bz);
  post.name = 'lamp:post';
  lamp.add(post);
  const dx = hx - bx, dz = hz - bz;
  const arm = new THREE.Mesh(new THREE.BoxGeometry(Math.hypot(dx, dz) + P.radius, DIMS.armThick, DIMS.armThick), M.lampMetal);
  arm.position.set((bx + hx) / 2, P.top - DIMS.armThick / 2, (bz + hz) / 2);
  arm.rotation.y = -Math.atan2(dz, dx);
  arm.name = 'lamp:arm';
  lamp.add(arm);
  const L = DIMS.lantern;
  const head = new THREE.Group();
  head.position.set(hx, hy, hz);
  head.rotation.y = L.turnDeg * D2R;
  head.name = 'lamp:head';
  lamp.add(head);
  const part = (geo, mat, y0, name) => { const m = new THREE.Mesh(geo, mat); m.position.y = y0; m.name = name; head.add(m); return m; };
  part(new THREE.BoxGeometry(L.plateWide, L.plate, L.plateWide), M.lampMetal, -L.height / 2 - L.plate / 2, 'lamp:plate');
  part(new THREE.BoxGeometry(L.capWide, L.cap, L.capWide), M.lampMetal, L.height / 2 + L.cap / 2, 'lamp:cap');
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const c = part(new THREE.BoxGeometry(L.frame, L.height, L.frame), M.lampMetal, 0, 'lamp:frame');
    c.position.x = sx * L.glass / 2;
    c.position.z = sz * L.glass / 2;
  }
  part(new THREE.BoxGeometry(L.glass, L.height, L.glass), M.lampGlass, 0, 'lamp:glass');
  const bulb = part(new THREE.SphereGeometry(DIMS.bulb.radius, 12, 10), M.bulb, DIMS.bulb.lift, 'lamp:bulb');
  bulb.renderOrder = 1; // after the panes (see materials.lampGlass)

  // sky: a moon disc and a star sphere, both centred on the camera every frame so they sit at infinity
  const sky = group('set:sky');
  const moon = new THREE.Mesh(new THREE.CircleGeometry(DIMS.moonDist * Math.tan(MOON.angularRadiusDeg * D2R), 32), M.moon);
  moon.name = 'moon';
  moon.renderOrder = -10; // before everything else, so the city and the land draw over it
  sky.add(moon);

  const srng = rngFor('stars');
  const S = DIMS.stars;
  const starTone = new THREE.Color(TONES.star);
  const sPos = [], sCol = [];
  const sinMin = Math.sin(S.minElDeg * D2R);
  for (let i = 0; i < S.count; i++) {
    const se = sinMin + (1 - sinMin) * srng(); // uniform over the cap above the horizon
    const az = srng() * 2 * Math.PI;
    const ce = Math.sqrt(1 - se * se);
    sPos.push(Math.sin(az) * ce * S.radius, se * S.radius, -Math.cos(az) * ce * S.radius);
    const k = 0.18 + 0.32 * srng();
    sCol.push(starTone.r * k, starTone.g * k, starTone.b * k);
  }
  const sGeo = new THREE.BufferGeometry();
  sGeo.setAttribute('position', new THREE.Float32BufferAttribute(sPos, 3));
  sGeo.setAttribute('color', new THREE.Float32BufferAttribute(sCol, 3));
  const stars = new THREE.Points(sGeo, M.star);
  stars.name = 'stars';
  stars.renderOrder = -20; // behind the moon
  stars.frustumCulled = false; // it always surrounds the camera
  sky.add(stars);

  // textured surfaces get world-space coordinates, so a brick is the same size on every building
  if (tex) {
    root.updateMatrixWorld(true);
    root.traverse((o) => { if (o.isMesh && o.material.map && TILE[o.material.map.name]) worldUV(THREE, o, TILE[o.material.map.name]); });
  }
  scene.add(root);

  const origin = new THREE.Vector3();
  return {
    materials,
    root,
    update(t, camera) {
      const eye = camera ? camera.position : origin;
      const m = moonAt(t);
      const az = m.azimuthDeg * D2R, el = m.elevationDeg * D2R, d = DIMS.moonDist;
      moon.position.set(eye.x + Math.sin(az) * Math.cos(el) * d, eye.y + Math.sin(el) * d, eye.z - Math.cos(az) * Math.cos(el) * d);
      moon.lookAt(eye);
      moon.visible = m.elevationDeg >= DIMS.moonHideBelowDeg;
      stars.position.copy(eye);
      const on = aircraftOn(t);
      for (const a of aircraft) a.visible = on;
    },
  };
}
