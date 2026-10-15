/* 6 qui prend ! — règles du jeu, vérifiées en jouant des parties complètes.
 * Lancer : node tests/six-qui-prend.test.js
 *
 * Deux parties dans ce fichier :
 *   1. des parties complètes à 4 joueurs, sous invariants : conservation du
 *      paquet, ordre croissant des poses, rangée imposée, sixième carte et
 *      carte trop petite, dix tours par manche, points et fin à 66 têtes ;
 *   2. des cas ciblés, tours d'IA neutralisés et cartes posées à la main.
 */
"use strict";

const { loadSixQuiPrend, checker, globalClashes } = require("./harness");

const { g, S, byId, tick } = loadSixQuiPrend();
const { ok, okOnce, report } = checker();

/* Instrumentation : chaque révélation et chaque pose sont vérifiées à
   l'instant où elles ont lieu. */
g(`
  globalThis._illegal = []; globalThis._peeks = 0; globalThis._turns = [];
  globalThis._cov = { sixth: 0, low: 0, humanLow: 0 };

  const _reveal = reveal;
  reveal = function () {
    if (!S.chosen.every((c, i) => c && S.players[i].hand.includes(c))) _illegal.push({ reveal: "carte hors de la main" });
    if (new Set(S.players.map((p) => p.hand.length)).size !== 1) _illegal.push({ reveal: "mains inégales" });
    return _reveal();
  };

  const _placeCard = placeCard;
  placeCard = function (seat, card, row) {
    const q = S.queue[0];
    const target = targetRow(card);
    const r = target >= 0 ? target : row;
    if (!q || q.card !== card || q.seat !== seat || S.queue.some((x) => x.card.n < card.n)) {
      _illegal.push({ order: card.n, seat, queue: S.queue.map((x) => x.card.n) });
    }
    if (target >= 0 && row !== target) _illegal.push({ forced: card.n, row, target });
    if (!(r >= 0 && r < S.rows.length)) _illegal.push({ badRow: row });
    const before = S.rows[r].slice();
    const pile = S.players[seat].pile.length;
    const taken = _placeCard(seat, card, row);
    const shouldTake = target < 0 || before.length >= 5;
    if (shouldTake !== taken.length > 0 || (shouldTake && taken.length !== before.length)
        || S.players[seat].pile.length !== pile + taken.length) {
      _illegal.push({ take: card.n, before: before.map((c) => c.n), taken: taken.map((c) => c.n) });
    }
    const line = S.rows[r];
    if (line[line.length - 1] !== card) _illegal.push({ notEnd: card.n });
    if (!S.rows.every((l) => l.length >= 1 && l.length <= 5 && l.every((c, i) => !i || c.n > l[i - 1].n))) {
      _illegal.push({ rows: S.rows.map((l) => l.map((c) => c.n)) });
    }
    if (target < 0) { _cov.low++; if (seat === 0) _cov.humanLow++; }
    else if (before.length >= 5) _cov.sixth++;
    return taken;
  };

  const _endRound = endRound;
  endRound = function () { _turns.push(S.turn); return _endRound(); };
`);

/* Les politiques n'ont droit qu'à l'information publique : pendant chaque
   décision, les mains des autres et les cartes jamais distribuées deviennent
   des Proxy qui comptent tout accès par indice ou par itération (`length`
   reste libre) ; pendant le choix d'une carte, les choix des autres aussi. */
g(`
  const _policyOf = policyOf;
  policyOf = function (p) {
    const pol = _policyOf(p);
    const count = (arr) => new Proxy(arr, {
      get(t, prop) {
        if (typeof prop === "symbol" || /^[0-9]+$/.test(prop)) globalThis._peeks++;
        return Reflect.get(t, prop);
      },
    });
    const wrapped = {};
    for (const k of Object.keys(pol)) {
      wrapped[k] = (...args) => {
        const hands = S.players.map((q) => q.hand), out = S.out, chosen = S.chosen;
        for (const q of S.players) if (q !== p) q.hand = count(q.hand);
        S.out = count(out);
        if (k === "pick") S.chosen = count(chosen);
        try { return pol[k](...args); }
        finally { S.players.forEach((q, i) => { q.hand = hands[i]; }); S.out = out; S.chosen = chosen; }
      };
    }
    return wrapped;
  };
`);

