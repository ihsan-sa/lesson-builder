# Phase 3 — Execution

## Purpose

Phase 3 takes the approved Lesson Plan and writes the lesson JSX plus project files. It is the only phase that modifies `<lesson_root>/` content, hard-branched on mode: **new** spawns specialists in parallel, collects scratch outputs, assembles `src/<slug>.jsx` from `references/template.md`. **Update** stages a git branch + optional stash, then splices specialist outputs into the existing file using edit anchors (function signatures, `DEFAULT_GRAPH_PARAMS` keys, `TOPICS` entries) while preserving `keep` items. Both end with a `.build-scratch/` cleanup and a post-assembly sanity pass.

## Shared conventions (both modes)

### Scratch directory

All specialist work lands under `<lesson_root>/.build-scratch/`. Gitignored (add `**/.build-scratch/` to workspace `.gitignore` if missing). Deleted after successful assembly; left in place on failure for inspection. One file per specialist output.

### Private-by-default `.gitignore`

The skill treats anything critical or private as **gitignored by default** so deploy-safety is the baseline, not an opt-in. Before handing off to Phase 4, main Claude ensures `<lesson_root>/.gitignore` exists and contains at minimum:

```
# lesson-builder — private by default; override per commit at Phase 5
.build-scratch/
.scratch/
notes/
materials/
source/
*.local
.env
.env.*
lesson_build.log.md
```

Semantics:

- `materials/`, `source/`, `notes/` — user-provided course materials and private notes. Gitignored because these often carry copyright or draft-state risk.
- `.env`, `.env.*`, `*.local` — credentials. Never deploy these.
- `.build-scratch/`, `.scratch/` — specialist scratch output and ad-hoc work.
- `lesson_build.log.md` — per the skill's existing convention (Phase 5 doc), the log stays untracked unless the user opts in.

Management rules:

- If `<lesson_root>/.gitignore` is missing, create it with the full block above.
- If it exists, append any missing entries. Never remove existing entries — the user may have added project-specific patterns.
- Add any `provided_materials` path that sits under `<lesson_root>/` but outside the default-gitignored directories (e.g., a loose PDF at `<lesson_root>/chapter3.pdf`) as an explicit entry so it's gitignored without moving it.
- Stage `<lesson_root>/.gitignore` at Phase 5 as part of the deploy-safe file set, so the protection persists in the repo.

Override path: if the user wants to force-include a gitignored file in a specific commit, Phase 5's Step 1.5 offers the override prompt, and staging uses `git add -f` — the gitignore entry stays in place so the next run is still protected by default.

Both new and update mode run this step near the tail of Phase 3 (see Step 6.5 new mode; Step 4.7 update mode).

### Log discipline

Write milestones to `lesson_build.log.md` under `## Phase 3 — Execution` (new) or `### Phase 3 — Execution (update)` nested under `## Update YYYY-MM-DD`. Entries: specialists spawned, files written/spliced, splice counts (update), GRAPH_SCHEMA backfill status (update), drift repairs.

### Parallel specialist spawning

One specialist per topic per medium, spawned concurrently in a single message. Wait for all returns before assembling. Spawn prompts come from Phase 2 briefs verbatim.

**Degenerate cases**: text-only topics skip specialist spawns; main Claude writes content directly from Phase 1. Fully text-only lessons skip Step 1 entirely.

**Spawn budget**: above ~20 concurrent specialists, split into two batches of ~10. Log batching.

## New-mode execution

### Step 1: spawn medium specialists

Main Claude reads the Phase 2 execution plan and spawns every specialist concurrently. Typical fan-out for a 6-topic lesson: 6-12 graphics-agents (one per graph), 1-3 manim-agents, 0-2 interactive-demo-agents, 0-4 web-image-agents. Wait for all returns.

### Step 2: collect scratch outputs

Each specialist writes its assigned portion into `<lesson_root>/.build-scratch/`:

```
.build-scratch/
  topic-1-graphs.jsx
  topic-1-manim.py
  topic-2-graphs.jsx
  topic-2-interactive.jsx
  ...
```

Main Claude reads each scratch file after the specialist returns and checks for obvious corruption (truncation, unclosed JSX, missing function signature) before moving to assembly. Corrupt output triggers a single respawn of that specialist with the same brief.

### Step 3: assemble from skeleton

Read `references/template.md` to pull the skeleton. Fill in each `REPLACE` marker using the Phase 2 Lesson Plan and the collected specialist outputs:

- **`TOPIC_CONTEXT`** — one entry per topic, keyed by `topic-N`. Must include equations, key variables, given values, and the learning objective. Add a `graph-preview` entry verbatim from the template (the Graph Preview tab's context string).
- **`LESSON_CONTEXT`** — full course and lesson description from Phase 1's compiled package. Single template literal. Reinforces the "explain, do not solve" directive.
- **`DEFAULT_GRAPH_PARAMS`** — one key per graph component. Parameter objects are lifted from specialist outputs. Keys use camelCase matching the graph function name.
- **`TOPICS`** — one entry per tab with `id`, `tab`, `title`, `subtitle`, `content`. The `content` function takes `graphParams` (conventionally named `gp`) and returns JSX. Each topic's `content` body is stitched from its specialist scratch files plus UI primitives from `@core` (`<Section>`, `<P>`, `<Eq>`, `<M>`, `<KeyConcept>`, `<CollapsibleBlock>`, `<RefImg>`).
- **Header title and subtitle** — lesson title and course tagline (both supplied during Phase 0 scoping as free-text fields).
- **`<Chatbot>` props** — see Step 5.

### Step 4: write GRAPH_SCHEMA alongside DEFAULT_GRAPH_PARAMS

Every lesson must export a `GRAPH_SCHEMA` constant next to `DEFAULT_GRAPH_PARAMS`. The two must have **identical top-level keys**. The schema enumerates editable fields for the chatbot's `<<EDIT_GRAPH>>` mechanism. Derive the schema mechanically from `DEFAULT_GRAPH_PARAMS` per `references/graph-schema-guide.md`; do not invent fields that are not in the default params. Example pattern:

```jsx
const DEFAULT_GRAPH_PARAMS = {
  outputChar: { kn: 0.5, vth: 1, vgsValues: [2, 3, 4, 5], showCLM: false, lambda: 0.02 },
};

export const GRAPH_SCHEMA = {
  outputChar: {
    kn:      { type: "float", min: 0.1, max: 5 },
    vth:     { type: "float", min: 0, max: 5 },
    showCLM: { type: "bool" },
    lambda:  { type: "float", min: 0, max: 0.1 },
    // enum example (for a hypothetical mode param):
    // mode: { type: "enum", values: ["triode", "saturation"] },
  },
};
```

Key-mismatch is a code-review blocker in Phase 4, so catch it now.

### Step 5: wire Chatbot props

The `<Chatbot>` call at the bottom of `LessonApp` takes seven required props plus the usual UI-state plumbing:

- **`courseCode`** — the course display code string collected at Phase 0
- **`courseName`** — the full course name collected at Phase 0
- **`lessonContext`** — pass the `LESSON_CONTEXT` constant
- **`topicContext`** — pass the `TOPIC_CONTEXT` object
- **`lessonFile`** — e.g. `"src/<slug_underscored>.jsx"`, used in edit-graph round-trip instructions
- **`graphSchema`** — pass the `GRAPH_SCHEMA` export
- **`graphRenderId`** — pass the `graphRenderId` state (incrementing integer that keys the graph-preview tab so SVG components re-render after `<<EDIT_GRAPH>>` mutates params). Declare `const [graphRenderId, setGraphRenderId] = useState(0);` in LessonApp and have `onEditGraph` call `setGraphRenderId(id => id + 1)` after merging edits.

The remaining props (`topicId`, `topicTitle`, `contextSnippets`, `onClearSnippet`, `onClearAllSnippets`, `open`, `setOpen`, `onEditGraph`, `graphParams`, `addSnippet`, `threadTrigger`, `threadCtxTrigger`) follow the template verbatim.

### Step 6: write project files

Main Claude writes the per-lesson project files by copying the skeleton at `references/bootstrap/lesson-template/` into `<lesson_root>/` and running placeholder substitutions. See `references/bootstrap.md §Lesson scaffolding (Phase 3 of new mode)` for the exact copy + substitution procedure. `references/server-template.md` is the reference documentation of what each file is for; the canonical content ships in `lesson-template/`.

Files produced (sourced from `lesson-template/` unless noted):

- **`package.json`** — React, Vite, KaTeX, express dev dep for the shim. Substitute `__SLUG__` and `__SLUG_SNAKE__`.
- **`index.html`** — Vite entry. Substitute `__COURSE_CODE__` and `__LESSON_TITLE__`. Inject any workspace-level analytics tags per existing sibling lessons (optional).
- **`src/main.jsx`** — 5-line `ReactDOM.createRoot` entry. Substitute `__SLUG_SNAKE__`.
- **`src/<slug_snake>.jsx`** — lesson content. Phase 3 assembles this from `references/template.md` + specialist outputs. The shipped `lesson-template/src/__SLUG_SNAKE__.jsx` is a minimal placeholder that passes only T1+T4; delete it once the real content is in place.
- **`vite.config.js`** — copied verbatim; sets `@core` alias to `path.resolve(__dirname, "../../../_lesson-core")`, plus `server.fs.allow` for the parent dirs.
- **`server/proxy.js`** — copied verbatim; one-line shim: `import "../../../../_lesson-core/server/proxy.js";`.
- **`test_lesson.cjs`** — copied verbatim; 17-test QA suite (template compliance, KaTeX safety, Babel parse, etc.).
- **`CLAUDE.md`** — newly authored, with a `## Lesson App` heading summarizing the lesson's scope, topics, and medium inventory.
- **`.env.local`** — only when the approved plan includes a `<DesmosGraph>` embed. Write `VITE_DESMOS_KEY=<key>` by copying from the repo root's `.env.local` (which the user maintains, gitignored). If the key is not available, main Claude notes the gap in the log and the Desmos embed renders a red "key not configured" fallback until the user supplies one. Do NOT check `.env.local` into git. Before hand-authoring the embed's `state` object, read `references/desmos-schema.md` — `setState` crashes silently on numeric values where Desmos expects LaTeX strings (`sliderBounds.{min,max,step}`, `lineWidth`, `lineOpacity`, `pointSize`, `pointOpacity`, `parametricDomain`/`polarDomain` bounds), and the only way to catch it without the reference is the blank-canvas-plus-console-error symptom.

None of these files reference `@core` internals beyond the alias; they are stable scaffolding.

### Step 6.5: ensure private-by-default `.gitignore`

Apply the "Private-by-default `.gitignore`" shared convention above. For a brand-new lesson this means writing `<lesson_root>/.gitignore` with the full default block, plus any lesson-specific entries for loose materials files that landed under `<lesson_root>/`. Log the file and the entry count under `Phase 3 — Execution`.

### Step 7: tactical wins to preserve from jsx-lesson

The legacy `jsx-lesson` skill accumulated several hard-won graph-quality practices that lesson-builder inherits through the specialist briefs. Main Claude enforces them during assembly by pattern-matching the scratch outputs before pasting them into the lesson file.

**SVG graph implementation pattern**: every graph is a React function component taking `{ params, mid = "" }` props and returning an SVG inside an `.eq-block` container. Axes use arrow-marker defs with **unique marker IDs per graph** (collisions break rendering when two graphs share the same `<marker id="arrow"/>`). All text uses `fontFamily="'IBM Plex Mono'"` at 9-11px. The SVG uses `viewBox` for intrinsic size plus `width: "100%"` and an explicit `maxWidth` for responsive scaling. Example skeleton:

```jsx
function MyGraph({ params, mid = "" }) {
  const p = { ...DEFAULT_GRAPH_PARAMS.myGraph, ...params };
  const w = 460, h = 260;
  return (
    <div className="eq-block" style={{ padding: "16px", overflow: "hidden" }}>
      <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", maxWidth: w, display: "block", margin: "0 auto" }}>
        <defs>
          <marker id={`arrow-mygraph-${mid}`} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6" fill="none" stroke={G.ax} strokeWidth="1"/>
          </marker>
        </defs>
        {/* axes, curves, labels */}
      </svg>
    </div>
  );
}
```

**Equation fidelity**: curves must be generated from the actual governing equation with physically realistic constants. Diode curves need a saturation current `Is` (e.g., `1e-14 A`) so the knee falls at the textbook `~0.6 V`. MOSFET transfer characteristics need `Vth` and the piecewise triode/saturation split. Bode plots use `Math.log10` not hand-drawn asymptotes. **Never use `Math.min(id * scale, maxY)` clamping to hide overflow**; if the curve clips, the scale is wrong, and clamping will mask a scientific-accuracy bug that visual-QA will catch later anyway. Reject any scratch file that uses the clamp pattern and respawn the specialist.

**Scale design**: for mixed-range axes (e.g., diode forward `mA` + reverse `µA`), use **split scales** via two SVG subplots side by side, not a single compressed axis. Distinct curves in a family plot must be separated by at least 150 px at the widest point so the student can visually distinguish them. Y-axis units are always chosen for practical readability: `mA` not `A`, `dB` not linear magnitude, `µA` for reverse-bias, `ps` or `ns` for sub-millisecond timing.

**Matplotlib visual review loop** (for `matplotlib-ref` media):

1. Python specialist writes matplotlib code, saves PNG at `dpi=150` with `bbox_inches='tight'`.
2. Specialist views the PNG.
3. Specialist spawns a 3-agent review team in parallel:
   - **Readability**: font ≥ 9, no overlapping labels, legend in empty space, title present, annotations clear.
   - **Correctness**: curve shapes match expected physics, critical points correct (diode knee at 0.6 V, -3 dB at ω0), region labels and axis units correct.
   - **Scale**: nothing clipped/clamped, distinct curves separated, practical units, split panels for multi-scale.
4. Any flag → fix, re-render, re-review. No iteration cap.
5. On approval: base64-encode as `const IMG_X = "..."` and pass to `<RefImg data={IMG_X} alt="..." caption="..." />`.

**Graph Preview tab** (mandatory last tab): renders every graph in one scrollable view. Screenshot target for post-deploy verification and the student's "send this to chat for review" flow. TOPIC_CONTEXT entry is the verbatim template string.

### Step 8: post-assembly cleanup

After the assembled `src/<slug>.jsx` is written:

1. Delete `<lesson_root>/.build-scratch/` recursively.
2. Log specialists spawned, files written, and the lesson file line count.
3. Hand off to Phase 4.

**New-mode log format** — write under `## Phase 3 — Execution`:

```
Specialists spawned: graphics-agent×8, manim-agent×2, interactive-demo-agent×1, web-image-agent×3
Files written:
  src/<slug>.jsx                    (L lines)
  package.json
  index.html
  src/main.jsx
  vite.config.js
  server/proxy.js
  test_lesson.cjs
  CLAUDE.md
  public/videos/<file>.mp4          (×2)
  public/images/<file>.png          (×3)
GRAPH_SCHEMA: generated from DEFAULT_GRAPH_PARAMS (<N> top-level keys)
Scratch cleanup: done
```

A failed new-mode Phase 3 (Babel parse error, missing specialist return, etc.) leaves `.build-scratch/` in place and logs the failure reason under `Phase 3 — Execution` with `Status: FAILED`. Main Claude halts before Phase 4 and surfaces the failure to the user.

## Update-mode execution

Update mode splices specialist outputs into the **existing** `src/<slug>.jsx` instead of building from a skeleton. The existing file is the source of truth for everything Phase 2 marked `keep`.

### Step 1: pre-execution git setup

Runs **before any specialist spawns**. Exact commands:

```bash
cd <workspace_root>
git status --short <lesson_root>
# if dirty and user opted to stash in Phase 0:
git stash push --include-untracked -m "lesson-update-stash <slug> <date>" -- <lesson_root>
git checkout -b lesson-update/<slug>-YYYYMMDD
git status --short
```

Substitutions:
- `<workspace_root>` — absolute path to the monorepo root, typically derived from `git rev-parse --show-toplevel` or provided at Phase 0.
- `<lesson_root>` — absolute path to the lesson directory (e.g. `<workspace_root>/<course>/claude_lessons/<slug>/`). Git expects forward slashes even on Windows.
- `<slug>` — the lesson slug from Phase 0.
- `<date>` — `YYYYMMDD` format.
- `YYYYMMDD` in the branch name — same format as `<date>`.

Log the branch name and stash ref as the **first two lines** under `### Phase 3 — Execution (update)` in `lesson_build.log.md`:

```
Branch: lesson-update/<slug>-YYYYMMDD
Stash ref: stash@{0} (lesson-update-stash <slug> <date>) | none
```

If the working tree was clean at Phase 0, write `Stash ref: none`. If the user aborted on the dirty-tree question, Phase 3 never starts.

### Step 2: scratch directory layout (update-specific)

Update mode splits `.build-scratch/` by action so the assembly splice step can dispatch cleanly:

```
.build-scratch/
  add/     topic-N-<medium>.jsx     new components
  refine/  topic-N-<medium>.jsx     refined (same function name preserved)
  replace/ topic-N-<medium>.jsx     different medium type
```

`keep` and `remove` actions produce **no scratch files**. Keep is a no-op; remove is handled by main Claude directly during the splice walk (no specialist input needed).

### Step 3: per-specialist update-mode input contract

Each specialist receives different inputs depending on the action verdict from Phase 2. The contracts below are strict: main Claude constructs the spawn prompt with exactly these inputs, no more, no less.

#### graphics-agent

**refine**: existing component source extracted by line range from `src/<slug>.jsx` + current `DEFAULT_GRAPH_PARAMS[<key>]` object + `refine_brief` from Phase 2. Output: revised component with the **same function name** so every call site in the existing `TOPICS` content functions remains valid. For `matplotlib-ref` refines: revised `.py` + new base64 string that will replace the existing `const IMG_X = "..."` constant. Land in `.build-scratch/refine/topic-N-graphs.jsx` (or `topic-N-graphs.py` + `topic-N-graphs.b64` for matplotlib).

**replace**: the Phase 2 brief may specify a new function name (e.g., swapping `OldGraphStatic` for `NewGraphAnimated`). Main Claude notes the old-to-new name mapping so the splice step can update call sites. Output to `.build-scratch/replace/topic-N-graphs.jsx`.

**add**: same pattern as new mode — fresh component with a fresh function name and a fresh `DEFAULT_GRAPH_PARAMS` entry. Output to `.build-scratch/add/topic-N-graphs.jsx`.

#### manim-agent

**refine**: existing `.py` source + existing `.mp4` under `<lesson_root>/public/videos/` + `refine_brief`. Specialist **overwrites the `.py` and `.mp4` at the same paths**, so the JSX `<video src>` reference does not need to change. No scratch file; the splice step simply re-reads the existing `src` attribute and leaves it alone.

**Source-to-video name mismatch**: if the `.py` for a given `.mp4` cannot be located (e.g., the original Python file was never committed, or the `.mp4` was hand-copied from another lesson), degrade the refine to a replace: spawn a fresh manim-agent with the replace brief instead of the refine brief, write a new `.py` + new `.mp4`, and update the JSX `<video src>` during the splice. Log the degradation under `Degradations: <old-filename>: refine → replace (reason: missing source .py)` in the Phase 3 log section.

**replace**: new `.py` + new `.mp4` with a **new filename** (even if the old one is removed). Main Claude updates the JSX `<video src>` during the splice step to point at the new file, and removes the old `.mp4` from disk. Output the new filename under `.build-scratch/replace/topic-N-manim.txt` so the splice step can read the new path.

**add**: same as new-mode manim — fresh `.py` + fresh `.mp4` with a fresh filename. The splice step inserts a new `<video src>` reference in the topic's content function.

#### interactive-demo-agent

**refine**: existing JSX fragment extracted by line range (the `<InteractiveDemo>` block plus its referenced `useState` hooks in `LessonApp`) + `refine_brief`. Output: revised JSX fragment + a `wiring_note.md` describing which state hooks change (if any). **Must preserve the outer `<InteractiveDemo title="...">` value** — the title is used as the inventory identifier, and changing it breaks the Phase 2-to-Phase 3 traceability. Output to `.build-scratch/refine/topic-N-interactive.jsx` + `.build-scratch/refine/topic-N-interactive-wiring.md`.

**replace**: source of the medium being replaced (for context) + `replace_brief`. Output: new fragment + wiring note.

#### web-image-agent

**refine**: existing image path + `refine_brief` (e.g., "find a clearer labeled version"). Specialist searches the web, downloads, and either replaces the file at the same path on disk or returns `null` (keep original). If the return is `null`, main Claude treats the refine as a no-op. Output (if successful): file at same path, plus a `.build-scratch/refine/topic-N-webimg.txt` with the new image's provenance URL for the log.

**replace / add**: specialist fetches the new image and writes it under `<lesson_root>/public/images/`. Main Claude deletes the old file during the splice step (replace) or leaves existing files alone (add). Output: new filename + provenance in `.build-scratch/replace/` or `.build-scratch/add/`.

### Step 4: splice assembly algorithm

Main Claude performs the splice against the **existing** `src/<slug>.jsx`. The algorithm is sequential; every step must complete before the next starts.

#### Edit-anchor reference

The splice algorithm relies on pattern-based anchors rather than line numbers, so the algorithm is stable across small file edits between Phase 2 and Phase 3. Anchor patterns:

| Anchor | Regex-ish pattern | Used for |
|---|---|---|
| Graph function definition | `^function <Name>\(\{ params, mid = "" \}\) \{` | refine / replace / remove of svg-graph components |
| Lesson-specific helper definition | `^function <Name>\(` (no `{ params, mid }` signature) | lesson-local helpers (e.g., `HWQuestion`) |
| DEFAULT_GRAPH_PARAMS entry | `  <key>: \{` inside `const DEFAULT_GRAPH_PARAMS = \{` block | parameter add / update / remove |
| GRAPH_SCHEMA entry | `  <key>: \{` inside `export const GRAPH_SCHEMA = \{` block | schema add / update / remove |
| matplotlib base64 constant | `^const IMG_<UPPER_NAME> = "` | matplotlib-ref refine |
| TOPICS array entry | `\{ id: "topic-<N>", tab: "` | topic add / remove / reorder |
| TOPIC_CONTEXT entry | `  "topic-<N>": \`` or `  "topic-<N>": "` | TOPIC_CONTEXT edit |
| LESSON_CONTEXT constant | `^const LESSON_CONTEXT = \`` | Phase 1 LESSON_CONTEXT update |
| Chatbot invocation | `<Chatbot$` (multiline) | props reconcile |
| InteractiveDemo wrapper | `<InteractiveDemo title="<title>"` | interactive-demo refine / replace |
| Video source tag | `<video[^>]*src=\{VID \+ "<filename>"\}` | manim replace src update |
| Header title | `<h1>.*</h1>` inside the `.header` div | new-mode title fill-in, update-mode slug rename guard |

Use these anchors as Grep patterns when walking the file. If an anchor fails to match (e.g., the file diverged from the template), surface the mismatch instead of blindly substituting.

#### 4.1 Read the lesson file into memory

Full file read, no offset. A 2000–3000-line lesson is ~60–100 KB; well within budget. Keep the lesson file text as a single string and record its original line count for the delta log.

#### 4.2 Walk the existing media inventory

Iterate over the Phase 2 media inventory in the order the items appear in the JSX. For each item, apply the splice rule that matches its kind and verdict:

**`keep`** (any kind): no edit.

**`refine` svg-graph**: locate the component by function signature anchor:

```
function <FunctionName>({ params, mid = "" }) {
```

Replace the component body (from the opening `{` to the matching closing `}`) with the scratch file contents. Function name is preserved, so existing call sites like `<MyGraph params={gp.myGraph} />` remain valid without edits. Also update `DEFAULT_GRAPH_PARAMS[<key>]` if the refine changed parameter shape, and update `GRAPH_SCHEMA[<key>]` to match.

**`refine` matplotlib-ref**: locate the base64 constant by anchor:

```
const IMG_<UPPER_NAME> = "iVBOR...";
```

Replace the string literal with the new base64. No other edits.

**`refine` manim-video**: no JSX edit. The `.py` and `.mp4` were overwritten on disk in step 3. Verify the `<video src>` attribute still points at the existing file (grep for the filename in the JSX to confirm).

**`refine` static-image**: same as manim-video — file replaced on disk, no JSX edit unless the file extension changed.

**`refine` interactive-demo**: locate the `<InteractiveDemo title="...">` block in the topic's `content` function, replace the inner JSX fragment with the scratch file contents, apply the `wiring_note.md` state-hook changes at the `LessonApp` level.

**`replace`** (any kind): more invasive than refine because the function name or component kind may change.
1. Delete the old component definition (function signature anchor) and any associated `DEFAULT_GRAPH_PARAMS[<old_key>]` entry and `GRAPH_SCHEMA[<old_key>]` entry.
2. Delete the old call site in the topic's `content` function.
3. Insert the new component from the scratch file in the component block (alongside existing components, not in a random location).
4. Insert the new call site in the topic's `content` function at the same approximate position as the old one.
5. Extend `DEFAULT_GRAPH_PARAMS` with the new `<new_key>` entry.
6. Extend `GRAPH_SCHEMA` with the matching new entry.

**`remove`** (any kind): delete the component definition, delete the call site, delete the `DEFAULT_GRAPH_PARAMS[<key>]` entry, delete the `GRAPH_SCHEMA[<key>]` entry. For manim-video / static-image, also delete the file from disk.

**`add`** (any kind): insert the new component (from `.build-scratch/add/`), add the call site in the correct topic's `content` function, extend `DEFAULT_GRAPH_PARAMS` and `GRAPH_SCHEMA`.

#### 4.3 Walk topic actions

Iterate over the Phase 2 topic change-list:

- **`modify`**: update the TOPIC_CONTEXT entry for `topic-N` and rewrite the `content` function body. Preserve the `id`, `tab`, `title`, `subtitle` fields unless Phase 2 explicitly renamed them.
- **`add`**: insert a new TOPICS array entry at the Phase 2-specified position, add a new TOPIC_CONTEXT entry keyed by the new `topic-N` id, insert any new components the topic references (these come from `.build-scratch/add/`).
- **`remove`**: delete the TOPICS array entry and the matching TOPIC_CONTEXT entry. **Media referenced only by the removed topic and marked for removal** gets deleted from the component block; **media referenced by multiple topics** is preserved even if the current topic is gone. Track the cross-reference count as you walk. This is a common source of silent breakage.
- **`reorder`**: reorder the TOPICS array entries in place. TOPIC_CONTEXT keys stay the same (they are IDs, not indices), so no reshuffle there.

**Worked example — remove with media cascade**: user removes `topic-3`, which references `GraphA`, `GraphB`, `GraphC`, `GraphD`. Change-list marks all four for removal. Walking other topics, `GraphC` is also used in `topic-5`. Splice:
1. Delete TOPICS entry for `topic-3` and `TOPIC_CONTEXT[topic-3]`.
2. Delete `GraphA`, `GraphB`, `GraphD` definitions and their params/schema entries.
3. **Preserve `GraphC`** — def, params, schema, and its `topic-5` call site.
4. Delete the `GraphC` call site inside `topic-3`.

Post-splice sanity pass verifies `GraphC` still has a definition and call site, and no dangling `gp.graphA|B|D` references remain.

#### 4.4 Update the graph-preview tab

Commonly missed. The `graph-preview` tab's `content` function renders every graph for screenshot verification. If refine/replace/add/remove changed the graph set, rewrite the content body to include **all final graphs** (kept + refined + replaced + added, minus removed). Missing this step means new graphs do not appear in visual-QA screenshots.

#### 4.5 Splice updated LESSON_CONTEXT if Phase 1 changed it

If Phase 1's content analysis updated the `LESSON_CONTEXT` string (e.g., because the lesson's unit scope shifted), locate the `LESSON_CONTEXT` constant and replace its template literal with the Phase 1 output. If Phase 1 reported no change, skip this step.

