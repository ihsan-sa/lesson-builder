import { useEffect, useRef, useCallback } from "react";
import { useDesmos } from "../hooks/useDesmos.js";
import { b64decodeUtf8 } from "./processResponse.js";
import { renderChatHtml } from "./chatMarkdown.js";
import { renderSafeHtmlInto } from "./safeRender.js";

// Replace an element's children with one div carrying fixed, non-model text.
function setOnlyChild(el, className, text) {
  const d = el.ownerDocument.createElement("div");
  d.className = className;
  d.textContent = text;
  el.replaceChildren(d);
  return d;
}

// Strip machine-generated preamble blocks from the visible student bubble.
// The stdin to the CLI is prefixed with any queued [OBSERVATION]...[/OBSERVATION]
// blocks and a single [ACTIVE CONTEXT]...[/ACTIVE CONTEXT] block; these are
// bookkeeping for the model, not things the student actually typed, so they
// must not appear in the rendered chat history. Only strips from the start of
// the string, so a student who literally types "[OBSERVATION]" mid-message
// keeps their text intact.
// Model output (prose, <<DEMO>> SVG, raw <svg>/<img>/<video>, <<SOURCES>>) is
// mounted through safeRender.js: regex pre-filter (stripActiveContent, kept)
// then DOMParser -> allowlist walk -> fresh nodes. Nothing in this file assigns
// innerHTML; the markdown/KaTeX string pipeline lives in chatMarkdown.js.
function stripObservationPrefix(text) {
  if (typeof text !== 'string') return text;
  return text
    .replace(/^(\[OBSERVATION[\s\S]*?\[\/OBSERVATION\]\s*)+/g, '')
    .replace(/^(\[ACTIVE CONTEXT\][\s\S]*?\[\/ACTIVE CONTEXT\]\s*)/, '');
}

// Renders a single chat message (user or assistant). For assistant messages,
// builds the HTML string via chatMarkdown.js (special blocks, LaTeX, KaTeX,
// markdown) and mounts it via safeRender.js. Then (second useEffect, only when
// not streaming) wraps inline content in data-chat-block paragraph containers
// so any block in the reply can be clicked to attach as context.
export function ChatBubble({ text, role, onReplyBlock, streaming }) {
  const ref = useRef(null);
  const replyRef = useRef(onReplyBlock);
  replyRef.current = onReplyBlock;
  // Gate CDN load on this bubble actually needing Desmos. Avoids the ~1.3MB
  // Desmos bundle leaking into every lesson the moment the chat panel opens.
  const needsDesmos = role === "assistant" && typeof text === "string" && text.indexOf("chat-desmos-block") >= 0;
  const { ready: desmosReady, keyMissing: desmosKeyMissing } = useDesmos({ enabled: needsDesmos });
  // Tracks live calculator instances by their host element so we can destroy
  // orphans before innerHTML rewrites blow away their DOM hosts (third effect
  // only cleans up on the NEXT render pass, leaving a detached live canvas
  // running in between otherwise).
  const desmosInstancesRef = useRef(new Map());

  useEffect(() => {
    if (!ref.current || role !== "assistant") return;
    // About to replace the children below, which detaches every previously
    // mounted Desmos host. Destroy live calcs first so their WebGL /
    // observer resources don't leak into the void between here and the
    // next run of the third effect.
    if (desmosInstancesRef.current.size > 0) {
      for (const [, calc] of desmosInstancesRef.current) {
        try { calc.destroy(); } catch (_) {}
      }
      desmosInstancesRef.current.clear();
    }
    renderSafeHtmlInto(ref.current, renderChatHtml(text, { katex: window.katex }));
  }, [text, role, streaming]);

  useEffect(() => {
    if (!ref.current || role !== "assistant" || streaming || !replyRef.current) return;
    const container = ref.current;
    const blockSel = '.chat-eq-block, .chat-pre, .chat-h, h3, h4, .chat-ul, .chat-ol, table, hr';
    container.querySelectorAll(blockSel).forEach(el => el.setAttribute('data-chat-block', ''));
    const nodes = Array.from(container.childNodes);
    const isBlock = (n) => n.nodeType === 1 && n.hasAttribute('data-chat-block');
    const isBr = (n) => n.nodeType === 1 && n.nodeName === 'BR';
    const groups = [];
    let run = [];
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (isBlock(n)) {
        if (run.length > 0) { groups.push({ type: 'i', nodes: run }); run = []; }
        groups.push({ type: 'b', node: n });
      } else if (isBr(n) && i + 1 < nodes.length && isBr(nodes[i + 1])) {
        run.push(n);
        groups.push({ type: 'i', nodes: run }); run = [];
        i++;
      } else {
        run.push(n);
      }
    }
    if (run.length > 0) groups.push({ type: 'i', nodes: run });
    while (container.firstChild) container.removeChild(container.firstChild);
    for (const g of groups) {
      if (g.type === 'b') { container.appendChild(g.node); continue; }
      const txt = g.nodes.map(n => n.textContent).join('').trim();
      if (txt.length > 2) {
        const w = document.createElement('div');
        w.setAttribute('data-chat-block', '');
        w.className = 'chat-reply-block';
        g.nodes.forEach(n => w.appendChild(n));
        container.appendChild(w);
      } else {
        g.nodes.forEach(n => container.appendChild(n));
      }
    }
  }, [text, role, streaming]);

  // Desmos mount / destroy. Gated on !streaming so we don't instantiate a
  // ~1MB calculator per streaming token; the empty placeholder div shows the
  // loading state until the stream settles. Declared after the reply-block
  // wrap effect so the DOM has stopped mutating by the time we mount.
  useEffect(() => {
    if (role !== "assistant" || streaming || !ref.current) return;
    const container = ref.current;
    const blocks = container.querySelectorAll('.chat-desmos-block');
    const seen = new Set();
    const needsReady = blocks.length > 0;
    if (needsReady && desmosKeyMissing) {
      blocks.forEach(el => {
        if (el.childElementCount === 0) {
          setOnlyChild(el, 'chat-desmos-error', 'Desmos graph unavailable: VITE_DESMOS_KEY not configured.');
        }
      });
      return;
    }
    if (needsReady && !desmosReady) return; // script still loading; rerun when desmosReady flips
    blocks.forEach(el => {
      seen.add(el);
      if (desmosInstancesRef.current.has(el)) return;
      let stateJson;
      try {
        stateJson = JSON.parse(b64decodeUtf8(el.dataset.desmosState));
      } catch (e) {
        setOnlyChild(el, 'chat-desmos-error', 'Desmos state decode failed');
        return;
      }
      const host = setOnlyChild(el, 'chat-desmos-host', '');
      let calc;
      try {
        calc = window.Desmos.GraphingCalculator(host, {
          expressionsCollapsed: true,
          settingsMenu: false,
          border: false,
          keypad: false,
        });
        calc.setState(stateJson);
      } catch (e) {
        setOnlyChild(el, 'chat-desmos-error', 'Desmos render failed');
        return;
      }
      // Slider animation uses Desmos' native per-slider Play button inside the
      // expression panel. No overlay control; autoplay is stripped upstream
      // (processResponse.js) so only the student starts an animation.
      desmosInstancesRef.current.set(el, calc);
    });
    // Destroy orphans whose host element left the DOM.
    for (const [el, calc] of desmosInstancesRef.current) {
      if (!seen.has(el) || !container.contains(el)) {
        try { calc.destroy(); } catch (_) {}
        desmosInstancesRef.current.delete(el);
      }
    }
  }, [text, role, streaming, desmosReady, desmosKeyMissing]);

  // Full unmount cleanup: destroy every tracked calculator so canvas /
  // observer leaks don't outlive the bubble.
  useEffect(() => () => {
    for (const [, calc] of desmosInstancesRef.current) {
      try { calc.destroy(); } catch (_) {}
    }
    desmosInstancesRef.current.clear();
  }, []);

  // Debounced calc.resize() when the bubble host resizes (chat panel drag).
  useEffect(() => {
    if (role !== "assistant" || !ref.current) return;
    let t = null;
    const ro = new ResizeObserver(() => {
      clearTimeout(t);
      t = setTimeout(() => {
        for (const [, calc] of desmosInstancesRef.current) {
          try { calc.resize(); } catch (_) {}
        }
      }, 120);
    });
    ro.observe(ref.current);
    return () => { clearTimeout(t); ro.disconnect(); };
  }, [role]);

  const handleBlockClick = useCallback((e) => {
    // Ctrl is the opt-in gesture for adding a reply block to chat context;
    // plain clicks (e.g. selecting text, clicking links) must pass through.
    if (!e.ctrlKey) return;
    if (!replyRef.current) return;
    const sel = window.getSelection();
    if (sel && sel.toString().trim().length > 0) return;
    const block = e.target.closest('[data-chat-block]');
    if (!block) return;
    const cl = block.cloneNode(true); cl.querySelectorAll('.katex-mathml').forEach(m => m.remove());
    const blockText = (block.dataset.latex || cl.textContent).trim();
    if (blockText.length < 3) return;
    let source = "chat reply";
    if (block.classList.contains('chat-eq-block')) source = "chat equation";
    else if (block.classList.contains('chat-pre')) source = "chat code";
    else if (block.classList.contains('chat-h') || block.nodeName === 'H3' || block.nodeName === 'H4') source = "chat heading";
    else if (block.classList.contains('chat-ul') || block.classList.contains('chat-ol')) source = "chat list";
    else if (block.nodeName === 'TABLE') source = "chat table";
    else source = "chat paragraph";
    replyRef.current(blockText, source);
    block.classList.remove('ctx-flash');
    void block.offsetWidth;
    block.classList.add('ctx-flash');
    setTimeout(() => block.classList.remove('ctx-flash'), 600);
  }, []);

  if (role === "assistant") return <div className="chat-msg-bubble chat-msg-rendered" ref={ref} onClick={handleBlockClick} />;
  return <div className="chat-msg-bubble">{stripObservationPrefix(text)}</div>;
}
