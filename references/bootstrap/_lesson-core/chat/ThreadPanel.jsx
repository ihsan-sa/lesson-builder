import { useState, useEffect, useRef, useCallback } from "react";
import { ChatBubble } from "./ChatBubble.jsx";

// Inline side-thread UI. Rendered via createPortal into a container inserted
// after the target block of a .chat-msg element (see Chatbot's portal-placement
// effect). Each thread has its own snippet, messages, context chips,
// attachments, loading state, and collapse flag.
//
// Props:
//   thread            { id, snippet, blockIdx, messages, collapsed, loading }
//   onToggleCollapse  collapse/expand
//   onSend            (text, contextArray|null, attachmentsArray|null)
//   onCancel          abort the in-flight reply for this thread
//   onDelete          remove the thread
//   onFocusChange     (focused: boolean) -- Chatbot routes captured lesson
//                     context into this thread while its composer has focus
//   onReadFiles       (FileList) => Promise<attachment[]>, supplied by Chatbot
//                     so the 5MB / type rules live in exactly one place
//   contextTrigger    { threadId, text, source, ts } from the lesson's
//                     right-click menu, Ctrl+Shift+F, or the context sink
export function ThreadPanel({
  thread, onToggleCollapse, onSend, onCancel, onDelete,
  onFocusChange, onReadFiles, contextTrigger,
}) {
  const [threadInput, setThreadInput] = useState("");
  const [threadCtx, setThreadCtx] = useState([]);
  const [threadAtts, setThreadAtts] = useState([]);
  const threadInputRef = useRef(null);
  const fileRef = useRef(null);
  const snippetPreview = thread.snippet.length > 50 ? thread.snippet.slice(0, 50) + "…" : thread.snippet;
  // Mount-only: intentional empty deps for initial focus
  useEffect(() => {
    if (thread.messages.length === 0 && threadInputRef.current) threadInputRef.current.focus();
  }, []);
  useEffect(() => {
    if (threadInputRef.current) threadInputRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [thread.messages.length, thread.loading]);

  // Releasing focus ownership on unmount matters: a deleted or collapsed
  // thread must not keep swallowing the lesson's captured context.
  useEffect(() => () => { onFocusChange?.(false); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const addThreadCtx = useCallback((text, source) => {
    const clean = text.replace(/\s+/g, " ").trim();
    if (!clean || clean.length < 3) return;
    setThreadCtx(prev => prev.some(s => s.text === clean) ? prev : [...prev, { text: clean, source }]);
    setTimeout(() => threadInputRef.current?.focus(), 0);
  }, []);

  // Watch for external context triggers: the lesson's "Reply in this thread"
  // menu item, Ctrl+Shift+F on a selection inside the panel, and the context
  // sink (Ctrl+Click on lesson content while this composer has focus).
  useEffect(() => {
    if (contextTrigger && contextTrigger.threadId === thread.id) {
      addThreadCtx(contextTrigger.text, contextTrigger.source || "selection");
    }
  }, [contextTrigger, thread.id, addThreadCtx]);

  const handleFiles = useCallback(async (files) => {
    if (!onReadFiles || !files || files.length === 0) return;
    const atts = await onReadFiles(files);
    if (atts && atts.length > 0) setThreadAtts(prev => [...prev, ...atts]);
    setTimeout(() => threadInputRef.current?.focus(), 0);
  }, [onReadFiles]);

  const handlePaste = useCallback((e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageFiles = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith("image/")) {
        const f = items[i].getAsFile();
        if (f) imageFiles.push(f);
      }
    }
    if (imageFiles.length > 0) { e.preventDefault(); handleFiles(imageFiles); }
  }, [handleFiles]);

  const handleSend = useCallback(() => {
    const text = threadInput.trim();
    if (!text && threadAtts.length === 0) return;
    onSend(text, threadCtx.length > 0 ? [...threadCtx] : null, threadAtts.length > 0 ? [...threadAtts] : null);
    setThreadInput("");
    setThreadCtx([]);
    setThreadAtts([]);
  }, [threadInput, threadCtx, threadAtts, onSend]);

  return (
    <div className={`thread-panel ${thread.collapsed ? "thread-collapsed" : ""}`} data-thread-id={thread.id}>
      <div className="thread-header" onClick={onToggleCollapse}>
        <button className="thread-collapse-btn" title={thread.collapsed ? "Expand thread" : "Collapse thread"}>
          {thread.collapsed ? "▶" : "▼"}
        </button>
        <span className="thread-snippet">"{snippetPreview}"</span>
        <span className="thread-count">{thread.messages.length > 0 ? `${thread.messages.length}` : "new"}</span>
        <button className="thread-close-btn" onClick={(e) => { e.stopPropagation(); onDelete(); }} title="Delete thread">{"✕"}</button>
      </div>
      {!thread.collapsed && (
        <div className="thread-body">
          {thread.messages.map((m, i) => (
            <div key={i} className={`thread-msg thread-msg-${m.role}`}>
              {m.role === "user" && m.context && (
                <div className="chat-msg-ctx-list">
                  {m.context.map((s, j) => (
                    <div key={j} className="chat-msg-ctx-chip-sent">{"+ "}{s.text.length > 50 ? s.text.slice(0, 50) + "…" : s.text}</div>
                  ))}
                </div>
              )}
              {m.role === "user" && m.attachments && (
                <div className="chat-msg-att-list">
                  {m.attachments.map((a, j) => a.thumb
                    ? <img key={j} src={a.thumb} className="chat-att-thumb-sent" alt={a.name} />
                    : <div key={j} className="chat-att-file-sent">{a.name}</div>
                  )}
                </div>
              )}
              {!(m.stopped && !m.content) && <ChatBubble text={m.content} role={m.role} onReplyBlock={addThreadCtx} streaming={!!m._streaming} />}
              {m.stopped && <div className="chat-stopped">{m.content ? "Stopped" : "Stopped before replying"}</div>}
            </div>
          ))}
          {thread.loading && (
            <div className="thread-loading-row">
              <div className="thread-loading"><span /><span /><span /></div>
              <button className="thread-stop" onClick={(e) => { e.stopPropagation(); onCancel?.(); }} title="Stop generating">{"■"}</button>
            </div>
          )}
          {!thread.loading && (
            <>
              {threadAtts.length > 0 && (
                <div className="thread-att-bar">
                  {threadAtts.map((a, i) => (
                    <div key={i} className="chat-att-preview">
                      {a.thumb ? <img src={a.thumb} className="chat-att-thumb" alt={a.name} /> : <span className="chat-att-fname">{a.name}</span>}
                      <button className="chat-att-rm" onClick={(e) => { e.stopPropagation(); setThreadAtts(prev => prev.filter((_, idx) => idx !== i)); }}>{"✕"}</button>
                    </div>
                  ))}
                </div>
              )}
              {threadCtx.length > 0 && (
                <div className="thread-ctx-bar">
                  {threadCtx.map((s, i) => (
                    <div key={i} className="chat-ctx-chip">
                      <span className="chat-ctx-chip-text">{"+ "}{s.text.length > 30 ? s.text.slice(0, 30) + "…" : s.text}</span>
                      <button className="chat-ctx-chip-x" onClick={(e) => { e.stopPropagation(); setThreadCtx(prev => prev.filter((_, idx) => idx !== i)); }}>{"✕"}</button>
                    </div>
                  ))}
                </div>
              )}
              <div className="thread-input-row">
                <input
                  type="file"
                  ref={fileRef}
                  style={{ display: "none" }}
                  accept="image/*,.pdf"
                  multiple
                  onChange={e => { const picked = Array.from(e.target.files || []); e.target.value = ""; if (picked.length) handleFiles(picked); }}
                />
                <button
                  className="thread-attach"
                  onClick={(e) => { e.stopPropagation(); fileRef.current?.click(); }}
                  title="Attach image or PDF to this thread"
                >+</button>
                <textarea
                  ref={threadInputRef}
                  className="thread-input"
                  value={threadInput}
                  onChange={e => setThreadInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                  onClick={e => e.stopPropagation()}
                  onPaste={handlePaste}
                  onFocus={() => onFocusChange?.(true)}
                  placeholder={
                    threadCtx.length > 0
                      ? `${threadCtx.length} context item${threadCtx.length > 1 ? "s" : ""} attached...`
                      : threadAtts.length > 0
                        ? "Describe what you attached..."
                        : "Reply to thread..."
                  }
                  rows={1}
                />
                <button className="thread-send" onClick={handleSend}>{"→"}</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
