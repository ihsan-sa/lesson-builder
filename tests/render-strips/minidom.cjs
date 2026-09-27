// The smallest DOM safeRender.js and processResponse.js need, so the fixture runs in plain Node.
//
// It is NOT a browser parser: it tokenises well-formed markup the way an HTML parser would for
// the inputs in corpus.cjs (namespaces from <svg>/<math>, raw-text <script>/<style>, void
// elements, entities, xlink:/xml:/xmlns attributes) and nothing more. Parser quirks and
// mutation-XSS belong to tests/safe-render, which runs the same modules in a real Chromium.
// The inline-style parser keeps declarations as written (a browser normalises them), which is
// why the raw-string style check in safeRender.js is exercised on its own here.
'use strict';

const XHTML = 'http://www.w3.org/1999/xhtml';
const SVG = 'http://www.w3.org/2000/svg';
const MATHML = 'http://www.w3.org/1998/Math/MathML';
const XLINK = 'http://www.w3.org/1999/xlink';
const XMLNS = 'http://www.w3.org/2000/xmlns/';
const XML = 'http://www.w3.org/XML/1998/namespace';

const VOID = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noscript']);

function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);?/gi, (m, e) => {
    const k = e.toLowerCase();
    if (k[0] === '#') {
      const n = k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[k];
  });
}

class Style {
  constructor() { this._d = []; }
  set cssText(raw) {
    this._d = [];
    for (const part of String(raw).split(';')) {
      const i = part.indexOf(':');
      if (i < 1) continue;
      const prop = part.slice(0, i).trim().toLowerCase();
      let val = part.slice(i + 1).trim();
      const important = /!\s*important$/i.test(val);
      if (important) val = val.replace(/!\s*important$/i, '').trim();
      if (prop && val) this._d.push({ prop, val, important });
    }
    this._d.forEach((d, n) => { this[n] = d.prop; });
  }
  get length() { return this._d.length; }
  getPropertyValue(p) { const d = this._d.find((x) => x.prop === p); return d ? d.val : ''; }
  getPropertyPriority(p) { const d = this._d.find((x) => x.prop === p); return d && d.important ? 'important' : ''; }
}

class Attr {
  constructor(namespaceURI, name, value) {
    this.namespaceURI = namespaceURI;
    this.name = name;
    this.localName = name.includes(':') ? name.slice(name.indexOf(':') + 1) : name;
    this.value = value;
  }
}

class Node {
  constructor(nodeType) { this.nodeType = nodeType; this.childNodes = []; }
  appendChild(c) { this.childNodes.push(c); return c; }
  replaceChildren(...cs) {
    this.childNodes = [];
    for (const c of cs) { if (c.nodeType === 11) this.childNodes.push(...c.childNodes); else this.childNodes.push(c); }
  }
}

class Element extends Node {
  constructor(namespaceURI, name, ownerDocument) {
    super(1);
    this.namespaceURI = namespaceURI;
    this.localName = name;
    this.nodeName = namespaceURI === XHTML ? name.toUpperCase() : name;
    this.attributes = [];
    this.ownerDocument = ownerDocument;
    if (namespaceURI === XHTML) this.style = new Style();
  }
  getAttribute(name) { const a = this.attributes.find((x) => x.name === name); return a ? a.value : null; }
  setAttributeNS(ns, name, value) {
    const a = this.attributes.find((x) => x.name === name);
    if (a) a.value = String(value); else this.attributes.push(new Attr(ns, name, String(value)));
  }
  setAttribute(name, value) { this.setAttributeNS(null, name, value); }
  querySelector(sel) {
    for (const c of this.childNodes) {
      if (c.nodeType !== 1) continue;
      if (c.localName === sel) return c;
      const d = c.querySelector(sel);
      if (d) return d;
    }
    return null;
  }
  get textContent() { return this.childNodes.map((c) => (c.nodeType === 3 ? c.data : c.nodeType === 1 ? c.textContent : '')).join(''); }
}

class Text extends Node { constructor(data) { super(3); this.data = data; } }
class Fragment extends Node { constructor() { super(11); } }

class Document {
  constructor() { this.body = new Element(XHTML, 'body', this); this.documentElement = null; }
  createDocumentFragment() { return new Fragment(); }
  createElementNS(ns, name) { return new Element(ns, name, this); }
  createElement(name) { return new Element(XHTML, name.toLowerCase(), this); }
  createTextNode(data) { return new Text(data); }
  querySelector(sel) { return this.documentElement && (this.documentElement.localName === sel ? this.documentElement : this.documentElement.querySelector(sel)); }
}

function attrFor(ns, rawName, value) {
  if (ns === XHTML) return new Attr(null, rawName.toLowerCase(), value);
  const lower = rawName.toLowerCase();
  if (lower === 'xmlns' || lower.startsWith('xmlns:')) return new Attr(XMLNS, lower, value);
  if (lower.startsWith('xlink:')) return new Attr(XLINK, lower, value);
  if (lower.startsWith('xml:')) return new Attr(XML, lower, value);
  return new Attr(null, rawName, value);
}

