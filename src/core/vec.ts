export interface Vec { x: number; y: number; }

export const dist = (ax: number, ay: number, bx: number, by: number): number =>
  Math.hypot(bx - ax, by - ay);

export const dist2 = (ax: number, ay: number, bx: number, by: number): number => {
  const dx = bx - ax, dy = by - ay;
  return dx * dx + dy * dy;
};

export const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Shortest signed angular difference from a to b, in radians. */
export const angleDelta = (a: number, b: number): number => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};

/** Rotate `from` toward `to` by at most `maxStep` radians. */
export const turnToward = (from: number, to: number, maxStep: number): number => {
  const d = angleDelta(from, to);
  return from + clamp(d, -maxStep, maxStep);
};
