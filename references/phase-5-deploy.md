# Phase 5 — Deploy

Contents: Ordering (branch on deploy_action) · Step 1 build verification · Step 1.5 gitignore-override question · Step 2a new-mode deploy · Step 2b update-mode deploy · Rollback on failure · Hosted deploy · Final report format · Log output.

## Purpose

Phase 5 runs local build verification as a gate, commits, pushes to `main` (directly in new mode, via `--no-ff` merge from the update branch in update mode), logs deploy metadata, and surfaces the final report. Update-mode commits land on `lesson-update/<slug>-YYYYMMDD` and merge only after build verification — all of it inside the run's build worktree, so the user's checkout is not written to at any point. Update mode ends by pruning that worktree; branch + worktree stay untouched on any failure.

## Ordering inside Phase 5

0. **Read deploy intent from the approved plan** (`deploy_action`, `deploy_service`, `deploy_service_kind`). Branch on `deploy_action`:
   - `skip`: run step 1 (build verification, as a sanity check so the user knows whether their lesson builds) and step 3 (worktree cleanup, which under `skip` means reporting the worktree rather than pruning it). Skip step 1.5 (no commit happening), step 2 (commit + push), step 4's deploy-metadata fields, and reduce step 5 to a short "skipped" report. New-mode files remain uncommitted under the lesson root; the update-mode branch and the build worktree remain as Phase 3 left them, the uncommitted build still in it.
   - `commit-only`: run steps 1, 1.5, 2 (commit, no push), 3, 4, 5.
   - `push-to-github`: run the full pipeline unchanged (steps 1, 1.5, 2, 3, 4, 5).
   - `push-to-custom`: same as `push-to-github` but step 2's push targets the remote/service recorded in `deploy_service` according to `deploy_service_kind` (see step 2).
1. Local build verification (hard gate — halt the phase on failure; runs under every `deploy_action` including `skip` as a lesson-works sanity check)
1.5 Materials-in-commit question (conditional — only when `provided_materials` is non-empty AND `deploy_action ∈ {"push-to-github", "push-to-custom", "commit-only"}`; captures `include_materials_in_commit: true | false | "custom:<list>"`)
2. Mode-branched commit + push (new mode: direct to main; update mode: branch commit → merge → push; entirely skipped when `deploy_action == "skip"`)
3. Worktree cleanup (update mode only — runs under every `deploy_action`, and prunes only a worktree whose work is committed and kept by a ref)
4. Log append
5. Final report to user

Build verification failure halts steps 1.5 and 2 regardless of `deploy_action` — if the lesson doesn't build, committing or pushing is unsafe. Under `skip`, a build failure still halts so the user knows the lesson is broken; the final report surfaces the error. Step 3 always runs in update mode — even after a build failure — and after one it reports the worktree path rather than pruning it, because the build in there is the thing the user needs to look at.

## Step 1 — Local build verification (gate)

Runs first and gates everything else. Uses the existing project build pipeline plus a headless browser smoke check.

### Commands

```bash
cd <workspace_root> && bash build-all.sh
```

The workspace's `build-all.sh` runs `npm install` + `npx vite build --base="/<course>/<slug>/"` per lesson and copies each per-lesson `dist/` into the root `dist/<course>/<slug>/`. Full-workspace rebuild time scales with lesson count (typically a few minutes; local times vary).

**New-mode ordering**: `build-all.sh` builds only lessons registered in its inventory — a brand-new lesson isn't there yet, so the Step 2a.1 build-config edit (registering the lesson) happens BEFORE this verification, not after. Then confirm the target output exists at the path build-all actually writes:

```
<workspace_root>/dist/<deploy_code>/<slug>/index.html
```

where `<deploy_code>` is the lesson's URL code from the `build-all.sh` inventory entry (often lowercase, e.g. `math101`) — read it from the inventory rather than assuming it equals the `<course>` directory name's casing. A successful build "missing" at the guessed path is almost always this mismatch.

### Headless browser smoke check

After `build-all.sh` exits 0 and the target `index.html` is present, launch a headless Playwright check against the built output, served from a small local static server rooted at `<workspace_root>/dist/` on an ephemeral port: `http://localhost:<port>/<deploy_code>/<slug>/`. Never load via `file://` — the build's absolute `base` path makes assets resolve against the filesystem root, so a valid deploy renders blank and falsely halts.

Prefer `@playwright/mcp` if it is available. Otherwise fall back to a Node script using the `playwright` npm package directly.

### Checks the smoke test must perform

- KaTeX renders (no raw `\\frac` / `$$` visible in DOM; `.katex` nodes present).
- All lesson tabs are clickable and switching tabs does not throw.
- Every graph component renders without error in the topic that hosts it.
- Browser console has zero errors (warnings allowed).

