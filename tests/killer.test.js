/* Killer — règles du jeu de dés, vérifiées en jouant des parties complètes.
 * Lancer : node tests/killer.test.js
 *
 * Deux parties dans ce fichier :
 *   1. des parties complètes à 4 joueurs, sous invariants : la visée jette les
 *      dés libres, garde au moins un dé et pas tous, s'arrête sur cinq dés dont
 *      le total décide (barème indépendant) ; l'attaque met de côté les dés de
 *      sa valeur et relance les cinq quand ils y sont tous ; chaque tour change
 *      les PV de ce qu'il doit et de rien d'autre ; seul un joueur qui a
 *      commencé son tour à l'agonie peut mourir, à la fin de ce tour ; ordre
 *      des tours, morts sautés et jamais visés ; fin au dernier survivant ;
 *   2. des cas ciblés, tours d'IA neutralisés et dés imposés.
 */
"use strict";

const { loadKiller, checker, globalClashes } = require("./harness");

const { g, S, byId, tick } = loadKiller();
const { ok, okOnce, report } = checker();
const ctx = g("globalThis");

/* --------------------------------------------------- Barème indépendant */
/* Écrit sans rien reprendre de la page. */
function refOutcome(t) {
  if (t <= 10) return { kind: "attack", v: 11 - t };
  if (t >= 25) return { kind: "attack", v: t - 24 };
  if (t === 11 || t === 24) return { kind: "regen" };
  return { kind: "miss", loss: Math.min(t - 11, 24 - t) };
}
const total = (dice) => dice.reduce((a, d) => a + d.v, 0);
const inGame = (seat) => S.players.map((p, i) => i).filter((i) => i !== seat && !S.players[i].dead);

/* --------------------------------------------------------- Instrumentation */
/* Chaque lancer, chaque garde, chaque fin de visée, chaque lancer d'attaque et
   chaque fin de tour est vérifié à l'instant où il a lieu. */
const illegal = [];
const bad = (what) => { illegal.push(what); };
const cov = { games: 0, turns: 0, maxRounds: 0, attacks: 0, regens: 0, misses: 0, folds: 0, forced: 0, deaths: 0, revivals: 0,
              suicides: 0, agonies: 0, noWinner: 0, humanDead: 0, humanWins: 0, refused: 0 };
let turn = null;            // le tour en cours : siège, PV et morts au début, dernière chance, dés touchés
let lastSeat = null;
let checkOrder = false;

const _newGame = ctx.newGame;
ctx.newGame = function (n) {
  lastSeat = null;
  turn = null;
  return _newGame(n);
};

/* Au suivant encore en jeu, mort sauté. */
const _beginTurn = ctx.beginTurn;
ctx.beginTurn = function () {
  if (S.phase !== "over") {
    if (checkOrder) {
      let want = S.starter;
      if (lastSeat !== null) {
        want = lastSeat;
        do want = (want + 1) % S.players.length; while (S.players[want].dead);
      }
      if (S.current !== want) bad({ order: S.current, want });
    }
    if (S.players[S.current].dead) bad({ deadPlays: S.current });
    lastSeat = S.current;
    turn = { seat: S.current, start: S.players.map((p) => p.hp), dead: S.players.map((p) => p.dead), last: S.players[S.current].hp < 0, hits: 0 };
    cov.turns++;
  }
  return _beginTurn();
};

/* Un lancer de la visée : les dés libres, cinq moins ceux de côté. Un seul dé
   lancé arrête la visée d'office. */
const _throwDice = ctx.throwDice;
ctx.throwDice = function () {
  const n = S.free, keptN = S.kept.length;
  if (S.phase !== "roll" && S.phase !== "keep") bad({ throwPhase: S.phase });
  if (n < 1 || keptN + n !== 5) bad({ free: n, keptN });
  _throwDice();
  if (n === 1) {
    cov.forced++;
    if (S.phase === "keep" || !S.aim || S.aim.dice.length !== 5) bad({ forced: S.phase });
  } else if (S.dice.length !== n || !S.dice.every((d) => Number.isInteger(d.v) && d.v >= 1 && d.v <= 6)) {
    bad({ thrown: S.dice.map((d) => d.v), n });
  }
};

/* Garder : au moins un dé du lancer en cours, pas tous, sans doublon. */
const _doKeep = ctx.doKeep;
ctx.doKeep = function (seat, uids) {
  const legal = S.current === seat && S.phase === "keep" && Array.isArray(uids) && new Set(uids).size === uids.length
             && uids.length >= 1 && uids.length < S.dice.length && uids.every((u) => S.dice.some((d) => d.uid === u));
  const chosen = legal ? S.dice.filter((d) => uids.includes(d.uid)) : [];
  const before = S.kept.length;
  const r = _doKeep(seat, uids);
  if (r !== legal) bad({ keepLegal: legal, r, uids });
  if (r) {
    const side = S.phase === "keep" ? S.kept : S.aim.dice;
    if (!chosen.every((d) => side.includes(d)) || (S.phase === "keep" && S.kept.length !== before + chosen.length)) bad({ keptWrong: chosen.map((d) => d.v) });
  }
  return r;
};

