/* Gabarit commun des jeux de cartes (cartes.css).
 *
 *   node tests/cartes.test.js         vérifie
 *   node tests/cartes.test.js --fix   met à jour l'empreinte dans les liens
 *
 * Chaque jeu de cartes charge cartes.css?v=<empreinte>, avant son propre
 * <style>. L'empreinte est celle du contenu de la feuille : GitHub Pages garde
 * les fichiers 10 minutes en cache, et un lien inchangé après une retouche
 * servirait l'ancienne feuille avec la nouvelle page. Ce test échoue tant que
 * les liens ne suivent pas le contenu ; --fix les réécrit.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { ROOT, checker } = require("./harness");

const { ok, report } = checker();
const GAMES = ["skyjo.html", "uno.html", "cinq-rois.html", "trou-du-cul.html", "turkish.html", "six-qui-prend.html"];
const OTHERS = ["asteroids.html", "index.html"];
// Les jetons de teinte que chaque page doit définir (voir l'en-tête de cartes.css).
const TINT = ["--bg", "--panel", "--line", "--text", "--dim", "--bg-top", "--btn", "--btn-hover"];

const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
// Fins de ligne normalisées : une copie Windows (CRLF) et GitHub (LF) donnent
// la même empreinte.
const css = read("cartes.css").replace(/\r\n/g, "\n");
const hash = crypto.createHash("sha256").update(css).digest("hex").slice(0, 8);
const LINK = /<link rel="stylesheet" href="cartes\.css(?:\?v=([0-9a-f]*))?">/g;

if (process.argv.includes("--fix")) {
  for (const f of GAMES) {
    const src = read(f);
    const out = src.replace(LINK, `<link rel="stylesheet" href="cartes.css?v=${hash}">`);
    if (out !== src) { fs.writeFileSync(path.join(ROOT, f), out); console.log(`${f} : lien mis à jour (v=${hash})`); }
  }
}

for (const f of GAMES) {
  const src = read(f);
  const links = [...src.matchAll(LINK)];
  ok(links.length === 1, `${f} charge cartes.css une fois (${links.length})`);
  if (links.length === 1) {
    ok(links[0][1] === hash,
      `${f} : le lien porte l'empreinte du contenu actuel (v=${links[0][1]} au lieu de v=${hash} — lancer node tests/cartes.test.js --fix)`);
    ok(links[0].index < src.indexOf("<style>"), `${f} charge cartes.css avant son propre <style>, qui peut ainsi le préciser`);
  }
  const style = (src.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || "";
  const root = (style.match(/:root\s*\{([\s\S]*?)\}/) || [])[1] || "";
  const missing = TINT.filter((t) => !new RegExp(`${t}\\s*:`).test(root));
  ok(missing.length === 0, `${f} définit sa teinte dans son :root (manque : ${missing.join(", ")})`);
  ok(!/href="\/cartes\.css/.test(src), `${f} : lien relatif — le site vit sous /gamebox/`);
}
for (const f of OTHERS) ok(!read(f).includes("cartes.css"), `${f} reste indépendant de cartes.css`);

report("Gabarit commun");
