import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useDesmos } from "../hooks/useDesmos.js";

// Lesson-facing Desmos embed primitive.
//
// Props:
//   state         Desmos state JSON object (passed to calc.setState).
//   height        Container pixel height (default 400).
//   options       Passthrough to Desmos.GraphingCalculator(el, options).
//   onStateChange Optional callback, throttled ~250ms, fired when the student
//                 manipulates the calculator. Lesson parents can use this to
//                 bump graphRenderId for visual-QA coverage.
//   className     Composable on the wrapper div.
//   mid           Marker id for debugging (kept to match other lesson graphs).
//
// Animation: the bot/author never auto-plays. If any expression in `state`
// carries a sliderBounds block, a play/pause overlay button appears and the
// student toggles animation. It auto-pauses on unmount and when the tab is
// backgrounded, so nothing keeps a slider running in a detached calculator.

const PRIMITIVE_CSS_ID = "core-desmos-graph-style";
const DESMOS_CSS = `
.dg-root { position: relative; width: 100%; border: 1px solid var(--border);
  border-radius: 6px; overflow: hidden; background: var(--bg-card); }
.dg-host { width: 100%; height: 100%; }
.dg-play-btn { position: absolute; top: 8px; right: 8px; z-index: 2;
  padding: 4px 10px; font-family: 'IBM Plex Mono', monospace; font-size: 11px;
  font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase;
  background: var(--bg-panel); color: var(--accent); border: 1px solid var(--accent);
  border-radius: 4px; cursor: pointer; opacity: 0.85; transition: opacity 0.15s; }
.dg-play-btn:hover { opacity: 1; }
.dg-play-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
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

function extractSliderIds(state) {
  const ids = [];
  const list = state?.expressions?.list;
  if (Array.isArray(list)) {
    for (const e of list) {
      if (e && e.id && e.sliderBounds) ids.push(e.id);
    }
  }
  return ids;
}

export function DesmosGraph({ state, height = 400, options, onStateChange, className, mid }) {
  const { ready, keyMissing } = useDesmos();
  const hostRef = useRef(null);
  const calcRef = useRef(null);
  const sliderIdsRef = useRef([]);
  const [playing, setPlaying] = useState(false);
  const [hasSliders, setHasSliders] = useState(false);

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
    const sliders = extractSliderIds(cleaned);
    sliderIdsRef.current = sliders;
    setHasSliders(sliders.length > 0);
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
      sliderIdsRef.current = [];
      setPlaying(false);
      setHasSliders(false);
    };
  }, [ready, stateSig]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced resize on host size changes.
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

  // Auto-pause on tab hidden.
  useEffect(() => {
    if (!playing) return;
    const onVis = () => {
      if (document.hidden) pauseAll();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [playing]); // eslint-disable-line react-hooks/exhaustive-deps

  const pauseAll = useCallback(() => {
    const calc = calcRef.current;
    if (!calc) return;
    for (const id of sliderIdsRef.current) {
      try { calc.setExpression({ id, isPlaying: false }); } catch (_) {}
    }
    setPlaying(false);
  }, []);

  const toggle = useCallback(() => {
    const calc = calcRef.current;
    if (!calc) return;
    const next = !playing;
    for (const id of sliderIdsRef.current) {
      try { calc.setExpression({ id, isPlaying: next }); } catch (_) {}
    }
    setPlaying(next);
  }, [playing]);

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
      {ready && hasSliders && (
        <button type="button" className="dg-play-btn" onClick={toggle} aria-label={playing ? "Pause animation" : "Play animation"}>
          {playing ? "Pause" : "Play"}
        </button>
      )}
    </div>
  );
}
