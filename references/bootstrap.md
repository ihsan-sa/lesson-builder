# Workspace Bootstrap

## When to read this

Read this file at the top of Phase 0 **before** the scoping interview, whenever the workspace is missing `<workspace_root>/_lesson-core/`. Without that directory every lesson's `@core` import fails at dev-server startup (Vite error: "Failed to resolve import '@core'") and every test fails on T8 / T17. The rest of the skill assumes it already exists.

A missing `_lesson-core/` is the main failure mode this bootstrap fixes. If the directory is present, run the core-version gate below, then proceed to `references/phase-0-scoping.md`.

## Core-version gate (existing workspaces)

Three independent checks, run all — a workspace can pass one and fail another (e.g. a fresh clone has current core but an empty untracked `.claude/`). Check 1's refresh offer is a user gate: in a `channel` or `headless` session it takes the safe default — **decline the refresh**, apply the legacy fallback below, and report it — rather than firing a dialog nobody will see (`SKILL.md` § Session modes and gates). Checks 2 and 3 are mechanical and need no gate — and check 3 is blocking: the one case where a stale core is fatal rather than degraded.

1. **Core version**: Grep `<workspace_root>/_lesson-core/chat/buildSystemPrompt.js` for `PEDAGOGY_POLICY`. If absent, new-template lessons would ship with no tutoring policy (the new template doesn't paste it; the old core doesn't inject it). Offer a core refresh — replace `<workspace_root>/_lesson-core/` contents with the payload's (their workspace has no local core edits unless a sync log says otherwise; check it first) and re-run `npm install` there. If declined, embed the PEDAGOGY POLICY text (from the payload's `buildSystemPrompt.js` export) verbatim into each new lesson's `LESSON_CONTEXT` during Phase 3 — the legacy-compatible fallback — and note it in the log.
   Second marker, same file: `TEACHING_COMMUNICATION`. A core that has `PEDAGOGY_POLICY` but not this export predates the tutor's communication layer (response modes, scope defaults, anti-preamble/anti-sycophancy, exemplars) — the tutor still has a policy, so this is not blocking, but offer the same refresh; without it the tutor runs the older, verbosity-prone style.
2. **Agent registry**: diff `<workspace_root>/.claude/agents/` against `$SKILL/agents/` + `workspace-root/.claude/agents/` (`.claude/` is gitignored, so clones start empty and stale registries survive core refreshes). Copy missing/changed agent files in, and DELETE registry files whose names no longer exist in the skill — a stale `geometry-agent.md` still in the registry means runtime delegation runs retired prompts.
3. **Vite plugin present (blocking)**: Glob `<workspace_root>/_lesson-core/server/viteLessonProxy.js`. The lesson template's `vite.config.js` hard-imports it (`plugins: [react(), lessonChatProxy(__dirname)]`), and check 1 cannot see its absence — `PEDAGOGY_POLICY` and `TEACHING_COMMUNICATION` are both present in cores that predate the plugin. Without it the first new lesson dies at `npm run dev` with "Cannot find module …/viteLessonProxy.js" (Vite cannot even load the config), and a core that old also writes only `server/.proxy-port`, never the `server/.proxy.json` the plugin resolves through — a permanent 503. If the file is absent, refresh `<workspace_root>/_lesson-core/` from the payload before Phase 3 and re-run `npm install` there. This is not an offer and has no fallback: no session mode declines it. Run this check first: a refresh here also satisfies check 1 — skip its offer and its fallback, or the policy ends up both in the core and duplicated into every new lesson's `LESSON_CONTEXT`. If the sync log records local core edits, re-apply them on top of the refreshed core and report that. Existing lessons keep working — the refreshed `proxy.js` still writes `.proxy-port` for them.

## Detection (one Glob at session start)

```
<workspace_root>/_lesson-core/index.js        exists?
```

- **Exists** → workspace is already bootstrapped. Continue to Phase 0 normally.
- **Missing** → run the procedure below, then continue.

Tell the user in one sentence that the workspace is fresh and the bootstrap will install the shared core before Phase 0. No approval gate — this is mechanical.

## Canonical payload

The skill ships the payload at `references/bootstrap/`. It is extracted from the most developed working workspace and generalized; it is the single source of truth.