/* La fin de la visée : exactement cinq dés, leur total au barème indépendant. */
const _stopAim = ctx.stopAim;
ctx.stopAim = function () {
  const all = [...S.kept, ...S.dice];
  const t = total(all), ref = refOutcome(t);
  if (all.length !== 5) bad({ stopDice: all.length });
  const r = _stopAim();
  const a = S.aim;
  if (a.total !== t || a.kind !== ref.kind || a.v !== ref.v || a.loss !== ref.loss) bad({ aim: a, ref });
  return r;
};

/* Un lancer d'attaque : les touches du lancer précédent passent de côté, cinq
   de côté repartent tous ; on relance le reste. */
const _throwAttack = ctx.throwAttack;
ctx.throwAttack = function (v) {
  if (S.phase !== "attack" || v !== S.aim.v) bad({ attackPhase: S.phase, v });
  let keptN = S.kept.length + S.dice.filter((d) => d.v === v).length;
  if (keptN > 5) bad({ keptN });
  if (keptN === 5) { keptN = 0; cov.folds++; }
  const r = _throwAttack(v);
  if (S.dice.length !== 5 - keptN || r !== S.dice.filter((d) => d.v === v).length) bad({ attackThrow: S.dice.map((d) => d.v), keptN, r });
  if (turn) turn.hits += r;
  return r;
};

/* La fin d'un tour : les PV ont changé de ce que le tour devait, et de rien
   d'autre ; seul le joueur qui a commencé son tour à l'agonie peut mourir, s'il
   y est encore ; la partie finit au dernier survivant, pas avant. */
const _endTurn = ctx.endTurn;
ctx.endTurn = function () {
  const seat = S.current, t = turn, aim = S.aim;
  if (!t || t.seat !== seat || !aim) { bad({ endTurn: seat }); return _endTurn(); }
  const hp = S.players.map((q) => q.hp);
  const expect = t.start.slice();
  if (aim.kind === "regen") {
    if (!(S.gain >= 1 && S.gain <= 6)) bad({ gain: S.gain });
    expect[seat] += S.gain;
    cov.regens++;
  } else if (aim.kind === "miss") {
    expect[seat] -= refOutcome(aim.total).loss;
    cov.misses++;
  } else {
    const j = S.target, list = inGame(seat);
    if (j === -1 ? list.length !== 0 : !list.includes(j)) bad({ target: j, list });
    if (j >= 0) {
      expect[j] -= aim.v * t.hits;
      if (S.dmg !== aim.v * t.hits) bad({ dmg: S.dmg, v: aim.v, hits: t.hits });
    }
    cov.attacks++;
    if (t.last) cov.suicides++;
  }
  if (hp.some((h, i) => h !== expect[i])) bad({ hpTurn: hp, expect, kind: aim.kind });
  const dies = t.last && hp[seat] < 0;
  _endTurn();
  S.players.forEach((q, i) => {
    if (q.dead !== (t.dead[i] || (i === seat && dies))) bad({ death: i, dead: q.dead, seat, last: t.last, hp: hp[seat] });
  });
  if (dies) { cov.deaths++; if (seat === 0) cov.humanDead++; }
  if (t.last && hp[seat] >= 0) cov.revivals++;
  if (!t.last && hp[seat] < 0) cov.agonies++;
  const live = S.players.filter((q) => !q.dead);
  const over = live.length <= 1 && !live.some((q) => q.hp < 0);
  if ((S.phase === "over") !== over) bad({ over: S.phase, live: live.length });
  if (over && S.winner !== (live.length ? S.players.indexOf(live[0]) : -1)) bad({ winner: S.winner });
};

/* Les politiques ne font que décider : pendant chaque appel, l'état de la
   partie ne doit pas bouger, et aucun dé ne doit être tiré (Math.random). Il
   n'y a rien de caché au Killer : c'est la seule triche possible. */
let impure = 0, counting = false, draws = 0;
const vmMath = g("Math");
const _random = vmMath.random;
vmMath.random = function () { if (counting) draws++; return _random(); };
const snapshot = () => JSON.stringify({
  d: S.dice, k: S.kept, f: S.free, a: S.aim, ph: S.phase, cur: S.current, t: S.target, h: S.hits, l: S.lastChance,
  pl: S.players.map((p) => [p.hp, p.dead, p.turns, p.last, p.dealt, p.revived]),
});
const _policyOf = ctx.policyOf;
ctx.policyOf = function (p) {
  const pol = _policyOf(p);
  const pure = (fn) => (...args) => {
    const before = snapshot();
    counting = true; draws = 0;
    try { return fn(...args); }
    finally {
      counting = false;
      if (draws || snapshot() !== before) impure++;
    }
  };
  return { keep: pure(pol.keep), target: pure(pol.target) };
};

