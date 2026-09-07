#!/usr/bin/env node
/**
 * Custom-property evidence for the lessons' stylesheets.
 *
 * Proof that every var(--x) in both sheets under `references/bootstrap/_lesson-core/chat/`
 * resolves in BOTH themes, and that each still parses as the JS template literal it is.
 * `chat.css.js` (STYLES) is injected by all 41 lessons; `shell.css.js` (SHELL_STYLES) is
 * injected by LessonShell over the top, for the two lessons that render inside it.
 *
 * A custom property resolves where it is declared, not where it is used: an alias declared only
 * under `:root, .theme-dark` computes against the dark palette and inherits that value into a
 * `.theme-light` subtree. So "defined" here means declared in both theme blocks — or declared on
 * the very rule that uses it, which is how `.chat-panel-expanded` carries `--chat-content-w`.
 *
 * It also holds the one geometric invariant this sheet has that text can check: the equation
 * caption must stay inside the equation panel, which the restore made a containing block while it
 * is still a scroll container.
 *
 * Node only. No npm install, no network, no browser: the sheet is text, and each case parses the
 * text it is about. Runs in well under a second. Exit code 0 only when every check passes.
 *
 * What the cases assert is in README.md.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SKILL = path.resolve(__dirname, '..', '..');
const CHAT = path.join(SKILL, 'references', 'bootstrap', '_lesson-core', 'chat');
// Both sheets, because both are injected into a live lesson: chat.css.js by all 41 lessons,
// shell.css.js by LessonShell over the top for the two that render inside it.
const SHEETS = [
  { name: 'chat.css.js', file: path.join(CHAT, 'chat.css.js'), exportName: 'STYLES' },
  { name: 'shell.css.js', file: path.join(CHAT, 'shell.css.js'), exportName: 'SHELL_STYLES' },
];

let pass = 0;
const failures = [];
function check(what, ok, detail) {
  if (ok) { pass++; return; }
  failures.push(detail ? `${what}\n      ${detail}` : what);
}
function eq(what, got, want) {
  check(what, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}
function heading(n, text) { console.log(`\n${n}  ${text}`); }

// ---------------------------------------------------------------------------
// The analyser. Kept free of the real sheet so case 1 can drive it with fixtures
// of its own and pin down what it flags AND what it lets through.
// ---------------------------------------------------------------------------

// The CSS out of `export const STYLES = ` ... ` `. Returns null when the file is not shaped that
// way, which is itself a failure worth reporting rather than an empty pass.
function extractTemplate(js) {
  const open = js.indexOf('`');
  if (open === -1) return null;
  const close = js.lastIndexOf('`');
  if (close <= open) return null;
  return js.slice(open + 1, close);
}

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

// Flatten to (selector, body) pairs, one per rule that actually carries declarations. Walks
// braces with a depth counter so a rule inside @media or @keyframes is reached rather than
// swallowed whole; the selector recorded is the innermost one, which is the element the
// declarations land on and therefore where a custom property resolves.
function rules(css) {
  const out = [];
  const stack = [];
  let buf = '';
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === '{') {
      stack.push(buf.trim());
      buf = '';
    } else if (ch === '}') {
      const sel = stack.pop();
      // Declarations directly in this block belong to `sel`. A block whose content is only
      // nested rules leaves `buf` with no colon in it and contributes nothing.
      if (sel !== undefined && buf.includes(':')) out.push({ selector: sel.split(/\s+/).join(' '), body: buf });
      buf = '';
    } else {
      buf += ch;
    }
  }
  return out;
}

const DEFINED_RE = /(--[A-Za-z0-9_-]+)\s*:/g;
const USED_RE = /var\(\s*(--[A-Za-z0-9_-]+)\s*([,)])/g;

function namesDefined(body) {
  const out = new Set();
  // A `var(--x)` reference is `--x` followed by `)` or `,`, never `:`, so DEFINED_RE cannot
  // mistake a use for a declaration.
  for (const m of body.matchAll(DEFINED_RE)) out.add(m[1]);
  return out;
}
function namesUsed(body) {
  const out = new Map(); // name -> hasFallback
  for (const m of body.matchAll(USED_RE)) out.set(m[1], m[2] === ',');
  return out;
}

const isDarkSel = (s) => /(^|[\s,])(:root|\.theme-dark)([\s,]|$)/.test(s);
const isLightSel = (s) => /(^|[\s,])\.theme-light([\s,]|$)/.test(s);

// Declarations on one rule, as a map. Last one wins, which is what CSS does inside a block.
function decls(body) {
  const out = new Map();
  for (const d of body.split(';')) {
    const i = d.indexOf(':');
    if (i > 0) out.set(d.slice(0, i).trim(), d.slice(i + 1).trim());
  }
  return out;
}

/**
 * Whether an absolutely positioned child would be clipped by the ancestor it anchors to.
 * A rule that sets both `position: relative` and an overflow other than visible is a
 * containing block AND a scroll container, and the scrollable region does not extend past its
 * block-start padding edge: anything the child puts above that edge is clipped and cannot be
 * scrolled to. `overflow-x: auto` alone is enough, because a non-visible overflow-x computes
 * overflow-y to auto. Returns a reason, or null when the child is safe.
 */
