# Phase 0 — Scoping Interview

Contents: Mode detection recap · Resource-mode detection · Session-mode detection · Course context · New-mode questions · Update-mode questions · Scoping artifact format · Aggressive defaults for one-liners · Output (into the record) · Handoff.

## Purpose

Phase 0 runs before content work and produces the **scoping artifact** that drives downstream phases. Main Claude conducts a short interview whose questions adapt to the detected mode and to whatever materials the user provided — as `AskUserQuestion` calls when the session is interactive, and in the channel or headless form otherwise (§ Session-mode detection). Leave Phase 0 with enough to either spawn `content-orchestrator-agent` against a clear scope (new) or against a known lesson root with a bounded re-sweep (update). No research, orchestrator spawns, or file writes before Phase 0 completes. Phase 0 assumes the fresh-workspace bootstrap gate has already run — if `<workspace_root>/_lesson-core/` is missing, the bootstrap procedure in `references/bootstrap.md` installs it before any Phase 0 question fires (see `SKILL.md`).

## Mode detection recap

Detection fires before the scoping interview; best-effort, Phase 0's first question confirms. The verb list and mode-assignment rules are canonical in `SKILL.md` § Mode detection; the full decision tree and edge cases live in `references/update-mode.md` §3. Candidate resolution: full path → use directly; course + slug → `<workspace_root>/<course>/claude_lessons/<slug>/`; only slug or only course → Glob, use if exactly one match.

**Phase 0 opens the run record.** Before writing anything else, main Claude runs

```bash
node <skill_root>/scripts/run-manifest.cjs init --lesson <lesson_root> \
  --mode new|update|consolidate --session-mode <session_mode> --course <course> --slug <slug>
```

which prints the `run_id` and creates `<lesson_root>/.lesson-builder/runs/<run_id>.json`. Every field this phase and later phases record goes there (`set`, `append`), and `lesson_build.log.md` is rendered from it (`render`) — nothing below is read back out of the markdown. A lesson whose log predates the record needs nothing extra: `init` starts a record, and `render` keeps the old log above its marker exactly as it was. Schema and commands: `references/run-record.md`.

The detection result is the record's `mode`, and renders as the first line under `## Phase 0 — Scoping` in the log:

- New mode: `Detected mode: new`
- Update mode (resolved): `Detected mode: update (candidate: <workspace_root>/<course>/claude_lessons/<slug>/)`
- Update mode (unresolved): `Detected mode: update (candidate: null — will ask)`

### Resource-mode detection

Alongside mode detection, scan the initial message for resource-conscious signals: `quick`, `fast`, `cheap`, `minor`, `light pass`, `quick pass`, `keep it simple`, `avoid manim`, `skip research`, and similar.

- No triggers → `resource_mode: "full"` (default).
- Trigger present → `resource_mode: "limited"`.

`resource_mode` threads through every phase and spawn. Surface the detected value at Phase 0 confirmation. Log as `Resource mode: full|limited`; on ambiguity, default to `full` and note for confirmation.

### Effort-mode detection

`effort_mode` is the model dial — it decides which tier main Claude spawns each agent on (see the Model policy table in `SKILL.md`). Detect it in the same pass as `resource_mode`:

- High-consequence signals — an exam-prep or graded lesson, a hard derivation, correctness the student will rely on, or explicit phrasing (`think hard`, `go all out`, `deep`, `thorough`, `highest quality`, `this one matters`, `hardest`, a request for Fable) — → `effort_mode: "deep"`. This runs the judgment layer on Claude Fable 5; do not avoid it on cost grounds when the lesson warrants it.
- The resource-conscious triggers above → `effort_mode: "light"`.
- Neither → `effort_mode: "standard"` (default).

Two constraints when both fire: `light` forces `resource_mode: "limited"`, and `limited` caps `effort_mode` at `standard`. If the message carries both a deep signal and a cheap signal (*"do a really thorough job but keep it quick"*), the contradiction is the user's to resolve — ask rather than guessing, since the two pull opposite ways on cost.

