#!/usr/bin/env node
// Drives a running lesson (proxy + Vite) and asserts that resuming a chat
// session restores the model/effort it was created with (ROADMAP P0 #5).
// See README.md.
//
//   1. picker resume  — a session started at a non-default model/effort,
//      reopened in a fresh tab (no auto-resume): the settings chip flips to
//      the stored values and the next CHAT_START log line carries them.
//   2. differing tab   — same resume, but the tab's current selection is
//      something else first: it still switches to the session's values.
//   3. unknown model   — a session whose stored model isn't in the client's
//      MODELS list resumes without changing the selection and without an
//      uncaught error.
//
// Env: BASE_URL (default http://localhost:5901), LESSON_DIR (required —
//      chat.log lives at $LESSON_DIR/server/chat.log), RESUME_METADATA_BROWSER
//      (system Chrome/Chromium binary, so no Playwright browser download).
const fs = require("fs");
const path = require("path");

function resolveDep(spec) {
  for (const base of [__dirname, process.cwd(), process.env.LESSON_DIR].filter(Boolean)) {
    try { return require.resolve(spec, { paths: [base] }); } catch (_) {}
  }
  throw new Error(`cannot resolve ${spec}; run \`npm install\` in tests/resume-metadata`);
}
const { chromium } = require(resolveDep("playwright"));

const BASE_URL = process.env.BASE_URL || "http://localhost:5901";
const LESSON_DIR = process.env.LESSON_DIR;
if (!LESSON_DIR) throw new Error("LESSON_DIR env required");
const BROWSER = process.env.RESUME_METADATA_BROWSER || "";
const LOG_FILE = path.join(LESSON_DIR, "server", "chat.log");

let failed = 0;
function check(scenario, name, ok, detail) {
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}: [${scenario}] ${name}${!ok && detail ? `\n        ${detail}` : ""}`);
}

function lastChatStart() {
  const lines = fs.readFileSync(LOG_FILE, "utf8").trim().split("\n").filter((l) => l.includes("[CHAT_START]"));
  return lines[lines.length - 1] || "";
}

async function openTutor(page) {
  const btn = page.locator(".tutor-btn");
  if (await btn.count()) await btn.click();
  await page.locator(".chat-panel").waitFor({ state: "visible", timeout: 10000 });
}

async function openSettings(page) {
  await page.locator('button.chat-icon-btn[title="Settings"]').click();
  await page.locator(".chat-settings").waitFor({ state: "visible", timeout: 5000 });
}

async function closeSettings(page) {
  await page.locator('button.chat-icon-btn[title="Settings"]').click();
}

async function pickModelEffort(page, modelLabel, effort) {
  await openSettings(page);
  await page.locator("button", { hasText: new RegExp(`^${modelLabel}$`) }).click();
  await page.locator("button", { hasText: new RegExp(`^${effort}$`) }).click();
  await closeSettings(page);
}

async function waitSessionReady(page) {
  await page.locator(".chat-empty", { hasText: "Session active" }).waitFor({ timeout: 20000 });
}

async function chipText(page) {
  return (await page.locator(".chat-settings-chip-text").first().textContent()) || "";
}

async function resumeFromPicker(page, chatNum) {
  await page.locator("button", { hasText: new RegExp(`^Chat #${chatNum} `) }).click();
  await waitSessionReady(page);
}

async function sendPing(page) {
  const box = page.locator(".chat-input");
  await box.fill("ping");
  await box.press("Enter");
  // Fake claude answers immediately; give the SSE round trip a moment.
  await page.waitForTimeout(1000);
}

async function sessionsList(page) {
  return page.evaluate(async () => (await (await fetch("/sessions")).json()).sessions);
}

