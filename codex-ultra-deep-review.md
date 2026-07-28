# Lesson Builder ultra-deep architecture review - 2026-07-22

## Executive verdict

The skill is not yet the best version of this pipeline. Its judgment model is unusually thoughtful: backward design, evidence-aware research, a whole-lesson media portfolio, one meaningful approval gate, independent review lenses, producer-owned media repair, and deterministic-first fixing are all sound choices.

Its limiting factor is the execution substrate. Roughly 2,400 lines of phase prose act as a distributed workflow engine, while Markdown, model context, filenames, and free-form agent returns act as the database and message bus. That makes a sophisticated happy path, but not a reliably resumable or reproducible system. A literal executor can obey each local instruction and still violate the end-to-end transaction.

The highest-leverage redesign is not another reviewer or more prompt detail. It is:

1. A typed, idempotent run controller.
2. Durable evidence, plan, artifact, issue, and release records.
3. One isolated worktree and staging namespace per run.
4. Modular lesson source assembled from manifests rather than edited as one giant JSX file.
5. A strict separation between the read-only student tutor and the privileged authoring copilot.
6. Typed actions and safe rendering instead of model-authored control tags and HTML.
7. Outcome-based, multi-trial evaluations for both the builder and tutor.

There are also current P0 failures that should be fixed before broader redesign: Phase 1 depends on unsupported nested subagents; the local tutor proxy is network-facing and unauthenticated; model output can execute script in the lesson origin; streaming can execute graph edits repeatedly; stop/kill does not stop the agent process; SSE parsing loses events at legal chunk boundaries; the commit endpoint is not proxied; and tutor-authored equations use a prop the real component does not accept.

## Review basis

This review covered the working-tree pipeline documents, agent definitions, bootstrap/runtime implementation, lesson template, build/deploy substrate, graph and media helpers, and the existing audit reports. It is a static architecture and contract review; I did not run the pipeline or application.

The external research pass used current primary sources and official documentation. The main design conclusions align with:

