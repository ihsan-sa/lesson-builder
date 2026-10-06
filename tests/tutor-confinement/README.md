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

A later security read found three more ways out. A tutor could write any file in the lesson dir,
and the lesson dir holds files that run outside any sandbox: `test_lesson.cjs` (run by `/commit`,
through a shell), `package.json`, `vite.config.js` and `server/proxy.js` (run by `npm run dev`).
`--add-dir` kept the workspace's CLAUDE.md readable on request, though no longer auto-loaded. And
the `--help` probe accepted an option named anywhere, even inside another option's description.

## The two checks

- `run.sh` (in `tests/check.sh`): a fake `claude` records every spawn. Confined CLI: each spawn of
  isolated init, shared init, a streamed turn and a stateless turn runs in the scratch dir
  `server/.isolated` and carries `--restricted`, write rules for `src/*.jsx` and the scratch dir
  only, a sandbox that writes only the scratch dir, Read denies for the workspace's manuals, the
  read block, `--permission-prompts none`, no blanket Edit/Write, the agent registry as a plugin,
  and no `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD`. Figures (below): `MPLCONFIGDIR` is in the
  scratch dir, the sandbox opens no domain, socket or port, a turn's system prompt says where figures
  go, and `chat/file/<name>` serves a PNG from `out/` in the scratch and refuses each of: a name that
  climbs out (`../`, encoded `/` or `\`, a leading dot), a symlink in `out/` to a file outside, `out/`
  itself swapped for a link, an SVG, a name with no extension, a directory and a fifo. A CLI whose `--help` names `--restricted`
  only inside another option's text, and a CLI older than the floor: every tutor route answers 503,
  nothing is spawned, `chat.log` says why. `/commit` against a lesson source whose file name would
  run a command in a shell: nothing runs. A CLI whose first two probes stall past the probe
  timeout (as at load ~260, 2026-09-28) and then answer: the tutor answers 503 "still starting"
  and spawns nothing until a re-probe answers, then serves confined turns; the proxy before this
  read the timeout as every option missing and refused for its whole life. Removing any of these
  protections turns it red.
- `probe-real.sh` (real CLI, spends tokens): plants an operator manual that orders a handoff
  write outside the lesson, then asks a student question, asks the tutor to quote its instructions
  and to Read the workspace's and the box's manual by path, and asks for writes outside the lesson,
  to `package.json` and `vite.config.js`, and to the lesson source, in isolated and shared mode.
  `PROXY_REF=origin/main` runs the old proxy for comparison.

## What neither check can show on this box

The Bash sandbox never starts here: Ubuntu's `apparmor_restrict_unprivileged_userns=1` blocks the
nested user namespace it needs, so `failIfUnavailable` refuses every Bash call. That means the
sandbox half of the confinement is configured and asserted, but not exercised: that Bash writes
only the scratch dir, and that `blockReadsOutsideWorkingDirectories` keeps a sandboxed command from
reading outside the working dirs. Where the sandbox does start (macOS, or a Linux host without that
restriction), those settings are all that bound Bash, and nothing here has watched them do it. The
Read denies for manuals were watched on the file tools only (Read and Grep), so whether they also
stop a sandboxed `cat` of a manual inside the workspace is not shown either.

## What the tutor loses

- The workspace's `.claude/agents` now arrive via `--plugin-dir`, so their names read
  `tutor-team:<agent>`.
- It writes only the lesson source (`src/*.jsx`, for an approved suggestion) and its scratch dir
  `server/.isolated`. Everything else is refused, including the lesson's other files, the SKILL
  SYNC LOG edits to `_lesson-core/` and memory writes in shared mode that the system prompt still
  offers.
- Shared mode now runs in the scratch dir too, as isolated mode always did, so the lesson root is
  never the CLI's cwd. The two modes differ only in their prompt. Shared mode's memory under
  `~/.claude` is outside the working dirs, so it is not read either.
- It cannot read any CLAUDE.md, CLAUDE.local.md or AGENTS.md in the workspace, the lesson's own
  included, and nothing outside the lesson and the workspace.
- It needs Claude Code 2.1.283 or newer, the oldest version this was checked on. The read block is
  a settings key, which an older CLI would ignore without a word, so the proxy refuses it instead.
- No MCP server loads under `--restricted`, so the 17 `mcp__*` entries in the proxy's
  `ALLOWED_TOOLS` (Exa search, Playwright) do nothing. The research and visual agents have lost
  them.
- Bash runs only inside the CLI's sandbox. Where the sandbox cannot start it is refused. On a host
  that blocks nested user namespaces (Ubuntu's `apparmor_restrict_unprivileged_userns=1`), that
  means every call.

## Figures

A tutor draws with matplotlib through Bash, inside the same sandbox, and saves the image into `out/`
in its scratch dir; its answer shows it as `![](chat/file/<name>)`. The proxy's `GET /chat/file/<name>`
is the only way that file reaches the browser. It is the hosted tutor's contract (iiks1
`lessons/chat.py` `ep_file`), so the same prompt line and the same link work behind lessons.ihsan.cc.
Nothing new is writable: the sandbox still writes only the scratch dir, and matplotlib's cache goes
there too (`MPLCONFIGDIR`). The route reads only `out/` under this lesson's scratch, opens `out/` and
the file without following a link, serves regular files of an image type only (no SVG, which would
run as script on this origin), and answers 404 to anything else.

On iiks1 the local tutor still cannot draw, because its Bash sandbox cannot start there (above), so
the figure route has nothing to serve until that host restriction is lifted. The hosted tutor runs
in its own bwrap, which does start, and draws today.