Log as `Effort mode: deep|standard|light` and surface it at Phase 0 confirmation alongside the resource mode. `standard` — Opus 5 at `xhigh` for the judgment layer — is the right answer for a routine lesson; promote to `deep` when the work is genuinely high-consequence, not on enthusiasm alone.

Under `deep`, also tell the user at the confirmation that subagent effort follows the session, so a max-effort session is what makes `deep` actually deep — the pipeline can set the model tier per spawn but cannot set effort (see the Model policy in `SKILL.md`).

### Session-mode detection

Phase 0 also decides **how questions get asked at all**. The ordered detection rule and the per-mode gate forms are canonical in `SKILL.md` § Session modes and gates; resolve `session_mode: "interactive" | "channel" | "headless"` here, once, before the first question fires, and log it as `Session mode: <value>`.

What it changes inside Phase 0:

- **`interactive`** — the interview runs as written below: batched `AskUserQuestion` calls.
- **`channel`** — the same questions, posted as **one message** with the options written out, answered in the user's own words. Batch harder than the 4-per-call dialog limit suggests: a course-channel user will answer a compact numbered list in one reply, and a second round-trip costs minutes, not milliseconds.
- **`headless`** — the interview does not run and does not block. Take the aggressive defaults at the end of this doc (extended to new mode, which normally forbids them), fill everything `COURSE.md` can supply (§ Course context), and carry the result into Phase 2's `PLAN FOR APPROVAL` block as an `ASSUMPTIONS` section. The one blocking gate then covers scoping and plan together. Never invent a `course` or `slug` this way — if neither the task text nor `COURSE.md` names the target lesson, that is a no-safe-default gate: block.

The working-tree question (update-mode Q2) used to be the one Phase 0 gate that could destroy work. It no longer can: the run builds from the recorded base SHA in a worktree of its own, so there is nothing to stash and nothing to discard. In `channel` and `headless` sessions its safe default is therefore **continue**, with the dirty paths reported as not being in what the run builds from.

## Course context

Before the first question, Glob `<workspace_root>/<course>/COURSE.md` (and, when `course` is not yet known, `<workspace_root>/*/COURSE.md`). If it exists, read it — it is the course's stated shape, and every field it supplies is one the interview does not ask. Full contract: `references/course-curation.md` §2.

What Phase 0 takes from it:

- **Lesson map** → resolves `candidate_root` for an update whose lesson reference was ambiguous ("wk3 notes" → the row whose outline unit covers week 3), and tells a new-mode build which slug and numbering come next.
- **`## Conventions`** → `course_name`, `audience_level`, `pedagogical_goal`, notation and media preferences, `model_after`. A stated convention beats one inferred from a sibling lesson's JSX — prefer it, and fall back to the sibling Glob only for what the section does not cover.
- **`## Pending chunks`** → material already filed but not built. Surface the pending set at the confirmation; the batching rule in `references/course-curation.md` §5 decides whether this run consumes it.
- **`## Materials index`** → what each inbox file covers and which lesson consumed it.

Also Glob the **course materials inbox** at `<workspace_root>/<course>/materials/`. Files there are ordinary source material and may be listed in `provided_materials` by their course-relative path with `origin: "course-inbox"` — they are committed and referenced in place, never copied into the private `<lesson_root>/materials/`. The two directories and their differing privacy postures are set out in `references/course-curation.md` §3.

When `COURSE.md` is absent, nothing changes: the interview asks what it always asked.

**`consolidate` runs** (`update_kind: "consolidate"`) scope Phase 0 to the course, not a lesson: confirm the restructure's reason, resolve the affected lesson set from the lesson map, and run the working-tree check across **every** affected lesson root — one dirty tree blocks the run. No per-lesson interview happens; the per-lesson change-lists are settled in the consolidation plan (`references/course-curation.md` §6).

