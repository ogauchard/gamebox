/* 5000 — règles du jeu de dés, vérifiées en jouant des parties complètes.
 * Lancer : node tests/cinq-mille.test.js
 *
 * Deux parties dans ce fichier :
 *   1. des parties complètes à 4 joueurs, sous invariants : chaque lancer jette
 *      les dés libres et garde tous ceux qui marquent (barème indépendant),
 *      sans passer 5000, main pleine, ballot (premier lancer seulement),
 *      tour perdu et dépassement vrais,
 *      encaissements permis (ouverture, multiple de 100), trois ballots, ordre
 *      des tours, scores reconstitués, fin à 5000 tout juste ;
 *   2. des cas ciblés, tours d'IA neutralisés et dés imposés.
 */
"use strict";

const { loadCinqMille, checker, globalClashes } = require("./harness");

const { g, S, byId, tick } = loadCinqMille();
const { ok, okOnce, report } = checker();
const ctx = g("globalThis");


/* --------------------------------------------------- Barème indépendant */
/* Écrit sans rien reprendre de la page : on répartit tous les dés en groupes
   qui marquent — un 1, un 5, un brelan, ou pour les cinq dés une suite ou un
   full (cinq dés pareils compris) — et on garde la meilleure répartition. 0 si
   un dé ne marque pas. */
const BR = { 1: 700, 2: 200, 3: 300, 4: 400, 5: 500, 6: 600 };
function refScore(vals) {
  const sorted = vals.slice().sort((a, b) => a - b);
  let best = 0;
  if (sorted.length === 5) {
    const s = sorted.join("");
    if (s === "12345" || s === "23456") best = 1000;
    const faces = [...new Set(sorted)];
    if (faces.length === 1) best = 2 * BR[faces[0]];
    if (faces.length === 2) {
      const n0 = sorted.filter((v) => v === faces[0]).length;
      if (n0 === 2 || n0 === 3) best = Math.max(best, 2 * BR[n0 === 3 ? faces[0] : faces[1]]);
    }
  }
  return Math.max(best, bestNoFull(sorted));
}
// Sans full ni suite : des brelans, des 1 et des 5. Sert aussi à savoir si un full a vraiment servi.
function bestNoFull(vals) {
  const rec = (arr) => {
    if (!arr.length) return 0;
    const v = arr[0];
    let b = -Infinity;
    if (v === 1 || v === 5) b = (v === 1 ? 100 : 50) + rec(arr.slice(1));
    if (arr[1] === v && arr[2] === v) b = Math.max(b, BR[v] + rec(arr.slice(3)));
    return b;
  };
  return Math.max(rec(vals.slice().sort((a, b) => a - b)), 0);
}

/* Les dés gardés d'un lancer, au barème indépendant : tous ceux qui marquent —
   la plus grande partie du lancer dont chaque dé marque, lue au mieux. */
function refKept(vals) {
  let n = 0, pts = 0;
  for (let m = 1; m < 1 << vals.length; m++) {
    const sub = vals.filter((_, i) => m >> i & 1);
    const p = refScore(sub);
    if (p && (sub.length > n || (sub.length === n && p > pts))) { n = sub.length; pts = p; }
  }
  return { n, pts };
}
const roomOf = () => 5000 - S.players[S.current].score - S.turnPts;

/* --------------------------------------------------------- Instrumentation */
/* Chaque lancer, chaque garde, chaque encaissement, chaque tour perdu et chaque
   début de tour est vérifié à l'instant où il a lieu. */
const illegal = [];
const bad = (what) => { illegal.push(what); };
const cov = { games: 0, turns: 0, maxRounds: 0, ballots: 0, losts: 0, busts: 0, zeros: 0, banks: 0, opens: 0, wins: 0, pleine: 0, full: 0, suites: 0, refused: 0 };
let expected = [];          // le score de chacun, reconstitué depuis les encaissements et les remises à zéro
let lastSeat = null;
let checkOrder = false;

const _newGame = ctx.newGame;
ctx.newGame = function (n) {
  expected = new Array(n).fill(0);
  lastSeat = null;
  return _newGame(n);
};

const _beginTurn = ctx.beginTurn;
ctx.beginTurn = function () {
  if (checkOrder && S.phase !== "over") {
    const want = lastSeat === null ? S.starter : (lastSeat + 1) % S.players.length;
    if (S.current !== want) bad({ order: S.current, want });
    lastSeat = S.current;
    cov.turns++;
  }
  return _beginTurn();
};