- Anthropic's recommendation to prefer simple, composable workflows and add agentic complexity only when it measurably improves results: [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents).
- Anthropic's guidance to minimize fixed context, use progressive disclosure, compact long histories, and persist structured state outside the context window: [Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) and [Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills).
- Anthropic's finding that multi-agent systems are strongest for breadth-first independent work, while dependency-heavy coding tasks are a weaker fit and consume far more tokens: [Multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system).
- Current Claude Code contracts for subagents, worktree isolation, tool allowlists, hooks, effort, and turn caps: [Claude Code subagents](https://code.claude.com/docs/en/sub-agents) and [hooks](https://code.claude.com/docs/en/hooks).
- The separation of durable session history, replaceable harness logic, and sandbox boundaries: [Scaling Managed Agents](https://www.anthropic.com/engineering/managed-agents).
- Outcome and trajectory evaluation with code, model, and human graders rather than one shallow test layer: [Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents).
- Environment-level containment and least privilege as the primary agent security boundary: [How we contain Claude](https://www.anthropic.com/engineering/how-we-contain-claude).
- Typed tool contracts and structured outputs instead of parsing free-form decisions: [Writing effective tools](https://www.anthropic.com/engineering/writing-tools-for-agents) and [Claude structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs).
- Tutor evaluation across mistake diagnosis, answer revealing, guidance, actionability, coherence, and tone: [Unifying AI Tutor Evaluation](https://aclanthology.org/2025.naacl-long.57.pdf) and multi-turn tutoring behavior: [KMP-Bench](https://ojs.aaai.org/index.php/AAAI/article/view/40578).

## What should remain

- Backward design from learner objectives and misconceptions.
- One whole-lesson medium decision. Per-topic media deciders cannot coordinate redundancy or diversity.
- A single routine human approval at the plan boundary.
- Stable topic and media IDs, original intent, and explicit update verdicts.
- Independent presentation and scientific-correctness lenses.
- Read-only reviewers and producer-owned media repair.
- Deterministic failures before judgment-based review.
- Private-by-default deployment and explicit privacy escalation.
- Browser verification of built output rather than source-only confidence.
- No-grandfathering as a policy goal, implemented through attestations rather than repeated full reviews.

## Immediate blockers

### P0. Phase 1's sub-orchestrator cannot perform its assigned job

`agents/content-orchestrator-agent.md:4-7` grants `Agent` and says the main Claude spawns this agent so it can spawn deep-review, research, and content-review agents. The procedure repeats the nested spawning at lines 21-25. Current Claude Code documentation states that subagents cannot spawn other subagents. A literal run reaches Phase 1, creates the orchestrator, and then cannot execute the research topology at all.

**Immediate fix:** have the main session or a deterministic controller own the fan-out. Retire the nested orchestrator role; keep synthesis as a separate task over persisted worker outputs.

### P0. The tutor proxy is an unauthenticated command-capable network service

`references/bootstrap/_lesson-core/server/proxy.js:29-37` allows requests without an `Origin`; lines 54-75 grant Bash, Edit, Write, web, browser, and Agent tools; lines 128 and 150 spawn Claude through a shell; line 533 calls `app.listen(port)` without a loopback host. The stateless `/chat` path accepts caller-supplied content, and caller-supplied system text is placed in shell-backed argv. A LAN caller, local malicious page, or XSS can spend tokens, modify files, and run commands.

**Immediate fix:** bind only to `127.0.0.1`; require a random per-launch bearer and CSRF token on every route; remove the stateless full-tool path; avoid `shell:true`; pass prompts through a non-shell channel; default tutoring to read-only tools.

### P0. Model output can execute script in the privileged lesson origin

`processResponse.js:146-175` accepts SVG and source HTML with only superficial SVG checks. `ChatBubble.jsx:74-78` preserves raw `svg`, `img`, and `video` blocks before escaping, then line 225 assigns the result to `innerHTML`. Event handlers, `foreignObject`, unsafe URLs, and external loads are not rejected. Prompt-injected content can emit an `onerror` or SVG handler and call the local `/sessions`, `/chat`, or `/commit` endpoints.

**Immediate fix:** parse Markdown to an AST and render React nodes; sanitize SVG with a strict allowlist; reject all handlers, scriptable elements, unsafe URL schemes, and external references; add CSP and Trusted Types. Do not restore model-authored HTML after escaping.

### P0. Streaming executes completed graph actions more than once

`Chatbot.jsx:628-631` calls the side-effecting response parser after every text event, and lines 647-648 call it again at completion. `processResponse.js:123-140` applies every complete `EDIT_GRAPH` it sees. Once a tag closes, every later chunk reapplies it, increments render state, and queues another review observation.

**Immediate fix:** keep prefix rendering pure. Parse and dispatch actions once from the canonical completed response, with a unique action ID and idempotency ledger.

### P0. Stop and kill do not stop work

`Chatbot.jsx:495-505` aborts the HTTP reader, while `proxy.js:413-416` explicitly leaves the Claude process running. Bash, file edits, and subagents can continue for the 30-minute process timeout after the UI says generation was stopped or the session was killed. The hidden completion also enters the resumed Claude history.

**Immediate fix:** retain process-tree handles and expose a cancellation endpoint. Run each turn as a candidate session and promote it only on successful completion; cancellation kills the candidate and retains the last visible session state.

### P0. The SSE parser discards valid events

`Chatbot.jsx:609-643` and `903-924` reset `eventType` for every network read. If a chunk ends after `event: text\n`, the following chunk's `data:` line is discarded. Missing text and missing `done` events are therefore dependent on arbitrary transport chunking.

**Immediate fix:** use a tested SSE parser, or persist event name and accumulated data across reads. Fuzz every possible byte split in tests.

### P0. The commit UI calls a route Vite never proxies

`Chatbot.jsx:733` posts to `/commit`, and `proxy.js:452` implements it. `references/bootstrap/lesson-template/vite.config.js:31-35` proxies only `/chat`, `/upload`, `/session`, and `/sessions`. In normal lesson dev mode, approval of a commit suggestion reaches Vite and returns 404.

**Immediate fix:** generate the Vite proxy table from one endpoint manifest and add a route-contract test. Do not maintain route lists independently.

### P0. Tutor augmentation generates blank equations

`buildSystemPrompt.js:87` and `prompts/lesson-augmentation.md:35` teach the model to emit `<Eq m={...}/>`; `ui/Eq.jsx:4` accepts `children`, not `m`. An approved lesson augmentation can add an equation that renders empty while the current regex suite still passes.

**Immediate fix:** generate prompt examples and component documentation from typed component metadata, and add a rendered contract test for every model-addressable component.

## Structural diagnosis

### 1. Prose is doing the controller's job

The phase documents encode branching, retries, state transitions, recovery, scheduling, file ownership, and release semantics. Models are being asked to simulate a workflow engine from distributed prose. That creates four classes of failure:

- Local instructions conflict after one file changes.
- State disappears at compaction, interruption, or fresh spawn boundaries.
- “Done” means the model remembers doing something, not that an artifact proves it.
- Recovery is a new act of interpretation rather than an idempotent transition.

The mutable `lesson_build.log.md` currently serves as audit log, database, approval record, queue, and resume checkpoint. It is optimized for humans but relied on as machine state.

### 2. The data plane is implicit

The complete Phase 1 package, source reasoning, equations, practice solutions, and provenance mainly travel in one subagent response. A six-topic course lesson with many source problems can exceed the return/context budget. Phase 1's schema also differs from the orchestrator prompt around `approach_hint` and `solution_sources`, and no permitted agent clearly owns an `orchestrator-derived` worked solution.

Media decisions are prose briefs, not testable specifications. Shared media are duplicated across topic rows rather than represented once with multiple consumers and states. Review findings are normalized in prose; scientific confidence is hardcoded or collapsed, defeating the confidence-aware fix policy.

### 3. Mutation is not transactional

Some producers write scratch files, while Manim and web-image flows write persistent outputs early. `manim-runner.js` copies the MP4 to the authoritative target before ffprobe and keyframe validation, so a failed validation can overwrite the last good artifact. Scratch directories are not consistently cleaned. Phase 0 stashing also mutates the user's work before plan approval and makes abort/recovery fragile.

### 4. The source model creates avoidable complexity

One generated lesson JSX file owns content, graph functions, state, schemas, media constants, topic registry, and shell wiring. Update mode then needs splice order rules, balanced-brace assumptions, naming conventions, and large-context edits. A single file is not a pedagogical requirement; it is the source of much of the update pipeline's complexity.

### 5. Reviewers are not given observable truth

Visual QA can receive a component name or source path but has no browser. It cannot reliably judge clipping, CSS inheritance, responsive overflow, light-theme contrast, or interaction states. The interaction reviewer is asked to check extreme behavior, but the producer does not return an executable oracle for those extremes. Per-artifact review also misses whole-lesson coherence, navigation density, notation consistency, and mobile flow.

### 6. Multi-agent work is over-applied

Independent research extraction, scientific checking, and separate review lenses benefit from isolated contexts. File assembly, splicing, deterministic validation, state transitions, and release do not. The current design uses model orchestration for both. This increases cost and coordination errors precisely where ordinary code would be more reliable.

Anthropic reports that multi-agent systems excel at parallel breadth-first research, but are a weaker fit when workers share context or have many dependencies. That maps directly to this skill: research should fan out; assembly should be a deterministic DAG.

### 7. Builder and tutor are two products sharing one trust model

The runtime prompt combines a student tutor, graph controller, SVG/Desmos generator, research agent, lesson editor, QA orchestrator, and git assistant. The proxy consequently grants every ordinary tutoring turn the union of those capabilities. Yet production removes the chatbot entirely through `import.meta.env.PROD`.

This is not one coherent product boundary. It is a local authoring copilot hidden inside a student-facing tutor UI. The two should be split.

## Target architecture

### A. Stable control-plane interfaces

Adopt the same conceptual separation Anthropic describes for managed agents:

1. **Session/run store:** append-only events and immutable artifacts. It survives context resets and controller upgrades.
2. **Harness/controller:** replaceable scheduling and context-selection policy.
3. **Sandbox/worktree:** the hard boundary for file and process effects.

The skill remains the human/model-facing entry point, but it delegates mechanics to a small CLI or library such as:

```text
lesson-builder init
lesson-builder scope validate
lesson-builder evidence import
lesson-builder plan validate
lesson-builder approve
lesson-builder tasks ready
lesson-builder artifact submit
lesson-builder verify
lesson-builder repair begin|accept|revert
lesson-builder release
lesson-builder resume
```

The model decides what should be taught, what evidence means, which medium serves an objective, and whether a judgment finding matters. Code decides what phase is legal, what artifact is missing, what hash was approved, which files are staged, and whether a release is the tested tree.

### B. Versioned run records

Create a run namespace outside lesson source:

```text
.lesson-builder/runs/<run_id>/
  run.json
  scope.json
  evidence.jsonl
  topics.json
  plan.json
  approval.json
  tasks.jsonl
  artifacts.jsonl
  captures.jsonl
  findings.jsonl
  release.json
  events.jsonl
  human-log.md
```

Core records should be JSON-schema validated and versioned:

```text
RunManifest
  run_id, schema_version, phase, status, mode
  workspace, lesson_root, base_sha, candidate_worktree
  input_hashes, child_artifact_hashes, approval_hash, locks

EvidenceRecord
  evidence_id, kind, normalized claim/equation/problem
  variables, units, source locator, source hash
  provenance, confidence, conflicts, verification state

TopicSpec
  topic_id, objective_ids, prerequisite_ids, evidence_ids
  misconceptions, assessment items, outline, learner actions

MediaSpec
  media_id, owner_topic, consumer_states, kind, operation
  objective_ids, scientific contract, presentation contract
  interaction contract, capability requirements, fallbacks

ArtifactResult
  task_id, producer, status, staged files, checksums
  target paths, dependencies, provenance, deviations, metrics

Finding
  stable criterion_id, target_id, expected, observed
  severity, confidence, evidence, repair owner, dependency set

ReleaseManifest
  approved_plan_hash, candidate_tree_hash, artifact checksums
  verification versions, unresolved issues, target, outcome
```

`lesson_build.log.md` should be generated from these records. It remains useful, but nothing should parse it to recover operational state.

### C. Explicit state machine

```text
INIT
  -> SCOPED
  -> EVIDENCE_READY
  -> PLAN_VALIDATED
  -> PLAN_APPROVED(plan_hash)
  -> CANDIDATE_ASSEMBLED
  -> DETERMINISTIC_GREEN
  -> SEMANTIC_GREEN | READY_WITH_EXCEPTIONS
  -> CANDIDATE_FROZEN(tree_hash)
  -> RELEASED | SKIPPED
```

Every state permits `PAUSED`, `FAILED`, and `ABORTED`. Every transition is idempotent. Changing an input invalidates descendants by dependency hash. A lesson/run lock prevents concurrent mutation. Resume reads artifacts and events, not summarized conversation memory.

Approval binds `run_id`, `plan_revision`, normalized `plan_hash`, time, and user decision. Repairs inside approved acceptance criteria do not reopen the gate. A changed scientific contract, medium type, topic objective, removed medium, or deploy target automatically invalidates approval.

### D. Isolated, promotable transactions

Create a dedicated git worktree at the recorded base SHA for both new and update runs. Do not stash the user's working tree. All model writes occur inside that worktree or a run-owned artifact directory.

Each producer writes to:

```text
.lesson-builder/runs/<run_id>/stage/<task_id>/...
```

The controller validates checksums, declared outputs, file types, and acceptance checks before atomic promotion into the candidate worktree. A failed task cannot partially alter the lesson. A repair snapshots the candidate tree, applies one dependency-coherent patch, validates it, then accepts or reverts it atomically.

The release unit is the exact tested Git tree. Run hooks, capture the final tree hash, verify that target/base refs have not moved, then promote that tree. Phase 5 should not rebuild unchanged bytes that Phase 4 already certified.

## Redesigned pipeline

### Stage 0. Discover and normalize

- Resolve workspace, course, canonical `lesson_file`, deploy target, base SHA, capabilities, and resource policy.
- Create the run worktree and run manifest. Do not touch the user's dirty tree.
- Extract a typed baseline for updates. Treat a new lesson as a diff against an empty baseline.
- Capture pre-update screenshots, control traces, asset hashes, and current attestations before any edit.
- Fail early on missing structural prerequisites; record optional capability gaps for fallbacks.

### Stage 1. Evidence map-reduce

The controller, not a subagent, schedules independent work:

1. One material extractor per source file writes `EvidenceRecord`s.
2. Topic-research workers fill uncovered claims, not entire duplicated topics.
3. Claim-verification workers resolve conflicts and high-risk equations.
4. Topic synthesizers produce `TopicSpec`s from evidence IDs.
5. One coherence pass checks prerequisites, notation, scope, and duplication.

Persist every worker result immediately. Long worked solutions never need to survive as one giant return message. Give derived solutions to an explicit `problem-solver-agent`, then independently verify the answer and key intermediate results. Preserve source statements verbatim, but store normalized instructional forms separately.

### Stage 2. Plan, preflight, and approve

Keep one whole-lesson medium-decider, but change its output from prose briefs to `MediaSpec`s tied to objectives and assessment evidence. The input should include:

- Objective and misconception IDs.
- What the learner must do after viewing/using the medium.
- Evidence and scientific landmarks.
- Existing baseline quality and reuse opportunities.
- Capability and cost snapshot.

Run deterministic capability preflight before asking for approval: Manim/ffmpeg, Desmos key, component exports, filesystem targets, license candidate availability, and fallback feasibility. The approved plan should include the selected medium and its ordered fallback, not discover infeasibility in Phase 3.

There should be no implicit one-medium-per-topic quota. Some topics need no visual; a difficult spatial topic may need a static overview plus an interactive check. Every medium must earn its place by supporting a named objective or diagnostic.

### Stage 3. DAG execution and deterministic assembly

Compile the approved specs into a dependency graph:

- Topic authors consume `TopicSpec`s and evidence IDs.
- Media producers consume exact `MediaSpec`s.
- Shared media are one node with multiple consumer-state contracts.
- Long renders start early, but Manim concurrency is capped by available CPU/RAM.
- Every producer returns a validated `ArtifactResult`.
- The controller assembles outputs; agents do not splice a live monolith.

Validate each artifact as soon as it returns while producer context is still available. For Manim, validate the scratch render with ffprobe and frame extraction before atomic rename to the target, then delete scratch on success. For web images, split model judgment from deterministic download/MIME/dimension/hash checks.

### Stage 4. Layered verification and transactional repair

Run gates in this order:

1. Schema, paths, imports, AST parse, asset existence, generated-contract tests.
2. Target lesson build and deterministic browser assertions.
3. Capture matrix: desktop/mobile, light/dark, initial/extreme/error states, and every shared-media consumer state.
4. Content/evidence review, scientific review, visual review, interaction exploration, accessibility, and one whole-lesson UX/coherence review.

Do not launch judgment reviewers against an unrenderable candidate. Do not give visual QA a component name and ask it to imagine browser geometry. Feed it screenshots plus viewport/theme/state metadata. Generate deterministic interaction tests from the producer's `InteractionSpec`; use the interaction agent for exploratory behavior, not as the only oracle.

Findings use stable criterion IDs and preserve each reviewer's severity, confidence, evidence, and location. Low confidence is not rewritten to a fixed number. Track severity-weighted closure, deterministic status, and introduced regressions. Raw issue counts across stochastic re-reviews and “diff must shrink” are not meaningful progress metrics.

Review only changed or dependency-affected artifacts unless an attestation is absent or invalid. Cache attestations by:

```text
artifact hash + dependency hashes + rubric version
+ reviewer/model version + capture-matrix version
```

This implements no-grandfathering once, then reuses proof for genuinely unchanged work.

### Stage 5. Freeze and release

- Produce `ReleaseManifest` from the final tested tree.
- If there are no blockers/majors, no material plan deviation, and no regression event, release without another routine gate.
- If exceptions remain, ask one compact `accept / return to repair / abort` question before publication.
- Integrate target movement in the run worktree, rerun affected gates, and freeze a new tree hash.
- Stage from an authoritative add/modify/delete manifest.
- Separate commit and push outcomes; a local commit with failed push is not “deployed.”
- Deploy adapters own GitHub, custom remote, commit-only, and skip semantics. `skip` should not ambiguously mean both “no build” and “verify everything.”

Build the candidate lesson first. Run a full workspace build only when shared core/config changed or to detect a new cross-lesson regression relative to baseline. One pre-existing broken lesson should not erase proof that the candidate itself is sound.

## Agent topology

| Current role | Decision | Target responsibility |
|---|---|---|
| `content-orchestrator-agent` | Retire | Controller owns fan-out; a synthesis worker consumes persisted evidence. |
| `research-agent` | Keep | Explicit `topic_research` or `claim_verification`; shared evidence schema. |
| Generic deep-review team | Replace | Concrete `material-extractor-agent` with source locators and conflict output. |
| `content-review-agent` | Split | Evidence fidelity before plan; shipped lesson quality after assembly. |
| `medium-decider-agent` | Keep | One lesson-wide portfolio returning objective-linked `MediaSpec`s. |
| `graphics-agent` | Split | SVG graph producer and plot producer have different outputs and validators. |
| `manim-agent` | Keep | Explicit invocation mode/operation, staged output, persisted source, bounded render. |
| `interactive-demo-agent` | Keep build role | Also emits controls, ranges, expected outcomes, keyboard behavior, and tests. |
| `web-image-agent` | Split | Read-only license scout plus deterministic fetch/inspect utility. |
| `code-review-agent` | Retire from build gate | Move deterministic checks into `lesson-lint`; retain only genuinely judgmental review. |
| `visual-qa-agent` | Keep | Receives capture manifests, not raw component identifiers. |
| `scientific-accuracy-agent` | Keep | Batch by topic; consume approved evidence; preserve all finding confidence. |
| `interaction-agent` | Narrow | Exploratory interaction/accessibility after generated tests. |
| Runtime versions of build agents | Split out | Separate least-privilege tutor capabilities and prompts. |

Add a topic synthesizer and topic author. Main Claude should adjudicate, not carry all research, write all six topics, splice all artifacts, fix every issue, and manage release in one context.

Every task envelope should explicitly contain:

```text
schema_version, run_id, task_id, invocation_mode, operation
input artifact IDs and hashes, allowed roots, output directory
acceptance criteria, budget, deadline/max turns, fallback policy
```

Every result should contain:

```text
status, artifacts, checksums, findings, deviations, metrics, retryability
```

Use current Claude Code controls instead of relying on prose: `isolation: worktree` where appropriate, minimal tool allowlists, `disallowedTools`, `maxTurns`, effort selection, and `PreToolUse`/`PostToolUse` hooks for path and validation policy.

## Lesson source and workspace architecture

New lessons should become data and modules mounted into one shared application shell:

```text
workspace/
  package.json
  lockfile
  apps/lesson-shell/
  packages/lesson-core/
  lessons/<course>/<slug>/
    lesson.manifest.ts
    topics/<topic_id>.tsx
    media/<media_id>.tsx
    media/<media_id>.schema.ts
    media-source/<media_id>/scene.py
    public/images/...
    public/videos/...
```

The manifest registers topics, objectives, media, schemas, and deployment metadata. The shell owns navigation, theme, chatbot mounting, error boundaries, KaTeX, and common state. A generated registry discovers lessons; `build-all.sh` should not contain a hand-maintained commented inventory.

This change removes several current failure classes:

- Updates become module replacements rather than regex/balanced-brace surgery.
- Per-media graph defaults and schemas can be co-located and composed.
- The test runner can validate the manifest directly.
- Shared runtime dependencies use one lockfile and install.
- Core route/config changes have one source rather than copied server templates.
- Static images need not be duplicated as base64 inside JSX.

Use an AST/codemod adapter for legacy one-file lessons and migrate a lesson only when an approved update materially touches it. A global rewrite is unnecessary.

Bundle KaTeX in the shared app. The current `useKatex.js` CDN load has no robust failure path, and the lesson template gates the entire app on readiness, so a CDN/CSP outage can leave only a loading screen. A lesson's prose should remain usable even if optional rendering fails.

Replace `DEFAULT_GRAPH_PARAMS` plus a manually duplicated `GRAPH_SCHEMA` with a typed `defineGraph` declaration that generates defaults, runtime validation, editor metadata, prompt/tool schema, and tests. Missing schema must fail closed for mutation; `graphSchema.js:14-15` currently accepts every edit when schema is absent.

## Runtime product split

### Product 1. Learner tutor

- Available only through an authenticated deployment profile.
- Read-only access to the lesson/evidence store.
- No Bash, Edit, Write, git, arbitrary web, or build-agent delegation.
- Typed graph-parameter and safe media actions only.
- Per-student quotas, privacy boundaries, retention policy, and observable learning state.
- Multi-turn tutoring evaluations are release gates.

### Product 2. Authoring copilot

- Local development only, visibly labeled as an authoring tool.
- Loopback bind plus per-launch authentication.
- Explicit capability escalation for research, media generation, and mutation.
- Mutation occurs in a patch sandbox/worktree.
- The user approves an exact rendered proposal and diff, not a title that triggers a new free-form edit.
- Commit and push remain separate, inspectable actions.

The existing `PROD` gate is then intentional: static lessons omit the authoring copilot. If deployed tutoring is desired, it uses the learner backend rather than exposing a local Claude Code proxy.

## Runtime control plane

Replace the current globals, sessionStorage alias, in-memory proxy maps, module observation queue, and resumed CLI transcript with a transactional session actor:

1. One durable actor per main tab.
2. Each turn forks from the last committed session state.
3. The actor owns the process tree and cancel token.
4. `done` atomically promotes the candidate; error/cancel discards it.
5. Threads fork from the anchor turn into separate actors.
6. Only an explicit user-approved summary merges back.

Introduce a backend interface so the current Claude CLI and a future Agent SDK/API implementation can coexist. The UI should not know argv limits, CLI session IDs, or process behavior. This avoids forcing an API migration while removing shell/process assumptions from the product contract.

Use a capability broker with separate profiles:

```text
tutor-readonly
research-readonly
graph-action
media-proposal
workspace-patch
release
```

Each profile owns its tool allowlist, root paths, model/effort, max turns, tool-call count, wall time, and cost ceiling. Ordinary definition questions should not start a max-effort, 30-minute coding agent with the full tool union.

## Typed actions and safe presentation

Replace the seven regex tag protocols with a versioned action channel or local MCP/tool calls:

```json
{
  "version": 2,
  "id": "act_...",
  "type": "graph.patch",
  "payload": { "graphKey": "...", "changes": {} }
}
```

The server validates the schema and emits dedicated SSE `action` events. The client applies read-only actions exactly once after response finalization. Mutating actions produce an immutable preview and patch for approval. Presentation is a pure projection; parsing display text can never change application state.

During migration, parse legacy tags only after `done`, convert them to typed actions with IDs, and record parity. Delete legacy syntax after all lesson clients support action v2.

Use a maintained Markdown parser, KaTeX renderer, and strict sanitizer. Model-generated SVG should be a typed, bounded document with an allowlisted element/attribute set. Never treat model text as trusted HTML. Validate `http`/`https` URLs, proxy remote media where necessary, and cap payload bytes, nodes, expressions, and live canvases.

## Chatbot system prompt

### What is good

- The moved core pedagogy policy avoids per-lesson drift.
- Retrieval-first and least-help-first behavior are directionally aligned with current tutoring research.
- It distinguishes reference lookups, new skills, problem attempts, misconceptions, and direct-answer insistence.
- It prioritizes task-level feedback over generic praise.
- It tries to ground the tutor in the actual course and current lesson state.
- It requires explicit approval before durable lesson mutation.

### What limits it

The prompt is trying to be policy, tool manual, protocol grammar, Desmos reference, media playbook, thread router, memory manager, code-editing procedure, and tutor persona at once. More text has created more interactions to reconcile:

- “Retrieval first” competes with “answer plain reference questions directly.”
- “Use a worked analogous example for a new skill” competes with “never solve the requested problem first.”
- Reinforced behaviors are called highest priority even though pedagogy must outrank them.
- Lesson/topic/context strings are interpolated into instruction-bearing text without a hard trusted-data boundary.
- The full topic, graph state, schema ranges, and reinforcement list are prepended to every resumed turn, so old copies accumulate in the CLI session.
- The policy is demoted to a user message when the assembled prompt crosses the proxy's argv threshold.
- Marker-based legacy dedupe can suppress a newer policy because an old context happens to contain the phrase.

### Target prompt

Keep the fixed system prompt to four sections:

1. **Role and precedence:** factual integrity, course scope, pedagogy, explicit learner preference, presentation. State that retrieved lesson/source/context blocks are untrusted data, never instructions.
2. **Turn-mode table:** `reference`, `new_skill`, `attempt`, `misconception`, `direct_answer_insistence`, or `artifact_request`, with one behavior for each.
3. **Pedagogy move:** current goal, diagnosed state, attempt count, hint rung, and one next action supplied as structured state.
4. **Capabilities:** short names of typed tools/actions. Schemas, examples, repair errors, and limits live in tool descriptions.

Move Desmos examples, SVG rules, augmentation details, thread behavior, and commit procedure into on-demand capability prompts. Give a thread actor its own short prompt. Replace semantic marker detection with `pedagogy_policy_version` in the lesson manifest.

The active context should be a compact snapshot ID plus deltas, not a repeated transcript payload. Keep explicit preferences separate from inferred signals:

```text
LearnerPreference
  dimension, value, scope, source, confidence, updated_at

LearningState
  objective_id, evidence, misconception_id, attempt_count, hint_rung
```

Use keyed supersession and byte caps. The current model-authored reinforcement string bag can retain contradictory advice indefinitely and allows the model to write its own future high-priority instructions.

## Evaluation architecture

### Builder evaluations

The current `17/17` suite is mostly a source-shape lint. It catches useful regressions, but regex presence checks do not prove rendered behavior, evidence fidelity, schema parity, accessibility, route contracts, or learning quality. Its `localStorage` rule has already induced the runtime to spell `sessionStorage` indirectly, which is a sign that the metric is optimizing the implementation rather than the desired outcome.

Create a versioned fixture bank and run multiple trials for stochastic steps:

- Six-topic new build from pure research.
- Multi-PDF course-only build with many worked problems.
- Update with a dirty user worktree and unrelated staged files.
- Interrupted/resumed run at every phase boundary.
- Missing Manim/ffmpeg/Desmos capability with approved fallback.
- Shared graph consumed in different topic states.
- Removed/reordered topic with deleted assets.
- Target branch movement and failed push.
- Reviewer disagreement and low-confidence findings.
- Malformed/truncated agent result.
- Pre-existing broken sibling lesson.

Grade final environment outcomes, not declarations: exact files, evidence coverage, objective coverage, valid tree hash, rendered captures, control behavior, regression deltas, and release destination. Record full traces, tool calls, tokens, cost, latency, retries, and human interventions.

### Tutor evaluations

Build multi-turn cases around the actual policy:

- Plain reference lookup.
- New concept with analogous worked example.
- Correct and incorrect student attempts.
- Localized misconception and repeated misconception.
- Two failed hints followed by escalation.
- Explicit direct-answer insistence.
- Changed explanation/style preference.
- Unsupported/out-of-course request.
- Graph patch and malformed action.
- Thread isolation and return to main.
- Source prompt injection and malicious attachment.
- Factual uncertainty and correction.

Use layered graders:

- Code graders for action validity, no duplicate side effects, grounding, latency, and tool policy.
- Pedagogical model graders for mistake identification/location, answer revealing, guidance, actionability, coherence, and tone.
- Scientific graders for correctness and uncertainty.
- Periodic human educator review to calibrate model graders.
- Pre/post or transfer tasks for real learning outcomes when deployed to learners.

Recent tutor research shows that good answer generation is not the same as good tutoring, and that multi-turn pedagogical behavior needs its own evaluation. The system prompt should therefore be optimized against this suite, not by adding rules after anecdotes.

### Runtime contract tests

Add mandatory tests for:

- SSE parsing across every byte boundary.
- One-time action dispatch and replay idempotence.
- Cancel/kill of the full process tree.
- Endpoint authentication, loopback bind, and shell metacharacters.
- HTML/SVG XSS corpora and unsafe URL schemes.
- Route-manifest parity, including `/commit`.
- Component examples rendered from prompt-generated payloads, including `Eq`.
- Thread/main transcript and observation isolation.
- Contradictory preference supersession.
- Worst-case system-prompt token/transport budgets.
- Preview/diff/commit identity and concurrent mutation locking.
- Push-failure UI and session restart recovery.

## Concision plan

The documentation is long because the same facts serve four audiences. Separate them:

| Kind of information | Single owner |
|---|---|
| State transitions, retries, paths, git, staging, release | Controller code |
| Field names, enums, results, findings | JSON Schema / TypeScript types |
| Domain judgment and refusal conditions | Agent prompt |
| Human explanation and troubleshooting | Reference docs |
| Log/checklist/status views | Generated from run records |

Then reduce each agent prompt to:

1. Role and domain non-negotiables.
2. Mode-specific input schema.
3. Domain reasoning procedure.
4. Result schema.
5. Refusal/escalation conditions.

Remove lifecycle scheduling, deploy policy, global fix-loop rules, repeated PDF handling, and duplicated path contracts from specialist prompts. Inject common source-reading rules as a small shared skill only when a task includes source material. Split build and runtime prompts so neither contains irrelevant modes or union capabilities.

`SKILL.md` should become the progressive-disclosure dispatcher and policy index, not a second phase manual. Phase documents become readable conceptual guides generated or checked against controller/schema versions. `template.md`, `server-template.md`, workspace bootstrap files, and runtime component examples should be generated from canonical source or verified in CI, not maintained as parallel copies.

This should remove a large fraction of normative prose while increasing precision. Concision is an outcome of moving logic to executable owners, not deleting useful constraints.

## Prioritized migration

### P0: before another production build

1. Remove nested Phase 1 delegation; main/controller owns all spawns.
2. Bind the proxy to loopback, authenticate every route, remove shell-backed untrusted argv, and default to read-only tools.
3. Replace raw model HTML rendering with a strict safe renderer.
4. Dispatch actions only once after completion; repair SSE parsing and real process cancellation.
5. Generate/proxy all endpoints from one manifest; restore `/commit` only after securing it.
6. Fix model-facing component contracts, especially `Eq`, and fail graph edits closed.
7. Reconcile current agent/schema/path contradictions and preserve scientific confidence verbatim.

### P1: reliability foundation

1. Introduce run IDs, typed records, schema validation, hashes, and generated human logs.
2. Persist the full evidence package and explicit derived-solution ownership.
3. Bind approval to a normalized plan hash.
4. Move new and update runs into isolated worktrees.
5. Stage every specialist artifact and promote atomically.
6. Add deterministic capability preflight and interaction acceptance specs.
7. Tier verification, capture real render matrices, and transactionalize repairs.
8. Freeze and release the exact tested tree; remove duplicate Phase 5 verification.

### P2: simplify the product

1. Introduce the shared lesson shell, workspace lockfile, auto registry, and modular lesson source.
2. Add the legacy AST adapter and migrate lessons on material update.
3. Split learner tutor from authoring copilot and introduce a backend adapter.
4. Move from tags to typed action tools and transactional session actors.
5. Add artifact attestations and dependency-aware incremental QA.
6. Establish builder/tutor eval suites and use their measured results to tune fan-out, models, effort, prompts, and stop rules.
7. Delete duplicated normative prose and copied templates once executable owners are authoritative.

## Decision summary

The overhaul improved many local seams, but local prompt repairs are now approaching diminishing returns. The system has enough policy. It needs stronger invariants.

The best target is a hybrid system:

- Deterministic workflow for state, scheduling, schemas, files, tests, approvals, and release.
- Agents for evidence interpretation, topic synthesis, pedagogical/media judgment, authoring, and independent review.
- Multi-agent breadth only where subtasks are actually independent.
- Durable artifacts rather than conversation memory between stages.
- Least-privilege runtime capabilities and environment-enforced boundaries.
- Measured outcomes rather than confidence from prompt completeness.

Implementing the P0 and P1 layers will improve correctness more than adding another specialist. Implementing the modular lesson shell and runtime split will then remove much of the documentation and repair complexity that the current pipeline is forced to manage.
