// Reading one tutor turn off POST /chat, and getting it back when the
// connection did not survive the turn. Pure: no React and no window, so
// tests/chat-reattach drives it with a fake fetch and a stream that dies.
//
// The hosted tutor keeps every turn's events on the session, and
// POST <base>/chat {"sessionId", "attach": true} streams them again from the
// turn's FIRST event: following the turn live while it runs, replaying it whole
// and ending at once when it has finished. 409 means the chat was never asked
// anything; 404 is the usual session-not-found. The owner's word
// (2026-09-11): "sometimes responses can take a really long time, that's fine,
// they shouldn't be dropped".

// Consume one SSE response. `on.status(data)`, `on.text(finalText)` (the whole
// text so far, for the streaming bubble) and `on.settled()` (done, error or
// cancelled arrived) are optional. Returns what the completion pass needs.
// Throws whatever the body's reader throws: a network drop mid-turn.
export async function readTurn(res, on = {}) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let sseBuffer = "";
  const turn = { finalText: "", doneReceived: false, stopped: false, errored: false };
  // eventType lives OUTSIDE the read loop: a network chunk can end between
  // an "event:" line and its "data:" line, and resetting per read would
  // silently drop that event (missing text / missing done depending on
  // where the transport happened to split). A comment line (": keepalive")
  // matches none of the branches and is dropped, as the SSE rule says.
  let eventType = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    sseBuffer += decoder.decode(value, { stream: true });
    const lines = sseBuffer.split("\n");
    sseBuffer = lines.pop();
    for (const line of lines) {
      if (line.startsWith("event: ")) {
        eventType = line.slice(7).trim();
      } else if (line.startsWith("data: ") && eventType) {
        try {
          const data = JSON.parse(line.slice(6));
          if (eventType === "status") {
            on.status?.(data);
          } else if (eventType === "text") {
            turn.finalText += data.text;
            on.text?.(turn.finalText);
          } else if (eventType === "done") {
            turn.finalText = data.text || turn.finalText;
            turn.doneReceived = true;
            on.settled?.();
          } else if (eventType === "error") {
            // Routed through finalText so the completion pass finalises the
            // bubble; painting it alone left the message _streaming forever.
            turn.finalText = data.message || "Error";
            turn.errored = true;
            turn.doneReceived = true;
            on.settled?.();
          } else if (eventType === "cancelled") {
            turn.stopped = true;
            turn.doneReceived = true;
            on.settled?.();
          }
        } catch (_) {}
        eventType = null;
      } else if (line === "") {
        eventType = null;
      }
    }
  }
  return turn;
}

// A refusal from attach: the server answered, and said no (409, 404, ...).
// Its message is the server's own, shown as-is like any other /chat refusal.
export class AttachRefused extends Error {
  constructor(message, status) { super(message); this.name = "AttachRefused"; this.status = status; }
}

// POST {sessionId, attach: true}. Resolves the SSE response, or throws
// AttachRefused with the server's message when it says no.
export async function attachTurn({ fetchImpl, url, sessionId, signal }) {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({ sessionId, attach: true }),
  });
  if (!res.ok) {
    let msg = res.status === 409
      ? "Nothing to attach to: this chat has not been asked anything yet."
      : `API error (${res.status})`;
    try {
      const err = await res.json();
      if (err.error?.message) msg = err.error.message;
    } catch (_) {}
    throw new AttachRefused(msg, res.status);
  }
  return res;
}

// Read `res` to the end; when its stream dies mid-turn (anything but our own
// abort), attach and read the turn again from its first event. `on.restart()`
// runs before each re-read so the caller drops the half-built bubble -- the
// replay starts from scratch, and finalText with it. `tries` bounds how many
// times one turn is re-fetched: a phone that keeps sleeping gets a few goes,
// a server that is gone does not spin. The last error is thrown as it came.
export async function readTurnWithReattach({ res, fetchImpl, url, sessionId, signal, on = {}, tries = 3, pauseMs = 1000 }) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await readTurn(res, on);
    } catch (e) {
      if (e?.name === "AbortError" || attempt >= tries || !sessionId) throw e;
      if (pauseMs > 0) await new Promise(r => setTimeout(r, pauseMs));
      // Stop pressed during the pause: that is a stop, not a lost stream.
      if (signal?.aborted) throw signal.reason ?? e;
      res = await attachTurn({ fetchImpl, url, sessionId, signal });
      on.restart?.();
    }
  }
}

// A turn the tab does not have the end of. The saved transcript marks a
// half-streamed bubble and the connection-error line after it `partial`
// (Chatbot's save effect), so after a reload the tail says whether the reply
// ever arrived. Fold cards are bookkeeping, not replies, and are skipped.
export function tailUnanswered(messages) {
  for (let i = (messages || []).length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "fold") continue;
    if (m.role === "user") return true;
    return m.role === "assistant" && !!(m.partial || m._streaming);
  }
  return false;
}

// Bootstrap rule: "when /sessions lists a session with turn set (in flight) or
// a lastTurn newer than what the tab has". `s` is the chat's /sessions entry.
// lastTurn.msg is the server's message count when that turn started, so it is
// the turn the tab lost only when it is at least the number of questions the
// transcript asked. A question whose POST never reached the server (the page
// went first, or the request threw) leaves lastTurn on the turn before it:
// attaching then would replay the previous reply under the new question and
// fire its side effects twice. Cancelled is the student's own stop: no attach.
// A question that DID reach the fetch call but was then refused (!res.ok) or
// threw before a response arrived is marked `unsent` (Chatbot's sendMessage)
// and left out of `asked` here: the server never numbered it, so counting it
// would push `asked` one ahead of the server's count forever, and the attach
// for a later turn that finished while the page was gone would never fire
// again in that chat.
export function needsAttach(s, messages) {
  if (!s) return false;
  if (s.turn) return true;
  if (!s.lastTurn || s.lastTurn.outcome === "cancelled" || !tailUnanswered(messages)) return false;
  const asked = (messages || []).filter(m => m.role === "user" && !m.unsent).length;
  return typeof s.lastTurn.msg === "number" && s.lastTurn.msg >= asked;
}

// Drop the half-built reply at the end of a transcript -- the streaming
// bubble, and a partial one with its connection-error line -- so a replay
// rebuilds it from the turn's first event instead of appending a second copy.
export function dropPartialTail(messages) {
  let end = messages.length;
  while (end > 0 && messages[end - 1].role === "assistant" && (messages[end - 1]._streaming || messages[end - 1].partial)) end--;
  return end === messages.length ? messages : messages.slice(0, end);
}
