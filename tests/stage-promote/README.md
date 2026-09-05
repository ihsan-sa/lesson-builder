# Stage-validate-promote evidence

Proof that no producer can leave a broken or partial artifact where the lesson reads it: everything
is written into the run staging area, validated there, and moved into the lesson tree only by
`scripts/run-manifest.cjs promote` — write to a dotted `.part` name, then rename. The rule and the
staging paths: `references/run-record.md` § Artifacts, `references/phase-3-execution.md` § The run
staging area.

```
node tests/stage-promote/check.cjs     # or ./check.cjs
```

Node only. No manim, no ffmpeg, no browser, no network, no `npm install`: the manim cases drive the
real pipeline against shell stubs for `manim`/`ffmpeg`/`ffprobe` that the fixture writes and puts on
PATH. Each case builds its own lesson root and its own artifacts under a fresh temp dir. Runs in
about ten seconds from a clean checkout. Exit code 0 only when every check passes. `KEEP=1` keeps
the temp roots and prints the path.

## What `check.cjs` asserts

| | Case | Must hold |
| --- | --- | --- |
| 1 | `stage` | the path is under `.lesson-builder/staging/<run_id>/<media_id>/`, the directory exists and the file does not, the lesson tree is untouched, and a media id or file name that traverses is refused before anything is created |
| 2 | a complete PNG promoted against a planned media row | the file is in the lesson tree byte for byte, the record carries its SHA-256, size and path, the plan's own `intent`, `status` and `path` are left alone, no failure is recorded, and no `.part` file remains |
| 3 | the same producer run twice with identical bytes, then with different bytes | the second promotion reports `unchanged` and the file keeps its inode and mtime — nothing in the lesson tree changes — and the record keeps the timestamp the bytes first landed at; different bytes at the same path do promote |
| 4 | a production killed mid-write (a PNG staged without its IEND chunk), then `fail` for one that produced nothing at all | the promotion exits 6 naming the truncation, the previous artifact is still there on the same inode, no partial file is in the lesson tree, the record carries the reason and the target while still describing the good artifact; `fail` records a reason and invents no `intent`; a later good promotion clears the failure |
| 5 | a promotion over a file with a hard-linked twin, then a real `SIGKILL` of the promotion while it copies 24 MB | the twin keeps the old bytes and the destination is a new inode, so the file was renamed over and never written through; after the kill the final name holds either nothing or the complete artifact, and anything half-written is a dotted `.part` name that can never be mistaken for the artifact |
| 6 | promotions from outside this run's staging dir — a file written straight into the lesson tree, and another run's staging dir — and destinations outside the lesson root or inside `.lesson-builder/` | each exits 6 and promotes nothing, while the same bytes staged by this run promote fine |
| 6b | a lesson with no `.lesson-builder/` at all, then one holding a finished build run's record | staging is refused and says to `init` first, `current` exits 3, and no staging area is created; a producer that opens its own run stages and promotes under that run id, its record carries the artifact and its hash, and the finished run's record is byte-identical afterwards |
| 7 | one file per kind: empty, JPEG with no EOI, SVG with no closing tag, MP4 whose boxes run past the end, a whitespace-only `.py`, then complete ones, an unknown extension, and `--min-bytes` | every incomplete file is refused and never reaches the lesson tree; complete ones pass; an extension with no known shape says in its receipt that the bytes were not inspected |
| 8 | `render` after one promotion and one failure | the log carries the artifact hash, where it landed, and the failed production with its reason; rendering twice is byte-identical |
| 9 | `manim-runner.js` with no manim on PATH, then against the stubs | `checkDependencies` reports all three missing and then all three present without throwing; a missing manim and each bad argument come back as `{ ok: false, reason }`; the five stages run (dry run, preview still, render, ffprobe duration, three keyframes) into the staging path and put nothing in the lesson tree; the promote step then moves it under the hash of the bytes that were validated; a re-render that fails at the dry run leaves the promoted video on its own inode and records the reason |

Case 6b is the runtime-chat path: the tutor's manim render has no build run to attach to, so it
opens one (`agents/manim-agent.md` § File contract) rather than writing into a closed one.

Cases 4 and 5 are the two the brief names: a production killed mid-write leaves the lesson tree
exactly as it was and says why, and the lesson tree never holds a partial artifact under its final
name. Case 9 is the one existing producer — manim — proved to still do everything it did before,
with the promotion moved out of it.
