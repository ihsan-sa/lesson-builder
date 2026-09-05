#!/usr/bin/env bash
# Resume-metadata evidence. Bootstraps a throwaway workspace per
# references/bootstrap.md, scaffolds the template lesson with this
# directory's demo body, starts the lesson's proxy with fake-claude
# (borrowed from tests/cancellation) on PATH, boots Vite, and drives
# check.cjs against both. See README.md.
#   PORT=<n>        Vite dev-server port (default 5901)
#   PROXY_PORT=<n>  lesson proxy port (default 3903; keeps clear of
#                   cancellation's 3901/3902)
#   RESUME_METADATA_BROWSER=<chrome bin>  optional; else Playwright's own Chromium
#   KEEP=1          keep the temp workspace for inspection
#   HOLD=1          skip check.cjs; print the URL and block so a person can
#                   drive the proxy + Vite by hand (Ctrl+C tears down)
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd); SKILL=$(cd "$HERE/../.." && pwd); B="$SKILL/references/bootstrap"
PORT="${PORT:-5901}"
PROXY_PORT="${PROXY_PORT:-3903}"

WS=$(mktemp -d "${TMPDIR:-/tmp}/resume-metadata-ws.XXXX"); echo "workspace: $WS"
PROXY_PID=""; VITE_PID=""; L=""
cleanup() {
  [ -n "$VITE_PID" ] && kill "$VITE_PID" 2>/dev/null || true
  [ -n "$PROXY_PID" ] && kill "$PROXY_PID" 2>/dev/null || true
  # Belt and brace: `exec` above should make PROXY_PID/VITE_PID the real
  # process, but a run that leaks a proxy or dev server onto a shared box is
  # worse than a redundant kill, so also clear whatever still holds the ports.
  local bp=""; [ -n "$L" ] && bp=$(cat "$L/server/.proxy-port" 2>/dev/null || true)
  [ -n "$bp" ] && { fuser -k -TERM "${bp}/tcp" 2>/dev/null || true; }
  fuser -k -TERM "${PORT}/tcp" 2>/dev/null || true
  if [ -n "${KEEP:-}" ]; then echo "kept $WS"; else rm -rf "$WS"; fi
}
trap cleanup EXIT

cp -r "$B/_lesson-core" "$WS/_lesson-core"; (cd "$WS/_lesson-core" && npm install --silent)
cp "$B/workspace-root/gitignore.template" "$WS/.gitignore"
cp "$B/workspace-root/env.local.example" "$WS/.env.local"

L="$WS/course/claude_lessons/resume-demo"; mkdir -p "$L"; cp -r "$B/lesson-template/." "$L/"
mv "$L/src/__SLUG_SNAKE__.jsx" "$L/src/resume_demo.jsx"
sed -i 's/__SLUG_SNAKE__/resume_demo/g; s/__SLUG__/resume-demo/g; s/__COURSE_CODE__/DEMO 101/g; s/__LESSON_TITLE__/Resume Metadata Demo/g' \
  "$L/package.json" "$L/src/main.jsx" "$L/CLAUDE.md" "$L/index.html"
# The committed demo body: a real one-topic lesson that mounts LessonShell +
# Chatbot for real (the shipped placeholder renders null).
cp "$HERE/lesson/resume_demo.jsx" "$L/src/resume_demo.jsx"

cd "$L"; npm install --silent

rm -f "$L/server/.proxy.json" "$L/server/.proxy-port"
(cd "$L" && exec env PATH="$SKILL/tests/cancellation/fake-claude:$PATH" PROXY_PORT="$PROXY_PORT" node server/proxy.js >"$WS/proxy.log" 2>&1) &
PROXY_PID=$!
for _ in $(seq 1 60); do [ -f "$L/server/.proxy-port" ] && break; sleep 0.25; done
[ -f "$L/server/.proxy.json" ] && [ -f "$L/server/.proxy-port" ] || { echo "proxy did not write .proxy.json + .proxy-port"; cat "$WS/proxy.log"; exit 1; }
echo "proxy on port $(cat "$L/server/.proxy-port") (pid $PROXY_PID)"

(cd "$L" && exec npx vite --port "$PORT" --strictPort >"$WS/vite.log" 2>&1) &
VITE_PID=$!
for _ in $(seq 1 60); do curl -sf -o /dev/null "http://localhost:$PORT/" && break; sleep 0.5; done
curl -sf -o /dev/null "http://localhost:$PORT/" || { echo "vite did not start"; cat "$WS/vite.log"; exit 1; }
echo "vite on port $PORT"

if [ -n "${HOLD:-}" ]; then
  echo "holding for manual testing: http://localhost:$PORT/  (proxy port $(cat "$L/server/.proxy-port"), chat.log at $L/server/chat.log)"
  echo "Ctrl+C to tear down."
  wait "$PROXY_PID" "$VITE_PID"
else
  BASE_URL="http://localhost:$PORT" LESSON_DIR="$L" node "$HERE/check.cjs"
fi
