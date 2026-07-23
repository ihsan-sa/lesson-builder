# Phase 5 — Deploy

Contents: Ordering (branch on deploy_action) · Step 1 build verification · Step 1.5 gitignore-override question · Step 2a new-mode deploy · Step 2b update-mode deploy · Rollback on failure · Hosted deploy · Final report format · Log output.

## Purpose

Phase 5 runs local build verification as a gate, commits, pushes to `main` (directly in new mode, via `--no-ff` merge from the update branch in update mode), logs deploy metadata, and surfaces the final report. Update-mode commits land on `lesson-update/<slug>-YYYYMMDD` and merge only after build verification. Update mode also handles stash recovery; branch + stash stay untouched on any failure.

## Ordering inside Phase 5

0. **Read deploy intent from the approved plan** (`deploy_action`, `deploy_service`, `deploy_service_kind`). Branch on `deploy_action`:
   - `skip`: run step 1 (build verification, as a sanity check so the user knows whether their lesson builds) and step 3 (stash recovery, because the stash is user data that predates this run — not a deploy step). Skip step 1.5 (no commit happening), step 2 (commit + push), step 4's deploy-metadata fields, and reduce step 5 to a short "skipped" report. New-mode files remain uncommitted under the lesson root; update-mode branch + stash remain as Phase 3 left them (minus any popped stash).
   - `commit-only`: run steps 1, 1.5, 2 (commit, no push), 3, 4, 5.
   - `push-to-github`: run the full pipeline unchanged (steps 1, 1.5, 2, 3, 4, 5).
   - `push-to-custom`: same as `push-to-github` but step 2's push targets the remote/service recorded in `deploy_service` according to `deploy_service_kind` (see step 2).
1. Local build verification (hard gate — halt the phase on failure; runs under every `deploy_action` including `skip` as a lesson-works sanity check)
1.5 Materials-in-commit question (conditional — only when `provided_materials` is non-empty AND `deploy_action ∈ {"push-to-github", "push-to-custom", "commit-only"}`; captures `include_materials_in_commit: true | false | "custom:<list>"`)
2. Mode-branched commit + push (new mode: direct to main; update mode: branch commit → merge → push; entirely skipped when `deploy_action == "skip"`)
3. Stash recovery prompt (update mode only, if Phase 3 stashed — runs under every `deploy_action` because the stash is user data, not a deploy artifact)
4. Log append
5. Final report to user

Build verification failure halts steps 1.5 and 2 regardless of `deploy_action` — if the lesson doesn't build, committing or pushing is unsafe. Under `skip`, a build failure still halts so the user knows the lesson is broken; the final report surfaces the error. Step 3 (stash recovery) always runs in update mode — even after a build failure — so the user's uncommitted work doesn't get stranded.

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
- The graph preview tab renders every graph component without error.
- Browser console has zero errors (warnings allowed).

### Failure mode

Any failure (`build-all.sh` non-zero, missing `index.html`, smoke-check fail) halts Phase 5 **before** any `git add/commit/merge`. Log the specific error (stderr, stack trace, console). Surface to the user. Update mode: branch and stash stay untouched.

### Update mode note

`build-all.sh` runs against the update branch (`lesson-update/<slug>-YYYYMMDD`), not `main`. Do not switch to `main` for the build.

## Step 1.5 — Gitignore-override question (conditional)

**Deploy-safety is the baseline, not an opt-in.** Phase 3 wrote `<lesson_root>/.gitignore` with defaults covering `materials/`, `source/`, `notes/`, `*.local`, `.env*`, `.build-scratch/`, and any loose `provided_materials` paths. A plain `git add` cannot stage these files. This step exists so the user can **override the gitignore** for a specific commit when they deliberately want a private path published — not to decide whether to include materials (that decision was already made in favor of exclusion).

Skip this step when any of the following hold:

- `deploy_action == "skip"` (no commit, so nothing to stage).
- `<lesson_root>/materials/`, `<lesson_root>/source/`, and `<lesson_root>/notes/` are all empty or absent AND `provided_materials` is empty. Nothing gitignored worth overriding.

Before firing the question, compile two awareness lists. These surface prior-state risk, not block the decision:

- **Already-tracked private paths** — run `git ls-files -- <candidate gitignored paths>`. Any file committed in a prior run (before the gitignore was added, or under a prior override) is still in history and still public if the repo is public. Display with a one-line warning: "These files are already in git history. A 'no override' answer here does NOT unpublish them — use `git filter-repo` or equivalent if removal is required, or `git rm --cached <path>` to drop them from the next commit while keeping the working copy."
- **Out-of-scope materials** — paths in `provided_materials` that live outside `<lesson_root>/`. These can't be staged directly regardless of gitignore; surface count + paths so the user knows.

Then fire a single `AskUserQuestion`:

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

**Default selection rule for non-interactive runs** (rare — the skill normally runs with a user present): default to `none` (no override, keep everything gitignored). Never auto-override without an explicit user answer, because anything gitignored is gitignored for a reason and auto-publishing is irreversible.

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