#### 4.6 Post-splice sanity pass

This is the backstop against silent splice corruption. Run all checks; fail loudly if any fails. A failure at this step halts Phase 3 and surfaces to the user before Phase 4 runs.

1. **Babel parse**: run `npx babel src/<slug>.jsx --presets @babel/preset-react --no-babelrc` (or the equivalent parse-only call) and check exit code 0. Babel parse catches syntax errors (unclosed JSX, mismatched braces, stray commas from a bad splice).
2. **Call-site to definition**: Grep every `<GraphName ` call site in the JSX. For each, Grep for a matching `function GraphName` definition. Fail if any call site lacks a def.
3. **DEFAULT_GRAPH_PARAMS to usage**: for every key in `DEFAULT_GRAPH_PARAMS`, Grep for `gp.<key>` in the TOPICS content functions. Fail if any key is unused. Dead keys indicate an incomplete remove splice.
4. **GRAPH_SCHEMA to DEFAULT_GRAPH_PARAMS key match**: extract the top-level keys of both and diff. Fail if the sets are not identical. Chatbot `<<EDIT_GRAPH>>` relies on this invariant.
5. **Line count delta sanity**: if the delta exceeds ±25% of the original file size, pause and warn. Large deltas are legitimate in full-mode updates, but a 2x blowup usually means a copy-paste duplication.

