# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Seven **independent** games that share no game code. Each is one HTML file with its markup, CSS, and JS inline —
except that the six card games load one shared stylesheet, [cartes.css](cartes.css), for their common layout (see
*Shared layout* below). No build step, no dependencies, no package manager, no framework. Open any file directly
(`cmd //c start "" asteroids.html`); `file://` works, no server needed. UI strings are French.

- [asteroids.html](asteroids.html) — remake of the 1979 Atari arcade game, canvas + vector rendering.
- [skyjo.html](skyjo.html) — the Magilano card game, DOM/CSS rendering.
- [uno.html](uno.html) — the Mattel card game, DOM/CSS rendering; format and house rules toggled on the start screen.
- [cinq-rois.html](cinq-rois.html) — *Les Cinq Rois*, the French edition of Five Crowns (Set Enterprises), DOM/CSS
  rendering: 11 rounds of rummy with a wild rank that changes every round.
- [trou-du-cul.html](trou-du-cul.html) — the traditional climbing game (a.k.a. Président), rules from the French
  Wikipedia article plus fixed house rules (54 cards with wild jokers, a long game to 18 points, no options at all),
  DOM/CSS rendering.
- [turkish.html](turkish.html) — Turkish, a shedding game where you play *down* instead of up, with a tarot deck
  minus the trumps; rules from the « Le jeu de Turkish » blog and its author's answers, DOM/CSS rendering.
- [six-qui-prend.html](six-qui-prend.html) — *6 qui prend !* (Wolfgang Kramer's 6 nimmt!), official rules: everyone
  plays a card at once, the sixth card of a row takes it, game to 66 heads. DOM/CSS rendering.
- [cartes.css](cartes.css) — the card games' shared layout and components; each game keeps its tint, card faces and
  table contents inline.
- [tests/](tests/) — Node test harness, the only shared code. A new game means a new HTML file plus its own
  `tests/<game>.test.js`; keep the games' logic independent of each other. The **`nouveau-jeu` skill**
  ([.claude/skills/nouveau-jeu/](.claude/skills/nouveau-jeu/SKILL.md)) holds the full checklist for adding one.
- [index.html](index.html) — landing page linking the games, one card each with a small pure-CSS/SVG preview.
  A new game also needs its card here. The games don't link back to it.

**The card games are deliberately simple to start**: always **4 players** (you and 3 computer opponents) and **one AI
level**, the strongest ("Redoutable") — the owner removed the player-count, level and Trou-du-cul length choices.
Only Uno (format, house rules) and Turkish (number of deals, which the owner asked to keep as a choice) have options.
The engines stayed generic: `newGame(n)` still seats 2–6, and `startGame(n = PLAYERS)` — what the "Commencer"
button calls — lets tests and benches seat other tables. The weaker policies Skyjo, Cinq Rois, Trou du cul,
Turkish and 6 qui prend still contain are **benchmark baselines only**, never dealt to a player; Uno had no bench, so its weak policy
was deleted.

## Hosting

Published with **GitHub Pages** straight from `main`, repository root, no build and no Actions workflow:
`https://ogauchard.github.io/gamebox/`. Every push to `main` goes live within a minute or so, so `main` is
production. The empty [.nojekyll](.nojekyll) must stay: without it Pages runs Jekyll, which would render
`CLAUDE.md` into a page. Keep every link relative (`uno.html`, not `/uno.html`) — the site lives under
`/gamebox/`, not at the domain root. Pages serves everything with `Cache-Control: max-age=600`, so a page and the
`cartes.css` it links can be up to 10 minutes apart in a browser after a push: that is why the link carries a content
hash (`cartes.css?v=<hash>`), kept in step by `node tests/cartes.test.js --fix`.

## Verifying changes

```
node tests/run-all.js          # les huit suites (~6400 assertions, le total varie — les cartes sont mélangées)
node tests/skyjo.test.js       # règles de Skyjo seules
node tests/uno.test.js         # règles d'Uno seules
node tests/cinq-rois.test.js   # règles et moteur de combinaisons des Cinq Rois seuls
node tests/trou-du-cul.test.js # règles du Trou du cul seules
node tests/turkish.test.js     # règles du Turkish seules
node tests/six-qui-prend.test.js # règles du 6 qui prend seules
node tests/asteroids.test.js   # logique d'Asteroids seule
node tests/cartes.test.js      # gabarit commun : liens vers cartes.css, empreinte, teintes
node tests/cartes.test.js --fix  # après toute retouche de cartes.css : met l'empreinte à jour dans les 6 liens
```

No linter and no dependencies — the tests are plain Node, nothing to install. If `node` isn't on PATH (a shell opened
before Node was installed on this machine), call it by absolute path: `"/c/Program Files/nodejs/node.exe"`.

