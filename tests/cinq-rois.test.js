/* Les Cinq Rois — règles du jeu, vérifiées en jouant des parties complètes.
 * Lancer : node tests/cinq-rois.test.js
 *
 * Trois parties dans ce fichier :
 *   1. le moteur de combinaisons, confronté à une recherche brute sur toutes
 *      les partitions de mains tirées au hasard ;
 *   2. des parties complètes (11 manches) sous invariants : conservation du
 *      paquet, taille des donnes, dernier tour de chacun, décompte ;
 *   3. des cas ciblés et **synchrones**, tours d'IA neutralisés.
 */
"use strict";

const { loadCinqRois, checker, globalClashes } = require("./harness");

const { g, S, byId, tick } = loadCinqRois();
const { ok, okOnce, report } = checker();

/* Instrumentation. Les déclarations `function` de premier niveau sont sur
   l'objet global du contexte, donc remplaçables d'ici. */
g(`
  globalThis._reshuffles = 0; globalThis._peeks = 0;
  globalThis._turns = []; globalThis._deals = [];

  const _drawOne = drawOne;
  drawOne = function (p) {
    if (S.draw.length === 0 && S.discard.length > 1) globalThis._reshuffles++;
    return _drawOne(p);
  };

  const _endTurn = endTurn;
  endTurn = function () {
    globalThis._turns.push({ who: S.current, finisher: S.finisher });
    return _endTurn();
  };

  // Les tours d'IA attendent avant de piocher : juste après startRound(),
  // les mains sont encore celles de la donne.
  const _startRound = startRound;
  startRound = function () {
    globalThis._turns = [];
    _startRound();
    globalThis._deals.push({
      round: S.round, wildRank: S.wildRank,
      sizes: S.players.map((p) => p.hand.length),
      discard: S.discard.length, draw: S.draw.length,
    });
  };
`);

/* Les politiques n'ont droit qu'à l'information publique. Le temps d'une
   décision, les mains des *autres* joueurs et la pioche deviennent des Proxy
   qui comptent tout accès par indice ou par itération ; `length` reste libre. */
g(`
  const _policyOf = policyOf;
  policyOf = function (p) {
    const pol = _policyOf(p);
    const spy = (arr) => new Proxy(arr, {
      get(t, prop) {
        if (typeof prop === "symbol" || /^[0-9]+$/.test(prop)) globalThis._peeks++;
        return Reflect.get(t, prop);
      },
    });
    const wrapped = {};
    for (const k of Object.keys(pol)) {
      wrapped[k] = (...args) => {
        const hands = S.players.map((q) => q.hand);
        const draw = S.draw;
        for (const q of S.players) if (q !== p) q.hand = spy(q.hand);
        S.draw = spy(draw);
        try { return pol[k](...args); }
        finally { S.players.forEach((q, i) => { q.hand = hands[i]; }); S.draw = draw; }
      };
    }
    return wrapped;
  };
`);

const SUITS = g("SUITS");
const mkCard = g("mkCard");
const arrange = g("arrange");
const onDrawClick = g("onDrawClick");
const onDiscardPileClick = g("onDiscardPileClick");
const onHandClick = g("onHandClick");
const TURN_CAP = g("TURN_CAP");

const rnd = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rnd(a.length)];
const label = (c) => (c.rank === 0 ? "JK" : c.suit + c.rank);

/* ------------------------------------------- Référence indépendante du jeu */
const points = (c, wr) => (c.rank === 0 ? 50 : c.rank === wr ? 20 : c.rank);

function validMeld(cards, wr) {
  if (cards.length < 3) return false;
  const nat = cards.filter((c) => c.rank !== 0 && c.rank !== wr);
  if (nat.length === 0) return true;
  if (nat.every((c) => c.rank === nat[0].rank)) return true;               // brelan
  if (!nat.every((c) => c.suit === nat[0].suit)) return false;
  const ranks = nat.map((c) => c.rank).sort((a, b) => a - b);
  for (let i = 1; i < ranks.length; i++) if (ranks[i] === ranks[i - 1]) return false;
  // Suite : tient entre le 3 et le Roi, les jokers bouchant les trous.
  return cards.length <= 11 && ranks[ranks.length - 1] - ranks[0] + 1 <= cards.length;
}

