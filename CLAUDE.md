# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Two **independent** self-contained games that share no code. Each is one HTML file with its markup, CSS, and JS
inline. No build step, no dependencies, no package manager, no framework. Open either file directly
(`cmd //c start "" asteroids.html`); `file://` works, no server needed. UI strings are French.

- [asteroids.html](asteroids.html) — remake of the 1979 Atari arcade game, canvas + vector rendering.
- [skyjo.html](skyjo.html) — the Magilano card game, DOM/CSS rendering, human vs. 1–3 computer opponents.
- [tests/](tests/) — Node test harness, the only shared code. A new game means a new HTML file plus its own
  `tests/<game>.test.js`; keep the games themselves independent of each other.

## Verifying changes

```
node tests/run-all.js          # les deux suites (~745 assertions, quelques secondes)
node tests/skyjo.test.js       # règles de Skyjo seules
node tests/asteroids.test.js   # logique d'Asteroids seule
```

No linter and no dependencies — the tests are plain Node, nothing to install. What they do **not** cover is
rendering: headless Chrome and Edge are both blocked by system admin policy on this machine, so screenshots are
unavailable and **anything visual has to be checked by a human in a real browser**. Say so explicitly rather than
implying a CSS change was verified.

`tests/harness.js` extracts each page's inline `<script>` and runs it in a `node:vm` context against stubs. Two
things to know before writing a new test:

- Read state with `g("S")` / `g("game")` — a top-level `const` lives in the context's *lexical* scope, not on the
  sandbox object. Top-level `function` declarations *do* land on the context global, so they can be replaced from a
  test (that is how `endTurn`, `drawCard` and `clearColumns` get instrumented for coverage).
- The sandbox clock fires immediately, which collapses the AI's animation delays; a whole Skyjo game runs in
  milliseconds. Use `setImmediate`, not `setTimeout(fn, 0)` — Node clamps the latter to ~1 ms, which dominates
  everything (a 800-game benchmark took 335 s instead of 20 s).

Asteroids is driven by holding the `requestAnimationFrame` callback and replaying it with synthetic timestamps, and
by firing `keydown`/`keyup` at the captured listeners. Skyjo is driven through `onCardClick`/`onDrawClick`/
`onDiscardClick` for the human seat, opponents playing normally.

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
