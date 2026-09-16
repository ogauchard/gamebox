/* Harnais de test commun aux jeux.
 *
 * Aucun navigateur n'est requis : le <script> inline de chaque page est extrait
 * puis exécuté dans un contexte `node:vm` face à des bouchons. Cela couvre toute
 * la logique de jeu, mais **rien du rendu** — pour ça, voir la capture headless
 * décrite dans CLAUDE.md, et un vrai téléphone pour le tactile.
 *
 * À savoir pour lire l'état du jeu depuis un test :
 *   - un `const` de premier niveau (`S`, `game`, `CFG`…) vit dans la portée
 *     lexicale du contexte : on le récupère avec g("S"), pas via sandbox.S ;
 *   - une `function` de premier niveau atterrit sur l'objet global du contexte,
 *     donc elle est remplaçable depuis le test (utile pour instrumenter
 *     `endTurn` ou `clearColumns`).
 */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");

const readInlineScript = (file) =>
  fs.readFileSync(path.join(ROOT, file), "utf8").match(/<script>([\s\S]*?)<\/script>/)[1];

/* ------------------------------------------------------------- Faux DOM */
/* Juste ce dont skyjo.html se sert. `innerHTML =` remet les enfants à zéro,
   et querySelector renvoie un bouchon stable par sélecteur, ce qui suffit au
   couple buildBoard()/render(). */
