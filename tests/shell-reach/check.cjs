#!/usr/bin/env node
// Asserts on the three bundles run.sh built (WS=<workspace>, dist-classic,
// dist-classic-default, dist-shelled) and on the core sources the markers come
// from (SKILL=<skill root>).
//
// WHAT THIS EXISTS TO MEASURE. index.js is the barrel: every one of the 41
// lessons imports "@core", the vite alias resolves that to index.js, and
// index.js re-exports LessonShell from ./ui/LessonShell.jsx with a static
// export. So ui/LessonShell.jsx is in all 41 import graphs. What keeps it out
// of the 39 classic bundles is Rollup dropping an export nothing reaches --
// nothing more, and nothing in the source says so. This fixture reads the
// built JavaScript and says whether it is still true.
//
// Each case reads its own dist tree and they share nothing, so one that stops
// being built fails on its own rather than passing on another's evidence.
"use strict";

const fs = require("fs");
const path = require("path");

const WS = process.env.WS;
const SKILL = process.env.SKILL;
if (!WS) { console.error("WS is not set (run.sh sets it)"); process.exit(2); }
if (!SKILL) { console.error("SKILL is not set (run.sh sets it)"); process.exit(2); }

const CORE = path.join(SKILL, "references/bootstrap/_lesson-core");
// The shell's own two files: the component, and the stylesheet only it imports.
// A string that lives in either of these and nowhere else in the core is in a
// bundle only if that bundle reached the shell. Case 1 holds both halves of
// that sentence to the source.
const SHELL_FILES = ["ui/LessonShell.jsx", "chat/shell.css.js"];

// Strings the shell contributes and nothing else does: rendered text and
// attributes from LessonShell.jsx, plus two class names it shares with its own
// sheet. Case 1 proves each is the shell's alone before any bundle is read --
// a marker that had drifted into a file the 41 all import would make the
// classic cases below assert nothing.
const SHELL_MARKERS = [
  "Position in this lesson",           // the top bar's progress readout, title attr
  "Show contents",                     // the rail toggle's title and aria-label
  "Switch to the dark theme",          // the shell's own theme button, title attr
  "Open the tutor in its own window",  // the pop-out button (inside the tutor gate)
  "topbar-monogram",                   // shell markup, and the rule that paints it
  "rail-label",                        // the contents rail's heading
];

// chat/chat.css.js is the sheet all 41 lessons import and the 39 render on. A
// classic bundle that had lost it would also have "no shell in it", so the
// classic cases assert it is present -- otherwise they pass on an empty build.
const CHAT_SHEET_MARKER = ".theme-toggle-btn";
// From Chatbot.jsx, under the tutor gate: the classic lesson really mounted a
// tutor, so its bundle is the full one and "no shell" is not read off a stub.
// Not the round toggle's "Open the tutor" that tests/hosted-build uses -- that
// is a prefix of the shell's own "Open the tutor in its own window", so it
// would be found in a bundle whether or not the tutor mounted. Case 1 rejects
// it on exactly that ground.
const TUTOR_UI_MARKER = "Pop-ups blocked";

// The whole JS of one dist tree, concatenated. Chunk names are content-hashed
// and Vite may split, so read every .js under assets/ rather than name one.
function bundleJs(name) {
  const dir = path.join(WS, `dist-${name}`, "assets");
  let files;
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith(".js")); }
  catch (e) { throw new Error(`dist-${name} has no assets/ directory: ${e.message}`); }
  if (files.length === 0) throw new Error(`dist-${name}/assets has no .js chunk`);
  return files.map((f) => fs.readFileSync(path.join(dir, f), "utf8")).join("\n");
}

// THE DETECTOR. Every bundle case below runs this one function, so the classic
// cases and the shelled case cannot disagree about what "the shell is in this
// bundle" means.
function shellMarkersIn(js) {
  return SHELL_MARKERS.filter((m) => js.includes(m));
}

// Every .js/.jsx under the core, repo-relative to it.
function coreSources() {
  const out = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== "node_modules") walk(p); }
      else if (/\.(js|jsx)$/.test(e.name)) out.push(path.relative(CORE, p));
    }
  })(CORE);
  return out;
}

let failed = 0;
function check(caseName, claim, ok) {
  if (ok) { console.log(`  ok    ${caseName}: ${claim}`); }
  else { console.log(`  FAIL  ${caseName}: ${claim}`); failed++; }
}

