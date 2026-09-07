// The parts of a lesson a narrow viewport can squeeze to nothing, and the
// measurement that catches it. Required by check.cjs (this fixture's three demo
// lessons) and by sweep.cjs (a whole built site).
//
// WHY THIS EXISTS. A flex child that is squeezed collapses to zero width rather
// than overflowing its parent, so "the page does not scroll sideways" stays true
// while the part is gone. Measured on 2026-09-06: in the pre-#24 build both
// shell lessons rendered `.eq-body` at 0px at 390px and page-level horizontal
// overflow was 0px, exactly as it was in the fixed build. Every aggregate check
// called those lessons clean while their equations were not on screen. The
// difference is only visible by measuring the element.
//
// So: assert every squeezable part still has room for what it carries, rather
// than asserting the page does not scroll sideways.
//
// `settle` is here too, because a measurement taken before the page has settled
// is not a measurement: KaTeX renders after mount, and reading the DOM in the
// same tick as the change that caused it reports the layout that has not
// happened yet.

// The width a part must leave for its contents. Below this a part is carrying
// nothing a reader could see, whatever the reason. Chosen from a sweep of the
// built corpus at 390px (see sweep.cjs and README.md): across all 41 lessons of
// the post-#24 build the narrowest part measured 236px, and a squeezed one
// measures 0px, so the floor sits an order of magnitude clear of both.
const MIN_PART_W = 24;

// Squeezable lesson content, by kind. These four are what a lesson lays out
// across the width it is given: the equation body (a flex child with
// `min-width: 0`, the one that collapsed), a figure, a table and a code block.
// Kept explicit rather than "every block element": a named kind is what the
// failure message can point at.
const PARTS = [
  { kind: "equation", selector: ".eq-block .eq-body" },
  { kind: "figure", selector: ".figure-block" },
  { kind: "table", selector: ".data-table" },
  { kind: "code", selector: "pre" },
];

// Not lesson content, and measuring it reports a collapse that is not one:
//   .katex-mathml   KaTeX's hidden accessibility layer, clipped to 1x1 by design
//   [class*="dcg-"] Desmos's own internals inside an embed we do not lay out
//   .chat-panel     the tutor's own UI, which the reader opens and closes
//   .thread-panel   likewise
// A part inside any of these is skipped, not measured and passed: a skipped
// part cannot hide a real collapse because it is not a part of the lesson.
const NOT_LESSON_CONTENT = [".katex-mathml", '[class*="dcg-"]', ".chat-panel", ".thread-panel"];

// Runs in the page. Every number is a real getBoundingClientRect on the
// laid-out document, never one computed from the stylesheet.
function measureParts({ parts, notLessonContent, minWidth }) {
  const text = (el) => (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40);
  // What the part leaves for what it carries: its content box. A part whose own
  // width is zero and a part whose padding has eaten all of its width are the
  // same failure to a reader — nothing is on screen either way.
  //
  // Taken off the rect rather than `clientWidth`, which is 0 for every
  // non-replaced inline element: `.eq-body` is an inline span in the 39 lessons
  // that carry no shell stylesheet, and reading clientWidth there called every
  // one of them collapsed at its full 287px.
  const innerWidth = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const px = (v) => parseFloat(v) || 0;
    return Math.max(0, r.width - px(cs.paddingLeft) - px(cs.paddingRight) -
      px(cs.borderLeftWidth) - px(cs.borderRightWidth));
  };
  // Deliberately hidden is not squeezed to nothing. `offsetParent` is null when
  // the element or an ancestor is `display: none`, and stays non-null for an
  // element that is merely zero-wide — which is the case being caught, so it
  // must not be filtered out here. (Lesson parts are never `position: fixed`,
  // the other way offsetParent goes null.)
  const hidden = (el) => el.offsetParent === null || getComputedStyle(el).visibility === "hidden";

  const measured = [];
  for (const { kind, selector } of parts) {
    let i = 0;
    for (const el of document.querySelectorAll(selector)) {
      if (notLessonContent.some((sel) => el.closest(sel))) continue;
      if (hidden(el)) continue;
      const r = el.getBoundingClientRect();
      const eq = el.closest(".eq-block");
      measured.push({
        kind,
        selector,
        index: i++,
        // Enough to find the part in the lesson without opening it.
        label: kind === "equation" && eq ? (eq.getAttribute("data-latex") || "").slice(0, 40) : text(el),
        width: r.width,
        inner: innerWidth(el),
      });
    }
  }
  return {
    viewportWidth: window.innerWidth,
    parts: measured,
    collapsed: measured.filter((p) => p.inner < minWidth),
    minInner: measured.length ? Math.min(...measured.map((p) => p.inner)) : null,
  };
}

// One line per collapsed part, naming the kind and enough of the part to find
// it. This is what a failing run prints, so it says which part went, not just
// that one did.
function describeCollapsed(collapsed) {
  return collapsed
    .map((p) => `${p.kind}[${p.index}] ${Math.round(p.inner)}px wide (box ${Math.round(p.width)}px) — ${p.label}`)
    .join("\n        ");
}

// The page has to have settled before a measurement means anything: KaTeX
// renders after mount, and a read in the same tick as the change that caused it
// reports the layout that has not happened yet. Waits for the lesson body, for
// math if the lesson has any, for fonts, and then for two frames of quiet.
async function settle(page, { timeout = 30000 } = {}) {
  await page.waitForFunction(() => !!document.querySelector(".lesson-body, .article, .article-col"),
    null, { timeout });
  // Every equation, not just the first: a block still waiting on KaTeX has no
  // geometry, and measuring it would report a collapse that is only a race.
  // `[data-latex]` because lessons also reuse `.eq-block` as a plain box around
  // a diagram, and one of those never grows a `.katex` — waiting on the bare
  // class hung the sweep on rf/directional-couplers for the full timeout.
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".eq-block[data-latex]")]
      .every((b) => !!b.querySelector(".katex, .eq-raw")),
    null, { timeout });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.waitForTimeout(150);
}

async function readParts(page) {
  return page.evaluate(measureParts, { parts: PARTS, notLessonContent: NOT_LESSON_CONTENT, minWidth: MIN_PART_W });
}

module.exports = { MIN_PART_W, describeCollapsed, settle, readParts };