## Question taxonomy — new mode

New mode asks a fixed set of **always-asked** questions, plus one branch of **conditional** questions depending on whether the user already provided source material (textbook chapter, slide deck, problem set, lecture notes) or nothing at all.

Batch the interview into as few `AskUserQuestion` calls as possible (the tool takes up to 4 questions per call) rather than firing one call per question — two calls usually cover the whole new-mode interview.

### Always asked (new mode)

1. **Course code** — "Which course directory should this lesson live under?" Main Claude runs `Glob <workspace_root>/*/claude_lessons/` to enumerate existing course directories, presents them as options, and appends `Other (specify)` for a new course directory. A free-text follow-up collects the display code AND the full course name (e.g. "MATH 239 — Introduction to Combinatorics") — the full name becomes the artifact's `course_name`, which Phase 3 wires into the Chatbot's `courseName` prop; for existing courses, default it from a sibling lesson's JSX instead of re-asking.
2. **Lesson slug** — "What directory slug should the lesson live under (kebab-case, e.g. `topic-name`)?" Free-text.
3. **Audience level** — "What's the target audience?" Options: `First-year undergrad`, `Second-year undergrad`, `Upper-year undergrad`, `Graduate / review`, `Mixed (specify)`.
4. **Pedagogical goal** — "How deep should this lesson go?" Options: `Survey (broad tour, minimal derivations)`, `Working knowledge (standard course coverage)`, `Mastery (derivations, edge cases, exam-level)`.
5. **Single vs multi-lesson** — "Is this one lesson or a multi-lesson unit?" Options: `Single lesson`, `Multi-lesson unit (specify count)`.
6. **Deploy target** — "Is this a brand-new lesson, or replacing an existing one at the same slug?" Options: `Brand-new lesson`, `Replacing existing lesson at <course>/<slug>`. A replacement is still a new-mode build, but the old lesson must be recoverable: before Phase 3 scaffolds over it, require a clean working tree at the lesson root and create a safety branch (`git branch backup/<slug>-<YYYYMMDD>`) so the previous lesson survives the overwrite.
7. **Deploy destination** — "When the lesson is ready, how should it go live?" Options:
   - `Push to GitHub (default)` — commits + `git push origin main`; workspace's hosted deploy (Netlify / Vercel / Cloudflare Pages per workspace config) auto-triggers.
   - `Push to a different git remote` — commits + pushes to a user-specified remote URL.
   - `Run a custom deploy CLI` — commits, then runs a user-specified command (e.g. `netlify deploy --prod --dir=dist`) from `<workspace_root>`.
   - `Commit only, no push` — commits to `main` (new mode) or the update branch (update mode). Nothing leaves the machine.
   - `Skip deploy entirely` — no commit, no push. Files stay in the working tree (new mode) or on the update branch (update mode).

   Branching rules:
   - "Push to a different git remote" → follow-up free-text for the remote URL. Store as `deploy_action: "push-to-custom"`, `deploy_service_kind: "git-remote"`, `deploy_service: "<url>"`.
   - "Run a custom deploy CLI" → follow-up free-text for the exact command. Store as `deploy_action: "push-to-custom"`, `deploy_service_kind: "cli"`, `deploy_service: "<command>"`.
   - All other options leave `deploy_service_kind: null` and `deploy_service: null`.

   This answer drives Phase 5 branching.

### Conditional — material provided

If the user attached or linked source material (textbook pages, slide deck, PDF, lecture notes, problem set), ask:

- **Materials scope** — "How should this lesson relate to the course materials you provided?" Options: `Course materials only (stay strictly within the provided materials; no outside research except prerequisites the material itself clearly assumes a student already knows)`, `Fill gaps with research (materials are the spine; use research to fill in background, prerequisites, and missing derivations the materials gloss over, but don't broaden the topic)`, `Add extensions (materials are a starting point; broaden with related topics, deeper treatment, modern context, or applications beyond what the materials cover)`. This answer governs how the research agents treat the material in Phase 1: `course-only` caps research sharply; `fill-gaps` allows targeted supplementary research; `extensions` permits broadening sweeps. When `resource_mode: "limited"`, `extensions` is still available but the research cap applies regardless.

### Conditional — no material

If no material was provided, ask:

- **Research depth** — "How deep should the initial research sweep go?" Options: `Rough sweep first (scope confirmation before deep dive)`, `Direct deep research (topic list already clear)`, `Textbook-parallel (pick a textbook to mirror)`.
- **Scope qualifiers** — "Any scope constraints?" Free-text covering: rough topic list or key concepts, target lesson length, specific media preferences, existing lessons to model after, whether agents should decide topic count.

## Question taxonomy — update mode

Update mode asks **5 update-specific questions** (below) plus the 4 carried-over standard ones listed under "Still asked in update mode" — batch them into 2-3 `AskUserQuestion` calls. Course code, slug, and deploy target are auto-populated from `candidate_root`. For terse one-liners, skip the interview entirely via the aggressive-defaults policy at the end of this doc.

Pre-checks run first:

1. **Working-tree**: `git status --short <lesson_root>` (run from the repo root). Empty stdout → clean; skip question 2.

2. **`@core`**: Grep `src/<slug>.jsx` for `from "@core"`. If absent, the lesson predates the `_lesson-core/` migration and inlines old chat code. Update is a default no-go because `code-review-agent` will block at Phase 4. Replace question 1 options:
   - `Yes, update that lesson (migration required first — switch to new mode)` (default)
   - `Update without migration (bypass @core check; I accept the risk)` (narrow escape hatch; warn in the log)
   - `Different lesson`
   - `Actually a brand-new lesson`

   If the `@core` check passes, proceed with the normal question 1 option set.

### The 5 update-mode questions

1. **Mode confirmation** — "I detected an update to `<course>/claude_lessons/<slug>` at `<workspace_root>/<course>/claude_lessons/<slug>/`. Is that the lesson to revise?" Options: `Yes, update that lesson`, `Different lesson (specify course and slug)`, `Actually a brand-new lesson (switch to new mode)`. If `candidate_root` is null, rephrase as "Which existing lesson should I update?" with free-text or a Glob-enumerated option list.

2. **Working-tree check** — only surfaced if `git status --short <lesson_root>` returned non-empty. "Your working tree has uncommitted changes in `<lesson_root>`. This run builds from the last commit on `<base branch>`, in a worktree of its own, so those edits are neither included nor touched." Options: `Continue (my edits stay exactly as they are)`, `Abort — I'll commit them first and rerun`. There is no third option: nothing here stashes and nothing discards. If clean, skip the question entirely and log `Working tree: clean`.

   **Read-only.** The check runs `git status --short <lesson_root>` and writes nothing. Record what it saw, one word plus the count, and move on:

   ```bash
   run-manifest.cjs set --lesson <lesson_root> scoping.working_tree \
     "dirty: N path(s) uncommitted, not in the base SHA this run builds from"   # or "clean"
   ```

   `git.stash_oid`, `git.stash_ref` and `git.stash_branch` belong to the old flow, which stashed the user's tree and built in it. `run-manifest.cjs set` refuses to write them; only recovery of a run left over from that flow reads them (`references/update-mode.md` § Recovering a run from the old stash flow).

3. **Research depth** — "How deep should the research re-sweep be?" Options: `Full (comprehensive re-research — treats the lesson like a new build; default when resource_mode is full and quality is the priority)`, `Targeted (re-research specific topics you name — good balance when only part of the lesson needs a fresh look)`, `Light (minimal re-research — work from existing content, your concerns, and any new materials; default when resource_mode is limited)`. Default is `full` when `resource_mode: "full"` and the update scope is broad; `targeted` when the scope is narrow; `light` only when `resource_mode: "limited"` or the user explicitly requested a shallow pass.

