/* Skyjo — règles du jeu, vérifiées en jouant des parties complètes.
 * Lancer : node tests/skyjo.test.js
 *
 * Le siège humain est piloté par appels directs à onCardClick/onDrawClick/
 * onDiscardClick ; les adversaires jouent normalement, leurs temporisations
 * étant réduites à zéro par l'horloge du harnais.
 */
"use strict";

const { loadSkyjo, checker } = require("./harness");

const { g, S, byId, tick } = loadSkyjo();
const { ok, okOnce, report } = checker();

/* Instrumentation : ordre des tours et couverture des cas limites.
   Les déclarations `function` de premier niveau sont sur l'objet global du
   contexte, donc remplaçables d'ici. */
g(`
  globalThis._turns = []; globalThis._cols = 0; globalThis._reshuffle = 0;
  const _endTurn = endTurn;
  endTurn = function () {
    const before = S.current;
    _endTurn();
    globalThis._turns.push({ player: before, finisher: S.finisher });
  };
  const _drawCard = drawCard;
  drawCard = function () { if (S.draw.length === 0) globalThis._reshuffle++; return _drawCard(); };
  const _clearColumns = clearColumns;
  clearColumns = function (p) { const r = _clearColumns(p); if (r !== null) globalThis._cols++; return r; };
`);

const cov = { rounds: 0, columns: 0, doubles: 0, noDouble: 0, reshuffles: 0 };

/* ------------------------------------------------------------ Invariants */
const refCount = new Map();
for (const v of g("buildDeck()")) refCount.set(v, (refCount.get(v) || 0) + 1);

/* Les 150 cartes sont conservées à tout instant. Attention : une carte retirée
   garde sa case (`removed`) *et* part à la défausse — la compter des deux côtés
   ferait un doublon. La carte en main n'est dans aucune pile. */
function checkConservation(where) {
  const c = new Map();
  const add = (v) => c.set(v, (c.get(v) || 0) + 1);
  for (const v of S.draw) add(v);
  for (const v of S.discard) add(v);
  if (S.held !== null) add(S.held);
  for (const p of S.players) for (const cell of p.grid) if (!cell.removed) add(cell.v);

  let total = 0;
  for (const [, n] of c) total += n;
  okOnce(total === 150, `150 cartes en jeu à tout instant (${where} : ${total})`);
  for (const [v, n] of refCount) {
    okOnce(c.get(v) === n, `multiset préservé pour la valeur ${v} (${where} : ${c.get(v)} au lieu de ${n})`);
  }
}

function checkNoPendingColumn(where) {
  for (const p of S.players) {
    for (let col = 0; col < 4; col++) {
      const cells = [col, col + 4, col + 8].map((i) => p.grid[i]);
      if (cells.every((x) => !x.removed && x.up) && cells[0].v === cells[1].v && cells[1].v === cells[2].v) {
        okOnce(false, `aucune colonne de 3 identiques ne subsiste (${where}, ${p.name}, colonne ${col})`);
      }
    }
  }
  okOnce(true, "aucune colonne de 3 valeurs identiques ne subsiste après un tour");
}

function checkRemovalsByThree() {
  for (const p of S.players) {
    for (let col = 0; col < 4; col++) {
      const n = [col, col + 4, col + 8].filter((i) => p.grid[i].removed).length;
      okOnce(n === 0 || n === 3, "les cartes ne sont retirées que par colonne entière");
    }
  }
}

/* ------------------------------------------------- Pilotage du siège humain */
const bestPlacement = g("bestPlacement");
const bestFlip = g("bestFlip");
const hiddenCells = g("hiddenCells");
const onCardClick = g("onCardClick");
const onDrawClick = g("onDrawClick");
const onDiscardClick = g("onDiscardClick");

function humanAct() {
  const me = S.players[0];
  if (S.phase === "setup") {
    const hid = hiddenCells(me);
    onCardClick(hid[Math.floor(Math.random() * hid.length)]);
  } else if (S.phase === "source") {
    const top = S.discard[S.discard.length - 1];
    const gain = top === undefined ? -Infinity : bestPlacement(me, top).gain;
    gain >= 2 ? onDiscardClick() : onDrawClick();
  } else if (S.phase === "swap") {
    onCardClick(bestPlacement(me, S.held).idx);
  } else if (S.phase === "drawn") {
    const place = bestPlacement(me, S.held);
    if (place.gain > 0.5 || hiddenCells(me).length === 0) onCardClick(place.idx);
    else onDiscardClick();
  } else if (S.phase === "flip") {
    onCardClick(bestFlip(me));
  }
}

