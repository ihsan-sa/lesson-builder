# Lesson Builder Checklists

Contents: KaTeX safety · Template compliance · Core structure · Theming · Graphs (+ scale design) · Desmos embeds · Pedagogy · Chat reinforcement awareness · Ctrl+Click gate · Chatbot props · Automated checks T1-T3 · 17-test suite summary · Research quality gate · Practice problems · Physics consistency + spot-check · Content concision · Project CLAUDE.md · Update-mode pre-flight · Update-mode splice · Post-splice sanity.

## Purpose

Tactical-wins reference. Phase 3 and Phase 4 consume pointers into this doc; agents receive relevant sections by pointer, not full copy. Sections marked *(update mode)* apply only there.

---

## KaTeX safety rules

Most common Babel parse failures. Apply during generation, not after.

**Core rules**:

- Inside any KaTeX string expression (`{"..."}` passed to `<Eq>` or `<M>`), use `\\lt` and `\\gt` instead of literal `<` and `>`. The JSX parser treats a bare `<` as a tag open, not a math operator.
- Any JSX text node containing `<` or `>` must be wrapped in a `{"..."}` string expression. This applies to `<h2>`, `<h3>`, `<h4>`, `<P>`, `<li>`, and every other text-bearing element.
- Use double backslash `\\` in KaTeX escapes because the JavaScript string eats a single backslash before KaTeX ever sees it. `\frac` in the rendered output requires `\\frac` in the source string.
- KaTeX safety in refine-mode splices: when an agent replaces a component body, re-check that the spliced content did not introduce a bare `<` (the drift detector catches this via the T2 test in Phase 4).

### Mandatory escaping rules table

| Pattern | Problem | Fix |
|---------|---------|-----|
| `<` inside `{"..."}` KaTeX string | JSX parser sees it as tag open | Use `\\lt` |
| `>` inside `{"..."}` KaTeX string | JSX parser sees it as tag close | Use `\\gt` |
| `<<` or `>>` in JSX text | Parsed as nested tags | Wrap in `{"..."}` |
| `<` or `>` in `<h4>`, `<P>` text | Same issue | Wrap in `{"..."}` or rephrase |
| Single `\` in KaTeX | Consumed by JS string | Use `\\` (double backslash) |

### Quick self-check grep (run after any code generation touching KaTeX)

```bash
grep -n '{"[^"]*<[^"]*"}' FILE.jsx \
  | grep -v '\\\\lt' | grep -v '\\\\leq' | grep -v '\\\\left' \
  | grep -v '\\\\ll' | grep -v '\\\\lambda'
