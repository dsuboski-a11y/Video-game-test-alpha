import { Rng } from '../core/rng';
import { clamp, dist, dist2, turnToward } from '../core/vec';
import * as C from './constants';
import { UNIT_TYPES } from './constants';
import { buildField, fieldDir, type NavField } from './nav';
import { terrainAt, worldHeight, worldWidth } from './world';
import type {
  Base, Command, GameState, MechInput, OrderId, PlayerId, Projectile, Unit, UnitTypeId,
} from './types';

/** Sentinel stored in Unit.targetId when a unit is shooting at the enemy mech. */
const TARGET_MECH = -2;

export interface SimContext {
  /** One flow field per base id, rebuilt only when the map changes (never). */
  fields: NavField[];
}

export function createContext(state: GameState): SimContext {
  return { fields: state.bases.map((b) => buildField(state.map, b.x, b.y)) };
}

const other = (p: PlayerId): PlayerId => (p === 0 ? 1 : 0);
const isAir = (mode: string): boolean => mode === 'JET';

export function step(state: GameState, commands: Command[], ctx: SimContext): void {
  state.events.length = 0;
  if (state.winner !== null) { ageEffects(state); return; }

  const rng = new Rng(state.rngState);
  state.tick++;

  const inputs: [MechInput | null, MechInput | null] = [null, null];
  for (const cmd of commands) {
    switch (cmd.c) {
      case 'INPUT': inputs[cmd.p] = cmd.in; break;
      case 'BUY': doBuy(state, cmd.p, cmd.unit, cmd.order); break;
      case 'ORDER': doRewriteOrder(state, cmd.p, cmd.order); break;
    }
  }

  // Alternate whose commander resolves first, and which end of the unit list
  // is stepped first. A fixed order is a small, permanent edge to whoever is
  // processed first (or last) — invisible per tick, worth several points of
  // win rate over a match. Parity of the tick is deterministic, so lockstep
  // peers still agree.
  const first: PlayerId = (state.tick & 1) === 0 ? 0 : 1;
  const second: PlayerId = first === 0 ? 1 : 0;
  updateMech(state, first, inputs[first], rng);
  updateMech(state, second, inputs[second], rng);

  if ((state.tick & 1) === 0) {
    for (let i = 0; i < state.units.length; i++) updateUnit(state, state.units[i], ctx, rng);
  } else {
    for (let i = state.units.length - 1; i >= 0; i--) updateUnit(state, state.units[i], ctx, rng);
  }
  updateProjectiles(state, rng);
  updateBases(state);
  updateEconomy(state);
  reapUnits(state);
  ageEffects(state);
  checkWin(state);

  state.rngState = rng.state;
}

// ------------------------------------------------------------------ buying ---

function friendlyBaseUnderMech(state: GameState, p: PlayerId): Base | null {
  const m = state.mechs[p];
  for (const b of state.bases) {
    if (b.owner !== p) continue;
    if (dist(m.x, m.y, b.x, b.y) <= b.radius + C.MECH_RADIUS) return b;
  }
  return null;
}

function doBuy(state: GameState, p: PlayerId, type: UnitTypeId, order: OrderId): void {
  const def = UNIT_TYPES[type];
  const player = state.players[p];
  const base = friendlyBaseUnderMech(state, p);
  if (!base || player.money < def.cost) { state.events.push({ t: 'denied', owner: p }); return; }

  player.money -= def.cost;
  player.spent += def.cost;
  player.unitsBuilt++;

  // Fan spawns around the pad so a build queue does not stack into one pixel.
  const a = (state.nextEntityId * 2.39996) % (Math.PI * 2);
  const r = base.radius * 0.75;
  state.units.push({
    id: state.nextEntityId++,
    type, owner: p,
    x: base.x + Math.cos(a) * r,
    y: base.y + Math.sin(a) * r,
    vx: 0, vy: 0,
    facing: p === 0 ? 0 : Math.PI,
    hp: def.hp,
    ammo: def.ammo,
    cooldown: 0,
    order,
    anchorX: base.x, anchorY: base.y,
    targetId: -1, targetBaseId: -1, fireBaseId: -1,
    carried: false,
    repathIn: 0,
    wanderSeed: state.nextEntityId * 37,
  });
  state.events.push({ t: 'build', owner: p });
}

