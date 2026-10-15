---
name: nouveau-jeu
description: Ajoute un nouveau jeu à gamebox de bout en bout — page HTML autonome en français, adversaires « Tranquille » et « Redoutable », suite de tests Node, banc d'essai de l'IA, mise en page mobile, vignette sur index.html et section dans CLAUDE.md. À utiliser dès que l'utilisateur veut ajouter, créer, porter ou « faire » un jeu (de cartes, de plateau, d'arcade) dans ce dépôt, même s'il ne nomme qu'un jeu (« et si on faisait le Tarot ? », « ajoute le 8 américain »).
---

# Ajouter un jeu à gamebox

Cinq jeux ont déjà été faits ainsi ; chacun a buté sur un piège différent, et la liste ci-dessous les récapitule.
Le fil conducteur : **un fichier HTML autonome, des règles écrites noir sur blanc, des IA qui ne trichent pas, et une
suite de tests qui joue des parties entières sous invariants.** Ne rien partager entre les jeux : copier un motif
d'un autre fichier, oui ; l'importer, non.

Le modèle le plus récent et le plus complet est [trou-du-cul.html](../../../trou-du-cul.html) (avec
`tests/trou-du-cul.test.js` et `tests/trou-du-cul-bench.js`). Pour un jeu de rami ou de combinaisons, voir aussi
`cinq-rois.html` ; pour une grille fixe, `skyjo.html` ; pour un jeu d'action sur canvas, `asteroids.html`.

## 1. Fixer les règles avec l'utilisateur, avant d'écrire du code

Les règles d'un jeu traditionnel ont des variantes, et chaque jeu du dépôt a dû trancher des lectures ambiguës
(Trou du cul : révolution « un tour » lue comme la manche entière ; Uno : contestation du +4 seulement s'il est isolé).
Ces décisions appartiennent à l'utilisateur : poser les questions ensemble (AskUserQuestion), avec une recommandation.

- Source des règles (règle officielle, article Wikipédia FR…) et nom affiché en français.
- Nombre de joueurs (humain contre 1–3, ou 3–5, adversaires), format (manche unique, objectif de points, nombre de
  manches).
- Chaque point ambigu, avec la lecture proposée et pourquoi.
- Variantes au choix sur l'écran de départ, ou règles maison fixes ? (Trou du cul a fini en règles fixes : l'auteur
  du dépôt a préféré moins de boutons.)

Chaque lecture retenue va **dans le panneau des règles du jeu** et dans la section CLAUDE.md : c'est ce qui permet
plus tard de distinguer un bug d'un choix.

## 2. La page

Un seul fichier `<jeu>.html` à la racine, `lang="fr"`, JS et CSS propre au jeu en ligne, aucune dépendance. Un jeu
de cartes charge en plus **la feuille commune `cartes.css`** (section « Shared layout » de CLAUDE.md) : c'est elle qui
donne aux jeux de cartes le même rendu, au bureau comme au téléphone. Reprendre l'ossature des jeux existants (noms
identiques : la feuille commune, le harnais, le banc d'essai et le skill `capture` s'y appuient) :

- **DOM** : `header` (titre, `#roundInfo`, boutons `btnRules` et `btnNew`), `main` avec dans l'ordre `#opponents`
  (une `.player` par adversaire), `#table`, `#status`, `#log`, `#actions` s'il y a des boutons, `#me` (`.name` avec
  « Toi » et un `.tag`, puis la main) ; trois overlays `.overlay > .sheet` : `#startOverlay` (`h3` + `.choice`, puis
  `btnStart`), `#rulesOverlay`, `#scoreOverlay` (`btnNext`, `dataset.over` en fin de partie).
- **Style** : `<link rel="stylesheet" href="cartes.css?v=0">` **avant** le `<style>` du jeu, puis
  `node tests/cartes.test.js --fix` (après avoir ajouté le jeu à sa liste `GAMES`) pour y mettre l'empreinte. Le
  `<style>` du jeu définit sa teinte dans `:root` — `--bg`, `--panel`, `--line`, `--text`, `--dim`, `--bg-top`, `--btn`,
  `--btn-hover`, une teinte qui le distingue des autres — puis ne contient que ce qui lui est propre : faces de
  cartes, contenu de la table, main. Ne pas recopier ce que la feuille commune fait déjà ; si un besoin est commun à
  plusieurs jeux, le mettre dans `cartes.css`.
- **État** : un seul objet `const S = { players, current, phase, round, logs, busy, epoch, … }`, chaque champ
  commenté. `S.phase` est la machine à états ; `render()` en dérive *toutes* les affordances (cartes jouables, piles
  cliquables, texte de statut), et chaque gestionnaire de clic revérifie la phase.
