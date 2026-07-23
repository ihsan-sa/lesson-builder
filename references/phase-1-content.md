# Phase 1: Content Analysis

Contents: New-mode orchestration (inputs, procedure, PDF handling, practice-problem extraction, package schema) · Update-mode orchestration (inventory pre-scan, inputs, research-depth branches, drift classification, package schema) · Post-orchestrator review · Handoff to Phase 2.

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

1. **Initial sweep (pure-research only)**: if `provided_materials` is empty and `research_depth` is `rough-sweep-first`, the orchestrator spawn does ONLY the rough sweep and returns a package marked `STATUS: PRELIMINARY` with the draft topic list; main Claude confirms scope with the user, then re-spawns the orchestrator for the deep pass. Subagents cannot pause mid-run for confirmation.
2. **Per-resource deep-review teams in parallel**: one per resource. Extract equations, concepts, constants, candidate topic groupings.
3. **Topic-area research via `research-agent`**: parallel with step 2 for topics needing coverage beyond provided materials. Each `research-agent` makes its own source reliability judgment.
4. **Gap-fill**: narrow `research-agent` spawns for remaining concepts.
5. **Content review pass with `content-review-agent`** over the full compiled findings, gap-fills included, against the scoping artifact. Misalignment triggers corrective rounds — at most 2, with each round's new material covered by the next round's review; remaining issues return in `GAPS_REMAINING` for main Claude to judge.
6. **Compile and return**.

### Tactical input-handling notes

Apply inside per-resource deep-review teams and gap-fill `research-agent` spawns.

**Uploaded PDFs / files**:

PDFs are the most error-prone input type in the pipeline. The `Read` tool has native PDF support — it returns rendered pages as multimodal input, so equations, figures, tables, and multi-column layouts survive intact. **Default to `Read`.** `pdftotext` and `pypdf` silently corrupt math (Greek letters, superscripts, subscripts, fractions, matrix alignment) and layout, and are reserved for bulk programmatic mining only.

1. **Check file type first**: on Unix/Git Bash, `file <path>`. On Windows native PowerShell, inspect the extension and the first bytes (`Get-Content <path> -TotalCount 1`). Many course-provided "PDFs" are actually ZIPs of page images (Panopto exports, scanned lecture captures). On ZIP: extract (`mkdir -p /tmp/extract/<name> && unzip -o -q <path> -d /tmp/extract/<name>` on Unix/Git Bash; `Expand-Archive -Path <path> -DestinationPath <dest>` on Windows native), inspect `manifest.json` for the page list, then `Read` each page image.

2. **True PDFs — use `Read`**:
   - **≤10 pages**: `Read` the file with no `pages` parameter. One call returns all pages.
   - **>10 pages**: the `pages` parameter is REQUIRED, max 20 pages per call. Omitting it errors out. Get the page count first via `pdfinfo <path> | grep Pages` (poppler-utils) if available, else probe with `pages: "1-20"` and keep advancing (`"21-40"`, `"41-60"`, …) until the range returns empty. Example: `Read(file_path="chapter3.pdf", pages="1-20")`.
   - Scanned and text-extractable PDFs are handled identically — Claude sees the rendered page image in both cases. No separate OCR step is needed.

3. **`pdftotext` / `pypdf` fallback** — ONLY for programmatic bulk mining (e.g., regex-scanning equation labels across a 200-page reference, or building an index across many chapters where visual review per page is infeasible). Never for math content, figures, tables, or layout-sensitive material. If extracted text looks garbled, discard it and switch to `Read`.

4. **Verification requirement**: any equation or numerical value produced by a text-extractor must be cross-checked against the `Read`-rendered page before it enters the content package. This is non-optional for math and physics lessons — text-extract corruption is silent and frequently survives into the lesson JSX unless caught here.

**Practice-problem extraction**: alongside equations and concepts, each per-resource deep-review team **must** scan for practice problems — past finals, past midterms, homework questions, problem-set questions, worked examples, in-lecture practice prompts. These are the highest-value calibration content the lesson can offer because they are the actual questions the student will be graded on; no research-fabricated problem can match that signal. For each problem found, extract:
- **statement**: the question verbatim (preserve LaTeX / figures / any given values).
- **source**: provenance tag in `"<Exam or Set> <Year> — Q<N>"` form (e.g., `"Final 2024 — Q3"`, `"PS4 — Q2"`, `"Midterm 2023 — Q5b"`). If the source is ambiguous in the material, log it as `"<filename> p.<page>"` so the student can trace it.
- **topic-tag**: which lesson topic the problem belongs to (map by concept / equation / keyword overlap).
- **difficulty hint**: `intro | core | stretch` (best-effort; intro = uses one named concept, core = standard application, stretch = multi-concept synthesis). Optional; omit when unclear rather than guessing.
- **approach note** (optional): a one-sentence "how to attack this" for students who want a nudge before peeking at the full solution.
- **solution** (required): a full worked solution with each reasoning step shown and the final numerical answer included. Without the solution a practice problem is only half-useful — students need it to check their work and find where their reasoning diverged. Preserve any algebra steps or diagrams the source showed; keep them readable as KaTeX.
- **solution_provenance**: `"from-source"` when the original material included a solution verbatim (past-final solutions appendix, HW solutions key, textbook worked example); `"orchestrator-derived"` when the orchestrator had to work it out because the source only gave the problem. Derived solutions are held to the same two-source-cross-reference bar as other equations — confirm the key intermediate results against ≥2 independent sources before locking the solution in.

