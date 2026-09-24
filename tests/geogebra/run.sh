#!/usr/bin/env bash
# GeoGebra embed evidence. Bootstraps a throwaway workspace per
# references/bootstrap.md, scaffolds the template lesson with
# lesson/geogebra_demo.jsx (the sample section), builds it with `vite build`,
# serves dist/ with `vite preview`, and drives check.cjs against it in Chrome
# at phone and desktop widths. Needs a Chromium and https://www.geogebra.org,
# so tests/check.sh lists it rather than running it. See README.md.
#
#   GEOGEBRA_BROWSER=<chrome bin>  optional; else Playwright's own Chromium
#   PORT=<n>                       optional; the preview port (default 5311)
#   KEEP=1                         keep the temp workspace for inspection
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
SKILL=$(cd "$HERE/../.." && pwd)
B="$SKILL/references/bootstrap"
PORT="${PORT:-5311}"

WS=$(mktemp -d "${TMPDIR:-/tmp}/geogebra-ws.XXXX"); echo "workspace: $WS"
cleanup() {
  # `npx vite preview` runs Vite as a grandchild, so clear by port, as
  # tests/phone-width does; --strictPort makes the port this fixture's own.
  fuser -k -TERM "${PORT}/tcp" 2>/dev/null || true
  if [ -n "${KEEP:-}" ]; then echo "kept $WS"; else rm -rf "$WS"; fi
}
trap cleanup EXIT

cp -r "$B/_lesson-core" "$WS/_lesson-core"; (cd "$WS/_lesson-core" && npm install --prefer-offline --silent)
cp "$B/workspace-root/gitignore.template" "$WS/.gitignore"
cp "$B/workspace-root/env.local.example" "$WS/.env.local"

L="$WS/course/claude_lessons/geogebra-demo"
mkdir -p "$L"; cp -r "$B/lesson-template/." "$L/"
mv "$L/src/__SLUG_SNAKE__.jsx" "$L/src/geogebra_demo.jsx"
sed -i "s/__SLUG_SNAKE__/geogebra_demo/g; s/__SLUG__/geogebra-demo/g; s/__COURSE_CODE__/DEMO 101/g; s/__LESSON_TITLE__/GeoGebra Demo/g" \
  "$L/package.json" "$L/src/main.jsx" "$L/CLAUDE.md" "$L/index.html"
cp "$HERE/lesson/geogebra_demo.jsx" "$L/src/geogebra_demo.jsx"
(cd "$L" && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --prefer-offline --silent \
   && npx vite build >"$WS/build.log" 2>&1) \
  || { echo "build failed"; cat "$WS/build.log"; exit 1; }

(cd "$L" && npx vite preview --port "$PORT" --strictPort >"$WS/preview.log" 2>&1) &
for _ in $(seq 1 60); do
  curl -sf -o /dev/null "http://localhost:$PORT/" && break
  sleep 0.5
done
curl -sf -o /dev/null "http://localhost:$PORT/" || { echo "preview server on $PORT did not start"; cat "$WS/preview.log"; exit 1; }

LESSON_URL="http://localhost:$PORT/" LESSON_DIR="$L" node "$HERE/check.cjs"