/* Minimum sur toutes les partitions de la main : chaque bloc est une
   combinaison valide, ou compte ses points. */
function brute(hand, wr) {
  let best = Infinity;
  const blocks = [];
  const rec = (i) => {
    if (i === hand.length) {
      let c = 0;
      for (const b of blocks) if (!validMeld(b, wr)) c += b.reduce((n, x) => n + points(x, wr), 0);
      best = Math.min(best, c);
      return;
    }
    for (const b of blocks) { b.push(hand[i]); rec(i + 1); b.pop(); }
    blocks.push([hand[i]]); rec(i + 1); blocks.pop();
  };
  rec(0);
  return best;
}

/* Un arrangement renvoyé par le jeu est-il cohérent avec la main ? */
function checkArrangement(r, hand, wr, discard, where) {
  const all = [...r.melds.flatMap((m) => m.cards), ...r.dead, ...(r.discard ? [r.discard] : [])];
  okOnce(all.length === hand.length && new Set(all.map((c) => c.uid)).size === hand.length
         && all.every((c) => hand.includes(c)),
         `l'arrangement répartit exactement les cartes de la main (${where})`);
  okOnce(r.melds.every((m) => validMeld(m.cards, wr)), `toutes les combinaisons sont valides (${where})`);
  okOnce(r.dead.reduce((n, c) => n + points(c, wr), 0) === r.cost,
         `le coût est la somme des cartes isolées (${where})`);
  okOnce(discard ? !!r.discard : r.discard === null, `une défausse si et seulement si demandée (${where})`);
}

/* ------------------------------------------------------------ 1. Moteur */
function engineTests() {
  const hand = (wr, ...specs) => specs.map((s) => (s === "JK" ? mkCard(null, 0) : mkCard(s[0], Number(s.slice(1)))));
  const cost = (wr, discard, ...specs) => {
    const h = hand(wr, ...specs);
    const r = arrange(h, discard, wr);
    checkArrangement(r, h, wr, discard, "cas ciblé");
    return r.cost;
  };

  ok(cost(9, false, "E5", "C5", "K5") === 0, "brelan de trois couleurs différentes");
  ok(cost(9, false, "E5", "E5", "C5", "T5", "P5") === 0, "un brelan n'a pas de taille maximale, doublons compris");
  ok(cost(9, false, "T4", "T5", "T6", "T7") === 0, "suite de quatre dans une couleur");
  ok(cost(9, false, "T4", "C5", "T6") === 15, "une suite exige une seule couleur");
  ok(cost(9, false, "T4", "T4", "T5") === 13, "une suite n'accepte pas deux fois la même valeur");
  ok(cost(9, false, "P12", "P13", "P3") === 28, "une suite ne boucle pas du Roi au 3");
  ok(cost(9, false, "T4", "JK", "T6") === 0, "un joker bouche le trou d'une suite");
  ok(cost(9, false, "P12", "P13", "JK") === 0, "un joker complète une suite sous la Dame");
  ok(cost(5, false, "K4", "K5", "K6") === 0, "le joker de la manche tient sa propre place dans une suite");
  ok(cost(5, false, "K4", "C5", "K6") === 0, "…quelle que soit sa couleur");
  ok(cost(9, false, "E3", "E4", "E5", "JK") === 0, "un joker en trop est absorbé par une combinaison");
  ok(cost(9, false, "JK", "JK") === 100, "deux jokers seuls comptent 50 chacun");
  ok(cost(9, false, "JK", "JK", "P9") === 0, "trois jokers forment une combinaison");
  ok(cost(9, false, "C9", "E4") === 24, "joker de la manche isolé : 20 points");
  ok(cost(9, false, "E11", "C12", "T13") === 36, "Valet 11, Dame 12, Roi 13");
  ok(cost(9, true, "E3", "E4", "E5", "E6") === 0, "sortir : défausser l'extrémité d'une suite de quatre");
  ok(cost(9, true, "E3", "E4", "E5") === 7, "la défausse est obligatoire, même si elle casse une combinaison");
  ok(cost(9, true, "E3", "C8", "JK") === 11,
     "sans combinaison possible, on défausse le joker, la carte la plus chère");

  // Le 5 de trèfle ne peut servir qu'une fois : au brelan (reste 3 + 4 = 7)
  // plutôt qu'à la suite (reste 5 + 5 = 10).
  ok(cost(9, false, "T3", "T4", "T5", "E5", "C5") === 7, "le moteur arbitre entre brelan et suite");

  let checks = 0, fails = 0;
  for (let it = 0; it < 700; it++) {
    const wr = 3 + rnd(11);
    const n = 3 + rnd(6);
    const suits = SUITS.slice(0, 1 + rnd(3));
    const lo = 3 + rnd(8);
    const h = [];
    for (let i = 0; i < n; i++) {
      h.push(Math.random() < 0.15 ? mkCard(null, 0) : mkCard(pick(suits), Math.min(13, lo + rnd(5))));
    }
    const discard = Math.random() < 0.5;
    const r = arrange(h, discard, wr);
    const expect = discard
      ? Math.min(...h.map((_, i) => brute(h.filter((_, j) => j !== i), wr)))
      : brute(h, wr);
    checkArrangement(r, h, wr, discard, "main aléatoire");
    checks++;
    if (r.cost !== expect) {
      fails++;
      if (fails <= 3) console.error(`  ${h.map(label).join(" ")} joker ${wr} défausse ${discard} : ${r.cost} au lieu de ${expect}`);
    }
  }
  ok(fails === 0, `le moteur trouve l'optimum de la recherche brute (${fails} écarts sur ${checks} mains)`);
}

