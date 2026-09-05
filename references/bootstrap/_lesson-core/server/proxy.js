// Canonical Express proxy for all lessons.
// LOG_FILE and PORT_FILE use
// process.cwd() instead of __dirname so that per-lesson logs and port files
// land in the lesson's own server/ directory when this module is imported
// via a shim from `<lesson>/server/proxy.js` and launched with
// `cd <lesson> && node server/proxy.js`.
//
// Routes: /whoami, /session/init, /session/open, /session/transfer,
// /session/close, /upload, /chat, /chat/cancel, /sessions, /commit.
//
// Turn ownership. Every /chat turn spawns one `claude` CLI, which spawns its
// own children (MCP servers, Bash tool commands, subagents). The proxy owns
// that whole tree for the life of the turn: the CLI leads its own process
// group, and POST /chat/cancel {sessionId} tears the group down — SIGTERM,
// then SIGKILL for whatever is still alive after CANCEL_GRACE_MS — and
// answers once the tree is gone. A client merely disconnecting does NOT
// cancel (an HMR reload must not lose a turn); only the endpoint does, and
// /session/close without keepContext, which discards the session outright.
// Cancel is idempotent for the turn it hit (a repeat answers 200 again) and
// refuses ids that are not running a turn: 404 for an unknown id, 409 for a
// session with nothing in flight (its latest turn completed or errored, or it
// has not run one). A cancel accepted before the CLI exits wins over its exit
// code: the turn ends as cancelled even if the CLI shut down cleanly or
// printed its result as the kill landed. Going down (SIGINT/SIGTERM/SIGHUP)
// SIGTERMs every running turn's tree rather than orphaning it.
//
// Resume candidacy. /sessions reports `resumable` per session: true unless
// the session is open in a tab, has a turn in flight, or its latest turn was
// cancelled. A completed turn (or a fresh session) makes it a candidate; a
// cancelled turn never does — the next completed turn is what re-promotes it.
import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { spawn, spawnSync } from "child_process";
import { fileURLToPath } from "url";

// Can we spawn the CLI WITHOUT a shell?
//
// This matters more than it looks. With `shell: true`, Node hands the joined
// argv to cmd.exe / sh as one command line and does NOT quote the parts. Any
// argument containing a space is split into several arguments, and on Windows
// anything after the first newline is dropped entirely. The system prompt is
// ~13k chars of multi-line text, so under a shell the CLI received the single
// word "You" and the whole PEDAGOGY POLICY, isolation block, and <<TAG>>
// protocol section silently vanished. (`--add-dir` breaks the same way as
// soon as the workspace path contains a space.)
//
// `shell: true` was there because Node >= 20 refuses to spawn Windows .cmd /
// .bat shims without one. So: probe once at startup. Native installs and
// POSIX get correct argv; only shim installs fall back to the shell, and on
// that path the system prompt is routed through stdin instead of argv.
// Resolve the binary ONCE and spawn that exact path from then on. Probing the
// bare name `claude` and then spawning the bare name is not the same question:
// a shell and Node's shell-free resolver walk PATH differently (PATHEXT, and
// extensionless files that only a shell can run), so a probe can succeed
// against one file while every real spawn silently hits another.
function resolveClaude() {
  const isWin = process.platform === "win32";
  try {
    const r = spawnSync(isWin ? "where" : "which", ["claude"], { encoding: "utf8", shell: false, timeout: 20000 });
    if (r.status === 0) {
      const first = String(r.stdout || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
      if (first) return first;
    }
  } catch (_) {}
  return null;
}

const CLAUDE_BIN = resolveClaude();
// A .cmd/.bat/.ps1 shim (the npm install shape) can only be launched through a
// shell, and a shell mangles argv — so those installs keep the shell and get
// the system prompt through stdin instead.
const CLAUDE_IS_SHIM = !!CLAUDE_BIN && /\.(cmd|bat|ps1)$/i.test(CLAUDE_BIN);
const SHELL_FREE = (() => {
  if (!CLAUDE_BIN || CLAUDE_IS_SHIM) return false;
  try {
    const r = spawnSync(CLAUDE_BIN, ["--version"], { shell: false, timeout: 20000 });
    return !r.error && r.status === 0;
  } catch (_) {
    return false;
  }
})();
const CLAUDE_CMD = CLAUDE_BIN || "claude";

const LOG_FILE = path.join(process.cwd(), "server", "chat.log");

// Derive the workspace root so the CLI can Read _lesson-core/prompts/*.md
// and discover agents at <workspace_root>/.claude/agents/*.md when running
// from a lesson subdirectory. __dirname here = _lesson-core/server; the
// workspace root is two levels up. Passed to the CLI via --add-dir on every
// spawn.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_DIR = path.dirname(path.dirname(__dirname));

// Identity of the lesson this proxy serves, as a resolved realpath. Vite
// forwards chat traffic here only after matching this exact string, so the
// same lesson reached through a symlink must compare equal to itself, and two
// checkouts of the same lesson in different git worktrees must compare
// unequal — they are different directories with different files.
const realpathOf = (p) => { try { return fs.realpathSync(p); } catch (_) { return path.resolve(p); } };
const LESSON_DIR = realpathOf(process.cwd());
const STARTED_AT = new Date().toISOString();
let BOUND_PORT = null;

const app = express();
// Localhost-only CORS. `origin: true` would reflect ANY origin, letting an
// arbitrary webpage the user visits drive /chat (token spend), /upload
// (disk writes), and /commit (repo mutations) on this machine. Requests with
// no Origin header (curl, same-machine tools) are allowed.
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)) cb(null, true);
    else cb(new Error("Origin not allowed"));
  },
}));
// 40mb: attachments are base64 JSON (5MB/file client cap -> ~6.8MB encoded,
// several files per message). The old 2mb limit 413'd documented uploads.
app.use(express.json({ limit: "40mb" }));

