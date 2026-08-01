/* Uno — règles du jeu, vérifiées en jouant des parties complètes.
 * Lancer : node tests/uno.test.js
 *
 * Le siège humain est piloté par appels directs à onHandClick/onDrawClick/… ;
 * les adversaires jouent normalement, leurs temporisations étant réduites à
 * zéro par l'horloge du harnais.
 *
 * Deux parties dans ce fichier :
 *   1. des parties aléatoires sur chaque combinaison de variantes, sous
 *      invariants (conservation du paquet, légalité de chaque pose, décompte) ;
 *   2. des cas ciblés et **synchrones** que le hasard n'atteint pas de façon
 *      fiable — effets des cartes spéciales, cumul, contestation, 7-0.
 *      Ils neutralisent d'abord les tours d'IA : sans ça, une temporisation
 *      restée en vol viendrait muter l'état posé à la main.
 */
"use strict";

const { loadUno, checker, globalClashes } = require("./harness");

const { g, S, byId, tick } = loadUno();
const { ok, okOnce, report } = checker();

/* Instrumentation : légalité des poses, remélanges, honnêteté des IA.
   Les déclarations `function` de premier niveau sont sur l'objet global du
   contexte, donc remplaçables d'ici. */
g(`
  globalThis._plays = []; globalThis._reshuffles = 0;
  globalThis._peeks = 0; globalThis._blocked = 0;

  const _placeCard = placeCard;
  placeCard = function (p, card) {
    globalThis._plays.push({ kind: card.kind, legal: canPlay(card), pending: S.pending });
    return _placeCard(p, card);
  };

  const _drawOne = drawOne;
  drawOne = function (p) {
    if (S.draw.length === 0 && S.discard.length > 1) globalThis._reshuffles++;
    return _drawOne(p);
  };

  const _endBlocked = endBlockedRound;
  endBlockedRound = function () { globalThis._blocked++; return _endBlocked(); };
`);

/* Les politiques n'ont droit qu'à l'information publique. Le temps d'une
   décision, la main des *autres* joueurs devient un Proxy qui compte tout accès
   par indice ou par itération ; `length` reste libre, c'est public. */
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

const COLORS = g("COLORS");
const mkCard = g("mkCard");
const canPlay = g("canPlay");
const legalMoves = g("legalMoves");
const drawOne = g("drawOne");
const doChallenge = g("doChallenge");
const beginTurn = g("beginTurn");
const onHandClick = g("onHandClick");
const onDrawClick = g("onDrawClick");
const onPassClick = g("onPassClick");
const onTakeClick = g("onTakeClick");
const onColorPick = g("onColorPick");
const onChallengeClick = g("onChallengeClick");
const onSubmitClick = g("onSubmitClick");
const onSwapPick = g("onSwapPick");

const cov = { rounds: 0, stacks: 0, challenges: 0, swaps: 0, rotations: 0, opens: {} };
const rnd = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rnd(a.length)];

/* ------------------------------------------------------------ Invariants */
/* Signature d'une carte, indépendante de son uid : sert au multiset. */
const sig = (c) => `${c.color || "W"}-${c.kind}${c.kind === "num" ? c.n : ""}`;

const refCount = new Map();
for (const c of g("buildDeck()")) refCount.set(sig(c), (refCount.get(sig(c)) || 0) + 1);

/* Les 108 cartes sont conservées à tout instant, et chaque exemplaire garde son
   uid : sans ça, un échange de mains (règle du 7) pourrait dupliquer une carte
   sans que le multiset s'en aperçoive. */
function checkConservation(where) {
  const c = new Map();
  const uids = new Set();
  let total = 0, dup = 0;
  const add = (x) => {
    c.set(sig(x), (c.get(sig(x)) || 0) + 1);
    if (uids.has(x.uid)) dup++;
    uids.add(x.uid);
    total++;
  };
  for (const x of S.draw) add(x);
  for (const x of S.discard) add(x);
  for (const p of S.players) for (const x of p.hand) add(x);

  okOnce(total === 108, `108 cartes en jeu à tout instant (${where} : ${total})`);
  okOnce(dup === 0, `aucune carte dupliquée (${where} : ${dup})`);
  for (const [k, n] of refCount) {
    okOnce(c.get(k) === n, `multiset préservé pour ${k} (${where} : ${c.get(k)} au lieu de ${n})`);
  }
}

