# Course curation — incrementally built courses

Contents: §1 Purpose · §2 Course context (`COURSE.md`) · §3 The course materials inbox · §4 Chunk triage · §5 Batching pending chunks · §6 `consolidate` — cross-lesson restructure · §7 Gates when nobody is at a terminal · §8 Course-map write-back · §9 Common gotchas · §10 Phase cross-reference.

Read this whenever the workspace has a `<workspace_root>/<course>/COURSE.md`, whenever material arrives in chunks over a term rather than as one hand-off, or whenever the request uses a restructure verb (`restructure`, `re-split`, `consolidate`, `merge lessons`, `split this lesson`, `re-balance the course`).

Cross-reference: `SKILL.md` holds the mode-detection summary, the session-mode rule, and the phase shell. `references/update-mode.md` is the lesson-level orientation — the 5 media actions, branch/stash/merge invariants, no-grandfathering. This doc adds the layer above a single lesson: where a new chunk of material belongs, when to build, and how to restructure a course without hand-editing five lessons in five uncoordinated runs. Nothing here is required — a workspace with no `COURSE.md` runs exactly as before.

## 1. Purpose

Update mode is lesson-scoped by construction: it reads one `<lesson_root>`, diffs it against new intent, and splices. It has no view of the course, so it cannot decide *which* lesson a new chunk belongs to, cannot see that two lessons now teach the same topic, and cannot re-split a unit whose boundaries moved. Course curation supplies that view:

- **Course context** — a `COURSE.md` the pipeline reads at Phase 0 for the lesson map, the course's conventions, the pending chunks, and the materials index.
- **Chunk triage** — a decision, per arriving chunk, between *refine an existing topic*, *add a topic to an existing lesson*, *build a new lesson*, and *restructure*.
- **Batching** — the rule for when accumulated chunks are worth a build run, because a run's cost is fixed and mostly independent of how small the chunk was.
- **`consolidate`** — an update-mode variant that plans a cross-lesson restructure once, takes one approval for the whole course plan, and then executes it lesson by lesson through the ordinary update pipeline.

## 2. Course context — `COURSE.md`

When `<workspace_root>/<course>/COURSE.md` exists, Phase 0 reads it **before** asking anything, and every field it supplies is one the interview no longer has to ask (see `references/phase-0-scoping.md` § Course context). It is owned by the user (or by whatever session curates the course); the pipeline reads it and writes back only the two mechanical fields in §8.

Sections the pipeline reads. All are optional — a missing section means "fall back to the normal behaviour for that field", never an error:

| Section | What the pipeline takes from it |
|---|---|
| `## Outline` | the course's own unit list — the authority on what a "unit" is, used by triage and by `consolidate` |
| `## Lesson map` | one row per lesson: slug · outline unit(s) covered · topic count · status (`planned` / `building` / `live` / `needs-update`) · notes. Resolves which lesson a chunk targets, and which lessons a restructure touches |
| `## Conventions` | notation, symbol choices, audience level, pedagogical goal, depth, media preferences, slug/numbering pattern. Populates the scoping artifact and rides into specialist briefs |
| `## Pending chunks` | filed-but-unbuilt material: date · files · one-line note · target lesson (or `unassigned`) · triage verdict once decided (§4) |
| `## Materials index` | one row per file in the inbox: path · what it covers · which lesson consumed it |
| `## Open questions` | unresolved course-level questions. Surface relevant ones at the approval gate; never answer them silently |

Anything else in the file belongs to the user — read it for context, never rewrite it.

**Sibling-lesson conventions come from the map, not from a Glob.** Where Phase 0 and Phase 1 today infer conventions by reading a sibling lesson (`course_name`, notation, `model_after`, numbering), prefer the map: `## Conventions` is the stated rule, and `model_after` defaults to the previous `live` row in the map. Fall back to globbing siblings only when the section is missing. A stated convention beats an inferred one — an inferred convention is just the last lesson's accident.

**A course-level `CLAUDE.md`, if the workspace has one, still wins on repo-mechanical rules** (legacy-lesson lists, build commands). `COURSE.md` is about the course's content and shape, not about how the repo works.

## 3. The course materials inbox

Two directories named `materials/` exist in an incremental course and they are not the same thing:

| | `<workspace_root>/<course>/materials/` | `<lesson_root>/materials/` |
|---|---|---|
| Scope | the whole course | one lesson |
| Written by | the user / the curating session, as material arrives | copied in for a single build |
| Tracked | **committed** by convention — it is the durable copy of material that may exist nowhere else | gitignored, private-by-default (`references/phase-3-execution.md`) |
| Naming | `YYYY-MM-DD-<name>.<ext>` — the date is the filing date, so the inbox reads chronologically | free |
| Lifetime | the term | the run |

**Recognising the inbox.** Phase 0 Globs `<workspace_root>/<course>/materials/*` when `COURSE.md` exists (or when the user points at the directory). Files there are ordinary source material: they may be listed in `provided_materials` by their course-relative path, and `materials_scope` governs them exactly as it governs an uploaded file.

```
provided_materials:
  - type: "notes"
    path_or_ref: "<course>/materials/YYYY-MM-DD-<name>.pdf"
    origin: "course-inbox"        # inbox file, already committed — not a private in-lesson copy
```

`origin: "course-inbox"` is what keeps the two straight downstream: Phase 3's private-by-default `.gitignore` covers `<lesson_root>/materials/` and does **not** need to cover an inbox path, and Phase 5's gitignore-override question lists inbox files under *out-of-scope materials* (outside `<lesson_root>`, not stageable from there) rather than as candidates to publish. Do not copy an inbox file into `<lesson_root>/materials/` just to have it locally; reference it in place.

**Committed means committed to the workspace repo — decide that once, deliberately.** Course material is routinely copyrighted, so a committed inbox is appropriate only in a repo whose visibility the user has accepted. Two consequences the pipeline must respect:

- The workspace `.gitignore` template ignores `**/materials/`, which swallows the inbox — and its per-course carve-out pattern (`<course>/*` then `!<course>/claude_lessons/`) swallows `COURSE.md` along with it. Tracking either needs explicit re-allows: `!<course>/COURSE.md`, `!<course>/materials/`, `!<course>/materials/**`, written at the end of the file so they win over the earlier ignores. The block is documented at the bottom of `references/bootstrap/workspace-root/gitignore.template`.
- **The skill does not add those re-allows itself.** Report the state once at the first gate — "the course inbox at `<course>/materials/` (and `COURSE.md`) is currently ignored; add the carve-out if you want it tracked" — and let the user edit `.gitignore`. This is the same invariant as Phase 5's: the skill never relaxes a gitignore on the user's behalf, because publishing copyright material is not reversible. An ignored inbox still works — the pipeline reads it from disk either way; it is only the durable, cloneable copy that is missing.

Static deploys never carry the inbox: it is outside `<lesson_root>` and nothing in the build reads it.

## 4. Chunk triage

A **chunk** is one delivery of material: a photo of a board, a slide deck, a page of notes, a problem set, plus whatever the user said when they sent it ("wk3, covers X; the derivation in Y is examinable"). Triage decides where it lands. Run it against `COURSE.md`'s outline + lesson map, and record the verdict on the chunk's `## Pending chunks` row.

**Photographs are the common case and are triaged like any other chunk.** A phone photo of a lecture page or a whiteboard is ordinary material: `Read` it directly (no OCR — `references/phase-1-content.md` § Uploaded PDFs / files / photos, item 5), and treat *all the photos of one lecture as one chunk*, filed under one `## Pending chunks` row and one date, because a derivation photographed across three frames is one derivation and triaging the frames separately would scatter one topic across three verdicts. Two exceptions to a single verdict: if the batch legibly spans two outline units, split the row at the unit boundary; and **a photo whose content cannot be made out does not get a guessed verdict** — file it, mark the row `triage: unassigned (illegible — <what is unclear>)`, and ask the user. It stays pending and never rides into a build on an assumption.

### Outcomes

| Outcome | Means | Pipeline |
|---|---|---|
| **refine** | the chunk corrects, deepens, or re-derives something an existing topic already teaches | update mode, `scope_of_change: specific`, that topic |
| **add topic** | the chunk introduces a concept inside a lesson's existing unit that no topic covers | update mode, topic `add` (a new topic needs a `teaching_arc` — `references/phase-2-plan.md`) |
| **new lesson** | the chunk opens an outline unit that has no lesson, or a unit's material has outgrown one lesson | new mode |
| **restructure** | the chunk's home cannot be settled without moving topics between lessons | `consolidate` (§6) |

### Triggers

Check in this order; the first that fires wins.

