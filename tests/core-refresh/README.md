# core-refresh

`scripts/core-refresh.sh` keeps a workspace's `_lesson-core/` at what the skill ships, with no one
asked: it refreshes a stale core, proves it with a smoke test, and puts the old core back if that
fails. Each case builds its own workspace under `$TMPDIR`.

| case | fixture | asserts |
|---|---|---|
| 1 | a core installed from the payload, then made stale: the tutor default moved back to Opus 5, a shipped file deleted; plus a file of its own in the core, a marker in `node_modules`, an agent of its own | `check` exits 1 naming both drifted files and not the workspace's own; `refresh` exits 0 after the smoke test; the model file and the deleted file match the payload again; the own file, the marker and the own agent survive; skill agents are copied in; nothing is left in the workspace; `check` then exits 0, and `refresh --quiet` on a current core exits 0 and prints nothing |
| 2 | the same stale workspace, refreshed from a copy of the skill whose payload `index.js` does not compile | `refresh` exits 3 with the `CORE REFRESH ROLLED BACK` banner naming the smoke test's `vite build`; the core is byte-identical to before (`diff -r`, `node_modules` included); nothing is left in the workspace |
| 3 | a core copied straight from the payload | `smoke` exits 0, then 1 once its `index.js` is broken |

    tests/core-refresh/run.sh        # KEEP=1 keeps the temp root

Needs node, npm and curl. The npm installs use `--prefer-offline`, so a warm cache serves them.
