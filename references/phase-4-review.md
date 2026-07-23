# Phase 4: Review with progress-aware fix loop

Contents: Parallel reviews (7 reviewers) · Compile findings · Progress-aware fix loop (metrics, stop rules, trace) · Local build verification · Log output · Handoff to Phase 5.

Phase 4 is the quality gate of the lesson-builder pipeline. Everything before it is constructive (research, planning, execution); everything after it is deployment. Phase 4's job is to catch what Phases 1-3 missed, decide whether fixes are worth attempting, and either produce a shippable artifact or halt cleanly with a diagnosable failure state.

## Purpose

Phase 4 runs a battery of parallel reviews against the post-execution lesson (the JSX assembled in Phase 3 plus every medium built by the specialists), compiles the findings into a single issue list, drives a progress-aware fix loop that halts cleanly instead of churning, and gates on a local build verification step before Phase 5 is permitted to deploy. The mechanism itself is mode-agnostic: new-mode and update-mode builds share the same reviewers, the same compile step, and the same fix loop shell. Two update-mode-specific rules layer on top — the **no-grandfathering** rule expands visual-QA coverage to every medium in the post-update lesson (not just the ones that changed), and the **regression-watch** rule halts a fix thread the moment a refine/replace iteration breaks a previously-clean `keep` medium.

---

## Parallel reviews

Main Claude fires all of these at once in a single parallel batch. Do not serialize — the goal is the complete picture of what is wrong in one pass, then fix once, rather than discovering problems drip by drip. (Fix priority is a different matter: deterministic failures get fixed first — see the fix loop.)

**Prerequisites before the batch** (fresh lessons especially): `npm install` in the lesson root, then start the proxy (`node server/proxy.js`) and Vite (`npx vite`) and confirm both respond — the Playwright and interaction reviewers fail spuriously against a server that isn't up. Reuse already-running instances when the lesson was launched earlier in the session.

### 1. `code-review-agent`

Structural and syntactic review of the lesson JSX. Checks:

- **Template compliance**: `@core` imports are present and correct (`Eq`, `M`, `P`, `Section`, `KeyConcept`, `CollapsibleBlock`, `RefImg`, `THEMES_G`, `MODELS`, `EFFORT_LEVELS`, `Chatbot` as needed). No inlined chat code — the lesson must delegate to the shared `<Chatbot>` component rather than duplicating `ChatBubble`, `ThreadPanel`, `sendMessage`, etc. This matters because lessons share chat infrastructure through `_lesson-core/`, and any lesson that re-inlines chat code will drift away from bug fixes and feature additions made in `_lesson-core/chat/`.
- **KaTeX safety**: every `<Eq>` and `<M>` uses `{"..."}` with double-escaped backslashes, and bare `<` / `>` inside KaTeX strings are replaced with `\\lt` / `\\gt`. Legitimate escapes (`\\leq`, `\\left`, `\\ll`, `\\lambda`) are allowed. The rationale is that KaTeX strings get parsed as JSX string expressions first, so a bare `<` inside a `{"..."}` body either breaks parsing or renders as an HTML tag.
- **Babel parse**: the file parses cleanly with `@babel/parser` under `sourceType: module` with the `jsx` plugin. This is the same check as T1 below, duplicated here because `code-review-agent` runs before `node test_lesson.cjs` and the fastest fail is the one that short-circuits everything else.
- **SVG markup validation**: every inline SVG has a `viewBox`, closes all tags, and has unique marker IDs across the file (no duplicate `id="ah"` from copy-pasted arrow markers). Duplicate marker IDs cause the second occurrence to inherit the first's styling, which silently breaks arrowheads on the second graph.
- **Graph schema consistency**: the keys in `DEFAULT_GRAPH_PARAMS` match the keys in `GRAPH_SCHEMA` exactly (required by the chatbot edit-graph feature; a drift here breaks self-editing). Drift in either direction is a blocker: a missing `GRAPH_SCHEMA` entry means the chatbot has no schema to reason about; a missing `DEFAULT_GRAPH_PARAMS` entry means an edit-graph instruction has no initial value to diff against.

