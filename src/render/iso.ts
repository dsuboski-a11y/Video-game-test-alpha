/**
 * Dimetric (2:1 "isometric") projection.
 *
 * The simulation stays flat and top-down — it has no idea any of this exists.
 * Only the renderer and the joystick know about the camera angle, which keeps
 * the projection a pure presentation concern and leaves the netcode free to
 * ship the same flat world coordinates it always did.
 */
import type { MapData } from '../sim/types';

export const ISO_X = 0.5;    // world unit -> screen x, per (wx - wy)
export const ISO_Y = 0.25;   // world unit -> screen y, per (wx + wy)

/** Visual-only terrain elevation, in screen pixels. Ground units path exactly
 *  as before; the height is scenery, so it can never desync a match. */
export const TERRAIN_H: readonly number[] = [0, 15, -12]; // plains, rough, water
export const JET_ALT = 58;

export interface P { x: number; y: number; }

export const toScreen = (wx: number, wy: number, h = 0): P => ({
  x: (wx - wy) * ISO_X,
  y: (wx + wy) * ISO_Y - h,
});

/** Screen-space direction -> world-space direction. The joystick pushes in
 *  screen space because that is where the player's thumb lives; the mech has
 *  to move in world space. Inverse of the projection above, ignoring height. */
export const screenDirToWorld = (sx: number, sy: number): P => ({
  x: sx / (2 * ISO_X) + sy / (2 * ISO_Y),
  y: sy / (2 * ISO_Y) - sx / (2 * ISO_X),
});

/** Painter's-algorithm depth. Larger (wx + wy) is nearer the viewer. */
export const depthOf = (wx: number, wy: number): number => wx + wy;

export const terrainHeight = (t: number): number => TERRAIN_H[t] ?? 0;

export function heightAt(map: MapData, wx: number, wy: number): number {
  const tx = Math.floor(wx / map.tile), ty = Math.floor(wy / map.tile);
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return 0;
  return terrainHeight(map.terrain[ty * map.w + tx]);
}

/** Projected bounding box of the whole map, for clamping the camera. */
export function projectedBounds(map: MapData) {
  const W = map.w * map.tile, H = map.h * map.tile;
  return {
    x0: -H * ISO_X, x1: W * ISO_X,
    y0: -JET_ALT, y1: (W + H) * ISO_Y,
  };
}

export interface PrismColors { top: string; left: string; right: string; }

/**
 * Draw an axis-rotated box standing on the ground: one top face plus whichever
 * side faces point toward the viewer. This is the workhorse for every unit and
 * for the commander — chunky solids are what sell a 16-bit isometric look, and
 * they read at phone size far better than outlined flat sprites.
 */
export function prism(
  ctx: CanvasRenderingContext2D,
  wx: number, wy: number, ground: number,
  halfLen: number, halfWid: number, height: number,
  facing: number, c: PrismColors,
): void {
  const cos = Math.cos(facing), sin = Math.sin(facing);
  // Footprint corners in world space, walked counter-clockwise.
  const corners: P[] = [
    { x: halfLen, y: -halfWid }, { x: halfLen, y: halfWid },
    { x: -halfLen, y: halfWid }, { x: -halfLen, y: -halfWid },
  ].map((p) => ({ x: wx + p.x * cos - p.y * sin, y: wy + p.x * sin + p.y * cos }));

  const base = corners.map((p) => toScreen(p.x, p.y, ground));
  const top = corners.map((p) => toScreen(p.x, p.y, ground + height));

  // Side faces first, so the top face always paints over their seams.
  for (let i = 0; i < 4; i++) {
    const a = corners[i], b = corners[(i + 1) % 4];
    // Outward normal of edge a->b for a counter-clockwise footprint.
    const nx = b.y - a.y, ny = a.x - b.x;
    if (nx + ny <= 0) continue;                 // faces away from the viewer
    const j = (i + 1) % 4;
    // Light the two visible orientations differently so corners read as edges.
    ctx.fillStyle = nx > ny ? c.right : c.left;
    ctx.beginPath();
    ctx.moveTo(base[i].x, base[i].y);
    ctx.lineTo(base[j].x, base[j].y);
    ctx.lineTo(top[j].x, top[j].y);
    ctx.lineTo(top[i].x, top[i].y);
    ctx.closePath();
    ctx.fill();
  }

  ctx.fillStyle = c.top;
  ctx.beginPath();
  ctx.moveTo(top[0].x, top[0].y);
  for (let i = 1; i < 4; i++) ctx.lineTo(top[i].x, top[i].y);
  ctx.closePath();
  ctx.fill();
}

/**
 * A circle of world radius r, projected onto the ground plane, is an ellipse
 * with semi-axes r*ISO_X*sqrt(2) and r*ISO_Y*sqrt(2) — the sqrt(2) comes from
 * the circle's extreme points sitting on the diagonal after the shear. Getting
 * this wrong draws every pad and shadow about 40% oversized, which is exactly
 * what it did.
 */
export const GROUND_RX = ISO_X * Math.SQRT2;
export const GROUND_RY = ISO_Y * Math.SQRT2;

/** Path a ground-plane circle of world radius `r` at an already-projected point. */
export function isoEllipse(
  ctx: CanvasRenderingContext2D, px: number, py: number, r: number,
  from = 0, to = Math.PI * 2,
): void {
  ctx.beginPath();
  ctx.ellipse(px, py, r * GROUND_RX, r * GROUND_RY, 0, from, to);
}

/** Ground shadow. Its distance from the body is the only altitude cue a player
 *  needs, and it works without reading a single UI element. */
export function shadow(
  ctx: CanvasRenderingContext2D, wx: number, wy: number, ground: number,
  rx: number, alpha: number,
): void {
  const p = toScreen(wx, wy, ground);
  ctx.fillStyle = `rgba(0,0,0,${alpha})`;
  isoEllipse(ctx, p.x, p.y, rx);
  ctx.fill();
}

/** Flat diamond sitting on the ground plane — base pads, capture rings. */
export function groundDisc(
  ctx: CanvasRenderingContext2D, wx: number, wy: number, ground: number, r: number,
): void {
  const p = toScreen(wx, wy, ground);
  isoEllipse(ctx, p.x, p.y, r);
}

/** Shade a hex colour by a multiplier. Used to derive the side faces of every
 *  solid from its top colour, so the whole scene is lit consistently. */
export function shade(hex: string, mul: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * mul));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * mul));
  const b = Math.min(255, Math.round((n & 255) * mul));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

export function prismColors(main: string): PrismColors {
  return { top: main, right: shade(main, 0.68), left: shade(main, 0.44) };
}
