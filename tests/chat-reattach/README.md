# A tutor reply survives a lost stream; two chats on one topic have two tabs

Proof for `references/bootstrap/_lesson-core/chat/turnStream.js`, `tabLabel` in `chat/chatState.js`,
and their wiring in `Chatbot.jsx`.

```
node tests/chat-reattach/check.cjs    # in the gate
```

Node only. No `npm install`, no network, no browser.

The hosted tutor (iiks1 `lessons/chat.py`) keeps every turn's events, and
`POST <base>/chat {"sessionId", "attach": true}` streams them again from the turn's first event.
Before this, a stream that died mid-turn (the phone slept, the edge cut) left `Connection error`
and dropped the reply (owner, 2026-09-11: "they shouldn't be dropped").

1. **A stream that dies mid-turn ends with the whole reply in the bubble**: one attach, the bubble
   rebuilt from scratch, one reply and not the half plus the whole.
2. **Our own abort is not a lost stream**: Stop never attaches. No session id (a dev build, whose
   local proxy has no attach) throws the drop as before.
3. **Attach says no**: 409 (never asked) and 404 come back as `AttachRefused` with the server's
   words, and the half bubble is left alone.
4. **A replay that dies too** is asked again, at most `tries` times.
5. **The reader** drops `: keepalive` comment lines and keeps an event split across chunks.
6. **A reloaded tab attaches only when it is missing the end of a turn**: a turn in flight, or a
   finished, uncancelled one whose saved tail is the question or a `partial` bubble, and whose
   `lastTurn.msg` reaches that question (an earlier turn is never replayed under a new question).
7. **Two chats on one topic have different tab labels** (`Derivatives #3`, `Derivatives #4`); a
   topic one tab has keeps its plain label. The premise was probed first: two chats on one topic
   are two sessions with their own transcripts.
8. **Chatbot.jsx** reads through `readTurnWithReattach`, attaches on restore via `needsAttach`,
   saves the `partial` mark, and labels tabs through `tabLabel`.

Red without the change: on `main` cases 1-6 have no module to import; with only `turnStream.js`
added, cases 7 and 8 fail (15 checks).
