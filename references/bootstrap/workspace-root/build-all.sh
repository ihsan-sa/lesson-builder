#!/bin/bash
# ---------------------------------------------------------------------------
# Workspace-root build-all.sh
#
# Builds every lesson under `<course>/claude_lessons/<slug>/` into a flat
# `dist/<course_slug>/<lesson_slug>/` tree suitable for static hosting
# (Netlify / any HTML-over-object-store service).
#
# Usage:
#   bash build-all.sh
#
# Environment:
#   - Node 20+ on PATH.
#   - Each lesson must already have its `package.json`; missing lesson deps
#     are installed inline. Networked; budget ~2-3 minutes for 30+ lessons.
#
# Adding a course/lesson: duplicate a `build_course` call and edit the slugs.
# ---------------------------------------------------------------------------
set -e

# Prevent Git Bash on Windows from mangling Unix-style paths in --base flags.
export MSYS_NO_PATHCONV=1

OUT="dist"
rm -rf "$OUT"
mkdir -p "$OUT"

# Build every lesson in one course into $OUT/<code>/<slug>/.
#   $1 = deploy URL segment (e.g. "math101")
#   $2 = on-disk course directory (e.g. "MATH101")
#   $3+ = lesson slugs under <course>/claude_lessons/
build_course() {
  local code="$1"
  local dir="$2"
  shift 2
  local lessons=("$@")

  for slug in "${lessons[@]}"; do
    echo "Building $code/$slug..."
    cd "$dir/claude_lessons/$slug"
    npm install
    npx vite build --base="/$code/$slug/"
    mkdir -p "../../../$OUT/$code/$slug"
    cp -r dist/. "../../../$OUT/$code/$slug/"
    cd ../../..
  done
}

# ---------------------------------------------------------------------------
# Lesson inventory. Edit per workspace.
#
# Example pattern (replace with your actual courses + slugs):
#
#   build_course "<deploy-code>" "<on-disk-dir>" \
#     <slug-1> <slug-2> <slug-3>
#
# E.g.:
#   build_course "math101" "MATH101" \
#     derivatives integrals series
# ---------------------------------------------------------------------------

# build_course "<deploy-code>" "<on-disk-dir>" \
#   slug-1 slug-2

# ---------------------------------------------------------------------------
# Optional: copy workspace-level static assets (formula sheets, course guides)
# into the output tree so the landing page can link to them.
#
# mkdir -p "$OUT/<deploy-code>"
# cp <on-disk-dir>/<file>.pdf "$OUT/<deploy-code>/" 2>/dev/null \
#   || echo "Warning: <file>.pdf not found"
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Optional: workspace landing page at $OUT/index.html.
# Replace or remove as appropriate. The block below is a minimal placeholder.
# ---------------------------------------------------------------------------
cat > "$OUT/index.html" <<'HTML'
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Interactive Lessons</title>
<style>
  body { font-family: 'IBM Plex Sans', 'Segoe UI', sans-serif; background: #13151c; color: #e0e0e0; margin: 0; padding: 40px 20px; }
  h1 { color: #c8a45a; font-family: 'IBM Plex Mono', monospace; font-size: 20px; letter-spacing: 0.08em; text-transform: uppercase; }
  a { color: #4a90d9; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .container { max-width: 1100px; margin: 0 auto; }
</style>
</head>
<body>
<div class="container">
<h1>Interactive Lessons</h1>
<p>TODO: list each built lesson as <a href="/&lt;code&gt;/&lt;slug&gt;/">Lesson name</a>.</p>
</div>
</body>
</html>
HTML

echo "Done. Output in $OUT/"