function checkState(where) {
  okOnce(S.current >= 0 && S.current < S.players.length, `joueur courant valide (${where})`);
  okOnce(S.dir === 1 || S.dir === -1, `sens du jeu valide (${where})`);
  okOnce(S.pending >= 0, `pénalité en attente jamais négative (${where})`);
  okOnce(S.color === null || COLORS.includes(S.color), `couleur active valide (${where})`);
  okOnce(S.discard.length > 0, `la défausse n'est jamais vide en cours de manche (${where})`);
}

/* ------------------------------------------------- Pilotage du siège humain */
async function humanAct() {
  const me = S.players[0];
  if (S.phase === "play") {
    const legal = legalMoves(me);
    // 8 % de pioches volontaires : c'est légal, et ça couvre la branche.
    if (legal.length && Math.random() < 0.92) onHandClick(pick(legal).uid);
    else await onDrawClick();
  } else if (S.phase === "drawn") {
    if (Math.random() < 0.8) onHandClick(S.drawn.uid);
    else onPassClick();
  } else if (S.phase === "color") {
    onColorPick(pick(COLORS));
  } else if (S.phase === "stack") {
    const legal = legalMoves(me);
    okOnce(legal.every((c) => c.kind === "draw2" || c.kind === "wild4"),
           "cumul : seuls un +2 ou un +4 peuvent surenchérir");
    if (legal.length && Math.random() < 0.7) { cov.stacks++; onHandClick(pick(legal).uid); }
    else onTakeClick();
  } else if (S.phase === "challenge") {
    if (Math.random() < 0.5) { cov.challenges++; onChallengeClick(); }
    else onSubmitClick();
  } else if (S.phase === "swap") {
    cov.swaps++;
    onSwapPick(1 + rnd(S.players.length - 1));
  }
}

/* --------------------------------------------------------- Partie complète */
function start(sc) {
  g(`chosenPlayers = ${sc.n};
     chosenLevel = ${JSON.stringify(sc.level)};
     chosenFormat = ${JSON.stringify(sc.format)};
     chosenVariants.stack = ${!!sc.vars.stack};
     chosenVariants.challenge = ${!!sc.vars.challenge};
     chosenVariants.sevenZero = ${!!sc.vars.sevenZero};`);
  byId.get("btnStart").click();
}

async function playGame(sc) {
  start(sc);
  const label = `${sc.n} joueurs / ${sc.level}`;

  okOnce(S.players.length === sc.n, `partie à ${sc.n} joueurs`);
  okOnce(S.discard.length === 1, "une seule carte ouvre la défausse");
  cov.opens[S.discard[0].kind] = (cov.opens[S.discard[0].kind] || 0) + 1;
  checkConservation("distribution " + label);

  let guard = 0;
  while (guard++ < 300000) {
    await tick();

    if (S.phase === "over") {
      checkRound();
      if (byId.get("btnNext").dataset.over) return;
      byId.get("btnNext").click();
      continue;
    }
    if (S.busy || S.current !== 0) continue;   // un adversaire joue, ou révélation en cours

    checkState("tour humain");
    checkConservation("tour humain");
    await humanAct();
  }
  ok(false, "la partie se termine sans blocage (garde-fou atteint)");
}

/* --------------------------------------------------- Contrôle d'une manche */
const valueOf = (c) => (c.kind === "num" ? c.n : c.kind === "wild" || c.kind === "wild4" ? 50 : 20);
const handWorth = (p) => p.hand.reduce((n, c) => n + valueOf(c), 0);

let blockedSeen = 0;