// ── Case 1: the shell is in the graph, and the markers are its alone ───────
// Read before any bundle, because every case after this one is only as good as
// these claims. Four parts: a lesson's "@core" really does resolve to the
// barrel, and the barrel really does name the shell (so there is something for
// Rollup to drop -- without this pair, cases 2 and 3 could be measuring a shell
// that was never in the graph at all); the sheet is the shell's private import;
// each marker is present in the shell's own files; and no other file in the
// core contains one. Drop any part and "absent from the classic bundle" stops
// meaning "the shell is absent".
{
  const sources = coreSources();
  const text = new Map(sources.map((f) => [f, fs.readFileSync(path.join(CORE, f), "utf8")]));

  // The lesson template's vite.config.js is what every scaffolded lesson gets,
  // and "@core" is how all 41 name the core.
  const viteConfig = fs.readFileSync(
    path.join(SKILL, "references/bootstrap/lesson-template/vite.config.js"), "utf8");
  check("markers", '"@core" is aliased to the core directory in the lesson template',
    /["']@core["']\s*:\s*path\.resolve\([^)]*_lesson-core["']\)/.test(viteConfig));
  // ...and the alias resolves to index.js, which re-exports the shell with a
  // static export -- which is why ui/LessonShell.jsx is in all 41 import graphs
  // and why only Rollup keeps it out of the 39 bundles.
  check("markers", "index.js statically re-exports LessonShell from ./ui/LessonShell.jsx",
    /^export\s*\{[^}]*\bLessonShell\b[^}]*\}\s*from\s*["']\.\/ui\/LessonShell\.jsx["']/m
      .test(text.get("index.js")));

  // `import ... from "<anything>/shell.css.js"`. Comments elsewhere in the core
  // name the file in prose; only an import puts it in a bundle.
  const importers = sources.filter((f) =>
    /\bfrom\s+["'][^"']*shell\.css\.js["']/.test(text.get(f)));
  check("markers", `chat/shell.css.js is imported by ui/LessonShell.jsx and nothing else (found: ${importers.join(", ") || "nothing"})`,
    importers.length === 1 && importers[0] === "ui/LessonShell.jsx");

  const others = sources.filter((f) => !SHELL_FILES.includes(f));
  for (const m of SHELL_MARKERS) {
    check("markers", `${JSON.stringify(m)} is in the shell's own files`,
      SHELL_FILES.some((f) => text.get(f).includes(m)));
    const strays = others.filter((f) => text.get(f).includes(m));
    check("markers", `${JSON.stringify(m)} is in no other core file (found: ${strays.join(", ") || "none"})`,
      strays.length === 0);
  }

  // The two non-vacuity markers must NOT come from the shell, or the classic
  // cases would be proving the shell present and absent at once.
  for (const m of [CHAT_SHEET_MARKER, TUTOR_UI_MARKER]) {
    check("markers", `${JSON.stringify(m)} is not one of the shell's strings`,
      !SHELL_FILES.some((f) => text.get(f).includes(m)));
  }
  check("markers", `${JSON.stringify(CHAT_SHEET_MARKER)} is in chat/chat.css.js`,
    text.get("chat/chat.css.js").includes(CHAT_SHEET_MARKER));
}

// ── Case 2: a classic lesson, tutor on ─────────────────────────────────────
// The larger of the two classic builds: the tutor gate drops code and adds
// none, so this bundle carries everything this lesson can reach, and it is the
// build in which all six markers would be live. The shell is in its import
// graph through the barrel and must not be in its bundle.
{
  const js = bundleJs("classic");
  const found = shellMarkersIn(js);
  check("classic", `no LessonShell in the bundle (found: ${found.join(", ") || "nothing"})`,
    found.length === 0);
  check("classic", "the lesson's own sheet (chat/chat.css.js) IS in the bundle", js.includes(CHAT_SHEET_MARKER));
  check("classic", "and the tutor really mounted, so this is the full bundle", js.includes(TUTOR_UI_MARKER));
}

// ── Case 3: a classic lesson, built the way the 39 publish ─────────────────
// Plain `vite build`, nothing else set -- what Netlify and the tailnet run.
// The tutor UI is gated out of this one, so only the sheet is asserted beside
// the shell's absence.
{
  const js = bundleJs("classic-default");
  const found = shellMarkersIn(js);
  check("classic-default", `no LessonShell in the bundle (found: ${found.join(", ") || "nothing"})`,
    found.length === 0);
  check("classic-default", "the lesson's own sheet (chat/chat.css.js) IS in the bundle", js.includes(CHAT_SHEET_MARKER));
}

// ── Case 4: the same lesson, wrapped in the shell ──────────────────────────
// lesson/shelled_demo.jsx is lesson/classic_demo.jsx with <LessonShell> around
// its body and nothing else changed, so this is the red half of cases 2 and 3:
// a classic lesson whose bundle DOES contain the shell, read by the same
// detector. Every marker must be found here. If they were not, cases 2 and 3
// would be reporting "no shell" about strings a build never emits either way.
{
  const js = bundleJs("shelled");
  const found = shellMarkersIn(js);
  const missing = SHELL_MARKERS.filter((m) => !found.includes(m));
  check("shelled", `the detector finds all ${SHELL_MARKERS.length} markers when the shell IS reached (missing: ${missing.join(", ") || "none"})`,
    missing.length === 0);
}

console.log(failed === 0 ? "\nshell-reach: all cases passed" : `\nshell-reach: ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
