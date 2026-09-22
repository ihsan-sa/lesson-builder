# workspace-root

Proof that the tutor's system prompt names the served workspace root once, as an absolute,
symlink-resolved path, so a lesson's LESSON_CONTEXT can say "Read WORKSPACE_ROOT/<COURSE>/STUDY.md"
and a find fallback stays in this checkout (on 2026-09-19 one from an isolated cwd landed in another
checkout and told a student there was no study record).

The prompt is built in the browser, which cannot know the path, so it names no root at all:
`server/proxy.js` calls `withWorkspaceRoot` (`chat/buildSystemPrompt.js`) on the way to the CLI,
which inserts the line after the study-record block with `realpath(REPO_DIR)` — the dir its last
`--add-dir` names. An unfilled prompt has to be safe on its own, because the hosted tutor
(`lessons/chat.py`) sends what the browser built straight to the model: the checks below assert it
carries no placeholder and no rule pointing at a root that was never filled in.

`run.sh` builds a checkout, reaches it through a symlink, and starts the proxy with symlinks
preserved, so its REPO_DIR is the symlink path unless resolved (the check asserts that control too).
`check.cjs` opens an isolated and a shared session and reads back the prompt the fake CLI got.
Removing the realpath fails four checks.

    tests/workspace-root/run.sh        (or tests/check.sh workspace-root)
