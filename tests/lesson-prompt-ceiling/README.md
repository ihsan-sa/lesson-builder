# A lesson's own gate fails over the tutor-prompt ceiling

`references/bootstrap/lesson-template/test_lesson.cjs` **T18** assembles `buildSystemPrompt` (from the
workspace's `_lesson-core`) over the lesson's LESSON_CONTEXT, in isolation and shared-memory mode, and
fails when the larger is over `SYSTEM_ARGV_CEILING` (`_lesson-core/constants/promptBudget.js`, 28000,
the argv threshold in `server/proxy.js`). Above it the proxy demotes the prompt into stdin and nothing
else fails: the build passes, the lesson serves.

```
node tests/lesson-prompt-ceiling/check.cjs     # in the gate
```

Node plus one `npm install --prefer-offline` of `@babel/parser` (npm cache). Each case scaffolds its own
workspace: the real core files, the real `test_lesson.cjs`, a one-file fixture lesson.

1. **Under the ceiling:** passes, prints size, ceiling and headroom, and measures the larger mode.
2. **Oversized:** a context 1500 chars past the ceiling fails T18 and exits 1, naming the size, the
   ceiling and the overflow (1500) and how much to cut.
3. **The edge:** exactly 28000 passes with headroom 0; 28001 fails, over by 1.
4. **Unmeasurable:** no LESSON_CONTEXT, or no `_lesson-core` beside the lesson, fails instead of passing.
5. **One number:** `test_lesson.cjs`, `tutor-policy/check.cjs` and `sweep.mjs` carry no 28000 literal, and
   `server/proxy.js`'s threshold equals the constant.
6. **A malformed enum schema** (`test_lesson.cjs` T19, 2026-09-26): an enum with `options:` in place of
   `values:` fails T19 naming the field, while `values:` and a lesson with no GRAPH_SCHEMA pass, and a
   value T19 cannot read fails. Over the same schema the core's `buildActiveContext` does not throw: it
   leaves the field out, keeps the rest and warns once; `validateEdit` refuses edits to that field only.
   It sits here because this fixture already scaffolds a lesson beside a real core.

Cases 1-5 fail without T18, and case 6 fails against the core and template from before T19. Measured once against the 48 lessons of a real lessons checkout
(2026-09-21): 48/48 pass, smallest headroom 249 chars (`RF/directional-couplers`).
