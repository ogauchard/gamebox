# Mises en scène éprouvées

Chaque extrait se passe à `--eval '…'` ou s'écrit dans un fichier pour `--pose`. Il s'exécute après le script de la
page, une fois le DOM construit : il voit `S`, `el()`, `render()`, `aiTurn`… Chacun a été testé sur les jeux qu'il
nomme.

## Démarrer une partie (Skyjo, Uno, Cinq Rois, Trou du cul)

Les quatre jeux de cartes partagent les mêmes noms : le bouton `btnStart`, `startGame()`, `aiTurn()`, `beginTurn()`,
`render()`. Une partie a toujours 4 joueurs, toi et 3 adversaires « Redoutable » : rien à choisir avant le clic.

```js
aiTurn = async () => {};   // gèle les adversaires : sans ça ils jouent pendant le budget de temps virtuel
el("btnStart").click();
```

Sans le gel, la capture montre un moment quelconque de la partie, différent à chaque lancement. Si un adversaire
commence, la table reste figée sur « X réfléchit… » ; pour avoir la main, ajouter `S.current = 0; beginTurn();`.

Seul Uno a encore des options, à poser **avant** le clic : `chosenFormat` (`"match"`/`"single"`) et `chosenVariants`
(objet `{ stack, challenge, sevenZero }`).

## Grossir la main du joueur (Uno, Cinq Rois, Trou du cul)

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
// Uno, Cinq Rois, Trou du cul — lancer avec --budget 600000
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
