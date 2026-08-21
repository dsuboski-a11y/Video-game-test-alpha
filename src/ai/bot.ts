import { dist, dist2 } from '../core/vec';
import { Rng } from '../core/rng';
import * as C from '../sim/constants';
import { UNIT_TYPES } from '../sim/constants';
import type { Base, Command, GameState, MechInput, OrderId, PlayerId, UnitTypeId } from '../sim/types';

export type Difficulty = 'CADET' | 'OFFICER' | 'MARSHAL';

interface Plan { unit: UnitTypeId; order: OrderId; }

/**
 * A scripted opponent, not a solver. It plays the same game the human does —
 * same costs, same fuel, same carry rules, no resource cheating — and gets
 * harder by making *faster and better* decisions, never by getting free money.
 */
export class Bot {
  private rng: Rng;
  private buyCooldown = 0;
  private transformCooldown = 0;
  private wantMode: 'WALKER' | 'JET' = 'JET';
  private lastGrab = 0;
  private shopping = true;
  private refuelling = false;

  constructor(
    private readonly me: PlayerId,
    private readonly difficulty: Difficulty = 'OFFICER',
    seed = 12345,
  ) { this.rng = new Rng(seed); }

  private get tuning() {
    switch (this.difficulty) {
      case 'CADET':   return { buyGap: 70, aggression: 0.35, escortRatio: 0.15, fuelFloor: 0.45 };
      case 'MARSHAL': return { buyGap: 12, aggression: 0.85, escortRatio: 0.30, fuelFloor: 0.22 };
      default:        return { buyGap: 22, aggression: 0.60, escortRatio: 0.22, fuelFloor: 0.32 };
    }
  }

  think(state: GameState): Command[] {
    const out: Command[] = [];
    const m = state.mechs[this.me];
    if (!m.alive || state.winner !== null) return out;

    const t = this.tuning;
    if (this.buyCooldown > 0) this.buyCooldown--;
    if (this.transformCooldown > 0) this.transformCooldown--;

    const myBases = state.bases.filter((b) => b.owner === this.me);
    const pad = myBases.find((b) => dist(m.x, m.y, b.x, b.y) <= b.radius + C.MECH_RADIUS) ?? null;
    if (m.fuel < C.MECH_FUEL * t.fuelFloor) this.refuelling = true;
    else if (m.fuel > C.MECH_FUEL * 0.85) this.refuelling = false;
    const lowFuel = this.refuelling;
    const dry = m.ammo < 6 || m.hp < C.MECH_HP * 0.3;

    // ---- what is the mech doing right now? --------------------------------
    let goal: { x: number; y: number } | null = null;
    let wantWalker = false;

    const money = state.players[this.me].money;
    // Loitering at the pad until the credits are spent is what a human does;
    // the earlier version bought once and flew away broke.
    if (money < 90) this.shopping = false;
    else if (money >= 200) this.shopping = true;

    if (lowFuel || dry) {
      const home = this.nearest(myBases, m.x, m.y);
      // Drop the cargo before the long flight home rather than paying the
      // carry surcharge on a tank that is already empty.
      if (m.carryingUnitId >= 0 && state.tick - this.lastGrab > 20) {
        this.lastGrab = state.tick;
        out.push({ c: 'INPUT', p: this.me, in: this.input(state, home, false, true, false) });
        return out;
      }
      if (home) { goal = home; wantWalker = dist(m.x, m.y, home.x, home.y) < home.radius + 30; }
    } else if (m.carryingUnitId >= 0) {
      // Hauling: run it to the front, then set it down and get clear.
      const drop = this.frontLine(state);
      goal = drop;
      if (drop && dist(m.x, m.y, drop.x, drop.y) < 150 && state.tick - this.lastGrab > 20) {
        out.push({ c: 'INPUT', p: this.me, in: this.input(state, goal, false, true, false) });
        this.lastGrab = state.tick;
        return out;
      }
    } else if (this.shopping) {
      // Head to the nearest pad and stand on it while there is money to spend.
      const home = this.nearest(myBases, m.x, m.y);
      if (pad) {
        goal = null;
        wantWalker = true;
        // Ferry the freshly built unit forward instead of letting it walk:
        // an airlifted infantryman takes an outpost in seconds, not a minute.
        const cargo = this.pickupCandidate(state);
        if (cargo && state.tick - this.lastGrab > 20) {
          this.lastGrab = state.tick;
          out.push({ c: 'INPUT', p: this.me, in: this.input(state, null, false, true, false) });
          return out;
        }
      } else if (home) {
        goal = home;
        wantWalker = dist(m.x, m.y, home.x, home.y) < home.radius + 40;
      }
    } else {
      // Fight or shepherd, depending on aggression and what is threatening.
      const threat = this.threatToHome(state);
      if (threat) { goal = threat; wantWalker = true; }
      else if (this.rng.next() < t.aggression) {
        const em = state.mechs[this.otherId];
        const contested = this.contestedBase(state);
        if (em.alive && dist2(m.x, m.y, em.x, em.y) < 700 * 700) {
          goal = em;
          // Match layers: you cannot shoot a jet from walker mode.
          wantWalker = em.mode === 'WALKER';
        } else if (contested) { goal = contested; wantWalker = false; }
      } else {
        const c = this.contestedBase(state);
        goal = c ?? state.bases.find((b) => b.isHQ && b.owner === this.otherId) ?? null;
        wantWalker = false;
      }
    }

    // ---- buy --------------------------------------------------------------
    if (pad && this.buyCooldown <= 0 && m.carryingUnitId < 0) {
      const plan = this.chooseBuild(state);
      if (plan && state.players[this.me].money >= UNIT_TYPES[plan.unit].cost) {
        out.push({ c: 'BUY', p: this.me, unit: plan.unit, order: plan.order });
        this.buyCooldown = t.buyGap;
      }
    }

    // ---- transform --------------------------------------------------------
    this.wantMode = wantWalker ? 'WALKER' : 'JET';
    const shouldTransform = m.mode !== this.wantMode && this.transformCooldown <= 0 && m.morph <= 0;
    if (shouldTransform) this.transformCooldown = 30;

    const em = state.mechs[this.otherId];
    const canShoot = em.alive
      && dist(m.x, m.y, em.x, em.y) < C.MECH_RANGE * 0.8
      && (m.mode === 'JET' ? em.mode === 'JET' : true)
      && m.ammo > 0
      && Math.abs(this.angleTo(m.x, m.y, em.x, em.y, m.facing)) < 0.35;

    out.push({ c: 'INPUT', p: this.me, in: this.input(state, goal, canShoot, false, shouldTransform) });
    return out;
  }