/* Un lancer : les dés libres, et tous ceux qui marquent désignés pour être
   gardés ; le tour est perdu si rien ne marque, ou si ces dés-là passent 5000. */
const _throwDice = ctx.throwDice;
ctx.throwDice = function () {
  const n = S.free, room = roomOf();
  if (S.dice.length) bad({ throwWithDice: S.dice.map((d) => d.v) });
  if (!(n >= 1 && n <= 5)) bad({ free: n });
  if (S.phase !== "roll" && S.phase !== "keep") bad({ throwPhase: S.phase });
  const scoring = _throwDice();
  const vals = S.dice.map((d) => d.v), rk = refKept(vals);
  if (vals.length !== n || !vals.every((v) => Number.isInteger(v) && v >= 1 && v <= 6)) bad({ thrown: vals, n });
  if (scoring !== (rk.n > 0 && rk.pts <= room)) bad({ lostWrong: vals, scoring, room });
  if (scoring) {
    const k = S.keep;
    if (!k || k.dice.length !== rk.n || k.pts !== rk.pts || refScore(k.dice.map((d) => d.v)) !== rk.pts
        || !k.dice.every((d) => S.dice.includes(d))) bad({ keptWrong: vals, keep: k && k.dice.map((d) => d.v) });
  } else if (S.phase !== "lost") bad({ lostPhase: S.phase });
  return scoring;
};

const _keepDice = ctx.keepDice;
ctx.keepDice = function () {
  const k = S.keep;
  if (!k || S.phase !== "keep") { bad({ keepNone: S.phase }); return _keepDice(); }
  const vals = k.dice.map((d) => d.v), ref = refScore(vals);
  if (ref > roomOf()) bad({ keepOver: vals, room: roomOf() });
  const t0 = S.turnPts, f0 = S.free;
  const pts = _keepDice();
  if (pts !== ref || S.turnPts !== t0 + ref) bad({ keepPts: vals, pts, ref });
  const left = f0 - vals.length;
  if (left ? S.free !== left : S.free !== 5 || S.carried !== S.turnPts || S.kept.length) bad({ pleine: vals, left, free: S.free });
  if (!left) cov.pleine++;
  if (vals.length === 5 && new Set(vals).size <= 2 && ref > bestNoFull(vals)) cov.full++;
  if (vals.length === 5 && new Set(vals).size === 5) cov.suites++;
  return pts;
};

const _bank = ctx.bank;
ctx.bank = function (seat) {
  const p = S.players[seat];
  const t = S.turnPts, s0 = p.score, opened = p.opened;
  if (seat !== S.current) bad({ bankSeat: seat, current: S.current });
  if (t <= 0 || t % 100 || (!opened && t < 500) || s0 + t > 5000) bad({ bankIllegal: t, opened, s0 });
  expected[seat] += t;
  cov.banks++;
  if (!opened) cov.opens++;
  _bank(seat);
  if (p.score !== s0 + t || p.fails !== 0 || !p.opened) bad({ bankAfter: p.score, s0, t });
  if ((s0 + t === 5000) !== (S.phase === "over")) bad({ end: s0 + t, phase: S.phase });
};

/* Un tour perdu : ballot (le premier lancer, cinq dés, ne marque rien), lancer
   suivant qui ne marque rien, ou dépassement (les dés qui marquent passeraient
   5000) ; seul le ballot compte dans les trois de suite, les deux autres en
   rompent la série. */
const _loseTurn = ctx.loseTurn;
ctx.loseTurn = function (why) {
  const seat = S.current, p = S.players[seat];
  const f0 = p.fails, s0 = p.score, first = S.turnPts === 0 && !S.kept.length && !S.carried;
  const vals = S.dice.map((d) => d.v);
  const want = refKept(vals).n > 0 ? "bust" : first ? "ballot" : "lost";
  if (why !== want || (want === "ballot" && vals.length !== 5)) bad({ why, want, vals });
  const r = _loseTurn(why);
  if (why !== "ballot") {
    cov[why === "bust" ? "busts" : "losts"]++;
    if (p.fails !== 0 || p.score !== s0 || p.last.kind !== why) bad({ lostAfter: why, fails: p.fails, score: p.score, s0 });
  } else {
    cov.ballots++;
    if (f0 + 1 >= 3) {
      if (p.score !== 0 || p.fails !== 0 || p.last.kind !== "zero") bad({ zero: p.score, fails: p.fails });
      expected[seat] = 0;
      cov.zeros++;
    } else if (p.fails !== f0 + 1 || p.score !== s0 || p.last.kind !== "ballot") {
      bad({ ballotAfter: p.fails, f0, score: p.score, s0 });
    }
  }
  if (S.turnPts !== 0) bad({ lostPts: S.turnPts });
  return r;
};

