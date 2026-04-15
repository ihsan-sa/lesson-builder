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
// Returns { ready, keyMissing }:
//   - ready === true  -> window.Desmos is available and safe to call
//   - keyMissing      -> consumer should render a red fallback instead

let desmosLoadPromise = null;

function loadDesmosScript(key) {
  if (desmosLoadPromise) return desmosLoadPromise;
  if (typeof window !== "undefined" && window.Desmos) {
    desmosLoadPromise = Promise.resolve();
    return desmosLoadPromise;
  }
  desmosLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://www.desmos.com/api/v1.11/calculator.js?apiKey=${encodeURIComponent(key)}`;
    script.setAttribute("data-desmos-loaded", "pending");
    script.onload = () => {
      script.setAttribute("data-desmos-loaded", "true");
      resolve();
    };
    script.onerror = (e) => {
      desmosLoadPromise = null; // let a later retry try again
      script.remove();
      reject(e);
    };
    document.head.appendChild(script);
  });
  return desmosLoadPromise;
}

export function useDesmos({ enabled = true } = {}) {
  const [ready, setReady] = useState(() => typeof window !== "undefined" && !!window.Desmos);
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
    loadDesmosScript(key)
      .then(() => { if (mounted) setReady(true); })
      .catch(err => console.error("Desmos CDN script failed to load:", err));
    return () => { mounted = false; };
  }, [enabled, ready, key, keyMissing]);

  return { ready, keyMissing };
}
