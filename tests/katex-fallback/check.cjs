#!/usr/bin/env node
// Drives a running lesson dev server three times and asserts the KaTeX CDN
// fallback (references/bootstrap/_lesson-core/hooks/useKatex.js). See README.md.
//
//   a. normal    — CDN reachable: math renders through KaTeX from the pinned
//                  0.16.21 URLs, and the <Eq> body is byte-for-byte what a
//                  direct katex.render produces for the same LaTeX.
//   b. aborted   — every cdn.jsdelivr.net request fails: the page renders, the
//                  math shows as selectable LaTeX source, the lesson is still
//                  interactive, one console.warn, no uncaught errors.
//   c. stalled   — CDN requests hang forever: the ~8s timeout must reach the
//                  same fallback rather than leaving the loading gate up.
//
// Env: BASE_URL (default http://localhost:5199)
//      KATEX_FALLBACK_BROWSER / SAFE_RENDER_BROWSER — system Chrome/Chromium
//      binary, so no Playwright browser download is needed.
const path = require("path");

function resolveDep(spec) {
  for (const base of [__dirname, process.cwd(), process.env.LESSON_DIR].filter(Boolean)) {
    try { return require.resolve(spec, { paths: [base] }); } catch (_) {}
  }
  throw new Error(`cannot resolve ${spec}; run \`npm install\` in tests/katex-fallback`);
}
const { chromium } = require(resolveDep("playwright"));

const BASE_URL = process.env.BASE_URL || "http://localhost:5199";
const BROWSER = process.env.KATEX_FALLBACK_BROWSER || process.env.SAFE_RENDER_BROWSER || "";
const CDN = "**://cdn.jsdelivr.net/**";
const KATEX_CSS = "https://cdn.jsdelivr.net/npm/katex@0.16.21/dist/katex.min.css";
const KATEX_JS = "https://cdn.jsdelivr.net/npm/katex@0.16.21/dist/katex.min.js";
// The first display equation in tests/katex-fallback/lesson/katex_demo.jsx.
const SAMPLE = "i\\hbar \\partial_t \\psi = H\\psi";
// Subresource load failures reach the console without a URL, and every one a
// scenario cares about is asserted directly (CDN requests, warnings, fallback
// DOM). The rest is the lesson's own chat proxy, deliberately not started
// here, plus the missing favicon. Uncaught exceptions arrive as `pageerror`
// and are never filtered.
const RESOURCE_NOISE = /^Failed to load resource/i;

