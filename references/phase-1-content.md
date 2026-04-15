# Phase 1: Content Analysis

## Purpose

Phase 1 produces a compiled content package for Phase 2. Driven by `content-orchestrator-agent`, spawned with the Phase 0 scoping artifact. New mode: fresh research across materials and topic-area sources. Update mode: drift/gap diff against existing lesson, branching on `research_depth`. Main Claude reviews the returned package for consistency before Phase 2 handoff.

---

## New-mode content orchestration

### Inputs to `content-orchestrator-agent`

Main Claude passes the following from the scoping artifact:

- `mode: "new"`
- `course`, `slug`
- `audience_level`, `pedagogical_goal`, `scope_of_lesson`
- `provided_materials`: list of file paths (PDFs, ZIPs, slides, problem sets, lecture notes) or `null`
- `materials_scope: "course-only" | "fill-gaps" | "extensions" | null` — load-bearing when materials are provided; main Claude must forward it verbatim. `course-only` caps the orchestrator's research to prerequisite lookups the materials clearly assume; `fill-gaps` lets research fill background and missing derivations but not broaden the topic; `extensions` permits broadening to related topics, deeper treatment, and applications beyond the materials. Pure-research runs (no materials) ignore it.
- `new_lesson_context`: any research scope directives the user gave (rough topic list, textbook to parallel, research depth, number of topics target)

### Procedure

1. **Initial sweep (pure-research only)**: if `provided_materials` is empty, do a rough sweep, report a draft topic list for scope confirmation, then commit to deep research.
2. **Per-resource deep-review teams in parallel**: one per resource. Extract equations, concepts, constants, candidate topic groupings.
3. **Topic-area research via `research-agent`**: parallel with step 2 for topics needing coverage beyond provided materials.
4. **Content dialogue loop with `content-review-agent`**: check alignment with scope/goal/audience. Misalignment triggers corrective rounds.
5. **Gap-fill**: narrow `research-agent` spawns for remaining concepts.
6. **Compile and return**.

### Tactical input-handling notes

Apply inside per-resource deep-review teams and gap-fill `research-agent` spawns.

**Uploaded PDFs / files**:
1. `file <path>` to check type; many lecture PDFs are actually ZIPs.
2. If ZIP: `mkdir -p /tmp/extract/<name> && unzip -o -q <path> -d /tmp/extract/<name>`.
3. Check `manifest.json` for page list and metadata.
4. Scanned PDFs: view page images directly (`/tmp/extract/<name>/N.jpeg`).
5. Text-extractable PDFs: `pdftotext` or `pypdf`.

**Topic-based research (no files)**:
1. `project_knowledge_search` first — highest priority.
2. `web_search` for standard equations, definitions, constants.
3. **Two-source cross-reference**: every non-trivial equation confirmed against ≥2 independent sources before inclusion.

**Quality gate**:
- Every equation has a source (lecture page, textbook section, URL).
- Every variable defined.
- No solutions or numerical answers.
- Concision: every paragraph teaches something. Cut filler. Prefer an equation or diagram over prose.

### New-mode compiled content package schema

Returned by `content-orchestrator-agent` to main Claude:

```
LESSON: <Course> — <Unit Name>
HEADER_TITLE, HEADER_SUBTITLE

TOPIC 1:
  id, tab, title, subtitle
  equations, concepts, constants, comparisons
  graphs_needed, manim_opportunities, interactive_opportunities
  context_string

TOPIC 2: ...

LESSON_CONTEXT: "..."
SOURCES_CONSULTED: [...]
GAPS_REMAINING: [...]
```

`context_string` per topic is the seed for `TOPIC_CONTEXT` in the final lesson file. `LESSON_CONTEXT` is the seed for the `LESSON_CONTEXT` constant consumed by the embedded chatbot.

---

## Update-mode content orchestration

### Existing-media inventory pre-scan (main Claude)

Before spawning `content-orchestrator-agent`, run a deterministic Grep/Glob sweep to produce a structured inventory. The orchestrator consumes the dict; it does not re-discover media.

