// Asserts on what the proxy actually hands the CLI, read back from the fake's
// record. Mode "confined": every spawn carries the confinement. Mode
// "unconfined": a CLI lacking --restricted (named only inside another option's
// prose) is never run for a tutor turn. Mode "old": nor is one below the
// version floor. Mode "stall": a CLI whose first probes stall past the probe
// timeout is unknown, not unconfined: the tutor answers 503 "still starting",
// then serves confined once a re-probe answers. Mode "commit": /commit runs
// the lesson tests without a shell.
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
// The fake appends its line before it does anything else, so no record file means
// no CLI ran far enough to do anything: zero spawns. That happens in "stall" mode
// under load, where every startup probe is killed at the short probe timeout
// before node has booted the fake. A case that expects spawns still FAILs on the count.
const spawns = () => {
  let text;
  try { text = fs.readFileSync(path.join(WS, "record.jsonl"), "utf8"); } catch (e) { if (e.code === "ENOENT") return []; throw e; }
  return text.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
    .filter((s) => !s.args.includes("--help") && !s.args.includes("--version"));
};
const argOf = (args, flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };

async function confined() {
  const iso = JSON.parse((await post("/session/init", { isolated: true })).text);
  const shared = JSON.parse((await post("/session/init", { isolated: false })).text);
  ok(!!iso.sessionId && !!shared.sessionId, "isolated and shared sessions open");
  ok((await post("/chat", { sessionId: iso.sessionId, message: "hi" })).text.includes("event: done"), "a streamed turn runs");
  ok((await post("/chat", { messages: [{ role: "user", content: "hi" }], system: "You tutor." })).status === 200, "a stateless turn runs");
  const all = spawns();
  ok(all.length === 4, `four CLI spawns recorded (${all.length})`);
  const scratch = path.join(L, "server", ".isolated");
  for (const [i, { args, cwd, addDirsClaudeMd, mplConfigDir }] of all.entries()) {
    const tag = `spawn ${i + 1}`;
    // The sandbox lets Bash write its cwd: a cwd of the lesson root would give it package.json and server/.
    ok(cwd === scratch, `${tag}: runs in the scratch dir, in either memory mode (${cwd})`);
    const dirs = args.flatMap((a, j) => (a === "--add-dir" ? [args[j + 1]] : []));
    ok(dirs.includes(L) && dirs.includes(WSR), `${tag}: the lesson and the workspace are readable (${dirs.join(" ")})`);
    // Brief: "runs with none of the host repo's or the box's CLAUDE.md in its context".
    ok(args.includes("--restricted"), `${tag}: --restricted (no user/project settings, so no CLAUDE.md walk, hooks or user MCP)`);
    ok(addDirsClaudeMd === null, `${tag}: CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD stripped from the CLI's env`);
    // Brief: "no new write path outside scratch": matplotlib's cache goes in the scratch, not ~/.config.
    ok(mplConfigDir === path.join(scratch, ".matplotlib"), `${tag}: MPLCONFIGDIR is inside the scratch dir (${mplConfigDir})`);
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
    // Brief: "no network": drawing opened no domain, socket or port to sandboxed commands.
    const net = sb.network || {};
    ok(!(net.allowedDomains || []).length && !net.allowUnixSockets?.length && !net.allowAllUnixSockets && !net.allowLocalBinding, `${tag}: the sandbox opens no network to Bash (${JSON.stringify(net)})`);
    const team = argOf(args, "--plugin-dir");
    ok(!!team && fs.existsSync(path.join(team, "agents", "zebra-agent.md")) && fs.existsSync(path.join(team, ".claude-plugin", "plugin.json")), `${tag}: the workspace's agent registry rides in as a plugin`);
  }
  const prompt = argOf(all.find((s) => argOf(s.args, "--system-prompt"))?.args || [], "--system-prompt") || "";
  ok(prompt.startsWith("You tutor.") && /out\/ in your working directory/.test(prompt) && prompt.includes("![](chat/file/<name>)"), "a turn with a system prompt is told where figures go and how to show one");
  await figures(scratch);
}

