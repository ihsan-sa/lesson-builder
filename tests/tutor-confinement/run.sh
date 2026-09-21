#!/usr/bin/env bash
# Tutor confinement, deterministic. Bootstraps a throwaway workspace (core copy + npm install,
# template lesson, a one-agent .claude/agents registry), starts the lesson's proxy with
# tests/tutor-confinement/fake-claude first on PATH, and drives check.cjs twice: once with a CLI
# that has every confining option, once with one whose --help lacks --restricted. See README.md.
#   PORT=<n>   proxy port (default 3911)     KEEP=1   keep the temp workspace
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd); SKILL=$(cd "$HERE/../.." && pwd); B="$SKILL/references/bootstrap"
PORT="${PORT:-3911}"
WS=$(mktemp -d "${TMPDIR:-/tmp}/tutor-confinement-ws.XXXX"); echo "workspace: $WS"
PROXY_PID=""
stop_proxy() { [ -n "$PROXY_PID" ] || return 0; kill "$PROXY_PID" 2>/dev/null || true; wait "$PROXY_PID" 2>/dev/null || true; PROXY_PID=""; }
cleanup() { stop_proxy; if [ -n "${KEEP:-}" ]; then echo "kept $WS"; else rm -rf "$WS"; fi; }
trap cleanup EXIT

cp -r "$B/_lesson-core" "$WS/_lesson-core"; (cd "$WS/_lesson-core" && npm install --silent --prefer-offline)
L="$WS/course/claude_lessons/confine-demo"; mkdir -p "$L"; cp -r "$B/lesson-template/." "$L/"
mkdir -p "$WS/.claude/agents"; printf -- '---\nname: zebra-agent\ndescription: Draws zebras.\ntools: Read\n---\nYou draw zebras.\n' > "$WS/.claude/agents/zebra-agent.md"

start_proxy() { # $1 = FAKE_HELP_OMIT value ("" for a CLI with every option)
  rm -f "$L/server/.proxy.json" "$L/server/.proxy-port" "$L/server/chat.log" "$WS/record.jsonl"
  # CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD is set here so check.cjs can see the proxy strip it.
  (cd "$L" && exec env PATH="$HERE/fake-claude:$PATH" FAKE_RECORD="$WS/record.jsonl" FAKE_HELP_OMIT="$1" \
    CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1 PROXY_PORT="$PORT" node server/proxy.js >"$WS/proxy.log" 2>&1) &
  PROXY_PID=$!
  for _ in $(seq 1 60); do [ -f "$L/server/.proxy-port" ] && break; sleep 0.25; done
  [ -f "$L/server/.proxy-port" ] || { echo "proxy did not start"; cat "$WS/proxy.log"; exit 1; }
}

start_proxy ""
PROXY_URL="http://127.0.0.1:$(cat "$L/server/.proxy-port")" LESSON_DIR="$L" WS="$WS" node "$HERE/check.cjs" confined
stop_proxy
start_proxy "--restricted"
PROXY_URL="http://127.0.0.1:$(cat "$L/server/.proxy-port")" LESSON_DIR="$L" WS="$WS" node "$HERE/check.cjs" unconfined
