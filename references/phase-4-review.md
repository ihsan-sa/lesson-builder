# Phase 4: Review with progress-aware fix loop

Phase 4 is the quality gate of the lesson-builder pipeline. Everything before it is constructive (research, planning, execution); everything after it is deployment. Phase 4's job is to catch what Phases 1-3 missed, decide whether fixes are worth attempting, and either produce a shippable artifact or halt cleanly with a diagnosable failure state.

## Purpose

Phase 4 runs a battery of parallel reviews against the post-execution lesson (the JSX assembled in Phase 3 plus every medium built by the specialists), compiles the findings into a single issue list, drives a progress-aware fix loop that halts cleanly instead of churning, and gates on a local build verification step before Phase 5 is permitted to deploy. The mechanism itself is mode-agnostic: new-mode and update-mode builds share the same reviewers, the same compile step, and the same fix loop shell. Two update-mode-specific rules layer on top — the **no-grandfathering** rule expands visual-QA coverage to every medium in the post-update lesson (not just the ones that changed), and the **regression-watch** rule halts a fix thread the moment a refine/replace iteration breaks a previously-clean `keep` medium.

---

## Parallel reviews

Main Claude fires all of these at once. Do not serialize. The goal is to get the complete picture of what is wrong in one pass, then fix once, rather than discovering problems drip by drip.

Spawning order inside the single parallel fire: `code-review-agent` and `content-review-agent` first (cheapest), then the build+test shell command, then the visual-QA specialist teams, then the headed Playwright run, then the change-list sanity Grep pass (update mode only). All of these are in the **same** parallel message — "first" and "last" here refer to the order tools are listed in the tool call block, not sequential execution. Tool call ordering inside a parallel block matters only for readability and log order, not for execution.

### 1. `code-review-agent`

Structural and syntactic review of the lesson JSX. Checks:

- **Template compliance**: `@core` imports are present and correct (`Eq`, `M`, `P`, `Section`, `KeyConcept`, `CollapsibleBlock`, `RefImg`, `THEMES_G`, `MODELS`, `EFFORT_LEVELS`, `Chatbot` as needed). No inlined chat code — the lesson must delegate to the shared `<Chatbot>` component rather than duplicating `ChatBubble`, `ThreadPanel`, `sendMessage`, etc. Any lesson that re-inlines chat code will drift away from bug fixes and feature additions made in `_lesson-core/chat/`.
- **KaTeX safety**: every `<Eq>` and `<M>` uses `{"..."}` with double-escaped backslashes, and bare `<` / `>` inside KaTeX strings are replaced with `\\lt` / `\\gt`. Legitimate escapes (`\\leq`, `\\left`, `\\ll`, `\\lambda`) are allowed. The rationale is that KaTeX strings get parsed as JSX string expressions first, so a bare `<` inside a `{"..."}` body either breaks parsing or renders as an HTML tag.
- **Babel parse**: the file parses cleanly with `@babel/parser` under `sourceType: module` with the `jsx` plugin. This is the same check as T1 below, duplicated here because `code-review-agent` runs before `node test_lesson.cjs` and the fastest fail is the one that short-circuits everything else.
- **SVG markup validation**: every inline SVG has a `viewBox`, closes all tags, and has unique marker IDs across the file (no duplicate `id="ah"` from copy-pasted arrow markers). Duplicate marker IDs cause the second occurrence to inherit the first's styling, which silently breaks arrowheads on the second graph.
- **Graph schema consistency**: the keys in `DEFAULT_GRAPH_PARAMS` match the keys in `GRAPH_SCHEMA` exactly (required by the chatbot edit-graph feature; a drift here breaks self-editing). Drift in either direction is a blocker: a missing `GRAPH_SCHEMA` entry means the chatbot has no schema to reason about; a missing `DEFAULT_GRAPH_PARAMS` entry means an edit-graph instruction has no initial value to diff against.

Returns a list of issues tagged by severity and line number. Does not attempt fixes; fixes happen in the fix loop below.

**Spawn brief template** (main Claude passes this to `code-review-agent`):

```
lesson_path: <absolute path to src/<slug>.jsx>
mode: new | update
change_list: <Phase 2 change-list if update mode, else null>
checks_required: [template_compliance, katex_safety, babel_parse, svg_markup, graph_schema]
return_format: { blockers: [...], majors: [...], minors: [...] }
```

### 2. `content-review-agent`

