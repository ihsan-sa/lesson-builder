# Lesson Skeleton Template

New-mode Phase 3 starting point. Main Claude copies this skeleton into `src/<slug>.jsx` and fills `// TODO:` markers with content from specialists. Update mode does NOT use this file.

## What's per-lesson vs from @core

- **Per-lesson**: `LESSON_CONTEXT`, `TOPIC_CONTEXT`, `DEFAULT_GRAPH_PARAMS`, `GRAPH_SCHEMA`, graph components, `TOPICS`, `LessonApp`, header.
- **From @core**: `Chatbot`, `STYLES`, UI primitives (`Eq`, `M`, `P`, `Section`, `KeyConcept`, `CollapsibleBlock`, `RefImg`), constants (`THEMES_G`, `MODELS`, `EFFORT_LEVELS`), `useKatex`.
- **External**: `server/proxy.js` is a 1-line shim, added by the file-scaffolding step.

## GRAPH_SCHEMA requirement

Mandatory. Client-side validation map for `<<EDIT_GRAPH>>`; rejects invalid parameter edits before they reach graph components. Keys must match `DEFAULT_GRAPH_PARAMS` exactly. See `references/graph-schema-guide.md`.

## Skeleton

```jsx
import { useState, useEffect, useRef, useCallback } from "react";
import {
  Chatbot,
  Eq, M, P, Section, KeyConcept, CollapsibleBlock, RefImg,
  THEMES_G, useKatex, STYLES,
} from "@core";
// Optional: add `DesmosGraph` to the import block only when the lesson embeds
// a live Desmos calculator. Requires VITE_DESMOS_KEY in .env.local (the hook
// fails loud and renders a red fallback if the key is missing).
// import { DesmosGraph } from "@core/ui/DesmosGraph";

// ───────────────────────────────────────────────────────────────
// Lesson Context (passed to Chatbot as system-prompt scaffolding)
// ───────────────────────────────────────────────────────────────

const LESSON_CONTEXT = `/* TODO: one paragraph describing the course, unit, lecture range, and
learning goals. Cover:
  - Course code and full course name (e.g. "<COURSE CODE> (<Full Course Name>)")
  - Institution and term (if relevant)
  - Which lectures / sections / units this lesson covers
  - What the student should walk away understanding
  - The solve-protocol directive: when the student brings a problem (homework,
    past-exam question, practice problem, a screenshot of a question they're
    stuck on, anything), the chatbot follows this protocol:

      1. ASK FIRST, one short sentence: "Do you want me to walk through a full
         worked solution, or guide you step by step with hints so you solve it
         yourself?" Then wait.
      2. INTERNALLY SOLVE THE PROBLEM REGARDLESS of which option the student
         will pick — derive the final answer, cross-reference intermediate
         steps and the numerical answer against the lesson's equations,
         constants, and any cited sources (two-source cross-reference for
         non-trivial results). Knowing the right answer is what makes guided
         hints precise instead of vague; the student's choice only affects
         what the chatbot shares, not what it works out.
      3. IF the student picks full solution: present each step clearly, with
         reasoning, and give the final numerical answer with units and sig
         figs. Flag any ambiguity in the problem statement rather than guess.
      4. IF the student picks guided help: give a progressive hint — typically
         the first conceptual step or the governing equation — and ask what
         they get. On each student reply, compare against the internal solution
         and catch the specific point where their reasoning diverges. Never
         refuse to reveal the answer if the student asks mid-session; re-ask
         the full-vs-guided question and honor their updated preference.

    Academic honesty is the student's responsibility, not the chatbot's. Do
    NOT lecture about honesty, do NOT refuse to solve, do NOT steer toward
    "doing it yourself" when the student asked for the full solution. The
    chatbot's job is to be maximally useful for understanding; how the student
    uses the help is up to them and their institution's policy.
*/`;

// ───────────────────────────────────────────────────────────────
// Topic Context (per-tab system-prompt augmentation)
// ───────────────────────────────────────────────────────────────
//
// One entry per TOPICS id. Be detailed: include equations, key variables,
// given values, and the conceptual framing the student needs. The chatbot
// uses the entry matching the currently-active tab as extra system context.

const TOPIC_CONTEXT = {
  // TODO: one entry per lesson topic. Example shape:
  "topic-1": `Topic: [Name]. Covers: [equations], [key variables], [given values]. [What the student needs to understand].`,
  "topic-2": `Topic: [Name]. Covers: ...`,
  // The graph-preview entry is MANDATORY. Do not remove it.
  "graph-preview": `Graph Preview tab. Shows all lesson graphs for visual inspection. The user can screenshot this tab and send it to the chatbot for review and corrections.`,
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
// Graph components reference `G` at module scope; LessonApp reassigns it
// per render based on the current theme state. Keep the `let` declaration.

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
//   once in a content tab and once in the graph-preview tab).
// - Use `G` (module-level theme binding) for colors.
// - Spread DEFAULT_GRAPH_PARAMS into the merged params so partial updates
//   from <<EDIT_GRAPH>> keep the unspecified defaults:
//     const p = { ...DEFAULT_GRAPH_PARAMS.myGraph, ...params };
//
// See references/phase-3-execution.md for SVG construction tactics
// (viewBox sizing, arrow markers, path generation, label placement).

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
//         <text x={ox + plotW / 2} y={oy + 28} fill={G.txt} fontSize="10" fontFamily="'IBM Plex Mono'" textAnchor="middle">x</text>
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
// full worked solution. Render them with this pattern so every lesson
// behaves the same: statement visible by default, solution collapsed so
// students attempt first and then check.
//
// function PracticeProblem({ source, difficulty, statement, approachHint, solution }) {
//   return (
//     <div className="eq-block" style={{ padding: "14px", marginTop: "12px" }}>
//       <div style={{ fontFamily: "'IBM Plex Mono'", fontSize: 11, opacity: 0.7 }}>
//         {source}{difficulty ? ` · ${difficulty}` : ""}
//       </div>
//       <P>{statement}</P>
//       {approachHint && (
//         <CollapsibleBlock label="Approach hint">
//           <P>{approachHint}</P>
//         </CollapsibleBlock>
//       )}
//       <CollapsibleBlock label="Solution">
//         {solution /* JSX: equations, step-by-step reasoning, final numerical answer */}
//       </CollapsibleBlock>
//     </div>
//   );
// }
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
// two-source cross-reference bar as other equations before landing here.

// ───────────────────────────────────────────────────────────────
// Topics (tab bar + content functions)
// ───────────────────────────────────────────────────────────────
//
// Each entry is `{ id, tab, title, subtitle, content }`. `content` is a
// function `(gp) => JSX` so graph components can receive live params.
// Topic ids must match TOPIC_CONTEXT keys exactly (test_lesson.cjs checks
// this). The final tab MUST be `graph-preview`.

const TOPICS = [
  // TODO: one entry per topic. Example:
  // {
  //   id: "topic-1",
  //   tab: "Topic 1",
  //   title: "Full Title of Topic 1",
  //   subtitle: "Short mono-spaced descriptor",
  //   content: (gp) => (
  //     <Section title="Section Heading">
  //       <P>
  //         Body text with inline math <M>{"E = hf"}</M> and a block
  //         equation below.
  //       </P>
  //       <Eq>{"E_n = \\frac{n^2 \\pi^2 \\hbar^2}{2 m_e a^2}"}</Eq>
  //       <KeyConcept label="KEY IDEA">
  //         Energy is quantized. Remember: use \\lt and \\gt inside KaTeX,
  //         never bare &lt; or &gt;.
  //       </KeyConcept>
  //       <MyGraph params={gp.myGraph} />
  //     </Section>
  //   ),
  // },

  // Graph Preview tab is MANDATORY. Renders every graph for screenshot-
  // based review. Keep this entry last.
  {
    id: "graph-preview",
    tab: "Graph Preview",
    title: "Graph Preview",
    subtitle: "All lesson graphs in one place",
    content: (gp) => (
      <Section title="All Graphs">
        <P>
          Every graph in this lesson rendered with the current parameters.
          Use this tab to screenshot the full set and send it to the chat
          for a visual review.
        </P>
        {/* TODO: render each graph component once, passing the matching
            gp.<key> slice. Use mid="-preview" so marker ids do not clash
            with the same graph rendered inside a content tab. */}
      </Section>
    ),
  },
];

// ───────────────────────────────────────────────────────────────
// LessonApp (main component)
// ───────────────────────────────────────────────────────────────

function LessonApp() {
  const katexReady = useKatex();
  const [activeIdx, setActiveIdx] = useState(0);
  const [contextSnippets, setContextSnippets] = useState([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [theme, setTheme] = useState("light");
  const [graphParams, setGraphParams] = useState(DEFAULT_GRAPH_PARAMS);
  const [graphRenderId, setGraphRenderId] = useState(0);
  const [threadTrigger, setThreadTrigger] = useState(null);
  const [threadCtxTrigger, setThreadCtxTrigger] = useState(null);

  // Reassign module-level G so graph components pick up the active theme.
  G = THEMES_G[theme];

  // Ctrl-/ toggles the chat panel. Copy the full keyboard handler from an
  // existing lesson if you need thread-selection support (Ctrl-Shift-F).
  useEffect(() => {
    const handleKey = (e) => {
      if (e.ctrlKey && e.key === "/") {
        e.preventDefault();
        setChatOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  // Chatbot <<EDIT_GRAPH>> callback: shallow-merge per-key param edits.
  // Also bump graphRenderId so the graph-preview tab re-renders SVGs that
  // would otherwise stay mounted with stale props.
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

  const addSnippet = useCallback((text, source) => {
    const clean = text.replace(/\s+/g, " ").trim();
    if (!clean || clean.length < 3) return;
    setContextSnippets((prev) =>
      prev.some((s) => s.text === clean) ? prev : [...prev, { text: clean, source }],
    );
  }, []);

  const active = TOPICS[activeIdx];

  // KaTeX loads from CDN on mount. Gate the whole app until it is ready so
  // math blocks do not flash unrendered source.
  if (!katexReady) {
    return (
      <>
        <style>{STYLES}</style>
        <div
          className={`theme-${theme}`}
          style={{
            minHeight: "100vh",
            background: "var(--bg-main)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <p style={{ color: "var(--text-dim)", fontFamily: "monospace", fontSize: 14 }}>
            Loading KaTeX...
          </p>
        </div>
      </>
    );
  }

  return (
    <div
      className={`theme-${theme} ${chatOpen ? "ctx-active" : ""}`}
      style={{
        minHeight: "100vh",
        background: "var(--bg-main)",
        color: "var(--text-primary)",
        fontFamily: "'IBM Plex Sans', 'Segoe UI', sans-serif",
        display: "flex",
        flexDirection: "column",
        position: "relative",
      }}
    >
      {/* Chat + UI CSS injected from @core. No hardcoded hex colors here;
          every color resolves through CSS custom properties defined in
          _lesson-core/chat/chat.css.js. */}
      <style>{STYLES}</style>

      {/* Header: title, subtitle, theme toggle */}
      <div className="header">
        <div>
          <h1>{/* TODO: lesson title */}</h1>
          <p>{/* TODO: course tagline, e.g. "<COURSE CODE> — <Full Course Name>" */}</p>
        </div>
        <button
          className="theme-toggle-btn"
          onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
        >
          {theme === "dark" ? "Light" : "Dark"}
        </button>
      </div>

      {/* Production banner (chatbot disabled on static hosts) */}
      {import.meta.env.PROD && (
        <div
          style={{
            background: "var(--bg-card)",
            color: "var(--text-dim)",
            textAlign: "center",
            padding: "6px 24px",
            fontSize: 12,
            fontFamily: "'IBM Plex Mono', monospace",
            borderBottom: "1px solid var(--border)",
          }}
        >
          The AI chatbot is only available when running locally. See the
          repository README for setup instructions.
        </div>
      )}

      {/* Tab bar */}
      <div className="tab-bar">
        {TOPICS.map((t, i) => (
          <button
            key={t.id}
            className={`tab-btn ${i === activeIdx ? "active" : ""}`}
            onClick={() => setActiveIdx(i)}
          >
            {t.tab}
          </button>
        ))}
      </div>

      {/* Content area: renders the active topic's content(gp) function */}
      <div className="content-area">
        <div style={{ marginBottom: 8, padding: "16px 24px 0" }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "var(--text-primary)" }}>
            {active.title}
          </h2>
          <p
            style={{
              margin: "2px 0 0",
              fontSize: 13,
              color: "var(--text-dim)",
              fontFamily: "'IBM Plex Mono', monospace",
            }}
          >
            {active.subtitle}
          </p>
        </div>
        {active.content(graphParams)}
      </div>

      {/* Chatbot mount. All chat UI, session management, thread panel,
          system-prompt construction, and <<EDIT_GRAPH>> dispatch live
          inside this component (imported from @core). */}
      <Chatbot
        // Identity + lesson-scoping
        courseCode="/* TODO: course display code, e.g. 'MATH 101' */"
        courseName="/* TODO: full course name, e.g. 'Introduction to Real Analysis' */"
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

      {/* Footer */}
      <div
        style={{
          textAlign: "center",
          padding: "16px 24px",
          marginTop: 24,
          borderTop: "1px solid var(--border)",
          fontSize: 12,
          color: "var(--text-dim)",
          fontFamily: "'IBM Plex Mono', monospace",
        }}
      >
        &copy; {/* TODO: year + copyright holder */}
      </div>
    </div>
  );
}

export default LessonApp;
```