const onCardClick = g("onCardClick");
const onPlayClick = g("onPlayClick");
const onRowClick = g("onRowClick");
const sumHeads = g("sumHeads");

const rnd = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rnd(a.length)];
const cov = { games: 0, rounds: 0, maxRounds: 0 };

/* ---------------------------------------------------- 1. Parties complètes */
function checkConservation(where) {
  const uids = new Set();
  let total = 0;
  const add = (c) => { uids.add(c.uid); total++; };
  S.players.forEach((p) => { p.hand.forEach(add); p.pile.forEach(add); });
  S.rows.forEach((l) => l.forEach(add));
  S.queue.forEach((q) => add(q.card));
  S.out.forEach(add);
  okOnce(total === 104 && uids.size === 104, `104 cartes distinctes à tout instant (${where} : ${total}/${uids.size})`);
  if (S.phase === "pick") {
    okOnce(S.chosen.every((c, i) => !c || S.players[i].hand.includes(c)), "une carte choisie reste en main jusqu'à la révélation");
  }
}

function humanAct() {
  const me = S.players[0];
  if (S.phase === "row") {
    okOnce(S.queue.length === S.players.length, "on choisit sa rangée en voyant toutes les cartes révélées");
    onCardClick(me.hand[0] ? me.hand[0].uid : -1);
    okOnce(S.phase === "row", "pendant le choix d'une rangée, les cartes de la main ne répondent pas");
    onRowClick(rnd(4));
    return;
  }
  onPlayClick();
  okOnce(!S.chosen[0], "on ne pose rien sans avoir choisi de carte");
  const card = Math.random() < 0.5 ? g("simplePolicy").pick(me) : pick(me.hand);
  onCardClick(card.uid);
  okOnce(S.sel === card.uid && !S.chosen[0], "un premier clic choisit la carte sans la poser");
  if (Math.random() < 0.5) onCardClick(card.uid);
  else onPlayClick();
  okOnce(S.chosen[0] === card || S.queue.some((q) => q.card === card), "un second clic, ou « Poser », pose la carte choisie");
}

/* Toujours 4 joueurs par l'écran de départ, adversaires « sharp ». La
   politique simple ne sert plus que de référence au banc d'essai : on la fait
   jouer aussi, pour qu'elle reste légale et honnête. Les adversaires n'ont pas
   encore consulté leur politique quand on la remplace. */
async function playGame(level) {
  byId.get("btnStart").click();
  okOnce(S.players.length === 4 && S.players.slice(1).every((p) => p.ai && p.policy === "sharp"),
         "l'écran de départ lance 4 joueurs, adversaires « sharp » (Redoutable)");
  if (level !== "sharp") S.players.slice(1).forEach((p) => { p.policy = level; });
  let guard = 0, rounds = 0;
  while (guard++ < 200000) {
    await tick();
    if (S.phase === "over") {
      rounds++;
      checkRound();
      if (byId.get("btnNext").dataset.over) {
        cov.games++;
        cov.maxRounds = Math.max(cov.maxRounds, rounds);
        return;
      }
      byId.get("btnNext").click();
      continue;
    }
    if ((S.phase === "pick" && !S.chosen[0] && !S.busy) || S.phase === "row") {
      checkConservation("décision humaine");
      humanAct();
    }
  }
  ok(false, "la partie se termine sans blocage (garde-fou atteint)");
}

