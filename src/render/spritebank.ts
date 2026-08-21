/**
 * Sprite compiler.
 *
 * Bakes every unit and every frame of the mech's transformation into pixel-art
 * atlases at load time, by software-rasterising the solids in `models.ts` with
 * hard edges and a fixed material ramp. Nothing is antialiased and nothing is
 * an imported asset: the whole sprite sheet is generated in about a fifth of a
 * second and costs zero download.
 *
 * Rasterising rather than drawing vectors each frame is what makes it read as
 * 16-bit. Canvas fills are antialiased, so shapes drawn live always look soft;
 * scanline-filling into an index buffer and then blitting with smoothing off
 * gives genuine chunky pixels and a real 1px silhouette outline.
 */
import { ISO_X, ISO_Y, shade } from './iso';
import { blendPose, MECH_JET, MECH_WALKER, UNIT_POSES, type Pose } from './models';
import { PAL, teamOf } from './palette';
import { BUILD_ORDER } from '../sim/constants';
import type { UnitTypeId } from '../sim/types';

export const DIRS = 16;
/** Frames baked across the walker -> jet fold. 0 is the walker, last is the jet. */
export const MORPH_FRAMES = 9;

/**
 * Sprite pixels per projected world unit. Baking at 2x and drawing at half
 * size means the art is pixel-exact whenever the camera sits at zoom 2 — which
 * is where the zoom snapping below puts it on every phone — while the world
 * keeps its true scale relative to terrain and bases.
 */
const S = 2;
const MECH_CELL = 96, MECH_AX = 48, MECH_AY = 74;
const UNIT_CELL = 64, UNIT_AX = 32, UNIT_AY = 46;
const OUTLINE = 0xff180f0a; // ABGR packed: near-black with a blue bias

function packHex(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (255 << 24) | (b << 16) | (g << 8) | r;   // little-endian RGBA
}

/** top / right-face / left-face shades for each material, tinted per team. */
function materials(team: 0 | 1): number[][] {
  const t = teamOf(team);
  const base = [
    t.main,                 // team primary
    shade(t.main, 0.58),    // team armour
    '#b9c6d6',              // light metal
    '#48546a',              // dark metal
    '#fff0bd',              // canopy / optics glow
    '#232a36',              // tread
  ];
  return base.map((b) => [packHex(b), packHex(shade(b, 0.74)), packHex(shade(b, 0.52))]);
}

/** Scanline fill of a convex polygon into an index buffer, no antialiasing.
 *  Thin quads are widened to a single pixel rather than vanishing — a gun
 *  barrel is one world unit across and has to survive. */
function fillPoly(
  buf: Uint32Array, cw: number, ch: number,
  xs: number[], ys: number[], colour: number,
): void {
  let top = Infinity, bot = -Infinity;
  for (const y of ys) { if (y < top) top = y; if (y > bot) bot = y; }
  let y0 = Math.round(top), y1 = Math.round(bot) - 1;
  if (y1 < y0) y1 = y0;
  y0 = Math.max(0, y0); y1 = Math.min(ch - 1, y1);

  const n = xs.length;
  for (let y = y0; y <= y1; y++) {
    const yc = y + 0.5;
    let xmin = Infinity, xmax = -Infinity;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a = ys[i], b = ys[j];
      if ((a <= yc && b > yc) || (b <= yc && a > yc)) {
        const x = xs[i] + (xs[j] - xs[i]) * ((yc - a) / (b - a));
        if (x < xmin) xmin = x;
        if (x > xmax) xmax = x;
      }
    }
    if (xmin > xmax) continue;
    let x0 = Math.round(xmin), x1 = Math.round(xmax) - 1;
    if (x1 < x0) x1 = x0;
    x0 = Math.max(0, x0); x1 = Math.min(cw - 1, x1);
    const row = y * cw;
    for (let x = x0; x <= x1; x++) buf[row + x] = colour;
  }
}

interface Solid { key: number; xs: number[][]; ys: number[][]; cols: number[]; }

