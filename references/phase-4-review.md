# Phase 4: Review with progress-aware fix loop

Phase 4 is the quality gate. It catches what Phases 1-3 missed, decides whether fixes are worth attempting, and either produces a shippable artifact or halts with a diagnosable failure.

## Purpose

Run parallel reviews against the post-execution lesson (the JSX from Phase 3 plus every medium), compile findings into one issue list, drive a progress-aware fix loop, and gate on local build verification before Phase 5. Mode-agnostic in mechanism; two update rules layer on: **no-grandfathering** (visual-QA covers all final media, including `keep`) and **regression-watch** (halt a fix thread when a refine/replace regresses a previously-clean `keep` medium).

---

## Parallel reviews

Fire all reviews at once in a single message; do not serialize. Listing order within the parallel block (`code-review-agent`, `content-review-agent`, build+test, visual-QA teams, headed Playwright, change-list sanity Grep for update) is for readability/log order, not execution.

### 1. `code-review-agent`

Structural and syntactic review of the lesson JSX. Checks:

- **Template compliance**: `@core` imports present and correct (`Eq`, `M`, `P`, `Section`, `KeyConcept`, `CollapsibleBlock`, `RefImg`, `THEMES_G`, `MODELS`, `EFFORT_LEVELS`, `Chatbot` as needed). No inlined chat code.
- **KaTeX safety**: every `<Eq>` / `<M>` uses `{"..."}` with double-escaped backslashes; bare `<` / `>` replaced with `\\lt` / `\\gt`. Allowed: `\\leq`, `\\left`, `\\ll`, `\\lambda`.
- **Babel parse**: file parses cleanly with `@babel/parser` under `sourceType: module` with `jsx` plugin (duplicate of T1; runs first for fastest fail).
- **SVG markup**: every inline SVG has `viewBox`, closes all tags, and has unique marker IDs (no duplicate `id="ah"` from copy-paste).
- **Graph schema consistency**: `DEFAULT_GRAPH_PARAMS` and `GRAPH_SCHEMA` keys match exactly. Drift in either direction is a blocker.

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

Full list in `references/checklists.md` → "17-test suite summary". Each test is a one-liner pass/fail in `test_lesson.cjs`. Phase 4 runs the suite via `node test_lesson.cjs`; capture the full pass/fail breakdown and feed it into the compile step.

### 4. Visual-QA per medium

Specialist visual-QA teams spawned in parallel, one team per medium type present in the lesson. All teams within a team run in parallel too, so a lesson with 3 SVG graphs + 2 Matplotlib RefImgs + 1 Manim video fires 4+4+3 = 11 specialist spawns at once (three SVG teams of 4, two RefImg teams of 4, one Manim team of 3).

- **SVG**: `geometry-agent` (shapes and coordinates are correct) + `colour-agent` (uses the theme palette, not hardcoded hex; gold accent visible) + `readability-agent` (label size, label placement, no overlap, legible in both dark and light themes) + `scientific-accuracy-agent` (curve shape matches the underlying equation; the numerical spot-check lives in content-verification but scientific-accuracy is the sanity check that the shape is right).
- **Matplotlib RefImg**: `geometry-agent` + `colour-agent` + `scientific-accuracy-agent` + `readability-agent`. Same four dimensions as SVG. RefImg is a static PNG so there is no motion dimension, and the `.py` script that generated the PNG is the review target alongside the PNG itself.
- **Manim**: `motion-timing-agent` (animation pacing, transitions, hold durations appropriate for study use) + `colour-agent` + `scientific-accuracy-agent`. Geometry and readability fold into motion-timing for Manim because a static frame of a Manim video tells you less than a static frame of an SVG.
- **Interactive demos**: `interaction-agent` (controls work, slider ranges sensible, state updates correctly on input) + `readability-agent` + `scientific-accuracy-agent`.

Each specialist reviews against the **original stated intent** captured by the orchestrator, not the user's most recent concerns — otherwise refinements are graded on a shifting rubric. Main Claude's spawn brief includes the original intent string.

**Scope depends on mode**:

- **New mode**: every built medium runs through the full specialist team for its type.
- **Update mode (no-grandfathering)**: every medium in the post-update lesson — `keep`, `refine`, `replace`, `add` — runs through its full visual-QA team. Pre-existing drift gets no free pass. Without this, update reviews would be strictly weaker than new-mode reviews.

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

Fails loudly on declared-vs-actual mismatch. Content-review reasons about meaning; change-list sanity reasons about presence. Both matter.

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

The compiled list feeds the fix loop. Write it to the log under Phase 4 before attempting fixes so the baseline is recoverable if the loop is abandoned.

---

## Progress-aware fix loop

Combines hard metrics and LLM self-assessment. Principle: **iterate until quality, halt only on demonstrable regression or stall**. Under `resource_mode: "full"`, be patient. Under `"limited"`, tighten stop rules.

