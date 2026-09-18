/* Trou du cul — règles du jeu, vérifiées en jouant des parties complètes.
 * Lancer : node tests/trou-du-cul.test.js
 *
 * Deux parties dans ce fichier :
 *   1. des parties complètes de 4 à 6 joueurs, sous invariants : conservation
 *      du paquet, légalité de chaque pose, passes définitives, tours sautés,
 *      fin de pli, échanges, classement et points ;
 *   2. des cas ciblés et **synchrones**, tours d'IA neutralisés.
 */
"use strict";

const { loadTrouDuCul, checker, globalClashes } = require("./harness");

const { g, S, byId, tick } = loadTrouDuCul();
const { ok, okOnce, report } = checker();

/* Instrumentation : chaque pose, chaque passe, chaque fin de pli, chaque don
   est vérifié à l'instant où il a lieu. */
g(`
  globalThis._illegal = []; globalThis._badTricks = 0; globalThis._peeks = 0;
  globalThis._gifts = []; globalThis._rounds = [];
  globalThis._cov = { revolutions: 0, jokers: 0, closed: 0, skips: 0 };
  let _lastTop = false;

  const _doPlay = doPlay;
  doPlay = function (seat, cards) {
    if (seat !== S.current || !canPlayCards(cards) || !cards.every((c) => S.players[seat].hand.includes(c))
        || S.passed.has(seat) || seat === S.trick.skipped) {
      globalThis._illegal.push({ seat, current: S.current, cards: cards.map(cardLabel), trick: { ...S.trick, cards: null },
        passed: [...S.passed] });
    }
    const rank = comboRank(cards);
    _lastTop = rank === topRank();
    if (cards.length === 4) globalThis._cov.revolutions++;
    if (cards.some(isJoker)) globalThis._cov.jokers++;
    if (_lastTop) globalThis._cov.closed++;
    if (rank === S.trick.rank) globalThis._cov.skips++;
    return _doPlay(seat, cards);
  };

  // S.passed peut déjà contenir le siège : aiTurn marque la passe avant sa
  // pause, pour afficher la bulle pendant qu'on lit la dernière carte.
  const _doPass = doPass;
  doPass = function (seat) {
    if (seat !== S.current || S.trick.rank === null || seat === S.trick.skipped) {
      globalThis._illegal.push({ pass: seat, current: S.current, passed: [...S.passed], skipped: S.trick.skipped });
    }
    return _doPass(seat);
  };

  // Un pli se ramasse soit sur la plus forte carte, soit quand tous les
  // autres ont passé ou sauté leur tour.
  const _endTrick = endTrick;
  endTrick = function (closed) {
    const others = activeSeats().filter((q) => q !== S.trick.by);
    const done = closed ? _lastTop : others.every((q) => S.passed.has(q) || q === S.trick.skipped);
    if (S.trick.rank === null || !done) globalThis._badTricks++;
    return _endTrick(closed);
  };

  const _giveCards = giveCards;
  giveCards = function (from, to, cards) {
    globalThis._gifts.push({ from, to, ranks: cards.map((c) => c.rank),
      handRanks: S.players[from].hand.map((c) => c.rank) });
    return _giveCards(from, to, cards);
  };

  const _startRound = startRound;
  startRound = function () { globalThis._gifts = []; _startRound(); };

  // Relevé au moment où le dernier échange est fait — l'humain a pu y prendre
  // part, entre deux clics — et avant que le premier tour ne démarre. Les rôles
  // sont encore ceux de la manche précédente.
  const _nextGive = nextGive;
  nextGive = function () {
    if (S.gives.length === 0) {
      globalThis._rounds.push({ round: S.round, roles: S.players.map((p) => p.role), leader: S.leader,
        gifts: globalThis._gifts.slice(), sizes: S.players.map((p) => p.hand.length), aside: S.aside.length,
        qh: S.players.findIndex((p) => p.hand.some((c) => c.suit === "C" && c.rank === 12)) });
    }
    return _nextGive();
  };
`);

