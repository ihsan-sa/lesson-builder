# Phase 3 — Execution

Contents: Shared conventions (scratch dir, private-by-default .gitignore, logging, parallel spawning) · New-mode execution (steps 1-8) · Update-mode execution (git setup, scratch layout, per-specialist contracts, splice algorithm 4.1-4.12) · What not to touch · Handoff to Phase 4.

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

- If `<lesson_root>/.gitignore` is missing, create it with the full block above. (In new mode, Step 6 already copies the template's `.gitignore`, which ships this block.)
- If it exists, append any missing entries. Never remove existing entries — the user may have added project-specific patterns.
- Add any `provided_materials` path that sits under `<lesson_root>/` but outside the default-gitignored directories (e.g., a loose PDF at `<lesson_root>/chapter3.pdf`) as an explicit entry so it's gitignored without moving it.
- Stage `<lesson_root>/.gitignore` at Phase 5 as part of the deploy-safe file set, so the protection persists in the repo.

Override path: if the user wants to force-include a gitignored file in a specific commit, Phase 5's Step 1.5 offers the override prompt, and staging uses `git add -f` — the gitignore entry stays in place so the next run is still protected by default.

Both new and update mode run this step near the tail of Phase 3 (see Step 6.5 new mode; Step 4.11 update mode).

### Log discipline

Write milestones to `lesson_build.log.md` under `## Phase 3 — Execution` (new) or `### Phase 3 — Execution (update)` nested under `## Update YYYY-MM-DD`. Entries: specialists spawned, files written/spliced, splice counts (update), GRAPH_SCHEMA backfill status (update), drift repairs.

### Parallel specialist spawning

One specialist per media item, spawned concurrently. Each spawn prompt = the item's Phase 2 execution brief + the topic's content package (equations, constants, context) + the file-contract line for that specialist (scratch path or on-disk target). Wait for all returns before assembling.

**Degenerate cases**: text-only topics skip specialist spawns; main Claude writes content directly from Phase 1. Fully text-only lessons skip Step 1 entirely. The harness queues concurrent spawns on its own — no manual batching needed; just log the fan-out count.

## New-mode execution

### Step 1: spawn medium specialists

Main Claude reads the approved plan's media list and spawns every specialist concurrently, one per media item (typical 6-topic fan-out: 6-12 graphics, 1-3 manim, 0-2 interactive-demo, 0-4 web-image). Manim spawns follow the build-pipeline file contract in `agents/manim-agent.md`: descriptive snake_case stem, `.py` at `<lesson_root>/<stem>.py`, MP4 at `public/videos/<stem>.mp4` — the persisted `.py` is what keeps future refines possible. Wait for all returns.

### Step 2: collect scratch outputs

Each specialist writes its assigned portion into `<lesson_root>/.build-scratch/`, one file per media item named by its immutable `media_id` from the plan (never per topic-medium — two graphs in one topic would collide):

```
.build-scratch/
  topic-1-diode-iv-curve.jsx
  topic-2-bode-magnitude.jsx
  topic-2-pole-zero-explorer.jsx        (+ topic-2-pole-zero-explorer-wiring.md)
  ...
```

**Exceptions to scratch collection**: manim writes no scratch — its `.py` lands at `<lesson_root>/<stem>.py` and MP4 at `public/videos/<stem>.mp4` per its file contract, and it returns a JSON manifest (`mp4_path`, `py_path`, `effective_action`) that assembly consumes directly. web-image likewise writes straight to `public/images/` and returns paths + provenance.

Main Claude reads each scratch file after the specialist returns and checks for obvious corruption (truncation, unclosed JSX, missing function signature) before moving to assembly. Corrupt output triggers a single respawn of that specialist with the same brief.

### Step 3: assemble from skeleton

Read `references/template.md` to pull the skeleton. Fill in each `REPLACE` marker using the Phase 2 Lesson Plan and the collected specialist outputs:

- **`TOPIC_CONTEXT`** — one entry per topic, keyed by `topic-N`. Must include equations, key variables, given values, and the learning objective. Add a `graph-preview` entry verbatim from the template (the Graph Preview tab's context string).
- **`LESSON_CONTEXT`** — full course and lesson description from Phase 1's compiled package. Single template literal. Carries the chatbot's pedagogy stance (tutor, not answer key).
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
- **`vite.config.js`** — copied verbatim; sets `@core` alias to `path.resolve(__dirname, "../../../_lesson-core")`, `server.fs.allow` for the parent dirs, and `envDir` pointed at the workspace root so the root `.env.local` (`VITE_DESMOS_KEY`) is actually loaded by Vite.
- **`server/proxy.js`** — copied verbatim; one-line shim: `import "../../../../_lesson-core/server/proxy.js";`.
- **`test_lesson.cjs`** — copied verbatim; 17-test QA suite (template compliance, KaTeX safety, Babel parse, etc.).
- **`CLAUDE.md`** — copied from the template with the same placeholder substitutions as the other files (`__SLUG__`, `__SLUG_SNAKE__`, `__COURSE_CODE__`, `__LESSON_TITLE__`); after assembly, fill its `## Lesson App` section with the lesson's scope, topics, and medium inventory.
- **`.gitignore`** — copied verbatim; ships the private-by-default block from the shared convention above. Step 6.5 verifies it and appends lesson-specific entries.
- **`.env.local`** — normally NOT created per-lesson: because `vite.config.js` sets `envDir` to the workspace root, the root `.env.local` (which the user maintains, gitignored) is loaded directly and `VITE_DESMOS_KEY` is available without copying. When the approved plan includes a `<DesmosGraph>` embed, verify the root `.env.local` defines `VITE_DESMOS_KEY`; if it does not, note the gap in the log — the Desmos embed renders a red "key not configured" fallback until the user supplies one. Do NOT check any `.env.local` into git. Before hand-authoring the embed's `state` object, read `references/desmos-schema.md` — `setState` crashes silently on numeric values where Desmos expects LaTeX strings (`sliderBounds.{min,max,step}`, `lineWidth`, `lineOpacity`, `pointSize`, `pointOpacity`, `parametricDomain`/`polarDomain` bounds), and the only way to catch it without the reference is the blank-canvas-plus-console-error symptom.

None of these files reference `@core` internals beyond the alias; they are stable scaffolding.

### Step 6.5: ensure private-by-default `.gitignore`

Apply the "Private-by-default `.gitignore`" shared convention above. Step 6 already copied the template's `.gitignore` with the full default block; verify it matches the convention and append any lesson-specific entries for loose materials files that landed under `<lesson_root>/`. If the file is somehow absent, create it with the full default block. Log the file and the entry count under `Phase 3 — Execution`.

### Step 7: assembly-time quality gate on scratch outputs

The graph-quality rules (component pattern with `{ params, mid = "" }` props and `.eq-block` wrapper, equation-driven curves with realistic constants, no clamping, split scales, unique marker IDs, IBM Plex Mono labels, responsive `viewBox`) are canonical in `agents/graphics-agent.md` — specialists build to them at generation time. Main Claude re-checks the two cheapest-to-catch violations while pasting scratch outputs, because they are the ones that silently corrupt a lesson:

- **Clamp pattern** (`Math.min(value * scale, maxY)` or equivalent hiding overflow): reject the scratch file and respawn the specialist with the violation named. Clamping masks scientific-accuracy bugs downstream review would otherwise catch.
- **Marker-ID collisions** across the assembled file (two graphs sharing `id="arrow"`): fix during assembly via each component's `mid` suffix.

Matplotlib outputs arrive pre-verified by the specialist's own PNG self-view; full visual QA for every medium happens once, in Phase 4 (no separate in-phase review team). On assembly, base64-encode approved PNGs as `const IMG_X = "..."` for `<RefImg data={IMG_X} alt="..." caption="..." />`.

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
  .gitignore
  public/videos/<file>.mp4          (×2)
  public/images/<file>.png          (×3)
GRAPH_SCHEMA: generated from DEFAULT_GRAPH_PARAMS (<N> top-level keys)
Scratch cleanup: done
```

A failed new-mode Phase 3 (Babel parse error, missing specialist return, etc.) leaves `.build-scratch/` in place and logs the failure reason under `Phase 3 — Execution` with `Status: FAILED`. Main Claude halts before Phase 4 and surfaces the failure to the user.

## Update-mode execution

Update mode splices specialist outputs into the **existing** `src/<slug>.jsx` instead of building from a skeleton. The existing file is the source of truth for everything Phase 2 marked `keep`.

### Step 1: pre-execution git setup

Runs **before any specialist spawns**. The stash (if any) already happened at Phase 0, which logged `stashed: stash@{0} (<oid>)` — read that ref from the log; do NOT stash again. Exact commands:

```bash
cd <workspace_root>
git status --short <lesson_root>   # expect clean apart from run-owned files (lesson_build.log.md,
                                   # .gitignore edits this run made — both written since the Phase 0
                                   # check); anything ELSE dirty → halt and surface, don't stash
git rev-parse --abbrev-ref HEAD    # must be the workspace default branch (normally main);
                                   # branching off a feature branch drags unrelated commits into the merge
git checkout -b lesson-update/<slug>-YYYYMMDD   # collision → append -a/-b per the pre-flight checklist
git rev-parse HEAD                 # record as base_sha
```

Log `Branch:` (the ACTUAL name incl. any collision suffix — Phase 5 consumes this recorded value verbatim, never reconstructs it) and `Base SHA:` alongside the stash ref.

Substitutions:
- `<workspace_root>` — absolute path to the monorepo root, typically derived from `git rev-parse --show-toplevel` or provided at Phase 0.
- `<lesson_root>` — absolute path to the lesson directory (e.g. `<workspace_root>/<course>/claude_lessons/<slug>/`). Git expects forward slashes even on Windows.
- `<slug>` — the lesson slug from Phase 0.
- `<date>` — `YYYYMMDD` format.
- `YYYYMMDD` in the branch name — same format as `<date>`.

Log the branch name and stash ref as the **first two lines** under `### Phase 3 — Execution (update)` in `lesson_build.log.md`:

```
Branch: lesson-update/<slug>-YYYYMMDD
Stash ref: stash@{0} (<oid>, lesson-update-stash <slug> <date>) | none   # copied from the Phase 0 log
```

If the working tree was clean at Phase 0, write `Stash ref: none`. If the user aborted on the dirty-tree question, Phase 3 never starts.

### Step 2: scratch directory layout (update-specific)

Update mode splits `.build-scratch/` by action so the assembly splice step can dispatch cleanly; files are named by `media_id`:

```
.build-scratch/
  add/     <media_id>.jsx     new components
  refine/  <media_id>.jsx     refined (same function name preserved)
  replace/ <media_id>.jsx     different medium type
```

`keep` and `remove` actions produce **no scratch files**. Keep is a no-op; remove is handled by main Claude directly during the splice walk (no specialist input needed).

### Step 3: per-specialist update-mode input contract

Each specialist receives different inputs depending on the action verdict from Phase 2. The contracts below are strict: main Claude constructs the spawn prompt with exactly these inputs, no more, no less. Naming note: wherever a contract says `refine_brief` / `replace_brief` / `add_brief`, that is the plan row's `execution_brief` for that action — one value, recorded verbatim from the decider, no transformation.

#### graphics-agent

**refine**: existing component source extracted by line range from the lesson file + current `DEFAULT_GRAPH_PARAMS[<key>]` object + `refine_brief` from Phase 2. Output: revised component with the **same function name** so every call site in the existing `TOPICS` content functions remains valid. For `matplotlib-ref` refines: revised `.py` + new base64 string that will replace the existing `const IMG_X = "..."` constant. Land in `.build-scratch/refine/<media_id>.jsx` (or `<media_id>.py` + `<media_id>.b64` for matplotlib).

**replace**: the Phase 2 brief may specify a new function name (e.g., swapping `OldGraphStatic` for `NewGraphAnimated`). Main Claude notes the old-to-new name mapping so the splice step can update call sites. Output to `.build-scratch/replace/<media_id>.jsx`.

**add**: same pattern as new mode — fresh component with a fresh function name and a fresh `DEFAULT_GRAPH_PARAMS` entry. Output to `.build-scratch/add/<media_id>.jsx`.

#### manim-agent

**refine**: existing `.py` source + existing `.mp4` under `<lesson_root>/public/videos/` + `refine_brief`. Specialist **overwrites the `.py` and `.mp4` at the same paths**, so the JSX `<video src>` reference does not need to change. No scratch file; the splice step simply re-reads the existing `src` attribute and leaves it alone.

**Source-to-video name mismatch**: if the `.py` for a given `.mp4` cannot be located (e.g., the original Python file was never committed, or the `.mp4` was hand-copied from another lesson), degrade the refine to a replace: spawn a fresh manim-agent with the replace brief instead of the refine brief, write a new `.py` + new `.mp4`, and update the JSX `<video src>` during the splice. Log the degradation under `Degradations: <old-filename>: refine → replace (reason: missing source .py)` in the Phase 3 log section.

**replace**: new `.py` + new `.mp4` with a **new filename** (even if the old one is removed). The agent's returned manifest (`mp4_path`, `py_path`, `effective_action`) carries the new paths — no scratch file; main Claude updates the JSX `<video src>` from the manifest during the splice and removes the old `.mp4` from disk.

**add**: same as new-mode manim — fresh `.py` + fresh `.mp4` with a fresh filename. The splice step inserts a new `<video src>` reference in the topic's content function.

#### interactive-demo-agent

**refine**: existing JSX (the `<InteractiveDemo>` block plus its referenced `useState` hooks in `LessonApp`) + `refine_brief`. Output: a COMPLETE revised `<InteractiveDemo>` block + wiring note. **Must preserve the `<InteractiveDemo title="...">` value** — the title is the inventory identifier; changing it breaks Phase 2-to-Phase 3 traceability. Output to `.build-scratch/refine/<media_id>.jsx` + `.build-scratch/refine/<media_id>-wiring.md`.

**replace**: source of the medium being replaced (for context) + `replace_brief`. Output: new complete block + wiring note, same file naming.

#### web-image-agent

**refine**: existing image path + `refine_brief` (e.g., "find a clearer labeled version"). Specialist searches the web, downloads, and either replaces the file at the same path on disk or returns `null` (keep original). If the return is `null`, main Claude treats the refine as a no-op. Output (if successful): file at same path, plus provenance (source URL, license) in the return for the log.

**replace / add**: specialist fetches the new image and writes it under `<lesson_root>/public/images/`. Main Claude deletes the old file during the splice step (replace) or leaves existing files alone (add). Output: new filename + provenance in `.build-scratch/replace/` or `.build-scratch/add/`.

### Step 4: splice assembly algorithm

Main Claude performs the splice against the **existing** `src/<slug>.jsx`. The algorithm is sequential; every step must complete before the next starts.

**Two cross-cutting rules before walking:**

1. **Modify-owns-its-content-function.** For any topic marked `modify`, the 4.3 content-function rewrite must already include the topic's FINAL call sites per the approved media actions — apply it before, and instead of, any 4.2 call-site edit inside that topic's content function. For modify topics, 4.2 touches only the component block, `DEFAULT_GRAPH_PARAMS`/`GRAPH_SCHEMA`, and files on disk. (Otherwise a later content rewrite silently erases the call-site splices.) Topics not marked `modify` take 4.2 call-site edits as written.
2. **Params/schema sub-steps are svg-graph-only.** In the replace/remove/add rules below, the `DEFAULT_GRAPH_PARAMS` and `GRAPH_SCHEMA` steps apply only to `svg-graph` items (plus the `const IMG_*` swap for matplotlib-ref). Videos, static images, and interactive demos have no params/schema entries — for them the splice is call-site + file-on-disk only.

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

**`refine` interactive-demo**: locate the `<InteractiveDemo title="...">` block in the topic's `content` function and replace the ENTIRE block (opening tag through closing tag) with the scratch file contents — the scratch file is always a complete `<InteractiveDemo>` block with the identical title; never insert it inside the existing wrapper. Apply the `-wiring.md` state-hook changes at the `LessonApp` level.

**`replace`** (any kind): more invasive than refine because the function name or component kind may change. The steps dispatch on the OLD and NEW kinds — jsx-kinds (svg-graph, interactive-demo) come from scratch files; manim and web-image come from returned manifests/paths, not scratch:
1. Remove the old medium: jsx-kinds → delete the component definition (function signature / `<InteractiveDemo title>` anchor) plus, for svg-graph, its `DEFAULT_GRAPH_PARAMS[<old_key>]` and `GRAPH_SCHEMA[<old_key>]` entries; manim → delete the old `.mp4` AND its paired `.py` from disk; web-image → delete the old file from disk.
2. Delete the old call site (`<Component/>`, `<video src>`, or `<img src>`) in the topic's `content` function.
3. Insert the new medium: jsx-kinds → the scratch component into the component block (+ wiring note applied at LessonApp level for demos); manim/web-image → nothing to insert in the component block, the asset is already on disk.
4. Insert the new call site at the same approximate position (component call, `<video src={VID + "<stem>.mp4"}>`, or `<img src>` per the new kind).
5. svg-graph only: extend `DEFAULT_GRAPH_PARAMS` and `GRAPH_SCHEMA` with the new key.

**`remove`** (any kind): delete the component definition, delete the call site, delete the `DEFAULT_GRAPH_PARAMS[<key>]` entry, delete the `GRAPH_SCHEMA[<key>]` entry. For manim-video / static-image, also delete the file from disk.

**`add`** (any kind): jsx-kinds → insert the new component from `.build-scratch/add/` (demos: apply the `-wiring.md` hooks at LessonApp level) and add the call site in the correct topic's `content` function; manim/web-image → the asset is on disk per the manifest, add only the `<video>`/`<img>` call site. svg-graph only: extend `DEFAULT_GRAPH_PARAMS` and `GRAPH_SCHEMA`.

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
