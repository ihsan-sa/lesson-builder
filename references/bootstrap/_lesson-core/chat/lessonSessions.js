// The tutor's remembered sessions, scoped to ONE lesson.
//
// A hosted lesson lives at /<course>/<slug>/ and its bundle's BASE_URL is that
// path. sessionStorage is per ORIGIN and survives same-tab navigation, so a
// chat kept under a bare `kcSessions` key on /ece260/ece260-ac-circuits/ was
// auto-restored by the next lesson opened in the same tab, and the ECE206
// tutor answered with ECE260's facts (owner, 2026-09-20, #lessons
// 1789942972.715899). Every key here carries the lesson's base, so one
// lesson's chats are invisible to another's. The old un-namespaced
// `kcSessions` / `chatMsgs_<sid>` keys are never read back: a stale one from
// before this change is ignored, not migrated -- a lost chat is cheaper than
// a wrong answer.
//
// The server side (lessons/chat.py on the hosted tutor) records the base a
// session was born on, lists only the requesting lesson's sessions on
// /sessions and refuses session/open for another lesson's with a 404. Its
// /sessions entries do NOT carry that base (ep_sessions: id, chatNum, model,
// effort, isolated, created, messageCount, open, turn, lastTurn, resumable),
// so a listed session with no `base` is this lesson's -- the server already
// filtered it. Only a session whose `base` is set and differs is another
// lesson's (foreignSession): never offered in the picker, never restored.
// That guard costs nothing today and holds if a server ever lists more.
//
// Pure: storage is passed in, nothing here touches window, so
// tests/lesson-session-scope drives it with a Map.

// The base a hosted lesson is built with, "/ece206/ece206-course-overview/".
// The key separator is what keeps the scoped key from ever equalling the old
// bare one, whatever the base.
export function keptKey(base) { return "kcSessions@" + base; }
export function msgsKey(base, sid) { return "chatMsgs@" + base + sid; }
export function reinfKey(base, sid) { return "chatReinf@" + base + sid; }

// The kept-context list for this lesson: [{ sessionId, chatNum }]. Unreadable
// or absent -> [].
export function readKept(ss, base) {
  try {
    const list = JSON.parse(ss.getItem(keptKey(base)) || "[]");
    return Array.isArray(list) ? list : [];
  } catch (_) { return []; }
}

export function writeKept(ss, base, list) {
  try { ss.setItem(keptKey(base), JSON.stringify(list)); } catch (_) {}
}

// Remember `sid` as kept (moved to the end) or forget it.
export function keepSession(ss, base, sessionId, chatNum) {
  const list = readKept(ss, base).filter(s => s.sessionId !== sessionId);
  list.push({ sessionId, chatNum });
  writeKept(ss, base, list);
}
export function dropSession(ss, base, sessionId) {
  writeKept(ss, base, readKept(ss, base).filter(s => s.sessionId !== sessionId));
}

// "ece206/ece206-course-overview" for a hosted lesson; "" for a dev build,
// whose base is "/" and names no lesson.
export function lessonName(base) {
  return String(base || "").replace(/^\/+|\/+$/g, "");
}

// Known to be another lesson's: its `base` is set and is not this one. A
// session with no `base` is this lesson's (the server filtered /sessions).
// The picker offers only `!foreignSession`, and restoreKept skips the rest.
export function foreignSession(s, base) {
  return !!s.base && s.base !== base;
}

// Picker entry: the lesson the chat belongs to, then the old label. Under
// vite dev there is no lesson in the base and the label is the old one
// unchanged -- which is also what tests/resume-metadata clicks.
export function sessionLabel(s, base) {
  const name = lessonName(s.base || base);
  const label = `Chat #${s.chatNum} (${s.messageCount} msgs) ${s.isolated ? "ISO" : "MEM"}`;
  return name ? `${name} · ${label}` : label;
}

// Reattach this lesson's kept sessions on load. `resume(tabId, sid, chatNum)`
// resolves "ok" when the server opened the session, "refused" when it
// answered no (a 404: a session born on another lesson, or one it no longer
// has), and "error" when there was no answer (the network dropped). The first
// outcome that takes a tab takes `firstTabId`; later ones each get a tab from
// `openTab()`, which `closeTab(tabId)` takes away again when that open is
// refused -- a tab left sitting on a refusal is not "silently".
//
// Only a refusal forgets the session (dropped from the kept list, so the next
// load does not ask again) and counts toward a fresh start. An "error" keeps
// it kept and leaves the tab in its error state: a brief network drop during
// a reload must not throw away the student's chat.
//
// Returns { taken, refused }: `taken` when the first tab has an outcome of its
// own (open, or showing the error); `refused` when at least one open was
// turned down -- with `taken` false the caller then starts a fresh session
// silently rather than showing the picker, which is the brief's line: "a
// restore that fails because the server refused a cross-lesson open starts a
// fresh session silently".
export async function restoreKept({ ss, base, list, isRestorable, firstTabId, openTab, closeTab, resume }) {
  let taken = false;
  let refused = false;
  for (const kc of readKept(ss, base)) {
    const found = list.find(s => s.id === kc.sessionId && isRestorable(s) && !foreignSession(s, base));
    if (!found) continue;
    const extra = taken;
    const tabId = extra ? openTab() : firstTabId;
    const outcome = await resume(tabId, kc.sessionId, kc.chatNum || found.chatNum);
    if (outcome !== "refused") { taken = true; continue; }   // "ok", or "error" left on show
    refused = true;
    dropSession(ss, base, kc.sessionId);
    if (extra) closeTab(tabId);
  }
  return { taken, refused };
}
