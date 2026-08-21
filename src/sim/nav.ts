import type { MapData } from './types';
import { TERRAIN_SPEED } from './constants';

/**
 * One BFS distance field per base, computed once when the map is created.
 * Units heading for a base descend its gradient instead of steering directly,
 * which is what stops columns piling into a lake shore forever. 17 bases at
 * 64x40 is ~44k cells — trivial to build, and constant cost at runtime.
 */
export interface NavField {
  w: number; h: number;
  cost: Float32Array; // Infinity where unreachable
}

const NEIGHBOURS: [number, number, number][] = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142], [-1, -1, 1.4142],
];

export function buildField(map: MapData, wx: number, wy: number): NavField {
  const { w, h, terrain } = map;
  const cost = new Float32Array(w * h).fill(Infinity);
  const sx = Math.max(0, Math.min(w - 1, Math.floor(wx / map.tile)));
  const sy = Math.max(0, Math.min(h - 1, Math.floor(wy / map.tile)));

  // Dial's-algorithm-flavoured bucket queue: edge weights are small and
  // bounded, so a sorted-insert-free sweep is plenty and stays deterministic.
  const queue: number[] = [sy * w + sx];
  cost[sy * w + sx] = 0;
  let head = 0;
  while (head < queue.length) {
    const idx = queue[head++];
    const cx = idx % w, cy = (idx / w) | 0;
    const base = cost[idx];
    for (const [dx, dy, step] of NEIGHBOURS) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const t = terrain[ny * w + nx];
      const mul = TERRAIN_SPEED[t];
      if (mul <= 0) continue;                 // water is impassable to ground
      // Diagonal moves may not cut a corner between two blocked tiles.
      if (dx !== 0 && dy !== 0) {
        if (TERRAIN_SPEED[terrain[cy * w + nx]] <= 0) continue;
        if (TERRAIN_SPEED[terrain[ny * w + cx]] <= 0) continue;
      }
      const nc = base + step / mul;
      const ni = ny * w + nx;
      if (nc < cost[ni] - 1e-6) {
        cost[ni] = nc;
        queue.push(ni);
      }
    }
  }
  return { w, h, cost };
}

/**
 * Direction of steepest descent toward the field's source.
 *
 * This uses a central-difference gradient rather than "pick the cheapest
 * neighbour". The discrete version had to break ties, and any fixed tie-break
 * order bakes a compass bias into every unit on the map — with NEIGHBOURS
 * starting at [+1,0] it quietly pushed the whole war eastward and handed one
 * side an ~80/20 edge in mirror matches. A gradient has no preferred axis.
 */
export function fieldDir(
  field: NavField, map: MapData, wx: number, wy: number,
): { x: number; y: number } | null {
  const { w, h, cost } = field;
  const cx = Math.max(0, Math.min(w - 1, Math.floor(wx / map.tile)));
  const cy = Math.max(0, Math.min(h - 1, Math.floor(wy / map.tile)));

  // Unreachable cells are treated as very expensive rather than infinite, so
  // the subtraction below stays finite next to a shoreline.
  const at = (x: number, y: number): number => {
    if (x < 0 || y < 0 || x >= w || y >= h) return BLOCKED;
    const c = cost[y * w + x];
    return isFinite(c) ? c : BLOCKED;
  };

  const here = at(cx, cy);
  const gx = at(cx + 1, cy) - at(cx - 1, cy);
  const gy = at(cx, cy + 1) - at(cx, cy - 1);
  const len = Math.hypot(gx, gy);
  if (len > 1e-6) return { x: -gx / len, y: -gy / len };

  // Flat gradient (a plateau, or standing on the source). Fall back to the
  // cheapest neighbour, and average all cells that tie so the fallback is
  // symmetric too.
  let best = here, sx = 0, sy = 0, n = 0;
  for (const [dx, dy] of NEIGHBOURS) {
    const c = at(cx + dx, cy + dy);
    if (c < best - 1e-6) { best = c; sx = dx; sy = dy; n = 1; }
    else if (Math.abs(c - best) <= 1e-6 && c < here - 1e-6) { sx += dx; sy += dy; n++; }
  }
  if (n === 0) return null;
  const fl = Math.hypot(sx, sy);
  return fl < 1e-6 ? null : { x: sx / fl, y: sy / fl };
}

/** Stand-in for "no path this way"; large enough to dominate any real cost on
 *  a map this size, small enough that arithmetic on it stays finite. */
const BLOCKED = 1e6;