```

If anything shows up, fix immediately. The `safe` filter deliberately whitelists the common false positives (`\lt`, `\leq`, `\left`, `\ll`, `\lambda`) that legitimately contain the letter `l` followed by something that looks like `<`.

---

## Template compliance checklist

Every lesson imports chat + UI from `@core`. Lessons inlining old chat code (local copies of `ChatBubble`, `ThreadPanel`, `buildSystemPrompt`) do not comply; update mode halts on these with a migration-first warning. Detection: Grep for `from "@core"` in `src/<slug>.jsx`.

- [ ] Lesson scaffolding was copied from `references/bootstrap/lesson-template/` — the copy includes the lesson-level `CLAUDE.md`, `.gitignore`, `test_lesson.cjs`, `index.html`, `package.json`, and `vite.config.js`. Do not hand-assemble the scaffold or omit the dotfiles.
- [ ] `vite.config.js` sets `envDir` to the workspace root, so the root `.env.local` (`VITE_DESMOS_KEY`) loads for every lesson without per-lesson env files.
- [ ] Imports `Chatbot` and UI primitives (`Eq`, `M`, `P`, `Section`, `KeyConcept`, `CollapsibleBlock`, `RefImg`) from `@core` rather than inlining them.
- [ ] Uses the current `@core` export surface where the content calls for it: `PracticeProblem` (attributed practice problems), `FormulaSheetBox` / `SummaryBox` (exam formula-sheet and course-summary callouts), `DesmosGraph` + `useDesmos` (Desmos embeds), and `DEFAULT_MODEL` / `DEFAULT_EFFORT` (chat model defaults). No local reimplementations of any of these.
- [ ] Chat panel is PROD-gated: `<Chatbot>` UI renders only in dev (`import.meta.env.PROD` gates it out of static builds, which have no proxy). Do not "fix" its absence from a production build, and do not remove the gate.
- [ ] Context-capture + thread wiring is present at the LessonApp level (per the template skeleton): root-div `onMouseDown`/`onClick`/`onMouseUp`/`onContextMenu` handlers, the `ctxMenu` selection menu (Reply / Reply in thread / Reply in this thread), the Ctrl+Shift+F thread-context shortcut, the `?tab=` deep-link effect, and — critically — `threadTrigger`/`threadCtxTrigger` actually SET by the ctx-menu handlers. Trigger state that is passed to `<Chatbot>` but never set anywhere means the thread feature silently does nothing.
- [ ] No inlined chat code in the lesson file. The lesson JSX should not define `ChatBubble`, `ThreadPanel`, `processResponse`, `buildSystemPrompt`, or `chatState` locally.
- [ ] Uses `useKatex()` hook from `@core` for KaTeX loading. No manual CDN `<link>` tag injection.
- [ ] `THEMES_G` imported from `@core/constants` (or defined inline for lessons that predate the constants module).
- [ ] `STYLES` imported from `@core` and injected as `<style>{STYLES}</style>` at the top of `LessonApp`.
- [ ] Theme state (`const [theme, setTheme] = useState("dark")`) and a toggle button are present in the header.
- [ ] Root div has `className={`theme-${theme} ...`}` so theme switching drives CSS variable cascades.
- [ ] `let G = THEMES_G.light;` at module level (mutable, shared with graph components) and `G = THEMES_G[theme];` inside `LessonApp` each render.

---

## Core structure checklist

Run against generated or spliced JSX before handing to Phase 4.

- [ ] `export default` present on the main component (`LessonApp`).
- [ ] `TOPICS` array is non-empty; every topic `id` has a matching key in `TOPIC_CONTEXT`.
- [ ] `TOPIC_CONTEXT` keys are one-to-one with `TOPICS` ids — no orphans, no missing entries.
- [ ] `LESSON_CONTEXT` is non-empty, covers course/unit/objectives, and does NOT weaken or contradict the tutoring policy. The canonical PEDAGOGY POLICY is injected by `@core/chat/buildSystemPrompt.js` — lessons no longer paste it. Legacy lessons that embed the old policy text verbatim are fine (core detects the marker and skips double-injection); a lesson whose context says "just give answers" or equivalent is a pedagogy failure — flag it.
- [ ] Header `<h1>` is updated to match the actual lesson topic (not placeholder text from the template).
- [ ] Every `<Eq>` and `<M>` uses `{"..."}` with double-escaped backslashes.
- [ ] No emojis anywhere in the file. No `localStorage`. No `sessionStorage` (except intentional KC feature state, which is a legacy exception).

---

## Theming checklist

Theme failures are visually obvious; Phase 4 visual-QA catches regressions if skipped here. The CSS itself (selectors, chatbot vars, palettes) lives in `@core` (`chat/chat.css.js`, `constants/themes.js`) — lessons only wire it up; per-lesson checks are:

- [ ] `STYLES` imported from `@core` and injected as `<style>{STYLES}</style>` at the top of `LessonApp`; no per-lesson CSS blocks redefining core selectors.
- [ ] No hardcoded hex values in lesson inline styles — root div, loading screen, and title/subtitle styles use CSS variables (`var(--bg-main)`, `var(--text-primary)`, `var(--text-dim)`, ...).
- [ ] Theme state + toggle button present in the header and wired to `setTheme`; root div `className={`theme-${theme} ...`}` drives the variable cascade.
- [ ] `let G = THEMES_G.light;` at module level (mutable — graph components close over it) and `G = THEMES_G[theme];` inside `LessonApp` each render.
- [ ] Graph components color exclusively through `G` (`G.gold`, `G.ax`, `G.txt`, ...) so both themes render correctly.

---

## Graphs checklist

- [ ] `DEFAULT_GRAPH_PARAMS` is defined at module scope; every graph component accepts a `params` prop with defaults via `const p = { ...DEFAULT_GRAPH_PARAMS.myGraph, ...params };`.
- [ ] `GRAPH_SCHEMA` is defined alongside `DEFAULT_GRAPH_PARAMS` with matching keys one-to-one. Each entry describes the editable fields so the chatbot can offer typed edits. See `references/graph-schema-guide.md` for the derivation procedure and backfill rules for lessons that predate the graph-schema feature.
- [ ] Every SVG is wrapped in `<div className="eq-block">` with `viewBox` set and `width: "100%"` on the SVG so it scales responsively.
- [ ] Graph marker IDs are unique across the entire file (no duplicate `id="ah"` or `id="arrowId"`). Clashing IDs silently break arrow rendering.
- [ ] All graph text uses `fontFamily="'IBM Plex Mono'"`. No system fonts, no sans-serif in SVG labels.
- [ ] Graph equations must match the LaTeX equations in the same section. Discrepancies are caught by the Content Verification sub-agent's numerical spot-check but are much cheaper to prevent here.
- [ ] Graph Preview tab exists as the **last** tab in the `TOPICS` array and renders every graph in the lesson. In update mode this is especially critical: a newly-added graph that is not also added to the graph-preview tab will not appear in visual-QA screenshots and will silently escape review.

### Graph scale design rules

Prevents the "all curves crammed together" failure that dominates visual-QA reviews:

- [ ] **Split scale for mixed-range axes**: Use different pixels-per-unit for different regions. For example, forward bias at 480 px/V but reverse bias at 18 px/V. If the interesting behavior spans four decades, use a split-panel layout (two subplots side by side with different y-axis scales) rather than compressing everything into one panel.
- [ ] **Minimum curve separation**: Any two visually distinct curves (e.g., Ideal at 0V and CVD at 0.7V) must be at least 150px apart at their closest point.
- [ ] **Physical constants matter**: Always include physical constants (saturation current `Is`, threshold voltage `Vth`, etc.) in the equation. Omitting `Is` in a Shockley plot shifts the knee from ~0.6V to ~0V, which produces a curve indistinguishable from ideal.
- [ ] **Practical units on Y**: Use mA not A. Use dB not linear magnitude. Choose units that put the interesting region in the 20-80% range of the axis.
- [ ] **Tick marks required**: Both axes must have labeled tick marks at key values so the student can verify positions by eye.
- [ ] **Never use `Math.min` clamping to hide overflow**: If the curve clips, the scale is wrong. Fix the scale, do not clamp the data. Clamping was the original `DiodeIVCurves` bug that took the legacy review team two iterations to catch.

---

## Desmos embed checklist

Applies to lessons that import `DesmosGraph` from `@core/ui/DesmosGraph` or that the chatbot will drive with `<<DESMOS>>` during the session. **Read `references/desmos-schema.md` in parallel** — this checklist assumes familiarity with the state shape.

**String-vs-number footgun (highest priority):** Desmos `setState` crashes silently (blank canvas, `"parse can only be called with strings, got <n> of type number"` in console, nothing on screen) when certain fields arrive as JS numbers instead of JSON/LaTeX strings. The chat-path validator catches this and returns an `[OBSERVATION]`; lesson-author embeds bypass that, so authors must check themselves.

- [ ] `sliderBounds.min`, `sliderBounds.max`, `sliderBounds.step` are strings like `"0.1"`, not numbers.
- [ ] `lineWidth`, `lineOpacity`, `pointSize`, `pointOpacity` are strings.
- [ ] `parametricDomain.{min,max}`, `polarDomain.{min,max}` are strings.
- [ ] `graph.viewport.{xmin,xmax,ymin,ymax}` are numbers (the one exception).
- [ ] `color` is a hex string (`"#c8a45a"`); `lineStyle` is `"SOLID"`, `"DASHED"`, or `"DOTTED"`.
- [ ] `latex` backslashes doubled for JSON source (`\\\\sin`); single-escaped (`\\sin`) in a raw JS object literal.

**Infrastructure and lifecycle:**

- [ ] `.env.local` exists at the **workspace root** with `VITE_DESMOS_KEY=<key>` — the lesson's `vite.config.js` resolves it via `envDir`, so one key serves every lesson. Obtain at https://www.desmos.com/api (free for educational use); register the allowed origins in the Desmos dashboard (`http://localhost:*` dev, deploy domain prod).
- [ ] `.env.local` is gitignored at the repo root. Never commit the key.
- [ ] The `state` prop passed to `<DesmosGraph>` is stable across renders. If it's built from component state, wrap in `useMemo` so the calculator does not remount every render.
- [ ] Do NOT pass `isPlaying: true` in the state. The component strips it. Animation is always student-initiated via Desmos's native per-slider Play button in the expression panel — there is NO custom overlay play button in either path (`DesmosGraph` shows the expression panel expanded; `ChatBubble` shows it collapsed until the student expands it). Do not add an overlay, and do not flag its absence.
- [ ] `height` prop is set (default 400 px). Avoid `100%` unless the parent has a fixed height.
- [ ] Cap at 3 Desmos embeds per visible topic. Subsequent embeds on the same page are free (CDN bundle already loaded) but visual density still matters.
- [ ] For lessons NOT using Desmos: the key check does nothing; the hook is a no-op until a component calls it with `{ enabled: true }` (the chat path gates on the presence of a `.chat-desmos-block`).