4. **Scope of change** — "Which topics or sections need work?" Options: `Any topic (open-ended review — the orchestrator picks)`, `Specific topics (free-text list of topic ids or titles)`, `Replace whole lesson structure (warning: this is close to a rewrite — consider new mode instead)`. If the user picks the third option, warn and offer to switch to new mode before proceeding.

5. **Media hints (optional)** — "Any media you specifically want kept, refined, replaced, removed, or added?" Free-text. Advisory hints only; feeds into `medium-decider-agent` in Phase 2 but doesn't override its verdict.

### The base SHA and the build worktree (update mode only)

Runs after the questions, once the lesson root is settled. It is the last thing Phase 0 does in the
user's checkout, and it only reads there. Everything the run builds happens in the worktree it opens
here — `references/update-mode.md` §5 is the invariant this implements.

```bash
cd <workspace_root>
git rev-parse --abbrev-ref origin/HEAD       # `origin/<base>` → the workspace default branch,
                                             # normally main; no remote HEAD → use `main`
git rev-list --count <base>..origin/<base>   # not 0 → the default branch is behind its upstream:
                                             # halt and say so, because the merge this run
                                             # produces could not be pushed. The user
                                             # fast-forwards and reruns; nothing is built.
run-manifest.cjs set --lesson <lesson_root> git.base_branch <base>
run-manifest.cjs set --lesson <lesson_root> git.base_sha "$(git rev-parse refs/heads/<base>)"
run-manifest.cjs worktree add --lesson <lesson_root>   # prints the lesson root to build in
```

The base SHA is the tip of the default branch, not `HEAD` — what the user's checkout happens to be
on, and whether it is dirty, changes nothing about what the run builds from.

`worktree add` records `git.worktree` (the lesson root inside the worktree) and `git.worktree_state`,
and leaves the pointer that lets `run-manifest.cjs` find this record from in there. Read the path
back with `run-manifest.cjs get --lesson <lesson_root> git.worktree` — every phase from 1 on uses it
as its `<lesson_root>`, and the record, the staging area and the rendered log stay where they are.
Calling `worktree add` again is how a resumed run picks its worktree back up, with whatever it had
already built still in it.

No branch is created here. The worktree sits detached on the base SHA until Phase 3 names the
branch, so a run the user aborts at the Phase 2 gate leaves nothing behind but a directory the
lesson's `.gitignore` already covers.

### Still asked in update mode (not auto-populated)

- Audience level (may have shifted from original build)
- Pedagogical goal (may have shifted)
- Single vs multi-lesson (unlikely to change, but cheap to confirm)
- **Deploy destination** (same phrasing as new-mode Q7 above). The default is pulled from the **previous run's record** when one exists — `run-manifest.cjs current --lesson <lesson_root>` before this run's `init` names it, then `run-manifest.cjs get --lesson <lesson_root> --run <prior id> scoping.deploy_action` (and `scoping.deploy_service_kind`, `scoping.deploy_service`); exit 3 on any of them means that run recorded no deploy. Walk back through older records if the newest was `skip`; if none recorded a deploy, `Push to GitHub`. Never parse the destination out of `lesson_build.log.md` — a wrong parse silently deploys somewhere else. If the user attached fresh materials alongside this update request — detected by scanning the initial message for uploaded file paths or URLs, not by parsing Q5 (which is free-text media advice, not a materials field) — populate `provided_materials` from those attachments and `materials_scope` will be asked as well; the Phase 5 materials-in-commit question then surfaces automatically.

### Auto-populated from `candidate_root` (not asked)

- Course directory (parsed from path segment)
- Slug (parsed from path segment)
- Deploy target (always "update in place" in update mode)

## Scoping artifact format

