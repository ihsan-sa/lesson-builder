// What the chat client may ask of a tutor beyond the original eleven
// endpoints, and how it finds out whether this one answers. Pure: no React,
// no window, fetch passed in -- tests/chat-persist drives it with a stub.
//
// THE CONTRACT THIS BUILDS AGAINST. The hosted tutor's half is the iiks1 row
// tutor-chats-persist-and-queue, which pins the JSON in lessons/chat.py's
// docstring. It was not pinned when this was written (2026-09-28), so these
// are the shapes the upgrade plan's Design section describes; the dev proxy
// (server/proxy.js) answers the same ones.
//
//   GET  sessions            each entry may add title, lastAt (epoch s or ms,
//                            or ISO), queued (count) and lease {tabId, seen}.
//   POST session/open        {sessionId, tabId, takeover?} -- 409 with
//                            {leased: true} when another live tab holds it
//                            and takeover is not set; takeover always wins.
//   POST session/ping        {sessionId, tabId} every 30 s -> 200
//                            {held: true, asks?: [...]} while this tab holds
//                            the lease, 409 {takenOver: true} once another
//                            tab took it over.
//   POST session/close       {sessionId, tabId, keepContext: true} releases
//                            the lease and keeps the chat. Always true now.
//   POST session/delete      {sessionId} -- the only discard.
//   POST session/history     {sessionId, before?, limit?} -> {turns: [{role,
//                            text, at}], more, before}, oldest first; paged
//                            backwards by `before`.
//   POST chat                during a turn -> 202 {queued: true, position,
//                            queueId}; what waits is merged into ONE turn
//                            when the running one ends, and the client
//                            picks that turn's reply up by attach.
//   POST chat/unqueue        {sessionId, queueId} -> 200, or 404/409 once the
//                            message has already gone into a turn.
//   stream events            {type: "ask", id, status: pending|delivered|
//                            answered, text?} -- also listed on ping.
//
// FEATURE DETECTION. A lesson built today may be served by a tutor that
// predates all of this, so no endpoint above is assumed. An endpoint is
// missing when it answers 404, 405 or 501 with a body that is not our JSON
// error: chat.py's server answers an unknown name with a plain-text "not
// found", express with an HTML page, and neither carries {error: {...}}. A
// JSON 404 is the endpoint speaking ("no such session"), not its absence.
// A missing endpoint is remembered for the page's life and never asked again.

export const PING_MS = 30000;

const _missing = new Set();

export function isMissing(name) { return _missing.has(name); }
export function markMissing(name) { _missing.add(name); }
// Tests only: each case starts with a tutor nobody has probed yet.
export function resetFeatures() { _missing.clear(); }

// `body` is whatever res.json() gave, or null when the body did not parse.
export function endpointAbsent(status, body) {
  if (status !== 404 && status !== 405 && status !== 501) return false;
  return !(body && typeof body === "object" && body.error);
}

// POST `body` as JSON to `url`, and say what came back:
//   { absent: true }                  the tutor has no such endpoint
//   { ok, status, data }              it answered (data null if not JSON)
//   { error }                         no answer at all (network)
// `name` is the key the missing-set remembers.
export async function callOptional(fetchImpl, name, url, body, extra) {
  if (_missing.has(name)) return { absent: true };
  let res;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      ...(extra || {}),
    });
  } catch (error) { return { error }; }
  let data = null;
  try { data = await res.json(); } catch (_) {}
  if (endpointAbsent(res.status, data)) { _missing.add(name); return { absent: true }; }
  return { ok: res.ok, status: res.status, data };
}

// ── Tab leases ──
// One id per page load. sessionStorage would carry it into a duplicated
// tab, and two tabs with one id would each think they hold the lease.
export function newTabId() {
  return "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

// What one ping's answer means for the tab: "held", "taken" (another tab took
// the chat over -- go read-only), "absent" (no leases on this tutor: stop
// pinging) or "unknown" (no answer, or one we cannot read -- try again).
export function pingOutcome(r) {
  if (r.absent) return "absent";
  if (r.error || !r.data) return "unknown";
  if (r.status === 409 && r.data.takenOver) return "taken";
  if (r.ok) return "held";
  return "unknown";
}

// ── The picker ──
// lastAt may come as epoch seconds, epoch ms or an ISO string; ms back, or
// null when absent or unreadable.
export function lastAtMs(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v < 1e12 ? v * 1000 : v;
  if (typeof v === "string" && v) { const t = Date.parse(v); return Number.isFinite(t) ? t : null; }
  return null;
}

// "just now", "5 min ago", "3 h ago", "2 d ago", else the date.
export function fmtAgo(ms, now) {
  if (ms == null) return "";
  const s = Math.max(0, Math.round(((now ?? Date.now()) - ms) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`;
  return new Date(ms).toISOString().slice(0, 10);
}

// Newest first by lastAt; a server without lastAt keeps its own order.
export function sortForPicker(list) {
  return [...list].sort((a, b) => (lastAtMs(b.lastAt) ?? -Infinity) - (lastAtMs(a.lastAt) ?? -Infinity));
}