  private get otherId(): PlayerId { return this.me === 0 ? 1 : 0; }

  private input(
    state: GameState, goal: { x: number; y: number } | null,
    fire: boolean, grab: boolean, transform: boolean,
  ): MechInput {
    const m = state.mechs[this.me];
    let mx = 0, my = 0;
    if (goal) {
      const d = dist(m.x, m.y, goal.x, goal.y);
      if (d > 18) { mx = (goal.x - m.x) / d; my = (goal.y - m.y) / d; }
    }
    return { mx, my, fire, transform, grab };
  }

  private angleTo(x: number, y: number, tx: number, ty: number, facing: number): number {
    let d = (Math.atan2(ty - y, tx - x) - facing) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  /** Build composition shifts with the state of the map, not with a timer:
   *  behind on bases -> infantry; being out-ranged -> artillery; losing the
   *  air -> flak. */
  private chooseBuild(state: GameState): Plan | null {
    const mine = state.bases.filter((b) => b.owner === this.me && !b.isHQ).length;
    const theirs = state.bases.filter((b) => b.owner === this.otherId && !b.isHQ).length;
    const army = state.units.filter((u) => u.owner === this.me);
    const count = (t: UnitTypeId) => army.filter((u) => u.type === t).length;
    const money = state.players[this.me].money;
    const t = this.tuning;

    const escort: OrderId = this.rng.next() < t.escortRatio ? 'ESCORT' : 'CAPTURE';

    // Keep enough infantry alive to keep taking ground: one per outpost still
    // in play, capped so it does not crowd out the army entirely.
    const openOutposts = state.bases.filter((b) => !b.isHQ && b.owner !== this.me).length;
    const wantInfantry = Math.min(5, Math.max(2, Math.ceil(openOutposts / 2)));
    if (count('INFANTRY') < wantInfantry || mine <= theirs) {
      return { unit: 'INFANTRY', order: 'CAPTURE' };
    }

    const enemyAirPressure = state.mechs[this.otherId].mode === 'JET' ? 1 : 0;
    if (count('AA') < 1 + enemyAirPressure && money >= 150) return { unit: 'AA', order: 'GUARD' };
    if (count('SUPPLY') < 1 && army.length >= 5 && money >= 110) return { unit: 'SUPPLY', order: 'SUPPORT' };
    if (count('BIKE') < 2 && money >= 80) return { unit: 'BIKE', order: escort };

    if (money >= 500 && count('ARTILLERY') < 2) return { unit: 'ARTILLERY', order: 'ASSAULT' };
    if (money >= 260) return { unit: 'TANK', order: this.rng.next() < 0.6 ? 'ASSAULT' : 'DEFEND_HQ' };
    if (money >= 150) return { unit: 'ARMOR', order: escort };
    if (money >= 60) return { unit: 'INFANTRY', order: 'CAPTURE' };
    return null;
  }

  /** A unit standing on our pad that is worth flying to the front. */
  private pickupCandidate(state: GameState): { x: number; y: number } | null {
    const m = state.mechs[this.me];
    for (const u of state.units) {
      if (u.owner !== this.me || u.carried) continue;
      if (u.order !== 'CAPTURE' && u.order !== 'ASSAULT') continue;
      if (dist(m.x, m.y, u.x, u.y) > C.CARRY_PICKUP_RANGE * 0.8) continue;
      return u;
    }
    return null;
  }

  private nearest(list: Base[], x: number, y: number): Base | null {
    let best: Base | null = null, bd = Infinity;
    for (const b of list) {
      const d = dist2(x, y, b.x, b.y);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  private contestedBase(state: GameState): Base | null {
    const cands = state.bases.filter((b) => !b.isHQ && b.owner !== this.me);
    const m = state.mechs[this.me];
    return this.nearest(cands, m.x, m.y);
  }

  /** Enemy units already inside our half get answered before anything else. */
  private threatToHome(state: GameState): { x: number; y: number } | null {
    const hq = state.bases.find((b) => b.isHQ && b.owner === this.me);
    if (!hq) return null;
    let best: { x: number; y: number } | null = null, bd = 420 * 420;
    for (const u of state.units) {
      if (u.owner === this.me || u.carried || u.hp <= 0) continue;
      const d = dist2(u.x, u.y, hq.x, hq.y);
      if (d < bd) { bd = d; best = u; }
    }
    return best;
  }

  /** Where a fresh unit is most useful: the nearest outpost we do not hold,
   *  falling back to the enemy HQ once the map is ours. */
  private frontLine(state: GameState): { x: number; y: number } | null {
    const m = state.mechs[this.me];
    const open = state.bases.filter((b) => !b.isHQ && b.owner !== this.me);
    const near = this.nearest(open, m.x, m.y);
    if (near) return near;
    return state.bases.find((b) => b.isHQ && b.owner === this.otherId) ?? null;
  }
}