If the source material embeds solutions (e.g., a past-final PDF with a solutions appendix or a HW-with-key file), capture them verbatim — they are the authoritative answers the student will be compared against. Do NOT paraphrase numerical answers; preserve significant figures and units exactly. Log `Solutions included from <source>` for trace.

**Rendering note for downstream phases**: practice-problem solutions are rendered inside a collapsed `<CollapsibleBlock label="Solution">` so students are prompted to attempt the problem first, then expand to check. This is a pedagogical convention, not a compromise on completeness. The solution is always present in the DOM; it's just hidden by default until the student clicks.

**Research-fabricated practice problems are forbidden.** Research agents do not make up new exam questions. They may include *textbook* end-of-chapter problems if the user picked `materials_scope: "extensions"` AND the textbook is clearly cited — treat those as practice problems with source tag `"<Textbook> Ch<N> — P<M>"` and the textbook's published solution (if available) or an orchestrator-derived solution with the `"orchestrator-derived"` provenance tag. Under `course-only` and `fill-gaps`, practice problems come exclusively from the user's provided materials.

**Topic-based research (no files)**:
1. Workspace materials first — Glob/Grep sibling lessons, course notes, and any workspace-level references before reaching for the web; the course's own conventions and notation win.
2. Web search for standard equations, definitions, constants (`research-agent` topic-research mode).
3. **Two-source cross-reference**: every non-trivial equation confirmed against ≥2 independent sources before inclusion.

**Quality gate**:
- Every equation has a source (lecture page, textbook section, URL).
- Every variable defined.
- Worked examples and solutions are welcome wherever they teach something (a solved example inside a derivation, a practice-problem section with collapsed solutions, a fully-worked case study). Cut any "here's an answer" block that doesn't extend understanding. The chatbot is separately governed by `LESSON_CONTEXT` — it is a tutor, not an answer key — and that pedagogy stance is not a content constraint: practice-problem cards in the lesson may carry worked solutions provided they are collapsed by default, provenance-marked, and sourced rather than fabricated (per the extraction spec above).
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
  practice_problems: [
    { statement, source, difficulty, approach_hint, solution, solution_provenance }
  ]
  context_string

TOPIC 2: ...

LESSON_CONTEXT: "..."
SOURCES_CONSULTED: [...]
PRACTICE_PROBLEMS_INDEX: [{ topic_id, count, sources: [...] }]
GAPS_REMAINING: [...]
```

`context_string` per topic is the seed for `TOPIC_CONTEXT` in the final lesson file. `LESSON_CONTEXT` is the seed for the `LESSON_CONTEXT` constant consumed by the embedded chatbot.

`practice_problems` is per-topic; the top-level `PRACTICE_PROBLEMS_INDEX` is a summary main Claude forwards into the Phase 2 plan so the user sees totals without reading every problem body at approval time. Empty arrays are fine (topic has no matching problems in the materials) — absence signals to Phase 2 that a "Practice" section should be skipped for that topic, not that one should be fabricated.

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
Then Read forward and parse keys. If this constant is missing, flag `graph_schema_backfill_needed: true` in the inventory — Phase 2's update plan must surface this as a `STRUCTURAL DRIFT REPAIR` item. The backfill depends on the graph-schema feature being present in `_lesson-core/chat/graphSchema.js`; see `references/graph-schema-guide.md`.

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

Two contract notes that matter when `references/phase-2-plan.md` hands items to `medium-decider-agent`:

1. **Every media entry carries a `kind` field** matching the `medium-decider-agent` enum: `"svg-graph" | "matplotlib-ref" | "manim-video" | "static-image" | "interactive-demo"`. Main Claude passes the entries verbatim; no translation step needed.
1b. **Every media entry gains a `purpose` field** — one line on what the medium teaches. The mechanical pre-scan leaves it `null`; the orchestrator fills it during its end-to-end read of the JSX (from surrounding prose, captions, and the component itself). Phase 2 forwards it to the decider as `current_purpose` and it seeds the plan's `original_intent` for kept media.
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
- `scope_of_change`: `"any"` | `"specific"` | `"full-replace"`
- `scope_topics`: the approved topic list from the scoping artifact (required when `scope_of_change == "specific"` — without it the orchestrator cannot know which topics to research)
- `new_materials`: any new file paths the user provided with this update
- `materials_scope`: forwarded verbatim whenever `new_materials` is non-empty (applies at every research depth, including `full`)
- `concerns`: free-text user concerns captured in scoping
- `lesson_context`: existing `LESSON_CONTEXT` string
- `topic_context`: existing `TOPIC_CONTEXT` map

### Procedure branched on `research_depth`

Under `resource_mode: "full"`, Phase 0 picks `targeted` or `full` for most updates. `light` is reserved for `"limited"` or explicit request. The orchestrator never downgrades below Phase 0's choice.

- **full**: complete new-mode flow — deep-review per resource, `research-agent` per topic, dialogue loop — seeded with existing content as baseline. Roughly 5-10x slower than `light`; the orchestrator warns about runtime in its opening prompt so main Claude can confirm with the user if runtime budget matters, and notes actual runtime in the return.
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

The returned compiled package (new-mode) or update package (update-mode) is the input to Phase 2's medium-decider spawns and Lesson Plan drafting. Phase 2 reads `TOPICS`, `equations`, `concepts`, `graphs_needed`, `manim_opportunities`, `interactive_opportunities`, `practice_problems`, and (in update mode) the per-topic `action` and per-medium `media_preverdicts` to seed the parallel `medium-decider-agent` spawns. See `references/phase-2-plan.md` for the handoff details.