function clippedByAncestor(css, childSel, ancestorSel) {
  const rs = rules(stripComments(css));
  const merge = (sel) => {
    const m = new Map();
    for (const r of rs) if (r.selector === sel) for (const [k, v] of decls(r.body)) m.set(k, v);
    return m;
  };
  const child = merge(childSel);
  const anc = merge(ancestorSel);
  if (!child.size) return `${childSel} has no rule in this sheet`;
  if (!anc.size) return `${ancestorSel} has no rule in this sheet`;
  if (child.get('position') !== 'absolute') return null;      // not anchored to anything
  const scrolls = [...anc].some(([k, v]) => k.startsWith('overflow') && v !== 'visible');
  if (anc.get('position') !== 'relative' || !scrolls) return null;
  const top = parseFloat(child.get('top'));
  if (Number.isFinite(top) && top < 0) {
    return `${childSel} sits ${-top}px above the padding box of ${ancestorSel}, which is a scroll `
      + 'container, so that much of it is clipped and unreachable';
  }
  return null;
}

/**
 * Every var(--x) that will not resolve. Returns a sorted array of
 * { name, where, reason } — `where` is the selector of the rule that uses it.
 */
function unresolvedVars(css) {
  const rs = rules(stripComments(css));
  const dark = new Set();
  const light = new Set();
  for (const r of rs) {
    const defs = namesDefined(r.body);
    if (isDarkSel(r.selector)) for (const n of defs) dark.add(n);
    if (isLightSel(r.selector)) for (const n of defs) light.add(n);
  }
  const bad = [];
  for (const r of rs) {
    const own = namesDefined(r.body);
    for (const [name, hasFallback] of namesUsed(r.body)) {
      if (own.has(name)) continue;        // self-scoped on the rule that uses it
      if (hasFallback) continue;          // var(--x, fallback) paints the fallback
      const inDark = dark.has(name);
      const inLight = light.has(name);
      if (inDark && inLight) continue;
      const reason = !inDark && !inLight ? 'declared in neither theme'
        : inDark ? 'declared only in the dark theme, so .theme-light inherits the dark value'
          : 'declared only in the light theme, so the dark theme inherits nothing';
      bad.push({ name, where: r.selector, reason });
    }
  }
  bad.sort((a, b) => a.name.localeCompare(b.name) || a.where.localeCompare(b.where));
  return bad;
}

