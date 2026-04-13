# Log template — `lesson_build.log.md`

Reference for main Claude when writing the per-lesson build trail during lesson-builder runs.

## Purpose

`lesson_build.log.md` lives at `<lesson_root>/lesson_build.log.md`. The canonical build/update trail, surfaced to the user at end of each run. New mode creates it; update mode appends. A lesson built once and updated three times has four stacked sections in the same file.

## File location

```
<workspace_root>/<course>/claude_lessons/<slug>/lesson_build.log.md
```

Per-lesson. No shared log.

## Ownership

Main Claude owns the file. Subagents return findings to main Claude; main Claude logs. Single writer avoids concurrent-write races and keeps formatting consistent.

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

- ISO timestamps: `YYYY-MM-DDTHH:MM:SSZ` or local with offset (`YYYY-MM-DDTHH:MM:SS-04:00`).
- Concise but informative. One line per event; multi-line for structured data (change-lists, plans, file lists).
- Agent findings in bulleted lists under the phase heading. Attribute when useful: `- [code-reviewer] unused import in src/<slug>.jsx:14`.
- Embed long artifacts inline. For thousands of lines, link to a sibling file and note the path.
- Errors/unresolved go in a marked subsection (`### UNRESOLVED` or `Regression watch: [...]`) for end-of-run surfacing.

## Surfacing to the user

- At end of Phase 5, main Claude composes the final report from `### UNRESOLVED`, `Regression watch`, and `Final Report` sections.
- The log stays on disk. Users can read it any time.
- Final report in chat is brief (20-50 lines): deploy confirmation, commit SHA, dashboard URL, unresolved/regression items. The log is the full audit trail.

## Worked example

A condensed example log for a lesson `<course>/claude_lessons/<slug>` after one new-mode build plus one update run. Path:

```
<workspace_root>/<course>/claude_lessons/<slug>/lesson_build.log.md
```

```markdown
# Lesson Build Log — <course> / <slug>
Started: <ISO timestamp>
Skill: lesson-builder v<version>

## Phase 0 — Scoping
- Detected mode: new
- User answers: audience=<audience>; depth=<goal>; resources=[<list of files>]; media=[<preference notes>]
- Derived scope: N topics covering <list>

## Phase 1 — Content Analysis
- Resources analyzed: <file 1> (N pages), <textbook reference>
- Research rounds: 2 (initial sweep + gap-fill on <subtopic>)
- Gap-fill rounds: 1
- Compiled package summary: <list of concepts, graph specs, animation specs>

## Phase 2 — Plan
- Plan artifact: embedded below
  - Topic 1: <title> (<key concepts>)
  - Topic 2: <title> (derivation + worked example)
  - Topic 3: <title> (derivation + worked example)
  - Topic 4: <title>
  - Topic 5: <title>
- Approval: APPROVED by user at <timestamp>

## Phase 3 — Execution
- Specialists spawned: graphics-agent (x2), manim-agent, interactive-demo-agent
- Files written:
  - src/<slug_underscored>.jsx
  - src/main.jsx
  - vite.config.js
  - server/proxy.js
  - index.html
  - package.json
  - test_lesson.cjs
  - public/videos/<asset>.mp4

## Phase 4 — Review
- Code review findings: 2 unused imports, 1 missing @core alias usage (fixed)
- Content review findings: topic 3 derivation missing explicit <step> (fixed)
- Test results: 17/17 PASS on iteration 2
- Visual QA findings per medium:
  - SVG graphs: graph 1 x-axis label clipped (fixed)
  - Manim animation: PASS on first check
- Fix loop iterations: 2

### UNRESOLVED
- (none)

## Phase 5 — Deploy
- Build verification: PASS (build-all.sh, <duration>)
- Commit SHA: <sha>
- Deploy dashboard URL: <host-specific>

## Final Report to User
- Lesson deployed to <host-specific URL>
- 5 topics, 2 SVG graphs, 1 manim animation
- No unresolved items

## Update YYYY-MM-DD (run-id: <hash>)

### Phase 0 — Scoping (update)
Detected mode: update (candidate: <workspace_root>/<course>/claude_lessons/<slug>)
Mode confirmed: YES
Working tree state: clean
Research depth: targeted
Scope of change: add <new topic> as a new topic; refine <existing topic> to set it up
Media hints: 1 new SVG graph for the <new concept>

### Phase 1 — Content Analysis (update)
Research mode: targeted (<source references>)
Change-list summary: { topics_kept: [1,2,3,5], modified: [4], added: [6], removed: [], reordered: no; media: { keep: 2, refine: 0, replace: 0, remove: 0, add: 1 } }
Drift incidents: none

### Phase 2 — Plan (update)
Change-list view:
  - Topic 4 (<title>): expand closing paragraph to motivate the new topic
  - Topic 6 (NEW): <title> — key equations and concepts
Full Lesson Plan: embedded below (6 topics total, abbreviated for brevity)
Approval: APPROVED by user at <timestamp>

### Phase 3 — Execution (update)
Branch: lesson-update/<slug>-YYYYMMDD
Stash ref: none
Specialists spawned: graphics-agent
Splice counts: refine=1, replace=0, remove=0, add=1
Orphan cleanup: none (orphan list was empty)
GRAPH_SCHEMA backfill: not needed (graph already conformant)

### Phase 4 — Review (update)
Code review findings: 1 missing KaTeX escape (`<` instead of `\lt`) in new topic (fixed)
Content review findings: equation notation consistent across topics (PASS)
Test results: 17/17 PASS on iteration 1
Visual QA findings per medium:
  - New SVG graph: PASS
Fix loop iterations: 1
Regression watch:
  - Existing topic 4 modified text did not break prior worked example (verified via screenshot diff)

### Phase 5 — Deploy (update)
Build verification: PASS (build-all.sh, <duration>)
Merge commit SHA: <sha>
Stash recovery: none

### Final Report
- Update merged to main
- 1 topic added, 1 topic refined
- No regressions detected
- No unresolved items
```
