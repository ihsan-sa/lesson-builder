#!/usr/bin/env node
// Runs the collapse measurement over every lesson of a BUILT site at phone
// width, one page load each. check.cjs measures this fixture's two scaffolded
// demo lessons; this measures a real corpus, which is how the check was shown
// to fail on the pre-#24 build and pass on the fixed one. See README.md.
//
//   SITE_URL=http://127.0.0.1:5xxx/ node tests/phone-width/sweep.cjs
//
// Env: SITE_URL       required; the root of a served build (bin/serve-dist.mjs)
//      LESSON_PATHS   optional; newline- or comma-separated paths to visit.
//                     Default: every directory link on the site's index page.
//      PHONE_WIDTH_BROWSER / SAFE_RENDER_BROWSER  system Chrome, so no
//                     Playwright browser download is needed.
//      LESSON_DIR     optional; another place to resolve playwright from.
//
// Exit 0 when no part of any lesson is collapsed, 1 when one is (naming it), 2
// on a usage error. The last line reports how many lessons were measured and
// the narrowest part found across all of them.
function resolveDep(spec) {
  for (const base of [__dirname, process.cwd(), process.env.LESSON_DIR].filter(Boolean)) {
    try { return require.resolve(spec, { paths: [base] }); } catch (_) {}
  }
  throw new Error(`cannot resolve ${spec}; run \`npm install\` in tests/phone-width`);
}
const { chromium } = require(resolveDep("playwright"));
const { MIN_PART_W, describeCollapsed, settle, readParts } = require("./collapse.cjs");

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
        measured++;
        if (snap.minInner !== null && (minInner === null || snap.minInner < minInner)) {
          minInner = snap.minInner; minWhere = p;
        }
        const status = snap.collapsed.length ? "COLLAPSED" : "ok";
        console.log(`  ${status.padEnd(9)} ${p.padEnd(42)} ${String(snap.parts.length).padStart(3)} parts  ` +
          `narrowest ${snap.minInner === null ? "n/a" : Math.round(snap.minInner) + "px"}`);
        if (snap.collapsed.length) { bad++; console.log(`        ${describeCollapsed(snap.collapsed)}`); }
      } catch (e) {
        bad++;
        console.log(`  ERROR     ${p}\n        ${e.message.split("\n")[0]}`);
      } finally {
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
  }
  console.log(`\n${measured} lessons measured, floor ${MIN_PART_W}px, narrowest part ` +
    `${minInner === null ? "n/a" : Math.round(minInner) + "px"}${minWhere ? ` (${minWhere})` : ""}, ` +
    `${bad} with a collapsed part`);
  process.exit(bad > 0 ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
