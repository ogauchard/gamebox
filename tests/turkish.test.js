/* Turkish — règles du jeu, vérifiées en jouant des parties complètes.
 * Lancer : node tests/turkish.test.js
 *
 * Deux parties dans ce fichier :
 *   1. des parties complètes à 4 joueurs, sous invariants : conservation des
 *      56 cartes, légalité de chaque pose au moment où elle a lieu, carte montrée
 *      pour ramasser, sens du jeu, fin de donne, points, ouverture tournante ;
 *   2. des cas ciblés et **synchrones**, tours d'IA neutralisés.
 */
"use strict";

const { loadTurkish, checker, globalClashes } = require("./harness");

const { g, S, byId, tick } = loadTurkish();
const { ok, okOnce, report } = checker();

/* Instrumentation : chaque pose, chaque carte cachée, chaque ramassage est
   vérifié à l'instant où il a lieu. */
g(`
  globalThis._bad = [];
  globalThis._cov = { sweeps: 0, pickups: 0, shown7: 0, blindOk: 0, blindKo: 0, reversals: 0, passes: 0, blindTenOut: 0 };
  const _flip = (before, k) => (k % 2 ? -before : before);

  const _doPlay = doPlay;
  doPlay = function (seat, cards) {
    const p = S.players[seat];
    const fromUp = cards.every((c) => p.up.includes(c));
    if (seat !== S.current || !canPlayCards(seat, cards)) globalThis._bad.push({ play: cards.map(cardLabel), seat, current: S.current });
    if (fromUp && !p.started) globalThis._bad.push({ upBeforeStart: seat });
    if (cards[0].rank === TEN && total(p) <= cards.length) globalThis._bad.push({ lastTen: seat });
    if (cards[0].rank === TEN) globalThis._cov.sweeps++;
    const dir = S.dir, sevens = cards.filter(isSevenD).length;
    if (sevens) globalThis._cov.reversals++;
    _doPlay(seat, cards);
    if (S.phase !== "over" && S.dir !== _flip(dir, sevens)) globalThis._bad.push({ dir: seat });
  };

  const _doBlind = doBlind;
  doBlind = function (seat, idx) {
    const p = S.players[seat];
    if (seat !== S.current || !downAllowed(p)) globalThis._bad.push({ blind: seat, current: S.current });
    const top = S.top, before = p.hand.length + S.pile.length;
    const card = p.down[Math.min(idx || 0, p.down.length - 1)];
    const passes = card.rank === TEN || top === null || card.rank <= top.rank;
    passes ? globalThis._cov.blindOk++ : globalThis._cov.blindKo++;
    if (card.rank === TEN && total(p) === 1) globalThis._cov.blindTenOut++;
    _doBlind(seat, idx);
    // Une carte qui ne passe pas part dans la main avec tout le pli.
    if (!passes && S.phase !== "over" && !p.hand.includes(card)) globalThis._bad.push({ blindKoLost: seat });
    if (!passes && S.phase !== "over" && p.hand.length !== before + 1) globalThis._bad.push({ blindKoCount: seat });
  };

  const _doPickup = doPickup;
  doPickup = function (seat, shown) {
    const p = S.players[seat];
    if (seat !== S.current || !S.pile.length) globalThis._bad.push({ pickup: seat, current: S.current, pile: S.pile.length });
    if (p.hand.length && !p.hand.includes(shown)) globalThis._bad.push({ noShow: seat });
    globalThis._cov.pickups++;
    const dir = S.dir, n = S.pile.length, h = p.hand.length;
    if (shown && isSevenD(shown)) globalThis._cov.shown7++;
    _doPickup(seat, shown);
    if (S.phase !== "over") {
      if (S.dir !== _flip(dir, shown && isSevenD(shown) ? 1 : 0)) globalThis._bad.push({ pickupDir: seat });
      if (p.hand.length !== h + n) globalThis._bad.push({ pickupCount: seat });
    }
  };

  const _log = log;
  log = function (m) { if (/la main passe/.test(m)) globalThis._cov.passes++; _log(m); };

  globalThis._starts = [];
  const _startRound = startRound;
  startRound = function () {
    _startRound();
    globalThis._starts.push({ round: S.round, starter: S.starter, n: nplayers() });
  };
`);