// Cross-lesson guard. Every lesson runs its own copy of this proxy and they
// all compete for port 3001, so "the port lesson X used last time" is not the
// same question as "where lesson X's proxy is now" — another lesson's proxy
// answers on that port just as readily, and would then list its own chat
// sessions and run the CLI with its own directory as cwd. Vite stamps each
// forwarded request with the lesson it believes it is talking to; anything
// that names a different lesson is refused here, before a session is opened
// or a CLI is spawned. Requests without the header (curl, health checks) are
// unaffected.
app.use((req, res, next) => {
  const expected = req.get("x-expect-lesson-dir");
  if (expected && expected !== LESSON_DIR) {
    log("WRONG_LESSON", { url: req.originalUrl, expected, actual: LESSON_DIR });
    return res.status(409).json({ error: { message: `This chat backend serves ${path.basename(LESSON_DIR)}, not ${path.basename(expected)}. The lesson's own proxy is not running on this port — restart it (\`npm run proxy\` from the lesson directory).` } });
  }
  next();
});

// Identity endpoint: lets a client confirm which lesson answered before it
// trusts anything else the connection says.
app.get("/whoami", (req, res) => {
  res.json({ lessonDir: LESSON_DIR, port: BOUND_PORT, pid: process.pid, startedAt: STARTED_AT });
});

// Values spliced into CLI argv (spawned with shell:true for Windows .cmd
// compatibility) must be allowlisted — model/effort/sessionId arrive from the
// client and would otherwise be shell-injectable.
const SAFE_MODEL_RE = /^[a-zA-Z0-9._-]{1,64}$/;
const SAFE_SESSION_RE = /^[a-zA-Z0-9-]{8,64}$/;
const SAFE_EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);
const safeModel = (m, fallback) => (typeof m === "string" && SAFE_MODEL_RE.test(m) ? m : fallback);
const safeEffort = (e, fallback) => (SAFE_EFFORTS.has(e) ? e : fallback);
const safeSession = (s) => (typeof s === "string" && SAFE_SESSION_RE.test(s) ? s : null);

// Null-prototype maps: these are keyed by a client-supplied id, so a plain
// object literal lets `sessionId: "__proto__"` write session state onto
// Object.prototype (every later lookup then finds a phantom session).
const sessions = Object.create(null);
const _sessionQueues = Object.create(null); // sessionId -> Promise chain
let nextChatNum = 1;
let totalTokens = { input: 0, output: 0, cacheRead: 0, cacheCreate: 0, cost: 0 };

const ALLOWED_TOOLS = [
  "Read", "Edit", "Write", "Grep", "Glob", "Bash", "WebSearch", "WebFetch", "Agent",
  // Exa MCP via claude.ai account sync (used by research-agent)
  "mcp__claude_ai_Exa__web_search_exa",
  "mcp__claude_ai_Exa__web_fetch_exa",
  // Playwright MCP via project .mcp.json (used by visual feedback loop and interaction-agent)
  "mcp__playwright__browser_navigate",
  "mcp__playwright__browser_take_screenshot",
  "mcp__playwright__browser_snapshot",
  "mcp__playwright__browser_click",
  "mcp__playwright__browser_drag",
  "mcp__playwright__browser_hover",
  "mcp__playwright__browser_type",
  "mcp__playwright__browser_press_key",
  "mcp__playwright__browser_select_option",
  "mcp__playwright__browser_evaluate",
  "mcp__playwright__browser_wait_for",
  "mcp__playwright__browser_console_messages",
  "mcp__playwright__browser_network_requests",
  "mcp__playwright__browser_resize",
  "mcp__playwright__browser_close",
].join(",");

function log(event, data) {
  const ts = new Date().toISOString();
  const line = `[${ts}] [${event}] ${Object.entries(data).map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`).join(" ")}\n`;
  console.log(`[proxy] ${event}: ${Object.entries(data).map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`).join(" ")}`);
  try { fs.appendFileSync(LOG_FILE, line); } catch (_) {}
}

function modelAlias(model) {
  // CLI accepts full names ('claude-opus-4-7') or latest-model aliases ('opus'/'sonnet'/'haiku').
  // Pass through so selecting "Opus 4.6" runs 4.6, not the 'opus' alias (which CLI resolves to 4.7).
  return model;
}

function extractTokens(parsed) {
  const u = parsed.usage || {};
  return {
    input: u.input_tokens || 0,
    output: u.output_tokens || 0,
    cacheRead: u.cache_read_input_tokens || 0,
    cacheCreate: u.cache_creation_input_tokens || 0,
    cost: parsed.total_cost_usd || 0,
  };
}

function accumulateTokens(tok) {
  totalTokens.input += tok.input;
  totalTokens.output += tok.output;
  totalTokens.cacheRead += tok.cacheRead;
  totalTokens.cacheCreate += tok.cacheCreate;
  totalTokens.cost += tok.cost;
}

