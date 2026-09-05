# Run-record evidence

Proof that `scripts/run-manifest.cjs` writes, reads, hashes and renders a lesson run's state — and
that the headless approval gate decides on the record rather than on markdown. Schema and field
ownership: `references/run-record.md`.

```
node tests/run-manifest/check.cjs     # or ./check.cjs
```

Node only. No `npm install`, no network, no browser, no lesson build: each case builds a tiny sample
lesson root under a fresh temp dir and drives the script against it. Runs in about ten seconds from a
clean checkout. Exit code 0 only when every check passes. `KEEP=1` keeps the temp roots and prints the
path.

## What `check.cjs` asserts

| | Case | Must hold |
| --- | --- | --- |
| 1 | `init`, then `init` again on the same run id | the record carries `schema: lesson-run/1`, mode, session mode, slug, empty git/media/findings; the second `init` exits 2 and the first record's `started` is untouched |
| 2 | `set` / `get` / `append` over base SHA, branch (with a collision suffix), stash OID, media rows, findings, phase notes | every field reads back as written; a field never set, and one `init` seeded as `null`, both exit 3 rather than printing the string `null`; `append` onto a non-array is an error |
| 3 | `plan-hash` over a plan artifact, then over a revised one | the hash equals `sha256sum \| cut -c1-8` computed independently; the hash and the artifact path are recorded; an unapproved plan becomes `pending`; a revision hashes differently |
| 3b | a plan approved, then revised; the same plan re-hashed unchanged; a plan revised after a person aborted | the revision goes back to `pending` and the old hash stops approving while the new one works; an unchanged re-hash keeps the approval; a revision does not un-abort the run |
| 4 | `approve` at the recorded hash, twice, the second time upper-cased and with a later `--at` | exit 0; the record says `approved` and names what approved it; the second call still matches but does not move the timestamp the person's approval got |
| 5 | `approve` at a stale hash after a revision, at a 4-character prefix, and at a non-hex string; then at the current hash | the first three exit 3 and leave the plan `pending` (the refusal names the current hash); the current hash exits 0 |
| 6 | `approve` on a run that recorded no plan — the task text carries an approval, nothing was recorded | exit 4; no hash is invented from the task text and nothing is marked approved |
| 7 | `approve` at the right hash on a run a person aborted | exit 5; the abort stands |
| 8 | `render` a new-mode run carrying plan, approval, branch, base SHA, commit SHA, a media row, a phase note, one open and one resolved finding | every heading from the log template is present; the approval, branch, base SHA, commit SHA, media intent and note render; the open finding is under `UNRESOLVED` and the resolved one is not; rendering twice is byte-identical and does not stack a second copy |
| 9 | a lesson whose `lesson_build.log.md` was hand-written before records existed, then updated | the run starts a record without a rewrite; the old log is still the file's exact prefix, its note appearing once; the update renders below the marker as `## Update … (run-id: …)` with nested `### Phase N — … (update)` headings; a second render changes nothing |
| 9b | a run that records a `push-to-custom` deploy triple, renders, then a second run opened after it | the triple renders under Phase 5 and not also under Phase 0, while other scoping fields still render under Phase 0; `current` names the prior run before the new `init`, `get --run <prior>` reads the destination back, and the new run's own `scoping.deploy_action` exits 3 rather than defaulting silently; a run with no stash renders `Working tree state: clean`, while one that recorded `discarded` renders that word once and never `clean` |
| 10 | three `init`s, two of them started in the same second, then `plan-hash` with no `--run` | `current` returns the newest, tie-broken on run id rather than directory order; the hash lands on that record and not on the older one |

Cases 6 and 9 are the two the brief names: the approved-but-nothing-recorded outcome, and a lesson
whose log predates the record. Case 9b covers the one field a later run inherits from an earlier one —
the deploy destination, which used to be parsed out of the previous run's log.
