# Run record — `lesson-run/1`

Every lesson-builder run keeps its state in one versioned JSON record. The record **is** the state:
`lesson_build.log.md` is rendered from it, and no phase reads a field back out of the markdown.

- Records: `<lesson_root>/.lesson-builder/runs/<run_id>.json`, one per run, never rewritten by a later run.
- Rendered log: `<lesson_root>/lesson_build.log.md` (`references/log-template.md` describes what it looks like).
- Tool: `scripts/run-manifest.cjs` — the only writer and the only reader. Its fixture is `tests/run-manifest/`.
- Staging area: `<lesson_root>/.lesson-builder/staging/<run_id>/<media_id>/`, where every producer writes
  before its artifact is validated and promoted (§ Artifacts, fixture `tests/stage-promote/`).
- Attested verdicts: a Phase 4 verdict on a media row records the bytes, rubric and reviewer it
  attests to, so a later run reuses it rather than re-reviewing (§ Attested verdicts, fixture
  `tests/attestation/`).
- Build worktree: `<lesson_root>/.lesson-builder/worktrees/<run_id>/`, where an update run builds
  (§ The build worktree, fixture `tests/worktree-per-run/`).

## Schema

`schema` is `"lesson-run/1"`. A record whose `schema` is anything else is refused rather than guessed at,
so a future `lesson-run/2` cannot be half-read by today's tool.

