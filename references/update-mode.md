# Update-mode orientation

Contents: §1 Purpose · §2 Quick mental model · §3 Mode-detection decision tree · §4 The 5 media actions · §5 Branch/stash/merge invariants · §6 No-grandfathering · §7 Regression-watch · §8 What update mode does not touch · §9 Common gotchas · §10 Phase cross-reference.

Single-file orientation for lesson-builder's update mode. Read this first whenever an update-mode verb or lesson reference shows up in the user's request. Do not re-stitch update-mode concepts from the six phase docs; come here, get oriented, then dive into the specific phase doc you need.

Cross-reference: `SKILL.md` (the skill root) holds the skill-level mode-detection summary and phase-shell layout. This doc expands only the update-specific concepts.

## 1. Purpose

Update mode operates on an existing lesson rather than building from scratch. Same 6-phase pipeline shell, same agent team, same approval gate at Phase 2, same review pipeline at Phase 4, same deploy flow at Phase 5. `mode: update` is threaded through as a flag; each phase has a branch that reads the existing lesson, diffs against new intent, and splices changes in place instead of writing a fresh skeleton. This doc is the single place to understand what update mode adds on top of the shared pipeline before opening the phase-specific references.

## 2. Quick mental model

- Update mode is a **branch** in the same pipeline, not a parallel pipeline.
- **Phase 0** adds mode detection, mode confirmation, working-tree check, research-depth question, scope-of-change question, optional media hints.
- **Phase 1** has content-orchestrator's update branch: read existing JSX end-to-end, build a media inventory, diff against user concerns / new materials, classify drift / gaps / redundancies / reorganization.
- **Phase 2** uses `medium-decider-agent`'s 5-way taxonomy (`keep / refine / replace / remove / add`) and presents a **change-list** approval view rather than a full plan dump.
- **Phase 3** does git branch setup, splice assembly against the existing JSX (not skeleton instantiation), post-splice sanity pass.
- **Phase 4** is mode-agnostic in mechanism; two update-specific rules apply: no-grandfathering, regression-watch.
- **Phase 5** commits to the update branch and merges `--no-ff` to main; handles stash recovery; leaves branch + stash intact on failure for manual recovery.

### Inventory pre-scan (Phase 1 prerequisite)

Before spawning `content-orchestrator-agent`, main Claude runs a deterministic Grep/Glob pre-scan so the orchestrator sees a fixed inventory rather than re-parsing the JSX itself. Capture:

- Graph components: function names, line ranges, `DEFAULT_GRAPH_PARAMS` keys, `GRAPH_SCHEMA` keys.
- `RefImg` base64 constants: names (without the blob body).
- Static images (`<img src>`) and videos (`<video src>`) with resolved paths under `<lesson_root>/public/images/` and `<lesson_root>/public/videos/`.
- Interactive primitives (`<InteractiveDemo title="...">`) with line locations.
- Manim source scripts globbed at `<lesson_root>/*.py`.
- Orphan assets: files on disk with no JSX reference (flagged for user action in Phase 2).

## 3. Mode detection decision tree

Mode detection runs on the user's initial message before the scoping interview fires. Detection is best-effort; Phase 0 confirmation is mandatory. Trigger verbs and lesson-reference resolution are canonical in `SKILL.md` § Mode detection.

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

**Log surface**: main Claude writes `Detected mode: update (candidate: <path>)` or `Detected mode: new` as the first line of `## Update YYYY-MM-DD > ### Phase 0 — Scoping (update)` (update mode) or `## Phase 0 — Scoping` (new mode) in `<lesson_root>/lesson_build.log.md`.

## 4. The 5 media actions

`medium-decider-agent` emits one verdict per existing medium plus one `add` verdict per gap. Decide by what maximizes pedagogical quality. On genuine ties, prefer the less invasive action (`keep > refine > replace > remove`); `add` sits outside (gaps only). **Tie-break protects correct work, not effort** — never pick `keep` over `refine` when content is stale, or `refine` over `replace` when the medium type is wrong. Under `resource_mode: "limited"`, tie-break extends to cheaper actions on near-ties.

### keep

Medium type is right, content still belongs in the lesson, no drift reported. Default when uncertain on a passing asset.
- **Example**: a diode I-V curve SVG graph stays exactly as is because the equation and axis scales are already correct.
- **Specialist assigned**: none. Main Claude performs no splice for keeps; they persist through Phase 3 unchanged.

### refine

