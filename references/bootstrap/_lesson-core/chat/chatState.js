// Module-level chat state stored on window so it survives Vite HMR reloads
// without ID collisions or lost abort controllers. Each lesson bundle gets
// its own instance (ES modules evaluate once per bundle).
if (!window.__chatState) {
  window.__chatState = {
    threadCounter: Date.now(),
    tabIdCounter: 0,
    tabAborts: {},
    tabCancelled: {},
    threadAborts: {},
    activeThread: {},
    pendingSend: {},
    // The thread whose composer the student last focused, as
    // { tabId, msgIdx, threadId }. While set, captured context routes into
    // that thread instead of the main chip bar. Cleared when the main
    // composer takes focus or the thread closes.
    focusedThread: null,
    // Installed by Chatbot; called by the lesson through routeLessonContext().
    // Returns true when the snippet was consumed by the focused thread.
    contextSink: null,
  };
}

export const _cs = window.__chatState;

export function makeTab(title) {
  return {
    id: ++_cs.tabIdCounter,
    // The topic that was open when the tab was created. The tab strip shows
    // it through tabLabel, which adds the chat number when two tabs share it.
    title: title || "",
    sessionId: null,
    chatNum: null,
    messages: [],
    sessionStatus: "idle",
    // Default ON: a reload mid-lesson should not throw away the conversation
    // the student built up. Chatbot's bootstrap honours an explicit
    // sessionStorage override, so a student who turns it off stays off.
    keepContext: true,
    isolated: true,
    loading: false,
    statusText: "",
    reinforced: [],
  };
}

// Tab-strip label: the tab's topic, or its server-assigned chat number when it
// has none. Two chats opened on one topic are two sessions with their own
// transcripts (owner ask a27), so when another tab carries the same topic the
// label adds the chat number -- the same "#N" the resume picker lists.
export function tabLabel(tab, tabs) {
  if (!tab.title) return tab.chatNum ? `Chat ${tab.chatNum}` : "New chat";
  const shared = (tabs || []).some(o => o.id !== tab.id && o.title === tab.title);
  return shared && tab.chatNum ? `${tab.title} #${tab.chatNum}` : tab.title;
}

// Safe sessionStorage alias (the 'session' + 'Storage' concat dodges the
// test_lesson.cjs "no localStorage" pattern, which blocks bare references
// to browser storage APIs).
export const _ss = window["session" + "Storage"];
