#!/usr/bin/env bash
# KaTeX CDN fallback evidence. Bootstraps a throwaway workspace per
# references/bootstrap.md, scaffolds the template lesson with this directory's
# demo body, runs test_lesson.cjs (must be 17/17), boots Vite and drives
# check.cjs against it. See README.md.
#   KATEX_FALLBACK_BROWSER=<chrome bin>  optional; else Playwright's own Chromium
#   PORT=<n>                             optional; dev-server port (default 5199)
#   KEEP=1                               keep the temp workspace for inspection
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
SKILL=$(cd "$HERE/../.." && pwd)
B="$SKILL/references/bootstrap"
PORT="${PORT:-5199}"

WS=$(mktemp -d "${TMPDIR:-/tmp}/katex-fallback-ws.XXXX"); echo "workspace: $WS"
VITE_PID=""
cleanup() {
  [ -n "$VITE_PID" ] && kill "$VITE_PID" 2>/dev/null || true
  if [ -n "${KEEP:-}" ]; then echo "kept $WS"; else rm -rf "$WS"; fi
}
trap cleanup EXIT

cp -r "$B/_lesson-core" "$WS/_lesson-core"; (cd "$WS/_lesson-core" && npm install --silent)
cp "$B/workspace-root/gitignore.template" "$WS/.gitignore"
cp "$B/workspace-root/env.local.example" "$WS/.env.local"

L="$WS/course/claude_lessons/katex-demo"; mkdir -p "$L"; cp -r "$B/lesson-template/." "$L/"
mv "$L/src/__SLUG_SNAKE__.jsx" "$L/src/katex_demo.jsx"
sed -i 's/__SLUG_SNAKE__/katex_demo/g; s/__SLUG__/katex-demo/g; s/__COURSE_CODE__/DEMO 101/g; s/__LESSON_TITLE__/KaTeX Fallback Demo/g' \
  "$L/package.json" "$L/src/main.jsx" "$L/CLAUDE.md" "$L/index.html"
# The committed demo body: a real lesson (17/17) whose only job is to carry
# display and inline math through the shell's loading gate.
cp "$HERE/lesson/katex_demo.jsx" "$L/src/katex_demo.jsx"

cd "$L"; npm install --silent
node test_lesson.cjs src/katex_demo.jsx | tail -1 | tee /dev/stderr | grep -q "17/17 passed"

npx vite --port "$PORT" --strictPort >"$WS/vite.log" 2>&1 &
VITE_PID=$!
for _ in $(seq 1 60); do
  curl -sf -o /dev/null "http://localhost:$PORT/" && break
  sleep 0.5
done
curl -sf -o /dev/null "http://localhost:$PORT/" || { echo "dev server did not start"; cat "$WS/vite.log"; exit 1; }

# LESSON_DIR lets check.cjs fall back to the lesson's own playwright install
# when tests/katex-fallback has not been npm installed.
BASE_URL="http://localhost:$PORT" LESSON_DIR="$L" node "$HERE/check.cjs"
