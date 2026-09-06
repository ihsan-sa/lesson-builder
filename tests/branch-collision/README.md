# Branch-collision evidence

Proof that an update run whose branch name is already taken lands on a deterministic one, in its own
worktree, and that the name Phase 5 merges is the name that was created. The rule:
`references/checklists.md` § Update-mode pre-flight ("increment with a suffix (`-a`, `-b`) …
Collision handling must be deterministic so the Phase 5 merge target is unambiguous"), the format
`references/update-mode.md` § Branch name format, the command `run-manifest.cjs branch` and what it
refuses `references/run-record.md` § The run's branch.

```
node tests/branch-collision/check.cjs     # or ./check.cjs
```

git and node only. No network, no `npm install`, no build, no browser. Each case builds its own
workspace repo, its own lesson and its own record under a fresh temp dir. Runs in a few seconds from
a clean checkout. Exit code 0 only when every check passes. `KEEP=1` keeps the temp repos and prints
the path.

The suffix used to be a model's choice made in prose, which is the one thing the checklist says it
must not be: two runs of the same lesson on the same day, and Phase 5 merges whichever name the
session happened to pick. `branch` picks it, creates it in the build worktree at the recorded base
SHA, and records what it created — Phase 5 reads `git.branch` back verbatim and never rebuilds it
from the pattern.

## What `check.cjs` asserts

| | Case | Must hold |
| --- | --- | --- |
| 1 | no collision | the plain `lesson-update/<slug>-YYYYMMDD`, dated from the run record's own `started` stamp and not from today; it is the only branch added, the worktree is on it, it starts exactly at the recorded base SHA, and the user's checkout is still on `main` with a clean tree |
| 2 | the name is taken by a previous run of the same lesson on the same day | the run takes `-a`, says on stderr which name was already there, records the suffixed name — which is what Phase 5 merges — leaves the existing branch where it was, and puts the worktree on the suffixed one |
| 2b | the plain name and `-a` taken, created out of order | `-b`; and with `-b` free but `-c` taken, still `-b` — the first gap in `a`…`z`, never the one that sorts first or last in `for-each-ref` |
| 3 | the same run asking twice, after a crash that left a commit on the branch and HEAD detached off it | the second call answers with the branch the run already has rather than opening a second beside it, puts the worktree back on it, and the commit it already carried is still there |
| 4 | what is refused | no worktree recorded → exit 3 saying to add one, and nothing created in the user's checkout; a recorded branch somebody deleted → exit 3 naming it, nothing created, the record left saying what it said; the plain name and every `-a`…`-z` suffix taken → exit 9 saying to use `--name`, no branch added and none recorded; a `--name` that traverses or starts with `-` → refused, nothing created |
| 5 | a remote-tracking ref of the same name | not a collision: the checklist asks whether the name exists locally, `checkout -b` is not blocked by one, and treating it as a collision would push every re-run of a pushed lesson onto a suffix nobody asked for |
| 6 | called from inside the worktree, as Phase 3 does | the worktree's lesson root holds a `record-root` pointer and no records of its own; the call there gets the same suffixed name and the one record beside the user's lesson root carries it |
| 7 | the rendered log | it names the branch the run is actually on, and never the plain name it collided with |

Case 2 is the one the brief names. Case 3 is the one that makes a resumed Phase 3 safe, and case 5
is the collision that is not one.
