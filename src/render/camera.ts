import { clamp, lerp } from '../core/vec';

export class Camera {
  x = 0; y = 0; zoom = 0.8;
  private shake = 0;
  private shakeX = 0; private shakeY = 0;

  constructor(public viewW = 1, public viewH = 1) {}

  resize(w: number, h: number): void {
    this.viewW = w; this.viewH = h;
    // Show a fixed slice of the world regardless of device, so a small phone
    // is not a competitive disadvantage — it just renders smaller.
    const target = 900;
    this.zoom = clamp(Math.max(w, h * 1.9) / target, 0.5, 1.9);
  }

  follow(tx: number, ty: number, worldW: number, worldH: number, snap = false): void {
    const k = snap ? 1 : 0.14;
    this.x = lerp(this.x, tx, k);
    this.y = lerp(this.y, ty, k);
    const halfW = this.viewW / 2 / this.zoom;
    const halfH = this.viewH / 2 / this.zoom;
    this.x = worldW <= halfW * 2 ? worldW / 2 : clamp(this.x, halfW, worldW - halfW);
    this.y = worldH <= halfH * 2 ? worldH / 2 : clamp(this.y, halfH, worldH - halfH);
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
