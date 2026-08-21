# EISENKRIEG

A carry-and-command real-time strategy game that runs in a phone browser, with
no install. You are the commander *and* a unit on the field: buy troops at a
base, lift them, fly them to the front, and set them down with a standing order.

Built as an original game in the tradition of the 1989 Genesis strategy classic
that invented the genre. See [`docs/RESEARCH.md`](docs/RESEARCH.md) for what
that lineage is, and what of it is legally ours to use (short version: the
*systems* are, the *name and assets* are not — hence our own name, art, music,
and balance).

---

## Play it

```bash
npm install
npm run dev        # then open the printed Network URL on your phone
```

`npm run dev` binds to `0.0.0.0`, so any phone on the same Wi-Fi can open the
Network URL directly. Landscape, twin-thumb controls.

**Touch:** left thumb steers · **FIRE** holds · **JET/WALK** morphs ·
**LIFT** picks up and puts down · **BUILD** deploys.
**Desktop:** `WASD` move · `J` fire · `K` morph · `L` lift · `B` build.

## Build

```bash
npm run build      # typecheck + production bundle -> dist/  (~22 KB gzipped)
npm run preview
```

The output is a static directory. Any static host works; it is a PWA, so it
caches offline and installs to the home screen without an app store.

## Test

```bash
npm run typecheck
npm run selfplay -- 30 OFFICER      # 30 headless AI-vs-AI matches, ~9 seconds
npm run selfplay -- 20 CADET MARSHAL
npm run smoke                       # boots the built game in headless Chromium
```

`selfplay` is the balance harness — it plays complete matches with no renderer
and reports win rates, match lengths, and army sizes. It is fast because the
simulation is pure: roughly **2¼ hours of game time per second of wall clock**.

## How it is put together

```
src/sim/      pure simulation: step(state, commands) -> void, no DOM, no clock
src/ai/       an opponent that emits the same Commands a human does
src/render/   canvas drawing; reads state, never writes it
src/input/    touch + keyboard -> Commands
src/ui/       DOM HUD
src/tools/    headless self-play harness
```

The simulation is deterministic and seeded — no `Math.random`, no wall-clock
time, no rendering. That is what makes the balance harness possible, and it is
what will make lockstep multiplayer an input-transport problem rather than a
rewrite. See [`docs/DESIGN.md`](docs/DESIGN.md).

## Where it is going

Two phones in the same room, then two phones anywhere, then voice with
translation, then ranked play and replays. Options and trade-offs are written up
in [`docs/ROADMAP.md`](docs/ROADMAP.md), including the honest risks — float
determinism across mobile JS engines, and translation latency.

## Status

Single-player versus AI, three difficulties, fully playable start to finish.
Multiplayer is not built yet. Known gaps are listed at the bottom of the
roadmap.
