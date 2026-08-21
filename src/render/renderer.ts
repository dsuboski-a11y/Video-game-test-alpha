import { clamp } from '../core/vec';
import * as C from '../sim/constants';
import { UNIT_TYPES } from '../sim/constants';
import type { Base, GameState, Mech, PlayerId, Projectile, Unit } from '../sim/types';
import { Camera } from './camera';
import {
  groundDisc, heightAt, isoEllipse, JET_ALT, prism, prismColors, projectedBounds,
  shade, shadow, terrainHeight, toScreen, type PrismColors,
} from './iso';
import { PAL, teamOf } from './palette';
import { MORPH_FRAMES, SpriteBank } from './spritebank';

/** Side-face colours for each terrain type, derived once from the top shades so
 *  the whole map is lit by the same imaginary sun. */
const TERRAIN_SIDES = [
  { right: shade('#2c3d30', 0.62), left: shade('#2c3d30', 0.40) },  // plains
  { right: shade('#453e34', 0.62), left: shade('#453e34', 0.40) },  // rough
  { right: shade('#154577', 0.72), left: shade('#154577', 0.52) },  // water
];

/** Painting order for the three elevation bands: low ground first, so raised
 *  terrain correctly overlaps what sits behind and below it. */
const HEIGHT_ORDER = [2, 0, 1] as const; // water, plains, rough

