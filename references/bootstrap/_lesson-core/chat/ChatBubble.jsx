import { useEffect, useRef, useCallback } from "react";
import { useDesmos } from "../hooks/useDesmos.js";
import { b64decodeUtf8 } from "./processResponse.js";

// Strip machine-generated preamble blocks from the visible student bubble.
// The stdin to the CLI is prefixed with any queued [OBSERVATION]...[/OBSERVATION]
// blocks and a single [ACTIVE CONTEXT]...[/ACTIVE CONTEXT] block; these are
// bookkeeping for the model, not things the student actually typed, so they
// must not appear in the rendered chat history. Only strips from the start of
// the string, so a student who literally types "[OBSERVATION]" mid-message
// keeps their text intact.
function stripObservationPrefix(text) {
  if (typeof text !== 'string') return text;
  return text
    .replace(/^(\[OBSERVATION[\s\S]*?\[\/OBSERVATION\]\s*)+/g, '')
    .replace(/^(\[ACTIVE CONTEXT\][\s\S]*?\[\/ACTIVE CONTEXT\]\s*)/, '');
}

// Renders a single chat message (user or assistant). For assistant messages,
// runs an 18-step rendering pipeline: extracts special blocks, converts LaTeX,
// renders KaTeX, applies markdown. Then (second useEffect, only when not
// streaming) wraps inline content in data-chat-block paragraph containers so
// any block in the reply can be clicked to attach as context.
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
    if (!ref.current || role !== "assistant" || !window.katex) return;
    // About to reassign innerHTML below, which detaches every previously
    // mounted Desmos host. Destroy live calcs first so their WebGL /
    // observer resources don't leak into the void between here and the
    // next run of the third effect.
    if (desmosInstancesRef.current.size > 0) {
      for (const [, calc] of desmosInstancesRef.current) {
        try { calc.destroy(); } catch (_) {}
      }
      desmosInstancesRef.current.clear();
    }
    const fencedBlocks = [];
    // Extract demo blocks before any escaping (they contain raw HTML/SVG)
    const demoBlocks = [];
    let s = text.replace(/<div class="chat-demo-block"><div class="chat-demo-title">[\s\S]*?<\/div>[\s\S]*?<\/div>/g, (match) => {
      demoBlocks.push(match);
      return `\x00DB${demoBlocks.length - 1}\x00`;
    });
    // Preserve Desmos placeholder divs through the text pipeline. They are
    // self-closing (no inner content until ChatBubble's mount effect hydrates
    // a calculator into them); piggy-back on the demoBlocks array so we only
    // run one placeholder-swap pass.
    s = s.replace(/<div class="chat-desmos-block"[^>]*><\/div>/g, (match) => {
      demoBlocks.push(match);
      return `\x00DB${demoBlocks.length - 1}\x00`;
    });
    // Extract sources dropdowns (from processResponse)
    s = s.replace(/<details class="chat-sources">[\s\S]*?<\/details>/g, (match) => {
      demoBlocks.push(match);
      return `\x00DB${demoBlocks.length - 1}\x00`;
    });
    s = s.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
      fencedBlocks.push(`<pre class="chat-pre"><code class="chat-code-block">${code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</code></pre>`);
      return `\x00FB${fencedBlocks.length - 1}\x00`;
    });
    // Extract raw SVG, img, video blocks and markdown images (after code fences, before escaping)
    const mediaBlocks = [];
    s = s.replace(/<svg\b[\s\S]*?<\/svg>/g, (match) => { mediaBlocks.push(`<div class="chat-media-block">${match}</div>`); return `\x00ME${mediaBlocks.length - 1}\x00`; });
    s = s.replace(/<img\s[^>]*\/?>/gi, (match) => { mediaBlocks.push(`<div class="chat-media-block">${match}</div>`); return `\x00ME${mediaBlocks.length - 1}\x00`; });
    s = s.replace(/<video\b[\s\S]*?<\/video>/gi, (match) => { mediaBlocks.push(`<div class="chat-media-block">${match}</div>`); return `\x00ME${mediaBlocks.length - 1}\x00`; });
    s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) => {
      const isVid = /\.(mp4|webm|mov|ogg)$/i.test(src);
      mediaBlocks.push(isVid
        ? `<div class="chat-media-block"><video controls src="${src}" style="max-width:100%"><p>${alt || 'Video'}</p></video></div>`
        : `<div class="chat-media-block"><img src="${src}" alt="${alt}" style="max-width:100%"/></div>`);
      return `\x00ME${mediaBlocks.length - 1}\x00`;
    });
    const inlineCode = [];
    s = s.replace(/`([^`]+)`/g, (_, code) => {
      inlineCode.push(`<code class="chat-code">${code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</code>`);
      return `\x00IC${inlineCode.length - 1}\x00`;
    });
    // Convert \[...\] and \(...\) to $$...$$ and $...$
    s = s.replace(/\\\[([\s\S]+?)\\\]/g, (_, inner) => `$$${inner}$$`);
    s = s.replace(/\\\((.+?)\\\)/g, (_, inner) => `$${inner}$`);
    // Detect standalone equation lines: lines with LaTeX commands but no prose
    s = s.replace(/^[ \t]*([A-Za-z0-9_()|][\s\S]*?\\(?:frac|sqrt|hbar|int|sum|prod|left|right|infty|text|mathrm|begin|end|psi|Psi|phi|Phi|alpha|beta|gamma|delta|Delta|sigma|Sigma|lambda|Lambda|theta|Theta|pi|Pi|epsilon|mu|nu|omega|Omega|partial|nabla|vec|hat|bar|dot|ddot|tilde|underbrace|overbrace|overline|underline|quad|qquad|cdot|times|approx|neq|geq|leq|pm|mp|dfrac|exp|ln|log|sin|cos|tan|lim|det)[\s\S]*?)$/gm, (match) => {
      if (/\$/.test(match)) return match;
      const stripped = match.trim();
      const proseWords = stripped.match(/(?<!\\)[a-z]{4,}/g) || [];
      const realProse = proseWords.filter(w => !/^(frac|sqrt|hbar|left|right|text|mathrm|begin|end|infty|alpha|beta|gamma|delta|sigma|lambda|theta|epsilon|omega|partial|nabla|quad|qquad|cdot|times|approx|sqrt|prod|dfrac|cases|bmatrix|pmatrix|matrix)$/.test(w));
      if (realProse.length <= 2) return `$$${stripped}$$`;
      return match;
    });
    s = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const mathBlocks = [];
    s = s.replace(/\$\$([\s\S]+?)\$\$/g, (m) => { mathBlocks.push(m); return `\x00MB${mathBlocks.length - 1}\x00`; });
    s = s.replace(/\$([^$]+?)\$/g, (m) => { mathBlocks.push(m); return `\x00MB${mathBlocks.length - 1}\x00`; });
    s = s.replace(/\|([A-Za-z])_([A-Za-z0-9]{1,5})\|/g, (_, l, sub) => `$|${l}_{${sub}}|$`);
    s = s.replace(/(?<![A-Za-z_$\\])([A-Z])_([A-Za-z0-9]{1,5})(?![A-Za-z0-9_{$\x00])/g, (_, l, sub) => `$${l}_{${sub}}$`);
    s = s.replace(/(?<![A-Za-z_$\\])([a-z])_(m|mb|o|n|p|bs|gs|ds|ov|ox|on|i|f|be)(?![A-Za-z0-9_{$\x00])/g, (_, l, sub) => `$${l}_{${sub}}$`);
    {
      const latexCmdRe = /\\([a-zA-Z]{2,})/g;
      let match;
      const wraps = [];
      while ((match = latexCmdRe.exec(s)) !== null) {
        const cmdStart = match.index;
        let exprStart = cmdStart;
        const before = s.slice(0, cmdStart);
        const leadMatch = before.match(/((?:[A-Za-z0-9_()\x00]+\s*)?(?:=|[-+*/])\s*)$/);
        if (leadMatch) exprStart = cmdStart - leadMatch[0].length;
        let pos = match.index + match[0].length;
        let depth = 0;
        while (pos < s.length) {
          const ch = s[pos];
          if (ch === '{') { depth++; pos++; }
          else if (ch === '}') { if (depth > 0) { depth--; pos++; } else break; }
          else if (ch === '\\' && pos + 1 < s.length && /[a-zA-Z]/.test(s[pos + 1])) {
            const sub = s.slice(pos).match(/^\\[a-zA-Z]+/);
            if (sub) pos += sub[0].length; else pos++;
          }
          else if (depth > 0) { pos++; }
          else if (/[A-Za-z0-9_{}^()=+\-*/.,|!]/.test(ch)) {
            const ahead = s.slice(pos);
            if (/^[a-z]{3,}/.test(ahead) && !/^(sin|cos|tan|log|ln|exp|min|max|lim|det|deg|dim|inf|sup|mod|gcd)\b/.test(ahead)) break;
            pos++;
          }
          else if (ch === ' ' && depth === 0) {
            const ahead = s.slice(pos + 1);
            if (/^[\\{A-Z_^(|]/.test(ahead) || /^[+\-=*/]/.test(ahead) || /^[0-9]/.test(ahead)) { pos++; }
            else break;
          }
          else break;
        }
        while (pos > match.index + match[0].length && /[\s.,;]/.test(s[pos - 1])) pos--;
        if (pos > match.index + match[0].length) wraps.push({ start: exprStart, end: pos });
      }
      wraps.sort((a, b) => a.start - b.start || b.end - a.end);
      const filtered = [];
      for (const w of wraps) {
        if (filtered.length > 0 && w.start < filtered[filtered.length - 1].end) continue;
        filtered.push(w);
      }
      for (let i = filtered.length - 1; i >= 0; i--) {
        const w = filtered[i];
        const expr = s.slice(w.start, w.end).trim();
        if (expr) s = s.slice(0, w.start) + `$${expr}$` + s.slice(w.end);
      }
    }
    s = s.replace(/\x00MB(\d+)\x00/g, (_, i) => mathBlocks[parseInt(i)]);
    // Helper: decode HTML entities inside LaTeX before passing to KaTeX
    const deHtml = (tex) => tex.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    // Render display math FIRST (before merge step, which can corrupt $$)
    s = s.replace(/\$\$(.+?)\$\$/gs, (_, tex) => {
      try { return '<div class="chat-eq-block">' + window.katex.renderToString(deHtml(tex).trim(), { displayMode: true, throwOnError: false }).replace(/\n/g, '') + '</div>'; }
      catch (e) { return `<div class="chat-eq-block"><code>${tex}</code></div>`; }
    });
    // Merge adjacent inline math separated by operators: $a$ > $b$ → $a > b$
    let _prev;
    do {
      _prev = s;
      s = s.replace(/\$([^$]+)\$\s*([-+=]|&gt;=?|&lt;=?|\\ge|\\le|\\gt|\\lt)\s*\$([^$]+)\$/g, (_, a, op, b) => {
        const m = { '&gt;=': '\\ge ', '&lt;=': '\\le ', '&gt;': '\\gt ', '&lt;': '\\lt ', '=': '= ', '-': '- ', '+': '+ ' };
        return `$${a} ${m[op] || op + ' '}${b}$`;
      });
      s = s.replace(/\$([^$]+)\$\$([^$]+)\$/g, (_, a, b) => `$${a} ${b}$`);
    } while (s !== _prev);
    // Render inline math
    s = s.replace(/\$(.+?)\$/g, (_, tex) => {
      try { return window.katex.renderToString(deHtml(tex).trim(), { displayMode: false, throwOnError: false }).replace(/\n/g, ''); }
      catch (e) { return `<code>${tex}</code>`; }
    });
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\*(.+?)\*/g, '<em>$1</em>');
    s = s.replace(/^### (.+)$/gm, '<h4 class="chat-h">$1</h4>');
    s = s.replace(/^## (.+)$/gm, '<h3 class="chat-h">$1</h3>');
    s = s.replace(/^# (.+)$/gm, '<h3 class="chat-h">$1</h3>');
    // Horizontal rules
    s = s.replace(/^---+$/gm, '<hr class="chat-hr"/>');
    // Markdown tables
    s = s.replace(/((?:^\|.+\|[ \t]*$\n?)+)/gm, (tableBlock) => {
      const rows = tableBlock.trim().split('\n').filter(r => r.trim());
      if (rows.length < 2) return tableBlock;
      const parseRow = (r) => r.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const isSep = (r) => /^\|[-\s:|]+\|$/.test(r.trim());
      let headerRow = null;
      const bodyRows = [];
      let sepSeen = false;
      for (const r of rows) {
        if (isSep(r)) { sepSeen = true; continue; }
        if (!sepSeen && !headerRow) { headerRow = parseRow(r); }
        else { bodyRows.push(parseRow(r)); }
      }
      if (!headerRow) return tableBlock;
      let html = '<table class="chat-table"><thead><tr>';
      for (const h of headerRow) html += `<th>${h}</th>`;
      html += '</tr></thead><tbody>';
      for (const row of bodyRows) {
        html += '<tr>';
        for (const c of row) html += `<td>${c}</td>`;
        html += '</tr>';
      }
      html += '</tbody></table>';
      return html;
    });
    s = s.replace(/^- (.+)$/gm, '<li class="chat-li">$1</li>');
    s = s.replace(/((?:<li class="chat-li">.*<\/li>\n?)+)/g, '<ul class="chat-ul">$1</ul>');
    s = s.replace(/^\d+\. (.+)$/gm, '<li class="chat-oli">$1</li>');
    s = s.replace(/((?:<li class="chat-oli">.*<\/li>\n?)+)/g, '<ol class="chat-ol">$1</ol>');
    s = s.replace(/\n/g, '<br/>');
    s = s.replace(/\x00FB(\d+)\x00/g, (_, i) => fencedBlocks[parseInt(i)]);
    s = s.replace(/\x00IC(\d+)\x00/g, (_, i) => inlineCode[parseInt(i)]);
    s = s.replace(/\x00DB(\d+)\x00/g, (_, i) => demoBlocks[parseInt(i)]);
    s = s.replace(/\x00ME(\d+)\x00/g, (_, i) => mediaBlocks[parseInt(i)]);
    s = s.replace(/(<\/pre>|<\/h[34]>|<\/ul>|<\/ol>|<\/div>|<\/details>|<\/table>|<hr[^>]*>)<br\/>/g, '$1');
    s = s.replace(/<br\/>(<pre |<h[34] |<ul |<ol |<div class="chat-eq|<div class="chat-demo|<div class="chat-media|<details |<table |<hr )/g, '$1');
    ref.current.innerHTML = s;
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
          el.innerHTML = '<div class="chat-desmos-error">Desmos graph unavailable: VITE_DESMOS_KEY not configured.</div>';
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
        el.innerHTML = '<div class="chat-desmos-error">Desmos state decode failed</div>';
        return;
      }
      el.innerHTML = '<div class="chat-desmos-host"></div>';
      const host = el.firstElementChild;
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
        el.innerHTML = '<div class="chat-desmos-error">Desmos render failed</div>';
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