```
references/bootstrap/
  _lesson-core/              Drop-in copy of the shared module imported via @core
    index.js                 Barrel export consumed by lessons
    package.json             Backend deps (express, cors)
    chat/                    Chatbot + ChatBubble + ThreadPanel + processResponse
                             + buildSystemPrompt + buildActiveContext + chatState
                             + chat.css.js + graphSchema + observationQueue
    ui/                      Eq, primitives (P, Section, KeyConcept, CollapsibleBlock,
                             RefImg, PracticeProblem, FormulaSheetBox, SummaryBox),
                             primitives-interactive (Slider, Toggle, …), DesmosGraph
    constants/               THEMES_G + MODELS + EFFORT_LEVELS + DEFAULT_MODEL
                             + DEFAULT_EFFORT (chat opens on the default-flagged model)
    hooks/                   useKatex, useDesmos
    helpers/                 manim-runner + empty manim_scratch/ (.gitkeep)
    prompts/                 graph-editing / lesson-augmentation / thread-system
    server/proxy.js          Canonical Express proxy (imported via shim from
                             every lesson's server/proxy.js). Passes the selected
                             model name through unchanged; honors PROXY_PORT.
  lesson-template/           Skeleton lesson project (used at new-mode Phase 3)
    package.json             Per-lesson deps. Placeholders: __SLUG__, __SLUG_SNAKE__
    vite.config.js           @core alias + server.fs.allow + proxy routes + envDir
                             pointed at the workspace root (so the root .env.local
                             is actually loaded — Vite does NOT walk upward)
    index.html               Placeholders: __COURSE_CODE__, __LESSON_TITLE__
    src/main.jsx             Placeholder: __SLUG_SNAKE__
    server/proxy.js          1-line shim
    test_lesson.cjs          17-test QA suite (content-agnostic; identical
                             across every lesson in the reference workspace)
    CLAUDE.md                Per-lesson project doc. Placeholders: __SLUG__,
                             __SLUG_SNAKE__, __COURSE_CODE__, __LESSON_TITLE__
    .gitignore               Runtime carve-outs (server/.isolated/, .uploads/,
                             .proxy.json, .proxy-port, chat.log, node_modules/, dist/)
  workspace-root/            Workspace-level templates
    gitignore.template       Copy to <workspace_root>/.gitignore, adapt carve-outs
    env.local.example        Copy to <workspace_root>/.env.local, fill
                             VITE_DESMOS_KEY
    build-all.sh             Static-site build driver, edit inventory per workspace
    netlify.toml             Optional deploy config
    .claude/agents/          Runtime tutor-team agents (breakthrough-gap,
                             curriculum-context) — seeded into
                             <workspace_root>/.claude/agents/ in Step 3 so the
                             embedded chatbot can delegate via the Agent tool.
                             The tutor orchestrates producers/verifiers itself
                             (subagents cannot spawn subagents, so there is no
                             coordinator agent)
```

`references/bootstrap/_lesson-core/` omits `node_modules/` and `package-lock.json`. Both are regenerated by `npm install` during the procedure.

Do not draw any of these files from `~/.claude/skills/jsx-lesson/` — that skill is legacy and its copies predate the `@core` refactor. The bootstrap payload here is the only canonical source.

## Bootstrap procedure

Run these steps in order from `<workspace_root>`. All paths are relative to the workspace root unless noted. The `$SKILL` alias below stands for the absolute path to this skill's root (usually `~/.claude/skills/lesson-builder`).

### Step 1 — copy `_lesson-core/`

```
cp -r "$SKILL/references/bootstrap/_lesson-core" "<workspace_root>/_lesson-core"
```

Single recursive copy. No file substitutions — the payload is drop-in.

### Step 2 — install shared-core deps

```
cd <workspace_root>/_lesson-core
npm install
```

Installs `express` + `cors` so the Express proxy can start. One-time per workspace. Idempotent — safe to re-run.

### Step 3 — workspace-root files

Create these at `<workspace_root>/` if missing. Do **not** overwrite existing files without confirming with the user first; the workspace may already have a working `.gitignore` or `.env.local`.

| Source | Destination | Post-copy action |
| --- | --- | --- |
| `$SKILL/references/bootstrap/workspace-root/gitignore.template` | `<workspace_root>/.gitignore` | Adapt the course carve-out section once a real course exists. |
| `$SKILL/references/bootstrap/workspace-root/env.local.example` | `<workspace_root>/.env.local` | Workspace-root only — each lesson's `vite.config.js` sets `envDir` to the workspace root, so this single file serves every lesson; do NOT copy one per lesson. Fill `VITE_DESMOS_KEY` (obtain from https://www.desmos.com/api). Never commit. |
| `$SKILL/references/bootstrap/workspace-root/build-all.sh` | `<workspace_root>/build-all.sh` | `chmod +x build-all.sh`. Edit inventory once lessons exist. |
| `$SKILL/references/bootstrap/workspace-root/netlify.toml` | `<workspace_root>/netlify.toml` | Only copy if deploying via Netlify. |
| `$SKILL/references/bootstrap/workspace-root/.claude/agents/*.md` + `$SKILL/agents/*.md` | `<workspace_root>/.claude/agents/` | `mkdir -p` first. This registry is what the embedded chatbot's "YOUR TEAM" delegation uses at runtime (the spawned `claude` CLI discovers it by walking up from the lesson dir). Without it the tutor cannot delegate to graphics/QA/research agents. |