function enqueueForSession(sessionId, fn) {
  const prev = _sessionQueues[sessionId] || Promise.resolve();
  const next = prev.then(fn, fn); // always chain, even on error
  _sessionQueues[sessionId] = next;
  next.finally(() => { if (_sessionQueues[sessionId] === next) delete _sessionQueues[sessionId]; });
  return next;
}

// Process-tree ownership for a turn. The CLI is spawned as the leader of a
// new process group (detached, POSIX), so `kill(-pid)` reaches every child it
// forked with no race against children forked after enumeration. The ps walk
// is the belt to that brace: it also finds a descendant that called setsid (a
// Bash tool command can), and it is how the caller verifies the tree is really
// gone. Zombies are not alive. Windows has no groups; taskkill /T walks the tree.
const IS_WIN = process.platform === "win32";
const CANCEL_GRACE_MS = 1500;

function psTable() {
  if (IS_WIN) return null;
  try {
    const out = spawnSync("ps", ["-eo", "pid=,ppid=,pgid=,stat="], { encoding: "utf8", timeout: 5000 }).stdout || "";
    const rows = [];
    for (const line of out.split("\n")) {
      const m = line.trim().split(/\s+/);
      if (m.length >= 4 && !m[3].startsWith("Z")) rows.push({ pid: Number(m[0]), ppid: Number(m[1]), pgid: Number(m[2]) });
    }
    return rows;
  } catch (_) { return []; }
}

const pidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (err) { return err.code === "EPERM"; } };

// Live pids of the tree rooted at rootPid: the root, its descendants, and any
// member of its process group that re-parented to init when its parent died.
function listTree(rootPid) {
  const rows = psTable();
  if (!rows) return pidAlive(rootPid) ? [rootPid] : [];
  const found = new Set();
  const stack = [rootPid];
  const alive = new Set(rows.map((r) => r.pid));
  while (stack.length) {
    const p = stack.pop();
    if (found.has(p)) continue;
    if (alive.has(p)) found.add(p);
    for (const r of rows) if (r.ppid === p && !found.has(r.pid)) stack.push(r.pid);
  }
  for (const r of rows) if (r.pgid === rootPid) found.add(r.pid);
  return [...found];
}

function signalTree(rootPid, pids, sig) {
  if (IS_WIN) {
    try { spawnSync("taskkill", ["/pid", String(rootPid), "/T", "/F"], { timeout: 5000 }); } catch (_) {}
    return;
  }
  try { process.kill(-rootPid, sig); } catch (_) {}
  for (const p of pids) { try { process.kill(p, sig); } catch (_) {} }
}

// "kill the whole process TREE, SIGTERM then SIGKILL after a short grace".
// Resolves with the pids still alive at the end — empty when the tree is gone.
function killTree(rootPid) {
  signalTree(rootPid, listTree(rootPid), "SIGTERM");
  return new Promise((resolve) => setTimeout(() => {
    const left = listTree(rootPid);
    if (left.length) signalTree(rootPid, left, "SIGKILL");
    setTimeout(() => resolve(listTree(rootPid)), 150);
  }, CANCEL_GRACE_MS));
}

// Called on the way out: the proxy owns every running turn's tree, so going
// down takes them along instead of orphaning a CLI that keeps spending tokens
// with nobody left to read the answer. Exit handlers cannot wait, so this is
// SIGTERM only.
function killActiveTurns() {
  for (const s of Object.values(sessions)) {
    if (s.turn && !s.turn.cancelled) {
      s.turn.cancelled = true;
      signalTree(s.turn.pid, listTree(s.turn.pid), "SIGTERM");
    }
  }
}

const PROJECT_DIR = process.cwd();
const ISOLATED_CWD = path.join(PROJECT_DIR, "server", ".isolated");

function runClaude(args, stdinContent, isolated = false) {
  return new Promise((resolve, reject) => {
    const cwd = isolated ? ISOLATED_CWD : PROJECT_DIR;
    if (isolated) {
      try { fs.mkdirSync(cwd, { recursive: true }); } catch (_) {}
      args.push("--add-dir", PROJECT_DIR);
    }
    args.push("--add-dir", REPO_DIR);
    const proc = spawn(CLAUDE_CMD, args, { shell: !SHELL_FREE, timeout: 1800000, cwd, env: { ...process.env, MPLBACKEND: "agg" } });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", (err) => reject(err));
    proc.on("close", (code) => {
      if (code !== 0) reject(new Error(stderr.trim() || `claude exited with code ${code}`));
      else resolve(stdout);
    });
    if (stdinContent) proc.stdin.write(stdinContent);
    proc.stdin.end();
  });
}

// The CLI shares stdout with diagnostics from the MCP clients it connects on
// startup — "Client.listTools() called but server does not advertise tools
// capability - returning empty list" is one this box emits — and those lines
// arrive asynchronously, so they can land before or after the result object.
// JSON.parse() over the whole buffer therefore fails intermittently, and when
// it does the student is told "Session failed to initialize. Is the proxy
// server running?" while the proxy is perfectly healthy. Take the result
// object out of the noise instead of assuming stdout holds nothing else.
function parseCliJson(raw) {
  const text = String(raw).trim();
  try { return JSON.parse(text); } catch (_) {}
  // Scan from the end: the result object is the last thing the CLI itself
  // writes, and a late diagnostic is a bare line rather than an object.
  for (const line of text.split("\n").reverse()) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(t);
      if (parsed && typeof parsed === "object") return parsed;
    } catch (_) {}
  }
  throw new Error(`no JSON object in CLI output: ${text.slice(0, 300)}`);
}

