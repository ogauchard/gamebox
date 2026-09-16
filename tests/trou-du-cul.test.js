/* Trou du cul — règles du jeu, vérifiées en jouant des parties complètes.
 * Lancer : node tests/trou-du-cul.test.js
 *
 * Deux parties dans ce fichier :
 *   1. des parties complètes sur chaque combinaison de variantes, de 4 à 6
 *      joueurs, sous invariants : conservation du paquet, légalité de chaque
 *      pose, fin de pli, échanges, classement et points ;
 *   2. des cas ciblés et **synchrones**, tours d'IA neutralisés.
 */
"use strict";

const { loadTrouDuCul, checker, globalClashes } = require("./harness");

const { g, S, byId, tick } = loadTrouDuCul();
const { ok, okOnce, report } = checker();

/* Instrumentation : chaque pose, chaque fin de pli, chaque don est vérifié à
   l'instant où il a lieu. */
g(`
  globalThis._illegal = []; globalThis._badTricks = 0; globalThis._peeks = 0;
  globalThis._gifts = []; globalThis._rounds = []; globalThis._revolutions = 0; globalThis._trumps = 0;

  const _doPlay = doPlay;
  doPlay = function (seat, cards) {
    if (seat !== S.current || !canPlayCards(cards, seat) || !cards.every((c) => S.players[seat].hand.includes(c))) {
      globalThis._illegal.push({ seat, current: S.current, cards: cards.map(cardLabel), trick: { ...S.trick } });
    }
    if (VAR.revolution && cards.length === 4) globalThis._revolutions++;
    if (VAR.trump && cards.length === 1 && cards[0].rank === 15 && S.trick.count > 1) globalThis._trumps++;
    return _doPlay(seat, cards);
  };

  const _endTrick = endTrick;
  endTrick = function () {
    const others = activeSeats().filter((q) => q !== S.trick.by);
    if (S.trick.rank === null || !others.every((q) => S.passed.has(q))) globalThis._badTricks++;
    return _endTrick();
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
const legalPlays = g("legalPlays");
const onCardClick = g("onCardClick");
const onPlayClick = g("onPlayClick");
const onPassClick = g("onPassClick");
const onGiveClick = g("onGiveClick");

const rnd = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rnd(a.length)];
const cov = { games: 0, rounds: 0, revolutions: 0, forced: 0, trumps: 0, offenders: 0, humanGives: 0 };

/* ---------------------------------------------------- 1. Parties complètes */
function checkConservation(where) {
  const uids = new Set();
  let total = 0;
  const add = (c) => { uids.add(c.uid); total++; };
  S.players.forEach((p) => p.hand.forEach(add));
  S.played.forEach(add);
  S.aside.forEach(add);
  okOnce(total === 52 && uids.size === 52, `52 cartes distinctes à tout instant (${where} : ${total}/${uids.size})`);
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
  const legal = legalPlays(0);
  okOnce(legal.every((m) => canPlayCards(m, 0)), "legalPlays ne propose que des coups légaux");
  if (S.trick.rank === null) {
    const before = S.current;
    onPassClick();
    okOnce(S.current === before && S.phase === "play", "on ne passe pas en ouverture");
  }
  const smart = Math.random() < 0.5;
  let move = smart ? g("simplePolicy").play(me, 0) : (legal.length && (S.trick.rank === null || Math.random() < 0.7) ? pick(legal) : null);
  if (!move) { onPassClick(); return; }
  S.sel = new Set(move.map((c) => c.uid));
  onPlayClick();
}

async function playGame(n, level, variants) {
  g(`chosenPlayers = ${n}; chosenLevel = ${JSON.stringify(level)}; chosenFormat = "short";
     Object.assign(chosenVariants, ${JSON.stringify(variants)});`);
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
    if (S.revolution) okOnce(g("VAR").revolution, "pas de révolution sans la variante");
    if (S.trick.forcedSeat !== null) cov.forced++;
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
  const V = g("VAR");
  checkConservation("fin de manche");
  const illegal = g("globalThis._illegal");
  ok(illegal.length === 0, `toutes les poses étaient légales et au bon joueur (${JSON.stringify(illegal[0] || "")})`);
  g("globalThis._illegal = []");
  ok(g("globalThis._badTricks") === 0, "un pli ne se ramasse que quand tous les autres ont passé");

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
     "ceux qui finissent sur un 2 sont relégués en bas du classement");
  if (S.offenders.length) { cov.offenders += S.offenders.length; okOnce(V.noTwoFinish, "pas de relégation sans la variante"); }
  const holders = S.players.filter((p) => p.hand.length > 0).length;
  ok(holders <= 1, "la manche s'arrête quand un seul joueur a encore des cartes");

  // Donne, échanges et premier joueur, vérifiés sur l'état relevé par startRound.
  const r = g("globalThis._rounds").at(-1);
  const per = Math.floor(52 / n);
  ok(r.sizes.every((s) => s === per) && r.aside === 52 - per * n,
     `donne égale de ${per} cartes, ${52 - per * n} écartée(s)`);
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
       "le Trou du cul donne ses 2 meilleures cartes au Président");
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
  ok(S.target === (n - 1) * (V.long ? 6 : 3), "objectif proportionnel au nombre de joueurs");
  ok(g("globalThis._peeks") === 0, "aucune IA ne lit la main d'un autre joueur");
}

/* ============== 2. Cas ciblés — synchrones, IA neutralisées ============== */
function targetedTests() {
  g("aiTurn = async function () {};");

  const clashes = globalClashes("trou-du-cul.html");
  ok(clashes.length === 0, `aucun nom de premier niveau ne masque une propriété de window (${clashes.join(", ")})`);

  const deck = g("buildDeck()");
  ok(deck.length === 52, "le paquet compte 52 cartes");
  ok([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].every((r) => deck.filter((c) => c.rank === r).length === 4),
     "treize valeurs du 3 au 2, quatre couleurs chacune");

  /* Table posée à la main. Seul le siège 0 se pilote au clic ; les autres
     jouent par doPlay/doPass. Tous humains : rien ne part en asynchrone. */
  const C = (spec) => mkCard(spec.slice(-1), Number(spec.slice(0, -1)));      // "9P", "15C" (le 2)
  const table = (n, variants, hands) => {
    g(`chosenPlayers = ${n}; Object.assign(chosenVariants, { revolution: false, equal: false, trump: false, noTwoFinish: false }, ${JSON.stringify(variants)});`);
    byId.get("btnStart").click();
    byId.get("scoreOverlay").hidden = true;
    S.players.forEach((p, i) => { p.ai = false; p.role = null; p.hand = hands[i].map(C); });
    S.played = []; S.aside = [];
    S.trick = g("emptyTrick()"); S.lastTrick = null; S.passed = new Set();
    S.finished = []; S.offenders = []; S.revolution = false;
    S.busy = false; S.current = 0; S.phase = "play";
  };
  const doPlay = (seat, specs) => g("doPlay")(seat, specs.map((s) => S.players[seat].hand.find((c) => `${c.rank}${c.suit}` === s)));
  const doPass = (seat) => g("doPass")(seat);
  const cards = (...specs) => specs.map(C);

  /* ------------------------------------------------------------- Légalité */
  table(4, {}, [["5P"], ["5C"], ["5K"], ["5T"]]);
  ok(canPlayCards(cards("9P"), 0) && canPlayCards(cards("9P", "9C", "9K"), 0), "ouverture : une ou plusieurs cartes de même valeur");
  ok(!canPlayCards(cards("9P", "10C"), 0), "ouverture : pas deux valeurs différentes");
  S.trick = { rank: 9, count: 2, by: 1, cards: [], forcedSeat: null };
  ok(canPlayCards(cards("10P", "10C"), 0), "une paire de 10 bat une paire de 9");
  ok(!canPlayCards(cards("8P", "8C"), 0), "une paire de 8 ne bat pas une paire de 9");
  ok(!canPlayCards(cards("10P"), 0) && !canPlayCards(cards("10P", "10C", "10K"), 0), "il faut poser autant de cartes");
  ok(!canPlayCards(cards("9K", "9T"), 0), "sans variante, la même valeur ne suffit pas");
  ok(!canPlayCards(cards("15P"), 0), "sans variante, un 2 seul ne bat pas une paire");
  S.trick = { rank: 14, count: 1, by: 1, cards: [], forcedSeat: null };
  ok(canPlayCards(cards("15P"), 0) && !canPlayCards(cards("13P"), 0), "le 2 bat l'As, le Roi non");

  g("VAR").equal = true;
  S.trick = { rank: 9, count: 2, by: 1, cards: [], forcedSeat: 0 };
  ok(canPlayCards(cards("9K", "9T"), 0), "même valeur : le joueur visé peut reposer la même valeur");
  ok(!canPlayCards(cards("10K", "10T"), 0), "même valeur : le joueur visé ne peut pas monter");
  g("VAR").equal = false;

  g("VAR").trump = true;
  S.trick = { rank: 9, count: 3, by: 1, cards: [], forcedSeat: null };
  ok(canPlayCards(cards("15P"), 0), "2 en atout : un 2 seul bat un brelan");
  S.trick = { rank: 15, count: 2, by: 1, cards: [], forcedSeat: null };
  ok(!canPlayCards(cards("15K"), 0), "2 en atout : un 2 seul ne bat pas une paire de 2");
  S.revolution = true;
  S.trick = { rank: 9, count: 2, by: 1, cards: [], forcedSeat: null };
  ok(!canPlayCards(cards("15P"), 0), "2 en atout : sans effet pendant une révolution");
  g("VAR").trump = false;
  ok(canPlayCards(cards("8P", "8C"), 0) && !canPlayCards(cards("10P", "10C"), 0), "révolution : l'ordre est inversé");
  S.trick = { rank: 3, count: 1, by: 1, cards: [], forcedSeat: null };
  ok(!canPlayCards(cards("15P"), 0), "révolution : le 3 est la plus forte, le 2 la plus faible");
  S.revolution = false;

  /* ---------------------------------------------------------- Déroulé d'un pli */
  table(4, {}, [["5P", "5C", "12P", "13P"], ["7P", "7C", "3K", "4K"], ["9P", "3C", "4C", "6C"], ["10P", "3T", "4T", "6T"]]);
  const before = S.players[0].hand.length;
  onPassClick();
  ok(S.current === 0 && S.players[0].hand.length === before, "on ne peut pas passer en ouverture");
  onCardClick(S.players[0].hand.find((c) => c.rank === 5).uid);
  onCardClick(S.players[0].hand.find((c) => c.rank === 5 && !S.sel.has(c.uid)).uid);
  onPlayClick();
  ok(S.trick.rank === 5 && S.trick.count === 2 && S.current === 1, "la paire ouverte passe la main au suivant");
  doPlay(1, ["7P", "7C"]);
  doPass(2);
  doPass(3);
  ok(S.current === 0 && S.trick.rank === 7, "le pli continue tant que tous n'ont pas passé");
  onCardClick(S.players[0].hand.find((c) => c.rank === 12).uid);
  ok(S.sel.size === 0, "pour suivre une paire, un clic ne sélectionne rien sans paire de cette valeur");
  onPassClick();
  ok(S.trick.rank === null && S.current === 1 && S.lastTrick.by === 1,
     "tous les autres ont passé : le dernier à avoir posé ramasse et rouvre");

  table(4, {}, [["5P", "12P", "13P"], ["7P", "9C", "3K"], ["6P", "3C"], ["8P", "3T"]]);
  onCardClick(S.players[0].hand.find((c) => c.rank === 5).uid);
  onPlayClick();
  doPass(1);
  doPlay(2, ["6P"]);
  doPass(3);
  onCardClick(S.players[0].hand.find((c) => c.rank === 12).uid);
  onPlayClick();
  ok(S.current === 1, "après avoir passé, on rejoue quand son tour revient");
  doPlay(1, ["9C"]);
  ok(S.trick.rank === 9 && S.passed.size === 0, "un joueur qui avait passé peut monter plus tard dans le pli");

  table(4, {}, [["5P", "12P"], ["7P"], ["6P", "3C"], ["8P", "3T"]]);
  onCardClick(S.players[0].hand.find((c) => c.rank === 5).uid);
  onPlayClick();
  doPlay(1, ["7P"]);
  ok(S.finished.join() === "1", "poser sa dernière carte fait sortir");
  doPass(2); doPass(3); onPassClick();
  ok(S.trick.rank === null && S.current === 2, "le pli d'un joueur sorti revient à son voisin");

  /* ------------------------------------------------------- Fin de manche */
  table(4, {}, [["5P"], ["7P", "3C"], ["6P", "4C"], ["8P", "3T"]]);
  onCardClick(S.players[0].hand[0].uid);
  onPlayClick();                                   // 1er : Président
  doPass(1); doPlay(2, ["6P"]); doPass(3); doPass(1);
  doPlay(2, ["4C"]);                               // 2e : Vice-président
  doPlay(3, ["8P"]); doPass(1);                    // pli pour 3, qui rouvre
  doPlay(3, ["3T"]);                               // 3e : reste le siège 1
  ok(S.phase === "over", "la manche s'arrête quand il ne reste qu'un joueur avec des cartes");
  ok(S.order.join() === "0,2,3,1", `classement dans l'ordre de sortie (${S.order.join()})`);
  ok(S.players.map((p) => p.role).join() === "P,T,VP,VT", "Président, Vice-président, Vice-trou du cul, Trou du cul");
  ok(S.players.map((p) => p.gain).join() === "3,0,2,1", "points : 3, 2, 1, 0 à quatre joueurs");

  table(4, { noTwoFinish: true }, [["15P"], ["7P", "3C"], ["6P", "4C"], ["8P", "3T"]]);
  onCardClick(S.players[0].hand[0].uid);
  onPlayClick();
  ok(S.offenders.join() === "0" && S.finished.length === 0, "finir sur un 2 est relevé");
  ok(S.current === 1 && S.trick.rank === 15, "le pli continue sans le joueur sorti");

  table(5, { noTwoFinish: true }, [["15P"], ["7P", "3C"], ["6P"], ["8P", "3T"], ["9P", "4T"]]);
  onCardClick(S.players[0].hand[0].uid);
  onPlayClick();
  doPass(1); doPass(2); doPass(3); doPass(4);
  doPlay(1, ["7P"]); doPass(2); doPass(3); doPass(4);
  ok(S.current === 1, "pli ramassé");
  doPlay(1, ["3C"]);
  doPlay(2, ["6P"]);
  doPass(3); doPass(4);
  doPlay(3, ["3T"]);
  doPlay(4, ["4T"]);
  doPlay(3, ["8P"]);
  ok(S.phase === "over", "la manche finit quand le dernier sortant laisse un seul joueur");
  ok(S.order.at(-1) === 0 && S.players[0].role === "T",
     `qui finit sur un 2 est Trou du cul d'office, même sorti le premier (${S.order.join()})`);

  /* ------------------------------------------------------------- Révolution */
  table(4, { revolution: true }, [["9P", "9C", "9K", "9T", "3P"], ["5P", "5C", "5K", "5T", "4C"], ["6P"], ["7P"]]);
  onCardClick(S.players[0].hand[0].uid);
  S.sel = new Set(S.players[0].hand.filter((c) => c.rank === 9).map((c) => c.uid));
  onPlayClick();
  ok(S.revolution, "un carré déclenche la révolution");
  ok(canPlayCards(S.players[1].hand.filter((c) => c.rank === 5), 1), "pendant la révolution, un carré plus faible bat le carré");
  doPlay(1, ["5P", "5C", "5K", "5T"]);
  ok(!S.revolution, "un second carré fait la contre-révolution");

  /* ------------------------------------------------------------ Même valeur */
  table(4, { equal: true }, [["9P", "3P"], ["9C", "4C"], ["9K", "5K"], ["10T", "6T"]]);
  onCardClick(S.players[0].hand.find((c) => c.rank === 9).uid);
  onPlayClick();
  doPlay(1, ["9C"]);
  ok(S.trick.forcedSeat === 2, "même valeur : le joueur suivant est visé");
  ok(!canPlayCards(S.players[2].hand.filter((c) => c.rank === 5), 2), "le joueur visé ne peut pas monter autrement");
  doPass(2);
  ok(S.trick.forcedSeat === null && S.current === 3, "après sa passe, le jeu reprend normalement");
  ok(canPlayCards(S.players[3].hand.filter((c) => c.rank === 10), 3), "le suivant monte comme d'habitude");

  /* ------------------------------------------------------------ Échanges */
  table(4, {}, [["3P"], ["3C"], ["3K"], ["3T"]]);
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
    table(4, {}, [["3P"], ["5P", "5C", "9K", "14T"], ["3C"], ["3K"]]);
    S.current = 1;
    const p = S.players[1];
    const lead = pol.play(p, 1);
    ok(!!lead && canPlayCards(lead, 1), `${level} : ouvre avec un coup légal`);
    S.trick = { rank: 8, count: 1, by: 0, cards: [], forcedSeat: null };
    const follow = pol.play(p, 1);
    ok(follow === null || canPlayCards(follow, 1), `${level} : suit avec un coup légal ou passe`);
    S.trick = { rank: 14, count: 2, by: 0, cards: [], forcedSeat: null };
    ok(pol.play(p, 1) === null, `${level} : passe quand rien ne monte`);
    const give = pol.give(p, 2);
    ok(give.length === 2 && give.every((c) => p.hand.includes(c)), `${level} : rend deux cartes de sa main`);
  }
  table(4, { noTwoFinish: true }, [["3P"], ["15P", "7C"], ["3C"], ["3K"]]);
  const lead = g("sharpPolicy").play(S.players[1], 1);
  ok(lead.length === 1 && lead[0].rank === 15, "redoutable : joue son 2 avant sa dernière carte quand finir sur un 2 est interdit");
}

/* ------------------------------------------------------------------ Main */
(async () => {
  const t0 = Date.now();
  const none = { revolution: false, equal: false, trump: false, noTwoFinish: false };
  const all = { revolution: true, equal: true, trump: true, noTwoFinish: true };
  const scenarios = [
    [4, "sharp", none], [5, "simple", none], [6, "sharp", none],
    [4, "simple", all], [5, "sharp", all], [6, "simple", all],
    [4, "sharp", { ...none, revolution: true }], [5, "sharp", { ...none, equal: true }],
    [4, "sharp", { ...none, trump: true }], [6, "sharp", { ...none, noTwoFinish: true }],
  ];
  for (const [n, level, v] of scenarios) for (let i = 0; i < 3; i++) await playGame(n, level, v);
  targetedTests();
  cov.revolutions = g("globalThis._revolutions");
  cov.trumps = g("globalThis._trumps");
  console.log("Couverture :", JSON.stringify(cov), `(${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  report("Trou du cul");
})();