1. **The outline's unit boundaries moved** — the user re-split the syllabus, merged two units, or said the course now covers this differently → **restructure**.
2. **A topic now spans two lessons** — the chunk's concept is already taught, partially, in two different lessons, or landing it correctly would duplicate an existing topic → **restructure**.
3. **A lesson is thin** (`< 2` topics, usually after removals or an optimistic early split) and the chunk targets it → **restructure**: merge it into its neighbour in the map rather than growing a stub.
4. **The receiving lesson would exceed 6–7 topics** — that is the ceiling where the contents rail stops being navigable and a lesson stops having one arc → **new lesson** for the overflow (or **restructure** if the split has to move existing topics, not just append).
5. **No lesson covers the chunk's outline unit** → **new lesson**.
6. **The chunk changes a topic the lesson already teaches** → **refine**.
7. **The chunk adds a concept within a covered unit** → **add topic**.

**Tie-break: prefer the least structural outcome — `refine` > `add topic` > `new lesson` > `restructure` — but never at the cost of the lesson's arc.** The tie-break protects a coherent lesson, not the pipeline's effort: do not staple a seventh topic onto a lesson whose central question it does not serve, and do not "refine" a topic into carrying two unrelated ideas. Restructuring is the expensive outcome (§6) and the tie-break exists to keep it rare, not to forbid it.

Under `resource_mode: "limited"` the tie-break biases one notch further toward the cheaper outcome on genuine near-ties; it never converts a real restructure trigger into an append.

### Recording a verdict

```
## Pending chunks
- 2026-03-04 · materials/2026-03-04-wk3-notes.pdf, materials/2026-03-04-board.jpg
  note: "wk3 — damping ratio, prof stressed the overdamped case"
  target: <slug>  ·  triage: refine (topic-3 "Damped response")  ·  status: pending
```

`status: pending` → `status: built (<run-id>)` when a run consumes it (§8). A chunk with no verdict yet is `triage: unassigned` and is surfaced at the next Phase 0.

## 5. Batching pending chunks

**Filing is immediate; building is batched.** Copying a chunk into the inbox, adding its `## Materials index` row and its `## Pending chunks` entry is cheap, must never wait, and is what makes the material durable. Starting a build run is the expensive half.

Build when any of these holds:

- The accumulated pending chunks **change a topic's substance** — a claim is now wrong, a derivation is new, an objective moved, real practice problems arrived, or a concept the lesson teaches is now taught differently.
- The user says so — *build now*, *I have a midterm*, *push this one out*.
- The pending set **completes an outline unit** with no lesson yet → the new-lesson build for that unit.

Otherwise let chunks accumulate. Cosmetic or corroborating material (a second photo of the same board, a slide that restates a topic already taught, an announcement) is filed and left pending.

**Why batching is the rule and not a preference.** An update run's cost is almost entirely fixed: Phase 1's re-sweep, Phase 2's whole-lesson medium-decider spawn, and Phase 4's review — which under no-grandfathering re-runs visual-QA over **every** medium in the final lesson, including every `keep` (`references/update-mode.md` §6). A one-line correction to a topic in a lesson with a dozen media pays nearly the same review bill as a rewrite of half the lesson. Ten chunks built in ten runs cost roughly ten times what the same ten chunks cost in one run, and produce ten merge commits and ten chances to regress a clean medium. One run per attachment is the anti-pattern this section exists to prevent.

Announce the pending set rather than sitting on it silently: when a run is skipped, say what is pending and what would trigger the build ("3 chunks pending on `<slug>`; nothing changes a topic's substance yet — say *build now* to force it").

## 6. `consolidate` — cross-lesson restructure

`consolidate` is update mode with a **course-level plan**: one plan that moves, merges, and splits topics across several lessons, one approval for the whole plan, then execution lesson by lesson through the ordinary update pipeline.

**Detection.** Restructure verbs (`restructure`, `re-split`, `consolidate`, `merge <a> and <b>`, `split <slug>`, `re-balance`) with a course reference, or triage outcome *restructure* (§4). Assign `mode: "update"`, `update_kind: "consolidate"`, `course_scope: [<slug>, …]`. It is a variant of update mode, not a third mode: every invariant in `references/update-mode.md` still holds per lesson.

### Phase shape

