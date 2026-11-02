/* Solitaire (Klondike) — règles du jeu, vérifiées en jouant des parties complètes.
 * Lancer : node tests/solitaire.test.js
 *
 * Trois parties dans ce fichier :
 *   1. des parties au hasard par les gestionnaires de clic, sous invariants :
 *      conservation du paquet, légalité de chaque coup au moment où il est
 *      joué (contre une règle réécrite ici), tirages par trois, talon retourné
 *      dans le même ordre, Annuler qui rend exactement la position d'avant ;
 *   2. des parties jouées de bout en bout par l'indice (sharp), et quelques-unes
 *      par simple, la référence du banc : elles finissent, sans lire une carte
 *      jamais vue, et la fin automatique mène à la feuille ;
 *   3. des cas ciblés et synchrones, position posée à la main.
 */
"use strict";

const { loadSolitaire, checker, globalClashes } = require("./harness");

const { g, S, byId, tick } = loadSolitaire();
const { ok, okOnce, report } = checker();
const ctx = g("globalThis");

const RED = [false, true, false, true];
const canMove = g("canMove");
const cardsAt = g("cardsAt");
const DESTS = g("DESTS");
// Une fonction de premier niveau est sur le global du contexte (et peut y être remplacée) ; un const, non.
const call = (name, ...args) => (typeof ctx[name] === "function" ? ctx[name] : g(name))(...args);
const ticks = async (n) => { for (let i = 0; i < n; i++) await tick(); };
const rnd = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rnd(a.length)];
const uids = (a) => a.map((c) => c.uid).join(",");

/* ------------------------------------------------- La règle, réécrite ici */
function legalHere(src, dst) {
  if (S.phase !== "play") return false;
  let cards = [];
  if (src.at === "w") cards = S.waste.length ? [S.waste[S.waste.length - 1]] : [];
  else if (src.at === "f") cards = S.found[src.i] && S.found[src.i].length ? [S.found[src.i][S.found[src.i].length - 1]] : [];
  else if (src.at === "c") {
    const col = S.cols[src.i] || [];
    if (src.k >= 0 && src.k < col.length && col[src.k].up) cards = col.slice(src.k);
  }
  if (!cards.length) return false;
  const c = cards[0];
  if (dst.at === "f") {
    const f = S.found[dst.i];
    if (!f || src.at === "f" || cards.length !== 1) return false;
    return f.length ? f[f.length - 1].suit === c.suit && f[f.length - 1].rank === c.rank - 1 : c.rank === 1 && dst.i === c.suit;
  }
  if (dst.at !== "c" || !S.cols[dst.i] || (src.at === "c" && src.i === dst.i)) return false;
  const col = S.cols[dst.i];
  if (!col.length) return c.rank === 13;
  const t = col[col.length - 1];
  return t.up && t.rank === c.rank + 1 && RED[t.suit] !== RED[c.suit];
}

/* Chaque déplacement tenté est comparé à la règle réécrite : refusé quand
   elle le refuse, joué quand elle l'accepte. Chaque tirage est vérifié : trois
   cartes du dessus du talon (moins s'il en reste moins), ou la défausse
   retournée dans le même ordre. */
