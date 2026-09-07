#!/usr/bin/env node
// Measures rendered geometry in three built lessons and asserts two things:
// nothing an equation carries lands on the equation, and no part of the lesson
// is squeezed to nothing — including that the four ancestors the collapse
// measurement skips a part inside are what keeps those parts unnamed. See
// README.md.
//
// Neither measurement lives here: overlap.cjs measures what lands on an
// equation, collapse.cjs measures a part squeezed to nothing, and sweep.cjs
// reads both over a real built site. This file adds the page-level geometry
// (reading column, rail, sideways scroll) and the cases.
//
// Two of the lessons are the two stylesheets the 41 lessons render:
//   shell    lesson/shell_demo.jsx    mounts LessonShell, so chat/chat.css.js
//            with chat/shell.css.js injected over it (2 of the 41)
//   classic  lesson/classic_demo.jsx  no shell markup at all, so chat/chat.css.js
//            alone (the other 39)
// A measurement taken on one says nothing about the other; both are measured.
// The third is the negative control for the collapse case, which would
// otherwise only ever have been seen to stay quiet:
//   squeezed lesson/squeezed_demo.jsx  every squeezable part twice, once laid
//            out and once squeezed to nothing (see squeezedCases below), plus a
//            part squeezed to nothing inside each of the four ancestors
//            collapse.cjs skips a part in (see excludedCases below)
//
// Two viewports, because the fix is a narrow-width rule and the point of
// measuring the wide one is that it did not move:
//   phone    390x844   the width the owner reported the overlap at
//   desktop  1440x900  the rail open at 262px, the side rail absolutely
//                      positioned in the gutter the block reserves for it
// Each viewport gets its own browser context and its own page load: LessonShell
// decides whether the contents rail starts open from the width at mount, so a
// page resized after mounting is not the page a reader on a phone loads.
//
// Env: SHELL_URL, CLASSIC_URL, SQUEEZED_URL  (required; run.sh serves each
//      built lesson)
//      PHONE_WIDTH_BROWSER / SAFE_RENDER_BROWSER — system Chrome/Chromium
//      binary, so no Playwright browser download is needed.
function resolveDep(spec) {
  for (const base of [__dirname, process.cwd(), process.env.LESSON_DIR].filter(Boolean)) {
    try { return require.resolve(spec, { paths: [base] }); } catch (_) {}
  }
  throw new Error(`cannot resolve ${spec}; run \`npm install\` in tests/phone-width`);
}
const { chromium } = require(resolveDep("playwright"));
const { MIN_PART_W, NOT_LESSON_CONTENT, describeCollapsed, settle, readParts } = require("./collapse.cjs");
const { EPS_AREA, readEquations, blankEquations } = require("./overlap.cjs");

const BROWSER = process.env.PHONE_WIDTH_BROWSER || process.env.SAFE_RENDER_BROWSER || "";
const PHONE = { width: 390, height: 844 };
// The two widths ui/LessonShell.jsx gives the contents rail.
const RAIL_W = 262, RAIL_W_COLLAPSED = 48;
const DESKTOP = { width: 1440, height: 900 };

