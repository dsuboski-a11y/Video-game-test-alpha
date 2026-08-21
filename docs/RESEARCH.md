# Herzog Zwei: what it actually was, and what is safe to reuse

Research notes behind this project. Everything here is either sourced (linked)
or explicitly flagged as our own design decision.

---

## 1. The game

**Herzog Zwei** — Technosoft, Sega Mega Drive / Genesis, 1989. Sequel to
**Herzog** (1988, MSX2, Japan only). Widely credited as the direct ancestor of
the modern RTS; Westwood's *Dune II* (1992) and everything downstream of it owe
it the core loop of "build economy, produce units, fight in real time."

It is also, notably, a game that almost nobody actually played the way it was
designed: it shipped as a **split-screen two-player** game first and a
single-player game second, at a time when a second Genesis controller and a
friend on the couch were the only way to see it at its best.

### The loop

You are not a cursor. **You are a unit on the field** — a transforming mech
that is simultaneously your commander, your transport, your repair truck, and
your best weapon. Every strategic decision costs you tactical presence, and
vice versa. That single idea is the whole game.

| System | How it worked |
|---|---|
| **Transformation** | Two modes: a **jet** (fast, flies over terrain, for travel and air combat) and a **walker/robot** (slow, hovers at ground level, fights the ground war). Mode selection is a real commitment, not a cosmetic. |
| **Economy** | Neutral **bases** scattered across the map generate income. Gold accrued **per second, scaled by how many bases you hold** — reported in the wild as multiples of forty. Bases also act as forward spawn points, repair pads, and refuelling stops. |
| **Capture** | Only **infantry** can take a base. Everything else in your army exists to get infantry there alive. |
| **Production** | You buy units at a base. They do not teleport to the front. |
| **Airlift** | You **physically pick units up and carry them**. This is the famous mechanic. Carrying is also **the only time a unit can be repaired or re-ordered**. |
| **Standing orders** | Units are not directly controlled. Each is assigned one of **eight mission orders** at purchase — hold a position, patrol an area, fight within a radius, move on / attack / occupy a specific base, head for the enemy main base, and so on. **Re-assigning an order costs money.** |
| **Supply** | Both the mech and its units consume **fuel and ammunition**. The mech refuels and repairs at a friendly base; ground units are serviced by **supply trucks** that seek out depleted friendlies automatically. |
| **Win condition** | Destroy the enemy main base. |

### Why it is still interesting in 2026

Three things, none of which the genre kept:

1. **Indirect control as the core verb.** You cannot micro. You can only choose
   *what to build, what order to give it, and where to physically put it.* Once
   a unit is on the ground it is out of your hands. This makes the game about
   anticipation rather than reflexes — and it is *why* the described experience
   of "lose a direct fight, respond by switching to economy or by pushing units
   forward instead" works. Losing a fight does not lose you the match; it costs
   you a position, and positions are recoverable.
2. **The commander is a body.** Every second spent hauling a tank is a second
   not spent defending. Fuel makes that trade-off tick audibly.
3. **Fuel as a metronome.** The frantic pace people remember is not action —
   it is *logistics pressure*. You are always slightly behind on something.

### Sources

- [Wikipedia — Herzog Zwei](https://en.wikipedia.org/wiki/Herzog_Zwei)
- [Hardcore Gaming 101 — Herzog Zwei](https://www.hardcoregaming101.net/herzog-zwei/)
- [TV Tropes — Herzog Zwei](https://tvtropes.org/pmwiki/pmwiki.php/VideoGame/HerzogZwei)
- [Inverse — *Herzog Zwei* Still Stands Out In The Genre It Created](https://www.inverse.com/gaming/herzog-zwei-sega-genesis-anniversary-rts)
- [Giant Bomb — Herzog Zwei](https://www.giantbomb.com/herzog-zwei/3030-11439/)
- [GameFAQs strategy guide (CTVector)](https://gamefaqs.gamespot.com/genesis/473001-herzog-zwei/faqs/35412)

> **Note on exact numbers.** Unit costs, hit points and per-order pricing from
> the original are not reliably documented online, and we did not want to
> publish invented figures as if they were history. Every number in this
> project's balance tables is **ours**, tuned against our own simulation (see
> `docs/DESIGN.md`). The *systems* are faithful; the *values* are new.

---

## 2. The background check

You asked, reasonably, whether there is anything unpleasant behind the name
before we build a family business on top of it. Short answer: **no.** Longer
answer:

- **"Herzog Zwei" is German for "Duke Two."** *Herzog* is a hereditary title of
  nobility — the German equivalent of "duke" — in continuous use since the
  early medieval period, roughly a thousand years before the twentieth century.
  *Zwei* is simply the numeral 2, marking it as the sequel to *Herzog* (1988).
- **The developer was Japanese.** Technosoft, of Nagoya — best known for the
  *Thunder Force* shooters. The German is what TV Tropes files under
  ["Gratuitous German"](https://tvtropes.org/pmwiki/pmwiki.php/VideoGame/HerzogZwei):
  a late-80s Japanese studio using European military vocabulary for texture,
  exactly as countless anime and games of the era did. The level names follow
  the same pattern.
- **The game's factions are invented.** It is a science-fiction war between two
  fictional forces with fictional mechs. There is no real-world conflict, no
  historical iconography, and no political content to inherit.
- **No individual to vet.** Technosoft dissolved as a game developer; its
  library passed to Twenty-One Company and then, in September 2016, to **Sega**,
  which acquired the intellectual property and development rights to the whole
  Technosoft catalogue ([SEGAbits](https://segabits.com/blog/2016/09/17/sega-announces-acquisition-of-technosofts-ips/),
  [Nintendo Life](https://www.nintendolife.com/news/2016/09/sega_has_acquired_the_ip_of_one_of_japans_most_underrated_studios)).
  There is no founder or rights-holder whose politics attach to the name.

So the heritage is clean. Nothing in this project carries any of it forward
regardless — see below.

---

## 3. The legal position, which is the part that actually matters

This is the constraint that shapes the whole product, so it is worth being
blunt about it.

**Sega owns Herzog Zwei.** Name, characters, art, music, maps, and the specific
expression of the game. They have shipped it commercially as recently as the
*Sega Ages* line. It is an actively maintained asset, not an abandoned one.

**What you cannot do:**

- Call the game *Herzog Zwei*, or anything a reasonable person would mistake
  for it.
- Copy its sprites, its music, its map layouts, its unit names, its UI, or its
  text.
- Ship the ROM, or a "port," or an emulator wrapper with the ROM inside.
- Market it as "Herzog Zwei for iPhone." That is the phrase that gets a
  takedown, and it is the phrase most likely to feel natural in a trailer.

**What you can do, freely:**

- **Rebuild the mechanics.** Game rules and systems are not protected by
  copyright — a transforming carrier-commander, base-capture economics,
  standing orders, and fuel logistics are all fair game. This is the same
  ground on which every *Dune II* descendant stands.
- Say *"inspired by the 1989 Genesis strategy classic"* in a devlog or an
  interview. Descriptive, factual reference to a real product is normal.

**Therefore:** this project is called **EISENKRIEG**, has its own name, art,
music, balance, and unit roster, and never uses the Herzog Zwei name in any
shipped asset or marketing copy. The debt is acknowledged in documentation like
this file, which is exactly where it belongs.

> Not legal advice. Before spending real money on marketing, have an IP lawyer
> look at the name and the store listing — a one-hour review is cheap compared
> to a rebrand after launch.