Fixes dispatched to the originating specialist: code → `code-review-agent` (with edit authority in Phase 4), SVG → `graphics-agent`, Manim → `manim-agent`, demos → `interactive-demo-agent`, content drift → `content-review-agent` (with edit authority). Main Claude dispatches; it does not fix directly.

### Metrics (hard signals per issue)

- **Issue count must decrease per iteration.** No strict decrease for a given thread = stall.
- **Test pass rate must increase per iteration.** No increase (or same tests fail twice) = stall on test-category issues.
- **Diff size** should shrink as the loop converges. Regrowing diffs = churning, not refining.
- **Iteration count**: a soft signal. Not a hard max — allow iteration 4 if metrics say it will converge; halt before iteration 3 if regression is already evident.

### LLM judgment (soft signal)

Each iteration the fix agent writes a one-line self-assessment: "improving", "stalled", "regressing", or "no meaningful progress". Main Claude reads it alongside metrics; it breaks ties when metrics are ambiguous, never halts alone.

### Stop rules

- **Metric stall**: metrics don't improve across 2 consecutive iterations on the same issue → log as unresolved, move on.
- **Self-assessment stall**: the fix agent reports "no meaningful progress" twice → log as unresolved, move on.
- **Fundamental flaw**: a test failing in a way that suggests the Phase 2 plan was wrong (e.g., T14 failing because the Lesson Plan asked for a topic id that collides with a reserved keyword; T16 failing because the plan omitted the Chatbot entirely) → halt the fix loop, do not attempt further iterations, surface to user for an abort decision. Fundamental flaws must not be patched in Phase 4; they require going back to Phase 2.
- **Update mode only — regression-watch**: if a refine/replace fix iteration regresses a previously-clean `keep` medium (a visual-QA specialist that previously passed now fails on an untouched medium), halt that specific fix thread, log the event as a `regression-watch` entry, and surface it at Phase 5. Do not try to re-fix the regressed `keep` medium inside this fix loop — the signal is that the refine/replace touched a shared helper or shared style, and the correct response is to let the user inspect the scope of the collateral damage before merging.

### Iteration trace

Each iteration is logged with: issues-before count, issues-after count, test pass rate before and after, diff size (lines added/removed), LLM self-assessment one-liner, and which stop rules fired (if any). This trace is the record that the loop halted legitimately, not by accident.

### Worked example

A lesson enters Phase 4 with 6 issues: 2 blockers (T2 KaTeX `<`, T14 TOPIC_CONTEXT mismatch), 3 majors (off-axis label on graph 2, missing variable definition, theme-toggle console error), 1 minor (missing `finally` in `sendMessage`).

- **Iteration 1**: fix agent addresses all 6. Diff 42 lines. Re-review: 2 blockers resolved, moved label now overlaps curve (new major), variable added, console error still present, `finally` added. Count 6→3. Tests 15/17→17/17. "improving".
- **Iteration 2**: repositions label with fixed offset, traces console error to stale `THEMES_G` import. Diff 18 lines (shrinking). Count 3→0. "improving". Loop closes.

Counter-example that halts: iteration 1 fixes 1 issue, introduces 2, diff 80 lines. Iteration 2 fixes 1, introduces 1, diff 95 lines. Count 6→7→7 (no decrease), diff growing. "stalled" then "no meaningful progress". Stop rule fires, 4 unresolved.

---

## Local build verification (Phase 5 gate)

Runs at end of Phase 4 after the fix loop settles. Phase 5 cannot bypass this. Catches build breaks the dev server and test suite miss — issues that only surface under `vite build` (unresolved imports at build time, missing public assets, production-only code paths).

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

On failure, halt before Phase 5 commit/merge. Surface the failing command, log excerpt, and current branch state. No automatic fixes — a build failure that survived 17 tests and the fix loop needs informed intervention, not blind patching. Return to Phase 4 with the new info, or Phase 2 if structural, or surface to the user.

`build-all.sh` builds the whole workspace because a `_lesson-core/` change can break any lesson importing from `@core`. Full build catches cross-lesson regressions. If Phase 3 only touched per-lesson files, a scoped build of `<lesson_root>` is acceptable; full build remains the default.

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

An issue is unresolved if the fix loop attempted it but a stop rule halted further attempts before it cleared. Unresolved issues are never silently dropped — the final report enumerates them with their progress-eval trace.

### What halts the handoff entirely

- **Blocker** the fix loop could not clear (e.g., T1 Babel still failing).
- **Fundamental flaw** (Phase 2 plan was wrong — re-run Phase 2, not continue).
- **Local build verification failure** (`build-all.sh` or headless Playwright).

Major/minor unresolved issues forward as known-issue flags; the user decides at the final report whether to ship or abort.
