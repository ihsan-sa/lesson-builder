# phone-width — nothing an equation carries lands on the equation

Evidence for the phone-width defect the owner reported on 2026-09-06 ("things
overlap"), settled by measuring rendered geometry rather than by eye.

Run it:

```
cd tests/phone-width
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install
PHONE_WIDTH_BROWSER=/usr/bin/google-chrome ./run.sh
```

Needs a Chromium, two `vite build`s and the KaTeX CDN, so it is not in
`tests/check.sh`; that gate lists it with this command.

## What it builds

Two lessons, because the 41 lessons render two different stylesheets and a
measurement taken on one says nothing about the other:

| lesson | body | sheets |
| --- | --- | --- |
| shell | `lesson/shell_demo.jsx` | mounts `LessonShell`, so `chat/chat.css.js` with `chat/shell.css.js` injected over it — the 2 |
| classic | `lesson/classic_demo.jsx` | no shell markup, so `chat/chat.css.js` alone — the other 39 |

Both are scaffolded from `references/bootstrap/lesson-template` into one
throwaway workspace, built with `vite build` and served from `dist/` by
`vite preview`: the overlap is what a reader gets on the live site, and that is
`dist/`. Each carries the same three equations — one short, one wide enough to
need the whole width of a phone, one with a caption riding the border.

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
`.eq-label` covers it; the page does not scroll sideways. At 390px also: the
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
