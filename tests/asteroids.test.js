/* Asteroids — logique de jeu (aucun rendu n'est vérifié ici).
 * Lancer : node tests/asteroids.test.js
 */
"use strict";

const { loadAsteroids, checker } = require("./harness");

const { game: g, store, keyDown, keyUp, step } = loadAsteroids();
const { ok, report } = checker();

const rock = (x, y, size, r) =>
  ({ x, y, size, r, vx: 0, vy: 0, angle: 0, spin: 0, shape: [1, 1, 1, 1, 1, 1, 1, 1, 1] });
const playerShot = (x, y) => ({ x, y, vx: 0, vy: 0, life: 1, enemy: false });
const playerBullets = () => g.bullets.filter((b) => !b.enemy).length;

/* --- Écran d'accueil */
step(2);
ok(g.state === "attract", "démarre en écran d'accueil");
ok(g.asteroids.length === 8, "astéroïdes de fond en accueil");

/* --- Lancement */
keyDown("Enter"); step(1); keyUp("Enter");
ok(g.state === "playing", "Entrée lance la partie");
ok(g.level === 1 && g.asteroids.length === 4, "vague 1 = 4 gros astéroïdes");
ok(g.lives === 3, "3 vies au départ");

/* --- Pilotage */
const angle0 = g.ship.angle;
keyDown("ArrowRight"); step(10); keyUp("ArrowRight");
ok(g.ship.angle > angle0, "flèche droite fait tourner le vaisseau");
keyDown("ArrowUp"); step(20); keyUp("ArrowUp");
ok(Math.hypot(g.ship.vx, g.ship.vy) > 10, "la poussée accélère le vaisseau");

/* --- Tir automatique en maintenant Espace, plafonné à 4 projectiles */
g.bullets.length = 0;
g.ship.invuln = 9999;                 // ne pas mourir pendant la mesure
keyDown("Space");
step(3);
ok(g.bullets.length === 1, "un seul tir au premier appui (rechargement actif)");
let peak = 0;
for (let i = 0; i < 300; i++) { step(1); peak = Math.max(peak, playerBullets()); }
ok(peak > 1, `maintenir Espace enchaîne les tirs (pic = ${peak})`);
ok(peak <= 4, `jamais plus de 4 tirs joueur à l'écran (pic = ${peak})`);
keyUp("Space");
step(90);
ok(playerBullets() === 0, "le tir s'arrête au relâchement");

g.bullets.length = 0;
keyDown("Space"); step(1); keyUp("Space"); step(1);
ok(playerBullets() === 1, "appui bref = 1 projectile");
step(80);

/* --- Scission et barème */
g.bullets.length = 0;
g.asteroids.length = 0;
g.ship.invuln = 999;
g.asteroids.push(rock(300, 300, 2, 62));
let before = g.score;
g.bullets.push(playerShot(300, 300));
step(1);
ok(g.asteroids.length === 2 && g.asteroids.every((a) => a.size === 1), "gros astéroïde → 2 moyens");
ok(g.score - before === 20, "gros astéroïde = 20 points");

g.asteroids.length = 0;
g.bullets.length = 0;
g.asteroids.push(rock(400, 400, 0, 17));
before = g.score;
g.bullets.push(playerShot(400, 400));
step(1);
ok(g.asteroids.length === 0, "un petit astéroïde détruit ne laisse rien");
ok(g.score - before === 100, "petit astéroïde = 100 points");

/* --- Vague suivante */
g.asteroids.length = 0;
step(150);
ok(g.level === 2 && g.asteroids.length === 5, "vague 2 déclenchée avec 5 astéroïdes");

/* --- Bouclage du monde */
g.ship.x = 5; g.ship.vx = -600; g.ship.vy = 0;
step(2);
ok(g.ship.x > 600, `le vaisseau réapparaît de l'autre côté (x = ${Math.round(g.ship.x)})`);

/* --- Collision, perte de vie, réapparition */
g.ship.invuln = 0;
g.ship.x = 600; g.ship.y = 450; g.ship.vx = 0; g.ship.vy = 0;
g.asteroids.length = 0;
g.asteroids.push(rock(600, 450, 1, 34));
const lives = g.lives;
step(1);
ok(g.lives === lives - 1 && g.ship === null, "collision : vaisseau détruit, une vie en moins");

g.asteroids.length = 0;
step(150);
ok(g.ship !== null && g.ship.invuln > 0, "réapparition avec invulnérabilité");

/* --- Soucoupe */
g.ufoTimer = 0;
g.asteroids.push(rock(100, 100, 0, 17));
step(2);
ok(g.ufo !== null, "la soucoupe apparaît quand le minuteur expire");
step(180);
ok(g.bullets.some((b) => b.enemy), "la soucoupe tire");
if (g.ufo) {
  const kind = g.ufo.kind;
  before = g.score;
  g.bullets.push(playerShot(g.ufo.x, g.ufo.y));
  step(1);
  ok(g.ufo === null, "la soucoupe est détruite par un tir joueur");
  ok(g.score - before === (kind === "small" ? 1000 : 200), `score soucoupe ${kind} correct`);
}

/* --- Vie supplémentaire */
g.score = 9990; g.nextExtra = 10000;
const livesBefore = g.lives;
g.asteroids.length = 0;
g.asteroids.push(rock(200, 200, 0, 17));
g.bullets.push(playerShot(200, 200));
step(1);
ok(g.lives === livesBefore + 1, "vie bonus à 10 000 points");

/* --- Pause */
keyDown("KeyP"); step(1); keyUp("KeyP");
ok(g.state === "paused", "P met en pause");
const snap = { x: g.ship.x, y: g.ship.y };
step(30);
ok(g.ship.x === snap.x && g.ship.y === snap.y, "rien ne bouge en pause");
keyDown("KeyP"); step(1); keyUp("KeyP");
ok(g.state === "playing", "P reprend la partie");

/* --- Fin de partie et record */
g.lives = 1;
g.ship.invuln = 0;
g.asteroids.length = 0;
g.asteroids.push(rock(g.ship.x, g.ship.y, 2, 62));
step(1);
ok(g.state === "gameover", "game over à la dernière vie");
ok(Number(store["asteroids.high"]) === g.high && g.high > 0, "record écrit dans localStorage");

keyDown("Enter"); step(1); keyUp("Enter");
ok(g.state === "gameover", "Entrée ignorée pendant le délai de garde");
step(200);
keyDown("Enter"); step(1); keyUp("Enter");
ok(g.state === "playing" && g.score === 0 && g.lives === 3, "relance possible après le délai");

/* --- Endurance : aucune exception sur 4000 images d'entrées aléatoires */
const codes = ["ArrowLeft", "ArrowRight", "ArrowUp", "Space", "KeyH"];
for (let i = 0; i < 4000; i++) {
  if (Math.random() < 0.08) {
    const c = codes[(Math.random() * codes.length) | 0];
    Math.random() < 0.5 ? keyDown(c) : keyUp(c);
  }
  step(1);
}
ok(true, "4000 images d'entrées aléatoires sans exception");

report("Asteroids");
