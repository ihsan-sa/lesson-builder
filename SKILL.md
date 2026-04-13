---
name: lesson-builder
description: "Build or update interactive JSX lesson apps in a workspace that follows the `<workspace_root>/<course>/claude_lessons/<slug>/` layout. Supports two modes: (1) new mode — build a lesson from scratch via a 6-phase multi-agent pipeline (scoping → content analysis → plan + approval gate → execution → review → deploy); (2) update mode — modify an existing lesson in place (content, media, structure). Trigger when the user asks to create, build, make, write, or add a lesson, OR when the user asks to update, rework, revise, improve, refresh, modify, tweak, fix, or enhance an existing lesson, OR references an existing lesson by course and slug. Replaces the legacy jsx-lesson skill for new builds and all updates."
---

# Lesson Builder

Build interactive React lesson apps (.jsx) with tabbed topics, LaTeX equations, SVG graphs, animations, and an embedded AI tutor chatbot, OR update existing lessons in place. Each lesson is a Vite project that imports chat + UI infrastructure from `<workspace_root>/_lesson-core/` via the `@core` alias.

**Before starting any run**, read the reference docs relevant to the detected mode:
- `references/update-mode.md` — read FIRST if any update-mode verb or lesson reference appears in the user's request. Single-file orientation covering mode detection, the 5 media actions, branch/stash/merge invariants, no-grandfathering rule, links into phase docs.
- `references/phase-0-scoping.md` through `references/phase-5-deploy.md` — phase-by-phase procedures for both modes.
- `references/template.md` — lesson skeleton (new-mode assembly starting point).
- `references/server-template.md` — Vite config, proxy shim, package.json.
- `references/checklists.md` — KaTeX safety, template compliance, graph preview tab, RefImg pattern, 17-test suite, project CLAUDE.md format, update-mode pre-flight and splice checklists.
- `references/graph-schema-guide.md` — derive `GRAPH_SCHEMA` from `DEFAULT_GRAPH_PARAMS`; also used for update-mode backfill.
- `references/log-template.md` — `lesson_build.log.md` skeleton and update-mode append format.

## Quality policy

**The default is maximum teaching quality.** When choosing between a richer medium (interactive demo, manim animation, detailed matplotlib figure, full research sweep) and a cheaper one, pick the richer medium whenever it teaches the concept better. Do not drop ideas, graphics, derivations, or visualization opportunities because they take longer to produce or cost more specialist runtime. Runtime is not the optimization target; student understanding is.

If the user explicitly flags limited resources — phrases like "quick pass", "keep it cheap", "use less demanding media", "fast update" — the skill flips to a resource-conscious mode: prefer prose and static SVG over manim/interactive, cap research depth at `light` or `targeted`, and break ties toward cheaper actions. Main Claude detects the flag from the initial user message and threads `resource_mode: "full" | "limited"` through the scoping artifact into every phase and every specialist brief. Surface the switch in the log (`Resource mode: limited` or `Resource mode: full`) so the decision is traceable.

When `resource_mode` is `"full"` (the default) main Claude and spawned agents must not silently downgrade media richness, research depth, fix-loop iterations, or visual-QA coverage to save time. If the user wants a cheaper run, they will say so explicitly.

## Mode detection

Before the scoping interview fires, run regex + Glob detection on the user's initial message to assign `mode ∈ {new, update}` plus, for update mode, a candidate `<lesson_root>`.

**Update verbs**: `update|updating|rework|reworking|revise|revising|improve|improving|refresh|refreshing|modify|modifying|tweak|tweaking|fix|fixing|enhance|enhancing`.

**Lesson references**: existing course directories found via Glob `<workspace_root>/*/claude_lessons/*/`, or paths containing `claude_lessons`. The active `<workspace_root>` is derived from the current working directory or asked of the user at Phase 0 if ambiguous.

**Mode assignment**:
- Verb + resolved candidate → `mode=update`, `candidate_root=<path>`.
- Verb + unresolved candidate → `mode=update`, `candidate_root=null`, ask in Phase 0.
- No verb, no candidate → `mode=new`.
- Verb + new-sounding intent (e.g., "rework the skill, make a new lesson") → `mode=new`, log ambiguity.

**Confirmation is mandatory**. Phase 0's first question always confirms mode. Detection is a best-effort hint; the user has final say.

See `references/update-mode.md` for full decision tree and edge cases.

## Pipeline (6 phases)

```
Phase 0 — Scoping            AskUserQuestion interview. Mode-branched questions.
Phase 1 — Content Analysis   content-orchestrator-agent (new: research + deep-review;
                              update: read existing, diff, content-review)
Phase 2 — Plan               medium-decider-agent (new: ranked media; update: 5-way
                              keep/refine/replace/remove/add). Human approval gate.
Phase 3 — Execution          Parallel specialists. New: assemble from scratch.
                              Update: git branch + splice assembly.
Phase 4 — Review + Fix       Parallel code/content/test/visual-QA. Progress-aware fix loop.
                              Update: no-grandfathering + regression-watch stop rule.
Phase 5 — Deploy             Local build verify. New: commit + push to main.
                              Update: commit to branch, merge --no-ff, stash recovery.
```

