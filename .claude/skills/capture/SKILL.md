---
name: capture
description: Prend une capture d'écran d'une page de gamebox (un jeu ou index.html) avec Edge headless, au bureau ou à une vraie largeur de téléphone, éventuellement mise en scène dans un état précis (main de 20 cartes, fin de manche, règles ouvertes…). À utiliser pour vérifier tout changement de CSS ou de rendu, la mise en page mobile, un nouveau jeu avant de le publier, ou dès qu'il faut « voir » une page — même si l'utilisateur ne dit pas « capture » mais « vérifie l'affichage », « ça donne quoi sur téléphone », « regarde la page ».
---

# Capture d'écran d'une page

Les tests Node (`tests/`) couvrent la logique, **rien du rendu** — et ils tournent dans `node:vm`, qui accepte des
scripts qu'un navigateur refuse. Une capture est donc la seule preuve qu'une page s'affiche et que son script se
charge. Après tout changement visible, en prendre au moins une et la regarder (outil Read sur le PNG).

## Le script

```
node .claude/skills/capture/scripts/capture.js <page.html> [options] --out <fichier.png>
```

| option | effet |
| --- | --- |
| `--phone [LxH]` | téléphone, 390x844 par défaut (`375x667` pour un iPhone SE, la hauteur courte qui masque le journal) |
| `--size LxH` | fenêtre de bureau, 900x900 par défaut |
| `--eval "code"` / `--pose f.js` | script injecté après celui de la page, pour la mettre dans un état précis ; cumulables |
| `--budget ms` | temps virtuel avant la capture, 2500 par défaut ; 600000 pour laisser une manche se jouer |
| `--out f.png` | sortie ; la mettre dans le scratchpad de la session, jamais dans le dépôt |

Il ne dépend de rien, n'écrit rien dans le dépôt, et règle les pièges qu'on retombe sinon à chaque fois :

- **La page est toujours dans une iframe à la taille exacte**, bureau compris. Edge impose une largeur de fenêtre
  minimale (~492 px), donc sans iframe pas de téléphone ; et pendant le temps virtuel il fait tourner la page dans une
  fenêtre amputée de son cadre (24 px de large, 92 de haut) qu'il n'agrandit qu'au moment de la photo : sans iframe,
  une mesure prise en JS est fausse, et les cartes retournées en 3D tombées dans la bande amputée sortent en
  **rectangle noir**. Les marges grises à droite et en bas de l'image sont la fenêtre, pas la page.
- **`--headless=old`** : le mode `new` ignore `--window-size` pour le viewport CSS.
- **Profil temporaire** : sans `--user-data-dir`, un Edge déjà ouvert sur la machine récupère la commande et aucune
  capture n'est produite.
- **Liens relatifs** : la copie mise en scène vit hors du dépôt, avec un `<base>` vers le dossier d'origine pour qu'une
  feuille de style commune se charge.

Edge cale parfois (`ETIMEDOUT`) quand plusieurs captures tournent en parallèle : relancer celle-là seule.

## Lire le résultat

Le script affiche le chemin du PNG, puis la console de la page s'il y en a une. **Code de sortie 3 = la page a levé une
erreur** ; la capture porte alors un bandeau rouge avec le message. C'est ce qui attrape un nom de premier niveau qui
masque une propriété de `window` (`const top = …`) : le script entier ne se parse pas, la page a pourtant l'air
presque normale, et aucun test Node ne le voit. Pour une erreur de parsing, la ligne indiquée est celle de la balise
`<script>`, pas celle de la déclaration : c'est le message qui nomme le coupable.

Les avertissements `AudioContext was not allowed to start` d'Asteroids sont normaux (pas de geste utilisateur en
headless) et ne comptent pas comme des erreurs.

## Mettre une page en scène

La pose est un second `<script>` classique placé avant `</body>` : il voit les `const` et `function` de premier niveau
de la page (`S`, `el()`, `render()`, `aiTurn`…) et peut les remplacer. Les recettes testées — démarrer une partie,
geler les adversaires, grossir la main, fin de manche réelle, règles, Asteroids — sont dans
[references/poses.md](references/poses.md). Les lire avant d'en écrire une nouvelle : la plupart des erreurs viennent
d'un état à moitié posé que `render()` ou `showScores()` ne sait pas afficher.

**Mesurer plutôt qu'estimer** : cumuler `--pose .claude/skills/capture/references/fit.js` avec la mise en scène. La
console dit alors si `<main>` défile (`DÉBORDE de 66px` ou `tient`) et la hauteur de chacun de ses blocs. Pour une
mise en page qui doit tenir sans défilement, balayer les tailles (portable court 1366x650, 1536x720, 1280x800,
1920x950, téléphones 390x844, 375x667, 412x915) et lire les chiffres avant les images.

Deux réflexes :

- **Geler l'IA** (`aiTurn = async () => {};`) dès qu'on veut un état précis : sinon les adversaires jouent pendant le
  temps virtuel et l'image change à chaque lancement.
- **Plutôt jouer que fabriquer** : pour un état de fin de manche, laisser l'IA jouer la place du joueur avec un gros
  `--budget` coûte 2 à 3 secondes et donne un état cohérent.

## Que capturer

- **Changement de CSS mobile** : `--phone` et `--phone 375x667`, et pour Uno, Cinq Rois et Trou du cul des mains
  d'environ 5, 13 et 20 cartes, puisque la mise en page dépend de la taille de la main.
- **Changement de rendu de bureau** : `--size 900x900`, une fenêtre plus large (`1400x900`) et surtout un portable
  court (`1366x650` : un écran de 768 px moins la barre du navigateur, cas très courant) ; Cinq Rois a déjà débordé à
  1000 px avec 14 cartes, et Skyjo débordait sur tous les écrans de bureau avant d'être mesuré.
- **Nouveau jeu ou gros changement de script** : au moins une capture sans pose, pour vérifier que le script se charge.
- **Page d'accueil** : `index.html` au bureau et sur téléphone après l'ajout d'une carte.

Plusieurs captures sont indépendantes : les lancer en parallèle (ou dans une même commande) puis les lire ensemble.

## Ce qu'une capture ne prouve pas

Le tactile et la sensation sur un vrai téléphone (taille des cibles sous le pouce, défilement, retour au toucher), ni
les animations, qu'on ne voit qu'à leur état final. Après un changement de mise en page mobile, le dire à
l'utilisateur au lieu de laisser croire que c'est entièrement vérifié.
