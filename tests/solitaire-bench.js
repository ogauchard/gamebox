/* Solitaire — banc d'essai des politiques de l'indice.
 *
 *   node tests/solitaire-bench.js [n]          sharp et simple sur les mêmes n donnes
 *   node tests/solitaire-bench.js sweep [n]    compare des réglages de l'objet AI, sur les mêmes donnes
 *   node tests/solitaire-bench.js stall [n]    sharp seul : longueur des parties, temps de décision
 *   (sweep : un 4e argument « depth 4,nodes 8000 » limite aux réglages nommés)
 *
 * On joue seul : pas de tablée. Chaque politique joue la même donne de bout en
 * bout (paquets tirés d'une graine fixe), si bien que la comparaison est
 * appariée — bien moins bruitée que deux taux de victoire tirés à part. Une
 * donne est gagnée dès que la fin automatique part : tout est découvert, la
 * suite est jouée d'avance.
 *
 * Une partie ne boucle pas : sharp ne revient jamais à une position déjà
 * jouée, et ne tire seul que tant que le talon cache des cartes jamais vues ;
 * simple ne joue que des coups qui avancent, et s'arrête quand le talon a fait
 * un tour sans coup. GUARD n'est qu'un garde-fou, que stall ne doit jamais voir.
 */
"use strict";

const { loadSolitaire } = require("./harness");

const { g, S } = loadSolitaire();
const AI = g("AI");
const SHIPPED = { ...AI };
const GUARD = 3000;

/* Un générateur à graine (mulberry32) : la donne n est la même pour toutes
   les politiques et d'un lancement à l'autre. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function deal(seed) {
  const rnd = mulberry32(seed * 7919 + 1);
  const d = g("buildDeck")();
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

function playDeal(seed, policy) {
  g("newGame")(deal(seed));
  const chooseMove = g("chooseMove"), playMove = g("playMove"), stuck = g("stuck");
  let decisions = 0, ms = 0, worst = 0;
  while (S.phase === "play") {
    if (S.moves > GUARD) return { win: false, stall: true, found: g("foundCount")(), moves: S.moves, decisions, ms, worst };
    const t = process.hrtime.bigint();
    const mv = chooseMove(policy);
    const dt = Number(process.hrtime.bigint() - t) / 1e6;
    decisions++;
    ms += dt;
    worst = Math.max(worst, dt);
    if (!mv || (mv.draw && stuck())) break;
    playMove(mv);
  }
  return { win: S.phase !== "play", stall: false, found: g("foundCount")(), moves: S.moves, decisions, ms, worst };
}

function tally(results) {
  const n = results.length;
  const s = { n, wins: 0, found: 0, moves: 0, decisions: 0, ms: 0, worst: 0, stalls: 0 };
  for (const r of results) {
    s.wins += r.win ? 1 : 0;
    s.found += r.found;
    s.moves += r.moves;
    s.decisions += r.decisions;
    s.ms += r.ms;
    s.worst = Math.max(s.worst, r.worst);
    s.stalls += r.stall ? 1 : 0;
  }
  return s;
}

const pct = (k, n) => `${((100 * k) / n).toFixed(1)} %`;
const line = (name, s) =>
  `${name.padEnd(14)} ${pct(s.wins, s.n).padStart(7)} gagnées · ${(s.found / s.n).toFixed(1).padStart(4)} cartes rangées · ` +
  `${(s.moves / s.n).toFixed(0).padStart(4)} coups · ${(s.ms / s.decisions).toFixed(2)} ms par décision (pire ${s.worst.toFixed(0)} ms)` +
  (s.stalls ? ` · BLOQUÉES ${s.stalls}` : "");

const mode = process.argv[2];
const numArg = (i, d) => (process.argv[i] && /^\d+$/.test(process.argv[i]) ? +process.argv[i] : d);

if (mode === "sweep") {
  const n = numArg(3, 200);
  const VARIANTS = [
    ["livré", {}],
    ["depth 4", { depth: 4 }], ["depth 8", { depth: 8 }],
    ["nodes 1500", { nodes: 1500 }], ["nodes 10000", { nodes: 10000 }],
    ["found 3", { found: 3 }], ["found 8", { found: 8 }],
    ["down 6", { down: 6 }], ["down 15", { down: 15 }],
    ["tall 0", { tall: 0 }], ["tall 2", { tall: 2 }],
    ["empty 2", { empty: 2 }], ["empty 9", { empty: 9 }],
    ["talon 1", { talon: 1 }], ["talon 4", { talon: 4 }],
    ["ahead 0", { ahead: 0 }], ["ahead 6", { ahead: 6 }],
  ];
  const only = process.argv[4] ? process.argv[4].split(",").map((x) => x.trim()) : null;
  console.log(`Réglages de sharp sur les mêmes ${n} donnes :`);
  let base = null;
  for (const [name, over] of VARIANTS) {
    if (only && name !== "livré" && !only.includes(name)) continue;
    Object.assign(AI, SHIPPED, over);
    const res = [];
    for (let k = 0; k < n; k++) res.push(playDeal(k, "sharp"));
    if (!base) base = res;
    const better = res.filter((r, k) => r.win && !base[k].win).length;
    const worse = res.filter((r, k) => !r.win && base[k].win).length;
    console.log(`${line(name, tally(res))}${name === "livré" ? "" : ` · +${better} / −${worse} donnes contre le livré`}`);
  }
  Object.assign(AI, SHIPPED);
} else if (mode === "stall") {
  const n = numArg(3, 300);
  const res = [];
  for (let k = 0; k < n; k++) res.push(playDeal(k, "sharp"));
  const s = tally(res);
  const longest = Math.max(...res.map((r) => r.moves));
  console.log(line("sharp", s));
  console.log(`bloquées ${s.stalls}/${n} (garde-fou à ${GUARD} coups) · partie la plus longue : ${longest} coups`);
} else {
  const n = numArg(2, 300);
  const sharp = [], simple = [];
  for (let k = 0; k < n; k++) {
    sharp.push(playDeal(k, "sharp"));
    simple.push(playDeal(k, "simple"));
  }
  console.log(`Les mêmes ${n} donnes, jouées par chaque politique :`);
  console.log(line("sharp", tally(sharp)));
  console.log(line("simple", tally(simple)));
  const both = sharp.filter((r, k) => r.win && simple[k].win).length;
  const onlySharp = sharp.filter((r, k) => r.win && !simple[k].win).length;
  const onlySimple = sharp.filter((r, k) => !r.win && simple[k].win).length;
  console.log(`gagnées par les deux ${both} · par sharp seule ${onlySharp} · par simple seule ${onlySimple}`);
}
