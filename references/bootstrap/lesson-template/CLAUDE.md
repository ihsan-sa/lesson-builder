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
1. Start the proxy: `npm run proxy` (finds an available port, writes it to `server/.proxy-port`)
2. Start the Vite dev server: `npm run dev`
3. Open the URL Vite prints (default `http://localhost:5173`)

## Key Files
- `src/__SLUG_SNAKE__.jsx` -- Main lesson component (all content, graphs, TOPICS, chatbot wiring)
- `src/main.jsx` -- React entry point
- `server/proxy.js` -- 1-line shim importing the shared proxy from `_lesson-core`
- `test_lesson.cjs` -- 17-test automated QA suite
- `index.html` -- HTML shell

## Testing
```bash
npm test          # runs: node test_lesson.cjs src/__SLUG_SNAKE__.jsx
```

## Author/tester notes
- **Ctrl+Click context gate**: adding a lesson block or chat reply block to the chat context requires holding **Ctrl** while clicking. Plain clicks are intentionally inert (a capture-phase listener stops them) — this is a feature, not a bug.
- The chat panel only renders in dev (`import.meta.env.PROD` gates it out of static builds, which have no proxy).
- Model/effort pickers sit in the chat header; keyboard shortcut chars are defined in `_lesson-core/constants/models.js`.

## Tabs
<!-- Filled in by the lesson build: one line per TOPICS entry -->

## Graphs
<!-- Filled in by the lesson build: one line per graph component (name: what it shows) -->