#### 4.7 GRAPH_SCHEMA backfill if missing

Lessons that predate the graph-schema feature do not export `GRAPH_SCHEMA`. Detect by Grep for `export const GRAPH_SCHEMA`. If missing:

1. Generate a `GRAPH_SCHEMA` from the current `DEFAULT_GRAPH_PARAMS` per the derivation rules in `references/graph-schema-guide.md` (boolean default → `{ type: "bool" }`, integer default → `{ type: "int", min, max }`, non-integer number default → `{ type: "float", min, max }` with heuristics for typical ranges, enumerable string default → `{ type: "enum", values: [...] }`, free-form string default → `{ type: "string" }`). The runtime validator at `_lesson-core/chat/graphSchema.js` accepts only these 5 types; `"number"` / `"boolean"` / `"number[]"` will fail with `"unknown schema type"`.
2. Insert the export right after `DEFAULT_GRAPH_PARAMS` in the component block.
3. Log as a **drift-repair** item under `Drift repairs:` in the Phase 3 log section.
4. Phase 2's approval gate should already have surfaced this to the user under "structural drift repairs"; if it did not (e.g., a narrow light-mode update that skipped the full plan view), surface it now as a post-hoc notice.

#### 4.8 Chatbot props reconcile

Check the `<Chatbot>` JSX invocation for the seven required props: `courseCode`, `courseName`, `lessonContext`, `topicContext`, `lessonFile`, `graphSchema`, `graphRenderId`. For each missing or stale prop:

