/* Pose de mesure : à cumuler avec une mise en scène (--pose fit.js après --eval).
   Affiche dans la console, une fois le rendu posé, si la zone de jeu défile et
   la hauteur occupée par chaque bloc de <main>. La capture passe par une iframe
   de la taille exacte : innerWidth/innerHeight sont ceux de la vue demandée.

   Les animations et transitions sont coupées avant la mesure : sous Edge headless
   le temps virtuel ne les fait pas avancer, et une carte figée au début de son
   animation d'apparition (« pop », décalée vers le bas) passerait pour un
   débordement qui n'existe pas dans un vrai navigateur. */
{
  const st = document.createElement("style");
  st.textContent = "*, *::before, *::after { animation: none !important; transition: none !important; }";
  document.head.appendChild(st);
}
setTimeout(() => {
  const m = document.querySelector("main");
  if (!m) { console.log("fit : pas de <main>"); return; }
  const over = m.scrollHeight - m.clientHeight;
  const parts = [...m.children]
    .filter((c) => getComputedStyle(c).display !== "none")
    .map((c) => `${c.id || c.className || c.tagName}=${Math.round(c.getBoundingClientRect().height)}`);
  console.log(`fit ${innerWidth}x${innerHeight} : ${over > 1 ? `DÉBORDE de ${over}px` : "tient"} · ${parts.join(" ")}`);
}, 300);
