# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Five **independent** self-contained games that share no code. Each is one HTML file with its markup, CSS, and JS
inline. No build step, no dependencies, no package manager, no framework. Open any file directly
(`cmd //c start "" asteroids.html`); `file://` works, no server needed. UI strings are French.

- [asteroids.html](asteroids.html) — remake of the 1979 Atari arcade game, canvas + vector rendering.
- [skyjo.html](skyjo.html) — the Magilano card game, DOM/CSS rendering, human vs. 1–3 computer opponents.
- [uno.html](uno.html) — the Mattel card game, DOM/CSS rendering, human vs. 1–3 computer opponents, house
  rules toggled on the start screen.
- [cinq-rois.html](cinq-rois.html) — *Les Cinq Rois*, the French edition of Five Crowns (Set Enterprises), DOM/CSS
  rendering, human vs. 1–3 computer opponents: 11 rounds of rummy with a wild rank that changes every round.
- [trou-du-cul.html](trou-du-cul.html) — the traditional climbing game (a.k.a. Président), rules from the French
  Wikipedia article, DOM/CSS rendering, human vs. 3–5 computer opponents, variants toggled on the start screen.
- [tests/](tests/) — Node test harness, the only shared code. A new game means a new HTML file plus its own
  `tests/<game>.test.js`; keep the games themselves independent of each other.
- [index.html](index.html) — landing page linking the games, one card each with a small pure-CSS/SVG preview.
  A new game also needs its card here. The games don't link back to it.

## Hosting

Published with **GitHub Pages** straight from `main`, repository root, no build and no Actions workflow:
`https://ogauchard.github.io/gamebox/`. Every push to `main` goes live within a minute or so, so `main` is
production. The empty [.nojekyll](.nojekyll) must stay: without it Pages runs Jekyll, which would render
`CLAUDE.md` into a page. Keep every link relative (`uno.html`, not `/uno.html`) — the site lives under
`/gamebox/`, not at the domain root.

## Verifying changes

```
node tests/run-all.js          # les cinq suites (~5200 assertions, le total varie — les cartes sont mélangées)
node tests/skyjo.test.js       # règles de Skyjo seules
node tests/uno.test.js         # règles d'Uno seules
node tests/cinq-rois.test.js   # règles et moteur de combinaisons des Cinq Rois seuls
node tests/trou-du-cul.test.js # règles du Trou du cul seules
node tests/asteroids.test.js   # logique d'Asteroids seule
```

No linter and no dependencies — the tests are plain Node, nothing to install. If `node` isn't on PATH (a shell opened
before Node was installed on this machine), call it by absolute path: `"/c/Program Files/nodejs/node.exe"`.

**Rendering.** Headless **Edge** works on this machine (it was blocked on the previous one, so older notes claimed
screenshots were impossible). Capture a page with:

```
"/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" \
  --headless=old --disable-gpu --hide-scrollbars --virtual-time-budget=2500 \
  --window-size=900,900 --screenshot=out.png "file:///c:/ogd/gamebox/skyjo.html"
```