- **`courseCode` / `courseName`**: cross-check against the workspace-level `CLAUDE.md` course list (typically `<workspace_root>/.claude/CLAUDE.md` or `<workspace_root>/CLAUDE.md`). Update if stale.
- **`lessonContext` / `topicContext`**: confirm they reference the in-file constants, not stale inlined strings.
- **`lessonFile`**: must match `src/<slug>.jsx` for the current slug. Update if renamed.
- **`graphSchema`**: must pass the `GRAPH_SCHEMA` export. Add if missing (common on lessons that predate the graph-schema feature).
- **`graphRenderId`**: must pass the `graphRenderId` state. If missing, add `const [graphRenderId, setGraphRenderId] = useState(0);` to LessonApp and have `onEditGraph` call `setGraphRenderId(id => id + 1)` after merging edits. Common on lessons that predate the graph-schema feature.

Log any reconcile edits as **drift-repair** items.

#### 4.9 Orphan asset cleanup

Read the approved `ORPHAN ASSETS` verdict list from the Phase 2 change-list (written to `lesson_build.log.md` under `### Phase 2 — Plan (update)`). For each entry:

1. **`keep` verdict**: no-op. Log `Kept orphan: <path>` for trace. File stays on disk.
2. **`remove` verdict**: delete the file. Bash `rm -- <absolute-path>`. Verify the file actually existed before the call (a missing file is a trace-worthy anomaly, not a failure — log `Orphan already absent: <path>` and move on). After removal, confirm via `ls` that the file is gone.

