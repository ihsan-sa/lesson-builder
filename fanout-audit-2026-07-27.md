# Fan-out audit — confirmed findings (2026-07-27)

Produced by a 14-area static audit of the skill (one auditor per pipeline stage / runtime module), each finding adversarially verified. 63 confirmed of 102 raw; 39 refuted.

Items marked FIXED landed in branch `chat-threads-context-and-p0-fixes`. Everything else is open.

## P0 (3)

### phase-5 — references/phase-5-deploy.md:159
Phase 5's strict staging allowlist never stages `<workspace_root>/_lesson-core/` (nor the bootstrap-created workspace `.gitignore` / `netlify.toml`), so the first push from a freshly bootstrapped workspace produces a repo whose lessons cannot build on the host.

**Failure:** Fresh workspace: bootstrap copies `_lesson-core/`, `.gitignore`, `netlify.toml`, `build-all.sh` into `<workspace_root>/`. Phase 5 new mode stages the lesson paths plus `build-all.sh` (edited to register the lesson), commits, and `git push origin main`. Netlify clones the repo — `_lesson-core/` and `netlify.toml` are absent. Local build verification passed (the directory exists locally), so the final report prints `Build verification: PASS`, a commit SHA, and a Live URL, while the hosted build dies on `Failed to resolve import "@core"`. Every subsequent lesson in that workspace inherits the sam

**Suggested fix:** Add `_lesson-core/` and the bootstrap-created workspace-root files to the Step 2a.3 staging block for the first commit in a workspace, e.g. gate on `git ls-files --error-unmatch <workspace_root>/_lesson-core/index.js` failing → `git add <workspace_root>/_lesson-core/ <workspace_root>/.gitignore <workspace_root>/netlify.toml` (excluding `node_modules/`, which the workspace gitignore already covers).

### chat-runtime — references/bootstrap/_lesson-core/chat/Chatbot.jsx:1192
The send button wires `onClick={sendMessage}` directly, so React passes the click SyntheticEvent as `sendMessage`'s `overrideText` parameter — the typed input is never read, the event object becomes the message body and the rendered user bubble, and React throws on rendering it.

**Failure:** Student types "why is the barrier height 0.7 eV?" and clicks the ▶ send button instead of pressing Enter. `overrideText` is a SyntheticBaseEvent, so `text` is that object: `overrideText !== undefined` is true, so the input box is never cleared (Chatbot.jsx:530-533), attachments are dropped (`currentAtts = []`), context snippets are skipped (Chatbot.jsx:535), and `displayMsg.content` is the event object. The immediate `updateTab(tabId, { messages: newMsgs, loading: true })` re-render passes that object into ChatBubble as a React child, which throws "Objects are not valid as a React child". Ther

**Suggested fix:** Change the handler to `onClick={() => sendMessage()}` (matching the Enter path at Chatbot.jsx:976), and additionally harden `sendMessage` with `if (typeof overrideText !== "string") overrideText = undefined;` at the top so no future DOM handler can re-introduce this.

### proxy-and-runner — references/bootstrap/_lesson-core/server/proxy.js:203
The generated system prompt is pushed into CLI argv while the process is spawned with `shell: true`, and Node joins argv with plain spaces without quoting — so the ~12.9k-char multi-line prompt is shredded into hundreds of positional tokens (and everything after the first newline becomes separate shell commands). Every /session/init, /session/transfer and stateless /chat now sends a one-word system prompt or fails outright.

**Failure:** Student opens any lesson in dev, the Chatbot POSTs /session/init with `system: makeSystemPrompt(iso)` (Chatbot.jsx:257-261). cmd.exe receives `claude ... --system-prompt You are the tutor for ECE 109 (Principles of Electronic Materials...)` — `(`, `|` (from `type="lesson|faq"`), `<<EDIT_GRAPH>>` and the embedded newlines are shell metacharacters. On POSIX (`sh -c`) the unescaped `(` is a syntax error and init 500s; on Windows cmd the prompt is truncated at the first space/newline, so the tutor runs with a 1-word system prompt and PEDAGOGY_POLICY, isolation mode, `<<EDIT_GRAPH>>`/`<<SUGGEST>>`/

**Suggested fix:** Do not put the system prompt in shell-joined argv. Either drop `shell: true` and resolve the `claude` binary explicitly (`claude.cmd` on win32) so Node quotes argv properly, or write `system` to a temp file and pass `--system-prompt-file`/keep the stdin `[System Instructions]` path. Same applies to `--add-dir` paths.

## P1 (15)

### skill-md-and-bootstrap — references/bootstrap.md:14
The core-version gate's agent-registry check unconditionally deletes every file in the user's `<workspace_root>/.claude/agents/` whose name is not shipped by the skill, with no confirmation — destroying user-authored agents that were never part of lesson-builder.

**Failure:** A user's workspace `.claude/agents/` contains their own `latex-formatter.md` and `exam-scraper.md` alongside the 14 lesson-builder agents. On the next lesson-builder run the gate diffs the registry against `$SKILL/agents/` + `workspace-root/.claude/agents/`, finds those two names absent from the skill, and deletes them. Because gitignore.template:46 ignores `.claude/`, the files are untracked and unrecoverable.

**Suggested fix:** Scope the deletion to files the skill itself installed — write a manifest (e.g. `.claude/agents/.lesson-builder-manifest`) at Step 3 and delete only names listed in a *previous* manifest that are absent from the current skill — and require an AskUserQuestion confirmation listing the exact files before any deletion.

### phase-0 — references/phase-0-scoping.md:41
`deploy_target` is produced by Phase 0 and consumed by no phase, and the replacement safety guard it is supposed to trigger (clean-tree requirement + `git branch backup/<slug>-<YYYYMMDD>`) is written in passive voice with no owning phase — Phase 3's new-mode path never reads `deploy_target` and never creates a backup branch.

