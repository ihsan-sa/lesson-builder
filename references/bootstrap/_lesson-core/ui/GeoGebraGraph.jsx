import { useEffect, useRef, useState, useMemo } from "react";
import { useGeoGebra } from "../hooks/useGeoGebra.js";

// Lesson-facing GeoGebra embed: a figure the student can drag, zoom and
// rotate. For 2D curves with sliders prefer DesmosGraph; this is for what
// Desmos cannot do -- geometric constructions, 3D surfaces and solids,
// vector fields. No account and no key; see useGeoGebra.js for what loads
// from geogebra.org.
//
// Props:
//   view      "graphing" (axes + grid), "geometry" (plain canvas, no axes or
//             grid) or "3d" (3D graphics). Default "graphing".
//   commands  GeoGebra input-bar commands, run in order once the applet is up,
//             e.g. ["a = Slider(0, 3, 0.1)", "SetValue(a, 1)", "f(x) = a sin(x)"].
//             A named definition GeoGebra rejects ("f(x) = sin(x", missing its
//             bracket) is logged with console.error and named under the
//             figure; the rest still run. Only NAMED ones can be checked:
//             GeoGebra answers false for every scripting command (SetColor,
//             SetFixed, ZoomIn) even when it worked, so a bare command is run
//             and not judged. Name what you create: "tri = Polygon(A, B, C)".
//   height    Pixel height (default 420). Width is the column's, tracked live.
//   algebra   Show the algebra view beside the figure (default false; on a
//             phone it takes half the width).
//   toolbar   Show the construction toolbar (default false).
//   params    Passthrough to GeoGebra's applet parameters, applied last, e.g.
//             { material_id: "abc123" } to load a geogebra.org material.
//   onReady   Called with the applet's API object once commands have run.
//   className Composable on the wrapper div.
//   mid       Marker id for debugging.
//
// The applet is always GeoGebra's "classic" app, because only it honours
// `perspective`: the newer graphing/3d app names keep an algebra sidebar that
// eats half a phone screen. Error dialogs are off, so a bad command can never
// cover the figure with a modal.
//
// Failure: if deployggb.js does not arrive within useGeoGebra's 8 s bound,
// the figure is replaced by a dashed fallback box. If the script arrives but
// the applet itself has not started within APPLET_TIMEOUT_MS, a note says so
// above the still-mounted host, and an applet that starts late clears it.
//
// The root carries data-ggb="loading" | "ready" | "failed" for tests and QA.

const APPLET_TIMEOUT_MS = 25000;
const PERSPECTIVE = { graphing: "G", geometry: "G", "3d": "T" };

const PRIMITIVE_CSS_ID = "core-geogebra-graph-style";
const GGB_CSS = `
.gg-root { position: relative; width: 100%; max-width: 100%; margin: 12px 0;
  border: 1px solid var(--border); border-radius: 6px; overflow: hidden;
  background: var(--bg-card); }
.gg-host { width: 100%; }
.gg-fallback { padding: 14px; font-family: 'IBM Plex Mono', monospace;
  font-size: 12px; color: var(--chat-stop-color); background: var(--bg-panel);
  border: 1px dashed var(--chat-stop-color); border-radius: 6px; text-align: center; }
.gg-loading { position: absolute; inset: 0; display: flex; align-items: center;
  justify-content: center; font-family: 'IBM Plex Mono', monospace; font-size: 12px;
  color: var(--text-dim); pointer-events: none; }
.gg-note { padding: 6px 10px; font-family: 'IBM Plex Mono', monospace; font-size: 11px;
  color: var(--chat-stop-color); background: var(--bg-panel); }
`;

function injectCss() {
  if (typeof document === "undefined") return;
  if (document.getElementById(PRIMITIVE_CSS_ID)) return;
  const tag = document.createElement("style");
  tag.id = PRIMITIVE_CSS_ID;
  tag.textContent = GGB_CSS;
  document.head.appendChild(tag);
}

