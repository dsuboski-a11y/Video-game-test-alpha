import { clamp, lerp } from '../core/vec';

export interface Bounds { x0: number; y0: number; x1: number; y1: number; }

export class Camera {
  x = 0; y = 0; zoom = 0.8;
  private shake = 0;
  private shakeX = 0; private shakeY = 0;

  constructor(public viewW = 1, public viewH = 1) {}

  resize(w: number, h: number): void {
    this.viewW = w; this.viewH = h;
    // Show a fixed slice of the world regardless of device, so a small phone
    // is not a competitive disadvantage — it just renders smaller. The target
    // is in *projected* units, which are roughly half world units on the x
    // axis once the dimetric transform is applied.
    // Sprites are baked at one pixel per projected unit, so the zoom is snapped
    // to quarter steps: a fractional scale makes pixel art shimmer as it moves.
    // Sprites are baked at two pixels per projected unit, so the zoom snaps to
    // whole steps: a fractional scale makes pixel art shimmer as it scrolls,
    // and zoom 2 lands the baked pixels exactly on screen pixels.
    // Sprites are baked at two pixels per projected unit and drawn at half
    // size, so at zoom 1 one baked pixel lands on one *device* pixel of a
    // retina phone — crisp where it matters, and integer-scaled elsewhere.
    const target = 900;
    const raw = clamp(Math.max(w, h * 2.4) / target, 1, 3);
    this.zoom = Math.round(raw);
  }

  /** Follow a point in projected space, clamped to the map's projected box. */
  follow(tx: number, ty: number, b: Bounds, snap = false): void {
    const k = snap ? 1 : 0.14;
    this.x = lerp(this.x, tx, k);
    this.y = lerp(this.y, ty, k);
    const halfW = this.viewW / 2 / this.zoom;
    const halfH = this.viewH / 2 / this.zoom;
    const w = b.x1 - b.x0, h = b.y1 - b.y0;
    this.x = w <= halfW * 2 ? (b.x0 + b.x1) / 2 : clamp(this.x, b.x0 + halfW, b.x1 - halfW);
    this.y = h <= halfH * 2 ? (b.y0 + b.y1) / 2 : clamp(this.y, b.y0 + halfH, b.y1 - halfH);
  }

  addShake(amount: number): void { this.shake = Math.min(18, this.shake + amount); }

  tickShake(rnd: () => number): void {
    if (this.shake <= 0.01) { this.shakeX = this.shakeY = 0; this.shake = 0; return; }
    this.shakeX = (rnd() - 0.5) * this.shake;
    this.shakeY = (rnd() - 0.5) * this.shake;
    this.shake *= 0.86;
  }

  /** Apply as the canvas transform: world coords in, screen pixels out. */
  applyTo(ctx: CanvasRenderingContext2D): void {
    ctx.translate(this.viewW / 2 + this.shakeX, this.viewH / 2 + this.shakeY);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.x, -this.y);
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return {
      x: (sx - this.viewW / 2) / this.zoom + this.x,
      y: (sy - this.viewH / 2) / this.zoom + this.y,
    };
  }

  get bounds() {
    const hw = this.viewW / 2 / this.zoom + 64;
    const hh = this.viewH / 2 / this.zoom + 64;
    return { x0: this.x - hw, y0: this.y - hh, x1: this.x + hw, y1: this.y + hh };
  }
}