function doRewriteOrder(state: GameState, p: PlayerId, order: OrderId): void {
  const m = state.mechs[p];
  if (m.carryingUnitId < 0) { state.events.push({ t: 'denied', owner: p }); return; }
  const u = state.units.find((x) => x.id === m.carryingUnitId);
  if (!u) return;
  if (u.order === order) return;
  if (state.players[p].money < C.ORDER_REWRITE_COST) {
    state.events.push({ t: 'denied', owner: p });
    return;
  }
  state.players[p].money -= C.ORDER_REWRITE_COST;
  u.order = order;
  u.targetId = -1;
  u.targetBaseId = -1;
  u.fireBaseId = -1;
}

// -------------------------------------------------------------------- mech ---

function updateMech(state: GameState, p: PlayerId, input: MechInput | null, rng: Rng): void {
  const m = state.mechs[p];

  if (!m.alive) {
    m.downTimer--;
    if (m.downTimer <= 0) {
      const hq = state.bases.find((b) => b.isHQ && b.owner === p);
      m.alive = true;
      m.hp = C.MECH_HP;
      m.fuel = C.MECH_FUEL;
      m.ammo = C.MECH_AMMO;
      m.mode = 'WALKER';
      m.morph = 0;
      m.vx = m.vy = 0;
      m.x = hq ? hq.x + (p === 0 ? 22 : -22) : m.x;
      m.y = hq ? hq.y : m.y;
    }
    return;
  }

  const inp: MechInput = input ?? { mx: 0, my: 0, fire: false, transform: false, grab: false };

  // ------ transform -------------------------------------------------------
  if (inp.transform && m.morph <= 0) m.morph = C.MORPH_TICKS;
  if (m.morph > 0) {
    m.morph--;
    if (m.morph === Math.floor(C.MORPH_TICKS / 2)) {
      m.mode = m.mode === 'JET' ? 'WALKER' : 'JET';
    }
  }
  const morphing = m.morph > 0;
  const jet = m.mode === 'JET';

  // ------ movement --------------------------------------------------------
  const dry = m.fuel <= 0;
  const accel = (jet ? C.JET_ACCEL : C.WALKER_ACCEL) * (dry ? 0.35 : 1) * (morphing ? 0.3 : 1);
  const maxSpeed = (jet ? C.JET_MAX_SPEED : C.WALKER_MAX_SPEED) * (dry ? 0.45 : 1);
  const mag = Math.hypot(inp.mx, inp.my);
  if (mag > 0.05) {
    const nx = inp.mx / mag, ny = inp.my / mag;
    const throttle = Math.min(1, mag);
    m.vx += nx * accel * throttle;
    m.vy += ny * accel * throttle;
    const turn = jet ? C.JET_TURN : C.WALKER_TURN;
    m.facing = turnToward(m.facing, Math.atan2(ny, nx), turn);
  }
  // Jets glide; walkers plant their feet. The friction gap is most of what the
  // two modes *feel* like.
  const friction = jet ? 0.975 : 0.86;
  m.vx *= friction; m.vy *= friction;
  const sp = Math.hypot(m.vx, m.vy);
  if (sp > maxSpeed) { m.vx = (m.vx / sp) * maxSpeed; m.vy = (m.vy / sp) * maxSpeed; }

  let nx2 = m.x + m.vx, ny2 = m.y + m.vy;
  if (!jet) {
    // Walkers are ground units and respect water; jets fly over everything.
    if (terrainAt(state.map, nx2, m.y) === 2) { nx2 = m.x; m.vx *= -0.2; }
    if (terrainAt(state.map, m.x, ny2) === 2) { ny2 = m.y; m.vy *= -0.2; }
  }
  const W = worldWidth(state.map), H = worldHeight(state.map);
  m.x = clamp(nx2, C.MECH_RADIUS, W - C.MECH_RADIUS);
  m.y = clamp(ny2, C.MECH_RADIUS, H - C.MECH_RADIUS);

  // ------ fuel ------------------------------------------------------------
  const moving = mag > 0.05;
  let burn = jet ? C.FUEL_BURN_JET : moving ? C.FUEL_BURN_WALKER : C.FUEL_BURN_IDLE;
  if (m.carryingUnitId >= 0) burn += C.FUEL_BURN_CARRY;
  m.fuel = Math.max(0, m.fuel - burn);

  // ------ resupply over a friendly base ------------------------------------
  const pad = friendlyBaseUnderMech(state, p);
  if (pad && !jet) {
    m.fuel = Math.min(C.MECH_FUEL, m.fuel + C.MECH_RESUPPLY_RATE);
    m.ammo = Math.min(C.MECH_AMMO, m.ammo + C.MECH_REARM_RATE);
    m.hp = Math.min(C.MECH_HP, m.hp + C.MECH_REPAIR_RATE);
  }

  // ------ carry -----------------------------------------------------------
  if (inp.grab) {
    if (m.carryingUnitId >= 0) {
      const u = state.units.find((x) => x.id === m.carryingUnitId);
      if (u) {
        // Never set a unit down in the water it cannot walk out of.
        if (terrainAt(state.map, m.x, m.y) !== 2) {
          u.carried = false;
          u.x = m.x; u.y = m.y;
          u.anchorX = m.x; u.anchorY = m.y;
          u.targetId = -1; u.targetBaseId = -1; u.fireBaseId = -1;
          m.carryingUnitId = -1;
          state.events.push({ t: 'drop', x: m.x, y: m.y });
          pushEffect(state, m.x, m.y, 'PICKUP', 12, 1);
        } else {
          state.events.push({ t: 'denied', owner: p });
        }
      } else {
        m.carryingUnitId = -1;
      }
    } else {
      let best: Unit | null = null, bestD = C.CARRY_PICKUP_RANGE * C.CARRY_PICKUP_RANGE;
      for (const u of state.units) {
        if (u.owner !== p || u.carried) continue;
        const d = dist2(m.x, m.y, u.x, u.y);
        if (d < bestD) { bestD = d; best = u; }
      }
      if (best) {
        best.carried = true;
        m.carryingUnitId = best.id;
        state.events.push({ t: 'pickup', x: m.x, y: m.y });
        pushEffect(state, m.x, m.y, 'PICKUP', 12, 1);
      }
    }
  }
  if (m.carryingUnitId >= 0) {
    const u = state.units.find((x) => x.id === m.carryingUnitId);
    if (!u || u.hp <= 0) m.carryingUnitId = -1;
    else { u.x = m.x; u.y = m.y; u.vx = m.vx; u.vy = m.vy; }
  }

  // ------ weapon ----------------------------------------------------------
  if (m.cooldown > 0) m.cooldown--;
  if (inp.fire && m.cooldown <= 0 && m.ammo > 0 && !morphing) {
    m.cooldown = jet ? C.MECH_COOLDOWN_JET : C.MECH_COOLDOWN_WALKER;
    m.ammo--;
    const spread = (rng.next() - 0.5) * (jet ? 0.05 : 0.03);
    const ang = m.facing + spread;
    const speed = jet ? 11 : 9;
    spawnProjectile(state, {
      owner: p,
      x: m.x + Math.cos(ang) * (C.MECH_RADIUS + 4),
      y: m.y + Math.sin(ang) * (C.MECH_RADIUS + 4),
      vx: Math.cos(ang) * speed + m.vx * 0.4,
      vy: Math.sin(ang) * speed + m.vy * 0.4,
      life: Math.round(C.MECH_RANGE / speed),
      damage: jet ? C.MECH_SHOT_DAMAGE_JET : C.MECH_SHOT_DAMAGE_WALKER,
      // The core rock-paper-scissors: a jet cannot touch the ground war, and a
      // walker cannot answer the sky. Choosing a mode is choosing a fight.
      hitsAir: true,
      hitsGround: !jet,
      kind: jet ? 'BEAM' : 'BULLET',
      targetId: -1,
    });
    state.events.push({ t: 'shot', kind: jet ? 'BEAM' : 'BULLET', x: m.x, y: m.y });
  }
}

