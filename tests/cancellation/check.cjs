// Proxy-level cancellation evidence. Drives a running proxy (PROXY_URL) whose
// `claude` is tests/cancellation/fake-claude (or the real CLI with --real).
// Exit 0 only when every assertion holds. See README.md for the scenarios.
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const BASE = process.env.PROXY_URL || "http://127.0.0.1:3901";
const REAL = process.argv.includes("--real");
const LOG = process.env.LESSON_DIR ? path.join(process.env.LESSON_DIR, "server", "chat.log") : null;
// The client's own candidacy and Stop rules, imported from the core copy in
// the workspace — the same module Chatbot.jsx imports, driven here against the
// proxy's real /sessions payloads instead of being restated.
const CORE_DIR = process.env.CORE_DIR;
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
  // The tree forms after the status event: the real CLI forks the tool's
  // shell only once the model has emitted the tool_use block. Wait for it.
  let pids = tree(before.pid);
  for (const t = Date.now(); pids.length < 3 && Date.now() - t < 10000;) { await sleep(250); pids = tree(before.pid); }
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
  const { isRestorable, isPickable, isSoleInFlight } = await import(require("url").pathToFileURL(path.join(CORE_DIR, "chat", "turnState.js")).href);
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
  // Client rules on that same record: a cancelled turn is neither offered nor
  // reclaimed after a reload.
  ok(isPickable(rec) === false, "client: cancelled session is not offered in the picker");
  ok(isRestorable(rec) === false, "client: cancelled session is not reclaimed on reload");
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
  ok(isPickable(rec) === true && isRestorable(rec) === true, "client: completed session is both offered and reclaimable");
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

  // A proxy that predates `resumable`/`lastTurn` (a lessons-side core that
  // lags) is read the old way, not treated as un-resumable.
  ok(isPickable({ open: false }) === true && isRestorable({ open: false }) === true, "client: session from a pre-`resumable` proxy stays resumable");
  ok(isPickable({ open: true }) === false && isRestorable({ open: true }) === false, "client: open session from a pre-`resumable` proxy is not");

  // A thread's Stop may only cancel the session's turn when this thread's is
  // the one running -- otherwise it would kill a main turn nobody stopped.
  // (Called after the thread deleted its own controller, so its key is gone.)
  ok(isSoleInFlight(7, {}, {}) === true, "client: thread Stop cancels when its thread was the only request in flight");
  ok(isSoleInFlight(7, { 7: {} }, {}) === false, "client: thread Stop does not cancel while this tab's main turn is in flight");
  ok(isSoleInFlight(7, {}, { "7:t2": {} }) === false, "client: thread Stop does not cancel while another thread of this tab is in flight");
  ok(isSoleInFlight(7, { 8: {} }, { "8:t1": {} }) === true, "client: another tab's in-flight requests do not block this thread's cancel");

  if (!REAL) {
    // 3. SIGTERM ignored by the whole tree: the SIGKILL pass must end it, still <= 3s.
    const t3 = await startTurn(sid, "LONG IGNORE_TERM", isRunning);
    await cancelAndVerify("turn3 (ignores SIGTERM)", sid, t3);

    // 5. CLI exits 0 on SIGTERM (graceful shutdown, no result): the accepted
    // cancel wins over the exit code — stream ends `cancelled`, never promoted.
    const t5 = await startTurn(sid, "LONG EXIT0_ON_TERM", isRunning);
    await cancelAndVerify("turn5 (exits 0 on SIGTERM)", sid, t5);
    await post("/session/close", { sessionId: sid, keepContext: true });
    const rec5 = (await sessionsList()).find((s) => s.id === sid);
    ok(rec5 && rec5.lastTurn?.outcome === "cancelled" && rec5.resumable === false, `turn5: clean exit after cancel still -> resumable:false (lastTurn=${JSON.stringify(rec5?.lastTurn)})`);
    await post("/session/open", { sessionId: sid });

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

    // 6. Reload mid-turn, on its own session: beforeunload beacons
    // /session/close {keepContext:true} while the CLI runs on (a disconnect is
    // not a cancel). The turn must survive, must not be offered to anyone
    // else, and must still be the tab's to reclaim.
    const init3 = await post("/session/init", { model, effort: "low", isolated: true, system });
    const sid3 = init3.body.sessionId;
    const t6 = await startTurn(sid3, longMsg, isRunning);
    const running = await activeTurn(sid3);
    await post("/session/close", { sessionId: sid3, keepContext: true });
    const rec6 = (await sessionsList()).find((s) => s.id === sid3);
    ok(tree(running.pid).length >= 3, `turn6: reload does not kill the turn (${tree(running.pid).length} pids)`);
    ok(rec6 && rec6.open === false && rec6.turn && rec6.resumable === false, `turn6: in-flight session is not resumable (turn=${JSON.stringify(rec6?.turn && rec6.turn.msg)})`);
    ok(isPickable(rec6) === false, "client: a session with a turn in flight is not offered in the picker");
    ok(isRestorable(rec6) === true, "client: the reloading tab reclaims its own session mid-turn");
    await post("/session/open", { sessionId: sid3 });
    await cancelAndVerify("turn6 (after reload)", sid3, t6);
    await post("/session/close", { sessionId: sid3, keepContext: false });
  } else {
    await post("/session/close", { sessionId: sid, keepContext: false });
  }

  if (LOG && fs.existsSync(LOG)) {
    const log = fs.readFileSync(LOG, "utf8");
    ok(/\[CHAT_CANCELLED\] chatNum=1 msg=1 /.test(log), "chat.log records CHAT_CANCELLED for turn 1");
    if (!REAL) ok(/\[CHAT_CANCELLED\] chatNum=1 msg=4 /.test(log), "chat.log records CHAT_CANCELLED for the clean-exit turn 5 (msg 4)");
    ok(!/\[CHAT_ERROR\]/.test(log), "chat.log has no CHAT_ERROR for cancelled turns");
    ok(/\[CHAT_OK\] chatNum=1 msg=2 /.test(log), "chat.log records CHAT_OK for turn 2");
  }
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error("check crashed:", e); process.exit(2); });
