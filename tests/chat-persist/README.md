# The chat client keeps chats, restores history, queues sends and hands a chat between tabs

```
node tests/chat-persist/check.cjs    # in the gate
```

Node only. No `npm install`, no network, no browser. It drives `_lesson-core/chat/tutorApi.js` and
`chat/chatHistory.js` against a stub fetch, and reads `Chatbot.jsx` as text for what that file
must not do. The dev proxy's half of the same contract is `tests/proxy-persist`.

1. **Restore with empty sessionStorage.** A tab short of the server's count fetches every page of
   `session/history`, oldest first, and shows it under a "restored" divider with only the words
   the student typed.
2. **Older tutor.** An endpoint that answers a non-JSON 404 is absent, remembered, and not asked
   again; a JSON 404 is the endpoint answering.
3. **Queue order.** Sends typed during a turn go in typed order; × drops only its own.
4. **Takeover.** A ping reads held, taken (read-only), absent or unknown.
5. **Picker.** Title and last use, newest first.
6. **Close keeps.** Both close beacons send `keepContext: true`; Delete is the only discard.
7. **Chips and export.** Download chips only for `chat/file/*.{pdf,csv,txt,md,zip}`; ask chips
   update in place; the Markdown export.
8. **Feature detection.** Each new endpoint is in `API` and called through `callOptional`.
