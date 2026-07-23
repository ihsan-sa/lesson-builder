---
name: lesson-builder
description: "Build or update interactive JSX lesson apps in a workspace that follows the `<workspace_root>/<course>/claude_lessons/<slug>/` layout. Supports two modes: (1) new mode — build a lesson from scratch via a 6-phase multi-agent pipeline (scoping → content analysis → plan + approval gate → execution → review → deploy); (2) update mode — modify an existing lesson in place (content, media, structure). Trigger when the user asks to create, build, make, write, or add a lesson, OR when the user asks to update, rework, revise, improve, refresh, modify, tweak, fix, or enhance an existing lesson, OR references an existing lesson by course and slug. Replaces the legacy jsx-lesson skill for new builds and all updates."
---

# Lesson Builder

Build interactive React lesson apps (.jsx) with tabbed topics, LaTeX equations, SVG graphs, animations, and an embedded AI tutor chatbot, OR update existing lessons in place. Each lesson is a Vite project that imports chat + UI infrastructure from `<workspace_root>/_lesson-core/` via the `@core` alias.

**Before starting a run**, read the references relevant to the detected mode:
- `references/bootstrap.md` — read FIRST on every run. One Glob decides whether the workspace is fresh; if `<workspace_root>/_lesson-core/` is missing, run the bootstrap procedure before Phase 0.
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

**Practice problems from source materials are gold.** When the user's provided materials contain past finals, past midterms, homework questions, or problem sets, Phase 1 extracts each problem with its source attribution and full worked solution; Phase 2 plans them into a per-topic practice section; Phase 3 renders them via the template's `PracticeProblem` card pattern (statement visible, solution collapsed, provenance-marked). These are the highest-value calibration content the lesson can carry — they're the actual questions the student will be graded on. Do NOT fabricate practice problems via research; include only real, attributed ones (course materials, or textbook end-of-chapter problems under `materials_scope: "extensions"`). Collapsed, sourced solutions on practice cards are compatible with the tutor's withhold-first PEDAGOGY POLICY — the policy governs the chatbot's dialogue, not the lesson's attributed practice material.

## Do NOT build these (debunked / overstated)

Maximum teaching quality means evidence-based, not intuitive-but-wrong. The following are appealing, common in ed-tech, and either **debunked** or badly **overstated** by the learning-science evidence. No agent may emit, design around, or recommend them — in lesson copy, media choices, tutor steering, or the plan. They are not a style preference; they fail proper testing. (Mirrors the SaaS `myth-lint.ts` categories.)

- **Learning-styles / VARK matching.** Do not assess a "visual / auditory / kinesthetic learner" or route/restyle content to a sensory style — the meshing hypothesis has no replicated effect. Match the medium to the **content** (a graph because the concept is spatial), never to a learner label.
- **Dale's-cone "remember X%" retention numbers.** Never display or design around "we remember 10% of what we read / 90% of what we do" figures — the percentages are fabricated and carry no empirical basis. Justify interactivity via the testing/doer effect instead.
- **Bloom's "2-sigma" claims.** Do not promise or design to a 2-sigma tutoring gain; it has never replicated at that magnitude.
- **Brain-training / far-transfer claims.** Do not claim a drill or game trains "general intelligence" or transfers broadly. Practice trains the **actual target knowledge**, nothing more.
- **Gamification as motivator — leaderboards, points, badges, streaks.** Do not add them or write copy that motivates via them; they boost extrinsic over intrinsic motivation and demoralize low performers. Use informational, task-level competence feedback (this is the same rule the tutor PEDAGOGY POLICY enforces).
- **Hattie-rank / "0.40 hinge" / bare "d=0.NN" badges as an oracle.** Do not cite a Visible-Learning rank or a precise effect-size badge as a build-priority truth — the meta-meta-analytic ranks carry wide uncertainty. Cite the principle, not the rank.

Left/right-brain "dominance" and "digital natives" are in the same debunked bucket; do not frame learners by them either. When a medium or content choice is tempting for one of these reasons, that is the signal to drop it — see Quality policy and the Phase 2 medium-selection criteria.

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

## Workspace bootstrap (fresh-workspace gate)

Every run begins with one Glob: does `<workspace_root>/_lesson-core/index.js` exist? `_lesson-core/` is the shared chat + UI + proxy module every lesson imports via the `@core` Vite alias; without it nothing builds, nothing tests, and the chatbot will not start.