function runClaudeStreaming(args, stdinContent, isolated, onEvent, onDone, onError) {
  const cwd = isolated ? ISOLATED_CWD : PROJECT_DIR;
  if (isolated) {
    try { fs.mkdirSync(cwd, { recursive: true }); } catch (_) {}
    args.push("--add-dir", PROJECT_DIR);
  }
  args.push("--add-dir", REPO_DIR);
  // detached: the CLI leads its own process group so /chat/cancel can take
  // the whole tree down with one signal (see killTree).
  const proc = spawn(CLAUDE_CMD, args, { shell: !SHELL_FREE, timeout: 1800000, cwd, detached: !IS_WIN, env: { ...process.env, MPLBACKEND: "agg" } });
  let buffer = "";
  let stderr = "";
  proc.stdout.on("data", (d) => {
    buffer += d.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        onEvent(parsed);
      } catch (_) {}
    }
  });
  proc.stderr.on("data", (d) => (stderr += d.toString()));
  proc.on("error", (err) => onError(err));
  proc.on("close", (code) => {
    if (buffer.trim()) {
      try {
        const parsed = JSON.parse(buffer.trim());
        onEvent(parsed);
      } catch (_) {}
    }
    if (code !== 0) onError(new Error(stderr.trim() || `claude exited with code ${code}`));
    else onDone();
  });
  if (stdinContent) proc.stdin.write(stdinContent);
  proc.stdin.end();
  return proc;
}

// Attach the system prompt the safest way this install allows: argv only when
// we control quoting (SHELL_FREE) and the CLI's size ceiling allows it,
// otherwise demote it into stdin as a [System Instructions] preamble.
// Demotion lowers the prompt's priority — but a demoted prompt beats one the
// shell shredded into single words. Returns the stdin content to send.
function withSystemPrompt(args, system, basePrompt) {
  if (!system) return basePrompt;
  if (SHELL_FREE && system.length <= 28000) {
    args.push("--system-prompt", system);
    return basePrompt;
  }
  return `[System Instructions]:\n${system}\n\n${basePrompt}`;
}

app.post("/session/init", async (req, res) => {
  const { model, effort, isolated, system } = req.body;
  const cliModel = modelAlias(safeModel(model, "sonnet"));
  const cliEffort = safeEffort(effort, "high");
  const chatNum = nextChatNum++;

  log("INIT_START", { chatNum, model: cliModel, effort: cliEffort, isolated: !!isolated });

  const args = [
    "-p", "--print", "--output-format", "json",
    "--model", cliModel, "--effort", cliEffort,
    "--allowedTools", ALLOWED_TOOLS,
  ];

  // 28000-char threshold (not 6000): the pedagogy-policy-bearing prompt is
  // ~8-12k chars, and demoting it to a [System Instructions] user turn drops
  // its priority. Windows' ~32k command-line limit is the real ceiling.
  const initPrompt = "Session initialized. Ready for questions.";
  const stdinContent = withSystemPrompt(args, system, initPrompt);

  try {
    const raw = await runClaude(args, stdinContent, !!isolated);
    const parsed = parseCliJson(raw);
    const sessionId = parsed.session_id;
    if (!sessionId) throw new Error("No session_id in response");

    const tok = extractTokens(parsed);
    accumulateTokens(tok);

    sessions[sessionId] = {
      chatNum, model: cliModel, effort: cliEffort, isolated: !!isolated,
      created: Date.now(), lastSeen: Date.now(), messageCount: 0, open: true,
      turn: null, lastTurn: null,
    };

    log("INIT_OK", { chatNum, sessionId: sessionId.slice(0, 8), ...tok, totalCost: totalTokens.cost.toFixed(4) });
    res.json({ sessionId, chatNum, content: [{ type: "text", text: parsed.result || "Session ready." }] });
  } catch (err) {
    log("INIT_ERROR", { chatNum, error: err.message });
    res.status(500).json({ error: { message: err.message } });
  }
});

app.post("/session/open", (req, res) => {
  // Same allowlist the other session routes use — an id has to look like an
  // id before it is used as a map key.
  const sessionId = safeSession(req.body?.sessionId);
  const session = sessionId && sessions[sessionId];
  if (!session) return res.status(404).json({ error: { message: "Session not found" } });
  if (session.open) return res.status(409).json({ error: { message: `Chat #${session.chatNum} is already open in another tab` } });
  session.open = true;
  session.lastSeen = Date.now();
  log("SESSION_OPEN", { chatNum: session.chatNum, sessionId: sessionId.slice(0, 8) });
  res.json({ ok: true, chatNum: session.chatNum, isolated: !!session.isolated });
});

