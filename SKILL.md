---
name: lesson-builder
description: "Build or update interactive JSX lesson apps in a workspace that follows the `<workspace_root>/<course>/claude_lessons/<slug>/` layout. Supports two modes: (1) new mode — build a lesson from scratch via a 6-phase multi-agent pipeline (scoping → content analysis → plan + approval gate → execution → review → deploy); (2) update mode — modify an existing lesson in place (content, media, structure). Trigger when the user asks to create, build, make, write, or add a lesson, OR when the user asks to update, rework, revise, improve, refresh, modify, tweak, fix, or enhance an existing lesson, OR references an existing lesson by course and slug. Replaces the legacy jsx-lesson skill for new builds and all updates."
---

# Lesson Builder

Build interactive React lesson apps (.jsx) with tabbed topics, LaTeX equations, SVG graphs, animations, and an embedded AI tutor chatbot, OR update existing lessons in place. Each lesson is a Vite project that imports chat + UI infrastructure from `<workspace_root>/_lesson-core/` via the `@core` alias.

**Before starting a run**, read the references relevant to the detected mode:
- `references/update-mode.md` — read FIRST for update mode. Covers mode detection, 5 media actions, branch/stash/merge invariants, no-grandfathering rule.
- `references/phase-0-scoping.md` through `references/phase-5-deploy.md` — phase procedures for both modes.
- `references/template.md` — new-mode lesson skeleton.
- `references/server-template.md` — Vite config, proxy shim, package.json.
- `references/checklists.md` — KaTeX safety, template compliance, 17-test suite, splice checklists.
- `references/graph-schema-guide.md` — `GRAPH_SCHEMA` derivation and update-mode backfill.
- `references/desmos-schema.md` — Desmos state schema for `<DesmosGraph>` and `<<DESMOS>>`. Read before authoring either; covers the string-vs-number footgun that crashes `setState` silently.
- `references/log-template.md` — `lesson_build.log.md` format.

## Quality policy

**The default is maximum teaching quality.** When choosing between a richer medium (interactive demo, manim animation, detailed matplotlib figure, full research sweep) and a cheaper one, pick the richer medium whenever it teaches the concept better. Student understanding is the optimization target, not runtime.

If the user flags limited resources — phrases like "quick pass", "keep it cheap", "fast update" — the skill flips to resource-conscious mode: prefer prose and static SVG over manim/interactive, cap research depth at `light` or `targeted`, and break ties toward cheaper actions. Main Claude detects the flag from the initial message and threads `resource_mode: "full" | "limited"` through the scoping artifact into every phase and specialist brief. Log the value (`Resource mode: full|limited`) for traceability.

Under `resource_mode: "full"` (the default) agents must not silently downgrade media richness, research depth, fix-loop iterations, or visual-QA coverage to save time. Cheaper runs require an explicit user signal.

## Mode detection

Before the scoping interview, run regex + Glob detection on the user's initial message to assign `mode ∈ {new, update}` plus, for update mode, a candidate `<lesson_root>`.

**Update verbs**: `update|updating|rework|reworking|revise|revising|improve|improving|refresh|refreshing|modify|modifying|tweak|tweaking|fix|fixing|enhance|enhancing`.

**Lesson references**: existing course directories found via Glob `<workspace_root>/*/claude_lessons/*/`, or paths containing `claude_lessons`. `<workspace_root>` is derived from the cwd or asked at Phase 0 if ambiguous.

**Mode assignment**:
- Verb + resolved candidate → `mode=update`, `candidate_root=<path>`.
- Verb + unresolved candidate → `mode=update`, `candidate_root=null`, ask in Phase 0.
- No verb, no candidate → `mode=new`.
- Verb + new-sounding intent (e.g., "rework the skill, make a new lesson") → `mode=new`, log ambiguity.

Phase 0's first question always confirms mode. Detection is a hint; the user has final say.

See `references/update-mode.md` for the full decision tree and edge cases.

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

**One mandatory human approval gate** at Phase 2, regardless of mode. Execution starts only after the user approves the Lesson Plan artifact (new mode: full plan; update mode: change-list summary).

**One log document** at `<lesson_root>/lesson_build.log.md`, owned by main Claude. Update runs append a `## Update YYYY-MM-DD (run-id: <hash>)` section, preserving prior history.

## Infrastructure

Chat, UI primitives, styling, and proxy code live at `<workspace_root>/_lesson-core/`. Lessons import via the `@core` Vite alias. **Never inline chat code into a lesson** — fixes and features added in `_lesson-core/` propagate to every lesson.

