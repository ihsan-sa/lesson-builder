#!/usr/bin/env bash
# The negative control for sweep.cjs. Takes lessons out of a real built site,
# copies them, breaks the copies, and asserts the sweep says the right thing
# about each: clean stays green, an overlap goes red naming the lesson and the
# side rail, a squeezed equation body goes red naming the part, and a lesson
# carrying both at once is labelled as both. That is every label the sweep can
# print about a lesson. Without this the sweep's "41 of 41 ok" is only ever a
# check that stayed quiet.
#
#   SITE=~/.cc/state/lessons/build-head-0f03499 \
#     PHONE_WIDTH_BROWSER=/usr/bin/google-chrome ./sweep-negative.sh
#
# Env: SITE     required; a built site directory (read, never written)
#      LESSON   optional; the lesson cases 1-3 copy, default
#               chemhl/radioactive-decay. It must be one that renders equations
#               — a lesson with none cannot carry an overlap, and case 1 below
#               fails if it has none.
#      LESSON_BOTH  optional; the lesson case 4 copies, default
#               rf/directional-couplers. It must render MORE THAN ONE equation:
#               one equation is either overlapped or collapsed and never both,
#               so a single-equation lesson (the LESSON default is one) cannot
#               reach the third label. Case 4 measures the count and fails if it
#               is 1.
#      PORT     optional; the port the variants are served on in turn
#      KEEP=1   keep the temp workspace
#
# READ-ONLY on the site: every copy and every edit is under a temp directory, so
# this never writes into the build (nor into ~/dev/lessons, which this repo must
# not touch). Served with python3's stdlib static server on loopback rather than
# bin/serve-dist.mjs, which lives in another repo: these are plain files with
# absolute asset paths, so serving the copy from the same relative path is all
# it takes.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
SITE=${SITE:?SITE=<a built site directory> is required}
LESSON=${LESSON:-chemhl/radioactive-decay}
LESSON=${LESSON#/}; LESSON=${LESSON%/}
LESSON_BOTH=${LESSON_BOTH:-rf/directional-couplers}
LESSON_BOTH=${LESSON_BOTH#/}; LESSON_BOTH=${LESSON_BOTH%/}
PORT=${PORT:-5321}

[ -f "$SITE/$LESSON/index.html" ] ||
  { echo "no built lesson at $SITE/$LESSON — pass LESSON=<course>/<slug>"; exit 2; }
[ -f "$SITE/$LESSON_BOTH/index.html" ] ||
  { echo "no built lesson at $SITE/$LESSON_BOTH — pass LESSON_BOTH=<course>/<slug>"; exit 2; }

WS=$(mktemp -d "${TMPDIR:-/tmp}/sweep-negative.XXXX"); echo "workspace: $WS"
SERVER=""
cleanup() {
  [ -n "$SERVER" ] && kill "$SERVER" 2>/dev/null || true
  if [ -n "${KEEP:-}" ]; then echo "kept $WS"; else rm -rf "$WS"; fi
}
trap cleanup EXIT

failed=0
expect() { # <what> <ok?>
  if [ "$2" = 1 ]; then echo "  PASS: $1"; else echo "  FAIL: $1"; failed=$((failed + 1)); fi
}
has() { grep -qF -- "$2" "$1" && echo 1 || echo 0; }

# <variant> [css] [lesson]. The lesson is copied at its own path under the
# variant root, because a built lesson's assets are absolute
# (/course/slug/assets/...). The lesson defaults to $LESSON; case 4 passes
# $LESSON_BOTH instead, and each variant gets its own root either way.
variant() {
  local v=$1 css=${2:-} l=${3:-$LESSON}
  mkdir -p "$WS/$v/$l"
  cp -r "$SITE/$l/." "$WS/$v/$l/"
  # Injected into the built HTML, not into any source: the defect is introduced
  # into a copy of what the reader gets. `!important` because the lesson's own
  # stylesheets are injected by its bundle at runtime, after this tag.
  [ -n "$css" ] && sed -i "s#</head>#<style>$css</style></head>#" "$WS/$v/$l/index.html"
  return 0
}

# <variant> [lesson]. Serves that copy, sweeps the one lesson, writes the run to
# $WS/<variant>.log and returns the sweep's exit code.
sweep() {
  local v=$1 l=${2:-$LESSON} code=0
  python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$WS/$v" >"$WS/serve-$v.log" 2>&1 &
  SERVER=$!
  for _ in $(seq 1 60); do
    curl -sf -o /dev/null "http://127.0.0.1:$PORT/$l/" && break
    sleep 0.5
  done
  SITE_URL="http://127.0.0.1:$PORT/" LESSON_PATHS="/$l/" \
    node "$HERE/sweep.cjs" >"$WS/$v.log" 2>&1 || code=$?
  kill "$SERVER" 2>/dev/null || true; wait "$SERVER" 2>/dev/null || true; SERVER=""
  echo "$code"
}

# 1. Untouched. Cases 2 and 3 mean nothing unless the same lesson, served
# the same way, is green — and unless it rendered equations at all, since a
# lesson with none cannot carry an overlap for case 2 to catch.
variant clean
clean_code=$(sweep clean)
sed -n '4,99p' "$WS/clean.log"
expect "clean: the untouched lesson passes" "$([ "$clean_code" = 0 ] && echo 1 || echo 0)"
expect "clean: it rendered equations to measure" \
  "$(grep -qE '[1-9][0-9]* equations' "$WS/clean.log" && echo 1 || echo 0)"
expect "clean: no control or caption on an equation" \
  "$(has "$WS/clean.log" "0 lessons with a control or caption on the equation")"

# 2. A control put back on top of the equation: the defect the owner reported.
# Pinned over the whole block rather than at the gutter it used to sit in, so
# the control lands on the formula wherever the formula is in the block.
variant overlap '.eq-block{position:relative!important}.eq-block .eq-side{position:absolute!important;top:0!important;right:0!important;bottom:0!important;left:0!important;max-width:none!important}'
overlap_code=$(sweep overlap)
sed -n '4,99p' "$WS/overlap.log"
expect "overlap: the sweep goes red" "$([ "$overlap_code" = 1 ] && echo 1 || echo 0)"
expect "overlap: it names the lesson" "$(has "$WS/overlap.log" "OVERLAP")"
expect "overlap: it names the lesson path" "$(has "$WS/overlap.log" "/$LESSON/")"
expect "overlap: it names the part that covered the equation" \
  "$(has "$WS/overlap.log" "side rail covers")"
expect "overlap: it counts the lesson" \
  "$(has "$WS/overlap.log" "1 lessons with a control or caption on the equation")"
# The point of the whole track: this is caught by the overlap measurement, not
# by the collapse one that was already there. Nothing is collapsed here.
expect "overlap: nothing is collapsed — the overlap is what caught it" \
  "$(has "$WS/overlap.log" "0 with a collapsed part")"

# 3. The collapse half, on its own copy: the equation body squeezed to nothing,
# which is the defect sweep.cjs measured before this track and must still catch.
variant squeezed '.eq-block .eq-body{max-width:0!important;overflow:hidden!important}'
squeezed_code=$(sweep squeezed)
sed -n '4,99p' "$WS/squeezed.log"
expect "squeezed: the sweep goes red" "$([ "$squeezed_code" = 1 ] && echo 1 || echo 0)"
expect "squeezed: it names the collapse" "$(has "$WS/squeezed.log" "COLLAPSED")"
expect "squeezed: it names the part" "$(has "$WS/squeezed.log" "equation[0]")"
expect "squeezed: it counts the lesson" "$(has "$WS/squeezed.log" "1 with a collapsed part")"
# An equation squeezed to nothing has no ink for a control to land on, so the
# overlap measurement reports it as unseeable rather than as clean.
expect "squeezed: the equation is reported as having no math on screen" \
  "$(has "$WS/squeezed.log" "with no math on screen")"

# 4. Both defects in ONE lesson: the third label the sweep can print
# (`OVERLAP+COLLAPSED`), and the one the three cases above cannot reach between
# them. An equation squeezed to nothing has no ink for a control to land on, so
# a single equation is either overlapped or collapsed and never both — which is
# why this case needs a lesson that renders more than one, and uses
# $LESSON_BOTH rather than the single-equation $LESSON. Its own copies, not
# state left by the cases above.
#
# 4a. $LESSON_BOTH untouched, so 4b's two defects are known to come from the
# injection and not from the lesson, and so the "more than one equation"
# precondition is measured rather than assumed.
variant both-clean "" "$LESSON_BOTH"
both_clean_code=$(sweep both-clean "$LESSON_BOTH")
sed -n '4,99p' "$WS/both-clean.log"
expect "both/clean: the untouched lesson passes" \
  "$([ "$both_clean_code" = 0 ] && echo 1 || echo 0)"
both_eqs=$(sed -n 's/^1 lessons measured, \([0-9][0-9]*\) equations.*/\1/p' "$WS/both-clean.log")
expect "both/clean: $LESSON_BOTH renders more than one equation (${both_eqs:-no count}), which this case needs" \
  "$([ "${both_eqs:-0}" -gt 1 ] && echo 1 || echo 0)"

# 4b. Case 2's injection over every block, and case 3's over every block BUT THE
# FIRST — `x ~ x` is every equation block that has an equation block before it.
# So the first equation keeps its ink and carries the overlap, the rest are
# squeezed to nothing and carry the collapse, and the one lesson has both at
# once. `display:block` is the one thing added to case 3's rule: `.eq-body` is
# an inline span in a classic lesson, and max-width does nothing to one of
# those, so without it the case would silently collapse nothing on any
# LESSON_BOTH outside the two shell lessons.
variant both '.eq-block{position:relative!important}.eq-block .eq-side{position:absolute!important;top:0!important;right:0!important;bottom:0!important;left:0!important;max-width:none!important}.eq-block[data-latex] ~ .eq-block[data-latex] .eq-body{display:block!important;max-width:0!important;overflow:hidden!important}' "$LESSON_BOTH"
both_code=$(sweep both "$LESSON_BOTH")
sed -n '4,99p' "$WS/both.log"
expect "both: the sweep goes red" "$([ "$both_code" = 1 ] && echo 1 || echo 0)"
# The assertion this case exists for. It is the whole label, not a substring of
# it: "OVERLAP" alone and "COLLAPSED" alone both match a row labelled with only
# one of the two, so only the joined label tells them apart.
expect "both: the row is labelled OVERLAP+COLLAPSED, not one or the other" \
  "$(has "$WS/both.log" "OVERLAP+COLLAPSED")"
expect "both: it names the equation the control landed on" \
  "$(has "$WS/both.log" "eq0 side rail covers")"
expect "both: it names the collapsed part, which is a different equation" \
  "$(has "$WS/both.log" "equation[1]")"
expect "both: it counts the one lesson under both defects at once" \
  "$(has "$WS/both.log" "1 lessons with a control or caption on the equation, 1 with a collapsed part")"

echo
if [ "$failed" -eq 0 ]; then echo "sweep-negative: all cases passed"; else echo "sweep-negative: $failed failed"; fi
exit $((failed > 0 ? 1 : 0))
