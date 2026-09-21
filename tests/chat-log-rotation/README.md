# chat.log rotation

`node tests/chat-log-rotation/check.cjs` — no packages, no proxy. Imports `_lesson-core/server/chatLog.js` with an injected clock.

1. At 1 MB the next line rotates `chat.log` to `chat.log.<epoch>` and starts a new log; logging goes on there.
2. A log whose first line is 30 days old rotates; one second younger does not.
3. Prune deletes a generation only when it is over 30 days old AND `<generation>.done` exists. Kept: an old generation with no marker, a young one with a marker, names that are not exactly `chat.log.<digits>`, a directory or symlink with a generation's name, a lone marker. Nothing outside the log's directory changes.
4. The lesson scaffold's `.gitignore` ignores `chat.log`, `chat.log.1789000000` and its `.done`.
