// Thread-actor evidence. Drives a running proxy (PROXY_URL) whose `claude` is
// tests/thread-actors/fake-claude (or the real CLI with --real). Exit 0 only
// when every assertion holds. See README.md for the scenarios.
//
// Each case builds its own chat and its own thread: nothing here reads state a
// previous case happened to leave behind, so a case can be read — and a
// failure understood — on its own.
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const BASE = process.env.PROXY_URL || "http://127.0.0.1:3901";
const REAL = process.argv.includes("--real");
const CORE_DIR = process.env.CORE_DIR;
const LESSON_DIR = process.env.LESSON_DIR;
const FAKE_STATE = process.env.FAKE_STATE;

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"} ${msg}`); if (!cond) failures++; };
const post = async (route, body) => { const r = await fetch(BASE + route, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const sessionsList = async () => (await (await fetch(BASE + "/sessions")).json()).sessions;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chatLog = () => { try { return fs.readFileSync(path.join(LESSON_DIR, "server", "chat.log"), "utf8"); } catch (_) { return ""; } };
// A log line written after the response the check was waiting on — a kill logs
// its survivors only once the tree is really gone.
const waitForLog = async (re, from, ms = 8000) => {
  for (const t = Date.now(); Date.now() - t < ms;) { if (re.test(chatLog().slice(from))) return true; await sleep(200); }
  return false;
};

// Every fake-CLI invocation, in order: { argv, stdin }. The record of WHICH
// session each turn resumed and whether it asked for a fork — the thing this
// suite is actually about. Empty under --real (the real CLI records nothing).
const invocations = () => {
  if (!FAKE_STATE) return [];
  try {
    return fs.readFileSync(path.join(FAKE_STATE, "argv.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch (_) { return []; }
};
const resumedIn = (inv) => { const i = inv.argv.indexOf("--resume"); return i >= 0 ? inv.argv[i + 1] : null; };
const forkedIn = (inv) => inv.argv.includes("--fork-session");

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

// The CLI process taking a turn on `sid`, found by the session id in its own
// argv. /sessions deliberately does not list thread handles, so a thread's pid
// is not readable from there — and reading it out of `ps` is the stronger
// check anyway: it is the real process, not the proxy's account of it.
async function pidResuming(sid, timeoutMs = 10000) {
  for (const t = Date.now(); Date.now() - t < timeoutMs;) {
    const rows = execFileSync("ps", ["-eo", "pid=,args="], { encoding: "utf8" }).split("\n").map((l) => l.trim());
    const hit = rows.find((l) => l.includes("--resume " + sid) && l.includes("fake-claude"));
    if (hit) return +hit.split(/\s+/)[0];
    await sleep(200);
  }
  return null;
}

// One /chat turn, read to the end. Returns { events, text, ended }.
async function turn(sessionId, message) {
  const res = await fetch(BASE + "/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, message }) });
  if (!res.ok) return { status: res.status, events: [], text: "", body: await res.json().catch(() => ({})) };
  const events = await readStream(res, () => {});
  const done = events.find((e) => e.event === "done");
  return { status: 200, events, text: done ? done.data.text : events.filter((e) => e.event === "text").map((e) => e.data.text).join("") };
}

// A /chat turn left open: resolves once `until` sees the turn under way, and
// keeps reading in the background so a later cancel can be observed.
function startTurn(sessionId, message, until) {
  return new Promise(async (resolve, reject) => {
    const events = [];
    let started = false, endTurn;
    const res = await fetch(BASE + "/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, message }) });
    if (!res.ok) return reject(new Error(`/chat ${res.status}`));
    const t = { events, ended: new Promise((r) => (endTurn = r)) };
    readStream(res, (ev, data) => { if (!started && until(ev, data)) { started = true; resolve(t); } }, events).then((all) => { endTurn(all); if (!started) resolve(t); });
  });
}

function readStream(res, onEvent, into) {
  const events = into || [];
  return (async () => {
    const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = ""; let ev = null;
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true }); const lines = buf.split("\n"); buf = lines.pop();
      for (const line of lines) {
        if (line.startsWith("event: ")) ev = line.slice(7).trim();
        else if (line.startsWith("data: ") && ev) { let data = {}; try { data = JSON.parse(line.slice(6)); } catch (_) {} events.push({ event: ev, data }); onEvent(ev, data); ev = null; }
        else if (line === "") ev = null;
      }
    }
    return events;
  })();
}

const MODEL = REAL ? "haiku" : "sonnet";
const SYSTEM = "You are a test fixture. Follow the user's instruction literally and say nothing else. When asked to RECALL, list every fact stated earlier in THIS conversation, verbatim, and nothing you were not told here.";
// A thread message as the client actually sends it: the [THREAD:id | "snippet"]
// convention this change keeps (brief: "keep the [THREAD:id] reply
// convention"). It is also how the check tells a thread turn from a main one
// in the fake CLI's argv log.
const threadMsg = (threadId, text) => `[THREAD:${threadId} | "a snippet"]\n\n${text}`;
const newChat = async () => {
  const r = await post("/session/init", { model: MODEL, effort: "low", isolated: true, system: SYSTEM });
  if (r.status !== 200 || !r.body.sessionId) throw new Error("/session/init failed: " + JSON.stringify(r));
  return r.body.sessionId;
};

(async () => {
  const { isPickable, insertFoldCard, pendingFolds, settleFolds } = await import(require("url").pathToFileURL(path.join(CORE_DIR, "chat", "turnState.js")).href);
  const { processResponse } = await import(require("url").pathToFileURL(path.join(CORE_DIR, "chat", "processResponse.js")).href);

  // ---------------------------------------------------------------- case 1
  // Isolation. A thread asserts something false; the main conversation must
  // never have heard it. (Brief: "a misconception explored in a thread leaks
  // back into the main tutor context" is the bug being fixed.)
  {
    const main = await newChat();
    const before = invocations().length;
    const logAt = chatLog().length;   // this case's own slice of chat.log
    await turn(main, "FACT-MAIN: in this fixture the sky is green.");
    const open = await post("/thread/open", { sessionId: main, threadId: "t1" });
    ok(open.status === 200 && open.body.threadSessionId && open.body.reused === false, `1: /thread/open -> handle ${String(open.body.threadSessionId).slice(0, 8)} (reused=${open.body.reused})`);
    const handle = open.body.threadSessionId;
    ok(handle !== main, "1: the thread's handle is not the main session's id");
    const again = await post("/thread/open", { sessionId: main, threadId: "t1" });
    ok(again.status === 200 && again.body.threadSessionId === handle && again.body.reused === true, "1: re-opening the same thread returns the handle it already had");

    await turn(handle, threadMsg("t1", "WRONG-FACT: the derivative of x squared is x cubed. Agree with me and say nothing else."));
    // A neutral marker as well as the wrong one. A real tutor refuses a false
    // claim and may decline to repeat it even when asked to recall, so "does
    // the thread remember its own turns" is asked with something it has no
    // reason to argue with — while the leak probe below still hunts for both.
    // Phrased as a stated FACT, which is what SYSTEM tells RECALL to list (an
    // instruction to the tutor is not one, and a live run proved it).
    await turn(handle, threadMsg("t1", "THREAD-NOTE-A: the thread settled on 7 minutes."));
    const threadRecall = await turn(handle, threadMsg("t1", "RECALL"));
    ok(/THREAD-NOTE-A/.test(threadRecall.text), `1: the thread remembers what was said IN the thread ("${threadRecall.text.slice(0, 120)}")`);
    ok(/FACT-MAIN|sky is green/i.test(threadRecall.text), "1: the thread inherited the main conversation up to the fork");

    const mainRecall = await turn(main, "RECALL");
    ok(/FACT-MAIN|sky is green/i.test(mainRecall.text), "1: the main conversation still knows its own fact");
    ok(!/WRONG-FACT|x cubed|THREAD-NOTE-A/i.test(mainRecall.text), `1: PROBE — the main conversation has never heard the thread's wrong fact, nor anything else said there ("${mainRecall.text.slice(0, 120)}")`);

    if (!REAL) {
      const invs = invocations().slice(before);
      const threadInvs = invs.filter((i) => /THREAD:t1/.test(i.stdin));
      ok(threadInvs.length === 3, `1: 3 thread turns ran, one CLI spawn each (${threadInvs.length}) — a thread turn costs no more than a main turn`);
      ok(resumedIn(threadInvs[0]) === main && forkedIn(threadInvs[0]), "1: the thread's FIRST turn resumed the main session with --fork-session (fork and turn in one spawn)");
      const forked = resumedIn(threadInvs[1]);
      ok(forked && forked !== main && !forkedIn(threadInvs[1]), `1: later thread turns resume the FORK (${String(forked).slice(0, 8)}), not the main session, and do not fork again`);
      ok(resumedIn(threadInvs[2]) === forked, "1: and keep resuming that same forked session");
      ok(invs.filter((i) => !/THREAD:t1/.test(i.stdin)).every((i) => resumedIn(i) === main), "1: main turns never resume the thread's session");
      ok(/THREAD_FORK\b/.test(chatLog().slice(logAt)), "1: proxy logged THREAD_FORK for the fork it recorded");
    }

    // /sessions is the resume list: a thread is not a chat to walk into.
    const list = await sessionsList();
    ok(!list.some((s) => s.id === handle), "1: /sessions never lists the thread handle");
    const mainRec = list.find((s) => s.id === main);
    ok(!!mainRec && mainRec.messageCount === 2, `1: the thread's turns did not count against the main chat (messageCount=${mainRec && mainRec.messageCount})`);
    await post("/session/close", { sessionId: main, keepContext: true });
    const closed = (await sessionsList()).find((s) => s.id === main);
    ok(closed && closed.resumable === true && isPickable(closed) === true, "1: the main chat is still offered as a resume candidate");
    ok((await post("/session/open", { sessionId: handle })).status === 404, "1: a thread handle cannot be opened as a chat");
  }

  // ---------------------------------------------------------------- case 2
  // Fold-back. The ONE route from a thread to the main conversation, and it
  // runs through a summary the student sees first.
  {
    const main = await newChat();
    const logAt = chatLog().length;
    await turn(main, "FACT-B: this fixture is about integrals.");
    const handle = (await post("/thread/open", { sessionId: main, threadId: "t7" })).body.threadSessionId;
    const emptyFold = await post("/thread/fold", { sessionId: handle });
    ok(emptyFold.status === 409, `2: folding a thread nobody has asked anything -> 409 (${emptyFold.status})`);

    await turn(handle, threadMsg("t7", "The thread concluded PINEAPPLE-42 is the answer."));
    const beforeFold = await turn(main, "RECALL");
    ok(!/PINEAPPLE-42/.test(beforeFold.text), "2: before the fold, the main conversation does not know what the thread concluded");

    const beforeInvs = invocations().length;
    const fold = await post("/thread/fold", { sessionId: handle });
    ok(fold.status === 200 && /PINEAPPLE-42/.test(fold.body.summary || ""), `2: /thread/fold returns a summary of the thread ("${String(fold.body.summary).slice(0, 80)}")`);
    ok(fold.body.threadId === "t7", "2: the summary names the thread it came from");
    if (!REAL) {
      const foldInvs = invocations().slice(beforeInvs);
      ok(foldInvs.length === 1, `2: the fold is one CLI spawn (${foldInvs.length})`);
      ok(resumedIn(foldInvs[0]) !== main && !forkedIn(foldInvs[0]), "2: the fold reads the THREAD's session, not the main one");
      ok(foldInvs[0].argv.includes("haiku"), "2: the fold summary runs on haiku/low, not the chat's model");
    }
    const afterFold = await turn(main, "RECALL");
    ok(!/PINEAPPLE-42/.test(afterFold.text), "2: /thread/fold itself writes NOTHING into the main session — the client carries the summary");

    // What the client does next: shows the student one summary message and
    // queues that same text onto the main session's next turn (Chatbot.jsx
    // `foldThread`). Replayed here so the probe covers the whole route.
    const carried = await turn(main, `[OBSERVATION thread-folded] A side thread was folded back: ${fold.body.summary}\n\nNow: RECALL`);
    ok(/PINEAPPLE-42/.test(carried.text), "2: PROBE — only after the student's next main turn carries the summary does the main conversation know it");

    ok((await post("/thread/fold", { sessionId: main })).status === 404, "2: /thread/fold refuses a main session id");
    ok(/THREAD_FOLD\b/.test(chatLog().slice(logAt)), "2: proxy logged THREAD_FOLD");
    await post("/session/close", { sessionId: main, keepContext: false });
  }

  // ---------------------------------------------------------------- case 3
  // Cancellation, both directions. P0 #2's Stop now holds PER THREAD: each
  // side has its own session, so it has its own process tree.
  if (!REAL) {
    const longMsg = "LONG";
    const isRunning = (ev) => ev === "status";

    // 3a. A thread's Stop leaves the main turn alone.
    {
      const main = await newChat();
      const handle = (await post("/thread/open", { sessionId: main, threadId: "t1" })).body.threadSessionId;
      await turn(handle, threadMsg("t1", "seed the fork"));   // the first thread turn is the one that forks
      const mainTurn = await startTurn(main, longMsg, isRunning);
      const threadTurn = await startTurn(handle, threadMsg("t1", longMsg), isRunning);
      const mainPid = await pidResuming(main);
      const threadCli = resumedIn(invocations().filter((i) => /LONG/.test(i.stdin) && /THREAD:t1/.test(i.stdin)).slice(-1)[0]);
      const threadPid = await pidResuming(threadCli);
      ok(mainPid && threadPid && mainPid !== threadPid, `3a: main turn (pid ${mainPid}) and thread turn (pid ${threadPid}) are two processes`);
      ok(threadCli !== main, "3a: the thread's long turn runs on the forked session");
      const mainBefore = mainTurn.events.length;

      const c = await post("/chat/cancel", { sessionId: handle });
      ok(c.status === 200 && c.body.cancelled === true, `3a: Stop on the thread -> 200 cancelled (${JSON.stringify(c.body)})`);
      ok(tree(threadPid).length === 0, `3a: the thread's whole tree is gone (survivors: ${tree(threadPid).join(",") || "none"})`);
      const tEvents = await Promise.race([threadTurn.ended, sleep(3000).then(() => null)]);
      ok(tEvents && tEvents.some((e) => e.event === "cancelled"), "3a: the thread's stream ended with event:cancelled");
      ok(tree(mainPid).length >= 3, `3a: the MAIN turn's tree is untouched (${tree(mainPid).length} pids)`);
      await sleep(1200);
      ok(mainTurn.events.length > mainBefore, `3a: and it is still streaming (${mainBefore} -> ${mainTurn.events.length} events)`);
      await post("/chat/cancel", { sessionId: main });
      await Promise.race([mainTurn.ended, sleep(3000)]);
      await post("/session/close", { sessionId: main, keepContext: false });
    }

    // 3b. The main turn's Stop leaves a running thread alone.
    {
      const main = await newChat();
      const handle = (await post("/thread/open", { sessionId: main, threadId: "t1" })).body.threadSessionId;
      await turn(handle, threadMsg("t1", "seed the fork"));
      const threadTurn = await startTurn(handle, threadMsg("t1", longMsg), isRunning);
      const threadCli = resumedIn(invocations().filter((i) => /LONG/.test(i.stdin) && /THREAD:t1/.test(i.stdin)).slice(-1)[0]);
      const threadPid = await pidResuming(threadCli);
      const mainTurn = await startTurn(main, longMsg, isRunning);
      const mainPid = await pidResuming(main);
      const threadBefore = threadTurn.events.length;

      const c = await post("/chat/cancel", { sessionId: main });
      ok(c.status === 200 && c.body.cancelled === true, `3b: Stop on the main turn -> 200 cancelled (${JSON.stringify(c.body)})`);
      ok(tree(mainPid).length === 0, `3b: the main turn's tree is gone (survivors: ${tree(mainPid).join(",") || "none"})`);
      const mEvents = await Promise.race([mainTurn.ended, sleep(3000).then(() => null)]);
      ok(mEvents && mEvents.some((e) => e.event === "cancelled"), "3b: the main stream ended with event:cancelled");
      ok(tree(threadPid).length >= 3, `3b: the THREAD is left running (${tree(threadPid).length} pids)`);
      await sleep(1200);
      ok(threadTurn.events.length > threadBefore, `3b: and it is still streaming (${threadBefore} -> ${threadTurn.events.length} events)`);

      // Discarding the chat takes its threads with it: nothing survives it.
      await post("/session/close", { sessionId: main, keepContext: false });
      await sleep(1500);
      ok(tree(threadPid).length === 0, `3b: discarding the chat kills the thread too (survivors: ${tree(threadPid).join(",") || "none"})`);
      const orphan = await turn(handle, threadMsg("t1", "anyone there?"));
      ok(orphan.status === 404, `3b: the thread handle is gone with its chat (${orphan.status})`);
      await Promise.race([threadTurn.ended, sleep(3000)]);
    }
  }

  // ---------------------------------------------------------------- case 4
  // Reload. The tab closes with keepContext, resumes, and re-opens its thread:
  // same handle, same forked session, nothing re-forked.
  {
    const main = await newChat();
    await turn(main, "FACT-D: this fixture is about eigenvalues.");
    const handle = (await post("/thread/open", { sessionId: main, threadId: "t3" })).body.threadSessionId;
    await turn(handle, threadMsg("t3", "THREAD-NOTE-D: the thread settled on 7."));  // forks
    await turn(handle, threadMsg("t3", "Noted."));                                   // resumes the fork
    const forkedBefore = REAL ? null : resumedIn(invocations().slice(-1)[0]);

    await post("/session/close", { sessionId: main, keepContext: true });   // reload
    const reopen = await post("/session/open", { sessionId: main });
    ok(reopen.status === 200, `4: the chat resumes (${reopen.status})`);
    const back = await post("/thread/open", { sessionId: main, threadId: "t3" });
    ok(back.status === 200 && back.body.threadSessionId === handle && back.body.reused === true, "4: the re-opened thread gets the handle it had before the reload");

    const recall = await turn(handle, threadMsg("t3", "RECALL"));
    ok(/THREAD-NOTE-D/.test(recall.text), "4: the re-opened thread still answers in its own session, with its own history");
    if (!REAL) {
      const last = invocations().slice(-1)[0];
      ok(resumedIn(last) === forkedBefore && !forkedIn(last), "4: it resumed the same forked session and did not fork again");
    }
    const mainRecall = await turn(main, "RECALL");
    ok(!/THREAD-NOTE-D/.test(mainRecall.text), "4: and the resumed main chat still has not heard the thread");
    await post("/session/close", { sessionId: main, keepContext: false });
  }

  // ---------------------------------------------------------------- case 5
  // The CLI did not fork. An id equal to the parent's means the MAIN session
  // is what is answering, so this turn is writing into the main conversation.
  // The proxy kills it there and then and fails the turn.
  if (!REAL) {
    const main = await newChat();
    const logAt = chatLog().length;
    await turn(main, "FACT-E: this fixture is about limits.");
    const handle = (await post("/thread/open", { sessionId: main, threadId: "t9" })).body.threadSessionId;
    const nofork = await turn(handle, threadMsg("t9", "NOFORK-PROBE the CLI answers as the parent session"));
    const first = invocations().slice(-1)[0];
    ok(resumedIn(first) === main && forkedIn(first), "5: the turn did ask for a fork");
    ok(nofork.events.some((e) => e.event === "error"), "5: the thread's turn ends `error` — not a normal-looking reply the student would trust");
    ok(!nofork.events.some((e) => e.event === "done"), "5: and never completes");
    ok(/THREAD_FORK_MISSING/.test(chatLog().slice(logAt)), "5: the proxy logged THREAD_FORK_MISSING rather than recording the parent's id");
    ok(await waitForLog(/THREAD_FORK_KILLED/, logAt), "5: and killed the turn that was running in the main session");
    ok((await post("/thread/fold", { sessionId: handle })).status === 409, "5: with no forked session recorded, the thread has nothing to fold -> 409");

    // What the kill is worth, measured on the main session's own history. The
    // fake writes a turn's message when it starts and its reply when it
    // completes, exactly as a CLI persists a turn — and holds a NOFORK reply
    // back 3s, so waiting past that is what makes its absence mean something.
    await sleep(3500);
    const mainRecall = await turn(main, "RECALL");
    ok(!/ack: \[THREAD:t9/.test(mainRecall.text), `5: the killed turn's REPLY never reached the main conversation ("${mainRecall.text.slice(0, 140)}")`);
    ok(/NOFORK-PROBE/.test(mainRecall.text), "5: the student's own message had already reached it — the CLI reads stdin before it says which session it is, so that residue is what the kill cannot undo (see proxy.js, \"Thread sessions\")");
    ok(/FACT-E/.test(mainRecall.text), "5: and the main conversation is otherwise intact");

    await turn(handle, threadMsg("t9", "and again"));
    const second = invocations().slice(-1)[0];
    ok(resumedIn(second) === main && forkedIn(second), "5: the next thread turn forks again instead of resuming the main session");
    await post("/session/close", { sessionId: main, keepContext: false });
  }

  // ---------------------------------------------------------------- case 6
  // Bad input. Nothing here should create a session or reach argv.
  {
    const main = await newChat();
    const sessionsBefore = (await sessionsList()).length;
    ok((await post("/thread/open", { sessionId: main })).status === 400, "6: /thread/open with no threadId -> 400");
    ok((await post("/thread/open", { sessionId: main, threadId: "../../etc/passwd" })).status === 400, "6: a threadId that is not an id -> 400");
    ok((await post("/thread/open", { sessionId: "00000000-0000-4000-8000-000000000000", threadId: "t1" })).status === 404, "6: /thread/open on an unknown chat -> 404");
    ok((await post("/thread/fold", { sessionId: "nope" })).status === 404, "6: /thread/fold on a malformed id -> 404");
    ok((await sessionsList()).length === sessionsBefore, `6: and none of that created a session (${sessionsBefore} before and after)`);
    await post("/session/close", { sessionId: main, keepContext: false });
  }

  // ---------------------------------------------------------------- case 7
  // Client rules, from the modules Chatbot.jsx imports (not restated here).
  // A <<REINFORCE>> emitted inside a thread is collected exactly as it is on
  // the main transcript — the roadmap's "reinforcement missing inside threads"
  // was already stale; the state-mutating tags are still deferred.
  {
    const seen = [];
    const r = processResponse("Right.<<REINFORCE>>Prefer worked examples<<END_REINFORCE>>", { scope: "thread", onError: (t, d) => seen.push([t, d]) });
    ok(r.reinforced.length === 1 && r.reinforced[0] === "Prefer worked examples", `7: <<REINFORCE>> in a thread reply is captured (${JSON.stringify(r.reinforced)})`);
    ok(!/REINFORCE/.test(r.display) && r.display === "Right.", "7: and stripped from what the thread shows");
    const s = processResponse('Try this.<<SUGGEST file="x.jsx">>y<<END_SUGGEST>>', { scope: "thread", onError: (t, d) => seen.push([t, d]) });
    ok(s.suggestion === null && !/SUGGEST/.test(s.display), "7: <<SUGGEST>> is still stripped in thread scope");
    ok(seen.some(([t, d]) => t === "thread-tag-deferred" && d.tag === "SUGGEST"), "7: and reported back as a thread-tag-deferred observation");
    const m = processResponse("Right.<<REINFORCE>>Prefer worked examples<<END_REINFORCE>>", { scope: "main" });
    ok(m.reinforced.length === 1, "7: main scope collects it the same way — one list, one chat");
  }

  // ---------------------------------------------------------------- case 8
  // Client wiring this suite cannot drive headlessly (no DOM), asserted
  // against the workspace's core copy so a refactor that drops it is caught.
  {
    const src = (f) => { try { return fs.readFileSync(path.join(CORE_DIR, f), "utf8"); } catch (_) { return ""; } };
    const chatbot = src("chat/Chatbot.jsx"), panel = src("chat/ThreadPanel.jsx");
    ok((chatbot.match(/role: "fold"/g) || []).length === 1, "8: the fold path appends exactly one fold message to the main transcript");
    ok(/obsQueue\.enqueue\(tab\.sessionId, "thread-folded"/.test(chatbot), "8: and queues that same summary onto the MAIN session's next turn");
    ok(/insertFoldCard\(t\.messages, card\)/.test(chatbot), "8: it places the card with insertFoldCard, not a plain append");
    ok(/mainBusy=\{!!activeTab\.loading\}/.test(chatbot) && /!!mainBusy/.test(panel), "8: and the fold button is dead while the tab's main turn streams");
    ok(/thread\.folding && !thread\.loading/.test(panel) && /!thread\.loading && !thread\.folding &&/.test(panel), "8: the thread composer is gone while a fold runs — two turns must not resume one session");
    ok(/for \(const obs of pendingFolds\(savedMsgs\)\)/.test(chatbot), "8: a restored transcript re-queues the folds no main turn has carried yet");
    ok(/foldPending \? \{ foldPending: true \}/.test(chatbot) && /m\.obs \? \{ obs: m\.obs \}/.test(chatbot), "8: and both are persisted with the transcript, or the reload has nothing to read");
    ok(/th\.folded \|\| th\.loading/.test(chatbot) && /!thread\.folded &&/.test(panel), "8: a thread can be folded once — the button is gone and the handler refuses after that");
    ok(/m\.threads\.map\(t => \(\{ \.\.\.t, collapsed: true \}\)\)/.test(chatbot), "8: a resumed chat restores its threads collapsed");
    ok(/obsQueue\.drain\(threadSessionId\)/.test(chatbot) && !/obsQueue\.drain\(tab\.sessionId\)[\s\S]{0,80}THREAD/.test(chatbot), "8: thread observations queue against the thread's session, not the tab's");
    ok(/cancelTurn\(th\.sessionId\)/.test(chatbot), "8: a thread's Stop cancels the thread's own session");
    ok(!fs.existsSync(path.join(CORE_DIR, "prompts", "thread-system.md")), "8: the orphaned prompts/thread-system.md is gone");
    ok(/OWN session, forked from the main conversation/.test(src("chat/buildSystemPrompt.js")), "8: the system prompt tells the tutor a thread is its own session");
  }

  // ---------------------------------------------------------------- case 9
  // The fold rules themselves (chat/turnState.js, the module Chatbot.jsx
  // imports), run against their own fixtures rather than read as source.
  {
    const card = { role: "fold", content: "S", obs: "OBS-1", foldPending: true };

    // Kept: a fold that lands while the main tutor is streaming goes BEFORE
    // the streaming bubble, so the stream's next chunk still finds it last.
    const streaming = [{ role: "user", content: "q" }, { role: "assistant", content: "half", _streaming: true }];
    const withCard = insertFoldCard(streaming, card);
    ok(withCard.length === 3 && withCard[1] === card && withCard[2]._streaming === true, `9: a fold during a streaming reply is inserted before it (${withCard.map((m) => m.role).join(",")})`);
    // Suppressed: with no turn in flight there is nothing to preserve, so the
    // card is simply last.
    const idle = [{ role: "user", content: "q" }, { role: "assistant", content: "done" }];
    ok(insertFoldCard(idle, card).slice(-1)[0] === card, "9: with no turn streaming it is appended at the end");
    ok(insertFoldCard([], card).length === 1, "9: and an empty transcript is not a special case");

    // Kept: a card the tutor has not been told about is re-queued on resume.
    const restored = [card, { role: "fold", content: "S2", obs: "OBS-2", foldPending: false }, { role: "assistant", content: "x", obs: "OBS-3", foldPending: true }];
    ok(JSON.stringify(pendingFolds(restored)) === JSON.stringify(["OBS-1"]), `9: only an undelivered FOLD is re-queued on resume (${JSON.stringify(pendingFolds(restored))})`);
    ok(pendingFolds([]).length === 0 && pendingFolds(undefined).length === 0, "9: a transcript with no folds re-queues nothing");

    // Kept vs suppressed: a turn settles the folds whose text it actually
    // drained, and leaves alone a fold enqueued after that drain (the one
    // made while the turn was streaming).
    const two = [{ role: "fold", content: "A", obs: "OBS-A", foldPending: true }, { role: "fold", content: "B", obs: "OBS-B", foldPending: true }];
    const after = settleFolds(two, "[OBSERVATION - thread-folded]\nOBS-A\n[/OBSERVATION]");
    ok(after[0].foldPending === false, "9: the fold this turn carried stops being pending");
    ok(after[1].foldPending === true, "9: and one enqueued after the drain stays pending for the next turn");
    ok(settleFolds(two, "") === two && settleFolds(two, "unrelated") === two, "9: a turn that carried none of them leaves the array untouched");
  }

  // --------------------------------------------------------------- case 10
  // A fold takes its turn in the thread's OWN queue. Two CLIs resuming one
  // session id at once is what the per-session queue exists to prevent, and
  // the loser's turn is lost from the thread's history.
  if (!REAL) {
    const main = await newChat();
    const handle = (await post("/thread/open", { sessionId: main, threadId: "t4" })).body.threadSessionId;
    await turn(handle, threadMsg("t4", "seed the fork"));
    const long = await startTurn(handle, threadMsg("t4", "LONG"), (ev) => ev === "status");
    const spawnsBefore = invocations().length;
    let folded = null;
    const foldP = post("/thread/fold", { sessionId: handle }).then((r) => { folded = r; return r; });
    await sleep(1500);
    ok(folded === null, "10: a fold asked for while the thread is answering waits its turn");
    ok(invocations().length === spawnsBefore, `10: and no second CLI was spawned on that session meanwhile (${invocations().length - spawnsBefore})`);

    await post("/chat/cancel", { sessionId: handle });
    await Promise.race([long.ended, sleep(3000)]);
    const done = await Promise.race([foldP, sleep(10000).then(() => null)]);
    ok(done && done.status === 200 && /SUMMARY/.test(done.body.summary || ""), `10: once that turn is over the fold runs (${done && done.status})`);
    await post("/session/close", { sessionId: main, keepContext: false });
  }

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(2); });
