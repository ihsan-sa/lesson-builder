# lesson-builder goals

A Claude Code skill for building and updating interactive JSX lesson apps. Each lesson is a Vite + React project with tabbed topics, LaTeX math, SVG graphs, manim animations, interactive demos and an embedded AI tutor.

## Proposed goals

Filed by runs. Each says what done looks like as something a run can check, and keeps its status (open, done, failed, dropped) with the pull requests that moved it. At most three are open at once.

None is open yet.

## Later

Goals waiting for an open slot. When a proposed goal closes, the run that closed it moves the top one here up into Proposed goals as open, skipping any goal marked on hold.

### The tutor can drive a GeoGebra applet in the chat

- **Status:** on hold. Leave it here, and don't move it up or start it, until someone asks for it.
- **What:** A lesson can already embed a GeoGebra applet with `<GeoGebraGraph>` (#53), but the tutor can't put one in the chat or change it, the way it does a Desmos calculator with `<<DESMOS>>`. Add a `<<GEOGEBRA>>` tag whose body is a list of GeoGebra input-bar commands. `references/bootstrap/_lesson-core/chat/processResponse.js` parses and validates it like `<<DESMOS>>`, and the chat renders it in a `GeoGebraGraph`, so GeoGebra loads only for a reply that uses it. Teach the tag in `chat/buildSystemPrompt.js` (inside the prompt's size ceiling), `references/geogebra.md` and the tag list in `SKILL.md`, and say whether it is allowed in a thread. Desmos stays for plain 2D curves and sliders; this is a second medium beside it, not a replacement. Check GeoGebra's current terms and embed API before building on them.
- **Done when:** `tests/check.sh` passes with a fixture that runs replies through `processResponse.js` and shows that a well-formed `<<GEOGEBRA>>` block comes back as its commands and is stripped from the text, that a malformed block is dropped without breaking the rest of the reply, and that the tag stays inert inside a code fence, inline code or a quote line, as `tests/render-strips/` requires of the other tags.

## Closed

What has landed, from the git history, one line per pull request in this repo, newest first.

- #71 Add an aggregate check job over the fixture matrix
- #70 The tutor draws matplotlib graphs in the chat
- #69 Tutor chat keeps list numbers across equation blocks
- #68 Tighten the overview and show it at the top of the README
- #67 Chat client restores history, queues sends, takes over tabs
- #66 A timed-out CLI probe no longer disables the tutor until restart
- #65 Find out why the tutor proxy dies under machine load in the gate
- #64 What the tutor can write or read still reaches outside its lesson: a file it writes is later run unsandboxed
- #63 Revise the lesson-builder overview to revision B
- #62 Tutor replies can't smuggle in tags or markup
- #61 A bad graph schema must not kill the tutor chat
- #60 Let the build set the companion PDF's link
- #59 This repo's checks run on GitHub Actions
- #58 check.sh stops flagging load-only timeouts and thread-order flakes
- #57 Phase 5 sets the DOC_* variables, so a finished companion PDF is numbered and filed
- #56 A workspace's lesson core refreshes itself from the skill
- #55 check.sh fails cancellation and thread-actors on machine load alone
- #54 Lesson shell: adopt the desktop and mobile UI redesign
- #53 A lesson can embed a GeoGebra applet
- #52 The public overview leads with the agents and the build pipeline
- #51 A PDF overview of lesson-builder for the website, in the house style
- #50 Tutor chats default to Opus 5.5 at medium and show each thread's spend
- #49 The tutor's Glob-with-workspace-root form is unproven from an isolated cwd; its find fallback once read another checkout
- #48 CHAT_OK in the proxy's chat log carries no threadId, so a parent turn and a thread turn in flight at once close each other's entry
- #47 The student-facing tutor inherits the host repo's and the machine's CLAUDE.md, in isolated mode too
- #46 buildSystemPrompt.js understates its own size, so a lesson built to the documented budget ships a demoted tutor prompt
- #45 The tutor chat re-attaches to a turn after the stream to the tab is lost, so a long reply reaches the reader
- #44 The chat client restores or offers sessions from other lessons: sessionStorage key and picker are not scoped by lesson
- #43 An innocent proxy death before case 5 logs anything still reads as environmental
- #42 The tutor asks for the student's attempt before giving a solution, and reads a lesson's study record once per session
- #41 Plan hook for a lesson companion PDF
- #40 A run that dies mid-case says what was running, not just re-run
- #39 A gate run under load cannot report a false red
- #38 The phone-width tests have a consumer outside this repo
- #37 The negative control covers a lesson that both overlaps and collapses
- #36 The graph-theme check tells code from running text reliably
- #35 The built-site sweep measures overlap, not only collapse
- #34 The graph-theme check never misses a real graph site
- #33 The graph-theme check reports only real graph sites
- #32 What reaches the 39 classic lessons is measured, not asserted
- #31 The collapse check's exclusions are exercised by the suite
- #30 A classic lesson does not import the shell to get its icons
- #29 The graph-theme check is not fooled by a line break
- #28 The shell's dark toggle is tested in the shape lessons actually ship in
- #27 A lesson squeezed to nothing fails its tests
- #26 A lesson on the shell can switch to dark like the 39 older ones can
- #25 The katex-fallback test ends the dev servers it starts
- #24 An equation's controls do not sit on top of the equation at phone width
- #23 The 39 pre-shell lessons look like their original form again
- #22 Every chat feature in a dev lesson reaches the backend, and test runs leave no lesson servers behind
- #21 A lesson built for a hosted site carries its tutor and reaches its backend under its own URL prefix; the default build still ships no tutor
- #20 One command runs every deterministic fixture, and every landing gates on it (ROADMAP P2 #16, first slice)
- #19 Review verdicts are attested and reused; coverage never shrinks (ROADMAP P1 #10)
- #18 Media inventory, splice and reachability come from the lesson's syntax tree (ROADMAP P1 #11)
- #17 Updates build in a run worktree from the recorded base SHA (ROADMAP P1 #8)
- #16 Every media producer stages, validates and promotes (ROADMAP P1 #9)
- #15 Run manifest: the record is the state, the log is rendered from it (ROADMAP P1 #7)
- #14 Threads run in their own forked session (ROADMAP P0 #4)
- #13 Resume restores stored model and effort (ROADMAP P0 #5)
- #12 Chat: suggestion approval carries the parsed JSX (ROADMAP P0 #3, last part); roadmap ticks
- #11 Bootstrap core: Stage 1 tutor-probe fix
- #10 Core: DesmosGraph documents the failure fallback it renders
- #9 Core: a late Desmos bundle un-fails the hook
- #8 Core: drop private tooling from proxy text, settle useDesmos on a dead CDN
- #7 Chat: real cancellation, where /chat/cancel owns the turn's process tree and promotion happens only on completion (ROADMAP P0 #2)
- #6 Lesson: KaTeX CDN fallback with tri-state readiness and LaTeX-source degradation (ROADMAP P0 #6)
- #5 Chat: allowlist safe renderer replaces innerHTML for model output (ROADMAP P0 #1)
- #4 Bootstrap: bring the tutor fixes into _lesson-core
- #3 Skill: course-curation reference, consolidate verb, gates without a terminal
- #2 Skill: course-curation reference, consolidate verb, gates without a terminal
- #1 Add MIT license