let failed = 0;
const results = [];
function check(scenario, name, ok, detail) {
  results.push({ scenario, name, ok: !!ok, detail });
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}: ${name}${!ok && detail ? `\n        ${detail}` : ""}`);
}

// What every scenario reads out of the page once it has settled.
async function snapshot(page) {
  return page.evaluate((sample) => {
    const text = (sel) => [...document.querySelectorAll(sel)].map((e) => e.textContent);
    const raws = [...document.querySelectorAll(".eq-raw")];
    const first = document.querySelector(".eq-block .eq-body");
    return {
      katexNodes: document.querySelectorAll(".katex").length,
      rawNodes: raws.length,
      rawText: raws.map((e) => e.textContent),
      rawTags: raws.map((e) => e.tagName),
      rawSelectable: raws.map((e) => getComputedStyle(e).userSelect !== "none"),
      rawLabelled: raws.map((e) => !!e.getAttribute("aria-label")),
      rawVisible: raws.map((e) => {
        const r = e.getBoundingClientRect();
        const cs = getComputedStyle(e);
        return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) > 0;
      }),
      eqBlocks: document.querySelectorAll(".eq-block").length,
      eqExplain: document.querySelectorAll(".eq-explain").length,
      eqLabels: text(".eq-label"),
      railTopics: document.querySelectorAll(".rail-topic").length,
      loadingGate: /Loading KaTeX/i.test(document.body.innerText),
      bodyText: document.body.innerText,
      hasWindowKatex: !!window.katex,
      // What <Eq> put in the DOM against what a direct katex.render call
      // produces for the same source with the same options, into a detached
      // node. Both sides go through the same DOM path, so this is a real
      // byte-for-byte comparison of markup — unlike renderToString, whose raw
      // inline `style` strings the CSSOM re-serialises differently.
      // Version-proof: the oracle is the CDN build actually loaded, so this
      // pins Eq's render call rather than a snapshot of KaTeX's output.
      sampleMatchesKatex: window.katex && first
        ? (() => {
            const d = document.createElement("span");
            window.katex.render(sample, d, { displayMode: true, throwOnError: false, trust: true });
            return first.innerHTML === d.innerHTML;
          })()
        : null,
    };
  }, SAMPLE);
}

async function openPage(browser, { block }) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const warnings = [];
  const consoleErrors = [];
  const pageErrors = [];
  const cdnRequests = [];
  page.on("console", (m) => {
    const t = m.text();
    if (m.type() === "warning") warnings.push(t);
    if (m.type() === "error" && !RESOURCE_NOISE.test(t)) consoleErrors.push(t);
  });
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  page.on("request", (r) => { if (r.url().includes("cdn.jsdelivr.net")) cdnRequests.push(r.url()); });
  if (block === "abort") await page.route(CDN, (r) => r.abort());
  // Never fulfil, never fail: the socket stays open, which is what a stalled
  // CDN looks like and the only thing the timeout can catch.
  if (block === "stall") await page.route(CDN, () => {});
  return { ctx, page, warnings, consoleErrors, pageErrors, cdnRequests };
}

// Warnings the fallback itself emits, separated from React/Vite chatter.
const katexWarnings = (w) => w.filter((t) => t.includes("[useKatex]"));

async function scenarioNormal(browser) {
  console.log("\n[a] normal — CDN reachable");
  const s = await openPage(browser, {});
  await s.page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await s.page.waitForSelector(".katex", { timeout: 20000 }).catch(() => {});
  const snap = await snapshot(s.page);

  check("normal", "math renders through KaTeX", snap.katexNodes > 0, `.katex nodes: ${snap.katexNodes}`);
  check("normal", "no raw-source fallback on the happy path", snap.rawNodes === 0, `.eq-raw nodes: ${snap.rawNodes}`);
  check("normal", "loading gate released", !snap.loadingGate);
  check("normal", "pinned KaTeX script URL requested unchanged", s.cdnRequests.includes(KATEX_JS), s.cdnRequests.join(", "));
  check("normal", "pinned KaTeX stylesheet URL requested unchanged", s.cdnRequests.includes(KATEX_CSS), s.cdnRequests.join(", "));
  check("normal", "sample equation matches a direct katex.render byte-for-byte", snap.sampleMatchesKatex === true, `got ${snap.sampleMatchesKatex}`);
  check("normal", "no [useKatex] warning", katexWarnings(s.warnings).length === 0, katexWarnings(s.warnings).join(" | "));
  check("normal", "no uncaught errors", s.pageErrors.length === 0 && s.consoleErrors.length === 0, [...s.pageErrors, ...s.consoleErrors].join(" | "));
  await s.ctx.close();
  return snap;
}

async function scenarioDown(browser, mode, label, timeoutMs) {
  console.log(`\n[${mode === "abort" ? "b" : "c"}] ${label}`);
  const s = await openPage(browser, { block: mode });
  await s.page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  const t0 = Date.now();
  await s.page.waitForSelector(".eq-raw", { timeout: timeoutMs }).catch(() => {});
  const settledMs = Date.now() - t0;
  const snap = await snapshot(s.page);
  const tag = mode === "abort" ? "aborted" : "stalled";

  check(tag, "page renders (loading gate released, no infinite spinner)", !snap.loadingGate && snap.bodyText.includes("The wave equation"));
  check(tag, "KaTeX never became available", !snap.hasWindowKatex && snap.katexNodes === 0, `.katex nodes: ${snap.katexNodes}`);
  check(tag, "every equation falls back to its LaTeX source", snap.rawNodes === 4, `.eq-raw nodes: ${snap.rawNodes}`);
  check(tag, "fallback carries the literal source", snap.rawText.includes(SAMPLE), snap.rawText.join(" | "));
  check(tag, "fallback is a code span", snap.rawTags.every((t) => t === "CODE"), snap.rawTags.join(","));
  check(tag, "fallback is visible", snap.rawVisible.length > 0 && snap.rawVisible.every(Boolean));
  check(tag, "fallback is selectable", snap.rawSelectable.every(Boolean));
  check(tag, "fallback is labelled for screen readers", snap.rawLabelled.every(Boolean));
  check(tag, "equation chrome survives (blocks, Explain pills, labels)", snap.eqBlocks === 2 && snap.eqExplain === 2 && snap.eqLabels.length === 1,
    `blocks ${snap.eqBlocks}, explain ${snap.eqExplain}, labels ${snap.eqLabels.length}`);
  check(tag, `settled inside the budget (${settledMs}ms)`, snap.rawNodes > 0);

  // The page must still be a lesson, not a corpse: the Explain pill dispatches
  // and switching topics re-renders the next topic's math as source.
  const explained = await s.page.evaluate(() => new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), 2000);
    window.addEventListener("lesson:explain", (e) => { clearTimeout(t); resolve(e.detail); }, { once: true });
    document.querySelector(".eq-explain")?.click();
  }));
  check(tag, "Explain pill still hands the LaTeX to the tutor", explained && explained.latex === SAMPLE, JSON.stringify(explained));

  await s.page.locator(".rail-topic").nth(1).click().catch(() => {});
  await s.page.waitForTimeout(600);
  const after = await snapshot(s.page);
  check(tag, "topic switch still works and renders fallback math", after.rawText.some((t) => t.includes("H\\psi_n = E_n \\psi_n")), after.rawText.join(" | "));

  const warns = katexWarnings(s.warnings);
  check(tag, "exactly one [useKatex] console.warn", warns.length === 1, `${warns.length}: ${warns.join(" | ")}`);
  check(tag, "no retry loop (one script request)", s.cdnRequests.filter((u) => u === KATEX_JS).length <= 1, s.cdnRequests.join(", "));
  check(tag, "no uncaught errors", s.pageErrors.length === 0, s.pageErrors.join(" | "));
  await s.ctx.close();
  return snap;
}

(async () => {
  const launch = { args: ["--no-sandbox"] };
  if (BROWSER) launch.executablePath = BROWSER;
  const browser = await chromium.launch(launch);
  console.log(`target: ${BASE_URL}   browser: ${BROWSER || "playwright chromium"}`);
  try {
    const normal = await scenarioNormal(browser);
    const aborted = await scenarioDown(browser, "abort", "cdn.jsdelivr.net aborted", 20000);
    const stalled = await scenarioDown(browser, "stall", "cdn.jsdelivr.net stalled (8s timeout path)", 25000);
    // The lesson body itself must be identical whether or not KaTeX loaded —
    // only the equations differ.
    check("both", "same lesson chrome in every scenario",
      normal.eqBlocks === aborted.eqBlocks && aborted.eqBlocks === stalled.eqBlocks,
      `${normal.eqBlocks}/${aborted.eqBlocks}/${stalled.eqBlocks}`);
  } finally {
    await browser.close();
  }
  const passed = results.length - failed;
  console.log(`\n${"=".repeat(50)}`);
  console.log(`Results: ${passed}/${results.length} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