/* Les politiques n'ont droit qu'à l'information publique : pendant chaque
   décision, les mains des autres deviennent des Proxy qui comptent tout accès
   par indice ou par itération (`length` reste libre). */
g(`
  const _policyOf = policyOf;
  policyOf = function (p) {
    const pol = _policyOf(p);
    const wrapped = {};
    for (const k of Object.keys(pol)) {
      wrapped[k] = (...args) => {
        const saved = S.players.map((q) => q.hand);
        for (const q of S.players) {
          if (q === p) continue;
          q.hand = new Proxy(q.hand, {
            get(t, prop) {
              if (typeof prop === "symbol" || /^[0-9]+$/.test(prop)) globalThis._peeks++;
              return Reflect.get(t, prop);
            },
          });
        }
        try { return pol[k](...args); }
        finally { S.players.forEach((q, i) => { q.hand = saved[i]; }); }
      };
    }
    return wrapped;
  };
`);

const mkCard = g("mkCard");
const canPlayCards = g("canPlayCards");
const comboRank = g("comboRank");
const legalPlays = g("legalPlays");
const onCardClick = g("onCardClick");
const onPlayClick = g("onPlayClick");
const onPassClick = g("onPassClick");
const onGiveClick = g("onGiveClick");

const rnd = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rnd(a.length)];
const cov = { games: 0, rounds: 0, offenders: 0, humanGives: 0, humanJokers: 0 };

/* ---------------------------------------------------- 1. Parties complètes */
function checkConservation(where) {
  const uids = new Set();
  let total = 0;
  const add = (c) => { uids.add(c.uid); total++; };
  S.players.forEach((p) => p.hand.forEach(add));
  S.played.forEach(add);
  S.aside.forEach(add);
  okOnce(total === 54 && uids.size === 54, `54 cartes distinctes à tout instant (${where} : ${total}/${uids.size})`);
}

function humanAct() {
  const me = S.players[0];
  if (S.phase === "give") {
    cov.humanGives++;
    const before = me.hand.length;
    onGiveClick();                                  // rien de sélectionné : refusé
    okOnce(me.hand.length === before && S.phase === "give", "on ne donne pas sans avoir choisi le bon nombre de cartes");
    const cards = [...me.hand].sort(() => Math.random() - 0.5).slice(0, S.give.k);
    for (const c of cards) onCardClick(c.uid);
    onGiveClick();
    return;
  }
  if (S.phase !== "play") return;
  okOnce(!S.passed.has(0), "un joueur qui a passé ne rejoue pas dans le pli");
  const legal = legalPlays(0);
  okOnce(legal.every((m) => canPlayCards(m)), "legalPlays ne propose que des coups légaux");
  if (S.trick.rank === null) {
    const before = S.current;
    onPassClick();
    okOnce(S.current === before && S.phase === "play", "on ne passe pas en ouverture");
  }
  const smart = Math.random() < 0.5;
  let move = smart ? g("simplePolicy").play(me, 0) : (legal.length && (S.trick.rank === null || Math.random() < 0.7) ? pick(legal) : null);
  if (!move) { onPassClick(); return; }
  if (move.some((c) => c.rank === 16)) cov.humanJokers++;
  S.sel = new Set(move.map((c) => c.uid));
  onPlayClick();
}

async function playGame(n, level) {
  g(`chosenPlayers = ${n}; chosenLevel = ${JSON.stringify(level)}; chosenFormat = "short";`);
  g("globalThis._rounds = []");
  byId.get("btnStart").click();
  let guard = 0;
  while (guard++ < 300000) {
    await tick();
    if (S.phase === "over") {
      checkRound(n);
      if (byId.get("btnNext").dataset.over) { cov.games++; return; }
      byId.get("btnNext").click();
      continue;
    }
    if (S.busy || (S.phase !== "give" && S.current !== 0)) continue;
    if (S.phase === "play" || S.phase === "give") {
      checkConservation("décision humaine");
      humanAct();
    }
  }
  ok(false, "la partie se termine sans blocage (garde-fou atteint)");
}

