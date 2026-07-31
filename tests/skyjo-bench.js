/* Skyjo — banc d'essai des politiques d'adversaire.
 *
 *   node tests/skyjo-bench.js [n]          duel + table à 3, n parties chacun
 *   node tests/skyjo-bench.js sweep [n]    compare des réglages de l'objet AI
 *   node tests/skyjo-bench.js stall [n]    3 « redoutables » entre elles
 *
 * Le mode `stall` n'est pas optionnel avant de toucher à la logique de fin de
 * manche : un bonus mal calibré rend l'attente indéfiniment rentable, et une
 * table d'IA identiques ne termine alors jamais. Le duel contre « tranquille »
 * ne peut pas révéler ce défaut, puisque l'adversaire s'empresse de conclure.
 */
"use strict";

const { loadSkyjo } = require("./harness");

const { g, S, byId, tick } = loadSkyjo();
const decideStarter = g("decideStarter");
const beginTurn = g("beginTurn");

/* Toutes les places sont tenues par l'ordinateur : il faut retourner à la main
   les 2 cartes de départ du siège 0, normalement humain, puis relancer le tour
   (startRound() rend la main au joueur humain et attend ses clics). */
function openRound(policies) {
  S.players.forEach((p, i) => { p.ai = true; p.policy = policies[i]; });
  const me = S.players[0];
  if (me.grid.filter((c) => c.up).length < 2) {
    const idx = [...Array(12).keys()].sort(() => Math.random() - 0.5).slice(0, 2);
    for (const i of idx) me.grid[i].up = true;
  }
  decideStarter();
  beginTurn();
}

async function playGame(policies) {
  g(`chosenPlayers = ${policies.length}`);
  byId.get("btnStart").click();
  openRound(policies);

  let guard = 0;
  while (guard++ < 200000) {
    await tick();
    if (S.phase !== "over") continue;
    if (byId.get("btnNext").dataset.over) {
      return S.players.map((p, i) => ({ policy: policies[i], total: p.total, rounds: p.rounds }));
    }
    byId.get("btnNext").click();
    openRound(policies);
  }
  return null;                       // manche qui ne se termine pas
}

/* ------------------------------------------------------------------ Mesure */
let stats = {};
const bump = (pol) => (stats[pol] ||= { games: 0, wins: 0, totalSum: 0, rounds: 0, roundSum: 0 });

function record(result) {
  const best = Math.min(...result.map((r) => r.total));
  const winners = result.filter((r) => r.total === best).length;
  for (const r of result) {
    const s = bump(r.policy);
    s.games++;
    s.totalSum += r.total;
    s.rounds += r.rounds.length;
    s.roundSum += r.rounds.reduce((a, b) => a + b, 0);
    if (r.total === best) s.wins += 1 / winners;    // égalité = fraction de victoire
  }
}

function report() {
  for (const [pol, s] of Object.entries(stats)) {
    console.log(
      `${pol.padEnd(9)} victoires ${(100 * s.wins / s.games).toFixed(1).padStart(5)} %` +
      ` · total final moyen ${(s.totalSum / s.games).toFixed(1).padStart(6)}` +
      ` · score moyen par manche ${(s.roundSum / s.rounds).toFixed(2).padStart(6)}`);
  }
  stats = {};
}

/* ------------------------------------------------------------------ Modes */
async function duel(N) {
  // Sièges alternés : neutralise l'avantage de position.
  for (let i = 0; i < N; i++) {
    record(await playGame(i % 2 ? ["counting", "greedy"] : ["greedy", "counting"]));
  }
  console.log(`\n=== Duel 2 joueurs (${N} parties, 50 % attendus au hasard) ===`);
  report();

  for (let i = 0; i < N; i++) {
    const seats = ["greedy", "greedy", "greedy"];
    seats[i % 3] = "counting";
    record(await playGame(seats));
  }
  console.log(`\n=== 1 redoutable contre 2 tranquilles (${N} parties, 33 % attendus) ===`);
  report();
}

async function sweep(N) {
  const AI = g("AI");
  const base = { ...AI };
  const configs = [
    { name: "livré", set: {} },
    { name: "turnValue 3", set: { turnValue: 3 } },
    { name: "patience 16", set: { patience: 16 } },
    { name: "patience 44", set: { patience: 44 } },
    { name: "impatience 3", set: { impatience: 3 } },
  ];
  console.log(`\n=== Réglage (duel de ${N} parties par configuration) ===`);
  for (const cfg of configs) {
    Object.assign(AI, base, cfg.set);
    stats = {};
    for (let i = 0; i < N; i++) {
      record(await playGame(i % 2 ? ["counting", "greedy"] : ["greedy", "counting"]));
    }
    const s = stats.counting;
    console.log(`${cfg.name.padEnd(14)} victoires ${(100 * s.wins / s.games).toFixed(1).padStart(5)} %`
      + ` · score moyen par manche ${(s.roundSum / s.rounds).toFixed(2)}`);
  }
  Object.assign(AI, base);
  stats = {};
}

async function stall(N) {
  const AI = g("AI");
  const base = { ...AI };
  g(`globalThis._turnCount = 0;
     const _e = endTurn; endTurn = function () { globalThis._turnCount++; _e(); };`);

  const configs = [
    { name: "livré", set: {} },
    { name: "patience 16", set: { patience: 16 } },
    { name: "patience 60", set: { patience: 60 } },
  ];
  console.log(`\n=== 3 redoutables à la même table (${N} parties) ===`);
  for (const cfg of configs) {
    Object.assign(AI, base, cfg.set);
    let turns = 0, rounds = 0, worst = 0, scoreSum = 0, stuck = 0;
    for (let i = 0; i < N; i++) {
      g("globalThis._turnCount = 0");
      const res = await playGame(["counting", "counting", "counting"]);
      if (res === null) { stuck++; continue; }
      const n = res[0].rounds.length;
      const t = g("globalThis._turnCount");
      turns += t; rounds += n;
      worst = Math.max(worst, t / n);
      scoreSum += res.reduce((a, r) => a + r.rounds.reduce((x, y) => x + y, 0), 0) / (3 * n);
    }
    console.log(`${cfg.name.padEnd(14)} ${(turns / rounds || 0).toFixed(1).padStart(5)} tours/manche`
      + ` (pire manche ${worst.toFixed(0).padStart(4)})`
      + ` · score moyen ${(scoreSum / Math.max(1, N - stuck)).toFixed(2).padStart(6)}`
      + ` · bloquées ${stuck}/${N}`);
    if (stuck) process.exitCode = 1;
  }
  Object.assign(AI, base);
}

(async () => {
  const mode = process.argv[2];
  const n = Number(process.argv[3] || (mode === "stall" ? 40 : 300));
  const t0 = Date.now();
  if (mode === "sweep") await sweep(n);
  else if (mode === "stall") await stall(n);
  else await duel(Number(process.argv[2] || 300));
  console.log(`\n(${((Date.now() - t0) / 1000).toFixed(1)} s)`);
})();