---

## Pedagogy

Run against the assembled lesson (Phase 4) and against the Phase 2 plan. The lesson should teach the way the evidence says learning sticks, not just present material. Mirrors the tutor PEDAGOGY POLICY in `references/template.md` and the backward-design gate in `references/phase-4-review.md`.

- [ ] **Objectives stated and assessed.** Every topic states what the learner should be able to DO (an observable verb — derive / predict / compare / classify, not "understand" / "know"). Every objective maps to at least one active check in the same topic. A topic with content but no check is a constructive-alignment failure.
- [ ] **Retrieval / active practice present per topic.** Each topic has at least one retrieval-first or active-practice primitive (a prediction-before-reveal, a recall prompt, a worked-then-faded example, a self-check question) — not pure exposition. Reading and watching alone are the weakest modes; build in doing.
- [ ] **At least one transfer item.** Beyond recall of what was just shown, at least one check applies the idea to a new surface (same deep structure, different problem). Tag each check recall vs transfer.
- [ ] **Hint ladder, not answer dump.** The PEDAGOGY POLICY (injected by `@core/chat/buildSystemPrompt.js`) encodes least-help-first (nudge -> hint -> step -> answer as last resort) and step-level interaction. Confirm the lesson's `LESSON_CONTEXT` does not weaken it to "just give the answer."
- [ ] **Misconception refutation where one exists.** For any topic with a known misconception, `TOPIC_CONTEXT` names the faulty idea + correct conception so the tutor can diagnose-then-refute. Inline copy that addresses the misconception states it, marks it false, and gives the causal reason — not a bare correct statement.
- [ ] **Feedback is task-focused, never ego.** No person-praise ("you're a natural"), no points / streaks / badges / leaderboards anywhere in lesson copy or tutor steering. Competence feedback is informational and about the work.

