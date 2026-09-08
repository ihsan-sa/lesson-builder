# Thread-actor evidence

Headless proof that a side thread runs in its **own CLI session**, forked from the main
conversation: nothing said in a thread enters the main session's history, and what a thread
concluded reaches the main conversation only through a summary the student sees first.

```
cd tests/thread-actors
./run.sh                 # deterministic, no tokens: fake `claude` on PATH
REAL_CLAUDE=1 ./run.sh   # also the probes against the real CLI (~8 short haiku turns)
PORT=3921 ./run.sh       # 3901 is the app's own port; the default here is 3911
SELFCHECK=0 ./run.sh     # skip the two negative controls below
```

`run.sh` bootstraps a throwaway workspace per `references/bootstrap.md` (core copy + `npm
install`, template lesson scaffold), starts the lesson's proxy with `fake-claude/claude` first on
PATH, and drives `check.cjs` against it, then prints the proxy's thread log lines. `KEEP=1` keeps
the workspace. No dependencies beyond Node.

Exit code 0 only when every check passes — and **3 when the proxy itself went away**, which is a
different thing from a check failing (1). See "When the proxy dies" below.

`fake-claude/claude` speaks the CLI's `-p` protocol and makes session identity **observable**:
every invocation appends its `{argv, stdin}` to `$FAKE_STATE/argv.jsonl`, and each session id owns
a transcript file. `--fork-session` copies the resumed session's transcript into a **new** id and
answers as that id — a real fork, so "which session heard what" is a string check rather than a
guess. A turn writes its message to the transcript when it starts and its reply when it reaches its
result, the way a CLI persists a turn — so a turn the proxy kills mid-flight provably leaves no
reply behind (case 5). `RECALL` is exempt: it is the read instrument. Message switches: `RECALL` replies with that session's whole transcript, `LONG` streams for
two minutes over a real `bash`+`sleep` tree so a cancel has something to kill, `NOFORK` makes the
CLI ignore `--fork-session` and answer as the parent (the failure the proxy must refuse to record).

## What `check.cjs` asserts

Each case opens its own chat and its own thread; none reads state a previous case left behind.

| | Case | Must hold |
| --- | --- | --- |
| 1 | isolation | `/thread/open` returns a handle that is not the chat's id, and the same handle for the same `(chat, threadId)`. The thread inherits the main conversation up to the fork and remembers its own turns (asked with a neutral marker: a real tutor refuses the wrong fact and may decline to repeat it). **The main conversation, asked afterwards, has never heard the thread's wrong fact.** Argv: the thread's first turn is `--resume <main> --fork-session` (fork and turn in ONE spawn — a thread turn costs no more prompt than a main turn), later turns resume the fork and do not fork again, main turns never resume the fork. `/sessions` never lists the handle; the thread's turns do not count against the chat's `messageCount`; the chat is still a resume candidate (`isPickable`); a thread handle cannot be opened as a chat. |
| 2 | fold-back | Folding a thread nobody asked anything -> 409. Before the fold the main conversation does not know the thread's conclusion; `/thread/fold` returns a summary of it in one haiku spawn against the **thread's** session, and writes nothing into the main session. **Only after the student's next main turn carries that summary does the main conversation know it.** Folding a main session id -> 404. |
| 3a | a thread's Stop | With a main turn and a thread turn streaming as two processes, `/chat/cancel` on the thread kills the thread's whole tree and ends its stream `cancelled` — and the main turn's tree is untouched and still streaming. |
| 3b | the main turn's Stop | The mirror: cancelling the main turn leaves the running thread alone. Then discarding the chat (`/session/close` without `keepContext`) does take its threads with it — tree gone, handle 404. |
| 4 | reload | After `/session/close {keepContext:true}` + `/session/open`, re-opening the thread returns the handle it had, its next turn resumes the same forked session without forking again, it still has its own history — and the resumed chat still has not heard it. |
| 5 | the CLI did not fork | `NOFORK`: the proxy kills the turn (`THREAD_FORK_MISSING` then `THREAD_FORK_KILLED`), the thread's stream ends `error` and never `done`, and no id is recorded — so the thread has nothing to fold (409) and its next turn forks again rather than resuming the main session. On the main session's own history: **the killed turn's reply never reached it**, the rest of the conversation is intact, and the student's own message is there — the CLI reads stdin before it says which session it is, so that one line is the residue the kill cannot undo (`proxy.js`, "Thread sessions"). |
| 6 | bad input | Missing / malformed `threadId`, unknown chat, malformed handle -> 400/404, no session created. |
| 7 | client rules (`chat/processResponse.js`, the module `Chatbot.jsx` imports) | `<<REINFORCE>>` in a **thread** reply is collected exactly as it is on the main transcript (one list, one chat) and stripped from the display; `<<SUGGEST>>` is still stripped in thread scope and reported back as `thread-tag-deferred`. |
| 9 | the fold rules | `chat/turnState.js` run against its own fixtures: a fold that lands while the main tutor is streaming is inserted **before** that bubble (appending past it splits the reply and strands the first half `_streaming`), and is simply appended when nothing is in flight; a restored transcript re-queues only an undelivered fold; a turn settles the folds whose text it actually drained and leaves a fold enqueued after that drain pending for the next turn. |
| 10 | the fold takes its turn | With a thread turn streaming, `/thread/fold` waits in that thread's queue — no second CLI is spawned on the session — and runs once the turn is cancelled. Two CLIs resuming one session id is what the queue exists to prevent. |
| 8 | client wiring, source checks | What this suite cannot drive headlessly (no DOM), read out of the workspace's core copy so a refactor that drops it is caught: exactly one `role: "fold"` message per fold, the summary queued onto the **main** session's next turn, the fold offered once, a resumed chat restoring its threads collapsed, thread observations queued against the thread's session, a thread's Stop naming the thread's session, the fold card placed by `insertFoldCard`, the ⤴ dead while the main turn streams, the thread composer gone while a fold runs, the pending fold re-queued on resume and persisted with the transcript, `prompts/thread-system.md` gone, and the system prompt telling the tutor a thread is its own session. |
| 11 | the dev path carries the thread routes | Under `npm run dev` the browser reaches the proxy only through the Vite middleware in `_lesson-core/server/viteLessonProxy.js`; a route it does not list gets Vite's SPA fallback, and the chat client reads that `index.html` as a failed API call — which is how thread open and fold failed in a dev lesson while every other tutor feature worked. Static, both directions: the middleware's `ROUTES` carries every endpoint `constants/build.js` § `API` calls, and carries nothing no endpoint claims. Live: the real middleware, mounted in front of a stand-in for the fallback, takes `/thread/open` and `/thread/fold` to the running proxy and gets JSON with a handle and a summary — while `/whoami`, a real route on that same proxy that no client endpoint calls, falls through to the fallback instead of being forwarded. |