const _endGame = ctx.endGame;
ctx.endGame = function (seat) {
  const others = S.players.filter((p, i) => i !== seat);
  if (seat !== S.current || S.players[seat].score !== 5000 || others.some((p) => p.score >= 5000)) {
    bad({ endGame: seat, scores: S.players.map((p) => p.score) });
  }
  return _endGame(seat);
};

/* Les politiques ne font que décider : pendant chaque appel, l'état de la
   partie ne doit pas bouger, et aucun dé ne doit être tiré (Math.random). Il
   n'y a rien de caché au 5000 : c'est la seule triche possible. */
let impure = 0, counting = false, draws = 0;
const vmMath = g("Math");
const _random = vmMath.random;
vmMath.random = function () { if (counting) draws++; return _random(); };
const snapshot = () => JSON.stringify({
  d: S.dice, k: S.kept, keep: S.keep, t: S.turnPts, f: S.free, c: S.carried, ph: S.phase, cur: S.current,
  pl: S.players.map((p) => [p.score, p.opened, p.fails, p.turns, p.last]),
});
const _policyOf = ctx.policyOf;
ctx.policyOf = function (p) {
  const pol = _policyOf(p);
  return {
    decide(...args) {
      const before = snapshot();
      counting = true; draws = 0;
      try { return pol.decide(...args); }
      finally {
        counting = false;
        if (draws || snapshot() !== before) impure++;
      }
    },
  };
};

const onRollClick = ctx.onRollClick;
const onBankClick = ctx.onBankClick;
const myTurn = g("myTurn");
const keptVals = () => (S.keep ? S.keep.dice.map((d) => d.v).sort().join(" ") : "");

/* ---------------------------------------------------- 1. Parties complètes */
/* Le siège humain encaisse au hasard quand il le peut, en essayant au passage
   ce qui doit être refusé ; les dés gardés ne se choisissent pas. */
function humanAct() {
  const me = S.players[0];
  if (S.phase === "roll") {
    onBankClick();
    okOnce(S.phase === "roll" && !S.dice.length, "on n'encaisse rien avant d'avoir lancé");
    onRollClick();
    return;
  }
  const rk = refKept(S.dice.map((d) => d.v));
  okOnce(S.keep && S.keep.dice.length === rk.n && S.keep.pts === rk.pts, "après un lancer, tous les dés qui marquent sont gardés, lus au mieux");
  const t = S.turnPts + S.keep.pts;
  const can = t % 100 === 0 && (me.opened || t >= 500);
  if (can && (me.score + t === 5000 || Math.random() < 0.45)) { onBankClick(); return; }
  if (!can) {
    const t0 = S.turnPts, n0 = S.dice.length;
    onBankClick();
    ok(S.phase === "keep" && S.turnPts === t0 && S.dice.length === n0,
       `encaissement refusé : ${t} ${t % 100 ? "n'est pas un multiple de 100" : "ne suffit pas pour ouvrir"}`);
    cov.refused++;
  }
  onRollClick();
}

/* Toujours 4 joueurs par l'écran de départ, adversaires « sharp ». La
   politique simple ne sert plus que de référence au banc d'essai : on la fait
   jouer aussi, pour qu'elle reste légale et pure. */
async function playGame(level) {
  byId.get("btnStart").click();
  okOnce(S.players.length === 4 && S.players.slice(1).every((p) => p.ai && p.policy === "sharp") && !S.players[0].ai,
         "l'écran de départ lance 4 joueurs, adversaires « sharp » (Redoutable)");
  if (level !== "sharp") S.players.slice(1).forEach((p) => { p.policy = level; });
  let guard = 0;
  while (guard++ < 300000) {
    await tick();
    if (S.phase === "over") { checkGame(); return; }
    if (myTurn()) humanAct();
  }
  ok(false, "la partie se termine sans blocage (garde-fou atteint)");
}