- **Exists** → run the one-Grep **core-version check**: does `<workspace_root>/_lesson-core/chat/buildSystemPrompt.js` contain `PEDAGOGY_POLICY`? If yes, continue to Phase 0. If no, the workspace core predates the policy-in-core move — new-template lessons built against it would ship with NO tutoring policy anywhere. Offer a core refresh from the payload (per `references/bootstrap.md` § Core-version gate); if declined, Phase 3 must embed the legacy policy text into this lesson's `LESSON_CONTEXT` as a fallback.
- **Missing** → run the bootstrap procedure in `references/bootstrap.md` before Phase 0. This is mechanical (copy canonical payload, `npm install`, seed workspace-root files including `.claude/agents/`) and needs no approval gate — announce in one sentence and proceed.

The skill ships the canonical payload at `references/bootstrap/`: the full `_lesson-core/` source tree, a placeholder lesson skeleton (`lesson-template/`, including per-lesson `CLAUDE.md` and `.gitignore`), and workspace-root templates (`.gitignore`, `.env.local` example, `build-all.sh`, `netlify.toml`, runtime tutor agents for `.claude/agents/`). Bootstrapping from this payload is the only supported way to stand up a fresh workspace; do **not** pull from the legacy `jsx-lesson` skill, whose copies predate the `@core` refactor.

Acceptance criterion: after bootstrap + new-mode Phases 0-4, a skeleton lesson must reach `17/17 passed` on `test_lesson.cjs`, render KaTeX, show the chatbot bubble in dev, respect the Ctrl+Click context gate, and render `<DesmosGraph/>` (when `VITE_DESMOS_KEY` is set). See `references/bootstrap.md` for the full checklist.

## Pipeline (6 phases)

```
Phase 0 — Scoping            AskUserQuestion interview. Mode-branched questions.
                              Captures materials_scope (course-only/fill-gaps/extensions),
                              deploy_action (push-to-github/push-to-custom/commit-only/skip),
                              and deploy_service.
Phase 1 — Content Analysis   Main Claude fans out extraction/research workers
                              (evidence persisted to .build-scratch/evidence/);
                              content-orchestrator-agent synthesizes. Honors
                              materials_scope to cap or broaden research.
Phase 2 — Plan               medium-decider-agent (new: ranked media; update: 5-way
                              keep/refine/replace/remove/add). Human approval gate.
                              Deploy intent surfaced in the plan's DEPLOY: block.
Phase 3 — Execution          Parallel specialists. New: assemble from scratch.
                              Update: git branch + splice assembly.
                              Both: write/update private-by-default .gitignore
                              covering materials/, source/, notes/, *.local, .env*.
Phase 4 — Review + Fix       Parallel code/content/test/visual-QA + pedagogy gate.
                              Progress-aware fix loop.
                              Update: no-grandfathering + regression-watch stop rule.
Phase 5 — Deploy             Branches on deploy_action. Build verify runs under every
                              action (sanity check). Gitignore-override question
                              (default: no override — nothing private gets published).
                              New: commit + push per deploy_action.
                              Update: commit to branch, merge --no-ff (unless commit-only),
                              push per deploy_action, stash recovery.
```

**One mandatory human approval gate** at Phase 2, regardless of mode. Execution starts only after the user approves the Lesson Plan artifact (new mode: full plan; update mode: change-list summary).

**One log document** at `<lesson_root>/lesson_build.log.md`, owned by main Claude. Update runs append a `## Update YYYY-MM-DD (run-id: <hash>)` section, preserving prior history.

## Infrastructure

Chat, UI primitives, styling, and proxy code live at `<workspace_root>/_lesson-core/`. Lessons import via the `@core` Vite alias. **Never inline chat code into a lesson** — fixes and features added in `_lesson-core/` propagate to every lesson. On a fresh workspace this directory is installed from `references/bootstrap/_lesson-core/` per the bootstrap procedure above.

