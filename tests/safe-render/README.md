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