```jsonc
{
  "schema": "lesson-run/1",
  "run_id": "a3f7b2",                  // short hash; the log's `run-id:` and the update heading
  "started": "2026-04-15T14:00:00Z",   // ISO; orders the rendered sections
  "ended": null,
  "mode": "new" | "update" | "consolidate",
  "session_mode": "interactive" | "channel" | "headless",
  "effort_mode": null,                 // Phase 0 sets it once (SKILL.md § One dial, stated once)

  "lesson": { "course": "MATH101", "slug": "intro-derivatives", "lesson_file": "src/intro-derivatives.jsx" },

  // Phase 0's scoping artifact, verbatim: user answers, derived scope, course context, research
  // depth, provided materials, assumptions. Free-form — every key renders into Phase 0 of the log,
  // except the deploy triple below, which renders under Phase 5 where the deploy happened.
  "scoping": {
    "deploy_action": "push-to-github",   // Phase 0 answers it, Phase 5 re-sets it if what ran differed
    "deploy_service_kind": "git-remote", // the NEXT update reads these three back from this record
    "deploy_service": "<remote URL / CLI / null>",
    "working_tree": "dirty: 2 path(s) uncommitted, not in the base SHA this run builds from"
  },                                     // Phase 0's word for what it saw, read-only; renders as
                                         // `Working tree state:`, which is `clean` when unset

  "plan": {
    "hash": "4f2a9c17",                // first 8 hex of SHA-256 of the plan artifact, set by `plan-hash`
    "artifact": "plan.md",             // path to the exact bytes that were hashed, relative to the lesson root
    "approval": {
      "state": "none" | "pending" | "approved" | "aborted" | "inherited",
      "at": "2026-04-15T14:02:08Z",
      "via": "APPROVED PLAN 4f2a9c17"  // or "user", or the consolidation plan hash for `inherited`
    }
  },

  "git": {
    "branch": "lesson-update/intro-derivatives-20260415-a",  // ACTUAL name, collision suffix included
    "base_branch": "main",             // the workspace default branch the run builds from and merges to
    "base_sha": "7e4b9a2",             // its tip when Phase 0 ran — what the worktree is checked out from
    "worktree": "<lesson_root>/.lesson-builder/worktrees/<run_id>/<course>/claude_lessons/<slug>",
    "worktree_state": "live",          // "removed" once `worktree remove` has pruned it
    "commit_sha": "9c2d1f8",           // the merge commit in update mode

    // Legacy. Only a run under the old flow — which stashed the user's tree and built in their
    // checkout — has these. Recovery reads them (references/update-mode.md § Recovering a run from
    // the old stash flow); `set` refuses to write them; no new run produces one. `stash_recovery`
    // is the outcome recovery itself records, so it stays writable.
    "stash_oid": "c0ffee1",
    "stash_ref": "stash@{0}",
    "stash_branch": "main",
    "stash_recovery": "applied + dropped (<oid>)" | "manual (oid: <oid>)" | "conflict (manual)" | "none"
  },

  // One entry per media item the plan carries, `keep` rows included. `intent`, `path` and
  // `status` are the plan's words. `artifacts` is what the lesson tree actually holds — one entry
  // per destination path, written only by `promote` and merged by path when the same path is
  // promoted again, so a media id that promotes several files (a manim video and the `.py` that
  // reproduces it) keeps a hash for each. `artifact_failure` is why the last production did not
  // change it, written by `fail` or by a refused promotion and cleared by the next good one. A
  // failed production never touches `artifacts` — those files are still on disk and still
  // described here.
  "media": [
    { "media_id": "m1", "intent": "add", "original_intent": "add", "medium": "manim",
      "topic": "3", "path": "public/videos/tangent.mp4", "status": "built",
      "artifacts": [
        { "path": "public/videos/tangent.mp4", "sha256": "<64 hex>", "bytes": 812044,
          "promoted": "2026-04-15T14:31:02Z", "state": "promoted" | "unchanged" },
        { "path": "tangent.py", "sha256": "<64 hex>", "bytes": 1180,
          "promoted": "2026-04-15T14:31:05Z", "state": "promoted" }
      ],
      "artifact_failure": { "target": "public/videos/tangent.mp4",
                            "reason": "MP4 is truncated (a box runs past the end of the file)",
                            "at": "2026-04-15T14:30:44Z" },
      // One Phase 4 verdict per reviewer, with everything it attests to (§ Attested verdicts).
      // `from_run` + `reused_at` are on a verdict this run carried forward instead of paying for
      // again; a verdict this run made has neither.
      "attestations": [
        { "reviewer": "visual-qa-agent", "model": "claude-opus-5", "verdict": "pass",
          "at": "2026-04-15T14:44:10Z",
          "from_run": "9d1c04", "reused_at": "2026-04-19T10:02:00Z",
          "rubric":    { "ref": "skill:agents/visual-qa-agent.md", "sha256": "<64 hex>" },
          "artifacts": [ { "ref": "public/videos/tangent.mp4", "sha256": "<64 hex>" } ],
          "deps":      [ { "ref": "src/intro-derivatives.jsx#axisTicks", "sha256": "<64 hex>" } ] }
      ] }
  ],

  // Every issue open at exit, with where it came from and what was attempted. `state: "resolved"`
  // keeps a closed finding in the trail without listing it as unresolved.
  "findings": [
    { "id": "f1", "phase": "4", "origin": "visual-qa", "summary": "x-axis label clipped",
      "reason": "low confidence, not attempted", "state": "open" }
  ],

  // Prose a phase wants in the log that no field above owns: research rounds, splice counts,
  // drift incidents, test results, build verification. Rendered under that phase's heading.
  "phases": { "0": { "notes": [] }, "1": { "notes": [] }, "…": {} }
}
```

## Commands

`run-manifest.cjs` below and in the phase docs is shorthand for `node <skill_root>/scripts/run-manifest.cjs`;
it needs only node, no install — except an `attest` ref of the form `<file>#<Name>`, which goes
through `lesson-ast.cjs` and so needs the `@babel/parser` the lesson template already pins.
`--lesson <lesson_root>` is always required. `--run <id>` defaults to the
newest record in that lesson, so a resumed session does not have to carry the id.