/* Les politiques n'ont droit qu'à l'information publique : pendant chaque
   décision, les mains des autres et les cartes cachées de tous — les siennes
   comprises — deviennent des Proxy qui comptent tout accès par indice ou par
   itération (\`length\` reste libre). */
g(`
  globalThis._peeks = 0;
  const _policyOf = policyOf;
  policyOf = function (p) {
    const pol = _policyOf(p);
    const wrapped = {};
    for (const k of Object.keys(pol)) {
      wrapped[k] = (...args) => {
        const spy = (arr) => new Proxy(arr, {
          get(t, prop) {
            if (typeof prop === "symbol" || /^[0-9]+$/.test(prop)) globalThis._peeks++;
            return Reflect.get(t, prop);
          },
        });
        const saved = S.players.map((q) => [q.hand, q.down]);
        for (const q of S.players) {
          if (q !== p) q.hand = spy(q.hand);
          q.down = spy(q.down);
        }
        try { return pol[k](...args); }
        finally { S.players.forEach((q, i) => { [q.hand, q.down] = saved[i]; }); }
      };
    }
    return wrapped;
  };
`);

const mkCard = g("mkCard");
const canPlayCards = g("canPlayCards");
const legalSets = g("legalSets");
const cardPoints = g("cardPoints");
const total = g("total");
const onCardClick = g("onCardClick");
const onPlayClick = g("onPlayClick");
const onPickupClick = g("onPickupClick");
const onDownClick = g("onDownClick");
const TEN = g("TEN");

const rnd = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rnd(a.length)];
const cov = { games: 0, rounds: 0, humanOut: 0, aiOut: 0, capped: 0, humanShows: 0 };

/* ---------------------------------------------------- 1. Parties complètes */
function checkConservation(where) {
  const uids = new Set();
  let n = 0;
  const add = (c) => { uids.add(c.uid); n++; };
  for (const p of S.players) [...p.hand, ...p.up, ...p.down].forEach(add);
  S.pile.forEach(add);
  S.out.forEach(add);
  okOnce(n === 56 && uids.size === 56, `56 cartes distinctes à tout instant (${where} : ${n}/${uids.size})`);
}

/* Le siège 0 joue au hasard parmi ce que l'interface lui permet, par les clics. */
function humanAct() {
  const me = S.players[0];
  if (S.phase === "show") { cov.humanShows++; onCardClick("hand", pick(me.hand).uid); return; }
  const sets = legalSets(0);
  const options = [];
  if (sets.length) options.push("play", "play", "play", "play");
  if (me.up.length === 0 && me.down.length) options.push("blind");
  if (S.pile.length) options.push(sets.length ? "pickupRare" : "pickup");
  const choice = pick(options);
  if (choice === "play") {
    const set = pick(sets);
    const zone = me.hand.includes(set[0]) ? "hand" : "up";
    for (const c of set.slice(0, 1 + rnd(set.length))) onCardClick(zone, c.uid);
    onPlayClick();
  } else if (choice === "blind") {
    onDownClick(rnd(me.down.length));
  } else if (choice === "pickup" || Math.random() < 0.15) {
    onPickupClick();
    if (S.phase === "show") { cov.humanShows++; onCardClick("hand", pick(me.hand).uid); }
  } else if (sets.length) {
    const set = pick(sets);
    for (const c of set) onCardClick(me.hand.includes(set[0]) ? "hand" : "up", c.uid);
    onPlayClick();
  }
}

