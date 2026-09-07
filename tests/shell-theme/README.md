# The shell's dark/light switch

Proof that a lesson rendered through `LessonShell` offers the same DARK button the 39 pre-shell
lessons offer, and honours it — chrome, prose, equations, contents rail, the lesson's own SVG, and
the tutor pop-out window.

```
node tests/shell-theme/check.cjs          # in the gate: the sheet and the component, as text
cd tests/shell-theme && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install \
  && SHELL_THEME_BROWSER=/usr/bin/google-chrome ./run.sh    # by hand: press it in a built lesson
```

`check.cjs` is node only — no `npm install`, no network, no browser — and runs in well under a
second. `run.sh` builds a real lesson with `vite build`, serves `dist/` and drives it with
Playwright; `KEEP=1` keeps the workspace and the four screenshots (light, dark, and the pop-out at
both). Exit code 0 only when every case passes.

The shell used to hardcode `theme-light` on its root and on the pop-out's host, and
`chat/shell.css.js` declared one palette, so the button the owner presses in the other 39 lessons
had no counterpart in the two that use the shell. The mechanism now is a class on the shell root:
both palettes are in the sheet, so everything styled from the tokens repaints on the class change
with nothing re-rendering.

**Graph colours are the exception, and they are why the theme can be lifted into the lesson.**
`THEMES_G` values are JS, written onto the SVG as attributes, so they follow only when the *lesson*
re-renders and rebinds `G`. A lesson that passes `theme` and `onThemeChange` gets that; a lesson
that passes neither still gets the switch, and its SVGs stay on the light palette. The demo lesson
here holds the theme, which is what `references/template.md` prescribes.

## What `check.cjs` asserts

| | Case | Must hold |
|-|------|-----------|
| 1 | the site finder, on fixtures of its own | a literal palette class in JSX is a site, reported on its line; deriving the class from a theme is one site on the mapping line and the JSX interpolating it is not; a palette class named only in a comment is not a site |
| 2 | `LessonShell.jsx` | exactly one line names a palette class, and it is the one deriving `themeClass` from `theme`; the shell root, the pop-out host and the pop-out's `documentElement` all take that value; an effect keyed on `themeClass` re-applies it to a pop-out that is already open; a **layout** effect keyed on `themeClass` adds the class to the main document's `documentElement` and removes it again |
| 3 | `shell.css.js` | both theme blocks exist and declare the same token set (fixtures first: a gap in either direction is reported against the block that has it, and one fixture is shaped like the shipped file, header comment and all); no rule outside those blocks writes a colour as a literal; the sheet resets `html, body` and paints them from `--canvas`; the two palettes differ on `--canvas` |
| 4 | the switch | the `.theme-toggle` label expression evaluates to `Dark` in the light theme and `Light` in the dark one, and the button sits outside the tutor gate |

Case 1 builds every fixture it asserts on and pins down what the finder lets through as well as what
it catches. Case 3 does the same before it reads the shipped sheet.

Case 3 reads the CSS out of the template literal first, and one of its fixtures is there to keep it
doing so. The module header is a `//` comment that names both palette classes while explaining
them; a rule walker handed the whole `.js` file takes that header as the first rule's selector,
counts the dark block's tokens as declared in the light one too, and can then never report a gap in
the dark block — the direction the sheet's own comment calls the dangerous one.

The literal-colour clause is the other half of "everything follows". A `var(--x)` follows the switch
and a written-out colour cannot: the tutor tab-strip hovers held the light canvas as an `rgba()`
literal, so hovering a session tab in dark mode painted a near-white block. They go through
`--tab-hover` now, declared in both blocks.

Case 2's `documentElement` clause is not belt and braces. The pop-out is a second document, and the
`html,body{...background:var(--surface)}` rule the shell injects into it paints from a custom
property — which resolves *where it is declared*. With the class only on the host, the paper behind
the tutor panel keeps whichever palette `:root` carries and the panel floats on the wrong colour.

## What `run.sh` demonstrates

| | Case | Must hold |
|-|------|-----------|
| 1 | first paint | the shell root and `<html>` both carry `theme-light`, the body margin is 0, the page canvas matches the shell, and the switch reads **Dark** |
| 2 | pressing it | root and `<html>` are `theme-dark` with no light class left over, the switch reads **Light**, and the top bar, prose ink, equation card, contents rail, the lesson's SVG (face and curve) and the page canvas behind the shell all changed colour |
| 3 | the pop-out, opened dark | its host and its `<html>` both carry `theme-dark` |
| 4 | switching back with it open | page and pop-out both return to `theme-light`, and the pop-out's paper and the tutor panel inside it repaint |

Case 1 and 2's page-canvas clauses are about the document behind the shell. `.lesson-shell` is not
the whole page: the UA's 8px body margin shows `html` and `body` at every edge, and a scroll runs
past the shell onto them, so a dark lesson used to sit in a white frame. Reading `.lesson-shell`
alone never saw it.

Cases 3 and 4 are two different code paths in `LessonShell` — `openPopup` sets the class as it
builds the window, and an effect re-applies it afterwards. Case 4 is the one that silently does
nothing if the effect is dropped: the pop-out stays on the theme it was opened in.
