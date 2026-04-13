# Phase 5 — Deploy

## Purpose

Phase 5 is the final phase of the lesson-builder skill. It runs local build verification as a gate, commits the work, pushes to `main` (directly in new mode, via a `--no-ff` merge from the update branch in update mode), logs the deploy metadata, and surfaces the final report to the user. The commit strategy is mode-branched: new-mode commits land directly on `main`, while update-mode commits land on the `lesson-update/<slug>-YYYYMMDD` branch created in Phase 3 and are merged into `main` only after the build verification gate passes. Phase 5 also handles stash recovery for update mode and leaves the branch + stash untouched on any failure so the user can recover manually.

## Ordering inside Phase 5

1. Local build verification (hard gate — halt the phase on failure)
2. Mode-branched commit + push (new mode: direct to main; update mode: branch commit → merge → push)
3. Stash recovery prompt (update mode only, if Phase 3 stashed)
4. Log append
5. Final report to user

Steps 2 through 5 are skipped entirely if step 1 fails.

## Step 1 — Local build verification (gate)

Runs first and gates everything else. Uses the existing project build pipeline plus a headless browser smoke check.

### Commands

```bash
cd <workspace_root> && bash build-all.sh
```

The workspace's `build-all.sh` runs `npm install` + `npx vite build --base="/<course>/<slug>/"` per lesson and copies each per-lesson `dist/` into the root `dist/<course>/<slug>/`. The skill only needs to confirm the target lesson's output exists:

```
<workspace_root>/dist/<course>/<slug>/index.html
```

### Headless browser smoke check

After `build-all.sh` exits 0 and the target `index.html` is present, launch a headless Playwright check against the built file. Two acceptable loading strategies:

- `file://<workspace_root>/dist/<course>/<slug>/index.html` direct load.
- Small local static server rooted at `<workspace_root>/dist/` serving on an ephemeral port, loaded via `http://localhost:<port>/<course>/<slug>/`.

Prefer `@playwright/mcp` if it is available. Otherwise fall back to a Node script using the `playwright` npm package directly.

### Checks the smoke test must perform

- KaTeX renders (no raw `\\frac` / `$$` visible in DOM; `.katex` nodes present).
- All lesson tabs are clickable and switching tabs does not throw.
- The graph preview tab renders every graph component without error.
- Browser console has zero errors (warnings allowed).

### Failure mode

If `build-all.sh` exits non-zero, or the target `index.html` is missing, or the smoke check finds a failure, Phase 5 halts **before** any `git add`, `git commit`, or `git merge`. The failure is logged as a build blocker with the specific error output (stderr excerpt, stack trace, or console error). The user is told exactly what failed and where. In update mode, the branch and stash stay in place untouched.

### Update mode note

