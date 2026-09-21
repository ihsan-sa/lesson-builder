# tutor-confinement

The lesson tutor is student-facing, so it must run with no operator's manual in its context and
no reach outside its lesson. `_lesson-core/server/proxy.js` § "Tutor confinement" has the options
and why each is there.

## Why

Before this, every tutor turn loaded each CLAUDE.md walking up from its cwd (the lesson's, the
workspace repo's and the host box's operating manual), the user's hooks and MCP servers, and held
Edit, Write and Bash everywhere. Isolated mode changed the cwd but not the walk. Three courses
showed it (2026-09-16): a tutor ran `mkdir -p ~/.cc/state/...` and answered "Already logged", and
one appended a handoff entry to a track's `progress.md` outside the lesson and told the student
"Handoff entry written."

## The two checks

- `run.sh` (in `tests/check.sh`): a fake `claude` records every spawn. Confined CLI: each spawn of
  isolated init, shared init, a streamed turn and a stateless turn carries `--restricted`, a
  lesson-only write rule and sandbox, `--permission-prompts none`, no blanket Edit/Write, the agent
  registry as a plugin, and no `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD`. A CLI whose `--help`
  lacks `--restricted`: every tutor route answers 503, nothing is spawned, `chat.log` says why.
  Removing `--restricted` from the proxy turns it red.
- `probe-real.sh` (real CLI, spends tokens): plants an operator manual that orders a handoff
  write outside the lesson, then asks a student question, asks the tutor to quote its instructions,
  and asks for writes outside and inside the lesson, in isolated and shared mode.
  `PROXY_REF=origin/main` runs the old proxy for comparison.

## What the tutor loses

- The workspace's `.claude/agents` now arrive via `--plugin-dir`, so their names read
  `tutor-team:<agent>`.
- Writes outside the lesson dir are refused, including the SKILL SYNC LOG edits to `_lesson-core/`
  and memory writes in shared mode that the system prompt still offers.
- Bash runs only inside the CLI's sandbox. Where the sandbox cannot start it is refused. On a host
  that blocks nested user namespaces (Ubuntu's `apparmor_restrict_unprivileged_userns=1`), that
  means every call.
- In shared mode the tutor can still `Read` the lesson's own CLAUDE.md, because it is a lesson
  file. It is no longer loaded into the context.