const onRollClick = ctx.onRollClick;
const onStopClick = ctx.onStopClick;
const onDieClick = ctx.onDieClick;
const onTargetClick = ctx.onTargetClick;
const myTurn = g("myTurn");
const uids = () => S.dice.map((d) => d.uid).join();

/* ---------------------------------------------------- 1. Parties complètes */
/* Le siège humain garde des dés au hasard, s'arrête parfois, vise au hasard,
   en essayant au passage ce qui doit être refusé. */
function humanAct() {
  if (S.phase === "roll") {
    onStopClick();
    okOnce(S.phase === "roll" && !S.dice.length, "on ne s'arrête pas avant d'avoir lancé");
    onRollClick();
    return;
  }
  if (S.phase === "keep") {
    okOnce(S.dice.length >= 2, "après un lancer d'un seul dé, la visée s'arrête d'elle-même");
    if (Math.random() < 0.2) { onStopClick(); return; }
    for (const u of [...S.sel]) onDieClick(u);
    const r = Math.random();
    if (r < 0.1) {
      const before = uids();
      onRollClick();
      ok(S.phase === "keep" && uids() === before, "relancer sans garder de dé est refusé");
      cov.refused++;
    } else if (r < 0.2) {
      for (const d of S.dice) onDieClick(d.uid);
      const before = uids();
      onRollClick();
      ok(S.phase === "keep" && uids() === before, "garder tous les dés ne relance rien");
      cov.refused++;
      for (const d of S.dice) onDieClick(d.uid);
    }
    const k = 1 + Math.floor(Math.random() * (S.dice.length - 1));
    for (const d of S.dice.slice().sort(() => Math.random() - 0.5).slice(0, k)) onDieClick(d.uid);
    onRollClick();
    return;
  }
  if (S.phase === "target") {
    onTargetClick(0);
    okOnce(S.phase === "target", "on ne s'attaque pas soi-même");
    const dead = S.players.findIndex((q) => q.dead);
    if (dead > 0) {
      onTargetClick(dead);
      okOnce(S.phase === "target", "un mort ne peut plus être attaqué");
    }
    const list = inGame(0);
    onTargetClick(list[Math.floor(Math.random() * list.length)]);
  }
}

/* Toujours 4 joueurs par l'écran de départ, adversaires « sharp ». La
   politique simple ne sert plus que de référence au banc d'essai : on la fait
   jouer aussi, pour qu'elle reste légale et pure. */
async function playGame(level) {
  byId.get("btnStart").click();
  okOnce(S.players.length === 4 && S.players.slice(1).every((p) => p.ai && p.policy === "sharp") && !S.players[0].ai,
         "l'écran de départ lance 4 joueurs, adversaires « sharp » (Redoutable)");
  okOnce(S.players.every((p) => p.hp === 25 && !p.dead), "tout le monde part avec 25 PV");
  if (level !== "sharp") S.players.slice(1).forEach((p) => { p.policy = level; });
  let guard = 0;
  while (guard++ < 600000) {
    await tick();
    if (S.phase === "over") { checkGame(); return; }
    if (myTurn()) humanAct();
  }
  ok(false, "la partie se termine sans blocage (garde-fou atteint)");
}

function checkGame() {
  cov.games++;
  cov.maxRounds = Math.max(cov.maxRounds, S.round);
  ok(illegal.length === 0, `visées, gardes, attaques, PV et morts tous réguliers (${JSON.stringify(illegal[0] || "")})`);
  illegal.length = 0;
  const live = S.players.filter((p) => !p.dead);
  ok(live.length <= 1 && live.every((p) => p.hp >= 0), "la partie s'arrête sur un survivant, ou aucun, et personne à l'agonie");
  if (S.winner < 0) cov.noWinner++;
  if (S.winner === 0) cov.humanWins++;
  okOnce(byId.get("btnNext").dataset.over === "1" && !byId.get("scoreOverlay").hidden, "la feuille de fin de partie s'ouvre");
  const w = S.players[S.winner];
  ok(byId.get("scoreBody").innerHTML.includes(!w ? "<b>Personne</b> ne survit" : w.ai ? `<b>${w.name}</b> l'emporte` : "<b>Tu l'emportes</b>"),
     "la feuille nomme le gagnant, ou personne");
  ok(impure === 0, "aucune politique ne modifie la partie ni ne tire de dé");
}

