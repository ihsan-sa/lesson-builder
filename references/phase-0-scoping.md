# Phase 0 — Scoping Interview

## Purpose

Phase 0 runs before any content work and produces a **scoping artifact** that drives every downstream phase (starting with Phase 1 content analysis). Main Claude conducts a short AskUserQuestion interview whose questions are adapted to the detected mode (`new` vs `update`) and to whatever materials the user provided with the initial request. The goal is to leave Phase 0 with enough information to either spawn `content-orchestrator-agent` against a clear scope (new mode) or against a known existing lesson root with a bounded research re-sweep (update mode). No research, no orchestrator spawns, and no file writes happen until Phase 0 completes.

## Mode detection recap

Mode detection fires **before** the scoping interview as the very first action inside the skill. It is best-effort; Phase 0's first question always confirms the result. Logic summary:

- **Update verbs** scanned in the user's initial message: `update|updating|updated|rework|reworking|revise|revising|improve|improving|refresh|refreshing|modify|modifying|tweak|tweaking|fix|fixing|enhance|enhancing`.
- **Lesson reference patterns**: course directories + slugs discovered via Glob over `<workspace_root>/*/claude_lessons/*/`, or any path the user pastes that contains `claude_lessons`.
- **Candidate resolution**: full path → use directly; course + slug → resolve to `<workspace_root>/<course>/claude_lessons/<slug>/`; only slug or only course → Glob for matches and use if exactly one.
- **Mode assignment**: verb + resolved candidate → `update` with `candidate_root`; verb + unresolved → `update` with `candidate_root=null` (ask in Phase 0); no verb + no candidate → `new`; verb + new-sounding intent → `new` with logged ambiguity.

Full decision tree, edge cases, and the update verb table live in `references/update-mode.md`. High-level summary also lives in `SKILL.md`. Do not duplicate that detail here; cross-link it.

Main Claude writes the detection result as the first line under `## Phase 0 — Scoping` in the log doc:

- New mode: `Detected mode: new`
- Update mode (resolved): `Detected mode: update (candidate: <workspace_root>/<course>/claude_lessons/<slug>/)`
- Update mode (unresolved): `Detected mode: update (candidate: null — will ask)`

## Question taxonomy — new mode

New mode asks a fixed set of **always-asked** questions, plus one branch of **conditional** questions depending on whether the user already provided source material (textbook chapter, slide deck, problem set, lecture notes) or nothing at all.

### Always asked (new mode)

1. **Course code** — "Which course directory should this lesson live under?" Main Claude runs `Glob <workspace_root>/*/claude_lessons/` to enumerate existing course directories, presents them as options, and appends `Other (specify)` for a new course directory. The course code the user picks for display (e.g., in headers and commit messages) is asked as a separate free-text follow-up.
2. **Lesson slug** — "What directory slug should the lesson live under (kebab-case, e.g. `topic-name`)?" Free-text.
3. **Audience level** — "What's the target audience?" Options: `First-year undergrad`, `Second-year undergrad`, `Upper-year undergrad`, `Graduate / review`, `Mixed (specify)`.
4. **Pedagogical goal** — "How deep should this lesson go?" Options: `Survey (broad tour, minimal derivations)`, `Working knowledge (standard course coverage)`, `Mastery (derivations, edge cases, exam-level)`.
5. **Single vs multi-lesson** — "Is this one lesson or a multi-lesson unit?" Options: `Single lesson`, `Multi-lesson unit (specify count)`.
6. **Deploy target** — "Is this a brand-new lesson, or replacing an existing one at the same slug?" Options: `Brand-new lesson`, `Replacing existing lesson at <course>/<slug>`.

### Conditional — material provided

If the user attached or linked source material (textbook pages, slide deck, PDF, lecture notes, problem set), ask:

- **Augment style** — "How should the research agents use the material you provided?" Options: `Stick close (the material is the spine, research fills gaps only)`, `Augment with additional research (use as anchor, broaden where useful)`, `Cross-reference (treat as one source among several, verify against other references)`.

### Conditional — no material

If no material was provided, ask:

- **Research depth** — "How deep should the initial research sweep go?" Options: `Rough sweep first (scope confirmation before deep dive)`, `Direct deep research (topic list already clear)`, `Textbook-parallel (pick a textbook to mirror)`.
- **Scope qualifiers** — "Any scope constraints?" Free-text covering: rough topic list or key concepts, target lesson length, specific media preferences, existing lessons to model after, whether agents should decide topic count.

## Question taxonomy — update mode

Update mode has **5 questions in order**. Course code, slug, and deploy target are auto-populated from `candidate_root` and are not re-asked. Audience level, pedagogical goal, and single-vs-multi are still asked because they may have shifted since the original build.

Before asking, main Claude runs two **pre-checks**:

1. **Working-tree pre-check**: `git status --short <lesson_root>` from the repo root, captures stdout, and uses the result to decide whether question 2 needs to surface the dirty-tree warning. If the output is empty, working tree is clean and the question can be skipped (or confirmed implicitly).

2. **`@core` pre-check**: Grep `src/<slug>.jsx` for `from "@core"` imports. If the count is zero, the lesson predates the `_lesson-core/` migration and still inlines chat code. Update mode is a default no-go on non-`@core` lessons because `code-review-agent` will block at Phase 4. Inject a migration-first warning into question 1 options:
   - `Yes, update that lesson (migration required first — switch to new mode)` (default)
   - `Update without migration (bypass @core check; I accept the risk)` (narrow escape hatch; warn in the log)
   - `Different lesson`
   - `Actually a brand-new lesson`

If the `@core` check passes, proceed with the normal question 1 option set.

### The 5 update-mode questions

1. **Mode confirmation** — "I detected an update to `<course>/claude_lessons/<slug>` at `<workspace_root>/<course>/claude_lessons/<slug>/`. Is that the lesson to revise?" Options: `Yes, update that lesson`, `Different lesson (specify course and slug)`, `Actually a brand-new lesson (switch to new mode)`. If `candidate_root` is null, rephrase as "Which existing lesson should I update?" with free-text or a Glob-enumerated option list.

2. **Working-tree check** — only surfaced if `git status --short <lesson_root>` returned non-empty. "Your working tree has uncommitted changes in `<lesson_root>`. How should I proceed?" Options: `Stash them and continue (I'll record the stash ref for recovery)`, `Abort — I'll commit first and rerun`, `Discard them (destructive, requires explicit confirm)`. If clean, skip the question entirely and log `Working tree: clean`.

3. **Research depth** — "How deep should the research re-sweep be?" Options: `Light (default — work from existing content, your concerns, and any new materials)`, `Targeted (re-research specific topics you name)`, `Full (treat like a new lesson — 5-10x slower than light, used rarely)`. Default is `light` when the user gives a casual request (see aggressive-defaults policy below).

4. **Scope of change** — "Which topics or sections need work?" Options: `Any topic (open-ended review — the orchestrator picks)`, `Specific topics (free-text list of topic ids or titles)`, `Replace whole lesson structure (warning: this is close to a rewrite — consider new mode instead)`. If the user picks the third option, warn and offer to switch to new mode before proceeding.

5. **Media hints (optional)** — "Any media you specifically want kept, refined, replaced, removed, or added?" Free-text. Advisory hints only; feeds into `medium-decider-agent` in Phase 2 but doesn't override its verdict.

### Still asked in update mode (not auto-populated)

- Audience level (may have shifted from original build)
- Pedagogical goal (may have shifted)
- Single vs multi-lesson (unlikely to change, but cheap to confirm)

### Auto-populated from `candidate_root` (not asked)

- Course directory (parsed from path segment)
- Slug (parsed from path segment)
- Deploy target (always "update in place" in update mode)

## Scoping artifact format

Phase 0 output is a structured artifact written to the log and passed to Phase 1. Format is YAML-ish; fields vary by mode.

### Common fields (both modes)

```
mode: "new" | "update"
course: "<course display code>"
course_dir: "<course>"
slug: "<slug>"
audience_level: "..."
pedagogical_goal: "survey" | "working" | "mastery"
scope_of_lesson: "single" | "multi (count: N)"
```

### New-mode fields

```
provided_materials:
  - type: "textbook chapter" | "slides" | "problem set" | "notes" | "none"
    path_or_ref: "..."
augment_style: "stick-close" | "augment" | "cross-reference" | null
research_depth: "rough-sweep-first" | "direct-deep" | "textbook-parallel" | null
new_lesson_context:
  rough_topics: [...]
  length_target: "..."
  media_preferences: "..."
  model_after: "<course>/<slug>" | null
deploy_target: "new" | "replacing: <course>/<slug>"
```