Medium type is right but content is stale: wrong equation, outdated constant, bad scale, lower-quality asset, or improved rendering technique available. The function name and asset filename are **preserved** so call sites and `<video src>` references remain valid.
- **Example**: `DampedOscillatorPlot` in `<lesson_root>/src/<slug>.jsx` keeps its function name but its y-axis scale is recomputed by graphics-agent using a `refine_brief`.
- **Specialist assigned**: the **original** specialist for the medium type. `graphics-agent` for SVG graphs and matplotlib RefImg, `manim-agent` for animations (overwrites `.py` and `.mp4` at the same paths), `interactive-demo-agent` for interactive demos (must not rename `<InteractiveDemo title>`), `web-image-agent` for web images.

### replace

A different medium type better serves the concept: static SVG becomes an interactive demo, a matplotlib RefImg becomes a manim animation, a web image becomes a drawn SVG. New component, new asset path, function name may change.
- **Example**: `SnapshotComparison` was a static SVG but the topic now emphasizes temporal evolution, so `interactive-demo-agent` builds a new `<InteractiveDemo>` primitive to replace it. The old function and its call site are excised; the new primitive and new call site are inserted; `DEFAULT_GRAPH_PARAMS` / `GRAPH_SCHEMA` updated accordingly.
- **Specialist assigned**: the **destination-type** specialist (whatever kind the new medium is, not the old kind).

### remove

The concept was removed from the lesson, the user flagged it for cut, or it matches a low-value media pattern: a slider that only rescales an axis or shifts a curve without revealing new behavior, interactivity on a relationship already obvious from the equation, animated decoration that encodes no information, or a toggle that hides/shows what a legend already communicates. Component definition, call site, `DEFAULT_GRAPH_PARAMS` entry, and `GRAPH_SCHEMA` entry all excised.
- **Example**: `AdvancedDerivationDiagram` is removed because the user simplified the lesson and the topic no longer covers that derivation. Its definition, call site, and param entries all disappear in Phase 3 assembly.
- **Specialist assigned**: none. Main Claude performs the deletion during assembly.

### add

Used only for gaps — concepts identified in Phase 1 as needing visualization but having no existing medium.
- **Example**: the topic needs a visualization of a system evolving in time; `manim-agent` builds a new `TransientDecay` animation and adds it after the existing static graph, along with a fresh `<video src="/videos/transient-decay.mp4">` in the relevant topic content function.
- **Specialist assigned**: the **new-medium** specialist (`manim-agent`, `graphics-agent`, `interactive-demo-agent`, or `web-image-agent` depending on the chosen kind).

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

This block lands in `<lesson_root>/lesson_build.log.md` under `### Phase 2 — Plan (update)` and is the condensed summary shown at the AskUserQuestion approval gate. The full plan stays in the log; the gate surfaces only the change-list to avoid AskUserQuestion truncation.

## 5. Branch / stash / merge invariants

### Branch name format
`lesson-update/<slug>-YYYYMMDD`. Example: `lesson-update/intro-derivatives-20260415`. One branch per update run. Created in Phase 3 (not earlier), never on main.

### Stash
Phase 0's working-tree check runs `git status --short <lesson_root>`. If dirty, the user is asked whether to stash or abort. On stash:

```
git stash push --include-untracked -m "lesson-update-stash <slug> <date>" -- <lesson_root>
git rev-parse stash@{0}   # capture the stable OID — positional refs shift if anything else stashes
```

Phase 0 performs the stash (once — Phase 3 never re-stashes) and logs ref + OID under `### Phase 0 — Scoping (update) > Working tree state`. Phase 5 prompts for stash pop after a successful merge. On `git stash pop` conflict, the stash stays in place and conflict files are surfaced to the user.

### Merge
After Phase 4 passes and the local build verification gate (`bash build-all.sh` + headless Playwright on the built output) succeeds:

```
git checkout main
git merge --no-ff <branch name recorded in the Phase 3 log>   # incl. any collision suffix
git push origin main
```

`--no-ff` is required. It preserves a merge commit so the update is visible in history as a distinct event rather than inlined into main's history.

### Rollback on failure
If Phase 4 halts on a fundamental flaw or Phase 5 build-verify fails:
- **Do not merge.**
- The update branch stays in place.
- The stash (if any) stays in place.
- The final report surfaces the branch name and stash ref explicitly so the user can recover manually.
- The skill never force-deletes the branch. Manual cleanup is the user's call.

