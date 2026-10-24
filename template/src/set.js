// The set, in meters. +Y up, north is -Z, east is +X.
// This file is the single source of truth for the layout: the scene, the cameras and the checks all read it.
// The template's example: a street lamp on snowy ground beside a low concrete wall. Replace it with your film's set.

export const GROUND = { size: 60, segments: 30 }; // a square of snow, subdivided so vertex snapping has vertices to move
export const WALL = { x0: -5, x1: 5, z: -3.5, height: 1.1, thick: 0.4 };
export const LAMP = {
  base: [1.6, -2.2],
  height: 3.4,
  head: [1.3, 3.4, -2.2], // the lantern leans 0.3 m out from the post
};
