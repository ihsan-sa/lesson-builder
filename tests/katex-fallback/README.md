# KaTeX CDN fallback evidence

Headless proof that a lesson stays fully usable when the KaTeX CDN is slow or unreachable —
the tri-state readiness in `references/bootstrap/_lesson-core/hooks/useKatex.js` and the
LaTeX-source fallback in `ui/Eq.jsx`.

```
cd tests/katex-fallback
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install   # drop the env var to fetch Playwright's Chromium
KATEX_FALLBACK_BROWSER=/usr/bin/google-chrome ./run.sh
```

`run.sh` bootstraps a throwaway workspace per `references/bootstrap.md`, scaffolds the template
lesson with `lesson/katex_demo.jsx`, requires `test_lesson.cjs` to report **17/17**, boots Vite,
and drives `check.cjs` against it. `KEEP=1` keeps the workspace; `PORT=` moves the dev server off
5199. Exit code 0 only when every check passes.

`check.cjs` can also be pointed at an already-running lesson:

```
BASE_URL=http://localhost:5173 KATEX_FALLBACK_BROWSER=/usr/bin/google-chrome node check.cjs
```

## Scenarios

| | CDN | Must hold |
| --- | --- | --- |
| a | reachable | Math renders through KaTeX; the pinned `katex@0.16.21` script + stylesheet URLs are requested unchanged; the `<Eq>` body is byte-for-byte what a direct `katex.render` produces with the same options; no fallback, no warning, no uncaught error. |
| b | every `cdn.jsdelivr.net` request aborted | Page renders (loading gate released, no infinite spinner); every equation shows its literal LaTeX in a visible, selectable, `aria-label`led `<code>`; equation numbers, labels, the Explain pill and topic switching all still work; exactly one `[useKatex]` `console.warn`; one script request (no retry loop); no uncaught error. |
| c | every `cdn.jsdelivr.net` request stalled (socket held open, never fulfilled) | Same as (b), reached through the ~8s timeout rather than `onerror` — the case a plain `onerror` handler misses. |

Scenario (a) is what pins the happy path: the same URLs and the same rendered markup as before
the fallback existed.

`lesson/katex_demo.jsx` is a real two-topic lesson body (display math, inline math, an equation
label, a `KeyConcept`, the template's `if (!katexReady)` loading gate) kept minimal so the run
stays fast. It is what makes `test_lesson.cjs` meaningful — the shipped template placeholder only
passes T1 and T4 by design (see `references/bootstrap.md`).