## 6. No-grandfathering rule

All media in the post-update lesson — `keep` + `refine` + `replace` + `add` — runs through the full Phase 4 visual-QA pipeline per medium kind. Pre-existing drift is not free-passed.

- **Rationale**: the user approved the update plan once at the Phase 2 gate. Visual-QA covers all final media equally so semantic drift in "kept" media (which the user may never have actually verified) doesn't slip through just because no one asked to change it this run.
- **Cost implication**: expensive visual-QA on lessons with many kept media. Worth it because semantic drift in kept media is invisible to the user until it breaks later.
- **Specialist brief note**: visual-QA specialists receive the **original stated intent** (as captured by content-orchestrator in Phase 1), not the user's most recent concerns, so a refined graph is evaluated against what it was always supposed to show.

## 7. Regression-watch stop rule

If a `refine` or `replace` fix iteration in Phase 4 regresses a previously-clean `keep` medium — a visual-QA specialist that previously passed now fails — **halt that fix thread**, log as a regression-watch entry under `### Phase 4 — Review (update) > Regression watch`, surface to the user at Phase 5.

- The user decides whether to accept the regression (merge anyway) or abort.
- **Tuning note**: may fire spuriously if visual-QA specialists have non-deterministic outputs. Start with "fire on two consecutive regressions on the same medium" and adjust based on real runs.

## 8. What update mode does NOT touch

Unless explicitly broken or materially stale, update mode leaves these alone:

- `<lesson_root>/package.json`
- `<lesson_root>/index.html`
- `<lesson_root>/vite.config.js`
- `<lesson_root>/server/proxy.js` (the 1-line `@core` shim)
- `<lesson_root>/src/main.jsx`
- `<lesson_root>/test_lesson.cjs`
- `<lesson_root>/CLAUDE.md` (preserve unrelated content outside the `## Lesson App` heading)

The typical update run edits `<lesson_root>/src/<slug>.jsx` plus assets under `<lesson_root>/public/images/`, `<lesson_root>/public/videos/`, and possibly manim `.py` scripts at `<lesson_root>/*.py`. That is the entire blast radius.

## 9. Common update-mode gotchas

- **Non-`@core` (legacy) lessons**: some workspaces contain legacy lessons that predate the `@core` refactor and still inline chat code; these are update-mode no-gos by default. Detection: a single Grep of the lesson JSX for an import from `@core` — absent means legacy. Workspaces should list known legacy lessons in the workspace CLAUDE.md. On a legacy hit, surface "this lesson needs migration first; opt into update-without-migration, abort, or switch to new mode?" during mode confirmation. Narrow opt-in bypass exists only if the user explicitly picks it.
- **Slug rename**: disallowed. A slug rename affects branch name, commit message, deploy path (`vite.config.js base=`), and asset URLs. Treat as "create new + delete old" flow; surface guidance during mode confirmation.
- **Orphan assets**: files present under `<lesson_root>/public/images/`, `<lesson_root>/public/videos/`, or `<lesson_root>/*.py` with no JSX reference. Inventory generation Globs both the JSX and the filesystem; orphans get flagged in the Phase 2 change-list with a `keep | remove` action for the user to pick.
- **Manim source-to-video naming is not 1:1**: refine assumes it can find the source `.py` for a given `.mp4`. If it cannot, **degrade `refine` to `replace`** (fresh script + fresh MP4 + update `<video src>` in JSX) and log the degradation.
- **Missing `GRAPH_SCHEMA`**: lessons predating the graph-schema feature lack the `GRAPH_SCHEMA` export. Phase 3 backfills from current `DEFAULT_GRAPH_PARAMS` per `references/graph-schema-guide.md`. Surface it in the Phase 2 approval gate under "structural drift repairs" so the user sees the backfill coming.
- **Dirty working tree**: Phase 0's working-tree check asks before proceeding. Either stash or abort; the skill never proceeds through dirt silently.
- **Splice-heavy editing risk**: real lessons can run to thousands of lines. Babel parse catches syntax but not semantic drift. The post-splice sanity pass in Phase 3 step 4.6 is the backstop — do not skip it.
- **Casual one-liner requests**: Phase 0 can balloon to ~5 update-specific questions. For a one-liner like "fix the tangent-slope graph in <slug>", prefer aggressive defaults (`light`, `specific: [<ComponentName>]`, no media hints) and present one condensed "here's what I'm assuming, change anything?" AskUserQuestion instead of 5 separate questions.

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