/* --------------------------------------------------------- Partie complète */
async function playGame(nPlayers) {
  g(`chosenPlayers = ${nPlayers}`);
  byId.get("btnStart").click();

  ok(S.players.length === nPlayers, `partie à ${nPlayers} joueurs`);
  ok(S.players.every((p) => p.grid.length === 12), "12 cartes par joueur");
  ok(S.discard.length === 1, "une carte retournée pour lancer la défausse");
  ok(S.players.slice(1).every((p) => p.grid.filter((c) => c.up).length === 2),
     "les adversaires retournent 2 cartes au départ");
  checkConservation("distribution");

  let guard = 0;
  while (guard++ < 200000) {
    await tick();

    if (S.phase === "over") {
      checkRound();
      if (byId.get("btnNext").dataset.over) return;
      byId.get("btnNext").click();
      continue;
    }
    if (S.busy || S.current !== 0) continue;   // un adversaire joue, ou révélation en cours

    /* Début d'un tour humain : état stable, tous les tours précédents appliqués.
       (Pendant la révélation d'une carte remplacée, une colonne peut sembler
       complète alors que la carte va justement être retirée.) */
    if (S.phase === "source") {
      checkNoPendingColumn("début de tour");
      checkRemovalsByThree();
      okOnce(S.held === null, "aucune carte en main au début d'un tour");
      okOnce(byId.get("held").hidden === true, "la pile « En main » est masquée entre deux tours");
    }
    humanAct();
    checkConservation("tour humain");
  }
  ok(false, "la partie se termine sans blocage (garde-fou atteint)");
}

/* --------------------------------------------------- Contrôle d'une manche */
function checkRound() {
  ok(S.finisher !== null, "une manche se termine toujours via un joueur ayant tout retourné");
  ok(S.players[S.finisher].grid.every((c) => c.up || c.removed),
     "le joueur qui termine a bien toutes ses cartes retournées");
  ok(S.players.every((p) => p.grid.every((c) => c.up || c.removed)),
     "toutes les cartes sont révélées au décompte");

  // Après le tour du finisseur, chaque autre joueur joue exactement une fois.
  const turns = g("globalThis._turns");
  const after = turns.slice(turns.findIndex((t) => t.finisher !== null) + 1).map((t) => t.player);
  const others = S.players.map((_, i) => i).filter((i) => i !== S.finisher);
  ok(after.length === others.length,
     `dernier tour : ${others.length} tours attendus, ${after.length} joués`);
  ok(new Set(after).size === after.length && after.every((p) => others.includes(p)),
     "chaque adversaire joue exactement un dernier tour");
  g("globalThis._turns = []");

  // Décompte recalculé indépendamment du jeu.
  const raw = S.players.map((p) => p.grid.reduce((n, c) => n + (c.removed ? 0 : c.v), 0));
  const lowestOther = Math.min(...raw.filter((_, i) => i !== S.finisher));
  const shouldDouble = raw[S.finisher] > 0 && raw[S.finisher] >= lowestOther;
  const expected = raw.slice();
  if (shouldDouble) expected[S.finisher] *= 2;

  S.players.forEach((p, i) => {
    ok(p.rounds[p.rounds.length - 1] === expected[i],
       `score de manche de ${p.name} : ${p.rounds[p.rounds.length - 1]} attendu ${expected[i]}`);
    ok(p.total === p.rounds.reduce((a, b) => a + b, 0), `cumul cohérent pour ${p.name}`);
  });

  cov.rounds++;
  shouldDouble ? cov.doubles++ : cov.noDouble++;

  const over = S.players.some((p) => p.total >= 100);
  ok(!!byId.get("btnNext").dataset.over === over, "la partie s'arrête exactement à 100 points ou plus");
}

