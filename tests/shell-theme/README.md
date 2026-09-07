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
| 2 | `LessonShell.jsx` | exactly one line names a palette class, and it is the one deriving `themeClass` from `theme`; the shell root, the pop-out host and the pop-out's `documentElement` all take that value; an effect keyed on `themeClass` re-applies it to a pop-out that is already open |
| 3 | `shell.css.js` | both theme blocks exist and declare the same token set (fixtures first: a gap in either direction is reported against the block that has it), and the two palettes differ on `--canvas` |
| 4 | the switch | the `.theme-toggle` label expression evaluates to `Dark` in the light theme and `Light` in the dark one, and the button sits outside the tutor gate |

Case 1 builds every fixture it asserts on and pins down what the finder lets through as well as what
it catches. Case 3 does the same before it reads the shipped sheet.

Case 2's `documentElement` clause is not belt and braces. The pop-out is a second document, and the
`html,body{...background:var(--surface)}` rule the shell injects into it paints from a custom
property — which resolves *where it is declared*. With the class only on the host, the paper behind
the tutor panel keeps whichever palette `:root` carries and the panel floats on the wrong colour.

## What `run.sh` demonstrates

| | Case | Must hold |
|-|------|-----------|
| 1 | first paint | the shell root carries `theme-light` and the switch reads **Dark** |
| 2 | pressing it | root class is `theme-dark`, the switch reads **Light**, and the page background, top bar, prose ink, equation card, contents rail and the lesson's SVG (face and curve) all changed colour |
| 3 | the pop-out, opened dark | its host and its `<html>` both carry `theme-dark` |
| 4 | switching back with it open | page and pop-out both return to `theme-light`, and the pop-out's paper and the tutor panel inside it repaint |

Cases 3 and 4 are two different code paths in `LessonShell` — `openPopup` sets the class as it
builds the window, and an effect re-applies it afterwards. Case 4 is the one that silently does
nothing if the effect is dropped: the pop-out stays on the theme it was opened in.
