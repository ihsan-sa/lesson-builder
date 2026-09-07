#!/usr/bin/env node
// Drives a BUILT shell lesson through the dark/light switch in a real browser
// and reads the colours back off the laid-out page. See README.md.
//
// What text cannot prove is that the switch reaches everything, so every
// assertion here is a computed colour or a screenshot, never a rule in a sheet:
//
//   the shell root, the article prose, the equation card   the class swap
//   the SVG a lesson draws from THEMES_G                   the lesson re-render
//   the detached tutor pop-out, and its <html>             a second document
//
// The pop-out is exercised both ways round: opened while the page is already
// dark, and then switched back to light with the window still open — those are
// two different code paths in LessonShell (openPopup, and the effect that
// re-applies the class), and the second is the one that silently does nothing
// if the effect is dropped.
//
// Env: LESSON_URL   (required; run.sh serves the built lesson)
//      SHELL_THEME_BROWSER / SAFE_RENDER_BROWSER — system Chrome/Chromium binary
//      SHOTS         directory to write the screenshots into
function resolveDep(spec) {
  for (const base of [__dirname, process.cwd(), process.env.LESSON_DIR].filter(Boolean)) {
    try { return require.resolve(spec, { paths: [base] }); } catch (_) {}
  }
  throw new Error(`cannot resolve ${spec}; run \`npm install\` in tests/shell-theme`);
}
const { chromium } = require(resolveDep("playwright"));
const path = require("path");

const URL = process.env.LESSON_URL;
const BROWSER = process.env.SHELL_THEME_BROWSER || process.env.SAFE_RENDER_BROWSER || "";
const SHOTS = process.env.SHOTS || "";