// -------------------------------------------------------------------- units ---

function updateUnit(state: GameState, u: Unit, ctx: SimContext, rng: Rng): void {
  if (u.carried || u.hp <= 0) return;
  const def = UNIT_TYPES[u.type];
  const foe = other(u.owner);

  if (u.cooldown > 0) u.cooldown--;
  if (u.repathIn > 0) u.repathIn--;
  else { u.repathIn = 8 + (u.wanderSeed % 5); retarget(state, u, def.canHitGround, def.canHitAir); }

  if (def.isSupport) { runSupport(state, u); }

  const goal = orderGoal(state, u, ctx);
  if (goal) {
    const terr = terrainAt(state.map, u.x, u.y);
    const speed = def.speed * (C.TERRAIN_SPEED[terr] || 1);
    moveUnit(state, u, goal.dx, goal.dy, speed);
  }
  separate(state, u);
  fireUnit(state, u, rng);

  // Standing on a friendly base slowly patches a unit up — a cheap forward
  // repair loop that rewards holding ground instead of trading it.
  for (const b of state.bases) {
    if (b.owner !== u.owner) continue;
    if (dist2(u.x, u.y, b.x, b.y) < (b.radius + 14) ** 2) {
      u.hp = Math.min(def.hp, u.hp + C.BASE_HEAL_RATE);
      if (u.ammo < def.ammo) u.ammo = Math.min(def.ammo, u.ammo + 0.4);
      break;
    }
  }
  void foe;
}

