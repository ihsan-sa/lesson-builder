# The shell's dark/light switch

Proof that a lesson rendered through `LessonShell` offers the same DARK button the 39 pre-shell
lessons offer, and honours it — chrome, prose, equations, contents rail, the lesson's own SVG, and
the tutor pop-out window.

```
node tests/shell-theme/check.cjs          # in the gate: the sheet and the component, as text
cd tests/shell-theme && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install \
  && SHELL_THEME_BROWSER=/usr/bin/google-chrome ./run.sh    # by hand: press it in a built lesson
```

`check.cjs` needs node and `@babel/parser` — case 5 reads a lesson body as a syntax tree, and the
parser is installed from the npm cache at the version the lesson template pins, as
`tests/ast-inventory` installs it. No browser, no network beyond that, about a second. `run.sh` builds one scaffolded lesson twice with `vite build`, once with each of the two
lesson bodies below, serves both out of `dist/` and drives them with Playwright; `KEEP=1` keeps the
workspace and the six screenshots (light, dark, the pop-out at both, and the uncontrolled build at
both). Exit code 0 only when every case passes.

The shell used to hardcode `theme-light` on its root and on the pop-out's host, and
`chat/shell.css.js` declared one palette, so the button the owner presses in the other 39 lessons
had no counterpart in the two that use the shell. The mechanism now is a class on the shell root:
both palettes are in the sheet, so everything styled from the tokens repaints on the class change
with nothing re-rendering.

**Graph colours are the exception, and they are why the theme can be lifted into the lesson.**
`THEMES_G` values are JS, written onto the SVG as attributes, so they follow only when the *lesson*
re-renders and rebinds `G`. A lesson that passes `theme` and `onThemeChange` gets that; a lesson
that passes neither still gets the switch, and its SVGs stay on the light palette.

So there are two wirings and both ship, and this directory carries a lesson body for each.
`lesson/theme_demo.jsx` holds the theme itself, which is what `references/template.md` prescribes
for a lesson with graphs. `lesson/theme_uncontrolled.jsx` passes neither prop and leaves the choice
to the shell — the `themeOwn`/`toggleTheme` fallback in `LessonShell`, which is the path the two
lessons that actually ship on the shell are on. It draws an SVG from `THEMES_G` anyway, so it is
also the trap `template.md` warns about: a dark page with light-palette graphs on it. That is
deliberate and both fixtures assert on it — `check.cjs` case 5 flags the file, `run.sh` case 5
reads the unmoved colours off the page. Do not "fix" it by adding the props.

## What `check.cjs` asserts

| | Case | Must hold |
|-|------|-----------|
| 1 | the site finder, on fixtures of its own | a literal palette class in JSX is a site, reported on its line; deriving the class from a theme is one site on the mapping line and the JSX interpolating it is not; a palette class named only in a comment is not a site |
| 2 | `LessonShell.jsx` | exactly one line names a palette class, and it is the one deriving `themeClass` from `theme`; the shell root, the pop-out host and the pop-out's `documentElement` all take that value; an effect keyed on `themeClass` re-applies it to a pop-out that is already open; a **layout** effect keyed on `themeClass` adds the class to the main document's `documentElement` and removes it again |
| 3 | `shell.css.js` | both theme blocks exist and declare the same token set (fixtures first: a gap in either direction is reported against the block that has it, and one fixture is shaped like the shipped file, header comment and all); no rule outside those blocks writes a colour as a literal; the sheet resets `html, body` and paints them from `--canvas`; the two palettes differ on `--canvas` |
| 4 | the switch | the `.theme-toggle` label expression evaluates to `Dark` in the light theme and `Light` in the dark one, and the button sits outside the tutor gate |
| 5 | a lesson's theme wiring | a lesson whose SVG paints from `G` passes `theme` and `onThemeChange` **and** rebinds `G = THEMES_G[theme]`; passing one prop, or both without the rebind, fails; a lesson with no such SVG may leave the theme to the shell; a colour wrapped across a line break is still found, on the line its attribute opens, while the same pattern in prose, help text or a commented-out block is not a site at all and no quoting or punctuation around a real colour hides it; a lesson that does not parse is refused, not reported graph-free; `theme_demo.jsx` passes and `theme_uncontrolled.jsx` is flagged |

Case 1 builds every fixture it asserts on and pins down what the finder lets through as well as what
it catches. Cases 3 and 5 do the same before they read the shipped files.

Case 5's rule is conditional, and reading it the other way round is the mistake it is there to
catch: omitting the theme props is not wrong in itself, it is wrong *for a lesson whose SVG paints
from `G`*. Both directions are asserted, so a check that just banned the uncontrolled path would
fail here. Be clear about what text can see — which props the `<LessonShell>` tag carries, whether a
JSX colour attribute reads `G`, whether some line rebinds `G` from a theme. It cannot see whether
the value handed to `theme=` is really state, or whether the rebind runs on every render; `run.sh`
reads those off a real page. Nor can it see the lessons that ship: those live in another repo, so
here it guards these two bodies and states the rule. The tag is scanned with brace depth rather than
to the first `>`, because `tutor={<Chatbot ... />}` puts a `>` inside a prop value and stopping there
reports a lesson that does everything right as the trap.

