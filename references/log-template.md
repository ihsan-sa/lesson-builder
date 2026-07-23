# Log template — `lesson_build.log.md`

Reference for main Claude when writing the per-lesson build trail during lesson-builder runs.

**Pipeline-v2 fields (2026-07)** — the skeletons below predate several fields that later phases now READ BACK from the log; whenever the phase docs name them, record them even though the older skeletons don't show a slot:

- Phase 0: the full scoping artifact incl. `lesson_file`, `course_name`; update mode: `stashed: stash@{0} (<oid>)` with the stash OID and the branch the stash was taken on.
- Phase 2: `Approval: PENDING → APPROVED/ABORTED by user at <timestamp>` in BOTH modes; per-media `media_id` + `original_intent` in the plan (incl. `keep` rows); per-topic `objectives:` blocks.
- Phase 3: `Branch:` (actual name incl. any collision suffix — Phase 5 consumes it verbatim) and `Base SHA:`.
- Phase 4: the unresolved list covers EVERY open issue at exit with origin + attempted/no-attempt reason (incl. never-attempted low-confidence minors, keep-media findings, coverage gaps).
- Phase 5: `deploy_code` (from the build-all inventory), stash recovery outcome by OID.

## Purpose

`lesson_build.log.md` lives in the lesson root at `<course>/claude_lessons/<slug>/lesson_build.log.md`. Main Claude writes to it throughout every run. New-mode runs create it; update-mode runs append to it. It is the canonical build/update trail for a lesson and is surfaced to the user at the end of each run. The log persists across runs, so a lesson that has been built once and updated three times will have four stacked sections in the same file: one original build and three updates.

## File location

Path pattern:

```
<workspace_root>/<course>/claude_lessons/<slug>/lesson_build.log.md
```

This is per-lesson, not global. There is no shared log across lessons. Examples:

- `<workspace_root>/MATH101/claude_lessons/intro-derivatives/lesson_build.log.md`
- `<workspace_root>/PHYS102/claude_lessons/standing-waves/lesson_build.log.md`
- `<workspace_root>/CS135/claude_lessons/binary-trees/lesson_build.log.md`

## Ownership

Main Claude owns this file. Subagents and specialists do not write to it directly. They return findings, diffs, test results, and QA reports to main Claude, and main Claude logs them. This keeps the log coherent (single writer, single voice, consistent formatting) and avoids concurrent-write races when multiple agents run in parallel.

## New-mode skeleton

```markdown
# Lesson Build Log — <course> / <slug>
Started: <timestamp>
Skill: lesson-builder v<...>

## Phase 0 — Scoping
- Detected mode: new
- User answers: [...]
- Derived scope: [...]

## Phase 1 — Content Analysis
- Resources analyzed: [...]
- Research rounds: [...]
- Gap-fill rounds: [...]
- Compiled package summary: [...]

## Phase 2 — Plan
- Plan artifact: [...]
- Approval: APPROVED by user at <timestamp>

## Phase 3 — Execution
- Specialists spawned: [...]
- Files written: [...]

## Phase 4 — Review
- Code review findings: [...]
- Content review findings: [...]
- Test results: [...]
- Visual QA findings per medium: [...]
- Fix loop iterations: [...]

### UNRESOLVED
- [item, reason, progress-eval trace]

## Phase 5 — Deploy
- Build verification: [...]
- Commit SHA: [...]
- Deploy dashboard URL: [...]

## Final Report to User
[items from UNRESOLVED]
```

## Update-mode append format

```markdown
## Update YYYY-MM-DD (run-id: <short-hash>)

### Phase 0 — Scoping (update)
Detected mode: update (candidate: <path>)
Mode confirmed: YES
Working tree state: clean | stashed: <stash-ref>
Research depth: light | targeted | full
Scope of change: ...
Media hints: ...

### Phase 1 — Content Analysis (update)
Research mode: ...
Change-list summary: { topics_kept, modified, added, removed, reordered; media: { keep, refine, replace, remove, add } }
Drift incidents: [...]

### Phase 2 — Plan (update)
Change-list view: [...]
Full Lesson Plan: [...]
Approval: APPROVED by user at <timestamp>

### Phase 3 — Execution (update)
Branch: lesson-update/<slug>-YYYYMMDD
Stash ref: <ref or "none">
Specialists spawned: [...]
Splice counts: refine=N, replace=M, remove=P, add=Q
Orphan cleanup: removed=R, kept=K (or "none" if orphan list was empty)
GRAPH_SCHEMA backfill: performed | not needed

### Phase 4 — Review (update)
Code review findings, content review findings, test results, visual-QA per medium, fix loop iterations.
Regression watch: [...]

### Phase 5 — Deploy (update)
Build verification: PASS | FAIL
Merge commit SHA: <sha>
Stash recovery: auto-popped | manual | none

### Final Report
[items]
```

