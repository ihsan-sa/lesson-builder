// Chat persistence evidence: the dev proxy's half of the contract at the top of
// _lesson-core/chat/tutorApi.js (tab leases, transcript, queue + attach, delete),
// driven against a running proxy (PROXY_URL) whose `claude` is
// tests/proxy-persist/fake-claude. Every case runs on a session of its own.
// Exit 0 only when every assertion holds. See README.md.
const BASE = process.env.PROXY_URL || "http://127.0.0.1:3931";
let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"} ${msg}`); if (!cond) failures++; };
// One connection per request, as tests/cancellation does (its proxyFetch has the why).
const proxyFetch = (route, init) => fetch(BASE + route, { ...init, headers: { ...(init && init.headers), Connection: "close" } });
const post = async (route, body) => { const r = await proxyFetch(route, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => null) }; };
const sessionsList = async () => (await (await proxyFetch("/sessions")).json()).sessions;
const record = async (id) => (await sessionsList()).find((s) => s.id === id);
const init = async (extra) => (await post("/session/init", { model: "sonnet", effort: "low", isolated: true, system: "fixture", ...(extra || {}) })).body.sessionId;
const jsonError = (r) => !!(r.body && r.body.error && typeof r.body.error.message === "string");

// POST /chat as an SSE stream. `firstText` resolves on the first text event,
// `ended` with every event once the stream closes. A non-SSE answer (202, 409,
// ...) resolves `ended` at once with {status, body}.
async function stream(body) {
  const res = await proxyFetch("/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!(res.headers.get("content-type") || "").includes("text/event-stream")) {
    const b = await res.json().catch(() => null);
    return { status: res.status, body: b, events: [], firstText: Promise.resolve(), ended: Promise.resolve([]) };
  }
  const events = [];
  let gotText; const firstText = new Promise((r) => (gotText = r));
  const ended = (async () => {
    const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = ""; let ev = null;
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true }); const lines = buf.split("\n"); buf = lines.pop();
      for (const line of lines) {
        if (line.startsWith("event: ")) ev = line.slice(7).trim();
        else if (line.startsWith("data: ") && ev) { let data = {}; try { data = JSON.parse(line.slice(6)); } catch (_) {} events.push({ event: ev, data }); if (ev === "text") gotText(); ev = null; }
        else if (line === "") ev = null;
      }
    }
    gotText();
    return events;
  })();
  return { status: res.status, events, firstText, ended };
}
const doneText = (events) => { const d = events.find((e) => e.event === "done"); return d ? d.data.text : null; };

