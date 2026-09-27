#!/usr/bin/env node
/**
 * What the chat strips before a tutor reply renders, and which of its action tags act.
 *
 * Runs the production path — processResponse -> renderChatHtml -> stripActiveContent ->
 * sanitizeHtml — over corpus.cjs with a small fake DOM (minidom.cjs), then proves the corpus
 * has teeth: for each protection in MUTATIONS it copies the chat modules, removes that one
 * protection, and requires at least one case to go red. A mutation whose source line has moved
 * fails too, so the list cannot silently go stale.
 *
 * Node only. No npm install, no network, no browser. What the cases assert is in README.md.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const util = require('util');
const { pathToFileURL } = require('url');
const dom = require('./minidom.cjs');
const corpus = require('./corpus.cjs');

const SKILL = path.resolve(__dirname, '..', '..');
const CHAT = path.join(SKILL, 'references', 'bootstrap', '_lesson-core', 'chat');
const MODULES = ['processResponse.js', 'graphSchema.js', 'safeRender.js', 'chatMarkdown.js'];
const SCHEMA = { wave: { freq: { type: 'float', min: 0, max: 10 } } };

globalThis.DOMParser = dom.DOMParser;

// Each entry removes one protection: [file, the exact source it replaces, what it becomes].
const MUTATIONS = [
  ['code, inline code and quoted lines are inert', 'processResponse.js',
    'const source = defuseInertTags(String(text ?? ""));', 'const source = String(text ?? "");'],
  ['side-thread strips state-changing tags', 'processResponse.js',
    '  if (isThread) {\n    for (const tag of MAIN_ONLY_TAGS)', '  if (false) {\n    for (const tag of MAIN_ONLY_TAGS)'],
  ['side-thread never dispatches a graph edit', 'processResponse.js',
    'while (!isThread && (match = editRe.exec(source))', 'while ((match = editRe.exec(source))'],
  ['graph edits are checked against the schema', 'processResponse.js',
    'const result = validateEdit(edits, graphSchema);', 'const result = { validValue: edits, errors: [] };'],
  ['commit paths must be a non-empty string list', 'processResponse.js',
    '} else if (!Array.isArray(parsed.paths) || parsed.paths.length === 0 || !parsed.paths.every(p => typeof p === "string")) {', '} else if (false) {'],
  ['desmos autoplay is stripped', 'processResponse.js',
    'if (k === "isPlaying" && val === true) continue;', ''],
  ['at most three desmos blocks', 'processResponse.js', 'if (desmosCount >= 3) {', 'if (false) {'],
  ['streaming hides a half-arrived tag', 'processResponse.js',
    'if (text.indexOf(close, i) === -1) cut = i;', ''],
  ['layer 1: script blocks', 'safeRender.js',
    '.replace(/<\\s*script\\b[\\s\\S]*?<\\s*\\/\\s*script\\s*>/gi, "")', ''],
  ['layer 1: quoted handlers', 'safeRender.js',
    '.replace(/\\son[a-z]+\\s*=\\s*"[^"]*"/gi, "")', ''],
  ['layer 1: javascript: URLs', 'safeRender.js',
    ".replace(/((?:href|src|xlink:href)\\s*=\\s*)([\"'])\\s*(?:javascript|vbscript|data:text\\/html)[^\"']*\\2/gi, '$1$2#$2')", ''],
  ['layer 2: element allowlist', 'safeRender.js', 'if (!allowed || !allowed.has(name)) {', 'if (!allowed) {'],
  ['layer 2: handler attributes', 'safeRender.js', 'if (/^on/i.test(ln)) { drop("event handler"); continue; }', ''],
  ['layer 2: attribute allowlist', 'safeRender.js',
    'if (!generic && !(perElement && perElement.has(ln))) { drop("not in allowlist"); continue; }', ''],
  ['layer 2: URL scheme per attribute', 'safeRender.js',
    'if (!URL_KINDS[policy].has(kind)) { drop(`url scheme (${kind})`); continue; }', ''],
  ['layer 2: invisible characters in URLs', 'safeRender.js',
    'const v = String(value).replace(URL_NOISE, "");', 'const v = String(value);'],
  ['layer 2: unsafe values in other attributes', 'safeRender.js',
    '} else if (isUnsafeValue(value)) { drop("unsafe value"); continue; }', '}'],
  ['layer 2: raw inline-style check', 'safeRender.js',
    'if (isUnsafeValue(raw) || /<|\\\\/.test(raw)) {', 'if (false) {'],
  ['layer 2: position:fixed', 'safeRender.js', 'if (prop === "position" && /fixed/i.test(val)) {', 'if (false) {'],
  ['layer 2: animations cannot retarget links', 'safeRender.js', 'if (ANIM_DENIED_TARGETS.test(target)) {', 'if (false) {'],
  ['layer 2: new-tab links get noopener', 'safeRender.js', 'if (!rel.includes("noopener")) rel.push("noopener");', ''],
  ['markdown escapes code fences', 'chatMarkdown.js',
    'fencedBlocks.push(`<pre class="chat-pre"><code class="chat-code-block">${code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</code></pre>`);',
    'fencedBlocks.push(`<pre class="chat-pre"><code class="chat-code-block">${code}</code></pre>`);'],
];

const DENIED = new Set('script style iframe object embed foreignObject form input button textarea select base meta link template'.split(' '));
const SAFE_KINDS = new Set(['web', 'contact', 'relative', 'fragment', 'data-image']);

// Holds for every rendered output whatever the case says.
function oracle(frag, classifyUrl) {
  const bad = [];
  for (const el of dom.walk(frag)) {
    if (DENIED.has(el.localName)) bad.push(`<${el.localName}> survived`);
    for (const a of el.attributes) {
      if (/^on/i.test(a.localName)) bad.push(`${el.localName}[${a.name}] survived`);
      if (/^(href|src|poster|xlink:href)$/.test(a.name) && !SAFE_KINDS.has(classifyUrl(a.value))) bad.push(`${el.localName}[${a.name}=${a.value}]`);
    }
  }
  return bad;
}

const same = (a, b) => util.isDeepStrictEqual(a, b);
const show = (v) => util.inspect(v, { depth: 5, breakLength: Infinity });

async function load(dir) {
  const imp = (f) => import(pathToFileURL(path.join(dir, f)).href);
  const [pr, sr, md] = await Promise.all([imp('processResponse.js'), imp('safeRender.js'), imp('chatMarkdown.js')]);
  return { ...pr, ...sr, ...md };
}

// Runs every case against one set of modules; returns the failures as strings.
function runCorpus(M) {
  const fails = [];
  const doc = new dom.Document();
  const fail = (kind, c, what) => fails.push(`${kind}: ${c.name}\n      ${what}`);
  for (const c of corpus.reply) {
    try {
      const got = { edits: [], obs: [] };
      const r = M.processResponse(c.text, {
        scope: c.scope, graphSchema: SCHEMA,
        onEditGraph: (v) => got.edits.push(v), onError: (t) => got.obs.push(t),
      });
      const { fragment } = M.sanitizeHtml(M.stripActiveContent(M.renderChatHtml(r.display)), doc);
      const html = dom.serialize(fragment);
      const sug = r.suggestion && Object.fromEntries(Object.keys(c.suggestion || {}).map((k) => [k, r.suggestion[k]]));
      const checks = [
        ['html', html, c.html],
        ['edits', got.edits, c.edits || []],
        ['observations', got.obs, c.obs || []],
        ['suggestion', c.suggestion ? sug : r.suggestion, c.suggestion || null],
        ['commit', r.commitSuggest, c.commit || null],
        ['reinforced', r.reinforced, c.reinforced || []],
      ];
      for (const [k, g, want] of checks) if (!same(g, want)) fail('reply', c, `${k}: got ${show(g)}, want ${show(want)}`);
      for (const b of oracle(fragment, M.classifyUrl)) fail('reply', c, `oracle: ${b}`);
    } catch (e) { fail('reply', c, `threw ${e.stack}`); }
  }
  for (const c of corpus.stream) {
    const got = M.stripUnclosedTags(c.text);
    if (got !== c.out) fail('stream', c, `got ${show(got)}, want ${show(c.out)}`);
  }
  for (const c of corpus.layer1) {
    const got = M.stripActiveContent(c.text);
    if (got !== c.out) fail('layer1', c, `got ${show(got)}, want ${show(c.out)}`);
  }
  for (const c of corpus.layer2) {
    try {
      const { fragment, dropped } = M.sanitizeHtml(c.text, doc);
      const html = dom.serialize(fragment);
      if (html !== c.html) fail('layer2', c, `html: got ${show(html)}, want ${show(c.html)}`);
      const reasons = dropped.map((d) => d.reason);
      for (const want of c.dropped) if (!reasons.includes(want)) fail('layer2', c, `dropped: got ${show(reasons)}, want ${show(want)} among them`);
      for (const b of oracle(fragment, M.classifyUrl)) fail('layer2', c, `oracle: ${b}`);
    } catch (e) { fail('layer2', c, `threw ${e.stack}`); }
  }
  return fails;
}

(async () => {
  const total = corpus.reply.length + corpus.stream.length + corpus.layer1.length + corpus.layer2.length;
  const fails = runCorpus(await load(CHAT));
  console.log(`corpus: ${total - fails.length}/${total} cases hold against the real modules`);
  for (const f of fails) console.log(`  FAIL ${f}`);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'render-strips-'));
  const sources = Object.fromEntries(MODULES.map((f) => [f, fs.readFileSync(path.join(CHAT, f), 'utf8')]));
  const toothless = [];
  try {
    for (const [i, [name, file, find, repl]] of MUTATIONS.entries()) {
      const n = sources[file].split(find).length - 1;
      if (n !== 1) { toothless.push(`${name}: its source occurs ${n} times in ${file} (expected once)`); continue; }
      const dir = path.join(tmp, `m${i}`);
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
      for (const f of MODULES) fs.writeFileSync(path.join(dir, f), f === file ? sources[f].replace(find, () => repl) : sources[f]);
      const red = runCorpus(await load(dir)).length;
      if (red === 0) toothless.push(`${name}: no case went red with it removed`);
      else console.log(`  mutation ${name}: ${red} case(s) red`);
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  console.log(`mutations: ${MUTATIONS.length - toothless.length}/${MUTATIONS.length} protections are caught when removed`);
  for (const t of toothless) console.log(`  FAIL ${t}`);
  process.exit(fails.length || toothless.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
