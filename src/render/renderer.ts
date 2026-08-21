import { clamp } from '../core/vec';
import * as C from '../sim/constants';
import { UNIT_TYPES } from '../sim/constants';
import type { Base, GameState, Mech, PlayerId, Projectile, Unit } from '../sim/types';
import { Camera } from './camera';
import {
  groundDisc, heightAt, ISO_Y, JET_ALT, prism, prismColors, projectedBounds,
  shade, shadow, terrainHeight, toScreen, type PrismColors,
} from './iso';
import { PAL, teamOf } from './palette';

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
  dpr = 1;
  cssW = 1; cssH = 1;

  constructor(private canvas: HTMLCanvasElement, public cam: Camera) {
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;
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
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, rr, rr * ISO_Y * 2, 0, 0, Math.PI * 2);
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
      ctx.beginPath();
      ctx.ellipse(deck.x, deck.y, r + 7, (r + 7) * ISO_Y * 2, 0,
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
    const col = teamOf(u.owner);
    const g = heightAt(state.map, u.x, u.y);
    const pc = prismColors(col.main);
    const dark = prismColors(shade(col.main, 0.55));
    const s = def.radius;

    shadow(ctx, u.x, u.y, g, s * 1.25, 0.34);

    switch (u.type) {
      case 'INFANTRY':
        prism(ctx, u.x, u.y, g, s * 0.55, s * 0.55, s * 1.7, u.facing, pc);
        break;
      case 'BIKE':
        prism(ctx, u.x, u.y, g, s * 1.2, s * 0.42, s * 1.0, u.facing, pc);
        break;
      case 'ARMOR':
        prism(ctx, u.x, u.y, g, s * 1.0, s * 0.72, s * 0.85, u.facing, pc);
        this.barrel(ctx, u.x, u.y, g + s * 0.85, u.facing, s * 1.7, col.ink);
        break;
      case 'TANK':
        prism(ctx, u.x, u.y, g, s * 1.1, s * 0.85, s * 0.55, u.facing, dark);
        prism(ctx, u.x, u.y, g + s * 0.55, s * 0.62, s * 0.58, s * 0.55, u.facing, pc);
        this.barrel(ctx, u.x, u.y, g + s * 0.95, u.facing, s * 2.1, col.ink);
        break;
      case 'AA':
        prism(ctx, u.x, u.y, g, s * 1.0, s * 0.68, s * 0.6, u.facing, pc);
        prism(ctx, u.x, u.y, g + s * 0.6, s * 0.34, s * 0.34, s * 0.9, u.facing, dark);
        break;
      case 'ARTILLERY':
        prism(ctx, u.x, u.y, g, s * 1.0, s * 0.66, s * 0.5, u.facing, dark);
        prism(ctx, u.x - Math.cos(u.facing) * s * 0.2, u.y - Math.sin(u.facing) * s * 0.2,
          g + s * 0.5, s * 0.7, s * 0.5, s * 0.5, u.facing, pc);
        this.barrel(ctx, u.x, u.y, g + s * 1.05, u.facing, s * 1.9, col.ink);
        break;
      case 'SUPPLY': {
        prism(ctx, u.x, u.y, g, s * 1.05, s * 0.7, s * 0.95, u.facing, pc);
        const top = toScreen(u.x, u.y, g + s * 0.95);
        ctx.fillStyle = '#e9f4ff';
        ctx.fillRect(top.x - 1.5, top.y - 4, 3, 8);
        ctx.fillRect(top.x - 4, top.y - 1.5, 8, 3);
        break;
      }
    }

    if (u.hp < def.hp) {
      const p = toScreen(u.x, u.y, g + s * 2.2);
      const w = def.radius * 2.6;
      const f = clamp(u.hp / def.hp, 0, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(p.x - w / 2, p.y, w, 3);
      ctx.fillStyle = f > 0.5 ? PAL.hpGood : f > 0.25 ? PAL.hpWarn : PAL.hpBad;
      ctx.fillRect(p.x - w / 2, p.y, w * f, 3);
    }
  }

  private barrel(
    ctx: CanvasRenderingContext2D, wx: number, wy: number, h: number,
    facing: number, len: number, colour: string,
  ): void {
    const a = toScreen(wx, wy, h);
    const b = toScreen(wx + Math.cos(facing) * len, wy + Math.sin(facing) * len, h);
    ctx.strokeStyle = colour;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.lineCap = 'butt';
  }

  // ----------------------------------------------------------------- mech ---
  private drawMech(
    ctx: CanvasRenderingContext2D, state: GameState, m: Mech, timeMs: number,
  ): void {
    const col = teamOf(m.owner);
    const jet = m.mode === 'JET';
    const morphing = m.morph > 0;
    const s = C.MECH_RADIUS;
    const g = heightAt(state.map, m.x, m.y);
    const alt = jet ? g + JET_ALT : g;
    const body = morphing ? prismColors('#f2f7ff') : prismColors(col.main);
    const dark = prismColors(shade(col.main, 0.5));

    // Shadow stays on the ground. Its distance from the body is the altitude
    // cue — the single most important readability decision in the renderer.
    shadow(ctx, m.x, m.y, g, s * (jet ? 0.9 : 1.15), jet ? 0.28 : 0.4);

    if (jet) {
      // A short mast connects the jet to its shadow so the eye tracks altitude.
      const a = toScreen(m.x, m.y, g), b = toScreen(m.x, m.y, alt);
      ctx.strokeStyle = 'rgba(120,180,255,0.16)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);

      prism(ctx, m.x, m.y, alt, s * 1.15, s * 0.42, s * 0.42, m.facing, body);
      // Swept wings.
      prism(ctx, m.x - Math.cos(m.facing) * s * 0.3, m.y - Math.sin(m.facing) * s * 0.3,
        alt + s * 0.1, s * 0.34, s * 1.15, s * 0.2, m.facing, dark);
      const nose = toScreen(m.x + Math.cos(m.facing) * s * 1.7,
        m.y + Math.sin(m.facing) * s * 1.7, alt + s * 0.2);
      const l = toScreen(m.x + Math.cos(m.facing + 2.5) * s * 0.9,
        m.y + Math.sin(m.facing + 2.5) * s * 0.9, alt + s * 0.2);
      const r = toScreen(m.x + Math.cos(m.facing - 2.5) * s * 0.9,
        m.y + Math.sin(m.facing - 2.5) * s * 0.9, alt + s * 0.2);
      ctx.fillStyle = body.top;
      ctx.beginPath();
      ctx.moveTo(nose.x, nose.y); ctx.lineTo(l.x, l.y); ctx.lineTo(r.x, r.y);
      ctx.closePath();
      ctx.fill();
    } else {
      // Legs, torso, shoulders, cannon.
      prism(ctx, m.x, m.y, g, s * 0.5, s * 0.7, s * 0.6, m.facing, dark);
      prism(ctx, m.x, m.y, g + s * 0.6, s * 0.62, s * 0.75, s * 0.95, m.facing, body);
      prism(ctx, m.x, m.y, g + s * 1.15, s * 0.42, s * 1.05, s * 0.3, m.facing, dark);
      this.barrel(ctx, m.x, m.y, g + s * 1.25, m.facing, s * 2.0, col.ink);
      const head = toScreen(m.x, m.y, g + s * 1.62);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(head.x, head.y, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }

    // Thruster plume.
    const thrust = Math.hypot(m.vx, m.vy) / (jet ? C.JET_MAX_SPEED : C.WALKER_MAX_SPEED);
    if (thrust > 0.12) {
      const back = toScreen(m.x - Math.cos(m.facing) * s * 1.2,
        m.y - Math.sin(m.facing) * s * 1.2, alt + s * 0.3);
      const tail = toScreen(m.x - Math.cos(m.facing) * (s * 2.2 + thrust * 22),
        m.y - Math.sin(m.facing) * (s * 2.2 + thrust * 22), alt + s * 0.3);
      const grad = ctx.createLinearGradient(back.x, back.y, tail.x, tail.y);
      grad.addColorStop(0, col.glow);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.strokeStyle = grad;
      ctx.lineWidth = 6 * thrust + 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(back.x, back.y); ctx.lineTo(tail.x, tail.y);
      ctx.stroke();
      ctx.lineCap = 'butt';
    }

    if (m.carryingUnitId >= 0) {
      const p = toScreen(m.x, m.y, alt);
      const rr = s + 10 + Math.sin(timeMs * 0.008) * 1.5;
      ctx.strokeStyle = col.glow;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, rr, rr * ISO_Y * 2, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (morphing) {
      const p = toScreen(m.x, m.y, alt);
      const rr = s + 16 - (m.morph / C.MORPH_TICKS) * 10;
      ctx.save();
      ctx.strokeStyle = '#ffffff';
      ctx.globalAlpha = m.morph / C.MORPH_TICKS;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, rr, rr * ISO_Y * 2, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
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
          ctx.beginPath();
          ctx.ellipse(p.x, p.y + 6, r * 1.3, r * 1.3 * ISO_Y * 2, 0, 0, Math.PI * 2);
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
          const r = 22 + t * 60;
          ctx.beginPath();
          ctx.ellipse(p.x, p.y, r, r * ISO_Y * 2, 0, 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
        case 'PICKUP': {
          ctx.globalAlpha = fade;
          ctx.strokeStyle = '#cfe3ff';
          ctx.lineWidth = 2;
          const r = 30 * (1 - t);
          ctx.beginPath();
          ctx.ellipse(p.x, p.y, r, r * ISO_Y * 2, 0, 0, Math.PI * 2);
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