/** Project one pose at one facing into a cell-sized index buffer. */
function rasterPose(
  pose: Pose, facing: number, cell: number, ax: number, ay: number, mats: number[][],
): Uint32Array {
  const buf = new Uint32Array(cell * cell);
  const cos = Math.cos(facing), sin = Math.sin(facing);
  const solids: Solid[] = [];

  for (const p of pose) {
    // Rotate the part's centre with the model.
    const cx = p.x * cos - p.y * sin;
    const cy = p.x * sin + p.y * cos;
    const cz = p.z;

    // Footprint corners, counter-clockwise, in world space.
    const foot = [
      [p.l, -p.w], [p.l, p.w], [-p.l, p.w], [-p.l, -p.w],
    ].map(([fx, fy]) => [cx + fx * cos - fy * sin, cy + fx * sin + fy * cos]);

    const zTop = cz + p.h, zBot = cz - p.h;
    const proj = (wx: number, wy: number, wz: number): [number, number] =>
      [ax + (wx - wy) * ISO_X * S, ay + ((wx + wy) * ISO_Y - wz) * S];

    const topPts = foot.map(([fx, fy]) => proj(fx, fy, zTop));
    const botPts = foot.map(([fx, fy]) => proj(fx, fy, zBot));

    const xs: number[][] = [], ys: number[][] = [], cols: number[] = [];
    // Side faces first; the top face paints over their seams.
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      const nx = foot[j][1] - foot[i][1];
      const ny = foot[i][0] - foot[j][0];
      if (nx + ny <= 0) continue;                       // faces away from the viewer
      xs.push([botPts[i][0], botPts[j][0], topPts[j][0], topPts[i][0]]);
      ys.push([botPts[i][1], botPts[j][1], topPts[j][1], topPts[i][1]]);
      cols.push(mats[p.m][nx > ny ? 1 : 2]);
    }
    xs.push(topPts.map((q) => q[0]));
    ys.push(topPts.map((q) => q[1]));
    cols.push(mats[p.m][0]);

    solids.push({ key: cx + cy + cz, xs, ys, cols });
  }

  // Painter's order. Parts are small and rarely interpenetrate, so centre
  // depth is enough and avoids a per-pixel z buffer.
  solids.sort((a, b) => a.key - b.key);
  for (const s of solids) {
    for (let i = 0; i < s.cols.length; i++) fillPoly(buf, cell, cell, s.xs[i], s.ys[i], s.cols[i]);
  }

  outline(buf, cell);
  return buf;
}

/** Grow a 1px dark silhouette outward. Classic sprite treatment, and it is what
 *  keeps a unit legible against terrain of any brightness. */
function outline(buf: Uint32Array, cell: number): void {
  const src = Uint32Array.from(buf);
  for (let y = 0; y < cell; y++) {
    for (let x = 0; x < cell; x++) {
      const i = y * cell + x;
      if (src[i] !== 0) continue;
      const up = y > 0 && src[i - cell] !== 0;
      const dn = y < cell - 1 && src[i + cell] !== 0;
      const lf = x > 0 && src[i - 1] !== 0;
      const rt = x < cell - 1 && src[i + 1] !== 0;
      if (up || dn || lf || rt) buf[i] = OUTLINE;
    }
  }
}

function makeAtlas(cols: number, rows: number, cell: number): {
  canvas: HTMLCanvasElement; data: ImageData; px: Uint32Array;
} {
  const canvas = document.createElement('canvas');
  canvas.width = cols * cell;
  canvas.height = rows * cell;
  const ctx = canvas.getContext('2d')!;
  const data = ctx.createImageData(canvas.width, canvas.height);
  return { canvas, data, px: new Uint32Array(data.data.buffer) };
}

function blitCell(
  dst: Uint32Array, dstW: number, cell: number,
  col: number, row: number, src: Uint32Array,
): void {
  const ox = col * cell, oy = row * cell;
  for (let y = 0; y < cell; y++) {
    dst.set(src.subarray(y * cell, y * cell + cell), (oy + y) * dstW + ox);
  }
}

