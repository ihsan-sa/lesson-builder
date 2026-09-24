#!/usr/bin/env bash
# core-refresh.sh — keep a workspace's _lesson-core (tutor model included) at what this skill ships.
#
#   core-refresh.sh check   [<workspace_root>]   report drift; change nothing
#   core-refresh.sh refresh [<workspace_root>]   refresh a drifted core, smoke it, roll back if it fails
#   core-refresh.sh smoke   [<workspace_root>]   run the smoke test against the core as it stands
#   --quiet (after the subcommand) prints nothing when the core is already current
#
# <workspace_root> defaults to the workspace this skill is installed in (<ws>/.claude/skills/<name>).
#
# Drift is any file under references/bootstrap/_lesson-core/ that is missing from the workspace's
# _lesson-core/ or differs from it byte for byte. Files the skill does not ship (a workspace's own
# additions), node_modules/ and package-lock.json are not drift and are never touched. The agent
# registry is compared too: a skill agent missing from <ws>/.claude/agents/ or differing from it.
#
# `refresh` is not a question for anyone (references/bootstrap.md § Core-version check). On drift it
# copies the whole _lesson-core/ aside, copies every shipped file over its workspace copy (a local
# edit to a shipped file is overwritten; a file the skill does not ship survives), runs
# `npm install` there, checks there is no drift left, and runs the smoke test. The smoke test
# failing, or any step before it, puts the copy back exactly as it was and exits 3 with a
# CORE REFRESH ROLLED BACK banner on stderr — the session reports that to the user at once. It
# also copies missing or changed skill agents into .claude/agents/; a registry file whose name the
# skill does not ship is listed, not deleted (bootstrap.md § Core-version check says which to delete).
#
# The smoke test scaffolds the lesson template into a throwaway course inside the workspace
# (<ws>/.core-smoke.XXXX/, removed afterwards) with a body that imports all of @core, installs its
# dependencies, builds it with vite (every @core module resolves and compiles), starts its proxy through the lesson's server shim
# and asks it for /sessions. No model call. Needs node, npm and curl; a warm npm cache or network.
#
# Exit: 0 current (or refreshed and smoke passed) · 1 drift found (check) or smoke failed (smoke)
#       2 cannot compare (no payload, no workspace) · 3 refresh failed and was rolled back
set -uo pipefail

SKILL=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
PAY="$SKILL/references/bootstrap"
AGENT_SRCS=("$SKILL/agents" "$PAY/workspace-root/.claude/agents")

usage() { sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 2; }
cmd=${1:-}; shift || true
QUIET=0; WS=""
for a in "$@"; do
  case "$a" in --quiet) QUIET=1 ;; -*) usage ;; *) WS=$a ;; esac
