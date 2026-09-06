#!/usr/bin/env node
// Asserts on the four bundles run.sh built (WS=<workspace>, dist-default,
// dist-hosted, dist-dev-mode, dist-no-slash). Every claim is read out of the BUILT
// JavaScript, not out of the source: the point of putting the gate in
// `_lesson-core/constants/build.js` is that Vite decides it at build time, and
// only the built output shows whether it did.
//
// Each case reads its own dist tree. They share nothing, so one that stops
// being built fails on its own rather than passing on another's evidence.
"use strict";

const fs = require("fs");
const path = require("path");

const WS = process.env.WS;
if (!WS) { console.error("WS is not set (run.sh sets it)"); process.exit(2); }

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

// Every endpoint constants/build.js resolves, as the path under the base.
const ENDPOINTS = [
  "chat", "chat/cancel", "commit", "sessions",
  "session/init", "session/open", "session/close", "session/transfer",
  "thread/open", "thread/fold", "upload",
];

// Strings that exist only inside the tutor UI the gate drops. Two kinds of
// string do NOT belong here and would make this assertion pass for nothing:
// class names (chat.css.js ships the stylesheet either way, so `.chat-panel` is
// in every bundle) and module-level data (ANSWER_STYLES' "Hints first" is read
// outside the gate too). These are all rendered text or attributes under it.
const TUTOR_UI = [
  "Open the tutor",              // the round toggle's title
  "Pop-ups blocked",             // inside the panel, under the gate
  "Ctrl + Shift + ?",            // the shortcut overlay, inside the panel
];

// The line a bundle with no tutor shows instead.
const NO_TUTOR_BANNER = "The AI tutor is only available when running locally";

// A quoted occurrence of exactly this string. Endpoints land in the bundle as
// string literals, so quoting them keeps "/sessions" from matching inside
// "/demo101/hosted-demo/sessions" -- which is the whole distinction under test.
function hasLiteral(js, s) {
  return new RegExp(`["'\`]${s.replace(/[/.]/g, "\\$&")}["'\`]`).test(js);
}

let failed = 0;
function check(caseName, claim, ok) {
  if (ok) { console.log(`  ok    ${caseName}: ${claim}`); }
  else { console.log(`  FAIL  ${caseName}: ${claim}`); failed++; }
}

// ── Case 1: a build with nothing extra set ships no tutor ──────────────────
// The default `vite build` is what Netlify and the tailnet publish run, and
// the lessons repo's docs/publishing.md promises they carry no tutor.
{
  const js = bundleJs("default");
  for (const marker of TUTOR_UI) {
    check("default", `bundle does not contain tutor UI ${JSON.stringify(marker)}`, !js.includes(marker));
  }
  check("default", "bundle shows the no-tutor banner instead", js.includes(NO_TUTOR_BANNER));
  // The endpoint literals ARE still in this bundle and that is not a defect:
  // the gate drops the tutor's UI and its session bootstrap, not the Chatbot
  // module, which the lesson still imports. Nothing reaches them -- the init
  // effect returns early so no tab ever gets a session, and both sendBeacon
  // paths are guarded on `tab.sessionId`. What IS asserted is that they did
  // not pick up a prefix: a default build addresses the site root, as the dev
  // proxy and every existing lesson do.
  for (const ep of ENDPOINTS) {
    check("default", `endpoint "/${ep}" is root-absolute, unprefixed`, hasLiteral(js, `/${ep}`));
  }
}

// ── Case 2: a build aimed at a hosted site under its own prefix ────────────
// VITE_TUTOR=1 plus the --base build-all.sh already passes. Both halves are
// asserted: the endpoints that ARE emitted carry the prefix, and the
// root-absolute forms that would reach the site root are NOT emitted.
{
  const js = bundleJs("hosted");
  const BASE = "/demo101/hosted-demo/";
  for (const ep of ENDPOINTS) {
    check("hosted", `chat call "${BASE}${ep}" carries the lesson prefix`, hasLiteral(js, BASE + ep));
    check("hosted", `no root-absolute "/${ep}" left in the bundle`, !hasLiteral(js, `/${ep}`));
  }
  for (const marker of TUTOR_UI) {
    check("hosted", `bundle contains tutor UI ${JSON.stringify(marker)}`, js.includes(marker));
  }
  check("hosted", "bundle does not show the no-tutor banner", !js.includes(NO_TUTOR_BANNER));
}

// ── Case 3: the dev path is untouched ──────────────────────────────────────
// `npm run dev` compiles these sources with import.meta.env.DEV true and the
// base at "/". Asserting that here says the dev server still ships the tutor
// and still calls the proxy at the root, with no VITE_TUTOR set and no --base
// -- which is the half of the dev promise a build can show. (The live dev
// server + proxy round trip is tests/resume-metadata's; it needs a browser and
// check.sh lists it as one of the fixtures a person runs by hand.)
{
  const js = bundleJs("dev-mode");
  for (const marker of TUTOR_UI) {
    check("dev-mode", `bundle contains tutor UI ${JSON.stringify(marker)}`, js.includes(marker));
  }
  check("dev-mode", "bundle does not show the no-tutor banner", !js.includes(NO_TUTOR_BANNER));
  for (const ep of ENDPOINTS) {
    check("dev-mode", `chat call "/${ep}" still goes to the proxy at the root`, hasLiteral(js, `/${ep}`));
  }
}

// ── Case 4: a base with no trailing slash ──────────────────────────────────
// Vite normalises its OWN asset URLs from `--base=/demo101/no-slash` but hands
// import.meta.env.BASE_URL over unchanged, so the endpoints come out joined
// with no separator. Nothing in constants/build.js can fix that at build time,
// so it ships a console.error naming the base and the rebuild that fixes it.
// This case pins both halves: that the trap is real (so the docstring warning
// is not folklore) and that the diagnostic is in the bundle to meet it.
{
  const js = bundleJs("no-slash");
  check("no-slash", "the trap is real: the base joins with no separator",
    hasLiteral(js, "/demo101/no-slashchat"));
  check("no-slash", "and the bundle carries the diagnostic that names it",
    js.includes("which has no trailing slash"));
  // The same diagnostic must survive into the build that IS correct, or it can
  // never fire: it is a runtime check on a value the minifier does not fold.
  check("hosted", "the diagnostic survives minification in a correct build",
    bundleJs("hosted").includes("which has no trailing slash"));
}

console.log(failed === 0 ? "\nhosted-build: all cases passed" : `\nhosted-build: ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
