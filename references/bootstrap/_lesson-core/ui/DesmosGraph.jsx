import { useEffect, useRef, useState, useMemo } from "react";
import { useDesmos } from "../hooks/useDesmos.js";

// Lesson-facing Desmos embed primitive.
//
// Props:
//   state         Desmos state JSON object (passed to calc.setState).
//   height        Initial container pixel height (default 400). User can
//                 drag the bottom-right corner to resize both axes.
//   options       Passthrough to Desmos.GraphingCalculator(el, options).
//   onStateChange Optional callback, throttled ~250ms, fired when the student
//                 manipulates the calculator. Lesson parents can use this to
//                 bump graphRenderId for visual-QA coverage.
//   className     Composable on the wrapper div.
//   mid           Marker id for debugging (kept to match other lesson graphs).
//
// Animation: the bot/author never auto-plays. Students click the native
// Desmos per-slider Play button inside the expression panel; there is no
// overlay button in the lesson path. `isPlaying: true` is stripped from
// incoming state so nothing auto-starts on mount.
//
// Resizing: the root uses CSS `resize: both` so the student can drag the
// bottom-right corner to adjust both width and height. A ResizeObserver
// calls calc.resize() so the Desmos canvas reflows cleanly.

const PRIMITIVE_CSS_ID = "core-desmos-graph-style";
const DESMOS_CSS = `
.dg-root { position: relative; width: 100%; min-width: 320px; min-height: 220px;
  max-width: 100%; border: 1px solid var(--border); border-radius: 6px;
  overflow: auto; resize: both; background: var(--bg-card); }
.dg-host { width: 100%; height: 100%; }
.dg-fallback { padding: 14px; font-family: 'IBM Plex Mono', monospace;
  font-size: 12px; color: var(--chat-stop-color); background: var(--bg-panel);
  border: 1px dashed var(--chat-stop-color); border-radius: 6px; text-align: center; }
.dg-loading { padding: 18px; font-family: 'IBM Plex Mono', monospace;
  font-size: 12px; color: var(--text-dim); text-align: center; }
`;

function injectCss() {
  if (typeof document === "undefined") return;
  if (document.getElementById(PRIMITIVE_CSS_ID)) return;
  const tag = document.createElement("style");
  tag.id = PRIMITIVE_CSS_ID;
  tag.textContent = DESMOS_CSS;
  document.head.appendChild(tag);
}

// Recursively delete any isPlaying:true keys so the bot can't start an
// autoplaying slider that keeps running in a detached DOM node.
function stripAutoplay(obj) {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(stripAutoplay);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === "isPlaying" && v === true) continue;
    out[k] = stripAutoplay(v);
  }
  return out;
}

export function DesmosGraph({ state, height = 520, options, onStateChange, className, mid }) {
  const { ready, keyMissing } = useDesmos();
  const hostRef = useRef(null);
  const calcRef = useRef(null);

  // Callbacks via ref so updates don't trigger a full remount. Options and
  // onStateChange are typically inline object literals / closures from the
  // parent; if they were in the dep array we would destroy and recreate the
  // calculator on every parent render.
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const onChangeRef = useRef(onStateChange);
  onChangeRef.current = onStateChange;

  // Stable signature for the state prop. Calculator re-mounts only when the
  // serialized shape actually changes, not when the parent hands us a new
  // reference to the same data.
  const stateSig = useMemo(() => {
    try { return state ? JSON.stringify(state) : ""; } catch (_) { return ""; }
  }, [state]);

  useEffect(() => { injectCss(); }, []);

  useEffect(() => {
    if (!ready || !hostRef.current) return;
    const cleaned = stripAutoplay(state);
    const calc = window.Desmos.GraphingCalculator(hostRef.current, {
      expressionsCollapsed: false,
      settingsMenu: false,
      border: false,
      keypad: false,
      ...(optionsRef.current || {}),
    });
    calcRef.current = calc;
    try {
      calc.setState(cleaned);
    } catch (e) {
      console.error("Desmos setState failed:", e);
    }
    let lastFire = 0;
    const obs = () => {
      const cb = onChangeRef.current;
      if (!cb) return;
      const now = Date.now();
      if (now - lastFire < 250) return;
      lastFire = now;
      try { cb(calc.getState()); } catch (_) {}
    };
    calc.observeEvent("change", obs);
    return () => {
      try { calc.destroy(); } catch (_) {}
      calcRef.current = null;
    };
  }, [ready, stateSig]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced resize on host size changes (student drag-resize, window
  // resize, or sibling layout shifts). Keeps the Desmos canvas sharp.
  useEffect(() => {
    if (!ready || !hostRef.current) return;
    let t = null;
    const ro = new ResizeObserver(() => {
      clearTimeout(t);
      t = setTimeout(() => {
        try { calcRef.current && calcRef.current.resize(); } catch (_) {}
      }, 100);
    });
    ro.observe(hostRef.current);
    return () => { clearTimeout(t); ro.disconnect(); };
  }, [ready]);

  if (keyMissing) {
    return (
      <div className={["dg-root", className].filter(Boolean).join(" ")} style={{ height }} data-mid={mid}>
        <div className="dg-fallback">Desmos graph unavailable: VITE_DESMOS_KEY not configured.</div>
      </div>
    );
  }
  return (
    <div className={["dg-root", className].filter(Boolean).join(" ")} style={{ height }} data-mid={mid}>
      {!ready && <div className="dg-loading">Loading graph...</div>}
      <div ref={hostRef} className="dg-host"/>
    </div>
  );
}
