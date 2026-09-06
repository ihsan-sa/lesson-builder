// The reader that turns the CLI's stdout into whole JSON events.
//
// `claude -p --output-format stream-json` writes one JSON object per line, but a pipe delivers
// BYTES, not lines and not characters. A chunk boundary can fall anywhere: in the middle of an
// object, and in the middle of a single UTF-8 character. Both have to be carried across.
//
// The line half was always here. The character half was not: `chunk.toString()` decodes each
// chunk on its own, so a rune split across two chunks decoded as two U+FFFD replacement
// characters — the tutor's em-dashes, arrows and equation glyphs came out as `??` on exactly the
// turns whose reply crossed a 64 KiB pipe buffer, which is why it looked random. StringDecoder
// holds the trailing bytes of an incomplete character until the rest of it arrives, so the text
// the student reads is the text the model wrote whatever the pipe did.
//
// A line that does not parse is dropped, not thrown: the CLI shares stdout with diagnostics from
// the MCP clients it connects on startup, and one of those must not end a turn. `parseCliJson`
// in proxy.js is the same rule for a non-streaming spawn.
//
// Driven by `runClaudeStreaming` in proxy.js; the byte-split cases are tests/sse-byte-split.

import { StringDecoder } from "string_decoder";

export function createNdjsonReader(onEvent) {
  const decoder = new StringDecoder("utf8");
  let buffer = "";

  return {
    // Feed one stdout chunk. Calls onEvent once per complete line that parses.
    push(chunk) {
      buffer += typeof chunk === "string" ? chunk : decoder.write(chunk);
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) emit(line, onEvent);
    },
    // Feed what the stream ended with. The CLI's last line has no trailing newline, so the
    // result object of a turn lives here and not in push().
    end() {
      buffer += decoder.end();
      const rest = buffer;
      buffer = "";
      if (rest.trim()) emit(rest, onEvent);
    },
  };
}

function emit(line, onEvent) {
  const trimmed = line.trim();
  if (!trimmed) return;
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch (_) {
    return;
  }
  onEvent(parsed);
}
