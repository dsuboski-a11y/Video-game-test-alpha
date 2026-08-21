import { clamp } from '../core/vec';
import * as C from '../sim/constants';
import { UNIT_TYPES } from '../sim/constants';
import type { Base, GameState, Mech, PlayerId, Projectile, Unit } from '../sim/types';
import { worldHeight, worldWidth } from '../sim/world';
import { Camera } from './camera';
import { PAL, teamOf } from './palette';

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
    // Cap the backing store on very dense screens: an iPhone at dpr 3 is a lot
    // of fill for a 60fps target, and 2x is visually indistinguishable here.
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
    this.drawBaseFloors(state);
    for (const b of state.bases) this.drawBase(ctx, b, timeMs);
    for (const u of state.units) if (!u.carried) this.drawUnit(ctx, u);
    for (const m of state.mechs) this.drawMech(ctx, m, timeMs);
    for (const p of state.projectiles) this.drawProjectile(ctx, p);
    this.drawEffects(state);

    ctx.restore();
    this.drawEdgeMarkers(state, me);
  }

  // ------------------------------------------------------------- terrain ---
  private drawTerrain(state: GameState, timeMs: number): void {
    const ctx = this.ctx;
    const { map } = state;
    const b = this.cam.bounds;
    const t = map.tile;
    const x0 = clamp(Math.floor(b.x0 / t), 0, map.w - 1);
    const x1 = clamp(Math.ceil(b.x1 / t), 0, map.w);
    const y0 = clamp(Math.floor(b.y0 / t), 0, map.h - 1);
    const y1 = clamp(Math.ceil(b.y1 / t), 0, map.h);

    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const kind = map.terrain[y * map.w + x];
        // Deterministic per-tile shade variation keeps large fields from
        // reading as flat colour without any texture assets. The hash has to
        // be irregular in both axes or the map turns into a chessboard.
        let hsh = (x * 374761393 + y * 668265263) | 0;
        hsh = (hsh ^ (hsh >>> 13)) * 1274126177;
        const pal = kind === 2 ? PAL.water : kind === 1 ? PAL.rough : PAL.plains;
        ctx.fillStyle = pal[(hsh >>> 16) & 3];
        ctx.fillRect(x * t, y * t, t + 1, t + 1);
      }
    }

    // Shoreline: a bright edge only on the water tiles that touch land, which
    // is what makes the lakes read as obstacles rather than blue rectangles.
    ctx.save();
    ctx.strokeStyle = PAL.shore;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (map.terrain[y * map.w + x] !== 2) continue;
        const land = (ax: number, ay: number) =>
          ax >= 0 && ay >= 0 && ax < map.w && ay < map.h && map.terrain[ay * map.w + ax] !== 2;
        const px = x * t, py = y * t;
        if (land(x, y - 1)) { ctx.moveTo(px, py); ctx.lineTo(px + t, py); }
        if (land(x, y + 1)) { ctx.moveTo(px, py + t); ctx.lineTo(px + t, py + t); }
        if (land(x - 1, y)) { ctx.moveTo(px, py); ctx.lineTo(px, py + t); }
        if (land(x + 1, y)) { ctx.moveTo(px + t, py); ctx.lineTo(px + t, py + t); }
      }
    }
    ctx.stroke();
    ctx.restore();

    // Water shimmer: two slow sine bands, cheap and it makes lakes feel wet.
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.strokeStyle = '#7fd4ff';
    ctx.lineWidth = 1.5;
    const phase = timeMs * 0.0011;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (map.terrain[y * map.w + x] !== 2) continue;
        const off = Math.sin(phase + x * 0.6 + y * 0.4) * 5;
        ctx.beginPath();
        ctx.moveTo(x * t + 6, y * t + t * 0.42 + off);
        ctx.lineTo(x * t + t - 6, y * t + t * 0.42 + off);
        ctx.stroke();
      }
    }
    ctx.restore();

    // Sparse ground detail. Roughly one tile in three gets a couple of specks,
    // placed by the same spatial hash, which gives the plains some grain
    // without any repeating pattern and without a texture atlas.
    ctx.save();
    ctx.fillStyle = PAL.speck;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (map.terrain[y * map.w + x] === 2) continue;
        let h = (x * 2246822519 + y * 3266489917) | 0;
        h = (h ^ (h >>> 15)) * 668265263;
        if (((h >>> 8) & 3) !== 0) continue;
        const px = x * t + ((h >>> 10) & 31) + 4;
        const py = y * t + ((h >>> 16) & 31) + 4;
        ctx.fillRect(px, py, 3, 2);
        ctx.fillRect(px + 11 - ((h >>> 21) & 7), py + 9, 2, 2);
      }
    }
    ctx.restore();

    // Rough terrain hatching — reads instantly as "this slows you down".
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.strokeStyle = '#4a5568';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (map.terrain[y * map.w + x] !== 1) continue;
        for (let i = 0; i < 3; i++) {
          const yy = y * t + 10 + i * 13;
          ctx.moveTo(x * t + 5, yy);
          ctx.lineTo(x * t + t - 5, yy - 6);
        }
      }
    }
    ctx.stroke();
    ctx.restore();

    // Command grid.
    ctx.strokeStyle = PAL.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = x0; x <= x1; x++) { ctx.moveTo(x * t, y0 * t); ctx.lineTo(x * t, y1 * t); }
    for (let y = y0; y <= y1; y++) { ctx.moveTo(x0 * t, y * t); ctx.lineTo(x1 * t, y * t); }
    ctx.stroke();

    // World border.
    ctx.strokeStyle = 'rgba(120,180,255,0.25)';
    ctx.lineWidth = 3;
    ctx.strokeRect(0, 0, worldWidth(map), worldHeight(map));
  }

  /** Owner-tinted ground glow under each base, drawn beneath everything so
   *  territory is legible at a glance while zoomed out. */
  private drawBaseFloors(state: GameState): void {
    const ctx = this.ctx;
    ctx.save();
    for (const b of state.bases) {
      if (b.owner === -1) continue;
      const col = teamOf(b.owner);
      const r = b.radius * 3.4;
      const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, r);
      g.addColorStop(0, col.glow);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = 0.20;
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- bases ---
  private drawBase(ctx: CanvasRenderingContext2D, b: Base, timeMs: number): void {
    const col = b.owner === -1 ? null : teamOf(b.owner);
    const main = col?.main ?? PAL.neutral;
    const r = b.radius;

    ctx.save();
    ctx.translate(b.x, b.y);

    // Landing pad.
    ctx.fillStyle = 'rgba(6,10,18,0.85)';
    hexPath(ctx, r);
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = main;
    ctx.stroke();

    if (b.isHQ) {
      ctx.lineWidth = 2;
      ctx.strokeStyle = main;
      ctx.globalAlpha = 0.5;
      hexPath(ctx, r * 0.68);
      ctx.stroke();
      ctx.globalAlpha = 1;
      // Slow rotating fins mark the HQ as the thing worth protecting.
      const a = timeMs * 0.0004;
      ctx.strokeStyle = main;
      ctx.globalAlpha = 0.75;
      ctx.lineWidth = 3;
      for (let i = 0; i < 3; i++) {
        const ang = a + (i * Math.PI * 2) / 3;
        ctx.beginPath();
        ctx.moveTo(Math.cos(ang) * r * 0.3, Math.sin(ang) * r * 0.3);
        ctx.lineTo(Math.cos(ang) * r * 0.92, Math.sin(ang) * r * 0.92);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = main;
      ctx.globalAlpha = b.owner === -1 ? 0.18 : 0.32;
      hexPath(ctx, r * 0.5);
      ctx.fill();
      ctx.globalAlpha = 1;
      if (b.owner === -1) {
        // Slow breathing halo: unclaimed ground, come and take it.
        const pulse = 0.5 + 0.5 * Math.sin(timeMs * 0.0022 + b.id);
        ctx.strokeStyle = PAL.neutral;
        ctx.globalAlpha = 0.20 + pulse * 0.35;
        ctx.lineWidth = 2;
        hexPath(ctx, r + 5 + pulse * 5);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    // Capture ring: how close this outpost is to changing hands.
    if (!b.isHQ && b.capture !== 0) {
      const frac = Math.abs(b.capture) / C.CAPTURE_FULL;
      const towards = b.capture > 0 ? 0 : 1;
      ctx.strokeStyle = teamOf(towards).main;
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(0, 0, r + 7, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
      ctx.stroke();
      ctx.lineCap = 'butt';
    }

    // Structure integrity.
    if (b.hp < b.maxHp) {
      const w = r * 1.8;
      const f = b.hp / b.maxHp;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(-w / 2, -r - 16, w, 5);
      ctx.fillStyle = f > 0.5 ? PAL.hpGood : f > 0.22 ? PAL.hpWarn : PAL.hpBad;
      ctx.fillRect(-w / 2, -r - 16, w * f, 5);
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- units ---
  private drawUnit(ctx: CanvasRenderingContext2D, u: Unit): void {
    const def = UNIT_TYPES[u.type];
    const col = teamOf(u.owner);
    ctx.save();
    ctx.translate(u.x, u.y);

    // Contact shadow grounds the sprite against the terrain.
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(1.5, 2.5, def.radius * 1.15, def.radius * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.rotate(u.facing);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = col.ink;
    ctx.fillStyle = col.main;
    const s = def.radius;

    switch (u.type) {
      case 'INFANTRY':
        ctx.beginPath(); ctx.arc(0, 0, s, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = col.ink;
        ctx.fillRect(s * 0.2, -1, s * 1.1, 2);
        break;
      case 'BIKE':
        poly(ctx, [[s * 1.5, 0], [-s, s * 0.8], [-s * 0.4, 0], [-s, -s * 0.8]]);
        ctx.fill(); ctx.stroke();
        break;
      case 'ARMOR':
        roundRect(ctx, -s, -s * 0.8, s * 2, s * 1.6, 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = col.dark; ctx.fillRect(0, -1.5, s * 1.6, 3);
        break;
      case 'TANK':
        ctx.fillStyle = col.dark;
        roundRect(ctx, -s * 1.05, -s * 0.95, s * 2.1, s * 1.9, 2); ctx.fill();
        ctx.fillStyle = col.main;
        roundRect(ctx, -s * 0.7, -s * 0.62, s * 1.35, s * 1.24, 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = col.ink; ctx.fillRect(s * 0.3, -2, s * 1.5, 4);
        break;
      case 'AA':
        roundRect(ctx, -s, -s * 0.75, s * 1.9, s * 1.5, 2); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = col.ink; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, -2); ctx.lineTo(s * 1.5, -s * 0.8);
        ctx.moveTo(0, 2); ctx.lineTo(s * 1.5, s * 0.8);
        ctx.stroke();
        break;
      case 'ARTILLERY':
        roundRect(ctx, -s, -s * 0.8, s * 1.7, s * 1.6, 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = col.ink;
        for (let i = -1; i <= 1; i++) ctx.fillRect(-s * 0.3, i * 3 - 1, s * 1.6, 2);
        break;
      case 'SUPPLY':
        roundRect(ctx, -s, -s * 0.8, s * 2, s * 1.6, 3); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#e9f4ff';
        ctx.fillRect(-2, -s * 0.45, 4, s * 0.9);
        ctx.fillRect(-s * 0.45, -2, s * 0.9, 4);
        break;
    }
    ctx.restore();

    // Health pip, only once it matters — no clutter at full strength.
    if (u.hp < def.hp) {
      const w = def.radius * 2.6;
      const f = clamp(u.hp / def.hp, 0, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(u.x - w / 2, u.y - def.radius - 8, w, 3);
      ctx.fillStyle = f > 0.5 ? PAL.hpGood : f > 0.25 ? PAL.hpWarn : PAL.hpBad;
      ctx.fillRect(u.x - w / 2, u.y - def.radius - 8, w * f, 3);
    }
  }

  // ----------------------------------------------------------------- mech ---
  private drawMech(ctx: CanvasRenderingContext2D, m: Mech, timeMs: number): void {
    if (!m.alive) {
      // Respawn beacon at the HQ so a downed player knows where they are coming back.
      return;
    }
    const col = teamOf(m.owner);
    const jet = m.mode === 'JET';
    const morphing = m.morph > 0;
    const s = C.MECH_RADIUS;

    ctx.save();
    ctx.translate(m.x, m.y);

    // A jet casts a displaced shadow — instant, wordless altitude cue. This is
    // the single most important readability decision in the whole renderer:
    // you must know at a glance which layer the enemy commander is on.
    const shadowOff = jet ? 16 : 3;
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.ellipse(shadowOff * 0.7, shadowOff, s * (jet ? 0.9 : 1.2), s * (jet ? 0.5 : 0.85), 0, 0, Math.PI * 2);
    ctx.fill();

    if (jet) ctx.translate(-2, -10);

    ctx.save();
    ctx.rotate(m.facing);

    // Engine glow / thruster.
    const thrust = Math.hypot(m.vx, m.vy) / (jet ? C.JET_MAX_SPEED : C.WALKER_MAX_SPEED);
    if (thrust > 0.1) {
      const g = ctx.createLinearGradient(-s * 1.2, 0, -s * 2.6 - thrust * 14, 0);
      g.addColorStop(0, col.glow);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      poly(ctx, [[-s * 1.1, -4], [-s * 2.4 - thrust * 14, 0], [-s * 1.1, 4]]);
      ctx.fill();
    }

    ctx.lineWidth = 2;
    ctx.strokeStyle = col.ink;
    ctx.fillStyle = morphing ? '#ffffff' : col.main;

    if (jet) {
      poly(ctx, [[s * 1.7, 0], [0, -s * 0.85], [-s * 0.9, -s * 0.5], [-s * 0.6, 0],
                 [-s * 0.9, s * 0.5], [0, s * 0.85]]);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = col.dark;
      poly(ctx, [[s * 0.9, 0], [s * 0.1, -s * 0.32], [s * 0.1, s * 0.32]]);
      ctx.fill();
    } else {
      // Torso.
      roundRect(ctx, -s * 0.75, -s * 0.8, s * 1.5, s * 1.6, 3);
      ctx.fill(); ctx.stroke();
      // Shoulders.
      ctx.fillStyle = col.dark;
      roundRect(ctx, -s * 0.5, -s * 1.15, s * 0.8, s * 0.45, 2); ctx.fill();
      roundRect(ctx, -s * 0.5, s * 0.7, s * 0.8, s * 0.45, 2); ctx.fill();
      // Cannon arm.
      ctx.fillStyle = col.ink;
      roundRect(ctx, s * 0.3, -3, s * 1.5, 6, 2); ctx.fill();
      // Sensor eye.
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(s * 0.25, 0, 2.4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();

    // Carry rig: a visible tether while hauling, so the cost of the trip reads.
    if (m.carryingUnitId >= 0) {
      ctx.strokeStyle = col.glow;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(0, jet ? 12 : 0, s + 9 + Math.sin(timeMs * 0.008) * 1.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (morphing) {
      ctx.strokeStyle = '#ffffff';
      ctx.globalAlpha = m.morph / C.MORPH_TICKS;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, s + 12 - (m.morph / C.MORPH_TICKS) * 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  // ---------------------------------------------------------- projectiles ---
  private drawProjectile(ctx: CanvasRenderingContext2D, p: Projectile): void {
    const col = teamOf(p.owner);
    const len = p.kind === 'BEAM' ? 22 : p.kind === 'SHELL' ? 12 : 9;
    const nx = p.vx, ny = p.vy;
    const m = Math.hypot(nx, ny) || 1;
    const tx = p.x - (nx / m) * len, ty = p.y - (ny / m) * len;

    ctx.save();
    ctx.lineCap = 'round';
    const g = ctx.createLinearGradient(p.x, p.y, tx, ty);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.4, col.main);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.strokeStyle = g;
    ctx.lineWidth = p.kind === 'SHELL' ? 3.5 : p.kind === 'MISSILE' ? 3 : 2;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(tx, ty);
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
      switch (e.kind) {
        case 'EXPLOSION': {
          const r = (6 + t * 26) * e.scale;
          ctx.globalAlpha = fade * 0.9;
          const g = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, r);
          g.addColorStop(0, '#fff6d8');
          g.addColorStop(0.35, '#ffb43c');
          g.addColorStop(1, 'rgba(255,60,0,0)');
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(e.x, e.y, r, 0, Math.PI * 2); ctx.fill();
          ctx.globalAlpha = fade * 0.7;
          ctx.strokeStyle = '#ffd9a0';
          ctx.lineWidth = 2 * fade;
          ctx.beginPath(); ctx.arc(e.x, e.y, r * 1.25, 0, Math.PI * 2); ctx.stroke();
          break;
        }
        case 'SPARK':
          ctx.globalAlpha = fade;
          ctx.fillStyle = '#ffe9a8';
          ctx.beginPath(); ctx.arc(e.x, e.y, 2.5 * e.scale * (1 - t * 0.5), 0, Math.PI * 2); ctx.fill();
          break;
        case 'CAPTURE': {
          ctx.globalAlpha = fade * 0.8;
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 3 * fade;
          ctx.beginPath(); ctx.arc(e.x, e.y, 20 + t * 55, 0, Math.PI * 2); ctx.stroke();
          break;
        }
        case 'PICKUP':
          ctx.globalAlpha = fade;
          ctx.strokeStyle = '#cfe3ff';
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(e.x, e.y, 28 * (1 - t), 0, Math.PI * 2); ctx.stroke();
          break;
        case 'REPAIR':
          ctx.globalAlpha = fade;
          ctx.fillStyle = PAL.hpGood;
          ctx.fillRect(e.x - 1, e.y - 14 - t * 10, 2, 6);
          ctx.fillRect(e.x - 3, e.y - 12 - t * 10, 6, 2);
          break;
      }
    }
    ctx.restore();
  }

  /** Off-screen threat arrows: on a phone the viewport is small, so the edge
   *  of the screen has to tell you where the fight is. */
  private drawEdgeMarkers(state: GameState, me: PlayerId): void {
    const ctx = this.ctx;
    const b = this.cam.bounds;
    const foe = me === 0 ? 1 : 0;
    const marks: { x: number; y: number; col: string }[] = [];

    const em = state.mechs[foe];
    if (em.alive && (em.x < b.x0 || em.x > b.x1 || em.y < b.y0 || em.y > b.y1)) {
      marks.push({ x: em.x, y: em.y, col: teamOf(foe).main });
    }
    for (const base of state.bases) {
      if (base.owner !== me) continue;
      if (base.hp > base.maxHp * 0.75) continue;
      if (base.x > b.x0 && base.x < b.x1 && base.y > b.y0 && base.y < b.y1) continue;
      marks.push({ x: base.x, y: base.y, col: PAL.hpBad });
    }

    const cx = this.cssW / 2, cy = this.cssH / 2;
    const pad = 26;
    for (const mk of marks) {
      const dx = mk.x - this.cam.x, dy = mk.y - this.cam.y;
      const ang = Math.atan2(dy, dx);
      const rx = cx - pad, ry = cy - pad;
      const scale = Math.min(rx / Math.abs(Math.cos(ang) || 1e-4), ry / Math.abs(Math.sin(ang) || 1e-4));
      const px = cx + Math.cos(ang) * scale, py = cy + Math.sin(ang) * scale;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(ang);
      ctx.fillStyle = mk.col;
      ctx.globalAlpha = 0.9;
      poly(ctx, [[10, 0], [-6, -7], [-6, 7]]);
      ctx.fill();
      ctx.restore();
    }
  }
}

// ------------------------------------------------------------------ helpers ---
function poly(ctx: CanvasRenderingContext2D, pts: number[][]): void {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

function hexPath(ctx: CanvasRenderingContext2D, r: number): void {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function roundRect(
  ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