- **Tours** : `beginTurn()` est le seul endroit où un tour commence ; il retourne tout de suite si
  `S.phase === "over"`, et `startRound()` remet la phase à `"idle"` (sinon la manche suivante ne démarre jamais — bug
  déjà livré dans Uno). `aiTurn()` est `async`, rythmé par `sleep()`, met `S.busy`, capture `S.epoch` et abandonne
  après chaque `await` si l'époque a changé (nouvelle manche ou partie lancée entre-temps).
- **Légalité** : une seule fonction (`canPlay`, `canPlayCards`…) que le rendu, les clics et les IA consultent tous.
- **Journal** : `says(p, second, third)` — tutoiement pour l'humain, troisième personne pour les IA. Jamais
  « il »/« elle » : les noms des IA n'ont pas de genre. 3 entrées gardées, rendues une `<div>` par entrée (jamais
  jointes par `<br>`) : la feuille commune cale le journal en bas, sur deux lignes, pour que ce soit la plus ancienne
  qui disparaisse.
- **Ton tour** : `render()` bascule `#me.active` avec le même test que l'anneau `.active` d'un adversaire ; « Toi »
  passe alors à la couleur d'accent.
- **Démarrage** : `let chosenPlayers`, `chosenLevel` (`"simple"`/`"sharp"`, libellés « Tranquille »/« Redoutable »),
  écran construit par `buildChoice()`.
- **Noms de premier niveau** : ne jamais déclarer `top`, `name`, `length`, `status`, `parent`, `self`, `origin`… —
  la liste complète est `WINDOW_GLOBALS` dans `tests/harness.js`. Dans `node:vm` ça passe ; dans un navigateur, le
  script entier ne se parse pas et la page est morte.

### Rendu et mobile

Choisir selon le jeu : DOM construit une fois puis modifié (Skyjo : sa grille fixe porte une transition de
retournement qu'une reconstruction relancerait), ou main reconstruite à chaque `render()` avec `shownUids` pour
n'animer que les nouvelles cartes (Uno, Cinq Rois, Trou du cul).

La mise en page vient de `cartes.css` : adversaires en haut, main en bas, `#table` qui prend la hauteur restante
(`container-type: size`), adversaires en grille et feuilles ancrées en bas sur téléphone, journal masqué sous 700 px
de haut. Restent au jeu :

- **La taille des cartes de la table**, en `cqh`/`cqw` sur la hauteur réelle de `#table`, sous garde
  `@supports (width: 1cqh)` avec un repli en `vh` (sans repli, une unité non gérée laisserait la carte sans largeur).
  Prendre la formule d'Uno ou des Cinq Rois et l'adapter au rapport des cartes et à ce qui entoure la table.
- **La main sur téléphone** : elle passe à la ligne au lieu de défiler, avec une largeur de carte calculée sur
  `100vw` et un nombre de cartes par rangée (`--k`) qui grandit avec la main (Uno par `:has`, Cinq Rois par `--n` posé
  par le rendu). Les groupes de cartes gardent `flex-wrap: wrap` (sinon un groupe plus large que la main déborde des
  deux côtés — Cinq Rois).
- **Un état vide qui reste lisible** : une pile ou un pli vide montre un emplacement en pointillés, pas un trou.

Mesurer avec le skill `capture` et sa pose `fit.js` (portable 1366x650 à 1920x950, téléphones 375x667 à 412x915,
petites et grosses mains) : rien ne doit défiler.

## 3. Les adversaires

Deux politiques derrière une même interface, choisies par `p.policy` via `policyOf(p)` et un objet `POLICIES` :

- `simple` (« Tranquille ») : glouton et lisible.
- `sharp` (« Redoutable ») : compte les cartes à partir de l'information publique uniquement ; ses réglages dans un
  objet `const AI = { … }` commenté, ajustés par le banc d'essai et non à l'œil.

Les politiques sont des décisions pures ; `aiTurn()` gère le temps et l'animation. **Aucune politique ne lit la main
d'un autre joueur, la pioche, ni une carte face cachée — même la sienne.** Une version de Skyjo trichait ainsi ; le
test l'interdit désormais (voir plus bas).

**Terminaison.** Avant de livrer, vérifier qu'une table de `sharp` identiques finit ses manches. Deux jeux du dépôt ont
déjà bouclé sans fin : Skyjo (un bonus « ne pas finir » rendait l'attente toujours rentable — corrigé par une pression
qui croît avec les tours) et Cinq Rois (trois IA se repassaient le même joker par la défausse — corrigé en exigeant
qu'une prise bat strictement l'espérance de la pioche). Soit le jeu termine par construction (le dire dans CLAUDE.md
et pourquoi), soit il a un garde-fou du type `TURN_CAP` que le banc ne doit jamais atteindre.

## 4. Les tests

1. Dans `tests/harness.js` : `const loadX = () => loadDomGame("x.html");` et l'ajouter aux exports.
2. Créer `tests/<jeu>.test.js` sur le modèle de `tests/trou-du-cul.test.js`, en deux parties :
   - **Parties complètes** pour chaque nombre de joueurs et chaque niveau : le siège 0 joue au hasard parmi les coups
     légaux via les gestionnaires de clic (cartes adressées par `uid`, pas par nœud DOM), les autres normalement. Des
     invariants vérifiés à chaque coup en enveloppant les fonctions de premier niveau (`doPlay = function … { check;
     return _doPlay(…) }`) : conservation du paquet (compter aussi les cartes « en main » ou écartées), légalité de
     chaque coup *au moment où il est joué*, bon joueur, fin de manche et scores. Un garde-fou de boucle signale une
     partie qui ne termine pas.
   - **Cas ciblés synchrones** : `aiTurn = async function () {};`, état posé à la main, une assertion par règle et par
     lecture ambiguë choisie à l'étape 1.
3. **Anti-triche** : envelopper `policyOf` pour que, pendant chaque appel de politique, les mains des autres joueurs
   (et la pioche si elle n'est pas publique) soient des `Proxy` qui comptent tout accès par indice ou par itération ;
   `length` reste libre. Copier le bloc de `tests/trou-du-cul.test.js` (chercher `const _policyOf = policyOf`) et
   asserter que le compteur vaut 0.
4. **Noms de premier niveau** : `ok(globalClashes("x.html").length === 0, …)`.
5. Ajouter le fichier à la liste de `tests/run-all.js`, et un jeu de cartes à la liste `GAMES` de
   `tests/cartes.test.js` (lien vers la feuille commune, empreinte, teinte).

Pièges du harnais : lire l'état avec `g("S")` (un `const` de premier niveau n'est pas sur l'objet bac à sable) ;
attendre avec `tick()` (`setImmediate`), jamais `setTimeout(fn, 0)` qui coûte 1 ms par appel ; l'horloge du bac à sable
déclenche immédiatement, donc une partie entière tourne en millisecondes.

## 5. Le banc d'essai

`tests/<jeu>-bench.js` sur le modèle de `tests/trou-du-cul-bench.js` (ou `cinq-rois-bench.js` pour le mode `stall`) :
toutes les places tenues par l'IA (`p.ai = true` sur le siège 0, relancer le tour s'il commence), puis trois modes :

- par défaut : un `sharp` contre des `simple`, taux de victoire (référence 1/n) et score moyen par manche ;
- `sweep` : compare des réglages de l'objet `AI` — juger sur le score moyen par manche, bien moins bruité que le taux
  de victoire ;
- `stall` : uniquement des `sharp`, doit rapporter zéro partie bloquée.

Ce n'est pas un test : il ne va pas dans `run-all.js`. Noter les chiffres obtenus (nombre de parties, victoires,
score moyen) : ils vont dans CLAUDE.md et dans le message de commit.