---

## Chat reinforcement-learning awareness

The chatbot emits `<<REINFORCE>>text<<END_REINFORCE>>` to capture durable heuristics about this student. Three first-class trigger categories, not just media:

1. **MEDIA signals** — which medium clicked (explicit praise, student unstuck, iteration on a visual, slider engagement on a Desmos graph).
2. **STATED PREFERENCES** — tone, register, analogy use, explanation depth, format, or specific medium (`"just draw it"`, `"keep it technical"`, `"less analogies"`, `"more equations"`, `"skip the intuition, give me the math"`).
3. **CORRECTIONS** — the student flags that a previous approach missed. The heuristic records the CORRECTED behavior, not the failure.

The client merges all three into a per-tab list persisted to `sessionStorage` as `chatReinf_<sid>` and injected back via `[REINFORCED BEHAVIORS]` in every subsequent ACTIVE CONTEXT. The system prompt treats this block as the highest-priority heuristic governing tone, register, analogy use, and explanation depth on EVERY response — not only media selection.

Lesson-planning implication: topics with a diverse media mix give the MEDIA arm something to learn from, but the PREFERENCES and CORRECTIONS arms work regardless of how the lesson was authored. Avoid authoring every topic with the same medium "just to be consistent" — variety is the teaching asset, and the reinforcement loop will converge on what actually works for each student.

---

## Ctrl+Click context gate (client UX)

Clicking a lesson content block or chat reply block to add it to chat context now requires the **Ctrl** key to be held. Implemented in `_lesson-core/chat/Chatbot.jsx`:

- A global `keydown` / `keyup` / `blur` / `visibilitychange` listener toggles `body.ctx-ctrl-held` while Ctrl is down.
- CSS in `_lesson-core/chat/chat.css.js` gates the pointer cursor and hover-outline on that class — transitions stay outside the gate so the fade-in feels smooth the moment Ctrl is pressed.
- A capture-phase `document` click listener `stopPropagation()`s on lesson content blocks when `!ctrlKey`, which means none of the per-lesson `handleContentClick` copies need editing.
- `ChatBubble.handleBlockClick` early-returns on `!e.ctrlKey`.
- Text-selection-then-mouseup adding a selection to context is unchanged (different gesture).

