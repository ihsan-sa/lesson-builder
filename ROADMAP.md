# Roadmap — accepted from the 2026-07-22 architecture review

Items from `codex-ultra-deep-review.md` (and the two audit rounds) that are agreed direction but deliberately NOT implemented as doc/prompt patches — each is a project needing a live harness or a product decision. Ordered by leverage. Immediate blockers from that review were fixed in-tree (see git log).

## P0 — runtime fixes that need the live sandbox first

Verify each against the running app (sandbox recipe: bootstrap fresh workspace → 17/17 → Playwright) before and after changing `Chatbot.jsx`:

1. **Safe rendering for model output** — ChatBubble preserves raw `svg`/`img`/`video` then assigns `innerHTML`; a prompt-injected `onerror`/foreignObject can script in the lesson origin and hit local endpoints. Fix: markdown→AST→React rendering, strict SVG allowlist, no handlers/scriptable elements/external refs, CSP.
2. **Real cancellation** — Stop aborts the HTTP reader but the proxy deliberately leaves the `claude` process running (HMR rationale). Add a cancellation endpoint owning the process tree; turn-as-candidate-session promoted on completion.
3. **Suggestion approval stale closure** — approval captures the first send function; approve-after-context-change edits against stale context. Also: send the parsed SUGGEST payload structurally, and emit the promised rejection observation.
4. **Thread actors** — threads share the main CLI session (misconceptions leak back; reinforcement missing inside threads). Fork thread sessions from the anchor turn; merge back only via explicit summary.
5. **Client resume metadata** — resume ignores stored model/effort.
6. **KaTeX CDN resilience** — app currently blocks entirely on the CDN load; add timeout fallback (bundle KaTeX in core longer-term).

## P1 — reliability foundation

7. **Run manifest** — versioned `lesson-run.json` (or `.lesson-builder/runs/<id>/` records): scoping artifact, plan hash + approval, branch/base SHA, stash OID, media manifests, open findings. Render `lesson_build.log.md` from it; stop parsing markdown as state.
8. **Worktree-per-run** — updates (and replacements) build in a run-id git worktree from the recorded base SHA; no stash of the user's tree at all. Deletes the highest-risk recovery logic (stash/pop/branch contamination).
9. **Stage-then-promote for every producer** — artifacts land in a run staging dir, checksum-validated, atomically promoted (manim-runner now does this; generalize).
10. **Attestation-cached no-grandfathering** — cache QA verdicts by artifact hash + rubric version + reviewer model; re-review only changed/dependency-affected artifacts, full coverage preserved by proof reuse.
11. **AST-based inventory + splice** — Babel-parse the lesson for the media inventory and splice/reachability instead of regex/line ranges (kills helper misclassification, false orphans, brace surgery).

## P2 — product shape (user decisions)

12. **Lesson shell monorepo** — lessons become manifest + topic/media modules mounted in one shared app shell; one lockfile; generated registry (replaces hand-edited `build-all.sh` inventory). Migrate legacy single-file lessons only on material update, via codemod.
13. **Tutor / authoring-copilot split** — student tutor: read-only tools, typed graph actions, deployable backend; authoring copilot: local-only, capability escalation, patch-sandbox mutation with rendered diff approval. Today's union-of-capabilities prompt+proxy serves both and over-privileges every turn.
14. **Typed action channel** — replace the seven `<<TAG>>` regex protocols with versioned JSON actions validated server-side, dispatched exactly once post-completion; legacy tags parsed only during migration.
15. **`defineGraph`** — single typed declaration generating `DEFAULT_GRAPH_PARAMS`, `GRAPH_SCHEMA`, validation, and prompt metadata (removes the manual key-parity invariant + backfill machinery).
16. **Eval suites as release gates** — builder fixture bank (interrupted/resumed runs, dirty trees, capability-missing fallbacks, branch collisions, malformed agent returns) graded on environment outcomes; multi-turn tutor evals (hint-ladder compliance, insistence, injection resistance, thread isolation); runtime contract tests (SSE byte-split fuzz, route-manifest parity, XSS corpus, component-example rendering). skill-creator plugin can host the description/trigger evals.

## Explicitly rejected / kept as-is

- Bearer-token auth on the proxy: loopback bind + CORS + argv allowlists cover the local threat model; tokens add Vite plumbing for little gain until the copilot split (#13).
- Removing the Phase 5 build under `deploy_action: skip`: deliberate — the user learns whether the lesson builds.
- Retiring `code-review-agent` from the build gate: its grep+judgment layer stays until `lesson-lint` (#16) exists.
