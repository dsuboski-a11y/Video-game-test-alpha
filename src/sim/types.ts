export type PlayerId = 0 | 1;

/** The eight standing orders a unit can be given. Orders are set at purchase and
 *  may be rewritten (for a fee) while the unit is being carried by a mech —
 *  the single most important tension in the design. */
export type OrderId =
  | 'HOLD'        // fight from where you were dropped, never move
  | 'GUARD'       // fight within a radius of the drop point, then return to it
  | 'CAPTURE'     // advance on the nearest capturable outpost
  | 'ASSAULT'     // head for the enemy HQ, fighting what blocks the way
  | 'HUNT'        // search and destroy: chase the nearest enemy anywhere
  | 'DEFEND_HQ'   // fall back and hold the home HQ
  | 'ESCORT'      // follow the friendly mech
  | 'SUPPORT';    // seek damaged/dry friendlies and resupply them

export type UnitTypeId =
  | 'INFANTRY' | 'BIKE' | 'ARMOR' | 'TANK' | 'AA' | 'ARTILLERY' | 'SUPPLY';

export type Terrain = 0 | 1 | 2; // 0 plains, 1 rough, 2 water

export interface UnitType {
  id: UnitTypeId;
  name: string;
  cost: number;
  hp: number;
  speed: number;        // world units per tick on plains
  sight: number;
  range: number;
  damage: number;
  cooldown: number;     // ticks between shots
  radius: number;
  canHitGround: boolean;
  canHitAir: boolean;
  canCapture: boolean;
  isSupport: boolean;
  amphibious: boolean;
  ammo: number;         // shots before it needs resupply; Infinity for none
  blurb: string;
}

export interface Base {
  id: number;
  x: number; y: number;
  owner: PlayerId | -1;   // -1 neutral
  isHQ: boolean;
  hp: number;
  maxHp: number;
  /** Capture progress, signed: >0 toward player 0, <0 toward player 1. */
  capture: number;
  radius: number;
}

export interface Unit {
  id: number;
  type: UnitTypeId;
  owner: PlayerId;
  x: number; y: number;
  vx: number; vy: number;
  facing: number;
  hp: number;
  ammo: number;
  cooldown: number;
  order: OrderId;
  /** Anchor point for HOLD/GUARD — set to where the mech let go of it. */
  anchorX: number; anchorY: number;
  targetId: number;      // enemy unit/mech being shot at, -1 none
  /** Where this unit's *order* is sending it. Navigation only. */
  targetBaseId: number;  // -1 none
  /** Enemy structure currently being shot at. Deliberately separate from
   *  targetBaseId: conflating the two made every capture order walk to the
   *  enemy HQ instead of the outpost next to it. */
  fireBaseId: number;    // -1 none
  carried: boolean;      // riding a mech, inert
  repathIn: number;
  wanderSeed: number;
}

export type MechMode = 'WALKER' | 'JET';

export interface Mech {
  owner: PlayerId;
  x: number; y: number;
  vx: number; vy: number;
  facing: number;
  mode: MechMode;
  /** 0..1 transform animation progress; the mech is vulnerable mid-morph. */
  morph: number;
  hp: number;
  fuel: number;
  ammo: number;
  cooldown: number;
  carryingUnitId: number; // -1 none
  downTimer: number;      // >0 while destroyed and respawning
  alive: boolean;
}

export interface Projectile {
  id: number;
  owner: PlayerId;
  x: number; y: number;
  vx: number; vy: number;
  life: number;
  damage: number;
  hitsAir: boolean;
  hitsGround: boolean;
  kind: 'BULLET' | 'SHELL' | 'MISSILE' | 'BEAM';
  targetId: number; // for homing missiles; -1 otherwise
}

export interface Effect {
  id: number;
  x: number; y: number;
  kind: 'EXPLOSION' | 'SPARK' | 'CAPTURE' | 'PICKUP' | 'REPAIR';
  age: number;
  life: number;
  scale: number;
}

export interface PlayerState {
  id: PlayerId;
  money: number;
  /** Rolling stats, for the post-match screen and for tournament scoring. */
  spent: number;
  unitsBuilt: number;
  unitsLost: number;
  kills: number;
}

export interface MapData {
  w: number; h: number;         // in tiles
  tile: number;                 // world units per tile
  terrain: Uint8Array;          // w*h
}

export interface GameState {
  tick: number;
  seed: number;
  rngState: number;
  map: MapData;
  bases: Base[];
  units: Unit[];
  mechs: [Mech, Mech];
  projectiles: Projectile[];
  effects: Effect[];
  players: [PlayerState, PlayerState];
  nextEntityId: number;
  winner: PlayerId | -1 | null; // null = still playing, -1 = draw
  /** Purely presentational, drained by the renderer/audio each frame. */
  events: SimEvent[];
}

export type SimEvent =
  | { t: 'shot'; kind: Projectile['kind']; x: number; y: number }
  | { t: 'explode'; x: number; y: number; big: boolean }
  | { t: 'pickup'; x: number; y: number }
  | { t: 'drop'; x: number; y: number }
  | { t: 'capture'; x: number; y: number; owner: PlayerId }
  | { t: 'build'; owner: PlayerId }
  | { t: 'denied'; owner: PlayerId }
  | { t: 'hqhit'; owner: PlayerId }
  | { t: 'win'; owner: PlayerId | -1 };

/** Everything a player can do in one tick. Lockstep multiplayer ships exactly
 *  this list between peers — never entity state. */
export interface MechInput {
  mx: number;      // -1..1 desired move
  my: number;
  fire: boolean;
  transform: boolean;  // edge-triggered by the input layer
  grab: boolean;       // edge-triggered: pick up / put down
}

export type Command =
  | { c: 'INPUT'; p: PlayerId; in: MechInput }
  | { c: 'BUY'; p: PlayerId; unit: UnitTypeId; order: OrderId }
  | { c: 'ORDER'; p: PlayerId; order: OrderId };  // rewrite carried unit's order
