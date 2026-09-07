#!/usr/bin/env node
// Measures rendered geometry in two built lessons and asserts nothing an
// equation carries lands on the equation. See README.md.
//
// Two lessons, because the 41 lessons render two different stylesheets:
//   shell    lesson/shell_demo.jsx    mounts LessonShell, so chat/chat.css.js
//            with chat/shell.css.js injected over it (2 of the 41)
//   classic  lesson/classic_demo.jsx  no shell markup at all, so chat/chat.css.js
//            alone (the other 39)
// A measurement taken on one says nothing about the other; both are measured.
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
// Env: SHELL_URL, CLASSIC_URL  (required; run.sh serves each built lesson)
//      PHONE_WIDTH_BROWSER / SAFE_RENDER_BROWSER — system Chrome/Chromium
//      binary, so no Playwright browser download is needed.
function resolveDep(spec) {
  for (const base of [__dirname, process.cwd(), process.env.LESSON_DIR].filter(Boolean)) {
    try { return require.resolve(spec, { paths: [base] }); } catch (_) {}
  }
  throw new Error(`cannot resolve ${spec}; run \`npm install\` in tests/phone-width`);
}
const { chromium } = require(resolveDep("playwright"));

const BROWSER = process.env.PHONE_WIDTH_BROWSER || process.env.SAFE_RENDER_BROWSER || "";
const PHONE = { width: 390, height: 844 };
// The two widths ui/LessonShell.jsx gives the contents rail.
const RAIL_W = 262, RAIL_W_COLLAPSED = 48;
const DESKTOP = { width: 1440, height: 900 };

// Anything smaller than this is a rounding artefact of subpixel layout, not a
// control sitting on an equation: a real overlap in this bug is tens of
// pixels wide and the whole height of the pill.
const EPS_AREA = 0.5;

let failed = 0;
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}: ${name}${!ok && detail ? `\n        ${detail}` : ""}`);
}

// Read out of the page, in the page: every rect is a real getBoundingClientRect
// on the laid-out document, never a number computed from the stylesheet.
const MEASURE = () => {
  const rect = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  };
  const intersect = (a, b) => {
    if (!a || !b) return null;
    const left = Math.max(a.left, b.left), right = Math.min(a.right, b.right);
    const top = Math.max(a.top, b.top), bottom = Math.min(a.bottom, b.bottom);
    if (right <= left || bottom <= top) return null;
    return { left, top, right, bottom, width: right - left, height: bottom - top, area: (right - left) * (bottom - top) };
  };
  const inner = (el) => {
    if (!el) return 0;
    const cs = getComputedStyle(el);
    return el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  };

  // The glyphs, not the box that holds them. In display mode KaTeX makes
  // .katex-display, .katex and .katex-html full-width blocks and centres the
  // formula inside them, so the .katex rect reaches the far edge of a column
  // the equation itself covers a fraction of -- and every absolutely positioned
  // control in that column reads as covering it. `.katex .base` is
  // inline-block, width: min-content: it hugs the formula, which is what a
  // reader would point at. One rect per base, because a formula KaTeX broke
  // over lines has several and their union is not what any of them covers.
  const inkRects = (math) => {
    if (!math) return [];
    const bases = [...math.querySelectorAll(".base")];
    return (bases.length ? bases : [math]).map(rect);
  };
  const area = (r) => (r ? r.width * r.height : 0);

  const equations = [...document.querySelectorAll(".eq-block[data-latex]")].map((block, i) => {
    const body = block.querySelector(".eq-body");
    const side = block.querySelector(".eq-side");
    const label = block.querySelector(".eq-label");
    const math = body && (body.querySelector(".katex") || body.querySelector(".eq-raw"));
    // What the reader sees is the formula clipped to .eq-body, which is its own
    // scroll container (overflow-x). Intersecting with it rather than taking
    // the bare glyph rects keeps ink that is scrolled out of sight from
    // counting as on screen.
    const ink = inkRects(math).map((r) => intersect(r, rect(body))).filter(Boolean);
    const worst = (el) => {
      const r = rect(el);
      let hit = null;
      for (const part of ink) {
        const o = intersect(part, r);
        if (o && (!hit || o.area > hit.area)) hit = o;
      }
      return hit;
    };
    return {
      i,
      latex: block.getAttribute("data-latex").slice(0, 40),
      rendered: math ? (math.classList.contains("katex") ? "katex" : "raw") : "none",
      body: rect(body),
      inkArea: ink.reduce((sum, r) => sum + area(r), 0),
      inkWidth: ink.reduce((w, r) => Math.max(w, r.width), 0),
      sideOverlap: worst(side),
      labelOverlap: worst(label),
      sidePosition: side ? getComputedStyle(side).position : null,
      blockPaddingLeft: getComputedStyle(block).paddingLeft,
      blockPaddingRight: getComputedStyle(block).paddingRight,
    };
  });

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
    equations,
  };
};

async function measure(browser, url, viewport) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  // The lesson gates its first paint on KaTeX settling, so wait for the math
  // itself rather than for load: an equation not yet rendered has no geometry.
  await page.waitForFunction(() => {
    const body = document.querySelector(".eq-block[data-latex] .eq-body");
    return !!body && !!(body.querySelector(".katex") || body.querySelector(".eq-raw"));
  }, null, { timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  const snap = await page.evaluate(MEASURE);
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
    `scrollWidth ${Math.round(snap.scrollWidth)}px`);
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
  const invisible = snap.equations.filter((e) => e.inkArea <= EPS_AREA);
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
}

(async () => {
  const shellUrl = process.env.SHELL_URL, classicUrl = process.env.CLASSIC_URL;
  if (!shellUrl || !classicUrl) { console.error("SHELL_URL and CLASSIC_URL are required"); process.exit(2); }
  const launch = { args: ["--no-sandbox"] };
  if (BROWSER) launch.executablePath = BROWSER;
  const browser = await chromium.launch(launch);
  console.log(`shell: ${shellUrl}\nclassic: ${classicUrl}\nbrowser: ${BROWSER || "playwright chromium"}`);
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
  } finally {
    await browser.close();
  }
  const passed = results.length - failed;
  console.log(`\n${"=".repeat(50)}`);
  console.log(`Results: ${passed}/${results.length} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
