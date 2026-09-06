# SSE byte-split evidence

Proof that the reader between the CLI's stdout and the tutor's SSE stream survives a chunk boundary
falling anywhere — mid JSON object, and mid UTF-8 character. The reader is `createNdjsonReader` in
`references/bootstrap/_lesson-core/server/ndjson.js`; its one caller is `runClaudeStreaming` in
`server/proxy.js`.

```
node tests/sse-byte-split/check.cjs     # or ./check.cjs
```

Node only. No `npm install`, no network, no browser, no proxy boot: the reader is a module, and each
case drives it directly with the split it is about. Runs in about a second. Exit code 0 only when
every check passes.

`claude -p --output-format stream-json` writes one JSON object per line, but a pipe delivers bytes.
The line half of that was always carried across chunks. The character half was not: `chunk.toString()`
decodes each chunk on its own, so a rune split across two chunks came out as two U+FFFD replacement
characters — the tutor's em-dashes, arrows and equation glyphs turned to `??` on exactly the turns
whose reply crossed a 64 KiB pipe buffer, which is why it read as random. The client side never had
this: `Chatbot.jsx` already decodes with `TextDecoder` in streaming mode.

## What `check.cjs` asserts

| | Case | Must hold |
| --- | --- | --- |
| 1 | one chunk per stream, and one chunk per line | every event comes out byte-identical to what was written, and the last line — which the CLI writes without a trailing newline, so it only ever arrives through `end()` — is emitted exactly once |
| 2 | a cut at every single byte offset in the stream | all of them yield the same events, and none produces a replacement character |
| 2b | the same stream delivered one byte per chunk | the events are exactly the ones written, with every 2-, 3- and 4-byte character intact |
| 2c | the decode this replaced | the old per-chunk `toString()` really does mangle a cut inside the em-dash, and the reader under test does not — so cases 2 and 2b are asserting something. If this case ever goes green the other way, the fuzz above proves nothing and must be re-thought rather than trusted |
| 3 | a 4-byte character across three chunks, and one that never completes | the character arrives whole; a stream that ends mid-character does not throw, drops the line it cannot parse, and still delivers the complete line before it |
| 4 | the noise the CLI shares stdout with | an MCP diagnostic (`Client.listTools() called but server does not advertise tools capability`) is dropped rather than ending the turn, at four different cut points; blank lines emit nothing |
| 5 | `end()` is final | the tail arrives once, a second `end()` delivers nothing again, and the two events are the two that were written |
| 6 | what the proxy writes into the SSE stream | a reply containing a blank line, or the literal text of an SSE frame, is one frame and not three, because the payload is JSON and never the raw text |
| 7 | the reader has the caller it was extracted for | `proxy.js` imports it and drives both halves (`push` and `end`), no per-chunk decode is left on the streaming path, and the reader decodes with `StringDecoder` |

Case 2c is the one that keeps the rest honest, and case 2 is the one the brief names.

## Sync to the lessons workspace

`lessons/_lesson-core` must stay byte-identical to `references/bootstrap/_lesson-core`. This change
adds `server/ndjson.js` and rewrites the stdout reader in `server/proxy.js` — sync both, or the
lessons-side tutor keeps mangling a character that lands on a pipe boundary.