### Step 4 — confirm and proceed

```
<workspace_root>/_lesson-core/index.js        exists
<workspace_root>/.gitignore                   exists
<workspace_root>/.env.local                   exists (value may still be blank)
<workspace_root>/build-all.sh                 exists + executable
<workspace_root>/.claude/agents/              exists, populated
```

Log a one-line bootstrap entry in the first lesson's `lesson_build.log.md` (created in Phase 3) noting that `_lesson-core/` was installed from the skill's canonical payload on `<date>`.

Continue to `references/phase-0-scoping.md`.

## Lesson scaffolding (Phase 3 of new mode)

When Phase 3 of new mode creates the first lesson, copy the skeleton from `references/bootstrap/lesson-template/` into `<workspace_root>/<course>/claude_lessons/<slug>/`, then:

1. Rename `src/__SLUG_SNAKE__.jsx` to `src/<slug_snake>.jsx` (slug with dashes replaced by underscores). The shipped file is a minimal placeholder that only satisfies T1 (Babel parse) and T4 (`export default`); Phase 3 overwrites its contents with the real skeleton assembled from `references/template.md` plus the specialist outputs. Keep the renamed file in place while assembly runs — `main.jsx` imports it and Vite will fail on startup without it.
2. Replace placeholders:
   - `__SLUG__` → the lesson slug (dash form) in `package.json` `"name"` and `test` script, and in `CLAUDE.md`.
   - `__SLUG_SNAKE__` → snake form in `package.json` `test` script, `src/main.jsx`, and `CLAUDE.md`.
   - `__COURSE_CODE__` + `__LESSON_TITLE__` → display-friendly strings in `index.html` and `CLAUDE.md`.
3. From the lesson root: `npm install`.
4. Run `node test_lesson.cjs src/<slug_snake>.jsx` to confirm the skeleton parses. Only T1 (Babel parse) + T4 (`export default`) pass against the shipped placeholder; content-dependent tests (T5-T17) fail until Phase 3 assembly writes the real `LessonApp`, `TOPICS`, `TOPIC_CONTEXT`, `LESSON_CONTEXT`, and `GRAPH_SCHEMA`.

For update mode, none of this scaffolding runs — the lesson already exists.

## Acceptance criteria

Bootstrap alone gets the workspace to "lesson template ships and dev server boots". Reaching `17/17 passed` requires bootstrap **plus** a full new-mode pipeline run (Phases 0-4) that fills in `LessonApp`, `TOPICS`, `TOPIC_CONTEXT`, `LESSON_CONTEXT`, and `GRAPH_SCHEMA`. The checklist below therefore measures the combined outcome.

After bootstrap + new-mode Phases 0-4 on the supplied skeleton the fresh workspace must reach:

- `cd <workspace_root>/<course>/claude_lessons/<slug> && npm install` succeeds.
- `claude` CLI is on `PATH` (the proxy spawns it per chat session; without it the proxy boots but `/chat` errors on first use). The skill does not install it — confirm with `claude --version` before declaring bootstrap done.
- `node server/proxy.js` starts, writes `server/.proxy.json` (identity: port, lessonDir, pid, startedAt — what the Vite plugin resolves through) and `server/.proxy-port` (bare port number, kept for older tooling), and the proxy serves `/chat` without error.
- `npx vite` starts, the page renders with KaTeX-rendered math, the chatbot bubble appears (dev builds only), and the Ctrl+Click context gate works.
- `node test_lesson.cjs src/<slug_snake>.jsx` → `Results: 17/17 passed, 0 failed`.
- If the lesson embeds `<DesmosGraph/>` and `VITE_DESMOS_KEY` is populated, the graph renders; if the key is blank the red fallback appears (loud, expected).

If any of these fail on a fresh workspace, the canonical payload in `references/bootstrap/` is the first place to look for drift from the working reference.