**Failure:** User answers "Replacing existing lesson at PHYS102/standing-waves". Phase 0 records `deploy_target: "replacing: PHYS102/standing-waves"`. Phase 3 new-mode execution never reads that field, never checks the lesson root is clean, and never runs `git branch backup/standing-waves-20260727`; Step 6 copies `lesson-template/` over the existing lesson root and Step 3 overwrites `src/standing_waves.jsx`. Any uncommitted work in the old lesson is gone with no recovery ref. (This is the unimplemented half of codex-audit-2 #51 — the prose guard was added at Phase 0 but no phase executes it; distinct from 

**Suggested fix:** Give the guard an owner: either state "**Phase 0 owns the replacement backup**" and run the clean-check + `git branch backup/<slug>-<YYYYMMDD>` in Phase 0 (mirroring the "Phase 0 owns the stash" pattern at line 91), recording the branch in the artifact; or add a `deploy_target == "replacing: …"` pre-step to references/phase-3-execution.md's New-mode execution section that reads the field and creates the branch before Step 1.

### phase-1 — references/phase-1-content.md:260
The `light` update branch makes `content-review-agent`'s evidence file the orchestrator's only input, but that agent has no `Write` tool and therefore cannot produce an evidence file — in `light` mode the orchestrator synthesizes from an empty `evidence_dir`.

**Failure:** A `light` update (resource_mode: limited, or an explicit quick pass). Main Claude spawns exactly one `content-review-agent`; it has no Write tool so nothing lands in `.build-scratch/evidence/`. `content-orchestrator-agent` is spawned with `evidence_dir`, reads zero files, and compiles the update package from the JSX + inventory alone. The drift findings and per-concern `update_criterion_coverage` — the entire research payload of the light branch — never reach the package, so `DRIFT_INCIDENTS` comes back empty and the post-orchestrator check at line 336 ("Every `DRIFT_INCIDENTS` entry is addres

**Suggested fix:** Either add `Write` to `agents/content-review-agent.md`'s tools plus a "persist full output to the evidence path the brief names" instruction mirroring `agents/research-agent.md:19`, or state at phase-1-content.md:259-260 that main Claude pastes the reviewer's returned issue list into the orchestrator spawn prompt (and drop "that review's evidence file").

### phase-2 — references/phase-2-plan.md:94
Phase 2 reads the decider's `selected` array as a ranked list and keeps only entry 0, but the decider emits `selected` as an *additive* list — a second entry means both media get built, not a fallback.

**Failure:** Decider returns topic-2 with `selected: [{svg-graph, build_brief}, {interactive-demo, build_brief}]` because both independently earn their place. Main Claude follows line 94, takes "the top-ranked medium per topic", writes one media row, and the interactive demo the decider deliberately planned never reaches the plan, the gate, or Phase 3 — silently dropped with no log entry (line 94 only requires logging a *fallback*, not a discard).

**Suggested fix:** Rewrite line 94 to state that EVERY entry in `selected` becomes its own plan media row (they are additive), and that fallbacks come from `alternatives`, not from lower `selected` entries.

### phase-2 — references/phase-2-plan.md:64
The decider's shared-component reuse contract (referencing topics carry `reuse: true` rows so Phase 3 wires their call sites) has no field in the plan media-row schema and no rule anywhere in Phase 3.

**Failure:** Decider flags one axis-system graph shared by topic-2 and topic-5. Main Claude dedups it into a single media row under topic-2 per line 64; the plan has no field expressing that topic-5 also references it. Phase 3 Step 1 spawns one specialist and Step 3 stitches each topic's content "from its specialist scratch files" — topic-5 has none for that component, so the shared figure never appears in topic-5 and the lesson ships a topic missing the visual the decider planned for it. (The opposite failure if the reuse row is kept as a normal media row: two spawns collide on `.build-scratch/<media_id>.

**Suggested fix:** Add `reuse: true` + `owner_topic` to the plan media-row schema at line 137 so referencing topics carry a row, and add a Phase 3 rule: reuse rows spawn no specialist and contribute only a call site in the referencing topic's content function.

### phase-3 — references/phase-3-execution.md:383
Update-mode splice step 4.6 check 4 hard-fails when GRAPH_SCHEMA and DEFAULT_GRAPH_PARAMS keys differ and explicitly halts Phase 3, but the 4.7 backfill that creates GRAPH_SCHEMA for pre-schema lessons runs only after 4.6 — so the repair is unreachable for exactly the lessons it exists for.

**Failure:** User asks for an update to a legacy lesson that has `const DEFAULT_GRAPH_PARAMS = { wavefunctions: {...}, bodePlot: {...} }` but no `export const GRAPH_SCHEMA` (the case 4.7 and 4.8's "common on lessons that predate the graph-schema feature" describe). The splice completes fine; 4.6 check 4 diffs `{wavefunctions, bodePlot}` against the empty/absent schema key set, they are not identical, so per line 378 main Claude halts Phase 3 and surfaces a failure. 4.7 never executes, the drift repair is never applied, and a legitimate update run aborts on the very defect the pipeline is documented to auto

**Suggested fix:** Move 4.7 (GRAPH_SCHEMA backfill) and 4.8 (Chatbot props reconcile) to run before 4.6, or add an explicit exception to 4.6 check 4: "if `export const GRAPH_SCHEMA` is absent entirely, skip this check — run 4.7 first, then re-run check 4 against the backfilled schema."

### phase-4 — references/phase-4-review.md:171
The normalization row for `scientific-accuracy-agent` still collapses the agent's whole `findings[]` array into one issue record with a hardcoded confidence, discarding the per-finding severity/confidence/location the agent file now explicitly promises. (This is the still-unfixed half of codex-audit-2 #79 — the agent side got its structured array, the phase-4 table was never updated.)

**Failure:** scientific-accuracy-agent returns verdict `fail` with three findings on one graph (wrong sign on E1, missing eV units, ground state above n=2) at confidence 0.95/0.6/0.9. Main Claude follows the table verbatim: one major record, confidence 0.9, location = the whole artifact. The other two findings lose their identity, the fix-loop confidence filter at :190 operates on a fabricated 0.9, and the refine brief carries a paragraph instead of three routable defects — so a partially-fixed graph closes the single record and the remaining errors ship.

**Suggested fix:** Change the row to: each `findings[]` entry → one record, `fail`→major / `issue`→minor, confidence and location taken from the entry; keep the aggregate verdict mapping only as a fallback for an empty `findings` array.

### phase-5 — references/phase-5-deploy.md:111
Step 2a.1 tells the agent most new lessons need no build-config change, and the example commit body hardcodes that claim — but the shipped `build-all.sh` builds only slugs hand-listed in a `build_course` call, so an unregistered lesson is silently never built by the host.

**Failure:** New lesson `series` added to existing course MATH101, whose `build_course "math101" "MATH101" derivatives integrals` line already exists. The agent reads :111, concludes no build change is needed, and writes the :136 body verbatim. Phase 4's gate (which has no registration note) then builds only `derivatives` and `integrals`; the Playwright check against `dist/math101/series/` 404s and Phase 4 halts on a phantom build failure — or, if the agent skips the missing-target check, the commit is pushed and the hosted site serves 404 at the reported Live URL forever.

**Suggested fix:** Replace :111 and the :136 example line with an unconditional requirement: every new lesson must be appended to the course's `build_course` slug list (creating the `build_course` line if the course is new) before any build verification, and change the example body bullet to `- build-all.sh: registered <slug> under <deploy-code>`. Mirror the note into references/phase-4-review.md's build-verification section.

### phase-5 — references/phase-5-deploy.md:214
New-mode deploy commits to whatever branch happens to be checked out and then pushes the `main` refspec, with no HEAD verification anywhere in the new-mode path — the update path has exactly this guard, new mode does not.

**Failure:** User is on a feature branch (or a leftover `lesson-update/...` branch from a previous run) when a new-mode build starts. The lesson commit lands on that branch. `git push origin main` then resolves the `main` refspec to the *local* `main` ref, which does not contain the commit — git exits 0 with `Everything up-to-date`. Step 2a.6's `git rev-parse HEAD` records the feature-branch SHA, and the final report prints `Push result: ok (origin main)` plus a Live URL for a lesson that was never pushed and never deployed.

**Suggested fix:** Add a Step 2a.0 mirroring 2b.1: run `git rev-parse --abbrev-ref HEAD`, halt if it is not the workspace default branch, and record the verified branch; push with `git push origin HEAD:main` (or the verified branch name) rather than the bare `main` refspec.

### update-mode — references/checklists.md:357
The update-mode pre-flight checklist (linked from update-mode.md §10 as the authority for pre-flight) auto-stashes a dirty tree under a different label than the canonical Phase 0 stash, contradicting the "ask, never proceed silently" invariant and breaking label-based recovery.

**Failure:** Pre-flight runs before scoping closes (checklists.md:352 "Run before scoping closes"), sees a dirty tree, and stashes it automatically as `lesson-builder-preflight-...` without asking. Phase 0's working-tree check then reports the tree clean and logs `Stash ref: none`; Phase 5 skips stash recovery entirely and the final report never mentions the stash, so the user's uncommitted work is silently orphaned under a label no phase looks for.

**Suggested fix:** Rewrite the checklist item to defer to Phase 0: dirty tree → the Phase 0 AskUserQuestion decides stash/abort/discard, the stash message is `lesson-update-stash <slug> <date>`, and the OID is recorded per phase-0-scoping.md:89. Remove the auto-stash and the second label.

### agent-contracts — agents/content-orchestrator-agent.md:66
The orchestrator is instructed to fill the inventory's null `purpose` fields, but its declared update-mode return schema has no field that carries the filled inventory back, so the `current_purpose` Phase 2 must forward and the `original_intent` Phase 4 depends on have no channel.

**Failure:** Update run on a lesson with 6 existing media. The orchestrator reads the JSX, derives each medium's purpose, and then — obeying "Do not restructure" — returns only the schema's fields, dropping every purpose it derived. Phase 2 hands the decider `current_purpose: null` for all six, and every `keep` row's `original_intent` is empty, so Phase 4's no-grandfathering QA (phase-4-review.md:74, "Main Claude's spawn brief must include the original intent string") grades kept media against nothing.

**Suggested fix:** Add an explicit `MEDIA_INVENTORY_PURPOSES: [ { existing_name, purpose } ]` (or an equivalent `purpose` field on each `media_preverdicts` entry) to the update-mode return schema so the derived purposes have a declared channel.

### chat-runtime — references/bootstrap/_lesson-core/chat/observationQueue.js:90
Every accepted `<<EDIT_GRAPH>>` enqueues a 'visual' observation instructing the tutor to screenshot `[data-graph-key="…"][data-graph-render-id="…"]`, but those attributes are emitted only by `LiveGraph`, which the lesson template, phase-3 assembly, and the checklists never require or use — so the selector never exists in a generated lesson.

**Failure:** Student says "raise nMax to 5". The tutor emits a valid `<<EDIT_GRAPH>>`, `processResponse` applies it, `wrappedOnEditGraph` queues the 'visual' observation, and the next turn's message tells the model to navigate to `/?tab=<topicId>` and screenshot `[data-graph-key="infiniteWell"][data-graph-render-id="3"]`. No element in the built lesson carries either attribute, so `browser_take_screenshot` fails or captures nothing; the model then spawns visual-qa-agent and scientific-accuracy-agent (steps 3-4 of the same observation) on a missing/blank capture and reports a fabricated or confused verdict 

**Suggested fix:** Either (a) make the template skeleton and phase-3 assembly wrap each graph in `<LiveGraph graphKey={key} renderId={graphRenderId}>` and add it to the checklists' Chatbot-wiring reconcile list, or (b) change observationQueue.js:90 to a selector the template actually emits (e.g. the graph-preview tab container) and drop the renderId predicate, which cannot be computed correctly from a stale prop anyway.

### proxy-and-runner — references/bootstrap/_lesson-core/helpers/manim-runner.js:287
On Windows the runner spawns ffprobe/ffmpeg with `shell: true` and passes absolute scratch paths as argv; Node joins argv unquoted, so any space anywhere in the workspace path splits the path and stages 4-5 fail after a successful full render.

**Failure:** Workspace lives under a path containing a space (e.g. `C:\Users\First Last\courses\` or `...\OneDrive\My Course Work\`). manim-agent renders successfully for up to 5 minutes, then ffprobe is invoked as `ffprobe -v error ... C:\Users\First Last\...\Scene.mp4` -> ffprobe reads `C:\Users\First` and exits non-zero, so `runManimPipeline` returns `{ ok:false, reason: "ffprobe failed: ..." }` and the whole render is discarded. The agent burns its revision budget re-rendering an animation that renders fine every time, then reports the medium as unavailable.

**Suggested fix:** Drop `shell: true` and resolve the Windows shim explicitly (probe for `manim.cmd`/`manim.exe`, `ffprobe.exe`, `ffmpeg.exe`), or keep the shell only for the `manim` invocations (which use relative `scene.py` plus `cwd`) and spawn ffprobe/ffmpeg without a shell.

### bootstrap-payload — references/bootstrap/lesson-template/.gitignore:1
The shipped lesson-template `.gitignore` contains only runtime carve-outs, but Phase 3 states twice that this exact file already ships the private-by-default block — so the step that would add `materials/`, `source/`, `notes/`, `.env*`, `*.local`, `.build-scratch/` is told it is already done.

**Failure:** New-mode run in a workspace whose root `.gitignore` predates the skill (bootstrap.md:106 forbids overwriting an existing one). Step 6 copies the template `.gitignore`; Step 6.5 reads line 151, believes the full block is present, "verifies" and appends nothing. `<lesson_root>/materials/`, `notes/`, `source/`, `.env.local`, `lesson_build.log.md` are now untracked-but-not-ignored. Phase 5 Step 1.5 then fires on the premise at phase-5-deploy.md:68 — "A plain `git add` cannot stage these files" — which is false for this lesson, and the stated privacy baseline the user is shown does not exist.

**Suggested fix:** Append the nine-line private-by-default block from phase-3-execution.md:19-30 to `references/bootstrap/lesson-template/.gitignore` (keeping the runtime carve-outs), and update references/server-template.md:217-230 + references/bootstrap.md:62-63 to list the combined contents.

### cross-doc-single-source — references/desmos-schema.md:78
desmos-schema.md — the doc SKILL.md mandates reading before authoring any Desmos surface — still says DesmosGraph.jsx keeps an overlay Play button; the component has none and the other two contracts explicitly forbid adding one.

**Failure:** Phase 3 authors a `<DesmosGraph>` embed after reading desmos-schema.md as instructed, sees the promised top-right Play overlay is absent, and either hand-rolls an overlay button in the lesson JSX (which checklists.md:131 tells the Phase 4 reviewer to reject) or files a bug against @core; the same doc tells visual-QA that the missing overlay is expected in chat but present in lessons, so the two reviewers disagree on the same artifact.

**Suggested fix:** Rewrite desmos-schema.md §Animation and the play button to match DesmosGraph.jsx: no overlay in either path, expression panel expanded in the lesson path and collapsed in the chat path, animation always student-initiated via the native per-slider button.

## P2 (45)

### skill-md-and-bootstrap — SKILL.md:50
The pre-Phase-0 workspace gate globs `<workspace_root>/_lesson-core/index.js`, but `<workspace_root>` has no resolver: Phase 0 contains no question that establishes it, and the scoping artifact has no field for it — so the one instruction that is supposed to disambiguate it ("asked at Phase 0") points at something that does not exist.

**Failure:** User starts the session with cwd = `<workspace_root>/ECE109/` (a natural place to be while working on a course) and says "build me a lesson on Fourier series". Main Claude takes cwd as `<workspace_root>`, Globs `ECE109/_lesson-core/index.js`, finds nothing, declares the workspace fresh, and runs the whole bootstrap procedure one level too deep: a second `_lesson-core/`, `.gitignore`, `.env.local`, `build-all.sh` and `.claude/agents/` are written under `ECE109/`. Step 4's confirmation only re-checks the files it just wrote, so it reports success. The lesson scaffolded at `ECE109/claude_lessons/

**Suggested fix:** Make `workspace_root` an explicit, resolved value before the gate: add a deterministic derivation rule to bootstrap.md's Detection section (walk up from cwd to the nearest ancestor containing `_lesson-core/index.js`, else nearest ancestor containing `*/claude_lessons/`, else ask), record it as a `workspace_root:` field in the Phase 0 common-fields artifact, and have Step 4 verify the resolved root rather than only the files just written.

### skill-md-and-bootstrap — references/bootstrap.md:13
The core refresh is described ("replace `<workspace_root>/_lesson-core/` contents with the payload's") but no command is given, and the only copy command the document supplies is Step 1's `cp -r`, which nests the payload instead of replacing it when the destination already exists — which is by definition the case on the refresh path.

**Failure:** User accepts the refresh on a legacy workspace. The agent reuses the only documented command; POSIX `cp -r SRC DST` with an existing directory DST copies SRC *into* DST, producing `<workspace_root>/_lesson-core/_lesson-core/`. The stale `_lesson-core/chat/buildSystemPrompt.js` is untouched, so the refresh silently accomplishes nothing while being reported as done, and the workspace now carries a duplicated core tree. `npm install` then runs against the old root `package.json`. The 'sync log' the same line says to check first is also never named or located anywhere in the skill.

**Suggested fix:** Give the refresh path an explicit procedure alongside Step 1: back up to `_lesson-core.bak-<date>/`, `rm -rf <workspace_root>/_lesson-core`, then run the Step 1 command, then Step 2 `npm install`; and either name the sync-log path or drop the "check it first" clause.

### skill-md-and-bootstrap — SKILL.md:66
SKILL.md still describes the existing-workspace gate as a single Grep that short-circuits straight to Phase 0, contradicting bootstrap.md, which requires two independent checks and explicitly warns that a workspace can pass one and fail the other.

**Failure:** SKILL.md is the always-loaded entry point and states the gate as an authoritative two-outcome rule. An agent that has already internalised "grep passed → continue to Phase 0" skips the agent-registry check on a fresh clone (where `.claude/` is empty because gitignore.template:46 ignores it), so `<workspace_root>/.claude/agents/` is never populated and the embedded tutor's "YOUR TEAM" delegation silently has no agents to delegate to at runtime.

**Suggested fix:** Replace the SKILL.md:66 bullet with the two-check summary: "run both gate checks in `references/bootstrap.md` § Core-version gate (core version + agent registry); continue to Phase 0 only when both pass."

### skill-md-and-bootstrap — references/bootstrap.md:140
bootstrap.md (and the placeholder file's own header) claim only T1 and T4 pass against the shipped skeleton and that "T5-T17 fail"; in fact six tests pass (T1, T2, T3, T4, T12, T13), two of them inside the T5-T17 range.

**Failure:** Phase 3 step 4 runs `node test_lesson.cjs src/<slug_snake>.jsx` on the freshly scaffolded skeleton and gets `Results: 6/17 passed, 11 failed`. The instruction says exactly 2 should pass, so the executor treats the mismatch as scaffolding corruption and either re-copies the template or opens an unnecessary debugging loop before assembly begins.

**Suggested fix:** Change both places to the verified statement: "6/17 pass against the shipped placeholder (T1, T2, T3, T4, T12, T13 — the content-independent checks); T5-T11 and T14-T17 fail until Phase 3 assembly writes the real `LessonApp`, `TOPICS`, `TOPIC_CONTEXT`, `LESSON_CONTEXT`, and `GRAPH_SCHEMA`."

### phase-0 — references/phase-0-scoping.md:228
phase-0-scoping.md and update-mode.md give directly contradictory aggressive-default values for `research_depth` on one-liner updates — Phase 0 says never default to `light`, update-mode.md says prefer `light`.

**Failure:** User says "fix the tangent-slope graph in derivatives" (a canonical one-liner, resource_mode full). An agent that read references/update-mode.md §9 first sets `research_depth: light`, so Phase 1 spawns zero research agents and the graph is reworked purely from existing content; an agent that read phase-0-scoping.md sets `targeted` and spawns a research agent. Same request, two different pipelines and two different quality levels, with no way to tell which is correct.

**Suggested fix:** Delete the concrete defaults from references/update-mode.md:196 and point it at phase-0-scoping.md § Aggressive-defaults policy as the single source of truth (or update it to `targeted`/`full` to match line 228).

### phase-0 — references/phase-0-scoping.md:40
Phase 0 asks (in both modes) whether this is a multi-lesson unit and emits `scope_of_lesson: "multi (count: N)"`, but no downstream phase has any multi-lesson procedure — Phase 3 scaffolds exactly one lesson root and one lesson file — so answering "multi-lesson unit" silently yields a single lesson.

**Failure:** User answers "Multi-lesson unit (count: 3)" for a three-part unit. Phase 1 and Phase 2 receive `scope_of_lesson: "multi (count: 3)"` with no instruction on what to do with it, Phase 3 scaffolds the single directory `<course>/claude_lessons/<slug>/` and writes one `src/<slug_snake>.jsx`, and Phase 5 deploys one lesson. The user approved a plan for a 3-lesson unit at the Phase 2 gate and receives one lesson, with nothing in the log flagging the shortfall.

**Suggested fix:** Either remove the multi-lesson option (and the field) until the pipeline supports it, or make Phase 0 state explicitly that `multi` is recorded for context only and the run builds one lesson per invocation — and surface that in the Phase 0 confirmation so the user isn't silently short-changed.

### phase-0 — references/phase-0-scoping.md:123
Phase 0 emits both `course` (declared as the *display* code) and `course_dir` (the directory), but `course_dir` is consumed by nothing and every path template — including Phase 0's own — interpolates `<course>`, so lesson paths get built from the display code.

**Failure:** Q1 free-text follow-up yields display code "MATH 239" for directory `MATH239`. The artifact holds `course: "MATH 239"`, `course_dir: "MATH239"`. Phase 1 is handed only `course`, so `<lesson_root>` resolves to `<workspace_root>/MATH 239/claude_lessons/<slug>/` — a directory that does not exist. Every later read/write (inventory Grep, Phase 3 scaffolding, `lesson_build.log.md`) targets the wrong path, or the agent silently re-derives the directory and the two representations drift.

**Suggested fix:** Pick one: either drop `course_dir` and define `course` as the directory segment with `course_name`/a new `course_display` holding the human string, or keep `course_dir` and change every path template (starting with phase-0-scoping.md:163 and phase-1-content.md:118-119) plus the downstream input lists to interpolate `<course_dir>`.

### phase-1 — references/template.md:229
Phase 1 emits `difficulty: intro | core | stretch` (the values `_lesson-core` actually styles), but the template's canonical `PracticeProblem` pattern that Phase 3 copies documents `easy | medium | hard`, which resolve to unstyled `pp-diff-*` classes.

**Failure:** Phase 3 assembles practice cards by copying the canonical pattern at template.md:227-238 and writes `difficulty="medium"` (or translates Phase 1's `stretch` into `hard` to match the documented enum). The rendered span gets class `pp-diff-medium`/`pp-diff-hard`, which no rule in chat.css.js matches, so the difficulty chip loses its colour coding while the sibling `intro`/`core`/`stretch` cards keep theirs. Nothing in checklists.md or phase-4-review.md checks `difficulty`, so it ships.

**Suggested fix:** Change template.md:229 to `difficulty="core" // optional: intro | core | stretch` to match phase-1-content.md:59 and the `pp-diff-*` rules in `_lesson-core/chat/chat.css.js`.

### phase-2 — references/phase-2-plan.md:52
Both remediation branches of the Step 2.5 capability pre-flight produce something the plan artifact cannot represent: `alternatives` carry no `build_brief`, and the media-row schema has no fallback field (nor does Phase 3 read one).

**Failure:** manim is selected for topic-3 but `ffprobe` is missing from PATH. Main Claude substitutes the alternative (`matplotlib-ref`). There is no `build_brief` for that alternative, so the plan row's `execution_brief` is either a one-sentence rationale or invented by main Claude in violation of line 41 — and Phase 3 (`phase-3-execution.md:56`, "Each spawn prompt = the item's Phase 2 execution brief + the topic's content package") spawns graphics-agent with a one-line brief that was never checked for self-containment. The other branch is worse: an "ordered fallback in the plan row" has no schema slot a

**Suggested fix:** Add `fallback: { medium, specialist, execution_brief }` to the media-row schema at line 137, require the decider to emit a full `build_brief` for the top alternative of any capability-gated medium, and add a Phase 3 rule for consuming the fallback when the capability is still absent at build time.

### phase-2 — references/phase-2-plan.md:385
Aborting at the approval gate in update mode leaves the user's uncommitted work in the Phase 0 stash with no recovery prompt and no OID surfaced, while the abort path asserts the working tree is preserved.

**Failure:** User has uncommitted edits in the lesson root, answers "Stash them and continue" at Phase 0, then aborts at the Phase 2 gate. Phase 5 never runs, so the only stash-recovery prompt never fires. Main Claude reports the abort per step 5 and tells the user the working tree was preserved — but their edits are gone from the tree and sitting in an unnamed stash whose OID was logged but never surfaced.

**Suggested fix:** Add an abort-path step: if the Phase 0 log recorded `stashed: stash@{0} (<oid>)`, offer the same restore prompt Phase 5 step 3 uses (`git stash apply <oid>`), and in all cases print the stash ref + OID in the abort confirmation instead of claiming the tree is preserved.

### phase-2 — references/phase-2-plan.md:70
The DEPLOY block is specified two incompatible ways inside phase-2-plan.md: the compile step and both gate examples emit `Course materials in commit:`, while both artifact-format blocks specify `Private paths` + `Gitignore override:` — so the rendering rules at lines 156-160 govern a line the compile step never tells anyone to write.

**Failure:** Main Claude compiles the plan from Step 4 (line 70) and renders `Course materials in commit:`. The user at the gate therefore never sees the `Private paths (gitignored by default):` enumeration — the one line that tells them which of their files will be withheld from the commit — and the three-way `Gitignore override:` rendering rules at lines 156-160 are unreachable. A main Claude that follows the format block instead produces a plan whose DEPLOY section doesn't match either gate example.

**Suggested fix:** Pick one schema. Recommend keeping `Private paths` + `Gitignore override:` (they carry strictly more information), delete `Course materials in commit` from line 70, and update both gate examples (lines 261, 319) and `phase-5-deploy.md:103` to the same two lines.

### phase-3 — references/phase-3-execution.md:144
Phase 3 asserts three times that the shipped `lesson-template/.gitignore` carries the private-by-default block, but the actual file in the payload contains none of those entries, so the privacy baseline the doc promises is never established and Step 6.5 is written to rubber-stamp it.

**Failure:** New-mode build. Step 6 copies the six-line template `.gitignore`. Step 6.5's wording ("Step 6 already copied ... with the full default block; verify it matches") leads main Claude to confirm the file exists and log ".gitignore already covers all private paths". The lesson ships with no ignore rule for `materials/`, `source/`, `notes/`, `*.local`, `.env*`, `.build-scratch/`, or `lesson_build.log.md`. Phase 5 stages `<lesson_root>/.gitignore` "so the privacy baseline persists in the repo" (phase-3-execution.md:44) — persisting a baseline that protects nothing. Any workspace whose root `.gitignor

**Suggested fix:** Add the nine-entry private-by-default block from references/phase-3-execution.md:20-30 to references/bootstrap/lesson-template/.gitignore, and reword Step 6.5 to "diff the copied file against the convention block and append every missing line" rather than asserting it already matches.

### phase-3 — references/phase-3-execution.md:250
graphics-agent persists matplotlib sources to `<lesson_root>/figures/<media_id>.py` and calls that the refine contract, but `figures/` appears nowhere in phase-3-execution.md: the matplotlib-ref refine input contract hands the specialist a line range from the JSX instead of the persisted `.py`, and neither Step 2 nor the Step 8 log accounts for the file.

**Failure:** Update run refining a matplotlib reference figure. Main Claude builds the spawn prompt from phase-3-execution.md:250 and passes "existing component source extracted by line range from the lesson file" — for a matplotlib-ref that is only `const IMG_BODE = "iVBOR..."` plus a `<RefImg>` call site, not Python. The specialist is never told `<lesson_root>/figures/topic-2-bode-magnitude.py` exists, so it re-authors the plotting script from the brief. The refined figure silently diverges from the original (different axes limits, tick placement, curve constants) while the change-list says "refine", and

**Suggested fix:** Add `figures/<media_id>.py` to the Step 2 exceptions list and the Step 8 "Files written" block, and change the matplotlib-ref refine input contract at :250 to "the persisted script at `<lesson_root>/figures/<media_id>.py` + the current `const IMG_<UPPER_NAME>` value + `refine_brief`", with a documented degrade-to-replace path when the `.py` is absent (mirroring the manim missing-source rule at :260).

### phase-3 — references/template.md:420
The skeleton's `handleContentClick` element selector is narrower than the two selectors in `_lesson-core` that define what is Ctrl-clickable, so `.formula-sheet-box`, `.summary-box`, and `.practice-problem` get the click-to-context affordance (pointer cursor, dashed hover outline, plain-click suppression) but no handler ever fires for them.

**Failure:** A lesson uses `<FormulaSheetBox>` (which template.md:26-27 lists as a supported optional import). With chat open, the student holds Ctrl: chat.css.js:233-234 gives the box a pointer cursor and a dashed hover outline, advertising it as clickable. Ctrl+click on the box label or its non-`<P>` body: `handleContentClick`'s `closest()` returns null, nothing is added to context, no `ctx-flash` fires. Without Ctrl, Chatbot.jsx:215 stops the click anyway. The affordance is dead for all three classes.

**Suggested fix:** Widen references/template.md:420 to `".eq-block, .key-concept, .formula-sheet-box, .summary-box, .practice-problem, .compare-card, .para, .info-list li, .section-title"` (adding the matching `source` labels below it), and add `.practice-problem` to the core capture-gate selector at Chatbot.jsx:215 so the two lists and the CSS agree.

### phase-4 — agents/visual-qa-agent.md:12
visual-qa-agent's motion path depends on inputs the Phase 4 brief never supplies (start/mid/end keyframes) and writes frames to an unnamed `<dir>`, so the documented ffmpeg-unavailable fallback is unreachable and the extraction target is undefined.

**Failure:** ffmpeg is absent (the same condition manim-agent already handles with "manim pipeline unavailable"). The reviewer is told to fall back to "the provided keyframes", but the brief provided only the .mp4, so it has nothing to Read and the motion dimension is scored blind or marked n/a. When ffmpeg is present, `<dir>` is unbound, so extracted PNGs land wherever the agent guesses — plausibly the lesson root or `public/videos/`, polluting the tree Phase 5 commits.

**Suggested fix:** Add `keyframes: [<start>,<mid>,<end>]` (from the manim-agent return recorded in the plan/log) and `frames_dir: <lesson_root>/.build-scratch/qa/<media_id>/` to the visual-QA spawn brief template, and reference `frames_dir` in the ffmpeg command instead of `<dir>`.

### phase-4 — references/phase-4-review.md:153
Static web images are reviewed as first-class artifacts and are now a valid `medium_type`, but the issue-record `medium` enum and the Phase 4 log's per-medium list still have no slot for them, so a finding on a RefImg cannot be recorded or logged without inventing a value. (Remaining half of codex-audit #58 / codex-audit-2 #26; only the `medium_type` list at :84 was fixed.)

**Failure:** scientific-accuracy-agent fails a web-sourced spectrum image (mislabelled axis units). Main Claude must produce an issue record but every `medium` value is wrong and the instruction forbids inventing one; the finding is filed under `svg` or `content` (mis-routing the fix to main Claude instead of a web-image-agent replace), and the per-medium log section has no bullet for it, so the user's final report never shows the image was reviewed.

**Suggested fix:** Add `"image"` to the `medium` enum at :153 and a `- Static images: [...]` bullet to the log skeleton at :277-280.

### phase-5 — references/phase-5-deploy.md:352
`git stash drop <oid>` is not a valid command — `drop` requires a `stash@{n}` reference, not the raw OID the pipeline records — so the documented stash cleanup fails every time and the stash is never removed.

**Failure:** Update-mode run with a Phase 0 stash. User answers `Yes, restore now`. `git stash apply <oid>` succeeds and the work is restored, then `git stash drop <oid>` errors out. The agent either surfaces a spurious failure at the very end of a successful deploy, or logs `Stash recovery: applied + dropped (<oid>)` as instructed while the stash entry is still on the stack — leaving a duplicate copy of the user's changes that the next run's `stash@{0}` lookups will trip over.

**Suggested fix:** Resolve the OID back to its stash slot before dropping, e.g. `ref=$(git stash list --format='%gd %H' | awk -v o=<oid> '$2==o{print $1; exit}')` then `git stash drop "$ref"`, and halt with the OID if no slot matches (the entry was already dropped). Keep `git stash apply <oid>`, which does accept a raw stash-like commit.

### phase-5 — references/phase-5-deploy.md:383
The documented merge-conflict recovery `git checkout main && git merge --abort` cannot work: with unmerged index entries `git checkout` refuses, so the `&&` short-circuits and `merge --abort` never runs, leaving the repo mid-merge.

**Failure:** A stale `main` (e.g. a hotfix touching the same lesson file) makes `git merge --no-ff lesson-update/<slug>-20260727` conflict. Phase 5 halts and hands the user the recovery line verbatim. The user runs it, gets `error: you need to resolve your current index first`, and is left on `main` with an in-progress conflicted merge — exactly the state the rollback section promises to avoid — while the report claims branch and stash are intact and recoverable.

**Suggested fix:** Drop the `git checkout main &&` prefix — the shell is already on `main` at that point. The recovery line should be `git merge --abort` (optionally `git merge --abort || git reset --merge`), followed by `git checkout <recorded branch name>` if the user wants to iterate on the update branch.

### phase-5 — references/phase-5-deploy.md:370
The Phase 5 log schema and final-report template both enumerate `auto-popped` as a stash-recovery outcome, a value the procedure can never produce and which names the exact operation the procedure forbids.

**Failure:** An agent writing the Phase 5 log section reads the schema at :370/:496, finds no slot for `applied + dropped`, and either writes `auto-popped` (implying a `git stash pop` that never happened, so a later reader cannot tell whether the stash was popped positionally or applied by OID) or invents a fourth value, breaking the field-name/value contract Phase 0 relies on when it re-reads prior log entries (references/phase-0-scoping.md:228 carries deploy fields forward by literal field name).

**Suggested fix:** Change all three enumerations to `applied + dropped (<oid>) | manual | conflict (manual) | none` to match the procedure at :357-:359.

### update-mode — references/update-mode.md:137
§5's stash invariant still prescribes `git stash pop` gated on a successful merge, while phase-5 was fixed to require `git stash apply <recorded OID>` and to run recovery under every `deploy_action` including build failure.

**Failure:** User stashes dirty work at Phase 0, then stashes something unrelated in another terminal during the long Phase 3/4 run. Phase 5 follows update-mode.md's invariant and runs `git stash pop`, restoring the unrelated newer stash onto main and dropping it, while the user's actual pre-update work stays buried at stash@{1} with the recorded OID now unreferenced in the report. Under `deploy_action: commit-only` no merge happens at all, so "after a successful merge" also means the prompt never fires and the stash is silently stranded.

**Suggested fix:** Replace the sentence with the phase-5 contract: recovery prompts under every `deploy_action` (including after a build-verification halt), applies the recorded OID via `git stash apply <oid>` + `git stash drop <oid>`, and never uses bare `pop`.

### update-mode — references/update-mode.md:196
§9 tells the agent to default a casual one-liner update to `research_depth: light`, which phase-0 explicitly forbids and which SKILL.md's quality policy classes as a silent downgrade requiring an explicit user signal.

**Failure:** User types "fix the tangent-slope graph in intro-derivatives" with no cost signal. Main Claude reads update-mode.md first, sets `research_depth: light`, and Phase 1 skips re-research entirely — the stale equation that motivated the request is never re-verified against sources, and the run ships a cosmetically-fixed but still-wrong graph under the default `resource_mode: full`.

**Suggested fix:** Change §9's default from `light` to `targeted` (named component/topic) or `full` (unnamed), matching phase-0-scoping.md:228, and note that `light` requires `resource_mode: "limited"` or an explicit shallow-pass request.

### update-mode — references/update-mode.md:27
The §2 inventory pre-scan enumerates every media kind new mode can author except `<DesmosGraph>` embeds and `PracticeProblem` blocks, so those media are invisible to the decider, get no verdict, and escape the §6 no-grandfathering coverage that claims to cover all post-update media.

**Failure:** A lesson built in new mode with a `<DesmosGraph>` embed and a per-topic practice block is updated. The pre-scan returns no entry for either, so `medium-decider-agent` emits no verdict for them, Phase 3 never touches them, and Phase 4's no-grandfathering sweep has no artifact to review — a Desmos embed whose `state` was broken by a numeric-vs-string regression (the documented silent-crash footgun) ships unreviewed while the run reports full media coverage.

**Suggested fix:** Add `<DesmosGraph` (with the `state` prop location) and `<PracticeProblem` to the §2 capture list, add `desmos-graph` and `practice-problems` to the phase-2 `existing_media` kind enum, and give both a `keep|refine|replace|remove` route (specialist `null`, main Claude authors) so no-grandfathering can actually cover them.

### agent-contracts — agents/content-review-agent.md:7
content-review-agent states it is spawned by content-orchestrator-agent, but the orchestrator has no Agent tool and is explicitly forbidden from spawning; Phase 1 assigns that spawn to main Claude.

**Failure:** Main Claude reads the agent registry to plan Phase 1, sees content-review-agent declares the orchestrator as its Phase 1 caller, and treats step 6 as already covered by the orchestrator spawn — the Phase 1 review never runs. The named 'dialogue loop' also no longer exists (phase-1-content.md:34 defines "at most 2 corrective rounds"), so the agent is told to operate in a loop it will never be placed in.

**Suggested fix:** Rewrite line 7 to: "Spawned by main Claude in Phase 1 (post-synthesis review of the compiled package) and again in Phase 4 review" — main Claude owns every spawn; subagents cannot spawn subagents.

### agent-contracts — agents/visual-qa-agent.md:11
visual-qa-agent declares it receives "SVG source", but the Phase 4 spawn brief passes a component name in `artifact_path` and no lesson file path, and the agent has neither Grep nor Glob to resolve it.

**Failure:** A lesson with 5 SVG graphs fires 5 visual-qa spawns whose `artifact_path` is `DiodeIVGraph` — not a path. With only Read and Bash and no lesson file path in the brief, the agent has to guess the lesson root and shell out to grep; when the guess fails it scores geometry/colour/readability on an artifact it never saw, or returns findings against nothing while Phase 4 records it as covered QA.

**Suggested fix:** Add `lesson_path` to the Phase 4 visual-QA spawn brief (phase-4-review.md:84-90) and restate the agent's Inputs to say `artifact_path` is a component name plus `lesson_path` for JSX-embedded media; or grant Grep/Glob so the agent can resolve a component name itself.

### test-suite-and-checklists — references/bootstrap/lesson-template/test_lesson.cjs:51
The shipped T3 fails the exact escaping the KaTeX-safety checklist mandates, and disagrees with the T3 raw command in the same checklist document, so a correctly-authored heading is reported as a blocker.

**Failure:** Phase 3 writes `<h4>{"Saturation: VDS > Vov"}</h4>` — the fix checklists.md:18 and the escaping table at :29 explicitly require. Verified with @babel/parser: it parses fine (`wrapped-gt-in-h4 -> PARSES OK`). code-review-agent's T3 raw command (checklists.md:243) reports T3 PASS because `grep -v '{"'` drops the line. `node test_lesson.cjs` then reports `FAIL: T3 — No bare angle brackets in heading text` (verified: the .cjs regex matches `<h4>{"Region: VDS > Vov"}</h4>`). Per references/phase-4-review.md:169 every failing test is recorded at severity blocker, confidence 1.0, and :190 puts it fir

**Suggested fix:** Add the `{"` exclusion to the .cjs regex so it only flags genuinely bare brackets, e.g. skip any matched heading whose inner text contains a `{".."}` expression container — matching the behaviour of the T3 command already documented at checklists.md:243.

### test-suite-and-checklists — references/checklists.md:56
The template-compliance checklist tells reviewers THEMES_G must be imported from `@core/constants`, a specifier the Vite alias cannot resolve — applying the checklist breaks the dev server and the production build.

**Failure:** A Phase 4 code-review agent or an update-mode agent runs the template-compliance checklist against a lesson that (correctly, per template.md:22) imports THEMES_G from `@core`, sees checklists.md:56 unsatisfied, and rewrites the import to `import { THEMES_G } from "@core/constants";`. The alias expands that to `<workspace>/_lesson-core/constants`, a directory with no index and no extension-matched sibling file, so Vite fails with "Failed to resolve import" — `npm run dev` and the Phase 5 build both fail. A grep across the whole repo shows `@core/constants` appears nowhere except this checklist 

**Suggested fix:** Change checklists.md:56 to `THEMES_G` imported from `@core` (matching template.md:22 and the barrel at index.js:22), or add `_lesson-core/constants/index.js` re-exporting themes.js and models.js if subpath imports are actually wanted.

### test-suite-and-checklists — references/bootstrap/lesson-template/test_lesson.cjs:170
T14 only checks TOPICS ids -> TOPIC_CONTEXT keys, never the reverse, but four separate places state it enforces a one-to-one invariant and one of them defers the orphan check to it entirely.

**Failure:** Demonstrated empirically: I extracted the canonical skeleton (references/template.md:18-712) to skeleton.jsx and ran the shipped suite. Its TOPIC_CONTEXT declares `"topic-1"`, `"topic-2"` and `"graph-preview"` (template.md:76-79) while TOPICS contains only the `graph-preview` entry (template.md:293-310) — two orphan context keys. Result: `PASS: T14` / `Results: 17/17 passed, 0 failed`. In update mode this is the live case: an approved `remove topic-3` action deletes the TOPICS entry, the splice agent forgets the TOPIC_CONTEXT entry, checklists.md:377 tells it that T14 re-checks the invariant, 

**Suggested fix:** Either add the reverse comparison to T14 (fail on any ctxKey not present in topicIds, reporting it as an orphan), or restate checklists.md:266, :377, :397 and template.md:720 as "every TOPICS id has a TOPIC_CONTEXT entry" and keep the orphan check as an explicitly manual splice item.

### test-suite-and-checklists — references/bootstrap/lesson-template/test_lesson.cjs:181
T15 is a bare substring test for the token `useKatex`, but both suite summaries and the template-compliance checklist state it verifies an import from `@core` and that there is no manual CDN link injection.

**Failure:** A legacy or hand-migrated lesson defines its own hook locally: `function useKatex(){ const l = document.createElement("link"); l.href = "https://cdn.jsdelivr.net/npm/katex/dist/katex.min.css"; document.head.appendChild(l); ... }` and never imports it from `@core`. Verified: `/useKatex/.test(...)` returns true on that string, so T15 passes. T8 also passes as long as any `from "@core"` import exists anywhere and the token `Chatbot` appears. The "no manual CDN `<link>` tag injection" rule at checklists.md:55 is therefore entirely unenforced while three documents assert a test covers it.

**Suggested fix:** Make T15 mirror T17: `/import\s*\{[^}]*useKatex[^}]*\}\s*from\s*["']@core["']/`, and optionally reject `katex.min.css` appearing in the lesson file.

### test-suite-and-checklists — references/bootstrap/lesson-template/test_lesson.cjs:102
T11 tests for the literal token sequence `Eq,` anywhere in the file rather than for an `@core` import, which false-fails a valid import ordering and false-passes a lesson that never imports Eq at all.

**Failure:** Two verified cases. False positive: a lesson written as `import { Chatbot, KeyConcept, useKatex, P, M, Eq } from "@core";` — correct, imports all three from @core, but `Eq` is last with no trailing comma, and `<Eq>` usages produce `Eq>` not `Eq,`. Probe returns `false`, so T11 fails a compliant lesson and Phase 4 records a blocker (phase-4-review.md:169). False negative: `import { Chatbot, KeyConcept } from "@core";` plus `const [showEq, setShowEq] = useState(false);` — Eq is never imported, `<Eq>` is never used, yet the probe returns `true` because `showEq,` matches `/Eq\s*,/`. Neither `KeyCo

**Suggested fix:** Use the T17-style import regex against the `@core` specifier for each of `Eq`, `KeyConcept`, `Chatbot` with a word boundary (`/\bEq\b/` inside the captured brace list), instead of the positional `Eq\s*,` token test.

### chat-runtime — references/bootstrap/_lesson-core/chat/Chatbot.jsx:516
KILL sets the tab to `sessionStatus: "idle"` with `sessionId: null` while leaving messages in place; nothing re-creates a session for an idle tab, the session-picker UI only renders when `messages.length === 0`, and `sendMessage` returns silently — so the tab is permanently unusable with zero feedback.

**Failure:** A tutor turn hangs on a long Bash call, the student clicks KILL (title: "Kill session and stop all processes"). The transcript keeps its history plus "Session killed.", `sessionStatus` is `"idle"` and `sessionId` is null. The student types a new question and presses Enter: `sendMessage` hits the guard at line 525 and returns with no bubble, no error, no status text — the chat appears frozen. Because `messages.length > 0`, neither the `picking` session-picker nor the `idle` "Starting session..." empty state renders, and no effect creates a replacement session, so there is no in-tab route back. 

**Suggested fix:** In `killSession`, set `sessionStatus: "picking"` and change the picker/empty-state gates at Chatbot.jsx:1063 and 1078 to render on `sessionStatus === "picking"` regardless of `messages.length` (as a footer under the transcript), or call `createSessionForTab(activeTab.id)` after the kill. Also give `sendMessage`'s early return a visible reason when `sessionStatus !== "ready"`.

### chat-runtime — references/bootstrap/_lesson-core/chat/Chatbot.jsx:575
`obsQueue.drain` clears the queue before the request is made and there is no re-enqueue path, so every turn that fails after the drain — non-2xx response, network error, or user cancel — permanently discards the queued edit-rejection / demo-lint / desmos-lint / stuck observations.

**Failure:** The tutor emits an `<<EDIT_GRAPH>>` with `nMax: 12` against a schema whose max is 6. `processResponse` rejects it and `onError` enqueues an `edit-rejection` observation listing the exact reason. The student's next message drains that observation into the request body, but the proxy is restarting and returns 502 — the code appends "API error (502)" and returns. The correction is gone from the queue forever, so on retry the model has no idea its edit was rejected and re-emits the same out-of-range value. The same loss happens if the student's next interaction is a thread reply: the main queue is

**Suggested fix:** Add `observationQueue.requeue(sessionId, text)` (unshift onto `preambles`) and call it from the `!res.ok` branch and the catch in `sendMessage`; in `sendThreadMessage`, either skip the drain entirely or requeue on completion so main-conversation observations survive a thread turn.

### chat-runtime — references/bootstrap/_lesson-core/chat/Chatbot.jsx:182
The keep-context save strips `_streaming` from main-tab messages by rebuilding each object, but copies thread messages wholesale, so a thread message persisted mid-stream is restored with `_streaming: true` forever — permanently disabling reply-block capture and Desmos hydration for that bubble.

**Failure:** KC is on. A thread reply is streaming when the student reloads the page (or the Vite HMR reload fires). The last thread assistant message was saved with `_streaming: true`. On resume, `resumeSessionIntoTab` loads it verbatim and ThreadPanel renders it with `streaming={true}`. ChatBubble's block-wrapping effect bails at line 229, so nothing in that thread reply carries `data-chat-block` — Ctrl-click-to-context and "Reply in this thread" silently do nothing on it — and the Desmos mount effect bails at line 273, so any `<<DESMOS>>` block in that reply stays an empty placeholder div permanently.

**Suggested fix:** Sanitize thread messages the same way as top-level ones in the save at Chatbot.jsx:182, e.g. `m.threads.map(t => ({ ...t, loading: false, messages: t.messages.map(tm => ({ role: tm.role, content: tm.content })) }))`.

### chat-runtime — references/bootstrap/_lesson-core/chat/Chatbot.jsx:174
The `chatMsgs_*` and `chatReinf_*` sessionStorage writers are keyed on `activeTab` only, so a keep-context tab that receives a streamed reply while the user is looking at another tab is never written back; a reload restores that tab's transcript from whenever it was last the active tab.

**Failure:** With KC on, the student asks a long question in tab #2, switches to tab #1 while it runs, reads there, then reloads (or the dev server HMR-reloads). Tab #2's completed answer and any `<<REINFORCE>>` heuristics merged into `reinforced` at Chatbot.jsx:657-671 were written only into React state — the persistence effects never fired for #2 because it was never the active tab afterwards. On reload, `resumeSessionIntoTab` restores #2's stale transcript, so the student sees their question with no answer, and the session's reinforced-behaviour list silently regresses to the older snapshot.

**Suggested fix:** Persist per tab rather than per active tab: iterate `tabs` in one effect keyed on `[tabs]` and write `chatMsgs_<sessionId>` / `chatReinf_<sessionId>` for every tab with `keepContext && sessionId`, or write directly from the completion handler in `sendMessage` where `tabId` is already in scope.

### proxy-and-runner — references/server-template.md:117
`server-template.md` tells the agent to copy `vite.config.js` verbatim and then prints a stale copy whose proxy table omits `/commit` — reproducing the exact bug the shipped file's comment says was just fixed.

**Failure:** Phase 3 assembly (or update mode repairing a `vite.config.js` per server-template.md:280) hand-writes the config from the doc snippet instead of copying the shipped file. The lesson then dev-serves fine, the tutor emits `<<COMMIT_SUGGEST>>`, the student clicks the commit chip, and the POST to `/commit` is answered by Vite with a 404 HTML page — `handleCommit` shows `commit failed (404)` with no indication the route was never proxied. Nothing in the 17-test suite or Phase 4 catches it.

**Suggested fix:** Add `"/commit": `http://localhost:${getProxyPort()}`,` to the snippet at server-template.md:118 and add `/commit` to the route lists at :127 and :272 — or replace the snippet with a pointer to the shipped file so there is one source of truth.

### proxy-and-runner — references/bootstrap/_lesson-core/server/proxy.js:559
`lastSeen` is refreshed only by `/chat` and `/session/open`, and there is no client keepalive, so the 2-minute heartbeat marks a session that is genuinely open in a live tab as available — defeating the single-tab exclusivity guard during ordinary reading.

**Failure:** Student opens the lesson, asks a question, then reads the answer for three minutes (normal for a lesson app). The heartbeat flips `open` to false. They open the same lesson in a second browser window (or restore it after a crash-looking blank tab): the picker now lists the still-live Chat #1 as available, `/session/open` returns 200 instead of 409, and two windows drive the same CLI session — interleaved turns into one Claude history, both writing divergent `chatMsgs_<sid>` sessionStorage, and a `keepContext:false` close in either window deletes the session out from under the other.

**Suggested fix:** Have the open client touch the session (a cheap `POST /session/ping` or `GET /sessions?touch=<id>` on an interval well under the timeout) and/or raise the release window well above a plausible reading gap; do not treat "no message sent" as "tab gone".

### proxy-and-runner — agents/manim-agent.md:69
The manim agent contract states the pipeline deletes its scratch copy; `manim-runner.js` contains no deletion at all, so scratch (full manim `media/` tree + 720p mp4 + PNGs) accumulates per render forever — and if the claim were true the `keyframes` paths the same contract requires the agent to return would be dangling.

**Failure:** Every manim render (including each of the up-to-4 in-spawn revisions) leaves a complete manim `media/` tree plus the rendered mp4 under `_lesson-core/helpers/manim_scratch/<ts>_<rand>/`, gitignored and unbounded — tens of MB per animation across a course. Separately, an agent that believes the claim may copy or re-derive keyframes before returning, or treat the returned keyframe paths as already-invalid and report `keyframes: []`, breaking the visual-QA handoff.

**Suggested fix:** Either make `runManimPipeline` delete `scratchDir` on success after promoting the mp4 AND copy `previewPngPath`/`keyframePaths` next to the target before deleting, or fix manim-agent.md:69 to say the scratch dir is retained (and that the returned keyframe paths point into it) and add an explicit prune step.

### bootstrap-payload — references/server-template.md:113
server-template.md's "copy verbatim" vite.config.js snippet omits the `/commit` proxy route that the shipped payload carries, re-documenting the exact regression the payload's own comment warns about.

**Failure:** Update mode, per references/server-template.md:278-280, is authorized to edit `vite.config.js` when it drifts. An agent diffing an existing lesson against the snippet in server-template.md (the doc it was pointed at for "what each file is for") sees `/commit` as an extra unlisted route and removes it. The chatbot's commit chip then POSTs `/commit`, Vite 404s it same-origin, and the approval silently does nothing — the identical bug called out in codex-ultra-deep-review.md:90 and fixed only in the payload.

**Suggested fix:** Add `"/commit": \`http://localhost:${getProxyPort()}\`,` plus the payload's warning comment to the snippet at references/server-template.md:113-118, and add `/commit` to the route list at line 127.

### bootstrap-payload — references/bootstrap/lesson-template/package.json:16
The lesson template ships `@babel/preset-react` solely for a post-splice sanity command that cannot run, because neither `@babel/cli` nor `@babel/core` is a declared dependency — `npx babel` has no local bin to resolve.

**Failure:** Update-mode Step 4.6 (the "backstop against silent splice corruption") runs `npx babel src/foo.jsx --presets @babel/preset-react --no-babelrc` in a lesson installed from this package.json. `node_modules/.bin/babel` does not exist, so npx falls through to fetching the registry package named `babel` (the deprecated Babel-5 shim) and errors. The agent either reports a false splice failure or, reading "(or the equivalent parse-only call)", silently skips the only structural check standing between a corrupted splice and Phase 4.

**Suggested fix:** Replace the command at references/phase-3-execution.md:380 with `node test_lesson.cjs src/<slug_snake>.jsx` (T1 is the same parse, using the already-declared `@babel/parser`), and drop `@babel/preset-react` from references/bootstrap/lesson-template/package.json — or add `@babel/cli` + `@babel/core` if the CLI form is wanted.

### bootstrap-payload — references/bootstrap/lesson-template/package.json:18
The `katex` devDependency is never imported by any code in the payload, and its pin (`^0.16.44`) disagrees with the version `useKatex` hard-codes in its CDN URL (`0.16.21`), so the documented rationale for shipping it is false.

**Failure:** A KaTeX rendering bug appears in a lesson. Following server-template.md:73, the agent bumps or pins `katex` in the lesson's package.json and re-runs `npm install`, expecting the rendered output to change. Nothing changes — `window.katex` is always jsdelivr's 0.16.21 — and the real fix (editing the hard-coded CDN version in `_lesson-core/hooks/useKatex.js`) is never found.

**Suggested fix:** Either bundle KaTeX for real (import it in `useKatex.js` so the npm pin is load-bearing), or drop the `katex` devDependency and correct references/server-template.md:73 to state that the hook fetches a hard-pinned CDN build from `_lesson-core/hooks/useKatex.js:11,14`.

### bootstrap-payload — references/server-template.md:72
The documented reason the lesson template declares `express` + `cors` as runtime dependencies is impossible under Node ESM resolution — the importing module lives in `_lesson-core/server/`, and resolution never descends into the lesson's `node_modules`.

**Failure:** Bootstrap Step 2 is skipped or a fresh clone leaves `_lesson-core/node_modules` absent. `npm run proxy` from the lesson root dies with `ERR_MODULE_NOT_FOUND: Cannot find package 'express'`. The agent checks the lesson's `node_modules`, finds express present, reads server-template.md:72 confirming that should be sufficient, and hunts the wrong cause instead of running `npm install` in `_lesson-core/`.

**Suggested fix:** Rewrite references/server-template.md:72 to state that the proxy's `express`/`cors` resolve only from `_lesson-core/node_modules` (or above) and that `_lesson-core` must be `npm install`ed; either drop the two entries from references/bootstrap/lesson-template/package.json:10-13 or label them as unused-by-the-proxy.

### bootstrap-payload — references/bootstrap/lesson-template/src/__SLUG_SNAKE__.jsx:4
Both the placeholder lesson file and bootstrap.md state that only T1 and T4 pass against the shipped scaffold and that T5-T17 all fail; T2, T3, T12 and T13 also pass, so the scaffold verification step reports 6/17 where the docs predict 2/17.

**Failure:** Phase 3 scaffolding step 4 (references/bootstrap.md:140) runs `node test_lesson.cjs src/<slug_snake>.jsx` on the fresh copy and sees `Results: 6/17 passed, 11 failed`. Expecting 2/17, the agent treats the extra passes as evidence the scaffold or the test suite is wrong and starts a spurious drift investigation before Phase 3 assembly has written any content.

**Suggested fix:** Correct both places to "T1-T4, T12 and T13 pass (6/17); the content-dependent tests T5-T11 and T14-T17 fail until Phase 3 assembly runs."

### cross-doc-single-source — references/graph-schema-guide.md:12
Three normative docs state that a lesson without GRAPH_SCHEMA silently BYPASSES validation and lets arbitrary LLM edits into React state; the runtime validator now fails CLOSED and rejects every edit with an observation.

**Failure:** Update mode on a legacy lesson with no GRAPH_SCHEMA: the tutor emits <<EDIT_GRAPH>>, processResponse gets zero validValue plus an edit-rejection observation, and the user reports "the chatbot can't change the graph". Main Claude, reading graph-schema-guide.md §1/§7 and checklists.md:193, believes the opposite (edits pass through unvalidated) and hunts for a merge/render bug instead of backfilling the schema — or "repairs" graphSchema.js back to the fail-open behaviour the docs describe, reintroducing arbitrary model mutation of graph state.

**Suggested fix:** Rewrite graph-schema-guide.md §1 and §7 and checklists.md:193 to state the actual behaviour: missing GRAPH_SCHEMA disables graph edits entirely and returns the "no GRAPH_SCHEMA" rejection reason verbatim; keep graphSchema.js as the single source of truth for validator semantics.

### cross-doc-single-source — references/server-template.md:113
server-template.md reproduces the Vite proxy route table without `/commit`, contradicting the canonical vite.config.js that ships it and warns explicitly that omitting a route silently breaks the commit chip.

**Failure:** Update mode hits server-template.md:280's repair trigger ("`vite.config.js` … is missing `envDir`") on an older lesson. Main Claude repairs the file from the snippet the doc presents as copy-verbatim canonical, producing a config with only four proxy entries. Dev server comes up, all tests pass, and the tutor's commit chip 404s on every approval — exactly the bug the canonical file's comment says took months to find.

**Suggested fix:** Delete the inlined vite.config.js snippet (and the four-route list at :127 and :272) from server-template.md and point at references/bootstrap/lesson-template/vite.config.js, or regenerate the snippet from that file; the route list must have exactly one home.

### cross-doc-single-source — references/phase-4-review.md:54
Phase 4's build+test step and the checklists summary invoke `node test_lesson.cjs` with no file argument; the runner requires argv[2] and exits 1 with a usage line, so the deterministic test gate produces no test results.

**Failure:** Phase 4 runs the documented block literally: the command prints "Usage: node test_lesson.cjs <file.jsx>" and exits 1. Per the normalization table (phase-4-review.md:169) a non-zero test run maps to blocker records, so a healthy lesson enters the fix loop with a phantom deterministic failure and no per-test breakdown to drive the "test pass rate must increase" metric.

**Suggested fix:** Change both call sites to `node test_lesson.cjs src/<slug_snake>.jsx` (or `npm test`, whose package.json script already passes the path) and keep the argument form identical to bootstrap.md and code-review-agent.md.

### cross-doc-single-source — references/checklists.md:132
The documented default height for `<DesmosGraph>` (400 px, stated in the checklist and in the component's own docblock) does not match the code default of 520.

**Failure:** An author omits `height` expecting the documented 400 px box and lays the topic out around it; the embed renders 520 px tall, pushing following content below the fold in the visual-QA screenshot and producing a layout finding whose stated cause ("height not set, default 400") is wrong.

**Suggested fix:** Update the DesmosGraph.jsx docblock and checklists.md:132 to 520, or change the code default to 400 — one value, asserted in the component signature and referenced (not restated) by the checklist.

