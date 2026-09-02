# safe-render corpus

Headless check that `references/bootstrap/_lesson-core/chat/safeRender.js` neutralises
model-controlled HTML and leaves benign content untouched. Runs the real production path
(`processResponse` -> `renderChatHtml` -> `stripActiveContent` -> `sanitizeHtml`) inside a
real Chromium DOM via Playwright, so the parser under test is the one lessons ship with.

```
cd tests/safe-render
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install   # drop the env var to fetch Playwright's Chromium
SAFE_RENDER_BROWSER=/usr/bin/google-chrome node run.cjs   # or omit to use Playwright's Chromium
```

- `corpus.cjs` — `xss` vectors (each must render inert: no trap fired, no request left the
  harness origin, output passes a deny-list oracle, and the sanitiser is idempotent) and
  `benign` samples (sanitised output must serialise byte-for-byte like the raw parse, with
  nothing dropped).
- `run.cjs` — the runner. Exit code 0 only when every vector and sample passes.

## Scratch-workspace validation (render checks)

`scratch-validate.sh` bootstraps a throwaway workspace per `references/bootstrap.md`, scaffolds
the template lesson, runs its `test_lesson.cjs`, then boots Vite and drives
`scratch/harness_check.cjs` (Playwright) against `scratch/harness.jsx`: KaTeX inline + display
math, a legit `<<DEMO>>` SVG (title, viewBox, width/height, laid-out size, SVG namespace), the
`demo-lint` observation for a bad `<<DEMO>>`, table / code / img / `<<SOURCES>>` / reply-block
wrapping, an XSS bubble (must stay inert), and zero CSP console violations on both the harness
and the real lesson page.

```
SAFE_RENDER_BROWSER=/usr/bin/google-chrome PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
LESSON_SRC=/path/to/<course>/claude_lessons/<slug>/src/<slug_snake>.jsx tests/safe-render/scratch-validate.sh
```

`LESSON_SRC` is optional: without it the placeholder lesson only passes `test_lesson.cjs`'s
structural checks (by design, see bootstrap.md) and the render checks still run.
