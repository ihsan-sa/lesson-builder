#!/usr/bin/env bash
# Scratch-workspace validation of the safe renderer: bootstrap a throwaway workspace per
# references/bootstrap.md, scaffold the template lesson, run its test_lesson.cjs, then boot
# Vite and drive scratch/harness_check.cjs headless. See README.md.
#   LESSON_SRC=<real lesson src .jsx>   optional; makes test_lesson.cjs meaningful (17/17)
#   SAFE_RENDER_BROWSER=<chromium bin>  optional; else Playwright's own Chromium
#   KEEP=1                              keep the temp workspace for inspection
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd); SKILL=$(cd "$HERE/../.." && pwd); B="$SKILL/references/bootstrap"
WS=$(mktemp -d "${TMPDIR:-/tmp}/safe-render-ws.XXXX"); echo "workspace: $WS"
trap '[ -n "${KEEP:-}" ] && echo "kept $WS" || rm -rf "$WS"' EXIT
cp -r "$B/_lesson-core" "$WS/_lesson-core"; (cd "$WS/_lesson-core" && npm install --silent)
cp "$B/workspace-root/gitignore.template" "$WS/.gitignore"; cp "$B/workspace-root/env.local.example" "$WS/.env.local"
cp "$B/workspace-root/build-all.sh" "$WS/build-all.sh"; chmod +x "$WS/build-all.sh"
mkdir -p "$WS/.claude/agents"; cp "$B"/workspace-root/.claude/agents/*.md "$SKILL"/agents/*.md "$WS/.claude/agents/"
L="$WS/course/claude_lessons/demo"; mkdir -p "$L"; cp -r "$B/lesson-template/." "$L/"
mv "$L/src/__SLUG_SNAKE__.jsx" "$L/src/demo.jsx"
sed -i 's/__SLUG_SNAKE__/demo/g; s/__SLUG__/demo/g; s/__COURSE_CODE__/DEMO101/g; s/__LESSON_TITLE__/Safe Render Check/g' \
  "$L/package.json" "$L/src/main.jsx" "$L/CLAUDE.md" "$L/index.html"
[ -n "${LESSON_SRC:-}" ] && cp "$LESSON_SRC" "$L/src/demo.jsx"
cp "$HERE/scratch/harness.html" "$L/harness.html"; cp "$HERE/scratch/harness.jsx" "$L/src/harness.jsx"; cp "$HERE/scratch/harness_check.cjs" "$L/harness_check.cjs"
cd "$L"; npm install --silent
if [ -n "${LESSON_SRC:-}" ]; then node test_lesson.cjs src/demo.jsx | tail -1 | tee /dev/stderr | grep -q "17/17 passed"
else node test_lesson.cjs src/demo.jsx | tail -1 || true; echo "(placeholder src: content tests fail by design; set LESSON_SRC for 17/17)"; fi
node harness_check.cjs
