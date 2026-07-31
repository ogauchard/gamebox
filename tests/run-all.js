/* Lance les deux suites de tests. Sortie non nulle si l'une échoue.
 * Le banc d'essai de l'IA (skyjo-bench.js) n'en fait pas partie : c'est une
 * mesure, pas un test, et il prend des dizaines de secondes.
 */
"use strict";

const { spawnSync } = require("child_process");
const path = require("path");

let failed = 0;
for (const file of ["asteroids.test.js", "skyjo.test.js"]) {
  console.log(`\n──────── ${file} ────────`);
  const r = spawnSync(process.execPath, [path.join(__dirname, file)], { stdio: "inherit" });
  if (r.status !== 0) failed++;
}
console.log(failed ? `\n${failed} suite(s) en échec.` : "\nTout est vert.");
process.exit(failed ? 1 : 0);
