# Server / Project-File Template

## Purpose

This doc defines the project-file templates that turn a lesson directory into a runnable Vite project: `package.json`, `vite.config.js`, `server/proxy.js` shim, `index.html`, `src/main.jsx`, `test_lesson.cjs`, `.gitignore`, and a lesson-level `CLAUDE.md`. These are the infrastructure files the lesson content JSX sits on top of. The **new-mode Phase 3** assembly step writes all of them from these templates. **Update mode** normally does NOT touch any of these files. The only exceptions are when one is explicitly broken (e.g., missing dep, invalid JSON, wrong alias) or materially stale (e.g., core API rename the lesson can no longer load against).

The canonical drop-in copies ship with the skill at `references/bootstrap/lesson-template/`. Phase 3 copies from there, substituting the `__SLUG__` / `__SLUG_SNAKE__` / `__COURSE_CODE__` / `__LESSON_TITLE__` placeholders (procedure in `references/bootstrap.md`), rather than hand-typing the snippets below. The snippets stay as documentation of what each file is for and why the specific lines exist; only edit them when behavior needs to change. When in doubt, diff against `references/bootstrap/lesson-template/` — that is the reference implementation.

If the workspace is fresh (no `<workspace_root>/_lesson-core/`), run the bootstrap procedure in `references/bootstrap.md` FIRST — it installs the shared core that every template below imports from.

## Directory layout

```
<course>/claude_lessons/<slug>/
  src/
    main.jsx
    <slug>.jsx              (lesson content; uses underscores, e.g. my_topic.jsx)
  server/
    proxy.js                (1-line shim -> _lesson-core/server/proxy.js)
    .proxy-port             (auto-written at runtime: the port the proxy chose)
    .isolated/              (auto-created at runtime: isolated-mode CWD)
    .uploads/               (auto-created at runtime: uploaded files)
    chat.log                (auto-written at runtime: request log)
  public/                   (optional: lesson images, videos, static assets)
  index.html
  package.json
  vite.config.js
  test_lesson.cjs
  .gitignore
  CLAUDE.md
```

Notes:
- The JSX filename replaces dashes with underscores (slug `my-topic` -> `my_topic.jsx`). This is historical but enforced by `src/main.jsx` imports and test invocations.
- The `server/.*` runtime artifacts are auto-created and covered by the shipped per-lesson `.gitignore`; do not commit them.
- `public/` is only needed when the lesson references images or other static assets. Omit it otherwise.

## `package.json`

Canonical form ships at `references/bootstrap/lesson-template/package.json`. Copy it, then replace `__SLUG__` with the lesson slug (dash form) in `name` and `__SLUG_SNAKE__` with the underscore form in the `test` script. Shipped contents:

```json
{
  "name": "__SLUG__",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "proxy": "node server/proxy.js",
    "test": "node test_lesson.cjs src/__SLUG_SNAKE__.jsx"
  },
  "dependencies": {
    "cors": "^2.8.5",
    "express": "^4.21.0"
  },
  "devDependencies": {
    "@babel/parser": "^7.29.2",
    "@babel/preset-react": "^7.27.1",
    "@vitejs/plugin-react": "^4.3.0",
    "katex": "^0.16.44",
    "playwright": "^1.58.2",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "vite": "^6.0.0"
  }
}
```

Key points:
- `name` = slug (dash form). Not suffixed with `-lesson`.
- `type: "module"` is required (ESM imports throughout).
- `cors` + `express` are listed as dependencies so each lesson's own `node_modules` can satisfy the canonical proxy's imports if Node resolution walks into the lesson directory first. (`_lesson-core/` also installs them; both work.)
- `katex` is a devDependency because math rendering is driven by the `useKatex` hook in `@core`, not a direct lesson import; keeping it pinned locally guarantees the version the hook expects.
- `playwright` is retained for downstream Visual-QA (screenshots/test runs); not imported at runtime by the lesson.
- **Do not add** `build`/`preview` scripts in the per-lesson `package.json` -- production builds are orchestrated by `build-all.sh` at the workspace root, which invokes `npx vite build --base="/<course>/<slug>/"` directly.
- The test runner's file extension is `.cjs`: ESM JSX sources can only be linted by a CommonJS runner because the Babel parser invocation uses `require`.

