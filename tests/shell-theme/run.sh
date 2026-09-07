#!/usr/bin/env bash
# Dark/light evidence in a real browser. Bootstraps a throwaway workspace per
# references/bootstrap.md, scaffolds ONE lesson from the template with this
# directory's demo body, builds it with `VITE_TUTOR=1 npx vite build` — the
# pop-out button lives behind the tutor gate — serves the built bundle with
# `vite preview`, and drives browser.cjs against it. See README.md.
#
# Built rather than served from the dev server: what the owner presses is the
# built page, and that is dist/.
#
#   SHELL_THEME_BROWSER=<chrome bin>  optional; else Playwright's own Chromium
#   PORT=<n>                          optional preview port (default 5299)
#   KEEP=1                            keep the temp workspace and the screenshots
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
SKILL=$(cd "$HERE/../.." && pwd)
B="$SKILL/references/bootstrap"
PREVIEW_PORT="${PORT:-5299}"

WS=$(mktemp -d "${TMPDIR:-/tmp}/shell-theme-ws.XXXX"); echo "workspace: $WS"
cleanup() {
  # `npx vite preview` runs Vite as a grandchild, so killing the shell's job pid
  # leaves the server holding the port with a cwd this trap is about to delete.
  # Clear by port, the same belt as tests/phone-width: this fixture owns it
  # exclusively (--strictPort).
  fuser -k -TERM "${PREVIEW_PORT}/tcp" 2>/dev/null || true
  if [ -n "${KEEP:-}" ]; then echo "kept $WS"; else rm -rf "$WS"; fi
}
trap cleanup EXIT

cp -r "$B/_lesson-core" "$WS/_lesson-core"; (cd "$WS/_lesson-core" && npm install --prefer-offline --silent)
cp "$B/workspace-root/gitignore.template" "$WS/.gitignore"
cp "$B/workspace-root/env.local.example" "$WS/.env.local"

L="$WS/course/claude_lessons/theme-demo"; mkdir -p "$L"; cp -r "$B/lesson-template/." "$L/"
mv "$L/src/__SLUG_SNAKE__.jsx" "$L/src/theme_demo.jsx"
sed -i 's/__SLUG_SNAKE__/theme_demo/g; s/__SLUG__/theme-demo/g; s/__COURSE_CODE__/DEMO 101/g; s/__LESSON_TITLE__/Theme Demo/g' \
  "$L/package.json" "$L/src/main.jsx" "$L/CLAUDE.md" "$L/index.html"
cp "$HERE/lesson/theme_demo.jsx" "$L/src/theme_demo.jsx"

cd "$L"
# The template's devDeps include playwright; this fixture drives the system
# Chrome, or one Playwright already has, so skip the download.
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --prefer-offline --silent
VITE_TUTOR=1 npx vite build >"$WS/build.log" 2>&1 \
  || { echo "build failed"; cat "$WS/build.log"; exit 1; }

(npx vite preview --port "$PREVIEW_PORT" --strictPort >"$WS/preview.log" 2>&1) &
for _ in $(seq 1 60); do
  curl -sf -o /dev/null "http://localhost:$PREVIEW_PORT/" && break
  sleep 0.5
done
curl -sf -o /dev/null "http://localhost:$PREVIEW_PORT/" \
  || { echo "preview server did not start"; cat "$WS/preview.log"; exit 1; }

SHOTS="$WS/shots"; mkdir -p "$SHOTS"
# LESSON_DIR lets browser.cjs fall back to the lesson's own playwright install
# when tests/shell-theme has not been npm installed.
LESSON_URL="http://localhost:$PREVIEW_PORT/" \
SHOTS="$SHOTS" \
LESSON_DIR="$L" \
  node "$HERE/browser.cjs"
