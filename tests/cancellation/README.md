# Cancellation evidence

Headless proof that the tutor's Stop really cancels a turn: `POST /chat/cancel` in
`references/bootstrap/_lesson-core/server/proxy.js` kills the active turn's whole `claude`
process tree, and only a completed turn promotes its session to a resume candidate.

```
cd tests/cancellation
./run.sh                 # deterministic, no tokens: fake `claude` on PATH
REAL_CLAUDE=1 ./run.sh   # also the smoke against the real CLI (one short haiku turn)
```

`run.sh` bootstraps a throwaway workspace per `references/bootstrap.md` (core copy + `npm
install`, template lesson scaffold), starts the lesson's proxy with `fake-claude/claude` first on
PATH, asserts the `.proxy.json` + `.proxy-port` dual write, and drives `check.cjs` against it.
`KEEP=1` keeps the workspace; `PORT=` moves the proxy off 3901 (two runs at once need distinct
ports). Exit code 0 only when every check passes. No dependencies beyond Node (the proxy's own express/cors come from the core copy).

`fake-claude/claude` speaks the CLI's `-p` protocol: init returns a `session_id`; a turn whose
message contains `LONG` streams for two minutes and forks `bash` + `sleep` underneath (a
three-deep tree); `IGNORE_TERM` makes that whole tree ignore SIGTERM so only the SIGKILL pass can
end it; `EXIT0_ON_TERM` makes the CLI reap its child and exit 0 on SIGTERM (a graceful shutdown the
proxy must still count as cancelled).

## What `check.cjs` asserts

| | Scenario | Must hold |
| --- | --- | --- |
| 1 | long turn, `/chat/cancel` | `/sessions` shows the turn (pid); tree is >= 3 pids; cancel answers 200 in <= 3s; no pid of the tree survives (zombies excluded); the SSE stream ends with `event: cancelled` and no `done`/`error`; a repeat cancel is 200 `repeat:true`; the turn slot is released. |
| | promotion | after `/session/close {keepContext:true}` the record has `lastTurn.outcome:"cancelled"` and `resumable:false`. |
| 2 | next turn on the same session | completes with `event: done` (no reload, no cancel state carried over); cancel with nothing in flight -> 409; the released session now has `lastTurn.outcome:"completed"` and `resumable:true`. |
| | wrong / stale ids | unknown, malformed and missing ids -> 404, nothing killed. |
| | fresh session | zero turns -> still `resumable:true` (unchanged behaviour). |
| 3 | tree ignores SIGTERM | same as 1, ended by the SIGKILL pass, still <= 3s. |
| 5 | CLI exits 0 on SIGTERM | graceful shutdown with no result, ended by the SIGTERM pass; the accepted cancel wins over the exit code: stream ends `cancelled`, `lastTurn.outcome:"cancelled"`, `resumable:false`. |
| 4 | KILL mid-turn (`/session/close` without keepContext) | the tree is gone within ~2s; a later cancel on that id -> 404. |
| 6 | reload mid-turn (`/session/close {keepContext:true}` while the CLI streams) | the turn survives (a disconnect is not a cancel); the session is `resumable:false` so nobody else is offered it, but the reloading tab still reclaims it; then cancelling it works as in 1. |
| | client rules (`chat/turnState.js`, the module `Chatbot.jsx` imports) | run against those same `/sessions` records: `isPickable` false for cancelled / in-flight and true for completed; `isRestorable` false only for cancelled; both fall back to `!open` against a pre-`resumable` proxy; `isSoleInFlight` lets a thread's Stop cancel only when nothing else of its tab is in flight. |
| | `server/chat.log` | `CHAT_CANCELLED` for turns 1 and 5, `CHAT_OK` for turn 2, no `CHAT_ERROR`. |

`--real` (via `REAL_CLAUDE=1`) runs scenarios 1 and 2 and the id checks against the real CLI:
the long turn asks the model to run `sleep 120` with Bash, so the tree really is claude + a shell
+ sleep. Scenarios 3, 5, 4 and 6 are fake-only; the client-rule checks run in both modes.

The rest of the client wiring (Stop -> `/chat/cancel`, the stopped bubble) is in
`chat/Chatbot.jsx` and `chat/ThreadPanel.jsx` and is not driven by this script: what it checks of
the client is `chat/turnState.js`, imported from the workspace copy (`CORE_DIR`), not restated.

## Sync to the lessons workspace

`lessons/_lesson-core` must stay byte-identical to `references/bootstrap/_lesson-core`. This change
touches `server/proxy.js`, `chat/turnState.js` (new file), `chat/Chatbot.jsx`, `chat/ThreadPanel.jsx`
and `chat/chat.css.js` — sync all five after it lands, or the lessons-side tutor keeps a Stop that
does not stop.
