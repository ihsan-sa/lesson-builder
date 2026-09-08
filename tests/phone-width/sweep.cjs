#!/usr/bin/env node
// Runs BOTH phone-width measurements over every lesson of a BUILT site, one
// page load each at 390x844: overlap.cjs (a control or caption sitting on the
// equation it belongs to — the defect the owner reported on 2026-09-06) and
// collapse.cjs (a part squeezed to nothing). check.cjs measures this fixture's
// scaffolded demo lessons; this measures a real corpus, which is how the
// collapse check was shown to fail on the pre-#24 build and pass on the fixed
// one. The site is only ever read: nothing here writes into a build. See
// README.md.
//
//   SITE_URL=http://127.0.0.1:5xxx/ node tests/phone-width/sweep.cjs
//
// Env: SITE_URL       required; the root of a served build. bin/serve-dist.mjs
//                     serves one, but it is the LESSONS repo's script, not this
//                     repo's; any static server does (sweep-negative.sh uses
//                     python3's).
//      LESSON_PATHS   optional; newline- or comma-separated paths to visit.
//                     Default: every directory link on the site's index page.
//      PHONE_WIDTH_BROWSER / SAFE_RENDER_BROWSER  system Chrome, so no
//                     Playwright browser download is needed.
//      LESSON_DIR     optional; another place to resolve playwright from.
//
// Per lesson it prints whether anything overlaps an equation and whether any
// part is collapsed, naming the lesson and the part when it does. Exit 0 when
// no lesson has either, 1 when one does, 2 on a usage error. The last line
// reports how many lessons and equations were measured, the narrowest part
// found, and how many lessons had an overlap or a collapse.
//
// An equation with no ink on screen is one no overlap could have been seen on,
// so those are counted and reported rather than passed in silence: a lesson
// whose math never rendered must not read as a lesson nothing lands on.
function resolveDep(spec) {
  for (const base of [__dirname, process.cwd(), process.env.LESSON_DIR].filter(Boolean)) {
    try { return require.resolve(spec, { paths: [base] }); } catch (_) {}
  }
  throw new Error(`cannot resolve ${spec}; run \`npm install\` in tests/phone-width`);
}
const { chromium } = require(resolveDep("playwright"));
const { MIN_PART_W, describeCollapsed, settle, readParts } = require("./collapse.cjs");
const { readEquations, overlaps, describeOverlaps, blankEquations } = require("./overlap.cjs");

const PHONE = { width: 390, height: 844 };
const BROWSER = process.env.PHONE_WIDTH_BROWSER || process.env.SAFE_RENDER_BROWSER || "";

// A lesson is a directory link on the index page that no other link sits under:
// the PDFs beside them are not lessons, and neither is the course page
// `/ece222/` that `/ece222/ece222-foundations/` hangs off — visiting it waits
// out the full timeout for a lesson that is not there. Read out of the rendered
// page rather than by parsing the HTML, so a link the index adds is picked up
// without touching this file.
async function lessonPaths(browser, site) {
  const fromEnv = (process.env.LESSON_PATHS || "").split(/[\s,]+/).filter(Boolean);
  if (fromEnv.length) return fromEnv;
  const ctx = await browser.newContext({ viewport: PHONE });
  const page = await ctx.newPage();
  await page.goto(site, { waitUntil: "domcontentloaded" });
  const paths = await page.evaluate(() => {
    const dirs = [...new Set([...document.querySelectorAll("a[href]")]
      .map((a) => new URL(a.getAttribute("href"), location.href))
      .filter((u) => u.origin === location.origin && u.pathname.endsWith("/") && u.pathname !== "/")
      .map((u) => u.pathname))].sort();
    return dirs.filter((p) => !dirs.some((q) => q !== p && q.startsWith(p)));
  });
  await ctx.close();
  return paths;
}

(async () => {
  const site = process.env.SITE_URL;
  if (!site) { console.error("SITE_URL is required (the root of a served build)"); process.exit(2); }
  const launch = { args: ["--no-sandbox"] };
  if (BROWSER) launch.executablePath = BROWSER;
  const browser = await chromium.launch(launch);
  let bad = 0, minInner = null, minWhere = "", measured = 0;
  // Counted separately, because "41 of 41 ok" has to say which defect it looked
  // for: a lesson can have an overlap with nothing collapsed, and vice versa.
  let collapsedLessons = 0, overlapLessons = 0, equations = 0, blank = 0;
  try {
    const paths = await lessonPaths(browser, site);
    if (!paths.length) { console.error(`no lesson links found at ${site}`); process.exit(2); }
    console.log(`site: ${site}\nbrowser: ${BROWSER || "playwright chromium"}\nlessons: ${paths.length} at ${PHONE.width}x${PHONE.height}\n`);
    for (const p of paths) {
      // Its own context and its own page load per lesson: a lesson shell decides
      // whether its contents rail starts open from the width at mount, so a page
      // reused across lessons is not the page a reader on a phone loads.
      const ctx = await browser.newContext({ viewport: PHONE });
      const page = await ctx.newPage();
      try {
        await page.goto(new URL(p, site).href, { waitUntil: "domcontentloaded" });
        await settle(page);
        const snap = await readParts(page);
        const eqs = await readEquations(page);
        measured++;
        equations += eqs.length;
        if (snap.minInner !== null && (minInner === null || snap.minInner < minInner)) {
          minInner = snap.minInner; minWhere = p;
        }
        const covered = overlaps(eqs);
        const noInk = blankEquations(eqs);
        blank += noInk.length;
        if (covered.length) overlapLessons++;
        if (snap.collapsed.length) collapsedLessons++;
        // Both defects in one status, because a lesson can have either or both
        // and a run that printed only the first would hide the second.
        const flags = [covered.length ? "OVERLAP" : "", snap.collapsed.length ? "COLLAPSED" : ""].filter(Boolean);
        console.log(`  ${(flags.join("+") || "ok").padEnd(18)} ${p.padEnd(42)} ${String(snap.parts.length).padStart(3)} parts  ` +
          `narrowest ${(snap.minInner === null ? "n/a" : Math.round(snap.minInner) + "px").padEnd(6)}  ` +
          `${String(eqs.length).padStart(3)} equations` +
          `${noInk.length ? `, ${noInk.length} with no math on screen` : ""}`);
        if (covered.length) { console.log(`        ${describeOverlaps(eqs)}`); }
        if (snap.collapsed.length) { console.log(`        ${describeCollapsed(snap.collapsed)}`); }
        if (covered.length || snap.collapsed.length) bad++;
      } catch (e) {
        bad++;
        console.log(`  ${"ERROR".padEnd(18)} ${p}\n        ${e.message.split("\n")[0]}`);
      } finally {
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
  }
  console.log(`\n${measured} lessons measured, ${equations} equations` +
    `${blank ? `, ${blank} of them with no math on screen (no overlap could have been seen there)` : ""}` +
    `\n${overlapLessons} lessons with a control or caption on the equation, ` +
    `${collapsedLessons} with a collapsed part (floor ${MIN_PART_W}px, narrowest part ` +
    `${minInner === null ? "n/a" : Math.round(minInner) + "px"}${minWhere ? ` (${minWhere})` : ""})`);
  process.exit(bad > 0 ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