**Call this out in the lesson's `CLAUDE.md`** when a human tester is likely to QA the lesson. Without the note they will wonder why plain clicks stopped adding context to chat.

---

## Chatbot props checklist

The `<Chatbot>` signature expanded with the graph-schema feature.

**Lesson/course identity props**:

- [ ] `courseCode` — the course display code collected at Phase 0
- [ ] `courseName` — the full course name collected at Phase 0
- [ ] `lessonContext={LESSON_CONTEXT}`
- [ ] `topicContext={TOPIC_CONTEXT}`
- [ ] `lessonFile` equals the scoping artifact's `lesson_file` (`src/<slug_snake>.jsx` — underscores, not dashes; used by the chatbot's self-editing path to know which file to edit)

**Graph-editing props** (graph-schema feature):

- [ ] `graphSchema={GRAPH_SCHEMA}` — passed so the chatbot knows the editable field shape of each graph. Without this, the runtime validator silently accepts arbitrary LLM edits.
- [ ] `graphRenderId={graphRenderId}` — incrementing state that keys the graph-preview tab so it re-renders when `<<EDIT_GRAPH>>` mutates params. `const [graphRenderId, setGraphRenderId] = useState(0);` at the top of LessonApp, incremented by `onEditGraph`.

**Existing session/UI props** (verify they still thread through):

- [ ] `topicId`
- [ ] `topicTitle`
- [ ] `contextSnippets`
- [ ] `open`
- [ ] `setOpen`
- [ ] `onEditGraph`
- [ ] `graphParams`
- [ ] `addSnippet`
- [ ] `threadTrigger`
- [ ] `threadCtxTrigger`
- [ ] `onClearSnippet`
- [ ] `onClearAllSnippets`

---

## Automated checks (T1-T3 raw commands)

Three lightweight checks Phase 4's `code-review-agent` runs first, before the full 17-test suite. Catches most Phase 3 splice errors cheaply.

**T1 — Babel JSX parse** (run once per lesson file):

```bash
cd "<lesson_root>" && npm install --save-dev @babel/parser 2>/dev/null
node -e "
const fs = require('fs');
const p = require('@babel/parser');
try {
  p.parse(fs.readFileSync('FILEPATH', 'utf8'), {sourceType:'module', plugins:['jsx']});
  console.log('T1 PARSE: PASS');
} catch(e) { console.log('T1 PARSE: FAIL —', e.message); }
"
```

**T2 — KaTeX safety** (bare `<` in `{"..."}` string expressions, with legitimate-escape whitelist):

```bash
BAD=$(grep '{"[^"]*<[^"]*"}' FILEPATH \
  | grep -v '\\\\lt' | grep -v '\\\\leq' | grep -v '\\\\left' \
  | grep -v '\\\\ll' | grep -v '\\\\lambda' | wc -l)
if [ "$BAD" -eq 0 ]; then echo "T2 PASS"; else echo "T2 FAIL — $BAD unsafe lines"; fi
```

**T3 — Bare angle brackets in heading text** (`<h2>`, `<h3>`, `<h4>` elements):

```bash
grep -n '<h[234]>.*[<>].*</h[234]>' FILEPATH | grep -v '{"' \
  && echo "T3 FAIL" || echo "T3 PASS"
```

---

## 17-test suite summary

Phase 4 runs the suite via `node test_lesson.cjs`; each lesson ships its own `test_lesson.cjs` running these 17 tests against `src/<slug>.jsx`.

