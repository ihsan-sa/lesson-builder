# Update-mode orientation

Read this first when an update-mode verb or lesson reference appears in the user's request. Do not re-stitch update-mode concepts from the six phase docs; get oriented here, then open the specific phase doc.

Cross-reference: `SKILL.md` has the skill-level mode-detection summary and phase shell. This doc expands only update-specific concepts.

## 1. Purpose

Update mode operates on an existing lesson rather than building from scratch. Same 6-phase shell, agent team, Phase 2 approval gate, Phase 4 review pipeline, Phase 5 deploy. `mode: update` threads through as a flag; each phase has a branch that reads the existing lesson, diffs against new intent, and splices changes in place.

## 2. Quick mental model

- Update mode is a **branch** in the same pipeline, not a separate pipeline.
- **Phase 0** adds mode detection/confirmation, working-tree check, research-depth, scope-of-change, optional media hints.
- **Phase 1** content-orchestrator update branch: read existing JSX, build media inventory, diff against concerns/new materials, classify drift/gaps/redundancies/reorg.
- **Phase 2** uses `medium-decider-agent`'s 5-way taxonomy (`keep/refine/replace/remove/add`) and presents a **change-list** rather than a full plan dump.
- **Phase 3** git branch setup, splice assembly against existing JSX, post-splice sanity pass.
- **Phase 4** mode-agnostic in mechanism; two update-specific rules: no-grandfathering, regression-watch.
- **Phase 5** commits to the update branch, merges `--no-ff` to main, handles stash recovery, leaves branch + stash intact on failure.

### Inventory pre-scan (Phase 1 prerequisite)

Before spawning `content-orchestrator-agent`, main Claude runs a deterministic Grep/Glob pre-scan so the orchestrator consumes a fixed inventory rather than re-parsing. Capture:

- Graph components: function names, line ranges, `DEFAULT_GRAPH_PARAMS` keys, `GRAPH_SCHEMA` keys.
- `RefImg` base64 constants: names only (not blobs).
- Static images (`<img src>`) and videos (`<video src>`) with resolved paths under `<lesson_root>/public/images/` and `<lesson_root>/public/videos/`.
- Interactive primitives (`<InteractiveDemo title="...">`) with line locations.
- Manim source scripts globbed at `<lesson_root>/*.py`.
- Orphan assets: files on disk with no JSX reference.

## 3. Mode detection decision tree

Runs on the initial message before the scoping interview. Best-effort; Phase 0 confirmation is mandatory.

**Trigger verbs** (from SKILL.md): `update|updating|updated|rework|reworking|revise|revising|improve|improving|refresh|refreshing|modify|modifying|tweak|tweaking|fix|fixing|enhance|enhancing`.

**Lesson references**: workspace root derived from cwd (or asked at Phase 0). Candidates resolved via `Glob <workspace_root>/*/claude_lessons/*/` plus any path containing `claude_lessons` the user pastes.

```
User message
  |
  +-- Contains update verb?
  |     |
  |     +-- YES
  |     |    |
  |     |    +-- Lesson reference present?
  |     |    |     |
  |     |    |     +-- Full path given           --> candidate_root = path
  |     |    |     +-- Course + slug             --> candidate_root = <workspace_root>/<course>/claude_lessons/<slug>/
  |     |    |     +-- Only slug (or only code)  --> Glob candidates
  |     |    |     |     +-- Exactly one match   --> candidate_root = resolved
  |     |    |     |     +-- Zero or multiple    --> candidate_root = null (ask in Phase 0)
  |     |    |     +-- None                      --> candidate_root = null
  |     |    |
  |     |    +-- Verb + new-sounding intent? ("rework the skill, make a new lesson")
  |     |          --> mode = new, log ambiguity, scoping interview catches it
  |     |
  |     +-- NO
  |          +-- Lesson reference present? (rare, still a signal)
  |          |     +-- treat as new unless scoping says otherwise
  |          +-- Neither --> mode = new
  |
  +-- Outcome table:
        mode=update, candidate resolved    --> Phase 0 Q1 confirms the candidate
        mode=update, candidate null        --> Phase 0 Q1 asks "which lesson?"
        mode=new                           --> standard new-mode scoping
        ambiguous                          --> mode=new, surface ambiguity in Phase 0
```

**Confirmation is mandatory.** Phase 0's first AskUserQuestion always confirms mode. A user who says "rework" but means "start fresh" gets corrected at the gate.

**Log surface**: main Claude writes `Detected mode: update (candidate: <path>)` or `Detected mode: new` as the first line of `## Update YYYY-MM-DD > ### Phase 0 — Scoping (update)` (update mode) or `## Phase 0 — Scoping` (new mode) in `lesson_build.log.md`.