function checkRound() {
  const wi = S.winner;
  ok(wi !== null && wi >= 0, "une manche a toujours un gagnant");
  const winner = S.players[wi];

  const blocked = g("globalThis._blocked");
  if (blocked === blockedSeen) {
    ok(winner.hand.length === 0, "le gagnant de la manche n'a plus aucune carte");
  }
  blockedSeen = blocked;

  // Décompte recalculé indépendamment du jeu.
  const gain = S.players.reduce((n, p, i) => n + (i === wi ? 0 : handWorth(p)), 0);
  S.players.forEach((p, i) => {
    const last = p.rounds[p.rounds.length - 1];
    ok(last === (i === wi ? gain : 0),
       `score de manche de ${p.name} : ${last} attendu ${i === wi ? gain : 0}`);
    ok(p.score === p.rounds.reduce((a, b) => a + b, 0), `cumul cohérent pour ${p.name}`);
  });
  ok(S.players[wi].handLeft === 0 && gain >= 0, "le gagnant ne compte aucune carte");

  // Toutes les poses de la manche étaient légales au moment où elles ont eu lieu.
  const plays = g("globalThis._plays");
  ok(plays.every((x) => x.legal), `toutes les cartes posées étaient jouables (${plays.length} poses)`);
  ok(plays.every((x) => x.pending === 0 || x.kind === "draw2" || x.kind === "wild4"),
     "sous pénalité, seuls un +2 ou un +4 peuvent être posés");
  g("globalThis._plays = []");

  ok(g("globalThis._peeks") === 0, "aucune IA ne lit la main d'un autre joueur");

  const over = !g("VAR").match || S.players.some((p) => p.score >= 500);
  ok(!!byId.get("btnNext").dataset.over === over,
     "la partie s'arrête exactement à 500 points (ou après une manche unique)");
  cov.rounds++;
}

/* ============== Cas ciblés — synchrones, IA neutralisées ================== */
/* À partir d'ici, aucun `await` : les tours d'IA sont remplacés par des
   fonctions vides, donc plus aucune temporisation ne reste en vol et rien ne
   peut muter l'état entre deux vérifications. */
function stopAI() {
  g("aiTurn = async function () {}; aiPenalty = async function () {};");
}

