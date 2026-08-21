import type { GameState } from './types';

/**
 * FNV-1a over the parts of the state that actually drive the match.
 *
 * Lockstep peers must compute bit-identical states; if they ever diverge, the
 * two players are silently playing different games. Exchanging this hash every
 * so often turns that from an unexplainable "he says he won" into a reported
 * bug with a tick number attached.
 *
 * Positions are quantised to 1/256 of a world unit before hashing. Anything
 * coarser would let real divergence hide; anything finer just makes the hash
 * sensitive to noise it would catch a few ticks later anyway.
 */
export function checksum(state: GameState): number {
  let h = 0x811c9dc5;
  const mix = (v: number): void => {
    h ^= v | 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  };
  const q = (v: number): void => mix(Math.round(v * 256));

  mix(state.tick);
  mix(state.rngState);
  mix(state.units.length);
  mix(state.projectiles.length);

  for (const p of state.players) { q(p.money); mix(p.unitsBuilt); mix(p.unitsLost); }
  for (const m of state.mechs) {
    q(m.x); q(m.y); q(m.vx); q(m.vy); q(m.facing);
    q(m.hp); q(m.fuel); q(m.ammo);
    mix(m.mode === 'JET' ? 1 : 0); mix(m.morph); mix(m.carryingUnitId); mix(m.alive ? 1 : 0);
  }
  for (const b of state.bases) { mix(b.owner); q(b.hp); q(b.capture); }
  for (const u of state.units) {
    mix(u.id); q(u.x); q(u.y); q(u.hp); q(u.facing);
    mix(u.targetId); mix(u.targetBaseId);
  }
  return h >>> 0;
}
