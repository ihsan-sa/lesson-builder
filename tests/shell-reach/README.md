# Does LessonShell reach a classic lesson's bundle?

Measured, on built bundles, rather than asserted in a comment.

`index.js` is the barrel. Every one of the 41 lessons imports `@core`, the vite alias resolves that
to `index.js`, and `index.js:20` re-exports `LessonShell` from `./ui/LessonShell.jsx` with a static
export — so the shell is in all 41 import graphs. The only thing keeping it out of the 39 classic
lessons' bundles is Rollup dropping an export nothing reaches, and nothing in the source says
whether that still holds. This fixture reads the emitted JavaScript and says.

Dropping the barrel export would settle it at the source, and is not available from here: the two
shell lessons import `LessonShell` from `@core` and they live in `~/dev/lessons`, which this repo
does not edit.

```
tests/shell-reach/run.sh          # part of tests/check.sh, ~15s
KEEP=1 tests/shell-reach/run.sh   # keep the workspace and its three dist trees
```

`run.sh` bootstraps a throwaway workspace per `references/bootstrap.md`, scaffolds one lesson, and
builds it three times from two bodies. No browser, no proxy, no model. Exit code 0 only when every
case passes.

**The two bodies differ only by the `<LessonShell>` wrapper.** `lesson/classic_demo.jsx` is the
pre-shell shape the 39 have — it injects `STYLES` from `chat/chat.css.js` itself, draws its own
header, its own DARK button and its own tab bar, and mounts `<Chatbot>`.
`lesson/shelled_demo.jsx` is that same lesson with its body wrapped in the shell. That is what makes
case 4 a control for cases 2 and 3: it is a classic lesson whose bundle *does* contain the shell,
read by the same detector.

## What `check.cjs` asserts

Each case reads its own dist tree; none depends on another's.

| | Build | Must hold |
| --- | --- | --- |
| 1 | none — the core sources | the lesson template aliases `@core` to the core directory and `index.js` re-exports `LessonShell` with a static export, so the shell IS in the graph; `chat/shell.css.js` is imported by `ui/LessonShell.jsx` and by nothing else; each of the six markers is present in one of those two files and in no other file in the core; neither non-vacuity marker is one of the shell's strings |
| 2 | `VITE_TUTOR=1 vite build`, classic body | no marker in the bundle; `chat/chat.css.js` IS in it; the tutor really mounted |
| 3 | `vite build`, classic body | no marker in the bundle; `chat/chat.css.js` IS in it |
| 4 | `VITE_TUTOR=1 vite build`, shelled body | all six markers in the bundle |

Case 1 comes first because every case after it is only as good as its claims. Its first pair is what
stops cases 2 and 3 from passing on a shell that was never in the graph to begin with. It caught a
marker on the way in, too: `"Open the tutor"`, the round-toggle title `tests/hosted-build` uses, is a prefix of the
shell's own `"Open the tutor in its own window"`, so it would be found in a classic bundle whether
or not the tutor mounted. This fixture uses `"Pop-ups blocked"` instead.

The classic body is built **both** ways because the two ask different questions. Case 3 is the shape
the 39 publish — plain `vite build`, what Netlify and the tailnet run. Case 2 is the larger bundle:
the tutor gate drops code and adds none, so a shell absent there is absent from the smaller one too,
and it is the build in which all six markers would be live. That difference is visible: with the
shell forced into the classic body, case 2 finds six markers and case 3 finds five — the pop-out
button sits inside the tutor gate.

Cases 2 and 3 assert `chat/chat.css.js` is present as well as the shell absent. A build that emitted
nothing would satisfy "no shell" on its own.

## The markers

Rendered text and attributes from `LessonShell.jsx`, plus two class names it shares with its own
sheet: `Position in this lesson`, `Show contents`, `Switch to the dark theme`,
`Open the tutor in its own window`, `topbar-monogram`, `rail-label`.

Two kinds of string do not belong on that list, and case 1 is what keeps them off it. Anything from
`ui/shellContext.js` — `Chatbot.jsx` imports `useShell` from it, so it reaches all 41. And anything
from `chat/chat.css.js`, which all 41 import: `.rail` is styled in both sheets, so it would be found
in every bundle.
