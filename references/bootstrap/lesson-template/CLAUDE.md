# Lesson App

**Project**: __COURSE_CODE__ -- __LESSON_TITLE__
**Course**: __COURSE_CODE__
**Slug**: __SLUG__

## Stack
- React 19 + Vite 6 (JSX, no TypeScript)
- KaTeX for math rendering (loaded from CDN)
- Inline SVG graphs; optional `<DesmosGraph>` (needs `VITE_DESMOS_KEY` in the workspace-root `.env.local`, resolved via `envDir` in `vite.config.js`)
- Shared chat + UI infrastructure imported from `@core` (`<workspace_root>/_lesson-core/`) — never inlined here
- Express proxy (`server/proxy.js` shim) spawning the local `claude` CLI per chat session

## How to Run
1. Start the proxy: `npm run proxy` (finds a free port from 3001 up and writes two files: `server/.proxy.json`, its identity — port, lessonDir, pid, startedAt — and `server/.proxy-port`, the bare number kept for `bin/lesson`; both gitignored, both removed on exit)
2. Start the Vite dev server: `npm run dev` — the `lessonChatProxy` plugin in `vite.config.js` resolves the chat routes through `server/.proxy.json` on every request and refuses to forward to another lesson's proxy, so start order does not matter
3. Open the URL Vite prints (default `http://localhost:5173`)

## Key Files
- `src/__SLUG_SNAKE__.jsx` -- Main lesson component (all content, graphs, TOPICS, chatbot wiring)
- `src/main.jsx` -- React entry point
- `server/proxy.js` -- 1-line shim importing the shared proxy from `_lesson-core`
- `vite.config.js` -- `@core` alias, `envDir`, and the `lessonChatProxy` plugin (never a `server.proxy` block for the chat routes)
- `test_lesson.cjs` -- 17-test automated QA suite
- `index.html` -- HTML shell

## Testing
```bash
npm test          # runs: node test_lesson.cjs src/__SLUG_SNAKE__.jsx
```

## Shell (Lumen)

The lesson renders inside `<LessonShell>` from `@core` — the Claude Design "Lumen" frame. It owns:

- **Top bar** (66px): rail toggle, monogram, course line, lesson title, position pill, **Tutor** button, pop-out.
- **Contents rail** (262px, collapses to 48px): one row per topic, plus a section outline under the active topic derived from the `<Section title>` headings the topic renders, with scroll-spy. Click an outline entry to jump.
- **Article**: single scrolling column capped at 680px (~68ch reading measure).
- **Tutor placement**: side dock (392px, drag 320-760), bottom dock (300px, drag 180-620), an in-app floating window, or a real browser window. The panel is portaled into a single host node that MOVES between slots — it is never re-rendered at a new position in the React tree, because that would remount `Chatbot` and silently start a new session.

Light palette only; there is no theme toggle. Tokens live in `_lesson-core/chat/chat.css.js`.

Equations are first-class: `<Eq>` renders a numbered card (numbers stamped from DOM order as `(topic.n)`) with an **Explain** pill that attaches the LaTeX to the tutor's context. `<Eq label="...">` adds a caption riding the top border.

## Author/tester notes
- **Ctrl+Click context gate**: adding a lesson block or chat reply block to the chat context requires holding **Ctrl** while clicking. Plain clicks are intentionally inert (a capture-phase listener stops them) — this is a feature, not a bug.
- **Selection gestures** (chat open): drag-select text → auto-added to chat context ("+ added" flash). Right-click a selection → context menu: *Reply* (add to context), *Reply in thread* (selection inside a chat reply opens a side thread), *Reply in this thread* (selection inside an open thread panel). **Ctrl+Shift+F** adds a selection to the surrounding thread's context. `?tab=<topic-id>` in the URL deep-links a tab.
- **Ask in a thread**: right-clicking a selection in the *lesson body* offers a lesson-anchored side thread. **Ctrl+Shift+J** does the same from either side (chat reply or lesson).
- **Press Ctrl+Shift+?** (or the `?` button in the chat header) for the full list of shortcuts and gestures. Most of the context surface is modifier-driven and has no other on-screen signifier.
- **A focused thread owns context capture**: while you are typing in a side thread, Ctrl+Click and right-click→*Reply* land in that thread rather than the main composer. Click the main input to hand routing back.
- Threads have their own attachments (`+`, paste, drag-drop) and can be stopped mid-reply. The tutor may draw a graph or cite sources inside a thread; graph edits, lesson-augmentation suggestions and commit offers only appear on main-transcript messages.
- The chat panel only renders in dev (`import.meta.env.PROD` gates it out of static builds, which have no proxy).
- **Settings popover** (gear in the panel header, or "Change" in the composer) holds Model / Reasoning effort / Answer style, plus the session controls (isolated vs shared memory, keep-on-reload, end session). Model shortcut chars are defined in `_lesson-core/constants/models.js`.
- **Answer style** is a student control: "Hints first" leaves the PEDAGOGY POLICY untouched; "Direct" relaxes only the withhold-first ordering (appended to the per-turn ACTIVE CONTEXT, see `buildActiveContext.js`). It never licenses fabricated steps.
- Each tutor tab owns its own session, transcript, threads and attachments; tabs are named after the topic that was open when they were created.

## Tabs
<!-- Filled in by the lesson build: one line per TOPICS entry -->

## Graphs
<!-- Filled in by the lesson build: one line per graph component (name: what it shows) -->
