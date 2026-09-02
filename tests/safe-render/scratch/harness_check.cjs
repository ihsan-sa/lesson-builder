// Drives a scaffolded lesson (see ../scratch-validate.sh): boots Vite, opens harness.html
// (two ChatBubbles through processResponse -> ChatBubble) and the real lesson page, and
// asserts math, <<DEMO>> SVG fidelity, the demo-lint observation, media/sources/reply
// blocks, an inert XSS bubble and zero CSP console violations. Run from the lesson dir.
const { spawn } = require("child_process");
const os = require("os"), path = require("path");
const shot = (n) => path.join(process.env.TMPDIR || os.tmpdir(), `safe-render-${n}.png`);
const { chromium } = require("playwright");
const PORT = 5199, BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function waitUp() { for (let i = 0; i < 60; i++) { try { const r = await fetch(BASE + "/harness.html"); if (r.ok) return; } catch (_) {} await sleep(500); } throw new Error("vite did not come up"); }
(async () => {
  const vite = spawn("npx", ["vite", "--port", String(PORT), "--strictPort", "--host", "127.0.0.1"], { stdio: ["ignore", "pipe", "pipe"] });
  let viteLog = ""; vite.stdout.on("data", d => viteLog += d); vite.stderr.on("data", d => viteLog += d);
  const fails = [];
  try {
    await waitUp();
    const exe = process.env.SAFE_RENDER_BROWSER;
    const browser = await chromium.launch(exe ? { executablePath: exe } : {});
    const page = await browser.newPage({ viewport: { width: 900, height: 1400 } });
    const consoleMsgs = [], pageErrors = [];
    page.on("console", m => consoleMsgs.push(`[${m.type()}] ${m.text()}`));
    page.on("pageerror", e => pageErrors.push(String(e)));
    await page.goto(BASE + "/harness.html");
    await page.waitForSelector("#done", { state: "attached", timeout: 30000 });
    await sleep(500);
    const r = await page.evaluate(() => {
      const b = document.querySelector("#benign .chat-msg-rendered");
      const svg = b.querySelector(".chat-demo-block svg");
      const rect = svg ? svg.getBoundingClientRect() : null;
      const img = b.querySelector(".chat-media-block img");
      return {
        katexInline: b.querySelectorAll(".katex").length,
        katexBlock: b.querySelectorAll(".chat-eq-block .katex-display").length,
        demoTitles: [...b.querySelectorAll(".chat-demo-title")].map(e => e.textContent),
        svgTitle: svg && svg.querySelector("title") && svg.querySelector("title").textContent,
        svgViewBox: svg && svg.getAttribute("viewBox"), svgWidth: svg && svg.getAttribute("width"), svgHeight: svg && svg.getAttribute("height"),
        svgRect: rect && [Math.round(rect.width), Math.round(rect.height)],
        svgNs: svg && svg.namespaceURI, pathNs: svg && svg.querySelector("path").namespaceURI,
        tableRows: b.querySelectorAll("table.chat-table tbody tr").length,
        codeFence: !!b.querySelector("pre.chat-pre code.chat-code-block"), inlineCode: !!b.querySelector("code.chat-code"),
        imgSrc: img && img.getAttribute("src").slice(0, 14), imgLoaded: img && img.complete && img.naturalWidth === 1,
        sources: [...b.querySelectorAll("details.chat-sources a")].map(a => [a.getAttribute("href"), a.getAttribute("rel"), a.getAttribute("target")]),
        replyBlocks: b.querySelectorAll("[data-chat-block]").length,
        list: b.querySelectorAll("ul.chat-ul li").length, heading: b.querySelector("h3.chat-h") && b.querySelector("h3.chat-h").textContent,
        lint: window.__lint,
        xssFired: window.__xss,
        xssHandlers: document.querySelectorAll("#xss [onerror],#xss [onload],#xss foreignObject,#xss body").length,
        xssHrefs: [...document.querySelectorAll("#xss [href]")].map(a => a.getAttribute("href")),
        innerHTMLUsed: undefined,
      };
    });
    const eq = (name, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) fails.push(`${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };
    const ok = (name, cond, got) => { if (!cond) fails.push(`${name}: ${JSON.stringify(got)}`); };
    ok("katex inline rendered", r.katexInline >= 2, r.katexInline);
    eq("katex display block", r.katexBlock, 1);
    eq("demo titles (bad one dropped)", r.demoTitles, ["Decay curve"]);
    eq("svg <title> kept", r.svgTitle, "Decay curve");
    eq("svg viewBox kept", r.svgViewBox, "0 0 200 100"); eq("svg width kept", r.svgWidth, "240"); eq("svg height kept", r.svgHeight, "120");
    eq("svg laid out at attr size", r.svgRect, [240, 120]);
    eq("svg namespace", r.svgNs, "http://www.w3.org/2000/svg"); eq("path namespace", r.pathNs, "http://www.w3.org/2000/svg");
    eq("table rows", r.tableRows, 2); eq("code fence", r.codeFence, true); eq("inline code", r.inlineCode, true);
    eq("img data:image src", r.imgSrc, "data:image/png"); eq("img loaded", r.imgLoaded, true);
    eq("sources link", r.sources, [["https://en.wikipedia.org/wiki/Half-life", "noopener", "_blank"]]);
    ok("reply blocks wrapped", r.replyBlocks >= 5, r.replyBlocks); eq("list items", r.list, 2); eq("heading", r.heading, "Half-life");
    eq("lint observation for bad demo", r.lint.map(l => [l.type, l.title, l.reason]), [["demo-lint", "No viewBox", "missing viewBox attribute"]]);
    eq("xss traps fired", r.xssFired, []); eq("xss handlers/foreignObject/body left", r.xssHandlers, 0);
    ok("xss hrefs neutralised", r.xssHrefs.every(h => !/^\s*javascript/i.test(h)), r.xssHrefs);
    const csp = consoleMsgs.filter(m => /Content Security Policy|Refused to/i.test(m));
    eq("no CSP violations on harness", csp, []); eq("no page errors on harness", pageErrors, []);
    await page.screenshot({ path: shot("harness"), fullPage: true });
    // real lesson page: math renders, no CSP violation, no uncaught error
    consoleMsgs.length = 0; pageErrors.length = 0;
    await page.goto(BASE + "/");
    await page.waitForSelector(".katex", { timeout: 30000 });
    await sleep(1500);
    const lesson = await page.evaluate(() => ({ katex: document.querySelectorAll(".katex").length, title: document.title, root: document.getElementById("root").children.length }));
    ok("lesson page katex", lesson.katex > 0, lesson);
    eq("lesson page no CSP violations", consoleMsgs.filter(m => /Content Security Policy|Refused to/i.test(m)), []);
    eq("lesson page no uncaught errors", pageErrors, []);
    await page.screenshot({ path: shot("lesson"), fullPage: false });
    console.log("harness result:", JSON.stringify(r, null, 1));
    console.log("lesson:", JSON.stringify(lesson), "\nconsole (lesson page):", consoleMsgs.slice(0, 10).join("\n"));
    await browser.close();
  } catch (e) { fails.push("driver error: " + e.stack); }
  finally { vite.kill("SIGTERM"); }
  if (fails.length) { console.log("FAILURES:\n" + fails.join("\n")); console.log("vite log:\n" + viteLog.slice(-2000)); process.exit(1); }
  console.log("screenshots:", shot("harness"), shot("lesson"));
  console.log("ALL RENDER CHECKS PASSED");
})();
