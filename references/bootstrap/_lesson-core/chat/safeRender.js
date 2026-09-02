// Safe renderer for model-controlled chat HTML.
//
// Everything an assistant bubble shows — markdown prose, <<DEMO>> SVG, raw
// <svg>/<img>/<video>, <<SOURCES>> links, Desmos placeholders — arrives as an
// HTML string built by chatMarkdown.js from model output. It used to be
// assigned to innerHTML, so a prompt-injected onerror / foreignObject /
// javascript: URL ran in the lesson origin, whose dev proxy fronts a CLI with
// git and Bash. This module mounts that string without ever touching
// innerHTML:
//
//   string -> stripActiveContent (regex pre-filter, layer 1, kept on purpose)
//          -> DOMParser("text/html")  (inert document: no script, no fetches)
//          -> tree walk               (allowlist of elements per namespace,
//                                      attributes per element, URL schemes per
//                                      attribute, inline-style properties)
//          -> fresh nodes created with createElementNS in the live document
//          -> container.replaceChildren(fragment)
//
// Nodes are rebuilt from the parsed tree, never re-serialised, so there is no
// serialise/re-parse step for mutation-XSS to exploit. Unknown elements are
// dropped WITH their subtree (so <script>/<style> bodies never surface as
// text). Text nodes are copied verbatim — text is inert.
//
// What the allowlist accepts (also enumerated in the PR / tests):
//   HTML   prose, lists, tables, code, details/summary, img, video/audio/source
//   SVG    shapes, text, defs/symbol/use (#local only), gradients, patterns,
//          clipPath/mask/marker, filters (no feImage), image (http(s)/data:image
//          only), SMIL animate/set (not on href/style/class), title/desc
//   MathML the KaTeX output set (math…mtable, annotation)
//   attrs  class/id/style/title/lang/dir/role/hidden + aria-*/data-* globally,
//          plus per-element lists below; no on*, no name/is/tabindex/srcset/…
//   URLs   a: http(s)/mailto/tel/relative/#, media: http(s)/relative/data:image/*,
//          SVG refs (use/mpath/textPath/pattern/gradient/filter href): # only
//   style  inline properties without url()/expression()/behavior/-moz-binding;
//          position:fixed dropped (page overlay). <style> elements are dropped.
// Dropped: script, style, iframe, object, embed, foreignObject, link, meta,
//          base, form/input/button/textarea/select, template, slot, canvas,
//          annotation-xml, maction, feImage, and every element not listed.

const XHTML = "http://www.w3.org/1999/xhtml";
const SVG = "http://www.w3.org/2000/svg";
const MATHML = "http://www.w3.org/1998/Math/MathML";
const XLINK = "http://www.w3.org/1999/xlink";
const XMLNS = "http://www.w3.org/2000/xmlns/";
const XML = "http://www.w3.org/XML/1998/namespace";

