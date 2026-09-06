# Attested-verdict evidence

Proof that a Phase 4 verdict is reused only against proof, and that coverage never shrinks: a
verdict is recorded with the artifact's bytes, the rubric that judged it, the reviewer that judged
it and every dependency the review declares, and a later run reuses it only while all of that still
hashes the same. An artifact with no valid attestation is reviewed. The rule and the schema:
`references/run-record.md` § Attested verdicts, `references/phase-4-review.md` § Reusing a verdict
that still holds.

```
node tests/attestation/check.cjs     # or ./check.cjs
```

Node plus one dependency: `@babel/parser`, at the version `references/bootstrap/lesson-template/`
already pins, installed into a temp dir the way a lesson installs it (served from the npm cache when
there is one) — a `<file>#<Name>` ref is hashed by `lesson-ast.cjs`, which parses. No model calls,
no browser, no manim, no lesson build. Runs in about a minute from a clean checkout. Exit code 0
only when every check passes. `KEEP=1` keeps the temp roots and prints the path.

`lesson/` is the fixture lesson: two graph components that share a helper `axisTicks`, a helper
`polarPath` only one of them uses, and an interactive demo — all three media in the one file, so a
change to any of them is a change to that file. Two more media are file-backed (a matplotlib source
and the data it feeds). Two rubrics and two reviewers cover them, eight reviews in all. Every case
gets its own lesson root: either a fresh copy of `lesson/`, or a copy of one reviewed lesson built
once at startup, which is the fixture a second-run case starts from.

## What `check.cjs` asserts

| | Case | Must hold |
| --- | --- | --- |
| 1 | a first run, with no prior attestations | every review is in the `review` set for the reason `no attestation` and nothing is reused — the batch is exactly what it always was; the coverage gate refuses until every verdict is in, and then passes; each verdict records the reviewer's model, the rubric by its bytes and the artifact by its hash, and is not marked reused; a graph in the shared lesson file attests to its own declaration, hashed apart from the helper beside it |
| 2 | a second run after one artifact's bytes changed | that artifact and the medium that declares it as a dependency are reviewed, naming which of the two it was; the other five reviews are reused; the gate refuses until the reviewed set is judged and then passes, so every artifact ends the run with a verdict; a reused verdict says which run made it, keeps that run's timestamp and carries this run's adoption time; deciding twice in one run reviews nothing further and does not report the run's own verdict as reused from itself |
| 3 | a shared helper edited | both graphs that use it are reviewed, named as the dependency that changed; the demo in the same file and the file-backed media are reused |
| 3b | one declaration in that shared file edited | only its own medium is reviewed; the other graph and the demo in the very same file are reused |
| 3c | a declared dependency deleted, its user untouched | that medium goes back to review naming the ref that is gone, and nothing else in the file goes with it |
| 4 | a rubric edited | every review that names that rubric is reviewed again; the ones judged by the other rubric are reused |
| 5 | the reviewer's model changed | that reviewer's verdicts are reviewed again; the other reviewer's still hold |
| 6 | an artifact edited straight into the lesson tree, no `promote`, record not updated | the record still carries the old hash, and the artifact is reviewed anyway because the check hashes the file on disk; it is never reused; editing it after a verdict fails the coverage gate, which names it and what depends on it |
| 7 | a record written before attestations existed — findings with no artifact hash, no attestation anywhere | the next run reviews everything, reuses nothing, ends with a verdict on every artifact, and leaves the old record as it was |
| 8 | what is refused | `unavailable` is not a verdict; a verdict from a reviewer the spec never asked for; a review that resolves to no artifact at all; a ref that leaves the lesson root; a spec naming the same review twice — and a `skill:` ref hashing the skill's own file, so a record holds no path that is only true on one machine |
| 9 | the rendered log | the first run's verdicts name the reviewer that made them, the second run's reused ones say `REUSED from run <id>` with the original timestamp, the re-reviewed artifact carries this run's own verdict, and re-rendering is byte-identical |

Cases 2, 3 and 3b are the ones the brief names: the run that pays for what changed and reuses the
rest, and the per-declaration granularity that keeps refining one graph from invalidating the five
beside it. Cases 6 and 7 are the two ways reuse must fail closed — a tampered artifact, and a
record from before any of this existed.
