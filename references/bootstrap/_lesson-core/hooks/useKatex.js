import { useSyncExternalStore } from "react";

// Loads KaTeX via CDN, once per page, and reports a tri-state readiness so no
// consumer can wait forever when the CDN is slow or unreachable.
//
//   "loading" → the script is in flight (or has not been started yet)
//   "ready"   → window.katex is available; render math normally
//   "failed"  → onerror fired, or the load did not settle inside LOAD_TIMEOUT_MS
//
// `useKatex()` keeps its original boolean signature but now means *settled*
// (ready or failed) rather than *ready*: lessons gate their first paint on it
// (`if (!katexReady) return <spinner/>`), so a permanently-false flag is what
// turned a dead CDN into a dead page. Components that render math ask for the
// status instead — see `useKatexStatus()` and Eq.jsx's raw-source fallback.
//
// There is no retry loop: a failure sticks for the life of the page. A late
// script that arrives after the timeout still upgrades the status to "ready",
// and consumers re-render into real math.

export const KATEX_CSS_URL = "https://cdn.jsdelivr.net/npm/katex@0.16.21/dist/katex.min.css";
export const KATEX_JS_URL = "https://cdn.jsdelivr.net/npm/katex@0.16.21/dist/katex.min.js";

const LOAD_TIMEOUT_MS = 8000;
const CSS_WARNING = "[useKatex] KaTeX stylesheet failed to load from CDN; math renders unstyled.";

let status = "loading";
let started = false;
let timer = null;
let warned = false;
let cssFailed = false;
let failReason = "";
const listeners = new Set();

// One warning per page, whatever went wrong: a dead CDN is a single fact, and
// a lesson full of <Eq> would otherwise report it once per equation.
function warnOnce(msg) {
  if (warned) return;
  warned = true;
  console.warn(msg);
}

// A stylesheet failure is only worth reporting on its own once the script has
// settled: if the script also failed, that is the message worth having, and if
// it loaded then unstyled math is the news. Held back rather than raced.
function noteCssFailure(isMainDocument) {
  cssFailed = true;
  if (!isMainDocument || status !== "loading") warnOnce(CSS_WARNING);
}

function setStatus(next) {
  if (status === next) return;
  status = next;
  if (next !== "loading" && timer) { clearTimeout(timer); timer = null; }
  if (next === "failed") warnOnce(`[useKatex] ${failReason} Math falls back to its LaTeX source.`);
  else if (next === "ready" && cssFailed) warnOnce(CSS_WARNING);
  for (const fn of [...listeners]) fn();
}

// Appends the pinned KaTeX stylesheet to `doc`. Exported so the shell can dress
// its popout window from the same pinned URL; a stylesheet failure only costs
// typography, so it never affects readiness.
export function injectKatexStylesheet(doc) {
  const d = doc || document;
  const link = d.createElement("link");
  link.rel = "stylesheet";
  link.href = KATEX_CSS_URL;
  link.onerror = () => noteCssFailure(d === document);
  d.head.appendChild(link);
  return link;
}

function start() {
  if (started) return;
  started = true;
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (window.katex) { setStatus("ready"); return; }

  injectKatexStylesheet(document);

  const script = document.createElement("script");
  script.src = KATEX_JS_URL;
  script.onload = () => {
    failReason = `KaTeX loaded from ${KATEX_JS_URL} but exposed no window.katex.`;
    setStatus(window.katex ? "ready" : "failed");
  };
  script.onerror = () => {
    failReason = `KaTeX could not be loaded from ${KATEX_JS_URL}.`;
    setStatus("failed");
  };
  document.head.appendChild(script);

  // The load can stall without ever erroring — a hung CDN, a captive portal
  // holding the socket open. Without this the lesson waits forever.
  timer = setTimeout(() => {
    timer = null;
    if (status !== "loading") return;
    if (window.katex) { setStatus("ready"); return; }
    failReason = `KaTeX did not load within ${LOAD_TIMEOUT_MS}ms.`;
    setStatus("failed");
  }, LOAD_TIMEOUT_MS);
}

function subscribe(fn) {
  start();
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

const getSnapshot = () => status;
const getServerSnapshot = () => "loading";

// "loading" | "ready" | "failed"
export function useKatexStatus() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

// True once KaTeX has settled — loaded, or definitively failed. Gates that use
// this release either way, so the lesson is always reachable.
export function useKatex() {
  return useKatexStatus() !== "loading";
}