Returns a list of issues tagged by severity and line number. Does not attempt fixes; fixes happen in the fix loop below.

**Spawn brief template** (main Claude passes this to `code-review-agent`; its return shape `{ ok, blockers, majors, minors }` is defined in the agent file):

```
lesson_path: <absolute path to src/<slug>.jsx>
mode: new | update
change_list: <Phase 2 change-list if update mode, else null>
checks_required: [template_compliance, katex_safety, babel_parse, svg_markup, graph_schema]
```

### 2. `content-review-agent`

Pedagogical review against the Lesson Plan, the compiled content package from Phase 1, and the original source materials. Two shapes depending on mode:

- **New mode**: review content for accuracy, clarity, and alignment with the scope agreed in Phase 0. Flag hallucinated equations, missing caveats, wrong constants, missing variable definitions, or drift between what the Lesson Plan promised and what the JSX actually teaches.
- **Update mode**: review against the Phase 2 change-list specifically. The change-list is the contract; this reviewer's job is to catch drift between what the user approved and what landed in the JSX. If the change-list says "replace the Shockley diode derivation with the piecewise-linear model", this reviewer confirms the piecewise-linear model is now present AND the old Shockley derivation is actually gone. Drift in either direction is flagged.

### 3. Build + test

Runs from the lesson root:

```bash
cd "<lesson_root>"
npm install
node test_lesson.cjs
```

`test_lesson.cjs` executes the 17-test suite defined below. Capture the full pass/fail breakdown and feed it into the compile-findings step as another reviewer.

#### The 17-test suite

The canonical executable ships at `references/bootstrap/lesson-template/test_lesson.cjs` and is copied into each lesson root at scaffold time. The test-by-test summary (T1 Babel parse … T17 no direct API) lives in `references/checklists.md` § "17-test suite summary" — the code is the source of truth; do not re-derive test semantics from prose.

### 4. Visual-QA per artifact

Two reviewers per artifact, spawned in parallel, chosen for **independent failure modes** rather than per-dimension headcount (same-model per-dimension panels produce correlated verdicts; one reviewer scoring a full rubric is more consistent — and cheaper):

- **`visual-qa-agent`** — one spawn per artifact, scoring the full presentation rubric (geometry, colour/theme, readability, and motion for video via keyframes + ffprobe). Returns per-dimension verdicts plus findings with confidence.
- **`scientific-accuracy-agent`** — one spawn per artifact with scientific content: does the visual depict the physics/math it claims (signs, shapes, proportions, plausible values)? Independent lens with web-verification when unsure.
- **Interactive demos additionally get `interaction-agent`** — drives the running demo via Playwright: controls respond, extremes behave, keyboard reachability. Its spawn brief must include the dev-server URL (+ tab), the control list from the demo's wiring, and the expected behavior per control — it cannot discover these itself.
- **Static images (web-sourced)** are artifacts too: `visual-qa-agent` (readability/colour as applicable) plus `scientific-accuracy-agent` when the image carries scientific content (a spectrum, a micrograph scale bar); provenance/license is re-checked against the log, not re-derived.

So a lesson with 3 SVG graphs + 2 RefImgs + 1 manim video fires 12 QA spawns (6 visual-qa + 6 scientific-accuracy), all in the same parallel batch.

Each reviewer judges its artifact against the **original stated intent** as captured by the orchestrator, not against the user's most recent concerns. A refined graph must be evaluated against what the graph was always supposed to show, otherwise refinements get graded on a shifting rubric. Main Claude's spawn brief must include the original intent string, not the update user-concerns string.

**Scope depends on mode**:

- **New mode**: every built medium runs through the full specialist team for its type.
- **Update mode (no-grandfathering)**: every medium in the post-update lesson — `keep`, `refine`, `replace`, `add` — runs through its full visual-QA team. Pre-existing drift does not get a free pass. Rationale: the user decided once (by approving the Lesson Plan at the Phase 2 gate); visual-QA then covers all final media equally so the lesson that ships matches the plan that was approved. Skipping `keep` media would make update-mode reviews strictly weaker than new-mode reviews, and the user would have no way to know when they shipped a lesson whose unchanged media silently fails a quality dimension that would have blocked a new build.

**Spawn brief template** (main Claude passes this to each specialist):

```
medium_type: svg | matplotlib | manim | interactive_demo | static_image
artifact_path: <component name inside JSX | .py path | .mp4 path | image path | demo component name>
media_id: <from the plan>
original_intent: <the plan row's original_intent>
mode: new | update
update_action: keep | refine | replace | add   (update mode only)
previous_verdict: <specialist verdict from prior review if any, else null>
```

### 5. Headed Playwright testing via `@playwright/mcp`

Main Claude spawns a headed browser session against the lesson's running dev server and drives a short interaction script. This is the only reviewer that exercises the runtime behavior of the lesson end to end, so it catches issues that are invisible to static analysis: stale closures, uncaught promise rejections, theme transitions that leave orphan styles, chatbot SSE streams that open but never produce tokens.

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

### 7. Pedagogy gate (backward-design check)

