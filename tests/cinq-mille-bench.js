/* 5000 — banc d'essai des politiques d'adversaire.
 *
 *   node tests/cinq-mille-bench.js [n]          1 redoutable contre 3 tranquilles (la table du jeu)
 *   node tests/cinq-mille-bench.js sweep [n]    compare des réglages de l'objet AI
 *   node tests/cinq-mille-bench.js face [n]     chaque réglage contre le livré, 2 redoutables contre 2
 *   node tests/cinq-mille-bench.js stall [n]    4 « redoutables » entre elles : durée des parties
 *   (sweep et face : un 4e argument « win 0,threat 1000 » limite aux réglages nommés)
 *
 * Parties complètes, jusqu'à 5000. Le taux de victoire est bruité ; les points
 * encaissés par tour bougent beaucoup moins, mais ne disent pas tout : la fin
 * de partie (tenter le coup quand un adversaire va gagner) coûte des points et
 * rapporte des victoires. Juger un réglage sur les deux.
 *
 * Une partie ne boucle pas : chaque lancer a au moins 7,7 % de chances de ne
 * rien marquer, donc chaque tour finit, et chaque tour a une chance de mener
 * quelqu'un à 5000. Elle peut seulement durer : le mode stall mesure combien.
 */
"use strict";

const { loadCinqMille } = require("./harness");

const { g, S, byId, tick } = loadCinqMille();
const ctx = g("globalThis");

// Points encaissés et remises à zéro de chaque joueur, sur la partie.
const _bank = ctx.bank;
ctx.bank = function (seat) {
  const p = S.players[seat];
  p._gain = (p._gain || 0) + S.turnPts;
  return _bank(seat);
};
const _loseTurn = ctx.loseTurn;
ctx.loseTurn = function (why) {
  const p = S.players[S.current];
  if (why === "ballot" && p.fails === 2) p._zeros = (p._zeros || 0) + 1;
  return _loseTurn(why);
};

/* Toutes les places tenues par l'ordinateur. Si le siège 0 commence, son tour
   a démarré sans IA : on le relance. */
async function playGame(policies) {
  g("startGame")(policies.length);
  S.players.forEach((p, i) => { p.ai = true; p.policy = policies[i]; });
  if (S.current === 0) g("aiTurn")();
  let guard = 0;
  while (guard++ < 400000) {
    await tick();
    if (S.phase !== "over") continue;
    return S.players.map((p, i) => ({ policy: policies[i], win: i === S.winner, turns: p.turns, gain: p._gain || 0, zeros: p._zeros || 0, rounds: S.round }));
  }
  return null;
}

let stats = {};
function record(result) {
  for (const r of result) {
    const s = (stats[r.policy] ||= { games: 0, wins: 0, turns: 0, gain: 0, zeros: 0, rounds: 0 });
    s.games++;
    s.wins += r.win ? 1 : 0;
    s.turns += r.turns;
    s.gain += r.gain;
    s.zeros += r.zeros;
    s.rounds += r.rounds;
  }
}

/* Le redoutable change de rang dans le tour de table d'une partie à l'autre,
   placé par rapport au premier joueur (S.games % 4 pour la partie qui vient) :
   placé par `i % 4`, il commençait à chaque partie dès que S.games partait
   d'un multiple de 4, et commencer vaut 2 à 3 points de victoires. */
async function table(N) {
  stats = {};
  for (let i = 0; i < N; i++) {
    const seats = ["simple", "simple", "simple", "simple"];
    seats[(S.games + i) % 4] = "sharp";
    record(await playGame(seats));
  }
  const sh = stats.sharp, si = stats.simple;
  return {
    win: 100 * sh.wins / sh.games,
    sharp: sh.gain / sh.turns, simple: si.gain / si.turns,
    zeros: sh.zeros / sh.games, rounds: sh.rounds / sh.games,
  };
}

const line = (r) => `victoires ${r.win.toFixed(1).padStart(5)} % · points par tour ${r.sharp.toFixed(0)} contre ${r.simple.toFixed(0)}`
  + ` · remises à zéro ${r.zeros.toFixed(2)} par partie · ${r.rounds.toFixed(1)} tours de table`;

