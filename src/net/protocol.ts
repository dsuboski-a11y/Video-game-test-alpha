import type { Command, MechInput, OrderId, PlayerId, UnitTypeId } from '../sim/types';

/** Ticks between producing an input and executing it. At 30 Hz, 3 ticks is
 *  100 ms of slack — enough to cover same-room latency without the controls
 *  feeling detached. */
export const INPUT_DELAY = 3;

/** How many past ticks ride along in every packet. The data channel is
 *  unreliable by design (a late packet is worse than a lost one), so instead of
 *  retransmit logic we simply resend a sliding window; a loss burst shorter
 *  than this heals itself with no round trip. */
export const REDUNDANCY = 12;

/** How often peers compare state hashes. */
export const CHECKSUM_PERIOD = 30;

export const BIT_FIRE = 1, BIT_TRANSFORM = 2, BIT_GRAB = 4;

/** One player's complete intent for one tick — the only thing that crosses the
 *  wire. Never entity state, so bandwidth is independent of army size. */
export interface TickInput {
  t: number;    // tick index
  x: number;    // stick, quantised to -127..127
  y: number;
  b: number;    // button bits
  u?: UnitTypeId;  // buy: unit
  o?: OrderId;     // buy: order, or (with r) the rewrite target
  r?: 1;           // this tick's order field is a rewrite, not a buy
}

export type PeerMsg =
  | { k: 'in'; f: TickInput[] }
  | { k: 'sum'; t: number; h: number }
  | { k: 'bye' };

export type SignalMsg =
  | { k: 'host' }
  | { k: 'join'; code: string }
  | { k: 'hosted'; code: string }
  | { k: 'ready'; seed: number; slot: 0 | 1 }
  | { k: 'sdp'; sdp: unknown }
  | { k: 'ice'; ice: unknown }
  | { k: 'peerleft' }
  | { k: 'err'; msg: string };

export const NEUTRAL_INPUT = (t: number): TickInput => ({ t, x: 0, y: 0, b: 0 });

export function encodeInput(
  t: number, mech: MechInput,
  buy: { unit: UnitTypeId; order: OrderId } | null,
  rewrite: OrderId | null,
): TickInput {
  const out: TickInput = {
    t,
    x: Math.max(-127, Math.min(127, Math.round(mech.mx * 127))),
    y: Math.max(-127, Math.min(127, Math.round(mech.my * 127))),
    b: (mech.fire ? BIT_FIRE : 0) | (mech.transform ? BIT_TRANSFORM : 0) |
       (mech.grab ? BIT_GRAB : 0),
  };
  if (buy) { out.u = buy.unit; out.o = buy.order; }
  else if (rewrite) { out.o = rewrite; out.r = 1; }
  return out;
}

/**
 * Expand both players' tick inputs into the command list the simulation eats.
 * Order is fixed by player index and command kind so that both peers build a
 * byte-identical list — the whole scheme rests on this being deterministic.
 */
export function toCommands(inputs: [TickInput, TickInput]): Command[] {
  const cmds: Command[] = [];
  for (const p of [0, 1] as PlayerId[]) {
    const i = inputs[p];
    cmds.push({
      c: 'INPUT', p,
      in: {
        mx: i.x / 127, my: i.y / 127,
        fire: (i.b & BIT_FIRE) !== 0,
        transform: (i.b & BIT_TRANSFORM) !== 0,
        grab: (i.b & BIT_GRAB) !== 0,
      },
    });
  }
  for (const p of [0, 1] as PlayerId[]) {
    const i = inputs[p];
    if (i.u && i.o) cmds.push({ c: 'BUY', p, unit: i.u, order: i.o });
    else if (i.o && i.r) cmds.push({ c: 'ORDER', p, order: i.o });
  }
  return cmds;
}