Runs in the same parallel fire (folded into `content-review-agent`'s brief, or as its own light check — it reasons about the assembled JSX against the Phase 2 objective skeleton). This is the reviewer-side enforcement of the backward design established in `references/phase-2-plan.md`: it confirms the lesson actually teaches the way the plan promised, not merely that the content is accurate.

Checks, per topic:

- **Every objective is assessed.** Each topic objective (the observable verb-on-content from the Phase 2 plan) maps to at least one active check present in the JSX. An objective with no aligned check is a **blocker**-adjacent alignment failure — the topic teaches toward a goal it never lets the learner demonstrate. Verb-level alignment matters: the check must exercise the same cognitive verb as the objective (an objective to *derive* is not satisfied by a *recall*-only check).
- **At least one retrieval / active-practice primitive per topic.** Confirm each topic has at least one retrieval-first or active-practice element — a prediction-before-reveal, a recall prompt, a worked-then-faded example, a self-check — not pure exposition. A topic that is read-only (prose + static figure, no check) fails this gate.
- **At least one transfer item across the topic's checks**, tagged distinctly from recall. A topic whose only checks parrot back what was just shown fails the transfer requirement.
- **Misconception refutation where one is declared.** If the Phase 2 plan / `TOPIC_CONTEXT` names a known misconception for the topic, the inline copy or a check must state it, mark it false, and give the causal reason — a bare correct statement does not refute.
- **No myth in the shipped copy.** The lesson copy and tutor steering contain none of the `SKILL.md` "Do NOT build these" items — no learning-styles routing, Dale's-cone "remember X%", 2-sigma promise, gamification (points / badges / leaderboards), or Hattie-rank/effect-size badge. This is a cheap text scan mirroring the SaaS `myth-lint.ts`; treat a hit as a major (copy fix), and never resolve it by reintroducing the myth.

Severity: an objective with no assessment, or a topic with no retrieval/active-practice primitive, is a **major** (the lesson is structurally passive — fix by adding the missing check, not by deleting the objective). A missing transfer item or unrefuted declared-misconception is a **major** in new mode, a **minor** in a `keep`-only update topic. A myth hit is a **major** copy fix. These are pedagogy-quality majors: they do not halt the handoff by themselves (per the major/minor handoff rule below), but under `resource_mode: "full"` the fix loop should clear them rather than forward them — a passive lesson is the failure mode this whole change exists to prevent.

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
  confidence: <0.0-1.0; 1.0 for deterministic sources (tests, build, parse)>,
  medium: "code" | "svg" | "matplotlib" | "manim" | "demo" | "content" | "changelist",
  source_reviewer: "code-review-agent" | "content-review-agent" | "T<N>" | "visual-qa-agent" | "scientific-accuracy-agent" | "interaction-agent" | "playwright" | "changelist-sanity" | "pedagogy-gate",
  location: <file:line or component name or asset path>,
  description: <what is wrong>,
  fix_hint: <optional pointer to the likely fix>,
  iterations_attempted: 0,
  history: []
}
```

**Normalization** — reviewers return different shapes; map them into issue records like this, inventing nothing:

| Source | Mapping |
|---|---|
| `code-review-agent` | each entry in `blockers`/`majors`/`minors` → one record at that severity; confidence 1.0 for grep/parse-backed items, else 0.8 |
| `content-review-agent` | issues carry severity + confidence already; location = its `location` |
| 17-test suite / build / Babel | one record per failing test, severity blocker, confidence 1.0, location = test id + file |
| `visual-qa-agent` | each `findings[]` entry → severity `fail`→major, `issue`→minor; location = artifact + its `location` field |
| `scientific-accuracy-agent` | verdict `fail` → one major (confidence 0.9), `issue` → one minor (0.7); location = artifact; details = description |
| `interaction-agent` | verdict `fail` → one major per broken control named in details (confidence 0.9); `issue` → minor; `unavailable` → no record, log coverage gap |
| Playwright headed script | each console error / broken render → major, confidence 1.0, location = step + URL |

The compiled issue list is the input to the fix loop. It is also written to the log under the Phase 4 section before any fixes are attempted, so the starting state is recoverable if the fix loop has to be abandoned. Writing the baseline to the log first is a deliberate choice: if the fix loop crashes or the user ctrl-Cs, the baseline is already persisted and the next run has a starting point.

---

## Progress-aware fix loop

The loop combines hard metric signals and LLM self-assessment. The guiding principle is **bias toward stopping early** over churning. A fix loop that burns iterations without converging is worse than logging a known issue and moving on, because churning risks regressing already-correct work.

**Who fixes what** — the producer fixes its own artifact; reviewers never edit (they have no edit tools by design, so re-review is not self-grading):

- Media issues → the producing specialist respawned **using its refine contract**, with the mode fields its prompt branches on set explicitly: `mode: "update"`, `action: "refine"`, same `media_id` and identifiers, `refine_brief` = the finding + the original intent; outputs land at the same scratch/on-disk paths as a normal refine and main Claude re-splices exactly as in Phase 3. A fix spawn is just a refine whose brief is a finding.
- **Exception — `keep` media (update mode)**: the approved plan says these stay untouched, so findings on them are NOT auto-fixed. Log as known-issues and surface in the final report with a suggested follow-up (convert to `refine` in a new run); only a blocker-severity finding on a `keep` medium reopens the Phase 2 gate instead.
- Code and content issues → **main Claude applies the fix directly** (it assembled the file and holds full context), guided by the reviewer's issue list and `suggested_fix` directions.
- After a fix iteration, the affected reviewers re-run fresh on the changed artifacts — "affected" includes any medium that shares a helper, component, or style with the changed code, not just the artifact named in the finding.

**Fix ordering**: deterministic failures first — Babel parse, the 17-test suite, build errors — because they are unambiguous and other findings may be their symptoms. LLM-reviewer findings follow, by severity. Findings with confidence < ~0.4 and severity `minor` are logged as known-issues rather than fixed: reviewer noise below that bar churns the loop for no quality gain.

### Metrics (hard signals per issue)

- **Issue count must decrease per iteration.** If the total number of open issues does not strictly decrease from iteration N to N+1 for a given issue thread, that is a stall.
- **Test pass rate must increase per iteration.** If the 17-test pass count does not increase (or the same tests fail twice), that is a stall on test-category issues.
- **Diff size per fix.** The diff applied by the fix iteration should shrink as the loop converges (each fix gets more surgical). A re-growing diff is a signal of churning — the fix agent is rewriting, not refining.
- **Iteration count.** Soft cap at 3 iterations — an input signal, not a hard max: if metrics say "iteration 4 would converge", allow it; if iteration 2 is already regressing, halt before 3. Absolute cap at 6 iterations regardless of metrics; a loop that needs more is telling you the plan or the brief is wrong.

### LLM judgment (soft signal)

At the end of each iteration the fix agent writes a one-line self-assessment: "improving", "stalled", "regressing", or "no meaningful progress". Main Claude reads it alongside the metrics. The LLM signal is never the sole reason to halt, but it breaks ties when metrics are ambiguous.

### Stop rules

- **Metric stall**: metrics don't improve across 2 consecutive iterations on the same issue → log as unresolved, move on.
- **Self-assessment stall**: the fix agent reports "no meaningful progress" twice → log as unresolved, move on.
- **Fundamental flaw**: a test failing in a way that suggests the Phase 2 plan was wrong (e.g., T14 failing because the Lesson Plan asked for a topic id that collides with a reserved keyword; T16 failing because the plan omitted the Chatbot entirely) → halt the fix loop, do not attempt further iterations, surface to user for an abort decision. Fundamental flaws must not be patched in Phase 4; they require going back to Phase 2.
- **Update mode only — regression-watch**: if a refine/replace fix iteration regresses a previously-clean `keep` medium (a reviewer that previously passed now fails on an untouched medium) **twice consecutively on the same medium** (single occurrences are treated as reviewer noise — see Tuning), halt that specific fix thread, log the event as a `regression-watch` entry, and surface it at Phase 5. Do not try to re-fix the regressed `keep` medium inside this fix loop — the signal is that the refine/replace touched a shared helper or shared style, and the correct response is to let the user inspect the scope of the collateral damage before merging.

### Iteration trace

Each iteration is logged with: issues-before count, issues-after count, test pass rate before and after, diff size (lines added/removed), LLM self-assessment one-liner, and which stop rules fired (if any). This trace is the record that the loop halted legitimately, not by accident.

### Worked example

A lesson enters Phase 4 with 6 issues: 2 blockers (T2 KaTeX bare `<` on two lines, T14 TOPIC_CONTEXT key mismatch), 3 majors (visual-qa-agent reports an off-axis label on graph 2, content-review-agent reports a missing variable definition, Playwright reports a console error on theme toggle), 1 minor (checklist: missing `finally` block in `sendMessage`).

- **Iteration 1**. Fix agent addresses all 6 in one pass. Diff is 42 lines. Post-iteration re-review: 2 blockers resolved, graph-2 label moved but visual-qa now flags the moved label as overlapping the curve, content variable definition added, Playwright console error still present (theme toggle unhandled), `finally` block added. New issue count: 3 (1 fresh major from the label move, 2 carried over). Test pass rate: 15/17 → 17/17. Self-assessment: "improving". Continue.
- **Iteration 2**. Fix agent targets the 3 remaining: repositions the label with a fixed offset, traces the theme-toggle console error to a stale `THEMES_G` import. Diff is 18 lines (shrinking — good sign). Post-iteration: 0 issues. Test pass rate: 17/17. Self-assessment: "improving". Loop closes cleanly.
- **Logged**: 2 iterations, both improving, no stop rules fired, 6 → 0 issues.

A counter-example that halts: same starting state, but iteration 1 fixes only 1 issue and introduces 2 new ones. Diff is 80 lines (larger than needed). Iteration 2 fixes 1 more but introduces 1 new. Diff is 95 lines (growing). Metrics: issue count 6 → 7 → 7 (no strict decrease), diff growing. Self-assessment: "stalled" then "no meaningful progress". Stop rule fires at end of iteration 2, 4 issues logged as unresolved, loop terminates.

---

## Local build verification (Phase 5 gate)

Runs at the very end of Phase 4, after the fix loop has settled. This is the gate that Phase 5 cannot bypass. The purpose is to catch build breaks that the per-lesson dev server and test suite miss — mainly issues that only surface under `vite build` (unresolved imports at build time, missing public assets, production-only code paths) and that would otherwise fail in the host's build after the commit lands.

```bash
cd <workspace_root>
bash build-all.sh
```

The workspace's `build-all.sh` runs `npm install` plus `npx vite build --base="/<course>/<slug>/"` per lesson and copies each lesson's `dist/` into the root `dist/<course>/<slug>/`. Full build time depends on lesson count; single-lesson builds are fast.

After the build completes, run a **headless Playwright check** of the built artifact:

- Serve `<workspace_root>/dist/` from a small local static server on an ephemeral port and load `http://localhost:<port>/<course>/<slug>/`. Never use `file://` — the build's `base="/<course>/<slug>/"` makes asset URLs absolute, so under `file://` they resolve against the filesystem root and the page loads blank, failing a valid deploy.
- Confirm KaTeX loads (no "Failed to load KaTeX" console errors, rendered equations have `.katex` class elements).
- Confirm every tab button is clickable and each tab renders without console errors.
- Confirm no unhandled promise rejections or failed fetches in the console.

