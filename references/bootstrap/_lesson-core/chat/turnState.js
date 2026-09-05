// What the chat client may do with a session the proxy reports, and when a
// Stop may cancel. Pure functions, no React and no fetch, so tests/cancellation
// can drive them against the proxy's real /sessions payloads.

// A session this tab already owned before the page reloaded (its id is in
// sessionStorage's kcSessions): reclaimable even with a turn in flight. A
// reload is deliberately not a cancel — the proxy keeps the CLI running and
// keeps its result in the session for the next message (proxy.js, "A
// disconnect is not a cancel") — so "a turn is in flight" must not hide the
// session here, or the reload the invariant protects opens an empty chat
// instead. A cancelled last turn does not disqualify it either: the student
// stopped a reply, not the chat, and the brief requires a stopped session to
// keep working — cancellation only keeps it out of the PICKER (isPickable),
// which is the promotion rule. Only another tab holding it open does.
export const isRestorable = (s) => !s.open;

// A session offered to the student in the picker (or taken by the bootstrap
// when there is nothing to restore): the proxy's own `resumable` — not open,
// no turn in flight, latest turn not cancelled. Someone else's running turn is
// not a chat to walk into. A proxy that predates the flag is read the old way,
// so a lessons-side core that lags still resumes.
export const isPickable = (s) => (s.resumable !== undefined ? s.resumable : !s.open);

// A thread's Stop needs no rule of its own any more: a thread runs in its own
// forked session (proxy.js, "Thread sessions"), so cancelling it names that
// session and can only reach that thread's process tree. The main turn's Stop
// is just as narrow.
