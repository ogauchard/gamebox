/* Rikiki — règles du jeu, vérifiées en jouant des parties complètes.
 * Lancer : node tests/rikiki.test.js
 *
 * Deux parties dans ce fichier :
 *   1. des parties complètes de 25 manches à 4 joueurs, sous invariants :
 *      conservation du paquet, ordre et légalité de chaque annonce et de chaque
 *      carte, règle du donneur, gagnant de chaque pli, donne, atout, points ;
 *   2. des cas ciblés et **synchrones**, tours d'IA neutralisés.
 */
"use strict";

const { loadRikiki, checker, globalClashes } = require("./harness");

const { g, S, byId, tick } = loadRikiki();
const { ok, okOnce, report } = checker();

// Les parties vérifient les règles, pas la force de l'IA : moins de tirages.
g("AI.samples = 25");

/* Gagnant d'un pli, calculé autrement que par le jeu : le plus fort atout s'il
   y en a, sinon la plus forte carte de la couleur demandée. */
const refWinner = (trick, trump) => {
  const trumps = trick.filter((t) => t.card.suit === trump);
  const pool = trumps.length ? trumps : trick.filter((t) => t.card.suit === trick[0].card.suit);
  return pool.reduce((a, b) => (b.card.rank > a.card.rank ? b : a)).seat;
};
const refScore = (bid, tricks) => (bid === tricks ? 10 + tricks : -Math.abs(bid - tricks));

/* Instrumentation : chaque annonce, chaque carte, chaque pli et chaque donne
   est vérifié à l'instant où il a lieu. */
g(`
  globalThis._illegal = []; globalThis._badTricks = []; globalThis._deals = []; globalThis._peeks = 0;
  globalThis._cov = { forbidden: 0, cuts: 0, discards: 0, front: 0, noTrump: 0, humanDeals: 0 };

  const _doBid = doBid;
  doBid = function (seat, k) {
    const n = S.players.length;
    const made = S.players.filter((p) => p.bid !== null).length;
    // Les annonces partent du voisin du donneur, une par siège, dans l'ordre.
    if (seat !== S.current || !bidding() || S.players[seat].bid !== null || !canBid(seat, k)
        || made !== (seat - S.dealer - 1 + 2 * n) % n) {
      globalThis._illegal.push({ bid: seat, k, current: S.current, dealer: S.dealer, made });
    }
    if (seat === S.dealer && forbiddenBid(seat) !== null) globalThis._cov.forbidden++;
    return _doBid(seat, k);
  };

  const _doPlay = doPlay;
  doPlay = function (seat, card) {
    const n = S.players.length, hand = S.players[seat].hand;
    const lead = S.trick.length ? (S.trick.at(-1).seat + 1) % n
      : S.history.length ? S.history.at(-1).winner : (S.dealer + 1) % n;
    const led = S.trick.length ? S.trick[0].card.suit : -1;
    const follows = led < 0 || card.suit === led || !hand.some((c) => c.suit === led);
    if (seat !== S.current || seat !== lead || bidding() || !hand.includes(card) || !follows) {
      globalThis._illegal.push({ play: seat, card: cardLabel(card), current: S.current, lead, led });
    }
    if (led >= 0 && card.suit !== led) globalThis._cov[card.suit === S.trump ? "cuts" : "discards"]++;
    return _doPlay(seat, card);
  };

  const _endTrick = endTrick;
  endTrick = function () {
    globalThis._lastTrick = { cards: S.trick.slice(), trump: S.trump, winner: trickWinner(S.trick) };
    if (S.trick.length !== S.players.length || new Set(S.trick.map((t) => t.seat)).size !== S.players.length) {
      globalThis._badTricks.push({ size: S.trick.length });
    }
    globalThis._checkTrick(globalThis._lastTrick);
    return _endTrick();
  };

  const _startRound = startRound;
  startRound = function () {
    _startRound();
    globalThis._deals.push({ round: S.round, size: S.size, dealer: S.dealer, firstDealer: S.firstDealer,
      sizes: S.players.map((p) => p.hand.length), turned: S.turned, trump: S.trump, out: S.out.length,
      current: S.current, n: S.players.length });
    if (S.size === 1) globalThis._cov.front++;
    if (S.trump < 0) globalThis._cov.noTrump++;
    if (S.dealer === 0) globalThis._cov.humanDeals++;
  };
`);
const ctx = g("globalThis");
let trickChecks = 0, trickErrors = [];
ctx._checkTrick = (t) => {
  trickChecks++;
  const ref = refWinner(t.cards, t.trump);
  if (ref !== t.winner) trickErrors.push(t.cards.map((x) => `${x.seat}:${g("cardLabel")(x.card)}`).join(" "));
};

