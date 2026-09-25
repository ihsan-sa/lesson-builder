#!/usr/bin/env bash
# A workspace's _lesson-core never lags the skill: scripts/core-refresh.sh refreshes a stale one,
# proves it with the smoke test, and rolls a failed refresh back. Each case builds its own
# workspace. See README.md for the case table.
#   KEEP=1  keep the temp root for inspection
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd); SKILL=$(cd "$HERE/../.." && pwd); B="$SKILL/references/bootstrap"
T=$(mktemp -d "${TMPDIR:-/tmp}/core-refresh-ws.XXXX"); echo "temp root: $T"
cleanup() { if [ -n "${KEEP:-}" ]; then echo "kept $T"; else rm -rf "$T"; fi; }
trap cleanup EXIT
PASS=0; FAIL=0
ok()  { echo "  ✓ $*"; PASS=$((PASS + 1)); }
bad() { echo "  ✗ $*"; FAIL=$((FAIL + 1)); }
check() { if eval "$2"; then ok "$1"; else bad "$1"; fi; }

# A workspace whose core was installed from the payload and then fell behind it: the tutor's
# default model is the older Opus 5 (the failure this exists for) and a shipped file is gone. It
# also carries what the refresh must leave alone: a file of its own inside _lesson-core, a
# marker in node_modules, and an agent of its own in the registry.
stale_ws() {
  local ws=$1
  mkdir -p "$ws/.claude/agents"
  cp -r "$B/_lesson-core" "$ws/_lesson-core"
  (cd "$ws/_lesson-core" && npm install --silent --prefer-offline --no-audit --no-fund) || return 1
  sed -i 's/{ model: "claude-opus-5-5",\( *\)label: "Opus 5.5",   key: "u", default: true }/{ model: "claude-opus-5-5",\1label: "Opus 5.5",   key: "u" }/; s/{ model: "claude-opus-5",\( *\)label: "Opus 5",     key: "o" }/{ model: "claude-opus-5",\1label: "Opus 5",     key: "o", default: true }/' \
    "$ws/_lesson-core/constants/models.js"
  grep -q '"claude-opus-5",.*default: true' "$ws/_lesson-core/constants/models.js" || { echo "fixture: models.js edit did not apply"; return 1; }
  rm "$ws/_lesson-core/chat/turnStream.js"
  mkdir -p "$ws/_lesson-core/local"; echo "export const MINE = 1;" >"$ws/_lesson-core/local/mine.js"
  echo "workspace marker" >"$ws/_lesson-core/node_modules/.ws-marker"
  echo "# the workspace's own agent" >"$ws/.claude/agents/own-agent.md"
}
leftovers() { find "$1" -maxdepth 1 \( -name '.core-refresh-backup.*' -o -name '.core-smoke.*' \) | wc -l; }

echo "== 1. a stale workspace is refreshed and passes the smoke test"
WS="$T/stale"; mkdir -p "$WS"; stale_ws "$WS" || { echo "fixture setup failed"; exit 1; }
out=$("$SKILL/scripts/core-refresh.sh" check "$WS" 2>&1); rc=$?
check "check reports drift (exit 1)" '[ "$rc" = 1 ]'
check "check names the stale model file" 'grep -q "differs: _lesson-core/constants/models.js" <<<"$out"'
check "check names the missing shipped file" 'grep -q "missing: _lesson-core/chat/turnStream.js" <<<"$out"'
check "check does not count the workspace's own file as drift" '! grep -q "local/mine.js" <<<"$out"'
out=$("$SKILL/scripts/core-refresh.sh" refresh "$WS" 2>&1); rc=$?
echo "$out" | sed 's/^/    | /'
check "refresh exits 0" '[ "$rc" = 0 ]'
check "refresh says the smoke test passed" 'grep -q "refreshed to skill .* and the smoke test passed" <<<"$out"'
check "the tutor default is the skill's model again" 'cmp -s "$B/_lesson-core/constants/models.js" "$WS/_lesson-core/constants/models.js"'
check "the missing shipped file is back" 'cmp -s "$B/_lesson-core/chat/turnStream.js" "$WS/_lesson-core/chat/turnStream.js"'
check "the workspace's own core file survives" '[ "$(cat "$WS/_lesson-core/local/mine.js" 2>/dev/null)" = "export const MINE = 1;" ]'
check "node_modules survives" '[ -f "$WS/_lesson-core/node_modules/.ws-marker" ] && [ -d "$WS/_lesson-core/node_modules/express" ]'
agents_in() { local f; for f in "$SKILL"/agents/*.md; do cmp -s "$f" "$1/.claude/agents/$(basename "$f")" || return 1; done; }
check "skill agents are in the registry" 'agents_in "$WS"'
check "the workspace's own agent survives" '[ -f "$WS/.claude/agents/own-agent.md" ]'
check "no backup or smoke dir is left in the workspace" '[ "$(leftovers "$WS")" = 0 ]'
out=$("$SKILL/scripts/core-refresh.sh" check "$WS" 2>&1); rc=$?
check "check finds no drift afterwards (exit 0)" '[ "$rc" = 0 ]'
out=$("$SKILL/scripts/core-refresh.sh" refresh --quiet "$WS" 2>&1); rc=$?
check "a current core is left alone: refresh --quiet exits 0 and prints nothing" '[ "$rc" = 0 ] && [ -z "$out" ]'

echo "== 2. a refresh whose smoke test fails is rolled back"
# A skill whose payload core does not compile: the copy and the npm install succeed, so only the
# smoke test can catch it.
BROKEN="$T/broken-skill"; mkdir -p "$BROKEN"
cp -r "$SKILL/scripts" "$SKILL/references" "$SKILL/agents" "$BROKEN/"
echo "export const = broken;" >>"$BROKEN/references/bootstrap/_lesson-core/index.js"
WS="$T/rollback"; mkdir -p "$WS"; stale_ws "$WS" || { echo "fixture setup failed"; exit 1; }
cp -a "$WS/_lesson-core" "$T/before-core"
out=$("$BROKEN/scripts/core-refresh.sh" refresh "$WS" 2>&1); rc=$?
echo "$out" | sed 's/^/    | /'
check "refresh exits 3" '[ "$rc" = 3 ]'
check "it says loudly that it rolled back" 'grep -q "CORE REFRESH ROLLED BACK: the smoke test failed" <<<"$out"'
check "the smoke failure is named" 'grep -q "smoke FAIL: vite build" <<<"$out"'
check "the previous core is back byte for byte, node_modules and own files included" 'diff -r "$T/before-core" "$WS/_lesson-core" >/dev/null'
check "no backup or smoke dir is left in the workspace" '[ "$(leftovers "$WS")" = 0 ]'

echo "== 3. the smoke test on its own passes a good core and fails a broken one"
WS="$T/smoke"; mkdir -p "$WS"; cp -r "$B/_lesson-core" "$WS/_lesson-core"
(cd "$WS/_lesson-core" && npm install --silent --prefer-offline --no-audit --no-fund) || { echo "fixture setup failed"; exit 1; }
out=$("$SKILL/scripts/core-refresh.sh" smoke "$WS" 2>&1); rc=$?
check "smoke passes on the payload's own core" '[ "$rc" = 0 ]'
echo "export const = broken;" >>"$WS/_lesson-core/index.js"
out=$("$SKILL/scripts/core-refresh.sh" smoke "$WS" 2>&1); rc=$?
check "smoke fails (exit 1) once the core is broken" '[ "$rc" = 1 ]'

echo "$PASS passed, $FAIL failed"
[ "$FAIL" = 0 ]