## `vite.config.js`

Copy verbatim from `references/bootstrap/lesson-template/vite.config.js`. No per-lesson customization needed:

```js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getProxyPort() {
  try {
    const portFile = path.join("server", ".proxy-port");
    return parseInt(fs.readFileSync(portFile, "utf8").trim(), 10) || 3001;
  } catch (_) {
    return 3001;
  }
}

export default defineConfig({
  plugins: [react()],
  // Load .env.local from the WORKSPACE ROOT so one key file (VITE_DESMOS_KEY)
  // serves every lesson. Vite does NOT walk upward on its own — without this,
  // a root .env.local is silently ignored and Desmos reports a missing key.
  envDir: path.resolve(__dirname, "../../.."),
  resolve: {
    alias: {
      "@core": path.resolve(__dirname, "../../../_lesson-core"),
    },
  },
  server: {
    fs: { allow: ["..", "../..", "../../..", "../../../.."] },
    proxy: {
      "/chat": `http://localhost:${getProxyPort()}`,
      "/upload": `http://localhost:${getProxyPort()}`,
      "/session": `http://localhost:${getProxyPort()}`,
      "/sessions": `http://localhost:${getProxyPort()}`,
    },
  },
});
```

Key pieces:
- **`envDir`**: points env-file resolution at the workspace root, so the single root `.env.local` (holding `VITE_DESMOS_KEY`) serves all lessons. Vite does not walk upward on its own; without `envDir` a root `.env.local` is silently ignored — the classic symptom is Desmos reporting a missing key even though the root file is populated. Do NOT copy `.env.local` into individual lessons.
- **`@core` alias**: `path.resolve(__dirname, "../../../_lesson-core")` resolves from `<slug>/` up three levels (`../` -> `claude_lessons/`, `../../` -> `<course>/`, `../../../` -> `<workspace_root>/`) to `<workspace_root>/_lesson-core/`. All shared UI and chat primitives are imported via `@core`.
- **`server.fs.allow`**: Vite's dev server refuses to serve files outside the project root by default. The four entries (`..`, `../..`, `../../..`, `../../../..`) grant access up the tree so `@core` imports actually load in dev. Without this, you get "file outside the allowed directories" errors on `npm run dev`.
- **`getProxyPort()`**: reads `server/.proxy-port` (written by the Express proxy on startup) so Vite routes `/chat`, `/session`, `/sessions`, `/upload` to whichever port the proxy picked. Falls back to 3001 if the file is missing (proxy not yet started, or down).
- **`base`**: intentionally NOT set in the config. Production builds pass `--base="/<course>/<slug>/"` as a CLI arg via `build-all.sh`, which generates correct asset URLs for a nested static deploy under `/<course>/<slug>/`.

## `server/proxy.js` (1-line shim)

```js
import "../../../../_lesson-core/server/proxy.js";
```

With the header comment as shipped in `references/bootstrap/lesson-template/server/proxy.js`:

```js
// Shim: launch the canonical proxy from _lesson-core.
// Run from lesson root: `cd <lesson> && node server/proxy.js`.
// The canonical proxy uses process.cwd() for log/port files so they
// resolve to this lesson's server/ directory.
import "../../../../_lesson-core/server/proxy.js";
```

Why a shim:
- The actual Express proxy code lives in `<workspace_root>/_lesson-core/server/proxy.js` (canonical, single source of truth).
- The shim lets each lesson start its own proxy process (so two lessons can run simultaneously on different ports) while the implementation is shared. Fixing a bug in the canonical proxy instantly fixes every lesson that imports it.
- The canonical proxy resolves log files (`chat.log`, `.proxy-port`) relative to `process.cwd()`, so running `node server/proxy.js` from the lesson root writes artifacts into that lesson's `server/` directory, not into `_lesson-core/`.
- Path depth: `../../../../` = `server/` -> `<slug>/` -> `claude_lessons/` -> `<course>/` -> `<workspace_root>/`. Adjust only if a lesson ever lives at a non-standard depth.

Canonical proxy behavior worth knowing:
- **Port selection**: base port comes from the `PROXY_PORT` env var when set, else 3001. On `EADDRINUSE` the proxy increments and retries (up to 50 attempts), then writes the chosen port to `server/.proxy-port` for Vite to read.
- **Model pass-through**: the proxy forwards the model name from the request to the CLI unchanged — it does NOT collapse full model names to `opus`/`sonnet`-style latest aliases. Selecting a specific version in the chat header runs exactly that version, not whatever the alias currently resolves to.

## `index.html`

Standard Vite shell, shipped at `references/bootstrap/lesson-template/index.html` with title placeholders:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>__COURSE_CODE__ - __LESSON_TITLE__</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.jsx"></script>
</body>
</html>
```