/* ------------------ Temporisation de révélation et pile « En main » ------ */
async function revealTest() {
  g("chosenPlayers = 3");
  byId.get("btnStart").click();
  while (S.phase === "setup") humanAct();
  while (S.current !== 0 || S.phase !== "source") await tick();

  onDrawClick();
  const held = S.held;
  ok(byId.get("held").hidden === false, "la pile « En main » apparaît quand je pioche");

  const me = S.players[0];
  const idx = hiddenCells(me)[0];
  const oldValue = me.grid[idx].v;
  const discardBefore = S.discard.length;
  onCardClick(idx);

  ok(S.busy === true, "révélation : le plateau est verrouillé pendant la pause");
  ok(me.grid[idx].up === true && me.grid[idx].v === oldValue,
     "révélation : la carte remplacée est montrée face visible avant la défausse");
  ok(S.held === held, "révélation : la carte en main est toujours en main pendant la pause");
  ok(S.discard.length === discardBefore, "révélation : rien n'est défaussé avant la fin de la pause");

  await tick();

  ok(me.grid[idx].v === held, "après la pause : la carte piochée a pris la place");
  ok(S.discard[S.discard.length - 1] === oldValue,
     "après la pause : l'ancienne carte est au sommet de la défausse");
  ok(S.held === null, "après la pause : plus rien en main");
  ok(byId.get("held").hidden === true, "après la pause : la pile « En main » est masquée");

  // Échange contre une carte déjà visible : pose synchrone, sans pause.
  while (S.current !== 0 || S.phase !== "source") await tick();
  onDrawClick();
  const upIdx = me.grid.findIndex((c) => c.up && !c.removed);
  const drawn = S.held;
  onCardClick(upIdx);
  ok(S.held === null && me.grid[upIdx].v === drawn,
     "échange contre une carte déjà visible : pose immédiate, sans pause");
}

/* ------------- Branches que le jeu aléatoire n'atteint pas ------------- */
function pad(sum) {                    // 12 cartes dont la somme vaut `sum`
  const cards = new Array(12).fill(0);
  let rest = sum, i = 0;
  while (rest !== 0 && i < 12) {
    const step = Math.max(-2, Math.min(12, rest));
    cards[i++] = step; rest -= step;
  }
  return cards;
}

function roundScoreFor(totals, finisher) {
  S.players.forEach((p, i) => {
    p.grid = pad(totals[i]).map((v) => ({ v, up: true, removed: false }));
    p.rounds = []; p.total = 0;
  });
  S.finisher = finisher;
  g("endRound")();
  return S.players.map((p) => p.rounds[0]);
}

function targetedTests() {
  g("chosenPlayers = 3");            // les cas ci-dessous fournissent 3 totaux
  byId.get("btnStart").click();

  // Remélange quand la pioche est vide.
  S.draw = [];
  S.discard = [7, 3, 9, 4, 11];      // 11 est la carte du dessus
  const v = g("drawCard")();
  ok(S.discard.length === 1 && S.discard[0] === 11,
     "remélange : la défausse ne conserve que sa carte du dessus");
  ok(S.draw.length === 3 && [7, 3, 9, 4].includes(v),
     "remélange : les autres cartes repartent dans la pioche");
  ok([...S.draw, v].sort().join() === [7, 3, 9, 4].sort().join(),
     "remélange : aucune carte perdue ni dupliquée");

  // Règle de doublement — le finisseur est le joueur 0.
  const cases = [
    { t: [5, 9, 12], exp: 5, why: "finisseur seul en tête : pas de doublement" },
    { t: [8, 8, 12], exp: 16, why: "égalité : doublement appliqué" },
    { t: [8, 3, 12], exp: 16, why: "finisseur battu : doublement appliqué" },
    { t: [0, -2, 5], exp: 0, why: "total nul : pas de doublement" },
    { t: [-3, -5, 4], exp: -3, why: "total négatif battu : pas de doublement" },
    { t: [-3, 4, 6], exp: -3, why: "total négatif en tête : pas de doublement" },
  ];
  for (const c of cases) {
    const got = roundScoreFor(c.t, 0);
    ok(got[0] === c.exp, `${c.why} (attendu ${c.exp}, obtenu ${got[0]})`);
    ok(got[1] === c.t[1] && got[2] === c.t[2], `${c.why} : les autres scores ne changent pas`);
  }
}

/* ------------------------------------------------------------------ Main */
(async () => {
  for (const n of [2, 3, 4]) {
    for (let i = 0; i < 4; i++) await playGame(n);
  }
  await revealTest();
  targetedTests();

  cov.columns = g("globalThis._cols");
  cov.reshuffles = g("globalThis._reshuffle");
  console.log("Couverture :", JSON.stringify(cov));
  report("Skyjo");
})();