- **Phase 0 (course scope, once)** — read `COURSE.md`; resolve the affected lesson set from the map; working-tree check across *all* affected lesson roots (one dirty tree blocks the whole run); confirm the restructure's reason. No per-lesson interview.
- **Phase 1 (course scope, once)** — run the existing inventory pre-scan (`references/update-mode.md` § Inventory pre-scan) once per affected lesson, plus each lesson's topic list and `GRAPH_SCHEMA` state. The output is a course-wide topic × lesson × media table. Research is `light` by default: a restructure moves existing material, it does not re-teach it.
- **Phase 2 (course scope, once)** — compile the **consolidation plan** below and take **one** approval gate for it.
- **Phases 3–5 (per lesson, in dependency order)** — each affected lesson runs the ordinary update pipeline against its own change-list: its own branch (`lesson-update/<slug>-YYYYMMDD`), its own splice, its own Phase 4, its own merge. No further approval gate fires; each lesson's log records `Approval: INHERITED from consolidation plan <hash> at <timestamp>`.

### Consolidation plan format

```
CONSOLIDATION PLAN — <course>   (run-id: consolidate/<course>-YYYYMMDD)
Reason: <trigger — outline re-split / duplicated topic / thin lesson / overflow>
Affected lessons: <slug-a>, <slug-b>, <slug-c>
Execution order: <slug-b>, <slug-a>, <slug-c>       # destinations before sources

MOVES
  topic "<title>" : <slug-a> -> <slug-b>
      media moved: <ComponentName> (svg-graph), <asset>.mp4 (manim-video)
      schema keys moved: <graphKey>
  merge <slug-c> -> <slug-b>: topics <t1>, <t2>; <slug-c> retired (directory kept, map row -> retired)
  split <slug-a> -> <slug-a> + <new-slug>: topics <t3>, <t4> to <new-slug> (new-mode build)

PER-LESSON CHANGE LISTS
  <slug-b>  (destination, runs first)
      ADD topic "<title>" (from <slug-a>) — teaching_arc: <carried | rebuilt>
      MEDIA: add <ComponentName> (relocated from <slug-a>), add <asset>.mp4
      GRAPH_SCHEMA: merge keys <graphKey>; backfill needed: yes/no
  <slug-a>  (source, runs after <slug-b> merges)
      REMOVE topic "<title>" (moved to <slug-b>)
      MEDIA: remove <ComponentName>, remove <asset>.mp4 (now owned by <slug-b>)
      GRAPH_SCHEMA: drop keys <graphKey>
      Remaining topics: <n> — arc still coherent: yes/no + what changes

SHARED MEDIA
  <asset>: used by <slug-a> and <slug-b> -> owner <slug-b>; <slug-a> keeps its own copy / drops it

COURSE.MD UPDATES
  lesson map rows rewritten: <slug-a>, <slug-b>, <slug-c>, <new-slug>

ROLLBACK
  One branch per lesson; a lesson merges only after its own Phase 4 passes.
  Partial completion is a valid stopping state — see "Failure mid-course" below.
```

### Mechanics

- **Destination before source, always.** A topic exists in both lessons for the window between the destination's merge and the source's — that duplication is intentional and recoverable. The reverse order loses content if the destination run fails.
- **Moved media travel whole.** The component definition, its call site, its `DEFAULT_GRAPH_PARAMS` entry, its `GRAPH_SCHEMA` entry, and the asset file under `public/images/` or `public/videos/` (plus any manim `.py` at the lesson root) move together. Preserve function names and asset filenames across the move — a move is not a refine, and renaming turns a mechanical relocation into a diff nobody can review. If the destination lesson lacks `GRAPH_SCHEMA`, the backfill (`references/graph-schema-guide.md`) runs in that lesson's Phase 3 as usual and is listed in the plan.
- **A moved topic keeps its `teaching_arc` unless the destination changes its entry state.** Landing a topic after different prerequisites usually invalidates the arc's entry assumptions; when the plan says `teaching_arc: rebuilt`, that lesson's Phase 2 work (arc rewrite per `references/teaching-communication.md`) happens inside its own run, constrained by the approved plan.
- **A `split` that creates a new lesson runs new mode for the new slug**, seeded with the moved topics' existing content and media, then the source lesson's removal run. Slug renames stay disallowed (`references/update-mode.md` §10) — a "renamed" lesson is a split into a new slug plus a retirement.
- **Retiring a lesson** rewrites its `COURSE.md` map row to `retired`; it does not delete the directory. Deleting a lesson is a separate, explicit user request.
- **Failure mid-course.** If a lesson's Phase 4 halts or its build verify fails, stop the sequence there. Lessons already merged stay merged; the remaining ones stay unstarted. Record the completed and remaining lists in `COURSE.md` and in every affected lesson's log, and report both. Never unwind a merged lesson automatically.