Write these into the log doc under `## Phase 5 — Deploy`.

### 7. Surface final report

See "Final report format" below.

## Step 2b — Update-mode deploy

### 1. Verify current branch

Before anything else, confirm the current branch equals the `Branch:` value RECORDED in the Phase 3 log (which includes any collision suffix like `-a` — never reconstruct the name from slug + date):

```bash
git rev-parse --abbrev-ref HEAD
```

If the output differs from the recorded value (especially `main`), halt the phase immediately — Phase 3 did not create the branch, or the branch was switched away in an earlier phase, or the stash/branch state is corrupted. Surface this to the user with the actual branch name and instructions to inspect Phase 3's log entries. All later merge/log steps in this phase consume the same recorded branch name.

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
git add <lesson_root>/src/<slug>.jsx
git add <lesson_root>/public/<refreshed-asset>
```

Additional paths if the update touched manim videos or interactive demos:

```bash
git add <lesson_root>/<name>.py
git add <lesson_root>/public/videos/<name>.mp4
```

Manim source scripts (`.py`) live at the lesson root, not in a `src/manim/` subdirectory. The inventory pre-scan in Phase 1 Globs `<lesson_root>/*.py` to find them.

Do not stage `lesson_build.log.md` unless the user explicitly requested tracking it in git (by default the log doc stays untracked).

Always stage `<lesson_root>/.gitignore` so any newly appended entries (e.g., for freshly attached materials) persist in the repo:

```bash
git add <lesson_root>/.gitignore
```

**Gitignore override staging** (same semantics as new mode Step 2a.3):

- `"none"` (default): no additional staging. Gitignored private paths stay out.
- `"all"`: force-stage every candidate from Step 1.5 with `git add -f`.
- `"custom:<file list>"`: force-stage only the user-selected paths with `git add -f`.

If the update run wrote a new materials file and the user kept the default (no override), the file stays on disk and gitignored. Log it under `Gitignored and on disk, not staged: <path>` so the user knows it exists but isn't published.

### 4. Commit to branch

```bash
git commit -m "$(cat <<'EOF'
<slug>: update — <short summary>

- <change 1>
- <change 2>
- <change 3>
EOF
)"
```

This commit lands on `lesson-update/<slug>-YYYYMMDD`, not `main`. Pre-commit hooks still apply; same rules as new mode (no `--no-verify`, no `--amend`, re-stage and create a new commit on hook failure).

### 5. Merge to main (conditional on `deploy_action`)

- `push-to-github` or `push-to-custom`:
  ```bash
  git checkout main
  git merge --no-ff <recorded branch name from the Phase 3 log>
  ```
  `--no-ff` forces a merge commit even when fast-forward is possible, preserving the update as a visible unit in history.
- `commit-only`: skip the merge. The commit stays on the update branch; `main` is not touched. Log `Merge: skipped (deploy_action=commit-only) — branch: lesson-update/<slug>-YYYYMMDD` so the user can merge manually later.

On conflict (should not happen from a clean branch): halt, surface conflict files, do not auto-resolve. The user resolves manually. Branch and stash stay intact.

### 6. Push (conditional on `deploy_action`)

- `push-to-github`:
  ```bash
  git push origin main
  ```
- `push-to-custom`: branch on `deploy_service_kind` — `"git-remote"` uses `git push custom-deploy main` (after `git remote add` if needed); `"cli"` runs `deploy_service` from `<workspace_root>`. Same rules as new-mode Step 2a.5.
- `commit-only`: skip. Log `Push: skipped (deploy_action=commit-only)`.

### 7. Stash recovery

If Phase 0 stashed local changes (`stashed: stash@{0} (<oid>)` in the Phase 0 log, echoed in Phase 3's `Stash ref:`), prompt the user via AskUserQuestion:

> "Restore stashed changes from `<oid>`? The stash was created before this update run to protect your uncommitted work."

Options:

- `Yes, restore now` — first confirm the current branch is where the user wants the work restored (after a merge that is `main`; under `commit-only`/`skip` offer to `git checkout` back to the branch the stash was taken on before applying — restoring user work onto the update branch strands it there). Then run `git stash apply <oid>` — apply by the recorded OID, never bare `git stash pop`, which grabs whatever happens to be stash@{0} (possibly a newer, unrelated stash). On clean apply, `git stash drop <oid>`.
- `No, leave it stashed for later` — log the OID for manual recovery.

Outcomes:

- **Yes → clean apply**: log `Stash recovery: applied + dropped (<oid>)`.
- **Yes → conflict**: conflict markers land in the working tree and the stash entry is untouched (that is why `apply`, not `pop`). Surface the conflict files: "Stash apply produced conflicts in `<files>`. The stash is still intact at `<oid>` — resolve manually, then `git stash drop <oid>`." Halt Phase 5 cleanly (the merge is already pushed so deploy succeeded). Log `Stash recovery: conflict (manual)`.
- **No**: leave the stash in place. Log `Stash recovery: manual (oid: <oid>)`.

If Phase 0 did not stash (`Stash ref: none`), skip this step entirely and log `Stash recovery: none`.

### 8. Log deploy metadata

Write to the log doc under `### Phase 5 — Deploy (update)` (nested under the current `## Update YYYY-MM-DD (run-id: <hash>)` section). Fields:

- `Update branch: lesson-update/<slug>-YYYYMMDD`
- `Merge commit SHA: <sha>` (from `git rev-parse HEAD` after merge, before push)
- `Stash ref: <ref or "none">`
- `Stash recovery: auto-popped | manual | conflict (manual) | none`
- `Deploy dashboard URL: <host-specific>`

### 9. Surface final report

See "Final report format" below. Include regression-watch entries from Phase 4 in addition to the standard unresolved list.

## Rollback on failure (update mode)

Three failure points in Phase 5 trigger the same behavior: **do not merge, preserve branch, preserve stash**.

1. **Phase 4 halted for a fundamental flaw**: Phase 5 still runs build verification (to confirm the current state builds), but even on pass, the skill does not merge if Phase 4 raised a fundamental-flaw halt. The update branch stays in place; the stash stays in place; the final report surfaces the branch name and stash ref plus Phase 4's diagnosis so the user can iterate manually.
2. **Phase 5 build verification fails**: same behavior. The `build-all.sh` or smoke check failure is logged with specific error output. No commit, no merge, no push. Branch and stash untouched.
3. **`git merge --no-ff` produces conflicts**: should not happen on a clean branch from a fresh checkout, but defensive. Halt, surface conflict files, do not attempt auto-resolve. The user's next step is to `git checkout main && git merge --abort` (or resolve manually), then rerun Phase 5 or hand-merge.

In all three cases:

- The update branch is **never** force-deleted by the skill.
- The stash is **never** dropped by the skill.
- The user decides whether to keep the branch or `git branch -D lesson-update/<slug>-YYYYMMDD` manually after recovery.
- The final report lists the branch name and stash ref explicitly so recovery commands are visible.

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

## Stash recovery              (update mode only, if applicable)
- Stash ref: <ref>
- Status: auto-popped | manual | conflict (manual) | none
```

If there are no unresolved items, regression-watch entries, suggested follow-ups, or orphan cleanup actions, the section heading is kept with "none" as the body so the user sees the absence explicitly. The orphan cleanup section is omitted entirely only when the Phase 1 inventory reported zero orphans (nothing to surface).

## Log output

The log doc lives at `<lesson_root>/lesson_build.log.md`.

### New mode

Append under `## Phase 5 — Deploy`:

```
## Phase 5 — Deploy
Deploy action: push-to-github | push-to-custom | commit-only | skip
Deploy service kind: git-remote | cli | null
Deploy service: <remote URL / CLI / null>
Build verification: PASS
Target: dist/<course>/<slug>/index.html
Smoke check: KaTeX OK, tabs OK, graph preview OK, console clean
Gitignore override: none | all | "custom:<list>" | N/A
Materials in commit: false (gitignored) | true (forced via override) | "custom:<list>" | N/A
Commit SHA: <sha>
Push result: ok (origin main) | ok (<custom-remote>) | skipped
Deploy dashboard URL: <host-specific>
Live URL: <host-specific>

## Final Report to User
<items from UNRESOLVED>
```

When `deploy_action == "skip"`, the log section is written but most fields are replaced by `Halted: no build or commit (user requested skip)`; only `Deploy action: skip` and the final report are recorded.

### Update mode

Append under the current `## Update YYYY-MM-DD (run-id: <hash>)` section as `### Phase 5 — Deploy (update)`:

```
### Phase 5 — Deploy (update)
Deploy action: push-to-github | push-to-custom | commit-only | skip
Deploy service kind: git-remote | cli | null
Deploy service: <remote URL / CLI / null>
Build verification: PASS
Target: dist/<course>/<slug>/index.html
Smoke check: KaTeX OK, tabs OK, graph preview OK, console clean
Gitignore override: none | all | "custom:<list>" | N/A
Materials in commit: false (gitignored) | true (forced via override) | "custom:<list>" | N/A
Update branch: lesson-update/<slug>-YYYYMMDD
Branch commit SHA: <sha>
Merge commit SHA: <sha | skipped>
Push result: ok (origin main) | ok (<custom-remote>) | skipped
Stash ref: <ref or "none">
Stash recovery: auto-popped | manual | conflict (manual) | none
Deploy dashboard URL: <host-specific>
Live URL: <host-specific>

### Final Report
<items from UNRESOLVED + regression watch>
```

On build-verification failure, the same section is written but the header line becomes `Build verification: FAIL` and the subsequent fields are replaced by `Halted: yes` plus the error excerpt. No commit/merge/push fields are written because those steps did not run.