| Command | Does |
|---|---|
| `init --mode <m> --session-mode <s> [--run <id>] [--course C] [--slug S]` | Creates the record, prints the run id. Exits 2 rather than clobber an existing one. |
| `current` | Prints the newest run id (ties on `started` break on run id, so the order is total). Run it **before** `init` to learn the previous run's id, then `get --run <that id>` for anything this run inherits — the deploy triple, audience, pedagogical goal. |
| `get <path>` | Prints a dotted field. Exits 3 if it is unset — absent, or the `null` that `init` seeds fields with. "No worktree" is an exit code, never the string `null`. |
| `set <path> <value> [--json]` | Writes a dotted field. Refuses the three legacy stash fields: a run builds in its own worktree and never stashes. |
| `append <path> <json>` | Pushes onto an array field (`media`, `findings`, `phases.N.notes`). |
| `plan-hash --file <artifact>` | Hashes the artifact, records `plan.hash` + `plan.artifact`, prints the hash. A plan whose hash **changed** goes back to `pending` even if it was approved — approval does not transfer to text the user never saw. An abort stands. |
| `approve --hash <h>` | The headless approval gate. See below. |
| `stage --media-id <id> --name <file>` | Creates this run's staging directory for that media id and prints the path the producer writes to. |
| `promote --media-id <id> --from <staged> --to <lesson-relative> [--min-bytes <n>]` | Validates the staged bytes and moves them into the lesson tree. Prints a JSON receipt; exits 6 on refusal. See below. |
| `fail --media-id <id> --reason <text>` | Records a production that produced nothing. Touches no file. |
| `check-return --media-id <id> [--from <file>]` | The Phase 3 boundary: reads a specialist's returned JSON manifest (`--from`, or stdin) and refuses it unless it agrees with the record. Writes nothing; exits 10 on refusal. See below. |
| `attest reuse --spec <file> [--at <iso>]` | Decides every review the spec asks for and carries each still-valid prior attestation into this run's record. Prints `{"reuse":[…],"review":[{media_id,reviewer,reason}]}`. See below. |
| `attest record --spec <file> --media-id <id> --reviewer <name> --verdict pass\|issue\|fail [--at <iso>]` | Records a fresh verdict with what it attests to. Prints the attestation as one JSON line. |
| `attest verify --spec <file>` | Coverage gate: every review the spec asks for has a valid attestation in **this** run's record, and the spec names a review of every medium the record carries. Exits 8 naming the gaps otherwise. |
| `worktree add` | Creates this run's build worktree from `git.base_sha`, records `git.worktree` + `git.worktree_state`, and prints the lesson root inside it. Takes the **user's** lesson root, never the worktree's — given one carrying the pointer it refuses (exit 1). Idempotent: a resumed run calls it again and gets its worktree back. |
| `worktree remove` | Prunes it. Same root as `add`: a worktree does not remove itself. Exits 7 and removes nothing while it holds uncommitted work or a commit no ref keeps; exits 3 when the record names no worktree. |
| `branch [--name <n>]` | Creates the run's branch **in the build worktree** from `git.base_sha`, records the name it created on `git.branch`, and prints it. Deterministic on a collision; idempotent on a resumed run. Exits 3 with no live worktree, 9 when the name and every suffix are taken. See below. |
| `render` | Rewrites `lesson_build.log.md` from every record in the lesson. |

## The build worktree

An update run never builds in the user's checkout. Phase 0 records `git.base_branch` and
`git.base_sha` — the default branch and its tip — and then `worktree add` checks a git worktree out
from that SHA at `<lesson_root>/.lesson-builder/worktrees/<run_id>/`. Everything from Phase 1 on
reads and writes the lesson root inside it, which the record holds as `git.worktree`. The user's
working tree is therefore byte-identical from Phase 0 to the end of Phase 5, uncommitted and
untracked files included, apart from the run's own gitignored `.lesson-builder/` and the rendered
`lesson_build.log.md`: nothing stashes it, nothing switches its branch, nothing else writes into it.
The log is the one visible write — it is untracked but not ignored, so it does show in their
`git status`.

- **It is invisible to the user's `git status`.** `.lesson-builder/` is in the lesson's
  `.gitignore`, so the worktree sits inside a directory git already ignores.
- **The checkout does not contain the records.** Same reason — it is a checkout of the base SHA,
  and `.lesson-builder/` is ignored. So `worktree add` writes a one-line pointer at
  `<git.worktree>/.lesson-builder/record-root` naming the lesson root that holds them, and every
  command follows it: the record, the staging area and the rendered log all stay in one place
  whichever of the two lesson roots a command is given. One hop only — a pointer naming a lesson
  root that is itself a build worktree is refused, not followed.
- **No branch until Phase 3.** The worktree is detached on the base SHA until Phase 3 names the
  branch in it with `branch`, so a run aborted at the Phase 2 gate leaves no branch behind.
- **`worktree add` is how a run resumes.** Called again it returns the same worktree with whatever
  it had already built still in it, and re-creates it on the recorded branch if the directory is
  gone but the branch is not.