(async () => {
  const launch = { args: ["--no-sandbox"] };
  if (BROWSER) launch.executablePath = BROWSER;
  const browser = await chromium.launch(launch);
  const pageErrors = [];
  console.log(`target: ${BASE_URL}   browser: ${BROWSER || "playwright chromium"}`);
  try {
    const ctx = await browser.newContext();

    // --- Set up: page A creates the default tab (ignored) plus a second tab
    // at a non-default model/effort, then releases both (navigate away fires
    // beforeunload -> sendBeacon /session/close{keepContext:true}).
    const pageA = await ctx.newPage();
    pageA.on("pageerror", (e) => pageErrors.push(String(e)));
    await pageA.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await openTutor(pageA);
    await waitSessionReady(pageA); // tab 0: default model/effort, unused below

    await pickModelEffort(pageA, "Fable 5", "max");
    await pageA.locator(".chat-tab-add").click();
    await waitSessionReady(pageA); // tab 1: claude-fable-5 / max

    const beforeReload = await sessionsList(pageA);
    const fableSession = beforeReload.find((s) => s.model === "claude-fable-5" && s.effort === "max");
    check("setup", "fable-5/max session created", !!fableSession, JSON.stringify(beforeReload));
    const fableChatNum = fableSession.chatNum;

    await pageA.goto("about:blank"); // releases both sessions (keepContext survives, open:false)

    // --- Scenario 1 + 2: a fresh tab (no sessionStorage, so no auto-resume)
    // lands on the picker. Set a DIFFERENT current selection first, then
    // resume the fable-5/max session from the picker.
    const pageB = await ctx.newPage();
    pageB.on("pageerror", (e) => pageErrors.push(String(e)));
    await pageB.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await openTutor(pageB);
    await page_waitPicking(pageB);

    await pickModelEffort(pageB, "Sonnet 5", "low"); // deliberately differs from the stored session
    check("2", "selection set to Sonnet 5 / low before resume", (await chipText(pageB)).includes("Sonnet 5") && (await chipText(pageB)).includes("low"), await chipText(pageB));

    await resumeFromPicker(pageB, fableChatNum);
    const chipAfterResume = await chipText(pageB);
    check("1", "chip shows the resumed session's model", chipAfterResume.includes("Fable 5"), chipAfterResume);
    check("1", "chip shows the resumed session's effort", chipAfterResume.includes("max"), chipAfterResume);
    check("2", "differing tab selection switched to the session's values", chipAfterResume.includes("Fable 5") && chipAfterResume.includes("max"), chipAfterResume);

    await sendPing(pageB);
    const start = lastChatStart();
    check("1", "next CHAT_START log line carries the resumed model", start.includes("model=claude-fable-5"), start);
    check("1", "next CHAT_START log line carries the resumed effort", start.includes("effort=max"), start);

    await pageB.goto("about:blank"); // release again for scenario 3's picker list

    // --- Scenario 3: a session whose stored model isn't in the client's
    // MODELS list. Created directly against the proxy (the UI has no way to
    // pick an off-list model), then released so it appears in the picker.
    // Node's own fetch, not page.evaluate: pageB now sits on about:blank,
    // which has no origin to resolve a relative /session/init against.
    // effort "xhigh" matches DEFAULT_EFFORT so the chip comparison below
    // isolates the model half of the guard: effort is always one of a known
    // fixed set (SAFE_EFFORTS), so there is no "unknown effort" case to test.
    const oddInit = await (await fetch(`${BASE_URL}/session/init`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "claude-legacy-oddball", effort: "xhigh", isolated: true }),
    })).json();
    await fetch(`${BASE_URL}/session/close`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: oddInit.sessionId, keepContext: true }),
    });
    const oddball = oddInit;
    check("setup", "oddball-model session created", !!oddball.sessionId, JSON.stringify(oddball));

    const pageC = await ctx.newPage();
    pageC.on("pageerror", (e) => pageErrors.push(String(e)));
    await pageC.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await openTutor(pageC);
    await page_waitPicking(pageC);
    const chipBeforeOddball = await chipText(pageC);

    await resumeFromPicker(pageC, oddball.chatNum);
    const chipAfterOddball = await chipText(pageC);
    check("3", "selection unchanged after resuming an unknown model", chipAfterOddball === chipBeforeOddball, `${chipBeforeOddball} -> ${chipAfterOddball}`);
    check("3", "no uncaught error", pageErrors.length === 0, pageErrors.join(" | "));

    // The server still remembers the real value even though the client
    // ignored it — resuming must not silently coerce the stored record.
    const afterList = await sessionsList(pageC);
    const oddRecord = afterList.find((s) => s.id === oddball.sessionId);
    check("3", "server still stores the unknown model after resume", oddRecord && oddRecord.model === "claude-legacy-oddball", JSON.stringify(oddRecord));

    await ctx.close();
  } finally {
    await browser.close();
  }
  console.log(`\n${"=".repeat(50)}`);
  console.log(failed > 0 ? `FAILED: ${failed} check(s) failed` : "All checks passed");
  process.exit(failed > 0 ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

// A fresh tab with pickable sessions lands on sessionStatus "picking" — the
// empty-state buttons only render once serverSessions has loaded.
async function page_waitPicking(page) {
  await page.locator(".chat-empty", { hasText: "Available sessions" }).waitFor({ timeout: 20000 });
}