let mismatches = 0, draws = 0, recycles = 0, flips = 0, kingsToEmpty = 0, fromFound = 0, runs = 0;
const _doMove = ctx.doMove;
ctx.doMove = function (src, dst) {
  const want = legalHere(src, dst);
  const before = src.at === "c" ? S.cols[src.i] && S.cols[src.i].length - src.k : 1;
  const emptyDst = dst.at === "c" && S.cols[dst.i] && !S.cols[dst.i].length;
  const hidden = src.at === "c" && src.k > 0 && S.cols[src.i] && S.cols[src.i][src.k - 1] && !S.cols[src.i][src.k - 1].up;
  const done = _doMove(src, dst);
  if (done !== want) {
    mismatches++;
    if (mismatches < 5) console.error("déplacement mal jugé", JSON.stringify({ src, dst, want, done }));
  }
  if (done) {
    if (hidden) flips++;
    if (emptyDst) kingsToEmpty++;
    if (src.at === "f") fromFound++;
    if (before > 1) runs++;
  }
  return done;
};
let badDraws = 0;
const _doDraw = ctx.doDraw;
ctx.doDraw = function () {
  const stock = S.stock.slice(), waste = S.waste.slice(), phase = S.phase;
  const done = _doDraw();
  if (phase !== "play" || (!stock.length && !waste.length)) { if (done) badDraws++; return done; }
  if (stock.length) {
    const n = Math.min(3, stock.length);
    const ok1 = uids(S.waste) === uids(waste.concat(stock.slice(-n).reverse())) && uids(S.stock) === uids(stock.slice(0, -n));
    const ok2 = S.fan === n && S.waste.slice(-n).every((c) => c.up && c.seen);
    if (!ok1 || !ok2) badDraws++;
    draws++;
  } else {
    if (uids(S.stock) !== uids(waste.slice().reverse()) || S.waste.length || S.stock.some((c) => c.up)) badDraws++;
    recycles++;
  }
  return done;
};

/* Les politiques n'ont droit qu'à ce que le joueur a vu : pendant chaque
   décision, toute carte jamais vue (cachée dans une colonne, ou au talon)
   devient un Proxy qui compte tout accès autre que `up` et `seen`. Elles ne
   doivent pas non plus toucher à l'état, ni tirer au hasard. */
g(`
  globalThis._peeks = 0; globalThis._impure = 0; globalThis._rand = 0; globalThis._picks = 0;
  const _snap = () => JSON.stringify({
    piles: [S.stock, S.waste, ...S.found, ...S.cols].map((p) => p.map((c) => [c.uid, c.up, c.seen])),
    n: [S.fan, S.moves, S.passes, S.idle, S.trail.length, S.undo.length, S.phase],
  });
  const _policyOf = policyOf;
  policyOf = function (name) {
    const pol = _policyOf(name);
    return {
      pick() {
        globalThis._picks++;
        const before = _snap();
        const cols = S.cols, stock = S.stock, rand = Math.random;
        const spy = (c) => (c.seen ? c : new Proxy(c, {
          get(t, prop) {
            if (prop !== "up" && prop !== "seen") globalThis._peeks++;
            return Reflect.get(t, prop);
          },
        }));
        S.cols = cols.map((col) => col.map(spy));
        S.stock = stock.map(spy);
        Math.random = () => { globalThis._rand++; return rand(); };
        try { return (globalThis._last = pol.pick()); }
        finally {
          S.cols = cols; S.stock = stock; Math.random = rand;
          if (_snap() !== before) globalThis._impure++;
        }
      },
    };
  };
`);

/* --------------------------------------------------------------- Outils */
function sources() {
  const out = [];
  if (S.waste.length) out.push({ at: "w" });
  S.found.forEach((f, i) => { if (f.length) out.push({ at: "f", i }); });
  S.cols.forEach((col, i) => col.forEach((c, k) => { if (c.up) out.push({ at: "c", i, k }); }));
  return out;
}
function legalMoves() {
  const out = [];
  for (const src of sources()) for (const dst of DESTS) if (canMove(src, dst)) out.push({ src, dst });
  return out;
}

/* Une position sérialisée : piles, faces, compteurs — ce qu'Annuler doit rendre. */
const ser = () => JSON.stringify({
  piles: [S.stock, S.waste, ...S.found, ...S.cols].map((p) => p.map((c) => [c.uid, c.up])),
  n: [S.fan, S.moves, S.passes, S.idle, S.trail.length],
});