/* ---------------------------------------------------- 2. Parties complètes */
const refCount = new Map();
const sig = (c) => (c.rank === 0 ? "JK" : c.suit + c.rank);
for (const c of g("buildDeck()")) refCount.set(sig(c), (refCount.get(sig(c)) || 0) + 1);

function checkConservation(where) {
  const n = new Map();
  const uids = new Set();
  let total = 0, dup = 0;
  const add = (x) => {
    n.set(sig(x), (n.get(sig(x)) || 0) + 1);
    if (uids.has(x.uid)) dup++;
    uids.add(x.uid);
    total++;
  };
  S.draw.forEach(add);
  S.discard.forEach(add);
  for (const p of S.players) p.hand.forEach(add);
  okOnce(total === 116, `116 cartes en jeu à tout instant (${where} : ${total})`);
  okOnce(dup === 0, `aucune carte dupliquée (${where})`);
  for (const [k, v] of refCount) okOnce(n.get(k) === v, `multiset préservé pour ${k} (${where})`);
}

const cov = { games: 0, rounds: 0, humanOut: 0, aiOut: 0, tookDiscard: 0, reshuffles: 0 };
let invalidChecked = false;

/* Le siège humain joue tantôt au mieux, tantôt au hasard : le hasard couvre
   les défausses absurdes, le jeu au mieux lui permet de sortir. */
function humanAct() {
  const me = S.players[0];
  const smart = Math.random() < 0.6;
  const simple = g("simplePolicy");

  if (S.phase === "draw") {
    okOnce(S.players.every((p) => p.hand.length === S.wildRank),
           "au début d'un tour, chaque main compte autant de cartes que la donne");
    if (!invalidChecked) {
      const before = me.hand.length;
      onHandClick(me.hand[0].uid);
      ok(me.hand.length === before && S.phase === "draw", "on ne défausse pas avant d'avoir pris une carte");
    }
    const take = smart ? simple.takeDiscard(me, g("topCard()")) : Math.random() < 0.3;
    if (take) { cov.tookDiscard++; onDiscardPileClick(); } else onDrawClick();
    okOnce(S.phase === "discard" && me.hand.length === S.wildRank + 1, "prendre une carte ouvre la défausse");
  } else if (S.phase === "discard") {
    if (!invalidChecked) {
      const before = me.hand.length;
      onDrawClick();
      onDiscardPileClick();
      ok(me.hand.length === before && S.phase === "discard", "on ne prend qu'une carte par tour");
      invalidChecked = true;
    }
    const card = smart ? simple.discard(me) : pick(me.hand);
    const top = card.uid;
    onHandClick(top);
    okOnce(g("topCard()").uid === top || S.phase === "over" || S.current !== 0,
           "la carte cliquée part sur la défausse");
  }
}

