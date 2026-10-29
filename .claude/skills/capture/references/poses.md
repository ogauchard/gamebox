# Mises en scène éprouvées

Chaque extrait se passe à `--eval '…'` ou s'écrit dans un fichier pour `--pose`. Il s'exécute après le script de la
page, une fois le DOM construit : il voit `S`, `el()`, `render()`, `aiTurn`… Chacun a été testé sur les jeux qu'il
nomme.

## Démarrer une partie (Skyjo, Uno, Cinq Rois, Trou du cul, Turkish, 6 qui prend)

Les six jeux de cartes partagent les mêmes noms : le bouton `btnStart`, `startGame()`, `aiTurn()`, `beginTurn()`,
`render()`. Une partie a toujours 4 joueurs, toi et 3 adversaires « Redoutable » : rien à choisir avant le clic.

```js
aiTurn = async () => {};   // gèle les adversaires : sans ça ils jouent pendant le budget de temps virtuel
el("btnStart").click();
```

Sans le gel, la capture montre un moment quelconque de la partie, différent à chaque lancement. Si un adversaire
commence, la table reste figée sur « X réfléchit… » ; pour avoir la main, ajouter `S.current = 0; beginTurn();`.

Au 6 qui prend, le gel empêche les adversaires de choisir leur carte : la révélation n'arrive jamais, et l'on peut
poser une sélection (`S.sel = S.players[0].hand.at(-1).uid; render();`) pour voir l'aperçu de sa rangée. Sa main ne
grossit pas (dix cartes, une de moins par tour) : la recette ci-dessous ne s'y applique pas.

Options à poser **avant** le clic : pour Uno, `chosenFormat` (`"match"`/`"single"`) et `chosenVariants` (objet
`{ stack, challenge, sevenZero }`) ; pour Turkish, `chosenRounds` (4, 8 ou 12 donnes).

## Grossir la main du joueur (Uno, Cinq Rois, Trou du cul, Turkish)

La mise en page mobile dépend de la taille de la main : poser au moins une petite main (~5), une moyenne (~13) et une
grosse (~20).

```js
aiTurn = async () => {};
el("btnStart").click();
const me = S.players[0];
const extra = shuffle(buildDeck());      // cartes neuves, uid uniques ; la conservation du paquet n'importe pas ici
                                         // (sans shuffle, buildDeck() est trié : tous les jokers d'un coup)
while (me.hand.length < 20) me.hand.push(extra.pop());
S.current = 0; beginTurn();               // la main est jouable : anneaux et cartes surlevées visibles
```

Pour réduire la main : `me.hand.length = 5;` avant `beginTurn()`.

## Skyjo : grilles retournées

```js
aiTurn = async () => {};
el("btnStart").click();
S.players.forEach((p) => p.grid.forEach((c) => { c.up = true; }));
render();
```

Une colonne retirée : `[0, 4, 8].forEach((i) => { S.players[0].grid[i].removed = true; }); render();`. La grille est
construite une fois par `buildBoard()` puis modifiée par `render()` : ne jamais reconstruire le DOM soi-même.

## Fin de manche réelle (feuille des scores)

Ne pas fabriquer les scores à la main : Cinq Rois et Trou du cul lisent dans `showScores()` un état de fin de manche
(arrangements, classement) qu'une pose partielle ne remplit pas — erreur et bandeau rouge garantis. Laisser plutôt
l'IA jouer la place du joueur et la manche aller à son terme, en temps virtuel (2 à 3 s réelles) :

```js
// Uno, Cinq Rois, Trou du cul, Turkish, 6 qui prend — lancer avec --budget 600000 (900000 pour Turkish)
el("btnStart").click();
Object.assign(S.players[0], { ai: true, policy: "simple" });
if (S.current === 0) beginTurn();   // sinon un tour d'IA est déjà en vol : ne pas en lancer un second
```

```js
// Skyjo — la mise en place attend que le joueur retourne deux cartes ; --budget 600000
el("btnStart").click();
const me = S.players[0];
Object.assign(me, { ai: true, policy: "greedy" });
me.grid[0].up = me.grid[1].up = true;
decideStarter(); beginTurn();
```

