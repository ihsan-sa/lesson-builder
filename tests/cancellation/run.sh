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
PROXY_PID=""; L=""
# `exec` in start_proxy makes PROXY_PID the node process itself. Without it $!
# was the subshell, the signal reaped only that, and the proxy was orphaned
# with its cwd already deleted by the `rm -rf` below — one leaked server per
# run, alive until something else ended it. `wait` rather than a sleep: it
# returns when the process is really gone, and it is safe to call twice.
stop_proxy() {
  [ -n "$PROXY_PID" ] || return 0
  kill "$PROXY_PID" 2>/dev/null || true
  wait "$PROXY_PID" 2>/dev/null || true
  PROXY_PID=""
}
cleanup() {
  stop_proxy
  # Belt and brace: .proxy.json exists only while a proxy is alive (it removes
  # it on exit) and records that proxy's own pid, so this reaches something
  # only when the line above failed to. By pid and not by port, unlike
  # tests/resume-metadata/run.sh: tests/check.sh gives each fixture a free
  # ephemeral port, which another process on the box may hold by the time this
  # runs, and the argv check keeps the signal off a stranger that inherited the
  # pid number. Every step is failure-proof on purpose: under `set -e` one
  # non-zero command in an EXIT trap abandons the rest of it and becomes the
  # script's exit status, and a missing .proxy.json is the NORMAL case.
  local bpid=""
  if [ -n "$L" ] && [ -r "$L/server/.proxy.json" ]; then
    bpid=$(sed -n 's/.*"pid": *\([0-9]*\).*/\1/p' "$L/server/.proxy.json") || bpid=""
  fi
  case $(ps -p "${bpid:-0}" -o args= 2>/dev/null || true) in *server/proxy.js*) kill "$bpid" 2>/dev/null || true ;; esac
  if [ -n "${KEEP:-}" ]; then echo "kept $WS"; else rm -rf "$WS"; fi
}
trap cleanup EXIT

# --prefer-offline: a warm npm cache serves express/cors without asking the registry, which is
# what lets this fixture run in tests/check.sh. Same flag as the two @babel/parser fixtures.
cp -r "$B/_lesson-core" "$WS/_lesson-core"; (cd "$WS/_lesson-core" && npm install --silent --prefer-offline)
cp "$B/workspace-root/gitignore.template" "$WS/.gitignore"; cp "$B/workspace-root/env.local.example" "$WS/.env.local"
L="$WS/course/claude_lessons/cancel-demo"; mkdir -p "$L"; cp -r "$B/lesson-template/." "$L/"
mv "$L/src/__SLUG_SNAKE__.jsx" "$L/src/cancel_demo.jsx"
sed -i 's/__SLUG_SNAKE__/cancel_demo/g; s/__SLUG__/cancel-demo/g; s/__COURSE_CODE__/DEMO 101/g; s/__LESSON_TITLE__/Cancellation Demo/g' \
  "$L/package.json" "$L/src/main.jsx" "$L/CLAUDE.md" "$L/index.html"
# The proxy resolves express/cors from _lesson-core/node_modules through the
# shim import, so the lesson's own (Vite/React/Playwright) install is not needed here.

start_proxy() { # $1 = PATH prefix ("" for the real CLI), $2 = port
  rm -f "$L/server/.proxy.json" "$L/server/.proxy-port"
  (cd "$L" && exec env PATH="${1:+$1:}$PATH" PROXY_PORT="$2" node server/proxy.js >"$WS/proxy-$2.log" 2>&1) &
  PROXY_PID=$!
  for _ in $(seq 1 60); do [ -f "$L/server/.proxy-port" ] && break; sleep 0.25; done
  [ -f "$L/server/.proxy.json" ] && [ -f "$L/server/.proxy-port" ] || { echo "proxy did not write .proxy.json + .proxy-port"; cat "$WS/proxy-$2.log"; exit 1; }
  echo "proxy on port $(cat "$L/server/.proxy-port") (pid $PROXY_PID, claude=$(grep -o 'claude=[^ ]*' "$WS/proxy-$2.log" | head -1))"
}

start_proxy "$HERE/fake-claude" "$PORT"
PROXY_URL="http://127.0.0.1:$(cat "$L/server/.proxy-port")" LESSON_DIR="$L" CORE_DIR="$WS/_lesson-core" node "$HERE/check.cjs"
stop_proxy

if [ -n "${REAL_CLAUDE:-}" ]; then
  rm -f "$L/server/chat.log"
  start_proxy "" "$((PORT + 1))"
  PROXY_URL="http://127.0.0.1:$(cat "$L/server/.proxy-port")" LESSON_DIR="$L" CORE_DIR="$WS/_lesson-core" node "$HERE/check.cjs" --real
fi
