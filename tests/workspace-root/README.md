# workspace-root

Proof that the tutor's system prompt names the served workspace root once, as an absolute,
symlink-resolved path, so a lesson's LESSON_CONTEXT can say "Read WORKSPACE_ROOT/<COURSE>/STUDY.md"
and a find fallback stays in this checkout (on 2026-09-19 one from an isolated cwd landed in another
checkout and told a student there was no study record).

The prompt is built in the browser, which cannot know the path: `chat/buildSystemPrompt.js` emits
`WORKSPACE_ROOT=@@WORKSPACE_ROOT@@` and `server/proxy.js` fills in `realpath(REPO_DIR)` — the dir its
last `--add-dir` names — before the prompt reaches the CLI.

`run.sh` builds a checkout, reaches it through a symlink, and starts the proxy with symlinks
preserved, so its REPO_DIR is the symlink path unless resolved (the check asserts that control too).
`check.cjs` opens an isolated and a shared session and reads back the prompt the fake CLI got.
Removing the realpath fails four checks.

    tests/workspace-root/run.sh        (or tests/check.sh workspace-root)
