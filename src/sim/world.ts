import { Rng } from '../core/rng';
import { dist } from '../core/vec';
import {
  BASE_RADIUS, HQ_HP, HQ_RADIUS, MECH_AMMO, MECH_FUEL, MECH_HP, OUTPOST_HP,
  STARTING_MONEY,
} from './constants';
import type { Base, GameState, MapData, Mech, PlayerId } from './types';

// Odd in both axes on purpose: 180-degree rotational symmetry needs a true
// centre tile, otherwise the centre base has no mirror image of itself and the
// map is quietly unfair.
export const MAP_W = 57;
export const MAP_H = 35;
export const TILE = 48;

/** Smooth value noise from the seeded Rng only — no Math.random anywhere in
 *  worldgen, so a seed is a complete description of the battlefield and peers
 *  only have to agree on one integer. */
function valueNoise(rng: Rng, w: number, h: number, octaves: number): Float32Array {
  const out = new Float32Array(w * h);
  let amp = 1, freq = 4, total = 0;
  for (let o = 0; o < octaves; o++) {
    const gw = freq + 1, gh = Math.max(2, Math.round((freq * h) / w) + 1);
    const grid = new Float32Array(gw * gh);
    for (let i = 0; i < grid.length; i++) grid[i] = rng.next();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const fx = (x / w) * (gw - 1), fy = (y / h) * (gh - 1);
        const x0 = Math.floor(fx), y0 = Math.floor(fy);
        const x1 = Math.min(gw - 1, x0 + 1), y1 = Math.min(gh - 1, y0 + 1);
        const tx = fx - x0, ty = fy - y0;
        const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
        const a = grid[y0 * gw + x0], b = grid[y0 * gw + x1];
        const c = grid[y1 * gw + x0], d = grid[y1 * gw + x1];
        const top = a + (b - a) * sx, bot = c + (d - c) * sx;
        out[y * w + x] += (top + (bot - top) * sy) * amp;
      }
    }
    total += amp;
    amp *= 0.5;
    freq *= 2;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

/**
 * Outpost layout in TILE coordinates for the left half; each entry is mirrored
 * through the map centre so both players face an identical problem.
 *
 * Tiles, not fractions of the map, because every downstream system quantises to
 * tiles with floor(). A base sitting exactly on a tile boundary floors to the
 * same row on both sides of the map, so its mirror lands one tile off and the
 * two flow fields stop being mirror images — worth roughly a 70/30 win rate to
 * one side before anybody fires a shot.
 */
const HALF_LAYOUT_TILES: [number, number][] = [
  [11, 8],
  [11, 26],
  [18, 17],
  [23, 5],
  [23, 29],
];

const HQ_TILE: [number, number] = [4, 17];
const CENTRE_TILE: [number, number] = [28, 17];

/** Point reflection through the map centre, in tile space. */
const mirrorTile = (tx: number, ty: number): [number, number] =>
  [MAP_W - 1 - tx, MAP_H - 1 - ty];

/** Centre of a tile in world units — never its corner. */
const tileCentre = (tx: number, ty: number) => ({ x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE });

export function generateMap(seed: number): MapData {
  const rng = new Rng(seed ^ 0x9e3779b9);
  const noise = valueNoise(rng, MAP_W, MAP_H, 4);
  const terrain = new Uint8Array(MAP_W * MAP_H);

  // Build only the left half (including the centre column), then rotate it
  // into the right half.
  const halfW = Math.ceil(MAP_W / 2);   // 29: columns 0..28, centre column is 28
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < halfW; x++) {
      const n = noise[y * MAP_W + x];
      // Edge falloff keeps the outer rim passable so nobody is walled in.
      const edge = Math.min(x, y, MAP_H - 1 - y) / 6;
      const v = n - Math.max(0, 1 - edge) * 0.25;
      terrain[y * MAP_W + x] = v > 0.66 ? 2 : v > 0.52 ? 1 : 0;
    }
  }
  // The centre column maps onto itself under the rotation, so it has to be
  // folded against its own midpoint before the halves are mirrored.
  const cx = halfW - 1;
  const midY = (MAP_H - 1) / 2;
  for (let y = Math.ceil(midY); y < MAP_H; y++) {
    terrain[y * MAP_W + cx] = terrain[(MAP_H - 1 - y) * MAP_W + cx];
  }
  for (let y = 0; y < MAP_H; y++) {
    for (let x = halfW; x < MAP_W; x++) {
      terrain[y * MAP_W + x] = terrain[(MAP_H - 1 - y) * MAP_W + (MAP_W - 1 - x)];
    }
  }

  const map: MapData = { w: MAP_W, h: MAP_H, tile: TILE, terrain };
  // Clear landing pads around every base so spawns are never underwater.
  for (const b of baseSites()) carve(map, b.x, b.y, b.isHQ ? 2.6 : 1.9);
  return map;
}

