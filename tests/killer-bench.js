/* Killer — banc d'essai des politiques d'adversaire.
 *
 *   node tests/killer-bench.js [n]          1 redoutable contre 3 tranquilles (la table du jeu)
 *   node tests/killer-bench.js sweep [n]    compare des réglages de l'objet AI
 *   node tests/killer-bench.js face [n]     chaque réglage contre le livré, 2 redoutables contre 2
 *   node tests/killer-bench.js stall [n]    4 « redoutables » entre elles : durée des parties
 *   (sweep et face : un 4e argument « hit 0.5,death 60 » limite aux réglages nommés)
 *
 * Parties complètes, jusqu'au dernier survivant. Le taux de victoire est bruité
 * (une partie sur vingt n'a pas de gagnant) ; le tour de mort moyen et les
 * dégâts infligés par tour le complètent.
 *
 * Une partie ne boucle pas : chaque tour a une chance de faire perdre des PV
 * (un raté) ou d'en ôter à quelqu'un (une attaque), et la régénération ne
 * rend en moyenne que 3,5 PV quand elle tombe. Elle peut seulement durer : le
 * mode stall mesure combien, et c'est la durée qu'un joueur subit.
 */
"use strict";

const { loadKiller } = require("./harness");

const { g, S, tick } = loadKiller();
const ctx = g("globalThis");

// Ce que chaque tour a donné : attaques, régénérations, ratés.
const _stopAim = ctx.stopAim;
ctx.stopAim = function () {
  const r = _stopAim();
  const p = S.players[S.current];
  p._aims = p._aims || { attack: 0, regen: 0, miss: 0, v: 0 };
  p._aims[S.aim.kind]++;
  if (S.aim.kind === "attack") p._aims.v += S.aim.v;
  return r;
};

/* La durée d'une partie à l'écran, à l'allure de l'ordinateur : la somme de
   ses temporisations (le bac à sable les déclenche aussitôt). */
let clock = 0;
const _setTimeout = ctx.setTimeout;
ctx.setTimeout = (fn, ms) => { clock += ms || 0; return _setTimeout(fn, 0); };

/* Toutes les places tenues par l'ordinateur. Si le siège 0 commence, son tour
   a démarré sans IA : on le relance. */
async function playGame(policies) {
  g("startGame")(policies.length);
  const t0 = clock;
  S.players.forEach((p, i) => { p.ai = true; p.policy = policies[i]; });
  if (S.current === 0) g("aiTurn")();
  let guard = 0;
  while (guard++ < 2000000) {
    await tick();
    if (S.phase !== "over") continue;
    return S.players.map((p, i) => ({
      policy: policies[i], win: i === S.winner, none: S.winner < 0, turns: p.turns, dealt: p.dealt,
      died: p.dead ? p.died : S.round, rounds: S.round, minutes: (clock - t0) / 60000, aims: p._aims || { attack: 0, regen: 0, miss: 0, v: 0 },
    }));
  }
  return null;
}

let stats = {};
function record(result) {
  for (const r of result) {
    const s = (stats[r.policy] ||= { games: 0, wins: 0, none: 0, turns: 0, dealt: 0, died: 0, rounds: 0, attack: 0, regen: 0, miss: 0, v: 0 });
    s.games++;
    s.wins += r.win ? 1 : 0;
    s.none += r.none ? 1 : 0;
    s.turns += r.turns;
    s.dealt += r.dealt;
    s.died += r.died;
    s.rounds += r.rounds;
    for (const k of ["attack", "regen", "miss", "v"]) s[k] += r.aims[k];
  }
}

/* Le redoutable change de place par rapport au premier joueur d'une partie à
   l'autre : commencer est un avantage, il ne doit pas l'avoir toujours. */
async function table(N) {
  stats = {};
  for (let i = 0; i < N; i++) {
    const seats = ["simple", "simple", "simple", "simple"];
    seats[(S.games + i) % 4] = "sharp";
    record(await playGame(seats));
  }
  const sh = stats.sharp, si = stats.simple;
  return {
    win: 100 * sh.wins / sh.games, none: 100 * sh.none / sh.games,
    died: sh.died / sh.games, diedSimple: si.died / si.games,
    dealt: sh.dealt / sh.turns, dealtSimple: si.dealt / si.turns,
    rounds: sh.rounds / sh.games, aims: mix(sh),
  };
}

// Sur 100 tours : attaques (valeur moyenne), régénérations, ratés.
const mix = (s) => {
  const n = s.attack + s.regen + s.miss;
  return `${(100 * s.attack / n).toFixed(0)} att. (aux ${(s.v / s.attack).toFixed(1)}) · ${(100 * s.regen / n).toFixed(0)} rég. · ${(100 * s.miss / n).toFixed(0)} ratés`;
};