**Colour attributes come from a parse of the lesson, not from a scan of its characters.** Four
scans tried in turn, and each bought one quoting shape and lost the next. A line-at-a-time scan
lost the colour a formatter had wrapped — `fill={` ends one line and the `G.bg` it reads starts the
next — and passed a lesson with this case's own trap in it. Reading the whole source instead
reported help text that says "write `fill={` and then the palette key you want, e.g. `G.bg`" over
two lines as a graph site, because there is no `}` between the two. Blanking string bodies let
`the reader's guide` blank every colour below it. Asking what abuts each quote let
`<text>it's</text><rect fill={G.bg} /><text>Bob's</text>` lose its only site — and still lost it in
`<text>the '90s</text><rect fill={G.bg} /><text>students' work</text>`, where the first quote opens
a string JS would accept and the second closes one. That last one is the shape a scan cannot be
taught: JSX prose is not JavaScript text, so no rule about quotes tells them apart. Only the
grammar does.

So `check.cjs` parses the lesson with `@babel/parser` and reports JSX attributes: a colour name, a
value that reads `G`. A comment, a string body, a template literal's text and JSX prose stop being
special cases, because none of them is an attribute; a wrap after the `{` stops mattering, because
it is the same node either way; ``stroke={`${G.axis}`}`` is still a site, because the interpolation
is an expression inside the attribute. Three lines decide a site and dropping any one is red at the
gate — the type test the other two stand on, the name test (`data-palette={G.name}` paints
nothing), the value test (`fill="#fff"` is a fixed colour). A lesson that does not parse is refused
rather than reported graph-free, or a file nobody could read would pass the gate in silence.

The fixtures assert both halves throughout, because "ignore prose" must not become "ignore
everything": the prose-only lesson is not flagged and the same prose beside two real wrapped
colours reports those two; a real one-line string is still text, apostrophes and escapes in its
body and all; and every quoting shape above, plus quoted phrases either side of a colour, reports
that colour and flags the lesson that paints from it while passing neither prop. The wrapped
fixture wraps *every* colour it contains, because one single-line `fill={G.x}` left in would flag
the lesson by itself and the wrapped ones could go back to being invisible unnoticed.

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

`browser.cjs` closes the browser in a `finally`, not on the path where every check passed:
a timeout or a selector that never appears falls through to the outer `.catch()`, and `run.sh`'s
trap clears the preview *port*, which the browser is not on. Measured on Playwright 1.62.1, a
deliberately failing check (a selector that is never there) left no Chromium behind either way —
Playwright kills the browser it spawned from its own process-exit hook, so the gap was covered by
the library rather than by this file. The `finally` is what stops that being the only thing
holding it.

## What `run.sh` demonstrates

| | Case | Must hold |
|-|------|-----------|
| 1 | first paint | the shell root and `<html>` both carry `theme-light`, the body margin is 0, the page canvas matches the shell, and the switch reads **Dark** |
| 2 | pressing it | root and `<html>` are `theme-dark` with no light class left over, the switch reads **Light**, and the top bar, prose ink, equation card, contents rail, the lesson's SVG (face and curve) and the page canvas behind the shell all changed colour |
| 3 | the pop-out, opened dark | its host and its `<html>` both carry `theme-dark` |
| 4 | switching back with it open | page and pop-out both return to `theme-light`, and the pop-out's paper and the tutor panel inside it repaint |
| 5 | the uncontrolled build, in a page of its own | with no theme prop to open it the shell root is `theme-light` and the switch reads **Dark**; pressing it turns root and `<html>` dark off the shell's own state and the background, prose ink and equation card all change — and the lesson's SVG does **not** |

Case 1 and 2's page-canvas clauses are about the document behind the shell. `.lesson-shell` is not
the whole page: the UA's 8px body margin shows `html` and `body` at every edge, and a scroll runs
past the shell onto them, so a dark lesson used to sit in a white frame. Reading `.lesson-shell`
alone never saw it.

Cases 3 and 4 are two different code paths in `LessonShell` — `openPopup` sets the class as it
builds the window, and an effect re-applies it afterwards. Case 4 is the one that silently does
nothing if the effect is dropped: the pop-out stays on the theme it was opened in.

Case 5 is the shell's `themeOwn`/`toggleTheme` fallback end to end, with no lesson state anywhere in
it — drop that fallback and the class does not move at all. `run.sh` gets it from a second
`vite build` of the same lesson directory with the uncontrolled body, `--base ./` into
`dist/uncontrolled`, so the one preview server serves both and the trap still has one port to clear.
It has to be built *after* the first: vite empties its `outDir`, and `dist/` is the parent. Its
last clause is the cost of that path, on the page rather than in a doc — the SVG colours are JS the
lesson wrote as attributes, and nothing re-rendered them.