app.post("/session/transfer", async (req, res) => {
  const { sessionId: rawSessionId, model, effort, isolated, system } = req.body;
  const sessionId = safeSession(rawSessionId);
  const oldSession = sessionId && sessions[sessionId];
  if (!oldSession) return res.status(404).json({ error: { message: "Session not found" } });

  const chatNum = oldSession.chatNum;
  const newIsolated = !oldSession.isolated;
  const cliModel = modelAlias(safeModel(model, oldSession.model));
  const cliEffort = safeEffort(effort, oldSession.effort);

  log("TRANSFER_START", { chatNum, from: oldSession.isolated ? "isolated" : "shared", to: newIsolated ? "isolated" : "shared" });

  let summary = "";
  try {
    const dumpArgs = ["--resume", sessionId, "-p", "--print", "--output-format", "json", "--model", "haiku", "--effort", "low"];
    const dumpPrompt = "SYSTEM TASK: This session is being transferred. Output a concise summary of everything discussed so far, including any key facts, decisions, secret words, or context the user shared. Format as plain text. Be brief.";
    const dumpRaw = await Promise.race([
      runClaude(dumpArgs, dumpPrompt, oldSession.isolated),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Dump timed out after 30s")), 30000)),
    ]);
    const dumpParsed = parseCliJson(dumpRaw);
    summary = dumpParsed.result || "";
    const tok = extractTokens(dumpParsed);
    accumulateTokens(tok);
    log("TRANSFER_DUMP", { chatNum, summaryLen: summary.length, ...tok });
  } catch (err) {
    log("TRANSFER_DUMP_ERROR", { chatNum, error: err.message });
  }

  const newArgs = ["-p", "--print", "--output-format", "json", "--model", cliModel, "--effort", cliEffort, "--allowedTools", ALLOWED_TOOLS];
  let initPrompt = summary
    ? `This session was transferred from a previous chat. Here is the context from the previous session:\n\n---\n${summary}\n---\n\nContinue the conversation seamlessly. The user should not notice any disruption.`
    : "Session initialized. Ready for questions.";
  initPrompt = withSystemPrompt(newArgs, system, initPrompt);

  try {
    const raw = await runClaude(newArgs, initPrompt, newIsolated);
    const parsed = parseCliJson(raw);
    const newSessionId = parsed.session_id;
    if (!newSessionId) throw new Error("No session_id in response");
    const tok = extractTokens(parsed);
    accumulateTokens(tok);
    // Delete the old record only after the new session exists — a failed
    // transfer must leave the original session usable, not orphaned.
    delete sessions[sessionId];
    sessions[newSessionId] = { chatNum, model: cliModel, effort: cliEffort, isolated: newIsolated, created: Date.now(), lastSeen: Date.now(), messageCount: oldSession.messageCount, open: true, turn: null, lastTurn: null };
    log("TRANSFER_OK", { chatNum, newSessionId: newSessionId.slice(0, 8), isolated: newIsolated, ...tok, totalCost: totalTokens.cost.toFixed(4) });
    res.json({ sessionId: newSessionId, chatNum, isolated: newIsolated, content: [{ type: "text", text: parsed.result || "Session transferred." }] });
  } catch (err) {
    log("TRANSFER_ERROR", { chatNum, error: err.message });
    res.status(500).json({ error: { message: err.message } });
  }
});

app.post("/session/close", (req, res) => {
  const { keepContext } = req.body || {};
  const sessionId = safeSession(req.body?.sessionId);
  const session = sessionId && sessions[sessionId];
  if (!session) return res.json({ ok: true });
  if (keepContext) {
    session.open = false;
    log("SESSION_RELEASE", { chatNum: session.chatNum, sessionId: sessionId.slice(0, 8) });
  } else {
    const chatNum = session.chatNum;
    // Discarding the session discards its running turn too: the client's
    // KILL sends this right after /chat/cancel, and if this landed first the
    // cancel would 404 while the CLI ran on. Not awaited — the reply is not
    // what the tree's fate depends on.
    if (session.turn && !session.turn.cancelled) {
      const turn = session.turn;
      turn.cancelled = true;
      log("SESSION_DELETE_KILL", { chatNum, msg: turn.msgNum, pid: turn.pid });
      turn.killed = killTree(turn.pid).then((left) => { log("CANCEL_DONE", { chatNum, msg: turn.msgNum, survivors: left }); return left; });
    }
    delete sessions[sessionId];
    log("SESSION_DELETE", { chatNum, sessionId: sessionId.slice(0, 8) });
  }
  res.json({ ok: true });
});

const UPLOAD_DIR = path.join(PROJECT_DIR, "server", ".uploads");
try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch (_) {}

