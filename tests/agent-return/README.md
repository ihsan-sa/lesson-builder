# Malformed-agent-return evidence

Proof that the Phase 3 boundary refuses a specialist's return before the splice consumes it — and
that it accepts the returns the agent files actually specify. A manim or web-image agent stages and
promotes its own artifact and then returns a JSON manifest that assembly reads the `<video src>` or
the `<img src>` out of (`references/phase-3-execution.md` § Step 3, § Step 4). The gate is
`run-manifest.cjs check-return`; its rule is `references/run-record.md` § The Phase 3 return
boundary.

**The returns in the cases below are copied from the agent files, not invented**:
`agents/manim-agent.md` § Stage 4 and `agents/web-image-agent.md` § Return format. A boundary
checked against a shape nobody produces refuses every correct return, and the respawn it prescribes
returns the identical JSON — so the fixture feeding its own invention is the way this check silently
stops working.

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
| 1 | the return each agent file documents, verbatim | manim's object exits 0, echoing `as-briefed` and both promoted artifacts, each with the hash the record holds rather than the one the return claimed, while `keyframes` — real files under a key that is not a path key — is not read as a claim; `degraded-to-replace` and the runtime-chat return whose `py_path` is null also pass; `sha256` is optional; the web-image object exits 0 naming its one image, states no action at all without that being a refusal, accepts `format_change`, and its `served_url` (`/images/…`, absolute-looking) is not read as a second file; the lesson tree is untouched |
| 2 | a return that does not parse | cut off part-way, prose instead of a manifest, a manifest in a fenced code block, a manifest with a trailing apology, nothing at all, whitespace — each exits 10 naming the media id, and none writes into the lesson tree or onto the media row |
| 3 | JSON that is not a manifest, and the two no-change returns | an array, a string, a number, `true` each exit 10; a bare `null` and `{action: keep_existing}` are the documented no-ops and pass **only from a run that promoted nothing**, reported by the word the agent used — from a run that did promote, both exit 10 naming the work the manifest dropped |
| 4 | an action neither agent file specifies | stating no action is not a refusal; the plan's `keep`/`refine`/`replace`/`remove`/`add` each exit 10, because that taxonomy is the other axis — what the run was asked to do, on the media row as `intent`, not what the agent says it did; `rerender` / `AS-BRIEFED` / `""` / `null` / `3` / `["as-briefed"]` exit 10 naming the four the agent files specify; the word is read under `effective_action` or `action` alike |
| 4b | a return that reports its own failure | manim's documented failure return (`ok: false`, nulls, `reason_if_failed`) exits 10 quoting that reason rather than falling through to "it names no path"; the same shape with `ok: true` is the no-op instead |
| 5 | a path the run never promoted | a file written straight into the lesson tree past the staging area exits 10 **even though the file is there**, and the refusal names what the run did promote; a path that is not there, one that traverses, an absolute one, an empty one, a non-string one, and a manifest naming no path at all while this run promoted two, each exit 10; the promoted artifacts are still in place |
| 6 | a manifest that forgets half of what it produced | naming only the video exits 10 and names the `.py` it left out; an explicitly nulled `py_path` is the same omission; naming both passes; a media id nothing planned exits 10 |
| 7 | a hash that is not the hash of those bytes | a hash matching neither file, and four that are not SHA-256s at all, exit 10; the same hash upper-cased passes, the `.py`'s own hash passes, an explicitly null hash is no claim; bytes changed after the promotion make the record's own hash stale and exit 10, because the check hashes the file on disk |
| 8 | a production the run already recorded as failed | a manifest for that media row exits 10 quoting the reason the run recorded — there is nothing for a manifest to describe |
| 9 | how the return is handed over | `--from <file>` and stdin answer the same; a file that is not there, and a missing `--media-id`, are usage errors (exit 1) rather than a verdict about the return |

Cases 2 and 5 are the two the brief names: the spawn that died mid-write, and the manifest that
points the splice at a file nothing validated. Case 6 is the same failure from the far side — the
`.py` a future refine needs, promoted and then not mentioned.