function checkState(where) {
  const all = [S.stock, S.waste, ...S.found, ...S.cols].flat();
  okOnce(all.length === 52 && new Set(all.map((c) => c.uid)).size === 52, `52 cartes distinctes à tout instant (${where} : ${all.length})`);
  okOnce(S.stock.every((c) => !c.up), `le talon reste face cachée (${where})`);
  okOnce(S.waste.every((c) => c.up && c.seen), `la défausse est face visible (${where})`);
  okOnce(S.found.every((f, s) => f.every((c, k) => c.up && c.suit === s && c.rank === k + 1)),
    `chaque fondation monte de l'As au Roi dans sa couleur (${where})`);
  let colsOk = true, runOk = true;
  for (const col of S.cols) {
    let d = 0;
    while (d < col.length && !col[d].up) d++;
    if (col.slice(d).some((c) => !c.up) || (col.length && !col[col.length - 1].up)) colsOk = false;
    for (let k = d + 1; k < col.length; k++) {
      if (col[k].rank !== col[k - 1].rank - 1 || RED[col[k].suit] === RED[col[k - 1].suit]) runOk = false;
    }
  }
  okOnce(colsOk, `une colonne : les cachées en tête, puis les visibles, la dernière toujours visible (${where})`);
  okOnce(runOk, `les cartes visibles d'une colonne descendent en alternant les couleurs (${where})`);
  okOnce(all.every((c) => !c.up || c.seen), `toute carte visible est marquée vue (${where})`);
  okOnce(S.fan <= Math.min(3, S.waste.length), `l'éventail ne montre que des cartes du dernier tirage (${where})`);
}

/* Un déplacement par les clics : on choisit la carte, puis la place — en
   touchant une carte de la colonne visée, la place elle-même, ou, quand c'est
   la meilleure, la carte une seconde fois. */
let secondClicks = 0;
function clickMove(src, dst) {
  const card = cardsAt(src)[0];
  call("onCardClick", card.uid);
  okOnce(S.sel && call("sameSrc", S.sel, src), "un clic sur une carte jouable la choisit");
  const best = call("bestTarget", src);
  const pile = dst.at === "f" ? S.found[dst.i] : S.cols[dst.i];
  const before = pile.length;
  if (best && best.at === dst.at && best.i === dst.i && Math.random() < 0.4) {
    secondClicks++;
    call("onCardClick", card.uid);
  } else if (dst.at === "c" && pile.length && Math.random() < 0.6) {
    call("onCardClick", pick(pile).uid);
  } else if (dst.at === "f" && pile.length && Math.random() < 0.5) {
    call("onCardClick", pile[pile.length - 1].uid);
  } else {
    call("onSlotClick", dst);
  }
  okOnce(pile.length > before && pile.includes(card), "le second clic pose la carte à la place visée");
}

/* -------------------------------------------- 1. Parties au hasard, aux clics */
async function randomGame() {
  call("startGame");
  checkState("donne");
  for (let step = 0; step < 300 && S.phase === "play"; step++) {
    const r = Math.random();
    const before = ser();
    if (r < 0.06 && S.undo.length) {
      call("onUndoClick");
      continue;
    }
    if (r < 0.12) {
      // Un coup quelconque, souvent illégal : doMove doit en juger comme la règle d'ici.
      const src = pick(sources().concat([{ at: "c", i: rnd(7), k: rnd(8) }, { at: "f", i: rnd(4) }]));
      call("doMove", src, pick(DESTS));
    } else {
      const moves = legalMoves();
      const up = moves.filter((m) => m.dst.at === "f");
      if (moves.length && r < 0.8) {
        const m = up.length && Math.random() < 0.6 ? pick(up) : pick(moves);
        clickMove(m.src, m.dst);
      } else {
        call("onStockClick");
      }
    }
    checkState("partie au hasard");
    // De temps en temps, on annule tout de suite : la position d'avant revient à l'identique.
    if (S.phase === "play" && ser() !== before && Math.random() < 0.08) {
      call("onUndoClick");
      okOnce(ser() === before, "Annuler rend exactement la position d'avant le coup");
    }
  }
}