Pedagogical review against the Lesson Plan, the compiled content package from Phase 1, and the original source materials. Two shapes depending on mode:

- **New mode**: review content for accuracy, clarity, and alignment with the scope agreed in Phase 0. Flag hallucinated equations, missing caveats, wrong constants, missing variable definitions, or drift between what the Lesson Plan promised and what the JSX actually teaches.
- **Update mode**: review against the Phase 2 change-list specifically. The change-list is the contract; this reviewer's job is to catch drift between what the user approved and what landed in the JSX. If the change-list says "replace derivation A with derivation B", this reviewer confirms derivation B is now present AND the old derivation A is actually gone. Drift in either direction is flagged.

### 3. Build + test

Runs from the lesson root:

```bash
cd "<lesson_root>"
npm install
node test_lesson.cjs
```

`test_lesson.cjs` executes the 17-test suite defined below. Capture the full pass/fail breakdown and feed it into the compile-findings step as another reviewer.

#### The 17-test suite

Preserved from the legacy `jsx-lesson` skill references. Each test is a one-liner pass/fail check inside `test_lesson.cjs`:

- **T1 — JSX Babel parse**: `@babel/parser` parses the file with `jsx` plugin enabled. Catches syntax errors.
- **T2 — KaTeX safety**: no bare `<` characters inside KaTeX string expressions (regex `{"..<.."}`), except allow-listed sequences `\\lt`, `\\leq`, `\\left`, `\\ll`, `\\lambda`, `\\langle`, `\\ldots`. Bare `<` crashes KaTeX.
- **T3 — Heading bracket safety**: no bare `<` / `>` inside `<h2>`, `<h3>`, `<h4>` text nodes (JSX parse error).
- **T4 — Export default**: file contains `export default`.
- **T5 — `TOPICS` defined**: `const TOPICS = [` declaration present.
- **T6 — `TOPIC_CONTEXT` defined**: `const TOPIC_CONTEXT = {` declaration present.
- **T7 — `LESSON_CONTEXT` defined**: `const LESSON_CONTEXT =` declaration present.
- **T8 — Imports from `@core`**: file imports from `"@core"` and references `Chatbot`.
- **T9 — Theme className**: uses `className="theme-dark"` or `className="theme-light"` (gold accent handled by CSS vars in `@core`).
- **T10 — IBM Plex**: file mentions `'IBM Plex'` somewhere (inline monospace label styles).
- **T11 — Core CSS classes**: imports `Eq`, `KeyConcept`, and `Chatbot` from `@core` (these apply `.eq-block`, `.key-concept`, `.chat-panel`).
- **T12 — No browser storage**: no `localStorage` usage (sessionStorage alias `_ss` is intentionally allowed).
- **T13 — No emojis**: Unicode emoji regex finds nothing.
- **T14 — `TOPIC_CONTEXT` keys match `TOPICS` ids**: Babel AST walk: every `{id: "..."}` entry in `TOPICS` has a matching key in `TOPIC_CONTEXT`. Replaces a buggy regex-based check.
- **T15 — `useKatex` hook**: imports `useKatex` from `@core`.
- **T16 — `<Chatbot>` render**: file renders `<Chatbot>` with a `courseCode=` prop.
- **T17 — No direct API**: imports `Chatbot` from `@core` (not a local copy) AND does NOT contain `api.anthropic.com` (all chat routed through the local proxy).

### 4. Visual-QA per medium

Specialist visual-QA teams spawned in parallel, one team per medium type present in the lesson. All teams within a team run in parallel too, so a lesson with 3 SVG graphs + 2 Matplotlib RefImgs + 1 Manim video fires 4+4+3 = 11 specialist spawns at once (three SVG teams of 4, two RefImg teams of 4, one Manim team of 3).

- **SVG**: `geometry-agent` (shapes and coordinates are correct) + `colour-agent` (uses the theme palette, not hardcoded hex; gold accent visible) + `readability-agent` (label size, label placement, no overlap, legible in both dark and light themes) + `scientific-accuracy-agent` (curve shape matches the underlying equation; the numerical spot-check lives in content-verification but scientific-accuracy is the sanity check that the shape is right).
- **Matplotlib RefImg**: `geometry-agent` + `colour-agent` + `scientific-accuracy-agent` + `readability-agent`. Same four dimensions as SVG. RefImg is a static PNG so there is no motion dimension, and the `.py` script that generated the PNG is the review target alongside the PNG itself.
- **Manim**: `motion-timing-agent` (animation pacing, transitions, hold durations appropriate for study use) + `colour-agent` + `scientific-accuracy-agent`. Geometry and readability fold into motion-timing for Manim because a static frame of a Manim video tells you less than a static frame of an SVG.
- **Interactive demos**: `interaction-agent` (controls work, slider ranges sensible, state updates correctly on input) + `readability-agent` + `scientific-accuracy-agent`.