interface Drawable { depth: number; draw(): void; }

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  readonly sprites = new SpriteBank();
  dpr = 1;
  cssW = 1; cssH = 1;

  constructor(private canvas: HTMLCanvasElement, public cam: Camera) {
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;
    this.sprites.bake();
  }

  resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.cssW = w; this.cssH = h;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.cam.resize(w, h);
  }

  draw(state: GameState, me: PlayerId, timeMs: number): void {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // Everything downstream is pixel art; smoothing would turn it to mush.
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = PAL.bg;
    ctx.fillRect(0, 0, this.cssW, this.cssH);

    ctx.save();
    this.cam.applyTo(ctx);

    this.drawTerrain(state, timeMs);
    for (const b of state.bases) this.drawBase(ctx, b, timeMs);

    // One depth-sorted pass over everything that stands on the ground, so a
    // tank in front of a mech actually occludes it.
    const items: Drawable[] = [];
    for (const u of state.units) {
      if (u.carried) continue;
      items.push({ depth: u.x + u.y, draw: () => this.drawUnit(ctx, state, u) });
    }
    for (const m of state.mechs) {
      if (!m.alive) continue;
      items.push({ depth: m.x + m.y + 1, draw: () => this.drawMech(ctx, state, m, timeMs) });
    }
    items.sort((a, b) => a.depth - b.depth);
    for (const it of items) it.draw();

    for (const p of state.projectiles) this.drawProjectile(ctx, state, p);
    this.drawEffects(state);

    ctx.restore();
    this.drawEdgeMarkers(state, me);
  }

  // ------------------------------------------------------------- terrain ---
  private drawTerrain(state: GameState, timeMs: number): void {
    const ctx = this.ctx;
    const { map } = state;
    const t = map.tile;
    const b = this.cam.bounds;

    // Visible-tile test in projected space. Cheap enough to run over the whole
    // grid, and far simpler than inverse-projecting the view quad.
    const visible: number[] = [];
    for (let ty = 0; ty < map.h; ty++) {
      for (let tx = 0; tx < map.w; tx++) {
        const p = toScreen((tx + 0.5) * t, (ty + 0.5) * t);
        if (p.x < b.x0 - t || p.x > b.x1 + t || p.y < b.y0 - t * 2 || p.y > b.y1 + t) continue;
        visible.push(ty * map.w + tx);
      }
    }

    const tops = [PAL.plains, PAL.rough, PAL.water];

    for (const kind of HEIGHT_ORDER) {
      const h = terrainHeight(kind);
      const sides = TERRAIN_SIDES[kind];

      // Side faces, batched into two fills per terrain band.
      for (const dir of [0, 1] as const) {
        ctx.fillStyle = dir === 0 ? sides.right : sides.left;
        ctx.beginPath();
        let any = false;
        for (const idx of visible) {
          if (map.terrain[idx] !== kind) continue;
          const tx = idx % map.w, ty = (idx / map.w) | 0;
          // +x face on one pass, +y face on the other: those are the two edges
          // of a diamond that ever point at the viewer.
          const nx = dir === 0 ? tx + 1 : tx;
          const ny = dir === 0 ? ty : ty + 1;
          const nh = (nx >= map.w || ny >= map.h)
            ? h - 14
            : terrainHeight(map.terrain[ny * map.w + nx]);
          if (nh >= h) continue;
          const x0 = tx * t, y0 = ty * t, x1 = x0 + t, y1 = y0 + t;
          const [a, c] = dir === 0
            ? [{ x: x1, y: y0 }, { x: x1, y: y1 }]
            : [{ x: x1, y: y1 }, { x: x0, y: y1 }];
          const ta = toScreen(a.x, a.y, h), tc = toScreen(c.x, c.y, h);
          const ba = toScreen(a.x, a.y, nh), bc = toScreen(c.x, c.y, nh);
          ctx.moveTo(ta.x, ta.y); ctx.lineTo(tc.x, tc.y);
          ctx.lineTo(bc.x, bc.y); ctx.lineTo(ba.x, ba.y);
          ctx.closePath();
          any = true;
        }
        if (any) ctx.fill();
      }

      // Top faces, batched into one fill per shade.
      for (let v = 0; v < 4; v++) {
        ctx.fillStyle = tops[kind][v];
        ctx.beginPath();
        let any = false;
        for (const idx of visible) {
          if (map.terrain[idx] !== kind) continue;
          const tx = idx % map.w, ty = (idx / map.w) | 0;
          let hsh = (tx * 374761393 + ty * 668265263) | 0;
          hsh = (hsh ^ (hsh >>> 13)) * 1274126177;
          if (((hsh >>> 16) & 3) !== v) continue;
          const x0 = tx * t, y0 = ty * t, x1 = x0 + t, y1 = y0 + t;
          const p0 = toScreen(x0, y0, h), p1 = toScreen(x1, y0, h);
          const p2 = toScreen(x1, y1, h), p3 = toScreen(x0, y1, h);
          ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y); ctx.lineTo(p3.x, p3.y);
          ctx.closePath();
          any = true;
        }
        if (any) ctx.fill();
      }
    }

    // Water shimmer.
    ctx.save();
    ctx.globalAlpha = 0.13;
    ctx.strokeStyle = '#7fd4ff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const phase = timeMs * 0.0011;
    const wh = terrainHeight(2);
    for (const idx of visible) {
      if (map.terrain[idx] !== 2) continue;
      const tx = idx % map.w, ty = (idx / map.w) | 0;
      const off = Math.sin(phase + tx * 0.6 + ty * 0.4) * 6;
      const p = toScreen(tx * t + 8, ty * t + t * 0.5 + off, wh);
      const q = toScreen(tx * t + t - 8, ty * t + t * 0.5 + off, wh);
      ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y);
    }
    ctx.stroke();
    ctx.restore();

    // Ground grain on the top faces.
    ctx.save();
    ctx.fillStyle = PAL.speck;
    for (const idx of visible) {
      const kind = map.terrain[idx];
      if (kind === 2) continue;
      const tx = idx % map.w, ty = (idx / map.w) | 0;
      let hsh = (tx * 2246822519 + ty * 3266489917) | 0;
      hsh = (hsh ^ (hsh >>> 15)) * 668265263;
      if (((hsh >>> 8) & 3) !== 0) continue;
      const p = toScreen(tx * t + ((hsh >>> 10) & 31) + 8, ty * t + ((hsh >>> 16) & 31) + 8,
        terrainHeight(kind));
      ctx.fillRect(p.x, p.y, 3, 2);
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- bases ---
  private drawBase(ctx: CanvasRenderingContext2D, b: Base, timeMs: number): void {
    const col = b.owner === -1 ? null : teamOf(b.owner);
    const main = col?.main ?? PAL.neutral;
    const r = b.radius;
    const ground = 0;
    const lift = b.isHQ ? 16 : 9;

    // Territory glow on the ground plane.
    if (b.owner !== -1) {
      const p = toScreen(b.x, b.y, ground);
      const rr = r * 3.2;
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rr);
      g.addColorStop(0, col!.glow);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.save();
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = g;
      isoEllipse(ctx, p.x, p.y, rr);
      ctx.fill();
      ctx.restore();
    }

    // Raised pad: a dark plinth with a lit deck on top.
    ctx.fillStyle = shade(main, 0.26);
    groundDisc(ctx, b.x, b.y, ground, r);
    ctx.fill();
    ctx.fillStyle = shade(main, 0.14);
    groundDisc(ctx, b.x, b.y, ground + lift, r);
    ctx.fill();
    ctx.strokeStyle = main;
    ctx.lineWidth = 2.5;
    groundDisc(ctx, b.x, b.y, ground + lift, r);
    ctx.stroke();

    // Pylons around the rim. Cheap, and they turn a flat disc into a place.
    const pylons = b.isHQ ? 6 : 4;
    for (let i = 0; i < pylons; i++) {
      const a = (i / pylons) * Math.PI * 2 + (b.isHQ ? 0 : Math.PI / 4);
      prism(ctx, b.x + Math.cos(a) * r * 0.82, b.y + Math.sin(a) * r * 0.82,
        ground + lift, 3.5, 3.5, b.isHQ ? 16 : 11, 0, prismColors(shade(main, 0.72)));
    }

    const deck = toScreen(b.x, b.y, ground + lift);

    if (b.isHQ) {
      // A tower the player can pick out from across the map.
      prism(ctx, b.x, b.y, ground + lift, r * 0.30, r * 0.30, 42, 0,
        prismColors(shade(main, 0.34)));
      prism(ctx, b.x, b.y, ground + lift + 42, r * 0.44, r * 0.44, 8, Math.PI / 4,
        prismColors(main));
      ctx.save();
      ctx.strokeStyle = main;
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = 3;
      const a = timeMs * 0.0004;
      for (let i = 0; i < 3; i++) {
        const ang = a + (i * Math.PI * 2) / 3;
        const p0 = toScreen(b.x + Math.cos(ang) * r * 0.4, b.y + Math.sin(ang) * r * 0.4, ground + lift);
        const p1 = toScreen(b.x + Math.cos(ang) * r * 0.92, b.y + Math.sin(ang) * r * 0.92, ground + lift);
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y);
        ctx.stroke();
      }
      ctx.restore();
    } else {
      ctx.save();
      ctx.globalAlpha = b.owner === -1 ? 0.22 : 0.36;
      ctx.fillStyle = main;
      groundDisc(ctx, b.x, b.y, ground + lift, r * 0.5);
      ctx.fill();
      ctx.restore();
      if (b.owner === -1) {
        const pulse = 0.5 + 0.5 * Math.sin(timeMs * 0.0022 + b.id);
        ctx.save();
        ctx.strokeStyle = PAL.neutral;
        ctx.globalAlpha = 0.2 + pulse * 0.35;
        ctx.lineWidth = 2;
        groundDisc(ctx, b.x, b.y, ground + lift, r + 4 + pulse * 5);
        ctx.stroke();
        ctx.restore();
      }
    }

    // Capture progress ring, drawn flat on the deck.
    if (!b.isHQ && b.capture !== 0) {
      const frac = Math.abs(b.capture) / C.CAPTURE_FULL;
      ctx.save();
      ctx.strokeStyle = teamOf(b.capture > 0 ? 0 : 1).main;
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      isoEllipse(ctx, deck.x, deck.y, r + 7,
        -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
      ctx.stroke();
      ctx.restore();
    }

    if (b.hp < b.maxHp) {
      const w = r * 1.8;
      const f = b.hp / b.maxHp;
      const y = deck.y - (b.isHQ ? 74 : 30);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(deck.x - w / 2, y, w, 5);
      ctx.fillStyle = f > 0.5 ? PAL.hpGood : f > 0.22 ? PAL.hpWarn : PAL.hpBad;
      ctx.fillRect(deck.x - w / 2, y, w * f, 5);
    }
  }

  // ---------------------------------------------------------------- units ---
  private drawUnit(ctx: CanvasRenderingContext2D, state: GameState, u: Unit): void {
    const def = UNIT_TYPES[u.type];
    const g = heightAt(state.map, u.x, u.y);
    shadow(ctx, u.x, u.y, g, def.radius * 1.2, 0.34);

    const p = toScreen(u.x, u.y, g);
    this.sprites.drawUnit(ctx, u.type, u.owner, u.facing, p.x, p.y);

    if (u.hp < def.hp) {
      const bar = toScreen(u.x, u.y, g + def.radius * 2.1);
      const w = def.radius * 2.4;
      const f = clamp(u.hp / def.hp, 0, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(Math.round(bar.x - w / 2), Math.round(bar.y), w, 3);
      ctx.fillStyle = f > 0.5 ? PAL.hpGood : f > 0.25 ? PAL.hpWarn : PAL.hpBad;
      ctx.fillRect(Math.round(bar.x - w / 2), Math.round(bar.y), w * f, 3);
    }
  }

  // ----------------------------------------------------------------- mech ---
  private drawMech(
    ctx: CanvasRenderingContext2D, state: GameState, m: Mech, timeMs: number,
  ): void {
    const col = teamOf(m.owner);
    const s = C.MECH_RADIUS;
    const g = heightAt(state.map, m.x, m.y);

    // How far through the walker -> jet fold are we, as 0 (walker) to 1 (jet)?
    // The simulation flips `mode` at the halfway point, so which direction we
    // are folding has to be recovered from that plus the remaining timer.
    let p: number;
    if (m.morph > 0) {
      const t = 1 - m.morph / C.MORPH_TICKS;
      const half = C.MORPH_TICKS / 2;
      const becomingJet = m.morph > half ? m.mode !== 'JET' : m.mode === 'JET';
      p = becomingJet ? t : 1 - t;
    } else {
      p = m.mode === 'JET' ? 1 : 0;
    }
    // Altitude rides the same curve, so the machine lifts off as it folds.
    const alt = g + JET_ALT * p;

    shadow(ctx, m.x, m.y, g, s * (0.75 + 0.4 * (1 - p)), 0.4 - 0.12 * p);

    if (p > 0.05) {
      // A dotted mast to its own shadow: the altitude cue, and the reason you
      // never need a UI element to know which layer someone is fighting on.
      const a = toScreen(m.x, m.y, g), b = toScreen(m.x, m.y, alt);
      ctx.strokeStyle = `rgba(120,180,255,${0.18 * p})`;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const body = toScreen(m.x, m.y, alt);

    // Thruster plume, behind the hull.
    const thrust = Math.hypot(m.vx, m.vy) /
      (m.mode === 'JET' ? C.JET_MAX_SPEED : C.WALKER_MAX_SPEED);
    if (thrust > 0.12) {
      const back = toScreen(m.x - Math.cos(m.facing) * s * 1.1,
        m.y - Math.sin(m.facing) * s * 1.1, alt + 4);
      const tail = toScreen(m.x - Math.cos(m.facing) * (s * 2.0 + thrust * 22),
        m.y - Math.sin(m.facing) * (s * 2.0 + thrust * 22), alt + 4);
      const grad = ctx.createLinearGradient(back.x, back.y, tail.x, tail.y);
      grad.addColorStop(0, col.glow);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.strokeStyle = grad;
      ctx.lineWidth = 5 * thrust + 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(back.x, back.y); ctx.lineTo(tail.x, tail.y);
      ctx.stroke();
      ctx.lineCap = 'butt';
    }

    this.sprites.drawMech(ctx, m.owner, p * (MORPH_FRAMES - 1), m.facing, body.x, body.y);

    if (m.morph > 0) {
      // A ring that contracts through the fold, so a transformation reads even
      // at the edge of the screen.
      const k = Math.sin((1 - m.morph / C.MORPH_TICKS) * Math.PI);
      ctx.save();
      ctx.globalAlpha = k * 0.85;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      const rr = s * (0.9 + 2.0 * (1 - k));
      isoEllipse(ctx, body.x, body.y, rr);
      ctx.stroke();
      ctx.restore();
    }

    if (m.carryingUnitId >= 0) {
      const rr = s + 14 + Math.sin(timeMs * 0.008) * 2;
      ctx.strokeStyle = col.glow;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      isoEllipse(ctx, body.x, body.y, rr);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // ---------------------------------------------------------- projectiles ---
  private drawProjectile(
    ctx: CanvasRenderingContext2D, state: GameState, p: Projectile,
  ): void {
    const col = teamOf(p.owner);
    const g = heightAt(state.map, p.x, p.y);
    // Air-only fire flies at jet altitude; everything else skims the ground.
    const h = g + (p.hitsGround ? 16 : JET_ALT * 0.85);
    const len = p.kind === 'BEAM' ? 26 : p.kind === 'SHELL' ? 15 : 11;
    const m = Math.hypot(p.vx, p.vy) || 1;
    const head = toScreen(p.x, p.y, h);
    const tail = toScreen(p.x - (p.vx / m) * len, p.y - (p.vy / m) * len, h);

    ctx.save();
    ctx.lineCap = 'round';
    const grad = ctx.createLinearGradient(head.x, head.y, tail.x, tail.y);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.4, col.main);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.strokeStyle = grad;
    ctx.lineWidth = p.kind === 'SHELL' ? 3.5 : p.kind === 'MISSILE' ? 3 : 2;
    ctx.beginPath();
    ctx.moveTo(head.x, head.y); ctx.lineTo(tail.x, tail.y);
    ctx.stroke();
    ctx.restore();
  }

  // -------------------------------------------------------------- effects ---
  private drawEffects(state: GameState): void {
    const ctx = this.ctx;
    ctx.save();
    for (const e of state.effects) {
      const t = e.age / e.life;
      const fade = 1 - t;
      const g = heightAt(state.map, e.x, e.y);
      const p = toScreen(e.x, e.y, g + 10);
      switch (e.kind) {
        case 'EXPLOSION': {
          const r = (7 + t * 30) * e.scale;
          ctx.globalAlpha = fade * 0.9;
          const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
          grad.addColorStop(0, '#fff6d8');
          grad.addColorStop(0.35, '#ffb43c');
          grad.addColorStop(1, 'rgba(255,60,0,0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = fade * 0.6;
          ctx.strokeStyle = '#ffd9a0';
          ctx.lineWidth = 2 * fade;
          isoEllipse(ctx, p.x, p.y + 6, r * 1.8);
          ctx.stroke();
          break;
        }
        case 'SPARK':
          ctx.globalAlpha = fade;
          ctx.fillStyle = '#ffe9a8';
          ctx.beginPath();
          ctx.arc(p.x, p.y, 2.6 * e.scale * (1 - t * 0.5), 0, Math.PI * 2);
          ctx.fill();
          break;
        case 'CAPTURE': {
          ctx.globalAlpha = fade * 0.8;
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 3 * fade;
          isoEllipse(ctx, p.x, p.y, 30 + t * 85);
          ctx.stroke();
          break;
        }
        case 'PICKUP': {
          ctx.globalAlpha = fade;
          ctx.strokeStyle = '#cfe3ff';
          ctx.lineWidth = 2;
          isoEllipse(ctx, p.x, p.y, 42 * (1 - t));
          ctx.stroke();
          break;
        }
        case 'REPAIR':
          ctx.globalAlpha = fade;
          ctx.fillStyle = PAL.hpGood;
          ctx.fillRect(p.x - 1, p.y - 18 - t * 10, 2, 6);
          ctx.fillRect(p.x - 3, p.y - 16 - t * 10, 6, 2);
          break;
      }
    }
    ctx.restore();
  }

  private drawEdgeMarkers(state: GameState, me: PlayerId): void {
    const ctx = this.ctx;
    const b = this.cam.bounds;
    const foe = me === 0 ? 1 : 0;
    const marks: { p: { x: number; y: number }; col: string }[] = [];
    const outside = (p: { x: number; y: number }) =>
      p.x < b.x0 || p.x > b.x1 || p.y < b.y0 || p.y > b.y1;

    const em = state.mechs[foe];
    if (em.alive) {
      const p = toScreen(em.x, em.y);
      if (outside(p)) marks.push({ p, col: teamOf(foe).main });
    }
    for (const base of state.bases) {
      if (base.owner !== me || base.hp > base.maxHp * 0.75) continue;
      const p = toScreen(base.x, base.y);
      if (outside(p)) marks.push({ p, col: PAL.hpBad });
    }

    const cx = this.cssW / 2, cy = this.cssH / 2;
    const pad = 26;
    for (const mk of marks) {
      const dx = mk.p.x - this.cam.x, dy = mk.p.y - this.cam.y;
      const ang = Math.atan2(dy, dx);
      const rx = cx - pad, ry = cy - pad;
      const scale = Math.min(
        rx / Math.abs(Math.cos(ang) || 1e-4), ry / Math.abs(Math.sin(ang) || 1e-4));
      ctx.save();
      ctx.translate(cx + Math.cos(ang) * scale, cy + Math.sin(ang) * scale);
      ctx.rotate(ang);
      ctx.fillStyle = mk.col;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.moveTo(10, 0); ctx.lineTo(-6, -7); ctx.lineTo(-6, 7);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }
}

export { projectedBounds, toScreen, type PrismColors };
