/* Capture d'écran d'une page du dépôt avec Edge headless.
 *
 *   node capture.js <page.html> [options]
 *
 *   --phone [LxH]   largeur de téléphone (390x844 par défaut) : la page est
 *                   chargée dans une iframe à cette taille, seul moyen de passer
 *                   sous la largeur minimale de fenêtre d'Edge (~492 px)
 *   --size LxH      fenêtre de bureau (900x900 par défaut)
 *   --pose f.js     script injecté après celui de la page, pour la mettre dans
 *                   un état précis (il voit les const/function de premier niveau)
 *   --eval "code"   idem, en ligne ; --pose et --eval se cumulent
 *   --budget ms     temps virtuel laissé aux transitions (2500 par défaut)
 *   --out f.png     fichier de sortie (sinon dans le dossier temporaire)
 *
 * Une erreur de la page ou de la pose n'est pas silencieuse : un bandeau rouge
 * avec le message s'affiche en haut de la capture. C'est ce qui attrape un
 * script qui ne se parse pas dans un navigateur alors que node:vm l'accepte.
 * Ni dépendance ni serveur : tout passe par des fichiers temporaires en file://,
 * rien n'est écrit dans le dépôt.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { pathToFileURL } = require("url");

const EDGE = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].find((p) => fs.existsSync(p));

function usage(msg) {
  if (msg) console.error(msg);
  console.error("usage : node capture.js <page.html> [--phone [LxH] | --size LxH] [--pose f.js] [--eval code] [--budget ms] [--out f.png]");
  process.exit(2);
}

const args = process.argv.slice(2);
const opt = { page: null, phone: null, size: "900x900", poses: [], budget: 2500, out: null };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  const next = () => (i + 1 < args.length ? args[++i] : usage(`${a} attend une valeur`));
  if (a === "--phone") opt.phone = /^\d+x\d+$/.test(args[i + 1] || "") ? args[++i] : "390x844";
  else if (a === "--size") opt.size = next();
  else if (a === "--pose") opt.poses.push(fs.readFileSync(next(), "utf8"));
  else if (a === "--eval") opt.poses.push(next());
  else if (a === "--budget") opt.budget = Number(next());
  else if (a === "--out") opt.out = path.resolve(next());
  else if (a.startsWith("--")) usage(`option inconnue : ${a}`);
  else opt.page = a;
}
if (!opt.page) usage();
if (!EDGE) usage("Edge introuvable.");
const pagePath = path.resolve(opt.page);
if (!fs.existsSync(pagePath)) usage(`page introuvable : ${pagePath}`);

const dim = (s) => { const m = /^(\d+)x(\d+)$/.exec(s); if (!m) usage(`taille invalide : ${s}`); return [+m[1], +m[2]]; };
const [w, h] = dim(opt.phone || opt.size);

const work = fs.mkdtempSync(path.join(os.tmpdir(), "gamebox-capture-"));
const base = path.basename(pagePath, ".html");
const out = opt.out || path.join(os.tmpdir(), `${base}-${opt.phone ? "phone-" : ""}${w}x${h}.png`);

/* Bandeau d'erreur : posé avant tout autre script pour voir aussi les erreurs
   de parsing du script de la page. */
const BANNER = `<script>
(function () {
  var shown = [];
  function show(msg) {
    shown.push(msg);
    var put = function () {
      var b = document.getElementById("__captureErr") || document.body.appendChild(document.createElement("pre"));
      b.id = "__captureErr";
      b.style.cssText = "position:fixed;z-index:2147483647;top:0;left:0;right:0;margin:0;padding:8px 10px;"
        + "background:#b00020;color:#fff;font:12px/1.35 monospace;white-space:pre-wrap";
      b.textContent = "ERREUR\\n" + shown.join("\\n");
    };
    document.body ? put() : addEventListener("DOMContentLoaded", put);
  }
  addEventListener("error", function (e) { show(e.message + (e.lineno ? " (ligne " + e.lineno + ")" : "")); });
  addEventListener("unhandledrejection", function (e) { show("promesse rejetée : " + (e.reason && e.reason.message || e.reason)); });
})();
</script>`;

let html = fs.readFileSync(pagePath, "utf8");
const headLine = html.slice(0, html.search(/<head[^>]*>/i)).split("\n").length;
const shift = BANNER.split("\n").length;   // lignes ajoutées après <head>, à retrancher des numéros d'Edge
html = html.replace(/<head[^>]*>/i, (m) => `${m}\n${BANNER}`);
if (opt.poses.length) {
  // Un script classique séparé : il voit les déclarations de premier niveau de
  // la page, et une erreur dans la pose ne casse pas la page elle-même.
  const pose = opt.poses.join("\n;\n").replace(/<\/script/gi, "<\\/script");
  html = html.replace(/<\/body>(?![\s\S]*<\/body>)/i, `<script>\n${pose}\n</script>\n</body>`);
}
// Les pages ne chargent aucune ressource relative : la copie peut vivre hors du dépôt.
const posed = path.join(work, path.basename(pagePath));
fs.writeFileSync(posed, html);
try { fs.unlinkSync(out); } catch {}   // qu'une ancienne capture ne passe pas pour la nouvelle

let target = posed;
let win = [w, h];
if (opt.phone) {
  const wrapper = path.join(work, "phone.html");
  fs.writeFileSync(wrapper, `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
html,body{margin:0;background:#3a3a3a;overflow:hidden}iframe{display:block;border:0;background:#fff}
</style></head><body><iframe src="${pathToFileURL(posed).href}" width="${w}" height="${h}"></iframe></body></html>`);
  target = wrapper;
  win = [Math.max(w, 500), h];   // Edge refuse une fenêtre plus étroite : la marge à droite reste grise
}

const r = spawnSync(EDGE, [
  "--headless=old", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--disable-extensions",
  "--enable-logging=stderr", "--v=0",
  `--user-data-dir=${path.join(work, "profile")}`,
  `--virtual-time-budget=${opt.budget}`,
  `--window-size=${win[0]},${win[1]}`,
  `--screenshot=${out}`,
  pathToFileURL(target).href,
], { encoding: "utf8", timeout: 60000 });

try { fs.rmSync(work, { recursive: true, force: true }); } catch {}

if (!fs.existsSync(out) || fs.statSync(out).size === 0) {
  console.error("Échec de la capture.", r.error ? r.error.message : "", (r.stderr || "").slice(-2000));
  process.exit(1);
}

/* Console de la page : on ne garde que ce qui vient des fichiers file://
   (Edge y mêle ses propres extensions). Le numéro de ligne est recalé sur la
   page d'origine ; il est faux pour une ligne de la pose, qui suit </body>. */
const consoleLines = [];
let errors = 0;
for (const m of (r.stderr || "").matchAll(/INFO:CONSOLE[^\]]*\] "(.*)", source: (file:\/\/\S*) \((\d+)\)/g)) {
  const line = Number(m[3]);
  const orig = line > headLine + shift ? line - shift : line;
  if (/^Uncaught|Error\b/.test(m[1])) errors++;
  consoleLines.push(`  ${m[1]} (${path.basename(decodeURIComponent(m[2]))}:${orig})`);
}
console.log(out);
if (consoleLines.length) console.log("Console de la page :\n" + consoleLines.join("\n"));
if (errors) {
  console.error(`${errors} erreur(s) dans la page : la capture montre un bandeau rouge.`);
  process.exit(3);
}