Each specialist reviews its artifact against the **original stated intent** as captured by the orchestrator, not against the user's most recent concerns. A refined graph must be evaluated against what the graph was always supposed to show, otherwise refinements get graded on a shifting rubric. Main Claude's spawn brief must include the original intent string, not the update user-concerns string.

**Scope depends on mode**:

- **New mode**: every built medium runs through the full specialist team for its type.
- **Update mode (no-grandfathering)**: every medium in the post-update lesson — `keep`, `refine`, `replace`, `add` — runs through its full visual-QA team. Pre-existing drift does not get a free pass. Rationale: the user decided once (by approving the Lesson Plan at the Phase 2 gate); visual-QA then covers all final media equally so the lesson that ships matches the plan that was approved. Skipping `keep` media would make update-mode reviews strictly weaker than new-mode reviews, and the user would have no way to know when they shipped a lesson whose unchanged media silently fails a quality dimension that would have blocked a new build.

**Spawn brief template** (main Claude passes this to each specialist):

```
medium_type: svg | matplotlib | manim | interactive_demo
artifact_path: <component name inside JSX | .py path | .mp4 path | demo component name>
original_intent: <one-sentence description from the orchestrator>
mode: new | update
update_action: keep | refine | replace | add   (update mode only)
previous_verdict: <specialist verdict from prior review if any, else null>
```

### 5. Headed Playwright testing via `@playwright/mcp`

Main Claude spawns a headed browser session against the dev server (from the chatbot plan Phase C wiring) and drives a short interaction script. This is the only reviewer that exercises the runtime behavior of the lesson end to end, so it catches issues that are invisible to static analysis: stale closures, uncaught promise rejections, theme transitions that leave orphan styles, chatbot SSE streams that open but never produce tokens.

Prerequisites: the lesson's proxy (`node server/proxy.js`) and Vite dev server (`npx vite`) must be running. Main Claude either starts them as background tasks before the Playwright spawn or reuses already-running instances if the lesson was launched earlier in the session.

Interaction script:

- Load the lesson at the Vite dev URL.
- Toggle the theme (dark to light to dark); confirm no console errors and the gold accent `#c8a45a` stays visible in both themes.
- Initialize a chat session; confirm SSE streaming produces tokens in the chat panel.
- Click every tab; confirm each tab renders without error and KaTeX re-lays out correctly (the `.katex` class elements should be present on tab-switch).
- Click the graph preview tab (if present); confirm the preview renders.
- Run at least one chat edit-graph round-trip: ask the chatbot to modify a parameter, confirm the `<<EDIT_GRAPH>>` block is stripped from the visible response, and confirm the graph re-renders with the new parameter applied.

Any console error, failed fetch, unhandled rejection, or visibly broken render from this script lands in the issue list.

### 6. Update-mode change-list sanity

A cheap, Grep-level verification that every declared topic add / remove / reorder in the Phase 2 change-list actually landed in the final JSX. Examples of checks:

- For every `topics.added`: Grep confirms the topic id exists in `TOPICS` AND a matching `TOPIC_CONTEXT` entry exists.
- For every `topics.removed`: Grep confirms the topic id is absent from both `TOPICS` and `TOPIC_CONTEXT`, and no orphaned component references remain (a removed topic should not have any `<Topic id="removed-id">` callers left in the JSX).
- For every `topics.reordered`: confirm the order in the `TOPICS` array matches the declared new order.
- For every media `add` / `remove`: confirm the component function (SVG graph) or asset path (Manim video, Matplotlib PNG) exists / is gone. For `remove`, also confirm there are no dangling callers and the `DEFAULT_GRAPH_PARAMS` / `GRAPH_SCHEMA` entries for the removed graph are gone.
- For every media `refine`: confirm the original function name or asset path is still present (refine must preserve identifiers so call sites remain valid — this is enforced in `graphics-agent.md` and `manim-agent.md` update-mode rules).
- For every media `replace`: confirm the new artifact is present AND the old one is gone.