## Append rules (update mode)

- Before Phase 0 begins, main Claude reads `<lesson_root>/lesson_build.log.md`. If it exists and is non-empty, append a new `## Update YYYY-MM-DD (run-id: <hash>)` section at the end of the file.
- If the file does not exist (the lesson was built before lesson-builder existed, or was hand-written), create it fresh with:
  ```markdown
  # Lesson Build Log — <course> / <slug>
  Started: <timestamp> (first recorded update; lesson pre-existed)
  Skill: lesson-builder v<version>
  ```
  Then begin the update append immediately below.
- Never overwrite existing content. Never collapse or rewrite previous `## Phase 0`, `## Phase 1`, ... headers from prior runs. Each update gets its own top-level `## Update YYYY-MM-DD` prefix, with nested `### Phase N — <name> (update)` headers underneath.
- **Multiple updates in one day**: disambiguate by `run-id: <short-hash>` in the update header line. Suggested hash: first 6 characters of a SHA-256 hash of (timestamp + user message that triggered the run). Example: `## Update 2026-04-15 (run-id: a3f7b2)`.

## Log-writing conventions

- Use ISO timestamps: `YYYY-MM-DDTHH:MM:SSZ` (UTC) or local equivalent with offset (`YYYY-MM-DDTHH:MM:SS-04:00`).
- Keep entries concise but informative. One line per event is fine; multi-line is appropriate for structured data (change-lists, Lesson Plans, file lists).
- Agent findings go in bulleted lists under the relevant phase heading. Attribute findings to the agent that produced them when useful (e.g., `- [code-reviewer] unused import in src/<slug>.jsx:14`).
- For long artifacts (full Lesson Plans, large change-lists, compiled research packages), embed them inline in the log. This is the source of truth for the build trail, so do not truncate. If an artifact is exceptionally long (thousands of lines), link to a sibling file under the lesson root and note the path in the log.
- Errors and unresolved items go in a clearly-marked subsection (`### UNRESOLVED` in new mode, `Regression watch: [...]` in update mode) so they are easy to surface at the end of the run.

## Surfacing to the user

- At the end of Phase 5, main Claude reads the `### UNRESOLVED`, `Regression watch`, and `Final Report` sections from the log and composes the user-facing final report.
- The full log file stays on disk. The user can read it at any time for the complete build trail.
- The final report shown in the chat is brief (20-50 lines): deploy confirmation, commit SHA, deploy dashboard URL, and any unresolved or regression items. The log file is the full audit trail.

## Worked example

A condensed example log for a fictional `MATH101/claude_lessons/intro-derivatives` lesson after one new-mode build plus one update run. Path:

```
<workspace_root>/MATH101/claude_lessons/intro-derivatives/lesson_build.log.md
```