Edge cases:
- **Orphan is a manim `.py` source** under `<lesson_root>/` root (not `public/videos/`): removing the `.py` is safe as long as the paired `.mp4` is also being removed or was never present. If the `.mp4` exists and is referenced in JSX, the `.py` is NOT an orphan — the inventory pre-scan in Phase 1 would have paired them. Trust the pre-scan; do not re-verify pairing here.
- **Orphan is referenced by a soon-to-be-added topic**: impossible by construction. The Phase 1 inventory marks orphans as "no JSX reference in the current file"; Phase 3 add splices happen earlier in step 4 than this cleanup step, so any file that a new topic pulls in is no longer an orphan by this point.
- **File is read-only or locked**: halt the cleanup step, log `Orphan cleanup blocked: <path> — <error>`, and surface at Phase 5 as an unresolved item. Do not retry; do not bypass with force flags.

If the approved change-list had no `ORPHAN ASSETS` section (empty inventory `orphans: []`), skip this step entirely and log nothing under the drift-repair category. If the section existed and all verdicts were `keep`, log `Orphan asset cleanup: all kept (N files)` for trace.

Output: a count of files removed and a count of files kept, both surfaced in the Phase 3 log summary line below and in the Phase 5 final report.

#### 4.10 Log splice counts

Write a single summary line under `### Phase 3 — Execution (update)`:

```
Splice counts: refine=N, replace=M, remove=P, add=Q
Lesson file delta: +A / -B lines (was L0, now L1)
Orphan cleanup: removed=R, kept=K (or "none" if orphans list was empty)
Drift repairs: GRAPH_SCHEMA backfill | Chatbot props reconcile | orphan asset cleanup | none
```

#### 4.11 Ensure private-by-default `.gitignore`

Apply the "Private-by-default `.gitignore`" shared convention from the top of this document. Append any missing default entries to `<lesson_root>/.gitignore`; create it if absent. Also append an explicit entry for any newly attached `provided_materials` path that sits under `<lesson_root>/` but isn't already matched by a default directory entry. Never remove existing entries — the user may have added project-specific patterns.

Log `.gitignore updated: <N entries appended>` or `.gitignore already covers all private paths` under drift-repairs for trace.

#### 4.12 Clean up .build-scratch/

Delete `<lesson_root>/.build-scratch/` recursively. If any scratch file was not consumed during the splice, log it as an `unconsumed-scratch` warning (a specialist was spawned but its output was not applied — usually a plan-vs-execution mismatch worth surfacing).

### What NOT to touch in update mode

Unless explicitly broken or materially stale, leave these files alone:

- `package.json`
- `index.html`
- `vite.config.js`
- `server/proxy.js` shim
- `src/main.jsx`
- `test_lesson.cjs`
- `CLAUDE.md`