let failed = 0;
function check(name, ok, detail) {
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}: ${name}${!ok && detail ? `\n        ${detail}` : ""}`);
}
// Two colours that must not be the same. Printed both ways so a failure says
// which pair collapsed rather than just that one did.
function differs(name, light, dark) {
  check(name, light !== dark && !!light && !!dark, `light ${light}, dark ${dark}`);
}

// Read in the page: computed styles off the real document, not values derived
// from the stylesheet.
const READ = () => {
  const cs = (sel, prop) => {
    const el = document.querySelector(sel);
    return el ? getComputedStyle(el)[prop] : null;
  };
  const attr = (sel, name) => {
    const el = document.querySelector(sel);
    return el ? el.getAttribute(name) : null;
  };
  return {
    rootClass: attr(".lesson-shell", "class"),
    rootBg: cs(".lesson-shell", "backgroundColor"),
    // The page behind the shell. The shell root is not the whole document: the UA's body margin
    // shows html and body at every edge, and a scroll runs past the shell onto them.
    htmlClass: document.documentElement.getAttribute("class"),
    htmlBg: getComputedStyle(document.documentElement).backgroundColor,
    bodyBg: getComputedStyle(document.body).backgroundColor,
    bodyMargin: getComputedStyle(document.body).marginTop,
    topbarBg: cs(".topbar", "backgroundColor"),
    articleInk: cs(".article .para", "color"),
    eqBg: cs(".eq-block", "backgroundColor"),
    railInk: cs(".rail-label", "color"),
    toggleLabel: (document.querySelector(".theme-toggle") || {}).textContent,
    // The lesson's own SVG: its colours are attributes the lesson wrote from G,
    // so they move only when the lesson re-renders.
    traceBg: attr('[data-testid="trace-bg"]', "fill"),
    traceCurve: attr('[data-testid="trace-curve"]', "stroke"),
  };
};

const READ_POPUP = () => ({
  htmlClass: document.documentElement.getAttribute("class"),
  hostClass: document.body.firstElementChild
    ? document.body.firstElementChild.getAttribute("class") : null,
  bodyBg: getComputedStyle(document.body).backgroundColor,
  panelBg: document.querySelector(".chat-panel")
    ? getComputedStyle(document.querySelector(".chat-panel")).backgroundColor : null,
});

(async () => {
  if (!URL) { console.error("LESSON_URL is required"); process.exit(2); }
  const browser = await chromium.launch(BROWSER ? { executablePath: BROWSER } : {});
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForSelector(".article .para", { timeout: 30000 });

  console.log("\n1  the page opens light, and the button offers dark");
  const light = await page.evaluate(READ);
  check("the shell root carries theme-light", /\btheme-light\b/.test(light.rootClass || ""), light.rootClass);
  check("…and so does <html>", /\btheme-light\b/.test(light.htmlClass || ""), light.htmlClass);
  check("the UA body margin is gone", light.bodyMargin === "0px", light.bodyMargin);
  check("the page canvas matches the shell", light.bodyBg === light.rootBg,
    `body ${light.bodyBg}, shell ${light.rootBg}`);
  check("the switch reads Dark", (light.toggleLabel || "").trim() === "Dark", light.toggleLabel);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "light.png"), fullPage: false });

  console.log("\n2  pressing it turns every part of the page dark");
  await page.click(".theme-toggle");
  await page.waitForTimeout(400); // the token transitions are 150-220ms
  const dark = await page.evaluate(READ);
  check("the shell root carries theme-dark", /\btheme-dark\b/.test(dark.rootClass || ""), dark.rootClass);
  check("…and <html> followed", /\btheme-dark\b/.test(dark.htmlClass || ""), dark.htmlClass);
  check("…and no light class is left on it", !/\btheme-light\b/.test(dark.htmlClass || ""), dark.htmlClass);
  check("the switch now reads Light", (dark.toggleLabel || "").trim() === "Light", dark.toggleLabel);
  differs("the page background changed", light.rootBg, dark.rootBg);
  // The white frame this used to leave: body kept the UA colour while the shell went dark.
  differs("the page canvas behind the shell changed with it", light.bodyBg, dark.bodyBg);
  check("…and still matches the shell", dark.bodyBg === dark.rootBg,
    `body ${dark.bodyBg}, shell ${dark.rootBg}`);
  differs("the document element repainted too", light.htmlBg, dark.htmlBg);
  differs("the top bar changed", light.topbarBg, dark.topbarBg);
  differs("the prose ink changed", light.articleInk, dark.articleInk);
  differs("the equation card changed", light.eqBg, dark.eqBg);
  differs("the contents rail changed", light.railInk, dark.railInk);
  // The one part a class cannot reach. It follows because the lesson holds the
  // theme and rebinds G; a lesson that passes neither prop keeps its graphs on
  // the light palette, which is what references/template.md tells it not to do.
  differs("the lesson's SVG followed too", light.traceBg, dark.traceBg);
  differs("…including its curve", light.traceCurve, dark.traceCurve);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "dark.png"), fullPage: false });

  console.log("\n3  the tutor pop-out opens into the theme that is on");
  const popupPromise = page.waitForEvent("popup", { timeout: 15000 });
  await page.click(".topbar-popout");
  const popup = await popupPromise;
  await popup.waitForLoadState("domcontentloaded");
  await popup.waitForTimeout(600);
  const popDark = await popup.evaluate(READ_POPUP);
  check("the pop-out host carries theme-dark", /\btheme-dark\b/.test(popDark.hostClass || ""), popDark.hostClass);
  check("…and so does its <html>", /\btheme-dark\b/.test(popDark.htmlClass || ""), popDark.htmlClass);
  if (SHOTS) await popup.screenshot({ path: path.join(SHOTS, "popout-dark.png") });

  console.log("\n4  switching back reaches the window that is already open");
  await page.click(".theme-toggle");
  await page.waitForTimeout(600);
  const popLight = await popup.evaluate(READ_POPUP);
  const backLight = await page.evaluate(READ);
  check("the page is light again", /\btheme-light\b/.test(backLight.rootClass || ""), backLight.rootClass);
  check("the pop-out host followed", /\btheme-light\b/.test(popLight.hostClass || ""), popLight.hostClass);
  check("…and its <html>", /\btheme-light\b/.test(popLight.htmlClass || ""), popLight.htmlClass);
  differs("the paper behind the pop-out panel repainted", popDark.bodyBg, popLight.bodyBg);
  if (popDark.panelBg || popLight.panelBg) {
    differs("the tutor panel itself repainted", popLight.panelBg, popDark.panelBg);
  } else {
    check("the tutor panel is in the pop-out", false, "no .chat-panel in the pop-out document");
  }
  if (SHOTS) await popup.screenshot({ path: path.join(SHOTS, "popout-light.png") });

  await browser.close();
  console.log(`\n${failed === 0 ? "all checks passed" : `${failed} check(s) failed`}`);
  if (SHOTS) console.log(`screenshots: ${SHOTS}`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