async function playGame(level, rounds) {
  g(`chosenRounds = ${rounds}`);
  byId.get("btnStart").click();
  okOnce(S.players.length === 4 && S.players.slice(1).every((p) => p.ai && p.policy === "sharp"),
         "l'écran de départ lance 4 joueurs, adversaires « sharp » (Redoutable)");
  okOnce(S.rounds === rounds, "la durée choisie fixe le nombre de donnes");
  okOnce(S.players.every((p) => p.down.length === 3 && p.up.length === 3 && p.hand.length === 8),
         "chacun reçoit 3 cachées, 3 visibles et 8 cartes en main");
  checkConservation("distribution");
  if (level !== "sharp") S.players.slice(1).forEach((p) => { p.policy = level; });
  let guard = 0;
  while (guard++ < 500000) {
    await tick();
    if (S.phase === "over") {
      checkRound();
      if (byId.get("btnNext").dataset.over) { cov.games++; return; }
      byId.get("btnNext").click();
      if (level !== "sharp") S.players.slice(1).forEach((p) => { p.policy = level; });
      continue;
    }
    if (S.busy || S.current !== 0) continue;
    if (S.phase === "play" || S.phase === "show") {
      checkConservation("décision humaine");
      humanAct();
    }
  }
  ok(false, "la partie se termine sans blocage (garde-fou de boucle atteint)");
}

function checkRound() {
  cov.rounds++;
  checkConservation("fin de donne");
  const bad = g("globalThis._bad");
  ok(bad.length === 0, `chaque pose, carte cachée et ramassage était légal et au bon joueur (${JSON.stringify(bad[0] || "")})`);
  g("globalThis._bad = []");
  ok(g("globalThis._peeks") === 0, "aucune IA ne lit la main d'un autre joueur ni une carte cachée");

  if (S.roundTurns >= g("TURN_CAP")) { cov.capped++; return; }
  const f = S.finisher;
  ok(f !== null && total(S.players[f]) === 0, "la donne s'arrête quand un joueur n'a plus aucune carte");
  f === 0 ? cov.humanOut++ : cov.aiOut++;
  okOnce(S.players.every((p, i) => i === f || total(p) > 0), "un seul joueur sort : on ne finit pas le tour");
  for (const [i, p] of S.players.entries()) {
    const left = [...p.hand, ...p.up, ...p.down].reduce((t, c) => t + cardPoints(c), 0);
    okOnce(p.last === (i === f ? 0 : left), "chaque perdant compte ce qui lui reste, main, visibles et cachées");
    okOnce(p.score === p.rounds.reduce((a, b) => a + b, 0), "cumul des points cohérent");
  }
  const st = g("globalThis._starts").at(-1);
  okOnce(st.starter === (st.round - 1) % st.n, "l'ouverture tourne : toi à la 1re donne, puis le suivant");
  ok(!!byId.get("btnNext").dataset.over === (S.round >= S.rounds), "la partie s'arrête après le nombre de donnes choisi");
}

