// Proxy-level cancellation evidence. Drives a running proxy (PROXY_URL) whose
// `claude` is tests/cancellation/fake-claude (or the real CLI with --real).
// Exit 0 only when every assertion holds. See README.md for the scenarios.
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const BASE = process.env.PROXY_URL || "http://127.0.0.1:3901";
const REAL = process.argv.includes("--real");
const LOG = process.env.LESSON_DIR ? path.join(process.env.LESSON_DIR, "server", "chat.log") : null;
let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"} ${msg}`); if (!cond) failures++; };
const post = async (route, body) => { const r = await fetch(BASE + route, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const sessionsList = async () => (await (await fetch(BASE + "/sessions")).json()).sessions;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Live (non-zombie) pids of the tree under rootPid: descendants plus process-group members.
function tree(rootPid) {
  const rows = execFileSync("ps", ["-eo", "pid=,ppid=,pgid=,stat="], { encoding: "utf8" }).split("\n")
    .map((l) => l.trim().split(/\s+/)).filter((m) => m.length >= 4 && !m[3].startsWith("Z"))
    .map((m) => ({ pid: +m[0], ppid: +m[1], pgid: +m[2] }));
  const found = new Set(); const stack = [rootPid];
  while (stack.length) { const p = stack.pop(); if (found.has(p)) continue; if (rows.some((r) => r.pid === p)) found.add(p); for (const r of rows) if (r.ppid === p) stack.push(r.pid); }
  for (const r of rows) if (r.pgid === rootPid) found.add(r.pid);
  return [...found];
}

// Open a /chat stream, resolve once `until(event, data)` says the turn is under way, keep reading to the end.
function startTurn(sessionId, message, until) {
  return new Promise(async (resolve, reject) => {
    const events = [];
    let started = false;
    const res = await fetch(BASE + "/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, message }) });
    if (!res.ok) return reject(new Error(`/chat ${res.status}`));
    let endTurn; const turn = { events, ended: new Promise((r) => (endTurn = r)) };
    const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = ""; let ev = null;
    (async () => {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true }); const lines = buf.split("\n"); buf = lines.pop();
        for (const line of lines) {
          if (line.startsWith("event: ")) ev = line.slice(7).trim();
          else if (line.startsWith("data: ") && ev) { let data = {}; try { data = JSON.parse(line.slice(6)); } catch (_) {} events.push({ event: ev, data }); if (!started && until(ev, data)) { started = true; resolve(turn); } ev = null; }
          else if (line === "") ev = null;
        }
      }
      endTurn(events);
      if (!started) resolve(turn);
    })();
  });
}

async function activeTurn(sessionId) { return (await sessionsList()).find((s) => s.id === sessionId)?.turn || null; }

async function cancelAndVerify(label, sessionId, turnStream, expectRepeatOk = true) {
  const before = await activeTurn(sessionId);
  ok(before && before.pid > 0, `${label}: /sessions shows the turn in flight (pid ${before && before.pid})`);
  const pids = tree(before.pid);
  ok(pids.length >= 3, `${label}: tree has claude + children before cancel (${pids.length} pids: ${pids.join(",")})`);
  const t0 = Date.now();
  const r = await post("/chat/cancel", { sessionId });
  const ms = Date.now() - t0;
  ok(r.status === 200 && r.body.cancelled === true && !r.body.repeat, `${label}: cancel -> 200 cancelled (${JSON.stringify(r.body)})`);
  ok(ms <= 3000, `${label}: cancel answered in ${ms}ms (<= 3000)`);
  const left = pids.filter((p) => tree(p).includes(p));
  ok(left.length === 0, `${label}: whole tree gone after cancel (survivors: ${left.join(",") || "none"})`);
  const events = await Promise.race([turnStream.ended, sleep(3000).then(() => null)]);
  ok(events && events.some((e) => e.event === "cancelled") && !events.some((e) => e.event === "error" || e.event === "done"), `${label}: stream ended with event:cancelled, no done/error`);
  if (expectRepeatOk) {
    const again = await post("/chat/cancel", { sessionId });
    ok(again.status === 200 && again.body.cancelled === true && again.body.repeat === true, `${label}: repeat cancel is idempotent -> 200 repeat (${JSON.stringify(again.body)})`);
  }
  ok((await activeTurn(sessionId)) === null, `${label}: turn slot released`);
}