```
<workspace_root>/
  _lesson-core/                 Shared module (imported via @core)
    chat/                       Chatbot, ChatBubble, ThreadPanel, processResponse,
                                buildSystemPrompt, chatState, chat.css.js
    ui/                         Eq, M, P, Section, KeyConcept, CollapsibleBlock,
                                RefImg, DesmosGraph
    constants/                  THEMES_G, MODELS, EFFORT_LEVELS
    hooks/useKatex.js           KaTeX CDN loader
    hooks/useDesmos.js          Desmos CDN loader (gated on VITE_DESMOS_KEY)
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

`<workspace_root>` is the monorepo root; `<course>` and `<slug>` are collected at Phase 0. The three-level layout `<workspace_root>/<course>/claude_lessons/<slug>/` is required because the `@core` alias and proxy shim depths are hardcoded to it.

**Chat protocols the bot can emit (already implemented in `_lesson-core/chat/`)** — useful when planning which media to author into the lesson vs. leave for the chatbot to produce live:

- `<<EDIT_GRAPH>>`, `<<DEMO>>` (inline SVG), `<<SUGGEST>>` (lesson augmentation), `<<SOURCES>>`, `<<COMMIT_SUGGEST>>`.
- `<<DESMOS>>` — bot emits a Desmos state JSON; client validates + hydrates a live calculator. Animation control is Desmos's own per-slider Play button inside the expression panel; `isPlaying:true` is stripped upstream so only the student initiates animation. Requires `VITE_DESMOS_KEY` in `.env.local`; fails loud if missing. Authors embed `<DesmosGraph state={...}/>` directly in lesson JSX for pre-authored interactive graphs. State schema is error-prone — `sliderBounds.{min,max,step}`, `lineWidth`, `lineOpacity`, `pointSize`, `pointOpacity`, `parametricDomain.{min,max}`, `polarDomain.{min,max}` must be JSON strings, not numbers, or `setState` crashes silently. Read `references/desmos-schema.md` before authoring either surface.
- `<<REINFORCE>>` — bot records a durable heuristic about the student, covering three first-class trigger categories: (1) MEDIA signals, (2) STATED PREFERENCES on tone/register/analogy use/explanation depth/format, (3) CORRECTIONS of a prior approach. The client accumulates entries into `[REINFORCED BEHAVIORS]` injected back via ACTIVE CONTEXT and the system prompt treats them as the highest-priority heuristic governing tone, register, analogy use, and explanation depth on EVERY response, not just media choices. Lesson planning implication: seed each topic with a diverse media mix so the media-signal arm has something to learn from; the preference and correction arms work regardless.

**Ctrl+Click context gate** (client-side UX, added late in the dev loop): clicking a lesson content block or chat reply block to add it to chat context now requires the Ctrl key to be held. `body.ctx-ctrl-held` gates hover highlights and the pointer cursor; a capture-phase document click listener stops non-Ctrl clicks before they reach the per-lesson `handleContentClick`. Author-testing note: mention this in lesson-level CLAUDE.md if a human tester will QA the lesson — they will otherwise wonder why plain clicks stopped adding context.

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

All agents are bundled at `agents/` — the skill is self-contained. Claude Code reads `agents/*.md` directly from the skill folder.

**Orchestration and content**:
- `content-orchestrator-agent` — Phase 1 sub-orchestrator (new: research coordinator; update: diff driver)
- `content-review-agent` — pedagogical content review (Phase 1 + Phase 4)
- `research-agent` — topic-area research with source reliability judgment

**Media planning and production**:
- `medium-decider-agent` — ranked recommendations (new); 5-way taxonomy (update)
- `graphics-agent` — SVG graphs + matplotlib references (update refine: preserve function name)
- `manim-agent` — animations (update refine: overwrite .py/.mp4 at same paths)
- `interactive-demo-agent` — interactive demos (update refine: preserve `<InteractiveDemo title>`)
- `web-image-agent` — web-sourced images

**Review**:
- `code-review-agent` — template compliance, KaTeX safety, Babel parse
- Visual-QA: `geometry-agent`, `colour-agent`, `readability-agent`, `scientific-accuracy-agent`, `motion-timing-agent`, `interaction-agent`

In update mode, visual-QA specialists receive the **original stated intent** (captured by content-orchestrator), not the user's most recent concerns — so refined media is evaluated against what it was always supposed to show.

Every agent respects `resource_mode: "full" | "limited"`. Absent field → `"full"`.

## Execution guidance

- **Launch specialists in parallel** wherever possible (~8 agents per message for bulk similar work).
- **One AskUserQuestion approval gate** at the end of Phase 2. No exceptions.
- **Log every phase transition** to `lesson_build.log.md`. Update mode appends, never overwrites.
- **Iterate the progress-aware fix loop until the lesson meets the quality bar** under `resource_mode: "full"`. Stop rules halt only on demonstrable regression or stall, not iteration count. Under `"limited"`, tighten stop rules aggressively.
- **Update mode: always create a branch** before Phase 3 work. Never splice on main.
- **Never skip the post-splice sanity pass** in update mode Phase 3 step 4.6. Semantic corruption is cheap to cause and expensive to catch later.

## Legacy

`~/.claude/skills/jsx-lesson/` remains as a legacy reference. Do not delete.