function checkRound(n) {
  cov.rounds++;
  checkConservation("fin de manche");
  const illegal = g("globalThis._illegal");
  ok(illegal.length === 0, `toutes les poses et passes étaient légales, au bon joueur, jamais après une passe ou un tour sauté (${JSON.stringify(illegal[0] || "")})`);
  g("globalThis._illegal = []");
  ok(g("globalThis._badTricks") === 0, "un pli ne se ramasse que sur la plus forte carte ou quand tous les autres ont passé");

  // Classement : chaque siège une fois, rôles et points selon la place.
  const order = S.order;
  ok(order.length === n && new Set(order).size === n, "le classement contient chaque joueur une fois");
  const roleFor = (pos) => (pos === 0 ? "P" : pos === 1 ? "VP" : pos === n - 1 ? "T" : pos === n - 2 ? "VT" : "N");
  order.forEach((seat, pos) => {
    const p = S.players[seat];
    okOnce(p.role === roleFor(pos), "rôle attribué selon la place d'arrivée");
    okOnce(p.gain === n - 1 - pos, "le Président marque n − 1 points, le Trou du cul 0");
  });
  S.players.forEach((p) => okOnce(p.score === p.rounds.reduce((a, b) => a + b, 0), "cumul des points cohérent"));
  ok(order.slice(0, n - S.offenders.length).every((s) => !S.offenders.includes(s)),
     "ceux qui finissent sur une carte interdite sont relégués en bas du classement");
  cov.offenders += S.offenders.length;
  ok(S.players.every((p, i) => !!p.offense === S.offenders.includes(i)), "chaque fautif garde la carte de sa faute");
  const holders = S.players.filter((p) => p.hand.length > 0).length;
  ok(holders <= 1, "la manche s'arrête quand un seul joueur a encore des cartes");

  // Donne, échanges et premier joueur, vérifiés sur l'état relevé par startRound.
  const r = g("globalThis._rounds").at(-1);
  const per = Math.floor(54 / n);
  ok(r.sizes.every((s) => s === per) && r.aside === 54 - per * n,
     `donne égale de ${per} cartes, ${54 - per * n} écartée(s)`);
  if (r.roles.every((x) => x === null)) {
    ok(r.gifts.length === 0, "aucun échange à la première manche");
    ok(r.leader === (r.qh >= 0 ? r.qh : 0), "la Dame de cœur ouvre la première manche");
  } else {
    const seat = (role) => r.roles.indexOf(role);
    const [P, VP, VT, T] = ["P", "VP", "VT", "T"].map(seat);
    ok(r.leader === T, "le Trou du cul ouvre la manche suivante");
    const top = (ranks, k) => ranks.slice().sort((a, b) => b - a).slice(0, k).join();
    const fromT = r.gifts.find((x) => x.from === T && x.to === P);
    const fromVT = r.gifts.find((x) => x.from === VT && x.to === VP);
    ok(!!fromT && fromT.ranks.slice().sort((a, b) => b - a).join() === top(fromT.handRanks, 2),
       "le Trou du cul donne ses 2 meilleures cartes au Président, jokers d'abord");
    ok(!!fromVT && fromVT.ranks.join() === top(fromVT.handRanks, 1),
       "le Vice-trou du cul donne sa meilleure carte au Vice-président");
    ok(r.gifts.some((x) => x.from === P && x.to === T && x.ranks.length === 2),
       `le Président rend 2 cartes au Trou du cul (${JSON.stringify(r.gifts)})`);
    ok(r.gifts.some((x) => x.from === VP && x.to === VT && x.ranks.length === 1),
       `le Vice-président rend une carte au Vice-trou du cul (${JSON.stringify(r.gifts)})`);
    ok(r.gifts.every((x) => [P, VP, VT, T].includes(x.from)), "les Neutres n'échangent rien");
  }

  const over = S.players.some((p) => p.score >= S.target);
  ok(!!byId.get("btnNext").dataset.over === over, "la partie s'arrête dès qu'un joueur atteint l'objectif");
  ok(S.target === (n - 1) * 3, "objectif proportionnel au nombre de joueurs");
  ok(g("globalThis._peeks") === 0, "aucune IA ne lit la main d'un autre joueur");
}

