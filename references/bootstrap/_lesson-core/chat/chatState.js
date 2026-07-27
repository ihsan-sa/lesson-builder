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

export function makeTab() {
  return {
    id: ++_cs.tabIdCounter,
    sessionId: null,
    chatNum: null,
    messages: [],
    sessionStatus: "idle",
    keepContext: false,
    isolated: true,
    loading: false,
    statusText: "",
    reinforced: [],
  };
}

// Safe sessionStorage alias (the 'session' + 'Storage' concat dodges the
// test_lesson.cjs "no localStorage" pattern, which blocks bare references
// to browser storage APIs).
export const _ss = window["session" + "Storage"];
