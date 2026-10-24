// The set, in meters. +Y up, north is -Z, east is +X.
// This file is the single source of truth for the layout: the Stage 1 map and panels read it,
// and the 3D scene will build from it.
import { mulberry32 } from './prng.js';

export const STREET = {
  roadHalf: 3.5, // bridge street road: x -3.5 to +3.5
  walkOuter: 6.0, // sidewalks run to x +/-6.0
  buildingLine: 6.2, // facades stand at x +/-6.2
  curb: 0.15,
  zSouth: 70, // how far the street is drawn to the south
};

export const CROSS = { z0: 15, z1: 25, lane: { west: 17.5, east: 22.5 }, xExtent: 70 };

export const BRIDGE = {
  z0: -8, // south abutment
  z1: -38, // north abutment
  halfWidth: 6, // deck is 12 m wide
  // 1.15, not the 1.30 in PLAN's first table: at 1.30 B's hands sat level with B's shoulders (1.36 m), so leaning on
  // it read as arms held out straight. At 1.15 both rest their forearms on it. Chest high for B, lower chest for A.
  parapetTop: 1.15,
  parapetThick: 0.45,
  waterY: -6,
  zNorth: -60, // road beyond the bridge, for the sketch
};

export const LAMP = {
  base: [5.0, -4.5],
  height: 4.5,
  head: [4.6, 4.5, -4.5], // lantern leans 0.4 m over the street
  // Real light is a wide lantern, not a tight cone. Visible pool radius the blockout has to hit.
  poolRadius: 7,
  spotHalfAngleDeg: 70,
};

// Where the two stand at the east parapet. The parapet's inner face is at x 5.55.
export const RAIL = { x: 5.25, zB: -10.0, zA: -11.3 };

// Moon: azimuth is a compass bearing (0 north, 90 east). Elevation is keyed in world.js.
// 84 deg is where the river's two banks converge as seen from the bridge, so the moon can rise between the city banks.
export const MOON = { azimuthDeg: 84, angularRadiusDeg: 1.4 };

// Wind blows from the east-north-east toward the west-south-west (toward the camera side).
export const WIND = { fromDeg: 70 };

// Buildings: axis-aligned footprints, height h. Tone is a sketch value only.
export const BUILDINGS = [
  // east row, north of the cross street
  { id: 'E1', x0: 6.2, x1: 16, z0: 5, z1: 15, h: 12 },
  { id: 'E2', x0: 6.2, x1: 16, z0: -2, z1: 5, h: 10 },
  { id: 'E3', x0: 16, x1: 34, z0: 3, z1: 15, h: 10 },
  // west row, north of the cross street. Nothing west of the bridge head: it is an open snowy plaza.
  { id: 'W1', x0: -16, x1: -6.2, z0: 5, z1: 15, h: 11 },
  { id: 'W2', x0: -16, x1: -6.2, z0: -2, z1: 5, h: 9 },
  { id: 'W3', x0: -34, x1: -16, z0: 3, z1: 15, h: 10 },
  // south-east corner: hides the car on the cross street from the west sidewalk
  { id: 'SE', x0: 6.2, x1: 24, z0: 25, z1: 40, h: 14, corner: true },
  { id: 'SE2', x0: 24, x1: 42, z0: 25, z1: 38, h: 11 },
  // south-west corner
  { id: 'SW', x0: -24, x1: -6.2, z0: 25, z1: 40, h: 12 },
  { id: 'SW2', x0: -42, x1: -24, z0: 25, z1: 38, h: 10 },
  // street continues south
  { id: 'SE3', x0: 6.2, x1: 16, z0: 40, z1: 52, h: 11 },
  { id: 'SW3', x0: -16, x1: -6.2, z0: 40, z1: 52, h: 10 },
];

// City on both banks of the river, to the east, receding into fog. Seeded, so it never changes.
export function makeCity() {
  const rnd = mulberry32(7);
  const boxes = [];
  for (const bank of ['south', 'north']) {
    let x = bank === 'south' ? 38 : 28;
    let i = 0;
    while (x < 420) {
      const w = 9 + rnd() * 16;
      const d = 12 + rnd() * 10;
      const far = x / 420;
      let h = 10 + rnd() * (22 + far * 50);
      // south bank: north faces 3 to 5 m back from the river edge (z -8). North bank: south faces 3 m back from z -38.
      const z0 = bank === 'south' ? -5 + rnd() * 2 : -41 - d;
      // keep the skyline low along the moon's bearing from the bridge, so the moon rises in a gap and not behind a tower
      const cx = x + w / 2, cz = z0 + d / 2, dist = Math.hypot(cx - 5.25, cz + 10.65);
      const az = ((Math.atan2(cx - 5.25, -(cz + 10.65)) * 180) / Math.PI + 360) % 360;
      if (Math.abs(az - MOON.azimuthDeg) < 6) h = Math.min(h, 0.03 * dist);
      boxes.push({ id: `C${bank[0]}${i++}`, x0: x, x1: x + w, z0, z1: z0 + d, h, city: true, bank });
      x += w + 1 + rnd() * 4;
    }
  }
  // two aircraft lights on the tallest towers
  const tall = [...boxes].sort((a, b) => b.h - a.h).slice(0, 2);
  tall.forEach((b) => (b.aircraft = true));
  return boxes;
}
export const CITY = makeCity();

export const bounds = { x0: -45, x1: 90, z0: -70, z1: 75 }; // map extent