// Layer 1 (kept): regex pre-filter over the raw string. It is not a sanitizer —
// it cannot see parser quirks — but it removes the obvious executable surface
// before parsing and costs nothing. The allowlist walk below is the real gate.
export function stripActiveContent(html) {
  return html
    .replace(/<\s*script\b[\s\S]*?<\s*\/\s*script\s*>/gi, "")
    .replace(/<\s*script\b[^>]*>/gi, "")
    .replace(/<\s*(iframe|object|embed|foreignObject)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*(iframe|object|embed)\b[^>]*>/gi, "")
    // on*= handlers, quoted or bare
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, "")
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, "")
    // javascript:/data:text/html in href/src/xlink:href
    .replace(/((?:href|src|xlink:href)\s*=\s*)(["'])\s*(?:javascript|vbscript|data:text\/html)[^"']*\2/gi, '$1$2#$2')
    .replace(/((?:href|src|xlink:href)\s*=\s*)(?:javascript|vbscript):[^\s>]*/gi, "$1#");
}

const set = (s) => new Set(s.split(/\s+/).filter(Boolean));

export const ALLOWED_ELEMENTS = {
  [XHTML]: set(`a abbr audio b blockquote br caption cite code dd del details dfn div dl dt em
    figcaption figure h1 h2 h3 h4 h5 h6 hr i img ins kbd li mark ol p pre q s samp small source
    span strong sub summary sup table tbody td tfoot th thead tr u ul var video wbr`),
  [SVG]: set(`svg g path rect circle ellipse line polyline polygon text tspan textPath title desc
    defs symbol use marker pattern clipPath mask linearGradient radialGradient stop image a switch
    filter feBlend feColorMatrix feComponentTransfer feComposite feConvolveMatrix feDiffuseLighting
    feDisplacementMap feDistantLight feDropShadow feFlood feFuncA feFuncB feFuncG feFuncR
    feGaussianBlur feMerge feMergeNode feMorphology feOffset fePointLight feSpecularLighting
    feSpotLight feTile feTurbulence animate animateMotion animateTransform set mpath`),
  [MATHML]: set(`math semantics annotation mrow mi mo mn ms mtext mspace msup msub msubsup mfrac
    msqrt mroot mover munder munderover mtable mtr mtd mstyle menclose mpadded mphantom mfenced
    mmultiscripts mprescripts none mlabeledtr`),
};

const GLOBAL_ATTRS = set("class id style title lang dir role hidden");

const HTML_ATTRS = {
  a: set("href target rel"),
  img: set("src alt width height loading decoding"),
  video: set("src poster controls width height muted loop playsinline preload"),
  audio: set("src controls muted loop preload"),
  source: set("src type"),
  td: set("colspan rowspan scope align valign"),
  th: set("colspan rowspan scope align valign"),
  ol: set("start type reversed"),
  li: set("value"),
  details: set("open"),
  blockquote: set("cite"),
  q: set("cite"),
  del: set("cite datetime"),
  ins: set("cite datetime"),
};

// One shared list for every SVG element: presentation attributes are valid
// on most of them and per-element precision buys nothing security-wise —
// values are what matter, and every value goes through the checks below.
const SVG_ATTRS = set(`viewBox width height x y x1 y1 x2 y2 cx cy r rx ry d points transform
  fill fill-opacity fill-rule stroke stroke-width stroke-linecap stroke-linejoin stroke-dasharray
  stroke-dashoffset stroke-opacity stroke-miterlimit opacity color font-size font-family font-weight
  font-style font-variant font-stretch text-anchor dominant-baseline alignment-baseline baseline-shift
  letter-spacing word-spacing text-decoration writing-mode direction unicode-bidi dx dy rotate
  textLength lengthAdjust startOffset method spacing side preserveAspectRatio version
  gradientUnits gradientTransform spreadMethod offset stop-color stop-opacity patternUnits
  patternContentUnits patternTransform clipPathUnits maskUnits maskContentUnits markerWidth
  markerHeight markerUnits refX refY orient clip-path clip-rule mask marker-start marker-mid
  marker-end filter filterUnits primitiveUnits in in2 result stdDeviation mode type values
  operator k1 k2 k3 k4 flood-color flood-opacity radius scale xChannelSelector yChannelSelector
  baseFrequency numOctaves seed stitchTiles tableValues slope intercept amplitude exponent order
  kernelMatrix divisor bias targetX targetY edgeMode surfaceScale diffuseConstant specularConstant
  specularExponent azimuth elevation lighting-color pointsAtX pointsAtY pointsAtZ limitingConeAngle
  kernelUnitLength dur repeatCount repeatDur begin end attributeName attributeType from to by
  keyTimes keySplines calcMode additive accumulate restart path keyPoints min max fill
  pointer-events visibility display overflow vector-effect paint-order shape-rendering
  text-rendering image-rendering color-interpolation color-interpolation-filters cursor
  href target rel`);

const MATHML_ATTRS = set(`accent accentunder align columnalign columnlines columnspacing columnspan
  depth display displaystyle encoding fence form frame height largeop linethickness lspace
  mathbackground mathcolor mathsize mathvariant maxsize minsize movablelimits notation open close
  separators rowalign rowlines rowspacing rowspan rspace scriptlevel selection separator stretchy
  symmetric voffset width`);

// URL attribute policy: which schemes an attribute may carry, per element.
const URL_KINDS = {
  anchor: set("web contact relative fragment"),
  media: set("web relative fragment data-image"),
  local: set("fragment"),
  cite: set("web relative"),
};
const URL_ATTR_POLICY = {
  [XHTML]: {
    a: { href: "anchor" },
    img: { src: "media" },
    video: { src: "media", poster: "media" },
    audio: { src: "media" },
    source: { src: "media" },
    blockquote: { cite: "cite" }, q: { cite: "cite" }, del: { cite: "cite" }, ins: { cite: "cite" },
  },
  [SVG]: {
    a: { href: "anchor" },
    image: { href: "media" },
    use: { href: "local" }, mpath: { href: "local" }, textPath: { href: "local" },
    pattern: { href: "local" }, linearGradient: { href: "local" }, radialGradient: { href: "local" },
    filter: { href: "local" },
  },
  [MATHML]: {},
};

// Characters browsers ignore inside URLs (tab/newline/CR and friends), plus
// zero-width and other invisible code points, removed before classifying so
// "java\tscript:" and "&#x200b;javascript:" classify as javascript:.
const URL_NOISE = /[\u0000-\u0020\u007f-\u00a0\u00ad\u180e\u2000-\u200f\u2028-\u2029\u202f\u205f\u3000\ufeff]/g;

export function classifyUrl(value) {
  const v = String(value).replace(URL_NOISE, "");
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(v);
  if (!m) return v.startsWith("#") ? "fragment" : "relative";
  const scheme = m[1].toLowerCase();
  if (scheme === "http" || scheme === "https") return "web";
  if (scheme === "mailto" || scheme === "tel") return "contact";
  if (scheme === "data") return /^data:image\/[a-z0-9.+-]+[;,]/i.test(v) ? "data-image" : "data-other";
  return "other";
}

// Anything that smuggles a scheme or a resource load through a non-URL
// attribute or a CSS value: javascript:/vbscript:/data:… prefixes, url() to
// anything but a local #fragment, IE expression(), XBL bindings, @import.
const UNSAFE_VALUE = /(?:^\s*(?:javascript|vbscript|data|blob|file|livescript|mocha)\s*:)|url\s*\(\s*(?:["']\s*)?(?!#)|expression\s*\(|-moz-binding|behavior\s*:|@import|image-set\s*\(|element\s*\(|(?:^|[^a-z-])src\s*\(/i;

function isUnsafeValue(value) {
  return UNSAFE_VALUE.test(String(value).replace(URL_NOISE, " "));
}

const DENIED_STYLE_PROPS = set("behavior -moz-binding");

// Parse the inline style with the browser's own CSS parser (on a detached
// scratch element, which never resolves styles or loads resources), then
// re-emit only properties whose normalised value passes the checks. The raw
// string is also checked first so escaped forms ("\75rl(") never reach the
// parser at all — they normalise to url( and are dropped either way.
function sanitizeStyle(raw, doc, dropped, elName) {
  if (isUnsafeValue(raw) || /<|\\/.test(raw)) {
    dropped.push({ kind: "style", name: elName, reason: "unsafe inline style" });
    return null;
  }
  const scratch = doc.createElement("span");
  scratch.style.cssText = raw;
  const st = scratch.style;
  const parts = [];
  for (let i = 0; i < st.length; i++) {
    const prop = st[i];
    const val = st.getPropertyValue(prop);
    if (DENIED_STYLE_PROPS.has(prop) || isUnsafeValue(val) || isUnsafeValue(prop)) {
      dropped.push({ kind: "style", name: prop, reason: "unsafe style value" });
      continue;
    }
    if (prop === "position" && /fixed/i.test(val)) {
      dropped.push({ kind: "style", name: prop, reason: "position:fixed" });
      continue;
    }
    parts.push(`${prop}: ${val}${st.getPropertyPriority(prop) ? " !important" : ""}`);
  }
  return parts.length ? parts.join("; ") : null;
}

const MAX_DEPTH = 256;
const MAX_DROPPED = 64;
const NS_URIS = new Set([SVG, MATHML, XLINK, XHTML]);
const ANIM_ELEMENTS = set("animate animateMotion animateTransform set");
const ANIM_DENIED_TARGETS = /^(?:href|xlink:href|src|style|class|id|is|on.*)$/i;

function note(dropped, entry) {
  if (dropped.length < MAX_DROPPED) dropped.push(entry);
}

function cleanElement(src, doc, dropped, depth) {
  const ns = src.namespaceURI;
  const name = src.localName;
  const allowed = ALLOWED_ELEMENTS[ns];
  if (!allowed || !allowed.has(name)) {
    note(dropped, { kind: "element", name: src.nodeName, reason: "not in allowlist" });
    return null;
  }
  if (ns === SVG && ANIM_ELEMENTS.has(name)) {
    const target = (src.getAttribute("attributeName") || "").replace(URL_NOISE, "");
    if (ANIM_DENIED_TARGETS.test(target)) {
      note(dropped, { kind: "element", name, reason: `animates ${target}` });
      return null;
    }
  }
  const el = doc.createElementNS(ns, name);
  const perElement = ns === XHTML ? HTML_ATTRS[name] : ns === SVG ? SVG_ATTRS : MATHML_ATTRS;
  const urlPolicy = (URL_ATTR_POLICY[ns] || {})[name] || {};
  let hasHref = false;
  for (const attr of Array.from(src.attributes)) {
    const ans = attr.namespaceURI;
    const ln = attr.localName;
    const value = attr.value;
    const drop = (reason) => note(dropped, { kind: "attribute", name: `${name}[${attr.name}]`, reason });
    if (ans === XMLNS) {
      if (NS_URIS.has(value)) el.setAttributeNS(XMLNS, attr.name, value); else drop("foreign xmlns");
      continue;
    }
    if (ans === XML) {
      if (ln === "space" || ln === "lang") el.setAttributeNS(XML, attr.name, value); else drop("xml attr");
      continue;
    }
    let isXlink = false;
    if (ans === XLINK) {
      if (ln !== "href" && ln !== "title") { drop("xlink attr"); continue; }
      isXlink = true;
    } else if (ans !== null) { drop("foreign namespace"); continue; }
    if (/^on/i.test(ln)) { drop("event handler"); continue; }
    if (ln !== "href" || !isXlink) {
      const generic = GLOBAL_ATTRS.has(ln) || ln.startsWith("aria-") || ln.startsWith("data-");
      if (!generic && !(perElement && perElement.has(ln))) { drop("not in allowlist"); continue; }
    }
    if (ln === "style") {
      const css = sanitizeStyle(value, doc, dropped, name);
      if (css) el.setAttribute("style", css);
      continue;
    }
    const policy = urlPolicy[ln];
    if (ln === "href" || ln === "src" || ln === "poster" || ln === "cite") {
      if (!policy) { drop("url attr not allowed here"); continue; }
      const kind = classifyUrl(value);
      if (!URL_KINDS[policy].has(kind)) { drop(`url scheme (${kind})`); continue; }
      if (ln === "href") hasHref = true;
    } else if (isUnsafeValue(value)) { drop("unsafe value"); continue; }
    if (ln === "target" && value !== "_blank") { drop("target"); continue; }
    if (isXlink) el.setAttributeNS(XLINK, attr.name, value); else el.setAttribute(ln, value);
  }
  if (name === "a" && hasHref && el.getAttribute("target") === "_blank") {
    // New-tab links never get a window.opener; keeps a supplied rel intact.
    const rel = (el.getAttribute("rel") || "").split(/\s+/).filter(Boolean);
    if (!rel.includes("noopener")) rel.push("noopener");
    el.setAttribute("rel", rel.join(" "));
  }
  if (depth >= MAX_DEPTH) {
    note(dropped, { kind: "element", name: "(children)", reason: "max depth" });
    return el;
  }
  for (const child of src.childNodes) {
    const c = cleanNode(child, doc, dropped, depth + 1);
    if (c) el.appendChild(c);
  }
  return el;
}

function cleanNode(node, doc, dropped, depth) {
  switch (node.nodeType) {
    case 1: return cleanElement(node, doc, dropped, depth);
    case 3: return doc.createTextNode(node.data);
    case 4: return doc.createTextNode(node.data); // CDATA in foreign content -> plain text
    default: return null; // comments, PIs, doctypes
  }
}

// Parse `html` in an inert document and rebuild it as allowlisted nodes owned
// by `doc`. Returns { fragment, dropped }. Does NOT run stripActiveContent;
// use renderSafeHtmlInto for the full two-layer path.
export function sanitizeHtml(html, doc = document) {
  const parsed = new DOMParser().parseFromString(String(html ?? ""), "text/html");
  const fragment = doc.createDocumentFragment();
  const dropped = [];
  for (const child of parsed.body.childNodes) {
    const c = cleanNode(child, doc, dropped, 0);
    if (c) fragment.appendChild(c);
  }
  return { fragment, dropped };
}

// The only way model-controlled HTML reaches the DOM: regex pre-filter, then
// allowlist rebuild, then replaceChildren. Returns the dropped-entries list.
export function renderSafeHtmlInto(container, html) {
  const { fragment, dropped } = sanitizeHtml(stripActiveContent(String(html ?? "")), container.ownerDocument);
  container.replaceChildren(fragment);
  return dropped;
}