function checkRound() {
  cov.rounds++;
  checkConservation("fin de manche");
  const illegal = g("globalThis._illegal");
  ok(illegal.length === 0, `toutes les poses ont suivi la règle : ordre croissant, rangée imposée, sixième carte, carte trop petite (${JSON.stringify(illegal[0] || "")})`);
  g("globalThis._illegal = []");
  okOnce(g("globalThis._turns").at(-1) === 10, "une manche dure 10 tours");
  okOnce(S.players.every((p) => p.hand.length === 0) && S.queue.length === 0, "en fin de manche, toutes les cartes ont été posées");
  okOnce(S.out.length === 60, "à 4 joueurs, 60 cartes restent hors jeu");
  okOnce(S.rows.length === 4 && S.rows.every((l) => l.length >= 1 && l.length <= 5), "toujours 4 rangées de 1 à 5 cartes");
  S.players.forEach((p) => {
    okOnce(p.last === sumHeads(p.pile), "chacun marque les têtes de bœuf qu'il a ramassées");
    okOnce(p.score === p.rounds.reduce((a, b) => a + b, 0), "cumul des points cohérent");
  });
  const heads = S.players.reduce((t, p) => t + sumHeads(p.pile), 0) + S.rows.flat().reduce((t, c) => t + c.heads, 0)
              + sumHeads(S.out);
  okOnce(heads === 171, "171 têtes de bœuf en tout");
  okOnce(S.players.some((p) => p.pile.length > 0), "chaque manche fait ramasser au moins une rangée");
  const over = S.players.some((p) => p.score >= 66);
  ok(!!byId.get("btnNext").dataset.over === over, "la partie s'arrête dès qu'un joueur atteint 66 têtes");
  ok(g("globalThis._peeks") === 0, "aucune IA ne lit une main, un choix secret ou les cartes hors jeu");
}

