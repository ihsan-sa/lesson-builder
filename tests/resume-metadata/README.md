# Resume-metadata evidence

Proof that resuming a chat session restores the model and reasoning effort that session was
created with: `/session/open` in `references/bootstrap/_lesson-core/server/proxy.js` now echoes
the session's stored `model`/`effort`, and `resumeSessionIntoTab` in
`references/bootstrap/_lesson-core/chat/Chatbot.jsx` applies them to the (global, not per-tab)
chat settings — guarded so a model the client's `MODELS` list doesn't know about is left alone
rather than applied.

```
cd tests/resume-metadata
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install   # drop the env var to fetch Playwright's Chromium
RESUME_METADATA_BROWSER=/usr/bin/google-chrome ./run.sh
```

`run.sh` bootstraps a throwaway workspace per `references/bootstrap.md`, scaffolds the template
lesson with `lesson/resume_demo.jsx` (the shipped placeholder renders `null`, so a real
`LessonShell` + `Chatbot` body is needed to exercise anything), starts the lesson's proxy with
`tests/cancellation/fake-claude` first on PATH, boots Vite, and drives `check.cjs` against both.
`KEEP=1` keeps the workspace; `PORT=`/`PROXY_PORT=` move Vite/the proxy off 5901/3903 (also clear
of cancellation's 3901/3902) — pass distinct values if another run is already using them. Exit
code 0 only when every check passes.

## What `check.cjs` asserts

| | Scenario | Must hold |
| --- | --- | --- |
| 1 | a session started at `claude-fable-5` / `max`, released (tab navigated away, not closed via "End session"), then reopened from the picker in a fresh browser tab (real `sessionStorage` isolation — no auto-resume) | the settings chip reads "Fable 5 · max"; the next message's `CHAT_START` log line carries `model=claude-fable-5 effort=max` |
| 2 | same resume, but the receiving tab's current selection ("Sonnet 5" / "low") differs from the session's stored values first | the selection switches to "Fable 5" / "max" — same code path as 1, `resumeSessionIntoTab` |
| 3 | a session created directly against the proxy with `model: "claude-legacy-oddball"` (not in the client's `MODELS` list; the UI has no way to pick it), released, then resumed from the picker | the current model selection is left unchanged; no uncaught error; `/sessions` still reports the session's real stored model — the server's record is never coerced, only the client's guard skips applying it |

Auto-resume-on-mount and the picker share the same `resumeSessionIntoTab` call (see the two call
sites in `Chatbot.jsx`), so exercising the picker path here is exercising both.

## Manual recipe (what to do by hand instead of running `check.cjs`)

1. `cd tests/resume-metadata && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install` once, then run
   `KEEP=1 ./run.sh` and let it fail or succeed — either way it prints the workspace path and
   leaves the proxy/Vite running only for the duration of `check.cjs`. For a hands-on session
   instead, copy `run.sh`'s bootstrap block (everything before the final `node check.cjs` line)
   into a shell, or just note the `Vite on port $PORT` / `proxy on port $PROXY_PORT` lines it
   prints and open that URL yourself before the script's own `check.cjs` step runs.
2. In a browser, open the printed Vite URL and click **Tutor** in the top bar.
3. Click the gear icon (Settings) and pick **Fable 5** / **max**, then click **+** to open a new
   tab — that tab's session is created at Fable 5 / max.
4. Open a **new browser tab** (not a reload — a genuinely new tab has its own `sessionStorage`,
   which is what gates auto-resume) at the same URL, click **Tutor**. You land on "Available
   sessions" (the picker) since nothing auto-resumed.
5. Optionally open Settings and pick a different model/effort first, to see criterion 2.
6. Click the **Chat #2** button (the Fable 5 / max session). The settings chip should immediately
   read "Fable 5 · max".
7. Send any message, then `grep CHAT_START <lesson>/server/chat.log | tail -1` — it should show
   `model=claude-fable-5 effort=max`.
8. For criterion 3, `curl` a session into existence with an off-list model directly against the
   proxy port: `curl -s localhost:$PROXY_PORT/session/init -H 'content-type: application/json' -d
   '{"model":"claude-legacy-oddball","effort":"xhigh"}'`, then release it with
   `curl -s localhost:$PROXY_PORT/session/close -d '{"sessionId":"<id>","keepContext":true}'`.
   Resume it from the picker the same way — the selection should not move, and the browser
   console should show no error.

## Sync to the lessons workspace

`lessons/_lesson-core` must stay byte-identical to `references/bootstrap/_lesson-core`. This
change touches `server/proxy.js` and `chat/Chatbot.jsx` — sync both after it lands.
