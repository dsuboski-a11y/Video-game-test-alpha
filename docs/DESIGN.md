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

### 6. The camera is 3/4 isometric

The original was flat top-down, because a Mega Drive rendering two split-screen
views had nothing spare. A dimetric (2:1) projection costs us nothing and buys
a great deal:

- **Terrain has relief.** Rough ground stands ~15 px proud and casts real cliff
  faces; water sits ~12 px sunken. Lakes and mesas read as obstacles at a glance
  instead of as coloured rectangles.
- **Units are solids, not icons.** Every unit is an extruded box with a lit top
  and two shaded side faces, drawn back-to-front by `x + y`. A tank in front of
  your commander actually occludes it.
- **Altitude is free information.** A jet flies 58 px above its own shadow, with
  a dotted mast connecting the two. You never read a UI element to know which
  layer someone is on — which matters, because the layer *is* the matchup.

Three implementation notes worth keeping:

- **The simulation never learns about any of this.** It stays flat and
  top-down. Projection lives in `src/render/iso.ts`, and the only other place
  that knows the camera angle exists is the one line in `main.ts` that rotates
  the thumbstick from screen space into world space. That separation is what
  keeps the netcode shipping plain world coordinates.
- **Elevation is visual only.** Pathing, ranges, and capture radii are unchanged,
  so the camera angle can never affect balance — or desync a match.
- **Terrain is drawn in three elevation bands** (water, plains, rough), each
  batched into a handful of fills. That is ~18 canvas fills per frame instead of
  one per visible tile, which is the difference between smooth and unplayable
  on a phone.

### 7. Sprites, and the transformation

Units are pixel art now, not vector shapes — but there are no image files in the
repo. Every sprite is **compiled at load time** from the solids in
`render/models.ts`: the compiler projects each part, software-rasterises it with
hard edges and a fixed material ramp, sorts by depth, and grows a one-pixel dark
outline around the silhouette. 480 frames — 7 unit types and the commander, at
16 facings, in two team colours — bake in about 100 ms and cost nothing to
download.

Rasterising rather than drawing vectors live is the whole point. Canvas fills
are antialiased, so shapes drawn each frame always look soft; scanline-filling
into an index buffer and blitting with smoothing off gives genuine chunky pixels.

**The transformation is a real animation, not a cut.** The walker pose and the
jet pose hold *the same parts in the same order*, so a frame is simply the two
poses blended. The legs swing back and shrink into tail fins, the shoulders
sweep out and flatten into wings, the torso stretches into a fuselage, the head
slides forward into a nose, and the shoulder cannon tucks under a wing. Nine
frames are baked across that fold, and the mech's altitude rides the same curve
so it lifts off as it folds. It takes 0.7 seconds, which is long enough to watch
and long enough that morphing in front of an enemy is a decision rather than a
reflex.

That the poses correspond part-for-part is the entire trick, and it is why the
transformation is worth having: it is what people actually remember about the
game it descends from.

### 8. Built for one person on one phone

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

### Netcode, and what the architecture actually bought

Multiplayer is deterministic lockstep over a WebRTC data channel. Peers exchange
`TickInput` records — a quantised stick vector, three button bits, an optional
buy — and expand them into the same `Command[]` the solo game already used. The
simulation was not modified at all to support it.

```
src/net/protocol.ts   wire format; TickInput -> Command[] in a fixed order
src/net/session.ts    signalling, peer setup, input buffers, checksums
src/sim/checksum.ts   FNV-1a over the state that drives the match
server/signal.mjs     room-code lobby; relays the handshake, then bows out
```

The claim in the first version of this document was that multiplayer would be an
input-transport problem rather than a rewrite. That held: ~500 new lines, zero
changes to `src/sim/step.ts`.

Three decisions worth recording:

- **The channel is unreliable and unordered on purpose.** A retransmitted packet
  that arrives late is worse than one that never arrives. Every packet instead
  carries a 12-tick sliding window, so short loss bursts heal with no round trip.
- **A stalled peer must keep talking.** If both peers drop a packet at the same
  moment, each waits for a tick the other already produced, and because neither
  advances, neither sends again. That is a permanent freeze. A heartbeat while
  stalled is the whole fix, and it is not obvious until it happens.
- **Command order is fixed by player index**, not by arrival order. Two peers
  building their command list in different orders would desync within seconds.

### Testing

- `npm run typecheck` — strict TypeScript, no `any` in the simulation.
- `npm run selfplay -- 30 OFFICER` — balance and match-length statistics.
- `npm run smoke` — boots the built game in headless Chromium at iPhone
  landscape resolution, plays it, and fails on any console error, any HTTP
  error, a stalled capture loop, or a thumbstick that does not move the mech.
- `npm run netcheck` — starts the lobby, opens two headless browsers, pairs them
  by room code over real WebRTC, drives both sticks, buys a unit on one side,
  and asserts both peers finish on the same tick with identical commander
  positions and no desync.

#### A fourth: circles are not circles

A circle of world radius r on the ground plane does not project to an ellipse of
semi-axes (r, r/2). The extreme points land on the diagonal after the shear, so
the true semi-axes are `r·ISO_X·√2` and `r·ISO_Y·√2` — about 30% smaller. Every
base pad, shadow, capture ring and shockwave was drawn 41% oversized, which read
as "the HQ is enormous" rather than as a projection error. Fixed with a single
`isoEllipse` helper that every ground-plane circle now goes through.

#### A third bug, caught by the netcode test

The two fairness bugs above were found by asserting on simulation state. The
netcode test found a blunter one: after fifteen seconds of dragging, **both
commanders were still at their exact spawn coordinates**.

`#ui` is `pointer-events: none` so the canvas shows through it, and `#ui > *`
re-enables events only for actual HUD elements. The thumbstick listener was
bound to `#ui` itself — so a thumb landing on empty screen hit nothing at all.
The virtual joystick had never worked in any build; every screenshot had shown
a commander parked on its own pad, and nothing had ever asserted otherwise.

The fix is a dedicated full-screen capture layer stacked beneath the HUD
controls. The lesson is the same one the fairness bugs taught: a test that only
checks for the absence of errors will happily pass a game nobody can play.