// Brief: "the image served only from that session's scratch, and no path traversal". GET
// chat/file/<name> serves out/<name> in the scratch dir and nothing else. Each case plants its own
// file, so a refusal is the route's, not a missing file.
const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000" + "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082", "hex");
async function figures(scratch) {
  const out = path.join(scratch, "out");
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const get = async (name) => { const r = await proxyFetch(`/chat/file/${name}`); return { status: r.status, type: r.headers.get("content-type"), body: Buffer.from(await r.arrayBuffer()) }; };
  fs.writeFileSync(path.join(out, "sine.png"), PNG);
  const kept = await get("sine.png");
  ok(kept.status === 200 && kept.type === "image/png" && kept.body.equals(PNG), `a PNG in out/ is served as image/png, byte for byte (${kept.status} ${kept.type})`);
  // A closed tab mid-download must not leak the proxy an fd per figure.
  const pid = JSON.parse(fs.readFileSync(path.join(L, "server", ".proxy.json"), "utf8")).pid;
  const fds = () => fs.readdirSync(`/proc/${pid}/fd`).length;
  fs.writeFileSync(path.join(out, "big.png"), Buffer.concat([PNG, Buffer.alloc(8 << 20)]));
  const before = fds();
  for (let i = 0; i < 20; i++) {
    await new Promise((resolve) => {
      const rq = require("http").get(`${BASE}/chat/file/big.png`, (r) => r.once("data", () => { rq.destroy(); resolve(); }));
      rq.on("error", resolve);
    });
  }
  await new Promise((r) => setTimeout(r, 1000));
  ok(fds() < before + 5, `20 figure downloads aborted mid-body leave no fds open in the proxy (${before} -> ${fds()})`);
  // The same bytes one directory up, in the scratch but not in out/: never nameable.
  fs.writeFileSync(path.join(scratch, "up.png"), PNG);
  for (const name of ["..%2Fup.png", "%2E%2E%2Fup.png", "..%5Cup.png", ".up.png", "%2Fetc%2Fhostname.png"]) {
    ok((await get(name)).status === 404, `${decodeURIComponent(name)} is refused (traversal)`);
  }
  ok((await get("../up.png")).status === 404, "../up.png (normalised by the URL) is refused");
  // A secret outside the scratch, reached by a link the tutor could plant in out/.
  const secret = path.join(WS, "secret.png");
  fs.writeFileSync(secret, PNG);
  fs.symlinkSync(secret, path.join(out, "link.png"));
  ok((await get("link.png")).status === 404, "a symlink in out/ to a file outside the scratch is refused, not followed");
  fs.linkSync(path.join(out, "sine.png"), path.join(out, "hard.png"));
  ok((await get("hard.png")).status === 200, "a hard link inside out/ to a file in out/ is served (same device, a regular file)");
  fs.writeFileSync(path.join(out, "page.svg"), "<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>");
  ok((await get("page.svg")).status === 404, "an SVG in out/ is not served (it would run as script)");
  fs.writeFileSync(path.join(out, "png"), PNG);
  ok((await get("png")).status === 404, "a name with no extension is not served");
  fs.mkdirSync(path.join(out, "dir.png"));
  ok((await get("dir.png")).status === 404, "a directory named like an image is refused");
  require("child_process").execFileSync("mkfifo", [path.join(out, "pipe.png")]);
  const t0 = Date.now();
  ok((await get("pipe.png")).status === 404 && Date.now() - t0 < 5000, "a fifo in out/ is refused at once, not waited on");
  // out/ itself swapped for a link to a directory outside the scratch that holds a PNG.
  const elsewhere = path.join(WS, "elsewhere"); fs.mkdirSync(elsewhere, { recursive: true });
  fs.writeFileSync(path.join(elsewhere, "sine.png"), PNG);
  fs.rmSync(out, { recursive: true, force: true });
  fs.symlinkSync(elsewhere, out);
  ok((await get("sine.png")).status === 404, "out/ replaced by a link to a directory outside the scratch: refused");
  fs.unlinkSync(out);
  ok((await get("sine.png")).status === 404, "no out/ at all: 404, and the proxy keeps serving");
  ok((await post("/chat", { messages: [{ role: "user", content: "hi" }] })).status === 200, "the proxy still answers a turn after every refusal");
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

// Brief: "a probe that timed out is not the same as a CLI that lacks the option ... keep failing
// closed with a 503 that says the tutor is still starting, so it never runs unconfined".
async function stall() {
  const early = await post("/session/init", { isolated: true });
  ok(early.status === 503 && /still starting/.test(early.text), `/session/init right after startup answers 503 "still starting" (${early.status} ${early.text.slice(0, 80)})`);
  let starting = 0, served = 0, other = [];
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const r = await post("/chat", { messages: [{ role: "user", content: "hi" }] });
    // Every stateless turn the proxy let through is one CLI spawn; none may run before a probe answered.
    if (r.status === 200) served++;
    else if (r.status === 503 && /still starting/.test(r.text)) starting++;
    else other.push(`${r.status} ${r.text.slice(0, 80)}`);
    if (served || other.length) break;
    ok(spawns().length === 0, `no tutor CLI spawned while still starting (turn ${starting})`);
    await new Promise((res) => setTimeout(res, 250));
  }
  ok(starting > 0, `stateless /chat answered 503 "still starting" while the probes stalled (${starting} times)`);
  ok(other.length === 0, `/chat answers only 503 "still starting" or 200 (other ${JSON.stringify(other)})`);
  // How soon a re-probe answers is the clock's business: on a loaded box one can time out again.
  ok(served === 1, `[timing] once a re-probe answered, /chat serves within 60s (served ${served})`);
  const all = spawns();
  ok(all.length === served, `exactly the served turns spawned the CLI (${all.length})`);
  ok(all.every(({ args }) => args.includes("--restricted") && argOf(args, "--permission-prompts") === "none" && !!argOf(args, "--settings")), "every spawned turn ran confined");
  const log = fs.readFileSync(path.join(L, "server", "chat.log"), "utf8");
  ok(/\[TUTOR_PROBE_TIMEOUT\]/.test(log), "chat.log records the probe timeout");
  if (served) ok(/\[TUTOR_CONFINED\]/.test(log), "chat.log records the late confinement");
  ok(!/\[TUTOR_UNCONFINED\]/.test(log), "a timed-out probe is never logged as a missing option");
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
const modes = { confined, commit, stall, unconfined: () => unconfined(/--restricted/), old: () => unconfined(/version >= 2\.1\.283 \(has 2\.0\.9\)/) };
modes[MODE]().then(() => {
  console.log(failures ? `${failures} FAILED` : "all passed");
  process.exit(failures ? 1 : 0);
}).catch((e) => { console.error(e); process.exit(1); });
