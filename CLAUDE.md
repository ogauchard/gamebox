# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Three **independent** self-contained games that share no code. Each is one HTML file with its markup, CSS, and JS
inline. No build step, no dependencies, no package manager, no framework. Open any file directly
(`cmd //c start "" asteroids.html`); `file://` works, no server needed. UI strings are French.

- [asteroids.html](asteroids.html) — remake of the 1979 Atari arcade game, canvas + vector rendering.
- [skyjo.html](skyjo.html) — the Magilano card game, DOM/CSS rendering, human vs. 1–3 computer opponents.
- [uno.html](uno.html) — the Mattel card game, DOM/CSS rendering, human vs. 1–3 computer opponents, house
  rules toggled on the start screen.
- [tests/](tests/) — Node test harness, the only shared code. A new game means a new HTML file plus its own
  `tests/<game>.test.js`; keep the games themselves independent of each other.

## Verifying changes

```
node tests/run-all.js          # les trois suites (~2600 assertions, le total varie — les cartes sont mélangées)
node tests/skyjo.test.js       # règles de Skyjo seules
node tests/uno.test.js         # règles d'Uno seules
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
friends — cards are addressed by `uid`, not by DOM node, because `render()` rebuilds the hand every time.

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

Same thumb-first approach as Skyjo, and the same `@media (max-width: 560px)` / nested `(max-height: 700px)`
structure: opponents become a horizontally-scrolling rail at the top, and the table, status, action buttons and
hand are pinned to the bottom by `margin-top: auto` on `#table`. The hand itself scrolls horizontally — cards
stay full size rather than overlapping, so a 15-card hand is still tappable. Overlays (couleur, règles, scores)
switch from centred to bottom-anchored sheets. Verify phone widths with the iframe screenshot trick from
*Verifying changes*; touch feel still needs a real device.