Paths below are relative to `<lesson_root> = <workspace_root>/<course>/claude_lessons/<slug>/`.

**1. Graph function definitions** — names and line ranges:
```
grep -nE "^function [A-Z][a-zA-Z0-9_]*Graph|^function [A-Z][a-zA-Z0-9_]*\(" src/<slug>.jsx
```
Captures both the `SomethingGraph` naming convention and any bare `function Foo(` top-level definition.

**2. `DEFAULT_GRAPH_PARAMS` keys** — parse the object block:
```
grep -n "const DEFAULT_GRAPH_PARAMS" src/<slug>.jsx
```
Then Read the file from that line forward and parse keys until the matching `};`. Each top-level key corresponds to one interactive graph and its initial parameter set.

**3. `GRAPH_SCHEMA` keys** — parse the object block (may be absent in older lessons):
```
grep -n "const GRAPH_SCHEMA\|export.*GRAPH_SCHEMA" src/<slug>.jsx
```
Then Read forward and parse keys. If this constant is missing, flag `graph_schema_backfill_needed: true` in the inventory — Phase 2's update plan must surface this as a `STRUCTURAL DRIFT REPAIR` item. The backfill depends on the graph-schema feature being present in `_lesson-core/chat/graphSchema.js`; see `graph-schema-guide.md`.

**4. `RefImg` base64 constants** — names only (the blobs are huge, never include them in the inventory dict):
```
grep -n "const IMG_[A-Z0-9_]* =" src/<slug>.jsx
```

**5. Static images**:
```
grep -nE "<img[^>]*src=" src/<slug>.jsx
```
Resolve each `src=` value to a concrete path under `<lesson_root>/public/images/` when it matches that prefix.

**6. Videos**:
```
grep -nE "<video[^>]*src=" src/<slug>.jsx
```
Resolve to `<lesson_root>/public/videos/`.

**7. Interactive demos**:
```
grep -nE "<InteractiveDemo[^>]*title=" src/<slug>.jsx
```
The `title` prop is the stable identifier used to track a demo across updates. `interactive-demo-agent` must not rename it in refine mode.

**8. Manim source scripts**:
```
Glob <lesson_root>/*.py
```
Pair each `.py` with its matching `.mp4` under `public/videos/` by filename stem.

**9. Orphan assets** — files on disk not referenced anywhere in the JSX:
```
Glob <lesson_root>/public/images/*
Glob <lesson_root>/public/videos/*
```
Cross-reference each filename against the JSX src= hits from steps 5-6 and the manim pairings from step 8. Orphans get flagged in the inventory under `orphans: [...]` so main Claude can surface them to the user at review time.

### Inventory schema (structured dict passed to the orchestrator)

```
{
  "lesson_file": "<workspace_root>/<course>/claude_lessons/<slug>/src/<slug>.jsx",
  "lesson_root": "<workspace_root>/<course>/claude_lessons/<slug>/",
  "graph_components": [
    { "name": "ExampleGraph",
      "kind": "svg-graph",
      "source_file": "<workspace_root>/<course>/claude_lessons/<slug>/src/<slug>.jsx",
      "line_range": [142, 210],
      "default_params_key": "exampleGraph",
      "graph_schema_key": "exampleGraph" }
  ],
  "default_graph_params_keys": ["exampleGraph", "secondGraph", ...],
  "graph_schema_keys": ["exampleGraph", "secondGraph", ...],
  "graph_schema_backfill_needed": false,
  "ref_img_constants": [
    { "name": "IMG_EXAMPLE_REFERENCE",
      "kind": "matplotlib-ref",
      "source_file": ".../src/<slug>.jsx",
      "line_range": [440, 445] }
  ],
  "static_images": [
    { "kind": "static-image",
      "src": "/images/example-figure.png",
      "resolved_path": ".../public/images/example-figure.png",
      "source_file": ".../src/<slug>.jsx",
      "line_range": [287, 287] }
  ],
  "videos": [
    { "kind": "manim-video",
      "src": "/videos/example-animation.mp4",
      "resolved_path": ".../public/videos/example-animation.mp4",
      "source_file": ".../src/<slug>.jsx",
      "line_range": [342, 342],
      "manim_source": ".../example_animation.py" }
  ],
  "interactive_demos": [
    { "title": "Example Parameter Explorer",
      "kind": "interactive-demo",
      "source_file": ".../src/<slug>.jsx",
      "line_range": [398, 487],
      "state_hooks": ["exampleParams", "sweepActive"] }
  ],
  "manim_scripts": [".../example_animation.py", ...],
  "orphans": [
    { "path": ".../public/images/old-diagram.png", "reason": "no src= match" }
  ]
}
```