let failed = 0;
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}: ${name}${!ok && detail ? `\n        ${detail}` : ""}`);
}

// The page-level geometry, read out of the page: every rect is a real
// getBoundingClientRect on the laid-out document, never a number computed from
// the stylesheet. The equations themselves are measured by overlap.cjs, which
// sweep.cjs reads too, so both runs measure an overlap the same way.
const MEASURE = () => {
  const inner = (el) => {
    if (!el) return 0;
    const cs = getComputedStyle(el);
    return el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  };
  // The column the prose is actually set in: .article-col under the shell,
  // .lesson-body without it. This is "what a reader gets" at this width.
  const col = document.querySelector(".article-col") || document.querySelector(".lesson-body");
  const rail = document.querySelector(".rail");
  return {
    viewportWidth: window.innerWidth,
    scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    readingWidth: inner(col),
    railWidth: rail ? rail.getBoundingClientRect().width : 0,
    railCollapsed: rail ? rail.classList.contains("rail-collapsed") : null,
  };
};

async function measure(browser, url, viewport) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  // The lesson gates its first paint on KaTeX settling, so wait for the math
  // itself rather than for load: an equation not yet rendered has no geometry.
  await settle(page);
  const snap = await page.evaluate(MEASURE);
  snap.equations = await readEquations(page);
  snap.parts = await readParts(page);
  await ctx.close();
  return snap;
}

// The rail starts collapsed at 390px; pressing "Show contents" must still open
// it, and it must stay open. Its own page load, so the press is read against a
// rail the shell collapsed on its own rather than one an earlier case left in
// some state. Both halves are asserted: the rail the reader did not ask for is
// out of the way, and the rail the reader did ask for is there.
async function probeRailToggle(browser, url) {
  const ctx = await browser.newContext({ viewport: PHONE });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".rail-toggle", { timeout: 30000 });
  const read = () => page.evaluate(() => {
    const rail = document.querySelector(".rail");
    return {
      collapsed: rail ? rail.classList.contains("rail-collapsed") : null,
      width: rail ? rail.getBoundingClientRect().width : 0,
    };
  });
  const before = await read();
  await page.click(".rail-toggle");
  // Long enough for React to commit and for any effect that would undo the
  // press to have run: the bug this covers shut the rail again in the tick
  // after it opened, so reading straight back would have seen it open.
  await page.waitForTimeout(400);
  const after = await read();
  await ctx.close();
  return { before, after };
}

function report(label, snap) {
  console.log(
    `\n[${label}] viewport ${snap.viewportWidth}px  reading column ${Math.round(snap.readingWidth)}px  ` +
    `rail ${Math.round(snap.railWidth)}px${snap.railCollapsed === null ? "" : snap.railCollapsed ? " (collapsed)" : " (open)"}  ` +
    `scrollWidth ${Math.round(snap.scrollWidth)}px  ` +
    `${snap.parts.parts.length} parts, narrowest ${snap.parts.minInner === null ? "n/a" : Math.round(snap.parts.minInner) + "px"}`);
  for (const e of snap.equations) {
    const o = e.sideOverlap, l = e.labelOverlap;
    console.log(
      `    eq${e.i} ${e.rendered.padEnd(5)} body ${Math.round(e.body ? e.body.width : 0)}px  ` +
      `ink ${Math.round(e.inkWidth)}px wide  side ${e.sidePosition}  pad-right ${e.blockPaddingRight}  ` +
      `side∩ink ${o ? `${Math.round(o.width)}x${Math.round(o.height)}` : "none"}  ` +
      `label∩ink ${l ? `${Math.round(l.width)}x${Math.round(l.height)}` : "none"}  ${e.latex}`);
  }
}

// The assertions every lesson must satisfy at every width. The two phone-only
// ones are in phoneCases; the two desktop-only ones pin what must NOT change.
function commonCases(scope, snap) {
  check(`${scope}: the lesson has equations to measure`, snap.equations.length > 0,
    "no .eq-block[data-latex] rendered — the demo lesson did not mount");
  // A squeezed column can hide an overlap by leaving no visible math to cover.
  // Assert the math is on screen first, so a pass below means "nothing covers
  // it", never "there is nothing there".
  const invisible = blankEquations(snap.equations);
  check(`${scope}: every equation's math is visible`, invisible.length === 0,
    invisible.map((e) => `eq${e.i} ink ${Math.round(e.inkArea)}px² (body ${Math.round(e.body ? e.body.width : 0)}px): ${e.latex}`).join("\n        "));
  // The GOAL: no control an equation carries lands on the equation it belongs to.
  const covered = snap.equations.filter((e) => e.sideOverlap && e.sideOverlap.area > EPS_AREA);
  check(`${scope}: no equation's side rail overlaps its equation`, covered.length === 0,
    covered.map((e) => `eq${e.i} covered ${Math.round(e.sideOverlap.width)}x${Math.round(e.sideOverlap.height)}px: ${e.latex}`).join("\n        "));
  const captioned = snap.equations.filter((e) => e.labelOverlap && e.labelOverlap.area > EPS_AREA);
  check(`${scope}: no equation's caption overlaps its equation`, captioned.length === 0,
    captioned.map((e) => `eq${e.i} covered ${Math.round(e.labelOverlap.width)}x${Math.round(e.labelOverlap.height)}px: ${e.latex}`).join("\n        "));
  check(`${scope}: the page does not scroll sideways`, snap.scrollWidth <= snap.viewportWidth + 1,
    `scrollWidth ${Math.round(snap.scrollWidth)} > viewport ${snap.viewportWidth}`);
  // "at phone width, a lesson's tests fail when part of the lesson has been
  // squeezed to nothing, instead of passing because the page does not scroll
  // sideways." A squeezed flex child collapses to zero width rather than
  // overflowing, so the case above stays green while the part is not on screen;
  // it cannot stand in for this one. See collapse.cjs.
  check(`${scope}: no part of the lesson is squeezed to nothing`,
    snap.parts.collapsed.length === 0, describeCollapsed(snap.parts.collapsed));
  // ...and the pass above has to mean the parts were measured, not that the
  // lesson had none to measure. Both demo lessons carry all four kinds.
  const kinds = [...new Set(snap.parts.parts.map((p) => p.kind))].sort();
  check(`${scope}: all four kinds of squeezable part are there to measure`,
    ["code", "equation", "figure", "table"].every((k) => kinds.includes(k)),
    `kinds present: ${kinds.join(", ") || "none"}`);
}