/* ============== 2. Cas ciblés — IA neutralisées, dés imposés ============== */
async function targetedTests() {
  checkOrder = false;
  const _aiTurn = ctx.aiTurn;
  g("aiTurn = async function () {};");

  const clashes = globalClashes("killer.html");
  ok(clashes.length === 0, `aucun nom de premier niveau ne masque une propriété de window (${clashes.join(", ")})`);

  /* ---------------------------------------------------------------- Barème */
  const outcomeOf = g("outcomeOf");
  const table = [
    [5, "attack", 6], [6, "attack", 5], [9, "attack", 2], [10, "attack", 1], [11, "regen"],
    [12, "miss", 1], [13, "miss", 2], [17, "miss", 6], [18, "miss", 6], [20, "miss", 4], [23, "miss", 1],
    [24, "regen"], [25, "attack", 1], [27, "attack", 3], [30, "attack", 6],
  ];
  for (const [t, kind, n] of table) {
    const o = outcomeOf(t);
    ok(o.kind === kind && (kind === "regen" || (o.v || o.loss) === n), `un total de ${t} : ${kind}${n ? " " + n : ""} (${JSON.stringify(o)})`);
  }
  let off = 0;
  for (let t = 5; t <= 30; t++) { const a = outcomeOf(t), b = refOutcome(t); if (a.kind !== b.kind || a.v !== b.v || a.loss !== b.loss) off++; }
  ok(off === 0, `les 26 totaux de 5 à 30 se lisent comme au barème indépendant (${off} écarts)`);
  ok(outcomeOf(13).kind === "miss" && outcomeOf(16).loss === 5, "entre 12 et 17, on perd des PV (la « synthèse » de l'article n'est pas suivie)");

  const THROWS = g("THROWS"), COUNT = g("COUNT"), P_REGEN = g("P_REGEN");
  ok([1, 2, 3, 4, 5].every((n) => Math.abs(THROWS[n].reduce((a, t) => a + t.p, 0) - 1) < 1e-12), "les probabilités des lancers de 1 à 5 dés somment à 1");
  ok(THROWS[5].length === 252, `252 lancers distincts de cinq dés (${THROWS[5].length})`);
  ok(Math.abs(COUNT.reduce((a, b) => a + b, 0) - 1) < 1e-9 && Math.abs(COUNT[0] - (5 / 6) ** 5) < 1e-12,
     "les dés touchés par une attaque : probabilités qui somment à 1, aucun touché = (5/6)^5");
  ok(P_REGEN > 0.3 && P_REGEN < 0.5, `la meilleure chance de faire 11 ou 24 tout juste : ${(P_REGEN * 100).toFixed(1)} %`);

  /* -------------------------------------------------- Table posée à la main */
  /* Les dés sortent de `seq` dans l'ordre ; au-delà, au hasard. Les adversaires
     ne jouent rien d'eux-mêmes (aiTurn neutralisé) : on joue leurs sièges par
     doThrow/doKeep/doStop/doAttack. */
  const seq = [];
  ctx.rollDie = () => (seq.length ? seq.shift() : 1 + Math.floor(_random() * 6));
  const setup = (st = {}) => {
    seq.length = 0;
    ctx.startGame(4);
    S.players.forEach((p, i) => {
      p.hp = (st.hp || [25, 25, 25, 25])[i];
      p.dead = !!(st.dead && st.dead[i]);
    });
    S.current = st.current || 0; S.starter = 0; S.phase = "idle"; S.logs = [];
    ctx.beginTurn();
  };
  const settle = async () => { for (let i = 0; i < 200 && ["attack", "regen", "miss"].includes(S.phase); i++) await tick(); };
  const P = (i) => S.players[i];
  const me = () => P(0);
  // Choisit des dés du lancer par leur valeur, puis relance le reste avec `next`.
  const select = (vals) => {
    for (const u of [...S.sel]) onDieClick(u);
    const used = new Set();
    for (const v of vals) { const d = S.dice.find((x) => x.v === v && !used.has(x.uid)); used.add(d.uid); onDieClick(d.uid); }
  };
  const roll = (vals) => { seq.push(...vals); onRollClick(); };
  const keep = (vals, next) => { select(vals); roll(next); };
  // Un siège de l'ordinateur, joué à la main.
  const throwAs = (seat, vals) => { seq.push(...vals); return g("doThrow")(seat); };
  const keepAs = (seat, vals, next) => {
    const used = new Set(), ids = [];
    for (const v of vals) { const d = S.dice.find((x) => x.v === v && !used.has(x.uid)); used.add(d.uid); ids.push(d.uid); }
    seq.push(...next);
    return g("doKeep")(seat, ids);
  };
  const stopAs = (seat) => g("doStop")(seat);

  /* ------------------------------------------------------------ La visée */
  setup();
  onStopClick();
  ok(S.phase === "roll" && !S.dice.length, "rien à arrêter avant le premier lancer");
  roll([1, 1, 2, 6, 6]);
  ok(S.phase === "keep" && S.dice.length === 5 && S.free === 5, "le premier lancer jette les cinq dés");
  let before = uids();
  onRollClick();
  ok(S.phase === "keep" && uids() === before, "relancer sans garder de dé : refusé, il faut en garder un au moins");
  select([1, 1, 2, 6, 6]);
  onRollClick();
  ok(S.phase === "keep" && uids() === before, "garder les cinq dés ne relance rien : c'est s'arrêter");
  select([1]);
  onDieClick(S.dice.find((d) => d.v === 1 && S.sel.has(d.uid)).uid);
  ok(S.sel.size === 0, "toucher un dé choisi le rend");
  keep([1, 1], [1, 2, 3]);
  ok(S.kept.length === 2 && S.dice.length === 3 && S.free === 3, "« Relancer » met les deux 1 de côté et relance les trois autres dés");
  ok(S.kept.every((d) => d.v === 1), "les dés de côté sont ceux qu'on a choisis");
  onTargetClick(1);
  ok(S.phase === "keep", "pas de cible à choisir pendant la visée");
  onStopClick();
  ok(S.aim && S.aim.total === 8 && S.aim.kind === "attack" && S.aim.v === 3 && S.phase === "target",
     "s'arrêter sur 1 1 + 1 2 3 = 8 : une attaque aux 3, et le choix de la cible");
  onRollClick();
  ok(S.phase === "target", "pendant le choix de la cible, plus de lancer");

  /* ----------------------------------------------------------- L'attaque */
  onTargetClick(0);
  ok(S.phase === "target", "on ne s'attaque pas soi-même");
  seq.push(3, 3, 1, 2, 4, 3, 5, 6, 1, 2);
  onTargetClick(2);
  ok(S.phase === "attack" && S.target === 2 && S.busy, "l'attaque part sur la cible choisie, l'humain attend");
  await settle();
  ok(P(2).hp === 16 && me().dealt === 9, `attaque aux 3 : deux 3, puis un 3 sur les trois dés relancés, puis rien — 3 × 3 = 9 (${P(2).hp})`);
  ok(S.current === 1 && P(2).hp === 16 && P(1).hp === 25 && me().hp === 25, "la cible seule perd des PV, et c'est au suivant");

  setup();
  roll([6, 6, 6, 6, 1]);
  onStopClick();
  ok(S.aim.total === 25 && S.aim.v === 1 && S.phase === "target", "on peut s'arrêter dès le premier lancer : 25, attaque aux 1");

  // L'exemple 2 de l'article : cinq 6 de côté, ils repartent tous ; six 6 font 36.
  setup();
  roll([6, 6, 6, 6, 6]);
  onStopClick();
  ok(S.aim.v === 6, "30 : attaque aux 6");
  seq.push(6, 6, 6, 6, 6, 6, 1, 1, 1, 1, 2, 3, 4, 5);
  onTargetClick(1);
  await settle();
  ok(P(1).hp === -11 && me().dealt === 36, `attaque aux 6 : cinq 6 de côté repartent tous, un 6 de plus, puis rien — 6 × 6 = 36 (${P(1).hp})`);
  ok(!P(1).dead && P(1).hp < 0, "à −11, la cible est à l'agonie, pas encore morte");

  /* ---------------------------------------------- Visée jusqu'au dernier dé */
  setup();
  roll([1, 2, 3, 4, 5]);
  keep([1], [1, 2, 3, 4]);
  keep([1], [1, 2, 3]);
  keep([1], [1, 2]);
  keep([1], [2]);
  ok(S.phase !== "keep" && S.aim && S.aim.total === 6 && S.aim.v === 5,
     "un dé à la fois jusqu'au cinquième : le dernier lancé, la visée s'arrête d'elle-même (1 1 1 1 2 = 6, attaque aux 5)");
  ok(S.phase === "target", "et l'on choisit sa cible");

  /* ------------------------------------------------------ Régénération */
  setup();
  roll([1, 2, 3, 4, 1]);
  seq.push(5);
  onStopClick();
  ok(S.phase === "regen" && S.aim.total === 11, "11 tout juste : régénération");
  await settle();
  ok(me().hp === 30 && S.current === 1, `un dé de 5 : +5 PV, au-delà des 25 du départ (${me().hp})`);
  setup();
  roll([6, 6, 6, 4, 2]);
  seq.push(2);
  onStopClick();
  await settle();
  ok(me().hp === 27, "24 tout juste : régénération aussi");

  /* ------------------------------------------------------------- Ratés */
  setup();
  roll([3, 3, 3, 4, 4]);
  onStopClick();
  ok(S.phase === "miss", "17 : raté");
  await settle();
  ok(me().hp === 19, `17 : −6 PV (${me().hp})`);
  setup();
  roll([3, 3, 3, 2, 2]);
  onStopClick();
  await settle();
  ok(me().hp === 23, "13 : −2 PV, l'écart à 11");
  setup();
  roll([6, 5, 4, 4, 4]);
  onStopClick();
  await settle();
  ok(me().hp === 24, "23 : −1 PV, l'écart à 24 (l'exemple de l'article)");

  /* ------------------------------------------------------------ Agonie */
  setup({ hp: [2, 25, 25, 25] });
  roll([3, 3, 3, 4, 4]);
  onStopClick();
  await settle();
  ok(me().hp === -4 && !me().dead && S.current === 1, "un raté qui passe sous 0 : à l'agonie, pas mort");
  setup({ hp: [0, 25, 25, 25] });
  ok(!S.lastChance, "à 0 PV tout juste, on n'est pas à l'agonie");

  // Dernière chance : une régénération suffisante ramène en jeu.
  setup({ hp: [-4, 25, 25, 25] });
  ok(S.lastChance && S.phase === "roll", "à l'agonie, le tour suivant est la dernière chance");
  roll([6, 6, 6, 4, 2]);
  seq.push(4);
  onStopClick();
  await settle();
  ok(me().hp === 0 && !me().dead && me().revived === 1, "−4 et une régénération de 4 : 0 PV, revenu d'entre les morts");
  // Pas assez : mort.
  setup({ hp: [-4, 25, 25, 25] });
  roll([6, 6, 6, 4, 2]);
  seq.push(3);
  onStopClick();
  await settle();
  ok(me().dead && me().hp === -1 && S.current === 1, "−4 et une régénération de 3 : −1, mort à la fin du tour");
  // Raté : mort.
  setup({ hp: [-1, 25, 25, 25] });
  roll([3, 3, 3, 2, 2]);
  onStopClick();
  await settle();
  ok(me().dead && me().hp === -3, "à l'agonie, un raté : mort");
  // Attaque suicide : on attaque, puis on meurt.
  setup({ hp: [-3, 25, 25, 25] });
  roll([1, 1, 1, 1, 1]);
  onStopClick();
  ok(S.phase === "target" && S.aim.v === 6, "à l'agonie, une attaque : on choisit sa cible");
  seq.push(6, 6, 1, 1, 1, 2, 2, 2);
  onTargetClick(3);
  await settle();
  ok(P(3).hp === 13 && me().dead, "attaque suicide : la cible perd 12, puis l'attaquant meurt");
  // Sous −6 : plus de régénération possible.
  setup({ hp: [-8, 25, 25, 25] });
  ok(byId.get("status").innerHTML.includes("attaque suicide"), "sous −6, le statut dit qu'il ne reste que l'attaque suicide");
  roll([6, 6, 6, 4, 2]);
  seq.push(6);
  onStopClick();
  await settle();
  ok(me().dead && me().hp === -2, "−8 et une régénération de 6 : −2, mort");

  /* ---------------------------------------------------- Morts et cibles */
  setup({ hp: [25, -2, 25, 25] });
  roll([1, 1, 1, 1, 2]);
  onStopClick();
  onTargetClick(1);
  ok(S.phase === "attack" && S.target === 1, "un joueur à l'agonie peut être attaqué");
  await settle();
  setup({ dead: [false, true, false, false] });
  roll([1, 1, 1, 1, 2]);
  onStopClick();
  onTargetClick(1);
  ok(S.phase === "target", "un mort ne peut pas être attaqué");
  onTargetClick(3);
  await settle();
  ok(S.current === 2, "un mort ne joue plus : son tour est sauté");
  setup({ dead: [false, true, true, false] });
  roll([1, 1, 1, 1, 2]);
  seq.push(1, 2, 3, 4, 5);
  onStopClick();
  ok(S.phase === "attack" && S.target === 3, "un seul adversaire en jeu : l'attaque part sur lui sans qu'on choisisse");
  await settle();

  /* -------------------------------------------------------------- La fin */
  // Le dernier adversaire tombe à l'agonie : il joue encore son dernier tour.
  setup({ hp: [25, 3, 25, 25], dead: [false, false, true, true] });
  roll([1, 1, 1, 1, 1]);
  seq.push(6, 1, 1, 1, 1, 2, 2, 2, 2);
  onStopClick();
  await settle();
  ok(P(1).hp === -3 && S.phase === "roll" && S.current === 1 && S.lastChance, "le dernier adversaire à l'agonie : la partie continue, il joue sa dernière chance");
  throwAs(1, [3, 3, 3, 4, 4]);
  stopAs(1);
  await settle();
  ok(S.phase === "over" && S.winner === 0 && P(1).dead, "il rate : mort, et le dernier survivant gagne");
  ok(byId.get("btnNext").dataset.over === "1" && byId.get("scoreBody").innerHTML.includes("<b>Tu l'emportes</b>"),
     "la feuille de fin de partie s'ouvre et nomme le gagnant");
  onRollClick();
  ok(S.phase === "over", "la partie finie, plus rien ne répond");

  // Le dernier adversaire revient : la partie continue.
  setup({ hp: [25, -3, 25, 25], dead: [false, false, true, true], current: 1 });
  throwAs(1, [6, 6, 6, 4, 2]);
  seq.push(5);
  stopAs(1);
  await settle();
  ok(P(1).hp === 2 && !P(1).dead && S.phase === "roll" && S.current === 0, "le dernier adversaire se régénère à 2 : la partie continue");

  // Personne ne survit : l'agonisant emporte le dernier vivant, qui rate sa dernière chance.
  setup({ hp: [3, -2, 25, 25], dead: [false, false, true, true], current: 1 });
  throwAs(1, [1, 1, 1, 1, 1]);
  seq.push(6, 1, 1, 1, 1, 2, 2, 2, 2);
  stopAs(1);
  ok(S.phase === "attack" && S.target === 0, "l'attaque suicide du dernier adversaire part sur le dernier vivant");
  await settle();
  ok(P(1).dead && me().hp === -3 && S.phase === "roll" && S.current === 0, "attaque suicide : le vivant tombe à −3, l'agonisant meurt, le vivant joue sa dernière chance");
  roll([3, 3, 3, 4, 4]);
  onStopClick();
  await settle();
  ok(S.phase === "over" && S.winner === -1, "il rate : personne ne survit");
  ok(byId.get("scoreBody").innerHTML.includes("<b>Personne</b> ne survit"), "la feuille dit qu'il n'y a pas de gagnant");

  // Seul en jeu, à l'agonie : une attaque n'a plus de cible.
  setup({ hp: [-3, 0, 0, 0], dead: [false, true, true, true] });
  roll([1, 1, 1, 1, 1]);
  onStopClick();
  ok(S.phase === "attack" && S.target === -1, "seul en jeu, une attaque n'a personne à viser");
  await settle();
  ok(S.phase === "over" && S.winner === -1 && me().dead, "et l'agonisant meurt : pas de gagnant");
  setup({ hp: [-3, 0, 0, 0], dead: [false, true, true, true] });
  roll([6, 6, 6, 4, 2]);
  seq.push(4);
  onStopClick();
  await settle();
  ok(S.phase === "over" && S.winner === 0, "seul en jeu, à l'agonie, une régénération suffisante : il gagne");

  // Une fois mort, la partie continue sans toi.
  setup({ hp: [-1, 25, 25, 25] });
  roll([3, 3, 3, 2, 2]);
  onStopClick();
  await settle();
  ok(me().dead && S.phase === "roll" && S.current === 1 && !myTurn(), "mort, tu ne joues plus : la partie continue entre les autres");
  S.current = 3; S.phase = "idle"; ctx.beginTurn();
  throwAs(3, [3, 3, 3, 2, 2]);
  stopAs(3);
  await settle();
  ok(S.current === 1 && S.round === 2, "après le dernier siège, on saute le mort et l'on passe au tour de table suivant");

  const games0 = S.games;
  byId.get("btnNext").click();
  ok(S.phase !== "over" && S.players.every((p) => p.hp === 25 && !p.dead) && S.current === games0 % 4,
     "« Rejouer » : nouvelle partie, 25 PV pour tous, et le premier joueur change");
  byId.get("scoreOverlay").hidden = true;

  /* ------------------------------------------------------------ Politiques */
  let uid = 100000;
  const pose = (level, vals, st = {}) => {
    setup(st);
    Object.assign(S, { current: 1, phase: "keep", kept: (st.kept || []).map((v) => ({ uid: ++uid, v })), free: 5 - (st.kept || []).length });
    S.lastChance = S.players[1].hp < 0;
    S.dice = vals.map((v) => ({ uid: ++uid, v }));
    const k = g(`${level}Policy`).keep(S.players[1], 1).keep;
    return k && S.dice.filter((d) => k.includes(d.uid)).map((d) => d.v).sort().join(" ");
  };
  ok(pose("sharp", [1, 1, 1, 1, 1]) === null, "sharp : cinq 1, une attaque aux 6 : s'arrête");
  ok(pose("sharp", [6, 6, 6, 6, 6]) === null, "sharp : cinq 6, une attaque aux 6 : s'arrête");
  ok(pose("sharp", [1, 2, 3, 4, 1], { hp: [25, -3, 25, 25] }) === null, "sharp : à l'agonie, 11 tout juste — la régénération : s'arrête");
  ok(pose("sharp", [3, 3, 3, 4, 4]) !== null, "sharp : 17, un raté à −6 : relance");
  const k1 = pose("sharp", [1, 1, 6, 3, 4]);
  ok(k1 && !k1.includes("3") && !k1.includes("4"), `sharp : 1 1 6 3 4 — garde des 1 ou le 6, pas le 3 ni le 4 (${k1})`);
  const k6 = pose("sharp", [6, 6, 6, 6, 1]);
  ok(k6 && /^6( 6)*$/.test(k6), `sharp : 25, une attaque aux 1 — ne s'en contente pas : garde des 6 et relance le 1 (quatre 6 assurent 25 à 30) (${k6})`);
  ok(pose("sharp", [6, 6, 6, 4, 2], { hp: [25, 2, 25, 25] }) === null, "sharp : à 2 PV, 24 tout juste — la régénération : s'arrête");
  ok(pose("simple", [1, 1, 6, 3, 4]) === "1 1", "simple : garde ses 1");
  ok(pose("simple", [6, 6, 1, 2, 3]) === "6 6", "simple : plus de 6 que de 1, garde ses 6");
  ok(pose("simple", [1, 6, 2, 5, 3]) === "1", "simple : autant de 1 que de 6, de 2 que de 5, plus de 3 que de 4 : vise bas");
  ok(pose("simple", [2, 3, 4, 5, 5]) === "5", "simple : ni 1 ni 6, plus de 5 que de 2 : vise haut, garde son dé le plus haut");
  ok(pose("simple", [3, 4, 5], { kept: [6, 6] }) === "5", "simple : visant haut sans 6 au lancer, garde son dé le plus haut");
  ok(pose("simple", [2, 3], { kept: [1, 1, 1] }) === "2", "simple : ne s'arrête jamais, relance tant qu'il reste des dés");

  const target = (level, hp, v, dead) => {
    setup({ hp, dead });
    Object.assign(S, { current: 1, phase: "target", aim: { total: 11 - v, dice: [], kind: "attack", v } });
    return g(`${level}Policy`).target(S.players[1], 1, v);
  };
  ok(target("sharp", [25, 25, 3, 25], 4) === 2, "sharp : attaque aux 4, achève volontiers l'adversaire à 3 PV");
  ok(target("sharp", [25, 25, 25, 25], 2) === 2, "sharp : à égalité, le suivant dans l'ordre du jeu");
  ok(target("sharp", [25, 25, 25, 3], 4, [false, false, false, true]) !== 3, "sharp : ne vise jamais un mort");
  ok(target("simple", [12, 25, 18, -3], 2) === 0, "simple : le vivant le plus faible, pas l'agonisant");

  /* Une décision hors des règles est corrigée. */
  g("POLICIES").evil = { keep: () => ({ keep: S.dice.map((d) => d.uid) }), target: () => 1 };
  setup();
  Object.assign(S, { current: 1, phase: "keep", kept: [], free: 5 });
  S.dice = [1, 2, 3, 4, 5].map((v) => ({ uid: ++uid, v }));
  S.players[1].policy = "evil";
  ok(g("decide")(1) === null, "garder les cinq dés n'est pas une relance : la décision devient « s'arrêter »");
  Object.assign(S, { phase: "target", aim: { total: 9, dice: [], kind: "attack", v: 2 } });
  ok(g("chooseTarget")(1) !== 1, "s'attaquer soi-même est refusé : une autre cible est prise");
  delete g("POLICIES").evil;

  /* Un tour entier de l'ordinateur, aiTurn rétabli : il vise, attaque, conclut. */
  setup({ hp: [5, 25, 25, 25], dead: [false, false, true, true] });
  S.current = 1; S.phase = "idle";
  seq.push(1, 1, 1, 1, 1, 6, 6, 6, 1, 1, 2, 3);
  ctx.beginTurn();
  const turnAi = _aiTurn();
  ok(S.busy && !myTurn(), "pendant le tour de l'ordinateur, l'humain attend");
  await turnAi;
  for (let i = 0; i < 200 && S.current === 1; i++) await tick();
  ok(me().hp === -13 && S.current === 0 && S.lastChance, `l'ordinateur fait 5, attaque aux 6 le seul adversaire : trois 6, −18 (${me().hp})`);
  ok(byId.get("log").innerHTML.includes("Nora t'attaque aux 6"), "le journal le dit, en tutoyant la cible");

  ok(illegal.length === 0, `cas ciblés : rien d'irrégulier (${JSON.stringify(illegal[0] || "")})`);
  ok(impure === 0, "cas ciblés : aucune politique ne modifie la partie");
}

/* ------------------------------------------------------------------ Main */
(async () => {
  const t0 = Date.now();
  checkOrder = true;
  for (let i = 0; i < 24; i++) await playGame("sharp");
  for (let i = 0; i < 8; i++) await playGame("simple");
  await targetedTests();
  console.log("Couverture :", JSON.stringify(cov), `(${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  report("Killer");
})();
