/**
 * Deterministic PRNG (mulberry32). The simulation must never touch Math.random:
 * every peer replaying the same command stream has to land on the same state,
 * which is what makes lockstep netcode possible later.
 */
export class Rng {
  private s: number;
  constructor(seed: number) { this.s = seed >>> 0; }

  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number { return min + this.next() * (max - min); }
  int(min: number, maxExclusive: number): number { return Math.floor(this.range(min, maxExclusive)); }
  pick<T>(arr: readonly T[]): T { return arr[this.int(0, arr.length)]; }
  get state(): number { return this.s; }
  set state(v: number) { this.s = v >>> 0; }
}