function checkGame() {
  cov.games++;
  cov.wins += S.winner === 0 ? 1 : 0;
  cov.maxRounds = Math.max(cov.maxRounds, S.round);
  ok(illegal.length === 0, `lancers, gardes, encaissements et tours perdus tous réguliers (${JSON.stringify(illegal[0] || "")})`);
  illegal.length = 0;
  const w = S.players[S.winner];
  ok(w && w.score === 5000 && S.players.every((p, i) => i === S.winner || p.score < 5000),
     "la partie s'arrête au premier qui fait 5000 tout juste, et lui seul y est");
  ok(S.players.every((p, i) => p.score === expected[i]), `chaque score est la somme de ses encaissements depuis sa dernière remise à zéro (${S.players.map((p) => p.score)} / ${expected})`);
  okOnce(S.players.every((p) => p.score % 100 === 0 && p.score >= 0), "les scores restent des multiples de 100");
  okOnce(S.players.every((p) => p.opened === (p.best > 0)), "on est ouvert dès son premier encaissement");
  okOnce(byId.get("btnNext").dataset.over === "1" && !byId.get("scoreOverlay").hidden, "la feuille de fin de partie s'ouvre");
  okOnce(byId.get("scoreBody").innerHTML.includes(w.ai ? `<b>${w.name}</b> l'emporte` : "<b>Tu l'emportes</b>"), "la feuille nomme le gagnant");
  ok(impure === 0, "aucune politique ne modifie la partie ni ne tire de dé");
}

