#!/bin/sh
# Build overview.pdf and one PNG per page. Usage: ./build.sh [outdir]  (default: this directory)
# It also renders, always into this directory, the three page images the repo's
# README.md shows at its top: readme-cover.png (page 1, with Figure 1) and the
# pages whose headings are "What a lesson is made of" and "A tutor that stays in
# its lesson", found by their text so a page that moves is still the one shown.
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
readme_page() {  # readme_page <name> <heading>: render the first page whose text has <heading>
  n=$(pdfinfo overview.pdf | awk '/^Pages:/{print $2}'); p=1
  while [ "$p" -le "$n" ]; do
    if pdftotext -f "$p" -l "$p" overview.pdf - | grep -qF "$2"; then
      pdftoppm -r 130 -png -singlefile -f "$p" -l "$p" overview.pdf "$1"; echo "$1.png (page $p)"; return
    fi
    p=$((p + 1))
  done
  echo "build.sh: no page has the heading '$2'" >&2; exit 1
}
readme_page readme-cover 'Lessons with a tutor inside'
readme_page readme-lesson 'What a lesson is made of'
readme_page readme-tutor 'A tutor that stays in its lesson'
