/* Lance toutes les suites de tests. Sortie non nulle si l'une échoue.
 * Les bancs d'essai de l'IA (*-bench.js) n'en font pas partie : ce sont des
 * mesures, pas des tests, et ils prennent des dizaines de secondes.
 */
"use strict";

const { spawnSync } = require("child_process");
const path = require("path");

let failed = 0;
for (const file of ["asteroids.test.js", "skyjo.test.js", "uno.test.js", "cinq-rois.test.js", "trou-du-cul.test.js"]) {
  console.log(`\n──────── ${file} ────────`);
  const r = spawnSync(process.execPath, [path.join(__dirname, file)], { stdio: "inherit" });
  if (r.status !== 0) failed++;
}
console.log(failed ? `\n${failed} suite(s) en échec.` : "\nTout est vert.");
process.exit(failed ? 1 : 0);
