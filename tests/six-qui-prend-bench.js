/* 6 qui prend ! — banc d'essai des politiques d'adversaire.
 *
 *   node tests/six-qui-prend-bench.js [n]          1 redoutable contre 3 tranquilles (la table du jeu)
 *   node tests/six-qui-prend-bench.js sweep [n]    compare des réglages de l'objet AI
 *   node tests/six-qui-prend-bench.js stall [n]    4 « redoutables » entre elles : durée des parties
 *
 * Parties complètes, jusqu'à 66 têtes. Le taux de victoire est bruité ; le
 * nombre moyen de têtes par manche (plus bas = mieux) bouge beaucoup moins :
 * c'est lui qu'il faut comparer d'un réglage à l'autre.
 *
 * Une partie finit par construction : 40 cartes posées sur 4 rangées de 5
 * places font ramasser au moins une rangée par manche, donc au moins une tête,
 * et les totaux ne font que monter. Le mode stall le vérifie quand même.
 */
"use strict";

const { loadSixQuiPrend } = require("./harness");

const { g, S, byId, tick } = loadSixQuiPrend();

/* Toutes les places tenues par l'ordinateur. startGame() laisse le siège 0
   choisir à la main ; aiTurn() relit p.ai à chaque choix, il suffit donc de le
   confier à l'ordinateur avant le premier tick. */
function seat(policies) {
  S.players.forEach((p, i) => { p.ai = true; p.policy = policies[i]; });
}

async function playGame(policies) {
  g("startGame")(policies.length);
  seat(policies);
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

async function duel(N) {
  const r = await table(N);
  console.log(`\n=== 1 redoutable contre 3 tranquilles (${N} parties en 66 têtes) ===`);
  console.log(`victoires ${r.win.toFixed(1)} % (25 % attendus) · têtes par manche ${r.sharp.toFixed(2)} contre ${r.simple.toFixed(2)}`);
}

async function sweep(N) {
  const AI = g("AI");
  const base = { ...AI };
  // noise 0 gagne ici, contre la politique simple qu'il imite exactement, mais
  // perd entre redoutables : ne pas le retenir sur ce seul banc.
  const configs = [
    { name: "livré", set: {} },
    { name: "depth 0", set: { depth: 0 } },
    { name: "depth 3", set: { depth: 3 } },
    { name: "future 0.7", set: { future: 0.7 } },
    { name: "samples 50", set: { samples: 50 } },
    { name: "samples 200", set: { samples: 200 } },
    { name: "noise 0", set: { noise: 0 } },
    { name: "noise 0.6", set: { noise: 0.6 } },
    { name: "spite 0", set: { spite: 0 } },
    { name: "spite 0.5", set: { spite: 0.5 } },
  ];
  console.log(`\n=== Réglage (${N} parties par configuration) ===`);
  for (const cfg of configs) {
    Object.assign(AI, base, cfg.set);
    const r = await table(N);
    console.log(`${cfg.name.padEnd(13)} victoires ${r.win.toFixed(1).padStart(5)} % · têtes par manche ${r.sharp.toFixed(2)} contre ${r.simple.toFixed(2)}`);
  }
  Object.assign(AI, base);
}

/* Quatre redoutables : la table du jeu. */
async function stall(N) {
  const rounds = [];
  let stuck = 0;
  for (let i = 0; i < N; i++) {
    const r = await playGame(["sharp", "sharp", "sharp", "sharp"]);
    if (!r) { stuck++; continue; }
    rounds.push(r[0].rounds.length);
  }
  console.log(`\n=== 4 redoutables (${N} parties) ===`);
  console.log(`${(rounds.reduce((a, b) => a + b, 0) / rounds.length).toFixed(2)} manches par partie · la plus longue ${Math.max(...rounds)}`
    + ` · bloquées ${stuck}/${N}`);
  if (stuck) process.exitCode = 1;
}

(async () => {
  const mode = process.argv[2];
  const n = Number(process.argv[3] || (mode === "stall" ? 200 : 400));
  const t0 = Date.now();
  if (mode === "sweep") await sweep(n);
  else if (mode === "stall") await stall(n);
  else await duel(Number(process.argv[2] || 400));
  console.log(`\n(${((Date.now() - t0) / 1000).toFixed(1)} s)`);
})();