Phase 0 output is a structured artifact written to the run record (`scoping.<field>`) and passed to Phase 1. The format below is how it reads; `render` puts it under the Phase 0 heading of the log. Fields vary by mode.

### Common fields (both modes)

```
mode: "new" | "update"
update_kind: "lesson" | "consolidate"   # update mode only; "consolidate" is the course-level restructure
session_mode: "interactive" | "channel" | "headless"   # how every gate is delivered (SKILL.md)
resource_mode: "full" | "limited"   # default "full"; "limited" only if user explicitly signalled a quick pass
course: "<course display code>"
course_name: "<full course name>"   # wired into the Chatbot courseName prop at Phase 3
course_dir: "<course>"
slug: "<slug>"
lesson_file: "src/<slug_snake>.jsx"  # slug with dashes replaced by underscores.
                                     # THE canonical lesson filename — every later
                                     # phase, test command, chatbot lessonFile prop,
                                     # and reviewer brief consumes this value.
                                     # Docs writing src/<slug>.jsx mean this file.
audience_level: "..."
pedagogical_goal: "survey" | "working" | "mastery"
scope_of_lesson: "single" | "multi (count: N)"
provided_materials:                # possibly empty in either mode; update mode captures newly attached materials
  - type: "textbook chapter" | "slides" | "problem set" | "notes" | "photos" | "none"   # "photos" = photographed handwritten notes or a board
    path_or_ref: "..."             # an uploaded path, a URL, or "<course>/materials/<file>" for an inbox file
    origin: "upload" | "course-inbox"   # optional; "course-inbox" files are committed and read in place
materials_scope: "course-only" | "fill-gaps" | "extensions" | null   # null iff provided_materials is empty
course_root: "<workspace_root>/<course>/" | null      # set iff <course>/COURSE.md exists
course_context:                                       # omit entirely when course_root is null
  map_row: "<slug> | <outline unit(s)> | <topic count> | <status>"
  conventions_applied: [...]        # fields taken from ## Conventions rather than asked or inferred
  pending_chunks: [...]             # rows this run consumes; [] when the run builds none of them
  triage_verdict: "refine" | "add-topic" | "new-lesson" | "restructure" | null
course_scope: [<slug>, ...]         # consolidate only: every affected lesson, in execution order
deploy_action: "push-to-github" | "push-to-custom" | "commit-only" | "skip"
deploy_service_kind: "git-remote" | "cli" | null   # null unless deploy_action == "push-to-custom"
deploy_service: "<remote URL>" | "<CLI command>" | null   # populated iff deploy_action == "push-to-custom"
```

`deploy_action`, `deploy_service_kind`, and `deploy_service` flow into Phase 2's plan artifact (surfaced at the approval gate so the user confirms deploy intent alongside the content plan) and into Phase 5 (which branches its commit/push logic on `deploy_action` and its push mechanics on `deploy_service_kind`).

**Privacy posture is private-by-default.** Phase 3 writes `<lesson_root>/.gitignore` with entries for `materials/`, `source/`, `notes/`, `*.local`, `.env*`, and any in-lesson `provided_materials` paths, so a plain `git add` cannot stage them. At Phase 5 the user is asked whether to **override** the gitignore for the current commit (default: do not override). Nothing private reaches a commit without an explicit override answer. See `references/phase-3-execution.md` (Private-by-default `.gitignore`) and `references/phase-5-deploy.md` (Step 1.5) for mechanics. Because the baseline is protective, `gitignore_override` (Phase 5) is NOT asked at Phase 0 and is NOT a scoping-artifact field — it is collected only at the moment of commit.

### New-mode fields

```
research_depth: "rough-sweep-first" | "direct-deep" | "textbook-parallel" | null
new_lesson_context:
  rough_topics: [...]
  length_target: "..."
  media_preferences: "..."
  model_after: "<course>/<slug>" | null
deploy_target: "new" | "replacing: <course>/<slug>"
```

