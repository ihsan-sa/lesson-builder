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
// /sessions and refuses session/open for another lesson's; a session with no
// base recorded it treats as another lesson's. A listed session carries that
// base as `base`, and this file reads it the same way the server does, so the
// client is right on a server that has not landed that half yet:
//
//   picker  -- offers a session only when it SAYS it is this lesson's
//              (ownsSession). A session with no base could be any lesson's,
//              and an unlabelled chat from another lesson is the whole bug.
//   restore -- takes a session whose id this lesson itself kept, unless the
//              server says it was born elsewhere (foreignSession). The kept
//              key is already scoped, so the id is this lesson's by
//              construction, and a reload keeps its chat on either server.
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

// Offerable to the student. A hosted lesson shares its origin with every
// other lesson, so there a session must SAY it is this one's: one with no
// lesson recorded could be any lesson's, and an unlabelled chat from another
// lesson is the whole bug. A dev build's base names no lesson and its own
// proxy (server/proxy.js) serves exactly one, so everything it lists is this
// lesson's and the picker works there as it always did.
export function ownsSession(s, base) {
  return lessonName(base) === "" || s.base === base;
}

// Known to be another lesson's. A session with no base is not offered
// (ownsSession) but is still restorable from this lesson's own kept list.
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
// resolves true when the server opened the session; false when it refused
// (a session born on another lesson, or one it no longer has). The first
// success takes `firstTabId`; later ones each get a tab from `openTab()`,
// which `closeTab(tabId)` takes away again when that open is refused -- a
// tab left sitting on a refusal is not "silently".
//
// A refused session is dropped from the kept list so the next load does not
// ask again.
//
// Returns { restored, refused }: `restored` when the first tab has a session;
// `refused` when at least one open was turned down -- the caller then starts
// a fresh session silently rather than showing the picker, which is the
// brief's line: "a restore that fails because the server refused a
// cross-lesson open starts a fresh session silently".
export async function restoreKept({ ss, base, list, isRestorable, firstTabId, openTab, closeTab, resume }) {
  let restored = false;
  let refused = false;
  for (const kc of readKept(ss, base)) {
    const found = list.find(s => s.id === kc.sessionId && isRestorable(s) && !foreignSession(s, base));
    if (!found) continue;
    const extra = restored;
    const tabId = extra ? openTab() : firstTabId;
    const ok = await resume(tabId, kc.sessionId, kc.chatNum || found.chatNum);
    if (ok) { restored = true; continue; }
    refused = true;
    dropSession(ss, base, kc.sessionId);
    if (extra) closeTab(tabId);
  }
  return { restored, refused };
}