In update mode, `build-all.sh` runs against the current branch (`lesson-update/<slug>-YYYYMMDD`), not `main`. This is correct: the update branch has the new lesson code, and the goal is to verify it builds before merging. Do not switch to `main` for the build step.

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
git add <lesson_root>/src/<slug>.jsx
git add <lesson_root>/package.json
git add <lesson_root>/vite.config.js
git add <lesson_root>/index.html
git add <lesson_root>/src/main.jsx
git add <lesson_root>/server/proxy.js
git add <lesson_root>/test_lesson.cjs
git add <lesson_root>/public/
```

If the workspace `build-all.sh` or any deploy config (e.g. `netlify.toml`, `vercel.json`, CI workflow) was modified:

```bash
git add <workspace_root>/build-all.sh
git add <workspace_root>/<deploy-config-file>
```

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

### 5. Push

```bash
git push origin main
```

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

Before anything else, confirm the current branch is the update branch created in Phase 3:

```bash
git rev-parse --abbrev-ref HEAD
```

Expected output: `lesson-update/<slug>-YYYYMMDD`. If the output is anything else (especially `main`), halt the phase immediately — Phase 3 did not create the branch, or the branch was switched away in an earlier phase, or the stash/branch state is corrupted. Surface this to the user with the actual branch name and instructions to inspect Phase 3's log entries.

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

### 5. Merge to main

```bash
git checkout main
git merge --no-ff lesson-update/<slug>-YYYYMMDD
```

`--no-ff` forces a merge commit even if a fast-forward would be possible. This preserves the update as a visible unit in history so future reviewers can see which commits belonged to a single update run. The merge commit message is the default `Merge branch 'lesson-update/<slug>-YYYYMMDD'`.

If the merge produces conflicts (it should not on a clean branch, but defensive): halt immediately, surface the conflict files, and do **not** attempt to auto-resolve. The user must resolve manually. The update branch still exists and the stash is still in place, so nothing is lost.

### 6. Push

```bash
git push origin main
```

### 7. Stash recovery

If Phase 3 stashed local changes before creating the update branch (`Stash ref: <ref>` in the Phase 3 log), prompt the user via AskUserQuestion:

> "Restore stashed changes from `<stash-ref>`? The stash was created before this update run to protect your uncommitted work."

Options:

- `Yes, pop the stash now` — run `git stash pop`
- `No, leave it stashed for later` — log the stash ref for manual recovery

Outcomes:

- **Yes → clean pop**: log `Stash recovery: auto-popped`.
- **Yes → conflict on pop**: `git stash pop` exits non-zero with conflict markers in working tree. Surface the conflict files to the user with clear instructions: "Stash pop produced conflicts in `<files>`. The stash is still available under `<stash-ref>` — resolve the conflicts manually, then `git stash drop <stash-ref>` when done." Halt Phase 5 cleanly (the merge is already pushed so deploy succeeded). Log `Stash recovery: conflict (manual)`.
- **No**: leave the stash in place. Log `Stash recovery: manual (stash ref: <ref>)`.

If Phase 3 did not stash (`Stash ref: none`), skip this step entirely and log `Stash recovery: none`.

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

The workspace's hosting target (Netlify, Vercel, GitHub Pages, Cloudflare Pages, or a custom CI pipeline) is determined by the workspace's deploy config, not by this skill. The typical pattern is "push to `main` triggers an automatic rebuild-and-deploy on the configured host". If the workspace uses a different trigger (manual deploy button, tag-based release, etc.), the skill should follow whatever the workspace's project-level `CLAUDE.md` or deploy docs specify.

The skill's responsibilities stop at the `git push`:

- It does not wait for the hosted build to complete.
- It logs the deploy dashboard URL (if known) so the user can check status.
- If the workspace exposes a deploy-state MCP or API, the skill may optionally query deploy state, but this is not required.

### Chatbot in prod

The lesson chatbot is **disabled** in production for static hosts. The header banner (rendered by the lesson template when `import.meta.env.PROD` is true) says so. This is expected and intentional for any host that serves only static files:

- `/chat` routes require the local Express proxy (`_lesson-core/server/proxy.js`).
- Static hosts do not run the Express proxy.
- Users run the chatbot locally via `node server/proxy.js` + `npx vite`.

The final report should **not** flag "chatbot disabled in prod" as an issue. It is the designed behavior for static-only deploys. If the workspace uses a deploy target that can run the proxy (e.g., a Node-capable host), this limitation does not apply and the banner can be removed from the template.

## Final report format

The final report is surfaced to the user as the last action of Phase 5 (after all logging). Structure:

```
# Lesson Build Complete — <course> / <slug>

## What shipped
- Mode: new | update
- Lesson: <course> / <slug>
- Commit SHA: <sha>            (update mode: merge commit SHA)
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
Build verification: PASS
Target: dist/<course>/<slug>/index.html
Smoke check: KaTeX OK, tabs OK, graph preview OK, console clean
Commit SHA: <sha>
Push result: ok (origin main)
Deploy dashboard URL: <host-specific>
Live URL: <host-specific>

## Final Report to User
<items from UNRESOLVED>
```

### Update mode

Append under the current `## Update YYYY-MM-DD (run-id: <hash>)` section as `### Phase 5 — Deploy (update)`:

```
### Phase 5 — Deploy (update)
Build verification: PASS
Target: dist/<course>/<slug>/index.html
Smoke check: KaTeX OK, tabs OK, graph preview OK, console clean
Update branch: lesson-update/<slug>-YYYYMMDD
Branch commit SHA: <sha>
Merge commit SHA: <sha>
Push result: ok (origin main)
Stash ref: <ref or "none">
Stash recovery: auto-popped | manual | conflict (manual) | none
Deploy dashboard URL: <host-specific>
Live URL: <host-specific>

### Final Report
<items from UNRESOLVED + regression watch>
```

On build-verification failure, the same section is written but the header line becomes `Build verification: FAIL` and the subsequent fields are replaced by `Halted: yes` plus the error excerpt. No commit/merge/push fields are written because those steps did not run.