function moveUnit(state: GameState, u: Unit, dx: number, dy: number, speed: number): void {
  if (speed <= 0) return;
  const len = Math.hypot(dx, dy);
  if (len < 1e-4) return;
  const nx = (dx / len) * speed, ny = (dy / len) * speed;
  u.facing = turnToward(u.facing, Math.atan2(ny, nx), 0.22);

  let px = u.x + nx, py = u.y + ny;
  if (terrainAt(state.map, px, u.y) === 2) px = u.x;
  if (terrainAt(state.map, u.x, py) === 2) py = u.y;
  const W = worldWidth(state.map), H = worldHeight(state.map);
  u.x = clamp(px, 4, W - 4);
  u.y = clamp(py, 4, H - 4);
  u.vx = nx; u.vy = ny;
}

/** Soft mutual repulsion. Not physics — just enough that a stack of tanks reads
 *  as a column instead of one sprite. */
function separate(state: GameState, u: Unit): void {
  const r = UNIT_TYPES[u.type].radius * 2;
  let px = 0, py = 0;
  for (const o of state.units) {
    if (o === u || o.carried || o.hp <= 0) continue;
    const d2 = dist2(u.x, u.y, o.x, o.y);
    if (d2 > r * r || d2 < 1e-6) continue;
    const d = Math.sqrt(d2);
    px += ((u.x - o.x) / d) * (r - d);
    py += ((u.y - o.y) / d) * (r - d);
  }
  if (px === 0 && py === 0) return;
  const nx2 = u.x + px * C.UNIT_SEPARATION * 0.1;
  const ny2 = u.y + py * C.UNIT_SEPARATION * 0.1;
  if (terrainAt(state.map, nx2, u.y) !== 2) u.x = nx2;
  if (terrainAt(state.map, u.x, ny2) !== 2) u.y = ny2;
}

interface Goal { dx: number; dy: number; }

function towardBase(state: GameState, u: Unit, ctx: SimContext, baseId: number): Goal | null {
  const b = state.bases[baseId];
  if (!b) return null;
  if (dist2(u.x, u.y, b.x, b.y) < (b.radius * 0.6) ** 2) return null; // arrived
  const d = fieldDir(ctx.fields[baseId], state.map, u.x, u.y);
  if (d) return { dx: d.x, dy: d.y };
  return { dx: b.x - u.x, dy: b.y - u.y };
}

