# Chat persistence evidence

Headless proof that the dev proxy (`references/bootstrap/_lesson-core/server/proxy.js`) answers
its half of the contract written at the top of `_lesson-core/chat/tutorApi.js`: tab leases,
the transcript, the queue that merges into one turn, attach, and delete as the one discard. A
lesson built before any of that (no `tabId`) must still open and close as it did.

```
tests/proxy-persist/run.sh     # deterministic, no tokens: fake `claude` on PATH
```

`run.sh` is `tests/cancellation/run.sh` with its own names: a throwaway workspace, the
lesson's proxy started with `fake-claude/claude` first on PATH, `check.cjs` driven against it.
`KEEP=1` keeps the workspace; `PORT=` moves the proxy off 3931.

`fake-claude/claude` answers a turn with `ECHO[<the message it was sent>]`, so the fixture
reads exactly what the proxy passed to the CLI. A message containing `SLOW` streams one text
chunk and holds its result back 2 s: that is the running turn the queue case posts behind.

## What `check.cjs` asserts (each on a fresh session)

| | Case | Must hold |
| --- | --- | --- |
| 1 | two tabs | A opens with a tabId and holds the lease; B's open -> 409 `leased:true`; B with `takeover` -> 200; A's ping -> 409 `takenOver:true`; B's ping -> 200 `{held, asks: []}`; `/sessions` names B's lease and says not resumable; ping on an unknown id -> JSON 404; A's close leaves B's lease; B's close releases and keeps the chat. |
| 2 | queue | five messages during a turn -> 202 positions 1..5; a sixth -> JSON 429; two unqueued -> 200; `/sessions` `queued:3`. The running turn's stream ends with its own reply, and an attach sent right after that `done` gets ONE merged turn whose input is m1, m2, m3 in order, joined by `---` (the merged turn starts before the old one's last event goes out). A late unqueue -> JSON 409; the merged turn counts once in `messageCount`; a later attach replays it. |
| 3 | transcript | attach before any turn -> JSON 409; after two turns `/session/history` gives 4 turns oldest first, user text as sent; `limit:2` pages back via `before`, `more` true then false. |
| 4 | picker fields | a fresh chat: `title:null`, `queued:0`, a `lastAt`; after a turn the title is the text after the last `Question: `, cut near 60 chars, or without that marker the message minus leading `[...]` lines; `lastAt` is the last turn's time. |
| 5 | delete | `/session/delete` -> 200; the chat leaves `/sessions`; its history -> JSON 404. |
| 6 | old client | no tabId: open of an open chat -> 409; close `keepContext:true` releases; re-open -> 200 with no lease; a turn streams to `done`; close without keepContext still discards. |

Not covered: a lease lapsing after 90 s unpinged (it would hold the gate for a minute and a half).