- **T1** — JSX Babel parse. Catches syntax errors and the most common KaTeX escape mistakes.
- **T2** — KaTeX safety: no bare `<` in `{"..."}` string expressions (whitelist: `\\lt`, `\\leq`, `\\left`, `\\ll`, `\\lambda`, `\\langle`, `\\ldots`).
- **T3** — No bare angle brackets in JSX heading text (`<h2>`, `<h3>`, `<h4>` elements).
- **T4** — Has `export default` on the main component.
- **T5** — `TOPICS` array is defined (`const TOPICS = [ ... ]`).
- **T6** — `TOPIC_CONTEXT` object is defined.
- **T7** — `LESSON_CONTEXT` constant is defined.
- **T8** — Imports from `@core` and references `Chatbot`.
- **T9** — Theme `className="theme-dark"` or `"theme-light"` present (gold accent handled by CSS vars in `@core`).
- **T10** — IBM Plex font family is referenced (inline monospace label styles).
- **T11** — Imports `Eq`, `KeyConcept`, and `Chatbot` from `@core` (these apply `.eq-block`, `.key-concept`, `.chat-panel`).
- **T12** — No `localStorage` usage (sessionStorage alias `_ss` is intentionally allowed).
- **T13** — No emojis (Unicode ranges for emoticons, symbols, dingbats, flags all checked).
- **T14** — `TOPIC_CONTEXT` keys match `TOPICS` ids one-to-one, via Babel AST walk (not regex, which gave false positives).
- **T15** — Imports `useKatex` from `@core`.
- **T16** — `LessonApp` renders `<Chatbot>` with a `courseCode` prop.
- **T17** — Imports `Chatbot` from `@core` (not a local copy) AND does NOT reference `api.anthropic.com` (all chat routed through local proxy).

---

## Research quality gate

Run at the end of Phase 1 before handing to Phase 2.

- [ ] Every equation has a source (lecture page, textbook section, URL). "Standard result" is not acceptable.
- [ ] Every variable is defined, with units.
- [ ] **Worked solutions: allowed for practice cards, never as answer dumps.** Research/content agents MAY extract worked solutions for `PracticeProblem` cards when the solution is official (came verbatim with the source material) or verifiably sourced (derived, then confirmed against ≥2 independent sources). These render collapsed and provenance-marked (`provenance="official"` or `"ai-worked"` with `aiSources`); fabricated problems or solutions are forbidden. The anti-answer-key rule still governs everything else: the chatbot's tutoring behavior follows the PEDAGOGY POLICY injected from `@core/chat/buildSystemPrompt.js` (least-help-first, never a straight answer dump), and lesson prose must not dump answers outside practice cards.
- [ ] **Concision**: every paragraph teaches something. Cut filler. Prefer an equation or diagram reference over prose describing the same thing.

---

## Practice problems checklist

Applies wherever Phase 1 extracted practice problems (past finals, midterms, HW, problem sets) into a topic's `practice_problems` array. Phase 3 renders them; Phase 4 verifies.

- [ ] Rendered via the `PracticeProblem` component from `@core` — statement visible by default, solution collapsed by default so students attempt first, then check. No ad-hoc per-lesson reimplementations.
- [ ] Every problem carries a `source` provenance tag in `"<Exam or Set> <Year> — Q<N>"` form (e.g., `"Final 2024 — Q3"`, `"PS4 — Q2"`); fall back to `"<filename> p.<page>"` when the source is ambiguous, so the student can trace it.
- [ ] `provenance` prop is correct: `"official"` only when the solution was captured verbatim from the source material (solutions appendix, HW key, textbook worked example). Derived solutions use `"ai-worked"` AND supply `aiSources` with ≥2 independent sources — the same two-source cross-reference bar as other equations. An `"ai-worked"` card without `aiSources` fails this check.
- [ ] Solutions include the final answer with units and significant figures preserved exactly as the source gave them. Do not paraphrase numerical answers.
- [ ] No fabricated problems. A topic with an empty `practice_problems` array gets no practice section at all — do not render an empty "Practice problems" heading, and do not invent problems to fill the slot.
- [ ] Per-topic problem counts and provenance totals in the final lesson match the approved Phase 2 plan's `Practice problems index`.

---

## Physics consistency and edge-case checklist

Phase 4 content-review-agent runs every new/refined graph through these; they catch rendering bugs that numerical spot-checks miss.

- [ ] **Limiting behavior**: For every graph, check behavior at extremes. What happens at `x = 0`? At `x → ∞`? At `x → -∞`? Do the curves match known physics in these limits?
- [ ] **Monotonicity**: Verify curves are monotonic where they should be. Shockley forward bias is strictly increasing. MOSFET saturation is flat with `VDS` (no channel-length modulation) or slightly increasing (with CLM). Bode LPF magnitude is non-increasing after the corner frequency.
- [ ] **Continuity at region boundaries**: Verify no discontinuities where regions meet. The MOSFET triode-to-saturation boundary must give identical current values at `VDS = Vov` from both formulas. The diode at `VD = 0` must give exactly zero current.
- [ ] **Multi-curve consistency**: For family-of-curves plots, higher control parameter must give higher output curve. Example: in MOSFET output characteristics, higher `VGS` → higher `IDS`. Curves must not cross where they shouldn't.
- [ ] **Missing features**: Cross-reference against standard textbook figures for the lesson's domain. Whatever the textbook figure routinely shows (limiting regions, breakdown behavior, both magnitude and phase on a frequency plot, etc.), the lesson graph should show too unless there is a deliberate pedagogical reason to omit it.

