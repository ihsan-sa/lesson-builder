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
workspace repo, its own bare origin and its own record under a fresh temp dir. Runs in under ten
seconds from a clean checkout. Exit code 0 only when every check passes. `KEEP=1` keeps the temp
repos and prints the path.

## What `check.cjs` asserts

| | Case | Must hold |
| --- | --- | --- |
| 1 | a whole update run — Phase 0, branch, build, commit, merge, push, prune — against a tree dirtied with an uncommitted edit and an untracked file | every file of the user's working tree hashes the same at the end as at Phase 0, and so do `git status`, HEAD, the branch, the index and the (empty) stash list; the branch is checked out in the worktree and never in their checkout; local `main` is not moved because their checkout holds it, while the merge is published to origin all the same and fast-forwards their `main` when they choose to |
| 2 | `get`, `set`, `current`, `stage` and `render` given the worktree's lesson root, which cannot contain the records | each follows the `record-root` pointer to the one record; the staging area and the rendered log stay beside the records, not in the directory that gets pruned; the log names the worktree and carries no stash line; `worktree add` against a worktree, and a pointer naming another worktree, are both refused |
| 3 | a phase `SIGKILL`ed part-way through writing into the worktree, at three phase boundaries, then the worktree directory deleted outright | the user's tree is byte-identical after every crash; the record still holds the base SHA and the worktree, so `worktree add` returns the same worktree with the half-finished build still in it; with the directory gone but the branch recorded, the resume re-creates it on that branch with the commits it already carried |
| 4 | a record from the old flow — a real stash of the user's tree, an update branch, `git.stash_oid` set and no `git.worktree` | `set` refuses all three stash fields while `get` still reads them; `worktree remove` exits 3 because there is none; the documented recovery applies the stash by its OID, re-finds the entry by that OID to drop it, and returns the user's work byte-identical; the update branch is left in place; the log renders the stash marked legacy and the recovery outcome |
| 5 | `worktree remove` against an uncommitted build (`deploy_action: skip`), then against a merge on a detached HEAD, then once a ref keeps it | the first two exit 7 and remove nothing, each saying what it is holding, and the record still calls the worktree live; the third prunes, the merge commit survives, and a second removal is a no-op |
| 6 | the same merge with the user's checkout on a branch of their own, so nothing holds `main` | the compare-and-swap moves `refs/heads/main` to the merge, the user's checkout is still byte-identical, and the same swap with a stale expected value is refused rather than applied blind |

Case 1 is the one the brief names: an update run with a dirty tree, byte-identical from Phase 0 to
the end of Phase 5. Case 4 is the other: a lesson left mid-update by the old stash flow still
finishes cleanly by hand.

`.lesson-builder/` is left out of the byte comparison in every case — records, staging and the
worktree are the run's own, in the directory the lesson's `.gitignore` covers. That the user never
sees it is asserted directly instead: their `git status` is compared too, and it is unchanged.
