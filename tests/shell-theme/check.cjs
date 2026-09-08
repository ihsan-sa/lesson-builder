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
 * This fixture runs no browser, and reading the source is enough for three ways that mechanism
 * breaks: a palette class written as a literal somewhere the theme cannot reach it, a token
 * declared in one theme block but not the other, and a lesson that paints an SVG from THEMES_G
 * while leaving the theme to the shell — which gets a dark page with light-palette graphs on it.
 * The sheet and the shell component are read as text; a lesson body is read as a syntax tree,
 * because telling a colour attribute from prose that mentions one is a question about the
 * grammar and four scans in a row got it wrong. What no reading of the source can check —
 * that the built page actually paints both ways, uncontrolled lesson and pop-out included — is
 * tests/shell-theme/README.md's by-hand demonstration, tests/shell-theme/run.sh.
 *
 * Node plus one dependency: `@babel/parser`, at the version the lesson template pins, because
 * case 5 reads a lesson body as a syntax tree rather than as text. Installed from the npm cache
 * the way tests/ast-inventory installs it. No browser, no model. Runs in about a second.
 * Exit code 0 only when every check passes.
 *
 * What the cases assert is in README.md.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

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
// keyed on. The parser below is for the lesson bodies case 5 reads; four lines of the shell's
// own source do not need one.
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
// What the source can show: which props the <LessonShell> tag carries, whether any JSX colour
// attribute reads G, and whether some line rebinds G from a theme. What it cannot show is
// whether the value handed to theme= is really state, or whether the rebind runs on every
// render — browser.cjs reads those off a real page.

// The opening <LessonShell ...> tag as text — this one asks which props a tag carries, not
// whether a run of characters is code, so it is not the question the parse below answers.
// Scanned with brace depth rather than to the first `>`: `tutor={<Chatbot ... />}` puts a `>`
// inside a prop value, and stopping there reads a lesson's props as ending before `theme=` is
// ever reached.
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

// ── Code or running text: a question for the grammar ───────────────────────
// Four hand-written answers to it each bought one quoting shape and lost the next. A line-at-a-time
// scan lost a colour a formatter had wrapped. Scanning the whole source reported help text that
// only MENTIONS `fill={ … G.bg` as a graph site. Blanking string bodies let `the reader\'s guide`
// blank every colour below it. Asking what abuts each quote let
// `<text>it\'s</text><rect fill={G.bg} /><text>Bob\'s</text>` lose its only site — and still lost it
// in `<text>the \'90s</text><rect fill={G.bg} /><text>students\' work</text>`, where the quote before
// the colour opens a string JS would accept and the one after it closes one, so the colour is
// blanked and a lesson that paints from the palette while passing neither theme prop audits clean.
// Silently: nothing is printed and the check reports success, which is the failure this file exists
// to stop.
//
// There is no fifth quote rule here. JSX prose is not JavaScript text, so no rule about quotes can
// tell the two apart; only the grammar can. The lesson is parsed, and a comment, a string body, a
// template literal\'s text and JSX prose stop being special cases — none of them is a JSXAttribute.

// The parser, brought in the way tests/ast-inventory brings it: the version the lesson template
// pins, from the npm cache when it is warm. One install for the run, in a directory of this
// fixture\'s own, removed on exit.
function loadParser() {
  const pkg = JSON.parse(fs.readFileSync(
    path.join(SKILL, 'references', 'bootstrap', 'lesson-template', 'package.json'), 'utf8'));
  const spec = `@babel/parser@${pkg.devDependencies['@babel/parser']}`;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-theme-deps-'));
  process.on('exit', () => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"shell-theme-deps","private":true}\n');
  const r = spawnSync('npm', ['install', '--no-save', '--silent', '--prefer-offline', spec],
    { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) {
    process.stderr.write(`could not install ${spec}:\n${r.stderr || r.stdout}\n`);
    process.exit(1);
  }
  return require(path.join(root, 'node_modules', '@babel', 'parser'));
}
const parser = loadParser();

// The lesson as a syntax tree. A source that does not parse THROWS: answering "no graph sites"
// for a file nobody could read would be this check reporting success on a lesson it never saw,
// which is the same silent pass one level up.
function parseLesson(js) {
  try {
    return parser.parse(js, { sourceType: 'module', plugins: ['jsx'] });
  } catch (e) {
    throw new Error(`the lesson does not parse: ${e.message}`);
  }
}

/** Every node in the tree, parents before children — scripts/lesson-ast.cjs\'s walk. */
function walk(node, visit) {
  if (!node || typeof node.type !== 'string') return;
  visit(node);
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'extra' || key.endsWith('Comments')) continue;
    const v = node[key];
    if (Array.isArray(v)) {
      for (const c of v) if (c && typeof c.type === 'string') walk(c, visit);
    } else if (v && typeof v.type === 'string') walk(v, visit);
  }
}

