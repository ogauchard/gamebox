/* Rikiki — banc d'essai des politiques d'adversaire.
 *
 *   node tests/rikiki-bench.js [n]          1 redoutable contre 3 tranquilles (la table du jeu)
 *   node tests/rikiki-bench.js sweep [n]    compare des réglages de l'objet AI
 *   node tests/rikiki-bench.js face [n]     chaque réglage contre le livré, 2 redoutables contre 2
 *   node tests/rikiki-bench.js stall [n]    4 « redoutables » entre elles : durée des parties
 *   (sweep et face : un 4e argument « noise 0,fit 1 » limite aux réglages nommés)
 *
 * Parties complètes de 25 manches. Le taux de victoire est bruité ; les points
 * par manche et la part de contrats réussis le sont bien moins.
 *
 * Une partie ne peut pas boucler : 25 manches d'un nombre fixe de plis. Le mode
 * stall mesure seulement sa durée à l'écran, à l'allure de l'ordinateur.
 */
"use strict";

const { loadRikiki } = require("./harness");

const { g, S, byId, tick } = loadRikiki();
const ctx = g("globalThis");

/* La durée d'une partie à l'écran : la somme des temporisations (le bac à
   sable les déclenche aussitôt). */
let clock = 0;
const _setTimeout = ctx.setTimeout;
ctx.setTimeout = (fn, ms) => { clock += ms || 0; return _setTimeout(fn, 0); };

/* Toutes les places tenues par l'ordinateur. Si le siège 0 annonce le premier,
   son tour a démarré sans IA : on le relance. Les manches suivantes passent par
   la politique, puisque p.ai reste vrai. */
