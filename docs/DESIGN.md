# EISENKRIEG — design

What we kept, what we changed, and why. The short version: the 1989 systems are
sound and we kept nearly all of them. What we changed is everything that only
existed because the target was a 1989 console with a D-pad, two buttons, and a
split screen shared by two people on one couch.

---

## The pitch

You are a transforming mech. You are also the general. Buy troops at a base,
**lift** them, fly them to the front, and **set them down with a standing
order**. Morph to walker to fight the ground war; morph to jet to move fast and
duel the sky. Fuel runs out. Outposts pay for everything. Kill the enemy HQ.

One match is three to six minutes.

---

## Kept from the original

| System | Status |
|---|---|
| Commander-as-unit | **Kept whole.** The entire game hangs off it. |
| Jet / walker duality | **Kept, sharpened.** See "layers" below. |
| Pick up and carry units | **Kept whole.** |
| Re-order only while carried, for a fee | **Kept whole** (20 credits). |
| Infantry is the only capturer | **Kept whole.** |
| Income scales with bases held | **Kept whole.** |
| Bases as spawn / repair / refuel pads | **Kept whole.** |
| Fuel and ammo on the commander | **Kept whole.** |
| Supply trucks that auto-service the front | **Kept whole.** |
| Eight standing orders | **Kept**, re-specified for clarity (below). |
| Win by destroying the enemy HQ | **Kept whole.** |

## Changed

### 1. Layers are now strict, and readable at a glance

In the original, mode choice mattered but the interaction was fuzzy. Here it is
a hard rule and it is the central rock-paper-scissors:

- A **jet** is an *air* target. A **walker** is a *ground* target.
- A jet's weapon hits **air only**. A walker's weapon hits **both**.
- Flak tracks hit **air only**. Tanks and artillery hit **ground only**.

So: park flak where the enemy commander must fly, and their airlift stops. Go
walker to fight the ground war and you are a target for every tank on the map.
**Choosing a mode is choosing which war you are in.** A jet cannot bail out its
own collapsing front line, which is exactly the tension we want.

To make this legible on a small screen, a jet **casts a displaced shadow** and
flies visually offset from its ground position. You never have to read a UI
element to know which layer someone is on.

### 2. Units walk themselves; carrying is a *tempo* weapon

Units given `TAKE OUTPOST` will path across the map on their own. Airlifting one
gets it there in seconds instead of a minute. Carrying is therefore not a chore
you must perform for every unit — it is the tool you reach for when tempo
matters, which is what makes deciding *when* to carry interesting instead of
mandatory.

### 3. The eight orders, re-specified

| Order | Behaviour |
|---|---|
| **Take Outpost** | Advance on the nearest outpost you do not own. The economic order. |
| **Assault HQ** | Drive for the enemy HQ, killing what blocks the way. |
| **Search & Kill** | Chase the nearest enemy anywhere on the map. |
| **Guard Area** | Fight within ~190 units of the drop point, then return to it. |
| **Hold Position** | Never move. Shoot what comes into range. |
| **Defend Home** | Fall back and hold your own HQ. |
| **Escort Mech** | Follow your commander and cover it. |
| **Resupply** | Seek out hurt or dry friendlies and service them. |

The order is chosen *at purchase*, shown on the carried-unit chip while in
flight, and rewritable mid-air for 20 credits. That chip is the strategic hinge
of the interface: it is the moment where you look at the battlefield and decide
this tank is no longer an attacker, it is a wall.

### 4. Capturing an enemy outpost costs double

A neutral outpost flips on uncontested infantry presence. An **enemy-held**
outpost must first be walked back to neutral, then captured. Trading bases is
slow and deliberate; raiding an undefended one is fast. This is what makes
map position sticky enough to be worth defending.

### 5. Scarcity is the balance lever

Income is `20/s` for your HQ plus `12/s` per outpost. At two bases you make
32/s; at eight you make 104/s. A main tank is 220. The snowball is real but
survivable, and the losing player can always afford infantry — which is the
unit that reverses a snowball.

### 6. Built for one person on one phone

- **Split-screen is gone.** Two players means two devices.
- **Twin-thumb controls**: a floating stick under the left thumb (origin lands
  where you touch, and follows if you over-travel — you never look at your left
  hand), a FIRE / MORPH / LIFT / BUILD cluster under the right.
