#!/usr/bin/env bash
# The release gate: every fixture under tests/ that needs no model call, no browser and no
# network. One command, so a change that breaks the run record, staging, worktrees, the
# syntax-tree tools, attestation, cancellation, thread isolation, the Phase 3 return boundary,
# branch collisions, the proxy's reader, the lessons' stylesheets, the shell's dark/light switch,
# the built bundle's tutor gate, or the shell staying out of a classic lesson's bundle cannot land.
# `cc-land` runs this as a gate on every PR (it treats an executable tests/check.sh as one), and a
# person runs it the same way.
#
#   tests/check.sh                 every deterministic fixture, in parallel
#   tests/check.sh run-manifest …  only the named ones, for iterating on one
#
# CHECK_JOBS caps how many run at once (default: the cores there are). CHECK_TIMEOUT is the
# seconds one fixture may take before it is killed and counted failed (default 600).
#
# Environment: node and git, from a clean checkout. Nothing here calls a model or opens a browser.
# Six fixtures do need packages: `ast-inventory` and `attestation` install `@babel/parser`,
# `cancellation` and `thread-actors` copy `_lesson-core` and install its express/cors, and
# `hosted-build` and `shell-reach` each scaffold a lesson and install the template's own devDeps
# (vite, react, the babel pair; Playwright's browser download is skipped) because they assert on
# real `vite build` output.
# All six use `npm install --prefer-offline`, so a WARM npm cache serves them without asking the
# registry — that is the one dependency this gate has beyond node and git, and on a cold cache those
# six fetch and the rest still pass. `npm ci --prefer-offline` once on a new box is what warms it.
# Every fixture builds its own temp state and cleans it up; the checkout is not written to.
# The run points TMPDIR at one directory of its own, so after the last fixture finishes any
# process still sitting in a directory under it is a proxy or dev server that fixture started
# and did not stop. That is a failure of this gate, reported with the pid and the command line
# and then ended — a leaked server holds memory for hours with its cwd already deleted.
#
# Fixtures that DO need a browser or a real model are excluded by name below, each printed with
# the exact command that runs it — an excluded fixture is listed, never silently skipped.
#
# Exit code 0 only when every fixture passes AND none left a server behind. The last line reports
# "<n> passed, <n> failed", which is what cc-land reads besides the exit code; a leak counts one
# failed on its own, over and above the fixtures.
set -uo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
SKILL=$(cd "$HERE/.." && pwd)
cd "$SKILL" || exit 1

# name|command. The command runs from the skill root. Explicit rather than globbed: a fixture
# left out of this table is visible here, and each has its own entrypoint and preconditions.
FIXTURES=(
  "run-manifest|node tests/run-manifest/check.cjs"
  "stage-promote|node tests/stage-promote/check.cjs"
  "worktree-per-run|node tests/worktree-per-run/check.cjs"
  "ast-inventory|node tests/ast-inventory/check.cjs"
  "attestation|node tests/attestation/check.cjs"
  "agent-return|node tests/agent-return/check.cjs"
  "branch-collision|node tests/branch-collision/check.cjs"
  "sse-byte-split|node tests/sse-byte-split/check.cjs"
  "css-vars-defined|node tests/css-vars-defined/check.cjs"
  "shell-theme|node tests/shell-theme/check.cjs"
  "hosted-build|tests/hosted-build/run.sh"
  "shell-reach|tests/shell-reach/run.sh"
  "cancellation|tests/cancellation/run.sh"
  "thread-actors|tests/thread-actors/run.sh"
)