/* ------------------------------------------- 2. Parties jouées par l'indice */
const aiStats = { sharp: { games: 0, wins: 0, moves: 0 }, simple: { games: 0, wins: 0, moves: 0 } };
let guardHits = 0, badPolicy = 0, sheets = 0;
async function aiGame(name) {
  call("startGame");
  const s = aiStats[name];
  s.games++;
  let guard = 0;
  while (S.phase === "play") {
    if (guard++ > 4000) { guardHits++; break; }
    const mv = call("chooseMove", name);
    if (g("_last") && !mv) badPolicy++;
    if (!mv) break;
    if (mv.draw) {
      if (call("stuck")) break;          // simple : le talon a fait un tour sans coup
      call("onStockClick");
    } else {
      for (let k = 0; k < (mv.draws || 0); k++) call("onStockClick");
      okOnce(canMove(mv.src, mv.dst), "un coup du talon est légal une fois ses tirages faits");
      clickMove(mv.src, mv.dst);
    }
    checkState(`partie de ${name}`);
  }
  s.moves += S.moves;
  if (S.phase === "auto") {
    okOnce(!S.stock.length && !S.waste.length && S.cols.every((col) => col.every((c) => c.up)),
      "la fin automatique ne part que talon et défausse vides, tout découvert");
    for (let i = 0; i < 80 && S.phase === "auto"; i++) await tick();
  }
  if (S.phase === "over") {
    s.wins++;
    okOnce(g("foundCount")() === 52, "une partie gagnée a ses 52 cartes aux fondations");
    okOnce(byId.get("scoreOverlay").hidden !== false, "la feuille attend END_MS après la victoire");
    await ticks(3);
    if (byId.get("btnNext").dataset.over === "1" && byId.get("scoreOverlay").hidden === false) sheets++;
  }
}

/* ------------------------------------------------------- 3. Cas ciblés */
const mkCard = g("mkCard");
const SUITS = { S: 0, H: 1, C: 2, D: 3 };
const RANKS = { A: 1, V: 11, D: 12, R: 13 };
/* « 7H » : sept de cœur visible ; « #7H » : face cachée, jamais vue. */
function card(spec) {
  const down = spec[0] === "#";
  const s = down ? spec.slice(1) : spec;
  const c = mkCard(SUITS[s[s.length - 1]], RANKS[s.slice(0, -1)] || +s.slice(0, -1));
  c.up = !down;
  c.seen = !down;
  return c;
}
/* Une position posée à la main. `stock` dans l'ordre où les cartes sortent ;
   `seen: true` : le talon a déjà été vu. `found` : le nombre de cartes de chaque
   fondation. Les cartes n'ont pas à faire 52, sauf pour finir une partie. */
function pose(p) {
  call("newGame");
  const cols = (p.cols || []).map((col) => col.map(card));
  while (cols.length < 7) cols.push([]);
  S.cols = cols;
  S.stock = (p.stock || []).map((x) => { const c = card(x); c.up = false; c.seen = !!p.seen; return c; }).reverse();
  S.waste = (p.waste || []).map(card);
  S.found = [0, 1, 2, 3].map((s) => Array.from({ length: (p.found || [])[s] || 0 }, (_, k) => {
    const c = mkCard(s, k + 1); c.up = true; c.seen = true; return c;
  }));
  S.fan = Math.min(3, S.waste.length);
  S.passes = p.passes || 0;
  S.undo = [];
  S.moves = 0;
  S.idle = 0;
  S.sel = null;
  S.hint = null;
  S.phase = "play";
  S.trail = [call("stateKey")];
  call("render");
}
const C = (i, k) => ({ at: "c", i, k });
const F = (i) => ({ at: "f", i });
const W = { at: "w" };
const col = (i) => ({ at: "c", i });
const label = (c) => g("cardLabel")(c);
const statusText = () => byId.get("status").innerHTML.replace(/<[^>]+>/g, "");

