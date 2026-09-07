#!/usr/bin/env bash
# Phone-width geometry evidence. Bootstraps a throwaway workspace per
# references/bootstrap.md, scaffolds TWO lessons from the template — one that
# mounts LessonShell and one in the pre-shell shape — builds each with
# `vite build`, serves the built bundles with `vite preview`, and drives
# check.cjs against both at 390x844 and 1440x900. See README.md.
#
# Built rather than served from the dev server: the overlap is what a reader
# gets on the live site, and that is dist/.
#
#   PHONE_WIDTH_BROWSER=<chrome bin>  optional; else Playwright's own Chromium
#   PORT=<n>                          optional; the shell lesson's preview port
#                                     (default 5297). The classic lesson takes
#                                     the next port up.
#   KEEP=1                            keep the temp workspace for inspection
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
SKILL=$(cd "$HERE/../.." && pwd)
B="$SKILL/references/bootstrap"
SHELL_PORT="${PORT:-5297}"
CLASSIC_PORT=$((SHELL_PORT + 1))

WS=$(mktemp -d "${TMPDIR:-/tmp}/phone-width-ws.XXXX"); echo "workspace: $WS"
cleanup() {
  # `npx vite preview` runs Vite as a grandchild, so the shell's job pid is
  # npm's and killing it leaves the server holding the port with a cwd this
  # trap is about to delete. Clear by port, the same belt as
  # tests/katex-fallback: Vite writes no identity file, and both ports are ones
  # this fixture owns exclusively (--strictPort).
  fuser -k -TERM "${SHELL_PORT}/tcp" "${CLASSIC_PORT}/tcp" 2>/dev/null || true
  if [ -n "${KEEP:-}" ]; then echo "kept $WS"; else rm -rf "$WS"; fi
}
trap cleanup EXIT

cp -r "$B/_lesson-core" "$WS/_lesson-core"; (cd "$WS/_lesson-core" && npm install --prefer-offline --silent)
cp "$B/workspace-root/gitignore.template" "$WS/.gitignore"
cp "$B/workspace-root/env.local.example" "$WS/.env.local"

# <slug> <snake> <title> <demo body>. Scaffolds the lesson, installs it and
# builds it; the template's devDeps include playwright, whose browser download
# this fixture never needs (it drives the system Chrome, or one already
# installed).
scaffold_and_build() {
  local slug=$1 snake=$2 title=$3 body=$4
  local L="$WS/course/claude_lessons/$slug"
  mkdir -p "$L"; cp -r "$B/lesson-template/." "$L/"
  mv "$L/src/__SLUG_SNAKE__.jsx" "$L/src/$snake.jsx"
  sed -i "s/__SLUG_SNAKE__/$snake/g; s/__SLUG__/$slug/g; s/__COURSE_CODE__/DEMO 101/g; s/__LESSON_TITLE__/$title/g" \
    "$L/package.json" "$L/src/main.jsx" "$L/CLAUDE.md" "$L/index.html"
  cp "$HERE/lesson/$body" "$L/src/$snake.jsx"
  (cd "$L" && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --prefer-offline --silent \
     && npx vite build >"$WS/build-$slug.log" 2>&1) \
    || { echo "build $slug failed"; cat "$WS/build-$slug.log"; exit 1; }
}

# <lesson dir> <port>. `vite preview` serves that lesson's dist/ and nothing else.
serve() {
  local L=$1 port=$2
  (cd "$L" && npx vite preview --port "$port" --strictPort >"$WS/preview-$port.log" 2>&1) &
  for _ in $(seq 1 60); do
    curl -sf -o /dev/null "http://localhost:$port/" && return 0
    sleep 0.5
  done
  echo "preview server on $port did not start"; cat "$WS/preview-$port.log"; exit 1
}

scaffold_and_build shell-demo   shell_demo   "Phone Width Demo (shell)"   shell_demo.jsx
scaffold_and_build classic-demo classic_demo "Phone Width Demo (classic)" classic_demo.jsx

serve "$WS/course/claude_lessons/shell-demo" "$SHELL_PORT"
serve "$WS/course/claude_lessons/classic-demo" "$CLASSIC_PORT"

# LESSON_DIR lets check.cjs fall back to a lesson's own playwright install when
# tests/phone-width has not been npm installed.
SHELL_URL="http://localhost:$SHELL_PORT/" \
CLASSIC_URL="http://localhost:$CLASSIC_PORT/" \
LESSON_DIR="$WS/course/claude_lessons/shell-demo" \
  node "$HERE/check.cjs"
