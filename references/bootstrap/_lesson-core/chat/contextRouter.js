import { _cs } from "./chatState.js";

/**
 * Context routing seam between the lesson and the chat.
 *
 * The lesson owns `contextSnippets` (the main chip bar) and captures snippets
 * from its own DOM, but it cannot know whether the student is currently
 * composing in a side-thread. Chatbot installs a sink while a thread composer
 * has focus; the lesson calls this first and only falls back to its own chip
 * bar when nothing consumed the snippet.
 *
 * Usage in a lesson's addSnippet:
 *
 *     const addSnippet = useCallback((text, source) => {
 *       const clean = text.replace(/\s+/g, " ").trim();
 *       if (!clean || clean.length < 3) return;
 *       if (routeLessonContext(clean, source)) return;   // went to a thread
 *       setContextSnippets(prev => ...);
 *     }, []);
 *
 * Returns false when no thread is focused (or the chat is not mounted), so a
 * lesson that never adopts it behaves exactly as before.
 */
export function routeLessonContext(text, source) {
  const sink = _cs.contextSink;
  if (typeof sink !== "function") return false;
  try {
    return sink(text, source) === true;
  } catch (_) {
    return false;
  }
}

/** True when a thread composer currently owns captured context. */
export function hasFocusedThread() {
  return !!_cs.focusedThread;
}