async function targeted() {
  // La donne.
  call("startGame");
  ok(S.cols.map((c) => c.length).join() === "1,2,3,4,5,6,7", "sept colonnes de 1 à 7 cartes");
  ok(S.cols.every((c) => c.every((x, k) => x.up === (k === c.length - 1) && x.seen === x.up)), "seule la dernière carte de chaque colonne est retournée");
  ok(S.stock.length === 24 && S.stock.every((c) => !c.up && !c.seen), "24 cartes au talon, jamais vues");
  ok(S.found.every((f) => !f.length) && !S.waste.length && S.trail.length === 1, "fondations et défausse vides au départ");
  checkState("donne");

  // Les colonnes : une de moins, l'autre couleur ; un Roi seul sur une colonne vide.
  pose({ cols: [["7H"], ["8S"], ["8C"], ["8D"], ["9S"], ["DH"], []] });
  ok(canMove(C(0, 0), col(1)) && canMove(C(0, 0), col(2)), "7♥ se pose sur un 8 noir");
  ok(!canMove(C(0, 0), col(3)) && !canMove(C(0, 0), col(4)), "7♥ ne se pose ni sur 8♦ ni sur 9♠");
  ok(!canMove(C(5, 0), col(6)), "une Dame ne va pas sur une colonne vide");
  pose({ cols: [["#4C", "RS", "DH", "VC"], [], ["5D"]] });
  ok(canMove(C(0, 1), col(1)), "un Roi va sur une colonne vide, avec toute sa suite");
  ok(!canMove(C(0, 0), col(1)), "une carte cachée ne se déplace pas");
  ok(!canMove(C(0, 2), F(1)) && !canMove(C(0, 1), F(0)), "une suite ne monte pas aux fondations");
  call("onCardClick", S.cols[0][1].uid);
  ok(S.sel && S.sel.k === 1, "un clic sur le Roi choisit la suite à partir de lui");
  ok(statusText().includes("suite du R♠"), "le statut nomme la suite choisie");
  call("onSlotClick", col(1));
  ok(S.cols[1].map(label).join() === "R♠,D♥,V♣" && S.cols[0].length === 1, "la suite entière passe sur la colonne vide");
  ok(S.cols[0][0].up && S.cols[0][0].seen, "la carte découverte se retourne d'elle-même");
  ok(byId.get("log").innerHTML.includes("On découvre"), "le journal dit la carte découverte");

  // Les fondations : une carte seule, de sa couleur, à la suite ; elle peut redescendre.
  pose({ cols: [["AS"], ["2S"], ["2H"], ["6S"], ["4C"]], found: [0, 5, 3, 0], stock: ["9D"] });
  ok(canMove(C(0, 0), F(0)) && !canMove(C(0, 0), F(1)), "un As monte sur la fondation de sa couleur");
  ok(!canMove(C(1, 0), F(0)), "un 2 attend son As");
  ok(!canMove(C(2, 0), F(1)), "2♥ ne monte pas sur un 5♥");
  ok(canMove(F(1), col(3)) && !canMove(F(1), F(2)), "une carte des fondations redescend sur une colonne, pas sur une autre fondation");
  ok(!canMove(F(2), col(4)), "redescendre suit la règle des colonnes (3♣ sur 4♣ refusé)");
  call("onCardClick", S.cols[0][0].uid);
  call("onCardClick", S.cols[0][0].uid);
  ok(S.found[0].length === 1, "deux clics sur un As l'envoient aux fondations");
  call("onCardClick", S.cols[1][0].uid);
  call("onSlotClick", F(0));
  ok(S.found[0].length === 2, "un 2 choisi puis la fondation : il monte");
  call("onCardClick", S.found[1][4].uid);
  call("onCardClick", S.cols[3][0].uid);
  ok(S.cols[3].map(label).join() === "6♠,5♥" && S.found[1].length === 4, "5♥ choisi aux fondations puis 6♠ : il redescend");

  // Le second clic : les fondations d'abord, puis une colonne occupée.
  pose({ cols: [["5H"], ["6S"], []], found: [0, 4, 0, 0], stock: ["9D"] });
  call("onCardClick", S.cols[0][0].uid);
  ok(S.sel && byId.get("found").children[1].children[0].className.includes("target"), "les places possibles s'entourent");
  call("onCardClick", S.cols[0][0].uid);
  ok(S.found[1].length === 5 && S.cols[1].length === 1, "5♥ touché deux fois va aux fondations plutôt que sur 6♠");
  pose({ cols: [["RS"], ["9H"], [], ["8D", "7C"]], stock: ["9D"] });
  call("onCardClick", S.cols[1][0].uid);
  call("onCardClick", S.cols[3][1].uid);
  ok(S.sel && S.sel.i === 3 && S.sel.k === 1 && S.cols[1].length === 1, "un clic sur une carte qui n'est pas une place possible la choisit à son tour");
  call("onCardClick", S.cols[1][0].uid);
  call("onCardClick", S.cols[1][0].uid);
  ok(!S.sel && S.cols[1].length === 1, "9♥ n'a nulle part où aller : le second clic le lâche");
  call("onCardClick", S.cols[0][0].uid);
  call("onCardClick", S.cols[0][0].uid);
  ok(S.cols[2].length === 1 && !S.cols[0].length, "le second clic envoie un Roi sur la colonne vide, faute de mieux");

  // Le talon : trois cartes par trois, la défausse retournée dans le même ordre, sans limite.
  pose({ stock: ["2C", "3C", "4C", "5C", "6C"], cols: [["RD"]] });
  call("onStockClick");
  ok(S.waste.map(label).join() === "2♣,3♣,4♣" && S.fan === 3 && S.stock.length === 2, "un tirage retourne trois cartes, la troisième dessus");
  ok(cardsAt(W)[0].rank === 4, "seule la carte du dessus de la défausse se joue");
  call("onStockClick");
  ok(S.waste.length === 5 && S.fan === 2, "à la fin du talon, on tire ce qui reste");
  call("onStockClick");
  ok(!S.waste.length && S.stock.length === 5 && S.passes === 1, "talon vide : la défausse se retourne");
  call("onStockClick");
  ok(S.waste.map(label).join() === "2♣,3♣,4♣", "au tour suivant, les cartes reviennent dans le même ordre");
  for (let k = 0; k < 9; k++) call("onStockClick");
  ok(S.passes === 4, "le talon se retourne autant de fois qu'on veut");
  ok(statusText().includes("tour"), "un tour de talon sans coup : le statut le signale");
  pose({ cols: [["RD"]] });
  ok(!call("doDraw"), "talon et défausse vides : tirer ne fait rien");

  // L'éventail : jouer le dessus découvre la carte d'en dessous.
  pose({ stock: ["5D", "8C", "7H", "9D"], cols: [["8S"], ["9H"]] });
  call("onStockClick");
  call("onCardClick", S.waste[2].uid);
  call("onCardClick", S.cols[0][0].uid);
  ok(S.cols[0].length === 2 && S.fan === 2, "7♥ de la défausse sur 8♠ ; l'éventail garde deux cartes");
  call("onCardClick", S.waste[0].uid);
  ok(S.sel && S.sel.at === "w", "toute carte de l'éventail vaut celle du dessus");
  call("onSlotClick", col(1));
  ok(S.cols[1].length === 2 && byId.get("waste").children.length === 1, "8♣ sur 9♥ ; il reste une carte, montrée seule");

  // Annuler : la position revient, la carte recachée reste connue.
  pose({ cols: [["#4C", "7H"], ["8S"]], stock: ["9D"] });
  const hidden = S.cols[0][0];
  const before = ser();
  call("onCardClick", S.cols[0][1].uid);
  call("onSlotClick", col(1));
  ok(hidden.up && S.trail.length === 2, "le coup découvre le 4♣ et entre dans la trace");
  call("onUndoClick");
  ok(ser() === before && !hidden.up && hidden.seen, "Annuler recache le 4♣, qui reste connu");
  ok(S.undos === 1 && byId.get("btnUndo").disabled, "rien de plus à annuler : le bouton s'éteint");
  pose({ stock: ["2C", "3C"], seen: true });
  call("onStockClick");
  call("onStockClick");
  const recycled = ser();
  call("onStockClick");
  call("onUndoClick");
  ok(ser() === recycled, "on annule aussi un tirage");

  // La fin automatique : talon et défausse vides, tout découvert.
  byId.get("scoreOverlay").hidden = true;
  delete byId.get("btnNext").dataset.over;
  pose({ cols: [["RH"], ["RS", "DH"], ["#DS", "RD"]], found: [11, 11, 13, 12] });
  call("render");
  ok(S.phase === "play", "une carte cachée : pas de fin automatique");
  call("onCardClick", S.cols[2][1].uid);
  call("onCardClick", S.cols[2][1].uid);
  ok(S.phase === "auto" && S.found[3].length === 13, "R♦ monte, la dernière carte cachée se retourne : les cartes montent seules");
  ok(statusText().includes("montent seules"), "le statut l'annonce");
  await tick();
  ok(S.phase === "auto" && g("foundCount")() === 49, "une carte à la fois, AUTO_MS d'écart");
  for (let i = 0; i < 20 && S.phase === "auto"; i++) await tick();
  ok(S.phase === "over" && g("foundCount")() === 52, "les 52 cartes rangées : gagné");
  ok(byId.get("scoreOverlay").hidden === true, "la feuille attend END_MS après la victoire");
  await ticks(3);
  ok(byId.get("scoreOverlay").hidden === false && byId.get("btnNext").dataset.over === "1", "la feuille de fin s'ouvre, Nouvelle donne");
  ok(byId.get("scoreBody").innerHTML.includes("Coups"), "la feuille donne les coups");
  ok(byId.get("btnUndo").disabled && byId.get("btnHint").disabled, "partie finie : ni Annuler ni Indice");

  pose({ stock: ["RD"], cols: [["DD"]], found: [13, 13, 13, 11] });
  call("onCardClick", S.cols[0][0].uid);
  call("onCardClick", S.cols[0][0].uid);
  ok(S.phase === "play" && S.found[3].length === 12, "tout est découvert mais le talon n'est pas vide : pas de fin automatique");
  const wins = S.wins;
  call("onStockClick");
  call("onCardClick", S.waste[0].uid);
  call("onCardClick", S.waste[0].uid);
  ok(S.phase === "over" && S.wins === wins + 1, "la dernière carte posée à la main : gagné");
  byId.get("scoreOverlay").hidden = true;
  pose({ cols: [["RH"]], found: [13, 12, 13, 13] });
  call("onCardClick", S.cols[0][0].uid);
  call("onCardClick", S.cols[0][0].uid);
  call("newGame");
  await ticks(4);
  ok(byId.get("scoreOverlay").hidden === true, "une nouvelle donne annule la feuille en attente");
  ok(S.phase === "play", "la nouvelle donne se joue");

  // L'indice.
  pose({ cols: [["#5D", "9H"], ["AS"]], stock: ["2C", "3C", "4C"] });
  call("onHintClick");
  ok(S.hint && S.hint.mv && S.hint.mv.dst && S.hint.mv.dst.at === "f", "indice : un As qui monte, d'abord");
  ok(statusText().includes("range A♠ aux fondations"), "le statut dit le coup");
  ok(byId.get("tableau").children[1].children[0].className.includes("hint"), "la carte de l'indice s'allume");
  call("onCardClick", S.cols[1][0].uid);
  ok(!S.hint, "toute action efface l'indice");
  pose({ cols: [["#5D", "9H"]], stock: ["2C", "3C", "4C"] });
  call("onHintClick");
  ok(S.hint.mv && S.hint.mv.draw, "indice : tirer tant que le talon cache des cartes jamais vues");
  ok(statusText().includes("tire le talon") && byId.get("stock").children[0].className.includes("hint"), "le talon s'allume");
  pose({ cols: [["#5D", "#4S", "7H"], ["8S"], ["8C"]] });
  call("onHintClick");
  ok(S.hint.mv && S.hint.mv.src.at === "c" && S.hint.mv.src.i === 0 && S.hint.mv.dst.at === "c", "indice : déplacer le 7♥ pour découvrir une carte");
  pose({ cols: [["8S"], ["#5D", "9C"]], stock: ["2C", "3C", "4C", "5C", "6C", "7H"], seen: true });
  call("onHintClick");
  ok(S.hint.mv && S.hint.mv.draws === 2 && label(S.hint.card) === "7♥" && S.hint.mv.dst.i === 0,
    "indice : tirer deux fois pour faire venir le 7♥ et le poser sur 8♠");
  ok(statusText().includes("tire le talon 2 fois pour faire venir 7♥"), "le statut dit les tirages");
  pose({ cols: [["#5D", "9D"], ["#4S", "VC"]] });
  call("onHintClick");
  ok(S.hint.none && statusText().includes("plus de coup utile"), "indice : rien d'utile, il le dit");
  // Jamais vers une position déjà jouée : 5♥ redescendu à la main n'est pas renvoyé aux fondations.
  pose({ cols: [["6S"], ["#3D", "VD"]], found: [4, 5, 4, 0] });
  call("onCardClick", S.found[1][4].uid);
  call("onCardClick", S.cols[0][0].uid);
  ok(S.cols[0].length === 2, "5♥ redescend sur 6♠");
  call("onHintClick");
  ok(!(S.hint.mv && S.hint.mv.dst && S.hint.mv.dst.at === "f"), "l'indice ne propose pas de revenir à la position d'avant");
  call("onUndoClick");
  call("onHintClick");
  ok(S.trail.length === 1, "Annuler retire la position annulée de la trace");

  // Le talon de l'indice : qu'on peut amener sans rien jouer.
  const reach = (T, p) => Array.from(call("talonReach", T, p));
  ok(reach(new Array(10).fill(0), 5).join() === "5,0,8,1,10,2,3,4,6,5,9,6", "talon de 10 à 5 cartes tirées : 5, 8, 10, puis 3, 6, 9");
  ok(reach(new Array(10).fill(0), 0).join() === "3,1,6,2,9,3,10,4", "talon neuf de 10 : 3, 6, 9, 10");
  ok(reach([], 0).length === 0, "talon vide : rien");
}