**Update mode note**: in update mode the build runs against the current branch (the update branch created in Phase 3, typically `lesson-update/<slug>-YYYYMMDD`). Do not switch to `main` before the build — that would build the wrong code and invalidate the verification.

If either `build-all.sh` or the headless Playwright check fails, halt before the Phase 5 commit/merge and do not patch blind. The build error is new deterministic information: **one formal loop re-entry is permitted** — feed the build error into the compile-findings step as a blocker and re-enter the fix loop under the same absolute iteration cap (iterations already spent count). If the re-entry doesn't clear it, or the error suggests the Phase 2 plan is structurally wrong, surface the failure to the user with the failing command, the relevant log excerpt, and the current branch state, for a return-to-Phase-2 or abort decision.

Note that the full `build-all.sh` builds every lesson in the workspace, not just the one under review. This is deliberate: a change in `_lesson-core/` can break any lesson importing from `@core`, so the full build is the only way to catch cross-lesson regressions introduced by a change to the shared core. If Phase 3 only touched per-lesson files (no `_lesson-core/` edits), a scoped build targeting only `<lesson_root>` is acceptable as an optimization, but the full build remains the default.

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
  - SVG: [visual-qa + scientific-accuracy verdicts, findings]
  - Matplotlib: [visual-qa + scientific-accuracy verdicts, findings]
  - Manim: [visual-qa (motion dimension) + scientific-accuracy verdicts, findings]
  - Interactive demos: [interaction + visual-qa + scientific-accuracy verdicts, findings]
