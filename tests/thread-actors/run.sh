#!/usr/bin/env bash
# Thread-actor evidence. Bootstraps a throwaway workspace per
# references/bootstrap.md (core copy + npm install, template lesson scaffold),
# starts the lesson's proxy with tests/thread-actors/fake-claude first on PATH
# and drives check.cjs against it. See README.md.
#
# After the suite it runs two negative controls, which are what make its
# reporting believable rather than claimed. One kills the proxy in the middle of
# case 5, at the instant the reported flake lost it, and requires the run to
# name the proxy and NOT print a failure about thread forking. The other leaves
# the proxy up and breaks what case 5 tests, and requires the opposite: red,
# naming the forking, and no mention of the proxy. `SELFCHECK=0` skips both.
#
#   REAL_CLAUDE=1   also run the isolation + fold probes against the real
#                   `claude` (spends tokens: ~8 short haiku turns)
#   PORT=<n>        proxy port (default 3911 — 3901 is the app's own).
#                   The controls use PORT+2 and PORT+3.
#   SELFCHECK=0     skip the two negative controls
#   KEEP=1          keep the temp workspace for inspection
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd); SKILL=$(cd "$HERE/../.." && pwd); B="$SKILL/references/bootstrap"
PORT="${PORT:-3911}"
WS=$(mktemp -d "${TMPDIR:-/tmp}/thread-actors-ws.XXXX"); echo "workspace: $WS"
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
  (cd "$L" && exec env PATH="${1:+$1:}$PATH" FAKE_STATE="$FAKE_STATE" PROXY_PORT="$2" node server/proxy.js >"$WS/proxy-$2.log" 2>&1) &
  PROXY_PID=$!
  for _ in $(seq 1 60); do [ -f "$L/server/.proxy-port" ] && break; sleep 0.25; done
  [ -f "$L/server/.proxy-port" ] || { echo "proxy did not start"; cat "$WS/proxy-$2.log"; exit 1; }
  echo "proxy on port $(cat "$L/server/.proxy-port") (pid $PROXY_PID, claude=$(grep -o 'claude=[^ ]*' "$WS/proxy-$2.log" | head -1))"
}

# check.cjs exit 3 = "the proxy stopped answering". It can see only that the
# port went quiet; this is the half only the parent knows — how the process it
# started actually ended (a wait status over 128 is 128+the signal that killed
# it) and what the proxy itself said last. Together they are the report.
proxy_death_evidence() { # $1 = port
  local st=0
  if kill -0 "$PROXY_PID" 2>/dev/null; then
    echo "proxy pid $PROXY_PID is still running but not answering on its port"
  else
    wait "$PROXY_PID" 2>/dev/null || st=$?
    if [ "$st" -gt 128 ]; then echo "proxy pid $PROXY_PID was killed by signal $((st - 128))"
    else echo "proxy pid $PROXY_PID exited $st"; fi
  fi
  echo "--- the proxy's own last 20 lines ($WS/proxy-$1.log) ---"
  tail -20 "$WS/proxy-$1.log" || true
}

# Runs check.cjs and returns its exit code without `set -e` ending the script,
# so exit 3 can be given its evidence before the script goes down with it.
run_check() { # $1 = port, rest = check.cjs args
  local port=$1; shift
  local rc=0
  PROXY_URL="http://127.0.0.1:$port" LESSON_DIR="$L" CORE_DIR="$WS/_lesson-core" FAKE_STATE="$FAKE_STATE" \
    node "$HERE/check.cjs" "$@" || rc=$?
  return "$rc"
}

start_proxy "$HERE/fake-claude" "$PORT"
RC=0; run_check "$(cat "$L/server/.proxy-port")" || RC=$?
if [ "$RC" = 3 ]; then proxy_death_evidence "$PORT"; exit 3; fi
[ "$RC" = 0 ] || exit "$RC"
echo "--- proxy log: the thread lines a reviewer should see ---"
grep -E 'THREAD_OPEN|THREAD_FORK|THREAD_FOLD|THREAD_DELETE|CANCEL_START|CANCEL_DONE|CHAT_CANCELLED' "$WS/proxy-$PORT.log" || true
stop_proxy

if [ -n "${REAL_CLAUDE:-}" ]; then
  rm -f "$L/server/chat.log"
  start_proxy "" "$((PORT + 1))"
  PROXY_URL="http://127.0.0.1:$(cat "$L/server/.proxy-port")" LESSON_DIR="$L" CORE_DIR="$WS/_lesson-core" node "$HERE/check.cjs" --real
  echo "--- real-CLI transcript (the probes in README 'Transcripts') ---"
  grep -E 'CHAT_START|CHAT_OK|THREAD_FORK|THREAD_FOLD' "$L/server/chat.log" || true
  stop_proxy
fi

