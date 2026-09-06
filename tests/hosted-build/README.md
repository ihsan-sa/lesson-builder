# Hosted-build evidence

Proof that one lesson source builds four ways, and that each build's BUNDLE — not its source —
carries what it should:

- a plain `vite build` still ships no tutor (what the lessons repo's `docs/publishing.md` promises
  Netlify and the tailnet publish);
- `VITE_TUTOR=1 vite build --base=/<course>/<slug>/` ships the tutor with every chat call under
  that lesson's own prefix, which is what a lesson hosted at `lessons.ihsan.cc/<course>/<slug>/`
  needs to reach its own backend rather than the site root;
- the dev path is unmoved: tutor on, calls at the root, nothing extra set.

The gate lives in `references/bootstrap/_lesson-core/constants/build.js` (`TUTOR_ENABLED`, `API`)
and is applied in `chat/Chatbot.jsx` and `ui/LessonShell.jsx`. It replaced an
`import.meta.env.PROD` test, which is now the wrong question: a hosted lesson behind a login is a
production build that legitimately has a tutor.

```
tests/hosted-build/run.sh          # part of tests/check.sh
KEEP=1 tests/hosted-build/run.sh   # keep the workspace and its four dist trees
```

`run.sh` bootstraps a throwaway workspace per `references/bootstrap.md`, scaffolds the template
lesson with `lesson/hosted_demo.jsx` (the shipped placeholder renders `null`, so a real
`LessonShell` + `Chatbot` body is needed to exercise anything), builds it four times into
`dist-default/`, `dist-hosted/`, `dist-dev-mode/` and `dist-no-slash/`, and runs `check.cjs` over
them. No browser, no proxy, no model — the whole check is a read of the emitted JavaScript. Exit code 0 only when
every case passes.

## What `check.cjs` asserts

Each case reads its own dist tree; none depends on another's.

| | Build | Must hold |
| --- | --- | --- |
| 1 | `vite build`, nothing else set | no tutor UI in the bundle (the toggle's title, the pop-up-blocked note, the shortcut overlay); the "AI tutor is only available when running locally" banner IS there instead; every endpoint literal is root-absolute, so a default build has not quietly acquired a prefix |
| 2 | `VITE_TUTOR=1 vite build --base=/demo101/hosted-demo/` | all eleven endpoints appear as `/demo101/hosted-demo/<path>`, AND none of them appears in its root-absolute form — both halves, because a bundle that emitted both would still reach the site root; the tutor UI is present; the banner is not |
| 3 | `NODE_ENV=development vite build --mode development` | tutor UI present, banner absent, every endpoint root-absolute — the dev server's compilation of the same sources, with no `VITE_TUTOR` and no `--base` |
| 4 | `VITE_TUTOR=1 vite build --base=/demo101/no-slash` | the endpoints really do come out as `/demo101/no-slashchat`, and the bundle carries the `console.error` that names the base and prints the rebuild — asserted in the correct bundle too, since a diagnostic the minifier folded away could never fire |

Case 2's negative half is the one that matters: the prefixed URL being present proves little on its
own, since a bundle that emitted `/chat` as well would still call the site root at runtime.

`NODE_ENV=development` in case 3 is load-bearing. `vite build` sets `NODE_ENV=production` itself and
`import.meta.env.DEV` follows `NODE_ENV`, so `--mode development` alone compiles `DEV` as false and
the case silently becomes case 1 over again.

Case 1 asserts the endpoint literals are *present* and unprefixed rather than absent, which is the
honest reading of the emitted bundle: the gate drops the tutor's UI and its session bootstrap, not
the `Chatbot` module the lesson still imports. Nothing in that build reaches those URLs — the init
effect returns early so no tab ever gets a session, and both `sendBeacon` paths are guarded on
`tab.sessionId` — and that was equally true of the `import.meta.env.PROD` gate this replaced.

## Turning the tutor on for a hosted build

`VITE_TUTOR=1` or `VITE_TUTOR=true`; anything else, unset included, is off. It is read at build
time only, so it belongs on the build command (as `build-all.sh` passes `--base`), not in a
running host's environment. **The base must end in `/`**: given `--base=/c/s` Vite normalises its
own asset URLs to `/c/s/assets/...` but hands `import.meta.env.BASE_URL` over unchanged, so every
chat call becomes `/c/schat` and 404s. Nothing in `constants/build.js` can repair that at build
time, so it says so at runtime instead — case 4 pins both the trap and the message.

Setting `VITE_TUTOR` in the workspace-root `.env.local` turns it on for every
build from that workspace, including one meant for a static host — which is why the fixture's own
bootstrap refuses to run if `env.local.example` ever starts setting it.

The backend half — a hosted proxy answering under `/<course>/<slug>/`, its sandbox and its
authoring routes — is a separate milestone. This change is the client only.

## Sync to the lessons workspace

`lessons/_lesson-core` must stay byte-identical to `references/bootstrap/_lesson-core`. This change
adds `constants/build.js` and touches `chat/Chatbot.jsx`, `ui/LessonShell.jsx` and one comment in
`chat/chat.css.js` — sync all four, or the lessons-side hosted build ships no tutor and the dev
build calls a `/chat` that a hosted lesson's URL prefix never reaches.