function targetedTests() {
  /* -------------------------------------------- Compatibilité navigateur */
  const clashes = globalClashes("uno.html");
  ok(clashes.length === 0,
     `aucun nom de premier niveau ne masque une propriété de window (${clashes.join(", ")})`);

  /* --------------------------------------------------------------- Paquet */
  const deck = g("buildDeck()");
  ok(deck.length === 108, `le paquet compte 108 cartes (${deck.length})`);
  const n = new Map();
  for (const c of deck) n.set(sig(c), (n.get(sig(c)) || 0) + 1);
  ok(COLORS.every((c) => n.get(`${c}-num0`) === 1), "un seul 0 par couleur");
  ok(COLORS.every((c) => [1, 2, 3, 4, 5, 6, 7, 8, 9].every((v) => n.get(`${c}-num${v}`) === 2)),
     "deux exemplaires de chaque chiffre de 1 à 9 par couleur");
  ok(COLORS.every((c) => ["skip", "rev", "draw2"].every((k) => n.get(`${c}-${k}`) === 2)),
     "deux Passe, deux Sens interdit et deux +2 par couleur");
  ok(n.get("W-wild") === 4 && n.get("W-wild4") === 4, "quatre jokers et quatre jokers +4");

  const cardValue = g("cardValue");
  ok(cardValue(mkCard("R", "num", 7)) === 7, "barème : un chiffre vaut sa valeur");
  ok(cardValue(mkCard("R", "num", 0)) === 0, "barème : le 0 ne vaut rien");
  ok(["skip", "rev", "draw2"].every((k) => cardValue(mkCard("R", k)) === 20),
     "barème : les cartes symboles valent 20");
  ok(cardValue(mkCard(null, "wild")) === 50 && cardValue(mkCard(null, "wild4")) === 50,
     "barème : les jokers valent 50");

  /* -------------------------------------------------- Cartes compatibles */
  start({ n: 3, level: "sharp", format: "match", vars: {} });
  S.pending = 0;
  S.discard = [mkCard("R", "num", 5)];
  S.color = "R";
  ok(canPlay(mkCard("R", "num", 9)), "même couleur : jouable");
  ok(canPlay(mkCard("B", "num", 5)), "même chiffre, autre couleur : jouable");
  ok(!canPlay(mkCard("B", "num", 9)), "ni couleur ni chiffre : refusé");
  ok(canPlay(mkCard("R", "skip")), "symbole de la couleur active : jouable");
  ok(canPlay(mkCard(null, "wild")) && canPlay(mkCard(null, "wild4")),
     "un joker se pose sur n'importe quoi");

  S.discard = [mkCard("R", "skip")];
  ok(canPlay(mkCard("B", "skip")), "même symbole, autre couleur : jouable");
  ok(!canPlay(mkCard("B", "rev")), "symbole différent, couleur différente : refusé");
  ok(!canPlay(mkCard("B", "num", 0)), "un chiffre ne répond pas à un symbole");

  // Après un joker, seule la couleur annoncée compte.
  S.discard = [mkCard(null, "wild")];
  S.color = "V";
  ok(canPlay(mkCard("V", "num", 3)), "après un joker : la couleur annoncée est jouable");
  ok(!canPlay(mkCard("B", "num", 3)), "après un joker : les autres couleurs sont refusées");

  /* ------------------------------------------- Effets des cartes spéciales */
  /* Table posée à la main. Tous les sièges deviennent humains : les tours d'IA
     étant neutralisés, c'est le seul moyen que le moteur résolve de bout en
     bout (pénalités comprises) et de façon synchrone. */
  const table = (nb, vars) => {
    start({ n: nb, level: "sharp", format: "match", vars });
    for (const p of S.players) p.ai = false;
    S.busy = false; S.pending = 0; S.pendingKind = null; S.wild4 = null;
    S.dir = 1; S.current = 0; S.phase = "play"; S.drawn = null;
    S.discard = [mkCard("R", "num", 4)];
    S.color = "R";
    S.draw = [];
    for (let i = 0; i < 20; i++) S.draw.push(mkCard("B", "num", 1));
    for (const p of S.players) p.hand = [mkCard("J", "num", 8), mkCard("J", "num", 9)];
  };

  table(3, {});
  let card = mkCard("R", "skip");
  S.players[0].hand = [card, mkCard("V", "num", 1)];
  onHandClick(card.uid);
  ok(S.current === 2, `le Passe saute le joueur suivant (courant ${S.current}, attendu 2)`);

  // Sens interdit à 3 joueurs : le sens s'inverse, la main revient au précédent.
  table(3, {});
  card = mkCard("R", "rev");
  S.players[0].hand = [card, mkCard("V", "num", 1)];
  onHandClick(card.uid);
  ok(S.dir === -1, "le Sens interdit inverse le sens du jeu");
  ok(S.current === 2, `sens inversé : la main passe au joueur précédent (courant ${S.current})`);

  // À deux joueurs, le Sens interdit fait sauter le tour de l'adversaire.
  table(2, {});
  card = mkCard("R", "rev");
  S.players[0].hand = [card, mkCard("V", "num", 1)];
  onHandClick(card.uid);
  ok(S.current === 0, "à deux joueurs, le Sens interdit rend la main au poseur");
  ok(S.dir === 1, "à deux joueurs, le Sens interdit ne change pas le sens");

  // +2 sans cumul : le suivant pioche 2 et passe.
  table(3, {});
  card = mkCard("R", "draw2");
  S.players[0].hand = [card, mkCard("V", "num", 1)];
  onHandClick(card.uid);
  ok(S.players[1].hand.length === 4, `+2 : le suivant pioche 2 cartes (${S.players[1].hand.length})`);
  ok(S.current === 2, "+2 sans cumul : le suivant passe son tour");
  ok(S.pending === 0, "+2 : la pénalité est soldée");

  // +4 sans cumul ni contestation : 4 cartes et tour sauté, couleur annoncée.
  table(3, {});
  card = mkCard(null, "wild4");
  S.players[0].hand = [card, mkCard("V", "num", 1)];
  onHandClick(card.uid);
  ok(S.phase === "color", "un joker ouvre le choix de la couleur");
  onColorPick("V");
  ok(S.color === "V", "la couleur annoncée devient la couleur active");
  ok(S.players[1].hand.length === 6, `+4 : le suivant pioche 4 cartes (${S.players[1].hand.length})`);
  ok(S.current === 2, "+4 sans cumul : le suivant passe son tour");

  /* ------------------------------------------------------ Cumul des +2/+4 */
  table(3, { stack: true });
  S.players[0].hand = [mkCard("B", "draw2"), mkCard("V", "num", 1)];
  S.players[1].hand = [mkCard("J", "draw2"), mkCard("J", "num", 9)];   // pourra surenchérir aussi
  S.pending = 2; S.pendingKind = "draw2";
  beginTurn();
  ok(S.phase === "stack", "cumul actif : le joueur visé peut surenchérir");
  ok(canPlay(mkCard("B", "draw2")), "cumul : un +2 répond à un +2, quelle que soit la couleur");
  ok(canPlay(mkCard(null, "wild4")), "cumul : un +4 répond aussi à un +2");
  ok(!canPlay(mkCard("R", "num", 4)), "cumul : un chiffre ne répond pas à un +2");
  onHandClick(S.players[0].hand[0].uid);
  ok(S.pending === 4, `cumul : les pénalités s'additionnent (${S.pending})`);
  ok(S.phase === "stack" && S.current === 1,
     "cumul : la pénalité grossie passe au suivant, qui peut surenchérir à son tour");

  table(3, { stack: true });
  S.players[0].hand = [mkCard("B", "draw2"), mkCard("V", "num", 1)];
  S.pending = 4; S.pendingKind = "wild4";
  beginTurn();
  ok(!canPlay(mkCard("B", "draw2")), "cumul : un +2 ne répond pas à un +4");
  ok(canPlay(mkCard(null, "wild4")), "cumul : seul un +4 répond à un +4");

  table(3, { stack: true });
  S.players[0].hand = [mkCard("V", "num", 1)];
  S.pending = 6; S.pendingKind = "draw2";
  beginTurn();
  ok(S.players[0].hand.length === 7, `cumul : sans surenchère, on pioche le total (${S.players[0].hand.length})`);
  ok(S.current === 1 && S.pending === 0, "cumul : la pénalité soldée, le tour passe");

  // Cumul désactivé : la pénalité tombe sans laisser le choix.
  table(3, {});
  S.players[0].hand = [mkCard("B", "draw2"), mkCard("V", "num", 1)];
  S.pending = 2; S.pendingKind = "draw2";
  beginTurn();
  ok(S.players[0].hand.length === 4, "sans cumul : le joueur visé pioche sans pouvoir surenchérir");
  ok(S.current === 1, "sans cumul : son tour est sauté");

  /* ---------------------------------------------------------- Contestation */
  table(2, { challenge: true });
  S.players[0].hand = [mkCard("V", "num", 1)];
  S.players[1].hand = [mkCard("R", "num", 3), mkCard("B", "num", 4)];
  S.color = "B"; S.pending = 4; S.pendingKind = "wild4";
  S.wild4 = { by: 1, colorBefore: "R", bluff: true };
  beginTurn();
  ok(S.phase === "challenge", "contestation proposée face à un +4 isolé");
  onChallengeClick();
  ok(S.players[1].hand.length === 6, `bluff démasqué : le tricheur pioche 4 (${S.players[1].hand.length})`);
  ok(S.players[0].hand.length === 1, "bluff démasqué : la victime ne pioche rien");
  ok(S.current === 0 && S.phase === "play", "bluff démasqué : la victime joue son tour normalement");

  table(2, { challenge: true });
  S.players[0].hand = [mkCard("V", "num", 1)];
  S.players[1].hand = [mkCard("R", "num", 3)];
  S.color = "B"; S.pending = 4; S.pendingKind = "wild4";
  S.wild4 = { by: 1, colorBefore: "R", bluff: false };
  beginTurn();
  onChallengeClick();
  ok(S.players[0].hand.length === 7, `contestation ratée : 6 cartes piochées (${S.players[0].hand.length})`);
  ok(S.players[1].hand.length === 1, "contestation ratée : l'accusé ne pioche rien");
  ok(S.current === 1, "contestation ratée : le tour est perdu");

  // Refuser de contester ramène au traitement normal de la pénalité.
  table(2, { challenge: true });
  S.players[0].hand = [mkCard("V", "num", 1)];
  S.color = "B"; S.pending = 4; S.pendingKind = "wild4";
  S.wild4 = { by: 1, colorBefore: "R", bluff: true };
  beginTurn();
  onSubmitClick();
  ok(S.players[0].hand.length === 5, "contestation refusée : la victime pioche les 4 cartes");
  ok(S.current === 1, "contestation refusée : son tour est sauté");

  // Sur un cumul, plus de contestation possible.
  table(3, { challenge: true, stack: true });
  S.players[0].hand = [mkCard("V", "num", 1)];
  S.pending = 8; S.pendingKind = "wild4";
  S.wild4 = { by: 1, colorBefore: "R", bluff: true };
  beginTurn();
  ok(S.phase !== "challenge", "pas de contestation sur un cumul de +4");

  /* -------------------------------------------------------- Règle du 7-0 */
  table(3, { sevenZero: true });
  const zero = mkCard("R", "num", 0);
  S.players[0].hand = [zero, mkCard("V", "num", 1)];
  S.players[1].hand = [mkCard("V", "num", 2)];
  S.players[2].hand = [mkCard("J", "num", 3), mkCard("J", "num", 4)];
  const keep = S.players.map((p) => p.hand.map((c) => c.uid));
  onHandClick(zero.uid);
  cov.rotations++;
  ok(S.players[1].hand.map((c) => c.uid).join() === keep[0].filter((u) => u !== zero.uid).join(),
     "le 0 : la main du poseur passe au joueur suivant");
  ok(S.players[2].hand.map((c) => c.uid).join() === keep[1].join(),
     "le 0 : chaque main avance d'un cran dans le sens du jeu");
  ok(S.players[0].hand.map((c) => c.uid).join() === keep[2].join(),
     "le 0 : le poseur récupère la main du joueur précédent");

  table(3, { sevenZero: true });
  const seven = mkCard("R", "num", 7);
  S.players[0].hand = [seven, mkCard("V", "num", 1)];
  S.players[2].hand = [mkCard("J", "num", 3), mkCard("J", "num", 4), mkCard("J", "num", 5)];
  const mine = S.players[0].hand.filter((c) => c !== seven).map((c) => c.uid);
  const his = S.players[2].hand.map((c) => c.uid);
  onHandClick(seven.uid);
  ok(S.phase === "swap", "le 7 demande avec quel adversaire échanger");
  onSwapPick(2);
  ok(S.players[0].hand.map((c) => c.uid).join() === his.join(), "le 7 : le poseur reçoit la main visée");
  ok(S.players[2].hand.map((c) => c.uid).join() === mine.join(), "le 7 : l'adversaire reçoit la sienne");

  // Posé en dernière carte, le 7 gagne la manche : rien à échanger.
  table(3, { sevenZero: true });
  const last7 = mkCard("R", "num", 7);
  S.players[0].hand = [last7];
  onHandClick(last7.uid);
  ok(S.phase === "over" && S.winner === 0, "un 7 posé en dernière carte gagne la manche sans échange");

  /* ------------------------------- Dernière carte : le +2 est quand même subi */
  table(2, {});
  const lastD2 = mkCard("R", "draw2");
  S.players[0].hand = [lastD2];
  S.players[1].hand = [mkCard("J", "num", 9), mkCard(null, "wild")];
  S.draw = [mkCard("B", "num", 3), mkCard("B", "num", 4)];
  onHandClick(lastD2.uid);
  ok(S.phase === "over" && S.winner === 0, "vider sa main gagne la manche");
  ok(S.players[1].hand.length === 4,
     `+2 en dernière carte : le suivant pioche quand même (${S.players[1].hand.length})`);
  ok(S.players[0].rounds[S.players[0].rounds.length - 1] === 9 + 50 + 4 + 3,
     "les cartes piochées en fin de manche comptent dans le décompte");

  /* -------------------------------------------------------------- Remélange */
  table(2, {});
  const a = mkCard("R", "num", 1), b = mkCard("R", "num", 2);
  const c2 = mkCard("R", "num", 3), d = mkCard("R", "num", 4), e = mkCard("R", "num", 5);
  S.draw = [];
  S.discard = [a, b, c2, d, e];
  S.players[0].hand = [];
  const got = drawOne(S.players[0]);
  ok(S.discard.length === 1 && S.discard[0] === e,
     "remélange : la défausse ne conserve que sa carte du dessus");
  ok(S.draw.length === 3, `remélange : les autres cartes repartent dans la pioche (${S.draw.length})`);
  ok([...S.draw, got].map((x) => x.uid).sort().join() === [a, b, c2, d].map((x) => x.uid).sort().join(),
     "remélange : aucune carte perdue ni dupliquée");

  // Rien à remélanger : la pioche renvoie null, le moteur ne doit pas boucler.
  S.draw = [];
  S.discard = [e];
  ok(drawOne(S.players[0]) === null, "pioche impossible : drawOne() renvoie null");
}