(async () => {
  // 1. Two tabs, one chat.
  {
    const sid = await init();
    const a = await post("/session/open", { sessionId: sid, tabId: "tabA" });
    ok(a.status === 200 && a.body.lease && a.body.lease.tabId === "tabA", `1: tab A opens and holds the lease (${a.status})`);
    const b = await post("/session/open", { sessionId: sid, tabId: "tabB" });
    ok(b.status === 409 && b.body.leased === true && jsonError(b), `1: tab B is refused while A's lease is live -> 409 leased (${b.status} ${JSON.stringify(b.body)})`);
    ok((await post("/session/ping", { sessionId: sid, tabId: "tabA" })).body?.held === true, "1: A's ping while it holds -> held");
    const bt = await post("/session/open", { sessionId: sid, tabId: "tabB", takeover: true });
    ok(bt.status === 200, `1: tab B with takeover -> 200 (${bt.status})`);
    const pa = await post("/session/ping", { sessionId: sid, tabId: "tabA" });
    ok(pa.status === 409 && pa.body.takenOver === true && jsonError(pa), `1: A's next ping -> 409 takenOver (${pa.status} ${JSON.stringify(pa.body)})`);
    const pb = await post("/session/ping", { sessionId: sid, tabId: "tabB" });
    ok(pb.status === 200 && pb.body.held === true && Array.isArray(pb.body.asks) && pb.body.asks.length === 0, `1: B's ping -> 200 {held, asks: []} (${JSON.stringify(pb.body)})`);
    const rec = await record(sid);
    ok(rec && rec.lease && rec.lease.tabId === "tabB" && typeof rec.lease.seen === "number" && rec.resumable === false, `1: /sessions names B's live lease and is not resumable (${JSON.stringify(rec && rec.lease)})`);
    const pu = await post("/session/ping", { sessionId: "00000000-0000-4000-8000-000000000000", tabId: "tabB" });
    ok(pu.status === 404 && jsonError(pu), `1: ping on an unknown session -> JSON 404 (${pu.status})`);
    // A's close must not free the chat B holds; B's does.
    await post("/session/close", { sessionId: sid, tabId: "tabA", keepContext: true });
    ok((await record(sid)).lease?.tabId === "tabB", "1: A closing leaves B's lease alone");
    await post("/session/close", { sessionId: sid, tabId: "tabB", keepContext: true });
    const rel = await record(sid);
    ok(rel && rel.lease === null && rel.open === false && rel.resumable === true, `1: B closing releases it and keeps the chat (resumable ${rel && rel.resumable})`);
    await post("/session/delete", { sessionId: sid });
  }

  // 2. Messages sent during a turn wait, and run as ONE merged turn.
  {
    const sid = await init({ tabId: "tabQ" });
    const first = await stream({ sessionId: sid, message: "SLOW first" });
    await first.firstText;
    const q = [];
    for (const m of ["m1", "m2", "m3", "m4", "m5"]) q.push(await post("/chat", { sessionId: sid, message: m }));
    ok(q.every((r, i) => r.status === 202 && r.body.queued === true && r.body.position === i + 1 && typeof r.body.queueId === "string"),
      `2: five messages during the turn -> 202 positions 1..5 (${q.map((r) => `${r.status}:${r.body && r.body.position}`).join(" ")})`);
    const sixth = await post("/chat", { sessionId: sid, message: "m6" });
    ok(sixth.status === 429 && jsonError(sixth), `2: a sixth -> JSON 429 (${sixth.status})`);
    const un = await post("/chat/unqueue", { sessionId: sid, queueId: q[3].body.queueId });
    const un5 = await post("/chat/unqueue", { sessionId: sid, queueId: q[4].body.queueId });
    ok(un.status === 200 && un.body.ok === true && un5.status === 200, `2: unqueue m4 and m5 -> 200 (${un.status}, ${un5.status})`);
    const mid = await record(sid);
    ok(mid && mid.queued === 3 && mid.turn, `2: /sessions says 3 queued behind the running turn (queued=${mid && mid.queued})`);
    // The running turn's own stream ends with its own reply; the moment it
    // does, attach must already be the merged turn, not a replay of this one.
    const firstEvents = await first.ended;
    ok(doneText(firstEvents) === "ECHO[SLOW first]", `2: the running turn's stream ends with its own reply (${doneText(firstEvents)})`);
    const att = await stream({ sessionId: sid, attach: true });
    ok(att.status === 200, `2: attach right after that done -> SSE 200 (${att.status})`);
    const merged = doneText(await att.ended);
    ok(merged === "ECHO[m1\n\n---\n\nm2\n\n---\n\nm3]", `2: attach gives ONE merged turn with m1, m2, m3 in order and nothing unqueued (${JSON.stringify(merged)})`);
    const late = await post("/chat/unqueue", { sessionId: sid, queueId: q[0].body.queueId });
    ok(late.status === 409 && jsonError(late), `2: unqueue of a message already in a turn -> JSON 409 (${late.status})`);
    const after = await record(sid);
    ok(after && after.messageCount === 2 && after.queued === 0 && !after.turn, `2: the merged turn counts once (messageCount=${after && after.messageCount})`);
    const again = doneText(await (await stream({ sessionId: sid, attach: true })).ended);
    ok(again === merged, "2: a later attach replays the finished merged turn");
    await post("/session/delete", { sessionId: sid });
  }

  // 3 + 4. Transcript and its pages; the picker's fields.
  let sid3;
  {
    const t0 = Date.now();
    sid3 = await init({ tabId: "tabH" });
    const r0 = await record(sid3);
    ok(r0 && r0.title === null && r0.queued === 0 && typeof r0.lastAt === "number", `4: a fresh chat has no title, 0 queued, a lastAt (${JSON.stringify({ t: r0 && r0.title, q: r0 && r0.queued })})`);
    const na = await post("/chat", { sessionId: sid3, attach: true });
    ok(na.status === 409 && jsonError(na), `3: attach before any turn -> JSON 409 (${na.status})`);
    const q1 = "[Lesson: poles]\nSome lesson context.\n\nQuestion: What is a pole, and why does it matter for stability of the whole loop?";
    await (await stream({ sessionId: sid3, message: q1 })).ended;
    await (await stream({ sessionId: sid3, message: "Q2" })).ended;
    const all = (await post("/session/history", { sessionId: sid3 })).body;
    const shape = (all.turns || []).map((t) => `${t.role}:${t.text}`);
    ok(all.turns.length === 4 && shape.join("|") === `user:${q1}|assistant:ECHO[${q1}]|user:Q2|assistant:ECHO[Q2]` && all.more === false && all.before === 0
      && all.turns.every((t) => typeof t.at === "number"), `3: history after two turns -> 4 turns, oldest first, as sent (${JSON.stringify(shape)})`);
    const p1 = (await post("/session/history", { sessionId: sid3, limit: 2 })).body;
    ok(p1.turns.map((t) => t.text).join("|") === "Q2|ECHO[Q2]" && p1.more === true && p1.before === 2, `3: limit 2 -> the last two, more, before 2 (${JSON.stringify(p1)})`);
    const p2 = (await post("/session/history", { sessionId: sid3, limit: 2, before: p1.before })).body;
    ok(p2.turns.length === 2 && p2.turns[0].text === q1 && p2.more === false && p2.before === 0, `3: the page before -> the first two, no more (${p2.turns.length}, more ${p2.more})`);
    const r = await record(sid3);
    ok(r && r.title === "What is a pole, and why does it matter for stability of the…", `4: title is the question, preamble stripped, cut near 60 (${JSON.stringify(r && r.title)})`);
    ok(r && r.lastAt >= t0 && r.lastAt <= Date.now() && r.queued === 0, `4: lastAt is the last turn's time (${r && r.lastAt - t0}ms after start)`);
    const sidB = await init();
    await (await stream({ sessionId: sidB, message: "[Section 2: Bode plots]\nWhy does the phase wrap?" })).ended;
    ok((await record(sidB)).title === "Why does the phase wrap?", `4: without "Question:", leading [context] lines are dropped (${(await record(sidB)).title})`);
    await post("/session/delete", { sessionId: sidB });
  }

  // 5. Delete is the discard.
  {
    const d = await post("/session/delete", { sessionId: sid3 });
    ok(d.status === 200 && d.body.ok === true, "5: session/delete -> 200 ok");
    ok(!(await record(sid3)), "5: the deleted chat is gone from /sessions");
    const h = await post("/session/history", { sessionId: sid3 });
    ok(h.status === 404 && jsonError(h), `5: its history -> JSON 404 (${h.status})`);
  }

  // 6. A lesson built before leases: no tabId, the `open` flag rules as before.
  {
    const sid = await init();
    ok((await post("/session/open", { sessionId: sid })).status === 409, "6: open of a chat already open (no tabId) -> 409 as before");
    await post("/session/close", { sessionId: sid, keepContext: true });
    const rel = await record(sid);
    ok(rel && rel.open === false && rel.resumable === true && rel.lease === null, "6: close keepContext releases it, resumable");
    const o = await post("/session/open", { sessionId: sid });
    ok(o.status === 200 && o.body.ok === true && !("lease" in o.body), `6: re-open -> 200 with no lease (${o.status})`);
    ok((await (await stream({ sessionId: sid, message: "old" })).ended).some((e) => e.event === "done"), "6: an old client's turn streams to done");
    await post("/session/close", { sessionId: sid, keepContext: false });
    ok(!(await record(sid)), "6: close without keepContext still discards the chat");
  }

  console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error("check crashed:", e); process.exit(2); });
