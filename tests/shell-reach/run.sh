#!/usr/bin/env bash
# Does LessonShell reach a classic lesson's bundle? Bootstraps a throwaway
# workspace per references/bootstrap.md, scaffolds ONE lesson, and builds it
# three times from two bodies that differ only by the <LessonShell> wrapper:
#
#   classic          VITE_TUTOR=1 npx vite build   lesson/classic_demo.jsx
#   classic-default  npx vite build                lesson/classic_demo.jsx
#   shelled          VITE_TUTOR=1 npx vite build   lesson/shelled_demo.jsx
#
# The classic lesson is built BOTH ways because the two ask different questions.
# `classic-default` is the shape the 39 publish (no tutor, static host).
# `classic` is the larger of the two bundles -- the tutor gate drops code, it
# adds none -- so the shell being absent there is the stronger measurement, and
# it is the build in which every shell marker would be live if the shell were
# reached (the pop-out button sits inside the tutor gate).
#
# No browser, no proxy, no model: the whole check is a read of the emitted
# JavaScript. See README.md for the case table.
#   KEEP=1  keep the temp workspace (and its three dist trees) for inspection
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd); SKILL=$(cd "$HERE/../.." && pwd); B="$SKILL/references/bootstrap"

WS=$(mktemp -d "${TMPDIR:-/tmp}/shell-reach-ws.XXXX"); echo "workspace: $WS"
cleanup() { if [ -n "${KEEP:-}" ]; then echo "kept $WS"; else rm -rf "$WS"; fi; }
trap cleanup EXIT

cp -r "$B/_lesson-core" "$WS/_lesson-core"
cp "$B/workspace-root/gitignore.template" "$WS/.gitignore"
# The workspace-root .env.local every lesson's vite.config.js reads via envDir.
# It must NOT set VITE_TUTOR: the classic-default build below is the shape the
# 39 publish, and an env file that quietly turned the tutor on would make it a
# different build from the one it claims to be.
cp "$B/workspace-root/env.local.example" "$WS/.env.local"
if grep -q '^VITE_TUTOR=' "$WS/.env.local"; then
  echo "env.local.example sets VITE_TUTOR: the classic-default case would no longer be a default"; exit 1
fi

L="$WS/course/claude_lessons/shell-reach-demo"; mkdir -p "$L"; cp -r "$B/lesson-template/." "$L/"
mv "$L/src/__SLUG_SNAKE__.jsx" "$L/src/shell_reach_demo.jsx"
sed -i 's/__SLUG_SNAKE__/shell_reach_demo/g; s/__SLUG__/shell-reach-demo/g; s/__COURSE_CODE__/DEMO 101/g; s/__LESSON_TITLE__/Shell Reach Demo/g' \
  "$L/package.json" "$L/src/main.jsx" "$L/CLAUDE.md" "$L/index.html"

cd "$L"
# The template's devDeps include playwright, which this fixture never runs; skip
# its browser download the same way tests/hosted-build does.
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --prefer-offline --silent

build() { # <outdir> <body under lesson/> <env assignments for this build, "" for none>
  local out="$1" body="$2" envs="$3"
  rm -rf dist
  cp "$HERE/lesson/$body" "$L/src/shell_reach_demo.jsx"
  # $envs is deliberately word-split into env's arguments.
  # shellcheck disable=SC2086
  env $envs npx vite build >"$WS/build-$out.log" 2>&1 \
    || { echo "build $out failed"; cat "$WS/build-$out.log"; exit 1; }
  mv dist "$WS/dist-$out"
}
build classic         classic_demo.jsx "VITE_TUTOR=1"
build classic-default classic_demo.jsx ""
build shelled         shelled_demo.jsx "VITE_TUTOR=1"

WS="$WS" SKILL="$SKILL" node "$HERE/check.cjs"