```markdown
# Lesson Build Log — MATH 101 / intro-derivatives
Started: 2026-04-10T09:12:33-04:00
Skill: lesson-builder v0.1.0

## Phase 0 — Scoping
- Detected mode: new
- User answers: audience=first-year calculus students; depth=intro+intermediate; resources=[course notes PDF, textbook ch.2]; media=[SVG graphs, 1 manim animation]
- Derived scope: 5 topics covering limits and the difference quotient, the derivative at a point, the derivative as a function, product/quotient rules, chain rule basics

## Phase 1 — Content Analysis
- Resources analyzed: derivatives-notes.pdf (42 pages), Stewart, Calculus ch.2 (pp. 105-172)
- Research rounds: 2 (initial sweep + gap-fill on tangent-line intuition)
- Gap-fill rounds: 1
- Compiled package summary: limit definition, secant vs tangent distinction, 5 differentiation rules, 3 worked examples, 2 graph specs, 1 animation spec (secant-to-tangent limit)

## Phase 2 — Plan
- Plan artifact: embedded below
  - Topic 1: Limits and the difference quotient
  - Topic 2: The derivative at a point (derivation + worked example)
  - Topic 3: The derivative as a function (derivation + worked example)
  - Topic 4: Product and quotient rules
  - Topic 5: Chain rule basics
- Approval: APPROVED by user at 2026-04-10T09:34:17-04:00

## Phase 3 — Execution
- Specialists spawned: jsx-writer, katex-writer, svg-graph-builder (x2), manim-animator
- Files written:
  - src/intro-derivatives.jsx
  - src/main.jsx
  - vite.config.js
  - server/proxy.js
  - index.html
  - package.json
  - test_lesson.cjs
  - public/videos/secant-to-tangent.mp4

## Phase 4 — Review
- Code review findings: 2 unused imports, 1 missing @core alias usage (fixed)
- Content review findings: topic 3 derivation missing explicit limit step (fixed)
- Test results: 17/17 PASS on iteration 2
- Visual QA findings per medium:
  - SVG graphs: tangent-slope plot x-axis label clipped (fixed)
  - Manim animation: PASS on first check
- Fix loop iterations: 2

### UNRESOLVED
- (none)

## Phase 5 — Deploy
- Build verification: PASS (build-all.sh, 2m 51s)
- Commit SHA: 7e4b9a2
- Deploy dashboard URL: <deploy dashboard URL>/deploys/<id>

## Final Report to User
- Lesson deployed to <live URL>/MATH101/intro-derivatives/
- 5 topics, 2 SVG graphs, 1 manim animation
- No unresolved items

## Update 2026-04-15 (run-id: a3f7b2)

### Phase 0 — Scoping (update)
Detected mode: update (candidate: <workspace_root>/MATH101/claude_lessons/intro-derivatives)
Mode confirmed: YES
Working tree state: clean
Research depth: targeted
Scope of change: add implicit differentiation as a 6th topic; refine topic 5 (chain rule) to set up the new topic
Media hints: 1 new SVG graph for an implicitly-defined curve and its tangent line

### Phase 1 — Content Analysis (update)
Research mode: targeted (Stewart, Calculus section 3.5, supplementary course notes)
Change-list summary: { topics_kept: [1,2,3,4], modified: [5], added: [6], removed: [], reordered: no; media: { keep: 2, refine: 0, replace: 0, remove: 0, add: 1 } }
Drift incidents: none

### Phase 2 — Plan (update)
Change-list view:
  - Topic 5 (chain rule): expand closing paragraph to motivate curves not given as explicit y = f(x)
  - Topic 6 (NEW): Implicit differentiation — differentiate both sides, isolate dy/dx, tangent-to-a-circle worked example
Full Lesson Plan: embedded below (6 topics total, abbreviated for brevity)
Approval: APPROVED by user at 2026-04-15T14:02:08-04:00

### Phase 3 — Execution (update)
Branch: lesson-update/intro-derivatives-20260415
Stash ref: none
Specialists spawned: jsx-writer, katex-writer, svg-graph-builder
Splice counts: refine=1, replace=0, remove=0, add=1
Orphan cleanup: none (orphan list was empty)
GRAPH_SCHEMA backfill: not needed (graph already conformant)

### Phase 4 — Review (update)
Code review findings: 1 missing KaTeX escape (`<` instead of `\lt`) in new topic (fixed)
Content review findings: dy/dx notation consistent with topic 5 (PASS)
Test results: T1-T6 PASS on iteration 1
Visual QA findings per medium:
  - New SVG graph (implicit curve + tangent): PASS
Fix loop iterations: 1
Regression watch:
  - Topic 5 modified text did not break existing worked example (verified via screenshot diff)

### Phase 5 — Deploy (update)
Build verification: PASS (build-all.sh, 2m 58s)
Merge commit SHA: 9c2d1f8
Stash recovery: none

### Final Report
- Update merged to main
- 1 topic added (implicit differentiation), 1 topic refined (chain rule)
- No regressions detected
- No unresolved items
```