(async () => {
  const model = REAL ? "haiku" : "sonnet";
  const system = "You are a test fixture. Follow the user's instruction literally and say nothing else.";
  const init = await post("/session/init", { model, effort: "low", isolated: true, system });
  ok(init.status === 200 && init.body.sessionId, `init -> session ${String(init.body.sessionId).slice(0, 8)}`);
  const sid = init.body.sessionId;
  const longMsg = REAL ? "Use the Bash tool to run exactly this command and nothing else: sleep 120" : "LONG";
  const isRunning = REAL ? (ev, d) => ev === "status" && d.type === "tool" : (ev) => ev === "status";

  // 1. Long turn, cancelled: tree gone <= 3s, event:cancelled, idempotent repeat.
  const t1 = await startTurn(sid, longMsg, isRunning);
  await cancelAndVerify("turn1", sid, t1);

  // Cancelled turn never promotes: released session is not a resume candidate.
  await post("/session/close", { sessionId: sid, keepContext: true });
  let rec = (await sessionsList()).find((s) => s.id === sid);
  ok(rec && rec.open === false && rec.lastTurn?.outcome === "cancelled" && rec.resumable === false, `cancelled turn -> resumable:false (lastTurn=${JSON.stringify(rec?.lastTurn)})`);
  ok((await post("/session/open", { sessionId: sid })).status === 200, "session re-opened for the next turn");

  // 2. Next turn on the same session completes cleanly (no reload, no orphan cancel state).
  const quick = await startTurn(sid, REAL ? "Reply with the single word: ready" : "QUICK", () => false);
  const ev2 = await quick.ended;
  ok(ev2.some((e) => e.event === "done") && !ev2.some((e) => e.event === "cancelled" || e.event === "error"), "turn2 after cancel completes with event:done");
  // Completed turn: cancel now has nothing to hit -> 409, and the session is promoted.
  const r409 = await post("/chat/cancel", { sessionId: sid });
  ok(r409.status === 409, `cancel with no turn in flight -> 409 (${r409.status})`);
  await post("/session/close", { sessionId: sid, keepContext: true });
  rec = (await sessionsList()).find((s) => s.id === sid);
  ok(rec && rec.lastTurn?.outcome === "completed" && rec.resumable === true, `completed turn -> resumable:true (lastTurn=${JSON.stringify(rec?.lastTurn)})`);
  await post("/session/open", { sessionId: sid });

  // Wrong / stale ids are refused, never acted on.
  ok((await post("/chat/cancel", { sessionId: "00000000-0000-4000-8000-000000000000" })).status === 404, "cancel unknown id -> 404");
  ok((await post("/chat/cancel", { sessionId: "../etc; rm -rf" })).status === 404, "cancel malformed id -> 404");
  ok((await post("/chat/cancel", {})).status === 404, "cancel without id -> 404");

  // Fresh session, no turn: candidacy unchanged (still a candidate).
  const init2 = await post("/session/init", { model, effort: "low", isolated: true, system });
  await post("/session/close", { sessionId: init2.body.sessionId, keepContext: true });
  const rec2 = (await sessionsList()).find((s) => s.id === init2.body.sessionId);
  ok(rec2 && rec2.resumable === true, "zero-turn session stays a resume candidate");

  if (!REAL) {
    // 3. SIGTERM ignored by the whole tree: the SIGKILL pass must end it, still <= 3s.
    const t3 = await startTurn(sid, "LONG IGNORE_TERM", isRunning);
    await cancelAndVerify("turn3 (ignores SIGTERM)", sid, t3);

    // 4. KILL session mid-turn (/session/close without keepContext) takes the tree down too.
    const t4 = await startTurn(sid, "LONG", isRunning);
    const before = await activeTurn(sid);
    const pids4 = tree(before.pid);
    ok(pids4.length >= 3, `turn4: tree present before session delete (${pids4.length} pids)`);
    await post("/session/close", { sessionId: sid, keepContext: false });
    await sleep(2200);
    const left4 = pids4.filter((p) => tree(p).includes(p));
    ok(left4.length === 0, `turn4: session delete killed the tree (survivors: ${left4.join(",") || "none"})`);
    ok((await post("/chat/cancel", { sessionId: sid })).status === 404, "cancel on the deleted session -> 404");
    await t4.ended;
  } else {
    await post("/session/close", { sessionId: sid, keepContext: false });
  }

  if (LOG && fs.existsSync(LOG)) {
    const log = fs.readFileSync(LOG, "utf8");
    ok(/\[CHAT_CANCELLED\] chatNum=1 msg=1 /.test(log), "chat.log records CHAT_CANCELLED for turn 1");
    ok(!/\[CHAT_ERROR\]/.test(log), "chat.log has no CHAT_ERROR for cancelled turns");
    ok(/\[CHAT_OK\] chatNum=1 msg=2 /.test(log), "chat.log records CHAT_OK for turn 2");
  }
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error("check crashed:", e); process.exit(2); });
