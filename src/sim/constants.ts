import type { OrderId, UnitType, UnitTypeId } from './types';

export const TICK_HZ = 30;
export const TICK_MS = 1000 / TICK_HZ;

// ---------------------------------------------------------------- economy ---
/** Income is paid every INCOME_PERIOD ticks: a flat HQ stipend plus a per-base
 *  cut. Holding outposts is the whole game, so the slope matters more than the
 *  intercept — a player at 6 bases should out-produce a player at 2 by ~2x. */
export const INCOME_PERIOD = TICK_HZ;          // once per second
export const INCOME_HQ = 20;
export const INCOME_PER_BASE = 12;
export const STARTING_MONEY = 300;
export const ORDER_REWRITE_COST = 20;

// -------------------------------------------------------------------- mech ---
export const MECH_HP = 340;
export const MECH_FUEL = 1000;
export const MECH_AMMO = 60;
/** Fuel burn is the metronome of the match: a full tank is ~40s of hard flying,
 *  which forces the constant base-to-front rhythm the original is built on. */
export const FUEL_BURN_JET = 0.72;
export const FUEL_BURN_WALKER = 0.20;
export const FUEL_BURN_IDLE = 0.05;
export const FUEL_BURN_CARRY = 0.28;           // extra while hauling a unit
export const MECH_RESUPPLY_RATE = 9;           // fuel per tick over a friendly base
export const MECH_REARM_RATE = 0.7;
export const MECH_REPAIR_RATE = 1.1;
export const MECH_RESPAWN_TICKS = TICK_HZ * 6;

export const JET_ACCEL = 0.085;
export const JET_MAX_SPEED = 4.2;
export const JET_TURN = 0.13;
export const WALKER_ACCEL = 0.16;
export const WALKER_MAX_SPEED = 1.9;
export const WALKER_TURN = 0.30;
export const MORPH_TICKS = 12;

export const MECH_SHOT_DAMAGE_WALKER = 15;
export const MECH_SHOT_DAMAGE_JET = 11;
export const MECH_COOLDOWN_WALKER = 7;
export const MECH_COOLDOWN_JET = 5;
export const MECH_RANGE = 150;
export const MECH_RADIUS = 18;
export const CARRY_PICKUP_RANGE = 46;

// ------------------------------------------------------------------- bases ---
export const HQ_HP = 3000;
export const OUTPOST_HP = 500;
export const BASE_RADIUS = 34;
export const HQ_RADIUS = 52;
/** Ticks of uncontested infantry presence to flip a neutral outpost. Enemy-held
 *  outposts must first be walked back to neutral, so trading bases is slow and
 *  deliberate while raiding an empty one is fast. */
export const CAPTURE_RATE = 1.4;
export const CAPTURE_FULL = 100;
export const BASE_HEAL_RATE = 0.35;            // friendly units heal near a base

// ---------------------------------------------------------------- combat ----
export const SUPPLY_RANGE = 70;
export const SUPPLY_REPAIR = 0.5;
export const SUPPLY_REARM = 0.35;
export const UNIT_SEPARATION = 0.55;           // soft push so columns don't stack