`--real` (via `REAL_CLAUDE=1`) runs cases 1, 2, 4, 6, 7, 8, 9 and the static half of 11 against the
real CLI — the ones that prove `--fork-session` actually forks. Cases 3, 5, 10 and the live half of
11 are fake-only (they need a killable tree, a CLI that refuses to fork, or a fold that costs no
tokens). `--only 5` (or `--only 1,5`) runs just the numbered cases; the negative controls below use
it, and every case builds its own state, so any subset is a valid run.

## When the proxy dies

Every case here measures a running proxy, so a proxy that has gone leaves nothing to measure. This
used to be reported as whatever assertion came next. The run that prompted the change printed

```
FAIL 5: and killed the turn that was running in the main session
HARNESS ERROR: TypeError: fetch failed
```

— a failure about thread forking, when in fact the wait timed out because the proxy was already
gone and the *next* request is where the connection refused surfaced. Nothing about forking had
been tested at all, and because the red was read as a known flake, every review that night was
told to disregard it.

So `check.cjs` now asks one question wherever a run can fail without an answer: **is the proxy
still there?** Every request goes through `proxyFetch`, every wait that runs out (`waitForLog`,
`pidResuming`, `waitForInvocation`) and every stream that breaks mid-read calls `proxyDeath()`,
which probes `/whoami` and reads `server/.proxy.json`. If the proxy answers, nothing changes — the
wait returns false and the check fails as a real red. If it does not, the run stops with a report
instead of an assertion, and exits **3**:

```
PROXY GONE — the proxy under test stopped answering. This run measured nothing about thread behaviour.
  where:    waited 8000ms for /THREAD_FORK_KILLED/ in chat.log and it never came
  probe:    GET http://127.0.0.1:3962/whoami — connect ECONNREFUSED 127.0.0.1:3962
  identity: server/.proxy.json still names pid 1524655, which is not alive — it died without running its exit handler
  so far:   4 check(s) ran, 0 of them failed — with the proxy gone, none of that is a verdict on this commit.
  This is NOT a failed assertion about thread forking. ...
```

`identity` is the useful line: the proxy removes `.proxy.json` on its way out, so the file
**surviving with a dead pid** means it was killed or crashed, and the file being **gone** means it
ran its own signal handler — it was asked to stop. `run.sh` adds the half only the parent knows,
the wait status of the process it started (`killed by signal 9`) and the proxy's own last lines.

### The two negative controls

Run at the end of `run.sh` (`SELFCHECK=0` skips them), both driving case 5 alone. They exist
because "the report is right" is not something a suite can assert about itself:

