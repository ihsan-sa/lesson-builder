# Malformed-agent-return evidence

Proof that the Phase 3 boundary refuses a specialist's return before the splice consumes it. A manim
or web-image agent stages and promotes its own artifact and then returns a JSON manifest —
`mp4_path`, `py_path`, `sha256`, `effective_action` — that assembly reads the `<video src>` out of
(`references/phase-3-execution.md` § Step 3, § Step 4). The gate is `run-manifest.cjs check-return`;
its rule is in that script's header.

```
node tests/agent-return/check.cjs     # or ./check.cjs
```

Node only. No manim, no model, no browser, no network, no `npm install`: each case builds its own
lesson root and its own promoted artifacts under a fresh temp dir, through the real `stage` and
`promote`. Runs in a few seconds from a clean checkout. Exit code 0 only when every check passes.
`KEEP=1` keeps the temp roots and prints the path.

Until this existed the only thing between a truncated or invented manifest and the lesson was main
Claude reading it. The check needs no schema per agent, because the record already knows what the run
promoted: the paths a return claims must be exactly the artifacts on that media row — no more, so
nothing written behind the staging area's back is spliced in, and no fewer, so a manifest that forgot
half of what it produced is caught. It writes nothing; a refusal is answered by respawning that
specialist once with the same brief.

## What `check.cjs` asserts

| | Case | Must hold |
| --- | --- | --- |
| 1 | the return a specialist is supposed to make | exit 0, echoing the action and both promoted artifacts, each with the hash the record holds rather than the one the return claimed; the lesson tree is untouched; `sha256` is optional and all five taxonomy actions are verdicts |
| 2 | a return that does not parse | cut off part-way, prose instead of a manifest, a manifest in a fenced code block, a manifest with a trailing apology, nothing at all, whitespace — each exits 10 naming the media id, and none writes into the lesson tree or onto the media row |
| 3 | JSON that is not a manifest | an array, a string, a number, `true` each exit 10 — except a bare `null`, which is the documented web-image `refine` no-op and is reported as one, claiming nothing |
| 4 | an action the plan has no verdict for | no `effective_action` at all, and `rerender` / `REPLACE` / `""` / `null` / `3` / `["replace"]`, each exit 10 naming the five it could have been |
| 5 | a path the run never promoted | a file written straight into the lesson tree past the staging area exits 10 **even though the file is there**, and the refusal names what the run did promote; a path that is not there, one that traverses, an absolute one, an empty one, a non-string one, and a manifest naming no path at all each exit 10; the promoted artifacts are still in place |
| 6 | a manifest that forgets half of what it produced | naming only the video exits 10 and names the `.py` it left out; an explicitly nulled `py_path` is the same omission; naming both passes; a media id nothing planned exits 10 |
| 7 | a hash that is not the hash of those bytes | a hash matching neither file, and four that are not SHA-256s at all, exit 10; the same hash upper-cased passes, the `.py`'s own hash passes, an explicitly null hash is no claim; bytes changed after the promotion make the record's own hash stale and exit 10, because the check hashes the file on disk |
| 8 | a production the run already recorded as failed | a manifest for that media row exits 10 quoting the reason the run recorded — there is nothing for a manifest to describe |
| 9 | how the return is handed over | `--from <file>` and stdin answer the same; a file that is not there, and a missing `--media-id`, are usage errors (exit 1) rather than a verdict about the return |

Cases 2 and 5 are the two the brief names: the spawn that died mid-write, and the manifest that
points the splice at a file nothing validated. Case 6 is the same failure from the far side — the
`.py` a future refine needs, promoted and then not mentioned.