Fails loudly on any declared-vs-actual mismatch. This is the backstop for the content-review-agent's soft drift check: content-review reasons about meaning, change-list sanity reasons about presence. Both matter, because a change-list can be followed literally while the meaning drifts (content-review catches this), and a change-list can be followed in spirit while the JSX does not reflect the declared change (change-list sanity catches this).

---

## Compile findings

Main Claude assembles the issue list across all reviewers into a single structured record, organized by:

- **Severity**: blocker (fails build / test / parse, change-list mismatch in update mode), major (visual-QA specialist reports failure, content drift, Playwright headed test fails), minor (manual-checklist nits, cosmetic).
- **Medium**: code (JSX file), SVG, Matplotlib, Manim, interactive demo, content, change-list.

### Issue record schema

```
{
  id: <stable string, e.g. "code.katex.001">,
  severity: "blocker" | "major" | "minor",
  medium: "code" | "svg" | "matplotlib" | "manim" | "demo" | "content" | "changelist",
  source_reviewer: "code-review-agent" | "content-review-agent" | "T<N>" | "<specialist>-agent" | "playwright" | "changelist-sanity",
  location: <file:line or component name or asset path>,
  description: <what is wrong>,
  fix_hint: <optional pointer to the likely fix>,
  iterations_attempted: 0,
  history: []
}
```

The compiled issue list is the input to the fix loop. It is also written to the log under the Phase 4 section before any fixes are attempted, so the starting state is recoverable if the fix loop has to be abandoned. Writing the baseline to the log first is a deliberate choice: if the fix loop crashes or the user ctrl-Cs, the baseline is already persisted and the next run has a starting point.

---

## Progress-aware fix loop

The loop combines hard metric signals and LLM self-assessment. The guiding principle is **bias toward stopping early** over churning. A fix loop that burns iterations without converging is worse than logging a known issue and moving on, because churning risks regressing already-correct work.

Fixes are applied by the same medium specialist that created the artifact originally: code issues go to `code-review-agent` (which has edit authority in this phase, unlike its read-only Phase 3 role), SVG graph issues go to `graphics-agent`, Manim issues to `manim-agent`, interactive demo issues to `interactive-demo-agent`, content drift issues to `content-review-agent` (with edit authority). Main Claude is the dispatcher; it does not apply fixes directly.

### Metrics (hard signals per issue)

- **Issue count must decrease per iteration.** If the total number of open issues does not strictly decrease from iteration N to N+1 for a given issue thread, that is a stall.
- **Test pass rate must increase per iteration.** If the 17-test pass count does not increase (or the same tests fail twice), that is a stall on test-category issues.
- **Diff size per fix.** The diff applied by the fix iteration should shrink as the loop converges (each fix gets more surgical). A re-growing diff is a signal of churning — the fix agent is rewriting, not refining.
- **Iteration count.** Soft cap at 3 iterations. This is another input signal, not a hard max. If metrics say "iteration 4 would converge", main Claude can allow it; if metrics say "iteration 2 is already regressing", halt before iteration 3.

### LLM judgment (soft signal)

At the end of each iteration the fix agent writes a one-line self-assessment: "improving", "stalled", "regressing", or "no meaningful progress". Main Claude reads it alongside the metrics. The LLM signal is never the sole reason to halt, but it breaks ties when metrics are ambiguous.

### Stop rules

- **Metric stall**: metrics don't improve across 2 consecutive iterations on the same issue → log as unresolved, move on.
- **Self-assessment stall**: the fix agent reports "no meaningful progress" twice → log as unresolved, move on.
- **Fundamental flaw**: a test failing in a way that suggests the Phase 2 plan was wrong (e.g., T14 failing because the Lesson Plan asked for a topic id that collides with a reserved keyword; T16 failing because the plan omitted the Chatbot entirely) → halt the fix loop, do not attempt further iterations, surface to user for an abort decision. Fundamental flaws must not be patched in Phase 4; they require going back to Phase 2.
- **Update mode only — regression-watch**: if a refine/replace fix iteration regresses a previously-clean `keep` medium (a visual-QA specialist that previously passed now fails on an untouched medium), halt that specific fix thread, log the event as a `regression-watch` entry, and surface it at Phase 5. Do not try to re-fix the regressed `keep` medium inside this fix loop — the signal is that the refine/replace touched a shared helper or shared style, and the correct response is to let the user inspect the scope of the collateral damage before merging.