function orderGoal(state: GameState, u: Unit, ctx: SimContext): Goal | null {
  const def = UNIT_TYPES[u.type];
  const foe = other(u.owner);

  // A unit already shooting something does not walk away from it.
  if (u.targetId >= 0 || u.targetId === TARGET_MECH) {
    const t = targetPos(state, u);
    if (t) {
      const d = dist(u.x, u.y, t.x, t.y);
      if (d <= def.range * 0.85) return null;            // in range, hold and shoot
      if (u.order !== 'HOLD') return { dx: t.x - u.x, dy: t.y - u.y };
    }
  }

  switch (u.order) {
    case 'HOLD':
      return null;

    case 'GUARD': {
      const d = dist(u.x, u.y, u.anchorX, u.anchorY);
      if (d > C.GUARD_RADIUS) return { dx: u.anchorX - u.x, dy: u.anchorY - u.y };
      return null;
    }

    case 'CAPTURE': {
      if (u.targetBaseId < 0 || state.bases[u.targetBaseId]?.owner === u.owner) {
        u.targetBaseId = nearestBaseId(state, u.x, u.y, (b) => !b.isHQ && b.owner !== u.owner);
        if (u.targetBaseId < 0) {
          u.targetBaseId = nearestBaseId(state, u.x, u.y, (b) => b.isHQ && b.owner === foe);
        }
      }
      return u.targetBaseId >= 0 ? towardBase(state, u, ctx, u.targetBaseId) : null;
    }

    case 'ASSAULT': {
      if (u.targetBaseId < 0 || !state.bases[u.targetBaseId]?.isHQ) {
        u.targetBaseId = nearestBaseId(state, u.x, u.y, (b) => b.isHQ && b.owner === foe);
      }
      return u.targetBaseId >= 0 ? towardBase(state, u, ctx, u.targetBaseId) : null;
    }

    case 'DEFEND_HQ': {
      const hqId = nearestBaseId(state, u.x, u.y, (b) => b.isHQ && b.owner === u.owner);
      if (hqId < 0) return null;
      const hq = state.bases[hqId];
      if (dist2(u.x, u.y, hq.x, hq.y) < (hq.radius + 90) ** 2) return null;
      return towardBase(state, u, ctx, hqId);
    }

    case 'HUNT': {
      const t = targetPos(state, u);
      if (t) return { dx: t.x - u.x, dy: t.y - u.y };
      const nearest = nearestEnemyAnywhere(state, u);
      if (nearest) return { dx: nearest.x - u.x, dy: nearest.y - u.y };
      const hqId = nearestBaseId(state, u.x, u.y, (b) => b.isHQ && b.owner === foe);
      return hqId >= 0 ? towardBase(state, u, ctx, hqId) : null;
    }

    case 'ESCORT': {
      const m = state.mechs[u.owner];
      if (!m.alive) return null;
      const d = dist(u.x, u.y, m.x, m.y);
      if (d < 70) return null;
      return { dx: m.x - u.x, dy: m.y - u.y };
    }

    case 'SUPPORT': {
      const c = neediestFriendly(state, u);
      if (!c) {
        const hqId = nearestBaseId(state, u.x, u.y, (b) => b.isHQ && b.owner === u.owner);
        return hqId >= 0 ? towardBase(state, u, ctx, hqId) : null;
      }
      if (dist2(u.x, u.y, c.x, c.y) < (C.SUPPLY_RANGE * 0.6) ** 2) return null;
      return { dx: c.x - u.x, dy: c.y - u.y };
    }
  }
}

function nearestBaseId(
  state: GameState, x: number, y: number, pred: (b: Base) => boolean,
): number {
  let best = -1, bd = Infinity;
  for (const b of state.bases) {
    if (!pred(b)) continue;
    const d = dist2(x, y, b.x, b.y);
    if (d < bd) { bd = d; best = b.id; }
  }
  return best;
}