async function playGame(n, level) {
  g(`chosenPlayers = ${n}; chosenLevel = ${JSON.stringify(level)};`);
  byId.get("btnStart").click();
  let guard = 0;
  while (guard++ < 400000) {
    await tick();
    if (S.phase === "over") {
      checkRound(n);
      if (byId.get("btnNext").dataset.over) { cov.games++; return; }
      byId.get("btnNext").click();
      continue;
    }
    if (S.busy || S.current !== 0) continue;
    checkConservation("tour humain");
    okOnce(S.wildRank === S.round + 2, "le joker de la manche est la valeur égale au nombre de cartes");
    humanAct();
  }
  ok(false, "la partie se termine sans blocage (garde-fou atteint)");
}

function checkRound(n) {
  cov.rounds++;
  const fin = S.finisher;
  ok(S.roundTurns < TURN_CAP, `la manche se termine avant le garde-fou (${S.roundTurns} tours)`);
  ok(fin !== null, "chaque manche se termine parce qu'un joueur sort");
  if (fin === null) return;
  if (fin === 0) cov.humanOut++; else cov.aiOut++;

  // Après la sortie : exactement un dernier tour pour chacun des autres, dans l'ordre.
  const after = g("globalThis._turns").filter((t) => t.finisher !== null);
  const expected = [...Array(n).keys()].map((k) => (fin + k) % n);
  ok(after.map((t) => t.who).join() === expected.join(),
     `après la sortie, chaque autre joueur joue un seul dernier tour (${after.map((t) => t.who).join()} / ${expected.join()})`);

  S.players.forEach((p, i) => {
    checkArrangement(p.result, p.hand, S.wildRank, false, "fin de manche");
    okOnce(p.hand.length === S.wildRank, "chacun finit la manche avec autant de cartes que la donne");
    const last = p.rounds[p.rounds.length - 1];
    ok(last === p.result.cost, `${p.name} marque les points de ses cartes isolées`);
    ok(p.score === p.rounds.reduce((a, b) => a + b, 0), `cumul cohérent pour ${p.name}`);
  });
  ok(S.players[fin].rounds[S.players[fin].rounds.length - 1] === 0, "qui sort marque 0");

  const deal = g("globalThis._deals").at(-1);
  ok(deal.round === S.round && deal.wildRank === S.round + 2
     && deal.sizes.every((s) => s === S.round + 2)
     && deal.discard === 1 && deal.draw === 116 - n * (S.round + 2) - 1,
     `donne de la manche ${S.round} : ${S.round + 2} cartes chacun, une carte retournée`);

  ok(!!byId.get("btnNext").dataset.over === (S.round === 11), "la partie dure exactement onze manches");
  ok(g("globalThis._peeks") === 0, "aucune IA ne lit la main d'un autre joueur ni la pioche");
}