const ATTR_RE = /([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

// Returns { root, error }: root is a container element whose children are the parsed nodes.
function parse(str, doc, xml) {
  const root = new Element(xml ? SVG : XHTML, '#root', doc);
  const stack = [root];
  let error = null;
  let i = 0;
  const top = () => stack[stack.length - 1];
  const text = (t) => { if (t) top().appendChild(new Text(decode(t))); };
  while (i < str.length) {
    const lt = str.indexOf('<', i);
    if (lt === -1) { text(str.slice(i)); break; }
    text(str.slice(i, lt));
    if (str.startsWith('<!--', lt)) { const e = str.indexOf('-->', lt + 4); i = e === -1 ? str.length : e + 3; continue; }
    if (str.startsWith('<![CDATA[', lt)) {
      const e = str.indexOf(']]>', lt); const body = str.slice(lt + 9, e === -1 ? str.length : e);
      top().appendChild(new Text(body)); i = e === -1 ? str.length : e + 3; continue;
    }
    if (str[lt + 1] === '!' || str[lt + 1] === '?') { const e = str.indexOf('>', lt); i = e === -1 ? str.length : e + 1; continue; }
    const close = /^<\/([A-Za-z][^\s>\/]*)\s*>/.exec(str.slice(lt));
    if (close) {
      const want = close[1].toLowerCase();
      let k = stack.length - 1;
      while (k > 0 && stack[k].localName.toLowerCase() !== want) k--;
      if (k > 0) { if (xml && k !== stack.length - 1) error = 'mismatched </' + close[1] + '>'; stack.length = k; }
      else if (xml) error = 'stray </' + close[1] + '>';
      i = lt + close[0].length;
      continue;
    }
    const open = /^<([A-Za-z][^\s>\/]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/.exec(str.slice(lt));
    if (!open) { text('<'); i = lt + 1; continue; }
    i = lt + open[0].length;
    const parentNs = top().namespaceURI;
    let name = open[1];
    let attrSrc = open[2];
    const selfClose = /\/\s*$/.test(attrSrc);
    if (selfClose) attrSrc = attrSrc.replace(/\/\s*$/, '');
    let ns = parentNs;
    if (!xml && parentNs === XHTML) {
      name = name.toLowerCase();
      if (name === 'svg') ns = SVG; else if (name === 'math') ns = MATHML;
    }
    const el = doc.createElementNS(ns, name);
    ATTR_RE.lastIndex = 0;
    let m;
    while ((m = ATTR_RE.exec(attrSrc)) !== null) {
      const v = m[2] ?? m[3] ?? m[4] ?? '';
      const a = attrFor(ns, m[1], decode(v));
      if (!el.attributes.some((x) => x.name === a.name)) el.attributes.push(a);
    }
    top().appendChild(el);
    if (!xml && ns === XHTML && RAW_TEXT.has(name)) {
      const end = str.toLowerCase().indexOf('</' + name, i);
      const body = str.slice(i, end === -1 ? str.length : end);
      if (body) el.appendChild(new Text(name === 'textarea' || name === 'title' ? decode(body) : body));
      const gt = end === -1 ? -1 : str.indexOf('>', end);
      i = gt === -1 ? str.length : gt + 1;
      continue;
    }
    if (selfClose && ns !== XHTML) continue;
    if (ns === XHTML && VOID.has(name)) continue;
    if (xml && selfClose) continue;
    stack.push(el);
  }
  if (xml && stack.length > 1) error = 'unclosed <' + top().localName + '>';
  return { root, error };
}

class DOMParser {
  parseFromString(str, type) {
    const doc = new Document();
    const xml = type !== 'text/html';
    const { root, error } = parse(String(str), doc, xml);
    if (xml) {
      const els = root.childNodes.filter((c) => c.nodeType === 1);
      if (error || els.length !== 1) {
        doc.documentElement = doc.createElementNS(XHTML, 'parsererror');
        doc.documentElement.appendChild(new Text(error || 'expected one root element'));
      } else doc.documentElement = els[0];
    } else doc.body.childNodes = root.childNodes;
    return doc;
  }
}

const escText = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => escText(s).replace(/"/g, '&quot;');

function serialize(node) {
  if (node.nodeType === 3) return escText(node.data);
  if (node.nodeType === 11) return node.childNodes.map(serialize).join('');
  const attrs = node.attributes.map((a) => ` ${a.name}="${escAttr(a.value)}"`).join('');
  if (node.namespaceURI === XHTML && VOID.has(node.localName)) return `<${node.localName}${attrs}>`;
  return `<${node.localName}${attrs}>${node.childNodes.map(serialize).join('')}</${node.localName}>`;
}

// Every element in a rebuilt fragment, for the oracle.
function* walk(node) {
  for (const c of node.childNodes) { if (c.nodeType === 1) { yield c; yield* walk(c); } }
}

module.exports = { DOMParser, Document, serialize, walk, XHTML, SVG, MATHML, XLINK };