async function duel(N) {
  const r = await table(N);
  console.log(`\n=== 1 redoutable contre 3 tranquilles (${N} parties en 5000) ===`);
  console.log(`${line(r)} (25 % attendus)`);
}

/* Quatre redoutables : tours de table par partie, la plus longue, les bloquées. */
async function sharps(N) {
  const rounds = [];
  let stuck = 0;
  for (let i = 0; i < N; i++) {
    const r = await playGame(["sharp", "sharp", "sharp", "sharp"]);
    if (!r) { stuck++; continue; }
    rounds.push(r[0].rounds);
  }
  return { avg: rounds.reduce((a, b) => a + b, 0) / rounds.length, max: Math.max(...rounds), stuck };
}

const CONFIGS = [
  { name: "livré", set: {} },
  { name: "win 500", set: { win: 500 } },
  { name: "win 1500", set: { win: 1500 } },
  { name: "win 4000", set: { win: 4000 } },
  { name: "threat 0", set: { threat: 0 } },
  { name: "threat 1000", set: { threat: 1000 } },
  { name: "threat 5000", set: { threat: 5000 } },
  { name: "threat 8000", set: { threat: 8000 } },
];

/* Les réglages nommés en 4e argument (« win 0,threat 1000 »), ou tous. */
const picked = (list) => (process.argv[4] ? list.filter((c) => process.argv[4].split(",").includes(c.name)) : list);

async function sweep(N) {
  const AI = g("AI");
  const base = { ...AI };
  console.log(`\n=== Réglage (${N} parties par configuration, ${Math.ceil(N / 4)} entre 4 redoutables) ===`);
  for (const cfg of picked(CONFIGS)) {
    Object.assign(AI, base, cfg.set);
    const r = await table(N);
    const s = await sharps(Math.ceil(N / 4));
    console.log(`${cfg.name.padEnd(12)} ${line(r)} · 4 redoutables : ${s.avg.toFixed(1)} tours, ${s.max} au plus, bloquées ${s.stuck}`);
  }
  Object.assign(AI, base);
}

/* Chaque réglage contre le réglage livré, deux redoutables de chaque, places
   alternées et premier joueur tour à tour de chaque camp : un réglage qui ne
   brille que contre la politique simple se voit ici. La variante règle
   l'objet AI le temps de sa décision, qui est synchrone. */
async function face(N) {
  const AI = g("AI"), sharp = g("sharpPolicy");
  console.log(`\n=== Contre le réglage livré, 2 contre 2 (${N} parties par configuration) ===`);
  for (const cfg of picked(CONFIGS.slice(1))) {
    g("POLICIES").variant = {
      decide(p, seat) {
        const save = { ...AI };
        Object.assign(AI, cfg.set);
        try { return sharp.decide(p, seat); } finally { Object.assign(AI, save); }
      },
    };
    stats = {};
    for (let i = 0; i < N; i++) {
      const seats = [];
      for (let s = 0; s < 4; s++) seats[(S.games + s) % 4] = (s + i) % 2 ? "variant" : "sharp";
      record(await playGame(seats));
    }
    const v = stats.variant, s = stats.sharp;
    console.log(`${cfg.name.padEnd(12)} victoires ${(100 * v.wins / N).toFixed(1).padStart(5)} % (50 % attendus)`
      + ` · points par tour ${(v.gain / v.turns).toFixed(0)} contre ${(s.gain / s.turns).toFixed(0)}`);
  }
  delete g("POLICIES").variant;
}

async function stall(N) {
  const s = await sharps(N);
  console.log(`\n=== 4 redoutables (${N} parties) ===`);
  console.log(`${s.avg.toFixed(2)} tours de table par partie · la plus longue ${s.max} · bloquées ${s.stuck}/${N}`);
  if (s.stuck) process.exitCode = 1;
}

(async () => {
  const mode = process.argv[2];
  const n = Number(process.argv[3] || (mode === "stall" ? 200 : 400));
  const t0 = Date.now();
  if (mode === "sweep") await sweep(n);
  else if (mode === "face") await face(n);
  else if (mode === "stall") await stall(n);
  else await duel(Number(process.argv[2] || 400));
  console.log(`\n(${((Date.now() - t0) / 1000).toFixed(1)} s)`);
})();