function nearestEnemyAnywhere(state: GameState, u: Unit): { x: number; y: number } | null {
  const foe = other(u.owner);
  let best: { x: number; y: number } | null = null, bd = Infinity;
  for (const o of state.units) {
    if (o.owner !== foe || o.carried || o.hp <= 0) continue;
    const d = dist2(u.x, u.y, o.x, o.y);
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}

function neediestFriendly(state: GameState, u: Unit): Unit | null {
  let best: Unit | null = null, bd = Infinity;
  for (const o of state.units) {
    if (o.owner !== u.owner || o === u || o.carried || o.hp <= 0) continue;
    const def = UNIT_TYPES[o.type];
    const hurt = o.hp < def.hp * 0.9;
    const dry = isFinite(def.ammo) && o.ammo < def.ammo * 0.5;
    if (!hurt && !dry) continue;
    const d = dist2(u.x, u.y, o.x, o.y);
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}

function runSupport(state: GameState, u: Unit): void {
  for (const o of state.units) {
    if (o.owner !== u.owner || o === u || o.carried || o.hp <= 0) continue;
    if (dist2(u.x, u.y, o.x, o.y) > C.SUPPLY_RANGE * C.SUPPLY_RANGE) continue;
    const def = UNIT_TYPES[o.type];
    if (o.hp < def.hp) {
      o.hp = Math.min(def.hp, o.hp + C.SUPPLY_REPAIR);
      if (state.tick % 20 === 0) pushEffect(state, o.x, o.y, 'REPAIR', 14, 0.7);
    }
    if (isFinite(def.ammo) && o.ammo < def.ammo) o.ammo = Math.min(def.ammo, o.ammo + C.SUPPLY_REARM);
  }
}

function retarget(state: GameState, u: Unit, hitsGround: boolean, hitsAir: boolean): void {
  const def = UNIT_TYPES[u.type];
  if (def.range <= 0) { u.targetId = -1; return; }
  const foe = other(u.owner);
  const acquire = def.sight;
  let best = -1, bd = acquire * acquire;

  for (const o of state.units) {
    if (o.owner !== foe || o.carried || o.hp <= 0 || !hitsGround) continue;
    const d = dist2(u.x, u.y, o.x, o.y);
    if (d < bd) { bd = d; best = o.id; }
  }
  const em = state.mechs[foe];
  if (em.alive) {
    const air = isAir(em.mode);
    if ((air && hitsAir) || (!air && hitsGround)) {
      const d = dist2(u.x, u.y, em.x, em.y);
      // Slight preference for the enemy commander: it is the highest-value
      // thing on the board and AA that ignores it is worthless.
      if (d < bd * 1.35) { bd = d; best = TARGET_MECH; }
    }
  }
  u.targetId = best;

  // Nothing alive in range: shoot the nearest enemy structure instead. This
  // writes fireBaseId, never the order's navigation target.
  if (best === -1 && hitsGround) {
    u.fireBaseId = u.fireBaseId >= 0 && state.bases[u.fireBaseId].owner === foe
      ? u.fireBaseId
      : nearestBaseId(state, u.x, u.y, (b) => b.owner === foe);
  } else {
    u.fireBaseId = -1;
  }
}

function targetPos(state: GameState, u: Unit): { x: number; y: number } | null {
  if (u.targetId === TARGET_MECH) {
    const em = state.mechs[other(u.owner)];
    return em.alive ? em : null;
  }
  if (u.targetId >= 0) {
    const t = state.units.find((x) => x.id === u.targetId);
    if (t && t.hp > 0 && !t.carried) return t;
    u.targetId = -1;
  }
  return null;
}

function fireUnit(state: GameState, u: Unit, rng: Rng): void {
  const def = UNIT_TYPES[u.type];
  if (def.range <= 0 || u.cooldown > 0 || u.ammo <= 0) return;

  let tx: number, ty: number, air = false;
  const t = targetPos(state, u);
  if (t) {
    tx = t.x; ty = t.y;
    if (u.targetId === TARGET_MECH) air = isAir(state.mechs[other(u.owner)].mode);
  } else if (u.fireBaseId >= 0 && state.bases[u.fireBaseId].owner === other(u.owner)) {
    const b = state.bases[u.fireBaseId];
    tx = b.x; ty = b.y;
  } else return;

  if (air && !def.canHitAir) return;
  if (!air && !def.canHitGround) return;
  const d = dist(u.x, u.y, tx, ty);
  if (d > def.range) return;

  u.cooldown = def.cooldown;
  u.ammo--;
  const kind: Projectile['kind'] =
    u.type === 'ARTILLERY' ? 'MISSILE' : u.type === 'TANK' ? 'SHELL' :
    u.type === 'AA' ? 'MISSILE' : 'BULLET';
  const speed = kind === 'MISSILE' ? 6.5 : kind === 'SHELL' ? 8 : 7;
  // Lead the target so fast movers are not free hits.
  const flight = d / speed;
  const lx = tx + (t ? (t as Unit).vx ?? 0 : 0) * flight;
  const ly = ty + (t ? (t as Unit).vy ?? 0 : 0) * flight;
  const ang = Math.atan2(ly - u.y, lx - u.x) + (rng.next() - 0.5) * 0.05;
  u.facing = ang;

  spawnProjectile(state, {
    owner: u.owner,
    x: u.x + Math.cos(ang) * (def.radius + 3),
    y: u.y + Math.sin(ang) * (def.radius + 3),
    vx: Math.cos(ang) * speed,
    vy: Math.sin(ang) * speed,
    life: Math.ceil(def.range / speed) + 6,
    damage: def.damage,
    hitsAir: def.canHitAir,
    hitsGround: def.canHitGround,
    kind,
    targetId: kind === 'MISSILE' ? u.targetId : -1,
  });
  state.events.push({ t: 'shot', kind, x: u.x, y: u.y });
}

// -------------------------------------------------------------- projectiles ---

function spawnProjectile(state: GameState, p: Omit<Projectile, 'id'>): void {
  state.projectiles.push({ id: state.nextEntityId++, ...p });
}

function updateProjectiles(state: GameState, rng: Rng): void {
  const keep: Projectile[] = [];
  for (const pr of state.projectiles) {
    pr.life--;
    if (pr.life <= 0) continue;

    if (pr.kind === 'MISSILE' && pr.targetId !== -1) {
      const foeMech = state.mechs[other(pr.owner)];
      const t = pr.targetId === TARGET_MECH
        ? (foeMech.alive ? foeMech : null)
        : state.units.find((u) => u.id === pr.targetId && u.hp > 0) ?? null;
      if (t) {
        const sp = Math.hypot(pr.vx, pr.vy);
        const want = Math.atan2(t.y - pr.y, t.x - pr.x);
        const ang = turnToward(Math.atan2(pr.vy, pr.vx), want, 0.14);
        pr.vx = Math.cos(ang) * sp; pr.vy = Math.sin(ang) * sp;
      }
    }

    pr.x += pr.vx; pr.y += pr.vy;
    const W = worldWidth(state.map), H = worldHeight(state.map);
    if (pr.x < 0 || pr.y < 0 || pr.x > W || pr.y > H) continue;

    if (resolveHit(state, pr, rng)) continue;
    keep.push(pr);
  }
  state.projectiles = keep;
}

function resolveHit(state: GameState, pr: Projectile, rng: Rng): boolean {
  const foe = other(pr.owner);

  if (pr.hitsGround) {
    for (const u of state.units) {
      if (u.owner !== foe || u.carried || u.hp <= 0) continue;
      const r = UNIT_TYPES[u.type].radius + 3;
      if (dist2(pr.x, pr.y, u.x, u.y) > r * r) continue;
      damageUnit(state, u, pr.damage, pr.owner);
      boom(state, pr.x, pr.y, pr.damage > 25);
      return true;
    }
  }

  const em = state.mechs[foe];
  if (em.alive) {
    const air = isAir(em.mode);
    if ((air && pr.hitsAir) || (!air && pr.hitsGround)) {
      const r = C.MECH_RADIUS + 4;
      if (dist2(pr.x, pr.y, em.x, em.y) <= r * r) {
        em.hp -= pr.damage;
        boom(state, pr.x, pr.y, true);
        if (em.hp <= 0) {
          em.alive = false;
          em.downTimer = C.MECH_RESPAWN_TICKS;
          // A downed commander drops whatever it was hauling, right there.
          if (em.carryingUnitId >= 0) {
            const u = state.units.find((x) => x.id === em.carryingUnitId);
            if (u) { u.carried = false; u.anchorX = u.x; u.anchorY = u.y; }
            em.carryingUnitId = -1;
          }
          state.players[pr.owner].kills++;
          for (let i = 0; i < 6; i++) {
            pushEffect(state, em.x + (rng.next() - 0.5) * 30, em.y + (rng.next() - 0.5) * 30,
              'EXPLOSION', 26, 1.6);
          }
          state.events.push({ t: 'explode', x: em.x, y: em.y, big: true });
        }
        return true;
      }
    }
  }

  if (pr.hitsGround) {
    for (const b of state.bases) {
      if (b.owner !== foe) continue;
      if (dist2(pr.x, pr.y, b.x, b.y) > b.radius * b.radius) continue;
      b.hp = Math.max(0, b.hp - pr.damage);
      boom(state, pr.x, pr.y, true);
      if (b.isHQ) state.events.push({ t: 'hqhit', owner: b.owner as PlayerId });
      if (b.hp <= 0 && !b.isHQ) {
        // A razed outpost reverts to neutral rubble and must be retaken.
        b.owner = -1; b.capture = 0; b.hp = b.maxHp * 0.4;
      }
      return true;
    }
  }
  return false;
}

function damageUnit(state: GameState, u: Unit, dmg: number, by: PlayerId): void {
  u.hp -= dmg;
  if (u.hp <= 0) {
    state.players[by].kills++;
    state.players[u.owner].unitsLost++;
    boom(state, u.x, u.y, true);
  }
}

function reapUnits(state: GameState): void {
  if (!state.units.some((u) => u.hp <= 0)) return;
  for (const m of state.mechs) {
    if (m.carryingUnitId >= 0) {
      const u = state.units.find((x) => x.id === m.carryingUnitId);
      if (!u || u.hp <= 0) m.carryingUnitId = -1;
    }
  }
  state.units = state.units.filter((u) => u.hp > 0);
}

// -------------------------------------------------------------------- bases ---

function updateBases(state: GameState): void {
  for (const b of state.bases) {
    if (b.isHQ) continue;

    let p0 = 0, p1 = 0;
    for (const u of state.units) {
      if (u.carried || u.hp <= 0) continue;
      if (!UNIT_TYPES[u.type].canCapture) continue;
      if (dist2(u.x, u.y, b.x, b.y) > (b.radius + 22) ** 2) continue;
      if (u.owner === 0) p0++; else p1++;
    }
    if (p0 === p1) continue;                       // contested: progress freezes

    const push = (p0 > p1 ? 1 : -1) * C.CAPTURE_RATE * Math.min(3, Math.abs(p0 - p1));
    b.capture = clamp(b.capture + push, -C.CAPTURE_FULL, C.CAPTURE_FULL);

    const want: PlayerId | -1 =
      b.capture >= C.CAPTURE_FULL ? 0 : b.capture <= -C.CAPTURE_FULL ? 1 : b.owner;
    if (want !== b.owner) {
      const flippingFromEnemy = b.owner !== -1;
      b.owner = want;
      if (want !== -1) {
        b.hp = Math.max(b.hp, b.maxHp * 0.6);
        state.events.push({ t: 'capture', x: b.x, y: b.y, owner: want });
        pushEffect(state, b.x, b.y, 'CAPTURE', 40, 2);
      }
      // Taking an enemy outpost first neutralises it, so a swap costs double.
      if (flippingFromEnemy) b.capture = 0;
    }
    if (b.owner !== -1 && b.hp < b.maxHp) b.hp = Math.min(b.maxHp, b.hp + 0.3);
  }
}

function updateEconomy(state: GameState): void {
  if (state.tick % C.INCOME_PERIOD !== 0) return;
  for (const p of [0, 1] as PlayerId[]) {
    let income = 0;
    for (const b of state.bases) {
      if (b.owner !== p) continue;
      income += b.isHQ ? C.INCOME_HQ : C.INCOME_PER_BASE;
    }
    state.players[p].money += income;
  }
}

export function incomeFor(state: GameState, p: PlayerId): number {
  let income = 0;
  for (const b of state.bases) {
    if (b.owner !== p) continue;
    income += b.isHQ ? C.INCOME_HQ : C.INCOME_PER_BASE;
  }
  return income;
}

function checkWin(state: GameState): void {
  const hq0 = state.bases.find((b) => b.isHQ && b.owner === 0);
  const hq1 = state.bases.find((b) => b.isHQ && b.owner === 1);
  const dead0 = !hq0 || hq0.hp <= 0;
  const dead1 = !hq1 || hq1.hp <= 0;
  if (dead0 && dead1) state.winner = -1;
  else if (dead1) state.winner = 0;
  else if (dead0) state.winner = 1;
  if (state.winner !== null) state.events.push({ t: 'win', owner: state.winner });
}

// ------------------------------------------------------------------ effects ---

function pushEffect(
  state: GameState, x: number, y: number,
  kind: 'EXPLOSION' | 'SPARK' | 'CAPTURE' | 'PICKUP' | 'REPAIR',
  life: number, scale: number,
): void {
  if (state.effects.length > 220) return;   // hard cap: phones, not workstations
  state.effects.push({ id: state.nextEntityId++, x, y, kind, age: 0, life, scale });
}

function boom(state: GameState, x: number, y: number, big: boolean): void {
  pushEffect(state, x, y, big ? 'EXPLOSION' : 'SPARK', big ? 18 : 9, big ? 1 : 0.6);
  state.events.push({ t: 'explode', x, y, big });
}

function ageEffects(state: GameState): void {
  const keep = [];
  for (const e of state.effects) { e.age++; if (e.age < e.life) keep.push(e); }
  state.effects = keep;
}