function carve(map: MapData, wx: number, wy: number, tileRadius: number): void {
  const cx = wx / map.tile, cy = wy / map.tile;
  const r = Math.ceil(tileRadius);
  for (let y = Math.floor(cy - r); y <= cy + r; y++) {
    for (let x = Math.floor(cx - r); x <= cx + r; x++) {
      if (x < 0 || y < 0 || x >= map.w || y >= map.h) continue;
      if (dist(x + 0.5, y + 0.5, cx, cy) <= tileRadius) map.terrain[y * map.w + x] = 0;
    }
  }
}

interface Site { x: number; y: number; owner: PlayerId | -1; isHQ: boolean; }

/** Deterministic, seed-independent base sites: identical on every map so the
 *  opening of a match is learnable while the terrain between still varies. */
export function baseSites(): Site[] {
  const hqMirror = mirrorTile(...HQ_TILE);
  const sites: Site[] = [
    { ...tileCentre(...HQ_TILE), owner: 0, isHQ: true },
    { ...tileCentre(...hqMirror), owner: 1, isHQ: true },
    { ...tileCentre(...CENTRE_TILE), owner: -1, isHQ: false }, // contested centre
  ];
  for (const [tx, ty] of HALF_LAYOUT_TILES) {
    sites.push({ ...tileCentre(tx, ty), owner: -1, isHQ: false });
    sites.push({ ...tileCentre(...mirrorTile(tx, ty)), owner: -1, isHQ: false });
  }
  return sites;
}

function makeMech(owner: PlayerId, x: number, y: number, facing: number): Mech {
  return {
    owner, x, y, vx: 0, vy: 0, facing,
    mode: 'WALKER', morph: 0,
    hp: MECH_HP, fuel: MECH_FUEL, ammo: MECH_AMMO, cooldown: 0,
    carryingUnitId: -1, downTimer: 0, alive: true,
  };
}

export function createGame(seed: number): GameState {
  const map = generateMap(seed);
  const bases: Base[] = baseSites().map((s, i) => ({
    id: i,
    x: s.x, y: s.y,
    owner: s.owner,
    isHQ: s.isHQ,
    hp: s.isHQ ? HQ_HP : OUTPOST_HP,
    maxHp: s.isHQ ? HQ_HP : OUTPOST_HP,
    capture: s.owner === 0 ? 100 : s.owner === 1 ? -100 : 0,
    radius: s.isHQ ? HQ_RADIUS : BASE_RADIUS,
  }));

  const hq0 = bases[0], hq1 = bases[1];
  return {
    tick: 0,
    seed,
    rngState: seed >>> 0,
    map,
    bases,
    units: [],
    mechs: [
      makeMech(0, hq0.x + 22, hq0.y, 0),
      makeMech(1, hq1.x - 22, hq1.y, Math.PI),
    ],
    projectiles: [],
    effects: [],
    players: [
      { id: 0, money: STARTING_MONEY, spent: 0, unitsBuilt: 0, unitsLost: 0, kills: 0 },
      { id: 1, money: STARTING_MONEY, spent: 0, unitsBuilt: 0, unitsLost: 0, kills: 0 },
    ],
    nextEntityId: 1,
    winner: null,
    events: [],
  };
}

export const worldWidth = (m: MapData): number => m.w * m.tile;
export const worldHeight = (m: MapData): number => m.h * m.tile;

export function terrainAt(m: MapData, wx: number, wy: number): number {
  const tx = Math.floor(wx / m.tile), ty = Math.floor(wy / m.tile);
  if (tx < 0 || ty < 0 || tx >= m.w || ty >= m.h) return 2;
  return m.terrain[ty * m.w + tx];
}
