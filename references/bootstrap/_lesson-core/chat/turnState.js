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

// ── Folding a thread back ──
// A fold puts one card in the main transcript and hands the same text to the
// main session's next turn. Both rules below are about a turn in flight, which
// is why they live here — and being pure, tests/thread-actors drives them
// directly instead of guessing at Chatbot.jsx from the outside.

// Where the card goes. A streaming main turn writes into the LAST message, and
// both the stream's next chunk and its completion pass only touch the
// transcript when that trailing message is the `_streaming` assistant bubble:
// a card appended past it starts a second bubble, strands the first as
// `_streaming` forever and drops the reply's suggestion/commit offers. So the
// card goes BEFORE a streaming tail, and at the end otherwise.
export function insertFoldCard(messages, card) {
  const last = messages.length > 0 ? messages[messages.length - 1] : null;
  if (last && last.role === "assistant" && last._streaming) {
    return [...messages.slice(0, -1), card, last];
  }
  return [...messages, card];
}

// Which folds a restored transcript still owes the tutor. The observation
// queue is in memory and the transcript is not, so a student who folds, reads
// the summary and then reloads before their next message would otherwise see a
// card saying the thread was folded back while the main session never hears
// it. Returns the observation texts to re-queue.
export const pendingFolds = (messages) =>
  (messages || []).filter((m) => m.role === "fold" && m.foldPending && m.obs).map((m) => m.obs);

// Which folds a turn just carried. Matched on the text the turn actually
// drained, not on "a turn completed": a fold made WHILE a turn streams is
// enqueued after that turn drained, so it rides the next one and must stay
// pending. Returns the same array when nothing changed, so callers can skip
// a pointless state update.
export function settleFolds(messages, drained) {
  if (!drained || !messages.some((m) => m.foldPending && m.obs && drained.includes(m.obs))) return messages;
  return messages.map((m) => (m.foldPending && m.obs && drained.includes(m.obs)) ? { ...m, foldPending: false } : m);
}
