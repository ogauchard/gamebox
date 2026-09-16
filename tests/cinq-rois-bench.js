/* Les Cinq Rois — banc d'essai des politiques d'adversaire.
 *
 *   node tests/cinq-rois-bench.js [n]          duel + table à 3, n parties chacun
 *   node tests/cinq-rois-bench.js sweep [n]    compare des réglages de l'objet AI
 *   node tests/cinq-rois-bench.js stall [n]    3 « redoutables » entre elles
 *
 * Le mode `stall` vérifie qu'une table d'IA identiques termine ses manches
 * bien avant le garde-fou TURN_CAP : prendre la défausse sans jamais piocher
 * pourrait tourner en rond, et seul ce garde-fou l'arrêterait.
 */
"use strict";

const { loadCinqRois } = require("./harness");

const { g, S, byId, tick } = loadCinqRois();
const beginTurn = g("beginTurn");
const TURN_CAP = g("TURN_CAP");

/* Toutes les places sont tenues par l'ordinateur. startRound() attend les clics
   du siège 0 quand c'est à lui d'ouvrir : on relance alors le tour, qui part
   cette fois en tour d'IA. Si un adversaire ouvre, son tour est déjà en vol et
   le siège 0 jouera en IA le moment venu. */
function openRound(policies) {
  S.players.forEach((p, i) => { p.ai = true; p.policy = policies[i]; });
  if (S.current === 0 && S.phase === "draw") beginTurn();
}

let capped = 0;
async function playGame(policies) {
  g(`chosenPlayers = ${policies.length}`);
  byId.get("btnStart").click();
  openRound(policies);

  let guard = 0;
  while (guard++ < 500000) {
    await tick();
    if (S.phase !== "over") continue;
    if (S.roundTurns >= TURN_CAP) capped++;
    if (byId.get("btnNext").dataset.over) {
      return S.players.map((p, i) => ({ policy: policies[i], total: p.score, rounds: p.rounds }));
    }
    byId.get("btnNext").click();
    openRound(policies);
  }
  return null;
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
      `${pol.padEnd(7)} victoires ${(100 * s.wins / s.games).toFixed(1).padStart(5)} %` +
      ` · total final moyen ${(s.totalSum / s.games).toFixed(1).padStart(6)}` +
      ` · score moyen par manche ${(s.roundSum / s.rounds).toFixed(2).padStart(6)}`);
  }
  stats = {};
}

/* ------------------------------------------------------------------ Modes */
async function duel(N) {
  // Sièges alternés : neutralise l'avantage de position.
  for (let i = 0; i < N; i++) record(await playGame(i % 2 ? ["sharp", "simple"] : ["simple", "sharp"]));
  console.log(`\n=== Duel 2 joueurs (${N} parties, 50 % attendus au hasard) ===`);
  report();

  for (let i = 0; i < N; i++) {
    const seats = ["simple", "simple", "simple"];
    seats[i % 3] = "sharp";
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
    { name: "hope 0", set: { hope: 0 } },
    { name: "hope 0.3", set: { hope: 0.3 } },
    { name: "hope 0.8", set: { hope: 0.8 } },
    { name: "deny 0", set: { deny: 0 } },
    { name: "margin 3", set: { margin: 3 } },
  ];
  console.log(`\n=== Réglage (1 redoutable contre 2 tranquilles, ${N} parties par configuration) ===`);
  for (const cfg of configs) {
    Object.assign(AI, base, cfg.set);
    stats = {};
    for (let i = 0; i < N; i++) {
      const seats = ["simple", "simple", "simple"];
      seats[i % 3] = "sharp";
      record(await playGame(seats));
    }
    const s = stats.sharp;
    console.log(`${cfg.name.padEnd(10)} victoires ${(100 * s.wins / s.games).toFixed(1).padStart(5)} %`
      + ` · score moyen par manche ${(s.roundSum / s.rounds).toFixed(2)}`);
  }
  Object.assign(AI, base);
  stats = {};
}

async function stall(N) {
  let rounds = 0, turns = 0, worst = 0;
  g(`globalThis._turns = [];
     const _end = endRound; endRound = function () { globalThis._turns.push(S.roundTurns); _end(); };`);
  for (let i = 0; i < N; i++) {
    await playGame(["sharp", "sharp", "sharp"]);
  }
  for (const t of g("globalThis._turns")) { rounds++; turns += t; worst = Math.max(worst, t); }
  console.log(`\n=== 3 redoutables (${N} parties) ===`);
  console.log(`${(turns / rounds).toFixed(1)} tours/manche · pire manche ${worst} tours`
    + ` · garde-fou atteint ${capped}/${rounds} (limite ${TURN_CAP})`);
  if (capped) process.exitCode = 1;
}

(async () => {
  const mode = process.argv[2];
  const n = Number(process.argv[3] || (mode === "stall" ? 40 : 200));
  const t0 = Date.now();
  if (mode === "sweep") await sweep(n);
  else if (mode === "stall") await stall(n);
  else await duel(Number(process.argv[2] || 200));
  console.log(`\n(${((Date.now() - t0) / 1000).toFixed(1)} s)`);
})();
