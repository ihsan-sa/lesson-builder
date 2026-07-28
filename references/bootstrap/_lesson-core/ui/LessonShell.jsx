import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { ShellContext } from "./shellContext.js";
import { STYLES } from "../chat/chat.css.js";

// ───────────────────────────────────────────────────────────────
// LessonShell — the frame every lesson renders inside.
//
// Owns: the top bar, the contents rail (topic list + per-topic section
// outline + scroll-spy), the article scroll container, and WHERE the tutor
// panel lives (side dock / bottom dock / in-app window / real browser
// window). The lesson passes its Chatbot in as the `tutor` prop; the shell
// places it and hands the placement controls down through ShellContext so the
// dock switcher can render inside the panel header.
//
// The section outline is derived from the DOM (`.section-title` inside the
// article), not from a per-topic manifest — so any lesson built from the
// standard `<Section title>` primitive gets an outline with no extra authoring.
// ───────────────────────────────────────────────────────────────

const SIDE_MIN = 320, SIDE_DEFAULT = 392;
const BOTTOM_MIN = 180, BOTTOM_DEFAULT = 300;
const WIN_MIN_W = 380, WIN_MIN_H = 320;
// The docks have no fixed maximum: drag them as wide or as tall as the window
// allows, stopping only where the article would be squeezed out of existence.
const ARTICLE_MIN_W = 280, ARTICLE_MIN_H = 160;
const RAIL_W = 262, RAIL_W_COLLAPSED = 48, STRIP = 9;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const viewportW = () => (typeof window === "undefined" ? 1440 : window.innerWidth);
const viewportH = () => (typeof window === "undefined" ? 900 : window.innerHeight);

// Pointer-capture drag. onMove receives deltas from the pointerdown origin, so
// callers close over the value at drag start and never accumulate rounding.
function startDrag(e, onMove) {
  const el = e.currentTarget;
  if (!el) return;
  try { el.setPointerCapture(e.pointerId); } catch (_) {}
  const sx = e.clientX, sy = e.clientY;
  const move = (ev) => onMove(ev.clientX - sx, ev.clientY - sy);
  const up = () => {
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", up);
    el.removeEventListener("pointercancel", up);
  };
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
  e.preventDefault();
}

