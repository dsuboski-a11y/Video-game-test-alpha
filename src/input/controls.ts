import { clamp } from '../core/vec';

export interface RawInput {
  mx: number; my: number;
  fire: boolean;
  transformEdge: boolean;
  grabEdge: boolean;
}

/**
 * Twin-thumb controls: a floating stick under the left thumb and a button
 * cluster under the right. The stick's origin is wherever the thumb lands,
 * because on a phone you never look at your left hand.
 */
export class Controls {
  private stickId = -1;
  private originX = 0; private originY = 0;
  private curX = 0; private curY = 0;
  private radius = 52;

  private held = new Set<string>();
  private edges = new Set<string>();
  private keys = new Set<string>();

  private stickEl: HTMLDivElement;
  private knobEl: HTMLDivElement;
  /** Fraction of the screen width reserved for the movement thumb. */
  private stickZone = 0.5;

  constructor(private root: HTMLElement) {
    // The HUD root is pointer-events:none so the canvas shows through, which
    // means empty screen never delivers a pointerdown to it. The stick needs
    // its own always-on capture layer, stacked below every HUD control so the
    // buttons still win the hit test.
    const layer = document.createElement('div');
    layer.className = 'touchlayer';
    root.appendChild(layer);

    this.stickEl = document.createElement('div');
    this.stickEl.className = 'stick';
    this.knobEl = document.createElement('div');
    this.knobEl.className = 'knob';
    this.stickEl.appendChild(this.knobEl);
    this.stickEl.style.display = 'none';
    root.appendChild(this.stickEl);

    layer.addEventListener('pointerdown', this.onDown, { passive: false });
    // Move and release go on the window: a thumb that slides off the layer,
    // or lifts over a button, must still steer and still release.
    window.addEventListener('pointermove', this.onMove, { passive: false });
    window.addEventListener('pointerup', this.onUp, { passive: false });
    window.addEventListener('pointercancel', this.onUp, { passive: false });
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Wire a HUD button. `hold` buttons report while pressed; the rest fire
   *  a single edge per press so a fat thumb cannot double-transform. */
  bindButton(el: HTMLElement, name: string, hold = false): void {
    const press = (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      el.setPointerCapture?.(e.pointerId);
      el.classList.add('down');
      if (hold) this.held.add(name); else this.edges.add(name);
      if (navigator.vibrate) navigator.vibrate(hold ? 4 : 10);
    };
    const release = (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      el.classList.remove('down');
      if (hold) this.held.delete(name);
    };
    el.addEventListener('pointerdown', press);
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener('pointerleave', release);
  }

  pressVirtual(name: string): void { this.edges.add(name); }
  isHeld(name: string): boolean { return this.held.has(name); }

  /** Consume and clear the pending edge for `name`. */
  takeEdge(name: string): boolean {
    if (this.edges.has(name)) { this.edges.delete(name); return true; }
    return false;
  }

  private onDown = (e: PointerEvent): void => {
    const w = this.root.clientWidth;
    if (e.clientX > w * this.stickZone) return;      // right side belongs to buttons
    if (this.stickId !== -1) return;
    e.preventDefault();
    this.stickId = e.pointerId;
    this.originX = this.curX = e.clientX;
    this.originY = this.curY = e.clientY;
    this.stickEl.style.display = 'block';
    this.stickEl.style.left = `${this.originX}px`;
    this.stickEl.style.top = `${this.originY}px`;
    this.knobEl.style.transform = 'translate(-50%,-50%)';
  };

  private onMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.stickId) return;
    e.preventDefault();
    this.curX = e.clientX; this.curY = e.clientY;
    let dx = this.curX - this.originX, dy = this.curY - this.originY;
    const d = Math.hypot(dx, dy);
    // Drag the origin along if the thumb travels past the ring, so the stick
    // never runs out of throw mid-manoeuvre.
    if (d > this.radius) {
      this.originX += (dx / d) * (d - this.radius);
      this.originY += (dy / d) * (d - this.radius);
      this.stickEl.style.left = `${this.originX}px`;
      this.stickEl.style.top = `${this.originY}px`;
      dx = this.curX - this.originX; dy = this.curY - this.originY;
    }
    this.knobEl.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  };

  private onUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.stickId) return;
    this.stickId = -1;
    this.stickEl.style.display = 'none';
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) { this.keys.add(e.code); return; }
    this.keys.add(e.code);
    if (e.code === 'KeyK' || e.code === 'ShiftLeft') this.edges.add('transform');
    if (e.code === 'KeyL' || e.code === 'Space') { this.edges.add('grab'); e.preventDefault(); }
    if (e.code === 'KeyB' || e.code === 'Tab') { this.edges.add('build'); e.preventDefault(); }
    if (e.code === 'Escape') this.edges.add('cancel');
  };

  private onKeyUp = (e: KeyboardEvent): void => { this.keys.delete(e.code); };

  read(): RawInput {
    let mx = 0, my = 0;
    if (this.stickId !== -1) {
      mx = clamp((this.curX - this.originX) / this.radius, -1, 1);
      my = clamp((this.curY - this.originY) / this.radius, -1, 1);
      // Small deadzone: a resting thumb should not creep the mech.
      if (Math.hypot(mx, my) < 0.14) { mx = 0; my = 0; }
    } else {
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) mx -= 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) mx += 1;
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) my -= 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) my += 1;
    }
    const fire = this.held.has('fire') || this.keys.has('KeyJ') || this.keys.has('Enter');
    return {
      mx, my, fire,
      transformEdge: this.takeEdge('transform'),
      grabEdge: this.takeEdge('grab'),
    };
  }
}
