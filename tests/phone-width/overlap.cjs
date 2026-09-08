// A control sitting on top of the equation it belongs to, and the measurement
// that catches it. Required by check.cjs (this fixture's two scaffolded demo
// lessons, at two viewports) and by sweep.cjs (every lesson of a real built
// site at phone width).
//
// WHY THIS EXISTS. Overlap is the defect the owner reported on 2026-09-06: at
// 390px an equation's control sat on the equation. It is not the same defect as
// a part squeezed to nothing (collapse.cjs) and neither measurement implies the
// other — a control can land on an equation that is a comfortable 287px wide,
// and an equation squeezed to 0px has nothing left to land on. Until this file
// existed the overlap measurement lived inside check.cjs, so it only ever ran
// over the fixture's own scaffolded lessons; the sweep over the real corpus
// measured collapse alone and its "41 of 41 ok" could not tell "no overlap"
// from "overlap never looked for".
//
// So: one implementation of the measurement, read by both runs.

// Anything smaller than this is a rounding artefact of subpixel layout, not a
// control sitting on an equation: a real overlap in this bug is tens of pixels
// wide and the whole height of the pill.
const EPS_AREA = 0.5;

// The two things an equation carries that can land on it. Named, because the
// failure message has to say WHICH part covered the equation.
const OVERLAP_PARTS = [
  { part: "side rail", key: "sideOverlap" },
  { part: "caption", key: "labelOverlap" },
];

// Runs in the page. Every number is a real getBoundingClientRect on the
// laid-out document, never one computed from the stylesheet. Self-contained:
// page.evaluate ships the source, so nothing outside this function is in scope.
function measureEquations() {
  const rect = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  };
  const intersect = (a, b) => {
    if (!a || !b) return null;
    const left = Math.max(a.left, b.left), right = Math.min(a.right, b.right);
    const top = Math.max(a.top, b.top), bottom = Math.min(a.bottom, b.bottom);
    if (right <= left || bottom <= top) return null;
    return { left, top, right, bottom, width: right - left, height: bottom - top, area: (right - left) * (bottom - top) };
  };

  // The glyphs, not the box that holds them. In display mode KaTeX makes
  // .katex-display, .katex and .katex-html full-width blocks and centres the
  // formula inside them, so the .katex rect reaches the far edge of a column
  // the equation itself covers a fraction of -- and every absolutely positioned
  // control in that column reads as covering it. `.katex .base` is
  // inline-block, width: min-content: it hugs the formula, which is what a
  // reader would point at. One rect per base, because a formula KaTeX broke
  // over lines has several and their union is not what any of them covers.
  const inkRects = (math) => {
    if (!math) return [];
    const bases = [...math.querySelectorAll(".base")];
    return (bases.length ? bases : [math]).map(rect);
  };
  const area = (r) => (r ? r.width * r.height : 0);

  return [...document.querySelectorAll(".eq-block[data-latex]")].map((block, i) => {
    const body = block.querySelector(".eq-body");
    const side = block.querySelector(".eq-side");
    const label = block.querySelector(".eq-label");
    const math = body && (body.querySelector(".katex") || body.querySelector(".eq-raw"));
    // What the reader sees is the formula clipped to .eq-body, which is its own
    // scroll container (overflow-x). Intersecting with it rather than taking
    // the bare glyph rects keeps ink that is scrolled out of sight from
    // counting as on screen.
    const ink = inkRects(math).map((r) => intersect(r, rect(body))).filter(Boolean);
    const worst = (el) => {
      const r = rect(el);
      let hit = null;
      for (const part of ink) {
        const o = intersect(part, r);
        if (o && (!hit || o.area > hit.area)) hit = o;
      }
      return hit;
    };
    return {
      i,
      latex: (block.getAttribute("data-latex") || "").slice(0, 40),
      rendered: math ? (math.classList.contains("katex") ? "katex" : "raw") : "none",
      body: rect(body),
      inkArea: ink.reduce((sum, r) => sum + area(r), 0),
      inkWidth: ink.reduce((w, r) => Math.max(w, r.width), 0),
      sideOverlap: worst(side),
      labelOverlap: worst(label),
      sidePosition: side ? getComputedStyle(side).position : null,
      blockPaddingLeft: getComputedStyle(block).paddingLeft,
      blockPaddingRight: getComputedStyle(block).paddingRight,
    };
  });
}

// Which of the parts an equation carries land on it, if any. One entry per part
// that covers more than a rounding artefact, so a caller can name the part.
function overlappingParts(eq) {
  return OVERLAP_PARTS
    .map(({ part, key }) => ({ part, o: eq[key] }))
    .filter(({ o }) => o && o.area > EPS_AREA);
}

// The equations something lands on, each with the parts that land on it.
function overlaps(equations) {
  return equations
    .map((eq) => ({ eq, hits: overlappingParts(eq) }))
    .filter(({ hits }) => hits.length > 0);
}

// One line per overlapping part, naming the equation and which part covered it.
// This is what a failing run prints, so it says what landed on what, not just
// that something did.
function describeOverlaps(equations) {
  return overlaps(equations)
    .flatMap(({ eq, hits }) => hits.map(({ part, o }) =>
      `eq${eq.i} ${part} covers ${Math.round(o.width)}x${Math.round(o.height)}px of the equation — ${eq.latex}`))
    .join("\n        ");
}

// An equation with no ink on screen is one no overlap could have been seen on:
// a control cannot be measured as landing on a formula that is not there. Kept
// separate from the failure so a run can say how many equations it could
// actually have caught an overlap on, rather than letting them pass in silence.
function blankEquations(equations) {
  return equations.filter((eq) => eq.inkArea <= EPS_AREA);
}

async function readEquations(page) {
  return page.evaluate(measureEquations);
}

module.exports = { EPS_AREA, readEquations, overlaps, describeOverlaps, blankEquations };
