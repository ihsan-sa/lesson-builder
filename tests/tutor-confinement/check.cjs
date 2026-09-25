// Asserts on what the proxy actually hands the CLI, read back from the fake's
// record. Mode "confined": every spawn carries the confinement. Mode
// "unconfined": a CLI lacking --restricted is never run for a tutor turn.
const fs = require("fs");
const path = require("path");
const BASE = process.env.PROXY_URL;
const L = fs.realpathSync(process.env.LESSON_DIR);
const WS = process.env.WS;
const MODE = process.argv[2];
let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"} ${msg}`); if (!cond) failures++; };
// One connection per request (Connection: close). fetch keeps idle sockets and
// the proxy closes one after 5s of keep-alive; under box load a request went
// out on a socket the live proxy had just closed and failed "other side
// closed" with no response. fetch does not retry that, so this suite must not
// reuse sockets at all (see tests/thread-actors/check.cjs proxyFetch).
const proxyFetch = (route, init) => fetch(BASE + route, { ...init, headers: { ...(init && init.headers), Connection: "close" } });
const post = async (route, body) => { const r = await proxyFetch(route, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); return { status: r.status, text: await r.text() }; };
const spawns = () => fs.readFileSync(path.join(WS, "record.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l))
  .filter((s) => !s.args.includes("--help") && !s.args.includes("--version"));
const argOf = (args, flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };

async function confined() {
  const iso = JSON.parse((await post("/session/init", { isolated: true })).text);
  const shared = JSON.parse((await post("/session/init", { isolated: false })).text);
  ok(!!iso.sessionId && !!shared.sessionId, "isolated and shared sessions open");
  ok((await post("/chat", { sessionId: iso.sessionId, message: "hi" })).text.includes("event: done"), "a streamed turn runs");
  ok((await post("/chat", { messages: [{ role: "user", content: "hi" }] })).status === 200, "a stateless turn runs");
  const all = spawns();
  ok(all.length === 4, `four CLI spawns recorded (${all.length})`);
  ok(all.some((s) => s.cwd === path.join(L, "server", ".isolated")) && all.some((s) => s.cwd === L), "both isolated and shared cwd were exercised");
  for (const [i, { args, addDirsClaudeMd }] of all.entries()) {
    const tag = `spawn ${i + 1}`;
    // Brief: "runs with none of the host repo's or the box's CLAUDE.md in its context".
    ok(args.includes("--restricted"), `${tag}: --restricted (no user/project settings, so no CLAUDE.md walk, hooks or user MCP)`);
    ok(addDirsClaudeMd === null, `${tag}: CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD stripped from the CLI's env`);
    ok(argOf(args, "--permission-prompts") === "none", `${tag}: --permission-prompts none`);
    const tools = (argOf(args, "--tools") || "").split(",");
    ok(tools.includes("Bash") && tools.includes("Agent") && tools.includes("Read"), `${tag}: --tools names Bash, Agent, Read (--restricted drops Bash otherwise)`);
    // Brief: "cannot write or run commands outside the lesson directory".
    const allowed = (argOf(args, "--allowedTools") || "").split(",");
    ok(!allowed.includes("Edit") && !allowed.includes("Write"), `${tag}: no blanket Edit/Write in --allowedTools (${allowed.filter((t) => !t.startsWith("mcp__")).join(",")})`);
    const sp = argOf(args, "--settings");
    ok(!!sp && !sp.startsWith(L + path.sep), `${tag}: settings file lives outside the lesson dir (${sp})`);
    let st = {};
    try { st = JSON.parse(fs.readFileSync(sp, "utf8")); } catch (_) {}
    ok(JSON.stringify(st.permissions?.allow) === JSON.stringify([`Edit(/${L}/**)`]), `${tag}: the only write rule is the lesson dir (${JSON.stringify(st.permissions?.allow)})`);
    const sb = st.sandbox || {};
    ok(sb.enabled === true && sb.failIfUnavailable === true && sb.allowUnsandboxedCommands === false, `${tag}: Bash sandboxed, refused where the sandbox cannot start, never unsandboxed`);
    ok(JSON.stringify(sb.filesystem?.allowWrite) === JSON.stringify([L]), `${tag}: the sandbox writes only the lesson dir`);
    const team = argOf(args, "--plugin-dir");
    ok(!!team && fs.existsSync(path.join(team, "agents", "zebra-agent.md")) && fs.existsSync(path.join(team, ".claude-plugin", "plugin.json")), `${tag}: the workspace's agent registry rides in as a plugin`);
  }
}

async function unconfined() {
  const init = await post("/session/init", { isolated: true });
  ok(init.status === 503 && /--restricted/.test(init.text), `/session/init refused 503 naming --restricted (${init.status})`);
  const stateless = await post("/chat", { messages: [{ role: "user", content: "hi" }] });
  ok(stateless.status === 503, `stateless /chat refused 503 (${stateless.status})`);
  ok(spawns().length === 0, "no tutor CLI was spawned");
  const log = fs.readFileSync(path.join(L, "server", "chat.log"), "utf8");
  ok(/\[TUTOR_UNCONFINED\].*--restricted/.test(log), "chat.log records TUTOR_UNCONFINED at startup");
  ok(/\[TUTOR_REFUSED\]/.test(log), "chat.log records each refusal");
}

(MODE === "confined" ? confined() : unconfined()).then(() => {
  console.log(failures ? `${failures} FAILED` : "all passed");
  process.exit(failures ? 1 : 0);
}).catch((e) => { console.error(e); process.exit(1); });