**One mandatory human approval gate** at Phase 2, regardless of mode. No execution work starts until the user approves the Lesson Plan artifact (new mode: full plan; update mode: change-list summary).

**One log document** at `<lesson_root>/lesson_build.log.md`, owned by main Claude. Update-mode runs append a `## Update YYYY-MM-DD (run-id: <hash>)` section preserving original build history.

## Infrastructure

Chat, UI primitives, styling, and proxy code live in one canonical place: `<workspace_root>/_lesson-core/`. Lessons import via `@core` (a Vite alias). **Never inline chat code into a lesson** — fix bugs or add features in `_lesson-core/` and every lesson inherits the change.

```
<workspace_root>/
  _lesson-core/                 Shared module (imported via @core)
    chat/                       Chatbot, ChatBubble, ThreadPanel, processResponse,
                                buildSystemPrompt, chatState, chat.css.js
    ui/                         Eq, M, P, Section, KeyConcept, CollapsibleBlock, RefImg
    constants/                  THEMES_G, MODELS, EFFORT_LEVELS
    hooks/useKatex.js           KaTeX CDN loader
    server/proxy.js             Canonical Express proxy (shim-imported by lessons)
    package.json                Backend deps (express, cors)
    index.js                    Barrel export consumed via @core alias
  <course>/claude_lessons/<slug>/
    src/
      main.jsx                  5-line ReactDOM entry
      <slug>.jsx                Lesson-specific content (topics, graphs, TOPICS array, LessonApp)
    server/proxy.js             1-line shim importing ../../../../_lesson-core/server/proxy.js
    vite.config.js              Sets @core alias + server.fs.allow
    package.json                Lesson deps (React, Vite, KaTeX, etc.)
    test_lesson.cjs             17-test QA suite
    index.html
    lesson_build.log.md         Build + update trail (owned by main Claude)
```

`<workspace_root>` is the monorepo root; `<course>` and `<slug>` are the course directory and lesson slug collected during Phase 0 scoping. The skill assumes the three-level layout `<workspace_root>/<course>/claude_lessons/<slug>/` because the `@core` alias and proxy shim depths are hardcoded to it.

Runtime architecture:
```
Browser (Vite dev server :5173)
  |
  |-- /chat, /session/*, /upload  -->  Vite proxy  -->  Express proxy (:3001+)
  |                                                        |
  |                                                        +--> claude CLI (spawned per session)
  |
  +-- React app (lesson component imports Chatbot from @core)
```

## Agent team

All agents are bundled with the skill at `agents/` — the skill is self-contained and does not depend on any workspace-level or machine-global agent directory. On first use, Claude Code reads agent definitions directly from `agents/*.md` inside the skill folder.

**Orchestration and content**:
- `content-orchestrator-agent` — Phase 1 sub-orchestrator (new-mode research coordinator; update-mode diff driver)
- `content-review-agent` — pedagogical content review (Phase 1 + Phase 4; update-mode awareness)
- `research-agent` — topic-area research with source reliability judgment

**Media planning and production**:
- `medium-decider-agent` — ranked media recommendations (new-mode); 5-way taxonomy (update-mode)
- `graphics-agent` — SVG graphs + matplotlib references (update-mode: preserve function name on refine)
- `manim-agent` — animations (update-mode: overwrite .py/.mp4 at same paths on refine)
- `interactive-demo-agent` — interactive demos (update-mode: preserve `<InteractiveDemo title>` on refine)
- `web-image-agent` — web-sourced images

**Review**:
- `code-review-agent` — template compliance, KaTeX safety, Babel parse
- Visual-QA specialists: `geometry-agent`, `colour-agent`, `readability-agent`, `scientific-accuracy-agent`, `motion-timing-agent`, `interaction-agent` (agnostic of mode)

Visual-QA specialists receive the **original stated intent** in update mode (as captured by content-orchestrator), not the user's most recent concerns — so refined media gets evaluated against what it was always supposed to show.

Every agent respects `resource_mode: "full" | "limited"`. `"full"` is the default; agents treat any absent field as `"full"` and bias toward pedagogical quality.

## Execution guidance

- **Launch specialists in parallel** wherever possible (user preference: aggressive parallel delegation, ~8 agents per message for bulk similar work).
- **One AskUserQuestion approval gate** at the end of Phase 2. No exceptions.
- **Log every phase transition** to `lesson_build.log.md`. Update mode appends, never overwrites.
- **Iterate the progress-aware fix loop until the lesson meets the quality bar** under `resource_mode: "full"`. The stop rules halt only on demonstrable regression or stall, not on iteration count. Under `resource_mode: "limited"`, tighten the stop rules aggressively.
- **Update mode: always create a branch** before Phase 3 work. Never splice directly on main.
- **Never skip the post-splice sanity pass** in update mode Phase 3 step 4.6. Semantic corruption is cheap to cause and expensive to catch later.

## Legacy

`~/.claude/skills/jsx-lesson/` remains as a legacy reference (tactical wins — KaTeX safety rules, 17-test suite layout, graph preview tab convention, matplotlib visual review pipeline, RefImg pattern). Its trigger description points at `lesson-builder` for all new lesson work. Do not delete jsx-lesson.