// The negative control, on its own built lesson: lesson/squeezed_demo.jsx
// carries each squeezable part twice, once laid out ("kept") and once as a flex
// child of a row already full ("squeezed"). Both halves are asserted on one
// page — every squeezed part is named and no kept one is — so a check that had
// stopped catching anything, and a check that had started failing on parts that
// are fine, both show up here.
function squeezedCases(snap) {
  const label = (p) => `${p.kind}[${p.index}] ${Math.round(p.inner)}px — ${p.label}`;
  // By key, not by reference: the two arrays come back from the page as
  // separate JSON, so the same part is two objects on this side.
  const key = (p) => `${p.kind}[${p.index}]`;
  const named = new Set(snap.parts.collapsed.map(key));
  const isNamed = (p) => named.has(key(p));
  const kept = snap.parts.parts.filter((p) => !isNamed(p));
  const said = (p) => /squeezed/i.test(p.label);

  check("squeezed: the control lesson rendered both halves of every part",
    snap.parts.parts.length === 8,
    `${snap.parts.parts.length} parts, expected 8 (4 kinds x kept/squeezed): ` +
    snap.parts.parts.map(label).join(" | "));
  const missed = snap.parts.parts.filter(said).filter((p) => !isNamed(p));
  check("squeezed: every part squeezed to nothing is named",
    missed.length === 0, missed.map(label).join("\n        "));
  const wrongly = snap.parts.parts.filter(isNamed).filter((p) => !said(p));
  check("squeezed: no part that was left alone is named",
    wrongly.length === 0, wrongly.map(label).join("\n        "));
  // A collapse is not only an equation's: a figure, a table and a code block
  // reduced to nothing the same way have to be caught too.
  const kinds = [...new Set(snap.parts.collapsed.map((p) => p.kind))].sort();
  check("squeezed: the equation and the three parts that are not equations are all caught",
    ["code", "equation", "figure", "table"].every((k) => kinds.includes(k)),
    `named kinds: ${kinds.join(", ") || "none"}`);
  console.log(`\n[squeezed control] ${snap.parts.parts.length} parts, ` +
    `${named.size} named at the ${MIN_PART_W}px floor, ${kept.length} left alone` +
    (named.size ? `\n        ${describeCollapsed(snap.parts.collapsed)}` : ""));
}

