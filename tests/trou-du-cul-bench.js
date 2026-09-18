/* Trou du cul — banc d'essai des politiques d'adversaire.
 *
 *   node tests/trou-du-cul-bench.js [n]          1 redoutable contre 3, 4 et 5 tranquilles
 *   node tests/trou-du-cul-bench.js sweep [n]    compare des réglages de l'objet AI
 *
 * Le rôle d'une manche dépend beaucoup des échanges de la précédente : un
 * Trou du cul le reste souvent. On mesure donc le score moyen par manche sur
 * des parties entières, pas sur des manches isolées.
 */
"use strict";

const { loadTrouDuCul } = require("./harness");

const { g, S, byId, tick } = loadTrouDuCul();
const beginTurn = g("beginTurn");

/* Toutes les places tenues par l'ordinateur. À la première manche, rien
   n'est demandé au siège 0 avant son premier tour : s'il ouvre, on relance le
   tour, qui part alors en tour d'IA. Aux manches suivantes, ses échanges et
   ses tours passent déjà par la politique puisque p.ai reste vrai. */
function openRound(policies) {
  S.players.forEach((p, i) => { p.ai = true; p.policy = policies[i]; });
  if (S.current === 0 && S.phase === "play") beginTurn();
}

async function playGame(policies) {
  g(`chosenPlayers = ${policies.length}; chosenFormat = "long";`);
  byId.get("btnStart").click();
  openRound(policies);
  let guard = 0;
  while (guard++ < 400000) {
    await tick();
    if (S.phase !== "over") continue;
    if (byId.get("btnNext").dataset.over) {
      return S.players.map((p, i) => ({ policy: policies[i], total: p.score, rounds: p.rounds }));
    }
    byId.get("btnNext").click();
  }
  return null;
}

let stats = {};
function record(result) {
  const best = Math.max(...result.map((r) => r.total));
  const winners = result.filter((r) => r.total === best).length;
  for (const r of result) {
    const s = (stats[r.policy] ||= { games: 0, wins: 0, rounds: 0, pts: 0 });
    s.games++;
    s.rounds += r.rounds.length;
    s.pts += r.rounds.reduce((a, b) => a + b, 0);
    if (r.total === best) s.wins += 1 / winners;
  }
}

async function table(n, N) {
  stats = {};
  for (let i = 0; i < N; i++) {
    const seats = Array(n).fill("simple");
    seats[i % n] = "sharp";
    record(await playGame(seats));
  }
  const sh = stats.sharp, si = stats.simple;
  return { win: 100 * sh.wins / sh.games, sharp: sh.pts / sh.rounds, simple: si.pts / si.rounds };
}

async function duel(N) {
  console.log(`\n=== 1 redoutable contre des tranquilles (${N} parties par table) ===`);
  for (const n of [4, 5, 6]) {
    const r = await table(n, N);
    console.log(`${n} joueurs : victoires ${r.win.toFixed(1).padStart(5)} % (${(100 / n).toFixed(0)} % attendus)`
      + ` · points par manche ${r.sharp.toFixed(2)} contre ${r.simple.toFixed(2)} (${((n - 1) / 2).toFixed(1)} en moyenne)`);
  }
}

async function sweep(N) {
  const AI = g("AI");
  const base = { ...AI };
  const configs = [
    { name: "livré", set: {} },
    { name: "danger 1", set: { danger: 1 } },
    { name: "danger 3", set: { danger: 3 } },
    { name: "danger 8", set: { danger: 8 } },
    { name: "breakCost 4", set: { breakCost: 4 } },
    { name: "breakCost 12", set: { breakCost: 12 } },
    { name: "jokerCost 0", set: { jokerCost: 0 } },
    { name: "jokerCost 8", set: { jokerCost: 8 } },
    { name: "passAbove 6", set: { passAbove: 6 } },
    { name: "passAbove 10", set: { passAbove: 10 } },
    { name: "passAbove 12", set: { passAbove: 12 } },
    { name: "passAbove 99", set: { passAbove: 99 } },
  ];
  console.log(`\n=== Réglage (4 joueurs, ${N} parties par configuration) ===`);
  for (const cfg of configs) {
    Object.assign(AI, base, cfg.set);
    const r = await table(4, N);
    console.log(`${cfg.name.padEnd(13)} victoires ${r.win.toFixed(1).padStart(5)} % · points par manche ${r.sharp.toFixed(2)}`);
  }
  Object.assign(AI, base);
}

(async () => {
  const mode = process.argv[2];
  const n = Number(process.argv[3] || 300);
  const t0 = Date.now();
  if (mode === "sweep") await sweep(n);
  else await duel(Number(process.argv[2] || 300));
  console.log(`\n(${((Date.now() - t0) / 1000).toFixed(1)} s)`);
})();