# ----------------------------------------------------------- negative controls
# Both drive case 5 alone (`--only 5`) against a proxy started for the purpose,
# and both are about the OUTPUT, not the exit code: what a person reads when the
# run goes red has to be the reason it went red. Last, because the second one
# edits the workspace's copy of the proxy.
SC_FAIL=0
sc() { # $1 = condition already evaluated by the caller as "" / "no", $2 = message
  if [ "$1" = ok ]; then echo "PASS $2"; else echo "FAIL $2"; SC_FAIL=$((SC_FAIL + 1)); fi
}
if [ "${SELFCHECK:-1}" != 0 ]; then
  echo
  echo "=== negative control 1: the proxy dies mid-case-5 ==="
  # Killed at the instant the reported run lost it: THREAD_FORK_MISSING is in
  # the log and case 5 is waiting for THREAD_FORK_KILLED, which will now never
  # come. SIGKILL because a crash is what happened — it leaves .proxy.json
  # behind, and reading that back is part of what the report says.
  rm -f "$L/server/chat.log"
  GONE_PORT=$((PORT + 2))
  start_proxy "$HERE/fake-claude" "$GONE_PORT"
  KILL_TARGET=$PROXY_PID
  ( for _ in $(seq 1 600); do
      if grep -q THREAD_FORK_MISSING "$L/server/chat.log" 2>/dev/null; then kill -9 "$KILL_TARGET" 2>/dev/null; exit 0; fi
      sleep 0.1
    done ) & WATCHER=$!
  RC=0; run_check "$(cat "$L/server/.proxy-port")" --only 5 >"$WS/control-gone.out" 2>&1 || RC=$?
  kill "$WATCHER" 2>/dev/null || true; wait "$WATCHER" 2>/dev/null || true
  stop_proxy
  sed 's/^/    /' "$WS/control-gone.out"
  [ "$RC" = 3 ] && sc ok "control 1: the run reports the proxy, exit 3 (not 1, which would claim an assertion failed)" \
                || sc no "control 1: expected exit 3, got $RC"
  grep -q "PROXY GONE" "$WS/control-gone.out" && sc ok "control 1: and says so in words" || sc no "control 1: no PROXY GONE line in the output"
  # The point of the whole change: no failed assertion about thread forking.
  if grep -q "^FAIL " "$WS/control-gone.out"; then
    sc no "control 1: it still printed a FAIL about the behaviour: $(grep -m1 '^FAIL ' "$WS/control-gone.out")"
  else
    sc ok "control 1: and prints no FAIL about thread forking — the assertion never ran against anything"
  fi

  echo
  echo "=== negative control 2: the proxy is fine and case 5's subject is broken ==="
  # The mirror. The proxy now records the id the CLI answered with even when it
  # equals the parent's — which is the leak case 5 exists to catch — so the run
  # must go red NAMING the forking, and must not blame the proxy for dying.
  cp "$WS/_lesson-core/server/proxy.js" "$WS/proxy.js.orig"
  sed -i 's|return failForkMissing();|session.cliSessionId = parsed.session_id;|' "$WS/_lesson-core/server/proxy.js"
  ! cmp -s "$WS/proxy.js.orig" "$WS/_lesson-core/server/proxy.js" || { echo "could not break the proxy for control 2 — the sed target moved"; exit 1; }
  rm -f "$L/server/chat.log"
  start_proxy "$HERE/fake-claude" "$((PORT + 3))"
  RC=0; run_check "$(cat "$L/server/.proxy-port")" --only 5 >"$WS/control-broken.out" 2>&1 || RC=$?
  stop_proxy
  cp "$WS/proxy.js.orig" "$WS/_lesson-core/server/proxy.js"
  sed 's/^/    /' "$WS/control-broken.out"
  [ "$RC" = 1 ] && sc ok "control 2: the run fails as a failed check, exit 1" || sc no "control 2: expected exit 1, got $RC"
  grep -q "PROXY GONE" "$WS/control-broken.out" && sc no "control 2: it blamed the proxy, which was up the whole time" \
                                                || sc ok "control 2: and does not blame the proxy, which was up the whole time"
  grep -q "^FAIL 5: and killed the turn that was running in the main session" "$WS/control-broken.out" \
    && sc ok "control 2: it names the behaviour — the proxy did not kill the unforked turn" \
    || sc no "control 2: nothing named the unforked turn the proxy failed to kill"
  grep -q "^FAIL 5: the thread's turn ends" "$WS/control-broken.out" \
    && sc ok "control 2: and names the reply the student would have trusted" \
    || sc no "control 2: nothing named the thread turn's ending"

  echo
  if [ "$SC_FAIL" = 0 ]; then echo "negative controls: both hold"; else echo "negative controls: $SC_FAIL FAILED"; exit 1; fi
fi
