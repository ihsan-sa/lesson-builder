# phone-width — nothing lands on the equation, and nothing is squeezed to nothing

Evidence for the phone-width defect the owner reported on 2026-09-06 ("things
overlap"), settled by measuring rendered geometry rather than by eye. It also
carries the check for the defect that report did NOT catch: a part of the lesson
squeezed to zero width.

Run it:

```
cd tests/phone-width
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install
PHONE_WIDTH_BROWSER=/usr/bin/google-chrome ./run.sh
```

Needs a Chromium, three `vite build`s and the KaTeX CDN, so it is not in
`tests/check.sh`; that gate lists it with this command. The same two
measurements run over a whole built site with `sweep.cjs`, and are shown going
red with `sweep-negative.sh` — both below.

## What it builds

Three lessons, because the 41 lessons render two different stylesheets and a
measurement taken on one says nothing about the other, and because a check that
only ever stays quiet has not been shown to catch anything:

| lesson | body | sheets |
| --- | --- | --- |
| shell | `lesson/shell_demo.jsx` | mounts `LessonShell`, so `chat/chat.css.js` with `chat/shell.css.js` injected over it — the 2 |
| classic | `lesson/classic_demo.jsx` | no shell markup, so `chat/chat.css.js` alone — the other 39 |
| squeezed | `lesson/squeezed_demo.jsx` | classic shape, but every part squeezed to nothing on purpose — the negative control |

All three are scaffolded from `references/bootstrap/lesson-template` into one
throwaway workspace, built with `vite build` and served from `dist/` by
`vite preview`: the overlap is what a reader gets on the live site, and that is
`dist/`. The first two carry the same three equations — one short, one wide
enough to need the whole width of a phone, one with a caption riding the border
— and the same figure, table and code block from `lesson/parts.jsx`.

## What it measures

Two viewports, each on its own page load, because `LessonShell` decides whether
the contents rail starts open from the width at mount:

- **phone 390x844** — the width the overlap was reported at.
- **desktop 1440x900** — the width that must not have moved.

The equation is its glyphs, not the box around them: in display mode KaTeX makes
`.katex` a full-width block and centres the formula inside it, so measuring that
box reports every absolutely positioned control in the column as covering an
equation it is nowhere near. Ink is the union of `.katex .base` rects — inline-
block, `width: min-content`, so it hugs the formula — clipped to `.eq-body`,
which is its own scroll container, so ink scrolled out of sight does not count
as on screen.

Per lesson, per viewport: the math is visible at all; no `.eq-side` and no
`.eq-label` covers it; the page does not scroll sideways; and no part of the
lesson is squeezed to nothing (the next section). At 390px also: the
reading column gets at least half the viewport, the side rail is in the flow,
and the block reserves no gutter beside the equation. At 1440px the last two are
inverted — the rail floats, and the shell's block still reserves its 92px gutter
— so a rule that went missing and a rule that leaked past its media query both
show up.

One case is a press rather than a measurement, on a page load of its own: at
390px the shell's contents rail must start collapsed to 48px **and** must still
open to 262px when the reader presses "Show contents", and stay open. Collapsing
it by default is the fix; an inert toggle would be a worse bug than the one
being fixed, so both halves are asserted together.

## The collapse case, and why "no sideways scroll" could not stand in for it

A flex child with `min-width: 0` that is squeezed collapses to **zero width**
rather than overflowing its parent. Nothing overflows, so the page does not
scroll sideways and the case above stays green while the part is not on screen
at all. Measured on 2026-09-06: at 390px the pre-#24 build rendered `.eq-body`
0px wide on both shell lessons, and page-level horizontal overflow was 0px in
that build and 0px in the fixed one alike.

So `collapse.cjs` measures the parts instead. Per part it takes the content box
off the rendered rect — the room the part leaves for what it carries — and
anything under **24px** is called collapsed and named. Four kinds are measured:
the equation body (`.eq-block .eq-body`), a figure (`.figure-block`), a table
(`.data-table`) and a code block (`pre`). Four things are skipped because they
are not lesson content and measuring them reports a collapse that is not one:
`.katex-mathml` (KaTeX's hidden accessibility layer, clipped to 1x1 by design),
Desmos's `dcg-*` internals, and the tutor's own `.chat-panel` / `.thread-panel`.

`lesson/squeezed_demo.jsx` is the negative control. It carries each of the four
parts twice, once laid out ("kept") and once as a flex child of a row already
full ("squeezed"), and the fixture asserts both halves on that one page: every
squeezed part is named, no kept part is, and all four kinds are among the named.

The four skips are measured on that same page. Its third section squeezes a code
block to nothing inside each of the four ancestors, and one case per ancestor
asserts that the part is on screen, is under the floor, and is still not named —
so the guard is what kept it quiet. Break one of the four selectors and the part
it had been skipping is measured like any other, and that ancestor's case names
it. The pair's other half is asserted beside them: the same squeeze outside all
four is still named, so a measurement that had stopped naming anything cannot
pass the four. Before this the guards were unreachable — no demo lesson put a
measured part under any of the four — and a mistyped selector left every case
green.

## Both measurements over a whole built site

`sweep.cjs` runs **both** of them — overlap and collapse — over every lesson of
a built site, one page load each, at 390x844. It is how the collapse check was
shown to fail on the build before #24 and pass on the one after:

```
cd ~/dev/lessons/lessons
node bin/serve-dist.mjs --port 5301 --dist <a built site> --quiet   # NAMED flags
PHONE_WIDTH_BROWSER=/usr/bin/google-chrome \
  SITE_URL=http://127.0.0.1:5301/ node tests/phone-width/sweep.cjs
```

Lessons come from the directory links on the site's index page that no other
link sits under, or from `LESSON_PATHS`. The site is only read; nothing here
writes into a build. Per lesson the run prints `ok`, `OVERLAP`, `COLLAPSED` or
`OVERLAP+COLLAPSED`, and names what it found: which equation, and whether it was
the side rail or the caption that covered it, or which part was squeezed. Exit 1
when any lesson has either. The last line reports how many lessons and equations
were measured, how many lessons had an overlap and how many had a collapse, and
the narrowest part found.

The measurement itself is `overlap.cjs`, required by this file's fixture and by
the sweep alike, so both runs measure an overlap the same way. Until 2026-09-07
it lived inside `check.cjs` and only ever ran over the three scaffolded lessons:
the sweep measured collapse alone, and its "41 of 41 ok" could not tell "no
overlap" from "overlap never looked for".

An equation with no ink on screen is one no overlap could have been seen on, so
the run counts those and says so rather than passing them in silence — a lesson
whose math never rendered must not read as a lesson nothing lands on.

### Showing the sweep go red

`sweep-negative.sh` is the sweep's negative control, because a run over a clean
corpus only ever stays quiet. It copies **one** lesson out of a built site into a
temp directory — the site is never written to — makes three copies, breaks two
of them in the built HTML, and asserts what the sweep says about each:

```
SITE=~/.cc/state/lessons/build-head-0f03499 \
  PHONE_WIDTH_BROWSER=/usr/bin/google-chrome tests/phone-width/sweep-negative.sh
```

| copy | injected | the sweep must |
| --- | --- | --- |
| clean | nothing | pass, having measured at least one equation |
| overlap | `.eq-side` pinned over the whole `.eq-block` | go red, name the lesson and `side rail covers`, with nothing collapsed |
| squeezed | `.eq-body { max-width: 0 }` | go red, name `equation[0]`, and report the equation as having no math on screen |

The overlap copy having nothing collapsed is the point of the pair: the run went
red on the overlap measurement, not on the collapse one that was already there.

## What it found (2026-09-06, before the fix)

- **classic was already clean at 390px**: `chat/chat.css.js` gained a
  `max-width: 520px` rule for `.eq-side` in classic-styles-restore, and it works.
- **shell was not**: the 262px contents rail left `.article` 128px and
  `.article-col` 72px — narrower than an equation block's own `24px + 92px` of
  padding — so `.eq-body` computed to zero width and no equation was on screen
  at all. The Explain pill was the only thing left in the box.

Fixed in `ui/LessonShell.jsx` (the rail starts collapsed below the width that
can hold it) and `chat/shell.css.js` (below 520px the rail flows under the
equation and the block stops reserving a gutter for it).

## What the sweep found (2026-09-06, collapse only)

Both builds served from `~/.cc/state/lessons/`, one lesson per page load at
390px. 41 lessons measured in each.

| build | lessons | narrowest part | collapsed |
| --- | --- | --- | --- |
| `stage-verified-2026-09-06` (pre-#24) | 41 | **0px** (`/chemhl/radioactive-decay/`) | 2 lessons — `chemhl/radioactive-decay` and `rf/directional-couplers`, every equation body 0px |
| `build-head-0f03499` (post-#24) | 41 | **236px** (`/chemhl/radioactive-decay/`) | none |

The two collapsed lessons are the two that mount `LessonShell`. The 24px floor
sits an order of magnitude clear of both numbers. Neither run measured overlap —
that is what the run below adds.

## What the sweep found with overlap in it (2026-09-07)

`build-head-0f03499` (post-#24), served the same way: **41 lessons, 176
equations, 0 with a control or caption on the equation, 0 with a collapsed
part**, and no equation without math on screen. This is the first corpus-wide
overlap figure; the earlier runs above could not produce one.
