# AST inventory and splice evidence

Proof that the media inventory, the splice and the unused-code report come from a Babel parse of
the lesson rather than from greps, filename stems and brace matching. The script is
`scripts/lesson-ast.cjs`; the contract is in its header, in
`references/phase-1-content.md` § Existing-media inventory pre-scan and in
`references/phase-3-execution.md` § Step 4.

```
node tests/ast-inventory/check.cjs     # or ./check.cjs
```

Node plus one dependency: `@babel/parser`, at the version `references/bootstrap/lesson-template/`
already pins, installed into a temp dir the way a lesson installs it (served from the npm cache
when there is one). No browser, no manim, no lesson build. Runs in about four seconds from a clean
checkout. Exit code 0 only when every check passes. `KEEP=1` keeps the temp lesson roots and prints
the path.

`lesson/` is the fixture lesson: two graph components, a capitalised lesson-local helper
(`HWQuestion`), a helper with one user (`polarPath`), a helper with two (`axisTicks`), a helper with
none (`normalizeGain`), a base64 image constant, a static image, a video whose manim source is named
nothing like it, an interactive demo, an unused import, an unreferenced image and a `.py` no video
comes from. Every case copies it into a lesson root of its own.

## What `check.cjs` asserts

| | Case | Must hold |
| --- | --- | --- |
| 1 | the inventory of that lesson | both graphs are graphs, with the `DEFAULT_GRAPH_PARAMS` key each component actually reads and a line range that starts at the definition and ends at its closing brace; `HWQuestion` is a `lesson-helper` and **not** a graph, and `LessonApp` is neither; each helper's `used_by` names its real users and the unused one's is empty; the base64 constant is found by name with its blob left out and the `IMG` path prefix is not mistaken for one; the image and video resolve under `public/`; the video is paired to `wave_animation.py` on the evidence `scene-class`, because the stems do not match; the demo is found by title with the `useState` names it reads; the unreferenced image and the unpaired `.py` are orphans and the paired `.py` is **not** |
| 2 | the same lesson with its `GRAPH_SCHEMA` export removed | `graph_schema_backfill_needed` is true, the schema key list is empty and no graph claims a `graph_schema_key`, while the params keys are unaffected |
| 3 | replacing a graph component | the file afterwards is byte-for-byte the old file with that one line range swapped — recomputed here from the range and the replacement, not read from the receipt — every other line is unchanged and in order, the result parses, the receipt names the range and the bytes each way, and no `.part` file is left |
| 3b | replacing an interactive demo, matched by the title a person set | the block is found by that title, only that range changes, the title is still the title afterwards and the state hooks are re-read from the new block; a title that is not there exits 3 |
| 4 | a replacement that does not parse | exit 4 saying so and that nothing was written, the lesson byte-identical, no `.part` file |
| 5 | removing a graph, its call site, its params key and its schema key in one pass | all four are gone with no run of blank lines where they were, the surviving `<LiveGraph>` wrapper keeps its call site and no empty wrapper is left, the two key lists still agree, and exactly the lines the receipt named are gone with no other line moved |
| 6 | what a removal strands | `normalizeGain` and the unused import are already unreachable but `React` is not, because the JSX compiles through it; removing `polarPath`'s only user strands it and says which removal did; removing one of `axisTicks`'s two users strands nothing, and removing both strands it |
| 7 | a lesson that does not parse, and targets that are not there | exit 2 with the file, line and column and no inventory on stdout — never a quiet fall back to regex; a missing component, a missing params key and no target at all each refuse with the lesson untouched |

Cases 1, 3 and 6 are the three the brief names: the helper that a capitalised-function grep called a
graph, the manim source that a filename stem called an orphan, and a splice that knows exactly what
it replaced instead of being sanity-checked by a line-count delta.
