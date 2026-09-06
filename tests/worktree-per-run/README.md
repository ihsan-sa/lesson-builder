# Worktree-per-run evidence

Proof that an update run never touches the user's working tree: it builds in a git worktree of its
own, checked out from the base SHA the run record holds, commits and merges in there, and prunes it
only when no work would go with it. The rule and the commands: `references/update-mode.md` §5,
`references/run-record.md` § The build worktree, `references/phase-0-scoping.md` § The base SHA and
the build worktree, `references/phase-5-deploy.md` § Step 2b.

```
node tests/worktree-per-run/check.cjs     # or ./check.cjs
```

git and node only. No network, no npm install, no build, no browser. Each case builds its own
workspace repo, its own bare origin and its own record under a fresh temp dir. Runs in about ten seconds from a
clean checkout, well inside the minute the brief allows. Exit code 0 only when every check passes. `KEEP=1` keeps the temp
repos and prints the path.

## What `check.cjs` asserts

| | Case | Must hold |
| --- | --- | --- |
| 1 | a whole update run — Phase 0, branch, build, commit, merge, push, prune — against a tree dirtied with an uncommitted edit and an untracked file, with the log rendered between the phases as every phase renders it | every file of the user's working tree hashes the same at the end as at Phase 0, and so do `git status`, HEAD, the branch, the index and the (empty) stash list, apart from the rendered `lesson_build.log.md`: it is the only file the run puts in their checkout, and being untracked but not ignored it is the only line it adds to their `git status`; the branch is checked out in the worktree and never in their checkout; local `main` is not moved because their checkout holds it, while the merge is published to origin all the same and fast-forwards their `main` when they choose to |
| 2 | `get`, `set`, `current`, `stage` and `render` given the worktree's lesson root, which cannot contain the records | each follows the `record-root` pointer to the one record; the staging area and the rendered log stay beside the records, not in the directory that gets pruned; the log names the worktree and carries no stash line; `worktree add` against a worktree, and a pointer naming another worktree, are both refused |
| 3 | a phase `SIGKILL`ed part-way through writing into the worktree, at three phase boundaries, then the worktree directory deleted outright | the user's tree is byte-identical after every crash; the record still holds the base SHA and the worktree, so `worktree add` returns the same worktree with the half-finished build still in it; with the directory gone but the branch recorded, the resume re-creates it on that branch with the commits it already carried |
| 4 | a record from the old flow — a real stash of the user's tree, an update branch, `git.stash_oid` set and no `git.worktree` | `set` refuses all three stash fields while `get` still reads them, and `worktree remove` exits 3 because there is no worktree — which is how recovery tells an old record from a new one |
| 5 | recovery step 2, **finishing** that run where it built: merge its branch in the user's checkout, push, then restore the stash | the merge lands on `main` and is published; the stash applies by its OID, the entry is re-found by that OID to drop it, and the user's uncommitted edit and untracked file are back byte-identical on top of the merge |
| 6 | recovery step 3, **rolling it back** instead: no merge, apply the stash on the branch it was taken from | the user's tree is byte-identical to what it was before the old run stashed it, the stash entry is gone, `main` never moved, the update branch is left in place, and the log renders the stash marked legacy plus the recovery outcome |
| 7 | `worktree remove` against an uncommitted build (`deploy_action: skip`), then against a merge on a detached HEAD, then once a ref keeps it | the first two exit 7 and remove nothing, each saying what it is holding, and the record still calls the worktree live; the third prunes, the merge commit survives, and a second removal is a no-op |
| 8 | the same merge with the user's checkout on a branch of their own, so nothing holds `main` | the compare-and-swap moves `refs/heads/main` to the merge, the user's checkout is still byte-identical, and the same swap with a stale expected value is refused rather than applied blind |
| 9 | a `consolidate` sequence: lesson 1 merged and pushed, then lesson 2 based on lesson 1's merge (`refs/lesson-builder/<prev run_id>/merge`) | lesson 2's worktree opens from that SHA, its merge contains `origin/main` so the pre-push check passes, both merges land, lesson 1's change survives in what lesson 2 published, and the push leaves a ref that lets the worktree prune |
| 10 | the same sequence with lesson 2 left on the frozen Phase 0 tip — the mistake the local base branch invites, since the run never moves it | its merge has the pre-restructure commit as its parent, the pre-push check fails, the push it would have run is refused non-fast-forward, and `origin/main` still holds lesson 1 rather than being overwritten |

Case 1 is the one the brief names: an update run with a dirty tree, byte-identical from Phase 0 to
the end of Phase 5. Cases 4-6 are the other: a lesson left mid-update by the old stash flow is still
finished or rolled back by hand, by the path `references/update-mode.md` § Recovering a run from the
old stash flow documents. Cases 9-10 are `consolidate`, where one lesson merges after another and
the local base branch — which no run moves — is the wrong thing for lesson 2 to build on.

`.lesson-builder/` is left out of the byte comparison in every case — records, staging and the
worktree are the run's own, in the directory the lesson's `.gitignore` covers. That the user never
sees it is asserted directly instead: their `git status` is compared too, and it is unchanged.

The rendered `lesson_build.log.md` is the only other exclusion, named explicitly where case 1
compares. Each workspace copies the real `references/bootstrap/lesson-template/.gitignore`, which
does not cover the log, so the fixture cannot hide it: case 1 asserts it is the one file added and
the one `git status` line gained, and compares every other byte past it.