/* Les politiques n'ont droit qu'à l'information publique. Hors du front,
   pendant chaque décision, les mains des autres et les cartes jamais
   distribuées deviennent des Proxy qui comptent tout accès par indice ou par
   itération (`length` reste libre). Au front, c'est la main du joueur
   lui-même qui est cachée : il ne voit pas sa carte. */
g(`
  const _policyOf = policyOf;
  const spy = (a) => new Proxy(a, {
    get(t, prop) {
      if (typeof prop === "symbol" || /^[0-9]+$/.test(prop)) globalThis._peeks++;
      return Reflect.get(t, prop);
    },
  });
  policyOf = function (p) {
    const pol = _policyOf(p);
    const wrapped = {};
    for (const k of Object.keys(pol)) {
      wrapped[k] = (...args) => {
        const saved = S.players.map((q) => q.hand), out = S.out;
        const front = fronton();
        for (const q of S.players) if (front ? q === p : q !== p) q.hand = spy(q.hand);
        S.out = spy(S.out);
        try { return pol[k](...args); }
        finally { S.players.forEach((q, i) => { q.hand = saved[i]; }); S.out = out; }
      };
    }
    return wrapped;
  };
`);

const canPlay = g("canPlay");
const canBid = g("canBid");
const legalBids = g("legalBids");
const legalCards = g("legalCards");
const onBidClick = g("onBidClick");
const onAnnounceClick = g("onAnnounceClick");
const onCardClick = g("onCardClick");
const onPlayClick = g("onPlayClick");
const fronton = g("fronton");

const rnd = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rnd(a.length)];
const cov = { games: 0, rounds: 0, humanBids: 0, humanCards: 0, exact: 0 };

/* ---------------------------------------------------- 1. Parties complètes */
function checkConservation(where) {
  const uids = new Set();
  let total = 0;
  const add = (c) => { uids.add(c.uid); total++; };
  S.players.forEach((p) => p.hand.forEach(add));
  S.trick.forEach((t) => add(t.card));
  S.history.forEach((h) => h.cards.forEach((t) => add(t.card)));
  if (S.turned) add(S.turned);
  S.out.forEach(add);
  okOnce(total === 52 && uids.size === 52, `52 cartes distinctes à tout instant (${where} : ${total}/${uids.size})`);
}

function humanAct() {
  const me = S.players[0];
  if (S.phase === "bid") {
    cov.humanBids++;
    const f = g("forbiddenBid(0)");
    if (f !== null) {
      onBidClick(f); onBidClick(f);
      okOnce(me.bid === null && S.bidSel !== f, "le donneur ne peut pas annoncer le nombre qui ferait tomber le total juste");
    }
    onAnnounceClick();
    okOnce(me.bid === null, "on n'annonce rien sans avoir choisi un nombre");
    const k = Math.random() < 0.5 ? g("simplePolicy").bid(me, 0) : pick(legalBids(0));
    onBidClick(k);
    if (Math.random() < 0.5) onBidClick(k); else onAnnounceClick();
    return;
  }
  if (S.phase !== "play") return;
  okOnce(!fronton(), "au front, tu ne choisis jamais ta carte : elle tombe seule");
  cov.humanCards++;
  const legal = legalCards(0);
  okOnce(legal.length > 0 && legal.every((c) => canPlay(0, c)), "legalCards ne propose que des cartes jouables");
  const bad = me.hand.find((c) => !canPlay(0, c));
  if (bad) {
    const before = me.hand.length;
    onCardClick(bad.uid); onPlayClick();
    okOnce(me.hand.length === before && S.sel === null, "une carte qui ne fournit pas alors qu'on a la couleur est refusée");
  }
  const card = Math.random() < 0.5 ? g("simplePolicy").play(me, 0) : pick(legal);
  onCardClick(card.uid);
  if (Math.random() < 0.5) onCardClick(card.uid); else onPlayClick();
}