```
<workspace_root>/
  .claude/agents/               Runtime tutor-team agents (seeded by bootstrap;
                                discovered by the spawned claude CLI)
  _lesson-core/                 Shared module (imported via @core)
    chat/                       Chatbot, ChatBubble, ThreadPanel, processResponse,
                                buildSystemPrompt, chatState, chat.css.js
    ui/                         Eq, M, P, Section, KeyConcept, CollapsibleBlock,
                                RefImg, PracticeProblem, FormulaSheetBox, SummaryBox,
                                DesmosGraph
    constants/                  THEMES_G, MODELS, EFFORT_LEVELS, DEFAULT_MODEL,
                                DEFAULT_EFFORT
    hooks/useKatex.js           KaTeX CDN loader
    hooks/useDesmos.js          Desmos CDN loader (gated on VITE_DESMOS_KEY)
    server/proxy.js             Canonical Express proxy (shim-imported by lessons;
                                model name passed through unchanged; PROXY_PORT honored)
    package.json                Backend deps (express, cors)
    index.js                    Barrel export consumed via @core alias
  <course>/claude_lessons/<slug>/
    src/
      main.jsx                  5-line ReactDOM entry
      <slug>.jsx                Lesson-specific content (topics, graphs, TOPICS array, LessonApp)
    server/proxy.js             1-line shim importing ../../../../_lesson-core/server/proxy.js
    vite.config.js              Sets @core alias + server.fs.allow + envDir at the
                                workspace root (single .env.local serves all lessons)
    package.json                Lesson deps (React, Vite, KaTeX, etc.)
    test_lesson.cjs             17-test QA suite
    index.html
    CLAUDE.md                   Per-lesson project doc (from the template)
    .gitignore                  Runtime carve-outs (from the template)
    lesson_build.log.md         Build + update trail (owned by main Claude)
```

`<workspace_root>` is the monorepo root; `<course>` and `<slug>` are collected at Phase 0. The three-level layout `<workspace_root>/<course>/claude_lessons/<slug>/` is required because the `@core` alias and proxy shim depths are hardcoded to it.

**Filename convention**: the lesson source file is always `src/<slug_snake>.jsx` — the slug with dashes replaced by underscores (slug `fourier-series` → file `src/fourier_series.jsx`). Phase 0 records it as `lesson_file` in the scoping artifact, and every phase, test command, `lessonFile` Chatbot prop, and reviewer brief consumes that one value. Wherever these docs write `src/<slug>.jsx` as shorthand, they mean this file.

**Chat protocols the bot can emit (already implemented in `_lesson-core/chat/`)** — useful when planning which media to author into the lesson vs. leave for the chatbot to produce live:

- `<<EDIT_GRAPH>>`, `<<DEMO>>` (inline SVG), `<<SUGGEST>>` (lesson augmentation), `<<SOURCES>>`, `<<COMMIT_SUGGEST>>`.
- `<<DESMOS>>` — bot emits a Desmos state JSON; client validates + hydrates a live calculator. Animation control is Desmos's own per-slider Play button inside the expression panel; `isPlaying:true` is stripped upstream so only the student initiates animation. Requires `VITE_DESMOS_KEY` in `.env.local`; fails loud if missing. Authors embed `<DesmosGraph state={...}/>` directly in lesson JSX for pre-authored interactive graphs. State schema is error-prone — `sliderBounds.{min,max,step}`, `lineWidth`, `lineOpacity`, `pointSize`, `pointOpacity`, `parametricDomain.{min,max}`, `polarDomain.{min,max}` must be JSON strings, not numbers, or `setState` crashes silently. Read `references/desmos-schema.md` before authoring either surface.
- `<<REINFORCE>>` — bot records a durable heuristic about the student, covering three first-class trigger categories: (1) MEDIA signals, (2) STATED PREFERENCES on tone/register/analogy use/explanation depth/format, (3) CORRECTIONS of a prior approach. The client accumulates entries into `[REINFORCED BEHAVIORS]` injected back via ACTIVE CONTEXT and the system prompt treats them as the highest-priority heuristic governing tone, register, analogy use, and explanation depth on EVERY response, not just media choices. Lesson planning implication: seed each topic with a diverse media mix so the media-signal arm has something to learn from; the preference and correction arms work regardless.

**Chat runtime facts** authors and reviewers should know: the canonical tutoring PEDAGOGY POLICY (retrieval-first, least-help-first hint ladder, task-level feedback) is injected by `@core/chat/buildSystemPrompt.js` — lessons do NOT paste it into `LESSON_CONTEXT`, and legacy lessons that did are marker-detected and not double-injected. The chat panel renders only in dev — `import.meta.env.PROD` gates it (and all `/session` fetches) out of static deploys, which have no proxy. The chat opens on `DEFAULT_MODEL`/`DEFAULT_EFFORT` from `constants/models.js` (the `default: true` entry; keyboard-shortcut chars must be unique and avoid j/g). The proxy passes the selected model name to the `claude` CLI unchanged, so a specific version pick runs that exact version. `<Chatbot>` accepts an optional `institution` prop (e.g. `institution="University X"`) that appears in the tutor system prompt; omit it and no institution is mentioned.

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

