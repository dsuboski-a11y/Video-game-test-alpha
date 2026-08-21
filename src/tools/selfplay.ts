/**
 * Headless balance harness. Runs complete matches with two bots and no
 * renderer at all — which is only possible because the simulation is a pure
 * function of (state, commands). The same property is what will let two phones
 * run the same match in lockstep.
 *
 *   npx esbuild src/tools/selfplay.ts --bundle --platform=node --format=esm \
 *     --outfile=dist-tools/selfplay.mjs && node dist-tools/selfplay.mjs
 */
import { Bot, type Difficulty } from '../ai/bot';
import { TICK_HZ } from '../sim/constants';
import { createContext, step } from '../sim/step';
import type { Command, PlayerId } from '../sim/types';
import { createGame } from '../sim/world';

interface Result {
  winner: PlayerId | -1 | null;
  seconds: number;
  built: [number, number];
  lost: [number, number];
  basesHeld: [number, number];
  peakUnits: number;
}

export function playMatch(seed: number, a: Difficulty, b: Difficulty, maxSeconds = 900): Result {
  const state = createGame(seed);
  const ctx = createContext(state);
  const bots = [new Bot(0, a, seed ^ 0x1234), new Bot(1, b, seed ^ 0x9876)];
  const maxTicks = maxSeconds * TICK_HZ;
  let peakUnits = 0;

  while (state.winner === null && state.tick < maxTicks) {
    const cmds: Command[] = [];
    for (const bot of bots) cmds.push(...bot.think(state));
    step(state, cmds, ctx);
    if (state.units.length > peakUnits) peakUnits = state.units.length;
  }

  const held = (p: PlayerId) => state.bases.filter((x) => x.owner === p).length;
  return {
    winner: state.winner,
    seconds: Math.round(state.tick / TICK_HZ),
    built: [state.players[0].unitsBuilt, state.players[1].unitsBuilt],
    lost: [state.players[0].unitsLost, state.players[1].unitsLost],
    basesHeld: [held(0), held(1)],
    peakUnits,
  };
}

const N = Number(process.argv[2] ?? 8);
const diff = (process.argv[3] as Difficulty) ?? 'OFFICER';
const diffB = (process.argv[4] as Difficulty) ?? diff;
const results: Result[] = [];
const t0 = Date.now();
for (let i = 0; i < N; i++) results.push(playMatch(0x1000 + i * 977, diff, diffB));

const wins = [0, 0, 0]; // p0, p1, unresolved
for (const r of results) {
  if (r.winner === 0) wins[0]++;
  else if (r.winner === 1) wins[1]++;
  else wins[2]++;
}
const decided = results.filter((r) => r.winner === 0 || r.winner === 1);
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

console.log(`\n${N} ${diff} vs ${diffB} matches in ${((Date.now() - t0) / 1000).toFixed(1)}s real time\n`);
console.log(`  decided        ${decided.length}/${N}   (p0 ${wins[0]} / p1 ${wins[1]} / unresolved ${wins[2]})`);
console.log(`  match length   ${avg(decided.map((r) => r.seconds)).toFixed(0)}s avg` +
  (decided.length ? `  [${Math.min(...decided.map((r) => r.seconds))}-${Math.max(...decided.map((r) => r.seconds))}s]` : ''));
console.log(`  units built    ${avg(results.map((r) => r.built[0] + r.built[1])).toFixed(0)} per match`);
console.log(`  peak army      ${avg(results.map((r) => r.peakUnits)).toFixed(0)} units on field`);
console.log(`  bases at end   ${avg(results.map((r) => r.basesHeld[0])).toFixed(1)} vs ${avg(results.map((r) => r.basesHeld[1])).toFixed(1)}\n`);
for (const r of results.slice(0, 6)) {
  console.log(`    winner ${r.winner === null ? 'timeout' : r.winner === -1 ? 'draw' : `p${r.winner}`}` +
    `  ${String(r.seconds).padStart(4)}s  built ${r.built.join('/')}  lost ${r.lost.join('/')}  bases ${r.basesHeld.join('/')}`);
}