# name|why it cannot run here|the exact command that runs it
EXCLUDED=(
  "safe-render|needs a Chromium (the sanitiser is tested in a real DOM)|cd tests/safe-render && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install && SAFE_RENDER_BROWSER=/usr/bin/google-chrome node run.cjs"
  "katex-fallback|needs a Chromium and a Vite dev server|cd tests/katex-fallback && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install && KATEX_FALLBACK_BROWSER=/usr/bin/google-chrome ./run.sh"
  "resume-metadata|needs a Chromium and a Vite dev server|cd tests/resume-metadata && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install && RESUME_METADATA_BROWSER=/usr/bin/google-chrome ./run.sh"
  "phone-width|needs a Chromium, three vite builds and the KaTeX CDN|cd tests/phone-width && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install && PHONE_WIDTH_BROWSER=/usr/bin/google-chrome ./run.sh"
  "phone-width --sweep|the fixture measures its own scaffolded lessons; this measures overlap and collapse over every lesson of a real built site|serve a build (bin/serve-dist.mjs, which is the LESSONS repo's script, not this repo's: --port 5301 --dist <site> --quiet), then PHONE_WIDTH_BROWSER=/usr/bin/google-chrome SITE_URL=http://127.0.0.1:5301/ node tests/phone-width/sweep.cjs"
  "phone-width --sweep-negative|the sweep's negative control: it needs a built site to copy lessons out of, and a Chromium|SITE=<a built site> PHONE_WIDTH_BROWSER=/usr/bin/google-chrome tests/phone-width/sweep-negative.sh"
  "shell-theme --browser|the gate checks the sheet and the component as text; this one presses the switch in a built lesson|cd tests/shell-theme && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install && SHELL_THEME_BROWSER=/usr/bin/google-chrome ./run.sh"
  "cancellation --real|the fake CLI covers it here; this one spends tokens on the real CLI|cd tests/cancellation && REAL_CLAUDE=1 ./run.sh"
  "thread-actors --real|the fake CLI covers it here; this one spends tokens on the real CLI|cd tests/thread-actors && REAL_CLAUDE=1 ./run.sh"
  "teaching evals|graded by a model, per evals/teaching/rubric.md|see evals/teaching/README.md"
)

# The two fixtures that start real proxies run as one chain rather than side by side. They are the
# only two that boot servers, bind ports and kill process trees, and they are the two whose
# assertions are about how long a process lives — so they get the box to themselves in turn. This
# is insurance, not the fix for anything: `thread-actors` really was dying here with its proxy gone
# (ECONNREFUSED on the request after a cancel), and the cause was in the proxy — `kill(-pid)` on a
# group it no longer led — fixed in `_lesson-core/server/proxy.js` § signalTree. The chain costs
# the gate nothing: it is shorter than `attestation`, which is the critical path on its own.
SERIAL=(cancellation thread-actors)

# A free port from the kernel rather than a fixed one: cc-land gates several PRs at once
# (CC_LAND_PREPARE), and two gates sharing 3901 would each kill the other's proxy.
free_port() {
  node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{const p=s.address().port;s.close(()=>console.log(p))})' 2>/dev/null
}

# A fixture that hangs must fail rather than hold the gate open until cc-land calls it dead
# (GATE_IDLE is an hour). Generous, because the budget is about a quiet box and this is not.
PER_FIXTURE_TIMEOUT="${CHECK_TIMEOUT:-600}"

