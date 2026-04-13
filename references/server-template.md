# Server / Project-File Template

## Purpose

Project-file templates that make a lesson directory a runnable Vite project: `package.json`, `vite.config.js`, `server/proxy.js` shim, `index.html`, `src/main.jsx`, `test_lesson.cjs`, `CLAUDE.md`. New-mode Phase 3 writes these; update mode leaves them untouched unless explicitly broken (missing dep, invalid JSON, wrong alias) or materially stale (core API rename). When in doubt, diff against a previously-built lesson.

## Directory layout

```
<course>/claude_lessons/<slug>/
  src/
    main.jsx
    <slug>.jsx              (lesson content; uses underscores, e.g. my_topic.jsx)
  server/
    proxy.js                (1-line shim -> _lesson-core/server/proxy.js)
    .proxy-port             (auto-written at runtime: chosen port 3001..3050)
    .isolated/              (auto-created at runtime: isolated-mode CWD)
    .uploads/               (auto-created at runtime: uploaded files)
    chat.log                (auto-written at runtime: request log)
  public/                   (optional: lesson images, videos, static assets)
  index.html
  package.json
  vite.config.js
  test_lesson.cjs
  CLAUDE.md
```

Notes:
- The JSX filename replaces dashes with underscores (e.g. slug `my-topic` → `my_topic.jsx`). This is historical but enforced by `src/main.jsx` imports and test invocations.
- The `server/.*` runtime artifacts are gitignored and auto-created; do not commit them.
- `public/` is only needed when the lesson references images or other static assets. Omit it otherwise.

## `package.json`

Copy from any previously-built lesson in the workspace, changing only the `name` and the test script's source path. Canonical contents:

```json
{
  "name": "<slug>",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "proxy": "node server/proxy.js",
    "test": "node test_lesson.cjs src/<slug_underscored>.jsx"
  },
  "dependencies": {
    "cors": "^2.8.5",
    "express": "^4.21.0"
  },
  "devDependencies": {
    "@babel/parser": "^7.29.2",
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
- The `test` script references `test_lesson.cjs` (the file extension is `.cjs`; ESM JSX sources can only be linted by a CommonJS runner because the Babel parser invocation uses `require`).

## `vite.config.js`

Copy verbatim from any previously-built lesson in the workspace. No per-lesson customization needed:

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
- **`@core` alias**: `path.resolve(__dirname, "../../../_lesson-core")` resolves from `<slug>/` up three levels (`../` → `claude_lessons/`, `../../` → `<course>/`, `../../../` → `<workspace_root>/`) to `<workspace_root>/_lesson-core/`. All shared UI and chat primitives are imported via `@core`.
- **`server.fs.allow`**: Vite's dev server refuses to serve files outside the project root by default. The four entries (`..`, `../..`, `../../..`, `../../../..`) grant access up the tree so `@core` imports actually load in dev. Without this, you get "file outside the allowed directories" errors on `npm run dev`.
- **`getProxyPort()`**: reads `server/.proxy-port` (written by the Express proxy on startup) so Vite routes `/chat`, `/session`, `/sessions`, `/upload` to whichever port the proxy picked in the range 3001..3050. Falls back to 3001 if the file is missing (Vite dev server not yet running, or proxy down).
- **`base`**: intentionally NOT set in the config. Production builds pass `--base="/<course>/<slug>/"` as a CLI arg via `build-all.sh`, which generates correct asset URLs for the nested deploy layout under `/<course>/<slug>/`.

## `server/proxy.js` (1-line shim)

```js
import "../../../../_lesson-core/server/proxy.js";
```

With a brief header comment:

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
- Path depth: `../../../../` = `server/` → `<slug>/` → `claude_lessons/` → `<course>/` → `<workspace_root>/`. Adjust only if a lesson ever lives at a non-standard depth.

## `index.html`

Standard Vite shell. Minimum viable version:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title><Course code> -- <Lesson title></title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.jsx"></script>
</body>
</html>
```

Set `<title>` per-lesson (e.g. `<COURSE CODE> -- <Lesson title>`). Any analytics `<script>` tags the workspace already injects into other lessons can be carried over here, but are not required for local dev. Phase 3 assembly can either include them or leave them out; they have no functional effect on the lesson.

## `src/main.jsx`

Five-line React 18+ entry. Copy verbatim, substituting the slug:

```jsx
import React from "react";
import ReactDOM from "react-dom/client";
import LessonApp from "./<slug_underscored>.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(<LessonApp />);
```

The lesson content file must default-export a component called `LessonApp`; this is enforced by T17 (export default check) in the test suite.

## `test_lesson.cjs` (17-test validation suite)

Run as `node test_lesson.cjs src/<slug_underscored>.jsx`. Runs 17 structural / content checks. Full list in `references/checklists.md` → "17-test suite summary".

Reference implementation: copy verbatim from any previously-built lesson. The test file is content-agnostic and works on every lesson.

## `CLAUDE.md` (lesson-level project notes)

Keep to 10-15 lines. Template:

```markdown
## Lesson App

**Project**: <Course code> -- <Lesson title>
**Course**: <Full course name>, <Institution>, <Term>
**Topic**: <One-line topic summary>

### Stack
- React 19 + Vite 6 (JSX, no TypeScript)
- Imports shared chat + UI from `@core` (`_lesson-core/`)
- KaTeX for math (via `useKatex` hook)
- Express proxy shim (`server/proxy.js`) -> canonical proxy in `_lesson-core`
- Claude CLI sessions with SSE streaming

### How to Run
1. `node server/proxy.js` (writes free port to `server/.proxy-port`)
2. `npx vite` (dev server on http://localhost:5173)

### Key Files
- `src/<slug_underscored>.jsx` -- lesson content (TOPICS, TOPIC_CONTEXT, LESSON_CONTEXT, graphs, LessonApp)
- `src/main.jsx` -- React entry
- `server/proxy.js` -- 1-line shim to canonical proxy
- `test_lesson.cjs` -- 17-test validation suite
```

Only the `## Lesson App` section is owned by the template. Anything else in the file (hand-written notes, per-lesson gotchas, graph parameter tables) is authored content; preserve it on updates.

## Install + run

One-time after cloning the workspace:

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

Open the URL Vite prints (defaults to `http://localhost:5173`; increments to 5174, 5175, ... when earlier ports are in use). The proxy auto-picks a free port in 3001..3050 and writes it to `server/.proxy-port`; Vite reads that file on startup to route `/chat`, `/session`, `/sessions`, `/upload`.

## Update-mode behavior

Update mode leaves these files untouched by default. Rewriting risks clobbering per-lesson customizations (analytics, extra scripts, curated CLAUDE.md notes).

Edit only when:
- `package.json` is missing a dep the update needs, or pin versions are materially broken;
- `vite.config.js` has wrong `@core` alias depth (only if lesson was moved) or is missing `server.fs.allow`;
- `server/proxy.js` has stale shim path;
- `index.html` is missing `#root` or the main.jsx script tag;
- `src/main.jsx` references the wrong lesson file name;
- `test_lesson.cjs` is missing or pre-refactor.

For `CLAUDE.md`, use a **preserving edit**: replace only `## Lesson App` (from heading to next top-level heading or EOF). Do not `Write` the whole file. Grep for `## Lesson App`, then `Edit` with existing section as `old_string`.

When in doubt, diff against a previously-built lesson; touch only what is actually broken. Cosmetic differences (comment wording, key ordering) are not reasons to rewrite.