### Iteration trace

Each iteration is logged with: issues-before count, issues-after count, test pass rate before and after, diff size (lines added/removed), LLM self-assessment one-liner, and which stop rules fired (if any). This trace is the record that the loop halted legitimately, not by accident.

### Worked example

A lesson enters Phase 4 with 6 issues: 2 blockers (T2 KaTeX bare `<` on two lines, T14 TOPIC_CONTEXT key mismatch), 3 majors (SVG geometry-agent reports off-axis label on graph 2, content-review-agent reports missing variable definition, Playwright reports console error on theme toggle), 1 minor (checklist: missing `finally` block in `sendMessage`).

- **Iteration 1**. Fix agent addresses all 6 in one pass. Diff is 42 lines. Post-iteration re-review: 2 blockers resolved, graph-2 label moved but scientific-accuracy now flags the moved label as overlapping the curve, content variable definition added, Playwright console error still present (theme toggle unhandled), `finally` block added. New issue count: 3 (1 fresh major from the label move, 2 carried over). Test pass rate: 15/17 → 17/17. Self-assessment: "improving". Continue.
- **Iteration 2**. Fix agent targets the 3 remaining: repositions the label with a fixed offset, traces the theme-toggle console error to a stale `THEMES_G` import. Diff is 18 lines (shrinking — good sign). Post-iteration: 0 issues. Test pass rate: 17/17. Self-assessment: "improving". Loop closes cleanly.
- **Logged**: 2 iterations, both improving, no stop rules fired, 6 → 0 issues.

A counter-example that halts: same starting state, but iteration 1 fixes only 1 issue and introduces 2 new ones. Diff is 80 lines (larger than needed). Iteration 2 fixes 1 more but introduces 1 new. Diff is 95 lines (growing). Metrics: issue count 6 → 7 → 7 (no strict decrease), diff growing. Self-assessment: "stalled" then "no meaningful progress". Stop rule fires at end of iteration 2, 4 issues logged as unresolved, loop terminates.

---

## Local build verification (Phase 5 gate)

Runs at the very end of Phase 4, after the fix loop has settled. This is the gate that Phase 5 cannot bypass. The purpose is to catch build breaks that the per-lesson dev server and test suite miss — mainly issues that only surface under `vite build` (unresolved imports at build time, missing public assets, production-only code paths) and that would otherwise fail whenever the workspace next ships.

```bash
cd <workspace_root>
bash build-all.sh
```

The workspace's `build-all.sh` runs `npm install` plus `npx vite build --base="/<course>/<slug>/"` per lesson and copies each lesson's `dist/` into the root `dist/<course>/<slug>/`. Full build time depends on lesson count; single-lesson builds are fast.

After the build completes, run a **headless Playwright check** of the built artifact:

- Load `file://<workspace_root>/dist/<course>/<slug>/index.html` (or via a small local static server if the `file://` protocol breaks CORS for fonts).
- Confirm KaTeX loads (no "Failed to load KaTeX" console errors, rendered equations have `.katex` class elements).
- Confirm every tab button is clickable and each tab renders without console errors.
- Confirm no unhandled promise rejections or failed fetches in the console.

**Update mode note**: in update mode the build runs against the current branch (the update branch created in Phase 3, typically `lesson-update/<slug>-YYYYMMDD`). Do not switch to `main` before the build — that would build the wrong code and invalidate the verification.

If either `build-all.sh` or the headless Playwright check fails, halt before the Phase 5 commit/merge. Surface the failure to the user with: the failing command, the relevant log excerpt, and the current branch state (so the user can reproduce). Do not attempt automatic fixes at this stage — a build failure that survived the 17-test suite and the fix loop is, by definition, something the reviewers missed, and main Claude should not try to patch it blind. The correct response is to return to Phase 4 reviews with the new information (the build error), possibly return to Phase 2 if the error suggests a structural problem, or surface the blocker to the user for an abort decision.

Note that the full `build-all.sh` builds every lesson in the workspace, not just the one under review. This is deliberate: a change in `_lesson-core/` can break any lesson that imports from `@core`, so the full build is the only way to catch cross-lesson regressions introduced by a change to the shared core. If Phase 3 only touched per-lesson files (no `_lesson-core/` edits), a scoped build targeting only `<lesson_root>` is acceptable as an optimization, but the full build remains the default.