// ── Icons (Lucide geometry, stroke 1.6) ──
const ico = (d, extra = {}) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...extra}>{d}</svg>
);
export const IconPanelLeft = () => ico(<><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18" /></>);
export const IconExternal = () => ico(<><path d="M14 4h6v6M20 4l-8 8M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" /></>);
export const IconDockSide = () => ico(<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M15 4v16" /></>, { width: 14, height: 14 });
export const IconDockBottom = () => ico(<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 14h18" /></>, { width: 14, height: 14 });
export const IconSettings = () => ico(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></>);
export const IconArrowRight = () => ico(<><path d="M5 12h14M13 6l6 6-6 6" /></>, { width: 16, height: 16, strokeWidth: 1.5 });
export const IconClose = () => ico(<><path d="M6 6l12 12M18 6L6 18" /></>);

export function LessonShell({
  // Identity
  courseCode = "",
  courseName = "",
  lessonTitle = "",
  monogram,
  // Topics: [{ id, tab, title, subtitle, blurb }]
  topics = [],
  activeIdx = 0,
  onSelectTopic,
  // Optional reference links rendered under the rail divider
  refs: refLinks = [],
  // Tutor
  tutor = null,
  chatOpen = false,
  setChatOpen,
  // Content-block affordances (both default on)
  equationNumbers = true,
  equationExplain = true,
  // Article body for the active topic
  children,
  // Extra nodes rendered at shell root (context menus, overlays, ...)
  overlays = null,
  // Root-level handlers the lesson needs for context capture
  ...rootProps
}) {
  const [railOpen, setRailOpen] = useState(true);
  const [dock, setDockRaw] = useState("side");
  const [sideW, setSideW] = useState(SIDE_DEFAULT);
  const [bottomH, setBottomH] = useState(BOTTOM_DEFAULT);
  const [win, setWin] = useState({ x: 0, y: 0, w: 540, h: 500 });
  const [blocked, setBlocked] = useState(false);
  const [sections, setSections] = useState([]);
  const [secIdx, setSecIdx] = useState(0);
  const [popupHost, setPopupHost] = useState(null);

  const articleRef = useRef(null);
  const popupRef = useRef(null);
  const active = topics[activeIdx] || {};

  // ── Section outline + equation numbers: both are read back off the DOM the
  // topic actually rendered. KaTeX renders after mount and the tutor can
  // splice content in, so watch the subtree rather than scanning once.
  //
  // Equation numbers are stamped as `data-eq-num` on each `.eq-num` span (CSS
  // renders it with attr()). Deriving them from DOM order rather than a render
  // counter keeps them correct under StrictMode double renders, and survives
  // the tutor inserting an equation mid-topic.
  useEffect(() => {
    const el = articleRef.current;
    if (!el) return;
    let frame = 0;
    const scan = () => {
      const found = Array.from(el.querySelectorAll(".section-title"))
        .map((h) => (h.textContent || "").trim())
        .filter(Boolean);
      setSections((prev) =>
        prev.length === found.length && prev.every((t, i) => t === found[i]) ? prev : found,
      );
      const topicNum = activeIdx + 1;
      el.querySelectorAll(".eq-block[data-latex]").forEach((block, i) => {
        const slot = block.querySelector(".eq-num");
        if (!slot) return;
        const val = `(${topicNum}.${i + 1})`;
        if (slot.getAttribute("data-eq-num") !== val) slot.setAttribute("data-eq-num", val);
      });
    };
    scan();
    const obs = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(scan);
    });
    obs.observe(el, { childList: true, subtree: true, characterData: true });
    return () => { obs.disconnect(); cancelAnimationFrame(frame); };
  }, [activeIdx]);

  // Topic switch: back to the top, outline highlight resets.
  useEffect(() => {
    setSecIdx(0);
    const el = articleRef.current;
    if (el) el.scrollTop = 0;
  }, [activeIdx]);

  // ── Scroll-spy: current section is the last heading whose top is within
  // 60px of the article's top edge. Measured with getBoundingClientRect, not
  // offsetTop — offsetTop is relative to the nearest positioned ancestor, which
  // is not the scroll container, so the offsetTop form silently mis-tracks
  // once anything in the content tree is positioned.
  const headingOffsets = () => {
    const main = articleRef.current;
    if (!main) return { main: null, heads: [], tops: [] };
    const heads = Array.from(main.querySelectorAll(".section-title"));
    const base = main.getBoundingClientRect().top - main.scrollTop;
    return { main, heads, tops: heads.map((h) => h.getBoundingClientRect().top - base) };
  };

  const handleScroll = useCallback(() => {
    const { main, tops } = headingOffsets();
    if (!main) return;
    let best = 0;
    for (let i = 0; i < tops.length; i++) {
      if (tops[i] - 60 <= main.scrollTop) best = i;
    }
    // Bottom clamp. Whenever the content under the last heading is shorter
    // than the viewport, that heading never reaches the 60px line and the
    // final outline entry can never light up. At the end of the scroll the
    // last section IS the one being read, so say so.
    if (tops.length && main.scrollTop >= main.scrollHeight - main.clientHeight - 2) {
      best = tops.length - 1;
    }
    setSecIdx((prev) => (prev === best ? prev : best));
  }, []);

  const jumpToSection = useCallback((i) => {
    const { main, tops } = headingOffsets();
    if (!main || tops[i] == null) return;
    main.scrollTo({ top: Math.max(0, tops[i] - 18), behavior: "smooth" });
    setSecIdx(i);
  }, []);

  // ── Popup window. A React portal into window.open's document: the panel
  // stays in the same React tree and the same JS context, so session state,
  // threads and window.katex all keep working with no cross-window sync.
  const closePopup = useCallback(() => {
    const w = popupRef.current;
    popupRef.current = null;
    setPopupHost(null);
    if (w && !w.closed) { try { w.close(); } catch (_) {} }
  }, []);

  const setDock = useCallback((next) => {
    if (next !== "popup") closePopup();
    setBlocked(false);
    setDockRaw(next);
    if (setChatOpen) setChatOpen(true);
  }, [closePopup, setChatOpen]);

  const openPopup = useCallback(() => {
    if (popupRef.current && !popupRef.current.closed) { popupRef.current.focus(); return; }
    let w = null;
    try { w = window.open("", "lesson-tutor", "popup=yes,width=560,height=700"); } catch (_) { w = null; }
    if (!w) {
      // Blocked: fall back to the in-app window and say so.
      setBlocked(true);
      setDockRaw("window");
      setWin((g) => ({
        ...g,
        x: g.x || Math.max(24, window.innerWidth - g.w - 48),
        y: g.y || Math.max(24, Math.round(window.innerHeight * 0.28)),
      }));
      if (setChatOpen) setChatOpen(true);
      return;
    }
    popupRef.current = w;
    const d = w.document;
    try { d.title = `${lessonTitle || "Lesson"} — Tutor`; } catch (_) {}
    const kl = d.createElement("link");
    kl.rel = "stylesheet";
    kl.href = "https://cdn.jsdelivr.net/npm/katex@0.16.21/dist/katex.min.css";
    d.head.appendChild(kl);
    const st = d.createElement("style");
    st.textContent = STYLES + "\nhtml,body{margin:0;padding:0;height:100%;background:var(--surface);}";
    d.head.appendChild(st);
    const host = d.createElement("div");
    host.className = "theme-light";
    host.style.cssText = "height:100%;display:flex;flex-direction:column;";
    d.body.appendChild(host);
    const onGone = () => { popupRef.current = null; setPopupHost(null); setDockRaw("side"); };
    w.addEventListener("beforeunload", onGone);
    setPopupHost(host);
    setBlocked(false);
    setDockRaw("popup");
    if (setChatOpen) setChatOpen(true);
  }, [lessonTitle, setChatOpen]);

  // A popup closed by the OS chrome does not always fire beforeunload; poll.
  useEffect(() => {
    if (!popupHost) return;
    const id = setInterval(() => {
      if (popupRef.current && popupRef.current.closed) {
        popupRef.current = null;
        setPopupHost(null);
        setDockRaw("side");
      }
    }, 700);
    return () => clearInterval(id);
  }, [popupHost]);

  // Never leave an orphaned popup behind.
  useEffect(() => {
    const bye = () => { const w = popupRef.current; if (w && !w.closed) { try { w.close(); } catch (_) {} } };
    window.addEventListener("beforeunload", bye);
    return () => { window.removeEventListener("beforeunload", bye); bye(); };
  }, []);

  // ── Resize handles ──
  // Bounds are computed from the live viewport rather than being constants, so
  // the panel can be dragged to nearly the full window width.
  const sideMax = useCallback(
    () => Math.max(SIDE_MIN, viewportW() - (railOpen ? RAIL_W : RAIL_W_COLLAPSED) - STRIP - ARTICLE_MIN_W),
    [railOpen],
  );
  const bottomMax = useCallback(
    () => Math.max(BOTTOM_MIN, viewportH() - 66 - STRIP - ARTICLE_MIN_H),
    [],
  );

  const onResizeSide = useCallback((e) => {
    const w0 = sideW;
    startDrag(e, (dx) => setSideW(clamp(Math.round(w0 - dx), SIDE_MIN, sideMax())));
  }, [sideW, sideMax]);

  const onResizeBottom = useCallback((e) => {
    const h0 = bottomH;
    startDrag(e, (_dx, dy) => setBottomH(clamp(Math.round(h0 - dy), BOTTOM_MIN, bottomMax())));
  }, [bottomH, bottomMax]);

  // Re-clamp when the window shrinks or the rail toggles, or a panel dragged
  // wide on a large screen would push the article off the layout.
  useEffect(() => {
    const refit = () => {
      setSideW((w) => clamp(w, SIDE_MIN, sideMax()));
      setBottomH((h) => clamp(h, BOTTOM_MIN, bottomMax()));
    };
    refit();
    window.addEventListener("resize", refit);
    return () => window.removeEventListener("resize", refit);
  }, [sideMax, bottomMax]);

  const onWindowDrag = useCallback((e) => {
    const g = win;
    startDrag(e, (dx, dy) => setWin((p) => ({
      ...p,
      x: clamp(Math.round(g.x + dx), -(g.w - 120), window.innerWidth - 120),
      y: clamp(Math.round(g.y + dy), 0, window.innerHeight - 60),
    })));
  }, [win]);

  const onWindowResize = useCallback((e) => {
    const g = win;
    startDrag(e, (dx, dy) => setWin((p) => ({
      ...p,
      w: clamp(Math.round(g.w + dx), WIN_MIN_W, Math.max(WIN_MIN_W, window.innerWidth - 40)),
      h: clamp(Math.round(g.h + dy), WIN_MIN_H, Math.max(WIN_MIN_H, window.innerHeight - 40)),
    })));
  }, [win]);

  // Chatbot gates its own panel out of PROD builds (static hosts have no
  // proxy). The shell must gate its affordances too, or a deployed lesson ships
  // a Tutor button that does nothing and a pop-out that opens an empty window.
  const tutorEnabled = !!tutor && !import.meta.env.PROD;
  const showTutor = chatOpen && tutorEnabled;
  const place = showTutor ? (popupHost ? "popup" : dock) : null;

  // Dock changes must not remount the tutor, or the session, transcript and
  // open threads go with it. Two things would cause a remount and both are
  // avoided here:
  //   1. rendering {tutor} inside each dock's branch moves it in the React
  //      tree -> remount. So it is rendered from one fixed place.
  //   2. re-pointing a portal at a different container ALSO remounts (React
  //      does not move portal children between containers). So the portal
  //      container is a single node created once, and it is the DOM node that
  //      moves between slots. Moving a host node does not touch the fiber
  //      tree, so state survives every placement including the popup document.
  const [sideSlot, setSideSlot] = useState(null);
  const [bottomSlot, setBottomSlot] = useState(null);
  const [windowSlot, setWindowSlot] = useState(null);

  const hostRef = useRef(null);
  if (!hostRef.current && typeof document !== "undefined") {
    hostRef.current = document.createElement("div");
    hostRef.current.className = "tutor-host";
  }
  const host = hostRef.current;

  useLayoutEffect(() => {
    if (!host) return;
    // While the tutor is closed it parks in the window slot rather than being
    // detached: Chatbot hides itself with display:none, and lesson code still
    // queries .chat-input to move focus.
    const target =
      place === "popup" ? popupHost :
      place === "side" ? sideSlot :
      place === "bottom" ? bottomSlot :
      place === "window" ? windowSlot :
      windowSlot;
    if (target && host.parentNode !== target) target.appendChild(host);
  }, [host, place, popupHost, sideSlot, bottomSlot, windowSlot]);

  const panelStyle = useMemo(() => {
    if (place === "window") return { left: win.x, top: win.y, width: win.w, height: win.h };
    return undefined;
  }, [place, win]);

  const shellCtx = useMemo(() => ({
    dock: place || dock,
    setDock,
    openPopup,
    closePopup,
    blocked,
    panelStyle,
    onWindowDrag,
    onWindowResize,
    chatOpen,
    closeChat: () => setChatOpen && setChatOpen(false),
    topicTitle: active.title || "",
    topicNumber: activeIdx + 1,
  }), [place, dock, setDock, openPopup, closePopup, blocked, panelStyle, onWindowDrag,
       onWindowResize, chatOpen, setChatOpen, active.title, activeIdx]);

  const mono = monogram || (courseCode || lessonTitle || "L").trim().charAt(0).toUpperCase() || "L";
  // Position, not progress: "you are on topic N of M". Counting the current
  // topic keeps the bar from reading empty on the first one.
  const pct = topics.length ? Math.round(((activeIdx + 1) / topics.length) * 100) : 0;
  const pad = (n) => String(n).padStart(2, "0");

  return (
    <ShellContext.Provider value={shellCtx}>
      <div className={`lesson-shell theme-light ${chatOpen ? "ctx-active" : ""}`} {...rootProps}>
        <style>{STYLES}</style>

        {/* ── Top bar ── */}
        <div className="topbar">
          <div className="topbar-left">
            <button
              className="rail-toggle"
              onClick={() => setRailOpen((o) => !o)}
              title={railOpen ? "Hide contents" : "Show contents"}
              aria-label={railOpen ? "Hide contents" : "Show contents"}
            >
              <span style={{ color: "var(--ink-3)", display: "flex" }}><IconPanelLeft /></span>
            </button>
            <div className="topbar-monogram" aria-hidden="true">{mono}</div>
            <div className="topbar-titles">
              {(courseCode || courseName) && (
                <div className="topbar-course">
                  {courseCode}{courseCode && courseName ? " · " : ""}{courseName}
                </div>
              )}
              <h1 className="topbar-title">{lessonTitle}</h1>
            </div>
          </div>
          <div className="topbar-right">
            {topics.length > 0 && (
              <div className="topbar-position" title="Position in this lesson">
                <div className="topbar-position-track">
                  <div className="topbar-position-fill" style={{ width: `${pct}%` }} />
                </div>
                <div className="topbar-position-label">
                  {pad(activeIdx + 1)} / {pad(topics.length)}
                </div>
              </div>
            )}
            {tutorEnabled && (
              <>
                <button
                  className={`tutor-btn ${chatOpen ? "tutor-btn-on" : ""}`}
                  onClick={() => setChatOpen && setChatOpen(!chatOpen)}
                >
                  Tutor
                </button>
                <button
                  className="topbar-popout"
                  onClick={openPopup}
                  title="Open the tutor in its own window"
                  aria-label="Open the tutor in its own window"
                >
                  <span style={{ color: "var(--ink-3)", display: "flex" }}><IconExternal /></span>
                </button>
              </>
            )}
          </div>
        </div>

        {import.meta.env.PROD && (
          <div className="prod-banner">
            The AI tutor is only available when running locally. See the repository README for setup instructions.
          </div>
        )}

        {/* ── Body ── */}
        <div className="shell-body">
          {railOpen ? (
            <nav className="rail" aria-label="Contents">
              <div className="rail-label">Contents</div>
              {topics.map((t, i) => (
                <div key={t.id}>
                  <button
                    className={`rail-topic ${i === activeIdx ? "rail-topic-active" : ""}`}
                    onClick={() => onSelectTopic && onSelectTopic(i)}
                  >
                    <span className="rail-topic-num">{pad(i + 1)}</span>
                    <span className="rail-topic-title">{t.tab || t.title}</span>
                  </button>
                  {i === activeIdx && sections.length > 0 && (
                    <div className="rail-outline">
                      {sections.map((s, j) => (
                        <button
                          key={`${s}-${j}`}
                          className={`rail-outline-item ${j === secIdx ? "rail-outline-current" : ""}`}
                          onClick={() => jumpToSection(j)}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {refLinks.length > 0 && (
                <div className="rail-refs">
                  {refLinks.map((r) => (
                    <a key={r.href || r.label} className="rail-ref" href={r.href}
                       target={/^https?:/.test(r.href || "") ? "_blank" : undefined} rel="noreferrer">
                      {r.label}
                    </a>
                  ))}
                </div>
              )}
            </nav>
          ) : (
            <nav className="rail rail-collapsed" aria-label="Contents">
              {topics.map((t, i) => (
                <button
                  key={t.id}
                  className={`rail-num-only ${i === activeIdx ? "rail-num-active" : ""}`}
                  onClick={() => onSelectTopic && onSelectTopic(i)}
                  title={t.tab || t.title}
                >
                  {pad(i + 1)}
                </button>
              ))}
            </nav>
          )}

          <div className="shell-main">
            <main
              className="article"
              ref={articleRef}
              onScroll={handleScroll}
              data-eq-nums={equationNumbers ? "on" : "off"}
              data-eq-explain={equationExplain ? "on" : "off"}
            >
              <div className="article-col">
                {(active.subtitle || active.title) && (
                  <>
                    <div className="article-kicker">
                      Topic {pad(activeIdx + 1)}{active.subtitle ? ` · ${active.subtitle}` : ""}
                    </div>
                    <h2 className="article-title">{active.title}</h2>
                    {active.blurb && <div className="article-blurb">{active.blurb}</div>}
                    <div className="article-rule" />
                  </>
                )}
                {children}
              </div>
            </main>

            {place === "bottom" && (
              <>
                <div className="tutor-resize-y" onPointerDown={onResizeBottom} />
                <div className="tutor-slot tutor-slot-bottom" ref={setBottomSlot} style={{ height: bottomH }} />
              </>
            )}
          </div>

          {place === "side" && (
            <>
              <div className="tutor-resize-x" onPointerDown={onResizeSide} />
              <div className="tutor-slot tutor-slot-side" ref={setSideSlot} style={{ width: sideW }} />
            </>
          )}
        </div>

        <div ref={setWindowSlot} />
        {tutorEnabled && host && createPortal(tutor, host)}
        {overlays}
      </div>
    </ShellContext.Provider>
  );
}

export default LessonShell;