/* ------------------------------ Ouverture de manche ---------------------- */
/* Un joker +4 ne doit jamais ouvrir la défausse (règle officielle) ; les autres
   cartes spéciales agissent bien sur le premier joueur. */
function openingTests() {
  let wild4 = 0;
  for (let i = 0; i < 150; i++) {
    start({ n: 3, level: "sharp", format: "match", vars: {} });
    if (S.discard[0].kind === "wild4") wild4++;
    cov.opens[S.discard[0].kind] = (cov.opens[S.discard[0].kind] || 0) + 1;
    const dealt = S.players.reduce((t, p) => t + p.hand.length, 0);
    if (S.discard[0].kind !== "draw2") {
      okOnce(dealt === 21, `7 cartes distribuées à chacun (${dealt} au total)`);
    }
    if (S.discard[0].kind === "skip") {
      okOnce(S.current === 1, "Passe en ouverture : le premier joueur saute son tour");
    }
    if (S.discard[0].kind === "draw2") {
      // Le premier joueur est l'humain : beginTurn() solde la pénalité aussitôt.
      okOnce(dealt === 23 && S.pending === 0 && S.current === 1,
             "+2 en ouverture : le premier joueur pioche 2 cartes et passe son tour");
    }
    if (S.discard[0].kind === "wild") {
      okOnce(S.color === null && S.phase === "color",
             "Joker en ouverture : le premier joueur annonce la couleur");
    }
    if (S.discard[0].kind === "rev") {
      okOnce(S.dir === -1 && S.current === 2,
             "Sens interdit en ouverture : le sens s'inverse avant le premier tour");
    }
  }
  ok(wild4 === 0, `aucun joker +4 n'ouvre la manche (${wild4} sur 150)`);
}

/* ------------------------------------------------------------------ Main */
const scenarios = [
  { n: 2, level: "sharp", format: "match", vars: {} },
  { n: 3, level: "simple", format: "match", vars: {} },
  { n: 4, level: "sharp", format: "match", vars: { stack: true } },
  { n: 2, level: "sharp", format: "single", vars: { challenge: true } },
  { n: 3, level: "sharp", format: "single", vars: { sevenZero: true } },
  { n: 3, level: "sharp", format: "single", vars: { stack: true, challenge: true, sevenZero: true } },
  { n: 4, level: "simple", format: "single", vars: { stack: true, challenge: true, sevenZero: true } },
];

(async () => {
  for (const sc of scenarios) {
    for (let i = 0; i < (sc.format === "single" ? 8 : 2); i++) await playGame(sc);
  }
  stopAI();
  openingTests();
  targetedTests();

  cov.reshuffles = g("globalThis._reshuffles");
  cov.blocked = g("globalThis._blocked");
  console.log("Couverture :", JSON.stringify(cov));
  report("Uno");
})();