export class SpriteBank {
  private mech!: HTMLCanvasElement;
  private units!: HTMLCanvasElement;
  private unitRow = new Map<UnitTypeId, number>();
  ready = false;
  bakeMs = 0;

  /** Exposed so the test harness can eyeball every baked frame at once. */
  get atlases(): { mech: HTMLCanvasElement; units: HTMLCanvasElement } {
    return { mech: this.mech, units: this.units };
  }

  bake(): void {
    if (this.ready) return;
    const t0 = performance.now();
    const mats: number[][][] = [materials(0), materials(1)];

    // ---- commander: 16 facings x MORPH_FRAMES x 2 teams ----
    const mech = makeAtlas(DIRS, MORPH_FRAMES * 2, MECH_CELL);
    for (let team = 0; team < 2; team++) {
      for (let f = 0; f < MORPH_FRAMES; f++) {
        const pose = blendPose(MECH_WALKER, MECH_JET, f / (MORPH_FRAMES - 1));
        for (let d = 0; d < DIRS; d++) {
          const buf = rasterPose(pose, (d / DIRS) * Math.PI * 2, MECH_CELL,
            MECH_AX, MECH_AY, mats[team]);
          blitCell(mech.px, mech.canvas.width, MECH_CELL, d, team * MORPH_FRAMES + f, buf);
        }
      }
    }
    mech.canvas.getContext('2d')!.putImageData(mech.data, 0, 0);
    this.mech = mech.canvas;

    // ---- ground units: 16 facings x 7 types x 2 teams ----
    const types = BUILD_ORDER;
    types.forEach((t, i) => this.unitRow.set(t, i));
    const units = makeAtlas(DIRS, types.length * 2, UNIT_CELL);
    for (let team = 0; team < 2; team++) {
      types.forEach((type, i) => {
        const pose = UNIT_POSES[type];
        for (let d = 0; d < DIRS; d++) {
          const buf = rasterPose(pose, (d / DIRS) * Math.PI * 2, UNIT_CELL,
            UNIT_AX, UNIT_AY, mats[team]);
          blitCell(units.px, units.canvas.width, UNIT_CELL, d,
            team * types.length + i, buf);
        }
      });
    }
    units.canvas.getContext('2d')!.putImageData(units.data, 0, 0);
    this.units = units.canvas;

    this.bakeMs = performance.now() - t0;
    this.ready = true;
  }

  private static dirIndex(facing: number): number {
    const step = (Math.PI * 2) / DIRS;
    return ((Math.round(facing / step) % DIRS) + DIRS) % DIRS;
  }

  drawUnit(
    ctx: CanvasRenderingContext2D, type: UnitTypeId, owner: 0 | 1,
    facing: number, px: number, py: number,
  ): void {
    const row = owner * this.unitRow.size + (this.unitRow.get(type) ?? 0);
    const col = SpriteBank.dirIndex(facing);
    ctx.drawImage(
      this.units, col * UNIT_CELL, row * UNIT_CELL, UNIT_CELL, UNIT_CELL,
      Math.round(px) - UNIT_AX / S, Math.round(py) - UNIT_AY / S,
      UNIT_CELL / S, UNIT_CELL / S,
    );
  }

  /** `frame` is 0 (walker) .. MORPH_FRAMES-1 (jet). */
  drawMech(
    ctx: CanvasRenderingContext2D, owner: 0 | 1, frame: number,
    facing: number, px: number, py: number,
  ): void {
    const f = Math.max(0, Math.min(MORPH_FRAMES - 1, Math.round(frame)));
    const row = owner * MORPH_FRAMES + f;
    const col = SpriteBank.dirIndex(facing);
    ctx.drawImage(
      this.mech, col * MECH_CELL, row * MECH_CELL, MECH_CELL, MECH_CELL,
      Math.round(px) - MECH_AX / S, Math.round(py) - MECH_AY / S,
      MECH_CELL / S, MECH_CELL / S,
    );
  }
}

void PAL;
