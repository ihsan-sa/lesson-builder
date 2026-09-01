#!/usr/bin/env node
// Headless corpus runner for _lesson-core/chat/safeRender.js. See README.md.
// Loads the real chat modules into a real Chromium page (served from memory
// via page.route), mounts every corpus entry through the production path and
// checks: no trap fired, no request left the harness origin, no forbidden
// element/attribute survived, sanitising is idempotent; benign samples must
// serialise exactly like the raw parse with nothing dropped.
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const CHAT = path.join(ROOT, "references", "bootstrap", "_lesson-core", "chat");
const ORIGIN = "http://safe-render.test";
const { xss, benign } = require("./corpus.cjs");

function resolveDep(spec) {
  for (const base of [__dirname, process.cwd()]) {
    try { return require.resolve(spec, { paths: [base] }); } catch (_) {}
  }
  throw new Error(`cannot resolve ${spec}; run \`npm install\` in tests/safe-render`);
}
const { chromium } = require(resolveDep("playwright"));
const katexPath = resolveDep("katex/dist/katex.min.js");

const HARNESS = `<!doctype html><html><head><meta charset="utf-8"></head><body><div id="out"></div>
<script src="/katex.min.js"></script>
<script type="module">
import { processResponse } from "/chat/processResponse.js";
import { renderChatHtml } from "/chat/chatMarkdown.js";
import { stripActiveContent, sanitizeHtml, renderSafeHtmlInto } from "/chat/safeRender.js";
window.__xss = [];
window.pwn = (t) => { window.__xss.push(String(t)); };
window.alert = window.confirm = window.prompt = (m) => window.pwn("dialog:" + m);
const ser = (frag) => { const d = document.createElement("div"); d.appendChild(frag); return d.innerHTML; };
const FORBIDDEN = new Set(["script","style","iframe","object","embed","foreignObject","link","meta","base","form","input","button","textarea","select","template","slot","canvas","feImage","annotation-xml","maction","frame","frameset","applet"]);
const BAD_ATTR = new Set(["srcdoc","srcset","formaction","action","ping","background","dynsrc","lowsrc","codebase","data","classid","name","is"]);
const strip = (v) => String(v).replace(/[\\u0000-\\u0020\\u007f-\\u00a0\\u200b-\\u200f\\u2028\\u2029\\ufeff]/g, "");
window.__h = {
  display(text) { const errs = []; const r = processResponse(text, { onError: (t) => errs.push(t) }); return { display: r.display, errs }; },
  mount(text) {
    const { display, errs } = this.display(text);
    const out = document.getElementById("out");
    const dropped = renderSafeHtmlInto(out, renderChatHtml(display, { katex: window.katex }));
    const once = out.innerHTML;
    const again = ser(sanitizeHtml(once).fragment);
    return { errs, dropped, html: once, idempotent: again === once };
  },
  unsafeControl(html) { document.getElementById("out").innerHTML = html; },
  oracle() {
    const v = [];
    for (const el of document.getElementById("out").querySelectorAll("*")) {
      const tag = el.localName;
      if (FORBIDDEN.has(tag)) v.push("element " + tag);
      for (const a of el.attributes) {
        const n = a.name, val = strip(a.value);
        if (/^on/i.test(n)) v.push(tag + "[" + n + "] handler");
        if (BAD_ATTR.has(n)) v.push(tag + "[" + n + "]");
        if (/^(javascript|vbscript|livescript|data:(?!image\\/)|blob|file):?/i.test(val)) v.push(tag + "[" + n + "]=" + val.slice(0, 40));
        if (/url\\s*\\(\\s*["']?\\s*(?!#)/i.test(val) || /expression\\s*\\(|@import|-moz-binding|behavior\\s*:/i.test(val)) v.push(tag + "[" + n + "] url/css " + val.slice(0, 40));
        if (n === "style" && /position:\\s*fixed/i.test(val)) v.push(tag + "[style] position:fixed");
        if ((tag === "use" || tag === "mpath" || tag === "textPath") && /href$/.test(n) && !val.startsWith("#")) v.push(tag + "[" + n + "] external ref");
      }
    }
    return v;
  },
  benign(text) {
    const { display, errs } = this.display(text);
    const raw = stripActiveContent(renderChatHtml(display, { katex: window.katex }));
    const doc = new DOMParser().parseFromString(raw, "text/html");
    const { fragment, dropped } = sanitizeHtml(raw);
    const d = document.createElement("div"); d.appendChild(fragment);
    // Inline styles are re-emitted from the CSS parser (normalised spacing), so
    // canonicalise both sides the same way before comparing.
    const canon = (root) => { for (const el of root.querySelectorAll("[style]")) if (el.style) el.setAttribute("style", el.style.cssText); };
    canon(doc.body); canon(d);
    return { errs, dropped, before: doc.body.innerHTML, after: d.innerHTML };
  },
};
window.__ready = true;
</script></body></html>`;