/* ============== 2. Cas ciblés — IA neutralisées, cartes posées à la main ============== */
async function targetedTests() {
  g("aiTurn = async function () {};");

  const clashes = globalClashes("six-qui-prend.html");
  ok(clashes.length === 0, `aucun nom de premier niveau ne masque une propriété de window (${clashes.join(", ")})`);

  /* ---------------------------------------------------------------- Paquet */
  const deck = g("buildDeck()");
  ok(deck.length === 104 && deck.every((c, i) => c.n === i + 1), "104 cartes, de 1 à 104");
  const h = (n) => deck[n - 1].heads;
  ok(h(55) === 7, "le 55 porte 7 têtes");
  ok([11, 22, 33, 44, 66, 77, 88, 99].every((n) => h(n) === 5), "les doubles portent 5 têtes");
  ok([10, 20, 30, 40, 50, 60, 70, 80, 90, 100].every((n) => h(n) === 3), "les dizaines portent 3 têtes");
  ok([5, 15, 25, 35, 45, 65, 75, 85, 95].every((n) => h(n) === 2), "les autres multiples de 5 portent 2 têtes");
  ok([1, 2, 12, 54, 56, 101, 104].every((n) => h(n) === 1), "les autres cartes, une tête");
  ok(sumHeads(deck) === 171, "171 têtes en tout");

  /* Table posée à la main : rangées et mains données par leurs nombres. Les
     adversaires ne choisissent rien d'eux-mêmes (aiTurn neutralisé) : on remplit
     S.chosen, puis on révèle. Ils restent `ai` pour choisir seuls une rangée. */
  const C = (n) => g("mkCard")(n);
  const table = (rows, hands) => {
    g("startGame")(hands.length);
    byId.get("scoreOverlay").hidden = true;
    S.players.forEach((p, i) => { p.hand = hands[i].map(C); p.pile = []; p.score = 0; p.rounds = []; });
    S.rows = rows.map((l) => l.map(C));
    S.seen = S.rows.flat();
    S.queue = []; S.placing = null; S.busy = false;
    S.chosen = S.players.map(() => null);
    S.phase = "pick"; S.turn = 1;
  };
  const card = (seat, n) => S.players[seat].hand.find((c) => c.n === n);
  const rowsN = () => S.rows.map((l) => l.map((c) => c.n).join(" ")).join(" | ");
  const settle = async () => { for (let i = 0; i < 500 && S.phase === "place"; i++) await tick(); };
  const turn = async (picks) => {
    picks.forEach((n, seat) => { if (seat > 0) S.chosen[seat] = card(seat, n); });
    onCardClick(card(0, picks[0]).uid);
    onPlayClick();
    await settle();
  };
  const targetRow = (n) => g("targetRow")({ n });

  /* ------------------------------------------------------- Où va une carte */
  table([[10], [20], [30], [40]], [[1], [2], [3], [4]]);
  ok(targetRow(25) === 1 && targetRow(21) === 1, "une carte va sur la rangée dont la fin est la plus proche en dessous");
  ok(targetRow(45) === 3 && targetRow(104) === 3, "au-dessus de tout : la rangée la plus haute");
  ok(targetRow(5) === -1, "plus petite que toutes les fins : pas de rangée imposée");
  table([[40], [10], [30], [20]], [[1], [2], [3], [4]]);
  ok(targetRow(25) === 3 && targetRow(35) === 2, "l'ordre des rangées à l'écran n'y fait rien");

  /* ------------------------------------------------- Un tour, dans l'ordre */
  table([[10], [20, 21, 23, 24], [30], [40]], [[26, 90], [25, 91], [35, 92], [60, 93]]);
  await turn([26, 25, 35, 60]);
  ok(S.players[1].pile.length === 0 && S.players[0].pile.map((c) => c.n).join() === "20,21,23,24,25",
     `les cartes se posent de la plus petite à la plus grande : le 25 fait la cinquième, le 26 la sixième et ramasse (${rowsN()})`);
  ok(S.rows[1].map((c) => c.n).join() === "26", "la sixième carte commence la rangée");
  ok(S.rows[0].map((c) => c.n).join() === "10" && S.rows[2].map((c) => c.n).join() === "30,35"
     && S.rows[3].map((c) => c.n).join() === "40,60", "les autres cartes vont au bout de leur rangée");
  ok(S.phase === "pick" && S.turn === 2 && S.players.every((p) => p.hand.length === 1), "puis le tour suivant commence");

  table([[10, 11, 12, 13, 14], [20], [30], [40]], [[15, 90], [16, 91], [17, 92], [18, 93]]);
  await turn([15, 16, 17, 18]);
  ok(sumHeads(S.players[0].pile) === 11 && S.rows[0].map((c) => c.n).join() === "15,16,17,18",
     `la sixième carte ramasse les cinq (3 + 5 + 1 + 1 + 1 = 11 têtes), les suivantes s'empilent derrière (${rowsN()})`);

  /* -------------------------------------------- Carte trop petite : l'humain */
  table([[10], [22], [33, 34], [40]], [[5, 90], [36, 91], [41, 92], [23, 93]]);
  await turn([5, 36, 41, 23]);
  ok(S.phase === "row" && !S.busy && S.queue[0].card.n === 5, "carte trop petite : l'humain doit choisir sa rangée");
  ok(S.queue.length === 4, "il voit les cartes révélées des autres avant de choisir");
  onCardClick(card(0, 90).uid);
  ok(S.phase === "row" && S.sel === null, "sa main ne répond pas pendant ce choix");
  onRowClick(9);
  ok(S.phase === "row", "une rangée qui n'existe pas est refusée");
  onRowClick(2);
  await settle();
  ok(S.players[0].pile.map((c) => c.n).join() === "33,34" && S.rows[2][0].n === 5,
     `il ramasse la rangée choisie, même plus chère qu'une autre, et sa carte la remplace (${rowsN()})`);
  ok(S.rows[1].map((c) => c.n).join() === "22,23,36" && S.rows[2].map((c) => c.n).join() === "5"
     && S.rows[3].map((c) => c.n).join() === "40,41", `la pose reprend avec les cartes suivantes (${rowsN()})`);

  /* ------------------------------------- Carte trop petite : l'ordinateur */
  for (const level of ["simple", "sharp"]) {
    table([[10], [44], [55], [41, 42]], [[90, 91], [3, 92], [60, 93], [70, 94]]);
    S.players[1].policy = level;
    await turn([90, 3, 60, 70]);
    ok(S.players[1].pile.map((c) => c.n).join() === "41,42" && S.rows[3][0].n === 3,
       `${level} : sa carte trop petite ramasse la rangée la moins chère (${rowsN()})`);
  }

  /* À coût égal, la redoutable ramasse la rangée qui en fera ramasser aux
     autres : prendre la rangée de cinq cartes sauverait le 13 d'Elias. */
  const AI = g("AI");
  const spite = AI.spite;
  for (const s of [spite, 0]) {
    AI.spite = s;
    table([[6, 7, 8, 9, 12], [44], [55], [66]], [[90, 91], [3, 92], [13, 93], [95, 96]]);
    await turn([90, 3, 13, 95]);
    const tookFive = S.players[1].pile.length === 5;
    ok(s ? !tookFive && S.players[2].pile.length === 5 : tookFive,
       s ? `sharp : à coût égal, laisse la rangée de cinq cartes au 13 d'Elias (${rowsN()})`
         : "sharp sans malice (spite 0) : la première rangée la moins chère");
  }
  AI.spite = spite;

  /* ------------------------------------------------- Fin de manche et de partie */
  table([[10], [20], [30], [40, 41, 42, 43, 44]], [[45], [21], [31], [11]]);
  S.players.forEach((p, i) => { p.score = [60, 10, 20, 30][i]; });
  await turn([45, 21, 31, 11]);
  ok(S.phase === "over", "après le dernier tour, la manche se compte");
  ok(S.players[0].last === 11 && S.players[0].score === 71, `on ajoute les têtes ramassées au total (+${S.players[0].last})`);
  ok(byId.get("btnNext").dataset.over === "1" && byId.get("scoreTitle").textContent === "Fin de la partie",
     "66 têtes atteintes : la partie s'arrête");
  ok(byId.get("scoreBody").innerHTML.includes("<b>Nora</b> l'emporte"), "le plus petit total gagne");

  table([[10], [20], [30], [40]], [[11], [21], [31], [41]]);
  S.players.forEach((p, i) => { p.score = [12, 40, 12, 65][i]; });
  await turn([11, 21, 31, 41]);
  ok(S.phase === "over" && !byId.get("btnNext").dataset.over, "personne à 66 : la partie continue");
  byId.get("btnNext").click();
  ok(S.round === 2 && S.phase === "pick" && S.players.every((p) => p.hand.length === 10) && S.rows.every((l) => l.length === 1),
     "manche suivante : dix nouvelles cartes chacun, quatre nouvelles rangées");
  S.players.forEach((p, i) => { p.score = [30, 40, 30, 66][i]; });
  g("showScores(true)");
  ok(byId.get("scoreBody").innerHTML.includes("<b>Toi et Elias</b> l'emportent"), "égalité en tête : victoire partagée");
  byId.get("scoreOverlay").hidden = true;

  /* ------------------------------------------------------- Politiques */
  for (const level of ["simple", "sharp"]) {
    table([[10, 11, 12, 13, 14], [50], [60], [70]], [[1], [15, 52], [2], [3]]);
    const pol = g(`${level}Policy`);
    const c = pol.pick(S.players[1], 1);
    ok(c && c.n === 52, `${level} : ne pose pas une sixième carte certaine (le 15 ramasserait 11 têtes)`);
  }
  /* Le 50 se glisserait au plus près, mais en cinquième carte : six nombres
     (44 à 49) peuvent passer avant lui. Le 92, derrière une rangée d'une carte,
     ne ramasse jamais rien. */
  table([[40, 41, 42, 43], [80], [20], [30]], [[1], [50, 92], [2], [3]]);
  ok(g("simplePolicy").pick(S.players[1], 1).n === 50, "simple : joue au plus juste, le 50");
  const depth = AI.depth;
  AI.depth = 0;                        // ce tour seul : la suite de la manche jouerait l'autre carte
  ok(g("sharpPolicy").pick(S.players[1], 1).n === 92, "sharp : sent le danger de la cinquième place et joue le 92");
  AI.depth = depth;

  const illegal = g("globalThis._illegal");
  ok(illegal.length === 0, `cas ciblés : aucune pose irrégulière (${JSON.stringify(illegal[0] || "")})`);
}

/* ------------------------------------------------------------------ Main */
(async () => {
  const t0 = Date.now();
  // Les parties complètes vérifient la règle, pas la force de l'IA : 20 tirages
  // au lieu des 100 livrés divisent leur durée par cinq.
  const AI = g("AI");
  const shipped = { ...AI };
  AI.samples = 20;
  for (let i = 0; i < 12; i++) await playGame("sharp");
  for (let i = 0; i < 4; i++) await playGame("simple");
  Object.assign(AI, shipped);
  Object.assign(cov, g("globalThis._cov"));
  await targetedTests();
  console.log("Couverture :", JSON.stringify(cov), `(${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  report("6 qui prend");
})();
