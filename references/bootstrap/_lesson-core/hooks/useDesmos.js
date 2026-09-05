import { useEffect, useState } from "react";

// Lazy-loads Desmos' Calculator API via CDN. Mirrors useKatex.js.
//
// Reads VITE_DESMOS_KEY from import.meta.env; without a key we refuse to load
// (fails loud via console.error and exposes keyMissing: true) rather than
// silently fetching a non-functional bundle.
//
// Script-tag deduplication via a module-level promise so a burst of
// concurrent mounts (multiple <DesmosGraph> or a chat bubble alongside a
// lesson embed) only produces one network fetch.
//
// Pass `{ enabled: false }` to skip the script injection entirely -- used by
// chat bubbles that don't contain a Desmos block, so user-role bubbles and
// Desmos-free conversations never pay the ~1.3 MB bundle cost.
//
// A load that errors, or that stalls without erroring, settles as failed
// inside LOAD_TIMEOUT_MS -- the same bound useKatex.js uses. Nothing here may
// leave a consumer waiting on a dead or hung CDN forever.
//
// Returns { ready, keyMissing, failed }:
//   - ready === true  -> window.Desmos is available and safe to call
//   - keyMissing      -> consumer should render a red fallback instead
//   - failed          -> the load settled without a calculator; the consumer
//                        should stop waiting. Nothing retries on its own.

const LOAD_TIMEOUT_MS = 8000;

let desmosLoadPromise = null;
let warned = false;

// One warning per page, whatever went wrong: a dead CDN is a single fact, and
// a lesson full of graphs would otherwise report it once per <DesmosGraph>.
function warnOnce(msg) {
  if (warned) return;
  warned = true;
  console.error(msg);
}

function loadDesmosScript(key) {
  if (desmosLoadPromise) return desmosLoadPromise;
  if (typeof window !== "undefined" && window.Desmos) {
    desmosLoadPromise = Promise.resolve();
    return desmosLoadPromise;
  }
  const promise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://www.desmos.com/api/v1.11/calculator.js?apiKey=${encodeURIComponent(key)}`;
    script.setAttribute("data-desmos-loaded", "pending");
    let timer = null;
    let settled = false;
    // Clearing the shared promise on failure lets a later mount retry, but
    // only while this attempt is still the current one: a stale handler
    // firing after a retry began must not throw away the retry's promise.
    const settle = (err) => {
      if (settled) return;
      settled = true;
      if (timer) { clearTimeout(timer); timer = null; }
      if (!err) { resolve(); return; }
      if (desmosLoadPromise === promise) desmosLoadPromise = null;
      reject(err);
    };
    script.onload = () => {
      script.setAttribute("data-desmos-loaded", window.Desmos ? "true" : "failed");
      settle(window.Desmos ? null : new Error("The Desmos script loaded but exposed no window.Desmos."));
    };
    script.onerror = () => {
      script.setAttribute("data-desmos-loaded", "failed");
      script.remove();
      settle(new Error("The Desmos script could not be loaded from the CDN."));
    };
    // A load can stall without ever erroring -- a hung CDN, a captive portal
    // holding the socket open. Without this the graph waits forever.
    timer = setTimeout(() => {
      timer = null;
      if (window.Desmos) { settle(null); return; }
      // The tag stays put: a late script still defines window.Desmos, and the
      // next mount reads that directly instead of fetching the bundle again.
      settle(new Error(`Desmos did not load within ${LOAD_TIMEOUT_MS}ms.`));
    }, LOAD_TIMEOUT_MS);
    document.head.appendChild(script);
  });
  desmosLoadPromise = promise;
  return promise;
}

export function useDesmos({ enabled = true } = {}) {
  const [ready, setReady] = useState(() => typeof window !== "undefined" && !!window.Desmos);
  const [failed, setFailed] = useState(false);
  const key = import.meta.env.VITE_DESMOS_KEY;
  const keyMissing = !key;

  useEffect(() => {
    if (!enabled || ready || typeof window === "undefined") return;
    if (window.Desmos) { setReady(true); return; }
    if (keyMissing) {
      console.error("VITE_DESMOS_KEY missing -- Desmos graphs will not render. Add it to .env.local.");
      return;
    }
    let mounted = true;
    setFailed(false);
    loadDesmosScript(key)
      .then(() => { if (mounted) setReady(true); })
      .catch(err => {
        warnOnce(`[useDesmos] ${err.message} Graphs will not render.`);
        if (mounted) setFailed(true);
      });
    return () => { mounted = false; };
  }, [enabled, ready, key, keyMissing]);

  return { ready, keyMissing, failed };
}