/* ============== 3. Cas ciblés — synchrones, IA neutralisées ============== */
function targetedTests() {
  g("aiTurn = async function () {};");

  const clashes = globalClashes("cinq-rois.html");
  ok(clashes.length === 0, `aucun nom de premier niveau ne masque une propriété de window (${clashes.join(", ")})`);

  /* ------------------------------------------------------------- Paquet */
  const deck = g("buildDeck()");
  ok(deck.length === 116, `le paquet compte 116 cartes (${deck.length})`);
  const counts = new Map();
  for (const c of deck) counts.set(sig(c), (counts.get(sig(c)) || 0) + 1);
  ok(SUITS.every((s) => [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].every((r) => counts.get(s + r) === 2)),
     "cinq couleurs, du 3 au Roi, chaque carte en deux exemplaires");
  ok(counts.get("JK") === 6, "six jokers");

  /* Table posée à la main, tous les sièges humains : le moteur résout alors
     chaque tour de façon synchrone. */
  const C = (s) => (s === "JK" ? mkCard(null, 0) : mkCard(s[0], Number(s.slice(1))));
  const table = (n, round) => {
    g(`chosenPlayers = ${n}`);
    byId.get("btnStart").click();
    S.round = round;
    S.wildRank = round + 2;
    for (const p of S.players) { p.ai = false; p.pub = { took: new Map() }; }
    S.busy = false; S.finisher = null; S.roundTurns = 0; S.taken = null;
    S.current = 0; S.phase = "draw";
    S.discard = [C("T13")];
    S.draw = [];
    for (let i = 0; i < 30; i++) S.draw.push(C("P11"));
  };

  /* ------------------------------------------------ Sortie et dernier tour */
  const find = (p, spec) => S.players[p].hand.find((c) => sig(c) === spec);
  // Les clics ne pilotent que le siège 0 : les autres jouent par le moteur.
  const turn = (i, source, spec) => {
    ok(S.current === i && S.phase === "draw", `c'est bien au joueur ${i} de jouer`);
    const p = S.players[i];
    if (source === "discard") g("takeDiscard")(p); else g("drawOne")(p);
    g("discardCard")(p, find(i, spec));
    g("afterDiscard")();
  };

  table(3, 1);                                        // 3 cartes, les 3 sont jokers
  S.players[0].hand = ["E5", "E6", "C10"].map(C);
  S.players[1].hand = ["T4", "T5", "T9"].map(C);
  S.players[2].hand = ["K8", "K9", "P12"].map(C);
  S.draw.push(C("E7"));
  onDrawClick();
  ok(S.phase === "discard" && S.players[0].hand.length === 4 && !!find(0, "E7"),
     "piocher ajoute à la main la carte du dessus de la pioche");
  onHandClick(find(0, "C10").uid);
  ok(S.finisher === 0, "une défausse qui laisse une main entièrement combinée fait sortir");
  ok(S.current === 1 && S.phase === "draw", "le joueur suivant joue alors son dernier tour");

  S.draw.push(C("T6"));
  turn(1, "draw", "T9");
  ok(S.finisher === 0 && S.current === 2, "sortir pendant son dernier tour ne change pas qui est sorti");

  g("takeDiscard")(S.players[2]);
  ok(!!find(2, "T9"), "prendre la défausse donne sa carte du dessus");
  ok(S.players[2].pub.took.size === 1, "la carte prise sur la défausse devient une information publique");
  g("discardCard")(S.players[2], find(2, "P12"));
  g("afterDiscard")();
  ok(S.phase === "over", "la manche s'arrête quand le tour revient à qui est sorti");
  ok(S.players.map((p) => p.rounds.at(-1)).join() === "0,0,26",
     `décompte : sorti 0, suite complétée 0, 8-9 de carreau et 9 de trèfle 26 (${S.players.map((p) => p.rounds.at(-1)).join()})`);
  byId.get("scoreOverlay").hidden = true;

  /* -------------------------------------------------- Joker de la manche */
  table(2, 3);                                        // 5 cartes, les 5 sont jokers
  S.players[0].hand = ["E3", "E4", "C5", "T8", "C8"].map(C);
  S.draw.push(C("K8"));
  onDrawClick();
  onHandClick(find(0, "K8").uid);
  ok(S.finisher === null && S.current === 1, "3-4 + joker et une paire de 8 : pas de sortie");

  S.current = 0; S.phase = "draw";
  S.players[0].hand = ["E3", "E4", "C5", "T8", "C8"].map(C);
  S.draw.push(C("K8"));
  onDrawClick();
  ok(arrange(S.players[0].hand, true, 5).cost > 0, "…aucune défausse ne laisse la main entière combinée");
  onHandClick(find(0, "E3").uid);
  ok(S.finisher === null,
     "tout combiné à six cartes (3-4-joker, 8-8-8), la défausse obligatoire empêche de sortir");

  S.current = 0; S.phase = "draw";
  S.players[0].hand = ["T8", "C8", "E8", "P12", "C5"].map(C);
  S.players[1].hand = ["P3", "K6", "T9", "C11", "K5"].map(C);
  S.draw.push(C("K8"));
  onDrawClick();
  onHandClick(find(0, "P12").uid);
  ok(S.finisher === 0, "le 5 de cœur, joker de la manche, complète un brelan de 8 : sortie");

  S.draw.push(C("P11"));
  turn(1, "draw", "T9");
  ok(S.phase === "over", "à deux joueurs, un seul dernier tour");
  ok(S.players[1].rounds.at(-1) === 9,
     `au dernier tour, le joker de la manche fait un brelan de Valets : restent 3 et 6 (${S.players[1].rounds.at(-1)})`);
  byId.get("scoreOverlay").hidden = true;

  /* ------------------------------------------------------ Clics hors tour */
  table(2, 2);
  S.players[0].hand = ["E3", "C7", "T9", "K12"].map(C);
  S.busy = true;
  onDrawClick();
  onDiscardPileClick();
  ok(S.players[0].hand.length === 4 && S.phase === "draw", "aucun clic n'agit pendant le tour d'une IA");
  S.busy = false;
  S.current = 1;
  const sizes = S.players.map((p) => p.hand.length).join();
  onDrawClick();
  onDiscardPileClick();
  ok(S.players.map((p) => p.hand.length).join() === sizes, "on ne joue pas à la place d'un autre");

  /* --------------------------------------------------------- Garde-fou */
  table(2, 2);
  S.players[0].hand = ["E3", "C7", "T9", "K12"].map(C);
  S.roundTurns = TURN_CAP - 1;
  onDrawClick();
  onHandClick(find(0, "K12").uid);
  ok(S.phase === "over" && S.finisher === null, "au garde-fou, la manche est comptée en l'état");
  byId.get("scoreOverlay").hidden = true;

  /* ------------------------------------------------------------ Remélange */
  table(2, 2);
  const a = C("E3"), b = C("E4"), c = C("E6"), d = C("E7");
  S.draw = [];
  S.discard = [a, b, c, d];
  const got = g("drawOne")(S.players[0]);
  ok(S.discard.length === 1 && S.discard[0] === d, "remélange : la défausse ne garde que sa carte du dessus");
  ok(S.draw.length === 2 && [...S.draw, got].map((x) => x.uid).sort().join() === [a, b, c].map((x) => x.uid).sort().join(),
     "remélange : les autres cartes repartent dans la pioche, aucune perdue");
  S.draw = [];
  S.discard = [d];
  ok(g("drawOne")(S.players[0]) === null, "rien à remélanger : drawOne() renvoie null");

  /* ------------------------------------------------- Politiques d'IA */
  for (const level of ["simple", "sharp"]) {
    const pol = g(`${level}Policy`);
    table(3, 1);
    S.players.forEach((p) => { p.ai = true; p.policy = level; });
    S.current = 1;
    const p = S.players[1];
    p.hand = ["P8", "C10", "E9"].map(C);
    ok(!pol.takeDiscard(p, C("JK")),
       `${level} : pas de joker pris sur la défausse sans combinaison où le placer (sinon trois IA se le repassent)`);
    p.hand = ["E5", "E6", "P12"].map(C);
    ok(pol.takeDiscard(p, C("E7")), `${level} : prend la carte qui fait sortir`);
    p.hand = ["E5", "E6", "E7", "P12"].map(C);
    ok(sig(pol.discard(p)) === "P12", `${level} : défausse la carte isolée pour sortir`);
    p.hand = ["E5", "E6", "C13", "T4"].map(C);
    ok(p.hand.includes(pol.discard(p)), `${level} : défausse une carte de sa main`);
  }

  /* ------------------------------------------- Manches et fin de partie */
  table(3, 1);
  S.players.forEach((p) => { p.ai = false; });
  g("endRound()");
  ok(byId.get("btnNext").dataset.over === "", "après la manche 1, la partie continue");
  byId.get("btnNext").click();
  ok(S.round === 2 && S.wildRank === 4 && S.players.every((p) => p.hand.length === 4),
     "la manche suivante distribue une carte de plus, et les 4 deviennent jokers");
  S.round = 11;
  S.wildRank = 13;
  g("endRound()");
  ok(byId.get("btnNext").dataset.over === "1", "la onzième manche termine la partie");
  byId.get("btnNext").click();
  ok(S.round === 1 && S.players.every((p) => p.score === 0 && p.rounds.length === 0),
     "rejouer remet les scores à zéro et repart de la manche 1");
}


/* ------------------------------------------------------------------ Main */
(async () => {
  const t0 = Date.now();
  engineTests();
  for (const [n, level] of [[2, "sharp"], [3, "simple"], [4, "sharp"], [2, "simple"], [3, "sharp"], [4, "simple"]]) {
    await playGame(n, level);
  }
  targetedTests();
  cov.reshuffles = g("globalThis._reshuffles");
  console.log("Couverture :", JSON.stringify(cov), `(${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  report("Les Cinq Rois");
})();