// The four exclusions in collapse.cjs, measured. Same page load as
// squeezedCases: lesson/squeezed_demo.jsx squeezes a code block to nothing
// inside each of `.katex-mathml`, a `dcg-*` node, `.chat-panel` and
// `.thread-panel`, and none of the four may be named. Until this existed the
// guards were unreachable — no demo fixture put a measured part under any of
// those ancestors — so a mistyped selector or an inverted condition left every
// case green. Both halves are asserted here: the squeeze inside each ancestor
// is skipped, and the same squeeze outside all four is still named.
function excludedCases(snap) {
  const label = (p) => `${p.kind} ${Math.round(p.inner)}px${p.hidden ? " (hidden)" : ""} — ${p.label}`;
  for (const sel of NOT_LESSON_CONTENT) {
    const inside = snap.parts.skipped.filter((p) => p.excludedBy === sel);
    // Under the floor AND on screen, so that "not named" can only be this
    // guard's doing: a part the floor would have passed, or one `hidden()`
    // would have dropped anyway, proves nothing about the selector.
    const would = inside.filter((p) => !p.hidden && p.inner < MIN_PART_W);
    check(`excluded: the part squeezed to nothing inside ${sel} is skipped, not named`,
      inside.length === 1 && would.length === 1,
      inside.length === 0
        ? `${sel} skipped nothing — it matched no ancestor of any part. Measured instead: ` +
          snap.parts.parts.map((p) => p.label).join(" | ")
        : inside.map(label).join("\n        "));
  }
  // The other half, and what keeps the four above from passing vacuously: the
  // same squeezed code block, outside all four ancestors, is still named. A
  // measurement that had stopped naming anything would pass every case above.
  const named = snap.parts.collapsed.filter((p) => p.kind === "code");
  check("excluded: the same squeeze outside all four ancestors is still named",
    named.length === 1,
    `${named.length} code blocks named, expected only the one squeezed outside the four:\n        ` +
    (describeCollapsed(named) || "none"));
  // `|| "—"` because an inverted guard skips the parts no selector matched, and
  // the run that has to report that must print it rather than throw on it.
  console.log(`\n[not lesson content] ${snap.parts.skipped.length} parts skipped` +
    (snap.parts.skipped.length
      ? `\n        ${snap.parts.skipped.map((p) => `${(p.excludedBy || "—").padEnd(15)} ${label(p)}`).join("\n        ")}`
      : ""));
}

