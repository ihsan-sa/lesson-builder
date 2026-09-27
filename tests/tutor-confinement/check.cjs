// Asserts on what the proxy actually hands the CLI, read back from the fake's
// record. Mode "confined": every spawn carries the confinement. Mode
// "unconfined": a CLI lacking --restricted (named only inside another option's
// prose) is never run for a tutor turn. Mode "old": nor is one below the
// version floor. Mode "commit": /commit runs the lesson tests without a shell.
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
  const scratch = path.join(L, "server", ".isolated");
  for (const [i, { args, cwd, addDirsClaudeMd }] of all.entries()) {
    const tag = `spawn ${i + 1}`;
    // The sandbox lets Bash write its cwd: a cwd of the lesson root would give it package.json and server/.
    ok(cwd === scratch, `${tag}: runs in the scratch dir, in either memory mode (${cwd})`);
    const dirs = args.flatMap((a, j) => (a === "--add-dir" ? [args[j + 1]] : []));
    ok(dirs.includes(L) && dirs.includes(WSR), `${tag}: the lesson and the workspace are readable (${dirs.join(" ")})`);
    // Brief: "runs with none of the host repo's or the box's CLAUDE.md in its context".
    ok(args.includes("--restricted"), `${tag}: --restricted (no user/project settings, so no CLAUDE.md walk, hooks or user MCP)`);
    ok(addDirsClaudeMd === null, `${tag}: CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD stripped from the CLI's env`);
    ok(argOf(args, "--permission-prompts") === "none", `${tag}: --permission-prompts none`);
    const tools = (argOf(args, "--tools") || "").split(",");
    ok(tools.includes("Bash") && tools.includes("Agent") && tools.includes("Read"), `${tag}: --tools names Bash, Agent, Read (--restricted drops Bash otherwise)`);
    // Brief: "nothing a tutor turn can write is ever executed by the proxy, its routes or the
    // lesson's dev tooling outside the sandbox".
    const allowed = (argOf(args, "--allowedTools") || "").split(",");
    ok(!allowed.includes("Edit") && !allowed.includes("Write"), `${tag}: no blanket Edit/Write in --allowedTools (${allowed.filter((t) => !t.startsWith("mcp__")).join(",")})`);
    const sp = argOf(args, "--settings");
    ok(!!sp && !sp.startsWith(L + path.sep), `${tag}: settings file lives outside the lesson dir (${sp})`);
    let st = {};
    try { st = JSON.parse(fs.readFileSync(sp, "utf8")); } catch (_) {}
    ok(JSON.stringify(st.permissions?.allow) === JSON.stringify([`Edit(/${L}/src/*.jsx)`, `Edit(/${scratch}/**)`]), `${tag}: writes allowed only on src/*.jsx and the scratch dir (${JSON.stringify(st.permissions?.allow)})`);
    // Brief: "cannot read the box or host-repo manuals ... by auto-load or on request".
    const deny = st.permissions?.deny || [];
    ok(["CLAUDE.md", "CLAUDE.local.md", "AGENTS.md"].every((m) => deny.includes(`Read(/${WSR}/**/${m})`)), `${tag}: the workspace's manuals are denied to Read/Grep/Glob (${deny.length} rules)`);
    ok(st.permissions?.blockReadsOutsideWorkingDirectories === true, `${tag}: reads outside the working dirs blocked, sandboxed commands included`);
    const sb = st.sandbox || {};
    ok(sb.enabled === true && sb.failIfUnavailable === true && sb.allowUnsandboxedCommands === false, `${tag}: Bash sandboxed, refused where the sandbox cannot start, never unsandboxed`);
    ok(JSON.stringify(sb.filesystem?.allowWrite) === JSON.stringify([scratch]), `${tag}: the sandbox writes only the scratch dir (${JSON.stringify(sb.filesystem?.allowWrite)})`);
    const team = argOf(args, "--plugin-dir");
    ok(!!team && fs.existsSync(path.join(team, "agents", "zebra-agent.md")) && fs.existsSync(path.join(team, ".claude-plugin", "plugin.json")), `${tag}: the workspace's agent registry rides in as a plugin`);
  }
}

async function unconfined(why) {
  const init = await post("/session/init", { isolated: true });
  ok(init.status === 503 && why.test(init.text), `/session/init refused 503 naming ${why} (${init.status})`);
  const stateless = await post("/chat", { messages: [{ role: "user", content: "hi" }] });
  ok(stateless.status === 503, `stateless /chat refused 503 (${stateless.status})`);
  ok(spawns().length === 0, "no tutor CLI was spawned");
  const log = fs.readFileSync(path.join(L, "server", "chat.log"), "utf8");
  ok(new RegExp(`\\[TUTOR_UNCONFINED\\].*${why.source}`).test(log), "chat.log records TUTOR_UNCONFINED at startup");
  ok(/\[TUTOR_REFUSED\]/.test(log), "chat.log records each refusal");
}

// Brief: "/commit spawns node test_lesson.cjs ... shell: true there also lets a crafted src/*.jsx
// name inject". The only lesson source here is named to run a command if a shell ever sees it.
async function commit() {
  const src = path.join(L, "src");
  for (const f of fs.readdirSync(src)) if (f !== "main.jsx") fs.renameSync(path.join(src, f), path.join(WS, f));
  fs.writeFileSync(path.join(src, "a;touch INJECTED;b.jsx"), "export default 1;\n");
  const { sessionId } = JSON.parse((await post("/session/init", { isolated: true })).text);
  const r = await post("/commit", { sessionId, message: "m", paths: ["src"] });
  ok(r.status === 400 && /tests failed/.test(r.text), `/commit ran the lesson tests and stopped on their failure (${r.status})`);
  ok(!fs.existsSync(path.join(L, "INJECTED")), "a lesson file name reached no shell");
}

const WSR = fs.realpathSync(WS);
const modes = { confined, commit, unconfined: () => unconfined(/--restricted/), old: () => unconfined(/version >= 2\.1\.283 \(has 2\.0\.9\)/) };
modes[MODE]().then(() => {
  console.log(failures ? `${failures} FAILED` : "all passed");
  process.exit(failures ? 1 : 0);
}).catch((e) => { console.error(e); process.exit(1); });