- **`worktree remove` refuses to drop work.** Exit 7, nothing removed, while the worktree holds
  uncommitted changes or sits on a commit no ref keeps. A `deploy_action: skip` run and a failed
  run both end that way on purpose, and Phase 5 reports the path instead of pruning.

Phase 5 merges in the worktree too, on a detached HEAD, and moves `refs/heads/<base>` only when no
working tree has it checked out — git refuses to push or fetch into a checked-out branch for the
same reason. Commands: `references/phase-5-deploy.md` § Step 2b.

### The run's branch

`branch` names it, in the worktree. `lesson-update/<slug>-YYYYMMDD` where the date is the record's
own `started` stamp in UTC — never `new Date()`, so a resumed run and a run that crosses midnight
name the same branch — or `--name <n>` for a caller that has its own.

- **The collision rule is here, not in a session's prose.** A name already taken as a local
  `refs/heads/` takes the first free `-a`…`-z` suffix; a remote-tracking ref of the same name is not
  a collision, because it does not stop `checkout -b` and treating it as one would push every re-run
  of a pushed lesson onto a suffix nobody asked for. All 27 taken is exit 9 and no branch created.
- **The name that was created is what is recorded.** `git.branch` holds the actual name, suffix
  included, and Phase 5 reads it back verbatim rather than rebuilding it from the pattern.
- **A run that already has a branch keeps it.** Called again — Phase 3 resuming after a crash — it
  checks the recorded branch out instead of opening a second one beside it, and exits 3 rather than
  silently choosing a different name if that branch is gone.

Fixture: `tests/branch-collision/`.

## Artifacts: stage, validate, promote

Every producer of a lesson artifact writes into the run staging area, the artifact is validated
there, and only a validated artifact is promoted into the lesson tree. A production that is killed,
truncated or simply wrong therefore leaves the lesson exactly as it was, and says why.

- **Staging area**: `<lesson_root>/.lesson-builder/staging/<run_id>/<media_id>/`, whose path
  `stage` prints. It is beside the run records, so the lesson's `.gitignore` already covers it.
  Text the assembly splices into the lesson source (demo and graphics JSX) stages in
  `.build-scratch/` instead — same rule, different home, because it is spliced rather than served.
- **`promote` refuses** — exit 6, nothing written, the reason recorded on the media row — when the
  `--from` path is not under **this run's** staging directory, when `--to` leaves the lesson root or
  points inside `.lesson-builder/`, when nothing is staged there, or when the staged bytes are not a
  complete file of their kind.
- **The completeness check** is by the destination's extension. Kinds with a fixed trailer are
  checked at both ends, because a production killed mid-write leaves a plausible header and a
  missing tail: PNG needs its `IEND`, JPEG its `EOI`, GIF its trailer byte, SVG its `</svg>`, WebP a
  RIFF length that matches the file, MP4 a set of top-level boxes that tile the file exactly,
  WebM its EBML header, and `.py`/`.jsx`/`.js`/`.json`/`.md`/`.txt`/`.b64` valid non-blank UTF-8. An extension with no known shape gets the size checks only and the receipt says so. Add
  `--min-bytes <n>` when the caller knows its artifact is never smaller than that.
- **The promotion is atomic**: the bytes go to `<dir>/.<name>.<run_id>.part` and are then renamed
  over the destination, so the final name never holds a partial file and a kill mid-promotion leaves
  the previous artifact intact.
- **Identical bytes change nothing.** If the destination already hashes to the staged bytes, no
  write happens at all — same inode, same mtime — the receipt says `unchanged`, and the record keeps
  the timestamp the bytes first landed at. A re-run that produces the same artifact is a no-op.
- **Every producer works against a run of its own.** `stage` and `promote` resolve `--run` to the
  newest record and refuse when the lesson has none, so a producer outside a build — the tutor's
  runtime manim render — opens one first with `init --mode update --session-mode channel` and passes
  that `--run <id>` to every call. It never stages against whatever record happens to be newest: that
  one belongs to a finished build run, and a record is never rewritten by a later run. A lesson
  cloned or deployed without its gitignored `.lesson-builder/` has no record at all, which is the
  same case and the same answer.