(async function main() {
  // -------------------------------------------------------------------------
  heading(1, 'the analyser flags what it must and lets through what it must not');
  {
    // Its own fixture, built here: this case is about the analyser, so it must not depend on
    // what the real sheet happens to contain today.
    const both = `
      :root, .theme-dark { --ink: #eee; --canvas: #000; }
      .theme-light { --ink: #111; --canvas: #fff; }
      .a { color: var(--ink); background: var(--canvas); }
    `;
    eq('a var declared in both themes is not flagged', unresolvedVars(both).length, 0);

    const missing = `
      :root, .theme-dark { --ink: #eee; }
      .theme-light { --ink: #111; }
      .a { color: var(--ink); border-color: var(--nowhere); }
    `;
    const m = unresolvedVars(missing);
    eq('a var declared in neither theme is flagged', m.length, 1);
    eq('…by name', m[0] && m[0].name, '--nowhere');
    check('…and says where it was used', m[0] && m[0].where === '.a', JSON.stringify(m[0]));

    // The gotcha this fixture exists for. `--ink` here resolves against the dark palette and
    // inherits that computed value into .theme-light, so the light theme silently paints dark.
    const darkOnly = `
      :root, .theme-dark { --text: #eee; --ink: var(--text); }
      .theme-light { --text: #111; }
      .a { color: var(--ink); }
    `;
    const d = unresolvedVars(darkOnly);
    eq('a var declared in only one theme is flagged', d.length, 1);
    eq('…by name', d[0] && d[0].name, '--ink');
    check('…and the reason names the theme that goes wrong',
      d[0] && /only in the dark theme/.test(d[0].reason), JSON.stringify(d[0]));

    // The exemption. `--chat-content-w` is declared and used on one rule and never needs a theme.
    const selfScoped = `
      :root, .theme-dark { --ink: #eee; }
      .theme-light { --ink: #111; }
      .panel { --w: 768px; width: calc(100vw - var(--w) - 24px); color: var(--ink); }
    `;
    eq('a var declared on the rule that uses it is not flagged', unresolvedVars(selfScoped).length, 0);

    // Reach: a rule nested in @media or @keyframes is walked, not skipped.
    const nested = `
      :root, .theme-dark { --ink: #eee; }
      .theme-light { --ink: #111; }
      @media (max-width: 480px) { .a { color: var(--ink); background: var(--gone); } }
      @keyframes flash { 0% { outline-color: var(--alsogone); } 100% { outline-color: transparent; } }
    `;
    const n = unresolvedVars(nested).map((b) => b.name);
    check('a var used inside @media is reached', n.includes('--gone'), n.join(' '));
    check('…and one inside @keyframes', n.includes('--alsogone'), n.join(' '));
    check('…while the resolvable one beside them stays quiet', !n.includes('--ink'), n.join(' '));

    // A comment that names a class must not be read as a selector, and a declaration inside a
    // comment must not count as defining anything. This is the mistake that produced a wrong
    // candidate sheet during the restore: a parser that took everything before the `{` as the
    // selector swallowed the comment above it.
    const commented = `
      :root, .theme-dark { --ink: #eee; }
      .theme-light { --ink: #111; }
      /* .b gets --ghost: #f00; from somewhere */
      .a { color: var(--ghost); }
    `;
    const c = unresolvedVars(commented);
    eq('a declaration inside a comment does not count as defining it', c.length, 1);
    eq('…so the use is still flagged', c[0] && c[0].name, '--ghost');
  }

  // -------------------------------------------------------------------------
  heading(2, 'each shipped sheet resolves every var it uses, in both themes');
  for (const sheet of SHEETS) {
    const js = fs.readFileSync(sheet.file, 'utf8');
    const css = extractTemplate(js);
    check(`${sheet.name} exports a template literal`, css !== null,
      `no template literal found; ${sheet.exportName} is not one`);
    if (!css) continue;
    const bad = unresolvedVars(css);
    check(`${sheet.name}: every var(--x) resolves in both themes`, bad.length === 0,
      bad.map((b) => `${b.name} used by ${b.where} — ${b.reason}`).join('\n      '));
  }

  // -------------------------------------------------------------------------
  heading(3, 'chat.css.js declares the tokens its forward-ported rules ask for');
  {
    // The restore appended rules written against a different palette, and they arrived asking
    // for these twelve — every one of them unset, so the equation Explain button, the chat panel
    // and the KaTeX splash painted as if the properties had never been named. Listed rather than
    // counted: a regression that drops one back to unset should say which one.
    const forwardPorted = ['--accent-hover', '--canvas', '--danger', '--ease', '--font-mono',
      '--ink', '--ink-2', '--ink-3', '--ink-4', '--surface', '--surface-2', '--t-micro'];
    const css = extractTemplate(fs.readFileSync(SHEETS[0].file, 'utf8'));
    check('chat.css.js is readable as CSS', css !== null);
    if (css) {
      const dark = new Set();
      const light = new Set();
      for (const r of rules(stripComments(css))) {
        const defs = namesDefined(r.body);
        if (isDarkSel(r.selector)) for (const n of defs) dark.add(n);
        if (isLightSel(r.selector)) for (const n of defs) light.add(n);
      }
      const missingDark = forwardPorted.filter((n) => !dark.has(n));
      const missingLight = forwardPorted.filter((n) => !light.has(n));
      check('the twelve forward-ported tokens are declared in the dark theme',
        missingDark.length === 0, missingDark.join(' '));
      check('…and in the light theme', missingLight.length === 0, missingLight.join(' '));
    }
  }

  // -------------------------------------------------------------------------
  heading(4, 'each sheet still parses as the JS template literal it is');
  for (const sheet of SHEETS) {
    const js = fs.readFileSync(sheet.file, 'utf8');
    // One backtick inside the CSS ends the literal early and the build dies on "Expected a
    // semicolon" — it has cost a build once. Two is the correct count: the pair that delimits it.
    eq(`${sheet.name}: exactly two backticks, the pair that delimits ${sheet.exportName}`,
      (js.match(/`/g) || []).length, 2);
    const css = extractTemplate(js);
    if (css !== null) {
      // `${` inside the CSS would interpolate rather than paint.
      check(`${sheet.name}: no interpolation in the CSS`, !css.includes('${'),
        'a ${ in the sheet is substituted at build time, not painted');
      let depth = 0;
      let min = 0;
      for (const ch of stripComments(css)) {
        if (ch === '{') depth++;
        else if (ch === '}') { depth--; if (depth < min) min = depth; }
      }
      eq(`${sheet.name}: braces balance`, depth, 0);
      eq('…and never close below the top level', min, 0);
    }
    check(`${sheet.name} exports ${sheet.exportName}`,
      new RegExp(`export\\s+const\\s+${sheet.exportName}\\s*=`).test(js));
  }

  // -------------------------------------------------------------------------
  heading(5, 'the equation caption is not clipped by the equation panel');
  {
    // Its own fixtures first: the analyser must flag the clipped arrangement and stay quiet on
    // the two that are fine, or the assertion below proves nothing.
    const clipped = `.p { position: relative; overflow-x: auto; } .c { position: absolute; top: -8px; }`;
    const visible = `.p { position: relative; overflow: visible; } .c { position: absolute; top: -8px; }`;
    const inside = `.p { position: relative; overflow-x: auto; } .c { position: absolute; top: 0; }`;
    check('a negative top inside a scroll container is flagged',
      /clipped and unreachable/.test(clippedByAncestor(clipped, '.c', '.p') || ''),
      String(clippedByAncestor(clipped, '.c', '.p')));
    eq('…not flagged when the ancestor stays visible', clippedByAncestor(visible, '.c', '.p'), null);
    eq('…nor when the child sits inside the padding box', clippedByAncestor(inside, '.c', '.p'), null);

    // The shipped sheet. .eq-block is the classic beige panel: position: relative (this restore
    // added it, to anchor the Explain rail) plus the classic overflow-x: auto for wide equations.
    // So <Eq label> renders whole only while .eq-label stays inside the padding box.
    const css = extractTemplate(fs.readFileSync(SHEETS[0].file, 'utf8'));
    const why = css && clippedByAncestor(css, '.eq-label', '.eq-block');
    check('chat.css.js: .eq-label is not clipped by .eq-block', why === null, String(why));
    // And it paints on the panel's own fill, not the page fill, or it reads as a hole in the panel.
    const labelBg = css && (() => {
      for (const r of rules(stripComments(css))) if (r.selector === '.eq-label') {
        const b = decls(r.body).get('background');
        if (b) return b;
      }
      return null;
    })();
    eq('…on the panel fill rather than the page fill', labelBg, 'var(--bg-eq)');
  }

  console.log('');
  for (const f of failures) console.log(`  FAIL  ${f}`);
  console.log(`\n${pass}/${pass + failures.length} checks passed`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => {
  console.error((e && e.stack) || e);
  process.exit(1);
});