## Notes for assembly agents

- **Do not inline `Chatbot`, `STYLES`, or UI primitives.** Everything in `_lesson-core/index.js` comes from `@core`. Local copies drift and fail review.
- **Keep `let G = THEMES_G.light;` at module scope.** Graph components close over it; `LessonApp` reassigns per render. `const` breaks the theme toggle.
- **`GRAPH_SCHEMA` keys must equal `DEFAULT_GRAPH_PARAMS` keys.** Phase 4 verifies. If a component clamps with `Math.min(p.nMax, 6)`, the schema `max` must also be 6.
- **`TOPIC_CONTEXT` keys must equal `TOPICS[i].id` values.** T14 enforces.
- **The `graph-preview` tab is mandatory.** Renders every graph for screenshot review.
- **KaTeX escaping**: use `\\lt` / `\\gt` inside KaTeX strings, never bare `<` / `>`. T2 rejects.
- **No hardcoded hex colors** outside what already exists here. Use CSS variables from `_lesson-core/chat/chat.css.js`.
- **No emojis** anywhere.
- **Desmos embeds** (`<DesmosGraph>`): pass a stable `state` prop — if the parent rebuilds the state object on every render, the calculator remounts on every render too. Wrap in `useMemo` if constructing from component state. The component strips `isPlaying:true` from any supplied state; animation is always student-initiated, either via Desmos's native per-slider Play button inside the expression panel or via the overlay button `DesmosGraph` renders in its top-right corner. Confirm `VITE_DESMOS_KEY` is set in the lesson's `.env.local` before relying on a Desmos embed. **Authoring the `state` object is the error-prone part** — `sliderBounds.{min,max,step}`, `lineWidth`, `lineOpacity`, `pointSize`, `pointOpacity`, `parametricDomain`/`polarDomain` bounds must be STRINGS (`"0.1"`, not `0.1`) or `setState` crashes silently with no on-screen error. Read `references/desmos-schema.md` before writing your first embed.
- **See also**: `references/phase-3-execution.md`, `references/graph-schema-guide.md`, `references/phase-4-review.md`.