Substitute `__COURSE_CODE__` and `__LESSON_TITLE__` with display-friendly strings (e.g. `MATH 101 - Sequences and Series`). Any analytics `<script>` tags the workspace already injects into other lessons can be carried over, but are not required; they have no functional effect on the lesson.

## `src/main.jsx`

Five-line React entry, shipped at `references/bootstrap/lesson-template/src/main.jsx`. Substitute `__SLUG_SNAKE__`:

```jsx
import React from "react";
import ReactDOM from "react-dom/client";
import LessonApp from "./__SLUG_SNAKE__.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(<LessonApp />);
```

The lesson content file must default-export a component called `LessonApp`; this is enforced by T4 (export default) in the test suite.

## `test_lesson.cjs` (17-test validation suite)

Run as `node test_lesson.cjs src/<slug_underscored>.jsx` (or `npm test`). The script reads the lesson JSX file and runs 17 structural / content checks against it. Tests:

| # | Name | Check |
|---|------|-------|
| T1 | JSX Babel parse | `@babel/parser` parses the file with `jsx` plugin enabled. Catches syntax errors. |
| T2 | KaTeX safety | No bare `<` characters inside KaTeX string expressions (regex `{"..<.."}`), except allow-listed sequences `\\lt`, `\\leq`, `\\left`, `\\ll`, `\\lambda`, `\\langle`, `\\ldots`. Bare `<` crashes KaTeX. |
| T3 | Heading bracket safety | No bare `<` / `>` inside `<h2>`, `<h3>`, `<h4>` text nodes (JSX parse error). |
| T4 | Export default | File contains `export default`. |
| T5 | `TOPICS` defined | `const TOPICS = [` declaration present. |
| T6 | `TOPIC_CONTEXT` defined | `const TOPIC_CONTEXT = {` declaration present. |
| T7 | `LESSON_CONTEXT` defined | `const LESSON_CONTEXT =` declaration present. |
| T8 | Imports from `@core` | File imports from `"@core"` and references `Chatbot`. |
| T9 | Theme className | Uses `className="theme-dark"` or `className="theme-light"` (maps the gold accent via CSS vars in `@core`). |
| T10 | IBM Plex | File mentions `'IBM Plex'` somewhere (inline monospace label styles). |
| T11 | Core CSS classes | Imports `Eq`, `KeyConcept`, and `Chatbot` from `@core` (these apply `.eq-block`, `.key-concept`, `.chat-panel`). |
| T12 | No browser storage | No `localStorage` usage (sessionStorage alias `_ss` is intentionally allowed). |
| T13 | No emojis | Unicode emoji regex finds nothing. |
| T14 | `TOPIC_CONTEXT` keys match `TOPICS` ids | Babel AST walk: every `{id: "..."}` entry in `TOPICS` has a matching key in `TOPIC_CONTEXT`. Replaces a buggy regex-based check. |
| T15 | `useKatex` hook | Imports `useKatex` from `@core`. |
| T16 | `<Chatbot>` render | File renders `<Chatbot>` with a `courseCode=` prop. |
| T17 | No direct API | Imports `Chatbot` from `@core` (not a local copy) and does NOT contain `api.anthropic.com` (all chat routed through the local proxy). |

The canonical executable is `references/bootstrap/lesson-template/test_lesson.cjs` — copy it verbatim; it is content-agnostic and works on every lesson. The suite is also summarized in `references/checklists.md` ("17-test suite summary").

## `.gitignore` (per-lesson runtime carve-outs)

Ships at `references/bootstrap/lesson-template/.gitignore`. Copy verbatim; no placeholders. Contents:

```
server/.isolated/
server/.uploads/
server/.proxy-port
server/chat.log
node_modules/
dist/
```