**Rendering.** Headless **Edge** works on this machine. Use the **`capture` skill**
([.claude/skills/capture/](.claude/skills/capture/SKILL.md)) rather than calling Edge by hand:

```
node .claude/skills/capture/scripts/capture.js skyjo.html --phone --eval 'aiTurn = async () => {}; el("btnStart").click();' --out <scratchpad>/x.png
```

It handles what used to bite here — `--headless=old`, Edge's ~492-px minimum window (`--phone` wraps the page in an
iframe so its `@media` queries are truthful), a throwaway profile — injects a posing script after the page's own,
and **exits 3 with a red banner on the image when the page throws**, which is what catches a script that `node:vm`
accepts and a browser refuses. Tested posing recipes (frozen AI, big hands, a real end of round) are in its
`references/poses.md`. What screenshots still can't judge is **touch behaviour and real-device feel** — say so rather
than implying a CSS change was fully verified.

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
seats: `doPlay`/`doPass`). Turkish through `onCardClick(zone, uid)` (`"hand"` or `"up"`) + `onPlayClick`,
`onDownClick(i)` for a face-down card and `onPickupClick` then a hand-card click to show (other seats: `doPlay`/
`doBlind`/`doPickup`). 6 qui prend through `onCardClick(uid)` (a second click on the same card, or `onPlayClick`,
plays it) and `onRowClick(r)` when your card is too low; other seats: fill `S.chosen`, then the last choice calls
`reveal()`. `loadDomGame(file)` in the harness loads any of the six card games.

`Math.random` is **not** seeded in the Asteroids harness, so any check that samples short-lived state at a single
instant is flaky — the saucer's ~1.15 s enemy bullets were the classic trap (`la soucoupe tire` failed ~18 % of runs
until hardened). Keep new Asteroids assertions robust to that: instrument the top-level function instead of sampling
(the saucer-fires check now wraps `ufoShoot` via the context eval handle), make the ship invulnerable so a stray
ship/saucer collision can't preempt what you're measuring, and note that an empty field respawns a wave only after a
2 s `waveTimer` — clearing asteroids for a single frame is safe, across many is not.

Invariants worth keeping in the Skyjo suite: the 150-card multiset is conserved across piles, grids **and**
`S.held`; removals only ever happen three-at-a-time; exactly `n-1` turns follow the finisher's. Random play never
reaches the draw-pile reshuffle or a non-positive finisher total — those are tested directly.

## Shared layout — cartes.css

The six card games — Skyjo, Uno, Cinq Rois, Trou du cul, Turkish, 6 qui prend — look alike on purpose, on desktop as on phones; Asteroids
and the landing page stay independent.
[cartes.css](cartes.css) holds everything that used to be copied four times: base styles, header, buttons, opponent
panels (`.player`, `.fan`), status, log, actions, the player's area, overlays and sheets, and the phone and short-screen
rules. Each game links it **before** its own `<style>`, which keeps only what is the game's own: its tint, its card
faces, the contents of its table, its hand. The DOM is the same skeleton everywhere — `header`, then in `main`:
`#opponents`, `#table`, `#status`, `#log`, optional `#actions`, `#me` (`.name` + the hand or grid).

- **One layout at every width**: opponents on top, the hand at the bottom, and `#table` in between as
  `flex: 1 1 0; container-type: size`, so it takes exactly the height left. Each game sizes its table cards in
  `cqh`/`cqw` in its own `<style>` (ratio and table contents differ), under an `@supports (width: 1cqh)` guard with a
  `vh` fallback — a custom property can't fail validation, so an unsupported unit would silently give the card no
  width. Nothing scrolls; `main`'s scroll is only a fallback once `#table` hits its `min-height`.
- **Tint**: every game defines `--bg`, `--panel`, `--line`, `--text`, `--dim`, `--bg-top` (top of the background
  gradient), `--btn`, `--btn-hover` in its `:root`; overlays derive their scrim from `--bg`. Don't name a shared token
  `--glow`: Uno already sets that one on its discard pile for the active-colour halo.
