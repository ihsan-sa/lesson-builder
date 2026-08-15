# Lesson Skeleton Template

New-mode Phase 3 starting point. Main Claude copies this skeleton into `src/<slug>.jsx` and fills `// TODO:` markers with content from specialists. Update mode does NOT use this file.

## What's per-lesson vs from @core

- **Per-lesson**: `LESSON_CONTEXT`, `TOPIC_CONTEXT`, `DEFAULT_GRAPH_PARAMS`, `GRAPH_SCHEMA`, graph components, `TOPICS`, `LessonApp`.
- **From @core**: `LessonShell` (top bar, contents rail, article, tutor docking), `Chatbot`, `STYLES`, UI primitives (`Eq`, `M`, `P`, `Section`, `KeyConcept`, `CollapsibleBlock`, `RefImg`, `PracticeProblem`, `FormulaSheetBox`, `SummaryBox`), `DesmosGraph`, interactive primitives (`Slider`, `Toggle`, ...), constants (`THEMES_G`, `MODELS`, `EFFORT_LEVELS`, `DEFAULT_MODEL`, `DEFAULT_EFFORT` — `MODELS` marks Opus 5 as the default the chat opens with, at `xhigh` effort), hooks (`useKatex`, `useDesmos`).
- **External**: `server/proxy.js` is a 1-line shim, added by the file-scaffolding step.

## GRAPH_SCHEMA requirement

Mandatory. Client-side validation map for `<<EDIT_GRAPH>>`; rejects invalid parameter edits before they reach graph components. Keys must match `DEFAULT_GRAPH_PARAMS` exactly. See `references/graph-schema-guide.md`.

## Skeleton