/* ---------------------------------------------------------------- Lancement */
(async () => {
  ok(globalClashes("solitaire.html").length === 0, `aucun nom de premier niveau ne masque window.* (${globalClashes("solitaire.html").join(", ")})`);

  for (let i = 0; i < 40; i++) await randomGame();
  console.log(`parties au hasard : ${draws} tirages, ${recycles} talons retournés, ${flips} cartes découvertes, ` +
    `${kingsToEmpty} Rois sur colonne vide, ${fromFound} redescentes, ${runs} suites, ${secondClicks} seconds clics`);
  ok(mismatches === 0, `chaque déplacement est jugé comme la règle (${mismatches} écarts)`);
  ok(badDraws === 0, `chaque tirage prend les trois cartes du dessus, et le talon se retourne dans le même ordre (${badDraws} écarts)`);
  ok(draws > 100 && recycles > 10 && flips > 50 && runs > 10 && secondClicks > 10, "les parties au hasard couvrent tirages, retournements, découvertes et suites");

  // Pour aller vite : l'indice regarde moins loin ; ces parties vérifient la règle, pas la force.
  g("AI").nodes = 800;
  for (let i = 0; i < 24; i++) await aiGame("sharp");
  for (let i = 0; i < 8; i++) await aiGame("simple");
  const s = aiStats.sharp;
  console.log(`indice : ${s.wins}/${s.games} donnes gagnées, ${(s.moves / s.games).toFixed(0)} coups en moyenne ; ` +
    `simple ${aiStats.simple.wins}/${aiStats.simple.games}`);
  ok(guardHits === 0, `toutes les parties finissent (${guardHits} au garde-fou)`);
  ok(badPolicy === 0, `les politiques ne proposent que des coups légaux (${badPolicy} refusés)`);
  ok(s.wins > 0 && sheets === s.wins + aiStats.simple.wins, `l'indice gagne des donnes, et chaque victoire ouvre la feuille (${s.wins} gagnées, ${sheets} feuilles)`);
  ok(mismatches === 0 && badDraws === 0, "les coups de l'indice suivent la règle");
  ok(g("_peeks") === 0, `les politiques ne lisent aucune carte jamais vue (${g("_peeks")} accès)`);
  ok(g("_impure") === 0 && g("_rand") === 0, `les politiques ne touchent pas à l'état et ne tirent pas au hasard (${g("_impure")}, ${g("_rand")})`);
  g("AI").nodes = 4000;

  await targeted();
  ok(g("_peeks") === 0, `les indices des cas ciblés ne lisent aucune carte cachée (${g("_peeks")})`);
  report("Solitaire");
})();