// A command that names what it defines: "f(x, y) = ...", "a = ...",
// "eq1: x + y = 1". Not "==", which is a comparison.
const DEFINITION = /^\s*[\p{L}_][\p{L}\p{N}_']*\s*(\([^()]*\))?\s*(:|=(?!=))/u;

// GeoGebra publishes each applet's API as window[id], so two applets on one
// page need different ids.
let nextId = 0;

export function GeoGebraGraph({
  view = "graphing", commands, height = 420, algebra = false, toolbar = false,
  params, onReady, className, mid,
}) {
  const { ready, failed } = useGeoGebra();
  const hostRef = useRef(null);
  const apiRef = useRef(null);
  const [phase, setPhase] = useState("loading");
  const [badCommands, setBadCommands] = useState([]);

  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  // Remount only when what the applet shows changes, not when the parent
  // hands over a new array with the same commands in it.
  const sig = useMemo(() => {
    try { return JSON.stringify({ view, commands, height, algebra, toolbar, params }); } catch (_) { return ""; }
  }, [view, commands, height, algebra, toolbar, params]);

  useEffect(() => { injectCss(); }, []);

  useEffect(() => {
    if (!ready || !hostRef.current) return;
    const host = hostRef.current;
    const id = `ggbApplet_${++nextId}`;
    let alive = true;
    setPhase("loading");
    setBadCommands([]);
    const timer = setTimeout(() => { if (alive) setPhase(p => (p === "ready" ? p : "failed")); }, APPLET_TIMEOUT_MS);

    const perspective = (algebra ? "A" : "") + (PERSPECTIVE[view] || "G");
    const applet = new window.GGBApplet({
      appName: "classic",
      id,
      width: Math.max(host.clientWidth, 200),
      height,
      perspective,
      showToolBar: toolbar,
      showAlgebraInput: false,
      showMenuBar: false,
      showResetIcon: true,
      showZoomButtons: true,
      enableRightClick: false,
      enableShiftDragZoom: true,
      errorDialogsActive: false,
      useBrowserForJS: false,
      language: "en",
      ...(params || {}),
      appletOnLoad: (api) => {
        if (!alive) { try { api.remove(); } catch (_) {} return; }
        clearTimeout(timer);
        apiRef.current = api;
        if (view === "geometry") {
          api.setAxesVisible(false, false);
          api.setGridVisible(false);
        }
        const bad = [];
        for (const cmd of commands || []) {
          let ok = false;
          try { ok = api.evalCommand(cmd); } catch (_) {}
          if (!ok && DEFINITION.test(cmd)) bad.push(cmd);
        }
        if (bad.length) console.error(`[GeoGebraGraph${mid ? ` ${mid}` : ""}] GeoGebra rejected: ${bad.join(" | ")}`);
        setBadCommands(bad);
        setPhase("ready");
        try { onReadyRef.current && onReadyRef.current(api); } catch (e) { console.error(e); }
      },
    }, true);
    applet.inject(host);

    return () => {
      alive = false;
      clearTimeout(timer);
      const api = apiRef.current;
      apiRef.current = null;
      if (api) { try { api.remove(); } catch (_) {} }
      try { delete window[id]; } catch (_) {}
      host.replaceChildren();
    };
  }, [ready, sig]); // eslint-disable-line react-hooks/exhaustive-deps

  // Track the column's width: a phone rotating, the tutor panel docking, a
  // window resize. GeoGebra takes pixel sizes, so tell it.
  useEffect(() => {
    if (!ready || !hostRef.current) return;
    const host = hostRef.current;
    let t = null;
    const ro = new ResizeObserver(() => {
      clearTimeout(t);
      t = setTimeout(() => {
        const api = apiRef.current;
        if (api && host.clientWidth > 0) { try { api.setSize(host.clientWidth, height); } catch (_) {} }
      }, 100);
    });
    ro.observe(host);
    return () => { clearTimeout(t); ro.disconnect(); };
  }, [ready, height]);

  const cls = ["gg-root", className].filter(Boolean).join(" ");
  if (failed) {
    return (
      <div className={cls} data-mid={mid} data-ggb="failed">
        <div className="gg-fallback">GeoGebra figure unavailable: geogebra.org could not be reached.</div>
      </div>
    );
  }
  return (
    <div className={cls} data-mid={mid} data-ggb={ready ? phase : "loading"}>
      {ready && phase === "failed" && (
        <div className="gg-note">The GeoGebra applet has not started yet; it will appear here if it does.</div>
      )}
      {badCommands.length > 0 && (
        <div className="gg-note">GeoGebra rejected: {badCommands.join(" | ")}</div>
      )}
      {/* The host has no React children: GeoGebra's inject() empties it. */}
      <div ref={hostRef} className="gg-host" style={{ height }}/>
      {(!ready || phase === "loading") && <div className="gg-loading">Loading figure...</div>}
    </div>
  );
}