## 6. Accueil, documentation, vérification

- **`index.html`** : une `<a class="game" href="x.html">` avec un aperçu en pur CSS/SVG (`.preview.p-x` et ses règles
  dans le `<style>`), un `<h2>`, une phrase d'accroche qui tutoie, `Jouer →`. La grille centre une carte orpheline
  avec des règles `:nth-child(…):last-child` (4 colonnes, puis 6 au-delà de 1100 px) : les revoir pour le nouveau
  nombre de cartes. Lien relatif (`x.html`, jamais `/x.html` : le site vit sous `/gamebox/`). Le jeu ne renvoie pas
  vers l'accueil.
- **`CLAUDE.md`** : le jeu dans la liste « Project », sa commande dans « Verifying changes », le paragraphe du harnais
  qui énumère les jeux pilotés, la liste des jeux de « Shared layout » pour un jeu de cartes, et une section
  « Architecture — x.html » au format des autres : règles telles qu'implémentées (avec les lectures choisies), flux et
  légalité, IA et chiffres du banc, ce que le rendu ajoute au gabarit commun, et le piège qui a mordu pendant le
  développement s'il y en a eu un.
- **Vérifier** : `node tests/run-all.js` au vert ; le banc en mode `stall` à zéro ; puis le skill `capture` — le jeu
  au bureau et sur téléphone avec `fit.js` (portable court 1366x650 compris, petites et grosses mains), la feuille des
  scores, les règles, et `index.html` aux deux largeurs. Le comparer à côté d'un autre jeu de cartes à la même taille :
  ils doivent se ressembler. La capture est le seul contrôle qui voie une page morte. Dire à l'utilisateur que le
  tactile reste à essayer sur un vrai téléphone.

## 7. Livrer

`main` est la production (GitHub Pages, en ligne en une minute) : ne commiter et ne pousser que sur demande. Message
dans le style du dépôt :

```
<Nom du jeu> : nouveau jeu, IA et suite de tests

<Le jeu en deux ou trois phrases : source des règles, joueurs, format,
lectures notables.>

Deux adversaires : « Tranquille » <…>, « Redoutable » qui <…> (<x> %
de victoires à <n> joueurs contre le premier sur <N> parties).

Page d'accueil : <ce qui a changé dans la grille>.
```

suivi des lignes d'attribution demandées par la session.