/* Toujours 4 joueurs par l'écran de départ, adversaires « sharp », 25 manches.
   La politique simple ne sert plus que de référence au banc d'essai : on la
   fait jouer aussi, pour qu'elle reste légale et honnête. Le premier tour d'IA
   n'a pas encore consulté sa politique quand on la remplace. */
async function playGame(level) {
  ctx._deals = [];
  byId.get("btnStart").click();
  okOnce(S.players.length === 4 && S.players.slice(1).every((p) => p.ai && p.policy === "sharp"),
         "l'écran de départ lance 4 joueurs, adversaires « sharp » (Redoutable)");
  if (level !== "sharp") S.players.slice(1).forEach((p) => { p.policy = level; });
  let guard = 0;
  while (guard++ < 400000) {
    await tick();
    if (S.phase === "over") {
      for (let i = 0; i < 3; i++) await tick();   // la feuille attend END_MS
      checkRound();
      if (byId.get("btnNext").dataset.over) { checkGame(); cov.games++; return; }
      byId.get("btnNext").click();
      continue;
    }
    if (S.busy || S.current !== 0) continue;
    if (S.phase === "bid" || S.phase === "play") {
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
  ok(illegal.length === 0, `toutes les annonces et toutes les cartes étaient légales, dans l'ordre, au bon joueur (${JSON.stringify(illegal[0] || "")})`);
  ctx._illegal = [];
  ok(g("globalThis._badTricks").length === 0, "chaque pli compte une carte de chaque joueur");
  ok(trickErrors.length === 0, `chaque pli va au plus fort atout, ou à la plus forte carte de la couleur demandée (${trickErrors[0] || ""})`);
  trickErrors = [];

  const n = S.players.length;
  const d = ctx._deals.at(-1);
  const deals = g("dealsFor")(n);
  ok(d.round === S.round && d.size === deals[S.round - 1] && d.sizes.every((s) => s === d.size),
     `manche ${S.round} : ${deals[S.round - 1]} cartes chacun (${d.sizes.join(",")})`);
  ok(d.dealer === (d.firstDealer + S.round - 1) % n && d.current === (d.dealer + 1) % n,
     "le donneur tourne à chaque manche ; son voisin annonce le premier");
  if (d.size * n < 52) {
    ok(!!d.turned && d.trump === d.turned.suit && d.out === 52 - d.size * n - 1, "la carte retournée donne l'atout");
  } else {
    ok(d.turned === null && d.trump === -1 && d.out === 0, "tout est distribué : sans atout");
  }

  const bids = S.players.map((p) => p.bid);
  const total = bids.reduce((a, b) => a + b, 0);
  ok(total !== d.size, `le total des annonces ne tombe jamais juste (${bids.join("+")} pour ${d.size})`);
  ok(S.players.reduce((a, p) => a + p.tricks, 0) === d.size, "autant de plis que de cartes en main");
  ok(S.history.length === d.size, "un pli par carte");
  ok(S.history.every((h, i) => (i ? h.cards[0].seat === S.history[i - 1].winner : h.cards[0].seat === (d.dealer + 1) % n)),
     "le voisin du donneur entame le premier pli, le gagnant de chaque pli le suivant");
  S.players.forEach((p) => {
    const r = p.rounds.at(-1);
    okOnce(r.bid === p.bid && r.tricks === p.tricks && r.gain === refScore(p.bid, p.tricks) && p.gain === r.gain,
           "contrat réussi : 10 + 1 par pli ; raté : −1 par pli d'écart");
    okOnce(p.score === p.rounds.reduce((a, x) => a + x.gain, 0), "cumul des points cohérent");
    if (p.bid === p.tricks) cov.exact++;
  });
  const over = S.round === deals.length;
  ok(!!byId.get("btnNext").dataset.over === over, "la partie s'arrête après la dernière manche, pas avant");
  ok(g("globalThis._peeks") === 0, "aucune IA ne lit une main qu'elle ne voit pas, ni les cartes non distribuées");
}

function checkGame() {
  ok(S.round === 25 && S.players.every((p) => p.rounds.length === 25), "une partie fait 25 manches");
  const sizes = ctx._deals.map((d) => d.size);
  ok(sizes.join() === "1,2,3,4,5,6,7,8,9,10,11,12,13,12,11,10,9,8,7,6,5,4,3,2,1",
     `l'ascenseur : de 1 à 13 cartes, puis retour à 1 (${sizes.join()})`);
}

/* Un pli complet (TRICK_MS) ou la feuille de fin (END_MS) attendent une
   pause : l'horloge du bac à sable la déclenche à la tâche suivante. */
async function until(cond) {
  for (let i = 0; i < 50 && !cond(); i++) await tick();
}

/* ============== 2. Cas ciblés — IA neutralisées ============== */
async function targetedTests() {
  g("aiTurn = async function () {};");
  ctx._illegal = [];

  const clashes = globalClashes("rikiki.html");
  ok(clashes.length === 0, `aucun nom de premier niveau ne masque une propriété de window (${clashes.join(", ")})`);

  const deck = g("buildDeck()");
  ok(deck.length === 52 && new Set(deck.map((c) => c.id)).size === 52 && deck.every((c) => c.id >= 0 && c.id < 52),
     "le paquet compte 52 cartes, chacune son id de 0 à 51");
  ok([0, 1, 2, 3].every((s) => deck.filter((c) => c.suit === s).length === 13), "treize cartes par couleur, du 2 à l'As");
  const dealsFor = g("dealsFor");
  ok(dealsFor(4).length === 25 && Math.max(...dealsFor(4)) === 13, "à quatre : 25 manches, 13 cartes au plus");
  ok(dealsFor(5).length === 19 && Math.max(...dealsFor(5)) === 10, "le moteur sait jouer à cinq : 10 cartes au plus");

  /* Table posée à la main. Seul le siège 0 se pilote au clic ; les autres
     jouent par doBid/doPlay. Cartes : "AP" (As de pique), "10C" (cœur),
     "VT" (trèfle), "2K" (carreau). */
  const SUIT = { P: 0, C: 1, T: 2, K: 3 };
  const RANK = { A: 14, R: 13, D: 12, V: 11 };
  const C = (spec) => g("mkCard")(SUIT[spec.slice(-1)], RANK[spec.slice(0, -1)] || Number(spec.slice(0, -1)));
  const table = (hands, { dealer = 3, trump = 1, bids = null } = {}) => {
    g("startGame")(4);
    byId.get("scoreOverlay").hidden = true;
    S.players.forEach((p, i) => { p.ai = false; p.hand = hands[i].map(C); p.bid = bids ? bids[i] : null; p.tricks = 0; });
    S.size = hands[0].length;
    S.dealer = dealer;
    S.trump = trump;
    S.turned = trump >= 0 ? g("mkCard")(trump, 5) : null;
    S.out = [];
    S.trick = []; S.lastTrick = null; S.history = [];
    S.busy = false; S.sel = null; S.bidSel = null;
    S.current = (dealer + 1) % 4;
    S.phase = "idle";
    g("beginTurn")();
  };
  const find = (seat, spec) => { const c = C(spec); return S.players[seat].hand.find((x) => x.id === c.id); };
  const play = (seat, spec) => g("doPlay")(seat, find(seat, spec));
  const status = () => byId.get("status").innerHTML;

  /* ---------------------------------------------------------- Annonces */
  table([["2P", "3P", "4P"], ["5P", "6P", "7P"], ["8P", "9P", "10P"], ["VP", "DP", "RP"]], { dealer: 3 });
  ok(S.phase === "bid" && S.current === 0, "le voisin du donneur annonce le premier");
  ok(g("forbiddenBid(0)") === null && legalBids(0).join() === "0,1,2,3", "hors du donneur, toutes les annonces de 0 au nombre de cartes");
  ok(!canBid(0, 4) && !canBid(0, -1) && !canBid(0, 1.5), "pas plus que le nombre de cartes, ni de négatif, ni de fraction");
  onBidClick(2);
  ok(S.players[0].bid === null && S.bidSel === 2, "un premier clic choisit le nombre sans l'annoncer");
  onBidClick(2);
  ok(S.players[0].bid === 2 && S.current === 1, "un second clic l'annonce, et la parole passe au suivant");
  g("doBid")(1, 0);
  g("doBid")(2, 0);
  ok(S.current === 3 && g("forbiddenBid(3)") === 1 && legalBids(3).join() === "0,2,3",
     "le donneur, qui parle en dernier, ne peut pas faire tomber le total juste");
  g("doBid")(3, 2);
  ok(!g("bidding()") && S.phase === "play" && S.current === 0, "les annonces faites, le voisin du donneur entame");

  table([["2P", "3P"], ["5P", "6P"], ["8P", "9P"], ["VP", "DP"]], { dealer: 3, bids: [2, 1, 0, null] });
  S.current = 3;
  ok(g("forbiddenBid(3)") === null && legalBids(3).join() === "0,1,2", "annonces déjà au-delà du nombre de plis : le donneur annonce ce qu'il veut");

  /* ------------------------------------------------------------- Légalité */
  table([["AP", "3C", "2T"], ["RP", "5C", "7K"], ["3T", "4C", "9K"], ["DP", "5T", "6K"]], { dealer: 3, trump: 1, bids: [1, 1, 0, 0] });
  const me = S.players[0];
  ok(legalCards(0).length === 3, "on entame avec la carte qu'on veut");
  play(0, "2T");
  ok(legalCards(1).length === 3, "sans la couleur demandée : n'importe quelle carte");
  play(1, "5C");
  ok(legalCards(2).map((c) => g("cardLabel")(c)).join() === "3♣", "il faut fournir la couleur demandée");
  play(2, "3T");
  ok(legalCards(3).map((c) => g("cardLabel")(c)).join() === "5♣", "fournir même au-dessus de la carte qui tient le pli");
  play(3, "5T");
  ok(S.phase === "trick" && S.busy && status().includes("Pli pour <b>Nora</b>"),
     `le pli complet reste sur la table, son gagnant annoncé (${status()})`);
  ok(byId.get("trick").children.some((s) => s.children[0].className.includes("win")), "la carte gagnante est entourée");
  await until(() => S.phase !== "trick");
  ok(S.players[1].tricks === 1 && S.current === 1 && S.lastTrick.winner === 1, "le 5 d'atout coupe le trèfle : Nora ramasse et entame");

  table([["AP", "3C"], ["RP", "4K"], ["DC", "9K"], ["VP", "6K"]], { dealer: 3, trump: 1, bids: [1, 0, 0, 0] });
  play(0, "AP"); play(1, "RP");
  ok(legalCards(2).length === 2, "sans la couleur : couper n'est pas obligatoire, se défausser est permis");
  play(2, "9K");
  play(3, "VP");
  await until(() => S.phase !== "trick");
  ok(S.players[0].tricks === 1, "une défausse ne prend jamais le pli : l'As de pique gagne");

  table([["2P", "3C"], ["RC", "4K"], ["DC", "9K"], ["VP", "6K"]], { dealer: 3, trump: 1, bids: [0, 1, 0, 0] });
  play(0, "2P");
  play(1, "RC");
  ok(legalCards(2).length === 2, "pas d'obligation de monter à l'atout, ni de couper");
  play(2, "DC"); play(3, "VP");
  await until(() => S.phase !== "trick");
  ok(S.players[1].tricks === 1, "le plus fort atout prend le pli");

  table([["2C", "3T"], ["AP", "4K"], ["DP", "9K"], ["VP", "6K"]], { dealer: 3, trump: -1, bids: [0, 1, 0, 0] });
  play(0, "2C"); play(1, "AP"); play(2, "DP"); play(3, "VP");
  await until(() => S.phase !== "trick");
  ok(S.players[0].tricks === 1, "sans atout, rien ne coupe : seule la couleur demandée compte");

  /* ------------------------------------------- Le joueur et ses clics */
  table([["AP", "3P", "2C"], ["RP", "5C", "7K"], ["3T", "4C", "9K"], ["DP", "5T", "6K"]], { dealer: 2, trump: 1, bids: [1, 1, 0, 0] });
  play(3, "DP");
  ok(S.phase === "play" && S.current === 0, "à toi");
  onCardClick(find(0, "2C").uid);
  ok(S.sel === null, "une carte qui ne fournit pas est refusée au clic");
  onCardClick(find(0, "AP").uid);
  ok(S.sel === find(0, "AP").uid && S.players[0].hand.length === 3 && status().includes("prendrait le pli"),
     `un clic choisit la carte et dit si elle prendrait le pli (${status()})`);
  onCardClick(find(0, "3P").uid);
  ok(status().includes("ne prendrait pas le pli"), "le 3 de pique passerait sous la Dame");
  onPlayClick();
  ok(S.players[0].hand.length === 2 && S.trick.length === 2 && S.current === 1, "« Jouer » pose la carte choisie");

  /* ---------------------------------------------------- Fin de manche */
  table([["AP"], ["RP"], ["DP"], ["VP"]], { dealer: 3, trump: 2, bids: [1, 1, 0, 0] });
  // Une carte : c'est le front. Ici tout est posé à la main.
  ok(S.phase === "front", "manche à une carte : personne ne choisit, la carte tombe seule");
  onCardClick(S.players[0].hand[0].uid);
  ok(S.trick.length === 0, "au front, le clic sur ta carte ne fait rien");
  ok(byId.get("hand").children[0].children[0].className.includes("back"), "au front, ta carte reste de dos");
  ok(!S.players[1]._fan.children[0].className.includes("back"), "au front, la carte des autres se voit");
  play(0, "AP"); play(1, "RP"); play(2, "DP"); play(3, "VP");
  await until(() => S.phase !== "trick");
  ok(S.phase === "over" && S.players.map((p) => p.gain).join() === "11,-1,10,10",
     `As fait son pli : 11 ; Roi annoncé 1 sans pli : −1 ; annonces 0 tenues : 10 (${S.players.map((p) => p.gain).join()})`);
  ok(status().startsWith("Fin de la manche : contrat réussi"), `la fin de manche est annoncée (${status()})`);
  ok(byId.get("scoreOverlay").hidden, "la feuille attend une pause, le dernier pli encore sur la table");
  await until(() => !byId.get("scoreOverlay").hidden);
  ok(!byId.get("scoreOverlay").hidden && byId.get("btnNext").dataset.over === "", "puis la feuille s'ouvre");

  // La manche à 13 cartes : tout est distribué, sans atout.
  g("startGame")(4);
  S.round = 13;
  g("startRound()");
  ok(S.size === 13 && S.turned === null && S.trump === -1 && S.out.length === 0, "à 13 cartes : rien à retourner, sans atout");
  S.round = 12;
  g("startRound()");
  ok(S.size === 12 && S.turned && S.trump === S.turned.suit && S.out.length === 3, "à 12 cartes : la 49e carte est retournée, 3 restent hors jeu");

  ok(g("contract(0, 0)") === 10 && g("contract(3, 3)") === 13 && g("contract(2, 4)") === -2 && g("contract(3, 1)") === -2,
     "barème : 0 tenu 10, 3 tenus 13, 2 annoncés pour 4 faits −2");

  /* ---------------------------------------------------- Politiques d'IA */
  for (const level of ["simple", "sharp"]) {
    const pol = g(`${level}Policy`);
    table([["2P", "3P", "4P"], ["AC", "RC", "DC"], ["2T", "3K", "4T"], ["VP", "DP", "RP"]], { dealer: 0, trump: 1 });
    ok(pol.bid(S.players[1], 1) === 3, `${level} : trois gros atouts, trois plis annoncés`);
    ok(pol.bid(S.players[2], 2) === 0, `${level} : trois petites cartes sans atout, aucun pli`);

    table([["2T", "3T"], ["AP", "3P"], ["RT", "4K"], ["RP", "5K"]], { dealer: 2, trump: 1, bids: [0, 1, 0, 1] });
    play(3, "RP"); play(0, "3T");
    ok(pol.play(S.players[1], 1) === find(1, "AP"), `${level} : il lui faut un pli, l'As de pique le prend`);
    S.players[1].bid = 0;
    ok(pol.play(S.players[1], 1) === find(1, "3P"), `${level} : son compte est fait, le 3 passe sous le Roi`);
  }

  /* Au front, la redoutable compte : les cartes qu'elle voit, et les annonces
     de ceux qui ont parlé avant elle en voyant la sienne. */
  table([["AP"], ["2T"], ["2K"], ["3T"]], { dealer: 3, trump: 1 });
  ok(g("frontChance(0)") === 1 && g("sharpPolicy").bid(S.players[0], 0) === 1,
     "au front, en entamant contre trois petites cartes sans atout : la redoutable annonce le pli");
  table([["AP"], ["2T"], ["2K"], ["AC"]], { dealer: 3, trump: 1 });
  ok(g("frontChance(0)") === 0 && g("sharpPolicy").bid(S.players[0], 0) === 0,
     "au front, face à l'As d'atout : aucun pli");
  // Yuki (siège 3) entame l'As de pique ; tu ne prends qu'avec un cœur, l'atout.
  // Yuki voit ta carte : n'annoncer aucun pli, c'est qu'elle est sans doute un cœur.
  table([["7C"], ["2T"], ["2K"], ["AP"]], { dealer: 2, trump: 1, bids: [null, null, null, 1] });
  const naive = g("frontChance(0)");
  S.players[3].bid = 0;
  const told = g("frontChance(0)");
  // 12 cœurs possibles sur 48 cartes que tu ne vois pas ; Yuki annonce 1 pli
  // pour chacune des 36 autres, 0 pour chaque cœur. AI.trust : la confiance
  // dans ce modèle.
  const t = g("AI.trust");
  ok(Math.abs(naive - 12 * (1 - t) / (12 * (1 - t) + 36 * t)) < 1e-9,
     `Yuki annonce le pli : ta carte n'est sans doute pas un cœur (${naive.toFixed(3)})`);
  ok(Math.abs(told - 12 * t / (12 * t + 36 * (1 - t))) < 1e-9 && told > naive,
     `Yuki n'annonce rien : ta carte est sans doute un cœur (${told.toFixed(3)} contre ${naive.toFixed(3)})`);

  const illegal = g("globalThis._illegal");
  ok(illegal.length === 0, `cas ciblés : aucune annonce ni carte illégale (${JSON.stringify(illegal[0] || "")})`);
  ok(g("globalThis._peeks") === 0, "cas ciblés : aucune IA ne lit une main qu'elle ne voit pas");
}

/* ------------------------------------------------------------------ Main */
(async () => {
  const t0 = Date.now();
  for (let i = 0; i < 5; i++) await playGame("sharp");
  for (let i = 0; i < 2; i++) await playGame("simple");
  Object.assign(cov, g("globalThis._cov"), { tricks: trickChecks });
  await targetedTests();
  console.log("Couverture :", JSON.stringify(cov), `(${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  report("Rikiki");
})();
