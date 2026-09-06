#!/usr/bin/env bash
# Thread-actor evidence. Bootstraps a throwaway workspace per
# references/bootstrap.md (core copy + npm install, template lesson scaffold),
# starts the lesson's proxy with tests/thread-actors/fake-claude first on PATH
# and drives check.cjs against it. See README.md.
#   REAL_CLAUDE=1   also run the isolation + fold probes against the real
#                   `claude` (spends tokens: ~8 short haiku turns)
#   PORT=<n>        proxy port (default 3911 — 3901 is the app's own)
#   KEEP=1          keep the temp workspace for inspection
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd); SKILL=$(cd "$HERE/../.." && pwd); B="$SKILL/references/bootstrap"
PORT="${PORT:-3911}"
WS=$(mktemp -d "${TMPDIR:-/tmp}/thread-actors-ws.XXXX"); echo "workspace: $WS"
PROXY_PID=""
cleanup() {
  [ -n "$PROXY_PID" ] && kill "$PROXY_PID" 2>/dev/null || true
  if [ -n "${KEEP:-}" ]; then echo "kept $WS"; else rm -rf "$WS"; fi
}
trap cleanup EXIT

# --prefer-offline: a warm npm cache serves express/cors without asking the registry, which is
# what lets this fixture run in tests/check.sh. Same flag as the two @babel/parser fixtures.
cp -r "$B/_lesson-core" "$WS/_lesson-core"; (cd "$WS/_lesson-core" && npm install --silent --prefer-offline)
cp "$B/workspace-root/gitignore.template" "$WS/.gitignore"; cp "$B/workspace-root/env.local.example" "$WS/.env.local"
L="$WS/course/claude_lessons/thread-demo"; mkdir -p "$L"; cp -r "$B/lesson-template/." "$L/"
mv "$L/src/__SLUG_SNAKE__.jsx" "$L/src/thread_demo.jsx"
sed -i 's/__SLUG_SNAKE__/thread_demo/g; s/__SLUG__/thread-demo/g; s/__COURSE_CODE__/DEMO 101/g; s/__LESSON_TITLE__/Thread Demo/g' \
  "$L/package.json" "$L/src/main.jsx" "$L/CLAUDE.md" "$L/index.html"
# The proxy resolves express/cors from _lesson-core/node_modules through the
# shim import, so the lesson's own (Vite/React/Playwright) install is not needed here.

# Where fake-claude records every invocation's argv and each session's
# transcript. The check reads it to prove WHICH session each turn resumed.
FAKE_STATE="$WS/fake-state"; mkdir -p "$FAKE_STATE"

start_proxy() { # $1 = PATH prefix ("" for the real CLI), $2 = port
  rm -f "$L/server/.proxy.json" "$L/server/.proxy-port"
  (cd "$L" && PATH="${1:+$1:}$PATH" FAKE_STATE="$FAKE_STATE" PROXY_PORT="$2" node server/proxy.js >"$WS/proxy-$2.log" 2>&1) &
  PROXY_PID=$!
  for _ in $(seq 1 60); do [ -f "$L/server/.proxy-port" ] && break; sleep 0.25; done
  [ -f "$L/server/.proxy-port" ] || { echo "proxy did not start"; cat "$WS/proxy-$2.log"; exit 1; }
  echo "proxy on port $(cat "$L/server/.proxy-port") (pid $PROXY_PID, claude=$(grep -o 'claude=[^ ]*' "$WS/proxy-$2.log" | head -1))"
}

start_proxy "$HERE/fake-claude" "$PORT"
PROXY_URL="http://127.0.0.1:$(cat "$L/server/.proxy-port")" LESSON_DIR="$L" CORE_DIR="$WS/_lesson-core" FAKE_STATE="$FAKE_STATE" node "$HERE/check.cjs"
echo "--- proxy log: the thread lines a reviewer should see ---"
grep -E 'THREAD_OPEN|THREAD_FORK|THREAD_FOLD|THREAD_DELETE|CANCEL_START|CANCEL_DONE|CHAT_CANCELLED' "$WS/proxy-$PORT.log" || true
kill "$PROXY_PID"; wait "$PROXY_PID" 2>/dev/null || true; PROXY_PID=""

if [ -n "${REAL_CLAUDE:-}" ]; then
  rm -f "$L/server/chat.log"
  start_proxy "" "$((PORT + 1))"
  PROXY_URL="http://127.0.0.1:$(cat "$L/server/.proxy-port")" LESSON_DIR="$L" CORE_DIR="$WS/_lesson-core" node "$HERE/check.cjs" --real
  echo "--- real-CLI transcript (the probes in README 'Transcripts') ---"
  grep -E 'CHAT_START|CHAT_OK|THREAD_FORK|THREAD_FOLD' "$L/server/chat.log" || true
fi