/* ============== 2. Cas ciblés — IA neutralisées, dés imposés ============== */
async function targetedTests() {
  checkOrder = false;
  const _aiTurn = ctx.aiTurn;
  g("aiTurn = async function () {};");

  const clashes = globalClashes("cinq-mille.html");
  ok(clashes.length === 0, `aucun nom de premier niveau ne masque une propriété de window (${clashes.join(", ")})`);

  /* ---------------------------------------------------------------- Barème */
  const sc = g("scoreOf");
  const table = [
    [[1], 100], [[5], 50], [[1, 5], 150], [[1, 1], 200], [[2], 0], [[5, 5, 6], 0],
    [[1, 1, 1], 700], [[2, 2, 2], 200], [[3, 3, 3], 300], [[4, 4, 4], 400], [[5, 5, 5], 500], [[6, 6, 6], 600],
    [[2, 2, 6, 6, 6], 1200], [[6, 6, 2, 2, 2], 400], [[5, 5, 1, 1, 1], 1400], [[1, 1, 5, 5, 5], 1000],
    [[1, 2, 3, 4, 5], 1000], [[2, 3, 4, 5, 6], 1000], [[3, 1, 5, 2, 4], 1000],
    [[1, 1, 1, 1, 1], 1400], [[5, 5, 5, 5, 5], 1000], [[2, 2, 2, 2, 2], 400], [[6, 6, 6, 6, 6], 1200],
    [[1, 1, 1, 1], 800], [[5, 5, 5, 5], 550], [[2, 2, 2, 2], 0],
    [[3, 3, 3, 3], 0], [[2, 2, 2, 2, 5], 0], [[2, 2, 2, 5], 250], [[4, 4, 4, 1, 5], 550], [[6, 6, 6, 1, 1], 1200],
  ];
  for (const [vals, pts] of table) ok(sc(vals) === pts, `${vals.join(" ")} vaut ${pts} (${sc(vals)})`);
  ok(sc([1, 1, 1]) === 700, "brelan de 1 : 700 points (règle de la maison)");
  ok(sc([1, 1, 1, 1, 1]) === 1400 && sc([3, 3, 3, 3, 3]) === 600, "cinq dés pareils : un full, le brelan × 2");
  ok(sc([2, 2, 2, 2]) === 0, "quatre dés pareils : pas de figure, le quatrième 2 ne marque pas");

  // Tous les lancers possibles, et toutes leurs parties : la page et le barème indépendant s'accordent,
  // sur les points comme sur les dés gardés.
  const keptOf = g("keptOf");
  let mismatches = 0, keptOff = 0, total = 0;
  const walk = (vals) => {
    if (vals.length) {
      total++;
      if (sc(vals) !== refScore(vals)) mismatches++;
      const k = keptOf(vals.map((v) => ({ v }))), rk = refKept(vals);
      if (k.dice.length !== rk.n || k.pts !== rk.pts) keptOff++;
    }
    if (vals.length < 5) for (let f = vals.length ? vals.at(-1) : 1; f <= 6; f++) walk([...vals, f]);
  };
  walk([]);
  ok(mismatches === 0 && total === 461, `les ${total} jeux de 1 à 5 dés se comptent comme au barème indépendant (${mismatches} écarts)`);
  ok(keptOff === 0, `et gardent les mêmes dés (${keptOff} écarts)`);
  const O = g("OUTCOMES");
  ok([1, 2, 3, 4, 5].every((n) => Math.abs(O[n].p.reduce((a, b) => a + b, 0) - 1) < 1e-12), "les probabilités des lancers de 1 à 5 dés somment à 1");
  const pBallot = O[5].p.reduce((a, p, i) => a + (O[5].k[i] ? 0 : p), 0);
  ok(Math.abs(pBallot - 600 / 7776) < 1e-12, `un ballot à cinq dés : 600 lancers sur 7776 (${(pBallot * 7776).toFixed(1)})`);

  /* -------------------------------------------------- Table posée à la main */
  /* Les dés sortent de `seq` dans l'ordre ; au-delà, au hasard. Le siège 0
     commence ; les adversaires ne jouent rien d'eux-mêmes (aiTurn neutralisé). */
  const seq = [];
  ctx.rollDie = () => (seq.length ? seq.shift() : 1 + Math.floor(_random() * 6));
  const setup = (st = {}) => {
    seq.length = 0;
    ctx.startGame(4);
    S.players.forEach((p, i) => {
      p.score = (st.scores || [0, 0, 0, 0])[i];
      p.opened = p.score > 0 || !!(st.opened && st.opened[i]);
      p.fails = (st.fails || [0, 0, 0, 0])[i];
    });
    S.current = 0; S.starter = 0; S.phase = "idle"; S.logs = [];
    ctx.beginTurn();
  };
  const roll = (vals) => { seq.push(...vals); onRollClick(); };
  const settle = async () => { for (let i = 0; i < 50 && S.phase === "lost"; i++) await tick(); };
  const me = () => S.players[0];
  const canBank = g("canBank");

  /* ------------------------------------------------------------ Un tour */
  setup({ opened: [true, true, true, true] });
  onBankClick();
  ok(S.phase === "roll" && S.current === 0, "rien à encaisser avant le premier lancer");
  roll([1, 2, 3, 4, 6]);
  ok(S.phase === "keep" && S.dice.length === 5, "le premier lancer jette les cinq dés");
  ok(keptVals() === "1" && S.keep.pts === 100, "le 1 marque seul : il est gardé, les autres se relanceront");
  roll([1, 1, 3, 6]);
  ok(S.turnPts === 100 && S.free === 4 && S.dice.length === 4, "« Relancer » met le 1 de côté et relance les quatre autres dés");
  ok(S.kept.length === 1 && S.kept[0].pts === 100, "le 1 gardé est mis de côté avec ses points");
  ok(keptVals() === "1 1", "deux 1 : gardés tous les deux");
  onBankClick();
  ok(S.current === 1 && me().score === 300,
     `un 1, puis deux 1 au lancer suivant : 100 + 200 = 300, pas un brelan (score ${me().score})`);
  onRollClick();
  ok(S.current === 1 && S.phase === "roll", "au tour d'un adversaire, les boutons ne répondent pas");

  /* ------------------------------------------------ Tous les dés qui marquent */
  setup({ scores: [1000, 0, 0, 0] });
  roll([1, 1, 5, 2, 3]);
  ok(keptVals() === "1 1 5" && S.keep.pts === 250 && !canBank(0),
     "deux 1 et un 5 : les trois sont gardés, 250, qui ne s'encaisse pas — on ne peut pas laisser le 5");
  setup({ scores: [1000, 0, 0, 0] });
  roll([2, 2, 2, 2, 5]);
  ok(keptVals() === "2 2 2 5" && S.keep.pts === 250, "quatre 2 et un 5 : le brelan et le 5, le quatrième 2 ne marque pas");
  roll([1]);
  ok(S.free === 1 && S.dice.length === 1 && S.turnPts === 250, "le quatrième 2 est le seul dé relancé");
  setup({ scores: [1000, 0, 0, 0] });
  roll([1, 1, 1, 5, 5]);
  ok(keptVals() === "1 1 1 5 5" && S.keep.pts === 1400, "un full de 1 par les 5 : les cinq dés, le brelan de 1 × 2 = 1400, plutôt que 700 + 100");
  roll([3, 1, 5, 2, 4]);
  ok(S.turnPts === 1400 && S.free === 5 && S.dice.length === 5, "un full prend les cinq dés : main pleine, ils repartent");
  ok(S.keep.pts === 1000, "suite 1 2 3 4 5 : 1000");
  onBankClick();
  ok(me().score === 3400, "full puis suite : 1400 + 1000 encaissés");

  setup({ scores: [1000, 0, 0, 0] });
  roll([1, 1, 1, 1, 1]);
  ok(S.phase === "keep" && S.keep.pts === 1400 && S.keep.dice.length === 5, "cinq 1 : un full, 1400, pas de victoire d'office");
  onBankClick();
  ok(S.phase !== "over" && me().score === 2400, "cinq 1 s'encaissent comme le reste");
  setup({ scores: [1000, 0, 0, 0] });
  roll([2, 2, 2, 2, 2]);
  ok(S.keep.dice.length === 5 && S.keep.pts === 400, "cinq 2 : un full de 400 qui prend les cinq dés");
  roll([1, 3, 3, 4, 6]);
  ok(S.free === 5 && S.dice.length === 5 && S.turnPts === 400, "cinq dés pareils : main pleine, les cinq repartent");

  /* ----------------------------------------------------------- Ouverture */
  setup();
  roll([1, 1, 1, 2, 3]);
  ok(canBank(0), "pas encore ouvert : 700 d'un coup, c'est assez");
  onBankClick();
  ok(S.current === 1 && me().opened && me().score === 700, "on ouvre avec 700");

  setup();
  roll([1, 2, 3, 4, 6]);
  onBankClick();
  ok(S.current === 0 && S.phase === "keep", "pas encore ouvert : 100 points ne s'encaissent pas");
  roll([1, 1, 2, 3]);
  onBankClick();
  ok(S.current === 0 && S.phase === "keep" && S.turnPts === 100, "pas encore ouvert : 300 non plus");
  roll([5, 4]);
  roll([5]);
  ok(S.dice.length === 1 && S.turnPts === 350, "on relance le dernier dé");
  roll([1, 2, 3, 4, 6]);
  ok(S.free === 5 && S.dice.length === 5 && S.turnPts === 400 && S.carried === 400 && !S.kept.length,
     "les cinq dés ont marqué en quatre lancers : main pleine, ils repartent tous");
  onBankClick();
  ok(S.current === 1 && me().score === 500, "400 + 100 : on ouvre avec 500");

  setup();
  roll([1, 1, 1, 2, 3]);
  roll([5, 4]);
  onBankClick();
  ok(S.current === 0 && S.phase === "keep", "750 : pas un multiple de 100, même pour ouvrir");

  /* ------------------------------------------------------- Multiple de 100 */
  setup({ scores: [1000, 0, 0, 0] });
  roll([5, 2, 2, 3, 6]);
  onBankClick();
  ok(S.current === 0 && S.phase === "keep", "50 points ne s'encaissent pas : il faut un multiple de 100");
  roll([5, 2, 3, 6]);
  onBankClick();
  ok(S.current === 1 && me().score === 1100, "5 + 5 = 100 : s'encaisse une fois ouvert");

  /* -------------------------------------------------------------- Ballots */
  setup({ scores: [1200, 0, 0, 0] });
  roll([2, 3, 4, 6, 6]);
  ok(S.phase === "lost" && S.busy && me().score === 1200 && me().fails === 1 && me().last.kind === "ballot",
     "ballot : le premier lancer ne marque rien, le score reste");
  onRollClick();
  ok(S.phase === "lost", "pendant le tour perdu, plus rien ne répond");
  await settle();
  ok(S.current === 1 && S.phase === "roll", "après un ballot, au suivant");

  setup({ scores: [1200, 0, 0, 0], fails: [2, 0, 0, 0] });
  roll([1, 5, 2, 3, 3]);
  roll([2, 3, 6]);
  ok(S.phase === "lost" && me().last.kind === "lost" && S.lost === 150 && S.turnPts === 0,
     "le premier lancer a marqué, le suivant non : le tour et ses 150 points sont perdus");
  ok(me().score === 1200 && me().fails === 0, "mais ce n'est pas un ballot : pas de retour à zéro malgré deux ballots avant, la série est rompue");
  await settle();
  setup({ scores: [1200, 0, 0, 0], fails: [2, 0, 0, 0] });
  roll([1, 1, 1, 5, 5]);
  roll([2, 3, 4, 6, 6]);
  ok(S.phase === "lost" && me().last.kind === "lost" && S.lost === 1400 && me().score === 1200 && me().fails === 0,
     "une main pleine relancée qui ne marque rien : cinq dés, mais pas le premier lancer, donc pas un ballot");
  await settle();

  setup({ scores: [1200, 0, 0, 0], fails: [1, 0, 0, 0] });
  roll([2, 3, 4, 6, 6]);
  ok(me().fails === 2 && me().score === 1200, "deuxième ballot de suite : le score tient encore");
  await settle();
  setup({ scores: [1200, 0, 0, 0], fails: [2, 0, 0, 0] });
  roll([2, 3, 4, 6, 6]);
  ok(me().score === 0 && me().fails === 0 && me().opened, "troisième ballot de suite : retour à zéro, on reste ouvert");
  ok(me().last.kind === "zero", "la remise à zéro est annoncée");
  await settle();
  setup({ scores: [1200, 0, 0, 0], fails: [2, 0, 0, 0] });
  roll([1, 1, 2, 3, 4]);
  onBankClick();
  ok(me().fails === 0 && me().score === 1400, "un tour encaissé efface les ballots");

  /* ------------------------------------------------------------- La fin */
  setup({ scores: [4800, 4000, 0, 0] });
  roll([1, 1, 2, 3, 4]);
  onBankClick();
  ok(S.phase === "over" && S.winner === 0 && me().score === 5000, "5000 tout juste en encaissant : victoire aussitôt");
  ok(byId.get("btnNext").dataset.over === "1" && byId.get("scoreBody").innerHTML.includes("<b>Tu l'emportes</b>"),
     "la feuille de fin de partie s'ouvre et nomme le gagnant");
  onRollClick();
  ok(S.phase === "over", "la partie finie, plus rien ne répond");

  setup({ scores: [4900, 0, 0, 0] });
  roll([5, 2, 2, 3, 6]);
  onBankClick();
  ok(S.phase === "keep", "4950 : pas un multiple de 100, il faut relancer même pour gagner");
  roll([5, 2, 3, 6]);
  onBankClick();
  ok(S.phase === "over" && me().score === 5000, "5 puis 5 : 5000 tout juste, gagné");

  /* Dépasser n'est pas un ballot : le lancer marquait. */
  setup({ scores: [4900, 0, 0, 0] });
  roll([1, 5, 2, 3, 6]);
  ok(S.phase === "lost" && me().last.kind === "bust" && me().score === 4900,
     "à 4900, un 1 et un 5 se gardent ensemble : 5050, le tour est perdu");
  await settle();
  setup({ scores: [4900, 0, 0, 0], fails: [2, 0, 0, 0] });
  roll([5, 2, 2, 3, 6]);
  roll([1, 2, 3, 6]);
  ok(S.phase === "lost" && me().last.kind === "bust", "il reste 50 et le lancer fait garder un 1 : 5050, le tour est perdu");
  ok(me().score === 4900 && me().fails === 0, "ce n'est pas un ballot : pas de retour à zéro malgré deux ballots avant, la série est rompue");
  await settle();
  setup({ scores: [4900, 0, 0, 0], fails: [1, 0, 0, 0] });
  roll([2, 2, 2, 3, 4]);
  ok(S.phase === "lost" && me().last.kind === "bust" && me().fails === 0 && S.lost === 0,
     "dès le premier lancer, un brelan de 2 qui ferait 5100 : tour perdu, sans ballot");
  await settle();
  const before = S.games;
  byId.get("btnNext").click();
  ok(S.phase !== "over" && S.players.every((p) => p.score === 0 && !p.opened) && S.current === before % 4,
     "« Rejouer » : nouvelle partie, et le premier joueur change");
  byId.get("scoreOverlay").hidden = true;

  /* ------------------------------------------------------------ Politiques */
  let uid = 100000;
  const pose = (level, vals, turnPts, free, st) => {
    setup(st);
    Object.assign(S, { current: 1, phase: "keep", turnPts, free, kept: [], carried: 0 });
    S.dice = vals.map((v) => ({ uid: ++uid, v }));
    S.keep = keptOf(S.dice);
    return g(`${level}Policy`).decide(S.players[1], 1).bank;
  };
  ok(pose("sharp", [1, 1, 2, 3, 4], 0, 5, { scores: [0, 4800, 0, 0] }), "sharp : à 4800, deux 1 : encaisse et gagne");
  ok(pose("sharp", [1, 1, 1, 5, 5], 0, 5, { scores: [0, 3600, 0, 0] }), "sharp : à 3600, un full à 1400 fait main pleine, mais gagne : encaisse");
  ok(pose("sharp", [1, 2, 3, 4, 6], 300, 5, { scores: [0, 1000, 0, 0] }), "sharp : 400 avec quatre dés à relancer : encaisse");
  ok(pose("sharp", [5, 2, 3], 250, 3, { scores: [0, 1000, 0, 0] }), "sharp : 300 et deux dés à relancer : encaisse");
  ok(pose("sharp", [1, 2, 3], 300, 3, { scores: [1000, 4500, 0, 0] }), "sharp : à 4500, 400 avec deux dés à relancer, personne près du but : encaisse");
  ok(pose("sharp", [1, 2, 3], 300, 3, { scores: [4900, 4500, 0, 0] }) === false,
     "sharp : la même chose quand un adversaire est à 4900 : tente les 500 qui manquent");
  ok(pose("sharp", [1], 500, 1, { scores: [0, 3000, 0, 0] }) === false,
     "sharp : 600 et main pleine, cinq dés à relancer : relance");
  ok(pose("sharp", [1], 500, 1, { scores: [0, 3000, 0, 0], fails: [0, 2, 0, 0] }) === false,
     "sharp : la même chose après deux ballots de suite : relance aussi, le tour ne peut plus finir en ballot");
  ok(pose("simple", [1, 2, 3, 4, 6], 300, 5, { scores: [0, 1000, 0, 0] }), "simple : encaisse dès 400");
  ok(!pose("simple", [1, 2, 3, 4, 6], 300, 5), "simple : pas encore ouvert, 400 ne s'encaissent pas");
  ok(!pose("simple", [5, 5, 2, 3], 250, 4, { scores: [0, 1000, 0, 0] }), "simple : 350 ne s'encaissent pas, relance");

  /* Une décision hors des règles est corrigée : pas d'encaissement interdit. */
  g("POLICIES").evil = { decide: () => ({ bank: true }) };
  setup({ scores: [0, 1000, 0, 0] });
  Object.assign(S, { current: 1, phase: "keep", turnPts: 0, free: 5, kept: [], carried: 0 });
  S.dice = [5, 2, 2, 3, 6].map((v) => ({ uid: ++uid, v }));
  S.keep = keptOf(S.dice);
  S.players[1].policy = "evil";
  ok(g("decide")(1) === false, "une décision d'encaisser 50 est refusée : on relance");
  delete g("POLICIES").evil;

  /* Un tour entier de l'ordinateur, aiTurn rétabli : il lance, garde, encaisse. */
  setup({ scores: [0, 4800, 0, 0] });
  S.current = 1;
  S.phase = "roll";
  seq.push(1, 1, 2, 3, 4);
  const turn = _aiTurn();
  ok(S.busy && !myTurn(), "pendant le tour de l'ordinateur, l'humain attend");
  await turn;
  for (let i = 0; i < 20 && S.phase !== "over"; i++) await tick();
  ok(S.phase === "over" && S.winner === 1 && S.players[1].score === 5000, "l'ordinateur à 4800 garde ses deux 1 et gagne");
  ok(byId.get("scoreBody").innerHTML.includes("<b>Nora</b> l'emporte"), "la feuille nomme le gagnant");

  ok(illegal.length === 0, `cas ciblés : rien d'irrégulier (${JSON.stringify(illegal[0] || "")})`);
  ok(impure === 0, "cas ciblés : aucune politique ne modifie la partie");
}

/* ------------------------------------------------------------------ Main */
(async () => {
  const t0 = Date.now();
  checkOrder = true;
  for (let i = 0; i < 16; i++) await playGame("sharp");
  for (let i = 0; i < 6; i++) await playGame("simple");
  await targetedTests();
  console.log("Couverture :", JSON.stringify(cov), `(${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  report("5000");
})();