### Inventory field conventions

Two contract notes that matter when phase-2-plan.md hands items to `medium-decider-agent`:

1. **Every media entry carries a `kind` field** matching the `medium-decider-agent` enum: `"svg-graph" | "matplotlib-ref" | "manim-video" | "static-image" | "interactive-demo"`. Main Claude passes the entries verbatim; no translation step needed.
2. **Every media entry carries `source_file` and `line_range`**. `source_file` is the absolute path to the JSX file containing the reference (identical to `lesson_file` for all entries in the current single-file lesson architecture, but included per-entry so specialists can extract source without an extra lookup). `line_range` is `[start, end]` — for components (graph_components, interactive_demos) it spans the full definition; for constants (ref_img_constants) it spans the `const IMG_X = "..."` declaration; for JSX-embedded references (static_images, videos) it is `[line, line]` marking the `<img>` / `<video>` tag.
3. **`interactive_demos` entries also carry `state_hooks`**: a list of `useState` state variable names referenced inside the `<InteractiveDemo>` body. Main Claude Greps the surrounding LessonApp for these when building the `interactive-demo-agent` refine brief (so the agent knows which state is in scope and must not be renamed).

### Inputs to `content-orchestrator-agent` in update mode

Main Claude passes:

- `mode: "update"`
- `existing_lesson_path`: absolute path to `src/<slug>.jsx`
- `existing_lesson_root`: absolute path to `<lesson_root>`
- `existing_media_inventory`: the structured dict above
- `existing_topics`: the `TOPICS` list extracted from the existing JSX
- `research_depth`: `"light"` | `"targeted"` | `"full"`
- `scope_of_change`: `"any"` | `"specific"` | `{ topics: [...] }`
- `new_materials`: any new file paths the user provided with this update
- `concerns`: free-text user concerns captured in scoping
- `lesson_context`: existing `LESSON_CONTEXT` string
- `topic_context`: existing `TOPIC_CONTEXT` map

### Procedure branched on `research_depth`

Under `resource_mode: "full"`, Phase 0 picks `targeted` or `full` for most updates. `light` is reserved for `"limited"` or explicit request. The orchestrator never downgrades below Phase 0's choice.

- **full**: complete new-mode flow — deep-review per resource, `research-agent` per topic, dialogue loop — seeded with existing content as baseline. Longer than `targeted`/`light`; runtime noted in the return.
- **targeted**: same as light plus one `research-agent` per user-named topic with narrow brief.
- **light**: no `research-agent` spawns. Orchestrator reads JSX end-to-end, cross-references the inventory, spawns `content-review-agent` once with concerns + new materials. ~1-2 rounds.

### Drift / gap / redundancy / reorganization classification

After reading existing content and running whichever research branch applies, the orchestrator compares new findings against the existing JSX and classifies every discrepancy into one of four buckets:

- **Drift incidents**: equation mismatches, stale definitions, outdated constants. Each has `{ location, description, severity, source }`.
- **Content gaps**: concepts the user wants added but that have no existing topic coverage.
- **Redundancies**: content flagged for removal (either by user concern or because research revealed it is no longer pedagogically useful).
- **Reorganization opportunities**: topics that should be split, merged, or reordered.

### Per-topic action verdicts

For each existing topic the orchestrator emits one of:

- `keep` — no change needed.
- `modify` — content updates with an explicit change list (equations, concepts, paragraphs).
- `remove` — topic cut from the lesson. **Requires a rationale** or main Claude refuses to proceed in the post-orchestrator consistency check.
- `reorder:<N>` — move to new position N. **N must be bounded**: `N ≤ (current TOPICS length + added topics)`.

For each new topic it emits `add` with a content stub matching the new-mode topic structure (equations, concepts, comparisons, graphs_needed, etc.).

### Per-medium pre-verdicts (advisory)

For each existing medium in the inventory, the orchestrator emits an advisory **pre-verdict**: `keep` | `refine` | `replace` | `remove`. These are **content-motivated guidance only**. `medium-decider-agent` has the final say in Phase 2 and applies the full 5-way taxonomy (keep / refine / replace / remove / add) with tie-break and user-hint rules.

### Update-mode compiled package schema

Extends the new-mode schema with per-topic and per-medium action fields:

```
UPDATE PACKAGE — <Course>/<slug>
MODE: update
RESEARCH_MODE: light | targeted | full

TOPICS:
  - id: "topic-1"
    action: "keep" | "modify" | "remove" | "reorder:<new-position>"
    existing_title, updated_title (if modify), updated_subtitle
    content_changes:
      - { type: equation|concept|paragraph, action: update|add|remove, old, new, rationale }
    media_preverdicts:
      - { existing_name, preverdict, rationale }
      - { new_proposal, preverdict: "add", rationale }
    updated_context_string (for TOPIC_CONTEXT)
  - id: "topic-new-X"
    action: "add"
    title, subtitle, equations, concepts, media_preverdicts

CHANGE_LIST_SUMMARY: { topics_*, media_preverdict_counts }
DRIFT_INCIDENTS: [ { location, description, severity, source } ]
GAPS_REMAINING: [...]
RESEARCH_NOTES: [...]
UNCHANGED_LESSON_CONTEXT / UPDATED_LESSON_CONTEXT
```

### Contract

- `media_preverdicts` are **advisory**. The authoritative decision is `medium-decider-agent`'s verdict in Phase 2.
- `action: "remove"` on a topic **requires a rationale** or main Claude refuses to proceed.
- `reorder:N` must be bounded: `N ≤ current TOPICS length plus added topics`.

---

## Post-orchestrator review (main Claude)

After the orchestrator returns, main Claude runs a consistency check before handing off to Phase 2:

**New-mode**:
- Does the compiled package match the Phase 0 scope (topic count, audience level, pedagogical goal)?
- Are `GAPS_REMAINING` entries tolerable, or do they warrant another orchestrator run?
- Every equation has a source? Every variable defined?

**Update-mode**:
- No topic is marked both `keep` and `remove`.
- No newly-added topic depends on an equation that a different topic marks for removal.
- Every `DRIFT_INCIDENTS` entry is addressed by either a `modify` topic action or a note in `RESEARCH_NOTES`.
- Every `reorder:N` satisfies the bound check.
- Every `action: "remove"` has a rationale.

If any check fails, main Claude requests another orchestrator run with corrective instructions.

---

## Iteration on the orchestrator

Soft iteration limit, not hardcoded. Main Claude may request additional `content-orchestrator-agent` runs if:

- Gaps remain that the previous run could not fill.
- The consistency check flagged contradictions.
- The user provided new material mid-phase.

Each iteration is a fresh spawn with updated inputs. The orchestrator does not maintain state between runs; main Claude carries the context forward by summarizing prior findings in the new spawn prompt.

---

## Handoff to Phase 2

The returned compiled package (new-mode) or update package (update-mode) is the input to Phase 2's medium-decider spawns and Lesson Plan drafting. Phase 2 reads `TOPICS`, `equations`, `concepts`, `graphs_needed`, `manim_opportunities`, `interactive_opportunities`, and (in update mode) the per-topic `action` and per-medium `media_preverdicts` to seed the parallel `medium-decider-agent` spawns. See `phase-2-plan.md` for the handoff details.