- **Each destination path is recorded on its own.** The media row's `artifacts` array holds one
  entry per promoted path, merged by path on a re-promotion, so a media id that promotes more than
  one file — a manim video and the `.py` that reproduces it, a matplotlib PNG and its `figures/`
  source — carries a hash for each and the second promotion does not erase the first.
- **The receipt** on stdout is one JSON line:
  `{"media_id","path","sha256","bytes","state":"promoted"|"unchanged","checked"}`. The SHA-256 is
  the full 64 characters and is the artifact's identity in the record.

Fixture: `tests/stage-promote/`.

## The Phase 3 return boundary

A manim or web-image specialist stages and promotes its own artifact and then **returns** a JSON
manifest — `mp4_path`, `py_path`, `sha256`, `effective_action` — that assembly consumes directly:
the splice takes the `<video src>` out of it. `check-return` is what that manifest crosses before
assembly sees it, and it needs no schema per agent, because the record already knows what the run
promoted.

- **The paths it claims must be exactly what this run promoted for that media id.** No more, so a
  file written into the lesson tree behind the staging area's back is never spliced in; no fewer, so
  a manifest that names the MP4 and forgets the `.py` beside it is caught. A path claim is any
  string under a key named `path`/`paths` or ending in `_path`/`_paths` — by shape, so a third file
  an agent returns is checked too instead of slipping past an allow-list. Absolute paths, paths
  outside the lesson root and paths that are not on disk are all refusals.
- **A `sha256` it states is checked against the bytes on disk**, not against the record: the record
  is where the run said the bytes were, and this is the question of whether they still are.
- **The action is the agents' vocabulary, not the plan's.** `agents/manim-agent.md` § Stage 4
  states `effective_action: "as-briefed" | "degraded-to-replace"`; `agents/web-image-agent.md`
  § Return format states `action: "keep_existing" | "format_change"`, or no action key at all on a
  plain success. Those are what is accepted, under either key, and a return that states none is
  fine. The plan's `keep|refine|replace|remove|add` is a different axis — it is what the run was
  ASKED to do, and it lives on the media row as `intent`; an agent says what it did about that.
  Two of those five could never reach here anyway: a `keep` or a `remove` verdict spawns no agent
  (`references/phase-2-plan.md` § Update mode), so there is no return for them to be the word of.
- **A return that names no path is the documented no-op** — a bare `null`, or web-image's
  `{"action":"keep_existing","reason":…}` from a refine that found nothing better — and it passes
  only while the run promoted nothing for that media id. If it did promote something, a no-change
  return is the "no fewer" rule seen from the empty end, and is refused.
- **A return that reports its own failure (`ok: false`) is refused** with that as the reason: it is
  the respawn case, not a manifest to check.
- **It writes nothing.** A refusal is exit 10 with the reason on stderr, answered by respawning that
  specialist once with the same brief — a respawn that succeeds should not have to clear a flag this
  left. A pass prints one JSON line: `{"media_id","effective_action","artifacts":[{path,sha256}]}`.

Fixture: `tests/agent-return/`.

## Attested verdicts

A Phase 4 verdict is recorded with what it attests to — the artifact's bytes, the rubric that
judged it, the reviewer and its model, and every dependency the review declares — so a later run
can reuse it instead of re-reviewing bytes nothing has touched. Coverage is preserved by proof,
never by omission: **an artifact with no valid attestation is reviewed.** Phase 4 runs this;
`references/phase-4-review.md` § 4 is where the spawn set comes from.

- **The spec is the one declaration of what a review depends on.** Main Claude writes it in
  Phase 4 (`.lesson-builder/attest-<run_id>.json` by convention) and all three commands read it,
  so what was checked and what was attested cannot drift:

  ```jsonc
  { "reviews": [
      { "media_id": "m1", "reviewer": "visual-qa-agent", "model": "claude-opus-5",
        "rubric": "skill:agents/visual-qa-agent.md",
        "artifacts": ["public/videos/tangent.mp4"],          // optional; see below
        "deps": ["src/intro-derivatives.jsx#axisTicks"] } ] }  // deps: bytes that outlive the run
  ```

