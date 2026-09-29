// A chat's history coming back from the tutor, the sends that wait behind a
// running turn, and a chat written out as Markdown. Pure: no React, no
// window, fetch passed in -- tests/chat-persist drives every function here.
// The endpoints and their shapes are tutorApi.js's.

import { callOptional } from "./tutorApi.js";

// ── Restoring history ──
// sessionStorage is the tab's own copy and dies with the tab; a phone that
// closed the page, or a laptop picking up a chat begun on the phone, has
// none. The brief: "on resume, fetch session/history when sessionStorage has
// fewer turns". `count` is the server's messageCount -- the questions it took
// -- so the tab is short when it holds fewer user messages than that.
export function needsHistory(savedMsgs, session) {
  const count = session && typeof session.messageCount === "number" ? session.messageCount : null;
  if (count == null) return (savedMsgs || []).length === 0;
  const asked = (savedMsgs || []).filter(m => m.role === "user" && !m.unsent).length;
  return asked < count;
}

// Every page of session/history, oldest first. Stops at `maxPages` so a
// tutor that keeps answering `more` cannot hold the tab. null when the tutor
// has no history endpoint or would not give this one.
export async function fetchHistory({ fetchImpl, url, sessionId, limit = 50, maxPages = 20 }) {
  let turns = [];
  let before;
  for (let page = 0; page < maxPages; page++) {
    const r = await callOptional(fetchImpl, "session/history", url, { sessionId, limit, ...(before != null ? { before } : {}) });
    if (r.absent || r.error || !r.ok || !r.data || !Array.isArray(r.data.turns)) return page === 0 ? null : turns;
    turns = [...r.data.turns, ...turns];
    if (!r.data.more || r.data.before == null || r.data.before === before) break;
    before = r.data.before;
  }
  return turns;
}

// The restored transcript: one divider, then the server's turns as bubbles.
// It replaces what sessionStorage had, because the server's copy is the
// longer one (needsHistory said so). A turn with no text is dropped.
export const RESTORED = "restored";
export function restoredMessages(turns) {
  const msgs = (turns || [])
    .filter(t => (t.role === "user" || t.role === "assistant") && typeof t.text === "string" && t.text)
    .map(t => ({ role: t.role, content: t.role === "user" ? userTextOf(t.text) : t.text, restored: true }))
    .filter(m => m.content);
  if (msgs.length === 0) return [];
  return [{ role: "divider", kind: RESTORED, content: "Restored from the tutor" }, ...msgs];
}

// ── Sends behind a running turn ──
// A message typed while the tutor is answering is not dropped. It waits in
// the tab's `queue`, drawn under the transcript with a "queued" badge and a
// ×, never inside it: a bubble appended past the streaming reply would split
// that reply in two (turnState.js, insertFoldCard). A tutor that queues
// answers the POST with 202 and a queueId, and runs everything waiting as
// ONE turn when the running one ends. A tutor that does not (a 409 mid-turn)
// gets the same entries held here, and when the turn ends they go as one
// message. Either way the order is the order they were typed.
//
// An entry: { qkey, content, context, attachments, sendText, queueId?,
// position?, pending?, failed? }. `sendText` is what the student's words
// become on the wire (their context chips folded in); `queueId` is the
// server's, or "live" when the turn had already ended and the POST started
// a turn of its own.
export function newQueueKey() {
  return "q" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// The entries a finished turn hands on, split by who holds them. Pending
// (POST in flight) and failed ones stay behind.
export function splitQueue(queue) {
  const ready = (queue || []).filter(q => !q.pending && !q.failed);
  return { server: ready.filter(q => q.queueId), local: ready.filter(q => !q.queueId) };
}

// The one message the local entries become, in order.
export function mergeQueued(entries) {
  return (entries || []).map(q => q.sendText ?? q.content).join("\n\n---\n\n");
}

// The entries as the transcript's user bubbles, once they have gone.
export function queuedBubbles(entries) {
  return (entries || []).map(q => ({
    role: "user", content: q.content,
    ...(q.context ? { context: q.context } : {}),
    ...(q.attachments ? { attachments: q.attachments } : {}),
  }));
}

export function dropQueued(queue, qkeys) {
  const drop = new Set([].concat(qkeys));
  return (queue || []).filter(q => !drop.has(q.qkey));
}

// What the student typed, out of a user turn as the tutor stored it. The
// client sends its per-turn context first (buildActiveContext's block, then
// the optional reinforced and answer-style blocks), then context chips and
// "Question: ", then an attachment note. The history shows the words.
export function userTextOf(sent) {
  let s = String(sent || "");
  const end = s.lastIndexOf("[/ACTIVE CONTEXT]");
  if (end >= 0) {
    s = s.slice(end + "[/ACTIVE CONTEXT]".length);
    s = s.replace(/^\s*\[REINFORCED BEHAVIORS[\s\S]*?\[\/REINFORCED BEHAVIORS\]/, "");
    s = s.replace(/^\s*\[ANSWER STYLE[\s\S]*?\[\/ANSWER STYLE\]/, "");
  }
  s = s.replace(/\n\n\[(?:Attached files|File attachment failed|\d+ file\(s\) could NOT)[\s\S]*$/, "");
  const q = s.lastIndexOf("\n\nQuestion: ");
  if (q >= 0) s = s.slice(q + "\n\nQuestion: ".length);
  return s.trim();
}

// ── Asks to the course session ──
// One chip per ask, updated in place by id as its status moves on.
export const ASK_LABEL = { pending: "Asked — waiting", delivered: "Delivered to the course", answered: "Answered" };
export function mergeAsks(current, incoming) {
  const out = [...(current || [])];
  for (const a of incoming || []) {
    if (!a || !a.id || !ASK_LABEL[a.status]) continue;
    const i = out.findIndex(x => x.id === a.id);
    if (i >= 0) out[i] = { ...out[i], ...a };
    else out.push({ id: a.id, status: a.status, text: a.text || "" });
  }
  return out;
}

// ── Export ──
// A chat as Markdown: its title, then each turn under a speaker line. A file
// the tutor linked stays a link, so what it sent is one click from the page.
export function chatToMarkdown({ title, messages, exportedAt }) {
  const lines = [`# ${title || "Tutor chat"}`, "", `_Exported ${exportedAt || new Date().toISOString()}_`, ""];
  for (const m of messages || []) {
    if (m.role === "divider") { lines.push("---", "", `_${m.content}_`, ""); continue; }
    if (m.role !== "user" && m.role !== "assistant") continue;
    if (!m.content && !m.stopped) continue;
    lines.push(m.role === "user" ? "**You**" : "**Tutor**", "");
    lines.push(String(m.content || "").trim() + (m.stopped ? "\n\n_(stopped)_" : ""), "");
  }
  return lines.join("\n");
}

// A file name for the export: the title's words, safe on every OS.
export function exportName(title, chatNum) {
  const slug = String(title || "chat").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "chat";
  return `${slug}${chatNum ? "-" + chatNum : ""}.md`;
}
