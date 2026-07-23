// Parses chat response text and extracts special blocks:
//   - <<EDIT_GRAPH>>{...}<<END_EDIT>>  → validated via graphSchema, calls onEditGraph(validValue)
//   - <<DEMO title="...">>...<<END_DEMO>>  → SVG linted via DOMParser, rendered as .chat-demo-block HTML
//   - <<SOURCES>>...<<END_SOURCES>>  → rendered as collapsible <details> dropdown
//   - <<SUGGEST type="..." ...>>...<<END_SUGGEST>>  → extracted into suggestion object
//   - <<COMMIT_SUGGEST>>{"message","paths":[]}<<END_COMMIT_SUGGEST>>  → extracted into commitSuggest object
//   - <<REINFORCE>>text<<END_REINFORCE>>  → stripped, collected into reinforced[]
//       for the client to merge into per-tab reinforced-behaviors state and
//       inject back via [REINFORCED BEHAVIORS] in the next ACTIVE CONTEXT.
//   - <<DESMOS>>state-json<<END_DESMOS>>  → parsed + validated + stripped of
//       any isPlaying:true keys, base64-encoded, emitted as an empty placeholder
//       div (<div class="chat-desmos-block" data-desmos-state="...">) that
//       ChatBubble hydrates into a live Desmos calculator after stream ends.
// Errors surface through onError(type, details) so the client can enqueue
// observations and feed them back to the model on the next turn.
// Returns { display, suggestion, commitSuggest, reinforced }.
import { validateEdit } from "./graphSchema.js";

// Recursively strip isPlaying:true so the bot can't autoplay sliders that
// then leak CPU after a message re-renders or scrolls offscreen. Student
// toggles animation via the play button the client renders.
function stripAutoplay(v) {
  if (!v || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(stripAutoplay);
  const out = {};
  for (const [k, val] of Object.entries(v)) {
    if (k === "isPlaying" && val === true) continue;
    out[k] = stripAutoplay(val);
  }
  return out;
}

// Validate a Desmos state object. Returns { ok: true, value } on success,
// or { ok: false, reason } on failure. Structural check + semantic lint for
// the string-vs-number footgun: setState crashes silently with "parse can
// only be called with strings, got <n> of type number" if sliderBounds
// {min,max,step} OR lineWidth/lineOpacity/pointSize/pointOpacity arrive as
// JS numbers. The Desmos docs spec these as "valid LaTeX strings" (e.g. "0.1"),
// not numbers, and the runtime parser does not coerce on setState. Failing
// loud here surfaces the bug as an observation the bot can correct, instead
// of a blank canvas + spamming requestAnimationFrame errors. Size caps
// also stop a runaway bot from shipping a 10MB blob.
const DESMOS_STRING_NUMERIC_PROPS = ["lineWidth", "lineOpacity", "pointSize", "pointOpacity"];
function validateDesmosState(raw) {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: "top-level must be an object" };
  }
  const list = raw?.expressions?.list;
  if (list !== undefined) {
    if (!Array.isArray(list)) return { ok: false, reason: "expressions.list must be an array" };
    if (list.length > 100) return { ok: false, reason: "expressions.list exceeds 100 entries" };
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e || typeof e !== "object") return { ok: false, reason: `expressions[${i}] must be an object` };
      if (e.id !== undefined && (typeof e.id !== "string" || e.id.length > 64)) {
        return { ok: false, reason: `expressions[${i}].id must be a string <=64 chars` };
      }
      if (e.latex !== undefined && (typeof e.latex !== "string" || e.latex.length > 1024)) {
        return { ok: false, reason: `expressions[${i}].latex must be a string <=1024 chars` };
      }
      if (e.sliderBounds !== undefined) {
        if (typeof e.sliderBounds !== "object" || e.sliderBounds === null || Array.isArray(e.sliderBounds)) {
          return { ok: false, reason: `expressions[${i}].sliderBounds must be an object` };
        }
        for (const k of ["min", "max", "step"]) {
          const v = e.sliderBounds[k];
          if (v !== undefined && typeof v !== "string") {
            return { ok: false, reason: `expressions[${i}].sliderBounds.${k} must be a STRING (e.g. "0.1" not 0.1) -- Desmos setState rejects numeric bounds` };
          }
        }
      }
      for (const prop of DESMOS_STRING_NUMERIC_PROPS) {
        if (e[prop] !== undefined && typeof e[prop] !== "string") {
          return { ok: false, reason: `expressions[${i}].${prop} must be a STRING (e.g. "2.5" not 2.5) -- Desmos setState crashes on numeric ${prop}` };
        }
      }
      // parametricDomain / polarDomain bounds are LaTeX strings too — numeric
      // values blank the calculator exactly like numeric sliderBounds.
      for (const domProp of ["parametricDomain", "polarDomain"]) {
        const dom = e[domProp];
        if (dom !== undefined) {
          if (typeof dom !== "object" || dom === null || Array.isArray(dom)) {
            return { ok: false, reason: `expressions[${i}].${domProp} must be an object` };
          }
          for (const k of ["min", "max"]) {
            if (dom[k] !== undefined && typeof dom[k] !== "string") {
              return { ok: false, reason: `expressions[${i}].${domProp}.${k} must be a STRING (e.g. "0" not 0) -- Desmos setState rejects numeric domain bounds` };
            }
          }
        }
      }
    }
  }
  const cleaned = stripAutoplay(raw);
  const serialized = JSON.stringify(cleaned);
  if (serialized.length > 16384) return { ok: false, reason: "state exceeds 16KB" };
  return { ok: true, value: cleaned, serialized };
}