want=("$@")
selected=()
for f in "${FIXTURES[@]}"; do
  name=${f%%|*}
  if [ ${#want[@]} -eq 0 ]; then
    selected+=("$f")
  else
    for w in "${want[@]}"; do [ "$w" = "$name" ] && selected+=("$f"); done
  fi
done
if [ ${#selected[@]} -eq 0 ]; then
  echo "no such fixture: ${want[*]}"
  echo "known: $(for f in "${FIXTURES[@]}"; do printf '%s ' "${f%%|*}"; done)"
  echo "0 passed, 1 failed"
  exit 2
fi

# One temp root per run, exported as TMPDIR. Every fixture makes its workspace with
# `mktemp -d "${TMPDIR:-/tmp}/<name>-ws.XXXX"`, so they all land inside it — which is what lets
# the leak check below be exact rather than a match on fixture names: a process whose cwd is
# under this root can only have been started by this run. Per run, not per box, so two gates
# going at once never see each other's (cc-land prepares several PRs at a time).
RUN_TMP=$(mktemp -d "${TMPDIR:-/tmp}/lesson-gate.XXXXXX")
export TMPDIR="$RUN_TMP"
LOGS="$RUN_TMP/logs"; mkdir -p "$LOGS"
trap 'rm -rf "$RUN_TMP"' EXIT

# Pids whose working directory is inside this run's temp root. readlink still answers for a
# directory that has been deleted (it appends " (deleted)"), which is the usual state of a leak:
# the fixture removed its workspace on the way out and the server it forgot is still in it.
leaked_servers() {
  local proc pid cwd
  for proc in /proc/[0-9]*; do
    pid=${proc#/proc/}
    cwd=$(readlink "$proc/cwd" 2>/dev/null) || continue
    case "$cwd" in "$RUN_TMP"/*) echo "$pid" ;; esac
  done
}

echo "gate: ${#selected[@]} deterministic fixtures, node $(node -v), $(git --version)"

run_one() {
  local name=$1 cmd=$2 s e rc
  s=$(date +%s)
  PORT=$(free_port) KEEP= timeout "$PER_FIXTURE_TIMEOUT" $cmd >"$LOGS/$name.log" 2>&1
  rc=$?
  echo "$rc" >"$LOGS/$name.rc"
  e=$(date +%s)
  [ "$rc" -eq 124 ] && echo "  (killed: no result in ${PER_FIXTURE_TIMEOUT}s)" >>"$LOGS/$name.log"
  printf '  %s %-18s %ss\n' "$([ "$rc" -eq 0 ] && echo '✓' || echo '✗')" "$name" "$((e - s))"
}
is_serial() { for n in "${SERIAL[@]}"; do [ "$n" = "$1" ] && return 0; done; return 1; }

# Parallel, capped at the cores there are: serially these are minutes, and every fixture builds
# its own temp state so none can see another's. The SERIAL ones are one background chain instead
# — beside the batch, never beside each other.
JOBS="${CHECK_JOBS:-$(nproc 2>/dev/null || echo 4)}"
started=$(date +%s)
running=0
chain=()
for f in "${selected[@]}"; do
  name=${f%%|*}
  if is_serial "$name"; then chain+=("$f"); fi
done
if [ ${#chain[@]} -gt 0 ]; then
  ( for f in "${chain[@]}"; do run_one "${f%%|*}" "${f#*|}"; done ) &
  running=$((running + 1))
fi
for f in "${selected[@]}"; do
  name=${f%%|*}; cmd=${f#*|}
  is_serial "$name" && continue
  while [ "$running" -ge "$JOBS" ]; do wait -n 2>/dev/null || true; running=$((running - 1)); done
  run_one "$name" "$cmd" &
  running=$((running + 1))
done
wait
# Read straight after the last fixture returned and before anything is cleaned up: every fixture
# has finished by here, so there is no live one to mistake for a leak, and the record of one that
# leaked is still on /proc.
leaked=$(leaked_servers)

# Reported in table order, not in the order they happened to finish, so two runs read the same.
passed=0; failed=0; failures=()
for f in "${selected[@]}"; do
  name=${f%%|*}
  rc=$(cat "$LOGS/$name.rc" 2>/dev/null || echo 1)
  if [ "$rc" -eq 0 ]; then passed=$((passed + 1)); else failed=$((failed + 1)); failures+=("$name"); fi
done

for name in "${failures[@]}"; do
  echo
  echo "=== $name failed (exit $(cat "$LOGS/$name.rc" 2>/dev/null || echo '?')) ==="
  tail -40 "$LOGS/$name.log" 2>/dev/null
done

# A fixture that boots a proxy or a dev server must stop it. One that does not leaves it orphaned
# on the box, holding memory, with its cwd deleted along with the workspace that made it — and it
# never recovers, so the count climbs run after run. Red, with the pid and the command line so the
# fixture is obvious, and then ended: the box should not carry it either way.
if [ -n "$leaked" ]; then
  failed=$((failed + 1))
  echo
  echo "=== leaked servers: $(echo "$leaked" | wc -w) process(es) outlived the fixture that started them ==="
  for pid in $leaked; do
    printf '  pid %-8s %s\n' "$pid" "$(readlink "/proc/$pid/cwd" 2>/dev/null)"
    printf '  %-12s %s\n' "" "$(tr '\0' ' ' <"/proc/$pid/cmdline" 2>/dev/null)"
  done
  # shellcheck disable=SC2086
  kill $leaked 2>/dev/null || true
  echo "  ended them; the gate stays red — the fixture that started one has to stop it."
fi

echo
echo "not in this gate — run each by hand:"
for e in "${EXCLUDED[@]}"; do
  n=${e%%|*}; rest=${e#*|}; why=${rest%%|*}; cmd=${rest#*|}
  printf '  %-28s %s\n' "$n" "$why"
  printf '  %-28s %s\n' "" "$cmd"
done

echo
echo "$passed passed, $failed failed in $(($(date +%s) - started))s"
[ "$failed" -eq 0 ] || exit 1
