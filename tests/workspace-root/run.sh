#!/usr/bin/env bash
# The tutor's prompt names the served workspace root once, as the realpath of the checkout the
# proxy serves. Builds a checkout (core copy + npm install, template lesson), reaches it through a
# symlink, starts the proxy there with symlinks preserved (so its REPO_DIR IS the symlink path
# unless resolved) and a fake CLI first on PATH, then check.cjs opens sessions and reads back the
# prompt the CLI was handed. See README.md.
#   PORT=<n>   proxy port (default 3912)     KEEP=1   keep the temp workspace
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd); SKILL=$(cd "$HERE/../.." && pwd); B="$SKILL/references/bootstrap"
PORT="${PORT:-3912}"
WS=$(mktemp -d "${TMPDIR:-/tmp}/workspace-root-ws.XXXX"); echo "workspace: $WS"
PROXY_PID=""
cleanup() { [ -z "$PROXY_PID" ] || { kill "$PROXY_PID" 2>/dev/null || true; wait "$PROXY_PID" 2>/dev/null || true; }
  if [ -n "${KEEP:-}" ]; then echo "kept $WS"; else rm -rf "$WS"; fi; }
trap cleanup EXIT

REAL="$WS/checkout"; LINK="$WS/via-link"
mkdir -p "$REAL"; cp -r "$B/_lesson-core" "$REAL/_lesson-core"; (cd "$REAL/_lesson-core" && npm install --silent --prefer-offline)
mkdir -p "$REAL/course/claude_lessons/root-demo"; cp -r "$B/lesson-template/." "$REAL/course/claude_lessons/root-demo/"
ln -s "$REAL" "$LINK"
L="$LINK/course/claude_lessons/root-demo"

(cd "$L" && exec env PATH="$HERE/fake-claude:$PATH" FAKE_RECORD="$WS/record.jsonl" PROXY_PORT="$PORT" \
  node --preserve-symlinks --preserve-symlinks-main "$LINK/_lesson-core/server/proxy.js" >"$WS/proxy.log" 2>&1) &
PROXY_PID=$!
for _ in $(seq 1 60); do [ -f "$L/server/.proxy-port" ] && break; sleep 0.25; done
[ -f "$L/server/.proxy-port" ] || { echo "proxy did not start"; cat "$WS/proxy.log"; exit 1; }

PROXY_URL="http://127.0.0.1:$(cat "$L/server/.proxy-port")" REAL="$REAL" LINK="$LINK" WS="$WS" \
  SKILL="$SKILL" node "$HERE/check.cjs"