/* ============== 2. Cas ciblés — synchrones, IA neutralisées ============== */
function targetedTests() {
  g("aiTurn = async function () {};");

  const clashes = globalClashes("turkish.html");
  ok(clashes.length === 0, `aucun nom de premier niveau ne masque une propriété de window (${clashes.join(", ")})`);

  const deck = g("buildDeck()");
  ok(deck.length === 56, "jeu de tarot sans les atouts : 56 cartes");
  ok([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].every((r) => deck.filter((c) => c.rank === r).length === 4),
     "quatorze valeurs, de l'As au 2 avec un Cavalier, quatre couleurs chacune");
  const pts = (spec) => cardPoints(C(spec));
  ok(pts("14C") === 10 && pts("13P") === 10 && pts("12K") === 10 && pts("11T") === 10, "les figures valent 10 points");
  ok(pts("10P") === 20, "le 10 vaut 20 points");
  ok(pts("15P") === 5 && pts("9C") === 5 && pts("2T") === 5, "les autres cartes, As compris, valent 5 points");

  /* Table posée à la main, tous les sièges humains : le moteur résout chaque
     coup de façon synchrone. Cartes : "9P", "12C" (Cavalier), "15K" (As), "7K" (7♦). */
  function table(spec) {
    g("startGame")(4);
    byId.get("scoreOverlay").hidden = true;
    S.players.forEach((p, i) => {
      const t = spec[i] || {};
      p.ai = false;
      p.hand = (t.hand || ["3P"]).map(C);
      p.up = (t.up || []).map(C);
      p.down = (t.down || []).map(C);
      p.started = t.started !== false;
      p.known = new Set();
      p.score = 0; p.rounds = [];
    });
    S.pile = []; S.top = null; S.last = null; S.out = []; S.dir = 1;
    S.current = 0; S.phase = "play"; S.busy = false; S.roundTurns = 0; S.finisher = null;
    S.sel = new Set(); S.selZone = null;
  }
  const pile = (specs, by = 3) => { S.pile = specs.map(C); S.top = { rank: S.pile.at(-1).rank, count: 1, by }; };
  const find = (seat, zone, spec) => S.players[seat][zone].find((c) => `${c.rank}${c.suit}` === spec);
  const play = (seat, zone, specs) => g("doPlay")(seat, specs.map((s) => find(seat, zone, s)));

  /* --------------------------------------------------------- Descendre */
  table([{ hand: ["12P", "9C", "13T", "15K", "10P", "9P"] }]);
  pile(["12C"]);
  const me = () => S.players[0];
  ok(canPlayCards(0, [find(0, "hand", "12P")]), "même valeur que la carte à descendre : permis");
  ok(canPlayCards(0, [find(0, "hand", "9C")]), "valeur inférieure : permis");
  ok(!canPlayCards(0, [find(0, "hand", "13T")]) && !canPlayCards(0, [find(0, "hand", "15K")]), "valeur supérieure : refusé");
  ok(canPlayCards(0, [find(0, "hand", "10P")]), "un 10 se pose sur n'importe quoi");
  ok(canPlayCards(0, ["9C", "9P"].map((s) => find(0, "hand", s))), "plusieurs cartes de même valeur ensemble : permis");
  ok(!canPlayCards(0, ["9C", "12P"].map((s) => find(0, "hand", s))), "valeurs différentes ensemble : refusé");

  table([{ hand: ["9C", "5P"], up: ["9P", "4K"], started: false }]);
  ok(!canPlayCards(0, [find(0, "up", "9P")]), "la première carte de la donne vient de la main : visibles refusées");
  me().started = true;
  ok(canPlayCards(0, [find(0, "up", "9P")]), "après sa première carte, les visibles se jouent à tout moment");
  ok(!canPlayCards(0, [find(0, "hand", "9C"), find(0, "up", "9P")]), "main et visibles mélangées dans une même pose : refusé");
  onDownClick(0);
  ok(S.current === 0 && me().down.length === 0 && S.pile.length === 0, "cartes cachées : refusées tant qu'il reste des visibles");

  /* --------------------------------------------------------- Balayette */
  table([{ hand: ["10P", "5P"] }, { hand: ["8P"] }]);
  pile(["13P", "11C", "9K"]);
  onCardClick("hand", find(0, "hand", "10P").uid);
  onPlayClick();
  ok(S.pile.length === 0 && S.out.length === 4, "balayette : le pli et le 10 sortent du jeu");
  ok(S.current === 0 && S.top === null, "balayette : celui qui balaie rouvre");
  table([{ hand: ["10P", "5P"] }]);
  play(0, "hand", ["10P"]);
  ok(S.out.length === 1 && S.current === 0, "un 10 sur un pli vide ne balaie rien, mais il est écarté et on rejoue");

  /* -------------------------------------------- Pas de sortie sur un 10 */
  table([{ hand: ["10P"] }, { hand: ["6P", "8C"] }]);
  pile(["5C"], 1);
  ok(!canPlayCards(0, [find(0, "hand", "10P")]), "son dernier 10 ne se joue pas");
  ok(legalSets(0).length === 0, "face à un pli, avec seulement un 10 : rien à poser, il faut ramasser");
  table([{ hand: ["10P", "10C"] }, { hand: ["6P", "8C"] }]);
  ok(canPlayCards(0, [find(0, "hand", "10P")]) && !canPlayCards(0, ["10P", "10C"].map((s) => find(0, "hand", s))),
     "deux 10 : on peut en poser un, pas les deux");
  table([{ hand: ["10P"] }, { hand: ["6P", "8C"] }, { hand: ["4P"] }, { hand: ["5T", "9T"] }]);
  g("beginTurn")();                             // pli vide, seulement un 10 : rien à ouvrir
  ok(S.current === 1 && S.phase === "play" && S.players[0].hand.length === 1,
     "ouvrir avec seulement des 10 : la main passe au suivant, le 10 reste en main");

  table([{ hand: [], up: [], down: ["10C"] }, { hand: ["6P"] }]);
  pile(["5C"], 1);
  onDownClick(0);
  ok(S.phase === "over" && S.finisher === 0, "un 10 caché retourné en dernière carte balaie et fait sortir");

  /* ------------------------------------------------------------ Ramasser */
  table([{ hand: ["15P", "7K", "3C"] }, { hand: ["6P"] }, { hand: ["5T"] }, { hand: ["4T"] }]);
  pile(["2P", "2C"]);
  onPickupClick();
  ok(S.phase === "show" && S.pile.length === 2, "ramasser : il faut d'abord montrer une carte de sa main");
  g("onCancelShow")();
  ok(S.phase === "play", "on peut renoncer à ramasser avant d'avoir montré la carte");
  onPickupClick();
  onCardClick("hand", find(0, "hand", "3C").uid);
  ok(S.pile.length === 0 && me().hand.length === 5 && S.current === 0 && S.dir === 1,
     "la carte montrée reste en main, le pli la rejoint, et on rouvre");
  table([{ hand: ["15P", "7K"] }, { hand: ["6P"] }, { hand: ["5T"] }, { hand: ["4T"] }]);
  pile(["2P"]);
  onPickupClick();
  onCardClick("hand", find(0, "hand", "7K").uid);
  ok(S.dir === -1, "montrer le 7 de carreau pour ramasser inverse le sens");
  table([{ hand: [], up: [], down: ["4P", "5P"] }, { hand: ["6P"] }]);
  pile(["2P"]);
  onPickupClick();
  ok(S.phase === "play" && me().hand.length === 1 && S.pile.length === 0, "sans carte en main, on ramasse directement");
  table([{ hand: ["15P", "3C"] }, { hand: ["6P"] }]);
  pile(["13P"]);
  onPickupClick();
  onCardClick("hand", find(0, "hand", "15P").uid);
  ok(S.current === 0 && me().hand.length === 3, "ramasser volontairement est permis, même en pouvant descendre");

  /* ----------------------------------------------------------- 7 de carreau */
  table([{ hand: ["7K", "3C"] }, { hand: ["6P"] }, { hand: ["5T"] }, { hand: ["4T", "2T"] }]);
  pile(["9P"], 1);
  play(0, "hand", ["7K"]);
  ok(S.dir === -1 && S.current === 3, "le 7 de carreau inverse le sens : c'est au joueur d'avant de jouer");
  play(3, "hand", ["4T"]);
  ok(S.current === 2, "le sens reste inversé jusqu'au prochain 7 de carreau");

  /* --------------------------------------------------------- Cartes cachées */
  table([{ hand: ["3C"], up: [], down: ["6P", "13C"] }, { hand: ["6T"] }]);
  pile(["9P"], 1);
  onDownClick(0);
  ok(S.pile.length === 2 && S.top.rank === 6 && S.current === 1, "une carte cachée qui descend est posée");
  table([{ hand: ["3C"], up: [], down: ["13C", "6P"] }, { hand: ["6T"] }]);
  pile(["9P", "5K"], 1);
  onDownClick(0);
  ok(S.pile.length === 0 && me().hand.length === 4 && me().hand.some((c) => c.rank === 13) && S.current === 0,
     "une carte cachée qui ne passe pas est ramassée avec le pli, et on rouvre");

  /* ------------------------------------------------------------ Fin de donne */
  table([{ hand: ["4C"] }, { hand: ["10P", "13C"], up: ["15K"], down: ["2P"] }, { hand: ["9T", "9K"] }, { hand: ["5T"] }]);
  pile(["6P"], 3);
  play(0, "hand", ["4C"]);
  ok(S.phase === "over" && S.finisher === 0, "la donne s'arrête dès que le joueur pose sa dernière carte");
  ok(S.players[1].last === 20 + 10 + 5 + 5, "le perdant compte main, visibles et cachées (10 + figure + As + 2)");
  ok(S.players[2].last === 10 && S.players[3].last === 5 && S.players[0].last === 0, "points des autres perdants, 0 au gagnant");

  g("chosenRounds = 8");
  g("startGame")(4);
  ok(S.rounds === 8 && S.starter === 0, "partie en 8 donnes : la première, c'est toi qui ouvres");
  S.round = 2;
  g("startRound")();
  ok(S.starter === 1 && S.current === 1, "à la donne suivante, l'ouverture passe au joueur suivant");
  g("chosenRounds = 4");

  /* --------------------------------------------------------- Politiques d'IA */
  for (const level of ["simple", "sharp"]) {
    const pol = g(`${level}Policy`);
    table([{ hand: ["9P", "9C"] }, { hand: ["6P"] }]);
    S.players[0].ai = true; S.players[0].policy = level;
    if (level === "sharp") {
      const m = pol.play(S.players[0], 0);
      ok(m.kind === "play" && m.cards.length === 2, "sharp : sort dès qu'une pose vide tout son jeu");
    }
    table([{ hand: ["13P", "10C", "6K", "5K"] }, { hand: ["6P"] }]);
    pile(["4P"], 1);
    let m = pol.play(S.players[0], 0);
    ok(m.kind === "play" && m.cards[0].rank === TEN, `${level} : balaie quand il ne peut plus descendre`);
    table([{ hand: ["13P", "14K"], up: [], down: ["5P"] }, { hand: ["6P"] }]);
    pile(["4P"], 1);
    m = pol.play(S.players[0], 0);
    ok(m.kind === "blind", `${level} : coincé, tente une carte cachée plutôt que de ramasser`);
    table([{ hand: ["13P", "14K", "7K"] }, { hand: ["6P"] }]);
    pile(["4P"], 1);
    m = pol.play(S.players[0], 0);
    ok(m.kind === "pickup" && S.players[0].hand.includes(m.show), `${level} : ramasse en montrant une carte de sa main`);
  }

  const bad = g("globalThis._bad");
  ok(bad.length === 0, `cas ciblés : aucun coup illégal (${JSON.stringify(bad[0] || "")})`);
}

function C(spec) {
  const m = /^(\d+)([PCKT])$/.exec(spec);
  return mkCard(m[2], Number(m[1]));
}

/* ------------------------------------------------------------------ Main */
(async () => {
  const t0 = Date.now();
  for (let i = 0; i < 10; i++) await playGame("sharp", 4);
  for (let i = 0; i < 3; i++) await playGame("simple", 4);
  await playGame("sharp", 8);
  Object.assign(cov, g("globalThis._cov"));
  targetedTests();
  console.log("Couverture :", JSON.stringify(cov), `(${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  report("Turkish");
})();
