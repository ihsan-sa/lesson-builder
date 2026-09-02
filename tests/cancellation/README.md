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
`KEEP=1` keeps the workspace; `PORT=` moves the proxy off 3901. Exit code 0 only when every
check passes. No dependencies beyond Node (the proxy's own express/cors come from the core copy).

`fake-claude/claude` speaks the CLI's `-p` protocol: init returns a `session_id`; a turn whose
message contains `LONG` streams for two minutes and forks `bash` + `sleep` underneath (a
three-deep tree); `IGNORE_TERM` makes that whole tree ignore SIGTERM so only the SIGKILL pass can
end it.

## What `check.cjs` asserts

| | Scenario | Must hold |
| --- | --- | --- |
| 1 | long turn, `/chat/cancel` | `/sessions` shows the turn (pid); tree is >= 3 pids; cancel answers 200 in <= 3s; no pid of the tree survives (zombies excluded); the SSE stream ends with `event: cancelled` and no `done`/`error`; a repeat cancel is 200 `repeat:true`; the turn slot is released. |
| | promotion | after `/session/close {keepContext:true}` the record has `lastTurn.outcome:"cancelled"` and `resumable:false`. |
| 2 | next turn on the same session | completes with `event: done` (no reload, no cancel state carried over); cancel with nothing in flight -> 409; the released session now has `lastTurn.outcome:"completed"` and `resumable:true`. |
| | wrong / stale ids | unknown, malformed and missing ids -> 404, nothing killed. |
| | fresh session | zero turns -> still `resumable:true` (unchanged behaviour). |
| 3 | tree ignores SIGTERM | same as 1, ended by the SIGKILL pass, still <= 3s. |
| 4 | KILL mid-turn (`/session/close` without keepContext) | the tree is gone within ~2s; a later cancel on that id -> 404. |
| | `server/chat.log` | `CHAT_CANCELLED` for turn 1, `CHAT_OK` for turn 2, no `CHAT_ERROR`. |

`--real` (via `REAL_CLAUDE=1`) runs scenarios 1 and 2 and the id checks against the real CLI:
the long turn asks the model to run `sleep 120` with Bash, so the tree really is claude + a shell
+ sleep. Scenarios 3 and 4 are fake-only.

Client wiring (Stop -> `/chat/cancel`, the stopped bubble, `resumable` in the picker and the
reload resume) is in `chat/Chatbot.jsx` and `chat/ThreadPanel.jsx`; it is not driven by this
script.