### Failure mode

Any failure (`build-all.sh` non-zero, missing `index.html`, smoke-check fail) halts Phase 5 **before** any `git add/commit/merge`. Log the specific error (stderr, stack trace, console). Surface to the user. Update mode: branch and worktree stay untouched, and the user's checkout was never written to in the first place.

### Update mode note

The gate runs inside the build worktree, against the update branch (`lesson-update/<slug>-YYYYMMDD`), not `main`, and not in the user's checkout. Do not switch any branch to build.

**The worktree has no `node_modules/`.** It is a checkout of the base SHA and `node_modules/` is gitignored, so a plain `bash build-all.sh` in there is a cold `npm install` of *every* lesson in the workspace — minutes off the network, and a hard failure with no network at all. So the update-mode gate is the **scoped build** `references/phase-4-review.md` already permits, warmed from the user's checkout:

```bash
LR=<the user's lesson root>                      # the checkout the user works in
WT=$(run-manifest.cjs get --lesson "$LR" git.worktree)
WS=$(git -C "$WT" rev-parse --show-toplevel)     # the worktree's own workspace root

# Copy, never symlink: a symlink would let `npm install` write into the user's checkout, which is
# the one thing this run must not do. With the copy in place the install is a no-op and the gate
# runs offline; without one it falls back to installing, which needs the network.
[ -d "$LR/node_modules" ] && [ ! -e "$WT/node_modules" ] && cp -r "$LR/node_modules" "$WT/node_modules"

cd "$WT" && npm install && npx vite build --base="/<deploy_code>/<slug>/"
mkdir -p "$WS/dist/<deploy_code>/<slug>" && cp -r "$WT/dist/." "$WS/dist/<deploy_code>/<slug>/"
```

That reproduces exactly what `build-all.sh` would have written for this lesson, so the target path and the smoke check below are unchanged — served from `$WS/dist/`, the worktree's `dist/`, not the user's.

**When the full build is still required**: if this run edited `_lesson-core/`, `build-all.sh` or a deploy config, a scoped build cannot catch what that breaks in other lessons. Run `cd "$WS" && bash build-all.sh` instead, accept the cold install, and log `Build verification: PASS (build-all.sh, full — core touched)` so the report says why it took minutes.

**Naming, for every update-mode step below.** In a **git** or **build** command, `<workspace_root>` means `$WS` and `<lesson_root>` means `$WT`. `run-manifest.cjs` is not addressed that way: it follows the `record-root` pointer, so `get`, `set`, `append`, `stage` and `render` accept either root — but `worktree add` and `worktree remove` act *on* the worktree and take **only** the user's lesson root, `$LR`. Given `$WT` they refuse (exit 1): a worktree does not remove itself.

## Step 1.5 — Gitignore-override question (conditional)

**Deploy-safety is the baseline, not an opt-in.** Phase 3 wrote `<lesson_root>/.gitignore` with defaults covering `materials/`, `source/`, `notes/`, `*.local`, `.env*`, `.build-scratch/`, and any loose `provided_materials` paths. A plain `git add` cannot stage these files. This step exists so the user can **override the gitignore** for a specific commit when they deliberately want a private path published — not to decide whether to include materials (that decision was already made in favor of exclusion).

Skip this step when any of the following hold:

- `deploy_action == "skip"` (no commit, so nothing to stage).
- `<lesson_root>/materials/`, `<lesson_root>/source/`, and `<lesson_root>/notes/` are all empty or absent AND `provided_materials` is empty. Nothing gitignored worth overriding.

Before firing the question, compile two awareness lists. These surface prior-state risk, not block the decision:

- **Already-tracked private paths** — run `git ls-files -- <candidate gitignored paths>`. Any file committed in a prior run (before the gitignore was added, or under a prior override) is still in history and still public if the repo is public. Display with a one-line warning: "These files are already in git history. A 'no override' answer here does NOT unpublish them — use `git filter-repo` or equivalent if removal is required, or `git rm --cached <path>` to drop them from the next commit while keeping the working copy."
- **Out-of-scope materials** — paths in `provided_materials` that live outside `<lesson_root>/`. These can't be staged directly regardless of gitignore; surface count + paths so the user knows.

Then fire a single `AskUserQuestion` (interactive sessions only — see the default rule below):