- **Build is three taps, then one.** Unit → order → done, with a REPEAT card
  at the top of the sheet that re-buys your last combination in a single tap.
- **The screen edge reports.** Off-screen arrows point at the enemy commander
  and at any of your bases under fire, because a phone viewport is too small to
  rely on the camera alone.
- **Time keeps running while the build sheet is open**, but your inputs are
  frozen. You buy while standing on a pad, so the risk is honest and you cannot
  accidentally fly into a lake while shopping.

---

## The unit roster

| Unit | Cost | HP | Range | Hits | Role |
|---|---:|---:|---:|---|---|
| Infantry | 60 | 55 | 62 | GND/AIR | The only unit that captures. Everything else is escort. |
| Recon Bike | 80 | 45 | 70 | GND | Fast eyes. Finds the push before it lands. |
| Armored Car | 130 | 130 | 88 | GND/AIR | The honest middle. Dies to anything specialised. |
| Main Tank | 220 | 300 | 108 | GND | Breaks lines and cracks HQs. Blind to the sky. |
| Flak Track | 150 | 110 | 165 | AIR | Denies airspace. Park it where the mech must fly. |
| Rocket Battery | 260 | 90 | 250 | GND | Outranges every base defence. Helpless once reached. |
| Supply Truck | 110 | 80 | — | — | Rearms and patches the front. |

Every number here was tuned against the self-play harness, not guessed. See
below.

---

## Architecture, and why it looks like this

```
src/
  sim/        pure simulation — no DOM, no canvas, no timers
    types.ts     GameState, Unit, Mech, Command
    constants.ts every balance number, in one file
    world.ts     seeded map generation
    nav.ts       one BFS flow field per base
    step.ts      step(state, commands[], ctx) -> void
  ai/bot.ts     an opponent that emits the same Commands a player does
  render/       canvas drawing, reads state, never writes it
  input/        touch + keyboard -> Commands
  ui/           DOM HUD
  tools/        headless self-play harness
```

**The simulation is a pure function of `(state, commands)`.** No `Math.random`
anywhere inside it — a seeded PRNG lives in the state. No wall-clock time. No
rendering. Nothing in `sim/` imports anything from `render/`, `ui/`, or `input/`.

This is not tidiness for its own sake. It buys three specific things:

1. **Multiplayer without a rewrite.** Deterministic lockstep means peers
   exchange *inputs*, not entity state — a few dozen bytes per tick regardless
   of army size. The `Command` type is already the wire format.
2. **A real balance harness.** `npm run selfplay -- 30` plays thirty complete
   AI-vs-AI matches, headless, in about nine seconds — roughly 2¼ hours of
   game time per second of wall clock. Balance questions get answered with data
   in the time it takes to ask them.
3. **Fairness you can prove.** Because the sim is deterministic and the map is
   generated symmetrically, "is this map fair?" is a testable assertion rather
   than a vibe. It found two real bugs — see below.

### Two bugs the harness caught that playtesting would have missed

Both produced a **~70/30 win rate for one side** in mirror matches, and both
were completely invisible frame to frame.

**One: the flow field had a compass bias.** Units navigate by descending a BFS
cost field. The original implementation picked the cheapest neighbouring tile
and broke ties by list order — and the neighbour list started with `[+1, 0]`.
On open ground, where costs tie constantly, every unit on the map drifted
slightly *east*. One player's army advanced; the other's leaned homeward. Fixed
by taking a central-difference gradient instead, which has no preferred axis.

**Two: the map was not actually symmetric.** Terrain and base coordinates
mirrored perfectly — but bases sat on tile *boundaries*, and everything
downstream quantises with `floor()`. `floor()` rounds the same direction on both
halves, so a base and its mirror image resolved to rows one tile apart, and
their flow fields stopped being reflections of each other. Fixed by making the
map odd-sized in both axes (so a true centre tile exists) and placing every base
at a tile *centre*.

After both fixes, mirror matches run 15/15, 20/20, 21/19 across difficulties.
Neither bug was findable by playing; both were trivial to find by asserting that
`field(base A)` mirrored equals `field(base A')`.

### Testing

- `npm run typecheck` — strict TypeScript, no `any` in the simulation.
- `npm run selfplay -- 30 OFFICER` — balance and match-length statistics.
- `npm run smoke` — boots the built game in headless Chromium at iPhone
  landscape resolution, plays it, and fails on any console error, any HTTP
  error, or a stalled capture loop.
