# Phase 2: Plan

## Purpose

Phase 2 is the planning phase. Main Claude drives it directly and produces the **Lesson Plan** artifact. This phase runs the pipeline's single mandatory human approval gate; all Phase 3 specialist work is constrained by the approved plan. Phase 2 also selects medium specialists (graphics, manim, interactive-demo, web-image, inline prose) and seeds their briefs — the plan doubles as a spawn manifest for Phase 3.

## Inputs

Phase 2 consumes:

- **Scoping artifact** from Phase 0: `mode`, `course`, `slug`, `audience_level`, `pedagogical_goal`, `scope_of_lesson`, and mode-specific fields (`provided_materials` / `new_lesson_context` for new mode, or `existing_lesson_root`, `research_depth`, `scope_of_change`, `media_hints`, `working_tree_state` for update mode).
- **Compiled content package** from Phase 1:
  - **New mode**: the full compiled package with topics, equations, concepts, constants, `graphs_needed`, `manim_opportunities`, `interactive_opportunities`, per-topic context strings and `practice_problems` arrays, `LESSON_CONTEXT`, `SOURCES_CONSULTED`, `PRACTICE_PROBLEMS_INDEX`, `GAPS_REMAINING`.
  - **Update mode**: the **update package** that extends the new-mode schema with per-topic `action` verdicts (`keep | modify | remove | reorder:<N> | add`), per-existing-medium `preverdicts` (`keep | refine | replace | remove`), drift incidents, and the existing-media inventory compiled by main Claude prior to Phase 1.

## Objectives-first + prerequisite ordering (backward design)

The plan is derived **backward from measurable objectives**, not forward from "what content do we have." This is the constructive-alignment spine: decide what the learner should be able to DO, then what evidence proves they can, and only then which topics and media deliver it. A plan that lists activities with no objective they serve, or an objective with no check, is misaligned and must be repaired before the approval gate — not shipped and caught in Phase 4.

Before Step 1's topic split, main Claude extracts the objective skeleton from the Phase 1 content package:

- **Each topic states what the learner should be able to DO.** Write observable, measurable objectives — an action verb on specific content (*derive* the dispersion relation, *predict* the sign of the current, *compare* two models, *classify* the regime). Ban vague verbs (*understand*, *know*, *appreciate*, *be familiar with*): they cannot be assessed, so they cannot be aligned. A topic carries a small set (1–3) of objectives, not a content dump.
- **Each objective maps to ≥1 active check, including ≥1 transfer item across the topic.** For every objective, name the assessment evidence that would show it is met — a retrieval prompt, a prediction-before-reveal, a worked-then-faded example, a self-check. At least one check per topic must be a **transfer** item (same deep structure, new surface), not just recall of what was shown. Tag each check recall vs transfer. An objective with no check is an alignment error; refuse to advance the topic until it has one.
- **Topics are ordered by prerequisite, not arbitrary sequence.** Replace "whatever order the source happened to present it" with a prerequisite ordering: if topic B's objective assumes a concept established by topic A, A precedes B. Sketch the prerequisite edges (A → B means A enables B) and sequence by them; the `TOPICS` array order is the linearization of that dependency graph, not the lecture's incidental order. Where two topics have no dependency between them, order by the teaching narrative.
- **Default topic skeleton follows the load-fading sequence** for procedural content: worked example → faded/partial → independent practice, with the inline check at the independent step. (This is the lesson-side mirror of the tutor's fade-by-competence policy in `references/template.md`.)

This objective → evidence → ordering skeleton is the contract Step 1 partitions against and that the Phase 4 pedagogy gate (`references/phase-4-review.md`) verifies. It is consistent with the evidence grades — stating objectives is only weakly effective on its own, so the leverage is in the **checks that force retrieval against them**, never in a myth (no learning-styles routing, no "remember X%", no gamified objectives; see the `SKILL.md` guardrail).

## Procedure

### Step 1: Split compiled content into logical topic units

Main Claude reads the compiled content package and partitions it into topics matching the user's scope from Phase 0. One topic per tab in the final lesson. The split follows the objective skeleton above — each topic owns its objectives, their checks, and its place in the prerequisite ordering, so the `TOPICS` order reflects prerequisites rather than source sequence. In update mode, topic boundaries are already determined by the Phase 1 verdicts (`keep`, `modify`, `add`, `remove`, `reorder`), so Step 1 reconciles them against the scoping artifact's `scope_of_change` — if the user asked for "specific topics", topics outside that list default to `keep` regardless of drift unless the drift is severe enough to block the lesson.

### Step 2: Spawn medium-decider-agent in parallel

One spawn per topic. All spawns fire in a single message to maximize parallelism. The inputs and outputs branch on mode; see the "medium-decider-agent driving" section below for the full contract.

### Step 3: Spawn medium specialists in parallel to draft execution plans

Important: Phase 2 specialists draft **execution plans**, not final artifacts. They return structured briefs that describe what they would build in Phase 3. Nothing is rendered, written to disk, or compiled into the lesson yet.

Parallelism pattern: one specialist per topic per medium verdict, all spawned concurrently. Main Claude waits for all to return before proceeding to Step 4.

Per-specialist draft plan contents:

- **`graphics-agent`** — returns an SVG component sketch (function name, props list, expected data flow, rough geometric outline) plus matplotlib reference image parameters (any `RefImg` base64 constants that should be pre-rendered, the `.py` script shape, expected colour and axis scheme). In update mode, also returns a diff against the existing component it is refining or replacing.
- **`manim-agent`** — returns a scene outline (which objects appear, how they transform, what the camera does), an expected render time estimate (so main Claude can flag long renders at the approval gate), and the asset filename that will land under `<lesson_root>/public/videos/<filename>.mp4`. In update mode, notes whether an existing `.py` script is being overwritten or a new filename is introduced.
- **`interactive-demo-agent`** — returns the list of primitives it will use (from `@core/ui` or composed locally), the state wiring plan (which `useState` hooks, which derived values), and the expected user-visible behavior (what the student does, what changes in response). In update mode, returns whether the outer `<InteractiveDemo title>` stays the same (required for refine).
- **`web-image-agent`** — returns draft search queries, candidate URLs (image URL plus source page URL), license requirements (the agent must only return images with explicit license compatibility), and the target path under `<lesson_root>/public/images/<filename>`. License compliance is blocking: an image with unclear provenance must not advance past this step.
- **Main Claude direct draft** — no specialist spawn. Main Claude writes inline prose snippets, KaTeX equation blocks, and key-concept bullets directly into the draft plan. These are fast and don't benefit from delegation.

### Step 4: Main Claude compiles the Lesson Plan artifact

Main Claude merges all draft execution plans into a single Lesson Plan artifact using the format appropriate to the mode (see "Lesson Plan artifact formats" below). Compilation includes:

- Deduplicating shared components (e.g., a helper SVG graph referenced by two topics appears once in the plan with both topic references).
- Reconciling the `GRAPH_SCHEMA` draft so every interactive graph has a schema entry with matching keys to its `DEFAULT_GRAPH_PARAMS`.
- Tallying change-list counts (update mode) so the approval-gate summary can show honest `keep/refine/replace/remove/add` totals.
- Flagging any internal inconsistencies (e.g., a topic marked `add` that depends on an equation marked `remove`).
- **Forwarding `PRACTICE_PROBLEMS_INDEX`** from the Phase 1 package into the plan's `Practice problems index:` section so the user sees per-topic problem totals and solution provenance at the approval gate without reading every problem body.
- **Forwarding deploy intent from the scoping artifact** into a `DEPLOY:` section of the plan. Every Lesson Plan (both modes) includes `Action: <deploy_action>`, `Service: <deploy_service>` (or "GitHub → workspace-configured host auto-deploy" when `deploy_action == "push-to-github"`), and `Course materials in commit: asked at Phase 5` (or "N/A — no materials provided" when `provided_materials` is empty). The user sees deploy intent at the approval gate alongside the content plan so approval covers both.
- **(Update mode only)** Forwarding the inventory's `orphans: [...]` list into the change-list as an `ORPHAN ASSETS` section with a default `keep | remove` pre-verdict per file. Orphans are files under `<lesson_root>/public/images/`, `<lesson_root>/public/videos/`, or `<lesson_root>/*.py` that the Phase 1 pre-scan found on disk but with no JSX reference. Default pre-verdict is `keep` unless the file is an obvious leftover (e.g., filename contains `old`, `backup`, `unused`, `__tmp`); main Claude's job is to surface them, not decide for the user.

### Step 5: Write to lesson_build.log.md

Main Claude writes the full Lesson Plan artifact to `<lesson_root>/lesson_build.log.md` under the appropriate heading:

- **New mode**: `## Phase 2 — Plan` section with `Plan artifact: [...]` and an `Approval:` line that starts `PENDING` and flips to `APPROVED by user at <timestamp>` on gate pass.
- **Update mode**: `### Phase 2 — Plan (update)` nested under the day's `## Update YYYY-MM-DD (run-id: <short-hash>)` heading. Contains both `Change-list view: [...]` and `Full Lesson Plan: [...]`.

The log is source of truth. Long change-lists go into the log first, then the approval gate points at the log. This avoids AskUserQuestion body truncation.

### Step 6: Human approval gate via AskUserQuestion

Main Claude presents the Lesson Plan with three options: approve, request changes, abort. See the "Human approval gate" section below for full details including phrasing examples and the request-changes loop.

## medium-decider-agent driving

### New mode

**Inputs passed to each spawn**:
- Topic content (id, title, equations, key concepts, context string)
- User media preferences from the Phase 0 scoping artifact (e.g., "prefer interactive where possible", "avoid manim, slow to render", "no web images")

**Return**: a ranked recommendation across the full medium space (inline prose, SVG graph, matplotlib reference, manim animation, interactive demo, web image, Desmos graph) with a written rationale per rank. Main Claude uses the top-ranked medium per topic but can fall back to lower ranks if a specialist's draft plan in Step 3 reveals the top choice isn't viable (e.g., manim render time estimate is prohibitive).

Desmos embeds do not spawn a specialist — main Claude authors the `<DesmosGraph state={...}/>` JSX directly into the content function. Treat them the same as inline prose / KaTeX equations for spawn purposes: no delegation, written inline during assembly.

### Update mode

**Extra inputs** (passed in addition to topic content and user preferences):

```
mode: "update"
topic: { id, title, content_preview, equations, key_concepts, pedagogical_goal }
existing_media: [
  {
    kind: "svg-graph" | "matplotlib-ref" | "manim-video" | "static-image" | "interactive-demo",
    name: <function name | asset filename | demo title>,
    current_purpose, current_parameters, source_file, line_range,
    rendered_preview: null | <base64 snapshot from graph-preview tab>,
    content_orchestrator_preverdict
  }
]
gaps: [ { concept, reason_existing_media_insufficient, orchestrator_preverdict: "add" } ]
user_media_hints: [ { concept, hint } ]
```

**5-way taxonomy** (see `references/update-mode.md` §4 for full details):

1. **keep**: type right, content accurate, teaches well as-is.
2. **refine**: type right but content stale. Function name / asset filename preserved.
3. **replace**: a different medium type serves better.
4. **remove**: concept cut, user-flagged, or low-value.
5. **add**: gaps only.

User hints override only when they do not violate scientific accuracy or pedagogical correctness. Conflict with orchestrator pre-verdict → safer action with a note.

**Tie-break**: on genuine ties, less invasive wins (`keep` > `refine` > `replace` > `remove`); `add` sits outside (gaps only). Tie-break protects correct work, not effort. Under `resource_mode: "limited"`, extends to cheaper actions on near-ties.

**Return format** (the agent's response contract):

```
{
  "existing_verdicts": [
    { medium_name, kind, action, rationale, specialist, refine_brief | replace_brief | null }
  ],
  "gap_verdicts": [
    { concept, action: "add", rationale, specialist, add_brief }
  ]
}
```

Main Claude aggregates verdicts across all topics. The `specialist` field routes each verdict to the right specialist in Step 3: `graphics-agent` for svg-graph and matplotlib-ref, `manim-agent` for manim-video, `interactive-demo-agent` for interactive-demo, `web-image-agent` for static-image. `keep` verdicts bypass Step 3 entirely (nothing to draft). `remove` verdicts also bypass Step 3; main Claude records them for the Phase 3 assembly phase.

## Medium selection criteria

`medium-decider-agent` uses these to rank options. Every interactive demo must answer: "what does the student learn by manipulating this that they could not from a static figure?" Nothing → static graph.

**Match the medium to the content, never to a learner "style."** Pick a graph because the concept is spatial, an animation because the temporal dimension is essential — not because a learner is "a visual learner" (a debunked premise). The medium ranking and any copy it produces must clear the "Do NOT build these" myth guardrail in `SKILL.md`: no learning-styles routing, no Dale's-cone "remember X%" justifications for interactivity (justify via the testing/doer effect), and no gamification (points / badges / leaderboards) as a motivation medium. When a choice is tempting for one of those reasons, drop it.

**High-value interactive patterns**:
- **Convergence**: iterative algorithms; let the user step through or adjust initial conditions.
- **Parameter sensitivity**: physical properties reshape I-V curves, frequency responses, transfer functions in real time.
- **Phase evolution**: animations when the temporal dimension is essential.
- **Threshold/boundary**: user drags a parameter across a critical transition.

**Low-value patterns — avoid**:
- Sliders that just scale an axis or shift a curve.
- Interactivity on obvious relationships (V = IR).
- Animated decorations.
- Toggles that hide/show what the legend already shows.

**Manim** is right when: smooth geometric transformations, vector field flows, or 3D rotations that SVG cannot represent; step-by-step animated proofs; one-time assets, not runtime-parameterized.

**Static SVG** is right when: runtime-parameterized (slider, toggle); simple geometry where inline paths beat raster load cost; simple curves (exponential, sinusoid, linear) that benefit from crisp vector rendering.

**Matplotlib `RefImg`** supplements SVG when: the figure needs scientifically accurate reference rendering (validated axis labels, gridlines); the figure is complex enough that matplotlib primitives win over hand-authored SVG.

**Desmos graph (`<DesmosGraph>`)** is right when: the teaching story is function shape under continuous parameters (e.g., plot a Taylor approximation vs. the true function, root-finding convergence as a slider sweeps the initial guess, filter magnitude response with slider-tuned pole/zero); the student benefits from zoom, pan, and typing arbitrary expressions; multiple curves need to be layered. Each `<DesmosGraph>` costs a ~1.3 MB CDN fetch the first time any embed renders in a page. Do NOT reach for Desmos when a static SVG with 1-3 curves already tells the story — stick with `<<DEMO>>` / `graphics-agent` output there. A lesson may embed multiple Desmos graphs; the second onwards is free (bundle already loaded).

## Lesson Plan artifact formats

### New mode — full Lesson Plan

Quoted verbatim from `lesson-builder.md` Phase 2, new mode:

```
LESSON PLAN
Course/Slug: ...
Topics:
  - id, title, subtitle, tab label
  - media: [{ type, specialist, execution_plan_summary }]
  - equations, key concepts
  - practice_problems: N (sources: "Final 2024 — Q3", "PS4 — Q2", ...) | none (no matching problems in materials)
Graph schema draft:
  - graphKey: { param: { type, min, max } } per interactive graph
Practice problems index:
  - topic-1: N problems (Final 2024 ×2, PS3 ×1, HW2 ×1)
  - topic-2: N problems (Final 2023 ×1)
  - topic-3: none
  - ...
  Total: M problems across K topics. Solutions: <official: X, ai-worked: Y>.
Overall structure: tab order, approximate lesson length, expected complexity
Deploy:
  Action:  push-to-github | push-to-custom | commit-only | skip
  Service: <remote URL / CLI / service name, or "GitHub → workspace-configured host">
  Private paths (gitignored by default): <materials/, source/, notes/, *.local, .env* and any loose provided_materials>
  Gitignore override: asked at Phase 5 (default: no override — nothing private gets published) | N/A (no gitignored candidates) | N/A (deploy skipped)
```

Rendering rules for the `Gitignore override:` line:

- `deploy_action == "skip"` → `N/A (deploy skipped)`.
- Nothing under `<lesson_root>/materials/`, `<lesson_root>/source/`, `<lesson_root>/notes/` AND `provided_materials` empty → `N/A (no gitignored candidates)`.
- Otherwise → `asked at Phase 5 (default: no override — nothing private gets published)`.

The `Private paths` line lists the gitignore categories that will exist after Phase 3 runs. When `provided_materials` contains paths under `<lesson_root>/` that aren't covered by the default category directories, list them explicitly in that line so the user sees exactly what's being protected.

The `Service:` line renders `GitHub → workspace-configured host auto-deploy` when `deploy_action == "push-to-github"` (the concrete host depends on `netlify.toml` / `vercel.json` / CI config in the workspace; the skill does not try to infer). For `push-to-custom`, render the verbatim `deploy_service` value, prefixed with `git-remote: ` or `cli: ` per `deploy_service_kind`. For `commit-only` and `skip`, render `null` (nothing is going out).

### Update mode — change-list format

Quoted verbatim from `lesson-builder.md` Phase 2, update mode:

```
LESSON UPDATE PLAN — <Course>/<slug>
Research mode: light | targeted | full
Branch: lesson-update/<slug>-YYYYMMDD

TOPICS CHANGING:
  [ADD]     topic-N "Title" — why / media items count
  [MODIFY]  topic-1 "Title" — equations changed N, concepts added N,
            content removed N, media actions (keep/refine/replace/remove/add counts)
  [REMOVE]  topic-4 "Title" — why / media affected
  [REORDER] topics-2,3,5 → new order — why

TOPICS UNCHANGED: [KEEP] ...

MEDIA ACTIONS (across all topics):
  KEEP (N):    name, kind, topic
  REFINE (N):  name, kind, topic — brief rationale / specialist
  REPLACE (N): name, kind → new-kind, topic — rationale / specialist
  REMOVE (N):  name, kind, topic — rationale
  ADD (N):     concept, kind, topic — rationale / specialist

ORPHAN ASSETS (files on disk, no JSX reference):
  [pre-verdict] path — size — why-orphan — suggested action
  [keep]        public/images/unused-diagram.png — 142 KB — never referenced — keep (may be WIP)
  [remove]      public/videos/old-backup.mp4     — 8.2 MB — filename contains "old" — remove

STRUCTURAL DRIFT REPAIRS:
  - GRAPH_SCHEMA backfill: needed / not needed
  - Chatbot props reconcile: <delta or "none">

ROLLBACK:
  - Branch: lesson-update/<slug>-YYYYMMDD
  - Stash: <ref> | none
  - Merge to main only on success

DEPLOY:
  Action:  push-to-github | push-to-custom | commit-only | skip
  Service: <remote URL / CLI / service name, or "GitHub → workspace-configured host">
  Private paths (gitignored by default): <materials/, source/, notes/, *.local, .env* and any loose provided_materials>
  Gitignore override: asked at Phase 5 (default: no override — nothing private gets published) | N/A (no gitignored candidates) | N/A (deploy skipped)

APPROVE? [approve / request changes / abort]
```

The `DEPLOY:` block follows the same rendering rules as the new-mode format above.

**Orphan asset action semantics**:
- `keep` — no-op in Phase 3. File stays on disk. Use when the file is work-in-progress, a reference asset the user may want to wire up later, or a legal/provenance artifact.
- `remove` — Phase 3 deletes the file from disk during the orphan-asset-cleanup drift repair (`phase-3-execution.md` step 4.9 / drift repair category 3). The removal is logged and shows up in the Phase 3 summary line.
- The pre-verdict shown in the change-list is advisory. The user can override either way at the approval gate via the request-changes loop.
- If the orphan list is empty, omit the `ORPHAN ASSETS` section entirely to keep the change-list compact. Do not render an empty "ORPHAN ASSETS: none" line; silence is the signal.

### Graph schema handling in update mode

If the existing lesson has `GRAPH_SCHEMA`, the plan shows:
- **preserved** keys: graphs kept unchanged; their schema entries carry forward.
- **modified** keys: graphs being refined where the schema `param` ranges or types change.
- **added** keys: new graphs from `add` verdicts; new schema entries land alongside.

If the existing lesson **lacks** `GRAPH_SCHEMA` (predates the graph-schema feature in `_lesson-core/chat/graphSchema.js`), the plan emits a `STRUCTURAL DRIFT REPAIRS: GRAPH_SCHEMA backfill: needed` item. The user sees this explicitly at the approval gate; the backfill is performed in Phase 3 Step 7 by generating a fresh `GRAPH_SCHEMA` export from the current `DEFAULT_GRAPH_PARAMS` per `references/graph-schema-guide.md`.

## Human approval gate

Single mandatory gate. No exceptions. Phase 3 does not start without explicit approval.

### Mechanics

Main Claude uses `AskUserQuestion` with three options: **approve**, **request changes**, **abort**.

- **New mode**: inline the plan if it fits; otherwise write to the log and present a condensed summary pointing at the log.
- **Update mode**: surface only the **change-list** (not the full plan). Long change-lists go to the log; present a condensed summary pointing at the log.

### AskUserQuestion phrasing examples

**New mode, short plan fits inline**:

```
Question: Approve this Lesson Plan for <course> / <slug>?

Body:
LESSON PLAN
Course/Slug: <course> / <slug>
Topics:
  1. "Topic A" — inline prose + 1 SVG graph
  2. "Topic B" — interactive demo (parameter slider) + manim animation
  3. "Topic C" — SVG plot + matplotlib RefImg
Graph schema draft:
  firstGraph:  { param1: { type: "float", min: 0.1, max: 10 } }
  secondGraph: { param2: { type: "float", min: 1,   max: 1000 } }
Overall structure: 3 tabs, medium lesson, expected complexity moderate.
Deploy:
  Action:  push-to-github
  Service: GitHub → workspace-configured host auto-deploy
  Course materials in commit: asked at Phase 5

Options: [approve] [request changes] [abort]
```

**New mode, long plan**:

```
Question: Approve this Lesson Plan for <course> / <slug>?

Body:
Lesson Plan written to:
  <workspace_root>/<course>/claude_lessons/<slug>/lesson_build.log.md
  (see "## Phase 2 — Plan")

Condensed summary:
  7 topics, 12 media items total
  Media mix: 5 SVG graphs, 3 interactive demos, 2 manim videos, 2 matplotlib RefImgs
  Estimated Phase 3 time: ~8 min (2 manim renders dominate)
  Largest topic: "<topic title>" (3 media items)

Review the full plan in the log file before approving.

Options: [approve] [request changes] [abort]
```

**Update mode, short change-list inline**:

```
Question: Approve this Lesson Update Plan for <course> / <slug>?

Body:
LESSON UPDATE PLAN — <course> / <slug>
Research mode: light
Branch: lesson-update/<slug>-YYYYMMDD

TOPICS CHANGING:
  [MODIFY]  topic-2 "<topic title>" — equations changed 1, concepts added 0,
            content removed 0, media actions (keep=1, refine=1, replace=0, remove=0, add=0)

TOPICS UNCHANGED: [KEEP] topic-1, topic-3, topic-4, topic-5

MEDIA ACTIONS:
  KEEP (4):     graphA, demoB, animC, imgD
  REFINE (1):   graphE, svg-graph, topic-2 — <rationale> / graphics-agent

STRUCTURAL DRIFT REPAIRS:
  - GRAPH_SCHEMA backfill: not needed
  - Chatbot props reconcile: none

ROLLBACK:
  - Branch: lesson-update/<slug>-YYYYMMDD
  - Stash: none (working tree clean)
  - Merge to main only on success

DEPLOY:
  Action:  push-to-github
  Service: GitHub → workspace-configured host auto-deploy
  Course materials in commit: N/A (no materials provided)

APPROVE? [approve / request changes / abort]

Options: [approve] [request changes] [abort]
```

**Update mode, long change-list, log pointer**:

```
Question: Approve this Lesson Update Plan for <course> / <slug>?

Body:
Full Update Plan written to:
  <workspace_root>/<course>/claude_lessons/<slug>/lesson_build.log.md
  (see "## Update YYYY-MM-DD > ### Phase 2 — Plan (update)")

Condensed summary:
  Research mode: targeted (named topics re-researched)
  Branch: lesson-update/<slug>-YYYYMMDD

  Topics:  2 modify, 1 add, 0 remove, 0 reorder, 4 keep
  Media:   keep=8, refine=3, replace=1, remove=2, add=4 (18 total media actions)
  Orphans: 3 files (2 keep pre-verdict, 1 remove pre-verdict) — see log for paths

  Structural drift repairs: GRAPH_SCHEMA backfill NEEDED (lesson predates the graph-schema feature)
  Rollback: branch + stash (stash-ref: stash@{0})

  Review the full change-list in the log before approving.

Options: [approve] [request changes] [abort]
```

When orphan count is > 0 and any pre-verdict is `remove`, the condensed summary **must** call out the orphan line so the user sees that files will be deleted from disk before they approve. When all pre-verdicts are `keep` or the orphan list is empty, omit the orphan line to keep the summary compact.

### Request-changes loop

If the user selects **request changes**, main Claude fires a follow-up `AskUserQuestion` asking which items to revise. Example:

```
Question: Which items need revision?

Options:
  [Topic-2 content] — re-run content-orchestrator-agent on topic-2
  [Topic-2 media]   — re-run medium-decider-agent on topic-2 only
  [Global media mix] — re-run medium-decider-agent on all topics
  [Structural drift items] — adjust GRAPH_SCHEMA backfill plan
  [Orphan assets] — flip keep/remove pre-verdicts on one or more orphans
  [Deploy preferences] — change deploy action / service / materials-in-commit default
  [Other — describe]
```

Routing:
- **Content changes** (facts wrong, concept missing, equation incorrect): loop back through `content-orchestrator-agent` for the affected topic only, then re-run the affected `medium-decider-agent` spawn.
- **Media-only changes** (medium type wrong, specialist brief wrong): loop back through `medium-decider-agent` for the affected topic only. Cheaper than re-running content orchestration.
- **Orphan revisions** (flip `keep` ↔ `remove` per file, or flip the whole list): no agent spawn required. Main Claude edits the `ORPHAN ASSETS` subsection of the change-list in place in `lesson_build.log.md` and re-presents the approval gate. A follow-up multi-select `AskUserQuestion` lists each orphan with its current pre-verdict and collects the user's overrides; the edited list is the new source of truth for Phase 3 orphan-asset cleanup.
- **Deploy revisions** (change action, service, or materials handling): no agent spawn required. Main Claude re-asks the Phase 0 deploy-destination question (and its custom-service follow-up when applicable), updates `deploy_action` / `deploy_service` on the scoping artifact in place, rewrites the `DEPLOY:` block of the plan, and re-presents the approval gate. The materials-in-commit decision still happens at Phase 5 — it is intentionally not moved up, because the user may want to see the final file list before deciding whether copyrighted materials ride along.

In every case, the change-list is rewritten in place in `lesson_build.log.md` under the same Phase 2 heading. Main Claude re-prompts with the **revised view** (same AskUserQuestion pattern, same three options). The loop continues until the user approves or aborts. There is no hard loop cap; main Claude flags diminishing returns if the same item gets revised three or more times ("we've been iterating on topic-2 media — do you want to abort and rescope?").

### Abort path

If the user selects **abort**, main Claude:
1. Writes `Approval: ABORTED by user at <timestamp>` to `lesson_build.log.md`.
2. Leaves the log intact (does not delete the Phase 1 or Phase 2 artifacts; they remain for reference).
3. **Does not** proceed to Phase 3. No specialist spawns fire. No files are written to `<lesson_root>/src/`.
4. In update mode, does **not** perform the Phase 3 pre-execution git setup (no branch created, no stash popped). The working tree state from Phase 0 is preserved.
5. Reports the abort to the user with a brief confirmation.

## Handoff to Phase 3

On approval, main Claude has:

1. An **approved Lesson Plan artifact** written to `<lesson_root>/lesson_build.log.md` with an `Approval: APPROVED by user at <timestamp>` line.
2. A **per-topic medium-decider verdict list** aggregated across all Step 2 spawns. Each verdict carries its `specialist` routing field so Phase 3 knows which agent to spawn.
3. **Draft execution plans** from each specialist spawn in Step 3. These become the starting inputs for Phase 3 specialist builds; a specialist spawned in Phase 3 receives its own Phase 2 draft plan plus any refinements from the approval loop.
4. **(Update mode only) A branch-setup directive**: the approved plan's `Branch:` line and `ROLLBACK:` section tell Phase 3 exactly what git branch to create and what stash ref (if any) to honor. Phase 3 Step 1 runs `git checkout -b <branch>` before any specialist spawns.
5. **(Update mode only) An orphan asset verdict list**: the approved `ORPHAN ASSETS` block (if non-empty) hands Phase 3 a concrete `keep | remove` decision per file. Phase 3's orphan-asset-cleanup drift repair (`phase-3-execution.md` drift repair category 3) reads this list — files marked `remove` get deleted, files marked `keep` are left alone and logged as "kept orphans". No orphans list means nothing to do; an all-`keep` list means the cleanup step is a no-op and still logs the skipped category for trace.
6. **Approved deploy intent**: the `DEPLOY:` block's `Action` and `Service` fields are binding for Phase 5. Phase 5 reads them from the plan (not by re-asking) and branches its commit/push logic accordingly. If the user wants to change deploy intent after approval, they interrupt during Phase 3 or 4 and main Claude reopens Phase 2 rather than mutating the contract silently.

Phase 3 branches on mode:

- **New mode**: assembles from scratch. Specialists write to `<lesson_root>/.build-scratch/<topic>-<medium>.jsx`, main Claude assembles final `src/<slug>.jsx` from the scratch outputs plus the skeleton from `references/template.md`.
- **Update mode**: splices into the existing `src/<slug>.jsx`. Specialists write to `<lesson_root>/.build-scratch/{add,refine,replace}/<topic>-<medium>.jsx`. Main Claude performs splice edits against the lesson file in place, walks the verdict list, and runs the post-splice sanity pass.

Phase 2 ends the moment the approval gate clears. Everything downstream operates under the constraint that the plan is the contract and any deviation requires a new approval gate (in practice, Phase 3 and Phase 4 only log deviations; they don't re-prompt the user unless a fundamental flaw surfaces in the fix loop).

