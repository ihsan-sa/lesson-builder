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
 * This fixture is text-only, and text is enough for the two ways that mechanism breaks: a palette
 * class written as a literal somewhere the theme cannot reach it, and a token declared in one
 * theme block but not the other. What text cannot check — that the built page actually paints
 * both ways, pop-out included — is tests/shell-theme/README.md's by-hand demonstration.
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

// The custom properties each theme block of a sheet declares. Same selector convention as
// chat.css.js and tests/css-vars-defined: `:root, .theme-dark` is the dark block, `.theme-light`
// the light one.
function paletteTokens(css) {
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks = { dark: new Set(), light: new Set() };
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(noComments))) {
    const sel = m[1].trim().split(/\s+/).join(' ');
    const names = [...m[2].matchAll(/(--[A-Za-z0-9_-]+)\s*:/g)].map((d) => d[1]);
    if (/(^|[\s,])(:root|\.theme-dark)([\s,]|$)/.test(sel)) for (const n of names) blocks.dark.add(n);
    if (/(^|[\s,])\.theme-light([\s,]|$)/.test(sel)) for (const n of names) blocks.light.add(n);
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
  }

  // -------------------------------------------------------------------------
  heading(3, 'shell.css.js declares the same tokens in both palettes');
  {
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

    const css = fs.readFileSync(SHELL_CSS, 'utf8');
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
  console.log();
  for (const f of failures) console.log(`  FAIL  ${f}`);
  console.log(`\n${pass}/${pass + failures.length} checks passed`);
  process.exit(failures.length === 0 ? 0 : 1);
})();