async function playGame(policies) {
  g("startGame")(policies.length);
  const t0 = clock;
  S.players.forEach((p, i) => { p.ai = true; p.policy = policies[i]; });
  if (S.current === 0 && S.phase === "bid") g("beginTurn")();
  let guard = 0;
  while (guard++ < 2000000) {
    await tick();
    if (S.phase !== "over") continue;
    // La feuille de fin s'ouvre après une pause (END_MS) : on la laisse s'afficher.
    for (let i = 0; i < 3; i++) await tick();
    if (byId.get("btnNext").dataset.over) {
      return S.players.map((p, i) => ({ policy: policies[i], total: p.score, rounds: p.rounds, minutes: (clock - t0) / 60000 }));
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
    const s = (stats[r.policy] ||= { games: 0, wins: 0, rounds: 0, pts: 0, exact: 0, front: 0, frontExact: 0 });
    s.games++;
    s.rounds += r.rounds.length;
    s.pts += r.total;
    r.rounds.forEach((x, i) => {
      if (x.bid === x.tricks) s.exact++;
      if (i === 0 || i === r.rounds.length - 1) { s.front++; if (x.bid === x.tricks) s.frontExact++; }
    });
    if (r.total === best) s.wins += 1 / winners;
  }
}

const summary = (s) => ({
  win: 100 * s.wins / s.games, pts: s.pts / s.rounds, exact: 100 * s.exact / s.rounds, front: 100 * s.frontExact / s.front,
});

/* Le redoutable change de place par rapport au premier joueur d'une partie à
   l'autre : annoncer et entamer le premier ne doit pas lui être toujours donné. */
async function table(N) {
  stats = {};
  for (let i = 0; i < N; i++) {
    const seats = ["simple", "simple", "simple", "simple"];
    seats[(S.games + i) % 4] = "sharp";
    record(await playGame(seats));
  }
  return { sharp: summary(stats.sharp), simple: summary(stats.simple) };
}

const line = (r) => `victoires ${r.sharp.win.toFixed(1).padStart(5)} % · ${r.sharp.pts.toFixed(2)} points par manche contre ${r.simple.pts.toFixed(2)}`
  + ` · contrats réussis ${r.sharp.exact.toFixed(1)} % contre ${r.simple.exact.toFixed(1)} % · au front ${r.sharp.front.toFixed(0)} % contre ${r.simple.front.toFixed(0)} %`;

async function duel(N) {
  const r = await table(N);
  console.log(`\n=== 1 redoutable contre 3 tranquilles (${N} parties) ===`);
  console.log(`${line(r)} (25 % de victoires attendus)`);
}

const CONFIGS = [
  { name: "livré", set: {} },
  { name: "samples 60", set: { samples: 60 } },
  { name: "samples 250", set: { samples: 250 } },
  { name: "noise 0", set: { noise: 0 } },
  { name: "noise 0.3", set: { noise: 0.3 } },
  { name: "fit 1", set: { fit: 1 } },
  { name: "fit 0.35", set: { fit: 0.35 } },
  { name: "spite 0.3", set: { spite: 0.3 } },
  { name: "trust 0.6", set: { trust: 0.6 } },
  { name: "trust 0.9", set: { trust: 0.9 } },
];

/* Les réglages nommés en 4e argument (« noise 0,fit 1 »), ou tous. */
const picked = (list) => (process.argv[4] ? list.filter((c) => process.argv[4].split(",").includes(c.name)) : list);

async function sweep(N) {
  const AI = g("AI");
  const base = { ...AI };
  console.log(`\n=== Réglage (${N} parties par configuration) ===`);
  for (const cfg of picked(CONFIGS)) {
    Object.assign(AI, base, cfg.set);
    console.log(`${cfg.name.padEnd(12)} ${line(await table(N))}`);
  }
  Object.assign(AI, base);
}

/* Chaque réglage contre le réglage livré, deux redoutables de chaque, places
   alternées : un réglage qui ne brille que contre la politique simple se voit
   ici. La variante règle l'objet AI le temps de ses décisions, synchrones. */
async function face(N) {
  const AI = g("AI"), sharp = g("sharpPolicy");
  console.log(`\n=== Contre le réglage livré, 2 contre 2 (${N} parties par configuration) ===`);
  for (const cfg of picked(CONFIGS.slice(1))) {
    const wrap = (fn) => (...args) => {
      const save = { ...AI };
      Object.assign(AI, cfg.set);
      try { return fn(...args); } finally { Object.assign(AI, save); }
    };
    g("POLICIES").variant = { bid: wrap(sharp.bid), play: wrap(sharp.play) };
    stats = {};
    for (let i = 0; i < N; i++) {
      // Le premier joueur est tour à tour une variante et un livré.
      const seats = [];
      for (let s = 0; s < 4; s++) seats[(S.games + s) % 4] = (s + i) % 2 ? "variant" : "sharp";
      record(await playGame(seats));
    }
    const v = summary(stats.variant), s = summary(stats.sharp);
    console.log(`${cfg.name.padEnd(12)} victoires ${(2 * v.win).toFixed(1).padStart(5)} % contre ${(2 * s.win).toFixed(1)} %`
      + ` · ${v.pts.toFixed(2)} points par manche contre ${s.pts.toFixed(2)} · contrats ${v.exact.toFixed(1)} % contre ${s.exact.toFixed(1)} %`);
  }
  delete g("POLICIES").variant;
}

/* Quatre redoutables, la table que le joueur affronte : durée à l'écran. */
async function stall(N) {
  const minutes = [];
  let stuck = 0;
  stats = {};
  for (let i = 0; i < N; i++) {
    const r = await playGame(["sharp", "sharp", "sharp", "sharp"]);
    if (!r) { stuck++; continue; }
    record(r);
    minutes.push(r[0].minutes);
  }
  minutes.sort((a, b) => a - b);
  const s = summary(stats.sharp);
  console.log(`\n=== 4 redoutables (${N} parties) ===`);
  console.log(`bloquées ${stuck}/${N} · ${s.pts.toFixed(2)} points par manche · contrats réussis ${s.exact.toFixed(1)} % · au front ${s.front.toFixed(0)} %`);
  console.log(`à l'écran, à l'allure de l'ordinateur (sans le temps de tes décisions) : ${(minutes.reduce((a, b) => a + b, 0) / minutes.length).toFixed(1)} min en moyenne`);
  if (stuck) process.exitCode = 1;
}

(async () => {
  const mode = process.argv[2];
  const n = Number(process.argv[3] || (mode === "stall" ? 50 : 300));
  const t0 = Date.now();
  if (mode === "sweep") await sweep(n);
  else if (mode === "face") await face(n);
  else if (mode === "stall") await stall(n);
  else await duel(Number(process.argv[2] || 300));
  console.log(`\n(${((Date.now() - t0) / 1000).toFixed(1)} s)`);
})();