Use `--headless=old` — the `new` mode ignores `--window-size` for the CSS viewport. `--virtual-time-budget` lets CSS
transitions finish and iframes load before the capture. Edge also enforces a **minimum window width (~492 CSS px)**, so
`--window-size` alone **cannot** emulate a phone: to test a real phone width, wrap the page in an iframe sized to the
phone (`<iframe src="skyjo.html" width="390" height="844">`) and screenshot the wrapper — the iframe gets an
independent 390-px layout viewport, so its `@media` queries render truthfully. To pose a game in a specific state,
inject a second inline `<script>` before `</body>` that mutates state and calls `render()` (a later classic script can
reach the page's top-level `const`/`function`). What screenshots still can't judge is **touch behaviour and real-device
feel** — say so rather than implying a CSS change was fully verified.

`tests/harness.js` extracts each page's inline `<script>` and runs it in a `node:vm` context against stubs. Three
things to know before writing a new test:

- **`node:vm` has no `Window`, so it silently accepts names a browser rejects.** A top-level `const top = …`
  parses fine in the harness and makes the *entire* script fail to parse in a browser (`Identifier 'top' has
  already been declared` — `window.top` is non-configurable), leaving a dead page that no test can see. This
  really happened while writing Uno. `globalClashes(file)` in the harness checks a page's top-level names
  against the Window properties that behave this way; `uno.test.js` asserts it is empty. Do the same for any
  new game, and screenshot at least once — that is what caught it.

- Read state with `g("S")` / `g("game")` — a top-level `const` lives in the context's *lexical* scope, not on the
  sandbox object. Top-level `function` declarations *do* land on the context global, so they can be replaced from a
  test (that is how `endTurn`, `drawCard` and `clearColumns` get instrumented for coverage).
- The sandbox clock fires immediately, which collapses the AI's animation delays; a whole Skyjo game runs in
  milliseconds. Use `setImmediate`, not `setTimeout(fn, 0)` — Node clamps the latter to ~1 ms, which dominates
  everything (a 800-game benchmark took 335 s instead of 20 s).

Asteroids is driven by holding the `requestAnimationFrame` callback and replaying it with synthetic timestamps, and
by firing `keydown`/`keyup` at the captured listeners. Skyjo is driven through `onCardClick`/`onDrawClick`/
`onDiscardClick` for the human seat, opponents playing normally. Uno the same way through `onHandClick(uid)` and
friends — cards are addressed by `uid`, not by DOM node, because `render()` rebuilds the hand every time. Cinq Rois
likewise through `onDrawClick`/`onDiscardPileClick`/`onHandClick(uid)`; those handlers only act for seat 0, so a
targeted test that plays another seat calls `drawOne`/`takeDiscard` → `discardCard` → `afterDiscard` directly.
Trou du cul through `onCardClick(uid)` + `onPlayClick`/`onPassClick`/`onGiveClick`, same seat-0 restriction (other
seats: `doPlay`/`doPass`). `loadDomGame(file)` in the harness loads any of the four card games.

`Math.random` is **not** seeded in the Asteroids harness, so any check that samples short-lived state at a single
instant is flaky — the saucer's ~1.15 s enemy bullets were the classic trap (`la soucoupe tire` failed ~18 % of runs
until hardened). Keep new Asteroids assertions robust to that: instrument the top-level function instead of sampling
(the saucer-fires check now wraps `ufoShoot` via the context eval handle), make the ship invulnerable so a stray
ship/saucer collision can't preempt what you're measuring, and note that an empty field respawns a wave only after a
2 s `waveTimer` — clearing asteroids for a single frame is safe, across many is not.

Invariants worth keeping in the Skyjo suite: the 150-card multiset is conserved across piles, grids **and**
`S.held`; removals only ever happen three-at-a-time; exactly `n-1` turns follow the finisher's. Random play never
reaches the draw-pile reshuffle or a non-positive finisher total — those are tested directly.

## Architecture — asteroids.html

### Virtual world and scaling