A typical update run leaves all of them untouched. If a specialist flags one of them as broken (e.g., a stale `@core` alias path because the lesson was hand-copied from a different course), log the repair under **Drift repairs** and fix it, but do not rewrite the file wholesale.

### Drift repair items to log

Update mode's splice assembly has three standard drift-repair categories; log them explicitly so Phase 5 can include them in the final report:

1. **GRAPH_SCHEMA backfill** — lesson predated the graph-schema feature, schema generated during Phase 3.
2. **Chatbot props reconcile** — one or more props were missing or stale, updated during Phase 3.
3. **Orphan asset cleanup** — files present on disk but not referenced in JSX (discovered by the Phase 2 inventory Glob), cleaned up if Phase 2 marked them for removal.

## Handoff to Phase 4

When Phase 3 exits:

- **New mode**: `src/<slug>.jsx` is fully written, project files are in place, `.build-scratch/` is gone, `lesson_build.log.md` has a `## Phase 3 — Execution` section with specialists spawned and files written.
- **Update mode**: `src/<slug>.jsx` has been spliced against the approved change-list, the git branch `lesson-update/<slug>-YYYYMMDD` holds the pending commit, `.build-scratch/` is gone, and `lesson_build.log.md` has a `### Phase 3 — Execution (update)` section with branch name, stash ref, splice counts, and drift repairs.

Phase 4 runs parallel reviews (code, content, test, visual-QA) against the post-execution lesson file. See `references/phase-4-review.md` for review mechanics, the progress-aware fix loop, and the update-mode no-grandfathering and regression-watch rules.
