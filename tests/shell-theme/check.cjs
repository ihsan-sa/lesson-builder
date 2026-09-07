#!/usr/bin/env node
/**
 * Evidence that a lesson rendered through LessonShell has a working dark/light switch.
 *
 * The shell used to hardcode `theme-light` on its root and on the tutor pop-out's host, and
 * shell.css.js declared one palette, so the DARK button the 39 pre-shell lessons carry had no
 * counterpart here. The mechanism now is a class on the shell root plus the same class on the
 * pop-out's host and its <html>; both palettes live in the sheet, so everything styled from the
 * tokens repaints on the class change with nothing re-rendering.
 *
 * This fixture is text-only, and text is enough for three ways that mechanism breaks: a palette
 * class written as a literal somewhere the theme cannot reach it, a token declared in one theme
 * block but not the other, and a lesson that paints an SVG from THEMES_G while leaving the theme
 * to the shell — which gets a dark page with light-palette graphs on it. What text cannot check —
 * that the built page actually paints both ways, uncontrolled lesson and pop-out included — is
 * tests/shell-theme/README.md's by-hand demonstration, tests/shell-theme/run.sh.
 *
 * Node only. No npm install, no network, no browser. Runs in well under a second.
 * Exit code 0 only when every check passes.
 *
 * What the cases assert is in README.md.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SKILL = path.resolve(__dirname, '..', '..');
const CORE = path.join(SKILL, 'references', 'bootstrap', '_lesson-core');
const SHELL_JSX = path.join(CORE, 'ui', 'LessonShell.jsx');
const SHELL_CSS = path.join(CORE, 'chat', 'shell.css.js');

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
// The analysers. Kept free of the real files so cases 1 and 3 can drive them
// with fixtures of their own and pin down what they flag AND what they let through.
// ---------------------------------------------------------------------------

// Line and block comments removed, newlines kept so line numbers still line up. A comment that
// mentions a palette class is prose about the mechanism, not a use of it.
function stripJsComments(js) {
  return js
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}

// Every place the source names a palette class, as { line, text }. `text` is the whole line, so a
// failure prints the site rather than just a count.
function themeClassSites(js) {
  const lines = stripJsComments(js).split('\n');
  const out = [];
  lines.forEach((text, i) => {
    if (/theme-(light|dark)/.test(text)) out.push({ line: i + 1, text: text.trim() });
  });
  return out;
}

// The CSS out of `export const SHELL_STYLES = ` ... ` `. Everything below reads THIS, never the
// .js around it: the module header is a `//` comment that names both palette classes while
// explaining them, and a rule walker handed the whole file takes that header as the selector of
// the first rule — which quietly counted the dark block's tokens as declared in the light one and
// made case 3's headline check unfailable in one direction. Returns null when the file is not
// shaped as one template literal, which is a failure worth reporting rather than an empty pass.
function extractTemplate(js) {
  const open = js.indexOf('`');
  if (open === -1) return null;
  const close = js.lastIndexOf('`');
  if (close <= open) return null;
  return js.slice(open + 1, close);
}

// Flatten CSS to (selector, body) pairs, one per rule that carries declarations.
function rules(css) {
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(noComments))) {
    out.push({ selector: m[1].trim().split(/\s+/).join(' '), body: m[2] });
  }
  return out;
}

const isPaletteBlock = (sel) => /(^|[\s,])(:root|\.theme-dark|\.theme-light)([\s,]|$)/.test(sel);

// Rules outside the two palette blocks that write a colour as a literal. A literal cannot follow
// the switch: it is one colour in both themes, which is how the tutor tab-strip hovers stayed the
// light canvas and painted near-white over a dark strip.
function literalColourSites(css) {
  const out = [];
  for (const r of rules(css)) {
    if (isPaletteBlock(r.selector)) continue;
    const found = r.body.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g);
    if (found) out.push({ selector: r.selector, body: r.body.trim().replace(/\s+/g, ' ') });
  }
  return out;
}

// The custom properties each theme block of a sheet declares. Same selector convention as
// chat.css.js and tests/css-vars-defined: `:root, .theme-dark` is the dark block, `.theme-light`
// the light one.
function paletteTokens(css) {
  const blocks = { dark: new Set(), light: new Set() };
  for (const r of rules(css)) {
    const names = [...r.body.matchAll(/(--[A-Za-z0-9_-]+)\s*:/g)].map((d) => d[1]);
    if (/(^|[\s,])(:root|\.theme-dark)([\s,]|$)/.test(r.selector)) for (const n of names) blocks.dark.add(n);
    if (/(^|[\s,])\.theme-light([\s,]|$)/.test(r.selector)) for (const n of names) blocks.light.add(n);
  }
  return blocks;
}

// Tokens one block declares and the other does not, both ways round.
function tokenGaps(css) {
  const { dark, light } = paletteTokens(css);
  return {
    missingFromDark: [...light].filter((n) => !dark.has(n)).sort(),
    missingFromLight: [...dark].filter((n) => !light.has(n)).sort(),
  };
}

// The hook call that mentions `needle`: from the `hook(` that opens it to the `]);` that closes
// its dependency array. Enough to read what the effect does, what it cleans up and what it is
// keyed on, without pulling a parser in for four lines of source.
function hookBlock(js, hook, needle) {
  const at = js.indexOf(needle);
  if (at === -1) return null;
  const open = js.lastIndexOf(`${hook}(`, at);
  if (open === -1) return null;
  const close = js.indexOf(']);', at);
  if (close === -1) return null;
  return js.slice(open, close + 3);
}

// ── The graph-theme trap ────────────────────────────────────────────────────
// references/template.md: "Graph colors do not [follow the class]: they are JS values, so
// pass theme={theme} and onThemeChange={setTheme} and rebind G = THEMES_G[theme] in the
// component body. Omit both props and the shell keeps the choice itself, which is right
// for a lesson with no SVG graphs."
//
// So the rule is conditional, and reading it the other way round is the mistake: omitting
// the props is not wrong in itself, it is wrong FOR A LESSON WHOSE SVG PAINTS FROM G.
// That lesson gets a dark page with light-palette graphs on it, which is what both lessons
// on the shell ship today.
//
// What text can see: which props the <LessonShell> tag carries, whether any JSX colour
// attribute reads G, and whether some line rebinds G from a theme. What it cannot see is
// whether the value handed to theme= is really state, or whether the rebind runs on every
// render — browser.cjs reads those off a real page.

// The opening <LessonShell ...> tag as text. Scanned with brace depth rather than to the
// first `>`: `tutor={<Chatbot ... />}` puts a `>` inside a prop value, and stopping there
// reads a lesson's props as ending before `theme=` is ever reached.
function shellPropsTag(js) {
  const at = js.indexOf('<LessonShell');
  if (at === -1) return null;
  let depth = 0;
  for (let i = at; i < js.length; i++) {
    const c = js[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) return js.slice(at, i + 1);
  }
  return null;
}

// Lines carrying a JSX colour attribute whose value reads the graph palette binding:
// fill={G.bg}, stroke={G.gold}, stopColor={G.axis}. These are attributes on the rendered
// SVG, so no class swap reaches them. One entry per line, like themeClassSites, so a
// failure prints the site rather than a count.
function graphColourSites(js) {
  const lines = stripJsComments(js).split('\n');
  const out = [];
  lines.forEach((text, i) => {
    if (/\b(fill|stroke|color|stopColor|floodColor)=\{[^}]*\bG\./.test(text)) {
      out.push({ line: i + 1, text: text.trim() });
    }
  });
  return out;
}

// `ok` is the verdict a caller acts on; the rest is there so a failure prints why.
function graphThemeAudit(js) {
  const src = stripJsComments(js);
  const tag = shellPropsTag(src) || '';
  const graphs = graphColourSites(js);
  const theme = /\btheme=\{/.test(tag);
  const onChange = /\bonThemeChange=\{/.test(tag);
  const rebinds = /\bG\s*=\s*THEMES_G\[/.test(src);
  return { graphs, theme, onChange, rebinds, ok: graphs.length === 0 || (theme && onChange && rebinds) };
}
function auditDetail(a) {
  return `${a.graphs.length} SVG colour(s) from G`
    + `, theme= ${a.theme}, onThemeChange= ${a.onChange}, rebinds G ${a.rebinds}`;
}

// The text between the open tag and </button> of the button carrying `cls`.
function buttonLabel(js, cls) {
  const at = js.indexOf(`className="${cls}"`);
  if (at === -1) return null;
  const open = js.indexOf('>', at);
  const close = js.indexOf('</button>', open);
  if (open === -1 || close === -1) return null;
  return js.slice(open + 1, close).trim();
}

(async function main() {
  // -------------------------------------------------------------------------
  heading(1, 'the site finder reads code and not prose');
  {
    // Its own fixtures: this case is about the finder, so it must not depend on what
    // LessonShell.jsx happens to contain today.
    const hardcoded = `const a = 1;\nreturn <div className="lesson-shell theme-light" />;\n`;
    const derived = `const themeClass = t === "dark" ? "theme-dark" : "theme-light";\n`
      + `return <div className={\`lesson-shell \${themeClass}\`} />;\n`;
    const prose = `// the root used to say theme-light here\n/* and theme-dark in a block */\nconst x = 1;\n`;

    eq('a literal palette class in JSX is a site', themeClassSites(hardcoded).length, 1);
    eq('…on the line it is written', themeClassSites(hardcoded)[0].line, 2);
    // The derived form has one site — the line that maps a theme to a class — and the JSX that
    // uses it has none. Both halves matter: a finder that also flagged `${themeClass}` would make
    // case 2 unpassable, and one that flagged nothing would make it meaningless.
    eq('deriving the class counts as one site, on the mapping line', themeClassSites(derived).length, 1);
    eq('…and the JSX that interpolates it is not a site', themeClassSites(derived)[0].line, 1);
    eq('a palette class named only in a comment is not a site', themeClassSites(prose).length, 0);
  }

  // -------------------------------------------------------------------------
  heading(2, 'LessonShell names a palette class only where it derives one');
  {
    const js = fs.readFileSync(SHELL_JSX, 'utf8');
    const sites = themeClassSites(js);
    const detail = sites.map((s) => `${s.line}: ${s.text}`).join('\n      ');
    eq('exactly one line in LessonShell.jsx names a palette class', sites.length, 1);
    check('…and it is the one deriving themeClass from theme',
      sites.length === 1 && /themeClass\s*=\s*theme === "dark" \? "theme-dark" : "theme-light"/.test(sites[0].text),
      detail);
    // The three elements that must carry it. The pop-out is a second document: the host holds the
    // panel, and its <html> is what the injected `html,body{background:var(--surface)}` paints
    // from — a custom property resolves where it is declared, so without the class on the
    // document element the paper behind the panel keeps whatever :root carries.
    check('the shell root takes the derived class',
      /className=\{`lesson-shell \$\{themeClass\}/.test(js));
    check('the pop-out host takes it', /host\.className = themeClass;/.test(js));
    check('…and so does the pop-out document element',
      /documentElement\.className = themeClass;/.test(js));
    // Opening the pop-out is not the only moment: switching the theme with one already open has
    // to reach into it too, which is an effect that re-runs on themeClass.
    check('an effect re-applies it to an already-open pop-out',
      /popupHost\.className = themeClass;[\s\S]{0,220}\}, \[popupHost, themeClass\]\);/.test(js));

    // And the main document's own <html>, which is what the sheet's html,body rule paints from.
    // A LAYOUT effect: a plain one runs after the paint, so the page would show one frame of the
    // palette :root carries around a shell already in the other.
    const rootEffect = hookBlock(js, 'useLayoutEffect', 'document.documentElement');
    check('a layout effect puts the class on the main document element', Boolean(rootEffect),
      'no useLayoutEffect touching document.documentElement');
    if (rootEffect) {
      check('…adding it', /classList\.add\(themeClass\)/.test(rootEffect), rootEffect);
      check('…removing it again on the way out', /classList\.remove\(themeClass\)/.test(rootEffect),
        rootEffect);
      check('…and keyed on themeClass, so switching re-runs it',
        /\}, \[themeClass\]\);$/.test(rootEffect.trim()), rootEffect);
    }
  }

  // -------------------------------------------------------------------------
  heading(3, 'shell.css.js declares the same tokens in both palettes');
  // Labelled so an unreadable sheet leaves THIS case and not main(): a bare `return` here would
  // skip case 4, the summary and the exit code, and the run would report success.
  sheet: {
    // Fixtures first, so the assertion on the real sheet means something.
    const matched = `:root, .theme-dark { --ink: #eee; --canvas: #000; }\n.theme-light { --ink: #111; --canvas: #fff; }`;
    const lightShort = `:root, .theme-dark { --ink: #eee; --canvas: #000; }\n.theme-light { --ink: #111; }`;
    const darkShort = `:root, .theme-dark { --ink: #eee; }\n.theme-light { --ink: #111; --canvas: #fff; }`;
    eq('a matched pair has no gaps',
      tokenGaps(matched).missingFromDark.length + tokenGaps(matched).missingFromLight.length, 0);
    check('a token the light block omits is reported against light',
      tokenGaps(lightShort).missingFromLight.join(' ') === '--canvas'
      && tokenGaps(lightShort).missingFromDark.length === 0,
      JSON.stringify(tokenGaps(lightShort)));
    check('a token the dark block omits is reported against dark',
      tokenGaps(darkShort).missingFromDark.join(' ') === '--canvas'
      && tokenGaps(darkShort).missingFromLight.length === 0,
      JSON.stringify(tokenGaps(darkShort)));

    // The shape the real file is in, and the reason everything below reads the template literal
    // rather than the .js: the module header is a `//` comment that names both palette classes.
    // Handed the whole file, a rule walker reads that header as the first rule's selector, adds
    // the dark block's tokens to the LIGHT set as well, and then no gap in the dark block can
    // ever be reported. The fixture has exactly that header and a real gap under it.
    const asShipped = [
      '// :root, .theme-dark carries the dark palette and .theme-light the light one.',
      'export const SHELL_STYLES = `',
      ':root, .theme-dark { --ink: #eee; --canvas: #000; }',
      '.theme-light { --ink: #111; }',
      '`;',
    ].join('\n');
    check('the header comment naming both classes does not hide a gap',
      tokenGaps(extractTemplate(asShipped)).missingFromLight.join(' ') === '--canvas',
      JSON.stringify(tokenGaps(extractTemplate(asShipped))));
    check('…and reading the .js instead of the literal is what hid it',
      tokenGaps(asShipped).missingFromLight.length === 0,
      'the whole-file reading now reports the gap too, so this case no longer says anything');

    // Literal colours, on fixtures of their own.
    const tokenised = '.a:hover { background: var(--tab-hover); }';
    const literal = '.a:hover { background: rgba(250, 249, 246, 0.5); }';
    const inPalette = ':root, .theme-dark { --tab-hover: rgba(14, 16, 20, 0.5); }';
    eq('a rule painting from a token is not a literal site', literalColourSites(tokenised).length, 0);
    eq('a rule painting from a literal is', literalColourSites(literal).length, 1);
    eq('…while a literal inside a palette block is where colours belong',
      literalColourSites(inPalette).length, 0);

    const js = fs.readFileSync(SHELL_CSS, 'utf8');
    const css = extractTemplate(js);
    check('shell.css.js exports a template literal', css !== null, 'SHELL_STYLES is not one');
    if (!css) break sheet;
    const { dark, light } = paletteTokens(css);
    check('shell.css.js has a dark palette block', dark.size > 0,
      'no rule matching :root or .theme-dark declares a custom property');
    check('…and a light one', light.size > 0);
    const gaps = tokenGaps(css);
    check('every token is declared in both', gaps.missingFromDark.length === 0 && gaps.missingFromLight.length === 0,
      `missing from the dark block: ${gaps.missingFromDark.join(' ') || 'none'}\n`
      + `      missing from the light block: ${gaps.missingFromLight.join(' ') || 'none'}`);
    // The switch is a class swap on one element, so the two palettes must differ somewhere or
    // pressing it does nothing visible.
    const declared = (sel, name) => {
      const re = new RegExp(`${sel}\\s*\\{[^}]*${name}:\\s*([^;]+);`);
      const m = css.match(re);
      return m ? m[1].trim() : null;
    };
    const darkCanvas = declared(':root, \\.theme-dark', '--canvas');
    const lightCanvas = declared('\\n\\.theme-light', '--canvas');
    check('the two palettes actually differ on --canvas',
      Boolean(darkCanvas) && Boolean(lightCanvas) && darkCanvas !== lightCanvas,
      `dark ${darkCanvas}, light ${lightCanvas}`);

    // Every other rule has to go through a token, or it is one colour in both themes.
    const literals = literalColourSites(css);
    check('no rule outside the palette blocks writes a colour as a literal', literals.length === 0,
      literals.map((r) => `${r.selector} { ${r.body} }`).join('\n      '));

    // The page behind the shell. Without this the UA's body margin frames a dark lesson in white
    // and a scroll runs past the shell onto white.
    const htmlBody = rules(css).find((r) => /^html, ?body$/.test(r.selector));
    check('the sheet resets html and body', Boolean(htmlBody),
      'no `html, body` rule in SHELL_STYLES');
    if (htmlBody) {
      check('…and paints them from --canvas', /background:\s*var\(--canvas\)/.test(htmlBody.body),
        htmlBody.body.trim());
      check('…with the UA margin gone', /margin:\s*0/.test(htmlBody.body), htmlBody.body.trim());
    }
  }

  // -------------------------------------------------------------------------
  heading(4, 'the switch is labelled with the theme it switches to');
  {
    const js = fs.readFileSync(SHELL_JSX, 'utf8');
    const label = buttonLabel(js, 'theme-toggle');
    check('the top bar has a .theme-toggle button', label !== null,
      'no <button className="theme-toggle"> in LessonShell.jsx');
    if (label) {
      // Evaluate the label expression at both themes. Reading DARK in the light theme is the
      // whole point — it is the button the pre-shell lessons put in their header, and the word
      // the reader goes looking for.
      const expr = label.replace(/^\{/, '').replace(/\}$/, '');
      const read = (theme) => new Function('theme', `return (${expr});`)(theme);
      eq('in the light theme it reads Dark', read('light'), 'Dark');
      eq('in the dark theme it reads Light', read('dark'), 'Light');
    }
    // Outside the tutor gate: a build with no tutor still has a reader who wants dark.
    const toggleAt = js.indexOf('className="theme-toggle"');
    const gateAt = js.indexOf('{tutorEnabled && (');
    check('the switch is not inside the tutor gate', toggleAt !== -1 && gateAt !== -1 && toggleAt < gateAt,
      `theme-toggle at ${toggleAt}, tutor gate opens at ${gateAt}`);
  }

  // -------------------------------------------------------------------------
  heading(5, 'a lesson with graphs is not allowed to leave the theme to the shell');
  {
    // Fixtures first, each built here, so the assertion on the real lesson bodies below
    // means something. The graph body and the shell mount are the same in all of them;
    // only the props and the rebind move.
    const graph = 'let G = THEMES_G.light;\n'
      + 'const T = () => (\n  <svg>\n    <rect fill={G.bg} />\n    <path stroke={G.gold} />\n  </svg>\n);\n';
    const mount = (props) => `const A = () => (\n  <LessonShell courseCode="X"${props}>\n    {body}\n  </LessonShell>\n);\n`;
    const rebind = 'G = THEMES_G[theme];\n';

    const held = graph + rebind + mount(' theme={theme} onThemeChange={setTheme}');
    const neither = graph + mount('');
    const halfWay = graph + rebind + mount(' theme={theme}');
    const propsNoRebind = graph + mount(' theme={theme} onThemeChange={setTheme}');
    const noGraphs = 'const T = () => <p>no svg here</p>;\n' + mount('');

    check('a lesson that holds the theme and rebinds G passes', graphThemeAudit(held).ok,
      auditDetail(graphThemeAudit(held)));
    check('…and it is not passing by having no graphs to check', graphThemeAudit(held).graphs.length === 2,
      auditDetail(graphThemeAudit(held)));
    check('omitting both props with graphs on the page is the trap, and fails',
      !graphThemeAudit(neither).ok, auditDetail(graphThemeAudit(neither)));
    check('passing only theme= fails too — the shell would never hand a change back',
      !graphThemeAudit(halfWay).ok, auditDetail(graphThemeAudit(halfWay)));
    check('passing both props without rebinding G fails — the SVG still cannot move',
      !graphThemeAudit(propsNoRebind).ok, auditDetail(graphThemeAudit(propsNoRebind)));
    // The other half of the rule, and the half that makes it a rule rather than a ban:
    // template.md says omitting both props is RIGHT for a lesson with no SVG graphs. A
    // check that failed this one would be telling every plain lesson to take state it
    // does not need.
    check('a lesson with no graphs may leave the theme to the shell', graphThemeAudit(noGraphs).ok,
      auditDetail(graphThemeAudit(noGraphs)));

    // The tag scan, on a mount shaped like the real one: `tutor={<Chatbot ... />}` before
    // the theme props. Reading to the first `>` stops inside the Chatbot and reports a
    // lesson that does everything right as the trap.
    const tutorFirst = graph + rebind
      + 'const A = () => (\n  <LessonShell tutor={<Chatbot open={o} />} theme={theme} onThemeChange={setTheme}>\n'
      + '    {body}\n  </LessonShell>\n);\n';
    check('a `>` inside an earlier prop value does not hide the theme props',
      graphThemeAudit(tutorFirst).ok, auditDetail(graphThemeAudit(tutorFirst)));
    // And a commented-out graph is not a graph.
    const commentedGraph = '// <rect fill={G.bg} />\n' + mount('');
    check('a colour attribute named only in a comment is not a graph site',
      graphThemeAudit(commentedGraph).graphs.length === 0, auditDetail(graphThemeAudit(commentedGraph)));

    // The two lesson bodies this directory ships, which are the only lesson sources in
    // this repo — the lessons that ship on the shell live in another one, so this case
    // guards the fixtures and states the rule; it cannot see those. run.sh builds both of
    // these and browser.cjs presses the switch on each.
    const LESSONS = path.join(__dirname, 'lesson');
    const demo = fs.readFileSync(path.join(LESSONS, 'theme_demo.jsx'), 'utf8');
    const uncontrolled = fs.readFileSync(path.join(LESSONS, 'theme_uncontrolled.jsx'), 'utf8');
    const demoAudit = graphThemeAudit(demo);
    const unAudit = graphThemeAudit(uncontrolled);
    check('theme_demo.jsx draws from G and holds the theme, so it passes', demoAudit.ok,
      auditDetail(demoAudit));
    check('…and it really does have graphs to hold it for', demoAudit.graphs.length > 0,
      auditDetail(demoAudit));
    check('theme_uncontrolled.jsx draws from G and passes neither prop, so it is flagged',
      !unAudit.ok, auditDetail(unAudit));
    check('…and it is flagged for the props, not for a missing SVG',
      unAudit.graphs.length > 0 && !unAudit.theme && !unAudit.onChange, auditDetail(unAudit));
  }

  // -------------------------------------------------------------------------
  console.log();
  for (const f of failures) console.log(`  FAIL  ${f}`);
  console.log(`\n${pass}/${pass + failures.length} checks passed`);
  process.exit(failures.length === 0 ? 0 : 1);
})();