### Numerical spot-check pattern

When Phase 4 catches a suspect graph, content-review-agent writes a small Node script to evaluate the graph's math at known test points:

1. Extract the core equation from the graph component function body.
2. Evaluate it at specific test points where the expected answer is known from theory (e.g., diode at `VD=0`, `VD=0.5`, `VD=0.6`, `VD=0.7`).
3. Print each computed value alongside a PASS/FAIL judgment based on the expected range.
4. Flag any value outside the expected envelope as a likely rendering bug.

**Common bugs this pattern catches**:

- Clamping or `Math.min` that flattens exponentials (the original `DiodeIVCurves` bug).
- Wrong sign on the curve (increasing instead of decreasing, or vice versa).
- Missing regions (no reverse breakdown, no cutoff region).
- Incorrect scale factors that make curves invisible or clipped at the axis.
- Triode-saturation boundary mismatch (two formulas giving different values at the boundary).
- Wrong slope direction in Bode plots.
- Phase going the wrong way (leading vs lagging).

---

## Content concision rule

Phase 3 execution agents reference this when writing `<P>` blocks alongside components.

- [ ] Every `<P>` block must teach something the student cannot get from the equation alone.
- [ ] Do not restate what the equation already says. Example anti-pattern: writing "this equation tells us that X increases with Y" when that fact is obvious from the formula.
- [ ] Use prose to explain *why*, *when*, and *watch out for*, not *what*. The equation is the *what*.
- [ ] If a concept is best conveyed by a graph or equation, let the graph or equation do the work. Do not narrate around it.

---

## Project CLAUDE.md checklist

Phase 3 touches `CLAUDE.md` only for new course/slug. Update mode is typically no-op (preserve `## Lesson App`).

- [ ] `## Lesson App` heading present as a top-level section.
- [ ] Section is 10-15 lines maximum. Longer means it is documenting something that should live elsewhere.
- [ ] Covers: what the project is, course code and topic, stack summary, how to run locally, key directories.
- [ ] Preserve unrelated content when updating an existing `CLAUDE.md`. Only add or update the `## Lesson App` section; leave other sections (project-specific instructions, agent notes) alone.

---

## Update-mode pre-flight checklist *(update mode)*

Update mode only. Run before scoping closes. Failures surface at mode confirmation; most require halt or opt-in bypass.

- [ ] Lesson root resolves to an existing directory. Canonical form: `<workspace_root>/<course>/claude_lessons/<slug>/`.
- [ ] `src/<slug>.jsx` exists at the expected path and parses cleanly under Babel (`{ sourceType: "module", plugins: ["jsx"] }`). A parse failure means the baseline is already broken; halt and surface the parse error.
- [ ] Either `CLAUDE.md` or the lesson JSX header identifies the course code unambiguously. Ambiguous course codes block scoping auto-fill.
- [ ] Git working tree is either clean, or the caller has intentionally stashed changes. If dirty, main Claude stashes with a labeled ref (`lesson-builder-preflight-<slug>-<timestamp>`) and logs the stash ref for later recovery.
- [ ] `from "@core"` imports are present in `src/<slug>.jsx`. If absent, the lesson predates the `_lesson-core/` migration and still inlines the old chat code. Update mode must halt with a migration-first warning. Narrow opt-in bypass ("update without migration") is allowed only with explicit user acknowledgement during scoping confirmation.
- [ ] `GRAPH_SCHEMA` is present in the lesson file. If absent, the lesson predates the graph-schema feature; schedule a backfill in Phase 3 per `references/graph-schema-guide.md`. Do not halt; log as a drift-repair item.
- [ ] `test_lesson.cjs` exists in the lesson root. If absent, restore it from the canonical copy at `references/bootstrap/lesson-template/test_lesson.cjs` and log the restore as a drift-repair item; do not splice a shim from a sibling lesson.
- [ ] Branch name `lesson-update/<slug>-YYYYMMDD` does not already exist locally. If it does, increment with a suffix (`-a`, `-b`) or ask the user to confirm a rerun. Collision handling must be deterministic so the Phase 5 merge target is unambiguous.
- [ ] No slug rename requested (disallowed — slug renames affect branch name, commit message, hosted deploy path, and `vite.config.js base=`; handle as "create new + delete old" flow, not as an update).