All agents are bundled at `agents/` — the skill is self-contained. Claude Code reads `agents/*.md` directly from the skill folder. Judgment-critical agents (content-orchestrator, medium-decider, content-review, research, scientific-accuracy) omit a `model:` line and therefore inherit the session model — a high-end session should not silently downgrade its judgment layer. Production and rubric agents pin `sonnet`.

**Orchestration and content** (main Claude owns all worker spawns — subagents cannot spawn subagents; workers persist full output to `.build-scratch/evidence/` and return summaries):
- `content-orchestrator-agent` — Phase 1 SYNTHESIS over persisted worker evidence (new: compile + conflict resolution; update: diff/classify driver)
- `content-review-agent` — pedagogical content review (Phase 1 + Phase 4)
- `research-agent` — source extraction, topic research (equations/concepts with sources), claim verification

**Media planning and production**:
- `medium-decider-agent` — ONE spawn per lesson, all topics: ranked media + diversity/dedup (new); 5-way taxonomy (update)
- `graphics-agent` — SVG graph components + matplotlib references (update refine: preserve function name)
- `manim-agent` — animations (build: `.py` at lesson root + named MP4; update refine: overwrite both at same paths)
- `interactive-demo-agent` — interactive demos (update refine: preserve `<InteractiveDemo title>`)
- `web-image-agent` — web-sourced images (license-verified; Phase 2 pre-flight + Phase 3 fetch)

**Review**:
- `code-review-agent` — template compliance, KaTeX safety, Babel parse (read-only; returns `{ok, blockers, majors, minors}`)
- `visual-qa-agent` — one spawn per artifact, full presentation rubric (geometry, colour/theme, readability, motion for video)
- `scientific-accuracy-agent` — independent correctness lens per scientific artifact
- `interaction-agent` — drives interactive demos via Playwright

**Runtime tutor team** (not part of the build pipeline): `breakthrough-gap-agent` and `curriculum-context-agent` ship at `references/bootstrap/workspace-root/.claude/agents/` and are seeded into `<workspace_root>/.claude/agents/` at bootstrap, alongside copies of the pipeline agents above. The embedded chatbot's spawned `claude` CLI discovers that registry and delegates directly (graphics, QA, research) while a student is using the lesson — the tutor itself is the orchestrator, since subagents cannot spawn subagents.

In update mode, visual-QA specialists receive the **original stated intent** (captured by content-orchestrator), not the user's most recent concerns — so refined media is evaluated against what it was always supposed to show.

Every agent respects `resource_mode: "full" | "limited"`. Absent field → `"full"`.

## Execution guidance

- **Scale the fan-out to the lesson.** A 1-2 topic lesson wants single agents per phase (one research pass, no per-resource teams); a 6+ topic lesson justifies the full parallel fan-out. Media DECISIONS always go through one whole-lesson medium-decider spawn — never per-topic deciders, which cannot coordinate diversity or dedup. Independent PRODUCTION (one specialist per media item) parallelizes freely.
- **One AskUserQuestion approval gate** at the end of Phase 2. No exceptions.
- **Log every phase transition** to `lesson_build.log.md`. Update mode appends, never overwrites.
- **Fix deterministic failures first** (parse, tests, build) — they are unambiguous and other findings are often their symptoms — then iterate the progress-aware fix loop until the lesson meets the quality bar under `resource_mode: "full"`. Stop rules halt on demonstrable regression or stall, with an absolute cap of 6 iterations. Under `"limited"`, tighten stop rules aggressively.
- **Update mode: always create a branch** before Phase 3 work. Never splice on main.
- **Never skip the post-splice sanity pass** in update mode Phase 3 step 4.6. Semantic corruption is cheap to cause and expensive to catch later.

## Legacy

If a `~/.claude/skills/jsx-lesson/` folder exists on this machine, it is a legacy predecessor kept as reference only — do not delete it, and do not source any bootstrap or template files from it (its copies predate the `@core` refactor). It is not shipped with this skill; standalone installs will not have it.