```jsx
import { useState, useEffect, useRef, useCallback } from "react";
import {
  Chatbot, LessonShell,
  Eq, M, P, Section, KeyConcept, CollapsibleBlock, RefImg,
  THEMES_G, useKatex, STYLES, routeLessonContext,
} from "@core";
// Optional @core imports — add to the import block above only when used:
//   LiveGraph                    REQUIRED wrapper around every graph call
//                                site; emits the data-graph-key /
//                                data-graph-render-id attributes the chatbot's
//                                visual-verification step screenshots
//   PracticeProblem              practice-problem cards (canonical pattern
//                                documented below, before TOPICS)
//   FormulaSheetBox, SummaryBox  callout boxes for formula-sheet / course-
//                                summary material
//   DesmosGraph, useDesmos       live Desmos calculator embeds. Requires
//                                VITE_DESMOS_KEY in the workspace-root
//                                .env.local (served to every lesson via the
//                                envDir setting in vite.config.js; the hook
//                                fails loud and renders a red fallback if
//                                the key is missing).

// ───────────────────────────────────────────────────────────────
// Lesson Context (passed to Chatbot as system-prompt scaffolding)
// ───────────────────────────────────────────────────────────────

const LESSON_CONTEXT = `/* TODO: one paragraph describing the course, unit, lecture range, and
learning goals. Cover:
  - Course code and full course name (e.g. "<COURSE CODE> (<Full Course Name>)")
  - Institution and term (if relevant)
  - Which lectures / sections / units this lesson covers
  - What the student should walk away able to DO (the topic objectives)

Do NOT paste a pedagogy policy here. The canonical PEDAGOGY POLICY (retrieval-
first, least-help-first hint ladder, step-level interaction, task-level
feedback, misconception refutation, transfer checks) is injected automatically
by @core/chat/buildSystemPrompt.js — the shared core is its single source of
truth, so every lesson runs the same current policy. Legacy lessons that
embedded the old policy text are detected by marker and not double-injected.

What DOES belong here as tutor steering: course-specific conventions (notation,
sign conventions, what the course calls things), the lesson's objectives, and
anything the tutor should emphasize or avoid for THIS course. Per-topic
misconceptions go in TOPIC_CONTEXT (below), where the active tab reinforces
them. Never write steering that weakens the policy ("just give answers") — the
Phase 4 pedagogy gate flags it.
*/`;

// ───────────────────────────────────────────────────────────────
// Topic Context (per-tab system-prompt augmentation)
// ───────────────────────────────────────────────────────────────
//
// One entry per TOPICS id. Be detailed: include equations, key variables,
// given values, and the conceptual framing the student needs. The chatbot
// uses the entry matching the currently-active tab as extra system context.
//
// Pedagogy hook: where a topic has a KNOWN misconception, name it here (the
// faulty intuition + its error signature + the correct conception) so the
// tutor can diagnose-then-refute it on the active tab instead of guessing.

const TOPIC_CONTEXT = {
  // TODO: one entry per lesson topic. Example shape:
  "topic-1": `Topic: [Name]. Covers: [equations], [key variables], [given values]. [What the student needs to understand].`,
  "topic-2": `Topic: [Name]. Covers: ...`,
};

// ───────────────────────────────────────────────────────────────
// Lesson-local media URLs (optional, resolved per-bundle by Vite)
// ───────────────────────────────────────────────────────────────

const IMG = import.meta.env.BASE_URL + "images/";
const VID = import.meta.env.BASE_URL + "videos/";

// ───────────────────────────────────────────────────────────────
// Module-level graph theme binding
// ───────────────────────────────────────────────────────────────
//
// Graph components reference `G` at module scope for their colors. The Lumen
// shell is light-only (the design specifies a single palette), so this is now
// a fixed binding — keep the `let` declaration and the name, since every graph
// component closes over it.

let G = THEMES_G.light;

// ───────────────────────────────────────────────────────────────
// Default Graph Parameters
// ───────────────────────────────────────────────────────────────
//
// One key per graph component. Each value is an object of parameters the
// component consumes. Keep keys in lowerCamelCase.

const DEFAULT_GRAPH_PARAMS = {
  // TODO: one key per graph component. Example:
  // exampleGraph:  { nMax: 4, showOverlay: false },
  // secondGraph:   { nMax: 6, width: 1.0 },
};

// ───────────────────────────────────────────────────────────────
// Graph Schema (REQUIRED — client-side validation for <<EDIT_GRAPH>>)
// ───────────────────────────────────────────────────────────────
//
// Keys must mirror DEFAULT_GRAPH_PARAMS exactly. Each parameter declares
// its type and allowed range. Supported type tags:
//
//   { type: "int",   min, max }         integer slider
//   { type: "float", min, max }         continuous numeric
//   { type: "bool"  }                   toggle
//   { type: "enum",  values: [...] }    one-of (note: key is "values", NOT "enum")
//
// IMPORTANT: if a graph component hard-clamps a parameter (e.g.
// `Math.min(p.nMax, 6)`), the schema `max` MUST match that clamp so the
// chatbot receives a rejection observation instead of a silent clamp.
//
// See references/graph-schema-guide.md for the full spec.

export const GRAPH_SCHEMA = {
  // TODO: one entry per DEFAULT_GRAPH_PARAMS key. Example:
  // exampleGraph: {
  //   nMax:        { type: "int",  min: 1, max: 6 },
  //   showOverlay: { type: "bool" },
  // },
  // secondGraph: {
  //   nMax:  { type: "int",   min: 1, max: 8 },
  //   width: { type: "float", min: 0.2, max: 5.0 },
  // },
};

// ───────────────────────────────────────────────────────────────
// Graph Components
// ───────────────────────────────────────────────────────────────
//
// Each graph is a React function component that returns an SVG wrapped in
// a `<div className="eq-block">`. Props shape: `{ params, mid = "" }`.
//
// - `params` is the live slice from graphParams state (e.g. gp.myGraph).
// - `mid` is an optional marker-id suffix used to disambiguate `<marker>`
//   definitions when the same graph is rendered twice on one page (e.g.
//   the same component reused across two topics).
// - Use `G` (module-level theme binding) for colors.
// - Spread DEFAULT_GRAPH_PARAMS into the merged params so partial updates
//   from <<EDIT_GRAPH>> keep the unspecified defaults:
//     const p = { ...DEFAULT_GRAPH_PARAMS.myGraph, ...params };
//
// See references/phase-3-execution.md for SVG construction tactics
// (viewBox sizing, arrow markers, path generation, label placement).
//
// RENDERING A GRAPH IN A TOPIC: wrap every graph call site in `LiveGraph`
// (from @core), passing the DEFAULT_GRAPH_PARAMS key and the renderId:
//
//     <LiveGraph graphKey="myGraph" renderId={renderId}>
//       <MyGraph params={gp.myGraph} />
//     </LiveGraph>
//
// LiveGraph is a bare, unstyled wrapper whose only job is to emit
// `data-graph-key` and `data-graph-render-id`. After an <<EDIT_GRAPH>> applies,
// the chatbot queues a visual-verification observation telling itself to
// screenshot `[data-graph-key="..."][data-graph-render-id="..."]` — without the
// wrapper that selector matches nothing and the whole visual feedback loop
// silently no-ops. It is also what lets Ctrl+Click on a graph capture the
// graph's key and live parameters instead of a few stray axis labels.

// TODO: add graph components. Example pattern:
//
// function MyGraph({ params, mid = "" }) {
//   const p = { ...DEFAULT_GRAPH_PARAMS.myGraph, ...params };
//   const w = 500, h = 320, ox = 60, oy = 290, plotW = 380, plotH = 250;
//
//   // build path data from p
//   let d = "";
//   for (let i = 0; i <= 200; i++) {
//     const xNorm = i / 200;
//     const x = ox + xNorm * plotW;
//     const val = /* TODO: evaluate equation */ Math.sin(xNorm * Math.PI);
//     const y = oy - val * plotH;
//     d += (i === 0 ? "M" : " L") + x.toFixed(1) + "," + y.toFixed(1);
//   }
//
//   return (
//     <div className="eq-block" style={{ padding: "16px", overflow: "hidden" }}>
//       <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", maxWidth: w, display: "block", margin: "0 auto" }}>
//         <title>TODO: accessible description</title>
//         <defs>
//           <marker id={`ah-mg${mid}`} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
//             <path d="M0,0 L6,3 L0,6" fill="none" stroke={G.ax} strokeWidth="1" />
//           </marker>
//         </defs>
//         {/* axes with arrow markers */}
//         <line x1={ox} y1={oy} x2={ox + plotW + 20} y2={oy} stroke={G.ax} strokeWidth="1" markerEnd={`url(#ah-mg${mid})`} />
//         <line x1={ox} y1={oy} x2={ox} y2={20} stroke={G.ax} strokeWidth="1" markerEnd={`url(#ah-mg${mid})`} />
//         {/* curve */}
//         <path d={d} fill="none" stroke={G.gold} strokeWidth="2" />
//         {/* labels */}
//         <text x={ox + plotW / 2} y={oy + 28} fill={G.txt} fontSize="10" fontFamily="'JetBrains Mono'" textAnchor="middle">x</text>
//       </svg>
//     </div>
//   );
// }

// ───────────────────────────────────────────────────────────────
// Lesson-specific helper components (optional)
// ───────────────────────────────────────────────────────────────
//
// Things like a homework question card, a derivation walkthrough, or a
// standalone animation belong here. They do NOT move to @core — they are
// per-lesson. Keep them above TOPICS so `content(gp)` can reference them.
//
// TODO: add lesson-specific helpers if needed.

// ───────────────────────────────────────────────────────────────
// Practice problem card — the canonical pattern
// ───────────────────────────────────────────────────────────────
//
// Phase 1 extracts practice problems from source materials (past finals,
// midterms, HW, problem sets) and tags each with a source, difficulty, and
// full worked solution. Render them with the `PracticeProblem` component
// from @core (do NOT hand-roll a local card) so every lesson behaves the
// same: statement visible by default, solution collapsed behind a toggle so
// students attempt first and then check.
//
// This coexists with the core-injected PEDAGOGY POLICY rather than
// contradicting it: the policy governs the CHATBOT, which still withholds
// answers and escalates hints (withhold-first). Practice cards may carry full
// worked solutions because they are (a) collapsed by default — leave defaultOpen
// false, (b) provenance-marked — the card badges OFFICIAL SOLUTION vs
// AI-WORKED SOLUTION, and (c) sourced — official solutions come verbatim
// from the materials; derived ones must pass the two-source cross-reference
// bar first.
//
// <PracticeProblem
//   source="Final 2024 — Q3"     // provenance tag from Phase 1
//   difficulty="core"            // optional: intro | core | stretch — the
//                                // same three tokens Phase 1 emits and the
//                                // only ones @core styles (pp-diff-intro /
//                                // -core / -stretch). Any other value renders
//                                // an unstyled badge.
//   provenance="official"        // "official" (Phase 1 solution_provenance
//                                // "from-source") renders the OFFICIAL
//                                // SOLUTION badge; any other value (use
//                                // "ai-worked" for orchestrator-derived)
//                                // renders AI-WORKED SOLUTION
//   aiSources={["<source 1>", "<source 2>"]}
//                                // required when provenance is not
//                                // "official": the >=2 independent sources
//                                // the derived solution was cross-checked
//                                // against; rendered as a "Verified
//                                // against:" list under the solution
//   statement={<P>Problem statement JSX</P>}
//   solution={<>{/* equations, step-by-step reasoning, final answer */}</>}
// />
//
// In a topic's content(gp), drop a <Section title="Practice problems"> at the
// end of the topic body and render one <PracticeProblem .../> per entry in
// that topic's Phase 1 practice_problems array. Omit the whole Section when
// the array is empty — do NOT render an empty "Practice problems" heading,
// and do NOT fabricate problems to fill the slot.
//
// Solutions MUST include the final numerical answer with units and sig figs
// preserved exactly as the source gave them. Derived solutions (flagged
// solution_provenance="orchestrator-derived" in Phase 1) must pass the same
// two-source cross-reference bar as other equations before landing here, and
// must list their verification sources in aiSources.

// ───────────────────────────────────────────────────────────────
// Topics (tab bar + content functions)
// ───────────────────────────────────────────────────────────────
//
// Each entry is `{ id, tab, title, subtitle, blurb, content }`. `content` is a
// function `(gp, renderId) => JSX` so graph components can receive live
// params; the optional second arg is the graphRenderId — key a component on
// it when it must re-render after an <<EDIT_GRAPH>> (most content ignores it).
// Topic ids must match TOPIC_CONTEXT keys exactly (test_lesson.cjs checks
// this).
//
// How each field renders in the shell:
//   tab       contents-rail row label (keep it short — the rail is 262px)
//   title     the 38px article headline
//   subtitle  the uppercase kicker after "Topic NN ·" (e.g. "Core result")
//   blurb     one or two sentences under the headline; optional but wanted
//
// The rail's per-topic section outline is derived from the `<Section title>`
// headings the topic renders — no separate outline manifest to keep in sync.

const TOPICS = [
  // TODO: one entry per topic. The prose is authored against the topic's
  // teaching_arc from the approved plan, under references/teaching-
  // communication.md; full positive exemplars (a concept arc and a procedure
  // arc) are in references/template.md § "Exposition exemplars". Shape:
  // {
  //   id: "topic-1",
  //   tab: "Impedance",
  //   title: "Impedance sets the current",
  //   subtitle: "Core relation",
  //   blurb: "For a fixed source voltage, |Z| sets how much current flows and its angle sets when.",
  //   content: (gp, renderId) => (
  //     <Section title="Current at fixed voltage">
  //       <P>
  //         A sinusoidal source of fixed amplitude drives a series R-L-C branch.
  //         In AC steady state the branch is one complex number, its impedance
  //         <M>{"Z"}</M>, and the phasor current follows from the phasor voltage:
  //       </P>
  //       <Eq>{"\\tilde{I} = \\tilde{V}/Z, \\qquad Z = R + j\\left(\\omega L - \\tfrac{1}{\\omega C}\\right)"}</Eq>
  //       <P>
  //         Because <M>{"|\\tilde{V}|"}</M> is fixed, the current magnitude is
  //         <M>{"|\\tilde{V}|/|Z|"}</M>: halve <M>{"|Z|"}</M> and the current
  //         doubles. (Symbols defined at first use; the sentence after the
  //         equation carries the inference the equation alone does not.
  //         KaTeX: use \\lt and \\gt, never bare &lt; or &gt;.)
  //       </P>
  //       <LiveGraph graphKey="myGraph" renderId={renderId}>
  //         <MyGraph params={gp.myGraph} />
  //       </LiveGraph>
  //     </Section>
  //   ),
  // },
];

// ───────────────────────────────────────────────────────────────
// LessonApp (main component)
// ───────────────────────────────────────────────────────────────

function LessonApp() {
  const katexReady = useKatex();
  const [activeIdx, setActiveIdx] = useState(0);
  const [contextSnippets, setContextSnippets] = useState([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [graphParams, setGraphParams] = useState(DEFAULT_GRAPH_PARAMS);
  const [graphRenderId, setGraphRenderId] = useState(0);
  const mouseDownPos = useRef(null);
  const [ctxMenu, setCtxMenu] = useState(null);
  const [threadTrigger, setThreadTrigger] = useState(null);
  const [threadCtxTrigger, setThreadCtxTrigger] = useState(null);

  // Ctrl-/ toggles the chat panel; Ctrl-Shift-F adds the current selection to
  // the surrounding thread's context (fires only inside a .thread-panel).
  useEffect(() => {
    const handleKey = (e) => {
      if (e.ctrlKey && e.key === "/") {
        e.preventDefault();
        setChatOpen((o) => !o);
      }
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "f") {
        const sel = window.getSelection();
        const text = sel ? sel.toString().trim() : "";
        if (text.length < 3) return;
        const threadEl = sel.anchorNode?.parentElement?.closest('.thread-panel[data-thread-id]');
        if (threadEl) {
          e.preventDefault();
          const tid = threadEl.getAttribute('data-thread-id');
          setThreadCtxTrigger({ threadId: tid, text, source: "thread selection", ts: Date.now() });
          sel.removeAllRanges();
        }
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  // ?tab=<topic-id> deep link. The chatbot's visual-verify flow navigates to
  // this URL shape to screenshot a specific tab — do not remove.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tabId = params.get('tab');
    if (tabId) {
      const idx = TOPICS.findIndex(t => t.id === tabId);
      if (idx >= 0) setActiveIdx(idx);
    }
  }, []);

  // Chatbot <<EDIT_GRAPH>> callback: shallow-merge per-key param edits.
  // Also bump graphRenderId so any graph that would otherwise stay mounted
  // with stale props re-renders.
  const handleEditGraph = useCallback((edits) => {
    setGraphParams((prev) => {
      const next = { ...prev };
      for (const [key, val] of Object.entries(edits)) {
        if (next[key]) next[key] = { ...next[key], ...val };
      }
      return next;
    });
    setGraphRenderId((id) => id + 1);
  }, []);

  const handleClearSnippet = useCallback(
    (i) => setContextSnippets((prev) => prev.filter((_, idx) => idx !== i)),
    [],
  );
  const handleClearAllSnippets = useCallback(() => setContextSnippets([]), []);

  // Captured context goes to a focused side-thread when there is one, and to
  // the main chip bar otherwise. routeLessonContext returns false when no
  // thread composer has focus, so this is the same behaviour as before in the
  // common case — but it means a student replying in a thread can Ctrl+Click
  // lesson content straight into that thread.
  const addSnippet = useCallback((text, source) => {
    const clean = text.replace(/\s+/g, " ").trim();
    if (!clean || clean.length < 3) return;
    if (routeLessonContext(clean, source)) return;
    setContextSnippets((prev) =>
      prev.some((s) => s.text === clean) ? prev : [...prev, { text: clean, source }],
    );
  }, []);

  const active = TOPICS[activeIdx];

  // ── Context-capture + thread wiring (canonical; matches the reference
  // lessons). Plain clicks are stopped by @core's capture-phase listener
  // unless Ctrl is held, so these handlers only see clicks that should act.
  // Without this block, click-to-context, selection-to-context, and the
  // right-click "Reply / Reply in thread" menu all silently do nothing.

  const handleContentMouseDown = useCallback((e) => {
    mouseDownPos.current = { x: e.clientX, y: e.clientY };
  }, []);

  // Ctrl+Click on a content block → add it to chat context.
  const handleContentClick = useCallback((e) => {
    if (!chatOpen) return;
    if (e.target.closest(".chat-panel, .chat-toggle, .topbar, .rail")) return;
    if (mouseDownPos.current) {
      const dx = Math.abs(e.clientX - mouseDownPos.current.x);
      const dy = Math.abs(e.clientY - mouseDownPos.current.y);
      if (dx > 5 || dy > 5) return;   // it was a drag/selection, not a click
    }
    const sel = window.getSelection();
    if (sel && sel.toString().trim().length > 0) sel.removeAllRanges();
    // This selector list MUST match the capture-phase gate in
    // @core/chat/Chatbot.jsx and the hover-highlight rules in chat.css.js. A
    // class in one list but not the others gets the pointer cursor and the
    // hover outline but silently does nothing when clicked.
    const el = e.target.closest(".eq-block, .key-concept, .formula-sheet-box, .summary-box, .practice-problem, .compare-card, .para, .info-list li, .section-title");
    if (!el) return;
    let source = "element";
    if (el.classList.contains("eq-block")) source = "equation";
    else if (el.classList.contains("key-concept")) source = "concept";
    else if (el.classList.contains("formula-sheet-box")) source = "formula sheet";
    else if (el.classList.contains("summary-box")) source = "course summary";
    else if (el.classList.contains("practice-problem")) source = "practice problem";
    else if (el.classList.contains("compare-card")) source = "comparison";
    else if (el.classList.contains("para")) source = "paragraph";
    else if (el.tagName === "LI") source = "list item";
    else if (el.classList.contains("section-title")) source = "section";
    // Prefer the raw LaTeX over rendered text; strip KaTeX's hidden MathML
    // duplicate so the snippet isn't doubled. For a graph, the rendered text
    // is a handful of axis labels, so send the <title> (the accessible
    // description) and the live parameters instead.
    const _cl = el.cloneNode(true); _cl.querySelectorAll(".katex-mathml").forEach(m => m.remove());
    let captured = el.dataset.latex || _cl.textContent;
    const svg = el.querySelector("svg");
    if (svg) {
      const gk = el.closest("[data-graph-key]")?.dataset.graphKey;
      const title = svg.querySelector("title")?.textContent?.trim();
      const parts = [];
      if (title) parts.push(`Graph: ${title}`);
      if (gk) {
        parts.push(`key: ${gk}`);
        try { parts.push(`params: ${JSON.stringify(graphParams[gk])}`); } catch (_) {}
      }
      if (parts.length) { source = "graph"; captured = parts.join(" | "); }
    }
    addSnippet(captured, source);
    setTimeout(() => document.querySelector(".chat-input")?.focus(), 0);
    el.classList.remove("ctx-flash");
    void el.offsetWidth;
    el.classList.add("ctx-flash");
    setTimeout(() => el.classList.remove("ctx-flash"), 600);
  }, [chatOpen, addSnippet, graphParams]);

  // Drag-select text anywhere in the lesson → add the selection to context.
  const handleContentMouseUp = useCallback((e) => {
    if (!chatOpen) return;
    if (e.target.closest(".chat-panel, .chat-toggle")) return;
    if (mouseDownPos.current) {
      const dx = Math.abs(e.clientX - mouseDownPos.current.x);
      const dy = Math.abs(e.clientY - mouseDownPos.current.y);
      if (dx <= 5 && dy <= 5) return; // it was a click, handled above
    }
    setTimeout(() => {
      const sel = window.getSelection();
      const text = sel ? sel.toString().trim() : "";
      if (text.length > 2) {
        addSnippet(text, "selection");
        setTimeout(() => document.querySelector(".chat-input")?.focus(), 0);
        try {
          const range = sel.getRangeAt(0);
          const rect = range.getBoundingClientRect();
          const flash = document.createElement("div");
          flash.className = "ctx-sel-flash";
          flash.textContent = "+ added";
          flash.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top - 24}px;`;
          document.body.appendChild(flash);
          setTimeout(() => flash.remove(), 800);
        } catch (err) {}
        sel.removeAllRanges();
      }
    }, 10);
  }, [chatOpen, addSnippet]);

  // Right-click on a selection → context menu: Reply (add to context),
  // Reply in thread (selection inside a chat message), Reply in this thread
  // (selection inside an open thread panel).
  const handleContextMenu = useCallback((e) => {
    if (!chatOpen) return;
    if (e.target.closest('.chat-input, .chat-input-row, .chat-model-select')) return;
    const sel = window.getSelection();
    const text = sel ? sel.toString().trim() : "";
    if (text.length < 3) return;
    e.preventDefault();
    const chatArea = document.querySelector('.chat-messages');
    const inChatArea = chatArea && chatArea.contains(sel.anchorNode);
    let chatMsgIdx = null;
    let chatBlockIdx = null;
    if (inChatArea) {
      const msgEl = sel.anchorNode?.parentElement?.closest('.chat-msg[data-msg-idx]');
      if (msgEl) {
        chatMsgIdx = parseInt(msgEl.dataset.msgIdx);
        const block = sel.anchorNode?.parentElement?.closest('[data-chat-block]');
        if (block) {
          const bubble = msgEl.querySelector('.chat-msg-rendered');
          if (bubble) {
            const allBlocks = bubble.querySelectorAll('[data-chat-block]');
            chatBlockIdx = Array.from(allBlocks).indexOf(block);
          }
        }
      }
    }
    const threadPanel = e.target.closest('.thread-panel[data-thread-id]');
    const threadId = threadPanel ? threadPanel.getAttribute('data-thread-id') : null;
    setCtxMenu({ x: Math.min(e.clientX, window.innerWidth - 160), y: Math.min(e.clientY, window.innerHeight - 80), text, chatMsgIdx, chatBlockIdx, threadId });
  }, [chatOpen]);

  useEffect(() => {
    if (!ctxMenu) return;
    const close = (e) => { if (!e.target.closest('.ctx-menu')) setCtxMenu(null); };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [ctxMenu]);

  const handleCtxReply = useCallback(() => {
    if (!ctxMenu) return;
    addSnippet(ctxMenu.text, "selection");
    setCtxMenu(null);
    window.getSelection()?.removeAllRanges();
    setTimeout(() => document.querySelector(".chat-input")?.focus(), 0);
  }, [ctxMenu, addSnippet]);

  const handleCtxOpenThread = useCallback(() => {
    if (!ctxMenu || ctxMenu.chatMsgIdx == null) return;
    setThreadTrigger({ text: ctxMenu.text, msgIdx: ctxMenu.chatMsgIdx, blockIdx: ctxMenu.chatBlockIdx, ts: Date.now() });
    setCtxMenu(null);
    window.getSelection()?.removeAllRanges();
  }, [ctxMenu]);

  // Lesson selection (no chat message behind it): open a thread anchored to
  // the lesson. @core records a quoted anchor card in the transcript and hangs
  // the thread off it, so the whole thread machinery works unchanged.
  const handleCtxAskInThread = useCallback(() => {
    if (!ctxMenu) return;
    setThreadTrigger({ text: ctxMenu.text, msgIdx: null, source: "lesson selection", ts: Date.now() });
    setCtxMenu(null);
    window.getSelection()?.removeAllRanges();
  }, [ctxMenu]);

  const handleCtxReplyInThread = useCallback(() => {
    if (!ctxMenu || !ctxMenu.threadId) return;
    setThreadCtxTrigger({ threadId: ctxMenu.threadId, text: ctxMenu.text, source: "thread selection", ts: Date.now() });
    setCtxMenu(null);
    window.getSelection()?.removeAllRanges();
  }, [ctxMenu]);

  // KaTeX loads from CDN on mount. Gate the whole app until it is ready so
  // math blocks do not flash unrendered source.
  if (!katexReady) {
    return (
      <>
        <style>{STYLES}</style>
        <div
          className="theme-light"
          style={{
            minHeight: "100vh",
            background: "var(--canvas)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <p style={{ color: "var(--ink-4)", fontFamily: "var(--font-mono)", fontSize: 13 }}>
            Loading KaTeX...
          </p>
        </div>
      </>
    );
  }

  // LessonShell owns the frame: top bar, contents rail with scroll-spy, the
  // article scroll container, and where the tutor panel is docked. It injects
  // @core STYLES itself, so there is no <style> tag here. Root-level DOM
  // handlers are forwarded onto the shell root, which is what the
  // context-capture gestures need (they must also cover chat replies and
  // thread panels, not just lesson content).
  return (
    <LessonShell
      courseCode="/* TODO: course display code, e.g. 'MATH 101' */"
      courseName="/* TODO: full course name, e.g. 'Introduction to Real Analysis' */"
      lessonTitle="/* TODO: lesson title */"
      topics={TOPICS}
      activeIdx={activeIdx}
      onSelectTopic={setActiveIdx}
      chatOpen={chatOpen}
      setChatOpen={setChatOpen}
      // Optional: rendered under the rail divider.
      // refs={[{ label: "Formula sheet (PDF)", href: "..." }]}
      onMouseDown={handleContentMouseDown}
      onClick={handleContentClick}
      onMouseUp={handleContentMouseUp}
      onContextMenu={handleContextMenu}
      /* Chatbot mount. All chat UI, session management, thread panel,
         system-prompt construction, and <<EDIT_GRAPH>> dispatch live inside
         this component (imported from @core). It gates itself out of PROD
         builds internally (static hosts have no proxy); no per-lesson gating
         needed. Passed to the shell rather than rendered inline so the shell
         can place it in the side dock, the bottom dock, a floating window, or
         a real browser window. */
      tutor={
        <Chatbot
          // Identity + lesson-scoping
          courseCode="/* TODO: course display code, e.g. 'MATH 101' */"
          courseName="/* TODO: full course name, e.g. 'Introduction to Real Analysis' */"
          // institution: OPTIONAL string, e.g. institution="University X".
          // Named in the tutor system prompt ("...at <institution>"); omit
          // the prop entirely for no institution mention.
          lessonContext={LESSON_CONTEXT}
          topicContext={TOPIC_CONTEXT}
          lessonFile="src/{/* TODO: slug */}.jsx"
          // Graph editing (REQUIRED for <<EDIT_GRAPH>> validation)
          graphSchema={GRAPH_SCHEMA}
          graphRenderId={graphRenderId}
          // Session + UI state
          topicId={active.id}
          topicTitle={active.title}
          contextSnippets={contextSnippets}
          onClearSnippet={handleClearSnippet}
          onClearAllSnippets={handleClearAllSnippets}
          open={chatOpen}
          setOpen={setChatOpen}
          onEditGraph={handleEditGraph}
          graphParams={graphParams}
          addSnippet={addSnippet}
          threadTrigger={threadTrigger}
          threadCtxTrigger={threadCtxTrigger}
        />
      }
      /* Selection context menu (styles ship in @core chat.css).
         - "Reply" always: adds the selection to context. If a thread composer
           currently has focus it lands in that thread instead (routeLessonContext).
         - "Reply in thread": selections inside a chat message.
         - "Ask in a thread": selections in the lesson body — opens a
           lesson-anchored thread.
         - "Reply in this thread": selections inside an open thread panel. */
      overlays={
        ctxMenu && (
          <div className="ctx-menu" style={{ left: ctxMenu.x, top: ctxMenu.y }}>
            <button className="ctx-menu-item" onClick={handleCtxReply}>Reply</button>
            {ctxMenu.chatMsgIdx != null && (
              <button className="ctx-menu-item" onClick={handleCtxOpenThread}>Reply in thread</button>
            )}
            {ctxMenu.chatMsgIdx == null && !ctxMenu.threadId && (
              <button className="ctx-menu-item" onClick={handleCtxAskInThread}>Ask in a thread</button>
            )}
            {ctxMenu.threadId && (
              <button className="ctx-menu-item" onClick={handleCtxReplyInThread}>Reply in this thread</button>
            )}
          </div>
        )
      }
    >
      {active.content(graphParams, graphRenderId)}
    </LessonShell>
  );
}

export default LessonApp;
```

## Exposition exemplars (positive models for topic bodies)

Two complete topic bodies that follow `references/teaching-communication.md`: substantive opening, prose carrying the causal links, every symbol defined at first use, one `KeyConcept` for the one critical conclusion (never a restatement), an in-domain example and a contrast, no analogy, the arc's exit check landed as a prediction-before-reveal. Imitate the shape, not the subject. Both parse as-is (imports from `@core` assumed).

**Concept arc** — `kind: concept`, question "Why does current increase when impedance decreases?", moves establish → formalize → infer → distinguish, exit check "If |Z| is halved at fixed voltage, what happens to |I|?":

```jsx
const EXEMPLAR_CONCEPT_TOPIC = {
  id: "topic-2",
  tab: "Impedance",
  title: "Impedance sets the current",
  subtitle: "Core relation",
  blurb: "For a fixed source voltage, the impedance magnitude sets how much current flows and its angle sets when.",
  content: (gp, renderId) => (
    <>
      <Section title="Current at fixed voltage">
        <P>
          A sinusoidal source of fixed amplitude drives a series R–L–C branch. In AC steady state the whole
          branch is described by one complex number, its impedance <M>{"Z"}</M>, and the phasor current
          follows from the phasor voltage by Ohm's law in phasor form:
        </P>
        <Eq>{"\\tilde{I} = \\frac{\\tilde{V}}{Z}, \\qquad Z = R + j\\left(\\omega L - \\frac{1}{\\omega C}\\right)"}</Eq>
        <P>
          Here <M>{"\\tilde{V}"}</M> and <M>{"\\tilde{I}"}</M> are the voltage and current phasors,
          <M>{"\\omega"}</M> is the source's angular frequency in rad/s, and <M>{"R"}</M>, <M>{"L"}</M>,
          <M>{"C"}</M> are the element values. Because the source amplitude <M>{"|\\tilde{V}|"}</M> is
          fixed, the current magnitude is <M>{"|\\tilde{I}| = |\\tilde{V}|/|Z|"}</M>: reducing
          <M>{"|Z|"}</M> increases <M>{"|\\tilde{I}|"}</M> in exact inverse proportion — halve
          <M>{"|Z|"}</M> and the current doubles.
        </P>
        <KeyConcept label="MAGNITUDE AND PHASE ARE SET SEPARATELY">
          <M>{"|Z|"}</M> fixes how large the current is; the angle of <M>{"Z"}</M> fixes how far the
          current lags or leads the voltage, since <M>{"\\angle\\tilde{I} = \\angle\\tilde{V} - \\angle Z"}</M>.
          A change that leaves <M>{"\\angle Z"}</M> alone leaves the phase shift alone, however much
          <M>{"|Z|"}</M> moves.
        </KeyConcept>
        <P>
          Example: with <M>{"|\\tilde{V}| = 10\\ \\text{V}"}</M> and <M>{"|Z| = 5\\ \\Omega"}</M> the current is
          2 A; at <M>{"|Z| = 2.5\\ \\Omega"}</M> it is 4 A. Contrast: adding series resistance raises
          <M>{"|Z|"}</M> and lowers the current, but so does moving the source frequency away from resonance
          with <M>{"R"}</M> untouched — both act through <M>{"|Z|"}</M>, which is the only thing the current
          magnitude responds to.
        </P>
      </Section>
      <Section title="Check yourself">
        <P>
          The source amplitude is fixed and <M>{"|Z|"}</M> is halved without changing <M>{"\\angle Z"}</M>.
          Predict the new current magnitude and phase before opening the answer.
        </P>
        <CollapsibleBlock label="Answer">
          <P>
            The magnitude doubles, since <M>{"|\\tilde{I}| = |\\tilde{V}|/|Z|"}</M>; the phase shift is
            unchanged, since only <M>{"\\angle Z"}</M> enters it.
          </P>
        </CollapsibleBlock>
      </Section>
    </>
  ),
};
```

**Procedure arc** — `kind: procedure`, question "How do I find the Thevenin resistance of a network?", moves purpose → complete worked model → faded instance → independent application, exit check = the independent item:

```jsx
const EXEMPLAR_PROCEDURE_TOPIC = {
  id: "topic-4",
  tab: "Thevenin",
  title: "Finding the Thevenin resistance",
  subtitle: "Procedure",
  blurb: "Zero the independent sources, look in from the terminals, reduce.",
  content: (gp, renderId) => (
    <>
      <Section title="What the procedure is for">
        <P>
          Any linear two-terminal network can be replaced, as seen from its terminals, by a voltage source
          <M>{"V_{th}"}</M> in series with a resistance <M>{"R_{th}"}</M>; the replacement is what lets you
          answer "what does this network deliver to a load?" without re-solving the network for every load.
          <M>{"R_{th}"}</M> is the resistance seen looking into the terminals with every independent source
          set to zero — a voltage source becomes a short circuit and a current source an open circuit,
          because a zeroed source contributes no excitation and only its internal resistance remains.
        </P>
        <ol className="info-list">
          <li>Remove the load from the terminals.</li>
          <li>Set every independent source to zero (voltage source → short, current source → open); leave dependent sources in place.</li>
          <li>Reduce what remains by series / parallel combination as seen from the terminals.</li>
        </ol>
      </Section>
      <Section title="Worked example">
        <P>
          A 12 V source in series with 4 Ω, then 12 Ω across the terminals. Nothing sits beyond the terminals,
          so there is no load to remove. Zero the source: the 12 V becomes a wire, and the 4 Ω and the 12 Ω now
          both connect the top terminal to the bottom one — they are in parallel, not in series as the original
          drawing suggests.
        </P>
        <Eq>{"R_{th} = 4 \\parallel 12 = \\frac{4 \\cdot 12}{4 + 12} = 3\\ \\Omega"}</Eq>
        <P>
          The common error is to add them (16 Ω): that treats the source as still in place and the two resistors
          as carrying one common current, which they do not once the source is shorted.
        </P>
      </Section>
      <Section title="Now with one step left to you">
        <P>
          A 6 V source in series with 2 Ω, then 3 Ω across the terminals, then a 6 Ω load. Remove the load;
          short the source; the 2 Ω and 3 Ω are then in parallel across the terminals. Compute
          <M>{"R_{th}"}</M> before opening the answer.
        </P>
        <CollapsibleBlock label="Answer">
          <P><M>{"R_{th} = 2 \\parallel 3 = 6/5 = 1.2\\ \\Omega"}</M>.</P>
        </CollapsibleBlock>
      </Section>
      <Section title="On your own">
        <P>
          A 5 mA current source in parallel with 2 kΩ, then 3 kΩ in series to the output terminal (the other
          terminal is the bottom rail). Find <M>{"R_{th}"}</M> — decide first what zeroing a current source
          does to the branch it sits in.
        </P>
        <CollapsibleBlock label="Answer">
          <P>
            The current source becomes an open, leaving 2 kΩ in series with 3 kΩ from the terminals:
            <M>{"R_{th} = 5\\ \\text{k}\\Omega"}</M>.
          </P>
        </CollapsibleBlock>
      </Section>
    </>
  ),
};
```

What these model, move by move: the opening sentence is the first content-bearing claim (no "In this section…"); the connecting sentence after each equation states the inference the equation alone does not; the `KeyConcept` carries the one conclusion the prose has not already stated; the example instantiates and the contrast discriminates; the procedure is a numbered `<ol className="info-list">` (bullets are for parallel items only); the check is a prediction the learner commits to before the collapsed answer. `<ol className="info-list">` renders numbered steps via `@core` CSS while sharing the `.info-list li` context-capture selector, so no handler changes are needed.

## Notes for assembly agents

- **Do not inline `LessonShell`, `Chatbot`, `STYLES`, or UI primitives.** Everything in `_lesson-core/index.js` comes from `@core`. Local copies drift and fail review.
- **The shell owns the chrome.** Do not hand-roll a header, a tab bar, a footer or a content wrapper — `LessonShell` renders the top bar, the contents rail (with per-topic section outline and scroll-spy), the article column, and the tutor dock. The lesson supplies `TOPICS` and the active topic's body as children. `LessonShell` also injects `STYLES`, so a lesson needs no `<style>` tag outside the KaTeX loading gate.
- **The rail outline comes from `<Section title>` headings.** Anything rendered outside a `Section` gets no outline entry and no scroll-spy target.
- **Equations are first-class.** `<Eq>` renders a numbered card with an "Explain" pill that hands the LaTeX to the tutor as context. Numbering is a CSS counter scoped to the article, so equation numbers read `(<topic>.<n>)` automatically — never hand-number them. Add `label="ON FORMULA SHEET"`-style captions with `<Eq label="...">`; pass `explain={false}` to drop the pill on a specific equation.
- **The palette is light-only.** The Lumen design specifies one palette; there is no theme toggle and no dark tokens. `let G = THEMES_G.light;` stays as a module-scope binding because every graph component closes over it.
- **Wrap every graph call site in `<LiveGraph graphKey renderId>`.** Without it the `<<EDIT_GRAPH>>` visual-verification loop screenshots a selector that matches nothing, and Ctrl+Click on a graph captures stray axis labels instead of the graph's key and parameters.
- **Keep the three context-capture selector lists in sync.** `handleContentClick` here, the capture-phase gate in `@core/chat/Chatbot.jsx`, and the hover rules in `@core/chat/chat.css.js` must name the same classes. A class in the CSS but not the handler shows a pointer cursor and does nothing.
- **Keep `routeLessonContext` at the top of `addSnippet`.** It is what lets a student Ctrl+Click lesson content into a focused side-thread; drop it and every capture silently lands in the main composer instead.
- **Keep `let G = THEMES_G.light;` at module scope.** Graph components close over it by name.
- **`GRAPH_SCHEMA` keys must equal `DEFAULT_GRAPH_PARAMS` keys.** Phase 4 verifies. If a component clamps with `Math.min(p.nMax, 6)`, the schema `max` must also be 6.
- **`TOPIC_CONTEXT` keys must equal `TOPICS[i].id` values.** T14 enforces.
- **KaTeX escaping**: use `\\lt` / `\\gt` inside KaTeX strings, never bare `<` / `>`. T2 rejects.
- **No hardcoded hex colors** outside what already exists here. Use CSS variables from `_lesson-core/chat/chat.css.js`.
- **No emojis** anywhere.
- **Prose follows `references/teaching-communication.md`**: authored against the topic's `teaching_arc`, opening substantive, causal links in prose (bullet lint: no "because / therefore / however" inside `<ul>` items; procedures as `<ol className="info-list">`), symbols defined at first use, `KeyConcept` once per critical conclusion, in-domain examples and contrasts over analogies, no historical asides or trivia, the exit check landed as an inline check. The exemplars above are the model; the Phase 4 reviewer's discourse kinds are the enforcement.
- **Chatbot props**: the full prop list is the mount in the skeleton above. `institution` is the only optional identity prop — a plain string surfaced in the tutor system prompt; include it only when the lesson should name an institution, omit it otherwise. The chat panel and its toggle are PROD-gated inside `Chatbot` itself (dev-only); do not add per-lesson gating.
- **Practice problems**: use `PracticeProblem` from `@core` — never a hand-rolled card. Statement visible, solution collapsed (`defaultOpen` false), provenance badge correct (`"official"` only for from-source solutions), `aiSources` populated for derived ones. See the canonical-pattern section in the skeleton.
- **Desmos embeds** (`<DesmosGraph>`): pass a stable `state` prop — if the parent rebuilds the state object on every render, the calculator remounts on every render too. Wrap in `useMemo` if constructing from component state. The component strips `isPlaying:true` from any supplied state; animation is always student-initiated via Desmos's native per-slider Play button inside the expression panel (there is no custom overlay play button — the embed is student-drag-resizable instead). Confirm `VITE_DESMOS_KEY` is set in the workspace-root `.env.local` before relying on a Desmos embed (the template's `vite.config.js` points `envDir` at the workspace root, so the single root file serves every lesson). **Authoring the `state` object is the error-prone part** — `sliderBounds.{min,max,step}`, `lineWidth`, `lineOpacity`, `pointSize`, `pointOpacity`, `parametricDomain`/`polarDomain` bounds must be STRINGS (`"0.1"`, not `0.1`) or `setState` crashes silently with no on-screen error. Read `references/desmos-schema.md` before writing your first embed.
- **See also**: `references/phase-3-execution.md`, `references/graph-schema-guide.md`, `references/phase-4-review.md`.