const line = (r) => `victoires ${r.win.toFixed(1).padStart(5)} % · mort au tour ${r.died.toFixed(1)} contre ${r.diedSimple.toFixed(1)}`
  + ` · dégâts par tour ${r.dealt.toFixed(2)} contre ${r.dealtSimple.toFixed(2)} · ${r.rounds.toFixed(1)} tours de table · sans gagnant ${r.none.toFixed(1)} %`;

async function duel(N) {
  const r = await table(N);
  console.log(`\n=== 1 redoutable contre 3 tranquilles (${N} parties) ===`);
  console.log(`${line(r)} (25 % attendus)`);
  console.log(`redoutable, sur 100 tours : ${r.aims} · tranquilles : ${mix(stats.simple)}`);
}

/* Quatre redoutables : tours de table par partie, la plus longue, les bloquées. */
async function sharps(N) {
  const rounds = [], minutes = [];
  let stuck = 0, none = 0;
  stats = {};
  for (let i = 0; i < N; i++) {
    const r = await playGame(["sharp", "sharp", "sharp", "sharp"]);
    if (!r) { stuck++; continue; }
    record(r);
    rounds.push(r[0].rounds);
    minutes.push(r[0].minutes);
    if (r[0].none) none++;
  }
  rounds.sort((a, b) => a - b);
  minutes.sort((a, b) => a - b);
  return { avg: rounds.reduce((a, b) => a + b, 0) / rounds.length, max: rounds.at(-1), p90: rounds[Math.floor(rounds.length * 0.9)], stuck, none, aims: mix(stats.sharp),
           min: minutes.reduce((a, b) => a + b, 0) / minutes.length, minP90: minutes[Math.floor(minutes.length * 0.9)] };
}

const CONFIGS = [
  { name: "livré", set: {} },
  { name: "hit 0.15", set: { hit: 0.15 } },
  { name: "hit 0.5", set: { hit: 0.5 } },
  { name: "hit 1", set: { hit: 1 } },
  { name: "death 15", set: { death: 15 } },
  { name: "death 60", set: { death: 60 } },
  { name: "back 0", set: { back: 0 } },
  { name: "back 8", set: { back: 8 } },
];

/* Les réglages nommés en 4e argument (« hit 0.5,death 60 »), ou tous. */
const picked = (list) => (process.argv[4] ? list.filter((c) => process.argv[4].split(",").includes(c.name)) : list);

async function sweep(N) {
  const AI = g("AI");
  const base = { ...AI };
  console.log(`\n=== Réglage (${N} parties par configuration, ${Math.ceil(N / 4)} entre 4 redoutables) ===`);
  for (const cfg of picked(CONFIGS)) {
    Object.assign(AI, base, cfg.set);
    const r = await table(N);
    const s = await sharps(Math.ceil(N / 4));
    console.log(`${cfg.name.padEnd(10)} ${line(r)}`);
    console.log(`${"".padEnd(10)} 4 redoutables : ${s.avg.toFixed(1)} tours de table (9 sur 10 sous ${s.p90}, ${s.max} au plus), ${s.min.toFixed(1)} min, bloquées ${s.stuck} · ${s.aims}`);
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
    g("POLICIES").variant = { keep: wrap(sharp.keep), target: wrap(sharp.target) };
    stats = {};
    for (let i = 0; i < N; i++) {
      // Le premier joueur est tour à tour une variante et un livré.
      const seats = [];
      for (let s = 0; s < 4; s++) seats[(S.games + s) % 4] = (s + i) % 2 ? "variant" : "sharp";
      record(await playGame(seats));
    }
    const v = stats.variant, s = stats.sharp;
    console.log(`${cfg.name.padEnd(10)} victoires ${(100 * v.wins / v.games * 2).toFixed(1).padStart(5)} % contre ${(100 * s.wins / s.games * 2).toFixed(1)} %`
      + ` · mort au tour ${(v.died / v.games).toFixed(1)} contre ${(s.died / s.games).toFixed(1)} · ${(v.rounds / v.games).toFixed(1)} tours de table`);
  }
  delete g("POLICIES").variant;
}

async function stall(N) {
  const s = await sharps(N);
  console.log(`\n=== 4 redoutables (${N} parties) ===`);
  console.log(`${s.avg.toFixed(2)} tours de table par partie · 9 sur 10 sous ${s.p90} · la plus longue ${s.max} · sans gagnant ${s.none} · bloquées ${s.stuck}/${N}`);
  console.log(`à l'écran, à l'allure de l'ordinateur : ${s.min.toFixed(1)} min en moyenne, 9 sur 10 sous ${s.minP90.toFixed(1)} min`);
  console.log(`sur 100 tours : ${s.aims}`);
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