Keeps the proxy's auto-created runtime artifacts, dependency trees, and build output out of version control. If the workspace-level `.gitignore` (from `references/bootstrap/workspace-root/gitignore.template`) already covers these, the per-lesson file is harmless redundancy — keep it anyway so a lesson stays clean even when copied out of the workspace.

## `CLAUDE.md` (lesson-level project notes)

Ships at `references/bootstrap/lesson-template/CLAUDE.md`, placeholder-substituted (`__COURSE_CODE__`, `__LESSON_TITLE__`, `__SLUG__`, `__SLUG_SNAKE__`). Structure of the shipped file:

- `# Lesson App` header lines: **Project** (`__COURSE_CODE__ -- __LESSON_TITLE__`), **Course**, **Slug**.
- `## Stack` — React 19 + Vite 6, KaTeX via CDN, inline SVG graphs plus optional `<DesmosGraph>` (key in the workspace-root `.env.local`, resolved via `envDir`), shared chat + UI from `@core` (never inlined), Express proxy shim spawning the local `claude` CLI.
- `## How to Run` — `npm run proxy`, then `npm run dev`.
- `## Key Files` — lesson JSX, `main.jsx`, proxy shim, `test_lesson.cjs`, `index.html`.
- `## Testing` — `npm test`.
- `## Author/tester notes` — the Ctrl+Click context gate (plain clicks intentionally inert), the chat panel rendering only in dev (`import.meta.env.PROD` gates it out of static builds), model/effort pickers in the chat header.
- `## Tabs` and `## Graphs` — shipped empty; the lesson build fills them in (one line per `TOPICS` entry / graph component).

Ownership rule: the template owns the scaffolding above; the build owns the `## Tabs` / `## Graphs` listings. Anything else a human adds later (per-lesson gotchas, graph parameter tables, notes) is authored content — preserve it on updates.

## Install + run

If the workspace is fresh and `_lesson-core/` does not yet exist, run the bootstrap procedure in `references/bootstrap.md` first (copies the canonical payload, installs deps). Then:

```
cd <workspace_root>/_lesson-core
npm install
```

Per-lesson first run:

```
cd <workspace_root>/<course>/claude_lessons/<slug>
npm install
```

Launching (two terminals, from the lesson root):

```
# Terminal 1
node server/proxy.js

# Terminal 2
npx vite
```

Open the URL Vite prints (defaults to `http://localhost:5173`; increments to 5174, 5175, ... when earlier ports are in use). The proxy picks a free port starting at 3001 (or at `PROXY_PORT` if that env var is set) and writes it to `server/.proxy-port`; Vite reads that file on startup to route `/chat`, `/session`, `/sessions`, `/upload`.

## Update-mode behavior

Update mode (Phase 3 of the update pipeline) leaves every file in this doc **untouched by default**. Rationale: these files rarely change, and rewriting them risks clobbering per-lesson customizations (analytics tags, extra scripts, hand-edited test thresholds, curated CLAUDE.md notes).

Edit them only when:
- `package.json` is missing a dep the updated lesson actually needs, or pin versions are materially broken;
- `vite.config.js` has the wrong `@core` alias depth (only ever happens if the lesson was moved), is missing `server.fs.allow`, or is missing `envDir` (symptom: Desmos key not found despite a populated workspace-root `.env.local`);
- `server/proxy.js` has a stale shim path (wrong depth);
- `index.html` is missing `#root` or the main.jsx script tag;
- `src/main.jsx` references the wrong lesson file name;
- `test_lesson.cjs` is missing (copy from `references/bootstrap/lesson-template/test_lesson.cjs`) or is pre-refactor and still checks for bespoke inlined chat code;
- `.gitignore` is missing (copy from `references/bootstrap/lesson-template/.gitignore`).

For `CLAUDE.md` updates, use a **preserving edit**: replace only the section being refreshed (from its heading up to the next same-level heading or EOF), keeping all other content verbatim. Do not `Write` the whole file. Typical mechanism: Grep for the heading, read the surrounding lines, use `Edit` with the existing section as `old_string` and the new section as `new_string`.

When in doubt, diff against `references/bootstrap/lesson-template/` (mentally substituting the placeholders) or a previously-built lesson, and only touch what is actually different-in-a-bad-way. A cosmetic difference (comment wording, key ordering) is not a reason to rewrite.