- **Your turn**: `render()` toggles `#me.active` (the same test as an opponent's `.active` ring) and "Toi" turns accent.
- **The log is two lines, bottom-aligned, one `<div>` per entry.** Games keep 3 entries; with `<br>`-joined text and
  overflow clipped at the top-left, it was the *newest* line that got cut on phones. `(max-height: 700px)` hides it at
  every width — iPhone SE, and a 768-px laptop screen once the browser bar is gone.
- **Phones** (`max-width: 560px`): the three opponents become a grid with one equal column each, overlays become
  bottom-anchored sheets.

After editing `cartes.css`, run `node tests/cartes.test.js --fix`: it stamps the new content hash into the six links,
and the suite fails until they match. Measure any sizing change with the `capture` skill's `fit.js` sweep (laptop
1366×650 to 1920×950, phones 375×667 to 412×915, small and big hands): all six games fit with no scroll at every one
of those sizes (Turkish's only exception: a 30-card hand on an iPhone SE scrolls a little). `fit.js` switches CSS
animations off before measuring: headless Edge doesn't advance them in virtual time, and a card frozen at the start of
its `pop` (24 px lower) reads as a false overflow. Landscape phones fall outside the 560 px query and get the desktop layout.

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

The shared layout (see *Shared layout*), with the piles as the table. The grids are the hard part — three rows each,
mine unframed under "Toi" like the other games' hands — so `--card-w` (opponents) and `--my-card` (mine) are `clamp()`
over `min(vh, vw)`, fitted by measurement so nothing scrolls from a 1366×650 laptop viewport up to 1920×950 and on
375–412-px phones. On phones an opponent's grid sizes on its column width (`5.4vw` for three), capped by height.
Before this was measured, **desktop overflowed at every size** (132 px on a laptop, 13 px even at 1920×1000), and the
phone layout was a horizontal rail that cut the third opponent off: re-run the `fit.js` sweep after any sizing change.

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
`afterDraw(p, v) -> {kind, idx}` — selected per player via `p.policy`. Every opponent dealt to a player is
`counting`; `greedy` only plays in the bench. `aiTurn()` owns all the timing and animation; the policies are pure
decisions. **Neither policy may read `c.v` of a face-down cell**, not even its own: they get public information only.
(An earlier version cheated here.)

`greedy` (the bench baseline, "Tranquille" when the level was a choice) is the simple one: `bestPlacement()` scores
each cell as `costBefore - v`, plus `3 * v` when the placement completes a column — a signed bonus, so it correctly
*avoids* clearing columns of negative cards. Fixed thresholds then decide (`>= 2` to take the discard, `> 0.5` to swap
after drawing).

`counting` ("Redoutable", the one players meet) replaces the thresholds with a model:

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
node tests/skyjo-bench.js stall 40    # 4 « redoutables » entre elles, la table du jeu
```

The bench seats its table with `startGame(n)` and puts AI at *every* place (`p.ai = true` on seat 0, flip two of its
cards, then `decideStarter()` + `beginTurn()` — repeated each round, since `startRound()` hands back to the human
seat).

Reference points at the shipped settings, 600 games each: **88 % wins in a 2-player duel** (50 % baseline) and
**60 % at a 3-player table** (33 % baseline), average round score 17.4 vs 29.6. Four `counting` players — the table a
player now always faces — take about 53 turns a round (worst seen 59) and never stall.

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

One policy, `sharp` ("Redoutable"), behind the interface `pick`, `color`, `playDrawn`, `challenge`, `swapTarget`,
reached through `policyOf(p)` (a `function`, so the test can wrap it). It scores each move (`AI` holds the seven
tunables) against the next player's hand size, keeps a playable colour in reserve, and prices the risk of a
contestable +4. The old `simple` policy went with the level choice: Uno has no bench to keep it as a baseline.

**The policy may not look at another player's hand or the draw order.** They get `hand.length`, the discard, and
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

The shared layout (see *Shared layout*); an earlier rail + `margin-top: auto` version left ~40 % of a phone screen
blank and hid half the hand. What is Uno's own:

- **On desktop the hand is one row** that scrolls sideways when it outgrows the window.
- **On phones it wraps** onto several rows instead — every card visible, full size, never overlapping. Card width is
  computed from `--k` cards per row (`100vw`-based); `:has(> .card:nth-child(9|16|25))` raises `--k` as the hand grows
  so it doesn't swallow the table. Row gap is 12 px because a playable card lifts 7 px and carries a 3 px ring.
- The piles size themselves on the table's height (`cqh`, ratio 1.5): big with 5 cards, small with 20.

Pose hands of ~5, 13 and 20 cards when checking it, since the phone layout depends on hand size.

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

Interface `takeDiscard(p, top) -> bool` and `discard(p) -> card`, selected by `p.policy`. Every opponent dealt to a
player is `sharp`; `simple` only plays in the bench.

- `simple` (the bench baseline) is greedy on the engine: take the discard iff it strictly lowers the arranged cost,
  discard what `arrange(hand, true)` throws.
- `sharp` ("Redoutable", the one players meet) counts cards. `unseenClasses(p)` is the deck minus its own hand, the whole discard pile,
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
node tests/cinq-rois-bench.js stall 40   # 4 « redoutables », la table du jeu : garde-fou jamais atteint
```

Reference points at the shipped settings, 300 games each: **76 % wins in a 2-player duel** (50 % baseline) and
**53 % at a 3-player table** (33 % baseline), average round score 8.1 vs 11.2; four `sharp` players — the table a
player now always faces — average about 10.5 turns per round, worst seen 38, far from `TURN_CAP`. The sweep is noisy at 150 games — compare the average
score per round, which moves far less than the win rate. `hope` 0.55 beat 0, 0.3 and 0.8 on that measure; `deny`
is neutral against `simple` (which never exploits the discard pile) and kept for humans. Run `stall` before shipping
any change to `takeDiscard`.

### Rendering and layout

`render()` rebuilds the hand from `arrange()` on every call (like Uno, unlike Skyjo), so the hand re-sorts itself
after each draw; `shownUids` limits the `pop` animation to new cards. Melds are `.group.meld` trays with cards
overlapped by 42 % (the corner index stays readable), dead cards sit apart and unoverlapped because they are what
you click. The wild rank gets a gold inner border and a crown, the table shows it in `#wildBadge`.

The shared layout (see *Shared layout*), with the piles and `#wildBadge` as the table. On phones the hand card width
comes from `--n`, the hand
size set inline by `renderHand()`, because CSS can't count cards spread across several meld groups: `--k =
clamp(4, n, 6)` isolated cards per row, gaps included, so up to 6 cards sit on one row and the size never grows with
the hand (it would jump on every draw). **`.group` must keep `flex-wrap: wrap`**: `#hand` is centred, so a group wider
than the hand (the dead cards, as one block) overflowed on *both* sides — from 5 isolated cards on a phone the
leftmost card vanished and the rightmost was cut, and a desktop window of 1000 px did the same with 14.

## Architecture — trou-du-cul.html

### Rules as implemented

54 cards (two jokers) dealt to the 4 players, 13 each; the 2 leftovers are shown to everyone and set aside (`S.aside`).
The engine still deals 4–6 (4 aside at five, none at six) for the tests and the bench. Ranks are stored 3..14 plus **15 for the 2**, so the natural order is just the
number; `strength(rank)` is `rank - 3`, or `15 - rank` during a revolution. A joker is stored as rank `JOKER` (16),
which is **not its value**: `comboRank(cards)` gives a combination's value — its naturals' rank, or `topRank()` (15,
or 3 during a revolution) for jokers alone. Never pass a joker's rank to `strength()`.

The rules are fixed — the start screen has no option at all, not even the length (the owner chose these house rules
and the long game; the old `VAR` object and its tests are gone). All stated in the in-game rules panel:

- **Wild jokers**: 9 + joker is a pair of 9s. Jokers alone are worth the top card.
- **Passing is final** for the trick: `S.passed` is only cleared by `endTrick()`, and `nextTurn()` skips passed
  seats. A trick ends when the turn would come back to the last player who played (`nextTurn()` returns `null`) —
  everyone else passed or was skipped.
- **Même valeur** is always on: playing the same value (same count) as the trick **skips the next player**
  (`S.trick.skipped`) for that turn only — the skipped player is not out of the trick. If the turn then comes back
  to the player who equalled, they win the trick.
- **The top value closes the trick at once** (`endTrick(true)`): a combination of 2s (3s in a revolution), jokers
  alone, or 2 + joker. Nobody may beat or equal it; its author leads next. A joker *with* naturals of another rank
  does not close anything — only the value counts. "Top" is judged **before** a carré flips the order, so a carré of
  2s closes the trick and starts a revolution.
- **The 2 is not a trump**: it needs the same count as the trick, like any card.
- **Forbidden finish**: going out on the top value (a 2, or a 3 in a revolution) **or on any combination containing a
  joker** makes you Trou du cul d'office (`p.offense` records the card). Ranking = finishers in order, the last
  holder, then the offenders, the **first** offender at the very bottom. Points are `n - 1 - position`; the game
  stops at the end of the round where someone reaches `S.target = (n - 1) × 6`: 18 points at four, six
  rounds as Président (about 8 rounds in practice). There was a short game at × 3; the owner kept only the long one.
- **Révolution** (always on) lasts until the end of the round or a counter-revolution by another carré, jokers
  counting. Wikipedia says it "ne dure qu'un tour"; read as one trick it would do almost nothing, so the common
  whole-round reading was chosen.
- Round 1 is opened by the holder of the queen of hearts (seat 0 if it was set aside); later rounds by the previous
  **Trou du cul**. Exchanges at the start of every later round: the Trou du cul's 2 best (jokers first) and the
  Vice-trou du cul's best card go automatically; then the Président gives back 2 and the Vice-président 1 **of their
  choice**. `S.gives` is the queue; `nextGive()` pauses in `phase = "give"` when the giver is the human.
- Not implemented: the putsch.

### Legality and flow

`canPlayCards(cards)` is the only legality check: the renderer, the click handlers and the AIs go through it
(`legalPlays(seat)` enumerates one candidate per rank, size and number of jokers used, plus jokers alone). Equal
strength is legal because the top value never stays on the table. The suite asserts every `doPlay` was legal, made by
`S.current`, and never by a seat that passed or was just skipped; every `endTrick` either closed on the top value or
had all the others passed or skipped.

`doPlay` → optional revolution → `finish` if the hand is empty → `endRound` if one holder is left → `endTrick(true)`
on the top value → skip on an equal value → `nextTurn()`. `doPass` → `nextTurn()` or `endTrick(false)`. `aiTurn()`
checks `S.epoch` like the other games, and when its pass is the one that ends the trick it adds itself to
`S.passed` early and pauses `TRICK_MS` with its "passe" bubble shown, so the winning cards can be read before they are
cleared — which is why the test does not assert "not already passed" on `doPass`. The cleared trick stays on the
table, dimmed, as `S.lastTrick`.

### Opponent AI

`play(p, seat) -> cards | null` and `give(p, k) -> cards`. Both policies avoid finishing on a forbidden card:
`combosOf(hand)` splits a hand into `safe` groups and `banned` ones (top value, jokers alone), and when at most one
ordinary group is left they lead the banned ones first — they close the trick, so they hand the lead straight back.
`simple` (the bench baseline; every opponent dealt to a player is `sharp`) leads its weakest rank (all copies), follows with the cheapest play that breaks no group and spends no joker,
and gives back its weakest cards. `sharp` counts cards: `unseen(p, rank)` (also for `JOKER`) is what the others may
still hold, and a group is **master** when nobody can beat *or equal* it, jokers included — the top value always is.
It plays its masters before its last group, prices each follow by `strength + breakCost + jokerCost`, **passes above
`passAbove`** unless an opponent is down to `danger` cards, triggers a revolution (a carré, at most one joker) when
the rest of its hand gains from the flip, and never gives a joker back. Neither policy may read another hand; the
test enforces it with counting `Proxy`s as in Uno.

```
node tests/trou-du-cul-bench.js 300        # 1 redoutable contre 3 tranquilles, la table du jeu
node tests/trou-du-cul-bench.js sweep 400  # compare des réglages de l'objet AI (4 joueurs)
```

Reference points at the shipped settings, 300 games, one `sharp` against three `simple` — win rate (baseline 25 %)
and average points per round (baseline 1.5): **35 % · 1.73** (measured when 5- and 6-player tables still existed:
25 % · 2.21 and 20 % · 2.64).

The house rules cut `sharp`'s edge sharply (it was 51–72 % at four players under the old rules). Its old strength
was passing to save aces and coming back later in the same trick; a final pass removed that. Now `sharp` is
rarely Trou du cul (~16 % at four) but no more often Président than chance (~26 %): passing trades first places for
second places. Sweeps at 600 games found nothing better than noise (±2 points): `passAbove`, `danger`, `breakCost`,
`jokerCost`, a bonus for master follows, and "never pass with ≤ 1–2 rivals left in the trick" all land within
31–37 %. `danger 1` still collapses it (~1 %). A real gain probably needs a win-probability model that uses who has
already passed. Terminations can't stall: every trick starts with a mandatory play and passes are final.

### Rendering and layout

`render()` rebuilds the hand every call, grouped by rank (overlapped cards, weakest first in the *current* order,
so a revolution flips the hand), with the jokers as a last group whatever the order. Following a trick, one click
on a card selects the required count — its rank first, topped up with jokers; a click on a joker swaps it for a
natural in the selection, or with nothing selected takes jokers alone. Leading, clicks toggle cards within one rank
plus any jokers. Unplayable cards are darkened with `filter`, not `opacity`: inside an overlapped group,
transparency shows the card underneath. The skipped opponent gets a "sauté" bubble.

The shared layout (see *Shared layout*), with the trick as the table: `#table` is a column (trick cards, caption,
order badge) and `--trick-card` sizes on its height in `cqh`, minus 52 px for the two text lines. An empty trick shows
a dashed card outline (`#trickCards:empty::before`), like the other games' empty discard, rather than a hole. On
phones `main` gets extra top padding for the opponents' bubbles.

## Architecture — turkish.html

### Rules as implemented

From the « Le jeu de Turkish » blog (jeudeturkish.blogspot.com) and its author's answers in the comments, which
settle most questions. A tarot deck minus the trumps: 56 cards, As > Roi > Dame > Cavalier > Valet > 9 … 2, and the
**10 apart**. Ranks are stored 2–9, 11 Valet, 12 Cavalier, 13 Dame, 14 Roi, 15 As, and 10 for the 10: since a 10 never
becomes the value to beat (`S.top`), the order is just the number. Each player gets 3 face-down (`p.down`), 3
face-up on them (`p.up`) and 8 in hand.

- **You play down**: equal or lower than the last value laid, as many copies as you like — all from the hand or all
  from the face-up cards, never mixed. Colours don't count.
- **Picking up**, allowed even when you could play: you **must show a hand card** (owner's choice), which stays in hand;
  the pile joins the hand and you lead. With an empty hand you pick up directly. Showing the **7♦** reverses the
  direction, like playing it — the only effect of the show.
- **The 10 (balayette)** is legal at any time, alone or several: pile and 10s leave the game (`S.out`), you lead again;
  on an empty pile it sweeps nothing but is still discarded. **Never as your last cards** (owner's choice): `canPlayCards`
  refuses a 10 play that would empty your game, so facing a pile with only 10s you must pick up, and with only 10s to
  lead `beginTurn()` passes the lead to the next player. A face-down 10 revealed as your very last card does sweep and
  takes you out, as the blog says.
- **The 7♦** reverses the direction each time it hits the table, until the next one.
- **Face-up cards** are playable once you've played your first card of the deal (`p.started`); **face-down** only
  once your face-up cards are all gone, one at a time, blind (`doBlind`). A blind card that doesn't fit counts as the
  shown card: it goes to the hand with the pile.
- The deal ends as soon as a player has no card left; losers count everything left (hand, face-up, face-down):
  figures 10, the 10 twenty, everything else — the As included — 5. Lowest total after the chosen number of deals
  (4, 8 or 12, chosen on the start screen at the owner's request) wins. The opener rotates: you, then the next seat.

### Flow

`S.phase`: `play` (your turn), `show` (choosing the card to show after "Ramasser"), `ai`, `over`. Three moves, each
re-checked by the click handlers: `doPlay(seat, cards)`, `doBlind(seat, idx)`, `doPickup(seat, shown)`; `place()`
handles laying (sweep, direction, going out), `take()` a pickup. After a sweep or a pickup the same seat leads.
`TURN_CAP` (1500) ends a deal in place, everyone counting their cards; it is a guarantee only, see below.

### Opponent AI

`play(p, seat) -> { kind: "play", cards } | { kind: "blind" } | { kind: "pickup", show }`. Neither policy may read
another hand or **any face-down card, its own included**; the test swaps them for counting `Proxy`s. `S.deck` (the
reference for card conservation) is kept **sorted** so the deal order can't leak. `p.known` holds what everybody
saw go into a hand (picked-up piles, shown cards) — public information.

`simple` (the bench baseline) lays its highest legal value, all copies, face-up first; sweeps when stuck; then tries a
face-down card; picks up last. `sharp` scores each play: shed cards (`AI.shed` each), lay high (`AI.unload` per rank
step, counted **once per play**), empty the face-up cards (`AI.upBonus`); it goes out whenever one play empties its
game, leads blind when its best lead is weak, sweeps with its 10s once it has ≤ `AI.tenEndgame` other cards, and when
stuck always prefers a blind card to picking up (a failed blind card only adds a now-known card to the pickup).

**The pitfall that bit here:** counting the rank bonus per copy made `sharp` lead four 7s rather than one As — and a
table of four `sharp` then looped: a four-of-a-kind picked up was re-laid at once, went round, came back (with the 7♦
flipping the direction each time). 119 deals in 800 hit `TURN_CAP`. Counting the rank once per play fixed most of it;
**`AI.patience`** fixed the rest: past 150 turns in a deal, each card laid is worth only `AI.shedLate`, the rank
alone decides, as for `simple`, which never loops. Run `stall` before shipping any change to the policy.

Tried and dropped because the bench said they lose: attacking the next player by laying low (even when it is about to
go out, with card counting to estimate its odds of answering), dumping costly cards when an opponent nears the end,
sweeping instead of burning a low card, picking up a small pile to keep low cards, laying a single copy to keep the
others (`AI.split`).

```
node tests/turkish-bench.js 2000        # 1 redoutable contre 3 tranquilles
node tests/turkish-bench.js sweep 800   # compare des réglages de l'objet AI, et les donnes bloquées de chacun
node tests/turkish-bench.js stall 400   # 4 redoutables : garde-fou jamais atteint
```

Reference points at the shipped settings: **30 % wins** over 2000 games of 4 deals (25 % baseline), **33.6 points per
deal against 40.0**; four `sharp` players: 63 turns per deal, worst 186 in 1600 deals, `TURN_CAP` never reached. The
sweep is noisy (±1 point per deal at 800 games): compare points per deal, and reject any setting that makes the table
of four loop, however strong.

### Rendering and layout

The shared layout (see *Shared layout*), with the pile as the table: last play bright, earlier cards dimmed, at most 8
shown; an empty pile shows a dashed outline, a closed one stays dimmed with "Balayette de …" / "Pli ramassé par …".
The 10 has a gold border, the 7♦ a ⇄ mark. Each opponent shows a fan of hand backs and its three spots (`.tab`): the
face-up card over the face-down one, whose edge shows below; at the end of a deal face-down cards turn over, since they
count. `render()` rebuilds the hand every call, grouped by rank (10s last), `shownUids` limiting the `pop`.

**Hands grow big here** — picking up a pile easily gives 20–30 cards — so the desktop hand card width follows `--n`
(cards) and `--g` (rank groups), both set by `renderMe()`, to keep the whole hand on one row beside the spots
(`#me` lifts the shared 1000 px cap for that). On phones the hand wraps with `--k` cards per row, growing with `--n`.

## Architecture — six-qui-prend.html

### Rules as implemented

The official rules (Wolfgang Kramer, 1994); the owner kept all three official readings: the **104 cards** whatever
the table (at four, 44 are dealt and 60 stay out, unseen), the game stops at the end of the round where someone
reaches **66 heads** (lowest total wins, ties shared), and the player of a card lower than every row **chooses** the
row to take, after seeing the cards revealed that turn. Cards are `{ uid, n, heads }`; `headsOf(n)`: 55 seven,
multiples of 11 five, of 10 three, of 5 two, the rest one — 171 in all.

- `targetRow(card)` is the placement rule, and the only one: the row whose last card is the highest below the card,
  -1 when it is below them all. `placeCard(seat, card, row)` is the only function that touches `S.rows`; it ignores
  `row` unless the card is too low. A sixth card takes the five; a too-low card takes the chosen row; either way it
  starts the row.
- **Only the head of the queue can be too low**: once placed, it is the lowest row end, so every later card has a
  row. Phase `row` therefore stops a turn at most once.
- **Terminates by construction**, no `TURN_CAP`: 40 cards on 4 rows of 5 places force at least one take per round,
  so the totals climb every round.

### Flow

A turn is `pick → place (→ row) → pick`. `beginTurn()` resets `S.chosen` and calls `aiTurn()`: the opponents choose
one after the other, `THINK_MS` apart. The last choice — theirs, or the human's (`onCardClick(uid)` selects and
previews the row, a second click or « Poser » plays) — calls `reveal()`, which moves the chosen cards from the hands
to `S.queue`, ascending, and adds them to `S.seen`. `resolveTurn()` places them one at a time with `sleep()`
(`S.placing` is what the renderer shows: the incoming card in its slot, or the row in red while it is taken), stops
in phase `row` when the human's card is too low, and `onRowClick(r)` resumes it with `resolveTurn(r)`. `aiTurn()`
re-reads `p.ai` before each choice (`findIndex`): that is how the bench hands seat 0 to the computer right after
`startGame()`. Card conservation: hands + rows + queue + piles + `S.out` = 104; a chosen card stays in its hand
until `reveal()`.

### Opponent AI

`pick(p, seat) -> card` and `row(p, seat, card) -> index`. Hidden from the policies: the other hands, `S.chosen`
before the reveal, and `S.out` (never dealt) — the test swaps all three for counting `Proxy`s. Public: their own hand,
the rows, `S.seen` (starting rows + every card revealed this round), and for `row` the revealed cards still queued.

- `simple` (bench baseline): plays the card that takes nothing and lands closest to its row end, otherwise the
  cheapest one if nobody else played; too low, the cheapest row.
- `sharp` ("Redoutable"): Monte Carlo with rollouts. The numbers it has not seen this round hide the other hands among
  the 60 never dealt. `AI.samples` times, it deals each opponent a hand from them, tries each of its own cards
  against it — this turn, then the rest of the round (`AI.depth` turns), everybody playing like `simple`, the
  opponents at random with probability `AI.noise` — and keeps the card that takes the fewest heads on average. Too
  low, it takes the cheapest row, minus `AI.spite` per head the queued cards will then make the others take (exact:
  they are public).

**What the bench taught.** The rollout is the whole strength: one turn of Monte Carlo alone wins about 35 %, the
rest of the round about 55 %. **`noise 0` overfits**: the opponent model is then exactly `simple`, so it wins more
against `simple` (60 %), but between sharps it loses (11.6 heads a round against 11.0 for `noise 0.3`). Judge a
change to the opponent model in a table of sharps, not only against `simple`.

**Cost.** `playOn()` allocates nothing (insertion sort into a reused buffer); a first decision (10 cards) takes about
30 ms in Node at the shipped settings, three per turn. The test runs its full games with `AI.samples = 20`: they check
the rules, not the strength.

```
node tests/six-qui-prend-bench.js 600        # 1 redoutable contre 3 tranquilles
node tests/six-qui-prend-bench.js sweep 400  # compare des réglages de l'objet AI
node tests/six-qui-prend-bench.js stall 100  # 4 redoutables : durée des parties
```

Reference points at the shipped settings: **57.8 % wins** over 600 games to 66 heads against three `simple` (25 %
baseline), **8.6 heads a round against 13.8**. Between sharps, at a table of two against two over 200 games: the
shipped settings beat `depth 0` 38.5 % to 11.5 % (9.9 heads a round against 14.5), and `noise 0` 27.6 % to 22.4 %
(11.0 against 11.6). Four sharps — the table a player faces — take 4.7 rounds a game, 7 at most over 100
games, none stuck.

### Rendering and layout

The shared layout (see *Shared layout*), with the rows as the table. Each `.line` is a heads count and six slots;
the sixth, dashed red, is where a card that takes lands during `TAKE_MS`. The row cards size on `#rows`, not
`#table`: a container query can't style its own container, and `@container (min-aspect-ratio: 12 / 5)` switches
the rows to **2 × 2** when the table is wide and short — 92-px cards on a 1366×650 laptop instead of 37. The
opponent panel adds `.played`, the card they chose (a back until the reveal); yours stays raised in your hand
(`.chosen`) until placed. **Don't call a hand-card state `played`**: it picks up the `.played` container's size —
the revealed card shrank to 40 px in the hand. `#actions` always holds one « Poser » button, disabled outside the
choice: on phones an empty `#actions` collapses, and the table would resize twice per turn. On phones the hand is
5 cards per row at a fixed width, so cards never resize as the hand shrinks. Card faces are tinted by heads (white 1,
blue 2, yellow 3, red 5, violet 7), with the heads drawn by a CSS mask of an inline SVG bull (`--bull`).