done
case "$cmd" in check|refresh|smoke) ;; *) usage ;; esac
if [ -z "$WS" ]; then
  case "$SKILL" in */.claude/skills/*) WS=${SKILL%/.claude/skills/*} ;;
    *) echo "core-refresh: name the workspace root — this skill is not installed under one" >&2; exit 2 ;; esac
fi
[ -d "$WS" ] || { echo "core-refresh: no workspace at $WS" >&2; exit 2; }
WS=$(cd "$WS" && pwd)
CORE="$WS/_lesson-core"
[ -f "$PAY/_lesson-core/index.js" ] || { echo "core-refresh: no skill payload under $PAY" >&2; exit 2; }

say() { [ "$QUIET" = 1 ] || echo "$@"; return 0; }
rev() { git -C "$SKILL" rev-parse --short HEAD 2>/dev/null || echo "?"; }

# Shipped core files that are missing or differ, one "missing|differs: <path>" line each.
core_drift() {
  local f rel
  [ -d "$CORE" ] || { echo "missing: _lesson-core/ (the bootstrap has not run)"; return; }
  (cd "$PAY/_lesson-core" && find . -type f | sed 's|^\./||' | sort) | while IFS= read -r rel; do
    f="$CORE/$rel"
    if [ ! -f "$f" ]; then echo "missing: _lesson-core/$rel"
    elif ! cmp -s "$PAY/_lesson-core/$rel" "$f"; then echo "differs: _lesson-core/$rel"; fi
  done
}

# Skill agents missing from or differing in the registry, then registry files the skill lacks.
agent_drift() {
  local d f b
  for d in "${AGENT_SRCS[@]}"; do
    for f in "$d"/*.md; do
      [ -f "$f" ] || continue; b=$(basename "$f")
      if [ ! -f "$WS/.claude/agents/$b" ]; then echo "missing: .claude/agents/$b"
      elif ! cmp -s "$f" "$WS/.claude/agents/$b"; then echo "differs: .claude/agents/$b"; fi
    done
  done
  for f in "$WS"/.claude/agents/*.md; do
    [ -f "$f" ] || continue; b=$(basename "$f")
    [ -f "$SKILL/agents/$b" ] || [ -f "$PAY/workspace-root/.claude/agents/$b" ] \
      || echo "not in the skill: .claude/agents/$b"
  done
}

# ---------------------------------------------------------------------------------------- smoke
smoke() {
  local tmp L port code pp="" rc=0 log
  tmp=$(mktemp -d "$WS/.core-smoke.XXXX") || return 1
  L="$tmp/claude_lessons/smoke"; log="$tmp/smoke.log"
  fail() { echo "  smoke FAIL: $*"; [ -f "$log" ] && tail -20 "$log" | sed 's/^/    /'; rc=1; }
  (
    mkdir -p "$L" && cp -r "$PAY/lesson-template/." "$L/" && mv "$L/src/__SLUG_SNAKE__.jsx" "$L/src/smoke.jsx" &&
    sed -i 's/__SLUG_SNAKE__/smoke/g; s/__SLUG__/smoke/g; s/__COURSE_CODE__/SMOKE/g; s/__LESSON_TITLE__/Core smoke/g' \
      "$L/package.json" "$L/src/main.jsx" "$L/index.html" "$L/CLAUDE.md"
    # The template's placeholder body imports nothing from @core, so building it would prove
    # nothing about the core. This body pulls in every export index.js has.
    printf '%s\n' 'import * as core from "@core";' \
      'export default function LessonApp() { return <pre>{Object.keys(core).join(" ")}</pre>; }' >"$L/src/smoke.jsx"
  ) >"$log" 2>&1 || fail "could not scaffold the lesson template"
  if [ "$rc" = 0 ]; then
    (cd "$L" && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --prefer-offline --no-audit --no-fund) >"$log" 2>&1 \
      || fail "npm install in the scaffolded lesson"
  fi
  if [ "$rc" = 0 ]; then
    (cd "$L" && npx vite build --logLevel warn) >"$log" 2>&1 && [ -f "$L/dist/index.html" ] \
      && say "  smoke ok: the template lesson builds against this core" \
      || fail "vite build of the template lesson against this core"
  fi
  if [ "$rc" = 0 ]; then
    port=$(node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{const p=s.address().port;s.close(()=>console.log(p))})')
    (cd "$L" && exec env PROXY_PORT="$port" node server/proxy.js) >"$log" 2>&1 &
    pp=$!
    for _ in $(seq 1 60); do [ -f "$L/server/.proxy.json" ] && break; sleep 0.25; done
    port=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).port)' "$L/server/.proxy.json" 2>/dev/null)
    code=$(curl -s -o /dev/null -w '%{http_code}' -H "X-Expect-Lesson-Dir: $L" "http://127.0.0.1:${port:-0}/sessions" 2>/dev/null)
    [ -n "$port" ] && [ "$code" = 200 ] && say "  smoke ok: the lesson's proxy starts from this core and answers /sessions" \
      || fail "the lesson's proxy (port ${port:-none}, GET /sessions → ${code:-no answer})"
    kill "$pp" 2>/dev/null; wait "$pp" 2>/dev/null
  fi
  rm -rf "$tmp"
  return "$rc"
}

# -------------------------------------------------------------------------------------- refresh
sync_agents() {
  local d f b n=0
  mkdir -p "$WS/.claude/agents"
  for d in "${AGENT_SRCS[@]}"; do
    for f in "$d"/*.md; do
      [ -f "$f" ] || continue; b=$(basename "$f")
      cmp -s "$f" "$WS/.claude/agents/$b" || { cp "$f" "$WS/.claude/agents/$b"; n=$((n + 1)); }
    done
  done
  [ "$n" = 0 ] || say "core-refresh: copied $n skill agent(s) into .claude/agents/"
  [ "$QUIET" = 1 ] || agent_drift | grep '^not in the skill' | sed 's/^/  kept, /' >&2 || true
}

BACKUP=""; COMMITTED=0
restore() {
  [ "$COMMITTED" = 1 ] && return
  [ -n "$BACKUP" ] || return
  rm -rf "$CORE"
  if [ -d "$BACKUP/_lesson-core" ]; then mv "$BACKUP/_lesson-core" "$CORE"; fi
  rm -rf "$BACKUP"; BACKUP=""
}
rolled_back() {
  restore
  {
    echo
    echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
    echo "!! CORE REFRESH ROLLED BACK: $1"
    echo "!! $CORE is the previous core again, so it still lags skill $(rev) — the tutor may be"
    echo "!! running an older model or policy. Tell the user now; references/bootstrap.md"
    echo "!! § Core-version check says whether the build can go on."
    echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
  } >&2
  exit 3
}

refresh() {
  local drift
  sync_agents
  drift=$(core_drift)
  if [ -z "$drift" ]; then say "core-refresh: _lesson-core matches skill $(rev)"; return 0; fi
  echo "core-refresh: _lesson-core lags skill $(rev); refreshing:"
  sed 's/^/  /' <<<"$drift"
  BACKUP=$(mktemp -d "$WS/.core-refresh-backup.XXXX") || { echo "core-refresh: cannot make a backup" >&2; exit 2; }
  trap 'restore' EXIT
  trap 'rolled_back "interrupted"' INT TERM
  if [ -d "$CORE" ]; then
    cp -a "$CORE" "$BACKUP/_lesson-core" || rolled_back "could not copy the current core aside"
  fi
  mkdir -p "$CORE" && cp -r "$PAY/_lesson-core/." "$CORE/" || rolled_back "could not copy the payload in"
  (cd "$CORE" && npm install --prefer-offline --no-audit --no-fund) >"$BACKUP/npm.log" 2>&1 \
    || { tail -20 "$BACKUP/npm.log" >&2; rolled_back "npm install in _lesson-core failed"; }
  drift=$(core_drift)
  [ -z "$drift" ] || { echo "$drift" >&2; rolled_back "the core still differs from the payload after the copy"; }
  smoke || rolled_back "the smoke test failed against the refreshed core"
  COMMITTED=1; rm -rf "$BACKUP"; BACKUP=""
  echo "core-refresh: _lesson-core refreshed to skill $(rev) and the smoke test passed"
}

case "$cmd" in
  check)
    drift=$(core_drift; agent_drift | grep -v '^not in the skill')
    if [ -z "$drift" ]; then say "core-refresh: _lesson-core and .claude/agents match skill $(rev)"; exit 0; fi
    echo "core-refresh: workspace lags skill $(rev) — \`core-refresh.sh refresh\` brings it up to date:"
    sed 's/^/  /' <<<"$drift"
    exit 1 ;;
  smoke)
    [ -f "$CORE/index.js" ] || { echo "core-refresh: no _lesson-core in $WS" >&2; exit 2; }
    smoke && { echo "core-refresh: smoke test passed"; exit 0; }
    echo "core-refresh: smoke test FAILED" >&2; exit 1 ;;
  refresh) refresh ;;
esac
