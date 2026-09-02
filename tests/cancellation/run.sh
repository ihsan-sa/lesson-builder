#!/usr/bin/env bash
# Cancellation evidence. Bootstraps a throwaway workspace per
# references/bootstrap.md (core copy + npm install, template lesson scaffold),
# starts the lesson's proxy with tests/cancellation/fake-claude first on PATH
# and drives check.cjs against it. See README.md.
#   REAL_CLAUDE=1   also run the smoke against the real `claude` (spends tokens)
#   PORT=<n>        proxy port (default 3901)
#   KEEP=1          keep the temp workspace for inspection
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd); SKILL=$(cd "$HERE/../.." && pwd); B="$SKILL/references/bootstrap"
PORT="${PORT:-3901}"
WS=$(mktemp -d "${TMPDIR:-/tmp}/cancellation-ws.XXXX"); echo "workspace: $WS"
PROXY_PID=""
cleanup() {
  [ -n "$PROXY_PID" ] && kill "$PROXY_PID" 2>/dev/null || true
  if [ -n "${KEEP:-}" ]; then echo "kept $WS"; else rm -rf "$WS"; fi
}
trap cleanup EXIT

cp -r "$B/_lesson-core" "$WS/_lesson-core"; (cd "$WS/_lesson-core" && npm install --silent)
cp "$B/workspace-root/gitignore.template" "$WS/.gitignore"; cp "$B/workspace-root/env.local.example" "$WS/.env.local"
L="$WS/course/claude_lessons/cancel-demo"; mkdir -p "$L"; cp -r "$B/lesson-template/." "$L/"
mv "$L/src/__SLUG_SNAKE__.jsx" "$L/src/cancel_demo.jsx"
sed -i 's/__SLUG_SNAKE__/cancel_demo/g; s/__SLUG__/cancel-demo/g; s/__COURSE_CODE__/DEMO 101/g; s/__LESSON_TITLE__/Cancellation Demo/g' \
  "$L/package.json" "$L/src/main.jsx" "$L/CLAUDE.md" "$L/index.html"
# The proxy resolves express/cors from _lesson-core/node_modules through the
# shim import, so the lesson's own (Vite/React/Playwright) install is not needed here.

start_proxy() { # $1 = PATH prefix ("" for the real CLI), $2 = port
  rm -f "$L/server/.proxy.json" "$L/server/.proxy-port"
  (cd "$L" && PATH="${1:+$1:}$PATH" PROXY_PORT="$2" node server/proxy.js >"$WS/proxy-$2.log" 2>&1) &
  PROXY_PID=$!
  for _ in $(seq 1 60); do [ -f "$L/server/.proxy-port" ] && break; sleep 0.25; done
  [ -f "$L/server/.proxy.json" ] && [ -f "$L/server/.proxy-port" ] || { echo "proxy did not write .proxy.json + .proxy-port"; cat "$WS/proxy-$2.log"; exit 1; }
  echo "proxy on port $(cat "$L/server/.proxy-port") (pid $PROXY_PID, claude=$(grep -o 'claude=[^ ]*' "$WS/proxy-$2.log" | head -1))"
}

start_proxy "$HERE/fake-claude" "$PORT"
PROXY_URL="http://127.0.0.1:$(cat "$L/server/.proxy-port")" LESSON_DIR="$L" node "$HERE/check.cjs"
kill "$PROXY_PID"; wait "$PROXY_PID" 2>/dev/null || true; PROXY_PID=""

if [ -n "${REAL_CLAUDE:-}" ]; then
  rm -f "$L/server/chat.log"
  start_proxy "" "$((PORT + 1))"
  PROXY_URL="http://127.0.0.1:$(cat "$L/server/.proxy-port")" LESSON_DIR="$L" node "$HERE/check.cjs" --real
fi