app.post("/upload", (req, res) => {
  const { files } = req.body;
  if (!files || !Array.isArray(files)) return res.status(400).json({ error: { message: "files array required" } });
  const paths = [];
  for (const f of files) {
    const ext = f.name?.split(".").pop() || (f.type?.startsWith("image/") ? "png" : "pdf");
    const fname = `upload_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const fpath = path.join(UPLOAD_DIR, fname);
    try {
      fs.writeFileSync(fpath, Buffer.from(f.data, "base64"));
      paths.push(fpath);
      log("UPLOAD", { name: f.name, type: f.type, size: f.data.length, path: fpath });
    } catch (err) {
      log("UPLOAD_ERROR", { name: f.name, error: err.message });
    }
  }
  res.json({ paths });
});

app.post("/chat", async (req, res) => {
  const { sessionId, message, model, effort, system, messages } = req.body;

  if (!sessionId) {
    const prompt = (messages || []).map(m => {
      const role = m.role === "user" ? "User" : "Assistant";
      const text = typeof m.content === "string" ? m.content :
        (Array.isArray(m.content) ? m.content.filter(b => b.type === "text").map(b => b.text).join("\n") : String(m.content));
      return `[${role}]: ${text}`;
    }).join("\n\n");
    const cliModel = modelAlias(safeModel(model, "sonnet"));
    const args = ["-p", "--print", "--output-format", "json", "--model", cliModel, "--effort", safeEffort(effort, "high"), "--no-session-persistence", "--allowedTools", ALLOWED_TOOLS];
    const statelessStdin = withSystemPrompt(args, system, prompt);
    try {
      const raw = await runClaude(args, statelessStdin);
      const parsed = parseCliJson(raw);
      const tok = extractTokens(parsed); accumulateTokens(tok);
      log("STATELESS", { model: cliModel, ...tok });
      res.json({ content: [{ type: "text", text: parsed.result || "No response." }], model: cliModel, stop_reason: "end_turn" });
    } catch (err) {
      log("STATELESS_ERROR", { error: err.message });
      res.status(500).json({ error: { message: err.message } });
    }
    return;
  }

  const safeId = safeSession(sessionId);
  const session = safeId && sessions[safeId];
  if (!session) {
    log("CHAT_404", { sessionId: String(sessionId).slice(0, 8) });
    return res.status(404).json({ error: { message: "Session not found. Create a new one." } });
  }

  session.messageCount++;
  session.lastSeen = Date.now();
  const cliModel = modelAlias(safeModel(model, session.model));
  const cliEffort = safeEffort(effort, session.effort);
  const msgNum = session.messageCount;

  log("CHAT_START", { chatNum: session.chatNum, msg: msgNum, model: cliModel, effort: cliEffort, message: message || "" });

  enqueueForSession(safeId, () => new Promise((resolve) => {
    const args = [
      "--resume", safeId, "-p", "--print", "--output-format", "stream-json", "--verbose",
      "--model", cliModel, "--effort", cliEffort, "--allowedTools", ALLOWED_TOOLS,
    ];

    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" });

    let resultSent = false;
    // One settle per turn. Records the outcome the resume rule reads
    // ("a cancelled turn never promotes its session to resume-candidate —
    // promotion happens only on completion") and releases the turn slot.
    let turn = null;
    let settled = false;
    let streamedChars = 0;
    const settle = (outcome) => {
      if (settled) return;
      settled = true;
      // A cancel accepted before the CLI exited wins over its exit code: a
      // CLI that handles SIGTERM by exiting 0, or that printed its result as
      // the kill landed, is still a turn the student stopped.
      if (turn && turn.cancelled) outcome = "cancelled";
      if (session.turn === turn) session.turn = null;
      session.lastTurn = { msg: msgNum, outcome, at: Date.now() };
      resolve();
    };
    const sse = (event, data) => { try { if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch (_) {} };
    // The CLI is gone after /chat/cancel (or a session delete) — killed, or
    // exited on its own as the kill landed. Whatever its exit code, the log
    // says cancelled, not error, and the stream ends with `cancelled`.
    const cancelledExit = () => {
      log("CHAT_CANCELLED", { chatNum: session.chatNum, msg: msgNum, streamed: streamedChars });
      sse("cancelled", { msg: msgNum });
      res.end();
      settle("cancelled");
    };

    const proc = runClaudeStreaming(args, message, session.isolated,
      (parsed) => {
        try {
          if (parsed.type === "assistant" && Array.isArray(parsed.message?.content)) {
            for (const block of parsed.message.content) {
              if (block.type === "tool_use") {
                res.write(`event: status\ndata: ${JSON.stringify({ type: "tool", name: block.name, description: block.input?.description || block.input?.command || "" })}\n\n`);
              } else if (block.type === "text") {
                res.write(`event: text\ndata: ${JSON.stringify({ text: block.text })}\n\n`);
              } else if (block.type === "thinking") {
                res.write(`event: status\ndata: ${JSON.stringify({ type: "thinking" })}\n\n`);
              }
            }
          } else if (parsed.type === "result") {
            const tok = extractTokens(parsed);
            accumulateTokens(tok);
            log("CHAT_OK", { chatNum: session.chatNum, msg: msgNum, ...tok, totalCost: totalTokens.cost.toFixed(4), response: parsed.result || "" });
            resultSent = true;
            // The result raced the kill: tokens are accounted (CHAT_OK), but
            // the student stopped this turn, so it ends as stopped.
            if (turn && turn.cancelled) return cancelledExit();
            res.write(`event: done\ndata: ${JSON.stringify({ text: parsed.result || "", usage: parsed.usage, cost: parsed.total_cost_usd })}\n\n`);
            res.end();
            settle("completed");
          }
        } catch (_) {}
      },
      () => {
        if (turn && turn.cancelled) return cancelledExit();
        if (!resultSent) { sse("done", { text: "" }); res.end(); }
        settle("completed");
      },
      (err) => {
        if (turn && turn.cancelled) return cancelledExit();
        log("CHAT_ERROR", { chatNum: session.chatNum, error: err.message });
        sse("error", { message: err.message });
        res.end();
        settle("error");
      }
    );
    proc.stdout.on("data", (d) => { streamedChars += d.length; });
    turn = { msgNum, pid: proc.pid, proc, startedAt: Date.now(), cancelled: false, killed: null };
    session.turn = turn;

    res.on("close", () => {
      log("CHAT_DISCONNECT", { chatNum: session.chatNum, msg: msgNum, resultSent });
      // A disconnect is not a cancel: let the CLI finish (an HMR reload must
      // not lose a turn — the session keeps the result for the next message).
      // Stopping is explicit: the client's Stop calls POST /chat/cancel.
    });
  }));
});

// POST /chat/cancel {sessionId} — see "Turn ownership" at the top. Answers
// after the tree is gone (or after the grace, naming the survivors).
app.post("/chat/cancel", async (req, res) => {
  const safeId = safeSession(req.body?.sessionId);
  const session = safeId && sessions[safeId];
  if (!session) {
    log("CANCEL_404", { sessionId: String(req.body?.sessionId || "").slice(0, 8) });
    return res.status(404).json({ error: { message: "Session not found" } });
  }
  const turn = session.turn;
  if (!turn) {
    // Idempotent for the turn it hit: a repeat that arrives after teardown
    // answers as the first call did. Anything else has no turn to cancel.
    if (session.lastTurn && session.lastTurn.outcome === "cancelled") {
      return res.json({ ok: true, cancelled: true, repeat: true, msg: session.lastTurn.msg, survivors: [] });
    }
    log("CANCEL_409", { chatNum: session.chatNum, lastTurn: session.lastTurn ? session.lastTurn.outcome : "none" });
    return res.status(409).json({ error: { message: "No turn in flight for this session" } });
  }
  session.lastSeen = Date.now();
  if (!turn.cancelled) {
    turn.cancelled = true;
    log("CANCEL_START", { chatNum: session.chatNum, msg: turn.msgNum, pid: turn.pid, tree: listTree(turn.pid).length });
    turn.killed = killTree(turn.pid).then((left) => { log("CANCEL_DONE", { chatNum: session.chatNum, msg: turn.msgNum, survivors: left }); return left; });
    const survivors = await turn.killed;
    return res.json({ ok: true, cancelled: true, msg: turn.msgNum, survivors });
  }
  // Already tearing down: join that teardown rather than start another.
  const survivors = await turn.killed;
  res.json({ ok: true, cancelled: true, repeat: true, msg: turn.msgNum, survivors });
});

app.get("/sessions", (req, res) => {
  const list = Object.entries(sessions).map(([id, s]) => ({
    id, chatNum: s.chatNum, model: s.model, effort: s.effort, isolated: !!s.isolated,
    created: s.created, messageCount: s.messageCount, open: s.open,
    turn: s.turn ? { msg: s.turn.msgNum, pid: s.turn.pid, startedAt: s.turn.startedAt, cancelling: s.turn.cancelled } : null,
    lastTurn: s.lastTurn,
    // "Resume candidacy" at the top: open, running, or cancelled last -> not a candidate.
    resumable: !s.open && !s.turn && !(s.lastTurn && s.lastTurn.outcome === "cancelled"),
  }));
  res.json({ sessions: list, totalTokens, nextChatNum });
});

// Phase E2 auto-commit. The client POSTs a bot-drafted commit message + paths
// after the user clicks the commit chip. We run the lesson tests first and
// only invoke git if they pass. Never force-pushes; never passes --no-verify.
// Paths are resolved against PROJECT_DIR (the lesson root) so the bot can
// suggest lesson-relative paths; git runs from REPO_DIR so pushes target the
// real repo root.
function runGit(args) {
  return new Promise((resolve, reject) => {
    // shell:false — commit messages and paths are model-controlled text; with
    // a shell they would be command-injectable. git.exe spawns fine without one.
    const proc = spawn("git", args, { cwd: REPO_DIR, shell: false });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim() || `git exited with code ${code}`));
    });
    proc.on("error", reject);
  });
}

app.post("/commit", async (req, res) => {
  const { sessionId, message, paths } = req.body;
  if (!sessionId || !message || !Array.isArray(paths) || paths.length === 0) {
    return res.status(400).json({ error: { message: "sessionId, message, paths required" } });
  }
  // Only a live chat session may commit — an unauthenticated POST with a made-up
  // id must not drive git.
  const safeId = safeSession(sessionId);
  if (!safeId || !sessions[safeId]) {
    return res.status(403).json({ error: { message: "No active session with that id" } });
  }
  // Every path must resolve inside the repo. Rejects ../ escapes and absolute
  // paths to arbitrary files.
  const resolvedPaths = paths.map(p => path.resolve(PROJECT_DIR, String(p)));
  const repoRoot = path.resolve(REPO_DIR) + path.sep;
  if (!resolvedPaths.every(p => p.startsWith(repoRoot))) {
    return res.status(400).json({ error: { message: "paths must resolve inside the workspace repo" } });
  }
  log("COMMIT_START", { sessionId: safeId.slice(0, 8), message, paths });

  // 1. Run test_lesson.cjs from the lesson root. If tests fail, bail out
  //    before touching git. test_lesson.cjs expects the lesson source file
  //    as its first argument; find the single non-main .jsx under src/ in
  //    the lesson root.
  try {
    const srcDir = path.join(PROJECT_DIR, "src");
    const jsxFiles = fs.readdirSync(srcDir)
      .filter(f => f.endsWith(".jsx") && f !== "main.jsx");
    if (jsxFiles.length === 0) {
      throw new Error(`no lesson .jsx found in ${srcDir}`);
    }
    if (jsxFiles.length > 1) {
      log("COMMIT_TEST_WARN", { note: "multiple .jsx candidates", candidates: jsxFiles });
    }
    const lessonFile = `src/${jsxFiles[0]}`;
    const testCmd = spawn("node", ["test_lesson.cjs", lessonFile], { cwd: PROJECT_DIR, shell: true });
    let testOutput = "";
    testCmd.stdout.on("data", (d) => (testOutput += d.toString()));
    testCmd.stderr.on("data", (d) => (testOutput += d.toString()));
    await new Promise((resolve, reject) => {
      testCmd.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error("Tests failed:\n" + testOutput.slice(-500)));
      });
      testCmd.on("error", reject);
    });
    log("COMMIT_TEST_OK", { lessonFile });
  } catch (err) {
    log("COMMIT_TEST_FAIL", { error: err.message });
    return res.status(400).json({ error: { message: "tests failed: " + err.message } });
  }

  // 2. git add + commit + push. `commit -- <paths>` commits ONLY the declared
  //    paths even when unrelated files sit pre-staged in the index. Push targets
  //    the branch actually checked out, never a hardcoded one; a push failure
  //    (no upstream, offline) is reported but does not undo the local commit.
  try {
    await runGit(["add", "--", ...resolvedPaths]);
    await runGit(["commit", "-m", message, "--", ...resolvedPaths]);
    const sha = (await runGit(["rev-parse", "HEAD"])).trim();
    const branch = (await runGit(["rev-parse", "--abbrev-ref", "HEAD"])).trim();
    let pushed = false, pushError = null;
    if (branch && branch !== "HEAD") {
      try { await runGit(["push", "origin", branch]); pushed = true; }
      catch (err) { pushError = err.message; }
    } else {
      pushError = "detached HEAD — commit created, not pushed";
    }
    log("COMMIT_OK", { sha: sha.slice(0, 8), branch, pushed, pushError: pushError || "" });
    res.json({ ok: true, sha, message, branch, pushed, ...(pushError ? { pushError } : {}) });
  } catch (err) {
    log("COMMIT_GIT_FAIL", { error: err.message });
    res.status(500).json({ error: { message: "git operation failed: " + err.message } });
  }
});

const BASE_PORT = process.env.PROXY_PORT ? Number(process.env.PROXY_PORT) : 3001;
const MAX_PORT_ATTEMPTS = 50;
const PORT_FILE = path.join(process.cwd(), "server", ".proxy-port");
// Identity file. `.proxy-port` holds a bare number, which cannot answer the
// only question that matters to a client — "is the process on that port MY
// lesson's proxy?" — so it is kept for launcher scripts that already read
// it, and this file carries the identity Vite actually checks.
const IDENT_FILE = path.join(process.cwd(), "server", ".proxy.json");

function writeIdentity(port) {
  // Identity first, port second: a launcher waits for .proxy-port before it
  // starts Vite, and Vite resolves through .proxy.json — so .proxy.json has
  // to be on disk before .proxy-port announces that the proxy is ready.
  try {
    fs.writeFileSync(IDENT_FILE, JSON.stringify({ port, lessonDir: LESSON_DIR, pid: process.pid, startedAt: STARTED_AT }, null, 2) + "\n");
  } catch (_) {}
  try { fs.writeFileSync(PORT_FILE, String(port)); } catch (_) {}
}

// Remove the identity on the way out so a client can tell "not running" from
// "running somewhere else" — but only if the file is still ours. A successor
// proxy for this lesson may already have overwritten it, and deleting its
// record would strand it.
let cleanedUp = false;
function clearIdentity() {
  if (cleanedUp) return;
  cleanedUp = true;
  try {
    const rec = JSON.parse(fs.readFileSync(IDENT_FILE, "utf8"));
    if (rec.pid !== process.pid) return;
  } catch (_) { return; }
  try { fs.unlinkSync(IDENT_FILE); } catch (_) {}
  try {
    if (fs.readFileSync(PORT_FILE, "utf8").trim() === String(BOUND_PORT)) fs.unlinkSync(PORT_FILE);
  } catch (_) {}
}
process.on("exit", clearIdentity);
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => { clearIdentity(); killActiveTurns(); process.exit(0); });
}

function startServer(port, attempt) {
  // Loopback-only bind: this proxy can spend tokens, write files, and run
  // git — it must never be reachable from the LAN. CORS alone only protects
  // against browsers; the bind is the real boundary.
  const server = app.listen(port, "127.0.0.1", () => {
    BOUND_PORT = port;
    writeIdentity(port);
    log("SERVER_START", { port, cwd: process.cwd(), lessonDir: LESSON_DIR, pid: process.pid, claude: CLAUDE_CMD, shellFree: SHELL_FREE, tools: ALLOWED_TOOLS });
    console.log(`[proxy] Claude CLI proxy on http://localhost:${port}`);
    if (!SHELL_FREE) {
      console.warn(`[proxy] NOTE: ${CLAUDE_BIN ? `\`${CLAUDE_BIN}\`` : "`claude`"} must be launched through a shell, and a shell mangles multi-line arguments. The system prompt is therefore sent as a [System Instructions] preamble on the first user turn instead of via --system-prompt. It arrives intact, just at lower priority. A native CLI binary (not a .cmd/.bat shim) restores full-fidelity system prompts.`);
    }
  });
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE" && attempt < MAX_PORT_ATTEMPTS) {
      console.log(`[proxy] Port ${port} in use, trying ${port + 1}...`);
      startServer(port + 1, attempt + 1);
    } else {
      console.error(`[proxy] Failed to start: ${err.message}`);
      process.exit(1);
    }
  });
}

startServer(BASE_PORT, 0);

// Heartbeat: release sessions whose lastSeen is older than 2 minutes.
// Prevents stale session.open flags when the browser crashes and sendBeacon never fires.
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of Object.entries(sessions)) {
    if (s.open && s.lastSeen && now - s.lastSeen > 120000) {
      s.open = false;
      log("SESSION_STALE_RELEASE", { chatNum: s.chatNum, sessionId: id.slice(0, 8) });
    }
  }
}, 30000);