(async () => {
  const shellUrl = process.env.SHELL_URL, classicUrl = process.env.CLASSIC_URL;
  const squeezedUrl = process.env.SQUEEZED_URL;
  if (!shellUrl || !classicUrl || !squeezedUrl) {
    console.error("SHELL_URL, CLASSIC_URL and SQUEEZED_URL are required"); process.exit(2);
  }
  const launch = { args: ["--no-sandbox"] };
  if (BROWSER) launch.executablePath = BROWSER;
  const browser = await chromium.launch(launch);
  console.log(`shell: ${shellUrl}\nclassic: ${classicUrl}\nsqueezed: ${squeezedUrl}\n` +
    `browser: ${BROWSER || "playwright chromium"}`);
  try {
    for (const [name, url] of [["shell", shellUrl], ["classic", classicUrl]]) {
      const phone = await measure(browser, url, PHONE);
      const desktop = await measure(browser, url, DESKTOP);
      report(`${name} phone`, phone);
      report(`${name} desktop`, desktop);
      console.log("");

      // KaTeX had to render for the wide-equation case to be a wide equation:
      // the CDN fallback wraps its LaTeX source and can never overflow, so a
      // green run in fallback would be evidence for a case that did not happen.
      check(`${name}: KaTeX rendered, so the wide case is real`,
        phone.equations.every((e) => e.rendered === "katex"),
        `rendered as ${[...new Set(phone.equations.map((e) => e.rendered))].join("/")} — is cdn.jsdelivr.net reachable?`);

      commonCases(`${name} phone`, phone);
      // The other half of every desktop case below: at 390px the rail leaves
      // the corner it floats in and flows under the equation, and the block
      // stops reserving a gutter for a rail that is no longer in it. Asserted
      // here and inverted at 1440px, so a rule that went missing and a rule
      // that leaked past its media query both show up.
      check(`${name}: the side rail flows under the equation at 390px`,
        phone.equations.every((e) => e.sidePosition === "static"),
        `positions: ${[...new Set(phone.equations.map((e) => e.sidePosition))].join("/")}`);
      check(`${name}: the block reserves no gutter beside the equation at 390px`,
        phone.equations.every((e) => e.blockPaddingRight === e.blockPaddingLeft),
        phone.equations.map((e) => `eq${e.i} padding ${e.blockPaddingLeft} left / ${e.blockPaddingRight} right`).join("\n        "));
      // ALSO IN SCOPE: what a reader actually gets at 390px. Half the viewport
      // is the least that can be called reading the lesson rather than reading
      // past the furniture; the open rail leaves 128px of 390.
      check(`${name}: the reading column gets at least half the viewport`,
        phone.readingWidth >= phone.viewportWidth / 2,
        `${Math.round(phone.readingWidth)}px of ${phone.viewportWidth}px (rail ${Math.round(phone.railWidth)}px)`);

      commonCases(`${name} desktop`, desktop);
      // Desktop is unchanged: these pin the two declarations the phone rule
      // turns off, so a fix that leaked past its media query fails here.
      check(`${name}: the side rail still floats in the gutter at 1440px`,
        desktop.equations.every((e) => e.sidePosition === "absolute"),
        `positions: ${[...new Set(desktop.equations.map((e) => e.sidePosition))].join("/")}`);
      check(`${name}: the reading column is unsqueezed at 1440px`,
        desktop.readingWidth > 400, `${Math.round(desktop.readingWidth)}px`);
      if (name === "shell") {
        check(`${name}: the contents rail is open at its full 262px at 1440px`,
          Math.round(desktop.railWidth) === RAIL_W && desktop.railCollapsed === false,
          `${Math.round(desktop.railWidth)}px, collapsed=${desktop.railCollapsed}`);
        check(`${name}: the block still reserves its 92px gutter at 1440px`,
          desktop.equations.every((e) => e.blockPaddingRight === "92px"),
          `padding-right: ${[...new Set(desktop.equations.map((e) => e.blockPaddingRight))].join("/")}`);

        const toggle = await probeRailToggle(browser, url);
        console.log(`\n[shell rail toggle] before ${Math.round(toggle.before.width)}px` +
          `${toggle.before.collapsed ? " (collapsed)" : " (open)"}  ` +
          `after press ${Math.round(toggle.after.width)}px${toggle.after.collapsed ? " (collapsed)" : " (open)"}\n`);
        check(`${name}: the contents rail starts collapsed at 390px`,
          toggle.before.collapsed === true && Math.round(toggle.before.width) === RAIL_W_COLLAPSED,
          `${Math.round(toggle.before.width)}px, collapsed=${toggle.before.collapsed}`);
        check(`${name}: "Show contents" still opens the rail at 390px, and it stays open`,
          toggle.after.collapsed === false && Math.round(toggle.after.width) === RAIL_W,
          `${Math.round(toggle.after.width)}px, collapsed=${toggle.after.collapsed}`);
      }
    }
    // One page load, read by both: squeezedCases takes the parts that were
    // measured, excludedCases the parts the exclusions skipped.
    const squeezed = await measure(browser, squeezedUrl, PHONE);
    squeezedCases(squeezed);
    excludedCases(squeezed);
  } finally {
    await browser.close();
  }
  const passed = results.length - failed;
  console.log(`\n${"=".repeat(50)}`);
  console.log(`Results: ${passed}/${results.length} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
