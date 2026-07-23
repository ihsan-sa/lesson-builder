// Canonical Express proxy for all lessons.
// LOG_FILE and PORT_FILE use
// process.cwd() instead of __dirname so that per-lesson logs and port files
// land in the lesson's own server/ directory when this module is imported
// via a shim from `<lesson>/server/proxy.js` and launched with
// `cd <lesson> && node server/proxy.js`.
import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const LOG_FILE = path.join(process.cwd(), "server", "chat.log");

// Derive the workspace root so the CLI can Read _lesson-core/prompts/*.md
// and discover agents at <workspace_root>/.claude/agents/*.md when running
// from a lesson subdirectory. __dirname here = _lesson-core/server; the
// workspace root is two levels up. Passed to the CLI via --add-dir on every
// spawn.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_DIR = path.dirname(path.dirname(__dirname));

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

// Values spliced into CLI argv (spawned with shell:true for Windows .cmd
// compatibility) must be allowlisted — model/effort/sessionId arrive from the
// client and would otherwise be shell-injectable.
const SAFE_MODEL_RE = /^[a-zA-Z0-9._-]{1,64}$/;
const SAFE_SESSION_RE = /^[a-zA-Z0-9-]{8,64}$/;
const SAFE_EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);
const safeModel = (m, fallback) => (typeof m === "string" && SAFE_MODEL_RE.test(m) ? m : fallback);
const safeEffort = (e, fallback) => (SAFE_EFFORTS.has(e) ? e : fallback);
const safeSession = (s) => (typeof s === "string" && SAFE_SESSION_RE.test(s) ? s : null);

const sessions = {};
const _sessionQueues = {}; // sessionId -> Promise chain
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
    const proc = spawn("claude", args, { shell: true, timeout: 1800000, cwd, env: { ...process.env, MPLBACKEND: "agg" } });
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

function runClaudeStreaming(args, stdinContent, isolated, onEvent, onDone, onError) {
  const cwd = isolated ? ISOLATED_CWD : PROJECT_DIR;
  if (isolated) {
    try { fs.mkdirSync(cwd, { recursive: true }); } catch (_) {}
    args.push("--add-dir", PROJECT_DIR);
  }
  args.push("--add-dir", REPO_DIR);
  const proc = spawn("claude", args, { shell: true, timeout: 1800000, cwd, env: { ...process.env, MPLBACKEND: "agg" } });
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
  let stdinContent = initPrompt;
  if (system && system.length <= 28000) {
    args.push("--system-prompt", system);
  } else if (system) {
    stdinContent = `[System Instructions]:\n${system}\n\n${initPrompt}`;
  }

  try {
    const raw = await runClaude(args, stdinContent, !!isolated);
    const parsed = JSON.parse(raw);
    const sessionId = parsed.session_id;
    if (!sessionId) throw new Error("No session_id in response");

    const tok = extractTokens(parsed);
    accumulateTokens(tok);

    sessions[sessionId] = {
      chatNum, model: cliModel, effort: cliEffort, isolated: !!isolated,
      created: Date.now(), lastSeen: Date.now(), messageCount: 0, open: true,
    };

    log("INIT_OK", { chatNum, sessionId: sessionId.slice(0, 8), ...tok, totalCost: totalTokens.cost.toFixed(4) });
    res.json({ sessionId, chatNum, content: [{ type: "text", text: parsed.result || "Session ready." }] });
  } catch (err) {
    log("INIT_ERROR", { chatNum, error: err.message });
    res.status(500).json({ error: { message: err.message } });
  }
});

app.post("/session/open", (req, res) => {
  const { sessionId } = req.body;
  const session = sessions[sessionId];
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
    const dumpParsed = JSON.parse(dumpRaw);
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
  if (system && system.length <= 28000) newArgs.push("--system-prompt", system);
  else if (system) initPrompt = `[System Instructions]:\n${system}\n\n${initPrompt}`;

  try {
    const raw = await runClaude(newArgs, initPrompt, newIsolated);
    const parsed = JSON.parse(raw);
    const newSessionId = parsed.session_id;
    if (!newSessionId) throw new Error("No session_id in response");
    const tok = extractTokens(parsed);
    accumulateTokens(tok);
    // Delete the old record only after the new session exists — a failed
    // transfer must leave the original session usable, not orphaned.
    delete sessions[sessionId];
    sessions[newSessionId] = { chatNum, model: cliModel, effort: cliEffort, isolated: newIsolated, created: Date.now(), lastSeen: Date.now(), messageCount: oldSession.messageCount, open: true };
    log("TRANSFER_OK", { chatNum, newSessionId: newSessionId.slice(0, 8), isolated: newIsolated, ...tok, totalCost: totalTokens.cost.toFixed(4) });
    res.json({ sessionId: newSessionId, chatNum, isolated: newIsolated, content: [{ type: "text", text: parsed.result || "Session transferred." }] });
  } catch (err) {
    log("TRANSFER_ERROR", { chatNum, error: err.message });
    res.status(500).json({ error: { message: err.message } });
  }
});

app.post("/session/close", (req, res) => {
  const { sessionId, keepContext } = req.body;
  const session = sessions[sessionId];
  if (!session) return res.json({ ok: true });
  if (keepContext) {
    session.open = false;
    log("SESSION_RELEASE", { chatNum: session.chatNum, sessionId: sessionId.slice(0, 8) });
  } else {
    const chatNum = session.chatNum;
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
    if (system && system.length <= 28000) args.push("--system-prompt", system);
    try {
      const raw = await runClaude(args, prompt);
      const parsed = JSON.parse(raw);
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
            res.write(`event: done\ndata: ${JSON.stringify({ text: parsed.result || "", usage: parsed.usage, cost: parsed.total_cost_usd })}\n\n`);
            resultSent = true;
            res.end();
            resolve();
          }
        } catch (_) {}
      },
      () => { if (!resultSent) { res.write(`event: done\ndata: ${JSON.stringify({ text: "" })}\n\n`); res.end(); } resolve(); },
      (err) => { log("CHAT_ERROR", { chatNum: session.chatNum, error: err.message }); res.write(`event: error\ndata: ${JSON.stringify({ message: err.message })}\n\n`); res.end(); resolve(); }
    );

    res.on("close", () => {
      log("CHAT_DISCONNECT", { chatNum: session.chatNum, msg: msgNum, resultSent });
      // Do not kill the process -- let it finish even if the client disconnected (e.g. HMR reload).
      // The session context is preserved in Claude's session, so the next message will have the result.
    });
  }));
});

app.get("/sessions", (req, res) => {
  const list = Object.entries(sessions).map(([id, s]) => ({
    id, chatNum: s.chatNum, model: s.model, effort: s.effort, isolated: !!s.isolated,
    created: s.created, messageCount: s.messageCount, open: s.open,
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

function startServer(port, attempt) {
  // Loopback-only bind: this proxy can spend tokens, write files, and run
  // git — it must never be reachable from the LAN. CORS alone only protects
  // against browsers; the bind is the real boundary.
  const server = app.listen(port, "127.0.0.1", () => {
    try { fs.writeFileSync(PORT_FILE, String(port)); } catch (_) {}
    log("SERVER_START", { port, cwd: process.cwd(), tools: ALLOWED_TOOLS });
    console.log(`[proxy] Claude CLI proxy on http://localhost:${port}`);
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