### Update-mode fields

```
existing_lesson_root: "<workspace_root>/<course>/claude_lessons/<slug>/"
research_depth: "light" | "targeted" | "full"
scope_of_change: "any" | "specific" | "full-replace"
scope_topics: [...]  # only when scope_of_change == "specific"
media_hints: [...]
working_tree_state: "clean" | "stashed: <stash-ref>" | "discarded"
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
augment_style: "augment"
new_lesson_context:
  rough_topics: ["topic-a", "topic-b", "topic-c"]
  length_target: "5-6 topics"
  media_preferences: "prefer interactive demos over static plots where the parameter sensitivity is the teaching point"
  model_after: "<sibling course>/<sibling slug>"
deploy_target: "new"
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
```

## Aggressive-defaults policy for casual one-liners

If the user's initial request is a terse one-liner (e.g. "fix the `<component-name>` in `<slug>`", "update the `<slug>` lesson"), skip the 5-question gauntlet and instead present **one condensed confirmation** bundling the assumed defaults. This reduces friction for quick turnaround work.

**Trigger conditions** (all must hold):

- Mode is `update` with `candidate_root` already resolved.
- Working tree is clean (no dirty-tree question needed).
- User request is under ~20 words and uses an update verb.
- No explicit scope flags (no mention of "full rewrite", "deep research", "rework everything").

**When triggered**, assume:

- `research_depth: "light"`
- `scope_of_change: "any"` (or `"specific"` if the user named a topic in the one-liner)
- `media_hints: []` (or a single-item list if the user named a medium in the one-liner)
- Audience / pedagogical goal / single-vs-multi: carry forward from the existing lesson's `lesson_build.log.md` if present, otherwise the safest defaults for the detected course directory (`working`, `single`, audience inferred from any previously-built lesson under the same course directory, else ask).

**Confirmation phrasing**: "Here's what I'm assuming for this update — change anything before I start?" followed by a compact bullet list of the assumed fields. The user gets one AskUserQuestion with options `Looks good, proceed`, `Change some fields (specify)`, `Actually run the full 5-question interview`.

If the user picks "change some fields", fall back to asking only the fields they flagged. If they pick "full interview", run the standard 5-question flow. Aggressive defaults never apply in new mode — new lessons always get the full scoping interview.

## Output

Main Claude writes the following to `<lesson_root>\lesson_build.log.md` under `## Phase 0 — Scoping` (new mode) or `### Phase 0 — Scoping (update)` nested under `## Update YYYY-MM-DD (run-id: <short-hash>)` (update mode):

- **Mode detection line**: `Detected mode: new` or `Detected mode: update (candidate: <path>)`.
- **Mode confirmed**: `YES` / user-corrected mode if they overrode detection.
- **Working tree state** (update mode only): `clean` / `stashed: <stash-ref>` / `discarded`.
- **Scoping artifact**: the full YAML-ish block from the section above, indented under a "Scoping artifact:" label.
- **Timestamps**: phase start and phase end in ISO 8601 local time.
- **User answers (raw)**: the verbatim AskUserQuestion answers, in order, for traceability when things go sideways later.

For update mode, if `lesson_build.log.md` does not yet exist, create it with a header noting "first recorded update; lesson pre-existed". For new mode, create the log file fresh with the standard header (`# Lesson Build Log — <course> / <slug>`, `Started: <timestamp>`, `Skill: lesson-builder v<...>`).

Full log skeleton lives in `references/log-template.md`.

## Handoff to Phase 1

Once the scoping artifact is written and the log is updated, main Claude proceeds to Phase 1. It uses the artifact to build the input prompt for `content-orchestrator-agent`: new mode receives the artifact plus provided materials; update mode receives the artifact plus an existing-media inventory pre-scan (generated by main Claude via Grep/Glob over the lesson JSX and asset directories — see `references/phase-1-content.md` for pre-scan details). The orchestrator's behavior branches on `mode` and (for update mode) on `research_depth`. No content work happens without a completed scoping artifact; Phase 0 is a hard gate.