### Cost

`consolidate` is the most expensive run the skill has: every touched lesson pays a full Phase 4, and under no-grandfathering that means visual-QA over every medium in every touched lesson. Do it at outline boundaries — a re-split, a merge of two thin lessons, a duplication that has become confusing — not as a way of filing a chunk (§4 tie-break, §5).

## 7. Gates when nobody is at a terminal

Incremental courses are usually driven from a chat channel or a headless worker, so the gates in this doc are the ones most likely to fire without a terminal attached. The detection rule and the per-mode gate forms are canonical in `SKILL.md` § Session modes and gates; do not restate them here. Two course-specific notes:

- The **consolidation plan** is one gate covering many lessons, so its channel message or its `PLAN FOR APPROVAL` journal block carries the whole plan — moves, per-lesson change-lists, execution order — not a per-lesson summary. Its `<hash>` covers the whole plan; approving it approves every lesson's change-list.
- **Triage and batching decisions are not gates.** Filing a chunk, assigning a target lesson, and deciding not to build yet are reported, not approved — they change no lesson and are reversible by editing `COURSE.md`. Only the build itself needs approval.

## 8. Course-map write-back

The pipeline writes back exactly two things to `COURSE.md`, at the end of a successful run (Phase 5, after the deploy step), and nothing else:

- the **lesson map row** for the lesson(s) it built or updated: status (`live`, or `needs-update` if the run merged with a known open finding), topic count, and the run-id;
- the **pending-chunk rows and materials-index rows it consumed**: `status: pending` → `status: built (<run-id>)`, and the materials index's "consumed by" column.

Everything else — outline, conventions, open questions, unconsumed chunks — is the user's text. If `COURSE.md` does not exist, the pipeline does not create one; it is a convention the user opts into, and a run that invents it would be guessing at the outline.

## 9. Common gotchas

- **`COURSE.md` is stale by default.** Its lesson map records what someone last wrote, not what is on disk. When the map and the filesystem disagree (a row for a slug that does not exist, a lesson with no row), trust the filesystem for what exists and the map for what was intended, and surface the discrepancy at the next gate.
- **The two `materials/` directories.** An inbox path that ends up in `<lesson_root>/materials/` becomes private-by-default and disappears from the course's durable copy in the next clone. Reference inbox files in place (§3).
- **A chunk with no home is not automatically a new lesson.** "No lesson covers this" is trigger 5 only after triggers 1–3 have been checked — material that seems unplaced is often a symptom of moved unit boundaries.
- **Topic-count ceiling is a trigger, not a hard limit.** Seven topics with one arc beats six topics plus a stub. Use trigger 4 as the prompt to look at the lesson's arc, not as arithmetic.
- **Do not let triage silently re-scope a build.** If triage says *new lesson* but the request said "update `<slug>`", say so and let the user redirect — the verdict is a recommendation surfaced at the gate, not a licence to build somewhere else.
- **Consolidate against a dirty tree.** The Phase 0 working-tree check spans every affected lesson root; a single dirty lesson blocks the run rather than being stashed piecemeal, because a half-stashed multi-lesson restructure is unrecoverable by hand.

## 10. Phase cross-reference

- **Phase 0** (scoping): `references/phase-0-scoping.md` § Course context — reading `COURSE.md`, the inbox Glob, the `course_root` / `session_mode` scoping-artifact fields, and the consolidate scope questions.
- **Phase 1** (content analysis): `references/phase-1-content.md` — the course inbox in the workspace-materials-first ordering, pending chunks as inputs, and the course-scope inventory for `consolidate`.
- **Phase 2** (plan): `references/phase-2-plan.md` — the approval gate this doc's plans pass through, including its non-interactive forms.
- **Phase 3-5** (execution → deploy): unchanged per lesson; `consolidate` runs them once per affected lesson in the plan's execution order.
- **Update mode**: `references/update-mode.md` — the 5 media actions, no-grandfathering (the reason §5 batches), and the `consolidate` entry that points back here.
- **Session modes**: `SKILL.md` § Session modes and gates — how any gate is delivered when the session has no terminal.