---

## Update-mode splice checklist *(update mode)*

Update mode only. Run after every splice edit and as final sweep before Phase 4. Pairs with the assembly algorithm in `references/phase-3-execution.md`.

- [ ] Every `refine` component has the **same function name** as the existing component it replaces. Function-name anchoring is how the splice finds the edit site; a rename breaks the splice silently.
- [ ] Every `remove` component has no remaining call sites in the JSX after splicing. Grep for `<ComponentName` and confirm zero hits. Dangling call sites become reference errors at runtime.
- [ ] `DEFAULT_GRAPH_PARAMS` keys match the current graph component set one-to-one. A removed graph must also have its `DEFAULT_GRAPH_PARAMS` entry removed; an added graph must have an entry inserted.
- [ ] `GRAPH_SCHEMA` keys match `DEFAULT_GRAPH_PARAMS` keys one-to-one. Drift between the two is the most common Phase 4 failure after a splice.
- [ ] No dangling imports or unused helpers after splicing. If a removed graph was the only user of a utility helper (e.g., `computeBandGap`), the helper should also be removed.
- [ ] The `graph-preview` tab's rendered list includes all final graphs (new, refined, retained). A newly-added graph absent from graph-preview will not show up in visual-QA screenshots and will silently escape Phase 4 review.
- [ ] `TOPICS` array order matches the declared Phase 2 plan. A `reorder` action in the change-list must actually land in the final file; Grep-verify.
- [ ] `TOPIC_CONTEXT` keys match `TOPICS` ids one-to-one after all additions, removals, and reorders. This is a post-splice re-check of the T14 invariant.
- [ ] Manim `<video src=...>` paths resolve to actual files in `public/videos/`. A refined manim component that overwrote the `.mp4` at the same path will still pass this check; a replaced manim with a new filename requires the src to be updated.
- [ ] `<img src=...>` paths resolve to actual files in `public/images/`. Same logic as manim: refine preserves the path, replace requires an update.
- [ ] `<InteractiveDemo title>` values are preserved for `refine` actions. The `title` is used as the identifier in the media inventory, so renaming it breaks the refine → replace → remove audit trail.
- [ ] LESSON_CONTEXT spliced update (if Phase 1 changed it) lands inside the existing constant declaration, not as a duplicate constant.
- [ ] `<Chatbot>` props reconcile check: `courseCode`, `courseName`, `lessonContext`, `topicContext`, `lessonFile`, `graphSchema`, `graphRenderId` all present and non-stale. Update if a `courseName` was previously missing or `graphSchema` was just backfilled.

---

## Post-splice sanity pass

Main Claude runs this after assembly, before Phase 4. Cheap gate catching common splice corruption. Failures halt and fix in-place without review agents.

- [ ] Babel parse passes. This is the coarsest gate and must pass before any other post-splice check runs.
- [ ] Grep count: every `DEFAULT_GRAPH_PARAMS[<key>]` access has a matching key definition in the `DEFAULT_GRAPH_PARAMS` object literal.
- [ ] Grep count: every `<ComponentName />` call site (for lesson-defined components — not `@core` primitives) has a matching `function ComponentName` definition in the file.
- [ ] Grep count: every `GRAPH_SCHEMA[<key>]` access has a matching key in the `GRAPH_SCHEMA` object literal.
- [ ] File line-count delta matches expected splice magnitude. Compute `abs(lines_after - lines_before)`, compare to the declared change-list (roughly: refines are small deltas, adds are positive, removes are negative). A wild delta (e.g., ±500 lines for a single `refine`) indicates runaway edits and should halt the pipeline.
- [ ] No stray `<<< >>> ===` conflict markers from any stash/merge/rebase that may have been in-flight.
- [ ] The graph-preview tab content block renders every graph component by Grep-count match.
- [ ] The `TOPIC_CONTEXT` object has the same number of keys as the `TOPICS` array has entries (quick sanity on T14 before Phase 4 runs the full check).

---

## Cross-references

- Graph schema derivation: `references/graph-schema-guide.md`
- Phase 3 execution (splice algorithm): `references/phase-3-execution.md`
- Phase 4 review (parallel reviews, fix loop): `references/phase-4-review.md`
- Shared chat + UI core: `<workspace_root>/_lesson-core/`

