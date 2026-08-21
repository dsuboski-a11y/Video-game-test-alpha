# Roadmap

Where this goes after the playable MVP. Each phase is a decision with options
and a recommendation, not a wish list.

---

## Phase 1 — Two phones, same room *(next up)*

The single highest-value feature, and the one the MVP was architected for.

The simulation already takes `(state, Command[])` and nothing else. Multiplayer
is therefore not a rewrite; it is an input-transport problem.

**Deterministic lockstep.** Peers exchange *inputs*, never entity state. Each
tick carries at most a handful of commands per player — a stick vector, three
button bits, an occasional buy. That is **tens of bytes per tick regardless of
army size**, versus kilobytes for state replication. A 50-unit battle costs
exactly as much bandwidth as an empty map.

**Transport: WebRTC DataChannel**, unreliable-unordered, with a small input
delay buffer (2–3 ticks ≈ 66–100 ms) and re-sending of unacknowledged inputs.
No relay server in the data path, so a match between two phones on the same Wi-Fi
runs at LAN latency.

**Pairing, in order of how it should feel:**

| Method | How | Effort |
|---|---|---|
| **Room code** | Four characters, typed or read aloud. Signalling server matches them and hands over SDP. | Small |
| **QR code** | Host shows a code, guest points camera. Same signalling path. | Small |
| **Nearby** | Same-LAN discovery via the signalling server grouping by public IP. "Players near you: 1." | Medium |

Recommendation: **room code first**, QR immediately after. Both need the same
signalling server, which is ~150 lines of WebSocket relay and can run on a free
tier indefinitely.

**The determinism risk, stated honestly.** Lockstep desyncs if two devices
compute different numbers. JavaScript's `Math.hypot`, `Math.atan2`, and friends
are *not* guaranteed bit-identical across engines — an iPhone on JavaScriptCore
and an Android on V8 can diverge. Mitigations, in order of cost:

1. **Checksum the state every 30 ticks** and surface a desync immediately rather
   than letting two players diverge silently for two minutes. Cheap, do it
   regardless — it turns a mystery into a bug report.
2. **Replace transcendentals in the sim with lookup tables and integer math.**
   The sim only really needs `atan2`, `hypot`, `sin`, `cos`. Bounded work.
3. **Fixed-point positions.** The real fix if 1 and 2 are not enough. Larger
   change, but the sim is small and isolated enough to take it.

Start at 1, escalate only on evidence.

**Fallback if determinism proves painful:** host-authoritative with client
prediction on your own mech only. Costs more bandwidth and a rollback layer,
but sidesteps float divergence entirely. Keep it in the back pocket.

---

## Phase 2 — Two phones, anywhere

Same netcode, three additions:

- **Signalling + TURN.** Roughly 10–15% of connections cannot hole-punch and
  need a relay. TURN is the one component with real per-minute cost; budget for
  it and monitor the relay ratio.
- **Input delay tuned to RTT**, with rollback if the delay becomes unpleasant
  above ~120 ms. Lockstep degrades gracefully into rollback because the
  simulation is already re-runnable from a snapshot — that is the same property
  that makes the self-play harness fast.
- **Reconnect.** A dropped phone rejoins by replaying the input log from the
  last checkpoint. Cheap, given determinism.

---

## Phase 3 — Voice, and the translation layer

Voice is a WebRTC audio track alongside the existing data channel — the peer
connection already exists, so this is mostly UI and permissions work.

**Ship in this order:**

1. **Push-to-talk, off by default, with a visible mic indicator and a one-tap
   mute.** Non-negotiable. Open mics with strangers is how a game acquires a
   reputation it cannot shed.
2. **Per-player mute and report**, reachable in two taps *during* a match.
3. **Then** live translation.

**On live translation specifically:** it is genuinely achievable now — capture,
streaming speech-to-text, translate, and either subtitle or synthesise. The
honest constraint is **latency**: roughly 1–3 seconds end to end with current
streaming pipelines. That is fine for "push infantry left," and useless for
banter. Design for it rather than against it:

- **Subtitles first, synthesised speech second.** Reading a translated line is
  faster than hearing one, and it does not talk over the game audio.
- **Offer a phrase wheel too.** A dozen tactical callouts — *attack here*,
  *defending*, *need support*, *good game* — translate instantly, work with the
  mic off, and in practice carry most of what matters in a 4-minute match. This
  is the feature that actually makes cross-language play good; the AI pipeline
  is the premium layer on top.

Cost note: streaming STT plus translation runs at real per-minute rates. It is
the one feature in this document that does not scale for free, so it belongs
behind either a supporter tier or a per-match budget.

---

## Phase 4 — Longevity

The request was for a game that *matters* over time. Three levers, ranked by
how much they actually retain players:

**1. Ranked ladder with visible seasons.** The strongest and cheapest. The
simulation already records everything a rating needs, and because matches are
deterministic, **every match is a replay** — store the seed plus the input log
(a few kilobytes) and you can re-render any game in full. That single property
gives you spectating, highlight clips, and cheat auditing for nearly free.

**2. Asynchronous tournaments.** Not live brackets — those need everyone online
at once, which is brutal at small scale. Instead: a weekly bracket where each
round has a 24-hour window. Works across time zones, works with a small player
base, and produces a natural weekly rhythm.

**3. Rotating map and rule modifiers.** A weekly seed and a rule twist —
"outposts pay double," "no artillery," "fuel burns 50% faster." Costs almost
nothing (the map is already a seed, the rules are already one constants file)
and gives returning players something to talk about.

Explicitly *not* recommended: battle passes and cosmetic stores before there is
a population. They are retention *amplifiers*, not retention *sources*, and
building one early consumes the time that should go into the ladder.

---

## Phase 5 — The money question

You asked for free-for-everyone and revenue-generating, and said not to get
stuck on details. The good news is those are compatible; the structure just has
to be chosen deliberately.

**What fits this game:**

| Model | Fit | Notes |
|---|---|---|
| **Cosmetics** — mech skins, unit liveries, HQ banners, victory flourishes | **Strong** | Zero competitive impact. The commander is on screen constantly and is the most personal object in the game. |
| **Supporter tier** — name colour, replay storage, extra loadout slots, translation minutes | **Strong** | Recurring, honest, and directly funds the one variable cost (TURN + translation). |
| **Tournament entry with prize pools** | **Medium** | Real revenue, real regulatory complexity. Not before there is a population. |
| **Ads between matches** | **Weak** | Kills the "bing bong bang, we're playing" feel that is the entire point of a no-install web game. |
| **Anything affecting balance** | **Never** | Pay-to-win ends a competitive game. |

**Keep it free by keeping it cheap.** The current build is **22 KB gzipped**,
has no server in the match data path, and generates all art and audio
procedurally. Marginal cost per player is close to zero, which is what makes
"free for everyone in the world" a sustainable position rather than a slogan.

**No install, deliberately.** It is a PWA: a URL loads it, a service worker
caches it, and Add to Home Screen gives it an icon and a fullscreen shell
without an App Store review, a 30% cut, or an update cycle. That is a strategic
advantage, not a compromise — a link you can send someone mid-conversation is
worth more than a store listing.

---

## Known gaps in the current build

Honest list of what is not done:

- **Single-player only.** No netcode yet — that is Phase 1.
- **One map layout.** Terrain varies by seed; base positions do not.
- **No tutorial.** There is a title-screen briefing and a first toast, which is
  not the same thing.
- **Audio is synthesised and minimal.** It works and it is 0 KB, but it is not
  the "stereo music" bar the pitch calls for. Real composition is a later pass.
- **CADET mirror matches run 21/19–23/17**, slightly favouring player 0. Within
  noise at n=40, but worth re-measuring at n=200 before ranked play.
- **No persistence.** No accounts, no stats, no settings storage.
