import { useEffect, useState } from "react";

// Lazy-loads GeoGebra's deployment script (deployggb.js) from geogebra.org.
// Mirrors useDesmos.js, without the key: GeoGebra's embed needs no account
// and no API key.
//
// Two things come from outside, both from https://www.geogebra.org/apps/:
// deployggb.js, which defines window.GGBApplet, and the versioned applet
// codebase it then pulls in when a <GeoGebraGraph> injects an applet. The
// codebase's GWT loader runs in one hidden about:blank iframe; the lesson
// template's CSP (`frame-src 'none'`) does not block that, because nothing is
// fetched into it. Measured in Chrome at 390px on 2026-09-24.
//
// This hook covers the first of the two; GeoGebraGraph bounds the second.
// Script-tag deduplication via a module-level promise, so several applets on
// one page fetch the script once. Pass `{ enabled: false }` to skip it.
//
// A load that errors, or that stalls without erroring, settles as failed
// inside LOAD_TIMEOUT_MS -- the bound useKatex.js and useDesmos.js use. The
// bound reports a slow load, it does not cancel it: a script that arrives
// late flips every consumer that had given up back to ready.
//
// Returns { ready, failed }:
//   - ready === true -> window.GGBApplet is available
//   - failed         -> the script has not arrived within the bound; the
//                       consumer should stop waiting. A late arrival clears it.

const LOAD_TIMEOUT_MS = 8000;
const GGB_DEPLOY_URL = "https://www.geogebra.org/apps/deployggb.js";

let ggbLoadPromise = null;
let warned = false;
const lateArrivals = new Set();

function warnOnce(msg) {
  if (warned) return;
  warned = true;
  console.error(msg);
}

function loadGeoGebraScript() {
  if (ggbLoadPromise) return ggbLoadPromise;
  if (typeof window !== "undefined" && window.GGBApplet) {
    ggbLoadPromise = Promise.resolve();
    return ggbLoadPromise;
  }
  const promise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = GGB_DEPLOY_URL;
    script.setAttribute("data-geogebra-loaded", "pending");
    let timer = null;
    let settled = false;
    // Clearing the shared promise on failure lets a later mount retry, but
    // only while this attempt is still the current one.
    const settle = (err) => {
      if (settled) return;
      settled = true;
      if (timer) { clearTimeout(timer); timer = null; }
      if (!err) { resolve(); return; }
      if (ggbLoadPromise === promise) ggbLoadPromise = null;
      reject(err);
    };
    script.onload = () => {
      const loaded = !!window.GGBApplet;
      script.setAttribute("data-geogebra-loaded", loaded ? "true" : "failed");
      if (!loaded) { settle(new Error("The GeoGebra script loaded but exposed no window.GGBApplet.")); return; }
      // Told on every success, not only a late one: a consumer that gave up
      // on a tag that never arrived is reached only from here.
      for (const notify of [...lateArrivals]) notify();
      if (!settled) settle(null);
    };
    script.onerror = () => {
      script.setAttribute("data-geogebra-loaded", "failed");
      script.remove();
      settle(new Error("The GeoGebra script could not be loaded from geogebra.org."));
    };
    timer = setTimeout(() => {
      timer = null;
      if (window.GGBApplet) { settle(null); return; }
      settle(new Error(`GeoGebra did not load within ${LOAD_TIMEOUT_MS}ms.`));
    }, LOAD_TIMEOUT_MS);
    document.head.appendChild(script);
  });
  ggbLoadPromise = promise;
  return promise;
}

export function useGeoGebra({ enabled = true } = {}) {
  const [ready, setReady] = useState(() => typeof window !== "undefined" && !!window.GGBApplet);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!enabled || ready || typeof window === "undefined") return;
    if (window.GGBApplet) { setReady(true); return; }
    let mounted = true;
    setFailed(false);
    const succeed = () => { if (!mounted) return; setFailed(false); setReady(true); };
    lateArrivals.add(succeed);
    loadGeoGebraScript()
      .then(succeed)
      .catch(err => {
        warnOnce(`[useGeoGebra] ${err.message} Applets will not render.`);
        if (mounted) setFailed(true);
      });
    return () => { mounted = false; lateArrivals.delete(succeed); };
  }, [enabled, ready]);

  return { ready, failed };
}
