# Phase 0 — Scoping Interview

## Purpose

Phase 0 runs before content work and produces the **scoping artifact** that drives downstream phases. Main Claude conducts a short AskUserQuestion interview whose questions adapt to the detected mode and to whatever materials the user provided. Leave Phase 0 with enough to either spawn `content-orchestrator-agent` against a clear scope (new) or against a known lesson root with a bounded re-sweep (update). No research, orchestrator spawns, or file writes before Phase 0 completes.

## Mode detection recap

Detection fires before the scoping interview. Best-effort; Phase 0's first question confirms.

- **Update verbs**: `update|updating|updated|rework|reworking|revise|revising|improve|improving|refresh|refreshing|modify|modifying|tweak|tweaking|fix|fixing|enhance|enhancing`.
- **Lesson references**: course + slug via Glob over `<workspace_root>/*/claude_lessons/*/`, or any path containing `claude_lessons`.
- **Candidate resolution**: full path → use directly; course + slug → resolve to `<workspace_root>/<course>/claude_lessons/<slug>/`; only slug or only course → Glob; use if exactly one match.
- **Mode assignment**: verb + resolved → `update`; verb + unresolved → `update` with `candidate_root=null`; no verb → `new`; verb + new-sounding intent → `new` with logged ambiguity.

Full decision tree in `references/update-mode.md`.

Main Claude writes the detection result as the first line under `## Phase 0 — Scoping` in the log doc:

- New mode: `Detected mode: new`
- Update mode (resolved): `Detected mode: update (candidate: <workspace_root>/<course>/claude_lessons/<slug>/)`
- Update mode (unresolved): `Detected mode: update (candidate: null — will ask)`

### Resource-mode detection

Alongside mode detection, scan the initial message for resource-conscious signals: `quick`, `fast`, `cheap`, `minor`, `light pass`, `quick pass`, `keep it simple`, `avoid manim`, `skip research`, and similar.

- No triggers → `resource_mode: "full"` (default).
- Trigger present → `resource_mode: "limited"`.

`resource_mode` threads through every phase and spawn. Surface the detected value at Phase 0 confirmation. Log as `Resource mode: full|limited`; on ambiguity, default to `full` and note for confirmation.

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

Update mode asks **5 questions**. Course code, slug, and deploy target are auto-populated from `candidate_root`. Audience level, pedagogical goal, and single-vs-multi are asked because they may have shifted.

Pre-checks run first:

1. **Working-tree**: `git status --short <lesson_root>`. Empty stdout → clean; skip question 2.

2. **`@core`**: Grep `src/<slug>.jsx` for `from "@core"`. If absent, the lesson predates the `_lesson-core/` migration and inlines old chat code. Update is a default no-go because `code-review-agent` will block at Phase 4. Replace question 1 options:
   - `Yes, update that lesson (migration required first — switch to new mode)` (default)
   - `Update without migration (bypass @core check; I accept the risk)`
   - `Different lesson`
   - `Actually a brand-new lesson`

### The 5 update-mode questions

1. **Mode confirmation** — "I detected an update to `<course>/claude_lessons/<slug>` at `<workspace_root>/<course>/claude_lessons/<slug>/`. Is that the lesson to revise?" Options: `Yes, update that lesson`, `Different lesson (specify course and slug)`, `Actually a brand-new lesson (switch to new mode)`. If `candidate_root` is null, rephrase as "Which existing lesson should I update?" with free-text or a Glob-enumerated option list.

2. **Working-tree check** — only surfaced if `git status --short <lesson_root>` returned non-empty. "Your working tree has uncommitted changes in `<lesson_root>`. How should I proceed?" Options: `Stash them and continue (I'll record the stash ref for recovery)`, `Abort — I'll commit first and rerun`, `Discard them (destructive, requires explicit confirm)`. If clean, skip the question entirely and log `Working tree: clean`.

3. **Research depth** — "How deep should the research re-sweep be?" Options: `Full (comprehensive re-research — treats the lesson like a new build; default when resource_mode is full and quality is the priority)`, `Targeted (re-research specific topics you name — good balance when only part of the lesson needs a fresh look)`, `Light (minimal re-research — work from existing content, your concerns, and any new materials; default when resource_mode is limited)`. Default is `full` when `resource_mode: "full"` and the update scope is broad; `targeted` when the scope is narrow; `light` only when `resource_mode: "limited"` or the user explicitly requested a shallow pass.

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
resource_mode: "full" | "limited"   # default "full"; "limited" only if user explicitly signalled a quick pass
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

For terse one-liners (e.g. "fix the `<component>` in `<slug>`", "update the `<slug>` lesson"), skip the 5-question gauntlet and present one condensed confirmation with assumed defaults.

**Triggers** (all must hold):

- Mode `update` with resolved `candidate_root`.
- Clean working tree.
- Request under ~20 words with an update verb.
- No explicit scope flags ("full rewrite", "deep research", "rework everything").

**Under `resource_mode: "full"`** (default): assume `research_depth: "targeted"` if the one-liner named a topic/component, else `"full"`. Never default to `light`. `scope_of_change: "specific"` if a topic was named, else `"any"`. `media_hints: []` (or single item if a medium was named). Carry audience / pedagogical goal / single-vs-multi from the existing `lesson_build.log.md`; fall back to `working`, `single`, inferred audience, or ask.

**Under `resource_mode: "limited"`**: `research_depth: "light"`. Otherwise as above.

**Confirmation**: "Here's what I'm assuming for this update — change anything?" with a compact bullet list including `resource_mode`. Options: `Looks good, proceed`, `Change some fields`, `Run the full 5-question interview`. On partial change, ask only the flagged fields. Aggressive defaults never apply in new mode.

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