## 4. The 5 media actions

`medium-decider-agent` emits one verdict per existing medium plus one `add` verdict per gap. Decide by what maximizes pedagogical quality. On genuine ties, prefer the less invasive action (`keep > refine > replace > remove`); `add` sits outside (gaps only). **Tie-break protects correct work, not effort** — never pick `keep` over `refine` when content is stale, or `refine` over `replace` when the medium type is wrong. Under `resource_mode: "limited"`, tie-break extends to cheaper actions on near-ties.

### keep

Type right, content accurate, no drift. Default when a passing asset is uncertain.
- **Example**: SVG graph with correct equation and scales.
- **Specialist**: none. Kept items persist through Phase 3 unchanged.

### refine

Type right, content stale (wrong equation, outdated constant, bad scale, lower-quality asset). Function name and asset filename are **preserved** so call sites and `<video src>` references remain valid.
- **Example**: a graph function keeps its name; graphics-agent recomputes the y-axis scale per `refine_brief`.
- **Specialist**: the **original** specialist. `graphics-agent` (svg-graph, matplotlib RefImg), `manim-agent` (overwrites `.py` and `.mp4` at same paths), `interactive-demo-agent` (must not rename `<InteractiveDemo title>`), `web-image-agent`.

### replace

A different medium type serves better. New component, new asset path, function name may change.
- **Example**: static SVG becomes an interactive demo when parameter sensitivity is the teaching point. Old function and call site excised; new primitive inserted; `DEFAULT_GRAPH_PARAMS` / `GRAPH_SCHEMA` updated.
- **Specialist**: the **destination-type** specialist.

### remove

Concept cut, user flagged, or low-value pattern. Component definition, call site, `DEFAULT_GRAPH_PARAMS` entry, and `GRAPH_SCHEMA` entry all excised.
- **Example**: a graph for a cut concept; everything disappears in Phase 3 assembly.
- **Specialist**: none. Main Claude deletes directly.

### add

Gaps only — concepts identified in Phase 1 as needing visualization but no existing medium.
- **Example**: topic needs a temporal visualization; `manim-agent` builds a fresh animation; splice inserts `<video src>`.
- **Specialist**: the **new-medium** specialist (`manim-agent`, `graphics-agent`, `interactive-demo-agent`, or `web-image-agent`).

### Change-list summary block (Phase 2 artifact shape)

```
MEDIA ACTIONS (across all topics):
  KEEP (N):    name, kind, topic
  REFINE (N):  name, kind, topic — brief rationale / specialist
  REPLACE (N): name, kind -> new-kind, topic — rationale / specialist
  REMOVE (N):  name, kind, topic — rationale
  ADD (N):     concept, kind, topic — rationale / specialist

STRUCTURAL DRIFT REPAIRS:
  - GRAPH_SCHEMA backfill: needed / not needed
  - Chatbot props reconcile: <delta or "none">
```

This block lands in `lesson_build.log.md` under `### Phase 2 — Plan (update)` and is the condensed summary shown at the approval gate. The full plan stays in the log; the gate surfaces only the change-list to avoid AskUserQuestion truncation.

## 5. Branch / stash / merge invariants

### Branch name format
`lesson-update/<slug>-YYYYMMDD`. One branch per run. Created in Phase 3, never on main.

### Stash
Phase 0 runs `git status --short <lesson_root>`. If dirty, the user is asked to stash or abort. On stash:

```
git stash push --include-untracked -m "lesson-update-stash <slug> <date>" -- <lesson_root>
```

The stash ref is logged under `### Phase 0 — Scoping (update) > Working tree state`. Phase 5 prompts for stash pop after a successful merge. Pop conflicts leave the stash in place and surface files to the user.

### Merge
After Phase 4 passes and local build verification (`bash build-all.sh` + headless Playwright on the built output) succeeds:

```
git checkout main
git merge --no-ff lesson-update/<slug>-YYYYMMDD
git push origin main
```

`--no-ff` is required — it preserves a merge commit so the update is visible in history.

### Rollback on failure
If Phase 4 halts on a fundamental flaw or Phase 5 build-verify fails:
- **Do not merge.**
- The update branch and stash (if any) stay in place.
- The final report surfaces the branch name and stash ref for manual recovery.
- The skill never force-deletes the branch.

## 6. No-grandfathering rule

All media in the post-update lesson — `keep` + `refine` + `replace` + `add` — runs through the full Phase 4 visual-QA pipeline per medium kind. Pre-existing drift is not free-passed.

- **Rationale**: the user approved once at the Phase 2 gate; visual-QA covers all final media equally so semantic drift in "kept" media (never verified this run) does not slip through.
- **Cost**: expensive on lessons with many kept media, but drift in kept media is invisible to the user until it breaks.
- **Specialist brief**: visual-QA specialists receive the **original stated intent** (captured by content-orchestrator in Phase 1), not the user's most recent concerns, so refined media is graded against what it was always supposed to show.

