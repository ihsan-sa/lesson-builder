#!/bin/sh
# Build overview.pdf and one PNG per page. Usage: ./build.sh [outdir]  (default: this directory)
# The build is the pdf-material-builder skill's (lualatex, three passes, house
# style); it writes overview.pdf beside overview.tex and removes its own
# log, so one more lualatex pass into a temp dir reads the Overfull/Underfull lines.
set -e
cd "$(dirname "$0")"
out=${1:-.}
skill=${PDF_MATERIAL_BUILDER:-$HOME/.claude/skills/pdf-material-builder}
"$skill/scripts/build.sh" overview.tex
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
TEXINPUTS=".:$skill/references/house-style//:${TEXINPUTS:-}" \
  lualatex -interaction=nonstopmode -halt-on-error -output-directory "$tmp" overview.tex >/dev/null 2>&1 || true
grep -E 'Overfull|Underfull' "$tmp/overview.log" || true
mkdir -p "$out"
[ "$out" -ef . ] || cp overview.pdf "$out/overview.pdf"
rm -f "$out"/overview-page-*.png
pdftoppm -r 110 -png "$out/overview.pdf" "$out/overview-page"
ls "$out"/overview.pdf "$out"/overview-page-*.png