1. **The proxy dies.** A watcher `SIGKILL`s the proxy the instant `THREAD_FORK_MISSING` reaches the
   log — the same moment the reported run lost it, with case 5 waiting on `THREAD_FORK_KILLED`.
   Requires exit 3, the words `PROXY GONE`, and **no `FAIL` line whatsoever**.
2. **The behaviour dies.** The mirror: the workspace's proxy copy is edited so `failForkMissing()`
   is replaced by recording the parent's id — the exact leak case 5 exists to catch — and the proxy
   is left running. Requires exit 1, no `PROXY GONE`, and `FAIL` lines that name the forking. Case
   5 is not weakened by any of this; this control is what shows it still bites.

## Transcripts

The two probes the brief asks for, from `REAL_CLAUDE=1 ./run.sh` on 2026-09-05 (haiku, `chat.log`):

**1 — a misconception explored in a thread does not leak back.** The thread is asked to agree that
the derivative of x² is x³; the next main turn is asked to recall everything it knows.

```
[CHAT_START] chatNum=1 msg=1 message=FACT-MAIN: in this fixture the sky is green.
[CHAT_START] chatNum=1 msg=1 threadId=t1 message=[THREAD:t1 | "a snippet"] WRONG-FACT: the derivative of x squared is x cubed...
[THREAD_FORK] chatNum=1 threadId=t1 from=0df58f5a to=46bdb348
[CHAT_OK]    chatNum=1 msg=1 response=I can't agree with a false statement... The derivative of x² is 2x, not x³.
[CHAT_START] chatNum=1 msg=3 threadId=t1 message=[THREAD:t1 | "a snippet"] RECALL
[CHAT_OK]    chatNum=1 msg=3 response=FACT-MAIN: in this fixture the sky is green. / WRONG-FACT: ... x cubed
[CHAT_START] chatNum=1 msg=2 message=RECALL
[CHAT_OK]    chatNum=1 msg=2 response=FACT-MAIN: in this fixture the sky is green.
```

The thread's `RECALL` returns both the main fact (it forked from that history) and its own wrong
one. The main conversation's `RECALL` returns the main fact only — it never heard the thread.

**2 — folding is the only route back, and the student sees it first.**

```
[CHAT_START] chatNum=2 msg=1 threadId=t7 message=[THREAD:t7 ...] The thread concluded PINEAPPLE-42 is the answer.
[CHAT_START] chatNum=2 msg=2 message=RECALL
[CHAT_OK]    chatNum=2 msg=2 response=FACT-B: this fixture is about integrals.          <- no PINEAPPLE-42
[THREAD_FOLD] chatNum=2 threadId=t7 summaryLen=425
[CHAT_START] chatNum=2 msg=3 message=RECALL
[CHAT_OK]    chatNum=2 msg=3 response=FACT-B: this fixture is about integrals.          <- fold wrote nothing
[CHAT_START] chatNum=2 msg=4 message=[OBSERVATION thread-folded] A side thread was folded back: ...
             The thread settled on PINEAPPLE-42 as the answer...
[CHAT_OK]    chatNum=2 msg=4 ...                                                        <- now it knows
```

`/thread/fold` itself touches nothing but the thread's own session. The client shows the summary
in the transcript as one `role:"fold"` message and queues that same text onto the next main turn —
so the main tutor never learns anything the student has not read.

**3 — Stop is per thread** (`./run.sh`, proxy log; `msg=2` is the thread's turn, `msg=1` the main's):

```
[THREAD_OPEN]    chatNum=3 threadId=t1 handle=cbeebf17 parent=4fed4a36
[THREAD_FORK]    chatNum=3 threadId=t1 from=4fed4a36 to=53f30087
[CANCEL_START]   chatNum=3 msg=2 pid=1292416 tree=3       <- the thread's Stop
[CHAT_CANCELLED] chatNum=3 msg=2 streamed=198
[CANCEL_DONE]    chatNum=3 msg=2 survivors=[]             <- and the main turn is still streaming
[CANCEL_START]   chatNum=3 msg=1 pid=1292404 tree=3       <- the main turn's Stop, separately
[CHAT_CANCELLED] chatNum=3 msg=1 streamed=672
[CANCEL_DONE]    chatNum=3 msg=1 survivors=[]
```

## Sync to the lessons workspace

`lessons/_lesson-core` must stay byte-identical to `references/bootstrap/_lesson-core`. This change
touches `server/proxy.js`, `chat/Chatbot.jsx`, `chat/ThreadPanel.jsx`, `chat/turnState.js`,
`chat/buildSystemPrompt.js`, `chat/chat.css.js` and deletes `prompts/thread-system.md` — sync all
seven after it lands, or the lessons-side tutor keeps leaking threads into the main conversation.