## 7. Regression-watch stop rule

If a `refine` or `replace` fix iteration in Phase 4 regresses a previously-clean `keep` medium (a visual-QA specialist that passed now fails), **halt that fix thread**, log as a regression-watch entry under `### Phase 4 — Review (update) > Regression watch`, surface at Phase 5.

- The user decides whether to accept or abort.
- **Tuning**: may fire spuriously from non-deterministic visual-QA. Start conservative: fire on two consecutive regressions on the same medium.

## 8. What update mode does NOT touch

Unless explicitly broken or materially stale, update mode leaves these alone:

- `<lesson_root>/package.json`
- `<lesson_root>/index.html`
- `<lesson_root>/vite.config.js`
- `<lesson_root>/server/proxy.js` (the 1-line `@core` shim)
- `<lesson_root>/src/main.jsx`
- `<lesson_root>/test_lesson.cjs`
- `<lesson_root>/CLAUDE.md` (preserve unrelated content outside the `## Lesson App` heading)

Typical update run edits `<lesson_root>/src/<slug>.jsx` plus assets under `<lesson_root>/public/images/`, `<lesson_root>/public/videos/`, and possibly manim `.py` scripts at `<lesson_root>/*.py`. That is the entire blast radius.

## 9. Common update-mode gotchas

- **Non-`@core` lessons**: a lesson whose JSX inlines chat code is an update no-go by default. Detection: Grep for `from "@core"` in `src/<slug>.jsx`. On miss, offer "migration required first", "bypass (I accept risk)", or "switch to new mode" at confirmation.
- **Slug rename**: disallowed. Treat as "create new + delete old".
- **Orphan assets**: files under `public/images/`, `public/videos/`, or `*.py` with no JSX reference. Flagged in the Phase 2 `ORPHAN ASSETS` subsection with `keep | remove` pre-verdicts per file. Phase 3 step 4.9 deletes `remove`-marked files; Phase 5 surfaces counts.
- **Manim source-to-video mismatch**: refine assumes `.py` exists for the `.mp4`. If not, **degrade to replace** (fresh script + fresh MP4 + JSX `<video src>` update) and log.
- **Missing `GRAPH_SCHEMA`**: lessons predating the feature lack the export. Phase 3 backfills from `DEFAULT_GRAPH_PARAMS` per `references/graph-schema-guide.md`. Surfaced at Phase 2 as a structural drift repair.
- **Dirty working tree**: Phase 0 asks to stash or abort. Never proceed silently.
- **Splice corruption risk**: lessons can be thousands of lines. Babel catches syntax, not semantics. The post-splice sanity pass (Phase 3 step 4.6) is the backstop.
- **Casual one-liner requests**: Phase 0 can balloon to 5 questions. For "fix the wave-packet graph in <slug>", use aggressive-defaults (see `references/phase-0-scoping.md`): `targeted` under `full`, `light` under `limited`. Present one condensed confirmation instead of 5 questions.

## 10. Phase-by-phase cross-reference

Once oriented, dive into the specific phase doc for full procedures:

- **Phase 0** (scoping): `references/phase-0-scoping.md` — update-mode scoping section (mode confirmation, working-tree check, research-depth, scope-of-change, media-hints questions + scoping artifact format).
- **Phase 1** (content analysis): `references/phase-1-content.md` — update-mode content-orchestration section with the inventory pre-scan Grep patterns and the `light / targeted / full` research_depth branches.
- **Phase 2** (plan): `references/phase-2-plan.md` — `medium-decider-agent`'s 5-way taxonomy plus the change-list plan artifact format and approval-gate condensed-summary convention.
- **Phase 3** (execution): `references/phase-3-execution.md` — update-mode assembly section with pre-execution git setup, scratch directory layout split by action, per-action specialist inputs, and the 10-step splice algorithm.
- **Phase 4** (review + fix): `references/phase-4-review.md` — no-grandfathering and regression-watch subsections plus the update-mode change-list sanity grep.
- **Phase 5** (deploy): `references/phase-5-deploy.md` — update-mode branch/merge/stash subsection including rollback-on-failure behavior.
- **Checklists**: `references/checklists.md` — update-mode pre-flight checklist and update-mode splice checklist.
- **Log format**: `references/log-template.md` — update-mode append format (`## Update YYYY-MM-DD (run-id: <hash>)` with `### Phase N` nested under it).
- **Graph schema**: `references/graph-schema-guide.md` — used by the Phase 3 `GRAPH_SCHEMA` backfill step when the lesson predates the graph-schema feature.