`provided_materials` and `materials_scope` live in the common fields block because update mode can also attach fresh materials (e.g., a new textbook chapter alongside the update request).

### Update-mode fields

```
existing_lesson_root: "<workspace_root>/<course>/claude_lessons/<slug>/"
research_depth: "light" | "targeted" | "full"
scope_of_change: "any" | "specific" | "full-replace"
scope_topics: [...]  # only when scope_of_change == "specific"
media_hints: [...]
working_tree_state: "clean" | "dirty: N path(s) uncommitted, not in the base SHA this run builds from"
```

### Example — new mode

```
mode: "new"
course: "<course display code>"
course_dir: "<course>"
slug: "<slug>"
audience_level: "Second-year undergrad"
pedagogical_goal: "working"
scope_of_lesson: "single"
provided_materials:
  - type: "textbook chapter"
    path_or_ref: "<path to uploaded file>"
materials_scope: "fill-gaps"
new_lesson_context:
  rough_topics: ["topic-a", "topic-b", "topic-c"]
  length_target: "5-6 topics"
  media_preferences: "prefer interactive demos over static plots where the parameter sensitivity is the teaching point"
  model_after: "<sibling course>/<sibling slug>"
deploy_target: "new"
deploy_action: "push-to-github"
deploy_service_kind: null
deploy_service: null
```

### Example — update mode

```
mode: "update"
course: "<course display code>"
course_dir: "<course>"
slug: "<slug>"
audience_level: "Second-year undergrad"
pedagogical_goal: "working"
scope_of_lesson: "single"
existing_lesson_root: "<workspace_root>/<course>/claude_lessons/<slug>/"
research_depth: "light"
scope_of_change: "specific"
scope_topics: ["topic-a", "topic-b"]
media_hints: ["refine the group-velocity graph", "replace the static uncertainty image with an interactive demo"]
working_tree_state: "clean"
deploy_action: "push-to-github"
deploy_service_kind: null
deploy_service: null
```

## Aggressive-defaults policy for casual one-liners

For terse one-liners (e.g. "fix the `<component>` in `<slug>`", "update the `<slug>` lesson"), skip the 5-question gauntlet and present one condensed confirmation with assumed defaults.

**Triggers** (all must hold):

- Mode `update` with resolved `candidate_root`.
- Clean working tree.
- Request under ~20 words with an update verb.
- No explicit scope flags ("full rewrite", "deep research", "rework everything").

**Under `resource_mode: "full"`** (default): assume `research_depth: "targeted"` if the one-liner named a topic/component, else `"full"`. Never default to `light`. `scope_of_change: "specific"` if a topic was named, else `"any"`. `media_hints: []` (or single item if a medium was named). Carry audience / pedagogical goal / single-vs-multi from the previous run's record (`get --run <prior id> scoping.<field>`); fall back to `working`, `single`, inferred audience, or ask. Carry `deploy_action` / `deploy_service_kind` / `deploy_service` from the most recent prior run record whose `scoping.deploy_action` is not `skip` (`run-manifest.cjs get --run <prior id> scoping.deploy_action`, and the same for the other two); fall back to `push-to-github` / `null` / `null` if no prior run recorded a deploy or every prior run was `skip`. If the one-liner attached fresh materials, default `materials_scope: "fill-gaps"` (middle-ground default — safe when the user hasn't signalled intent either way); surface this in the confirmation so the user can flip to `course-only` or `extensions` if they want.

**Under `resource_mode: "limited"`**: `research_depth: "light"`. Otherwise as above. `materials_scope` default stays `fill-gaps` since `course-only` is already fairly cap-heavy and `extensions` would violate the cheap-pass signal.

**Confirmation**: "Here's what I'm assuming for this update — change anything?" with a compact bullet list including `resource_mode`. Options: `Looks good, proceed`, `Change some fields`, `Run the full 5-question interview`. On partial change, ask only the flagged fields. Aggressive defaults never apply in new mode.

