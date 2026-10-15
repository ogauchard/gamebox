/* Turkish — banc d'essai des politiques d'adversaire.
 *
 *   node tests/turkish-bench.js [n]          1 redoutable contre 3 tranquilles (la table du jeu)
 *   node tests/turkish-bench.js sweep [n]    compare des réglages de l'objet AI
 *   node tests/turkish-bench.js stall [n]    4 « redoutables » entre elles : garde-fou jamais atteint
 *
 * Parties de 4 donnes. Le taux de victoire est bruité ; le nombre moyen de
 * points par donne (plus bas = mieux) bouge beaucoup moins : c'est lui qu'il
 * faut comparer d'un réglage à l'autre. Le réglage montre aussi, pour chaque
 * configuration, la part de donnes bloquées entre 4 redoutables : un réglage
 * plus fort qui fait boucler la table ne vaut rien.
 */
"use strict";

const { loadTurkish } = require("./harness");

const { g, S, byId, tick } = loadTurkish();
const beginTurn = g("beginTurn");
const TURN_CAP = g("TURN_CAP");

/* Toutes les places tenues par l'ordinateur. startRound() attend les clics du
   siège 0 quand c'est à lui d'ouvrir : on relance alors le tour, qui part en
   tour d'IA. Si un adversaire ouvre, son tour est déjà en vol. */
function openRound(policies) {
  S.players.forEach((p, i) => { p.ai = true; p.policy = policies[i]; });
  if (S.current === 0 && S.phase === "play") beginTurn();
}

g(`globalThis._turns = [];
   const _end = endRound; endRound = function () { globalThis._turns.push(S.roundTurns); _end(); };`);

async function playGame(policies) {
  g("chosenRounds = 4");
  g("startGame")(policies.length);
  openRound(policies);
  let guard = 0;
  while (guard++ < 2000000) {
    await tick();
    if (S.phase !== "over") continue;
    if (byId.get("btnNext").dataset.over) {
      return S.players.map((p, i) => ({ policy: policies[i], total: p.score, rounds: p.rounds }));
    }
    byId.get("btnNext").click();
    openRound(policies);
  }
  return null;
}

let stats = {};
function record(result) {
  const best = Math.min(...result.map((r) => r.total));
  const winners = result.filter((r) => r.total === best).length;
  for (const r of result) {
    const s = (stats[r.policy] ||= { games: 0, wins: 0, rounds: 0, pts: 0 });
    s.games++;
    s.rounds += r.rounds.length;
    s.pts += r.rounds.reduce((a, b) => a + b, 0);
    if (r.total === best) s.wins += 1 / winners;
  }
}

async function table(N) {
  stats = {};
  for (let i = 0; i < N; i++) {
    const seats = ["simple", "simple", "simple", "simple"];
    seats[i % 4] = "sharp";
    record(await playGame(seats));
  }
  const sh = stats.sharp, si = stats.simple;
  return { win: 100 * sh.wins / sh.games, sharp: sh.pts / sh.rounds, simple: si.pts / si.rounds };
}

/* Quatre redoutables : la table du jeu. Part des donnes qui atteignent le garde-fou. */
async function stallRate(N) {
  g("globalThis._turns = []");
  for (let i = 0; i < N; i++) await playGame(["sharp", "sharp", "sharp", "sharp"]);
  const t = g("globalThis._turns");
  return { capped: t.filter((x) => x >= TURN_CAP).length, deals: t.length, avg: t.reduce((a, b) => a + b, 0) / t.length };
}

async function duel(N) {
  const r = await table(N);
  console.log(`\n=== 1 redoutable contre 3 tranquilles (${N} parties de 4 donnes) ===`);
  console.log(`victoires ${r.win.toFixed(1)} % (25 % attendus) · points par donne ${r.sharp.toFixed(1)} contre ${r.simple.toFixed(1)}`);
}

async function sweep(N) {
  const AI = g("AI");
  const base = { ...AI };
  const configs = [
    { name: "livré", set: {} },
    { name: "unload 0.35", set: { unload: 0.35 } },
    { name: "unload 1", set: { unload: 1 } },
    { name: "copies 0.3", set: { copies: 0.3 } },
    { name: "upBonus 0.5", set: { upBonus: 0.5 } },
    { name: "upBonus 4", set: { upBonus: 4 } },
    { name: "blindLead 0", set: { blindLead: 0 } },
    { name: "patience 80", set: { patience: 80 } },
    { name: "patience 300", set: { patience: 300 } },
    { name: "split oui", set: { split: true } },
  ];
  console.log(`\n=== Réglage (${N} parties par configuration) ===`);
  for (const cfg of configs) {
    Object.assign(AI, base, cfg.set);
    const r = await table(N);
    const st = await stallRate(Math.ceil(N / 8));
    console.log(`${cfg.name.padEnd(14)} victoires ${r.win.toFixed(1).padStart(5)} % · points par donne ${r.sharp.toFixed(1)} contre ${r.simple.toFixed(1)}`
      + ` · 4 redoutables : ${st.avg.toFixed(0)} tours/donne, bloquées ${st.capped}/${st.deals}`);
  }
  Object.assign(AI, base);
}

async function stall(N) {
  g("globalThis._turns = []");
  for (let i = 0; i < N; i++) await playGame(["sharp", "sharp", "sharp", "sharp"]);
  const t = g("globalThis._turns");
  const capped = t.filter((x) => x >= TURN_CAP).length;
  console.log(`\n=== 4 redoutables (${N} parties, ${t.length} donnes) ===`);
  console.log(`${(t.reduce((a, b) => a + b, 0) / t.length).toFixed(1)} tours par donne · pire donne ${Math.max(...t)} tours`
    + ` · garde-fou atteint ${capped}/${t.length} (limite ${TURN_CAP})`);
  if (capped) process.exitCode = 1;
}

(async () => {
  const mode = process.argv[2];
  const n = Number(process.argv[3] || (mode === "stall" ? 100 : 400));
  const t0 = Date.now();
  if (mode === "sweep") await sweep(n);
  else if (mode === "stall") await stall(n);
  else await duel(Number(process.argv[2] || 400));
  console.log(`\n(${((Date.now() - t0) / 1000).toFixed(1)} s)`);
})();