// btoa handles ASCII only; a bot-emitted latex string could carry any UTF-8.
// Route through TextEncoder so \pi, multiplication signs, superscripts etc.
// all survive the round trip without invoking the deprecated escape/unescape
// globals (which are banned in some strict-mode bundler targets).
export function b64encodeUtf8(s) {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export function b64decodeUtf8(s) {
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function processResponse(text, { onEditGraph, graphSchema, onError } = {}) {
  const editRe = /<<EDIT_GRAPH>>([\s\S]*?)<<END_EDIT>>/g;
  let display = text;
  let match;
  let appliedEdit = false;
  while ((match = editRe.exec(text)) !== null) {
    const raw = match[1].trim();
    let edits;
    try {
      edits = JSON.parse(raw);
    } catch (e) {
      onError?.("edit-rejection", {
        errors: [{ graphKey: null, param: null, reason: "malformed JSON: " + e.message }],
      });
      display = display.replace(match[0], "");
      continue;
    }
    const result = validateEdit(edits, graphSchema);
    if (result.errors && result.errors.length > 0) {
      onError?.("edit-rejection", { applied: result.validValue, errors: result.errors });
    }
    if (result.validValue && Object.keys(result.validValue).length > 0) {
      onEditGraph?.(result.validValue);
      appliedEdit = true;
    }
    display = display.replace(match[0], "");
  }
  // Extract inline demo blocks, lint SVG via DOMParser, convert to rendered HTML
  const demoRe = /<<DEMO\s+title="([^"]*)"?>>([\s\S]*?)<<END_DEMO>>/g;
  display = display.replace(demoRe, (_, title, svgContent) => {
    const cleanSvg = svgContent.trim();
    const parser = new DOMParser();
    const doc = parser.parseFromString(cleanSvg, "image/svg+xml");
    const parseErr = doc.querySelector("parsererror");
    if (parseErr) {
      onError?.("demo-lint", { title, reason: "parser error: " + parseErr.textContent.trim() });
      return "";
    }
    const root = doc.documentElement;
    if (!root || root.nodeName.toLowerCase() !== "svg") {
      onError?.("demo-lint", { title, reason: "missing <svg> root" });
      return "";
    }
    if (!root.getAttribute("viewBox")) {
      onError?.("demo-lint", { title, reason: "missing viewBox attribute" });
      return "";
    }
    return `<div class="chat-demo-block"><div class="chat-demo-title">${title}</div>${cleanSvg}</div>`;
  });
  // Convert <<SOURCES>> block to collapsible dropdown
  display = display.replace(/<<SOURCES>>([\s\S]*?)<<END_SOURCES>>/g, (_, content) => {
    const items = content.trim().split('\n').filter(l => l.trim().startsWith('-')).map(l => {
      let txt = l.trim().replace(/^-\s*/, '');
      txt = txt.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
      return `<li>${txt}</li>`;
    });
    if (items.length === 0) return '';
    return `<details class="chat-sources"><summary>Sources</summary><ul>${items.join('')}</ul></details>`;
  });
  let suggestion = null;
  const suggestRe = /<<SUGGEST\s+([^>]*)>>([\s\S]*?)<<END_SUGGEST>>/;
  const suggestMatch = display.match(suggestRe);
  if (suggestMatch) {
    const attrsStr = suggestMatch[1];
    const content = suggestMatch[2].trim();
    const getAttr = (name) => { const m = attrsStr.match(new RegExp(`${name}="([^"]*)"`)); return m ? m[1] : null; };
    const rawType = getAttr("type");
    const rawTitle = getAttr("title");
    if (!rawTitle) onError?.("suggest-missing", { missing: "title", attrs: attrsStr });
    if (!rawType) onError?.("suggest-missing", { missing: "type", attrs: attrsStr });
    suggestion = {
      type: rawType || "lesson",
      section: getAttr("section"),
      title: rawTitle || "Suggested Addition",
      mode: getAttr("mode") || "collapsible",
      content,
      dismissed: false,
    };
    display = display.replace(suggestMatch[0], "").trim();
  }
  // Extract <<COMMIT_SUGGEST>>{...}<<END_COMMIT_SUGGEST>> block. The bot emits
  // this after applying changes it wants the user to commit. Malformed JSON
  // surfaces through onError so the bot can retry; the tag is always stripped
  // from display so the user never sees raw tags.
  let commitSuggest = null;
  const commitRe = /<<COMMIT_SUGGEST>>([\s\S]*?)<<END_COMMIT_SUGGEST>>/;
  const commitMatch = display.match(commitRe);
  if (commitMatch) {
    const rawJson = commitMatch[1].trim();
    try {
      const parsed = JSON.parse(rawJson);
      if (typeof parsed?.message !== "string" || !parsed.message.trim()) {
        onError?.("commit-suggest-malformed", { reason: "missing or empty 'message' string" });
      } else if (!Array.isArray(parsed.paths) || parsed.paths.length === 0 || !parsed.paths.every(p => typeof p === "string")) {
        onError?.("commit-suggest-malformed", { reason: "'paths' must be a non-empty string[]" });
      } else {
        commitSuggest = { message: parsed.message.trim(), paths: parsed.paths };
      }
    } catch (e) {
      onError?.("commit-suggest-malformed", { reason: "JSON parse error: " + e.message });
    }
    display = display.replace(commitMatch[0], "").trim();
  }
  // Extract <<DESMOS>>state-json<<END_DESMOS>> blocks. Each block becomes an
  // empty placeholder div with a base64-encoded state attribute; ChatBubble
  // hydrates it into a live calculator after streaming completes. Up to 3
  // per message; further blocks are rejected with a lint observation.
  let desmosCount = 0;
  display = display.replace(/<<DESMOS>>([\s\S]*?)<<END_DESMOS>>/g, (_, body) => {
    if (desmosCount >= 3) {
      onError?.("desmos-lint", { reason: "exceeds 3 Desmos blocks per message; use <<DEMO>> SVG for additional graphs" });
      return "";
    }
    let parsed;
    try {
      parsed = JSON.parse(body.trim());
    } catch (e) {
      onError?.("desmos-lint", { reason: "malformed JSON: " + e.message });
      return "";
    }
    const v = validateDesmosState(parsed);
    if (!v.ok) {
      onError?.("desmos-lint", { reason: v.reason });
      return "";
    }
    desmosCount++;
    const encoded = b64encodeUtf8(v.serialized);
    return `<div class="chat-desmos-block" data-desmos-state="${encoded}"></div>`;
  });
  // Extract <<REINFORCE>>text<<END_REINFORCE>> blocks. Each block records one
  // medium/approach that just produced a positive signal. The bot may emit
  // multiple per turn. They are stripped from display; the array is returned
  // so the client can merge into per-tab reinforced-behaviors state.
  const reinforced = [];
  display = display.replace(/<<REINFORCE>>([\s\S]*?)<<END_REINFORCE>>/g, (_, content) => {
    const txt = content.trim();
    if (txt) reinforced.push(txt);
    return "";
  });
  // Fallback for tag-only replies with no prose: name what actually happened —
  // "Graph updated." only when a graph edit applied, else a neutral "Done."
  return { display: display.trim() || (appliedEdit ? "Graph updated." : "Done."), suggestion, commitSuggest, reinforced };
}