La partie s'arrête d'elle-même sur la feuille des scores, qui attend un clic sur « Manche suivante ». Le résultat
change à chaque lancement.

## Règles

```js
el("btnRules").click();
```

## Asteroids

Sans pose : écran d'attente, astéroïdes en mouvement. Pour une partie en cours :

```js
press("Enter");            // le prochain tour de boucle consomme la pression et lance la partie
```

`Math.random` n'est pas fixé : deux captures ne se ressemblent jamais exactement.

## 5000 : des dés imposés

`btnStart`, `startGame()`, `aiTurn()`, `render()` comme les jeux de cartes ; le siège 0 commence la première partie.
Les dés sortent de `rollDie()`, qu'on remplace pour poser un lancer précis. Tous les dés qui marquent sont gardés
d'office (`keepDice()` les met de côté) — ici un 1 gardé, puis un brelan de 1 sur les quatre dés relancés :

```js
aiTurn = async () => {};
el("btnStart").click();
const seq = [1, 2, 3, 4, 6, 1, 1, 1, 4];
rollDie = () => seq.shift();
throwDice(); keepDice(); throwDice();
render();
```

Pour un plateau de dés gardés bien rempli (le cas le plus haut de la table) : un full (main pleine) puis trois dés
gardés un à un — `throwDice(); keepDice();` quatre fois, avec dans `seq` un full puis trois lancers qui ne font
marquer qu'un 1 ou un 5. Un tour perdu (ballot, lancer raté, dépassement) reste affiché 1,5 s : `--budget 700` pour le saisir.
Fin de partie : la recette « Fin de manche réelle » ci-dessus, `--budget 900000`.

## 6 qui prend : une manche en cours

Laisser l'ordinateur jouer la place du joueur quelques tours : 16 s de temps virtuel mènent vers le 4e tour, rangées
garnies et cartes révélées dans les vignettes. L'état exact change à chaque lancement.

```js
// --budget 16000
el("btnStart").click();
Object.assign(S.players[0], { ai: true, policy: "simple" });
```

## Killer : ta visée, une attaque en cours

Mêmes noms que le 5000 ; les dés sortent de `rollDie()`. Ta visée, deux 1 gardés puis un dé choisi dans le lancer
suivant (la jauge éteint ce que la relance ne peut plus donner) :

```js
aiTurn = async () => {};
el("btnStart").click();
S.current = 0; S.phase = "idle"; beginTurn();
const seq = [1, 1, 4, 6, 2, 1, 5, 3];
rollDie = () => (seq.length ? seq.shift() : 3);
onRollClick();
onDieClick(S.dice[0].uid); onDieClick(S.dice[1].uid);
onRollClick();
onDieClick(S.dice[0].uid);
```

Une attaque est asynchrone (elle attend entre ses lancers) : pour la figer, poser la phase et appeler `throwAttack(v)`
soi-même. Ici l'attaque aux 6 de Nora contre toi, les cinq dés repartis puis quatre touches de côté — le plateau le
plus rempli :

```js
aiTurn = async () => {};
el("btnStart").click();
S.current = 1; S.phase = "idle"; beginTurn();
const seq = [1, 1, 1, 1, 1, 6, 6, 6, 6, 6, 6, 6, 6, 6, 1, 2];
rollDie = () => (seq.length ? seq.shift() : 3);
throwDice(); stopAim();
S.phase = "attack"; S.target = 0; S.busy = true; S.kept = []; S.dice = []; S.free = 5; S.hits = 0;
throwAttack(6); throwAttack(6); throwAttack(6);
render();
```

Le choix de la cible : un lancer de 8 puis `onStopClick()`. Fin de partie réelle : `Object.assign(S.players[0], { ai:
true, policy: "sharp" }); if (S.current === 0) aiTurn();` après le clic, `--budget 1500000` (une partie entre quatre
redoutables dure environ 7 minutes de temps virtuel, 11 pour neuf sur dix).