function firstDiff(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return `at ${i}:\n  before: …${a.slice(Math.max(0, i - 60), i + 120)}\n  after:  …${b.slice(Math.max(0, i - 60), i + 120)}`;
}

(async () => {
  const exe = process.env.SAFE_RENDER_BROWSER || undefined;
  let browser;
  try { browser = await chromium.launch({ headless: true, executablePath: exe }); }
  catch (e) { browser = await chromium.launch({ headless: true, executablePath: exe, args: ["--no-sandbox"] }); }
  const page = await browser.newPage();
  const leaks = [];
  const dialogs = [];
  page.on("dialog", (d) => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== ORIGIN) { leaks.push(url.href); return route.fulfill({ status: 404, body: "" }); }
    if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: HARNESS });
    if (url.pathname === "/katex.min.js") return route.fulfill({ contentType: "text/javascript", body: fs.readFileSync(katexPath) });
    if (url.pathname.startsWith("/chat/")) {
      const f = path.join(CHAT, path.basename(url.pathname));
      if (fs.existsSync(f)) return route.fulfill({ contentType: "text/javascript", body: fs.readFileSync(f) });
    }
    return route.fulfill({ status: 404, body: "" });
  });
  await page.goto(ORIGIN + "/");
  await page.waitForFunction(() => window.__ready === true);

  let failed = 0;
  const report = (ok, label, detail) => { console.log(`  ${ok ? "PASS" : "FAIL"}: ${label}${ok || !detail ? "" : "\n      " + detail}`); if (!ok) failed++; };

  // Self-check: the trap and the oracle must catch a raw innerHTML mount.
  console.log("\nself-check");
  await page.evaluate(() => window.__h.unsafeControl('<img src="/nope.png" onerror="pwn(\'control\')">'));
  await page.waitForTimeout(150);
  const ctrlFired = await page.evaluate(() => window.__xss.splice(0));
  const ctrlViol = await page.evaluate(() => window.__h.oracle());
  report(ctrlFired.includes("control") && ctrlViol.length > 0, "trap + oracle detect an unsafe mount", `fired=${JSON.stringify(ctrlFired)} viol=${JSON.stringify(ctrlViol)}`);

  console.log(`\nxss corpus (${xss.length} vectors)`);
  for (const v of xss) {
    leaks.length = 0; dialogs.length = 0;
    await page.evaluate(() => { window.__xss.length = 0; });
    const r = await page.evaluate((t) => window.__h.mount(t), v.text);
    await page.waitForTimeout(150);
    const fired = await page.evaluate(() => window.__xss.splice(0));
    const viol = await page.evaluate(() => window.__h.oracle());
    const ok = fired.length === 0 && leaks.length === 0 && dialogs.length === 0 && viol.length === 0 && r.idempotent;
    report(ok, v.name, `fired=${JSON.stringify(fired)} leaks=${JSON.stringify(leaks)} dialogs=${JSON.stringify(dialogs)} oracle=${JSON.stringify(viol)} idempotent=${r.idempotent}\n      html=${r.html.slice(0, 300)}`);
  }

  console.log(`\nbenign corpus (${benign.length} samples)`);
  for (const b of benign) {
    leaks.length = 0;
    const r = await page.evaluate((t) => window.__h.benign(t), b.text);
    const ok = r.before === r.after && r.dropped.length === 0 && r.errs.length === 0;
    report(ok, b.name, `dropped=${JSON.stringify(r.dropped)} errs=${JSON.stringify(r.errs)}\n      ${r.before === r.after ? "" : firstDiff(r.before, r.after)}`);
  }

  await browser.close();
  console.log(`\n${failed === 0 ? "ALL GREEN" : failed + " FAILED"} — ${xss.length} xss vectors, ${benign.length} benign samples`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
