# Run record — `lesson-run/1`

Every lesson-builder run keeps its state in one versioned JSON record. The record **is** the state:
`lesson_build.log.md` is rendered from it, and no phase reads a field back out of the markdown.

- Records: `<lesson_root>/.lesson-builder/runs/<run_id>.json`, one per run, never rewritten by a later run.
- Rendered log: `<lesson_root>/lesson_build.log.md` (`references/log-template.md` describes what it looks like).
- Tool: `scripts/run-manifest.cjs` — the only writer and the only reader. Its fixture is `tests/run-manifest/`.
- Staging area: `<lesson_root>/.lesson-builder/staging/<run_id>/<media_id>/`, where every producer writes
  before its artifact is validated and promoted (§ Artifacts, fixture `tests/stage-promote/`).
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
                            "at": "2026-04-15T14:30:44Z" } }
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
it needs only node, no install. `--lesson <lesson_root>` is always required. `--run <id>` defaults to the
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
| `worktree add` | Creates this run's build worktree from `git.base_sha`, records `git.worktree` + `git.worktree_state`, and prints the lesson root inside it. Takes the **user's** lesson root, never the worktree's — given one carrying the pointer it refuses (exit 1). Idempotent: a resumed run calls it again and gets its worktree back. |
| `worktree remove` | Prunes it. Same root as `add`: a worktree does not remove itself. Exits 7 and removes nothing while it holds uncommitted work or a commit no ref keeps; exits 3 when the record names no worktree. |
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
  branch in it, so a run aborted at the Phase 2 gate leaves no branch behind.
- **`worktree add` is how a run resumes.** Called again it returns the same worktree with whatever
  it had already built still in it, and re-creates it on the recorded branch if the directory is
  gone but the branch is not.
- **`worktree remove` refuses to drop work.** Exit 7, nothing removed, while the worktree holds
  uncommitted changes or sits on a commit no ref keeps. A `deploy_action: skip` run and a failed
  run both end that way on purpose, and Phase 5 reports the path instead of pruning.

Phase 5 merges in the worktree too, on a detached HEAD, and moves `refs/heads/<base>` only when no
working tree has it checked out — git refuses to push or fetch into a checked-out branch for the
same reason. Commands: `references/phase-5-deploy.md` § Step 2b.

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