/* ============== 2. Cas ciblés — synchrones, IA neutralisées ============== */
function targetedTests() {
  g("aiTurn = async function () {};");

  const clashes = globalClashes("trou-du-cul.html");
  ok(clashes.length === 0, `aucun nom de premier niveau ne masque une propriété de window (${clashes.join(", ")})`);

  const deck = g("buildDeck()");
  ok(deck.length === 54, "le paquet compte 54 cartes");
  ok([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].every((r) => deck.filter((c) => c.rank === r).length === 4),
     "treize valeurs du 3 au 2, quatre couleurs chacune");
  ok(deck.filter((c) => c.rank === 16).length === 2, "plus deux jokers");

  /* Table posée à la main. Seul le siège 0 se pilote au clic ; les autres
     jouent par doPlay/doPass. Tous humains : rien ne part en asynchrone. */
  const C = (spec) => (spec === "JK" ? g("mkJoker()") : mkCard(spec.slice(-1), Number(spec.slice(0, -1))));  // "9P", "15C" (le 2), "JK"
  const table = (n, hands) => {
    g(`chosenPlayers = ${n};`);
    byId.get("btnStart").click();
    byId.get("scoreOverlay").hidden = true;
    S.players.forEach((p, i) => { p.ai = false; p.role = null; p.offense = null; p.hand = hands[i].map(C); });
    S.played = []; S.aside = [];
    S.trick = g("emptyTrick()"); S.lastTrick = null; S.passed = new Set();
    S.finished = []; S.offenders = []; S.revolution = false;
    S.busy = false; S.current = 0; S.phase = "play";
  };
  const find = (seat, s) => S.players[seat].hand.find((c) => (s === "JK" ? c.rank === 16 : `${c.rank}${c.suit}` === s));
  const doPlay = (seat, specs) => {
    const hand = S.players[seat].hand, picked = [];
    for (const s of specs) picked.push(hand.find((c) => !picked.includes(c) && (s === "JK" ? c.rank === 16 : `${c.rank}${c.suit}` === s)));
    g("doPlay")(seat, picked);
  };
  const doPass = (seat) => g("doPass")(seat);
  const cards = (...specs) => specs.map(C);
  const trick = (rank, count) => { S.trick = { rank, count, by: 1, cards: [], skipped: null }; };

  /* ------------------------------------------------------------- Légalité */
  table(4, [["5P"], ["5C"], ["5K"], ["5T"]]);
  ok(canPlayCards(cards("9P")) && canPlayCards(cards("9P", "9C", "9K")), "ouverture : une ou plusieurs cartes de même valeur");
  ok(!canPlayCards(cards("9P", "10C")), "ouverture : pas deux valeurs différentes");
  ok(!canPlayCards(cards("9P", "9C", "9K", "9T", "JK")), "quatre cartes au plus");
  ok(canPlayCards(cards("9P", "JK")) && comboRank(cards("9P", "JK")) === 9, "un joker complète une paire : 9 + joker = paire de 9");
  ok(!canPlayCards(cards("9P", "10C", "JK")), "un joker ne réconcilie pas deux valeurs différentes");
  ok(comboRank(cards("JK")) === 15 && comboRank(cards("JK", "JK")) === 15, "des jokers seuls valent un 2");
  trick(9, 2);
  ok(canPlayCards(cards("10P", "10C")), "une paire de 10 bat une paire de 9");
  ok(!canPlayCards(cards("8P", "8C")), "une paire de 8 ne bat pas une paire de 9");
  ok(!canPlayCards(cards("10P")) && !canPlayCards(cards("10P", "10C", "10K")), "il faut poser autant de cartes");
  ok(canPlayCards(cards("9K", "9T")), "même valeur : on peut égaler");
  ok(canPlayCards(cards("9K", "JK")) && canPlayCards(cards("12K", "JK")) && !canPlayCards(cards("8K", "JK")),
     "une paire avec joker se compare par sa valeur");
  ok(canPlayCards(cards("JK", "JK")), "deux jokers battent une paire");
  ok(!canPlayCards(cards("15P")), "le 2 n'est pas un atout : un 2 seul ne bat pas une paire");
  trick(14, 1);
  ok(canPlayCards(cards("15P")) && !canPlayCards(cards("13P")), "le 2 bat l'As, le Roi non");
  S.revolution = true;
  trick(9, 2);
  ok(canPlayCards(cards("8P", "8C")) && !canPlayCards(cards("10P", "10C")), "révolution : l'ordre est inversé");
  trick(4, 1);
  ok(canPlayCards(cards("3P")) && !canPlayCards(cards("15P")), "révolution : le 3 est la plus forte, le 2 la plus faible");
  ok(comboRank(cards("JK")) === 3, "révolution : un joker seul vaut un 3");
  S.revolution = false;

  /* -------------------------------------------------- Passer, c'est sortir du pli */
  table(4, [["5P", "12P", "13P"], ["7P", "9C", "3K"], ["6P", "3C"], ["8P", "3T"]]);
  const before = S.players[0].hand.length;
  onPassClick();
  ok(S.current === 0 && S.players[0].hand.length === before, "on ne peut pas passer en ouverture");
  onCardClick(find(0, "5P").uid);
  onPlayClick();
  doPass(1);
  doPlay(2, ["6P"]);
  doPass(3);
  onCardClick(find(0, "12P").uid);
  onPlayClick();
  ok(S.current === 2, "qui a passé est sauté jusqu'à la fin du pli");
  doPass(2);
  ok(S.trick.rank === null && S.lastTrick.by === 0 && !S.lastTrick.closed && S.current === 0,
     "tous les autres ont passé : le dernier à avoir posé ramasse et rouvre");

  table(4, [["5P", "12P"], ["7P"], ["6P", "3C"], ["8P", "3T"]]);
  onCardClick(find(0, "5P").uid);
  onPlayClick();
  doPlay(1, ["7P"]);
  ok(S.finished.join() === "1", "poser sa dernière carte fait sortir");
  doPass(2); doPass(3); onPassClick();
  ok(S.trick.rank === null && S.current === 2, "le pli d'un joueur sorti revient à son voisin");

  /* ------------------------------------------------------------ Même valeur */
  table(4, [["9P", "3P"], ["9C", "4C"], ["10K", "5K"], ["11T", "6T"]]);
  onCardClick(find(0, "9P").uid);
  onPlayClick();
  doPlay(1, ["9C"]);
  ok(S.trick.skipped === 2 && S.current === 3, "même valeur : le joueur suivant saute son tour");
  doPass(3);
  ok(S.current === 0, "le pli continue après le joueur sauté");
  onPassClick();
  ok(S.trick.rank === null && S.lastTrick.by === 1, "le tour revient à qui a égalé : il ramasse, le sauté n'a pas rejoué");

  table(4, [["9P", "3P"], ["9C", "4C"], ["10K", "5K"], ["11T", "6T"]]);
  onCardClick(find(0, "9P").uid);
  onPlayClick();
  doPlay(1, ["9C"]);
  doPlay(3, ["11T"]);
  onPassClick();
  doPass(1);
  ok(S.current === 2 && S.trick.skipped === null, "le joueur sauté n'est pas sorti du pli : il rejoue quand son tour revient");

  table(4, [["9P", "3P"], ["4C", "5C"], ["5K", "6K"], ["9T", "6T"]]);
  onCardClick(find(0, "9P").uid);
  onPlayClick();
  doPass(1); doPass(2);
  doPlay(3, ["9T"]);
  ok(S.trick.rank === null && S.lastTrick.by === 3, "égaler quand ne reste que celui qu'on saute : le pli est gagné");

  /* -------------------------------------------------- La plus forte carte arrête le pli */
  table(4, [["5P", "3P"], ["15C", "4C"], ["6K", "5K"], ["7T", "6T"]]);
  onCardClick(find(0, "5P").uid);
  onPlayClick();
  doPlay(1, ["15C"]);
  ok(S.trick.rank === null && S.lastTrick.closed && S.lastTrick.by === 1 && S.current === 1,
     "un 2 arrête le pli : son auteur ramasse et rouvre aussitôt");

  table(4, [["5P", "3P"], ["JK", "4C"], ["6K", "5K"], ["7T", "6T"]]);
  onCardClick(find(0, "5P").uid);
  onPlayClick();
  doPlay(1, ["JK"]);
  ok(S.trick.rank === null && S.lastTrick.closed && S.current === 1, "un joker seul arrête le pli");

  table(4, [["5P", "5C", "3P"], ["9C", "JK", "4C"], ["6K", "5K"], ["7T", "6T"]]);
  S.sel = new Set([find(0, "5P").uid, find(0, "5C").uid]);
  onPlayClick();
  doPlay(1, ["9C", "JK"]);
  ok(S.trick.rank === 9 && S.current === 2, "une paire de 9 avec un joker n'arrête pas le pli");

  table(4, [["15P", "15C", "15K", "15T", "3P"], ["5C"], ["6K"], ["7T"]]);
  S.sel = new Set(S.players[0].hand.filter((c) => c.rank === 15).map((c) => c.uid));
  onPlayClick();
  ok(S.revolution && S.lastTrick.closed && S.current === 0, "un carré de 2 arrête le pli, et fait la révolution");

  table(4, [["4P", "3P", "8P"], ["3C", "15C", "4C"], ["15K", "5K"], ["7T", "6T"]]);
  S.revolution = true;
  onCardClick(find(0, "4P").uid);
  onPlayClick();
  doPlay(1, ["3C"]);
  ok(S.lastTrick && S.lastTrick.closed && S.current === 1, "révolution : c'est le 3 qui arrête le pli");
  doPlay(1, ["15C"]);
  ok(S.trick.rank === 15 && S.current === 2, "révolution : le 2 n'arrête rien");

  /* ------------------------------------------------------- Clics avec jokers */
  table(4, [["9P", "JK", "JK", "3P"], ["10C"], ["11K"], ["12T"]]);
  trick(8, 2);
  onCardClick(find(0, "9P").uid);
  let sel = S.players[0].hand.filter((c) => S.sel.has(c.uid));
  ok(sel.length === 2 && sel.some((c) => c.rank === 9) && sel.some((c) => c.rank === 16),
     "pour suivre une paire avec un seul 9, le clic complète avec un joker");
  S.sel = new Set();
  onCardClick(S.players[0].hand.find((c) => c.rank === 16).uid);
  sel = S.players[0].hand.filter((c) => S.sel.has(c.uid));
  ok(sel.length === 2 && sel.every((c) => c.rank === 16), "un clic sur un joker sans sélection prend deux jokers pour une paire");
  onPlayClick();
  ok(S.lastTrick && S.lastTrick.closed && S.current === 0, "deux jokers arrêtent le pli");

  table(4, [["9P", "9C", "JK", "3P"], ["10C"], ["11K"], ["12T"]]);
  trick(8, 2);
  onCardClick(find(0, "9P").uid);
  onCardClick(S.players[0].hand.find((c) => c.rank === 16).uid);
  sel = S.players[0].hand.filter((c) => S.sel.has(c.uid));
  ok(sel.length === 2 && sel.filter((c) => c.rank === 9).length === 1 && sel.some((c) => c.rank === 16),
     "un clic sur un joker remplace une carte normale de la sélection");

  /* ------------------------------------------------------- Fin de manche */
  table(4, [["5P"], ["7P", "3C"], ["6P", "4C"], ["8P", "3T"]]);
  onCardClick(S.players[0].hand[0].uid);
  onPlayClick();                                   // 1er : Président
  doPass(1); doPlay(2, ["6P"]); doPass(3);         // pli pour 2
  doPlay(2, ["4C"]);                               // 2e : Vice-président
  doPlay(3, ["8P"]); doPass(1);                    // pli pour 3, qui rouvre
  doPlay(3, ["3T"]);                               // 3e : reste le siège 1
  ok(S.phase === "over", "la manche s'arrête quand il ne reste qu'un joueur avec des cartes");
  ok(S.order.join() === "0,2,3,1", `classement dans l'ordre de sortie (${S.order.join()})`);
  ok(S.players.map((p) => p.role).join() === "P,T,VP,VT", "Président, Vice-président, Vice-trou du cul, Trou du cul");
  ok(S.players.map((p) => p.gain).join() === "3,0,2,1", "points : 3, 2, 1, 0 à quatre joueurs");

  table(4, [["15P"], ["7P", "3C"], ["6P", "4C"], ["8P", "3T"]]);
  onCardClick(S.players[0].hand[0].uid);
  onPlayClick();
  ok(S.offenders.join() === "0" && S.finished.length === 0 && S.players[0].offense === "un 2", "finir sur un 2 est relevé");
  ok(S.current === 1 && S.lastTrick.closed, "le pli est arrêté, le voisin rouvre");

  table(4, [["9P", "JK"], ["7P", "3C"], ["6P", "4C"], ["8P", "3T"]]);
  S.sel = new Set(S.players[0].hand.map((c) => c.uid));
  onPlayClick();
  ok(S.offenders.join() === "0" && S.players[0].offense === "un joker", "finir avec un joker, même en paire de 9, est interdit");

  table(4, [["3P"], ["7P", "3C"], ["6P", "4C"], ["8P", "3T"]]);
  S.revolution = true;
  onCardClick(S.players[0].hand[0].uid);
  onPlayClick();
  ok(S.offenders.join() === "0" && S.players[0].offense === "un 3", "révolution : finir sur un 3 est interdit");

  table(4, [["15P"], ["7P", "3C"], ["6P", "4C"], ["8P", "3T"]]);
  S.revolution = true;
  onCardClick(S.players[0].hand[0].uid);
  onPlayClick();
  ok(S.offenders.length === 0 && S.finished.join() === "0", "révolution : finir sur un 2 est permis");

  table(5, [["15P"], ["7P", "3C"], ["6P"], ["8P", "3T"], ["9P", "4T"]]);
  onCardClick(S.players[0].hand[0].uid);
  onPlayClick();                                   // fautif, le pli s'arrête : le siège 1 rouvre
  doPlay(1, ["7P"]); doPass(2); doPass(3); doPass(4);
  ok(S.current === 1, "pli ramassé");
  doPlay(1, ["3C"]);                               // 1er
  doPlay(2, ["6P"]);                               // 2e
  doPass(3); doPass(4);                            // pli pour 2, sorti : son voisin 3 rouvre
  doPlay(3, ["3T"]);
  doPlay(4, ["4T"]);
  doPlay(3, ["8P"]);                               // 3e : reste le siège 4
  ok(S.phase === "over", "la manche finit quand le dernier sortant laisse un seul joueur");
  ok(S.order.join() === "1,2,3,4,0" && S.players[0].role === "T",
     `qui finit sur un 2 est Trou du cul d'office, même sorti le premier (${S.order.join()})`);

  /* ------------------------------------------------------------- Révolution */
  table(4, [["9P", "9C", "9K", "9T", "3P"], ["5P", "5C", "5K", "5T", "4C"], ["6P"], ["7P"]]);
  S.sel = new Set(S.players[0].hand.filter((c) => c.rank === 9).map((c) => c.uid));
  onPlayClick();
  ok(S.revolution, "un carré déclenche la révolution");
  ok(canPlayCards(S.players[1].hand.filter((c) => c.rank === 5)), "pendant la révolution, un carré plus faible bat le carré");
  doPlay(1, ["5P", "5C", "5K", "5T"]);
  ok(!S.revolution, "un second carré fait la contre-révolution");

  table(4, [["9P", "9C", "9K", "JK", "3P"], ["4C"], ["6P"], ["7P"]]);
  S.sel = new Set(S.players[0].hand.filter((c) => c.rank === 9 || c.rank === 16).map((c) => c.uid));
  onPlayClick();
  ok(S.revolution, "un carré avec un joker fait aussi la révolution");

  /* ------------------------------------------------------------ Échanges */
  table(4, [["3P"], ["3C"], ["3K"], ["3T"]]);
  S.players[3].hand = cards("JK", "5P", "15C", "14C");
  ok(g("bestCards(3, 2)").map((c) => c.rank).join() === "16,15", "les meilleures cartes à donner : les jokers d'abord");
  S.players.forEach((p, i) => { p.role = ["P", "VP", "VT", "T"][i]; p.ai = i > 0; });
  S.round = 2;
  g("startRound()");
  ok(S.phase === "give" && S.give.from === 0 && S.give.k === 2, "le Président humain choisit 2 cartes à rendre");
  ok(S.players[0].hand.length === 15 && S.gifts.size === 2, "…après avoir reçu les 2 meilleures du Trou du cul, surlignées");
  const gifts = S.players[0].hand.filter((c) => S.gifts.has(c.uid)).map((c) => c.rank).sort((a, b) => b - a);
  const tMax = Math.max(...S.players[3].hand.map((c) => c.rank));
  ok(gifts[1] >= tMax, "le Trou du cul n'a gardé aucune carte plus forte que celles données");
  onCardClick(S.players[0].hand[0].uid);
  onGiveClick();
  ok(S.phase === "give", "donner une seule carte au lieu de deux est refusé");
  onCardClick(S.players[0].hand[1].uid);
  onCardClick(S.players[0].hand[2].uid);
  ok(S.sel.size === 2, "on ne sélectionne pas plus de cartes que demandé");
  onGiveClick();
  ok(S.players.every((p) => p.hand.length === 13), "après les échanges, chacun a de nouveau 13 cartes");
  ok(S.current === 3 && S.phase === "ai", "le Trou du cul ouvre la manche");

  /* ---------------------------------------------------- Politiques d'IA */
  for (const level of ["simple", "sharp"]) {
    const pol = g(`${level}Policy`);
    table(4, [["3P"], ["5P", "5C", "9K", "14T", "JK"], ["3C"], ["3K"]]);
    S.current = 1;
    const p = S.players[1];
    const lead = pol.play(p, 1);
    ok(!!lead && canPlayCards(lead), `${level} : ouvre avec un coup légal`);
    trick(8, 1);
    const follow = pol.play(p, 1);
    ok(follow === null || canPlayCards(follow), `${level} : suit avec un coup légal ou passe`);
    trick(14, 3);
    ok(pol.play(p, 1) === null, `${level} : passe quand rien ne monte`);
    const give = pol.give(p, 2);
    ok(give.length === 2 && give.every((c) => p.hand.includes(c)) && !give.some((c) => c.rank === 16),
       `${level} : rend deux cartes de sa main, jamais un joker`);

    table(4, [["3P"], ["15P", "7C"], ["3C"], ["3K"]]);
    const two = pol.play(S.players[1], 1);
    ok(two.length === 1 && two[0].rank === 15, `${level} : joue son 2 avant sa dernière carte`);
    table(4, [["3P"], ["JK", "7C"], ["3C"], ["3K"]]);
    const jk = pol.play(S.players[1], 1);
    ok(jk.length === 1 && jk[0].rank === 16, `${level} : joue son joker avant sa dernière carte`);
    table(4, [["3P"], ["7P", "JK"], ["3C"], ["3K"]]);
    trick(6, 1);
    const f = pol.play(S.players[1], 1);
    ok(!f || f[0].rank !== 7, `${level} : ne suit pas en ne gardant qu'un joker`);
  }

  const illegal = g("globalThis._illegal");
  ok(illegal.length === 0, `cas ciblés : aucune pose ni passe illégale (${JSON.stringify(illegal[0] || "")})`);
}

/* ------------------------------------------------------------------ Main */
(async () => {
  const t0 = Date.now();
  const scenarios = [[4, "sharp"], [4, "simple"], [5, "sharp"], [5, "simple"], [6, "sharp"], [6, "simple"]];
  for (const [n, level] of scenarios) for (let i = 0; i < 5; i++) await playGame(n, level);
  Object.assign(cov, g("globalThis._cov"));
  targetedTests();
  console.log("Couverture :", JSON.stringify(cov), `(${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  report("Trou du cul");
})();