export const UNIT_TYPES: Record<UnitTypeId, UnitType> = {
  INFANTRY: {
    id: 'INFANTRY', name: 'Infantry', cost: 60, hp: 55, speed: 0.66, sight: 130,
    range: 62, damage: 4, cooldown: 14, radius: 7,
    canHitGround: true, canHitAir: true, canCapture: true, isSupport: false,
    amphibious: false, ammo: 120,
    blurb: 'The only unit that can take an outpost. Everything else is escort.',
  },
  BIKE: {
    id: 'BIKE', name: 'Recon Bike', cost: 80, hp: 45, speed: 1.45, sight: 210,
    range: 70, damage: 5, cooldown: 9, radius: 7,
    canHitGround: true, canHitAir: false, canCapture: false, isSupport: false,
    amphibious: false, ammo: 140,
    blurb: 'Fast eyes. Screens your flank and finds the push before it lands.',
  },
  ARMOR: {
    id: 'ARMOR', name: 'Armored Car', cost: 130, hp: 130, speed: 0.86, sight: 150,
    range: 88, damage: 11, cooldown: 12, radius: 10,
    canHitGround: true, canHitAir: true, canCapture: false, isSupport: false,
    amphibious: false, ammo: 110,
    blurb: 'The honest middle: shoots both layers, dies to anything specialised.',
  },
  TANK: {
    id: 'TANK', name: 'Main Tank', cost: 220, hp: 300, speed: 0.62, sight: 160,
    range: 108, damage: 30, cooldown: 22, radius: 12,
    canHitGround: true, canHitAir: false, canCapture: false, isSupport: false,
    amphibious: false, ammo: 70,
    blurb: 'Breaks lines and cracks HQs. Utterly blind to the sky.',
  },
  AA: {
    id: 'AA', name: 'Flak Track', cost: 150, hp: 110, speed: 0.84, sight: 200,
    range: 165, damage: 17, cooldown: 8, radius: 10,
    canHitGround: false, canHitAir: true, canCapture: false, isSupport: false,
    amphibious: false, ammo: 130,
    blurb: 'Denies airspace. Park it where the enemy mech has to fly.',
  },
  ARTILLERY: {
    id: 'ARTILLERY', name: 'Rocket Battery', cost: 260, hp: 90, speed: 0.48, sight: 120,
    range: 250, damage: 44, cooldown: 46, radius: 11,
    canHitGround: true, canHitAir: false, canCapture: false, isSupport: false,
    amphibious: false, ammo: 40,
    blurb: 'Outranges every base defence. Helpless the moment it is reached.',
  },
  SUPPLY: {
    id: 'SUPPLY', name: 'Supply Truck', cost: 110, hp: 80, speed: 0.92, sight: 170,
    range: 0, damage: 0, cooldown: 0, radius: 10,
    canHitGround: false, canHitAir: false, canCapture: false, isSupport: true,
    amphibious: false, ammo: Infinity,
    blurb: 'Rearms and patches the front so your mech never has to fly back.',
  },
};

export const BUILD_ORDER: UnitTypeId[] = [
  'INFANTRY', 'BIKE', 'ARMOR', 'TANK', 'AA', 'ARTILLERY', 'SUPPLY',
];

export const ORDERS: { id: OrderId; name: string; short: string; blurb: string }[] = [
  { id: 'CAPTURE',   name: 'Take Outpost', short: 'TAKE', blurb: 'Advance on the nearest outpost you do not own.' },
  { id: 'ASSAULT',   name: 'Assault HQ',   short: 'PUSH', blurb: 'Drive for the enemy HQ and kill what blocks it.' },
  { id: 'HUNT',      name: 'Search & Kill',short: 'HUNT', blurb: 'Chase the nearest enemy anywhere on the map.' },
  { id: 'GUARD',     name: 'Guard Area',   short: 'GRD',  blurb: 'Fight within a short radius of where you are dropped.' },
  { id: 'HOLD',      name: 'Hold Position',short: 'HOLD', blurb: 'Never move. Shoot whatever comes into range.' },
  { id: 'DEFEND_HQ', name: 'Defend Home',  short: 'HOME', blurb: 'Fall back and hold your own HQ.' },
  { id: 'ESCORT',    name: 'Escort Mech',  short: 'ESC',  blurb: 'Follow your mech and cover it.' },
  { id: 'SUPPORT',   name: 'Resupply',     short: 'SUP',  blurb: 'Seek out hurt or dry friendlies and service them.' },
];

export const GUARD_RADIUS = 190;
export const TERRAIN_SPEED: Record<number, number> = { 0: 1.0, 1: 0.55, 2: 0.0 };
