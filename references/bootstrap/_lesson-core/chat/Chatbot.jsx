import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { MODELS, EFFORT_LEVELS, DEFAULT_MODEL, DEFAULT_EFFORT } from "../constants/models.js";
import { _cs, _ss, makeTab } from "./chatState.js";
import { ChatBubble } from "./ChatBubble.jsx";
import { ThreadPanel } from "./ThreadPanel.jsx";
import { buildSystemPrompt } from "./buildSystemPrompt.js";
import { processResponse as parseChatResponse, stripUnclosedTags } from "./processResponse.js";
import { buildActiveContext } from "./buildActiveContext.js";
import * as obsQueue from "./observationQueue.js";
import { useShell } from "../ui/shellContext.js";
import { IconDockSide, IconDockBottom, IconExternal, IconSettings, IconArrowRight, IconClose } from "../ui/LessonShell.jsx";

// Student-facing answer style. "hints" leaves the PEDAGOGY POLICY exactly as
// written; "direct" relaxes only the withhold-first ordering (see
// buildActiveContext).
const ANSWER_STYLES = [
  { id: "hints",  label: "Hints first" },
  { id: "direct", label: "Direct" },
];

// Every capture/thread gesture in one place, rendered by the Ctrl+Shift+?
// overlay. Keep this in sync when a gesture is added — an affordance nobody
// can find is the same as one that does not exist.
const HELP_GROUPS = [
  {
    title: "Panel",
    rows: [
      ["Ctrl + /", "open or close the chat"],
      ["Ctrl + \\", "expand or shrink the panel"],
      ["Ctrl + Shift + ?", "this list"],
      ["Ctrl + Shift + ! @ # $", "reasoning effort: low / medium / high / xhigh"],
      ["Esc", "close this list"],
    ],
  },
  {
    title: "Add context",
    rows: [
      ["Ctrl + Click", "add a lesson block or a chat reply block to context"],
      ["drag-select", "add the selected text to context"],
      ["Ctrl + Shift + G", "add the current selection to context"],
      ["right-click a selection", "Reply / Ask in a thread / Reply in this thread"],
      ["drag a file onto the panel", "attach an image or PDF"],
      ["paste an image", "attach it to the composer or thread you are in"],
    ],
  },
  {
    title: "Threads",
    rows: [
      ["Ctrl + Shift + J", "open a thread on the selection (chat reply or lesson)"],
      ["Ctrl + Shift + F", "add the selection to the surrounding thread"],
      ["focus a thread box", "captured context goes to that thread, not the main composer"],
    ],
  },
];