// Does this subtree read the graph palette binding — `G.bg`, `G[key]`, `` `${G.axis}` ``? Asked of
// the attribute\'s value, so a string literal answers no on its own: `fill="none"` holds no member
// expression, and neither does a lesson\'s prose.
function readsPalette(node) {
  let found = false;
  walk(node, (n) => {
    if (n.type === 'MemberExpression' && n.object.name === 'G') {
      found = true;
    }
  });
  return found;
}

// Every JSX colour attribute whose value reads the graph palette binding: fill={G.bg},
// stroke={G.gold}, stopColor={G.axis}. These are attributes on the rendered SVG, so no class swap
// reaches them.
//
// Three lines decide it and dropping any one of them is red at the gate. The first is the type
// test the other two stand on: without it the walk hands them nodes that have no `name` and the
// run dies on its first fixture — loudly, which is the point. The second is the attribute's name
// (`data-palette={G.name}` paints nothing) and the third is its value (`fill="#fff"` is a fixed
// colour); each of those has a fixture in case 5 that goes red on its own. WHERE the attribute is
// written decides nothing and is never asked, because the parse has already answered it.
//
// A formatter that breaks the line after the `{` changes none of this: `fill={` and the `G.bg` on
// the next line are one attribute node either way. One entry per attribute, on the line the
// attribute opens, printed from the caller\'s own source with the wrap flattened, so a failure
// prints the site rather than a count.
const COLOUR_ATTRS = new Set(['fill', 'stroke', 'color', 'stopColor', 'floodColor']);
function graphColourSites(js) {
  const out = [];
  walk(parseLesson(js), (n) => {
    if (n.type !== 'JSXAttribute') return;
    if (!COLOUR_ATTRS.has(n.name.name)) return;
    if (!readsPalette(n.value)) return;
    out.push({ line: n.loc.start.line, text: js.slice(n.start, n.end).replace(/\s+/g, ' ').trim() });
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

    // The wrapped form, which is what a formatter leaves behind when the colour is a long
    // conditional: `fill={` ends one line and the `G.bg` it reads starts the next. Reading a
    // line at a time saw no graph in this lesson at all, so it came back ok — the trap this
    // case exists to catch, passing silently. Both halves are asserted: the wrapped lesson
    // that omits the props is flagged, and the wrapped lesson that holds the theme is not,
    // because a finder that just fired on `fill={` would fail every well-wired lesson too.
    const wrappedGraph = 'let G = THEMES_G.light;\n'
      + 'const T = () => (\n  <svg>\n    <rect\n      fill={\n'
      + '        mode === "hi" ? G.bg : G.bgAlt\n      }\n    />\n'
      + '    <path\n      stroke={\n        mode === "hi" ? G.gold : G.axis\n      }\n'
      + '    />\n  </svg>\n);\n';
    // EVERY colour in it is wrapped. One single-line `fill={G.x}` left in would be found on
    // its own line and flag the lesson anyway, and the wrapped ones could go back to being
    // invisible without a single check here going red.
    check('every colour in the wrapped fixture really is wrapped',
      !/=\{[^}\n]*\bG\./.test(wrappedGraph), wrappedGraph);
    const wrappedNeither = wrappedGraph + mount('');
    const wrappedHeld = wrappedGraph + rebind + mount(' theme={theme} onThemeChange={setTheme}');
    const wrappedSites = graphThemeAudit(wrappedNeither).graphs;
    eq('a colour split across a line break is still a graph site', wrappedSites.length, 2);
    // Guarded, so the per-line finder coming back reports the count above as a FAIL and the
    // rest of case 5 still runs — reading [0] of an empty list here kills the whole run.
    if (wrappedSites.length === 2) {
      eq('…reported on the line the attribute opens, not the line G is read on',
        wrappedSites[0].line, 5);
      eq('…and each attribute is its own site', wrappedSites[1].line, 10);
      check('…printed as the whole expression, wrap flattened',
        wrappedSites[0].text === 'fill={ mode === "hi" ? G.bg : G.bgAlt }',
        JSON.stringify(wrappedSites[0].text));
    }
    check('so a wrapped lesson that omits both props is flagged',
      !graphThemeAudit(wrappedNeither).ok, auditDetail(graphThemeAudit(wrappedNeither)));
    check('…while a wrapped lesson that holds the theme and rebinds G still passes',
      graphThemeAudit(wrappedHeld).ok, auditDetail(graphThemeAudit(wrappedHeld)));

    // The bill for scanning the whole source instead of a line at a time: a lesson that only
    // TALKS about the pattern. Help text saying "write fill={ ... G.bg" over two lines has no
    // `}` between the two, so the whole paragraph reads as one attribute — and a lesson that
    // draws nothing at all was reported as a graph site and failed the gate on its prose. A
    // per-line scan could not make this mistake; parsing is what buys back the difference between
    // code and text, and it costs nothing here — the help text is a template literal and the
    // block below it is a comment, so neither holds a JSXAttribute.
    const proseText = 'const HELP = `\n'
      + '  Paint the rect with fill={ and then the palette key\n'
      + '  you want, e.g. G.bg — a class swap cannot reach an attribute.\n'
      + '`;\n'
      + '/*\n  <rect\n    fill={\n      G.bg\n    }\n  />\n*/\n';
    const proseOnly = proseText + 'const T = () => <p>{HELP}</p>;\n' + mount('');
    // The fixture only means anything while the pattern really does span lines in it: a `}`
    // between the `fill={` and the `G.` would make it pass on any finder, including the old one.
    check('the prose fixture really does carry the pattern across a line break',
      /fill=\{[^}]*\n[^}]*\bG\./.test(proseText), proseText);
    eq('a lesson that only writes ABOUT fill={…G} is not a graph site',
      graphThemeAudit(proseOnly).graphs.length, 0);
    check('…so it may leave the theme to the shell, like any lesson with no graphs',
      graphThemeAudit(proseOnly).ok, auditDetail(graphThemeAudit(proseOnly)));
    // The other half, without which "ignore prose" could just be "ignore everything": the same
    // help text beside a real wrapped colour still reports the colour, and only the colour.
    const proseAndGraph = proseText + wrappedGraph + mount('');
    const mixedAudit = graphThemeAudit(proseAndGraph);
    eq('…while the same prose beside real wrapped colours reports those and nothing more',
      mixedAudit.graphs.length, 2);
    // The count alone would not say WHICH two: the paragraph counted and one wrapped colour
    // missed also makes two. Only the wrapped attributes carry the conditional.
    check('…and the two are the wrapped attributes, not the paragraph',
      mixedAudit.graphs.length === 2
        && mixedAudit.graphs.every((g) => /^(fill|stroke)=\{ mode === "hi" \?/.test(g.text)),
      JSON.stringify(mixedAudit.graphs.map((g) => g.text)));
    check('so a lesson that draws AND talks about it is still flagged', !mixedAudit.ok,
      auditDetail(mixedAudit));
    // Telling code from text has its own trap, and it is the apostrophe. `<P>the reader's guide</P>`
    // is prose, not a string — but a quote scan with no line bound reads it as one that opens
    // there and closes at the next quote or at the end of the file, blanking every colour under
    // it. The lesson below paints from G and passes neither prop, so it must be flagged; scanned
    // that way it came back ok, which is this case's own trap hidden by the fix for the last one.
    const apostrophe = 'let G = THEMES_G.light;\n'
      + 'const T = () => (\n  <svg>\n    <P>the reader\'s guide</P>\n'
      + '    <rect fill={G.bg} />\n  </svg>\n);\n';
    eq('an apostrophe in prose does not hide the colour under it',
      graphColourSites(apostrophe).length, 1);
    check('so a lesson with prose above its graph is still flagged for the props',
      !graphThemeAudit(apostrophe + mount('')).ok, auditDetail(graphThemeAudit(apostrophe + mount(''))));
    // And the other half, or "prose is not a string" would just be "nothing is a string": a real
    // single-quoted string is still text, pattern and all.
    const quotedProse = 'let G = THEMES_G.light;\n'
      + "const HINT = 'write fill={ and then the key you want, e.g. G.bg';\n"
      + 'const T = () => <p>{HINT}</p>;\n';
    eq('…while a real one-line string is still read as text', graphColourSites(quotedProse).length, 0);

    // The same trap one turn on. Bounding a string to its line still never asked whether either
    // quote OPENED one, so any two apostrophes on a line paired up and blanked what sat between
    // them — here a real colour, bracketed by `it's` and `Bob's`. The lesson painting from the
    // palette while passing neither prop then audited clean: the silent miss, which is worse than
    // the loud false positive above, because nothing is printed and the check reports success.
    const possessives = 'let G = THEMES_G.light;\n'
      + 'const T = () => (\n  <svg>\n'
      + "    <text>it's</text><rect fill={G.bg} /><text>Bob's</text>\n"
      + '  </svg>\n);\n';
    // The fixture only bites while the colour really does sit BETWEEN two apostrophes on one line.
    check('the possessive fixture really does bracket its colour with apostrophes',
      /'[^'\n]*fill=\{G\.[^'\n]*'/.test(possessives), possessives);
    eq('a colour between two possessives on one line is still a graph site',
      graphColourSites(possessives).length, 1);
    const possessiveAudit = graphThemeAudit(possessives + mount(''));
    check('so a lesson painting between possessives and passing neither prop is flagged',
      !possessiveAudit.ok, auditDetail(possessiveAudit));
    // The suppressed half, without which "ignore what the quotes say" would just be "ignore
    // nothing": a real one-line string is still text when its body holds an apostrophe — as a
    // possessive in a double-quoted body, and as a `\'` escape in a single-quoted one.
    const apostropheStrings = 'let G = THEMES_G.light;\n'
      + 'const HINT = "the author\'s note: write fill={ and then G.bg, e.g. Bob\'s key";\n'
      + "const NOTE = 'the reader\\'s guide says fill={ and then G.bg';\n"
      + 'const T = () => <p>{HINT}{NOTE}</p>;\n';
    // Both lines have to be well-formed string literals carrying the pattern in their bodies, or
    // the count below is zero for the boring reason rather than the one the case is about.
    check('both fixture lines really are string literals carrying the pattern',
      (apostropheStrings.match(/fill=\{ and then G\.bg/g) || []).length === 2
        && /^const HINT = "[^"]*";$/m.test(apostropheStrings)
        && /^const NOTE = '(?:[^'\\]|\\.)*';$/m.test(apostropheStrings),
      apostropheStrings);
    eq('…while a real one-line string holding apostrophes is still read as text',
      graphColourSites(apostropheStrings).length, 0);

    // The shape the last fix left behind, and why this finder parses instead of scanning. Asking
    // what abuts each quote is still a rule about quotes, and JSX prose is not JS text: in
    // `<text>the '90s</text><rect fill={G.bg} /><text>students' work</text>` the first quote opens
    // a string JS would accept and the second closes one, so everything between them — the only
    // colour on the page — was blanked, and the lesson painting from the palette while passing
    // neither prop audited clean. Silently, which is the failure this file exists to stop.
    //
    // Every shape below has hidden a colour from this check or would have next. Each is one line of
    // a lesson carrying exactly one real colour, and each must report that colour and flag the
    // lesson: punctuation around a site decides nothing.
    const punctuated = {
      'a quotation opened before it and closed after it':
        '<text>He said "the fill is</text><rect fill={G.bg} /><text>green"</text>',
      'the same quotation in single quotes':
        "<text>he said 'the fill is</text><rect fill={G.bg} /><text>green'</text>",
      'a decade before it and a plural possessive after':
        "<text>the '90s</text><rect fill={G.bg} /><text>students' work</text>",
      'a quoted phrase either side':
        '<text>the "big" one</text><rect fill={G.bg} /><text>a "small" one</text>',
      'a quoted word carrying a plural s':
        '<text>two "fill"s</text><rect fill={G.bg} /><text>the "end"</text>',
      'a contraction either side': "<text>it's</text><rect fill={G.bg} /><text>Bob's</text>",
      'an apostrophe that opens no string': "<text>'tis the season</text><rect fill={G.bg} />",
      'a real JSX string attribute beside prose quotes':
        '<text x="1">a "b"</text><rect fill={G.bg} /><text>c "d"</text>',
    };
    for (const [what, body] of Object.entries(punctuated)) {
      // Each fixture only bites while the quoting really does reach the colour: a quote on the
      // same line, ahead of the attribute, is what every scan here has choked on.
      check(`the fixture with ${what} really does quote ahead of its colour`,
        /["'][^\n]*fill=\{G\.bg\}/.test(body), body);
      const lesson = `let G = THEMES_G.light;\nconst T = () => (\n  <svg>\n    ${body}\n  </svg>\n);\n`;
      const sites = graphColourSites(lesson);
      check(`a real colour is found with ${what}`,
        sites.length === 1 && sites[0].text === 'fill={G.bg}', JSON.stringify(sites));
      const audit = graphThemeAudit(lesson + mount(''));
      check(`…and the lesson with ${what}, passing neither prop, is flagged`,
        !audit.ok, auditDetail(audit));
    }

    // What decides a site, and what each of the deciding lines in graphColourSites is worth. The
    // first fixture is why the finder can stop asking WHERE a run of characters sits: a text scan
    // read the `fill={` in this object literal as an attribute, and a rule about the space before
    // the `=` was all that stood between it and a false site. The other two are the fixtures for
    // the name test and the value test — drop either line and its own fixture goes red.
    const objectLiteral = 'let G = THEMES_G.light;\n'
      + 'const fill={ hue: G.bg };\nconst T = () => <p>{fill.hue}</p>;\n';
    eq('an object literal is not a JSX attribute, so not a graph site',
      graphColourSites(objectLiteral).length, 0);
    const notAColour = 'let G = THEMES_G.light;\n'
      + 'const T = () => <rect data-palette={G.name} />;\n';
    eq('an attribute that names the palette without painting from it is not a site',
      graphColourSites(notAColour).length, 0);
    const fixedColour = 'let G = THEMES_G.light;\n'
      + 'const T = () => <rect fill="#fff" stroke={theme.axis} />;\n';
    eq('a colour attribute that does not read G is not a site',
      graphColourSites(fixedColour).length, 0);

    // And the answer for a lesson nobody can parse is not "no graphs". Reporting zero sites for a
    // file this check never read is the same silent pass, one level up: the lesson would leave the
    // theme to the shell with the gate\'s blessing.
    const unparseable = 'const T = () => (<svg><rect fill={G.bg} />;\n';
    let refusal = null;
    try { graphColourSites(unparseable); } catch (e) { refusal = e.message; }
    check('a lesson that does not parse is refused, not reported as graph-free',
      refusal !== null && /does not parse/.test(refusal), JSON.stringify(refusal));

    // A `${…}` is code, not text, and the parse says so: the interpolation is an expression
    // inside the attribute. Treating a template literal as text whole loses this real graph site.
    const interpolated = 'let G = THEMES_G.light;\n'
      + 'const T = () => <rect fill={`${G.bg}`} />;\n';
    eq('a colour built inside a template interpolation is still a graph site',
      graphColourSites(interpolated).length, 1);

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