> "The lesson's `.gitignore` currently excludes these private paths from commits by default:
>
> - `<path1>` — `<size>`
> - `<path2>` — `<size>`
> - ... (up to ~10 shown; full list in the log)
>
> Total: `<N>` files, `<total size>`. Override the gitignore for this commit?
>
> Already tracked (override does not unpublish): `<list, or "none">`.
> Out-of-scope (can't be staged): `<count>`."

Options (default is the first):

- `Keep the default — do not override (recommended; protects against accidental publish of copyright or private material)`
- `Override for everything listed above (force-stage all gitignored private paths this commit; the gitignore entries stay in place so the next run is protected again)`
- `Override for specific files — let me pick` (follow up with a multi-select `AskUserQuestion` listing each gitignored candidate; selected files are force-staged via `git add -f`)

Record the answer as `gitignore_override: "none" | "all" | "custom:<explicit file list>"`. Back-compat: also record `include_materials_in_commit: false | true | "custom:<list>"` for log consistency (legacy field; same information, different framing). Log `Gitignore override: <verdict>` under the Phase 5 log section so the per-lesson log preserves exactly what private material was published.

**Invariant — the gitignore itself is never relaxed.** Override uses `git add -f` on specific files. It does not edit `<lesson_root>/.gitignore`. Future Phase 5 runs re-ask the question from the same private-by-default baseline. If the user wants a path permanently public, they edit `.gitignore` themselves — the skill will not do that for them, because "permanently public" is not reversible for copyright material.

**Why ask here and not at Phase 0 / Phase 2**: at Phase 0 the user hasn't seen the actual file list (they just gave us a folder or a link); by Phase 5 the gitignore is in place and we can show concrete paths, sizes, and history state. Asking with real data prevents surprise-publishes. The Phase 2 plan records `Course materials in commit: asked at Phase 5` rather than forcing an early answer.

**Default selection rule when `session_mode` is not `interactive`** (`SKILL.md` § Session modes and gates): this gate has a safe default, so it does not block. Take `none` — no override, everything stays gitignored — state the choice and the list it applied to in the final report, and carry on. In a `channel` session the same message may offer the override for a later run; it does not wait for the answer. Never auto-override without an explicit user answer, because anything gitignored is gitignored for a reason and auto-publishing is irreversible.

Course-inbox files (`origin: "course-inbox"`, under `<course>/materials/`) are never candidates here: they live outside `<lesson_root>`, so they appear in the *out-of-scope materials* awareness list. Their tracked-or-ignored status is a workspace `.gitignore` question the user owns (`references/course-curation.md` §3).

## Step 2a — New-mode deploy

### 1. Update build config (if required)

If the new lesson needs a build configuration change (new course directory pattern, new asset rule), update the workspace's `build-all.sh` or host-specific deploy config (e.g. `netlify.toml`, `vercel.json`, CI workflow) first. Most new lessons in existing courses need no build changes.

### 2. Draft commit message

Format is a one-line subject, blank line, bulleted body.

Subject template:

```
<slug>: new lesson — <topic theme>
```

Body should cover:

- Course code and slug
- Topic list (from Phase 2 Lesson Plan)
- Medium mix (count of graphs, manim videos, interactive demos, images)
- Any build config changes

Example body:

```
- Course: <course display code>
- Topics: topic-a, topic-b, topic-c, topic-d, topic-e
- Media: 6 graphs, 2 manim videos, 1 interactive demo, 3 images
- No build-all.sh changes required
```

### 3. Stage files

Stage only the specific paths touched by the new lesson. Do **not** use `git add -A` or `git add .`.

```bash
git add <lesson_root>/src/<slug_snake>.jsx
git add <lesson_root>/package.json
git add <lesson_root>/vite.config.js
git add <lesson_root>/index.html
git add <lesson_root>/src/main.jsx
git add <lesson_root>/server/proxy.js
git add <lesson_root>/test_lesson.cjs
git add <lesson_root>/CLAUDE.md
git add <lesson_root>/public/
git add <lesson_root>/*.py          # manim scene sources (paired with public/videos/*.mp4)
git add <lesson_root>/figures/      # matplotlib reference-image sources (if present)
```

The `.py` sources ride along deliberately: without them a clean clone cannot refine the committed animations or reference figures — the mp4/png alone is a dead end.

If the workspace `build-all.sh` or any deploy config (e.g. `netlify.toml`, `vercel.json`, CI workflow) was modified:

```bash
git add <workspace_root>/build-all.sh
git add <workspace_root>/<deploy-config-file>
```

Always stage the lesson's `.gitignore` alongside the code so the privacy baseline persists in the repo:

```bash
git add <lesson_root>/.gitignore
```

**Gitignore override staging** (conditional on Step 1.5's `gitignore_override`):

- `"none"` (default): do nothing extra. Every private path the `.gitignore` covers stays out of the commit. `git add <lesson_root>/materials/` would silently no-op anyway; the gitignore does the work. If any of those files were already tracked from a pre-gitignore commit, they remain tracked (the current run does not `rm --cached` them automatically — that's destructive and belongs in a separate user-initiated cleanup).
- `"all"`: force-stage every candidate from Step 1.5 using `git add -f`:
  ```bash
  git add -f <lesson_root>/materials/    # if present
  git add -f <lesson_root>/source/       # if present
  git add -f <lesson_root>/notes/        # if present
  git add -f <each in-lesson provided_materials path>
  ```
- `"custom:<file list>"`: force-stage exactly the files the user selected:
  ```bash
  git add -f <path-1>
  git add -f <path-2>
  ...
  ```

`-f` is required because the files are gitignored; without it git silently no-ops. The gitignore entries themselves are never edited here — overrides are per-commit, not structural.

Never shell-expand `provided_materials` paths that resolve outside `<lesson_root>/` — those were already flagged in Step 1.5 as out-of-scope. If the user wanted them in the repo, they should copy them into the lesson root and rerun (the new copy will be gitignored by default and the user can override it then if intended).

### 4. Commit

Honor pre-commit hooks. No `--no-verify`. Use a HEREDOC so the body is preserved.

```bash
git commit -m "$(cat <<'EOF'
<slug>: new lesson — <topic theme>

- Course: <code>
- Topics: <list>
- Media: <mix>
EOF
)"
```

If a pre-commit hook fails, the commit did not happen. Fix the underlying issue, re-stage, and create a **new** commit. Do not `--amend` — the previous commit on `main` is not yours and amending would destroy history.

### 5. Push (conditional on `deploy_action` + `deploy_service_kind`)

- `push-to-github`:
  ```bash
  git push origin main
  ```
- `push-to-custom` with `deploy_service_kind == "git-remote"`: ensure the remote exists AND points at the recorded URL — a pre-existing `custom-deploy` remote from an earlier run may target a different repo, and pushing there is publishing to the wrong place:
  ```bash
  git remote get-url custom-deploy 2>/dev/null   # compare to <deploy_service>
  # absent → git remote add custom-deploy <deploy_service>
  # mismatched → git remote set-url custom-deploy <deploy_service>
  git push custom-deploy main
  ```
  Non-zero exit from `git push` is a failure; log and surface stderr.
- `push-to-custom` with `deploy_service_kind == "cli"`: run `deploy_service` as a shell command from `<workspace_root>` after the commit. Surface stdout/stderr back to the user; non-zero exit is a failure for reporting purposes but does not roll back the commit (the user can inspect, fix, and re-run the CLI manually). No remote is added.
- `commit-only`: skip the push. Log `Push: skipped (deploy_action=commit-only)` and continue to step 6.
- `skip` never reaches this step — Step 0 diverted the flow.

### 6. Log deploy metadata

After the push completes, capture:

- Final commit SHA: `git rev-parse HEAD`
- Deploy dashboard URL (host-specific — ask the user or look it up in the workspace's deploy config)
- Expected live URL (host-specific — typically something like `https://<site-root>/<course>/<slug>/`)

Record these — the commit SHA as `git.commit_sha`, the rest as `phases.5.notes` — then `run-manifest.cjs render --lesson <lesson_root>`, which writes them under `## Phase 5 — Deploy`.

### 7. Surface final report

See "Final report format" below.

## Step 2b — Update-mode deploy

### 1. Verify the worktree and its branch

Before anything else, read the run's own paths and names out of the record and confirm the worktree is on the branch it should be. Never reconstruct the branch name from slug + date, and never read it out of the log:

```bash
LR=<the user's lesson root>                                         # the root Phase 0 was given —
                                                                    # the record, the staging area
                                                                    # and the log all live under it
WT=$(run-manifest.cjs get --lesson "$LR" git.worktree)              # exit 3 → no worktree: this is
                                                                    # a record from the old stash
                                                                    # flow, see the recovery path
BR=$(run-manifest.cjs get --lesson "$LR" git.branch)                # incl. any collision suffix
BASE=$(run-manifest.cjs get --lesson "$LR" git.base_branch)
git -C "$WT" rev-parse --abbrev-ref HEAD                            # must equal "$BR"
```

If the branch differs from the recorded value, halt the phase immediately — Phase 3 did not create it, or something switched it. Surface the actual branch name and the recorded one. If `git.worktree` is unset, this run predates the worktree flow: recover it by the path in `references/update-mode.md` § Recovering a run from the old stash flow rather than improvising here. All later merge and render steps consume the same recorded values.

Every git command in this step runs with `-C "$WT"` (or from the worktree root), and every `run-manifest.cjs` call with `--lesson "$LR"`. The user's checkout is read for its path and its `node_modules`, and is not switched and not written to.

### 2. Draft commit message

Subject format:

```
<slug>: update — <short summary>
```

Body is a bulleted change-list pulled from the Phase 2 log (`### Phase 2 — Plan (update)` → change-list view). Each bullet should cover one logical change: topic modified, medium refined, medium replaced, drift repair, etc.

Example:

```
<slug>: update — rework <ComponentName> graph

- Refine: <ComponentName> y-axis scale (user concern)
- Refresh: GRAPH_SCHEMA backfill for drift repair
- Content: minor explanation tightening on <concept>
```

### 3. Stage files

Only stage files actually touched by the update. Typical set:

```bash
git -C "$WT" add src/<slug>.jsx
git -C "$WT" add public/<refreshed-asset>
```

Additional paths if the update touched manim videos or interactive demos:

```bash
git -C "$WT" add <name>.py
git -C "$WT" add public/videos/<name>.mp4
```

Manim source scripts (`.py`) live at the lesson root, not in a `src/manim/` subdirectory. The inventory pre-scan in Phase 1 Globs `<lesson_root>/*.py` to find them.

Do not stage `lesson_build.log.md` or `.lesson-builder/` unless the user explicitly requested tracking them in git (by default the rendered log and the run records it comes from both stay untracked). In the worktree the only thing under `.lesson-builder/` is the pointer back to the record, and the lesson's `.gitignore` already covers it.

Stage everything the update wrote. Whatever is left uncommitted keeps the worktree from being pruned at step 3 — by design, so no build is deleted — and the phase will report the path instead.

Always stage the lesson's `.gitignore` so any newly appended entries (e.g., for freshly attached materials) persist in the repo:

```bash
git -C "$WT" add .gitignore
```

**Gitignore override staging** (same semantics as new mode Step 2a.3):

- `"none"` (default): no additional staging. Gitignored private paths stay out.
- `"all"`: force-stage every candidate from Step 1.5 with `git add -f`.
- `"custom:<file list>"`: force-stage only the user-selected paths with `git add -f`.

If the update run wrote a new materials file and the user kept the default (no override), the file stays on disk and gitignored. Log it under `Gitignored and on disk, not staged: <path>` so the user knows it exists but isn't published.

### 4. Commit to branch

```bash
git -C "$WT" commit -m "$(cat <<'EOF'
<slug>: update — <short summary>

- <change 1>
- <change 2>
- <change 3>
EOF
)"
```

This commit lands on `lesson-update/<slug>-YYYYMMDD` in the worktree, not `main`. Pre-commit hooks still apply; same rules as new mode (no `--no-verify`, no `--amend`, re-stage and create a new commit on hook failure).

### 5. Merge to main (conditional on `deploy_action`)

- `push-to-github` or `push-to-custom`: merge in the worktree, on a detached HEAD, so no branch anyone has checked out moves.
  ```bash
  SHA=$(run-manifest.cjs get --lesson "$LR" git.base_sha)
  git -C "$WT" checkout --detach "$SHA"   # the commit this run built from — NOT "$BASE", whose
                                          # local ref the run never moves and which is stale by
                                          # lesson 2 of a `consolidate`
  git -C "$WT" merge --no-ff "$BR"
  MERGE=$(git -C "$WT" rev-parse HEAD)
  RUN=$(run-manifest.cjs current --lesson "$LR")
  git -C "$WT" update-ref "refs/lesson-builder/$RUN/merge" "$MERGE"
  ```
  `--no-ff` forces a merge commit even when fast-forward is possible, preserving the update as a visible unit in history. The `refs/lesson-builder/<run_id>/merge` ref is what keeps that commit reachable once the worktree is pruned at step 3 — a detached HEAD is not a ref, and an unreferenced merge commit is a commit git is free to collect.

  Then move `refs/heads/<base>` **only if no working tree has it checked out**:

  ```bash
  git -C "$WT" worktree list --porcelain | grep -qx "branch refs/heads/$BASE" \
    || git -C "$WT" update-ref "refs/heads/$BASE" "$MERGE" "$(git -C "$WT" rev-parse "$MERGE^1")"
  ```

  The compare-and-swap old value is the merge's own first parent — the base SHA this run built from — so the update is refused rather than applied blind if the local branch is somewhere else. A refusal is an outcome, not an error: the push below publishes the merge either way, and the report gives the user the fast-forward.

  When a working tree does hold it, which is the normal case because that working tree is the user's, leave the ref exactly where it is. Git refuses to push or fetch into a branch a working tree has checked out for the reason that applies here: moving the ref under a checkout leaves its index and its files describing a commit its `HEAD` no longer names, which reads as a staged revert of the entire update. The push below still publishes the merge, and step 5 of the report gives the user the one command that fast-forwards their own checkout when they are ready:

  ```
  git -C <workspace_root> merge --ff-only <MERGE>
  ```

  Record which of the two happened as a note, so the log says whether the local branch moved:

  ```bash
  run-manifest.cjs append --lesson "$LR" phases.5.notes \
    '"Base branch main: not moved (the user'"'"'s checkout holds it) — fast-forward with git merge --ff-only <MERGE>"'
  ```
- `commit-only`: skip the merge. The commit stays on the update branch; the base branch is not touched. Log `Merge: skipped (deploy_action=commit-only) — branch: lesson-update/<slug>-YYYYMMDD` so the user can merge manually later.

On conflict (should not happen from a clean branch): halt, surface conflict files, do not auto-resolve. The user resolves manually. Branch and worktree stay intact, and the user's checkout — which the merge never went near — is untouched.

### 6. Push (conditional on `deploy_action`)

**Before any push, check the merge contains what the remote already has.** This run's base SHA was
read at Phase 0 and the run never moves the local `refs/heads/<base>`, so a remote that moved since
— most often the previous lesson of a `consolidate` run, which just pushed its own merge — would
refuse this one non-fast-forward, mid-sequence:

```bash
git -C "$WT" fetch -q origin "$BASE" || true          # no origin: nothing to be behind, skip
git -C "$WT" merge-base --is-ancestor "origin/$BASE" "$MERGE" \
  || halt   # origin/$BASE has commits this merge does not contain
```

On the halt: nothing is pushed, the branch and the worktree stay as they are, and the report says
the base moved under the run. A `consolidate` run reaching this halt means lesson 2..n was based on
the Phase 0 tip instead of the previous lesson's merge — `references/course-curation.md` § Phase
shape has the rebase point.

- `push-to-github`:
  ```bash
  git -C "$WT" push origin "$MERGE:$BASE"
  ```
  Pushing the merge SHA by name rather than pushing a local branch is what makes the push identical whether or not `refs/heads/<base>` moved above.
- `push-to-custom`: branch on `deploy_service_kind` — `"git-remote"` uses `git -C "$WT" push custom-deploy "$MERGE:$BASE"` (after `git remote add` if needed); `"cli"` runs `deploy_service` from the worktree root. Same rules as new-mode Step 2a.5.
- `commit-only`: skip. Log `Push: skipped (deploy_action=commit-only)`.

### 7. Worktree cleanup

The build worktree has done its job once the merge is made and pushed. Prune it:

```bash
run-manifest.cjs worktree remove --lesson "$LR"   # the user's lesson root, never $WT: a worktree
                                                  # does not remove itself, and the command refuses
```

There is no user gate here and nothing to prompt for — nothing of the user's is in that directory,
because nothing of the user's was ever put there. The command is its own guard: it **refuses**
(exit 7, nothing removed) while the worktree holds uncommitted changes, or sits on a commit no ref
keeps. That is the rollback invariant expressed once, in code, so every path through this phase gets
it:

- **`deploy_action: skip`** — nothing was committed, so the build is uncommitted in there and the
  removal is refused. Expected. Report the path; the user keeps or discards the build themselves.
- **After a build-verify or Phase 4 failure** — the same refusal for the same reason, and the same
  report. The run's work stays on disk to inspect or finish by hand.
- **`commit-only`** — the commit is on the update branch, which keeps it, so the worktree prunes
  cleanly and the branch is what the user merges later.
- **After a merge and push** — the merge is kept by `refs/lesson-builder/<run_id>/merge` and its
  parent by the branch, so it prunes cleanly.

Record the outcome as a note when the removal was refused, with the path, so the final report and
the log both name it:

```bash
run-manifest.cjs append --lesson "$LR" phases.5.notes \
  '"Build worktree kept at <path> — it holds work no commit does"'
```

`git.worktree_state` goes to `removed` on a successful prune and stays `live` otherwise;
`worktree remove` writes it, nothing else does.

### 8. Log deploy metadata

Record as above and render; the fields land under `### Phase 5 — Deploy (update)`, nested under this run's `## Update YYYY-MM-DD (run-id: <run_id>)` section:

- `Update branch: lesson-update/<slug>-YYYYMMDD`
- `Merge commit SHA: <sha>` (`$MERGE` from step 5, recorded as `git.commit_sha`)
- `Worktree: <path> (live | removed)`
- `Base branch: moved | not moved (the user's checkout holds it)`
- `Deploy dashboard URL: <host-specific>`

### 9. Surface final report

See "Final report format" below. Include regression-watch entries from Phase 4 in addition to the standard unresolved list.

## Step 3 — Course-map write-back (conditional)

Runs in both modes, only when `course_root` is set (i.e. `<workspace_root>/<course>/COURSE.md` exists), only after the deploy step succeeded, and only over the two mechanical fields the pipeline owns (`references/course-curation.md` §8):

1. **The lesson map row** for each lesson this run built or updated — status (`live`, or `needs-update` when the run merged with a known open finding from Phase 4), topic count, and the run-id.
2. **The pending chunks and materials-index rows this run consumed** — `status: pending` → `status: built (<run-id>)`, and the materials index's "consumed by" column.

Everything else in `COURSE.md` is the user's text: outline, conventions, open questions, and unconsumed chunks are read, never rewritten. If `COURSE.md` does not exist, this step does nothing — the pipeline never creates one, because it would be guessing at the course's outline.

Whether the edit is committed follows the run's own `deploy_action`: under `push-to-github` / `push-to-custom` / `commit-only` it rides in the same commit (it is a tracked workspace file outside `<lesson_root>`, so stage it explicitly); under `skip` it stays in the working tree. `consolidate` runs write back once per lesson as that lesson completes, so a partially-completed restructure leaves a map that matches what actually shipped. Log `Course map: updated (<slug> -> live, N chunks marked built)` or `Course map: N/A (no COURSE.md)`.

## Rollback on failure (update mode)

Three failure points in Phase 5 trigger the same behavior: **do not merge, preserve branch, preserve worktree**. The user's own checkout needs no preserving: no phase of the run wrote to it.

1. **Phase 4 halted for a fundamental flaw**: Phase 5 still runs build verification (to confirm the current state builds), but even on pass, the skill does not merge if Phase 4 raised a fundamental-flaw halt. The update branch stays in place; the build worktree stays in place; the final report surfaces the branch name and the worktree path plus Phase 4's diagnosis so the user can iterate manually.
2. **Phase 5 build verification fails**: same behavior. The `build-all.sh` or smoke check failure is logged with specific error output. No commit, no merge, no push. Branch and worktree untouched.
3. **`git merge --no-ff` produces conflicts**: should not happen on a branch taken from the base SHA, but defensive. Halt, surface conflict files, do not attempt auto-resolve. The conflict is on the worktree's own detached HEAD, so the next step is `git -C <worktree> merge --abort` (or resolve it there), then rerun Phase 5 or hand-merge. The user's checkout is not in the conflicted state and never was.

In all three cases:

- The update branch is **never** force-deleted by the skill.
- A worktree holding work is **never** removed by the skill — `worktree remove` refuses, and the phase reports the path.
- The user decides whether to keep the branch or `git branch -D lesson-update/<slug>-YYYYMMDD` manually after recovery.
- The final report lists the branch name and the worktree path explicitly so recovery commands are visible.

## Hosted deploy

Hosting target (Netlify, Vercel, GitHub Pages, Cloudflare Pages, custom CI) is determined by workspace config, not this skill. Typical pattern: push to `main` → host auto-rebuilds. Follow the workspace's `CLAUDE.md` or deploy docs for other triggers.

Skill responsibility stops at `git push`:

- Do not wait for hosted build completion.
- Log the deploy dashboard URL when known.
- Deploy-state MCP/API queries are optional, not required.

### Chatbot in prod

The chat panel is **PROD-gated out of static builds** — production bundles exclude it entirely, so hosted lessons ship without a chat panel rather than with a disabled one. Static hosts cannot run the Express proxy anyway; users run the chatbot locally via `node server/proxy.js` + `npx vite`. The final report should not flag the missing chat panel as an issue — it is the designed behavior. On Node-capable hosts the gate can be lifted.

## Final report format

The final report is surfaced to the user as the last action of Phase 5 (after all logging). Structure:

```
# Lesson Build Complete — <course> / <slug>

## What shipped
- Mode: new | update
- Lesson: <course> / <slug>
- Deploy action: push-to-github | push-to-custom | commit-only | skip
- Deploy service: <remote or CLI, or "GitHub → workspace-configured host">
- Gitignore override: none (all private paths kept out) | all forced | custom subset | N/A (nothing gitignored to override)
- Materials in commit: excluded (default — gitignored) | forced via override | custom subset | N/A (no materials)
- Commit SHA: <sha>            (update mode: merge commit SHA; "skipped" for deploy_action=skip)
- Update branch: <name>        (update mode only)
- Deploy dashboard: <host-specific URL or "see workspace deploy docs">
- Live URL (after hosted build finishes): <host-specific URL>
- Course map: updated (<slug> -> live, N chunks marked built) | N/A (no COURSE.md)

## Unresolved items from Phase 4
- <item 1 with reason>
- <item 2 with reason>

## Regression watch            (update mode only, if any)
- <item with originally-clean medium that regressed>

## Orphan asset cleanup        (update mode only, if orphans were present)
- Removed: <N> file(s) — <path1>, <path2>, ...
- Kept:    <K> file(s) — <path3>, <path4>, ...
- Blocked: <B> file(s) — <path + error> (if any)

## Suggested follow-ups
- <actionable next step 1>
- <actionable next step 2>

## Your working tree           (update mode only)
- Untouched from start to finish — the run built in <worktree path>, never in your checkout.
- Local <base branch>: moved | not moved (your checkout has it) — fast-forward with `git merge --ff-only <merge sha>`
- Build worktree: removed | kept at <path> (it holds work no commit does)
```

If there are no unresolved items, regression-watch entries, suggested follow-ups, or orphan cleanup actions, the section heading is kept with "none" as the body so the user sees the absence explicitly. The orphan cleanup section is omitted entirely only when the Phase 1 inventory reported zero orphans (nothing to surface).

## Log output

The log doc lives at `<lesson_root>/lesson_build.log.md` and is rendered from the run records beside it (`references/run-record.md`).

### New mode

Record these, then `render` — the deploy triple as `scoping.deploy_action` / `scoping.deploy_service_kind` / `scoping.deploy_service` (re-set here if the executed action differed from the Phase 0 answer; the next update reads them back from this record), the commit as `git.commit_sha`, everything else as `phases.5.notes` entries in this order. The rendered section reads:

```
## Phase 5 — Deploy
Deploy action: push-to-github | push-to-custom | commit-only | skip     # scoping.deploy_action
Deploy service kind: git-remote | cli | null                            # scoping.deploy_service_kind
Deploy service: <remote URL / CLI / null>                               # scoping.deploy_service
Commit SHA: <sha>                                                       # git.commit_sha
Build verification: PASS                                                # phases.5.notes, in this order
Target: dist/<course>/<slug>/index.html
Smoke check: KaTeX OK, topics OK, graphs OK, console clean
Gitignore override: none | all | "custom:<list>" | N/A
Materials in commit: false (gitignored) | true (forced via override) | "custom:<list>" | N/A
Push result: ok (origin main) | ok (<custom-remote>) | skipped
Base branch: moved | not moved (the user's checkout holds it) — ff with git merge --ff-only <sha>
Build worktree: removed | kept at <path> (it holds work no commit does)
Deploy dashboard URL: <host-specific>
Live URL: <host-specific>

## Final Report to User
<the record's open findings — the renderer derives this list; nothing retypes it>
```

The four commented fields render in that fixed order ahead of the notes; the notes render in the order they were appended, so append them as listed.

When `deploy_action == "skip"`, record `scoping.deploy_action` as `skip` and a single `phases.5.notes` entry `Halted: no build or commit (user requested skip)` in place of the other fields; the final report still renders from the open findings.

### Update mode

Same commands; `render` nests the section under this run's `## Update YYYY-MM-DD (run-id: <run_id>)` heading as `### Phase 5 — Deploy (update)`:

```
### Phase 5 — Deploy (update)
Deploy action: push-to-github | push-to-custom | commit-only | skip     # scoping.deploy_action
Deploy service kind: git-remote | cli | null                            # scoping.deploy_service_kind
Deploy service: <remote URL / CLI / null>                               # scoping.deploy_service
Commit SHA: <merge sha | branch sha when the merge was skipped>         # git.commit_sha
Build verification: PASS                                                # phases.5.notes, in this order
Target: dist/<course>/<slug>/index.html
Smoke check: KaTeX OK, topics OK, graphs OK, console clean
Gitignore override: none | all | "custom:<list>" | N/A
Materials in commit: false (gitignored) | true (forced via override) | "custom:<list>" | N/A
Branch commit SHA: <sha>
Merge commit SHA: <sha | skipped>
Push result: ok (origin main) | ok (<custom-remote>) | skipped
Deploy dashboard URL: <host-specific>
Live URL: <host-specific>

### Final Report
<the record's open findings + regression watch>
```

The last two lines are the step-5 and step-7 notes. The update branch and the worktree **path** are not repeated as record fields here — they render once, under Phase 3, from `git.branch` and `git.worktree`; a record from the old flow renders its stash there too, marked legacy.

On build-verification failure, record `Build verification: FAIL`, `Halted: yes` and the error excerpt as `phases.5.notes` entries, and re-render. No commit/merge/push fields are recorded because those steps did not run.
