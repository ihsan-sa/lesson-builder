#!/usr/bin/env bash
# KaTeX CDN fallback evidence. Bootstraps a throwaway workspace per
# references/bootstrap.md, scaffolds the template lesson with this directory's
# demo body, runs test_lesson.cjs (must be 17/17), boots Vite and drives
# check.cjs against it. See README.md.
#
# Teardown: on success, on failure and on Ctrl-C, SIGTERM or SIGHUP the trap
# ends every process running under the workspace — npm, the Vite dev server it
# execs and Vite's esbuild children — and removes the workspace. Only SIGKILL
# escapes it.
#   KATEX_FALLBACK_BROWSER=<chrome bin>  optional; else Playwright's own Chromium
#   PORT=<n>                             optional; dev-server port (default 5199)
#   KEEP=1                               keep the temp workspace (never the server)
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
SKILL=$(cd "$HERE/../.." && pwd)
B="$SKILL/references/bootstrap"
PORT="${PORT:-5199}"

WS=$(mktemp -d "${TMPDIR:-/tmp}/katex-fallback-ws.XXXX"); echo "workspace: $WS"
VITE_PID=""
CLEANED=""

# Every process whose cwd is inside the workspace, this shell excepted. npm, the
# Vite dev server it execs and Vite's esbuild children all run from the lesson
# dir, and a process that outlives this script is reparented to the user manager
# and may hold no port at all — its cwd is then the only handle left on it. That
# is how five of these were found on 2026-09-06, the oldest 4.3 days old, each
# pinning half a core.
ws_pids() (
  cd /   # so find/sed/grep, which inherit the workspace as cwd, are not matches
  find /proc -mindepth 2 -maxdepth 2 -name cwd \
    \( -lname "$WS" -o -lname "$WS/*" \) -printf '%h\n' 2>/dev/null |
    sed 's|^/proc/||' | grep -vx "$$" || true
)

cleanup() {
  # INT/TERM/HUP run this and then exit, which runs the EXIT trap as well.
  if [ -n "$CLEANED" ]; then return 0; fi
  CLEANED=1
  [ -n "$VITE_PID" ] && kill "$VITE_PID" 2>/dev/null || true
  # `npx vite` runs Vite as a grandchild, so VITE_PID is npm's and the line
  # above leaves the dev server holding $PORT with a cwd this trap is about to
  # delete. Same belt as tests/resume-metadata/run.sh: clear whatever still has
  # the port. By port and not by pid, unlike the two proxy fixtures: Vite
  # writes no identity file, so the port is the only handle on it. PORT here is
  # a fixed one this fixture owns and held exclusively (--strictPort), not one
  # tests/check.sh handed out — this fixture is not in that gate.
  fuser -k -TERM "${PORT}/tcp" 2>/dev/null || true
  # Neither line above reaches esbuild: Vite spawns it as a grandchild and it
  # holds no port. Sweep the workspace by cwd, give it a moment, then insist.
  for pid in $(ws_pids); do kill -TERM "$pid" 2>/dev/null || true; done
  for _ in $(seq 1 20); do
    if [ -z "$(ws_pids)" ]; then break; fi
    sleep 0.1
  done
  for pid in $(ws_pids); do kill -KILL "$pid" 2>/dev/null || true; done
  if [ -n "${KEEP:-}" ]; then echo "kept $WS"; else rm -rf "$WS"; fi
}
trap cleanup EXIT
# EXIT alone is not enough: a killed tmux pane or a dropped ssh session sends
# HUP, bash then dies without running any trap and the dev server is orphaned.
trap 'cleanup; exit 130' INT
trap 'cleanup; exit 143' TERM HUP

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
