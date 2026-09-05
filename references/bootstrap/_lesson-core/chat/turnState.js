// What the chat client may do with a session the proxy reports, and when a
// Stop may cancel. Pure functions, no React and no fetch, so tests/cancellation
// can drive them against the proxy's real /sessions payloads.

// A session this tab already owned before the page reloaded (its id is in
// sessionStorage's kcSessions): reclaimable even with a turn in flight. A
// reload is deliberately not a cancel — the proxy keeps the CLI running and
// keeps its result in the session for the next message (proxy.js, "A
// disconnect is not a cancel") — so "a turn is in flight" must not hide the
// session here, or the reload the invariant protects opens an empty chat
// instead. Only a cancelled last turn disqualifies it. A proxy that predates
// `lastTurn` reports neither field, which reads as the old `!s.open`.
export const isRestorable = (s) => !s.open && !(s.lastTurn && s.lastTurn.outcome === "cancelled");

// A session offered to the student in the picker (or taken by the bootstrap
// when there is nothing to restore): the proxy's own `resumable` — not open,
// no turn in flight, latest turn not cancelled. Someone else's running turn is
// not a chat to walk into. A proxy that predates the flag is read the old way,
// so a lessons-side core that lags still resumes.
export const isPickable = (s) => (s.resumable !== undefined ? s.resumable : !s.open);

// May a thread's Stop cancel the session's turn? POST /chat/cancel kills
// whichever turn the session is running, and a tab's main transcript and its
// threads share one session: with a main turn streaming and this thread's
// message queued behind it, cancelling would kill the main turn the student
// never stopped. So only when nothing else of this tab is in flight — call it
// after deleting this thread's own abort controller.
export function isSoleInFlight(tabId, tabAborts, threadAborts) {
  if (tabAborts[tabId]) return false;
  return !Object.keys(threadAborts).some((k) => k.startsWith(tabId + ":"));
}