- **A ref** is a lesson-relative path, `skill:<path>` for one of the skill's own files (a rubric, a
  reviewer prompt — they move with the skill, not the lesson, and a record never holds a path that
  is only true on one machine), or `<file>#<Name>` for one top-level declaration or
  `<InteractiveDemo title="…">` inside a file, hashed by `lesson-ast.cjs digest`. That last form is
  what lets a verdict attest to one graph in a shared lesson file: refining one graph does not
  invalidate the other five, or the demo beside them.
- **`artifacts` defaults** to the paths `promote` recorded for that media id, from the newest record
  that has any, and then to the media row's planned `path`. A `keep` medium's bytes therefore come
  from the run that built it. A review that resolves to no artifact at all is refused (exit 1) —
  a verdict over no bytes proves nothing, so it is never recorded and never reused.
- **What makes an attestation invalid**: any ref it names now hashes differently, is gone, or is not
  in the review any more; a ref the review now names that the verdict never attested to; or the
  reviewer's model changed. Bytes are re-hashed **from disk**, not read back off the media row, so
  an artifact edited without its record being updated is never reused.
- **Only a `pass` is reused.** An `issue` or a `fail` stands on findings that were open when it was
  made — a `keep` medium's are logged rather than auto-fixed — so carrying it forward would drop
  them out of the next run's issue list and its final report without the reviewer ever running.
  A prior non-pass verdict therefore lands in the `review` set for the reason
  `prior verdict was <v>`, exactly as it would have been re-reviewed before any of this existed.
- **A dep is bytes that outlive the run.** The plan artifact is not one: it is per-run
  (`.lesson-builder/runs/<run_id>-plan.md`), so naming it in `deps` would strand every verdict on
  every run. What the plan changed reaches the review through the medium's own bytes.
  `references/phase-4-review.md` § 4 is the recipe for which refs to name.
- **`verify` walks this run's media rows too**, not only the spec: a medium the spec names no
  review of is a gap like any other, so the coverage the gate proves cannot be narrowed by editing
  the spec. Two rows have nothing to review and are not gaps — one the plan removes, and one whose
  production failed leaving nothing promoted (Phase 4 logs that as its own finding).
- **`unavailable` is not a verdict.** A reviewer that could not run is a coverage gap Phase 4 logs
  as a finding; `attest record` refuses it (exit 1) rather than let a gap look like proof.
- **A lesson with no prior attestations behaves exactly as it did before this existed**: every
  review is in the `review` set, for the reason `no attestation`. That includes a record written
  before attestations existed — its findings carry no artifact hash, so nothing is reusable from it.
- **Reuse is visible in the log.** A carried-forward verdict renders as
  `verdict: <reviewer> <v> — REUSED from run <id>, attested <iso>` under its media row; one this run
  paid for names the model instead.

Fixture: `tests/attestation/`.

## The approval gate

`approve --hash <h>` is the **only** thing that decides whether an `APPROVED PLAN <hash>` in the task
text lets Phase 3 run. It compares against `plan.hash` in the record — never against text in the log.

| Exit | Case | What the run does |
|---|---|---|
| 0 | `<h>` equals the recorded hash | Records `approved` (keeping an earlier approval's timestamp) and goes to Phase 3. |
| 3 | a plan is recorded, `<h>` is not its hash — a stale hash, a prefix, anything not 8 hex characters | **Not approval.** Re-emit the current plan under its hash and block again, saying which hash was offered and which is current. |
| 4 | no plan is recorded for this run | **Not approval** — the approval refers to nothing. Re-run Phase 2, write the plan into the record, emit the gate under its hash and block. Never treat a bare `APPROVED PLAN` as cover for a plan nobody saw. |
| 5 | the run's approval is `aborted` | Stays aborted. A person wrote that word; the gate does not un-write it. |

Comparison is on all 8 hex characters, case-folded. A prefix of the recorded hash is not the recorded hash.

## Rendering, and lessons whose log predates the record

`render` writes everything below this marker and nothing above it:

```
<!-- lesson-builder:rendered v1 — everything below is generated from .lesson-builder/runs/ … -->
```

- A log with no marker predates the record. Its text is the prologue and is kept byte for byte;
  rendered sections go below it. History is never rewritten.
- A log with the marker keeps its prologue and has everything below regenerated.
- No log at all: the header is generated from the first record.

Re-rendering an unchanged record produces byte-identical output, so `render` is safe to call at the
end of every phase. `render` never writes into a record.
