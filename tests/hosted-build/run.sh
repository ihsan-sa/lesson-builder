#!/usr/bin/env bash
# Hosted-build evidence. Bootstraps a throwaway workspace per
# references/bootstrap.md, scaffolds the template lesson with this directory's
# demo body, and builds it THREE ways, then asserts on the built bundles:
#
#   default   npx vite build                                    (nothing extra set)
#   hosted    VITE_TUTOR=1 npx vite build --base=/demo101/hosted-demo/
#   dev-mode  NODE_ENV=development npx vite build --mode development
#             (what `npm run dev` compiles: import.meta.env.DEV true, base "/")
#   no-slash  the same hosted build with --base=/demo101/no-slash
#
# No browser, no proxy, no model: the whole check is `grep` over dist/. See
# README.md for the case table.
#   KEEP=1  keep the temp workspace (and its three dist trees) for inspection
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd); SKILL=$(cd "$HERE/../.." && pwd); B="$SKILL/references/bootstrap"

WS=$(mktemp -d "${TMPDIR:-/tmp}/hosted-build-ws.XXXX"); echo "workspace: $WS"
cleanup() { if [ -n "${KEEP:-}" ]; then echo "kept $WS"; else rm -rf "$WS"; fi; }
trap cleanup EXIT

cp -r "$B/_lesson-core" "$WS/_lesson-core"
cp "$B/workspace-root/gitignore.template" "$WS/.gitignore"
# The workspace-root .env.local every lesson's vite.config.js reads via envDir.
# It must NOT set VITE_TUTOR: the default case below asserts that a build with
# nothing extra set ships no tutor, and an env file that quietly turned it on
# would make that case pass for the wrong reason.
cp "$B/workspace-root/env.local.example" "$WS/.env.local"
if grep -q '^VITE_TUTOR=' "$WS/.env.local"; then
  echo "env.local.example sets VITE_TUTOR: the default case would no longer be a default"; exit 1
fi

L="$WS/course/claude_lessons/hosted-demo"; mkdir -p "$L"; cp -r "$B/lesson-template/." "$L/"
mv "$L/src/__SLUG_SNAKE__.jsx" "$L/src/hosted_demo.jsx"
sed -i 's/__SLUG_SNAKE__/hosted_demo/g; s/__SLUG__/hosted-demo/g; s/__COURSE_CODE__/DEMO 101/g; s/__LESSON_TITLE__/Hosted Build Demo/g' \
  "$L/package.json" "$L/src/main.jsx" "$L/CLAUDE.md" "$L/index.html"
# The committed demo body: a real one-topic lesson that mounts LessonShell +
# Chatbot for real (the shipped placeholder renders null).
cp "$HERE/lesson/hosted_demo.jsx" "$L/src/hosted_demo.jsx"

cd "$L"
# The template's devDeps include playwright, which this fixture never runs; skip
# its browser download the same way tests/katex-fallback does.
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --prefer-offline --silent

build() { # <outdir> <env assignments for this build, "" for none> [extra vite args...]
  local out="$1" envs="$2"; shift 2
  rm -rf dist
  # $envs is deliberately word-split into env's arguments.
  # shellcheck disable=SC2086
  env $envs npx vite build "$@" >"$WS/build-$out.log" 2>&1 \
    || { echo "build $out failed"; cat "$WS/build-$out.log"; exit 1; }
  mv dist "$WS/dist-$out"
}
build default  ""
build hosted   "VITE_TUTOR=1" --base=/demo101/hosted-demo/
# NODE_ENV matters as much as --mode here: `vite build` sets NODE_ENV=production
# on its own and `import.meta.env.DEV` follows NODE_ENV, so `--mode development`
# alone still compiles DEV as false -- the production case over again, not the
# dev one this case exists to cover.
build dev-mode "NODE_ENV=development" --mode development
# The trailing-slash edge, built so check.cjs can read what it actually does.
build no-slash "VITE_TUTOR=1" --base=/demo101/no-slash

WS="$WS" node "$HERE/check.cjs"