---

## Tuning notes

These thresholds are starting heuristics. Adjust after real runs produce real data:

- **Regression-watch sensitivity**. Visual-QA specialists have non-deterministic outputs (especially for readability and scientific-accuracy judgments on close calls), so regression-watch may fire spuriously. Start conservative: fire the rule only after **two consecutive regressions in different iterations** on the same `keep` medium before halting the fix thread. One-off regressions are probably noise; persistent regressions are real.
- **Progress thresholds**. The "issue count must decrease per iteration" rule is strict. In practice, an iteration that closes 3 issues and opens 1 new minor issue should count as progress, not regression. Tune the rule to allow a small net-positive threshold rather than requiring strict monotonic decrease, after seeing how real fix iterations behave.
- **Iteration cap**. The soft cap of 3 may be too low for content-heavy fix threads (where the fix requires re-reading source material) and too high for trivial typo fixes (where iteration 2 is already churning). Track actual iteration counts across early real runs and adjust per issue category rather than globally.

---

## Log output

Main Claude writes Phase 4 progress and findings to `<lesson_root>/lesson_build.log.md` as it goes. The Phase 4 header is:

- New mode: `## Phase 4 — Review`
- Update mode: `### Phase 4 — Review (update)` (nested under the `## Update YYYY-MM-DD (run-id: <short-hash>)` header)

Sub-sections under the Phase 4 header:

```
## Phase 4 — Review
- Code review findings: [count by severity, representative examples]
- Content review findings: [count by severity, representative examples]
- Test results: [17/17 PASS | X/17 with failing test ids]
- Visual QA findings per medium:
  - SVG: [specialists: pass/fail, findings]
  - Matplotlib: [specialists: pass/fail, findings]
  - Manim: [specialists: pass/fail, findings]
  - Interactive demos: [specialists: pass/fail, findings]
- Change-list sanity (update mode only): [pass/fail, mismatches]
- Playwright headed test: [pass/fail, captured issues]
- Fix loop iterations:
  - Iteration 1: [issues before, issues after, tests before, tests after, diff lines, self-assessment, stop rules fired]
  - Iteration 2: [...]
  - Iteration N: [...]
- Regression watch (update mode only): [entries]
- Local build verification:
  - build-all.sh: PASS | FAIL
  - Headless Playwright: PASS | FAIL

### UNRESOLVED
- [item, reason, progress-eval trace from the fix loop]
```

Unresolved items end up in the `### UNRESOLVED` block and are surfaced to the user in Phase 5's final report. Regression-watch entries (update mode) get their own explicit mention in the final report so the user can decide whether to merge the update or abort.

---

## Handoff to Phase 5

Phase 4 hands off to Phase 5 when **both** conditions hold:

1. Local build verification passed (`build-all.sh` clean AND headless Playwright check clean).
2. No fundamental-flaw halt fired inside the fix loop.

If either fails, Phase 4 does not hand off. The log captures the failure state, the final report surfaces the blocker to the user, and the branch (update mode) or working tree (new mode) is left in its current state so the user can inspect and either abort or resume manually.

If both conditions hold, Phase 5 proceeds to commit / merge / deploy. Unresolved items from the fix loop and any regression-watch entries (update mode) are passed forward to Phase 5 so they appear in the final report to the user alongside the deploy confirmation.

### What counts as "unresolved"

An issue is marked unresolved and forwarded to Phase 5 when it was present at the start of the fix loop, the fix loop made at least one attempt to address it, and one of the stop rules halted further attempts before the issue was cleared. Unresolved issues are never silently dropped — the final report always enumerates them with their progress-eval trace so the user can see exactly why the loop gave up. An issue that was fixed successfully within the loop is removed from the open list and does not appear in the final report.

### What halts the handoff entirely

- A **blocker** severity issue that the fix loop could not clear (e.g., T1 Babel parse still failing after 3 iterations). Shipping a lesson that does not parse is not an option.
- A **fundamental flaw** (the fix loop halted because the Phase 2 plan was wrong). This requires re-running Phase 2, not continuing to Phase 5.
- A **local build verification failure** (either `build-all.sh` or the headless Playwright check fails).

Major and minor unresolved issues do not halt the handoff by themselves; they are forwarded as known-issue flags. The judgment call of whether the lesson is good enough to ship with known majors belongs to the user, who sees them in the final report and can either approve the deploy or abort.