class FakeEl {
  constructor(tag = "div") {
    this.tagName = tag;
    this._kids = [];
    this._sel = new Map();
    this._listeners = {};
    this.dataset = {};
    this._text = "";
    this._class = new Set();
    this.hidden = false;
    this.disabled = false;
    this.style = { setProperty() {}, removeProperty() {} };
    this.classList = {
      add: (c) => this._class.add(c),
      remove: (c) => this._class.delete(c),
      contains: (c) => this._class.has(c),
      toggle: (c, on) => {
        const want = on === undefined ? !this._class.has(c) : !!on;
        want ? this._class.add(c) : this._class.delete(c);
        return want;
      },
    };
  }
  get className() { return [...this._class].join(" "); }
  set className(v) { this._class = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get textContent() { return this._text; }
  set textContent(v) { this._text = String(v); }
  set innerHTML(v) { this._html = v; this._kids = []; this._sel.clear(); }
  get innerHTML() { return this._html || ""; }
  get children() { return this._kids; }
  appendChild(c) { this._kids.push(c); return c; }
  addEventListener(t, fn) { (this._listeners[t] ||= []).push(fn); }
  querySelector(sel) {
    if (!this._sel.has(sel)) {
      const stub = new FakeEl("span");
      this._sel.set(sel, stub);
      this._kids.push(stub);
    }
    return this._sel.get(sel);
  }
  querySelectorAll(sel) {
    const want = sel.replace(".", "");
    const out = [];
    const walk = (n) => { for (const k of n._kids) { if (k._class.has(want)) out.push(k); walk(k); } };
    walk(this);
    return out;
  }
  click() { for (const fn of this._listeners.click || []) fn(); }
}

/* ------------------------------------------------ Jeux de cartes (DOM) */
/* Skyjo, Uno et Les Cinq Rois se chargent de la même façon.
   L'horloge du bac à sable déclenche immédiatement : les temporisations
   d'animation de l'IA s'effondrent et une partie entière tient en quelques
   millisecondes. setImmediate plutôt que setTimeout(fn, 0) — Node bride ce
   dernier à ~1 ms, ce qui domine tout le reste sur des milliers de tours.
   Le siège humain se pilote par appels directs aux gestionnaires de clic
   (onHandClick…). Quand le rendu reconstruit une main à chaque tour, inutile
   de chercher les boutons : on passe l'uid de la carte. */
function loadDomGame(file) {
  const byId = new Map();
  const schedule = (fn) => setImmediate(fn);
  const sandbox = {
    console,
    document: {
      getElementById: (id) => {
        if (!byId.has(id)) byId.set(id, new FakeEl());
        return byId.get(id);
      },
      createElement: (tag) => new FakeEl(tag),
    },
    setTimeout: schedule,
    clearTimeout: () => {},
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(readInlineScript(file), sandbox, { filename: file.replace(".html", ".js") });

  const g = (expr) => vm.runInContext(expr, sandbox);
  return { g, S: g("S"), byId, tick: () => new Promise((r) => schedule(r)) };
}

const loadSkyjo = () => loadDomGame("skyjo.html");
const loadUno = () => loadDomGame("uno.html");
const loadCinqRois = () => loadDomGame("cinq-rois.html");

/* -------------------------------------------------------------- Asteroids */
/* On retient le rappel de requestAnimationFrame pour le rejouer avec des
   horodatages synthétiques : les images défilent de façon déterministe. */
function loadAsteroids() {
  const noop = () => {};
  const ctxStub = new Proxy({}, {
    get(t, p) {
      if (p === "canvas") return {};
      if (p === "measureText") return () => ({ width: 10 });
      return t[p] !== undefined ? t[p] : noop;
    },
    set(t, p, v) { t[p] = v; return true; },
  });

  const listeners = {};
  const store = {};
  let rafCb = null;
  const canvasEl = { style: {}, width: 0, height: 0, getContext: () => ctxStub, addEventListener: noop };

  const sandbox = {
    console,
    devicePixelRatio: 1,
    innerWidth: 1200,
    innerHeight: 900,
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = v; },
    },
    performance: { now: () => 0 },
    requestAnimationFrame: (cb) => { rafCb = cb; return 1; },
    addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
    document: {
      getElementById: () => canvasEl,
      querySelectorAll: () => [],
      addEventListener: noop,
      hidden: false,
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(readInlineScript("asteroids.html"), sandbox, { filename: "asteroids.js" });

  const g = (expr) => vm.runInContext(expr, sandbox);
  const fire = (type, code) => {
    for (const fn of listeners[type] || []) fn({ code, repeat: false, preventDefault: noop, target: null });
  };
  let now = 0;
  return {
    g,
    game: g("game"),
    store,
    keyDown: (code) => fire("keydown", code),
    keyUp: (code) => fire("keyup", code),
    step(frames = 1) {
      for (let i = 0; i < frames; i++) {
        now += 1000 / 60;
        const cb = rafCb;
        rafCb = null;
        cb(now);
      }
    },
  };
}

/* -------------------------------------------- Collisions avec window.* */
/* `node:vm` n'a pas d'objet Window : un `const top = …` de premier niveau y
   passe sans broncher alors qu'il fait échouer *tout* le script au parsing dans
   un navigateur (« Identifier 'top' has already been declared »), page morte et
   aucune suite de tests pour s'en apercevoir. Cette liste couvre les propriétés
   non redéfinissables de Window ; renommer coûte moins cher que douter. */
const WINDOW_GLOBALS = [
  "window", "self", "document", "name", "location", "history", "customElements",
  "locationbar", "menubar", "personalbar", "scrollbars", "statusbar", "toolbar",
  "status", "closed", "frames", "length", "top", "opener", "parent", "frameElement",
  "navigator", "origin", "external", "screen", "innerWidth", "innerHeight",
  "scrollX", "pageXOffset", "scrollY", "pageYOffset", "screenX", "screenY",
  "outerWidth", "outerHeight", "devicePixelRatio",
];

/* Noms déclarés en tête de ligne — la colonne 0 est, dans ces pages, la marque
   du premier niveau. */
function globalClashes(file) {
  const src = readInlineScript(file);
  const names = new Set();
  for (const re of [/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm,
                    /^(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm]) {
    for (const m of src.matchAll(re)) names.add(m[1]);
  }
  return WINDOW_GLOBALS.filter((g) => names.has(g));
}

/* ----------------------------------------------------------- Assertions */
function checker() {
  const state = { checks: 0, failures: 0 };
  const seen = new Set();
  const ok = (cond, msg) => {
    state.checks++;
    if (!cond) { state.failures++; console.error("ÉCHEC : " + msg); }
    return cond;
  };
  // Pour les contrôles répétés à chaque tour : ne compte qu'une fois.
  const okOnce = (cond, msg) => {
    if (seen.has(msg)) return cond;
    seen.add(msg);
    return ok(cond, msg);
  };
  const report = (title) => {
    console.log(`${title} : ${state.checks} vérifications, ${state.failures} échec(s).`);
    if (state.failures) process.exitCode = 1;
    return state.failures === 0;
  };
  return { ok, okOnce, report, state };
}

module.exports = { ROOT, FakeEl, loadSkyjo, loadUno, loadCinqRois, loadAsteroids, checker, globalClashes };