// Main chat orchestrator. Manages tabs, sessions, streaming, attachments,
// threads, graph edits, suggestions, and keyboard shortcuts.
//
// Props:
//   - topicId, topicTitle: current lesson tab (displayed in header, sent as context)
//   - contextSnippets, onClearSnippet, onClearAllSnippets: page-captured chips
//   - open, setOpen: panel visibility
//   - onEditGraph, graphParams: graph state for <<EDIT_GRAPH>> edits
//   - graphRenderId: monotonic counter bumped by the lesson after each edit
//       applies; used to tag visual-verify observations with the predicted
//       next renderId so the bot can screenshot the right frame
//   - addSnippet: callback to add a snippet from chat reply clicks
//   - threadTrigger, threadCtxTrigger: external triggers from context menu
//   - courseCode, courseName, lessonContext, topicContext, lessonFile:
//       forwarded to buildSystemPrompt factory
//   - graphSchema: per-lesson schema for validating <<EDIT_GRAPH>> edits; if
//       omitted, edits pass through unchanged (backward compat)
export function Chatbot({
  topicId, topicTitle, contextSnippets, onClearSnippet, onClearAllSnippets,
  open, setOpen, onEditGraph, graphParams, graphRenderId, addSnippet, threadTrigger, threadCtxTrigger,
  courseCode, courseName, lessonContext, topicContext, lessonFile, graphSchema,
  institution,
}) {
  // Placement is owned by LessonShell when there is one. Standalone mounts
  // (the Lumen embed shape, any bare <Chatbot/>) get null here and fall back
  // to the floating panel + round toggle.
  const shell = useShell();

  const [tabs, setTabs] = useState([]);
  const [activeTabIdx, setActiveTabIdx] = useState(0);
  const [input, setInput] = useState("");
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [effort, setEffort] = useState(DEFAULT_EFFORT);
  const [answers, setAnswers] = useState("hints");
  const [showSettings, setShowSettings] = useState(false);
  // Read inside async send paths, which close over a stale `answers`.
  const answersRef = useRef(answers);
  useEffect(() => { answersRef.current = answers; }, [answers]);
  const [expanded, setExpanded] = useState(false);
  const [chatSize, setChatSize] = useState(null);
  const resizeRef = useRef(null);
  const [attachments, setAttachments] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  // Every context/thread gesture below is keyboard- or modifier-driven and has
  // no on-screen signifier. Ctrl+Shift+? lists them; without it the whole
  // capture surface is undiscoverable.
  const [showHelp, setShowHelp] = useState(false);
  const showHelpRef = useRef(false);
  useEffect(() => { showHelpRef.current = showHelp; }, [showHelp]);
  const [serverSessions, setServerSessions] = useState([]);
  // commitInFlight: keyed by `${tabId}:${msgIdx}` of the message whose commit
  // chip is currently being processed, so we can disable its button. null
  // when no commit is in flight. Reset to null on success or error so the
  // user can retry.
  const [commitInFlight, setCommitInFlight] = useState(null);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const fileRef = useRef(null);
  const initStartedRef = useRef(false);
  const tabsRef = useRef(tabs);
  const activeTabIdxRef = useRef(activeTabIdx);

  useEffect(() => { tabsRef.current = tabs; }, [tabs]);
  useEffect(() => { activeTabIdxRef.current = activeTabIdx; }, [activeTabIdx]);
  // Read by the once-only session bootstrap, which cannot depend on topicTitle
  // without re-running and creating a second session.
  const topicTitleRef = useRef(topicTitle);
  useEffect(() => { topicTitleRef.current = topicTitle; }, [topicTitle]);

  const activeTab = tabs[activeTabIdx] || null;

  const updateTab = useCallback((tabId, updates) => {
    setTabs(prev => prev.map(t => t.id === tabId ? { ...t, ...updates } : t));
  }, []);

  const prevMsgCountRef = useRef(0);
  useEffect(() => {
    const count = activeTab?.messages?.length || 0;
    if (scrollRef.current && (count > prevMsgCountRef.current || activeTab?.loading)) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
    prevMsgCountRef.current = count;
  }, [activeTab?.messages?.length, activeTab?.loading]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 150);
  }, [open, activeTabIdx]);

  useEffect(() => {
    const handleKey = (e) => {
      if (e.ctrlKey && e.shiftKey && (e.key === "?" || e.key === "/")) {
        e.preventDefault();
        if (!open) setOpen(true);
        setShowHelp(h => !h);
        return;
      }
      if (e.key === "Escape" && showHelpRef.current) {
        e.preventDefault();
        setShowHelp(false);
        return;
      }
      if (e.ctrlKey && e.key === "\\") {
        e.preventDefault();
        if (!open) setOpen(true);
        setChatSize(null);
        setExpanded(ex => !ex);
        return;
      }
      if (e.ctrlKey && e.shiftKey) {
        if (e.key === 'J') {
          e.preventDefault();
          const sel = window.getSelection();
          const text = sel?.toString().trim();
          if (text && text.length >= 3) {
            const msgEl = sel.anchorNode?.parentElement?.closest('.chat-msg[data-msg-idx]');
            if (msgEl) {
              const idx = parseInt(msgEl.dataset.msgIdx);
              let bIdx = null;
              const block = sel.anchorNode?.parentElement?.closest('[data-chat-block]');
              if (block) {
                const bubble = msgEl.querySelector('.chat-msg-rendered');
                if (bubble) bIdx = Array.from(bubble.querySelectorAll('[data-chat-block]')).indexOf(block);
              }
              const tab = tabsRef.current[activeTabIdxRef.current];
              if (tab) openThread(tab.id, idx, text, bIdx);
            } else {
              // Selection is in the lesson body, not a chat reply: anchor the
              // thread to the lesson instead of dropping the gesture.
              openLessonThread(text, "lesson selection");
              if (!open) setOpen(true);
            }
            sel.removeAllRanges();
          }
          return;
        }
        if (e.key === 'G') {
          e.preventDefault();
          const sel = window.getSelection();
          const text = sel?.toString().trim();
          if (text && text.length >= 3) {
            addSnippet(text, "selection");
            sel.removeAllRanges();
            setTimeout(() => inputRef.current?.focus(), 0);
          }
          return;
        }
        const k = e.key.toLowerCase();
        const m = MODELS.find(m => m.key === k);
        if (m) { e.preventDefault(); setModel(m.model); return; }
        const effortIdx = "!@#$".indexOf(e.key);
        if (effortIdx >= 0) { e.preventDefault(); setEffort(EFFORT_LEVELS[effortIdx]); return; }
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, setOpen]); // openThread excluded: defined later via useCallback, never changes

  const startResize = useCallback((e, edge) => {
    e.preventDefault();
    const startX = e.clientX, startY = e.clientY;
    const panel = e.target.closest(".chat-panel");
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    const startW = rect.width, startH = rect.height;
    const onMove = (ev) => {
      const dx = ev.clientX - startX, dy = ev.clientY - startY;
      let newW = startW, newH = startH;
      if (edge.includes("l")) newW = Math.max(300, startW - dx);
      if (edge.includes("t")) newH = Math.max(250, startH - dy);
      setChatSize({ w: newW, h: newH });
    };
    const onUp = () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); document.removeEventListener("mouseleave", onUp); };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.addEventListener("mouseleave", onUp);
  }, []);

  const toggleExpand = useCallback(() => { setChatSize(null); setExpanded(e => !e); }, []);

  useEffect(() => {
    if (!activeTab) return;
    if (activeTab.keepContext && activeTab.sessionId) {
      try {
        let kcList = [];
        try { kcList = JSON.parse(_ss.getItem("kcSessions") || "[]"); } catch (_) {}
        kcList = kcList.filter(s => s.sessionId !== activeTab.sessionId);
        kcList.push({ sessionId: activeTab.sessionId, chatNum: activeTab.chatNum });
        _ss.setItem("kcSessions", JSON.stringify(kcList));
      } catch (_) {}
    } else if (activeTab.sessionId) {
      try {
        let kcList = [];
        try { kcList = JSON.parse(_ss.getItem("kcSessions") || "[]"); } catch (_) {}
        kcList = kcList.filter(s => s.sessionId !== activeTab.sessionId);
        _ss.setItem("kcSessions", JSON.stringify(kcList));
      } catch (_) {}
    }
  }, [activeTab?.keepContext, activeTab?.sessionId, activeTab?.chatNum]);

  // Persist EVERY keep-context tab, not just the visible one: a background tab
  // that finishes streaming while the student is looking elsewhere would
  // otherwise never be written back, and a reload would restore it from a
  // stale snapshot. `_streaming` is stripped at both levels — a message
  // persisted mid-stream would come back permanently marked streaming, which
  // disables its reply-block wrapping (and therefore click-to-context) forever.
  const stripStreaming = (m) => {
    const { _streaming, ...rest } = m;
    return rest;
  };
  useEffect(() => {
    for (const tab of tabs) {
      if (!tab.keepContext || !tab.sessionId || tab.messages.length === 0) continue;
      try {
        const saveable = tab.messages.map(m => ({
          role: m.role, content: m.content,
          ...(m.source ? { source: m.source } : {}),
          ...(m.context ? { context: m.context } : {}),
          ...(m.suggestion ? { suggestion: m.suggestion } : {}),
          ...(m.commitSuggest ? { commitSuggest: m.commitSuggest } : {}),
          ...(m.commitResult ? { commitResult: m.commitResult } : {}),
          ...(m.threads ? { threads: m.threads.map(t => ({ ...t, loading: false, messages: (t.messages || []).map(stripStreaming) })) } : {}),
        }));
        _ss.setItem("chatMsgs_" + tab.sessionId, JSON.stringify(saveable));
      } catch (_) {}
    }
  }, [tabs]);

  useEffect(() => {
    for (const tab of tabs) {
      if (!tab.keepContext || !tab.sessionId) continue;
      try {
        _ss.setItem("chatReinf_" + tab.sessionId, JSON.stringify(tab.reinforced || []));
      } catch (_) {}
    }
  }, [tabs]);

  // Ctrl-gate for context-adding clicks. While Ctrl is held, body gains the
  // class `ctx-ctrl-held` -- chat.css.js uses it to reveal hover highlights
  // and the pointer cursor on both chat bubbles and lesson content blocks.
  // A capture-phase click listener stops clicks on lesson context elements
  // when Ctrl is not held, so the per-lesson handleContentClick never fires
  // (every lesson has its own copy; this is the cheap centralised gate).
  // ChatBubble's own handler checks e.ctrlKey directly.
  useEffect(() => {
    const setHeld = (held) => {
      if (typeof document === "undefined") return;
      document.body.classList.toggle("ctx-ctrl-held", !!held);
    };
    const onKeyDown = (e) => { if (e.ctrlKey) setHeld(true); };
    const onKeyUp   = (e) => { if (!e.ctrlKey) setHeld(false); };
    const onBlur      = () => setHeld(false);
    const onVisibility = () => { if (document.hidden) setHeld(false); };
    const onClickCapture = (e) => {
      if (e.ctrlKey) return;
      // Chat UI handles its own gating; don't touch form controls either.
      if (e.target.closest(".chat-panel, .chat-toggle, .chat-msg-rendered, .topbar, .rail, input, textarea, button, a, select")) return;
      // Keep this list identical to the lesson's handleContentClick and the
      // hover rules in chat.css.js. A class in one list but not the others
      // gets the pointer cursor and then does nothing.
      if (e.target.closest(".eq-block, .key-concept, .formula-sheet-box, .summary-box, .practice-problem, .compare-card, .para, .info-list li, .section-title")) {
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("click", onClickCapture, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("click", onClickCapture, true);
      setHeld(false);
    };
  }, []);

  // "Explain" pill on an equation block. ui/Eq.jsx dispatches a window
  // CustomEvent rather than taking a handler prop, so no lesson has to
  // prop-drill a callback down to every <Eq>. Lands the LaTeX in the same
  // context chip bar a Ctrl+Click would (so a focused thread still wins) and
  // opens the panel.
  useEffect(() => {
    const onExplain = (e) => {
      const { latex, label } = (e && e.detail) || {};
      if (!latex) return;
      if (addSnippet) addSnippet(latex, label || "equation");
      if (setOpen) setOpen(true);
      setShowSettings(false);
      setTimeout(() => inputRef.current?.focus(), 120);
    };
    window.addEventListener("lesson:explain", onExplain);
    return () => window.removeEventListener("lesson:explain", onExplain);
  }, [addSnippet, setOpen]);

  useEffect(() => {
    const handleUnload = () => {
      const currentTabs = tabsRef.current;
      for (const tab of currentTabs) {
        if (!tab.sessionId) continue;
        const blob = new Blob([JSON.stringify({ sessionId: tab.sessionId, keepContext: tab.keepContext })], { type: "application/json" });
        navigator.sendBeacon("/session/close", blob);
        obsQueue.cleanup(tab.sessionId);
      }
    };
    window.addEventListener("beforeunload", handleUnload);
    return () => window.removeEventListener("beforeunload", handleUnload);
  }, []);

  const makeSystemPrompt = useCallback((isolatedFlag) => buildSystemPrompt({
    courseCode, courseName, lessonContext, topicContext, graphParams, isolatedFlag, lessonFile, institution,
  }), [courseCode, courseName, lessonContext, topicContext, graphParams, lessonFile, institution]);

  const createSessionForTab = useCallback(async (tabId) => {
    updateTab(tabId, { sessionStatus: "loading" });
    const tab = tabsRef.current.find(t => t.id === tabId);
    const iso = tab ? tab.isolated : true;
    try {
      const res = await fetch("/session/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, effort, isolated: iso, system: makeSystemPrompt(iso) }),
      });
      const data = await res.json();
      if (data.sessionId) {
        updateTab(tabId, { sessionId: data.sessionId, chatNum: data.chatNum, sessionStatus: "ready", messages: [] });
      } else {
        updateTab(tabId, { sessionStatus: "error" });
      }
    } catch (e) {
      console.error("Session init failed:", e);
      updateTab(tabId, { sessionStatus: "error" });
    }
  }, [model, effort, makeSystemPrompt, updateTab]);

  const transferSession = useCallback(async () => {
    if (!activeTab || !activeTab.sessionId || activeTab.loading) return;
    const tabId = activeTab.id;
    const newIsolatedState = !activeTab.isolated;
    updateTab(tabId, { sessionStatus: "loading", messages: [...activeTab.messages, { role: "assistant", content: `Transferring to ${newIsolatedState ? "isolated" : "shared memory"} mode...` }] });
    try {
      const res = await fetch("/session/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: activeTab.sessionId, model, effort, isolated: newIsolatedState, system: makeSystemPrompt(newIsolatedState) }),
      });
      const data = await res.json();
      if (data.sessionId) {
        setTabs(prev => prev.map(t => t.id === tabId ? { ...t, sessionId: data.sessionId, chatNum: data.chatNum, isolated: data.isolated, sessionStatus: "ready", messages: [...t.messages, { role: "assistant", content: `Session transferred to ${data.isolated ? "isolated" : "shared memory"} mode. Chat #${data.chatNum} continues.` }] } : t));
      } else {
        setTabs(prev => prev.map(t => t.id === tabId ? { ...t, sessionStatus: "error", messages: [...t.messages, { role: "assistant", content: data.error?.message || "Transfer failed." }] } : t));
      }
    } catch (e) {
      setTabs(prev => prev.map(t => t.id === tabId ? { ...t, sessionStatus: "error", messages: [...t.messages, { role: "assistant", content: `Transfer error: ${e.message}` }] } : t));
    }
  }, [activeTab, model, effort, makeSystemPrompt, updateTab]);

  const resumeSessionIntoTab = useCallback(async (tabId, sid, num) => {
    if (tabsRef.current.some(t => t.id !== tabId && t.sessionId === sid)) {
      updateTab(tabId, { messages: [{ role: "assistant", content: "This session is already open in another tab." }], sessionStatus: "picking" });
      return;
    }
    try {
      const res = await fetch("/session/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sid }),
      });
      if (res.ok) {
        const data = await res.json();
        let savedMsgs = [];
        try {
          const raw = _ss.getItem("chatMsgs_" + sid);
          if (raw) savedMsgs = JSON.parse(raw).map(m => m.threads ? { ...m, threads: m.threads.map(t => ({ ...t, collapsed: true })) } : m);
        } catch (_) {}
        let savedReinf = [];
        try {
          const rawReinf = _ss.getItem("chatReinf_" + sid);
          if (rawReinf) savedReinf = JSON.parse(rawReinf);
        } catch (_) {}
        updateTab(tabId, { sessionId: sid, chatNum: data.chatNum || num, sessionStatus: "ready", isolated: !!data.isolated, ...(savedMsgs.length > 0 ? { messages: savedMsgs } : {}), ...(Array.isArray(savedReinf) && savedReinf.length > 0 ? { reinforced: savedReinf } : {}) });
      } else {
        const err = await res.json();
        updateTab(tabId, { messages: [{ role: "assistant", content: err.error?.message || "Cannot open session" }], sessionStatus: "picking" });
      }
    } catch (e) {
      updateTab(tabId, { sessionStatus: "error" });
    }
  }, [updateTab]);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch("/sessions");
      const data = await res.json();
      return data.sessions || [];
    } catch (_) { return []; }
  }, []);

  useEffect(() => {
    // PROD gate: the static deploy has no proxy, so never fire /sessions or
    // /session/init there (they only 404 and spam the console).
    if (import.meta.env.PROD) return;
    if (initStartedRef.current) return;
    initStartedRef.current = true;

    // Name the opening tab after whatever topic the student is on, same as +.
    const firstTab = makeTab(topicTitleRef.current);
    firstTab.keepContext = _ss.getItem("keepContext") === "true";
    setTabs([firstTab]);
    setActiveTabIdx(0);

    (async () => {
      let kcList = [];
      if (firstTab.keepContext) {
        try { kcList = JSON.parse(_ss.getItem("kcSessions") || "[]"); } catch (_) {}
      }

      if (kcList.length > 0) {
        const list = await fetchSessions();
        setServerSessions(list);
        let restoredFirst = false;
        for (const kc of kcList) {
          const found = list.find(s => s.id === kc.sessionId && !s.open);
          if (!found) continue;
          if (!restoredFirst) {
            await resumeSessionIntoTab(firstTab.id, kc.sessionId, kc.chatNum || found.chatNum);
            restoredFirst = true;
          } else {
            const extraTab = makeTab(topicTitleRef.current);
            extraTab.keepContext = true;
            setTabs(prev => [...prev, extraTab]);
            await resumeSessionIntoTab(extraTab.id, kc.sessionId, kc.chatNum || found.chatNum);
          }
        }
        if (restoredFirst) return;
      }

      const list = await fetchSessions();
      const available = list.filter(s => !s.open);
      setServerSessions(list);
      if (available.length > 0) {
        updateTab(firstTab.id, { sessionStatus: "picking" });
      } else {
        await createSessionForTab(firstTab.id);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (activeTab?.sessionStatus !== "picking") return;
    (async () => {
      const list = await fetchSessions();
      setServerSessions(list);
    })();
  }, [activeTab?.sessionStatus]);

  // Activation is by tab ID, resolved after the tabs array commits. Reading
  // `prev.length` inside the updater and using it as the new index is unsafe:
  // the updater can run later (or twice) than the surrounding call, so two
  // quick clicks on "+" could leave the active index pointing at nothing.
  const pendingActivateRef = useRef(null);
  useEffect(() => {
    if (pendingActivateRef.current == null) return;
    const idx = tabs.findIndex(t => t.id === pendingActivateRef.current);
    if (idx >= 0) {
      pendingActivateRef.current = null;
      setActiveTabIdx(idx);
    }
  }, [tabs]);

  const addTab = useCallback(() => {
    const newTab = makeTab(topicTitle);
    pendingActivateRef.current = newTab.id;
    setTabs(prev => [...prev, newTab]);
    createSessionForTab(newTab.id);
  }, [createSessionForTab, topicTitle]);

  const closeTab = useCallback(async (tabId) => {
    const tab = tabsRef.current.find(t => t.id === tabId);
    if (tab && tab.sessionId) {
      try {
        const blob = new Blob([JSON.stringify({ sessionId: tab.sessionId, keepContext: tab.keepContext })], { type: "application/json" });
        navigator.sendBeacon("/session/close", blob);
      } catch (_) {}
      obsQueue.cleanup(tab.sessionId);
    }
    const closedIdx = tabsRef.current.findIndex(t => t.id === tabId);
    setTabs(prev => {
      const next = prev.filter(t => t.id !== tabId);
      if (next.length === 0) return prev;
      return next;
    });
    setActiveTabIdx(prev => {
      const remaining = tabsRef.current.length - 1;
      if (remaining <= 0) return 0;
      if (closedIdx < prev) return prev - 1;
      if (closedIdx === prev) return Math.min(prev, remaining - 1);
      return prev;
    });
  }, []);

  const readFileAsBase64 = (file) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result.split(",")[1]);
    r.onerror = () => reject(new Error("Read failed"));
    r.readAsDataURL(file);
  });

  // Single place the 5MB cap and the image/PDF-only rule live. Threads reuse
  // it through the onReadFiles prop so their rules can never drift from the
  // main composer's.
  const readFiles = useCallback(async (files) => {
    const newAtts = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.size > 5 * 1024 * 1024) continue;
      const isImage = file.type.startsWith("image/");
      const isPdf = file.type === "application/pdf";
      if (!isImage && !isPdf) continue;
      try {
        const b64 = await readFileAsBase64(file);
        const thumb = isImage ? `data:${file.type};base64,${b64}` : null;
        newAtts.push({ name: file.name, type: file.type, data: b64, thumb, isImage, isPdf });
      } catch (e) { /* skip */ }
    }
    return newAtts;
  }, []);

  const handleFiles = async (files) => {
    const newAtts = await readFiles(files);
    if (newAtts.length > 0) setAttachments(prev => [...prev, ...newAtts]);
  };

  const handlePaste = (e) => {
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
  };

  const removeAttachment = (idx) => setAttachments(prev => prev.filter((_, i) => i !== idx));

  // Wrap onEditGraph so that after a valid edit is applied by the lesson,
  // we enqueue a 'visual' observation instructing the bot to screenshot and
  // run the visual-QA team on the next turn. processResponse only calls
  // onEditGraph when there are accepted edits, so this gate is implicit.
  const wrappedOnEditGraph = (edits) => {
    if (onEditGraph) onEditGraph(edits);
    const sid = activeTab?.sessionId;
    if (!sid) return;
    for (const graphKey of Object.keys(edits || {})) {
      obsQueue.enqueue(sid, 'visual', {
        graphKey,
        renderId: (graphRenderId || 0) + 1, // lesson bumps after we return
        viteUrl: window.location.origin,
        tabId: topicId,
      });
    }
  };

  const processResponse = (text) => parseChatResponse(text, {
    onEditGraph: wrappedOnEditGraph,
    graphSchema,
    onError: (type, details) => {
      const sid = activeTab?.sessionId;
      if (sid) obsQueue.enqueue(sid, type, details);
    },
  });

  const cancelRequest = () => {
    const tab = tabsRef.current[activeTabIdxRef.current];
    if (!tab) return;
    const ctrl = _cs.tabAborts[tab.id];
    if (ctrl) { _cs.tabCancelled[tab.id] = true; ctrl.abort(); }
    for (const key of Object.keys(_cs.threadAborts)) {
      if (key.startsWith(tab.id + ':')) { try { _cs.threadAborts[key].abort(); } catch (_) {} delete _cs.threadAborts[key]; }
    }
  };

  const killSession = useCallback(() => {
    if (!activeTab) return;
    cancelRequest();
    if (activeTab.sessionId) {
      fetch("/session/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: activeTab.sessionId, keepContext: false }),
      }).catch(() => {});
      obsQueue.cleanup(activeTab.sessionId);
    }
    updateTab(activeTab.id, {
      sessionId: null, chatNum: null, sessionStatus: "idle",
      loading: false, statusText: "",
      messages: [...activeTab.messages, { role: "assistant", content: "Session killed." }],
    });
  }, [activeTab, cancelRequest, updateTab]);

  const sendMessage = async (overrideText) => {
    // Defensive: a DOM handler wired as onClick={sendMessage} would hand us a
    // SyntheticEvent here, which then becomes the message body and the React
    // child of the user bubble (crashing the render). Only a string is an
    // override; anything else means "send what is in the composer".
    if (typeof overrideText !== "string") overrideText = undefined;
    const tab = tabsRef.current[activeTabIdxRef.current];
    if (!tab || !tab.sessionId || tab.sessionStatus !== "ready") return;
    const text = overrideText !== undefined ? overrideText : input.trim();
    const currentAtts = overrideText !== undefined ? [] : [...attachments];
    if (!text && currentAtts.length === 0) return;
    if (tab.loading) {
      // A machine-generated send (a suggestion approval) that lands mid-turn
      // used to be dropped on the floor while its UI had already been
      // dismissed — the student saw the bar vanish and nothing happen. Park
      // it; the loading-cleared effect below delivers it.
      if (overrideText !== undefined) _cs.pendingSend[tab.id] = text;
      return;
    }
    const tabId = tab.id;
    if (overrideText === undefined) {
      setInput("");
      setAttachments([]);
    }
    let userContent = text || "(attached file)";
    if (overrideText === undefined && contextSnippets.length > 0) {
      const ctxBlock = contextSnippets.map((s, i) => `[Context ${i + 1} -- ${s.source}]: ${s.text}`).join("\n");
      userContent = `${ctxBlock}\n\nQuestion: ${userContent}`;
    }
    const displayMsg = { role: "user", content: text || "(attached file)", context: (overrideText === undefined && contextSnippets.length > 0) ? [...contextSnippets] : null, attachments: currentAtts.length > 0 ? currentAtts : null };
    // Functional update, NOT a rebuild from tabsRef: a caller can enqueue a
    // send in the same tick as another state change (handleSuggestionApprove
    // dismisses the suggestion bar and then immediately sends the approval).
    // Rebuilding the array from the pre-update snapshot silently reverted that
    // sibling change, so the approved suggestion bar stayed on screen.
    setTabs(prev => prev.map(t => t.id === tabId
      ? { ...t, messages: [...t.messages, displayMsg], loading: true }
      : t));
    if (overrideText === undefined) onClearAllSnippets();

    const controller = new AbortController();
    _cs.tabAborts[tabId] = controller;
    _cs.tabCancelled[tabId] = false;
    // Hoisted so the failure paths below can put the drained observations back.
    let observations = "";
    try {
      let attachmentNote = "";
      if (currentAtts.length > 0) {
        try {
          const uploadRes = await fetch("/upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ files: currentAtts.map(a => ({ name: a.name, type: a.type, data: a.data })) }),
          });
          const uploadData = await uploadRes.json().catch(() => ({}));
          if (uploadData.paths?.length > 0) {
            attachmentNote = "\n\n[Attached files - use Read tool to view them]:\n" + uploadData.paths.map(p => `- ${p}`).join("\n");
          } else {
            // The student sees their thumbnail in the transcript either way, so
            // a silent drop reads as "the tutor is ignoring my screenshot".
            // Say so in-band instead.
            const reason = uploadData.error?.message || `upload returned no paths (HTTP ${uploadRes.status})`;
            attachmentNote = `\n\n[${currentAtts.length} file(s) could NOT be saved for you to read: ${reason}. Tell the student the attachment did not arrive and ask them to retry.]`;
          }
        } catch (uploadErr) {
          attachmentNote = "\n\n[File attachment failed: " + uploadErr.message + "]";
        }
      }
      const topicText = topicContext?.[topicId] || "";
      const activeCtx = buildActiveContext({
        tabId: topicId,
        topicTitle,
        topicText,
        graphParams,
        graphSchema,
        isolated: activeTab?.isolated,
        reinforced: activeTab?.reinforced || [],
        answerStyle: answersRef.current,
      });
      observations = obsQueue.drain(tab.sessionId);
      const tabContext = `${observations}${activeCtx}\n`;
      const messageText = tabContext + userContent + attachmentNote;
      const reqBody = { sessionId: tab.sessionId, message: messageText, model: model, effort: effort };
      const res = await fetch("/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify(reqBody),
      });
      if (!res.ok) {
        let errMsg = `API error (${res.status})`;
        try {
          const errData = await res.json();
          if (errData.error?.message) errMsg = errData.error.message;
        } catch (_) {}
        obsQueue.requeue(tab.sessionId, observations);
        setTabs(prev => prev.map(t => t.id === tabId ? { ...t, messages: [...t.messages, { role: "assistant", content: errMsg }] } : t));
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let sseBuffer = "";
      let finalText = "";
      let doneReceived = false;
      const updateAssistantMsg = (content) => {
        setTabs(prev => prev.map(t => {
          if (t.id !== tabId) return t;
          const msgs = t.messages;
          if (msgs.length > 0 && msgs[msgs.length - 1].role === "assistant" && msgs[msgs.length - 1]._streaming) {
            return { ...t, messages: [...msgs.slice(0, -1), { role: "assistant", content, _streaming: true }] };
          }
          return { ...t, messages: [...msgs, { role: "assistant", content, _streaming: true }] };
        }));
      };
      // eventType lives OUTSIDE the read loop: a network chunk can end between
      // an "event:" line and its "data:" line, and resetting per read would
      // silently drop that event (missing text / missing done depending on
      // where the transport happened to split).
      let eventType = null;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        sseBuffer += decoder.decode(value, { stream: true });
        const lines = sseBuffer.split("\n");
        sseBuffer = lines.pop();
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith("data: ") && eventType) {
            try {
              const data = JSON.parse(line.slice(6));
              if (eventType === "status") {
                if (data.type === "tool") {
                  updateTab(tabId, { statusText: `Using ${data.name}${data.description ? ": " + data.description : ""}...` });
                } else if (data.type === "thinking") {
                  updateTab(tabId, { statusText: "Thinking..." });
                }
              } else if (eventType === "text") {
                updateTab(tabId, { statusText: "" });
                finalText += data.text;
                // Streaming render is display-only: parse WITHOUT callbacks so a
                // completed <<EDIT_GRAPH>> inside the accumulating text is not
                // re-applied on every subsequent chunk. Side effects dispatch
                // exactly once, from the completion pass below.
                updateAssistantMsg(parseChatResponse(stripUnclosedTags(finalText)).display);
              } else if (eventType === "done") {
                finalText = data.text || finalText;
                doneReceived = true;
                updateTab(tabId, { statusText: "" });
              } else if (eventType === "error") {
                // Route the error through finalText so the completion pass
                // below finalises the bubble. Painting it with
                // updateAssistantMsg alone left the message flagged
                // _streaming forever, which permanently disables its
                // reply-block wrapping (and so click-to-context on it).
                finalText = data.message || "Error";
                doneReceived = true;
                updateTab(tabId, { statusText: "" });
              }
            } catch (_) {}
            eventType = null;
          } else if (line === "") {
            eventType = null;
          }
        }
      }
      if (finalText) {
        const reply = processResponse(finalText);
        setTabs(prev => prev.map(t => {
          if (t.id !== tabId) return t;
          const msgs = t.messages;
          // Merge any new reinforced-behavior entries (dedup, cap at 20 most recent).
          const existingReinf = t.reinforced || [];
          const mergedReinf = [...existingReinf];
          for (const r of reply.reinforced || []) {
            if (!mergedReinf.includes(r)) mergedReinf.push(r);
          }
          const cappedReinf = mergedReinf.length > 20 ? mergedReinf.slice(mergedReinf.length - 20) : mergedReinf;
          if (msgs.length > 0 && msgs[msgs.length - 1].role === "assistant" && msgs[msgs.length - 1]._streaming) {
            return { ...t, reinforced: cappedReinf, messages: [...msgs.slice(0, -1), { role: "assistant", content: reply.display, suggestion: reply.suggestion || null, commitSuggest: reply.commitSuggest || null }] };
          }
          return { ...t, reinforced: cappedReinf };
        }));
      }
    } catch (e) {
      let errContent;
      if (e.name === "AbortError") {
        errContent = "[Response cancelled]";
      } else {
        errContent = `Connection error: ${e.message || "unknown"}. Is the proxy server running?`;
      }
      obsQueue.requeue(tab.sessionId, observations);
      setTabs(prev => prev.map(t => {
        if (t.id !== tabId) return t;
        const msgs = t.messages.map(m => m._streaming ? { role: m.role, content: m.content } : m);
        return { ...t, messages: [...msgs, { role: "assistant", content: errContent }] };
      }));
    } finally {
      delete _cs.tabAborts[tabId];
      delete _cs.tabCancelled[tabId];
      updateTab(tabId, { loading: false, statusText: "" });
    }
  };

  // sendMessage is redefined every render and closes over the CURRENT tab,
  // topic, graph params, isolation mode and model. triggerSend is a stable
  // useCallback, so calling sendMessage through it directly froze the very
  // first render's closure: an approved suggestion was sent with the lesson
  // tab, isolation mode and model that were live when the panel first mounted,
  // and its error observations were enqueued against a stale session id.
  // Route through a ref so the stable callback always reaches the live one.
  const sendMessageRef = useRef(null);
  sendMessageRef.current = sendMessage;

  const triggerSend = useCallback(() => {
    const tab = tabsRef.current[activeTabIdxRef.current];
    if (!tab || !_cs.pendingSend[tab.id]) return;
    if (tab.loading) return; // stays parked; the effect below delivers it
    const text = _cs.pendingSend[tab.id];
    delete _cs.pendingSend[tab.id];
    sendMessageRef.current?.(text);
  }, []);

  // Deliver a parked machine send once the in-flight turn finishes.
  useEffect(() => {
    if (!activeTab || activeTab.loading) return;
    const queued = _cs.pendingSend[activeTab.id];
    if (!queued) return;
    delete _cs.pendingSend[activeTab.id];
    sendMessageRef.current?.(queued);
  }, [activeTab?.loading, activeTab?.id]);

  const handleSuggestionApprove = useCallback((msgIdx, placement) => {
    const tab = tabsRef.current[activeTabIdxRef.current];
    if (!tab) return;
    const msg = tab.messages[msgIdx];
    if (!msg?.suggestion) return;
    setTabs(prev => prev.map(t => {
      if (t.id !== tab.id) return t;
      const msgs = t.messages.map((m, i) => i === msgIdx ? { ...m, suggestion: { ...m.suggestion, dismissed: true } } : m);
      return { ...t, messages: msgs };
    }));
    const s = msg.suggestion;
    const followUp = placement === "faq"
      ? `User approved: please add the suggested content to the lesson FAQ. Place it in the FAQ section/tab as a collapsible block with title "${s.title}". Make the edit to ${lessonFile} now.`
      : `User approved: please add the suggested content inline to the lesson. Target section: "${s.section || "relevant section"}". Mode: ${s.mode || "collapsible"}. Title: "${s.title}". Make the edit to ${lessonFile} now.`;
    _cs.pendingSend[tab.id] = followUp;
    triggerSend();
  }, [triggerSend, lessonFile]);

  const handleSuggestionDismiss = useCallback((msgIdx) => {
    const tab = tabsRef.current[activeTabIdxRef.current];
    if (!tab) return;
    const title = tab.messages[msgIdx]?.suggestion?.title;
    setTabs(prev => prev.map(t => {
      if (t.id !== tab.id) return t;
      const msgs = t.messages.map((m, i) => i === msgIdx ? { ...m, suggestion: { ...m.suggestion, dismissed: true } } : m);
      return { ...t, messages: msgs };
    }));
    // Tell the tutor the suggestion was turned down. Without this the
    // rejection is invisible to it and the same addition gets proposed again.
    if (tab.sessionId) {
      obsQueue.enqueue(tab.sessionId, "suggest-rejected", {
        title: title || "(untitled)",
        reason: "The student declined this lesson-augmentation suggestion. Do not re-offer the same addition; if it still matters, address it in the conversation instead.",
      });
    }
  }, []);

  // Commit flow: POST /commit with the bot-drafted message + paths. The
  // proxy runs test_lesson.cjs first and only invokes git if tests pass.
  // On success, replace the chip with an inline confirmation line; on
  // failure, attach an error line. commitInFlight is cleared in both paths
  // so the user can retry after a failure.
  const handleCommit = useCallback(async (msgIdx, commitSuggest) => {
    const tab = tabsRef.current[activeTabIdxRef.current];
    if (!tab || !tab.sessionId) return;
    const inFlightKey = `${tab.id}:${msgIdx}`;
    setCommitInFlight(inFlightKey);
    try {
      const res = await fetch("/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: tab.sessionId,
          message: commitSuggest.message,
          paths: commitSuggest.paths,
        }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        const shaShort = (data.sha || "").slice(0, 8);
        setTabs(prev => prev.map(t => {
          if (t.id !== tab.id) return t;
          const msgs = t.messages.map((m, i) => i === msgIdx
            ? { ...m, commitSuggest: null, commitResult: { ok: true, sha: shaShort, message: commitSuggest.message } }
            : m);
          return { ...t, messages: msgs };
        }));
      } else {
        const errMsg = data.error?.message || `commit failed (${res.status})`;
        setTabs(prev => prev.map(t => {
          if (t.id !== tab.id) return t;
          const msgs = t.messages.map((m, i) => i === msgIdx
            ? { ...m, commitResult: { ok: false, error: errMsg } }
            : m);
          return { ...t, messages: msgs };
        }));
      }
    } catch (e) {
      const errMsg = `connection error: ${e.message || "unknown"}`;
      setTabs(prev => prev.map(t => {
        if (t.id !== tab.id) return t;
        const msgs = t.messages.map((m, i) => i === msgIdx
          ? { ...m, commitResult: { ok: false, error: errMsg } }
          : m);
        return { ...t, messages: msgs };
      }));
    } finally {
      // Always clear in-flight so a failed commit can be retried.
      setCommitInFlight(null);
    }
  }, []);

  const dismissCommit = useCallback((msgIdx) => {
    const tab = tabsRef.current[activeTabIdxRef.current];
    if (!tab) return;
    setTabs(prev => prev.map(t => {
      if (t.id !== tab.id) return t;
      const msgs = t.messages.map((m, i) => i === msgIdx ? { ...m, commitSuggest: null } : m);
      return { ...t, messages: msgs };
    }));
  }, []);

  const openThread = useCallback((tabId, msgIdx, snippet, blockIdx) => {
    if (tabId == null || msgIdx == null) return;
    setTabs(prev => prev.map(t => {
      if (t.id !== tabId) return t;
      const msgs = t.messages.map((m, i) => {
        if (i !== msgIdx) return m;
        if (m.threads?.some(th => th.blockIdx === blockIdx && th.snippet === snippet)) return m;
        const threads = m.threads ? [...m.threads] : [];
        threads.push({ id: `t${++_cs.threadCounter}`, snippet, blockIdx: blockIdx ?? null, messages: [], collapsed: false, loading: false });
        return { ...m, threads };
      });
      return { ...t, messages: msgs };
    }));
  }, []);

  // Threads anchored to LESSON content rather than to a chat reply.
  //
  // Threads hang off a message index, so a selection taken from the lesson has
  // nothing to attach to. Rather than special-casing the whole thread stack, we
  // append a lightweight `anchor` message — a quoted card naming where the
  // snippet came from — and open the thread on it. Every existing mechanism
  // (portal placement, sending, collapse, delete, persistence) then works
  // unchanged, and the transcript records what the student was looking at.
  const openLessonThread = useCallback((snippet, source) => {
    const clean = String(snippet || "").replace(/\s+/g, " ").trim();
    if (clean.length < 3) return;
    const tab = tabsRef.current[activeTabIdxRef.current];
    if (!tab) return;
    setTabs(prev => prev.map(t => {
      if (t.id !== tab.id) return t;
      // Re-open rather than duplicate when the same snippet is already anchored.
      const existing = t.messages.findIndex(m => m.role === "anchor" && m.content === clean);
      if (existing >= 0 && t.messages[existing].threads?.length > 0) {
        const msgs = t.messages.map((m, i) => i === existing
          ? { ...m, threads: m.threads.map((th, j) => j === 0 ? { ...th, collapsed: false } : th) }
          : m);
        return { ...t, messages: msgs };
      }
      const anchor = {
        role: "anchor",
        content: clean,
        source: source || "lesson",
        threads: [{ id: `t${++_cs.threadCounter}`, snippet: clean, blockIdx: null, messages: [], collapsed: false, loading: false }],
      };
      return { ...t, messages: [...t.messages, anchor] };
    }));
  }, []);

  const updateThread = useCallback((tabId, msgIdx, threadId, updates) => {
    setTabs(prev => prev.map(t => {
      if (t.id !== tabId) return t;
      const msgs = t.messages.map((m, i) => {
        if (i !== msgIdx || !m.threads) return m;
        return { ...m, threads: m.threads.map(th => th.id === threadId ? { ...th, ...updates } : th) };
      });
      return { ...t, messages: msgs };
    }));
  }, []);

  const addThreadMsg = useCallback((tabId, msgIdx, threadId, msg) => {
    setTabs(prev => prev.map(t => {
      if (t.id !== tabId) return t;
      const msgs = t.messages.map((m, i) => {
        if (i !== msgIdx || !m.threads) return m;
        return { ...m, threads: m.threads.map(th => th.id === threadId ? { ...th, messages: [...th.messages, msg] } : th) };
      });
      return { ...t, messages: msgs };
    }));
  }, []);

  const deleteThread = useCallback((tabId, msgIdx, threadId) => {
    setTabs(prev => prev.map(t => {
      if (t.id !== tabId) return t;
      const msgs = [...t.messages];
      const m = { ...msgs[msgIdx] };
      m.threads = (m.threads || []).filter(th => th.id !== threadId);
      msgs[msgIdx] = m;
      return { ...t, messages: msgs };
    }));
  }, []);

  // ── Thread focus + context routing ─────────────────────────────────
  // While a thread composer has focus, that thread owns captured context:
  // Ctrl+Click on a lesson block, a drag-selection, or the right-click "Reply"
  // item lands in the thread instead of the main chip bar. The lesson opts in
  // by calling routeLessonContext() (exported from @core) at the top of its own
  // addSnippet; a lesson that never adopts it keeps the old behaviour exactly.
  const [threadCtxInternal, setThreadCtxInternal] = useState(null);
  const focusedThreadRef = useRef(null);

  const setThreadFocus = useCallback((tabId, msgIdx, threadId, focused) => {
    if (focused) {
      focusedThreadRef.current = { tabId, msgIdx, threadId };
      _cs.focusedThread = focusedThreadRef.current;
    } else if (focusedThreadRef.current && focusedThreadRef.current.threadId === threadId) {
      focusedThreadRef.current = null;
      _cs.focusedThread = null;
    }
  }, []);

  const releaseThreadFocus = useCallback(() => {
    focusedThreadRef.current = null;
    _cs.focusedThread = null;
  }, []);

  useEffect(() => {
    _cs.contextSink = (text, source) => {
      const ft = focusedThreadRef.current;
      if (!ft) return false;
      setThreadCtxInternal({ threadId: ft.threadId, text, source: source || "lesson", ts: Date.now() });
      return true;
    };
    return () => { _cs.contextSink = null; _cs.focusedThread = null; };
  }, []);

  // Newest trigger wins between the lesson's ctx-menu / Ctrl+Shift+F (prop)
  // and the context sink (internal).
  const effectiveThreadCtxTrigger =
    ((threadCtxInternal && threadCtxInternal.ts) || 0) >= ((threadCtxTrigger && threadCtxTrigger.ts) || 0)
      ? threadCtxInternal
      : threadCtxTrigger;

  const cancelThread = useCallback((tabId, threadId) => {
    const key = tabId + ":" + threadId;
    const ctrl = _cs.threadAborts[key];
    if (ctrl) { try { ctrl.abort(); } catch (_) {} delete _cs.threadAborts[key]; }
  }, []);

  const sendThreadMessage = async (tabId, msgIdx, threadId, snippet, text, context, atts) => {
    const tab = tabsRef.current.find(t => t.id === tabId);
    if (!tab || !tab.sessionId) return;

    const currentAtts = Array.isArray(atts) ? atts : [];
    addThreadMsg(tabId, msgIdx, threadId, {
      role: "user",
      content: text || "(attached file)",
      context: context && context.length > 0 ? [...context] : null,
      attachments: currentAtts.length > 0 ? currentAtts : null,
    });
    updateThread(tabId, msgIdx, threadId, { loading: true });

    let apiText = text || "(attached file)";
    if (context && context.length > 0) {
      const ctxBlock = context.map((s, i) => `[Context ${i + 1} -- ${s.source}]: ${s.text}`).join("\n");
      apiText = `${ctxBlock}\n\nQuestion: ${apiText}`;
    }
    if (currentAtts.length > 0) {
      try {
        const uploadRes = await fetch("/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ files: currentAtts.map(a => ({ name: a.name, type: a.type, data: a.data })) }),
        });
        const uploadData = await uploadRes.json().catch(() => ({}));
        if (uploadData.paths?.length > 0) {
          apiText += "\n\n[Attached files - use Read tool to view them]:\n" + uploadData.paths.map(p => `- ${p}`).join("\n");
        } else {
          const reason = uploadData.error?.message || `upload returned no paths (HTTP ${uploadRes.status})`;
          apiText += `\n\n[${currentAtts.length} file(s) could NOT be saved for you to read: ${reason}. Tell the student the attachment did not arrive and ask them to retry.]`;
        }
      } catch (uploadErr) {
        apiText += "\n\n[File attachment failed: " + uploadErr.message + "]";
      }
    }
    const topicText = topicContext?.[topicId] || "";
    const activeCtx = buildActiveContext({
      tabId: topicId,
      topicTitle,
      topicText,
      graphParams,
      graphSchema,
      isolated: tab.isolated,
      // Threads run in the same session as the main transcript, so the
      // student's accumulated preferences must govern thread replies too.
      reinforced: tab.reinforced || [],
      answerStyle: answersRef.current,
    });
    let observations = obsQueue.drain(tab.sessionId);
    const tagged = `[THREAD:${threadId} | "${snippet.slice(0, 60)}"]\n\n${observations}${activeCtx}\n${apiText}`;
    _cs.activeThread[tabId] = { msgIdx, threadId };

    const controller = new AbortController();
    _cs.threadAborts[tabId + ':' + threadId] = controller;

    try {
      const res = await fetch("/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ sessionId: tab.sessionId, message: tagged, model, effort }),
      });
      if (!res.ok) {
        obsQueue.requeue(tab.sessionId, observations);
        addThreadMsg(tabId, msgIdx, threadId, { role: "assistant", content: `Error ${res.status}` });
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let sseBuffer = "";
      let finalText = "";

      const updateThreadAssistant = (content) => {
        setTabs(prev => prev.map(t => {
          if (t.id !== tabId) return t;
          return {
            ...t,
            messages: t.messages.map((m, i) => {
              if (i !== msgIdx || !m.threads) return m;
              return {
                ...m,
                threads: m.threads.map(th => {
                  if (th.id !== threadId) return th;
                  const tmsgs = th.messages;
                  if (tmsgs.length > 0 && tmsgs[tmsgs.length - 1].role === "assistant" && tmsgs[tmsgs.length - 1]._streaming) {
                    return { ...th, messages: [...tmsgs.slice(0, -1), { role: "assistant", content, _streaming: true }] };
                  }
                  return { ...th, messages: [...tmsgs, { role: "assistant", content, _streaming: true }] };
                }),
              };
            }),
          };
        }));
      };

      // Same chunk-boundary rule as the main SSE loop: eventType persists
      // across reads or events split across chunks get dropped.
      let eventType = null;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        sseBuffer += decoder.decode(value, { stream: true });
        const lines = sseBuffer.split("\n");
        sseBuffer = lines.pop();
        for (const line of lines) {
          if (line.startsWith("event: ")) { eventType = line.slice(7).trim(); }
          else if (line.startsWith("data: ") && eventType) {
            try {
              const data = JSON.parse(line.slice(6));
              if (eventType === "text") {
                finalText += data.text;
                // Display-only parse (no callbacks): keeps partial tags from
                // flashing mid-stream. Side effects run once at completion.
                const display = parseChatResponse(
                  stripUnclosedTags(finalText.replace(/^\[THREAD:[^\]]+\]\s*/i, "")),
                  { scope: "thread" },
                ).display;
                updateThreadAssistant(display);
              } else if (eventType === "done") {
                finalText = data.text || finalText;
              }
            } catch (_) {}
            eventType = null;
          }
        }
      }
      if (finalText) {
        // Thread scope: display-only tags (<<DEMO>>, <<DESMOS>>, <<SOURCES>>)
        // render here and <<REINFORCE>> still counts, but the three
        // state-mutating tags are stripped and reported back as observations —
        // their approval UI only exists on main-transcript messages.
        const reply = parseChatResponse(
          finalText.replace(/^\[THREAD:[^\]]+\]\s*/i, ""),
          {
            scope: "thread",
            onError: (type, details) => {
              if (tab.sessionId) obsQueue.enqueue(tab.sessionId, type, details);
            },
          },
        );
        const display = reply.display;
        setTabs(prev => prev.map(t => {
          if (t.id !== tabId) return t;
          const existingReinf = t.reinforced || [];
          const mergedReinf = [...existingReinf];
          for (const r of reply.reinforced || []) {
            if (!mergedReinf.includes(r)) mergedReinf.push(r);
          }
          const cappedReinf = mergedReinf.length > 20 ? mergedReinf.slice(mergedReinf.length - 20) : mergedReinf;
          return {
            ...t,
            reinforced: cappedReinf,
            messages: t.messages.map((m, i) => {
              if (i !== msgIdx || !m.threads) return m;
              return {
                ...m,
                threads: m.threads.map(th => {
                  if (th.id !== threadId) return th;
                  const tmsgs = th.messages;
                  const finalized = tmsgs.length > 0 && tmsgs[tmsgs.length - 1]._streaming
                    ? [...tmsgs.slice(0, -1), { role: "assistant", content: display }]
                    : [...tmsgs, { role: "assistant", content: display }];
                  return { ...th, messages: finalized };
                }),
              };
            }),
          };
        }));
      }
    } catch (e) {
      const errMsg = e.name === "AbortError" ? "[Cancelled]" : `Error: ${e.message}`;
      obsQueue.requeue(tab.sessionId, observations);
      // Drop the half-streamed placeholder before appending the outcome, or a
      // cancelled thread keeps a permanently "streaming" bubble.
      setTabs(prev => prev.map(t => {
        if (t.id !== tabId) return t;
        return {
          ...t,
          messages: t.messages.map((m, i) => {
            if (i !== msgIdx || !m.threads) return m;
            return {
              ...m,
              threads: m.threads.map(th => th.id === threadId
                ? { ...th, messages: th.messages.filter(tm => !tm._streaming) }
                : th),
            };
          }),
        };
      }));
      addThreadMsg(tabId, msgIdx, threadId, { role: "assistant", content: errMsg });
    } finally {
      delete _cs.activeThread[tabId];
      delete _cs.threadAborts[tabId + ':' + threadId];
      updateThread(tabId, msgIdx, threadId, { loading: false });
    }
  };

  // threadTrigger with a msgIdx anchors to that chat reply; without one it
  // came from the lesson body, so it opens a lesson-anchored thread instead.
  useEffect(() => {
    if (!threadTrigger || !threadTrigger.text) return;
    if (threadTrigger.msgIdx == null) {
      openLessonThread(threadTrigger.text, threadTrigger.source || "lesson");
      return;
    }
    const tab = tabsRef.current[activeTabIdxRef.current];
    if (tab) openThread(tab.id, threadTrigger.msgIdx, threadTrigger.text, threadTrigger.blockIdx);
  }, [threadTrigger]);

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  // Portal containers for inline thread rendering
  const [threadPortals, setThreadPortals] = useState([]);

  useEffect(() => {
    const currentMsgs = tabsRef.current[activeTabIdxRef.current]?.messages || [];
    const portals = [];
    currentMsgs.forEach((m, i) => {
      // Assistant replies AND lesson anchors can carry threads.
      if (!m.threads || m.threads.length === 0) return;
      const msgEl = document.querySelector(`.chat-msg[data-msg-idx="${i}"]`);
      if (!msgEl) return;
      const bubble = msgEl.querySelector('.chat-msg-rendered');
      if (!bubble) return;
      m.threads.forEach(thread => {
        const containerId = `thread-ctr-${thread.id}`;
        let container = document.getElementById(containerId);
        if (!container) {
          container = document.createElement('div');
          container.id = containerId;
          container.className = 'thread-portal-slot';
          const blocks = bubble.querySelectorAll('[data-chat-block]');
          const targetBlock = thread.blockIdx != null && blocks[thread.blockIdx] ? blocks[thread.blockIdx] : null;
          if (targetBlock) targetBlock.after(container);
          else bubble.appendChild(container);
        }
        portals.push({ threadId: thread.id, msgIdx: i, el: container });
      });
    });
    setThreadPortals(portals);
  }, [activeTab?.messages]);

  const messages = activeTab ? activeTab.messages : [];
  const loading = activeTab ? activeTab.loading : false;
  const statusText = activeTab ? activeTab.statusText || "" : "";
  const sessionId = activeTab ? activeTab.sessionId : null;
  const chatNum = activeTab ? activeTab.chatNum : null;
  const sessionStatus = activeTab ? activeTab.sessionStatus : "idle";
  const keepContext = activeTab ? activeTab.keepContext : false;
  const isolated = activeTab ? activeTab.isolated : true;

  // Placement: LessonShell owns it when present. "float" is the standalone
  // fallback — the old fixed-position panel with its own resize handles.
  const dock = shell ? shell.dock : "float";
  const panelStyle = shell
    ? shell.panelStyle
    : (chatSize ? { width: chatSize.w, height: chatSize.h } : undefined);
  const closePanel = () => (shell ? shell.closeChat() : setOpen(false));
  const answerLabel = (ANSWER_STYLES.find(a => a.id === answers) || {}).label || answers;
  const modelLabel = (MODELS.find(m => m.model === model) || {}).label || model;
  const statusColor = sessionStatus === "ready" ? "var(--accent)"
    : sessionStatus === "loading" ? "var(--ink-4)" : "var(--danger)";

  return (
    <>
      {/* The round toggle only exists without a shell; with one, the top bar's
          Tutor button is the affordance. */}
      {!shell && !open && !import.meta.env.PROD && <button className="chat-toggle" onClick={() => setOpen(true)} title="Open the tutor">
        {"?"}
        {contextSnippets.length > 0 && <span className="chat-badge">{contextSnippets.length}</span>}
      </button>}
      {/* PROD gate: the static deploy has no proxy, so the whole panel is
          withheld (not just the toggle button) — otherwise Ctrl+/ in a lesson
          could open a chat that can only ever error. */}
      {!import.meta.env.PROD && <div
          className={`chat-panel chat-panel-${dock} ${dock === "float" && expanded ? "chat-panel-expanded" : ""} ${dragOver ? "chat-panel-dragover" : ""}`}
          style={{ ...(panelStyle || {}), ...(!open ? { display: "none" } : {}) }}
          onDragOver={(e) => { if (e.dataTransfer?.types?.includes("Files")) { e.preventDefault(); setDragOver(true); } }}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false); }}
          onDrop={(e) => {
            if (!e.dataTransfer?.files?.length) return;
            e.preventDefault();
            setDragOver(false);
            handleFiles(e.dataTransfer.files);
          }}
        >
          {dock === "float" && (
            <>
              <div className="chat-resize-l" onMouseDown={e => startResize(e, "l")} />
              <div className="chat-resize-t" onMouseDown={e => startResize(e, "t")} />
              <div className="chat-resize-tl" onMouseDown={e => startResize(e, "tl")} />
            </>
          )}
          {dock === "window" && (
            <div className="chat-window-bar" onPointerDown={shell.onWindowDrag}>
              <span className="chat-window-title">{topicTitle ? `Tutor — ${topicTitle}` : "Tutor"}</span>
              <button className="chat-icon-btn" onClick={closePanel} title="Close"><IconClose /></button>
            </div>
          )}
          {shell && shell.blocked && (
            <div className="chat-blocked-note">Pop-ups blocked — shown in-app</div>
          )}

          {/* Tab strip. Each tab owns its own session, transcript, threads and
              attachments; switching tabs swaps all of them. */}
          <div className="chat-tabs">
            {tabs.map((tab, idx) => (
              <div key={tab.id}
                   className={`chat-tab ${idx === activeTabIdx ? "active" : ""}`}
                   onClick={() => setActiveTabIdx(idx)}
                   role="button" tabIndex={0}
                   onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setActiveTabIdx(idx); }}>
                <span className="chat-tab-label">
                  {tab.title || (tab.chatNum ? `Chat ${tab.chatNum}` : "New chat")}
                </span>
                {tabs.length > 1 && (
                  <span className="chat-tab-x" title="Close tab"
                        onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}>{"×"}</span>
                )}
              </div>
            ))}
            <button className="chat-tab-add" onClick={addTab} title="New conversation">+</button>
          </div>

          <div className="chat-header">
            <div className="chat-header-titles">
              <div className="chat-header-title">Tutor</div>
              <div className="chat-header-topic">
                <span className="chat-header-dot" style={{ background: statusColor }}
                      title={sessionId ? `Session ${sessionId.slice(0, 8)} — ${sessionStatus}` : sessionStatus} />
                <span>{topicTitle}</span>
              </div>
            </div>
            <div className="chat-header-actions">
              {shell && (
                <div className="chat-dock-switch">
                  <button className={`chat-dock-btn ${dock === "side" ? "active" : ""}`}
                          onClick={() => shell.setDock("side")} title="Dock to the side"><IconDockSide /></button>
                  <button className={`chat-dock-btn ${dock === "bottom" ? "active" : ""}`}
                          onClick={() => shell.setDock("bottom")} title="Dock to the bottom"><IconDockBottom /></button>
                  <button className={`chat-dock-btn ${dock === "window" || dock === "popup" ? "active" : ""}`}
                          onClick={shell.openPopup} title="Open in its own window"><IconExternal /></button>
                </div>
              )}
              <button className={`chat-icon-btn ${showSettings ? "active" : ""}`}
                      onClick={() => setShowSettings(s => !s)} title="Settings"><IconSettings /></button>
              <button className="chat-icon-btn" onClick={() => setShowHelp(h => !h)}
                      title="Shortcuts and gestures (Ctrl+Shift+?)">?</button>
              {dock !== "popup" && dock !== "window" && (
                <button className="chat-icon-btn" onClick={closePanel} title="Close the tutor"><IconClose /></button>
              )}
            </div>
          </div>

          {showSettings && (
            <div className="chat-settings">
              <div>
                <div className="chat-setting-label">Model</div>
                <div className="chat-segmented">
                  {MODELS.map(m => (
                    <button key={m.model}
                            className={`chat-segment ${model === m.model ? "active" : ""}`}
                            onClick={() => setModel(m.model)}>{m.label}</button>
                  ))}
                </div>
              </div>
              <div>
                <div className="chat-setting-label">Reasoning effort</div>
                <div className="chat-segmented">
                  {EFFORT_LEVELS.map(lv => (
                    <button key={lv}
                            className={`chat-segment ${effort === lv ? "active" : ""}`}
                            onClick={() => setEffort(lv)}>{lv}</button>
                  ))}
                </div>
              </div>
              <div>
                <div className="chat-setting-label">Answer style</div>
                <div className="chat-segmented">
                  {ANSWER_STYLES.map(a => (
                    <button key={a.id}
                            className={`chat-segment ${answers === a.id ? "active" : ""}`}
                            onClick={() => setAnswers(a.id)}>{a.label}</button>
                  ))}
                </div>
                <div className="chat-setting-help">
                  Hints first withholds the answer until you have tried a step.
                </div>
              </div>
              {/* Session lifecycle. Not student-facing chrome, so it lives
                  behind the popover instead of in the header — but the skill's
                  isolation / keep-context / kill controls stay reachable. */}
              <div>
                <div className="chat-setting-label">Session</div>
                <div className="chat-segmented">
                  <button className={`chat-segment ${!isolated ? "active" : ""}`}
                          onClick={transferSession} disabled={sessionStatus !== "ready"}
                          title={isolated ? "Isolated: no shared memory. Switch to use memory/CLAUDE.md" : "Shared: uses global Claude memory + CLAUDE.md. Switch to isolate"}>
                    {isolated ? "Isolated" : "Shared memory"}
                  </button>
                  <button className={`chat-segment ${keepContext ? "active" : ""}`}
                          onClick={() => { if (!activeTab) return; updateTab(activeTab.id, { keepContext: !activeTab.keepContext }); _ss.setItem("keepContext", (!activeTab.keepContext) ? "true" : "false"); }}
                          title={keepContext ? "Session survives reload" : "New session on reload"}>
                    Keep on reload
                  </button>
                  <button className="chat-segment" onClick={killSession}
                          title="End the session and stop all processes"
                          style={{ color: "var(--danger)" }}>End session</button>
                </div>
              </div>
            </div>
          )}
          {showHelp && (
            <div className="chat-help-overlay">
              <button className="chat-help-close" onClick={() => setShowHelp(false)}>close</button>
              <h4>Shortcuts and gestures</h4>
              {HELP_GROUPS.map(g => (
                <div className="chat-help-group" key={g.title}>
                  <div className="chat-help-group-title">{g.title}</div>
                  {g.rows.map(([k, d]) => (
                    <div className="chat-help-row" key={k}>
                      <span className="chat-help-key">{k}</span>
                      <span>{d}</span>
                    </div>
                  ))}
                </div>
              ))}
              <div className="chat-help-group">
                <div className="chat-help-group-title">Models</div>
                {MODELS.map(m => (
                  <div className="chat-help-row" key={m.model}>
                    <span className="chat-help-key">{`Ctrl+Shift+${String(m.key || "").toUpperCase()}`}</span>
                    <span>{m.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="chat-messages" ref={scrollRef}>
            {messages.length === 0 && sessionStatus === "picking" && (
              <div className="chat-empty">
                <div style={{ marginBottom: 8 }}>Available sessions. Pick one or create new:</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "center" }}>
                  {serverSessions.filter(s => !s.open && !tabs.some(t => t.sessionId === s.id)).map(s => (
                    <button key={s.id} onClick={() => { if (activeTab) resumeSessionIntoTab(activeTab.id, s.id, s.chatNum); }} style={{ background: "var(--bg-eq)", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 10px", color: "var(--accent)", cursor: "pointer", fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 }}>
                      {"Chat #"}{s.chatNum} ({s.messageCount} msgs) {s.isolated ? "ISO" : "MEM"}
                    </button>
                  ))}
                  <button onClick={() => { if (activeTab) createSessionForTab(activeTab.id); }} style={{ background: "var(--accent)", border: "none", borderRadius: 6, padding: "6px 10px", color: "var(--bg-main)", cursor: "pointer", fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, fontWeight: 600 }}>
                    + New
                  </button>
                </div>
              </div>
            )}
            {messages.length === 0 && sessionStatus !== "picking" && (
              <div className="chat-empty">
                {sessionStatus === "loading" && "Initializing Claude session..."}
                {sessionStatus === "ready" && "Session active. Ask about this topic. Click or highlight content to attach as context."}
                {sessionStatus === "error" && "Session failed to initialize. Is the proxy server running? Try refreshing."}
                {sessionStatus === "idle" && "Starting session..."}
              </div>
            )}
            {messages.map((m, i) => m.role === "anchor" ? (
              // Lesson anchor: the quoted lesson snippet a thread hangs off.
              // Not a turn in the conversation — nothing is sent for it — it
              // just records what the student was looking at and gives the
              // thread portal something to attach to.
              <div key={i} className="chat-msg chat-msg-anchor" data-msg-idx={i}>
                <div className="chat-anchor-card">
                  <span className="chat-anchor-label">{`from the lesson — ${m.source || "lesson"}`}</span>
                  <div className="chat-msg-rendered chat-anchor-body">{m.content}</div>
                </div>
              </div>
            ) : (
              <div key={i} className={`chat-msg chat-msg-${m.role}`} data-msg-idx={i}>
                {m.role === "user" && m.context && (
                  <div className="chat-msg-ctx-list">
                    {m.context.map((s, j) => (
                      <div key={j} className="chat-msg-ctx-chip-sent">{"+ "}{s.text.length > 60 ? s.text.slice(0, 60) + "\u2026" : s.text}</div>
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
                <ChatBubble text={m.content} role={m.role} onReplyBlock={addSnippet} streaming={!!m._streaming} />
                {m.suggestion && !m.suggestion.dismissed && (
                  <div className="suggestion-bar">
                    <span className="suggestion-label">Add this to the lesson?</span>
                    <button className="suggestion-btn s-btn-lesson" onClick={() => handleSuggestionApprove(i, 'lesson')}>Add to lesson</button>
                    <button className="suggestion-btn s-btn-faq" onClick={() => handleSuggestionApprove(i, 'faq')}>Add to FAQ</button>
                    <button className="suggestion-btn s-btn-no" onClick={() => handleSuggestionDismiss(i)}>No</button>
                  </div>
                )}
                {m.commitSuggest && (
                  <div className="commit-chip">
                    <span className="commit-chip-label">Ready to commit:</span>
                    <code className="commit-chip-msg">{m.commitSuggest.message}</code>
                    <button
                      className="commit-chip-btn"
                      onClick={() => handleCommit(i, m.commitSuggest)}
                      disabled={commitInFlight === `${activeTab?.id}:${i}`}
                    >
                      {commitInFlight === `${activeTab?.id}:${i}` ? "Committing..." : "Commit & push"}
                    </button>
                    <button className="commit-chip-btn-dismiss" onClick={() => dismissCommit(i)}>
                      Dismiss
                    </button>
                  </div>
                )}
                {m.commitResult && (
                  <div className={`commit-chip commit-chip-${m.commitResult.ok ? "ok" : "err"}`}>
                    <span className="commit-chip-label">
                      {m.commitResult.ok ? `Committed ${m.commitResult.sha}` : "Commit failed"}
                    </span>
                    {m.commitResult.ok
                      ? <code className="commit-chip-msg">{m.commitResult.message}</code>
                      : <code className="commit-chip-msg">{m.commitResult.error}</code>}
                  </div>
                )}
              </div>
            ))}
            {/* KILL (and a failed init) leave the tab with no session but a
                full transcript. The empty-state picker only renders at zero
                messages, so without this the tab is permanently dead: the
                composer accepts text and sendMessage returns silently. */}
            {!sessionId && messages.length > 0 && (sessionStatus === "idle" || sessionStatus === "error") && (
              <div className="chat-dead-session">
                <span>No active session. Starting a new one clears this transcript.</span>
                <button onClick={() => { if (activeTab) createSessionForTab(activeTab.id); }}>New session</button>
              </div>
            )}
            {loading && (
              <div className="chat-msg chat-msg-assistant">
                <div className="chat-msg-bubble chat-loading"><span /><span /><span /></div>
              </div>
            )}
            {statusText && (
              <div className="chat-status">{statusText}</div>
            )}
          </div>
          {threadPortals.map(({ threadId, msgIdx, el }) => {
            const msg = messages[msgIdx];
            const thread = msg?.threads?.find(t => t.id === threadId);
            if (!thread || !el) return null;
            return createPortal(
              <ThreadPanel
                key={threadId}
                thread={thread}
                onToggleCollapse={() => updateThread(activeTab.id, msgIdx, threadId, { collapsed: !thread.collapsed })}
                onSend={(text, ctx, atts) => sendThreadMessage(activeTab.id, msgIdx, threadId, thread.snippet, text, ctx, atts)}
                onCancel={() => cancelThread(activeTab.id, threadId)}
                onDelete={() => deleteThread(activeTab.id, msgIdx, threadId)}
                onFocusChange={(focused) => setThreadFocus(activeTab.id, msgIdx, threadId, focused)}
                onReadFiles={readFiles}
                contextTrigger={effectiveThreadCtxTrigger}
              />,
              el
            );
          })}
          <div className="chat-composer">
            {attachments.length > 0 && (
              <div className="chat-att-bar">
                {attachments.map((a, i) => (
                  <div key={i} className="chat-att-preview">
                    {a.thumb ? <img src={a.thumb} className="chat-att-thumb" alt={a.name} /> : <span className="chat-att-fname">{a.name}</span>}
                    <button className="chat-att-rm" onClick={() => removeAttachment(i)}>{"✕"}</button>
                  </div>
                ))}
              </div>
            )}
            {contextSnippets.length > 0 && (
              <div className="chat-ctx-bar">
                {contextSnippets.map((s, i) => (
                  <div key={i} className="chat-ctx-chip">
                    <span className="chat-ctx-chip-text">{s.text.length > 40 ? s.text.slice(0, 40) + "…" : s.text}</span>
                    <button className="chat-ctx-chip-x" onClick={() => onClearSnippet(i)} title="Remove">{"×"}</button>
                  </div>
                ))}
              </div>
            )}
            {/* Current settings, and the second way into the popover. */}
            <div className="chat-settings-chip">
              <span className="chat-settings-chip-text">{modelLabel + " · " + effort + " · " + answerLabel}</span>
              <button className="chat-settings-change" onClick={() => setShowSettings(s => !s)}>Change</button>
            </div>
            <div className="chat-input-row">
              {/* Snapshot the FileList BEFORE resetting value: the reset empties
                  the live list, and handleFiles is async, so only the first file
                  survived a multi-file pick. */}
              <input type="file" ref={fileRef} style={{ display: "none" }} accept="image/*,.pdf" multiple
                onChange={e => { const picked = Array.from(e.target.files || []); e.target.value = ""; if (picked.length) handleFiles(picked); }} />
              <button className="chat-attach-btn" onClick={() => fileRef.current.click()} title="Attach image or PDF">+</button>
              <textarea ref={inputRef} className="chat-input" value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown} onPaste={handlePaste}
                onFocus={releaseThreadFocus}
                placeholder={attachments.length > 0 ? "Describe what you attached" : contextSnippets.length > 0 ? "Ask about the attached context" : "Ask about this topic"} rows={1} />
              {loading
                ? <button className="chat-stop" onClick={cancelRequest} title="Stop generating">{"■"}</button>
                : <button className="chat-send" onClick={() => sendMessage()} disabled={!input.trim() && attachments.length === 0} title="Send"><IconArrowRight /></button>
              }
            </div>
          </div>
          {dock === "window" && <div className="chat-window-grip" onPointerDown={shell.onWindowResize} />}
        </div>
      }
    </>
  );
}