- Change-list sanity (update mode only): [pass/fail, mismatches]
- Pedagogy gate: [per-topic: objectives-assessed pass/fail, retrieval/active-practice present, transfer item present, misconception refuted, myth scan clean]
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

Unresolved = **every issue still open when Phase 4 exits**, whatever its origin: fix-loop attempts halted by a stop rule, low-confidence minors that were deliberately never attempted, `keep`-media findings excluded from auto-fix, regressions that appeared after the baseline, and coverage gaps (e.g. `interaction-agent` unavailable). Each entry records its origin and either its progress-eval trace or the reason no attempt was made. Nothing open is silently dropped — the final report enumerates all of it. An issue fixed within the loop is removed from the open list and does not appear.

### What halts the handoff entirely

- A **blocker** severity issue that the fix loop could not clear (e.g., T1 Babel parse still failing after 3 iterations). Shipping a lesson that does not parse is not an option.
- A **fundamental flaw** (the fix loop halted because the Phase 2 plan was wrong). This requires re-running Phase 2, not continuing to Phase 5.
- A **local build verification failure** (either `build-all.sh` or the headless Playwright check fails).

Major and minor unresolved issues do not halt the handoff by themselves; they are forwarded as known-issue flags. The judgment call of whether the lesson is good enough to ship with known majors belongs to the user, who sees them in the final report and can either approve the deploy or abort.