All gameplay runs in a fixed **1200×900 world-unit space** (`WORLD_W`/`WORLD_H`, [asteroids.html:88](asteroids.html#L88));
nothing in the simulation knows about pixels. `resize()` letterboxes the canvas to the viewport and stores
`viewScale`, which `render()` applies via `ctx.setTransform` once per frame. Keep new gameplay code in world units.

### The toroidal playfield touches three places

Screen wrap is not handled in one spot. A new entity type needs all three:

1. `wrap()` ([asteroids.html:312](asteroids.html#L312)) — teleports positions across edges after integration.
2. `hits()` ([asteroids.html:318](asteroids.html#L318)) — collision test using the *shortest* distance across the wrap,
   not raw Euclidean distance. Never compare positions directly.
3. `drawWrapped()` ([asteroids.html:827](asteroids.html#L827)) — draws up to 4 copies of an entity near the borders so it
   straddles edges visually instead of popping.

### Input: edge-triggered keys expire each frame

`keys` holds held state; `edge` holds one-shot presses consumed via `consume(code)` ([asteroids.html:260](asteroids.html#L260)).
The main loop clears **all** edges at the end of every frame, so a `consume()` call that is gated behind a state
check (e.g. only while `playing` and the ship is alive) silently drops the press. That is deliberate: it stops a
queued hyperspace from firing at respawn and an `Enter` pressed mid-game from restarting instantly at game over.
Any new `consume()` call must run in the same frame the key goes down, or the input is lost.

Firing is the exception: it reads held state (`keys.Space`), not an edge, so holding the key auto-fires. The rate is
bounded by `CFG.bullet.cooldown` and by the 4-bullets-on-screen cap, and since bullets live ~1 s the cap is what
actually throttles sustained fire.

### Game loop and state

`loop()` ([asteroids.html:990](asteroids.html#L990)) is `update(dt)` → clear edges → `render(now)`. `dt` is capped at 1/20 s
so a backgrounded tab cannot tunnel entities through each other on resume.

`game` ([asteroids.html:328](asteroids.html#L328)) is a single mutable object holding all state, including the entity arrays.
`game.state` is `attract | playing | paused | gameover`; `update()` branches on it early and most simulation is gated
behind a local `playing` flag, while asteroids, bullets, and particles keep drifting in non-playing states (that is
what makes the attract screen and the post-death scene move).

### Tuning

`CFG` ([asteroids.html:97](asteroids.html#L97)) holds every balance constant. **Asteroid arrays are indexed by size where
`0 = small, 1 = medium, 2 = large`** (`CFG.asteroid.radius/speed/score`) — the reverse of the visual reading order,
and the easiest thing to get wrong. Arcade-accurate values currently encoded: 20/50/100 points by size, 200/1000 for
the big/small saucer, 4 player bullets on screen at once, extra life every 10 000 points, 4 large asteroids on wave 1
and +1 per wave capped at 11 (`waveCount`).

Two deliberate departures from the original, both easily reverted: a glow (`ctx.shadowBlur`) plus screen shake on
explosions, and `CFG.ship.drag` at 0.55 — the arcade ship has almost no friction, so ~0.05 restores the original
"soap bar" handling.

### Audio

`Sfx` ([asteroids.html:134](asteroids.html#L134)) is an IIFE module wrapping WebAudio; every sound is synthesized (oscillator
blips and filtered noise bursts), there are no assets. Browsers block audio until a gesture, so `Sfx.init()` is called
from `press()` on the first key or tap and is a no-op afterwards. Thrust and saucer sounds are **persistent nodes
gain-gated to 0**, not one-shots — they must be explicitly silenced on every path that removes the ship or saucer
(death, game over, pause, blur, tab hide), otherwise the sound keeps playing over a frozen game.

The two-tone heartbeat speeds up as a wave empties; its tempo is derived from the remaining asteroid count against
`waveCount(level) * 7` (a large asteroid yields 7 fragments in total: 1 + 2 + 4).

## Architecture — skyjo.html

### Turn state machine

Everything hangs off `S.phase`: `setup → source → (swap | drawn → flip) → …`, plus `ai` while an opponent plays and
`over` at scoring. The human seat is event-driven (clicks call `onCardClick`/`onDrawClick`/`onDiscardClick`, each of
which validates the current phase), while `aiTurn()` is `async` and paces itself with `sleep()`; `S.busy` locks out
human clicks meanwhile. `render()` derives *every* affordance — which cards are `.selectable`, which piles are
`.clickable`, what the status line says — from `S.phase` and `S.current`, so a new phase only needs handling there
and in the click handlers.

The DOM is built once per game by `buildBoard()` and then mutated by `render()`; it is never rebuilt from scratch,
because the 3D flip is a CSS transition on `.card.up` that a re-render would restart.

### Responsive layout

Desktop stacks opponents (a centered wrapping row), the piles, the status line, and the player's grid top-to-bottom.
Phones (`@media (max-width: 560px)`) switch to a **thumb-first** layout: opponents become a horizontally-scrolling rail
pinned at the top, while piles + status + the player's grid are anchored to the bottom via `margin-top: auto`. Card
sizes are `clamp()` over `min(vh, vw)` so the table fits without page scroll; a nested `(max-height: 720px)` query hides
the log and shrinks cards further for short phones (iPhone SE). This is **pure CSS scoped to those media queries** — it
touches neither the DOM structure nor `render()`, so the desktop layout is unchanged. Verify phone widths with the
iframe screenshot trick from *Verifying changes*, and remember touch feel still needs a real device.

### Rules that are easy to break

- A grid is 12 cells indexed `row * 4 + col`; a **column** is `[c, c+4, c+8]`. `clearColumns()` runs after *every*
  card placement and after every flip, never just at end of turn.
- Removed cards keep their cell (`removed: true`) but are pushed to the discard pile — any card-conservation
  reasoning must skip removed cells or it double-counts them.
- The round ends when play returns to `S.finisher`, which gives every other player exactly one final turn.
- All hidden cards are revealed and **counted** at scoring, so flipping a card never changes a score; it only buys
  information and pushes toward ending the round. Both AI cost models rest on this: a hidden cell is worth the
  expected value of an unseen card — `EV_HIDDEN` (5.07 = 760/150) for the simple policy, a live figure for the
  counting one.
- Doubling the finisher's score applies on ties too, but only when their total is strictly positive.

### Opponent AI

Two interchangeable policies behind one interface — `chooseDiscard(p, top) -> idx | null` and
`afterDraw(p, v) -> {kind, idx}` — selected per player via `p.policy` from the start screen. `aiTurn()` owns all the
timing and animation; the policies are pure decisions. **Neither policy may read `c.v` of a face-down cell**, not
even its own: they get public information only. (An earlier version cheated here.)

`greedy` ("Tranquille") is the simple one: `bestPlacement()` scores each cell as `costBefore - v`, plus `3 * v` when
the placement completes a column — a signed bonus, so it correctly *avoids* clearing columns of negative cards.
Fixed thresholds then decide (`>= 2` to take the discard, `> 0.5` to swap after drawing).

`counting` ("Redoutable") replaces the thresholds with a model:

- `refreshUnseen()` recomputes the distribution of cards nobody can see (deck − discard − all face-up cells − held),
  so `unseenEV` is live rather than pinned at 5.07, and `pValue(v)` gives real column-completion odds.
- `drawScore()` is a one-ply expectimax: the average, over every unseen card, of the best play it would allow.
  Comparing that against `bestPlayWith(p, discardTop)` replaces the "is the discard good enough" threshold entirely.
- `scorePosition()` prices the *end of the round*: doubling risk when not clearly ahead, versus denying opponents a
  turn. Simulated positions mark a flipped-but-unread cell `unknown` so `gridEV()` keeps valuing it at `unseenEV`
  instead of peeking.

**The pitfall that bit here:** a flat "don't end the round" bonus makes stalling look indefinitely profitable, and a
table of identical AIs then never finishes a round — no theoretical limit, the game genuinely hangs. `endPressure()`
fixes it: the bonus decays with `S.roundTurns` and goes negative past `AI.patience`, which guarantees termination.
Any future change to the ending logic must be re-checked in self-play, not just against `greedy`.

`AI` holds the five tunables. They were fitted by simulation, not by eye — see the benchmark note below.

### Benchmarking the AI

```
node tests/skyjo-bench.js 300         # duel + table à 3 contre la politique greedy
node tests/skyjo-bench.js sweep 300   # compare des réglages de l'objet AI
node tests/skyjo-bench.js stall 40    # 3 « redoutables » entre elles
```

The bench seats AI at *every* place (`p.ai = true` on seat 0, flip two of its cards, then `decideStarter()` +
`beginTurn()` — repeated each round, since `startRound()` hands back to the human seat).

Reference points at the shipped settings, 600 games each: **88 % wins in a 2-player duel** (50 % baseline) and
**60 % at a 3-player table** (33 % baseline), average round score 17.4 vs 29.6.

Two failure modes to watch, both of which have already happened here:

- **Games that never terminate.** Run `stall` before shipping any change to the ending logic — it must report
  `bloquées 0/N`. The duel mode cannot catch this, because `greedy` always rushes to end the round.
- **Tuning that overfits `greedy`.** Patience looks nearly free against an opponent that ends rounds early; a
  patient human will narrow the gap. `AI.patience` is the strength/pace dial — lowering it to 16 shortens rounds
  and costs about 20 points of win rate.

## Architecture — uno.html

### One entry point per turn

`beginTurn()` ([uno.html:736](uno.html#L736)) is the only place a turn starts, and it branches on **pending
penalties before anything else**: contest the +4, stack on it, or draw the accumulated total. Both variants and
the plain rule flow through that same branch — without stacking, `canPlay()` returns false for everything while
`S.pending > 0`, so `legalMoves()` is empty and the player just takes the cards. Adding a rule that interrupts a
turn means adding a case there, not a new call site.

`startRound()` must reset `S.phase` to `"idle"`. `beginTurn()` returns early on `phase === "over"` to stop the
chain at scoring, so a round that inherits `"over"` deals the cards and then never starts — the game hangs on
"Manche suivante". That bug shipped and was caught by the test suite; the reset is the fix.

### Legality lives in one function

`canPlay()` ([uno.html:623](uno.html#L623)) answers for every context, and **its meaning changes under a pending
penalty**: it then permits only the surenchère (a +2 or a +4 on a +2 chain, a +4 only on a +4 chain) instead of
colour/value/symbol matching. `render()` derives which hand cards are `.playable` from it, the click handlers
re-check it, and the AI picks from `legalMoves()` — so a rule change lands in one place. The test asserts every
card ever pushed to the discard was legal at the instant it was played.

Note the discard's top card and the **active colour are different things** (`S.color` vs `topCard()`): after a
joker only `S.color` matters. Never read the colour off the pile.

### Variants and format

`VAR` holds the rules for the current game, frozen from the start screen: `stack` (cumul des +2/+4), `challenge`
(contre-attaque du +4), `sevenZero`, and `match` (500 points vs. a single round). Deliberate readings, all
documented in the in-game rules panel: a +2 answers a +2 or a +4 answers it, a +4 answers only a +4; the
challenge is offered **only on an isolated +4** (`S.pending === 4`), because on a stack nobody could say who
bluffed or for how many cards; a 7 or a 0 played as the last card wins the round instead of triggering the
swap/rotation.

`S.wild4.bluff` is **private information** — it records whether the player who laid the +4 actually held the
colour. Only `doChallenge()` may read it. A policy that peeks at it is cheating, exactly like reading a hand.

### Opponent AI

Two interchangeable policies behind one interface — `pick`, `color`, `playDrawn`, `challenge`, `swapTarget` —
selected per player via `p.policy`. `simple` ("Tranquille") sheds its biggest card and hoards jokers; `sharp`
("Redoutable") scores each move (`AI` holds the seven tunables) against the next player's hand size, keeps a
playable colour in reserve, and prices the risk of a contestable +4.

**Neither policy may look at another player's hand or the draw order.** They get `hand.length`, the discard, and
`p.pub` — the last colour each player laid and the colours they had to draw on. The test enforces this: during
every policy call it swaps the other players' `hand` arrays for a `Proxy` that counts indexed and iterated
access (`length` stays free) and asserts the count is zero.

### Termination

Hands only grow by drawing, and drawing needs a pile, so rounds terminate on their own — except in the corner
where the draw pile is empty and the discard is down to its top card. `passTurn()` counts consecutive
non-plays and `endBlockedRound()` ends the round on the lowest hand. `drawOne()` returns `null` rather than
throwing when there is nothing left; every caller handles it.

### Rendering

`render()` **rebuilds the hand and the opponents' fans from scratch** every call, because hand contents change
constantly — unlike Skyjo, whose fixed grid is built once. `shownUids` remembers which cards were on screen last
frame so only genuinely new ones get the `pop` animation. Cards are plain `<button>`s: colour background, white
border via `::after`, rotated white oval, big pip, two rotated corner marks; jokers use a four-quadrant
`conic-gradient` on the oval.

Log lines go through `says(p, second, third)`, which tutoies the human and uses the third person for the
opponents. Do not build player sentences with `il`/`elle` — the AI names carry no gender.

### Responsive layout

Pure CSS under `@media (max-width: 560px)`, plus a nested `(max-height: 700px)` that only hides the log. Unlike
Skyjo, nothing scrolls and nothing is left empty (an earlier rail + `margin-top: auto` version left ~40 % of the
screen blank and hid half the hand):

- **Opponents** are a grid with one equal column each, so all three stay visible; the card count wraps under the
  name. A lone opponent (`:only-child`) goes on a single row instead.
- **The hand wraps** onto several rows instead of scrolling — every card visible, full size, never overlapping.
  Card width is computed from `--k` cards per row (`100vw`-based); `:has(> .card:nth-child(9|16|25))` raises `--k`
  as the hand grows so it doesn't swallow the table. Row gap is 12 px because a playable card lifts 7 px and
  carries a 3 px ring.
- **`#table` is `flex: 1 1 0` with `container-type: size`**, and `--pile-card` uses `cqh`/`cqw`: the piles size
  themselves to whatever height the hand leaves over (big with 5 cards, small with 20). An `@supports (width: 1cqh)`
  guard keeps a `vh` fallback — a custom property can't fail validation, so an unsupported unit would otherwise
  silently give the card no width. `main` still falls back to vertical scroll once `#table` hits `min-height`.

Overlays (couleur, règles, scores) switch from centred to bottom-anchored sheets. Verify phone widths with the
iframe screenshot trick from *Verifying changes* — pose hands of ~5, 13 and 20 cards, since layout depends on hand
size; touch feel still needs a real device. Landscape phones fall outside the 560 px query and get the desktop
layout.

## Architecture — cinq-rois.html

### Rules as implemented

Official Five Crowns: 116 cards (5 suits × 3..K × 2, plus 6 jokers), 11 rounds dealing 3 to 13 cards, and the rank
equal to the deal size is wild that round (`S.wildRank = S.round + 2`). A turn is take one (deck or discard) then
discard one. Deliberate readings, all stated in the in-game rules panel:

- **Going out is automatic**: after any discard, if the remaining hand arranges with zero leftover points,
  `afterDiscard()` sets `S.finisher`. Going out is never worse than not, so there is no button.
- **The discard is mandatory**, even when all n + 1 cards already form melds — so a hand of exactly two 3-card
  melds after drawing *cannot* go out. The engine models this (see below); don't "simplify" it away.
- Every other player gets exactly one final turn; `endTurn()` ends the round when play returns to the finisher.
- No laying off onto other players' melds. A meld of only wilds is legal. A natural card of the wild rank is a
  wild, never a natural — so it can't hold its own place as a natural in a run (a wild fills it instead, same result).
- Hands are **auto-arranged** for the human too: `render()` shows the optimal arrangement (green trays = melds)
  and rings in green every card whose discard would go out. Scoring uses the same optimum for everyone.
- `TURN_CAP` (400) ends a round in place, scoring hands as they stand. It exists only as a guarantee; see the AI
  pitfall below for why it was needed once.

### The arrangement engine

`arrange(hand, discard, wr)` returns `{ cost, melds, dead, discard }`: the minimum points left outside melds, and
with `discard` the card to throw (mandatory). Everything — scoring, the human's display, both AIs — goes through it,
so it must be exact and fast. `solve()` is a memoised exhaustive search:

- Naturals are counted per type (`suit * 11 + rank - 3`, 55 types, max 2 each); wilds are just a count `w`.
- It always processes the **first remaining type** `from`: leave it dead, discard it (`skip`), open a book of its
  rank (any subset of the same-rank naturals, padded with the minimum wilds), or be the **lowest natural** of a run
  in its suit. Lower types are exhausted, so no meld is missed.
- A surplus wild costs nothing once any meld exists (books have no size cap), so wilds are only ever placed where
  needed; leftover-wild value `wv` matters only when `used` is 0. Wilds *below* the opening card of a run are only
  needed when the run would run past the King.
- **Mandatory discard**: a leaf with `skip` still pending returns `INF`; discarding a wild is a separate top-level
  option (always the most expensive one — a joker before a wild-rank card).
- The memo (`ARR`) is shared across calls and keyed by the counts string + `w` + `wv` + flags; it resets when
  `wr` changes or past 400 000 entries. Choices are stored with the cost, and `arrange()` replays them to rebuild
  the melds. A 14-card hand with discard takes ~0.25 ms cold.

The pruning is where it broke: a wild extending a run was only allowed "if a natural lies ahead", written as
`run.length < 2` instead of `< 3` — so a 2-card run could never be completed by a wild. The random brute-force check
caught it (237 wrong hands out of 4 000). `cinq-rois.test.js` keeps that check: ~700 random biased hands of 3–8
cards, compared against the minimum over **all set partitions**, with an independent meld validator. Any change to
`solve()` must keep it at zero discrepancies.

### Turn flow

`S.phase`: `draw → discard` for the human (clicks on the piles, then on a hand card), `ai` while an opponent plays,
`over` at scoring. `aiTurn()` is async like Uno's; it captures `S.epoch` (bumped by `startRound()`) and bails out
after each `sleep()` if a new round or game started meanwhile. Log lines are one per turn ("prend X et défausse Y"),
through `says()` — no il/elle, same as Uno.

### Opponent AI

Interface `takeDiscard(p, top) -> bool` and `discard(p) -> card`, selected by `p.policy`:

- `simple` ("Tranquille") is greedy on the engine: take the discard iff it strictly lowers the arranged cost,
  discard what `arrange(hand, true)` throws.
- `sharp` ("Redoutable") counts cards. `unseenClasses(p)` is the deck minus its own hand, the whole discard pile,
  and the cards other players took from the discard and still hold (`p.pub.took`, public information). Taking
  the discard must beat the **expected cost of a blind draw** by `AI.margin`. Discarding weighs the immediate cost
  against the expected cost after the next draw (`AI.hope`), over the dead cards only, and penalises cards close
  to what the next player picked up (`AI.deny`). On a final turn it just minimises the immediate cost.

**The pitfall that bit here:** an early `sharp` always took a wild from the discard. With three unrelated cards in
round 1 there is nowhere to put it, so it discarded the wild straight back — and three `sharp` players passed the
same joker around until `TURN_CAP`. The rule now is that a take must strictly beat the draw expectation; since
a blind draw can always be discarded, its expectation never exceeds the current cost, so a no-op take is impossible.
Neither policy may read another hand or `S.draw`: the test swaps them for counting `Proxy`s during every policy call.

### Benchmarking the AI

```
node tests/cinq-rois-bench.js 300        # duel + table à 3 contre la politique simple
node tests/cinq-rois-bench.js sweep 150  # compare des réglages de l'objet AI
node tests/cinq-rois-bench.js stall 40   # 3 « redoutables » entre elles : garde-fou jamais atteint
```

Reference points at the shipped settings, 300 games each: **76 % wins in a 2-player duel** (50 % baseline) and
**53 % at a 3-player table** (33 % baseline), average round score 8.1 vs 11.2; three `sharp` players average about
9 turns per round, worst seen 34, far from `TURN_CAP`. The sweep is noisy at 150 games — compare the average
score per round, which moves far less than the win rate. `hope` 0.55 beat 0, 0.3 and 0.8 on that measure; `deny`
is neutral against `simple` (which never exploits the discard pile) and kept for humans. Run `stall` before shipping
any change to `takeDiscard`.

### Rendering and layout

`render()` rebuilds the hand from `arrange()` on every call (like Uno, unlike Skyjo), so the hand re-sorts itself
after each draw; `shownUids` limits the `pop` animation to new cards. Melds are `.group.meld` trays with cards
overlapped by 42 % (the corner index stays readable), dead cards sit apart and unoverlapped because they are what
you click. The wild rank gets a gold inner border and a crown, the table shows it in `#wildBadge`.

Desktop centres the column with `margin-top/bottom: auto` on the first and last children of `main` (not
`justify-content: center`, which would clip the top when the table overflows). The phone layout copies Uno's:
opponents grid, `#table` as a `cqh`-sized flex filler, wrapping hand. Hand card width comes from `--n`, the hand
size set inline by `renderHand()`, because CSS can't count cards spread across several meld groups.

## Architecture — trou-du-cul.html

### Rules as implemented

52 cards dealt equally to 4–6 players; leftovers are shown to everyone and set aside (`S.aside`). Ranks are stored
3..14 plus **15 for the 2**, so the natural order is just the number; `strength(rank)` is `rank - 3`, or `15 - rank`
during a revolution. The Wikipedia article leaves several points open; these readings are deliberate and stated in
the in-game rules panel:

- **A player who passes may play again** when their turn comes back within the same trick. A trick ends when every
  *other* player still holding cards has passed since the last play (`S.passed`, cleared on each play). The last
  player to play leads next; if they are out, their next active neighbour does.
- Round 1 is opened by the holder of the queen of hearts (seat 0 if it was set aside); later rounds by the previous
  **Trou du cul**.
- The round stops when one player still holds cards. Ranking = finishers in order, that player, then the players
  who finished on a 2 (variant), the **first** offender at the very bottom. Points are `n - 1 - position`; the game
  stops at the end of the round where someone reaches `S.target = (n - 1) × 3` (or × 6 for a long game).
- Exchanges at the start of every later round: the Trou du cul's 2 best and the Vice-trou du cul's best card go
  automatically; then the Président gives back 2 and the Vice-président 1 **of their choice**, after seeing what they
  received. `S.gives` is the queue; `nextGive()` pauses in `phase = "give"` when the giver is the human.
- **Révolution** lasts until the end of the round or a counter-revolution by another carré. Wikipedia says it "ne
  dure qu'un tour"; read as one trick it would do almost nothing (only carrés can follow a carré), so the common
  whole-round reading was chosen. It's one line in `doPlay()` plus the reset in `startRound()` if that ever changes.
- **Même valeur**: playing the same rank is allowed and targets the next active player (`S.trick.forcedSeat`), who
  may only repeat that rank or pass. **2 en atout**: a single 2 beats any combination, except a combination of 2s,
  and not during a revolution. Not implemented: the putsch and the 54-card deck with jokers.

### Legality and flow

`canPlayCards(cards, seat)` is the only legality check: the renderer, the click handlers and the AIs go through it
(`legalPlays(seat)` enumerates one candidate per rank and size). The suite asserts every `doPlay` was legal and made
by `S.current`, and every `endTrick` happened with all the others passed.

`doPlay` → optional revolution → `finish` if the hand is empty → `endRound` if one holder is left → next active
seat. `doPass` → `endTrick` or next active seat. `aiTurn()` checks `S.epoch` like the other games, and when its pass
is the one that closes the trick it pauses `TRICK_MS` with its "passe" bubble shown, so the winning cards can be read
before they are cleared. The cleared trick stays on the table, dimmed, as `S.lastTrick`.

### Opponent AI

`play(p, seat) -> cards | null` and `give(p, k) -> cards`. `simple` leads its weakest rank (all copies), follows with
the cheapest play that doesn't break a group, and gives back its weakest cards. `sharp` counts cards: `unseen(p,
rank)` is 4 minus played, set aside and own copies, and a group is **master** when no rank above it has enough
unseen copies (or a single 2 remains, with the trump variant). It plays its masters before its last group, prices
each follow by `strength + breakCost`, **passes above `passAbove`** unless an opponent is down to `danger` cards,
triggers a revolution when the flipped hand is stronger, and plays its 2s early when finishing on one is forbidden.
Neither policy may read another hand; the test enforces it with counting `Proxy`s as in Uno.

```
node tests/trou-du-cul-bench.js 300        # 1 redoutable contre 3, 4 et 5 tranquilles, sans puis avec variantes
node tests/trou-du-cul-bench.js sweep 400  # compare des réglages de l'objet AI (4 joueurs, toutes variantes)
```

Reference points at the shipped settings, 300 games per table, one `sharp` against `simple` players — win rate
(baseline 1/n) and average points per round (baseline (n − 1)/2):

| Players | No variant        | All variants      |
|---------|-------------------|-------------------|
| 4       | 51 % · 1.97       | 72 % · 2.11       |
| 5       | 41 % · 2.47       | 53 % · 2.63       |
| 6       | 33 % · 2.94       | 39 % · 3.04       |

The pass threshold is what makes `sharp` strong: in the 4-player sweep, `passAbove 99` (never pass voluntarily)
drops its win rate from ~71 % to ~44 %, and `danger 1` (keep passing even when someone is about to go out) to ~33 %.
A separate "save the aces" penalty was removed once `passAbove` made it redundant. Terminations can't stall: every trick starts with a mandatory play.

### Rendering and layout

`render()` rebuilds the hand every call, grouped by rank (overlapped cards, weakest first in the *current* order,
so a revolution flips the hand). Following a trick, one click on a card selects the required number of copies of
its rank; leading, clicks toggle cards within one rank. Unplayable cards are darkened with `filter`, not `opacity`:
inside an overlapped group, transparency shows the card underneath. Phone layout as in Uno and Cinq Rois; the
opponents grid gets `--cols` from `buildBoard()` (up to 3 per row, 2×2 for four opponents) because five opponents
don't fit in one row.