**Exception — `session_mode: "headless"`**: aggressive defaults apply in **both** modes and their triggers are waived (there is no one to run an interview with). Fill every field from the task text, `COURSE.md`, and the previous run's record, in that order of authority; the confirmation is not asked but is written verbatim into the Phase 2 `PLAN FOR APPROVAL` block as `ASSUMPTIONS`, so the single blocking gate covers it. A field with no source and no safe default — which lesson, which course — blocks instead of being guessed.

## Output

Phase 0 writes its result into the run record, then renders. Nothing here is hand-written into `lesson_build.log.md` — a hand-written Phase 0 section would be frozen above the render marker as if it predated the record, and every later render would add a second `## Phase 0 — Scoping` below it.

`init` already recorded `mode`, `session_mode`, `course` and `slug`. The rest:

```bash
run-manifest.cjs set --lesson <lesson_root> effort_mode        <deep|standard|light>
run-manifest.cjs set --lesson <lesson_root> lesson.lesson_file src/<slug>.jsx
run-manifest.cjs set --lesson <lesson_root> scoping.<field>    <value>          # once per field
run-manifest.cjs render --lesson <lesson_root>
```

The fields to set, all under `scoping.` unless named otherwise:

- **Mode detail**: `mode_detail` — `candidate: <path>` for an update, `consolidate: <slug>, <slug>, ...` for a restructure. (The bare mode is the record's `mode`, set at `init`.)
- **Mode confirmed**: `mode_confirmed` — `YES`, or the user-corrected mode if they overrode detection.
- **Gate forms**: `gate_delivery` — when `session_mode` is not `interactive`, the form each gate will take. (`session_mode` itself was set at `init`.)
- **Course context** (when `<course>/COURSE.md` exists): `course_context` — `COURSE.md read — map row <row>, N pending chunks, conventions applied: <fields>`.
- **Working tree state** (update mode only): the word Q2 above recorded, in `scoping.working_tree`, which renders as `Working tree state:`. `clean` renders when nothing was recorded; a run that recorded `dirty: ...` renders that, never `clean`. The stash fields render only on a record from the old flow, marked legacy.
- **Base SHA and worktree** (update mode only): `git.base_branch` and `git.base_sha` per the section above; `git.worktree` and `git.worktree_state` are written by `worktree add`, never by hand.
- **Scoping artifact**: every field of the YAML-ish block from the section above, one `set scoping.<field>` each, including `resource_mode`, `deploy_action`, `deploy_service_kind` and `deploy_service` — the next update reads that deploy triple back from this record.
- **Timestamps**: the record's `started` is phase start; set `scoping.phase0_ended` at phase end. ISO 8601.
- **User answers (raw)**: `scoping.user_answers` — the verbatim answers, in order, for traceability when things go sideways later — or, in a `headless` run, the assumed values with their source.

Do **not** create `lesson_build.log.md` by hand in either mode: `render` generates the `# Lesson Build Log — <course> / <slug>` header when no log exists, and keeps a pre-existing one — a lesson built before this skill, or hand-written — exactly as it is, above the marker.

Full log skeleton lives in `references/log-template.md`; the record's schema in `references/run-record.md`.

## Handoff to Phase 1

Once the scoping artifact is recorded, the build worktree opened (update mode) and the log re-rendered, main Claude proceeds to Phase 1 — reading and writing under `git.worktree`, never in the user's checkout: it runs the worker fan-out itself (extraction/research spawns persisting to `.build-scratch/evidence/`), then spawns `content-orchestrator-agent` to synthesize — new mode with the artifact + evidence dir; update mode additionally with the existing-media inventory pre-scan (generated by main Claude via Grep/Glob — see `references/phase-1-content.md`). No content work happens without a completed scoping artifact; Phase 0 is a hard gate.
